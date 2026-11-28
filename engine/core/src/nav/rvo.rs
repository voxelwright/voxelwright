//! ORCA / RVO2 2D batch local crowd avoidance in Structure-of-Arrays (SoA) layout (#164).
//!
//! Supports up to [`MAX_AGENTS`] (512) active agents in a contiguous linear-memory SoA buffer
//! for zero-copy JS↔WASM marshaling, O(N) uniform spatial-hash neighbor lookup, true 2D ORCA
//! half-plane construction + 2D LP solver (`linear_program2` + infeasible fallback
//! `linear_program3`), explicit 2D wall segments, and automatic static voxel wall/crater
//! avoidance from cached [`TileCache`] tiles.

use crate::nav::heightfield::{
    AGENT_TALL, DIR_OFFSETS, MOVE_WALK, NAV_STEP, TILE_CELLS, TILE_COLS, world_to_col,
    world_to_tile,
};
use crate::nav::tiles::TileCache;

/// Maximum number of active crowd agents in the SoA buffer.
pub const MAX_AGENTS: usize = 512;
/// Number of `f32` planes in the contiguous SoA buffer.
pub const CROWD_FIELDS: usize = 10;
/// Total `f32` elements in the SoA buffer (`512 * 10 = 5120`, 20 KiB).
pub const CROWD_FLOATS: usize = MAX_AGENTS * CROWD_FIELDS;

// Plane offsets (in `f32` elements, each plane has length `MAX_AGENTS`):
pub const FIELD_POS_X: usize = 0;
pub const FIELD_POS_Z: usize = 1;
pub const FIELD_POS_Y: usize = 2;
pub const FIELD_VEL_X: usize = 3;
pub const FIELD_VEL_Z: usize = 4;
pub const FIELD_PREF_VX: usize = 5;
pub const FIELD_PREF_VZ: usize = 6;
pub const FIELD_RADIUS: usize = 7;
pub const FIELD_MAX_SPEED: usize = 8;
pub const FIELD_FLAGS: usize = 9;

/// Agent is stationary / kinematic obstacle: moving agents take 100% of avoidance responsibility.
pub const CROWD_FLAG_STATIC: u32 = 1 << 0;
/// Compute ORCA velocity `(vel_x, vel_z)` only without integrating `(pos_x, pos_z)`.
pub const CROWD_FLAG_VEL_ONLY: u32 = 1 << 1;
/// Skip automatic static wall/crater half-planes from cached `NavTile`s.
pub const CROWD_FLAG_IGNORE_WORLD: u32 = 1 << 2;

const RVO_EPSILON: f32 = 1e-5;
const MAX_NEIGHBORS: usize = 14;
const GRID_BUCKETS: usize = 1024;
const GRID_MASK: usize = GRID_BUCKETS - 1;

#[derive(Clone, Copy, Debug, Default)]
struct Vec2 {
    x: f32,
    y: f32, // represents world Z
}

impl Vec2 {
    #[inline]
    const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
    #[inline]
    fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y)
    }
    #[inline]
    fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y)
    }
    #[inline]
    fn scale(self, s: f32) -> Self {
        Self::new(self.x * s, self.y * s)
    }
    #[inline]
    fn dot(self, o: Self) -> f32 {
        self.x * o.x + self.y * o.y
    }
    #[inline]
    fn det(self, o: Self) -> f32 {
        self.x * o.y - self.y * o.x
    }
    #[inline]
    fn len_sq(self) -> f32 {
        self.dot(self)
    }
    #[inline]
    fn len(self) -> f32 {
        self.len_sq().sqrt()
    }
    #[inline]
    fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

/// Directed ORCA half-plane: feasible velocities `v` satisfy `det(dir, v - point) >= 0`.
#[derive(Clone, Copy, Debug)]
struct Line {
    point: Vec2,
    dir: Vec2,
}

/// Static 2D obstacle line segment `(a -> b)` in world XZ coordinates.
#[derive(Clone, Copy, Debug)]
pub struct ObstacleSeg {
    pub ax: f32,
    pub az: f32,
    pub bx: f32,
    pub bz: f32,
}

/// Reusable ORCA/RVO2 crowd avoidance solver holding the linear-memory SoA buffer.
pub struct Crowd {
    /// Contiguous SoA buffer: `data[field * MAX_AGENTS + idx]`.
    data: Box<[f32; CROWD_FLOATS]>,
    /// Explicit 2D static obstacle segments (doorways, barricades, walls).
    obstacles: Vec<ObstacleSeg>,
    // Reusable scratch (zero allocations per `step`).
    grid_head: [u16; GRID_BUCKETS],
    grid_next: [u16; MAX_AGENTS],
    new_vx: [f32; MAX_AGENTS],
    new_vz: [f32; MAX_AGENTS],
    lines: Vec<Line>,
    proj_lines: Vec<Line>,
    neighbors: [(f32, usize); MAX_NEIGHBORS],
}

impl Default for Crowd {
    fn default() -> Self {
        Self::new()
    }
}

impl Crowd {
    pub fn new() -> Self {
        Self {
            data: Box::new([0.0; CROWD_FLOATS]),
            obstacles: Vec::new(),
            grid_head: [u16::MAX; GRID_BUCKETS],
            grid_next: [u16::MAX; MAX_AGENTS],
            new_vx: [0.0; MAX_AGENTS],
            new_vz: [0.0; MAX_AGENTS],
            lines: Vec::with_capacity(32),
            proj_lines: Vec::with_capacity(32),
            neighbors: [(0.0, 0); MAX_NEIGHBORS],
        }
    }

    pub fn reset(&mut self) {
        self.data.fill(0.0);
        self.obstacles.clear();
    }

    pub fn clear_obstacles(&mut self) {
        self.obstacles.clear();
    }

    pub fn add_obstacle(&mut self, ax: f32, az: f32, bx: f32, bz: f32) {
        if ax.is_finite() && az.is_finite() && bx.is_finite() && bz.is_finite() {
            self.obstacles.push(ObstacleSeg { ax, az, bx, bz });
        }
    }

