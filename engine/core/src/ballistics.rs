//! Ranged combat & shockwave physics (#166):
//!
//! 1. **Sub-stepped 3D Amanatides-Woo DDA Ballistic Projectiles** (`dda_ray`, `swept_sphere_dda`,
//!    `BallisticSim`) for bullets, shrapnel, and thrust-driven shaped-charge rockets with zero-tunneling
//!    CCD against both voxel grids and dynamic AABB/capsule targets.
//! 2. **Material Penetration & Grazing Ricochet** driven by `kinds.rs` (`gives`, `weighs`, `breaks_at`):
//!    per-cell stopping energy, grazing-angle ricochet off hard surfaces with energy loss + spark events,
//!    1-cell voxel chip events, and exact momentum transfer `dp = m * dv` to dynamic targets.
//! 3. **Occluded Blast Pressure Waves & Delayed Shockwaves** (`ShockwaveQueue`): 64-direction Fibonacci
//!    sphere occlusion field, sonic-speed wave propagation (~340 m/s = 3400 cells/s) with delayed
//!    overpressure & glass shatter, and directional shrapnel rays.
//! 4. **Shaped-Charge Rockets**: motor thrust + fuel timer, swept-sphere (`r = 1.5` cells) DDA,
//!    optional 3D proportional-navigation guidance, and directional armor-piercing jet detonation.
//!
//! Units follow the rest of `engine/core`: lengths in finest cells (`1 cell = 0.1 m`),
//! speeds in `cells/s`, time in seconds, masses in `kg`, kinetic energy in Joules (`J`),
//! impulse in `kg * cells/s` (so `dv_body = impulse / body.mass` in `cells/s`),
//! and blast overpressure in `kPa`.

use crate::hash::hash3;
use crate::kinds;
use crate::tree::Kind;
use std::sync::OnceLock;

/// Finest cells per metre (`1 cell = 10 cm`).
pub const CELLS_PER_METER: f32 = 10.0;
/// Standard gravity in `cells/s^2` (`9.81 m/s^2`).
pub const GRAVITY_CELLS: f32 = 98.1;
/// Speed of sound in dry air at sea level (`340 m/s = 3400 cells/s`).
pub const SPEED_OF_SOUND_CELLS: f32 = 3400.0;
/// Number of occlusion rays cast on the Fibonacci sphere for every blast.
pub const OCCLUSION_RAYS: usize = 64;
/// Maximum ricochets allowed per ballistic projectile.
const MAX_RICOCHETS: u8 = 3;
/// Minimum kinetic energy (J) required to sustain a ricochet or penetration.
const MIN_ALIVE_ENERGY: f32 = 1.0;
const MIN_RICOCHET_ENERGY: f32 = 15.0;
/// Maximum collision interactions per projectile sub-step (guards degenerate geometry).
const MAX_HITS_PER_SUBSTEP: u32 = 32;

// ── Vector math helpers (zero external dependencies) ────────────────────────

#[inline]
fn add3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

#[inline]
fn sub3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

#[inline]
fn scale3(a: [f32; 3], s: f32) -> [f32; 3] {
    [a[0] * s, a[1] * s, a[2] * s]
}

#[inline]
fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline]
fn cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[inline]
fn len_sq3(a: [f32; 3]) -> f32 {
    dot3(a, a)
}

#[inline]
fn len3(a: [f32; 3]) -> f32 {
    len_sq3(a).sqrt()
}

#[inline]
fn normalize3(a: [f32; 3]) -> Option<([f32; 3], f32)> {
    let l = len3(a);
    if l > 1e-12 && l.is_finite() {
        let inv = 1.0 / l;
        Some(([a[0] * inv, a[1] * inv, a[2] * inv], l))
    } else {
        None
    }
}

#[inline]
fn dominant_axis_normal(v: [f32; 3]) -> [f32; 3] {
    let ax = v[0].abs();
    let ay = v[1].abs();
    let az = v[2].abs();
    if ax >= ay && ax >= az {
        [if v[0] >= 0.0 { 1.0 } else { -1.0 }, 0.0, 0.0]
    } else if ay >= az {
        [0.0, if v[1] >= 0.0 { 1.0 } else { -1.0 }, 0.0]
    } else {
        [0.0, 0.0, if v[2] >= 0.0 { 1.0 } else { -1.0 }]
    }
}

#[inline]
fn kinetic_energy_j(mass_kg: f32, speed_cells: f32) -> f32 {
    let v_m = speed_cells * (1.0 / CELLS_PER_METER);
    0.5 * mass_kg * v_m * v_m
}

#[inline]
fn speed_from_energy_j(energy_j: f32, mass_kg: f32) -> f32 {
    if energy_j <= 0.0 || mass_kg <= 0.0 {
        return 0.0;
    }
    ((2.0 * energy_j) / mass_kg).sqrt() * CELLS_PER_METER
}

// ── Dynamic targets & geometric intersections ───────────────────────────────

/// Dynamic body or ragdoll AABB proxy tested alongside voxels during CCD and shockwaves.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DynamicTarget {
    pub id: u32,
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub material: u8,
    pub mass: f32,
}

impl DynamicTarget {
    #[inline]
    pub fn center(&self) -> [f32; 3] {
        [
            0.5 * (self.min[0] + self.max[0]),
            0.5 * (self.min[1] + self.max[1]),
            0.5 * (self.min[2] + self.max[2]),
        ]
    }

    /// Projected area in `m^2` facing unit direction `dir`.
    #[inline]
    pub fn projected_area_m2(&self, dir: [f32; 3]) -> f32 {
        let ex = (self.max[0] - self.min[0]).max(0.0);
        let ey = (self.max[1] - self.min[1]).max(0.0);
        let ez = (self.max[2] - self.min[2]).max(0.0);
        let area_cells2 = ey * ez * dir[0].abs() + ex * ez * dir[1].abs() + ex * ey * dir[2].abs();
        (area_cells2 * (1.0 / (CELLS_PER_METER * CELLS_PER_METER))).max(0.05)
    }
}

/// Dynamic capsule proxy (e.g., ragdoll limb or character torso) for exact ray-capsule CCD.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DynamicCapsule {
    pub id: u32,
    pub a: [f32; 3],
    pub b: [f32; 3],
    pub radius: f32,
    pub material: u8,
    pub mass: f32,
}

/// Exact ray-AABB slab intersection result: entry distance, exit distance, and entry outward normal.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AabbHit {
    pub t_enter: f32,
    pub t_exit: f32,
    pub normal: [f32; 3],
}

/// Exact Kay-Kajiya ray-AABB slab intersection on `[0.0, max_dist]`.
/// `dir` must be unit-length. Handles axis-parallel rays (`dir[i] == 0`) without NaNs.
pub fn ray_aabb(
    origin: [f32; 3],
    dir: [f32; 3],
    max_dist: f32,
    min: [f32; 3],
    max: [f32; 3],
) -> Option<AabbHit> {
    let mut t_min = 0.0_f32;
    let mut t_max = max_dist;
    let mut hit_axis: i32 = -1;
    let mut hit_sign: f32 = 0.0;

    for i in 0..3 {
        let d = dir[i];
        if d.abs() < 1e-12 {
            if origin[i] < min[i] || origin[i] > max[i] {
                return None;
            }
        } else {
            let inv = 1.0 / d;
            let mut t1 = (min[i] - origin[i]) * inv;
            let mut t2 = (max[i] - origin[i]) * inv;
            let sign = if inv >= 0.0 { -1.0 } else { 1.0 };
            if t1 > t2 {
                core::mem::swap(&mut t1, &mut t2);
            }
            if t1 > t_min {
                t_min = t1;
                hit_axis = i as i32;
                hit_sign = sign;
            }
            if t2 < t_max {
                t_max = t2;
            }
            if t_min > t_max {
                return None;
            }
        }
    }

    if t_max < 0.0 || t_min > max_dist {
        return None;
    }

    let normal = if hit_axis >= 0 {
        let mut n = [0.0; 3];
        n[hit_axis as usize] = hit_sign;
        n
    } else {
        // Ray started inside the AABB.
        dominant_axis_normal([-dir[0], -dir[1], -dir[2]])
    };

    Some(AabbHit {
        t_enter: t_min.max(0.0),
        t_exit: t_max,
        normal,
    })
}

/// Exact ray-capsule intersection on `[0.0, max_dist]`.
/// `dir` must be unit-length. Returns `(t_hit, outward_normal)`.
pub fn ray_capsule(
    origin: [f32; 3],
    dir: [f32; 3],
    max_dist: f32,
    cap: &DynamicCapsule,
) -> Option<(f32, [f32; 3])> {
    let ba = sub3(cap.b, cap.a);
    let oa = sub3(origin, cap.a);
    let baba = dot3(ba, ba);
    let r = cap.radius.max(0.0);
    let r2 = r * r;

    // Degenerate capsule (sphere).
    if baba < 1e-12 {
        return ray_sphere(origin, dir, max_dist, cap.a, r);
    }

    let bard = dot3(ba, dir);
    let baoa = dot3(ba, oa);
    let rdoa = dot3(dir, oa);
    let oaoa = dot3(oa, oa);

    // Check if origin starts inside the capsule.
    let s0 = (baoa / baba).clamp(0.0, 1.0);
    let p0 = add3(cap.a, scale3(ba, s0));
    let diff0 = sub3(origin, p0);
    if len_sq3(diff0) <= r2 {
        let n = normalize3(diff0)
            .map(|(u, _)| u)
            .unwrap_or_else(|| dominant_axis_normal([-dir[0], -dir[1], -dir[2]]));
        return Some((0.0, n));
    }

    let mut best_t = max_dist + 1.0;
    let mut best_n = [0.0; 3];

    // Infinite cylinder body intersection.
    let a = baba - bard * bard;
    let b = baba * rdoa - baoa * bard;
    let c = baba * oaoa - baoa * baoa - r2 * baba;
    let h = b * b - a * c;
    if h >= 0.0 && a > 1e-12 {
        let t = (-b - h.sqrt()) / a;
        if t >= 0.0 && t <= max_dist {
            let y = baoa + t * bard;
            if y >= 0.0 && y <= baba {
                best_t = t;
                let hit_p = add3(origin, scale3(dir, t));
                let axis_p = add3(cap.a, scale3(ba, y / baba));
                best_n = normalize3(sub3(hit_p, axis_p))
                    .map(|(u, _)| u)
                    .unwrap_or([0.0, 1.0, 0.0]);
            }
        }
    }

    // Endcap spheres.
    for end in [cap.a, cap.b] {
        if let Some((t, n)) = ray_sphere(origin, dir, best_t.min(max_dist), end, r)
            && t < best_t
        {
            best_t = t;
            best_n = n;
        }
    }

    if best_t <= max_dist {
        Some((best_t, best_n))
    } else {
        None
    }
}

