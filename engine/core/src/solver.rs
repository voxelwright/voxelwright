//! Warm-started TGS-Soft contact solver, persistent contact manifold cache,
//! explicit `wasm32` `f32x4` SIMD SoA kernels, and bit-packed 64-bit voxel
//! distance/normal fast queries (#166, Spike 2 Tier 2 optimizations #4, #5, #6).
//!
//! Designed with zero external dependencies and deterministic arithmetic so it
//! compiles identically for native tests and `wasm32-unknown-unknown` with
//! `+simd128,+bulk-memory`. Units follow `engine/core/src/bodies.rs`:
//! - Lengths in finest cells (`1 cell = 0.1 m`)
//! - Time in seconds (`STEP = 1.0 / 120.0`)
//! - Gravity `G = 98.0` cells/s²
//! - Quaternions as `[qx, qy, qz, qw]`

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// Static world ground body ID used in [`ManifoldKey::body_b_id`].
pub const WORLD_BODY_ID: u32 = 0;

/// Sentinel body slice index denoting static world ground (matches `bodies::NONE`).
pub const WORLD_BODY_INDEX: usize = usize::MAX;

/// Standard Voxelwright gravity in finest cells per second squared (`9.8 m/s²`).
pub const GRAVITY: f32 = 98.0;

/// Default solver fixed timestep (`120 Hz`).
pub const DEFAULT_DT: f32 = 1.0 / 120.0;

/// Default warm-start impulse retention scale.
pub const DEFAULT_WARM_START_SCALE: f32 = 0.85;

/// Default TGS-Soft contact spring frequency (Hz).
pub const DEFAULT_CONTACT_HZ: f32 = 30.0;

/// Default TGS-Soft contact damping ratio (`1.0` = critically damped).
pub const DEFAULT_CONTACT_ZETA: f32 = 1.0;

/// Default number of TGS-Soft velocity iterations per step.
pub const DEFAULT_ITERATIONS: usize = 4;

/// Default maximum bit-scan depth (cells) for [`VoxelFastProbe`], matching `bodies::way_back`.
pub const PROBE_MAX_STEPS: usize = 3;

/// Sector side length (`64` cells, matching `tree::SIDE`).
const SECTOR_SIDE: i32 = 64;

// ── Fast deterministic hasher (no SipHash overhead in WASM) ─────────────────

#[derive(Default, Clone, Copy)]
struct FastMix(u64);

impl Hasher for FastMix {
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }

    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0 ^ b as u64).wrapping_mul(0x100_0000_01b3);
        }
    }

    #[inline]
    fn write_u32(&mut self, v: u32) {
        self.0 = (self.0.rotate_left(23) ^ v as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    }

    #[inline]
    fn write_u64(&mut self, v: u64) {
        self.0 = (self.0.rotate_left(29) ^ v).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    }
}

type FastMap<K, V> = HashMap<K, V, BuildHasherDefault<FastMix>>;

// ── Scalar 3D vector & quaternion helpers ───────────────────────────────────

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
fn unit3(a: [f32; 3]) -> [f32; 3] {
    let l = dot3(a, a).sqrt();
    if l > 1e-6 {
        scale3(a, 1.0 / l)
    } else {
        [0.0, 1.0, 0.0]
    }
}

/// Converts unit quaternion `[qx, qy, qz, qw]` into a row-major 3×3 rotation matrix.
#[inline]
fn quat_to_mat3(q: [f32; 4]) -> [[f32; 3]; 3] {
    let (x, y, z, w) = (q[0], q[1], q[2], q[3]);
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, yy, zz) = (x * x2, y * y2, z * z2);
    let (xy, xz, yz) = (x * y2, x * z2, y * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    [
        [1.0 - (yy + zz), xy - wz, xz + wy],
        [xy + wz, 1.0 - (xx + zz), yz - wx],
        [xz - wy, yz + wx, 1.0 - (xx + yy)],
    ]
}

/// Rotates vector `v` by unit quaternion `q = [qx, qy, qz, qw]` (matches `bodies::turn`).
#[inline]
pub fn quat_rotate(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let u = [q[0], q[1], q[2]];
    let t = scale3(cross3(u, v), 2.0);
    add3(add3(v, scale3(t, q[3])), cross3(u, t))
}

/// Multiplies symmetric 3×3 matrix packed as `[xx, yy, zz, xy, xz, yz]` by vector `v`.
#[inline]
fn mul_sym3(m: &[f32; 6], v: [f32; 3]) -> [f32; 3] {
    [
        m[0] * v[0] + m[3] * v[1] + m[4] * v[2],
        m[3] * v[0] + m[1] * v[1] + m[5] * v[2],
        m[4] * v[0] + m[5] * v[1] + m[2] * v[2],
    ]
}

/// Builds a deterministic orthonormal tangent basis `(t1, t2)` for unit normal `n`.
#[inline]
fn tangent_basis(n: [f32; 3]) -> ([f32; 3], [f32; 3]) {
    let ref_axis = if n[1].abs() < 0.9 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
    let t1 = unit3(cross3(n, ref_axis));
    let t2 = cross3(n, t1);
    (t1, t2)
}

// ── Explicit WASM SIMD (`f32x4`) SoA Batch Kernels ──────────────────────────

/// Rotates a Structure-of-Arrays batch of 3D collision sample points by unit
/// quaternion `q = [qx, qy, qz, qw]`.
///
/// On `wasm32` with `simd128`, processes 4 points per `v128` instruction stream
/// using explicit `core::arch::wasm32` `f32x4` intrinsics. On native targets,
/// uses the exact scalar equivalent.
pub fn transform_points_soa(
    q: [f32; 4],
    in_x: &[f32],
    in_y: &[f32],
    in_z: &[f32],
    out_x: &mut [f32],
    out_y: &mut [f32],
    out_z: &mut [f32],
) {
    let n = in_x
        .len()
        .min(in_y.len())
        .min(in_z.len())
        .min(out_x.len())
        .min(out_y.len())
        .min(out_z.len());
    let r = quat_to_mat3(q);

    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        use core::arch::wasm32::{f32x4_add, f32x4_mul, f32x4_splat, v128, v128_load, v128_store};

        let r00 = f32x4_splat(r[0][0]);
        let r01 = f32x4_splat(r[0][1]);
        let r02 = f32x4_splat(r[0][2]);
        let r10 = f32x4_splat(r[1][0]);
        let r11 = f32x4_splat(r[1][1]);
        let r12 = f32x4_splat(r[1][2]);
        let r20 = f32x4_splat(r[2][0]);
        let r21 = f32x4_splat(r[2][1]);
        let r22 = f32x4_splat(r[2][2]);

        let chunks = n / 4;
        let ix = in_x.as_ptr();
        let iy = in_y.as_ptr();
        let iz = in_z.as_ptr();
        let ox = out_x.as_mut_ptr();
        let oy = out_y.as_mut_ptr();
        let oz = out_z.as_mut_ptr();

        let mut i = 0usize;
        while i < chunks * 4 {
            // SAFETY: `i + 4 <= n` and `n` is the minimum length of all six slices.
            let (vx, vy, vz) = unsafe {
                (
                    v128_load(ix.add(i) as *const v128),
                    v128_load(iy.add(i) as *const v128),
                    v128_load(iz.add(i) as *const v128),
                )
            };

            let rx = f32x4_add(f32x4_add(f32x4_mul(r00, vx), f32x4_mul(r01, vy)), f32x4_mul(r02, vz));
            let ry = f32x4_add(f32x4_add(f32x4_mul(r10, vx), f32x4_mul(r11, vy)), f32x4_mul(r12, vz));
            let rz = f32x4_add(f32x4_add(f32x4_mul(r20, vx), f32x4_mul(r21, vy)), f32x4_mul(r22, vz));

            // SAFETY: `i + 4 <= n` and `ox`, `oy`, `oz` are disjoint mutable slices of length `>= n`.
            unsafe {
                v128_store(ox.add(i) as *mut v128, rx);
                v128_store(oy.add(i) as *mut v128, ry);
                v128_store(oz.add(i) as *mut v128, rz);
            }
            i += 4;
        }

        while i < n {
            let (vx, vy, vz) = (in_x[i], in_y[i], in_z[i]);
            out_x[i] = r[0][0] * vx + r[0][1] * vy + r[0][2] * vz;
            out_y[i] = r[1][0] * vx + r[1][1] * vy + r[1][2] * vz;
            out_z[i] = r[2][0] * vx + r[2][1] * vy + r[2][2] * vz;
            i += 1;
        }
    }

    #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
    {
        for i in 0..n {
            let (vx, vy, vz) = (in_x[i], in_y[i], in_z[i]);
            out_x[i] = r[0][0] * vx + r[0][1] * vy + r[0][2] * vz;
            out_y[i] = r[1][0] * vx + r[1][1] * vy + r[1][2] * vz;
            out_z[i] = r[2][0] * vx + r[2][1] * vy + r[2][2] * vz;
        }
    }
}

/// SoA input packet for 4 contacts evaluated in parallel by [`eval_contact_dots_4`].
#[derive(Debug, Clone, Copy, Default)]
pub struct ContactBatch4 {
    pub nx: [f32; 4],
    pub ny: [f32; 4],
    pub nz: [f32; 4],
    pub rax: [f32; 4],
    pub ray: [f32; 4],
    pub raz: [f32; 4],
    pub rbx: [f32; 4],
    pub rby: [f32; 4],
    pub rbz: [f32; 4],
    pub vax: [f32; 4],
    pub vay: [f32; 4],
    pub vaz: [f32; 4],
    pub vbx: [f32; 4],
    pub vby: [f32; 4],
    pub vbz: [f32; 4],
    pub wax: [f32; 4],
    pub way: [f32; 4],
    pub waz: [f32; 4],
    pub wbx: [f32; 4],
    pub wby: [f32; 4],
    pub wbz: [f32; 4],
    pub inv_mass_a: [f32; 4],
    pub inv_mass_b: [f32; 4],
    /// Symmetric world-space inverse inertia tensor of body A (`[xx, yy, zz, xy, xz, yz]`).
    pub ia_xx: [f32; 4],
    pub ia_yy: [f32; 4],
    pub ia_zz: [f32; 4],
    pub ia_xy: [f32; 4],
    pub ia_xz: [f32; 4],
    pub ia_yz: [f32; 4],
    /// Symmetric world-space inverse inertia tensor of body B (`[xx, yy, zz, xy, xz, yz]`).
    pub ib_xx: [f32; 4],
    pub ib_yy: [f32; 4],
    pub ib_zz: [f32; 4],
    pub ib_xy: [f32; 4],
    pub ib_xz: [f32; 4],
    pub ib_yz: [f32; 4],
}

/// Output of [`eval_contact_dots_4`] for 4 contacts computed in parallel.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct ContactDots4 {
    /// Relative normal velocity `dot((va + wa × ra) - (vb + wb × rb), n)` for each lane.
    pub vn: [f32; 4],
    /// Effective mass reciprocal `K_n = inv_ma + inv_mb + (ra×n)^T I_a^-1 (ra×n) + (rb×n)^T I_b^-1 (rb×n)`.
    pub inv_eff_mass: [f32; 4],
    /// Precomputed angular velocity response `I_a^-1 * (ra × n)` per lane.
    pub ang_n_a: [[f32; 3]; 4],
    /// Precomputed angular velocity response `I_b^-1 * (rb × n)` per lane.
    pub ang_n_b: [[f32; 3]; 4],
}

