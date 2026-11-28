//! Thin wasm exports over the melee and lightsaber engine (`melee.rs`, #166): one thread-local arena
//! of weapons, a packed event buffer and the cooling plasma-kerf glow, for the page or a worker.
//!
//! The arena is its own `thread_local!` so it adds no field to the core's `Instance`. It meets the
//! world through `melee_set_ground`: no ground, a flat plane, or the solver's own cells (the bodies
//! of this instance, borrowed once a step). Cells a blade has carved or crushed are kept as empty
//! until `melee_reset`, so a blade cuts on through what it cut and does not cut it again; the page
//! applies the same cells to the world from the events.
//!
//! Events are variable-length records of `u32` words: word 0 is `type | payload_words << 8`, then
//! the payload (ids as `u32`, cells as `i32` bits, everything else as `f32` bits):
//!
//! | type | event | payload |
//! |---|---|---|
//! | 1 | blunt impact | weapon, target (`u32::MAX` = world), pos 3, normal 3, impulse, shock |
//! | 2 | crushed cell | cell 3 (i32), push 3 |
//! | 3 | parry clash | pos 3, normal 3, impulse, sparks (u32) |
//! | 4 | slice cut | target, point 3, normal 3, energy, plasma (u32 0/1) |
//! | 5 | stab entered | weapon, target, entry 3, axis 3, depth |
//! | 6 | stab released | weapon, target |
//! | 7 | plasma kerf | point 3, normal 3, energy, cells n (u32), heated m (u32), n × cell 3 (i32), m × cell 3 (i32) |
//! | 8 | ignite cell | cell 3 (i32) |
//! | 9 | plasma clash | pos 3, intensity, hum pitch shift |

use crate::kinds::{EARTH, kind};
use crate::melee::{HandTarget, MeleeEvent, MeleeWorld, SUBSTEP_DT, WeaponBody, WeaponKind};
#[cfg(test)]
use crate::melee::quat_turn;
use crate::tree::Kind;
use std::cell::RefCell;
use std::collections::HashSet;

pub const EV_BLUNT: u32 = 1;
pub const EV_CRUSH: u32 = 2;
pub const EV_PARRY: u32 = 3;
pub const EV_SLICE: u32 = 4;
pub const EV_STAB_IN: u32 = 5;
pub const EV_STAB_OUT: u32 = 6;
pub const EV_KERF: u32 = 7;
pub const EV_IGNITE: u32 = 8;
pub const EV_PLASMA_CLASH: u32 = 9;

/// Longest frame one call steps (s): a stalled tab does not run hundreds of substeps at once.
pub const MAX_STEP: f32 = 1.0 / 15.0;
/// Carved cells kept as empty before the set is forgotten (the page has applied them by then).
const CARVED_CAP: usize = 65_536;
/// Fastest a hand target is taken to move (cells/s) and turn (rad/s) when its speed is estimated.
const MAX_HAND_SPEED: f32 = 900.0;
const MAX_HAND_SPIN: f32 = 80.0;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Ground {
    None,
    /// Cells with `y < top` are earth.
    Plane(i32),
    /// The solver's own cells in this instance (`bodies.ground`).
    World,
}

struct Hand {
    id: u32,
    pos: [f32; 3],
    rot: [f32; 4],
    vel: [f32; 3],
    spin: [f32; 3],
}

struct Arena {
    world: MeleeWorld,
    next_id: u32,
    events: Vec<u32>,
    records: usize,
    glow: Vec<f32>,
    carved: HashSet<[i32; 3]>,
    ground: Ground,
    hands: Vec<Hand>,
    pose: [f32; 16],
    blade: [f32; 16],
}

impl Arena {
    fn new() -> Self {
        Self {
            world: MeleeWorld::new(),
            next_id: 1,
            events: Vec::new(),
            records: 0,
            glow: Vec::new(),
            carved: HashSet::new(),
            ground: Ground::World,
            hands: Vec::new(),
            pose: [0.0; 16],
            blade: [0.0; 16],
        }
    }

    fn hand_mut(&mut self, id: u32) -> Option<&mut Hand> {
        self.hands.iter_mut().find(|h| h.id == id)
    }
}