fn ray_sphere(
    origin: [f32; 3],
    dir: [f32; 3],
    max_dist: f32,
    center: [f32; 3],
    radius: f32,
) -> Option<(f32, [f32; 3])> {
    let oc = sub3(origin, center);
    let b = dot3(oc, dir);
    let c = dot3(oc, oc) - radius * radius;
    if c <= 0.0 {
        let n = normalize3(oc)
            .map(|(u, _)| u)
            .unwrap_or_else(|| dominant_axis_normal([-dir[0], -dir[1], -dir[2]]));
        return Some((0.0, n));
    }
    let disc = b * b - c;
    if disc < 0.0 {
        return None;
    }
    let t = -b - disc.sqrt();
    if t >= 0.0 && t <= max_dist {
        let hit_p = add3(origin, scale3(dir, t));
        let n = normalize3(sub3(hit_p, center))
            .map(|(u, _)| u)
            .unwrap_or([0.0, 1.0, 0.0]);
        Some((t, n))
    } else {
        None
    }
}

/// Exact swept-sphere vs AABB intersection on `[0.0, max_dist]`.
/// `dir` must be unit-length. Handles faces in O(1) and rounded edges/corners cleanly.
fn swept_sphere_aabb(
    origin: [f32; 3],
    dir: [f32; 3],
    max_dist: f32,
    radius: f32,
    bmin: [f32; 3],
    bmax: [f32; 3],
) -> Option<(f32, [f32; 3])> {
    let emin = [bmin[0] - radius, bmin[1] - radius, bmin[2] - radius];
    let emax = [bmax[0] + radius, bmax[1] + radius, bmax[2] + radius];
    let slab = ray_aabb(origin, dir, max_dist, emin, emax)?;

    let r2 = radius * radius;
    let dist_sq_at = |t: f32| -> (f32, [f32; 3]) {
        let p = add3(origin, scale3(dir, t));
        let q = [
            p[0].clamp(bmin[0], bmax[0]),
            p[1].clamp(bmin[1], bmax[1]),
            p[2].clamp(bmin[2], bmax[2]),
        ];
        let d = sub3(p, q);
        (len_sq3(d), d)
    };

    // Fast path: face hit (or starting inside).
    let (d2_enter, diff_enter) = dist_sq_at(slab.t_enter);
    if d2_enter <= r2 + 1e-4 {
        let n = normalize3(diff_enter)
            .map(|(u, _)| u)
            .unwrap_or(slab.normal);
        return Some((slab.t_enter, n));
    }

    // Corner/edge Voronoi region: `dist_sq_at(t)` is convex on `[t_enter, t_exit]`.
    let mut lo = slab.t_enter;
    let mut hi = slab.t_exit.min(max_dist);
    if hi <= lo {
        return None;
    }

    // Golden-section search for minimum distance along segment inside expanded slab.
    let inv_phi = 0.61803398875_f32;
    let inv_phi2 = 0.38196601125_f32;
    let mut a = lo;
    let mut b = hi;
    let mut c = a + inv_phi2 * (b - a);
    let mut d = a + inv_phi * (b - a);
    let mut fc = dist_sq_at(c).0;
    let mut fd = dist_sq_at(d).0;
    for _ in 0..14 {
        if fc < fd {
            b = d;
            d = c;
            fd = fc;
            c = a + inv_phi2 * (b - a);
            fc = dist_sq_at(c).0;
        } else {
            a = c;
            c = d;
            fc = fd;
            d = a + inv_phi * (b - a);
            fd = dist_sq_at(d).0;
        }
    }
    let t_min = 0.5 * (a + b);
    if dist_sq_at(t_min).0 > r2 {
        return None;
    }

    // Bisect `[lo, t_min]` for exact first contact where `dist_sq == r^2`.
    hi = t_min;
    for _ in 0..14 {
        let mid = 0.5 * (lo + hi);
        if dist_sq_at(mid).0 <= r2 {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    let (_, diff) = dist_sq_at(hi);
    let n = normalize3(diff).map(|(u, _)| u).unwrap_or(slab.normal);
    Some((hi, n))
}

// ── 3D Amanatides-Woo DDA Voxel Raycast & Swept-Sphere DDA ──────────────────

/// What a ballistic ray or swept sphere struck.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum HitTarget {
    Voxel {
        cell: [i32; 3],
        kind: Kind,
    },
    Dynamic {
        index: usize,
        id: u32,
        material: u8,
        mass: f32,
    },
}

/// Result of a voxel + dynamic-target raycast or swept-sphere cast.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RayHit {
    pub dist: f32,
    pub pos: [f32; 3],
    pub normal: [f32; 3],
    pub target: HitTarget,
}

/// 3D Amanatides-Woo DDA voxel raycast combined with exact ray-AABB slab intersection
/// against `targets`. Never skips a 1-cell-thick wall at any speed.
pub fn dda_ray(
    origin: [f32; 3],
    dir: [f32; 3],
    max_dist: f32,
    kind_at: impl FnMut([i32; 3]) -> Kind,
    targets: &[DynamicTarget],
) -> Option<RayHit> {
    dda_ray_ex(origin, dir, max_dist, None, None, kind_at, targets)
}

fn dda_ray_ex(
    origin: [f32; 3],
    dir: [f32; 3],
    max_dist: f32,
    skip_cell: Option<[i32; 3]>,
    skip_body: Option<u32>,
    mut kind_at: impl FnMut([i32; 3]) -> Kind,
    targets: &[DynamicTarget],
) -> Option<RayHit> {
    if max_dist <= 0.0 || !max_dist.is_finite() {
        return None;
    }
    let (d, _) = normalize3(dir)?;

    // 1. Exact slab intersection against dynamic targets first to tighten voxel march limit.
    let mut best_dyn: Option<(f32, [f32; 3], usize)> = None;
    let mut limit = max_dist;
    for (idx, t) in targets.iter().enumerate() {
        if skip_body == Some(t.id) {
            continue;
        }
        if let Some(hit) = ray_aabb(origin, d, limit, t.min, t.max)
            && hit.t_enter <= limit
        {
            limit = hit.t_enter;
            best_dyn = Some((hit.t_enter, hit.normal, idx));
        }
    }

    // 2. Amanatides-Woo 3D DDA through the voxel grid up to `limit`.
    let mut cell = [
        origin[0].floor() as i32,
        origin[1].floor() as i32,
        origin[2].floor() as i32,
    ];

    if skip_cell != Some(cell) {
        let k = kind_at(cell);
        if k != 0 {
            return Some(RayHit {
                dist: 0.0,
                pos: origin,
                normal: dominant_axis_normal([-d[0], -d[1], -d[2]]),
                target: HitTarget::Voxel { cell, kind: k },
            });
        }
    }

    let mut step = [0_i32; 3];
    let mut t_max = [f32::INFINITY; 3];
    let mut t_delta = [f32::INFINITY; 3];

    for i in 0..3 {
        if d[i] > 1e-12 {
            step[i] = 1;
            t_delta[i] = 1.0 / d[i];
            t_max[i] = ((cell[i] as f32 + 1.0) - origin[i]).max(0.0) * t_delta[i];
        } else if d[i] < -1e-12 {
            step[i] = -1;
            t_delta[i] = -1.0 / d[i];
            t_max[i] = (origin[i] - cell[i] as f32).max(0.0) * t_delta[i];
        }
    }

    // Guard step count for extreme inputs; `limit * 3 + 8` strictly bounds 3D Manhattan steps.
    let max_steps = ((limit * 3.0) as u32).saturating_add(16);
    for _ in 0..max_steps {
        let axis = if t_max[0] <= t_max[1] && t_max[0] <= t_max[2] {
            0
        } else if t_max[1] <= t_max[2] {
            1
        } else {
            2
        };

        let t = t_max[axis];
        if t > limit {
            break;
        }
        cell[axis] += step[axis];
        t_max[axis] += t_delta[axis];

        if skip_cell == Some(cell) {
            continue;
        }
        let k = kind_at(cell);
        if k != 0 {
            let mut normal = [0.0; 3];
            normal[axis] = -(step[axis] as f32);
            return Some(RayHit {
                dist: t,
                pos: add3(origin, scale3(d, t)),
                normal,
                target: HitTarget::Voxel { cell, kind: k },
            });
        }
    }

    best_dyn.map(|(t, normal, idx)| {
        let tgt = targets[idx];
        RayHit {
            dist: t,
            pos: add3(origin, scale3(d, t)),
            normal,
            target: HitTarget::Dynamic {
                index: idx,
                id: tgt.id,
                material: tgt.material,
                mass: tgt.mass,
            },
        }
    })
}

/// Swept-sphere DDA (`radius` in cells, e.g. `1.5` for shaped-charge rockets) over voxels and
/// dynamic targets. Marches the center cell via Amanatides-Woo DDA and checks only newly entered
/// footprint slices with exact sphere-vs-voxel-box intersection.
pub fn swept_sphere_dda(
    origin: [f32; 3],
    dir: [f32; 3],
    max_dist: f32,
    radius: f32,
    mut kind_at: impl FnMut([i32; 3]) -> Kind,
    targets: &[DynamicTarget],
) -> Option<RayHit> {
    if radius <= 1e-4 {
        return dda_ray(origin, dir, max_dist, kind_at, targets);
    }
    if max_dist <= 0.0 || !max_dist.is_finite() {
        return None;
    }
    let (d, _) = normalize3(dir)?;

    let mut best: Option<RayHit> = None;
    let mut best_t = max_dist;

    // 1. Dynamic targets via exact swept-sphere vs AABB.
    for (idx, tgt) in targets.iter().enumerate() {
        if let Some((t, normal)) = swept_sphere_aabb(origin, d, best_t, radius, tgt.min, tgt.max)
            && t <= best_t
        {
            best_t = t;
            best = Some(RayHit {
                dist: t,
                pos: add3(origin, scale3(d, t)),
                normal,
                target: HitTarget::Dynamic {
                    index: idx,
                    id: tgt.id,
                    material: tgt.material,
                    mass: tgt.mass,
                },
            });
        }
    }

    // 2. Voxel swept-sphere DDA.
    let pad = radius.ceil() as i32;
    let mut cell = [
        origin[0].floor() as i32,
        origin[1].floor() as i32,
        origin[2].floor() as i32,
    ];

    let mut test_cell = |c: [i32; 3], best_t: &mut f32, best: &mut Option<RayHit>| {
        let k = kind_at(c);
        if k == 0 {
            return;
        }
        let bmin = [c[0] as f32, c[1] as f32, c[2] as f32];
        let bmax = [bmin[0] + 1.0, bmin[1] + 1.0, bmin[2] + 1.0];
        if let Some((t, normal)) = swept_sphere_aabb(origin, d, *best_t, radius, bmin, bmax)
            && t <= *best_t
        {
            *best_t = t;
            *best = Some(RayHit {
                dist: t,
                pos: add3(origin, scale3(d, t)),
                normal,
                target: HitTarget::Voxel { cell: c, kind: k },
            });
        }
    };

    // Test starting footprint cube `[-pad..=pad]^3`.
    for dy in -pad..=pad {
        for dz in -pad..=pad {
            for dx in -pad..=pad {
                test_cell(
                    [cell[0] + dx, cell[1] + dy, cell[2] + dz],
                    &mut best_t,
                    &mut best,
                );
            }
        }
    }

    let mut step = [0_i32; 3];
    let mut t_max = [f32::INFINITY; 3];
    let mut t_delta = [f32::INFINITY; 3];
    for i in 0..3 {
        if d[i] > 1e-12 {
            step[i] = 1;
            t_delta[i] = 1.0 / d[i];
            t_max[i] = ((cell[i] as f32 + 1.0) - origin[i]).max(0.0) * t_delta[i];
        } else if d[i] < -1e-12 {
            step[i] = -1;
            t_delta[i] = -1.0 / d[i];
            t_max[i] = (origin[i] - cell[i] as f32).max(0.0) * t_delta[i];
        }
    }

    let max_steps = (((max_dist + radius) * 3.0) as u32).saturating_add(16);
    for _ in 0..max_steps {
        let axis = if t_max[0] <= t_max[1] && t_max[0] <= t_max[2] {
            0
        } else if t_max[1] <= t_max[2] {
            1
        } else {
            2
        };

        let t_center = t_max[axis];
        // Once the center ray is more than `radius` past `best_t`, no newly entered cell can beat `best_t`.
        if t_center - radius > best_t || t_center > max_dist + radius {
            break;
        }
        cell[axis] += step[axis];
        t_max[axis] += t_delta[axis];

        // Only test the single leading face newly entering the `[-pad..=pad]^3` footprint.
        let lead = step[axis] * pad;
        for u in -pad..=pad {
            for v in -pad..=pad {
                let c = match axis {
                    0 => [cell[0] + lead, cell[1] + u, cell[2] + v],
                    1 => [cell[0] + u, cell[1] + lead, cell[2] + v],
                    _ => [cell[0] + u, cell[1] + v, cell[2] + lead],
                };
                test_cell(c, &mut best_t, &mut best);
            }
        }
    }

    best
}