/// Evaluates 4 contact relative normal velocities, effective mass reciprocals, and
/// angular impulse responses in parallel.
///
/// On `wasm32` with `simd128`, computes all 4 lanes simultaneously using `f32x4`
/// instructions; on native targets, executes the exact scalar equivalent.
pub fn eval_contact_dots_4(b: &ContactBatch4) -> ContactDots4 {
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        use core::arch::wasm32::{f32x4_add, f32x4_mul, f32x4_sub, v128, v128_load, v128_store};

        #[inline]
        fn ld(a: &[f32; 4]) -> v128 {
            // SAFETY: `[f32; 4]` is 16 bytes contiguous in memory; `v128_load` allows unaligned loads.
            unsafe { v128_load(a.as_ptr() as *const v128) }
        }

        #[inline]
        fn st(v: v128) -> [f32; 4] {
            let mut out = [0.0f32; 4];
            // SAFETY: `out` is 16 bytes contiguous in memory; `v128_store` allows unaligned stores.
            unsafe { v128_store(out.as_mut_ptr() as *mut v128, v) };
            out
        }

        #[inline]
        fn cross_v(ax: v128, ay: v128, az: v128, bx: v128, by: v128, bz: v128) -> (v128, v128, v128) {
            (
                f32x4_sub(f32x4_mul(ay, bz), f32x4_mul(az, by)),
                f32x4_sub(f32x4_mul(az, bx), f32x4_mul(ax, bz)),
                f32x4_sub(f32x4_mul(ax, by), f32x4_mul(ay, bx)),
            )
        }

        #[inline]
        fn dot_v(ax: v128, ay: v128, az: v128, bx: v128, by: v128, bz: v128) -> v128 {
            f32x4_add(
                f32x4_add(f32x4_mul(ax, bx), f32x4_mul(ay, by)),
                f32x4_mul(az, bz),
            )
        }

        #[inline]
        fn sym3_mul_v(
            xx: v128,
            yy: v128,
            zz: v128,
            xy: v128,
            xz: v128,
            yz: v128,
            vx: v128,
            vy: v128,
            vz: v128,
        ) -> (v128, v128, v128) {
            (
                f32x4_add(f32x4_add(f32x4_mul(xx, vx), f32x4_mul(xy, vy)), f32x4_mul(xz, vz)),
                f32x4_add(f32x4_add(f32x4_mul(xy, vx), f32x4_mul(yy, vy)), f32x4_mul(yz, vz)),
                f32x4_add(f32x4_add(f32x4_mul(xz, vx), f32x4_mul(yz, vy)), f32x4_mul(zz, vz)),
            )
        }

        let (nx, ny, nz) = (ld(&b.nx), ld(&b.ny), ld(&b.nz));
        let (rax, ray, raz) = (ld(&b.rax), ld(&b.ray), ld(&b.raz));
        let (rbx, rby, rbz) = (ld(&b.rbx), ld(&b.rby), ld(&b.rbz));

        // Relative contact point velocity: (va + wa × ra) - (vb + wb × rb)
        let (wra_x, wra_y, wra_z) = cross_v(ld(&b.wax), ld(&b.way), ld(&b.waz), rax, ray, raz);
        let (wrb_x, wrb_y, wrb_z) = cross_v(ld(&b.wbx), ld(&b.wby), ld(&b.wbz), rbx, rby, rbz);
        let rvx = f32x4_sub(f32x4_add(ld(&b.vax), wra_x), f32x4_add(ld(&b.vbx), wrb_x));
        let rvy = f32x4_sub(f32x4_add(ld(&b.vay), wra_y), f32x4_add(ld(&b.vby), wrb_y));
        let rvz = f32x4_sub(f32x4_add(ld(&b.vaz), wra_z), f32x4_add(ld(&b.vbz), wrb_z));
        let vn_v = dot_v(rvx, rvy, rvz, nx, ny, nz);

        // Angular terms: rn_a = ra × n, ang_a = I_a^-1 * rn_a (and symmetrically for B)
        let (rna_x, rna_y, rna_z) = cross_v(rax, ray, raz, nx, ny, nz);
        let (rnb_x, rnb_y, rnb_z) = cross_v(rbx, rby, rbz, nx, ny, nz);
        let (anga_x, anga_y, anga_z) = sym3_mul_v(
            ld(&b.ia_xx),
            ld(&b.ia_yy),
            ld(&b.ia_zz),
            ld(&b.ia_xy),
            ld(&b.ia_xz),
            ld(&b.ia_yz),
            rna_x,
            rna_y,
            rna_z,
        );
        let (angb_x, angb_y, angb_z) = sym3_mul_v(
            ld(&b.ib_xx),
            ld(&b.ib_yy),
            ld(&b.ib_zz),
            ld(&b.ib_xy),
            ld(&b.ib_xz),
            ld(&b.ib_yz),
            rnb_x,
            rnb_y,
            rnb_z,
        );

        let ka = dot_v(rna_x, rna_y, rna_z, anga_x, anga_y, anga_z);
        let kb = dot_v(rnb_x, rnb_y, rnb_z, angb_x, angb_y, angb_z);
        let inv_m = f32x4_add(f32x4_add(ld(&b.inv_mass_a), ld(&b.inv_mass_b)), f32x4_add(ka, kb));

        let (ax, ay, az) = (st(anga_x), st(anga_y), st(anga_z));
        let (bx, by, bz) = (st(angb_x), st(angb_y), st(angb_z));
        ContactDots4 {
            vn: st(vn_v),
            inv_eff_mass: st(inv_m),
            ang_n_a: [
                [ax[0], ay[0], az[0]],
                [ax[1], ay[1], az[1]],
                [ax[2], ay[2], az[2]],
                [ax[3], ay[3], az[3]],
            ],
            ang_n_b: [
                [bx[0], by[0], bz[0]],
                [bx[1], by[1], bz[1]],
                [bx[2], by[2], bz[2]],
                [bx[3], by[3], bz[3]],
            ],
        }
    }

    #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
    {
        let mut out = ContactDots4::default();
        for i in 0..4 {
            let n = [b.nx[i], b.ny[i], b.nz[i]];
            let ra = [b.rax[i], b.ray[i], b.raz[i]];
            let rb = [b.rbx[i], b.rby[i], b.rbz[i]];
            let va = [b.vax[i], b.vay[i], b.vaz[i]];
            let vb = [b.vbx[i], b.vby[i], b.vbz[i]];
            let wa = [b.wax[i], b.way[i], b.waz[i]];
            let wb = [b.wbx[i], b.wby[i], b.wbz[i]];

            let v_rel = sub3(add3(va, cross3(wa, ra)), add3(vb, cross3(wb, rb)));
            out.vn[i] = dot3(v_rel, n);

            let rna = cross3(ra, n);
            let rnb = cross3(rb, n);
            let ia = [b.ia_xx[i], b.ia_yy[i], b.ia_zz[i], b.ia_xy[i], b.ia_xz[i], b.ia_yz[i]];
            let ib = [b.ib_xx[i], b.ib_yy[i], b.ib_zz[i], b.ib_xy[i], b.ib_xz[i], b.ib_yz[i]];
            let ang_a = mul_sym3(&ia, rna);
            let ang_b = mul_sym3(&ib, rnb);
            out.ang_n_a[i] = ang_a;
            out.ang_n_b[i] = ang_b;
            out.inv_eff_mass[i] = b.inv_mass_a[i] + b.inv_mass_b[i] + dot3(rna, ang_a) + dot3(rnb, ang_b);
        }
        out
    }
}

// ── Persistent Contact Manifold Cache ───────────────────────────────────────

/// Persistent key for a contact point across steps.
///
/// `body_b_id == WORLD_BODY_ID` (`0`) denotes static world ground.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ManifoldKey {
    pub body_a_id: u32,
    pub body_b_id: u32,
    pub feature_key: u64,
}

impl ManifoldKey {
    #[inline]
    pub const fn new(body_a_id: u32, body_b_id: u32, feature_key: u64) -> Self {
        Self {
            body_a_id,
            body_b_id,
            feature_key,
        }
    }
}

/// Builds a deterministic persistent feature key from a collision sample point index
/// and quantized contact face/feature tag.
#[inline]
pub const fn make_feature_key(point_idx: u32, face_tag: u8) -> u64 {
    ((point_idx as u64) << 8) | (face_tag as u64)
}

/// Cached accumulated contact impulses stored across solver steps.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CachedImpulse {
    /// Accumulated normal impulse (`>= 0`).
    pub jn: f32,
    /// Accumulated tangent impulse along `t1`.
    pub jt1: f32,
    /// Accumulated tangent impulse along `t2`.
    pub jt2: f32,
    /// Tangent axis 1 from the step that stored this impulse.
    pub t1: [f32; 3],
    /// Tangent axis 2 from the step that stored this impulse.
    pub t2: [f32; 3],
    /// Step number when this contact was last active.
    pub last_step: u64,
}

/// Persistent contact manifold cache keyed by `(body_a_id, body_b_id, feature_key)`.
///
/// Stores accumulated normal & 2-axis tangent impulses for warm-starting the next step
/// and evicts stale contacts that have not been refreshed within `max_stale_steps`.
#[derive(Debug, Clone)]
pub struct ManifoldCache {
    entries: FastMap<ManifoldKey, CachedImpulse>,
    max_stale_steps: u64,
    warm_hits: u64,
    warm_misses: u64,
}

impl Default for ManifoldCache {
    fn default() -> Self {
        Self::new()
    }
}

impl ManifoldCache {
    pub fn new() -> Self {
        Self::with_max_stale_steps(1)
    }

    pub fn with_max_stale_steps(max_stale_steps: u64) -> Self {
        Self {
            entries: FastMap::default(),
            max_stale_steps,
            warm_hits: 0,
            warm_misses: 0,
        }
    }

    #[inline]
    pub fn set_max_stale_steps(&mut self, max_stale_steps: u64) {
        self.max_stale_steps = max_stale_steps;
    }

    #[inline]
    pub fn max_stale_steps(&self) -> u64 {
        self.max_stale_steps
    }

    #[inline]
    pub fn get(&self, key: ManifoldKey) -> Option<CachedImpulse> {
        self.entries.get(&key).copied()
    }

    #[inline]
    pub fn store(&mut self, key: ManifoldKey, impulse: CachedImpulse) {
        self.entries.insert(key, impulse);
    }

    /// Evicts entries not refreshed within `max_stale_steps` of `current_step`.
    /// Returns the number of evicted contacts.
    pub fn evict_stale(&mut self, current_step: u64) -> usize {
        let before = self.entries.len();
        let max_age = self.max_stale_steps;
        self.entries
            .retain(|_, v| current_step.saturating_sub(v.last_step) <= max_age);
        before - self.entries.len()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.warm_hits = 0;
        self.warm_misses = 0;
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[inline]
    pub fn warm_hits(&self) -> u64 {
        self.warm_hits
    }

    #[inline]
    pub fn warm_misses(&self) -> u64 {
        self.warm_misses
    }
}

// ── TGS-Soft Contact Solver ─────────────────────────────────────────────────

/// Rigid body view passed into [`TgsContactSolver`].
///
/// Mirrors the kinematic and inertial fields of `bodies::Body` so `Bodies::step()`
/// can sync into and out of the solver in ~20 lines without rewriting body storage.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ContactBody {
    pub id: u32,
    pub pos: [f32; 3],
    pub rot: [f32; 4],
    pub vel: [f32; 3],
    pub spin: [f32; 3],
    pub inv_mass: f32,
    pub inv_inertia: [[f32; 3]; 3],
    /// Peak normal delta-V experienced in the last solve (cells/s).
    pub knock: f32,
}

impl ContactBody {
    /// Creates a solid uniform box body of dimensions `size` (cells) and `mass`.
    pub fn new_box(id: u32, pos: [f32; 3], size: [f32; 3], mass: f32) -> Self {
        let inv_mass = if mass > 0.0 { 1.0 / mass } else { 0.0 };
        let inv_inertia = if mass > 0.0 {
            let ix = mass * (size[1] * size[1] + size[2] * size[2]) / 12.0;
            let iy = mass * (size[0] * size[0] + size[2] * size[2]) / 12.0;
            let iz = mass * (size[0] * size[0] + size[1] * size[1]) / 12.0;
            [
                [if ix > 1e-9 { 1.0 / ix } else { 0.0 }, 0.0, 0.0],
                [0.0, if iy > 1e-9 { 1.0 / iy } else { 0.0 }, 0.0],
                [0.0, 0.0, if iz > 1e-9 { 1.0 / iz } else { 0.0 }],
            ]
        } else {
            [[0.0; 3]; 3]
        };
        Self {
            id,
            pos,
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [0.0; 3],
            spin: [0.0; 3],
            inv_mass,
            inv_inertia,
            knock: 0.0,
        }
    }

    /// Creates a static / infinite-mass body (`inv_mass == 0`).
    pub fn new_static(id: u32, pos: [f32; 3]) -> Self {
        Self {
            id,
            pos,
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [0.0; 3],
            spin: [0.0; 3],
            inv_mass: 0.0,
            inv_inertia: [[0.0; 3]; 3],
            knock: 0.0,
        }
    }

    /// Computes symmetric world-space inverse inertia tensor `R * I_local^-1 * R^T`
    /// packed as `[xx, yy, zz, xy, xz, yz]`.
    #[inline]
    pub fn inv_inertia_world(&self) -> [f32; 6] {
        if self.inv_mass == 0.0 {
            return [0.0; 6];
        }
        let r = quat_to_mat3(self.rot);
        let i = &self.inv_inertia;
        // t = R * I_local^-1
        let mut t = [[0.0f32; 3]; 3];
        for row in 0..3 {
            for col in 0..3 {
                t[row][col] = r[row][0] * i[0][col] + r[row][1] * i[1][col] + r[row][2] * i[2][col];
            }
        }
        // W = t * R^T (symmetric)
        let xx = dot3(t[0], r[0]);
        let yy = dot3(t[1], r[1]);
        let zz = dot3(t[2], r[2]);
        let xy = dot3(t[0], r[1]);
        let xz = dot3(t[0], r[2]);
        let yz = dot3(t[1], r[2]);
        [xx, yy, zz, xy, xz, yz]
    }

    /// Velocity of a point at world-space lever arm `r` from center of mass.
    #[inline]
    pub fn speed_at(&self, r: [f32; 3]) -> [f32; 3] {
        add3(self.vel, cross3(self.spin, r))
    }

