//! Mutable dynamic voxel body carving and slicing (#166).
//!
//! Allows any moving `Body` (vehicle, beam, crate, door, masonry chunk, prop) to be carved
//! voxel-by-voxel in place by world-space spheres, swept capsules, or cutting planes.
//! Disconnected islands are automatically detected via fast bit-packed 6-connected component
//! analysis (CCA), cropped to tight bounds with preserved `born` offsets for procedural paint
//! continuity, shifted so remaining voxels stay frozen in world space without jumping, and
//! assigned physically exact inherited velocities `v_i = v + w x r_i` and spin `w`.

use super::*;
use crate::kinds::gives;
use std::cell::RefCell;

/// Options controlling how carving interacts with voxel materials.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CarveOptions {
    /// When `true`, scales the effective carve radius per voxel by `kinds::gives(material) / 16.0`
    /// (glass shatters to 2.75x radius, wood 1.125x, concrete 0.6875x, steel 0.25x).
    /// When `false` (hard carve), uses the exact geometric radius regardless of material.
    pub respect_gives: bool,
}

impl CarveOptions {
    /// Hard geometric carve ignoring material resistance (default for blades, lasers, exact cuts).
    pub const HARD: Self = Self { respect_gives: false };
    /// Material-aware blast/impact carve scaled by `kinds::gives`.
    pub const MATERIAL_AWARE: Self = Self { respect_gives: true };
}

impl Default for CarveOptions {
    fn default() -> Self {
        Self::HARD
    }
}

/// Result of carving a single `Body`.
pub struct CarveReport {
    /// Number of solid voxels removed by the carve.
    pub removed: usize,
    /// Pre-carve body-local voxel coordinates and original `Kind` of every removed voxel.
    pub removed_cells: Vec<([usize; 3], Kind)>,
    /// Newly spawned disconnected islands (`k - 1` when the carve splits the body into `k >= 2` pieces).
    pub split_bodies: Vec<Body>,
    /// `true` when every remaining voxel of the body was removed.
    pub destroyed: bool,
}

impl CarveReport {
    #[inline]
    fn empty() -> Self {
        Self { removed: 0, removed_cells: Vec::new(), split_bodies: Vec::new(), destroyed: false }
    }
}

/// A sphere transformed into a body's local voxel grid coordinates.
#[derive(Clone, Copy, Debug)]
pub struct LocalSphere {
    pub center: V,
    pub radius: f32,
}

/// A capsule (line segment + radius) transformed into a body's local voxel grid coordinates.
#[derive(Clone, Copy, Debug)]
pub struct LocalCapsule {
    pub a: V,
    pub b: V,
    pub radius: f32,
}

/// A cutting plane slab transformed into a body's local voxel grid coordinates.
#[derive(Clone, Copy, Debug)]
pub struct LocalPlane {
    pub point: V,
    pub normal: V,
    pub half_thickness: f32,
}

/// Converts a world-space point into a body's local voxel grid coordinates (origin at low corner).
#[inline]
pub fn world_to_local(body: &Body, world: V) -> V {
    add(back(body.rot, sub(world, body.pos)), body.com)
}

/// Converts a body-local voxel grid point (origin at low corner) into world space.
#[inline]
pub fn local_to_world(body: &Body, local: V) -> V {
    add(body.pos, turn(body.rot, sub(local, body.com)))
}

/// Converts a world-space direction vector into body-local axes.
#[inline]
pub fn world_dir_to_local(body: &Body, dir: V) -> V {
    back(body.rot, dir)
}

/// Transforms a world-space sphere into body-local coordinates.
#[inline]
pub fn sphere_to_local(body: &Body, world_center: V, radius: f32) -> LocalSphere {
    LocalSphere { center: world_to_local(body, world_center), radius }
}

/// Transforms a world-space capsule into body-local coordinates.
#[inline]
pub fn capsule_to_local(body: &Body, world_a: V, world_b: V, radius: f32) -> LocalCapsule {
    LocalCapsule { a: world_to_local(body, world_a), b: world_to_local(body, world_b), radius }
}

/// Transforms a world-space cutting plane into body-local coordinates.
/// Returns `None` if the normal is degenerate or inputs are non-finite.
#[inline]
pub fn plane_to_local(body: &Body, world_point: V, world_normal: V, half_thickness: f32) -> Option<LocalPlane> {
    if !finite_v(world_point) || !finite_v(world_normal) || !half_thickness.is_finite() || half_thickness < 0.0 {
        return None;
    }
    let len_sq = dot(world_normal, world_normal);
    if len_sq <= 1e-12 {
        return None;
    }
    let n_world = scale(world_normal, 1.0 / len_sq.sqrt());
    Some(LocalPlane {
        point: world_to_local(body, world_point),
        normal: unit(world_dir_to_local(body, n_world)),
        half_thickness,
    })
}

#[inline]
fn finite_v(v: V) -> bool {
    v[0].is_finite() && v[1].is_finite() && v[2].is_finite()
}

/// Rebuilds the visible face mesh of `body` for `BORN` records.
pub fn rebuild_faces(body: &Body) -> Vec<u32> {
    if body.count == 0 || body.cells.is_empty() {
        return Vec::new();
    }
    support::faces_of(&body.cells, body.size)
}

/// Rebuilds a living vehicle's collision `Hull` (`bodies/hull.rs`) after carving or denting,
/// so carved noses, doors, or chassis panels physically shrink their hull outline.
pub fn sync_hull_after_carve(body: &mut Body) {
    body.refresh_hull();
}

/// Carves a world-space sphere out of `body` (hard geometric carve).
pub fn carve_sphere(body: &mut Body, world_center: [f32; 3], radius: f32, next_id: &mut u32) -> CarveReport {
    carve_sphere_with(body, world_center, radius, CarveOptions::HARD, next_id)
}