// ── Material ballistics properties derived from `kinds.rs` ──────────────────

/// Stopping energy (in Joules per 10 cm cell) derived from `kinds::gives`, `kinds::weighs`,
/// and `kinds::breaks_at`. Loose `RUBBLE` has half stopping power.
pub fn stopping_energy_per_cell(kind: Kind) -> f32 {
    let mat = kinds::material(kind);
    let gives = kinds::gives(mat).max(1) as f32;
    let hardness = 16.0 / gives;
    let density = kinds::weighs(mat);
    let toughness = 0.5 + 0.5 * (kinds::breaks_at(mat) / 70.0).sqrt();
    let base = 260.0 * hardness * density * toughness;
    if kinds::rubble(kind) {
        base * 0.5
    } else {
        base
    }
}

/// Sine of the maximum grazing angle (angle from surface tangent) at which a bullet can ricochet.
/// Returns `0.0` for soft/brittle materials that do not ricochet.
#[inline]
pub const fn ricochet_sin_max(material: u8) -> f32 {
    match material {
        kinds::STEEL => 0.4695,    // ~28 deg
        kinds::ROCK => 0.3746,     // ~22 deg
        kinds::CONCRETE => 0.3420, // ~20 deg
        kinds::ASPHALT => 0.2588,  // ~15 deg
        kinds::BRICK => 0.2079,    // ~12 deg
        kinds::WATER => 0.1392,    // ~8 deg (skipping)
        _ => 0.0,
    }
}

/// Minimum impact energy (J) to chip a voxel cell when a projectile embeds without penetrating.
#[inline]
pub fn chip_energy_threshold(material: u8) -> f32 {
    kinds::breaks_at(material) * 1.5
}

/// Blast overpressure transmission factor per single solid cell traversed (0..1).
/// Three cells of concrete transmit `0.30^3 = 0.027` (2.7%).
#[inline]
pub const fn blast_cell_transmission(material: u8) -> f32 {
    match material {
        kinds::STEEL => 0.10,
        kinds::ROCK => 0.28,
        kinds::CONCRETE => 0.30,
        kinds::ASPHALT => 0.38,
        kinds::BRICK => 0.42,
        kinds::EARTH | kinds::GRASS | kinds::SAND | kinds::ROOFING => 0.48,
        kinds::PLASTER | kinds::WATER => 0.58,
        kinds::WOOD | kinds::LAMP => 0.65,
        kinds::GLASS => 0.85,
        kinds::LEAVES => 0.95,
        _ => 0.50,
    }
}

/// Shaped-charge (HEAT) jet resistance per cell traversed (normalized so `shaped_charge_depth = 8.0`
/// penetrates ~5 cells of solid steel armor and ~9 cells of concrete).
#[inline]
pub fn jet_cell_cost(kind: Kind) -> f32 {
    let mat = kinds::material(kind);
    let base = match mat {
        kinds::STEEL => 1.5,
        kinds::ROCK => 1.1,
        kinds::CONCRETE => 0.9,
        kinds::ASPHALT | kinds::BRICK => 0.7,
        kinds::EARTH | kinds::GRASS | kinds::SAND | kinds::ROOFING => 0.5,
        kinds::PLASTER | kinds::WOOD | kinds::LAMP | kinds::WATER => 0.45,
        kinds::GLASS => 0.25,
        kinds::LEAVES => 0.15,
        _ => 0.5,
    };
    if kinds::rubble(kind) {
        base * 0.5
    } else {
        base
    }
}

// ── Projectile presets & events ─────────────────────────────────────────────

/// Standard projectile caliber presets.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Caliber {
    Pistol9mm,
    Rifle556,
    Heavy50Cal,
    Shrapnel,
    Rocket,
}

/// Physical parameters of a projectile preset.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProjectileSpec {
    pub caliber: Caliber,
    pub mass_kg: f32,
    pub muzzle_speed: f32,
    pub penetration_factor: f32,
    pub thrust: f32,
    pub fuel_s: f32,
    pub shaped_charge_depth: f32,
    pub drag_coeff: f32,
    pub gravity_scale: f32,
    pub radius: f32,
    pub blast_radius: f32,
    pub blast_pressure: f32,
    pub blast_shrapnel: u32,
    pub max_life_s: f32,
}

impl Caliber {
    /// Returns the physical specification for this caliber preset.
    pub const fn spec(self) -> ProjectileSpec {
        match self {
            Caliber::Pistol9mm => ProjectileSpec {
                caliber: self,
                mass_kg: 0.008,
                muzzle_speed: 3600.0, // 360 m/s
                penetration_factor: 1.0,
                thrust: 0.0,
                fuel_s: 0.0,
                shaped_charge_depth: 0.0,
                drag_coeff: 0.00018,
                gravity_scale: 1.0,
                radius: 0.0,
                blast_radius: 0.0,
                blast_pressure: 0.0,
                blast_shrapnel: 0,
                max_life_s: 4.0,
            },
            Caliber::Rifle556 => ProjectileSpec {
                caliber: self,
                mass_kg: 0.004,
                muzzle_speed: 9000.0, // 900 m/s
                penetration_factor: 1.25,
                thrust: 0.0,
                fuel_s: 0.0,
                shaped_charge_depth: 0.0,
                drag_coeff: 0.00009,
                gravity_scale: 1.0,
                radius: 0.0,
                blast_radius: 0.0,
                blast_pressure: 0.0,
                blast_shrapnel: 0,
                max_life_s: 5.0,
            },
            Caliber::Heavy50Cal => ProjectileSpec {
                caliber: self,
                mass_kg: 0.045,
                muzzle_speed: 8800.0, // 880 m/s
                penetration_factor: 1.6,
                thrust: 0.0,
                fuel_s: 0.0,
                shaped_charge_depth: 0.0,
                drag_coeff: 0.00005,
                gravity_scale: 1.0,
                radius: 0.0,
                blast_radius: 0.0,
                blast_pressure: 0.0,
                blast_shrapnel: 0,
                max_life_s: 7.0,
            },
            Caliber::Shrapnel => ProjectileSpec {
                caliber: self,
                mass_kg: 0.003,
                muzzle_speed: 4500.0, // 450 m/s
                penetration_factor: 0.75,
                thrust: 0.0,
                fuel_s: 0.0,
                shaped_charge_depth: 0.0,
                drag_coeff: 0.00060,
                gravity_scale: 1.0,
                radius: 0.0,
                blast_radius: 0.0,
                blast_pressure: 0.0,
                blast_shrapnel: 0,
                max_life_s: 2.0,
            },
            Caliber::Rocket => ProjectileSpec {
                caliber: self,
                mass_kg: 2.2,
                muzzle_speed: 600.0, // 60 m/s launch, accelerates under thrust
                penetration_factor: 1.0,
                thrust: 1800.0, // 180 m/s^2 sustainer
                fuel_s: 1.5,
                shaped_charge_depth: 8.0, // bores ~5 cells solid steel, ~9 cells concrete
                drag_coeff: 0.00008,
                gravity_scale: 0.25,
                radius: 1.5, // swept-sphere r = 1.5 cells
                blast_radius: 25.0,
                blast_pressure: 400.0,
                blast_shrapnel: 24,
                max_life_s: 8.0,
            },
        }
    }
}

/// Optional proportional-navigation guidance target for rockets.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GuidanceTarget {
    pub pos: [f32; 3],
    pub vel: [f32; 3],
    /// Proportional-navigation constant `N` (typically `3.0..=5.0`).
    pub nav_gain: f32,
    /// Maximum lateral steering acceleration in `cells/s^2`.
    pub max_lateral_accel: f32,
}

/// Events emitted by projectiles, shaped-charge detonations, and occluded shockwaves.
#[derive(Clone, Debug, PartialEq)]
pub enum BallisticEvent {
    VoxelChip {
        cell: [i32; 3],
        kind: Kind,
        velocity: [f32; 3],
    },
    Ricochet {
        pos: [f32; 3],
        dir: [f32; 3],
        material: u8,
        energy: f32,
    },
    BodyHit {
        body_id: u32,
        pos: [f32; 3],
        impulse: [f32; 3],
        energy: f32,
        is_pierce: bool,
    },
    RocketDetonate {
        pos: [f32; 3],
        dir: [f32; 3],
        radius: f32,
        jet_cells: Vec<[i32; 3]>,
    },
    ShockwaveHit {
        target_id: u32,
        impulse: [f32; 3],
        overpressure: f32,
        delay_s: f32,
    },
}

/// Active ballistic projectile or guided shaped-charge rocket.
#[derive(Clone, Debug)]
pub struct Projectile {
    pub id: u32,
    pub spec: ProjectileSpec,
    pub pos: [f32; 3],
    pub vel: [f32; 3],
    pub fuel_left_s: f32,
    pub age_s: f32,
    pub ricochets: u8,
    pub alive: bool,
    pub guidance: Option<GuidanceTarget>,
}

impl Projectile {
    /// Creates a projectile fired from `pos` along `dir` at its preset muzzle speed.
    pub fn new(id: u32, caliber: Caliber, pos: [f32; 3], dir: [f32; 3]) -> Self {
        let spec = caliber.spec();
        let unit = normalize3(dir).map(|(u, _)| u).unwrap_or([1.0, 0.0, 0.0]);
        Self {
            id,
            spec,
            pos,
            vel: scale3(unit, spec.muzzle_speed),
            fuel_left_s: spec.fuel_s,
            age_s: 0.0,
            ricochets: 0,
            alive: true,
            guidance: None,
        }
    }

    /// Creates a projectile with an explicit initial velocity vector (cells/s).
    pub fn with_velocity(id: u32, caliber: Caliber, pos: [f32; 3], vel: [f32; 3]) -> Self {
        let spec = caliber.spec();
        Self {
            id,
            spec,
            pos,
            vel,
            fuel_left_s: spec.fuel_s,
            age_s: 0.0,
            ricochets: 0,
            alive: true,
            guidance: None,
        }
    }