thread_local! {
    static ARENA: RefCell<Arena> = RefCell::new(Arena::new());
}

fn weapon_kind(k: u32) -> Option<WeaponKind> {
    Some(match k {
        0 => WeaponKind::Fist,
        1 => WeaponKind::Sledgehammer,
        2 => WeaponKind::Knife,
        3 => WeaponKind::Longsword,
        4 => WeaponKind::BattleAxe,
        5 => WeaponKind::Shield,
        6 => WeaponKind::Lightsaber,
        _ => return None,
    })
}

fn unit_quat(q: [f32; 4]) -> [f32; 4] {
    let l = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if l > 1e-6 && l.is_finite() {
        [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
    } else {
        [0.0, 0.0, 0.0, 1.0]
    }
}

fn finite3(v: [f32; 3]) -> bool {
    v.iter().all(|c| c.is_finite())
}

fn clamp_len(v: [f32; 3], most: f32) -> [f32; 3] {
    let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if l > most { [v[0] * most / l, v[1] * most / l, v[2] * most / l] } else { v }
}

/// Angular velocity turning `from` into `to` over `dt` (small-angle: `2 · vec(to · from⁻¹) / dt`).
fn spin_between(from: [f32; 4], to: [f32; 4], dt: f32) -> [f32; 3] {
    let (ax, ay, az, aw) = (to[0], to[1], to[2], to[3]);
    let (bx, by, bz, bw) = (-from[0], -from[1], -from[2], from[3]);
    let mut d = [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ];
    if d[3] < 0.0 {
        d = [-d[0], -d[1], -d[2], -d[3]];
    }
    clamp_len([2.0 * d[0] / dt, 2.0 * d[1] / dt, 2.0 * d[2] / dt], MAX_HAND_SPIN)
}

fn push_f(out: &mut Vec<u32>, v: &[f32]) {
    out.extend(v.iter().map(|f| f.to_bits()));
}

fn push_cell(out: &mut Vec<u32>, c: [i32; 3]) {
    out.extend(c.iter().map(|&v| v as u32));
}

fn opt_id(id: Option<u32>) -> u32 {
    id.unwrap_or(u32::MAX)
}

/// Packs one event as one record.
fn encode(out: &mut Vec<u32>, e: &MeleeEvent) {
    let head = out.len();
    out.push(0);
    let ty = match e {
        MeleeEvent::BluntImpact { weapon_id, target_id, pos, normal, impulse, shock_impulse } => {
            out.push(*weapon_id);
            out.push(opt_id(*target_id));
            push_f(out, pos);
            push_f(out, normal);
            push_f(out, &[*impulse, *shock_impulse]);
            EV_BLUNT
        }
        MeleeEvent::CrushVoxel { cell, push } => {
            push_cell(out, *cell);
            push_f(out, push);
            EV_CRUSH
        }
        MeleeEvent::ParryClash { pos, normal, impulse, spark_count } => {
            push_f(out, pos);
            push_f(out, normal);
            push_f(out, &[*impulse]);
            out.push(*spark_count);
            EV_PARRY
        }
        MeleeEvent::SliceCut { target_id, plane_point, plane_normal, cut_energy, is_plasma } => {
            out.push(opt_id(*target_id));
            push_f(out, plane_point);
            push_f(out, plane_normal);
            push_f(out, &[*cut_energy]);
            out.push(*is_plasma as u32);
            EV_SLICE
        }
        MeleeEvent::StabEntered { weapon_id, target_id, entry_pos, axis, depth } => {
            out.push(*weapon_id);
            out.push(opt_id(*target_id));
            push_f(out, entry_pos);
            push_f(out, axis);
            push_f(out, &[*depth]);
            EV_STAB_IN
        }
        MeleeEvent::StabReleased { weapon_id, target_id } => {
            out.push(*weapon_id);
            out.push(opt_id(*target_id));
            EV_STAB_OUT
        }
        MeleeEvent::PlasmaKerf { cells, cut_plane, cut_energy, heat_cells } => {
            push_f(out, &cut_plane.point);
            push_f(out, &cut_plane.normal);
            push_f(out, &[*cut_energy]);
            out.push(cells.len() as u32);
            out.push(heat_cells.len() as u32);
            for &c in cells {
                push_cell(out, c);
            }
            for &c in heat_cells {
                push_cell(out, c);
            }
            EV_KERF
        }
        MeleeEvent::IgniteCell { cell } => {
            push_cell(out, *cell);
            EV_IGNITE
        }
        MeleeEvent::PlasmaClash { pos, intensity, hum_pitch_shift } => {
            push_f(out, pos);
            push_f(out, &[*intensity, *hum_pitch_shift]);
            EV_PLASMA_CLASH
        }
    };
    let words = (out.len() - head - 1) as u32;
    out[head] = ty | (words << 8);
}

/// Steps the arena by `dt` against its ground, then packs the events and refreshes the glow list.
fn step(a: &mut Arena, dt: f32) -> usize {
    a.events.clear();
    a.records = 0;
    if !(dt > 0.0) {
        return 0;
    }
    let dt = dt.min(MAX_STEP);
    let Arena { world, carved, ground, .. } = a;
    let mut no_targets = [];
    let earth: Kind = kind(EARTH, 0);
    // The substeps `MeleeWorld::step` would take, run here so that what one substep carves is empty
    // to the next: a blade cuts on through its own kerf rather than cutting the same cells again.
    world.events.clear();
    let substeps = ((dt / SUBSTEP_DT).round() as usize).max(world.config.substeps_per_tick.max(1));
    let dt_sub = dt / substeps as f32;
    let mut sub = |world: &mut MeleeWorld, carved: &mut HashSet<[i32; 3]>, kind_at: &mut dyn FnMut([i32; 3], &HashSet<[i32; 3]>) -> Kind| {
        for _ in 0..substeps {
            let seen = world.events.len();
            world.step_substep(dt_sub, &mut no_targets, &mut |c| kind_at(c, carved));
            for e in &world.events[seen..] {
                match e {
                    MeleeEvent::PlasmaKerf { cells, .. } => carved.extend(cells.iter().copied()),
                    MeleeEvent::CrushVoxel { cell, .. } => {
                        carved.insert(*cell);
                    }
                    _ => {}
                }
            }
        }
    };
    match *ground {
        Ground::None => sub(world, carved, &mut |_, _| 0),
        Ground::Plane(top) => sub(world, carved, &mut |c, carved| if c[1] < top && !carved.contains(&c) { earth } else { 0 }),
        Ground::World => crate::INSTANCE.with_borrow_mut(|i| {
            let b = crate::moving(i);
            sub(world, carved, &mut |c, carved| if carved.contains(&c) { 0 } else { b.ground.kind(c[0], c[1], c[2]) });
        }),
    }
    if a.carved.len() > CARVED_CAP {
        a.carved.clear();
    }
    for e in &a.world.events {
        encode(&mut a.events, e);
    }
    a.records = a.world.events.len();
    a.glow.clear();
    for (c, g) in a.world.cooling_glow.iter() {
        a.glow.extend_from_slice(&[c[0] as f32 + 0.5, c[1] as f32 + 0.5, c[2] as f32 + 0.5, g.heat]);
    }
    a.records
}

fn set_hand(a: &mut Arena, id: u32, pos: [f32; 3], rot: [f32; 4], dt: f32) -> bool {
    if !finite3(pos) || a.world.weapon(id).is_none() {
        return false;
    }
    let rot = unit_quat(rot);
    let (vel, spin) = match a.hand_mut(id) {
        Some(h) if dt > 0.0 => {
            let dt = dt.min(MAX_STEP);
            let vel = clamp_len(
                [(pos[0] - h.pos[0]) / dt, (pos[1] - h.pos[1]) / dt, (pos[2] - h.pos[2]) / dt],
                MAX_HAND_SPEED,
            );
            let spin = spin_between(h.rot, rot, dt);
            (vel, spin)
        }
        Some(h) => (h.vel, h.spin),
        None => ([0.0; 3], [0.0; 3]),
    };
    match a.hand_mut(id) {
        Some(h) => {
            h.pos = pos;
            h.rot = rot;
            h.vel = vel;
            h.spin = spin;
        }
        None => a.hands.push(Hand { id, pos, rot, vel, spin }),
    }
    if let Some(w) = a.world.weapon_mut(id) {
        w.hand_target = Some(HandTarget { target_pos: pos, target_rot: rot, target_vel: vel, target_spin: spin });
    }
    true
}

// ── Exports ──────────────────────────────────────────────────────────────────

/// Forgets every weapon, event, glow and carved cell; the ground goes back to the solver's world.
#[unsafe(no_mangle)]
pub extern "C" fn melee_reset() {
    ARENA.with_borrow_mut(|a| *a = Arena::new());
}

/// Says what the blades meet: `0` nothing, `1` a flat plane of earth below cell `y`, `2` the solver's
/// cells in this instance. Returns the mode now.
#[unsafe(no_mangle)]
pub extern "C" fn melee_set_ground(mode: u32, y: i32) -> u32 {
    ARENA.with_borrow_mut(|a| {
        a.ground = match mode {
            0 => Ground::None,
            1 => Ground::Plane(y),
            _ => Ground::World,
        };
        match a.ground {
            Ground::None => 0,
            Ground::Plane(_) => 1,
            Ground::World => 2,
        }
    })
}

/// Makes a weapon (`0` fist, `1` sledgehammer, `2` knife, `3` longsword, `4` battle axe, `5` shield,
/// `6` lightsaber) at a pose in cells, held still there by its hand spring. A lightsaber starts
/// retracted (see `melee_ignite`). Returns its non-zero id, or `0` for an unknown kind.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn melee_spawn(kind: u32, px: f32, py: f32, pz: f32, rx: f32, ry: f32, rz: f32, rw: f32) -> u32 {
    let Some(k) = weapon_kind(kind) else { return 0 };
    let pos = [px, py, pz];
    if !finite3(pos) {
        return 0;
    }
    ARENA.with_borrow_mut(|a| {
        let id = a.next_id;
        a.next_id = a.next_id.wrapping_add(1).max(1);
        let rot = unit_quat([rx, ry, rz, rw]);
        let mut w = WeaponBody::new(id, k, pos, rot);
        if k == WeaponKind::Lightsaber {
            w.set_extension(0.0);
        }
        w.hand_target = Some(HandTarget::stationary(pos, rot));
        a.world.add_weapon(w);
        a.hands.push(Hand { id, pos, rot, vel: [0.0; 3], spin: [0.0; 3] });
        id
    })
}

