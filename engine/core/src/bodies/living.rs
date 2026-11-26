//! Living things (#245): a body that is kept a body for as long as it lives, and is pushed and turned each step by
//! what it was last told (go, turn, rise, roll, jump) through a motor that is all numbers. The same few numbers
//! make a car (feet that steer and drive), a helicopter (lift), a broom (hover and lift), a frog (a jump) and a
//! fly; who tells it (a person's keys, a script in a sandbox, a resident) is not the core's to know.
//!
//! Why feet: a box pushed along the street with twice its own weight did not move uphill at all, because the
//! road rises a cell at a time and `way_out` pushes a corner back out of each riser. So a living thing that goes
//! over ground stands on feet: rays cast down from the body, each a spring that carries its share of the weight,
//! grips sideways and, if it drives, pushes along. Nothing of the body then touches the road.
use super::*;

/// Seconds for which what a living thing was last told holds: whoever drives says so again and again, and a page
/// that has gone leaves no car at full speed.
pub const HOLD: f32 = 1.0;
/// How far a foot is pressed in when the thing stands still, as a share of its reach.
const SAG: f32 = 0.4;
/// How quickly a foot's spring stops bouncing: 1 is at once without overshoot.
const DAMP: f32 = 0.7;
/// How quickly a rolling foot follows the road under it, a rate each second: a riser is taken in about 1 / ROAD s.
const ROAD: f32 = 20.0;
/// How soon a rolling foot pressed in past where it stands meets its stop, as a share of its reach.
const STOP: f32 = 0.05;
/// The steepest grade a road is believed to have, rise over run: the town's steepest street is 13%.
const HILL: f32 = 0.15;
/// How many times a step the feet grip, all together each time.
const GRIPS: usize = 4;
/// Seconds a living thing lies quiet, told nothing, before it sleeps: it is then not stepped until something stirs it.
const QUIET: f32 = 1.0;
/// Which way a thing faces in its own cells.
const FRONTS: [V; 4] = [[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 0.0, -1.0]];

/// A foot: where the ray starts (from the body's own low corner, in cells), how far down it reaches, and whether it
/// steers and drives. `pressed` and `spun` are how far it is pushed in and how far it has rolled, for drawing a wheel.
pub struct Foot {
    pub at: V,
    pub reach: f32,
    pub steers: bool,
    pub drives: bool,
    pub pressed: f32,
    pub spun: f32,
    /// For what rolls: how high the road under it is (none when it is off the ground), and how fast that rises.
    pub road: f32,
    pub rise: f32,
}

pub struct Live {
    /// Which way is forward in its own cells: 0 to 3 for +x, -x, +z, -z.
    pub front: u8,
    pub feet: Vec<Foot>,
    /// How well a foot holds the ground, against the weight on it.
    pub grip: f32,
    /// How fast it gathers speed (cells a second, each second) and the speed it gets to (cells a second).
    pub power: f32,
    pub top: f32,
    /// How far its steering feet turn, radians. With none it turns by `turns`.
    pub steer: f32,
    /// The height it hangs at over the ground when told nothing (cells); none for what does not hover.
    pub hover: f32,
    /// How fast it rises and sinks when told to (cells a second); none for what does not fly.
    pub lift: f32,
    /// How firmly it is kept upright and facing where it means to, a rate each second; none for what is left to roll.
    pub upright: f32,
    /// How fast it turns when it is kept upright (radians a second).
    pub turns: f32,
    /// The speed a jump gives it (cells a second).
    pub jump: f32,
    /// The knock that ends it (a change of speed, cells a second): it breaks as any body does, and lives no more.
    pub tough: f32,
    /// What it was last told: forward and back, right and left, up and down, each from -1 to 1.
    pub go: f32,
    pub turn: f32,
    pub rise: f32,
    /// To its right and left, for what walks on legs: a person steps sideways, a car does not.
    pub side: f32,
    /// Whether it is a figure: someone's body. It is drawn by whoever draws people, not as cells; nothing breaks
    /// it into pieces, and it breaks nothing by landing.
    pub figure: bool,
    /// Whether it is a ghost: it stands where it is put for a body that is moved elsewhere (someone at a page,
    /// an actor), so that what is thrown and what falls meets them. It meets bodies and not the world, goes
    /// nowhere, and what a blow would have done to it is told (`TOOK`).
    pub ghost: bool,
    /// A jump still to take, and how much of a roll is still to turn (radians).
    hop: bool,
    rolling: f32,
    rolled: f32,
    /// Seconds since it was told anything.
    heard: f32,
    /// Where it means to face: its front is at (cos, 0, sin) of this.
    pub heading: f32,
    /// Whether it is flying (and not sitting on the ground with its engine idle).
    pub aloft: bool,
    /// How many feet are on the ground.
    pub on: u32,
    /// Seconds it has been quiet, and whether a blast has reached it.
    quiet: f32,
    pub(super) hurt: bool,
    /// How much of the world's pull it feels: 1 as everything, less to fall slowly, none to hang where it is.
    pub fall: f32,
    /// How high a wall what goes on legs gets up when it is told to go on against it (cells): none for steps
    /// and kerbs only, a few for a ledge, any height for one who walks up walls. And where it began to climb.
    pub climb: f32,
    climbing: Option<f32>,
    /// Seconds for which what goes on legs is carried by a blow it took, before its legs take it up again.
    reel: f32,
    /// Which way is down for it, when that is not the world's way: a turn that takes its own upright frame (y up)
    /// to the world's. The motor works in that frame, so everything it does (legs, a jump, falling) is along it.
    /// `base` is what it was set to; `frame` is what it is now, which clinging turns as it goes from face to face.
    pub base: Option<Q>,
    pub frame: Option<Q>,
    /// Whether it clings: walked at a wall its down turns into the wall, and over an edge it turns again, so that
    /// whatever it walks on is its floor. And what it found last step: a face ahead (1) or its floor gone round an
    /// edge (-1); and how long it has had no floor.
    pub cling: bool,
    turning: i8,
    lost: f32,
    /// Seconds since its floor turned in which it is not thrown off the new one.
    fresh: f32,
    /// How fast it was going when the step's touches had yet to push it, and the most a step has changed that: a
    /// thing that lives is broken by how much of its speed one step takes, however many touches share the blow.
    pub(super) was: V,
    pub jolt: f32,
    /// Progressive steering angle (-1 to 1) and smoothed longitudinal/lateral acceleration (cells/s²) for weight transfer.
    steer_now: f32,
    prev_rolls: f32,
    long_acc: f32,
    lat_acc: f32,
    /// Burnout launch control: charge built holding throttle + handbrake stationary/slow, and the 0.8 s launch surge.
    pub burnout_charge: f32,
    pub launch_timer: f32,
    launch_power: f32,
    /// Nitrous / turbo boost: driver request, rechargeable reserve (0..1), active boost flag, recharge cooldown, and air time.
    pub boost_ask: bool,
    pub boost_fuel: f32,
    pub boost_on: bool,
    boost_cd: f32,
    air_time: f32,
    /// Surface-aware grip & archetype: rain wetness (0..1), optional explicit surface grip override (<= 0 uses `city::top`),
    /// cached terrain cell and base grip, and wheelbase (cells) derived from feet.
    pub wetness: f32,
    pub surface_grip: f32,
    surf_cell: [i32; 2],
    surf_base: f32,
    wheelbase: f32,
}

impl Live {
    pub fn new() -> Live {
        Live {
            front: 0, feet: Vec::new(), grip: 1.0, power: 0.0, top: 0.0, steer: 0.0, hover: 0.0, lift: 0.0, upright: 0.0, turns: 0.0, jump: 0.0, tough: 120.0,
            go: 0.0, turn: 0.0, rise: 0.0, side: 0.0, figure: false, ghost: false, hop: false, rolling: 0.0, rolled: 0.0, heard: HOLD, heading: 0.0, aloft: false, on: 0, quiet: 0.0, hurt: false, fall: 1.0, climb: 0.0, climbing: None, reel: 0.0, base: None, frame: None, cling: false, turning: 0, lost: 0.0, fresh: 0.0, was: [0.0; 3], jolt: 0.0,
            steer_now: 0.0, prev_rolls: 0.0, long_acc: 0.0, lat_acc: 0.0,
            burnout_charge: 0.0, launch_timer: 0.0, launch_power: 0.0,
            boost_ask: false, boost_fuel: 1.0, boost_on: false, boost_cd: 0.0, air_time: 0.0,
            wetness: 0.0, surface_grip: 0.0, surf_cell: [i32::MIN; 2], surf_base: 1.0, wheelbase: 28.0,
        }
    }

    /// The motor's numbers, as a page or a world process gives them: front, grip, power, top, steer, hover, lift,
    /// upright, turns, jump, tough, then for each foot x, y, z, reach, steers, drives.
    pub fn set(&mut self, n: &[f32]) -> bool {
        if n.len() < 11 || (n.len() - 11) % 6 != 0 || n.iter().any(|v| !v.is_finite()) {
            return false;
        }
        self.front = (n[0] as u8).min(3);
        self.grip = n[1].clamp(0.0, 4.0);
        self.power = n[2].clamp(0.0, 2000.0);
        self.top = n[3].clamp(0.0, 1500.0);
        self.steer = n[4].clamp(0.0, 1.2);
        self.hover = n[5].clamp(0.0, 200.0);
        self.lift = n[6].clamp(0.0, 600.0);
        self.upright = n[7].clamp(0.0, 60.0);
        self.turns = n[8].clamp(0.0, 12.0);
        self.jump = n[9].clamp(0.0, 300.0);
        self.tough = n[10].clamp(10.0, 2000.0);
        self.feet = n[11..].chunks_exact(6).take(16).map(|f| Foot { at: [f[0], f[1], f[2]], reach: f[3].clamp(1.0, 24.0), steers: f[4] != 0.0, drives: f[5] != 0.0, pressed: 0.0, spun: 0.0, road: f32::NAN, rise: 0.0 }).collect();
        let fwd = FRONTS[self.front as usize];
        let (mut lo, mut hi) = (f32::MAX, f32::MIN);
        for f in &self.feet {
            let along = dot(f.at, fwd);
            lo = lo.min(along);
            hi = hi.max(along);
        }
        self.wheelbase = if hi > lo { hi - lo } else { 28.0 };
        true
    }

    /// Whether it rides on feet that roll (a car, a cart): not on legs, nor turned to a down of its own.
    pub(super) fn rides(&self) -> bool {
        !self.feet.is_empty() && !(self.steer == 0.0 && self.upright > 0.0) && self.frame.is_none() && !self.figure
    }

    /// Whether it is being told to go somewhere.
    pub(super) fn going(&self) -> bool {
        self.heard < HOLD && (self.go != 0.0 || self.rise != 0.0 || self.side != 0.0)
    }

    /// Whether it is told nothing and has nothing left to do.
    fn idle(&self) -> bool {
        (self.heard >= HOLD || (self.go == 0.0 && self.turn == 0.0 && self.rise == 0.0 && self.side == 0.0 && !self.boost_ask)) && !self.hop && self.rolling == 0.0 && self.launch_timer <= 0.0
    }

    /// Effective surface grip multiplier: 1.0 dry asphalt/paved, 0.78 wet rain, 0.64 off-road grass/earth/sand.
    /// Uses fast O(1) `city::top` cached per 4-cell tile (never sector-building `Ground::kind`), or an explicit override.
    fn surface_factor(&mut self, b: &Body) -> f32 {
        if self.surface_grip > 0.0 {
            return self.surface_grip.clamp(0.3, 1.5);
        }
        let (ix, iz) = (b.pos[0].floor() as i32, b.pos[2].floor() as i32);
        let cell = [ix >> 2, iz >> 2];
        if cell != self.surf_cell {
            self.surf_cell = cell;
            let g = crate::city::ground(ix, iz) as f32;
            // Elevated structures (bridges, rooftops, elevated test strips) ride on built surfaces.
            self.surf_base = if b.pos[1] - b.com[1] > g + 10.0 {
                1.0
            } else {
                match material(crate::city::top(ix, iz)) {
                    GRASS | EARTH | SAND | LEAVES => 0.64,
                    WATER => 0.55,
                    _ => 1.0,
                }
            };
        }
        let wet = self.wetness.clamp(0.0, 1.0);
        if wet > 0.0 {
            if self.surf_base >= 0.9 {
                1.0 - 0.22 * wet
            } else {
                self.surf_base * (1.0 - 0.12 * wet)
            }
        } else {
            self.surf_base
        }
    }
}

fn qmul(a: Q, b: Q) -> Q {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}

/// A turn of `angle` about one of the axes.
fn about(axis: usize, angle: f32) -> Q {
    let mut q = [0.0, 0.0, 0.0, (angle * 0.5).cos()];
    q[axis] = (angle * 0.5).sin();
    q
}

/// A push at a point of a body (`r` from its middle of mass): `j` is weight times a change of speed.
#[inline]
fn kick(b: &mut Body, r: V, j: V) {
    b.vel = add(b.vel, scale(j, b.inv_mass));
    b.spin = add(b.spin, b.turn_resist(cross(r, j)));
}

/// How far along a line from `p` the standing world begins, within `reach`: none if it does not.
fn ray(ground: &mut Ground, p: V, way: V, reach: f32) -> Option<f32> {
    let steps = (reach * 4.0).ceil() as i32;
    for k in 0..=steps {
        let s = (k as f32 * 0.25).min(reach);
        let q = add(p, scale(way, s));
        let cell = [q[0].floor() as i32, q[1].floor() as i32, q[2].floor() as i32];
        if ground.solid(cell[0], cell[1], cell[2]) {
            // Going mostly down, it is the top of that cell that was met, wherever between two tries.
            if way[1] < -0.5 && k > 0 {
                let top = (p[1] - (cell[1] + 1) as f32) / -way[1];
                if top > s - 0.25 && top <= s {
                    return Some(top);
                }
            }
            return Some(s);
        }
    }
    None
}

impl Live {
    /// One step of the motor on its body: the feet carry and grip, it is driven as it was told, kept upright if it
    /// is that sort of thing, and held in the air if it flies.
    fn step(&mut self, b: &mut Body, ground: &mut Ground, h: f32) {
        // What it found last step turns its frame a quarter turn about its own right: a face ahead becomes its
        // floor, or the face round the edge it walked over does. Long with no floor, it is as it was set again.
        let round = self.turning < 0;
        if self.turning != 0 {
            let right = [-self.heading.sin(), 0.0, self.heading.cos()];
            let half = self.turning as f32 * std::f32::consts::FRAC_PI_4;
            let quarter = [right[0] * half.sin(), right[1] * half.sin(), right[2] * half.sin(), half.cos()];
            self.frame = Some(qmul(self.frame.unwrap_or([0.0, 0.0, 0.0, 1.0]), quarter));
            // Onto a face ahead, its legs must not throw it off; round an edge it is in the air a while (its way on
            // carries it up over the edge and its new down brings it to the face), and is not yet lost.
            (self.lost, self.fresh) = if self.turning > 0 { (0.0, 0.4) } else { (-0.7, 0.0) };
            self.turning = 0;
        } else if self.cling && self.lost > 0.6 && self.frame != self.base {
            self.frame = self.base;
        }
        let Some(q) = self.frame else { return self.inner(b, ground, h, None) };
        // The world's pull (which the solver gives everything after this) is taken off, and its own is given in its
        // own frame: there the body's speed, spin and turn are as if its down were the world's.
        let back = [-q[0], -q[1], -q[2], q[3]];
        b.vel[1] += G * h;
        (b.vel, b.spin, b.rot) = (turn(back, b.vel), turn(back, b.spin), qmul(back, b.rot));
        b.vel[1] -= G * h;
        if round {
            // Round an edge: up over it as high as it stands and on over the new face, however slowly it came
            // (at a walk it rose a cell, fell back down the face it had left and went up it again, for ever).
            let ahead = [self.heading.cos(), 0.0, self.heading.sin()];
            b.vel[1] = b.vel[1].max((2.0 * G * self.fall.max(0.2) * (b.com[1] + 8.0)).sqrt());
            let on = dot(b.vel, ahead);
            b.vel = add(b.vel, scale(ahead, (self.top * 0.4 - on).max(0.0)));
        }
        self.inner(b, ground, h, Some(q));
        (b.vel, b.spin, b.rot) = (turn(q, b.vel), turn(q, b.spin), qmul(q, b.rot));
    }

