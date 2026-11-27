//! What two rolling vehicles meet each other as (#72): each a whole hull, pushed apart one way.
//!
//! A car's body is a shell a cell or two thick round a hollow cabin. Met cell by cell (`way_out`), a point of one car
//! that got past the other's shell touched nothing, and a point in the shell was pushed the short way out of the
//! shell: into the cabin as soon as out of it, or up through the roof (up is tried first). So a car that came to
//! life with another already in it stayed there, three were left telescoped, and one was lifted onto the next. A
//! vehicle's hull is the rectangle round its cells at each height, and a pair is pushed apart along one way for all
//! its touches: the way their two boxes are least into each other, and along the road unless one is nearly clear
//! over the other.
use super::*;

/// How much of the lower vehicle's height two may share and still be pushed apart up and down: one that has come
/// down on another's roof stays on it, one that is bumper to bumper is not lifted there.
const OVER: f32 = 0.4;
/// How far a pair is eased apart in a step at most (cells), and what share of how far they are in.
const EASE: f32 = 2.0;
const EASED: f32 = 0.25;
/// How much of the speed one vehicle loses to another's hull in a step does not count towards breaking it (`tough`).
/// Hull against hull, all of a blow lands in one step: a car at 150 km/h into the back of one standing lost 231
/// cells a second in that step, where shell against shell, a few points at a time, it had lost 186 and the rest over
/// the next. So that a car breaks on another at the speed it did, a fifth is the bodywork giving.
pub(super) const YIELDS: f32 = 0.2;
/// How far in is inside and not a touch (cells): a step at 200 km/h each, nose to nose, is 9, shared between two.
const INSIDE: f32 = 5.0;
/// How fast one must close on the other along a way for that to be the way it came (cells a second).
const CLOSING: f32 = 20.0;

pub struct Hull {
    /// The box round its cells, in its own axes from its middle of mass: its middle, and half its size.
    mid: V,
    half: V,
    /// Each of its cells: whether it is within the rectangle round the body's cells at its own height. The cabin is,
    /// and the boot, and the corner a tapered nose leaves empty; over the bonnet is not, where the body at that
    /// height is the cabin alone. By the body's own cells alone a point in the hollow cabin touched nothing; by its
    /// cells and what is shut between them, two tapered corners nested 4.7 cells into each other's outlines and
    /// travelled so (0.24 s, test/crash-stack.mjs): the telemetry measures outlines.
    inside: Vec<bool>,
}

impl Hull {
    pub fn of(b: &Body) -> Hull {
        let [sx, sy, sz] = b.size;
        let mut inside = vec![false; b.cells.len()];
        let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
        for y in 0..sy {
            // The rectangle round what is solid at this height.
            let (mut x0, mut x1, mut z0, mut z1) = (usize::MAX, 0, usize::MAX, 0);
            for z in 0..sz {
                for x in 0..sx {
                    if b.cells[b.at(x, y, z)] != 0 {
                        (x0, x1, z0, z1) = (x0.min(x), x1.max(x), z0.min(z), z1.max(z));
                    }
                }
            }
            if x0 == usize::MAX {
                continue;
            }
            for z in z0..=z1 {
                for x in x0..=x1 {
                    inside[b.at(x, y, z)] = true;
                }
            }
            lo = [lo[0].min(x0 as f32), lo[1].min(y as f32), lo[2].min(z0 as f32)];
            hi = [hi[0].max(x1 as f32 + 1.0), hi[1].max(y as f32 + 1.0), hi[2].max(z1 as f32 + 1.0)];
        }
        let (mid, half) = ([0, 1, 2].map(|a| (lo[a] + hi[a]) / 2.0 - b.com[a]), [0, 1, 2].map(|a| (hi[a] - lo[a]) / 2.0));
        Hull { mid, half, inside }
    }

    fn holds(&self, b: &Body, c: [i32; 3]) -> bool {
        (0..3).all(|a| c[a] >= 0 && (c[a] as usize) < b.size[a]) && self.inside[b.at(c[0] as usize, c[1] as usize, c[2] as usize)]
    }
}

/// A vehicle's box as it stands: its middle, its three ways, half its size along each.
struct Boxed { mid: V, ways: [V; 3], half: V }