    /// Attaches proportional-navigation guidance to a rocket.
    pub fn with_guidance(mut self, guidance: GuidanceTarget) -> Self {
        self.guidance = Some(guidance);
        self
    }

    #[inline]
    pub fn speed(&self) -> f32 {
        len3(self.vel)
    }

    /// Kinetic energy in Joules (`0.5 * m * v_m^2`).
    #[inline]
    pub fn energy(&self) -> f32 {
        kinetic_energy_j(self.spec.mass_kg, self.speed())
    }
}

// ── Chord exit helper for unit voxel box ────────────────────────────────────

/// Exact exit distance from `pos` along unit `dir` leaving the unit cell `[cell, cell+1]`.
#[inline]
fn voxel_chord_exit(pos: [f32; 3], dir: [f32; 3], cell: [i32; 3]) -> f32 {
    let mut t_exit = f32::INFINITY;
    for i in 0..3 {
        let d = dir[i];
        if d > 1e-12 {
            let t = ((cell[i] as f32 + 1.0) - pos[i]) / d;
            if t < t_exit {
                t_exit = t;
            }
        } else if d < -1e-12 {
            let t = (cell[i] as f32 - pos[i]) / d;
            if t < t_exit {
                t_exit = t;
            }
        }
    }
    if t_exit.is_finite() {
        t_exit.clamp(0.05, 1.7321)
    } else {
        1.0
    }
}

/// Computes ricochet outgoing direction & speed if the impact satisfies grazing criteria.
fn try_ricochet(
    dir: [f32; 3],
    normal: [f32; 3],
    speed: f32,
    mass_kg: f32,
    material: u8,
    ricochets: u8,
) -> Option<([f32; 3], f32, f32)> {
    if ricochets >= MAX_RICOCHETS {
        return None;
    }
    let sin_max = ricochet_sin_max(material);
    if sin_max <= 0.0 {
        return None;
    }
    let energy = kinetic_energy_j(mass_kg, speed);
    if energy < MIN_RICOCHET_ENERGY {
        return None;
    }
    let cos_inc = -dot3(dir, normal);
    if cos_inc <= 1e-6 || cos_inc > sin_max {
        return None;
    }

    // Grazing reflection with material-dependent normal restitution and tangential friction.
    let (e_n, e_t) = match material {
        kinds::STEEL => (0.72_f32, 0.90_f32),
        kinds::ROCK | kinds::CONCRETE => (0.60_f32, 0.82_f32),
        _ => (0.52_f32, 0.78_f32),
    };
    let v_t = add3(dir, scale3(normal, cos_inc));
    let out_raw = add3(scale3(v_t, e_t), scale3(normal, e_n * cos_inc));
    let (out_dir, _) = normalize3(out_raw)?;

    let angle_frac = (cos_inc / sin_max).clamp(0.0, 1.0);
    let speed_retain = (0.86 - 0.36 * angle_frac).clamp(0.42, 0.86);
    let new_speed = speed * speed_retain;
    let new_energy = kinetic_energy_j(mass_kg, new_speed);
    Some((out_dir, new_speed, new_energy))
}

/// Bores a directional armor-piercing shaped-charge jet along `dir` from `pos`,
/// returning all pierced voxel cells and emitting `VoxelChip` / `BodyHit` events.
fn bore_shaped_charge_jet(
    pos: [f32; 3],
    dir: [f32; 3],
    spec: &ProjectileSpec,
    targets: &[DynamicTarget],
    mut kind_at: impl FnMut([i32; 3]) -> Kind,
    events: &mut Vec<BallisticEvent>,
) -> Vec<[i32; 3]> {
    let mut jet_cells = Vec::new();
    let Some((d, _)) = normalize3(dir) else {
        return jet_cells;
    };

    let mut budget = spec.shaped_charge_depth.max(0.0);
    if budget <= 0.0 {
        return jet_cells;
    }

    // March DDA along the jet axis, boring straight through armor plate and backing cells.
    let max_jet_dist = (spec.shaped_charge_depth * 3.0).max(8.0);
    let start_pos = add3(pos, scale3(d, 0.05));
    let mut cell = [
        start_pos[0].floor() as i32,
        start_pos[1].floor() as i32,
        start_pos[2].floor() as i32,
    ];

    let mut step = [0_i32; 3];
    let mut t_max = [f32::INFINITY; 3];
    let mut t_delta = [f32::INFINITY; 3];
    for i in 0..3 {
        if d[i] > 1e-12 {
            step[i] = 1;
            t_delta[i] = 1.0 / d[i];
            t_max[i] = ((cell[i] as f32 + 1.0) - start_pos[i]).max(0.0) * t_delta[i];
        } else if d[i] < -1e-12 {
            step[i] = -1;
            t_delta[i] = -1.0 / d[i];
            t_max[i] = (start_pos[i] - cell[i] as f32).max(0.0) * t_delta[i];
        }
    }

    let mut traveled = 0.0_f32;
    let max_steps = ((max_jet_dist * 3.0) as u32).saturating_add(12);
    let mut hit_solid = false;

    for _ in 0..max_steps {
        let k = kind_at(cell);
        if k != 0 {
            let cost = jet_cell_cost(k);
            if budget >= cost || !hit_solid {
                hit_solid = true;
                budget = (budget - cost).max(0.0);
                jet_cells.push(cell);
                events.push(BallisticEvent::VoxelChip {
                    cell,
                    kind: k,
                    velocity: scale3(d, 6000.0 * (0.25 + 0.75 * (budget / spec.shaped_charge_depth))),
                });
                if budget <= 1e-3 {
                    break;
                }
            } else {
                break;
            }
        } else if hit_solid {
            // Jet loses coherence slowly across air gaps behind spaced armor.
            budget -= 0.15;
            if budget <= 0.0 {
                break;
            }
        }

        let axis = if t_max[0] <= t_max[1] && t_max[0] <= t_max[2] {
            0
        } else if t_max[1] <= t_max[2] {
            1
        } else {
            2
        };
        let next_t = t_max[axis];
        if next_t > max_jet_dist {
            break;
        }
        traveled = next_t;
        cell[axis] += step[axis];
        t_max[axis] += t_delta[axis];
    }

    // Apply jet damage/impulse to any dynamic target intersecting the jet corridor.
    let jet_reach = traveled.max(1.0);
    let jet_energy_base = 45_000.0_f32;
    for tgt in targets {
        if let Some(hit) = ray_aabb(start_pos, d, jet_reach, tgt.min, tgt.max) {
            let atten = (1.0 - hit.t_enter / max_jet_dist).clamp(0.15, 1.0);
            let energy = jet_energy_base * atten;
            let impulse_mag = 650.0 * atten;
            events.push(BallisticEvent::BodyHit {
                body_id: tgt.id,
                pos: add3(start_pos, scale3(d, hit.t_enter)),
                impulse: scale3(d, impulse_mag),
                energy,
                is_pierce: true,
            });
        }
    }

    jet_cells
}

