//! Spatial visual & acoustic perception over Voxelwright's live 10 cm cell world (#164).
//!
//! Provides:
//! 1. **Exact 3D Amanatides-Woo DDA Line-of-Sight** (`has_los`, `los_hit`) treating air (`0`),
//!    water (`5`), and glass (`11`) as transparent (`kind & 15`), matching `engine/rules/sight.mjs`.
//! 2. **Acoustic Voxel-Wall Attenuation** (`acoustic_attenuation`) combining inverse-distance
//!    falloff `(1 - d/R)^1.5` with per-material exponential absorption `exp(-sum(att * seg_len))`,
//!    matching `engine/rules/stimulus.mjs`.
//! 3. **Batch Spatial Vision** (`VisionBatch`) over a contiguous `256`-agent SoA linear-memory
//!    buffer (`x, y, z, yaw, lod_ring, flags`), with zero-allocation uniform XZ spatial hashing,
//!    FOV cone (`WIDE = -0.2`, `NOTICED = 25` cells), Ring 1/2/3 LOD filtering, and eye-to-head
//!    / eye-to-chest DDA raymarching with exact single-voxel chest rejection.

use crate::bodies::{self, Ground, Mix};
use crate::kinds::{GLASS, WATER};
use crate::support::Region;
use crate::tree::Kind;
use crate::Edit;
use std::cell::RefCell;
use std::collections::HashMap;
use std::hash::BuildHasherDefault;

/// Eye height above an actor's feet in fine cells (1.6 m, matching `sight.mjs`).
pub const EYES: f32 = 16.0;
/// Head target height above an actor's feet in fine cells (1.6 m, matching `sight.mjs`).
pub const HEAD: f32 = 16.0;
/// Chest target height above an actor's feet in fine cells (1.1 m, matching `sight.mjs`).
pub const CHEST: f32 = 11.0;
/// Default sight range in fine cells (60 m, matching `sight.mjs`).
pub const SIGHT_RANGE: f32 = 600.0;
/// Cosine of half the horizontal field-of-view angle (`-0.2`, matching `sight.mjs`).
pub const WIDE: f32 = -0.2;
/// Proximity radius within which another body is noticed regardless of facing yaw (`25` cells = 2.5 m).
pub const NOTICED: f32 = 25.0;

/// Maximum agents supported in the contiguous SoA batch vision buffer.
pub const VISION_MAX_AGENTS: usize = 256;
/// Number of `f32` planes in the SoA batch vision buffer (`x, y, z, yaw, lod_ring, flags`).
pub const VISION_FIELDS: usize = 6;
/// Total `f32` elements in the SoA batch vision buffer (`256 * 6 = 1536`).
pub const VISION_FLOATS: usize = VISION_MAX_AGENTS * VISION_FIELDS;

// SoA plane indices (each plane has stride `VISION_MAX_AGENTS`):
pub const FIELD_X: usize = 0;
pub const FIELD_Y: usize = 1;
pub const FIELD_Z: usize = 2;
pub const FIELD_YAW: usize = 3;
pub const FIELD_LOD_RING: usize = 4;
pub const FIELD_FLAGS: usize = 5;

/// Agent is an NPC/rule actor (cleared = player/seat).
pub const VISION_FLAG_RULE: u32 = 1 << 0;
/// Skip emitting pairs where this agent is the observer (e.g. Ring 2 deferred tick); still observable as a target.
pub const VISION_FLAG_SKIP_OBS: u32 = 1 << 1;
/// Observer ignores other `VISION_FLAG_RULE` actors (opt-out of actor<->actor sight).
pub const VISION_FLAG_IGNORE_ACTORS: u32 = 1 << 2;
/// Slot is inactive (neither observes nor can be observed).
pub const VISION_FLAG_INACTIVE: u32 = 1 << 3;

/// Early-exit threshold for cumulative acoustic absorption (`exp(-5.5) < 0.0041`, matching `stimulus.mjs`).
const MAX_ABSORPTION: f32 = 5.5;
/// Maximum DDA voxel steps along a single ray (guards against extreme/degenerate inputs).
const MAX_DDA_STEPS: i32 = 8192;

/// Uniform spatial-hash bucket count for batch vision (power of two).
const HASH_BUCKETS: usize = 512;
const HASH_MASK: usize = HASH_BUCKETS - 1;

/// Per-cell (10 cm) acoustic absorption by engine material id (`kind & 15`),
/// matching `MATERIAL_ATTENUATION` in `engine/rules/stimulus.mjs`.
pub const MATERIAL_ATTENUATION: [f32; 16] = [
    0.00, // 0: air
    0.18, // 1: earth
    0.24, // 2: rock
    0.15, // 3: grass
    0.17, // 4: sand
    0.05, // 5: water
    0.22, // 6: asphalt
    0.24, // 7: concrete
    0.20, // 8: brick
    0.14, // 9: plaster
    0.13, // 10: wood
    0.09, // 11: glass (visually clear, dampens sound moderately)
    0.24, // 12: steel
    0.03, // 13: leaves
    0.14, // 14: roofing
    0.10, // 15: lamp
];

/// Abstract voxel lookup used by perception and EQS queries.
/// Allows `Ground` to fast-reject air via its L1-hot sector bitmasks and accelerate batch vision
/// with a 2-level 64³ / 4³ hierarchical opacity cache while synthetic test worlds answer directly.
pub trait VoxelQuery {
    /// Returns `false` when the cell is guaranteed air (`Kind == 0`).
    #[inline]
    fn is_solid_fast(&mut self, x: i32, y: i32, z: i32) -> bool {
        self.voxel_kind(x, y, z) != 0
    }
    /// Returns the full `Kind` of fine cell `(x, y, z)` (`0` for air).
    fn voxel_kind(&mut self, x: i32, y: i32, z: i32) -> Kind;
    /// Optional mutable access to `Ground` for hierarchical 64³ / 4³ batch LOS acceleration.
    #[inline]
    fn as_ground_mut(&mut self) -> Option<&mut Ground> {
        None
    }
}

impl VoxelQuery for Ground {
    #[inline]
    fn is_solid_fast(&mut self, x: i32, y: i32, z: i32) -> bool {
        Ground::solid(self, x, y, z)
    }

    #[inline]
    fn voxel_kind(&mut self, x: i32, y: i32, z: i32) -> Kind {
        Ground::kind(self, x, y, z)
    }

    #[inline]
    fn as_ground_mut(&mut self) -> Option<&mut Ground> {
        Some(self)
    }
}

/// Returns whether a cell kind is visually transparent (air `0`, water `5`, or glass `11`),
/// matching `clear()` in `engine/rules/sight.mjs`.
#[inline]
pub const fn is_visually_clear(k: Kind) -> bool {
    let m = (k & 15) as u8;
    m == 0 || m == WATER || m == GLASS
}

#[inline]
fn dda_axis(origin: f32, delta: f32, cell: i32) -> (i32, f32, f32) {
    if delta.abs() < 1e-8 {
        return (0, f32::INFINITY, f32::INFINITY);
    }
    let inv = 1.0 / delta.abs();
    if delta > 0.0 {
        (1, inv, ((cell + 1) as f32 - origin) * inv)
    } else {
        (-1, inv, (origin - cell as f32) * inv)
    }
}