    /// Stable raw pointer to the contiguous `[f32; 10 * 512]` SoA buffer.
    #[inline]
    pub fn agents_ptr(&mut self) -> *mut f32 {
        self.data.as_mut_ptr()
    }

    #[inline]
    pub fn field(&self, f: usize) -> &[f32] {
        let base = f * MAX_AGENTS;
        &self.data[base..base + MAX_AGENTS]
    }

    #[inline]
    pub fn field_mut(&mut self, f: usize) -> &mut [f32] {
        let base = f * MAX_AGENTS;
        &mut self.data[base..base + MAX_AGENTS]
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_agent(
        &mut self,
        idx: usize,
        x: f32,
        y: f32,
        z: f32,
        vx: f32,
        vz: f32,
        pref_vx: f32,
        pref_vz: f32,
        radius: f32,
        max_speed: f32,
        flags: u32,
    ) {
        if idx >= MAX_AGENTS {
            return;
        }
        self.data[FIELD_POS_X * MAX_AGENTS + idx] = x;
        self.data[FIELD_POS_Z * MAX_AGENTS + idx] = z;
        self.data[FIELD_POS_Y * MAX_AGENTS + idx] = y;
        self.data[FIELD_VEL_X * MAX_AGENTS + idx] = vx;
        self.data[FIELD_VEL_Z * MAX_AGENTS + idx] = vz;
        self.data[FIELD_PREF_VX * MAX_AGENTS + idx] = pref_vx;
        self.data[FIELD_PREF_VZ * MAX_AGENTS + idx] = pref_vz;
        self.data[FIELD_RADIUS * MAX_AGENTS + idx] = radius;
        self.data[FIELD_MAX_SPEED * MAX_AGENTS + idx] = max_speed;
        self.data[FIELD_FLAGS * MAX_AGENTS + idx] = flags as f32;
    }

    #[inline]
    pub fn agent_pos(&self, idx: usize) -> (f32, f32, f32) {
        (
            self.data[FIELD_POS_X * MAX_AGENTS + idx],
            self.data[FIELD_POS_Y * MAX_AGENTS + idx],
            self.data[FIELD_POS_Z * MAX_AGENTS + idx],
        )
    }

    #[inline]
    pub fn agent_vel(&self, idx: usize) -> (f32, f32) {
        (
            self.data[FIELD_VEL_X * MAX_AGENTS + idx],
            self.data[FIELD_VEL_Z * MAX_AGENTS + idx],
        )
    }

    /// Runs one ORCA/RVO2 step for agents `0..count.min(MAX_AGENTS)`.
    /// Updates `vel_x, vel_z` and integrates `pos_x, pos_z` (unless `CROWD_FLAG_STATIC` or `CROWD_FLAG_VEL_ONLY`).
    pub fn step(&mut self, count: usize, dt: f32, time_horizon: f32, nav_tiles: Option<&TileCache>) -> usize {
        let n = count.min(MAX_AGENTS);
        if n == 0 || !dt.is_finite() || dt <= 0.0 {
            return 0;
        }
        let tau = if time_horizon.is_finite() && time_horizon > dt {
            time_horizon
        } else {
            dt.max(0.25)
        };
        let inv_tau = 1.0 / tau;
        let inv_dt = 1.0 / dt.max(1e-4);
        let tau_obs = tau.min(0.25).max(dt);
        let inv_tau_obs = 1.0 / tau_obs;

        // 1. Determine scale-invariant spatial hash cell size from active agents.
        let mut max_r = 0.25f32;
        let mut max_v = 0.0f32;
        for i in 0..n {
            let r = self.data[FIELD_RADIUS * MAX_AGENTS + i];
            let v = self.data[FIELD_MAX_SPEED * MAX_AGENTS + i];
            if r.is_finite() && r > max_r {
                max_r = r;
            }
            if v.is_finite() && v > max_v {
                max_v = v;
            }
        }
        let neighbor_dist = (max_v * tau * 0.85 + 2.5 * max_r).max(4.5 * max_r);
        let neighbor_dist_sq = neighbor_dist * neighbor_dist;
        let cell_size = neighbor_dist.max(1.0);
        let inv_cell = 1.0 / cell_size;

        // 2. Populate uniform spatial hash grid in O(N).
        self.build_grid(n, inv_cell);

        let has_nav = nav_tiles.is_some_and(|c| c.tile_count() > 0);

        // 3. For each agent, gather nearest neighbors, build static + agent ORCA half-planes, solve LP.
        for i in 0..n {
            let flags_i = self.data[FIELD_FLAGS * MAX_AGENTS + i] as u32;
            let pos_i = Vec2::new(
                self.data[FIELD_POS_X * MAX_AGENTS + i],
                self.data[FIELD_POS_Z * MAX_AGENTS + i],
            );
            let py_i = self.data[FIELD_POS_Y * MAX_AGENTS + i];
            let vel_i = Vec2::new(
                self.data[FIELD_VEL_X * MAX_AGENTS + i],
                self.data[FIELD_VEL_Z * MAX_AGENTS + i],
            );
            let pref_raw = Vec2::new(
                self.data[FIELD_PREF_VX * MAX_AGENTS + i],
                self.data[FIELD_PREF_VZ * MAX_AGENTS + i],
            );
            let rad_i = self.data[FIELD_RADIUS * MAX_AGENTS + i].max(0.05);
            let max_spd = self.data[FIELD_MAX_SPEED * MAX_AGENTS + i].max(0.0);

            if (flags_i & CROWD_FLAG_STATIC) != 0 || max_spd <= 1e-6 || !pos_i.is_finite() {
                self.new_vx[i] = 0.0;
                self.new_vz[i] = 0.0;
                continue;
            }

            let mut pref = if pref_raw.is_finite() { pref_raw } else { Vec2::default() };
            let plen = pref.len();
            if plen > max_spd {
                pref = pref.scale(max_spd / plen);
            }

            self.lines.clear();

            // 3a. Static 2D obstacle segments (highest priority — always kept in `0..num_obst_lines`).
            for seg in &self.obstacles {
                push_segment_orca(
                    &mut self.lines,
                    pos_i,
                    vel_i,
                    pref,
                    rad_i,
                    Vec2::new(seg.ax, seg.az),
                    Vec2::new(seg.bx, seg.bz),
                    inv_tau_obs,
                    inv_dt,
                );
            }

            // 3b. Automatic static voxel wall / crater constraints from cached NavTile (O(1)).
            if has_nav && (flags_i & CROWD_FLAG_IGNORE_WORLD) == 0 {
                if let Some(tiles) = nav_tiles {
                    push_nav_tile_obstacles(&mut self.lines, tiles, pos_i, py_i, rad_i, inv_tau_obs, inv_dt);
                }
            }

            let num_obst_lines = self.lines.len();
            // Check whether a static obstacle lies on this agent's right-hand side (`det(pref, n_wall) < 0`,
            // i.e. wall normal pushes left). An agent hugging its right-hand wall holds right-of-way in
            // counter-flowing corridors/doorways while oncoming traffic with space on its right yields & merges right.
            let right_dir = if plen > 1e-5 {
                Vec2::new(-pref.y / plen, pref.x / plen)
            } else {
                Vec2::default()
            };
            let wall_on_right = self.lines[..num_obst_lines].iter().any(|l| {
                // Outward wall normal into feasible space is `(-l.dir.y, l.dir.x)`.
                // A wall on our right pushes us LEFT (`dot(n_wall, right_dir) < -0.35`).
                let n_wall = Vec2::new(-l.dir.y, l.dir.x);
                n_wall.dot(right_dir) < -0.35
            });
            let wall_on_left = self.lines[..num_obst_lines].iter().any(|l| {
                // A wall on our left pushes us RIGHT (`dot(n_wall, right_dir) > 0.35`).
                let n_wall = Vec2::new(-l.dir.y, l.dir.x);
                n_wall.dot(right_dir) > 0.35
            });

            // 3c. Query 3×3 spatial hash neighborhood and retain up to `MAX_NEIGHBORS` nearest agents.
            let gx = (pos_i.x * inv_cell).floor() as i32;
            let gz = (pos_i.y * inv_cell).floor() as i32;
            let mut n_count = 0usize;
            let mut worst_slot = 0usize;
            let mut worst_d2 = 0.0f32;

            for dz in -1..=1 {
                for dx in -1..=1 {
                    let b = hash_cell(gx + dx, gz + dz);
                    let mut cur = self.grid_head[b];
                    while cur != u16::MAX {
                        let j = cur as usize;
                        cur = self.grid_next[j];
                        if j == i {
                            continue;
                        }
                        // Multi-layer 3D vertical separation: agents on a bridge ignore agents underneath.
                        let py_j = self.data[FIELD_POS_Y * MAX_AGENTS + j];
                        if (py_i - py_j).abs() >= AGENT_TALL as f32 {
                            continue;
                        }
                        let pos_j = Vec2::new(
                            self.data[FIELD_POS_X * MAX_AGENTS + j],
                            self.data[FIELD_POS_Z * MAX_AGENTS + j],
                        );
                        let rel = pos_j.sub(pos_i);
                        let d2 = rel.len_sq();
                        if d2 > neighbor_dist_sq {
                            continue;
                        }
                        if n_count < MAX_NEIGHBORS {
                            self.neighbors[n_count] = (d2, j);
                            if d2 > worst_d2 {
                                worst_d2 = d2;
                                worst_slot = n_count;
                            }
                            n_count += 1;
                        } else if d2 < worst_d2 {
                            self.neighbors[worst_slot] = (d2, j);
                            worst_d2 = -1.0;
                            for k in 0..MAX_NEIGHBORS {
                                if self.neighbors[k].0 > worst_d2 {
                                    worst_d2 = self.neighbors[k].0;
                                    worst_slot = k;
                                }
                            }
                        }
                    }
                }
            }

            // Sort selected nearest neighbors closest-first so tight constraints enter the LP first.
            let neigh = &mut self.neighbors[..n_count];
            neigh.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));

            // 3d. Build ORCA half-plane for each selected neighbor.
            let mut head_on_pressure = 0u32;
            let mut opposing_pressure = 0u32;
            for k in 0..n_count {
                let (_, j) = self.neighbors[k];
                let pos_j = Vec2::new(
                    self.data[FIELD_POS_X * MAX_AGENTS + j],
                    self.data[FIELD_POS_Z * MAX_AGENTS + j],
                );
                let vel_j = Vec2::new(
                    self.data[FIELD_VEL_X * MAX_AGENTS + j],
                    self.data[FIELD_VEL_Z * MAX_AGENTS + j],
                );
                let rad_j = self.data[FIELD_RADIUS * MAX_AGENTS + j].max(0.05);
                let flags_j = self.data[FIELD_FLAGS * MAX_AGENTS + j] as u32;
                let pref_j_raw = Vec2::new(
                    self.data[FIELD_PREF_VX * MAX_AGENTS + j],
                    self.data[FIELD_PREF_VZ * MAX_AGENTS + j],
                );
                let max_spd_j = self.data[FIELD_MAX_SPEED * MAX_AGENTS + j].max(0.0);
                let pref_j = if (flags_j & CROWD_FLAG_STATIC) != 0 || !pref_j_raw.is_finite() {
                    Vec2::default()
                } else {
                    let pj_len = pref_j_raw.len();
                    if pj_len > max_spd_j && pj_len > 1e-6 {
                        pref_j_raw.scale(max_spd_j / pj_len)
                    } else {
                        pref_j_raw
                    }
                };

                let rel_pos = pos_j.sub(pos_i);
                let rel_vel = vel_i.sub(vel_j);
                let dist_sq = rel_pos.len_sq();
                let comb_rad = rad_i + rad_j;
                let comb_rad_sq = comb_rad * comb_rad;

                let (dir, u) = if dist_sq > comb_rad_sq {
                    // No current overlap.
                    let w = rel_vel.sub(rel_pos.scale(inv_tau));
                    let w_len_sq = w.len_sq();
                    let dot_prod = w.dot(rel_pos);
                    if dot_prod < 0.0 && dot_prod * dot_prod > comb_rad_sq * w_len_sq {
                        // Project onto cut-off circle.
                        let w_len = w_len_sq.sqrt().max(1e-8);
                        let unit_w = w.scale(1.0 / w_len);
                        let dir = Vec2::new(unit_w.y, -unit_w.x);
                        let u = unit_w.scale(comb_rad * inv_tau - w_len);
                        (dir, u)
                    } else {
                        // Project onto velocity-obstacle legs.
                        let leg = (dist_sq - comb_rad_sq).max(0.0).sqrt();
                        let dir = if rel_pos.det(w) > 0.0 {
                            // Left leg.
                            Vec2::new(
                                rel_pos.x * leg - rel_pos.y * comb_rad,
                                rel_pos.x * comb_rad + rel_pos.y * leg,
                            )
                            .scale(1.0 / dist_sq)
                        } else {
                            // Right leg.
                            Vec2::new(
                                rel_pos.x * leg + rel_pos.y * comb_rad,
                                -rel_pos.x * comb_rad + rel_pos.y * leg,
                            )
                            .scale(-1.0 / dist_sq)
                        };
                        let dot2 = rel_vel.dot(dir);
                        let u = dir.scale(dot2).sub(rel_vel);
                        (dir, u)
                    }
                } else {
                    // Already touching/overlapping: resolve within one time step `dt`.
                    let (unit_w, w_len) = if dist_sq < 1e-8 {
                        // Deterministic symmetry break for exactly coincident agents.
                        let angle = ((i.wrapping_mul(2654435761) ^ j.wrapping_mul(2246822519)) & 1023)
                            as f32
                            * (std::f32::consts::TAU / 1024.0);
                        (Vec2::new(angle.cos(), angle.sin()), 0.0)
                    } else {
                        let w = rel_vel.sub(rel_pos.scale(inv_dt));
                        let wl = w.len();
                        if wl < 1e-6 {
                            let d = dist_sq.sqrt();
                            (rel_pos.scale(-1.0 / d), 0.0)
                        } else {
                            (w.scale(1.0 / wl), wl)
                        }
                    };
                    let dir = Vec2::new(unit_w.y, -unit_w.x);
                    let u = unit_w.scale(comb_rad * inv_dt - w_len);
                    (dir, u)
                };

                // Detect genuinely opposing counter-flow (`angle > 120°`, `dp < -0.5 * |pref|²`)
                // vs. same-direction / converging bottleneck traffic (`dp >= -0.5 * |pref|²`).
                let mut opposing_pair = false;
                let mut same_dir_pair = false;
                if pref.len_sq() > 1e-4 {
                    let dp = pref_j.dot(pref);
                    let opposing = dp < -0.5 * pref.len_sq();
                    if rel_pos.dot(pref) > 0.0 {
                        let cross = rel_pos.det(pref).abs();
                        if opposing || cross * cross < 0.04 * dist_sq * pref.len_sq() {
                            head_on_pressure += 1;
                            if opposing {
                                opposing_pressure += 1;
                                opposing_pair = true;
                            }
                        }
                    }
                    if !opposing && pref_j.len_sq() > 1e-4 {
                        same_dir_pair = true;
                    }
                }

                // Reciprocal ORCA responsibility shares (always summing to 1.0 for dynamic pairs):
                let share = if (flags_j & CROWD_FLAG_STATIC) != 0 {
                    1.0
                } else if num_obst_lines > 0 && same_dir_pair {
                    let fwd = pref.add(pref_j);
                    let lead = pos_i.sub(pos_j).dot(fwd);
                    let thresh = 0.20 * fwd.len();
                    let i_first = if lead > thresh {
                        true
                    } else if lead < -thresh {
                        false
                    } else {
                        i < j
                    };
                    if i_first { 0.15 } else { 0.85 }
                } else if opposing_pair {
                    if wall_on_right {
                        0.32
                    } else if num_obst_lines > 0 {
                        0.68
                    } else if i < j {
                        0.45
                    } else {
                        0.55
                    }
                } else {
                    0.5
                };
                let point = vel_i.add(u.scale(share));
                if dir.is_finite() && point.is_finite() {
                    self.lines.push(Line { point, dir });
                }
            }

            // Gentle deterministic right-hand symmetry-breaking bias under opposing or head-on
            // congestion: breaks exact antipodal/corridor standoffs without drifting agents
            // laterally past narrow doorways or into adjacent walls.
            let mut opt_vel = pref;
            if head_on_pressure > 0 && opt_vel.len_sq() > 1e-6 && !wall_on_right {
                let len = opt_vel.len();
                let right = Vec2::new(-opt_vel.y / len, opt_vel.x / len);
                let progress = vel_i.dot(opt_vel) / (len * len);
                let base_bias = if wall_on_left && opposing_pressure > 0 {
                    // Hugging the wrong (left) wall facing oncoming traffic: firmly merge right.
                    0.38
                } else if num_obst_lines > 0 {
                    0.06
                } else if progress < 0.25 {
                    0.22
                } else {
                    0.08
                };
                let jitter = base_bias + ((i * 37) & 15) as f32 * 0.0015;
                opt_vel = opt_vel.add(right.scale(len * jitter));
                let olen = opt_vel.len();
                if olen > max_spd {
                    opt_vel = opt_vel.scale(max_spd / olen);
                }
            }

            // 3e. Solve 2D Linear Program with infeasible doorway fallback (`linear_program3`).
            let mut result = opt_vel;
            let fail_line = linear_program2(&self.lines, max_spd, opt_vel, false, &mut result);
            if fail_line < self.lines.len() {
                let locked_obst = if fail_line < num_obst_lines { 0 } else { num_obst_lines };
                linear_program3(
                    &self.lines,
                    locked_obst,
                    fail_line,
                    max_spd,
                    &mut result,
                    &mut self.proj_lines,
                );
            }

            // Clamp speed and guarantee zero NaNs.
            if !result.is_finite() {
                result = Vec2::default();
            } else {
                let rlen = result.len();
                if rlen > max_spd && rlen > 0.0 {
                    result = result.scale(max_spd / rlen);
                }
            }
            self.new_vx[i] = result.x;
            self.new_vz[i] = result.y;
        }

