//! Fire (#151). Wood, leaves, roofing and grass burn. A burning cell lasts as long as its
//! material does, may set each neighbour that can burn alight (the one above most readily), and
//! is then gone or left as char. What burns away is an edit like any other, so what it held up
//! comes loose and falls. Ten times a second, in whole numbers and hashes: the same fire from
//! the same spark.
//!
//! Fire is part of what the solver holds (bodies.rs): it reads the same standing world and
//! changes it the same way. Flames and smoke are the page's, drawn where this says cells burn.

use crate::bodies::{Bodies, Body, FIRE, Map};
use crate::city;
use crate::hash::hash3;
use crate::kinds::{EARTH, GRASS, ROCK, WOOD, burns, grey, kind, material};
use crate::scratch::Run;
use crate::tree::Kind;
use crate::water::Water;

/// One turn of the fire, seconds.
pub const TICK: f32 = 0.1;
/// The most burning cells told to the page each turn: enough flames to see, whatever the fire's size.
const SHOWN: usize = 260;
/// The most cells alight at once: past this nothing new catches until some have burnt out.
const MOST: usize = 60_000;
/// Maximum burning cells tracked on a single dynamic body, and across all dynamic bodies.
const MAX_DYNAMIC_PER_BODY: usize = 2_048;
const MAX_DYNAMIC_TOTAL: usize = 8_192;

/// World-space position where water, sea, or rain extinguished a flame (for steam emission).
pub type SteamPuff = [f32; 3];

/// Burning local voxels on one moving rigid body, each paired with its remaining fuel ticks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BodyFire {
    pub body_id: u32,
    pub cells: Vec<([usize; 3], u8)>,
}

/// Read-only view of a dynamic `Body` passed into `Fire::step_dynamic_bodies`.
#[derive(Debug, Clone, Copy)]
pub struct DynamicFireBodyView<'a> {
    pub id: u32,
    pub pos: [f32; 3],
    pub rot: [f32; 4],
    pub com: [f32; 3],
    pub size: [usize; 3],
    pub cells: &'a [Kind],
}

impl<'a> DynamicFireBodyView<'a> {
    pub fn from_body(body: &'a Body) -> Self {
        Self {
            id: body.id,
            pos: body.pos,
            rot: body.rot,
            com: body.com,
            size: body.size,
            cells: &body.cells,
        }
    }

    #[inline]
    pub fn cell_kind(&self, c: [usize; 3]) -> Kind {
        if c[0] < self.size[0] && c[1] < self.size[1] && c[2] < self.size[2] {
            let idx = c[0] + self.size[0] * (c[2] + self.size[2] * c[1]);
            self.cells.get(idx).copied().unwrap_or(0)
        } else {
            0
        }
    }

    #[inline]
    pub fn world_pos(&self, c: [usize; 3]) -> [f32; 3] {
        let local = [
            c[0] as f32 + 0.5 - self.com[0],
            c[1] as f32 + 0.5 - self.com[1],
            c[2] as f32 + 0.5 - self.com[2],
        ];
        let r = q_turn(self.rot, local);
        [self.pos[0] + r[0], self.pos[1] + r[1], self.pos[2] + r[2]]
    }

    #[inline]
    pub fn local_cell_at(&self, world: [f32; 3]) -> [i32; 3] {
        let rel = [world[0] - self.pos[0], world[1] - self.pos[1], world[2] - self.pos[2]];
        let q = q_back(self.rot, rel);
        [
            (q[0] + self.com[0]).floor() as i32,
            (q[1] + self.com[1]).floor() as i32,
            (q[2] + self.com[2]).floor() as i32,
        ]
    }
}

/// One local voxel on a dynamic body that burnt out and should be charred or removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BurntBodyCell {
    pub body_id: u32,
    pub cell: [usize; 3],
    /// Replacement `Kind`: `0` (air) or dark char (`kind(ROCK, grey(2))` / `kind(EARTH, grey(3))`).
    pub replacement: Kind,
}

/// Output of `Fire::step_dynamic_bodies` for the caller to apply to bodies, static `Ground`, and steam effects.
#[derive(Debug, Clone, Default)]
pub struct DynamicFireReport {
    /// Local voxels on dynamic bodies that finished burning (apply `replacement` to `body.cells`).
    pub burnt_out: Vec<BurntBodyCell>,
    /// Static world cells adjacent to burning dynamic bodies to ignite on `Ground`.
    pub ignite_ground: Vec<[i32; 3]>,
    /// World positions where water, sea, or rain extinguished dynamic flames.
    pub steam_puffs: Vec<SteamPuff>,
    /// Current world positions of burning dynamic-body voxels (also cached on `Fire` for `FIRE` emission).
    pub flames: Vec<[f32; 3]>,
}

#[inline]
fn v_cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
#[inline]
fn q_turn(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let u = [q[0], q[1], q[2]];
    let t = v_cross(u, v);
    let t = [t[0] * 2.0, t[1] * 2.0, t[2] * 2.0];
    let ut = v_cross(u, t);
    [v[0] + t[0] * q[3] + ut[0], v[1] + t[1] * q[3] + ut[1], v[2] + t[2] * q[3] + ut[2]]
}
#[inline]
fn q_back(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    q_turn([-q[0], -q[1], -q[2], q[3]], v)
}