/// Casts an exact 3D Amanatides-Woo DDA visual ray strictly between `a` and `b` (fine cells).
///
/// Returns `None` if line of sight is unobstructed (only air, water, and glass along the ray),
/// or `Some((hit_cell, t_mid))` with the first opaque voxel coordinates and its midpoint parameter
/// `t_mid` in `(0.0, 1.0)` along `a -> b`.
pub fn los_hit<W: VoxelQuery>(
    world: &mut W,
    a: [f32; 3],
    b: [f32; 3],
) -> Option<([i32; 3], f32)> {
    if !a[0].is_finite()
        || !a[1].is_finite()
        || !a[2].is_finite()
        || !b[0].is_finite()
        || !b[1].is_finite()
        || !b[2].is_finite()
    {
        return Some(([0, 0, 0], 0.0));
    }

    let mut ix = a[0].floor() as i32;
    let mut iy = a[1].floor() as i32;
    let mut iz = a[2].floor() as i32;
    let ex = b[0].floor() as i32;
    let ey = b[1].floor() as i32;
    let ez = b[2].floor() as i32;
    if ix == ex && iy == ey && iz == ez {
        return None;
    }

    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let dz = b[2] - a[2];

    let (step_x, t_delta_x, mut t_max_x) = dda_axis(a[0], dx, ix);
    let (step_y, t_delta_y, mut t_max_y) = dda_axis(a[1], dy, iy);
    let (step_z, t_delta_z, mut t_max_z) = dda_axis(a[2], dz, iz);

    let max_steps = ((ex - ix).abs() + (ey - iy).abs() + (ez - iz).abs()).clamp(1, MAX_DDA_STEPS);
    for _ in 0..max_steps {
        let t_enter;
        if t_max_x <= t_max_y && t_max_x <= t_max_z {
            t_enter = t_max_x;
            ix += step_x;
            t_max_x += t_delta_x;
        } else if t_max_y <= t_max_z {
            t_enter = t_max_y;
            iy += step_y;
            t_max_y += t_delta_y;
        } else {
            t_enter = t_max_z;
            iz += step_z;
            t_max_z += t_delta_z;
        }

        if t_enter >= 1.0 || (ix == ex && iy == ey && iz == ez) {
            return None;
        }

        if world.is_solid_fast(ix, iy, iz) {
            let k = world.voxel_kind(ix, iy, iz);
            if !is_visually_clear(k) {
                let t_exit = t_max_x.min(t_max_y).min(t_max_z).min(1.0);
                let t_mid = 0.5 * (t_enter + t_exit);
                return Some(([ix, iy, iz], t_mid));
            }
        }
    }
    None
}

/// Returns `true` when nothing opaque (i.e. only air, water, or glass) stands between `a` and `b`.
#[inline]
pub fn has_los<W: VoxelQuery>(world: &mut W, a: [f32; 3], b: [f32; 3]) -> bool {
    los_hit(world, a, b).is_none()
}

/// Computes remaining acoustic salience (`0.0..=1.0`) from `a` to `b` given `max_radius` (cells),
/// combining distance falloff `(1 - d/max_radius)^1.5` with exact per-material voxel absorption
/// `exp(-sum(attenuation * seg_len))` matching `engine/rules/stimulus.mjs`.
pub fn acoustic_attenuation<W: VoxelQuery>(
    world: &mut W,
    a: [f32; 3],
    b: [f32; 3],
    max_radius: f32,
) -> f32 {
    if !a[0].is_finite()
        || !a[1].is_finite()
        || !a[2].is_finite()
        || !b[0].is_finite()
        || !b[1].is_finite()
        || !b[2].is_finite()
        || !max_radius.is_finite()
        || max_radius <= 0.0
    {
        return 0.0;
    }

    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let dz = b[2] - a[2];
    let dist_sq = dx * dx + dy * dy + dz * dz;
    if !dist_sq.is_finite() {
        return 0.0;
    }
    let dist = dist_sq.sqrt();
    if dist >= max_radius {
        return 0.0;
    }
    if dist < 1.0 {
        return 1.0;
    }

    // Avoid `powf` in wasm32: (1 - norm)^1.5 == rem * sqrt(rem).
    let rem = (1.0 - dist / max_radius).max(0.0);
    let dist_factor = rem * rem.sqrt();

    let mut ix = a[0].floor() as i32;
    let mut iy = a[1].floor() as i32;
    let mut iz = a[2].floor() as i32;
    let ex = b[0].floor() as i32;
    let ey = b[1].floor() as i32;
    let ez = b[2].floor() as i32;
    if ix == ex && iy == ey && iz == ez {
        return dist_factor.clamp(0.0, 1.0);
    }

    let (step_x, t_delta_x, mut t_max_x) = dda_axis(a[0], dx, ix);
    let (step_y, t_delta_y, mut t_max_y) = dda_axis(a[1], dy, iy);
    let (step_z, t_delta_z, mut t_max_z) = dda_axis(a[2], dz, iz);

    let max_steps = ((ex - ix).abs() + (ey - iy).abs() + (ez - iz).abs()).clamp(1, MAX_DDA_STEPS);
    let mut absorption = 0.0f32;

    for _ in 0..max_steps {
        let t_enter;
        if t_max_x <= t_max_y && t_max_x <= t_max_z {
            t_enter = t_max_x;
            ix += step_x;
            t_max_x += t_delta_x;
        } else if t_max_y <= t_max_z {
            t_enter = t_max_y;
            iy += step_y;
            t_max_y += t_delta_y;
        } else {
            t_enter = t_max_z;
            iz += step_z;
            t_max_z += t_delta_z;
        }

        if t_enter >= 1.0 || (ix == ex && iy == ey && iz == ez) {
            break;
        }

        if world.is_solid_fast(ix, iy, iz) {
            let k = world.voxel_kind(ix, iy, iz);
            let mat = (k & 15) as usize;
            let att = MATERIAL_ATTENUATION[mat];
            if att > 0.0 {
                let t_exit = t_max_x.min(t_max_y).min(t_max_z).min(1.0);
                let seg_len = ((t_exit - t_enter) * dist).max(0.0);
                absorption += att * seg_len;
                if absorption >= MAX_ABSORPTION {
                    break;
                }
            }
        }
    }

    let transmission = (-absorption).exp();
    (dist_factor * transmission).clamp(0.0, 1.0)
}

#[inline]
fn hash_cell(bx: i32, bz: i32) -> usize {
    let h = (bx as u32).wrapping_mul(0x9E37_79B1) ^ (bz as u32).wrapping_mul(0x85EB_CA77);
    ((h ^ (h >> 16)) as usize) & HASH_MASK
}