/// Carves a world-space sphere out of `body` with configurable material resistance (`CarveOptions`).
pub fn carve_sphere_with(
    body: &mut Body,
    world_center: [f32; 3],
    radius: f32,
    opts: CarveOptions,
    next_id: &mut u32,
) -> CarveReport {
    if body.count == 0 || !finite_v(world_center) || !radius.is_finite() || radius <= 0.0 {
        return CarveReport::empty();
    }
    let local = sphere_to_local(body, world_center, radius);
    // GLASS has the largest `gives` factor: 44/16 = 2.75.
    let max_r = if opts.respect_gives { radius * (44.0 / 16.0) } else { radius };
    let Some((lo, hi)) = clamp_aabb(
        [local.center[0] - max_r, local.center[1] - max_r, local.center[2] - max_r],
        [local.center[0] + max_r, local.center[1] + max_r, local.center[2] + max_r],
        body.size,
    ) else {
        return CarveReport::empty();
    };

    let [sx, _, sz] = body.size;
    let stride_y = sx * sz;
    let r_sq = radius * radius;
    let c = local.center;
    let mut removed_cells = Vec::new();

    for y in lo[1]..hi[1] {
        let dy = y as f32 + 0.5 - c[1];
        let dy2 = dy * dy;
        let y_off = y * stride_y;
        for z in lo[2]..hi[2] {
            let dz = z as f32 + 0.5 - c[2];
            let dyz2 = dy2 + dz * dz;
            if dyz2 > max_r * max_r {
                continue;
            }
            let row = y_off + z * sx;
            for x in lo[0]..hi[0] {
                let idx = row + x;
                let kind = body.cells[idx];
                if kind == 0 {
                    continue;
                }
                let dx = x as f32 + 0.5 - c[0];
                let d2 = dx * dx + dyz2;
                let hit = if opts.respect_gives {
                    let eff = radius * (gives(material(kind)) as f32 * (1.0 / 16.0));
                    d2 <= eff * eff
                } else {
                    d2 <= r_sq
                };
                if hit {
                    body.cells[idx] = 0;
                    removed_cells.push(([x, y, z], kind));
                }
            }
        }
    }

    finalize_carve(body, removed_cells, next_id)
}

/// Carves a world-space capsule (swept blade cut or projectile tunnel) out of `body` (hard carve).
pub fn carve_capsule(
    body: &mut Body,
    world_a: [f32; 3],
    world_b: [f32; 3],
    radius: f32,
    next_id: &mut u32,
) -> CarveReport {
    carve_capsule_with(body, world_a, world_b, radius, CarveOptions::HARD, next_id)
}

/// Carves a world-space capsule out of `body` with configurable material resistance (`CarveOptions`).
pub fn carve_capsule_with(
    body: &mut Body,
    world_a: [f32; 3],
    world_b: [f32; 3],
    radius: f32,
    opts: CarveOptions,
    next_id: &mut u32,
) -> CarveReport {
    if body.count == 0
        || !finite_v(world_a)
        || !finite_v(world_b)
        || !radius.is_finite()
        || radius <= 0.0
    {
        return CarveReport::empty();
    }
    let cap = capsule_to_local(body, world_a, world_b, radius);
    let max_r = if opts.respect_gives { radius * (44.0 / 16.0) } else { radius };
    let min_p = [cap.a[0].min(cap.b[0]) - max_r, cap.a[1].min(cap.b[1]) - max_r, cap.a[2].min(cap.b[2]) - max_r];
    let max_p = [cap.a[0].max(cap.b[0]) + max_r, cap.a[1].max(cap.b[1]) + max_r, cap.a[2].max(cap.b[2]) + max_r];
    let Some((lo, hi)) = clamp_aabb(min_p, max_p, body.size) else {
        return CarveReport::empty();
    };

    let ab = sub(cap.b, cap.a);
    let ab_len_sq = dot(ab, ab);
    let inv_ab_len_sq = if ab_len_sq > 1e-12 { 1.0 / ab_len_sq } else { 0.0 };
    let r_sq = radius * radius;
    let [sx, _, sz] = body.size;
    let stride_y = sx * sz;
    let mut removed_cells = Vec::new();

    for y in lo[1]..hi[1] {
        let py = y as f32 + 0.5;
        let ap_y = py - cap.a[1];
        let y_off = y * stride_y;
        for z in lo[2]..hi[2] {
            let pz = z as f32 + 0.5;
            let ap_z = pz - cap.a[2];
            let dot_yz = ap_y * ab[1] + ap_z * ab[2];
            let row = y_off + z * sx;
            for x in lo[0]..hi[0] {
                let idx = row + x;
                let kind = body.cells[idx];
                if kind == 0 {
                    continue;
                }
                let ap_x = x as f32 + 0.5 - cap.a[0];
                let t = ((ap_x * ab[0] + dot_yz) * inv_ab_len_sq).clamp(0.0, 1.0);
                let dx = ap_x - ab[0] * t;
                let dy = ap_y - ab[1] * t;
                let dz = ap_z - ab[2] * t;
                let d2 = dx * dx + dy * dy + dz * dz;
                let hit = if opts.respect_gives {
                    let eff = radius * (gives(material(kind)) as f32 * (1.0 / 16.0));
                    d2 <= eff * eff
                } else {
                    d2 <= r_sq
                };
                if hit {
                    body.cells[idx] = 0;
                    removed_cells.push(([x, y, z], kind));
                }
            }
        }
    }

    finalize_carve(body, removed_cells, next_id)
}

/// Slices `body` along a world-space plane with total kerf `thickness` (`half_thickness = thickness * 0.5`).
pub fn carve_plane(
    body: &mut Body,
    world_point: [f32; 3],
    world_normal: [f32; 3],
    thickness: f32,
    next_id: &mut u32,
) -> CarveReport {
    if body.count == 0 || !thickness.is_finite() || thickness <= 0.0 {
        return CarveReport::empty();
    }
    let Some(plane) = plane_to_local(body, world_point, world_normal, thickness * 0.5) else {
        return CarveReport::empty();
    };

    let [sx, sy, sz] = body.size;
    // Fast plane-vs-AABB rejection: project the grid box onto the plane normal.
    let half_ext = [sx as f32 * 0.5, sy as f32 * 0.5, sz as f32 * 0.5];
    let box_dist = dot(sub(half_ext, plane.point), plane.normal);
    let box_reach =
        half_ext[0] * plane.normal[0].abs() + half_ext[1] * plane.normal[1].abs() + half_ext[2] * plane.normal[2].abs();
    if box_dist.abs() > box_reach + plane.half_thickness {
        return CarveReport::empty();
    }

    let stride_y = sx * sz;
    let [nx, ny, nz] = plane.normal;
    let d_origin = dot(plane.point, plane.normal);
    let half = plane.half_thickness;
    let mut removed_cells = Vec::new();

    for y in 0..sy {
        let base_y = (y as f32 + 0.5) * ny - d_origin;
        let y_off = y * stride_y;
        for z in 0..sz {
            let base_yz = base_y + (z as f32 + 0.5) * nz;
            let row = y_off + z * sx;
            for x in 0..sx {
                let dist = (base_yz + (x as f32 + 0.5) * nx).abs();
                if dist <= half {
                    let idx = row + x;
                    let kind = body.cells[idx];
                    if kind != 0 {
                        body.cells[idx] = 0;
                        removed_cells.push(([x, y, z], kind));
                    }
                }
            }
        }
    }

    finalize_carve(body, removed_cells, next_id)
}

#[inline]
fn clamp_aabb(min_p: V, max_p: V, size: [usize; 3]) -> Option<([usize; 3], [usize; 3])> {
    let mut lo = [0usize; 3];
    let mut hi = [0usize; 3];
    for a in 0..3 {
        let s = size[a] as f32;
        if max_p[a] < 0.0 || min_p[a] > s {
            return None;
        }
        lo[a] = (min_p[a].floor().max(0.0) as usize).min(size[a]);
        hi[a] = ((max_p[a].ceil() + 1.0).max(0.0) as usize).min(size[a]);
        if lo[a] >= hi[a] {
            return None;
        }
    }
    Some((lo, hi))
}

