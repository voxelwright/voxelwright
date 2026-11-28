//! Warm-started TGS-Soft / XPBD 6-DOF constraint, joint, motor, and rope/cable solver (#166).
//!
//! Powers doors, cranes, towing cables, winches, detachable vehicle parts, active ragdolls,
//! blade-stab prismatic binding, and physics-driven melee hands/weapons.
//!
//! Design principles:
//! - Zero external dependencies, deterministic IEEE-754 float arithmetic, reusable scratch buffers.
//! - Cleanly decoupled from `bodies.rs` through [`SolverBody`] so `Bodies::step()` can adapt its
//!   body list in ~30 lines.
//! - Erin Catto TGS-Soft implicit spring-damper compliance (`bias_rate`, `mass_coeff`,
//!   `impulse_coeff` from frequency `hz` and damping ratio `zeta`) for unconditional stability on
//!   high mass-ratio chains (e.g. 100:1 tow loads, 10-link chains, 13-bone ragdolls) at 120 Hz
//!   with 4–8 velocity iterations, paired with XPBD soft position projection and velocity
//!   relaxation for drift-free pendulums.
//! - Persistent accumulated impulse warm-starting (`0.85 * prev_lambda` by default).
//! - Teardown-style [`VoxelAnchor`] metadata with immediate invalidation when world or body
//!   anchor voxels are carved or burnt away.
//! - Explicit `wasm32` `simd128` (`core::arch::wasm32::f32x4`) 4-wide vector, quaternion, and
//!   batched distance/cable row evaluation with exact scalar fallback on native targets.
//!
//! Units match `bodies.rs`: lengths in finest cells (10 cm), time in seconds, right-handed
//! Y-up coordinates, Hamilton quaternions `[x, y, z, w]`, row-major 3×3 matrices.

use std::collections::HashMap;
use std::f32::consts::{PI, TAU};
use std::hash::{BuildHasherDefault, Hasher};

// ── Deterministic fast hasher (same Mix pattern as bodies.rs) ───────────────

#[derive(Default, Clone, Copy)]
struct IdMix(u64);

impl Hasher for IdMix {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0 ^ b as u64).wrapping_mul(0x100_0000_01b3);
        }
    }
    fn write_u32(&mut self, v: u32) {
        self.0 = (self.0.rotate_left(23) ^ v as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    }
}

type IdMap<V> = HashMap<u32, V, BuildHasherDefault<IdMix>>;

type V3 = [f32; 3];
type Q4 = [f32; 4];
type M3 = [[f32; 3]; 3];

const ZERO3: V3 = [0.0, 0.0, 0.0];
const ID_QUAT: Q4 = [0.0, 0.0, 0.0, 1.0];
const ZERO_M3: M3 = [[0.0; 3]; 3];
const FLAT_ID_LIMIT: usize = 8192;

// ── Scalar 3D & quaternion math (deterministic IEEE-754) ────────────────────

#[inline]
fn v_add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

#[inline]
fn v_sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

#[inline]
fn v_scale(a: V3, k: f32) -> V3 {
    [a[0] * k, a[1] * k, a[2] * k]
}

#[inline]
fn v_neg(a: V3) -> V3 {
    [-a[0], -a[1], -a[2]]
}

#[inline]
fn v_dot(a: V3, b: V3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline]
fn v_cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[inline]
fn v_len_sq(a: V3) -> f32 {
    v_dot(a, a)
}

#[inline]
fn v_len(a: V3) -> f32 {
    v_len_sq(a).sqrt()
}

#[inline]
fn v_unit_or(a: V3, fallback: V3) -> V3 {
    let l = v_len(a);
    if l > 1e-6 { v_scale(a, 1.0 / l) } else { fallback }
}

/// Deterministic orthonormal pair `(t1, t2)` perpendicular to unit vector `n`.
#[inline]
fn ortho_basis(n: V3) -> (V3, V3) {
    let ref_v = if n[0].abs() < 0.8 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
    let t1 = v_unit_or(v_cross(n, ref_v), [0.0, 1.0, 0.0]);
    let t2 = v_cross(n, t1);
    (t1, t2)
}

/// Orthonormalizes `cand` perpendicular to unit vector `axis`, falling back deterministically.
#[inline]
fn ortho_perp(axis: V3, cand: V3) -> V3 {
    let proj = v_sub(cand, v_scale(axis, v_dot(cand, axis)));
    let l = v_len(proj);
    if l > 1e-5 { v_scale(proj, 1.0 / l) } else { ortho_basis(axis).0 }
}

/// Hamilton quaternion product `a * b` with `[x, y, z, w]` layout.
#[inline]
pub fn quat_mul(a: Q4, b: Q4) -> Q4 {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}

#[inline]
pub fn quat_conj(q: Q4) -> Q4 {
    [-q[0], -q[1], -q[2], q[3]]
}

#[inline]
pub fn quat_norm(q: Q4) -> Q4 {
    let l = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if l > 1e-8 {
        let inv = 1.0 / l;
        [q[0] * inv, q[1] * inv, q[2] * inv, q[3] * inv]
    } else {
        ID_QUAT
    }
}

/// Rotates `v` by unit quaternion `q` (`q * v * q^-1`), matching `bodies::turn`.
#[inline]
pub fn quat_rotate(q: Q4, v: V3) -> V3 {
    let u = [q[0], q[1], q[2]];
    let t = v_scale(v_cross(u, v), 2.0);
    v_add(v_add(v, v_scale(t, q[3])), v_cross(u, t))
}

/// Rotates `v` by the inverse of unit quaternion `q`, matching `bodies::back`.
#[inline]
pub fn quat_inv_rotate(q: Q4, v: V3) -> V3 {
    quat_rotate(quat_conj(q), v)
}

/// Builds a unit quaternion rotating by `angle` radians around `axis`.
#[inline]
pub fn quat_from_axis_angle(axis: V3, angle: f32) -> Q4 {
    let a = v_unit_or(axis, [0.0, 1.0, 0.0]);
    let (s, c) = (0.5 * angle).sin_cos();
    [a[0] * s, a[1] * s, a[2] * s, c]
}

/// Builds a joint basis quaternion whose local `+X` axis aligns with `twist_axis`.
pub fn frame_from_twist_axis(twist_axis: V3) -> Q4 {
    let x = v_unit_or(twist_axis, [1.0, 0.0, 0.0]);
    let (y, z) = ortho_basis(x);
    // Rotation matrix with columns [x, y, z] -> quaternion.
    let m00 = x[0];
    let m01 = y[0];
    let m02 = z[0];
    let m10 = x[1];
    let m11 = y[1];
    let m12 = z[1];
    let m20 = x[2];
    let m21 = y[2];
    let m22 = z[2];
    let tr = m00 + m11 + m22;
    let q = if tr > 0.0 {
        let s = (tr + 1.0).sqrt() * 2.0;
        [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]
    } else if m00 > m11 && m00 > m22 {
        let s = (1.0 + m00 - m11 - m22).sqrt() * 2.0;
        [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
    } else if m11 > m22 {
        let s = (1.0 + m11 - m00 - m22).sqrt() * 2.0;
        [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
    } else {
        let s = (1.0 + m22 - m00 - m11).sqrt() * 2.0;
        [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
    };
    quat_norm(q)
}

/// Shortest world-space rotation vector `e` such that `q_current = exp(e / 2) * q_target`.
#[inline]
fn quat_error_vec(q_current: Q4, q_target: Q4) -> V3 {
    let mut qe = quat_mul(q_current, quat_conj(q_target));
    if qe[3] < 0.0 {
        qe = [-qe[0], -qe[1], -qe[2], -qe[3]];
    }
    let v = [qe[0], qe[1], qe[2]];
    let sin_half = v_len(v);
    if sin_half < 1e-6 {
        v_scale(v, 2.0)
    } else {
        let angle = 2.0 * sin_half.atan2(qe[3]);
        v_scale(v, angle / sin_half)
    }
}

/// Integrates unit quaternion `q` by world angular velocity `omega` over `dt` using exact SO(3) exp.
#[inline]
fn quat_integrate(q: Q4, omega: V3, dt: f32) -> Q4 {
    let w_len = v_len(omega);
    let angle = w_len * dt;
    if angle < 1e-6 {
        let dq = [
            0.5 * dt * (omega[0] * q[3] + omega[1] * q[2] - omega[2] * q[1]),
            0.5 * dt * (omega[1] * q[3] + omega[2] * q[0] - omega[0] * q[2]),
            0.5 * dt * (omega[2] * q[3] + omega[0] * q[1] - omega[1] * q[0]),
            0.5 * dt * (-omega[0] * q[0] - omega[1] * q[1] - omega[2] * q[2]),
        ];
        quat_norm([q[0] + dq[0], q[1] + dq[1], q[2] + dq[2], q[3] + dq[3]])
    } else {
        let half = 0.5 * angle;
        let s = half.sin() / w_len;
        let c = half.cos();
        quat_norm(quat_mul([omega[0] * s, omega[1] * s, omega[2] * s, c], q))
    }
}

/// Wraps an angle difference into `(-PI, PI]`.
#[inline]
fn wrap_pi(mut a: f32) -> f32 {
    while a > PI {
        a -= TAU;
    }
    while a <= -PI {
        a += TAU;
    }
    a
}

#[inline]
fn m3_mul_v(m: &M3, v: V3) -> V3 {
    [v_dot(m[0], v), v_dot(m[1], v), v_dot(m[2], v)]
}

#[inline]
fn m3_add(a: &M3, b: &M3) -> M3 {
    [
        [a[0][0] + b[0][0], a[0][1] + b[0][1], a[0][2] + b[0][2]],
        [a[1][0] + b[1][0], a[1][1] + b[1][1], a[1][2] + b[1][2]],
        [a[2][0] + b[2][0], a[2][1] + b[2][1], a[2][2] + b[2][2]],
    ]
}

/// Transforms a local-space inverse inertia tensor into world space: `R * I_local^-1 * R^T`.
pub fn world_inv_inertia(rot: Q4, inv_inertia_local: M3) -> M3 {
    let basis = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let mut cols = [ZERO3; 3];
    for j in 0..3 {
        let u = quat_inv_rotate(rot, basis[j]);
        let w = m3_mul_v(&inv_inertia_local, u);
        cols[j] = quat_rotate(rot, w);
    }
    // Symmetrize to remove 1-ULP float asymmetry.
    let m01 = 0.5 * (cols[1][0] + cols[0][1]);
    let m02 = 0.5 * (cols[2][0] + cols[0][2]);
    let m12 = 0.5 * (cols[2][1] + cols[1][2]);
    [
        [cols[0][0], m01, m02],
        [m01, cols[1][1], m12],
        [m02, m12, cols[2][2]],
    ]
}

/// Computes the 3×3 inverse effective mass matrix `K = (w_a + w_b) I + [r_a]_x^T I_a^-1 [r_a]_x + [r_b]_x^T I_b^-1 [r_b]_x`.
#[inline]
fn point_k_matrix(inv_mass_sum: f32, ra: V3, ia: &M3, rb: V3, ib: &M3) -> M3 {
    let basis = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let mut cols = [ZERO3; 3];
    for j in 0..3 {
        let ua = v_cross(ra, basis[j]);
        let ta = m3_mul_v(ia, ua);
        let ca = v_cross(ta, ra);

        let ub = v_cross(rb, basis[j]);
        let tb = m3_mul_v(ib, ub);
        let cb = v_cross(tb, rb);

        cols[j] = v_add(ca, cb);
        cols[j][j] += inv_mass_sum;
    }
    let m01 = 0.5 * (cols[1][0] + cols[0][1]);
    let m02 = 0.5 * (cols[2][0] + cols[0][2]);
    let m12 = 0.5 * (cols[2][1] + cols[1][2]);
    [
        [cols[0][0], m01, m02],
        [m01, cols[1][1], m12],
        [m02, m12, cols[2][2]],
    ]
}

/// Safe 3×3 matrix inverse via cofactors; returns zero matrix if singular.
#[inline]
fn m3_inv(m: &M3) -> M3 {
    let c0 = v_cross(m[1], m[2]);
    let c1 = v_cross(m[2], m[0]);
    let c2 = v_cross(m[0], m[1]);
    let det = v_dot(m[0], c0);
    if det.abs() <= 1e-12 {
        return ZERO_M3;
    }
    let inv = 1.0 / det;
    [
        [c0[0] * inv, c1[0] * inv, c2[0] * inv],
        [c0[1] * inv, c1[1] * inv, c2[1] * inv],
        [c0[2] * inv, c1[2] * inv, c2[2] * inv],
    ]
}

/// Safe symmetric 2×2 matrix inverse; returns `(0, 0, 0)` if singular.
#[inline]
fn sym2_inv(m00: f32, m01: f32, m11: f32) -> (f32, f32, f32) {
    let det = m00 * m11 - m01 * m01;
    if det.abs() <= 1e-12 {
        return (0.0, 0.0, 0.0);
    }
    let inv = 1.0 / det;
    (m11 * inv, -m01 * inv, m00 * inv)
}

#[inline]
fn linear_row_k(inv_mass_sum: f32, ra: V3, ia: &M3, rb: V3, ib: &M3, axis: V3) -> f32 {
    let rxa = v_cross(ra, axis);
    let rxb = v_cross(rb, axis);
    inv_mass_sum + v_dot(rxa, m3_mul_v(ia, rxa)) + v_dot(rxb, m3_mul_v(ib, rxb))
}

#[inline]
fn angular_row_k(ia: &M3, ib: &M3, axis: V3) -> f32 {
    v_dot(axis, m3_mul_v(ia, axis)) + v_dot(axis, m3_mul_v(ib, axis))
}

// ── Explicit wasm32 SIMD (`core::arch::wasm32::f32x4`) with scalar fallback ─

/// 4-wide `f32` lane vector backed by `core::arch::wasm32::v128` on `wasm32 +simd128`
/// and `[f32; 4]` elsewhere, keeping identical IEEE-754 operations across both paths.
#[derive(Clone, Copy)]
struct F32x4 {
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    v: core::arch::wasm32::v128,
    #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
    v: [f32; 4],
}

impl F32x4 {
    #[inline]
    fn splat(x: f32) -> Self {
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        {
            Self { v: core::arch::wasm32::f32x4_splat(x) }
        }
        #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
        {
            Self { v: [x, x, x, x] }
        }
    }

    #[inline]
    fn from_array(a: [f32; 4]) -> Self {
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        {
            Self { v: core::arch::wasm32::f32x4(a[0], a[1], a[2], a[3]) }
        }
        #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
        {
            Self { v: a }
        }
    }

    #[inline]
    fn to_array(self) -> [f32; 4] {
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        {
            use core::arch::wasm32::f32x4_extract_lane;
            [
                f32x4_extract_lane::<0>(self.v),
                f32x4_extract_lane::<1>(self.v),
                f32x4_extract_lane::<2>(self.v),
                f32x4_extract_lane::<3>(self.v),
            ]
        }
        #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
        {
            self.v
        }
    }

    #[inline]
    fn add(self, rhs: Self) -> Self {
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        {
            Self { v: core::arch::wasm32::f32x4_add(self.v, rhs.v) }
        }
        #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
        {
            Self {
                v: [
                    self.v[0] + rhs.v[0],
                    self.v[1] + rhs.v[1],
                    self.v[2] + rhs.v[2],
                    self.v[3] + rhs.v[3],
                ],
            }
        }
    }

    #[inline]
    fn sub(self, rhs: Self) -> Self {
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        {
            Self { v: core::arch::wasm32::f32x4_sub(self.v, rhs.v) }
        }
        #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
        {
            Self {
                v: [
                    self.v[0] - rhs.v[0],
                    self.v[1] - rhs.v[1],
                    self.v[2] - rhs.v[2],
                    self.v[3] - rhs.v[3],
                ],
            }
        }
    }

    #[inline]
    fn mul(self, rhs: Self) -> Self {
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        {
            Self { v: core::arch::wasm32::f32x4_mul(self.v, rhs.v) }
        }
        #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
        {
            Self {
                v: [
                    self.v[0] * rhs.v[0],
                    self.v[1] * rhs.v[1],
                    self.v[2] * rhs.v[2],
                    self.v[3] * rhs.v[3],
                ],
            }
        }
    }

    #[inline]
    fn neg(self) -> Self {
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        {
            Self { v: core::arch::wasm32::f32x4_neg(self.v) }
        }
        #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
        {
            Self { v: [-self.v[0], -self.v[1], -self.v[2], -self.v[3]] }
        }
    }

    #[inline]
    fn clamp(self, lo: Self, hi: Self) -> Self {
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        {
            use core::arch::wasm32::{f32x4_max, f32x4_min};
            Self { v: f32x4_min(f32x4_max(self.v, lo.v), hi.v) }
        }
        #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
        {
            Self {
                v: [
                    self.v[0].max(lo.v[0]).min(hi.v[0]),
                    self.v[1].max(lo.v[1]).min(hi.v[1]),
                    self.v[2].max(lo.v[2]).min(hi.v[2]),
                    self.v[3].max(lo.v[3]).min(hi.v[3]),
                ],
            }
        }
    }
}

/// 4-wide batched dot product `a · b`, SIMD-accelerated on `wasm32 +simd128`.
#[inline]
pub fn dot4(
    ax: [f32; 4],
    ay: [f32; 4],
    az: [f32; 4],
    bx: [f32; 4],
    by: [f32; 4],
    bz: [f32; 4],
) -> [f32; 4] {
    let x = F32x4::from_array(ax).mul(F32x4::from_array(bx));
    let y = F32x4::from_array(ay).mul(F32x4::from_array(by));
    let z = F32x4::from_array(az).mul(F32x4::from_array(bz));
    x.add(y).add(z).to_array()
}

/// 4-wide batched cross product `a × b`, SIMD-accelerated on `wasm32 +simd128`.
#[inline]
pub fn cross4(
    ax: [f32; 4],
    ay: [f32; 4],
    az: [f32; 4],
    bx: [f32; 4],
    by: [f32; 4],
    bz: [f32; 4],
) -> ([f32; 4], [f32; 4], [f32; 4]) {
    let (ax, ay, az) = (F32x4::from_array(ax), F32x4::from_array(ay), F32x4::from_array(az));
    let (bx, by, bz) = (F32x4::from_array(bx), F32x4::from_array(by), F32x4::from_array(bz));
    let cx = ay.mul(bz).sub(az.mul(by));
    let cy = az.mul(bx).sub(ax.mul(bz));
    let cz = ax.mul(by).sub(ay.mul(bx));
    (cx.to_array(), cy.to_array(), cz.to_array())
}

/// 4-wide batched quaternion vector rotation `q * v * q^-1`, SIMD-accelerated on `wasm32 +simd128`.
#[inline]
pub fn quat_rotate4(
    qx: [f32; 4],
    qy: [f32; 4],
    qz: [f32; 4],
    qw: [f32; 4],
    vx: [f32; 4],
    vy: [f32; 4],
    vz: [f32; 4],
) -> ([f32; 4], [f32; 4], [f32; 4]) {
    let two = F32x4::splat(2.0);
    let (ux, uy, uz, w) = (
        F32x4::from_array(qx),
        F32x4::from_array(qy),
        F32x4::from_array(qz),
        F32x4::from_array(qw),
    );
    let (vx, vy, vz) = (F32x4::from_array(vx), F32x4::from_array(vy), F32x4::from_array(vz));
    // t = 2 * (u × v)
    let tx = two.mul(uy.mul(vz).sub(uz.mul(vy)));
    let ty = two.mul(uz.mul(vx).sub(ux.mul(vz)));
    let tz = two.mul(ux.mul(vy).sub(uy.mul(vx)));
    // out = v + w * t + u × t
    let utx = uy.mul(tz).sub(uz.mul(ty));
    let uty = uz.mul(tx).sub(ux.mul(tz));
    let utz = ux.mul(ty).sub(uy.mul(tx));
    let ox = vx.add(w.mul(tx)).add(utx);
    let oy = vy.add(w.mul(ty)).add(uty);
    let oz = vz.add(w.mul(tz)).add(utz);
    (ox.to_array(), oy.to_array(), oz.to_array())
}

/// 4-wide SoA batch of scalar distance / rope / cable / winch constraint rows.
#[derive(Clone, Copy, Debug)]
pub struct DistanceBatch4 {
    /// Unit constraint direction `n` pointing from anchor A to anchor B.
    pub nx: [f32; 4],
    pub ny: [f32; 4],
    pub nz: [f32; 4],
    /// World lever arms `r_a = p_a - x_a`, `r_b = p_b - x_b`.
    pub rax: [f32; 4],
    pub ray: [f32; 4],
    pub raz: [f32; 4],
    pub rbx: [f32; 4],
    pub rby: [f32; 4],
    pub rbz: [f32; 4],
    /// Precomputed angular impulse responses `I_a^-1 (r_a × n)` and `I_b^-1 (r_b × n)`.
    pub i_rxa_x: [f32; 4],
    pub i_rxa_y: [f32; 4],
    pub i_rxa_z: [f32; 4],
    pub i_rxb_x: [f32; 4],
    pub i_rxb_y: [f32; 4],
    pub i_rxb_z: [f32; 4],
    /// Inverse masses of A and B (`0.0` for static).
    pub inv_ma: [f32; 4],
    pub inv_mb: [f32; 4],
    /// Scalar effective mass `1 / K` (0.0 if degenerate/inactive).
    pub eff_mass: [f32; 4],
    /// TGS-Soft coefficients for each lane.
    pub bias_rate: [f32; 4],
    pub mass_coeff: [f32; 4],
    pub impulse_coeff: [f32; 4],
    /// Constraint error `C`, target relative velocity (e.g. `-winch_speed`), impulse bounds.
    pub error: [f32; 4],
    pub target_vel: [f32; 4],
    pub lambda_min: [f32; 4],
    pub lambda_max: [f32; 4],
    /// Accumulated impulse per lane (updated in place).
    pub lambda: [f32; 4],
}

/// 4-wide SoA body velocities updated by [`solve_distance_batch_4`].
#[derive(Clone, Copy, Debug)]
pub struct BodyVelBatch4 {
    pub vax: [f32; 4],
    pub vay: [f32; 4],
    pub vaz: [f32; 4],
    pub wax: [f32; 4],
    pub way: [f32; 4],
    pub waz: [f32; 4],
    pub vbx: [f32; 4],
    pub vby: [f32; 4],
    pub vbz: [f32; 4],
    pub wbx: [f32; 4],
    pub wby: [f32; 4],
    pub wbz: [f32; 4],
}

/// Evaluates and applies 4 distance/rope/cable/winch TGS-Soft constraint rows in parallel
/// using 4-wide `f32x4` SIMD on `wasm32 +simd128` (and identical scalar fallback on native).
/// Returns the applied delta impulses `[f32; 4]`.
pub fn solve_distance_batch_4(batch: &mut DistanceBatch4, vel: &mut BodyVelBatch4) -> [f32; 4] {
    let (wa_x_ra_x, wa_x_ra_y, wa_x_ra_z) = cross4(
        vel.wax, vel.way, vel.waz, batch.rax, batch.ray, batch.raz,
    );
    let (wb_x_rb_x, wb_x_rb_y, wb_x_rb_z) = cross4(
        vel.wbx, vel.wby, vel.wbz, batch.rbx, batch.rby, batch.rbz,
    );

    let vrel_x = F32x4::from_array(vel.vbx)
        .add(F32x4::from_array(wb_x_rb_x))
        .sub(F32x4::from_array(vel.vax).add(F32x4::from_array(wa_x_ra_x)));
    let vrel_y = F32x4::from_array(vel.vby)
        .add(F32x4::from_array(wb_x_rb_y))
        .sub(F32x4::from_array(vel.vay).add(F32x4::from_array(wa_x_ra_y)));
    let vrel_z = F32x4::from_array(vel.vbz)
        .add(F32x4::from_array(wb_x_rb_z))
        .sub(F32x4::from_array(vel.vaz).add(F32x4::from_array(wa_x_ra_z)));

    let jv = F32x4::from_array(dot4(
        vrel_x.to_array(),
        vrel_y.to_array(),
        vrel_z.to_array(),
        batch.nx,
        batch.ny,
        batch.nz,
    ));

    let old_l = F32x4::from_array(batch.lambda);
    let rhs = jv
        .sub(F32x4::from_array(batch.target_vel))
        .add(F32x4::from_array(batch.bias_rate).mul(F32x4::from_array(batch.error)));
    let dl_raw = F32x4::from_array(batch.eff_mass)
        .mul(F32x4::from_array(batch.mass_coeff))
        .mul(rhs)
        .neg()
        .sub(F32x4::from_array(batch.impulse_coeff).mul(old_l));

    let new_l = old_l
        .add(dl_raw)
        .clamp(F32x4::from_array(batch.lambda_min), F32x4::from_array(batch.lambda_max));
    let dl = new_l.sub(old_l);
    batch.lambda = new_l.to_array();

    let (nx, ny, nz) = (
        F32x4::from_array(batch.nx),
        F32x4::from_array(batch.ny),
        F32x4::from_array(batch.nz),
    );
    let dl_ma = dl.mul(F32x4::from_array(batch.inv_ma));
    let dl_mb = dl.mul(F32x4::from_array(batch.inv_mb));

    vel.vax = F32x4::from_array(vel.vax).sub(nx.mul(dl_ma)).to_array();
    vel.vay = F32x4::from_array(vel.vay).sub(ny.mul(dl_ma)).to_array();
    vel.vaz = F32x4::from_array(vel.vaz).sub(nz.mul(dl_ma)).to_array();

    vel.vbx = F32x4::from_array(vel.vbx).add(nx.mul(dl_mb)).to_array();
    vel.vby = F32x4::from_array(vel.vby).add(ny.mul(dl_mb)).to_array();
    vel.vbz = F32x4::from_array(vel.vbz).add(nz.mul(dl_mb)).to_array();

    vel.wax = F32x4::from_array(vel.wax)
        .sub(F32x4::from_array(batch.i_rxa_x).mul(dl))
        .to_array();
    vel.way = F32x4::from_array(vel.way)
        .sub(F32x4::from_array(batch.i_rxa_y).mul(dl))
        .to_array();
    vel.waz = F32x4::from_array(vel.waz)
        .sub(F32x4::from_array(batch.i_rxa_z).mul(dl))
        .to_array();

    vel.wbx = F32x4::from_array(vel.wbx)
        .add(F32x4::from_array(batch.i_rxb_x).mul(dl))
        .to_array();
    vel.wby = F32x4::from_array(vel.wby)
        .add(F32x4::from_array(batch.i_rxb_y).mul(dl))
        .to_array();
    vel.wbz = F32x4::from_array(vel.wbz)
        .add(F32x4::from_array(batch.i_rxb_z).mul(dl))
        .to_array();

    dl.to_array()
}

// ── Public solver types ─────────────────────────────────────────────────────

/// Decoupled rigid-body state adapter matching `bodies::Body` fields.
/// Body `id == 0` or `inv_mass == 0.0` represents the static world.
#[derive(Clone, Copy, Debug)]
pub struct SolverBody {
    pub id: u32,
    pub pos: [f32; 3],
    pub rot: [f32; 4],
    pub vel: [f32; 3],
    pub spin: [f32; 3],
    pub inv_mass: f32,
    pub inv_inertia_world: [[f32; 3]; 3],
    pub asleep: bool,
}

impl SolverBody {
    /// Static world body (`id == 0`, infinite mass and inertia).
    pub const fn static_world() -> Self {
        Self {
            id: 0,
            pos: ZERO3,
            rot: ID_QUAT,
            vel: ZERO3,
            spin: ZERO3,
            inv_mass: 0.0,
            inv_inertia_world: ZERO_M3,
            asleep: false,
        }
    }

    /// Creates a `SolverBody` from local-space inverse inertia, computing `inv_inertia_world`.
    pub fn from_local_inertia(
        id: u32,
        pos: [f32; 3],
        rot: [f32; 4],
        vel: [f32; 3],
        spin: [f32; 3],
        inv_mass: f32,
        inv_inertia_local: [[f32; 3]; 3],
        asleep: bool,
    ) -> Self {
        let q = quat_norm(rot);
        let inv_inertia_world = if id == 0 || inv_mass <= 0.0 {
            ZERO_M3
        } else {
            world_inv_inertia(q, inv_inertia_local)
        };
        Self { id, pos, rot: q, vel, spin, inv_mass, inv_inertia_world, asleep }
    }

    /// Convenience constructor for a uniform-density dynamic box (`half_extents` in cells).
    pub fn dynamic_box(id: u32, pos: [f32; 3], mass: f32, half_extents: [f32; 3]) -> Self {
        let inv_mass = if id == 0 || mass <= 0.0 { 0.0 } else { 1.0 / mass };
        let (hx, hy, hz) = (half_extents[0], half_extents[1], half_extents[2]);
        let ix = (mass / 3.0) * (hy * hy + hz * hz);
        let iy = (mass / 3.0) * (hx * hx + hz * hz);
        let iz = (mass / 3.0) * (hx * hx + hy * hy);
        let inv_inertia_world = if inv_mass == 0.0 {
            ZERO_M3
        } else {
            [
                [if ix > 1e-8 { 1.0 / ix } else { 0.0 }, 0.0, 0.0],
                [0.0, if iy > 1e-8 { 1.0 / iy } else { 0.0 }, 0.0],
                [0.0, 0.0, if iz > 1e-8 { 1.0 / iz } else { 0.0 }],
            ]
        };
        Self {
            id,
            pos,
            rot: ID_QUAT,
            vel: ZERO3,
            spin: ZERO3,
            inv_mass,
            inv_inertia_world,
            asleep: false,
        }
    }

    /// Returns true if this body is static (world id 0 or zero inverse mass).
    #[inline]
    pub fn is_static(&self) -> bool {
        self.id == 0 || self.inv_mass <= 0.0
    }

    /// Integrates constant acceleration (e.g. gravity `[0, -98.0, 0]`) into linear velocity.
    #[inline]
    pub fn integrate_forces(&mut self, gravity: [f32; 3], dt: f32) {
        if self.is_static() || self.asleep {
            return;
        }
        self.vel = v_add(self.vel, v_scale(gravity, dt));
    }

    /// Integrates linear and angular velocity into `pos`, `rot`, and updates `inv_inertia_world`.
    #[inline]
    pub fn integrate_positions(&mut self, dt: f32) {
        if self.is_static() || self.asleep {
            return;
        }
        self.pos = v_add(self.pos, v_scale(self.vel, dt));
        let prev_rot = self.rot;
        self.rot = quat_integrate(prev_rot, self.spin, dt);
        // Rotate world inverse inertia by the incremental step rotation dq = rot * prev_rot^-1.
        let dq = quat_mul(self.rot, quat_conj(prev_rot));
        self.inv_inertia_world = world_inv_inertia(dq, self.inv_inertia_world);
    }

    /// Recomputes `inv_inertia_world` from a known local-space inverse inertia tensor.
    #[inline]
    pub fn refresh_world_inertia(&mut self, inv_inertia_local: [[f32; 3]; 3]) {
        if self.is_static() {
            self.inv_inertia_world = ZERO_M3;
        } else {
            self.inv_inertia_world = world_inv_inertia(self.rot, inv_inertia_local);
        }
    }
}

/// Which voxel (if any) backs a joint endpoint for Teardown-style anchor invalidation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum VoxelAnchorKind {
    /// Geometric anchor only; never snapped by voxel carving.
    #[default]
    Free,
    /// Anchored to a standing world cell `[x, y, z]`.
    WorldCell([i32; 3]),
    /// Anchored to a dynamic body's local voxel cell `[x, y, z]`.
    BodyCell { body_id: u32, cell: [usize; 3] },
}

/// Voxel anchor metadata attached to one endpoint of a joint.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct VoxelAnchor {
    pub kind: VoxelAnchorKind,
}

impl VoxelAnchor {
    #[inline]
    pub const fn free() -> Self {
        Self { kind: VoxelAnchorKind::Free }
    }

    #[inline]
    pub const fn world_cell(cell: [i32; 3]) -> Self {
        Self { kind: VoxelAnchorKind::WorldCell(cell) }
    }

    #[inline]
    pub const fn body_cell(body_id: u32, cell: [usize; 3]) -> Self {
        Self { kind: VoxelAnchorKind::BodyCell { body_id, cell } }
    }
}

/// Erin Catto TGS-Soft constraint stiffness & damping specification.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Softness {
    /// Natural frequency in Hz. Higher = stiffer (e.g. `30.0–45.0` for structural joints at 120 Hz).
    /// `0.0` denotes a hard (non-compliant) constraint on structural joints, or a free axis on `Spring6Dof`.
    pub hz: f32,
    /// Damping ratio (`1.0` = critically damped, `0.7` = crisp, `0.3` = bouncy).
    pub zeta: f32,
}

