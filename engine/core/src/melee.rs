//! Physics-based close combat & lightsaber engine (#166): dynamic weapon rigid bodies
//! driven by 6-DOF implicit PD hand springs, 240 Hz sub-stepped swept-blade CCD against
//! voxel cells, other weapons, and dynamic targets, steel-on-steel parrying, 1-DOF
//! prismatic stab binding, edged severing, and plasma lightsaber kerf carving with
//! material-hardness viscous drag, cooling glow, ignition, and plasma lock clashes.
//!
//! All lengths are in finest cells (10 cm = 0.1 m), velocities in cells/s, masses in kg,
//! inertias in kg·cell², forces in kg·cell/s² (0.1 N), torques in kg·cell²/s² (0.01 N·m),
//! times in seconds, and quaternions in `[x, y, z, w]` layout matching `bodies.rs`.

use crate::hash::hash3;
use crate::kinds::{
    EARTH, GLASS, GRASS, LEAVES, PLASTER, ROOFING, SAND, STEEL, WOOD, breaks_at, burns, material,
};
use crate::tree::Kind;
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// Simulation tick duration (120 Hz, matching `bodies::STEP`).
pub const TICK_DT: f32 = 1.0 / 120.0;
/// Number of CCD substeps executed per 120 Hz tick.
pub const SUBSTEPS_PER_TICK: usize = 2;
/// Substep duration (240 Hz).
pub const SUBSTEP_DT: f32 = 1.0 / 240.0;
/// Duration (seconds) for an incandescent plasma-cut voxel face to cool from `1.0` to `0.0`.
pub const COOLING_DURATION: f32 = 4.0;
/// Minimum cosine alignment `dot(normalize(v_rel), blade_axis)` to pierce and enter `StabBind`.
pub const STAB_ALIGNMENT_THRESHOLD: f32 = 0.72;
/// Default world gravity in cells/s² (matching `bodies::G`).
pub const DEFAULT_GRAVITY: [f32; 3] = [0.0, -98.0, 0.0];
/// Lightsaber blade ignition / retraction speed (full extension per second).
pub const BLADE_EXTEND_RATE: f32 = 4.0;
/// Base viscous drag coefficient per unit `kinds::breaks_at` hardness for plasma kerf cuts.
pub const PLASMA_DRAG_PER_HARDNESS: f32 = 0.055;
/// Maximum glowing cells tracked simultaneously in `CoolingGlowMap`.
const MAX_GLOW_CELLS: usize = 4096;
/// Fixed open-addressed visited table size for zero-alloc per-substep solid-voxel deduplication.
const VISITED_CAP: usize = 512;
const VISITED_MASK: usize = VISITED_CAP - 1;

type V = [f32; 3];
type Q = [f32; 4];

// ── Inline vector & quaternion math ──────────────────────────────────────────

#[inline]
fn add(a: V, b: V) -> V {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

#[inline]
fn sub(a: V, b: V) -> V {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

#[inline]
fn scale(a: V, k: f32) -> V {
    [a[0] * k, a[1] * k, a[2] * k]
}

#[inline]
fn dot(a: V, b: V) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline]
fn cross(a: V, b: V) -> V {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[inline]
fn len_sq(a: V) -> f32 {
    dot(a, a)
}

#[inline]
fn len(a: V) -> f32 {
    len_sq(a).sqrt()
}

#[inline]
fn lerp3(a: V, b: V, t: f32) -> V {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

#[inline]
fn unit_or(a: V, fallback: V) -> V {
    let l2 = len_sq(a);
    if l2 > 1e-12 {
        scale(a, l2.sqrt().recip())
    } else {
        fallback
    }
}

#[inline]
fn clamp_len(a: V, max_len: f32) -> V {
    if max_len <= 0.0 {
        return [0.0; 3];
    }
    let l2 = len_sq(a);
    if l2 > max_len * max_len {
        scale(a, max_len / l2.sqrt())
    } else {
        a
    }
}

/// Identity quaternion `[0, 0, 0, 1]`.
#[inline]
pub const fn quat_identity() -> [f32; 4] {
    [0.0, 0.0, 0.0, 1.0]
}

/// Constructs a unit quaternion `[x, y, z, w]` from a rotation axis and angle (radians).
#[inline]
pub fn quat_from_axis_angle(axis: [f32; 3], angle: f32) -> [f32; 4] {
    let n = unit_or(axis, [0.0, 1.0, 0.0]);
    let half = angle * 0.5;
    let (s, c) = half.sin_cos();
    [n[0] * s, n[1] * s, n[2] * s, c]
}

#[inline]
fn q_norm(q: Q) -> Q {
    let l2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
    if l2 > 1e-12 {
        let inv = l2.sqrt().recip();
        [q[0] * inv, q[1] * inv, q[2] * inv, q[3] * inv]
    } else {
        quat_identity()
    }
}

#[inline]
fn q_conj(q: Q) -> Q {
    [-q[0], -q[1], -q[2], q[3]]
}

#[inline]
fn q_mul(a: Q, b: Q) -> Q {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}

/// Rotates vector `v` by unit quaternion `q` (`[x, y, z, w]`).
#[inline]
pub fn quat_turn(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let u = [q[0], q[1], q[2]];
    let t = scale(cross(u, v), 2.0);
    add(add(v, scale(t, q[3])), cross(u, t))
}

/// Rotates vector `v` by the inverse of unit quaternion `q`.
#[inline]
pub fn quat_back(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    quat_turn(q_conj(q), v)
}

/// Integrates quaternion `q` forward by angular velocity `spin` (world rad/s) over `dt`.
#[inline]
fn q_integrate(q: Q, spin: V, dt: f32) -> Q {
    let w2 = len_sq(spin);
    if w2 < 1e-14 || dt <= 0.0 {
        return q;
    }
    let half_dt = 0.5 * dt;
    if w2 * dt * dt <= 0.04 {
        // Fast normalized first-order exponential map (error < 0.13% at 240 Hz).
        let dq = q_mul([spin[0] * half_dt, spin[1] * half_dt, spin[2] * half_dt, 0.0], q);
        q_norm([q[0] + dq[0], q[1] + dq[1], q[2] + dq[2], q[3] + dq[3]])
    } else {
        let w = w2.sqrt();
        let dq = quat_from_axis_angle(scale(spin, w.recip()), w * dt);
        q_norm(q_mul(dq, q))
    }
}

/// Shortest-arc normalized linear interpolation between two unit quaternions.
#[inline]
fn q_nlerp(a: Q, b: Q, t: f32) -> Q {
    let dot_ab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let s = if dot_ab < 0.0 { -1.0 } else { 1.0 };
    q_norm([
        a[0] + (b[0] * s - a[0]) * t,
        a[1] + (b[1] * s - a[1]) * t,
        a[2] + (b[2] * s - a[2]) * t,
        a[3] + (b[3] * s - a[3]) * t,
    ])
}

/// Builds a 3x3 column-major rotation matrix `[col0, col1, col2]` from unit quaternion `q`.
#[inline]
fn q_to_mat3(q: Q) -> [V; 3] {
    let (x, y, z, w) = (q[0], q[1], q[2], q[3]);
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    [
        [1.0 - (yy + zz), xy + wz, xz - wy],
        [xy - wz, 1.0 - (xx + zz), yz + wx],
        [xz + wy, yz - wx, 1.0 - (xx + yy)],
    ]
}

#[inline]
fn mat3_mul(m: &[V; 3], v: V) -> V {
    [
        m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
        m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
        m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
    ]
}

#[inline]
fn mat3_mul_t(m: &[V; 3], v: V) -> V {
    [dot(m[0], v), dot(m[1], v), dot(m[2], v)]
}

/// Shortest-arc world-space rotation error vector (radians) taking `current` to `target`.
#[inline]
fn q_error_vec(target: Q, current: Q) -> V {
    let mut qe = q_mul(target, q_conj(current));
    if qe[3] < 0.0 {
        qe = [-qe[0], -qe[1], -qe[2], -qe[3]];
    }
    let v = [qe[0], qe[1], qe[2]];
    let s2 = len_sq(v);
    if s2 <= 0.25 {
        // Fast minimax polynomial for 2 * asin(s) / s (error < 0.015% for |angle| <= 60°):
        // avoids sqrt and libm atan2f on the hot hand-spring tracking path.
        let k = 2.0 * (1.0 + s2 * ((1.0 / 6.0) + s2 * ((3.0 / 40.0) + s2 * (5.0 / 112.0))));
        scale(v, k)
    } else {
        let sin_half = s2.sqrt();
        let angle = 2.0 * sin_half.atan2(qe[3]);
        scale(v, angle / sin_half)
    }
}

// ── Fast zero-dependency deterministic hasher for cell maps ──────────────────

#[derive(Default, Clone, Copy)]
struct CellMix(u64);

impl Hasher for CellMix {
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
    fn write_i32(&mut self, v: i32) {
        self.0 = (self.0.rotate_left(23) ^ v as u32 as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    }
}

type CellMap<T> = HashMap<[i32; 3], T, BuildHasherDefault<CellMix>>;

// ── Weapon Definitions ───────────────────────────────────────────────────────

/// Preset close-combat weapon archetypes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WeaponKind {
    Fist,
    Sledgehammer,
    Knife,
    Longsword,
    BattleAxe,
    Shield,
    Lightsaber,
}

/// Broad physical contact class for a weapon (taking plasma ignition state into account).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeaponClass {
    Blunt,
    Edged,
    Shield,
    Plasma,
}

/// Physical, geometric, and semantic specification of a melee weapon.
///
/// Local weapon coordinate frame:
/// - `blade_axis`: `+Y` from pommel toward tip (stab / pierce / draw direction)
/// - `edge_normal`: `+Z` forward into the cutting edge (chop direction)
/// - `flat_normal`: `+X` perpendicular to the blade flat (slap / slice-plane normal)
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WeaponSpec {
    pub kind: WeaponKind,
    /// Total mass in kg.
    pub mass: f32,
    /// Inverse mass (`1.0 / mass`, or `0.0` if immovable).
    pub inv_mass: f32,
    /// Diagonal local principal moments of inertia (`kg·cell²`).
    pub inertia_local: [f32; 3],
    /// Inverse diagonal local inertia (`1 / inertia_local`).
    pub inv_inertia_local: [f32; 3],
    /// Capsule tip endpoint in local space (cells).
    pub tip_local: [f32; 3],
    /// Capsule pommel endpoint in local space (cells).
    pub pommel_local: [f32; 3],
    /// Active blade / striking-head start in local space (cells; emitter on a lightsaber).
    pub emitter_local: [f32; 3],
    /// Analytical collision capsule radius (cells).
    pub radius: f32,
    /// Chop / cutting-edge unit normal in local space.
    pub edge_normal: [f32; 3],
    /// Pierce / stab / draw unit axis in local space.
    pub blade_axis: [f32; 3],
    /// Blade-flat / slap unit normal in local space.
    pub flat_normal: [f32; 3],
    /// Whether both `+edge_normal` and `-edge_normal` carry a cutting edge.
    pub double_edged: bool,
    /// Rigid-body coefficient of restitution on non-severing impacts.
    pub restitution: f32,
    /// Edged cutting efficiency (`0.0` for blunt weapons).
    pub sharpness: f32,
    /// Tip penetration efficiency for entering `StabBind` (`0.0` for blunt/plasma).
    pub pierce_factor: f32,
    /// Parry stability multiplier (highest on shields).
    pub parry_stability: f32,
    /// Maximum embedded depth in cells when bound via `StabBind`.
    pub max_bind_depth: f32,
    /// Multiplier on material-hardness viscous drag during lightsaber kerf cutting.
    pub viscous_drag_scale: f32,
    /// Default RGB glow color for plasma weapons.
    pub default_plasma_color: [f32; 3],
}

impl WeaponSpec {
    /// Returns the tuned physical specification for a built-in `WeaponKind`.
    pub fn preset(kind: WeaponKind) -> Self {
        let make_inv = |v: [f32; 3]| {
            [
                if v[0] > 1e-6 { 1.0 / v[0] } else { 0.0 },
                if v[1] > 1e-6 { 1.0 / v[1] } else { 0.0 },
                if v[2] > 1e-6 { 1.0 / v[2] } else { 0.0 },
            ]
        };
        let (
            mass,
            inertia,
            pommel,
            emitter,
            tip,
            radius,
            double_edged,
            restitution,
            sharpness,
            pierce_factor,
            parry_stability,
            max_bind_depth,
            viscous_drag_scale,
            plasma_color,
        ) = match kind {
            WeaponKind::Fist => (
                1.2,
                [0.85, 0.85, 0.85],
                [0.0, -0.5, 0.0],
                [0.0, 0.0, 0.0],
                [0.0, 0.9, 0.0],
                0.65,
                false,
                0.18,
                0.0,
                0.0,
                0.20,
                0.0,
                0.0,
                [0.0, 0.0, 0.0],
            ),
            WeaponKind::Sledgehammer => (
                6.5,
                [90.0, 5.0, 90.0],
                [0.0, -6.0, 0.0],
                [0.0, 1.5, 0.0],
                [0.0, 4.0, 0.0],
                0.80,
                false,
                0.24,
                0.0,
                0.0,
                0.85,
                0.0,
                0.0,
                [0.0, 0.0, 0.0],
            ),
            WeaponKind::Knife => (
                0.35,
                [0.45, 0.08, 0.45],
                [0.0, -1.0, 0.0],
                [0.0, 0.0, 0.0],
                [0.0, 2.6, 0.0],
                0.22,
                true,
                0.30,
                0.90,
                1.20,
                0.45,
                2.2,
                0.0,
                [0.0, 0.0, 0.0],
            ),
            WeaponKind::Longsword => (
                1.5,
                [22.0, 0.60, 22.0],
                [0.0, -2.5, 0.0],
                [0.0, 0.0, 0.0],
                [0.0, 9.5, 0.0],
                0.28,
                true,
                0.38,
                1.05,
                1.00,
                1.00,
                6.5,
                0.0,
                [0.0, 0.0, 0.0],
            ),
            WeaponKind::BattleAxe => (
                2.8,
                [42.0, 2.4, 42.0],
                [0.0, -5.0, 0.0],
                [0.0, 1.5, 0.0],
                [0.0, 6.5, 0.0],
                0.55,
                false,
                0.30,
                1.35,
                0.35,
                0.90,
                2.0,
                0.0,
                [0.0, 0.0, 0.0],
            ),
            WeaponKind::Shield => (
                4.5,
                [38.0, 24.0, 46.0],
                [0.0, -3.2, 0.0],
                [0.0, -3.2, 0.0],
                [0.0, 3.2, 0.0],
                1.80,
                false,
                0.32,
                0.0,
                0.0,
                1.85,
                0.0,
                0.0,
                [0.0, 0.0, 0.0],
            ),
            WeaponKind::Lightsaber => (
                1.1,
                [10.0, 0.50, 10.0],
                [0.0, -2.2, 0.0],
                [0.0, 0.5, 0.0],
                [0.0, 10.5, 0.0],
                0.32,
                true,
                0.08,
                2.0,
                0.0,
                1.25,
                0.0,
                1.0,
                [0.18, 0.72, 1.0],
            ),
        };
        Self {
            kind,
            mass,
            inv_mass: if mass > 1e-6 { 1.0 / mass } else { 0.0 },
            inertia_local: inertia,
            inv_inertia_local: make_inv(inertia),
            tip_local: tip,
            pommel_local: pommel,
            emitter_local: emitter,
            radius,
            edge_normal: [0.0, 0.0, 1.0],
            blade_axis: [0.0, 1.0, 0.0],
            flat_normal: [1.0, 0.0, 0.0],
            double_edged,
            restitution,
            sharpness,
            pierce_factor,
            parry_stability,
            max_bind_depth,
            viscous_drag_scale,
            default_plasma_color: plasma_color,
        }
    }

    /// Returns whether this weapon has a metallic / parry-capable surface.
    #[inline]
    pub fn is_metallic_parry(&self) -> bool {
        !matches!(self.kind, WeaponKind::Fist)
    }
}

/// Desired 6-DOF hand target driving a weapon via `drive_hand_spring`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HandTarget {
    pub target_pos: [f32; 3],
    pub target_rot: [f32; 4],
    pub target_vel: [f32; 3],
    pub target_spin: [f32; 3],
}

impl HandTarget {
    #[inline]
    pub fn stationary(pos: [f32; 3], rot: [f32; 4]) -> Self {
        Self {
            target_pos: pos,
            target_rot: q_norm(rot),
            target_vel: [0.0; 3],
            target_spin: [0.0; 3],
        }
    }
}

/// Strength and PD stiffness parameters for a wielder's 6-DOF hand spring.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HandSpringParams {
    /// Linear spring stiffness (`kg/s²`).
    pub kp_pos: f32,
    /// Linear spring damping (`kg/s`).
    pub kd_pos: f32,
    /// Angular spring stiffness (`kg·cell²/s²`).
    pub kp_rot: f32,
    /// Angular spring damping (`kg·cell²/s`).
    pub kd_rot: f32,
    /// Maximum linear arm force (`kg·cell/s²`, i.e., `10 × Newtons`).
    pub max_force: f32,
    /// Maximum wrist/arm torque (`kg·cell²/s²`, i.e., `100 × N·m`).
    pub max_torque: f32,
}

impl Default for HandSpringParams {
    fn default() -> Self {
        Self {
            kp_pos: 1800.0,
            kd_pos: 75.0,
            kp_rot: 16_000.0,
            kd_rot: 480.0,
            max_force: 4000.0,
            max_torque: 14_000.0,
        }
    }
}

/// Reaction forces, torques, and shock impulses transmitted back into the wielder's arm.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct HandRecoil {
    pub force: [f32; 3],
    pub torque: [f32; 3],
    pub shock_impulse: [f32; 3],
    pub shock_angular_impulse: [f32; 3],
}

/// Relative impact velocity decomposed onto an edged weapon's semantic axes.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct EdgeVelocity {
    /// Velocity component along `edge_normal` (chop).
    pub v_chop: f32,
    /// Velocity component along `blade_axis` (draw / thrust).
    pub v_draw: f32,
    /// Velocity component along `flat_normal` (slap).
    pub v_slap: f32,
}

/// 1-DOF prismatic slider constraint entered when a thrusting edged blade pierces a penetrable material.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StabBind {
    /// Bound `MeleeTarget` ID, or `None` when embedded in the static voxel world.
    pub target_id: Option<u32>,
    /// World-space surface entry point where the blade pierced the material.
    pub entry_pos: [f32; 3],
    /// Unit world-space blade penetration axis pointing into the material.
    pub axis: [f32; 3],
    /// Current penetration depth of the blade tip beyond `entry_pos` (cells, `> 0` while bound).
    pub depth: f32,
    /// Maximum penetration depth before the crossguard / hilt stops further insertion (cells).
    pub max_depth: f32,
    /// Axial sliding resistance force threshold (`kg·cell/s²`).
    pub friction: f32,
    /// Orientation locked by the material slot at entry.
    pub locked_rot: [f32; 4],
    /// Material penetrated (from `kinds.rs`, or `0` for generic ragdoll flesh).
    pub material: u8,
}

/// Dynamic rigid-body weapon instance participating in melee simulation.
#[derive(Debug, Clone)]
pub struct WeaponBody {
    pub id: u32,
    /// Optional wielder identifier; two weapons with the same `Some(wielder_id)` do not collide.
    pub wielder_id: Option<u32>,
    pub spec: WeaponSpec,
    /// Center-of-mass position in world cells.
    pub pos: [f32; 3],
    /// Orientation unit quaternion `[x, y, z, w]`.
    pub rot: [f32; 4],
    /// Linear velocity in cells/s.
    pub vel: [f32; 3],
    /// Angular velocity in world rad/s.
    pub spin: [f32; 3],
    /// Previous substep pose used to construct the swept blade capsule quad.
    pub prev_pos: [f32; 3],
    pub prev_rot: [f32; 4],
    /// Lightsaber ignition state (`true` extends plasma blade; `false` retracts to hilt).
    pub ignited: bool,
    /// Current normalized plasma blade extension (`0.0..=1.0`).
    pub blade_extension: f32,
    /// Customizable RGB color for plasma weapons.
    pub plasma_color: [f32; 3],
    /// Active 1-DOF prismatic stab binding, if embedded in penetrable material.
    pub stab_bind: Option<StabBind>,
    /// Optional 6-DOF hand target applied every substep by `MeleeWorld::step`.
    pub hand_target: Option<HandTarget>,
    /// Hand-spring stiffness and arm strength limits.
    pub hand_params: HandSpringParams,
    /// Recoil transmitted back into the wielder's arm on the latest substep.
    pub arm_recoil: HandRecoil,
    /// Viscous drag force applied by plasma kerf cutting on the latest substep.
    pub last_plasma_drag: [f32; 3],
    /// Short post-release cooldown preventing immediate re-binding on withdrawal.
    pub bind_cooldown: f32,
}