#[derive(Default)]
pub struct Fire {
    /// The cells alight, and how many turns each has left.
    pub(crate) alight: Map<[i32; 3], u16>,
    /// Burning cells on dynamic bodies.
    pub dynamic: Vec<BodyFire>,
    /// World positions of currently burning dynamic-body voxels, emitted into `FIRE` output.
    pub dynamic_flames: Vec<[f32; 3]>,
    owed: f32,
    dynamic_owed: f32,
    turn: u32,
    dynamic_turn: u32,
    rain_step: u32,
    /// Cells burnt away since what they held was last asked about, and where the last of them was.
    burnt: usize,
    last: [i32; 3],
    since: f32,
}

impl Fire {
    /// Total number of currently burning dynamic-body cells across all bodies.
    pub fn dynamic_cell_count(&self) -> usize {
        self.dynamic.iter().map(|b| b.cells.len()).sum()
    }

    /// Look up active burning cells on one dynamic body.
    pub fn body_fire(&self, body_id: u32) -> Option<&BodyFire> {
        self.dynamic.iter().find(|b| b.body_id == body_id)
    }

    /// Remove all burning state for a body that broke, settled, or despawned.
    pub fn remove_body(&mut self, body_id: u32) {
        self.dynamic.retain(|b| b.body_id != body_id);
    }

    /// Ignites one local voxel on a dynamic body if its material can burn and it is not already alight.
    pub fn ignite_body(&mut self, body_id: u32, local_cell: [usize; 3], cell_kind: Kind) -> bool {
        let (lasts, _) = burns(material(cell_kind));
        if lasts == 0 {
            return false;
        }
        if self.dynamic_cell_count() >= MAX_DYNAMIC_TOTAL {
            return false;
        }
        let own = hash3(local_cell[0] as i32, local_cell[1] as i32, local_cell[2] as i32, body_id.wrapping_add(32))
            % (lasts as u32 / 2 + 1);
        let ticks = (lasts as u32 + own).clamp(1, u8::MAX as u32) as u8;
        if let Some(bf) = self.dynamic.iter_mut().find(|b| b.body_id == body_id) {
            if bf.cells.len() >= MAX_DYNAMIC_PER_BODY || bf.cells.iter().any(|&(c, _)| c == local_cell) {
                return false;
            }
            bf.cells.push((local_cell, ticks));
            return true;
        }
        self.dynamic.push(BodyFire { body_id, cells: vec![(local_cell, ticks)] });
        true
    }

    /// Quenches static fire cells submerged in shallow water (depth > 0.05), below sea level,
    /// or extinguished by active rain (`rain_intensity` in 0..=1). Returns world-space steam puff positions.
    pub fn extinguish_in_water(&mut self, water: &Water, sea_level: Option<f32>, rain_intensity: f32) -> Vec<[f32; 3]> {
        if self.alight.is_empty() {
            return Vec::new();
        }
        let rain = rain_intensity.clamp(0.0, 1.0);
        if rain > 0.0 {
            self.rain_step = self.rain_step.wrapping_add(1);
        }
        let rain_threshold = (rain * 7200.0) as u32;
        let seed = self.turn.wrapping_mul(31).wrapping_add(self.rain_step.wrapping_mul(17)).wrapping_add(97);
        let mut quenched: Vec<[i32; 3]> = Vec::new();
        let mut steam: Vec<[f32; 3]> = Vec::new();
        for &c in self.alight.keys() {
            let wpos = [c[0] as f32 + 0.5, c[1] as f32 + 0.5, c[2] as f32 + 0.5];
            let by_water = water.touches(wpos[0], wpos[1], wpos[2], sea_level);
            let by_rain = !by_water && rain_threshold > 0 && (hash3(c[0], c[1], c[2], seed) & 0xFFFF) < rain_threshold;
            if by_water || by_rain {
                quenched.push(c);
                steam.push(wpos);
            }
        }
        for c in quenched {
            self.alight.remove(&c);
        }
        steam
    }