impl Softness {
    /// Stiff critically damped structural constraint suitable for 120 Hz TGS-Soft chains & hinges.
    pub const RIGID: Self = Self { hz: 50.0, zeta: 1.0 };
    /// Stiff steel cable compliance.
    pub const CABLE: Self = Self { hz: 40.0, zeta: 1.0 };
    /// Smooth critically damped PD motor/spring default.
    pub const MOTOR: Self = Self { hz: 8.0, zeta: 1.0 };

    #[inline]
    pub const fn new(hz: f32, zeta: f32) -> Self {
        Self { hz, zeta }
    }

    /// Computes Erin Catto TGS-Soft coefficients `(bias_rate, mass_coeff, impulse_coeff)` for step `h`.
    #[inline]
    pub fn coeffs(self, h: f32) -> SoftCoeffs {
        if self.hz <= 0.0 || h <= 0.0 {
            return SoftCoeffs { bias_rate: 0.0, mass_coeff: 1.0, impulse_coeff: 0.0 };
        }
        let omega = TAU * self.hz;
        let a1 = 2.0 * self.zeta.max(0.0) + h * omega;
        let a2 = h * omega * a1;
        let a3 = 1.0 / (1.0 + a2);
        SoftCoeffs {
            bias_rate: omega / a1,
            mass_coeff: a2 * a3,
            impulse_coeff: a3,
        }
    }

    /// XPBD position-projection compliance factor in `(0, 1]` for step `h`.
    #[inline]
    pub fn pos_factor(self, h: f32) -> f32 {
        if self.hz <= 0.0 {
            return 1.0;
        }
        let wh = TAU * self.hz * h;
        let wh2 = wh * wh;
        wh2 / (1.0 + wh2)
    }
}

impl Default for Softness {
    fn default() -> Self {
        Self::RIGID
    }
}

/// Precomputed Erin Catto TGS-Soft constraint coefficients for one step `h`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SoftCoeffs {
    pub bias_rate: f32,
    pub mass_coeff: f32,
    pub impulse_coeff: f32,
}

impl SoftCoeffs {
    pub const HARD_ZERO_BIAS: Self = Self {
        bias_rate: 0.0,
        mass_coeff: 1.0,
        impulse_coeff: 0.0,
    };
}

/// 1-DOF lower/upper range limits (radians for angular joints, cells for sliders).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Limits1D {
    pub min: f32,
    pub max: f32,
}

impl Limits1D {
    #[inline]
    pub const fn new(min: f32, max: f32) -> Self {
        Self { min, max }
    }
}

/// 1-DOF velocity or implicit TGS-Soft PD position motor (Hinge torque or Slider force).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Motor1D {
    pub enabled: bool,
    /// Target velocity (rad/s for Hinge, cells/s for Slider). Also acts as feedforward velocity
    /// when `target_pos` is `Some`.
    pub target_vel: f32,
    /// Optional target angle (radians) or displacement (cells).
    pub target_pos: Option<f32>,
    /// TGS-Soft PD stiffness/damping when `target_pos` is `Some`.
    pub stiffness: Softness,
    /// Maximum torque (Hinge) or force (Slider).
    pub max_effort: f32,
}

impl Default for Motor1D {
    fn default() -> Self {
        Self {
            enabled: false,
            target_vel: 0.0,
            target_pos: None,
            stiffness: Softness::MOTOR,
            max_effort: 0.0,
        }
    }
}

impl Motor1D {
    pub const fn velocity(target_vel: f32, max_effort: f32) -> Self {
        Self {
            enabled: true,
            target_vel,
            target_pos: None,
            stiffness: Softness::MOTOR,
            max_effort,
        }
    }

    pub const fn position(target_pos: f32, stiffness: Softness, max_effort: f32) -> Self {
        Self {
            enabled: true,
            target_vel: 0.0,
            target_pos: Some(target_pos),
            stiffness,
            max_effort,
        }
    }
}

/// 3-axis implicit TGS-Soft PD angular drive for Ball / SwingTwist active ragdoll muscles.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AngularDrive3D {
    /// Target relative orientation of B's joint frame in A's joint frame (unit quaternion).
    pub target_rot: [f32; 4],
    /// Feedforward relative angular velocity in A's joint frame (rad/s).
    pub target_vel: [f32; 3],
    /// TGS-Soft PD stiffness and damping ratio.
    pub softness: Softness,
    /// Maximum isotropic torque magnitude.
    pub max_torque: f32,
}

impl AngularDrive3D {
    pub fn position(target_rot: [f32; 4], softness: Softness, max_torque: f32) -> Self {
        Self {
            target_rot: quat_norm(target_rot),
            target_vel: ZERO3,
            softness,
            max_torque,
        }
    }
}

/// Breakable 6-DOF rigid weld (hoods, doors, wheels, structural beams).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FixedJoint {
    /// Target relative orientation `q_a^-1 * q_b`.
    pub rel_rot: [f32; 4],
    pub linear_softness: Softness,
    pub angular_softness: Softness,
}

impl Default for FixedJoint {
    fn default() -> Self {
        Self {
            rel_rot: ID_QUAT,
            linear_softness: Softness::RIGID,
            angular_softness: Softness::RIGID,
        }
    }
}

/// 1-DOF revolute hinge (doors, wheels, knees, elbows).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HingeJoint {
    /// Local hinge axis on body A (normalized).
    pub axis_a: [f32; 3],
    /// Local hinge axis on body B (normalized).
    pub axis_b: [f32; 3],
    /// Local zero-angle reference vector perpendicular to `axis_a` on A (auto-picked if zero).
    pub ref_a: [f32; 3],
    /// Local zero-angle reference vector perpendicular to `axis_b` on B (auto-picked if zero).
    pub ref_b: [f32; 3],
    pub limits: Option<Limits1D>,
    pub motor: Motor1D,
    pub softness: Softness,
}

impl HingeJoint {
    pub fn new(axis_a: [f32; 3], axis_b: [f32; 3]) -> Self {
        let aa = v_unit_or(axis_a, [0.0, 1.0, 0.0]);
        let ab = v_unit_or(axis_b, [0.0, 1.0, 0.0]);
        Self {
            axis_a: aa,
            axis_b: ab,
            ref_a: ortho_basis(aa).0,
            ref_b: ortho_basis(ab).0,
            limits: None,
            motor: Motor1D::default(),
            softness: Softness::RIGID,
        }
    }
}

/// 3-DOF ball-and-socket / SwingTwist joint (shoulders, hips, neck, spine, pendulums).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BallJoint {
    /// Local joint frame on A (local `+X` = twist axis, `+Y/+Z` = elliptical swing axes).
    pub frame_a: [f32; 4],
    /// Local joint frame on B (local `+X` = twist axis, `+Y/+Z` = elliptical swing axes).
    pub frame_b: [f32; 4],
    /// Optional elliptical swing cone half-angles `[max_swing_y, max_swing_z]` in radians `(0, PI)`.
    pub swing_cone: Option<[f32; 2]>,
    /// Optional twist angle range `[twist_min, twist_max]` in radians.
    pub twist_limits: Option<Limits1D>,
    /// Optional 3-axis implicit TGS-Soft PD muscle drive.
    pub drive: Option<AngularDrive3D>,
    pub softness: Softness,
}

impl Default for BallJoint {
    fn default() -> Self {
        Self {
            frame_a: ID_QUAT,
            frame_b: ID_QUAT,
            swing_cone: None,
            twist_limits: None,
            drive: None,
            softness: Softness::RIGID,
        }
    }
}

/// 1-DOF prismatic slider (cranes, pistons, blade-stab prismatic binding).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SliderJoint {
    /// Local translation axis on body A (normalized).
    pub axis_a: [f32; 3],
    /// Locked relative orientation `q_a^-1 * q_b`.
    pub rel_rot: [f32; 4],
    /// Optional slide range `[min, max]` in cells along `axis_a`.
    pub limits: Option<Limits1D>,
    /// Dry Coulomb sliding friction force (>= 0).
    pub friction: f32,
    pub motor: Motor1D,
    pub softness: Softness,
}

impl SliderJoint {
    pub fn new(axis_a: [f32; 3]) -> Self {
        Self {
            axis_a: v_unit_or(axis_a, [1.0, 0.0, 0.0]),
            rel_rot: ID_QUAT,
            limits: None,
            friction: 0.0,
            motor: Motor1D::default(),
            softness: Softness::RIGID,
        }
    }
}

/// Distance / unilateral Rope / Cable / motorized Winch constraint.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DistanceJoint {
    /// Minimum allowed anchor separation (`0.0` for unilateral slack ropes/cables).
    pub min_dist: f32,
    /// Maximum allowed anchor separation (taut cable length).
    pub max_dist: f32,
    /// Winch reeling speed in cells/s: positive reels IN (shortens `max_dist`), negative pays OUT.
    pub winch_speed: f32,
    /// Lower clamp for `max_dist` when reeling in.
    pub winch_min_dist: f32,
    /// Upper clamp for `max_dist` when paying out.
    pub winch_max_dist: f32,
    /// Optional maximum tension force the winch/cable motor will exert (`f32::INFINITY` = full cable).
    pub winch_max_force: f32,
    pub softness: Softness,
}

impl DistanceJoint {
    /// Unilateral rope/cable: goes completely slack when `dist < max_dist`.
    pub const fn rope(max_dist: f32) -> Self {
        Self {
            min_dist: 0.0,
            max_dist,
            winch_speed: 0.0,
            winch_min_dist: 0.0,
            winch_max_dist: f32::INFINITY,
            winch_max_force: f32::INFINITY,
            softness: Softness::CABLE,
        }
    }

    /// Motorized winch reeling `max_dist` in (`winch_speed > 0`) or out (`winch_speed < 0`).
    pub const fn winch(max_dist: f32, winch_speed: f32, winch_min_dist: f32) -> Self {
        Self {
            min_dist: 0.0,
            max_dist,
            winch_speed,
            winch_min_dist,
            winch_max_dist: f32::INFINITY,
            winch_max_force: f32::INFINITY,
            softness: Softness::CABLE,
        }
    }

    /// Rigid/compliant rod holding fixed separation `dist`.
    pub const fn rod(dist: f32) -> Self {
        Self {
            min_dist: dist,
            max_dist: dist,
            winch_speed: 0.0,
            winch_min_dist: dist,
            winch_max_dist: dist,
            winch_max_force: f32::INFINITY,
            softness: Softness::RIGID,
        }
    }
}

/// 6-DOF implicit soft linear + angular PD spring-damper with capped effort (melee hands, weapons).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Spring6DofJoint {
    /// Target relative orientation `q_a^-1 * q_b`.
    pub rel_rot: [f32; 4],
    /// Per-axis linear softness in A's local frame (`hz <= 0` disables that axis).
    pub linear_softness: [Softness; 3],
    /// Per-axis angular softness in A's local frame (`hz <= 0` disables that axis).
    pub angular_softness: [Softness; 3],
    /// Isotropic maximum linear force magnitude.
    pub max_force: f32,
    /// Isotropic maximum angular torque magnitude.
    pub max_torque: f32,
}

impl Spring6DofJoint {
    pub const fn isotropic(
        linear: Softness,
        angular: Softness,
        max_force: f32,
        max_torque: f32,
    ) -> Self {
        Self {
            rel_rot: ID_QUAT,
            linear_softness: [linear, linear, linear],
            angular_softness: [angular, angular, angular],
            max_force,
            max_torque,
        }
    }
}

/// Supported 6-DOF constraint families.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum JointKind {
    Fixed(FixedJoint),
    Hinge(HingeJoint),
    Ball(BallJoint),
    Slider(SliderJoint),
    Distance(DistanceJoint),
    Spring6Dof(Spring6DofJoint),
}

/// Event emitted when a joint snaps from excessive force or torque.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum JointEvent {
    Broken { id: u32, impulse: f32 },
}

/// Solver iteration & warm-starting configuration.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SolverConfig {
    /// Number of TGS-Soft substeps per `step_bodies` call (default `1` at 120 Hz).
    pub substeps: u32,
    /// Number of Gauss-Seidel velocity iterations per substep (4–8 recommended; default `6`).
    pub velocity_iters: u32,
    /// Number of XPBD soft position-projection iterations after position integration (default `2`).
    pub position_iters: u32,
    /// Number of zero-bias velocity relaxation passes after position integration (default `1`).
    pub relaxation_iters: u32,
    /// Warm-start impulse retention factor (default `0.85`).
    pub warm_start_factor: f32,
    /// Maximum position-projection linear step per iteration in cells (guardrail against spikes).
    pub max_pos_correction: f32,
    /// Maximum position-projection angular step per iteration in radians.
    pub max_ang_correction: f32,
    /// Linear error deadband (cells) below which XPBD position projection stays inactive so it does
    /// not fight TGS-Soft's elastic equilibrium or pump potential energy into smooth pendulums.
    pub pos_slop: f32,
    /// Angular error deadband (radians) for XPBD position projection.
    pub ang_slop: f32,
}

impl Default for SolverConfig {
    fn default() -> Self {
        Self {
            substeps: 1,
            velocity_iters: 6,
            position_iters: 2,
            relaxation_iters: 1,
            warm_start_factor: 0.85,
            max_pos_correction: 2.0,
            max_ang_correction: 0.5,
            pos_slop: 0.008,
            ang_slop: 0.008,
        }
    }
}

/// Persistent warm-start impulse cache for a single joint.
#[derive(Clone, Copy, Debug, Default)]
struct ImpulseCache {
    lin: V3,
    ang: V3,
    limit_lo: f32,
    limit_hi: f32,
    motor: f32,
    friction: f32,
    swing_limit: f32,
    twist_lo: f32,
    twist_hi: f32,
    drive: V3,
    /// Continuous unwrapped hinge angle for multi-turn / wide limit tracking.
    hinge_angle: f32,
    hinge_angle_init: bool,
}

impl ImpulseCache {
    fn scale_all(&mut self, s: f32) {
        self.lin = v_scale(self.lin, s);
        self.ang = v_scale(self.ang, s);
        self.limit_lo *= s;
        self.limit_hi *= s;
        self.motor *= s;
        self.friction *= s;
        self.swing_limit *= s;
        self.twist_lo *= s;
        self.twist_hi *= s;
        self.drive = v_scale(self.drive, s);
    }

