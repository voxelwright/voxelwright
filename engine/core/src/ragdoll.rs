//! Articulated 13-bone active ragdoll & dismemberment engine (#166).
//!
//! Zero-dependency, deterministic rigid-body simulation built for Voxelwright's
//! 10 cm cell scale (`G = 98.0 cells/s^2`), matching the exact character
//! proportions and joint conventions of `engine/page/people.ts` and
//! `engine/page/moves.ts` (standing height ~18.1 cells = 1.81 m, pelvis at
//! `y = 9.45`, hip line at `y = 9.0`, shoulder line at `y = 14.6`).
//!
//! # Architecture
//! - **13-bone articulated tree (`BoneId`)**: Pelvis root -> Chest -> Head,
//!   bilateral UpperArm -> Forearm and Thigh -> Shin -> Foot chains.
//! - **Analytical capsule colliders**: exact closest-point capsule-vs-voxel-world
//!   collision with interior-face snag filtering, plus capsule-vs-capsule
//!   inter-ragdoll and weapon contact resolution.
//! - **XPBD + Implicit PD muscle motors**: sub-stepped (`>= 240 Hz` internal
//!   step) position-based ball-socket & anatomical angular limit constraints
//!   (hinge limits on knees/elbows/ankles; swing-cone + twist limits on
//!   hips/shoulders/spine/neck) paired with unconditionally stable 3x3
//!   Backward-Euler PD angular motors with torque caps.
//! - **4-state active ragdoll blending (`RagdollMode`)**: `Locomotion`,
//!   localized `HitReaction`, muscular-tone `FullRagdoll`, and prone/supine
//!   procedural `GetUp`.
//! - **Two-tier dismemberment**: Tier A joint-boundary severing spawning
//!   momentum-conserving articulated `DetachedLimb` chains, and Tier B
//!   `MidLimbSlice` voxelization (`10 x 10 x 16` at 2.5 cm = `0.25` cells)
//!   with arbitrary world-plane cleaving into proximal stump + distal body.
//! - **Compact wire codec (`pack_pose` / `unpack_pose`)**: 67 bytes per ragdoll
//!   (12 B pelvis pos + 52 B smallest-three `u32` quaternions + 2 B
//!   `missing_limbs` + 1 B `mode`), with max round-trip angular error < 0.003 rad.

use std::f32::consts::{FRAC_1_SQRT_2, FRAC_PI_2, PI};

/// Gravity acceleration in Voxelwright cells/s^2 (`1 cell = 10 cm`).
pub const G: f32 = 98.0;

/// Number of bones in the standard humanoid skeleton.
pub const BONE_COUNT: usize = 13;

/// Number of parent-child joints in the 13-bone tree.
pub const JOINT_COUNT: usize = BONE_COUNT - 1;

/// Standing hip joint height above the floor in cells (`THIGH 4.5 + CALF 4.0 + SOLE 0.5`).
pub const STAND_HIP_HEIGHT: f32 = 9.0;

/// Standing pelvis center-of-mass height above the floor in cells.
pub const STAND_PELVIS_COM_HEIGHT: f32 = 9.45;

/// Nominal fine voxel pitch used by `people.ts` and `MidLimbSlice` (`2.5 cm = 0.25 cells`).
pub const SLICE_PITCH_CELLS: f32 = 0.25;

/// Width, depth, and length of the compact Tier-B mid-limb voxel slice grid (`10 x 10 x 16`).
pub const SLICE_NX: usize = 10;
pub const SLICE_NY: usize = 10;
pub const SLICE_NZ: usize = 16;
pub const SLICE_VOXELS: usize = SLICE_NX * SLICE_NY * SLICE_NZ;

/// Packed wire packet size in bytes:
/// 12 B pelvis pos + 52 B (13 * 4 B smallest-three quats) + 2 B `missing_limbs` + 1 B `mode`.
pub const POSE_WIRE_BYTES: usize = 12 + BONE_COUNT * 4 + 2 + 1;

/// 3D vector in cell units (`+X` right, `+Y` up, `+Z` back / `-Z` forward at `yaw = 0`).
pub type Vec3 = [f32; 3];

/// Unit quaternion stored as `[x, y, z, w]`.
pub type Quat = [f32; 4];

/// Identity quaternion `[0, 0, 0, 1]`.
pub const QUAT_IDENTITY: Quat = [0.0, 0.0, 0.0, 1.0];

// ── Vector & Quaternion Math ────────────────────────────────────────────────

#[inline]
pub fn v_add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

#[inline]
pub fn v_sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

#[inline]
pub fn v_scale(a: Vec3, s: f32) -> Vec3 {
    [a[0] * s, a[1] * s, a[2] * s]
}

#[inline]
pub fn v_neg(a: Vec3) -> Vec3 {
    [-a[0], -a[1], -a[2]]
}

#[inline]
pub fn v_dot(a: Vec3, b: Vec3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline]
pub fn v_cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[inline]
pub fn v_len_sq(a: Vec3) -> f32 {
    v_dot(a, a)
}

#[inline]
pub fn v_len(a: Vec3) -> f32 {
    v_dot(a, a).sqrt()
}

#[inline]
pub fn v_unit_or(a: Vec3, fallback: Vec3) -> Vec3 {
    let l2 = v_len_sq(a);
    if l2 > 1e-12 {
        v_scale(a, l2.sqrt().recip())
    } else {
        fallback
    }
}

#[inline]
fn v_clamp_len(a: Vec3, max_len: f32) -> Vec3 {
    let l2 = v_len_sq(a);
    if l2 > max_len * max_len && l2 > 1e-12 {
        v_scale(a, max_len / l2.sqrt())
    } else {
        a
    }
}

#[inline]
fn v_perp(n: Vec3) -> Vec3 {
    let other = if n[0].abs() < 0.8 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
    v_unit_or(v_cross(n, other), [0.0, 0.0, 1.0])
}

#[inline]
pub fn q_conj(q: Quat) -> Quat {
    [-q[0], -q[1], -q[2], q[3]]
}

#[inline]
pub fn q_norm(q: Quat) -> Quat {
    let l2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
    if l2 > 1e-12 && l2.is_finite() {
        let inv = l2.sqrt().recip();
        [q[0] * inv, q[1] * inv, q[2] * inv, q[3] * inv]
    } else {
        QUAT_IDENTITY
    }
}

#[inline]
pub fn q_mul(a: Quat, b: Quat) -> Quat {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}

#[inline]
pub fn q_rotate(q: Quat, v: Vec3) -> Vec3 {
    let u = [q[0], q[1], q[2]];
    let t = v_scale(v_cross(u, v), 2.0);
    v_add(v_add(v, v_scale(t, q[3])), v_cross(u, t))
}

#[inline]
pub fn q_inv_rotate(q: Quat, v: Vec3) -> Vec3 {
    q_rotate(q_conj(q), v)
}

#[inline]
pub fn q_from_axis_angle(axis: Vec3, angle: f32) -> Quat {
    let a = v_unit_or(axis, [0.0, 1.0, 0.0]);
    let half = 0.5 * angle;
    let (s, c) = half.sin_cos();
    [a[0] * s, a[1] * s, a[2] * s, c]
}

/// Exponential map from a 3D rotation vector `rv = axis * angle` to a unit quaternion.
#[inline]
pub fn q_from_rotvec(rv: Vec3) -> Quat {
    let theta2 = v_len_sq(rv);
    if theta2 < 1e-8 {
        // Second-order Taylor expansion avoids 0/0 near zero angle.
        q_norm([0.5 * rv[0], 0.5 * rv[1], 0.5 * rv[2], 1.0 - 0.125 * theta2])
    } else {
        let theta = theta2.sqrt();
        let half = 0.5 * theta;
        let k = half.sin() / theta;
        [rv[0] * k, rv[1] * k, rv[2] * k, half.cos()]
    }
}

/// Shortest-arc rotation vector `axis * angle` in `[0, pi]` for unit quaternion `q`.
#[inline]
pub fn q_to_rotvec(q: Quat) -> Vec3 {
    let q = if q[3] < 0.0 { [-q[0], -q[1], -q[2], -q[3]] } else { q };
    let v = [q[0], q[1], q[2]];
    let v_len = v_len(v);
    if v_len < 1e-6 {
        v_scale(v, 2.0)
    } else {
        let angle = 2.0 * v_len.atan2(q[3]);
        v_scale(v, angle / v_len)
    }
}

/// Geodesic angular distance in radians `[0, pi]` between two unit quaternions.
#[inline]
pub fn q_angle_between(a: Quat, b: Quat) -> f32 {
    let dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]).abs().min(1.0);
    2.0 * dot.acos()
}

/// Spherical linear interpolation along the shortest arc.
#[inline]
pub fn q_slerp(a: Quat, b: Quat, t: f32) -> Quat {
    let t = t.clamp(0.0, 1.0);
    let mut dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let b = if dot < 0.0 {
        dot = -dot;
        [-b[0], -b[1], -b[2], -b[3]]
    } else {
        b
    };
    if dot > 0.9995 {
        return q_norm([
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t,
            a[3] + (b[3] - a[3]) * t,
        ]);
    }
    let theta = dot.clamp(-1.0, 1.0).acos();
    let inv_sin = theta.sin().recip();
    let wa = ((1.0 - t) * theta).sin() * inv_sin;
    let wb = (t * theta).sin() * inv_sin;
    q_norm([
        a[0] * wa + b[0] * wb,
        a[1] * wa + b[1] * wb,
        a[2] * wa + b[2] * wb,
        a[3] * wa + b[3] * wb,
    ])
}

/// Left-multiplies `q` by a world-space angular displacement `omega * dt`.
#[inline]
fn q_integrate(q: Quat, omega: Vec3, dt: f32) -> Quat {
    let rv = v_scale(omega, dt);
    if v_len_sq(rv) < 1e-16 {
        return q;
    }
    q_norm(q_mul(q_from_rotvec(rv), q))
}

/// Applies world-space inverse inertia `I_world^-1 * v = R * diag(inv_i) * R^T * v`.
#[inline]
fn inv_inertia_mul(q: Quat, inv_i_local: Vec3, v: Vec3) -> Vec3 {
    let vl = q_inv_rotate(q, v);
    q_rotate(q, [vl[0] * inv_i_local[0], vl[1] * inv_i_local[1], vl[2] * inv_i_local[2]])
}

/// Scalar effective inverse angular inertia `axis^T * I_world^-1 * axis`.
#[inline]
fn inv_inertia_scalar(q: Quat, inv_i_local: Vec3, axis: Vec3) -> f32 {
    let vl = q_inv_rotate(q, axis);
    vl[0] * vl[0] * inv_i_local[0] + vl[1] * vl[1] * inv_i_local[1] + vl[2] * vl[2] * inv_i_local[2]
}

/// Builds the 3x3 symmetric world-space inverse inertia tensor `R * diag(inv_i) * R^T`.
#[inline]
fn inv_inertia_world_mat(q: Quat, inv_i: Vec3) -> [[f32; 3]; 3] {
    let r0 = q_rotate(q, [1.0, 0.0, 0.0]);
    let r1 = q_rotate(q, [0.0, 1.0, 0.0]);
    let r2 = q_rotate(q, [0.0, 0.0, 1.0]);
    let mut m = [[0.0f32; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = r0[i] * r0[j] * inv_i[0]
                + r1[i] * r1[j] * inv_i[1]
                + r2[i] * r2[j] * inv_i[2];
        }
    }
    m
}

/// Solves a 3x3 symmetric positive-definite linear system `A * x = b` via Cholesky `L * L^T`.
#[inline]
fn solve_spd_3x3(a: [[f32; 3]; 3], b: Vec3) -> Vec3 {
    let l00 = a[0][0].max(1e-12).sqrt();
    let l10 = a[1][0] / l00;
    let l20 = a[2][0] / l00;
    let l11 = (a[1][1] - l10 * l10).max(1e-12).sqrt();
    let l21 = (a[2][1] - l20 * l10) / l11;
    let l22 = (a[2][2] - l20 * l20 - l21 * l21).max(1e-12).sqrt();

    // Forward substitution L * y = b
    let y0 = b[0] / l00;
    let y1 = (b[1] - l10 * y0) / l11;
    let y2 = (b[2] - l20 * y0 - l21 * y1) / l22;

    // Back substitution L^T * x = y
    let x2 = y2 / l22;
    let x1 = (y1 - l21 * x2) / l11;
    let x0 = (y0 - l10 * x1 - l20 * x2) / l00;
    [x0, x1, x2]
}

#[inline]
fn smoothstep(t: f32) -> f32 {
    let c = t.clamp(0.0, 1.0);
    c * c * (3.0 - 2.0 * c)
}

/// Analytical solid-capsule principal moments of inertia in local bone space.
///
/// Enforces a modest roll-inertia floor (`>= 0.35 * I_perp`) so thin distal
/// limbs (feet, forearms) stay numerically crisp under grazing tangential blows.
fn capsule_inertia_diag(mass: f32, length: f32, radius: f32, axis: Vec3) -> Vec3 {
    let r = radius.max(0.1);
    let h_cyl = (length - 2.0 * r).max(0.0);
    let v_cyl = PI * r * r * h_cyl;
    let v_sph = (4.0 / 3.0) * PI * r * r * r;
    let v_tot = (v_cyl + v_sph).max(1e-6);
    let m_c = mass * (v_cyl / v_tot);
    let m_s = mass - m_c;

    let i_axis_raw = m_c * (0.5 * r * r) + m_s * (0.4 * r * r);
    let i_perp = m_c * (h_cyl * h_cyl / 12.0 + 0.25 * r * r)
        + m_s * (0.4 * r * r + 0.25 * h_cyl * h_cyl + 0.375 * h_cyl * r);
    let i_perp = i_perp.max(0.25);
    let i_axis = i_axis_raw.max(0.35 * i_perp).max(0.18);

    // Axis is always one of the cardinal axes (+/-X, +/-Y, +/-Z).
    if axis[0].abs() > 0.5 {
        [i_axis, i_perp, i_perp]
    } else if axis[2].abs() > 0.5 {
        [i_perp, i_perp, i_axis]
    } else {
        [i_perp, i_axis, i_perp]
    }
}

// ── 13-Bone Skeleton Identifiers ────────────────────────────────────────────

/// The 13 bones of Voxelwright's humanoid active ragdoll skeleton.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum BoneId {
    Pelvis = 0,
    Chest = 1,
    Head = 2,
    UpperArmL = 3,
    ForearmL = 4,
    UpperArmR = 5,
    ForearmR = 6,
    ThighL = 7,
    ShinL = 8,
    FootL = 9,
    ThighR = 10,
    ShinR = 11,
    FootR = 12,
}

impl BoneId {
    /// All 13 bones in topological parent-before-child order.
    pub const ALL: [BoneId; BONE_COUNT] = [
        BoneId::Pelvis,
        BoneId::Chest,
        BoneId::Head,
        BoneId::UpperArmL,
        BoneId::ForearmL,
        BoneId::UpperArmR,
        BoneId::ForearmR,
        BoneId::ThighL,
        BoneId::ShinL,
        BoneId::FootL,
        BoneId::ThighR,
        BoneId::ShinR,
        BoneId::FootR,
    ];

    /// Converts a bone index `0..13` to a `BoneId`.
    #[inline]
    pub const fn from_index(index: usize) -> Option<Self> {
        if index < BONE_COUNT {
            Some(Self::ALL[index])
        } else {
            None
        }
    }

    /// Integer index `0..13`.
    #[inline]
    pub const fn index(self) -> usize {
        self as usize
    }

    /// Single-bit mask in `missing_limbs: u16`.
    #[inline]
    pub const fn bit(self) -> u16 {
        1u16 << (self as u8)
    }

    /// Parent bone in the skeletal tree (`None` for `Pelvis`).
    #[inline]
    pub const fn parent(self) -> Option<Self> {
        match self {
            BoneId::Pelvis => None,
            BoneId::Chest => Some(BoneId::Pelvis),
            BoneId::Head => Some(BoneId::Chest),
            BoneId::UpperArmL => Some(BoneId::Chest),
            BoneId::ForearmL => Some(BoneId::UpperArmL),
            BoneId::UpperArmR => Some(BoneId::Chest),
            BoneId::ForearmR => Some(BoneId::UpperArmR),
            BoneId::ThighL => Some(BoneId::Pelvis),
            BoneId::ShinL => Some(BoneId::ThighL),
            BoneId::FootL => Some(BoneId::ShinL),
            BoneId::ThighR => Some(BoneId::Pelvis),
            BoneId::ShinR => Some(BoneId::ThighR),
            BoneId::FootR => Some(BoneId::ShinR),
        }
    }

    /// Bitmask of this bone and all of its descendants in the skeletal tree.
    #[inline]
    pub const fn subtree_mask(self) -> u16 {
        match self {
            BoneId::Pelvis => (1u16 << BONE_COUNT) - 1,
            BoneId::Chest => {
                Self::Chest.bit()
                    | Self::Head.bit()
                    | Self::UpperArmL.bit()
                    | Self::ForearmL.bit()
                    | Self::UpperArmR.bit()
                    | Self::ForearmR.bit()
            }
            BoneId::Head => Self::Head.bit(),
            BoneId::UpperArmL => Self::UpperArmL.bit() | Self::ForearmL.bit(),
            BoneId::ForearmL => Self::ForearmL.bit(),
            BoneId::UpperArmR => Self::UpperArmR.bit() | Self::ForearmR.bit(),
            BoneId::ForearmR => Self::ForearmR.bit(),
            BoneId::ThighL => Self::ThighL.bit() | Self::ShinL.bit() | Self::FootL.bit(),
            BoneId::ShinL => Self::ShinL.bit() | Self::FootL.bit(),
            BoneId::FootL => Self::FootL.bit(),
            BoneId::ThighR => Self::ThighR.bit() | Self::ShinR.bit() | Self::FootR.bit(),
            BoneId::ShinR => Self::ShinR.bit() | Self::FootR.bit(),
            BoneId::FootR => Self::FootR.bit(),
        }
    }
}

// ── Modes, Joint Definitions & Bone State ───────────────────────────────────

/// 4-state active ragdoll blending mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum RagdollMode {
    /// Upright active tracking: pelvis follows soft spring-leg anchor; limbs track target pose at gain `1.0`.
    Locomotion = 0,
    /// Localized impact: struck bone & parent chain drop gain to `0.15..0.35` for `0.25..0.6 s`, then recover.
    HitReaction = 1,
    /// Heavy knockdown/tumble: all gains drop to subtle muscular tone (`0.03..0.08`), pelvis hold disabled.
    FullRagdoll = 2,
    /// Procedural prone/supine recovery: blends to get-up keyframes while ramping gain `0.05 -> 1.0` over `0.8 s`.
    GetUp = 3,
}

impl RagdollMode {
    #[inline]
    pub const fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Locomotion,
            1 => Self::HitReaction,
            2 => Self::FullRagdoll,
            _ => Self::GetUp,
        }
    }
}

/// Detected lying posture at the start of `RagdollMode::GetUp`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GetUpOrientation {
    /// Chest/pelvis front facing downward into the ground.
    Prone,
    /// Chest/pelvis front facing upward toward the sky.
    Supine,
}