#[derive(Clone, Copy)]
struct Component {
    start: usize,
    len: usize,
    lo: [usize; 3],
    hi: [usize; 3],
}

#[derive(Default)]
struct CarveScratch {
    bits: Vec<u64>,
    queue: Vec<(u32, u32)>,
    queue_wide: Vec<(usize, [usize; 3])>,
    comps: Vec<Component>,
    sharp: Vec<V>,
    flat: Vec<V>,
}

thread_local! {
    static SCRATCH: RefCell<CarveScratch> = RefCell::new(CarveScratch::default());
}

/// Runs fast bit-packed 6-connected component analysis on the remaining voxels,
/// tight-crops and rebuilds `body` in place, and spawns `k - 1` disconnected islands
/// with exact world-space continuity and linear + angular momentum conservation.
fn finalize_carve(body: &mut Body, removed_cells: Vec<([usize; 3], Kind)>, next_id: &mut u32) -> CarveReport {
    let removed = removed_cells.len();
    if removed == 0 {
        return CarveReport::empty();
    }

    let [sx, sy, sz] = body.size;
    let total = sx * sy * sz;
    let n_words = total.div_ceil(64);
    let stride_y = sx * sz;

    SCRATCH.with(|cell| {
        let mut guard = cell.borrow_mut();
        let s = &mut *guard;
        s.bits.resize(n_words, 0);
        let mut remaining = 0usize;
        for (w, chunk) in body.cells.chunks(64).enumerate() {
            let mut mask = 0u64;
            for (bit, &k) in chunk.iter().enumerate() {
                if k != 0 {
                    mask |= 1u64 << bit;
                }
            }
            s.bits[w] = mask;
            remaining += mask.count_ones() as usize;
        }

        if remaining == 0 {
            body.cells.clear();
            body.size = [0, 0, 0];
            body.count = 0;
            body.inv_mass = 0.0;
            body.inv_inertia = [[0.0; 3]; 3];
            body.points.clear();
            body.turned.clear();
            body.radius = 0.0;
            body.still = 0.0;
            body.asleep = false;
            sync_hull_after_carve(body);
            return CarveReport { removed, removed_cells, split_bodies: Vec::new(), destroyed: true };
        }

        s.comps.clear();
        let compact = sx <= 1024 && sy <= 1024 && sz <= 1024 && total <= u32::MAX as usize;
        if compact {
            run_cca_compact(s, [sx, sy, sz], stride_y, n_words, remaining);
        } else {
            run_cca_wide(s, [sx, sy, sz], stride_y, n_words, remaining);
        }

        let old_pos = body.pos;
        let old_rot = body.rot;
        let old_vel = body.vel;
        let old_spin = body.spin;
        let old_com = body.com;
        let old_born = body.born;
        let old_broken = body.broken;
        let old_lump = body.lump;
        let old_thrown = body.thrown;
        let old_passing = body.passing;

        if s.comps.len() == 1 {
            let comp = s.comps[0];
            let new_size = [comp.hi[0] - comp.lo[0], comp.hi[1] - comp.lo[1], comp.hi[2] - comp.lo[2]];
            if comp.lo != [0, 0, 0] || new_size != body.size {
                let mut cropped = vec![0 as Kind; new_size[0] * new_size[1] * new_size[2]];
                if compact {
                    copy_component_compact(&body.cells, &s.queue[comp.start..comp.start + comp.len], comp.lo, new_size, &mut cropped);
                } else {
                    copy_component_wide(&body.cells, &s.queue_wide[comp.start..comp.start + comp.len], comp.lo, new_size, &mut cropped);
                }
                body.cells = cropped;
                body.size = new_size;
                body.born = [
                    old_born[0] + comp.lo[0] as i32,
                    old_born[1] + comp.lo[1] as i32,
                    old_born[2] + comp.lo[2] as i32,
                ];
                if let Some(live) = body.live.as_mut() {
                    for foot in &mut live.feet {
                        foot.at[0] -= comp.lo[0] as f32;
                        foot.at[1] -= comp.lo[1] as f32;
                        foot.at[2] -= comp.lo[2] as f32;
                    }
                }
            }
            rebuild_physics(body, &mut s.sharp, &mut s.flat);
            let com_in_parent = [
                comp.lo[0] as f32 + body.com[0],
                comp.lo[1] as f32 + body.com[1],
                comp.lo[2] as f32 + body.com[2],
            ];
            let r_i = turn(old_rot, sub(com_in_parent, old_com));
            body.pos = add(old_pos, r_i);
            body.vel = add(old_vel, cross(old_spin, r_i));
            body.spin = old_spin;
            body.still = 0.0;
            body.asleep = false;
            sync_hull_after_carve(body);
            return CarveReport { removed, removed_cells, split_bodies: Vec::new(), destroyed: false };
        }

        // k >= 2 components: keep the largest component on `body` (ties broken deterministically by
        // earliest scan order), and spawn `k - 1` new `Body` instances for the remaining islands.
        let mut largest = 0usize;
        for i in 1..s.comps.len() {
            if s.comps[i].len > s.comps[largest].len {
                largest = i;
            }
        }

        let old_cells = std::mem::take(&mut body.cells);
        let mut split_bodies = Vec::with_capacity(s.comps.len() - 1);

        for idx_c in 0..s.comps.len() {
            let comp = s.comps[idx_c];
            let new_size = [comp.hi[0] - comp.lo[0], comp.hi[1] - comp.lo[1], comp.hi[2] - comp.lo[2]];
            let mut grid = vec![0 as Kind; new_size[0] * new_size[1] * new_size[2]];
            if compact {
                copy_component_compact(&old_cells, &s.queue[comp.start..comp.start + comp.len], comp.lo, new_size, &mut grid);
            } else {
                copy_component_wide(&old_cells, &s.queue_wide[comp.start..comp.start + comp.len], comp.lo, new_size, &mut grid);
            }
            let new_born = [
                old_born[0] + comp.lo[0] as i32,
                old_born[1] + comp.lo[1] as i32,
                old_born[2] + comp.lo[2] as i32,
            ];

            if idx_c == largest {
                body.cells = grid;
                body.size = new_size;
                body.born = new_born;
                if comp.lo != [0, 0, 0] {
                    if let Some(live) = body.live.as_mut() {
                        for foot in &mut live.feet {
                            foot.at[0] -= comp.lo[0] as f32;
                            foot.at[1] -= comp.lo[1] as f32;
                            foot.at[2] -= comp.lo[2] as f32;
                        }
                    }
                }
                rebuild_physics(body, &mut s.sharp, &mut s.flat);
                let com_in_parent = [
                    comp.lo[0] as f32 + body.com[0],
                    comp.lo[1] as f32 + body.com[1],
                    comp.lo[2] as f32 + body.com[2],
                ];
                let r_i = turn(old_rot, sub(com_in_parent, old_com));
                body.pos = add(old_pos, r_i);
                body.rot = old_rot;
                body.vel = add(old_vel, cross(old_spin, r_i));
                body.spin = old_spin;
                body.still = 0.0;
                body.asleep = false;
                sync_hull_after_carve(body);
            } else {
                let id = *next_id;
                *next_id += 1;
                let mut island = Body {
                    id,
                    size: new_size,
                    cells: grid,
                    count: 0,
                    inv_mass: 0.0,
                    com: [0.0; 3],
                    inv_inertia: [[0.0; 3]; 3],
                    pos: [0.0; 3],
                    rot: old_rot,
                    vel: [0.0; 3],
                    spin: old_spin,
                    points: Vec::new(),
                    turned: Vec::new(),
                    radius: 0.0,
                    still: 0.0,
                    age: 0.0,
                    apart: 1.0,
                    footing: [0.0; 4],
                    knock: 0.0,
                    broken: old_broken,
                    wear: 0.0,
                    stuff: 0,
                    lump: old_lump,
                    thrown: old_thrown,
                    passing: old_passing,
                    born: new_born,
                    live: None,
                    asleep: false,
                    persist_sleep: false,
                    island_id: 0,
                };
                rebuild_physics(&mut island, &mut s.sharp, &mut s.flat);
                let com_in_parent = [
                    comp.lo[0] as f32 + island.com[0],
                    comp.lo[1] as f32 + island.com[1],
                    comp.lo[2] as f32 + island.com[2],
                ];
                let r_i = turn(old_rot, sub(com_in_parent, old_com));
                island.pos = add(old_pos, r_i);
                island.vel = add(old_vel, cross(old_spin, r_i));
                split_bodies.push(island);
            }
        }

        CarveReport { removed, removed_cells, split_bodies, destroyed: false }
    })
}