    fn zero_impulses(&mut self) {
        self.lin = ZERO3;
        self.ang = ZERO3;
        self.limit_lo = 0.0;
        self.limit_hi = 0.0;
        self.motor = 0.0;
        self.friction = 0.0;
        self.swing_limit = 0.0;
        self.twist_lo = 0.0;
        self.twist_hi = 0.0;
        self.drive = ZERO3;
    }
}

/// One constraint linking `body_a` and `body_b` (`0` = static world).
#[derive(Clone, Debug)]
pub struct Joint {
    pub id: u32,
    pub body_a: u32,
    pub body_b: u32,
    /// Anchor offset in body A's local frame (or world coordinates when `body_a == 0`).
    pub local_a: [f32; 3],
    /// Anchor offset in body B's local frame (or world coordinates when `body_b == 0`).
    pub local_b: [f32; 3],
    /// Optional voxel backing for endpoint A.
    pub anchor_a: VoxelAnchor,
    /// Optional voxel backing for endpoint B.
    pub anchor_b: VoxelAnchor,
    pub kind: JointKind,
    /// Maximum sustained linear force before snapping (`f32::INFINITY` = unbreakable).
    pub break_force: f32,
    /// Maximum sustained angular torque before snapping (`f32::INFINITY` = unbreakable).
    pub break_torque: f32,
    pub broken: bool,
    cache: ImpulseCache,
}

impl Joint {
    /// Creates a new joint with default unbreakable thresholds and free voxel anchors.
    pub fn new(
        body_a: u32,
        body_b: u32,
        local_a: [f32; 3],
        local_b: [f32; 3],
        kind: JointKind,
    ) -> Self {
        Self {
            id: 0,
            body_a,
            body_b,
            local_a,
            local_b,
            anchor_a: VoxelAnchor::free(),
            anchor_b: VoxelAnchor::free(),
            kind,
            break_force: f32::INFINITY,
            break_torque: f32::INFINITY,
            broken: false,
            cache: ImpulseCache::default(),
        }
    }

    pub fn fixed(body_a: u32, body_b: u32, local_a: [f32; 3], local_b: [f32; 3], cfg: FixedJoint) -> Self {
        Self::new(body_a, body_b, local_a, local_b, JointKind::Fixed(cfg))
    }

    pub fn hinge(body_a: u32, body_b: u32, local_a: [f32; 3], local_b: [f32; 3], cfg: HingeJoint) -> Self {
        Self::new(body_a, body_b, local_a, local_b, JointKind::Hinge(cfg))
    }

    pub fn ball(body_a: u32, body_b: u32, local_a: [f32; 3], local_b: [f32; 3], cfg: BallJoint) -> Self {
        Self::new(body_a, body_b, local_a, local_b, JointKind::Ball(cfg))
    }

    /// Alias for [`Joint::ball`] emphasizing SwingTwist ragdoll usage.
    pub fn swing_twist(body_a: u32, body_b: u32, local_a: [f32; 3], local_b: [f32; 3], cfg: BallJoint) -> Self {
        Self::ball(body_a, body_b, local_a, local_b, cfg)
    }

    pub fn slider(body_a: u32, body_b: u32, local_a: [f32; 3], local_b: [f32; 3], cfg: SliderJoint) -> Self {
        Self::new(body_a, body_b, local_a, local_b, JointKind::Slider(cfg))
    }

    /// Alias for [`Joint::slider`] emphasizing prismatic binding usage.
    pub fn prismatic(body_a: u32, body_b: u32, local_a: [f32; 3], local_b: [f32; 3], cfg: SliderJoint) -> Self {
        Self::slider(body_a, body_b, local_a, local_b, cfg)
    }

    pub fn distance(body_a: u32, body_b: u32, local_a: [f32; 3], local_b: [f32; 3], cfg: DistanceJoint) -> Self {
        Self::new(body_a, body_b, local_a, local_b, JointKind::Distance(cfg))
    }

    pub fn rope(body_a: u32, body_b: u32, local_a: [f32; 3], local_b: [f32; 3], max_dist: f32) -> Self {
        Self::distance(body_a, body_b, local_a, local_b, DistanceJoint::rope(max_dist))
    }

    pub fn winch(
        body_a: u32,
        body_b: u32,
        local_a: [f32; 3],
        local_b: [f32; 3],
        max_dist: f32,
        winch_speed: f32,
        winch_min_dist: f32,
    ) -> Self {
        Self::distance(
            body_a,
            body_b,
            local_a,
            local_b,
            DistanceJoint::winch(max_dist, winch_speed, winch_min_dist),
        )
    }

    pub fn spring_6dof(
        body_a: u32,
        body_b: u32,
        local_a: [f32; 3],
        local_b: [f32; 3],
        cfg: Spring6DofJoint,
    ) -> Self {
        Self::new(body_a, body_b, local_a, local_b, JointKind::Spring6Dof(cfg))
    }

    pub fn with_anchors(mut self, anchor_a: VoxelAnchor, anchor_b: VoxelAnchor) -> Self {
        self.anchor_a = anchor_a;
        self.anchor_b = anchor_b;
        self
    }

    pub fn with_break(mut self, break_force: f32, break_torque: f32) -> Self {
        self.break_force = break_force;
        self.break_torque = break_torque;
        self
    }
}

// ── Per-step prepared constraint data (zero-allocation reuse) ───────────────

const NO_SLOT: usize = usize::MAX;

#[derive(Clone, Copy, Debug)]
struct PreparedCommon {
    joint_idx: usize,
    slot_a: usize,
    slot_b: usize,
    inv_ma: f32,
    inv_mb: f32,
    ia: M3,
    ib: M3,
    ra: V3,
    rb: V3,
}

#[derive(Clone, Copy, Debug)]
enum PreparedKind {
    Fixed {
        lin_err: V3,
        lin_eff: M3,
        lin_soft: SoftCoeffs,
        ang_err: V3,
        ang_eff: M3,
        ang_soft: SoftCoeffs,
    },
    Hinge {
        lin_err: V3,
        lin_eff: M3,
        lin_soft: SoftCoeffs,
        t1: V3,
        t2: V3,
        align_err: [f32; 2],
        align_eff: (f32, f32, f32),
        align_soft: SoftCoeffs,
        axis: V3,
        axis_eff: f32,
        /// Coupled Schur-complement effective rotational inertia about the pinned hinge axis
        /// (incorporates parallel-axis `m * r^2` so offset-COM PD motors stay critically damped).
        motor_eff: f32,
        angle: f32,
        limits: Option<Limits1D>,
        motor: Motor1D,
        motor_soft: SoftCoeffs,
    },
    Ball {
        lin_err: V3,
        lin_eff: M3,
        lin_soft: SoftCoeffs,
        has_swing: bool,
        swing_axis: V3,
        swing_err: f32,
        swing_eff: f32,
        has_twist: bool,
        twist_axis: V3,
        twist_angle: f32,
        twist_eff: f32,
        twist_limits: Option<Limits1D>,
        has_drive: bool,
        drive_err: V3,
        drive_target_vel: V3,
        drive_eff: M3,
        drive_soft: SoftCoeffs,
        drive_max_imp: f32,
    },
    Slider {
        ra_eff: V3,
        axis: V3,
        t1: V3,
        t2: V3,
        perp_err: [f32; 2],
        perp_eff: (f32, f32, f32),
        perp_soft: SoftCoeffs,
        ang_err: V3,
        ang_eff: M3,
        ang_soft: SoftCoeffs,
        slide_pos: f32,
        slide_eff: f32,
        limits: Option<Limits1D>,
        friction_max_imp: f32,
        motor: Motor1D,
        motor_soft: SoftCoeffs,
    },
    Distance {
        axis: V3,
        dist: f32,
        eff_mass: f32,
        min_dist: f32,
        max_dist: f32,
        /// Target relative velocity along `axis` for the upper bound (`-effective_winch_speed`).
        max_target_vel: f32,
        max_tension_imp: f32,
        soft: SoftCoeffs,
        is_rod: bool,
        /// Precomputed `I_a^-1 (r_a × n)` and `I_b^-1 (r_b × n)` for SIMD batching.
        i_rxa: V3,
        i_rxb: V3,
    },
    Spring6Dof {
        axes: [V3; 3],
        lin_err: [f32; 3],
        lin_eff: [f32; 3],
        lin_soft: [SoftCoeffs; 3],
        lin_active: [bool; 3],
        ang_err: [f32; 3],
        ang_eff: [f32; 3],
        ang_soft: [SoftCoeffs; 3],
        ang_active: [bool; 3],
        max_lin_imp: f32,
        max_ang_imp: f32,
    },
}

#[derive(Clone, Copy, Debug)]
struct PreparedJoint {
    common: PreparedCommon,
    kind: PreparedKind,
}

// ── JointSet solver ─────────────────────────────────────────────────────────

/// Collection of 6-DOF joints, motors, ropes, and winches with persistent warm-starting,
/// Teardown-style voxel anchor invalidation, and reusable solver scratch buffers.
pub struct JointSet {
    joints: Vec<Joint>,
    next_id: u32,
    prev_dt: f32,
    // Reusable scratch state (zero allocations after warmup).
    flat_slots: Vec<u32>,
    flat_dirty: Vec<usize>,
    overflow_slots: IdMap<usize>,
    prepared: Vec<PreparedJoint>,
    /// Indices into `prepared` for Distance joints eligible for 4-wide SIMD batching.
    dist_batch_quads: Vec<[usize; 4]>,
    /// Mask of `prepared` indices handled inside `dist_batch_quads`.
    dist_in_quad: Vec<bool>,
}

impl Default for JointSet {
    fn default() -> Self {
        Self::new()
    }
}

impl JointSet {
    pub fn new() -> Self {
        Self {
            joints: Vec::new(),
            next_id: 1,
            prev_dt: 0.0,
            flat_slots: vec![0; FLAT_ID_LIMIT],
            flat_dirty: Vec::new(),
            overflow_slots: IdMap::default(),
            prepared: Vec::new(),
            dist_batch_quads: Vec::new(),
            dist_in_quad: Vec::new(),
        }
    }