    fn inner(&mut self, b: &mut Body, ground: &mut Ground, h: f32, frame: Option<Q>) {
        // Out of its own frame into the world's: for where a ray starts and which way it goes.
        let w = |v: V| frame.map_or(v, |q| turn(q, v));
        self.heard += h;
        let told = self.heard < HOLD;
        let (go, turning, rise) = if told { (self.go, self.turn, self.rise) } else { (0.0, 0.0, 0.0) };
        let side = if told { self.side } else { 0.0 };
        // What only rides over the ground and the water (it hovers and has no lift) cannot be told to rise: it is no aircraft.
        let rise = if self.hover > 0.0 && self.lift == 0.0 { 0.0 } else { rise };
        // What goes on legs (feet that do not steer) is taken to the speed it is told, forward and sideways, the
        // way it means to face: a person turns on the spot and steps aside.
        let legs = self.steer == 0.0 && self.upright > 0.0 && !self.feet.is_empty();
        let stride = {
            let (ahead, right) = ([self.heading.cos(), 0.0, self.heading.sin()], [-self.heading.sin(), 0.0, self.heading.cos()]);
            let want = add(scale(ahead, go), scale(right, side));
            let long = dot(want, want).sqrt().max(1.0);
            scale(want, self.top / long)
        };
        let mass = 1.0 / b.inv_mass;
        let up = [0.0, 1.0, 0.0];
        let front = turn(b.rot, FRONTS[self.front as usize]);
        // Forward along the ground, and to the right of that.
        let flat = if front[0] * front[0] + front[2] * front[2] > 1e-3 { unit([front[0], 0.0, front[2]]) } else { [self.heading.cos(), 0.0, self.heading.sin()] };
        let right = [-flat[2], 0.0, flat[0]];
        // A hill pulls what rolls back down it: its weight, along the way it rolls, by the grade of the road it stands
        // on, at its middle (so it turns nothing). Its springs do not carry it along. (Held up square to one grade
        // worked out for the whole body, a short cart astride a step was pushed back at its feet, under its middle, and
        // went onto its roof.) How steep is read from the road under its feet at the last step, front against back, not
        // from how the body leans; and no steeper than the town's steepest street is believed: a step is not a hill.
        let rolling = self.rides();
        let grade = {
            // The line through the road under each foot, by how far along the thing the foot is.
            let [k, a, y, aa, ay] = self.feet.iter().filter(|f| f.road.is_finite()).fold([0.0f32; 5], |[k, a, y, aa, ay], f| {
                let along = dot(turn(b.rot, sub(f.at, b.com)), flat);
                [k + 1.0, a + along, y + f.road, aa + along * along, ay + along * f.road]
            });
            let spread = aa - a * a / k.max(1.0);
            if rolling && spread > 4.0 { ((ay - a * y / k) / spread).clamp(-HILL, HILL) * k / self.feet.len() as f32 } else { 0.0 }
        };
        // Given before the feet push, so that one told nothing holds it where it stopped.
        b.vel = sub(b.vel, scale(flat, G * self.fall * grade * h));
        let flies = self.lift > 0.0 || self.hover > 0.0;
        let n = self.feet.len().max(1) as f32;
        let drivers = self.feet.iter().filter(|f| f.drives).count().max(1) as f32;
        // What goes on legs reaches down along its frame's down, not its body's: turning to a new floor, the body
        // takes a moment to come round, and its legs must find the floor meanwhile.
        let down = if self.steer == 0.0 && self.upright > 0.0 { [0.0, -1.0, 0.0] } else { turn(b.rot, [0.0, -1.0, 0.0]) };
        let rolls = dot(b.vel, flat);
        let lat_vel = dot(b.vel, right);
        // For what rolls and does not fly, `rise > 0` is the handbrake (Space / touch Drift): unlocks the rear to drift.
        let handbrake = if rolling && !flies { rise.clamp(0.0, 1.0) } else { 0.0 };
        let boost_req = rolling && !flies && told && self.boost_ask;
        let surf = if rolling { self.surface_factor(b) } else { 1.0 };
        // Handling archetypes derived from motor stats: high-speed sports cars get sharper turn-in & playful
        // power-oversteer; heavy long-wheelbase buses/trucks get planted low-roll weight & stronger momentum.
        let sport = if rolling {
            ((self.top - 280.0) / 320.0).clamp(0.0, 1.0) * (1.0 - ((self.wheelbase - 36.0) / 24.0).clamp(0.0, 0.7))
        } else {
            0.0
        };
        let heavy = if rolling {
            ((self.wheelbase - 38.0) / 28.0).clamp(0.0, 1.0) * (1.0 - ((self.top - 260.0) / 160.0).clamp(0.0, 1.0))
        } else {
            0.0
        };
        // Burnout & launch control: stationary/slow (< 18 cells/s) with throttle + handbrake pins front brakes,
        // spins rear tires and builds launch charge; releasing handbrake unleashes a crisp 0.8 s launch grip surge.
        let in_burnout = rolling && !flies && self.on >= 2 && rolls.abs() < 18.0 && go > 0.5 && handbrake > 0.5;
        if rolling && !flies {
            if in_burnout {
                self.burnout_charge = (self.burnout_charge + h / 1.15).min(1.0);
                self.launch_timer = 0.0;
            } else if self.burnout_charge > 0.15 && handbrake < 0.2 && go > 0.3 && self.on >= 2 {
                self.launch_power = self.burnout_charge;
                self.launch_timer = 0.8;
                self.burnout_charge = 0.0;
            } else {
                self.burnout_charge = (self.burnout_charge - h * 2.2).max(0.0);
                if self.launch_timer > 0.0 {
                    let decay = if go > 0.1 { h } else { h * 3.0 };
                    self.launch_timer = (self.launch_timer - decay).max(0.0);
                }
            }
            // Nitrous / turbo boost reserve (0..1): burns for +40% thrust & +24% top speed; refills from drifting,
            // clean high-speed driving, or landing jumps.
            let want_boost = boost_req && go > 0.1 && !in_burnout;
            let min_fuel = if self.boost_on { 0.001 } else { 0.08 };
            self.boost_on = want_boost && self.boost_fuel >= min_fuel;
            if self.boost_on {
                self.boost_fuel = (self.boost_fuel - 0.36 * h).max(0.0);
                self.boost_cd = 0.55;
                if self.boost_fuel <= 0.001 {
                    self.boost_on = false;
                }
            } else {
                self.boost_cd = (self.boost_cd - h).max(0.0);
                if self.on >= 2 && self.air_time >= 0.25 {
                    let bonus = (self.air_time * 0.28).clamp(0.12, 0.35);
                    self.boost_fuel = (self.boost_fuel + bonus).min(1.0);
                }
                if self.on >= 2 {
                    let slip_abs = if rolls > 18.0 { lat_vel.abs().atan2(rolls.max(15.0)) } else { 0.0 };
                    if slip_abs > 0.18 && rolls > 22.0 {
                        self.boost_fuel = (self.boost_fuel + 0.18 * (slip_abs / 0.45).min(1.5) * h).min(1.0);
                    } else if self.boost_cd <= 0.0 {
                        if rolls > self.top * 0.45 && slip_abs < 0.14 {
                            self.boost_fuel = (self.boost_fuel + 0.08 * (rolls / self.top.max(1.0)).min(1.2) * h).min(1.0);
                        } else if rolls.abs() > 1.0 {
                            self.boost_fuel = (self.boost_fuel + 0.025 * h).min(1.0);
                        }
                    }
                }
            }
            self.air_time = if self.on == 0 { self.air_time + h } else { 0.0 };
        } else {
            self.burnout_charge = 0.0;
            self.launch_timer = 0.0;
            self.boost_on = false;
            self.air_time = 0.0;
        }
        let launch_surge = if self.launch_timer > 0.0 && go > 0.1 {
            (self.launch_timer / 0.8).clamp(0.0, 1.0) * self.launch_power
        } else {
            0.0
        };
        let boost_thrust = if self.boost_on { 1.40 } else { 1.0 };
        let boost_top = if self.boost_on { 1.24 } else { 1.0 };
        // Progressive steering ramp (fast counter-steer, smooth turn-in, crisp self-center) so keyboard taps feel
        // planted instead of twitchy, plus speed-sensitive steering falloff and mild slip-angle counter-steer assist.
        let steer_rad = if rolling {
            let rate = if turning == 0.0 {
                8.5 + 2.0 * sport - 1.0 * heavy
            } else if turning * self.steer_now < 0.0 {
                12.5 + 2.5 * sport - 1.5 * heavy
            } else {
                (6.5 + 3.0 * sport - 1.6 * heavy).max(3.5)
            };
            self.steer_now += (turning - self.steer_now) * (rate * h).min(1.0);
            if turning == 0.0 && self.steer_now.abs() < 1e-4 {
                self.steer_now = 0.0;
            }
            let ratio = (rolls.abs() / self.top.max(1.0)).min(1.5);
            let fall = 1.15 - 0.18 * sport + 0.15 * heavy;
            let curve = 1.0 / (1.0 + ratio * fall + ratio * ratio * 0.55);
            let slip = if rolls > 20.0 { lat_vel.atan2(rolls.max(15.0)) } else { 0.0 };
            let assist = if rolls > 25.0 && slip.abs() > 0.14 && handbrake < 0.8 {
                (slip * 0.35).clamp(-0.22, 0.22)
            } else {
                0.0
            };
            (self.steer * self.steer_now * curve + assist).clamp(-self.steer * 1.1, self.steer * 1.1)
        } else {
            self.steer * turning / (1.0 + rolls.abs() / self.top.max(1.0))
        };
        let (sin, cos) = steer_rad.sin_cos();
        self.on = 0;
        // Every foot meets the body as it was when the step began, and their pushes are given together after: pushed
        // one after another, each met the body as the one before left it, and whichever went first had the edge (a car
        // whose left feet always pushed first turned right, steadily: 5 m off its line in 335 m).
        let mut pushes: Vec<(V, V)> = Vec::with_capacity(self.feet.len() * 3);
        let mut held = [0.0; 3];
        let mut grips: Vec<(V, V, f32)> = Vec::with_capacity(self.feet.len());
        for foot in self.feet.iter_mut() {
            let r = turn(b.rot, sub(foot.at, b.com));
            let far = ray(ground, add(b.pos, w(r)), w(down), foot.reach);
            let Some(far) = far else {
                foot.pressed += (0.0 - foot.pressed) * (h * 30.0).min(1.0);
                foot.road = f32::NAN;
                continue;
            };
            self.on += 1;
            if rolling {
                // What rolls follows the road under each foot as a wheel does: smoothly over each riser of a road
                // that climbs a cell at a time, and with no lag at all up a steady hill, by keeping how high the road
                // is and how fast it rises. (A foot that took each riser over a thirtieth of a second, damped against
                // all the speed up, rode lower the faster it climbed: up the main street the engine's car struck the
                // road and broke at 58 km/h.) A step of a cell and a half or more is a kerb, taken at once.
                let start = add(b.pos, r);
                let met = start[1] + down[1] * far;
                let guess = foot.road + foot.rise * h;
                if (guess - met).abs() < 1.5 {
                    let e = met - guess;
                    foot.road = guess + e * (2.0 * ROAD * h).min(1.0);
                    // No road it rides rises more than one in two.
                    let most = 0.5 * rolls.abs() + 5.0;
                    foot.rise = (foot.rise + e * ROAD * ROAD * h).clamp(-most, most);
                } else {
                    (foot.road, foot.rise) = (met, 0.0);
                }
                foot.pressed = (foot.reach - (start[1] - foot.road) / -down[1].min(-0.2)).clamp(0.0, foot.reach);
            } else {
                // What goes on legs takes a step up over a thirtieth of a second, not at once.
                foot.pressed += (foot.reach - far - foot.pressed) * (h * 30.0).min(1.0);
            }
            // By the pull it feels: one who falls slowly stands as low on its legs as anyone.
            let weight = mass * G * self.fall.max(0.05);
            let spring = weight / (n * SAG * foot.reach);
            let damp = 2.0 * DAMP * (spring * mass / n).sqrt();
            // Damped against how fast it closes on the road: climbing a hill is not the spring opening.
            let rising = if rolling { foot.rise } else { 0.0 };
            // Pressed in further than it stands, what rolls stiffens, as a car's spring meets its stop.
            let more = if rolling { (foot.pressed - SAG * foot.reach).max(0.0) } else { 0.0 };
            let stop = spring * more * more / (STOP * foot.reach);
            let press = (spring * foot.pressed + stop - damp * (dot(b.speed_at(r), up) - rising)).clamp(0.0, weight * 4.0 / n);
            // What rolls is pushed along its own up, as a car's springs push, but only the up of that moves it: the
            // rest is what its tyres' grip answers, and only turns it. Pushed straight up at a foot under its middle, a
            // short cart tilted past its feet by a step went over backwards; pushed along a grade, it was thrown.
            if rolling {
                let f = scale(down, -press * h);
                pushes.push((r, f));
                held = add(held, [f[0], 0.0, f[2]]);
            } else {
                pushes.push((r, scale(up, press * h)));
            }
            // Grip and drive act most of the way up from where the foot meets the ground to the height of the thing's
            // middle: pushed at the road itself, a car at 12 m/s went onto two wheels in a turn.
            let foot_at = add(r, scale(down, far));
            let at = sub(foot_at, scale(down, dot(foot_at, down) * 0.7));
            if legs && self.reel > 0.0 {
                continue;
            }
            if legs {
                // At the height of its middle: a person who stops does not pitch over their own feet.
                let at = sub(foot_at, scale(down, dot(foot_at, down)));
                let v = b.speed_at(at);
                let more = [stride[0] - v[0], 0.0, stride[2] - v[2]];
                let long = dot(more, more).sqrt();
                let most = (self.power * mass / n * h).min(self.grip * press * h * 4.0);
                if long > 1e-4 {
                    pushes.push((at, scale(more, (long * mass / n).min(most) / long)));
                }
                continue;
            }
            let (wheel, across) = if foot.steers { (add(scale(flat, cos), scale(right, sin)), sub(scale(right, cos), scale(flat, sin))) } else { (flat, right) };
            let (base_most, share) = (self.grip * surf * press * h, mass / n);
            let along = dot(b.speed_at(at), wheel);
            // Weight-transfer, surface-aware and archetype drift grip balance: handbrake frees the rear to slide
            // while keeping the front biting; sports cars get sharper front bite & playful power-oversteer.
            let lat_grip = if rolling {
                if !foot.steers {
                    if handbrake > 0.05 {
                        base_most * (1.0 - 0.56 * handbrake)
                    } else if go > 0.5 && self.steer_now.abs() > 0.4 && rolls > 45.0 - 10.0 * sport {
                        base_most * (1.0 - (0.18 + 0.12 * sport) * (go - 0.5) * 2.0 * self.steer_now.abs())
                    } else {
                        base_most
                    }
                } else if along * go < 0.0 {
                    base_most * (1.08 + 0.06 * sport)
                } else {
                    base_most * (1.0 + 0.08 * sport)
                }
            } else {
                base_most
            };
            grips.push((at, across, lat_grip));
            if in_burnout && !foot.steers {
                // Rear wheels spin freely in place while front brakes hold the car during a burnout.
                foot.spun += (42.0 + 48.0 * self.burnout_charge) * h;
            } else {
                foot.spun += along * h;
            }
            let drive_most = if rolling && go > 0.0 && foot.drives && !in_burnout {
                base_most * (1.0 + 0.55 * launch_surge) * (if self.boost_on { 1.24 } else { 1.0 })
            } else {
                base_most
            };
            let push = if in_burnout {
                if foot.steers {
                    if along.abs() < 8.0 { -along * share } else { -along.signum() * self.grip * surf * G * 0.95 * share * h }
                } else {
                    0.0
                }
            } else if rolling && !foot.steers && handbrake > 0.05 {
                // Handbrake on the rear axle: without gas it locks down smoothly to a J-turn stop; with gas held it
                // bleeds just enough speed to hold a sweeping, smoke-billowing drift.
                if along.abs() < 6.0 && go <= 0.0 {
                    -along * share
                } else if go > 0.0 && foot.drives {
                    let top = self.top * boost_top;
                    let gear = 2.0 - (along.abs() / 30.0).min(1.0);
                    go * self.power * boost_thrust * 0.45 * gear * (1.0 - along.abs() / top.max(1.0)).clamp(0.0, 1.0) * mass / drivers * h
                        - along.signum() * self.grip * surf * G * 0.14 * mass / n * h * handbrake
                } else {
                    -along.signum() * self.grip * surf * G * (if go > 0.0 { 0.16 } else { 0.65 }) * mass / n * h * handbrake
                }
            } else if go == 0.0 || flies && self.aloft {
                // Told nothing it rolls to a stop, and stands where it stopped, on a hill too; heavy vehicles carry more momentum.
                let coast = 0.6 - 0.26 * heavy;
                if flies && self.aloft { 0.0 } else if along.abs() < 6.0 { -along * share } else { -along.signum() * self.power.max(40.0) * coast * share * h }
            } else if along * go < 0.0 {
                // Against the way it rolls: a brake, on every foot whichever of them drive, and as hard as the road will
                // hold whatever the engine (the grip caps it below). A car that drove its rear two braked with those
                // two alone and took 85 m to stop from 100 km/h.
                go * (self.power * 2.5).max(self.grip * surf * G) * mass / n * h
            } else if !foot.drives {
                if rolling && surf < 0.72 { -along * 0.06 * (1.0 - surf) * share * h } else { 0.0 }
            } else {
                // Backwards it gets to a third of its speed; forward gets boost & launch surge multipliers.
                let top = if go > 0.0 { self.top * boost_top } else { self.top * 0.35 };
                // From standing it pulls twice as hard, as in a low gear: enough to get off a heap of rubble it sits on.
                let gear = 2.0 - (along.abs() / 30.0).min(1.0);
                let mult = if go > 0.0 { boost_thrust * (1.0 + 0.45 * launch_surge) } else { 1.0 };
                let drag = if rolling && surf < 0.72 { along * 0.06 * (1.0 - surf) * share * h } else { 0.0 };
                go * self.power * mult * gear * (1.0 - along.abs() / top.max(1.0)).clamp(0.0, 1.0) * mass / drivers * h - drag
            };
            pushes.push((at, scale(wheel, push.clamp(-drive_most, drive_most))));
        }
        for (at, push) in pushes {
            kick(b, at, push);
        }
        b.vel = sub(b.vel, scale(held, b.inv_mass));
        // Then the feet grip, all of them from the body as their pushes left it, then again from the body as that left
        // it, a few times, each foot no harder in all than the road holds: read once, before the drive's push, the grip let that turn the
        // body a little every step, and a car heavier on one side went steadily off its line.
        let share = mass / n;
        let mut gripped = vec![0.0f32; grips.len()];
        for _ in 0..GRIPS {
            let more: Vec<f32> = grips.iter().zip(&gripped).map(|(&(at, across, most), &was)| (was - dot(b.speed_at(at), across) * share).clamp(-most, most) - was).collect();
            for ((&(at, across, _), was), more) in grips.iter().zip(gripped.iter_mut()).zip(more) {
                kick(b, at, scale(across, more));
                *was += more;
            }
        }
        // GTA-style handling polish for rolling vehicles: drift initiation, yaw stability, visible weight transfer
        // (launch squat, braking dive, cornering body roll bounded against flipping), and poised hill jumps.
        if rolling {
            let new_rolls = dot(b.vel, flat);
            let raw_long = if h > 0.0 { ((new_rolls - self.prev_rolls) / h).clamp(-220.0, 220.0) } else { 0.0 };
            self.prev_rolls = new_rolls;
            let raw_lat = (-new_rolls * b.spin[1]).clamp(-220.0, 220.0);
            let smooth = (h * 10.0).min(1.0);
            self.long_acc += (raw_long - self.long_acc) * smooth;
            self.lat_acc += (raw_lat - self.lat_acc) * smooth;
            let body_up = turn(b.rot, [0.0, 1.0, 0.0]);
            if self.on >= 2 && body_up[1] > 0.85 {
                // Crisp drift initiation when pulling handbrake into a corner, holding a heroic ~30-50° drift angle
                // rather than spinning out uncontrollably.
                let slip_now = if new_rolls > 15.0 { dot(b.vel, right).atan2(new_rolls) } else { 0.0 };
                let slip_allow = 0.45 + (1.0 - surf).max(0.0) * 0.35 + 0.08 * sport;
                if handbrake > 0.1 && self.steer_now.abs() > 0.1 && new_rolls > 25.0 {
                    let over = slip_now.abs();
                    let hold = (1.0 - ((over - slip_allow) / 0.42).clamp(0.0, 1.0)) * handbrake;
                    let want_yaw = -self.steer_now * (1.1 + (new_rolls / self.top.max(1.0)).min(1.0) * 0.95) * (1.0 + (1.0 - surf).max(0.0) * 0.35) * hold;
                    b.spin[1] += (want_yaw - b.spin[1]) * (h * 4.2).min(1.0);
                } else if turning == 0.0 && handbrake < 0.05 {
                    // Gently settle residual yaw rate when straightening out of a slide.
                    let settle = (2.6 + 1.4 * heavy - 0.4 * sport).max(1.5);
                    b.spin[1] *= (1.0 - settle * h).max(0.0);
                }
                // Expressive, flip-safe weight transfer: rear squats on launch/burnout/boost, nose dives on brakes,
                // chassis rolls in corners (heavy buses/trucks stay planted with reduced body roll).
                if self.on as usize >= self.feet.len() {
                    let local_right = cross(FRONTS[self.front as usize], [0.0, 1.0, 0.0]);
                    let body_right = turn(b.rot, local_right);
                    let cur_pitch = front[1] - grade;
                    let cur_roll = dot(body_up, right);
                    let max_squat = 0.026 + 0.016 * launch_surge + if self.boost_on { 0.008 } else { 0.0 };
                    let pitch_mult = 1.0 + 0.45 * launch_surge + if self.boost_on { 0.25 } else { 0.0 };
                    let pitch_torque = if in_burnout && cur_pitch < 0.016 {
                        0.45 * self.burnout_charge * h
                    } else if (self.long_acc > 8.0 && cur_pitch < max_squat) || (self.long_acc < -8.0 && cur_pitch > -0.045) {
                        (self.long_acc / 150.0 * pitch_mult).clamp(-1.8, 1.45) * h
                    } else {
                        0.0
                    };
                    let max_roll = 0.085 - 0.045 * heavy - 0.012 * sport;
                    let roll_mult = 1.0 - 0.55 * heavy - 0.15 * sport;
                    let mut roll_torque = if (self.lat_acc > 12.0 && cur_roll > -max_roll) || (self.lat_acc < -12.0 && cur_roll < max_roll) {
                        -(self.lat_acc / 75.0 * roll_mult).clamp(-2.8, 2.8) * h
                    } else {
                        0.0
                    };
                    if heavy > 0.0 && cur_roll.abs() > 0.012 {
                        // Heavy long-wheelbase anti-roll bar keeps buses and trucks planted in corners.
                        roll_torque -= (cur_roll * 18.0 * heavy).clamp(-2.8, 2.8) * h;
                    }
                    if pitch_torque != 0.0 || roll_torque != 0.0 {
                        b.spin = add(b.spin, add(scale(body_right, pitch_torque), scale(flat, roll_torque)));
                    }
                }
            } else if self.on == 0 {
                // Airborne off a hill crest: damp wild pitch/roll tumble while keeping true ballistic trajectory.
                let damp = (1.0 - 1.4 * h).max(0.0);
                b.spin[0] *= damp;
                b.spin[2] *= damp;
            }
        }
        self.reel = (self.reel - h).max(0.0);
        let touching = self.on > 0 || b.apart < 0.05;
        if flies {
            // What only flies (a helicopter) sits on the ground until told to rise, and sits again when it is set down.
            if self.hover > 0.0 || rise > 0.0 {
                self.aloft = true
            } else if rise < 0.0 && touching {
                self.aloft = false
            }
        }
        if self.upright > 0.0 {
            if self.steer == 0.0 || self.feet.is_empty() || self.aloft {
                self.heading += turning * self.turns * h;
            } else {
                self.heading = flat[2].atan2(flat[0]);
            }
            // A roll that was asked for is turned through in four fifths of a second.
            if self.rolling > 0.0 {
                let d = (std::f32::consts::TAU / 0.8 * h).min(self.rolling);
                self.rolling -= d;
                self.rolled = if self.rolling > 0.0 { self.rolled + d } else { 0.0 };
            }
            // In the air it noses down as it goes and banks as it turns.
            // What flies leans into its way; what only rides over the ground and the water (no lift) stays level: a hull that
            // dipped its bow a sixth of a turn dug it into the beach.
            let (nose, bank) = if self.aloft && self.lift > 0.0 { (-go * 0.18, turning * 0.3) } else { (0.0, 0.0) };
            let first = [about(1, 0.0), about(1, std::f32::consts::PI), about(1, std::f32::consts::FRAC_PI_2), about(1, -std::f32::consts::FRAC_PI_2)][self.front as usize];
            let want = qmul(qmul(qmul(about(1, -self.heading), about(2, nose)), about(0, bank + self.rolled)), first);
            let mut e = qmul(want, [-b.rot[0], -b.rot[1], -b.rot[2], b.rot[3]]);
            if e[3] < 0.0 {
                e = e.map(|v| -v);
            }
            // The turn still to make, as a spin: all of it in a tenth of a second, no faster than two turns a second.
            let mut spin = scale([e[0], e[1], e[2]], 20.0);
            let fast = dot(spin, spin).sqrt();
            if fast > 12.0 {
                spin = scale(spin, 12.0 / fast);
            }
            b.spin = add(b.spin, scale(sub(spin, b.spin), (self.upright * h).min(1.0)));
        }
        let ahead = [self.heading.cos(), 0.0, self.heading.sin()];
        if flies && self.aloft {
            // The air carries it.
            b.vel[1] += G * h;
            let fastest = if self.lift > 0.0 { self.lift } else { self.hover * 2.0 };
            let mut climb = rise * fastest;
            if self.hover > 0.0 && rise == 0.0 {
                // Told nothing, near the ground, it settles at its height over it; far above, it stays where it is.
                let under = b.com[1];
                // The still sea is a plane and no cells (city.rs): what hovers rides its top as it rides the ground, so a
                // hull crosses water and comes up a beach. (Without this it sank to the sea's floor and hung over that.)
                let reach = under + self.hover * 3.0;
                let sea = b.pos[1] - (crate::city::SEA + 1) as f32;
                // The ground under its middle, or under its bow if that is nearer: a long hull met a rising beach with
                // its bow while its middle was still well clear, and dug in.
                let bow = add(b.pos, w(scale([self.heading.cos(), 0.0, self.heading.sin()], b.radius * 0.7 * if go < 0.0 { -1.0 } else { 1.0 })));
                let land = match (ray(ground, b.pos, w([0.0, -1.0, 0.0]), reach), ray(ground, bow, w([0.0, -1.0, 0.0]), reach)) { (Some(m), Some(f)) => Some(m.min(f)), (m, f) => m.or(f) };
                let far = if frame.is_none() && sea >= 0.0 && sea <= reach { Some(land.map_or(sea, |l| l.min(sea))) } else { land };
                if let Some(far) = far {
                    climb = ((self.hover + under - far) * 4.0).clamp(-fastest, fastest);
                }
            }
            b.vel[1] += (climb - b.vel[1]) * (h * 6.0).min(1.0);
            let want = add(scale(ahead, go * self.top), scale([-ahead[2], 0.0, ahead[0]], side * self.top));
            let mut more = [want[0] - b.vel[0], 0.0, want[2] - b.vel[2]];
            let (long, most) = (dot(more, more).sqrt(), self.power * h);
            if long > most {
                more = scale(more, most / long);
            }
            b.vel = add(b.vel, more);
        }
        // What falls slowly, or not at all, is given back that much of the world's pull.
        if self.fall != 1.0 && !(flies && self.aloft) {
            b.vel[1] += G * h * (1.0 - self.fall);
        }
        // Told to go on against a wall, what can climb goes up it: as high as it climbs, from where its feet left the
        // ground, until its feet are over the top. Looked for ahead at its middle and at its feet.
        if legs && self.climb > 0.0 && go > 0.0 && !(flies && self.aloft) {
            let reach = b.radius.min(4.0) + 2.5;
            let low = add(b.pos, w(scale(down, b.com[1] + 2.0)));
            let wall = ray(ground, b.pos, w(ahead), reach).is_some() || ray(ground, low, w(ahead), reach).is_some();
            if self.on > 0 && self.climbing.is_none_or(|from| b.pos[1] < from) {
                self.climbing = Some(b.pos[1]);
            }
            if wall && self.climbing.is_some_and(|from| b.pos[1] - from < self.climb) {
                // No slower than half its pace, whatever rubs: eased towards that speed, one who walked into the
                // wall (and so pressed on it less than one who ran, but rubbed all the same) rose a cell and stopped.
                b.vel[1] = (b.vel[1] + G * h * self.fall).max(self.top * 0.5 * go.max(0.6));
            }
        } else if self.on > 0 {
            self.climbing = None;
        }
        // What clings looks for its next floor: a face ahead of its middle as it goes, or, its floor just lost, the
        // face round the edge (looked for from ahead of and under its feet, back the way it came).
        self.lost = if self.on > 0 { 0.0 } else { self.lost + h };
        // Its floor just turned, its legs find the new one nearer than they stand and push: it is not thrown off it
        // (it was, at 3.8 m/s, and up a low wall reached the top before it came back).
        if self.fresh > 0.0 {
            self.fresh -= h;
            b.vel[1] = b.vel[1].min(4.0);
        }
        if legs && self.cling && go > 0.0 && !(flies && self.aloft) {
            let under = b.com[1] + 4.0;
            let reach = b.radius.min(4.0) + 1.5;
            if self.on > 0 && ray(ground, b.pos, w(ahead), reach).is_some() {
                self.turning = 1;
            } else if ray(ground, b.pos, w(ahead), reach + 4.0).is_none() && ray(ground, add(b.pos, w([0.0, -under + 3.0, 0.0])), w(ahead), reach + 1.0).is_some() {
                // Something in its way that is lower than its middle (a sill, a lintel, a kerb too high to step):
                // it goes over it, as one who climbs goes up a wall, and its floor stays its floor.
                // Up no faster than it needs and on at its pace: thrown up off a wall it lost the wall and fell.
                b.vel[1] = (b.vel[1] + G * h * self.fall).max(self.top * 0.3 * go.max(0.6));
                (b.vel[0], b.vel[2]) = (stride[0], stride[2]);
                self.lost = 0.0;
            } else if self.on == 0 && (0.0..0.25).contains(&self.lost) {
                let from = add(b.pos, w(add(scale(ahead, 5.0), [0.0, -under - 2.0, 0.0])));
                if ray(ground, from, w(scale(ahead, -1.0)), 9.0).is_some_and(|far| far > 0.0) {
                    self.turning = -1;
                }
            }
        }
        // In the air what goes on legs can still be steered a little.
        if legs && self.on == 0 && !(flies && self.aloft) && (go != 0.0 || side != 0.0) {
            let more = [stride[0] - b.vel[0], 0.0, stride[2] - b.vel[2]];
            let (long, most) = (dot(more, more).sqrt(), self.power * 0.2 * h);
            b.vel = add(b.vel, scale(more, most.min(long) / long.max(1e-4)));
        }
        if self.hop {
            self.hop = false;
            if self.jump > 0.0 && touching && !(flies && self.aloft) {
                if legs {
                    // A jump on legs keeps the speed it had along the ground.
                    b.vel[1] = b.vel[1].max(0.0) + self.jump;
                } else {
                    let way = if self.upright > 0.0 { ahead } else { flat };
                    b.vel = add(scale(way, go * self.top), [0.0, b.vel[1].max(0.0) + self.jump, 0.0]);
                }
            }
        }
    }
}