impl WeaponBody {
    /// Creates a new dynamic weapon from a built-in `WeaponKind` preset.
    ///
    /// Lightsabers start ignited (`ignited = true`, `blade_extension = 1.0`); call
    /// [`retract`](Self::retract) or [`set_extension`](Self::set_extension) to start retracted.
    pub fn new(id: u32, kind: WeaponKind, pos: [f32; 3], rot: [f32; 4]) -> Self {
        Self::from_spec(id, WeaponSpec::preset(kind), pos, rot)
    }

    /// Creates a new dynamic weapon from a custom [`WeaponSpec`].
    pub fn from_spec(id: u32, spec: WeaponSpec, pos: [f32; 3], rot: [f32; 4]) -> Self {
        let rot = q_norm(rot);
        let is_saber = spec.kind == WeaponKind::Lightsaber;
        Self {
            id,
            wielder_id: None,
            plasma_color: spec.default_plasma_color,
            spec,
            pos,
            rot,
            vel: [0.0; 3],
            spin: [0.0; 3],
            prev_pos: pos,
            prev_rot: rot,
            ignited: is_saber,
            blade_extension: if is_saber { 1.0 } else { 0.0 },
            stab_bind: None,
            hand_target: None,
            hand_params: HandSpringParams::default(),
            arm_recoil: HandRecoil::default(),
            last_plasma_drag: [0.0; 3],
            bind_cooldown: 0.0,
        }
    }

    /// Customizes a lightsaber's RGB plasma color.
    #[inline]
    pub fn with_plasma_color(mut self, rgb: [f32; 3]) -> Self {
        self.plasma_color = rgb;
        self
    }

    /// Associates this weapon with a wielder ID so dual-wielded weapons skip self-parry.
    #[inline]
    pub fn with_wielder(mut self, wielder_id: u32) -> Self {
        self.wielder_id = Some(wielder_id);
        self
    }

    /// Ignites a lightsaber (extends blade smoothly toward `1.0` over `1 / BLADE_EXTEND_RATE` s).
    #[inline]
    pub fn ignite(&mut self) {
        if self.spec.kind == WeaponKind::Lightsaber {
            self.ignited = true;
        }
    }

    /// Retracts a lightsaber (retracts blade smoothly toward `0.0`).
    #[inline]
    pub fn retract(&mut self) {
        if self.spec.kind == WeaponKind::Lightsaber {
            self.ignited = false;
        }
    }

    /// Sets ignition target state for a lightsaber.
    #[inline]
    pub fn set_ignited(&mut self, ignited: bool) {
        if self.spec.kind == WeaponKind::Lightsaber {
            self.ignited = ignited;
        }
    }

    /// Directly sets plasma blade extension (`0.0..=1.0`), e.g. for spawning retracted.
    #[inline]
    pub fn set_extension(&mut self, extension: f32) {
        self.blade_extension = extension.clamp(0.0, 1.0);
        if self.blade_extension <= 0.0 {
            self.ignited = false;
        }
    }

    /// True if this weapon currently has an active plasma blade.
    #[inline]
    pub fn is_plasma_active(&self) -> bool {
        self.spec.kind == WeaponKind::Lightsaber && self.blade_extension > 0.05
    }

    /// Returns the effective contact class of this weapon right now.
    #[inline]
    pub fn active_class(&self) -> WeaponClass {
        match self.spec.kind {
            WeaponKind::Fist | WeaponKind::Sledgehammer => WeaponClass::Blunt,
            WeaponKind::Knife | WeaponKind::Longsword | WeaponKind::BattleAxe => WeaponClass::Edged,
            WeaponKind::Shield => WeaponClass::Shield,
            WeaponKind::Lightsaber => {
                if self.is_plasma_active() {
                    WeaponClass::Plasma
                } else {
                    WeaponClass::Blunt
                }
            }
        }
    }

    /// Local tip endpoint accounting for lightsaber blade extension.
    #[inline]
    pub fn active_tip_local(&self) -> [f32; 3] {
        if self.spec.kind == WeaponKind::Lightsaber {
            lerp3(self.spec.emitter_local, self.spec.tip_local, self.blade_extension)
        } else {
            self.spec.tip_local
        }
    }

    /// World-space full collision capsule `(pommel, tip, radius)` at current pose.
    #[inline]
    pub fn capsule_world(&self) -> ([f32; 3], [f32; 3], f32) {
        self.capsule_at(self.pos, self.rot, self.active_tip_local())
    }

    /// World-space full collision capsule `(pommel, tip, radius)` at an arbitrary pose.
    #[inline]
    fn capsule_at(&self, pos: V, rot: Q, tip_local: V) -> (V, V, f32) {
        let pm = self.spec.pommel_local;
        if pm[0] == 0.0 && pm[2] == 0.0 && tip_local[0] == 0.0 && tip_local[2] == 0.0 {
            // Fast path for Y-axis aligned capsules (all built-in presets): only column 1 of R(q).
            let (x, y, z, w) = (rot[0], rot[1], rot[2], rot[3]);
            let col1 = [
                2.0 * (x * y - w * z),
                1.0 - 2.0 * (x * x + z * z),
                2.0 * (y * z + w * x),
            ];
            let p0 = add(pos, scale(col1, pm[1]));
            let p1 = add(pos, scale(col1, tip_local[1]));
            (p0, p1, self.spec.radius)
        } else {
            let m = q_to_mat3(rot);
            let p0 = add(pos, mat3_mul(&m, pm));
            let p1 = add(pos, mat3_mul(&m, tip_local));
            (p0, p1, self.spec.radius)
        }
    }

    /// World-space active blade segment `(emitter, active_tip, radius)`.
    #[inline]
    pub fn blade_segment_world(&self) -> ([f32; 3], [f32; 3], f32) {
        let p0 = add(self.pos, quat_turn(self.rot, self.spec.emitter_local));
        let p1 = add(self.pos, quat_turn(self.rot, self.active_tip_local()));
        (p0, p1, self.spec.radius)
    }

    /// Fraction along `[pommel_local, active_tip_local]` where the emitter / blade starts.
    #[inline]
    fn emitter_fraction(&self, tip_local: V) -> f32 {
        // Fast path when pommel, emitter, and tip lie on the Y blade axis (all built-in presets).
        let dy_tot = tip_local[1] - self.spec.pommel_local[1];
        if (tip_local[0] - self.spec.pommel_local[0]).abs() < 1e-6
            && (tip_local[2] - self.spec.pommel_local[2]).abs() < 1e-6
            && dy_tot.abs() > 1e-5
        {
            return ((self.spec.emitter_local[1] - self.spec.pommel_local[1]) / dy_tot)
                .clamp(0.0, 1.0);
        }
        let total = len(sub(tip_local, self.spec.pommel_local));
        if total <= 1e-5 {
            return 0.0;
        }
        (len(sub(self.spec.emitter_local, self.spec.pommel_local)) / total).clamp(0.0, 1.0)
    }

    /// World-space semantic axes `(edge_normal, blade_axis, flat_normal)`.
    #[inline]
    pub fn world_axes(&self) -> ([f32; 3], [f32; 3], [f32; 3]) {
        (
            quat_turn(self.rot, self.spec.edge_normal),
            quat_turn(self.rot, self.spec.blade_axis),
            quat_turn(self.rot, self.spec.flat_normal),
        )
    }

    /// Instantaneous world-space velocity of a point on this rigid weapon body.
    #[inline]
    pub fn point_velocity(&self, world_point: [f32; 3]) -> [f32; 3] {
        add(self.vel, cross(self.spin, sub(world_point, self.pos)))
    }

    /// Decomposes a world-space relative impact velocity onto `(edge_normal, blade_axis, flat_normal)`.
    #[inline]
    pub fn decompose_velocity(&self, v_rel: [f32; 3]) -> EdgeVelocity {
        let (w_edge, w_blade, w_flat) = self.world_axes();
        EdgeVelocity {
            v_chop: dot(v_rel, w_edge),
            v_draw: dot(v_rel, w_blade),
            v_slap: dot(v_rel, w_flat),
        }
    }

    /// Multiplies a world-space vector by this weapon's world-space inverse inertia tensor `R I^-1 R^T v`.
    #[inline]
    pub fn inv_inertia_world_mul(&self, v: [f32; 3]) -> [f32; 3] {
        let local = quat_back(self.rot, v);
        let scaled = [
            local[0] * self.spec.inv_inertia_local[0],
            local[1] * self.spec.inv_inertia_local[1],
            local[2] * self.spec.inv_inertia_local[2],
        ];
        quat_turn(self.rot, scaled)
    }

    /// Applies an instantaneous world-space impulse `j` at `world_point`, updating linear & angular velocity.
    #[inline]
    pub fn apply_impulse_at(&mut self, j: [f32; 3], world_point: [f32; 3]) {
        let r = sub(world_point, self.pos);
        self.vel = add(self.vel, scale(j, self.spec.inv_mass));
        let ang_j = cross(r, j);
        self.spin = add(self.spin, self.inv_inertia_world_mul(ang_j));
        self.arm_recoil.shock_impulse = add(self.arm_recoil.shock_impulse, j);
        self.arm_recoil.shock_angular_impulse = add(self.arm_recoil.shock_angular_impulse, ang_j);
    }

    /// Multiplies a world-space vector by this weapon's world-space inverse inertia tensor using
    /// a precomputed rotation matrix `m = q_to_mat3(self.rot)`.
    #[inline]
    fn inv_inertia_mat_mul(&self, m: &[V; 3], v: V) -> V {
        let local = mat3_mul_t(m, v);
        let scaled = [
            local[0] * self.spec.inv_inertia_local[0],
            local[1] * self.spec.inv_inertia_local[1],
            local[2] * self.spec.inv_inertia_local[2],
        ];
        mat3_mul(m, scaled)
    }

    /// Applies an instantaneous world-space impulse `j` at `world_point` using precomputed `m`.
    #[inline]
    fn apply_impulse_at_mat(&mut self, m: &[V; 3], j: V, world_point: V) {
        let r = sub(world_point, self.pos);
        self.vel = add(self.vel, scale(j, self.spec.inv_mass));
        let ang_j = cross(r, j);
        self.spin = add(self.spin, self.inv_inertia_mat_mul(m, ang_j));
        self.arm_recoil.shock_impulse = add(self.arm_recoil.shock_impulse, j);
        self.arm_recoil.shock_angular_impulse = add(self.arm_recoil.shock_angular_impulse, ang_j);
    }

    /// Effective inverse mass of this weapon along unit direction `dir` at `world_point` using `m`.
    #[inline]
    fn inv_mass_along_mat(&self, m: &[V; 3], world_point: V, dir: V) -> f32 {
        let r = sub(world_point, self.pos);
        let r_x_n = cross(r, dir);
        let ang = dot(cross(self.inv_inertia_mat_mul(m, r_x_n), r), dir);
        self.spec.inv_mass + ang.max(0.0)
    }

    /// Effective inverse mass of this weapon along unit direction `dir` at `world_point`.
    #[inline]
    fn inv_mass_along(&self, world_point: V, dir: V) -> f32 {
        let m = q_to_mat3(self.rot);
        self.inv_mass_along_mat(&m, world_point, dir)
    }
}

// ── 6-DOF Implicit PD Hand-Spring Driver ─────────────────────────────────────

/// Drives `weapon` toward `target` using an unconditionally stable implicit 6-DOF PD
/// spring-damper capped by character strength `(params.max_force, params.max_torque)`.
///
/// Heavy weapons naturally lag behind fast flicks, preserve realistic swing momentum,
/// and transmit opposite reaction force/torque back to the wielder via [`HandRecoil`].
#[inline]
pub fn drive_hand_spring(
    weapon: &mut WeaponBody,
    target: &HandTarget,
    params: &HandSpringParams,
    dt: f32,
) -> HandRecoil {
    if dt <= 0.0 || weapon.spec.inv_mass <= 0.0 {
        return HandRecoil::default();
    }

    // 1. Implicit 3-DOF linear PD force:
    //    F = (kp * (e_x + dt * e_v) + kd * e_v) / (1 + inv_m * dt * (kd + dt * kp))
    let e_x = sub(target.target_pos, weapon.pos);
    let e_v = sub(target.target_vel, weapon.vel);
    let denom_lin = 1.0 + weapon.spec.inv_mass * dt * (params.kd_pos + dt * params.kp_pos);
    let f_raw = add(
        scale(add(e_x, scale(e_v, dt)), params.kp_pos),
        scale(e_v, params.kd_pos),
    );
    let force = clamp_len(scale(f_raw, denom_lin.recip()), params.max_force);
    weapon.vel = add(weapon.vel, scale(force, weapon.spec.inv_mass * dt));

    // 2. Implicit 3-DOF rotational PD torque solved in local diagonal inertia frame:
    //    Since kp_rot, kd_rot, dt are scalar, combine world-space error before rotating once.
    let m = q_to_mat3(weapon.rot);
    let e_r_world = q_error_vec(target.target_rot, weapon.rot);
    let e_w_world = sub(target.target_spin, weapon.spin);
    let drive_world = add(
        scale(e_r_world, params.kp_rot),
        scale(e_w_world, params.kd_rot + dt * params.kp_rot),
    );
    let drive_local = mat3_mul_t(&m, drive_world);

    let damp_k = dt * (params.kd_rot + dt * params.kp_rot);
    let tau_local = [
        drive_local[0] / (1.0 + weapon.spec.inv_inertia_local[0] * damp_k),
        drive_local[1] / (1.0 + weapon.spec.inv_inertia_local[1] * damp_k),
        drive_local[2] / (1.0 + weapon.spec.inv_inertia_local[2] * damp_k),
    ];
    // Rotation preserves Euclidean norm, so clamping in local space avoids an extra mat3 round-trip.
    let tau_clamped_local = clamp_len(tau_local, params.max_torque);
    let d_spin_local = [
        tau_clamped_local[0] * weapon.spec.inv_inertia_local[0] * dt,
        tau_clamped_local[1] * weapon.spec.inv_inertia_local[1] * dt,
        tau_clamped_local[2] * weapon.spec.inv_inertia_local[2] * dt,
    ];
    weapon.spin = add(weapon.spin, mat3_mul(&m, d_spin_local));
    let torque_world = mat3_mul(&m, tau_clamped_local);

    // Newton's 3rd Law: weapon exerts opposite force/torque on the wielder's hand.
    let recoil = HandRecoil {
        force: scale(force, -1.0),
        torque: scale(torque_world, -1.0),
        shock_impulse: [0.0; 3],
        shock_angular_impulse: [0.0; 3],
    };
    weapon.arm_recoil.force = add(weapon.arm_recoil.force, recoil.force);
    weapon.arm_recoil.torque = add(weapon.arm_recoil.torque, recoil.torque);
    recoil
}

// ── Dynamic Targets ──────────────────────────────────────────────────────────

/// Geometric & semantic classification of a dynamic melee target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetKind {
    /// Analytical capsule spanning `pos ± axis * half_len` with radius `radius`.
    Capsule,
    /// Axis-aligned bounding box centered at `pos` with half-extents `radius + |axis| * half_len`.
    Aabb,
    /// Ragdoll / flesh limb capsule (always penetrable & severable by edged blades).
    Ragdoll,
}

/// Dynamic target capsule or AABB that weapons can strike, slice, stab, or parry against.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MeleeTarget {
    pub id: u32,
    pub kind: TargetKind,
    pub pos: [f32; 3],
    pub vel: [f32; 3],
    /// Mass in kg (`<= 0.0` marks a static/kinematic target with zero inverse mass).
    pub mass: f32,
    /// Material ID from `kinds.rs` (e.g., `WOOD`, `STEEL`, `PLASTER`).
    pub material: u8,
    /// Capsule radius or base half-width in cells.
    pub radius: f32,
    /// Half-length along `axis` in cells.
    pub half_len: f32,
    /// Unit axis vector for capsules / elongation axis for AABBs.
    pub axis: [f32; 3],
}

impl MeleeTarget {
    #[inline]
    pub fn inv_mass(&self) -> f32 {
        if self.mass > 1e-6 { 1.0 / self.mass } else { 0.0 }
    }

    #[inline]
    pub fn aabb_half_extents(&self) -> [f32; 3] {
        let ax = unit_or(self.axis, [0.0, 1.0, 0.0]);
        [
            self.radius + ax[0].abs() * self.half_len,
            self.radius + ax[1].abs() * self.half_len,
            self.radius + ax[2].abs() * self.half_len,
        ]
    }

    #[inline]
    fn capsule_endpoints_at(&self, center: V) -> (V, V) {
        let ax = unit_or(self.axis, [0.0, 1.0, 0.0]);
        let off = scale(ax, self.half_len);
        (sub(center, off), add(center, off))
    }

    #[inline]
    fn swept_aabb(&self, prev_pos: V, curr_pos: V) -> (V, V) {
        let ext = self.aabb_half_extents();
        let lo = [
            prev_pos[0].min(curr_pos[0]) - ext[0],
            prev_pos[1].min(curr_pos[1]) - ext[1],
            prev_pos[2].min(curr_pos[2]) - ext[2],
        ];
        let hi = [
            prev_pos[0].max(curr_pos[0]) + ext[0],
            prev_pos[1].max(curr_pos[1]) + ext[1],
            prev_pos[2].max(curr_pos[2]) + ext[2],
        ];
        (lo, hi)
    }
}

// ── Cooling Glow Map & Events ────────────────────────────────────────────────

/// Planar cut geometry emitted by edged severing and lightsaber kerf cuts.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CutPlane {
    pub point: [f32; 3],
    pub normal: [f32; 3],
}

/// Cooling thermal glow record for a voxel face newly exposed by a plasma blade.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GlowCell {
    /// Normalized incandescence cooling from `1.0` down to `0.0` over `COOLING_DURATION` (4.0 s).
    pub heat: f32,
    /// Bitmask of heated faces (`0..6` = `+X, -X, +Y, -Y, +Z, -Z`).
    pub face_mask: u8,
    /// Plasma tint RGB.
    pub color: [f32; 3],
}

/// Tracks incandescent voxel faces cut by lightsabers as they cool from `1.0` to `0.0` over `4.0 s`.
#[derive(Debug, Clone, Default)]
pub struct CoolingGlowMap {
    cells: CellMap<GlowCell>,
}

impl CoolingGlowMap {
    pub fn new() -> Self {
        Self {
            cells: CellMap::default(),
        }
    }

    /// Marks `cell` as incandescent (`heat = 1.0`) on the faces in `face_mask`.
    pub fn heat_cell(&mut self, cell: [i32; 3], face_mask: u8, color: [f32; 3]) {
        if let Some(entry) = self.cells.get_mut(&cell) {
            entry.heat = 1.0;
            entry.face_mask |= face_mask;
            entry.color = color;
            return;
        }
        if self.cells.len() >= MAX_GLOW_CELLS {
            // Evict the coolest cell if full so the map stays bounded.
            if let Some((&coolest_k, _)) = self
                .cells
                .iter()
                .min_by(|a, b| a.1.heat.total_cmp(&b.1.heat))
            {
                self.cells.remove(&coolest_k);
            }
        }
        self.cells.insert(
            cell,
            GlowCell {
                heat: 1.0,
                face_mask,
                color,
            },
        );
    }

    /// Cools all glowing cells linearly over `duration` seconds, removing entries once `heat <= 0.0`.
    pub fn tick_with_duration(&mut self, dt: f32, duration: f32) {
        if dt <= 0.0 || self.cells.is_empty() {
            return;
        }
        let drop = dt / duration.max(1e-4);
        self.cells.retain(|_, g| {
            g.heat -= drop;
            g.heat > 1e-5
        });
    }

    /// Cools all glowing cells over the standard `COOLING_DURATION` (`4.0 s`).
    #[inline]
    pub fn tick(&mut self, dt: f32) {
        self.tick_with_duration(dt, COOLING_DURATION);
    }

    /// Current incandescent temperature (`0.0..=1.0`) at `cell`, or `0.0` if cool.
    #[inline]
    pub fn heat_at(&self, cell: [i32; 3]) -> f32 {
        self.cells.get(&cell).map_or(0.0, |g| g.heat)
    }

    #[inline]
    pub fn get(&self, cell: [i32; 3]) -> Option<&GlowCell> {
        self.cells.get(&cell)
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.cells.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }

    #[inline]
    pub fn clear(&mut self) {
        self.cells.clear();
    }