    /// Integrates position and orientation quaternion over `dt` (matches `bodies::Bodies::step`).
    #[inline]
    pub fn integrate_position(&mut self, dt: f32) {
        if self.inv_mass == 0.0 {
            return;
        }
        self.pos = add3(self.pos, scale3(self.vel, dt));
        let w = self.spin;
        let q = self.rot;
        let half = 0.5 * dt;
        let dq = [
            half * (w[0] * q[3] + w[1] * q[2] - w[2] * q[1]),
            half * (w[1] * q[3] + w[2] * q[0] - w[0] * q[2]),
            half * (w[2] * q[3] + w[0] * q[1] - w[1] * q[0]),
            half * (-w[0] * q[0] - w[1] * q[1] - w[2] * q[2]),
        ];
        let nq = [q[0] + dq[0], q[1] + dq[1], q[2] + dq[2], q[3] + dq[3]];
        let len = (nq[0] * nq[0] + nq[1] * nq[1] + nq[2] * nq[2] + nq[3] * nq[3]).sqrt();
        if len > 1e-9 {
            let inv = 1.0 / len;
            self.rot = [nq[0] * inv, nq[1] * inv, nq[2] * inv, nq[3] * inv];
        }
    }
}

/// One contact point submitted to [`TgsContactSolver`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ContactPoint {
    pub body_a: usize,
    /// Body B slice index, or [`WORLD_BODY_INDEX`] for static world ground.
    pub body_b: usize,
    pub body_a_id: u32,
    /// Stable body B ID, or [`WORLD_BODY_ID`] (`0`) for static world ground.
    pub body_b_id: u32,
    /// Persistent feature key for [`ManifoldCache`] lookup.
    pub feature_key: u64,
    /// Lever arm from body A's center of mass in world space (cells).
    pub ra: [f32; 3],
    /// Lever arm from body B's center of mass in world space (`[0; 3]` for ground).
    pub rb: [f32; 3],
    /// Unit contact normal pointing from B toward A (push direction for body A).
    pub normal: [f32; 3],
    /// Penetration depth in cells (`> 0` overlapping, `< 0` speculative separation gap).
    pub depth: f32,
    /// Coulomb friction coefficient (`>= 0`).
    pub friction: f32,
    /// Restitution coefficient in `[0, 1]`.
    pub restitution: f32,
}

/// Erin Catto TGS-Soft compliance coefficients derived from contact frequency `hz`
/// and damping ratio `zeta` over step `dt`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SoftParams {
    /// Position-error feedback rate `omega / a1` (`1/s`).
    pub bias_rate: f32,
    /// Effective-mass scaling factor `a2 / (1 + a2)`.
    pub mass_coeff: f32,
    /// Impulse softness factor `1 / (1 + a2)`.
    pub impulse_coeff: f32,
}

impl SoftParams {
    /// Computes Box2D v3 / Erin Catto TGS-Soft coefficients from `(hz, zeta, dt)`.
    #[inline]
    pub fn new(hz: f32, zeta: f32, dt: f32) -> Self {
        if hz <= 0.0 || dt <= 0.0 {
            return Self {
                bias_rate: 0.0,
                mass_coeff: 1.0,
                impulse_coeff: 0.0,
            };
        }
        let omega = 2.0 * core::f32::consts::PI * hz;
        let a1 = 2.0 * zeta + dt * omega;
        let a2 = dt * omega * a1;
        let a3 = 1.0 / (1.0 + a2);
        Self {
            bias_rate: omega / a1,
            mass_coeff: a2 * a3,
            impulse_coeff: a3,
        }
    }
}

/// Configuration for [`TgsContactSolver`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TgsConfig {
    /// Contact natural frequency in Hz (default `30.0`, capped internally to `0.25 / dt`).
    pub hz: f32,
    /// Contact damping ratio (default `1.0`, critically damped).
    pub zeta: f32,
    /// Velocity iterations per step with soft bias (default `4`).
    pub iterations: usize,
    /// Post-integration hard velocity relaxation iterations (default `1`).
    pub relax_iterations: usize,
    /// Fraction of previous step's accumulated impulse applied on warm start (default `0.85`).
    pub warm_start_scale: f32,
    /// Minimum closing speed (cells/s) required to trigger restitution (default `10.0` = `1.0 m/s`).
    pub restitution_threshold: f32,
    /// Maximum soft position-recovery speed (cells/s, default `30.0` = `3.0 m/s`).
    pub max_push_velocity: f32,
    /// Stale contact lifetime in steps before eviction from [`ManifoldCache`] (default `1`).
    pub max_stale_steps: u64,
    /// Alternate forward/backward Gauss-Seidel sweeps to eliminate stacking order bias (default `true`).
    pub symmetric_sweeps: bool,
}