        // 4. Commit computed velocities and integrate positions.
        for i in 0..n {
            let flags_i = self.data[FIELD_FLAGS * MAX_AGENTS + i] as u32;
            if (flags_i & CROWD_FLAG_STATIC) != 0 {
                continue;
            }
            let vx = self.new_vx[i];
            let vz = self.new_vz[i];
            self.data[FIELD_VEL_X * MAX_AGENTS + i] = vx;
            self.data[FIELD_VEL_Z * MAX_AGENTS + i] = vz;
            if (flags_i & CROWD_FLAG_VEL_ONLY) == 0 {
                self.data[FIELD_POS_X * MAX_AGENTS + i] += vx * dt;
                self.data[FIELD_POS_Z * MAX_AGENTS + i] += vz * dt;
            }
        }

        // 5. Fast early-exiting Symmetric Gauss-Seidel position separation & static wall projection
        //    with closing-velocity damping so dense 200-agent crushes and narrow doorways never
        //    overlap below `r_i + r_j`.
        let sep_inv_cell = 1.0 / (max_r * 2.15).max(1.0);
        self.resolve_overlaps(n, sep_inv_cell, nav_tiles);

        n
    }

    fn build_grid(&mut self, n: usize, inv_cell: f32) {
        self.grid_head.fill(u16::MAX);
        for i in 0..n {
            let px = self.data[FIELD_POS_X * MAX_AGENTS + i];
            let pz = self.data[FIELD_POS_Z * MAX_AGENTS + i];
            if !px.is_finite() || !pz.is_finite() {
                continue;
            }
            let gx = (px * inv_cell).floor() as i32;
            let gz = (pz * inv_cell).floor() as i32;
            let b = hash_cell(gx, gz);
            self.grid_next[i] = self.grid_head[b];
            self.grid_head[b] = i as u16;
        }
    }

    fn resolve_overlaps(&mut self, n: usize, inv_cell: f32, nav_tiles: Option<&TileCache>) {
        let has_nav = nav_tiles.is_some_and(|c| c.tile_count() > 0);
        let has_obst = !self.obstacles.is_empty() || has_nav;
        self.build_grid(n, inv_cell);
        for iter in 0..48 {
            // Rebuild grid every 2 passes if iterations continue so shifted agents stay indexed.
            if iter > 0 && (iter & 1) == 0 {
                self.build_grid(n, inv_cell);
            }
            let mut max_pen = 0.0f32;
            let rev = (iter & 1) != 0;
            for step in 0..n {
                let i = if rev { n - 1 - step } else { step };
                let flags_i = self.data[FIELD_FLAGS * MAX_AGENTS + i] as u32;
                let static_i = (flags_i & (CROWD_FLAG_STATIC | CROWD_FLAG_VEL_ONLY)) != 0;
                let mut px_i = self.data[FIELD_POS_X * MAX_AGENTS + i];
                let mut pz_i = self.data[FIELD_POS_Z * MAX_AGENTS + i];
                let py_i = self.data[FIELD_POS_Y * MAX_AGENTS + i];
                let rad_i = self.data[FIELD_RADIUS * MAX_AGENTS + i].max(0.05);
                if !px_i.is_finite() || !pz_i.is_finite() {
                    continue;
                }
                let gx = (px_i * inv_cell).floor() as i32;
                let gz = (pz_i * inv_cell).floor() as i32;
                for dz in -1..=1 {
                    for dx in -1..=1 {
                        let b = hash_cell(gx + dx, gz + dz);
                        let mut cur = self.grid_head[b];
                        while cur != u16::MAX {
                            let j = cur as usize;
                            cur = self.grid_next[j];
                            if if rev { j >= i } else { j <= i } {
                                continue;
                            }
                            let py_j = self.data[FIELD_POS_Y * MAX_AGENTS + j];
                            if (py_i - py_j).abs() >= AGENT_TALL as f32 {
                                continue;
                            }
                            let flags_j = self.data[FIELD_FLAGS * MAX_AGENTS + j] as u32;
                            let static_j = (flags_j & (CROWD_FLAG_STATIC | CROWD_FLAG_VEL_ONLY)) != 0;
                            if static_i && static_j {
                                continue;
                            }
                            let px_j = self.data[FIELD_POS_X * MAX_AGENTS + j];
                            let pz_j = self.data[FIELD_POS_Z * MAX_AGENTS + j];
                            let rad_j = self.data[FIELD_RADIUS * MAX_AGENTS + j].max(0.05);
                            let min_d = (rad_i + rad_j) * 1.002;
                            let rdx = px_j - px_i;
                            let rdz = pz_j - pz_i;
                            let d2 = rdx * rdx + rdz * rdz;
                            if d2 >= min_d * min_d {
                                continue;
                            }
                            let (nx, nz, pen) = if d2 < 1e-8 {
                                let angle = ((i.wrapping_mul(73856093) ^ j.wrapping_mul(19349663)) & 1023)
                                    as f32
                                    * (std::f32::consts::TAU / 1024.0);
                                (angle.cos(), angle.sin(), min_d)
                            } else {
                                let d = d2.sqrt();
                                (rdx / d, rdz / d, min_d - d + 1e-4)
                            };
                            if pen > max_pen {
                                max_pen = pen;
                            }
                            let (wi, wj) = match (static_i, static_j) {
                                (false, false) => (0.5, 0.5),
                                (false, true) => (1.0, 0.0),
                                (true, false) => (0.0, 1.0),
                                (true, true) => (0.0, 0.0),
                            };
                            px_i -= nx * pen * wi;
                            pz_i -= nz * pen * wi;
                            self.data[FIELD_POS_X * MAX_AGENTS + i] = px_i;
                            self.data[FIELD_POS_Z * MAX_AGENTS + i] = pz_i;
                            self.data[FIELD_POS_X * MAX_AGENTS + j] = px_j + nx * pen * wj;
                            self.data[FIELD_POS_Z * MAX_AGENTS + j] = pz_j + nz * pen * wj;

                            // Cancel closing velocity component along the contact normal on first pass so
                            // next tick's ORCA constraints begin from a non-penetrating relative velocity.
                            if iter == 0 {
                                let vxi = self.data[FIELD_VEL_X * MAX_AGENTS + i];
                                let vzi = self.data[FIELD_VEL_Z * MAX_AGENTS + i];
                                let vxj = self.data[FIELD_VEL_X * MAX_AGENTS + j];
                                let vzj = self.data[FIELD_VEL_Z * MAX_AGENTS + j];
                                let closing = (vxi - vxj) * nx + (vzi - vzj) * nz;
                                if closing > 0.0 {
                                    self.data[FIELD_VEL_X * MAX_AGENTS + i] = vxi - nx * closing * wi;
                                    self.data[FIELD_VEL_Z * MAX_AGENTS + i] = vzi - nz * closing * wi;
                                    self.data[FIELD_VEL_X * MAX_AGENTS + j] = vxj + nx * closing * wj;
                                    self.data[FIELD_VEL_Z * MAX_AGENTS + j] = vzj + nz * closing * wj;
                                }
                            }
                        }
                    }
                }
            }

            // Clamp every moving agent cleanly outside static wall segments & blocked nav cells.
            if has_obst {
                for i in 0..n {
                    let flags_i = self.data[FIELD_FLAGS * MAX_AGENTS + i] as u32;
                    if (flags_i & (CROWD_FLAG_STATIC | CROWD_FLAG_VEL_ONLY)) != 0 {
                        continue;
                    }
                    let mut pos = Vec2::new(
                        self.data[FIELD_POS_X * MAX_AGENTS + i],
                        self.data[FIELD_POS_Z * MAX_AGENTS + i],
                    );
                    let py = self.data[FIELD_POS_Y * MAX_AGENTS + i];
                    let rad = self.data[FIELD_RADIUS * MAX_AGENTS + i].max(0.05);
                    for seg in &self.obstacles {
                        let c = closest_point_on_seg(pos, Vec2::new(seg.ax, seg.az), Vec2::new(seg.bx, seg.bz));
                        let diff = pos.sub(c);
                        let d2 = diff.len_sq();
                        if d2 < rad * rad && d2 > 1e-10 {
                            let d = d2.sqrt();
                            let pen = rad - d + 1e-4;
                            if pen > max_pen {
                                max_pen = pen;
                            }
                            pos = c.add(diff.scale((rad + 1e-4) / d));
                        }
                    }
                    if has_nav && (flags_i & CROWD_FLAG_IGNORE_WORLD) == 0 {
                        if let Some(tiles) = nav_tiles {
                            if clamp_to_nav_tile(tiles, &mut pos, py, rad) {
                                max_pen = max_pen.max(0.1);
                            }
                        }
                    }
                    self.data[FIELD_POS_X * MAX_AGENTS + i] = pos.x;
                    self.data[FIELD_POS_Z * MAX_AGENTS + i] = pos.y;
                }
            }

            if max_pen < 0.005 {
                break;
            }
        }
    }
}