/// What struck what (the `STRUCK` record): told for sound, and for whoever wants to know what a thing ran into.
pub struct Struck {
    pub a: u32,
    pub b: u32,
    pub at: V,
    pub speed: f32,
    pub push: f32,
    pub kinds: [Kind; 2],
    pub flags: u32,
}
/// The slowest two things may meet and be told of (cells a second), and how many meetings a call tells of.
pub const STRUCK_FROM: f32 = 8.0;
pub const STRUCK_MOST: usize = 8;

impl Body {
    /// The kind of the body's own cell at one of its points (`r` from its middle of mass, as it is turned): a point
    /// is a corner, so it is whichever of the eight cells round it there is.
    fn kind_at(&self, r: V) -> Kind {
        let c = add(back(self.rot, r), self.com).map(|v| v.round() as i32);
        for d in 0..8 {
            let cell = [c[0] - (d & 1), c[1] - (d >> 1 & 1), c[2] - (d >> 2 & 1)];
            if self.solid(cell) {
                return self.cells[self.at(cell[0] as usize, cell[1] as usize, cell[2] as usize)];
            }
        }
        self.stuff as Kind
    }
}

impl Bodies {
    /// Every living thing that is awake is moved by its motor.
    pub(super) fn motors(&mut self, h: f32) {
        for i in 0..self.list.len() {
            if self.list[i].asleep {
                continue;
            }
            let Some(mut live) = self.list[i].live.take() else { continue };
            live.step(&mut self.list[i], &mut self.ground, h);
            live.was = self.list[i].vel;
            self.list[i].live = Some(live);
        }
    }

    /// A living thing that has lain quiet for a second, told nothing, sleeps: it is not stepped again until it is
    /// told something, struck, or the world near it changes. Putting it down as cells would cut one that stands
    /// askew along the world's cells each time, and a parked car would wear away.
    pub(super) fn drowse(b: &mut Body, h: f32) {
        let (slow, still) = (dot(b.vel, b.vel) < 2.25, dot(b.spin, b.spin) < 0.01);
        let Some(live) = &mut b.live else { return };
        live.quiet = if live.idle() && slow && still { live.quiet + h } else { 0.0 };
        if live.quiet >= QUIET {
            live.quiet = 0.0;
            b.asleep = true;
            b.vel = [0.0; 3];
            b.spin = [0.0; 3];
        }
    }

    /// Wakes every sleeper whose reach touches a box of the world that has changed.
    pub(super) fn stir(&mut self, lo: [i32; 3], hi: [i32; 3]) {
        for b in &mut self.list {
            if b.asleep && (0..3).all(|a| b.pos[a] + b.radius + 2.0 >= lo[a] as f32 && b.pos[a] - b.radius - 2.0 <= hi[a] as f32) {
                b.asleep = false;
            }
        }
    }

    /// Wakes the sleepers an edit from outside the solver reaches: a blast across town leaves a parked car asleep.
    pub fn stir_edit(&mut self, e: &Edit) {
        let (lo, hi) = reach(e);
        self.stir(lo, hi);
    }

    /// A blast's push on the living things near it: thrown as what it loosens is, and one that it reaches is broken.
    pub(super) fn shove(&mut self, at: [i32; 3], radius: i32) {
        let centre = [at[0] as f32, at[1] as f32, at[2] as f32];
        let r = radius as f32;
        for b in &mut self.list {
            let away = sub(b.pos, centre);
            let far = dot(away, away).sqrt();
            if b.live.as_ref().is_none_or(|live| live.ghost) || far > r * 3.0 + b.radius {
                continue;
            }
            b.asleep = false;
            let push = (30.0 * r * r / (far + r) / (b.count as f32).cbrt()).min(160.0);
            b.vel = add(b.vel, scale(add(unit(away), [0.0, 0.35, 0.0]), push));
            b.spin = add(b.spin, scale(unit(cross([0.0, 1.0, 0.0], away)), (push * 0.05).min(4.0)));
            if far < r + b.radius * 0.5 {
                if let Some(live) = &mut b.live {
                    live.hurt = true;
                }
            }
        }
    }

    /// A living thing of given cells (laid out as a body's are) with its low corner at a place. With `take`, those
    /// cells are taken out of the world as it is born: a thing that stood there as cells gets up. Returns its id, or
    /// nothing if there is nothing of it.
    pub fn spawn(&mut self, cells: Vec<Kind>, size: [usize; 3], low: [i32; 3], take: bool) -> u32 {
        self.spawned = 0;
        if cells.len() != size[0] * size[1] * size[2] || cells.iter().all(|&k| k == 0) || size.iter().any(|&s| s > 96) {
            return 0;
        }
        if take {
            let mut runs: Vec<Run> = Vec::new();
            for y in 0..size[1] {
                for z in 0..size[2] {
                    for x in 0..size[0] {
                        if cells[x + size[0] * (z + size[2] * y)] != 0 {
                            let (wx, wy, wz) = (low[0] + x as i32, low[1] + y as i32, low[2] + z as i32);
                            match runs.last_mut() {
                                Some(r) if r.y == wy && r.z == wz && r.x1 == wx => r.x1 += 1,
                                _ => runs.push(Run { x0: wx, x1: wx + 1, y: wy, z: wz, kind: 0 }),
                            }
                        }
                    }
                }
            }
            self.change(runs);
        }
        let mut body = Body::new(self.next, cells, size, low);
        self.next += 1;
        let mut live = Live::new();
        live.heading = 0.0;
        body.live = Some(Box::new(live));
        self.born(&body);
        self.list.push(body);
        self.spawned = self.next - 1;
        self.spawned
    }

    fn living(&mut self, id: u32) -> Option<&mut Body> {
        self.list.iter_mut().find(|b| b.id == id && b.live.is_some())
    }

    /// Gives a living thing its motor (`Live::set`). Its heading is where it faces now.
    pub fn motor(&mut self, id: u32, numbers: &[f32]) -> bool {
        let Some(b) = self.living(id) else { return false };
        let rot = b.rot;
        let live = b.live.as_mut().unwrap();
        if !live.set(numbers) {
            return false;
        }
        let front = turn(rot, FRONTS[live.front as usize]);
        live.heading = front[2].atan2(front[0]);
        // A wheel is where a foot is: the foot carries the thing, and the wheel's own cells under it meet nothing,
        // or they would catch on every riser of the road as a box's corners do.
        let feet: Vec<(V, f32)> = live.feet.iter().map(|f| (f.at, f.reach)).collect();
        let com = b.com;
        b.points.retain(|p| {
            let q = add(*p, com);
            !feet.iter().any(|(at, reach)| q[1] < at[1] && (q[0] - at[0]).abs() <= *reach && (q[2] - at[2]).abs() <= *reach)
        });
        b.asleep = false;
        true
    }

    /// Tells a living thing what to do until it is told again, or for a second: go and turn and rise from -1 to 1,
    /// and whether to roll over once and to jump.
    pub fn drive(&mut self, id: u32, go: f32, turn: f32, rise: f32, roll: bool, jump: bool) -> bool {
        let Some(b) = self.living(id) else { return false };
        let live = b.live.as_mut().unwrap();
        let clean = |v: f32| if v.is_finite() { v.clamp(-1.0, 1.0) } else { 0.0 };
        (live.go, live.turn, live.rise) = (clean(go), clean(turn), clean(rise));
        live.heard = 0.0;
        if roll && live.rolling == 0.0 && live.upright > 0.0 {
            live.rolling = std::f32::consts::TAU;
        }
        live.hop |= jump;
        if !live.idle() {
            b.asleep = false;
        }
        true
    }

    /// Extra driving state for a living vehicle (#28): nitrous boost (`boost > 0.5`), rain wetness (`0..1`),
    /// and optional explicit surface grip override (`> 0` overrides `city::top`, `<= 0` uses auto detection).
    pub fn drive_aux(&mut self, id: u32, boost: f32, wetness: f32, surface_grip: f32) -> bool {
        let Some(b) = self.living(id) else { return false };
        let live = b.live.as_mut().unwrap();
        live.boost_ask = boost.is_finite() && boost > 0.5;
        if wetness.is_finite() {
            live.wetness = wetness.clamp(0.0, 1.0);
        }
        if surface_grip.is_finite() {
            live.surface_grip = if surface_grip > 0.0 { surface_grip.clamp(0.3, 1.5) } else { 0.0 };
        }
        if live.boost_ask {
            b.asleep = false;
        }
        true
    }

    /// Puts a living thing where it was: its middle of mass at a place, turned so, still. For a world that is
    /// started again, whose bodies are lost: each thing gets up where it last slept.
    pub fn place(&mut self, id: u32, pos: V, rot: Q) -> bool {
        let long = (rot[0] * rot[0] + rot[1] * rot[1] + rot[2] * rot[2] + rot[3] * rot[3]).sqrt();
        if !(long > 0.5 && long < 2.0) || pos.iter().any(|v| !v.is_finite()) {
            return false;
        }
        let Some(b) = self.living(id) else { return false };
        (b.pos, b.rot, b.vel, b.spin, b.asleep) = (pos, rot.map(|v| v / long), [0.0; 3], [0.0; 3], false);
        if b.live.as_ref().unwrap().ghost {
            // A ghost sleeps where it is put, its points turned as it now stands for whatever comes at it.
            let rot = b.rot;
            b.turned = b.points.iter().map(|&p| turn(rot, p)).collect();
            b.asleep = true;
            return true;
        }
        let front = turn(b.rot, FRONTS[b.live.as_ref().unwrap().front as usize]);
        let live = b.live.as_mut().unwrap();
        live.heading = front[2].atan2(front[0]);
        (live.steer_now, live.prev_rolls, live.long_acc, live.lat_acc) = (0.0, 0.0, 0.0, 0.0);
        (live.burnout_charge, live.launch_timer, live.launch_power) = (0.0, 0.0, 0.0);
        (live.boost_ask, live.boost_on, live.boost_fuel, live.boost_cd, live.air_time) = (false, false, 1.0, 0.0, 0.0);
        (live.surf_cell, live.surf_base) = ([i32::MIN; 2], 1.0);
        // What its feet knew of the road was where it stood before.
        for foot in &mut live.feet {
            (foot.road, foot.rise) = (f32::NAN, 0.0);
        }
        true
    }