impl Default for TgsConfig {
    fn default() -> Self {
        Self {
            hz: DEFAULT_CONTACT_HZ,
            zeta: DEFAULT_CONTACT_ZETA,
            iterations: DEFAULT_ITERATIONS,
            relax_iterations: 1,
            warm_start_scale: DEFAULT_WARM_START_SCALE,
            restitution_threshold: 10.0,
            max_push_velocity: 30.0,
            max_stale_steps: 1,
            symmetric_sweeps: true,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct PreparedContact {
    body_a: usize,
    body_b: usize,
    key: ManifoldKey,
    normal: [f32; 3],
    t1: [f32; 3],
    t2: [f32; 3],
    ra: [f32; 3],
    rb: [f32; 3],
    ang_n_a: [f32; 3],
    ang_n_b: [f32; 3],
    ang_t1_a: [f32; 3],
    ang_t1_b: [f32; 3],
    ang_t2_a: [f32; 3],
    ang_t2_b: [f32; 3],
    normal_mass: f32,
    /// Symmetric 2×2 tangent effective mass matrix `[m11, m12, m22]`.
    tangent_mass: [f32; 3],
    /// Separation `-depth` (`< 0` penetrating, `> 0` speculative gap).
    separation: f32,
    /// Pre-solve relative normal velocity (for restitution threshold).
    initial_vn: f32,
    friction: f32,
    restitution: f32,
    jn: f32,
    jt1: f32,
    jt2: f32,
    warm_started: bool,
}

/// Warm-started TGS-Soft contact solver with reusable scratch allocations.
pub struct TgsContactSolver {
    pub config: TgsConfig,
    pub cache: ManifoldCache,
    step_counter: u64,
    world_inv_inertia: Vec<[f32; 6]>,
    prepared: Vec<PreparedContact>,
}

impl Default for TgsContactSolver {
    fn default() -> Self {
        Self::new(TgsConfig::default())
    }
}

impl TgsContactSolver {
    pub fn new(config: TgsConfig) -> Self {
        Self {
            cache: ManifoldCache::with_max_stale_steps(config.max_stale_steps),
            config,
            step_counter: 0,
            world_inv_inertia: Vec::new(),
            prepared: Vec::new(),
        }
    }

    #[inline]
    pub fn step_count(&self) -> u64 {
        self.step_counter
    }

    /// Computes effective soft constraint parameters for `dt` (clamping `hz <= 0.25 / dt`).
    #[inline]
    pub fn soft_params(&self, dt: f32) -> SoftParams {
        let clamped_hz = if dt > 0.0 {
            self.config.hz.min(0.25 / dt)
        } else {
            self.config.hz
        };
        SoftParams::new(clamped_hz, self.config.zeta, dt)
    }

    /// Prepares all contacts for the current step using 4-wide SIMD [`eval_contact_dots_4`]
    /// and pulls persistent warm-start impulses from [`ManifoldCache`].
    pub fn prepare(&mut self, bodies: &[ContactBody], contacts: &[ContactPoint]) {
        self.cache.set_max_stale_steps(self.config.max_stale_steps);
        self.world_inv_inertia.clear();
        self.world_inv_inertia.reserve(bodies.len());
        for b in bodies {
            self.world_inv_inertia.push(b.inv_inertia_world());
        }

        self.prepared.clear();
        self.prepared.reserve(contacts.len());

        let zero_i = [0.0f32; 6];
        let warm_scale = self.config.warm_start_scale.clamp(0.0, 1.0);

        let mut base = 0usize;
        while base < contacts.len() {
            let count = (contacts.len() - base).min(4);
            let mut batch = ContactBatch4::default();

            for lane in 0..count {
                let c = &contacts[base + lane];
                let ba = &bodies[c.body_a];
                let ia = &self.world_inv_inertia[c.body_a];
                batch.nx[lane] = c.normal[0];
                batch.ny[lane] = c.normal[1];
                batch.nz[lane] = c.normal[2];
                batch.rax[lane] = c.ra[0];
                batch.ray[lane] = c.ra[1];
                batch.raz[lane] = c.ra[2];
                batch.vax[lane] = ba.vel[0];
                batch.vay[lane] = ba.vel[1];
                batch.vaz[lane] = ba.vel[2];
                batch.wax[lane] = ba.spin[0];
                batch.way[lane] = ba.spin[1];
                batch.waz[lane] = ba.spin[2];
                batch.inv_mass_a[lane] = ba.inv_mass;
                batch.ia_xx[lane] = ia[0];
                batch.ia_yy[lane] = ia[1];
                batch.ia_zz[lane] = ia[2];
                batch.ia_xy[lane] = ia[3];
                batch.ia_xz[lane] = ia[4];
                batch.ia_yz[lane] = ia[5];

                if c.body_b != WORLD_BODY_INDEX {
                    let bb = &bodies[c.body_b];
                    let ib = &self.world_inv_inertia[c.body_b];
                    batch.rbx[lane] = c.rb[0];
                    batch.rby[lane] = c.rb[1];
                    batch.rbz[lane] = c.rb[2];
                    batch.vbx[lane] = bb.vel[0];
                    batch.vby[lane] = bb.vel[1];
                    batch.vbz[lane] = bb.vel[2];
                    batch.wbx[lane] = bb.spin[0];
                    batch.wby[lane] = bb.spin[1];
                    batch.wbz[lane] = bb.spin[2];
                    batch.inv_mass_b[lane] = bb.inv_mass;
                    batch.ib_xx[lane] = ib[0];
                    batch.ib_yy[lane] = ib[1];
                    batch.ib_zz[lane] = ib[2];
                    batch.ib_xy[lane] = ib[3];
                    batch.ib_xz[lane] = ib[4];
                    batch.ib_yz[lane] = ib[5];
                }
            }

            let dots = eval_contact_dots_4(&batch);

            for lane in 0..count {
                let c = &contacts[base + lane];
                let ba_inv_m = bodies[c.body_a].inv_mass;
                let ia = &self.world_inv_inertia[c.body_a];
                let (bb_inv_m, ib) = if c.body_b != WORLD_BODY_INDEX {
                    (bodies[c.body_b].inv_mass, &self.world_inv_inertia[c.body_b])
                } else {
                    (0.0, &zero_i)
                };

                let kn = dots.inv_eff_mass[lane];
                let normal_mass = if kn > 1e-12 { 1.0 / kn } else { 0.0 };

                let (t1, t2) = tangent_basis(c.normal);
                let rt1_a = cross3(c.ra, t1);
                let rt2_a = cross3(c.ra, t2);
                let ang_t1_a = mul_sym3(ia, rt1_a);
                let ang_t2_a = mul_sym3(ia, rt2_a);

                let (rt1_b, rt2_b, ang_t1_b, ang_t2_b) = if c.body_b != WORLD_BODY_INDEX {
                    let r1 = cross3(c.rb, t1);
                    let r2 = cross3(c.rb, t2);
                    (r1, r2, mul_sym3(ib, r1), mul_sym3(ib, r2))
                } else {
                    ([0.0; 3], [0.0; 3], [0.0; 3], [0.0; 3])
                };

                let inv_m_sum = ba_inv_m + bb_inv_m;
                let k11 = inv_m_sum + dot3(rt1_a, ang_t1_a) + dot3(rt1_b, ang_t1_b);
                let k22 = inv_m_sum + dot3(rt2_a, ang_t2_a) + dot3(rt2_b, ang_t2_b);
                let k12 = dot3(rt1_a, ang_t2_a) + dot3(rt1_b, ang_t2_b);
                let det = k11 * k22 - k12 * k12;
                let tangent_mass = if det > 1e-12 {
                    let inv_det = 1.0 / det;
                    [k22 * inv_det, -k12 * inv_det, k11 * inv_det]
                } else {
                    [
                        if k11 > 1e-12 { 1.0 / k11 } else { 0.0 },
                        0.0,
                        if k22 > 1e-12 { 1.0 / k22 } else { 0.0 },
                    ]
                };

                let key = ManifoldKey::new(c.body_a_id, c.body_b_id, c.feature_key);
                let (jn, jt1, jt2, warm_started) = if warm_scale > 0.0 {
                    if let Some(prev) = self.cache.get(key) {
                        self.cache.warm_hits += 1;
                        let jn = (prev.jn * warm_scale).max(0.0);
                        // Re-project cached world-space tangent impulse onto the current tangent plane.
                        let pt = add3(scale3(prev.t1, prev.jt1), scale3(prev.t2, prev.jt2));
                        let mut jt1 = dot3(pt, t1) * warm_scale;
                        let mut jt2 = dot3(pt, t2) * warm_scale;
                        let max_f = c.friction.max(0.0) * jn;
                        let mag_sq = jt1 * jt1 + jt2 * jt2;
                        if mag_sq > max_f * max_f {
                            let inv = max_f / mag_sq.sqrt().max(1e-12);
                            jt1 *= inv;
                            jt2 *= inv;
                        }
                        (jn, jt1, jt2, true)
                    } else {
                        self.cache.warm_misses += 1;
                        (0.0, 0.0, 0.0, false)
                    }
                } else {
                    (0.0, 0.0, 0.0, false)
                };

                self.prepared.push(PreparedContact {
                    body_a: c.body_a,
                    body_b: c.body_b,
                    key,
                    normal: c.normal,
                    t1,
                    t2,
                    ra: c.ra,
                    rb: c.rb,
                    ang_n_a: dots.ang_n_a[lane],
                    ang_n_b: dots.ang_n_b[lane],
                    ang_t1_a,
                    ang_t1_b,
                    ang_t2_a,
                    ang_t2_b,
                    normal_mass,
                    tangent_mass,
                    separation: -c.depth,
                    initial_vn: dots.vn[lane],
                    friction: c.friction.max(0.0),
                    restitution: c.restitution.clamp(0.0, 1.0),
                    jn,
                    jt1,
                    jt2,
                    warm_started,
                });
            }

            base += count;
        }
    }

    /// Applies warm-started impulses loaded during [`Self::prepare`] to body velocities.
    pub fn warm_start(&self, bodies: &mut [ContactBody]) {
        for c in &self.prepared {
            if !c.warm_started {
                continue;
            }
            if c.jn != 0.0 {
                apply_impulse(
                    bodies,
                    c.body_a,
                    c.body_b,
                    c.normal,
                    c.ang_n_a,
                    c.ang_n_b,
                    c.jn,
                );
            }
            if c.jt1 != 0.0 {
                apply_impulse(
                    bodies,
                    c.body_a,
                    c.body_b,
                    c.t1,
                    c.ang_t1_a,
                    c.ang_t1_b,
                    c.jt1,
                );
            }
            if c.jt2 != 0.0 {
                apply_impulse(
                    bodies,
                    c.body_a,
                    c.body_b,
                    c.t2,
                    c.ang_t2_a,
                    c.ang_t2_b,
                    c.jt2,
                );
            }
        }
    }

    /// Runs TGS-Soft velocity iterations (`use_bias = true`) or hard velocity
    /// relaxation iterations (`use_bias = false`).
    pub fn solve_velocities(&mut self, bodies: &mut [ContactBody], dt: f32, use_bias: bool) {
        let soft = self.soft_params(dt);
        let inv_dt = if dt > 0.0 { 1.0 / dt } else { 0.0 };
        let max_push = self.config.max_push_velocity;
        let iters = if use_bias {
            self.config.iterations
        } else {
            self.config.relax_iterations
        };
        let n = self.prepared.len();
        if n == 0 || iters == 0 {
            return;
        }

        let parity = if self.config.symmetric_sweeps {
            (self.step_counter as usize) & 1
        } else {
            0
        };

        for iter in 0..iters {
            let reverse = self.config.symmetric_sweeps && ((iter + parity) & 1) == 1;

            // Pass 1: solve all normal constraints before friction so multi-point manifolds
            // balance rotational torques before tangent impulses inspect contact slip velocity.
            for step_idx in 0..n {
                let idx = if reverse { n - 1 - step_idx } else { step_idx };
                let c = &mut self.prepared[idx];
                if c.normal_mass == 0.0 {
                    continue;
                }

                let va = bodies[c.body_a].speed_at(c.ra);
                let v_rel = if c.body_b == WORLD_BODY_INDEX {
                    va
                } else {
                    sub3(va, bodies[c.body_b].speed_at(c.rb))
                };
                let vn = dot3(v_rel, c.normal);

                let (bias, mass_scale, impulse_scale) = if use_bias {
                    if c.separation > 0.0 {
                        // Speculative non-penetrating contact: allow closing up to gap.
                        (c.separation * inv_dt, 1.0, 0.0)
                    } else {
                        // Overlapping contact: critically damped soft compliance.
                        let b = (soft.bias_rate * c.separation).max(-max_push);
                        (b, soft.mass_coeff, soft.impulse_coeff)
                    }
                } else {
                    (0.0, 1.0, 0.0)
                };

                let delta_jn = -c.normal_mass * mass_scale * (vn + bias) - impulse_scale * c.jn;
                let new_jn = (c.jn + delta_jn).max(0.0);
                let applied_jn = new_jn - c.jn;
                c.jn = new_jn;

                if applied_jn != 0.0 {
                    apply_impulse(
                        bodies,
                        c.body_a,
                        c.body_b,
                        c.normal,
                        c.ang_n_a,
                        c.ang_n_b,
                        applied_jn,
                    );
                }

                // Track peak normal impulse delta-V for shatter/damage telemetry.
                let knock_a = c.jn * bodies[c.body_a].inv_mass;
                if knock_a > bodies[c.body_a].knock {
                    bodies[c.body_a].knock = knock_a;
                }
                if c.body_b != WORLD_BODY_INDEX {
                    let knock_b = c.jn * bodies[c.body_b].inv_mass;
                    if knock_b > bodies[c.body_b].knock {
                        bodies[c.body_b].knock = knock_b;
                    }
                }
            }

            // Pass 2: solve all 2-axis isotropic Coulomb friction constraints.
            let friction_reverse = self.config.symmetric_sweeps && !reverse;
            for step_idx in 0..n {
                let idx = if friction_reverse { n - 1 - step_idx } else { step_idx };
                let c = &mut self.prepared[idx];
                if c.normal_mass == 0.0 {
                    continue;
                }

                let max_f = c.friction * c.jn;
                if max_f > 0.0 {
                    let va = bodies[c.body_a].speed_at(c.ra);
                    let v_rel = if c.body_b == WORLD_BODY_INDEX {
                        va
                    } else {
                        sub3(va, bodies[c.body_b].speed_at(c.rb))
                    };
                    let vt1 = dot3(v_rel, c.t1);
                    let vt2 = dot3(v_rel, c.t2);

                    let dj1 = -(c.tangent_mass[0] * vt1 + c.tangent_mass[1] * vt2);
                    let dj2 = -(c.tangent_mass[1] * vt1 + c.tangent_mass[2] * vt2);
                    let mut new_jt1 = c.jt1 + dj1;
                    let mut new_jt2 = c.jt2 + dj2;
                    let mag_sq = new_jt1 * new_jt1 + new_jt2 * new_jt2;
                    if mag_sq > max_f * max_f {
                        let inv_mag = max_f / mag_sq.sqrt().max(1e-12);
                        new_jt1 *= inv_mag;
                        new_jt2 *= inv_mag;
                    }
                    let applied_jt1 = new_jt1 - c.jt1;
                    let applied_jt2 = new_jt2 - c.jt2;
                    c.jt1 = new_jt1;
                    c.jt2 = new_jt2;

                    if applied_jt1 != 0.0 {
                        apply_impulse(
                            bodies,
                            c.body_a,
                            c.body_b,
                            c.t1,
                            c.ang_t1_a,
                            c.ang_t1_b,
                            applied_jt1,
                        );
                    }
                    if applied_jt2 != 0.0 {
                        apply_impulse(
                            bodies,
                            c.body_a,
                            c.body_b,
                            c.t2,
                            c.ang_t2_a,
                            c.ang_t2_b,
                            applied_jt2,
                        );
                    }
                } else if c.jt1 != 0.0 || c.jt2 != 0.0 {
                    // Unwind residual warm-started friction when normal contact opens.
                    let (u1, u2) = (-c.jt1, -c.jt2);
                    c.jt1 = 0.0;
                    c.jt2 = 0.0;
                    if u1 != 0.0 {
                        apply_impulse(bodies, c.body_a, c.body_b, c.t1, c.ang_t1_a, c.ang_t1_b, u1);
                    }
                    if u2 != 0.0 {
                        apply_impulse(bodies, c.body_a, c.body_b, c.t2, c.ang_t2_a, c.ang_t2_b, u2);
                    }
                }
            }
        }
    }

    /// Applies restitution impulses for contacts whose initial closing speed exceeded
    /// `config.restitution_threshold`. Bounce impulse is intentionally kept out of
    /// the warm-start cache so resting contacts never acquire phantom rebound.
    pub fn apply_restitution(&self, bodies: &mut [ContactBody]) {
        let threshold = -self.config.restitution_threshold;
        for c in &self.prepared {
            if c.restitution <= 0.0 || c.normal_mass == 0.0 || c.jn <= 0.0 || c.initial_vn >= threshold {
                continue;
            }
            let va = bodies[c.body_a].speed_at(c.ra);
            let v_rel = if c.body_b == WORLD_BODY_INDEX {
                va
            } else {
                sub3(va, bodies[c.body_b].speed_at(c.rb))
            };
            let vn = dot3(v_rel, c.normal);
            let target_vn = -c.restitution * c.initial_vn;
            if vn < target_vn {
                let delta_jn = c.normal_mass * (target_vn - vn);
                apply_impulse(
                    bodies,
                    c.body_a,
                    c.body_b,
                    c.normal,
                    c.ang_n_a,
                    c.ang_n_b,
                    delta_jn,
                );
            }
        }
    }

    /// Writes solved impulses back to [`ManifoldCache`] and evicts stale contacts.
    pub fn store_impulses(&mut self) {
        self.step_counter += 1;
        let step = self.step_counter;
        for c in &self.prepared {
            if c.jn > 0.0 {
                self.cache.store(
                    c.key,
                    CachedImpulse {
                        jn: c.jn,
                        jt1: c.jt1,
                        jt2: c.jt2,
                        t1: c.t1,
                        t2: c.t2,
                        last_step: step,
                    },
                );
            }
        }
        self.cache.evict_stale(step);
    }

    /// Velocity-only solve stage (`prepare` → `warm_start` → `solve_velocities(true)` →
    /// `apply_restitution` → `store_impulses`), ready for direct drop-in replacement of the
    /// contact loop in `Bodies::step()`.
    pub fn solve_step(&mut self, bodies: &mut [ContactBody], contacts: &[ContactPoint], dt: f32) {
        for b in bodies.iter_mut() {
            b.knock = 0.0;
        }
        self.prepare(bodies, contacts);
        self.warm_start(bodies);
        self.solve_velocities(bodies, dt, true);
        self.apply_restitution(bodies);
        self.store_impulses();
    }

    /// Full TGS-Soft step with position integration and post-integration velocity relaxation:
    /// `prepare` → `warm_start` → `solve_velocities(true)` → `integrate_position` →
    /// `solve_velocities(false)` → `apply_restitution` → `store_impulses`.
    pub fn solve_and_integrate(
        &mut self,
        bodies: &mut [ContactBody],
        contacts: &[ContactPoint],
        dt: f32,
    ) {
        for b in bodies.iter_mut() {
            b.knock = 0.0;
        }
        self.prepare(bodies, contacts);
        self.warm_start(bodies);
        self.solve_velocities(bodies, dt, true);
        for b in bodies.iter_mut() {
            b.integrate_position(dt);
        }
        if self.config.relax_iterations > 0 {
            self.solve_velocities(bodies, dt, false);
        }
        self.apply_restitution(bodies);
        self.store_impulses();
    }

    /// Returns the accumulated `(jn, jt1, jt2)` solved for contact `index` in the last step.
    #[inline]
    pub fn last_impulse(&self, index: usize) -> Option<(f32, f32, f32)> {
        self.prepared.get(index).map(|c| (c.jn, c.jt1, c.jt2))
    }
}

#[inline]
fn apply_impulse(
    bodies: &mut [ContactBody],
    body_a: usize,
    body_b: usize,
    axis: [f32; 3],
    ang_a: [f32; 3],
    ang_b: [f32; 3],
    mag: f32,
) {
    let ba = &mut bodies[body_a];
    if ba.inv_mass > 0.0 {
        let lin = mag * ba.inv_mass;
        ba.vel[0] += axis[0] * lin;
        ba.vel[1] += axis[1] * lin;
        ba.vel[2] += axis[2] * lin;
        ba.spin[0] += ang_a[0] * mag;
        ba.spin[1] += ang_a[1] * mag;
        ba.spin[2] += ang_a[2] * mag;
    }
    if body_b != WORLD_BODY_INDEX {
        let bb = &mut bodies[body_b];
        if bb.inv_mass > 0.0 {
            let lin = mag * bb.inv_mass;
            bb.vel[0] -= axis[0] * lin;
            bb.vel[1] -= axis[1] * lin;
            bb.vel[2] -= axis[2] * lin;
            bb.spin[0] -= ang_b[0] * mag;
            bb.spin[1] -= ang_b[1] * mag;
            bb.spin[2] -= ang_b[2] * mag;
        }
    }
}

// ── Bit-Packed 64-Bit Voxel Fast Probe & Internal-Edge Normal Welding ───────

/// Bit-packed `64³` solid-sector probe (`&[u64; 4096]`, layout `bits[(y << 6) | z]`,
/// bit `x` = cell `(x, y, z)`, matching `tree::at` and `bodies::Sector::Bits`).
///
/// Uses single-instruction `trailing_zeros` / `leading_zeros` bit-scans along X from the
/// already-loaded row word plus pruned direct bit tests along Y/Z, requiring up to 4×
/// fewer memory probes than scalar 6-axis loops, and supports internal-edge normal
/// welding across coplanar voxel surfaces.
#[derive(Clone, Copy)]
pub struct VoxelFastProbe<'a> {
    bits: &'a [u64; 4096],
    origin: [i32; 3],
    /// Maximum depth (cells) allowed when welding a grazing edge onto a coplanar surface.
    pub weld_max_depth: f32,
}

impl<'a> VoxelFastProbe<'a> {
    #[inline]
    pub const fn new(bits: &'a [u64; 4096]) -> Self {
        Self {
            bits,
            origin: [0, 0, 0],
            weld_max_depth: 0.35,
        }
    }

    #[inline]
    pub const fn with_origin(bits: &'a [u64; 4096], origin: [i32; 3]) -> Self {
        Self {
            bits,
            origin,
            weld_max_depth: 0.35,
        }
    }

    #[inline]
    pub fn set_solid(bits: &mut [u64; 4096], x: usize, y: usize, z: usize, solid: bool) {
        debug_assert!(x < 64 && y < 64 && z < 64);
        let word = &mut bits[(y << 6) | z];
        if solid {
            *word |= 1u64 << x;
        } else {
            *word &= !(1u64 << x);
        }
    }

    #[inline]
    pub fn is_solid(&self, x: i32, y: i32, z: i32) -> bool {
        let lx = x - self.origin[0];
        let ly = y - self.origin[1];
        let lz = z - self.origin[2];
        if (lx | ly | lz) < 0 || lx >= SECTOR_SIDE || ly >= SECTOR_SIDE || lz >= SECTOR_SIDE {
            return false;
        }
        (self.bits[((ly as usize) << 6) | (lz as usize)] >> (lx as u32)) & 1 != 0
    }

    #[inline]
    fn is_solid_local(&self, lx: i32, ly: i32, lz: i32) -> bool {
        if (lx | ly | lz) < 0 || lx >= SECTOR_SIDE || ly >= SECTOR_SIDE || lz >= SECTOR_SIDE {
            return false;
        }
        (self.bits[((ly as usize) << 6) | (lz as usize)] >> (lx as u32)) & 1 != 0
    }

    /// Shortest axis-aligned exit `(normal, depth)` out of solid `cell` for point `p`,
    /// bit-exact with `bodies::way_out` while reading 4× fewer words on average.
    #[inline]
    pub fn way_out(&self, p: [f32; 3], cell: [i32; 3]) -> Option<([f32; 3], f32)> {
        self.way_back_counted(p, cell, [0.0; 3]).0
    }

    /// Directional variant matching `bodies::way_back`: excludes exits facing along `r`.
    #[inline]
    pub fn way_back(&self, p: [f32; 3], cell: [i32; 3], r: [f32; 3]) -> Option<([f32; 3], f32)> {
        self.way_back_counted(p, cell, r).0
    }

    /// Returns `(way_out_result, word_reads)` for direct probe-count verification.
    pub fn way_back_counted(
        &self,
        p: [f32; 3],
        cell: [i32; 3],
        r: [f32; 3],
    ) -> (Option<([f32; 3], f32)>, u32) {
        let lx = cell[0] - self.origin[0];
        let ly = cell[1] - self.origin[1];
        let lz = cell[2] - self.origin[2];
        if (lx | ly | lz) < 0 || lx >= SECTOR_SIDE || ly >= SECTOR_SIDE || lz >= SECTOR_SIDE {
            return (None, 0);
        }

        let row_idx = ((ly as usize) << 6) | (lz as usize);
        let row_word = self.bits[row_idx];
        let mut probes = 1u32;
        let x_mask = 1u64 << (lx as u32);
        if (row_word & x_mask) == 0 {
            return (None, probes);
        }

        let long = dot3(r, r).sqrt() * 0.35;
        let allow = |axis: usize, dir: i32| !(long > 0.0 && r[axis] * dir as f32 > long);

        let inside_x = p[0] - cell[0] as f32;
        let inside_y = p[1] - cell[1] as f32;
        let inside_z = p[2] - cell[2] as f32;

        // Track best candidate using bodies::way_back's tie-break priority:
        //   (1, +1) > (0, +1) > (0, -1) > (2, +1) > (2, -1) > (1, -1).
        // Evaluate +X and -X FIRST using the already-loaded `row_word` (0 extra memory reads!)
        // so that tight X exits prune Y and Z probes before touching memory.
        let mut best: Option<([f32; 3], f32)> = None;
        let air = !row_word;

        // +X via `trailing_zeros` (0 memory reads)
        if allow(0, 1) {
            let k = if lx < 63 {
                let shifted = air >> ((lx + 1) as u32);
                if shifted != 0 {
                    shifted.trailing_zeros() as usize + 1
                } else {
                    (SECTOR_SIDE - lx) as usize
                }
            } else {
                1
            };
            if k <= PROBE_MAX_STEPS {
                let far = (1.0 - inside_x) + (k - 1) as f32;
                best = Some(([1.0, 0.0, 0.0], far));
            }
        }

        // -X via `leading_zeros` (0 memory reads)
        if allow(0, -1) {
            let first = inside_x;
            if best.is_none_or(|(_, d)| first < d) {
                let k = if lx > 0 {
                    let shifted = air << ((SECTOR_SIDE - lx) as u32);
                    if shifted != 0 {
                        shifted.leading_zeros() as usize + 1
                    } else {
                        (lx + 1) as usize
                    }
                } else {
                    1
                };
                if k <= PROBE_MAX_STEPS {
                    let far = first + (k - 1) as f32;
                    if best.is_none_or(|(_, d)| far < d) {
                        best = Some(([-1.0, 0.0, 0.0], far));
                    }
                }
            }
        }

        // +Y has higher tie-break priority than +/-X, so check whenever `first <= best`.
        if allow(1, 1) {
            let first = 1.0 - inside_y;
            for k in 1..=PROBE_MAX_STEPS {
                let far = first + (k - 1) as f32;
                if best.is_some_and(|(_, d)| far > d) {
                    break;
                }
                let ny = ly + k as i32;
                let empty = if ny >= SECTOR_SIDE {
                    true
                } else {
                    probes += 1;
                    (self.bits[((ny as usize) << 6) | (lz as usize)] & x_mask) == 0
                };
                if empty {
                    // `<=` preserves `+Y` winning exact ties against `+/-X`.
                    if best.is_none_or(|(_, d)| far <= d) {
                        best = Some(([0.0, 1.0, 0.0], far));
                    }
                    break;
                }
            }
        }

        // +Z (direct bit test)
        if allow(2, 1) {
            let first = 1.0 - inside_z;
            for k in 1..=PROBE_MAX_STEPS {
                let far = first + (k - 1) as f32;
                if best.is_some_and(|(_, d)| far >= d) {
                    break;
                }
                let nz = lz + k as i32;
                let empty = if nz >= SECTOR_SIDE {
                    true
                } else {
                    probes += 1;
                    (self.bits[((ly as usize) << 6) | (nz as usize)] & x_mask) == 0
                };
                if empty {
                    best = Some(([0.0, 0.0, 1.0], far));
                    break;
                }
            }
        }

        // -Z (direct bit test)
        if allow(2, -1) {
            let first = inside_z;
            for k in 1..=PROBE_MAX_STEPS {
                let far = first + (k - 1) as f32;
                if best.is_some_and(|(_, d)| far >= d) {
                    break;
                }
                let nz = lz - k as i32;
                let empty = if nz < 0 {
                    true
                } else {
                    probes += 1;
                    (self.bits[((ly as usize) << 6) | (nz as usize)] & x_mask) == 0
                };
                if empty {
                    best = Some(([0.0, 0.0, -1.0], far));
                    break;
                }
            }
        }

        // -Y (direct bit test)
        if allow(1, -1) {
            let first = inside_y;
            for k in 1..=PROBE_MAX_STEPS {
                let far = first + (k - 1) as f32;
                if best.is_some_and(|(_, d)| far >= d) {
                    break;
                }
                let ny = ly - k as i32;
                let empty = if ny < 0 {
                    true
                } else {
                    probes += 1;
                    (self.bits[((ny as usize) << 6) | (lz as usize)] & x_mask) == 0
                };
                if empty {
                    best = Some(([0.0, -1.0, 0.0], far));
                    break;
                }
            }
        }

        (best, probes)
    }

    /// Computes [`Self::way_out`] and applies internal-edge normal welding for coplanar
    /// voxel surfaces (eliminating ghost snags on flat floors, walls, and 1-cell seams).
    pub fn way_out_welded(&self, p: [f32; 3], cell: [i32; 3]) -> Option<([f32; 3], f32)> {
        let (n, depth) = self.way_out(p, cell)?;
        Some(self.weld_coplanar_normal(p, cell, n, depth))
    }

    /// Welds a candidate axis-aligned contact `(normal, depth)` on `cell` when it lies on
    /// an internal face between adjacent solid cells or grazes a 1-cell seam inside a
    /// continuing coplanar surface (e.g. a flat floor at `y = const`).
    pub fn weld_coplanar_normal(
        &self,
        p: [f32; 3],
        cell: [i32; 3],
        normal: [f32; 3],
        depth: f32,
    ) -> ([f32; 3], f32) {
        let lx = cell[0] - self.origin[0];
        let ly = cell[1] - self.origin[1];
        let lz = cell[2] - self.origin[2];
        if !self.is_solid_local(lx, ly, lz) {
            return (normal, depth);
        }

        // Identify the dominant axis & sign of the candidate normal.
        let (ax, dir) = {
            let (ax0, ax1, ax2) = (normal[0].abs(), normal[1].abs(), normal[2].abs());
            if ax1 >= ax0 && ax1 >= ax2 {
                (1usize, if normal[1] >= 0.0 { 1i32 } else { -1 })
            } else if ax0 >= ax2 {
                (0usize, if normal[0] >= 0.0 { 1i32 } else { -1 })
            } else {
                (2usize, if normal[2] >= 0.0 { 1i32 } else { -1 })
            }
        };

        let mut step1 = [lx, ly, lz];
        step1[ax] += dir;
        let blocked_face = self.is_solid_local(step1[0], step1[1], step1[2]);

        // Check coplanar open faces along orthogonal axes, preferring +Y (floors) first.
        const CANDIDATES: [(usize, i32); 6] = [(1, 1), (0, 1), (0, -1), (2, 1), (2, -1), (1, -1)];
        let mut best_weld: Option<([f32; 3], f32)> = None;

        for (b, db) in CANDIDATES {
            if b == ax {
                continue;
            }
            let mut open = [lx, ly, lz];
            open[b] += db;
            if self.is_solid_local(open[0], open[1], open[2]) {
                continue;
            }

            let inside_b = p[b] - cell[b] as f32;
            let depth_b = if db > 0 { 1.0 - inside_b } else { inside_b };

            if blocked_face {
                // Case 1: Candidate normal points into an adjacent solid voxel (internal edge).
                // Redirect to the shortest exposed coplanar face (especially if neighbor shares it).
                let mut adj_open = step1;
                adj_open[b] += db;
                let coplanar_neighbor = !self.is_solid_local(adj_open[0], adj_open[1], adj_open[2]);
                if coplanar_neighbor || best_weld.is_none() {
                    if best_weld.is_none_or(|(_, d)| depth_b < d) {
                        let mut wn = [0.0f32; 3];
                        wn[b] = db as f32;
                        best_weld = Some((wn, depth_b));
                    }
                }
            } else if depth_b <= self.weld_max_depth {
                // Case 2: 1-cell coplanar seam/crack (step1 is air, but step2 is solid with the
                // exact same coplanar open face along `(b, db)`).
                let mut step2 = [lx, ly, lz];
                step2[ax] += 2 * dir;
                let mut step2_open = step2;
                step2_open[b] += db;
                if self.is_solid_local(step2[0], step2[1], step2[2])
                    && !self.is_solid_local(step2_open[0], step2_open[1], step2_open[2])
                {
                    if best_weld.is_none_or(|(_, d)| depth_b < d) {
                        let mut wn = [0.0f32; 3];
                        wn[b] = db as f32;
                        best_weld = Some((wn, depth_b));
                    }
                }
            }
        }

        best_weld.unwrap_or((normal, depth))
    }
}

// ── Tests & Benchmarks ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    /// Generates 8 local corner offsets for a box of dimensions `size`.
    fn box_corners(size: [f32; 3]) -> [[f32; 3]; 8] {
        let (hx, hy, hz) = (size[0] * 0.5, size[1] * 0.5, size[2] * 0.5);
        [
            [-hx, -hy, -hz],
            [hx, -hy, -hz],
            [-hx, -hy, hz],
            [hx, -hy, hz],
            [-hx, hy, -hz],
            [hx, hy, -hz],
            [-hx, hy, hz],
            [hx, hy, hz],
        ]
    }

    /// Collects ground (`y <= 0`) and pairwise stacked-box contacts (with a small
    /// speculative contact margin so resting manifolds never flicker).
    fn collect_stack_contacts(
        bodies: &[ContactBody],
        sizes: &[[f32; 3]],
        friction: f32,
        restitution: f32,
        out: &mut Vec<ContactPoint>,
    ) {
        const SPECULATIVE_MARGIN: f32 = 0.02;
        out.clear();

        // 1. Box vs static world ground (`y = 0`)
        for (i, b) in bodies.iter().enumerate() {
            let corners = box_corners(sizes[i]);
            for (ci, &local) in corners.iter().enumerate() {
                let ra = quat_rotate(b.rot, local);
                let p = add3(b.pos, ra);
                let depth = -p[1];
                if depth > -SPECULATIVE_MARGIN {
                    out.push(ContactPoint {
                        body_a: i,
                        body_b: WORLD_BODY_INDEX,
                        body_a_id: b.id,
                        body_b_id: WORLD_BODY_ID,
                        feature_key: make_feature_key(ci as u32, 0),
                        ra,
                        rb: [0.0; 3],
                        normal: [0.0, 1.0, 0.0],
                        depth,
                        friction,
                        restitution,
                    });
                }
            }
        }

        // 2. Box-vs-box contacts (upper body's corners against lower body's OBB)
        for j in 0..bodies.len() {
            for i in (j + 1)..bodies.len() {
                let (upper, lower) = (&bodies[i], &bodies[j]);
                let (su, sl) = (sizes[i], sizes[j]);
                let q_lower_inv = [-lower.rot[0], -lower.rot[1], -lower.rot[2], lower.rot[3]];
                let (hlx, hly, hlz) = (sl[0] * 0.5, sl[1] * 0.5, sl[2] * 0.5);
                let up_world = quat_rotate(lower.rot, [0.0, 1.0, 0.0]);

                let corners = box_corners(su);
                for (ci, &local) in corners.iter().enumerate() {
                    let ra = quat_rotate(upper.rot, local);
                    let p = add3(upper.pos, ra);
                    let rb = sub3(p, lower.pos);
                    let q = quat_rotate(q_lower_inv, rb);
                    if q[0].abs() <= hlx + 0.25
                        && q[2].abs() <= hlz + 0.25
                        && q[1] >= -hly
                        && q[1] <= hly + SPECULATIVE_MARGIN
                    {
                        let depth = hly - q[1];
                        out.push(ContactPoint {
                            body_a: i,
                            body_b: j,
                            body_a_id: upper.id,
                            body_b_id: lower.id,
                            feature_key: make_feature_key(ci as u32, 1),
                            ra,
                            rb,
                            normal: up_world,
                            depth,
                            friction,
                            restitution,
                        });
                    }
                }
            }
        }
    }

    /// Cold-started PGS reference solver (same style as legacy `bodies.rs`: no warm start,
    /// hard PGS velocity loop + clamped positional Baumgarte ease) for apples-to-apples comparison.
    fn step_cold_pgs(
        bodies: &mut [ContactBody],
        contacts: &[ContactPoint],
        iterations: usize,
        dt: f32,
    ) {
        let mut solver = TgsContactSolver::new(TgsConfig {
            hz: 0.0,
            zeta: 1.0,
            iterations,
            relax_iterations: 0,
            warm_start_scale: 0.0,
            restitution_threshold: 10.0,
            max_push_velocity: 30.0,
            max_stale_steps: 0,
            symmetric_sweeps: false,
        });
        solver.prepare(bodies, contacts);
        solver.solve_velocities(bodies, dt, false);
        // Legacy positional ease matching `bodies.rs` lines 1974–1991.
        for c in contacts {
            let ease = ((c.depth - 0.05) * 0.2).clamp(0.0, 0.3);
            if ease <= 0.0 {
                continue;
            }
            if c.body_b == WORLD_BODY_INDEX {
                bodies[c.body_a].pos = add3(bodies[c.body_a].pos, scale3(c.normal, ease));
            } else {
                let (ma, mb) = (bodies[c.body_a].inv_mass, bodies[c.body_b].inv_mass);
                if ma + mb > 0.0 {
                    bodies[c.body_a].pos =
                        add3(bodies[c.body_a].pos, scale3(c.normal, ease * ma / (ma + mb)));
                    bodies[c.body_b].pos =
                        sub3(bodies[c.body_b].pos, scale3(c.normal, ease * mb / (ma + mb)));
                }
            }
        }
        for b in bodies.iter_mut() {
            b.integrate_position(dt);
        }
    }

    /// Reference scalar `way_out` identical to `bodies.rs::way_back(..., [0; 3], ...)`.
    fn scalar_way_out(
        p: [f32; 3],
        cell: [i32; 3],
        mut solid: impl FnMut([i32; 3]) -> bool,
    ) -> (Option<([f32; 3], f32)>, u32) {
        let mut probes = 1u32;
        if !solid(cell) {
            return (None, probes);
        }
        let mut best: Option<([f32; 3], f32)> = None;
        for (a, d) in [(1, 1), (0, 1), (0, -1), (2, 1), (2, -1), (1, -1)] {
            let inside = p[a] - cell[a] as f32;
            let first = if d > 0 { 1.0 - inside } else { inside };
            for k in 1..=3 {
                let far = first + (k - 1) as f32;
                if best.is_some_and(|(_, bd)| bd <= far) {
                    break;
                }
                let mut c = cell;
                c[a] += d * k;
                probes += 1;
                if !solid(c) {
                    let mut n = [0.0f32; 3];
                    n[a] = d as f32;
                    best = Some((n, far));
                    break;
                }
            }
        }
        (best, probes)
    }

    /// Unpruned naive 6-axis scalar `way_out` (scans all 6 axes up to 3 steps) for probe-count comparison.
    fn naive_scalar_way_out(
        p: [f32; 3],
        cell: [i32; 3],
        mut solid: impl FnMut([i32; 3]) -> bool,
    ) -> (Option<([f32; 3], f32)>, u32) {
        let mut probes = 1u32;
        if !solid(cell) {
            return (None, probes);
        }
        let mut best: Option<([f32; 3], f32)> = None;
        for (a, d) in [(1, 1), (0, 1), (0, -1), (2, 1), (2, -1), (1, -1)] {
            let inside = p[a] - cell[a] as f32;
            let first = if d > 0 { 1.0 - inside } else { inside };
            for k in 1..=3 {
                let far = first + (k - 1) as f32;
                let mut c = cell;
                c[a] += d * k;
                probes += 1;
                if !solid(c) {
                    if best.is_none_or(|(_, bd)| far < bd) {
                        let mut n = [0.0f32; 3];
                        n[a] = d as f32;
                        best = Some((n, far));
                    }
                    break;
                }
            }
        }
        (best, probes)
    }

    /// Simple deterministic xorshift32 PRNG for reproducible tests.
    struct Rng(u32);
    impl Rng {
        fn next_u32(&mut self) -> u32 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            self.0 = x;
            x
        }
        fn next_f32(&mut self) -> f32 {
            (self.next_u32() as f32) / (u32::MAX as f32)
        }
        fn range(&mut self, lo: f32, hi: f32) -> f32 {
            lo + (hi - lo) * self.next_f32()
        }
    }

