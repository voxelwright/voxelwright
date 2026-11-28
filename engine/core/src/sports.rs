//! High-precision sub-10 cm sports physics & deterministic rollback (#166), proved on Tennis.
//!
//! Designed for balls smaller than Voxelwright's 10 cm world cells (a standard tennis ball has
//! diameter 6.7 cm = `0.67` cells) moving at 200+ km/h (`556+` cells/s):
//! - **480 Hz micro-substeps** (`4` substeps per `1/120 s` physics tick) with exact continuous
//!   Time-of-Impact (TOI) swept-sphere CCD against voxel worlds, court/net geometry, and thin
//!   swept elliptic rackets.
//! - **Coplanar 10 cm voxel normal welding** suppresses internal vertical/horizontal seams
//!   between adjacent solid voxels so low-angle skimming bounces across a flat voxel court never
//!   catch phantom edges.
//! - **Cross / Stepanek aerodynamics**: spin-dependent quadratic drag, Magnus lift, and velocity-
//!   proportional spin decay.
//! - **Cross / Brody slip-to-roll bounce**: `Hard`, `Clay`, and `Grass` surface presets with
//!   coupled linear/angular Coulomb friction impulses (`alpha = 2/3` hollow sphere).
//! - **Swept-ellipse racket contact**: Mirtich/Redon Conservative Advancement against a moving,
//!   rotating elliptic disk prism (`16 cm x 12.5 cm x 1.6 cm`), sweet-spot restitution falloff,
//!   and stringbed tangential bite.
//! - **Bit-deterministic algebraic math**: `+`, `-`, `*`, `/`, and `sqrt` only (zero platform-
//!   dependent trig or `powf`) so WASM, Node, and native clients agree.
//! - **Compact 32-byte snapshots & `RollbackRing`**: fixed-size client prediction ring buffer
//!   with deterministic server reconciliation and replay.

use core::f32::consts::PI;

// ── Units & physical constants ──────────────────────────────────────────────

/// One world cell in metres (`0.1 m` = 10 cm).
pub const CELL_M: f32 = 0.1;
/// World cells per metre (`10.0`).
pub const CELLS_PER_M: f32 = 10.0;
/// Gravity in cells/s² (`9.8 m/s²` = `98.0 cells/s²`).
pub const G: f32 = 98.0;
/// Standard air density at sea level in kg/m³.
pub const AIR_DENSITY_SI: f32 = 1.225;
/// Air density in kg/cell³ (`1.225 * 0.1³`).
pub const AIR_DENSITY_CELL: f32 = AIR_DENSITY_SI * CELL_M * CELL_M * CELL_M;

/// Outer fixed simulation tick rate (120 Hz).
pub const TICK_HZ: u32 = 120;
/// Duration of one fixed physics tick in seconds (`1/120 s`).
pub const TICK_DT: f32 = 1.0 / 120.0;
/// Number of 480 Hz micro-substeps per 120 Hz tick.
pub const SUBSTEPS: u32 = 4;
/// Duration of one micro-substep in seconds (`1/480 s`).
pub const SUBSTEP_DT: f32 = TICK_DT / (SUBSTEPS as f32);

/// Maximum continuous TOI bounces resolved within a single 480 Hz substep.
const MAX_TOI_ITERS: usize = 4;
/// Surface separation skin width after resolving an impact (0.01 mm).
const SKIN_EPS: f32 = 1e-4;
/// Conservative Advancement convergence tolerance for swept racket TOI (0.01 mm).
const CA_TOI_EPS: f32 = 1e-4;
/// Maximum Conservative Advancement iterations for swept-ellipse racket CCD.
const MAX_CA_ITERS: usize = 64;
/// Maximum swept-AABB cell count for direct box iteration before chunking along the segment.
const MAX_DIRECT_VOXELS: i64 = 256;

/// Convert metres to world cells (`1 m = 10 cells`).
#[inline]
pub const fn meters_to_cells(m: f32) -> f32 {
    m * CELLS_PER_M
}

/// Convert world cells to metres (`1 cell = 0.1 m`).
#[inline]
pub const fn cells_to_meters(c: f32) -> f32 {
    c * CELL_M
}

/// Convert m/s to cells/s.
#[inline]
pub const fn mps_to_cells_per_s(mps: f32) -> f32 {
    mps * CELLS_PER_M
}

/// Convert cells/s to m/s.
#[inline]
pub const fn cells_per_s_to_mps(cps: f32) -> f32 {
    cps * CELL_M
}

/// Convert km/h to cells/s (`200 km/h ≈ 555.56 cells/s`).
#[inline]
pub const fn kmh_to_cells_per_s(kmh: f32) -> f32 {
    kmh * (CELLS_PER_M / 3.6)
}

/// Convert RPM to rad/s.
#[inline]
pub const fn rpm_to_rad_s(rpm: f32) -> f32 {
    rpm * (2.0 * PI / 60.0)
}

/// Convert rad/s to RPM.
#[inline]
pub const fn rad_s_to_rpm(rad_s: f32) -> f32 {
    rad_s * (60.0 / (2.0 * PI))
}

// ── Pure algebraic vector & quaternion helpers (IEEE-754 deterministic) ─────

pub type Vec3 = [f32; 3];
/// Unit quaternion stored as `[x, y, z, w]`.
pub type Quat = [f32; 4];

#[inline]
fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

#[inline]
fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

#[inline]
fn scale(a: Vec3, k: f32) -> Vec3 {
    [a[0] * k, a[1] * k, a[2] * k]
}

#[inline]
fn dot(a: Vec3, b: Vec3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline]
fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[inline]
fn len_sq(a: Vec3) -> f32 {
    dot(a, a)
}

#[inline]
fn len(a: Vec3) -> f32 {
    dot(a, a).sqrt()
}

#[inline]
fn normalize_or(a: Vec3, fallback: Vec3) -> Vec3 {
    let l2 = dot(a, a);
    if l2 > 1e-12 {
        scale(a, 1.0 / l2.sqrt())
    } else {
        fallback
    }
}

#[inline]
fn quat_normalize(q: Quat) -> Quat {
    let l2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
    if l2 > 1e-12 {
        let inv = 1.0 / l2.sqrt();
        [q[0] * inv, q[1] * inv, q[2] * inv, q[3] * inv]
    } else {
        [0.0, 0.0, 0.0, 1.0]
    }
}

#[inline]
fn quat_conj(q: Quat) -> Quat {
    [-q[0], -q[1], -q[2], q[3]]
}

#[inline]
fn quat_mul(a: Quat, b: Quat) -> Quat {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}

#[inline]
fn quat_rotate(q: Quat, v: Vec3) -> Vec3 {
    let u = [q[0], q[1], q[2]];
    let t = scale(cross(u, v), 2.0);
    add(add(v, scale(t, q[3])), cross(u, t))
}

#[inline]
fn quat_inv_rotate(q: Quat, v: Vec3) -> Vec3 {
    quat_rotate(quat_conj(q), v)
}

/// Shortest-arc normalized linear interpolation between unit quaternions (purely algebraic).
#[inline]
fn quat_nlerp(q0: Quat, q1: Quat, t: f32) -> Quat {
    let d = q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3];
    let s = if d < 0.0 { -1.0 } else { 1.0 };
    let omt = 1.0 - t;
    quat_normalize([
        omt * q0[0] + t * s * q1[0],
        omt * q0[1] + t * s * q1[1],
        omt * q0[2] + t * s * q1[2],
        omt * q0[3] + t * s * q1[3],
    ])
}

/// Build a unit quaternion from an orthonormal right-handed basis `(axis_x, axis_y, axis_z)`.
/// Purely algebraic (Shepperd's method: `+`, `-`, `*`, `/`, `sqrt` only).
pub fn quat_from_basis(x: Vec3, y: Vec3, z: Vec3) -> Quat {
    let m00 = x[0];
    let m01 = y[0];
    let m02 = z[0];
    let m10 = x[1];
    let m11 = y[1];
    let m12 = z[1];
    let m20 = x[2];
    let m21 = y[2];
    let m22 = z[2];
    let trace = m00 + m11 + m22;
    let q = if trace > 0.0 {
        let s = (trace + 1.0).sqrt() * 2.0;
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
    quat_normalize(q)
}

/// Build a unit quaternion whose local +Z axis points along `normal`, using `up_hint` to orient +Y.
pub fn quat_from_normal(normal: Vec3, up_hint: Vec3) -> Quat {
    let z = normalize_or(normal, [0.0, 0.0, 1.0]);
    let mut x = cross(up_hint, z);
    if len_sq(x) < 1e-8 {
        let alt = if z[1].abs() < 0.9 { [0.0, 1.0, 0.0] } else { [1.0, 0.0, 0.0] };
        x = cross(alt, z);
    }
    let x = normalize_or(x, [1.0, 0.0, 0.0]);
    let y = cross(z, x);
    quat_from_basis(x, y, z)
}

// ── Ball, Court & Racket specifications ─────────────────────────────────────

/// Physical properties of a spherical sports ball in Voxelwright cell units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BallSpec {
    /// Ball radius in world cells (tennis: `0.335` = 3.35 cm).
    pub radius: f32,
    /// Ball mass in kg (tennis: `0.057` kg).
    pub mass: f32,
    /// Dimensionless rotational inertia factor `alpha` where `I = alpha * m * r²`
    /// (`2/3` for a hollow thin-walled sphere such as a tennis ball).
    pub inertia_alpha: f32,
    /// Aerodynamic spin decay coefficient `c_w` in `cell⁻¹` (`dω/dt = -c_w * |v| * ω`).
    pub spin_decay: f32,
    /// Precomputed aerodynamic prefactor `0.5 * rho_cell * pi * r² / mass`.
    pub aero_k: f32,
}

impl BallSpec {
    /// ITF regulation tennis ball: 6.7 cm diameter (`r = 0.335` cells), 57 g, hollow sphere (`α = 2/3`).
    pub const TENNIS: Self = Self::new(0.335, 0.057, 2.0 / 3.0, 0.0005);

    pub const fn new(radius: f32, mass: f32, inertia_alpha: f32, spin_decay: f32) -> Self {
        let area_cell = PI * radius * radius;
        let aero_k = 0.5 * AIR_DENSITY_CELL * area_cell / mass;
        Self {
            radius,
            mass,
            inertia_alpha,
            spin_decay,
            aero_k,
        }
    }
}

/// Court surface friction & normal restitution presets (Cross / Brody slip-to-roll bounce).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum CourtSurface {
    Hard = 0,
    Clay = 1,
    Grass = 2,
}

impl CourtSurface {
    #[inline]
    pub const fn from_u32(v: u32) -> Self {
        match v {
            1 => Self::Clay,
            2 => Self::Grass,
            _ => Self::Hard,
        }
    }

    /// Returns `(e_n, mu)`: normal restitution and sliding Coulomb friction coefficient.
    #[inline]
    pub const fn params(self) -> (f32, f32) {
        match self {
            Self::Hard => (0.75, 0.65),
            Self::Clay => (0.80, 0.85),
            Self::Grass => (0.68, 0.45),
        }
    }
}

/// Analytical ITF regulation tennis court ground plane and net (top tape + compliant mesh).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Court {
    pub surface: CourtSurface,
    /// Optional flat ground plane height in cells (`None` when using voxel-only court).
    pub ground_y: Option<f32>,
    /// Whether the tennis net is active.
    pub net_enabled: bool,
    /// Z coordinate of the net plane in cells.
    pub net_z: f32,
    /// Half-span of the net from center to each post (`6.4 m = 64.0` cells).
    pub net_half_span: f32,
    /// Net height above `net_base_y` at the center (`0.914 m = 9.14` cells).
    pub net_center_height: f32,
    /// Net height above `net_base_y` at the posts (`1.07 m = 10.7` cells).
    pub net_post_height: f32,
    /// Base elevation of the net bottom in cells.
    pub net_base_y: f32,
    /// Radius of the top net tape / cord capsule (`2.5 cm = 0.25` cells).
    pub net_tape_radius: f32,
    /// Half-thickness of the compliant net mesh slab (`0.5 cm = 0.05` cells).
    pub net_mesh_half_thick: f32,
}

