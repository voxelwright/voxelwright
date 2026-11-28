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
/// How fast standing water sinks away where nothing says otherwise, cells a second.
const SOAKS: f32 = 0.004;
/// Water less than this far over a hole in a tank does not come out of it: the last of it would dribble for minutes.
const DRIBBLE: f32 = 0.5;

/// How many stretches of water a column can hold, one over another (#226): under a bridge and on it, floor over floor.
pub const MAX_LAYERS: usize = 4;
/// What a layer is of.
pub const FRESH: u8 = 0;
pub const SEA: u8 = 1;
/// How far over a floor a ceiling is looked for, cells: past that the air is taken as open until something asks higher.
const CEIL_SCAN: i32 = 48;
/// How fast what a body pushed aside comes back, a second.
const DISPLACED_EASES: f32 = 4.0;
/// A layer that gave or took less than this in a step (cells of depth) has not changed for anyone watching.
const STIRRED: f32 = 2e-4;
/// How many boxes of changed water are kept apart; more are joined, the two that cost least to join first.
pub const DIRTY_CAP: usize = 8;
/// Boxes this near (cells) are one box.
const DIRTY_NEAR: i32 = 4;
/// The floor of a column that is solid as far up as was looked: nothing lies on it or runs onto it.
const WALL: f32 = 1e9;
/// A brick of the water's distance field: voxels a side that are its own, voxels a side with its border, bytes.
pub const BRICK: i32 = 6;
pub const BRICK_SIDE: usize = 8;
pub const BRICK_BYTES: usize = BRICK_SIDE * BRICK_SIDE * BRICK_SIDE;
/// How far the field reaches, in voxels: a byte of 127 is this far outside the water, -127 this far inside.
pub const SDF_REACH: f32 = 2.0;
/// How many coarsenesses a brick can be made at: each has voxels twice the last's.
pub const SDF_LODS: u32 = 3;

/// How fast standing water sinks into what it lies on, cells a second (#226): sand drinks it, earth and grass take
/// it slowly, masonry and wood barely, and stone, asphalt, concrete, steel and glass hold a pool.
pub const fn soaks(material: u8) -> f32 {
    use crate::kinds::{ASPHALT, CONCRETE, EARTH, GLASS, GRASS, LAMP, LEAVES, ROCK, SAND, STEEL};
    match material {
        SAND => 0.12,
        EARTH => 0.04,
        GRASS | LEAVES => 0.03,
        ROCK | ASPHALT | CONCRETE | STEEL | GLASS | LAMP => 0.0004,
        _ => SOAKS,
    }
}

/// One stretch of water in a column: what lies on one floor, under whatever is next over it.
#[derive(Debug, Clone, Copy)]
pub struct WaterLayer {
    /// Its floor: the lowest free cell, with something solid under it.
    pub bottom: f32,
    /// How deep the water on it is, cells. Over `ceiling - bottom` it is water under pressure: it fills the room.
    pub height: f32,
    /// The first solid cell over the floor, `f32::INFINITY` where none was found.
    pub ceiling: f32,
    pub fluid: u8,
    /// What a body in it pushes aside, cells of depth: it stands that much higher to its neighbours, and eases back.
    pub displacement: f32,
    /// What leaves it a second, to +x, -x, +z, -z.
    pub flow: [f32; 4],
    /// Which layer of each neighbour that flow goes to, as last found.
    link: [u8; 4],
    /// Air is known from the floor up to here where no ceiling was found; solid from here up to the floor.
    clear: f32,
    under: f32,
    /// How fast it sinks into its floor (`soaks`).
    soaks: f32,
    /// What it gave and took this step, cells of depth.
    stirred: f32,
    listed: bool,
}

impl WaterLayer {
    const DRY: WaterLayer = WaterLayer { bottom: 0.0, height: 0.0, ceiling: f32::INFINITY, fluid: FRESH, displacement: 0.0, flow: [0.0; 4], link: [0; 4], clear: f32::INFINITY, under: 0.0, soaks: SOAKS, stirred: 0.0, listed: false };

    /// Where its top is seen: never through its ceiling.
    #[inline]
    pub fn top(&self) -> f32 {
        (self.bottom + self.height).min(self.ceiling)
    }

    /// How high it stands to its neighbours.
    #[inline]
    fn head(&self) -> f32 {
        self.bottom + self.height + self.displacement
    }

    /// Whether a height is in its room, or in what it stands on.
    #[inline]
    fn holds(&self, y: f32) -> bool {
        y >= self.under && y < self.ceiling.min(self.clear)
    }
}

#[derive(Clone, Copy)]
struct Column {
    n: u8,
    /// The world changed in it while it was wet: its floors are looked for again before the next step.
    stale: bool,
    again: bool,
    layers: [WaterLayer; MAX_LAYERS],
}

impl Column {
    const NEW: Column = Column { n: 0, stale: false, again: false, layers: [WaterLayer::DRY; MAX_LAYERS] };

    #[inline]
    fn known(&self) -> &[WaterLayer] {
        &self.layers[..self.n as usize]
    }

    /// The highest layer with water on it whose floor is at or under `y`.
    #[inline]
    fn wet_under(&self, y: f32, least: f32) -> Option<&WaterLayer> {
        let mut best: Option<&WaterLayer> = None;
        for l in self.known() {
            if l.height > least && l.bottom <= y && best.is_none_or(|b| l.bottom > b.bottom) {
                best = Some(l);
            }
        }
        best
    }
}

/// A box of the world (cells, high corner exclusive) in which water changed.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DirtyBox {
    pub min: [i32; 3],
    pub max: [i32; 3],
}