    /// Steps burning dynamic bodies by `dt` seconds:
    /// - Static ground fire ignites touching burnable dynamic bodies.
    /// - Water depth (> 0.05), sea level, and active rain extinguish burning body voxels and emit `SteamPuff`s.
    /// - Fire spreads between adjacent burnable voxels inside each body (favoring world-up).
    /// - Burning body voxels emit candidate world cells to ignite on static `Ground`.
    /// - Exhausted fuel cells burn out to air or dark char and are returned in `burnt_out`.
    /// - Updates `self.dynamic_flames` with live world positions for `FIRE` emission.
    pub fn step_dynamic_bodies(
        &mut self,
        dt: f32,
        bodies: &[DynamicFireBodyView],
        sea_level: Option<f32>,
        water: &Water,
        rain_intensity: f32,
    ) -> DynamicFireReport {
        let mut report = DynamicFireReport::default();
        if bodies.is_empty() {
            self.dynamic.clear();
            self.dynamic_flames.clear();
            self.dynamic_owed = 0.0;
            return report;
        }

        // Prune fire records for bodies that are no longer present.
        self.dynamic.retain(|bf| bodies.iter().any(|b| b.id == bf.body_id));

        // Immediately quench any dynamic flame cells that entered water or sea on this frame.
        for bf in &mut self.dynamic {
            let Some(view) = bodies.iter().find(|b| b.id == bf.body_id) else { continue };
            bf.cells.retain(|&(cell, _)| {
                let wpos = view.world_pos(cell);
                if water.touches(wpos[0], wpos[1], wpos[2], sea_level) {
                    report.steam_puffs.push(wpos);
                    false
                } else {
                    true
                }
            });
        }
        self.dynamic.retain(|bf| !bf.cells.is_empty());

        let has_work = !self.dynamic.is_empty() || !self.alight.is_empty();
        if !has_work {
            self.dynamic_owed = 0.0;
            self.dynamic_flames.clear();
            return report;
        }

        let rain = rain_intensity.clamp(0.0, 1.0);
        let rain_threshold = (rain * 7200.0) as u32;
        let mut ignite_seen: Map<[i32; 3], ()> = Map::default();

        self.dynamic_owed = (self.dynamic_owed + dt).min(TICK * 2.0);
        while self.dynamic_owed >= TICK - 1e-6 {
            self.dynamic_owed = (self.dynamic_owed - TICK).max(0.0);
            self.dynamic_turn = self.dynamic_turn.wrapping_add(1);
            let turn = self.dynamic_turn;

            // 1. Static ground fire -> dynamic bodies ("vice versa").
            if !self.alight.is_empty() {
                self.catch_bodies_from_static(bodies, sea_level, water, turn);
            }

            // 2. Step each burning body: water/rain extinguish, intra-body spread, ground ignition, burnout/char.
            let mut body_idx = 0;
            while body_idx < self.dynamic.len() {
                let body_id = self.dynamic[body_idx].body_id;
                let Some(view) = bodies.iter().find(|b| b.id == body_id) else {
                    self.dynamic.swap_remove(body_idx);
                    continue;
                };

                // Local-space direction corresponding to world +Y, so flames climb upward on tilted bodies.
                let local_up = q_back(view.rot, [0.0, 1.0, 0.0]);
                let existing = std::mem::take(&mut self.dynamic[body_idx].cells);
                let mut active: Map<[usize; 3], ()> = Map::default();
                for &(c, _) in &existing {
                    active.insert(c, ());
                }
                let mut next_cells: Vec<([usize; 3], u8)> = Vec::with_capacity(existing.len());
                let mut newly_lit: Vec<([usize; 3], u8)> = Vec::new();
                let mut total_dynamic = self.dynamic_cell_count() + existing.len();

                for (cell, left) in existing {
                    let cell_kind = view.cell_kind(cell);
                    let mat = material(cell_kind);
                    if burns(mat).0 == 0 {
                        continue;
                    }
                    let wpos = view.world_pos(cell);
                    if water.touches(wpos[0], wpos[1], wpos[2], sea_level) {
                        report.steam_puffs.push(wpos);
                        continue;
                    }
                    if rain_threshold > 0
                        && (hash3(
                            cell[0] as i32,
                            cell[1] as i32,
                            cell[2] as i32,
                            turn.wrapping_mul(41).wrapping_add(body_id.wrapping_mul(19)).wrapping_add(97),
                        ) & 0xFFFF)
                            < rain_threshold
                    {
                        report.steam_puffs.push(wpos);
                        continue;
                    }

                    // Spread to adjacent burnable voxels inside the body.
                    const DIRS: [[i32; 3]; 6] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
                    for (dir_i, d) in DIRS.into_iter().enumerate() {
                        let nx = cell[0] as i32 + d[0];
                        let ny = cell[1] as i32 + d[1];
                        let nz = cell[2] as i32 + d[2];
                        if nx < 0 || ny < 0 || nz < 0 {
                            continue;
                        }
                        let n = [nx as usize, ny as usize, nz as usize];
                        if n[0] >= view.size[0] || n[1] >= view.size[1] || n[2] >= view.size[2] {
                            continue;
                        }
                        if active.contains_key(&n) || next_cells.len() + newly_lit.len() >= MAX_DYNAMIC_PER_BODY || total_dynamic >= MAX_DYNAMIC_TOTAL {
                            continue;
                        }
                        let nk = view.cell_kind(n);
                        let (n_lasts, catches) = burns(material(nk));
                        if n_lasts == 0 || catches == 0 {
                            continue;
                        }
                        let nwpos = view.world_pos(n);
                        if water.touches(nwpos[0], nwpos[1], nwpos[2], sea_level) {
                            continue;
                        }
                        let up_dot = d[0] as f32 * local_up[0] + d[1] as f32 * local_up[1] + d[2] as f32 * local_up[2];
                        // Dynamic burning debris fans flames slightly faster than still static embers,
                        // and climbs fastest along world +Y.
                        let chance = if up_dot > 0.5 {
                            catches as u32 * 3
                        } else if up_dot < -0.5 {
                            catches as u32
                        } else {
                            catches as u32 * 2
                        };
                        let h = hash3(
                            nx,
                            ny,
                            nz,
                            turn.wrapping_mul(11).wrapping_add(body_id.wrapping_mul(29)).wrapping_add(dir_i as u32),
                        );
                        if h % 256 < chance {
                            let own = hash3(nx, ny, nz, body_id.wrapping_add(32)) % (n_lasts as u32 / 2 + 1);
                            let ticks = (n_lasts as u32 + own).clamp(1, u8::MAX as u32) as u8;
                            active.insert(n, ());
                            newly_lit.push((n, ticks));
                            total_dynamic += 1;
                        }
                    }

                    // Emit nearby world cells for static Ground ignition.
                    let wc = [wpos[0].floor() as i32, wpos[1].floor() as i32, wpos[2].floor() as i32];
                    const GROUND_OFFSETS: [([i32; 3], u32); 7] = [
                        ([0, 0, 0], 48),
                        ([0, 1, 0], 48),
                        ([1, 0, 0], 28),
                        ([-1, 0, 0], 28),
                        ([0, 0, 1], 28),
                        ([0, 0, -1], 28),
                        ([0, -1, 0], 18),
                    ];
                    for (oi, (d, chance)) in GROUND_OFFSETS.into_iter().enumerate() {
                        let g = [wc[0] + d[0], wc[1] + d[1], wc[2] + d[2]];
                        if ignite_seen.contains_key(&g) {
                            continue;
                        }
                        if water.touches(g[0] as f32 + 0.5, g[1] as f32 + 0.5, g[2] as f32 + 0.5, sea_level) {
                            continue;
                        }
                        let h = hash3(g[0], g[1], g[2], turn.wrapping_mul(13).wrapping_add(body_id).wrapping_add(oi as u32));
                        if h % 256 < chance {
                            ignite_seen.insert(g, ());
                            report.ignite_ground.push(g);
                        }
                    }

                    // Consume fuel tick or burn out / char.
                    if left > 1 {
                        next_cells.push((cell, left - 1));
                    } else {
                        let replacement = match mat {
                            GRASS => kind(EARTH, grey(3)),
                            WOOD if hash3(cell[0] as i32, cell[1] as i32, cell[2] as i32, body_id.wrapping_mul(37).wrapping_add(33)) % 5 < 2 => {
                                kind(ROCK, grey(2))
                            }
                            _ => 0,
                        };
                        report.burnt_out.push(BurntBodyCell { body_id, cell, replacement });
                    }
                }

                next_cells.extend(newly_lit);
                if next_cells.is_empty() {
                    self.dynamic.swap_remove(body_idx);
                } else {
                    self.dynamic[body_idx].cells = next_cells;
                    body_idx += 1;
                }
            }
        }

        // Collect live world flame positions for every still-burning dynamic body voxel.
        self.dynamic_flames.clear();
        for bf in &self.dynamic {
            let Some(view) = bodies.iter().find(|b| b.id == bf.body_id) else { continue };
            for &(cell, _) in &bf.cells {
                let wpos = view.world_pos(cell);
                self.dynamic_flames.push(wpos);
                report.flames.push(wpos);
            }
        }
        report
    }