    /// Adds a joint, assigns a unique non-zero ID, and returns that ID.
    pub fn add(&mut self, mut joint: Joint) -> u32 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        joint.id = id;
        self.joints.push(joint);
        id
    }

    /// Removes a joint by ID. Returns true if it existed.
    pub fn remove(&mut self, id: u32) -> bool {
        if let Some(pos) = self.joints.iter().position(|j| j.id == id) {
            self.joints.remove(pos);
            true
        } else {
            false
        }
    }

    /// Removes all broken joints from the set.
    pub fn prune_broken(&mut self) {
        self.joints.retain(|j| !j.broken);
    }

    pub fn get(&self, id: u32) -> Option<&Joint> {
        self.joints.iter().find(|j| j.id == id)
    }

    pub fn get_mut(&mut self, id: u32) -> Option<&mut Joint> {
        self.joints.iter_mut().find(|j| j.id == id)
    }

    pub fn joints(&self) -> &[Joint] {
        &self.joints
    }

    pub fn active_count(&self) -> usize {
        self.joints.iter().filter(|j| !j.broken).count()
    }

    /// Teardown-style world voxel anchor invalidation.
    /// Any active joint whose `anchor_a` or `anchor_b` is a `WorldCell` where `!is_solid(cell)`
    /// snaps immediately. Returns the snapped joint IDs in deterministic order.
    pub fn invalidate_world_cells(&mut self, is_solid: impl Fn([i32; 3]) -> bool) -> Vec<u32> {
        let mut snapped = Vec::new();
        for joint in &mut self.joints {
            if joint.broken {
                continue;
            }
            let a_dead = matches!(joint.anchor_a.kind, VoxelAnchorKind::WorldCell(c) if !is_solid(c));
            let b_dead = matches!(joint.anchor_b.kind, VoxelAnchorKind::WorldCell(c) if !is_solid(c));
            if a_dead || b_dead {
                joint.broken = true;
                joint.cache.zero_impulses();
                snapped.push(joint.id);
            }
        }
        snapped
    }

    /// Teardown-style dynamic body voxel anchor invalidation.
    /// Any active joint whose `anchor_a` or `anchor_b` references `BodyCell { body_id, cell }`
    /// with matching `body_id` where `!is_solid(cell)` snaps immediately.
    /// Returns the snapped joint IDs in deterministic order.
    pub fn invalidate_body_cells(
        &mut self,
        body_id: u32,
        is_solid: impl Fn([usize; 3]) -> bool,
    ) -> Vec<u32> {
        let mut snapped = Vec::new();
        for joint in &mut self.joints {
            if joint.broken {
                continue;
            }
            let a_dead = matches!(
                joint.anchor_a.kind,
                VoxelAnchorKind::BodyCell { body_id: bid, cell } if bid == body_id && !is_solid(cell)
            );
            let b_dead = matches!(
                joint.anchor_b.kind,
                VoxelAnchorKind::BodyCell { body_id: bid, cell } if bid == body_id && !is_solid(cell)
            );
            if a_dead || b_dead {
                joint.broken = true;
                joint.cache.zero_impulses();
                snapped.push(joint.id);
            }
        }
        snapped
    }

    fn build_body_map(&mut self, bodies: &[SolverBody]) {
        for &idx in &self.flat_dirty {
            self.flat_slots[idx] = 0;
        }
        self.flat_dirty.clear();
        self.overflow_slots.clear();
        for (slot, b) in bodies.iter().enumerate() {
            if b.id == 0 {
                continue;
            }
            let uid = b.id as usize;
            if uid < FLAT_ID_LIMIT {
                if self.flat_slots[uid] == 0 {
                    self.flat_dirty.push(uid);
                }
                self.flat_slots[uid] = (slot + 1) as u32;
            } else {
                self.overflow_slots.insert(b.id, slot);
            }
        }
    }

    #[inline]
    fn lookup_slot(&self, body_id: u32) -> usize {
        if body_id == 0 {
            return NO_SLOT;
        }
        let uid = body_id as usize;
        if uid < FLAT_ID_LIMIT {
            let v = self.flat_slots[uid];
            if v == 0 { NO_SLOT } else { (v - 1) as usize }
        } else {
            self.overflow_slots.get(&body_id).copied().unwrap_or(NO_SLOT)
        }
    }

    #[inline]
    fn read_body(bodies: &[SolverBody], slot: usize) -> SolverBody {
        if slot == NO_SLOT {
            SolverBody::static_world()
        } else {
            bodies[slot]
        }
    }

    /// Runs a complete TGS-Soft physics step (gravity + warm-started velocity solve +
    /// position integration + XPBD position projection + zero-bias velocity relaxation + break checks).
    pub fn step_bodies(
        &mut self,
        bodies: &mut [SolverBody],
        gravity: [f32; 3],
        dt: f32,
        config: &SolverConfig,
    ) -> Vec<JointEvent> {
        let mut events = Vec::new();
        if dt <= 0.0 {
            return events;
        }
        let substeps = config.substeps.max(1);
        let h = dt / substeps as f32;
        for _ in 0..substeps {
            for b in bodies.iter_mut() {
                b.integrate_forces(gravity, h);
            }
            self.prepare_and_warm_start(bodies, h, config);
            for iter in 0..config.velocity_iters {
                self.solve_velocity_iteration(bodies, h, true, iter % 2 == 1);
            }
            for b in bodies.iter_mut() {
                b.integrate_positions(h);
            }
            if config.position_iters > 0 {
                self.solve_positions_internal(bodies, h, config);
            }
            if config.relaxation_iters > 0 {
                self.prepare_only(bodies, h, false);
                for iter in 0..config.relaxation_iters {
                    self.relax_velocity_iteration(bodies, iter % 2 == 1);
                }
            }
            self.evaluate_breaks(h, &mut events);
        }
        events
    }

    /// Velocity-phase entry point for integration into an external solver loop like `Bodies::step()`.
    /// Call before integrating `pos`/`rot`, then call [`JointSet::solve_positions`] after integrating.
    pub fn solve_velocities(
        &mut self,
        bodies: &mut [SolverBody],
        dt: f32,
        config: &SolverConfig,
    ) -> Vec<JointEvent> {
        let mut events = Vec::new();
        if dt <= 0.0 {
            return events;
        }
        self.prepare_and_warm_start(bodies, dt, config);
        for iter in 0..config.velocity_iters {
            self.solve_velocity_iteration(bodies, dt, true, iter % 2 == 1);
        }
        self.evaluate_breaks(dt, &mut events);
        events
    }

    /// Post-integration XPBD soft position projection + optional zero-bias velocity relaxation.
    pub fn solve_positions(
        &mut self,
        bodies: &mut [SolverBody],
        dt: f32,
        config: &SolverConfig,
    ) {
        if dt <= 0.0 {
            return;
        }
        self.build_body_map(bodies);
        if config.position_iters > 0 {
            self.solve_positions_internal(bodies, dt, config);
        }
        if config.relaxation_iters > 0 {
            // Re-prepare geometric lever arms at the new positions without advancing winches.
            self.prepare_only(bodies, dt, false);
            for iter in 0..config.relaxation_iters {
                self.relax_velocity_iteration(bodies, iter % 2 == 1);
            }
        }
    }

    fn wake_connected(&self, bodies: &mut [SolverBody]) {
        // Propagate waking across active joints (handles chains cleanly in bounded passes).
        for _ in 0..4 {
            let mut woke_any = false;
            for j in &self.joints {
                if j.broken {
                    continue;
                }
                let sa = self.lookup_slot(j.body_a);
                let sb = self.lookup_slot(j.body_b);
                let has_active_drive = match j.kind {
                    JointKind::Hinge(h) => h.motor.enabled && h.motor.max_effort > 0.0,
                    JointKind::Ball(b) => b.drive.is_some_and(|d| d.max_torque > 0.0),
                    JointKind::Slider(s) => s.motor.enabled && s.motor.max_effort > 0.0,
                    JointKind::Distance(d) => d.winch_speed.abs() > 0.0,
                    JointKind::Spring6Dof(s) => s.max_force > 0.0 || s.max_torque > 0.0,
                    JointKind::Fixed(_) => false,
                };
                let a_dyn = sa != NO_SLOT && !bodies[sa].is_static();
                let b_dyn = sb != NO_SLOT && !bodies[sb].is_static();
                let a_awake = a_dyn && !bodies[sa].asleep;
                let b_awake = b_dyn && !bodies[sb].asleep;
                if a_dyn && bodies[sa].asleep && (b_awake || has_active_drive) {
                    bodies[sa].asleep = false;
                    woke_any = true;
                }
                if b_dyn && bodies[sb].asleep && (a_awake || has_active_drive) {
                    bodies[sb].asleep = false;
                    woke_any = true;
                }
            }
            if !woke_any {
                break;
            }
        }
    }

    fn prepare_only(&mut self, bodies: &[SolverBody], h: f32, advance_winch: bool) {
        self.prepared.clear();
        self.dist_batch_quads.clear();
        self.dist_in_quad.clear();

        // Pre-pass: gather active joint anchor transforms in 4-wide SIMD chunks (`quat_rotate4`).
        let mut active_indices: Vec<(usize, usize, usize)> = Vec::with_capacity(self.joints.len());
        for (j_idx, j) in self.joints.iter().enumerate() {
            if j.broken {
                continue;
            }
            let sa = self.lookup_slot(j.body_a);
            let sb = self.lookup_slot(j.body_b);
            let ba = Self::read_body(bodies, sa);
            let bb = Self::read_body(bodies, sb);
            if ba.is_static() && bb.is_static() {
                continue;
            }
            if (ba.is_static() || ba.asleep) && (bb.is_static() || bb.asleep) {
                continue;
            }
            active_indices.push((j_idx, sa, sb));
        }

        let n_active = active_indices.len();
        let mut ra_list = vec![ZERO3; n_active];
        let mut rb_list = vec![ZERO3; n_active];
        let mut k = 0;
        while k + 4 <= n_active {
            let mut qax = [0.0; 4];
            let mut qay = [0.0; 4];
            let mut qaz = [0.0; 4];
            let mut qaw = [1.0; 4];
            let mut lax = [0.0; 4];
            let mut lay = [0.0; 4];
            let mut laz = [0.0; 4];
            let mut qbx = [0.0; 4];
            let mut qby = [0.0; 4];
            let mut qbz = [0.0; 4];
            let mut qbw = [1.0; 4];
            let mut lbx = [0.0; 4];
            let mut lby = [0.0; 4];
            let mut lbz = [0.0; 4];
            for lane in 0..4 {
                let (j_idx, sa, sb) = active_indices[k + lane];
                let j = &self.joints[j_idx];
                let ba = Self::read_body(bodies, sa);
                let bb = Self::read_body(bodies, sb);
                qax[lane] = ba.rot[0];
                qay[lane] = ba.rot[1];
                qaz[lane] = ba.rot[2];
                qaw[lane] = ba.rot[3];
                lax[lane] = j.local_a[0];
                lay[lane] = j.local_a[1];
                laz[lane] = j.local_a[2];
                qbx[lane] = bb.rot[0];
                qby[lane] = bb.rot[1];
                qbz[lane] = bb.rot[2];
                qbw[lane] = bb.rot[3];
                lbx[lane] = j.local_b[0];
                lby[lane] = j.local_b[1];
                lbz[lane] = j.local_b[2];
            }
            let (rax, ray, raz) = quat_rotate4(qax, qay, qaz, qaw, lax, lay, laz);
            let (rbx, rby, rbz) = quat_rotate4(qbx, qby, qbz, qbw, lbx, lby, lbz);
            for lane in 0..4 {
                ra_list[k + lane] = [rax[lane], ray[lane], raz[lane]];
                rb_list[k + lane] = [rbx[lane], rby[lane], rbz[lane]];
            }
            k += 4;
        }
        while k < n_active {
            let (j_idx, sa, sb) = active_indices[k];
            let j = &self.joints[j_idx];
            let ba = Self::read_body(bodies, sa);
            let bb = Self::read_body(bodies, sb);
            ra_list[k] = quat_rotate(ba.rot, j.local_a);
            rb_list[k] = quat_rotate(bb.rot, j.local_b);
            k += 1;
        }

        for idx in 0..n_active {
            let (j_idx, sa, sb) = active_indices[idx];
            let ba = Self::read_body(bodies, sa);
            let bb = Self::read_body(bodies, sb);
            let inv_ma = if ba.is_static() { 0.0 } else { ba.inv_mass };
            let inv_mb = if bb.is_static() { 0.0 } else { bb.inv_mass };
            let ia = if ba.is_static() { ZERO_M3 } else { ba.inv_inertia_world };
            let ib = if bb.is_static() { ZERO_M3 } else { bb.inv_inertia_world };
            let ra = ra_list[idx];
            let rb = rb_list[idx];
            let pa = v_add(ba.pos, ra);
            let pb = v_add(bb.pos, rb);
            let d = v_sub(pb, pa);

            let common = PreparedCommon {
                joint_idx: j_idx,
                slot_a: sa,
                slot_b: sb,
                inv_ma,
                inv_mb,
                ia,
                ib,
                ra,
                rb,
            };

            let kind = match self.joints[j_idx].kind {
                JointKind::Fixed(cfg) => {
                    let k_lin = point_k_matrix(inv_ma + inv_mb, ra, &ia, rb, &ib);
                    let k_ang = m3_add(&ia, &ib);
                    let q_target = quat_mul(ba.rot, quat_norm(cfg.rel_rot));
                    let ang_err = quat_error_vec(bb.rot, q_target);
                    PreparedKind::Fixed {
                        lin_err: d,
                        lin_eff: m3_inv(&k_lin),
                        lin_soft: cfg.linear_softness.coeffs(h),
                        ang_err,
                        ang_eff: m3_inv(&k_ang),
                        ang_soft: cfg.angular_softness.coeffs(h),
                    }
                }
                JointKind::Hinge(cfg) => {
                    let k_lin = point_k_matrix(inv_ma + inv_mb, ra, &ia, rb, &ib);
                    let a1 = v_unit_or(quat_rotate(ba.rot, cfg.axis_a), [0.0, 1.0, 0.0]);
                    let a2 = v_unit_or(quat_rotate(bb.rot, cfg.axis_b), a1);
                    let (t1, t2) = ortho_basis(a1);
                    let raw_cross = v_cross(a1, a2);
                    let sin_t = v_len(raw_cross);
                    let cos_t = v_dot(a1, a2);
                    let align_vec = if sin_t > 1e-6 {
                        v_scale(raw_cross, sin_t.atan2(cos_t) / sin_t)
                    } else if cos_t < 0.0 {
                        // 180-degree antiparallel fallback.
                        v_scale(t1, PI)
                    } else {
                        raw_cross
                    };
                    let align_err = [v_dot(align_vec, t1), v_dot(align_vec, t2)];
                    let ia_ib = m3_add(&ia, &ib);
                    let m00 = v_dot(t1, m3_mul_v(&ia_ib, t1));
                    let m01 = v_dot(t1, m3_mul_v(&ia_ib, t2));
                    let m11 = v_dot(t2, m3_mul_v(&ia_ib, t2));
                    let align_eff = sym2_inv(m00, m01, m11);

                    let ua = ortho_perp(a1, quat_rotate(ba.rot, cfg.ref_a));
                    let va = v_cross(a1, ua);
                    let ub = ortho_perp(a2, quat_rotate(bb.rot, cfg.ref_b));
                    let raw_angle = v_dot(ub, va).atan2(v_dot(ub, ua));
                    let cache = &mut self.joints[j_idx].cache;
                    let angle = if cache.hinge_angle_init {
                        cache.hinge_angle + wrap_pi(raw_angle - cache.hinge_angle)
                    } else {
                        cache.hinge_angle_init = true;
                        raw_angle
                    };
                    cache.hinge_angle = angle;

                    let lin_eff = m3_inv(&k_lin);
                    let ka = angular_row_k(&ia, &ib, a1);
                    let axis_eff = if ka > 1e-12 { 1.0 / ka } else { 0.0 };
                    // Schur complement of 3-DOF anchor lock gives exact parallel-axis hinge inertia.
                    let kpa = v_add(v_cross(m3_mul_v(&ib, a1), rb), v_cross(m3_mul_v(&ia, a1), ra));
                    let ka_coupled = (ka - v_dot(kpa, m3_mul_v(&lin_eff, kpa))).max(ka * 1e-4);
                    let motor_eff = if ka_coupled > 1e-12 { 1.0 / ka_coupled } else { axis_eff };
                    let soft = cfg.softness.coeffs(h);
                    PreparedKind::Hinge {
                        lin_err: d,
                        lin_eff,
                        lin_soft: soft,
                        t1,
                        t2,
                        align_err,
                        align_eff,
                        align_soft: soft,
                        axis: a1,
                        axis_eff,
                        motor_eff,
                        angle,
                        limits: cfg.limits,
                        motor: cfg.motor,
                        motor_soft: cfg.motor.stiffness.coeffs(h),
                    }
                }
                JointKind::Ball(cfg) => {
                    let k_lin = point_k_matrix(inv_ma + inv_mb, ra, &ia, rb, &ib);
                    let lin_eff = m3_inv(&k_lin);
                    let lin_soft = cfg.softness.coeffs(h);
                    let qfa = quat_mul(ba.rot, quat_norm(cfg.frame_a));
                    let qfb = quat_mul(bb.rot, quat_norm(cfg.frame_b));
                    let mut qrel = quat_mul(quat_conj(qfa), qfb);
                    if qrel[3] < 0.0 {
                        qrel = [-qrel[0], -qrel[1], -qrel[2], -qrel[3]];
                    }
                    // Exact swing-twist decomposition: qrel = q_swing * q_twist (twist around +X).
                    let twist_len = (qrel[0] * qrel[0] + qrel[3] * qrel[3]).sqrt();
                    let q_twist = if twist_len > 1e-6 {
                        [qrel[0] / twist_len, 0.0, 0.0, qrel[3] / twist_len]
                    } else {
                        ID_QUAT
                    };
                    let q_swing = quat_mul(qrel, quat_conj(q_twist));
                    let twist_angle = 2.0 * q_twist[0].atan2(q_twist[3]);
                    let twist_axis = v_unit_or(quat_rotate(qfb, [1.0, 0.0, 0.0]), [1.0, 0.0, 0.0]);
                    let kt = angular_row_k(&ia, &ib, twist_axis);
                    let twist_eff = if kt > 1e-12 { 1.0 / kt } else { 0.0 };

                    let (has_swing, swing_axis, swing_err, swing_eff) =
                        if let Some([sy_max, sz_max]) = cfg.swing_cone {
                            let sy = q_swing[1];
                            let sz = q_swing[2];
                            let sr = (sy * sy + sz * sz).sqrt();
                            let (ay, az) = if sr > 1e-6 {
                                let ang = 2.0 * sr.atan2(q_swing[3].abs());
                                (ang * sy / sr, ang * sz / sr)
                            } else {
                                (2.0 * sy, 2.0 * sz)
                            };
                            let a = sy_max.max(1e-4);
                            let b = sz_max.max(1e-4);
                            let e_val = (ay / a) * (ay / a) + (az / b) * (az / b);
                            let e_sqrt = e_val.sqrt();
                            if e_sqrt > 1e-6 {
                                let gx = ay / (a * a);
                                let gz = az / (b * b);
                                let gn = (gx * gx + gz * gz).sqrt().max(1e-8);
                                let (ny, nz) = (gx / gn, gz / gn);
                                let err = (1.0 - 1.0 / e_sqrt) * (ay * ny + az * nz);
                                let world_axis =
                                    v_unit_or(quat_rotate(qfa, [0.0, ny, nz]), [0.0, 1.0, 0.0]);
                                let ks = angular_row_k(&ia, &ib, world_axis);
                                (true, world_axis, err, if ks > 1e-12 { 1.0 / ks } else { 0.0 })
                            } else {
                                (false, [0.0, 1.0, 0.0], -a.min(b), 0.0)
                            }
                        } else {
                            (false, [0.0, 1.0, 0.0], 0.0, 0.0)
                        };

                    let (has_drive, drive_err, drive_target_vel, drive_eff, drive_soft, drive_max_imp) =
                        if let Some(drv) = cfg.drive {
                            if drv.max_torque > 0.0 {
                                let q_target = quat_mul(qfa, quat_norm(drv.target_rot));
                                let err = quat_error_vec(qfb, q_target);
                                let tvel = quat_rotate(qfa, drv.target_vel);
                                let k_ang = m3_add(&ia, &ib);
                                // Schur complement of 3-DOF anchor lock for parallel-axis limb inertia.
                                let basis = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
                                let mut kpw = [ZERO3; 3];
                                for j in 0..3 {
                                    kpw[j] = v_add(
                                        v_cross(m3_mul_v(&ib, basis[j]), rb),
                                        v_cross(m3_mul_v(&ia, basis[j]), ra),
                                    );
                                }
                                let mut k_coupled = k_ang;
                                for r in 0..3 {
                                    for c_col in 0..3 {
                                        k_coupled[r][c_col] -=
                                            v_dot(kpw[r], m3_mul_v(&lin_eff, kpw[c_col]));
                                    }
                                }
                                let eff = m3_inv(&k_coupled);
                                let drive_eff = if eff == ZERO_M3 { m3_inv(&k_ang) } else { eff };
                                (
                                    true,
                                    err,
                                    tvel,
                                    drive_eff,
                                    drv.softness.coeffs(h),
                                    drv.max_torque * h,
                                )
                            } else {
                                (false, ZERO3, ZERO3, ZERO_M3, SoftCoeffs::HARD_ZERO_BIAS, 0.0)
                            }
                        } else {
                            (false, ZERO3, ZERO3, ZERO_M3, SoftCoeffs::HARD_ZERO_BIAS, 0.0)
                        };

                    PreparedKind::Ball {
                        lin_err: d,
                        lin_eff,
                        lin_soft,
                        has_swing,
                        swing_axis,
                        swing_err,
                        swing_eff,
                        has_twist: cfg.twist_limits.is_some(),
                        twist_axis,
                        twist_angle,
                        twist_eff,
                        twist_limits: cfg.twist_limits,
                        has_drive,
                        drive_err,
                        drive_target_vel,
                        drive_eff,
                        drive_soft,
                        drive_max_imp,
                    }
                }
                JointKind::Slider(cfg) => {
                    let axis = v_unit_or(quat_rotate(ba.rot, cfg.axis_a), [1.0, 0.0, 0.0]);
                    let (t1, t2) = ortho_basis(axis);
                    // Exact prismatic lever arm on A includes anchor separation d.
                    let ra_eff = v_add(ra, d);
                    let perp_err = [v_dot(d, t1), v_dot(d, t2)];
                    let r1a = v_cross(ra_eff, t1);
                    let r2a = v_cross(ra_eff, t2);
                    let r1b = v_cross(rb, t1);
                    let r2b = v_cross(rb, t2);
                    let ia_r1a = m3_mul_v(&ia, r1a);
                    let ia_r2a = m3_mul_v(&ia, r2a);
                    let ib_r1b = m3_mul_v(&ib, r1b);
                    let ib_r2b = m3_mul_v(&ib, r2b);
                    let m00 = inv_ma + inv_mb + v_dot(r1a, ia_r1a) + v_dot(r1b, ib_r1b);
                    let m01 = v_dot(r1a, ia_r2a) + v_dot(r1b, ib_r2b);
                    let m11 = inv_ma + inv_mb + v_dot(r2a, ia_r2a) + v_dot(r2b, ib_r2b);
                    let perp_eff = sym2_inv(m00, m01, m11);

                    let k_ang = m3_add(&ia, &ib);
                    let q_target = quat_mul(ba.rot, quat_norm(cfg.rel_rot));
                    let ang_err = quat_error_vec(bb.rot, q_target);

                    let slide_pos = v_dot(d, axis);
                    let ks = linear_row_k(inv_ma + inv_mb, ra_eff, &ia, rb, &ib, axis);
                    let slide_eff = if ks > 1e-12 { 1.0 / ks } else { 0.0 };
                    let soft = cfg.softness.coeffs(h);
                    PreparedKind::Slider {
                        ra_eff,
                        axis,
                        t1,
                        t2,
                        perp_err,
                        perp_eff,
                        perp_soft: soft,
                        ang_err,
                        ang_eff: m3_inv(&k_ang),
                        ang_soft: soft,
                        slide_pos,
                        slide_eff,
                        limits: cfg.limits,
                        friction_max_imp: cfg.friction.max(0.0) * h,
                        motor: cfg.motor,
                        motor_soft: cfg.motor.stiffness.coeffs(h),
                    }
                }
                JointKind::Distance(mut cfg) => {
                    // Advance motorized winch length once per step before computing error & velocity bias.
                    let old_max = cfg.max_dist;
                    let mut effective_speed = 0.0;
                    if cfg.winch_speed != 0.0 {
                        let lo = cfg.winch_min_dist.max(cfg.min_dist).max(0.0);
                        let hi = cfg.winch_max_dist.max(lo);
                        let new_max = (old_max - cfg.winch_speed * h).clamp(lo, hi);
                        effective_speed = (old_max - new_max) / h;
                        if advance_winch {
                            cfg.max_dist = new_max;
                            self.joints[j_idx].kind = JointKind::Distance(cfg);
                        }
                    }
                    let dist = v_len(d);
                    let axis = if dist > 1e-6 { v_scale(d, 1.0 / dist) } else { [0.0, 1.0, 0.0] };
                    let rxa = v_cross(ra, axis);
                    let rxb = v_cross(rb, axis);
                    let i_rxa = m3_mul_v(&ia, rxa);
                    let i_rxb = m3_mul_v(&ib, rxb);
                    let k = inv_ma + inv_mb + v_dot(rxa, i_rxa) + v_dot(rxb, i_rxb);
                    let eff_mass = if k > 1e-12 { 1.0 / k } else { 0.0 };
                    let is_rod = (cfg.max_dist - cfg.min_dist).abs() <= 1e-5;
                    let max_tension_imp = if cfg.winch_max_force.is_finite() {
                        cfg.winch_max_force.max(0.0) * h
                    } else {
                        f32::INFINITY
                    };
                    PreparedKind::Distance {
                        axis,
                        dist,
                        eff_mass,
                        min_dist: cfg.min_dist,
                        max_dist: cfg.max_dist,
                        max_target_vel: -effective_speed,
                        max_tension_imp,
                        soft: cfg.softness.coeffs(h),
                        is_rod,
                        i_rxa,
                        i_rxb,
                    }
                }
                JointKind::Spring6Dof(cfg) => {
                    let axes = [
                        quat_rotate(ba.rot, [1.0, 0.0, 0.0]),
                        quat_rotate(ba.rot, [0.0, 1.0, 0.0]),
                        quat_rotate(ba.rot, [0.0, 0.0, 1.0]),
                    ];
                    let q_target = quat_mul(ba.rot, quat_norm(cfg.rel_rot));
                    let ang_err_world = quat_error_vec(bb.rot, q_target);
                    let mut lin_err = [0.0; 3];
                    let mut lin_eff = [0.0; 3];
                    let mut lin_soft = [SoftCoeffs::HARD_ZERO_BIAS; 3];
                    let mut lin_active = [false; 3];
                    let mut ang_err = [0.0; 3];
                    let mut ang_eff = [0.0; 3];
                    let mut ang_soft = [SoftCoeffs::HARD_ZERO_BIAS; 3];
                    let mut ang_active = [false; 3];
                    for i in 0..3 {
                        lin_err[i] = v_dot(d, axes[i]);
                        let kl = linear_row_k(inv_ma + inv_mb, ra, &ia, rb, &ib, axes[i]);
                        lin_eff[i] = if kl > 1e-12 { 1.0 / kl } else { 0.0 };
                        lin_active[i] = cfg.linear_softness[i].hz > 0.0 && cfg.max_force > 0.0;
                        lin_soft[i] = cfg.linear_softness[i].coeffs(h);

                        ang_err[i] = v_dot(ang_err_world, axes[i]);
                        let ka = angular_row_k(&ia, &ib, axes[i]);
                        ang_eff[i] = if ka > 1e-12 { 1.0 / ka } else { 0.0 };
                        ang_active[i] = cfg.angular_softness[i].hz > 0.0 && cfg.max_torque > 0.0;
                        ang_soft[i] = cfg.angular_softness[i].coeffs(h);
                    }
                    PreparedKind::Spring6Dof {
                        axes,
                        lin_err,
                        lin_eff,
                        lin_soft,
                        lin_active,
                        ang_err,
                        ang_eff,
                        ang_soft,
                        ang_active,
                        max_lin_imp: if cfg.max_force.is_finite() {
                            cfg.max_force.max(0.0) * h
                        } else {
                            f32::INFINITY
                        },
                        max_ang_imp: if cfg.max_torque.is_finite() {
                            cfg.max_torque.max(0.0) * h
                        } else {
                            f32::INFINITY
                        },
                    }
                }
            };

            self.prepared.push(PreparedJoint { common, kind });
        }

        // Form disjoint 4-wide SIMD batches for taut/rod Distance joints whose dynamic bodies do not overlap.
        self.dist_in_quad.resize(self.prepared.len(), false);
        self.dist_in_quad.fill(false);
        let mut candidates: Vec<usize> = Vec::new();
        for (pi, p) in self.prepared.iter().enumerate() {
            if let PreparedKind::Distance { is_rod, dist, max_dist, min_dist, .. } = p.kind {
                // Batch rods or strictly taut cables (single-row equations with no lower-limit coupling).
                if is_rod || (min_dist <= 0.0 && dist >= max_dist) {
                    candidates.push(pi);
                }
            }
        }
        let mut used_cand = vec![false; candidates.len()];
        for start in 0..candidates.len() {
            if used_cand[start] {
                continue;
            }
            let mut quad = [0usize; 4];
            let mut quad_cand = [0usize; 4];
            let mut count = 0usize;
            let mut dyn_slots = [NO_SLOT; 8];
            let mut n_slots = 0usize;
            for ci in start..candidates.len() {
                if used_cand[ci] {
                    continue;
                }
                let pi = candidates[ci];
                let c = &self.prepared[pi].common;
                let conflict_a = c.inv_ma > 0.0
                    && c.slot_a != NO_SLOT
                    && dyn_slots[..n_slots].contains(&c.slot_a);
                let conflict_b = c.inv_mb > 0.0
                    && c.slot_b != NO_SLOT
                    && dyn_slots[..n_slots].contains(&c.slot_b);
                if conflict_a || conflict_b {
                    continue;
                }
                quad[count] = pi;
                quad_cand[count] = ci;
                count += 1;
                if c.inv_ma > 0.0 && c.slot_a != NO_SLOT {
                    dyn_slots[n_slots] = c.slot_a;
                    n_slots += 1;
                }
                if c.inv_mb > 0.0 && c.slot_b != NO_SLOT {
                    dyn_slots[n_slots] = c.slot_b;
                    n_slots += 1;
                }
                if count == 4 {
                    break;
                }
            }
            if count == 4 {
                for lane in 0..4 {
                    used_cand[quad_cand[lane]] = true;
                    self.dist_in_quad[quad[lane]] = true;
                }
                self.dist_batch_quads.push(quad);
            }
        }
    }

    fn prepare_and_warm_start(&mut self, bodies: &mut [SolverBody], h: f32, config: &SolverConfig) {
        self.build_body_map(bodies);
        self.wake_connected(bodies);
        self.prepare_only(bodies, h, true);

        let dt_ratio = if self.prev_dt > 1e-6 {
            (h / self.prev_dt).clamp(0.5, 2.0)
        } else {
            1.0
        };
        let ws = config.warm_start_factor.clamp(0.0, 1.0) * dt_ratio;
        self.prev_dt = h;

        for p in &self.prepared {
            let c = &p.common;
            let cache = &mut self.joints[c.joint_idx].cache;
            cache.scale_all(ws);

            // Clear cached unilateral impulses for strictly inactive/slack rows before warm-starting.
            match p.kind {
                PreparedKind::Hinge { angle, limits, .. } => {
                    if let Some(lim) = limits {
                        if angle > lim.min + 1e-4 {
                            cache.limit_lo = 0.0;
                        }
                        if angle < lim.max - 1e-4 {
                            cache.limit_hi = 0.0;
                        }
                    } else {
                        cache.limit_lo = 0.0;
                        cache.limit_hi = 0.0;
                    }
                    apply_linear_impulse(bodies, c, cache.lin);
                    let ang_total = v_add(
                        v_add(v_scale(match p.kind { PreparedKind::Hinge { t1, .. } => t1, _ => ZERO3 }, cache.ang[0]),
                              v_scale(match p.kind { PreparedKind::Hinge { t2, .. } => t2, _ => ZERO3 }, cache.ang[1])),
                        v_scale(
                            match p.kind { PreparedKind::Hinge { axis, .. } => axis, _ => ZERO3 },
                            cache.limit_lo + cache.limit_hi + cache.motor,
                        ),
                    );
                    apply_angular_impulse(bodies, c, ang_total);
                }
                PreparedKind::Fixed { .. } => {
                    apply_linear_impulse(bodies, c, cache.lin);
                    apply_angular_impulse(bodies, c, cache.ang);
                }
                PreparedKind::Ball {
                    has_swing,
                    swing_axis,
                    swing_err,
                    has_twist,
                    twist_axis,
                    twist_angle,
                    twist_limits,
                    has_drive,
                    ..
                } => {
                    if !has_swing || swing_err < -1e-4 {
                        cache.swing_limit = 0.0;
                    }
                    if let (true, Some(lim)) = (has_twist, twist_limits) {
                        if twist_angle > lim.min + 1e-4 {
                            cache.twist_lo = 0.0;
                        }
                        if twist_angle < lim.max - 1e-4 {
                            cache.twist_hi = 0.0;
                        }
                    } else {
                        cache.twist_lo = 0.0;
                        cache.twist_hi = 0.0;
                    }
                    if !has_drive {
                        cache.drive = ZERO3;
                    }
                    apply_linear_impulse(bodies, c, cache.lin);
                    let ang_total = v_add(
                        v_add(
                            v_scale(swing_axis, cache.swing_limit),
                            v_scale(twist_axis, cache.twist_lo + cache.twist_hi),
                        ),
                        cache.drive,
                    );
                    apply_angular_impulse(bodies, c, ang_total);
                }
                PreparedKind::Slider { ra_eff, axis, t1, t2, slide_pos, limits, .. } => {
                    if let Some(lim) = limits {
                        if slide_pos > lim.min + 1e-4 {
                            cache.limit_lo = 0.0;
                        }
                        if slide_pos < lim.max - 1e-4 {
                            cache.limit_hi = 0.0;
                        }
                    } else {
                        cache.limit_lo = 0.0;
                        cache.limit_hi = 0.0;
                    }
                    let lin_total = v_add(
                        v_add(v_scale(t1, cache.lin[0]), v_scale(t2, cache.lin[1])),
                        v_scale(axis, cache.limit_lo + cache.limit_hi + cache.motor + cache.friction),
                    );
                    apply_linear_impulse_arms(bodies, c, ra_eff, c.rb, lin_total);
                    apply_angular_impulse(bodies, c, cache.ang);
                }
                PreparedKind::Distance {
                    axis,
                    dist,
                    min_dist,
                    max_dist,
                    is_rod,
                    ..
                } => {
                    if is_rod {
                        apply_linear_impulse(bodies, c, v_scale(axis, cache.limit_hi));
                    } else {
                        if dist < max_dist - 1e-4 {
                            cache.limit_hi = 0.0;
                        }
                        if min_dist <= 0.0 || dist > min_dist + 1e-4 {
                            cache.limit_lo = 0.0;
                        }
                        apply_linear_impulse(
                            bodies,
                            c,
                            v_scale(axis, cache.limit_hi + cache.limit_lo),
                        );
                    }
                }
                PreparedKind::Spring6Dof { axes, .. } => {
                    let lin_total = v_add(
                        v_add(v_scale(axes[0], cache.lin[0]), v_scale(axes[1], cache.lin[1])),
                        v_scale(axes[2], cache.lin[2]),
                    );
                    let ang_total = v_add(
                        v_add(v_scale(axes[0], cache.ang[0]), v_scale(axes[1], cache.ang[1])),
                        v_scale(axes[2], cache.ang[2]),
                    );
                    apply_linear_impulse(bodies, c, lin_total);
                    apply_angular_impulse(bodies, c, ang_total);
                }
            }
        }
    }

    fn solve_velocity_iteration(
        &mut self,
        bodies: &mut [SolverBody],
        h: f32,
        use_bias: bool,
        reverse: bool,
    ) {
        // 1. Run 4-wide SIMD distance/cable batches first (disjoint dynamic bodies -> zero aliasing).
        for q_idx in 0..self.dist_batch_quads.len() {
            let quad = self.dist_batch_quads[q_idx];
            self.solve_distance_quad_simd(bodies, quad, use_bias);
        }

        // 2. Run Gauss-Seidel sweep across all remaining prepared joints (alternating forward/backward).
        let n = self.prepared.len();
        for step in 0..n {
            let pi = if reverse { n - 1 - step } else { step };
            if self.dist_in_quad[pi] {
                continue;
            }
            let p = self.prepared[pi];
            let c = &p.common;
            let cache = &mut self.joints[c.joint_idx].cache;
            solve_single_joint_velocity(bodies, c, &p.kind, cache, h, use_bias);
        }
    }

    fn solve_distance_quad_simd(
        &mut self,
        bodies: &mut [SolverBody],
        quad: [usize; 4],
        use_bias: bool,
    ) {
        let mut batch = DistanceBatch4 {
            nx: [0.0; 4],
            ny: [0.0; 4],
            nz: [0.0; 4],
            rax: [0.0; 4],
            ray: [0.0; 4],
            raz: [0.0; 4],
            rbx: [0.0; 4],
            rby: [0.0; 4],
            rbz: [0.0; 4],
            i_rxa_x: [0.0; 4],
            i_rxa_y: [0.0; 4],
            i_rxa_z: [0.0; 4],
            i_rxb_x: [0.0; 4],
            i_rxb_y: [0.0; 4],
            i_rxb_z: [0.0; 4],
            inv_ma: [0.0; 4],
            inv_mb: [0.0; 4],
            eff_mass: [0.0; 4],
            bias_rate: [0.0; 4],
            mass_coeff: [1.0; 4],
            impulse_coeff: [0.0; 4],
            error: [0.0; 4],
            target_vel: [0.0; 4],
            lambda_min: [0.0; 4],
            lambda_max: [0.0; 4],
            lambda: [0.0; 4],
        };
        let mut vel = BodyVelBatch4 {
            vax: [0.0; 4],
            vay: [0.0; 4],
            vaz: [0.0; 4],
            wax: [0.0; 4],
            way: [0.0; 4],
            waz: [0.0; 4],
            vbx: [0.0; 4],
            vby: [0.0; 4],
            vbz: [0.0; 4],
            wbx: [0.0; 4],
            wby: [0.0; 4],
            wbz: [0.0; 4],
        };

        for lane in 0..4 {
            let p = &self.prepared[quad[lane]];
            let c = &p.common;
            let ba = Self::read_body(bodies, c.slot_a);
            let bb = Self::read_body(bodies, c.slot_b);
            let PreparedKind::Distance {
                axis,
                dist,
                eff_mass,
                max_dist,
                max_target_vel,
                max_tension_imp,
                soft,
                is_rod,
                i_rxa,
                i_rxb,
                ..
            } = p.kind
            else {
                continue;
            };
            batch.nx[lane] = axis[0];
            batch.ny[lane] = axis[1];
            batch.nz[lane] = axis[2];
            batch.rax[lane] = c.ra[0];
            batch.ray[lane] = c.ra[1];
            batch.raz[lane] = c.ra[2];
            batch.rbx[lane] = c.rb[0];
            batch.rby[lane] = c.rb[1];
            batch.rbz[lane] = c.rb[2];
            batch.i_rxa_x[lane] = i_rxa[0];
            batch.i_rxa_y[lane] = i_rxa[1];
            batch.i_rxa_z[lane] = i_rxa[2];
            batch.i_rxb_x[lane] = i_rxb[0];
            batch.i_rxb_y[lane] = i_rxb[1];
            batch.i_rxb_z[lane] = i_rxb[2];
            batch.inv_ma[lane] = c.inv_ma;
            batch.inv_mb[lane] = c.inv_mb;
            batch.eff_mass[lane] = eff_mass;
            if use_bias {
                batch.bias_rate[lane] = soft.bias_rate;
                batch.mass_coeff[lane] = soft.mass_coeff;
                batch.impulse_coeff[lane] = soft.impulse_coeff;
                batch.error[lane] = dist - max_dist;
            } else {
                batch.bias_rate[lane] = 0.0;
                batch.mass_coeff[lane] = 1.0;
                batch.impulse_coeff[lane] = 0.0;
                batch.error[lane] = 0.0;
            }
            batch.target_vel[lane] = max_target_vel;
            batch.lambda_min[lane] = -max_tension_imp;
            batch.lambda_max[lane] = if is_rod { max_tension_imp } else { 0.0 };
            batch.lambda[lane] = self.joints[c.joint_idx].cache.limit_hi;

            vel.vax[lane] = ba.vel[0];
            vel.vay[lane] = ba.vel[1];
            vel.vaz[lane] = ba.vel[2];
            vel.wax[lane] = ba.spin[0];
            vel.way[lane] = ba.spin[1];
            vel.waz[lane] = ba.spin[2];
            vel.vbx[lane] = bb.vel[0];
            vel.vby[lane] = bb.vel[1];
            vel.vbz[lane] = bb.vel[2];
            vel.wbx[lane] = bb.spin[0];
            vel.wby[lane] = bb.spin[1];
            vel.wbz[lane] = bb.spin[2];
        }

        solve_distance_batch_4(&mut batch, &mut vel);

        for lane in 0..4 {
            let p = &self.prepared[quad[lane]];
            let c = &p.common;
            self.joints[c.joint_idx].cache.limit_hi = batch.lambda[lane];
            if c.inv_ma > 0.0 && c.slot_a != NO_SLOT {
                bodies[c.slot_a].vel = [vel.vax[lane], vel.vay[lane], vel.vaz[lane]];
                bodies[c.slot_a].spin = [vel.wax[lane], vel.way[lane], vel.waz[lane]];
            }
            if c.inv_mb > 0.0 && c.slot_b != NO_SLOT {
                bodies[c.slot_b].vel = [vel.vbx[lane], vel.vby[lane], vel.vbz[lane]];
                bodies[c.slot_b].spin = [vel.wbx[lane], vel.wby[lane], vel.wbz[lane]];
            }
        }
    }

    /// Zero-bias velocity relaxation pass (removes phantom Baumgarte velocity without disturbing warm-start impulses).
    fn relax_velocity_iteration(&self, bodies: &mut [SolverBody], reverse: bool) {
        let n = self.prepared.len();
        for step in 0..n {
            let pi = if reverse { n - 1 - step } else { step };
            let p = &self.prepared[pi];
            let c = &p.common;
            let ba = Self::read_body(bodies, c.slot_a);
            let bb = Self::read_body(bodies, c.slot_b);
            match p.kind {
                PreparedKind::Fixed { lin_eff, ang_eff, .. } => {
                    let vrel = point_rel_vel(&ba, c.ra, &bb, c.rb);
                    let dl = v_neg(m3_mul_v(&lin_eff, vrel));
                    apply_linear_impulse(bodies, c, dl);
                    let wrel = v_sub(bb.spin, ba.spin);
                    let dw = v_neg(m3_mul_v(&ang_eff, wrel));
                    apply_angular_impulse(bodies, c, dw);
                }
                PreparedKind::Hinge { lin_eff, t1, t2, align_eff, .. } => {
                    let vrel = point_rel_vel(&ba, c.ra, &bb, c.rb);
                    let dl = v_neg(m3_mul_v(&lin_eff, vrel));
                    apply_linear_impulse(bodies, c, dl);
                    let ba = Self::read_body(bodies, c.slot_a);
                    let bb = Self::read_body(bodies, c.slot_b);
                    let wrel = v_sub(bb.spin, ba.spin);
                    let jv0 = v_dot(wrel, t1);
                    let jv1 = v_dot(wrel, t2);
                    let d0 = -(align_eff.0 * jv0 + align_eff.1 * jv1);
                    let d1 = -(align_eff.1 * jv0 + align_eff.2 * jv1);
                    apply_angular_impulse(bodies, c, v_add(v_scale(t1, d0), v_scale(t2, d1)));
                }
                PreparedKind::Ball { lin_eff, .. } => {
                    let vrel = point_rel_vel(&ba, c.ra, &bb, c.rb);
                    let dl = v_neg(m3_mul_v(&lin_eff, vrel));
                    apply_linear_impulse(bodies, c, dl);
                }
                PreparedKind::Slider { ra_eff, t1, t2, perp_eff, ang_eff, .. } => {
                    let vrel = point_rel_vel(&ba, ra_eff, &bb, c.rb);
                    let jv0 = v_dot(vrel, t1);
                    let jv1 = v_dot(vrel, t2);
                    let d0 = -(perp_eff.0 * jv0 + perp_eff.1 * jv1);
                    let d1 = -(perp_eff.1 * jv0 + perp_eff.2 * jv1);
                    apply_linear_impulse_arms(
                        bodies,
                        c,
                        ra_eff,
                        c.rb,
                        v_add(v_scale(t1, d0), v_scale(t2, d1)),
                    );
                    let ba = Self::read_body(bodies, c.slot_a);
                    let bb = Self::read_body(bodies, c.slot_b);
                    let wrel = v_sub(bb.spin, ba.spin);
                    let dw = v_neg(m3_mul_v(&ang_eff, wrel));
                    apply_angular_impulse(bodies, c, dw);
                }
                PreparedKind::Distance {
                    axis,
                    dist,
                    eff_mass,
                    min_dist,
                    max_dist,
                    max_target_vel,
                    is_rod,
                    ..
                } => {
                    let jv = v_dot(point_rel_vel(&ba, c.ra, &bb, c.rb), axis);
                    if is_rod {
                        let dl = -eff_mass * (jv - max_target_vel);
                        apply_linear_impulse(bodies, c, v_scale(axis, dl));
                    } else if dist >= max_dist && jv > max_target_vel {
                        let dl = -eff_mass * (jv - max_target_vel);
                        apply_linear_impulse(bodies, c, v_scale(axis, dl));
                    } else if min_dist > 0.0 && dist <= min_dist && jv < 0.0 {
                        let dl = -eff_mass * jv;
                        apply_linear_impulse(bodies, c, v_scale(axis, dl));
                    }
                }
                PreparedKind::Spring6Dof { .. } => {
                    // Force-limited springs never get rigid zero-bias velocity clamping.
                }
            }
        }
    }

    /// XPBD / Nonlinear Gauss-Seidel soft position projection eliminating geometric anchor & limit drift.
    fn solve_positions_internal(
        &self,
        bodies: &mut [SolverBody],
        h: f32,
        config: &SolverConfig,
    ) {
        let n = self.joints.len();
        for iter in 0..config.position_iters {
            let reverse = iter % 2 == 1;
            for step in 0..n {
                let ji = if reverse { n - 1 - step } else { step };
                let j = &self.joints[ji];
                if j.broken {
                    continue;
                }
                let sa = self.lookup_slot(j.body_a);
                let sb = self.lookup_slot(j.body_b);
                let ba = Self::read_body(bodies, sa);
                let bb = Self::read_body(bodies, sb);
                if ba.is_static() && bb.is_static() {
                    continue;
                }
                if (ba.is_static() || ba.asleep) && (bb.is_static() || bb.asleep) {
                    continue;
                }
                let inv_ma = if ba.is_static() { 0.0 } else { ba.inv_mass };
                let inv_mb = if bb.is_static() { 0.0 } else { bb.inv_mass };
                let ia = if ba.is_static() { ZERO_M3 } else { ba.inv_inertia_world };
                let ib = if bb.is_static() { ZERO_M3 } else { bb.inv_inertia_world };
                let ra = quat_rotate(ba.rot, j.local_a);
                let rb = quat_rotate(bb.rot, j.local_b);
                let d = v_sub(v_add(bb.pos, rb), v_add(ba.pos, ra));

                match j.kind {
                    JointKind::Fixed(cfg) => {
                        let alpha_l = cfg.linear_softness.pos_factor(h);
                        let err = slop_clamp_vec(
                            v_scale(d, alpha_l),
                            config.pos_slop,
                            config.max_pos_correction,
                        );
                        if v_len_sq(err) > 1e-12 {
                            let k = point_k_matrix(inv_ma + inv_mb, ra, &ia, rb, &ib);
                            let dl = v_neg(m3_mul_v(&m3_inv(&k), err));
                            apply_pos_linear(bodies, sa, sb, inv_ma, inv_mb, &ia, &ib, ra, rb, dl);
                        }
                        let ba = Self::read_body(bodies, sa);
                        let bb = Self::read_body(bodies, sb);
                        let q_target = quat_mul(ba.rot, quat_norm(cfg.rel_rot));
                        let alpha_a = cfg.angular_softness.pos_factor(h);
                        let aerr = slop_clamp_vec(
                            v_scale(quat_error_vec(bb.rot, q_target), alpha_a),
                            config.ang_slop,
                            config.max_ang_correction,
                        );
                        if v_len_sq(aerr) > 1e-12 {
                            let k = m3_add(&ia, &ib);
                            let dl = v_neg(m3_mul_v(&m3_inv(&k), aerr));
                            apply_pos_angular(bodies, sa, sb, &ia, &ib, dl);
                        }
                    }
                    JointKind::Hinge(cfg) => {
                        let alpha = cfg.softness.pos_factor(h);
                        let err = slop_clamp_vec(
                            v_scale(d, alpha),
                            config.pos_slop,
                            config.max_pos_correction,
                        );
                        if v_len_sq(err) > 1e-12 {
                            let k = point_k_matrix(inv_ma + inv_mb, ra, &ia, rb, &ib);
                            let dl = v_neg(m3_mul_v(&m3_inv(&k), err));
                            apply_pos_linear(bodies, sa, sb, inv_ma, inv_mb, &ia, &ib, ra, rb, dl);
                        }
                        let ba = Self::read_body(bodies, sa);
                        let bb = Self::read_body(bodies, sb);
                        let a1 = v_unit_or(quat_rotate(ba.rot, cfg.axis_a), [0.0, 1.0, 0.0]);
                        let a2 = v_unit_or(quat_rotate(bb.rot, cfg.axis_b), a1);
                        let (t1, t2) = ortho_basis(a1);
                        let raw_cross = v_cross(a1, a2);
                        let sin_t = v_len(raw_cross);
                        let cos_t = v_dot(a1, a2);
                        let align_vec = if sin_t > 1e-6 {
                            v_scale(raw_cross, sin_t.atan2(cos_t) / sin_t)
                        } else {
                            raw_cross
                        };
                        let e0 = slop_clamp_scalar(
                            v_dot(align_vec, t1) * alpha,
                            config.ang_slop,
                            config.max_ang_correction,
                        );
                        let e1 = slop_clamp_scalar(
                            v_dot(align_vec, t2) * alpha,
                            config.ang_slop,
                            config.max_ang_correction,
                        );
                        if e0 * e0 + e1 * e1 > 1e-12 {
                            let ia_ib = m3_add(&ia, &ib);
                            let eff = sym2_inv(
                                v_dot(t1, m3_mul_v(&ia_ib, t1)),
                                v_dot(t1, m3_mul_v(&ia_ib, t2)),
                                v_dot(t2, m3_mul_v(&ia_ib, t2)),
                            );
                            let d0 = -(eff.0 * e0 + eff.1 * e1);
                            let d1 = -(eff.1 * e0 + eff.2 * e1);
                            apply_pos_angular(
                                bodies,
                                sa,
                                sb,
                                &ia,
                                &ib,
                                v_add(v_scale(t1, d0), v_scale(t2, d1)),
                            );
                        }
                        if let Some(lim) = cfg.limits {
                            let ba = Self::read_body(bodies, sa);
                            let bb = Self::read_body(bodies, sb);
                            let a1 = v_unit_or(quat_rotate(ba.rot, cfg.axis_a), [0.0, 1.0, 0.0]);
                            let a2 = v_unit_or(quat_rotate(bb.rot, cfg.axis_b), a1);
                            let ua = ortho_perp(a1, quat_rotate(ba.rot, cfg.ref_a));
                            let va = v_cross(a1, ua);
                            let ub = ortho_perp(a2, quat_rotate(bb.rot, cfg.ref_b));
                            let raw_angle = v_dot(ub, va).atan2(v_dot(ub, ua));
                            let angle = if j.cache.hinge_angle_init {
                                j.cache.hinge_angle + wrap_pi(raw_angle - j.cache.hinge_angle)
                            } else {
                                raw_angle
                            };
                            let viol = if angle < lim.min {
                                angle - lim.min
                            } else if angle > lim.max {
                                angle - lim.max
                            } else {
                                0.0
                            };
                            let c_err = slop_clamp_scalar(
                                viol * alpha,
                                config.ang_slop,
                                config.max_ang_correction,
                            );
                            if c_err.abs() > 1e-6 {
                                let k = angular_row_k(&ia, &ib, a1);
                                if k > 1e-12 {
                                    let dl = -c_err / k;
                                    apply_pos_angular(bodies, sa, sb, &ia, &ib, v_scale(a1, dl));
                                }
                            }
                        }
                    }
                    JointKind::Ball(cfg) => {
                        let alpha = cfg.softness.pos_factor(h);
                        let err = slop_clamp_vec(
                            v_scale(d, alpha),
                            config.pos_slop,
                            config.max_pos_correction,
                        );
                        if v_len_sq(err) > 1e-12 {
                            let k = point_k_matrix(inv_ma + inv_mb, ra, &ia, rb, &ib);
                            let dl = v_neg(m3_mul_v(&m3_inv(&k), err));
                            apply_pos_linear(bodies, sa, sb, inv_ma, inv_mb, &ia, &ib, ra, rb, dl);
                        }
                        if cfg.swing_cone.is_some() || cfg.twist_limits.is_some() {
                            let ba = Self::read_body(bodies, sa);
                            let bb = Self::read_body(bodies, sb);
                            let qfa = quat_mul(ba.rot, quat_norm(cfg.frame_a));
                            let qfb = quat_mul(bb.rot, quat_norm(cfg.frame_b));
                            let mut qrel = quat_mul(quat_conj(qfa), qfb);
                            if qrel[3] < 0.0 {
                                qrel = [-qrel[0], -qrel[1], -qrel[2], -qrel[3]];
                            }
                            let twist_len = (qrel[0] * qrel[0] + qrel[3] * qrel[3]).sqrt();
                            let q_twist = if twist_len > 1e-6 {
                                [qrel[0] / twist_len, 0.0, 0.0, qrel[3] / twist_len]
                            } else {
                                ID_QUAT
                            };
                            let q_swing = quat_mul(qrel, quat_conj(q_twist));
                            if let Some([sy_max, sz_max]) = cfg.swing_cone {
                                let (sy, sz) = (q_swing[1], q_swing[2]);
                                let sr = (sy * sy + sz * sz).sqrt();
                                let (ay, az) = if sr > 1e-6 {
                                    let ang = 2.0 * sr.atan2(q_swing[3].abs());
                                    (ang * sy / sr, ang * sz / sr)
                                } else {
                                    (2.0 * sy, 2.0 * sz)
                                };
                                let a = sy_max.max(1e-4);
                                let b = sz_max.max(1e-4);
                                let e_sqrt = ((ay / a) * (ay / a) + (az / b) * (az / b)).sqrt();
                                if e_sqrt > 1.0 + 1e-5 {
                                    let gx = ay / (a * a);
                                    let gz = az / (b * b);
                                    let gn = (gx * gx + gz * gz).sqrt().max(1e-8);
                                    let (ny, nz) = (gx / gn, gz / gn);
                                    let viol = (1.0 - 1.0 / e_sqrt) * (ay * ny + az * nz);
                                    let axis = v_unit_or(quat_rotate(qfa, [0.0, ny, nz]), [0.0, 1.0, 0.0]);
                                    let k = angular_row_k(&ia, &ib, axis);
                                    if k > 1e-12 {
                                        let c_err = (viol * alpha).min(config.max_ang_correction);
                                        apply_pos_angular(bodies, sa, sb, &ia, &ib, v_scale(axis, -c_err / k));
                                    }
                                }
                            }
                            if let Some(lim) = cfg.twist_limits {
                                let twist_angle = 2.0 * q_twist[0].atan2(q_twist[3]);
                                let viol = if twist_angle < lim.min {
                                    twist_angle - lim.min
                                } else if twist_angle > lim.max {
                                    twist_angle - lim.max
                                } else {
                                    0.0
                                };
                                if viol.abs() > 1e-5 {
                                    let axis = v_unit_or(quat_rotate(qfb, [1.0, 0.0, 0.0]), [1.0, 0.0, 0.0]);
                                    let k = angular_row_k(&ia, &ib, axis);
                                    if k > 1e-12 {
                                        let c_err = (viol * alpha)
                                            .clamp(-config.max_ang_correction, config.max_ang_correction);
                                        apply_pos_angular(bodies, sa, sb, &ia, &ib, v_scale(axis, -c_err / k));
                                    }
                                }
                            }
                        }
                    }
                    JointKind::Slider(cfg) => {
                        let alpha = cfg.softness.pos_factor(h);
                        let axis = v_unit_or(quat_rotate(ba.rot, cfg.axis_a), [1.0, 0.0, 0.0]);
                        let (t1, t2) = ortho_basis(axis);
                        let ra_eff = v_add(ra, d);
                        let e0 = (v_dot(d, t1) * alpha)
                            .clamp(-config.max_pos_correction, config.max_pos_correction);
                        let e1 = (v_dot(d, t2) * alpha)
                            .clamp(-config.max_pos_correction, config.max_pos_correction);
                        if e0 * e0 + e1 * e1 > 1e-12 {
                            let r1a = v_cross(ra_eff, t1);
                            let r2a = v_cross(ra_eff, t2);
                            let r1b = v_cross(rb, t1);
                            let r2b = v_cross(rb, t2);
                            let m00 = inv_ma + inv_mb
                                + v_dot(r1a, m3_mul_v(&ia, r1a))
                                + v_dot(r1b, m3_mul_v(&ib, r1b));
                            let m01 = v_dot(r1a, m3_mul_v(&ia, r2a)) + v_dot(r1b, m3_mul_v(&ib, r2b));
                            let m11 = inv_ma + inv_mb
                                + v_dot(r2a, m3_mul_v(&ia, r2a))
                                + v_dot(r2b, m3_mul_v(&ib, r2b));
                            let eff = sym2_inv(m00, m01, m11);
                            let d0 = -(eff.0 * e0 + eff.1 * e1);
                            let d1 = -(eff.1 * e0 + eff.2 * e1);
                            apply_pos_linear(
                                bodies,
                                sa,
                                sb,
                                inv_ma,
                                inv_mb,
                                &ia,
                                &ib,
                                ra_eff,
                                rb,
                                v_add(v_scale(t1, d0), v_scale(t2, d1)),
                            );
                        }
                        if let Some(lim) = cfg.limits {
                            let ba = Self::read_body(bodies, sa);
                            let bb = Self::read_body(bodies, sb);
                            let ra = quat_rotate(ba.rot, j.local_a);
                            let rb = quat_rotate(bb.rot, j.local_b);
                            let d = v_sub(v_add(bb.pos, rb), v_add(ba.pos, ra));
                            let axis = v_unit_or(quat_rotate(ba.rot, cfg.axis_a), [1.0, 0.0, 0.0]);
                            let s = v_dot(d, axis);
                            let viol = if s < lim.min {
                                s - lim.min
                            } else if s > lim.max {
                                s - lim.max
                            } else {
                                0.0
                            };
                            if viol.abs() > 1e-5 {
                                let ra_eff = v_add(ra, d);
                                let k = linear_row_k(inv_ma + inv_mb, ra_eff, &ia, rb, &ib, axis);
                                if k > 1e-12 {
                                    let c_err = (viol * alpha)
                                        .clamp(-config.max_pos_correction, config.max_pos_correction);
                                    apply_pos_linear(
                                        bodies,
                                        sa,
                                        sb,
                                        inv_ma,
                                        inv_mb,
                                        &ia,
                                        &ib,
                                        ra_eff,
                                        rb,
                                        v_scale(axis, -c_err / k),
                                    );
                                }
                            }
                        }
                        let ba = Self::read_body(bodies, sa);
                        let bb = Self::read_body(bodies, sb);
                        let q_target = quat_mul(ba.rot, quat_norm(cfg.rel_rot));
                        let aerr = clamp_vec(
                            v_scale(quat_error_vec(bb.rot, q_target), alpha),
                            config.max_ang_correction,
                        );
                        if v_len_sq(aerr) > 1e-12 {
                            let k = m3_add(&ia, &ib);
                            let dl = v_neg(m3_mul_v(&m3_inv(&k), aerr));
                            apply_pos_angular(bodies, sa, sb, &ia, &ib, dl);
                        }
                    }
                    JointKind::Distance(cfg) => {
                        // Only apply XPBD position projection for stiff/rigid cables (not low-hz bungee springs
                        // or force-capped winches that may stall against an obstacle).
                        if !cfg.winch_max_force.is_finite() {
                            let dist = v_len(d);
                            let viol = if dist > cfg.max_dist {
                                dist - cfg.max_dist
                            } else if cfg.min_dist > 0.0 && dist < cfg.min_dist {
                                dist - cfg.min_dist
                            } else {
                                0.0
                            };
                            if viol.abs() > 1e-5 && dist > 1e-6 {
                                let alpha = cfg.softness.pos_factor(h);
                                let axis = v_scale(d, 1.0 / dist);
                                let k = linear_row_k(inv_ma + inv_mb, ra, &ia, rb, &ib, axis);
                                if k > 1e-12 {
                                    let c_err = (viol * alpha)
                                        .clamp(-config.max_pos_correction, config.max_pos_correction);
                                    apply_pos_linear(
                                        bodies,
                                        sa,
                                        sb,
                                        inv_ma,
                                        inv_mb,
                                        &ia,
                                        &ib,
                                        ra,
                                        rb,
                                        v_scale(axis, -c_err / k),
                                    );
                                }
                            }
                        }
                    }
                    JointKind::Spring6Dof(_) => {
                        // Soft force-limited springs resolve purely in velocity TGS-Soft space.
                    }
                }
            }
        }
    }

    fn evaluate_breaks(&mut self, h: f32, events: &mut Vec<JointEvent>) {
        if h <= 0.0 {
            return;
        }
        let inv_h = 1.0 / h;
        for j in &mut self.joints {
            if j.broken || (!j.break_force.is_finite() && !j.break_torque.is_finite()) {
                continue;
            }
            let (lin_imp, ang_imp) = match j.kind {
                JointKind::Fixed(_) => (v_len(j.cache.lin), v_len(j.cache.ang)),
                JointKind::Hinge(_) => {
                    let t_axis = j.cache.limit_lo + j.cache.limit_hi + j.cache.motor;
                    let ang = (j.cache.ang[0] * j.cache.ang[0]
                        + j.cache.ang[1] * j.cache.ang[1]
                        + t_axis * t_axis)
                        .sqrt();
                    (v_len(j.cache.lin), ang)
                }
                JointKind::Ball(_) => {
                    let t_twist = j.cache.twist_lo + j.cache.twist_hi;
                    let ang = (v_len_sq(j.cache.drive)
                        + j.cache.swing_limit * j.cache.swing_limit
                        + t_twist * t_twist)
                        .sqrt();
                    (v_len(j.cache.lin), ang)
                }
                JointKind::Slider(_) => {
                    let s_axis =
                        j.cache.limit_lo + j.cache.limit_hi + j.cache.motor + j.cache.friction;
                    let lin = (j.cache.lin[0] * j.cache.lin[0]
                        + j.cache.lin[1] * j.cache.lin[1]
                        + s_axis * s_axis)
                        .sqrt();
                    (lin, v_len(j.cache.ang))
                }
                JointKind::Distance(_) => {
                    let lin = j.cache.limit_hi.abs().max(j.cache.limit_lo.abs());
                    (lin, 0.0)
                }
                JointKind::Spring6Dof(_) => (v_len(j.cache.lin), v_len(j.cache.ang)),
            };

            let lin_force = lin_imp * inv_h;
            let ang_torque = ang_imp * inv_h;
            if lin_force > j.break_force {
                j.broken = true;
                j.cache.zero_impulses();
                events.push(JointEvent::Broken { id: j.id, impulse: lin_imp });
            } else if ang_torque > j.break_torque {
                j.broken = true;
                j.cache.zero_impulses();
                events.push(JointEvent::Broken { id: j.id, impulse: ang_imp });
            }
        }
    }
}