/// Steps one projectile forward by `dt` seconds with sub-stepped CCD, penetration, ricochet,
/// thrust/guidance, and shaped-charge detonation. Returns `Some((pos, spec))` if a rocket detonated
/// so a simulation manager can spawn the accompanying occluded shockwave.
pub fn step_projectile(
    proj: &mut Projectile,
    dt: f32,
    targets: &[DynamicTarget],
    kind_at: &mut impl FnMut([i32; 3]) -> Kind,
    events: &mut Vec<BallisticEvent>,
) -> Option<([f32; 3], ProjectileSpec)> {
    if !proj.alive || dt <= 0.0 {
        return None;
    }

    let is_rocket = proj.spec.caliber == Caliber::Rocket;
    let target_sub_dt = if is_rocket { 0.008334 } else { 0.016667 };
    let substeps = ((dt / target_sub_dt).ceil() as u32).clamp(if is_rocket { 2 } else { 1 }, 16);
    let sub_dt = dt / substeps as f32;

    for _ in 0..substeps {
        if !proj.alive {
            break;
        }
        proj.age_s += sub_dt;
        if proj.age_s >= proj.spec.max_life_s {
            proj.alive = false;
            break;
        }

        // 1. Update kinematics: thrust, proportional-navigation guidance, gravity, quadratic drag.
        if proj.fuel_left_s > 0.0 && proj.spec.thrust > 0.0 {
            let burn_dt = sub_dt.min(proj.fuel_left_s);
            if let Some((u_v, _)) = normalize3(proj.vel) {
                proj.vel = add3(proj.vel, scale3(u_v, proj.spec.thrust * burn_dt));
            }
            proj.fuel_left_s -= burn_dt;
        }

        if let Some(g) = proj.guidance {
            let r = sub3(g.pos, proj.pos);
            let r_sq = len_sq3(r);
            if r_sq > 1e-4 {
                let v_rel = sub3(g.vel, proj.vel);
                let omega = scale3(cross3(r, v_rel), 1.0 / r_sq);
                let mut a_pn = scale3(cross3(omega, proj.vel), g.nav_gain);
                // Keep steering strictly lateral to current velocity.
                if let Some((u_v, _)) = normalize3(proj.vel) {
                    let along = dot3(a_pn, u_v);
                    a_pn = sub3(a_pn, scale3(u_v, along));
                }
                let a_mag = len3(a_pn);
                if a_mag > g.max_lateral_accel && a_mag > 1e-12 {
                    a_pn = scale3(a_pn, g.max_lateral_accel / a_mag);
                }
                proj.vel = add3(proj.vel, scale3(a_pn, sub_dt));
            }
        }

        proj.vel[1] -= GRAVITY_CELLS * proj.spec.gravity_scale * sub_dt;

        let speed_now = len3(proj.vel);
        if speed_now > 1e-6 && proj.spec.drag_coeff > 0.0 {
            let drag_factor = (1.0 - proj.spec.drag_coeff * speed_now * sub_dt).clamp(0.05, 1.0);
            proj.vel = scale3(proj.vel, drag_factor);
        }

        let Some((mut dir, mut speed)) = normalize3(proj.vel) else {
            proj.alive = false;
            break;
        };

        // 2. Sub-step sweep with penetration / ricochet / detonation loop.
        let mut rem_dist = speed * sub_dt;
        let mut skip_cell: Option<[i32; 3]> = None;
        let mut skip_body: Option<u32> = None;

        for _ in 0..MAX_HITS_PER_SUBSTEP {
            if rem_dist <= 1e-4 || !proj.alive {
                break;
            }

            let hit = if proj.spec.radius > 1e-4 {
                swept_sphere_dda(proj.pos, dir, rem_dist, proj.spec.radius, &mut *kind_at, targets)
            } else {
                dda_ray_ex(
                    proj.pos,
                    dir,
                    rem_dist,
                    skip_cell,
                    skip_body,
                    &mut *kind_at,
                    targets,
                )
            };

            let Some(hit) = hit else {
                proj.pos = add3(proj.pos, scale3(dir, rem_dist));
                break;
            };

            // Shaped-charge rocket detonation on first contact.
            if is_rocket {
                proj.pos = hit.pos;
                proj.alive = false;
                let jet_cells = bore_shaped_charge_jet(
                    hit.pos,
                    dir,
                    &proj.spec,
                    targets,
                    &mut *kind_at,
                    events,
                );
                events.push(BallisticEvent::RocketDetonate {
                    pos: hit.pos,
                    dir,
                    radius: proj.spec.blast_radius,
                    jet_cells,
                });
                return Some((hit.pos, proj.spec));
            }

            match hit.target {
                HitTarget::Voxel { cell, kind } => {
                    let mat = kinds::material(kind);
                    let old_energy = kinetic_energy_j(proj.spec.mass_kg, speed);

                    // Grazing ricochet check.
                    if let Some((out_dir, new_speed, new_energy)) = try_ricochet(
                        dir,
                        hit.normal,
                        speed,
                        proj.spec.mass_kg,
                        mat,
                        proj.ricochets,
                    ) {
                        proj.ricochets += 1;
                        let ratio = new_speed / speed.max(1e-6);
                        rem_dist = (rem_dist - hit.dist).max(0.0) * ratio;
                        proj.pos = add3(hit.pos, scale3(hit.normal, 0.002));
                        proj.vel = scale3(out_dir, new_speed);
                        dir = out_dir;
                        speed = new_speed;
                        skip_cell = Some(cell);
                        skip_body = None;
                        events.push(BallisticEvent::Ricochet {
                            pos: hit.pos,
                            dir: out_dir,
                            material: mat,
                            energy: new_energy,
                        });
                        continue;
                    }

                    // Penetration vs embed calculation.
                    let path_len = voxel_chord_exit(hit.pos, dir, cell);
                    let stop_cost = stopping_energy_per_cell(kind) * path_len;
                    let eff_energy = old_energy * proj.spec.penetration_factor;

                    if eff_energy > stop_cost {
                        let energy_lost = stop_cost / proj.spec.penetration_factor;
                        let new_energy = (old_energy - energy_lost).max(0.0);
                        let new_speed = speed_from_energy_j(new_energy, proj.spec.mass_kg);
                        events.push(BallisticEvent::VoxelChip {
                            cell,
                            kind,
                            velocity: scale3(dir, speed * 0.25),
                        });
                        if new_energy < MIN_ALIVE_ENERGY || new_speed < 50.0 {
                            proj.pos = add3(hit.pos, scale3(dir, path_len));
                            proj.vel = [0.0; 3];
                            proj.alive = false;
                            break;
                        }
                        let ratio = new_speed / speed.max(1e-6);
                        rem_dist = (rem_dist - hit.dist - path_len).max(0.0) * ratio;
                        proj.pos = add3(hit.pos, scale3(dir, path_len + 1e-4));
                        proj.vel = scale3(dir, new_speed);
                        speed = new_speed;
                        skip_cell = Some(cell);
                        skip_body = None;
                        continue;
                    } else {
                        if old_energy >= chip_energy_threshold(mat) {
                            events.push(BallisticEvent::VoxelChip {
                                cell,
                                kind,
                                velocity: scale3(hit.normal, speed * 0.12),
                            });
                        }
                        proj.pos = hit.pos;
                        proj.vel = [0.0; 3];
                        proj.alive = false;
                        break;
                    }
                }
                HitTarget::Dynamic {
                    index,
                    id,
                    material,
                    mass: _,
                } => {
                    let old_vel = scale3(dir, speed);
                    let old_energy = kinetic_energy_j(proj.spec.mass_kg, speed);

                    // Grazing ricochet off hard dynamic targets (e.g. steel vehicle hull).
                    if let Some((out_dir, new_speed, new_energy)) = try_ricochet(
                        dir,
                        hit.normal,
                        speed,
                        proj.spec.mass_kg,
                        material,
                        proj.ricochets,
                    ) {
                        proj.ricochets += 1;
                        let new_vel = scale3(out_dir, new_speed);
                        let impulse = scale3(sub3(old_vel, new_vel), proj.spec.mass_kg);
                        events.push(BallisticEvent::Ricochet {
                            pos: hit.pos,
                            dir: out_dir,
                            material,
                            energy: new_energy,
                        });
                        events.push(BallisticEvent::BodyHit {
                            body_id: id,
                            pos: hit.pos,
                            impulse,
                            energy: (old_energy - new_energy).max(0.0),
                            is_pierce: false,
                        });
                        let ratio = new_speed / speed.max(1e-6);
                        rem_dist = (rem_dist - hit.dist).max(0.0) * ratio;
                        proj.pos = add3(hit.pos, scale3(hit.normal, 0.002));
                        proj.vel = new_vel;
                        dir = out_dir;
                        speed = new_speed;
                        skip_cell = None;
                        skip_body = Some(id);
                        continue;
                    }

                    let tgt = targets[index];
                    let thickness = ray_aabb(proj.pos, dir, 1e6, tgt.min, tgt.max)
                        .map(|h| (h.t_exit - h.t_enter).clamp(0.25, 20.0))
                        .unwrap_or(1.0);
                    let stop_cost = stopping_energy_per_cell(kinds::kind(material, kinds::OWN)) * thickness;
                    let eff_energy = old_energy * proj.spec.penetration_factor;

                    if eff_energy > stop_cost {
                        let energy_lost = stop_cost / proj.spec.penetration_factor;
                        let new_energy = (old_energy - energy_lost).max(0.0);
                        let new_speed = speed_from_energy_j(new_energy, proj.spec.mass_kg);
                        let new_vel = scale3(dir, new_speed);
                        let impulse = scale3(sub3(old_vel, new_vel), proj.spec.mass_kg);
                        events.push(BallisticEvent::BodyHit {
                            body_id: id,
                            pos: hit.pos,
                            impulse,
                            energy: energy_lost,
                            is_pierce: true,
                        });
                        if new_energy < MIN_ALIVE_ENERGY || new_speed < 50.0 {
                            proj.pos = add3(hit.pos, scale3(dir, thickness));
                            proj.vel = [0.0; 3];
                            proj.alive = false;
                            break;
                        }
                        let ratio = new_speed / speed.max(1e-6);
                        rem_dist = (rem_dist - hit.dist - thickness).max(0.0) * ratio;
                        proj.pos = add3(hit.pos, scale3(dir, thickness + 0.01));
                        proj.vel = new_vel;
                        speed = new_speed;
                        skip_cell = None;
                        skip_body = Some(id);
                        continue;
                    } else {
                        let impulse = scale3(old_vel, proj.spec.mass_kg);
                        events.push(BallisticEvent::BodyHit {
                            body_id: id,
                            pos: hit.pos,
                            impulse,
                            energy: old_energy,
                            is_pierce: false,
                        });
                        proj.pos = hit.pos;
                        proj.vel = [0.0; 3];
                        proj.alive = false;
                        break;
                    }
                }
            }
        }
    }

    None
}

// ── 64-direction Fibonacci sphere & Occluded Shockwave Queue ────────────────

/// Returns the cached 64-direction golden-angle Fibonacci sphere unit vectors.
pub fn fibonacci_sphere_64() -> &'static [[f32; 3]; OCCLUSION_RAYS] {
    static DIRS: OnceLock<[[f32; 3]; OCCLUSION_RAYS]> = OnceLock::new();
    DIRS.get_or_init(|| {
        let mut dirs = [[0.0_f32; 3]; OCCLUSION_RAYS];
        // Golden angle in radians: pi * (3 - sqrt(5)).
        let golden_angle: f32 = 2.399_963_2;
        let inv_n = 1.0 / OCCLUSION_RAYS as f32;
        for (i, slot) in dirs.iter_mut().enumerate() {
            let y = 1.0 - 2.0 * (i as f32 + 0.5) * inv_n;
            let r = (1.0 - y * y).max(0.0).sqrt();
            let theta = golden_angle * i as f32;
            *slot = [r * theta.cos(), y, r * theta.sin()];
        }
        dirs
    })
}

/// One ray's occlusion summary in a blast's 64-direction field.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OcclusionSample {
    /// Distance in cells to the first solid blocking wall (`f32::INFINITY` if clear up to `3 * radius`).
    pub wall_dist: f32,
    /// Cumulative pressure transmission factor behind the wall (`0.01..=1.0`).
    pub transmission: f32,
}

#[derive(Clone, Copy, Debug)]
struct DelayedGlassShatter {
    dist: f32,
    cell: [i32; 3],
    kind: Kind,
    dir: [f32; 3],
    transmission: f32,
}

/// One active expanding shockwave with its precomputed 64-ray occlusion field.
#[derive(Clone, Debug)]
pub struct ActiveShockwave {
    pub center: [f32; 3],
    pub radius: f32,
    pub peak_pressure: f32,
    pub r_front: f32,
    pub max_radius: f32,
    pub elapsed_s: f32,
    pub occlusion: [OcclusionSample; OCCLUSION_RAYS],
    glass_shatters: Vec<DelayedGlassShatter>,
    hit_targets: Vec<u32>,
}

impl ActiveShockwave {
    /// Queries the 64-ray occlusion field for the pressure transmission factor along unit `dir`
    /// at distance `dist` from the blast center.
    pub fn sample_transmission(&self, dir: [f32; 3], dist: f32) -> f32 {
        let dirs = fibonacci_sphere_64();
        let mut best_idx = 0usize;
        let mut best_dot = -2.0_f32;
        for (i, &ray) in dirs.iter().enumerate() {
            let d = dot3(dir, ray);
            if d > best_dot {
                best_dot = d;
                best_idx = i;
            }
        }
        let sample = self.occlusion[best_idx];
        if dist < sample.wall_dist {
            1.0
        } else {
            sample.transmission
        }
    }

    /// Unobstructed peak overpressure (kPa) at distance `dist` from the blast center.
    #[inline]
    pub fn free_overpressure(&self, dist: f32) -> f32 {
        let r_ref = self.radius.max(1.0);
        let ratio = dist / r_ref;
        self.peak_pressure / (1.0 + ratio * ratio)
    }
}

#[derive(Clone, Copy, Debug)]
struct ShrapnelRay {
    pos: [f32; 3],
    dir: [f32; 3],
    speed: f32,
    mass_kg: f32,
    drag_coeff: f32,
    traveled: f32,
    max_dist: f32,
    world_hit_dist: f32,
    world_hit_cell: [i32; 3],
    world_hit_kind: Kind,
    world_hit_normal: [f32; 3],
    alive: bool,
}

/// Manages active occluded blast shockwaves and their directional shrapnel rays.
#[derive(Clone, Debug, Default)]
pub struct ShockwaveQueue {
    waves: Vec<ActiveShockwave>,
    shrapnel: Vec<ShrapnelRay>,
}