/// Checks whether a single intermediate voxel at parameter `t_mid` along `a -> b` is opaque,
/// acting as an exact O(1) rejection test before launching a secondary eye->chest DDA ray.
#[inline]
fn opaque_at_t<W: VoxelQuery>(world: &mut W, a: [f32; 3], b: [f32; 3], t_mid: f32) -> bool {
    let px = (a[0] + (b[0] - a[0]) * t_mid).floor() as i32;
    let py = (a[1] + (b[1] - a[1]) * t_mid).floor() as i32;
    let pz = (a[2] + (b[2] - a[2]) * t_mid).floor() as i32;
    let sx = a[0].floor() as i32;
    let sy = a[1].floor() as i32;
    let sz = a[2].floor() as i32;
    let ex = b[0].floor() as i32;
    let ey = b[1].floor() as i32;
    let ez = b[2].floor() as i32;
    if (px == sx && py == sy && pz == sz) || (px == ex && py == ey && pz == ez) {
        return false;
    }
    world.is_solid_fast(px, py, pz) && !is_visually_clear(world.voxel_kind(px, py, pz))
}

/// Maximum cached 64³ sector opacity masks for hierarchical batch vision (~2 MiB upper bound).
const MAX_MASK_SECTORS: usize = 64;
/// Direct-mapped L1 lookup table size for sector masks (power of two).
const FAST_SECTOR_SLOTS: usize = 128;
const FAST_SECTOR_MASK: usize = FAST_SECTOR_SLOTS - 1;

type SectorMap<V> = HashMap<[i32; 3], V, BuildHasherDefault<Mix>>;

/// 2-level hierarchical visual opacity mask for one 64³ sector:
/// - `Empty`: all 262,144 cells are visually clear (air/water/glass) -> 8-cell/4-cell skips.
/// - `Solid`: all 262,144 cells are visually opaque -> instant hit on entry.
/// - `Mixed`: 512-byte dilated 4×4×4 occupancy grid (`16³` bits: bit == 0 guarantees all 27
///   neighboring 4³ blocks inside this sector are visually clear, allowing branchless 4-cell skips!)
///   plus 32 KiB 1-bit fine mask (`64³` bits).
enum SectorMask {
    Empty,
    Solid,
    Mixed {
        raw: Box<[u64; 64]>,
        dilated: Box<[u64; 64]>,
        opaque: Box<[u64; 4096]>,
    },
}

impl SectorMask {
    fn from_region(reg: &Region) -> Self {
        let cells = &reg.cells;
        let mut opaque = Box::new([0u64; 4096]);
        let mut any = false;
        let mut all = true;

        for y in 0..64usize {
            let y_row = y * 64;
            let y_off = y * 4096;
            for z in 0..64usize {
                let base = y_off + z * 64;
                let row = &cells[base..base + 64];
                let mut bits = 0u64;
                for x in 0..64usize {
                    let k = row[x];
                    if k != 0 && !is_visually_clear(k) {
                        bits |= 1u64 << x;
                    }
                }
                opaque[y_row + z] = bits;
                any |= bits != 0;
                all &= bits == u64::MAX;
            }
        }

        if !any {
            return SectorMask::Empty;
        }
        if all {
            return SectorMask::Solid;
        }

        // Build raw 16×16×16 coarse occupancy bitset (one u16 per (by, bz) row along bx=0..16).
        let mut raw = [0u16; 256];
        for by in 0..16usize {
            let y0 = by * 4;
            for bz in 0..16usize {
                let z0 = bz * 4;
                let mut acc = 0u64;
                for dy in 0..4usize {
                    let row_base = (y0 + dy) * 64 + z0;
                    acc |= opaque[row_base]
                        | opaque[row_base + 1]
                        | opaque[row_base + 2]
                        | opaque[row_base + 3];
                }
                if acc != 0 {
                    let mut cbits = 0u16;
                    for bx in 0..16usize {
                        if ((acc >> (bx * 4)) & 0xF) != 0 {
                            cbits |= 1u16 << bx;
                        }
                    }
                    raw[by * 16 + bz] = cbits;
                }
            }
        }

        // Dilate raw 16³ occupancy by 1 block in X, Y, Z and mark sector boundary shell (0 and 15)
        // as occupied so any `0` bit guarantees a full 4-cell empty safety halo inside this sector!
        let mut dilated_rows = [0u16; 256];
        for by in 0..16usize {
            let y_edge = by == 0 || by == 15;
            let y_lo = by.saturating_sub(1);
            let y_hi = (by + 1).min(15);
            for bz in 0..16usize {
                if y_edge || bz == 0 || bz == 15 {
                    dilated_rows[by * 16 + bz] = u16::MAX;
                    continue;
                }
                let mut r = 0u16;
                for ny in y_lo..=y_hi {
                    let base = ny * 16;
                    r |= raw[base + bz - 1] | raw[base + bz] | raw[base + bz + 1];
                }
                // Dilate ±1 along X and mark bx == 0 and bx == 15 as boundary shell.
                dilated_rows[by * 16 + bz] = r | (r << 1) | (r >> 1) | 0x8001;
            }
        }

        let mut raw_packed = Box::new([0u64; 64]);
        let mut dilated = Box::new([0u64; 64]);
        for i in 0..64usize {
            let b = i * 4;
            raw_packed[i] = (raw[b] as u64)
                | ((raw[b + 1] as u64) << 16)
                | ((raw[b + 2] as u64) << 32)
                | ((raw[b + 3] as u64) << 48);
            dilated[i] = (dilated_rows[b] as u64)
                | ((dilated_rows[b + 1] as u64) << 16)
                | ((dilated_rows[b + 2] as u64) << 32)
                | ((dilated_rows[b + 3] as u64) << 48);
        }

        SectorMask::Mixed { raw: raw_packed, dilated, opaque }
    }

    #[inline]
    fn is_fine_opaque(opaque: &[u64; 4096], lx: usize, ly: usize, lz: usize) -> bool {
        ((opaque[ly * 64 + lz] >> lx) & 1) != 0
    }
}

#[inline]
fn fast_sector_hash(key: [i32; 3]) -> usize {
    let h = (key[0] as u32).wrapping_mul(0x9E37_79B1)
        ^ (key[1] as u32).wrapping_mul(0x85EB_CA77)
        ^ (key[2] as u32).wrapping_mul(0xC2B2_AE3D);
    ((h ^ (h >> 16)) as usize) & FAST_SECTOR_MASK
}

#[inline]
fn mix_u64(mut h: u64, v: u64) -> u64 {
    h ^= v;
    h = h.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    h ^ (h >> 30)
}

fn edit_fingerprint(e: &Edit) -> u64 {
    match e {
        Edit::Ball { centre, radius, kind } => {
            let mut h = mix_u64(0xB411, centre[0] as u32 as u64);
            h = mix_u64(h, centre[1] as u32 as u64);
            h = mix_u64(h, centre[2] as u32 as u64);
            h = mix_u64(h, *radius as u32 as u64);
            mix_u64(h, *kind as u64)
        }
        Edit::Runs(runs) | Edit::Rows(runs) | Edit::Fine(runs, _) => {
            let tag = match e {
                Edit::Runs(_) => 1u64,
                Edit::Rows(_) => 2u64,
                Edit::Fine(_, s) => 3u64 | ((*s as u64) << 8),
                _ => 0,
            };
            let mut h = mix_u64(tag, runs.len() as u64);
            if !runs.is_empty() {
                for &idx in &[0usize, runs.len() / 2, runs.len() - 1] {
                    let r = runs[idx];
                    h = mix_u64(h, ((r.x0 as u32 as u64) << 32) | (r.x1 as u32 as u64));
                    h = mix_u64(h, ((r.y as u32 as u64) << 32) | (r.z as u32 as u64));
                    h = mix_u64(h, r.kind as u64);
                }
            }
            h
        }
    }
}