/// Anatomical angular constraint for a skeletal joint.
#[derive(Debug, Clone, Copy)]
pub enum JointLimit {
    /// 1-DOF hinge (knees, elbows, ankles) with angle bounds in radians.
    Hinge {
        /// Hinge rotation axis in both parent and child local frames (unit vector).
        axis: Vec3,
        /// Orthogonal reference axis in both parent and child local frames (unit vector).
        perp: Vec3,
        min_angle: f32,
        max_angle: f32,
    },
    /// 3-DOF ball joint with an asymmetrical swing cone and axial twist range (radians).
    SwingTwist {
        /// Center axis of the allowed swing cone in the parent's local frame (unit vector).
        cone_axis_parent: Vec3,
        /// Child limb direction & twist axis in the child's local frame (unit vector).
        twist_axis_child: Vec3,
        /// Maximum half-angle from `cone_axis_parent` in radians.
        max_swing: f32,
        min_twist: f32,
        max_twist: f32,
    },
}

/// Dynamic rigid-body & analytical capsule state for one bone.
#[derive(Debug, Clone, Copy)]
pub struct BoneState {
    /// World center-of-mass position in cells.
    pub pos: Vec3,
    /// World orientation unit quaternion `[x, y, z, w]`.
    pub rot: Quat,
    /// World linear velocity in cells/s.
    pub vel: Vec3,
    /// World angular velocity in rad/s.
    pub ang_vel: Vec3,
    /// Total end-to-end capsule length in cells.
    pub length: f32,
    /// Capsule radius in cells.
    pub radius: f32,
    /// Capsule symmetry axis in bone-local coordinates (unit vector).
    pub axis: Vec3,
    /// Bone mass in kg.
    pub mass: f32,
    /// Inverse mass (`1 / mass`).
    pub inv_mass: f32,
    /// Principal moments of inertia in bone-local space (`kg * cells^2`).
    pub local_inertia_diag: Vec3,
    /// Inverse principal moments of inertia in bone-local space.
    pub inv_local_inertia_diag: Vec3,
}

impl BoneState {
    pub fn new(pos: Vec3, rot: Quat, length: f32, radius: f32, axis: Vec3, mass: f32) -> Self {
        let axis = v_unit_or(axis, [0.0, 1.0, 0.0]);
        let mass = mass.max(0.05);
        let inertia = capsule_inertia_diag(mass, length, radius, axis);
        Self {
            pos,
            rot: q_norm(rot),
            vel: [0.0; 3],
            ang_vel: [0.0; 3],
            length,
            radius,
            axis,
            mass,
            inv_mass: 1.0 / mass,
            local_inertia_diag: inertia,
            inv_local_inertia_diag: [1.0 / inertia[0], 1.0 / inertia[1], 1.0 / inertia[2]],
        }
    }

    /// Half-length of the interior capsule line segment.
    #[inline]
    pub fn half_segment(&self) -> f32 {
        0.5 * (self.length - 2.0 * self.radius).max(0.0)
    }

    /// World-space endpoints `(a, b)` of the capsule's core line segment.
    #[inline]
    pub fn capsule_endpoints(&self) -> (Vec3, Vec3) {
        let dir = q_rotate(self.rot, self.axis);
        let h = self.half_segment();
        (v_sub(self.pos, v_scale(dir, h)), v_add(self.pos, v_scale(dir, h)))
    }

    /// Transforms a COM-local point to world space.
    #[inline]
    pub fn world_point(&self, local: Vec3) -> Vec3 {
        v_add(self.pos, q_rotate(self.rot, local))
    }

    /// Velocity of a world-space point rigidly attached to this bone.
    #[inline]
    pub fn point_velocity(&self, world_pos: Vec3) -> Vec3 {
        v_add(self.vel, v_cross(self.ang_vel, v_sub(world_pos, self.pos)))
    }

    /// Applies a world-space linear impulse at a world-space contact point.
    #[inline]
    pub fn apply_impulse_at(&mut self, world_pos: Vec3, impulse: Vec3) {
        self.vel = v_add(self.vel, v_scale(impulse, self.inv_mass));
        let torque_imp = v_cross(v_sub(world_pos, self.pos), impulse);
        let dw = inv_inertia_mul(self.rot, self.inv_local_inertia_diag, torque_imp);
        self.ang_vel = v_add(self.ang_vel, dw);
    }

    /// Tight world-space AABB enclosing the capsule.
    #[inline]
    pub fn aabb(&self) -> (Vec3, Vec3) {
        let (a, b) = self.capsule_endpoints();
        let r = self.radius;
        (
            [a[0].min(b[0]) - r, a[1].min(b[1]) - r, a[2].min(b[2]) - r],
            [a[0].max(b[0]) + r, a[1].max(b[1]) + r, a[2].max(b[2]) + r],
        )
    }
}

/// Constraint, motor, and severing descriptor for one skeletal joint.
#[derive(Debug, Clone, Copy)]
pub struct JointDef {
    pub parent: BoneId,
    pub child: BoneId,
    /// Joint pivot in parent COM-local coordinates.
    pub parent_anchor: Vec3,
    /// Joint pivot in child COM-local coordinates.
    pub child_anchor: Vec3,
    pub limit: JointLimit,
    /// Implicit PD proportional stiffness (`kg * cells^2 / (s^2 * rad)`).
    pub kp: f32,
    /// Implicit PD derivative damping (`kg * cells^2 / (s * rad)`).
    pub kd: f32,
    /// Maximum muscle torque magnitude (`kg * cells^2 / s^2`).
    pub tau_max: f32,
    /// Minimum cut energy needed to cleanly sever this joint (Tier A).
    pub sever_threshold: f32,
}

// ── Pose Channel Bridge (matches `engine/page/moves.ts` & `people.ts`) ─────

/// Subset of `engine/page/moves.ts` pose channels for constructing target poses `[Quat; 13]`.
#[derive(Debug, Clone, Copy, Default)]
pub struct PoseChannels {
    pub lean: f32,
    pub twist: f32,
    pub tilt: f32,
    pub nod: f32,
    pub turn: f32,
    pub lift_l: f32,
    pub out_l: f32,
    pub bend_l: f32,
    pub lift_r: f32,
    pub out_r: f32,
    pub bend_r: f32,
    pub swing_l: f32,
    pub knee_l: f32,
    pub ankle_l: f32,
    pub swing_r: f32,
    pub knee_r: f32,
    pub ankle_r: f32,
    pub crouch: f32,
    pub sit: f32,
}

/// Converts `people.ts` / `moves.ts` joint angles into `[Quat; 13]` target pose:
/// index 0 is pelvis world orientation, indices `1..13` are parent-relative local rotations.
pub fn pose_from_channels(yaw: f32, ch: &PoseChannels) -> [Quat; BONE_COUNT] {
    let mut pose = [QUAT_IDENTITY; BONE_COUNT];
    // Yaw = 0 faces -Z; positive yaw turns right (clockwise from above = -yaw around +Y).
    pose[BoneId::Pelvis.index()] = q_from_axis_angle([0.0, 1.0, 0.0], -yaw);

    // Chest: pitch(-lean) -> roll(tilt) -> turn(twist) matching people.ts lines 629-631.
    let q_lean = q_from_axis_angle([1.0, 0.0, 0.0], -ch.lean);
    let q_tilt = q_from_axis_angle([0.0, 0.0, 1.0], -ch.tilt);
    let q_twist = q_from_axis_angle([0.0, 1.0, 0.0], -ch.twist);
    pose[BoneId::Chest.index()] = q_norm(q_mul(q_mul(q_lean, q_tilt), q_twist));

    // Head: turn(turn) -> pitch(-nod) matching people.ts lines 692-693.
    let q_turn = q_from_axis_angle([0.0, 1.0, 0.0], -ch.turn);
    let q_nod = q_from_axis_angle([1.0, 0.0, 0.0], -ch.nod);
    pose[BoneId::Head.index()] = q_norm(q_mul(q_turn, q_nod));

    // Arms: abduct outward around +/-Z, lift forward around +X; elbow bends around +X.
    // Right arm (+X side): rotating -Y outward toward +X is +out around +Z.
    // Left arm (-X side): rotating -Y outward toward -X is -out around +Z.
    for (arm_id, fore_id, side, lift, out, bend) in [
        (BoneId::UpperArmL, BoneId::ForearmL, -1.0f32, ch.lift_l, ch.out_l, ch.bend_l),
        (BoneId::UpperArmR, BoneId::ForearmR, 1.0f32, ch.lift_r, ch.out_r, ch.bend_r),
    ] {
        let q_out = q_from_axis_angle([0.0, 0.0, 1.0], side * (0.06 + out));
        let q_lift = q_from_axis_angle([1.0, 0.0, 0.0], lift);
        pose[arm_id.index()] = q_norm(q_mul(q_out, q_lift));
        pose[fore_id.index()] = q_from_axis_angle([1.0, 0.0, 0.0], bend.clamp(0.0, 2.5));
    }

    // Legs: matching people.ts lines 578-580 & 610-618.
    for (thigh_id, shin_id, foot_id, swing_in, knee_in, ankle_in) in [
        (BoneId::ThighL, BoneId::ShinL, BoneId::FootL, ch.swing_l, ch.knee_l, ch.ankle_l),
        (BoneId::ThighR, BoneId::ShinR, BoneId::FootR, ch.swing_r, ch.knee_r, ch.ankle_r),
    ] {
        let mut swing = swing_in + ch.crouch * 0.9;
        let mut knee = knee_in + ch.crouch * 1.7;
        swing += (1.5 - swing) * ch.sit;
        knee += (1.5 - knee) * ch.sit;
        let knee = knee.clamp(0.0, 2.4);
        let ankle = (ankle_in + (swing - knee)).clamp(-0.7, 0.9);
        pose[thigh_id.index()] = q_from_axis_angle([1.0, 0.0, 0.0], swing);
        // Knee flexes backward: positive knee angle about -X axis.
        pose[shin_id.index()] = q_from_axis_angle([-1.0, 0.0, 0.0], knee);
        pose[foot_id.index()] = q_from_axis_angle([-1.0, 0.0, 0.0], ankle);
    }

    pose
}

// ── Collision Primitives ────────────────────────────────────────────────────