#[inline]
fn run_cca_compact(
    s: &mut CarveScratch,
    size: [usize; 3],
    stride_y: usize,
    n_words: usize,
    remaining: usize,
) {
    let [sx, sy, sz] = size;
    let sx_u32 = sx as u32;
    let sy_stride = stride_y as u32;
    let sx_lim = (sx - 1) as u32;
    let sy_lim = (sy - 1) as u32;
    let sz_lim = (sz - 1) as u32;

    s.queue.clear();
    if s.queue.capacity() < remaining {
        s.queue.reserve(remaining - s.queue.capacity());
    }

    let mut visited = 0usize;
    let mut word_idx = 0usize;
    while word_idx < n_words && visited < remaining {
        let w = s.bits[word_idx];
        if w == 0 {
            word_idx += 1;
            continue;
        }
        let tz = w.trailing_zeros() as usize;
        let start_idx = (word_idx << 6) + tz;
        s.bits[word_idx] = w & !(1u64 << tz);

        let x0 = start_idx % sx;
        let y0 = start_idx / stride_y;
        let z0 = (start_idx / sx) % sz;
        let packed0 = (x0 as u32) | ((z0 as u32) << 10) | ((y0 as u32) << 20);

        let comp_start = s.queue.len();
        s.queue.push((start_idx as u32, packed0));
        let mut head = comp_start;
        let (mut min_x, mut max_x) = (x0 as u32, x0 as u32);
        let (mut min_y, mut max_y) = (y0 as u32, y0 as u32);
        let (mut min_z, mut max_z) = (z0 as u32, z0 as u32);

        while head < s.queue.len() {
            let (idx, p) = s.queue[head];
            head += 1;
            let x = p & 1023;
            let z = (p >> 10) & 1023;
            let y = p >> 20;
            if x < min_x { min_x = x; }
            if x > max_x { max_x = x; }
            if y < min_y { min_y = y; }
            if y > max_y { max_y = y; }
            if z < min_z { min_z = z; }
            if z > max_z { max_z = z; }

            if x > 0 {
                let ni = idx - 1;
                let bw = (ni >> 6) as usize;
                let m = 1u64 << (ni & 63);
                if s.bits[bw] & m != 0 {
                    s.bits[bw] &= !m;
                    s.queue.push((ni, p - 1));
                }
            }
            if x < sx_lim {
                let ni = idx + 1;
                let bw = (ni >> 6) as usize;
                let m = 1u64 << (ni & 63);
                if s.bits[bw] & m != 0 {
                    s.bits[bw] &= !m;
                    s.queue.push((ni, p + 1));
                }
            }
            if z > 0 {
                let ni = idx - sx_u32;
                let bw = (ni >> 6) as usize;
                let m = 1u64 << (ni & 63);
                if s.bits[bw] & m != 0 {
                    s.bits[bw] &= !m;
                    s.queue.push((ni, p - (1 << 10)));
                }
            }
            if z < sz_lim {
                let ni = idx + sx_u32;
                let bw = (ni >> 6) as usize;
                let m = 1u64 << (ni & 63);
                if s.bits[bw] & m != 0 {
                    s.bits[bw] &= !m;
                    s.queue.push((ni, p + (1 << 10)));
                }
            }
            if y > 0 {
                let ni = idx - sy_stride;
                let bw = (ni >> 6) as usize;
                let m = 1u64 << (ni & 63);
                if s.bits[bw] & m != 0 {
                    s.bits[bw] &= !m;
                    s.queue.push((ni, p - (1 << 20)));
                }
            }
            if y < sy_lim {
                let ni = idx + sy_stride;
                let bw = (ni >> 6) as usize;
                let m = 1u64 << (ni & 63);
                if s.bits[bw] & m != 0 {
                    s.bits[bw] &= !m;
                    s.queue.push((ni, p + (1 << 20)));
                }
            }
        }

        let len = s.queue.len() - comp_start;
        visited += len;
        s.comps.push(Component {
            start: comp_start,
            len,
            lo: [min_x as usize, min_y as usize, min_z as usize],
            hi: [max_x as usize + 1, max_y as usize + 1, max_z as usize + 1],
        });
    }
}