#[inline]
fn hash_cell(gx: i32, gz: i32) -> usize {
    let h = (gx as u32).wrapping_mul(73856093) ^ (gz as u32).wrapping_mul(19349663);
    (h as usize) & GRID_MASK
}

#[inline]
fn closest_point_on_seg(p: Vec2, a: Vec2, b: Vec2) -> Vec2 {
    let ab = b.sub(a);
    let len_sq = ab.len_sq();
    if len_sq < 1e-8 {
        return a;
    }
    let t = (p.sub(a).dot(ab) / len_sq).clamp(0.0, 1.0);
    a.add(ab.scale(t))
}

/// Emits a static ORCA half-plane preventing agent at `pos` with `radius` from hitting segment `a -> b`.
#[allow(clippy::too_many_arguments)]
fn push_segment_orca(
    lines: &mut Vec<Line>,
    pos: Vec2,
    vel: Vec2,
    pref: Vec2,
    radius: f32,
    a: Vec2,
    b: Vec2,
    inv_tau_obs: f32,
    inv_dt: f32,
) {
    let ab = b.sub(a);
    let len_sq = ab.len_sq();
    let t = if len_sq < 1e-8 {
        0.0
    } else {
        (pos.sub(a).dot(ab) / len_sq).clamp(0.0, 1.0)
    };
    let c = a.add(ab.scale(t));
    let diff = pos.sub(c); // points from obstacle toward agent
    let d2 = diff.len_sq();
    let check_r = radius * 3.0 + 3.0;
    if d2 > check_r * check_r {
        return;
    }

    let d = d2.sqrt();
    let n = if d > 1e-6 {
        diff.scale(1.0 / d)
    } else {
        let l = len_sq.sqrt().max(1e-6);
        Vec2::new(-ab.y / l, ab.x / l)
    };
    let cut_dir = Vec2::new(n.y, -n.x);
    let min_v_n = if d > radius {
        -(d - radius) * inv_tau_obs
    } else {
        (radius - d + 1e-3) * inv_dt
    };
    let cut_line = Line { point: n.scale(min_v_n), dir: cut_dir };

    // At segment endpoints (e.g., doorway jambs) when outside the capsule (`d > radius`),
    // a tangent leg of the velocity obstacle cone is globally valid for the whole convex
    // capsule whenever its tangent point lies on the endpoint's outer semicircle. Choosing
    // the leg over the flat cutoff plane when it gives `pref` more clearance lets agents
    // glide past door jambs at full speed instead of artificially braking against `-n`.
    let at_a = t <= 1e-5;
    let at_b = t >= 1.0 - 1e-5 && len_sq >= 1e-8;
    if d > radius && (at_a || at_b) {
        let target_v = if pref.len_sq() > 1e-6 { pref } else { vel };
        if target_v.len_sq() > 1e-6 {
            let rel = c.sub(pos); // points from agent toward endpoint
            let leg = (d2 - radius * radius).max(0.0).sqrt();
            let inv_d2 = 1.0 / d2;
            let (ray, leg_dir) = if rel.det(target_v) > 0.0 {
                // Left tangent ray (feasible half-space is left of `+ray`).
                let ray = Vec2::new(
                    rel.x * leg - rel.y * radius,
                    rel.x * radius + rel.y * leg,
                )
                .scale(inv_d2);
                (ray, ray)
            } else {
                // Right tangent ray (feasible half-space is left of `-ray`).
                let ray = Vec2::new(
                    rel.x * leg + rel.y * radius,
                    -rel.x * radius + rel.y * leg,
                )
                .scale(inv_d2);
                (ray, ray.scale(-1.0))
            };
            // Verify tangent point `p_tan = pos + ray * leg` lies on the outer semicircle of `c`
            // so the tangent line strictly separates the entire wall capsule `a -> b`.
            let tan_from_c = ray.scale(leg).sub(rel);
            let inward = if at_a { ab } else { ab.scale(-1.0) };
            if tan_from_c.dot(inward) <= 1e-4 {
                let cut_clear = cut_dir.det(target_v.sub(cut_line.point));
                let leg_clear = leg_dir.det(target_v);
                if cut_clear < 0.0 && leg_clear > cut_clear {
                    lines.push(Line { point: Vec2::default(), dir: leg_dir });
                    return;
                }
            }
        }
    }

    lines.push(cut_line);
}