/// Closest points `(c1, c2)` and parameters `(s, t)` between segments `a1..b1` and `a2..b2`
/// (Ericson, Real-Time Collision Detection §5.1.9).
pub fn closest_points_segments(a1: Vec3, b1: Vec3, a2: Vec3, b2: Vec3) -> (Vec3, Vec3, f32, f32) {
    let d1 = v_sub(b1, a1);
    let d2 = v_sub(b2, a2);
    let r = v_sub(a1, a2);
    let a = v_dot(d1, d1);
    let e = v_dot(d2, d2);
    let f = v_dot(d2, r);
    const EPS: f32 = 1e-8;

    let (s, t) = if a <= EPS && e <= EPS {
        (0.0, 0.0)
    } else if a <= EPS {
        (0.0, (f / e).clamp(0.0, 1.0))
    } else {
        let c = v_dot(d1, r);
        if e <= EPS {
            ((-c / a).clamp(0.0, 1.0), 0.0)
        } else {
            let b = v_dot(d1, d2);
            let denom = a * e - b * b;
            let mut s = if denom > EPS {
                ((b * f - c * e) / denom).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let mut t = (b * s + f) / e;
            if t < 0.0 {
                t = 0.0;
                s = (-c / a).clamp(0.0, 1.0);
            } else if t > 1.0 {
                t = 1.0;
                s = ((b - c) / a).clamp(0.0, 1.0);
            }
            (s, t)
        }
    };

    (v_add(a1, v_scale(d1, s)), v_add(a2, v_scale(d2, t)), s, t)
}

/// Exact analytical parameter `t in [0, 1]` minimizing squared distance from segment `a..b`
/// to axis-aligned box `[lo, hi]`.
fn closest_t_segment_aabb(a: Vec3, b: Vec3, lo: Vec3, hi: Vec3) -> f32 {
    let ab = v_sub(b, a);
    if v_len_sq(ab) < 1e-10 {
        return 0.5;
    }

    // Derivative of F(t) = |P(t) - clamp(P(t), lo, hi)|^2 divided by 2.
    let grad = |t: f32| -> f32 {
        let px = a[0] + ab[0] * t;
        let py = a[1] + ab[1] * t;
        let pz = a[2] + ab[2] * t;
        let dx = px - px.clamp(lo[0], hi[0]);
        let dy = py - py.clamp(lo[1], hi[1]);
        let dz = pz - pz.clamp(lo[2], hi[2]);
        dx * ab[0] + dy * ab[1] + dz * ab[2]
    };

    let g0 = grad(0.0);
    let g1 = grad(1.0);
    if g0 > 0.0 {
        return 0.0;
    }
    if g1 < 0.0 {
        return 1.0;
    }

    let mut t_neg = 0.0f32;
    let mut g_neg = g0;
    let mut t_pos = 1.0f32;
    let mut g_pos = g1;
    let mut zero_min = 2.0f32;
    let mut zero_max = -1.0f32;

    if g0.abs() <= 1e-10 {
        zero_min = zero_min.min(0.0);
        zero_max = zero_max.max(0.0);
    }
    if g1.abs() <= 1e-10 {
        zero_min = zero_min.min(1.0);
        zero_max = zero_max.max(1.0);
    }

    for k in 0..3 {
        if ab[k].abs() > 1e-8 {
            for plane in [lo[k], hi[k]] {
                let t = (plane - a[k]) / ab[k];
                if t > 0.0 && t < 1.0 {
                    let g = grad(t);
                    if g.abs() <= 1e-10 {
                        zero_min = zero_min.min(t);
                        zero_max = zero_max.max(t);
                    } else if g < 0.0 && t > t_neg {
                        t_neg = t;
                        g_neg = g;
                    } else if g > 0.0 && t < t_pos {
                        t_pos = t;
                        g_pos = g;
                    }
                }
            }
        }
    }

    if zero_max >= zero_min {
        return 0.5 * (zero_min + zero_max);
    }
    let dg = g_pos - g_neg;
    if dg.abs() > 1e-12 {
        (t_neg + (t_pos - t_neg) * (-g_neg / dg)).clamp(0.0, 1.0)
    } else {
        0.5 * (t_neg + t_pos)
    }
}

/// One resolved world-voxel contact on a bone capsule.
#[derive(Debug, Clone, Copy)]
struct WorldContact {
    bone_idx: usize,
    /// Anchor point in bone COM-local space.
    local_r: Vec3,
    /// World contact normal pointing out of the solid voxel toward the capsule.
    normal: Vec3,
    /// Target contact surface point on the voxel in world space.
    world_surface: Vec3,
    /// Penetration depth at detection time (for ranking).
    depth: f32,
    /// Accumulated XPBD normal impulse (position units) for Coulomb friction.
    lambda_n: f32,
}

/// Detects up to 3 well-spread contacts between a bone capsule and the voxel world.
///
/// Filters interior shared faces between adjacent solid voxels so capsules glide
/// smoothly over tiled floors and stairs without snagging on cell seams.
fn collect_bone_voxel_contacts<F: FnMut([i32; 3]) -> bool>(
    bone_idx: usize,
    bone: &BoneState,
    solid: &mut F,
    out: &mut Vec<WorldContact>,
) {
    let (a, b) = bone.capsule_endpoints();
    let r = bone.radius;
    let ab = v_sub(b, a);
    let ab_len_sq = v_len_sq(ab);
    let quick_r2 = (r + 0.866_025_4) * (r + 0.866_025_4);

    let min_x = (a[0].min(b[0]) - r).floor() as i32;
    let max_x = (a[0].max(b[0]) + r).floor() as i32;
    let min_y = (a[1].min(b[1]) - r).floor() as i32;
    let max_y = (a[1].max(b[1]) + r).floor() as i32;
    let min_z = (a[2].min(b[2]) - r).floor() as i32;
    let max_z = (a[2].max(b[2]) + r).floor() as i32;

    // Keep deepest contact in each of 3 longitudinal buckets along the capsule:
    // [0] near endpoint A (t < 1/3), [1] middle (1/3..2/3), [2] near endpoint B (t >= 2/3).
    let mut best: [Option<WorldContact>; 3] = [None; 3];

    for iy in min_y..=max_y {
        let cy = iy as f32 + 0.5;
        for iz in min_z..=max_z {
            let cz = iz as f32 + 0.5;
            for ix in min_x..=max_x {
                if !solid([ix, iy, iz]) {
                    continue;
                }
                // Fast sphere-vs-segment rejection before exact segment-vs-AABB solve.
                let c = [ix as f32 + 0.5, cy, cz];
                let t_approx = if ab_len_sq > 1e-8 {
                    (v_dot(v_sub(c, a), ab) / ab_len_sq).clamp(0.0, 1.0)
                } else {
                    0.5
                };
                let p_approx = v_add(a, v_scale(ab, t_approx));
                if v_len_sq(v_sub(c, p_approx)) > quick_r2 {
                    continue;
                }

                let lo = [ix as f32, iy as f32, iz as f32];
                let hi = [lo[0] + 1.0, lo[1] + 1.0, lo[2] + 1.0];
                let t = closest_t_segment_aabb(a, b, lo, hi);
                let p = v_add(a, v_scale(ab, t));
                let q = [
                    p[0].clamp(lo[0], hi[0]),
                    p[1].clamp(lo[1], hi[1]),
                    p[2].clamp(lo[2], hi[2]),
                ];
                let mut d = v_sub(p, q);
                let dist_sq = v_len_sq(d);

                let (normal, depth, surface) = if dist_sq > 1e-10 {
                    if dist_sq >= r * r {
                        continue;
                    }
                    // Suppress normal components that point into an adjacent solid neighbor
                    // (eliminates internal seam catches on flat floors & walls).
                    let mut blocked_any = false;
                    let mut d_clean = d;
                    if d[0] > 1e-5 && solid([ix + 1, iy, iz]) {
                        d_clean[0] = 0.0;
                        blocked_any = true;
                    } else if d[0] < -1e-5 && solid([ix - 1, iy, iz]) {
                        d_clean[0] = 0.0;
                        blocked_any = true;
                    }
                    if d[1] > 1e-5 && solid([ix, iy + 1, iz]) {
                        d_clean[1] = 0.0;
                        blocked_any = true;
                    } else if d[1] < -1e-5 && solid([ix, iy - 1, iz]) {
                        d_clean[1] = 0.0;
                        blocked_any = true;
                    }
                    if d[2] > 1e-5 && solid([ix, iy, iz + 1]) {
                        d_clean[2] = 0.0;
                        blocked_any = true;
                    } else if d[2] < -1e-5 && solid([ix, iy, iz - 1]) {
                        d_clean[2] = 0.0;
                        blocked_any = true;
                    }

                    if blocked_any {
                        let clean_l2 = v_len_sq(d_clean);
                        if clean_l2 < 1e-10 {
                            continue;
                        }
                        d = d_clean;
                    }
                    let dist = v_len(d);
                    if dist >= r {
                        continue;
                    }
                    let n = v_scale(d, 1.0 / dist);
                    let surf = v_sub(p, d);
                    (n, r - dist, surf)
                } else {
                    // Segment point is strictly inside the solid voxel: push out along
                    // the shallowest open face (falling back to shallowest face overall).
                    let faces: [(Vec3, f32, [i32; 3]); 6] = [
                        ([0.0, 1.0, 0.0], hi[1] - p[1], [ix, iy + 1, iz]),
                        ([0.0, -1.0, 0.0], p[1] - lo[1], [ix, iy - 1, iz]),
                        ([1.0, 0.0, 0.0], hi[0] - p[0], [ix + 1, iy, iz]),
                        ([-1.0, 0.0, 0.0], p[0] - lo[0], [ix - 1, iy, iz]),
                        ([0.0, 0.0, 1.0], hi[2] - p[2], [ix, iy, iz + 1]),
                        ([0.0, 0.0, -1.0], p[2] - lo[2], [ix, iy, iz - 1]),
                    ];
                    let mut best_open: Option<(Vec3, f32)> = None;
                    let mut best_any = (faces[0].0, faces[0].1);
                    for &(n, dist_face, nb) in &faces {
                        if dist_face < best_any.1 {
                            best_any = (n, dist_face);
                        }
                        if !solid(nb) {
                            if best_open.map_or(true, |(_, bd)| dist_face < bd) {
                                best_open = Some((n, dist_face));
                            }
                        }
                    }
                    let (n, dist_face) = best_open.unwrap_or(best_any);
                    let surf = v_add(p, v_scale(n, dist_face));
                    (n, r + dist_face, surf)
                };

                let contact_on_cap = v_sub(p, v_scale(normal, r));
                let local_r = q_inv_rotate(bone.rot, v_sub(contact_on_cap, bone.pos));
                let cand = WorldContact {
                    bone_idx,
                    local_r,
                    normal,
                    world_surface: surface,
                    depth,
                    lambda_n: 0.0,
                };

                let bucket = if t < 0.3333 {
                    0
                } else if t > 0.6667 {
                    2
                } else {
                    1
                };
                if best[bucket].map_or(true, |prev| cand.depth > prev.depth) {
                    best[bucket] = Some(cand);
                }
            }
        }
    }

    for slot in best.into_iter().flatten() {
        out.push(slot);
    }
}

/// Result of an external capsule-vs-ragdoll contact resolution.
#[derive(Debug, Clone, Copy)]
pub struct CapsuleContact {
    pub bone: BoneId,
    pub world_point: Vec3,
    pub normal: Vec3,
    pub depth: f32,
}

// ── XPBD Constraint Helpers ─────────────────────────────────────────────────

/// Projects a positional attachment constraint `world_anchor_a == world_anchor_b` (zero compliance).
#[inline]
fn solve_ball_socket(
    a: &mut BoneState,
    b: &mut BoneState,
    anchor_a_local: Vec3,
    anchor_b_local: Vec3,
) {
    let ra = q_rotate(a.rot, anchor_a_local);
    let rb = q_rotate(b.rot, anchor_b_local);
    let pa = v_add(a.pos, ra);
    let pb = v_add(b.pos, rb);
    let dx = v_sub(pb, pa);
    let c2 = v_len_sq(dx);
    if c2 < 1e-12 {
        return;
    }
    let c = c2.sqrt();
    let n = v_scale(dx, 1.0 / c);

    let rxa = v_cross(ra, n);
    let rxb = v_cross(rb, n);
    let wa = a.inv_mass + inv_inertia_scalar(a.rot, a.inv_local_inertia_diag, rxa);
    let wb = b.inv_mass + inv_inertia_scalar(b.rot, b.inv_local_inertia_diag, rxb);
    let w_sum = wa + wb;
    if w_sum < 1e-12 {
        return;
    }

    let lambda = c / w_sum;
    let p = v_scale(n, lambda);

    a.pos = v_add(a.pos, v_scale(p, a.inv_mass));
    b.pos = v_sub(b.pos, v_scale(p, b.inv_mass));

    let dqa = inv_inertia_mul(a.rot, a.inv_local_inertia_diag, v_cross(ra, p));
    let dqb = inv_inertia_mul(b.rot, b.inv_local_inertia_diag, v_cross(rb, v_neg(p)));
    a.rot = q_integrate(a.rot, dqa, 1.0);
    b.rot = q_integrate(b.rot, dqb, 1.0);
}

/// Projects an angular constraint rotating `b` by `+delta_theta` relative to `a` (zero compliance).
#[inline]
fn solve_angular_correction(a: &mut BoneState, b: &mut BoneState, delta_theta: Vec3) {
    let phi2 = v_len_sq(delta_theta);
    if phi2 < 1e-12 {
        return;
    }
    let phi = phi2.sqrt();
    let n = v_scale(delta_theta, 1.0 / phi);

    let wa = inv_inertia_scalar(a.rot, a.inv_local_inertia_diag, n);
    let wb = inv_inertia_scalar(b.rot, b.inv_local_inertia_diag, n);
    let w_sum = wa + wb;
    if w_sum < 1e-12 {
        return;
    }

    let p_ang = v_scale(n, phi / w_sum);
    let dqa = inv_inertia_mul(a.rot, a.inv_local_inertia_diag, v_neg(p_ang));
    let dqb = inv_inertia_mul(b.rot, b.inv_local_inertia_diag, p_ang);
    a.rot = q_integrate(a.rot, dqa, 1.0);
    b.rot = q_integrate(b.rot, dqb, 1.0);
}

/// Exact signed hinge angle in `(-pi, pi]` for a hinge joint.
fn compute_hinge_angle(qa: Quat, qb: Quat, axis_local: Vec3, perp_local: Vec3) -> f32 {
    let a_w = q_rotate(qa, axis_local);
    let u_p = q_rotate(qa, perp_local);
    let u_c = q_rotate(qb, perp_local);
    let u_c_proj = v_sub(u_c, v_scale(a_w, v_dot(u_c, a_w)));
    let sin_a = v_dot(v_cross(u_p, u_c_proj), a_w);
    let cos_a = v_dot(u_p, u_c_proj);
    sin_a.atan2(cos_a)
}

/// Enforces either a 1-DOF hinge limit or a 3-DOF swing-cone + twist limit.
fn solve_joint_limit(a: &mut BoneState, b: &mut BoneState, limit: &JointLimit) {
    match *limit {
        JointLimit::Hinge { axis, perp, min_angle, max_angle } => {
            // 1. Align hinge axes (remove the 2 non-hinge DOFs).
            let a_p = q_rotate(a.rot, axis);
            let a_c = q_rotate(b.rot, axis);
            let dot_a = v_dot(a_c, a_p).clamp(-1.0, 1.0);
            if dot_a < 0.999_999 {
                let angle = dot_a.acos();
                let cross = v_cross(a_c, a_p);
                let align_axis = if v_len_sq(cross) > 1e-10 {
                    v_unit_or(cross, v_perp(a_p))
                } else {
                    v_perp(a_p)
                };
                solve_angular_correction(a, b, v_scale(align_axis, angle));
            }

            // 2. Clamp hinge flexion/extension angle into [min_angle, max_angle].
            let angle = compute_hinge_angle(a.rot, b.rot, axis, perp);
            if angle < min_angle {
                let a_w = q_rotate(a.rot, axis);
                solve_angular_correction(a, b, v_scale(a_w, min_angle - angle));
            } else if angle > max_angle {
                let a_w = q_rotate(a.rot, axis);
                solve_angular_correction(a, b, v_scale(a_w, max_angle - angle));
            }
        }
        JointLimit::SwingTwist {
            cone_axis_parent,
            twist_axis_child,
            max_swing,
            min_twist,
            max_twist,
        } => {
            // 1. Swing-cone limit.
            let d_p = q_rotate(a.rot, cone_axis_parent);
            let d_c = q_rotate(b.rot, twist_axis_child);
            let cos_s = v_dot(d_p, d_c).clamp(-1.0, 1.0);
            let swing = cos_s.acos();
            if swing > max_swing {
                let excess = swing - max_swing;
                let cross = v_cross(d_c, d_p);
                let swing_axis = if v_len_sq(cross) > 1e-10 {
                    v_unit_or(cross, v_perp(d_p))
                } else {
                    v_perp(d_p)
                };
                solve_angular_correction(a, b, v_scale(swing_axis, excess));
            }

            // 2. Axial twist limit via swing-twist decomposition of q_rel = conj(q_a) * q_b.
            let mut q_rel = q_mul(q_conj(a.rot), b.rot);
            if q_rel[3] < 0.0 {
                q_rel = [-q_rel[0], -q_rel[1], -q_rel[2], -q_rel[3]];
            }
            let proj = v_dot([q_rel[0], q_rel[1], q_rel[2]], twist_axis_child);
            let twist_angle = 2.0 * proj.atan2(q_rel[3]);
            if twist_angle < min_twist {
                let t_w = q_rotate(b.rot, twist_axis_child);
                solve_angular_correction(a, b, v_scale(t_w, min_twist - twist_angle));
            } else if twist_angle > max_twist {
                let t_w = q_rotate(b.rot, twist_axis_child);
                solve_angular_correction(a, b, v_scale(t_w, max_twist - twist_angle));
            }
        }
    }
}

/// Projects a unilateral world-voxel contact on a single bone capsule.
#[inline]
fn solve_world_contact_pos(bone: &mut BoneState, contact: &mut WorldContact) {
    let r_w = q_rotate(bone.rot, contact.local_r);
    let p_w = v_add(bone.pos, r_w);
    let signed_dist = v_dot(v_sub(p_w, contact.world_surface), contact.normal);
    if signed_dist >= 0.0 {
        return;
    }
    let pen = -signed_dist;
    let rxn = v_cross(r_w, contact.normal);
    let w = bone.inv_mass + inv_inertia_scalar(bone.rot, bone.inv_local_inertia_diag, rxn);
    if w < 1e-12 {
        return;
    }
    let dl = pen / w;
    contact.lambda_n += dl;
    let p = v_scale(contact.normal, dl);
    bone.pos = v_add(bone.pos, v_scale(p, bone.inv_mass));
    let dq = inv_inertia_mul(bone.rot, bone.inv_local_inertia_diag, v_cross(r_w, p));
    bone.rot = q_integrate(bone.rot, dq, 1.0);
}

/// Applies Coulomb sliding friction & normal restitution at a resolved world contact.
#[inline]
fn solve_world_contact_vel(bone: &mut BoneState, contact: &WorldContact, h: f32, mu: f32) {
    if contact.lambda_n <= 0.0 {
        return;
    }
    let r_w = q_rotate(bone.rot, contact.local_r);
    let vc = v_add(bone.vel, v_cross(bone.ang_vel, r_w));
    let vn = v_dot(vc, contact.normal);
    let mut j_n_extra = 0.0f32;
    if vn < 0.0 {
        let rxn = v_cross(r_w, contact.normal);
        let wn = bone.inv_mass + inv_inertia_scalar(bone.rot, bone.inv_local_inertia_diag, rxn);
        if wn > 1e-12 {
            let restitution = if -vn > 22.0 { 0.12 } else { 0.0 };
            j_n_extra = -(1.0 + restitution) * vn / wn;
            let imp_n = v_scale(contact.normal, j_n_extra);
            bone.vel = v_add(bone.vel, v_scale(imp_n, bone.inv_mass));
            let dw = inv_inertia_mul(bone.rot, bone.inv_local_inertia_diag, v_cross(r_w, imp_n));
            bone.ang_vel = v_add(bone.ang_vel, dw);
        }
    }

    // Re-evaluate tangential slip after normal impulse.
    let vc = v_add(bone.vel, v_cross(bone.ang_vel, r_w));
    let vn = v_dot(vc, contact.normal);
    let vt = v_sub(vc, v_scale(contact.normal, vn));
    let st = v_len(vt);
    if st > 1e-5 {
        let t_dir = v_scale(vt, 1.0 / st);
        let rxt = v_cross(r_w, t_dir);
        let wt = bone.inv_mass + inv_inertia_scalar(bone.rot, bone.inv_local_inertia_diag, rxt);
        if wt > 1e-12 {
            let j_normal = contact.lambda_n / h.max(1e-6) + j_n_extra;
            let j_fric = (st / wt).min(mu * j_normal);
            let imp_t = v_scale(t_dir, -j_fric);
            bone.vel = v_add(bone.vel, v_scale(imp_t, bone.inv_mass));
            let dw = inv_inertia_mul(bone.rot, bone.inv_local_inertia_diag, v_cross(r_w, imp_t));
            bone.ang_vel = v_add(bone.ang_vel, dw);
        }
    }
}

/// Resolves positional overlap between two dynamic capsules `(a, b)`.
fn solve_capsule_pair_pos(a: &mut BoneState, b: &mut BoneState) -> bool {
    let (a0, a1) = a.capsule_endpoints();
    let (b0, b1) = b.capsule_endpoints();
    let (ca, cb, _, _) = closest_points_segments(a0, a1, b0, b1);
    let diff = v_sub(cb, ca);
    let dist_sq = v_len_sq(diff);
    let r_sum = a.radius + b.radius;
    if dist_sq >= r_sum * r_sum {
        return false;
    }
    let dist = dist_sq.sqrt();
    let n = if dist > 1e-6 { v_scale(diff, 1.0 / dist) } else { [0.0, 1.0, 0.0] };
    let pen = r_sum - dist;

    let ra = v_sub(v_add(ca, v_scale(n, a.radius)), a.pos);
    let rb = v_sub(v_sub(cb, v_scale(n, b.radius)), b.pos);
    let rxa = v_cross(ra, n);
    let rxb = v_cross(rb, n);
    let wa = a.inv_mass + inv_inertia_scalar(a.rot, a.inv_local_inertia_diag, rxa);
    let wb = b.inv_mass + inv_inertia_scalar(b.rot, b.inv_local_inertia_diag, rxb);
    let w_sum = wa + wb;
    if w_sum < 1e-12 {
        return false;
    }
    let p = v_scale(n, pen / w_sum);
    a.pos = v_sub(a.pos, v_scale(p, a.inv_mass));
    b.pos = v_add(b.pos, v_scale(p, b.inv_mass));
    let dqa = inv_inertia_mul(a.rot, a.inv_local_inertia_diag, v_cross(ra, v_neg(p)));
    let dqb = inv_inertia_mul(b.rot, b.inv_local_inertia_diag, v_cross(rb, p));
    a.rot = q_integrate(a.rot, dqa, 1.0);
    b.rot = q_integrate(b.rot, dqb, 1.0);
    true
}

/// Applies an unconditionally stable 3x3 Backward-Euler implicit PD angular motor
/// between parent `a` and child `b` tracking local target orientation `q_target`.
fn apply_implicit_pd_motor(
    a: &mut BoneState,
    b: &mut BoneState,
    q_target_local: Quat,
    kp: f32,
    kd: f32,
    tau_max: f32,
    h: f32,
) {
    if (kp <= 0.0 && kd <= 0.0) || tau_max <= 0.0 {
        return;
    }
    let q_des = q_norm(q_mul(a.rot, q_target_local));
    let q_err = q_mul(q_des, q_conj(b.rot));
    let e = q_to_rotvec(q_err);
    let w_rel = v_sub(b.ang_vel, a.ang_vel);

    let ia = inv_inertia_world_mat(a.rot, a.inv_local_inertia_diag);
    let ib = inv_inertia_world_mat(b.rot, b.inv_local_inertia_diag);
    let beta = h * (h * kp + kd);

    let mut m = [[0.0f32; 3]; 3];
    for r in 0..3 {
        for c in 0..3 {
            m[r][c] = (if r == c { 1.0 } else { 0.0 }) + beta * (ia[r][c] + ib[r][c]);
        }
    }
    let damp_coeff = h * kp + kd;
    let rhs = [
        h * (kp * e[0] - damp_coeff * w_rel[0]),
        h * (kp * e[1] - damp_coeff * w_rel[1]),
        h * (kp * e[2] - damp_coeff * w_rel[2]),
    ];

    let j = v_clamp_len(solve_spd_3x3(m, rhs), h * tau_max);
    let dw_b = inv_inertia_mul(b.rot, b.inv_local_inertia_diag, j);
    let dw_a = inv_inertia_mul(a.rot, a.inv_local_inertia_diag, v_neg(j));
    b.ang_vel = v_add(b.ang_vel, dw_b);
    a.ang_vel = v_add(a.ang_vel, dw_a);
}

// ── Tier A Dismemberment: Detached Articulated Sub-Ragdoll ──────────────────

/// Joint inside a detached severed limb chain.
#[derive(Debug, Clone, Copy)]
pub struct DetachedJoint {
    pub parent_idx: usize,
    pub child_idx: usize,
    pub parent_anchor: Vec3,
    pub child_anchor: Vec3,
    pub limit: JointLimit,
}

/// Independent articulated capsule chain spawned when a joint is cleanly severed (Tier A).
///
/// Inherits exact world pose, linear velocity, and angular velocity from the severed subtree,
/// conserving momentum across the cut.
#[derive(Debug, Clone)]
pub struct DetachedLimb {
    pub root_bone: BoneId,
    pub bone_ids: Vec<BoneId>,
    pub bones: Vec<BoneState>,
    pub joints: Vec<DetachedJoint>,
    /// Subtle passive stiffness so detached chains settle naturally without wet-noodle collapse.
    pub tone_damping: f32,
}

impl DetachedLimb {
    /// Total mass (kg) of all bones in this detached chain.
    pub fn total_mass(&self) -> f32 {
        self.bones.iter().map(|b| b.mass).sum()
    }

    /// Total linear momentum (`sum(m_i * v_i)`) of this detached chain.
    pub fn linear_momentum(&self) -> Vec3 {
        let mut p = [0.0f32; 3];
        for b in &self.bones {
            p = v_add(p, v_scale(b.vel, b.mass));
        }
        p
    }

    /// True if all bone positions, rotations, and velocities are finite.
    pub fn is_finite(&self) -> bool {
        self.bones.iter().all(|b| {
            b.pos.iter().all(|v| v.is_finite())
                && b.rot.iter().all(|v| v.is_finite())
                && b.vel.iter().all(|v| v.is_finite())
                && b.ang_vel.iter().all(|v| v.is_finite())
        })
    }

    /// Advances the detached limb chain by `dt` seconds against a voxel world.
    pub fn step<F: FnMut([i32; 3]) -> bool>(&mut self, dt: f32, mut solid: F) {
        if self.bones.is_empty() || dt <= 0.0 {
            return;
        }
        let dt = dt.min(1.0 / 30.0);
        let substeps = ((dt * 240.0).ceil() as usize).clamp(2, 8);
        let h = dt / substeps as f32;
        let mut contacts = Vec::with_capacity(self.bones.len() * 3);
        let mut prev_pos = vec![[0.0f32; 3]; self.bones.len()];
        let mut prev_rot = vec![QUAT_IDENTITY; self.bones.len()];

        for _ in 0..substeps {
            // 1. Gravity + mild passive joint damping.
            for b in &mut self.bones {
                b.vel[1] -= G * h;
            }
            for j in &self.joints {
                let (pa, ch) = split_two_mut(&mut self.bones, j.parent_idx, j.child_idx);
                apply_implicit_pd_motor(pa, ch, QUAT_IDENTITY, 0.0, self.tone_damping, 800.0, h);
            }

            // 2. Predict positions & orientations.
            for (idx, b) in self.bones.iter_mut().enumerate() {
                prev_pos[idx] = b.pos;
                prev_rot[idx] = b.rot;
                b.pos = v_add(b.pos, v_scale(b.vel, h));
                b.rot = q_integrate(b.rot, b.ang_vel, h);
            }

            // 3. Collect voxel contacts once per substep.
            contacts.clear();
            for (idx, b) in self.bones.iter().enumerate() {
                collect_bone_voxel_contacts(idx, b, &mut solid, &mut contacts);
            }

            // 4. XPBD constraint projection.
            for iter in 0..3 {
                if iter % 2 == 0 {
                    for j in &self.joints {
                        let (pa, ch) = split_two_mut(&mut self.bones, j.parent_idx, j.child_idx);
                        solve_ball_socket(pa, ch, j.parent_anchor, j.child_anchor);
                        solve_joint_limit(pa, ch, &j.limit);
                    }
                } else {
                    for j in self.joints.iter().rev() {
                        let (pa, ch) = split_two_mut(&mut self.bones, j.parent_idx, j.child_idx);
                        solve_ball_socket(pa, ch, j.parent_anchor, j.child_anchor);
                        solve_joint_limit(pa, ch, &j.limit);
                    }
                }
                for c in &mut contacts {
                    solve_world_contact_pos(&mut self.bones[c.bone_idx], c);
                }
            }

            // 5. Derive velocities & apply Coulomb friction.
            let inv_h = 1.0 / h;
            let lin_damp = (-0.5 * h).exp();
            let ang_damp = (-1.5 * h).exp();
            for (idx, b) in self.bones.iter_mut().enumerate() {
                b.vel = v_clamp_len(v_scale(v_sub(b.pos, prev_pos[idx]), inv_h), 400.0);
                let dq = q_mul(b.rot, q_conj(prev_rot[idx]));
                b.ang_vel = v_clamp_len(v_scale(q_to_rotvec(dq), inv_h), 40.0);
                b.vel = v_scale(b.vel, lin_damp);
                b.ang_vel = v_scale(b.ang_vel, ang_damp);
            }
            for c in &contacts {
                solve_world_contact_vel(&mut self.bones[c.bone_idx], c, h, 0.72);
            }
        }
    }
}

// ── Tier B Dismemberment: Mid-Limb 10x10x16 Voxel Slice Descriptor ──────────

/// One cleaved half (proximal stump or distal severed piece) of a `MidLimbSlice`.
#[derive(Debug, Clone)]
pub struct SliceHalf {
    /// Compact `10 x 10 x 16` voxel occupancy & tissue tag (`0` air, `1` outer skin/cloth, `2` flesh, `3` bone core).
    pub voxels: [u8; SLICE_VOXELS],
    pub voxel_count: usize,
    pub mass: f32,
    pub world_com: Vec3,
    pub vel: Vec3,
    pub ang_vel: Vec3,
    pub local_inertia_diag: Vec3,
    pub min_voxel: [u8; 3],
    pub max_voxel: [u8; 3],
}

impl SliceHalf {
    #[inline]
    pub const fn voxel_index(ix: usize, iy: usize, iz: usize) -> usize {
        (iz * SLICE_NY + iy) * SLICE_NX + ix
    }

    #[inline]
    pub fn get(&self, ix: usize, iy: usize, iz: usize) -> u8 {
        self.voxels[Self::voxel_index(ix, iy, iz)]
    }

    pub fn is_finite(&self) -> bool {
        self.mass.is_finite()
            && self.world_com.iter().all(|v| v.is_finite())
            && self.vel.iter().all(|v| v.is_finite())
            && self.ang_vel.iter().all(|v| v.is_finite())
            && self.local_inertia_diag.iter().all(|v| v.is_finite())
    }
}

/// Tier-B mid-limb voxel slice: voxelizes a struck capsule bone into a compact `10 x 10 x 16`
/// grid at 2.5 cm (`0.25` cell) pitch and cleaves it cleanly along an arbitrary world plane
/// `(point, normal)` into proximal stump + distal detached body.
#[derive(Debug, Clone)]
pub struct MidLimbSlice {
    pub bone: BoneId,
    /// World orientation of the voxel grid (matches the struck bone at cut time).
    pub rot: Quat,
    /// World position of the grid center (matches the struck bone COM at cut time).
    pub origin_pos: Vec3,
    /// Local orthonormal basis `(u, v, w)` where `w` runs proximal -> distal along the capsule.
    pub basis: [Vec3; 3],
    /// Voxel pitch in world cells (`0.25` cells = 2.5 cm).
    pub voxel_size: f32,
    pub proximal: SliceHalf,
    pub distal: SliceHalf,
    /// True iff both proximal and distal halves contain at least one solid voxel.
    pub did_split: bool,
}

impl MidLimbSlice {
    /// Voxelizes `bone` into a `10 x 10 x 16` 2.5 cm grid and cleaves it by world plane `(plane_point, plane_normal)`.
    ///
    /// `proximal_anchor_local` is the parent joint anchor in `bone`'s COM-local coordinates so the
    /// proximal half is always identified on the parent side of the cut plane regardless of `plane_normal` sign.
    pub fn slice_bone(
        bone_id: BoneId,
        bone: &BoneState,
        proximal_anchor_local: Vec3,
        plane_point: Vec3,
        plane_normal: Vec3,
    ) -> Self {
        // Local orthonormal frame (u, v, w) where +w points proximal -> distal along bone.axis.
        let mut w = v_unit_or(bone.axis, [0.0, 1.0, 0.0]);
        if v_dot(proximal_anchor_local, w) > 0.0 {
            w = v_neg(w);
        }
        let u = v_perp(w);
        let v = v_unit_or(v_cross(w, u), [0.0, 0.0, 1.0]);

        // Transform world cut plane into bone COM-local space.
        let p_local = q_inv_rotate(bone.rot, v_sub(plane_point, bone.pos));
        let mut n_local = v_unit_or(q_inv_rotate(bone.rot, v_unit_or(plane_normal, [0.0, 1.0, 0.0])), w);
        // Orient normal so proximal anchor lies on negative side (<= 0) and distal on positive (> 0).
        if v_dot(v_sub(proximal_anchor_local, p_local), n_local) > 0.0 {
            n_local = v_neg(n_local);
        }

        let pitch = SLICE_PITCH_CELLS;
        let half_seg = bone.half_segment();
        let r = bone.radius;
        let r2 = r * r;
        let inner_r2 = (r * 0.72) * (r * 0.72);
        let core_r2 = (r * 0.30) * (r * 0.30);

        let mut prox_vox = [0u8; SLICE_VOXELS];
        let mut dist_vox = [0u8; SLICE_VOXELS];
        let mut prox_count = 0usize;
        let mut dist_count = 0usize;
        let mut prox_sum = [0.0f32; 3];
        let mut dist_sum = [0.0f32; 3];
        let mut prox_min = [SLICE_NX as u8, SLICE_NY as u8, SLICE_NZ as u8];
        let mut prox_max = [0u8; 3];
        let mut dist_min = [SLICE_NX as u8, SLICE_NY as u8, SLICE_NZ as u8];
        let mut dist_max = [0u8; 3];

        // First pass: voxelize capsule and split by plane.
        let mut coords: Vec<(bool, Vec3)> = Vec::with_capacity(512);
        for iz in 0..SLICE_NZ {
            let lz = (iz as f32 + 0.5 - SLICE_NZ as f32 * 0.5) * pitch;
            let dz = lz - lz.clamp(-half_seg, half_seg);
            let dz2 = dz * dz;
            if dz2 > r2 {
                continue;
            }
            for iy in 0..SLICE_NY {
                let ly = (iy as f32 + 0.5 - SLICE_NY as f32 * 0.5) * pitch;
                let dy2 = ly * ly;
                if dy2 + dz2 > r2 {
                    continue;
                }
                for ix in 0..SLICE_NX {
                    let lx = (ix as f32 + 0.5 - SLICE_NX as f32 * 0.5) * pitch;
                    let d2 = lx * lx + dy2 + dz2;
                    if d2 > r2 {
                        continue;
                    }
                    let tissue = if d2 <= core_r2 {
                        3u8 // bone marrow/core
                    } else if d2 <= inner_r2 {
                        2u8 // inner flesh
                    } else {
                        1u8 // outer skin/cloth
                    };
                    let local_p = v_add(
                        v_add(v_scale(u, lx), v_scale(v, ly)),
                        v_scale(w, lz),
                    );
                    let signed = v_dot(v_sub(local_p, p_local), n_local);
                    let idx = SliceHalf::voxel_index(ix, iy, iz);
                    if signed <= 0.0 {
                        prox_vox[idx] = tissue;
                        prox_count += 1;
                        prox_sum = v_add(prox_sum, local_p);
                        prox_min[0] = prox_min[0].min(ix as u8);
                        prox_min[1] = prox_min[1].min(iy as u8);
                        prox_min[2] = prox_min[2].min(iz as u8);
                        prox_max[0] = prox_max[0].max(ix as u8);
                        prox_max[1] = prox_max[1].max(iy as u8);
                        prox_max[2] = prox_max[2].max(iz as u8);
                        coords.push((true, local_p));
                    } else {
                        dist_vox[idx] = tissue;
                        dist_count += 1;
                        dist_sum = v_add(dist_sum, local_p);
                        dist_min[0] = dist_min[0].min(ix as u8);
                        dist_min[1] = dist_min[1].min(iy as u8);
                        dist_min[2] = dist_min[2].min(iz as u8);
                        dist_max[0] = dist_max[0].max(ix as u8);
                        dist_max[1] = dist_max[1].max(iy as u8);
                        dist_max[2] = dist_max[2].max(iz as u8);
                        coords.push((false, local_p));
                    }
                }
            }
        }

        let total_voxels = (prox_count + dist_count).max(1) as f32;
        let voxel_mass = bone.mass / total_voxels;

        let build_half = |is_prox: bool,
                          voxels: [u8; SLICE_VOXELS],
                          count: usize,
                          sum_local: Vec3,
                          min_v: [u8; 3],
                          max_v: [u8; 3]|
         -> SliceHalf {
            if count == 0 {
                return SliceHalf {
                    voxels,
                    voxel_count: 0,
                    mass: 0.0,
                    world_com: bone.pos,
                    vel: bone.vel,
                    ang_vel: bone.ang_vel,
                    local_inertia_diag: [0.0; 3],
                    min_voxel: [0; 3],
                    max_voxel: [0; 3],
                };
            }
            let com_local = v_scale(sum_local, 1.0 / count as f32);
            let mass = voxel_mass * count as f32;
            let cell_i = voxel_mass * (pitch * pitch / 6.0);
            let mut ix_sum = 0.0f32;
            let mut iy_sum = 0.0f32;
            let mut iz_sum = 0.0f32;
            for &(p_flag, lp) in &coords {
                if p_flag == is_prox {
                    let d = v_sub(lp, com_local);
                    ix_sum += voxel_mass * (d[1] * d[1] + d[2] * d[2]) + cell_i;
                    iy_sum += voxel_mass * (d[0] * d[0] + d[2] * d[2]) + cell_i;
                    iz_sum += voxel_mass * (d[0] * d[0] + d[1] * d[1]) + cell_i;
                }
            }
            let world_com = bone.world_point(com_local);
            let vel = bone.point_velocity(world_com);
            SliceHalf {
                voxels,
                voxel_count: count,
                mass,
                world_com,
                vel,
                ang_vel: bone.ang_vel,
                local_inertia_diag: [ix_sum.max(0.05), iy_sum.max(0.05), iz_sum.max(0.05)],
                min_voxel: min_v,
                max_voxel: max_v,
            }
        };

        let proximal = build_half(true, prox_vox, prox_count, prox_sum, prox_min, prox_max);
        let distal = build_half(false, dist_vox, dist_count, dist_sum, dist_min, dist_max);
        let did_split = prox_count > 0 && dist_count > 0;

        Self {
            bone: bone_id,
            rot: bone.rot,
            origin_pos: bone.pos,
            basis: [u, v, w],
            voxel_size: pitch,
            proximal,
            distal,
            did_split,
        }
    }

    pub fn is_finite(&self) -> bool {
        self.origin_pos.iter().all(|v| v.is_finite())
            && self.rot.iter().all(|v| v.is_finite())
            && self.proximal.is_finite()
            && self.distal.is_finite()
    }
}

/// Outcome returned by `Ragdoll::apply_hit`.
#[derive(Debug, Clone)]
pub struct HitResult {
    /// True if the struck bone was intact and received the hit.
    pub applied: bool,
    /// True if the hit cleanly severed the joint (Tier A).
    pub severed: bool,
    /// Mode the ragdoll transitioned into as a result of the hit.
    pub mode: RagdollMode,
    /// Newly spawned independent sub-ragdoll chain when `severed == true`.
    pub detached: Option<DetachedLimb>,
}

// ── Smallest-Three Quaternion Wire Compression ──────────────────────────────

/// Packs a unit quaternion into a single `u32` using smallest-three encoding:
/// - bits `0..2`: index of largest-magnitude component (`0..4`)
/// - bits `2..12`, `12..22`, `22..32`: 3 x 10-bit quantized components in `[-1/sqrt(2), +1/sqrt(2)]`.
///
/// Uses an 8-corner nearest-geodesic search so worst-case angular round-trip error
/// across all of `SO(3)` (including `[0.5, 0.5, 0.5, 0.5]`) is guaranteed `< 0.0028 rad`.
pub fn pack_quat_smallest_three(q: Quat) -> u32 {
    let mut q = q_norm(q);
    let mut largest = 0usize;
    let mut best_abs = q[0].abs();
    for i in 1..4 {
        let a = q[i].abs();
        if a > best_abs {
            best_abs = a;
            largest = i;
        }
    }
    // Enforce positive dropped component so the sign is implicit.
    if q[largest] < 0.0 {
        q = [-q[0], -q[1], -q[2], -q[3]];
    }

    let mut rem = [0.0f32; 3];
    let mut k = 0;
    for i in 0..4 {
        if i != largest {
            rem[k] = q[i];
            k += 1;
        }
    }

    // Quantization scale: signed -511..=+511 shifted by +511 -> 0..=1022 (exact zero at 511).
    const HALF_RANGE: f32 = 511.0;
    const INV_HALF_RANGE: f32 = 1.0 / HALF_RANGE;
    let scale = HALF_RANGE / FRAC_1_SQRT_2;

    let base: [i32; 3] = [
        (rem[0] * scale).floor().clamp(-HALF_RANGE, HALF_RANGE - 1.0) as i32,
        (rem[1] * scale).floor().clamp(-HALF_RANGE, HALF_RANGE - 1.0) as i32,
        (rem[2] * scale).floor().clamp(-HALF_RANGE, HALF_RANGE - 1.0) as i32,
    ];

    // Check the 8 surrounding quantization cube corners to pick the highest |dot(q, q_hat)|.
    let mut best_dot = -1.0f32;
    let mut best_u = [511u32; 3];
    for mask in 0u32..8 {
        let i0 = (base[0] + (mask & 1) as i32).clamp(-511, 511);
        let i1 = (base[1] + ((mask >> 1) & 1) as i32).clamp(-511, 511);
        let i2 = (base[2] + ((mask >> 2) & 1) as i32).clamp(-511, 511);
        let c0 = i0 as f32 * INV_HALF_RANGE * FRAC_1_SQRT_2;
        let c1 = i1 as f32 * INV_HALF_RANGE * FRAC_1_SQRT_2;
        let c2 = i2 as f32 * INV_HALF_RANGE * FRAC_1_SQRT_2;
        let sum_sq = c0 * c0 + c1 * c1 + c2 * c2;
        if sum_sq > 1.0001 {
            continue;
        }
        let w = (1.0 - sum_sq).max(0.0).sqrt();
        let dot = (c0 * rem[0] + c1 * rem[1] + c2 * rem[2] + w * q[largest]).abs();
        if dot > best_dot {
            best_dot = dot;
            best_u = [(i0 + 511) as u32, (i1 + 511) as u32, (i2 + 511) as u32];
        }
    }

    (largest as u32) | (best_u[0] << 2) | (best_u[1] << 12) | (best_u[2] << 22)
}

/// Unpacks a smallest-three `u32` back into a normalized unit quaternion `[x, y, z, w]`.
pub fn unpack_quat_smallest_three(bits: u32) -> Quat {
    const HALF_RANGE: f32 = 511.0;
    const SCALE: f32 = FRAC_1_SQRT_2 / HALF_RANGE;

    let largest = (bits & 0x3) as usize;
    let u0 = ((bits >> 2) & 0x3FF).min(1022) as i32 - 511;
    let u1 = ((bits >> 12) & 0x3FF).min(1022) as i32 - 511;
    let u2 = ((bits >> 22) & 0x3FF).min(1022) as i32 - 511;
    let c = [u0 as f32 * SCALE, u1 as f32 * SCALE, u2 as f32 * SCALE];
    let w = (1.0 - (c[0] * c[0] + c[1] * c[1] + c[2] * c[2])).max(0.0).sqrt();

    let mut q = [0.0f32; 4];
    let mut k = 0;
    for i in 0..4 {
        if i == largest {
            q[i] = w;
        } else {
            q[i] = c[k];
            k += 1;
        }
    }
    q_norm(q)
}

/// Unpacked compact wire pose for network replication & rendering.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UnpackedPose {
    pub pelvis_pos: Vec3,
    pub bone_rots: [Quat; BONE_COUNT],
    pub missing_limbs: u16,
    pub mode: RagdollMode,
}