    #[test]
    fn soft_params_analytical_values() {
        let dt = DEFAULT_DT;
        let p = SoftParams::new(30.0, 1.0, dt);
        let omega = 2.0 * core::f32::consts::PI * 30.0;
        let a1 = 2.0 + dt * omega;
        let a2 = dt * omega * a1;
        let a3 = 1.0 / (1.0 + a2);
        assert!((p.bias_rate - omega / a1).abs() < 1e-5);
        assert!((p.mass_coeff - a2 * a3).abs() < 1e-6);
        assert!((p.impulse_coeff - a3).abs() < 1e-6);
        assert!((p.mass_coeff + p.impulse_coeff - 1.0).abs() < 1e-6);
    }

    #[test]
    fn manifold_cache_warm_start_and_stale_eviction() {
        let mut solver = TgsContactSolver::new(TgsConfig {
            warm_start_scale: 0.85,
            max_stale_steps: 1,
            ..TgsConfig::default()
        });
        let mut bodies = vec![ContactBody::new_box(1, [0.0, 3.0, 0.0], [6.0; 3], 10.0)];
        let contact = ContactPoint {
            body_a: 0,
            body_b: WORLD_BODY_INDEX,
            body_a_id: 1,
            body_b_id: WORLD_BODY_ID,
            feature_key: make_feature_key(0, 0),
            ra: [0.0, -3.0, 0.0],
            rb: [0.0; 3],
            normal: [0.0, 1.0, 0.0],
            depth: 0.05,
            friction: 0.7,
            restitution: 0.0,
        };

        // Step 1: cold miss, accumulates normal impulse.
        bodies[0].vel = [2.0, -GRAVITY * DEFAULT_DT, 0.0];
        solver.solve_step(&mut bodies, &[contact], DEFAULT_DT);
        assert_eq!(solver.cache.len(), 1);
        assert_eq!(solver.cache.warm_misses(), 1);
        assert_eq!(solver.cache.warm_hits(), 0);
        let first_jn = solver.last_impulse(0).unwrap().0;
        assert!(first_jn > 5.0);

        // Step 2: warm hit at 0.85x previous impulse.
        bodies[0].vel = [0.0, -GRAVITY * DEFAULT_DT, 0.0];
        solver.prepare(&bodies, &[contact]);
        assert_eq!(solver.cache.warm_hits(), 1);
        let warm_jn = solver.last_impulse(0).unwrap().0;
        assert!(
            (warm_jn - first_jn * 0.85).abs() < 1e-4,
            "expected warm start {:.5}, got {:.5}",
            first_jn * 0.85,
            warm_jn
        );
        solver.store_impulses();

        // Step 3: contact disappears (age == 1 <= max_stale_steps == 1, survives 1-step micro-lift).
        solver.solve_step(&mut bodies, &[], DEFAULT_DT);
        assert_eq!(solver.cache.len(), 1);

        // Step 4: still absent (age == 2 > 1 -> evicted!).
        solver.solve_step(&mut bodies, &[], DEFAULT_DT);
        assert_eq!(solver.cache.len(), 0);
    }

