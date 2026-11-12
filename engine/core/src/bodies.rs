//! Bodies (#146): pieces of the world that have come loose and move. A body is a small box of
//! cells with a place, a turn, a speed and a spin. It falls, strikes the standing world and other
//! bodies, slides and tips, and when it has lain still for a moment it is cells of the world
//! again, as it lies. That last step is what keeps a ruin cheap: a heap is the world, not a
//! thousand bodies, and the next thing to fall lands on it.
//!
//! Lengths are in the finest cells (10 cm) and times in seconds. A body meets things at points:
//! corners of its own cells, a few hundred at most, tried against whatever is solid where they
//! are. Each touch pushes along the way out of the solid and rubs across it; a handful of
//! touches a body, the ones furthest out each way, is enough for it to stand, lean or lie.
//! This is not exact, and it is not the same on every machine to the last bit: what a world
//! process decides is what everyone sees.

use crate::hash::hash3;
use crate::kinds::{GLASS, breaks_at, material, weighs};
use crate::scratch::{Run, Scratch};
use crate::support::{self, Region};
use crate::tree::{CELLS, Kind, SIDE, at};
use crate::{Edit, SETTLE, city, fill};
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// How fast things fall faster: cells a second, each second.
pub const G: f32 = 98.0;
/// One step of the solver, seconds. A cell is 10 cm, so a step is short.
pub const STEP: f32 = 1.0 / 120.0;
/// The most points a body meets things at.
const POINTS: usize = 160;
/// A body under this many cells does not meet other small bodies: lumps and shards land on the world and on big
/// things, and a heap of them is the world, not bodies on bodies. There is a lot of rubble.
const SMALL: usize = 160;
/// The most steps one call takes: when the solver cannot keep up, things move slower, they do not pile up work.
const STEPS: f32 = 3.0;
/// How still, for how long, before a body is cells again.
const STILL_SPEED: f32 = 4.0;
const STILL_SPIN: f32 = 0.35;
const STILL_FOR: f32 = 0.3;
/// A body that has not come to rest by now is put down where it is.
const OLD: f32 = 8.0;
/// The most bodies at once: past this, what a blast throws out is dust.
const MOST: usize = 700;
/// A body under this many cells does not break further.
const WHOLE: usize = 12;

type V = [f32; 3];
type Q = [f32; 4];