// ── Per-joint velocity solve helpers ────────────────────────────────────────

#[inline]
fn point_rel_vel(ba: &SolverBody, ra: V3, bb: &SolverBody, rb: V3) -> V3 {
    v_sub(v_add(bb.vel, v_cross(bb.spin, rb)), v_add(ba.vel, v_cross(ba.spin, ra)))
}

/// Shrinks vector `v` toward zero by deadband `slop` (returns zero if `|v| <= slop`),
/// then clamps to `max_len`.
#[inline]
fn slop_clamp_vec(v: V3, slop: f32, max_len: f32) -> V3 {
    let l = v_len(v);
    if l <= slop || l <= 1e-12 {
        return ZERO3;
    }
    let mag = (l - slop).min(max_len);
    v_scale(v, mag / l)
}

#[inline]
fn slop_clamp_scalar(v: f32, slop: f32, max_abs: f32) -> f32 {
    let a = v.abs();
    if a <= slop {
        return 0.0;
    }
    v.signum() * (a - slop).min(max_abs)
}

#[inline]
fn clamp_vec(v: V3, max_len: f32) -> V3 {
    let l = v_len(v);
    if l > max_len && l > 1e-12 { v_scale(v, max_len / l) } else { v }
}

#[inline]
fn apply_linear_impulse(bodies: &mut [SolverBody], c: &PreparedCommon, imp: V3) {
    apply_linear_impulse_arms(bodies, c, c.ra, c.rb, imp);
}