    /// Ignites burnable voxels on dynamic bodies that touch currently burning static `Ground` cells.
    fn catch_bodies_from_static(
        &mut self,
        bodies: &[DynamicFireBodyView],
        sea_level: Option<f32>,
        water: &Water,
        turn: u32,
    ) {
        let mut to_ignite: Vec<(u32, [usize; 3], Kind)> = Vec::new();
        for view in bodies {
            let max_dim = ((view.size[0] * view.size[0] + view.size[1] * view.size[1] + view.size[2] * view.size[2]) as f32).sqrt();
            let reach = max_dim + 2.5;
            let reach2 = reach * reach;
            if self.alight.len() <= 512 {
                for &sc in self.alight.keys() {
                    let wp = [sc[0] as f32 + 0.5, sc[1] as f32 + 0.5, sc[2] as f32 + 0.5];
                    let dx = wp[0] - view.pos[0];
                    let dy = wp[1] - view.pos[1];
                    let dz = wp[2] - view.pos[2];
                    if dx * dx + dy * dy + dz * dz > reach2 {
                        continue;
                    }
                    let lc = view.local_cell_at(wp);
                    for d in [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] {
                        let c = [lc[0] + d[0], lc[1] + d[1], lc[2] + d[2]];
                        if c[0] < 0 || c[1] < 0 || c[2] < 0 {
                            continue;
                        }
                        let u = [c[0] as usize, c[1] as usize, c[2] as usize];
                        if u[0] >= view.size[0] || u[1] >= view.size[1] || u[2] >= view.size[2] {
                            continue;
                        }
                        let k = view.cell_kind(u);
                        let (lasts, catches) = burns(material(k));
                        if lasts == 0 || catches == 0 {
                            continue;
                        }
                        let cw = view.world_pos(u);
                        if water.touches(cw[0], cw[1], cw[2], sea_level) {
                            continue;
                        }
                        let chance = (catches as u32 * 3).min(255);
                        if hash3(c[0], c[1], c[2], turn.wrapping_mul(17).wrapping_add(view.id)) % 256 < chance {
                            to_ignite.push((view.id, u, k));
                        }
                    }
                }
            } else {
                // Static fire is huge: probe the body's burnable cells (strided if large) against `alight`.
                let total = view.size[0] * view.size[1] * view.size[2];
                let step = ((total as f32 / 256.0).cbrt().ceil() as usize).max(1);
                for y in (0..view.size[1]).step_by(step) {
                    for z in (0..view.size[2]).step_by(step) {
                        for x in (0..view.size[0]).step_by(step) {
                            let u = [x, y, z];
                            let k = view.cell_kind(u);
                            let (lasts, catches) = burns(material(k));
                            if lasts == 0 || catches == 0 {
                                continue;
                            }
                            let cw = view.world_pos(u);
                            if water.touches(cw[0], cw[1], cw[2], sea_level) {
                                continue;
                            }
                            let wc = [cw[0].floor() as i32, cw[1].floor() as i32, cw[2].floor() as i32];
                            let near = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
                                .into_iter()
                                .any(|d| self.alight.contains_key(&[wc[0] + d[0], wc[1] + d[1], wc[2] + d[2]]));
                            if near {
                                let chance = (catches as u32 * 3).min(255);
                                if hash3(x as i32, y as i32, z as i32, turn.wrapping_mul(17).wrapping_add(view.id)) % 256 < chance {
                                    to_ignite.push((view.id, u, k));
                                }
                            }
                        }
                    }
                }
            }
        }
        for (body_id, cell, k) in to_ignite {
            self.ignite_body(body_id, cell, k);
        }
    }
}