    /// Someone's body (#264): a living thing that is a plain box of cells nobody draws, so wide, so tall and so deep,
    /// with its low corner at a place. It is moved as any living thing is, by its motor and what it is told
    /// (`walk`); the figure is drawn at it by whoever draws people. Returns its id.
    pub fn figure(&mut self, size: [usize; 3], low: [i32; 3]) -> u32 {
        self.spawned = 0;
        if size.iter().any(|&s| s == 0 || s > 32) {
            return 0;
        }
        let mut body = Body::new(self.next, vec![crate::kinds::kind(crate::kinds::WOOD, crate::kinds::OWN); size[0] * size[1] * size[2]], size, low);
        self.next += 1;
        let mut live = Live::new();
        live.figure = true;
        body.live = Some(Box::new(live));
        let mut words = vec![body.id, size[0] as u32, size[1] as u32, size[2] as u32];
        words.extend(body.com.iter().map(|v| v.to_bits()));
        self.record(FIGURE, &words);
        self.list.push(body);
        self.spawned = self.next - 1;
        self.spawned
    }

    /// A ghost (`Live::ghost`): a box so wide, tall and deep with its low corner at a place, for a body that is
    /// moved elsewhere. Put it where that body is with `place`. Nothing is told of its birth. Returns its id.
    pub fn ghost(&mut self, size: [usize; 3], low: [i32; 3]) -> u32 {
        self.spawned = 0;
        if size.iter().any(|&s| s == 0 || s > 32) {
            return 0;
        }
        let mut body = Body::new(self.next, vec![crate::kinds::kind(crate::kinds::WOOD, crate::kinds::OWN); size[0] * size[1] * size[2]], size, low);
        self.next += 1;
        let mut live = Live::new();
        (live.figure, live.ghost) = (true, true);
        body.live = Some(Box::new(live));
        body.turned = body.points.clone();
        body.asleep = true;
        self.list.push(body);
        self.spawned = self.next - 1;
        self.spawned
    }

    /// A push on a living thing: so much speed added to it at once (cells a second), as a blow gives.
    pub fn kick(&mut self, id: u32, speed: V) -> bool {
        let Some(b) = self.living(id) else { return false };
        if speed.iter().any(|v| !v.is_finite()) {
            return false;
        }
        b.vel = add(b.vel, speed.map(|v| v.clamp(-2000.0, 2000.0)));
        b.asleep = false;
        if let Some(live) = &mut b.live {
            live.quiet = 0.0;
            // Carried by it for a third of a second: legs that stopped it at once made a blow a twitch.
            live.reel = 0.35;
        }
        true
    }

    /// Tells what goes on legs where to face and how to go: `heading` is the way it faces (its front at cos, 0,
    /// sin of it), go and side from -1 to 1 forward and to its right, rise up and down for what flies, and
    /// whether to jump. Held for a second, as `drive` is.
    pub fn walk(&mut self, id: u32, heading: f32, go: f32, side: f32, rise: f32, jump: bool) -> bool {
        let Some(b) = self.living(id) else { return false };
        let live = b.live.as_mut().unwrap();
        let clean = |v: f32| if v.is_finite() { v.clamp(-1.0, 1.0) } else { 0.0 };
        (live.go, live.side, live.rise, live.turn) = (clean(go), clean(side), clean(rise), 0.0);
        let turned = heading.is_finite() && (heading - live.heading).abs() > 1e-3;
        if heading.is_finite() {
            live.heading = heading;
        }
        live.heard = 0.0;
        live.hop |= jump;
        if !live.idle() || turned {
            live.quiet = 0.0;
            b.asleep = false;
        }
        true
    }

    /// Takes a living thing out of the world at once, leaving nothing: someone's body when they go.
    pub fn vanish(&mut self, id: u32) -> bool {
        let Some(at) = self.list.iter().position(|b| b.id == id && b.live.is_some()) else { return false };
        let body = self.list.swap_remove(at);
        // Told as a body that is no more, with nothing born of it.
        self.record(BROKE, &[body.id]);
        true
    }

    /// How a living thing falls and climbs (`Live::fall`, `Live::climb`): numbers beside its motor's.
    pub fn ways(&mut self, id: u32, fall: f32, climb: f32) -> bool {
        let Some(b) = self.living(id) else { return false };
        if !fall.is_finite() || !climb.is_finite() {
            return false;
        }
        let live = b.live.as_mut().unwrap();
        (live.fall, live.climb) = (fall.clamp(0.0, 3.0), climb.clamp(0.0, 100_000.0));
        b.asleep = false;
        true
    }

    /// Which way is down for a living thing: a way (it need not be a unit; nothing puts it back as the world's), and
    /// whether it clings, turning its down to whatever face it walks onto.
    pub fn down(&mut self, id: u32, way: V, cling: bool) -> bool {
        let Some(b) = self.living(id) else { return false };
        if way.iter().any(|v| !v.is_finite()) {
            return false;
        }
        let long = dot(way, way).sqrt();
        // The turn that takes the world's down to that way, the short way round; straight up is half a turn about x.
        let base = if long < 1e-3 || (way[1] / long) < -0.9999 {
            None
        } else {
            let d = scale(way, 1.0 / long);
            let (axis, cos) = (cross([0.0, -1.0, 0.0], d), -d[1]);
            if cos < -0.9999 { Some([1.0, 0.0, 0.0, 0.0]) } else {
                let s = ((1.0 + cos) * 2.0).sqrt();
                Some([axis[0] / s, axis[1] / s, axis[2] / s, s * 0.5])
            }
        };
        let live = b.live.as_mut().unwrap();
        (live.base, live.frame, live.cling, live.turning) = (base, base, cling, 0);
        b.asleep = false;
        true
    }

    /// A living thing lives no more: it is a body like any other, and lies down as cells when it is still.
    pub fn end(&mut self, id: u32) -> bool {
        let Some(b) = self.living(id) else { return false };
        b.live = None;
        b.asleep = false;
        true
    }

    /// Of this step's touches, the hardest meetings are kept to be told: one for each pair of things, from how fast
    /// they were closing when the step began. Things that rest on each other close at next to nothing and are not told.
    pub(super) fn meetings(&mut self) -> usize {
        let from = self.struck.len();
        let mut found: Vec<(Struck, usize)> = Vec::new();
        let mut t = 0;
        while t < self.touches.len() {
            let (a, b) = (self.touches[t].a, self.touches[t].b);
            let (mut hardest, mut push) = (t, 0.0);
            let mut end = t;
            while end < self.touches.len() && self.touches[end].a == a && self.touches[end].b == b {
                if self.touches[end].closing < self.touches[hardest].closing {
                    hardest = end;
                }
                push += self.touches[end].pushed;
                end += 1;
            }
            t = end;
            let touch = &self.touches[hardest];
            if -touch.closing < STRUCK_FROM {
                continue;
            }
            let body = &self.list[a];
            let flags = body.live.is_some() as u32 | if b != NONE && self.list[b].live.is_some() { 2 } else { 0 };
            found.push((Struck { a: body.id, b: if b == NONE { 0 } else { self.list[b].id }, at: add(body.pos, touch.ra), speed: -touch.closing, push, kinds: [0, 0], flags }, hardest));
        }
        // Only the hardest few of a call are told, so only those of this step that could be among them are finished:
        // what the world is made of is not cheap to ask.
        found.sort_unstable_by(|x, y| y.0.push.total_cmp(&x.0.push));
        found.truncate(STRUCK_MOST);
        for (mut s, k) in found {
            let (a, b, ra, n) = { let t = &self.touches[k]; (t.a, t.b, t.ra, t.n) };
            let theirs = if b == NONE {
                self.met(s.at, n).map_or(0, |c| self.ground.kind(c[0], c[1], c[2]))
            } else {
                let other = &self.list[b];
                let (cell, _) = other.cell_at(s.at);
                if other.solid(cell) { other.cells[other.at(cell[0] as usize, cell[1] as usize, cell[2] as usize)] } else { other.stuff as Kind }
            };
            s.kinds = [self.list[a].kind_at(ra), theirs];
            self.struck.push(s);
        }
        from
    }

    /// The cell of the standing world that a touch at `p`, pushed out along `n`, was against: a little back into
    /// it, for the touch has been eased out by now, and not far, for a thin wall is soon passed.
    pub(super) fn met(&mut self, p: V, n: V) -> Option<[i32; 3]> {
        [0.3, 0.0, 0.6, 1.0].into_iter().map(|deep| sub(p, scale(n, deep)).map(|v| v.floor() as i32)).find(|c| self.ground.solid(c[0], c[1], c[2]))
    }

    /// Marks the meetings of this step that a thing was in as ones that broke something.
    pub(super) fn broke(&mut self, id: u32, from: usize) {
        for s in &mut self.struck[from..] {
            if s.a == id || s.b == id {
                s.flags |= 4;
            }
        }
    }

    /// Tells how each living thing that is awake is doing: for a readout, for drawing its wheels, and for finding what holds one that will not move.
    pub(super) fn tell_live(&mut self) {
        let mut words: Vec<u32> = Vec::new();
        for (i, b) in self.list.iter().enumerate() {
            let Some(live) = &b.live else { continue };
            if b.asleep {
                continue;
            }
            let front = turn(b.rot, FRONTS[live.front as usize]);
            let touches = self.touches.iter().filter(|t| t.a == i || t.b == i).count() as u32;
            let told = if live.heard < HOLD { [live.go, live.turn, live.rise] } else { [0.0; 3] };
            let q = live.frame.unwrap_or([0.0, 0.0, 0.0, 1.0]);
            let mut flags = live.aloft as u32;
            if live.rides() {
                if live.boost_on { flags |= 2; }
                if live.launch_timer > 0.0 { flags |= 4; }
                flags |= ((live.boost_fuel.clamp(0.0, 1.0) * 255.0).round() as u32) << 8;
                flags |= ((live.burnout_charge.clamp(0.0, 1.0) * 255.0).round() as u32) << 16;
            }
            words.extend([b.id, dot(b.vel, front).to_bits(), live.on, touches, told[0].to_bits(), told[1].to_bits(), told[2].to_bits(), flags, q[0].to_bits(), q[1].to_bits(), q[2].to_bits(), q[3].to_bits()]);
        }
        if !words.is_empty() {
            self.record(LIVE, &words);
        }
    }

