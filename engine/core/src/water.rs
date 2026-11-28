//! Water that flows (#140). Not cells: a tank of cells emptying would be a hundred thousand edits a second where a
//! burning house is a few hundred, and every edit is a sector made again and a tile of the sun's maps spoiled.
//! Flowing water is a depth over each column of a window of the world, two cells to a column, and it moves from
//! column to column by how much higher its top stands than its neighbour's (pipes between columns, each with the
//! flow it had and what the height between its ends adds). What it flows over is the world as it stands: a floor
//! is looked for where the water arrives, and looked for again where the world has changed, so a wall keeps it
//! in and a hole lets it out. The still sea stays a plane (city.rs); water that reaches it is the sea's.
//!
//! Where it comes from is the town's own: the tank of a yard's water tower holds forty cubic metres, and lets it
//! out through whatever holes are made in it, faster the deeper the hole is under what is left.
//!
//! Lengths are in the finest cells (10 cm), times in seconds. Told to the page as heights (FLOW, bodies.rs).

use crate::bodies::{Bodies, FLOW, Ground};
use crate::city;
use crate::kinds::{material, weighs};
use crate::tree::Kind;

/// Cells a column is wide.
pub const COL: i32 = 2;
/// Columns each way in the window: 77 m.
pub const N: usize = 384;
/// One step of the flow, seconds.
const TICK: f32 = 1.0 / 60.0;
const G: f32 = 98.0;
/// Seawater density relative to fresh water (`kinds::weighs` uses fresh water = 1.0):
/// wood (0.6), leaves (0.15) and grass (1.0) float; earth/masonry/steel (1.6..7.8) sink unless supported by enclosed hull air.
pub const RHO_WATER: f32 = 1.025;
/// Minimum shallow-water depth (in cells) that extinguishes fire.
pub const EXTINGUISH_DEPTH: f32 = 0.05;
/// Hydrodynamic drag constants in cell units (10 cm cells, `G = 98`).
const DRAG_QUAD: f32 = 1.1;
const DRAG_LIN: f32 = 3.5;
const MAX_LIN_DAMP_RATE: f32 = 40.0;
const ANG_DAMP_LIN: f32 = 4.5;
const ANG_DAMP_QUAD: f32 = 0.35;
const MAX_ANG_DAMP_RATE: f32 = 30.0;
const MAX_FLOW_SPEED: f32 = 200.0;
/// Maximum sampled cells per body for buoyancy so large bodies stay well under 0.05 ms.
const BUOYANCY_MAX_SAMPLES: usize = 512;

/// Hydrodynamic buoyancy, righting torque and drag computed for one rigid body against sea and shallow water.
#[derive(Debug, Clone, Copy, Default)]
pub struct BuoyancyResult {
    pub force: [f32; 3],
    pub torque: [f32; 3],
    pub submerged_cells: usize,
    pub submerged_ratio: f32,
    pub water_contact_pos: [f32; 3],
}