impl Boxed {
    fn of(b: &Body, hull: &Hull) -> Boxed {
        Boxed { mid: add(b.pos, turn(b.rot, hull.mid)), ways: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]].map(|w| turn(b.rot, w)), half: hull.half }
    }

    /// How far it reaches from its middle along a way.
    fn reach(&self, u: V) -> f32 {
        (0..3).map(|k| self.half[k] * dot(self.ways[k], u).abs()).sum()
    }

    /// Its eight corners and the middles of its twelve edges. A body's own points are corners of its cells, at most
    /// 160 of them, six to eight cells apart on a van: between two of them a rounded corner went 4.8 cells into
    /// another vehicle's outline, and stayed so while the two were pressed together (0.27 s, test/crash-stack.mjs).
    fn outer(&self) -> impl Iterator<Item = V> + '_ {
        (0..27).map(|k| [k % 3, k / 3 % 3, k / 9].map(|s| s as f32 - 1.0)).filter(|s| s.iter().filter(|&&v| v == 0.0).count() <= 1)
            .map(|s| (0..3).fold(self.mid, |p, k| add(p, scale(self.ways[k], s[k] * self.half[k]))))
    }
}

/// The way to push the first of two boxes to part them, and how far they are into each other along it. Nothing if
/// they are apart. Of the ways the two face, up and down only when they share little of their height (`OVER`), and
/// never when `flat`:
///
/// - touching, the way they overlap least;
/// - one well inside the other (`INSIDE`: more than a step at any speed puts it), back the way it came in: the way
///   it would have taken least time to get so far at the speed `vel` the first closes on the second with. Two that
///   are 3 m into each other nose to tail are nearer out sideways (2 m), where the kerb and the parked cars are.
fn part(a: &Boxed, b: &Boxed, flat: bool, vel: V) -> Option<(V, f32)> {
    let d = sub(a.mid, b.mid);
    let up = [0.0, 1.0, 0.0];
    let share = OVER * (2.0 * a.reach(up)).min(2.0 * b.reach(up));
    let (mut least, mut soonest): (Option<(V, f32)>, Option<(V, f32, f32)>) = (None, None);
    for u in a.ways.iter().chain(&b.ways) {
        let along = dot(d, *u);
        let over = a.reach(*u) + b.reach(*u) - along.abs();
        if over <= 0.0 {
            return None;
        }
        if u[1].abs() > 0.7 && (flat || over > share) {
            continue;
        }
        let n = scale(*u, if along >= 0.0 { 1.0 } else { -1.0 });
        if least.is_none_or(|(_, o)| over < o) {
            least = Some((n, over));
        }
        let closing = -dot(vel, n);
        if closing > CLOSING && soonest.is_none_or(|(_, _, t)| over / closing < t) {
            soonest = Some((n, over, over / closing));
        }
    }
    least.map(|l| if l.1 >= INSIDE { soonest.map_or(l, |(n, over, _)| (n, over)) } else { l })
}

/// For a box that has just been put where another is coming in at `vel` (the other's speed, less its own): the way
/// that other is going, along the way of the two's that it would have taken least time to come so far in by, and how
/// far along it the first must go to be clear ahead of it. Ahead, wherever the other's middle is by now: it may be
/// past the first's own, and the first is still what it pushes before it, not what it leaves behind. Nothing if they
/// are apart, or the other is not coming.
fn ahead(a: &Boxed, b: &Boxed, vel: V) -> Option<(V, f32)> {
    let d = sub(a.mid, b.mid);
    let mut soonest: Option<(V, f32, f32)> = None;
    for u in a.ways.iter().chain(&b.ways) {
        if a.reach(*u) + b.reach(*u) - dot(d, *u).abs() <= 0.0 {
            return None;
        }
        let coming = dot(vel, *u);
        if u[1].abs() > 0.7 || coming.abs() <= CLOSING {
            continue;
        }
        let n = scale(*u, coming.signum());
        let far = a.reach(n) + b.reach(n) - dot(d, n);
        if soonest.is_none_or(|(_, _, t)| far / coming.abs() < t) {
            soonest = Some((n, far, far / coming.abs()));
        }
    }
    soonest.map(|(n, far, _)| (n, far))
}