    /// Tells the hardest meetings since the last call.
    pub(super) fn tell_struck(&mut self) {
        let mut struck = std::mem::take(&mut self.struck);
        struck.sort_unstable_by(|x, y| y.push.total_cmp(&x.push));
        for s in struck.iter().take(STRUCK_MOST) {
            self.record(STRUCK, &[s.a, s.b, s.at[0].to_bits(), s.at[1].to_bits(), s.at[2].to_bits(), s.speed.to_bits(), s.push.to_bits(), s.kinds[0] as u32, s.kinds[1] as u32, s.flags]);
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::kinds::{BRICK, OWN, STEEL, WOOD, kind};

    /// The street the solver's own tests use: it rises along x, two cells in four metres.
    const X: i32 = 700;
    const Z: i32 = 4070;

    /// A box with walls one cell thick.
    pub fn shell(size: [usize; 3], k: Kind) -> Vec<Kind> {
        let mut cells = vec![0; size[0] * size[1] * size[2]];
        for y in 0..size[1] {
            for z in 0..size[2] {
                for x in 0..size[0] {
                    if x == 0 || y == 0 || z == 0 || x == size[0] - 1 || y == size[1] - 1 || z == size[2] - 1 {
                        cells[x + size[0] * (z + size[2] * y)] = k;
                    }
                }
            }
        }
        cells
    }

    const CAR: [usize; 3] = [42, 10, 18];
    /// The engine's own car, as the page makes it (`page/living.ts` `car`): a steel shell 4.2 m long under a glass
    /// cabin, four wheels with a foot at each, the front two steering and the back two driving, 6 m/s gathered each
    /// second up to 20 m/s. Its wheels stand over the road on their feet: nothing of it but its feet meets the road.
    pub fn car(bodies: &mut Bodies, low: [i32; 3]) -> u32 {
        laden(bodies, low, 0)
    }

    /// The engine's car with so many cells of steel laid inside its lower shell along its right side (+z), from the
    /// side in: a car as lopsided as one made from words or a photograph is.
    pub fn laden(bodies: &mut Bodies, low: [i32; 3], load: usize) -> u32 {
        let mut cells = vec![0; CAR[0] * CAR[1] * CAR[2]];
        let mut set = |x: usize, y: usize, z: usize, k: Kind| cells[x + CAR[0] * (z + CAR[2] * y)] = k;
        for y in 2..10 {
            for z in 1..17 {
                for x in 0..42 {
                    let cabin = y >= 6;
                    if cabin && !(10..31).contains(&x) {
                        continue;
                    }
                    let (x0, x1, y0, y1) = if cabin { (10, 30, 6, 9) } else { (0, 41, 2, 5) };
                    if x == x0 || x == x1 || z == 1 || z == 16 || y == y0 || y == y1 {
                        set(x, y, z, if cabin && y > 6 && y < 9 { kind(crate::kinds::GLASS, OWN) } else { kind(STEEL, OWN) });
                    }
                }
            }
        }
        for z in [3, 4, 13, 14] { for y in [3, 4] { set(41, y, z, kind(crate::kinds::LAMP, OWN)); } }
        for k in 0..load {
            let (x, y, z) = (1 + k % 40, 3 + k / 40 % 2, 15 - k / 80);
            set(x, y, z, kind(STEEL, OWN));
        }
        for x0 in [4, 32] {
            for z in [0, 17] {
                for x in x0..x0 + 6 {
                    for y in 0..6 {
                        if !((x == x0 || x == x0 + 5) && (y == 0 || y == 5)) {
                            set(x, y, z, kind(STEEL, OWN));
                        }
                    }
                }
            }
        }
        let id = bodies.spawn(cells, CAR, low, false);
        let mut numbers = vec![0.0, 1.3, 60.0, 200.0, 0.55, 0.0, 0.0, 0.0, 0.0, 0.0, 120.0];
        for (x, z, front) in [(7.0, 1.0, false), (7.0, 17.0, false), (35.0, 1.0, true), (35.0, 17.0, true)] {
            numbers.extend([x, 3.0, z, 6.0, front as u32 as f32, !front as u32 as f32]);
        }
        assert!(bodies.motor(id, &numbers));
        id
    }

    /// A car as fast as a real one (`~/.village/engine/fast-voxels`, the BMW X3's measured motor): 240 km/h at the
    /// top, 0 to 100 in 6.3 s, all four feet driving. A steel shell 4.8 m by 2.2 m with its floor so many cells up
    /// (2 is a real car's 0.2 m; at none it scrapes the road).
    pub fn fast_car(bodies: &mut Bodies, low: [i32; 3], floor: usize) -> u32 {
        let size = [48usize, 16, 22];
        let mut cells = shell(size, kind(STEEL, OWN));
        for y in 0..floor { for z in 0..size[2] { for x in 0..size[0] { cells[x + size[0] * (z + size[2] * y)] = 0; } } }
        let id = bodies.spawn(cells, size, low, false);
        let mut numbers = vec![0.0, 0.88, 56.0, 666.7, 0.716, 0.0, 0.0, 0.0, 0.0, 0.0, 120.0];
        for (x, z, reach, front) in [(38.56, 2.7, 5.94, true), (38.56, 19.3, 5.94, true), (9.62, 2.7, 7.09, false), (9.62, 19.3, 7.09, false)] {
            numbers.extend([x, 3.88, z, reach, front as u32 as f32, 1.0]);
        }
        assert!(bodies.motor(id, &numbers));
        id
    }

    /// A level strip of road high over the town, 3 km long and 35 m wide, its top at 2400. Returns where a car's
    /// low corner goes on it, at x 760.
    pub fn level(bodies: &mut Bodies) -> [i32; 3] {
        let runs: Vec<Run> = (2398..2400).flat_map(|y| (3900..4250).map(move |z| Run { x0: 0, x1: 30000, y, z, kind: kind(crate::kinds::ASPHALT, OWN) })).collect();
        bodies.ground.push(Edit::Runs(runs), false, None);
        [760, 2403, 4055]
    }

    /// Where a car's low corner goes on the main street at x 760: the lane between z 4046 and 4094 is clear for a
    /// kilometre, and climbs 4% to 13%.
    pub fn street() -> [i32; 3] {
        [760, city::ground(785, 4065) + 4, 4055]
    }

    /// How far its lowest point that can meet the world is over the ground under it (cells).
    pub fn clearance(bodies: &mut Bodies, id: u32) -> f32 {
        let b = bodies.list.iter().find(|b| b.id == id).unwrap();
        let points: Vec<V> = b.points.iter().map(|&p| add(b.pos, turn(b.rot, p))).collect();
        points.iter().map(|p| {
            let (x, z) = (p[0].floor() as i32, p[2].floor() as i32);
            let mut y = p[1].floor() as i32 + 2;
            while y > p[1] as i32 - 40 && !bodies.ground.solid(x, y, z) { y -= 1; }
            p[1] - (y + 1) as f32
        }).fold(f32::MAX, f32::min)
    }

    /// How far its feet are pressed in, on the mean (cells).
    pub fn pressed(bodies: &Bodies, id: u32) -> f32 {
        let feet = &the(bodies, id).live.as_ref().unwrap().feet;
        feet.iter().map(|f| f.pressed).sum::<f32>() / feet.len() as f32
    }

    /// What a run flat out showed: how fast, how far, how low its lowest point came over the road (and stood at
    /// rest), how much lower than it stands it rode on its feet over any second, how often it struck the world, how
    /// far off its line it went.
    pub struct Drove { pub fastest: f32, pub went: f32, pub seconds: f32, pub lowest: f32, pub rest: f32, pub sank: f32, pub struck: usize, pub broke: bool, pub off: f32 }

    /// Left to stand for 2 s, then flat out along +x for so many seconds, told no turn. With `say`, a line a second.
    pub fn flat_out(bodies: &mut Bodies, id: u32, seconds: f32, say: bool) -> Drove {
        run(bodies, 2.0, id, [0.0; 3]);
        let (rest, stands, from) = (clearance(bodies, id), pressed(bodies, id), the(bodies, id).pos);
        let mut d = Drove { fastest: 0.0, went: 0.0, seconds: 0.0, lowest: rest, rest, sank: 0.0, struck: 0, broke: false, off: 0.0 };
        let mut sunk = Vec::new();
        for k in 1..=(seconds * 60.0) as usize {
            bodies.drive(id, 1.0, 0.0, 0.0, false, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            d.struck += records(&bodies.out, STRUCK).iter().filter(|s| s[0] == id && s[1] == 0).count();
            if !bodies.list.iter().any(|b| b.id == id && b.live.is_some()) {
                d.broke = true;
                break;
            }
            d.seconds = k as f32 / 60.0;
            let low = clearance(bodies, id);
            d.lowest = d.lowest.min(low);
            sunk.push(pressed(bodies, id) - stands);
            if sunk.len() >= 60 {
                d.sank = d.sank.max(sunk[sunk.len() - 60..].iter().sum::<f32>() / 60.0);
            }
            let b = the(bodies, id);
            let speed = dot(b.vel, b.vel).sqrt();
            d.fastest = d.fastest.max(speed);
            d.off = d.off.max((b.pos[2] - from[2]).abs());
            d.went = b.pos[0] - from[0];
            if say && k % 60 == 0 {
                let feet: Vec<f32> = b.live.as_ref().unwrap().feet.iter().map(|f| (f.pressed * 10.0).round() / 10.0).collect();
                eprintln!("  {:4.0} s: {:4.0} km/h at x {:5.0}, its lowest point {low:.2} over the road, {:5.1} off its line, feet pressed {feet:?}, tipped {:.1}, {} strikes", d.seconds, speed * 0.36, b.pos[0], b.pos[2] - from[2], tipped(b), d.struck);
            }
        }
        d
    }

    pub fn tipped(b: &Body) -> f32 {
        (1.0 - 2.0 * (b.rot[0] * b.rot[0] + b.rot[2] * b.rot[2])).clamp(-1.0, 1.0).acos().to_degrees()
    }

    /// Runs the solver for some seconds, telling one thing the same all the while. Returns the records told.
    pub fn run(bodies: &mut Bodies, seconds: f32, id: u32, told: [f32; 3]) -> Vec<u32> {
        let mut out = Vec::new();
        for _ in 0..(seconds * 60.0) as usize {
            bodies.drive(id, told[0], told[1], told[2], false, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            out.extend_from_slice(&bodies.out);
        }
        out
    }

    fn records(out: &[u32], tag: u32) -> Vec<Vec<u32>> {
        let (mut i, mut found) = (0, Vec::new());
        while i < out.len() {
            let n = out[i + 1] as usize;
            if out[i] == tag {
                found.push(out[i + 2..i + 2 + n].to_vec());
            }
            i += 2 + n;
        }
        found
    }

    pub fn the(bodies: &Bodies, id: u32) -> &Body {
        bodies.list.iter().find(|b| b.id == id).expect("the thing is still a body")
    }

    #[test]
    fn a_hull_rides_the_street_and_the_sea() {
        // An open steel hull 5 m by 2.4 m, as a craft would be: hover 5, no lift.
        let size = [50usize, 9, 24];
        let hull = |bodies: &mut Bodies, low: [i32; 3]| {
            let mut cells = shell(size, kind(STEEL, OWN));
            for z in 1..size[2] - 1 { for x in 1..size[0] - 1 { cells[x + size[0] * (z + size[2] * (size[1] - 1))] = 0; } }
            let id = bodies.spawn(cells, size, low, false);
            assert!(bodies.motor(id, &[0.0, 1.0, 60.0, 110.0, 0.0, 5.0, 0.0, 30.0, 1.2, 0.0, 400.0]));
            id
        };
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let id = hull(&mut bodies, [X, ground + 12, Z - 12]);
        run(&mut bodies, 3.0, id, [0.0; 3]);
        let b = the(&bodies, id);
        let over = b.pos[1] - b.com[1] - city::ground(b.pos[0] as i32, b.pos[2] as i32) as f32;
        eprintln!("the hull over the street: {over:.1} (com {:?}), speed {:?}", b.com, b.vel);
        let from = b.pos;
        run(&mut bodies, 2.0, id, [1.0, 0.0, 0.0]);
        let went = sub(the(&bodies, id).pos, from);
        eprintln!("driven two seconds over the street it went {went:?}");
        assert!((over - 5.0).abs() < 3.0 && went[0] > 80.0, "it rides half a metre over the street and goes along it: {over}, {went:?}");
        // Out at sea: found by going west until the land is under the sea's level.
        let mut x = X - 40_000;
        while city::ground(x, Z) >= city::SEA - 20 && x > X - 200_000 { x -= 500; }
        let floor = city::ground(x, Z);
        let mut bodies = Bodies::new();
        let id = hull(&mut bodies, [x, 14, Z - 12]);
        run(&mut bodies, 3.0, id, [0.0; 3]);
        let b = the(&bodies, id);
        let over = b.pos[1] - b.com[1];
        eprintln!("at sea (x {x}, the floor at {floor}): the hull's bottom {over:.1} over the water, speed {:?}", b.vel);
        assert!(over > 2.0 && over < 8.0, "it rides the sea's top, not its floor: {over}");
        let from = b.pos;
        run(&mut bodies, 2.0, id, [1.0, 0.0, 0.0]);
        let b = the(&bodies, id);
        let went = sub(b.pos, from);
        eprintln!("driven two seconds at sea it went {went:?}");
        assert!(went[0] > 100.0 && (b.pos[1] - b.com[1]) > 2.0, "and goes over it: {went:?}");
        // Up a beach: from the sea 30 m off the shore, east until it is over land.
        // A beach, not a cliff: along the coast, the first place where the land comes up out of the sea gently.
        let (mut shore, mut at) = (x, Z);
        'found: for dz in 0..400 {
            at = Z + dz * 500;
            shore = x;
            while city::ground(shore, at) < 0 { shore += 10; }
            if city::ground(shore - 30, at) > -8 && (1..14).contains(&city::ground(shore + 100, at)) { break 'found; }
        }
        eprintln!("a beach at x {shore}, z {at}: the land from 60 cells out to 120 in: {:?}", (-6..=12).map(|k| city::ground(shore + k * 10, at)).collect::<Vec<_>>());
        let mut bodies = Bodies::new();
        let id = hull(&mut bodies, [shore - 300, 14, at - 12]);
        run(&mut bodies, 1.0, id, [0.0; 3]);
        run(&mut bodies, 8.0, id, [1.0, 0.0, 0.0]);
        let b = the(&bodies, id);
        let under = city::ground(b.pos[0] as i32, b.pos[2] as i32);
        eprintln!("from the sea towards the shore at x {shore}: it is at {:?}, the land there at {under}, tipped {:.0}", b.pos, tipped(b));
        assert!(b.pos[0] > shore as f32 + 60.0 && under > 0 && b.pos[1] - b.com[1] > under as f32 && tipped(b) < 30.0, "it comes up the beach onto the land, whole and upright");
    }

    #[test]
    fn a_car_goes_up_the_street_turns_stops_and_sleeps() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let id = car(&mut bodies, [X, ground + 6, Z]);
        run(&mut bodies, 2.0, id, [0.0; 3]);
        assert!(the(&bodies, id).asleep, "left alone it sleeps");
        assert_eq!(bodies.busy(), 0, "and a sleeper asks for no steps");
        let from = the(&bodies, id).pos;
        assert!(from[1] - (ground as f32) > 5.0 && tipped(the(&bodies, id)) < 10.0, "it stands on its feet over the street: {from:?}, tipped {}", tipped(the(&bodies, id)));
        // Uphill for four seconds.
        run(&mut bodies, 4.0, id, [1.0, 0.0, 0.0]);
        let b = the(&bodies, id);
        let went = sub(b.pos, from);
        eprintln!("driven 4 s: went {went:?}, speed {:?}, tipped {:.1}", b.vel, tipped(b));
        assert!(went[0] > 250.0, "it went up the street: {went:?}");
        assert!(went[2].abs() < 20.0 && tipped(b) < 12.0, "straight, and upright");
        assert_eq!(bodies.crushes, 0, "and broke nothing on the way");
        // Round to the right.
        run(&mut bodies, 3.0, id, [0.0; 3]);
        let was = { let f = turn(the(&bodies, id).rot, [1.0, 0.0, 0.0]); f[2].atan2(f[0]) };
        run(&mut bodies, 2.0, id, [0.5, 1.0, 0.0]);
        let b = the(&bodies, id);
        let front = turn(b.rot, [1.0, 0.0, 0.0]);
        let now = front[2].atan2(front[0]);
        eprintln!("turned from {was:.2} to {now:.2}, tipped {:.1}, at {:?}", tipped(b), b.pos);
        assert!(now - was > 0.5, "it turned to the right: {was} to {now}");
        assert!(tipped(b) < 20.0, "without going over");
        // Told nothing it stops, stays stopped on the hill, and sleeps.
        run(&mut bodies, 4.0, id, [0.0; 3]);
        let b = the(&bodies, id);
        assert!(b.asleep, "it stopped and sleeps: speed {:?}", b.vel);
        let at = b.pos;
        run(&mut bodies, 3.0, id, [0.0; 3]);
        assert_eq!(the(&bodies, id).pos, at, "and does not creep downhill asleep");
    }

    #[test]
    fn what_it_is_told_runs_out() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let id = car(&mut bodies, [X, ground + 6, Z]);
        bodies.drive(id, 1.0, 0.0, 0.0, false, false);
        // Nobody says it again: a second on it is told nothing, and stops.
        for _ in 0..6 * 60 {
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
        }
        let b = the(&bodies, id);
        assert!(b.asleep, "a thing whose driver has gone stops: speed {:?}", b.vel);
        assert!(b.pos[0] - (X as f32 + 21.0) < 120.0, "within a few metres: {:?}", b.pos);
    }

    #[test]
    fn a_car_drives_flat_out_up_the_main_street() {
        // The engine's own car, and one as fast as a real one, 20 s flat out up the town's main street (4% to 13%),
        // told no turn. They neither strike the road nor ride low on their feet (each foot followed the road a
        // riser at a time and damped against all the speed up, and both cars struck the road and broke: the engine's
        // at 58 km/h, the fast one at 46).
        for (name, fast, far) in [("the engine's car", false, 250.0), ("a fast car", true, 500.0)] {
            let mut bodies = Bodies::new();
            let id = if fast { fast_car(&mut bodies, street(), 2) } else { car(&mut bodies, street()) };
            let d = flat_out(&mut bodies, id, 20.0, false);
            eprintln!("{name}: {:.0} m in {:.1} s, fastest {:.0} km/h, its lowest point {:.2} over the road (at rest {:.2}), on its feet {:.2} lower at most for a second, {} strikes, {:.2} m off its line", d.went / 10.0, d.seconds, d.fastest * 0.36, d.lowest, d.rest, d.sank, d.struck, d.off / 10.0);
            assert!(!d.broke && d.seconds >= 20.0, "{name} is whole after 20 s");
            assert!(d.went > far * 10.0, "{name} goes up the street: {:.0} m", d.went / 10.0);
            assert!(d.struck == 0 && d.lowest > 0.1, "{name} never meets the road: lowest {:.2}, {} strikes", d.lowest, d.struck);
            assert!(d.sank < 0.5, "{name} rides no more than half a cell lower than it stands: {:.2}", d.sank);
            assert!(d.off < 10.0, "and keeps to its lane: {:.2} m off its line", d.off / 10.0);
        }
    }

    #[test]
    fn a_car_holds_its_line_on_the_level_and_stands_clear_of_the_road() {
        for (name, fast) in [("the engine's car", false), ("a fast car", true)] {
            let mut bodies = Bodies::new();
            let low = level(&mut bodies);
            let id = if fast { fast_car(&mut bodies, low, 2) } else { car(&mut bodies, low) };
            run(&mut bodies, 2.0, id, [0.0; 3]);
            // Every cell of it, its wheels too, is over the road: only its feet reach it.
            let b = the(&bodies, id);
            let mut under = f32::MAX;
            for (i, &k) in b.cells.iter().enumerate() {
                if k != 0 {
                    let (x, z, y) = (i % b.size[0], i / b.size[0] % b.size[2], i / (b.size[0] * b.size[2]));
                    let p = add(b.pos, turn(b.rot, sub([x as f32 + 0.5, y as f32, z as f32 + 0.5], b.com)));
                    under = under.min(p[1] - 2400.0);
                }
            }
            let d = flat_out(&mut bodies, id, 20.0, false);
            eprintln!("{name}: its lowest cell {under:.2} over the road at rest; {:.0} m in 20 s, {:.2} m off its line", d.went / 10.0, d.off / 10.0);
            assert!(under > 0.3, "{name} stands clear of the road: {under:.2}");
            // With its left feet always pushing first, the engine's car went 5 m off its line in 335 m.
            assert!(d.went > 3000.0 && d.off < 2.0, "{name} holds its line: {:.2} m off in {:.0} m", d.off / 10.0, d.went / 10.0);
        }
    }

    #[test]
    fn a_car_brakes_with_every_foot() {
        // The engine's car drives its rear two feet. From speed on the level, told to go back, it stops about as short as
        // its grip allows (speed squared over twice the grip): with only the driving feet braking it took twice that.
        let mut bodies = Bodies::new();
        let low = level(&mut bodies);
        let id = car(&mut bodies, low);
        flat_out(&mut bodies, id, 8.0, false);
        let (from, speed) = (the(&bodies, id).pos, dot(the(&bodies, id).vel, the(&bodies, id).vel).sqrt());
        let mut went = 0.0;
        for _ in 0..600 {
            bodies.drive(id, -1.0, 0.0, 0.0, false, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            let b = the(&bodies, id);
            // Stopped (before it would start to back away).
            if dot(b.vel, turn(b.rot, FRONTS[0])) < 2.0 {
                went = sub(b.pos, from).iter().map(|v| v * v).sum::<f32>().sqrt();
                break;
            }
        }
        let grip = the(&bodies, id).live.as_ref().unwrap().grip;
        let least = speed * speed / (2.0 * grip * G);
        eprintln!("from {:.0} km/h it stops in {:.1} m; its grip alone would stop it in {:.1} m", speed * 0.36, went / 10.0, least / 10.0);
        assert!(went > 0.0 && went < least * 1.35, "it brakes with every foot: {:.1} m against {:.1} m by grip", went / 10.0, least / 10.0);
    }

    #[test]
    fn a_lopsided_car_holds_its_line_on_the_level() {
        // 200 cells of steel along one side inside its lower shell move its middle of mass a quarter of a cell to that
        // side: no foot then has a twin across it, and with twins alone holding it straight it went 3.7 m off its line
        // in 335 m. Its feet now push together and grip together.
        let mut bodies = Bodies::new();
        let low = level(&mut bodies);
        let id = laden(&mut bodies, low, 200);
        let com = the(&bodies, id).com;
        let d = flat_out(&mut bodies, id, 20.0, false);
        eprintln!("a lopsided car (its middle at z {:.2}): {:.0} m in 20 s, {:.2} m off its line", com[2], d.went / 10.0, d.off / 10.0);
        assert!(com[2] > 9.2 && d.went > 3000.0 && d.off < 10.0, "it holds its line: {:.2} m off in {:.0} m", d.off / 10.0, d.went / 10.0);
    }

    /// A short steel cart 7 by 4 by 7 on four feet 4 cells apart that reach 4, set down on the level with its low
    /// corner at `low` and told nothing, woken each second for 5 s. Returns how far it is tipped and how far it moved.
    pub fn cart_left(bodies: &mut Bodies, low: [i32; 3]) -> (f32, V) {
        let id = bodies.spawn(vec![kind(STEEL, OWN); 7 * 4 * 7], [7, 4, 7], low, false);
        let mut numbers = vec![0.0, 1.0, 30.0, 60.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 120.0];
        for (x, z, front) in [(1.5, 1.5, false), (1.5, 5.5, false), (5.5, 1.5, true), (5.5, 5.5, true)] {
            numbers.extend([x, 0.0, z, 4.0, front as u32 as f32, !front as u32 as f32]);
        }
        assert!(bodies.motor(id, &numbers));
        let from = the(bodies, id).pos;
        for _ in 0..5 {
            bodies.list.iter_mut().find(|b| b.id == id).unwrap().asleep = false;
            run(bodies, 1.0, id, [0.0; 3]);
        }
        let b = the(bodies, id);
        (tipped(b), [b.pos[0] - from[0], b.pos[1] - from[1], b.pos[2] - from[2]])
    }

    #[test]
    fn a_short_cart_astride_a_step_stays_on_its_feet() {
        // Its front feet on a step 3 cells high, its back feet on the road below. With every spring pushing along one
        // grade worked out for the whole body (and clamped at one in one), at each place it went onto its roof; with
        // them pushing straight up, it went over too. Pushed along its own up, it rests on its feet.
        let mut rests = Vec::new();
        for onto in [0, 1, 2] {
            let mut bodies = Bodies::new();
            let low = level(&mut bodies);
            let edge = low[0] + 10;
            let step: Vec<Run> = (2400..2403).flat_map(|y| (3900..4250).map(move |z| Run { x0: edge, x1: 30000, y, z, kind: kind(crate::kinds::ASPHALT, OWN) })).collect();
            bodies.ground.push(Edit::Runs(step), false, None);
            let (tilt, moved) = cart_left(&mut bodies, [edge - 5 + onto, 2404, low[2]]);
            eprintln!("a cart with its front feet {}.5 cells onto a step: tipped {tilt:.0}, moved {moved:?}", onto);
            rests.push((tilt, moved[0]));
        }
        assert!(rests.iter().all(|&(tilt, slid)| tilt < 60.0 && slid.abs() < 1.0), "it stays on its feet where it was set: {rests:?}");
    }

    #[test]
    fn a_car_parked_on_the_steep_street_stays_there() {
        // Driven up the 13% of the main street and told nothing, it stops; kept awake for 20 s (so that sleep does not
        // hold it), it stays where it stopped.
        let mut bodies = Bodies::new();
        let id = car(&mut bodies, [3300, city::ground(3321, 4064) + 4, 4055]);
        run(&mut bodies, 2.0, id, [1.0, 0.0, 0.0]);
        run(&mut bodies, 3.0, id, [0.0; 3]);
        let from = the(&bodies, id).pos;
        for _ in 0..20 * 60 {
            let b = bodies.list.iter_mut().find(|b| b.id == id).unwrap();
            b.asleep = false;
            b.live.as_mut().unwrap().quiet = 0.0;
            bodies.drive(id, 0.0, 0.0, 0.0, false, false);
            bodies.advance(1.0 / 60.0);
        }
        let moved = sub(the(&bodies, id).pos, from);
        eprintln!("parked on the steep street at x {:.0} for 20 s it moved {moved:?}, tipped {:.1}", from[0], tipped(the(&bodies, id)));
        assert!(dot(moved, moved).sqrt() < 1.0, "it stays where it stopped: moved {moved:?}");
    }

    #[test]
    fn a_hill_costs_a_car_speed() {
        // Held up square to the road, a car climbs by its own push: up the 12% of the main street it goes slower
        // than along the level (held straight up, it went as fast up a hill as on the level).
        let mut speeds = Vec::new();
        for on_level in [true, false] {
            let mut bodies = Bodies::new();
            let low = if on_level { level(&mut bodies) } else { street() };
            let id = car(&mut bodies, low);
            flat_out(&mut bodies, id, 20.0, false);
            speeds.push(dot(the(&bodies, id).vel, the(&bodies, id).vel).sqrt() * 0.36);
        }
        eprintln!("after 20 s flat out: {:.0} km/h on the level, {:.0} km/h up the street", speeds[0], speeds[1]);
        assert!(speeds[1] < speeds[0] * 0.9 && speeds[1] > speeds[0] * 0.6, "a hill slows it, and it still climbs: {speeds:?}");
    }

    #[test]
    fn a_car_that_scrapes_a_step_goes_up_over_it() {
        // A car whose floor is half a cell over the road meets a step a cell high across it, slowly and at 75 km/h:
        // it scrapes up over it. (Pushed back out of the step's face, it stuck at the slow one and broke at the fast.)
        for at in [850, 1300] {
            let mut bodies = Bodies::new();
            let low = level(&mut bodies);
            let step: Vec<Run> = (3900..4250).map(|z| Run { x0: at, x1: 30000, y: 2400, z, kind: kind(crate::kinds::ASPHALT, OWN) }).collect();
            bodies.ground.push(Edit::Runs(step), false, None);
            let id = fast_car(&mut bodies, low, 1);
            let mut numbers = vec![0.0, 0.88, 56.0, 666.7, 0.716, 0.0, 0.0, 0.0, 0.0, 0.0, 120.0];
            for (x, z) in [(38.56, 2.7), (38.56, 19.3), (9.62, 2.7), (9.62, 19.3)] {
                numbers.extend([x, 3.88, z, 5.6, (x > 20.0) as u32 as f32, 1.0]);
            }
            assert!(bodies.motor(id, &numbers));
            let d = flat_out(&mut bodies, id, 5.0, false);
            let b = bodies.list.iter().find(|b| b.id == id);
            eprintln!("a step at x {at}: broke {}, went {:.0} m, fastest {:.0} km/h, now at {:?}", d.broke, d.went / 10.0, d.fastest * 0.36, b.map(|b| b.pos));
            // Along the level with no step it goes 64 m in the 5 s.
            assert!(!d.broke && d.went > 550.0 && b.is_some_and(|b| b.pos[1] - b.com[1] > 2400.0), "it is whole, on, and up on the step at x {at}: {:.0} m", d.went / 10.0);
        }
    }

    #[test]
    fn a_car_breaks_the_wall_it_hits_and_a_harder_hit_breaks_the_car() {
        let ground = city::ground(X, Z);
        for (seconds, lives) in [(1.3f32, true), (3.2, false)] {
            let mut bodies = Bodies::new();
            // A brick wall two cells thick across the street, further up for the faster run.
            let wall = X + 90 + (seconds * seconds * 30.0) as i32;
            let top = city::ground(wall, Z) + 30;
            let runs: Vec<Run> = (ground - 2..top).flat_map(|y| (Z - 10..Z + 30).map(move |z| Run { x0: wall, x1: wall + 2, y, z, kind: kind(BRICK, OWN) })).collect();
            bodies.ground.push(Edit::Runs(runs), false, None);
            let id = car(&mut bodies, [X, ground + 6, Z]);
            let out = run(&mut bodies, seconds + 1.5, id, [1.0, 0.0, 0.0]);
            let struck = records(&out, STRUCK);
            let hardest = struck.iter().map(|s| f32::from_bits(s[5])).fold(0.0, f32::max);
            eprintln!("{seconds} s of run: {} meetings, the fastest at {hardest:.0} cells a second, {} crushes, {} bodies, jolt {:?}", struck.len(), bodies.crushes, bodies.list.len(), bodies.list.iter().find_map(|b| b.live.as_ref().map(|l| l.jolt)));
            assert!(struck.iter().any(|s| s[0] == id && s[1] == 0 && material(s[8] as Kind) == BRICK && material(s[7] as Kind) == STEEL && s[9] & 1 == 1), "it is told that the car struck brick: {struck:?}");
            assert!(bodies.crushes > 0, "the wall is broken where it was hit");
            assert!(struck.iter().any(|s| s[9] & 4 != 0), "and the meeting is marked as one that broke something");
            let alive = bodies.list.iter().any(|b| b.id == id && b.live.is_some());
            assert_eq!(alive, lives, "a car is whole after a slow hit and in pieces after a fast one (fastest meeting {hardest:.0})");
            if !lives {
                assert_eq!(records(&out, BROKE).first().map(|r| r[0]), Some(id), "and its breaking is told");
            }
        }
    }

    #[test]
    fn a_parked_car_stands_on_a_pavement_and_is_woken_by_a_ball_and_broken_by_a_blast() {
        // A slab of concrete to stand on: what is built is what a weight could break.
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let slab: Vec<Run> = (Z - 10..Z + 30).map(|z| Run { x0: X - 10, x1: X + 60, y: ground + 3, z, kind: kind(crate::kinds::CONCRETE, OWN) }).collect();
        bodies.ground.push(Edit::Runs(slab), false, None);
        let id = car(&mut bodies, [X, ground + 9, Z]);
        let t0 = std::time::Instant::now();
        let out = run(&mut bodies, 30.0, id, [0.0; 3]);
        eprintln!("parked 30 s in {:.2} ms", t0.elapsed().as_secs_f64() * 1e3);
        assert_eq!(bodies.crushes, 0, "its weight breaks nothing");
        assert!(records(&out, EDIT).is_empty() && the(&bodies, id).asleep);
        let at = the(&bodies, id).pos;
        // A ball thrown at its side.
        bodies.throw_ball([at[0], at[1], at[2] + 60.0], [0.0, 0.0, -300.0], 4, kind(STEEL, OWN));
        let out = run(&mut bodies, 1.0, id, [0.0; 3]);
        let b = the(&bodies, id);
        assert!(sub(b.pos, at)[2] < -0.5, "the ball moved it: {:?}", sub(b.pos, at));
        assert!(records(&out, STRUCK).iter().any(|s| s[1] == id || s[0] == id), "and that is told");
        // A charge under it.
        let p = the(&bodies, id).pos.map(|v| v as i32);
        bodies.out.clear();
        bodies.blast([p[0], p[1] - 4, p[2]], 12, None, false);
        run(&mut bodies, 0.5, id, [0.0; 3]);
        assert!(!bodies.list.iter().any(|b| b.id == id), "a blast under it ends it");
    }

    #[test]
    fn a_broom_hovers_flies_and_rolls() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let size = [20, 2, 2];
        let id = bodies.spawn(vec![kind(WOOD, OWN); 80], size, [X, ground + 30, Z], false);
        assert!(bodies.motor(id, &[0.0, 1.0, 120.0, 150.0, 0.0, 10.0, 80.0, 20.0, 2.0, 0.0, 150.0]));
        run(&mut bodies, 3.0, id, [0.0; 3]);
        let b = the(&bodies, id);
        let over = b.pos[1] - 1.0 - city::ground(b.pos[0] as i32, b.pos[2] as i32) as f32;
        eprintln!("hovering {over:.1} over the street, speed {:?}", b.vel);
        assert!((over - 10.0).abs() < 2.5, "it hangs a metre over the street: {over}");
        // Forward and up.
        let from = b.pos;
        run(&mut bodies, 2.0, id, [1.0, 0.0, 1.0]);
        let went = sub(the(&bodies, id).pos, from);
        assert!(went[0] > 150.0 && went[1] > 100.0, "it flew forward and up: {went:?}");
        // Round to the right.
        run(&mut bodies, 1.0, id, [0.0, 1.0, 0.0]);
        let front = turn(the(&bodies, id).rot, [1.0, 0.0, 0.0]);
        assert!(front[2] > 0.7, "it turned to face +z: {front:?}");
        // A roll: over and back upright in under a second and a half, the same height.
        run(&mut bodies, 0.5, id, [0.0; 3]);
        let high = the(&bodies, id).pos[1];
        bodies.drive(id, 0.0, 0.0, 0.0, true, false);
        let mut most = 0.0f32;
        for _ in 0..90 {
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            most = most.max(tipped(the(&bodies, id)));
        }
        let b = the(&bodies, id);
        eprintln!("rolled: most {most:.0} degrees over, now {:.1}; height {high:.1} to {:.1}", tipped(b), b.pos[1]);
        assert!(most > 150.0 && tipped(b) < 8.0, "it went right over and is upright again");
        assert!((b.pos[1] - high).abs() < 3.0, "without falling");
        // Told nothing, it sleeps where it hangs.
        run(&mut bodies, 3.0, id, [0.0; 3]);
        assert!(the(&bodies, id).asleep);
    }

    /// Someone's body as the page and the world make it: 0.4 m wide, 1.4 m of box on a leg that reaches 0.6 m
    /// down, so that the whole stands 1.76 m. Walks at 1.4 m/s by these numbers, runs at 4.5 if told the whole way.
    pub const PERSON: [usize; 3] = [4, 14, 3];
    pub fn person(bodies: &mut Bodies, low: [i32; 3], top: f32) -> u32 {
        let id = bodies.figure(PERSON, low);
        assert!(bodies.motor(id, &[0.0, 1.5, 300.0, top, 0.0, 0.0, 0.0, 30.0, 8.0, 38.0, 2000.0, 2.0, 0.5, 1.5, 6.0, 0.0, 1.0]));
        id
    }

    #[test]
    fn a_person_walks_up_the_street_steps_aside_jumps_and_is_stopped_by_a_wall() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let id = person(&mut bodies, [X, ground + 5, Z + 9], 45.0);
        let walk = |bodies: &mut Bodies, seconds: f32, heading: f32, go: f32, side: f32| {
            for _ in 0..(seconds * 60.0) as usize {
                bodies.walk(id, heading, go, side, 0.0, false);
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
            }
        };
        walk(&mut bodies, 2.0, 0.0, 0.0, 0.0);
        let stood = the(&bodies, id);
        let feet = stood.pos[1] - stood.com[1] - 3.6;
        assert!(stood.asleep && tipped(stood) < 3.0, "it stands, upright, and sleeps");
        assert!((feet - (ground as f32 + 1.0)).abs() < 1.2, "with its feet on the street: {feet} over {ground}");
        // Up the street, which rises a cell at a time: three seconds at 4.5 m/s.
        let from = the(&bodies, id).pos;
        walk(&mut bodies, 3.0, 0.0, 1.0, 0.0);
        let went = sub(the(&bodies, id).pos, from);
        eprintln!("walked {went:?}, speed {:?}", the(&bodies, id).vel);
        assert!(went[0] > 110.0 && went[0] < 140.0 && went[2].abs() < 3.0, "it ran up the street at its pace: {went:?}");
        assert!(went[1] > 3.0, "and up the steps of the road with it");
        // Sideways, facing the same way.
        let from = the(&bodies, id).pos;
        walk(&mut bodies, 1.0, 0.0, 0.0, 1.0);
        let went = sub(the(&bodies, id).pos, from);
        assert!(went[2] > 30.0 && tipped(the(&bodies, id)) < 6.0, "it stepped to its right: {went:?}");
        // Stops when told nothing.
        walk(&mut bodies, 2.5, 0.0, 0.0, 0.0);
        assert!(the(&bodies, id).asleep, "told nothing it stands still: {:?} spin {:?}", the(&bodies, id).vel, the(&bodies, id).spin);
        // A jump: off the ground and down again.
        let was = the(&bodies, id).pos[1];
        bodies.walk(id, 0.0, 0.0, 0.0, 0.0, true);
        let mut high = 0.0f32;
        for _ in 0..90 {
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            high = high.max(the(&bodies, id).pos[1] - was);
        }
        assert!(high > 5.0 && (the(&bodies, id).pos[1] - was).abs() < 1.0, "it jumped {high} cells and came down");
        // A wall across its way stops it, and breaks nothing.
        let at = the(&bodies, id).pos;
        let wall = at[0] as i32 + 40;
        let runs: Vec<Run> = (ground - 2..ground + 60).flat_map(|y| (at[2] as i32 - 30..at[2] as i32 + 30).map(move |z| Run { x0: wall, x1: wall + 2, y, z, kind: kind(BRICK, OWN) })).collect();
        bodies.ground.push(Edit::Runs(runs), false, None);
        walk(&mut bodies, 3.0, 0.0, 1.0, 0.0);
        let b = the(&bodies, id);
        assert!(b.pos[0] < wall as f32 && b.pos[0] > wall as f32 - 6.0, "the wall stops it: at {} before {wall}", b.pos[0]);
        assert_eq!(bodies.crushes, 0, "and it breaks nothing");
        // Met at a slant, a wall is gone along (#367): turned 30 degrees off square to it (it stopped dead at that, its
        // body rubbing on the brick), it goes along the wall at its pace's share that way, and no nearer.
        let from = the(&bodies, id).pos;
        walk(&mut bodies, 1.0, 30f32.to_radians(), 1.0, 0.0);
        let b = the(&bodies, id);
        let went = sub(b.pos, from);
        eprintln!("along the wall {went:?}");
        assert!(went[2] > 15.0 && b.pos[0] < wall as f32, "it goes along a wall met at a slant: {went:?} in a second (22 would be all of it)");
        assert!(tipped(b) < 6.0 && bodies.crushes == 0, "upright, and breaking nothing");
        // Off a drop it falls, and lands on its feet.
        assert!(bodies.vanish(id) && !bodies.list.iter().any(|b| b.id == id), "and it can be taken out of the world");
    }

    /// Whatever the frames (#367): told to run for two seconds in calls of a sixtieth, a thirtieth and a fifteenth
    /// of a second, a person gets as far. Held to three steps a call it got three quarters and three eighths as far.
    #[test]
    fn a_person_runs_as_far_whatever_the_frames() {
        let ground = city::ground(X, Z);
        let far = |per: f32| {
            let mut bodies = Bodies::new();
            let id = person(&mut bodies, [X, ground + 5, Z + 9], 45.0);
            for k in 0..(4.0 * per) as usize {
                bodies.walk(id, 0.0, if k as f32 >= 2.0 * per { 1.0 } else { 0.0 }, 0.0, 0.0, false);
                bodies.out.clear();
                bodies.advance(1.0 / per);
            }
            the(&bodies, id).pos[0] - X as f32
        };
        let (sixty, thirty, fifteen) = (far(60.0), far(30.0), far(15.0));
        eprintln!("ran {sixty} at 60 a second, {thirty} at 30, {fifteen} at 15");
        assert!(sixty > 75.0 && (thirty / sixty - 1.0).abs() < 0.06 && (fifteen / sixty - 1.0).abs() < 0.1, "as far at any pace of frames: {sixty}, {thirty}, {fifteen}");
    }

    #[test]
    fn a_person_is_thrown_by_a_ball_and_a_car_and_is_whole() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let id = person(&mut bodies, [X + 100, ground + 5, Z + 9], 45.0);
        run(&mut bodies, 1.5, id, [0.0; 3]);
        let at = the(&bodies, id).pos;
        bodies.throw_ball([at[0], at[1], at[2] + 40.0], [0.0, 0.0, -300.0], 2, kind(STEEL, OWN));
        let out = run(&mut bodies, 1.0, id, [0.0; 3]);
        assert!(records(&out, STRUCK).iter().any(|s| s[1] == id || s[0] == id), "a ball that hits a person is told as a blow");
        assert!(sub(the(&bodies, id).pos, at)[2] < -1.0, "and moves them: {:?}", sub(the(&bodies, id).pos, at));
        // A car driven into them.
        let other = person(&mut bodies, [X + 120, ground + 5, Z + 7], 45.0);
        let c = car(&mut bodies, [X, ground + 6, Z]);
        let out = run(&mut bodies, 3.0, c, [1.0, 0.0, 0.0]);
        assert!(records(&out, STRUCK).iter().any(|s| (s[0] == c && s[1] == other) || (s[0] == other && s[1] == c)), "a car that hits a person is told too");
        assert!(bodies.list.iter().any(|b| b.id == other && b.live.is_some()), "and the person is still one body");
    }