fn run_cca_wide(
    s: &mut CarveScratch,
    size: [usize; 3],
    stride_y: usize,
    n_words: usize,
    remaining: usize,
) {
    let [sx, sy, sz] = size;
    s.queue_wide.clear();
    if s.queue_wide.capacity() < remaining {
        s.queue_wide.reserve(remaining - s.queue_wide.capacity());
    }

    let mut visited = 0usize;
    let mut word_idx = 0usize;
    while word_idx < n_words && visited < remaining {
        let w = s.bits[word_idx];
        if w == 0 {
            word_idx += 1;
            continue;
        }
        let tz = w.trailing_zeros() as usize;
        let start_idx = (word_idx << 6) + tz;
        s.bits[word_idx] = w & !(1u64 << tz);

        let x0 = start_idx % sx;
        let y0 = start_idx / stride_y;
        let z0 = (start_idx / sx) % sz;

        let comp_start = s.queue_wide.len();
        s.queue_wide.push((start_idx, [x0, y0, z0]));
        let mut head = comp_start;
        let mut lo = [x0, y0, z0];
        let mut hi = [x0, y0, z0];

        while head < s.queue_wide.len() {
            let (idx, [x, y, z]) = s.queue_wide[head];
            head += 1;
            lo = [lo[0].min(x), lo[1].min(y), lo[2].min(z)];
            hi = [hi[0].max(x), hi[1].max(y), hi[2].max(z)];

            let mut try_push = |ni: usize, c: [usize; 3]| {
                let bw = ni >> 6;
                let m = 1u64 << (ni & 63);
                if s.bits[bw] & m != 0 {
                    s.bits[bw] &= !m;
                    s.queue_wide.push((ni, c));
                }
            };
            if x > 0 { try_push(idx - 1, [x - 1, y, z]); }
            if x + 1 < sx { try_push(idx + 1, [x + 1, y, z]); }
            if z > 0 { try_push(idx - sx, [x, y, z - 1]); }
            if z + 1 < sz { try_push(idx + sx, [x, y, z + 1]); }
            if y > 0 { try_push(idx - stride_y, [x, y - 1, z]); }
            if y + 1 < sy { try_push(idx + stride_y, [x, y + 1, z]); }
        }

        let len = s.queue_wide.len() - comp_start;
        visited += len;
        s.comps.push(Component {
            start: comp_start,
            len,
            lo,
            hi: [hi[0] + 1, hi[1] + 1, hi[2] + 1],
        });
    }
}

#[inline]
fn copy_component_compact(
    old_cells: &[Kind],
    items: &[(u32, u32)],
    lo: [usize; 3],
    new_size: [usize; 3],
    dst: &mut [Kind],
) {
    let [nx, _, nz] = new_size;
    let ny_stride = nx * nz;
    let [lx, ly, lz] = [lo[0] as u32, lo[1] as u32, lo[2] as u32];
    for &(old_idx, p) in items {
        let x = ((p & 1023) - lx) as usize;
        let z = (((p >> 10) & 1023) - lz) as usize;
        let y = ((p >> 20) - ly) as usize;
        dst[x + nx * z + ny_stride * y] = old_cells[old_idx as usize];
    }
}

fn copy_component_wide(
    old_cells: &[Kind],
    items: &[(usize, [usize; 3])],
    lo: [usize; 3],
    new_size: [usize; 3],
    dst: &mut [Kind],
) {
    let [nx, _, nz] = new_size;
    let ny_stride = nx * nz;
    for &(old_idx, [x, y, z]) in items {
        dst[(x - lo[0]) + nx * (z - lo[2]) + ny_stride * (y - lo[1])] = old_cells[old_idx];
    }
}