#[inline]
fn v_add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] { [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
#[inline]
fn v_sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] { [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
#[inline]
fn v_scale(a: [f32; 3], k: f32) -> [f32; 3] { [a[0] * k, a[1] * k, a[2] * k] }
#[inline]
fn v_dot(a: [f32; 3], b: [f32; 3]) -> f32 { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
#[inline]
fn v_cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
#[inline]
fn q_turn(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let u = [q[0], q[1], q[2]];
    let t = v_scale(v_cross(u, v), 2.0);
    v_add(v_add(v, v_scale(t, q[3])), v_cross(u, t))
}
#[inline]
fn rot_basis(rot: [f32; 4]) -> ([f32; 3], [f32; 3], [f32; 3]) {
    let len2 = rot[0] * rot[0] + rot[1] * rot[1] + rot[2] * rot[2] + rot[3] * rot[3];
    let q = if len2 > 1e-12 {
        let inv = 1.0 / len2.sqrt();
        [rot[0] * inv, rot[1] * inv, rot[2] * inv, rot[3] * inv]
    } else {
        [0.0, 0.0, 0.0, 1.0]
    };
    (q_turn(q, [1.0, 0.0, 0.0]), q_turn(q, [0.0, 1.0, 0.0]), q_turn(q, [0.0, 0.0, 1.0]))
}

/// Choose per-axis sample counts `(nx, ny, nz)` so total visited cells stay within `max_samples`.
fn stride_counts(size: [usize; 3], max_samples: usize) -> [usize; 3] {
    let total = size[0].saturating_mul(size[1]).saturating_mul(size[2]);
    if total <= max_samples {
        return size;
    }
    let scale = (max_samples as f32 / total as f32).cbrt();
    let mut n = [
        ((size[0] as f32 * scale).round() as usize).clamp(1, size[0]),
        ((size[1] as f32 * scale).round() as usize).clamp(1, size[1]),
        ((size[2] as f32 * scale).round() as usize).clamp(1, size[2]),
    ];
    while n[0] * n[1] * n[2] > max_samples {
        let max_axis = (0..3).max_by_key(|&a| n[a]).unwrap();
        if n[max_axis] <= 1 {
            break;
        }
        n[max_axis] -= 1;
    }
    n
}
/// A tank's inside: how far from its middle to its wall, and how high.
const TANK_R: i32 = 18;
const TANK_HIGH: i32 = 42;
/// Water thinner than this on a column is gone: it has soaked in or dried.
const FILM: f32 = 0.04;
/// How fast standing water sinks away, cells a second.
const SOAKS: f32 = 0.004;
/// Water less than this far over a hole in a tank does not come out of it: the last of it would dribble for minutes.
const DRIBBLE: f32 = 0.5;

struct Tank {
    /// The middle of its floor, inside.
    at: [i32; 3],
    /// Cells of water left in it.
    left: f32,
    /// Holes in it: where the water comes out (a column of the window), how high over the tank's floor, how wide.
    holes: Vec<(usize, f32, f32)>,
}

#[derive(Default)]
pub struct Water {
    /// The world's cell at the window's low corner.
    low: [i32; 2],
    floor: Vec<f32>,
    depth: Vec<f32>,
    /// What leaves each column a second, to +x, -x, +z, -z.
    flux: Vec<[f32; 4]>,
    known: Vec<bool>,
    listed: Vec<bool>,
    wet: Vec<u32>,
    tanks: Vec<Tank>,
    owed: f32,
    /// Seconds since it was last told, and since anything moved.
    untold: f32,
    still: f32,
    awake: bool,
    /// Cells of water that have left: out of the window or into the sea, and soaked away. For measuring.
    pub sunk: f32,
    pub soaked: f32,
    pub steps: u32,
    /// What `flow` has cost, in all and at worst, ms: for the test.
    #[cfg(test)]
    pub spent: (f32, f32),
}

/// Where a floor is at a column, looked for from a height: the lowest free cell with something solid under it, at
/// or below `from`; or, if `from` is inside something, the first free cell over it.
fn floor_at(ground: &mut Ground, x: i32, z: i32, from: i32) -> f32 {
    let mut y = from;
    if ground.solid(x, y, z) {
        let top = y + 80;
        while y < top && ground.solid(x, y, z) {
            y += 1;
        }
        return y as f32;
    }
    let least = y - 600;
    while y > least && !ground.solid(x, y - 1, z) {
        y -= 1;
    }
    y as f32
}

impl Water {
    /// How many columns have water on them.
    pub fn wet(&self) -> usize {
        self.wet.len()
    }

    /// Whether it is moving, or may: the page keeps asking for time while it is.
    pub fn flowing(&self) -> bool {
        self.awake
    }

    /// Cells of water on the ground, and left in tanks.
    pub fn held(&self) -> (f32, f32) {
        (self.wet.iter().map(|&i| self.depth[i as usize]).sum::<f32>() * (COL * COL) as f32, self.tanks.iter().map(|t| t.left).sum())
    }

    #[inline]
    fn column_at(&self, x: f32, z: f32) -> Option<usize> {
        if self.floor.is_empty() {
            return None;
        }
        let cx = (x.floor() as i32 - self.low[0]).div_euclid(COL);
        let cz = (z.floor() as i32 - self.low[1]).div_euclid(COL);
        if cx < 0 || cz < 0 || cx >= N as i32 || cz >= N as i32 {
            None
        } else {
            Some(cx as usize + N * cz as usize)
        }
    }

    #[inline]
    fn column_flow(&self, idx: usize) -> [f32; 2] {
        let d = self.depth[idx];
        if d <= FILM {
            return [0.0, 0.0];
        }
        let (cx, cz) = (idx % N, idx / N);
        let f = self.flux[idx];
        let in_xm = if cx > 0 { self.flux[idx - 1][0] } else { f[0] };
        let in_xp = if cx + 1 < N { self.flux[idx + 1][1] } else { f[1] };
        let in_zm = if cz > 0 { self.flux[idx - N][2] } else { f[2] };
        let in_zp = if cz + 1 < N { self.flux[idx + N][3] } else { f[3] };
        let qx = 0.5 * (in_xm + f[0] - f[1] - in_xp);
        let qz = 0.5 * (in_zm + f[2] - f[3] - in_zp);
        let denom = d.max(0.1) * COL as f32;
        let (mut vx, mut vz) = (qx / denom, qz / denom);
        let spd2 = vx * vx + vz * vz;
        if spd2 > MAX_FLOW_SPEED * MAX_FLOW_SPEED {
            let k = MAX_FLOW_SPEED / spd2.sqrt();
            vx *= k;
            vz *= k;
        }
        [vx, vz]
    }

    /// Shallow-water floor height, depth (cells), and horizontal flow velocity `(vx, vz)` at world `(x, z)`.
    #[inline]
    pub fn shallow_at(&self, x: f32, z: f32) -> Option<(f32, f32, [f32; 2])> {
        let idx = self.column_at(x, z)?;
        let d = self.depth[idx];
        if d <= FILM {
            return None;
        }
        Some((self.floor[idx], d, self.column_flow(idx)))
    }

    /// Shallow-water depth (in cells) at world `(x, z)`, or `0.0` when dry or outside the window.
    #[inline]
    pub fn depth_at(&self, x: f32, z: f32) -> f32 {
        self.column_at(x, z).map_or(0.0, |i| self.depth[i])
    }

    /// Water surface height `water_surface_y` and horizontal flow velocity `[vx, vz]` (cells/s) at world `(x, z)`,
    /// combining the 2.5D shallow-water window and an optional global sea plane.
    pub fn surface_at(&self, x: f32, z: f32, sea_level: Option<f32>) -> Option<(f32, [f32; 2])> {
        let shallow = self.shallow_at(x, z).map(|(floor, d, flow)| (floor + d, flow));
        match (shallow, sea_level) {
            (Some((top, flow)), Some(sea)) => {
                if top >= sea { Some((top, flow)) } else { Some((sea, [0.0, 0.0])) }
            }
            (Some(s), None) => Some(s),
            (None, Some(sea)) => Some((sea, [0.0, 0.0])),
            (None, None) => None,
        }
    }

    /// Whether a 1-cell voxel centered at `(x, y, z)` is submerged below `sea_level` or touched by
    /// shallow water deeper than `EXTINGUISH_DEPTH` (0.05 cells) without false-matching roofs far above.
    #[inline]
    pub fn touches(&self, x: f32, y: f32, z: f32, sea_level: Option<f32>) -> bool {
        if let Some(sea) = sea_level {
            if y - 0.5 < sea {
                return true;
            }
        }
        if let Some((floor, depth, _)) = self.shallow_at(x, z) {
            if depth > EXTINGUISH_DEPTH && y - 0.5 < floor + depth && y + 0.5 >= floor - 0.5 {
                return true;
            }
        }
        false
    }

    /// Test helper: opens the shallow-water window around `(x, z)` if needed and seeds one column with
    /// explicit `floor`, `depth`, and horizontal `flow_vel` (cells/s).
    #[cfg(test)]
    pub(crate) fn seed_column(&mut self, x: i32, z: i32, floor: f32, depth: f32, flow_vel: [f32; 2]) {
        if self.floor.is_empty() {
            self.open([x, z]);
        }
        let Some(idx) = self.column_at(x as f32 + 0.5, z as f32 + 0.5) else { return };
        self.floor[idx] = floor;
        self.depth[idx] = depth.max(0.0);
        self.known[idx] = true;
        let scale = self.depth[idx].max(0.1) * COL as f32;
        let qx = flow_vel[0] * scale;
        let qz = flow_vel[1] * scale;
        self.flux[idx] = [qx.max(0.0), (-qx).max(0.0), qz.max(0.0), (-qz).max(0.0)];
        if self.depth[idx] > 0.0 && !self.listed[idx] {
            self.listed[idx] = true;
            self.wet.push(idx as u32);
        }
    }

    /// Computes per-submerged-cell buoyancy force, center-of-buoyancy righting torque, flow-current push,
    /// and quadratic linear/angular water drag for a rigid body against both `sea_level` and shallow water.
    ///
    /// Samples solid cells cleanly (striding large bodies to stay well under 0.05 ms/body).
    /// `enclosed_hull_air_cells` adds trapped-air buoyancy when upright (flooding smoothly as the body capsizes).
    #[allow(clippy::too_many_arguments)]
    pub fn compute_buoyancy(
        &self,
        pos: [f32; 3],
        rot: [f32; 4],
        com: [f32; 3],
        size: [usize; 3],
        cells: &[Kind],
        vel: [f32; 3],
        spin: [f32; 3],
        sea_level: Option<f32>,
        enclosed_hull_air_cells: usize,
    ) -> BuoyancyResult {
        let total_grid = size[0].saturating_mul(size[1]).saturating_mul(size[2]);
        if total_grid == 0 || cells.len() < total_grid || (sea_level.is_none() && self.floor.is_empty()) {
            return BuoyancyResult::default();
        }

        // Fast dry-body early out when only the global sea plane is active.
        if self.floor.is_empty() {
            if let Some(sea) = sea_level {
                let rx = com[0].max(size[0] as f32 - com[0]);
                let ry = com[1].max(size[1] as f32 - com[1]);
                let rz = com[2].max(size[2] as f32 - com[2]);
                let r_bound = (rx * rx + ry * ry + rz * rz).sqrt();
                if pos[1] - r_bound > sea + 1.0 {
                    return BuoyancyResult::default();
                }
            }
        }

        let (ex, ey, ez) = rot_basis(rot);
        let samples = stride_counts(size, BUOYANCY_MAX_SAMPLES);
        let step = [
            size[0] as f32 / samples[0] as f32,
            size[1] as f32 / samples[1] as f32,
            size[2] as f32 / samples[2] as f32,
        ];
        let cell_weight = step[0] * step[1] * step[2];
        let half_h = 0.5 * (ex[1].abs() * step[0] + ey[1].abs() * step[1] + ez[1].abs() * step[2]).max(1.0);
        let span_h = 2.0 * half_h;
        let has_shallow = !self.floor.is_empty();

        // Precompute per-axis cell indices and centered local offsets (symmetric around body center).
        let mut xs = [(0usize, 0.0f32); BUOYANCY_MAX_SAMPLES];
        let mut ys = [(0usize, 0.0f32); BUOYANCY_MAX_SAMPLES];
        let mut zs = [(0usize, 0.0f32); BUOYANCY_MAX_SAMPLES];
        for k in 0..samples[0] {
            let ix = ((k * size[0] + size[0] / 2) / samples[0]).min(size[0] - 1);
            xs[k] = (ix, (k as f32 + 0.5) * step[0] - com[0]);
        }
        for k in 0..samples[1] {
            let iy = ((k * size[1] + size[1] / 2) / samples[1]).min(size[1] - 1);
            ys[k] = (iy, (k as f32 + 0.5) * step[1] - com[1]);
        }
        for k in 0..samples[2] {
            let iz = ((k * size[2] + size[2] / 2) / samples[2]).min(size[2] - 1);
            zs[k] = (iz, (k as f32 + 0.5) * step[2] - com[2]);
        }

        let mut total_solid_w = 0.0f32;
        let mut total_mass_w = 0.0f32;
        let mut r2_sum_w = 0.0f32;
        let mut sub_vol_w = 0.0f32;
        let mut buoy_force_y = 0.0f32;
        let mut buoy_torque = [0.0f32; 3];
        let mut drag_force_raw = [0.0f32; 3];
        let mut drag_torque_raw = [0.0f32; 3];
        let mut contact_sum = [0.0f32; 3];
        let mut v_rel_sum = [0.0f32; 3];

        for &(iy, ly) in &ys[..samples[1]] {
            let y_base = iy * size[2];
            let ry_vec = v_scale(ey, ly);
            for &(iz, lz) in &zs[..samples[2]] {
                let row_base = (y_base + iz) * size[0];
                let ryz_vec = v_add(ry_vec, v_scale(ez, lz));
                for &(ix, lx) in &xs[..samples[0]] {
                    let kind = cells[row_base + ix];
                    if kind == 0 {
                        continue;
                    }
                    let r_world = v_add(ryz_vec, v_scale(ex, lx));
                    total_solid_w += cell_weight;
                    total_mass_w += weighs(material(kind)) * cell_weight;
                    r2_sum_w += v_dot(r_world, r_world) * cell_weight;

                    let wx = pos[0] + r_world[0];
                    let wy = pos[1] + r_world[1];
                    let wz = pos[2] + r_world[2];
                    let bot = wy - half_h;

                    // Determine active water surface and submergence fraction for this cell.
                    let mut sub = 0.0f32;
                    let mut flow = [0.0f32; 2];
                    let mut active_y = f32::NEG_INFINITY;

                    if let Some(sea) = sea_level {
                        if bot < sea {
                            sub = ((sea - bot) / span_h).clamp(0.0, 1.0);
                            active_y = sea;
                        }
                    }
                    if has_shallow {
                        if let Some((floor, depth, sflow)) = self.shallow_at(wx, wz) {
                            let top = floor + depth;
                            if top >= active_y && bot < top && wy + half_h >= floor - 2.0 {
                                let shallow_sub = ((top - bot) / span_h).clamp(0.0, (depth / span_h).min(1.0));
                                if shallow_sub > 0.0 {
                                    sub = shallow_sub;
                                    flow = sflow;
                                }
                            }
                        }
                    }

                    if sub <= 0.0 {
                        continue;
                    }

                    let v_eff = sub * cell_weight;
                    sub_vol_w += v_eff;
                    contact_sum = v_add(contact_sum, v_scale([wx, wy, wz], v_eff));

                    // Displaced water buoyancy force and torque about center of mass.
                    let f_buoy_y = RHO_WATER * G * v_eff;
                    buoy_force_y += f_buoy_y;
                    // r_world x [0, f_buoy_y, 0] = [-r_world[2] * f_buoy_y, 0, r_world[0] * f_buoy_y]
                    buoy_torque[0] -= r_world[2] * f_buoy_y;
                    buoy_torque[2] += r_world[0] * f_buoy_y;

                    // Local point velocity relative to water current.
                    let v_cell = v_add(vel, v_cross(spin, r_world));
                    let v_rel = [v_cell[0] - flow[0], v_cell[1], v_cell[2] - flow[1]];
                    v_rel_sum = v_add(v_rel_sum, v_scale(v_rel, v_eff));
                    let v_mag = v_dot(v_rel, v_rel).sqrt();
                    let drag_coeff = v_eff * RHO_WATER * (0.5 * DRAG_QUAD * v_mag + DRAG_LIN);
                    let f_drag = v_scale(v_rel, -drag_coeff);
                    drag_force_raw = v_add(drag_force_raw, f_drag);
                    drag_torque_raw = v_add(drag_torque_raw, v_cross(r_world, f_drag));
                }
            }
        }

        if total_solid_w <= 0.0 || sub_vol_w <= 0.0 {
            return BuoyancyResult::default();
        }

        let submerged_ratio = (sub_vol_w / total_solid_w).clamp(0.0, 1.0);
        let water_contact_pos = v_scale(contact_sum, 1.0 / sub_vol_w);
        let total_mass = total_mass_w.max(0.1);
        let l_char = total_solid_w.cbrt().max(1.0);
        let area_per_cell = 1.0 / l_char;

        // Enclosed hull air (e.g. hollow car cabin): supports heavy metal/glass hulls when upright,
        // and floods smoothly as the body tilts past ~60 deg or flips upside down.
        if enclosed_hull_air_cells > 0 {
            let air_retention = (ey[1] / 0.5).clamp(0.0, 1.0);
            if air_retention > 0.0 {
                let air_buoy_y = RHO_WATER * G * (enclosed_hull_air_cells as f32) * submerged_ratio * air_retention;
                buoy_force_y += air_buoy_y;
                let r_cb = v_sub(water_contact_pos, pos);
                buoy_torque[0] -= r_cb[2] * air_buoy_y;
                buoy_torque[2] += r_cb[0] * air_buoy_y;
            }
        }

        // Scale drag by surface-to-volume ratio and clamp for unconditional explicit-step stability.
        let mut drag_force = v_scale(drag_force_raw, area_per_cell);
        let v_rel_avg = v_scale(v_rel_sum, 1.0 / sub_vol_w);
        let v_rel_mag = v_dot(v_rel_avg, v_rel_avg).sqrt();
        let drag_mag = v_dot(drag_force, drag_force).sqrt();
        let max_drag = total_mass * MAX_LIN_DAMP_RATE * v_rel_mag.max(1e-3);
        if drag_mag > max_drag && drag_mag > 1e-6 {
            drag_force = v_scale(drag_force, max_drag / drag_mag);
        }

        // Rotational water drag from per-cell drag plus explicit angular damping proportional to submerged_ratio.
        let i_est = (total_mass * (r2_sum_w / total_solid_w + 1.0 / 6.0)).max(total_mass * 0.25);
        let spin_mag = v_dot(spin, spin).sqrt();
        let mut drag_torque = v_scale(drag_torque_raw, area_per_cell);
        if spin_mag > 1e-6 {
            let ang_rate = (submerged_ratio * (ANG_DAMP_LIN + ANG_DAMP_QUAD * spin_mag * l_char)).min(MAX_ANG_DAMP_RATE);
            drag_torque = v_add(drag_torque, v_scale(spin, -ang_rate * i_est));
            let dtq_mag = v_dot(drag_torque, drag_torque).sqrt();
            let max_ang = MAX_ANG_DAMP_RATE * i_est * spin_mag;
            if dtq_mag > max_ang && dtq_mag > 1e-6 {
                drag_torque = v_scale(drag_torque, max_ang / dtq_mag);
            }
        }

        let submerged_cells = (sub_vol_w.round() as usize).clamp(1, total_solid_w.round().max(1.0) as usize);
        BuoyancyResult {
            force: [drag_force[0], buoy_force_y + drag_force[1], drag_force[2]],
            torque: v_add(buoy_torque, drag_torque),
            submerged_cells,
            submerged_ratio,
            water_contact_pos,
        }
    }

    fn open(&mut self, mid: [i32; 2]) {
        let half = N as i32 * COL / 2;
        self.low = [(mid[0] - half).div_euclid(COL) * COL, (mid[1] - half).div_euclid(COL) * COL];
        self.floor = vec![0.0; N * N];
        self.depth = vec![0.0; N * N];
        self.flux = vec![[0.0; 4]; N * N];
        self.known = vec![false; N * N];
        self.listed = vec![false; N * N];
        self.wet.clear();
    }

    fn column(&self, x: i32, z: i32) -> Option<usize> {
        let (cx, cz) = ((x - self.low[0]).div_euclid(COL), (z - self.low[1]).div_euclid(COL));
        if cx < 1 || cz < 1 || cx >= N as i32 - 1 || cz >= N as i32 - 1 { None } else { Some(cx as usize + N * cz as usize) }
    }

    /// The world changed in a box: a tank there is looked at for holes, and floors there are looked for again.
    fn changed(&mut self, ground: &mut Ground, lo: [i32; 3], hi: [i32; 3]) {
        let mid = [(lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2];
        if let Some(at) = city::tank_near(mid[0], mid[1]) {
            // Within reach of the tank itself, not just in its yard.
            let near = lo[0] <= at[0] + 24 && hi[0] >= at[0] - 24 && lo[2] <= at[2] + 24 && hi[2] >= at[2] - 24 && hi[1] >= at[1] - 4 && lo[1] <= at[1] + TANK_HIGH + 4;
            if near && !self.tanks.iter().any(|t| t.at == at) {
                if self.floor.is_empty() {
                    self.open([at[0], at[2]]);
                }
                self.tanks.push(Tank { at, left: std::f32::consts::PI * (TANK_R * TANK_R * (TANK_HIGH - 2)) as f32, holes: Vec::new() });
            }
        }
        if self.floor.is_empty() {
            return;
        }
        let (x0, x1) = (((lo[0] - self.low[0]).div_euclid(COL)).clamp(0, N as i32) as usize, ((hi[0] - self.low[0]).div_euclid(COL) + 1).clamp(0, N as i32) as usize);
        let (z0, z1) = (((lo[2] - self.low[1]).div_euclid(COL)).clamp(0, N as i32) as usize, ((hi[2] - self.low[1]).div_euclid(COL) + 1).clamp(0, N as i32) as usize);
        // Water lying where the world changed runs again; a tank is looked over again only when the change reaches it.
        // (Asked of every tank on every edit anywhere, a street coming down was thousands of looks at a tank nobody
        // had touched, and water that had come to rest was woken by each.)
        let mut woke = false;
        for cz in z0..z1 {
            for cx in x0..x1 {
                self.known[cx + N * cz] = false;
                woke |= self.listed[cx + N * cz];
            }
        }
        for k in 0..self.tanks.len() {
            let at = self.tanks[k].at;
            if lo[0] <= at[0] + 24 && hi[0] >= at[0] - 24 && lo[2] <= at[2] + 24 && hi[2] >= at[2] - 24 && hi[1] >= at[1] - 4 && lo[1] <= at[1] + TANK_HIGH + 4 {
                self.holes(ground, k);
                woke = true;
            }
        }
        if woke {
            self.awake = true;
            self.still = 0.0;
        }
    }

    /// Looks a tank over for holes: its wall at sixty-four places round, each cell of its height, and its floor.
    fn holes(&mut self, ground: &mut Ground, k: usize) {
        let at = self.tanks[k].at;
        let mut holes = Vec::new();
        if self.tanks[k].left > 0.0 {
            for a in 0..64 {
                let (sin, cos) = (a as f32 * std::f32::consts::TAU / 64.0).sin_cos();
                let (x, z) = (at[0] + ((TANK_R + 1) as f32 * cos).round() as i32, at[2] + ((TANK_R + 1) as f32 * sin).round() as i32);
                let out = self.column(at[0] + ((TANK_R + 5) as f32 * cos).round() as i32, at[2] + ((TANK_R + 5) as f32 * sin).round() as i32);
                let Some(out) = out else { continue };
                for y in 0..TANK_HIGH {
                    if !ground.solid(x, at[1] + y, z) {
                        holes.push((out, y as f32, 1.9));
                    }
                }
            }
            for dz in (-12..=12).step_by(6) {
                for dx in (-12..=12).step_by(6) {
                    if !ground.solid(at[0] + dx, at[1] - 1, at[2] + dz) && !ground.solid(at[0] + dx, at[1] - 2, at[2] + dz) {
                        if let Some(c) = self.column(at[0] + dx, at[2] + dz) {
                            holes.push((c, 0.0, 36.0));
                        }
                    }
                }
            }
        }
        self.tanks[k].holes = holes;
    }

    /// Water onto a column, from a height.
    fn pour(&mut self, ground: &mut Ground, c: usize, cells: f32, from: i32) {
        if !self.known[c] || self.depth[c] <= 0.0 {
            let (x, z) = (self.low[0] + (c % N) as i32 * COL + 1, self.low[1] + (c / N) as i32 * COL + 1);
            self.floor[c] = floor_at(ground, x, z, from);
            self.known[c] = true;
        }
        self.depth[c] += cells / (COL * COL) as f32;
        if !self.listed[c] {
            self.listed[c] = true;
            self.wet.push(c as u32);
        }
    }

    fn step(&mut self, ground: &mut Ground, dt: f32) {
        // What the tanks let out.
        for k in 0..self.tanks.len() {
            let level = self.tanks[k].left / (std::f32::consts::PI * (TANK_R * TANK_R) as f32);
            let holes = std::mem::take(&mut self.tanks[k].holes);
            let at = self.tanks[k].at;
            for &(c, high, wide) in &holes {
                let head = level - high;
                if head <= DRIBBLE || self.tanks[k].left <= 0.0 {
                    continue;
                }
                // Out of a hole as fast as the water over it drives it; half of that gets through a ragged hole.
                let out = (0.5 * wide * (2.0 * G * head).sqrt() * dt).min(self.tanks[k].left);
                self.tanks[k].left -= out;
                self.pour(ground, c, out, at[1] + high as i32);
            }
            self.tanks[k].holes = holes;
        }
        // What leaves each wet column, from where everything stands now.
        let n = self.wet.len();
        let mut moved = 0.0f32;
        for w in 0..n {
            let i = self.wet[w] as usize;
            let (cx, cz) = (i % N, i / N);
            if cx == 0 || cz == 0 || cx == N - 1 || cz == N - 1 || self.floor[i] <= 0.0 {
                // Out of the window, or down at the sea's own level: it is gone.
                self.sunk += self.depth[i] * (COL * COL) as f32;
                self.depth[i] = 0.0;
                self.flux[i] = [0.0; 4];
                continue;
            }
            let h = self.floor[i] + self.depth[i];
            // Thin water drags on what it runs over.
            let drag = 1.0 / (1.0 + dt * 2.5 / self.depth[i].max(0.25));
            let mut out = [0.0f32; 4];
            for (d, j) in [i + 1, i - 1, i + N, i - N].into_iter().enumerate() {
                if !self.known[j] {
                    let (x, z) = (self.low[0] + (j % N) as i32 * COL + 1, self.low[1] + (j / N) as i32 * COL + 1);
                    self.floor[j] = floor_at(ground, x, z, (h + 4.0) as i32);
                    self.known[j] = true;
                }
                let fall = h - (self.floor[j] + self.depth[j]);
                out[d] = (self.flux[i][d] * drag + dt * G * COL as f32 * fall).max(0.0);
            }
            let (all, have) = (out.iter().sum::<f32>() * dt, self.depth[i] * (COL * COL) as f32);
            if all > have {
                let part = have / all;
                out = out.map(|f| f * part);
            }
            self.flux[i] = out;
        }
        for w in 0..n {
            let i = self.wet[w] as usize;
            for (d, j) in [i + 1, i - 1, i + N, i - N].into_iter().enumerate() {
                let v = self.flux[i][d] * dt / (COL * COL) as f32;
                if v <= 0.0 {
                    continue;
                }
                moved += v;
                self.depth[i] -= v;
                self.depth[j] += v;
                if !self.listed[j] {
                    self.listed[j] = true;
                    self.wet.push(j as u32);
                }
            }
        }
        // It soaks away slowly, and a film of it is gone.
        let (depth, flux, listed) = (&mut self.depth, &mut self.flux, &mut self.listed);
        let mut soaked = 0.0;
        self.wet.retain(|&i| {
            let i = i as usize;
            let lost = (SOAKS * dt).min(depth[i]);
            depth[i] -= lost;
            soaked += lost;
            if depth[i] < FILM && flux[i].iter().all(|&f| f < 0.5) {
                soaked += depth[i];
                depth[i] = 0.0;
                flux[i] = [0.0; 4];
                listed[i] = false;
                return false;
            }
            true
        });
        self.soaked += soaked * (COL * COL) as f32;
        // A tank is letting water out while any hole in it is under what is left.
        let leaking = self.tanks.iter().any(|t| {
            let level = t.left / (std::f32::consts::PI * (TANK_R * TANK_R) as f32);
            t.holes.iter().any(|&(_, high, _)| level - high > DRIBBLE)
        });
        self.still = if leaking || moved > 0.02 * self.wet.len().max(1) as f32 * dt { 0.0 } else { self.still + dt };
        self.steps += 1;
    }

    /// What the page is told: the window, then for each column of the box round the wet ones a word: how high the
    /// water's top is over `base` in eighths of a cell (18 bits), how deep in sixteenths (8 bits), how fast it runs
    /// in pairs of cells a second (6 bits). A dry column is 0.
    fn tell(&self) -> Vec<u32> {
        let (mut x0, mut z0, mut x1, mut z1) = (N, N, 0, 0);
        for &i in &self.wet {
            let (cx, cz) = (i as usize % N, i as usize / N);
            (x0, z0, x1, z1) = (x0.min(cx), z0.min(cz), x1.max(cx + 1), z1.max(cz + 1));
        }
        if self.wet.is_empty() {
            (x0, z0, x1, z1) = (0, 0, 0, 0);
        }
        let base = self.tanks.first().map_or(0, |t| city::ground(t.at[0], t.at[2])) - 800;
        let (w, h) = (x1 - x0, z1 - z0);
        let mut words = vec![self.low[0] as u32, self.low[1] as u32, COL as u32, N as u32, base as u32, x0 as u32, z0 as u32, w as u32, h as u32];
        words.resize(9 + w * h, 0);
        for &i in &self.wet {
            let i = i as usize;
            let (cx, cz) = (i % N, i / N);
            let top = ((self.floor[i] + self.depth[i] - base as f32) * 8.0).clamp(1.0, 262143.0) as u32;
            let deep = (self.depth[i] * 16.0).clamp(1.0, 255.0) as u32;
            let f = self.flux[i];
            let fast = (((f[0] - f[1]).hypot(f[2] - f[3]) / (self.depth[i].max(0.1) * COL as f32)) / 2.0).min(63.0) as u32;
            words[9 + (cx - x0) + w * (cz - z0)] = top | deep << 18 | fast << 26;
        }
        words
    }
}

impl Bodies {
    /// Moves the water on by `dt` seconds, and tells the page where it stands twenty times a second while it moves.
    pub(crate) fn flow(&mut self, dt: f32) {
        #[cfg(test)]
        let t0 = std::time::Instant::now();
        self.flowed(dt);
        #[cfg(test)]
        {
            let ms = t0.elapsed().as_secs_f32() * 1000.0;
            self.water.spent = (self.water.spent.0 + ms, self.water.spent.1.max(ms));
        }
    }

    fn flowed(&mut self, dt: f32) {
        // What changed in the world since it was last asked.
        let boxes = std::mem::take(&mut self.ground.latest);
        for (lo, hi) in boxes {
            let mut water = std::mem::take(&mut self.water);
            water.changed(&mut self.ground, lo, hi);
            self.water = water;
        }
        if !self.water.awake {
            return;
        }
        let mut water = std::mem::take(&mut self.water);
        water.owed = (water.owed + dt).min(TICK * 3.0);
        while water.owed >= TICK {
            water.owed -= TICK;
            water.step(&mut self.ground, TICK);
        }
        water.untold += dt;
        // Still for three seconds with nothing left to come out: it sleeps where it lies until the world changes.
        if water.still > 3.0 {
            water.awake = false;
            water.untold = 1.0;
        }
        if water.untold >= 0.05 {
            water.untold = 0.0;
            let words = water.tell();
            self.record(FLOW, &words);
        }
        self.water = water;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::city::{BLOCK_X, BLOCK_Z, YARD, YARD_TOWER};

    /// A charge against the side of the yard's tank: the water comes out, runs over the yard and stops; none of it is
    /// made or lost unaccounted for; and a step of it is cheap.
    #[test]
    fn a_tank_with_a_hole_in_it_empties_over_the_yard() {
        let (x, z) = (YARD.0 * BLOCK_X + YARD_TOWER.0, YARD.1 * BLOCK_Z + YARD_TOWER.1);
        let g = city::ground(x, z);
        let mut bodies = Bodies::new();
        // Low on its wall, on the side towards the street.
        bodies.blast([x, g + 124, z - 19], 8, None, false);
        let full = std::f32::consts::PI * (TANK_R * TANK_R * (TANK_HIGH - 2)) as f32;
        let (mut t, mut calls, mut widest, mut words, mut quiet) = (0.0f32, 0u32, 0usize, 0usize, 0.0f32);
        while t < 200.0 && (t < 1.0 || bodies.water.flowing() || !bodies.list.is_empty()) {
            bodies.out.clear();
            // The bodies the blast made are moved on too, as the page would: they land in the water's way.
            bodies.advance(1.0 / 60.0);
            calls += 1;
            widest = widest.max(bodies.water.wet());
            // What the page is told of the water alone: its records are the long ones.
            let (mut i, out) = (0, &bodies.out);
            while i < out.len() {
                if out[i] == FLOW { words += out[i + 1] as usize }
                i += 2 + out[i + 1] as usize;
            }
            t += 1.0 / 60.0;
            if bodies.water.flowing() { quiet = t }
            if std::env::var("WATCH").is_ok() && calls % 600 == 0 { let (l, k) = bodies.water.held(); eprintln!("  {t:.0} s: tank {k:.0}, lying {l:.0}, wet {}, still {:.1}, bodies {}", bodies.water.wet(), bodies.water.still, bodies.list.len()); }
        }
        let (spent, worst) = bodies.water.spent;
        let (on_ground, in_tank) = bodies.water.held();
        let w = &bodies.water;
        eprintln!("{full:.0} cells of water: {in_tank:.0} left in the tank, {on_ground:.0} lying, {:.0} gone out of the window or into the sea, {:.0} soaked away; {} columns wet at most, {} at the end; still after {quiet:.1} s; a call took {:.2} ms on average and {worst:.2} at worst; {:.0} kB told a second",
            w.sunk, w.soaked, widest, w.wet(), spent / calls as f32, words as f32 * 4.0 / 1000.0 / quiet.max(1.0));
        assert!(in_tank < full * 0.5, "the tank let out {:.0} of its {full:.0} cells", full - in_tank);
        assert!(widest > 2000, "the water spread over {widest} columns");
        let all = in_tank + on_ground + w.sunk + w.soaked;
        assert!((all - full).abs() < full * 0.01, "{all:.0} cells of water are accounted for, of {full:.0}");
        assert!(!w.flowing(), "it never came to rest");
        assert!(spent / (calls as f32) < 2.0, "a call took {:.2} ms on average", spent / calls as f32);
    }

    fn solid_box(size: [usize; 3], k: Kind) -> (Vec<Kind>, [f32; 3], f32) {
        let count = size[0] * size[1] * size[2];
        let cells = vec![k; count];
        let com = [size[0] as f32 * 0.5, size[1] as f32 * 0.5, size[2] as f32 * 0.5];
        let mass = count as f32 * weighs(material(k));
        (cells, com, mass)
    }

    #[test]
    fn wood_grass_leaves_float_and_wood_settles_at_equilibrium_waterline() {
        use crate::kinds::{BRICK, CONCRETE, GRASS, LEAVES, OWN, STEEL, WOOD, kind};
        let water = Water::default();
        let sea = Some(0.0f32);
        let size = [4, 4, 4];

        // Verify buoyancy calibration against kinds::weighs when fully submerged.
        for (mat, should_float, name) in [
            (WOOD, true, "wood"),
            (LEAVES, true, "leaves"),
            (GRASS, true, "grass"),
            (CONCRETE, false, "concrete"),
            (BRICK, false, "brick"),
            (STEEL, false, "steel"),
        ] {
            let (cells, com, mass) = solid_box(size, kind(mat, OWN));
            let res = water.compute_buoyancy([0.0, -10.0, 0.0], [0.0, 0.0, 0.0, 1.0], com, size, &cells, [0.0; 3], [0.0; 3], sea, 0);
            assert_eq!(res.submerged_cells, 64, "{name} should have all 64 cells submerged");
            assert!((res.submerged_ratio - 1.0).abs() < 1e-4);
            let net_accel = res.force[1] / mass - G;
            if should_float {
                assert!(net_accel > 0.0, "{name} should float (net_accel={net_accel:.2})");
            } else {
                assert!(net_accel < 0.0, "{name} should sink (net_accel={net_accel:.2})");
            }
        }

        // Simulate a 4x4x4 wood block released fully submerged at y = -6.0; it should rise and settle near waterline.
        let (cells, com, mass) = solid_box(size, kind(WOOD, OWN));
        let mut pos = [0.0f32, -6.0, 0.0];
        let mut vel = [0.0f32; 3];
        let dt = 1.0 / 60.0;
        let expected_y = 0.0 + (0.5 - weighs(WOOD) / RHO_WATER) * size[1] as f32;
        let mut max_y = pos[1];
        for _ in 0..360 {
            let res = water.compute_buoyancy(pos, [0.0, 0.0, 0.0, 1.0], com, size, &cells, vel, [0.0; 3], sea, 0);
            let ay = res.force[1] / mass - G;
            vel[1] += ay * dt;
            pos[1] += vel[1] * dt;
            max_y = max_y.max(pos[1]);
        }
        assert!(max_y > -2.0, "submerged wood should rise to surface (max_y={max_y:.2})");
        assert!((pos[1] - expected_y).abs() < 0.25, "wood should settle near equilibrium y={expected_y:.2}, got {:.2}", pos[1]);
        assert!(vel[1].abs() < 0.5, "wood oscillation should damp out (vy={:.2})", vel[1]);
    }

    #[test]
    fn steel_block_sinks_slower_than_free_fall_with_water_drag() {
        use crate::kinds::{OWN, STEEL, kind};
        let water = Water::default();
        let sea = Some(0.0f32);
        let size = [4, 4, 4];
        let (cells, com, mass) = solid_box(size, kind(STEEL, OWN));
        let mut pos = [0.0f32, -4.0, 0.0];
        let mut vel = [0.0f32; 3];
        let dt = 1.0 / 60.0;
        let steps = 90; // 1.5 s
        for _ in 0..steps {
            let res = water.compute_buoyancy(pos, [0.0, 0.0, 0.0, 1.0], com, size, &cells, vel, [0.0; 3], sea, 0);
            vel[1] += (res.force[1] / mass - G) * dt;
            pos[1] += vel[1] * dt;
        }
        let t = steps as f32 * dt;
        let free_fall_drop = 0.5 * G * t * t;
        let actual_drop = -4.0 - pos[1];
        assert!(actual_drop > 20.0, "steel should sink substantially (dropped {actual_drop:.1} cells)");
        assert!(actual_drop < free_fall_drop * 0.8, "water drag + buoyancy should slow steel below free fall (dropped {actual_drop:.1} vs free fall {free_fall_drop:.1})");
        assert!(vel[1] < -20.0 && vel[1] > -G * t * 0.7, "steel speed should approach terminal velocity (vy={:.1}, free fall {:.1})", vel[1], -G * t);
    }

    #[test]
    fn hollow_steel_car_floats_upright_and_sinks_when_inverted() {
        use crate::kinds::{OWN, STEEL, kind};
        let water = Water::default();
        let sea = Some(0.0f32);
        let size = [10, 6, 16];
        let mut cells = vec![0 as Kind; size[0] * size[1] * size[2]];
        let steel = kind(STEEL, OWN);
        let mut solid = 0usize;
        let mut air = 0usize;
        for y in 0..size[1] {
            for z in 0..size[2] {
                for x in 0..size[0] {
                    let shell = x == 0 || x == size[0] - 1 || y == 0 || y == size[1] - 1 || z == 0 || z == size[2] - 1;
                    if shell {
                        cells[x + size[0] * (z + size[2] * y)] = steel;
                        solid += 1;
                    } else {
                        air += 1;
                    }
                }
            }
        }
        // Give the hull enough enclosed cabin air to offset its steel shell when upright.
        let hull_air = air * 8;
        let com = [size[0] as f32 * 0.5, size[1] as f32 * 0.5, size[2] as f32 * 0.5];
        let mass = solid as f32 * weighs(STEEL);
        let upright = water.compute_buoyancy([0.0, -10.0, 0.0], [0.0, 0.0, 0.0, 1.0], com, size, &cells, [0.0; 3], [0.0; 3], sea, hull_air);
        let inverted = water.compute_buoyancy([0.0, -10.0, 0.0], [0.0, 0.0, 1.0, 0.0], com, size, &cells, [0.0; 3], [0.0; 3], sea, hull_air);
        assert!(upright.force[1] > mass * G, "upright hollow hull should float (F={:.0} vs W={:.0})", upright.force[1], mass * G);
        assert!(inverted.force[1] < mass * G, "inverted hull floods and sinks (F={:.0} vs W={:.0})", inverted.force[1], mass * G);
    }

    #[test]
    fn tilted_plank_self_rights_and_angular_drag_opposes_spin() {
        use crate::kinds::{OWN, WOOD, kind};
        let water = Water::default();
        let sea = Some(0.0f32);
        let size = [12, 2, 4];
        let (cells, com, _) = solid_box(size, kind(WOOD, OWN));
        // Roll by -25 deg around Z so the +X end dips down into the water below y=0.
        let half_ang = (-25.0f32).to_radians() * 0.5;
        let rot = [0.0, 0.0, half_ang.sin(), half_ang.cos()];
        let res = water.compute_buoyancy([0.0, 0.5, 0.0], rot, com, size, &cells, [0.0; 3], [0.0; 3], sea, 0);
        assert!(res.submerged_cells > 0);
        assert!(res.torque[2] > 0.0, "dipped +X side should produce +Z righting torque (got {:.2})", res.torque[2]);
        assert!(res.water_contact_pos[0] > 0.0, "center of buoyancy should shift toward submerged +X end (got {:.2})", res.water_contact_pos[0]);

        // Submerged spinning body experiences opposing angular damping torque.
        let spin = [0.5, 1.2, -0.8];
        let damped = water.compute_buoyancy([0.0, -10.0, 0.0], [0.0, 0.0, 0.0, 1.0], com, size, &cells, [0.0; 3], spin, sea, 0);
        let dot_ts = v_dot(damped.torque, spin);
        assert!(dot_ts < -10.0, "water angular drag must oppose spin (dot={dot_ts:.2})");
    }

    #[test]
    fn flowing_shallow_water_current_pushes_floating_wood_crate_downstream() {
        use crate::kinds::{OWN, WOOD, kind};
        let mut water = Water::default();
        // Seed a flowing river channel along X (floor=10, depth=8 => surface=18, flow=+25 cells/s in +X).
        for z in (-20..=20).step_by(COL as usize) {
            for x in (-20..=60).step_by(COL as usize) {
                water.seed_column(x, z, 10.0, 8.0, [25.0, 0.0]);
            }
        }
        let (surf_y, flow) = water.surface_at(0.5, 0.5, Some(0.0)).expect("shallow water surface should exist");
        assert!((surf_y - 18.0).abs() < 1e-3, "expected surface y=18.0, got {surf_y}");
        assert!(flow[0] > 20.0, "expected +X current > 20 cells/s, got {:?}", flow);

        let size = [4, 4, 4];
        let (cells, com, mass) = solid_box(size, kind(WOOD, OWN));
        let mut pos = [0.0f32, 17.0, 0.0];
        let mut vel = [0.0f32; 3];
        let dt = 1.0 / 60.0;
        for _ in 0..120 {
            let res = water.compute_buoyancy(pos, [0.0, 0.0, 0.0, 1.0], com, size, &cells, vel, [0.0; 3], None, 0);
            vel[0] += (res.force[0] / mass) * dt;
            vel[1] += (res.force[1] / mass - G) * dt;
            vel[2] += (res.force[2] / mass) * dt;
            pos = v_add(pos, v_scale(vel, dt));
        }
        assert!(vel[0] > 10.0, "flowing current should push crate downstream (vx={:.2})", vel[0]);
        assert!(pos[0] > 15.0, "crate should drift substantially downstream (x={:.2})", pos[0]);
        assert!(pos[1] > 15.5 && pos[1] < 19.5, "crate should stay floating near surface y=18 (y={:.2})", pos[1]);
    }

    #[test]
    fn large_body_buoyancy_stays_under_budget() {
        use crate::kinds::{OWN, WOOD, kind};
        let water = Water::default();
        let size = [48, 24, 48]; // 55,296 cells
        let (cells, com, _) = solid_box(size, kind(WOOD, OWN));
        let t0 = std::time::Instant::now();
        let mut acc = 0.0f32;
        for i in 0..200 {
            let res = water.compute_buoyancy(
                [0.0, -4.0 + (i % 5) as f32 * 0.2, 0.0],
                [0.0, 0.0, 0.0, 1.0],
                com,
                size,
                &cells,
                [5.0, -2.0, 0.0],
                [0.1, 0.0, -0.1],
                Some(0.0),
                0,
            );
            acc += res.force[1];
        }
        let us_per_body = t0.elapsed().as_secs_f64() * 1e6 / 200.0;
        eprintln!("large body (48x24x48 = 55,296 cells) buoyancy: {us_per_body:.2} us/body (acc={acc:.0})");
        assert!(acc > 0.0);
        // Budget is < 50 us (0.05 ms) in release; allow generous headroom in debug builds.
        #[cfg(not(debug_assertions))]
        assert!(us_per_body < 50.0, "expected < 50 us/body, took {us_per_body:.2} us");
    }
}