    #[test]
    fn what_a_body_can_do_is_numbers() {
        let ground = city::ground(X, Z);
        let wall_of = |bodies: &mut Bodies, x: i32, high: i32| {
            let runs: Vec<Run> = (ground - 2..ground + high).flat_map(|y| (Z - 20..Z + 40).map(move |z| Run { x0: x, x1: x + 30, y, z, kind: kind(BRICK, OWN) })).collect();
            bodies.ground.push(Edit::Runs(runs), false, None);
        };
        let pace = std::cell::Cell::new(1.0f32);
        let go = |bodies: &mut Bodies, id: u32, seconds: f32, jump: bool| {
            let mut high = f32::MIN;
            for k in 0..(seconds * 60.0) as usize {
                bodies.walk(id, 0.0, pace.get(), 0.0, 0.0, jump && k == 0);
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
                high = high.max(the(bodies, id).pos[1]);
            }
            high
        };
        // A wall 4 m high and 3 m thick across the street, 4 m on: as it is, a person is stopped by it.
        let mut bodies = Bodies::new();
        wall_of(&mut bodies, X + 40, 40);
        let id = person(&mut bodies, [X, ground + 5, Z + 9], 45.0);
        run(&mut bodies, 1.5, id, [0.0; 3]);
        let stood = the(&bodies, id).pos[1];
        go(&mut bodies, id, 4.0, false);
        assert!(the(&bodies, id).pos[0] < X as f32 + 40.0 && the(&bodies, id).pos[1] - stood < 3.0, "a wall stops one who cannot climb");
        // Told it climbs two metres, it gets up no wall of four; told it climbs any, it goes up and stands on top.
        assert!(bodies.ways(id, 1.0, 20.0));
        let high = go(&mut bodies, id, 4.0, false);
        assert!(high - stood > 12.0 && high - stood < 30.0 && the(&bodies, id).pos[0] < X as f32 + 40.0, "one who climbs two metres gets that far up and no further: {}", high - stood);
        run(&mut bodies, 1.5, id, [0.0; 3]);
        assert!(bodies.ways(id, 1.0, 1000.0));
        // At a walk, a third of its pace: it climbs as it walks.
        pace.set(0.32);
        let high = go(&mut bodies, id, 12.0, false);
        pace.set(1.0);
        let b = the(&bodies, id);
        eprintln!("climbed {} to {:?}", high - stood, b.pos);
        assert!(high - stood > 38.0 && b.pos[0] > X as f32 + 72.0 && tipped(b) < 8.0, "one who climbs any wall goes up it, over it and down the far side: {} up, at {:?}", high - stood, b.pos);
        // How it falls: off the far side as everything falls, and again feeling a fifth of the pull.
        let mut times = Vec::new();
        for fall in [1.0f32, 0.2] {
            let mut bodies = Bodies::new();
            let id = person(&mut bodies, [X, ground + 60, Z + 9], 45.0);
            assert!(bodies.ways(id, fall, 0.0));
            let mut t = 0.0;
            while the(&bodies, id).pos[1] > ground as f32 + 14.0 && t < 10.0 {
                bodies.walk(id, 0.0, 0.0, 0.0, 0.0, false);
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
                t += 1.0 / 60.0;
            }
            times.push(t);
        }
        eprintln!("a fall of 5 m takes {times:?} s");
        assert!(times[1] > times[0] * 1.8 && times[1] < 9.0, "feeling a fifth of the pull it takes over twice as long to come down: {times:?}");
        // A jump is as high as its number says; faster, it goes further.
        let mut bodies = Bodies::new();
        let id = bodies.figure(PERSON, [X, ground + 5, Z + 9]);
        assert!(bodies.motor(id, &[0.0, 1.5, 600.0, 120.0, 0.0, 0.0, 0.0, 30.0, 8.0, 100.0, 2000.0, 2.0, 0.5, 1.5, 6.0, 0.0, 1.0]));
        run(&mut bodies, 1.5, id, [0.0; 3]);
        let (from, stood) = (the(&bodies, id).pos[0], the(&bodies, id).pos[1]);
        go(&mut bodies, id, 0.6, false);
        let high = go(&mut bodies, id, 2.2, true);
        eprintln!("a jump at 100: {} cells up, {} cells on", high - stood, the(&bodies, id).pos[0] - from);
        assert!(high - stood > 40.0 && the(&bodies, id).pos[0] - from > 250.0, "a jump of 5 m at 12 m/s crosses a street");
        // It flies when its motor lifts: up, on, and down again to its feet.
        assert!(bodies.motor(id, &[0.0, 1.5, 300.0, 45.0, 0.0, 0.0, 80.0, 30.0, 8.0, 38.0, 2000.0, 2.0, 0.5, 1.5, 6.0, 0.0, 1.0]));
        let was = the(&bodies, id).pos;
        for _ in 0..120 {
            bodies.walk(id, 0.0, 1.0, 0.0, 1.0, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
        }
        let up = sub(the(&bodies, id).pos, was);
        assert!(up[1] > 100.0 && up[0] > 50.0, "told to rise and go, one who flies does: {up:?}");
        for _ in 0..60 {
            bodies.walk(id, 0.0, 0.0, 0.0, 0.0, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
        }
        assert!((the(&bodies, id).pos[1] - was[1] - up[1]).abs() < 12.0, "told nothing it hangs where it is");
    }

    #[test]
    fn a_ghost_is_struck_where_it_is_put_and_says_what_the_blow_would_do() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let id = bodies.ghost(PERSON, [X, ground + 4, Z + 9]);
        assert!(id > 0 && bodies.busy() == 0, "a ghost asks for no steps");
        let at = the(&bodies, id).pos;
        let tick = |bodies: &mut Bodies, seconds: f32| {
            let mut out = Vec::new();
            for _ in 0..(seconds * 60.0) as usize {
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
                out.extend_from_slice(&bodies.out);
            }
            out
        };
        // Balls thrown at it, slow and fast and small: each is told as a blow, and as the speed it would give.
        for (speed, radius) in [(150.0f32, 2), (400.0, 1), (700.0, 1)] {
            bodies.throw_ball([at[0], at[1] + 2.0, at[2] + 60.0], [0.0, 0.0, -speed], radius, kind(STEEL, OWN));
            let ball = bodies.list.last().unwrap().id;
            let out = tick(&mut bodies, 0.6);
            let struck = records(&out, STRUCK);
            let took = records(&out, TOOK);
            eprintln!("a ball of {radius} at {speed}: {} blows on the ghost, took {:?}", struck.iter().filter(|s| s[0] == id || s[1] == id).count(), took.first().map(|t| [f32::from_bits(t[1]), f32::from_bits(t[2]), f32::from_bits(t[3])]));
            assert!(struck.iter().any(|s| (s[0] == ball && s[1] == id) || (s[0] == id && s[1] == ball)), "a ball of {radius} at {speed} cells a second meets the ghost, and that is told");
            assert!(took.iter().any(|t| t[0] == id && f32::from_bits(t[3]) < -0.5), "and the speed it would give is told, the way the ball went");
            assert_eq!(the(&bodies, id).pos, at, "the ghost has not moved");
            assert!(records(&out, MOVES).iter().all(|m| m.chunks(8).all(|b| b[0] != id)), "and is in nobody's moves");
            tick(&mut bodies, 3.0);
        }
        // Put somewhere else, it is met there and no longer where it was.
        assert!(bodies.place(id, [at[0] + 100.0, at[1], at[2]], [0.0, 0.0, 0.0, 1.0]));
        bodies.throw_ball([at[0], at[1] + 2.0, at[2] + 60.0], [0.0, 0.0, -150.0], 2, kind(STEEL, OWN));
        let out = tick(&mut bodies, 0.6);
        assert!(!records(&out, STRUCK).iter().any(|s| s[0] == id || s[1] == id), "where it was, a ball meets nothing");
        bodies.throw_ball([at[0] + 100.0, at[1] + 2.0, at[2] + 60.0], [0.0, 0.0, -150.0], 2, kind(STEEL, OWN));
        let out = tick(&mut bodies, 0.6);
        assert!(records(&out, STRUCK).iter().any(|s| s[0] == id || s[1] == id), "where it is, one does");
        // A kick is speed, at once.
        let p = person(&mut bodies, [X + 300, ground + 5, Z + 9], 45.0);
        run(&mut bodies, 1.5, p, [0.0; 3]);
        let was = the(&bodies, p).pos;
        assert!(bodies.kick(p, [0.0, 30.0, 60.0]));
        tick(&mut bodies, 0.4);
        assert!(the(&bodies, p).pos[2] - was[2] > 6.0, "a kicked body goes the way it was kicked");
    }

    #[test]
    fn what_passes_leaves_no_cells_where_it_stops() {
        let ground = city::ground(X, Z);
        for passing in [false, true] {
            let mut bodies = Bodies::new();
            bodies.throw_ball([X as f32, ground as f32 + 20.0, Z as f32 + 9.0], [120.0, 20.0, 0.0], 1, kind(STEEL, OWN));
            bodies.list[0].passing = passing;
            let mut out = Vec::new();
            for _ in 0..600 {
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
                out.extend_from_slice(&bodies.out);
            }
            assert!(bodies.list.is_empty() && !records(&out, GONE).is_empty(), "it came to rest and is told as gone");
            let put: usize = records(&out, EDIT).iter().map(|e| (e.len() - 6) / 5).sum();
            assert_eq!(put > 0, !passing, "a thrown ball lies as cells where it stops; one that passes leaves none ({put} rows)");
        }
    }

    #[test]
    fn which_way_is_down_for_a_body() {
        let ground = city::ground(X, Z);
        // A wall 15 m high and 3 m thick across the street, its west face at X + 40.
        let wall_of = |bodies: &mut Bodies| {
            let runs: Vec<Run> = (ground - 2..ground + 150).flat_map(|y| (Z - 40..Z + 60).map(move |z| Run { x0: X + 40, x1: X + 70, y, z, kind: kind(BRICK, OWN) })).collect();
            bodies.ground.push(Edit::Runs(runs), false, None);
        };
        let walk = |bodies: &mut Bodies, id: u32, seconds: f32, heading: f32, go: f32| {
            for _ in 0..(seconds * 60.0) as usize {
                bodies.walk(id, heading, go, 0.0, 0.0, false);
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
            }
        };
        let up_of = |b: &Body| turn(b.rot, [0.0, 1.0, 0.0]);
        // Down set to the east: it falls onto the wall's face and stands on it, its head to the west.
        let mut bodies = Bodies::new();
        wall_of(&mut bodies);
        let id = person(&mut bodies, [X + 10, ground + 20, Z + 9], 45.0);
        assert!(bodies.down(id, [1.0, 0.0, 0.0], false));
        walk(&mut bodies, id, 2.0, 0.0, 0.0);
        let b = the(&bodies, id);
        eprintln!("down to the east: at {:?}, its up {:?}", b.pos, up_of(b));
        assert!((X as f32 + 40.0 - b.pos[0] - 10.1).abs() < 1.5 && up_of(b)[0] < -0.95, "it stands on the wall's face, a body's length out from it, head to the west");
        let stood = b.pos;
        // Forward for it is up the wall; a quarter turn is along it.
        walk(&mut bodies, id, 1.0, 0.0, 1.0);
        let up = sub(the(&bodies, id).pos, stood);
        assert!(up[1] > 30.0 && up[0].abs() < 2.0, "told to go, it runs up the wall: {up:?}");
        let from = the(&bodies, id).pos;
        walk(&mut bodies, id, 1.0, std::f32::consts::FRAC_PI_2, 1.0);
        let along = sub(the(&bodies, id).pos, from);
        eprintln!("ran up {up:?}, then along {along:?}");
        assert!(along[2] > 30.0 && along[1].abs() < 6.0 && along[0].abs() < 2.0, "turned a quarter, it runs sideways along the wall, no higher and no lower: {along:?}");
        // And a jump is away from the wall, and it comes back to it.
        walk(&mut bodies, id, 1.5, std::f32::consts::FRAC_PI_2, 0.0);
        let on = the(&bodies, id).pos[0];
        bodies.walk(id, std::f32::consts::FRAC_PI_2, 0.0, 0.0, 0.0, true);
        let mut out = f32::MAX;
        for _ in 0..90 {
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            out = out.min(the(&bodies, id).pos[0]);
        }
        assert!(on - out > 5.0 && (the(&bodies, id).pos[0] - on).abs() < 1.0, "a jump takes it off the wall, to the west, and it lands on the wall again");
        // Down put back, it falls to the street and stands as anyone.
        assert!(bodies.down(id, [0.0, 0.0, 0.0], false));
        walk(&mut bodies, id, 3.0, 0.0, 0.0);
        let b = the(&bodies, id);
        assert!(up_of(b)[1] > 0.97 && b.pos[1] < ground as f32 + 16.0, "its down the world's again, it is on the street, upright: {:?}", b.pos);

        // One who clings: walked at the wall, up it, over the top and on along the roof.
        let mut bodies = Bodies::new();
        wall_of(&mut bodies);
        let id = person(&mut bodies, [X + 10, ground + 5, Z + 9], 45.0);
        assert!(bodies.down(id, [0.0, 0.0, 0.0], true));
        walk(&mut bodies, id, 1.0, 0.0, 0.0);
        // Seen on its way: on the west face with its head out to the west, upright on the roof, and on the far face
        // with its head out to the east, going down.
        let mut seen = [false; 3];
        for _ in 0..(9 * 60) {
            bodies.walk(id, 0.0, 1.0, 0.0, 0.0, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            let b = the(&bodies, id);
            let (up, high) = (up_of(b), b.pos[1] - ground as f32);
            seen[0] |= up[0] < -0.9 && high > 60.0 && b.pos[0] < X as f32 + 40.0;
            seen[1] |= seen[0] && up[1] > 0.95 && high > 150.0;
            seen[2] |= seen[1] && up[0] > 0.9 && high < 120.0 && b.pos[0] > X as f32 + 70.0;
        }
        assert!(seen[0], "walked at the wall, it goes up its face with its head out from the wall");
        assert!(seen[1], "over the top, it stands upright on the roof and goes on");
        assert!(seen[2], "and over the far edge it goes down the far face, its head out the other way");
        // A low, thin wall (4 m by 2 m): the same, and down the far face to the street.
        let mut bodies = Bodies::new();
        let runs: Vec<Run> = (ground - 2..ground + 42).flat_map(|y| (Z - 16..Z + 16).map(move |z| Run { x0: X + 40, x1: X + 60, y, z, kind: kind(BRICK, OWN) })).collect();
        bodies.ground.push(Edit::Runs(runs), false, None);
        let id = person(&mut bodies, [X + 10, ground + 5, Z], 45.0);
        assert!(bodies.down(id, [0.0, 0.0, 0.0], true));
        walk(&mut bodies, id, 1.0, 0.0, 0.0);
        let mut past = false;
        for _ in 0..(10 * 60) {
            bodies.walk(id, 0.0, 1.0, 0.0, 0.0, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            let b = the(&bodies, id);
            let up = up_of(b);
            past |= up[1] > 0.95 && b.pos[0] > X as f32 + 75.0 && b.pos[1] < ground as f32 + 16.0;
        }
        assert!(past, "a low thin wall is gone up, over and down to the street beyond");
    }

    #[test]
    fn a_frog_hops_where_it_faces() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let size = [4, 2, 3];
        let id = bodies.spawn(vec![kind(crate::kinds::LEAVES, OWN); 24], size, [X, ground + 2, Z + 8], false);
        assert!(bodies.motor(id, &[0.0, 1.0, 0.0, 25.0, 0.0, 0.0, 0.0, 20.0, 4.0, 30.0, 400.0]));
        run(&mut bodies, 1.0, id, [0.0; 3]);
        let from = the(&bodies, id).pos;
        let mut high = 0.0f32;
        for hop in 0..3 {
            bodies.drive(id, 1.0, 0.0, 0.0, false, true);
            for _ in 0..60 {
                bodies.drive(id, 1.0, 0.0, 0.0, false, false);
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
                high = high.max(the(&bodies, id).pos[1] - from[1]);
            }
            eprintln!("hop {hop}: at {:?}", sub(the(&bodies, id).pos, from));
        }
        let b = the(&bodies, id);
        let went = sub(b.pos, from);
        assert!(went[0] > 20.0 && high > 3.0, "three hops took it forward, off the ground: {went:?}, {high} up");
        assert!(tipped(b) < 15.0, "and it lands on its feet");
    }

    #[test]
    fn a_car_drifts_with_handbrake_and_transfers_weight_safely() {
        let mut bodies = Bodies::new();
        let low = level(&mut bodies);
        let id = car(&mut bodies, low);
        run(&mut bodies, 1.5, id, [0.0; 3]);
        // Launch hard: verify visible rear squat (nose pitched up) and upright stability.
        let mut max_squat = -1.0f32;
        for _ in 0..90 {
            bodies.drive(id, 1.0, 0.0, 0.0, false, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            let f = turn(the(&bodies, id).rot, FRONTS[0]);
            max_squat = max_squat.max(f[1]);
        }
        // Build speed then initiate a handbrake drift (rise = 1.0 while turning right).
        run(&mut bodies, 1.5, id, [1.0, 0.0, 0.0]);
        let mut max_slip = 0.0f32;
        let mut max_tip = 0.0f32;
        for _ in 0..75 {
            bodies.drive(id, 1.0, 1.0, 1.0, false, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            let b = the(&bodies, id);
            let f = turn(b.rot, FRONTS[0]);
            let flat = unit([f[0], 0.0, f[2]]);
            let right = [-flat[2], 0.0, flat[0]];
            let fwd = dot(b.vel, flat);
            let lat = dot(b.vel, right).abs();
            if fwd > 10.0 {
                max_slip = max_slip.max(lat.atan2(fwd));
            }
            max_tip = max_tip.max(tipped(b));
        }
        // Brake hard from speed and verify nose dive (front[1] < -0.015).
        run(&mut bodies, 1.5, id, [1.0, 0.0, 0.0]);
        let mut min_dive = 1.0f32;
        for _ in 0..40 {
            bodies.drive(id, -1.0, 0.0, 0.0, false, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            let f = turn(the(&bodies, id).rot, FRONTS[0]);
            min_dive = min_dive.min(f[1]);
        }
        eprintln!("drift & weight transfer: squat {:.3}, dive {:.3}, max drift slip {:.1} deg, max tip {:.1} deg", max_squat, min_dive, max_slip.to_degrees(), max_tip);
        assert!(max_squat > 0.012, "launch visibly squats the rear: {max_squat:.4}");
        assert!(min_dive < -0.015, "hard braking visibly dives the nose: {min_dive:.4}");
        assert!(max_slip.to_degrees() > 12.0, "handbrake kicks out a real drift slip angle: {:.1} deg", max_slip.to_degrees());
        assert!(max_tip < 18.0, "stays planted and never rolls over: {:.1} deg", max_tip);
    }

    #[test]
    fn burnout_launch_beats_cold_start() {
        // Run A: cold start from rest with full throttle for 1.0 s.
        let (cold_dist, cold_speed, cold_squat) = {
            let mut bodies = Bodies::new();
            let low = level(&mut bodies);
            let id = car(&mut bodies, low);
            run(&mut bodies, 1.5, id, [0.0; 3]);
            let start = the(&bodies, id).pos[0];
            let mut squat = -1.0f32;
            for _ in 0..60 {
                bodies.drive(id, 1.0, 0.0, 0.0, false, false);
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
                squat = squat.max(turn(the(&bodies, id).rot, FRONTS[0])[1]);
            }
            let b = the(&bodies, id);
            (b.pos[0] - start, dot(b.vel, turn(b.rot, FRONTS[0])), squat)
        };
        // Run B: hold throttle + handbrake for 1.2 s (burnout), verify pinned + rear wheel spin + charge,
        // then release handbrake and measure 1.0 s launch surge.
        let mut bodies = Bodies::new();
        let low = level(&mut bodies);
        let id = car(&mut bodies, low);
        run(&mut bodies, 1.5, id, [0.0; 3]);
        let before_burn = the(&bodies, id).pos[0];
        for _ in 0..72 {
            bodies.drive(id, 1.0, 0.0, 1.0, false, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
        }
        let b = the(&bodies, id);
        let live = b.live.as_ref().unwrap();
        let burn_drift = (b.pos[0] - before_burn).abs();
        let rear_spun = live.feet.iter().filter(|f| !f.steers).map(|f| f.spun).fold(0.0f32, f32::max);
        let charge = live.burnout_charge;
        assert!(burn_drift < 8.0, "front brakes hold car during burnout: drifted {burn_drift:.2} cells");
        assert!(rear_spun > 30.0, "rear tires spin during burnout: spun {rear_spun:.1}");
        assert!(charge > 0.85, "burnout builds launch charge: {charge:.2}");
        // Release handbrake and measure launch surge over 1.0 s.
        let launch_from = the(&bodies, id).pos[0];
        let (mut launch_squat, mut saw_launch, mut lowest, mut struck, mut max_tip) = (-1.0f32, false, f32::MAX, 0usize, 0.0f32);
        for _ in 0..60 {
            bodies.drive(id, 1.0, 0.0, 0.0, false, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            struck += records(&bodies.out, STRUCK).iter().filter(|s| s[0] == id && s[1] == 0).count();
            let b = the(&bodies, id);
            saw_launch |= b.live.as_ref().unwrap().launch_timer > 0.0;
            launch_squat = launch_squat.max(turn(b.rot, FRONTS[0])[1]);
            max_tip = max_tip.max(tipped(b));
            lowest = lowest.min(clearance(&mut bodies, id));
        }
        let b = the(&bodies, id);
        let (launch_dist, launch_speed) = (b.pos[0] - launch_from, dot(b.vel, turn(b.rot, FRONTS[0])));
        eprintln!("burnout launch vs cold: dist {launch_dist:.1} vs {cold_dist:.1}, speed {launch_speed:.1} vs {cold_speed:.1}, squat {launch_squat:.4} vs {cold_squat:.4}, lowest {lowest:.2}, tip {max_tip:.1}");
        assert!(saw_launch, "releasing handbrake activates launch timer");
        assert!(launch_dist > cold_dist * 1.18, "burnout launch beats cold start distance: {launch_dist:.1} vs {cold_dist:.1}");
        assert!(launch_speed > cold_speed * 1.12, "burnout launch beats cold start speed: {launch_speed:.1} vs {cold_speed:.1}");
        assert!(launch_squat > cold_squat, "burnout launch produces extra rear squat: {launch_squat:.4} vs {cold_squat:.4}");
        assert!(struck == 0 && lowest > 0.1 && max_tip < 15.0, "launch stays upright and clear of the road");
    }

    #[test]
    fn nitrous_boost_increases_acceleration_and_top_speed_safely() {
        let drive_run = |use_boost: bool, seconds: f32| {
            let mut bodies = Bodies::new();
            let low = level(&mut bodies);
            let id = car(&mut bodies, low);
            run(&mut bodies, 1.5, id, [0.0; 3]);
            let (mut fastest, mut lowest, mut max_tip, mut struck) = (0.0f32, f32::MAX, 0.0f32, 0usize);
            let mut speed_at_2s = 0.0f32;
            for k in 1..=(seconds * 60.0) as usize {
                bodies.drive(id, 1.0, 0.0, 0.0, false, false);
                bodies.drive_aux(id, if use_boost { 1.0 } else { 0.0 }, 0.0, 0.0);
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
                struck += records(&bodies.out, STRUCK).iter().filter(|s| s[0] == id && s[1] == 0).count();
                let b = the(&bodies, id);
                let spd = dot(b.vel, turn(b.rot, FRONTS[0]));
                if k == 120 { speed_at_2s = spd; }
                fastest = fastest.max(spd);
                max_tip = max_tip.max(tipped(b));
                lowest = lowest.min(clearance(&mut bodies, id));
            }
            let fuel = the(&bodies, id).live.as_ref().unwrap().boost_fuel;
            (speed_at_2s, fastest, lowest, max_tip, struck, fuel)
        };
        let (base_2s, base_top, _, _, _, _) = drive_run(false, 6.0);
        // Also test hitting boost once already at cruising speed so full reserve pushes past normal top speed.
        let (boost_2s, _, lowest_a, tip_a, struck_a, fuel_after_2s) = drive_run(true, 2.2);
        let mut bodies = Bodies::new();
        let low = level(&mut bodies);
        let id = car(&mut bodies, low);
        run(&mut bodies, 1.5, id, [0.0; 3]);
        run(&mut bodies, 10.0, id, [1.0, 0.0, 0.0]);
        let cruise = dot(the(&bodies, id).vel, turn(the(&bodies, id).rot, FRONTS[0]));
        let (mut boost_top, mut lowest_b, mut tip_b, mut struck_b) = (0.0f32, f32::MAX, 0.0f32, 0usize);
        for _ in 0..140 {
            bodies.drive(id, 1.0, 0.0, 0.0, false, false);
            bodies.drive_aux(id, 1.0, 0.0, 0.0);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            struck_b += records(&bodies.out, STRUCK).iter().filter(|s| s[0] == id && s[1] == 0).count();
            let b = the(&bodies, id);
            boost_top = boost_top.max(dot(b.vel, turn(b.rot, FRONTS[0])));
            tip_b = tip_b.max(tipped(b));
            lowest_b = lowest_b.min(clearance(&mut bodies, id));
        }
        let fuel_low = the(&bodies, id).live.as_ref().unwrap().boost_fuel;
        // Release boost and drift + drive clean: verify boost reserve recharges.
        bodies.drive_aux(id, 0.0, 0.0, 0.0);
        for _ in 0..90 {
            bodies.drive(id, 1.0, 1.0, 1.0, false, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
        }
        let fuel_after_drift = the(&bodies, id).live.as_ref().unwrap().boost_fuel;
        // Verify jump landing also recharges boost (staying centered on the level strip).
        let before_jump = fuel_after_drift;
        bodies.place(id, [low[0] as f32 + 120.0, low[1] as f32 + 5.0, low[2] as f32 + 9.0], [0.0, 0.0, 0.0, 1.0]);
        bodies.list.iter_mut().find(|b| b.id == id).unwrap().live.as_mut().unwrap().boost_fuel = before_jump;
        run(&mut bodies, 0.4, id, [0.0; 3]);
        bodies.kick(id, [0.0, 55.0, 0.0]);
        for _ in 0..95 {
            bodies.drive(id, 0.2, 0.0, 0.0, false, false);
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
        }
        let fuel_after_jump = the(&bodies, id).live.as_ref().unwrap().boost_fuel;
        eprintln!("boost: 2s {boost_2s:.1} vs {base_2s:.1}, top {boost_top:.1} vs {base_top:.1} (cruise {cruise:.1}), fuel {fuel_low:.2} -> drift {fuel_after_drift:.2} -> jump {fuel_after_jump:.2}, lowest {:.2}/{:.2}, tip {:.1}/{:.1}", lowest_a, lowest_b, tip_a, tip_b);
        assert!(boost_2s > base_2s * 1.15, "boost increases acceleration: {boost_2s:.1} vs {base_2s:.1}");
        assert!(boost_top > base_top * 1.10 && boost_top > 215.0, "boost raises temporary top speed past normal top: {boost_top:.1} vs {base_top:.1}");
        assert!(fuel_after_2s < 0.35 && fuel_low < 0.4, "boost consumes reserve: {fuel_after_2s:.2}, {fuel_low:.2}");
        assert!(fuel_after_drift > fuel_low + 0.08, "drifting recharges boost: {fuel_low:.2} -> {fuel_after_drift:.2}");
        assert!(fuel_after_jump > fuel_after_drift + 0.08, "landing a jump recharges boost: {fuel_after_drift:.2} -> {fuel_after_jump:.2}");
        assert!(struck_a == 0 && struck_b == 0 && lowest_a > 0.1 && lowest_b > 0.1, "boost never scrapes road");
        assert!(tip_a < 15.0 && tip_b < 15.0, "boost stays completely upright");
    }

    #[test]
    fn surface_grip_modulates_drift_angles_and_archetypes_differ() {
        // Measure peak drift slip angle under dry (1.0), wet rain (0.78), and off-road (0.64) grip.
        let drift_on = |wetness: f32, grip_override: f32| {
            let mut bodies = Bodies::new();
            let low = level(&mut bodies);
            let id = car(&mut bodies, low);
            run(&mut bodies, 1.5, id, [0.0; 3]);
            run(&mut bodies, 2.2, id, [1.0, 0.0, 0.0]);
            bodies.drive_aux(id, 0.0, wetness, grip_override);
            let (mut max_slip, mut max_tip) = (0.0f32, 0.0f32);
            for _ in 0..75 {
                bodies.drive(id, 1.0, 1.0, 1.0, false, false);
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
                let b = the(&bodies, id);
                let f = turn(b.rot, FRONTS[0]);
                let flat = unit([f[0], 0.0, f[2]]);
                let right = [-flat[2], 0.0, flat[0]];
                let fwd = dot(b.vel, flat);
                let lat = dot(b.vel, right).abs();
                if fwd > 10.0 {
                    max_slip = max_slip.max(lat.atan2(fwd));
                }
                max_tip = max_tip.max(tipped(b));
            }
            (max_slip.to_degrees(), max_tip)
        };
        let (dry_slip, dry_tip) = drift_on(0.0, 0.0);
        let (wet_slip, wet_tip) = drift_on(1.0, 0.0);
        let (off_slip, off_tip) = drift_on(0.0, 0.64);
        eprintln!("surface drift slip deg: dry {dry_slip:.1} (tip {dry_tip:.1}), wet {wet_slip:.1} (tip {wet_tip:.1}), off-road {off_slip:.1} (tip {off_tip:.1})");
        assert!(wet_slip > dry_slip + 2.0, "wet rain produces wider drift angle than dry asphalt: {wet_slip:.1} vs {dry_slip:.1}");
        assert!(off_slip > wet_slip + 2.0, "off-road grip produces wider drift angle than wet rain: {off_slip:.1} vs {wet_slip:.1}");
        assert!(dry_tip < 18.0 && wet_tip < 18.0 && off_tip < 18.0, "all surface drifts stay upright");

        // Verify fast `city::top` auto-detection returns 1.0 on street asphalt and 0.64 on off-road grass/earth/sand.
        let mut bodies = Bodies::new();
        let on_street = car(&mut bodies, street());
        run(&mut bodies, 0.5, on_street, [0.0; 3]);
        assert!((the(&bodies, on_street).live.as_ref().unwrap().surf_base - 1.0).abs() < 0.01, "street auto-detects paved grip 1.0");
        // Find a nearby off-road grass/earth/sand column in the generated town.
        let mut grass_at = None;
        'find: for dz in -600..600 {
            for dx in -600..600 {
                let (x, z) = (X + dx * 4, Z + dz * 4);
                let m = material(city::top(x, z));
                if m == GRASS || m == EARTH || m == SAND {
                    grass_at = Some([x, city::ground(x, z) + 5, z]);
                    break 'find;
                }
            }
        }
        let grass_low = grass_at.expect("town has off-road grass/earth/sand");
        let on_grass = car(&mut bodies, grass_low);
        run(&mut bodies, 0.5, on_grass, [0.0; 3]);
        assert!((the(&bodies, on_grass).live.as_ref().unwrap().surf_base - 0.64).abs() < 0.01, "off-road auto-detects grip 0.64");

        // Handling archetypes: sports car (high top speed, short wheelbase) vs heavy long-wheelbase bus.
        let make_bus = |bodies: &mut Bodies, low: [i32; 3]| {
            let size = [72usize, 18, 22];
            let mut cells = shell(size, kind(STEEL, OWN));
            for y in 0..2 { for z in 0..size[2] { for x in 0..size[0] { cells[x + size[0] * (z + size[2] * y)] = 0; } } }
            let id = bodies.spawn(cells, size, low, false);
            let mut numbers = vec![0.0, 1.1, 45.0, 180.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 160.0];
            for (x, z, front) in [(10.0, 2.5, false), (10.0, 19.5, false), (62.0, 2.5, true), (62.0, 19.5, true)] {
                numbers.extend([x, 4.0, z, 7.0, front as u32 as f32, !front as u32 as f32]);
            }
            assert!(bodies.motor(id, &numbers));
            id
        };
        // Compare corner roll and coasting momentum between sports car and heavy bus at the same cruising speed.
        let (sport_yaw, sport_roll, sport_coast) = {
            let mut bodies = Bodies::new();
            let low = level(&mut bodies);
            let id = fast_car(&mut bodies, low, 2);
            run(&mut bodies, 1.5, id, [0.0; 3]);
            run(&mut bodies, 1.8, id, [1.0, 0.0, 0.0]);
            let v0 = dot(the(&bodies, id).vel, turn(the(&bodies, id).rot, FRONTS[0]));
            let mut max_roll = 0.0f32;
            let yaw0 = { let f = turn(the(&bodies, id).rot, FRONTS[0]); f[2].atan2(f[0]) };
            for _ in 0..30 {
                bodies.drive(id, 1.0, 1.0, 0.0, false, false);
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
                let b = the(&bodies, id);
                let up = turn(b.rot, [0.0, 1.0, 0.0]);
                let f = turn(b.rot, FRONTS[0]);
                let r = [-f[2], 0.0, f[0]];
                max_roll = max_roll.max(dot(up, r).abs());
            }
            let yaw1 = { let f = turn(the(&bodies, id).rot, FRONTS[0]); f[2].atan2(f[0]) };
            // Coast test from fresh straight run.
            let mut bodies2 = Bodies::new();
            let low2 = level(&mut bodies2);
            let id2 = fast_car(&mut bodies2, low2, 2);
            run(&mut bodies2, 1.5, id2, [0.0; 3]);
            run(&mut bodies2, 1.5, id2, [1.0, 0.0, 0.0]);
            let c0 = dot(the(&bodies2, id2).vel, turn(the(&bodies2, id2).rot, FRONTS[0]));
            run(&mut bodies2, 1.0, id2, [0.0; 3]);
            let c1 = dot(the(&bodies2, id2).vel, turn(the(&bodies2, id2).rot, FRONTS[0]));
            let _ = v0;
            ((yaw1 - yaw0).abs(), max_roll, c1 / c0.max(1.0))
        };
        let (bus_yaw, bus_roll, bus_coast) = {
            let mut bodies = Bodies::new();
            let low = level(&mut bodies);
            let id = make_bus(&mut bodies, low);
            run(&mut bodies, 1.5, id, [0.0; 3]);
            run(&mut bodies, 2.2, id, [1.0, 0.0, 0.0]);
            let mut max_roll = 0.0f32;
            let yaw0 = { let f = turn(the(&bodies, id).rot, FRONTS[0]); f[2].atan2(f[0]) };
            for _ in 0..30 {
                bodies.drive(id, 1.0, 1.0, 0.0, false, false);
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
                let b = the(&bodies, id);
                let up = turn(b.rot, [0.0, 1.0, 0.0]);
                let f = turn(b.rot, FRONTS[0]);
                let r = [-f[2], 0.0, f[0]];
                max_roll = max_roll.max(dot(up, r).abs());
            }
            let yaw1 = { let f = turn(the(&bodies, id).rot, FRONTS[0]); f[2].atan2(f[0]) };
            let mut bodies2 = Bodies::new();
            let low2 = level(&mut bodies2);
            let id2 = make_bus(&mut bodies2, low2);
            run(&mut bodies2, 1.5, id2, [0.0; 3]);
            run(&mut bodies2, 2.2, id2, [1.0, 0.0, 0.0]);
            let c0 = dot(the(&bodies2, id2).vel, turn(the(&bodies2, id2).rot, FRONTS[0]));
            run(&mut bodies2, 1.0, id2, [0.0; 3]);
            let c1 = dot(the(&bodies2, id2).vel, turn(the(&bodies2, id2).rot, FRONTS[0]));
            ((yaw1 - yaw0).abs(), max_roll, c1 / c0.max(1.0))
        };
        eprintln!("archetypes: sport yaw {sport_yaw:.2} rad, roll {sport_roll:.4}, coast {sport_coast:.2} | bus yaw {bus_yaw:.2} rad, roll {bus_roll:.4}, coast {bus_coast:.2}");
        assert!(sport_yaw > bus_yaw * 1.15, "sports car turns in sharper than heavy bus: {sport_yaw:.2} vs {bus_yaw:.2}");
        assert!(bus_roll < sport_roll * 0.85 && bus_roll < 0.06, "heavy bus stays planted with low body roll: {bus_roll:.4} vs sport {sport_roll:.4}");
        assert!(bus_coast > sport_coast, "heavy bus retains stronger coasting momentum: {bus_coast:.2} vs {sport_coast:.2}");
    }
}

#[cfg(test)]
mod tune {
    use super::*;
    use super::tests::*;

    /// How a car turns at each speed: `cargo test --release how_a_car_turns -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn how_a_car_turns() {
        let ground = city::ground(700, 4070);
        for seconds in [0.5f32, 1.0, 2.0, 3.0] {
            let mut bodies = Bodies::new();
            let id = car(&mut bodies, [700, ground + 6, 4070]);
            run(&mut bodies, 1.5, id, [0.0; 3]);
            run(&mut bodies, seconds, id, [1.0, 0.0, 0.0]);
            let speed = the(&bodies, id).vel[0];
            let mut line = format!("after {seconds} s at {speed:.0}:");
            for _ in 0..5 {
                let was = the(&bodies, id).rot;
                run(&mut bodies, 0.2, id, [1.0, 1.0, 0.0]);
                let b = the(&bodies, id);
                let (f0, f1) = (turn(was, [1.0, 0.0, 0.0]), turn(b.rot, [1.0, 0.0, 0.0]));
                let rate = (f1[2].atan2(f1[0]) - f0[2].atan2(f0[0])) / 0.2;
                line += &format!(" {rate:.2} rad/s (on {}, tipped {:.0})", b.live.as_ref().unwrap().on, tipped(b));
            }
            eprintln!("{line}");
        }
    }

    /// A car that has broken a block of brick, then told to back off: what holds it.
    /// `cargo test --release stuck_on_rubble -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn stuck_on_rubble() {
        use crate::kinds::{BRICK, OWN, kind};
        let ground = city::ground(700, 4070);
        let mut bodies = Bodies::new();
        let id = car(&mut bodies, [700, ground + 6, 4070]);
        run(&mut bodies, 1.5, id, [0.0; 3]);
        let at = the(&bodies, id).pos;
        let x = at[0] as i32 + 130;
        bodies.ground.push(Edit::Ball { centre: [x, city::ground(x, 4079) + 4, 4079], radius: 10, kind: kind(BRICK, OWN) }, false, None);
        run(&mut bodies, 3.0, id, [1.0, 0.0, 0.0]);
        run(&mut bodies, 2.0, id, [0.0; 3]);
        for k in 0..8 {
            run(&mut bodies, 0.25, id, [-1.0, 0.0, 0.0]);
            let Some(b) = bodies.list.iter().find(|b| b.id == id) else { eprintln!("gone"); break };
            let live = b.live.as_ref().unwrap();
            let mine = bodies.touches.iter().filter(|t| bodies.list[t.a].id == id || (t.b != NONE && bodies.list[t.b].id == id)).map(|t| (t.ra.map(|v| v.round()), t.n.map(|v| (v * 10.0).round() / 10.0), t.depth, if t.b == NONE { 0 } else { bodies.list[t.b].id })).collect::<Vec<_>>();
            eprintln!("{k}: at {:?} vel {:?} on {} pressed {:?} tipped {:.0} bodies {} touches {:?}", b.pos.map(|v| v.round()), b.vel.map(|v| v.round()), live.on, live.feet.iter().map(|f| (f.pressed * 10.0).round() / 10.0).collect::<Vec<_>>(), tipped(b), bodies.list.len(), mine);
        }
    }

    /// The town's main street from x 760, z 4065 eastward: how high, how steep, and whether the lane is clear.
    /// `cargo test --release the_main_street -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn the_main_street() {
        let mut bodies = Bodies::new();
        let mut line = String::new();
        for k in 0..60 {
            let x = 760 + k * 150;
            let g = city::ground(x, 4065);
            let blocked = (4046..4094).step_by(4).filter(|&z| (1..20).any(|y| bodies.ground.solid(x, city::ground(x, z) + y, z))).count();
            let slope = (city::ground(x + 50, 4065) - city::ground(x - 50, 4065)) as f32 / 100.0;
            line += &format!("x {x}: {g} ({:.1}%) blocked {blocked}\n", slope * 100.0);
        }
        eprintln!("{line}");
    }

    /// Flat out up the main street, and on a level strip: `cargo test --release up_the_main_street -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn up_the_main_street() {
        for (name, fast) in [("the engine's car", false), ("a fast car", true)] {
            for flat in [false, true] {
                let mut bodies = Bodies::new();
                let low = if flat { level(&mut bodies) } else { street() };
                let id = if fast { fast_car(&mut bodies, low, 2) } else { car(&mut bodies, low) };
                eprintln!("{name}{}:", if flat { " on the level" } else { " up the main street" });
                let d = flat_out(&mut bodies, id, 25.0, true);
                eprintln!("  fastest {:.0} km/h, went {:.0} m in {:.1} s, its lowest point {:.2} over the road (at rest {:.2}), on its feet {:.2} lower at most for a second, {} strikes, broke {}, {:.1} m off its line", d.fastest * 0.36, d.went / 10.0, d.seconds, d.lowest, d.rest, d.sank, d.struck, d.broke, d.off / 10.0);
            }
        }
    }

    /// How far a car goes off its line on the level as it is made lopsided:
    /// `cargo test --release lopsided_lines -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn lopsided_lines() {
        let whole = { let mut bodies = Bodies::new(); let id = car(&mut bodies, [760, 2403, 4055]); the(&bodies, id).cells.iter().filter(|&&k| k != 0).count() };
        // A third more on one side than the other: (half + x) / (half) = 4 / 3 with x laid on that side.
        for load in [0, 100, 200, whole / 6] {
            let mut bodies = Bodies::new();
            let low = level(&mut bodies);
            let id = laden(&mut bodies, low, load);
            let com = the(&bodies, id).com;
            let d = flat_out(&mut bodies, id, 20.0, false);
            eprintln!("{load} cells more on one side (of {whole}; its middle at z {:.2}): {:.0} m, {:.2} m off its line", com[2], d.went / 10.0, d.off / 10.0);
        }
    }

    /// What a living thing costs the solver: `cargo test --release what_a_car_costs -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn what_a_car_costs() {
        let ground = city::ground(700, 4070);
        for cars in [1usize, 8] {
            let mut bodies = Bodies::new();
            let ids: Vec<u32> = (0..cars).map(|k| car(&mut bodies, [700, ground + 6 + 20 * k as i32, 4070])).collect();
            let (mut steps, t0) = (0, std::time::Instant::now());
            for _ in 0..240 {
                for &id in &ids {
                    bodies.drive(id, 1.0, 0.0, 0.0, false, false);
                }
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
                steps += bodies.steps;
            }
            eprintln!("{cars} driven for 4 s: {:.1} us a step, {:.3} ms a frame of two steps", t0.elapsed().as_secs_f64() * 1e6 / steps as f64, t0.elapsed().as_secs_f64() * 1e3 / steps as f64 * 2.0);
        }
    }
}