/// Decodes a 67-byte ragdoll pose packet produced by `Ragdoll::pack_pose`.
pub fn unpack_pose(bytes: &[u8; POSE_WIRE_BYTES]) -> UnpackedPose {
    let px = f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    let py = f32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    let pz = f32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);

    let mut bone_rots = [QUAT_IDENTITY; BONE_COUNT];
    for i in 0..BONE_COUNT {
        let o = 12 + i * 4;
        let bits = u32::from_le_bytes([bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]]);
        bone_rots[i] = unpack_quat_smallest_three(bits);
    }

    let missing_limbs = u16::from_le_bytes([bytes[64], bytes[65]]);
    let mode = RagdollMode::from_u8(bytes[66]);
    UnpackedPose { pelvis_pos: [px, py, pz], bone_rots, missing_limbs, mode }
}

// ── Active Ragdoll Struct ───────────────────────────────────────────────────

/// Non-adjacent limb pairs tested for self-collision during `FullRagdoll` tumbling.
const SELF_COLLIDE_PAIRS: [(usize, usize); 8] = [
    (BoneId::ThighL as usize, BoneId::ThighR as usize),
    (BoneId::ShinL as usize, BoneId::ShinR as usize),
    (BoneId::ForearmL as usize, BoneId::Chest as usize),
    (BoneId::ForearmR as usize, BoneId::Chest as usize),
    (BoneId::ForearmL as usize, BoneId::Pelvis as usize),
    (BoneId::ForearmR as usize, BoneId::Pelvis as usize),
    (BoneId::Head as usize, BoneId::ThighL as usize),
    (BoneId::Head as usize, BoneId::ThighR as usize),
];