impl DirtyBox {
    fn near(&self, o: &DirtyBox) -> bool {
        (0..3).all(|a| self.min[a] <= o.max[a] + DIRTY_NEAR && o.min[a] <= self.max[a] + DIRTY_NEAR)
    }
    fn within(&self, o: &DirtyBox) -> bool {
        (0..3).all(|a| self.min[a] >= o.min[a] && self.max[a] <= o.max[a])
    }
    fn joined(&self, o: &DirtyBox) -> DirtyBox {
        DirtyBox { min: [self.min[0].min(o.min[0]), self.min[1].min(o.min[1]), self.min[2].min(o.min[2])], max: [self.max[0].max(o.max[0]), self.max[1].max(o.max[1]), self.max[2].max(o.max[2])] }
    }
    fn volume(&self) -> f64 {
        (0..3).map(|a| (self.max[a] - self.min[a]).max(0) as f64).product()
    }
}

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
    /// For each column of the window, one more than where it is kept in `cols`; 0 while nothing is known of it.
    slot: Vec<u32>,
    cols: Vec<Column>,
    /// The layers with water on them: the column's place in the window, then which of its layers (2 bits).
    wet: Vec<u32>,
    tanks: Vec<Tank>,
    owed: f32,
    /// Seconds since it was last told, and since anything moved.
    untold: f32,
    still: f32,
    awake: bool,
    /// Some wet column's world changed.
    stale: bool,
    redo: Vec<u32>,
    /// Where water changed since `clear_dirty`, and a count that moves whenever any did.
    dirty: Vec<DirtyBox>,
    last_dirty: usize,
    version: u32,
    /// The bricks of the distance field that hold a surface, as of `bricks_at` (sdf_bricks).
    bricks: Vec<[i32; 3]>,
    bricks_at: Option<(u32, bool)>,
    brick_keys: Vec<u64>,
    spans: Vec<[f32; 2 * MAX_LAYERS]>,
    /// Whether the distance field is of every layer, or only of those the heights told to the page cannot show.
    sdf_all: bool,
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
    /// How many layers have water on them: one a wet column, more where water lies over water (#226).
    pub fn wet(&self) -> usize {
        self.wet.len()
    }

    /// Whether it is moving, or may: the page keeps asking for time while it is.
    pub fn flowing(&self) -> bool {
        self.awake
    }

    /// Cells of water on the ground, and left in tanks.
    pub fn held(&self) -> (f32, f32) {
        (self.wet.iter().map(|&e| self.layer(e).height).sum::<f32>() * (COL * COL) as f32, self.tanks.iter().map(|t| t.left).sum())
    }

    #[inline]
    fn layer(&self, e: u32) -> &WaterLayer {
        &self.cols[self.slot[(e >> 2) as usize] as usize - 1].layers[(e & 3) as usize]
    }

    #[inline]
    fn col(&self, idx: usize) -> Option<&Column> {
        match self.slot[idx] {
            0 => None,
            s => Some(&self.cols[s as usize - 1]),
        }
    }

    #[inline]
    fn column_at(&self, x: f32, z: f32) -> Option<usize> {
        if self.slot.is_empty() {
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

    /// The layers known at world `(x, z)`, wet and dry, in no order.
    pub fn layers_at(&self, x: f32, z: f32) -> &[WaterLayer] {
        self.column_at(x, z).and_then(|i| self.col(i)).map_or(&[], |c| c.known())
    }

    /// What comes into layer `k` of a column from the one beside it, by that one's pipe `d`.
    #[inline]
    fn inflow(&self, from: usize, d: usize, k: usize) -> f32 {
        self.col(from).map_or(0.0, |c| c.known().iter().filter(|l| l.link[d] as usize == k).map(|l| l.flow[d]).sum())
    }

    #[inline]
    fn layer_flow(&self, idx: usize, k: usize, l: &WaterLayer) -> [f32; 2] {
        let d = l.height;
        if d <= FILM {
            return [0.0, 0.0];
        }
        let (cx, cz) = (idx % N, idx / N);
        let f = l.flow;
        let in_xm = if cx > 0 { self.inflow(idx - 1, 0, k) } else { f[0] };
        let in_xp = if cx + 1 < N { self.inflow(idx + 1, 1, k) } else { f[1] };
        let in_zm = if cz > 0 { self.inflow(idx - N, 2, k) } else { f[2] };
        let in_zp = if cz + 1 < N { self.inflow(idx + N, 3, k) } else { f[3] };
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

    /// The water at world `(x, z)` that something at height `y` meets: the highest wet layer whose floor is at or
    /// under `y`. Its floor, depth (cells) and horizontal flow velocity.
    #[inline]
    pub fn shallow_near(&self, x: f32, y: f32, z: f32) -> Option<(f32, f32, [f32; 2])> {
        let idx = self.column_at(x, z)?;
        let col = self.col(idx)?;
        let l = col.wet_under(y, FILM)?;
        let k = (l as *const WaterLayer as usize - col.layers.as_ptr() as usize) / std::mem::size_of::<WaterLayer>();
        Some((l.bottom, l.height, self.layer_flow(idx, k, l)))
    }

    /// Shallow-water floor height, depth (cells), and horizontal flow velocity `(vx, vz)` at world `(x, z)`: of the
    /// top-most water there.
    #[inline]
    pub fn shallow_at(&self, x: f32, z: f32) -> Option<(f32, f32, [f32; 2])> {
        self.shallow_near(x, f32::INFINITY, z)
    }

    /// Shallow-water depth (in cells) of the top-most water at world `(x, z)`, or `0.0` when dry or outside the window.
    #[inline]
    pub fn depth_at(&self, x: f32, z: f32) -> f32 {
        self.column_at(x, z).and_then(|i| self.col(i)).and_then(|c| c.wet_under(f32::INFINITY, 0.0)).map_or(0.0, |l| l.height)
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
    /// shallow water deeper than `EXTINGUISH_DEPTH` (0.05 cells) without false-matching roofs far above:
    /// the water it is asked of is the layer it stands in, so a fire under a flooded deck is in the pool below.
    #[inline]
    pub fn touches(&self, x: f32, y: f32, z: f32, sea_level: Option<f32>) -> bool {
        if let Some(sea) = sea_level {
            if y - 0.5 < sea {
                return true;
            }
        }
        if let Some((floor, depth, _)) = self.shallow_near(x, y + 1.0, z) {
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
        if self.slot.is_empty() {
            self.open([x, z]);
        }
        let Some(idx) = self.column_at(x as f32 + 0.5, z as f32 + 0.5) else { return };
        let s = self.slot_of(idx);
        let was = self.cols[s].n > 0 && self.cols[s].layers[0].listed;
        let depth = depth.max(0.0);
        let scale = depth.max(0.1) * COL as f32;
        let (qx, qz) = (flow_vel[0] * scale, flow_vel[1] * scale);
        self.cols[s].n = 1;
        self.cols[s].layers[0] = WaterLayer { bottom: floor, height: depth, under: floor - 1.0, flow: [qx.max(0.0), (-qx).max(0.0), qz.max(0.0), (-qz).max(0.0)], listed: was || depth > 0.0, ..WaterLayer::DRY };
        if depth > 0.0 && !was {
            self.wet.push((idx as u32) << 2);
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
        if total_grid == 0 || cells.len() < total_grid || (sea_level.is_none() && self.slot.is_empty()) {
            return BuoyancyResult::default();
        }

        // Fast dry-body early out when only the global sea plane is active.
        if self.slot.is_empty() {
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
        let has_shallow = !self.slot.is_empty();

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
                        if let Some((floor, depth, sflow)) = self.shallow_near(wx, wy + half_h + 2.0, wz) {
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
        self.slot = vec![0; N * N];
        self.cols.clear();
        self.wet.clear();
    }

    fn column(&self, x: i32, z: i32) -> Option<usize> {
        let (cx, cz) = ((x - self.low[0]).div_euclid(COL), (z - self.low[1]).div_euclid(COL));
        if cx < 1 || cz < 1 || cx >= N as i32 - 1 || cz >= N as i32 - 1 { None } else { Some(cx as usize + N * cz as usize) }
    }

    #[inline]
    fn slot_of(&mut self, c: usize) -> usize {
        match self.slot[c] {
            0 => {
                self.cols.push(Column::NEW);
                self.slot[c] = self.cols.len() as u32;
                self.cols.len() - 1
            }
            s => s as usize - 1,
        }
    }

    /// The layer of a column that the height `y` is in: one already known, or looked for in the world as it stands
    /// (#226). A floor is looked for from `y` as it always was; what is new is that the floor found is kept beside
    /// the others of its column, each with the ceiling over it, so that water on a deck and water under it are two
    /// layers, and water asked for from under the deck is never put on top of it. Where it is kept, and which layer.
    fn layer_for(&mut self, ground: &mut Ground, c: usize, y: i32) -> (usize, usize) {
        let s = self.slot_of(c);
        let yf = y as f32;
        let (x, z) = (self.low[0] + (c % N) as i32 * COL + 1, self.low[1] + (c / N) as i32 * COL + 1);
        let col = &mut self.cols[s];
        if col.stale && !col.known().iter().any(|l| l.listed) {
            (col.n, col.stale) = (0, false);
        }
        let n = col.n as usize;
        for k in 0..n {
            if col.layers[k].holds(yf) {
                return (s, k);
            }
        }
        let mut bottom = floor_at(ground, x, z, y);
        // Solid as far up as was looked: a wall, which nothing lies on. It is kept so that it is not climbed again.
        let wall = bottom > yf && ground.solid(x, bottom as i32, z);
        if wall {
            bottom = WALL;
        }
        if let Some(k) = (0..n).find(|&k| col.layers[k].bottom == bottom) {
            let l = &mut col.layers[k];
            if yf < bottom {
                l.under = l.under.min(yf);
                if wall {
                    l.clear = l.clear.max(yf + 80.0);
                }
            } else if yf >= l.ceiling {
                (l.ceiling, l.clear) = (f32::INFINITY, yf + 1.0);
            } else {
                l.clear = l.clear.max(yf + 1.0);
            }
            return (s, k);
        }
        if n == MAX_LAYERS {
            // No room for another: the one whose floor is nearest stands in for it.
            let near = (0..n).min_by(|&a, &b| (col.layers[a].bottom - bottom).abs().total_cmp(&(col.layers[b].bottom - bottom).abs())).unwrap();
            return (s, near);
        }
        let mut new = WaterLayer { bottom, under: yf.min(bottom - 1.0), ..WaterLayer::DRY };
        if wall {
            new.clear = yf + 80.0;
        } else {
            let from = (bottom as i32).max(y + 1);
            let lid = (bottom as i32 + CEIL_SCAN).max(from);
            let mut top = from;
            while top < lid && !ground.solid(x, top, z) {
                top += 1;
            }
            if top < lid { new.ceiling = top as f32 } else { new.clear = lid as f32 }
            new.soaks = soaks(material(ground.kind(x, bottom as i32 - 1, z)));
            for k in 0..n {
                let o = &mut col.layers[k];
                if o.bottom > bottom {
                    // What stands over it is its lid at the latest.
                    if o.under < new.ceiling.min(new.clear) {
                        new.ceiling = new.ceiling.min(o.under);
                    }
                } else if o.ceiling.min(o.clear) > bottom - 1.0 {
                    // What lies under it has this floor's underside for a ceiling.
                    let mut u = bottom as i32 - 1;
                    while u - 1 > o.bottom as i32 && ground.solid(x, u - 1, z) {
                        u -= 1;
                    }
                    (o.ceiling, o.clear) = (o.ceiling.min(u as f32), f32::INFINITY);
                }
            }
        }
        col.layers[n] = new;
        col.n += 1;
        (s, n)
    }

    /// Notes that water changed in a box of the world.
    fn mark(&mut self, b: DirtyBox) {
        self.version = self.version.wrapping_add(1);
        if self.dirty.get(self.last_dirty).is_some_and(|d| b.within(d)) {
            return;
        }
        let Some(i) = self.dirty.iter().position(|d| b.near(d)) else {
            self.dirty.push(b);
            if self.dirty.len() > DIRTY_CAP {
                // Too many to keep apart: the two whose joining adds least are one.
                let (mut best, mut pair) = (f64::INFINITY, (0, 1));
                for i in 0..self.dirty.len() {
                    for j in i + 1..self.dirty.len() {
                        let cost = self.dirty[i].joined(&self.dirty[j]).volume() - self.dirty[i].volume() - self.dirty[j].volume();
                        if cost < best {
                            (best, pair) = (cost, (i, j));
                        }
                    }
                }
                let other = self.dirty.swap_remove(pair.1);
                self.dirty[pair.0] = self.dirty[pair.0].joined(&other);
            }
            self.last_dirty = self.dirty.len() - 1;
            return;
        };
        if b.within(&self.dirty[i]) {
            self.last_dirty = i;
            return;
        }
        // Grown, it may reach others: they are one with it.
        let mut all = self.dirty.swap_remove(i).joined(&b);
        let mut k = 0;
        while k < self.dirty.len() {
            if all.near(&self.dirty[k]) {
                all = all.joined(&self.dirty.swap_remove(k));
                k = 0;
            } else {
                k += 1;
            }
        }
        self.dirty.push(all);
        self.last_dirty = self.dirty.len() - 1;
    }

    fn mark_layer(&mut self, c: usize, bottom: f32, top: f32) {
        let (x, z) = (self.low[0] + (c % N) as i32 * COL, self.low[1] + (c / N) as i32 * COL);
        self.mark(DirtyBox { min: [x, bottom.floor() as i32, z], max: [x + COL, top.max(bottom).ceil() as i32 + 1, z + COL] });
    }

    /// Where water changed since `clear_dirty`: a few boxes round the pockets that moved, none while it lies still.
    pub fn dirty(&self) -> &[DirtyBox] {
        &self.dirty
    }

    pub fn clear_dirty(&mut self) {
        self.dirty.clear();
        self.last_dirty = 0;
    }

    /// The window: its low corner in the world (x, z), a column's width in cells, columns each way.
    pub fn window(&self) -> [i32; 4] {
        [self.low[0], self.low[1], COL, if self.slot.is_empty() { 0 } else { N as i32 }]
    }

    /// The most wet layers any one column holds.
    pub fn stacked(&self) -> usize {
        self.wet.iter().map(|&e| self.cols[self.slot[(e >> 2) as usize] as usize - 1].known().iter().filter(|l| l.listed).count()).max().unwrap_or(0)
    }

    /// Every wet layer, five words each: its column in the window (x, and z from bit 16), its floor, its top and its
    /// ceiling as floats' bits (cells of the world), then what it is of, which of its column's layers it is (from
    /// bit 8) and how many of them are wet (from bit 16).
    pub fn tell_layers(&self, out: &mut Vec<u32>) {
        out.clear();
        for &e in &self.wet {
            let (c, l) = ((e >> 2) as usize, self.layer(e));
            let stack = self.cols[self.slot[c] as usize - 1].known().iter().filter(|l| l.listed).count() as u32;
            out.extend([(c % N) as u32 | ((c / N) as u32) << 16, l.bottom.to_bits(), l.top().to_bits(), l.ceiling.to_bits(), l.fluid as u32 | (e & 3) << 8 | stack << 16]);
        }
    }

    /// The world changed in a box: a tank there is looked at for holes, and floors there are looked for again.
    fn changed(&mut self, ground: &mut Ground, lo: [i32; 3], hi: [i32; 3]) {
        let mid = [(lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2];
        if let Some(at) = city::tank_near(mid[0], mid[1]) {
            // Within reach of the tank itself, not just in its yard.
            let near = lo[0] <= at[0] + 24 && hi[0] >= at[0] - 24 && lo[2] <= at[2] + 24 && hi[2] >= at[2] - 24 && hi[1] >= at[1] - 4 && lo[1] <= at[1] + TANK_HIGH + 4;
            if near && !self.tanks.iter().any(|t| t.at == at) {
                if self.slot.is_empty() {
                    self.open([at[0], at[2]]);
                }
                self.tanks.push(Tank { at, left: std::f32::consts::PI * (TANK_R * TANK_R * (TANK_HIGH - 2)) as f32, holes: Vec::new() });
            }
        }
        if self.slot.is_empty() {
            return;
        }
        let (x0, x1) = (((lo[0] - self.low[0]).div_euclid(COL)).clamp(0, N as i32) as usize, ((hi[0] - self.low[0]).div_euclid(COL) + 1).clamp(0, N as i32) as usize);
        let (z0, z1) = (((lo[2] - self.low[1]).div_euclid(COL)).clamp(0, N as i32) as usize, ((hi[2] - self.low[1]).div_euclid(COL) + 1).clamp(0, N as i32) as usize);
        // Water lying where the world changed runs again; a tank is looked over again only when the change reaches it.
        // (Asked of every tank on every edit anywhere, a street coming down was thousands of looks at a tank nobody
        // had touched, and water that had come to rest was woken by each.) Only the layers the box meets are
        // looked for again: a wall blown out upstairs leaves the flooded cellar as it lay.
        let (y0, y1) = (lo[1] as f32 - 1.0, hi[1] as f32 + 1.0);
        let mut woke = false;
        // A column beside the box is woken too, though its own floors stand: the wall that was holed held it in.
        for cz in z0.saturating_sub(1)..(z1 + 1).min(N) {
            for cx in x0.saturating_sub(1)..(x1 + 1).min(N) {
                let s = self.slot[cx + N * cz] as usize;
                if s == 0 {
                    continue;
                }
                let col = &mut self.cols[s - 1];
                if !col.known().iter().any(|l| y1 >= l.under && y0 <= l.ceiling.min(l.clear)) {
                    continue;
                }
                let wet = col.known().iter().any(|l| l.listed);
                woke |= wet;
                if cx < x0 || cx >= x1 || cz < z0 || cz >= z1 {
                    continue;
                }
                if wet {
                    (col.stale, self.stale) = (true, true);
                } else {
                    col.n = 0;
                }
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

    /// The wet columns whose world changed have their floors looked for again, each layer's water from where it
    /// lay: with its floor gone it is on the next one down, with whatever was there already.
    fn settle(&mut self, ground: &mut Ground) {
        self.stale = false;
        let mut redo = std::mem::take(&mut self.redo);
        redo.clear();
        for &e in &self.wet {
            let col = &mut self.cols[self.slot[(e >> 2) as usize] as usize - 1];
            if col.stale {
                (col.stale, col.again) = (false, true);
                redo.push(e >> 2);
            }
        }
        if !redo.is_empty() {
            let (slot, cols) = (&self.slot, &self.cols);
            self.wet.retain(|&e| !cols[slot[(e >> 2) as usize] as usize - 1].again);
        }
        for &c in &redo {
            let c = c as usize;
            let s = self.slot[c] as usize - 1;
            let old = self.cols[s];
            self.cols[s] = Column::NEW;
            for l in old.known().iter().filter(|l| l.listed) {
                let (_, k) = self.layer_for(ground, c, l.bottom as i32);
                let to = &mut self.cols[s].layers[k];
                if to.height <= FILM {
                    (to.fluid, to.flow) = (l.fluid, l.flow);
                }
                to.height += l.height;
                to.displacement += l.displacement;
                let (bottom, top) = (to.bottom.min(l.bottom), to.top().max(l.top()));
                if !to.listed {
                    to.listed = true;
                    self.wet.push((c as u32) << 2 | k as u32);
                }
                self.mark_layer(c, bottom, top);
            }
        }
        self.redo = redo;
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

    /// Water onto a column, from a height: onto whichever of its floors is under there.
    fn pour(&mut self, ground: &mut Ground, c: usize, cells: f32, from: i32, fluid: u8) {
        let (s, k) = self.layer_for(ground, c, from);
        let l = &mut self.cols[s].layers[k];
        if l.height <= FILM {
            l.fluid = fluid;
        }
        let deep = cells / (COL * COL) as f32;
        l.height += deep;
        l.stirred += deep;
        if !l.listed {
            l.listed = true;
            self.wet.push((c as u32) << 2 | k as u32);
        }
    }

    /// Water from anywhere (#226): `cells` of it let go at a place in the world, onto the floor under there. The
    /// window opens round the first of it. Whether it was in the window.
    pub fn pour_at(&mut self, ground: &mut Ground, x: i32, y: i32, z: i32, cells: f32, fluid: u8) -> bool {
        if !(cells > 0.0) {
            return false;
        }
        if self.slot.is_empty() {
            self.open([x, z]);
        }
        let Some(c) = self.column(x, z) else { return false };
        self.pour(ground, c, cells, y, fluid);
        (self.awake, self.still) = (true, 0.0);
        true
    }

    /// A body in the water at a place pushes `cells` of it aside: the layer it is in stands that much higher to its
    /// neighbours for a moment, and the water runs out from under it. Whether there was water there.
    pub fn displace(&mut self, x: f32, y: f32, z: f32, cells: f32) -> bool {
        let Some(idx) = self.column_at(x, z) else { return false };
        let s = self.slot[idx] as usize;
        if s == 0 {
            return false;
        }
        let col = &mut self.cols[s - 1];
        let mut best: Option<usize> = None;
        for k in 0..col.n as usize {
            let l = &col.layers[k];
            if l.listed && l.bottom <= y && best.is_none_or(|b| l.bottom > col.layers[b].bottom) {
                best = Some(k);
            }
        }
        let Some(k) = best else { return false };
        let l = &mut col.layers[k];
        l.displacement = (l.displacement + cells / (COL * COL) as f32).clamp(0.0, 8.0);
        (self.awake, self.still) = (true, 0.0);
        true
    }

    fn step(&mut self, ground: &mut Ground, dt: f32) {
        if self.stale {
            self.settle(ground);
        }
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
                self.pour(ground, c, out, at[1] + high as i32, FRESH);
            }
            self.tanks[k].holes = holes;
        }
        // What leaves each wet layer, from where everything stands now. It goes to the layer of each neighbour that
        // its own top is in: over a ledge that is the floor far below, under a deck it is the room under the deck.
        let n = self.wet.len();
        let mut moved = 0.0f32;
        for w in 0..n {
            let e = self.wet[w];
            let (i, k) = ((e >> 2) as usize, (e & 3) as usize);
            let s = self.slot[i] as usize - 1;
            let l = self.cols[s].layers[k];
            let (cx, cz) = (i % N, i / N);
            if cx == 0 || cz == 0 || cx == N - 1 || cz == N - 1 || l.bottom <= 0.0 {
                // Out of the window, or down at the sea's own level: it is gone.
                self.sunk += l.height * (COL * COL) as f32;
                let l = &mut self.cols[s].layers[k];
                (l.height, l.flow) = (0.0, [0.0; 4]);
                continue;
            }
            let h = l.head();
            // Thin water drags on what it runs over.
            let drag = 1.0 / (1.0 + dt * 2.5 / l.height.max(0.25));
            let probe = h.min(l.ceiling - 1.0).max(l.bottom) as i32;
            let (mut out, mut link) = ([0.0f32; 4], [0u8; 4]);
            for (d, j) in [i + 1, i - 1, i + N, i - N].into_iter().enumerate() {
                let (sj, kj) = self.layer_for(ground, j, probe);
                let fall = h - self.cols[sj].layers[kj].head();
                out[d] = (l.flow[d] * drag + dt * G * COL as f32 * fall).max(0.0);
                link[d] = kj as u8;
            }
            let (all, have) = (out.iter().sum::<f32>() * dt, l.height * (COL * COL) as f32);
            if all > have {
                let part = have / all;
                out = out.map(|f| f * part);
            }
            let l = &mut self.cols[s].layers[k];
            (l.flow, l.link) = (out, link);
        }
        for w in 0..n {
            let e = self.wet[w];
            let (i, k) = ((e >> 2) as usize, (e & 3) as usize);
            let s = self.slot[i] as usize - 1;
            let (flow, link, fluid) = (self.cols[s].layers[k].flow, self.cols[s].layers[k].link, self.cols[s].layers[k].fluid);
            let mut gone = 0.0f32;
            for (d, j) in [i + 1, i - 1, i + N, i - N].into_iter().enumerate() {
                let v = flow[d] * dt / (COL * COL) as f32;
                if v <= 0.0 {
                    continue;
                }
                gone += v;
                let to = &mut self.cols[self.slot[j] as usize - 1].layers[link[d] as usize];
                if to.height <= FILM {
                    to.fluid = fluid;
                }
                to.height += v;
                to.stirred += v;
                if !to.listed {
                    to.listed = true;
                    self.wet.push((j as u32) << 2 | link[d] as u32);
                }
            }
            if gone > 0.0 {
                moved += gone;
                let l = &mut self.cols[s].layers[k];
                l.height -= gone;
                l.stirred += gone;
            }
        }
        // It soaks into what it lies on, as fast as that takes it, and a film of it is gone.
        let ease = (1.0 - dt * DISPLACED_EASES).max(0.0);
        let (mut soaked, mut kept, mut drinking) = (0.0f32, 0usize, false);
        for w in 0..self.wet.len() {
            let e = self.wet[w];
            let c = (e >> 2) as usize;
            let l = &mut self.cols[self.slot[c] as usize - 1].layers[(e & 3) as usize];
            let lost = (l.soaks * dt).min(l.height);
            l.height -= lost;
            l.stirred += lost;
            soaked += lost;
            drinking |= l.soaks > SOAKS;
            if l.displacement != 0.0 {
                l.displacement *= ease;
                if l.displacement < 1e-3 {
                    l.displacement = 0.0;
                }
            }
            let stirred = std::mem::take(&mut l.stirred) > STIRRED;
            let (bottom, top) = (l.bottom, l.top());
            let gone = l.height < FILM && l.flow.iter().all(|&f| f < 0.5);
            if gone {
                soaked += l.height;
                (l.height, l.flow, l.displacement, l.listed) = (0.0, [0.0; 4], 0.0, false);
            } else {
                self.wet[kept] = e;
                kept += 1;
            }
            if stirred || gone {
                self.mark_layer(c, bottom, top);
            }
        }
        self.wet.truncate(kept);
        self.soaked += soaked * (COL * COL) as f32;
        // A tank is letting water out while any hole in it is under what is left.
        let leaking = self.tanks.iter().any(|t| {
            let level = t.left / (std::f32::consts::PI * (TANK_R * TANK_R) as f32);
            t.holes.iter().any(|&(_, high, _)| level - high > DRIBBLE)
        });
        // Water on ground that drinks it is not at rest until it is gone: asleep, a pool on sand would lie for ever.
        self.still = if leaking || drinking || moved > 0.02 * self.wet.len().max(1) as f32 * dt { 0.0 } else { self.still + dt };
        self.steps += 1;
    }

    /// What the page is told: the window, then for each column of the box round the wet ones a word: how high the
    /// water's top is over `base` in eighths of a cell (18 bits), how deep in sixteenths (8 bits), how fast it runs
    /// in pairs of cells a second (5 bits), and whether it lies over other water (1 bit, #226). A dry column is 0.
    /// Where water lies over water the word is of the top-most: the layers under it are told as a distance field
    /// (`sdf_bricks`).
    fn tell(&self) -> Vec<u32> {
        let (mut x0, mut z0, mut x1, mut z1) = (N, N, 0, 0);
        for &e in &self.wet {
            let (cx, cz) = ((e >> 2) as usize % N, (e >> 2) as usize / N);
            (x0, z0, x1, z1) = (x0.min(cx), z0.min(cz), x1.max(cx + 1), z1.max(cz + 1));
        }
        if self.wet.is_empty() {
            (x0, z0, x1, z1) = (0, 0, 0, 0);
        }
        let base = self.tanks.first().map_or(0, |t| city::ground(t.at[0], t.at[2])) - 800;
        let (w, h) = (x1 - x0, z1 - z0);
        let mut words = vec![self.low[0] as u32, self.low[1] as u32, COL as u32, N as u32, base as u32, x0 as u32, z0 as u32, w as u32, h as u32];
        words.resize(9 + w * h, 0);
        for &e in &self.wet {
            let (i, l) = ((e >> 2) as usize, self.layer(e));
            let (cx, cz) = (i % N, i / N);
            let top = ((l.top() - base as f32) * 8.0).clamp(1.0, 262143.0) as u32;
            let deep = (l.height * 16.0).clamp(1.0, 255.0) as u32;
            let f = l.flow;
            let fast = (((f[0] - f[1]).hypot(f[2] - f[3]) / (l.height.max(0.1) * COL as f32)) / 2.0).min(31.0) as u32;
            // Over other water, and not running off an edge onto water below: it is a storey of its own, and the
            // page does not join its top to the tops of the storey under it (there is a deck between them).
            let col = &self.cols[self.slot[i] as usize - 1];
            let falls = [i + 1, i - 1, i + N, i - N].into_iter().enumerate().any(|(d, j)| f[d] > 0.5 && self.col(j).is_some_and(|c| c.layers[l.link[d] as usize].bottom < l.bottom - 2.0));
            let over = (col.known().iter().any(|o| o.listed && o.bottom < l.bottom) && !falls) as u32;
            let word = &mut words[9 + (cx - x0) + w * (cz - z0)];
            if *word & 0x3ffff < top {
                *word = top | deep << 18 | fast << 26 | over << 31;
            }
        }
        words
    }

    // ── The water as a distance field, in bricks (#226) ──────────────────────────────────────────────────────────
    //
    // A voxel of the field is a column wide each way (`COL` cells), and a brick is `BRICK` voxels a side with one
    // more all round: `BRICK_SIDE` cubed bytes. Sample `i` of brick `b` along an axis is at `(b * BRICK - 1 + i +
    // 0.5)` voxels, times two for each step of `lod`: a place in the world and nothing else, so two bricks side
    // by side hold the same numbers where they overlap, and reading between samples has no seam. x and z count
    // from the window's low corner, y from the world's zero. A byte is the distance to the water's surface in
    // `SDF_REACH / 127` of that brick's voxel: under zero inside the water.

    /// Of which layers the field is: all of them, or (as it begins) only those under other water in their column,
    /// which the heights told to the page cannot show.
    pub fn sdf_cover(&mut self, all: bool) {
        self.sdf_all = all;
    }

    #[inline]
    fn in_field(&self, col: &Column, l: &WaterLayer) -> bool {
        l.listed && (self.sdf_all || col.known().iter().any(|o| o.listed && o.bottom > l.bottom))
    }

    /// The bricks (finest) that hold some of the field's surface: the tops of its layers, and their sides where
    /// the water beside them stands lower or there is none.
    pub fn sdf_bricks(&mut self) -> &[[i32; 3]] {
        if self.bricks_at == Some((self.version, self.sdf_all)) {
            return &self.bricks;
        }
        let mut keys = std::mem::take(&mut self.brick_keys);
        keys.clear();
        let unit = COL as f32;
        for &e in &self.wet {
            let i = (e >> 2) as usize;
            let col = &self.cols[self.slot[i] as usize - 1];
            let l = &col.layers[(e & 3) as usize];
            if !self.in_field(col, l) {
                continue;
            }
            let (cx, cz) = ((i % N) as i32, (i / N) as i32);
            let (bottom, top) = (l.bottom / unit, l.top() / unit);
            // Its side shows down to the lowest water beside it, or to its floor.
            let mut low = top;
            for j in [i + 1, i - 1, i + N, i - N] {
                let beside = self.col(j).and_then(|c| c.known().iter().filter(|o| self.in_field(c, o) && o.bottom / unit <= top && o.top() / unit >= bottom).map(|o| o.top() / unit).reduce(f32::max));
                low = low.min(beside.unwrap_or(bottom).max(bottom));
            }
            let (y0, y1) = (((low - 0.5).floor() as i32).div_euclid(BRICK), ((top + 0.5).floor() as i32).div_euclid(BRICK));
            for bz in (cz - 1).div_euclid(BRICK)..=(cz + 1).div_euclid(BRICK) {
                for bx in (cx - 1).div_euclid(BRICK)..=(cx + 1).div_euclid(BRICK) {
                    for by in y0..=y1.min(y0 + 255) {
                        keys.push(bx as u64 | (bz as u64) << 8 | ((by + (1 << 24)) as u64) << 16);
                    }
                }
            }
        }
        keys.sort_unstable();
        keys.dedup();
        self.bricks.clear();
        self.bricks.extend(keys.iter().map(|&k| [(k & 255) as i32, (k >> 16) as i32 - (1 << 24), (k >> 8 & 255) as i32]));
        self.brick_keys = keys;
        self.bricks_at = Some((self.version, self.sdf_all));
        &self.bricks
    }

    /// Makes one brick of the field (see above): `BRICK_BYTES` bytes, x fastest, then y, then z. What it holds:
    /// 0 nothing (no water within reach), 1 only water, 2 only air near water, 3 a surface.
    pub fn sdf_brick(&mut self, b: [i32; 3], lod: u32, out: &mut [i8]) -> u32 {
        assert!(out.len() >= BRICK_BYTES);
        let step = 1i32 << lod.min(SDF_LODS - 1);
        let (stepf, reach) = (step as f32, SDF_REACH * step as f32);
        let at = |b: i32, i: usize| (b * BRICK - 1 + i as i32) as f32 * stepf + 0.5 * stepf;
        // The columns within reach of any sample, and what each holds: its layers' floors and tops, in voxels.
        let r = reach.ceil() as i32;
        let (x0, z0) = (at(b[0], 0).floor() as i32 - r, at(b[2], 0).floor() as i32 - r);
        let w = (at(b[0], BRICK_SIDE - 1).floor() as i32 + r - x0 + 1) as usize;
        let mut spans = std::mem::take(&mut self.spans);
        spans.clear();
        spans.resize(w * w, [f32::INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::NEG_INFINITY]);
        let (unit, mut any) = (COL as f32, false);
        for dz in 0..w {
            let cz = z0 + dz as i32;
            if cz < 0 || cz >= N as i32 || self.slot.is_empty() {
                continue;
            }
            for dx in 0..w {
                let cx = x0 + dx as i32;
                if cx < 0 || cx >= N as i32 {
                    continue;
                }
                let Some(col) = self.col(cx as usize + N * cz as usize) else { continue };
                let mut k = 0;
                for l in col.known() {
                    if self.in_field(col, l) {
                        // A voxel down into its floor is still it: a film has an inside, and what it lies on hides the rest.
                        (spans[dx + w * dz][k], spans[dx + w * dz][k + 1]) = (l.bottom / unit - 1.0, l.top() / unit);
                        k += 2;
                        any = true;
                    }
                }
            }
        }
        if !any {
            out[..BRICK_BYTES].fill(127);
            self.spans = spans;
            return 0;
        }
        let (reach2, scale) = (reach * reach, 127.0 / reach);
        let mut held = 0;
        for iz in 0..BRICK_SIDE {
            let pz = at(b[2], iz);
            for ix in 0..BRICK_SIDE {
                let px = at(b[0], ix);
                // For each height: how near water is, how near a place with none, and how far under a top it is.
                let (mut water, mut air, mut under) = ([reach2; BRICK_SIDE], [reach2; BRICK_SIDE], [f32::NEG_INFINITY; BRICK_SIDE]);
                for cz in (pz - reach).floor() as i32..=((pz + reach).ceil() as i32 - 1) {
                    let gz = ((pz - (cz as f32 + 0.5)).abs() - 0.5).max(0.0);
                    for cx in (px - reach).floor() as i32..=((px + reach).ceil() as i32 - 1) {
                        let gx = ((px - (cx as f32 + 0.5)).abs() - 0.5).max(0.0);
                        let g2 = gx * gx + gz * gz;
                        if g2 >= reach2 {
                            continue;
                        }
                        let span = &spans[(cx - x0) as usize + w * (cz - z0) as usize];
                        for iy in 0..BRICK_SIDE {
                            let py = at(b[1], iy);
                            let mut over = f32::INFINITY;
                            for k in (0..2 * MAX_LAYERS).step_by(2) {
                                let gap = (span[k] - py).max(py - span[k + 1]);
                                if gap <= 0.0 && g2 == 0.0 {
                                    under[iy] = under[iy].max(span[k + 1] - py);
                                }
                                over = over.min(gap.max(0.0));
                            }
                            if over > 0.0 {
                                air[iy] = air[iy].min(g2);
                            }
                            water[iy] = water[iy].min(g2 + over * over);
                        }
                    }
                }
                for iy in 0..BRICK_SIDE {
                    // Inside: as far as the nearer of its top and its side. Outside: as far as the nearest water.
                    let d = if water[iy] == 0.0 && under[iy] >= 0.0 { -under[iy].min(air[iy].sqrt()) } else { water[iy].sqrt() };
                    let v = (d * scale).round().clamp(-127.0, 127.0) as i8;
                    held |= if v < 0 { 1 } else if v < 127 { 2 } else { 0 };
                    out[ix + BRICK_SIDE * (iy + BRICK_SIDE * iz)] = v;
                }
            }
        }
        self.spans = spans;
        held
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
    // ── Water over water (#226) ──

    /// A place in the sky over the yard, where nothing of the town is: the checks build what they need there.
    fn sky() -> [i32; 3] {
        let (x, z) = (YARD.0 * BLOCK_X + YARD_TOWER.0, YARD.1 * BLOCK_Z + YARD_TOWER.1);
        [x, city::ground(x, z) + 1500, z]
    }

    /// A box of the world filled with a material (high corner exclusive).
    fn fill(bodies: &mut Bodies, lo: [i32; 3], hi: [i32; 3], stuff: u8) {
        let k = crate::kinds::kind(stuff, crate::kinds::OWN);
        let runs = (lo[1]..hi[1]).flat_map(|y| (lo[2]..hi[2]).map(move |z| crate::scratch::Run { x0: lo[0], x1: hi[0], y, z, kind: k })).collect();
        bodies.ground.push(crate::Edit::Runs(runs), false, None);
    }

    /// A basin at `at`: a floor `w` by `d` cells with walls `high` cells tall round it. Its floor's top is at `at[1]`.
    fn basin(bodies: &mut Bodies, at: [i32; 3], w: i32, d: i32, high: i32, stuff: u8) {
        use crate::kinds::CONCRETE;
        fill(bodies, [at[0] - 2, at[1] - 2, at[2] - 2], [at[0] + w + 2, at[1], at[2] + d + 2], stuff);
        for (lo, hi) in [([-2, 0, -2], [w + 2, high, 0]), ([-2, 0, d], [w + 2, high, d + 2]), ([-2, 0, 0], [0, high, d]), ([w, 0, 0], [w + 2, high, d])] {
            fill(bodies, [at[0] + lo[0], at[1] + lo[1], at[2] + lo[2]], [at[0] + hi[0], at[1] + hi[1], at[2] + hi[2]], CONCRETE);
        }
    }

    fn run(bodies: &mut Bodies, seconds: f32) {
        for _ in 0..(seconds * 60.0) as usize {
            bodies.out.clear();
            bodies.flow(1.0 / 60.0);
        }
    }

    fn wet_layers(w: &Water, x: i32, z: i32) -> Vec<WaterLayer> {
        let mut all: Vec<WaterLayer> = w.layers_at(x as f32 + 0.5, z as f32 + 0.5).iter().filter(|l| l.height > FILM).copied().collect();
        all.sort_by(|a, b| a.bottom.total_cmp(&b.bottom));
        all
    }

    /// A channel with a deck across its middle: water let go upstream runs under the deck and out the far side, water
    /// let go on the deck lies on it, and a column of the deck holds both at once.
    #[test]
    fn water_runs_over_a_bridge_and_under_it_at_once() {
        use crate::kinds::CONCRETE;
        let at = sky();
        let mut bodies = Bodies::new();
        basin(&mut bodies, at, 60, 12, 30, CONCRETE);
        // The deck: two cells thick, ten cells over the floor, with a kerb at each end so that what is on it stays.
        fill(&mut bodies, [at[0] + 20, at[1] + 10, at[2]], [at[0] + 40, at[1] + 12, at[2] + 12], CONCRETE);
        fill(&mut bodies, [at[0] + 20, at[1] + 12, at[2]], [at[0] + 22, at[1] + 16, at[2] + 12], CONCRETE);
        fill(&mut bodies, [at[0] + 38, at[1] + 12, at[2]], [at[0] + 40, at[1] + 16, at[2] + 12], CONCRETE);
        let (g, w) = (&mut bodies.ground, &mut bodies.water);
        for z in (1..12).step_by(2) {
            for x in (1..18).step_by(2) {
                assert!(w.pour_at(g, at[0] + x, at[1] + 6, at[2] + z, 16.0, FRESH));
            }
            for x in (23..38).step_by(2) {
                assert!(w.pour_at(g, at[0] + x, at[1] + 20, at[2] + z, 8.0, SEA));
            }
        }
        let poured = 6.0 * 9.0 * 16.0 + 6.0 * 8.0 * 8.0;
        run(&mut bodies, 6.0);
        let w = &bodies.water;
        let mid = wet_layers(w, at[0] + 30, at[2] + 6);
        assert_eq!(mid.len(), 2, "the deck's middle holds water under it and on it: {mid:?}");
        let (under, over) = (mid[0], mid[1]);
        assert_eq!((under.bottom, under.ceiling), (at[1] as f32, at[1] as f32 + 10.0), "the layer under the deck lies on the floor, with the deck's underside for a ceiling");
        assert_eq!((over.bottom, over.ceiling), (at[1] as f32 + 12.0, f32::INFINITY), "the layer on the deck lies on its top under the sky");
        assert_eq!((under.fluid, over.fluid), (FRESH, SEA), "each layer is of what was let go into it");
        assert!(under.top() <= under.ceiling && under.height > 0.5 && over.height > 0.5, "both are real water: {under:?} {over:?}");
        // Only water that went under the deck can be downstream of it: none was let go there, and the deck's is kerbed in.
        let far = wet_layers(w, at[0] + 44, at[2] + 6);
        assert!(far.len() == 1 && far[0].bottom == at[1] as f32 && far[0].height > 0.5 && far[0].fluid == FRESH, "the water ran under the deck and out the far side: {far:?}");
        assert_eq!(w.stacked(), 2);
        // The page is told which columns' water lies over other water, so that it joins no sheet between the two.
        let told = w.tell();
        let word = |x: i32| told[9 + ((at[0] + x - w.low[0]) / COL) as usize - told[5] as usize + told[7] as usize * (((at[2] + 6 - w.low[1]) / COL) as usize - told[6] as usize)];
        assert!(word(30) >> 31 == 1 && word(44) >> 31 == 0 && word(10) >> 31 == 0 && word(20) != 0 && word(20) >> 31 == 0, "the deck's water is told as over other water, the channel's and the water under the kerb as not");
        // What the heights tell is the top-most: on the deck over the deck, on the floor beside it.
        assert_eq!(w.shallow_at(at[0] as f32 + 30.5, at[2] as f32 + 6.5).unwrap().0, at[1] as f32 + 12.0);
        assert_eq!(w.shallow_at(at[0] as f32 + 44.5, at[2] as f32 + 6.5).unwrap().0, at[1] as f32);
        // Something low under the deck is in the pool under it, not on the deck: a fire there is put out.
        assert_eq!(w.shallow_near(at[0] as f32 + 30.5, at[1] as f32 + 2.0, at[2] as f32 + 6.5).unwrap().0, at[1] as f32);
        assert!(w.touches(at[0] as f32 + 30.5, at[1] as f32 + 0.5, at[2] as f32 + 6.5, None));
        assert!(!w.touches(at[0] as f32 + 30.5, at[1] as f32 + 8.5, at[2] as f32 + 6.5, None), "the dry air between the pool and the deck is not water");
        let all = w.held().0 + w.soaked + w.sunk;
        assert!((all - poured).abs() < poured * 0.002, "{all:.1} cells are accounted for, of {poured:.1}");
    }

    /// An upper floor over half a basin: water let go on it runs to its edge, falls to the floor below, and floods
    /// back in under the floor it fell from.
    #[test]
    fn water_falls_from_an_upper_floor_and_floods_the_one_below() {
        use crate::kinds::CONCRETE;
        let at = sky();
        let mut bodies = Bodies::new();
        basin(&mut bodies, at, 48, 12, 40, CONCRETE);
        fill(&mut bodies, [at[0], at[1] + 20, at[2]], [at[0] + 24, at[1] + 22, at[2] + 12], CONCRETE);
        let poured = 6.0 * 5.0 * 40.0;
        for z in (1..12).step_by(2) {
            for x in (1..10).step_by(2) {
                bodies.water.pour_at(&mut bodies.ground, at[0] + x, at[1] + 30, at[2] + z, 40.0, FRESH);
            }
        }
        // While it runs, the edge column holds the fall: its water goes by a pipe into the floor far below.
        run(&mut bodies, 1.5);
        let w = &bodies.water;
        let edge = wet_layers(w, at[0] + 22, at[2] + 6);
        assert!(edge.last().is_some_and(|l| l.bottom == at[1] as f32 + 22.0 && l.flow[0] > 0.0), "water runs off the upper floor's edge: {edge:?}");
        let landing = wet_layers(w, at[0] + 24, at[2] + 6);
        assert!(landing.len() == 1 && landing[0].bottom == at[1] as f32 && landing[0].height > FILM, "it lands on the floor below: {landing:?}");
        run(&mut bodies, 20.0);
        let w = &bodies.water;
        let below = wet_layers(w, at[0] + 6, at[2] + 6);
        assert!(below.first().is_some_and(|l| l.bottom == at[1] as f32 && l.ceiling == at[1] as f32 + 20.0 && l.height > 0.3), "the floor below is flooded under the one above: {below:?}");
        let open = wet_layers(w, at[0] + 40, at[2] + 6);
        assert!(open.len() == 1 && (open[0].top() - below[0].top()).abs() < 0.2, "the lower pool lies level, under the upper floor and beside it: {open:?} {below:?}");
        let (lower, upper): (f32, f32) = w.wet.iter().map(|&e| w.layer(e)).fold((0.0, 0.0), |(lo, up), l| if l.bottom < at[1] as f32 + 10.0 { (lo + l.height * 4.0, up) } else { (lo, up + l.height * 4.0) });
        assert!(lower > poured * 0.8 && upper < poured * 0.2, "most of it came down: {lower:.0} cells below, {upper:.0} above, of {poured:.0}");
        let all = w.held().0 + w.soaked + w.sunk;
        assert!((all - poured).abs() < poured * 0.002, "{all:.1} cells are accounted for, of {poured:.1}");
    }

    /// The same water in the same basin on six floors: sand and earth drink it, concrete and stone hold the pool.
    #[test]
    fn what_water_lies_on_decides_how_fast_it_soaks_away() {
        use crate::kinds::{ASPHALT, CONCRETE, EARTH, GRASS, ROCK, SAND};
        let left = |stuff: u8| {
            let at = sky();
            let mut bodies = Bodies::new();
            basin(&mut bodies, at, 24, 24, 12, stuff);
            let poured = 144.0 * 12.0;
            for z in (1..24).step_by(2) {
                for x in (1..24).step_by(2) {
                    bodies.water.pour_at(&mut bodies.ground, at[0] + x, at[1] + 4, at[2] + z, 12.0, FRESH);
                }
            }
            run(&mut bodies, 10.0);
            let (held, w) = (bodies.water.held().0, &bodies.water);
            assert!((held + w.soaked + w.sunk - poured).abs() < poured * 0.002, "what soaked away is accounted for");
            held / poured
        };
        let (sand, earth, grass, concrete, rock, asphalt) = (left(SAND), left(EARTH), left(GRASS), left(CONCRETE), left(ROCK), left(ASPHALT));
        eprintln!("left of a 3-cell pool after 10 s: sand {sand:.3}, earth {earth:.3}, grass {grass:.3}, concrete {concrete:.3}, rock {rock:.3}, asphalt {asphalt:.3}");
        assert!(concrete > 0.99 && rock > 0.99 && asphalt > 0.99, "stone, concrete and asphalt hold a pool");
        assert!(sand < 0.65 && sand < earth - 0.1, "sand drinks it fastest");
        assert!(earth < concrete - 0.1 && grass < concrete - 0.05 && earth < grass, "earth and grass take it measurably faster than concrete");
    }

    /// Two pools far apart: the boxes of what changed are round each, not round both, and there are none once the
    /// water lies still.
    #[test]
    fn dirty_boxes_keep_to_where_water_moves_and_are_none_when_it_is_still() {
        use crate::kinds::CONCRETE;
        let at = sky();
        let far = [at[0] + 300, at[1] + 40, at[2] + 200];
        let mut bodies = Bodies::new();
        basin(&mut bodies, at, 20, 20, 12, CONCRETE);
        basin(&mut bodies, far, 20, 20, 12, CONCRETE);
        run(&mut bodies, 0.1);
        assert!(bodies.water.dirty().is_empty(), "nothing has changed where there is no water");
        for (c, n) in [(at, 5), (far, 4)] {
            for k in 0..n * n {
                bodies.water.pour_at(&mut bodies.ground, c[0] + 3 + 3 * (k % n), c[1] + 3, c[2] + 3 + 3 * (k / n), 24.0, FRESH);
            }
        }
        run(&mut bodies, 1.0);
        let boxes = bodies.water.dirty().to_vec();
        assert_eq!(boxes.len(), 2, "one box a pool: {boxes:?}");
        for b in &boxes {
            let c = if b.min[0] < at[0] + 100 { at } else { far };
            assert!(b.min[0] >= c[0] - 2 && b.max[0] <= c[0] + 22 && b.min[2] >= c[2] - 2 && b.max[2] <= c[2] + 22, "a box keeps to its basin: {b:?} round {c:?}");
            assert!(b.min[1] >= c[1] && b.max[1] <= c[1] + 9, "and to the height of its water: {b:?} over {}", c[1]);
        }
        // Until someone has read them they are kept, however long the water runs: never more than a few.
        run(&mut bodies, 2.0);
        assert!(bodies.water.dirty().len() <= DIRTY_CAP);
        // Water let go at many places is still a few boxes.
        let mut w = Water::default();
        for k in 0..40 {
            w.mark(DirtyBox { min: [k * 50, 0, (k % 7) * 60], max: [k * 50 + 2, 3, (k % 7) * 60 + 2] });
        }
        assert_eq!(w.dirty().len(), DIRTY_CAP);
        // It comes to rest in its basins, and from then on nothing is marked.
        let mut t = 0.0;
        while bodies.water.flowing() && t < 60.0 {
            run(&mut bodies, 1.0);
            t += 1.0;
        }
        assert!(!bodies.water.flowing(), "the pools came to rest");
        bodies.water.clear_dirty();
        let version = bodies.water.version;
        run(&mut bodies, 2.0);
        assert!(bodies.water.dirty().is_empty() && bodies.water.version == version, "still water marks nothing");
        // A hole in one basin's wall wakes that pool alone.
        fill(&mut bodies, [at[0] + 20, at[1], at[2] + 8], [at[0] + 22, at[1] + 4, at[2] + 12], 0);
        run(&mut bodies, 1.0);
        let boxes = bodies.water.dirty();
        assert!(!boxes.is_empty() && boxes.iter().all(|b| b.max[0] < at[0] + 100), "only the pool whose wall was holed runs: {boxes:?}");
    }

    /// A still pool as a brick of the distance field: it goes through zero where the water's top is, evenly, and
    /// two bricks side by side agree where they overlap.
    #[test]
    fn a_brick_of_the_distance_field_crosses_zero_smoothly_at_the_surface() {
        use crate::kinds::CONCRETE;
        let at = sky();
        let mut bodies = Bodies::new();
        basin(&mut bodies, at, 40, 40, 12, CONCRETE);
        for z in (1..40).step_by(2) {
            for x in (1..40).step_by(2) {
                bodies.water.pour_at(&mut bodies.ground, at[0] + x, at[1] + 3, at[2] + z, 4.0 * 3.3, FRESH);
            }
        }
        run(&mut bodies, 4.0);
        let w = &mut bodies.water;
        // As it begins the field is only of water under other water: a single pool is the heights' to show.
        assert!(w.sdf_bricks().is_empty());
        w.sdf_cover(true);
        let surface = w.shallow_at(at[0] as f32 + 20.5, at[2] as f32 + 20.5).map(|(floor, deep, _)| floor + deep).unwrap();
        assert!((surface - (at[1] as f32 + 3.3)).abs() < 0.05, "the pool lies level at {surface}");
        let bricks = w.sdf_bricks().to_vec();
        let (low, voxel) = (w.window(), COL as f32);
        let (cx, cz) = ((at[0] + 20 - low[0]) / COL, (at[2] + 20 - low[1]) / COL);
        let b = [cx / BRICK, ((surface / voxel).floor() as i32).div_euclid(BRICK), cz / BRICK];
        assert!(bricks.contains(&b), "the brick the surface is in is one of the {} that hold it", bricks.len());
        assert!(bricks.len() < 200 && bricks.iter().all(|k| (k[1] - b[1]).abs() <= 1), "and they are the few round the surface, not the whole pool");
        let mut brick = [0i8; BRICK_BYTES];
        assert_eq!(w.sdf_brick(b, 0, &mut brick), 3, "it holds a surface");
        // Up through the brick's middle: one even ramp through zero, at the water's top.
        let at_y = |i: usize| ((b[1] * BRICK - 1 + i as i32) as f32 + 0.5) * voxel;
        let column: Vec<f32> = (0..BRICK_SIDE).map(|iy| brick[4 + BRICK_SIDE * (iy + BRICK_SIDE * 4)] as f32 * SDF_REACH * voxel / 127.0).collect();
        let k = (0..BRICK_SIDE - 1).find(|&k| column[k] < 0.0 && column[k + 1] >= 0.0).expect("it changes sign once going up");
        let zero = at_y(k) + (at_y(k + 1) - at_y(k)) * column[k] / (column[k] - column[k + 1]);
        assert!((zero - surface).abs() < 0.08, "the field is zero at {zero:.3}, the water's top is at {surface:.3}");
        for i in 0..BRICK_SIDE - 1 {
            let rise = column[i + 1] - column[i];
            // At the end of its reach it stays there.
            let ended = column[i].abs().max(column[i + 1].abs()) >= SDF_REACH * voxel - 0.05;
            assert!(rise >= -0.02 && (ended || (rise - voxel).abs() < 0.08), "it rises a cell for a cell, with no step in it: {column:?}");
        }
        // Along the level surface it is the same everywhere.
        assert!((0..BRICK_SIDE).all(|ix| brick[ix + BRICK_SIDE * (k + BRICK_SIDE * 4)] == brick[4 + BRICK_SIDE * (k + BRICK_SIDE * 4)]));
        // The brick beside it holds the same numbers where their borders overlap.
        let mut next = [0i8; BRICK_BYTES];
        w.sdf_brick([b[0] + 1, b[1], b[2]], 0, &mut next);
        for iz in 0..BRICK_SIDE {
            for iy in 0..BRICK_SIDE {
                assert_eq!((brick[6 + BRICK_SIDE * (iy + BRICK_SIDE * iz)], brick[7 + BRICK_SIDE * (iy + BRICK_SIDE * iz)]), (next[BRICK_SIDE * (iy + BRICK_SIDE * iz)], next[1 + BRICK_SIDE * (iy + BRICK_SIDE * iz)]));
            }
        }
        // A coarser brick of the same place crosses zero at the same height.
        let coarse = [b[0].div_euclid(2), b[1].div_euclid(2), b[2].div_euclid(2)];
        assert_eq!(w.sdf_brick(coarse, 1, &mut next), 3);
        let at_y = |i: usize| ((coarse[1] * BRICK - 1 + i as i32) as f32 + 0.5) * voxel * 2.0;
        let column: Vec<f32> = (0..BRICK_SIDE).map(|iy| next[4 + BRICK_SIDE * (iy + BRICK_SIDE * 4)] as f32 * SDF_REACH * voxel * 2.0 / 127.0).collect();
        let k = (0..BRICK_SIDE - 1).find(|&k| column[k] < 0.0 && column[k + 1] >= 0.0).expect("the coarser one changes sign too");
        let zero = at_y(k) + (at_y(k + 1) - at_y(k)) * column[k] / (column[k] - column[k + 1]);
        assert!((zero - surface).abs() < 0.15, "the coarser field is zero at {zero:.3}, the water's top is at {surface:.3}");
        // Far from any water a brick is nothing.
        assert_eq!(w.sdf_brick([b[0], b[1] + 9, b[2]], 0, &mut next), 0);
        assert!(next.iter().all(|&v| v == 127));
    }
}