impl Bodies {
    /// Sets alight what can burn within `radius` cells of a point: every cell of it, or (`some`) about one in twelve,
    /// as a blast does. Returns how many caught.
    pub fn ignite(&mut self, at: [i32; 3], radius: i32, some: bool) -> usize {
        let mut caught = 0;
        for y in -radius..=radius {
            for z in -radius..=radius {
                for x in -radius..=radius {
                    if x * x + y * y + z * z > radius * radius {
                        continue;
                    }
                    let c = [at[0] + x, at[1] + y, at[2] + z];
                    if some && hash3(c[0], c[1], c[2], 31) % 12 != 0 {
                        continue;
                    }
                    caught += self.light(c, 0) as usize;
                }
            }
        }
        caught
    }

    /// Sets one cell alight if it is there, can burn and is not burning. `late` is how many turns longer it lasts than its material says.
    fn light(&mut self, c: [i32; 3], late: u16) -> bool {
        if self.fire.alight.len() >= MOST || self.fire.alight.contains_key(&c) || !self.ground.fuel(c[0], c[1], c[2]) {
            return false;
        }
        // Nothing burns under the sea: its weed is leaves, and leaves burn.
        if c[1] <= city::SEA && city::ground(c[0], c[2]) < city::SEA {
            return false;
        }
        let (lasts, _) = burns(self.ground.fuel_stuff(c[0], c[1], c[2]));
        if lasts == 0 {
            return false;
        }
        // No two cells burn for quite the same time.
        let own = (hash3(c[0], c[1], c[2], 32) % (lasts as u32 / 2 + 1)) as u16;
        self.fire.alight.insert(c, lasts + own + late);
        true
    }

    /// Sets a batch of static world cells alight (e.g. `DynamicFireReport::ignite_ground`). Returns how many caught.
    pub fn ignite_ground_cells(&mut self, cells: &[[i32; 3]]) -> usize {
        cells.iter().map(|&c| self.light(c, 0) as usize).sum()
    }