/// Automatically-synchronized cache of 64³ `SectorMask`s with a zero-HashMap direct-mapped L1 table.
struct SectorMaskCache {
    slots: Vec<SectorMask>,
    index: SectorMap<u16>,
    fast_keys: [[i32; 3]; FAST_SECTOR_SLOTS],
    fast_idx: [u16; FAST_SECTOR_SLOTS],
    ground_ptr: usize,
    seen_edits: usize,
    anchor_fps: [u64; 3],
    bay_on: bool,
    finer: bool,
}

impl SectorMaskCache {
    fn new() -> Self {
        Self {
            slots: Vec::with_capacity(MAX_MASK_SECTORS),
            index: SectorMap::default(),
            fast_keys: [[i32::MIN; 3]; FAST_SECTOR_SLOTS],
            fast_idx: [u16::MAX; FAST_SECTOR_SLOTS],
            ground_ptr: 0,
            seen_edits: 0,
            anchor_fps: [0; 3],
            bay_on: false,
            finer: false,
        }
    }

    fn clear_all(&mut self) {
        self.slots.clear();
        self.index.clear();
        self.fast_keys.fill([i32::MIN; 3]);
        self.fast_idx.fill(u16::MAX);
    }

    fn anchors(edits: &[Edit], len: usize) -> [u64; 3] {
        if len == 0 {
            [0; 3]
        } else {
            [
                edit_fingerprint(&edits[0]),
                edit_fingerprint(&edits[len / 2]),
                edit_fingerprint(&edits[len - 1]),
            ]
        }
    }

    /// Synchronizes the sector opacity cache against `ground`, invalidating touched sectors
    /// on incremental edits or clearing completely on `world_forget` / mode switches.
    fn sync(&mut self, ground: &Ground) {
        let ptr = ground as *const Ground as usize;
        let bay = crate::bay::on();
        let finer = ground.scratch.finer;
        let n = ground.edits.len();

        let reset = ptr != self.ground_ptr
            || bay != self.bay_on
            || finer != self.finer
            || n < self.seen_edits
            || (self.seen_edits > 0 && Self::anchors(&ground.edits, self.seen_edits) != self.anchor_fps);

        if reset {
            self.clear_all();
            self.ground_ptr = ptr;
            self.bay_on = bay;
            self.finer = finer;
            self.seen_edits = n;
            self.anchor_fps = Self::anchors(&ground.edits, n);
            return;
        }

        if n > self.seen_edits {
            let mut invalidated = false;
            for e in &ground.edits[self.seen_edits..n] {
                let (lo, hi) = bodies::reach(e);
                if lo[0] < hi[0] && lo[1] < hi[1] && lo[2] < hi[2] {
                    let sx0 = lo[0] >> 6;
                    let sx1 = (hi[0].saturating_sub(1)) >> 6;
                    let sy0 = lo[1] >> 6;
                    let sy1 = (hi[1].saturating_sub(1)) >> 6;
                    let sz0 = lo[2] >> 6;
                    let sz1 = (hi[2].saturating_sub(1)) >> 6;
                    for (k, _) in self.index.iter() {
                        if k[0] >= sx0 && k[0] <= sx1 && k[1] >= sy0 && k[1] <= sy1 && k[2] >= sz0 && k[2] <= sz1 {
                            invalidated = true;
                            break;
                        }
                    }
                    if invalidated {
                        break;
                    }
                }
            }
            if invalidated {
                // Rebuild only touched sectors lazily; clearing fast table + index for touched range.
                for e in &ground.edits[self.seen_edits..n] {
                    let (lo, hi) = bodies::reach(e);
                    if lo[0] < hi[0] && lo[1] < hi[1] && lo[2] < hi[2] {
                        let sx0 = lo[0] >> 6;
                        let sx1 = (hi[0].saturating_sub(1)) >> 6;
                        let sy0 = lo[1] >> 6;
                        let sy1 = (hi[1].saturating_sub(1)) >> 6;
                        let sz0 = lo[2] >> 6;
                        let sz1 = (hi[2].saturating_sub(1)) >> 6;
                        self.index.retain(|k, _| {
                            k[0] < sx0 || k[0] > sx1 || k[1] < sy0 || k[1] > sy1 || k[2] < sz0 || k[2] > sz1
                        });
                    }
                }
                self.fast_keys.fill([i32::MIN; 3]);
                self.fast_idx.fill(u16::MAX);
                if self.index.is_empty() {
                    self.slots.clear();
                }
            }
            self.seen_edits = n;
            self.anchor_fps = Self::anchors(&ground.edits, n);
        }
    }

    #[inline]
    fn lookup_idx(&mut self, ground: &mut Ground, key: [i32; 3]) -> usize {
        let h = fast_sector_hash(key);
        if self.fast_keys[h] == key && self.fast_idx[h] != u16::MAX {
            return self.fast_idx[h] as usize;
        }
        self.lookup_idx_slow(ground, key, h)
    }

    #[cold]
    fn lookup_idx_slow(&mut self, ground: &mut Ground, key: [i32; 3], h: usize) -> usize {
        if let Some(&idx) = self.index.get(&key) {
            self.fast_keys[h] = key;
            self.fast_idx[h] = idx;
            return idx as usize;
        }
        if self.slots.len() >= MAX_MASK_SECTORS {
            self.clear_all();
        }
        let reg = ground.region([key[0] * 64, key[1] * 64, key[2] * 64], [64, 64, 64]);
        let mask = SectorMask::from_region(&reg);
        let idx = self.slots.len() as u16;
        self.slots.push(mask);
        self.index.insert(key, idx);
        self.fast_keys[h] = key;
        self.fast_idx[h] = idx;
        idx as usize
    }

    #[inline]
    fn is_opaque(&mut self, ground: &mut Ground, x: i32, y: i32, z: i32) -> bool {
        let idx = self.lookup_idx(ground, [x >> 6, y >> 6, z >> 6]);
        match &self.slots[idx] {
            SectorMask::Empty => false,
            SectorMask::Solid => true,
            SectorMask::Mixed { opaque, .. } => {
                SectorMask::is_fine_opaque(opaque, (x & 63) as usize, (y & 63) as usize, (z & 63) as usize)
            }
        }
    }