/// Full 13-bone articulated active ragdoll with PD muscle motors, 4-state blending,
/// and two-tier dismemberment.
#[derive(Debug, Clone)]
pub struct Ragdoll {
    pub bones: [BoneState; BONE_COUNT],
    /// Joints `0..12` correspond to child bones `1..13` (`joints[child as usize - 1]`).
    pub joints: [JointDef; JOINT_COUNT],
    /// Target pose: `[0]` = pelvis world orientation, `[1..13]` = child target local rotation relative to parent.
    pub target_pose: [Quat; BONE_COUNT],
    /// Desired pelvis COM position in `Locomotion` / `GetUp`.
    pub pelvis_anchor_pos: Vec3,
    /// Desired pelvis COM velocity in `Locomotion`.
    pub pelvis_anchor_vel: Vec3,
    pub mode: RagdollMode,
    /// Bitmask of severed bones (`1 << (bone as u8)`).
    pub missing_limbs: u16,
    /// Effective per-bone motor stiffness gain multiplier (`0.0..=1.0`).
    pub bone_gain: [f32; BONE_COUNT],
    /// Effective pelvis upright/anchor hold gain (`0.0..=1.0`).
    pub pelvis_hold_gain: f32,
    /// Linear impulse magnitude (`kg * cells/s`) above which a hit forces `FullRagdoll`.
    pub knockdown_impulse: f32,
    /// Subtle muscular tone gain in `FullRagdoll` (default `0.05`, within `0.03..0.08`).
    pub ragdoll_tone_gain: f32,

    // Height & width scale factors matching people.ts `tall` and `broad`.
    tall: f32,
    broad: f32,

    // Localized HitReaction recovery timers per bone.
    hit_timer: [f32; BONE_COUNT],
    hit_duration: [f32; BONE_COUNT],
    hit_min_gain: [f32; BONE_COUNT],

    // Procedural GetUp blending state.
    getup_time: f32,
    getup_duration: f32,
    getup_orientation: GetUpOrientation,
    getup_start_y: f32,
    getup_target_y: f32,
    getup_yaw: f32,
    getup_ground_probed: bool,
}

impl Ragdoll {
    /// Spawns an upright standing active ragdoll at `feet_pos` facing `yaw` (radians, `0 = -Z` north)
    /// with nominal `people.ts` proportions (`tall = 1.0, broad = 1.0`, standing height ~18.1 cells).
    pub fn standing(feet_pos: Vec3, yaw: f32) -> Self {
        Self::standing_scaled(feet_pos, yaw, 1.0, 1.0)
    }

    /// Spawns a standing active ragdoll scaled by `people.ts` `tall` and `broad` factors.
    pub fn standing_scaled(feet_pos: Vec3, yaw: f32, tall: f32, broad: f32) -> Self {
        let tall = tall.clamp(0.75, 1.35);
        let broad = broad.clamp(0.75, 1.35);

        let thigh_len = 4.5 * tall;
        let calf_len = 4.0 * tall;
        let sole = 0.5;
        let hip_y = thigh_len + calf_len + sole;
        let hip_half_x = 1.02 * broad;
        let shoulder_half_x = 2.55 * broad;
        let upper_arm_len = 3.4 * tall;
        let forearm_len = 4.1 * tall;
        let chest_h = 5.0 * tall;
        let neck_y_from_chest = 4.9 * tall;
        let shoulder_y_from_chest = 4.4 * tall;

        let q_yaw = q_from_axis_angle([0.0, 1.0, 0.0], -yaw);
        let to_world = |local: Vec3| -> Vec3 { v_add(feet_pos, q_rotate(q_yaw, local)) };

        // Exact rest-pose COM coordinates in character-local space (feet at y = 0).
        let pelvis_com = [0.0, hip_y + 0.45, 0.0];
        let spine_piv = [0.0, hip_y + 1.2, 0.0];
        let chest_com = [0.0, spine_piv[1] + 2.4 * tall, 0.0];
        let neck_piv = [0.0, spine_piv[1] + neck_y_from_chest, 0.0];
        let head_com = [0.0, neck_piv[1] + 1.55 * tall, 0.0];

        let sh_l_piv = [-shoulder_half_x, spine_piv[1] + shoulder_y_from_chest, 0.0];
        let uarm_l_com = [-shoulder_half_x, sh_l_piv[1] - 0.5 * upper_arm_len, 0.0];
        let elb_l_piv = [-shoulder_half_x, sh_l_piv[1] - upper_arm_len, 0.0];
        let farm_l_com = [-shoulder_half_x, elb_l_piv[1] - 1.9 * tall, 0.0];

        let sh_r_piv = [shoulder_half_x, spine_piv[1] + shoulder_y_from_chest, 0.0];
        let uarm_r_com = [shoulder_half_x, sh_r_piv[1] - 0.5 * upper_arm_len, 0.0];
        let elb_r_piv = [shoulder_half_x, sh_r_piv[1] - upper_arm_len, 0.0];
        let farm_r_com = [shoulder_half_x, elb_r_piv[1] - 1.9 * tall, 0.0];

        let hip_l_piv = [-hip_half_x, hip_y, 0.0];
        let thigh_l_com = [-hip_half_x, hip_y - 0.5 * thigh_len, 0.0];
        let knee_l_piv = [-hip_half_x, hip_y - thigh_len, 0.0];
        let shin_l_com = [-hip_half_x, knee_l_piv[1] - 0.5 * calf_len, 0.0];
        let ankle_l_piv = [-hip_half_x, sole, 0.0];
        let foot_l_com = [-hip_half_x, sole, -0.55];

        let hip_r_piv = [hip_half_x, hip_y, 0.0];
        let thigh_r_com = [hip_half_x, hip_y - 0.5 * thigh_len, 0.0];
        let knee_r_piv = [hip_half_x, hip_y - thigh_len, 0.0];
        let shin_r_com = [hip_half_x, knee_r_piv[1] - 0.5 * calf_len, 0.0];
        let ankle_r_piv = [hip_half_x, sole, 0.0];
        let foot_r_com = [hip_half_x, sole, -0.55];

        let bones = [
            BoneState::new(to_world(pelvis_com), q_yaw, 3.55 * broad, 1.00, [1.0, 0.0, 0.0], 11.0),
            BoneState::new(to_world(chest_com), q_yaw, chest_h, 1.35 * broad.sqrt(), [0.0, 1.0, 0.0], 25.0),
            BoneState::new(to_world(head_com), q_yaw, 2.90 * tall, 1.05, [0.0, 1.0, 0.0], 6.0),
            BoneState::new(to_world(uarm_l_com), q_yaw, 3.80 * tall, 0.70, [0.0, 1.0, 0.0], 2.2),
            BoneState::new(to_world(farm_l_com), q_yaw, forearm_len, 0.62, [0.0, 1.0, 0.0], 1.7),
            BoneState::new(to_world(uarm_r_com), q_yaw, 3.80 * tall, 0.70, [0.0, 1.0, 0.0], 2.2),
            BoneState::new(to_world(farm_r_com), q_yaw, forearm_len, 0.62, [0.0, 1.0, 0.0], 1.7),
            BoneState::new(to_world(thigh_l_com), q_yaw, thigh_len, 0.85, [0.0, 1.0, 0.0], 7.8),
            BoneState::new(to_world(shin_l_com), q_yaw, calf_len, 0.72, [0.0, 1.0, 0.0], 3.6),
            BoneState::new(to_world(foot_l_com), q_yaw, 2.80, sole, [0.0, 0.0, -1.0], 1.1),
            BoneState::new(to_world(thigh_r_com), q_yaw, thigh_len, 0.85, [0.0, 1.0, 0.0], 7.8),
            BoneState::new(to_world(shin_r_com), q_yaw, calf_len, 0.72, [0.0, 1.0, 0.0], 3.6),
            BoneState::new(to_world(foot_r_com), q_yaw, 2.80, sole, [0.0, 0.0, -1.0], 1.1),
        ];

        // Exact local anchors satisfy parent_com + parent_anchor == child_com + child_anchor.
        let joints = [
            // 0 -> 1: Spine (Pelvis -> Chest)
            JointDef {
                parent: BoneId::Pelvis,
                child: BoneId::Chest,
                parent_anchor: v_sub(spine_piv, pelvis_com),
                child_anchor: v_sub(spine_piv, chest_com),
                limit: JointLimit::SwingTwist {
                    cone_axis_parent: [0.0, 1.0, 0.0],
                    twist_axis_child: [0.0, 1.0, 0.0],
                    max_swing: 0.75,
                    min_twist: -0.75,
                    max_twist: 0.75,
                },
                kp: 135_000.0,
                kd: 7_500.0,
                tau_max: 180_000.0,
                sever_threshold: 120.0,
            },
            // 1 -> 2: Neck (Chest -> Head)
            JointDef {
                parent: BoneId::Chest,
                child: BoneId::Head,
                parent_anchor: v_sub(neck_piv, chest_com),
                child_anchor: v_sub(neck_piv, head_com),
                limit: JointLimit::SwingTwist {
                    cone_axis_parent: [0.0, 1.0, 0.0],
                    twist_axis_child: [0.0, 1.0, 0.0],
                    max_swing: 0.80,
                    min_twist: -1.05,
                    max_twist: 1.05,
                },
                kp: 14_000.0,
                kd: 650.0,
                tau_max: 24_000.0,
                sever_threshold: 80.0,
            },
            // 1 -> 3: Left Shoulder
            JointDef {
                parent: BoneId::Chest,
                child: BoneId::UpperArmL,
                parent_anchor: v_sub(sh_l_piv, chest_com),
                child_anchor: v_sub(sh_l_piv, uarm_l_com),
                limit: JointLimit::SwingTwist {
                    cone_axis_parent: v_unit_or([-0.45, -0.25, -0.55], [0.0, -1.0, 0.0]),
                    twist_axis_child: [0.0, -1.0, 0.0],
                    max_swing: 1.95,
                    min_twist: -1.1,
                    max_twist: 1.1,
                },
                kp: 10_000.0,
                kd: 950.0,
                tau_max: 18_000.0,
                sever_threshold: 75.0,
            },
            // 3 -> 4: Left Elbow (hinge [0, 2.5 rad])
            JointDef {
                parent: BoneId::UpperArmL,
                child: BoneId::ForearmL,
                parent_anchor: v_sub(elb_l_piv, uarm_l_com),
                child_anchor: v_sub(elb_l_piv, farm_l_com),
                limit: JointLimit::Hinge {
                    axis: [1.0, 0.0, 0.0],
                    perp: [0.0, -1.0, 0.0],
                    min_angle: 0.0,
                    max_angle: 2.5,
                },
                kp: 4_000.0,
                kd: 360.0,
                tau_max: 7_500.0,
                sever_threshold: 55.0,
            },
            // 1 -> 5: Right Shoulder
            JointDef {
                parent: BoneId::Chest,
                child: BoneId::UpperArmR,
                parent_anchor: v_sub(sh_r_piv, chest_com),
                child_anchor: v_sub(sh_r_piv, uarm_r_com),
                limit: JointLimit::SwingTwist {
                    cone_axis_parent: v_unit_or([0.45, -0.25, -0.55], [0.0, -1.0, 0.0]),
                    twist_axis_child: [0.0, -1.0, 0.0],
                    max_swing: 1.95,
                    min_twist: -1.1,
                    max_twist: 1.1,
                },
                kp: 10_000.0,
                kd: 950.0,
                tau_max: 18_000.0,
                sever_threshold: 75.0,
            },
            // 5 -> 6: Right Elbow (hinge [0, 2.5 rad])
            JointDef {
                parent: BoneId::UpperArmR,
                child: BoneId::ForearmR,
                parent_anchor: v_sub(elb_r_piv, uarm_r_com),
                child_anchor: v_sub(elb_r_piv, farm_r_com),
                limit: JointLimit::Hinge {
                    axis: [1.0, 0.0, 0.0],
                    perp: [0.0, -1.0, 0.0],
                    min_angle: 0.0,
                    max_angle: 2.5,
                },
                kp: 4_000.0,
                kd: 360.0,
                tau_max: 7_500.0,
                sever_threshold: 55.0,
            },
            // 0 -> 7: Left Hip
            JointDef {
                parent: BoneId::Pelvis,
                child: BoneId::ThighL,
                parent_anchor: v_sub(hip_l_piv, pelvis_com),
                child_anchor: v_sub(hip_l_piv, thigh_l_com),
                limit: JointLimit::SwingTwist {
                    cone_axis_parent: v_unit_or([-0.15, -0.82, -0.55], [0.0, -1.0, 0.0]),
                    twist_axis_child: [0.0, -1.0, 0.0],
                    max_swing: 1.35,
                    min_twist: -0.65,
                    max_twist: 0.65,
                },
                kp: 36_000.0,
                kd: 3_800.0,
                tau_max: 65_000.0,
                sever_threshold: 95.0,
            },
            // 7 -> 8: Left Knee (hinge [0, 2.4 rad])
            JointDef {
                parent: BoneId::ThighL,
                child: BoneId::ShinL,
                parent_anchor: v_sub(knee_l_piv, thigh_l_com),
                child_anchor: v_sub(knee_l_piv, shin_l_com),
                limit: JointLimit::Hinge {
                    axis: [-1.0, 0.0, 0.0],
                    perp: [0.0, -1.0, 0.0],
                    min_angle: 0.0,
                    max_angle: 2.4,
                },
                kp: 14_000.0,
                kd: 1_250.0,
                tau_max: 26_000.0,
                sever_threshold: 70.0,
            },
            // 8 -> 9: Left Ankle (hinge [-0.7, 0.9 rad])
            JointDef {
                parent: BoneId::ShinL,
                child: BoneId::FootL,
                parent_anchor: v_sub(ankle_l_piv, shin_l_com),
                child_anchor: v_sub(ankle_l_piv, foot_l_com),
                limit: JointLimit::Hinge {
                    axis: [-1.0, 0.0, 0.0],
                    perp: [0.0, 0.0, -1.0],
                    min_angle: -0.7,
                    max_angle: 0.9,
                },
                kp: 1_800.0,
                kd: 140.0,
                tau_max: 4_000.0,
                sever_threshold: 55.0,
            },
            // 0 -> 10: Right Hip
            JointDef {
                parent: BoneId::Pelvis,
                child: BoneId::ThighR,
                parent_anchor: v_sub(hip_r_piv, pelvis_com),
                child_anchor: v_sub(hip_r_piv, thigh_r_com),
                limit: JointLimit::SwingTwist {
                    cone_axis_parent: v_unit_or([0.15, -0.82, -0.55], [0.0, -1.0, 0.0]),
                    twist_axis_child: [0.0, -1.0, 0.0],
                    max_swing: 1.35,
                    min_twist: -0.65,
                    max_twist: 0.65,
                },
                kp: 36_000.0,
                kd: 3_800.0,
                tau_max: 65_000.0,
                sever_threshold: 95.0,
            },
            // 10 -> 11: Right Knee (hinge [0, 2.4 rad])
            JointDef {
                parent: BoneId::ThighR,
                child: BoneId::ShinR,
                parent_anchor: v_sub(knee_r_piv, thigh_r_com),
                child_anchor: v_sub(knee_r_piv, shin_r_com),
                limit: JointLimit::Hinge {
                    axis: [-1.0, 0.0, 0.0],
                    perp: [0.0, -1.0, 0.0],
                    min_angle: 0.0,
                    max_angle: 2.4,
                },
                kp: 14_000.0,
                kd: 1_250.0,
                tau_max: 26_000.0,
                sever_threshold: 70.0,
            },
            // 11 -> 12: Right Ankle (hinge [-0.7, 0.9 rad])
            JointDef {
                parent: BoneId::ShinR,
                child: BoneId::FootR,
                parent_anchor: v_sub(ankle_r_piv, shin_r_com),
                child_anchor: v_sub(ankle_r_piv, foot_r_com),
                limit: JointLimit::Hinge {
                    axis: [-1.0, 0.0, 0.0],
                    perp: [0.0, 0.0, -1.0],
                    min_angle: -0.7,
                    max_angle: 0.9,
                },
                kp: 1_800.0,
                kd: 140.0,
                tau_max: 4_000.0,
                sever_threshold: 55.0,
            },
        ];

        let mut target_pose = [QUAT_IDENTITY; BONE_COUNT];
        target_pose[0] = q_yaw;

        Self {
            bones,
            joints,
            target_pose,
            pelvis_anchor_pos: to_world(pelvis_com),
            pelvis_anchor_vel: [0.0; 3],
            mode: RagdollMode::Locomotion,
            missing_limbs: 0,
            bone_gain: [1.0; BONE_COUNT],
            pelvis_hold_gain: 1.0,
            knockdown_impulse: 450.0,
            ragdoll_tone_gain: 0.05,
            tall,
            broad,
            hit_timer: [0.0; BONE_COUNT],
            hit_duration: [0.0; BONE_COUNT],
            hit_min_gain: [1.0; BONE_COUNT],
            getup_time: 0.0,
            getup_duration: 0.8,
            getup_orientation: GetUpOrientation::Supine,
            getup_start_y: feet_pos[1] + 1.4,
            getup_target_y: feet_pos[1] + hip_y + 0.45,
            getup_yaw: yaw,
            getup_ground_probed: false,
        }
    }

    /// Standing pelvis COM height above feet for this ragdoll's `tall` scale.
    #[inline]
    pub fn standing_pelvis_height(&self) -> f32 {
        (4.5 + 4.0) * self.tall + 0.5 + 0.45
    }

    /// Character height and breadth scale factors `(tall, broad)` matching `people.ts`.
    #[inline]
    pub fn proportions(&self) -> (f32, f32) {
        (self.tall, self.broad)
    }

    /// Returns whether `bone` has been severed.
    #[inline]
    pub fn is_missing(&self, bone: BoneId) -> bool {
        (self.missing_limbs & bone.bit()) != 0
    }

    /// Sets the target pose (`[0]` = pelvis world rot, `[1..13]` = parent-relative joint rots).
    pub fn set_target_pose(&mut self, pose: [Quat; BONE_COUNT]) {
        for i in 0..BONE_COUNT {
            self.target_pose[i] = q_norm(pose[i]);
        }
    }

    /// Converts world-space target orientations for all 13 bones into `target_pose`.
    pub fn set_target_world_pose(&mut self, world_rots: &[Quat; BONE_COUNT]) {
        self.target_pose[0] = q_norm(world_rots[0]);
        for j in &self.joints {
            let p = j.parent.index();
            let c = j.child.index();
            self.target_pose[c] = q_norm(q_mul(q_conj(world_rots[p]), world_rots[c]));
        }
    }

    /// Updates the desired locomotion pelvis COM anchor position & velocity.
    pub fn set_pelvis_anchor(&mut self, pos: Vec3, vel: Vec3) {
        self.pelvis_anchor_pos = pos;
        self.pelvis_anchor_vel = vel;
    }

    /// Detects whether the ragdoll is currently lying prone (front down) or supine (front up)
    /// from the pelvis forward (`-Z`) / up (`+Y`) dot products with world `+Y`.
    pub fn detect_get_up_orientation(&self) -> GetUpOrientation {
        let pelvis_rot = self.bones[BoneId::Pelvis.index()].rot;
        let front_world = q_rotate(pelvis_rot, [0.0, 0.0, -1.0]);
        if front_world[1] < 0.0 {
            GetUpOrientation::Prone
        } else {
            GetUpOrientation::Supine
        }
    }

    /// Transitions the ragdoll explicitly to `mode`.
    pub fn set_mode(&mut self, mode: RagdollMode) {
        match mode {
            RagdollMode::Locomotion => {
                if self.cannot_stand() {
                    self.mode = RagdollMode::FullRagdoll;
                    self.bone_gain = [self.ragdoll_tone_gain; BONE_COUNT];
                    self.pelvis_hold_gain = 0.0;
                    return;
                }
                self.mode = RagdollMode::Locomotion;
                self.bone_gain = [1.0; BONE_COUNT];
                self.hit_timer = [0.0; BONE_COUNT];
                self.pelvis_hold_gain = 1.0;
            }
            RagdollMode::HitReaction => {
                self.mode = RagdollMode::HitReaction;
            }
            RagdollMode::FullRagdoll => {
                self.mode = RagdollMode::FullRagdoll;
                self.bone_gain = [self.ragdoll_tone_gain; BONE_COUNT];
                self.pelvis_hold_gain = 0.0;
                self.hit_timer = [0.0; BONE_COUNT];
            }
            RagdollMode::GetUp => {
                self.begin_get_up();
            }
        }
    }