/// Removes a weapon. Returns 1 if it was there.
#[unsafe(no_mangle)]
pub extern "C" fn melee_remove(id: u32) -> i32 {
    ARENA.with_borrow_mut(|a| {
        let before = a.world.weapons.len();
        a.world.weapons.retain(|w| w.id != id);
        a.hands.retain(|h| h.id != id);
        (a.world.weapons.len() < before) as i32
    })
}

/// Number of weapons in the arena.
#[unsafe(no_mangle)]
pub extern "C" fn melee_count() -> usize {
    ARENA.with_borrow(|a| a.world.weapons.len())
}

/// Ignites (`on != 0`) or retracts a lightsaber; the blade grows or shrinks as the arena steps.
/// Returns its blade's extension now (`0..1`), or `-1` if there is no such weapon.
#[unsafe(no_mangle)]
pub extern "C" fn melee_ignite(id: u32, on: i32) -> f32 {
    ARENA.with_borrow_mut(|a| match a.world.weapon_mut(id) {
        Some(w) => {
            w.set_ignited(on != 0);
            w.blade_extension
        }
        None => -1.0,
    })
}

/// Sets a plasma blade's colour (linear RGB). Returns 1 if the weapon is there.
#[unsafe(no_mangle)]
pub extern "C" fn melee_set_color(id: u32, r: f32, g: f32, b: f32) -> i32 {
    ARENA.with_borrow_mut(|a| match a.world.weapon_mut(id) {
        Some(w) => {
            w.plasma_color = [r.clamp(0.0, 64.0), g.clamp(0.0, 64.0), b.clamp(0.0, 64.0)];
            1
        }
        None => 0,
    })
}