    /// Ultra-fast local-32-bit 16.16 fixed-point voxel raymarcher with 4-cell dilated empty-block
    /// skipping, 1 KiB L1 raw-coarse culling, and 8-cell empty-sector skipping.
    fn los_hit(&mut self, ground: &mut Ground, a: [f32; 3], b: [f32; 3]) -> Option<([i32; 3], f32)> {
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let dz = b[2] - a[2];
        let far_sq = dx * dx + dy * dy + dz * dz;
        if far_sq < 1.0 {
            return None;
        }
        let far = far_sq.sqrt();
        let steps = (far as i32).min(MAX_DDA_STEPS);
        if steps <= 1 {
            return None;
        }
        let inv_far = 1.0 / far;
        let sx32 = (dx * inv_far * 65536.0) as i32;
        let sy32 = (dy * inv_far * 65536.0) as i32;
        let sz32 = (dz * inv_far * 65536.0) as i32;
        let sx4 = sx32 << 2;
        let sy4 = sy32 << 2;
        let sz4 = sz32 << 2;
        let sx8 = sx32 << 3;
        let sy8 = sy32 << 3;
        let sz8 = sz32 << 3;

        let mut px = (a[0] * 65536.0) as i64 + sx32 as i64;
        let mut py = (a[1] * 65536.0) as i64 + sy32 as i64;
        let mut pz = (a[2] * 65536.0) as i64 + sz32 as i64;

        const SEC_LIMIT: u32 = 64 << 16;
        const EMPTY_LO: u32 = 8 << 16;
        const EMPTY_SPAN: u32 = 48 << 16;

        let mut s = 1i32;
        while s < steps {
            let ix = (px >> 16) as i32;
            let iy = (py >> 16) as i32;
            let iz = (pz >> 16) as i32;
            let sx = ix >> 6;
            let sy = iy >> 6;
            let sz = iz >> 6;
            let idx = self.lookup_idx(ground, [sx, sy, sz]);

            let base_x = (sx as i64) << 22;
            let base_y = (sy as i64) << 22;
            let base_z = (sz as i64) << 22;
            let mut lpx = (px - base_x) as i32;
            let mut lpy = (py - base_y) as i32;
            let mut lpz = (pz - base_z) as i32;

            match &self.slots[idx] {
                SectorMask::Solid => {
                    return Some(([ix, iy, iz], s as f32 * inv_far));
                }
                SectorMask::Empty => {
                    while s < steps
                        && (lpx as u32) < SEC_LIMIT
                        && (lpy as u32) < SEC_LIMIT
                        && (lpz as u32) < SEC_LIMIT
                    {
                        if (lpx as u32).wrapping_sub(EMPTY_LO) < EMPTY_SPAN
                            && (lpy as u32).wrapping_sub(EMPTY_LO) < EMPTY_SPAN
                            && (lpz as u32).wrapping_sub(EMPTY_LO) < EMPTY_SPAN
                        {
                            lpx += sx8;
                            lpy += sy8;
                            lpz += sz8;
                            s += 8;
                        } else {
                            lpx += sx32;
                            lpy += sy32;
                            lpz += sz32;
                            s += 1;
                        }
                    }
                }
                SectorMask::Mixed { raw, dilated, opaque } => {
                    while s < steps
                        && (lpx as u32) < SEC_LIMIT
                        && (lpy as u32) < SEC_LIMIT
                        && (lpz as u32) < SEC_LIMIT
                    {
                        let lx = (lpx as u32) >> 16;
                        let ly = (lpy as u32) >> 16;
                        let lz = (lpz as u32) >> 16;
                        let cidx = ((ly >> 2) << 4) | (lz >> 2);
                        let cword = (cidx >> 2) as usize;
                        let cshift = ((cidx & 3) << 4) + (lx >> 2);
                        if ((dilated[cword] >> cshift) & 1) == 0 {
                            lpx += sx4;
                            lpy += sy4;
                            lpz += sz4;
                            s += 4;
                            continue;
                        }
                        if ((raw[cword] >> cshift) & 1) != 0
                            && ((opaque[((ly << 6) | lz) as usize] >> lx) & 1) != 0
                        {
                            return Some((
                                [(sx << 6) | lx as i32, (sy << 6) | ly as i32, (sz << 6) | lz as i32],
                                s as f32 * inv_far,
                            ));
                        }
                        lpx += sx32;
                        lpy += sy32;
                        lpz += sz32;
                        s += 1;
                    }
                }
            }

            px = base_x + lpx as i64;
            py = base_y + lpy as i64;
            pz = base_z + lpz as i64;
        }
        None
    }

    #[inline]
    fn opaque_at_t(&mut self, ground: &mut Ground, a: [f32; 3], b: [f32; 3], t_mid: f32) -> bool {
        let px = (a[0] + (b[0] - a[0]) * t_mid).floor() as i32;
        let py = (a[1] + (b[1] - a[1]) * t_mid).floor() as i32;
        let pz = (a[2] + (b[2] - a[2]) * t_mid).floor() as i32;
        let sx = a[0].floor() as i32;
        let sy = a[1].floor() as i32;
        let sz = a[2].floor() as i32;
        let ex = b[0].floor() as i32;
        let ey = b[1].floor() as i32;
        let ez = b[2].floor() as i32;
        if (px == sx && py == sy && pz == sz) || (px == ex && py == ey && pz == ez) {
            return false;
        }
        self.is_opaque(ground, px, py, pz)
    }
}

/// Reusable SoA batch vision state for up to `256` agents.
pub struct VisionBatch {
    /// Contiguous SoA input buffer: `agents[field * VISION_MAX_AGENTS + idx]`.
    agents: Box<[f32; VISION_FLOATS]>,
    /// Output directed visibility pairs: `[obs_0, tgt_0, obs_1, tgt_1, ...]`.
    pairs: Vec<u32>,
    /// Hierarchical 64³ / 4³ sector opacity cache for fast batch LOS over `Ground`.
    mask_cache: SectorMaskCache,
    // Zero-allocation reusable spatial hash & per-step precomputed agent arrays.
    grid_head: [u16; HASH_BUCKETS],
    grid_next: [u16; VISION_MAX_AGENTS],
    used_buckets: Vec<u16>,
    active_list: [u16; VISION_MAX_AGENTS],
    agent_bx: [i32; VISION_MAX_AGENTS],
    agent_bz: [i32; VISION_MAX_AGENTS],
    fwd_x: [f32; VISION_MAX_AGENTS],
    fwd_z: [f32; VISION_MAX_AGENTS],
    flags_u32: [u32; VISION_MAX_AGENTS],
}

impl Default for VisionBatch {
    fn default() -> Self {
        Self::new()
    }
}

impl VisionBatch {
    pub fn new() -> Self {
        Self {
            agents: Box::new([0.0; VISION_FLOATS]),
            pairs: Vec::with_capacity(512),
            mask_cache: SectorMaskCache::new(),
            grid_head: [u16::MAX; HASH_BUCKETS],
            grid_next: [u16::MAX; VISION_MAX_AGENTS],
            used_buckets: Vec::with_capacity(64),
            active_list: [0; VISION_MAX_AGENTS],
            agent_bx: [0; VISION_MAX_AGENTS],
            agent_bz: [0; VISION_MAX_AGENTS],
            fwd_x: [0.0; VISION_MAX_AGENTS],
            fwd_z: [0.0; VISION_MAX_AGENTS],
            flags_u32: [0; VISION_MAX_AGENTS],
        }
    }

    pub fn reset(&mut self) {
        self.agents.fill(0.0);
        self.pairs.clear();
    }