    #[test]
    fn tall_stack_8_boxes_stability_3_seconds() {
        const COUNT: usize = 8;
        let box_size = [6.0f32, 6.0, 6.0];
        let sizes = vec![box_size; COUNT];
        let mut bodies: Vec<ContactBody> = (0..COUNT)
            .map(|i| {
                ContactBody::new_box(
                    (i + 1) as u32,
                    [0.0, box_size[1] * (i as f32 + 0.5), 0.0],
                    box_size,
                    10.0,
                )
            })
            .collect();

        let mut solver = TgsContactSolver::new(TgsConfig {
            hz: 30.0,
            zeta: 1.0,
            iterations: 4,
            relax_iterations: 1,
            warm_start_scale: 0.85,
            ..TgsConfig::default()
        });
        let mut contacts = Vec::new();
        let dt = DEFAULT_DT;

        // 0.5 s settle phase (60 steps at 120 Hz)
        for _ in 0..60 {
            for b in &mut bodies {
                b.vel[1] -= GRAVITY * dt;
            }
            collect_stack_contacts(&bodies, &sizes, 0.7, 0.0, &mut contacts);
            solver.solve_and_integrate(&mut bodies, &contacts, dt);
        }

        let settled_pos: Vec<[f32; 3]> = bodies.iter().map(|b| b.pos).collect();
        let mut max_speed = 0.0f32;
        let mut max_drift = 0.0f32;
        let mut max_lateral = 0.0f32;

        // Hold steady for 3.0 seconds (360 steps at 120 Hz) with only 4 iterations!
        for _ in 0..360 {
            for b in &mut bodies {
                b.vel[1] -= GRAVITY * dt;
            }
            collect_stack_contacts(&bodies, &sizes, 0.7, 0.0, &mut contacts);
            solver.solve_and_integrate(&mut bodies, &contacts, dt);

            for (i, b) in bodies.iter().enumerate() {
                let d = sub3(b.pos, settled_pos[i]);
                max_drift = max_drift.max(dot3(d, d).sqrt());
                max_lateral = max_lateral.max(b.pos[0].hypot(b.pos[2]));
                max_speed = max_speed.max(dot3(b.vel, b.vel).sqrt());
            }
        }

        // Also check the top box did not sag excessively from its nominal height.
        let nominal_top_y = box_size[1] * (COUNT as f32 - 0.5);
        let top_sag = (nominal_top_y - bodies[COUNT - 1].pos[1]).abs();

        eprintln!(
            "tall_stack_8_boxes: max_drift={max_drift:.5} cells, top_sag={top_sag:.4} cells, max_lateral={max_lateral:.5}, max_speed={max_speed:.5}, warm_hits={}",
            solver.cache.warm_hits()
        );

        assert!(
            max_drift < 0.05,
            "8-box stack drifted {max_drift:.5} cells over 3s (limit < 0.05)"
        );
        assert!(
            max_lateral < 0.05,
            "8-box stack slid laterally by {max_lateral:.5} cells"
        );
        assert!(
            max_speed < 0.5,
            "8-box stack jittered with max speed {max_speed:.4} cells/s"
        );
        assert!(
            top_sag < 0.35,
            "8-box stack top sagged too far: {top_sag:.4} cells"
        );
        assert!(solver.cache.warm_hits() > 5000);
    }