/// Emits static ORCA half-planes for any blocked/crater cardinal neighbor around the agent's cached `NavTile` column.
fn push_nav_tile_obstacles(
    lines: &mut Vec<Line>,
    cache: &TileCache,
    pos: Vec2,
    py: f32,
    radius: f32,
    inv_tau_obs: f32,
    inv_dt: f32,
) {
    let ix = pos.x.floor() as i32;
    let iy = py.round() as i32;
    let iz = pos.y.floor() as i32;
    let tx = world_to_tile(ix);
    let tz = world_to_tile(iz);
    let Some(tile) = cache.get((tx, tz)) else { return };
    let cx = world_to_col(ix);
    let cz = world_to_col(iz);
    let Some(span_idx) = tile.nearest_span_in_col(cx, cz, iy, 20) else { return };

    // Determine which of the 4 cardinal directions have a valid `MOVE_WALK` exit from `span_idx`.
    let mut open_dir = [false; 4];
    for e in tile.span_edges(span_idx) {
        if e.move_kind == MOVE_WALK && (e.dir as usize) < 4 {
            open_dir[e.dir as usize] = true;
        }
    }
    let on_border = [cx == TILE_COLS - 1, cx == 0, cz == TILE_COLS - 1, cz == 0];
    for d in 0..4usize {
        if !open_dir[d] && on_border[d] {
            let (ox, oz) = DIR_OFFSETS[d];
            if cache.get((tx + ox, tz + oz)).is_none() {
                // Unbaked neighbor tile is unknown, not a solid wall.
                open_dir[d] = true;
            } else if tile.border_links[d].iter().any(|&(fs, _, mk)| fs == span_idx && mk == MOVE_WALK) {
                open_dir[d] = true;
            }
        }
    }

    let x0 = (tx * TILE_CELLS + cx as i32 * NAV_STEP) as f32;
    let x1 = x0 + NAV_STEP as f32;
    let z0 = (tz * TILE_CELLS + cz as i32 * NAV_STEP) as f32;
    let z1 = z0 + NAV_STEP as f32;
    // Clamp wall standoff slightly under half-column width so narrow 1-column corridors stay traversable.
    let eff_r = radius.min(NAV_STEP as f32 * 0.45);

    // 0: +X wall at x1 (normal -X), 1: -X wall at x0 (normal +X),
    // 2: +Z wall at z1 (normal -Z), 3: -Z wall at z0 (normal +Z).
    let walls: [(bool, Vec2, f32); 4] = [
        (!open_dir[0], Vec2::new(-1.0, 0.0), x1 - pos.x),
        (!open_dir[1], Vec2::new(1.0, 0.0), pos.x - x0),
        (!open_dir[2], Vec2::new(0.0, -1.0), z1 - pos.y),
        (!open_dir[3], Vec2::new(0.0, 1.0), pos.y - z0),
    ];
    for &(blocked, n, dist) in &walls {
        if !blocked || dist > eff_r * 3.0 + 4.0 {
            continue;
        }
        let dir = Vec2::new(n.y, -n.x);
        let min_v_n = if dist > eff_r {
            -(dist - eff_r) * inv_tau_obs
        } else {
            (eff_r - dist + 1e-3) * inv_dt
        };
        lines.push(Line { point: n.scale(min_v_n), dir });
    }
}