/// Where two vehicles touch: the points of each that are inside the other's hull, every one pushed the pair's one
/// way, as `(ra, rb, n, depth)` with the first pushed along `n`. Returns that way and how far to ease them apart.
pub(super) fn meet(a: &Body, ha: &Hull, b: &Body, hb: &Hull, found: &mut Vec<(V, V, V, f32)>) -> Option<(V, f32)> {
    let (ba, bb) = (Boxed::of(a, ha), Boxed::of(b, hb));
    let (n, over) = part(&ba, &bb, false, sub(a.vel, b.vel))?;
    let mut deepest = 0.0f32;
    for (one, mine, other, hull, boxed, flip) in [(a, &ba, b, hb, &bb, false), (b, &bb, a, ha, &ba, true)] {
        // The one whose point it is leaves the other along `out`.
        let out = if flip { scale(n, -1.0) } else { n };
        for p in one.turned.iter().map(|&r| add(one.pos, r)).chain(mine.outer()) {
            let r = sub(p, one.pos);
            let from = sub(p, other.pos);
            if dot(from, from) > other.radius * other.radius || !hull.holds(other, other.cell_at(p).0) {
                continue;
            }
            deepest = deepest.max((boxed.reach(out) - dot(sub(p, boxed.mid), out)).clamp(0.0, over));
            // Eased as a pair (`ease`), so no touch of it is eased again for its own depth.
            found.push(if flip { (from, r, n, 0.0) } else { (r, from, n, 0.0) });
        }
    }
    (!found.is_empty()).then_some((n, deepest))
}

/// How far a pair so far into each other is eased apart this step.
pub(super) fn ease(deep: f32) -> f32 {
    ((deep - 0.05) * EASED).clamp(0.0, EASE)
}

impl Bodies {
    /// Moves a vehicle along the road, keeping it as high over the ground as it was: on a hill the road four metres
    /// on is two cells higher, and a car put there at the height it had stood in the road and sprang up out of it.
    fn along(&mut self, at: usize, by: V) {
        let from = self.list[at].pos;
        let to = add(from, by);
        let down = |ground: &mut Ground, p: V| living::ray(ground, add(p, [0.0, 8.0, 0.0]), [0.0, -1.0, 0.0], 48.0);
        let rise = match (down(&mut self.ground, from), down(&mut self.ground, to)) {
            (Some(was), Some(now)) => was - now,
            _ => 0.0,
        };
        self.list[at].pos = add(to, [0.0, rise, 0.0]);
    }

    /// Moves a vehicle that has just been put somewhere out of the vehicles that are coming into that place, ahead
    /// of each (`ahead`), a few times over: out of one may be into the next. A drawn car comes to life where it was
    /// drawn a few frames after it was struck, and by then what struck it is there. Then whatever stands
    /// where it was moved to is moved on the same way, and what stands beyond that: the row it was shoved into. What
    /// stands in the place it was put, with nothing coming, is not moved out of: the two are eased apart as any pair
    /// is. One put where nothing is, is not moved.
    pub(super) fn clear(&mut self, id: u32) {
        let boxed = |b: &Body| b.live.as_ref().and_then(|live| live.hull.as_ref()).map(|hull| Boxed::of(b, hull));
        let Some(at) = self.list.iter().position(|b| b.id == id) else { return };
        let mut way = [0.0; 3];
        for _ in 0..4 {
            let mut moved = false;
            for k in (0..self.list.len()).filter(|&k| k != at) {
                let (Some(mine), Some(theirs)) = (boxed(&self.list[at]), boxed(&self.list[k])) else { continue };
                if let Some((n, far)) = ahead(&mine, &theirs, sub(self.list[k].vel, self.list[at].vel)) {
                    let by = scale([n[0], 0.0, n[2]], far + 0.5);
                    self.along(at, by);
                    way = add(way, by);
                    moved = true;
                }
            }
            if !moved {
                break;
            }
        }
        if dot(way, way) < 0.25 {
            return;
        }
        let way = unit(way);
        let (mut last, mut shoved) = (at, vec![at]);
        for _ in 0..4 {
            let Some(mine) = boxed(&self.list[last]) else { return };
            let next = (0..self.list.len()).filter(|k| !shoved.contains(k)).find_map(|k| {
                let theirs = boxed(&self.list[k])?;
                // (One it only touches, or overlaps by its corner, is left to be eased apart: not sent a car's length on.)
                let (_, least) = part(&theirs, &mine, true, [0.0; 3])?;
                let ahead = dot(sub(theirs.mid, mine.mid), way);
                (least >= INSIDE && ahead > 0.0).then(|| (k, mine.reach(way) + theirs.reach(way) - ahead + 0.5))
            });
            let Some((k, by)) = next else { return };
            self.along(k, scale(way, by));
            self.list[k].asleep = false;
            shoved.push(k);
            last = k;
        }
    }
}