    pub fn iter(&self) -> impl Iterator<Item = (&[i32; 3], &GlowCell)> {
        self.cells.iter()
    }
}

/// Output events emitted by the melee & lightsaber solver for carving, ragdolls, fire, VFX, and audio.
#[derive(Debug, Clone, PartialEq)]
pub enum MeleeEvent {
    /// Rigid blunt strike against a target or voxel surface.
    BluntImpact {
        weapon_id: u32,
        target_id: Option<u32>,
        pos: [f32; 3],
        normal: [f32; 3],
        impulse: f32,
        shock_impulse: f32,
    },
    /// Voxel cell crushed by an impact exceeding `kinds::breaks_at`.
    CrushVoxel {
        cell: [i32; 3],
        push: [f32; 3],
    },
    /// Steel-on-steel or shield parry deflection with sparks and modal steel-ring impulse.
    ParryClash {
        pos: [f32; 3],
        normal: [f32; 3],
        impulse: f32,
        spark_count: u32,
    },
    /// Edged or plasma planar sever feeding `bodies/carve.rs` and `ragdoll.rs`.
    SliceCut {
        target_id: Option<u32>,
        plane_point: [f32; 3],
        plane_normal: [f32; 3],
        cut_energy: f32,
        is_plasma: bool,
    },
    /// Edged blade pierced penetrable material and entered a 1-DOF `StabBind` slider.
    StabEntered {
        weapon_id: u32,
        target_id: Option<u32>,
        entry_pos: [f32; 3],
        axis: [f32; 3],
        depth: f32,
    },
    /// Previously bound blade smoothly extracted (`depth <= 0.0`).
    StabReleased {
        weapon_id: u32,
        target_id: Option<u32>,
    },
    /// Continuous 1–2 cell plasma kerf carved by a lightsaber across non-energy voxel matter.
    PlasmaKerf {
        cells: Vec<[i32; 3]>,
        cut_plane: CutPlane,
        cut_energy: f32,
        heat_cells: Vec<[i32; 3]>,
    },
    /// Flammable neighbor ignited by an adjacent plasma kerf cut.
    IgniteCell {
        cell: [i32; 3],
    },
    /// Opposing lightsabers locked in high-friction magnetic-repulsion clash.
    PlasmaClash {
        pos: [f32; 3],
        intensity: f32,
        hum_pitch_shift: f32,
    },
}

/// Global tuning knobs for [`MeleeWorld`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MeleeConfig {
    pub gravity: [f32; 3],
    pub substeps_per_tick: usize,
    pub cooling_duration: f32,
    pub plasma_drag_scale: f32,
}

impl Default for MeleeConfig {
    fn default() -> Self {
        Self {
            gravity: DEFAULT_GRAVITY,
            substeps_per_tick: SUBSTEPS_PER_TICK,
            cooling_duration: COOLING_DURATION,
            plasma_drag_scale: 1.0,
        }
    }
}

// ── Continuous Collision Detection Geometry ──────────────────────────────────

#[derive(Debug, Clone, Copy)]
struct SweepHit {
    t: f32,
    s_a: f32,
    s_b: f32,
    pos: V,
    /// Unit normal pointing from B (surface/other) toward A (weapon).
    normal: V,
    penetration: f32,
}

#[inline]
fn aabb_overlap(a_lo: V, a_hi: V, b_lo: V, b_hi: V) -> bool {
    a_lo[0] <= b_hi[0]
        && a_hi[0] >= b_lo[0]
        && a_lo[1] <= b_hi[1]
        && a_hi[1] >= b_lo[1]
        && a_lo[2] <= b_hi[2]
        && a_hi[2] >= b_lo[2]
}

#[inline]
fn quad_swept_aabb(a0_p: V, a1_p: V, a0_c: V, a1_c: V, radius: f32) -> (V, V) {
    let lo = [
        a0_p[0].min(a1_p[0]).min(a0_c[0]).min(a1_c[0]) - radius,
        a0_p[1].min(a1_p[1]).min(a0_c[1]).min(a1_c[1]) - radius,
        a0_p[2].min(a1_p[2]).min(a0_c[2]).min(a1_c[2]) - radius,
    ];
    let hi = [
        a0_p[0].max(a1_p[0]).max(a0_c[0]).max(a1_c[0]) + radius,
        a0_p[1].max(a1_p[1]).max(a0_c[1]).max(a1_c[1]) + radius,
        a0_p[2].max(a1_p[2]).max(a0_c[2]).max(a1_c[2]) + radius,
    ];
    (lo, hi)
}