    /// Transitions into `RagdollMode::GetUp`, detecting prone vs supine posture and
    /// preparing the 0.8 s procedural get-up blend (`gain: 0.05 -> 1.0`).
    pub fn begin_get_up(&mut self) {
        if self.cannot_stand() {
            self.set_mode(RagdollMode::FullRagdoll);
            return;
        }
        let orientation = self.detect_get_up_orientation();
        let pelvis = self.bones[BoneId::Pelvis.index()];
        let pelvis_up = q_rotate(pelvis.rot, [0.0, 1.0, 0.0]);
        let pelvis_front = q_rotate(pelvis.rot, [0.0, 0.0, -1.0]);

        // Choose natural standing facing direction from the body's lying axis on XZ:
        // - Supine (on back): sitting up faces toward the feet (-pelvis_up on XZ).
        // - Prone (face down): pushing up faces toward the head (+pelvis_up on XZ).
        let horiz = match orientation {
            GetUpOrientation::Supine => [-pelvis_up[0], -pelvis_up[2]],
            GetUpOrientation::Prone => [pelvis_up[0], pelvis_up[2]],
        };
        let yaw = if horiz[0] * horiz[0] + horiz[1] * horiz[1] > 0.04 {
            horiz[0].atan2(-horiz[1])
        } else {
            pelvis_front[0].atan2(-pelvis_front[2])
        };

        self.mode = RagdollMode::GetUp;
        self.getup_time = 0.0;
        self.getup_duration = 0.8;
        self.getup_orientation = orientation;
        self.getup_start_y = pelvis.pos[1];
        self.getup_target_y = (pelvis.pos[1] - 1.5).floor() + self.standing_pelvis_height();
        self.getup_yaw = yaw;
        self.getup_ground_probed = false;
        self.pelvis_anchor_pos = [pelvis.pos[0], pelvis.pos[1], pelvis.pos[2]];
        self.pelvis_anchor_vel = [0.0; 3];
        self.bone_gain = [0.05; BONE_COUNT];
        self.pelvis_hold_gain = 0.05;
        self.hit_timer = [0.0; BONE_COUNT];
    }

    /// True if fatal/structural dismemberment prevents standing upright.
    fn cannot_stand(&self) -> bool {
        self.is_missing(BoneId::Pelvis)
            || self.is_missing(BoneId::Chest)
            || self.is_missing(BoneId::Head)
            || self.is_missing(BoneId::ThighL)
            || self.is_missing(BoneId::ThighR)
            || self.is_missing(BoneId::ShinL)
            || self.is_missing(BoneId::ShinR)
    }

    /// Places the ragdoll cleanly into a flat lying posture (prone or supine) on floor height `floor_y`,
    /// shifted vertically so the lowest capsule sits cleanly on the floor without initial overlap.
    pub fn place_lying(&mut self, floor_y: f32, orientation: GetUpOrientation) {
        let pitch_angle = match orientation {
            GetUpOrientation::Supine => FRAC_PI_2,  // +Y tilts to +Z, front (-Z) faces +Y (sky)
            GetUpOrientation::Prone => -FRAC_PI_2,  // +Y tilts to -Z, front (-Z) faces -Y (ground)
        };
        let q_lie = q_from_axis_angle([1.0, 0.0, 0.0], pitch_angle);
        let pelvis_old = self.bones[0].pos;
        for b in &mut self.bones {
            let rel = v_sub(b.pos, pelvis_old);
            b.pos = v_add(pelvis_old, q_rotate(q_lie, rel));
            b.rot = q_norm(q_mul(q_lie, b.rot));
            b.vel = [0.0; 3];
            b.ang_vel = [0.0; 3];
        }
        let (lo, _) = self.aabb();
        let dy = (floor_y + 0.05) - lo[1];
        for b in &mut self.bones {
            b.pos[1] += dy;
        }
        self.set_mode(RagdollMode::FullRagdoll);
    }

    /// Returns the detected get-up orientation (valid once `begin_get_up()` has been called).
    pub fn getup_orientation(&self) -> GetUpOrientation {
        self.getup_orientation
    }

    /// Applies a physical impact to `bone` at `world_pos` with linear `impulse` (`kg * cells/s`).
    ///
    /// - Triggers localized `HitReaction` (dropping gains on `bone` and its parent chain to `0.15..0.35`
    ///   for `0.25..0.6 s`) or `FullRagdoll` when `|impulse| >= knockdown_impulse`.
    /// - When `is_edged_or_plasma` is true and `cut_energy >= joint.sever_threshold` (Tier A), cleanly
    ///   severs the joint above `bone`, marks the full subtree in `missing_limbs`, and returns an
    ///   independent momentum-conserving `DetachedLimb`.
    pub fn apply_hit(
        &mut self,
        bone: BoneId,
        world_pos: Vec3,
        impulse: Vec3,
        cut_energy: f32,
        is_edged_or_plasma: bool,
    ) -> HitResult {
        if self.is_missing(bone) {
            return HitResult {
                applied: false,
                severed: false,
                mode: self.mode,
                detached: None,
            };
        }

        // Apply the real physical impulse at the world contact point (conserves momentum).
        self.bones[bone.index()].apply_impulse_at(world_pos, impulse);

        // Tier A: check joint-boundary severing on non-root bones.
        if bone != BoneId::Pelvis && is_edged_or_plasma {
            let joint = self.joints[bone.index() - 1];
            if cut_energy >= joint.sever_threshold {
                let detached = self.sever_subtree(bone);
                if self.cannot_stand() || v_len(impulse) >= self.knockdown_impulse {
                    self.set_mode(RagdollMode::FullRagdoll);
                } else if self.mode != RagdollMode::FullRagdoll {
                    self.trigger_localized_reaction(bone.parent().unwrap_or(BoneId::Pelvis), 0.85);
                }
                return HitResult {
                    applied: true,
                    severed: true,
                    mode: self.mode,
                    detached: Some(detached),
                };
            }
        }

        // Non-severing hit: either full knockdown or localized HitReaction.
        let imp_mag = v_len(impulse);
        if imp_mag >= self.knockdown_impulse {
            // Distribute a small sympathetic share to the pelvis/chest on heavy knockdowns so the
            // body tips crisply while preserving exact total linear momentum.
            self.set_mode(RagdollMode::FullRagdoll);
        } else if self.mode != RagdollMode::FullRagdoll {
            let severity = (imp_mag / self.knockdown_impulse).clamp(0.15, 1.0);
            self.trigger_localized_reaction(bone, severity);
        }

        HitResult {
            applied: true,
            severed: false,
            mode: self.mode,
            detached: None,
        }
    }

    /// Triggers a localized `HitReaction` weakening `bone` and its parent chain to `0.15..0.35`
    /// for `0.25..0.55 s` before smoothly recovering to `Locomotion`.
    fn trigger_localized_reaction(&mut self, bone: BoneId, severity: f32) {
        self.mode = RagdollMode::HitReaction;
        let base_dur = 0.25 + 0.25 * severity.clamp(0.0, 1.0); // 0.25..0.50 s (recovers within 0.6 s)

        let mut cur = Some(bone);
        let mut hop = 0usize;
        while let Some(b) = cur {
            let idx = b.index();
            let min_g = match hop {
                0 => 0.15 + 0.08 * (1.0 - severity), // 0.15..0.23 on directly struck bone
                1 => 0.22 + 0.08 * (1.0 - severity), // 0.22..0.30 on immediate parent
                _ => 0.30 + 0.05 * (1.0 - severity), // 0.30..0.35 further up chain
            }
            .clamp(0.15, 0.35);
            let dur = (base_dur * (1.0 - 0.12 * hop as f32).max(0.65)).clamp(0.25, 0.55);
            self.hit_min_gain[idx] = self.hit_min_gain[idx].min(min_g);
            self.hit_duration[idx] = self.hit_duration[idx].max(dur);
            self.hit_timer[idx] = self.hit_timer[idx].max(dur);
            self.bone_gain[idx] = self.bone_gain[idx].min(min_g);
            cur = b.parent();
            hop += 1;
        }

        // Keep feet planted while allowing torso/pelvis to reel naturally.
        self.pelvis_hold_gain = self.pelvis_hold_gain.min(0.65 - 0.20 * severity);
    }

    /// Severs `root_bone` and all intact descendants, setting their bits in `missing_limbs`
    /// and returning an independent momentum-conserving `DetachedLimb`.
    fn sever_subtree(&mut self, root_bone: BoneId) -> DetachedLimb {
        let mask = root_bone.subtree_mask() & !self.missing_limbs;
        self.missing_limbs |= mask;

        let mut bone_ids = Vec::new();
        let mut bones = Vec::new();
        let mut local_map = [usize::MAX; BONE_COUNT];

        for b in BoneId::ALL {
            if (mask & b.bit()) != 0 {
                let idx = bone_ids.len();
                local_map[b.index()] = idx;
                bone_ids.push(b);
                bones.push(self.bones[b.index()]);
            }
        }

        let mut joints = Vec::new();
        for j in &self.joints {
            let p_loc = local_map[j.parent.index()];
            let c_loc = local_map[j.child.index()];
            if p_loc != usize::MAX && c_loc != usize::MAX {
                joints.push(DetachedJoint {
                    parent_idx: p_loc,
                    child_idx: c_loc,
                    parent_anchor: j.parent_anchor,
                    child_anchor: j.child_anchor,
                    limit: j.limit,
                });
            }
        }

        DetachedLimb {
            root_bone,
            bone_ids,
            bones,
            joints,
            tone_damping: 35.0,
        }
    }

    /// Tier-B helper: voxelizes an intact limb into a `10 x 10 x 16` 2.5 cm voxel grid and
    /// cleaves it along an arbitrary world plane `(plane_point, plane_normal)` into
    /// proximal stump + distal body.
    pub fn slice_limb(
        &self,
        bone: BoneId,
        plane_point: Vec3,
        plane_normal: Vec3,
    ) -> MidLimbSlice {
        let prox_anchor = if bone == BoneId::Pelvis {
            [0.0, 0.0, 0.0]
        } else {
            self.joints[bone.index() - 1].child_anchor
        };
        MidLimbSlice::slice_bone(
            bone,
            &self.bones[bone.index()],
            prox_anchor,
            plane_point,
            plane_normal,
        )
    }

    /// Resolves collision between an external moving capsule (weapon, projectile, vehicle strut)
    /// and this ragdoll's intact bone capsules. Returns the deepest contact if any bone was hit.
    pub fn collide_capsule(
        &mut self,
        cap_a: Vec3,
        cap_b: Vec3,
        cap_radius: f32,
        cap_vel: Vec3,
        cap_inv_mass: f32,
    ) -> Option<CapsuleContact> {
        let mut deepest: Option<CapsuleContact> = None;
        for b_id in BoneId::ALL {
            if self.is_missing(b_id) {
                continue;
            }
            let bone = &mut self.bones[b_id.index()];
            let (ba, bb) = bone.capsule_endpoints();
            let (c_ext, c_bone, _, _) = closest_points_segments(cap_a, cap_b, ba, bb);
            let diff = v_sub(c_bone, c_ext);
            let dist_sq = v_len_sq(diff);
            let r_sum = cap_radius + bone.radius;
            if dist_sq >= r_sum * r_sum {
                continue;
            }
            let dist = dist_sq.sqrt();
            let n = if dist > 1e-6 { v_scale(diff, 1.0 / dist) } else { [0.0, 1.0, 0.0] };
            let depth = r_sum - dist;
            let contact_pt = v_sub(c_bone, v_scale(n, bone.radius));

            // Positional push-out weighted by inverse mass.
            let r_w = v_sub(contact_pt, bone.pos);
            let rxn = v_cross(r_w, n);
            let w_bone = bone.inv_mass + inv_inertia_scalar(bone.rot, bone.inv_local_inertia_diag, rxn);
            let w_tot = w_bone + cap_inv_mass;
            if w_tot > 1e-12 {
                let p = v_scale(n, depth / w_tot);
                bone.pos = v_add(bone.pos, v_scale(p, bone.inv_mass));
                let dq = inv_inertia_mul(bone.rot, bone.inv_local_inertia_diag, v_cross(r_w, p));
                bone.rot = q_integrate(bone.rot, dq, 1.0);

                // Velocity impulse response.
                let v_bone = bone.point_velocity(contact_pt);
                let v_rel_n = v_dot(v_sub(v_bone, cap_vel), n);
                if v_rel_n < 0.0 {
                    let j_mag = -1.2 * v_rel_n / w_tot;
                    bone.apply_impulse_at(contact_pt, v_scale(n, j_mag));
                }
            }

            if deepest.map_or(true, |d| depth > d.depth) {
                deepest = Some(CapsuleContact {
                    bone: b_id,
                    world_point: contact_pt,
                    normal: n,
                    depth,
                });
            }
        }
        deepest
    }

    /// Resolves inter-ragdoll capsule-vs-capsule contacts with an AABB broadphase early-out.
    pub fn collide_ragdolls(a: &mut Ragdoll, b: &mut Ragdoll) -> usize {
        let (a_min, a_max) = a.aabb();
        let (b_min, b_max) = b.aabb();
        if a_max[0] < b_min[0]
            || b_max[0] < a_min[0]
            || a_max[1] < b_min[1]
            || b_max[1] < a_min[1]
            || a_max[2] < b_min[2]
            || b_max[2] < a_min[2]
        {
            return 0;
        }

        let mut hits = 0usize;
        for bi in BoneId::ALL {
            if a.is_missing(bi) {
                continue;
            }
            for bj in BoneId::ALL {
                if b.is_missing(bj) {
                    continue;
                }
                let ba = &mut a.bones[bi.index()];
                let bb = &mut b.bones[bj.index()];
                let (pa0, pa1) = ba.capsule_endpoints();
                let (pb0, pb1) = bb.capsule_endpoints();
                let (ca, cb, _, _) = closest_points_segments(pa0, pa1, pb0, pb1);
                let diff = v_sub(cb, ca);
                let dist_sq = v_len_sq(diff);
                let r_sum = ba.radius + bb.radius;
                if dist_sq >= r_sum * r_sum {
                    continue;
                }
                let dist = dist_sq.sqrt();
                let n = if dist > 1e-6 { v_scale(diff, 1.0 / dist) } else { [0.0, 1.0, 0.0] };
                let pen = r_sum - dist;
                let pt_a = v_add(ca, v_scale(n, ba.radius));
                let pt_b = v_sub(cb, v_scale(n, bb.radius));
                let ra = v_sub(pt_a, ba.pos);
                let rb = v_sub(pt_b, bb.pos);
                let wa = ba.inv_mass + inv_inertia_scalar(ba.rot, ba.inv_local_inertia_diag, v_cross(ra, n));
                let wb = bb.inv_mass + inv_inertia_scalar(bb.rot, bb.inv_local_inertia_diag, v_cross(rb, n));
                let w_sum = wa + wb;
                if w_sum > 1e-12 {
                    let p = v_scale(n, pen / w_sum);
                    ba.pos = v_sub(ba.pos, v_scale(p, ba.inv_mass));
                    bb.pos = v_add(bb.pos, v_scale(p, bb.inv_mass));
                    ba.rot = q_integrate(ba.rot, inv_inertia_mul(ba.rot, ba.inv_local_inertia_diag, v_cross(ra, v_neg(p))), 1.0);
                    bb.rot = q_integrate(bb.rot, inv_inertia_mul(bb.rot, bb.inv_local_inertia_diag, v_cross(rb, p)), 1.0);

                    let va = ba.point_velocity(pt_a);
                    let vb = bb.point_velocity(pt_b);
                    let vn = v_dot(v_sub(vb, va), n);
                    if vn < 0.0 {
                        let j = v_scale(n, -1.1 * vn / w_sum);
                        ba.apply_impulse_at(pt_a, v_neg(j));
                        bb.apply_impulse_at(pt_b, j);
                    }
                    hits += 1;
                }
            }
        }
        hits
    }

    /// Updates state machine timers, per-bone gain blending, and procedural `GetUp` keyframes.
    fn update_mode_blending<F: FnMut([i32; 3]) -> bool>(&mut self, dt: f32, solid: &mut F) {
        match self.mode {
            RagdollMode::Locomotion => {
                self.bone_gain = [1.0; BONE_COUNT];
                self.pelvis_hold_gain = 1.0;
            }
            RagdollMode::HitReaction => {
                let mut any_active = false;
                for i in 0..BONE_COUNT {
                    if self.hit_timer[i] > 0.0 {
                        self.hit_timer[i] = (self.hit_timer[i] - dt).max(0.0);
                        let dur = self.hit_duration[i].max(1e-4);
                        let prog = 1.0 - (self.hit_timer[i] / dur);
                        let s = smoothstep(prog);
                        self.bone_gain[i] = self.hit_min_gain[i] + (1.0 - self.hit_min_gain[i]) * s;
                        if self.hit_timer[i] > 0.0 {
                            any_active = true;
                        } else {
                            self.hit_min_gain[i] = 1.0;
                            self.hit_duration[i] = 0.0;
                            self.bone_gain[i] = 1.0;
                        }
                    } else {
                        self.bone_gain[i] = 1.0;
                    }
                }
                // Smoothly restore pelvis upright hold along with the longest active reaction.
                let min_upper = self.bone_gain[BoneId::Pelvis.index()]
                    .min(self.bone_gain[BoneId::Chest.index()])
                    .min(self.bone_gain[BoneId::Head.index()]);
                self.pelvis_hold_gain = (0.55 + 0.45 * min_upper).clamp(0.45, 1.0);
                if !any_active {
                    self.mode = RagdollMode::Locomotion;
                    self.pelvis_hold_gain = 1.0;
                }
            }
            RagdollMode::FullRagdoll => {
                self.bone_gain = [self.ragdoll_tone_gain; BONE_COUNT];
                self.pelvis_hold_gain = 0.0;
            }
            RagdollMode::GetUp => {
                // On the first GetUp step, probe down from pelvis to find exact floor height.
                if !self.getup_ground_probed {
                    let px = self.bones[0].pos[0].floor() as i32;
                    let pz = self.bones[0].pos[2].floor() as i32;
                    let py = self.bones[0].pos[1].floor() as i32;
                    let mut floor_y = (self.bones[0].pos[1] - 1.5).floor();
                    for dy in 0..=16 {
                        if solid([px, py - dy, pz]) {
                            floor_y = (py - dy + 1) as f32;
                            break;
                        }
                    }
                    self.getup_start_y = self.bones[0].pos[1];
                    self.getup_target_y = floor_y + self.standing_pelvis_height();
                    self.pelvis_anchor_pos[0] = self.bones[0].pos[0];
                    self.pelvis_anchor_pos[2] = self.bones[0].pos[2];
                    self.getup_ground_probed = true;
                }

                self.getup_time += dt;
                let u = (self.getup_time / self.getup_duration.max(0.05)).clamp(0.0, 1.0);
                let gain = 0.05 + 0.95 * smoothstep(u);
                self.bone_gain = [gain; BONE_COUNT];
                self.pelvis_hold_gain = (0.15 + 0.85 * smoothstep(u)).clamp(0.05, 1.0);

                // Procedural prone/supine get-up keyframes matching moves.ts 'get-up'.
                let (ch, pel_pitch, height_frac) = self.eval_getup_keyframe(u);
                let mut pose = pose_from_channels(self.getup_yaw, &ch);
                let q_yaw = q_from_axis_angle([0.0, 1.0, 0.0], -self.getup_yaw);
                let q_pitch = q_from_axis_angle([1.0, 0.0, 0.0], pel_pitch);
                pose[0] = q_norm(q_mul(q_yaw, q_pitch));
                self.target_pose = pose;

                let y_now = self.getup_start_y + (self.getup_target_y - self.getup_start_y) * height_frac;
                self.pelvis_anchor_pos[1] = y_now;
                self.pelvis_anchor_vel = [0.0; 3];

                if u >= 1.0 {
                    self.mode = RagdollMode::Locomotion;
                    self.bone_gain = [1.0; BONE_COUNT];
                    self.pelvis_hold_gain = 1.0;
                    self.pelvis_anchor_pos[1] = self.getup_target_y;
                    self.target_pose = [QUAT_IDENTITY; BONE_COUNT];
                    self.target_pose[0] = q_from_axis_angle([0.0, 1.0, 0.0], -self.getup_yaw);
                }
            }
        }
    }