    #[test]
    fn high_mass_ratio_20_to_1_stack_stability() {
        // 100 kg steel block resting on top of a 5 kg wooden crate (20:1 mass ratio).
        let sizes = vec![[8.0f32, 8.0, 8.0], [8.0f32, 8.0, 8.0]];
        let mut bodies = vec![
            ContactBody::new_box(1, [0.0, 4.0, 0.0], sizes[0], 5.0),
            ContactBody::new_box(2, [0.0, 12.0, 0.0], sizes[1], 100.0),
        ];

        let mut solver = TgsContactSolver::new(TgsConfig {
            hz: 30.0,
            zeta: 1.0,
            iterations: 4,
            relax_iterations: 1,
            warm_start_scale: 0.85,
            ..TgsConfig::default()
        });
        let mut contacts = Vec::new();
        let dt = DEFAULT_DT;

        // 0.75 s settle (90 steps)
        for _ in 0..90 {
            for b in &mut bodies {
                b.vel[1] -= GRAVITY * dt;
            }
            collect_stack_contacts(&bodies, &sizes, 0.7, 0.0, &mut contacts);
            solver.solve_and_integrate(&mut bodies, &contacts, dt);
        }

        let settled_crate_y = bodies[0].pos[1];
        let settled_steel_y = bodies[1].pos[1];
        let mut max_drift = 0.0f32;
        let mut max_speed = 0.0f32;

        // Hold for 3.0 s (360 steps)
        for _ in 0..360 {
            for b in &mut bodies {
                b.vel[1] -= GRAVITY * dt;
            }
            collect_stack_contacts(&bodies, &sizes, 0.7, 0.0, &mut contacts);
            solver.solve_and_integrate(&mut bodies, &contacts, dt);

            max_drift = max_drift
                .max((bodies[0].pos[1] - settled_crate_y).abs())
                .max((bodies[1].pos[1] - settled_steel_y).abs());
            for b in &bodies {
                max_speed = max_speed.max(dot3(b.vel, b.vel).sqrt());
            }
        }

        let crate_penetration = (4.0 - bodies[0].pos[1]).max(0.0);
        let inter_penetration = (8.0 - (bodies[1].pos[1] - bodies[0].pos[1])).max(0.0);
        eprintln!(
            "high_mass_ratio_20_to_1: crate_y={:.4}, steel_y={:.4}, crate_pen={crate_penetration:.4}, inter_pen={inter_penetration:.4}, max_drift={max_drift:.5}, max_speed={max_speed:.5}",
            bodies[0].pos[1], bodies[1].pos[1]
        );

        assert!(
            crate_penetration < 0.5,
            "5 kg crate crushed into ground: pen={crate_penetration:.4} cells"
        );
        assert!(
            inter_penetration < 0.5,
            "100 kg steel block sank into crate: pen={inter_penetration:.4} cells"
        );
        assert!(
            max_drift < 0.05,
            "20:1 stack drifted {max_drift:.5} cells after settling"
        );
        assert!(
            max_speed < 0.5,
            "20:1 stack unstable: max_speed={max_speed:.4} cells/s"
        );
        // Steel block stays centered above crate without tipping.
        assert!(bodies[1].pos[0].hypot(bodies[1].pos[2]) < 0.05);
    }

    #[test]
    fn warm_tgs_beats_cold_pgs_on_6_box_stack() {
        const COUNT: usize = 6;
        let box_size = [6.0f32, 6.0, 6.0];
        let sizes = vec![box_size; COUNT];
        let make_stack = || -> Vec<ContactBody> {
            (0..COUNT)
                .map(|i| {
                    ContactBody::new_box(
                        (i + 1) as u32,
                        [0.0, box_size[1] * (i as f32 + 0.5), 0.0],
                        box_size,
                        10.0,
                    )
                })
                .collect()
        };

        let mut tgs_bodies = make_stack();
        let mut pgs_bodies = make_stack();
        let mut tgs_solver = TgsContactSolver::new(TgsConfig {
            hz: 30.0,
            zeta: 1.0,
            iterations: 4,
            relax_iterations: 1,
            warm_start_scale: 0.85,
            ..TgsConfig::default()
        });
        let mut contacts = Vec::new();
        let dt = DEFAULT_DT;

        let mut tgs_vel_err = 0.0f32;
        let mut pgs_vel_err = 0.0f32;
        let mut tgs_max_pen = 0.0f32;
        let mut pgs_max_pen = 0.0f32;

        for step in 0..240 {
            for b in &mut tgs_bodies {
                b.vel[1] -= GRAVITY * dt;
            }
            collect_stack_contacts(&tgs_bodies, &sizes, 0.7, 0.0, &mut contacts);
            if step >= 120 {
                for c in &contacts {
                    tgs_max_pen = tgs_max_pen.max(c.depth.max(0.0));
                }
            }
            tgs_solver.solve_and_integrate(&mut tgs_bodies, &contacts, dt);

            for b in &mut pgs_bodies {
                b.vel[1] -= GRAVITY * dt;
            }
            collect_stack_contacts(&pgs_bodies, &sizes, 0.7, 0.0, &mut contacts);
            if step >= 120 {
                for c in &contacts {
                    pgs_max_pen = pgs_max_pen.max(c.depth.max(0.0));
                }
            }
            step_cold_pgs(&mut pgs_bodies, &contacts, 4, dt);

            if step >= 120 {
                for b in &tgs_bodies {
                    tgs_vel_err += dot3(b.vel, b.vel).sqrt();
                }
                for b in &pgs_bodies {
                    pgs_vel_err += dot3(b.vel, b.vel).sqrt();
                }
            }
        }

        let samples = (120 * COUNT) as f32;
        let tgs_avg_vel = tgs_vel_err / samples;
        let pgs_avg_vel = pgs_vel_err / samples;

        eprintln!(
            "warm_tgs_vs_cold_pgs (6-box, 4-iter): TGS pen={tgs_max_pen:.4} avg_v={tgs_avg_vel:.5} | PGS pen={pgs_max_pen:.4} avg_v={pgs_avg_vel:.5}"
        );

        assert!(
            tgs_max_pen < pgs_max_pen,
            "expected warm TGS pen ({tgs_max_pen:.4}) < cold PGS pen ({pgs_max_pen:.4})"
        );
        assert!(
            tgs_avg_vel < pgs_avg_vel,
            "expected warm TGS vel err ({tgs_avg_vel:.5}) < cold PGS vel err ({pgs_avg_vel:.5})"
        );
    }

    #[test]
    fn simd_transform_points_soa_and_eval_contact_dots_parity() {
        let mut rng = Rng(0xC0FFEE42);

        // Random unit quaternion
        let raw_q = [
            rng.range(-1.0, 1.0),
            rng.range(-1.0, 1.0),
            rng.range(-1.0, 1.0),
            rng.range(-1.0, 1.0),
        ];
        let q_len = (raw_q[0] * raw_q[0]
            + raw_q[1] * raw_q[1]
            + raw_q[2] * raw_q[2]
            + raw_q[3] * raw_q[3])
            .sqrt();
        let q = [
            raw_q[0] / q_len,
            raw_q[1] / q_len,
            raw_q[2] / q_len,
            raw_q[3] / q_len,
        ];

        // Test 160 points (exact multiple of 4) and 163 points (with scalar tail)
        for n in [160usize, 163, 3, 1, 0] {
            let mut in_x = vec![0.0f32; n];
            let mut in_y = vec![0.0f32; n];
            let mut in_z = vec![0.0f32; n];
            for i in 0..n {
                in_x[i] = rng.range(-50.0, 50.0);
                in_y[i] = rng.range(-50.0, 50.0);
                in_z[i] = rng.range(-50.0, 50.0);
            }
            let mut out_x = vec![0.0f32; n];
            let mut out_y = vec![0.0f32; n];
            let mut out_z = vec![0.0f32; n];

            transform_points_soa(q, &in_x, &in_y, &in_z, &mut out_x, &mut out_y, &mut out_z);

            for i in 0..n {
                let expected = quat_rotate(q, [in_x[i], in_y[i], in_z[i]]);
                let err = (out_x[i] - expected[0])
                    .abs()
                    .max((out_y[i] - expected[1]).abs())
                    .max((out_z[i] - expected[2]).abs());
                assert!(
                    err < 1e-4,
                    "point {i} (n={n}) parity error {err:.2e}: got [{}, {}, {}], expected {:?}",
                    out_x[i],
                    out_y[i],
                    out_z[i],
                    expected
                );
                // Within 1e-5 for unit-scale points: normalize error by point magnitude when > 1.
                let scale = in_x[i].abs().max(in_y[i].abs()).max(in_z[i].abs()).max(1.0);
                assert!(err / scale < 1e-5);
            }
        }

        // Strict <= 1e-5 absolute error across 160 random points in [-10, 10]
        let mut in_x = vec![0.0f32; 160];
        let mut in_y = vec![0.0f32; 160];
        let mut in_z = vec![0.0f32; 160];
        for i in 0..160 {
            in_x[i] = rng.range(-10.0, 10.0);
            in_y[i] = rng.range(-10.0, 10.0);
            in_z[i] = rng.range(-10.0, 10.0);
        }
        let (mut ox, mut oy, mut oz) = (vec![0.0; 160], vec![0.0; 160], vec![0.0; 160]);
        transform_points_soa(q, &in_x, &in_y, &in_z, &mut ox, &mut oy, &mut oz);
        for i in 0..160 {
            let expected = quat_rotate(q, [in_x[i], in_y[i], in_z[i]]);
            assert!((ox[i] - expected[0]).abs() < 1e-5);
            assert!((oy[i] - expected[1]).abs() < 1e-5);
            assert!((oz[i] - expected[2]).abs() < 1e-5);
        }

        // Verify eval_contact_dots_4 against explicit scalar rigid-body formulas
        let mut batch = ContactBatch4::default();
        let mut body_a_list = Vec::new();
        let mut body_b_list = Vec::new();
        for lane in 0..4 {
            let mut ba = ContactBody::new_box(
                (lane + 1) as u32,
                [0.0; 3],
                [4.0, 6.0, 8.0],
                12.0 + lane as f32 * 5.0,
            );
            ba.rot = q;
            ba.vel = [rng.range(-5.0, 5.0), rng.range(-5.0, 5.0), rng.range(-5.0, 5.0)];
            ba.spin = [rng.range(-2.0, 2.0), rng.range(-2.0, 2.0), rng.range(-2.0, 2.0)];

            let mut bb = if lane == 3 {
                ContactBody::new_static(0, [0.0; 3])
            } else {
                let mut b = ContactBody::new_box((lane + 10) as u32, [0.0; 3], [5.0, 5.0, 5.0], 20.0);
                b.rot = q;
                b.vel = [rng.range(-5.0, 5.0), rng.range(-5.0, 5.0), rng.range(-5.0, 5.0)];
                b.spin = [rng.range(-2.0, 2.0), rng.range(-2.0, 2.0), rng.range(-2.0, 2.0)];
                b
            };
            let n = unit3([rng.range(-1.0, 1.0), rng.range(-1.0, 1.0), rng.range(-1.0, 1.0)]);
            let ra = [rng.range(-3.0, 3.0), rng.range(-3.0, 3.0), rng.range(-3.0, 3.0)];
            let rb = if lane == 3 {
                [0.0; 3]
            } else {
                [rng.range(-3.0, 3.0), rng.range(-3.0, 3.0), rng.range(-3.0, 3.0)]
            };
            let ia = ba.inv_inertia_world();
            let ib = bb.inv_inertia_world();

            batch.nx[lane] = n[0];
            batch.ny[lane] = n[1];
            batch.nz[lane] = n[2];
            batch.rax[lane] = ra[0];
            batch.ray[lane] = ra[1];
            batch.raz[lane] = ra[2];
            batch.rbx[lane] = rb[0];
            batch.rby[lane] = rb[1];
            batch.rbz[lane] = rb[2];
            batch.vax[lane] = ba.vel[0];
            batch.vay[lane] = ba.vel[1];
            batch.vaz[lane] = ba.vel[2];
            batch.vbx[lane] = bb.vel[0];
            batch.vby[lane] = bb.vel[1];
            batch.vbz[lane] = bb.vel[2];
            batch.wax[lane] = ba.spin[0];
            batch.way[lane] = ba.spin[1];
            batch.waz[lane] = ba.spin[2];
            batch.wbx[lane] = bb.spin[0];
            batch.wby[lane] = bb.spin[1];
            batch.wbz[lane] = bb.spin[2];
            batch.inv_mass_a[lane] = ba.inv_mass;
            batch.inv_mass_b[lane] = bb.inv_mass;
            batch.ia_xx[lane] = ia[0];
            batch.ia_yy[lane] = ia[1];
            batch.ia_zz[lane] = ia[2];
            batch.ia_xy[lane] = ia[3];
            batch.ia_xz[lane] = ia[4];
            batch.ia_yz[lane] = ia[5];
            batch.ib_xx[lane] = ib[0];
            batch.ib_yy[lane] = ib[1];
            batch.ib_zz[lane] = ib[2];
            batch.ib_xy[lane] = ib[3];
            batch.ib_xz[lane] = ib[4];
            batch.ib_yz[lane] = ib[5];

            bb.knock = 0.0;
            body_a_list.push((ba, ra, n));
            body_b_list.push((bb, rb));
        }

        let dots = eval_contact_dots_4(&batch);
        for lane in 0..4 {
            let (ba, ra, n) = body_a_list[lane];
            let (bb, rb) = body_b_list[lane];
            let ref_vn = dot3(sub3(ba.speed_at(ra), bb.speed_at(rb)), n);
            let rna = cross3(ra, n);
            let rnb = cross3(rb, n);
            let ang_a = mul_sym3(&ba.inv_inertia_world(), rna);
            let ang_b = mul_sym3(&bb.inv_inertia_world(), rnb);
            let ref_k = ba.inv_mass + bb.inv_mass + dot3(cross3(ang_a, ra), n) + dot3(cross3(ang_b, rb), n);
            assert!((dots.vn[lane] - ref_vn).abs() < 1e-5);
            assert!((dots.inv_eff_mass[lane] - ref_k).abs() < 1e-5);
        }
    }