/// Recomputes `count`, `stuff`, `com`, `inv_mass`, `inv_inertia`, `points`, `turned`, and `radius`
/// from `body.cells`, `body.size`, and `body.rot`.
fn rebuild_physics(body: &mut Body, sharp: &mut Vec<V>, flat: &mut Vec<V>) {
    let [sx, sy, sz] = body.size;
    let stride_y = sx * sz;
    let cells = &body.cells;

    // Pass 1: count, material histogram, total mass, center of mass.
    let mut count = 0usize;
    let mut mass = 0.0f32;
    let mut sum = [0.0f32; 3];
    let mut mat_counts = [0u32; 16];
    for y in 0..sy {
        let cy = y as f32 + 0.5;
        let y_off = y * stride_y;
        for z in 0..sz {
            let cz = z as f32 + 0.5;
            let row = y_off + z * sx;
            for x in 0..sx {
                let kind = cells[row + x];
                if kind != 0 {
                    let mat = material(kind) & 15;
                    mat_counts[mat as usize] += 1;
                    let m = weighs(mat);
                    mass += m;
                    sum[0] += (x as f32 + 0.5) * m;
                    sum[1] += cy * m;
                    sum[2] += cz * m;
                    count += 1;
                }
            }
        }
    }

    body.count = count;
    body.stuff = (0..16).max_by_key(|&m| mat_counts[m]).unwrap_or(0) as u8;
    let inv_mass = if mass > 0.0 { 1.0 / mass } else { 0.0 };
    let com = scale(sum, inv_mass);
    body.com = com;
    body.inv_mass = inv_mass;

    // Pass 2: inertia tensor about `com`.
    let mut i_xx = 0.0f32;
    let mut i_yy = 0.0f32;
    let mut i_zz = 0.0f32;
    let mut i_xy = 0.0f32;
    let mut i_xz = 0.0f32;
    let mut i_yz = 0.0f32;
    for y in 0..sy {
        let ry = y as f32 + 0.5 - com[1];
        let ry2 = ry * ry;
        let y_off = y * stride_y;
        for z in 0..sz {
            let rz = z as f32 + 0.5 - com[2];
            let ryz2 = ry2 + rz * rz + 1.0 / 6.0;
            let row = y_off + z * sx;
            for x in 0..sx {
                let kind = cells[row + x];
                if kind != 0 {
                    let m = weighs(material(kind));
                    let rx = x as f32 + 0.5 - com[0];
                    let rx2 = rx * rx;
                    i_xx += m * ryz2;
                    i_yy += m * (rx2 + rz * rz + 1.0 / 6.0);
                    i_zz += m * (rx2 + ry2 + 1.0 / 6.0);
                    i_xy -= m * rx * ry;
                    i_xz -= m * rx * rz;
                    i_yz -= m * ry * rz;
                }
            }
        }
    }
    let inertia = [[i_xx, i_xy, i_xz], [i_xy, i_yy, i_yz], [i_xz, i_yz, i_zz]];
    body.inv_inertia = invert(&inertia);

    // Pass 3: surface collision corners (`sharp` & `flat`) and bounding sphere radius.
    sharp.clear();
    flat.clear();
    let mut max_r2 = 0.0f32;
    for cy in 0..=sy {
        let py = cy as f32 - com[1];
        let py2 = py * py;
        let has_ym = cy > 0;
        let has_yp = cy < sy;
        let ym_off = if has_ym { (cy - 1) * stride_y } else { 0 };
        let yp_off = if has_yp { cy * stride_y } else { 0 };
        for cz in 0..=sz {
            let pz = cz as f32 - com[2];
            let pyz2 = py2 + pz * pz;
            let has_zm = cz > 0;
            let has_zp = cz < sz;

            let r0 = if has_ym && has_zm { Some(&cells[ym_off + (cz - 1) * sx..ym_off + cz * sx]) } else { None };
            let r1 = if has_ym && has_zp { Some(&cells[ym_off + cz * sx..ym_off + (cz + 1) * sx]) } else { None };
            let r2 = if has_yp && has_zm { Some(&cells[yp_off + (cz - 1) * sx..yp_off + cz * sx]) } else { None };
            let r3 = if has_yp && has_zp { Some(&cells[yp_off + cz * sx..yp_off + (cz + 1) * sx]) } else { None };

            if let (Some(a), Some(b), Some(c), Some(d)) = (r0, r1, r2, r3) {
                let mut prev = 0u32;
                for cx in 0..=sx {
                    let cur = if cx < sx {
                        (a[cx] != 0) as u32 + (b[cx] != 0) as u32 + (c[cx] != 0) as u32 + (d[cx] != 0) as u32
                    } else {
                        0
                    };
                    let n = prev + cur;
                    prev = cur;
                    if n == 0 || n == 8 {
                        continue;
                    }
                    let px = cx as f32 - com[0];
                    let r2 = px * px + pyz2;
                    if r2 > max_r2 {
                        max_r2 = r2;
                    }
                    let p = [px, py, pz];
                    if n == 1 { sharp.push(p) } else { flat.push(p) }
                }
            } else {
                let rows = [r0, r1, r2, r3];
                let mut prev = 0u32;
                for cx in 0..=sx {
                    let mut cur = 0u32;
                    if cx < sx {
                        for r in rows.iter().flatten() {
                            cur += (r[cx] != 0) as u32;
                        }
                    }
                    let n = prev + cur;
                    prev = cur;
                    if n == 0 || n == 8 {
                        continue;
                    }
                    let px = cx as f32 - com[0];
                    let r2 = px * px + pyz2;
                    if r2 > max_r2 {
                        max_r2 = r2;
                    }
                    let p = [px, py, pz];
                    if n == 1 { sharp.push(p) } else { flat.push(p) }
                }
            }
        }
    }

    body.radius = max_r2.sqrt();
    let thin = |from: &[V], most: usize, to: &mut Vec<V>| {
        if from.len() <= most {
            to.extend_from_slice(from);
        } else {
            for k in 0..most {
                to.push(from[k * from.len() / most]);
            }
        }
    };
    let most = (12 + body.count).min(POINTS);
    body.points.clear();
    thin(sharp, most * 5 / 8, &mut body.points);
    let room = most - body.points.len();
    thin(flat, room, &mut body.points);
    if body.lump {
        body.limit_points(LUMP_POINTS);
    }

    body.turned.clear();
    body.turned.reserve(body.points.len());
    for &p in &body.points {
        body.turned.push(turn(body.rot, p));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kinds::{BRICK, GLASS, OWN, STEEL, WOOD, kind};

    fn solid_box(size: [usize; 3], k: Kind) -> Vec<Kind> {
        vec![k; size[0] * size[1] * size[2]]
    }

    fn hollow_box(size: [usize; 3], k: Kind) -> Vec<Kind> {
        let [sx, sy, sz] = size;
        let mut cells = vec![0 as Kind; sx * sy * sz];
        for y in 0..sy {
            for z in 0..sz {
                for x in 0..sx {
                    if x == 0 || x + 1 == sx || y == 0 || y + 1 == sy || z == 0 || z + 1 == sz {
                        cells[x + sx * (z + sz * y)] = k;
                    }
                }
            }
        }
        cells
    }

    fn quat_y(angle: f32) -> Q {
        [0.0, (angle * 0.5).sin(), 0.0, (angle * 0.5).cos()]
    }

    fn body_mass(b: &Body) -> f32 {
        if b.inv_mass > 0.0 { 1.0 / b.inv_mass } else { 0.0 }
    }

    /// World-space angular momentum of a rigid body about `pivot`:
    /// L = I_world * spin + (pos - pivot) x (mass * vel).
    fn angular_momentum_about(b: &Body, pivot: V) -> V {
        // Compute world inertia tensor directly from cells so we verify inv_inertia too.
        let mut l_spin = [0.0f32; 3];
        let [sx, sy, sz] = b.size;
        for y in 0..sy {
            for z in 0..sz {
                for x in 0..sx {
                    let k = b.cells[b.at(x, y, z)];
                    if k == 0 { continue; }
                    let m = weighs(material(k));
                    let r_local = sub([x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5], b.com);
                    let r_w = turn(b.rot, r_local);
                    // Cell cube self-inertia (m/6)*w + parallel axis m * r_w x (w x r_w)
                    let self_l = scale(b.spin, m * (1.0 / 6.0));
                    let orb_l = scale(cross(r_w, cross(b.spin, r_w)), m);
                    l_spin = add(l_spin, add(self_l, orb_l));
                }
            }
        }
        let r_cm = sub(b.pos, pivot);
        let p_lin = scale(b.vel, body_mass(b));
        add(l_spin, cross(r_cm, p_lin))
    }

    fn records_of(out: &[u32], tag: u32) -> Vec<Vec<u32>> {
        let mut res = Vec::new();
        let mut i = 0;
        while i < out.len() {
            let t = out[i];
            let n = out[i + 1] as usize;
            if t == tag {
                res.push(out[i + 2..i + 2 + n].to_vec());
            }
            i += 2 + n;
        }
        res
    }

    #[test]
    fn plane_slice_rotating_beam_conserves_cells_positions_and_momentum() {
        let size = [12, 4, 4];
        let wood = kind(WOOD, OWN);
        let born = [100, 50, 200];
        let mut beam = Body::new(1, solid_box(size, wood), size, born);
        beam.rot = quat_y(0.65);
        beam.pos = [110.0, 55.0, 210.0];
        beam.vel = [12.0, -3.5, 7.25];
        beam.spin = [0.0, 3.0, 0.0];

        // Record world position and instantaneous velocity of every pre-carve cell.
        let mut before_cells: std::collections::HashMap<[i32; 3], (V, V, Kind)> = std::collections::HashMap::new();
        for y in 0..size[1] {
            for z in 0..size[2] {
                for x in 0..size[0] {
                    let k = beam.cells[beam.at(x, y, z)];
                    let local = [x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5];
                    let wpos = local_to_world(&beam, local);
                    let r = sub(wpos, beam.pos);
                    let wvel = add(beam.vel, cross(beam.spin, r));
                    let paint_key = [born[0] + x as i32, born[1] + y as i32, born[2] + z as i32];
                    before_cells.insert(paint_key, (wpos, wvel, k));
                }
            }
        }
        let old_pos = beam.pos;
        let old_vel = beam.vel;
        let old_spin = beam.spin;

        // Slice cleanly across the beam's local X midpoint (local x = 6.0) with 2-cell kerf (removes x = 5, 6).
        let cut_point_world = local_to_world(&beam, [6.0, 2.0, 2.0]);
        let cut_normal_world = turn(beam.rot, [1.0, 0.0, 0.0]);
        let mut next_id = 2;
        let report = carve_plane(&mut beam, cut_point_world, cut_normal_world, 2.0, &mut next_id);

        assert!(!report.destroyed);
        assert_eq!(report.removed, 2 * 4 * 4, "2-cell kerf across 4x4 cross-section removes 32 cells");
        assert_eq!(report.split_bodies.len(), 1, "beam splits into 2 pieces (1 kept + 1 spawned)");
        assert_eq!(next_id, 3);

        let pieces: [&Body; 2] = [&beam, &report.split_bodies[0]];
        assert_eq!(pieces[0].count, 5 * 4 * 4);
        assert_eq!(pieces[1].count, 5 * 4 * 4);
        assert_eq!(pieces[0].count + pieces[1].count + report.removed, 12 * 4 * 4, "zero cell loss outside kerf");

        // Compute exact expected linear and angular momentum of the remaining cells BEFORE the split.
        let mut expected_p = [0.0f32; 3];
        let mut expected_l = [0.0f32; 3];
        let mut seen_keys = std::collections::HashSet::new();

        for piece in pieces {
            assert_eq!(piece.size, [5, 4, 4], "each half is tight-cropped to 5x4x4");
            // Verify inherited velocity formula: v_i = old_vel + cross(old_spin, piece.pos - old_pos)
            let r_i = sub(piece.pos, old_pos);
            let v_expected = add(old_vel, cross(old_spin, r_i));
            for a in 0..3 {
                assert!(
                    (piece.vel[a] - v_expected[a]).abs() < 1e-4,
                    "piece {} vel[{a}] mismatch: got {}, expected {}",
                    piece.id, piece.vel[a], v_expected[a]
                );
                assert!((piece.spin[a] - old_spin[a]).abs() < 1e-6);
            }

            // Verify every single remaining cell stays frozen at its exact pre-carve world position,
            // retains its exact instantaneous world velocity, and preserves its paint key (`born + local`).
            for y in 0..piece.size[1] {
                for z in 0..piece.size[2] {
                    for x in 0..piece.size[0] {
                        let k = piece.cells[piece.at(x, y, z)];
                        assert_eq!(k, wood);
                        let paint_key = [piece.born[0] + x as i32, piece.born[1] + y as i32, piece.born[2] + z as i32];
                        assert!(seen_keys.insert(paint_key), "duplicate cell at {paint_key:?}");
                        let (old_wpos, old_wvel, old_k) = before_cells[&paint_key];
                        assert_eq!(k, old_k);

                        let new_wpos = local_to_world(piece, [x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5]);
                        let pos_err = dot(sub(new_wpos, old_wpos), sub(new_wpos, old_wpos)).sqrt();
                        assert!(pos_err < 1e-4, "cell moved in world space by {pos_err}");

                        let new_wvel = add(piece.vel, cross(piece.spin, sub(new_wpos, piece.pos)));
                        let vel_err = dot(sub(new_wvel, old_wvel), sub(new_wvel, old_wvel)).sqrt();
                        assert!(vel_err < 1e-4, "cell velocity changed by {vel_err}");

                        let m = weighs(material(k));
                        expected_p = add(expected_p, scale(old_wvel, m));
                        let r_c = sub(old_wpos, old_pos);
                        expected_l = add(
                            expected_l,
                            add(scale(old_spin, m * (1.0 / 6.0)), scale(cross(r_c, old_wvel), m)),
                        );
                    }
                }
            }
        }

        // Verify total linear and angular momentum conservation of the 2 pieces against the remaining mass.
        let actual_p = add(
            scale(pieces[0].vel, body_mass(pieces[0])),
            scale(pieces[1].vel, body_mass(pieces[1])),
        );
        let actual_l = add(
            angular_momentum_about(pieces[0], old_pos),
            angular_momentum_about(pieces[1], old_pos),
        );
        for a in 0..3 {
            assert!(
                (actual_p[a] - expected_p[a]).abs() < 1e-3,
                "linear momentum[{a}] mismatch: got {}, expected {}",
                actual_p[a], expected_p[a]
            );
            assert!(
                (actual_l[a] - expected_l[a]).abs() < 1e-2,
                "angular momentum[{a}] mismatch: got {}, expected {}",
                actual_l[a], expected_l[a]
            );
        }
    }

    #[test]
    fn capsule_cut_through_hollow_crate_punches_hole_then_splits_on_second_cut() {
        let mut bodies = Bodies::new();
        let size = [10, 10, 10];
        let wood = kind(WOOD, OWN);
        let crate_body = Body::new(1, hollow_box(size, wood), size, [0, 20, 0]);
        let initial_count = crate_body.count;
        let orig_pos = crate_body.pos;
        bodies.next = 2;
        bodies.list.push(crate_body);

        // First cut: narrow capsule punching straight through the center along Z (x=5, y=5, z=-2..12).
        // The outer frame stays 6-connected, so it must punch a clean through-hole without splitting.
        let a1 = [orig_pos[0], orig_pos[1], orig_pos[2] - 10.0];
        let b1 = [orig_pos[0], orig_pos[1], orig_pos[2] + 10.0];
        let removed1 = bodies.carve_capsule(1, a1, b1, 1.5);

        assert!(removed1 > 0, "first capsule cut must remove cells on front and back faces");
        assert_eq!(bodies.list.len(), 1, "hollow crate frame stays intact after central through-hole");
        assert_eq!(bodies.list[0].id, 1);
        assert_eq!(bodies.list[0].count, initial_count - removed1);
        // Verify front and back faces are punctured (empty at center) while edges remain solid.
        assert_eq!(bodies.list[0].cells[bodies.list[0].at(5, 5, 0)], 0);
        assert_eq!(bodies.list[0].cells[bodies.list[0].at(5, 5, 9)], 0);
        assert_ne!(bodies.list[0].cells[bodies.list[0].at(0, 0, 0)], 0);
        // Verify BROKE + BORN + DUST records emitted.
        assert_eq!(records_of(&bodies.out, BROKE).len(), 1);
        assert_eq!(records_of(&bodies.out, BORN).len(), 1);
        assert!(!records_of(&bodies.out, DUST).is_empty());

        // Second cut: sweeping horizontal capsule slicing completely through the mid-plane (y = orig_pos[1])
        // across the entire crate width and depth -> must split it into top and bottom halves!
        bodies.out.clear();
        let mut removed2 = 0usize;
        // Sweep across X at y = orig_pos[1] with radius large enough to sever all 4 side walls along Z.
        for z_off in [-4.5f32, 0.0, 4.5] {
            let a = [orig_pos[0] - 8.0, orig_pos[1], orig_pos[2] + z_off];
            let b = [orig_pos[0] + 8.0, orig_pos[1], orig_pos[2] + z_off];
            removed2 += bodies.carve_capsule(1, a, b, 2.5);
        }

        assert!(removed2 > 0);
        assert_eq!(bodies.list.len(), 2, "second cut severs the remaining frame into 2 separate bodies");
        assert_ne!(bodies.list[0].id, bodies.list[1].id);
        assert!(bodies.list[0].count > 0 && bodies.list[1].count > 0);
        assert!(!bodies.list[0].asleep && !bodies.list[1].asleep);
        assert!(records_of(&bodies.out, BORN).len() >= 2, "both mutated and spawned halves emit BORN");
    }

    #[test]
    fn sphere_carve_destroying_small_body_sets_destroyed_and_emits_gone() {
        let mut bodies = Bodies::new();
        let small = Body::new(1, solid_box([3, 3, 3], kind(BRICK, OWN)), [3, 3, 3], [10, 10, 10]);
        let center = small.pos;
        bodies.next = 2;
        bodies.list.push(small);

        // Direct API check on a clone-like fresh body.
        let mut direct = Body::new(9, solid_box([3, 3, 3], kind(BRICK, OWN)), [3, 3, 3], [10, 10, 10]);
        let mut next_id = 10;
        let report = carve_sphere(&mut direct, center, 5.0, &mut next_id);
        assert!(report.destroyed);
        assert_eq!(report.removed, 27);
        assert!(report.split_bodies.is_empty());
        assert_eq!(direct.count, 0);

        // Bodies wrapper check: removes body from list, emits GONE (8 words) and DUST, no BORN.
        let removed = bodies.carve_sphere(1, center, 5.0);
        assert_eq!(removed, 27);
        assert!(bodies.list.is_empty(), "destroyed body must be removed from Bodies::list");
        let gone = records_of(&bodies.out, GONE);
        assert_eq!(gone.len(), 1, "GONE must be emitted");
        assert_eq!(gone[0].len(), 8, "GONE payload is id + pos(3) + rot(4)");
        assert_eq!(gone[0][0], 1);
        assert!(records_of(&bodies.out, BORN).is_empty());
        assert!(!records_of(&bodies.out, DUST).is_empty());
    }

    #[test]
    fn material_aware_sphere_carve_respects_gives_resistance() {
        // Build a 16x4x4 bar: left half GLASS (gives=44 -> 2.75r), right half STEEL (gives=4 -> 0.25r).
        let size = [16, 4, 4];
        let mut cells = vec![0 as Kind; size[0] * size[1] * size[2]];
        for y in 0..4 {
            for z in 0..4 {
                for x in 0..16 {
                    cells[x + 16 * (z + 4 * y)] = if x < 8 { kind(GLASS, OWN) } else { kind(STEEL, OWN) };
                }
            }
        }
        let mut bar = Body::new(1, cells, size, [0, 0, 0]);
        let center = local_to_world(&bar, [8.0, 2.0, 2.0]);
        let mut next_id = 2;
        // Radius 4.0: glass gives up to 11.0 cells (all glass destroyed), steel gives only 1.0 cell!
        let report = carve_sphere_with(&mut bar, center, 4.0, CarveOptions::MATERIAL_AWARE, &mut next_id);
        assert!(!report.destroyed);
        let glass_removed = report.removed_cells.iter().filter(|(_, k)| material(*k) == GLASS).count();
        let steel_removed = report.removed_cells.iter().filter(|(_, k)| material(*k) == STEEL).count();
        assert_eq!(glass_removed, 8 * 4 * 4, "all glass within 2.75x radius shatters");
        assert!(steel_removed < 16, "steel resists the blast (removed only {steel_removed})");
    }

    #[test]
    fn sync_hull_after_carve_shrinks_vehicle_collision_hull() {
        let mut bodies = Bodies::new();
        let low = living::tests::level(&mut bodies);
        let car_id = living::tests::car(&mut bodies, low);
        let car_pos = bodies.list.iter().find(|b| b.id == car_id).unwrap().pos;
        let orig_size_x = bodies.list.iter().find(|b| b.id == car_id).unwrap().size[0];

        // Carve away the front half of the car along +X with a plane slice + sphere cleanup.
        let front_cut = [car_pos[0] + 6.0, car_pos[1], car_pos[2]];
        let removed = bodies.carve_sphere(car_id, front_cut, 12.0);
        assert!(removed > 0, "car nose should lose cells");

        let car = bodies.list.iter().find(|b| b.id == car_id).unwrap();
        assert!(car.size[0] < orig_size_x, "car bounding box shrunk from {orig_size_x} to {}", car.size[0]);
        assert!(car.live.as_ref().unwrap().hull.is_some(), "hull stays present and synced");

        // Place a probe car overlapping where the carved nose USED to be, clear of the remaining tail.
        let probe_low = [low[0] + orig_size_x as i32 - 4, low[1], low[2]];
        let probe_id = living::tests::car(&mut bodies, probe_low);
        let car = bodies.list.iter().find(|b| b.id == car_id).unwrap();
        let probe = bodies.list.iter().find(|b| b.id == probe_id).unwrap();
        let ha = car.live.as_ref().unwrap().hull.as_ref().unwrap();
        let hb = probe.live.as_ref().unwrap().hull.as_ref().unwrap();
        let mut touches = Vec::new();
        let overlap = hull::meet(car, ha, probe, hb, &mut touches);
        assert!(overlap.is_none(), "shrunk vehicle hull must not collide in the carved-away nose zone");
    }

    #[test]
    fn carve_and_cca_split_32x32x32_completes_under_2ms() {
        let size = [32, 32, 32];
        let brick = kind(BRICK, OWN);
        // Warm up thread-local scratch once outside the timed split, just like live gameplay.
        {
            let mut warm = Body::new(1, solid_box([8, 8, 8], brick), [8, 8, 8], [0, 0, 0]);
            let warm_pos = warm.pos;
            let mut nid = 2;
            let _ = carve_plane(&mut warm, warm_pos, [1.0, 0.0, 0.0], 2.0, &mut nid);
        }

        let mut body = Body::new(1, solid_box(size, brick), size, [0, 0, 0]);
        let cut_pt = body.pos;
        let mut next_id = 2;

        let t0 = std::time::Instant::now();
        let report = carve_plane(&mut body, cut_pt, [1.0, 0.0, 0.0], 2.0, &mut next_id);
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;

        eprintln!(
            "32x32x32 carve + CCA split: {elapsed_ms:.3} ms (removed={}, kept={}, split={})",
            report.removed,
            body.count,
            report.split_bodies[0].count
        );
        assert_eq!(report.removed, 2 * 32 * 32);
        assert_eq!(report.split_bodies.len(), 1);
        assert_eq!(body.count, 15 * 32 * 32);
        assert_eq!(report.split_bodies[0].count, 15 * 32 * 32);
        assert_eq!(rebuild_faces(&body).is_empty(), false);
        // In debug builds, unoptimized loops can exceed 2 ms; enforce strict < 2 ms budget in release.
        #[cfg(not(debug_assertions))]
        assert!(
            elapsed_ms < 2.0,
            "32x32x32 carve + CCA split took {elapsed_ms:.3} ms, exceeding 2.0 ms release budget"
        );
    }
}