    /// Moves the fire on by `dt` seconds, in whole turns. Tells the page where it burns.
    pub(crate) fn burn(&mut self, dt: f32) {
        if self.fire.alight.is_empty() && self.fire.dynamic_flames.is_empty() {
            self.fire.owed = 0.0;
            return;
        }
        if !self.fire.alight.is_empty() {
            self.fire.owed = (self.fire.owed + dt).min(TICK * 2.0);
            self.fire.since += dt;
            while self.fire.owed >= TICK {
                self.fire.owed -= TICK;
                self.fire.turn += 1;
                if self.water.wet() > 0 {
                    let _ = self.fire.extinguish_in_water(&self.water, None, 0.0);
                }
                let turn = self.fire.turn;
                let cells: Vec<([i32; 3], u16)> = self.fire.alight.iter().map(|(c, left)| (*c, *left)).collect();
                let mut gone: Vec<Run> = Vec::new();
                for (c, left) in cells {
                    if !self.ground.solid(c[0], c[1], c[2]) {
                        // Blasted away, or come loose and fallen: its fire is out.
                        self.fire.alight.remove(&c);
                        continue;
                    }
                    // It may set each neighbour alight: the one above twice as readily, and now and then one two above.
                    for (i, d) in [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0], [0, 2, 0]].into_iter().enumerate() {
                        let n = [c[0] + d[0], c[1] + d[1], c[2] + d[2]];
                        // Most neighbours are air or will not burn: that is asked first, and quickly.
                        if !self.ground.fuel(n[0], n[1], n[2]) || self.fire.alight.contains_key(&n) {
                            continue;
                        }
                        let (_, catches) = burns(self.ground.fuel_stuff(n[0], n[1], n[2]));
                        let chance = match i { 5 => catches as u32 * 2, 6 => catches as u32 / 2, 4 => catches as u32 / 2, _ => catches as u32 };
                        if chance > 0 && hash3(n[0], n[1], n[2], turn.wrapping_mul(7).wrapping_add(i as u32)) % 256 < chance {
                            self.light(n, 0);
                        }
                    }
                    if left > 1 {
                        self.fire.alight.insert(c, left - 1);
                        continue;
                    }
                    self.fire.alight.remove(&c);
                    // Burnt out: leaves and roofing are gone, grass is bare earth, wood is gone or (two times in five) char that still stands.
                    let now = match self.ground.fuel_stuff(c[0], c[1], c[2]) {
                        GRASS => kind(EARTH, grey(3)),
                        WOOD if hash3(c[0], c[1], c[2], 33) % 5 < 2 => kind(ROCK, grey(2)),
                        _ => 0,
                    };
                    gone.push(Run { x0: c[0], x1: c[0] + 1, y: c[1], z: c[2], kind: now });
                    if now == 0 {
                        self.fire.burnt += 1;
                        self.fire.last = c;
                    }
                }
                self.change(gone);
            }
            // What the fire ate may have held something up: asked once a second, where it last ate.
            if self.fire.burnt > 40 && self.fire.since > 1.0 {
                self.fire.burnt = 0;
                self.fire.since = 0.0;
                let at = self.fire.last;
                self.release(at, 0);
            }
        }
        // Where it burns: static cells plus dynamic body flames, a different subset each turn.
        let n_static = self.fire.alight.len();
        let n_dyn = self.fire.dynamic_flames.len();
        let n = n_static + n_dyn;
        let skip = n / SHOWN + 1;
        let mut words: Vec<u32> = Vec::with_capacity(SHOWN * 3 + 1);
        words.push(n as u32);
        let phase = self.fire.turn.wrapping_add(self.fire.dynamic_turn) as usize;
        for (i, c) in self.fire.alight.keys().enumerate() {
            if (i + phase) % skip == 0 && words.len() < SHOWN * 3 {
                words.extend(c.iter().map(|&v| (v as f32 + 0.5).to_bits()));
            }
        }
        for (i, p) in self.fire.dynamic_flames.iter().enumerate() {
            if (n_static + i + phase) % skip == 0 && words.len() < SHOWN * 3 {
                words.extend(p.iter().map(|&v| v.to_bits()));
            }
        }
        self.record(FIRE, &words);
    }
}

#[cfg(test)]
mod tests {
    use crate::bodies::Bodies;
    use crate::city;
    use crate::kinds::{LEAVES, material};

    #[test]
    fn weed_under_the_lake_does_not_catch() {
        // The grove the board's under-water row looks at: weed is leaves, and leaves burn anywhere else.
        let mut bodies = Bodies::new();
        let found = (-12_800..-12_600).step_by(3).flat_map(|x| (3960..4140).step_by(3).map(move |z| (x, z))).find_map(|(x, z)| {
            let ground = city::ground(x, z);
            (ground < -40).then(|| (ground + 8..ground + 40).find(|&y| material(bodies.ground.kind(x, y, z)) == LEAVES).map(|y| (x, y, z))).flatten()
        });
        let Some((x, y, z)) = found else { panic!("no weed in the lake where the under-water row looks: the check needs some") };
        assert_eq!(bodies.ignite([x, y, z], 4, false), 0, "weed {} cells under the sea's top caught", -y);
    }

    #[test]
    fn a_tree_set_alight_burns_away_and_the_fire_goes_out() {
        // A street tree near the start: the first leaves found over the pavements there.
        let mut bodies = Bodies::new();
        let found = (600..700).step_by(4).flat_map(|x| (3980..4060).step_by(4).map(move |z| (x, z))).find_map(|(x, z)| {
            let ground = city::ground(x, z);
            (ground + 25..ground + 90).find(|&y| material(bodies.ground.kind(x, y, z)) == LEAVES).map(|y| (x, y, z))
        });
        let Some((x, y, z)) = found else { panic!("no tree near the start: the check needs one") };
        let leaves_before = (0..40).flat_map(|dy| (-20..20).map(move |dx| (dx, dy))).filter(|&(dx, dy)| material(bodies.ground.kind(x + dx, y + dy, z)) == LEAVES).count();
        assert!(leaves_before > 100, "a crown's slice has {leaves_before} leaves");
        let caught = bodies.ignite([x, y + 2, z], 3, false);
        assert!(caught > 10, "{caught} cells caught");
        let (mut most, mut t) = (0, 0.0);
        while !bodies.fire.alight.is_empty() && t < 240.0 {
            bodies.out.clear();
            bodies.advance(1.0 / 30.0);
            most = most.max(bodies.fire.alight.len());
            t += 1.0 / 30.0;
        }
        assert!(bodies.fire.alight.is_empty(), "the fire was still burning after four minutes ({} cells)", bodies.fire.alight.len());
        assert!(most > caught * 5, "the fire spread: {most} cells alight at its height from {caught}");
        let leaves_after = (0..40).flat_map(|dy| (-20..20).map(move |dx| (dx, dy))).filter(|&(dx, dy)| material(bodies.ground.kind(x + dx, y + dy, z)) == LEAVES).count();
        assert!(leaves_after * 4 < leaves_before, "most of the crown burnt: {leaves_before} leaves before, {leaves_after} after {t:.0} s");
    }