    #[inline]
    pub fn agents_ptr(&mut self) -> *mut f32 {
        self.agents.as_mut_ptr()
    }

    #[inline]
    pub fn pairs_ptr(&self) -> *const u32 {
        self.pairs.as_ptr()
    }

    #[inline]
    pub fn pairs_len(&self) -> usize {
        self.pairs.len() / 2
    }

    #[inline]
    pub fn pairs_slice(&self) -> &[u32] {
        &self.pairs
    }

    #[inline]
    pub fn field(&self, f: usize) -> &[f32] {
        let base = f * VISION_MAX_AGENTS;
        &self.agents[base..base + VISION_MAX_AGENTS]
    }

    #[inline]
    pub fn field_mut(&mut self, f: usize) -> &mut [f32] {
        let base = f * VISION_MAX_AGENTS;
        &mut self.agents[base..base + VISION_MAX_AGENTS]
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_agent(
        &mut self,
        idx: usize,
        x: f32,
        y: f32,
        z: f32,
        yaw: f32,
        lod_ring: f32,
        flags: u32,
    ) {
        if idx >= VISION_MAX_AGENTS {
            return;
        }
        self.agents[FIELD_X * VISION_MAX_AGENTS + idx] = x;
        self.agents[FIELD_Y * VISION_MAX_AGENTS + idx] = y;
        self.agents[FIELD_Z * VISION_MAX_AGENTS + idx] = z;
        self.agents[FIELD_YAW * VISION_MAX_AGENTS + idx] = yaw;
        self.agents[FIELD_LOD_RING * VISION_MAX_AGENTS + idx] = lod_ring;
        self.agents[FIELD_FLAGS * VISION_MAX_AGENTS + idx] = flags as f32;
    }

    /// Runs one batch spatial vision pass over agents `0..count.min(256)` within `range` cells.
    ///
    /// Applies LOD ring skipping (Ring >= 3 skipped), XZ uniform spatial hashing, FOV cone
    /// (`WIDE = -0.2`, `NOTICED = 25`), and eye-to-head / eye-to-chest DDA voxel raymarching.
    /// Writes directed `(observer_idx, target_idx)` `u32` pairs into `self.pairs` and returns
    /// the number of visible pairs.
    pub fn step<W: VoxelQuery>(&mut self, world: &mut W, count: usize, range: f32) -> usize {
        self.pairs.clear();
        let n = count.min(VISION_MAX_AGENTS);
        if n < 2 || !range.is_finite() || range <= 0.0 {
            return 0;
        }
        let max_range = range;
        let max_range_sq = max_range * max_range;
        let cell_size = max_range.max(64.0);
        let inv_cell = 1.0 / cell_size;

        // Clear previously touched spatial hash buckets sparsely.
        for &b in &self.used_buckets {
            self.grid_head[b as usize] = u16::MAX;
        }
        self.used_buckets.clear();

        let xs_base = FIELD_X * VISION_MAX_AGENTS;
        let ys_base = FIELD_Y * VISION_MAX_AGENTS;
        let zs_base = FIELD_Z * VISION_MAX_AGENTS;
        let yaw_base = FIELD_YAW * VISION_MAX_AGENTS;
        let lod_base = FIELD_LOD_RING * VISION_MAX_AGENTS;
        let flg_base = FIELD_FLAGS * VISION_MAX_AGENTS;

        // Insert active Ring 1 / Ring 2 agents into the spatial hash and precompute facing vectors.
        let mut active_n = 0usize;
        for i in 0..n {
            let lod = self.agents[lod_base + i];
            if lod >= 3.0 {
                continue;
            }
            let flg_f = self.agents[flg_base + i];
            let flg = if flg_f.is_finite() && flg_f > 0.0 {
                flg_f as u32
            } else {
                0
            };
            if flg & VISION_FLAG_INACTIVE != 0 {
                continue;
            }
            let x = self.agents[xs_base + i];
            let y = self.agents[ys_base + i];
            let z = self.agents[zs_base + i];
            let yaw = self.agents[yaw_base + i];
            if !x.is_finite() || !y.is_finite() || !z.is_finite() || !yaw.is_finite() {
                continue;
            }

            let bx = (x * inv_cell).floor() as i32;
            let bz = (z * inv_cell).floor() as i32;
            self.agent_bx[i] = bx;
            self.agent_bz[i] = bz;
            // Forward vector matches `sight.mjs`: `(sin(yaw), 0, -cos(yaw))`.
            self.fwd_x[i] = yaw.sin();
            self.fwd_z[i] = -yaw.cos();
            self.flags_u32[i] = flg;
            self.active_list[active_n] = i as u16;
            active_n += 1;

            let h = hash_cell(bx, bz);
            if self.grid_head[h] == u16::MAX {
                self.used_buckets.push(h as u16);
            }
            self.grid_next[i] = self.grid_head[h];
            self.grid_head[h] = i as u16;
        }

        if active_n < 2 {
            return 0;
        }

        if let Some(g) = world.as_ground_mut() {
            self.mask_cache.sync(g);
        }

        // Visit each active agent's 3×3 cell neighborhood, checking each unordered pair `(a, b)` once (`a < b`).
        for ai in 0..active_n {
            let a = self.active_list[ai] as usize;
            let ax = self.agents[xs_base + a];
            let ay = self.agents[ys_base + a];
            let az = self.agents[zs_base + a];
            let afx = self.fwd_x[a];
            let afz = self.fwd_z[a];
            let aflg = self.flags_u32[a];
            let abx = self.agent_bx[a];
            let abz = self.agent_bz[a];
            let a_can_obs = (aflg & VISION_FLAG_SKIP_OBS) == 0;
            let a_is_rule = (aflg & VISION_FLAG_RULE) != 0;
            let a_no_actors = (aflg & VISION_FLAG_IGNORE_ACTORS) != 0;

            for dz_c in -1..=1 {
                let nbz = abz + dz_c;
                for dx_c in -1..=1 {
                    let nbx = abx + dx_c;
                    let h = hash_cell(nbx, nbz);
                    let mut cur = self.grid_head[h];
                    while cur != u16::MAX {
                        let b = cur as usize;
                        cur = self.grid_next[b];
                        if b <= a {
                            continue;
                        }
                        if self.agent_bx[b] != nbx || self.agent_bz[b] != nbz {
                            continue;
                        }

                        let bflg = self.flags_u32[b];
                        let b_can_obs = (bflg & VISION_FLAG_SKIP_OBS) == 0;
                        if !a_can_obs && !b_can_obs {
                            continue;
                        }
                        let b_is_rule = (bflg & VISION_FLAG_RULE) != 0;
                        let b_no_actors = (bflg & VISION_FLAG_IGNORE_ACTORS) != 0;

                        let mut ab = a_can_obs && !(a_no_actors && b_is_rule);
                        let mut ba = b_can_obs && !(b_no_actors && a_is_rule);
                        if !ab && !ba {
                            continue;
                        }

                        let bx = self.agents[xs_base + b];
                        let by = self.agents[ys_base + b];
                        let bz = self.agents[zs_base + b];

                        let dx = bx - ax;
                        let dz = bz - az;
                        let dy_abs = (by - ay).abs();
                        if dy_abs > max_range {
                            continue;
                        }
                        let dist_sq = dx * dx + dz * dz;
                        if dist_sq > max_range_sq {
                            continue;
                        }

                        let far = dist_sq.sqrt();
                        if far > NOTICED {
                            let thresh = WIDE * far;
                            if ab && (afx * dx + afz * dz) < thresh {
                                ab = false;
                            }
                            if ba && (self.fwd_x[b] * (-dx) + self.fwd_z[b] * (-dz)) < thresh {
                                ba = false;
                            }
                            if !ab && !ba {
                                continue;
                            }
                        }

                        // Eye-to-head (symmetric since EYES == HEAD == 16), then eye-to-chest fallbacks.
                        let ea = [ax, ay + EYES, az];
                        let eb = [bx, by + EYES, bz];
                        let visible = if let Some(g) = world.as_ground_mut() {
                            let head_hit = self.mask_cache.los_hit(g, ea, eb);
                            if head_hit.is_none() {
                                true
                            } else {
                                let (_, t_mid) = head_hit.unwrap();
                                let ab_chest = ab && {
                                    let cb = [bx, by + CHEST, bz];
                                    !self.mask_cache.opaque_at_t(g, ea, cb, t_mid)
                                        && self.mask_cache.los_hit(g, ea, cb).is_none()
                                };
                                if ab_chest {
                                    true
                                } else {
                                    ba && {
                                        let ca = [ax, ay + CHEST, az];
                                        !self.mask_cache.opaque_at_t(g, eb, ca, 1.0 - t_mid)
                                            && self.mask_cache.los_hit(g, eb, ca).is_none()
                                    }
                                }
                            }
                        } else {
                            let head_hit = los_hit(world, ea, eb);
                            if head_hit.is_none() {
                                true
                            } else {
                                let (_, t_mid) = head_hit.unwrap();
                                let ab_chest = ab && {
                                    let cb = [bx, by + CHEST, bz];
                                    !opaque_at_t(world, ea, cb, t_mid) && has_los(world, ea, cb)
                                };
                                if ab_chest {
                                    true
                                } else {
                                    ba && {
                                        let ca = [ax, ay + CHEST, az];
                                        !opaque_at_t(world, eb, ca, 1.0 - t_mid)
                                            && has_los(world, eb, ca)
                                    }
                                }
                            }
                        };

                        if visible {
                            if ab {
                                self.pairs.push(a as u32);
                                self.pairs.push(b as u32);
                            }
                            if ba {
                                self.pairs.push(b as u32);
                                self.pairs.push(a as u32);
                            }
                        }
                    }
                }
            }
        }

        self.pairs.len() / 2
    }
}

thread_local! {
    static VISION: RefCell<VisionBatch> = RefCell::new(VisionBatch::new());
}

/// Resets the thread-local WASM batch vision state.
pub fn vision_reset() {
    VISION.with_borrow_mut(|v| v.reset());
}

/// Returns the linear-memory pointer to the contiguous SoA vision input buffer (`6 * 256` floats).
pub fn vision_agents_ptr() -> *mut f32 {
    VISION.with_borrow_mut(|v| v.agents_ptr())
}

/// Writes one agent slot in the thread-local SoA vision buffer.
pub fn vision_set_agent(
    idx: usize,
    x: f32,
    y: f32,
    z: f32,
    yaw: f32,
    lod_ring: f32,
    flags: u32,
) {
    VISION.with_borrow_mut(|v| v.set_agent(idx, x, y, z, yaw, lod_ring, flags));
}

/// Executes one batch spatial vision pass against `world`, returning visible pair count.
pub fn vision_step<W: VoxelQuery>(world: &mut W, count: usize, range: f32) -> usize {
    VISION.with_borrow_mut(|v| v.step(world, count, range))
}

/// Returns the linear-memory pointer to `[obs_0, tgt_0, ...]` `u32` pairs from the last `vision_step`.
pub fn vision_pairs_ptr() -> *const u32 {
    VISION.with_borrow(|v| v.pairs_ptr())
}

/// Returns the number of visible directed pairs produced by the last `vision_step`.
pub fn vision_pairs_len() -> usize {
    VISION.with_borrow(|v| v.pairs_len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kinds::{BRICK, CONCRETE, GLASS, WATER, WOOD, kind};
    use std::time::Instant;

    struct BoxWorld {
        boxes: Vec<([i32; 3], [i32; 3], Kind)>,
    }

    impl BoxWorld {
        fn new() -> Self {
            Self { boxes: Vec::new() }
        }
        fn fill(&mut self, lo: [i32; 3], hi: [i32; 3], k: Kind) {
            self.boxes.push((lo, hi, k));
        }
    }

    impl VoxelQuery for BoxWorld {
        fn voxel_kind(&mut self, x: i32, y: i32, z: i32) -> Kind {
            let mut k = 0;
            for &(lo, hi, bk) in &self.boxes {
                if x >= lo[0] && x < hi[0] && y >= lo[1] && y < hi[1] && z >= lo[2] && z < hi[2] {
                    k = bk;
                }
            }
            k
        }
    }

    #[test]
    fn los_transparency_glass_water_vs_opaque_wall() {
        let mut w = BoxWorld::new();
        // Glass pane at x = 25..27: visually clear!
        w.fill([25, 0, 0], [27, 40, 40], kind(GLASS, 0));
        // Water curtain at x = 35..38: visually clear!
        w.fill([35, 0, 0], [38, 40, 40], kind(WATER, 0));
        assert!(has_los(&mut w, [10.5, 26.0, 20.5], [50.5, 26.0, 20.5]));

        // Add concrete pillar at x = 42..44 blocking z = 18..23.
        w.fill([42, 0, 18], [44, 40, 23], kind(CONCRETE, 0));
        assert!(!has_los(&mut w, [10.5, 26.0, 20.5], [50.5, 26.0, 20.5]));
        // Looking around the pillar (z = 26) remains clear through glass and water.
        assert!(has_los(&mut w, [10.5, 26.0, 26.5], [50.5, 26.0, 26.5]));
    }

    #[test]
    fn acoustic_attenuation_thick_wall_vs_glass_vs_open_air() {
        let mut open = BoxWorld::new();
        let a = [10.5, 25.5, 32.5];
        let b = [60.5, 25.5, 32.5];
        let s_open = acoustic_attenuation(&mut open, a, b, 500.0);
        assert!((s_open - 0.9f32.powf(1.5)).abs() < 1e-4, "open air salience={s_open}");

        let mut glass_w = BoxWorld::new();
        glass_w.fill([30, 0, 0], [32, 60, 60], kind(GLASS, 0));
        let s_glass = acoustic_attenuation(&mut glass_w, a, b, 500.0);
        assert!(s_glass < s_open && s_glass > s_open * 0.75, "thin glass should mildly dampen: {s_glass} vs {s_open}");

        let mut wood_w = BoxWorld::new();
        wood_w.fill([30, 0, 0], [36, 60, 60], kind(WOOD, 0));
        let s_wood = acoustic_attenuation(&mut wood_w, a, b, 500.0);
        assert!(s_wood < s_glass, "wood wall should attenuate more than thin glass: {s_wood} vs {s_glass}");

        let mut thick_concrete = BoxWorld::new();
        thick_concrete.fill([30, 0, 0], [42, 60, 60], kind(CONCRETE, 0));
        let s_concrete = acoustic_attenuation(&mut thick_concrete, a, b, 500.0);
        assert!(
            s_concrete < s_open * 0.08,
            "1.2m concrete wall must attenuate strongly: concrete={s_concrete:.5} vs open={s_open:.5}"
        );

        // Beyond max_radius -> 0.0.
        assert_eq!(acoustic_attenuation(&mut open, a, [700.0, 25.5, 32.5], 500.0), 0.0);
    }

    #[test]
    fn batch_vision_100_agents_fov_lod_wall_and_perf() {
        let mut w = BoxWorld::new();
        // Solid brick divider wall at x = 0..4, y = 0..40, z = -300..300 separating East and West sides.
        w.fill([0, 0, -300], [4, 40, 300], kind(BRICK, 0));

        let mut batch = VisionBatch::new();
        let n = 100usize;
        // 50 agents on West side (x = -120..-20), 50 agents on East side (x = +20..+120).
        // Make agents 90..100 Ring 3 (must be skipped completely).
        for i in 0..n {
            let east = i >= 50;
            let local = i % 50;
            let row = (local / 10) as f32;
            let col = (local % 10) as f32;
            let x = if east { 25.0 + row * 22.0 } else { -25.0 - row * 22.0 };
            let z = (col - 4.5) * 24.0;
            // West agents face East (+X -> yaw = +PI/2); East agents face West (-X -> yaw = -PI/2).
            let yaw = if east { -std::f32::consts::FRAC_PI_2 } else { std::f32::consts::FRAC_PI_2 };
            let lod = if i >= 90 { 3.0 } else if i >= 70 { 2.0 } else { 1.0 };
            batch.set_agent(i, x, 10.0, z, yaw, lod, VISION_FLAG_RULE);
        }

        // Warm once, then benchmark average over 20 passes.
        let pairs_n = batch.step(&mut w, n, 400.0);
        assert!(pairs_n > 200, "expected same-side agents to see each other (got {pairs_n} pairs)");

        let pairs = batch.pairs_slice();
        for chunk in pairs.chunks_exact(2) {
            let obs = chunk[0] as usize;
            let tgt = chunk[1] as usize;
            assert_ne!(obs, tgt, "agent must never see itself");
            assert!(obs < 90 && tgt < 90, "Ring 3 agents (90..100) must be skipped: ({obs}, {tgt})");
            assert_eq!(
                obs < 50,
                tgt < 50,
                "solid brick wall must block cross-side vision: obs={obs}, tgt={tgt}"
            );
        }

        // Verify FOV cone: an agent at (-120, 10, 0) facing East (+X) sees agents ahead (x > -120)
        // and does NOT see distant agents behind it unless within NOTICED = 25.
        let mut fov_batch = VisionBatch::new();
        // Agent 0 at (0, 10, 0) facing North (-Z, yaw = 0.0).
        fov_batch.set_agent(0, 0.0, 10.0, 0.0, 0.0, 1.0, 0);
        // Agent 1 directly ahead at (0, 10, -80) (North).
        fov_batch.set_agent(1, 0.0, 10.0, -80.0, 0.0, 1.0, 0);
        // Agent 2 directly behind at (0, 10, +80) (South, outside NOTICED=25).
        fov_batch.set_agent(2, 0.0, 10.0, 80.0, 0.0, 1.0, 0);
        // Agent 3 directly behind but close at (0, 10, +15) (within NOTICED=25!).
        fov_batch.set_agent(3, 0.0, 10.0, 15.0, 0.0, 1.0, 0);
        let mut empty = BoxWorld::new();
        fov_batch.step(&mut empty, 4, 300.0);
        let sees_from_0: Vec<u32> = fov_batch
            .pairs_slice()
            .chunks_exact(2)
            .filter(|p| p[0] == 0)
            .map(|p| p[1])
            .collect();
        assert!(sees_from_0.contains(&1), "agent 0 should see agent 1 ahead");
        assert!(!sees_from_0.contains(&2), "agent 0 should NOT see distant agent 2 behind");
        assert!(sees_from_0.contains(&3), "agent 0 should notice close agent 3 behind (<= 25 cells)");

        // Benchmark 100 agents on real live city Ground with a brick wall.
        let mut bodies = crate::bodies::Bodies::new();
        let cx = 700;
        let cz = 4070;
        let cy = crate::city::footing(cx, cz).0;
        let mut wall_runs = Vec::new();
        for y in cy..(cy + 30) {
            for z in (cz - 120)..=(cz + 120) {
                wall_runs.push(crate::scratch::Run { x0: cx, x1: cx + 4, y, z, kind: kind(BRICK, 0) });
            }
        }
        bodies.ground.push(crate::Edit::Runs(wall_runs), false, None);

        let mut city_batch = VisionBatch::new();
        for i in 0..n {
            let east = i >= 50;
            let local = i % 50;
            let row = (local / 10) as f32;
            let col = (local % 10) as f32;
            let x = cx as f32 + if east { 16.0 + row * 18.0 } else { -16.0 - row * 18.0 };
            let z = cz as f32 + (col - 4.5) * 20.0;
            let y = crate::city::footing(x as i32, z as i32).0 as f32;
            let yaw = if east { -std::f32::consts::FRAC_PI_2 } else { std::f32::consts::FRAC_PI_2 };
            city_batch.set_agent(i, x, y, z, yaw, 1.0, VISION_FLAG_RULE);
        }
        // Warm Ground sector cache once.
        let city_pairs = city_batch.step(&mut bodies.ground, n, 300.0);
        let iters = 20;
        let t0 = Instant::now();
        for _ in 0..iters {
            city_batch.step(&mut bodies.ground, n, 300.0);
        }
        let avg_ms = (t0.elapsed().as_secs_f64() * 1000.0) / iters as f64;
        eprintln!("perception_vision_step (100 agents, live city + wall): {avg_ms:.3} ms ({city_pairs} pairs)");
        #[cfg(not(debug_assertions))]
        assert!(
            avg_ms < 1.0,
            "100-agent batch vision took {avg_ms:.3} ms (gate < 1.0 ms)"
        );

        // Verify live edit invalidation: punch a wide doorway through the brick wall and verify
        // cross-side vision immediately opens up without stale cache entries!
        let mut breach_runs = Vec::new();
        for y in cy..(cy + 30) {
            for z in (cz - 20)..=(cz + 20) {
                breach_runs.push(crate::scratch::Run { x0: cx, x1: cx + 4, y, z, kind: 0 });
            }
        }
        bodies.ground.push(crate::Edit::Runs(breach_runs), false, None);
        let pairs_after_breach = city_batch.step(&mut bodies.ground, n, 300.0);
        assert!(
            pairs_after_breach > city_pairs + 20,
            "breaching the brick wall must invalidate sector opacity cache ({city_pairs} -> {pairs_after_breach})"
        );
    }
}