#[inline]
fn add(a: V, b: V) -> V { [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
#[inline]
fn sub(a: V, b: V) -> V { [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
#[inline]
fn scale(a: V, k: f32) -> V { [a[0] * k, a[1] * k, a[2] * k] }
#[inline]
fn dot(a: V, b: V) -> f32 { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
#[inline]
fn cross(a: V, b: V) -> V { [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
#[inline]
fn unit(a: V) -> V { let l = dot(a, a).sqrt(); if l > 1e-6 { scale(a, 1.0 / l) } else { [0.0, 1.0, 0.0] } }
/// Turns a vector by a quaternion (x, y, z, w).
#[inline]
fn turn(q: Q, v: V) -> V {
    let u = [q[0], q[1], q[2]];
    let t = scale(cross(u, v), 2.0);
    add(add(v, scale(t, q[3])), cross(u, t))
}
#[inline]
fn back(q: Q, v: V) -> V { turn([-q[0], -q[1], -q[2], q[3]], v) }
fn mul(m: &[V; 3], v: V) -> V { [dot(m[0], v), dot(m[1], v), dot(m[2], v)] }

/// A hasher for sector places: the standard one is safe against strangers, which these keys are not.
#[derive(Default, Clone, Copy)]
pub struct Mix(u64);
impl Hasher for Mix {
    fn finish(&self) -> u64 { self.0 }
    fn write(&mut self, bytes: &[u8]) { for &b in bytes { self.0 = (self.0 ^ b as u64).wrapping_mul(0x100_0000_01b3) } }
    fn write_i32(&mut self, v: i32) { self.0 = (self.0.rotate_left(23) ^ v as u32 as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) }
}
pub(crate) type Map<K, T> = HashMap<K, T, BuildHasherDefault<Mix>>;

enum Sector {
    Air,
    Solid,
    Bits(Box<[u64; CELLS / 64]>),
}

/// The standing world as a body meets it: solid or not at any cell. Sectors are made when first asked for (the
/// city's rules, then every edit, as everywhere) and kept as one bit a cell.
pub struct Ground {
    pub(crate) edits: Vec<Edit>,
    /// Which edits this solver made itself (pieces taken out, bodies put down), and the box each edit reaches.
    ours: Vec<bool>,
    boxes: Vec<([i32; 3], [i32; 3])>,
    sectors: Map<[i32; 3], Sector>,
    pub(crate) scratch: Scratch,
    /// The sector the scratch holds whole, for asking what a cell is made of.
    holds: Option<[i32; 3]>,
    /// A few sectors kept whole, for asking what many cells are made of (a fire asks about every neighbour).
    whole: Vec<([i32; 3], Vec<Kind>)>,
}

/// The box an edit can change (high corner exclusive). A blast reaches as far as the weakest material gives: under three radii.
fn reach(e: &Edit) -> ([i32; 3], [i32; 3]) {
    match e {
        Edit::Ball { centre, radius, kind } => {
            let r = if *kind == 0 { radius * 3 + 2 } else { radius + 1 };
            (centre.map(|c| c - r), centre.map(|c| c + r + 1))
        }
        Edit::Runs(runs) => {
            let (mut lo, mut hi) = ([i32::MAX; 3], [i32::MIN; 3]);
            for r in runs {
                lo = [lo[0].min(r.x0), lo[1].min(r.y), lo[2].min(r.z)];
                hi = [hi[0].max(r.x1), hi[1].max(r.y + 1), hi[2].max(r.z + 1)];
            }
            (lo, hi)
        }
    }
}

impl Ground {
    pub fn new() -> Self {
        Ground { edits: Vec::new(), ours: Vec::new(), boxes: Vec::new(), sectors: Map::default(), scratch: Scratch::new(), holds: None, whole: Vec::new() }
    }

    /// How many edits of this solver's own are in the world.
    pub fn own(&self) -> usize {
        self.ours.iter().filter(|&&o| o).count()
    }

    /// Adds an edit. One of the solver's own goes last. Anyone else's goes where its maker put it: after the first
    /// `after` of the solver's own edits (the ones its maker had heard of), so that the page, its workers and
    /// this solver all apply the same edits in the same order.
    pub fn push(&mut self, e: Edit, ours: bool, after: Option<usize>) {
        let mut at = self.edits.len();
        if let (false, Some(k)) = (ours, after) {
            let mut seen = 0;
            for (i, &o) in self.ours.iter().enumerate() {
                if o {
                    if seen == k {
                        at = i;
                        break;
                    }
                    seen += 1;
                }
            }
        }
        let b = reach(&e);
        let last = at == self.edits.len();
        match (&e, last) {
            // Rows put last change the sectors already made in place.
            (Edit::Runs(runs), true) => self.rows(runs),
            _ => self.forget(b),
        }
        self.holds = None;
        // Kept sectors the edit reaches are forgotten: asked for again, they are made with it.
        let s = SIDE as i32;
        self.whole.retain(|(k, _)| (0..3).any(|a| (k[a] + 1) * s <= b.0[a] || k[a] * s >= b.1[a]));
        self.edits.insert(at, e);
        self.ours.insert(at, ours);
        self.boxes.insert(at, b);
    }

    fn forget(&mut self, (lo, hi): ([i32; 3], [i32; 3])) {
        let s = SIDE as i32;
        self.sectors.retain(|k, _| (0..3).any(|a| (k[a] + 1) * s <= lo[a] || k[a] * s >= hi[a]));
    }

    fn rows(&mut self, runs: &[Run]) {
        let s = SIDE as i32;
        for r in runs {
            for sx in r.x0 >> 6..=(r.x1 - 1) >> 6 {
                let Some(sector) = self.sectors.get_mut(&[sx, r.y >> 6, r.z >> 6]) else { continue };
                if let Sector::Air | Sector::Solid = sector {
                    let all = if matches!(sector, Sector::Solid) { u64::MAX } else { 0 };
                    *sector = Sector::Bits(Box::new([all; CELLS / 64]));
                }
                let Sector::Bits(bits) = sector else { unreachable!() };
                for x in r.x0.max(sx * s)..r.x1.min((sx + 1) * s) {
                    let i = at((x & 63) as usize, (r.y & 63) as usize, (r.z & 63) as usize);
                    if r.kind == 0 { bits[i >> 6] &= !(1 << (i & 63)) } else { bits[i >> 6] |= 1 << (i & 63) }
                }
            }
        }
    }

    fn make(&mut self, key: [i32; 3]) -> Sector {
        let s = SIDE as i32;
        let (lo, hi) = (key.map(|k| k * s), key.map(|k| (k + 1) * s));
        // Far under the ground or over the roofs nothing needs making, unless an edit reached there.
        let (first, last) = city::span(key[0], key[2], 0);
        if (key[1] < first || key[1] > last) && !self.boxes.iter().any(|(a, b)| (0..3).all(|i| a[i] < hi[i] && b[i] > lo[i])) {
            return if key[1] < first { Sector::Solid } else { Sector::Air };
        }
        fill(&mut self.scratch, key[0], key[1], key[2], 0, &self.edits);
        self.holds = Some(key);
        let mut bits = Box::new([0u64; CELLS / 64]);
        let (mut any, mut all) = (false, true);
        for (i, &kind) in self.scratch.cells.iter().enumerate() {
            if kind != 0 {
                bits[i >> 6] |= 1 << (i & 63);
                any = true;
            } else {
                all = false;
            }
        }
        if !any { Sector::Air } else if all { Sector::Solid } else { Sector::Bits(bits) }
    }

    #[inline]
    pub fn solid(&mut self, x: i32, y: i32, z: i32) -> bool {
        let key = [x >> 6, y >> 6, z >> 6];
        if !self.sectors.contains_key(&key) {
            let made = self.make(key);
            self.sectors.insert(key, made);
        }
        match &self.sectors[&key] {
            Sector::Air => false,
            Sector::Solid => true,
            Sector::Bits(bits) => {
                let i = at((x & 63) as usize, (y & 63) as usize, (z & 63) as usize);
                bits[i >> 6] >> (i & 63) & 1 != 0
            }
        }
    }

    /// What the cell is made of. Slower than `solid`: its sector is made whole, and the last few asked about are kept.
    pub fn kind(&mut self, x: i32, y: i32, z: i32) -> Kind {
        let key = [x >> 6, y >> 6, z >> 6];
        let i = at((x & 63) as usize, (y & 63) as usize, (z & 63) as usize);
        if let Some(found) = self.whole.iter().position(|(k, _)| *k == key) {
            return self.whole[found].1[i];
        }
        fill(&mut self.scratch, key[0], key[1], key[2], 0, &self.edits);
        self.holds = Some(key);
        if self.whole.len() >= 12 {
            self.whole.remove(0);
        }
        self.whole.push((key, self.scratch.cells.clone()));
        self.scratch.cells[i]
    }
}

/// The shortest way out of the solid for a point in a solid cell, and how far that is: straight through one face,
/// to the nearest empty cell within three. A point just under a floor is pushed up, however near a step's edge it is;
/// one that went in through a wall is pushed back out of the wall. Nothing if it is shut in deeper than that.
#[inline]
fn way_out(p: V, cell: [i32; 3], mut solid: impl FnMut([i32; 3]) -> bool) -> Option<(V, f32)> {
    let mut best: Option<(V, f32)> = None;
    for (a, d) in [(1, 1), (0, 1), (0, -1), (2, 1), (2, -1), (1, -1)] {
        let inside = p[a] - cell[a] as f32;
        let first = if d > 0 { 1.0 - inside } else { inside };
        for k in 1..=3 {
            let far = first + (k - 1) as f32;
            if best.is_some_and(|(_, d)| d <= far) {
                break;
            }
            let mut c = cell;
            c[a] += d * k;
            if !solid(c) {
                let mut n = [0.0f32; 3];
                n[a] = d as f32;
                best = Some((n, far));
                break;
            }
        }
    }
    best
}

pub struct Body {
    pub id: u32,
    pub size: [usize; 3],
    /// Its cells, laid out flat from its own low corner: x + across * (z + deep * y).
    pub cells: Vec<Kind>,
    pub count: usize,
    inv_mass: f32,
    /// Its middle of mass, from its own low corner.
    pub com: V,
    /// What resists its turning, inverted, in its own axes.
    inv_inertia: [V; 3],
    /// Where its middle of mass is in the world, and how it is turned.
    pub pos: V,
    pub rot: Q,
    pub vel: V,
    pub spin: V,
    /// Where it meets things: corners of its cells, from its middle of mass.
    points: Vec<V>,
    radius: f32,
    still: f32,
    age: f32,
    /// How long since it last touched anything.
    apart: f32,
    /// The hardest single knock it took in the last step, as a change of speed; and how many times it has broken already.
    knock: f32,
    broken: u8,
    /// Where its low corner was in the world when it came loose: its cells keep the shades they had.
    pub born: [i32; 3],
}

impl Body {
    #[inline]
    fn at(&self, x: usize, y: usize, z: usize) -> usize { x + self.size[0] * (z + self.size[2] * y) }

    #[inline]
    fn solid(&self, c: [i32; 3]) -> bool {
        (0..3).all(|a| c[a] >= 0 && (c[a] as usize) < self.size[a]) && self.cells[self.at(c[0] as usize, c[1] as usize, c[2] as usize)] != 0
    }

    /// A body from a box of cells whose low corner is at `low` in the world.
    pub fn new(id: u32, cells: Vec<Kind>, size: [usize; 3], low: [i32; 3]) -> Body {
        let mut b = Body {
            id, size, cells, count: 0, inv_mass: 0.0, com: [0.0; 3], inv_inertia: [[0.0; 3]; 3], pos: [0.0; 3], rot: [0.0, 0.0, 0.0, 1.0],
            vel: [0.0; 3], spin: [0.0; 3], points: Vec::new(), radius: 0.0, still: 0.0, age: 0.0, apart: 1.0, knock: 0.0, broken: 0, born: low,
        };
        // Mass and its middle.
        let (mut mass, mut sum) = (0.0f32, [0.0f32; 3]);
        for y in 0..size[1] {
            for z in 0..size[2] {
                for x in 0..size[0] {
                    let kind = b.cells[b.at(x, y, z)];
                    if kind != 0 {
                        let m = weighs(material(kind));
                        mass += m;
                        sum = add(sum, scale([x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5], m));
                        b.count += 1;
                    }
                }
            }
        }
        b.com = scale(sum, 1.0 / mass);
        b.inv_mass = 1.0 / mass;
        // What resists turning: each cell as a small cube away from the middle.
        let mut i = [[0.0f32; 3]; 3];
        for y in 0..size[1] {
            for z in 0..size[2] {
                for x in 0..size[0] {
                    let kind = b.cells[b.at(x, y, z)];
                    if kind != 0 {
                        let m = weighs(material(kind));
                        let r = sub([x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5], b.com);
                        let rr = dot(r, r);
                        for a in 0..3 {
                            for c in 0..3 {
                                i[a][c] += m * (if a == c { rr + 1.0 / 6.0 } else { 0.0 } - r[a] * r[c]);
                            }
                        }
                    }
                }
            }
        }
        b.inv_inertia = invert(&i);
        b.pos = add([low[0] as f32, low[1] as f32, low[2] as f32], b.com);
        // Where it meets things. Corners that stick out are what touch first, so they are all kept if they fit; the rest are thinned evenly.
        let (mut sharp, mut flat): (Vec<V>, Vec<V>) = (Vec::new(), Vec::new());
        for y in 0..=size[1] as i32 {
            for z in 0..=size[2] as i32 {
                for x in 0..=size[0] as i32 {
                    let mut n = 0;
                    for d in 0..8 {
                        n += b.solid([x - (d & 1), y - (d >> 1 & 1), z - (d >> 2 & 1)]) as u32;
                    }
                    if n == 0 || n == 8 {
                        continue;
                    }
                    let p = sub([x as f32, y as f32, z as f32], b.com);
                    b.radius = b.radius.max(dot(p, p).sqrt());
                    if n == 1 { sharp.push(p) } else { flat.push(p) }
                }
            }
        }
        let thin = |from: &[V], most: usize, to: &mut Vec<V>| {
            if from.len() <= most {
                to.extend_from_slice(from);
            } else {
                for k in 0..most {
                    to.push(from[k * from.len() / most]);
                }
            }
        };
        // A small body needs few.
        let most = (12 + b.count).min(POINTS);
        thin(&sharp, most * 5 / 8, &mut b.points);
        let room = most - b.points.len();
        thin(&flat, room, &mut b.points);
        b
    }

    /// What it is made of, as far as one cell says.
    fn first(&self) -> Kind { self.cells.iter().copied().find(|&k| k != 0).unwrap_or(0) }

    #[inline]
    fn turn_resist(&self, v: V) -> V {
        turn(self.rot, mul(&self.inv_inertia, back(self.rot, v)))
    }

    /// How fast a point of the body moves, `r` from its middle.
    #[inline]
    fn speed_at(&self, r: V) -> V { add(self.vel, cross(self.spin, r)) }

    #[inline]
    fn push(&mut self, r: V, j: V) {
        self.vel = add(self.vel, scale(j, self.inv_mass));
        self.spin = add(self.spin, self.turn_resist(cross(r, j)));
    }

    /// A point of the world as the body's own cell, if it is in one.
    #[inline]
    fn cell_at(&self, world: V) -> ([i32; 3], V) {
        let q = add(back(self.rot, sub(world, self.pos)), self.com);
        ([q[0].floor() as i32, q[1].floor() as i32, q[2].floor() as i32], q)
    }
}

fn invert(m: &[V; 3]) -> [V; 3] {
    let c = [cross(m[1], m[2]), cross(m[2], m[0]), cross(m[0], m[1])];
    let det = dot(m[0], c[0]);
    let k = if det.abs() > 1e-9 { 1.0 / det } else { 0.0 };
    [[c[0][0] * k, c[1][0] * k, c[2][0] * k], [c[0][1] * k, c[1][1] * k, c[2][1] * k], [c[0][2] * k, c[1][2] * k, c[2][2] * k]]
}

/// A touch between a body and the standing world (`b` is NONE) or another body.
struct Touch {
    a: usize,
    b: usize,
    ra: V,
    rb: V,
    /// The way `a` is pushed.
    n: V,
    depth: f32,
    pushed: f32,
    rubbed: [f32; 2],
}
const NONE: usize = usize::MAX;

/// Of the touches found between one pair, the few that matter: the furthest out each way, and the deepest.
fn keep(found: &mut Vec<(V, V, V, f32)>, a: usize, b: usize, out: &mut Vec<Touch>) {
    if found.is_empty() {
        return;
    }
    const WAYS: [V; 14] = [
        [1.0, 0.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 1.0], [0.0, 0.0, -1.0],
        [1.0, 1.0, 1.0], [-1.0, 1.0, 1.0], [1.0, -1.0, 1.0], [-1.0, -1.0, 1.0], [1.0, 1.0, -1.0], [-1.0, 1.0, -1.0], [1.0, -1.0, -1.0], [-1.0, -1.0, -1.0],
    ];
    let mut picked: Vec<usize> = Vec::with_capacity(16);
    let mut pick = |i: usize| { if !picked.contains(&i) { picked.push(i) } };
    if found.len() <= 16 {
        (0..found.len()).for_each(&mut pick);
    } else {
        for w in WAYS {
            let mut best = 0;
            for (i, f) in found.iter().enumerate() {
                if dot(f.0, w) > dot(found[best].0, w) {
                    best = i;
                }
            }
            pick(best);
        }
        let mut deep = 0;
        for (i, f) in found.iter().enumerate() {
            if f.3 > found[deep].3 {
                deep = i;
            }
        }
        pick(deep);
    }
    for i in picked {
        let (ra, rb, n, depth) = found[i];
        out.push(Touch { a, b, ra, rb, n, depth, pushed: 0.0, rubbed: [0.0; 2] });
    }
    found.clear();
}

/// What the solver tells whoever draws: a stream of records, each a tag, how many words follow, and the words.
pub const EDIT: u32 = 1; // low corner (3), high corner (3), then rows of x0, x1, y, z, kind
pub const BORN: u32 = 2; // id, cells, size (3), middle of mass (3, as floats), where it was (3), then faces (two words each)
pub const GONE: u32 = 3; // id
pub const DUST: u32 = 4; // where (3, as floats), kind, how much
pub const MOVES: u32 = 5; // for each body: id, place (3 floats), turn (4 floats)
pub const FIRE: u32 = 7; // how many cells are alight, then where some of them are (3 floats each)
pub const BROKE: u32 = 6; // id: the body is no more, and the pieces it broke into have been born

pub struct Bodies {
    pub ground: Ground,
    pub list: Vec<Body>,
    next: u32,
    pub out: Vec<u32>,
    touches: Vec<Touch>,
    /// Time owed to the solver that was not a whole step.
    owed: f32,
    /// How many steps the last call took, and what was counted in them: for measuring.
    pub steps: u32,
    pub tried: u32,
    /// How old each body was when it came to rest, in tenths of a second: for measuring.
    pub rested: Vec<u32>,
    /// What burns (fire.rs).
    pub fire: crate::fire::Fire,
}

impl Bodies {
    pub fn new() -> Self {
        Bodies { ground: Ground::new(), list: Vec::new(), next: 1, out: Vec::new(), touches: Vec::new(), owed: 0.0, steps: 0, tried: 0, rested: Vec::new(), fire: crate::fire::Fire::default() }
    }

    pub(crate) fn record(&mut self, tag: u32, words: &[u32]) {
        self.out.push(tag);
        self.out.push(words.len() as u32);
        self.out.extend_from_slice(words);
    }

    /// An edit of the solver's own: into its world, and told.
    pub(crate) fn change(&mut self, mut runs: Vec<Run>) {
        if runs.is_empty() {
            return;
        }
        runs.sort_unstable_by_key(|r| (r.y, r.z, r.x0));
        let (lo, hi) = reach(&Edit::Runs(runs.clone()));
        let mut words: Vec<u32> = Vec::with_capacity(6 + runs.len() * 5);
        words.extend(lo.iter().chain(hi.iter()).map(|&v| v as u32));
        for r in &runs {
            words.extend_from_slice(&[r.x0 as u32, r.x1 as u32, r.y as u32, r.z as u32, r.kind as u32]);
        }
        self.record(EDIT, &words);
        self.ground.push(Edit::Runs(runs), true, None);
    }

    fn born(&mut self, body: &Body) {
        let faces = support::faces_of(&body.cells, body.size);
        let mut words = vec![body.id, body.count as u32, body.size[0] as u32, body.size[1] as u32, body.size[2] as u32];
        words.extend(body.com.iter().map(|v| v.to_bits()));
        words.extend(body.born.iter().map(|&v| v as u32));
        words.extend(faces);
        self.record(BORN, &words);
    }

    /// What is no longer held round a point comes loose and is a body. `radius` is how big the blast there was:
    /// what it loosened is thrown from it, small pieces harder than big. Returns how many bodies were made.
    pub fn release(&mut self, at: [i32; 3], radius: i32) -> usize {
        let low = [at[0] - SETTLE[0] as i32 / 2, at[1] - 48, at[2] - SETTLE[2] as i32 / 2];
        let mut region = Region::gather(low, SETTLE, &self.ground.edits, &mut self.ground.scratch);
        self.ground.holds = None;
        let (pieces, dust) = support::release(&mut region);
        let mut taken: Vec<Run> = Vec::new();
        for r in dust.iter().chain(pieces.iter().flat_map(|p| p.runs.iter())) {
            taken.push(Run { kind: 0, ..*r });
        }
        for r in &dust {
            let words = [(r.x0 as f32 + 0.5).to_bits(), (r.y as f32 + 0.5).to_bits(), (r.z as f32 + 0.5).to_bits(), r.kind as u32, (r.x1 - r.x0) as u32];
            self.record(DUST, &words);
        }
        self.change(taken);
        let made = pieces.len();
        for p in pieces {
            let size = [(p.high[0] - p.low[0]) as usize, (p.high[1] - p.low[1]) as usize, (p.high[2] - p.low[2]) as usize];
            let mut body = Body::new(self.next, support::grid_of(&p.runs, p.low, size), size, p.low);
            self.next += 1;
            self.throw(&mut body, at, radius);
            self.born(&body);
            self.list.push(body);
        }
        made
    }

    /// A blast at a point. What it empties does not all vanish: away from its middle the stuff comes out in lumps,
    /// which are bodies thrown from it (glass, and the middle, are dust). Then what it left unheld comes loose.
    /// `after` is how many of the solver's own edits the blast's maker had heard of; `spark` is whether it sets things
    /// alight. Returns how many bodies were made.
    pub fn blast(&mut self, at: [i32; 3], radius: i32, after: Option<usize>, spark: bool) -> usize {
        let far = radius * 3 + 2;
        let (low, size) = (at.map(|c| c - far), [(2 * far + 1) as usize; 3]);
        let before = Region::gather(low, size, &self.ground.edits, &mut self.ground.scratch);
        self.ground.push(Edit::Ball { centre: at, radius, kind: 0 }, false, after);
        let left = Region::gather(low, size, &self.ground.edits, &mut self.ground.scratch);
        self.ground.holds = None;
        // The emptied cells, gathered into lumps a few cells across whose edges wander.
        let mut lumps: Map<[i32; 3], Vec<([i32; 3], Kind)>> = Map::default();
        let wander = |a: i32, b: i32, seed: u32| (hash3(a >> 2, b >> 2, seed as i32, 11) & 3) as i32;
        for y in 0..size[1] {
            for z in 0..size[2] {
                for x in 0..size[0] {
                    let i = before.at(x, y, z);
                    let kind = before.cells[i];
                    if kind == 0 || left.cells[i] != 0 || material(kind) == GLASS {
                        continue;
                    }
                    let c = [low[0] + x as i32, low[1] + y as i32, low[2] + z as i32];
                    let d = sub([c[0] as f32, c[1] as f32, c[2] as f32], [at[0] as f32, at[1] as f32, at[2] as f32]);
                    if dot(d, d) < (radius * radius) as f32 * 0.16 {
                        continue;
                    }
                    let key = [(c[0] + wander(c[1], c[2], 1)).div_euclid(5), (c[1] + wander(c[0], c[2], 2)).div_euclid(4), (c[2] + wander(c[0], c[1], 3)).div_euclid(5)];
                    lumps.entry(key).or_default().push((c, kind));
                }
            }
        }
        let mut keys: Vec<[i32; 3]> = lumps.keys().copied().collect();
        keys.sort_unstable();
        let mut made = 0;
        for key in keys {
            let cells = &lumps[&key];
            if cells.len() < 3 || self.list.len() >= MOST {
                continue;
            }
            let (mut lo, mut hi) = ([i32::MAX; 3], [i32::MIN; 3]);
            for (c, _) in cells {
                for a in 0..3 {
                    lo[a] = lo[a].min(c[a]);
                    hi[a] = hi[a].max(c[a] + 1);
                }
            }
            let size = [(hi[0] - lo[0]) as usize, (hi[1] - lo[1]) as usize, (hi[2] - lo[2]) as usize];
            let mut grid = vec![0 as Kind; size[0] * size[1] * size[2]];
            for (c, kind) in cells {
                grid[(c[0] - lo[0]) as usize + size[0] * ((c[2] - lo[2]) as usize + size[2] * (c[1] - lo[1]) as usize)] = *kind;
            }
            let mut body = Body::new(self.next, grid, size, lo);
            self.next += 1;
            self.throw(&mut body, at, radius);
            self.born(&body);
            self.list.push(body);
            made += 1;
        }
        // What can burn round the blast, and is still there, may catch: about one cell in twelve.
        if spark {
            self.ignite(at, radius + radius / 2, true);
        }
        made + self.release(at, radius)
    }

    /// A blast's push on a body: stronger near, and on small things, with a little spin.
    fn throw(&self, body: &mut Body, at: [i32; 3], radius: i32) {
        let away = sub(body.pos, [at[0] as f32, at[1] as f32, at[2] as f32]);
        let far = dot(away, away).sqrt();
        let r = radius as f32;
        let push = (30.0 * r * r / (far + r) / (body.count as f32).cbrt()).min(160.0);
        let h = |seed: u32| hash3(body.born[0], body.born[1], body.born[2], seed) as f32 / u32::MAX as f32 - 0.5;
        body.vel = add(body.vel, scale(add(unit(away), [h(4) * 0.5, 0.35 + h(5) * 0.3, h(6) * 0.5]), push));
        body.spin = add(body.spin, scale([h(1), h(2), h(3)], (push * 0.12).min(9.0)));
    }

    /// A body knocked harder than it can take comes apart where it is: its cells go to whichever of a few points in
    /// it is nearest, and each share is a body moving as that part of the whole was. Crumbs of it are dust.
    fn shatter(&mut self, whole: Body) {
        let solid: Vec<[usize; 3]> = (0..whole.cells.len()).filter(|&i| whole.cells[i] != 0).map(|i| [i % whole.size[0], i / (whole.size[0] * whole.size[2]), i / whole.size[0] % whole.size[2]]).collect();
        let parts = (whole.count / 40).clamp(2, 5);
        let seeds: Vec<[usize; 3]> = (0..parts).map(|k| solid[hash3(whole.born[0], whole.born[1] + k as i32, whole.born[2], whole.id) as usize % solid.len()]).collect();
        let mut shares: Vec<Vec<[usize; 3]>> = vec![Vec::new(); parts];
        for c in &solid {
            let near = (0..parts).min_by_key(|&k| (0..3).map(|a| (c[a] as i32 - seeds[k][a] as i32).pow(2)).sum::<i32>()).unwrap();
            shares[near].push(*c);
        }
        self.record(BROKE, &[whole.id]);
        for share in shares {
            let (mut lo, mut hi) = ([usize::MAX; 3], [0usize; 3]);
            for c in &share {
                for a in 0..3 {
                    lo[a] = lo[a].min(c[a]);
                    hi[a] = hi[a].max(c[a] + 1);
                }
            }
            // Where the share's middle is in the whole, and so in the world.
            let middle = share.iter().fold([0.0f32; 3], |m, c| add(m, [c[0] as f32 + 0.5, c[1] as f32 + 0.5, c[2] as f32 + 0.5]));
            let r = turn(whole.rot, sub(scale(middle, 1.0 / share.len().max(1) as f32), whole.com));
            if share.len() < 4 {
                if let Some(c) = share.first() {
                    let p = add(whole.pos, r);
                    self.record(DUST, &[p[0].to_bits(), p[1].to_bits(), p[2].to_bits(), whole.cells[whole.at(c[0], c[1], c[2])] as u32, share.len() as u32]);
                }
                continue;
            }
            let size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
            let mut grid = vec![0 as Kind; size[0] * size[1] * size[2]];
            for c in &share {
                grid[c[0] - lo[0] + size[0] * (c[2] - lo[2] + size[2] * (c[1] - lo[1]))] = whole.cells[whole.at(c[0], c[1], c[2])];
            }
            let born = [whole.born[0] + lo[0] as i32, whole.born[1] + lo[1] as i32, whole.born[2] + lo[2] as i32];
            let mut body = Body::new(self.next, grid, size, born);
            self.next += 1;
            // Its own middle of mass, as it sat in the whole.
            let own = turn(whole.rot, sub(add([lo[0] as f32, lo[1] as f32, lo[2] as f32], body.com), whole.com));
            body.pos = add(whole.pos, own);
            body.rot = whole.rot;
            body.vel = add(whole.speed_at(own), scale(unit(r), 6.0));
            body.spin = whole.spin;
            body.broken = whole.broken + 1;
            self.born(&body);
            self.list.push(body);
        }
    }

    /// Moves every body on by `dt` seconds, in whole steps; what is left over is owed to the next call.
    pub fn advance(&mut self, dt: f32) {
        self.owed = (self.owed + dt).min(STEP * STEPS);
        self.steps = 0;
        self.tried = 0;
        while self.owed >= STEP && !self.list.is_empty() {
            self.owed -= STEP;
            self.step(STEP);
            self.steps += 1;
        }
        if self.list.is_empty() {
            self.owed = 0.0;
        }
        self.burn(dt);
        let mut words: Vec<u32> = Vec::with_capacity(self.list.len() * 8);
        for b in &self.list {
            words.push(b.id);
            words.extend(b.pos.iter().chain(b.rot.iter()).map(|v| v.to_bits()));
        }
        self.record(MOVES, &words);
    }

    fn step(&mut self, h: f32) {
        // What pulls and what touches.
        self.touches.clear();
        let mut found: Vec<(V, V, V, f32)> = Vec::new();
        for i in 0..self.list.len() {
            let b = &mut self.list[i];
            b.vel[1] -= G * h;
            b.spin = scale(b.spin, 1.0 - 0.4 * h);
            b.age += h;
            b.apart += h;
            b.knock = 0.0;
            let (pos, rot) = (b.pos, b.rot);
            for k in 0..self.list[i].points.len() {
                let r = turn(rot, self.list[i].points[k]);
                let p = add(pos, r);
                let cell = [p[0].floor() as i32, p[1].floor() as i32, p[2].floor() as i32];
                self.tried += 1;
                if !self.ground.solid(cell[0], cell[1], cell[2]) {
                    continue;
                }
                // Shut in deep: out is back towards the body's own middle.
                let ground = &mut self.ground;
                let (n, deep) = way_out(p, cell, |c| ground.solid(c[0], c[1], c[2])).unwrap_or_else(|| (unit(scale(r, -1.0)), 1.0));
                found.push((r, [0.0; 3], n, deep));
            }
            if !found.is_empty() {
                self.list[i].apart = 0.0;
            }
            keep(&mut found, i, NONE, &mut self.touches);
        }
        // Body against body: the points of each tried in the cells of the other. Only pairs with a big body in them
        // are tried, so each big body is asked which others are near it.
        let big: Vec<usize> = (0..self.list.len()).filter(|&i| self.list[i].count >= SMALL).collect();
        for &i in &big {
            for j in 0..self.list.len() {
                // Two big bodies are a pair once.
                if j == i || (self.list[j].count >= SMALL && j < i) {
                    continue;
                }
                let (a, b) = (&self.list[i], &self.list[j]);
                let apart = sub(b.pos, a.pos);
                let reach = a.radius + b.radius;
                if dot(apart, apart) > reach * reach {
                    continue;
                }
                for (one, other, flip) in [(i, j, false), (j, i, true)] {
                    let (a, b) = (&self.list[one], &self.list[other]);
                    for &point in &a.points {
                        let ra = turn(a.rot, point);
                        let p = add(a.pos, ra);
                        let rb = sub(p, b.pos);
                        if dot(rb, rb) > b.radius * b.radius {
                            continue;
                        }
                        let (cell, q) = b.cell_at(p);
                        if !b.solid(cell) {
                            continue;
                        }
                        let (n, deep) = way_out(q, cell, |c| b.solid(c)).unwrap_or_else(|| (unit(back(b.rot, rb)), 1.0));
                        let n = turn(b.rot, n);
                        // Always told as: the first body of the pair is pushed along n.
                        if flip { found.push((rb, ra, scale(n, -1.0), deep)) } else { found.push((ra, rb, n, deep)) }
                    }
                }
                if !found.is_empty() {
                    self.list[i].apart = 0.0;
                    self.list[j].apart = 0.0;
                }
                keep(&mut found, i, j, &mut self.touches);
            }
        }
        // Each touch stops what is closing and rubs against what is sliding, a few times over.
        for _ in 0..8 {
            for t in 0..self.touches.len() {
                let (a, b, ra, rb, n) = { let t = &self.touches[t]; (t.a, t.b, t.ra, t.rb, t.n) };
                let rel = |list: &Vec<Body>| {
                    let va = list[a].speed_at(ra);
                    if b == NONE { va } else { sub(va, list[b].speed_at(rb)) }
                };
                let weight = |list: &Vec<Body>, d: V| {
                    let mut k = list[a].inv_mass + dot(cross(list[a].turn_resist(cross(ra, d)), ra), d);
                    if b != NONE {
                        k += list[b].inv_mass + dot(cross(list[b].turn_resist(cross(rb, d)), rb), d);
                    }
                    k
                };
                let v = rel(&self.list);
                let closing = dot(v, n);
                let bounce = if closing < -40.0 { 0.12 } else { 0.0 };
                let was = self.touches[t].pushed;
                let now = (was - (1.0 + bounce) * closing / weight(&self.list, n)).max(0.0);
                self.touches[t].pushed = now;
                let j = scale(n, now - was);
                let knock = now * self.list[a].inv_mass;
                self.list[a].knock = self.list[a].knock.max(knock);
                if b != NONE {
                    let knock = now * self.list[b].inv_mass;
                    self.list[b].knock = self.list[b].knock.max(knock);
                }
                self.list[a].push(ra, j);
                if b != NONE {
                    self.list[b].push(rb, scale(j, -1.0));
                }
                // Rubbing, across the touch, no more than the push allows.
                let across = if n[1].abs() < 0.9 { unit(cross(n, [0.0, 1.0, 0.0])) } else { unit(cross(n, [1.0, 0.0, 0.0])) };
                for (k, d) in [across, cross(n, across)].into_iter().enumerate() {
                    let sliding = dot(rel(&self.list), d);
                    let most = 0.7 * self.touches[t].pushed;
                    let was = self.touches[t].rubbed[k];
                    let now = (was - sliding / weight(&self.list, d)).clamp(-most, most);
                    self.touches[t].rubbed[k] = now;
                    let j = scale(d, now - was);
                    self.list[a].push(ra, j);
                    if b != NONE {
                        self.list[b].push(rb, scale(j, -1.0));
                    }
                }
            }
        }
        // What overlaps is eased apart, without that becoming speed.
        for t in &self.touches {
            let ease = ((t.depth - 0.05) * 0.2).clamp(0.0, 0.3);
            if ease <= 0.0 {
                continue;
            }
            if t.b == NONE {
                self.list[t.a].pos = add(self.list[t.a].pos, scale(t.n, ease));
            } else {
                let (ma, mb) = (self.list[t.a].inv_mass, self.list[t.b].inv_mass);
                self.list[t.a].pos = add(self.list[t.a].pos, scale(t.n, ease * ma / (ma + mb)));
                self.list[t.b].pos = sub(self.list[t.b].pos, scale(t.n, ease * mb / (ma + mb)));
            }
        }
        // What was knocked harder than it can take breaks where it is.
        let mut i = 0;
        while i < self.list.len() {
            let b = &self.list[i];
            if b.count >= WHOLE && b.knock > breaks_at(material(b.first())) * (1.0 + b.broken as f32) && self.list.len() < MOST {
                let whole = self.list.swap_remove(i);
                self.shatter(whole);
            } else {
                i += 1;
            }
        }
        // On they go; what has lain still long enough is cells again.
        let mut i = 0;
        while i < self.list.len() {
            let b = &mut self.list[i];
            b.pos = add(b.pos, scale(b.vel, h));
            let w = b.spin;
            let q = b.rot;
            let dq = [
                0.5 * h * (w[0] * q[3] + w[1] * q[2] - w[2] * q[1]),
                0.5 * h * (w[1] * q[3] + w[2] * q[0] - w[0] * q[2]),
                0.5 * h * (w[2] * q[3] + w[0] * q[1] - w[1] * q[0]),
                0.5 * h * (-w[0] * q[0] - w[1] * q[1] - w[2] * q[2]),
            ];
            let q = [q[0] + dq[0], q[1] + dq[1], q[2] + dq[2], q[3] + dq[3]];
            let l = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
            b.rot = [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
            // The longer a body has been about, the less still it need be: something rocking in a corner is put down.
            let ease = 1.0 + (b.age - 2.5).max(0.0) * 0.8;
            let slow = dot(b.vel, b.vel) < (STILL_SPEED * ease).powi(2) && dot(b.spin, b.spin) < (STILL_SPIN * ease).powi(2);
            b.still = if slow && b.apart < 0.1 { b.still + h } else { 0.0 };
            if b.still >= STILL_FOR || b.age >= OLD {
                let body = self.list.swap_remove(i);
                self.rested.push((body.age * 10.0) as u32);
                self.rest(body);
            } else {
                i += 1;
            }
        }
    }

    /// A body that has come to rest is cells of the world again, as it lies. One lying nearly square to the world is
    /// put down square, cell for cell; one lying askew is cut along the world's cells, which changes how many it is.
    fn rest(&mut self, mut body: Body) {
        let (rot, square) = squared(body.rot);
        body.rot = rot;
        if square {
            // Its own low corner lands on a whole cell.
            let corner = sub(body.pos, turn(rot, body.com));
            let snapped = [corner[0].round(), corner[1].round(), corner[2].round()];
            body.pos = add(body.pos, sub(snapped, corner));
        }
        // The box round it in the world.
        let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
        for d in 0..8 {
            let c = [if d & 1 == 0 { 0.0 } else { body.size[0] as f32 }, if d & 2 == 0 { 0.0 } else { body.size[1] as f32 }, if d & 4 == 0 { 0.0 } else { body.size[2] as f32 }];
            let w = add(body.pos, turn(rot, sub(c, body.com)));
            for a in 0..3 {
                lo[a] = lo[a].min(w[a]);
                hi[a] = hi[a].max(w[a]);
            }
        }
        let (lo, hi) = (lo.map(|v| (v + 0.01).floor() as i32), hi.map(|v| (v - 0.01).ceil() as i32));
        let mut runs: Vec<Run> = Vec::new();
        for y in lo[1]..hi[1] {
            for z in lo[2]..hi[2] {
                let mut open: Option<Run> = None;
                for x in lo[0]..hi[0] {
                    let (cell, _) = body.cell_at([x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5]);
                    let kind = if body.solid(cell) && !self.ground.solid(x, y, z) { body.cells[body.at(cell[0] as usize, cell[1] as usize, cell[2] as usize)] } else { 0 };
                    match &mut open {
                        Some(r) if r.kind == kind && kind != 0 => r.x1 = x + 1,
                        _ => {
                            if let Some(r) = open.take() {
                                runs.push(r);
                            }
                            if kind != 0 {
                                open = Some(Run { x0: x, x1: x + 1, y, z, kind });
                            }
                        }
                    }
                }
                if let Some(r) = open {
                    runs.push(r);
                }
            }
        }
        self.change(runs);
        // Where it lies is told once more, so that it is drawn there until the cells are in the picture.
        let mut words = vec![body.id];
        words.extend(body.pos.iter().chain(body.rot.iter()).map(|v| v.to_bits()));
        self.record(GONE, &words);
    }
}

/// The turn nearest to `q` that keeps the world's axes on the body's, and whether `q` was within a few degrees of it.
fn squared(q: Q) -> (Q, bool) {
    // Where the body's axes point, each snapped to the nearest of the world's.
    let axes = [turn(q, [1.0, 0.0, 0.0]), turn(q, [0.0, 1.0, 0.0]), turn(q, [0.0, 0.0, 1.0])];
    let snap = |v: V| {
        let a = if v[0].abs() >= v[1].abs() && v[0].abs() >= v[2].abs() { 0 } else if v[1].abs() >= v[2].abs() { 1 } else { 2 };
        let mut s = [0.0f32; 3];
        s[a] = v[a].signum();
        (s, v[a].abs())
    };
    let (x, cx) = snap(axes[0]);
    let (y, cy) = snap(axes[1]);
    let z = cross(x, y);
    // Within about eight degrees on both, and the two snapped axes square to one another.
    if cx < 0.99 || cy < 0.99 || dot(z, z) < 0.5 {
        return (q, false);
    }
    // The quaternion of the matrix whose columns are x, y, z.
    let m = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
    let trace = m[0][0] + m[1][1] + m[2][2];
    let out = if trace > 0.0 {
        let s = (trace + 1.0).sqrt() * 2.0;
        [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4.0]
    } else if m[0][0] > m[1][1] && m[0][0] > m[2][2] {
        let s = (1.0 + m[0][0] - m[1][1] - m[2][2]).sqrt() * 2.0;
        [s / 4.0, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s]
    } else if m[1][1] > m[2][2] {
        let s = (1.0 + m[1][1] - m[0][0] - m[2][2]).sqrt() * 2.0;
        [(m[0][1] + m[1][0]) / s, s / 4.0, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s]
    } else {
        let s = (1.0 + m[2][2] - m[0][0] - m[1][1]).sqrt() * 2.0;
        [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4.0, (m[1][0] - m[0][1]) / s]
    };
    (out, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kinds::{BRICK, CONCRETE, OWN, kind};

    /// A street: flat, hard, nothing over it.
    const X: i32 = 700;
    const Z: i32 = 4070;

    fn block(size: [usize; 3], k: Kind) -> Vec<Kind> {
        vec![k; size[0] * size[1] * size[2]]
    }

    fn run(bodies: &mut Bodies, seconds: f32) -> Vec<Run> {
        let mut put: Vec<Run> = Vec::new();
        let mut t = 0.0;
        let mut n = 0;
        while t < seconds && !bodies.list.is_empty() {
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            t += 1.0 / 60.0;
            n += 1;
            if std::env::var("WATCH").is_ok() && n % 6 == 0 {
                eprintln!("{t:.2}: {:?}", bodies.list.iter().map(|b| (b.id, b.pos.map(|v| (v * 10.0).round() / 10.0), b.vel.map(|v| v.round()), b.apart, (b.still * 100.0).round())).collect::<Vec<_>>());
            }
            let (mut i, out) = (0, &bodies.out);
            while i < out.len() {
                let (tag, n) = (out[i], out[i + 1] as usize);
                if tag == EDIT {
                    for r in out[i + 8..i + 2 + n].chunks_exact(5) {
                        put.push(Run { x0: r[0] as i32, x1: r[1] as i32, y: r[2] as i32, z: r[3] as i32, kind: r[4] as Kind });
                    }
                }
                i += 2 + n;
            }
        }
        put
    }

    #[test]
    fn a_dropped_block_lies_on_the_street_cell_for_cell() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let size = [8, 4, 6];
        bodies.list.push(Body::new(1, block(size, kind(CONCRETE, OWN)), size, [X, ground + 40, Z]));
        let put = run(&mut bodies, 6.0);
        assert!(bodies.list.is_empty(), "the block did not come to rest in six seconds");
        let cells: i32 = put.iter().map(|r| r.x1 - r.x0).sum();
        assert_eq!(cells, 8 * 4 * 6, "a block lying square is put down cell for cell");
        let low = put.iter().map(|r| r.y).min().unwrap();
        assert_eq!(low, ground + 1, "it lies on the street, not in it or over it (street at {ground}): {:?}", put.iter().map(|r| r.y).collect::<std::collections::BTreeSet<_>>());
        assert!(put.iter().all(|r| r.y < ground + 10), "it lies flat or on its side, not on end in the air");
    }

    #[test]
    fn a_leaning_tower_goes_over() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let size = [6, 60, 6];
        let mut tower = Body::new(1, block(size, kind(BRICK, OWN)), size, [X, ground, Z]);
        // Leant a quarter of the way over about z, standing on its edge.
        let lean = 0.35f32;
        tower.rot = [0.0, 0.0, -(lean / 2.0).sin(), (lean / 2.0).cos()];
        tower.pos = add([X as f32 + 3.0, ground as f32 + 0.5, Z as f32 + 3.0], turn(tower.rot, [0.0, 30.0, 0.0]));
        bodies.list.push(tower);
        let put = run(&mut bodies, 12.0);
        assert!(bodies.list.is_empty(), "the tower did not come to rest in twelve seconds");
        let top = put.iter().map(|r| r.y).max().unwrap();
        assert!(top < ground + 14, "the tower lies down (its top is {} cells over the street)", top - ground);
        let cells: i32 = put.iter().map(|r| r.x1 - r.x0).sum();
        assert!((cells - 6 * 60 * 6).abs() < 6 * 60 * 6 / 10, "it is about as many cells lying as standing ({cells} of 2160)");
    }

    #[test]
    fn one_block_comes_to_rest_on_another() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let size = [10, 4, 10];
        bodies.list.push(Body::new(1, block(size, kind(CONCRETE, OWN)), size, [X, ground + 2, Z]));
        bodies.list.push(Body::new(2, block(size, kind(BRICK, OWN)), size, [X + 2, ground + 30, Z + 1]));
        let put = run(&mut bodies, 8.0);
        assert!(bodies.list.is_empty(), "the blocks did not come to rest in eight seconds: {:?}", bodies.list.iter().map(|b| (b.id, b.pos, b.vel, b.spin, b.rot, b.apart, b.still)).collect::<Vec<_>>());
        let cells: i32 = put.iter().map(|r| r.x1 - r.x0).sum();
        assert_eq!(cells, 800, "both lie square and whole");
        // The street climbs a tread under the first, so heights are told from where it lies.
        let (low, top) = (put.iter().map(|r| r.y).min().unwrap(), put.iter().map(|r| r.y).max().unwrap());
        assert!(low <= ground + 2, "the first lies on the street");
        assert_eq!(top, low + 7, "the second lies on the first, nothing between them");
    }

    #[test]
    fn what_a_blast_empties_comes_out_as_lumps_that_lie_down_soon() {
        // A charge in a house front: the wall it empties is thrown out in lumps, and most of them lie still within three seconds.
        use crate::city::{BLOCK_X, BLOCK_Z, Block, block as what};
        let (bx, bz) = (-12..12).flat_map(|bz| (-12..12).map(move |bx| (bx, bz))).find(|&(bx, bz)| what(bx, bz) == Block::Homes && city::ground(bx * BLOCK_X + 500, bz * BLOCK_Z + 150) > 80).unwrap();
        let (x, z) = (bx * BLOCK_X + 140 + 76 * 4 + 38, bz * BLOCK_Z + 150);
        let at = [x, city::ground(x, z) + 40, z + 30];
        let mut bodies = Bodies::new();
        let made = bodies.blast(at, 16, None, false);
        assert!(made > 20, "a charge in a wall threw out {made} lumps");
        let loose: usize = bodies.list.iter().map(|b| b.count).sum();
        let put = run(&mut bodies, 12.0);
        assert!(bodies.list.is_empty(), "{} bodies never came to rest", bodies.list.len());
        let down: i32 = put.iter().filter(|r| r.kind != 0).map(|r| r.x1 - r.x0).sum();
        assert!(down as f32 > loose as f32 * 0.75, "{loose} cells were thrown out and {down} lie down");
        let mut ages = bodies.rested.clone();
        ages.sort_unstable();
        let (half, most, last) = (ages[ages.len() / 2], ages[ages.len() * 9 / 10], ages[ages.len() - 1]);
        eprintln!("{} bodies of {loose} cells: half at rest by {:.1} s, nine in ten by {:.1} s, the last at {:.1} s; {down} cells lie down", ages.len(), half as f32 / 10.0, most as f32 / 10.0, last as f32 / 10.0);
        assert!(most <= 40, "nine lumps in ten lie still within four seconds (it took {:.1} s)", most as f32 / 10.0);
    }

    #[test]
    fn what_a_blast_loosens_becomes_bodies_and_lies_down() {
        // The house front the support rule's own check breaks: a street's edge in a block of homes, blasted along its ground floor.
        use crate::city::{BLOCK_X, BLOCK_Z, Block, block as what};
        let (bx, bz) = (-12..12).flat_map(|bz| (-12..12).map(move |bx| (bx, bz))).find(|&(bx, bz)| what(bx, bz) == Block::Homes && city::ground(bx * BLOCK_X + 500, bz * BLOCK_Z + 150) > 80).unwrap();
        let (x, z) = (bx * BLOCK_X + 140 + 76 * 4 + 38, bz * BLOCK_Z + 150);
        let y = city::ground(x, z) + 14;
        let mut bodies = Bodies::new();
        for i in 0..5 {
            for j in 0..3 {
                bodies.ground.push(Edit::Ball { centre: [x - 40 + i * 20, y, z + j * 30], radius: 16, kind: 0 }, false, None);
            }
        }
        let at = [x, y, z];
        let made = bodies.release(at, 16);
        assert!(made > 0, "nothing came loose");
        let loose: usize = bodies.list.iter().map(|b| b.count).sum();
        let put = run(&mut bodies, 14.0);
        assert!(bodies.list.is_empty(), "{} bodies never came to rest", bodies.list.len());
        let down: i32 = put.iter().filter(|r| r.kind != 0).map(|r| r.x1 - r.x0).sum();
        assert!(down as f32 > loose as f32 * 0.8 && (down as f32) < loose as f32 * 1.2, "{loose} cells came loose and {down} lie down");
    }
}