impl ShockwaveQueue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn active_waves(&self) -> usize {
        self.waves.len()
    }

    pub fn active_shrapnel(&self) -> usize {
        self.shrapnel.len()
    }

    /// Spawns an occluded blast pressure wave and `shrapnel_count` directional shrapnel rays.
    /// Casts 64 Fibonacci-sphere DDA rays up to `3 * radius` to record blocking wall distance,
    /// cumulative material attenuation, and distant glass cells that will shatter when the sonic
    /// wave front reaches them.
    pub fn spawn_blast(
        &mut self,
        center: [f32; 3],
        radius: f32,
        peak_pressure: f32,
        shrapnel_count: u32,
        mut kind_at: impl FnMut([i32; 3]) -> Kind,
    ) {
        let r_safe = radius.max(1.0);
        let occ_max_dist = 3.0 * r_safe;
        let dirs = fibonacci_sphere_64();
        let mut occlusion = [OcclusionSample {
            wall_dist: f32::INFINITY,
            transmission: 1.0,
        }; OCCLUSION_RAYS];
        let mut glass_shatters = Vec::new();

        // 1. Trace 64 Fibonacci-sphere occlusion rays up to `3 * radius`.
        for (i, &dir) in dirs.iter().enumerate() {
            let (wall_dist, transmission) = trace_occlusion_ray(
                center,
                dir,
                occ_max_dist,
                &mut kind_at,
                &mut glass_shatters,
            );
            occlusion[i] = OcclusionSample {
                wall_dist,
                transmission,
            };
        }

        // Propagate until overpressure drops below ~0.05 kPa (at least 3*radius and 400 cells for sonic delay).
        let pressure_reach = r_safe * (peak_pressure.max(1.0) / 0.05).sqrt().clamp(3.0, 20.0);
        let max_radius = pressure_reach.max(occ_max_dist).max(400.0);

        self.waves.push(ActiveShockwave {
            center,
            radius: r_safe,
            peak_pressure: peak_pressure.max(0.0),
            r_front: 0.0,
            max_radius,
            elapsed_s: 0.0,
            occlusion,
            glass_shatters,
            hit_targets: Vec::new(),
        });

        // 2. Spawn `shrapnel_count` directional shrapnel rays (typically 16..=48).
        if shrapnel_count > 0 {
            let shrap_spec = Caliber::Shrapnel.spec();
            let shrap_max = (r_safe * 6.0).max(180.0);
            let golden_angle: f32 = 2.399_963_2;
            let seed = hash3(
                center[0].floor() as i32,
                center[1].floor() as i32,
                center[2].floor() as i32,
                0x5348_5250,
            );

            for idx in 0..shrapnel_count {
                let n = shrapnel_count as f32;
                let y = 1.0 - 2.0 * (idx as f32 + 0.5) / n;
                let ring = (1.0 - y * y).max(0.0).sqrt();
                let h = hash3(idx as i32, seed as i32, 17, 0x9e37_79b9);
                let jitter = ((h & 0xffff) as f32 / 65536.0 - 0.5) * 0.25;
                let theta = golden_angle * idx as f32 + jitter;
                let dir = [ring * theta.cos(), y, ring * theta.sin()];
                let speed_var = 0.85 + (((h >> 16) & 0xff) as f32 / 255.0) * 0.30;

                // Pre-trace static voxel blocking distance for zero-closure stepping in `step(dt, targets)`.
                let static_hit = dda_ray(center, dir, shrap_max, &mut kind_at, &[]);
                let (world_hit_dist, world_hit_cell, world_hit_kind, world_hit_normal) =
                    match static_hit {
                        Some(RayHit {
                            dist,
                            normal,
                            target: HitTarget::Voxel { cell, kind },
                            ..
                        }) => (dist, cell, kind, normal),
                        _ => (f32::INFINITY, [0; 3], 0, [0.0; 3]),
                    };

                self.shrapnel.push(ShrapnelRay {
                    pos: center,
                    dir,
                    speed: shrap_spec.muzzle_speed * speed_var,
                    mass_kg: shrap_spec.mass_kg,
                    drag_coeff: shrap_spec.drag_coeff,
                    traveled: 0.0,
                    max_dist: shrap_max,
                    world_hit_dist,
                    world_hit_cell,
                    world_hit_kind,
                    world_hit_normal,
                    alive: true,
                });
            }
        }
    }

    /// Advances all expanding shockwave fronts at `3400 cells/s` (`~340 m/s`), delivers occluded
    /// overpressure impulses and delayed glass shatters as waves cross targets/glass, and steps
    /// active shrapnel rays.
    pub fn step(
        &mut self,
        dt: f32,
        targets: &[DynamicTarget],
        events: &mut Vec<BallisticEvent>,
    ) {
        if dt <= 0.0 {
            return;
        }

        // 1. Advance expanding shockwave rings.
        for wave in &mut self.waves {
            let r_prev = wave.r_front;
            let r_next = r_prev + SPEED_OF_SOUND_CELLS * dt;
            wave.r_front = r_next;
            wave.elapsed_s += dt;

            // Delayed glass shatter when sonic front crosses recorded glass cells.
            for g in &wave.glass_shatters {
                if g.dist > r_prev && g.dist <= r_next {
                    let p = wave.free_overpressure(g.dist) * g.transmission;
                    if p >= 1.5 {
                        let blow_speed = (p * 4.0).clamp(40.0, 900.0);
                        events.push(BallisticEvent::VoxelChip {
                            cell: g.cell,
                            kind: g.kind,
                            velocity: scale3(g.dir, blow_speed),
                        });
                    }
                }
            }

            // Deliver occluded overpressure impulse as the wave crosses each target.
            let tau_s = (wave.radius / SPEED_OF_SOUND_CELLS).clamp(0.015, 0.25);
            for tgt in targets {
                if wave.hit_targets.contains(&tgt.id) {
                    continue;
                }
                let tc = tgt.center();
                let delta = sub3(tc, wave.center);
                let dist = len3(delta);

                // Strictly fire when the expanding wave reaches `dist` (delay_s > 0 for dist > 0).
                let crossed = if dist <= 1e-4 {
                    r_prev == 0.0 && r_next > 0.0
                } else {
                    dist > r_prev && dist <= r_next && dist <= wave.max_radius
                };
                if !crossed {
                    continue;
                }

                wave.hit_targets.push(tgt.id);
                let dir = if dist > 1e-4 {
                    scale3(delta, 1.0 / dist)
                } else {
                    [0.0, 1.0, 0.0]
                };

                let transmission = wave.sample_transmission(dir, dist);
                let overpressure = wave.free_overpressure(dist) * transmission;
                let area_m2 = tgt.projected_area_m2(dir);
                // Specific impulse (Pa*s) = 0.5 * (overpressure_kPa * 1000) * tau_s;
                // convert kg*m/s -> kg*cells/s via `* CELLS_PER_METER`.
                let impulse_mag = 0.5 * (overpressure * 1000.0) * tau_s * area_m2 * CELLS_PER_METER;
                let delay_s = dist / SPEED_OF_SOUND_CELLS;

                events.push(BallisticEvent::ShockwaveHit {
                    target_id: tgt.id,
                    impulse: scale3(dir, impulse_mag),
                    overpressure,
                    delay_s,
                });
            }
        }
        self.waves.retain(|w| w.r_front < w.max_radius);

        // 2. Step active shrapnel rays.
        for s in &mut self.shrapnel {
            if !s.alive {
                continue;
            }
            let seg_len = s.speed * dt;
            if seg_len <= 1e-4 {
                s.alive = false;
                continue;
            }

            let dist_to_wall = (s.world_hit_dist - s.traveled).max(0.0);
            let march_len = seg_len.min(dist_to_wall).min((s.max_dist - s.traveled).max(0.0));

            // Check dynamic targets along `[s.pos, s.pos + s.dir * march_len]`.
            let mut hit_dyn: Option<(f32, usize)> = None;
            let mut best_t = march_len;
            for (idx, tgt) in targets.iter().enumerate() {
                if let Some(h) = ray_aabb(s.pos, s.dir, best_t, tgt.min, tgt.max)
                    && h.t_enter <= best_t
                {
                    best_t = h.t_enter;
                    hit_dyn = Some((h.t_enter, idx));
                }
            }

            if let Some((t, idx)) = hit_dyn {
                let tgt = targets[idx];
                let hit_pos = add3(s.pos, scale3(s.dir, t));
                let vel = scale3(s.dir, s.speed);
                let energy = kinetic_energy_j(s.mass_kg, s.speed);
                let impulse = scale3(vel, s.mass_kg);
                events.push(BallisticEvent::BodyHit {
                    body_id: tgt.id,
                    pos: hit_pos,
                    impulse,
                    energy,
                    is_pierce: false,
                });
                s.alive = false;
                continue;
            }

            // Reached pre-traced static voxel wall?
            if seg_len >= dist_to_wall && s.world_hit_dist.is_finite() {
                let mat = kinds::material(s.world_hit_kind);
                let energy = kinetic_energy_j(s.mass_kg, s.speed);
                if energy >= chip_energy_threshold(mat) {
                    events.push(BallisticEvent::VoxelChip {
                        cell: s.world_hit_cell,
                        kind: s.world_hit_kind,
                        velocity: scale3(s.world_hit_normal, s.speed * 0.12),
                    });
                }
                s.alive = false;
                continue;
            }

            // Continue flying with aerodynamic drag.
            s.pos = add3(s.pos, scale3(s.dir, march_len));
            s.traveled += march_len;
            s.speed *= 1.0 / (1.0 + s.drag_coeff * march_len);
            if s.traveled >= s.max_dist || s.speed < 200.0 {
                s.alive = false;
            }
        }
        self.shrapnel.retain(|s| s.alive);
    }

    /// Convenience wrapper returning events produced during this step.
    pub fn step_collect(&mut self, dt: f32, targets: &[DynamicTarget]) -> Vec<BallisticEvent> {
        let mut events = Vec::new();
        self.step(dt, targets, &mut events);
        events
    }
}

/// Traces one occlusion ray up to `max_dist` using 3D DDA, accumulating multiplicative material
/// transmission and recording any glass cells encountered for delayed sonic shatter.
fn trace_occlusion_ray(
    origin: [f32; 3],
    dir: [f32; 3],
    max_dist: f32,
    kind_at: &mut impl FnMut([i32; 3]) -> Kind,
    glass_shatters: &mut Vec<DelayedGlassShatter>,
) -> (f32, f32) {
    let mut cell = [
        origin[0].floor() as i32,
        origin[1].floor() as i32,
        origin[2].floor() as i32,
    ];
    let mut step = [0_i32; 3];
    let mut t_max = [f32::INFINITY; 3];
    let mut t_delta = [f32::INFINITY; 3];

    for i in 0..3 {
        if dir[i] > 1e-12 {
            step[i] = 1;
            t_delta[i] = 1.0 / dir[i];
            t_max[i] = ((cell[i] as f32 + 1.0) - origin[i]).max(0.0) * t_delta[i];
        } else if dir[i] < -1e-12 {
            step[i] = -1;
            t_delta[i] = -1.0 / dir[i];
            t_max[i] = (origin[i] - cell[i] as f32).max(0.0) * t_delta[i];
        }
    }

    let mut wall_dist = f32::INFINITY;
    let mut transmission = 1.0_f32;
    let max_steps = ((max_dist * 3.0) as u32).saturating_add(16);

    for _ in 0..max_steps {
        let axis = if t_max[0] <= t_max[1] && t_max[0] <= t_max[2] {
            0
        } else if t_max[1] <= t_max[2] {
            1
        } else {
            2
        };
        let t = t_max[axis];
        if t > max_dist {
            break;
        }
        cell[axis] += step[axis];
        t_max[axis] += t_delta[axis];

        let k = kind_at(cell);
        if k == 0 {
            continue;
        }
        let mat = kinds::material(k);
        if mat == kinds::GLASS {
            glass_shatters.push(DelayedGlassShatter {
                dist: t,
                cell,
                kind: k,
                dir,
                transmission,
            });
        }
        if !wall_dist.is_finite() && mat != kinds::LEAVES && mat != kinds::GLASS {
            wall_dist = t;
        }
        let cell_t = if kinds::rubble(k) {
            (blast_cell_transmission(mat) + 0.25).min(0.95)
        } else {
            blast_cell_transmission(mat)
        };
        transmission *= cell_t;
        if transmission <= 0.01 {
            transmission = 0.01;
            break;
        }
    }

    (wall_dist, transmission.clamp(0.01, 1.0))
}