/// Moves a weapon's hand target to a pose (cells, unit quaternion) reached over `dt` seconds; the
/// hand's speed and spin are estimated from its last pose. Does not step: for many weapons a frame,
/// set each hand and call `melee_step` once. Returns 1 if the weapon is there.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn melee_set_hand(id: u32, tx: f32, ty: f32, tz: f32, qx: f32, qy: f32, qz: f32, qw: f32, dt: f32) -> i32 {
    ARENA.with_borrow_mut(|a| set_hand(a, id, [tx, ty, tz], [qx, qy, qz, qw], dt) as i32)
}

/// Steps every weapon by `dt` seconds (at most `MAX_STEP`) in 240 Hz substeps of swept-blade CCD
/// against the ground and each other. Returns how many event records were written.
#[unsafe(no_mangle)]
pub extern "C" fn melee_step(dt: f32) -> i32 {
    ARENA.with_borrow_mut(|a| step(a, dt) as i32)
}

/// `melee_set_hand` and then `melee_step`: the whole frame for a lone weapon. Returns the number of
/// event records written (`melee_events_len` is their length in words), or `-1` if there is no such weapon.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn melee_drive_hand(id: u32, tx: f32, ty: f32, tz: f32, qx: f32, qy: f32, qz: f32, qw: f32, dt: f32) -> i32 {
    ARENA.with_borrow_mut(|a| {
        if !set_hand(a, id, [tx, ty, tz], [qx, qy, qz, qw], dt) {
            return -1;
        }
        step(a, dt) as i32
    })
}