/// Exact closest points between two 3D line segments `[p1, q1]` and `[p2, q2]` (Ericson §5.1.9).
/// Returns `(dist_sq, s, t, c1, c2)`.
#[inline]
fn closest_points_segments(p1: V, q1: V, p2: V, q2: V) -> (f32, f32, f32, V, V) {
    let d1 = sub(q1, p1);
    let d2 = sub(q2, p2);
    let r = sub(p1, p2);
    let a = dot(d1, d1);
    let e = dot(d2, d2);
    let f = dot(d2, r);
    const EPS: f32 = 1e-10;

    let (s, t) = if a <= EPS && e <= EPS {
        (0.0, 0.0)
    } else if a <= EPS {
        (0.0, (f / e).clamp(0.0, 1.0))
    } else {
        let c = dot(d1, r);
        if e <= EPS {
            ((-c / a).clamp(0.0, 1.0), 0.0)
        } else {
            let b = dot(d1, d2);
            let denom = a * e - b * b;
            let mut s = if denom > EPS * a * e {
                ((b * f - c * e) / denom).clamp(0.0, 1.0)
            } else {
                // Parallel or antiparallel segments: pick the midpoint of their overlap interval
                // so blade-vs-blade contact occurs at mid-blade rather than arbitrarily at the pommel.
                let inv_a = a.recip();
                let s_p2 = dot(sub(p2, p1), d1) * inv_a;
                let s_q2 = dot(sub(q2, p1), d1) * inv_a;
                let s_lo = s_p2.min(s_q2).clamp(0.0, 1.0);
                let s_hi = s_p2.max(s_q2).clamp(0.0, 1.0);
                0.5 * (s_lo + s_hi)
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

    let c1 = add(p1, scale(d1, s));
    let c2 = add(p2, scale(d2, t));
    (len_sq(sub(c1, c2)), s, t, c1, c2)
}

#[inline]
fn clamp_point_aabb(p: V, lo: V, hi: V) -> V {
    [
        p[0].clamp(lo[0], hi[0]),
        p[1].clamp(lo[1], hi[1]),
        p[2].clamp(lo[2], hi[2]),
    ]
}

/// Exact distance & closest points between 3D line segment `[a0, a1]` and AABB `[lo, hi]`.
///
/// Minimizes the piecewise-quadratic convex function `dist_sq(a0 + s*d, [lo, hi])` across
/// all axis-slab breakpoints in `[0, 1]`. Returns `(dist_sq, s_best, p_seg, p_box, normal)`.
fn closest_segment_aabb(a0: V, a1: V, lo: V, hi: V) -> (f32, f32, V, V, V) {
    let d = sub(a1, a0);
    let mut cuts = [0.0f32; 8];
    cuts[0] = 0.0;
    cuts[1] = 1.0;
    let mut n_cuts = 2usize;

    for i in 0..3 {
        if d[i].abs() > 1e-8 {
            let inv = 1.0 / d[i];
            let t0 = (lo[i] - a0[i]) * inv;
            if t0 > 0.0 && t0 < 1.0 {
                cuts[n_cuts] = t0;
                n_cuts += 1;
            }
            let t1 = (hi[i] - a0[i]) * inv;
            if t1 > 0.0 && t1 < 1.0 {
                cuts[n_cuts] = t1;
                n_cuts += 1;
            }
        }
    }

    // Insertion sort tiny array (<= 8 elements).
    for i in 1..n_cuts {
        let key = cuts[i];
        let mut j = i;
        while j > 0 && cuts[j - 1] > key {
            cuts[j] = cuts[j - 1];
            j -= 1;
        }
        cuts[j] = key;
    }

    let mut best_d2 = f32::INFINITY;
    let mut best_s = 0.0f32;
    let mut best_p_seg = a0;
    let mut best_p_box = clamp_point_aabb(a0, lo, hi);

    for k in 0..n_cuts - 1 {
        let s0 = cuts[k];
        let s1 = cuts[k + 1];
        if s1 - s0 < 1e-9 {
            continue;
        }
        let sm = 0.5 * (s0 + s1);
        let pm = add(a0, scale(d, sm));
        // On (s0, s1), each axis stays strictly below lo, inside [lo, hi], or above hi.
        let mut c2 = 0.0f32;
        let mut c1 = 0.0f32;
        for i in 0..3 {
            if pm[i] < lo[i] {
                let diff = a0[i] - lo[i];
                c2 += d[i] * d[i];
                c1 += 2.0 * d[i] * diff;
            } else if pm[i] > hi[i] {
                let diff = a0[i] - hi[i];
                c2 += d[i] * d[i];
                c1 += 2.0 * d[i] * diff;
            }
        }
        let s_cand = if c2 > 1e-12 {
            (-0.5 * c1 / c2).clamp(s0, s1)
        } else {
            sm
        };
        let p_seg = add(a0, scale(d, s_cand));
        let p_box = clamp_point_aabb(p_seg, lo, hi);
        let d2 = len_sq(sub(p_seg, p_box));
        if d2 < best_d2 {
            best_d2 = d2;
            best_s = s_cand;
            best_p_seg = p_seg;
            best_p_box = p_box;
            if best_d2 == 0.0 {
                break;
            }
        }
    }

    // Also test endpoints explicitly when segment is degenerate.
    if best_d2.is_infinite() {
        best_p_seg = a0;
        best_p_box = clamp_point_aabb(a0, lo, hi);
        best_d2 = len_sq(sub(best_p_seg, best_p_box));
    }

    let normal = if best_d2 > 1e-10 {
        scale(sub(best_p_seg, best_p_box), best_d2.sqrt().recip())
    } else {
        // Point lies inside the AABB: pick nearest face normal pointing outward.
        let mut min_pen = f32::INFINITY;
        let mut n = [0.0, 1.0, 0.0];
        for i in 0..3 {
            let d_lo = (best_p_seg[i] - lo[i]).abs();
            if d_lo < min_pen {
                min_pen = d_lo;
                n = [0.0; 3];
                n[i] = -1.0;
            }
            let d_hi = (hi[i] - best_p_seg[i]).abs();
            if d_hi < min_pen {
                min_pen = d_hi;
                n = [0.0; 3];
                n[i] = 1.0;
            }
        }
        n
    };

    (best_d2, best_s, best_p_seg, best_p_box, normal)
}

/// Exact Lipschitz-bounded continuous collision detection between two swept capsules.
#[inline]
#[allow(clippy::too_many_arguments)]
fn swept_capsule_capsule_toi(
    a0_p: V,
    a1_p: V,
    a0_c: V,
    a1_c: V,
    r_a: f32,
    b0_p: V,
    b1_p: V,
    b0_c: V,
    b1_c: V,
    r_b: f32,
) -> Option<SweepHit> {
    let r_sum = r_a + r_b;
    let r_sum_sq = r_sum * r_sum;

    let (d2_0, sa_0, sb_0, pa_0, pb_0) = closest_points_segments(a0_p, a1_p, b0_p, b1_p);
    let prev_sep_vec = sub(pa_0, pb_0);

    if d2_0 <= r_sum_sq {
        let dist = d2_0.sqrt();
        let normal = if dist > 1e-5 {
            scale(prev_sep_vec, dist.recip())
        } else {
            let da0 = sub(a0_c, a0_p);
            let da1 = sub(a1_c, a1_p);
            let db0 = sub(b0_c, b0_p);
            let db1 = sub(b1_c, b1_p);
            let fallback_rel = sub(lerp3(da0, da1, sa_0), lerp3(db0, db1, sb_0));
            if len_sq(fallback_rel) > 1e-10 {
                scale(unit_or(fallback_rel, [0.0, 1.0, 0.0]), -1.0)
            } else {
                unit_or(cross(sub(a1_c, a0_c), sub(b1_c, b0_c)), [0.0, 1.0, 0.0])
            }
        };
        let pos = add(pb_0, scale(normal, r_b + 0.5 * (dist - r_sum)));
        return Some(SweepHit {
            t: 0.0,
            s_a: sa_0,
            s_b: sb_0,
            pos,
            normal,
            penetration: (r_sum - dist).max(0.0),
        });
    }

    let da0 = sub(a0_c, a0_p);
    let da1 = sub(a1_c, a1_p);
    let db0 = sub(b0_c, b0_p);
    let db1 = sub(b1_c, b1_p);

    let build_hit = |t: f32, d2: f32, s_a: f32, s_b: f32, p_a: V, p_b: V| -> SweepHit {
        let dist = d2.sqrt();
        let normal = if dist > 1e-5 {
            scale(sub(p_a, p_b), dist.recip())
        } else if d2_0 > 1e-10 {
            unit_or(prev_sep_vec, [0.0, 1.0, 0.0])
        } else {
            let fallback_rel = sub(lerp3(da0, da1, s_a), lerp3(db0, db1, s_b));
            if len_sq(fallback_rel) > 1e-10 {
                scale(unit_or(fallback_rel, [0.0, 1.0, 0.0]), -1.0)
            } else {
                unit_or(cross(sub(a1_c, a0_c), sub(b1_c, b0_c)), [0.0, 1.0, 0.0])
            }
        };
        let pos = add(p_b, scale(normal, r_b + 0.5 * (dist - r_sum)));
        SweepHit {
            t,
            s_a,
            s_b,
            pos,
            normal,
            penetration: (r_sum - dist).max(0.0),
        }
    };

    // Exact separating-hyperplane early-out at t = 0:
    // Because pa_0, pb_0 are closest points of two convex segments, `sep_n = unit(pa_0 - pb_0)`
    // separates them by `dist_0`. Any motion along `sep_n` closes by at most `close_n`.
    let dist_0 = d2_0.sqrt();
    let sep_0 = dist_0 - r_sum;
    if dist_0 > 1e-6 {
        let sep_n = scale(prev_sep_vec, dist_0.recip());
        let a_min_n = dot(da0, sep_n).min(dot(da1, sep_n));
        let b_max_n = dot(db0, sep_n).max(dot(db1, sep_n));
        let close_n = b_max_n - a_min_n;
        if close_n <= sep_0 {
            return None;
        }
    }

    // Exact global Lipschitz bound on d/dt |P_A(s_a, t) - P_B(s_b, t)| over [0, 1]^2.
    let l_bound_sq = len_sq(sub(da0, db0))
        .max(len_sq(sub(da0, db1)))
        .max(len_sq(sub(da1, db0)))
        .max(len_sq(sub(da1, db1)));
    if l_bound_sq <= 1e-14 {
        return None;
    }
    let l_bound = l_bound_sq.sqrt();
    if sep_0 > l_bound {
        return None;
    }

    let eval = |t: f32| {
        let a0 = lerp3(a0_p, a0_c, t);
        let a1 = lerp3(a1_p, a1_c, t);
        let b0 = lerp3(b0_p, b0_c, t);
        let b1 = lerp3(b1_p, b1_c, t);
        closest_points_segments(a0, a1, b0, b1)
    };

    // Safe step floor (0.25 * r_sum / L) cannot tunnel across a crossing of width 2 * r_sum / L.
    let min_step = (0.25 * r_sum / l_bound).clamp(1e-4, 0.25);
    let mut t_prev = 0.0f32;
    let mut sep = sep_0;

    for _ in 0..64 {
        let step = (sep / l_bound).max(min_step);
        let t_next = (t_prev + step).min(1.0);
        let (d2, s_a, s_b, p_a, p_b) = eval(t_next);
        if d2 <= r_sum_sq {
            // Bisect [t_prev, t_next] for accurate TOI and surface normal.
            let mut lo = t_prev;
            let mut hi = t_next;
            let mut best = (hi, d2, s_a, s_b, p_a, p_b);
            for _ in 0..4 {
                let mid = 0.5 * (lo + hi);
                let (md2, msa, msb, mpa, mpb) = eval(mid);
                if md2 <= r_sum_sq {
                    hi = mid;
                    best = (mid, md2, msa, msb, mpa, mpb);
                } else {
                    lo = mid;
                }
            }
            return Some(build_hit(best.0, best.1, best.2, best.3, best.4, best.5));
        }
        if t_next >= 1.0 {
            return None;
        }
        t_prev = t_next;
        sep = d2.sqrt() - r_sum;
        if sep > l_bound * (1.0 - t_prev) {
            return None;
        }
    }

    let (d2_1, sa_1, sb_1, pa_1, pb_1) = eval(1.0);
    if d2_1 <= r_sum_sq {
        return Some(build_hit(1.0, d2_1, sa_1, sb_1, pa_1, pb_1));
    }
    None
}

/// Exact Lipschitz-bounded continuous collision detection between a swept capsule and a swept AABB.
#[inline]
#[allow(clippy::too_many_arguments)]
fn swept_capsule_aabb_toi(
    a0_p: V,
    a1_p: V,
    a0_c: V,
    a1_c: V,
    r_a: f32,
    c_p: V,
    c_c: V,
    half_ext: V,
) -> Option<SweepHit> {
    let r_sq = r_a * r_a;
    let da0 = sub(a0_c, a0_p);
    let da1 = sub(a1_c, a1_p);
    let dc = sub(c_c, c_p);
    let l_bound = len_sq(sub(da0, dc)).max(len_sq(sub(da1, dc))).sqrt();

    let eval = |t: f32| {
        let a0 = lerp3(a0_p, a0_c, t);
        let a1 = lerp3(a1_p, a1_c, t);
        let c = lerp3(c_p, c_c, t);
        closest_segment_aabb(a0, a1, sub(c, half_ext), add(c, half_ext))
    };

    let build_hit = |t: f32, d2: f32, s: f32, _p_seg: V, p_box: V, n_box: V| -> SweepHit {
        let dist = d2.sqrt();
        let rel_sweep = sub(lerp3(da0, da1, s), dc);
        let normal = if dist > 1e-5 {
            n_box
        } else if len_sq(rel_sweep) > 1e-10 {
            // Prefer opposing entry motion if deeply penetrating.
            if dot(n_box, rel_sweep) <= 0.0 {
                n_box
            } else {
                scale(unit_or(rel_sweep, n_box), -1.0)
            }
        } else {
            n_box
        };
        SweepHit {
            t,
            s_a: s,
            s_b: 0.0,
            pos: p_box,
            normal,
            penetration: (r_a - dist).max(0.0),
        }
    };

    let (d2_0, s0, ps0, pb0, n0) = eval(0.0);
    if d2_0 <= r_sq {
        return Some(build_hit(0.0, d2_0, s0, ps0, pb0, n0));
    }
    if l_bound <= 1e-7 {
        return None;
    }
    let max_reach = r_a + l_bound;
    if d2_0 > max_reach * max_reach {
        return None;
    }

    // Half-thickness of the AABB + capsule radius bounds the crossing width.
    let min_half = half_ext[0].min(half_ext[1]).min(half_ext[2]);
    let width_ref = (r_a + min_half).max(0.1);
    let min_step = (0.25 * width_ref / l_bound).clamp(1e-4, 0.25);
    let mut t_prev = 0.0f32;
    let mut sep = d2_0.sqrt() - r_a;

    for _ in 0..64 {
        let step = (sep / l_bound).max(min_step);
        let t_next = (t_prev + step).min(1.0);
        let (d2, s, ps, pb, n) = eval(t_next);
        if d2 <= r_sq {
            let mut lo = t_prev;
            let mut hi = t_next;
            let mut best = (hi, d2, s, ps, pb, n);
            for _ in 0..6 {
                let mid = 0.5 * (lo + hi);
                let (md2, ms, mps, mpb, mn) = eval(mid);
                if md2 <= r_sq {
                    hi = mid;
                    best = (mid, md2, ms, mps, mpb, mn);
                } else {
                    lo = mid;
                }
            }
            return Some(build_hit(best.0, best.1, best.2, best.3, best.4, best.5));
        }
        if t_next >= 1.0 {
            return None;
        }
        t_prev = t_next;
        sep = d2.sqrt() - r_a;
        if sep > l_bound * (1.0 - t_prev) {
            return None;
        }
    }

    let (d2_1, s1, ps1, pb1, n1) = eval(1.0);
    if d2_1 <= r_sq {
        return Some(build_hit(1.0, d2_1, s1, ps1, pb1, n1));
    }
    None
}

// ── Material Helpers ─────────────────────────────────────────────────────────

#[inline]
fn is_penetrable(mat: u8, target_kind: TargetKind) -> bool {
    target_kind == TargetKind::Ragdoll
        || matches!(mat, WOOD | PLASTER | EARTH | SAND | GRASS | LEAVES)
}

#[inline]
fn stab_speed_threshold(mat: u8, target_kind: TargetKind) -> f32 {
    if target_kind == TargetKind::Ragdoll {
        return 14.0;
    }
    match mat {
        LEAVES => 12.0,
        EARTH | SAND | GRASS | PLASTER => 20.0,
        WOOD => 28.0,
        _ => f32::INFINITY,
    }
}

#[inline]
fn stab_friction(mat: u8, target_kind: TargetKind) -> f32 {
    if target_kind == TargetKind::Ragdoll {
        return 340.0;
    }
    match mat {
        LEAVES => 180.0,
        EARTH | SAND | GRASS => 480.0,
        PLASTER => 520.0,
        WOOD => 950.0,
        _ => 1200.0,
    }
}

#[inline]
fn slice_speed_threshold(mat: u8, target_kind: TargetKind) -> f32 {
    if target_kind == TargetKind::Ragdoll {
        return 32.0;
    }
    match mat {
        LEAVES | GRASS => 18.0,
        GLASS | PLASTER | EARTH | SAND => 38.0,
        WOOD | ROOFING => 62.0,
        _ => f32::INFINITY,
    }
}

#[inline]
fn crush_metric(v_in: f32, weapon_mass: f32) -> f32 {
    v_in * (weapon_mass / 1.5).max(0.25).sqrt()
}

// ── Reusable Zero-Alloc Scratch Buffers ──────────────────────────────────────

struct VisitedCells {
    keys: [[i32; 3]; VISITED_CAP],
    gen_slots: [u32; VISITED_CAP],
    overflow: Vec<[i32; 3]>,
    gen_id: u32,
}

impl VisitedCells {
    fn new() -> Self {
        Self {
            keys: [[0; 3]; VISITED_CAP],
            gen_slots: [0; VISITED_CAP],
            overflow: Vec::new(),
            gen_id: 1,
        }
    }

    #[inline]
    fn begin(&mut self) {
        self.gen_id = self.gen_id.wrapping_add(1);
        if self.gen_id == 0 {
            self.gen_slots.fill(0);
            self.gen_id = 1;
        }
        self.overflow.clear();
    }

    /// Inserts `cell` into the current substep visited set; returns `true` if newly seen.
    #[inline]
    fn mark(&mut self, cell: [i32; 3]) -> bool {
        let mut h = (cell[0] as u32).wrapping_mul(73_856_093)
            ^ (cell[1] as u32).wrapping_mul(19_349_663)
            ^ (cell[2] as u32).wrapping_mul(83_492_791);
        h ^= h >> 13;
        let start = (h as usize) & VISITED_MASK;
        let g = self.gen_id;
        for probe in 0..16 {
            let idx = (start + probe) & VISITED_MASK;
            if self.gen_slots[idx] != g {
                self.gen_slots[idx] = g;
                self.keys[idx] = cell;
                return true;
            }
            if self.keys[idx] == cell {
                return false;
            }
        }
        if self.overflow.contains(&cell) {
            return false;
        }
        self.overflow.push(cell);
        true
    }
}

struct MeleeScratch {
    visited: VisitedCells,
    swept_aabbs: Vec<(V, V)>,
    swept_caps: Vec<(V, V, V, V, f32, f32)>,
    target_prev: Vec<V>,
    target_aabbs: Vec<(V, V)>,
    carved_cells: Vec<([i32; 3], Kind)>,
    heat_cells: Vec<([i32; 3], u8)>,
    ignite_cells: Vec<[i32; 3]>,
}

impl MeleeScratch {
    fn new() -> Self {
        Self {
            visited: VisitedCells::new(),
            swept_aabbs: Vec::new(),
            swept_caps: Vec::new(),
            target_prev: Vec::new(),
            target_aabbs: Vec::new(),
            carved_cells: Vec::new(),
            heat_cells: Vec::new(),
            ignite_cells: Vec::new(),
        }
    }
}

/// Visits unique SOLID integer voxel cells (`kind_at(cell) != 0`) intersected by the swept blade
/// quad `[a0_p, a1_p] -> [a0_c, a1_c]` expanded by `radius`, invoking `visit(cell, kind, t_slice)`.
///
/// Uses branchless uniform sub-cell stepping (`<= 0.78` cells along the blade, `<= 0.80` cells
/// across sweep slices) so open-air queries execute in ~1-2 ns per step with zero allocations.
/// When `full_kerf` is true (active plasma lightsaber), any solid hit also expands to adjacent
/// cells within `radius` to produce a continuous 1–2 cell kerf.
#[inline]
#[allow(clippy::too_many_arguments)]
fn for_each_swept_solid_voxel<F>(
    visited: &mut VisitedCells,
    a0_p: V,
    a1_p: V,
    a0_c: V,
    a1_c: V,
    radius: f32,
    full_kerf: bool,
    kind_at: &mut F,
    mut visit: impl FnMut([i32; 3], Kind, f32),
) where
    F: FnMut([i32; 3]) -> Kind,
{
    let mut began = false;
    let d0 = sub(a0_c, a0_p);
    let d1 = sub(a1_c, a1_p);
    let d_sweep_sq = len_sq(d0).max(len_sq(d1));

    let mut emit_solid = |cell: [i32; 3], k: Kind, t: f32| {
        if !began {
            visited.begin();
            began = true;
        }
        if visited.mark(cell) {
            visit(cell, k, t);
        }
    };

    // Thin blades (Knife, Longsword, BattleAxe, Lightsaber): branchless leading-edge stepping.
    if radius <= 0.55 {
        let step_max = if full_kerf { 0.55 } else { 0.80 };
        let nt = if d_sweep_sq <= step_max * step_max {
            1usize
        } else {
            (d_sweep_sq.sqrt() / step_max).ceil().clamp(1.0, 20.0) as usize
        };
        let sweep_mid = add(d0, d1);
        let lead = if len_sq(sweep_mid) > 1e-10 {
            scale(unit_or(sweep_mid, [0.0, 0.0, 0.0]), radius * 0.85)
        } else {
            [0.0; 3]
        };
        let margin = radius.min(0.49);
        for slice in 1..=nt {
            let (t, p0, p1) = if nt == 1 {
                (1.0, add(a0_c, lead), add(a1_c, lead))
            } else {
                let t = slice as f32 / nt as f32;
                (t, add(lerp3(a0_p, a0_c, t), lead), add(lerp3(a1_p, a1_c, t), lead))
            };
            if full_kerf {
                sample_segment_branchless(p0, p1, 0.85, |pt, cell| {
                    let k = kind_at(cell);
                    if k != 0 {
                        emit_solid(cell, k, t);
                        let fx = pt[0] - cell[0] as f32;
                        let fy = pt[1] - cell[1] as f32;
                        let fz = pt[2] - cell[2] as f32;
                        if fx < margin {
                            let nb = [cell[0] - 1, cell[1], cell[2]];
                            let nk = kind_at(nb);
                            if nk != 0 {
                                emit_solid(nb, nk, t);
                            }
                        } else if fx > 1.0 - margin {
                            let nb = [cell[0] + 1, cell[1], cell[2]];
                            let nk = kind_at(nb);
                            if nk != 0 {
                                emit_solid(nb, nk, t);
                            }
                        }
                        if fy < margin {
                            let nb = [cell[0], cell[1] - 1, cell[2]];
                            let nk = kind_at(nb);
                            if nk != 0 {
                                emit_solid(nb, nk, t);
                            }
                        } else if fy > 1.0 - margin {
                            let nb = [cell[0], cell[1] + 1, cell[2]];
                            let nk = kind_at(nb);
                            if nk != 0 {
                                emit_solid(nb, nk, t);
                            }
                        }
                        if fz < margin {
                            let nb = [cell[0], cell[1], cell[2] - 1];
                            let nk = kind_at(nb);
                            if nk != 0 {
                                emit_solid(nb, nk, t);
                            }
                        } else if fz > 1.0 - margin {
                            let nb = [cell[0], cell[1], cell[2] + 1];
                            let nk = kind_at(nb);
                            if nk != 0 {
                                emit_solid(nb, nk, t);
                            }
                        }
                    }
                });
            } else {
                sample_segment_branchless(p0, p1, 0.96, |_, cell| {
                    let k = kind_at(cell);
                    if k != 0 {
                        emit_solid(cell, k, t);
                    }
                });
            }
        }
        return;
    }

    // Thick blunt / shield capsules (Fist, Sledgehammer, Shield): compact leading-hemisphere +
    // centerline rib bundle covering outer reach without scanning hundreds of interior cells.
    let step_max = radius.max(0.95);
    let nt = if d_sweep_sq <= step_max * step_max {
        1usize
    } else {
        (d_sweep_sq.sqrt() / step_max).ceil().clamp(1.0, 10.0) as usize
    };
    let sweep_mid = add(d0, d1);
    let has_sweep = len_sq(sweep_mid) > 1e-8;
    for slice in 1..=nt {
        let (t, p0, p1) = if nt == 1 {
            (1.0, a0_c, a1_c)
        } else {
            let t = slice as f32 / nt as f32;
            (t, lerp3(a0_p, a0_c, t), lerp3(a1_p, a1_c, t))
        };
        let seg = sub(p1, p0);
        let axis = unit_or(seg, [0.0, 1.0, 0.0]);
        let cap0 = sub(p0, scale(axis, radius));
        let cap1 = add(p1, scale(axis, radius));
        sample_segment_branchless(cap0, cap1, 0.98, |_, cell| {
            let k = kind_at(cell);
            if k != 0 {
                emit_solid(cell, k, t);
            }
        });

        let u = if has_sweep {
            let perp = sub(sweep_mid, scale(axis, dot(sweep_mid, axis)));
            if len_sq(perp) > 1e-8 {
                unit_or(perp, [1.0, 0.0, 0.0])
            } else {
                let ref_v = if axis[1].abs() < 0.9 { [0.0, 1.0, 0.0] } else { [1.0, 0.0, 0.0] };
                unit_or(cross(axis, ref_v), [1.0, 0.0, 0.0])
            }
        } else {
            let ref_v = if axis[1].abs() < 0.9 { [0.0, 1.0, 0.0] } else { [1.0, 0.0, 0.0] };
            unit_or(cross(axis, ref_v), [1.0, 0.0, 0.0])
        };
        let ur = scale(u, radius);
        sample_segment_branchless(add(p0, ur), add(p1, ur), 0.98, |_, cell| {
            let k = kind_at(cell);
            if k != 0 {
                emit_solid(cell, k, t);
            }
        });
        if !has_sweep {
            let vr = scale(cross(axis, u), radius);
            for (r0, r1) in [
                (sub(p0, ur), sub(p1, ur)),
                (add(p0, vr), add(p1, vr)),
                (sub(p0, vr), sub(p1, vr)),
            ] {
                sample_segment_branchless(r0, r1, 0.98, |_, cell| {
                    let k = kind_at(cell);
                    if k != 0 {
                        emit_solid(cell, k, t);
                    }
                });
            }
        }
    }
}

/// Branchless uniform sub-cell stepper along `[p0, p1]` (`<= max_step` per sample).
#[inline]
fn sample_segment_branchless(
    p0: V,
    p1: V,
    max_step: f32,
    mut emit: impl FnMut(V, [i32; 3]),
) {
    let d = sub(p1, p0);
    let max_comp = d[0].abs().max(d[1].abs()).max(d[2].abs());
    let steps = (max_comp / max_step).ceil() as usize;
    if steps == 0 {
        emit(
            p0,
            [p0[0].floor() as i32, p0[1].floor() as i32, p0[2].floor() as i32],
        );
        return;
    }
    let inv = (steps as f32).recip();
    let step = scale(d, inv);
    let mut pt = p0;
    for _ in 0..=steps {
        let cell = [
            pt[0].floor() as i32,
            pt[1].floor() as i32,
            pt[2].floor() as i32,
        ];
        emit(pt, cell);
        pt[0] += step[0];
        pt[1] += step[1];
        pt[2] += step[2];
    }
}

// ── Melee Simulation World ───────────────────────────────────────────────────

/// Top-level simulation arena coordinating weapons, 240 Hz swept CCD, stab bindings,
/// cooling plasma glows, and combat events.
pub struct MeleeWorld {
    pub weapons: Vec<WeaponBody>,
    pub cooling_glow: CoolingGlowMap,
    pub events: Vec<MeleeEvent>,
    pub config: MeleeConfig,
    substep_counter: u32,
    /// Short per-`(weapon_id, target_id)` cooldown preventing duplicate slice emissions in one swing.
    slice_cooldowns: Vec<((u32, u32), f32)>,
    scratch: MeleeScratch,
}

impl Default for MeleeWorld {
    fn default() -> Self {
        Self::new()
    }
}

impl MeleeWorld {
    pub fn new() -> Self {
        Self::with_config(MeleeConfig::default())
    }

    pub fn with_config(config: MeleeConfig) -> Self {
        Self {
            weapons: Vec::new(),
            cooling_glow: CoolingGlowMap::new(),
            events: Vec::new(),
            config,
            substep_counter: 0,
            slice_cooldowns: Vec::new(),
            scratch: MeleeScratch::new(),
        }
    }

    /// Adds a weapon to the world and returns its index.
    pub fn add_weapon(&mut self, weapon: WeaponBody) -> usize {
        self.weapons.push(weapon);
        self.weapons.len() - 1
    }

    /// Looks up a weapon by its stable `id`.
    #[inline]
    pub fn weapon(&self, id: u32) -> Option<&WeaponBody> {
        self.weapons.iter().find(|w| w.id == id)
    }

    /// Looks up a mutable weapon by its stable `id`.
    #[inline]
    pub fn weapon_mut(&mut self, id: u32) -> Option<&mut WeaponBody> {
        self.weapons.iter_mut().find(|w| w.id == id)
    }

    /// Advances the combat simulation by `dt` seconds.
    ///
    /// At the standard `TICK_DT` (`1/120 s`), this executes `config.substeps_per_tick` (`2`)
    /// substeps at `240 Hz` (`dt_sub = 1/240 s`). Clears `self.events` before stepping and
    /// returns all events generated during this tick.
    pub fn step<F>(
        &mut self,
        dt: f32,
        targets: &mut [MeleeTarget],
        mut kind_at: F,
    ) -> &[MeleeEvent]
    where
        F: FnMut([i32; 3]) -> Kind,
    {
        self.events.clear();
        if dt <= 0.0 {
            return &self.events;
        }
        let target_substeps = ((dt / SUBSTEP_DT).round() as usize)
            .max(self.config.substeps_per_tick.max(1));
        let dt_sub = dt / target_substeps as f32;
        for _ in 0..target_substeps {
            self.step_substep(dt_sub, targets, &mut kind_at);
        }
        &self.events
    }

    /// Runs a single 240 Hz substep, appending events to `self.events`.
    pub fn step_substep<F>(
        &mut self,
        dt_sub: f32,
        targets: &mut [MeleeTarget],
        kind_at: &mut F,
    ) where
        F: FnMut([i32; 3]) -> Kind,
    {
        self.substep_counter = self.substep_counter.wrapping_add(1);

        // Decay slice deduplication cooldowns.
        self.slice_cooldowns.retain_mut(|(_, t)| {
            *t -= dt_sub;
            *t > 0.0
        });

        // 1. Save previous poses, advance lightsaber extension, drive hand springs & stab sliders,
        //    and build swept capsule + compact AABB cache in a single cache-hot pass.
        let gravity = self.config.gravity;
        self.scratch.swept_aabbs.clear();
        self.scratch.swept_caps.clear();
        for w in &mut self.weapons {
            w.prev_pos = w.pos;
            w.prev_rot = w.rot;
            w.arm_recoil = HandRecoil::default();
            w.last_plasma_drag = [0.0; 3];
            if w.bind_cooldown > 0.0 {
                w.bind_cooldown = (w.bind_cooldown - dt_sub).max(0.0);
            }
            if w.spec.kind == WeaponKind::Lightsaber {
                let target_ext = if w.ignited { 1.0 } else { 0.0 };
                let delta = BLADE_EXTEND_RATE * dt_sub;
                if w.blade_extension < target_ext {
                    w.blade_extension = (w.blade_extension + delta).min(target_ext);
                } else if w.blade_extension > target_ext {
                    w.blade_extension = (w.blade_extension - delta).max(target_ext);
                }
            }

            let tip_local = w.active_tip_local();
            let (p0_p, p1_p, r) = w.capsule_at(w.prev_pos, w.prev_rot, tip_local);

            if gravity != [0.0; 3] && w.spec.inv_mass > 0.0 {
                w.vel = add(w.vel, scale(gravity, dt_sub));
            }
            if let Some(hand_target) = w.hand_target {
                let params = w.hand_params;
                drive_hand_spring(w, &hand_target, &params, dt_sub);
            }

            if w.stab_bind.is_some() {
                if let Some(evt) = solve_stab_bind(w, targets, dt_sub) {
                    self.events.push(evt);
                }
            } else {
                w.pos = add(w.pos, scale(w.vel, dt_sub));
                w.rot = q_integrate(w.rot, w.spin, dt_sub);
            }

            let (p0_c, p1_c, _) = w.capsule_at(w.pos, w.rot, tip_local);
            let (lo, hi) = quad_swept_aabb(p0_p, p1_p, p0_c, p1_c, r);
            let emit_frac = w.emitter_fraction(tip_local);
            self.scratch.swept_aabbs.push((lo, hi));
            self.scratch
                .swept_caps
                .push((p0_p, p1_p, p0_c, p1_c, r, emit_frac));
        }

        // 2. Advance dynamic targets and cache swept AABBs.
        self.scratch.target_prev.clear();
        self.scratch.target_aabbs.clear();
        for t in targets.iter_mut() {
            let prev = t.pos;
            self.scratch.target_prev.push(prev);
            if t.mass > 0.0 {
                t.pos = add(t.pos, scale(t.vel, dt_sub));
            }
            self.scratch.target_aabbs.push(t.swept_aabb(prev, t.pos));
        }

        // 4. CCD Phase 1: Weapon-vs-Weapon (Steel-on-Steel Parrying & Lightsaber Plasma Clashes).
        let n_weapons = self.weapons.len();
        for i in 0..n_weapons {
            let (a_lo, a_hi) = self.scratch.swept_aabbs[i];
            for j in (i + 1)..n_weapons {
                let (b_lo, b_hi) = self.scratch.swept_aabbs[j];
                if !aabb_overlap(a_lo, a_hi, b_lo, b_hi) {
                    continue;
                }
                if let (Some(wa), Some(wb)) = (self.weapons[i].wielder_id, self.weapons[j].wielder_id)
                    && wa == wb
                {
                    continue;
                }
                let (a0_p, a1_p, a0_c, a1_c, r_a, ef_a) = self.scratch.swept_caps[i];
                let (b0_p, b1_p, b0_c, b1_c, r_b, ef_b) = self.scratch.swept_caps[j];
                let Some(hit) = swept_capsule_capsule_toi(
                    a0_p, a1_p, a0_c, a1_c, r_a, b0_p, b1_p, b0_c, b1_c, r_b,
                ) else {
                    continue;
                };

                let (left, right) = self.weapons.split_at_mut(j);
                let wa = &mut left[i];
                let wb = &mut right[0];
                let plasma_a = wa.is_plasma_active() && hit.s_a >= ef_a * 0.9;
                let plasma_b = wb.is_plasma_active() && hit.s_b >= ef_b * 0.9;

                if plasma_a && plasma_b {
                    if let Some(evt) =
                        resolve_plasma_clash(wa, wb, &hit, dt_sub, self.substep_counter)
                    {
                        self.events.push(evt);
                    }
                } else if wa.spec.is_metallic_parry() || wb.spec.is_metallic_parry() {
                    if let Some(evt) = resolve_weapon_parry(wa, wb, &hit, dt_sub) {
                        self.events.push(evt);
                    }
                } else {
                    resolve_blunt_weapon_pair(wa, wb, &hit, dt_sub);
                }
            }
        }

        // 5. CCD Phase 2: Weapon-vs-Dynamic `MeleeTarget`.
        for i in 0..n_weapons {
            if self.weapons[i].stab_bind.is_some() {
                continue;
            }
            let (a_lo, a_hi) = self.scratch.swept_aabbs[i];
            for k in 0..targets.len() {
                let (t_lo, t_hi) = self.scratch.target_aabbs[k];
                if !aabb_overlap(a_lo, a_hi, t_lo, t_hi) {
                    continue;
                }
                let (a0_p, a1_p, a0_c, a1_c, r_a, ef_a) = self.scratch.swept_caps[i];
                let prev_t_pos = self.scratch.target_prev[k];
                let curr_t_pos = targets[k].pos;
                let hit = match targets[k].kind {
                    TargetKind::Capsule | TargetKind::Ragdoll => {
                        let (b0_p, b1_p) = targets[k].capsule_endpoints_at(prev_t_pos);
                        let (b0_c, b1_c) = targets[k].capsule_endpoints_at(curr_t_pos);
                        swept_capsule_capsule_toi(
                            a0_p,
                            a1_p,
                            a0_c,
                            a1_c,
                            r_a,
                            b0_p,
                            b1_p,
                            b0_c,
                            b1_c,
                            targets[k].radius,
                        )
                    }
                    TargetKind::Aabb => swept_capsule_aabb_toi(
                        a0_p,
                        a1_p,
                        a0_c,
                        a1_c,
                        r_a,
                        prev_t_pos,
                        curr_t_pos,
                        targets[k].aabb_half_extents(),
                    ),
                };
                if let Some(hit) = hit {
                    let w_id = self.weapons[i].id;
                    let t_id = targets[k].id;
                    let can_slice = !self.slice_cooldowns.iter().any(|&(p, _)| p == (w_id, t_id));
                    let drag_scale = self.config.plasma_drag_scale;
                    let (emitted_slice, evts) = resolve_weapon_vs_target(
                        &mut self.weapons[i],
                        &mut targets[k],
                        &hit,
                        ef_a,
                        dt_sub,
                        drag_scale,
                        can_slice,
                    );
                    if emitted_slice {
                        self.slice_cooldowns.push(((w_id, t_id), 0.06));
                    }
                    for e in evts.into_iter().flatten() {
                        self.events.push(e);
                    }
                    if self.weapons[i].stab_bind.is_some() {
                        break;
                    }
                }
            }
        }

        // 6. CCD Phase 3: Weapon-vs-Voxel World (`kind_at`).
        let drag_scale = self.config.plasma_drag_scale;
        for i in 0..n_weapons {
            if self.weapons[i].stab_bind.is_some() {
                continue;
            }
            let (a0_p, a1_p, a0_c, a1_c, r_a, ef_a) = self.scratch.swept_caps[i];
            if self.weapons[i].is_plasma_active() {
                // Sweep only the active plasma emitter -> tip segment (already interpolated along capsule).
                let e0_p = lerp3(a0_p, a1_p, ef_a);
                let e0_c = lerp3(a0_c, a1_c, ef_a);
                resolve_lightsaber_voxels(
                    &mut self.weapons[i],
                    e0_p,
                    a1_p,
                    e0_c,
                    a1_c,
                    r_a,
                    dt_sub,
                    drag_scale,
                    &mut self.scratch,
                    &mut self.cooling_glow,
                    &mut self.events,
                    kind_at,
                );
            } else {
                resolve_solid_weapon_voxels(
                    &mut self.weapons[i],
                    a0_p,
                    a1_p,
                    a0_c,
                    a1_c,
                    r_a,
                    &mut self.scratch,
                    &mut self.events,
                    kind_at,
                );
            }
        }

        // 7. Cool incandescent lightsaber cut glow cells.
        self.cooling_glow
            .tick_with_duration(dt_sub, self.config.cooling_duration);
    }
}

// ── 1-DOF Prismatic Slider Binding (`StabBind`) ──────────────────────────────

fn solve_stab_bind(
    weapon: &mut WeaponBody,
    targets: &mut [MeleeTarget],
    dt_sub: f32,
) -> Option<MeleeEvent> {
    let mut bind = weapon.stab_bind?;
    let mut target_vel = [0.0f32; 3];
    let mut target_idx = None;
    if let Some(tid) = bind.target_id
        && let Some(idx) = targets.iter().position(|t| t.id == tid)
    {
        target_vel = targets[idx].vel;
        if targets[idx].mass > 0.0 {
            bind.entry_pos = add(bind.entry_pos, scale(target_vel, dt_sub));
        }
        target_idx = Some(idx);
    }

    // Lock weapon orientation in the cut channel and report blocked rotational twist as arm recoil.
    let blocked_spin = weapon.spin;
    weapon.rot = bind.locked_rot;
    weapon.spin = [0.0; 3];
    if len_sq(blocked_spin) > 1e-8 && dt_sub > 0.0 {
        let blocked_tau = [
            -blocked_spin[0] * weapon.spec.inertia_local[0] / dt_sub,
            -blocked_spin[1] * weapon.spec.inertia_local[1] / dt_sub,
            -blocked_spin[2] * weapon.spec.inertia_local[2] / dt_sub,
        ];
        weapon.arm_recoil.torque = add(weapon.arm_recoil.torque, quat_turn(weapon.rot, blocked_tau));
    }

    // Decompose relative velocity into axial (along slider) and lateral (locked by material).
    let v_rel = sub(weapon.vel, target_vel);
    let mut v_axial = dot(v_rel, bind.axis);
    let v_lat = sub(v_rel, scale(bind.axis, v_axial));

    // Cancel lateral velocity completely (material slot locks sideways motion).
    if len_sq(v_lat) > 1e-10 {
        let j_lat = scale(v_lat, -weapon.spec.mass);
        weapon.arm_recoil.shock_impulse = add(weapon.arm_recoil.shock_impulse, j_lat);
        if dt_sub > 0.0 {
            weapon.arm_recoil.force = add(weapon.arm_recoil.force, scale(j_lat, dt_sub.recip()));
        }
        if let Some(idx) = target_idx {
            let inv_mt = targets[idx].inv_mass();
            if inv_mt > 0.0 {
                targets[idx].vel = add(targets[idx].vel, scale(j_lat, -inv_mt));
            }
        }
    }

    // Apply Coulomb + viscous sliding friction opposing axial motion.
    let dv_fric = bind.friction * weapon.spec.inv_mass * dt_sub;
    if v_axial.abs() <= dv_fric {
        v_axial = 0.0;
    } else {
        v_axial -= v_axial.signum() * dv_fric;
        // Mild viscous channel grip damping for smooth pull-out.
        let visc = 1.0 + 12.0 * weapon.spec.inv_mass * dt_sub;
        v_axial /= visc;
    }

    bind.depth += v_axial * dt_sub;
    if bind.depth > bind.max_depth {
        bind.depth = bind.max_depth;
        if v_axial > 0.0 {
            v_axial = 0.0;
        }
    }

    let tip_offset = quat_turn(bind.locked_rot, weapon.active_tip_local());

    if bind.depth <= 0.0 {
        // Clean release just outside the entry surface, preserving backward extraction velocity.
        weapon.pos = sub(sub(bind.entry_pos, scale(bind.axis, 0.05)), tip_offset);
        weapon.vel = add(target_vel, scale(bind.axis, v_axial.min(0.0)));
        weapon.stab_bind = None;
        weapon.bind_cooldown = 0.08;
        return Some(MeleeEvent::StabReleased {
            weapon_id: weapon.id,
            target_id: bind.target_id,
        });
    }

    weapon.pos = sub(add(bind.entry_pos, scale(bind.axis, bind.depth)), tip_offset);
    weapon.vel = add(target_vel, scale(bind.axis, v_axial));
    weapon.stab_bind = Some(bind);
    None
}

// ── Contact Resolvers ────────────────────────────────────────────────────────

/// Rewinds a weapon pair to their continuous time-of-impact pose `hit.t` so fast colliding
/// blades (or blades continuously pushed together from `t = 0`) never step through each other
/// before contact resolution. Skips rewinding when already separating from `t = 0`.
#[inline]
fn rewind_pair_to_toi(
    wa: &mut WeaponBody,
    wb: &mut WeaponBody,
    hit_t: f32,
    approaching: bool,
) -> f32 {
    if hit_t < 1.0 && (hit_t > 0.0 || approaching) {
        wa.pos = lerp3(wa.prev_pos, wa.pos, hit_t);
        wa.rot = q_nlerp(wa.prev_rot, wa.rot, hit_t);
        wb.pos = lerp3(wb.prev_pos, wb.pos, hit_t);
        wb.rot = q_nlerp(wb.prev_rot, wb.rot, hit_t);
        1.0 - hit_t
    } else {
        0.0
    }
}

/// Steel-on-steel blade or shield parry clash with reciprocal 6-DOF impulses and recoil.
#[inline]
fn resolve_weapon_parry(
    wa: &mut WeaponBody,
    wb: &mut WeaponBody,
    hit: &SweepHit,
    dt_sub: f32,
) -> Option<MeleeEvent> {
    let n = hit.normal; // points from B toward A
    let v_rel_pre = sub(wa.point_velocity(hit.pos), wb.point_velocity(hit.pos));
    let approaching = dot(v_rel_pre, n) < 0.0 || dot(sub(wa.vel, wb.vel), n) < 0.0;
    let rem_frac = rewind_pair_to_toi(wa, wb, hit.t, approaching);
    let v_a = wa.point_velocity(hit.pos);
    let v_b = wb.point_velocity(hit.pos);
    let v_rel = sub(v_a, v_b);
    let v_n = dot(v_rel, n);

    // Positional separation proportional to inverse masses.
    let pen = hit.penetration.max(if rem_frac > 0.0 { 0.01 } else { 0.0 });
    if pen > 1e-4 {
        let sum_inv = wa.spec.inv_mass + wb.spec.inv_mass;
        if sum_inv > 1e-8 {
            let corr = pen * 0.95 / sum_inv;
            wa.pos = add(wa.pos, scale(n, corr * wa.spec.inv_mass));
            wb.pos = sub(wb.pos, scale(n, corr * wb.spec.inv_mass));
        }
    }

    if v_n >= 0.0 {
        return None;
    }

    let ma = q_to_mat3(wa.rot);
    let mb = q_to_mat3(wb.rot);
    let inv_eff = wa.inv_mass_along_mat(&ma, hit.pos, n) + wb.inv_mass_along_mat(&mb, hit.pos, n);
    if inv_eff <= 1e-8 {
        return None;
    }

    // Shields absorb more energy (higher parry stability) and deflect sharply.
    let e = 0.5 * (wa.spec.restitution + wb.spec.restitution);
    let j_n = -(1.0 + e) * v_n / inv_eff;

    // Steel-on-steel Coulomb sliding friction.
    let v_tan = sub(v_rel, scale(n, v_n));
    let v_tan_mag = len(v_tan);
    let j_vec = if v_tan_mag > 1e-4 {
        let t_dir = scale(v_tan, v_tan_mag.recip());
        let inv_eff_t =
            wa.inv_mass_along_mat(&ma, hit.pos, t_dir) + wb.inv_mass_along_mat(&mb, hit.pos, t_dir);
        let j_t = (v_tan_mag / inv_eff_t.max(1e-6)).min(0.28 * j_n);
        sub(scale(n, j_n), scale(t_dir, j_t))
    } else {
        scale(n, j_n)
    };

    // Stability scaling: higher parry_stability dampens recoil impulse on shields.
    let scale_a = (wb.spec.parry_stability / wa.spec.parry_stability).clamp(0.55, 1.35);
    let scale_b = (wa.spec.parry_stability / wb.spec.parry_stability).clamp(0.55, 1.35);
    wa.apply_impulse_at_mat(&ma, scale(j_vec, scale_a), hit.pos);
    wb.apply_impulse_at_mat(&mb, scale(j_vec, -scale_b), hit.pos);

    // Advance remaining substep fraction with post-clash deflected velocities.
    if rem_frac > 0.0 {
        let dt_rem = rem_frac * dt_sub;
        wa.pos = add(wa.pos, scale(wa.vel, dt_rem));
        wa.rot = q_integrate(wa.rot, wa.spin, dt_rem);
        wb.pos = add(wb.pos, scale(wb.vel, dt_rem));
        wb.rot = q_integrate(wb.rot, wb.spin, dt_rem);
    }

    let sparks = ((j_n * 0.12 + v_tan_mag * 0.18) as u32).clamp(2, 32);
    Some(MeleeEvent::ParryClash {
        pos: hit.pos,
        normal: n,
        impulse: j_n,
        spark_count: sparks,
    })
}

/// Opposing plasma lightsabers locking via high-friction magnetic repulsion + micro-jitter.
#[inline]
fn resolve_plasma_clash(
    wa: &mut WeaponBody,
    wb: &mut WeaponBody,
    hit: &SweepHit,
    dt_sub: f32,
    substep_counter: u32,
) -> Option<MeleeEvent> {
    let n = hit.normal;
    let v_rel_pre = sub(wa.point_velocity(hit.pos), wb.point_velocity(hit.pos));
    let approaching = dot(v_rel_pre, n) < 0.0 || dot(sub(wa.vel, wb.vel), n) < 0.0;
    let rem_frac = rewind_pair_to_toi(wa, wb, hit.t, approaching);
    let v_a = wa.point_velocity(hit.pos);
    let v_b = wb.point_velocity(hit.pos);
    let v_rel = sub(v_a, v_b);
    let v_n = dot(v_rel, n);

    // Magnetic containment separation prevents plasma blades passing through one another.
    let sum_inv = wa.spec.inv_mass + wb.spec.inv_mass;
    let pen = hit.penetration.max(if rem_frac > 0.0 { 0.02 } else { 0.0 });
    if pen > 1e-4 && sum_inv > 1e-8 {
        let corr = pen * 1.05 / sum_inv;
        wa.pos = add(wa.pos, scale(n, corr * wa.spec.inv_mass));
        wb.pos = sub(wb.pos, scale(n, corr * wb.spec.inv_mass));
    }

    let ma = q_to_mat3(wa.rot);
    let mb = q_to_mat3(wb.rot);
    let inv_eff = wa.inv_mass_along_mat(&ma, hit.pos, n) + wb.inv_mass_along_mat(&mb, hit.pos, n);
    if inv_eff <= 1e-8 {
        return None;
    }

    // Low restitution + strong magnetic containment repulsion along normal.
    let magnetic_push = (pen * 68.0).min(36.0);
    let j_n = if v_n < 0.0 {
        (-(1.0 + 0.14) * v_n + magnetic_push) / inv_eff
    } else {
        magnetic_push / inv_eff
    };

    // High-friction plasma lock (mu = 1.65) strongly resists sliding past the opposing blade.
    let v_tan = sub(v_rel, scale(n, v_n));
    let v_tan_mag = len(v_tan);
    let j_fric = if v_tan_mag > 1e-4 {
        let t_dir = scale(v_tan, v_tan_mag.recip());
        let inv_eff_t =
            wa.inv_mass_along_mat(&ma, hit.pos, t_dir) + wb.inv_mass_along_mat(&mb, hit.pos, t_dir);
        let max_f = 1.65 * j_n.max(12.0 * dt_sub / inv_eff);
        let j_t = (v_tan_mag / inv_eff_t.max(1e-6)).min(max_f);
        scale(t_dir, -j_t)
    } else {
        [0.0; 3]
    };

    // Deterministic high-frequency tangential magnetic micro-jitter unpacked from a single hash
    // (projected orthogonal to `n` so sparks crackle along the lock without pulling blades through).
    let h = hash3(wa.id as i32, wb.id as i32, substep_counter as i32, 0x5A8E_C1A5);
    let unpack = |shift: u32| (((h >> shift) & 0x3FF) as f32 / 511.5) - 1.0;
    let raw_j = [unpack(0), unpack(10), unpack(20)];
    let tan_j = sub(raw_j, scale(n, dot(raw_j, n)));
    let jitter_dir = unit_or(tan_j, [0.0, 1.0, 0.0]);
    let intensity = ((j_n * 0.012) + (v_tan_mag * 0.008) + (pen * 0.65)).clamp(0.12, 2.0);
    let j_jitter = scale(jitter_dir, intensity * 0.75);

    let total_j = add(add(scale(n, j_n), j_fric), j_jitter);
    // When two plasma blades meet nearly parallel along a shared line contact, distribute the
    // normal magnetic containment impulse across the blade span (preventing single-point
    // off-center pitching that would invert the hilts into an X-crossing).
    let axis_a = mat3_mul(&ma, wa.spec.blade_axis);
    let axis_b = mat3_mul(&mb, wb.spec.blade_axis);
    let parallel_lock = dot(axis_a, axis_b).abs() > 0.85;
    if parallel_lock {
        let r_a = sub(hit.pos, wa.pos);
        let r_b = sub(hit.pos, wb.pos);
        let apply_point_a = add(wa.pos, scale(r_a, 0.25));
        let apply_point_b = add(wb.pos, scale(r_b, 0.25));
        wa.apply_impulse_at_mat(&ma, total_j, apply_point_a);
        wb.apply_impulse_at_mat(&mb, scale(total_j, -1.0), apply_point_b);
        // Line contact also damps pitching spin along cross(axis, n).
        let pitch_axis = unit_or(cross(axis_a, n), [0.0, 0.0, 1.0]);
        let sp_a = dot(wa.spin, pitch_axis);
        let sp_b = dot(wb.spin, pitch_axis);
        wa.spin = sub(wa.spin, scale(pitch_axis, sp_a * 0.65));
        wb.spin = sub(wb.spin, scale(pitch_axis, sp_b * 0.65));
    } else {
        wa.apply_impulse_at_mat(&ma, total_j, hit.pos);
        wb.apply_impulse_at_mat(&mb, scale(total_j, -1.0), hit.pos);
    }

    // Magnetic blade-lock arrests linear CoM closing along the lock normal so opposing
    // hand springs cannot shear hilts through the containment boundary.
    let v_cm_n = dot(sub(wa.vel, wb.vel), n);
    if v_cm_n < 0.0 && sum_inv > 1e-8 {
        let j_cm = (-v_cm_n * 1.02) / sum_inv;
        wa.vel = add(wa.vel, scale(n, j_cm * wa.spec.inv_mass));
        wb.vel = sub(wb.vel, scale(n, j_cm * wb.spec.inv_mass));
    }

    if rem_frac > 0.0 {
        let dt_rem = rem_frac * dt_sub;
        wa.pos = add(wa.pos, scale(wa.vel, dt_rem));
        wa.rot = q_integrate(wa.rot, wa.spin, dt_rem);
        wb.pos = add(wb.pos, scale(wb.vel, dt_rem));
        wb.rot = q_integrate(wb.rot, wb.spin, dt_rem);
    }

    let hum_pitch_shift = (0.06 + 0.24 * intensity.min(1.5) + 0.002 * v_tan_mag).min(0.55);
    Some(MeleeEvent::PlasmaClash {
        pos: hit.pos,
        intensity,
        hum_pitch_shift,
    })
}

/// Non-metallic weapon-vs-weapon collision (e.g. fist vs fist).
fn resolve_blunt_weapon_pair(
    wa: &mut WeaponBody,
    wb: &mut WeaponBody,
    hit: &SweepHit,
    dt_sub: f32,
) {
    let n = hit.normal;
    let v_rel_pre = sub(wa.point_velocity(hit.pos), wb.point_velocity(hit.pos));
    let approaching = dot(v_rel_pre, n) < 0.0 || dot(sub(wa.vel, wb.vel), n) < 0.0;
    let rem_frac = rewind_pair_to_toi(wa, wb, hit.t, approaching);
    let v_rel = sub(wa.point_velocity(hit.pos), wb.point_velocity(hit.pos));
    let v_n = dot(v_rel, n);
    if v_n >= 0.0 {
        return;
    }
    let inv_eff = wa.inv_mass_along(hit.pos, n) + wb.inv_mass_along(hit.pos, n);
    if inv_eff <= 1e-8 {
        return;
    }
    let e = 0.5 * (wa.spec.restitution + wb.spec.restitution);
    let j_n = -(1.0 + e) * v_n / inv_eff;
    let j = scale(n, j_n);
    wa.apply_impulse_at(j, hit.pos);
    wb.apply_impulse_at(scale(j, -1.0), hit.pos);
    if rem_frac > 0.0 {
        let dt_rem = rem_frac * dt_sub;
        wa.pos = add(wa.pos, scale(wa.vel, dt_rem));
        wb.pos = add(wb.pos, scale(wb.vel, dt_rem));
    }
}

/// Resolves contact between an unbound weapon and a dynamic `MeleeTarget`.
/// Returns `(emitted_slice, [optional event 1, optional event 2])`.
#[allow(clippy::too_many_arguments)]
fn resolve_weapon_vs_target(
    weapon: &mut WeaponBody,
    target: &mut MeleeTarget,
    hit: &SweepHit,
    emitter_frac: f32,
    dt_sub: f32,
    plasma_drag_scale: f32,
    can_slice: bool,
) -> (bool, [Option<MeleeEvent>; 2]) {
    let n = hit.normal; // points from target toward weapon
    let v_w = weapon.point_velocity(hit.pos);
    let v_rel = sub(v_w, target.vel);
    let v_speed = len(v_rel);
    let v_n = dot(v_rel, n);
    let v_in = (-v_n).max(0.0);

    // Case 1: Active Lightsaber plasma blade cutting through a dynamic target.
    if weapon.is_plasma_active() && hit.s_a >= emitter_frac * 0.9 {
        let hardness = breaks_at(target.material);
        let c_drag = hardness * PLASMA_DRAG_PER_HARDNESS * weapon.spec.viscous_drag_scale * plasma_drag_scale * 2.5;
        let decay = (1.0 + c_drag * weapon.spec.inv_mass * dt_sub).recip();
        let vel_old = weapon.vel;
        weapon.vel = add(target.vel, scale(sub(weapon.vel, target.vel), decay));
        let drag_f = scale(sub(weapon.vel, vel_old), weapon.spec.mass / dt_sub.max(1e-6));
        weapon.last_plasma_drag = add(weapon.last_plasma_drag, drag_f);
        weapon.arm_recoil.force = sub(weapon.arm_recoil.force, drag_f);

        // Mild forward impulse transferred into dynamic target.
        let t_inv_m = target.inv_mass();
        if t_inv_m > 0.0 {
            target.vel = sub(target.vel, scale(drag_f, t_inv_m * dt_sub * 0.35));
        }

        if can_slice {
            let (_, w_blade, w_flat) = weapon.world_axes();
            let plane_normal = unit_or(cross(w_blade, v_rel), w_flat);
            let cut_energy = (0.5 * weapon.spec.mass * v_speed * v_speed + 600.0) * weapon.spec.sharpness;
            return (
                true,
                [
                    Some(MeleeEvent::SliceCut {
                        target_id: Some(target.id),
                        plane_point: hit.pos,
                        plane_normal,
                        cut_energy,
                        is_plasma: true,
                    }),
                    None,
                ],
            );
        }
        return (false, [None, None]);
    }

    // Case 2: Edged weapon against target.
    if weapon.active_class() == WeaponClass::Edged {
        // 2a. Steel target triggers steel-on-steel parry clash.
        if target.material == STEEL {
            let inv_eff = weapon.inv_mass_along(hit.pos, n) + target.inv_mass();
            if v_in > 0.0 && inv_eff > 1e-8 {
                let j_n = (1.0 + weapon.spec.restitution) * v_in / inv_eff;
                let j = scale(n, j_n);
                weapon.apply_impulse_at(j, hit.pos);
                if target.inv_mass() > 0.0 {
                    target.vel = sub(target.vel, scale(j, target.inv_mass()));
                }
                let sparks = ((j_n * 0.10) as u32).clamp(2, 28);
                return (
                    false,
                    [
                        Some(MeleeEvent::ParryClash {
                            pos: hit.pos,
                            normal: n,
                            impulse: j_n,
                            spark_count: sparks,
                        }),
                        None,
                    ],
                );
            }
            return (false, [None, None]);
        }

        let (_, w_blade, w_flat) = weapon.world_axes();

        // 2b. Penetration / Stabbing & 1-DOF Prismatic Binding.
        if weapon.bind_cooldown <= 0.0
            && weapon.spec.pierce_factor > 0.0
            && hit.s_a >= 0.40
            && is_penetrable(target.material, target.kind)
            && v_speed > 1e-3
        {
            let align = dot(scale(v_rel, v_speed.recip()), w_blade);
            if align > STAB_ALIGNMENT_THRESHOLD
                && v_speed * weapon.spec.pierce_factor >= stab_speed_threshold(target.material, target.kind)
            {
                let friction = stab_friction(target.material, target.kind);
                let v_ax = dot(v_rel, w_blade).max(0.0);
                let ke = 0.5 * weapon.spec.mass * v_ax * v_ax;
                let depth = (ke / friction.max(1.0)).clamp(0.4, weapon.spec.max_bind_depth * 0.7);
                let bind = StabBind {
                    target_id: Some(target.id),
                    entry_pos: hit.pos,
                    axis: w_blade,
                    depth,
                    max_depth: weapon.spec.max_bind_depth,
                    friction,
                    locked_rot: weapon.rot,
                    material: target.material,
                };
                // Transfer initial thrust momentum into dynamic target.
                let t_inv_m = target.inv_mass();
                if t_inv_m > 0.0 {
                    let j_stab = weapon.spec.mass * v_ax * 0.45;
                    target.vel = add(target.vel, scale(w_blade, j_stab * t_inv_m));
                }
                let tip_offset = quat_turn(weapon.rot, weapon.active_tip_local());
                weapon.pos = sub(add(bind.entry_pos, scale(bind.axis, bind.depth)), tip_offset);
                weapon.vel = add(target.vel, scale(bind.axis, v_ax * 0.25));
                weapon.spin = [0.0; 3];
                weapon.stab_bind = Some(bind);
                return (
                    false,
                    [
                        Some(MeleeEvent::StabEntered {
                            weapon_id: weapon.id,
                            target_id: Some(target.id),
                            entry_pos: bind.entry_pos,
                            axis: bind.axis,
                            depth: bind.depth,
                        }),
                        None,
                    ],
                );
            }
        }

        // 2c. Edged Sever / Slice: decompose v_rel into (v_chop, v_draw, v_slap).
        let ev = weapon.decompose_velocity(v_rel);
        let v_chop_eff = if weapon.spec.double_edged {
            ev.v_chop.abs()
        } else {
            ev.v_chop.max(0.0)
        };
        let v_draw_eff = ev.v_draw.abs();
        let v_slap_eff = ev.v_slap.abs();
        let v_cut = v_chop_eff + 0.5 * v_draw_eff;

        if can_slice
            && v_chop_eff > v_slap_eff * 0.75
            && v_chop_eff > 1.0
            && v_cut * weapon.spec.sharpness >= slice_speed_threshold(target.material, target.kind)
        {
            let cut_energy = 0.5 * weapon.spec.mass * v_cut * v_cut * weapon.spec.sharpness;
            // Apply partial cutting resistance (follows through instead of full rigid bounce).
            let inv_eff = weapon.inv_mass_along(hit.pos, n) + target.inv_mass();
            if v_in > 0.0 && inv_eff > 1e-8 {
                let j_res = (0.30 * v_in) / inv_eff;
                let j = scale(n, j_res);
                weapon.apply_impulse_at(j, hit.pos);
                if target.inv_mass() > 0.0 {
                    target.vel = sub(target.vel, scale(j, target.inv_mass()));
                }
            }
            return (
                true,
                [
                    Some(MeleeEvent::SliceCut {
                        target_id: Some(target.id),
                        plane_point: hit.pos,
                        plane_normal: w_flat,
                        cut_energy,
                        is_plasma: false,
                    }),
                    None,
                ],
            );
        }
    }

    // Case 3: Fist / Blunt / Shield / flat slap / non-severing edged hit -> rigid impulse + shock.
    if hit.penetration > 1e-4 {
        let sum_inv = weapon.spec.inv_mass + target.inv_mass();
        if sum_inv > 1e-8 {
            let corr = hit.penetration * 0.8 / sum_inv;
            weapon.pos = add(weapon.pos, scale(n, corr * weapon.spec.inv_mass));
            if target.inv_mass() > 0.0 {
                target.pos = sub(target.pos, scale(n, corr * target.inv_mass()));
            }
        }
    }

    if v_in <= 0.0 {
        return (false, [None, None]);
    }
    let inv_eff = weapon.inv_mass_along(hit.pos, n) + target.inv_mass();
    if inv_eff <= 1e-8 {
        return (false, [None, None]);
    }
    let j_n = (1.0 + weapon.spec.restitution) * v_in / inv_eff;
    let j = scale(n, j_n);
    weapon.apply_impulse_at(j, hit.pos);
    if target.inv_mass() > 0.0 {
        target.vel = sub(target.vel, scale(j, target.inv_mass()));
    }
    let shock_scale = if weapon.spec.kind == WeaponKind::Sledgehammer {
        1.45
    } else {
        1.0
    };
    (
        false,
        [
            Some(MeleeEvent::BluntImpact {
                weapon_id: weapon.id,
                target_id: Some(target.id),
                pos: hit.pos,
                normal: n,
                impulse: j_n,
                shock_impulse: j_n * shock_scale,
            }),
            None,
        ],
    )
}

/// Resolves continuous plasma kerf carving, viscous material-hardness drag, incandescent glow,
/// and flammable neighbor ignition for an active lightsaber sweeping through voxels.
#[inline]
#[allow(clippy::too_many_arguments)]
fn resolve_lightsaber_voxels<F>(
    weapon: &mut WeaponBody,
    e0_p: V,
    e1_p: V,
    e0_c: V,
    e1_c: V,
    radius: f32,
    dt_sub: f32,
    plasma_drag_scale: f32,
    scratch: &mut MeleeScratch,
    cooling_glow: &mut CoolingGlowMap,
    events: &mut Vec<MeleeEvent>,
    kind_at: &mut F,
) where
    F: FnMut([i32; 3]) -> Kind,
{
    scratch.carved_cells.clear();
    scratch.heat_cells.clear();
    scratch.ignite_cells.clear();

    for_each_swept_solid_voxel(
        &mut scratch.visited,
        e0_p,
        e1_p,
        e0_c,
        e1_c,
        radius,
        true,
        kind_at,
        |cell, k, _t| {
            scratch.carved_cells.push((cell, k));
        },
    );

    if scratch.carved_cells.is_empty() {
        return;
    }

    let mut sum_hardness = 0.0f32;
    let mut centroid = [0.0f32; 3];
    for &(cell, k) in &scratch.carved_cells {
        let mat = material(k);
        sum_hardness += breaks_at(mat);
        centroid[0] += cell[0] as f32 + 0.5;
        centroid[1] += cell[1] as f32 + 0.5;
        centroid[2] += cell[2] as f32 + 0.5;
    }
    let inv_n = (scratch.carved_cells.len() as f32).recip();
    centroid = scale(centroid, inv_n);

    // Implicit viscous damping drag proportional to material hardness (`kinds::breaks_at`):
    // Wood/plaster cut smoothly; thick steel produces strong drag requiring sustained push.
    let v_at_cut = weapon.point_velocity(centroid);
    let c_lin = sum_hardness
        * PLASMA_DRAG_PER_HARDNESS
        * weapon.spec.viscous_drag_scale
        * plasma_drag_scale;

    let decay_lin = (1.0 + c_lin * weapon.spec.inv_mass * dt_sub).recip();
    let vel_before = weapon.vel;
    weapon.vel = scale(weapon.vel, decay_lin);
    let drag_force = scale(sub(weapon.vel, vel_before), weapon.spec.mass / dt_sub.max(1e-6));

    // Also damp rotational swing around the cut lever arm `r = centroid - weapon.pos`.
    let r = sub(centroid, weapon.pos);
    let r2 = len_sq(r);
    if r2 > 1e-4 {
        let spin_before = weapon.spin;
        let spin_local = quat_back(weapon.rot, weapon.spin);
        let mut new_spin_local = [0.0f32; 3];
        for axis in 0..3 {
            let decay_rot =
                (1.0 + c_lin * r2 * 0.35 * weapon.spec.inv_inertia_local[axis] * dt_sub).recip();
            new_spin_local[axis] = spin_local[axis] * decay_rot;
        }
        weapon.spin = quat_turn(weapon.rot, new_spin_local);
        let d_spin_local = quat_back(weapon.rot, sub(weapon.spin, spin_before));
        let drag_tau_local = [
            d_spin_local[0] * weapon.spec.inertia_local[0] / dt_sub.max(1e-6),
            d_spin_local[1] * weapon.spec.inertia_local[1] / dt_sub.max(1e-6),
            d_spin_local[2] * weapon.spec.inertia_local[2] / dt_sub.max(1e-6),
        ];
        weapon.arm_recoil.torque = sub(
            weapon.arm_recoil.torque,
            quat_turn(weapon.rot, drag_tau_local),
        );
    }

    weapon.last_plasma_drag = add(weapon.last_plasma_drag, drag_force);
    weapon.arm_recoil.force = sub(weapon.arm_recoil.force, drag_force);

    // Identify glowing exposed kerf-rim faces & flammable 6-neighbors.
    const DIRS: [([i32; 3], u8); 6] = [
        ([1, 0, 0], 1 << 1),  // neighbor at +X exposes its -X face
        ([-1, 0, 0], 1 << 0), // neighbor at -X exposes its +X face
        ([0, 1, 0], 1 << 3),  // neighbor at +Y exposes its -Y face
        ([0, -1, 0], 1 << 2), // neighbor at -Y exposes its +Y face
        ([0, 0, 1], 1 << 5),  // neighbor at +Z exposes its -Z face
        ([0, 0, -1], 1 << 4), // neighbor at -Z exposes its +Z face
    ];

    for i in 0..scratch.carved_cells.len() {
        let cell = scratch.carved_cells[i].0;
        let mut had_solid_neighbor = false;
        for &(dir, face_bit) in &DIRS {
            let nb = [cell[0] + dir[0], cell[1] + dir[1], cell[2] + dir[2]];
            if scratch.carved_cells.iter().any(|&(c, _)| c == nb) {
                continue;
            }
            let nb_k = kind_at(nb);
            if nb_k == 0 {
                continue;
            }
            had_solid_neighbor = true;
            if let Some(existing) = scratch.heat_cells.iter_mut().find(|(c, _)| *c == nb) {
                existing.1 |= face_bit;
            } else {
                scratch.heat_cells.push((nb, face_bit));
            }
            if burns(material(nb_k)).0 > 0 && !scratch.ignite_cells.contains(&nb) {
                scratch.ignite_cells.push(nb);
            }
        }
        if !had_solid_neighbor && !scratch.heat_cells.iter().any(|&(c, _)| c == cell) {
            scratch.heat_cells.push((cell, 0b11_1111));
        }
    }

    let plasma_color = weapon.plasma_color;
    let mut heat_list = Vec::with_capacity(scratch.heat_cells.len());
    for &(hc, face_mask) in &scratch.heat_cells {
        cooling_glow.heat_cell(hc, face_mask, plasma_color);
        heat_list.push(hc);
    }

    let (_, w_blade, w_flat) = weapon.world_axes();
    let sweep_mid_vel = sub(lerp3(e0_c, e1_c, 0.5), lerp3(e0_p, e1_p, 0.5));
    let plane_normal = unit_or(
        cross(w_blade, if len_sq(v_at_cut) > 1e-4 { v_at_cut } else { sweep_mid_vel }),
        w_flat,
    );
    let cut_speed = len(v_at_cut);
    let cut_energy =
        (sum_hardness * 0.5 + 0.5 * weapon.spec.mass * cut_speed * cut_speed) * weapon.spec.sharpness;
    let carved_out: Vec<[i32; 3]> = scratch.carved_cells.iter().map(|&(c, _)| c).collect();

    events.push(MeleeEvent::PlasmaKerf {
        cells: carved_out,
        cut_plane: CutPlane {
            point: centroid,
            normal: plane_normal,
        },
        cut_energy,
        heat_cells: heat_list,
    });

    for &ic in &scratch.ignite_cells {
        events.push(MeleeEvent::IgniteCell { cell: ic });
    }
}

/// Resolves swept voxel collisions for blunt, edged, shield, and retracted weapons.
#[inline]
#[allow(clippy::too_many_arguments)]
fn resolve_solid_weapon_voxels<F>(
    weapon: &mut WeaponBody,
    a0_p: V,
    a1_p: V,
    a0_c: V,
    a1_c: V,
    radius: f32,
    scratch: &mut MeleeScratch,
    events: &mut Vec<MeleeEvent>,
    kind_at: &mut F,
) where
    F: FnMut([i32; 3]) -> Kind,
{
    let mut earliest: Option<(SweepHit, [i32; 3], Kind)> = None;

    for_each_swept_solid_voxel(
        &mut scratch.visited,
        a0_p,
        a1_p,
        a0_c,
        a1_c,
        radius,
        false,
        kind_at,
        |cell, k, _t| {
            let center = [
                cell[0] as f32 + 0.5,
                cell[1] as f32 + 0.5,
                cell[2] as f32 + 0.5,
            ];
            if let Some(hit) =
                swept_capsule_aabb_toi(a0_p, a1_p, a0_c, a1_c, radius, center, center, [0.5; 3])
            {
                let replace = match &earliest {
                    None => true,
                    Some((best, _, _)) => {
                        hit.t < best.t - 1e-4
                            || ((hit.t - best.t).abs() <= 1e-4
                                && hit.penetration > best.penetration)
                    }
                };
                if replace {
                    earliest = Some((hit, cell, k));
                }
            }
        },
    );

    let Some((hit, cell, kind)) = earliest else {
        return;
    };

    let mat = material(kind);
    let n = hit.normal;
    let v_rel = weapon.point_velocity(hit.pos);
    let v_speed = len(v_rel);
    let v_n = dot(v_rel, n);
    let v_in = (-v_n).max(0.0);

    // Edged weapon interactions against world voxels.
    if weapon.active_class() == WeaponClass::Edged {
        // 1. Steel voxel -> Steel-on-steel parry clash.
        if mat == STEEL {
            if hit.penetration > 1e-4 {
                weapon.pos = add(weapon.pos, scale(n, hit.penetration * 0.9));
            }
            let inv_eff = weapon.inv_mass_along(hit.pos, n);
            if v_in > 0.0 && inv_eff > 1e-8 {
                let j_n = (1.0 + weapon.spec.restitution) * v_in / inv_eff;
                weapon.apply_impulse_at(scale(n, j_n), hit.pos);
                let sparks = ((j_n * 0.12) as u32).clamp(2, 30);
                events.push(MeleeEvent::ParryClash {
                    pos: hit.pos,
                    normal: n,
                    impulse: j_n,
                    spark_count: sparks,
                });
            }
            return;
        }

        let (_, w_blade, w_flat) = weapon.world_axes();

        // 2. Tip-aligned thrust into penetrable voxel -> 1-DOF `StabBind`.
        if weapon.bind_cooldown <= 0.0
            && weapon.spec.pierce_factor > 0.0
            && hit.s_a >= 0.40
            && is_penetrable(mat, TargetKind::Aabb)
            && v_speed > 1e-3
        {
            let align = dot(scale(v_rel, v_speed.recip()), w_blade);
            if align > STAB_ALIGNMENT_THRESHOLD
                && v_speed * weapon.spec.pierce_factor >= stab_speed_threshold(mat, TargetKind::Aabb)
            {
                let friction = stab_friction(mat, TargetKind::Aabb);
                let v_ax = dot(v_rel, w_blade).max(0.0);
                let ke = 0.5 * weapon.spec.mass * v_ax * v_ax;
                let depth = (ke / friction.max(1.0)).clamp(0.4, weapon.spec.max_bind_depth * 0.7);
                let bind = StabBind {
                    target_id: None,
                    entry_pos: hit.pos,
                    axis: w_blade,
                    depth,
                    max_depth: weapon.spec.max_bind_depth,
                    friction,
                    locked_rot: weapon.rot,
                    material: mat,
                };
                let tip_offset = quat_turn(weapon.rot, weapon.active_tip_local());
                weapon.pos = sub(add(bind.entry_pos, scale(bind.axis, bind.depth)), tip_offset);
                weapon.vel = scale(bind.axis, v_ax * 0.25);
                weapon.spin = [0.0; 3];
                weapon.stab_bind = Some(bind);
                events.push(MeleeEvent::StabEntered {
                    weapon_id: weapon.id,
                    target_id: None,
                    entry_pos: bind.entry_pos,
                    axis: bind.axis,
                    depth: bind.depth,
                });
                return;
            }
        }

        // 3. Edge-aligned chop / draw slice against sliceable voxels.
        let ev = weapon.decompose_velocity(v_rel);
        let v_chop_eff = if weapon.spec.double_edged {
            ev.v_chop.abs()
        } else {
            ev.v_chop.max(0.0)
        };
        let v_cut = v_chop_eff + 0.5 * ev.v_draw.abs();
        if v_chop_eff > ev.v_slap.abs() * 0.75
            && v_chop_eff > 1.0
            && v_cut * weapon.spec.sharpness >= slice_speed_threshold(mat, TargetKind::Aabb)
        {
            let cut_energy = 0.5 * weapon.spec.mass * v_cut * v_cut * weapon.spec.sharpness;
            events.push(MeleeEvent::SliceCut {
                target_id: None,
                plane_point: hit.pos,
                plane_normal: w_flat,
                cut_energy,
                is_plasma: false,
            });
            let cm = crush_metric(v_in.max(v_cut * 0.65), weapon.spec.mass);
            if cm > breaks_at(mat) {
                let push = scale(n, -weapon.spec.mass * v_cut * 0.6);
                events.push(MeleeEvent::CrushVoxel { cell, push });
            }
            let inv_eff = weapon.inv_mass_along(hit.pos, n);
            if v_in > 0.0 && inv_eff > 1e-8 {
                let j_res = (0.35 * v_in) / inv_eff;
                weapon.apply_impulse_at(scale(n, j_res), hit.pos);
            }
            return;
        }
    }

    // Blunt / Fist / Shield / non-cutting voxel impact.
    let inv_eff = weapon.inv_mass_along(hit.pos, n);
    if inv_eff <= 1e-8 {
        return;
    }

    let cm = crush_metric(v_in, weapon.spec.mass);
    let threshold = breaks_at(mat);
    if v_in > 0.0 && cm > threshold {
        let j_full = (1.0 + weapon.spec.restitution) * v_in / inv_eff;
        // Deduct fracture energy impulse while letting the weapon follow through.
        let break_ratio = (threshold / cm).clamp(0.15, 0.75);
        let j_break = (v_in * break_ratio) / inv_eff;
        weapon.apply_impulse_at(scale(n, j_break), hit.pos);
        events.push(MeleeEvent::CrushVoxel {
            cell,
            push: scale(n, -j_full),
        });
        events.push(MeleeEvent::BluntImpact {
            weapon_id: weapon.id,
            target_id: None,
            pos: hit.pos,
            normal: n,
            impulse: j_full,
            shock_impulse: j_full,
        });
        return;
    }

    // Non-breaking rigid bounce off solid voxel.
    if hit.penetration > 1e-4 {
        weapon.pos = add(weapon.pos, scale(n, hit.penetration * 0.9));
    }
    if v_in > 0.0 {
        let j_n = (1.0 + weapon.spec.restitution) * v_in / inv_eff;
        weapon.apply_impulse_at(scale(n, j_n), hit.pos);
        events.push(MeleeEvent::BluntImpact {
            weapon_id: weapon.id,
            target_id: None,
            pos: hit.pos,
            normal: n,
            impulse: j_n,
            shock_impulse: j_n,
        });
    }
}

// ── Unit & Arena Tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kinds::{BRICK, CONCRETE, GLASS, PLASTER, STEEL, WOOD, kind};
    use std::collections::HashSet;
    use std::time::Instant;

    #[test]
    fn weapon_presets_have_valid_specs_and_orthonormal_axes() {
        let all = [
            WeaponKind::Fist,
            WeaponKind::Sledgehammer,
            WeaponKind::Knife,
            WeaponKind::Longsword,
            WeaponKind::BattleAxe,
            WeaponKind::Shield,
            WeaponKind::Lightsaber,
        ];
        for wk in all {
            let s = WeaponSpec::preset(wk);
            assert!(s.mass > 0.0 && (s.inv_mass * s.mass - 1.0).abs() < 1e-5);
            for i in 0..3 {
                assert!(s.inertia_local[i] > 0.0);
                assert!((s.inertia_local[i] * s.inv_inertia_local[i] - 1.0).abs() < 1e-5);
            }
            assert!(s.radius > 0.0);
            assert!((len(s.edge_normal) - 1.0).abs() < 1e-5);
            assert!((len(s.blade_axis) - 1.0).abs() < 1e-5);
            assert!((len(s.flat_normal) - 1.0).abs() < 1e-5);
            assert!(dot(s.edge_normal, s.blade_axis).abs() < 1e-5);
            assert!(dot(s.edge_normal, s.flat_normal).abs() < 1e-5);
            assert!(dot(s.blade_axis, s.flat_normal).abs() < 1e-5);
        }
    }

    #[test]
    fn heavy_vs_light_inertia_lag() {
        // Identical hand-target flick (translation + rotation) moves Knife significantly
        // faster than Sledgehammer under the same character arm strength.
        let params = HandSpringParams::default();
        let start_pos = [0.0, 10.0, 0.0];
        let start_rot = quat_identity();

        let mut knife = WeaponBody::new(1, WeaponKind::Knife, start_pos, start_rot);
        let mut hammer = WeaponBody::new(2, WeaponKind::Sledgehammer, start_pos, start_rot);

        let flick = HandTarget {
            target_pos: [8.0, 10.0, 4.0],
            target_rot: quat_from_axis_angle([0.0, 0.0, 1.0], -1.2),
            target_vel: [80.0, 0.0, 40.0],
            target_spin: [0.0, 0.0, -12.0],
        };

        let mut knife_peak_speed = 0.0f32;
        let mut hammer_peak_speed = 0.0f32;
        let mut knife_peak_spin = 0.0f32;
        let mut hammer_peak_spin = 0.0f32;

        // Run 8 substeps (~33 ms quick flick window).
        for _ in 0..8 {
            let r_k = drive_hand_spring(&mut knife, &flick, &params, SUBSTEP_DT);
            let r_h = drive_hand_spring(&mut hammer, &flick, &params, SUBSTEP_DT);
            assert!(len(r_k.force) > 0.0 && len(r_h.force) > 0.0);
            knife.pos = add(knife.pos, scale(knife.vel, SUBSTEP_DT));
            knife.rot = q_integrate(knife.rot, knife.spin, SUBSTEP_DT);
            hammer.pos = add(hammer.pos, scale(hammer.vel, SUBSTEP_DT));
            hammer.rot = q_integrate(hammer.rot, hammer.spin, SUBSTEP_DT);

            knife_peak_speed = knife_peak_speed.max(len(knife.vel));
            hammer_peak_speed = hammer_peak_speed.max(len(hammer.vel));
            knife_peak_spin = knife_peak_spin.max(len(knife.spin));
            hammer_peak_spin = hammer_peak_spin.max(len(hammer.spin));
        }

        let knife_disp = len(sub(knife.pos, start_pos));
        let hammer_disp = len(sub(hammer.pos, start_pos));
        let knife_err = len(q_error_vec(flick.target_rot, knife.rot));
        let hammer_err = len(q_error_vec(flick.target_rot, hammer.rot));

        assert!(
            knife_peak_speed > hammer_peak_speed * 2.5,
            "Knife ({knife_peak_speed:.1}) should accelerate much faster than Sledgehammer ({hammer_peak_speed:.1})"
        );
        assert!(
            knife_disp > hammer_disp * 2.5,
            "Knife displacement ({knife_disp:.2}) should outpace Sledgehammer ({hammer_disp:.2})"
        );
        assert!(
            knife_peak_spin > hammer_peak_spin * 2.0,
            "Knife spin ({knife_peak_spin:.2}) should greatly exceed Sledgehammer ({hammer_peak_spin:.2})"
        );
        assert!(
            knife_err < hammer_err,
            "Knife angular lag ({knife_err:.3} rad) must be smaller than Sledgehammer ({hammer_err:.3} rad)"
        );
        assert!(knife.pos[0].is_finite() && hammer.pos[0].is_finite());
    }

    #[test]
    fn swept_blade_ccd_no_tunneling_at_25ms() {
        // Fast 25 m/s (250 cells/s) sword swing across a 1-cell thin target never tunnels:
        // 0 misses across 200 swings (100 against 1-cell thin AABB/Capsule targets + 100 against 1-cell voxel wall).
        let mut misses = 0usize;

        for swing in 0..200usize {
            let mut world = MeleeWorld::with_config(MeleeConfig {
                gravity: [0.0; 3],
                ..MeleeConfig::default()
            });

            // Vary sub-cell starting X phase and slight blade tilt across all 200 swings.
            let phase = (swing as f32 / 200.0) * 2.3;
            let tilt = ((swing % 11) as f32 - 5.0) * 0.06;
            let start_x = -3.0 - phase;

            // Orient blade upright (+Y), edge pointing along +X (rotate +90° around Y).
            let rot = q_mul(
                quat_from_axis_angle([0.0, 1.0, 0.0], std::f32::consts::FRAC_PI_2),
                quat_from_axis_angle([1.0, 0.0, 0.0], tilt),
            );
            let mut sword = WeaponBody::new(1, WeaponKind::Longsword, [start_x, 5.0, 0.0], rot);
            sword.vel = [250.0, 0.0, 0.0]; // 25 m/s = 250 cells/s
            world.add_weapon(sword);

            let mut hit = false;
            if swing < 100 {
                // Alternate between 1-cell thin Capsule and 1-cell thin AABB targets at x = 0.
                let t_kind = if swing % 2 == 0 {
                    TargetKind::Ragdoll
                } else {
                    TargetKind::Aabb
                };
                let mut targets = [MeleeTarget {
                    id: 99,
                    kind: t_kind,
                    pos: [0.0, 6.0, 0.0],
                    vel: [0.0; 3],
                    mass: 20.0,
                    material: WOOD,
                    radius: 0.5, // 1 cell thick!
                    half_len: 5.0,
                    axis: [0.0, 1.0, 0.0],
                }];
                for _ in 0..5 {
                    let evts = world.step(TICK_DT, &mut targets, |_| 0);
                    if !evts.is_empty() {
                        hit = true;
                        break;
                    }
                }
            } else {
                // 1-cell thin solid voxel wall at x == 0.
                let mut targets = [];
                for _ in 0..5 {
                    let evts = world.step(TICK_DT, &mut targets, |[x, y, z]| {
                        if x == 0 && (0..=14).contains(&y) && (-4..=4).contains(&z) {
                            kind(WOOD, 0)
                        } else {
                            0
                        }
                    });
                    if !evts.is_empty() {
                        hit = true;
                        break;
                    }
                }
            }

            if !hit {
                misses += 1;
            }
        }

        assert_eq!(misses, 0, "swept-blade 240 Hz CCD missed {misses}/200 swings at 25 m/s");

        // Also verify fast rotational arc swings (tip > 28 m/s = 280 cells/s) across a 1-cell target.
        let mut rot_misses = 0usize;
        for swing in 0..50usize {
            let mut world = MeleeWorld::with_config(MeleeConfig {
                gravity: [0.0; 3],
                ..MeleeConfig::default()
            });
            let start_angle = -0.75 - (swing as f32 / 50.0) * 0.25;
            let rot = quat_from_axis_angle([0.0, 0.0, 1.0], start_angle);
            let mut sword = WeaponBody::new(1, WeaponKind::Longsword, [0.0, 0.0, 0.0], rot);
            // Tip at r = 9.5 cells spinning at 32 rad/s -> tip speed = 304 cells/s (30.4 m/s).
            sword.spin = [0.0, 0.0, 32.0];
            world.add_weapon(sword);
            let mut targets = [MeleeTarget {
                id: 77,
                kind: TargetKind::Capsule,
                pos: [0.0, 8.5, 0.0],
                vel: [0.0; 3],
                mass: 15.0,
                material: WOOD,
                radius: 0.5,
                half_len: 1.5,
                axis: [0.0, 0.0, 1.0],
            }];
            let mut hit = false;
            for _ in 0..8 {
                if !world.step(TICK_DT, &mut targets, |_| 0).is_empty() {
                    hit = true;
                    break;
                }
            }
            if !hit {
                rot_misses += 1;
            }
        }
        assert_eq!(rot_misses, 0, "rotational 30 m/s swept-blade CCD missed {rot_misses}/50 swings");
    }

    #[test]
    fn steel_on_steel_parry_clash() {
        let mut world = MeleeWorld::with_config(MeleeConfig {
            gravity: [0.0; 3],
            ..MeleeConfig::default()
        });

        // Two crossed longswords clashing cleanly near mid-blade (center of percussion).
        let rot_a = quat_from_axis_angle([1.0, 0.0, 0.0], 0.20);
        let rot_b = quat_from_axis_angle([1.0, 0.0, 0.0], -0.20);
        let mut sword_a = WeaponBody::new(1, WeaponKind::Longsword, [-1.4, 5.0, 0.0], rot_a);
        sword_a.vel = [75.0, 0.0, 0.0];
        sword_a.hand_target = Some(HandTarget::stationary([2.0, 5.0, 0.0], rot_a));

        let mut sword_b = WeaponBody::new(2, WeaponKind::Longsword, [1.4, 5.0, 0.0], rot_b);
        sword_b.vel = [-75.0, 0.0, 0.0];
        sword_b.hand_target = Some(HandTarget::stationary([-2.0, 5.0, 0.0], rot_b));

        world.add_weapon(sword_a);
        world.add_weapon(sword_b);

        let mut clash_event = None;
        let mut a_recoil_ang = 0.0f32;
        let mut b_recoil_ang = 0.0f32;
        let mut targets = [];

        for _ in 0..10 {
            let evts = world.step(TICK_DT, &mut targets, |_| 0);
            for e in evts {
                if let MeleeEvent::ParryClash {
                    pos,
                    normal,
                    impulse,
                    spark_count,
                } = *e
                {
                    clash_event = Some((pos, normal, impulse, spark_count));
                }
            }
            a_recoil_ang = a_recoil_ang.max(len(world.weapons[0].arm_recoil.shock_angular_impulse));
            b_recoil_ang = b_recoil_ang.max(len(world.weapons[1].arm_recoil.shock_angular_impulse));
            if clash_event.is_some() {
                break;
            }
        }

        let (pos, normal, impulse, sparks) =
            clash_event.expect("expected ParryClash between colliding longswords");
        assert!(impulse > 50.0, "expected strong steel parry impulse, got {impulse}");
        assert!(sparks >= 4, "expected sparks on parry clash, got {sparks}");
        assert!((len(normal) - 1.0).abs() < 1e-4);
        assert!(pos[0].abs() < 1.0);

        // Contact-point velocity and CoM velocity must deflect cleanly with reciprocal recoil.
        let v_a_after = world.weapons[0].point_velocity(pos);
        let v_b_after = world.weapons[1].point_velocity(pos);
        assert!(
            v_a_after[0] < 0.0,
            "sword A contact velocity should deflect toward -X, got vx={}",
            v_a_after[0]
        );
        assert!(
            v_b_after[0] > 0.0,
            "sword B contact velocity should deflect toward +X, got vx={}",
            v_b_after[0]
        );
        assert!(
            a_recoil_ang > 0.0 && b_recoil_ang > 0.0,
            "both wielders should receive angular recoil (A={a_recoil_ang}, B={b_recoil_ang})"
        );

        // Shield parry check: Longsword striking a broad Shield deflects sharply while Shield stays steadier.
        let mut shield_world = MeleeWorld::with_config(MeleeConfig {
            gravity: [0.0; 3],
            ..MeleeConfig::default()
        });
        let mut attacker = WeaponBody::new(10, WeaponKind::Longsword, [-3.2, 5.0, 0.0], quat_identity());
        attacker.vel = [85.0, 0.0, 0.0];
        let shield = WeaponBody::new(11, WeaponKind::Shield, [0.5, 6.0, 0.0], quat_identity());
        shield_world.add_weapon(attacker);
        shield_world.add_weapon(shield);
        let mut shield_parried = false;
        for _ in 0..8 {
            let evts = shield_world.step(TICK_DT, &mut targets, |_| 0);
            if evts.iter().any(|e| matches!(e, MeleeEvent::ParryClash { .. })) {
                shield_parried = true;
                break;
            }
        }
        assert!(shield_parried, "shield must parry incoming longsword with ParryClash");
        assert!(
            shield_world.weapons[0].vel[0].abs() > shield_world.weapons[1].vel[0].abs() * 2.0
                || shield_world.weapons[0].vel[0] < 0.0,
            "shield should remain far steadier than the deflected longsword"
        );
    }

    #[test]
    fn wood_stab_binding_and_pullout() {
        let mut world = MeleeWorld::with_config(MeleeConfig {
            gravity: [0.0; 3],
            ..MeleeConfig::default()
        });

        // Rotate Longsword -90° around Z so local blade_axis (+Y) points along +X.
        let rot = quat_from_axis_angle([0.0, 0.0, 1.0], -std::f32::consts::FRAC_PI_2);
        let mut sword = WeaponBody::new(1, WeaponKind::Longsword, [0.0, 5.0, 0.0], rot);
        // Tip is at x = 9.5; place wood wall at x >= 11.
        sword.vel = [75.0, 0.0, 0.0]; // aligned 1.0 > 0.72 along +X blade axis
        world.add_weapon(sword);

        let wood_wall = |[x, y, z]: [i32; 3]| -> Kind {
            if x >= 11 && x <= 18 && (0..=12).contains(&y) && (-6..=6).contains(&z) {
                kind(WOOD, 0)
            } else {
                0
            }
        };

        let mut targets = [];
        let mut entered = false;
        for _ in 0..10 {
            let evts = world.step(TICK_DT, &mut targets, wood_wall);
            if evts
                .iter()
                .any(|e| matches!(e, MeleeEvent::StabEntered { weapon_id: 1, .. }))
            {
                entered = true;
                break;
            }
        }
        assert!(entered, "aligned wood thrust must emit StabEntered");
        let bind0 = world.weapons[0]
            .stab_bind
            .expect("blade must enter StabBind after penetrating wood");
        assert!(bind0.depth > 0.3 && bind0.depth <= bind0.max_depth);
        assert!(dot(bind0.axis, [1.0, 0.0, 0.0]) > 0.99);

        // Phase 2: Lateral tug perpendicular to the embedded blade (+Z) must be locked by the wood.
        let z_before = world.weapons[0].pos[2];
        let y_before = world.weapons[0].pos[1];
        world.weapons[0].hand_target = Some(HandTarget::stationary(
            [world.weapons[0].pos[0], y_before, z_before + 8.0],
            rot,
        ));
        for _ in 0..15 {
            world.step(TICK_DT, &mut targets, wood_wall);
        }
        assert!(
            world.weapons[0].stab_bind.is_some(),
            "lateral tug must not release stab binding"
        );
        assert!(
            (world.weapons[0].pos[2] - z_before).abs() < 1e-3,
            "lateral displacement must remain locked (was {}, now {})",
            z_before,
            world.weapons[0].pos[2]
        );
        assert!(
            world.weapons[0].arm_recoil.force[2].abs() > 100.0,
            "wood channel must push back against lateral tug"
        );

        // Phase 3: Axial backward pull (-X) fights sliding friction and smoothly extracts (depth -> 0).
        let pull_x = world.weapons[0].pos[0] - 12.0;
        world.weapons[0].hand_target = Some(HandTarget::stationary([pull_x, y_before, z_before], rot));
        let mut prev_depth = world.weapons[0].stab_bind.unwrap().depth;
        let mut saw_decrease = false;
        let mut released = false;

        for _ in 0..60 {
            let evts = world.step(TICK_DT, &mut targets, wood_wall);
            if evts
                .iter()
                .any(|e| matches!(e, MeleeEvent::StabReleased { weapon_id: 1, .. }))
            {
                released = true;
                break;
            }
            if let Some(b) = world.weapons[0].stab_bind {
                if b.depth < prev_depth - 1e-4 {
                    saw_decrease = true;
                }
                assert!(
                    b.depth <= prev_depth + 1e-4,
                    "depth should monotonically decrease during axial pullout"
                );
                prev_depth = b.depth;
            }
        }

        assert!(saw_decrease, "depth should smoothly decrease before release");
        assert!(released, "axial backward pull must emit StabReleased");
        assert!(
            world.weapons[0].stab_bind.is_none(),
            "blade must be cleanly unbound after depth <= 0"
        );
    }

    #[test]
    fn edged_velocity_decomposition_slice_vs_flat_slap() {
        let mut world = MeleeWorld::with_config(MeleeConfig {
            gravity: [0.0; 3],
            ..MeleeConfig::default()
        });

        // Sword upright: edge_normal = +Z, blade_axis = +Y, flat_normal = +X.
        let mut chop_sword = WeaponBody::new(1, WeaponKind::Longsword, [0.0, 5.0, -1.5], quat_identity());
        chop_sword.vel = [0.0, 15.0, 80.0]; // strong v_chop (+Z) + v_draw (+Y)
        let ev = chop_sword.decompose_velocity(chop_sword.vel);
        assert!((ev.v_chop - 80.0).abs() < 1e-4);
        assert!((ev.v_draw - 15.0).abs() < 1e-4);
        assert!(ev.v_slap.abs() < 1e-4);

        let mut slap_sword = WeaponBody::new(2, WeaponKind::Longsword, [18.5, 5.0, 0.0], quat_identity());
        slap_sword.vel = [80.0, 0.0, 0.0]; // pure flat slap along +X (flat_normal)

        world.add_weapon(chop_sword);
        world.add_weapon(slap_sword);

        let mut targets = [
            MeleeTarget {
                id: 10,
                kind: TargetKind::Ragdoll,
                pos: [0.0, 6.0, 0.0],
                vel: [0.0; 3],
                mass: 12.0,
                material: WOOD,
                radius: 0.7,
                half_len: 4.0,
                axis: [0.0, 1.0, 0.0],
            },
            MeleeTarget {
                id: 20,
                kind: TargetKind::Ragdoll,
                pos: [20.0, 6.0, 0.0],
                vel: [0.0; 3],
                mass: 12.0,
                material: WOOD,
                radius: 0.7,
                half_len: 4.0,
                axis: [0.0, 1.0, 0.0],
            },
        ];

        let mut saw_chop_slice = false;
        let mut saw_slap_slice = false;
        let mut saw_slap_blunt = false;

        for _ in 0..8 {
            let evts = world.step(TICK_DT, &mut targets, |_| 0);
            for e in evts {
                match *e {
                    MeleeEvent::SliceCut {
                        target_id: Some(10),
                        plane_normal,
                        cut_energy,
                        is_plasma: false,
                        ..
                    } => {
                        assert!(cut_energy > 1000.0);
                        assert!(plane_normal[0].abs() > 0.99, "slice plane normal must align with flat_normal");
                        saw_chop_slice = true;
                    }
                    MeleeEvent::SliceCut { target_id: Some(20), .. } => {
                        saw_slap_slice = true;
                    }
                    MeleeEvent::BluntImpact { target_id: Some(20), impulse, .. } => {
                        assert!(impulse > 10.0);
                        saw_slap_blunt = true;
                    }
                    _ => {}
                }
            }
        }

        assert!(saw_chop_slice, "edge-aligned chop+draw must emit SliceCut");
        assert!(!saw_slap_slice, "flat slap must not emit SliceCut");
        assert!(saw_slap_blunt, "flat slap must emit BluntImpact");
    }

    #[test]
    fn blunt_sledgehammer_crushes_brick_but_not_steel() {
        let run = |mat: u8| -> Vec<MeleeEvent> {
            let mut world = MeleeWorld::with_config(MeleeConfig {
                gravity: [0.0; 3],
                ..MeleeConfig::default()
            });
            let mut hammer = WeaponBody::new(1, WeaponKind::Sledgehammer, [-1.5, 5.0, 0.0], quat_identity());
            hammer.vel = [90.0, 0.0, 0.0];
            world.add_weapon(hammer);
            let mut targets = [];
            let mut all = Vec::new();
            for _ in 0..6 {
                all.extend(
                    world
                        .step(TICK_DT, &mut targets, |[x, y, z]| {
                            if x >= 1 && x <= 4 && (0..=12).contains(&y) && (-4..=4).contains(&z) {
                                kind(mat, 0)
                            } else {
                                0
                            }
                        })
                        .iter()
                        .cloned(),
                );
            }
            all
        };

        let brick_evts = run(BRICK);
        let glass_evts = run(GLASS);
        let concrete_evts = run(CONCRETE);
        let steel_evts = run(STEEL);

        assert!(brick_evts.iter().any(|e| matches!(e, MeleeEvent::CrushVoxel { .. })));
        assert!(glass_evts.iter().any(|e| matches!(e, MeleeEvent::CrushVoxel { .. })));
        assert!(concrete_evts.iter().any(|e| matches!(e, MeleeEvent::CrushVoxel { .. })));
        assert!(!steel_evts.iter().any(|e| matches!(e, MeleeEvent::CrushVoxel { .. })));
    }

    #[test]
    fn lightsaber_viscous_resistance_kerf_cooling_and_plasma_clash() {
        // Helper: sweep an ignited lightsaber through a 4-cell thick wall of `mat` (x = 3..=6)
        // using a mutable voxel grid so carved PlasmaKerf cells are removed from the wall.
        let run_wall_sweep = |mat: u8| -> (HashSet<[i32; 3]>, f32, f32, usize, CoolingGlowMap) {
            let mut world = MeleeWorld::with_config(MeleeConfig {
                gravity: [0.0; 3],
                ..MeleeConfig::default()
            });
            let mut saber = WeaponBody::new(1, WeaponKind::Lightsaber, [0.0, 2.0, 0.0], quat_identity())
                .with_plasma_color([0.1, 0.95, 0.3]);
            saber.hand_params.max_force = 3500.0;
            world.add_weapon(saber);

            let mut wall: HashSet<[i32; 3]> = HashSet::new();
            for x in 3..=6 {
                for y in 0..=14 {
                    for z in -1..=1 {
                        wall.insert([x, y, z]);
                    }
                }
            }

            let mut carved = HashSet::new();
            let mut total_drag_force = 0.0f32;
            let mut ignited_count = 0usize;
            let mut targets = [];

            // Drive hand target smoothly across the wall from x = 0 to x = 10 over 30 ticks (0.25 s).
            for step_i in 1..=30 {
                let tx = (step_i as f32 / 30.0) * 10.0;
                world.weapons[0].hand_target = Some(HandTarget {
                    target_pos: [tx, 2.0, 0.0],
                    target_rot: quat_identity(),
                    target_vel: [40.0, 0.0, 0.0],
                    target_spin: [0.0; 3],
                });

                let mut to_remove = Vec::new();
                {
                    let evts = world.step(TICK_DT, &mut targets, |c| {
                        if wall.contains(&c) { kind(mat, 0) } else { 0 }
                    });
                    for e in evts {
                        match e {
                            MeleeEvent::PlasmaKerf { cells, heat_cells, .. } => {
                                assert!(!heat_cells.is_empty());
                                for &c in cells {
                                    carved.insert(c);
                                    to_remove.push(c);
                                }
                            }
                            MeleeEvent::IgniteCell { .. } => {
                                ignited_count += 1;
                            }
                            _ => {}
                        }
                    }
                }
                for c in to_remove {
                    wall.remove(&c);
                }
                total_drag_force += len(world.weapons[0].last_plasma_drag);
            }

            let final_x = world.weapons[0].pos[0];
            (carved, total_drag_force, final_x, ignited_count, world.cooling_glow)
        };

        let (wood_carved, wood_drag, wood_x, wood_ignites, mut glow) = run_wall_sweep(WOOD);
        let (steel_carved, steel_drag, steel_x, steel_ignites, _) = run_wall_sweep(STEEL);

        // Continuous kerf carving across the wall layers.
        assert!(
            wood_carved.len() >= 20,
            "expected continuous wood kerf, carved {} cells",
            wood_carved.len()
        );
        assert!(
            steel_carved.len() >= 10,
            "expected steel kerf carving, carved {} cells",
            steel_carved.len()
        );
        // Check continuity across x = 3, 4, 5, 6 in wood.
        for x in 3..=6 {
            assert!(
                wood_carved.iter().any(|c| c[0] == x),
                "wood kerf missing layer x={x}"
            );
        }

        // Steel produces markedly higher viscous drag force and slows progress relative to wood.
        assert!(
            steel_drag > wood_drag * 1.8,
            "steel viscous drag ({steel_drag:.1}) must significantly exceed wood ({wood_drag:.1})"
        );
        assert!(
            steel_x < wood_x,
            "steel resistance should lag saber position (steel x={steel_x:.2}, wood x={wood_x:.2})"
        );

        // Flammable wood neighbors ignite; non-flammable steel does not.
        assert!(wood_ignites > 0, "plasma cut in wood must emit IgniteCell for flammable neighbors");
        assert_eq!(steel_ignites, 0, "steel must not emit IgniteCell");

        // CoolingGlowMap records incandescent faces (~1.0) and cools to 0.0 over 4.0 s.
        assert!(!glow.is_empty(), "CoolingGlowMap must record glowing kerf rim cells");
        let (&sample_cell, sample_glow) = glow.iter().next().unwrap();
        let initial_heat = sample_glow.heat;
        assert!(initial_heat > 0.85, "fresh kerf rim heat should be near 1.0, got {initial_heat}");
        glow.tick(2.0);
        let mid_heat = glow.heat_at(sample_cell);
        assert!(
            mid_heat > 0.25 && mid_heat < initial_heat - 0.35,
            "heat should cool halfway after 2.0 s (was {initial_heat}, now {mid_heat})"
        );
        glow.tick(2.1);
        assert_eq!(glow.heat_at(sample_cell), 0.0, "heat must cool to 0.0 after 4.0 s");
        assert!(glow.is_empty(), "all glow entries should clear after 4.0 s");

        // Retractable / ignitable lightsaber transitions cleanly.
        let mut saber = WeaponBody::new(7, WeaponKind::Lightsaber, [0.0; 3], quat_identity());
        assert!(saber.is_plasma_active());
        saber.retract();
        let mut retract_world = MeleeWorld::with_config(MeleeConfig {
            gravity: [0.0; 3],
            ..MeleeConfig::default()
        });
        retract_world.add_weapon(saber);
        let mut empty_t = [];
        for _ in 0..40 {
            retract_world.step(TICK_DT, &mut empty_t, |_| 0);
        }
        assert!(!retract_world.weapons[0].is_plasma_active());
        assert_eq!(retract_world.weapons[0].blade_extension, 0.0);
        retract_world.weapons[0].ignite();
        for _ in 0..40 {
            retract_world.step(TICK_DT, &mut empty_t, |_| 0);
        }
        assert!(retract_world.weapons[0].is_plasma_active());
        assert!((retract_world.weapons[0].blade_extension - 1.0).abs() < 1e-5);

        // Opposing lightsabers clash with PlasmaClash (magnetic repulsion + hum pitch shift).
        let mut clash_world = MeleeWorld::with_config(MeleeConfig {
            gravity: [0.0; 3],
            ..MeleeConfig::default()
        });
        let mut s_blue = WeaponBody::new(10, WeaponKind::Lightsaber, [-1.2, 5.0, 0.0], quat_identity())
            .with_plasma_color([0.1, 0.6, 1.0]);
        s_blue.vel = [55.0, 0.0, 0.0];
        s_blue.hand_target = Some(HandTarget::stationary([1.5, 5.0, 0.0], quat_identity()));

        let mut s_red = WeaponBody::new(11, WeaponKind::Lightsaber, [1.2, 5.0, 0.0], quat_identity())
            .with_plasma_color([1.0, 0.1, 0.1]);
        s_red.vel = [-55.0, 0.0, 0.0];
        s_red.hand_target = Some(HandTarget::stationary([-1.5, 5.0, 0.0], quat_identity()));

        clash_world.add_weapon(s_blue);
        clash_world.add_weapon(s_red);

        let mut clashes = 0usize;
        let mut max_intensity = 0.0f32;
        let mut max_pitch = 0.0f32;
        for _ in 0..16 {
            let evts = clash_world.step(TICK_DT, &mut empty_t, |_| 0);
            for e in evts {
                if let MeleeEvent::PlasmaClash {
                    intensity,
                    hum_pitch_shift,
                    ..
                } = *e
                {
                    clashes += 1;
                    max_intensity = max_intensity.max(intensity);
                    max_pitch = max_pitch.max(hum_pitch_shift);
                }
            }
        }

        assert!(clashes >= 2, "opposing lightsabers must sustain PlasmaClash lock, got {clashes}");
        assert!(max_intensity > 0.15 && max_pitch > 0.05);
        // Magnetic repulsion must prevent the two opposing blades from passing through each other.
        assert!(
            clash_world.weapons[0].pos[0] < clash_world.weapons[1].pos[0],
            "lightsabers must remain locked on their own sides (blue x={}, red x={})",
            clash_world.weapons[0].pos[0],
            clash_world.weapons[1].pos[0]
        );
    }

    #[test]
    fn dynamic_target_fist_shock_ragdoll_stab_and_plasma_slice() {
        // 1. Fist punch imparts rigid shock impulse to a dynamic MeleeTarget.
        let mut w_fist = MeleeWorld::with_config(MeleeConfig {
            gravity: [0.0; 3],
            ..MeleeConfig::default()
        });
        let mut fist = WeaponBody::new(1, WeaponKind::Fist, [-1.5, 5.0, 0.0], quat_identity());
        fist.vel = [65.0, 0.0, 0.0];
        w_fist.add_weapon(fist);
        let mut target = [MeleeTarget {
            id: 42,
            kind: TargetKind::Ragdoll,
            pos: [0.5, 5.0, 0.0],
            vel: [0.0; 3],
            mass: 5.0,
            material: PLASTER,
            radius: 0.8,
            half_len: 2.0,
            axis: [0.0, 1.0, 0.0],
        }];
        let mut saw_blunt = false;
        for _ in 0..6 {
            let evts = w_fist.step(TICK_DT, &mut target, |_| 0);
            if evts
                .iter()
                .any(|e| matches!(e, MeleeEvent::BluntImpact { target_id: Some(42), shock_impulse, .. } if *shock_impulse > 10.0))
            {
                saw_blunt = true;
                break;
            }
        }
        assert!(saw_blunt, "fist punch must emit BluntImpact with shock impulse");
        assert!(target[0].vel[0] > 5.0, "fist impulse must accelerate target in +X");

        // 2. Knife thrust binds to a moving Ragdoll target and carries with it until pulled out.
        let mut w_stab = MeleeWorld::with_config(MeleeConfig {
            gravity: [0.0; 3],
            ..MeleeConfig::default()
        });
        let rot = quat_from_axis_angle([0.0, 0.0, 1.0], -std::f32::consts::FRAC_PI_2);
        let mut knife = WeaponBody::new(2, WeaponKind::Knife, [-2.5, 5.0, 0.0], rot);
        knife.vel = [55.0, 0.0, 0.0];
        w_stab.add_weapon(knife);
        let mut ragdoll = [MeleeTarget {
            id: 55,
            kind: TargetKind::Ragdoll,
            pos: [1.0, 5.0, 0.0],
            vel: [0.0, 10.0, 0.0],
            mass: 12.0,
            material: WOOD,
            radius: 0.8,
            half_len: 3.0,
            axis: [0.0, 1.0, 0.0],
        }];
        for _ in 0..8 {
            w_stab.step(TICK_DT, &mut ragdoll, |_| 0);
            if w_stab.weapons[0].stab_bind.is_some() {
                break;
            }
        }
        let bind = w_stab.weapons[0]
            .stab_bind
            .expect("knife thrust into ragdoll must enter StabBind");
        assert_eq!(bind.target_id, Some(55));
        let y_entry = w_stab.weapons[0].pos[1];
        for _ in 0..6 {
            w_stab.step(TICK_DT, &mut ragdoll, |_| 0);
        }
        assert!(
            w_stab.weapons[0].pos[1] > y_entry + 0.3,
            "bound knife must ride along with moving ragdoll target"
        );

        // 3. Lightsaber sweeping a dynamic target emits SliceCut { is_plasma: true }.
        let mut w_plasma = MeleeWorld::with_config(MeleeConfig {
            gravity: [0.0; 3],
            ..MeleeConfig::default()
        });
        let mut saber = WeaponBody::new(3, WeaponKind::Lightsaber, [-1.5, 2.0, 0.0], quat_identity());
        saber.vel = [60.0, 0.0, 0.0];
        w_plasma.add_weapon(saber);
        let mut prop = [MeleeTarget {
            id: 88,
            kind: TargetKind::Aabb,
            pos: [0.5, 6.0, 0.0],
            vel: [0.0; 3],
            mass: 10.0,
            material: STEEL,
            radius: 0.6,
            half_len: 3.0,
            axis: [0.0, 1.0, 0.0],
        }];
        let mut saw_plasma_slice = false;
        for _ in 0..8 {
            let evts = w_plasma.step(TICK_DT, &mut prop, |_| 0);
            if evts
                .iter()
                .any(|e| matches!(e, MeleeEvent::SliceCut { target_id: Some(88), is_plasma: true, .. }))
            {
                saw_plasma_slice = true;
                break;
            }
        }
        assert!(saw_plasma_slice, "lightsaber sweep through target must emit SliceCut with is_plasma: true");
    }

    #[test]
    fn perf_16_dueling_weapons_one_second() {
        // 16 simultaneous dueling weapons (8 active pairs across all weapon presets) stepped
        // for 1 full second (120 ticks = 240 substeps) must take < 1.5 ms total in release mode.
        let mut world = MeleeWorld::new();
        let kinds = [
            WeaponKind::Longsword,
            WeaponKind::Longsword,
            WeaponKind::Lightsaber,
            WeaponKind::Lightsaber,
            WeaponKind::BattleAxe,
            WeaponKind::Shield,
            WeaponKind::Knife,
            WeaponKind::Longsword,
            WeaponKind::Sledgehammer,
            WeaponKind::Shield,
            WeaponKind::Lightsaber,
            WeaponKind::Lightsaber,
            WeaponKind::Fist,
            WeaponKind::Fist,
            WeaponKind::Knife,
            WeaponKind::Knife,
        ];

        for (idx, &wk) in kinds.iter().enumerate() {
            let pair = idx / 2;
            let side = if idx % 2 == 0 { -1.0 } else { 1.0 };
            let base_x = (pair as f32) * 30.0 + side * 1.4;
            let base_z = ((pair % 2) as f32) * 30.0;
            let pos = [base_x, 12.0, base_z];
            let rot = quat_from_axis_angle([0.0, 0.0, 1.0], side * 0.25);
            let mut w = WeaponBody::new(idx as u32 + 1, wk, pos, rot);
            w.hand_target = Some(HandTarget::stationary(pos, rot));
            world.add_weapon(w);
        }

        let mut targets: Vec<MeleeTarget> = (0..8)
            .map(|p| MeleeTarget {
                id: 100 + p as u32,
                kind: TargetKind::Ragdoll,
                pos: [(p as f32) * 30.0, 12.0, ((p % 2) as f32) * 30.0 + 4.5],
                vel: [0.0; 3],
                mass: 15.0,
                material: PLASTER,
                radius: 0.7,
                half_len: 3.5,
                axis: [0.0, 1.0, 0.0],
            })
            .collect();

        // Precompute per-pair guard offsets so all 8 weapon pairs swing cleanly between guard
        // stance and active blade clashes without staying permanently embedded inside shields.
        let mut guard_sep = [0.0f32; 8];
        for p in 0..8 {
            let r_sum = world.weapons[p * 2].spec.radius + world.weapons[p * 2 + 1].spec.radius;
            guard_sep[p] = 0.5 * r_sum + 0.70;
        }

        // Warm up briefly before timing.
        for _ in 0..4 {
            world.step(TICK_DT, &mut targets, |[_, y, _]| if y <= 0 { kind(CONCRETE, 0) } else { 0 });
        }

        // Measure 1 full second (120 ticks = 240 substeps); best of 5 runs avoids single-run OS
        // scheduler preemption spikes when `cargo test --release` saturates all cores in parallel.
        let mut best_ms = f64::INFINITY;
        let mut total_events = 0usize;
        for _ in 0..5 {
            let start = Instant::now();
            let mut run_events = 0usize;
            for tick in 0..120u32 {
                let swing = ((tick as f32) * 0.15).sin();
                let a_swing = swing.abs();
                let ang = 0.18 + 0.32 * swing;
                let (s_half, c_half) = (ang * 0.5).sin_cos();
                for (idx, w) in world.weapons.iter_mut().enumerate() {
                    let pair = idx >> 1;
                    let side = if idx & 1 == 0 { -1.0 } else { 1.0 };
                    let cx = (pair as f32) * 30.0;
                    let cz = ((pair & 1) as f32) * 30.0;
                    let offset = side * (guard_sep[pair] - 0.85 * a_swing);
                    w.hand_target = Some(HandTarget {
                        target_pos: [cx + offset, 12.0, cz],
                        target_rot: [0.0, 0.0, side * s_half, c_half],
                        target_vel: [-side * 25.0 * swing, 0.0, 0.0],
                        target_spin: [0.0, 0.0, side * 3.0],
                    });
                }
                let evts = world.step(TICK_DT, &mut targets, |[_, y, _]| {
                    if y <= 0 { kind(CONCRETE, 0) } else { 0 }
                });
                run_events += evts.len();
            }
            let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
            if elapsed_ms < best_ms {
                best_ms = elapsed_ms;
            }
            total_events = run_events;
        }
        println!(
            "melee perf: 16 dueling weapons x 120 ticks (240 substeps) = {best_ms:.3} ms ({total_events} events)"
        );
        assert!(total_events > 0, "dueling arena should produce real clashes/impacts");

        // Enforce strict < 1.5 ms budget in release (opt-level 3), generous margin under debug.
        #[cfg(not(debug_assertions))]
        assert!(
            best_ms < 1.5,
            "16 dueling weapons x 120 ticks (240 substeps) took {best_ms:.3} ms (budget < 1.5 ms; {total_events} events)"
        );
        #[cfg(debug_assertions)]
        assert!(
            best_ms < 15.0,
            "16 dueling weapons x 120 ticks took {best_ms:.3} ms under debug assertions"
        );
    }
}