    /// Evaluates smooth procedural get-up pose channels, pelvis pitch, and height fraction for `u in [0, 1]`.
    fn eval_getup_keyframe(&self, u: f32) -> (PoseChannels, f32, f32) {
        let mut ch = PoseChannels::default();
        match self.getup_orientation {
            GetUpOrientation::Supine => {
                // Phase 1 (0..0.45): sit up from back, tuck knees under.
                // Phase 2 (0.45..0.78): rise through crouch.
                // Phase 3 (0.78..1.0): extend cleanly to standing.
                if u < 0.45 {
                    let t = smoothstep(u / 0.45);
                    let pel_pitch = FRAC_PI_2 * (1.0 - t) + 0.25 * t;
                    ch.lean = 0.65 * t;
                    ch.crouch = 0.85 * t;
                    ch.lift_l = 0.65 * t;
                    ch.lift_r = 0.65 * t;
                    ch.bend_l = 0.7 * t;
                    ch.bend_r = 0.7 * t;
                    (ch, pel_pitch, 0.45 * t)
                } else {
                    let t = smoothstep((u - 0.45) / 0.55);
                    let pel_pitch = 0.25 * (1.0 - t);
                    ch.lean = 0.65 * (1.0 - t);
                    ch.crouch = 0.85 * (1.0 - t);
                    ch.lift_l = 0.65 * (1.0 - t);
                    ch.lift_r = 0.65 * (1.0 - t);
                    ch.bend_l = 0.7 * (1.0 - t);
                    ch.bend_r = 0.7 * (1.0 - t);
                    (ch, pel_pitch, 0.45 + 0.55 * t)
                }
            }
            GetUpOrientation::Prone => {
                // Phase 1 (0..0.45): push chest up off the floor with hands while flexing knees so feet clear floor.
                // Phase 2 (0.45..0.85): rise smoothly into upright stance; final 0.15 settles vertically.
                if u < 0.45 {
                    let t = smoothstep(u / 0.45);
                    let pel_pitch = -FRAC_PI_2 * (1.0 - t) - 0.20 * t;
                    ch.lean = -0.15 * t;
                    ch.crouch = 0.65 * t;
                    ch.lift_l = 1.1 * t;
                    ch.lift_r = 1.1 * t;
                    ch.bend_l = 0.7 * t;
                    ch.bend_r = 0.7 * t;
                    (ch, pel_pitch, 0.50 * t)
                } else {
                    let t = smoothstep((u - 0.45) / 0.45);
                    let pel_pitch = -0.20 * (1.0 - t);
                    ch.lean = -0.15 * (1.0 - t);
                    ch.crouch = 0.65 * (1.0 - t);
                    ch.lift_l = 1.1 * (1.0 - t);
                    ch.lift_r = 1.1 * (1.0 - t);
                    ch.bend_l = 0.7 * (1.0 - t);
                    ch.bend_r = 0.7 * (1.0 - t);
                    (ch, pel_pitch, 0.50 + 0.50 * t)
                }
            }
        }
    }

    /// Advances the active ragdoll by `dt` seconds against a voxel world predicate `solid([ix, iy, iz])`.
    ///
    /// Automatically sub-steps to at least `240 Hz` (`2` substeps at `120 Hz`, `4` at `60 Hz`) for
    /// unconditional PD motor stability, crisp joint drift (`< 0.02` cells), and tunnel-free stair tumbling.
    pub fn step<F: FnMut([i32; 3]) -> bool>(&mut self, dt: f32, mut solid: F) {
        if dt <= 0.0 || !dt.is_finite() {
            return;
        }
        let dt = dt.min(1.0 / 30.0);
        self.update_mode_blending(dt, &mut solid);

        let substeps = ((dt * 240.0).ceil() as usize).clamp(2, 8);
        let h = dt / substeps as f32;
        let active_mass: f32 = BoneId::ALL
            .iter()
            .filter(|&&b| !self.is_missing(b))
            .map(|&b| self.bones[b.index()].mass)
            .sum();

        let mut contacts = Vec::with_capacity(BONE_COUNT * 3);
        let mut prev_pos = [[0.0f32; 3]; BONE_COUNT];
        let mut prev_rot = [QUAT_IDENTITY; BONE_COUNT];

        for _ in 0..substeps {
            // 1. Gravity on intact bones.
            for b in BoneId::ALL {
                if !self.is_missing(b) {
                    self.bones[b.index()].vel[1] -= G * h;
                }
            }

            // 2. Soft pelvis spring-leg linear & upright angular anchor (Locomotion / HitReaction / GetUp).
            if self.pelvis_hold_gain > 0.001 && !self.is_missing(BoneId::Pelvis) {
                let g = self.pelvis_hold_gain;
                let pel = &mut self.bones[BoneId::Pelvis.index()];

                // Implicit Backward-Euler linear spring + gravity feed-forward.
                let kp_lin = 14_000.0 * g;
                let kd_lin = 1_800.0 * g.sqrt();
                let f_max = 30_000.0 * g;
                let denom = 1.0 + pel.inv_mass * h * (h * kp_lin + kd_lin);
                let err_pos = v_sub(self.pelvis_anchor_pos, v_add(pel.pos, v_scale(pel.vel, h)));
                let err_vel = v_sub(self.pelvis_anchor_vel, pel.vel);
                let mut f_rhs = v_add(v_scale(err_pos, kp_lin), v_scale(err_vel, kd_lin));
                f_rhs[1] += active_mass * G * g;
                let j_lin = v_clamp_len(v_scale(f_rhs, h / denom), h * f_max);
                pel.vel = v_add(pel.vel, v_scale(j_lin, pel.inv_mass));

                // Implicit 3x3 angular upright PD motor against world target_pose[0].
                let kp_rot = 50_000.0 * g;
                let kd_rot = 4_200.0 * g.sqrt();
                let tau_max = 85_000.0 * g;
                let q_err = q_mul(self.target_pose[0], q_conj(pel.rot));
                let e = q_to_rotvec(q_err);
                let ib = inv_inertia_world_mat(pel.rot, pel.inv_local_inertia_diag);
                let beta = h * (h * kp_rot + kd_rot);
                let mut m = [[0.0f32; 3]; 3];
                for r in 0..3 {
                    for c in 0..3 {
                        m[r][c] = (if r == c { 1.0 } else { 0.0 }) + beta * ib[r][c];
                    }
                }
                let damp_c = h * kp_rot + kd_rot;
                let rhs = [
                    h * (kp_rot * e[0] - damp_c * pel.ang_vel[0]),
                    h * (kp_rot * e[1] - damp_c * pel.ang_vel[1]),
                    h * (kp_rot * e[2] - damp_c * pel.ang_vel[2]),
                ];
                let j_ang = v_clamp_len(solve_spd_3x3(m, rhs), h * tau_max);
                let dw = inv_inertia_mul(pel.rot, pel.inv_local_inertia_diag, j_ang);
                pel.ang_vel = v_add(pel.ang_vel, dw);
            }

            // 3. Implicit 3x3 PD muscle motors across all 12 intact joints.
            for j in &self.joints {
                if self.is_missing(j.parent) || self.is_missing(j.child) {
                    continue;
                }
                let c_idx = j.child.index();
                let gain = self.bone_gain[c_idx];
                let kp_eff = j.kp * gain;
                let kd_eff = j.kd * gain.max(self.ragdoll_tone_gain);
                let tau_eff = j.tau_max * gain.max(self.ragdoll_tone_gain);
                let target_q = self.target_pose[c_idx];
                let (pa, ch) = split_two_mut(&mut self.bones, j.parent.index(), c_idx);
                apply_implicit_pd_motor(pa, ch, target_q, kp_eff, kd_eff, tau_eff, h);
            }

            // 4. Integrate predicted poses.
            for b in BoneId::ALL {
                let idx = b.index();
                if self.is_missing(b) {
                    continue;
                }
                prev_pos[idx] = self.bones[idx].pos;
                prev_rot[idx] = self.bones[idx].rot;
                self.bones[idx].pos = v_add(self.bones[idx].pos, v_scale(self.bones[idx].vel, h));
                self.bones[idx].rot = q_integrate(self.bones[idx].rot, self.bones[idx].ang_vel, h);
            }

            // 5. Collect analytical capsule-vs-voxel-world contacts.
            contacts.clear();
            for b in BoneId::ALL {
                if !self.is_missing(b) {
                    collect_bone_voxel_contacts(b.index(), &self.bones[b.index()], &mut solid, &mut contacts);
                }
            }

            // 6. XPBD constraint iterations (alternating top-down / bottom-up sweeps for fast convergence).
            let self_collide = self.mode == RagdollMode::FullRagdoll;
            for iter in 0..3 {
                if iter % 2 == 0 {
                    for j in &self.joints {
                        if self.is_missing(j.parent) || self.is_missing(j.child) {
                            continue;
                        }
                        let (pa, ch) = split_two_mut(&mut self.bones, j.parent.index(), j.child.index());
                        solve_ball_socket(pa, ch, j.parent_anchor, j.child_anchor);
                        solve_joint_limit(pa, ch, &j.limit);
                    }
                } else {
                    for j in self.joints.iter().rev() {
                        if self.is_missing(j.parent) || self.is_missing(j.child) {
                            continue;
                        }
                        let (pa, ch) = split_two_mut(&mut self.bones, j.parent.index(), j.child.index());
                        solve_ball_socket(pa, ch, j.parent_anchor, j.child_anchor);
                        solve_joint_limit(pa, ch, &j.limit);
                    }
                }

                for c in &mut contacts {
                    solve_world_contact_pos(&mut self.bones[c.bone_idx], c);
                }

                if self_collide {
                    for &(ia, ib) in &SELF_COLLIDE_PAIRS {
                        let mask = (1u16 << ia) | (1u16 << ib);
                        if (self.missing_limbs & mask) == 0 {
                            let (ba, bb) = split_two_mut(&mut self.bones, ia, ib);
                            let _ = solve_capsule_pair_pos(ba, bb);
                        }
                    }
                }
            }

            // Final polish pass on joint limits & ball-sockets so anatomical bounds are strictly respected.
            for j in &self.joints {
                if self.is_missing(j.parent) || self.is_missing(j.child) {
                    continue;
                }
                let (pa, ch) = split_two_mut(&mut self.bones, j.parent.index(), j.child.index());
                solve_joint_limit(pa, ch, &j.limit);
                solve_ball_socket(pa, ch, j.parent_anchor, j.child_anchor);
            }

            // 7. Derive velocities from constrained displacements + subtle air damping.
            let inv_h = 1.0 / h;
            let lin_damp = (-0.4 * h).exp();
            let ang_damp = (-1.2 * h).exp();
            for b in BoneId::ALL {
                let idx = b.index();
                if self.is_missing(b) {
                    continue;
                }
                let bone = &mut self.bones[idx];
                bone.vel = v_clamp_len(v_scale(v_sub(bone.pos, prev_pos[idx]), inv_h), 400.0);
                let dq = q_mul(bone.rot, q_conj(prev_rot[idx]));
                bone.ang_vel = v_clamp_len(v_scale(q_to_rotvec(dq), inv_h), 40.0);
                bone.vel = v_scale(bone.vel, lin_damp);
                bone.ang_vel = v_scale(bone.ang_vel, ang_damp);
            }

            // 8. Coulomb contact friction & restitution.
            let mu = match self.mode {
                RagdollMode::FullRagdoll => 0.72,
                RagdollMode::GetUp => 0.35,
                _ => 0.85,
            };
            for c in &contacts {
                solve_world_contact_vel(&mut self.bones[c.bone_idx], c, h, mu);
            }
        }
    }

    /// Maximum positional separation (in cells) between parent and child anchors across all intact joints.
    pub fn max_joint_drift(&self) -> f32 {
        let mut max_d = 0.0f32;
        for j in &self.joints {
            if self.is_missing(j.parent) || self.is_missing(j.child) {
                continue;
            }
            let pa = self.bones[j.parent.index()].world_point(j.parent_anchor);
            let pb = self.bones[j.child.index()].world_point(j.child_anchor);
            max_d = max_d.max(v_len(v_sub(pb, pa)));
        }
        max_d
    }

    /// Returns the current signed hinge angle in radians for a hinge-joint child bone
    /// (`ForearmL/R`, `ShinL/R`, `FootL/R`), or `None` for non-hinge / missing bones.
    pub fn hinge_angle(&self, child: BoneId) -> Option<f32> {
        if child == BoneId::Pelvis || self.is_missing(child) {
            return None;
        }
        let j = self.joints[child.index() - 1];
        if self.is_missing(j.parent) {
            return None;
        }
        match j.limit {
            JointLimit::Hinge { axis, perp, .. } => Some(compute_hinge_angle(
                self.bones[j.parent.index()].rot,
                self.bones[child.index()].rot,
                axis,
                perp,
            )),
            JointLimit::SwingTwist { .. } => None,
        }
    }

    /// Dot product of pelvis local `+Y` with world `+Y` (`+1.0` = perfectly upright).
    #[inline]
    pub fn pelvis_up_dot(&self) -> f32 {
        q_rotate(self.bones[BoneId::Pelvis.index()].rot, [0.0, 1.0, 0.0])[1]
    }

    /// Dot product of chest local `+Y` with world `+Y` (`+1.0` = upright torso).
    #[inline]
    pub fn chest_up_dot(&self) -> f32 {
        q_rotate(self.bones[BoneId::Chest.index()].rot, [0.0, 1.0, 0.0])[1]
    }

    /// Total linear momentum (`sum(m_i * v_i)`) across all intact bones.
    pub fn linear_momentum(&self) -> Vec3 {
        let mut p = [0.0f32; 3];
        for b in BoneId::ALL {
            if !self.is_missing(b) {
                let bone = &self.bones[b.index()];
                p = v_add(p, v_scale(bone.vel, bone.mass));
            }
        }
        p
    }

    /// Total mass (kg) of intact bones.
    pub fn active_mass(&self) -> f32 {
        BoneId::ALL
            .iter()
            .filter(|&&b| !self.is_missing(b))
            .map(|&b| self.bones[b.index()].mass)
            .sum()
    }

    /// Tight world-space AABB enclosing all intact bone capsules.
    pub fn aabb(&self) -> (Vec3, Vec3) {
        let mut lo = [f32::INFINITY; 3];
        let mut hi = [f32::NEG_INFINITY; 3];
        for b in BoneId::ALL {
            if self.is_missing(b) {
                continue;
            }
            let (blo, bhi) = self.bones[b.index()].aabb();
            for k in 0..3 {
                lo[k] = lo[k].min(blo[k]);
                hi[k] = hi[k].max(bhi[k]);
            }
        }
        (lo, hi)
    }

    /// True iff all intact bone positions, orientations, and velocities are finite.
    pub fn is_finite(&self) -> bool {
        BoneId::ALL.iter().all(|&b| {
            if self.is_missing(b) {
                return true;
            }
            let s = &self.bones[b.index()];
            s.pos.iter().all(|v| v.is_finite())
                && s.rot.iter().all(|v| v.is_finite())
                && s.vel.iter().all(|v| v.is_finite())
                && s.ang_vel.iter().all(|v| v.is_finite())
        })
    }

    /// Packs the ragdoll's pelvis position (12 B), 13 bone quaternions (52 B smallest-three `u32`),
    /// `missing_limbs` (2 B), and `mode` (1 B) into a compact 67-byte wire packet.
    pub fn pack_pose(&self) -> [u8; POSE_WIRE_BYTES] {
        let mut out = [0u8; POSE_WIRE_BYTES];
        let pel = self.bones[BoneId::Pelvis.index()].pos;
        out[0..4].copy_from_slice(&pel[0].to_le_bytes());
        out[4..8].copy_from_slice(&pel[1].to_le_bytes());
        out[8..12].copy_from_slice(&pel[2].to_le_bytes());

        for i in 0..BONE_COUNT {
            let bits = pack_quat_smallest_three(self.bones[i].rot);
            let o = 12 + i * 4;
            out[o..o + 4].copy_from_slice(&bits.to_le_bytes());
        }

        out[64..66].copy_from_slice(&self.missing_limbs.to_le_bytes());
        out[66] = self.mode as u8;
        out
    }
}