/// Where the last step's event records start in memory (read after the call that stepped).
#[unsafe(no_mangle)]
pub extern "C" fn melee_events_ptr() -> *const u32 {
    ARENA.with_borrow(|a| a.events.as_ptr())
}

/// How many `u32` words the last step's event records take.
#[unsafe(no_mangle)]
pub extern "C" fn melee_events_len() -> usize {
    ARENA.with_borrow(|a| a.events.len())
}

/// Where the glowing kerf cells start: `count` × `(x, y, z, heat)` as `f32`, cell centres in cells.
#[unsafe(no_mangle)]
pub extern "C" fn melee_glow_ptr() -> *const f32 {
    ARENA.with_borrow(|a| a.glow.as_ptr())
}

/// How many cells still glow after the last step.
#[unsafe(no_mangle)]
pub extern "C" fn melee_glow_count() -> usize {
    ARENA.with_borrow(|a| a.glow.len() / 4)
}

fn write_pose(a: &mut Arena, id: u32) -> bool {
    let Some(w) = a.world.weapon(id) else { return false };
    let (_, tip, _) = w.blade_segment_world();
    let tip_speed = {
        let v = w.point_velocity(tip);
        (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()
    };
    let pose = [w.pos[0], w.pos[1], w.pos[2], w.rot[0], w.rot[1], w.rot[2], w.rot[3], w.blade_extension, tip_speed];
    a.pose[..9].copy_from_slice(&pose);
    true
}

/// A room of 16 `f32` in the core's memory the page may pass to `melee_pose`.
#[unsafe(no_mangle)]
pub extern "C" fn melee_pose_room() -> *mut f32 {
    ARENA.with_borrow_mut(|a| a.pose.as_mut_ptr())
}

/// Writes `[px, py, pz, rx, ry, rz, rw, extend, tipSpeed]` for a weapon at `out_ptr` (null: the
/// arena's own room, `melee_pose_room`). Returns 1 if the weapon is there.
///
/// # Safety
/// `out_ptr` is null or points at 9 writable `f32` in this instance's memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn melee_pose(id: u32, out_ptr: *mut f32) -> i32 {
    ARENA.with_borrow_mut(|a| {
        if !write_pose(a, id) {
            return 0;
        }
        let room = a.pose.as_mut_ptr();
        if !out_ptr.is_null() && out_ptr != room {
            // SAFETY: the caller promises 9 writable floats at `out_ptr`, distinct from the arena's room.
            unsafe { core::ptr::copy_nonoverlapping(room, out_ptr, 9) };
        }
        1
    })
}