#[inline]
fn apply_linear_impulse_arms(
    bodies: &mut [SolverBody],
    c: &PreparedCommon,
    ra: V3,
    rb: V3,
    imp: V3,
) {
    if c.inv_ma > 0.0 && c.slot_a != NO_SLOT {
        let ba = &mut bodies[c.slot_a];
        ba.vel = v_sub(ba.vel, v_scale(imp, c.inv_ma));
        ba.spin = v_sub(ba.spin, m3_mul_v(&c.ia, v_cross(ra, imp)));
    }
    if c.inv_mb > 0.0 && c.slot_b != NO_SLOT {
        let bb = &mut bodies[c.slot_b];
        bb.vel = v_add(bb.vel, v_scale(imp, c.inv_mb));
        bb.spin = v_add(bb.spin, m3_mul_v(&c.ib, v_cross(rb, imp)));
    }
}

#[inline]
fn apply_angular_impulse(bodies: &mut [SolverBody], c: &PreparedCommon, imp: V3) {
    if c.inv_ma > 0.0 && c.slot_a != NO_SLOT {
        let ba = &mut bodies[c.slot_a];
        ba.spin = v_sub(ba.spin, m3_mul_v(&c.ia, imp));
    }
    if c.inv_mb > 0.0 && c.slot_b != NO_SLOT {
        let bb = &mut bodies[c.slot_b];
        bb.spin = v_add(bb.spin, m3_mul_v(&c.ib, imp));
    }
}

#[inline]
fn apply_pos_linear(
    bodies: &mut [SolverBody],
    sa: usize,
    sb: usize,
    inv_ma: f32,
    inv_mb: f32,
    ia: &M3,
    ib: &M3,
    ra: V3,
    rb: V3,
    dl: V3,
) {
    if inv_ma > 0.0 && sa != NO_SLOT {
        let ba = &mut bodies[sa];
        ba.pos = v_sub(ba.pos, v_scale(dl, inv_ma));
        let dq = v_neg(m3_mul_v(ia, v_cross(ra, dl)));
        ba.rot = quat_integrate(ba.rot, dq, 1.0);
    }
    if inv_mb > 0.0 && sb != NO_SLOT {
        let bb = &mut bodies[sb];
        bb.pos = v_add(bb.pos, v_scale(dl, inv_mb));
        let dq = m3_mul_v(ib, v_cross(rb, dl));
        bb.rot = quat_integrate(bb.rot, dq, 1.0);
    }
}

#[inline]
fn apply_pos_angular(
    bodies: &mut [SolverBody],
    sa: usize,
    sb: usize,
    ia: &M3,
    ib: &M3,
    dl: V3,
) {
    if sa != NO_SLOT && !bodies[sa].is_static() {
        let ba = &mut bodies[sa];
        ba.rot = quat_integrate(ba.rot, v_neg(m3_mul_v(ia, dl)), 1.0);
    }
    if sb != NO_SLOT && !bodies[sb].is_static() {
        let bb = &mut bodies[sb];
        bb.rot = quat_integrate(bb.rot, m3_mul_v(ib, dl), 1.0);
    }
}

/// Solves a 1D unilateral lower bound (`q >= min`, impulse `lambda >= 0`) with speculative braking
/// when inside and TGS-Soft when penetrating.
#[inline]
fn solve_1d_lower(
    c_val: f32,
    jv: f32,
    eff_mass: f32,
    soft: SoftCoeffs,
    h: f32,
    use_bias: bool,
    lambda: &mut f32,
) -> f32 {
    if eff_mass <= 0.0 {
        return 0.0;
    }
    let old = *lambda;
    let dl_raw = if !use_bias {
        -eff_mass * jv
    } else if c_val < 0.0 {
        // Penetrating below min: TGS-Soft spring-damper recovery.
        -eff_mass * soft.mass_coeff * (jv + soft.bias_rate * c_val) - soft.impulse_coeff * old
    } else {
        // Speculative stop: prevent tunneling across boundary within one step.
        -eff_mass * (jv + c_val / h)
    };
    let new_l = (old + dl_raw).max(0.0);
    *lambda = new_l;
    new_l - old
}

/// Solves a 1D unilateral upper bound (`q <= max`, impulse `lambda <= 0`, clamped at `-max_imp`)
/// with speculative braking when inside and TGS-Soft when penetrating.
#[inline]
fn solve_1d_upper(
    c_val: f32,
    jv: f32,
    target_vel: f32,
    eff_mass: f32,
    soft: SoftCoeffs,
    h: f32,
    use_bias: bool,
    max_imp: f32,
    lambda: &mut f32,
) -> f32 {
    if eff_mass <= 0.0 {
        return 0.0;
    }
    let old = *lambda;
    let rel_v = jv - target_vel;
    let dl_raw = if !use_bias {
        -eff_mass * rel_v
    } else if c_val >= 0.0 {
        -eff_mass * soft.mass_coeff * (rel_v + soft.bias_rate * c_val) - soft.impulse_coeff * old
    } else {
        -eff_mass * (rel_v + c_val / h)
    };
    let new_l = (old + dl_raw).clamp(-max_imp, 0.0);
    *lambda = new_l;
    new_l - old
}

/// Solves a 1D velocity or implicit TGS-Soft PD position motor.
#[inline]
fn solve_1d_motor(
    pos: f32,
    jv: f32,
    eff_mass: f32,
    motor: Motor1D,
    motor_soft: SoftCoeffs,
    h: f32,
    wrap_angle: bool,
    lambda: &mut f32,
) -> f32 {
    if !motor.enabled || motor.max_effort <= 0.0 || eff_mass <= 0.0 {
        return 0.0;
    }
    let max_imp = motor.max_effort * h;
    let old = *lambda;
    let dl_raw = if let Some(target_pos) = motor.target_pos {
        let err = if wrap_angle { wrap_pi(pos - target_pos) } else { pos - target_pos };
        -eff_mass * motor_soft.mass_coeff * ((jv - motor.target_vel) + motor_soft.bias_rate * err)
            - motor_soft.impulse_coeff * old
    } else {
        eff_mass * (motor.target_vel - jv)
    };
    let new_l = (old + dl_raw).clamp(-max_imp, max_imp);
    *lambda = new_l;
    new_l - old
}

fn solve_single_joint_velocity(
    bodies: &mut [SolverBody],
    c: &PreparedCommon,
    kind: &PreparedKind,
    cache: &mut ImpulseCache,
    h: f32,
    use_bias: bool,
) {
    match *kind {
        PreparedKind::Fixed {
            lin_err,
            lin_eff,
            lin_soft,
            ang_err,
            ang_eff,
            ang_soft,
        } => {
            let ba = JointSet::read_body(bodies, c.slot_a);
            let bb = JointSet::read_body(bodies, c.slot_b);
            let vrel = point_rel_vel(&ba, c.ra, &bb, c.rb);
            let s = if use_bias { lin_soft } else { SoftCoeffs::HARD_ZERO_BIAS };
            let rhs = v_add(vrel, v_scale(lin_err, s.bias_rate));
            let dl = v_sub(
                v_neg(v_scale(m3_mul_v(&lin_eff, rhs), s.mass_coeff)),
                v_scale(cache.lin, s.impulse_coeff),
            );
            cache.lin = v_add(cache.lin, dl);
            apply_linear_impulse(bodies, c, dl);

            let ba = JointSet::read_body(bodies, c.slot_a);
            let bb = JointSet::read_body(bodies, c.slot_b);
            let wrel = v_sub(bb.spin, ba.spin);
            let sa = if use_bias { ang_soft } else { SoftCoeffs::HARD_ZERO_BIAS };
            let arhs = v_add(wrel, v_scale(ang_err, sa.bias_rate));
            let dw = v_sub(
                v_neg(v_scale(m3_mul_v(&ang_eff, arhs), sa.mass_coeff)),
                v_scale(cache.ang, sa.impulse_coeff),
            );
            cache.ang = v_add(cache.ang, dw);
            apply_angular_impulse(bodies, c, dw);
        }
        PreparedKind::Hinge {
            lin_err,
            lin_eff,
            lin_soft,
            t1,
            t2,
            align_err,
            align_eff,
            align_soft,
            axis,
            axis_eff,
            motor_eff,
            angle,
            limits,
            motor,
            motor_soft,
        } => {
            // 1. Motor using coupled parallel-axis hinge inertia `motor_eff`.
            if motor.enabled {
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let jv = v_dot(v_sub(bb.spin, ba.spin), axis);
                let dl = solve_1d_motor(
                    angle,
                    jv,
                    motor_eff,
                    motor,
                    motor_soft,
                    h,
                    limits.is_none(),
                    &mut cache.motor,
                );
                if dl != 0.0 {
                    apply_angular_impulse(bodies, c, v_scale(axis, dl));
                }
            }

            // 2. 3-DOF point-to-point linear anchor lock (immediately couples linear reaction to motor torque).
            let solve_anchor = |bodies: &mut [SolverBody], cache: &mut ImpulseCache| {
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let vrel = point_rel_vel(&ba, c.ra, &bb, c.rb);
                let s = if use_bias { lin_soft } else { SoftCoeffs::HARD_ZERO_BIAS };
                let rhs = v_add(vrel, v_scale(lin_err, s.bias_rate));
                let dl = v_sub(
                    v_neg(v_scale(m3_mul_v(&lin_eff, rhs), s.mass_coeff)),
                    v_scale(cache.lin, s.impulse_coeff),
                );
                cache.lin = v_add(cache.lin, dl);
                apply_linear_impulse(bodies, c, dl);
            };
            solve_anchor(bodies, cache);

            // 3. 2-DOF angular alignment lock perpendicular to hinge axis.
            {
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let wrel = v_sub(bb.spin, ba.spin);
                let s = if use_bias { align_soft } else { SoftCoeffs::HARD_ZERO_BIAS };
                let r0 = v_dot(wrel, t1) + s.bias_rate * align_err[0];
                let r1 = v_dot(wrel, t2) + s.bias_rate * align_err[1];
                let d0 = -s.mass_coeff * (align_eff.0 * r0 + align_eff.1 * r1)
                    - s.impulse_coeff * cache.ang[0];
                let d1 = -s.mass_coeff * (align_eff.1 * r0 + align_eff.2 * r1)
                    - s.impulse_coeff * cache.ang[1];
                cache.ang[0] += d0;
                cache.ang[1] += d1;
                apply_angular_impulse(bodies, c, v_add(v_scale(t1, d0), v_scale(t2, d1)));
            }

            // 4. Optional 1-DOF angle limits (runs after motor+anchor so limits always dominate).
            if let Some(lim) = limits {
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let jv = v_dot(v_sub(bb.spin, ba.spin), axis);
                let dl_lo = solve_1d_lower(
                    angle - lim.min,
                    jv,
                    axis_eff,
                    align_soft,
                    h,
                    use_bias,
                    &mut cache.limit_lo,
                );
                if dl_lo != 0.0 {
                    apply_angular_impulse(bodies, c, v_scale(axis, dl_lo));
                }
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let jv = v_dot(v_sub(bb.spin, ba.spin), axis);
                let dl_hi = solve_1d_upper(
                    angle - lim.max,
                    jv,
                    0.0,
                    axis_eff,
                    align_soft,
                    h,
                    use_bias,
                    f32::INFINITY,
                    &mut cache.limit_hi,
                );
                if dl_hi != 0.0 {
                    apply_angular_impulse(bodies, c, v_scale(axis, dl_hi));
                }
                if dl_lo != 0.0 || dl_hi != 0.0 {
                    solve_anchor(bodies, cache);
                }
            }
        }
        PreparedKind::Ball {
            lin_err,
            lin_eff,
            lin_soft,
            has_swing,
            swing_axis,
            swing_err,
            swing_eff,
            has_twist,
            twist_axis,
            twist_angle,
            twist_eff,
            twist_limits,
            has_drive,
            drive_err,
            drive_target_vel,
            drive_eff,
            drive_soft,
            drive_max_imp,
        } => {
            // 1. 3-axis implicit TGS-Soft PD drive using parallel-axis coupled inertia `drive_eff`.
            if has_drive && drive_max_imp > 0.0 {
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let wrel = v_sub(v_sub(bb.spin, ba.spin), drive_target_vel);
                let rhs = v_add(wrel, v_scale(drive_err, drive_soft.bias_rate));
                let dl_raw = v_sub(
                    v_neg(v_scale(m3_mul_v(&drive_eff, rhs), drive_soft.mass_coeff)),
                    v_scale(cache.drive, drive_soft.impulse_coeff),
                );
                let cand = v_add(cache.drive, dl_raw);
                let clamped = clamp_vec(cand, drive_max_imp);
                let dl = v_sub(clamped, cache.drive);
                cache.drive = clamped;
                apply_angular_impulse(bodies, c, dl);
            }

            // 2. 3-DOF point-to-point linear anchor lock (couples drive torque to parallel-axis reaction).
            let solve_anchor = |bodies: &mut [SolverBody], cache: &mut ImpulseCache| {
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let vrel = point_rel_vel(&ba, c.ra, &bb, c.rb);
                let s = if use_bias { lin_soft } else { SoftCoeffs::HARD_ZERO_BIAS };
                let rhs = v_add(vrel, v_scale(lin_err, s.bias_rate));
                let dl = v_sub(
                    v_neg(v_scale(m3_mul_v(&lin_eff, rhs), s.mass_coeff)),
                    v_scale(cache.lin, s.impulse_coeff),
                );
                cache.lin = v_add(cache.lin, dl);
                apply_linear_impulse(bodies, c, dl);
            };
            solve_anchor(bodies, cache);

            // 3. Elliptical swing cone limit (`swing_err <= 0`, impulse <= 0).
            let mut limit_fired = false;
            if has_swing && swing_eff > 0.0 {
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let jv = v_dot(v_sub(bb.spin, ba.spin), swing_axis);
                let dl = solve_1d_upper(
                    swing_err,
                    jv,
                    0.0,
                    swing_eff,
                    lin_soft,
                    h,
                    use_bias,
                    f32::INFINITY,
                    &mut cache.swing_limit,
                );
                if dl != 0.0 {
                    apply_angular_impulse(bodies, c, v_scale(swing_axis, dl));
                    limit_fired = true;
                }
            }

            // 4. Twist range limits.
            if let (true, Some(lim)) = (has_twist, twist_limits) {
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let jv = v_dot(v_sub(bb.spin, ba.spin), twist_axis);
                let dl_lo = solve_1d_lower(
                    twist_angle - lim.min,
                    jv,
                    twist_eff,
                    lin_soft,
                    h,
                    use_bias,
                    &mut cache.twist_lo,
                );
                if dl_lo != 0.0 {
                    apply_angular_impulse(bodies, c, v_scale(twist_axis, dl_lo));
                    limit_fired = true;
                }
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let jv = v_dot(v_sub(bb.spin, ba.spin), twist_axis);
                let dl_hi = solve_1d_upper(
                    twist_angle - lim.max,
                    jv,
                    0.0,
                    twist_eff,
                    lin_soft,
                    h,
                    use_bias,
                    f32::INFINITY,
                    &mut cache.twist_hi,
                );
                if dl_hi != 0.0 {
                    apply_angular_impulse(bodies, c, v_scale(twist_axis, dl_hi));
                    limit_fired = true;
                }
            }
            if limit_fired {
                solve_anchor(bodies, cache);
            }
        }
        PreparedKind::Slider {
            ra_eff,
            axis,
            t1,
            t2,
            perp_err,
            perp_eff,
            perp_soft,
            ang_err,
            ang_eff,
            ang_soft,
            slide_pos,
            slide_eff,
            limits,
            friction_max_imp,
            motor,
            motor_soft,
        } => {
            // 1. Sliding Coulomb friction along axis.
            if friction_max_imp > 0.0 && slide_eff > 0.0 {
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let jv = v_dot(point_rel_vel(&ba, ra_eff, &bb, c.rb), axis);
                let old = cache.friction;
                let new_l = (old - slide_eff * jv).clamp(-friction_max_imp, friction_max_imp);
                let dl = new_l - old;
                cache.friction = new_l;
                if dl != 0.0 {
                    apply_linear_impulse_arms(bodies, c, ra_eff, c.rb, v_scale(axis, dl));
                }
            }

            // 2. Linear motor along axis.
            if motor.enabled {
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let jv = v_dot(point_rel_vel(&ba, ra_eff, &bb, c.rb), axis);
                let dl = solve_1d_motor(
                    slide_pos,
                    jv,
                    slide_eff,
                    motor,
                    motor_soft,
                    h,
                    false,
                    &mut cache.motor,
                );
                if dl != 0.0 {
                    apply_linear_impulse_arms(bodies, c, ra_eff, c.rb, v_scale(axis, dl));
                }
            }

            // 3. Linear translation limits along axis.
            if let Some(lim) = limits {
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let jv = v_dot(point_rel_vel(&ba, ra_eff, &bb, c.rb), axis);
                let dl_lo = solve_1d_lower(
                    slide_pos - lim.min,
                    jv,
                    slide_eff,
                    perp_soft,
                    h,
                    use_bias,
                    &mut cache.limit_lo,
                );
                if dl_lo != 0.0 {
                    apply_linear_impulse_arms(bodies, c, ra_eff, c.rb, v_scale(axis, dl_lo));
                }
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let jv = v_dot(point_rel_vel(&ba, ra_eff, &bb, c.rb), axis);
                let dl_hi = solve_1d_upper(
                    slide_pos - lim.max,
                    jv,
                    0.0,
                    slide_eff,
                    perp_soft,
                    h,
                    use_bias,
                    f32::INFINITY,
                    &mut cache.limit_hi,
                );
                if dl_hi != 0.0 {
                    apply_linear_impulse_arms(bodies, c, ra_eff, c.rb, v_scale(axis, dl_hi));
                }
            }

            // 4. 2-DOF perpendicular rail lock.
            {
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let vrel = point_rel_vel(&ba, ra_eff, &bb, c.rb);
                let s = if use_bias { perp_soft } else { SoftCoeffs::HARD_ZERO_BIAS };
                let r0 = v_dot(vrel, t1) + s.bias_rate * perp_err[0];
                let r1 = v_dot(vrel, t2) + s.bias_rate * perp_err[1];
                let d0 = -s.mass_coeff * (perp_eff.0 * r0 + perp_eff.1 * r1)
                    - s.impulse_coeff * cache.lin[0];
                let d1 = -s.mass_coeff * (perp_eff.1 * r0 + perp_eff.2 * r1)
                    - s.impulse_coeff * cache.lin[1];
                cache.lin[0] += d0;
                cache.lin[1] += d1;
                apply_linear_impulse_arms(
                    bodies,
                    c,
                    ra_eff,
                    c.rb,
                    v_add(v_scale(t1, d0), v_scale(t2, d1)),
                );
            }

            // 5. 3-DOF angular lock.
            {
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let wrel = v_sub(bb.spin, ba.spin);
                let s = if use_bias { ang_soft } else { SoftCoeffs::HARD_ZERO_BIAS };
                let rhs = v_add(wrel, v_scale(ang_err, s.bias_rate));
                let dw = v_sub(
                    v_neg(v_scale(m3_mul_v(&ang_eff, rhs), s.mass_coeff)),
                    v_scale(cache.ang, s.impulse_coeff),
                );
                cache.ang = v_add(cache.ang, dw);
                apply_angular_impulse(bodies, c, dw);
            }
        }
        PreparedKind::Distance {
            axis,
            dist,
            eff_mass,
            min_dist,
            max_dist,
            max_target_vel,
            max_tension_imp,
            soft,
            is_rod,
            ..
        } => {
            if eff_mass <= 0.0 {
                return;
            }
            let ba = JointSet::read_body(bodies, c.slot_a);
            let bb = JointSet::read_body(bodies, c.slot_b);
            let jv = v_dot(point_rel_vel(&ba, c.ra, &bb, c.rb), axis);
            if is_rod {
                let s = if use_bias { soft } else { SoftCoeffs::HARD_ZERO_BIAS };
                let err = dist - max_dist;
                let old = cache.limit_hi;
                let dl_raw = -eff_mass * s.mass_coeff * ((jv - max_target_vel) + s.bias_rate * err)
                    - s.impulse_coeff * old;
                let new_l = (old + dl_raw).clamp(-max_tension_imp, max_tension_imp);
                let dl = new_l - old;
                cache.limit_hi = new_l;
                if dl != 0.0 {
                    apply_linear_impulse(bodies, c, v_scale(axis, dl));
                }
            } else {
                // Upper bound (unilateral taut rope/cable/winch: pulls only, never pushes).
                let dl_hi = solve_1d_upper(
                    dist - max_dist,
                    jv,
                    max_target_vel,
                    eff_mass,
                    soft,
                    h,
                    use_bias,
                    max_tension_imp,
                    &mut cache.limit_hi,
                );
                if dl_hi != 0.0 {
                    apply_linear_impulse(bodies, c, v_scale(axis, dl_hi));
                }
                // Lower bound (optional when min_dist > 0).
                if min_dist > 0.0 {
                    let ba = JointSet::read_body(bodies, c.slot_a);
                    let bb = JointSet::read_body(bodies, c.slot_b);
                    let jv = v_dot(point_rel_vel(&ba, c.ra, &bb, c.rb), axis);
                    let dl_lo = solve_1d_lower(
                        dist - min_dist,
                        jv,
                        eff_mass,
                        soft,
                        h,
                        use_bias,
                        &mut cache.limit_lo,
                    );
                    if dl_lo != 0.0 {
                        apply_linear_impulse(bodies, c, v_scale(axis, dl_lo));
                    }
                }
            }
        }
        PreparedKind::Spring6Dof {
            axes,
            lin_err,
            lin_eff,
            lin_soft,
            lin_active,
            ang_err,
            ang_eff,
            ang_soft,
            ang_active,
            max_lin_imp,
            max_ang_imp,
        } => {
            // 1. 3-axis linear TGS-Soft spring-damper with isotropic spherical force cap.
            if max_lin_imp > 0.0 {
                let mut cand = cache.lin;
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let vrel = point_rel_vel(&ba, c.ra, &bb, c.rb);
                for i in 0..3 {
                    if !lin_active[i] || lin_eff[i] <= 0.0 {
                        cand[i] = 0.0;
                        continue;
                    }
                    let jv = v_dot(vrel, axes[i]);
                    let s = lin_soft[i];
                    let dl = -lin_eff[i] * s.mass_coeff * (jv + s.bias_rate * lin_err[i])
                        - s.impulse_coeff * cache.lin[i];
                    cand[i] = cache.lin[i] + dl;
                }
                let clamped = if max_lin_imp.is_finite() {
                    clamp_vec(cand, max_lin_imp)
                } else {
                    cand
                };
                let d0 = clamped[0] - cache.lin[0];
                let d1 = clamped[1] - cache.lin[1];
                let d2 = clamped[2] - cache.lin[2];
                cache.lin = clamped;
                let imp = v_add(
                    v_add(v_scale(axes[0], d0), v_scale(axes[1], d1)),
                    v_scale(axes[2], d2),
                );
                if v_len_sq(imp) > 0.0 {
                    apply_linear_impulse(bodies, c, imp);
                }
            }

            // 2. 3-axis angular TGS-Soft spring-damper with isotropic spherical torque cap.
            if max_ang_imp > 0.0 {
                let mut cand = cache.ang;
                let ba = JointSet::read_body(bodies, c.slot_a);
                let bb = JointSet::read_body(bodies, c.slot_b);
                let wrel = v_sub(bb.spin, ba.spin);
                for i in 0..3 {
                    if !ang_active[i] || ang_eff[i] <= 0.0 {
                        cand[i] = 0.0;
                        continue;
                    }
                    let jv = v_dot(wrel, axes[i]);
                    let s = ang_soft[i];
                    let dl = -ang_eff[i] * s.mass_coeff * (jv + s.bias_rate * ang_err[i])
                        - s.impulse_coeff * cache.ang[i];
                    cand[i] = cache.ang[i] + dl;
                }
                let clamped = if max_ang_imp.is_finite() {
                    clamp_vec(cand, max_ang_imp)
                } else {
                    cand
                };
                let d0 = clamped[0] - cache.ang[0];
                let d1 = clamped[1] - cache.ang[1];
                let d2 = clamped[2] - cache.ang[2];
                cache.ang = clamped;
                let imp = v_add(
                    v_add(v_scale(axes[0], d0), v_scale(axes[1], d1)),
                    v_scale(axes[2], d2),
                );
                if v_len_sq(imp) > 0.0 {
                    apply_angular_impulse(bodies, c, imp);
                }
            }
        }
    }
}