/// Keeps `pos` from penetrating a blocked/crater cardinal edge of its cached `NavTile` column.
fn clamp_to_nav_tile(cache: &TileCache, pos: &mut Vec2, py: f32, radius: f32) -> bool {
    let ix = pos.x.floor() as i32;
    let iy = py.round() as i32;
    let iz = pos.y.floor() as i32;
    let tx = world_to_tile(ix);
    let tz = world_to_tile(iz);
    let Some(tile) = cache.get((tx, tz)) else { return false };
    let cx = world_to_col(ix);
    let cz = world_to_col(iz);
    let Some(span_idx) = tile.nearest_span_in_col(cx, cz, iy, 20) else { return false };

    let mut open_dir = [false; 4];
    for e in tile.span_edges(span_idx) {
        if e.move_kind == MOVE_WALK && (e.dir as usize) < 4 {
            open_dir[e.dir as usize] = true;
        }
    }
    let on_border = [cx == TILE_COLS - 1, cx == 0, cz == TILE_COLS - 1, cz == 0];
    for d in 0..4usize {
        if !open_dir[d] && on_border[d] {
            let (ox, oz) = DIR_OFFSETS[d];
            if cache.get((tx + ox, tz + oz)).is_none()
                || tile.border_links[d].iter().any(|&(fs, _, mk)| fs == span_idx && mk == MOVE_WALK)
            {
                open_dir[d] = true;
            }
        }
    }

    let x0 = (tx * TILE_CELLS + cx as i32 * NAV_STEP) as f32;
    let x1 = x0 + NAV_STEP as f32;
    let z0 = (tz * TILE_CELLS + cz as i32 * NAV_STEP) as f32;
    let z1 = z0 + NAV_STEP as f32;
    let eff_r = radius.min(NAV_STEP as f32 * 0.45);
    let mut moved = false;

    if !open_dir[0] && pos.x > x1 - eff_r {
        pos.x = x1 - eff_r;
        moved = true;
    }
    if !open_dir[1] && pos.x < x0 + eff_r {
        pos.x = x0 + eff_r;
        moved = true;
    }
    if !open_dir[2] && pos.y > z1 - eff_r {
        pos.y = z1 - eff_r;
        moved = true;
    }
    if !open_dir[3] && pos.y < z0 + eff_r {
        pos.y = z0 + eff_r;
        moved = true;
    }
    moved
}