/// Writes a weapon's active blade in world cells, `[ex, ey, ez, tx, ty, tz, radius, r, g, b, plasma]`
/// (emitter, tip, capsule radius, plasma colour, 1 if a plasma blade is lit), into the arena's own room
/// and returns its address, or null if there is no such weapon.
#[unsafe(no_mangle)]
pub extern "C" fn melee_blade(id: u32) -> *const f32 {
    ARENA.with_borrow_mut(|a| {
        let Some(w) = a.world.weapon(id) else { return core::ptr::null() };
        let (e, t, r) = w.blade_segment_world();
        let c = w.plasma_color;
        let lit = w.is_plasma_active() as u32 as f32;
        a.blade[..11].copy_from_slice(&[e[0], e[1], e[2], t[0], t[1], t[2], r, c[0], c[1], c[2], lit]);
        a.blade.as_ptr()
    })
}

/// The unit direction a weapon's blade points in the world (its local +Y), for the tests' aim checks.
#[cfg(test)]
fn blade_axis(id: u32) -> Option<[f32; 3]> {
    ARENA.with_borrow(|a| a.world.weapon(id).map(|w| quat_turn(w.rot, [0.0, 1.0, 0.0])))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::melee::quat_from_axis_angle;

    /// Records of the last step, decoded as `(type, payload)`.
    fn records() -> Vec<(u32, Vec<u32>)> {
        let words: Vec<u32> = ARENA.with_borrow(|a| a.events.clone());
        let mut out = Vec::new();
        let mut i = 0;
        while i < words.len() {
            let ty = words[i] & 0xff;
            let n = (words[i] >> 8) as usize;
            out.push((ty, words[i + 1..i + 1 + n].to_vec()));
            i += 1 + n;
        }
        assert_eq!(i, words.len(), "records must tile the buffer exactly");
        out
    }

    fn pose(id: u32) -> [f32; 9] {
        let mut out = [0.0f32; 9];
        assert_eq!(unsafe { melee_pose(id, out.as_mut_ptr()) }, 1);
        out
    }

    fn glow() -> Vec<[f32; 4]> {
        let n = melee_glow_count();
        let p = melee_glow_ptr();
        (0..n).map(|i| unsafe { [*p.add(i * 4), *p.add(i * 4 + 1), *p.add(i * 4 + 2), *p.add(i * 4 + 3)] }).collect()
    }


    #[test]
    fn spawn_remove_and_unknown_kinds() {
        melee_reset();
        assert_eq!(melee_spawn(99, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0), 0);
        assert_eq!(melee_spawn(6, f32::NAN, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0), 0);
        let a = melee_spawn(6, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1.0);
        let b = melee_spawn(3, 5.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0); // zero quaternion is taken as identity
        assert!(a != 0 && b != 0 && a != b);
        assert_eq!(melee_count(), 2);
        assert_eq!(melee_remove(a), 1);
        assert_eq!(melee_remove(a), 0);
        assert_eq!(melee_count(), 1);
        assert_eq!(melee_ignite(a, 1), -1.0);
        assert_eq!(melee_drive_hand(a, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.01), -1);
        assert!(melee_blade(a).is_null());
        assert!(!melee_blade(b).is_null());
    }

    #[test]
    fn a_held_weapon_does_not_fall() {
        melee_reset();
        melee_set_ground(0, 0);
        let id = melee_spawn(3, 0.0, 20.0, 0.0, 0.0, 0.0, 0.0, 1.0);
        for _ in 0..120 {
            assert_eq!(melee_step(1.0 / 60.0), 0);
        }
        let p = pose(id);
        assert!((p[1] - 20.0).abs() < 0.5, "a weapon held still by its hand must stay put, y = {}", p[1]);
    }

    #[test]
    fn lightsaber_ignites_and_retracts_over_a_quarter_second() {
        melee_reset();
        melee_set_ground(0, 0);
        let id = melee_spawn(6, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1.0);
        assert_eq!(melee_ignite(id, 1), 0.0, "spawns retracted");
        let blade = melee_blade(id);
        assert_eq!(unsafe { *blade.add(10) }, 0.0, "a retracted saber is not lit");
        melee_step(0.125);
        // One call steps at most MAX_STEP (1/15 s): 4/s × 1/15 s.
        let half = pose(id)[7];
        assert!((half - 4.0 / 15.0).abs() < 0.02, "extension after one clamped step = {half}");
        for _ in 0..12 {
            melee_step(1.0 / 30.0);
        }
        assert_eq!(pose(id)[7], 1.0);
        let b = melee_blade(id);
        let (e, t) = unsafe { ([*b, *b.add(1), *b.add(2)], [*b.add(3), *b.add(4), *b.add(5)]) };
        assert!((t[1] - e[1] - 10.0).abs() < 0.1, "a lit saber's blade runs 10 cells from the emitter");
        assert_eq!(unsafe { *b.add(10) }, 1.0);
        assert_eq!(melee_ignite(id, 0), 1.0);
        for _ in 0..10 {
            melee_step(1.0 / 30.0);
        }
        assert_eq!(pose(id)[7], 0.0, "retracted after 1/3 s");
    }

    #[test]
    fn hand_spring_tracks_a_swing_with_tip_speed() {
        melee_reset();
        melee_set_ground(0, 0);
        let id = melee_spawn(6, 0.0, 30.0, 0.0, 0.0, 0.0, 0.0, 1.0);
        melee_ignite(id, 1);
        let dt = 1.0 / 60.0;
        let mut peak_tip = 0.0f32;
        // Sweep the hand 20 cells along +X over half a second while turning the blade 90° about Z.
        for f in 1..=30 {
            let t = f as f32 / 30.0;
            let q = quat_from_axis_angle([0.0, 0.0, 1.0], -std::f32::consts::FRAC_PI_2 * t);
            assert!(melee_drive_hand(id, 20.0 * t, 30.0, 0.0, q[0], q[1], q[2], q[3], dt) >= 0);
            peak_tip = peak_tip.max(pose(id)[8]);
        }
        for _ in 0..30 {
            let q = quat_from_axis_angle([0.0, 0.0, 1.0], -std::f32::consts::FRAC_PI_2);
            melee_drive_hand(id, 20.0, 30.0, 0.0, q[0], q[1], q[2], q[3], dt);
        }
        let p = pose(id);
        assert!((p[0] - 20.0).abs() < 1.0 && (p[1] - 30.0).abs() < 1.0, "weapon reaches the hand: {p:?}");
        let axis = blade_axis(id).unwrap();
        assert!(axis[0] > 0.95, "blade turned to +X with the hand, axis {axis:?}");
        assert!(peak_tip > 30.0, "a swing moves the tip fast, peak {peak_tip}");
        assert!(p[8] < 5.0, "at rest the tip slows, {}", p[8]);
    }

    #[test]
    fn opposing_sabers_clash_as_records() {
        melee_reset();
        melee_set_ground(0, 0);
        let blue = melee_spawn(6, -1.2, 5.0, 0.0, 0.0, 0.0, 0.0, 1.0);
        let red = melee_spawn(6, 1.2, 5.0, 0.0, 0.0, 0.0, 0.0, 1.0);
        for id in [blue, red] {
            melee_ignite(id, 1);
            ARENA.with_borrow_mut(|a| a.world.weapon_mut(id).unwrap().set_extension(1.0));
        }
        // Each swung at the other, its hand reaching through to the other's side.
        melee_set_hand(blue, 1.5, 5.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0);
        melee_set_hand(red, -1.5, 5.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0);
        ARENA.with_borrow_mut(|a| {
            a.world.weapon_mut(blue).unwrap().vel = [55.0, 0.0, 0.0];
            a.world.weapon_mut(red).unwrap().vel = [-55.0, 0.0, 0.0];
        });
        let mut clashes = 0;
        for _ in 0..16 {
            let n = melee_step(1.0 / 120.0);
            let recs = records();
            assert_eq!(recs.len(), n as usize);
            for (ty, p) in recs {
                if ty == EV_PLASMA_CLASH {
                    assert_eq!(p.len(), 5);
                    let intensity = f32::from_bits(p[3]);
                    assert!(intensity > 0.0 && intensity.is_finite());
                    clashes += 1;
                }
            }
        }
        assert!(clashes >= 2, "opposing lit sabers must clash, got {clashes}");
        assert!(pose(blue)[0] < pose(red)[0], "the blades hold each other off");
    }

    #[test]
    fn a_saber_cut_into_the_ground_carves_a_kerf_that_glows_and_cools() {
        melee_reset();
        assert_eq!(melee_set_ground(1, 0), 1);
        // Blade pointing straight down from y = 14: its 10-cell plasma reaches y ≈ 3.
        let down = quat_from_axis_angle([1.0, 0.0, 0.0], std::f32::consts::PI);
        let id = melee_spawn(6, 0.0, 14.0, 0.0, down[0], down[1], down[2], down[3]);
        melee_ignite(id, 1);
        ARENA.with_borrow_mut(|a| a.world.weapon_mut(id).unwrap().set_extension(1.0));
        let dt = 1.0 / 60.0;
        let mut carved = HashSet::new();
        let mut kerf_records = 0;
        // Plunge the hand to y = 8 (tip ≈ -3) and drag it 12 cells along +X.
        for f in 1..=60 {
            let t = f as f32 / 60.0;
            let y = 14.0 - 6.0 * (t * 3.0).min(1.0);
            let x = 12.0 * ((t - 0.33) / 0.67).clamp(0.0, 1.0);
            let n = melee_drive_hand(id, x, y, 0.0, down[0], down[1], down[2], down[3], dt);
            assert!(n >= 0);
            for (ty, p) in records() {
                if ty == EV_KERF {
                    kerf_records += 1;
                    let cells = p[7] as usize;
                    let heated = p[8] as usize;
                    assert_eq!(p.len(), 9 + 3 * (cells + heated));
                    for k in 0..cells {
                        let c = [p[9 + 3 * k] as i32, p[10 + 3 * k] as i32, p[11 + 3 * k] as i32];
                        assert!(c[1] < 0, "only earth below the plane is cut, got {c:?}");
                        assert!(carved.insert(c), "a carved cell is empty from then on and never cut twice: {c:?}");
                    }
                }
            }
        }
        assert!(kerf_records > 3, "the drag must keep carving, {kerf_records} kerf records");
        assert!(carved.len() >= 12, "a continuous kerf, {} cells", carved.len());
        let xs: HashSet<i32> = carved.iter().map(|c| c[0]).collect();
        assert!((0..=10).all(|x| xs.contains(&x)), "the kerf runs along the whole drag: {xs:?}");

        // The kerf's rim glows hot, then cools to nothing over four seconds once the blade is out.
        let fresh = glow();
        assert!(!fresh.is_empty(), "kerf rim cells glow");
        let hottest = fresh.iter().map(|g| g[3]).fold(0.0f32, f32::max);
        assert!(hottest > 0.9, "fresh kerf is near full heat, {hottest}");
        melee_ignite(id, 0);
        melee_drive_hand(id, 12.0, 40.0, 0.0, down[0], down[1], down[2], down[3], dt);
        for _ in 0..60 {
            melee_step(1.0 / 30.0); // 2 s
        }
        let mid = glow().iter().map(|g| g[3]).fold(0.0f32, f32::max);
        assert!(mid > 0.25 && mid < 0.6, "about half cooled after 2 s, {mid}");
        for _ in 0..66 {
            melee_step(1.0 / 30.0); // 2.2 s more
        }
        assert_eq!(melee_glow_count(), 0, "cooled away after four seconds");
    }

    #[test]
    fn long_frames_are_clamped_and_bad_input_is_refused() {
        melee_reset();
        melee_set_ground(0, 0);
        let id = melee_spawn(2, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1.0);
        assert_eq!(melee_step(0.0), 0);
        assert_eq!(melee_step(-1.0), 0);
        assert_eq!(melee_step(f32::NAN), 0);
        assert_eq!(melee_set_hand(id, f32::INFINITY, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.01), 0);
        // A ten-second frame is stepped as one fifteenth of a second.
        melee_drive_hand(id, 100.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1.0, 10.0);
        let p = pose(id);
        assert!(p.iter().all(|v| v.is_finite()));
        assert!(p[0] < 100.0, "one clamped step cannot cover 100 cells, x = {}", p[0]);
    }
}