// ── Physics & stability test suite ──────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    const G: f32 = 98.0;
    const DT: f32 = 1.0 / 120.0;

    fn body_kinetic_energy(b: &SolverBody) -> f32 {
        if b.is_static() {
            return 0.0;
        }
        let mass = 1.0 / b.inv_mass;
        let lin_ke = 0.5 * mass * v_len_sq(b.vel);
        let i_world = m3_inv(&b.inv_inertia_world);
        let ang_ke = 0.5 * v_dot(b.spin, m3_mul_v(&i_world, b.spin));
        lin_ke + ang_ke
    }

    fn body_total_energy(b: &SolverBody, g: f32) -> f32 {
        if b.is_static() {
            return 0.0;
        }
        let mass = 1.0 / b.inv_mass;
        body_kinetic_energy(b) + mass * g * b.pos[1]
    }

    #[test]
    fn pendulum_ball_and_hinge_conservation() {
        // Test BOTH Ball and Hinge pendulums over 5 full seconds at 120 Hz (600 steps):
        // anchor drift < 0.02 cells and mechanical energy conserved cleanly.
        let pivot = [0.0, 50.0, 0.0];
        let arm = 20.0;
        let mass = 10.0;
        let cfg = SolverConfig::default();

        for is_hinge in [false, true] {
            let mut bodies = vec![SolverBody::dynamic_box(
                1,
                [arm, pivot[1], 0.0],
                mass,
                [1.5, 1.5, 1.5],
            )];
            let mut set = JointSet::new();
            let local_b = [-arm, 0.0, 0.0];
            if is_hinge {
                let hj = HingeJoint::new([0.0, 0.0, 1.0], [0.0, 0.0, 1.0]);
                set.add(Joint::hinge(0, 1, pivot, local_b, hj));
            } else {
                set.add(Joint::ball(0, 1, pivot, local_b, BallJoint::default()));
            }

            let e0 = body_total_energy(&bodies[0], G);
            let mut max_drift = 0.0f32;
            let mut max_energy_rel_err = 0.0f32;
            let mut min_y = f32::MAX;
            let mut crossed_bottom = 0u32;
            let mut prev_x = bodies[0].pos[0];

            for _ in 0..600 {
                let events = set.step_bodies(&mut bodies, [0.0, -G, 0.0], DT, &cfg);
                assert!(events.is_empty());

                let b = &bodies[0];
                let anchor_b = v_add(b.pos, quat_rotate(b.rot, local_b));
                let drift = v_len(v_sub(anchor_b, pivot));
                max_drift = max_drift.max(drift);
                min_y = min_y.min(b.pos[1]);
                if prev_x > 0.0 && b.pos[0] <= 0.0 {
                    crossed_bottom += 1;
                }
                prev_x = b.pos[0];

                let e = body_total_energy(b, G);
                let ref_swing_e = mass * G * arm; // Full potential-to-kinetic swing scale.
                let rel_err = (e - e0).abs() / ref_swing_e;
                max_energy_rel_err = max_energy_rel_err.max(rel_err);
                assert!(b.pos.iter().all(|v| v.is_finite()));
            }

            let label = if is_hinge { "Hinge" } else { "Ball" };
            eprintln!(
                "{label} pendulum (5s @ 120Hz): max_drift={max_drift:.5} cells, max_energy_err={:.2}%, crossings={crossed_bottom}",
                max_energy_rel_err * 100.0
            );
            assert!(
                max_drift < 0.02,
                "{label} pendulum anchor drift {max_drift:.5} >= 0.02 cells"
            );
            assert!(
                min_y < pivot[1] - arm * 0.95,
                "{label} pendulum did not swing through bottom: min_y={min_y:.3}"
            );
            assert!(
                crossed_bottom >= 1,
                "{label} pendulum did not complete swings (crossings={crossed_bottom})"
            );
            assert!(
                max_energy_rel_err < 0.05,
                "{label} pendulum energy drifted by {:.2}%",
                max_energy_rel_err * 100.0
            );
        }
    }

    #[test]
    fn truck_towing_safe_unilateral_rope_and_snap() {
        // Heavy truck (mass 2000) towing a safe (mass 200) via unilateral Rope cable (max_dist 30):
        // 1. Slack when dist < 30 -> safe stays completely untouched.
        // 2. Goes taut at dist == 30 -> smoothly transfers momentum without exploding.
        // 3. Exceeding break_force snaps cleanly and emits JointEvent::Broken.
        let cfg = SolverConfig::default();
        let max_dist = 30.0;

        // Part A: Slack -> taut towing momentum transfer (unbreakable).
        {
            let mut truck = SolverBody::dynamic_box(1, [15.0, 0.0, 0.0], 2000.0, [15.0, 8.0, 8.0]);
            truck.vel = [40.0, 0.0, 0.0];
            let safe = SolverBody::dynamic_box(2, [0.0, 0.0, 0.0], 200.0, [4.0, 4.0, 4.0]);
            let mut bodies = vec![truck, safe];

            let mut set = JointSet::new();
            set.add(Joint::rope(1, 2, ZERO3, ZERO3, max_dist));

            // Step while slack (initial dist = 15.0, closing gap at 40 cells/s -> slack for ~0.35 s = 42 steps).
            for _ in 0..36 {
                set.step_bodies(&mut bodies, ZERO3, DT, &cfg);
            }
            let dist_slack = v_len(v_sub(bodies[1].pos, bodies[0].pos));
            assert!(dist_slack < max_dist, "expected still slack, dist={dist_slack}");
            assert!(
                v_len(bodies[1].vel) < 1e-4,
                "safe moved while rope was slack: vel={:?}",
                bodies[1].vel
            );

            // Continue stepping past taut engagement for 1.5 seconds.
            let mut max_stretch = 0.0f32;
            for _ in 0..180 {
                set.step_bodies(&mut bodies, ZERO3, DT, &cfg);
                let dist = v_len(v_sub(bodies[1].pos, bodies[0].pos));
                max_stretch = max_stretch.max((dist - max_dist).max(0.0));
                assert!(bodies[0].vel.iter().all(|v| v.is_finite()));
                assert!(bodies[1].vel.iter().all(|v| v.is_finite()));
            }

            // Expected common velocity by conservation of momentum: 2000*40 / (2000 + 200) = 36.3636 cells/s.
            let expected_v = (2000.0 * 40.0) / 2200.0;
            assert!(
                bodies[1].vel[0] > expected_v * 0.85 && bodies[1].vel[0] < expected_v * 1.15,
                "safe velocity {:.3} did not track towed speed {:.3}",
                bodies[1].vel[0],
                expected_v
            );
            assert!(
                (bodies[0].vel[0] - expected_v).abs() < 4.0,
                "truck velocity {:.3} diverged from momentum conservation {:.3}",
                bodies[0].vel[0],
                expected_v
            );
            assert!(
                max_stretch < 1.5,
                "taut tow cable stretched excessively: {max_stretch:.3} cells"
            );
        }

        // Part B: 100:1 mass ratio + snap when break_force is exceeded.
        {
            let mut truck = SolverBody::dynamic_box(1, [30.0, 0.0, 0.0], 2000.0, [15.0, 8.0, 8.0]);
            truck.vel = [120.0, 0.0, 0.0];
            let safe = SolverBody::dynamic_box(2, [0.0, 0.0, 0.0], 200.0, [4.0, 4.0, 4.0]);
            let mut bodies = vec![truck, safe];

            let mut set = JointSet::new();
            let break_force = 50_000.0;
            let rope_id = set.add(
                Joint::rope(1, 2, ZERO3, ZERO3, max_dist).with_break(break_force, f32::INFINITY),
            );

            let mut broken_event = None;
            for _ in 0..30 {
                let events = set.step_bodies(&mut bodies, ZERO3, DT, &cfg);
                for ev in events {
                    if broken_event.is_none() {
                        broken_event = Some(ev);
                    }
                }
            }
            match broken_event {
                Some(JointEvent::Broken { id, impulse }) => {
                    assert_eq!(id, rope_id);
                    assert!(
                        impulse / DT > break_force,
                        "expected breaking force > {break_force}, got {}",
                        impulse / DT
                    );
                }
                None => panic!("expected tow rope to snap under high impulse"),
            }
            assert!(set.get(rope_id).unwrap().broken);

            // After snapping, further separation applies zero force to the safe.
            let vel_after_snap = bodies[1].vel;
            for _ in 0..20 {
                let events = set.step_bodies(&mut bodies, ZERO3, DT, &cfg);
                assert!(events.is_empty());
            }
            assert!(
                v_len(v_sub(bodies[1].vel, vel_after_snap)) < 1e-4,
                "broken rope continued pulling safe"
            );
        }
    }

    #[test]
    fn winch_reels_suspended_crate_upward_against_gravity() {
        let anchor = [0.0, 60.0, 0.0];
        let start_y = 20.0;
        let start_len = anchor[1] - start_y; // 40 cells
        let reel_speed = 10.0; // cells/s upward
        let min_len = 10.0;

        let mut bodies = vec![SolverBody::dynamic_box(1, [0.0, start_y, 0.0], 50.0, [3.0, 3.0, 3.0])];
        let mut set = JointSet::new();
        let winch_id = set.add(Joint::winch(0, 1, anchor, ZERO3, start_len, reel_speed, min_len));
        let cfg = SolverConfig::default();

        // Reel for 2.0 seconds -> crate should lift ~20 cells smoothly (y: 20 -> 40).
        let mut prev_y = start_y;
        let mut max_step_jump = 0.0f32;
        for step in 0..240 {
            let events = set.step_bodies(&mut bodies, [0.0, -G, 0.0], DT, &cfg);
            assert!(events.is_empty());
            let y = bodies[0].pos[1];
            if step > 10 {
                max_step_jump = max_step_jump.max((y - prev_y).abs());
            }
            prev_y = y;
        }
        assert!(
            (bodies[0].pos[1] - 40.0).abs() < 0.5,
            "winch crate at y={:.3}, expected ~40.0",
            bodies[0].pos[1]
        );
        assert!(
            max_step_jump < 0.25,
            "winch motion was jerky: max_step_jump={max_step_jump:.4}"
        );

        // Continue 1.5 seconds past winch_min_dist=10.0 -> stops cleanly at y ≈ 50.0.
        for _ in 0..180 {
            set.step_bodies(&mut bodies, [0.0, -G, 0.0], DT, &cfg);
        }
        if let JointKind::Distance(d) = set.get(winch_id).unwrap().kind {
            assert!((d.max_dist - min_len).abs() < 1e-4);
        }
        assert!(
            (bodies[0].pos[1] - (anchor[1] - min_len)).abs() < 0.5,
            "winch did not hold at min_dist: y={:.3}",
            bodies[0].pos[1]
        );
    }

    #[test]
    fn motorized_hinge_and_swing_twist_pd_drive_converge_within_limits() {
        let cfg = SolverConfig::default();

        // 1. Motorized Hinge PD drive: target inside limits, then target beyond upper limit.
        {
            let mut bodies = vec![SolverBody::dynamic_box(1, [5.0, 0.0, 0.0], 12.0, [5.0, 8.0, 0.8])];
            let mut set = JointSet::new();
            let mut hj = HingeJoint::new([0.0, 1.0, 0.0], [0.0, 1.0, 0.0]);
            hj.ref_a = [1.0, 0.0, 0.0];
            hj.ref_b = [1.0, 0.0, 0.0];
            hj.limits = Some(Limits1D::new(-0.2, 1.8));
            hj.motor = Motor1D::position(1.2, Softness::new(6.0, 1.0), 80_000.0);
            let jid = set.add(Joint::hinge(0, 1, ZERO3, [-5.0, 0.0, 0.0], hj));

            let mut peak_angle = 0.0f32;
            for _ in 0..180 {
                set.step_bodies(&mut bodies, ZERO3, DT, &cfg);
                let a = set.get(jid).unwrap().cache.hinge_angle;
                peak_angle = peak_angle.max(a);
                assert!(
                    a >= -0.25 && a <= 1.85,
                    "hinge angle {a:.4} violated limits [-0.2, 1.8]"
                );
            }
            let final_angle = set.get(jid).unwrap().cache.hinge_angle;
            assert!(
                (final_angle - 1.2).abs() < 0.02,
                "hinge PD failed to converge: angle={final_angle:.4}, target=1.2"
            );
            assert!(
                peak_angle < 1.28,
                "hinge PD overshot excessively: peak={peak_angle:.4}"
            );

            // Push target beyond upper limit (2.5 > 1.8) -> limits must hold at ~1.8.
            if let JointKind::Hinge(ref mut h) = set.get_mut(jid).unwrap().kind {
                h.motor.target_pos = Some(2.5);
            }
            for _ in 0..180 {
                set.step_bodies(&mut bodies, ZERO3, DT, &cfg);
            }
            let clamped_angle = set.get(jid).unwrap().cache.hinge_angle;
            assert!(
                (clamped_angle - 1.8).abs() < 0.04,
                "hinge upper limit failed against motor: angle={clamped_angle:.4}"
            );
        }

        // 2. SwingTwist (Ball) 3-axis PD drive + elliptical swing cone + twist range.
        {
            let mut bodies = vec![SolverBody::dynamic_box(1, [4.0, 0.0, 0.0], 8.0, [4.0, 1.5, 1.5])];
            let mut set = JointSet::new();
            let target_in = quat_mul(
                quat_from_axis_angle([0.0, 1.0, 0.0], 0.5),
                quat_from_axis_angle([1.0, 0.0, 0.0], 0.35),
            );
            let bj = BallJoint {
                frame_a: ID_QUAT,
                frame_b: ID_QUAT,
                swing_cone: Some([0.8, 0.5]),
                twist_limits: Some(Limits1D::new(-0.6, 0.6)),
                drive: Some(AngularDrive3D::position(
                    target_in,
                    Softness::new(6.0, 1.0),
                    60_000.0,
                )),
                softness: Softness::RIGID,
            };
            let jid = set.add(Joint::swing_twist(0, 1, ZERO3, [-4.0, 0.0, 0.0], bj));

            for _ in 0..180 {
                set.step_bodies(&mut bodies, ZERO3, DT, &cfg);
            }
            let err_in = v_len(quat_error_vec(bodies[0].rot, target_in));
            assert!(
                err_in < 0.03,
                "SwingTwist 3-axis PD drive failed to converge: rot_err={err_in:.4}"
            );

            // Drive target outside elliptical Z swing limit (1.2 rad > 0.5 rad) and twist (1.1 > 0.6).
            let target_out = quat_mul(
                quat_from_axis_angle([0.0, 0.0, 1.0], 1.2),
                quat_from_axis_angle([1.0, 0.0, 0.0], 1.1),
            );
            if let JointKind::Ball(ref mut b) = set.get_mut(jid).unwrap().kind {
                b.drive.as_mut().unwrap().target_rot = target_out;
            }
            for _ in 0..180 {
                set.step_bodies(&mut bodies, ZERO3, DT, &cfg);
            }
            // Decompose resulting orientation and verify elliptical cone & twist limits held!
            let mut qrel = bodies[0].rot;
            if qrel[3] < 0.0 {
                qrel = [-qrel[0], -qrel[1], -qrel[2], -qrel[3]];
            }
            let tl = (qrel[0] * qrel[0] + qrel[3] * qrel[3]).sqrt();
            let qt = [qrel[0] / tl, 0.0, 0.0, qrel[3] / tl];
            let qs = quat_mul(qrel, quat_conj(qt));
            let twist = 2.0 * qt[0].atan2(qt[3]);
            let sr = (qs[1] * qs[1] + qs[2] * qs[2]).sqrt();
            let swing_ang = 2.0 * sr.atan2(qs[3].abs());
            let (ay, az) = if sr > 1e-6 {
                (swing_ang * qs[1] / sr, swing_ang * qs[2] / sr)
            } else {
                (0.0, 0.0)
            };
            let ellipse = (ay / 0.8) * (ay / 0.8) + (az / 0.5) * (az / 0.5);
            assert!(
                ellipse <= 1.15,
                "elliptical swing cone violated: ellipse={ellipse:.3} (ay={ay:.3}, az={az:.3})"
            );
            assert!(
                twist <= 0.65 && twist >= -0.65,
                "twist limit violated: twist={twist:.3}"
            );
        }
    }

    #[test]
    fn voxel_anchor_invalidation_snaps_door_joint() {
        let wall_cell = [10, 15, 20];
        let door_cell = [0, 5, 0];
        let mut bodies = vec![SolverBody::dynamic_box(7, [15.0, 15.0, 20.0], 25.0, [5.0, 10.0, 1.0])];
        let mut set = JointSet::new();
        let door_joint = set.add(
            Joint::hinge(
                0,
                7,
                [10.0, 15.0, 20.0],
                [-5.0, 0.0, 0.0],
                HingeJoint::new([0.0, 1.0, 0.0], [0.0, 1.0, 0.0]),
            )
            .with_anchors(
                VoxelAnchor::world_cell(wall_cell),
                VoxelAnchor::body_cell(7, door_cell),
            ),
        );
        let other_joint = set.add(
            Joint::fixed(0, 7, [10.0, 25.0, 20.0], [-5.0, 10.0, 0.0], FixedJoint::default())
                .with_anchors(
                    VoxelAnchor::world_cell([10, 25, 20]),
                    VoxelAnchor::body_cell(7, [0, 15, 0]),
                ),
        );

        let cfg = SolverConfig::default();
        // While both voxels are solid, nothing snaps and door stays held up against gravity.
        assert!(set.invalidate_world_cells(|_| true).is_empty());
        assert!(set.invalidate_body_cells(7, |_| true).is_empty());
        for _ in 0..30 {
            set.step_bodies(&mut bodies, [0.0, -G, 0.0], DT, &cfg);
        }
        assert!((bodies[0].pos[1] - 15.0).abs() < 0.1);

        // Carve/burn wall_cell -> door_joint snaps immediately; other_joint stays intact.
        let snapped = set.invalidate_world_cells(|c| c != wall_cell);
        assert_eq!(snapped, vec![door_joint]);
        assert!(set.get(door_joint).unwrap().broken);
        assert!(!set.get(other_joint).unwrap().broken);
        // Re-running invalidation does not double-report an already-broken joint.
        assert!(set.invalidate_world_cells(|c| c != wall_cell).is_empty());

        // Blow off body 7's upper hinge voxel -> other_joint snaps too, and door falls freely!
        let snapped_body = set.invalidate_body_cells(7, |c| c != [0, 15, 0]);
        assert_eq!(snapped_body, vec![other_joint]);
        assert!(set.get(other_joint).unwrap().broken);

        let y_before = bodies[0].pos[1];
        for _ in 0..30 {
            set.step_bodies(&mut bodies, [0.0, -G, 0.0], DT, &cfg);
        }
        assert!(
            bodies[0].pos[1] < y_before - 2.0,
            "unhinged door failed to fall under gravity: y_before={y_before:.3}, y_after={:.3}",
            bodies[0].pos[1]
        );
    }

    #[test]
    fn high_stress_ten_link_chain_mass_ratio_and_perf() {
        // 10-link hanging chain with 10:1 mass ratio (light links holding 10x heavier weight at tip
        // AND alternating heavy/light links): must remain finite, bounded drift, < 0.5 ms/step.
        let link_len = 6.0;
        let half = link_len * 0.5;
        // Check both 1-substep (8 iters @ 120 Hz) and 2-substep TGS-Soft (2x4 iters @ 120 Hz).
        let mut drifts = [0.0f32; 2];
        for (run_idx, (substeps, vel_iters, pos_iters, max_allowed_drift)) in
            [(1u32, 8u32, 4u32, 0.5f32), (2u32, 4u32, 2u32, 0.35f32)]
                .into_iter()
                .enumerate()
        {
            let mut bodies = Vec::with_capacity(10);
            let mut set = JointSet::new();

            for i in 0..10u32 {
                // Alternating 10 / 100 mass ratio (54:1 cumulative root load ratio!), ending in heavy wrecking ball.
                let mass = if i % 2 == 0 { 10.0 } else { 100.0 };
                let x = (i as f32 + 0.5) * link_len;
                bodies.push(SolverBody::dynamic_box(i + 1, [x, 100.0, 0.0], mass, [half, 1.0, 1.0]));
                if i == 0 {
                    set.add(Joint::ball(0, 1, [0.0, 100.0, 0.0], [-half, 0.0, 0.0], BallJoint::default()));
                } else {
                    set.add(Joint::ball(
                        i,
                        i + 1,
                        [half, 0.0, 0.0],
                        [-half, 0.0, 0.0],
                        BallJoint::default(),
                    ));
                }
            }

            let cfg = SolverConfig {
                substeps,
                velocity_iters: vel_iters,
                position_iters: pos_iters,
                relaxation_iters: 1,
                ..SolverConfig::default()
            };

            let steps = 360; // 3 full seconds of swinging under gravity
            let t0 = Instant::now();
            let mut max_anchor_drift = 0.0f32;
            for _ in 0..steps {
                set.step_bodies(&mut bodies, [0.0, -G, 0.0], DT, &cfg);
                for b in &bodies {
                    assert!(b.pos.iter().all(|v| v.is_finite()));
                    assert!(b.vel.iter().all(|v| v.is_finite()));
                    assert!(b.spin.iter().all(|v| v.is_finite()));
                }
                let p0 = v_add(bodies[0].pos, quat_rotate(bodies[0].rot, [-half, 0.0, 0.0]));
                max_anchor_drift = max_anchor_drift.max(v_len(v_sub(p0, [0.0, 100.0, 0.0])));
                for i in 0..9 {
                    let pa = v_add(bodies[i].pos, quat_rotate(bodies[i].rot, [half, 0.0, 0.0]));
                    let pb = v_add(bodies[i + 1].pos, quat_rotate(bodies[i + 1].rot, [-half, 0.0, 0.0]));
                    max_anchor_drift = max_anchor_drift.max(v_len(v_sub(pb, pa)));
                }
            }
            let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
            let ms_per_step = elapsed_ms / steps as f64;
            eprintln!(
                "10-link 10:1 chain (substeps={substeps}, vel_iters={vel_iters}): {ms_per_step:.4} ms/step ({steps} steps in {elapsed_ms:.2} ms), max_drift={max_anchor_drift:.4} cells"
            );
            assert!(
                max_anchor_drift < max_allowed_drift,
                "10-link 10:1 chain (substeps={substeps}) drifted too far: {max_anchor_drift:.4} >= {max_allowed_drift}"
            );
            assert!(
                ms_per_step < 0.5,
                "10-link chain (substeps={substeps}) exceeded 0.5 ms/step budget: {ms_per_step:.4} ms/step"
            );
            drifts[run_idx] = max_anchor_drift;
        }
        assert!(
            drifts[1] < drifts[0],
            "expected 2-substep TGS-Soft drift ({:.4}) < 1-substep drift ({:.4})",
            drifts[1],
            drifts[0]
        );
    }

    #[test]
    fn breakable_fixed_weld_holds_under_load_and_breaks_under_impact() {
        let mut bodies = vec![SolverBody::dynamic_box(1, [5.0, 20.0, 0.0], 20.0, [5.0, 2.0, 2.0])];
        let mut set = JointSet::new();
        // Normal static weight = m * g = 20 * 98 = 1960; cantilever torque = 1960 * 5 = 9800.
        // Set thresholds safely above normal load (force 8000, torque 40000).
        let weld_id = set.add(
            Joint::fixed(0, 1, [0.0, 20.0, 0.0], [-5.0, 0.0, 0.0], FixedJoint::default())
                .with_break(8_000.0, 40_000.0),
        );
        let cfg = SolverConfig::default();

        // Phase 1: 1.0 second under normal gravity -> weld holds, minimal sag.
        for _ in 0..120 {
            let events = set.step_bodies(&mut bodies, [0.0, -G, 0.0], DT, &cfg);
            assert!(events.is_empty(), "weld broke prematurely under normal gravity");
        }
        assert!(!set.get(weld_id).unwrap().broken);
        assert!(
            (bodies[0].pos[1] - 20.0).abs() < 0.15,
            "cantilever weld sagged too much: y={:.3}",
            bodies[0].pos[1]
        );

        // Phase 2: Deliver sharp downward impact (delta-V = 100 cells/s -> impulse = 2000, force = 240,000 >> 8000).
        bodies[0].vel[1] -= 100.0;
        let events = set.step_bodies(&mut bodies, [0.0, -G, 0.0], DT, &cfg);
        assert_eq!(events.len(), 1);
        match events[0] {
            JointEvent::Broken { id, impulse } => {
                assert_eq!(id, weld_id);
                assert!(impulse > 0.0);
            }
        }
        assert!(set.get(weld_id).unwrap().broken);

        // Detached beam now falls freely.
        let y_detach = bodies[0].pos[1];
        for _ in 0..30 {
            let events = set.step_bodies(&mut bodies, [0.0, -G, 0.0], DT, &cfg);
            assert!(events.is_empty());
        }
        assert!(bodies[0].pos[1] < y_detach - 5.0);
    }

    #[test]
    fn slider_prismatic_friction_limits_and_motor() {
        // Covers cranes/pistons AND sword-stab prismatic binding (sliding friction + limits).
        let mut bodies = vec![SolverBody::dynamic_box(1, [2.0, 0.0, 0.0], 10.0, [2.0, 1.0, 1.0])];
        let mut set = JointSet::new();
        let mut sj = SliderJoint::new([1.0, 0.0, 0.0]);
        sj.limits = Some(Limits1D::new(0.0, 10.0));
        sj.friction = 400.0; // Blade embedded friction.
        let jid = set.add(Joint::prismatic(0, 1, ZERO3, ZERO3, sj));
        let cfg = SolverConfig::default();

        // Give an impulse along the slide axis + perpendicular knock.
        bodies[0].vel = [30.0, 25.0, -15.0];
        for _ in 0..120 {
            set.step_bodies(&mut bodies, ZERO3, DT, &cfg);
        }
        // Perpendicular motion must be locked near 0, and friction must stop sliding smoothly inside [0, 10].
        assert!(bodies[0].pos[1].abs() < 0.05 && bodies[0].pos[2].abs() < 0.05);
        assert!(bodies[0].pos[0] >= -0.05 && bodies[0].pos[0] <= 10.05);
        assert!(
            bodies[0].vel[0].abs() < 0.5,
            "sliding friction failed to halt blade: vx={:.3}",
            bodies[0].vel[0]
        );

        // Engage linear PD motor toward x = 8.0.
        if let JointKind::Slider(ref mut s) = set.get_mut(jid).unwrap().kind {
            s.friction = 0.0;
            s.motor = Motor1D::position(8.0, Softness::new(6.0, 1.0), 20_000.0);
        }
        for _ in 0..180 {
            set.step_bodies(&mut bodies, ZERO3, DT, &cfg);
        }
        assert!(
            (bodies[0].pos[0] - 8.0).abs() < 0.05,
            "slider PD motor failed to reach 8.0: x={:.3}",
            bodies[0].pos[0]
        );
    }

    #[test]
    fn spring_6dof_melee_weapon_tracks_target_with_capped_force() {
        // Physics-driven melee weapon held by a kinematic hand via Spring6Dof.
        let hand = SolverBody {
            id: 1,
            pos: [10.0, 5.0, 0.0],
            rot: quat_from_axis_angle([0.0, 0.0, 1.0], 0.6),
            vel: ZERO3,
            spin: ZERO3,
            inv_mass: 0.0, // kinematic hand
            inv_inertia_world: ZERO_M3,
            asleep: false,
        };
        let weapon = SolverBody::dynamic_box(2, [0.0, 0.0, 0.0], 5.0, [1.0, 4.0, 0.5]);
        let mut bodies = vec![hand, weapon];
        let mut set = JointSet::new();
        let sp = Spring6DofJoint::isotropic(
            Softness::new(8.0, 1.0),
            Softness::new(8.0, 1.0),
            12_000.0,
            25_000.0,
        );
        set.add(Joint::spring_6dof(1, 2, ZERO3, ZERO3, sp));
        let cfg = SolverConfig::default();

        for _ in 0..180 {
            set.step_bodies(&mut bodies, [0.0, -G, 0.0], DT, &cfg);
            assert!(bodies[1].pos.iter().all(|v| v.is_finite()));
        }
        // Weapon converges close to hand position (with tiny static gravity sag m*g/k < 0.1 cells) & target rot.
        assert!(
            v_len(v_sub(bodies[1].pos, bodies[0].pos)) < 0.2,
            "weapon failed to track hand: pos={:?}",
            bodies[1].pos
        );
        assert!(
            v_len(quat_error_vec(bodies[1].rot, bodies[0].rot)) < 0.05,
            "weapon orientation failed to track hand"
        );
    }

    #[test]
    fn simd_batch_primitives_and_multi_cable_parity() {
        // 1. Direct verification of dot4, cross4, quat_rotate4 against scalar equivalents.
        let ax = [1.0, -2.5, 0.3, 4.0];
        let ay = [2.0, 3.0, -1.2, 0.5];
        let az = [-0.5, 1.5, 2.2, -3.0];
        let bx = [-3.0, 0.5, 4.1, 1.2];
        let by = [0.25, -1.0, 2.0, -2.5];
        let bz = [2.0, 4.0, -0.7, 3.3];

        let d4 = dot4(ax, ay, az, bx, by, bz);
        let (cx, cy, cz) = cross4(ax, ay, az, bx, by, bz);
        for i in 0..4 {
            let a = [ax[i], ay[i], az[i]];
            let b = [bx[i], by[i], bz[i]];
            assert!((d4[i] - v_dot(a, b)).abs() < 1e-6);
            let c = v_cross(a, b);
            assert!((cx[i] - c[0]).abs() < 1e-6);
            assert!((cy[i] - c[1]).abs() < 1e-6);
            assert!((cz[i] - c[2]).abs() < 1e-6);
        }

        let qs = [
            quat_from_axis_angle([1.0, 0.0, 0.0], 0.4),
            quat_from_axis_angle([0.0, 1.0, 0.0], -1.1),
            quat_from_axis_angle([0.0, 0.0, 1.0], 2.2),
            quat_from_axis_angle([1.0, 2.0, 3.0], 0.9),
        ];
        let (rx, ry, rz) = quat_rotate4(
            [qs[0][0], qs[1][0], qs[2][0], qs[3][0]],
            [qs[0][1], qs[1][1], qs[2][1], qs[3][1]],
            [qs[0][2], qs[1][2], qs[2][2], qs[3][2]],
            [qs[0][3], qs[1][3], qs[2][3], qs[3][3]],
            ax,
            ay,
            az,
        );
        for i in 0..4 {
            let r = quat_rotate(qs[i], [ax[i], ay[i], az[i]]);
            assert!((rx[i] - r[0]).abs() < 1e-5);
            assert!((ry[i] - r[1]).abs() < 1e-5);
            assert!((rz[i] - r[2]).abs() < 1e-5);
        }

        // 2. End-to-end verification of 4 disjoint taut cables exercising `dist_batch_quads` + `solve_distance_batch_4`.
        let mut bodies = Vec::new();
        let mut set = JointSet::new();
        for i in 0..4u32 {
            let x = i as f32 * 20.0;
            bodies.push(SolverBody::dynamic_box(i + 1, [x, 10.0, 0.0], 20.0, [2.0, 2.0, 2.0]));
            set.add(Joint::rope(0, i + 1, [x, 40.0, 0.0], ZERO3, 30.0));
        }
        let cfg = SolverConfig::default();
        for _ in 0..120 {
            set.step_bodies(&mut bodies, [0.0, -G, 0.0], DT, &cfg);
        }
        assert_eq!(set.dist_batch_quads.len(), 1, "expected 4 disjoint taut cables to form 1 SIMD quad");
        for i in 0..4 {
            assert!(
                (bodies[i].pos[1] - 10.0).abs() < 0.05,
                "SIMD cable {i} drifted: y={:.4}",
                bodies[i].pos[1]
            );
        }
    }

    #[test]
    fn active_ragdoll_thirteen_bone_stability() {
        // 13-bone active ragdoll (pelvis -> torso -> head, 2 arms x3, 2 legs x2 = 13 bodies, 12 joints)
        // with SwingTwist shoulders/hips/neck/spine and Hinge elbows/knees driven by PD muscles at 120 Hz.
        let mut bodies = Vec::with_capacity(13);
        let mut set = JointSet::new();
        // 1: pelvis (root), 2: chest, 3: head
        bodies.push(SolverBody::dynamic_box(1, [0.0, 50.0, 0.0], 20.0, [2.0, 1.5, 1.5]));
        bodies.push(SolverBody::dynamic_box(2, [0.0, 54.0, 0.0], 25.0, [2.5, 2.5, 1.5]));
        bodies.push(SolverBody::dynamic_box(3, [0.0, 58.0, 0.0], 6.0, [1.5, 1.5, 1.5]));
        // 4,5,6: left upper arm, forearm, hand; 7,8,9: right upper arm, forearm, hand
        bodies.push(SolverBody::dynamic_box(4, [-4.0, 55.0, 0.0], 4.0, [1.5, 0.8, 0.8]));
        bodies.push(SolverBody::dynamic_box(5, [-7.0, 55.0, 0.0], 3.0, [1.5, 0.7, 0.7]));
        bodies.push(SolverBody::dynamic_box(6, [-9.5, 55.0, 0.0], 1.5, [1.0, 0.6, 0.6]));
        bodies.push(SolverBody::dynamic_box(7, [4.0, 55.0, 0.0], 4.0, [1.5, 0.8, 0.8]));
        bodies.push(SolverBody::dynamic_box(8, [7.0, 55.0, 0.0], 3.0, [1.5, 0.7, 0.7]));
        bodies.push(SolverBody::dynamic_box(9, [9.5, 55.0, 0.0], 1.5, [1.0, 0.6, 0.6]));
        // 10,11: left thigh, shin; 12,13: right thigh, shin
        bodies.push(SolverBody::dynamic_box(10, [-1.5, 46.5, 0.0], 8.0, [1.0, 2.0, 1.0]));
        bodies.push(SolverBody::dynamic_box(11, [-1.5, 42.5, 0.0], 5.0, [0.9, 2.0, 0.9]));
        bodies.push(SolverBody::dynamic_box(12, [1.5, 46.5, 0.0], 8.0, [1.0, 2.0, 1.0]));
        bodies.push(SolverBody::dynamic_box(13, [1.5, 42.5, 0.0], 5.0, [0.9, 2.0, 0.9]));

        let muscle = |hz: f32, max_t: f32| BallJoint {
            frame_a: ID_QUAT,
            frame_b: ID_QUAT,
            swing_cone: Some([0.9, 0.7]),
            twist_limits: Some(Limits1D::new(-0.5, 0.5)),
            drive: Some(AngularDrive3D::position(ID_QUAT, Softness::new(hz, 1.0), max_t)),
            softness: Softness::RIGID,
        };
        let hinge_pd = |axis: V3, lo: f32, hi: f32, target: f32| {
            let mut h = HingeJoint::new(axis, axis);
            h.limits = Some(Limits1D::new(lo, hi));
            h.motor = Motor1D::position(target, Softness::new(8.0, 1.0), 15_000.0);
            h
        };

        // Suspend pelvis softly from world so ragdoll hangs in air under gravity.
        set.add(Joint::rope(0, 1, [0.0, 65.0, 0.0], ZERO3, 15.0));
        set.add(Joint::swing_twist(1, 2, [0.0, 1.5, 0.0], [0.0, -2.5, 0.0], muscle(10.0, 30_000.0)));
        set.add(Joint::swing_twist(2, 3, [0.0, 2.5, 0.0], [0.0, -1.5, 0.0], muscle(10.0, 10_000.0)));
        set.add(Joint::swing_twist(2, 4, [-2.5, 1.0, 0.0], [1.5, 0.0, 0.0], muscle(8.0, 12_000.0)));
        set.add(Joint::hinge(4, 5, [-1.5, 0.0, 0.0], [1.5, 0.0, 0.0], hinge_pd([0.0, 1.0, 0.0], 0.0, 2.2, 0.4)));
        set.add(Joint::swing_twist(5, 6, [-1.5, 0.0, 0.0], [1.0, 0.0, 0.0], muscle(8.0, 4_000.0)));
        set.add(Joint::swing_twist(2, 7, [2.5, 1.0, 0.0], [-1.5, 0.0, 0.0], muscle(8.0, 12_000.0)));
        set.add(Joint::hinge(7, 8, [1.5, 0.0, 0.0], [-1.5, 0.0, 0.0], hinge_pd([0.0, 1.0, 0.0], -2.2, 0.0, -0.4)));
        set.add(Joint::swing_twist(8, 9, [1.5, 0.0, 0.0], [-1.0, 0.0, 0.0], muscle(8.0, 4_000.0)));
        set.add(Joint::swing_twist(1, 10, [-1.5, -1.5, 0.0], [0.0, 2.0, 0.0], muscle(9.0, 25_000.0)));
        set.add(Joint::hinge(10, 11, [0.0, -2.0, 0.0], [0.0, 2.0, 0.0], hinge_pd([1.0, 0.0, 0.0], 0.0, 2.2, 0.2)));
        set.add(Joint::swing_twist(1, 12, [1.5, -1.5, 0.0], [0.0, 2.0, 0.0], muscle(9.0, 25_000.0)));
        set.add(Joint::hinge(12, 13, [0.0, -2.0, 0.0], [0.0, 2.0, 0.0], hinge_pd([1.0, 0.0, 0.0], 0.0, 2.2, 0.2)));

        let cfg = SolverConfig::default();
        for _ in 0..240 {
            set.step_bodies(&mut bodies, [0.0, -G, 0.0], DT, &cfg);
            for b in &bodies {
                assert!(b.pos.iter().all(|v| v.is_finite()));
                assert!(b.vel.iter().all(|v| v.is_finite() && v.abs() < 500.0));
                assert!(b.spin.iter().all(|v| v.is_finite() && v.abs() < 100.0));
            }
        }
    }

    #[test]
    fn split_solve_velocities_and_positions_matches_external_integrator() {
        // Exercises the exact split API (`solve_velocities` -> external integration -> `solve_positions`)
        // that Wave 2 will wire into `Bodies::step()`, including sleeping body wake propagation.
        let mut bodies = vec![
            SolverBody::dynamic_box(10, [10.0, 40.0, 0.0], 10.0, [2.0, 2.0, 2.0]),
            SolverBody::dynamic_box(11, [20.0, 40.0, 0.0], 10.0, [2.0, 2.0, 2.0]),
        ];
        bodies[1].asleep = true; // Sleeping partner must be woken by connected awake body.

        let mut set = JointSet::new();
        set.add(Joint::ball(0, 10, [0.0, 40.0, 0.0], [-10.0, 0.0, 0.0], BallJoint::default()));
        set.add(Joint::ball(10, 11, [5.0, 0.0, 0.0], [-5.0, 0.0, 0.0], BallJoint::default()));
        let cfg = SolverConfig::default();

        for _ in 0..120 {
            for b in &mut bodies {
                b.integrate_forces([0.0, -G, 0.0], DT);
            }
            let events = set.solve_velocities(&mut bodies, DT, &cfg);
            assert!(events.is_empty());
            assert!(!bodies[1].asleep, "connected sleeping body should wake");
            for b in &mut bodies {
                b.integrate_positions(DT);
            }
            set.solve_positions(&mut bodies, DT, &cfg);
        }

        let p0 = v_add(bodies[0].pos, quat_rotate(bodies[0].rot, [-10.0, 0.0, 0.0]));
        let pa = v_add(bodies[0].pos, quat_rotate(bodies[0].rot, [5.0, 0.0, 0.0]));
        let pb = v_add(bodies[1].pos, quat_rotate(bodies[1].rot, [-5.0, 0.0, 0.0]));
        assert!(v_len(v_sub(p0, [0.0, 40.0, 0.0])) < 0.05);
        assert!(v_len(v_sub(pb, pa)) < 0.05);
    }
}