// ── Textbook van den Berg (2011) RVO2 / ORCA 2D Linear Program Solver ────────

/// Solves a 1D linear program on `lines[line_no]` subject to `lines[0..line_no]` and `|v| <= radius`.
fn linear_program1(
    lines: &[Line],
    line_no: usize,
    radius: f32,
    opt_vel: Vec2,
    direction_opt: bool,
    result: &mut Vec2,
) -> bool {
    let line = lines[line_no];
    let dot_prod = line.point.dot(line.dir);
    let discriminant = dot_prod * dot_prod + radius * radius - line.point.len_sq();
    if discriminant < 0.0 {
        return false;
    }
    let sqrt_disc = discriminant.sqrt();
    let mut t_left = -dot_prod - sqrt_disc;
    let mut t_right = -dot_prod + sqrt_disc;

    for prev in &lines[..line_no] {
        let denom = line.dir.det(prev.dir);
        let numer = prev.dir.det(line.point.sub(prev.point));
        if denom.abs() <= RVO_EPSILON {
            if numer < 0.0 {
                return false;
            }
            continue;
        }
        let t = numer / denom;
        if denom >= 0.0 {
            t_right = t_right.min(t);
        } else {
            t_left = t_left.max(t);
        }
        if t_left > t_right {
            return false;
        }
    }

    let t = if direction_opt {
        if opt_vel.dot(line.dir) > 0.0 { t_right } else { t_left }
    } else {
        opt_vel.sub(line.point).dot(line.dir).clamp(t_left, t_right)
    };
    *result = line.point.add(line.dir.scale(t));
    true
}