    #[test]
    fn dynamic_burning_wood_beam_spreads_chars_and_ignites_static_wall() {
        use super::*;
        use crate::Edit;
        use crate::kinds::{OWN, STEEL};
        use crate::water::Water;

        let mut bodies = Bodies::new();
        let wood = kind(WOOD, OWN);
        let steel = kind(STEEL, OWN);

        // Build a static wood wall in clear air well above local terrain/roofs.
        let base_y = city::ground(104, 102).max(20) + 120;
        let mut wall_runs = Vec::new();
        for y in base_y..base_y + 6 {
            wall_runs.push(Run { x0: 100, x1: 112, y, z: 102, kind: wood });
        }
        bodies.ground.push(Edit::Runs(wall_runs), true, None);
        assert!(bodies.ground.fuel(104, base_y + 2, 102));

        // Create a 10x2x2 dynamic wood beam right beside the static wall at z=100..102.
        let size = [10, 2, 2];
        let mut beam_cells = vec![wood; size[0] * size[1] * size[2]];
        let com = [5.0f32, 1.0, 1.0];
        let mut pos = [105.0f32, (base_y + 2) as f32, 100.8];
        let rot = [0.0f32, 0.0, 0.0, 1.0];
        let body_id = 42;

        // Non-burnable steel must not ignite.
        assert!(!bodies.fire.ignite_body(body_id, [0, 0, 0], steel));
        // Ignite one end of the wood beam.
        assert!(bodies.fire.ignite_body(body_id, [0, 0, 0], wood));
        assert!(!bodies.fire.ignite_body(body_id, [0, 0, 0], wood), "duplicate ignite returns false");

        let water = Water::default();
        let mut max_burning = 0usize;
        let mut max_x_reached = 0usize;
        let mut total_burnt = 0usize;
        let mut charred_count = 0usize;
        let mut removed_count = 0usize;
        let mut saw_dynamic_in_fire_out = false;

        for step in 0..220 {
            // Translate beam gently along the wall while it burns.
            pos[0] = 105.0 + (step as f32 * 0.01).min(1.5);
            let view = DynamicFireBodyView { id: body_id, pos, rot, com, size, cells: &beam_cells };
            let report = bodies.fire.step_dynamic_bodies(TICK, &[view], None, &water, 0.0);

            if let Some(bf) = bodies.fire.body_fire(body_id) {
                max_burning = max_burning.max(bf.cells.len());
                for &(c, _) in &bf.cells {
                    max_x_reached = max_x_reached.max(c[0]);
                }
            }
            for b in &report.burnt_out {
                total_burnt += 1;
                let idx = b.cell[0] + size[0] * (b.cell[2] + size[2] * b.cell[1]);
                beam_cells[idx] = b.replacement;
                if b.replacement == 0 {
                    removed_count += 1;
                } else if material(b.replacement) == ROCK {
                    charred_count += 1;
                }
            }
            if !report.ignite_ground.is_empty() {
                bodies.ignite_ground_cells(&report.ignite_ground);
            }

            // Confirm Bodies::burn emits dynamic flame positions in FIRE output even before static wall catches.
            if step == 1 && !report.flames.is_empty() {
                bodies.out.clear();
                bodies.burn(0.016);
                let mut i = 0;
                while i < bodies.out.len() {
                    let tag = bodies.out[i];
                    let len = bodies.out[i + 1] as usize;
                    if tag == FIRE && len >= 4 && bodies.out[i + 2] >= 1 {
                        saw_dynamic_in_fire_out = true;
                    }
                    i += 2 + len;
                }
            }
        }

        assert!(saw_dynamic_in_fire_out, "FIRE output record should include dynamic body flame world positions");
        assert!(max_burning >= 6, "fire should spread along the moving wood beam (max_burning={max_burning})");
        assert!(max_x_reached >= 4, "fire should travel along the beam length (max_x_reached={max_x_reached})");
        assert!(total_burnt >= 5, "wood voxels on the beam should burn out over time (total_burnt={total_burnt})");
        assert!(charred_count + removed_count == total_burnt && (charred_count > 0 || removed_count > 0));
        assert!(!bodies.fire.alight.is_empty(), "burning beam touching static wood wall should ignite Ground fuel cells");
    }