// ── Combined Ballistic & Shockwave Simulation Container ─────────────────────

/// Combined simulation container holding active projectiles, occluded shockwaves, and emitted events.
#[derive(Clone, Debug, Default)]
pub struct BallisticSim {
    next_id: u32,
    pub projectiles: Vec<Projectile>,
    pub shockwaves: ShockwaveQueue,
    pub events: Vec<BallisticEvent>,
}

impl BallisticSim {
    pub fn new() -> Self {
        Self {
            next_id: 1,
            projectiles: Vec::new(),
            shockwaves: ShockwaveQueue::new(),
            events: Vec::new(),
        }
    }

    pub fn spawn_projectile(&mut self, caliber: Caliber, pos: [f32; 3], dir: [f32; 3]) -> u32 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        self.projectiles.push(Projectile::new(id, caliber, pos, dir));
        id
    }

    pub fn spawn_projectile_with_vel(
        &mut self,
        caliber: Caliber,
        pos: [f32; 3],
        vel: [f32; 3],
    ) -> u32 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        self.projectiles
            .push(Projectile::with_velocity(id, caliber, pos, vel));
        id
    }

    pub fn spawn_guided_rocket(
        &mut self,
        pos: [f32; 3],
        dir: [f32; 3],
        guidance: GuidanceTarget,
    ) -> u32 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        self.projectiles
            .push(Projectile::new(id, Caliber::Rocket, pos, dir).with_guidance(guidance));
        id
    }

    pub fn spawn_blast(
        &mut self,
        center: [f32; 3],
        radius: f32,
        peak_pressure: f32,
        shrapnel_count: u32,
        kind_at: impl FnMut([i32; 3]) -> Kind,
    ) {
        self.shockwaves
            .spawn_blast(center, radius, peak_pressure, shrapnel_count, kind_at);
    }

    /// Steps all projectiles and shockwaves forward by `dt`, accumulating events into `self.events`.
    pub fn step(
        &mut self,
        dt: f32,
        targets: &[DynamicTarget],
        mut kind_at: impl FnMut([i32; 3]) -> Kind,
    ) {
        let mut detonations = Vec::new();
        for proj in &mut self.projectiles {
            if let Some(det) = step_projectile(proj, dt, targets, &mut kind_at, &mut self.events) {
                detonations.push(det);
            }
        }
        self.projectiles.retain(|p| p.alive);

        for (pos, spec) in detonations {
            self.shockwaves.spawn_blast(
                pos,
                spec.blast_radius,
                spec.blast_pressure,
                spec.blast_shrapnel,
                &mut kind_at,
            );
        }

        self.shockwaves.step(dt, targets, &mut self.events);
    }

    pub fn drain_events(&mut self) -> std::vec::Drain<'_, BallisticEvent> {
        self.events.drain(..)
    }
}