impl Court {
    /// Standard ITF court with plane at `y = ground_y` and net centered at `z = net_z`.
    pub const fn regulation(surface: CourtSurface, ground_y: f32, net_z: f32) -> Self {
        Self {
            surface,
            ground_y: Some(ground_y),
            net_enabled: true,
            net_z,
            net_half_span: 64.0,
            net_center_height: 9.14,
            net_post_height: 10.7,
            net_base_y: ground_y,
            net_tape_radius: 0.25,
            net_mesh_half_thick: 0.05,
        }
    }

    /// Flat ground plane only (no net), useful for pure bounce tests.
    pub const fn plane_only(surface: CourtSurface, ground_y: f32) -> Self {
        Self {
            surface,
            ground_y: Some(ground_y),
            net_enabled: false,
            net_z: 0.0,
            net_half_span: 64.0,
            net_center_height: 9.14,
            net_post_height: 10.7,
            net_base_y: ground_y,
            net_tape_radius: 0.25,
            net_mesh_half_thick: 0.05,
        }
    }

    #[inline]
    pub fn net_height_at(&self, x: f32) -> f32 {
        let frac = (x.abs() / self.net_half_span).min(1.0);
        self.net_base_y + self.net_center_height + (self.net_post_height - self.net_center_height) * frac
    }
}

/// Oriented elliptic disk prism racket geometry & stringbed response.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RacketSpec {
    /// Major semi-axis along racket local +X (`16 cm = 1.6` cells).
    pub semi_a: f32,
    /// Minor semi-axis along racket local +Y (`12.5 cm = 1.25` cells).
    pub semi_b: f32,
    /// Half-thickness along racket local +Z (`0.8 cm = 0.08` cells).
    pub half_thick: f32,
    /// Apparent coefficient of restitution at the sweet spot (`0.45`).
    pub e_center: f32,
    /// Apparent coefficient of restitution at the rim (`0.15`).
    pub e_rim: f32,
    /// Stringbed tangential friction / bite coefficient (`~0.35`).
    pub mu_string: f32,
}

impl RacketSpec {
    pub const TENNIS: Self = Self {
        semi_a: 1.6,
        semi_b: 1.25,
        half_thick: 0.08,
        e_center: 0.45,
        e_rim: 0.15,
        mu_string: 0.35,
    };

    /// Sweet-spot restitution `e_R(offset)` peaking at `e_center` (`0.45`) and dropping smoothly
    /// toward `e_rim` (`0.15`) as normalized elliptical radius `offset` goes from `0` to `1`.
    #[inline]
    pub fn restitution_at(&self, offset: f32) -> f32 {
        let clamped = offset.clamp(0.0, 1.0);
        self.e_center - (self.e_center - self.e_rim) * clamped * clamped
    }
}

/// Instantaneous pose of a racket head (center in cells, unit quaternion `[x, y, z, w]`).
/// Local +X is `semi_a`, local +Y is `semi_b`, local +Z is the stringbed face normal.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RacketPose {
    pub center: Vec3,
    pub quat: Quat,
}

impl RacketPose {
    #[inline]
    pub fn new(center: Vec3, quat: Quat) -> Self {
        Self {
            center,
            quat: quat_normalize(quat),
        }
    }

    #[inline]
    pub fn from_normal(center: Vec3, normal: Vec3, up_hint: Vec3) -> Self {
        Self {
            center,
            quat: quat_from_normal(normal, up_hint),
        }
    }
}

/// Swept racket motion across one outer `1/120 s` tick (`prev` at `t=0` to `curr` at `t=1`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RacketSwing {
    pub prev: RacketPose,
    pub curr: RacketPose,
    pub spec: RacketSpec,
}

impl RacketSwing {
    #[inline]
    pub fn new(prev: RacketPose, curr: RacketPose) -> Self {
        Self {
            prev,
            curr,
            spec: RacketSpec::TENNIS,
        }
    }

    /// Interpolate a sub-interval `[u0, u1]` (fractions of the outer tick) for one 480 Hz substep.
    #[inline]
    fn sub_slice(&self, u0: f32, u1: f32) -> (RacketPose, RacketPose) {
        let c0 = add(self.prev.center, scale(sub(self.curr.center, self.prev.center), u0));
        let c1 = add(self.prev.center, scale(sub(self.curr.center, self.prev.center), u1));
        let q0 = quat_nlerp(self.prev.quat, self.curr.quat, u0);
        let q1 = quat_nlerp(self.prev.quat, self.curr.quat, u1);
        (RacketPose { center: c0, quat: q0 }, RacketPose { center: c1, quat: q1 })
    }
}

/// Active state of a sports ball.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SportsBall {
    pub pos: Vec3,
    pub vel: Vec3,
    pub spin: Vec3,
    pub spec: BallSpec,
}

impl SportsBall {
    #[inline]
    pub const fn new_tennis(pos: Vec3, vel: Vec3, spin: Vec3) -> Self {
        Self {
            pos,
            vel,
            spin,
            spec: BallSpec::TENNIS,
        }
    }

    #[inline]
    pub const fn snapshot(&self, tick: u32) -> BallSnapshot {
        BallSnapshot {
            tick,
            pos: self.pos,
            vel: self.vel,
            spin: self.spin,
        }
    }

    #[inline]
    pub fn apply_snapshot(&mut self, snap: &BallSnapshot) {
        self.pos = snap.pos;
        self.vel = snap.vel;
        self.spin = snap.spin;
    }
}

/// Diagnostics emitted for impacts resolved during a tick.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ImpactKind {
    Voxel,
    Court,
    NetTape,
    NetMesh,
    Racket,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ImpactEvent {
    pub kind: ImpactKind,
    pub pos: Vec3,
    pub normal: Vec3,
    pub speed_in: f32,
}

// ── Cross / Stepanek Aerodynamics ───────────────────────────────────────────

/// Smooth Cross drag coefficient `C_d(S)` as a function of spin ratio `S = r * |ω| / |v|`.
/// Purely algebraic (no `powf`), closely matching Stepanek/Cross wind-tunnel curves.
#[inline]
pub fn drag_coefficient(spin_ratio: f32) -> f32 {
    0.55 + 0.35 * spin_ratio / (1.0 + spin_ratio)
}

/// Cross / Stepanek Magnus lift coefficient `C_L(S) = 1 / (2.02 + 0.98 / S)` for `S > 1e-4`.
#[inline]
pub fn lift_coefficient(spin_ratio: f32) -> f32 {
    if spin_ratio > 1e-4 {
        1.0 / (2.02 + 0.98 / spin_ratio)
    } else {
        0.0
    }
}

/// Compute aerodynamic linear acceleration (cells/s²) and updated spin after `dt` seconds.
#[inline]
fn integrate_aero_and_gravity(ball: &mut SportsBall, dt: f32) {
    let v = ball.vel;
    let w = ball.spin;
    let v2 = len_sq(v);
    let mut acc = [0.0, -G, 0.0];

    if v2 > 1e-8 {
        let speed = v2.sqrt();
        let inv_speed = 1.0 / speed;
        let w2 = len_sq(w);

        let cd = if w2 > 1e-10 {
            let w_mag = w2.sqrt();
            let s = ball.spec.radius * w_mag * inv_speed;
            let cl = lift_coefficient(s);
            let wxv = cross(w, v);
            let wxv2 = len_sq(wxv);
            if cl > 0.0 && wxv2 > 1e-12 {
                let mag_scale = ball.spec.aero_k * cl * v2 / wxv2.sqrt();
                acc[0] += wxv[0] * mag_scale;
                acc[1] += wxv[1] * mag_scale;
                acc[2] += wxv[2] * mag_scale;
            }
            let decay = (ball.spec.spin_decay * speed * dt).min(0.5);
            let keep = 1.0 - decay;
            ball.spin = scale(w, keep);
            drag_coefficient(s)
        } else {
            0.55
        };

        let drag_scale = -ball.spec.aero_k * cd * speed;
        acc[0] += v[0] * drag_scale;
        acc[1] += v[1] * drag_scale;
        acc[2] += v[2] * drag_scale;
    }

    ball.vel[0] += acc[0] * dt;
    ball.vel[1] += acc[1] * dt;
    ball.vel[2] += acc[2] * dt;
}

// ── Cross / Brody Slip-to-Roll Bounce Impulse ───────────────────────────────

/// Apply Cross / Brody slip-to-roll contact impulse for a spinning sphere hitting a surface
/// moving at `surf_vel` with unit outward `normal`, restitution `e_n`, and friction `mu`.
///
/// Updates both `ball.vel` and `ball.spin` simultaneously using hollow-sphere inertia
/// `I = alpha * m * r²` (`1 + 1/alpha = 2.5` for `alpha = 2/3`).
pub fn apply_slip_to_roll_impulse(
    ball: &mut SportsBall,
    normal: Vec3,
    surf_vel: Vec3,
    e_n: f32,
    mu: f32,
) -> f32 {
    let v_rel = sub(ball.vel, surf_vel);
    let vn = dot(v_rel, normal);
    if vn >= 0.0 {
        return 0.0;
    }

    // Suppress infinite sub-millimetre micro-bounces when coming to rest on a flat surface.
    let e_eff = if -vn < 0.5 { 0.0 } else { e_n };
    let j_n = -(1.0 + e_eff) * vn;

    // Contact patch tangential velocity: v_c = v_t + omega x (-r * n).
    let v_t = sub(v_rel, scale(normal, vn));
    let r = ball.spec.radius;
    let r_contact = scale(normal, -r);
    let v_c = add(v_t, cross(ball.spin, r_contact));

    // Pure-roll tangential impulse per unit mass: J_roll / m = -v_c / (1 + 1/alpha).
    let denom = 1.0 + 1.0 / ball.spec.inertia_alpha;
    let j_roll = scale(v_c, -1.0 / denom);
    let j_roll_mag = len(j_roll);
    let max_j_t = mu * j_n;

    let j_t = if j_roll_mag > max_j_t && j_roll_mag > 1e-12 {
        scale(j_roll, max_j_t / j_roll_mag)
    } else {
        j_roll
    };

    // Update linear velocity: dv = j_n * n + j_t.
    ball.vel[0] += normal[0] * j_n + j_t[0];
    ball.vel[1] += normal[1] * j_n + j_t[1];
    ball.vel[2] += normal[2] * j_n + j_t[2];

    // Update angular velocity: d_omega = ((-r * n) x J_t) / (alpha * m * r²) = (j_t x n) / (alpha * r).
    let inv_alpha_r = 1.0 / (ball.spec.inertia_alpha * r);
    let d_omega = scale(cross(j_t, normal), inv_alpha_r);
    ball.spin[0] += d_omega[0];
    ball.spin[1] += d_omega[1];
    ball.spin[2] += d_omega[2];

    -vn
}

// ── Exact Swept-Sphere TOI Solvers ──────────────────────────────────────────

#[derive(Clone, Copy)]
struct ToiCandidate {
    t: f32,
    normal: Vec3,
    kind: ImpactKind,
    surf_vel: Vec3,
    e_n: f32,
    mu: f32,
    penetration: f32,
}

/// Fast ray-vs-AABB slab test for ray `p0 + t * d`, `t in [0, t_max]`.
#[inline]
fn ray_hits_aabb(p0: Vec3, d: Vec3, bmin: Vec3, bmax: Vec3, t_max: f32) -> bool {
    let mut tmin = 0.0f32;
    let mut tmax = t_max;
    for a in 0..3 {
        if d[a].abs() < 1e-12 {
            if p0[a] < bmin[a] || p0[a] > bmax[a] {
                return false;
            }
        } else {
            let inv = 1.0 / d[a];
            let mut t0 = (bmin[a] - p0[a]) * inv;
            let mut t1 = (bmax[a] - p0[a]) * inv;
            if t0 > t1 {
                core::mem::swap(&mut t0, &mut t1);
            }
            if t0 > tmin {
                tmin = t0;
            }
            if t1 < tmax {
                tmax = t1;
            }
            if tmin > tmax {
                return false;
            }
        }
    }
    true
}