    #[test]
    fn static_fire_ignites_touching_dynamic_wood_body() {
        use super::*;
        use crate::kinds::OWN;
        use crate::water::Water;

        let mut fire = Fire::default();
        // Seed a burning static fire cluster at [50, 20, 50].
        for dx in -1..=1 {
            fire.alight.insert([50 + dx, 20, 50], 80);
        }
        let wood = kind(WOOD, OWN);
        let size = [4, 4, 4];
        let cells = vec![wood; size[0] * size[1] * size[2]];
        let view = DynamicFireBodyView {
            id: 99,
            pos: [50.5, 22.5, 50.5],
            rot: [0.0, 0.0, 0.0, 1.0],
            com: [2.0, 2.0, 2.0],
            size,
            cells: &cells,
        };
        let water = Water::default();
        for _ in 0..30 {
            let _ = fire.step_dynamic_bodies(TICK, &[view], None, &water, 0.0);
            if fire.body_fire(99).is_some() {
                break;
            }
        }
        assert!(fire.body_fire(99).is_some(), "static fire should ignite a touching dynamic wood body");
    }

    #[test]
    fn water_extinguishes_static_and_dynamic_fire_emitting_steam_puffs() {
        use super::*;
        use crate::kinds::OWN;
        use crate::water::{COL, Water};

        let mut water = Water::default();
        // Deep puddle (depth 0.5 > 0.05) around (20, 20) at floor=10, and thin film (0.03 <= 0.05) at (40, 20).
        for dz in (-4..=4).step_by(COL as usize) {
            for dx in (-4..=4).step_by(COL as usize) {
                water.seed_column(20 + dx, 20 + dz, 10.0, 0.5, [0.0, 0.0]);
            }
        }
        water.seed_column(40, 20, 10.0, 0.03, [0.0, 0.0]);

        let mut fire = Fire::default();
        fire.alight.insert([20, 10, 20], 50); // In shallow water puddle (depth 0.5)
        fire.alight.insert([0, -2, 0], 50);   // Below sea level (0.0)
        fire.alight.insert([40, 10, 20], 50); // Only 0.03-cell film: should NOT extinguish
        fire.alight.insert([20, 30, 20], 50); // Dry air high above puddle: should NOT extinguish

        let puffs = fire.extinguish_in_water(&water, Some(0.0), 0.0);
        assert_eq!(puffs.len(), 2, "exactly 2 submerged static cells should emit steam puffs, got {:?}", puffs);
        assert!(!fire.alight.contains_key(&[20, 10, 20]));
        assert!(!fire.alight.contains_key(&[0, -2, 0]));
        assert!(fire.alight.contains_key(&[40, 10, 20]), "thin film <= 0.05 must not extinguish fire");
        assert!(fire.alight.contains_key(&[20, 30, 20]), "dry fire high above puddle must stay alight");

        // Now drop a burning dynamic wood body into the sea and verify instant quench + steam puffs.
        let wood = kind(WOOD, OWN);
        let size = [3, 3, 3];
        let cells = vec![wood; 27];
        assert!(fire.ignite_body(5, [1, 1, 1], wood));
        assert!(fire.ignite_body(5, [2, 1, 1], wood));
        let submerged_view = DynamicFireBodyView {
            id: 5,
            pos: [0.0, -3.0, 0.0],
            rot: [0.0, 0.0, 0.0, 1.0],
            com: [1.5, 1.5, 1.5],
            size,
            cells: &cells,
        };
        let report = fire.step_dynamic_bodies(0.016, &[submerged_view], Some(0.0), &water, 0.0);
        assert_eq!(report.steam_puffs.len(), 2, "both submerged dynamic cells should emit steam puffs");
        assert!(fire.body_fire(5).is_none(), "submerged dynamic body should be fully extinguished");
        assert!(report.flames.is_empty());
    }

    #[test]
    fn rain_extinguishes_open_static_and_dynamic_fire_over_time() {
        use super::*;
        use crate::kinds::OWN;
        use crate::water::Water;

        let water = Water::default();
        let mut fire = Fire::default();
        for x in 0..40 {
            fire.alight.insert([x, 50, 0], 100);
        }
        let wood = kind(WOOD, OWN);
        let size = [4, 2, 2];
        let cells = vec![wood; 16];
        for x in 0..4 {
            assert!(fire.ignite_body(11, [x, 0, 0], wood));
        }
        let view = DynamicFireBodyView {
            id: 11,
            pos: [10.0, 50.0, 10.0],
            rot: [0.0, 0.0, 0.0, 1.0],
            com: [2.0, 1.0, 1.0],
            size,
            cells: &cells,
        };

        let mut static_steam = 0usize;
        let mut dyn_steam = 0usize;
        for _ in 0..120 {
            static_steam += fire.extinguish_in_water(&water, None, 0.85).len();
            let rep = fire.step_dynamic_bodies(TICK, &[view], None, &water, 0.85);
            dyn_steam += rep.steam_puffs.len();
            if fire.alight.is_empty() && fire.dynamic.is_empty() {
                break;
            }
        }
        assert!(fire.alight.is_empty(), "heavy rain should extinguish open static fire ({} left)", fire.alight.len());
        assert!(fire.dynamic.is_empty(), "heavy rain should extinguish open dynamic fire");
        assert_eq!(static_steam, 40, "all 40 rained-out static cells should emit steam puffs");
        assert!(dyn_steam >= 4, "rained-out dynamic cells should emit steam puffs (got {dyn_steam})");
    }
}