/// Safe helper to obtain mutable references to two distinct slice indices without `unsafe`.
#[inline]
fn split_two_mut<T>(slice: &mut [T], i: usize, j: usize) -> (&mut T, &mut T) {
    debug_assert_ne!(i, j);
    if i < j {
        let (left, right) = slice.split_at_mut(j);
        (&mut left[i], &mut right[0])
    } else {
        let (left, right) = slice.split_at_mut(i);
        (&mut right[0], &mut left[j])
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    /// Flat solid floor at `y < 0` (top surface at `y = 0.0`).
    fn flat_floor(c: [i32; 3]) -> bool {
        c[1] < 0
    }

    /// Voxel staircase descending along `+Z`:
    /// - Landing at `z <= 4`: top at `y = 20`
    /// - 10 steps (`z = 5..35`, each tread 3 cells deep, drop 2 cells per step) down to `y = 0`
    /// - Flat bottom floor for `z >= 35`: top at `y = 0`.
    fn voxel_staircase(c: [i32; 3]) -> bool {
        let [_, y, z] = c;
        let top = if z <= 4 {
            20
        } else if z < 35 {
            let step = (z - 5) / 3 + 1; // 1..=10
            (20 - step * 2).max(0)
        } else {
            0
        };
        y < top
    }

    #[test]
    fn skeleton_proportions_match_people_ts() {
        let r = Ragdoll::standing([0.0, 0.0, 0.0], 0.0);
        let (lo, hi) = r.aabb();
        let height = hi[1] - lo[1];
        assert!(lo[1].abs() < 0.05, "soles should sit at y=0, got {}", lo[1]);
        assert!(
            (17.0..=18.5).contains(&height),
            "standing height should match people.ts (~17-18.1 cells), got {height}"
        );
        assert!(
            r.max_joint_drift() < 1e-5,
            "initial rest pose must have zero joint drift, got {}",
            r.max_joint_drift()
        );
    }

    #[test]
    fn active_standing_stability_3s() {
        let mut r = Ragdoll::standing([0.0, 0.0, 0.0], 0.0);
        let dt = 1.0 / 120.0;
        let mut max_drift = 0.0f32;

        for _ in 0..(120 * 3) {
            r.step(dt, flat_floor);
            assert!(r.is_finite(), "ragdoll produced NaN/Inf during standing");
            let drift = r.max_joint_drift();
            max_drift = max_drift.max(drift);
        }

        assert!(
            max_drift < 0.08,
            "max joint drift over 3s standing exceeded 0.08 cells: {max_drift:.4}"
        );
        assert!(
            r.pelvis_up_dot() > 0.96,
            "pelvis should remain upright, up_dot={:.4}",
            r.pelvis_up_dot()
        );
        assert!(
            r.chest_up_dot() > 0.95,
            "chest should remain upright, up_dot={:.4}",
            r.chest_up_dot()
        );
        assert!(
            (r.bones[BoneId::Pelvis.index()].pos[1] - STAND_PELVIS_COM_HEIGHT).abs() < 0.4,
            "pelvis height drifted unexpectedly: y={:.3}",
            r.bones[BoneId::Pelvis.index()].pos[1]
        );
    }

    #[test]
    fn hit_reaction_deflects_and_recovers_within_0_6s() {
        let mut r = Ragdoll::standing([0.0, 0.0, 0.0], 0.0);
        let dt = 1.0 / 120.0;

        // Settle briefly in Locomotion.
        for _ in 0..30 {
            r.step(dt, flat_floor);
        }
        let head_x_before = r.bones[BoneId::Head.index()].pos[0];

        // Side punch to the Head (+X lateral impulse, non-edged, below knockdown threshold).
        let head_pos = r.bones[BoneId::Head.index()].pos;
        let hit = r.apply_hit(BoneId::Head, head_pos, [180.0, 15.0, 0.0], 0.0, false);
        assert!(hit.applied && !hit.severed);
        assert_eq!(hit.mode, RagdollMode::HitReaction);
        assert!(
            r.bone_gain[BoneId::Head.index()] <= 0.35 && r.bone_gain[BoneId::Head.index()] >= 0.15,
            "struck bone gain should drop to 0.15..0.35, got {}",
            r.bone_gain[BoneId::Head.index()]
        );

        let mut max_head_dx = 0.0f32;
        let mut max_chest_tilt = 0.0f32;
        // Simulate 0.60 s (72 ticks at 120 Hz).
        for _ in 0..72 {
            r.step(dt, flat_floor);
            assert!(r.is_finite());
            let dx = (r.bones[BoneId::Head.index()].pos[0] - head_x_before).abs();
            max_head_dx = max_head_dx.max(dx);
            let tilt = 1.0 - r.chest_up_dot();
            max_chest_tilt = max_chest_tilt.max(tilt);
        }

        assert!(
            max_head_dx > 0.35,
            "side punch should visibly deflect Head physically, max_head_dx={max_head_dx:.4}"
        );
        assert!(
            max_chest_tilt > 0.005,
            "upper body should deflect from side punch, max_chest_tilt={max_chest_tilt:.5}"
        );
        assert_eq!(
            r.mode,
            RagdollMode::Locomotion,
            "ragdoll should return to Locomotion within 0.6s"
        );
        assert!(
            r.pelvis_up_dot() > 0.94 && r.chest_up_dot() > 0.92,
            "upper body should recover upright within 0.6s: pelvis_up={:.4}, chest_up={:.4}",
            r.pelvis_up_dot(),
            r.chest_up_dot()
        );
    }

    #[test]
    fn full_ragdoll_stair_tumble_respects_limits_and_settles() {
        let mut r = Ragdoll::standing([0.0, 20.0, 3.0], 0.0);
        let dt = 1.0 / 120.0;

        // Heavy knockdown shove pushing ragdoll down the staircase (+Z).
        let chest_pos = r.bones[BoneId::Chest.index()].pos;
        let hit = r.apply_hit(BoneId::Chest, chest_pos, [25.0, 40.0, 720.0], 0.0, false);
        assert!(hit.applied && !hit.severed);
        assert_eq!(hit.mode, RagdollMode::FullRagdoll);
        assert!(
            (0.03..=0.08).contains(&r.bone_gain[BoneId::Chest.index()]),
            "FullRagdoll should keep 0.03..0.08 muscular tone"
        );

        // Also impart forward momentum across the whole body so it tumbles all the way down.
        for b in &mut r.bones {
            b.vel[2] += 36.0;
        }

        let start_y = r.bones[BoneId::Pelvis.index()].pos[1];
        let mut max_knee_violation = 0.0f32;
        let mut max_elbow_violation = 0.0f32;

        // Tumble for 5.0 seconds (600 ticks at 120 Hz).
        for _ in 0..600 {
            r.step(dt, voxel_staircase);
            assert!(r.is_finite(), "ragdoll exploded/NaN during stair tumble");

            for knee in [BoneId::ShinL, BoneId::ShinR] {
                let a = r.hinge_angle(knee).unwrap();
                let viol = (0.0 - a).max(a - 2.4).max(0.0);
                max_knee_violation = max_knee_violation.max(viol);
            }
            for elbow in [BoneId::ForearmL, BoneId::ForearmR] {
                let a = r.hinge_angle(elbow).unwrap();
                let viol = (0.0 - a).max(a - 2.5).max(0.0);
                max_elbow_violation = max_elbow_violation.max(viol);
            }
        }

        let end_y = r.bones[BoneId::Pelvis.index()].pos[1];
        let end_speed = v_len(r.bones[BoneId::Pelvis.index()].vel);
        assert!(
            end_y < start_y - 10.0,
            "ragdoll should tumble down the staircase: start_y={start_y:.2}, end_y={end_y:.2}"
        );
        assert!(
            end_y > -1.0,
            "ragdoll should not tunnel through floor: end_y={end_y:.2}"
        );
        assert!(
            max_knee_violation < 0.08,
            "knees hyper-extended past [0, 2.4]: max_violation={max_knee_violation:.4} rad"
        );
        assert!(
            max_elbow_violation < 0.08,
            "elbows hyper-extended past [0, 2.5]: max_violation={max_elbow_violation:.4} rad"
        );
        assert!(
            end_speed < 12.0,
            "ragdoll should settle naturally at bottom of stairs, end_speed={end_speed:.2}"
        );
    }

    #[test]
    fn physical_get_up_from_prone_and_supine() {
        let dt = 1.0 / 120.0;
        for expected_orient in [GetUpOrientation::Supine, GetUpOrientation::Prone] {
            let mut r = Ragdoll::standing([0.0, 0.0, 0.0], 0.0);
            r.place_lying(0.0, expected_orient);

            // Let ragdoll settle on the floor for 0.4 s in FullRagdoll.
            for _ in 0..48 {
                r.step(dt, flat_floor);
            }
            assert_eq!(
                r.detect_get_up_orientation(),
                expected_orient,
                "failed to detect {expected_orient:?} from pelvis orientation"
            );
            assert!(
                r.pelvis_up_dot().abs() < 0.4,
                "ragdoll should be lying horizontally before GetUp, up_dot={:.3}",
                r.pelvis_up_dot()
            );

            // Trigger GetUp and simulate 1.2 s (0.8 s blend + 0.4 s stabilization).
            r.begin_get_up();
            assert_eq!(r.mode, RagdollMode::GetUp);
            assert_eq!(r.getup_orientation(), expected_orient);

            for _ in 0..144 {
                r.step(dt, flat_floor);
                assert!(r.is_finite(), "NaN during GetUp from {expected_orient:?}");
            }

            assert_eq!(
                r.mode,
                RagdollMode::Locomotion,
                "ragdoll should finish GetUp into Locomotion ({expected_orient:?})"
            );
            assert!(
                r.pelvis_up_dot() > 0.92,
                "pelvis should stand upright after GetUp ({expected_orient:?}): up_dot={:.4}",
                r.pelvis_up_dot()
            );
            assert!(
                r.bones[BoneId::Pelvis.index()].pos[1] > 7.5,
                "pelvis should rise to standing height ({expected_orient:?}): y={:.3}",
                r.bones[BoneId::Pelvis.index()].pos[1]
            );
        }
    }

    #[test]
    fn joint_boundary_severing_conserves_momentum_and_spawns_detached_limb() {
        let mut r = Ragdoll::standing([0.0, 0.0, 0.0], 0.0);
        // Give the ragdoll an initial velocity to verify full momentum conservation.
        for b in &mut r.bones {
            b.vel = [4.0, 0.0, -3.0];
        }
        let p_before = r.linear_momentum();
        let strike_pos = r.bones[BoneId::ForearmR.index()].pos;
        let impulse = [42.0, 24.0, -18.0];

        // Non-edged hit with same cut_energy must NOT sever.
        let mut blunt_copy = r.clone();
        let blunt = blunt_copy.apply_hit(BoneId::ForearmR, strike_pos, impulse, 140.0, false);
        assert!(blunt.applied && !blunt.severed && blunt.detached.is_none());
        assert_eq!(blunt_copy.missing_limbs, 0);

        // High cut_energy sword/lightsaber strike to ForearmR severs right elbow.
        let hit = r.apply_hit(BoneId::ForearmR, strike_pos, impulse, 140.0, true);
        assert!(hit.applied && hit.severed, "edged strike above threshold must sever ForearmR");
        assert!(r.is_missing(BoneId::ForearmR));
        assert!(!r.is_missing(BoneId::UpperArmR));
        assert_eq!(r.missing_limbs, BoneId::ForearmR.bit());

        let mut limb = hit.detached.expect("severing must spawn DetachedLimb");
        assert_eq!(limb.root_bone, BoneId::ForearmR);
        assert_eq!(limb.bones.len(), 1);

        // Verify exact linear momentum conservation: P_remaining + P_detached == P_before + impulse.
        let p_after = v_add(r.linear_momentum(), limb.linear_momentum());
        let p_expected = v_add(p_before, impulse);
        let err = v_len(v_sub(p_after, p_expected));
        assert!(
            err < 1e-3,
            "momentum not conserved across severing: got {p_after:?}, expected {p_expected:?}, err={err}"
        );

        // Step both remaining ragdoll and flying detached limb over 1.0 s cleanly.
        let start_limb_pos = limb.bones[0].pos;
        let dt = 1.0 / 120.0;
        for _ in 0..120 {
            r.step(dt, flat_floor);
            limb.step(dt, flat_floor);
            assert!(r.is_finite() && limb.is_finite());
        }
        let travel = v_len(v_sub(limb.bones[0].pos, start_limb_pos));
        assert!(travel > 3.0, "detached forearm should fly independently, travel={travel:.2}");
        assert!(limb.bones[0].pos[1] >= 0.0, "detached limb should collide with floor");

        // Multi-bone subtree severing (UpperArmL -> [UpperArmL, ForearmL]).
        let arm_hit = r.apply_hit(
            BoneId::UpperArmL,
            r.bones[BoneId::UpperArmL.index()].pos,
            [-35.0, 15.0, 10.0],
            160.0,
            true,
        );
        let mut arm_chain = arm_hit.detached.expect("shoulder sever must spawn 2-bone chain");
        assert_eq!(arm_chain.bones.len(), 2);
        assert_eq!(arm_chain.joints.len(), 1);
        assert!(r.is_missing(BoneId::UpperArmL) && r.is_missing(BoneId::ForearmL));
        for _ in 0..60 {
            arm_chain.step(dt, flat_floor);
            assert!(arm_chain.is_finite());
        }
    }

    #[test]
    fn mid_limb_voxel_slice_diagonal_cut_produces_two_valid_halves() {
        let mut r = Ragdoll::standing([0.0, 0.0, 0.0], 0.35);
        r.bones[BoneId::UpperArmL.index()].vel = [5.0, -2.0, 3.0];
        r.bones[BoneId::UpperArmL.index()].ang_vel = [1.0, 2.0, -1.5];

        let arm_center = r.bones[BoneId::UpperArmL.index()].pos;
        let diag_normal = v_unit_or([0.45, 0.75, -0.48], [0.0, 1.0, 0.0]);
        let slice = r.slice_limb(BoneId::UpperArmL, arm_center, diag_normal);

        assert!(slice.did_split, "diagonal cut through UpperArmL center must split into 2 halves");
        assert!(slice.is_finite(), "MidLimbSlice produced NaN/Inf");
        assert!(
            slice.proximal.voxel_count > 10 && slice.distal.voxel_count > 10,
            "both halves must be non-empty: prox={}, dist={}",
            slice.proximal.voxel_count,
            slice.distal.voxel_count
        );
        assert_eq!(slice.voxel_size, SLICE_PITCH_CELLS);
        // Combined mass must match original bone mass.
        let mass_err = (slice.proximal.mass + slice.distal.mass - r.bones[BoneId::UpperArmL.index()].mass).abs();
        assert!(mass_err < 1e-4, "slice mass not conserved: err={mass_err}");
        // Proximal and distal COMs should lie on opposite sides of the cut plane.
        let d_prox = v_dot(v_sub(slice.proximal.world_com, arm_center), diag_normal);
        let d_dist = v_dot(v_sub(slice.distal.world_com, arm_center), diag_normal);
        assert!(
            d_prox * d_dist < 0.0,
            "proximal and distal COMs should lie on opposite sides of cut plane: {d_prox}, {d_dist}"
        );
    }

    #[test]
    fn smallest_three_wire_packing_round_trip_under_0_003_rad() {
        // Test 13-bone pose wire packet + 5,000 pseudorandom orientations including [0.5, 0.5, 0.5, 0.5] corners.
        let mut max_err = 0.0f32;
        let corners: [Quat; 6] = [
            QUAT_IDENTITY,
            [0.5, 0.5, 0.5, 0.5],
            [-0.5, 0.5, -0.5, 0.5],
            [FRAC_1_SQRT_2, FRAC_1_SQRT_2, 0.0, 0.0],
            [0.0, -FRAC_1_SQRT_2, 0.0, FRAC_1_SQRT_2],
            [0.577_350_26, -0.577_350_26, 0.577_350_26, 0.0],
        ];
        for q in corners {
            let bits = pack_quat_smallest_three(q);
            let u = unpack_quat_smallest_three(bits);
            let err = q_angle_between(q_norm(q), u);
            max_err = max_err.max(err);
        }

        // Deterministic PRNG over SO(3).
        let mut seed = 0x1660_0166u64;
        let mut next_f = || -> f32 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let u = ((seed >> 40) as u32) as f32 / ((1u32 << 24) as f32);
            u * 2.0 - 1.0
        };
        for _ in 0..5000 {
            let q = q_norm([next_f(), next_f(), next_f(), next_f()]);
            let bits = pack_quat_smallest_three(q);
            let u = unpack_quat_smallest_three(bits);
            let err = q_angle_between(q, u);
            max_err = max_err.max(err);
        }
        assert!(
            max_err < 0.003,
            "smallest-three worst-case angular error exceeded 0.003 rad: {max_err:.6}"
        );

        // Full 67-byte Ragdoll pack_pose / unpack_pose round-trip.
        let mut r = Ragdoll::standing([12.5, 4.25, -33.75], 1.1);
        let pose = pose_from_channels(
            1.1,
            &PoseChannels {
                lean: 0.25,
                twist: -0.3,
                lift_r: 1.4,
                bend_r: 0.9,
                swing_l: 0.4,
                knee_l: 0.8,
                ..Default::default()
            },
        );
        r.set_target_pose(pose);
        for _ in 0..24 {
            r.step(1.0 / 120.0, flat_floor);
        }
        r.missing_limbs = BoneId::ForearmR.bit();
        r.mode = RagdollMode::HitReaction;

        let packet = r.pack_pose();
        assert_eq!(packet.len(), POSE_WIRE_BYTES);
        assert_eq!(POSE_WIRE_BYTES, 67);

        let unpacked = unpack_pose(&packet);
        assert_eq!(unpacked.pelvis_pos, r.bones[0].pos);
        assert_eq!(unpacked.missing_limbs, BoneId::ForearmR.bit());
        assert_eq!(unpacked.mode, RagdollMode::HitReaction);

        let mut pose_max_err = 0.0f32;
        for i in 0..BONE_COUNT {
            let err = q_angle_between(r.bones[i].rot, unpacked.bone_rots[i]);
            pose_max_err = pose_max_err.max(err);
        }
        assert!(
            pose_max_err < 0.003,
            "13-bone wire round-trip error exceeded 0.003 rad: {pose_max_err:.6}"
        );
    }

    #[test]
    fn capsule_vs_capsule_and_inter_ragdoll_collision() {
        let mut a = Ragdoll::standing([0.0, 0.0, 0.0], 0.0);
        let mut b = Ragdoll::standing([1.8, 0.0, 0.0], PI); // overlapping shoulders/hips
        let hits = Ragdoll::collide_ragdolls(&mut a, &mut b);
        assert!(hits > 0, "overlapping ragdolls must generate capsule-vs-capsule contacts");
        assert!(a.is_finite() && b.is_finite());

        // External weapon capsule swing into Chest.
        let chest = a.bones[BoneId::Chest.index()].pos;
        let contact = a.collide_capsule(
            [chest[0] - 2.0, chest[1], chest[2]],
            [chest[0] + 2.0, chest[1], chest[2]],
            0.4,
            [0.0, 0.0, -50.0],
            0.2,
        );
        assert!(contact.is_some(), "swept weapon capsule intersecting Chest must register contact");
    }

    #[test]
    fn performance_16_simultaneous_active_ragdolls_under_1_5ms() {
        let mut ragdolls: Vec<Ragdoll> = (0..16)
            .map(|i| {
                let x = (i % 4) as f32 * 12.0;
                let z = (i / 4) as f32 * 12.0;
                let mut r = Ragdoll::standing([x, 0.0, z], (i as f32) * 0.4);
                if i % 4 == 3 {
                    // Mix in some tumbling ragdolls alongside active standing ones.
                    r.set_mode(RagdollMode::FullRagdoll);
                    r.bones[BoneId::Chest.index()].vel = [10.0, 5.0, -8.0];
                }
                r
            })
            .collect();

        let dt = 1.0 / 120.0;
        // Warmup 10 ticks.
        for _ in 0..10 {
            for r in &mut ragdolls {
                r.step(dt, flat_floor);
            }
        }

        const TICKS: usize = 60;
        let began = Instant::now();
        for _ in 0..TICKS {
            for r in &mut ragdolls {
                r.step(dt, flat_floor);
            }
        }
        let total_ms = began.elapsed().as_secs_f64() * 1000.0;
        let per_tick_ms = total_ms / TICKS as f64;
        eprintln!(
            "ragdoll_perf: 16 active ragdolls @ 120 Hz = {:.3} ms/tick ({:.1} us/ragdoll)",
            per_tick_ms,
            per_tick_ms * 1000.0 / 16.0
        );

        for r in &ragdolls {
            assert!(r.is_finite());
        }
        assert!(
            per_tick_ms < 1.5,
            "16 simultaneous active ragdolls exceeded 1.5 ms/tick budget: {per_tick_ms:.3} ms"
        );
    }
}