/// Suppress normal components pointing into solid neighbor voxels (coplanar seam welding).
#[inline]
fn weld_voxel_normal(raw_n: Vec3, mask: u8) -> Option<Vec3> {
    let mut n = raw_n;
    // Bit layout: 0 = -X, 1 = +X, 2 = -Y, 3 = +Y, 4 = -Z, 5 = +Z.
    if n[0] < 0.0 && (mask & 1) != 0 {
        n[0] = 0.0;
    } else if n[0] > 0.0 && (mask & 2) != 0 {
        n[0] = 0.0;
    }
    if n[1] < 0.0 && (mask & 4) != 0 {
        n[1] = 0.0;
    } else if n[1] > 0.0 && (mask & 8) != 0 {
        n[1] = 0.0;
    }
    if n[2] < 0.0 && (mask & 16) != 0 {
        n[2] = 0.0;
    } else if n[2] > 0.0 && (mask & 32) != 0 {
        n[2] = 0.0;
    }
    let l2 = len_sq(n);
    if l2 <= 1e-12 {
        None
    } else {
        Some(scale(n, 1.0 / l2.sqrt()))
    }
}

/// Exact swept-sphere vs single solid voxel `[ix, iy, iz]` with 6-neighbor coplanar welding.
fn swept_sphere_vs_voxel(
    p0: Vec3,
    d: Vec3,
    r: f32,
    v: [i32; 3],
    mask: u8,
    t_best: f32,
) -> Option<(f32, Vec3, f32)> {
    // Completely enclosed interior voxel cannot be hit.
    if mask == 0b11_1111 {
        return None;
    }

    let bmin = [v[0] as f32, v[1] as f32, v[2] as f32];
    let bmax = [bmin[0] + 1.0, bmin[1] + 1.0, bmin[2] + 1.0];

    // 1. Check existing overlap at t = 0.
    let q = [
        p0[0].clamp(bmin[0], bmax[0]),
        p0[1].clamp(bmin[1], bmax[1]),
        p0[2].clamp(bmin[2], bmax[2]),
    ];
    let delta = sub(p0, q);
    let dist2 = len_sq(delta);
    let r2 = r * r;
    if dist2 < r2 {
        let (raw_n, pen) = if dist2 > 1e-12 {
            let dist = dist2.sqrt();
            (scale(delta, 1.0 / dist), r - dist)
        } else {
            // Sphere center lies inside voxel: pick shallowest exposed face.
            let dists = [
                (p0[0] - bmin[0], 0u8, [-1.0, 0.0, 0.0]),
                (bmax[0] - p0[0], 1u8, [1.0, 0.0, 0.0]),
                (p0[1] - bmin[1], 2u8, [0.0, -1.0, 0.0]),
                (bmax[1] - p0[1], 3u8, [0.0, 1.0, 0.0]),
                (p0[2] - bmin[2], 4u8, [0.0, 0.0, -1.0]),
                (bmax[2] - p0[2], 5u8, [0.0, 0.0, 1.0]),
            ];
            let mut best_d = f32::INFINITY;
            let mut best_n = [0.0, 1.0, 0.0];
            for (fd, bit, fnrm) in dists {
                if (mask & (1 << bit)) == 0 && fd < best_d {
                    best_d = fd;
                    best_n = fnrm;
                }
            }
            (best_n, r + best_d)
        };
        if let Some(n) = weld_voxel_normal(raw_n, mask) {
            if dot(d, n) < 0.0 {
                return Some((0.0, n, pen));
            }
        }
        return None;
    }

    let mut best_t = t_best;
    let mut best_n = [0.0; 3];
    let mut hit = false;
    const FACE_EPS: f32 = 1e-6;

    // 2. Test the 6 exposed face rectangles (skipping any face whose neighbor is solid).
    for axis in 0..3 {
        let u = (axis + 1) % 3;
        let w = (axis + 2) % 3;
        // Negative face (bit = axis*2)
        if (mask & (1 << (axis * 2))) == 0 && d[axis] > 1e-12 {
            let plane = bmin[axis] - r;
            let t = (plane - p0[axis]) / d[axis];
            if t >= 0.0 && t <= best_t {
                let pu = p0[u] + t * d[u];
                let pw = p0[w] + t * d[w];
                if pu >= bmin[u] - FACE_EPS
                    && pu <= bmax[u] + FACE_EPS
                    && pw >= bmin[w] - FACE_EPS
                    && pw <= bmax[w] + FACE_EPS
                {
                    best_t = t;
                    best_n = [0.0; 3];
                    best_n[axis] = -1.0;
                    hit = true;
                }
            }
        }
        // Positive face (bit = axis*2 + 1)
        if (mask & (1 << (axis * 2 + 1))) == 0 && d[axis] < -1e-12 {
            let plane = bmax[axis] + r;
            let t = (plane - p0[axis]) / d[axis];
            if t >= 0.0 && t <= best_t {
                let pu = p0[u] + t * d[u];
                let pw = p0[w] + t * d[w];
                if pu >= bmin[u] - FACE_EPS
                    && pu <= bmax[u] + FACE_EPS
                    && pw >= bmin[w] - FACE_EPS
                    && pw <= bmax[w] + FACE_EPS
                {
                    best_t = t;
                    best_n = [0.0; 3];
                    best_n[axis] = 1.0;
                    hit = true;
                }
            }
        }
    }

    // 3. Test the 12 exterior convex edges (ONLY when BOTH adjacent face neighbors are empty;
    //    any edge with a solid face neighbor is either an internal coplanar seam or concave crease).
    for edge_axis in 0..3 {
        let a = (edge_axis + 1) % 3;
        let b = (edge_axis + 2) % 3;
        let da = d[a];
        let db = d[b];
        let qa = da * da + db * db;
        if qa <= 1e-12 {
            continue;
        }
        for sa in 0..2 {
            if (mask & (1 << (a * 2 + sa))) != 0 {
                continue;
            }
            let ca = if sa == 0 { bmin[a] } else { bmax[a] };
            let ma = p0[a] - ca;
            for sb in 0..2 {
                if (mask & (1 << (b * 2 + sb))) != 0 {
                    continue;
                }
                let cb = if sb == 0 { bmin[b] } else { bmax[b] };
                let mb = p0[b] - cb;
                let qb = ma * da + mb * db;
                if qb >= 0.0 {
                    continue;
                }
                let qc = ma * ma + mb * mb - r2;
                if qc <= 0.0 {
                    continue;
                }
                let disc = qb * qb - qa * qc;
                if disc < 0.0 {
                    continue;
                }
                let t = (-qb - disc.sqrt()) / qa;
                if t >= 0.0 && t <= best_t {
                    let pe = p0[edge_axis] + t * d[edge_axis];
                    if pe >= bmin[edge_axis] - FACE_EPS && pe <= bmax[edge_axis] + FACE_EPS {
                        let mut raw_n = [0.0; 3];
                        raw_n[a] = (ma + t * da) / r;
                        raw_n[b] = (mb + t * db) / r;
                        if let Some(n) = weld_voxel_normal(raw_n, mask) {
                            if dot(d, n) < 0.0 {
                                best_t = t;
                                best_n = n;
                                hit = true;
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Test the 8 exterior convex corners (ONLY when ALL THREE adjacent face neighbors are empty).
    let qa = len_sq(d);
    if qa > 1e-12 {
        for sx in 0..2 {
            if (mask & (1 << sx)) != 0 {
                continue;
            }
            let cx = if sx == 0 { bmin[0] } else { bmax[0] };
            for sy in 0..2 {
                if (mask & (1 << (2 + sy))) != 0 {
                    continue;
                }
                let cy = if sy == 0 { bmin[1] } else { bmax[1] };
                for sz in 0..2 {
                    if (mask & (1 << (4 + sz))) != 0 {
                        continue;
                    }
                    let cz = if sz == 0 { bmin[2] } else { bmax[2] };
                    let m = [p0[0] - cx, p0[1] - cy, p0[2] - cz];
                    let qb = dot(m, d);
                    if qb >= 0.0 {
                        continue;
                    }
                    let qc = len_sq(m) - r2;
                    if qc <= 0.0 {
                        continue;
                    }
                    let disc = qb * qb - qa * qc;
                    if disc < 0.0 {
                        continue;
                    }
                    let t = (-qb - disc.sqrt()) / qa;
                    if t >= 0.0 && t <= best_t {
                        let raw_n = [
                            (m[0] + t * d[0]) / r,
                            (m[1] + t * d[1]) / r,
                            (m[2] + t * d[2]) / r,
                        ];
                        if let Some(n) = weld_voxel_normal(raw_n, mask) {
                            if dot(d, n) < 0.0 {
                                best_t = t;
                                best_n = n;
                                hit = true;
                            }
                        }
                    }
                }
            }
        }
    }

    if hit {
        Some((best_t, best_n, 0.0))
    } else {
        None
    }
}

/// Sweep a sphere from `p0` by `d` against all solid voxels along the swept bounding box.
fn sweep_voxels(
    p0: Vec3,
    d: Vec3,
    r: f32,
    surface: CourtSurface,
    solid: &mut impl FnMut([i32; 3]) -> bool,
    best: &mut Option<ToiCandidate>,
) {
    let (e_n, mu) = surface.params();
    let pad = r + 1e-4;
    let t_limit = best.map_or(1.0, |c| c.t);
    let p1 = add(p0, scale(d, t_limit));

    let min_x = (p0[0].min(p1[0]) - pad).floor() as i32;
    let max_x = (p0[0].max(p1[0]) + pad).floor() as i32;
    let min_y = (p0[1].min(p1[1]) - pad).floor() as i32;
    let max_y = (p0[1].max(p1[1]) + pad).floor() as i32;
    let min_z = (p0[2].min(p1[2]) - pad).floor() as i32;
    let max_z = (p0[2].max(p1[2]) + pad).floor() as i32;

    let vol = ((max_x - min_x + 1) as i64)
        .saturating_mul((max_y - min_y + 1) as i64)
        .saturating_mul((max_z - min_z + 1) as i64);

    if vol <= MAX_DIRECT_VOXELS {
        sweep_voxel_box(p0, d, r, [min_x, min_y, min_z], [max_x, max_y, max_z], e_n, mu, solid, best);
    } else {
        // Long supersonic segment: step along chunks of ~2 cells to stay O(length).
        let seg_len = len(scale(d, t_limit));
        let chunks = ((seg_len / 2.0).ceil() as i32).max(1);
        let inv_chunks = t_limit / (chunks as f32);
        for c in 0..chunks {
            let ta = (c as f32) * inv_chunks;
            if let Some(cur) = *best {
                if ta > cur.t {
                    break;
                }
            }
            let tb = ((c + 1) as f32) * inv_chunks;
            let pa = add(p0, scale(d, ta));
            let pb = add(p0, scale(d, tb));
            let lo = [
                (pa[0].min(pb[0]) - pad).floor() as i32,
                (pa[1].min(pb[1]) - pad).floor() as i32,
                (pa[2].min(pb[2]) - pad).floor() as i32,
            ];
            let hi = [
                (pa[0].max(pb[0]) + pad).floor() as i32,
                (pa[1].max(pb[1]) + pad).floor() as i32,
                (pa[2].max(pb[2]) + pad).floor() as i32,
            ];
            sweep_voxel_box(p0, d, r, lo, hi, e_n, mu, solid, best);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn sweep_voxel_box(
    p0: Vec3,
    d: Vec3,
    r: f32,
    lo: [i32; 3],
    hi: [i32; 3],
    e_n: f32,
    mu: f32,
    solid: &mut impl FnMut([i32; 3]) -> bool,
    best: &mut Option<ToiCandidate>,
) {
    let inflate = r + 1e-4;
    for iy in lo[1]..=hi[1] {
        let by0 = iy as f32 - inflate;
        let by1 = (iy + 1) as f32 + inflate;
        for iz in lo[2]..=hi[2] {
            let bz0 = iz as f32 - inflate;
            let bz1 = (iz + 1) as f32 + inflate;
            for ix in lo[0]..=hi[0] {
                let t_cur = best.map_or(1.0, |c| c.t);
                let bmin = [ix as f32 - inflate, by0, bz0];
                let bmax = [(ix + 1) as f32 + inflate, by1, bz1];
                if !ray_hits_aabb(p0, d, bmin, bmax, t_cur) {
                    continue;
                }
                if !solid([ix, iy, iz]) {
                    continue;
                }
                let mut mask = 0u8;
                if solid([ix - 1, iy, iz]) { mask |= 1; }
                if solid([ix + 1, iy, iz]) { mask |= 2; }
                if solid([ix, iy - 1, iz]) { mask |= 4; }
                if solid([ix, iy + 1, iz]) { mask |= 8; }
                if solid([ix, iy, iz - 1]) { mask |= 16; }
                if solid([ix, iy, iz + 1]) { mask |= 32; }

                if let Some((t, normal, penetration)) = swept_sphere_vs_voxel(p0, d, r, [ix, iy, iz], mask, t_cur) {
                    if best.map_or(true, |c| t < c.t) {
                        *best = Some(ToiCandidate {
                            t,
                            normal,
                            kind: ImpactKind::Voxel,
                            surf_vel: [0.0; 3],
                            e_n,
                            mu,
                            penetration,
                        });
                    }
                }
            }
        }
    }
}

/// Exact swept-sphere vs 3D line segment capsule (used for the net top tape/cord).
fn swept_sphere_vs_capsule(
    p0: Vec3,
    d: Vec3,
    seg_a: Vec3,
    seg_b: Vec3,
    comb_r: f32,
    t_best: f32,
) -> Option<(f32, Vec3, f32)> {
    let ab = sub(seg_b, seg_a);
    let ab2 = len_sq(ab);
    if ab2 <= 1e-12 {
        return None;
    }
    let comb_r2 = comb_r * comb_r;

    // Overlap check at t = 0.
    let ap0 = sub(p0, seg_a);
    let u0 = (dot(ap0, ab) / ab2).clamp(0.0, 1.0);
    let closest0 = add(seg_a, scale(ab, u0));
    let diff0 = sub(p0, closest0);
    let dist2_0 = len_sq(diff0);
    if dist2_0 < comb_r2 {
        let dist = dist2_0.sqrt();
        let n = if dist > 1e-6 {
            scale(diff0, 1.0 / dist)
        } else {
            [0.0, 1.0, 0.0]
        };
        if dot(d, n) < 0.0 {
            return Some((0.0, n, comb_r - dist));
        }
        return None;
    }

    let mut best_t = t_best;
    let mut best_n = [0.0; 3];
    let mut hit = false;

    // Infinite cylinder component perpendicular to segment axis.
    let inv_ab2 = 1.0 / ab2;
    let d_perp = sub(d, scale(ab, dot(d, ab) * inv_ab2));
    let m_perp = sub(ap0, scale(ab, dot(ap0, ab) * inv_ab2));
    let qa = len_sq(d_perp);
    let qb = dot(m_perp, d_perp);
    let qc = len_sq(m_perp) - comb_r2;
    if qa > 1e-12 && qb < 0.0 && qc > 0.0 {
        let disc = qb * qb - qa * qc;
        if disc >= 0.0 {
            let t = (-qb - disc.sqrt()) / qa;
            if t >= 0.0 && t <= best_t {
                let p = add(p0, scale(d, t));
                let u = dot(sub(p, seg_a), ab) * inv_ab2;
                if u >= 0.0 && u <= 1.0 {
                    let c = add(seg_a, scale(ab, u));
                    best_t = t;
                    best_n = normalize_or(sub(p, c), [0.0, 1.0, 0.0]);
                    hit = true;
                }
            }
        }
    }

    // Endcap spheres at seg_a and seg_b.
    let d2 = len_sq(d);
    if d2 > 1e-12 {
        for end in [seg_a, seg_b] {
            let m = sub(p0, end);
            let eb = dot(m, d);
            let ec = len_sq(m) - comb_r2;
            if eb < 0.0 && ec > 0.0 {
                let disc = eb * eb - d2 * ec;
                if disc >= 0.0 {
                    let t = (-eb - disc.sqrt()) / d2;
                    if t >= 0.0 && t <= best_t {
                        let p = add(p0, scale(d, t));
                        best_t = t;
                        best_n = normalize_or(sub(p, end), [0.0, 1.0, 0.0]);
                        hit = true;
                    }
                }
            }
        }
    }

    if hit {
        Some((best_t, best_n, 0.0))
    } else {
        None
    }
}

/// Sweep sphere against analytical court plane and net (top tape + compliant mesh).
fn sweep_court(p0: Vec3, d: Vec3, r: f32, court: &Court, best: &mut Option<ToiCandidate>) {
    let (e_n, mu) = court.surface.params();

    // 1. Ground plane y = ground_y.
    if let Some(gy) = court.ground_y {
        let target_y = gy + r;
        if p0[1] <= target_y && d[1] < 0.0 {
            let pen = (target_y - p0[1]).max(0.0);
            if best.map_or(true, |c| 0.0 < c.t) {
                *best = Some(ToiCandidate {
                    t: 0.0,
                    normal: [0.0, 1.0, 0.0],
                    kind: ImpactKind::Court,
                    surf_vel: [0.0; 3],
                    e_n,
                    mu,
                    penetration: pen,
                });
            }
        } else if d[1] < -1e-12 {
            let t = (target_y - p0[1]) / d[1];
            let t_cur = best.map_or(1.0, |c| c.t);
            if t >= 0.0 && t <= t_cur {
                *best = Some(ToiCandidate {
                    t,
                    normal: [0.0, 1.0, 0.0],
                    kind: ImpactKind::Court,
                    surf_vel: [0.0; 3],
                    e_n,
                    mu,
                    penetration: 0.0,
                });
            }
        }
    }

    if !court.net_enabled {
        return;
    }

    // Fast broadphase rejection when the swept sphere stays clear of the net plane z = net_z.
    let net_reach = r + court.net_tape_radius.max(court.net_mesh_half_thick) + 1e-3;
    let p1z = p0[2] + d[2];
    if p0[2].max(p1z) + net_reach < court.net_z || p0[2].min(p1z) - net_reach > court.net_z {
        return;
    }

    // 2. Net top tape (two slightly sloped capsules meeting at center x = 0).
    let left_post = [-court.net_half_span, court.net_base_y + court.net_post_height, court.net_z];
    let center_top = [0.0, court.net_base_y + court.net_center_height, court.net_z];
    let right_post = [court.net_half_span, court.net_base_y + court.net_post_height, court.net_z];
    let tape_r = r + court.net_tape_radius;

    for (a, b) in [(left_post, center_top), (center_top, right_post)] {
        let t_cur = best.map_or(1.0, |c| c.t);
        if let Some((t, normal, pen)) = swept_sphere_vs_capsule(p0, d, a, b, tape_r, t_cur) {
            if best.map_or(true, |c| t < c.t) {
                *best = Some(ToiCandidate {
                    t,
                    normal,
                    kind: ImpactKind::NetTape,
                    surf_vel: [0.0; 3],
                    e_n: 0.35,
                    mu: 0.30,
                    penetration: pen,
                });
            }
        }
    }

    // 3. Compliant net mesh slab at z = net_z ± net_mesh_half_thick.
    let slab_r = r + court.net_mesh_half_thick;
    let dz = p0[2] - court.net_z;
    if dz.abs() < slab_r {
        let n_z = if dz >= 0.0 { 1.0 } else { -1.0 };
        if d[2] * n_z < 0.0
            && p0[0].abs() <= court.net_half_span + r
            && p0[1] >= court.net_base_y
            && p0[1] <= court.net_height_at(p0[0]) - court.net_tape_radius * 0.5
        {
            let pen = slab_r - dz.abs();
            if best.map_or(true, |c| 0.0 < c.t) {
                *best = Some(ToiCandidate {
                    t: 0.0,
                    normal: [0.0, 0.0, n_z],
                    kind: ImpactKind::NetMesh,
                    surf_vel: [0.0; 3],
                    e_n: 0.08,
                    mu: 0.85,
                    penetration: pen,
                });
            }
        }
    } else if d[2].abs() > 1e-12 {
        let (target_z, n_z) = if d[2] > 0.0 {
            (court.net_z - slab_r, -1.0)
        } else {
            (court.net_z + slab_r, 1.0)
        };
        let t = (target_z - p0[2]) / d[2];
        let t_cur = best.map_or(1.0, |c| c.t);
        if t >= 0.0 && t <= t_cur {
            let px = p0[0] + t * d[0];
            let py = p0[1] + t * d[1];
            if px.abs() <= court.net_half_span + r
                && py >= court.net_base_y
                && py <= court.net_height_at(px) - court.net_tape_radius * 0.5
            {
                *best = Some(ToiCandidate {
                    t,
                    normal: [0.0, 0.0, n_z],
                    kind: ImpactKind::NetMesh,
                    surf_vel: [0.0; 3],
                    e_n: 0.08,
                    mu: 0.85,
                    penetration: 0.0,
                });
            }
        }
    }
}

/// Exact closest point on filled 2D ellipse `(x/a)² + (y/b)² <= 1` using strictly convex
/// Lagrange-multiplier Newton iteration (zero trig, converges to <1e-7 in 5 iterations).
#[inline]
fn closest_point_on_ellipse(x: f32, y: f32, a: f32, b: f32) -> (f32, f32) {
    let inv_a = 1.0 / a;
    let inv_b = 1.0 / b;
    let nx = x * inv_a;
    let ny = y * inv_b;
    if nx * nx + ny * ny <= 1.0 {
        return (x, y);
    }

    let ax = x.abs();
    let ay = y.abs();
    let a2 = a * a;
    let b2 = b * b;
    let a_ax = a * ax;
    let b_ay = b * ay;

    // Lower bound lambda0 with g(lambda0) >= 0; g is strictly decreasing and convex on [0, inf).
    let mut lam = (a_ax - a2).max(b_ay - b2).max(0.0);
    for _ in 0..6 {
        let da = a2 + lam;
        let db = b2 + lam;
        let ra = a_ax / da;
        let rb = b_ay / db;
        let g = ra * ra + rb * rb - 1.0;
        if g.abs() < 1e-7 {
            break;
        }
        let dg = -2.0 * (ra * ra / da + rb * rb / db);
        if dg.abs() < 1e-12 {
            break;
        }
        let next = lam - g / dg;
        lam = if next < 0.0 { 0.0 } else { next };
    }

    let ex = (a2 * ax) / (a2 + lam);
    let ey = (b2 * ay) / (b2 + lam);
    (ex.copysign(x), ey.copysign(y))
}

/// Closest point on oriented elliptic disk prism in its local frame `(a, b, z)`.
#[inline]
fn closest_point_on_racket_prism(u: Vec3, spec: &RacketSpec) -> Vec3 {
    let (ea, eb) = closest_point_on_ellipse(u[0], u[1], spec.semi_a, spec.semi_b);
    let ez = u[2].clamp(-spec.half_thick, spec.half_thick);
    [ea, eb, ez]
}

/// Exact swept-sphere vs moving & rotating elliptic disk prism via Mirtich/Redon Conservative
/// Advancement (mathematically zero-tunneling, purely algebraic).
#[allow(clippy::too_many_arguments)]
fn sweep_racket(
    p0: Vec3,
    dp: Vec3,
    ball_vel: Vec3,
    r: f32,
    pose0: RacketPose,
    pose1: RacketPose,
    spec: &RacketSpec,
    dt_sub: f32,
    best: &mut Option<ToiCandidate>,
) {
    let dc = sub(pose1.center, pose0.center);
    let max_rad = (spec.semi_a * spec.semi_a + spec.half_thick * spec.half_thick).sqrt();

    // Cheap broadphase: minimum distance between relative swept sphere path and racket bounding sphere.
    let t_limit = best.map_or(1.0, |c| c.t);
    let rel0 = sub(p0, pose0.center);
    let d_rel = sub(dp, dc);
    let d_rel2 = len_sq(d_rel);
    let s_closest = if d_rel2 > 1e-12 {
        (-dot(rel0, d_rel) / d_rel2).clamp(0.0, t_limit)
    } else {
        0.0
    };
    let min_sep = add(rel0, scale(d_rel, s_closest));
    let broad_r = max_rad + r + 1e-3;
    if len_sq(min_sep) > broad_r * broad_r {
        return;
    }

    // Shortest-arc alignment of q0 and q1.
    let q0 = pose0.quat;
    let raw_dot = q0[0] * pose1.quat[0] + q0[1] * pose1.quat[1] + q0[2] * pose1.quat[2] + q0[3] * pose1.quat[3];
    let q1 = if raw_dot < 0.0 {
        [-pose1.quat[0], -pose1.quat[1], -pose1.quat[2], -pose1.quat[3]]
    } else {
        pose1.quat
    };
    let cos_half = raw_dot.abs().min(1.0);

    // Rigorous algebraic upper bound on rotational point displacement over s in [0, 1] under NLERP.
    let dq = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2], q1[3] - q0[3]];
    let dq_len = (dq[0] * dq[0] + dq[1] * dq[1] + dq[2] * dq[2] + dq[3] * dq[3]).sqrt();
    let min_nlerp_norm = (0.5 * (1.0 + cos_half)).sqrt().max(0.5);
    let l_rot = 2.0 * max_rad * dq_len / min_nlerp_norm;

    // Compute racket linear & angular velocity for impact response (purely algebraic Pade angle).
    let inv_dt = if dt_sub > 1e-12 { 1.0 / dt_sub } else { 0.0 };
    let v_racket = scale(dc, inv_dt);
    let q_delta = quat_mul(q1, quat_conj(q0));
    let (qd_xyz, qd_w) = if q_delta[3] < 0.0 {
        ([-q_delta[0], -q_delta[1], -q_delta[2]], -q_delta[3])
    } else {
        ([q_delta[0], q_delta[1], q_delta[2]], q_delta[3])
    };
    // Snell/Pade algebraic approximation: theta = 2 * asin(|u|) ≈ 6 * |u| / (2 + w) (0.004% error at 30°).
    let rot_factor = (6.0 / (2.0 + qd_w)) * inv_dt;
    let w_racket = scale(qd_xyz, rot_factor);

    // Mirtich / Redon Conservative Advancement over s in [0, t_limit].
    let mut s = 0.0f32;
    for iter in 0..MAX_CA_ITERS {
        if s > t_limit {
            return;
        }
        let p_s = add(p0, scale(dp, s));
        let c_s = add(pose0.center, scale(dc, s));
        let q_s = quat_nlerp(q0, q1, s);
        let u = quat_inv_rotate(q_s, sub(p_s, c_s));
        let closest_local = closest_point_on_racket_prism(u, spec);
        let delta_local = sub(u, closest_local);
        let dist2 = len_sq(delta_local);
        let dist = dist2.sqrt();
        let phi = dist - r;

        if phi <= CA_TOI_EPS {
            // Compute outward contact normal in world space.
            let n_local = if dist > 1e-6 {
                scale(delta_local, 1.0 / dist)
            } else {
                // Sphere center penetrated inside thin prism: use face normal opposing approach.
                let v_rel_local = quat_inv_rotate(q_s, sub(ball_vel, v_racket));
                if u[2].abs() > 1e-5 {
                    [0.0, 0.0, if u[2] >= 0.0 { 1.0 } else { -1.0 }]
                } else {
                    [0.0, 0.0, if v_rel_local[2] <= 0.0 { 1.0 } else { -1.0 }]
                }
            };
            let n_world = normalize_or(quat_rotate(q_s, n_local), [0.0, 0.0, 1.0]);
            let contact_offset_world = quat_rotate(q_s, closest_local);
            let surf_vel = add(v_racket, cross(w_racket, contact_offset_world));
            let vn = dot(sub(ball_vel, surf_vel), n_world);

            // If touching at s = 0 and already separating, skip to prevent double-hit after bounce.
            if vn >= 0.0 {
                return;
            }

            let offset_a = closest_local[0] / spec.semi_a;
            let offset_b = closest_local[1] / spec.semi_b;
            let offset_norm = (offset_a * offset_a + offset_b * offset_b).sqrt().min(1.0);
            let e_n = spec.restitution_at(offset_norm);
            let pen = if phi < 0.0 { -phi } else { 0.0 };

            if best.map_or(true, |c| s < c.t) {
                *best = Some(ToiCandidate {
                    t: s,
                    normal: n_world,
                    kind: ImpactKind::Racket,
                    surf_vel,
                    e_n,
                    mu: spec.mu_string,
                    penetration: pen,
                });
            }
            return;
        }

        let n_world = quat_rotate(q_s, scale(delta_local, 1.0 / dist));
        let closing = -dot(d_rel, n_world);
        let rate = closing.max(0.0) + l_rot;
        if rate <= 1e-9 {
            return;
        }
        let ds = phi / rate;
        s += ds;

        // Safety valve if grazing a fast-rotating rim at tiny clearance.
        if iter + 1 == MAX_CA_ITERS && s <= t_limit && phi < 2e-3 && closing > 0.0 {
            let contact_offset_world = quat_rotate(q_s, closest_local);
            let surf_vel = add(v_racket, cross(w_racket, contact_offset_world));
            if dot(sub(ball_vel, surf_vel), n_world) < 0.0 && best.map_or(true, |c| s < c.t) {
                let offset_a = closest_local[0] / spec.semi_a;
                let offset_b = closest_local[1] / spec.semi_b;
                let offset_norm = (offset_a * offset_a + offset_b * offset_b).sqrt().min(1.0);
                *best = Some(ToiCandidate {
                    t: s,
                    normal: n_world,
                    kind: ImpactKind::Racket,
                    surf_vel,
                    e_n: spec.restitution_at(offset_norm),
                    mu: spec.mu_string,
                    penetration: 0.0,
                });
            }
        }
    }
}

// ── 480 Hz Micro-Substep Integrator ─────────────────────────────────────────

/// Step one ball forward by a single `1/120 s` tick (`4` × 480 Hz micro-substeps) with exact
/// swept-sphere TOI CCD against optional voxel world, optional court/net, and swept rackets.
pub fn step_ball_tick(
    ball: &mut SportsBall,
    court: Option<&Court>,
    rackets: &[RacketSwing],
    voxel_surface: CourtSurface,
    mut solid: impl FnMut([i32; 3]) -> bool,
    use_voxels: bool,
    mut impacts: Option<&mut Vec<ImpactEvent>>,
) {
    let inv_sub = 1.0 / (SUBSTEPS as f32);

    for sub_idx in 0..SUBSTEPS {
        let u0 = (sub_idx as f32) * inv_sub;
        let u1 = ((sub_idx + 1) as f32) * inv_sub;

        // 1. Apply aerodynamic drag, Magnus lift, spin decay, and gravity for this 480 Hz substep.
        integrate_aero_and_gravity(ball, SUBSTEP_DT);

        // 2. Continuous TOI loop over remaining fraction of the substep.
        let mut frac_elapsed = 0.0f32;
        for _ in 0..MAX_TOI_ITERS {
            let rem_frac = 1.0 - frac_elapsed;
            if rem_frac <= 1e-6 {
                break;
            }
            let dt_rem = SUBSTEP_DT * rem_frac;
            let p0 = ball.pos;
            let d = scale(ball.vel, dt_rem);
            let mut best: Option<ToiCandidate> = None;

            if let Some(c) = court {
                sweep_court(p0, d, ball.spec.radius, c, &mut best);
            }
            if use_voxels {
                sweep_voxels(p0, d, ball.spec.radius, voxel_surface, &mut solid, &mut best);
            }
            if !rackets.is_empty() {
                let ru0 = u0 + frac_elapsed * inv_sub;
                let ru1 = u1;
                for swing in rackets {
                    let (rp0, rp1) = swing.sub_slice(ru0, ru1);
                    sweep_racket(p0, d, ball.vel, ball.spec.radius, rp0, rp1, &swing.spec, dt_rem, &mut best);
                }
            }

            let Some(hit) = best else {
                ball.pos = add(p0, d);
                break;
            };

            // Advance to exact TOI and depenetrate slightly along contact normal.
            let push = hit.penetration + SKIN_EPS;
            ball.pos = add(add(p0, scale(d, hit.t)), scale(hit.normal, push));

            let speed_in = apply_slip_to_roll_impulse(ball, hit.normal, hit.surf_vel, hit.e_n, hit.mu);

            // Extra compliant energy absorption when slamming into the soft net mesh.
            if hit.kind == ImpactKind::NetMesh {
                let vn = dot(ball.vel, hit.normal);
                let vt = sub(ball.vel, scale(hit.normal, vn));
                ball.vel = add(scale(hit.normal, vn), scale(vt, 0.35));
                ball.spin = scale(ball.spin, 0.40);
            }

            if let Some(ref mut log) = impacts {
                log.push(ImpactEvent {
                    kind: hit.kind,
                    pos: ball.pos,
                    normal: hit.normal,
                    speed_in,
                });
            }

            frac_elapsed += hit.t * rem_frac;
            // Ensure progress if resolving a t = 0 overlap.
            if hit.t <= 1e-6 {
                frac_elapsed += 1e-4;
            }
        }
    }
}

// ── Compact 32-Byte Wire Snapshot & Deterministic Rollback Ring ─────────────

/// Deterministic ball state snapshot (`40` bytes in memory; encodes to exact `32` bytes on the wire).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BallSnapshot {
    pub tick: u32,
    pub pos: Vec3,
    pub vel: Vec3,
    pub spin: Vec3,
}

/// Encode `f32` into a 21-bit deterministic float: 1 sign + 6 exp (bias 31) + 14 mantissa.
/// Range ~`±2e9`, relative precision `2⁻¹⁴` (~0.006%, 32× finer than IEEE `f16`).
#[inline]
fn encode_f21(v: f32) -> u32 {
    if !v.is_finite() {
        return 0;
    }
    let bits = v.to_bits();
    let sign = (bits >> 31) & 1;
    let exp32 = ((bits >> 23) & 0xFF) as i32;
    let mant32 = bits & 0x7F_FFFF;

    if exp32 == 0 {
        return sign << 20;
    }

    // Rebias from IEEE f32 bias (127) to f21 bias (31): shift by -96.
    let exp21 = exp32 - 96;
    if exp21 <= 0 {
        return sign << 20;
    }
    if exp21 >= 63 {
        // Clamp to max finite magnitude.
        return (sign << 20) | (62 << 14) | 0x3FFF;
    }

    // Round-to-nearest-even from 23 mantissa bits down to 14 (drop 9 bits).
    let round_bit = (mant32 >> 8) & 1;
    let sticky = if (mant32 & 0xFF) != 0 { 1 } else { 0 };
    let lsb = (mant32 >> 9) & 1;
    let mut mant21 = (mant32 >> 9) + if round_bit != 0 && (sticky != 0 || lsb != 0) { 1 } else { 0 };
    let mut e = exp21 as u32;
    if mant21 >= (1 << 14) {
        mant21 = 0;
        e += 1;
        if e >= 63 {
            return (sign << 20) | (62 << 14) | 0x3FFF;
        }
    }
    (sign << 20) | (e << 14) | mant21
}

/// Decode a 21-bit deterministic float back to `f32`.
#[inline]
fn decode_f21(bits: u32) -> f32 {
    let sign = (bits >> 20) & 1;
    let exp21 = (bits >> 14) & 0x3F;
    let mant21 = bits & 0x3FFF;
    if exp21 == 0 {
        return f32::from_bits(sign << 31);
    }
    let exp32 = exp21 + 96;
    let mant32 = mant21 << 9;
    f32::from_bits((sign << 31) | (exp32 << 23) | mant32)
}

impl BallSnapshot {
    /// Wire size in bytes.
    pub const WIRE_BYTES: usize = 32;

    /// Pack into an exact 32-byte little-endian wire representation:
    /// - bytes `0..4`: `tick` (`u32`)
    /// - bytes `4..16`: `pos[0..3]` (full `f32`, zero position quantization error)
    /// - bytes `16..24`: `vel[0..3]` as 3 × 21-bit floats in one `u64`
    /// - bytes `24..32`: `spin[0..3]` as 3 × 21-bit floats in one `u64`
    pub fn to_bytes(&self) -> [u8; 32] {
        let mut out = [0u8; 32];
        out[0..4].copy_from_slice(&self.tick.to_le_bytes());
        out[4..8].copy_from_slice(&self.pos[0].to_le_bytes());
        out[8..12].copy_from_slice(&self.pos[1].to_le_bytes());
        out[12..16].copy_from_slice(&self.pos[2].to_le_bytes());

        let v_pack: u64 = (encode_f21(self.vel[0]) as u64)
            | ((encode_f21(self.vel[1]) as u64) << 21)
            | ((encode_f21(self.vel[2]) as u64) << 42);
        let w_pack: u64 = (encode_f21(self.spin[0]) as u64)
            | ((encode_f21(self.spin[1]) as u64) << 21)
            | ((encode_f21(self.spin[2]) as u64) << 42);

        out[16..24].copy_from_slice(&v_pack.to_le_bytes());
        out[24..32].copy_from_slice(&w_pack.to_le_bytes());
        out
    }

    /// Unpack from the 32-byte wire representation.
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        let tick = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        let px = f32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
        let py = f32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
        let pz = f32::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]);
        let v_pack = u64::from_le_bytes([
            bytes[16], bytes[17], bytes[18], bytes[19], bytes[20], bytes[21], bytes[22], bytes[23],
        ]);
        let w_pack = u64::from_le_bytes([
            bytes[24], bytes[25], bytes[26], bytes[27], bytes[28], bytes[29], bytes[30], bytes[31],
        ]);
        let mask21 = (1u64 << 21) - 1;
        Self {
            tick,
            pos: [px, py, pz],
            vel: [
                decode_f21((v_pack & mask21) as u32),
                decode_f21(((v_pack >> 21) & mask21) as u32),
                decode_f21(((v_pack >> 42) & mask21) as u32),
            ],
            spin: [
                decode_f21((w_pack & mask21) as u32),
                decode_f21(((w_pack >> 21) & mask21) as u32),
                decode_f21(((w_pack >> 42) & mask21) as u32),
            ],
        }
    }

    /// Check whether two snapshots agree within position, velocity, and spin tolerances.
    #[inline]
    pub fn within(&self, other: &Self, pos_eps: f32, vel_eps: f32, spin_eps: f32) -> bool {
        len_sq(sub(self.pos, other.pos)) <= pos_eps * pos_eps
            && len_sq(sub(self.vel, other.vel)) <= vel_eps * vel_eps
            && len_sq(sub(self.spin, other.spin)) <= spin_eps * spin_eps
    }
}

/// Outcome of reconciling an authoritative server snapshot against client prediction history.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ReconcileResult {
    /// Predicted state at `server_tick` matched within tolerance; no replay performed.
    Matched,
    /// Mismatch detected: rewound to `server_tick` and deterministically replayed `replayed_ticks`.
    Replayed {
        replayed_ticks: u32,
        final_state: BallSnapshot,
    },
    /// `server_tick` fell outside the stored ring window (too old or ahead of client).
    OutOfWindow,
}

#[derive(Clone, Copy, Debug)]
struct RingSlot<I> {
    valid: bool,
    tick: u32,
    input: I,
    state: BallSnapshot,
}

/// Fixed-capacity deterministic rollback ring buffer storing the last `CAP` ticks of ball state
/// and applied per-tick inputs (`CAP` typically 8 for 4–8 frame rollback or 16 for 100+ ms RTT).
#[derive(Clone, Debug)]
pub struct RollbackRing<const CAP: usize, I: Copy + Default> {
    slots: [RingSlot<I>; CAP],
    latest_tick: u32,
    has_any: bool,
}

impl<const CAP: usize, I: Copy + Default> Default for RollbackRing<CAP, I> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const CAP: usize, I: Copy + Default> RollbackRing<CAP, I> {
    pub fn new() -> Self {
        assert!(CAP > 0, "RollbackRing capacity must be non-zero");
        let empty = RingSlot {
            valid: false,
            tick: 0,
            input: I::default(),
            state: BallSnapshot {
                tick: 0,
                pos: [0.0; 3],
                vel: [0.0; 3],
                spin: [0.0; 3],
            },
        };
        Self {
            slots: [empty; CAP],
            latest_tick: 0,
            has_any: false,
        }
    }

    pub fn clear(&mut self) {
        for s in &mut self.slots {
            s.valid = false;
        }
        self.latest_tick = 0;
        self.has_any = false;
    }

    /// Record the `input` applied to reach `tick` and the resulting `state` at `tick`.
    pub fn record(&mut self, tick: u32, input: I, state: BallSnapshot) {
        let idx = (tick as usize) % CAP;
        self.slots[idx] = RingSlot {
            valid: true,
            tick,
            input,
            state,
        };
        if !self.has_any || tick >= self.latest_tick {
            self.latest_tick = tick;
            self.has_any = true;
        }
    }

    /// Read the stored snapshot at `tick`, if still within the ring window.
    pub fn get(&self, tick: u32) -> Option<BallSnapshot> {
        let slot = &self.slots[(tick as usize) % CAP];
        if slot.valid && slot.tick == tick {
            Some(slot.state)
        } else {
            None
        }
    }

    /// Current newest tick stored in the ring.
    pub fn latest_tick(&self) -> Option<u32> {
        self.has_any.then_some(self.latest_tick)
    }

    /// Reconcile an authoritative `server_snap` at `server_tick` against local prediction history.
    ///
    /// On mismatch beyond `(pos_eps, vel_eps, spin_eps)`, rewinds `ball` to `server_snap` and
    /// replays every tick `(server_tick + 1)..=latest_tick` via `replay_fn(&mut ball, tick, &input)`,
    /// updating the stored ring states along the way.
    pub fn reconcile(
        &mut self,
        ball: &mut SportsBall,
        server_tick: u32,
        server_snap: BallSnapshot,
        pos_eps: f32,
        vel_eps: f32,
        spin_eps: f32,
        mut replay_fn: impl FnMut(&mut SportsBall, u32, &I),
    ) -> ReconcileResult {
        if !self.has_any || server_tick > self.latest_tick {
            return ReconcileResult::OutOfWindow;
        }
        let span = self.latest_tick - server_tick;
        if (span as usize) >= CAP {
            return ReconcileResult::OutOfWindow;
        }
        let slot_idx = (server_tick as usize) % CAP;
        if !self.slots[slot_idx].valid || self.slots[slot_idx].tick != server_tick {
            return ReconcileResult::OutOfWindow;
        }

        if self.slots[slot_idx].state.within(&server_snap, pos_eps, vel_eps, spin_eps) {
            return ReconcileResult::Matched;
        }

        // Rewind to authoritative server state at server_tick.
        self.slots[slot_idx].state = server_snap;
        ball.apply_snapshot(&server_snap);

        // Deterministically replay every subsequent tick up to latest_tick.
        for t in (server_tick + 1)..=self.latest_tick {
            let idx = (t as usize) % CAP;
            let input = if self.slots[idx].valid && self.slots[idx].tick == t {
                self.slots[idx].input
            } else {
                I::default()
            };
            replay_fn(ball, t, &input);
            let snap = ball.snapshot(t);
            self.slots[idx] = RingSlot {
                valid: true,
                tick: t,
                input,
                state: snap,
            };
        }

        ReconcileResult::Replayed {
            replayed_ticks: span,
            final_state: ball.snapshot(self.latest_tick),
        }
    }
}

// ── Multi-Ball World Container (for WASM Instance & Tests) ──────────────────

/// Default per-tick input stored in `SportsWorld`'s rollback ring (at most one active racket
/// swing per tick in the compact WASM path).
#[derive(Clone, Copy, Debug, Default)]
pub struct TickRacketInput {
    pub active: bool,
    pub swing: Option<RacketSwing>,
}

struct BallEntry {
    id: u32,
    ball: SportsBall,
    ring: RollbackRing<16, TickRacketInput>,
}

/// Stateful sports simulation container held inside the WASM `Instance`.
pub struct SportsWorld {
    pub tick: u32,
    pub court: Option<Court>,
    pub voxel_surface: CourtSurface,
    next_id: u32,
    balls: Vec<BallEntry>,
    pending_rackets: Vec<RacketSwing>,
    /// Reusable buffer for `sports_ball_read` (`[px, py, pz, vx, vy, vz, wx, wy, wz]`).
    pub read_buf: [f32; 9],
    /// Reusable buffer for 32-byte wire snapshot I/O.
    pub snap_buf: [u8; 32],
}

impl Default for SportsWorld {
    fn default() -> Self {
        Self::new()
    }
}

impl SportsWorld {
    pub fn new() -> Self {
        Self {
            tick: 0,
            court: None,
            voxel_surface: CourtSurface::Hard,
            next_id: 1,
            balls: Vec::new(),
            pending_rackets: Vec::new(),
            read_buf: [0.0; 9],
            snap_buf: [0u8; 32],
        }
    }

    pub fn reset(&mut self) {
        self.tick = 0;
        self.next_id = 1;
        self.balls.clear();
        self.pending_rackets.clear();
    }

    pub fn set_court(&mut self, surface: CourtSurface, ground_y: f32, net_z: f32, enabled: bool) {
        self.voxel_surface = surface;
        self.court = if enabled {
            Some(Court::regulation(surface, ground_y, net_z))
        } else {
            None
        };
    }

    pub fn spawn(&mut self, pos: Vec3, vel: Vec3, spin: Vec3) -> u32 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        let ball = SportsBall::new_tennis(pos, vel, spin);
        let mut ring = RollbackRing::<16, TickRacketInput>::new();
        ring.record(self.tick, TickRacketInput::default(), ball.snapshot(self.tick));
        self.balls.push(BallEntry { id, ball, ring });
        id
    }

    pub fn remove(&mut self, id: u32) -> bool {
        if let Some(i) = self.balls.iter().position(|e| e.id == id) {
            self.balls.swap_remove(i);
            true
        } else {
            false
        }
    }

    pub fn count(&self) -> usize {
        self.balls.len()
    }

    pub fn queue_racket(&mut self, swing: RacketSwing) {
        self.pending_rackets.push(swing);
    }

    pub fn step(&mut self, ticks: u32, use_voxels: bool, mut solid: impl FnMut([i32; 3]) -> bool) -> u32 {
        for step_i in 0..ticks {
            self.tick = self.tick.wrapping_add(1);
            let rackets: &[RacketSwing] = if step_i == 0 {
                &self.pending_rackets
            } else {
                &[]
            };
            let input = TickRacketInput {
                active: !rackets.is_empty(),
                swing: rackets.first().copied(),
            };
            let court = self.court.as_ref();
            let surf = self.voxel_surface;
            for entry in &mut self.balls {
                step_ball_tick(&mut entry.ball, court, rackets, surf, &mut solid, use_voxels, None);
                let snap = entry.ball.snapshot(self.tick);
                entry.ring.record(self.tick, input, snap);
            }
        }
        self.pending_rackets.clear();
        self.tick
    }

    pub fn read_ball(&mut self, id: u32) -> Option<*const f32> {
        let entry = self.balls.iter().find(|e| e.id == id)?;
        self.read_buf = [
            entry.ball.pos[0],
            entry.ball.pos[1],
            entry.ball.pos[2],
            entry.ball.vel[0],
            entry.ball.vel[1],
            entry.ball.vel[2],
            entry.ball.spin[0],
            entry.ball.spin[1],
            entry.ball.spin[2],
        ];
        Some(self.read_buf.as_ptr())
    }

    pub fn write_snapshot(&mut self, id: u32) -> Option<*const u8> {
        let entry = self.balls.iter().find(|e| e.id == id)?;
        let snap = entry.ball.snapshot(self.tick);
        self.snap_buf = snap.to_bytes();
        Some(self.snap_buf.as_ptr())
    }

    pub fn rollback_from_buf(&mut self, id: u32, use_voxels: bool, mut solid: impl FnMut([i32; 3]) -> bool) -> i32 {
        let server_snap = BallSnapshot::from_bytes(self.snap_buf);
        let court = self.court;
        let surf = self.voxel_surface;
        let Some(entry) = self.balls.iter_mut().find(|e| e.id == id) else {
            return -1;
        };
        let res = entry.ring.reconcile(
            &mut entry.ball,
            server_snap.tick,
            server_snap,
            1e-3,
            5e-2,
            5e-2,
            |b, _t, inp| {
                let slice: &[RacketSwing] = match &inp.swing {
                    Some(s) if inp.active => core::slice::from_ref(s),
                    _ => &[],
                };
                step_ball_tick(b, court.as_ref(), slice, surf, &mut solid, use_voxels, None);
            },
        );
        match res {
            ReconcileResult::Matched => 0,
            ReconcileResult::Replayed { replayed_ticks, .. } => replayed_ticks as i32,
            ReconcileResult::OutOfWindow => -1,
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic SplitMix64 PRNG for repeatable stress tests.
    struct Rng(u64);
    impl Rng {
        fn next_u64(&mut self) -> u64 {
            self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            z ^ (z >> 31)
        }
        fn f32(&mut self) -> f32 {
            ((self.next_u64() >> 40) as f32) * (1.0 / ((1u32 << 24) as f32))
        }
        fn range(&mut self, lo: f32, hi: f32) -> f32 {
            lo + (hi - lo) * self.f32()
        }
    }

    /// 1. Zero-tunneling stress test:
    ///    1,000 randomized 200+ km/h (55.6+ m/s = 556+ cells/s) serves fired at:
    ///    (a) a 1-cell-thick voxel wall, and
    ///    (b) a thin moving & rotating elliptic racket (`half_thick = 0.08 cells`).
    ///    Assert 0 / 1,000 tunnels in both cases.
    #[test]
    fn zero_tunneling_200kmh_voxel_wall_and_moving_racket() {
        let mut rng = Rng(0x1660_7E11_5E4E);
        let speed_200 = kmh_to_cells_per_s(200.0); // 555.56 cells/s

        // (a) 1,000 serves vs 1-cell-thick voxel wall at iz == 10 (z in [10.0, 11.0]).
        let mut wall_tunnels = 0usize;
        for _ in 0..1000 {
            let speed = speed_200 * rng.range(1.0, 1.25); // 200..250 km/h
            let vx = rng.range(-60.0, 60.0);
            let vy = rng.range(-40.0, 40.0);
            let vz = (speed * speed - vx * vx - vy * vy).sqrt();
            let start_z = rng.range(2.0, 8.5);
            let mut ball = SportsBall::new_tennis(
                [rng.range(-5.0, 5.0), rng.range(6.0, 18.0), start_z],
                [vx, vy, vz],
                [rng.range(-300.0, 300.0), rng.range(-200.0, 200.0), rng.range(-200.0, 200.0)],
            );

            let mut tunneled = false;
            for _ in 0..8 {
                step_ball_tick(
                    &mut ball,
                    None,
                    &[],
                    CourtSurface::Hard,
                    |[ix, iy, iz]| iz == 10 && ix >= -30 && ix <= 30 && iy >= 0 && iy <= 40,
                    true,
                    None,
                );
                if ball.pos[2] > 10.0 {
                    tunneled = true;
                    break;
                }
            }
            if tunneled {
                wall_tunnels += 1;
            }
        }
        assert_eq!(wall_tunnels, 0, "expected 0/1000 tunnels through 1-cell voxel wall");

        // (b) 1,000 serves vs thin moving & rotating racket (`half_thick = 0.08` cells).
        let mut racket_tunnels = 0usize;
        for _ in 0..1000 {
            let speed = speed_200 * rng.range(1.0, 1.25); // 200..250 km/h
            // Aim ball through a random point inside the central 75% of the racket ellipse.
            let target_x = rng.range(-0.9, 0.9);
            let target_y = 10.0 + rng.range(-0.7, 0.7);
            // Randomize starting phase so impact lands anywhere inside the tick & substeps.
            let dt_to_hit = rng.range(0.0005, TICK_DT * 0.85);
            let vz = speed;
            let start_z = -vz * dt_to_hit;
            let mut ball = SportsBall::new_tennis(
                [target_x, target_y, start_z],
                [rng.range(-10.0, 10.0), rng.range(-10.0, 10.0), vz],
                [rng.range(-200.0, 200.0), 0.0, 0.0],
            );

            // Moving & slightly rotating racket sweeping toward the ball along -Z.
            let rz_vel = rng.range(-220.0, -40.0); // 14..79 km/h swing toward incoming serve
            let r_start_z = -rz_vel * dt_to_hit;
            let r_end_z = r_start_z + rz_vel * TICK_DT;
            let tilt_x0 = rng.range(-0.12, 0.12);
            let tilt_y0 = rng.range(-0.12, 0.12);
            let tilt_x1 = tilt_x0 + rng.range(-0.08, 0.08);
            let tilt_y1 = tilt_y0 + rng.range(-0.08, 0.08);

            let prev = RacketPose::from_normal([0.0, 10.0, r_start_z], [tilt_x0, tilt_y0, -1.0], [0.0, 1.0, 0.0]);
            let curr = RacketPose::from_normal([0.0, 10.0, r_end_z], [tilt_x1, tilt_y1, -1.0], [0.0, 1.0, 0.0]);
            let swing = RacketSwing::new(prev, curr);

            let mut impacts = Vec::new();
            step_ball_tick(
                &mut ball,
                None,
                &[swing],
                CourtSurface::Hard,
                |_| false,
                false,
                Some(&mut impacts),
            );

            let hit_racket = impacts.iter().any(|e| e.kind == ImpactKind::Racket);
            if !hit_racket || ball.vel[2] >= 0.0 {
                racket_tunnels += 1;
            }
        }
        assert_eq!(racket_tunnels, 0, "expected 0/1000 tunnels through thin moving racket");
    }

    /// 2. Coplanar voxel seam welding test:
    ///    100 low-angle skimming bounces across a flat 10 cm voxel court — assert zero phantom
    ///    vertical-seam deflections (every bounce normal == `[0, 1, 0]`).
    #[test]
    fn coplanar_voxel_seam_welding_flat_court() {
        let mut rng = Rng(0xC091_A4A2);
        let mut total_bounces = 0usize;

        for _ in 0..100 {
            let x0 = rng.range(-20.0, 20.0);
            let z0 = rng.range(-20.0, 20.0);
            let y0 = 1.0 + BallSpec::TENNIS.radius + rng.range(0.02, 0.6);
            // Low-angle skimming shot (shallow downward angle, fast horizontal sweep across many seams).
            let vx = rng.range(180.0, 420.0);
            let vz = rng.range(-250.0, 250.0);
            let vy = rng.range(-35.0, -8.0);
            let mut ball = SportsBall::new_tennis([x0, y0, z0], [vx, vy, vz], [0.0, 0.0, rng.range(-200.0, 200.0)]);

            let mut impacts = Vec::new();
            for _ in 0..60 {
                step_ball_tick(
                    &mut ball,
                    None,
                    &[],
                    CourtSurface::Hard,
                    |[_ix, iy, _iz]| iy <= 0, // Infinite flat 10 cm voxel court with top at y = 1.0
                    true,
                    Some(&mut impacts),
                );
            }

            assert!(!impacts.is_empty(), "expected at least one bounce per skimming shot");
            for ev in &impacts {
                assert_eq!(ev.kind, ImpactKind::Voxel);
                assert_eq!(
                    ev.normal,
                    [0.0, 1.0, 0.0],
                    "phantom seam normal {:?} at pos {:?}",
                    ev.normal,
                    ev.pos
                );
            }
            total_bounces += impacts.len();
        }
        assert!(total_bounces >= 100);
    }

    /// 3. Magnus aerodynamics test:
    ///    Identical launch speed with heavy topspin (+350 rad/s) vs flat (0) vs backspin (-350 rad/s).
    ///    Verify topspin lands significantly shorter/steeper and backspin carries significantly further.
    #[test]
    fn magnus_aerodynamics_topspin_vs_flat_vs_backspin() {
        let simulate_landing = |spin_z: f32| -> (f32, f32, f32) {
            // Launch a tennis groundstroke along +X from y = 12 cells (1.2 m) at ~26 m/s (260 cells/s).
            // Moving in +X: topspin has spin = (0, 0, -omega) so omega x v points -Y (downward);
            // backspin has spin = (0, 0, +omega) so omega x v points +Y (upward).
            let mut ball = SportsBall::new_tennis([0.0, 12.0, 0.0], [260.0, 25.0, 0.0], [0.0, 0.0, spin_z]);
            let court = Court::plane_only(CourtSurface::Hard, 0.0);
            let mut impacts = Vec::new();
            for _ in 0..600 {
                let pre_vx = ball.vel[0];
                step_ball_tick(&mut ball, Some(&court), &[], CourtSurface::Hard, |_| false, false, Some(&mut impacts));
                if let Some(first) = impacts.first() {
                    let landing_x = first.pos[0];
                    // Pre-bounce entry steepness: downward impact speed / incoming horizontal speed.
                    let steepness = first.speed_in / pre_vx.abs().max(1.0);
                    return (landing_x, steepness, first.speed_in);
                }
            }
            panic!("ball never landed");
        };

        let (x_top, steep_top, vy_top) = simulate_landing(-350.0); // heavy topspin (350 rad/s)
        let (x_flat, steep_flat, vy_flat) = simulate_landing(0.0); // flat
        let (x_back, _steep_back, vy_back) = simulate_landing(350.0); // heavy backspin (350 rad/s)

        assert!(
            x_top + 20.0 < x_flat,
            "topspin ({x_top:.1}) should land significantly shorter than flat ({x_flat:.1})"
        );
        assert!(
            x_back > x_flat + 30.0,
            "backspin ({x_back:.1}) should carry significantly further than flat ({x_flat:.1})"
        );
        assert!(
            steep_top > steep_flat,
            "topspin ({steep_top:.3}) should enter steeper than flat ({steep_flat:.3})"
        );
        assert!(
            vy_top > vy_flat && vy_flat > vy_back,
            "downward impact speed should order topspin ({vy_top:.1}) > flat ({vy_flat:.1}) > backspin ({vy_back:.1})"
        );
    }

    /// 4. Cross / Brody slip-to-roll bounce test:
    ///    Verify topspin kicks forward faster on grass than clay, topspin kicks faster than flat,
    ///    and high-spin backspin slows/checks hard on clay.
    #[test]
    fn slip_to_roll_bounce_grass_vs_clay_and_backspin_bite() {
        // Topspin rally shot hitting grass vs clay.
        let bounce_on = |surface: CourtSurface, vel: Vec3, spin: Vec3| -> SportsBall {
            let mut ball = SportsBall::new_tennis([0.0, BallSpec::TENNIS.radius + 0.01, 0.0], vel, spin);
            let (e_n, mu) = surface.params();
            apply_slip_to_roll_impulse(&mut ball, [0.0, 1.0, 0.0], [0.0; 3], e_n, mu);
            ball
        };

        let rally_v = [250.0, -70.0, 0.0]; // 25 m/s forward, 7 m/s downward
        let topspin = [0.0, 0.0, -250.0];  // ~2,387 RPM topspin

        let grass_top = bounce_on(CourtSurface::Grass, rally_v, topspin);
        let clay_top = bounce_on(CourtSurface::Clay, rally_v, topspin);
        let clay_flat = bounce_on(CourtSurface::Clay, rally_v, [0.0, 0.0, 0.0]);

        assert!(
            grass_top.vel[0] > clay_top.vel[0] + 10.0,
            "topspin should retain higher forward speed on grass ({:.1}) than clay ({:.1})",
            grass_top.vel[0],
            clay_top.vel[0]
        );
        assert!(
            grass_top.vel[1] < clay_top.vel[1],
            "grass bounce should stay lower ({:.1}) than clay ({:.1})",
            grass_top.vel[1],
            clay_top.vel[1]
        );
        assert!(
            clay_top.vel[0] > clay_flat.vel[0] + 25.0,
            "topspin ({:.1}) should kick forward faster than flat ({:.1}) on clay",
            clay_top.vel[0],
            clay_flat.vel[0]
        );

        // High-spin backspin drop shot checking/biting hard on clay.
        let drop_v = [100.0, -80.0, 0.0]; // 10 m/s forward, 8 m/s downward
        let heavy_backspin = [0.0, 0.0, 420.0]; // ~4,010 RPM backspin
        let clay_back = bounce_on(CourtSurface::Clay, drop_v, heavy_backspin);
        let grass_back = bounce_on(CourtSurface::Grass, drop_v, heavy_backspin);

        assert!(
            clay_back.vel[0] < 10.0,
            "heavy backspin on clay should check/bite dramatically (got vx = {:.1} cells/s)",
            clay_back.vel[0]
        );
        assert!(
            clay_back.vel[0] < grass_back.vel[0] - 25.0,
            "backspin should check much harder on clay ({:.1}) than grass ({:.1})",
            clay_back.vel[0],
            grass_back.vel[0]
        );
    }

    /// 5. Racket brushing topspin test:
    ///    Upward-brushing racket swing imparts > 200 rad/s topspin to an incoming flat ball,
    ///    and sweet-spot center returns higher speed than off-center rim contact.
    #[test]
    fn racket_brushing_imparts_topspin_and_sweet_spot_profile() {
        // Incoming flat ball traveling in -X at 15 m/s (`-150 cells/s`).
        let mut ball = SportsBall::new_tennis([1.5, 10.0, 0.0], [-150.0, 0.0, 0.0], [0.0, 0.0, 0.0]);
        // Racket swings forward (+X at 20 m/s) and upward (+Y at 20 m/s) across the tick.
        let prev = RacketPose::from_normal([0.0, 9.2, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]);
        let curr = RacketPose::from_normal(
            [200.0 * TICK_DT, 9.2 + 200.0 * TICK_DT, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        );
        let swing = RacketSwing::new(prev, curr);
        let mut impacts = Vec::new();
        step_ball_tick(&mut ball, None, &[swing], CourtSurface::Hard, |_| false, false, Some(&mut impacts));

        assert!(impacts.iter().any(|e| e.kind == ImpactKind::Racket), "expected racket impact");
        assert!(ball.vel[0] > 200.0, "ball should be driven forward along +X (got {:.1})", ball.vel[0]);
        // Moving in +X, topspin is negative Z angular velocity.
        let topspin_rad_s = -ball.spin[2];
        assert!(
            topspin_rad_s > 200.0,
            "expected > 200 rad/s topspin from upward-brushing swing, got {:.1} rad/s ({:.0} RPM)",
            topspin_rad_s,
            rad_s_to_rpm(topspin_rad_s)
        );

        // Sweet-spot vs rim restitution check.
        let mut center_ball = SportsBall::new_tennis([0.8, 10.0, 0.0], [-200.0, 0.0, 0.0], [0.0; 3]);
        let mut rim_ball = SportsBall::new_tennis([0.8, 11.15, 0.0], [-200.0, 0.0, 0.0], [0.0; 3]);
        let static_racket = RacketSwing::new(
            RacketPose::from_normal([0.0, 10.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
            RacketPose::from_normal([0.0, 10.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
        );
        step_ball_tick(&mut center_ball, None, &[static_racket], CourtSurface::Hard, |_| false, false, None);
        step_ball_tick(&mut rim_ball, None, &[static_racket], CourtSurface::Hard, |_| false, false, None);
        assert!(
            center_ball.vel[0] > rim_ball.vel[0] + 25.0,
            "sweet-spot return ({:.1}) should exceed rim return ({:.1})",
            center_ball.vel[0],
            rim_ball.vel[0]
        );
    }

    /// 6. Net tape & compliant mesh test:
    ///    Verify a low shot into the net mesh loses energy and drops in front of the net,
    ///    and a 32-byte snapshot round-trips accurately.
    #[test]
    fn net_mesh_damping_and_snapshot_32_byte_roundtrip() {
        let court = Court::regulation(CourtSurface::Hard, 0.0, 0.0);
        let mut ball = SportsBall::new_tennis([0.0, 4.0, -5.0], [0.0, 0.0, 500.0], [200.0, 0.0, 0.0]);
        let mut impacts = Vec::new();
        for _ in 0..6 {
            step_ball_tick(&mut ball, Some(&court), &[], CourtSurface::Hard, |_| false, false, Some(&mut impacts));
        }
        assert!(impacts.iter().any(|e| e.kind == ImpactKind::NetMesh), "expected net mesh impact");
        assert!(ball.pos[2] < 0.0, "ball should not pass through net mesh");
        assert!(len(ball.vel) < 120.0, "compliant net mesh should heavily damp a 500 cells/s shot (got {:.1})", len(ball.vel));

        // 32-byte wire encoding roundtrip.
        let snap = BallSnapshot {
            tick: 123_456,
            pos: [12_345.678, 98.765, -43_210.125],
            vel: [555.56, -123.45, 0.0125],
            spin: [-380.25, 42.5, 310.75],
        };
        let bytes = snap.to_bytes();
        assert_eq!(bytes.len(), 32);
        let decoded = BallSnapshot::from_bytes(bytes);
        assert_eq!(decoded.tick, snap.tick);
        assert_eq!(decoded.pos, snap.pos);
        assert!(snap.within(&decoded, 0.0, 0.05, 0.05), "wire quantization exceeded tolerance: {:?}", decoded);
    }

    /// 7. Rollback convergence test:
    ///    Simulate 100 ms RTT (12 ticks at 120 Hz) with a client-predicted hit vs server-confirmed
    ///    correction — verify deterministic convergence to the exact server trajectory (both for
    ///    in-memory snapshots and 32-byte wire snapshots).
    #[test]
    fn rollback_100ms_rtt_deterministic_convergence() {
        let court = Court::regulation(CourtSurface::Clay, 0.0, 0.0);
        let initial = SportsBall::new_tennis([0.0, 12.0, -25.0], [15.0, 35.0, 320.0], [-220.0, 0.0, 0.0]);

        // Authoritative server: opponent hits the ball slightly differently at tick 2.
        let server_swing = RacketSwing::new(
            RacketPose::from_normal([0.0, 12.5, -19.0], [0.0, 0.1, -1.0], [0.0, 1.0, 0.0]),
            RacketPose::from_normal([0.0, 13.0, -20.5], [0.0, 0.15, -1.0], [0.0, 1.0, 0.0]),
        );
        // Client mispredicted no racket at tick 2 (or wrong timing), then swung its own racket at tick 9.
        let client_tick9_swing = RacketSwing::new(
            RacketPose::from_normal([0.5, 11.0, -40.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]),
            RacketPose::from_normal([0.5, 11.8, -38.5], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]),
        );

        let mut server_ball = initial;
        let mut client_ball = initial;
        let mut ring = RollbackRing::<16, Option<RacketSwing>>::new();
        ring.record(0, None, client_ball.snapshot(0));

        let mut server_snap_tick2 = None;

        // Run 14 ticks (server_tick = 2 arrives at client tick 14 => 12 ticks = 100 ms RTT!).
        for tick in 1..=14u32 {
            let srv_input = if tick == 2 {
                Some(server_swing)
            } else if tick == 9 {
                Some(client_tick9_swing)
            } else {
                None
            };
            let cli_input = if tick == 9 { Some(client_tick9_swing) } else { None };

            let srv_slice: &[RacketSwing] = srv_input.as_ref().map_or(&[], core::slice::from_ref);
            let cli_slice: &[RacketSwing] = cli_input.as_ref().map_or(&[], core::slice::from_ref);

            step_ball_tick(&mut server_ball, Some(&court), srv_slice, CourtSurface::Clay, |_| false, false, None);
            if tick == 2 {
                server_snap_tick2 = Some(server_ball.snapshot(2));
            }

            step_ball_tick(&mut client_ball, Some(&court), cli_slice, CourtSurface::Clay, |_| false, false, None);
            ring.record(tick, cli_input, client_ball.snapshot(tick));
        }

        // Before rollback, client and server have diverged wildly.
        let pre_err = len(sub(client_ball.pos, server_ball.pos));
        assert!(pre_err > 20.0, "expected large divergence before rollback (got {pre_err:.2})");

        // Reconcile with exact server snapshot from 12 ticks ago (100 ms RTT).
        let snap2 = server_snap_tick2.unwrap();
        let mut ring_wire = ring.clone();
        let mut client_wire = client_ball;

        let res = ring.reconcile(&mut client_ball, 2, snap2, 1e-4, 1e-4, 1e-4, |b, _t, inp| {
            let slice: &[RacketSwing] = inp.as_ref().map_or(&[], core::slice::from_ref);
            step_ball_tick(b, Some(&court), slice, CourtSurface::Clay, |_| false, false, None);
        });

        match res {
            ReconcileResult::Replayed { replayed_ticks, final_state } => {
                assert_eq!(replayed_ticks, 12);
                assert_eq!(final_state.pos, server_ball.pos, "expected bit-exact pos convergence");
                assert_eq!(final_state.vel, server_ball.vel, "expected bit-exact vel convergence");
                assert_eq!(final_state.spin, server_ball.spin, "expected bit-exact spin convergence");
            }
            other => panic!("expected Replayed(12), got {other:?}"),
        }

        // Reconcile via 32-byte wire round-trip and confirm tight sub-millimetre convergence.
        let wire_snap2 = BallSnapshot::from_bytes(snap2.to_bytes());
        let wire_res = ring_wire.reconcile(&mut client_wire, 2, wire_snap2, 1e-3, 1e-2, 1e-2, |b, _t, inp| {
            let slice: &[RacketSwing] = inp.as_ref().map_or(&[], core::slice::from_ref);
            step_ball_tick(b, Some(&court), slice, CourtSurface::Clay, |_| false, false, None);
        });
        assert!(matches!(wire_res, ReconcileResult::Replayed { replayed_ticks: 12, .. }));
        let wire_pos_err = len(sub(client_wire.pos, server_ball.pos));
        assert!(
            wire_pos_err < 0.01,
            "32-byte wire rollback should converge within 1 mm (0.01 cells), got {wire_pos_err:.5} cells"
        );
    }

    /// 8. Performance benchmark test:
    ///    Stepping 20 active tennis balls for 1 full second (120 ticks = 480 substeps each)
    ///    takes < 0.5 ms total in release mode.
    #[test]
    fn perf_20_active_balls_1s_under_half_ms() {
        let court = Court::regulation(CourtSurface::Hard, 0.0, 0.0);
        let mut balls: Vec<SportsBall> = (0..20)
            .map(|i| {
                let f = i as f32;
                SportsBall::new_tennis(
                    [-30.0 + f * 3.0, 15.0 + (f % 4.0) * 2.0, -80.0 + (f % 5.0) * 10.0],
                    [20.0 + f * 4.0, 30.0 + (f % 3.0) * 15.0, 320.0 + f * 8.0],
                    [-260.0 + f * 15.0, 20.0, 15.0],
                )
            })
            .collect();

        // Warmup run so branch predictors and caches are hot.
        let mut warm = balls.clone();
        for _ in 0..10 {
            for b in &mut warm {
                step_ball_tick(b, Some(&court), &[], CourtSurface::Hard, |_| false, false, None);
            }
        }

        let start = std::time::Instant::now();
        for _ in 0..TICK_HZ {
            for b in &mut balls {
                step_ball_tick(b, Some(&court), &[], CourtSurface::Hard, |_| false, false, None);
            }
        }
        let elapsed = start.elapsed();
        let elapsed_ms = elapsed.as_secs_f64() * 1000.0;

        // Prevent dead-code elimination.
        let checksum: f32 = balls.iter().map(|b| b.pos[0] + b.pos[1] + b.pos[2]).sum();
        assert!(checksum.is_finite());
        eprintln!("[sports perf] 20 active balls x 1s (120 ticks / 480 substeps): {elapsed_ms:.4} ms");

        // Enforce strict < 0.5 ms budget under release optimization (`!cfg!(debug_assertions)`).
        if !cfg!(debug_assertions) {
            assert!(
                elapsed_ms < 0.5,
                "20 balls x 1s (120 ticks / 480 substeps) took {elapsed_ms:.3} ms (budget < 0.5 ms)"
            );
        }
    }

    /// 9. SportsWorld container lifecycle (spawn, swing, step, 32-byte snapshot, rollback, remove).
    #[test]
    fn sports_world_api_lifecycle() {
        let mut w = SportsWorld::new();
        w.set_court(CourtSurface::Grass, 0.0, 0.0, true);
        let id = w.spawn([0.0, 12.0, -10.0], [0.0, 10.0, 250.0], [-200.0, 0.0, 0.0]);
        assert_eq!(w.count(), 1);
        assert!(w.read_ball(id).is_some());

        let tick2 = w.step(2, false, |_| false);
        assert_eq!(tick2, 2);
        assert!(w.write_snapshot(id).is_some());
        let snap_at_2 = w.snap_buf;

        let tick5 = w.step(3, false, |_| false);
        assert_eq!(tick5, 5);
        // Reconciling with exact 32-byte snapshot from tick 2 should match cleanly.
        w.snap_buf = snap_at_2;
        assert_eq!(w.rollback_from_buf(id, false, |_| false), 0);

        // Mutate server state at tick 2 and confirm rollback replays 3 ticks forward to tick 5.
        let mut mutated = BallSnapshot::from_bytes(snap_at_2);
        mutated.pos[1] += 0.5;
        w.snap_buf = mutated.to_bytes();
        assert_eq!(w.rollback_from_buf(id, false, |_| false), 3);

        assert!(w.remove(id));
        assert_eq!(w.count(), 0);
    }
}