    #[test]
    fn voxel_fast_probe_floors_walls_corners_and_coplanar_welding() {
        let mut bits = Box::new([0u64; 4096]);

        // 1. Flat floor at y = 0..=10 across whole 64×64 sector
        for y in 0..=10 {
            for z in 0..64 {
                bits[(y << 6) | z] = u64::MAX;
            }
        }
        // 2. Vertical wall at x = 30..=35, y = 11..=30, z = 10..=50
        for y in 11..=30 {
            for z in 10..=50 {
                for x in 30..=35 {
                    VoxelFastProbe::set_solid(&mut bits, x, y, z, true);
                }
            }
        }
        // 3. Isolated block for corner tests at x = 45..=50, y = 15..=20, z = 20..=25
        for y in 15..=20 {
            for z in 20..=25 {
                for x in 45..=50 {
                    VoxelFastProbe::set_solid(&mut bits, x, y, z, true);
                }
            }
        }
        // 4. Coplanar floor with a 1-cell seam at x = 15 (solid at x = 10..=14 and x = 16..=20, y = 25)
        for z in 10..=20 {
            for x in 10..=14 {
                VoxelFastProbe::set_solid(&mut bits, x, 25, z, true);
            }
            for x in 16..=20 {
                VoxelFastProbe::set_solid(&mut bits, x, 25, z, true);
            }
        }

        let probe = VoxelFastProbe::new(&bits);

        // Compare `VoxelFastProbe::way_out` bit-for-bit against scalar `way_out` on floors, walls, corners, boundaries
        let samples = [
            // Floor center & floor internal seam between solid (9,10,15) and (10,10,15)
            ([10.5, 10.92, 15.5], [10, 10, 15]),
            ([10.01, 10.92, 15.5], [10, 10, 15]),
            ([0.05, 10.95, 0.05], [0, 10, 0]),
            ([63.95, 10.95, 63.95], [63, 10, 63]),
            // Wall -X face, +X face, +Z face, -Z face
            ([30.08, 20.5, 30.5], [30, 20, 30]),
            ([35.92, 20.5, 30.5], [35, 20, 30]),
            ([32.5, 20.5, 50.91], [32, 20, 50]),
            ([32.5, 20.5, 10.09], [32, 20, 10]),
            // Wall interior (k = 2 along -X)
            ([31.2, 20.5, 30.5], [31, 20, 30]),
            // Corner block: top, side, and exact tie
            ([45.05, 20.85, 22.5], [45, 20, 22]),
            ([45.20, 20.95, 22.5], [45, 20, 22]),
            ([45.10, 20.90, 22.5], [45, 20, 22]), // exact tie: +Y must beat -X!
            ([50.95, 15.05, 25.95], [50, 15, 25]),
            // Deep buried cell (no exit within 3 cells)
            ([32.5, 5.5, 32.5], [32, 5, 32]),
            // Air cell
            ([32.5, 40.5, 32.5], [32, 40, 32]),
        ];

        let mut fast_total_probes = 0u32;
        let mut naive_total_probes = 0u32;

        for (p, cell) in samples {
            let (fast_res, fast_probes) = probe.way_back_counted(p, cell, [0.0; 3]);
            let (ref_res, _) = scalar_way_out(p, cell, |c| probe.is_solid(c[0], c[1], c[2]));
            let (naive_res, naive_probes) =
                naive_scalar_way_out(p, cell, |c| probe.is_solid(c[0], c[1], c[2]));
            assert_eq!(fast_res, ref_res, "mismatch at p={p:?}, cell={cell:?}");
            assert_eq!(fast_res, naive_res, "naive mismatch at p={p:?}, cell={cell:?}");
            fast_total_probes += fast_probes;
            naive_total_probes += naive_probes;
        }

        // Verify probe count reduction across typical wall & floor surface contacts (4x+ fewer probes)
        let mut surface_fast = 0u32;
        let mut surface_naive = 0u32;
        for z in 12..=48 {
            // Wall -X contact (x = 30.05) -> 1 word read in VoxelFastProbe!
            let (_, fp) = probe.way_back_counted([30.05, 20.5, z as f32 + 0.5], [30, 20, z], [0.0; 3]);
            let (_, np) = naive_scalar_way_out([30.05, 20.5, z as f32 + 0.5], [30, 20, z], |c| {
                probe.is_solid(c[0], c[1], c[2])
            });
            surface_fast += fp;
            surface_naive += np;
            // Floor +Y contact (y = 10.95) -> 2 word reads in VoxelFastProbe!
            let (_, fp2) = probe.way_back_counted([10.05, 10.95, z as f32 + 0.5], [10, 10, z], [0.0; 3]);
            let (_, np2) = naive_scalar_way_out([10.05, 10.95, z as f32 + 0.5], [10, 10, z], |c| {
                probe.is_solid(c[0], c[1], c[2])
            });
            surface_fast += fp2;
            surface_naive += np2;
        }
        let ratio = surface_naive as f32 / surface_fast as f32;
        eprintln!(
            "voxel_fast_probe: surface probes fast={surface_fast} vs naive={surface_naive} ({ratio:.2}x fewer probes; mixed samples fast={fast_total_probes} vs naive={naive_total_probes})"
        );
        assert!(
            ratio >= 4.0,
            "expected >= 4x fewer probes on surface queries, got {ratio:.2}x"
        );

        // Verify internal-edge normal welding:
        // (a) Solid-to-solid coplanar floor seam: raw horizontal normal [-1, 0, 0] welds to +Y [0, 1, 0]
        let (welded_n, welded_d) =
            probe.weld_coplanar_normal([10.01, 10.92, 15.5], [10, 10, 15], [-1.0, 0.0, 0.0], 0.01);
        assert_eq!(welded_n, [0.0, 1.0, 0.0]);
        assert!((welded_d - 0.08).abs() < 1e-5);

        // (b) 1-cell coplanar floor seam at x = 15 (solid x=14 and x=16 at y=25):
        //     point grazing x = 16.02, y = 25.92 would normally snag on -X (dist 0.02),
        //     but `way_out_welded` welds cleanly to coplanar floor normal [0, 1, 0] (dist 0.08)!
        let raw_seam = probe.way_out([16.02, 25.92, 15.5], [16, 25, 15]).unwrap();
        assert_eq!(raw_seam.0, [-1.0, 0.0, 0.0]);
        let welded_seam = probe.way_out_welded([16.02, 25.92, 15.5], [16, 25, 15]).unwrap();
        assert_eq!(welded_seam.0, [0.0, 1.0, 0.0]);
        assert!((welded_seam.1 - 0.08).abs() < 1e-5);

        // (c) True exterior corner (block at x = 45..=50, air at x = 43 and 44) must NOT falsely weld
        let ext_corner = probe.way_out_welded([45.02, 20.92, 22.5], [45, 20, 22]).unwrap();
        assert_eq!(ext_corner.0, [-1.0, 0.0, 0.0]);
        // (d) True wall face must NOT weld
        let wall_hit = probe.way_out_welded([30.05, 20.5, 30.5], [30, 20, 30]).unwrap();
        assert_eq!(wall_hit.0, [-1.0, 0.0, 0.0]);
    }

    #[test]
    fn restitution_threshold_and_coulomb_friction() {
        let mut solver = TgsContactSolver::new(TgsConfig {
            restitution_threshold: 10.0,
            ..TgsConfig::default()
        });

        // 1. Slow impact below restitution threshold -> zero bounce
        let mut slow_bodies = vec![ContactBody::new_box(1, [0.0, 2.98, 0.0], [6.0; 3], 10.0)];
        slow_bodies[0].vel = [0.0, -3.0, 0.0];
        let contact = ContactPoint {
            body_a: 0,
            body_b: WORLD_BODY_INDEX,
            body_a_id: 1,
            body_b_id: WORLD_BODY_ID,
            feature_key: 0,
            ra: [0.0, -3.0, 0.0],
            rb: [0.0; 3],
            normal: [0.0, 1.0, 0.0],
            depth: 0.02,
            friction: 0.6,
            restitution: 0.8,
        };
        solver.solve_and_integrate(&mut slow_bodies, &[contact], DEFAULT_DT);
        assert!(
            slow_bodies[0].vel[1].abs() < 0.2,
            "slow impact should not bounce: vy={:.4}",
            slow_bodies[0].vel[1]
        );

        // 2. Fast impact above restitution threshold -> rebounds at ~0.8x closing speed
        solver.cache.clear();
        let mut fast_bodies = vec![ContactBody::new_box(2, [0.0, 2.95, 0.0], [6.0; 3], 10.0)];
        fast_bodies[0].vel = [0.0, -40.0, 0.0];
        let fast_contact = ContactPoint {
            body_a_id: 2,
            depth: 0.05,
            ..contact
        };
        solver.solve_and_integrate(&mut fast_bodies, &[fast_contact], DEFAULT_DT);
        assert!(
            (fast_bodies[0].vel[1] - 32.0).abs() < 1.0,
            "expected ~32.0 rebound, got {:.3}",
            fast_bodies[0].vel[1]
        );

        // 3. Sliding block with 2-axis diagonal velocity decelerates smoothly to stop via friction
        solver.cache.clear();
        let mut slider = vec![ContactBody::new_box(3, [0.0, 3.0, 0.0], [6.0; 3], 10.0)];
        slider[0].vel = [20.0, 0.0, 15.0]; // speed = 25 cells/s along (0.8, 0.6)
        let sizes = vec![[6.0; 3]];
        let mut contacts = Vec::new();
        for _ in 0..80 {
            slider[0].vel[1] -= GRAVITY * DEFAULT_DT;
            collect_stack_contacts(&slider, &sizes, 0.7, 0.0, &mut contacts);
            solver.solve_and_integrate(&mut slider, &contacts, DEFAULT_DT);
        }
        let final_horiz = slider[0].vel[0].hypot(slider[0].vel[2]);
        assert!(
            final_horiz < 0.1,
            "sliding block should stop under friction, remaining speed={final_horiz:.4}"
        );
    }

    #[test]
    fn bench_1000_contacts_4_iterations() {
        const NUM_BODIES: usize = 250;
        const CONTACTS_PER_BODY: usize = 4; // 1,000 contacts total
        let mut bodies: Vec<ContactBody> = (0..NUM_BODIES)
            .map(|i| {
                let mut b = ContactBody::new_box(
                    (i + 1) as u32,
                    [(i % 25) as f32 * 8.0, 3.0, (i / 25) as f32 * 8.0],
                    [6.0, 6.0, 6.0],
                    10.0,
                );
                b.vel = [0.2, -GRAVITY * DEFAULT_DT, -0.1];
                b
            })
            .collect();

        let corners = [
            [-3.0f32, -3.0, -3.0],
            [3.0, -3.0, -3.0],
            [-3.0, -3.0, 3.0],
            [3.0, -3.0, 3.0],
        ];
        let mut contacts = Vec::with_capacity(NUM_BODIES * CONTACTS_PER_BODY);
        for i in 0..NUM_BODIES {
            for (ci, &ra) in corners.iter().enumerate() {
                contacts.push(ContactPoint {
                    body_a: i,
                    body_b: WORLD_BODY_INDEX,
                    body_a_id: (i + 1) as u32,
                    body_b_id: WORLD_BODY_ID,
                    feature_key: make_feature_key(ci as u32, 0),
                    ra,
                    rb: [0.0; 3],
                    normal: [0.0, 1.0, 0.0],
                    depth: 0.02,
                    friction: 0.7,
                    restitution: 0.0,
                });
            }
        }
        assert_eq!(contacts.len(), 1000);

        let mut solver = TgsContactSolver::new(TgsConfig {
            iterations: 4,
            relax_iterations: 1,
            ..TgsConfig::default()
        });

        // Warm-up passes to populate ManifoldCache and reusable buffers.
        for _ in 0..5 {
            for b in &mut bodies {
                b.vel[1] = -GRAVITY * DEFAULT_DT;
            }
            solver.solve_step(&mut bodies, &contacts, DEFAULT_DT);
        }

        const ROUNDS: usize = 20;
        let start = Instant::now();
        for _ in 0..ROUNDS {
            for b in &mut bodies {
                b.vel[1] = -GRAVITY * DEFAULT_DT;
            }
            solver.solve_step(&mut bodies, &contacts, DEFAULT_DT);
        }
        let elapsed_ms = start.elapsed().as_secs_f64() * 1e3 / ROUNDS as f64;
        eprintln!(
            "bench_1000_contacts_4_iterations: {elapsed_ms:.3} ms/step (1000 contacts x 4 iters, warm_hits={})",
            solver.cache.warm_hits()
        );
        assert!(
            elapsed_ms < 5.0,
            "1000 contacts x 4 iters took {elapsed_ms:.3} ms (budget < 5.0 ms)"
        );
    }
}