/// Solves the 2D linear program over all `lines`. Returns `lines.len()` on success, or the first
/// infeasible constraint index on failure.
fn linear_program2(
    lines: &[Line],
    radius: f32,
    opt_vel: Vec2,
    direction_opt: bool,
    result: &mut Vec2,
) -> usize {
    if direction_opt {
        *result = opt_vel.scale(radius);
    } else if opt_vel.len_sq() > radius * radius {
        let l = opt_vel.len().max(1e-8);
        *result = opt_vel.scale(radius / l);
    } else {
        *result = opt_vel;
    }

    for i in 0..lines.len() {
        if lines[i].dir.det(lines[i].point.sub(*result)) > 0.0 {
            let temp = *result;
            if !linear_program1(lines, i, radius, opt_vel, direction_opt, result) {
                *result = temp;
                return i;
            }
        }
    }
    lines.len()
}

/// Safe fallback when `linear_program2` is infeasible (e.g., dense crowd packed into a narrow
/// doorway): finds the velocity minimizing the maximum constraint penetration while strictly
/// preserving static obstacle constraints `0..num_obst_lines`.
fn linear_program3(
    lines: &[Line],
    num_obst_lines: usize,
    begin_line: usize,
    radius: f32,
    result: &mut Vec2,
    proj_lines: &mut Vec<Line>,
) {
    let mut distance = 0.0f32;
    for i in begin_line..lines.len() {
        if lines[i].dir.det(lines[i].point.sub(*result)) > distance {
            proj_lines.clear();
            proj_lines.extend_from_slice(&lines[..num_obst_lines]);

            for j in num_obst_lines..i {
                let det = lines[i].dir.det(lines[j].dir);
                let point = if det.abs() <= RVO_EPSILON {
                    if lines[i].dir.dot(lines[j].dir) > 0.0 {
                        // Same direction: line j is redundant with line i.
                        continue;
                    } else {
                        // Opposite direction: midpoint between the two parallel constraints.
                        lines[i].point.add(lines[j].point).scale(0.5)
                    }
                } else {
                    let s = lines[j].dir.det(lines[i].point.sub(lines[j].point)) / det;
                    lines[i].point.add(lines[i].dir.scale(s))
                };
                let diff_dir = lines[j].dir.sub(lines[i].dir);
                let dl = diff_dir.len();
                if dl <= RVO_EPSILON {
                    continue;
                }
                proj_lines.push(Line { point, dir: diff_dir.scale(1.0 / dl) });
            }

            let temp = *result;
            let opt_dir = Vec2::new(-lines[i].dir.y, lines[i].dir.x);
            if linear_program2(proj_lines, radius, opt_dir, true, result) < proj_lines.len() {
                *result = temp;
            }
            distance = lines[i].dir.det(lines[i].point.sub(*result));
        }
    }
}