// ── Unit & Stress Tests ─────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn zero_tunneling_900ms_rifle_never_skips_1_cell_wall() {
        // 1-cell-thick solid concrete wall at x == 40; 900 m/s (9000 cells/s) bullet travels
        // 150 cells in a single 1/60 s frame and must never tunnel past x == 40.
        let wall_kind = kinds::kind(kinds::CONCRETE, kinds::OWN);
        let wall = |c: [i32; 3]| -> Kind {
            if c[0] == 40 { wall_kind } else { 0 }
        };

        // Test straight and oblique trajectories, plus multiple wall thicknesses/positions.
        for angle_deg in [0.0_f32, 15.0, 35.0, -25.0] {
            let rad = angle_deg.to_radians();
            let dir = [rad.cos(), rad.sin() * 0.2, rad.sin()];
            let mut sim = BallisticSim::new();
            sim.spawn_projectile(Caliber::Rifle556, [0.5, 10.5, 0.5], dir);

            // Step 1 frame (dt = 1/60 -> 150 cells travel, well past x=40).
            sim.step(1.0 / 60.0, &[], wall);

            let hit_wall = sim.events.iter().any(|e| match e {
                BallisticEvent::VoxelChip { cell, .. } => cell[0] == 40,
                BallisticEvent::Ricochet { pos, .. } => (pos[0] - 40.0).abs() < 0.25,
                _ => false,
            });
            assert!(
                hit_wall,
                "900 m/s rifle bullet tunneled past 1-cell wall at angle {angle_deg} deg! events={:?}",
                sim.events
            );
        }

        // Direct DDA check at extreme speed (500 cells in one call) against a 1-cell steel wall.
        let steel = kinds::kind(kinds::STEEL, kinds::OWN);
        let hit = dda_ray(
            [0.2, 5.5, 5.5],
            [1.0, 0.0, 0.0],
            500.0,
            |c| if c[0] == 217 { steel } else { 0 },
            &[],
        );
        let hit = hit.expect("DDA must detect 1-cell wall at x=217");
        assert_eq!(hit.target, HitTarget::Voxel { cell: [217, 5, 5], kind: steel });
        assert!((hit.dist - 216.8).abs() < 1e-3);
        assert_eq!(hit.normal, [-1.0, 0.0, 0.0]);
    }

    #[test]
    fn material_penetration_wood_glass_vs_steel() {
        let wood = kinds::kind(kinds::WOOD, kinds::OWN);
        let glass = kinds::kind(kinds::GLASS, kinds::OWN);
        let steel = kinds::kind(kinds::STEEL, kinds::OWN);

        // Scenario A: 2 cells of wood (x=10,11) + 1 cell of glass (x=12).
        let mut sim_a = BallisticSim::new();
        sim_a.spawn_projectile(Caliber::Rifle556, [0.5, 5.5, 5.5], [1.0, 0.0, 0.0]);
        let initial_energy = sim_a.projectiles[0].energy();

        let world_a = |c: [i32; 3]| -> Kind {
            match c[0] {
                10 | 11 => wood,
                12 => glass,
                _ => 0,
            }
        };
        sim_a.step(1.0 / 60.0, &[], world_a);

        assert_eq!(
            sim_a.projectiles.len(),
            1,
            "5.56 rifle must keep going after 2 wood + 1 glass"
        );
        let p = &sim_a.projectiles[0];
        assert!(p.pos[0] > 13.0, "bullet must exit past x=12, pos={:?}", p.pos);
        let remaining_energy = p.energy();
        assert!(
            remaining_energy > 0.0 && remaining_energy < initial_energy,
            "energy must decrease on penetration: initial={initial_energy}, remaining={remaining_energy}"
        );
        let chipped: Vec<[i32; 3]> = sim_a
            .events
            .iter()
            .filter_map(|e| match e {
                BallisticEvent::VoxelChip { cell, .. } => Some(*cell),
                _ => None,
            })
            .collect();
        assert!(chipped.contains(&[10, 5, 5]), "must chip wood cell 10");
        assert!(chipped.contains(&[11, 5, 5]), "must chip wood cell 11");
        assert!(chipped.contains(&[12, 5, 5]), "must chip glass cell 12");

        // Scenario B: 4 cells of steel (x=10..=13) stops 5.56 rifle completely.
        let mut sim_b = BallisticSim::new();
        sim_b.spawn_projectile(Caliber::Rifle556, [0.5, 5.5, 5.5], [1.0, 0.0, 0.0]);
        let world_b = |c: [i32; 3]| -> Kind {
            if (10..=13).contains(&c[0]) { steel } else { 0 }
        };
        sim_b.step(1.0 / 60.0, &[], world_b);

        assert!(
            sim_b.projectiles.is_empty(),
            "5.56 rifle must stop inside 4 cells of steel"
        );
    }

    #[test]
    fn grazing_ricochet_steel_at_10_degrees() {
        let steel = kinds::kind(kinds::STEEL, kinds::OWN);
        // Horizontal steel floor at y <= 0 (top face at y = 1.0, normal = +Y).
        let floor = |c: [i32; 3]| -> Kind {
            if c[1] <= 0 { steel } else { 0 }
        };

        let angle = 10.0_f32.to_radians();
        let dir = [angle.cos(), -angle.sin(), 0.0];
        let mut sim = BallisticSim::new();
        sim.spawn_projectile(Caliber::Rifle556, [0.5, 3.0, 5.5], dir);
        let initial_energy = sim.projectiles[0].energy();

        // Advance until bullet hits floor at y=1.0 (dist ~ 2.0 / sin(10 deg) ≈ 11.5 cells).
        sim.step(1.0 / 60.0, &[], floor);

        let ricochet = sim.events.iter().find_map(|e| match e {
            BallisticEvent::Ricochet {
                pos,
                dir,
                material,
                energy,
            } => Some((*pos, *dir, *material, *energy)),
            _ => None,
        });

        let (r_pos, r_dir, r_mat, r_energy) =
            ricochet.expect("10-degree grazing shot on steel must emit Ricochet event");
        assert_eq!(r_mat, kinds::STEEL);
        assert!((r_pos[1] - 1.0).abs() < 0.05, "impact should be on floor y=1.0, got {r_pos:?}");
        assert!(r_dir[0] > 0.7, "outgoing ray must continue forward (+X), got {r_dir:?}");
        assert!(r_dir[1] > 0.05, "outgoing ray must deflect upward (+Y), got {r_dir:?}");
        assert!(
            r_energy > 0.0 && r_energy < initial_energy,
            "ricochet must lose energy: initial={initial_energy}, after={r_energy}"
        );
        assert_eq!(sim.projectiles.len(), 1, "ricocheted bullet stays alive");
        assert!(sim.projectiles[0].vel[1] > 0.0, "ricocheted bullet travels upward");
    }

    #[test]
    fn exact_momentum_transfer_to_dynamic_body() {
        let mut sim = BallisticSim::new();
        let dir = [1.0, 0.0, 0.0];
        sim.spawn_projectile(Caliber::Pistol9mm, [0.0, 5.0, 5.0], dir);
        let spec = Caliber::Pistol9mm.spec();
        let expected_p = spec.mass_kg * spec.muzzle_speed;

        // Heavy steel block that stops a 9mm bullet completely.
        let targets = [DynamicTarget {
            id: 42,
            min: [20.0, 3.0, 3.0],
            max: [24.0, 7.0, 7.0],
            material: kinds::STEEL,
            mass: 50.0,
        }];

        sim.step(1.0 / 60.0, &targets, |_| 0);

        let hit = sim.events.iter().find_map(|e| match e {
            BallisticEvent::BodyHit {
                body_id,
                impulse,
                is_pierce,
                ..
            } => Some((*body_id, *impulse, *is_pierce)),
            _ => None,
        });
        let (body_id, impulse, is_pierce) = hit.expect("bullet must hit steel DynamicTarget");
        assert_eq!(body_id, 42);
        assert!(!is_pierce);
        // Exact dp = m * dv (accounting for tiny drag over 20 cells ~0.36%).
        assert!(
            (impulse[0] - expected_p).abs() / expected_p < 0.02,
            "impulse[0]={} expected ~{}",
            impulse[0],
            expected_p
        );
    }

    #[test]
    fn wall_shielding_occlusion_under_15_percent() {
        let concrete = kinds::kind(kinds::CONCRETE, kinds::OWN);
        // 3-cell-thick concrete blast wall at x in 15..=17 shielding target +X,
        // while target -X at the exact same distance (30 cells) is completely unobstructed.
        let blast_wall = |c: [i32; 3]| -> Kind {
            if (15..=17).contains(&c[0]) && (-15..=25).contains(&c[1]) && (-20..=20).contains(&c[2]) {
                concrete
            } else {
                0
            }
        };

        let mut queue = ShockwaveQueue::new();
        queue.spawn_blast([0.5, 5.5, 0.5], 25.0, 500.0, 0, blast_wall);

        let targets = [
            DynamicTarget {
                id: 1, // Shielded behind 3-cell concrete wall at distance 30
                min: [29.5, 4.5, -0.5],
                max: [31.5, 6.5, 1.5],
                material: kinds::WOOD,
                mass: 70.0,
            },
            DynamicTarget {
                id: 2, // Identical unshielded target at distance 30 on opposite side
                min: [-30.5, 4.5, -0.5],
                max: [-28.5, 6.5, 1.5],
                material: kinds::WOOD,
                mass: 70.0,
            },
        ];

        let mut events = Vec::new();
        for _ in 0..10 {
            queue.step(0.005, &targets, &mut events);
        }

        let mut shielded_imp = None;
        let mut unshielded_imp = None;
        let mut shielded_p = None;
        let mut unshielded_p = None;

        for e in &events {
            if let BallisticEvent::ShockwaveHit {
                target_id,
                impulse,
                overpressure,
                ..
            } = e
            {
                if *target_id == 1 {
                    shielded_imp = Some(len3(*impulse));
                    shielded_p = Some(*overpressure);
                } else if *target_id == 2 {
                    unshielded_imp = Some(len3(*impulse));
                    unshielded_p = Some(*overpressure);
                }
            }
        }

        let s_imp = shielded_imp.expect("shielded target must receive attenuated shockwave");
        let u_imp = unshielded_imp.expect("unshielded target must receive full shockwave");
        let ratio = s_imp / u_imp;
        let p_ratio = shielded_p.unwrap() / unshielded_p.unwrap();

        assert!(
            ratio < 0.10,
            "shielded target must get <= 10% (and < 15%) impulse: ratio={ratio:.4} (s={s_imp}, u={u_imp})"
        );
        assert!(
            p_ratio < 0.10,
            "shielded overpressure ratio must be <= 10%: p_ratio={p_ratio:.4}"
        );
    }

    #[test]
    fn delayed_shockwave_timing_34m_arrives_at_0_10s() {
        let glass = kinds::kind(kinds::GLASS, kinds::OWN);
        // Place a glass window at 68 cells (~0.02 s) and a dynamic target at 340 cells (34 m -> 0.10 s).
        let world = |c: [i32; 3]| -> Kind {
            if c[0] == 68 && (-10..=10).contains(&c[1]) && (-10..=10).contains(&c[2]) {
                glass
            } else {
                0
            }
        };

        let mut queue = ShockwaveQueue::new();
        queue.spawn_blast([0.5, 5.5, 0.5], 40.0, 600.0, 24, world);

        let target = [DynamicTarget {
            id: 99,
            min: [339.5, 4.5, -0.5],
            max: [341.5, 6.5, 1.5],
            material: kinds::WOOD,
            mass: 80.0,
        }];

        // Step in 10 ms increments up to 0.15 s.
        let dt = 0.01_f32;
        let mut hit_step: Option<(usize, f32)> = None;
        let mut glass_shattered = false;

        for step_idx in 1..=15 {
            let ev = queue.step_collect(dt, &target);
            for e in ev {
                match e {
                    BallisticEvent::ShockwaveHit {
                        target_id: 99,
                        delay_s,
                        ..
                    } => {
                        assert!(hit_step.is_none(), "target should only be hit once");
                        hit_step = Some((step_idx, delay_s));
                    }
                    BallisticEvent::VoxelChip { kind, .. } if kinds::material(kind) == kinds::GLASS => {
                        glass_shattered = true;
                    }
                    _ => {}
                }
            }
            if step_idx == 1 {
                assert!(
                    hit_step.is_none(),
                    "target 34m away must NOT be hit at t=0.01s!"
                );
            }
        }

        let (step_idx, delay_s) = hit_step.expect("target at 340 cells must receive shockwave");
        let sim_time = step_idx as f32 * dt;
        assert!(
            (sim_time - 0.10).abs() <= 0.015,
            "shockwave arrived at {sim_time}s, expected ~0.10s"
        );
        assert!(
            (delay_s - 0.10).abs() <= 0.005,
            "reported delay_s={delay_s}, expected ~0.10s"
        );
        assert!(glass_shattered, "distant glass should shatter as wave passes");
    }

    #[test]
    fn shaped_charge_rocket_thrust_guidance_and_armor_jet() {
        let steel = kinds::kind(kinds::STEEL, kinds::OWN);
        // 6-cell-thick vertical steel armor plate at x in 100..=105.
        let armor = |c: [i32; 3]| -> Kind {
            if (100..=105).contains(&c[0]) && (0..=20).contains(&c[1]) && (-10..=10).contains(&c[2]) {
                steel
            } else {
                0
            }
        };

        let mut sim = BallisticSim::new();
        // Launch rocket slightly off-axis with proportional-navigation guidance aimed at (100, 10, 0).
        sim.spawn_guided_rocket(
            [0.5, 10.5, 2.0],
            [1.0, 0.0, 0.0],
            GuidanceTarget {
                pos: [100.0, 10.5, 0.0],
                vel: [0.0, 0.0, 0.0],
                nav_gain: 4.0,
                max_lateral_accel: 400.0,
            },
        );
        let launch_speed = sim.projectiles[0].speed();

        let mut saw_accel = false;
        let mut detonation: Option<([f32; 3], [f32; 3], Vec<[i32; 3]>)> = None;

        for _ in 0..120 {
            sim.step(1.0 / 60.0, &[], armor);
            if let Some(p) = sim.projectiles.first()
                && p.speed() > launch_speed + 200.0
            {
                saw_accel = true;
            }
            for e in sim.drain_events() {
                if let BallisticEvent::RocketDetonate {
                    pos,
                    dir,
                    jet_cells,
                    ..
                } = e
                {
                    detonation = Some((pos, dir, jet_cells));
                }
            }
            if detonation.is_some() {
                break;
            }
        }

        assert!(saw_accel, "rocket must accelerate under motor thrust");
        let (det_pos, det_dir, jet_cells) =
            detonation.expect("rocket must detonate on steel armor plate");
        assert!(
            det_pos[0] >= 98.0 && det_pos[0] <= 101.0,
            "swept-sphere r=1.5 should trigger detonation right at armor face x=100, got {det_pos:?}"
        );
        assert!(
            det_dir[0] > 0.9,
            "impact velocity vector should point into armor plate (+X), got {det_dir:?}"
        );
        assert!(
            jet_cells.len() >= 4,
            "shaped-charge jet must bore deep into steel armor (>=4 cells), bored {} cells: {:?}",
            jet_cells.len(),
            jet_cells
        );
        // Verify jet progresses monotonically along +X through the armor plate.
        let min_x = jet_cells.iter().map(|c| c[0]).min().unwrap();
        let max_x = jet_cells.iter().map(|c| c[0]).max().unwrap();
        assert!(
            max_x - min_x >= 3,
            "jet must penetrate directionally along velocity axis: min_x={min_x}, max_x={max_x}"
        );
        assert!(
            sim.shockwaves.active_waves() >= 1,
            "rocket detonation must spawn an occluded shockwave"
        );
    }

    #[test]
    fn ray_capsule_hits_and_misses_accurately() {
        let cap = DynamicCapsule {
            id: 7,
            a: [10.0, 2.0, 0.0],
            b: [10.0, 8.0, 0.0],
            radius: 1.5,
            material: kinds::WOOD,
            mass: 60.0,
        };
        let hit = ray_capsule([0.0, 5.0, 0.0], [1.0, 0.0, 0.0], 50.0, &cap)
            .expect("center shot must hit capsule cylinder");
        assert!((hit.0 - 8.5).abs() < 1e-4, "expected t=8.5, got {}", hit.0);
        assert!((hit.1[0] + 1.0).abs() < 1e-4);

        let top_hit = ray_capsule([0.0, 9.0, 0.0], [1.0, 0.0, 0.0], 50.0, &cap)
            .expect("hemisphere endcap shot must hit");
        assert!(top_hit.0 > 8.5 && top_hit.0 < 10.0);

        let miss = ray_capsule([0.0, 12.0, 0.0], [1.0, 0.0, 0.0], 50.0, &cap);
        assert!(miss.is_none());
    }

    #[test]
    fn benchmark_100_bullets_plus_1_occluded_blast_under_0_5ms() {
        let concrete = kinds::kind(kinds::CONCRETE, kinds::OWN);
        // Simple repeatable city-like voxel predicate (ground + periodic walls).
        let world = |c: [i32; 3]| -> Kind {
            if c[1] <= 0 || (c[0] == 220 && c[1] < 40) {
                concrete
            } else {
                0
            }
        };

        let targets: Vec<DynamicTarget> = (0..16)
            .map(|i| DynamicTarget {
                id: i + 1,
                min: [60.0 + (i as f32) * 8.0, 2.0, -2.0 + (i as f32 % 4.0) * 6.0],
                max: [62.0 + (i as f32) * 8.0, 6.0, 0.0 + (i as f32 % 4.0) * 6.0],
                material: kinds::WOOD,
                mass: 70.0,
            })
            .collect();

        // Warmup
        let mut warm = BallisticSim::new();
        for i in 0..100 {
            warm.spawn_projectile(
                Caliber::Rifle556,
                [0.5, 5.0 + (i % 10) as f32, (i / 10) as f32 * 3.0],
                [1.0, 0.0, 0.0],
            );
        }
        warm.spawn_blast([30.0, 6.0, 15.0], 25.0, 450.0, 32, world);
        warm.step(1.0 / 60.0, &targets, world);

        // Measured trials: each trial spawns 1 occluded blast + steps 100 active bullets + shockwave.
        let trials = 25usize;
        let mut total_us = 0.0_f64;

        for _ in 0..trials {
            let mut sim = BallisticSim::new();
            for i in 0..100 {
                sim.spawn_projectile(
                    Caliber::Rifle556,
                    [0.5, 8.0 + (i % 10) as f32, (i / 10) as f32 * 3.0],
                    [1.0, 0.0, 0.0],
                );
            }
            let t0 = Instant::now();
            sim.spawn_blast([30.0, 6.0, 15.0], 25.0, 450.0, 32, world);
            sim.step(1.0 / 60.0, &targets, world);
            total_us += t0.elapsed().as_secs_f64() * 1e6;
        }

        let avg_ms = (total_us / trials as f64) / 1000.0;
        eprintln!(
            "ballistics benchmark: 100 bullets + 1 occluded blast (64 rays + 32 shrapnel) avg = {avg_ms:.4} ms"
        );
        // Assert the < 0.5 ms budget in release builds (debug builds are slower without LTO/opt-level=3).
        #[cfg(not(debug_assertions))]
        assert!(
            avg_ms < 0.5,
            "100 bullets + 1 occluded blast took {avg_ms:.4} ms, exceeding 0.5 ms budget"
        );
    }
}
