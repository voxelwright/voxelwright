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

use crate::broadphase::{Aabb, Broadphase, IslandSolver};
use crate::hash::hash3;
use crate::kinds::{ASPHALT, BRICK, CONCRETE, EARTH, GLASS, GRASS, LEAVES, PLASTER, ROCK, ROOFING, SAND, WATER, WOOD, breaks_at, burns, charged, material, rubble, weighs};
use crate::scratch::{Run, Scratch};
use crate::support::{self, Region};
use crate::tree::{CELLS, Kind, SIDE, at, at as at_cell};
use crate::{Edit, SETTLE, WIDE, city, fill_of};
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

pub mod carve;
mod hull;
mod living;
#[cfg(test)]
mod pileup;
pub use living::{Foot, Live, Struck};

/// How fast things fall faster: cells a second, each second.
pub const G: f32 = 98.0;
/// One step of the solver, seconds. A cell is 10 cm, so a step is short.
pub const STEP: f32 = 1.0 / 120.0;
/// The most points a body meets things at.
const POINTS: usize = 160;
/// And for a lump that a blast threw out.
const LUMP_POINTS: usize = 36;
/// A body under this many cells does not meet other small bodies: lumps and shards land on the world and on big
/// things, and a heap of them is the world, not bodies on bodies. There is a lot of rubble.
const SMALL: usize = 160;
/// Brittle masonry rubble under this cell count pours back into world cells even when hybrid persistent sleeping
/// debris is enabled (#166).
pub const MASONRY_POUR_THRESHOLD: usize = 250;
/// Number of 120 Hz substeps a recent body-body contact stays linked in the island graph (0.125 s), preventing
/// momentary contact micro-chatter from splitting a resting stack into separate sleeping islands.
const CONTACT_TTL: u8 = 15;
/// The most steps one call takes: when the solver cannot keep up, things move slower, they do not pile up work.
const STEPS: f32 = 3.0;
/// With no more bodies awake than `MANY`, a call takes as many steps as a tenth of a second holds.
const FEW_STEPS: f32 = 12.0;
const MANY: usize = 48;
/// How still, for how long, before a body is cells again.
const STILL_SPEED: f32 = 4.0;
const STILL_SPIN: f32 = 0.35;
const STILL_FOR: f32 = 0.3;
/// A body that has not come to rest by now is put down where it is.
const OLD: f32 = 8.0;
/// The most bodies at once: past this, what a blast throws out is dust.
const MOST: usize = 700;
/// Past this many loose bodies, new small fragments are dust. Living things do not spend this budget.
const DEBRIS: usize = 120;
/// At most this many rigid fragments from one crush, including newly unsupported pieces.
const CRASH_LUMPS: usize = 3;
/// A body under this many cells does not break further.
const WHOLE: usize = 12;
/// How hard a body must strike the standing world to break it: its weight times the speed it loses. A lump of fifty
/// cells of brick falling three metres does; a crumb does not.
const HARD: f32 = 8000.0;
/// A blast this big or bigger is asked about again in a wide box, this many seconds on.
const FAR_FROM: i32 = 12;
const FAR_AFTER: f32 = 0.25;

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

/// A sector kept whole: all of one kind (air, or the ground far down), or its cells.
enum Kept {
    Same(Kind),
    Cells(Box<[Kind]>),
}

/// How many sectors are kept as cells (half a megabyte each): a wide box is a hundred, and many of those are air.
const KEEPS: usize = 112;

enum Sector {
    Air,
    Solid,
    /// A bit a cell for whether it is solid, and a bit a cell for whether it can burn; and the sector in blocks.
    Bits(Box<[u64; CELLS / 64]>, Box<[u64; CELLS / 64]>, Box<Coarse>),
}

/// How many blocks a sector is across, and how many it holds (support.rs `BLOCK`, `Blocks`).
const ACROSS: usize = SIDE / support::BLOCK;
const BLOCKS: usize = ACROSS * ACROSS * ACROSS;

/// A sector in blocks, kept as the sector changes, for asking what stands over a box too wide to gather cell by
/// cell (`Bodies::far`): the strongest stuff in each block, how many of its cells are built, and a bit a cell for
/// whether it is built (solid, and not the ground). When cells leave a block, what it is of is not looked for again
/// until none are left: it may be taken for stronger than it is, never for weaker.
struct Coarse {
    /// Which of the four stuffs that burn a cell is of, in two bits (`FUELS`): a fire asks it of every neighbour.
    sort: [[u64; CELLS / 64]; 2],
    built: [u64; CELLS / 64],
    kind: [Kind; BLOCKS],
    count: [u8; BLOCKS],
}

/// The stuffs that burn (kinds.rs `burns`), as `Coarse::sort` numbers them.
const FUELS: [u8; 4] = [LEAVES, GRASS, WOOD, ROOFING];

impl Coarse {
    #[inline]
    fn sorted(&mut self, i: usize, material: u8) {
        let n = FUELS.iter().position(|&f| f == material).unwrap_or(0) as u64;
        for (bit, plane) in self.sort.iter_mut().enumerate() {
            plane[i >> 6] = plane[i >> 6] & !(1 << (i & 63)) | (n >> bit & 1) << (i & 63);
        }
    }
    fn new(kind: Kind) -> Box<Coarse> {
        Box::new(Coarse { sort: [[0; CELLS / 64]; 2], built: [0; CELLS / 64], kind: [kind; BLOCKS], count: [0; BLOCKS] })
    }
    #[inline]
    fn block(i: usize) -> usize {
        let (x, y, z) = (i % SIDE, i / (SIDE * SIDE), i / SIDE % SIDE);
        x / support::BLOCK + ACROSS * (z / support::BLOCK + ACROSS * (y / support::BLOCK))
    }
}

/// The standing world as a body meets it: solid or not at any cell. Sectors are made when first asked for (the
/// city's rules, then every edit, as everywhere) and kept as one bit a cell.
pub struct Ground {
    pub(crate) edits: Vec<Edit>,
    /// Which edits this solver made itself (pieces taken out, bodies put down), and the box each edit reaches.
    ours: Vec<bool>,
    boxes: Vec<([i32; 3], [i32; 3])>,
    /// The sectors made, by where each is kept in `slots`; the one last asked about is remembered, for a body's points
    /// are asked about one after another and lie together.
    sectors: Map<[i32; 3], u32>,
    slots: Vec<Sector>,
    spare: Vec<u32>,
    last: ([i32; 3], u32),
    pub(crate) scratch: Scratch,
    /// Sectors kept whole, as cells, with when each was last asked for: the ones the solver is at work in. What the
    /// solver does itself (cells out, cells back, a blast put last) changes them where they are, so that a box of
    /// the world is copied out of them and not made again from every edit there has been. Made so, a box 5 m across
    /// took up to 293 ms once a street had burnt and fallen (tens of thousands of edits).
    kept: Map<[i32; 3], (Kept, u32)>,
    asked: u32,
    /// Whether any cell that goes up when hit (kinds.rs `CHARGED`) has been seen in the world: a fire need not look
    /// for one beside it until then.
    pub(crate) charged: bool,
    /// The boxes of the edits made since the water last asked (water.rs): what flows goes by what stands.
    pub(crate) latest: Vec<([i32; 3], [i32; 3])>,
}

/// The box an edit can change (high corner exclusive). A blast reaches as far as the weakest material gives: under three radii.
/// Whatever numbers the edit holds, the box is worked out without running over: it stops at the ends of the numbers.
pub(crate) fn reach(e: &Edit) -> ([i32; 3], [i32; 3]) {
    match e {
        Edit::Ball { centre, radius, kind } => {
            let r = if *kind == 0 { radius.saturating_mul(3).saturating_add(2) } else { radius.saturating_add(1) };
            (centre.map(|c| c.saturating_sub(r)), centre.map(|c| c.saturating_add(r).saturating_add(1)))
        }
        Edit::Runs(runs) | Edit::Rows(runs) => {
            let (mut lo, mut hi) = ([i32::MAX; 3], [i32::MIN; 3]);
            for r in runs {
                lo = [lo[0].min(r.x0), lo[1].min(r.y), lo[2].min(r.z)];
                hi = [hi[0].max(r.x1), hi[1].max(r.y.saturating_add(1)), hi[2].max(r.z.saturating_add(1))];
            }
            (lo, hi)
        }
        // Rows of quarter cells (#259): the solver is not told of them yet; this is only the box they would reach.
        Edit::Fine(runs, shift) => {
            let (mut lo, mut hi, s) = ([i32::MAX; 3], [i32::MIN; 3], (*shift).min(31));
            for r in runs {
                lo = [lo[0].min(r.x0 >> s), lo[1].min(r.y >> s), lo[2].min(r.z >> s)];
                hi = [hi[0].max(((r.x1 as i64 + (1i64 << s) - 1) >> s) as i32), hi[1].max((r.y >> s).saturating_add(1)), hi[2].max((r.z >> s).saturating_add(1))];
            }
            (lo, hi)
        }
    }
}

impl Ground {
    pub fn new() -> Self {
        Ground { edits: Vec::new(), ours: Vec::new(), boxes: Vec::new(), sectors: Map::default(), slots: Vec::new(), spare: Vec::new(), last: ([i32::MIN; 3], 0), scratch: Scratch::new(), kept: Map::default(), asked: 0, charged: false, latest: Vec::new() }
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
            (Edit::Runs(runs) | Edit::Rows(runs), true) => self.rows(runs),
            _ => self.forget(b),
        }
        let s = SIDE as i32;
        match (&e, last) {
            // Rows put last change the sectors kept whole in place too: a street that burns while it comes down asks
            // what hundreds of cells are made of between one landing and the next, and with every landing forgetting
            // the sectors it reached, each asking made a sector again from thousands of edits (9 to 15 s a call).
            (Edit::Runs(runs) | Edit::Rows(runs), true) => {
                for (k, (kept, _)) in &mut self.kept {
                    if (0..3).any(|a| (k[a] + 1) * s <= b.0[a] || k[a] * s >= b.1[a]) {
                        continue;
                    }
                    for r in runs.iter().filter(|r| r.y >> 6 == k[1] && r.z >> 6 == k[2]) {
                        let (x0, x1) = (r.x0.max(k[0] * s), r.x1.min((k[0] + 1) * s));
                        if x0 >= x1 {
                            continue;
                        }
                        if let Kept::Same(kind) = *kept {
                            if kind == r.kind {
                                continue;
                            }
                            *kept = Kept::Cells(vec![kind; CELLS].into_boxed_slice());
                        }
                        let Kept::Cells(cells) = kept else { unreachable!() };
                        let i = at_cell((x0 & 63) as usize, (r.y & 63) as usize, (r.z & 63) as usize);
                        cells[i..i + (x1 - x0) as usize].fill(r.kind);
                    }
                }
            }
            // Kept sectors any other edit reaches are forgotten: asked for again, they are made with it.
            _ => self.kept.retain(|k, _| (0..3).any(|a| (k[a] + 1) * s <= b.0[a] || k[a] * s >= b.1[a])),
        }
        self.edits.insert(at, e);
        self.ours.insert(at, ours);
        self.boxes.insert(at, b);
        self.latest.push(b);
    }

    /// Takes back the last edit: the sectors it reached are forgotten again.
    #[cfg(test)]
    fn undo(&mut self) {
        if let (Some(_), Some(_), Some(b)) = (self.edits.pop(), self.ours.pop(), self.boxes.pop()) {
            self.forget(b);
            let s = SIDE as i32;
            self.kept.retain(|k, _| (0..3).any(|a| (k[a] + 1) * s <= b.0[a] || k[a] * s >= b.1[a]));
        }
    }

    /// Every sector made is forgotten: asked for again, each is made from the edits as they are now read.
    pub(crate) fn forget_all(&mut self) {
        self.forget(([i32::MIN; 3], [i32::MAX; 3]));
        self.kept.clear();
    }

    /// What was made of the columns from (x0, z0) to (x1, z1) is forgotten (#526: a pack of the Bay came there after
    /// it was asked about, when it was water): asked for again, it is made from the packs and the edits as they are now.
    pub(crate) fn forget_columns(&mut self, x0: i32, z0: i32, x1: i32, z1: i32) {
        let (lo, hi) = ([x0, i32::MIN, z0], [x1, i32::MAX, z1]);
        self.forget((lo, hi));
        let s = SIDE as i32;
        self.kept.retain(|k, _| (0..3).any(|a| (k[a] + 1) * s <= lo[a] || k[a] * s >= hi[a]));
    }

    fn forget(&mut self, (lo, hi): ([i32; 3], [i32; 3])) {
        let s = SIDE as i32;
        let spare = &mut self.spare;
        self.sectors.retain(|k, slot| {
            let keeps = (0..3).any(|a| (k[a] + 1) * s <= lo[a] || k[a] * s >= hi[a]);
            if !keeps {
                spare.push(*slot);
            }
            keeps
        });
        self.last.0 = [i32::MIN; 3];
    }

    fn rows(&mut self, runs: &[Run]) {
        let s = SIDE as i32;
        for r in runs {
            for sx in r.x0 >> 6..=(r.x1 - 1) >> 6 {
                let Some(&slot) = self.sectors.get(&[sx, r.y >> 6, r.z >> 6]) else { continue };
                let sector = &mut self.slots[slot as usize];
                if let Sector::Air | Sector::Solid = sector {
                    let solid = matches!(sector, Sector::Solid);
                    *sector = Sector::Bits(Box::new([if solid { u64::MAX } else { 0 }; CELLS / 64]), Box::new([0; CELLS / 64]), Coarse::new(if solid { EARTH as Kind } else { 0 }));
                }
                let Sector::Bits(bits, fuel, coarse) = sector else { unreachable!() };
                let burns = burns(material(r.kind)).0 != 0;
                let built = r.kind != 0 && !support::is_ground(r.kind);
                for x in r.x0.max(sx * s)..r.x1.min((sx + 1) * s) {
                    let i = at((x & 63) as usize, (r.y & 63) as usize, (r.z & 63) as usize);
                    if r.kind == 0 { bits[i >> 6] &= !(1 << (i & 63)) } else { bits[i >> 6] |= 1 << (i & 63) }
                    if burns { fuel[i >> 6] |= 1 << (i & 63) } else { fuel[i >> 6] &= !(1 << (i & 63)) }
                    if burns {
                        coarse.sorted(i, material(r.kind));
                    }
                    // The same cell in the sector's blocks.
                    let b = Coarse::block(i);
                    let was = coarse.built[i >> 6] >> (i & 63) & 1 != 0;
                    if built { coarse.built[i >> 6] |= 1 << (i & 63) } else { coarse.built[i >> 6] &= !(1 << (i & 63)) }
                    coarse.count[b] = coarse.count[b] + built as u8 - was as u8;
                    if r.kind != 0 {
                        if coarse.kind[b] == 0 || support::rank(r.kind) > support::rank(coarse.kind[b]) {
                            coarse.kind[b] = r.kind;
                        }
                    } else if coarse.count[b] == 0 {
                        // Nothing built is left in the block: it is ground, if anything of it is solid still.
                        let (bx, by, bz) = ((x & 60) as usize, (r.y & 60) as usize, (r.z & 60) as usize);
                        let any = (0..16).any(|k| { let j = at(bx, by + k / 4, bz + k % 4); bits[j >> 6] >> (j & 63) & 15 != 0 });
                        coarse.kind[b] = if any { EARTH as Kind } else { 0 };
                    }
                }
            }
        }
    }

    /// Has a sector kept whole: as the world stands, the city's rules and then the edits that reach it, if it is not
    /// kept already. The list of edits only grows, and most of them are of somewhere else.
    fn keep(&mut self, key: [i32; 3]) {
        self.asked += 1;
        if let Some(kept) = self.kept.get_mut(&key) {
            kept.1 = self.asked;
            return;
        }
        let s = SIDE as i32;
        let (lo, hi) = (key.map(|k| k * s), key.map(|k| (k + 1) * s));
        let reaching = self.edits.iter().zip(&self.boxes).filter(|(_, (a, b))| (0..3).all(|i| a[i] < hi[i] && b[i] > lo[i])).map(|(e, _)| e);
        fill_of(&mut self.scratch, key[0], key[1], key[2], 0, reaching);
        self.store(key);
    }

    /// Keeps what the scratch holds as a sector's cells. The longest unasked for of those kept as cells make room.
    fn store(&mut self, key: [i32; 3]) {
        let first = self.scratch.cells[0];
        self.charged |= self.scratch.cells.iter().any(|&k| charged(k));
        let uniform = self.scratch.cells.iter().all(|&k| k == first);
        if !uniform {
            if let Some((Kept::Cells(existing), stamp)) = self.kept.get_mut(&key) {
                existing.copy_from_slice(&self.scratch.cells);
                *stamp = self.asked;
                return;
            }
        }
        let kept = if uniform { Kept::Same(first) } else { Kept::Cells(self.scratch.cells.clone().into_boxed_slice()) };
        self.kept.insert(key, (kept, self.asked));
        while self.kept.values().filter(|k| matches!(k.0, Kept::Cells(_))).count() > KEEPS {
            let oldest = *self.kept.iter().filter(|(_, k)| matches!(k.0, Kept::Cells(_))).min_by_key(|(_, k)| k.1).unwrap().0;
            self.kept.remove(&oldest);
        }
        if self.kept.len() > 4096 {
            // The one just stored stays, whatever it is: whoever asked for it reads it next (a sector all of one
            // kind, asked for after 4,096 others, was dropped here and the read then failed: #264, a survey).
            self.kept.retain(|k, kept| *k == key || matches!(kept.0, Kept::Cells(_)));
        }
    }

    /// One sector as the world stands, in the scratch.
    fn fill(&mut self, key: [i32; 3]) {
        self.keep(key);
        self.scratch.start_raw(key[0], key[1], key[2], 0);
        match &self.kept[&key].0 {
            Kept::Same(kind) => self.scratch.cells.fill(*kind),
            Kept::Cells(cells) => self.scratch.cells.copy_from_slice(cells),
        }
    }

    /// The world as it stands in a box (see `Region::gather`).
    pub(crate) fn region(&mut self, low: [i32; 3], size: [usize; 3]) -> Region {
        let mut region = Region::new(low, size);
        region.sectors(|sx, sy, sz, region| {
            self.keep([sx, sy, sz]);
            match &self.kept[&[sx, sy, sz]].0 {
                Kept::Same(kind) => region.take_cells(None, *kind, sx, sy, sz),
                Kept::Cells(cells) => region.take_cells(Some(cells), 0, sx, sy, sz),
            }
        });
        region
    }

    /// The box round a blast as it stands and as the blast leaves it. Each sector is made once: the blast is
    /// worked on what the scratch then holds. With `made`, the blast goes into the world as its last edit, and the
    /// sectors kept whole are kept as it left them.
    fn blasted(&mut self, at: [i32; 3], radius: i32, low: [i32; 3], size: [usize; 3], made: bool) -> (Region, Region) {
        let (mut before, mut left) = (Region::new(low, size), Region::new(low, size));
        let seed = crate::hash::hash(at[0], at[2], at[1] as u32);
        let edit = Edit::Ball { centre: at, radius, kind: 0 };
        let (lo, hi) = reach(&edit);
        let s = SIDE as i32;
        before.sectors(|sx, sy, sz, before| {
            self.keep([sx, sy, sz]);
            match &self.kept[&[sx, sy, sz]].0 {
                Kept::Same(kind) => before.take_cells(None, *kind, sx, sy, sz),
                Kept::Cells(cells) => before.take_cells(Some(cells), 0, sx, sy, sz),
            }
            // Air stays air, and a sector the blast does not reach stays as it is.
            let key = [sx, sy, sz];
            if matches!(self.kept[&key].0, Kept::Same(0)) || (0..3).any(|a| (key[a] + 1) * s <= lo[a] || key[a] * s >= hi[a]) {
                match &self.kept[&key].0 {
                    Kept::Same(kind) => left.take_cells(None, *kind, sx, sy, sz),
                    Kept::Cells(cells) => left.take_cells(Some(cells), 0, sx, sy, sz),
                }
                return;
            }
            self.fill(key);
            self.scratch.blast(at, radius, seed);
            left.take(&self.scratch, sx, sy, sz);
            if made {
                self.store(key);
            }
        });
        if made {
            self.forget((lo, hi));
            self.edits.push(edit);
            self.ours.push(false);
            self.boxes.push((lo, hi));
            self.latest.push((lo, hi));
        }
        (before, left)
    }

    /// Makes up to `most` of the sectors a box reaches that are not yet made. Returns how many it made, and whether
    /// all of the box's are now there.
    fn ready(&mut self, low: [i32; 3], size: [usize; 3], most: usize) -> (usize, bool) {
        let s = SIDE as i32;
        let mut made = 0;
        for sy in low[1].div_euclid(s)..=(low[1] + size[1] as i32 - 1).div_euclid(s) {
            for sz in low[2].div_euclid(s)..=(low[2] + size[2] as i32 - 1).div_euclid(s) {
                for sx in low[0].div_euclid(s)..=(low[0] + size[0] as i32 - 1).div_euclid(s) {
                    if self.sectors.contains_key(&[sx, sy, sz]) {
                        continue;
                    }
                    if made == most {
                        return (made, false);
                    }
                    self.slot([sx, sy, sz]);
                    made += 1;
                }
            }
        }
        (made, true)
    }

    /// A box of whole sectors, all of them made (`ready`), in blocks.
    fn blocks(&self, low: [i32; 3], size: [usize; 3]) -> support::Blocks {
        let (s, by) = (SIDE as i32, support::BLOCK);
        let mut region = Region::new(low, [size[0] / by, size[1] / by, size[2] / by]);
        let mut count = vec![0u8; region.cells.len()];
        for sy in 0..size[1] / SIDE {
            for sz in 0..size[2] / SIDE {
                for sx in 0..size[0] / SIDE {
                    let key = [low[0].div_euclid(s) + sx as i32, low[1].div_euclid(s) + sy as i32, low[2].div_euclid(s) + sz as i32];
                    for y in 0..ACROSS {
                        for z in 0..ACROSS {
                            let to = region.at(sx * ACROSS, sy * ACROSS + y, sz * ACROSS + z);
                            let from = ACROSS * (z + ACROSS * y);
                            match &self.slots[self.sectors[&key] as usize] {
                                Sector::Air => {}
                                Sector::Solid => region.cells[to..to + ACROSS].fill(EARTH as Kind),
                                Sector::Bits(_, _, coarse) => {
                                    region.cells[to..to + ACROSS].copy_from_slice(&coarse.kind[from..from + ACROSS]);
                                    count[to..to + ACROSS].copy_from_slice(&coarse.count[from..from + ACROSS]);
                                }
                            }
                        }
                    }
                }
            }
        }
        support::Blocks { region, count, by }
    }

    #[inline]
    fn box_hits_col(&self, x: i32, z: i32, y0: i32, y1: i32) -> bool {
        self.boxes.iter().any(|(a, b)| a[0] <= x && x < b[0] && a[2] <= z && z < b[2] && a[1] <= y1 && y0 < b[1])
    }

    fn make(&mut self, key: [i32; 3]) -> Sector {
        let s = SIDE as i32;
        let (lo, hi) = (key.map(|k| k * s), key.map(|k| (k + 1) * s));
        // Far under the ground or over the roofs nothing needs making, unless an edit reached there.
        let (first, last) = city::span(key[0], key[2], 0);
        if (key[1] < first || key[1] > last) && !self.boxes.iter().any(|(a, b)| (0..3).all(|i| a[i] < hi[i] && b[i] > lo[i])) {
            return if key[1] < first { Sector::Solid } else { Sector::Air };
        }
        if let Some((kept, _)) = self.kept.get(&key) {
            match kept {
                Kept::Same(0) => return Sector::Air,
                Kept::Same(k) if burns(material(*k)).0 == 0 && support::is_ground(*k) => return Sector::Solid,
                Kept::Same(k) => {
                    self.scratch.start(key[0], key[1], key[2], 0);
                    self.scratch.cells.fill(*k);
                }
                Kept::Cells(cells) => {
                    self.scratch.start(key[0], key[1], key[2], 0);
                    self.scratch.cells.copy_from_slice(cells);
                }
            }
        } else {
            let reaching = self.edits.iter().zip(&self.boxes).filter(|(_, (a, b))| (0..3).all(|i| a[i] < hi[i] && b[i] > lo[i])).map(|(e, _)| e);
            fill_of(&mut self.scratch, key[0], key[1], key[2], 0, reaching);
            self.charged |= self.scratch.cells.iter().any(|&k| charged(k));
        }
        let mut bits = Box::new([0u64; CELLS / 64]);
        let mut fuel = Box::new([0u64; CELLS / 64]);
        let mut coarse = Coarse::new(0);
        let (mut any, mut all) = (false, true);
        for (i, &kind) in self.scratch.cells.iter().enumerate() {
            if kind != 0 {
                bits[i >> 6] |= 1 << (i & 63);
                let b = Coarse::block(i);
                if coarse.kind[b] == 0 || support::rank(kind) > support::rank(coarse.kind[b]) {
                    coarse.kind[b] = kind;
                }
                if !support::is_ground(kind) {
                    coarse.built[i >> 6] |= 1 << (i & 63);
                    coarse.count[b] += 1;
                }
                let mat = material(kind);
                if burns(mat).0 != 0 {
                    coarse.sorted(i, mat);
                    fuel[i >> 6] |= 1 << (i & 63);
                }
                any = true;
            } else {
                all = false;
            }
        }
        // A sector that is all one solid thing is under the ground: nothing there burns.
        if !any { Sector::Air } else if all { Sector::Solid } else { Sector::Bits(bits, fuel, coarse) }
    }

    /// Where a sector is kept, made if it is not yet.
    #[inline]
    fn slot(&mut self, key: [i32; 3]) -> usize {
        if key == self.last.0 {
            return self.last.1 as usize;
        }
        let slot = match self.sectors.get(&key) {
            Some(&slot) => slot,
            None => {
                let made = self.make(key);
                let slot = match self.spare.pop() {
                    Some(slot) => {
                        self.slots[slot as usize] = made;
                        slot
                    }
                    None => {
                        self.slots.push(made);
                        self.slots.len() as u32 - 1
                    }
                };
                self.sectors.insert(key, slot);
                slot
            }
        };
        self.last = (key, slot);
        slot as usize
    }

    #[inline]
    pub fn solid(&mut self, x: i32, y: i32, z: i32) -> bool {
        let key = [x >> 6, y >> 6, z >> 6];
        let slot = if key == self.last.0 {
            Some(self.last.1 as usize)
        } else if let Some(&s) = self.sectors.get(&key) {
            self.last = (key, s);
            Some(s as usize)
        } else if crate::bay::on() && !self.box_hits_col(x, z, y, y) {
            return crate::bay::solid_single(x, y, z);
        } else {
            None
        };
        let slot = slot.unwrap_or_else(|| self.slot(key));
        match &self.slots[slot] {
            Sector::Air => false,
            Sector::Solid => true,
            Sector::Bits(bits, _, _) => {
                let i = at((x & 63) as usize, (y & 63) as usize, (z & 63) as usize);
                bits[i >> 6] >> (i & 63) & 1 != 0
            }
        }
    }

    /// Whether the cell is there and is of something that burns. As quick as `solid`: a fire asks it of every neighbour.
    #[inline]
    pub fn fuel(&mut self, x: i32, y: i32, z: i32) -> bool {
        let slot = self.slot([x >> 6, y >> 6, z >> 6]);
        match &self.slots[slot] {
            Sector::Bits(_, fuel, _) => {
                let i = at((x & 63) as usize, (y & 63) as usize, (z & 63) as usize);
                fuel[i >> 6] >> (i & 63) & 1 != 0
            }
            _ => false,
        }
    }

    /// What the cell is made of, if it is there and is of something that burns; nothing (0) if not. As quick as
    /// `fuel`. A fire asked `kind` of each neighbour that could burn, and a street on fire burns in more sectors than
    /// are kept whole: while it also came down, every such asking made a sector again from thousands of edits, and
    /// one call of the solver took 9 to 15 s.
    #[inline]
    pub fn fuel_stuff(&mut self, x: i32, y: i32, z: i32) -> u8 {
        if !self.fuel(x, y, z) {
            return 0;
        }
        let slot = self.slot([x >> 6, y >> 6, z >> 6]);
        let Sector::Bits(_, _, coarse) = &self.slots[slot] else { return 0 };
        let i = at((x & 63) as usize, (y & 63) as usize, (z & 63) as usize);
        FUELS[(coarse.sort[0][i >> 6] >> (i & 63) & 1 | (coarse.sort[1][i >> 6] >> (i & 63) & 1) << 1) as usize]
    }

    /// What the cell is made of. Slower than `solid`: its sector is made whole, and the last few asked about are kept.
    /// In unedited Bay columns, answers directly from the single column without building a 262,144-cell sector (#73).
    pub fn kind(&mut self, x: i32, y: i32, z: i32) -> Kind {
        let key = [x >> 6, y >> 6, z >> 6];
        let i = at((x & 63) as usize, (y & 63) as usize, (z & 63) as usize);
        if let Some(kept) = self.kept.get_mut(&key) {
            self.asked += 1;
            kept.1 = self.asked;
            return match &kept.0 {
                Kept::Same(kind) => *kind,
                Kept::Cells(cells) => cells[i],
            };
        }
        if crate::bay::on() && !self.box_hits_col(x, z, y, y) {
            return crate::bay::kind_single(x, y, z);
        }
        self.keep(key);
        match &self.kept[&key].0 {
            Kept::Same(kind) => *kind,
            Kept::Cells(cells) => cells[i],
        }
    }

    /// Top solid cell + 1 at or below `y` within `depth` cells (edits and all), or `i32::MIN` if none (#73).
    pub fn under(&mut self, x: i32, y: i32, z: i32, depth: i32) -> i32 {
        if crate::bay::on() && !self.box_hits_col(x, z, y - depth, y) {
            return crate::bay::under(x, y, z, depth);
        }
        let end = y - depth;
        let mut at = y;
        while at > end {
            if self.solid(x, at, z) {
                return at + 1;
            }
            at -= 1;
        }
        i32::MIN
    }
}

/// The shortest way out of the solid for a point in a solid cell, and how far that is: straight through one face,
/// to the nearest empty cell within three. A point just under a floor is pushed up, however near a step's edge it is;
/// one that went in through a wall is pushed back out of the wall. Nothing if it is shut in deeper than that.
#[inline]
fn way_out(p: V, cell: [i32; 3], solid: impl FnMut([i32; 3]) -> bool) -> Option<(V, f32)> {
    way_back(p, cell, [0.0; 3], solid)
}

/// As `way_out`, for a point of a living thing that is `r` from its body's middle: never out through a face that
/// looks the way the point itself sticks out. A car's nose went half through what it hit, the short way out of it
/// was onward, and so the car was held by its nose and could not back away.
#[inline]
fn way_back(p: V, cell: [i32; 3], r: V, mut solid: impl FnMut([i32; 3]) -> bool) -> Option<(V, f32)> {
    let mut best: Option<(V, f32)> = None;
    let long = dot(r, r).sqrt() * 0.35;
    for (a, d) in [(1, 1), (0, 1), (0, -1), (2, 1), (2, -1), (1, -1)] {
        if long > 0.0 && r[a] * d as f32 > long {
            continue;
        }
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
    pub(crate) inv_mass: f32,
    /// Its middle of mass, from its own low corner.
    pub com: V,
    /// What resists its turning, inverted, in its own axes.
    pub(crate) inv_inertia: [V; 3],
    /// Where its middle of mass is in the world, and how it is turned.
    pub pos: V,
    pub rot: Q,
    pub vel: V,
    pub spin: V,
    /// Where it meets things: corners of its cells, from its middle of mass.
    pub(crate) points: Vec<V>,
    /// The same as they are turned in this step, from its middle.
    pub(crate) turned: Vec<V>,
    pub(crate) radius: f32,
    pub(crate) still: f32,
    pub(crate) age: f32,
    /// How long since it last touched anything.
    pub(crate) apart: f32,
    /// The stretch its touches cover this step, from its middle of mass: least and most along x and z.
    pub(crate) footing: [f32; 4],
    /// The hardest single knock it took in the last step, as a change of speed; and how many times it has broken already.
    pub(crate) knock: f32,
    pub(crate) broken: u8,
    /// Rolling chassis damage, accumulated from substantial impacts; one means structural collapse.
    pub(crate) wear: f32,
    /// What most of it is made of.
    pub(crate) stuff: u8,
    /// Whether it is a lump a blast threw out: these are many, and are not tried against each other however big.
    pub(crate) lump: bool,
    /// Whether a blast threw it (and not merely let it go).
    pub(crate) thrown: bool,
    /// Whether it passes: come to rest it is gone, and is cells of nothing. A shot is not litter in the street.
    pub passing: bool,
    /// Where its low corner was in the world when it came loose: its cells keep the shades they had.
    pub born: [i32; 3],
    /// What makes it a living thing (living.rs), if it is one: it is then never put down as cells for lying still.
    pub live: Option<Box<Live>>,
    /// Whether it sleeps: a living thing or persistent rigid body left alone is not stepped until something stirs it.
    pub asleep: bool,
    /// When true, this body sleeps in place as an oriented rigid body at rest (0 CPU cost until disturbed) instead
    /// of pouring/snapping back into world cells (#166).
    pub persist_sleep: bool,
    /// Non-zero id of the sleeping simulation island this body belongs to (`0` while awake or unassigned).
    island_id: u32,
}

impl Body {
    #[inline]
    fn at(&self, x: usize, y: usize, z: usize) -> usize { x + self.size[0] * (z + self.size[2] * y) }

    #[inline]
    fn solid(&self, c: [i32; 3]) -> bool {
        (0..3).all(|a| c[a] >= 0 && (c[a] as usize) < self.size[a]) && self.cells[self.at(c[0] as usize, c[1] as usize, c[2] as usize)] != 0
    }

    /// Keep collision samples distributed over the whole fragment, not just its first face.
    pub(crate) fn limit_points(&mut self, limit: usize) {
        if self.points.len() > limit {
            let all = std::mem::take(&mut self.points);
            self.points = (0..limit).map(|k| all[k * all.len() / limit]).collect();
        }
    }

    /// Rebuilds the vehicle collision hull (`bodies/hull.rs`) after in-place cell edits.
    pub(crate) fn refresh_hull(&mut self) {
        let has_hull = self.live.as_ref().is_some_and(|live| live.hull.is_some());
        if has_hull {
            let next_hull = (self.count > 0).then(|| Box::new(hull::Hull::of(self)));
            self.live.as_mut().unwrap().hull = next_hull;
        }
    }

    /// A chassis crumples before it fails. `tough` still scales both wear and the catastrophic limit.
    /// Ignore suspension/curb chatter below 50% of tough; repeated substantial blows consume the reserve.
    fn crumple(&mut self, knock: f32, tough: f32) -> bool {
        let severe = ((knock / tough - 0.5) / 0.7).max(0.0);
        self.wear = (self.wear + severe * severe * 0.25).min(1.0);
        knock > tough * 1.2 || self.wear >= 1.0
    }

    /// A body from a box of cells whose low corner is at `low` in the world.
    pub fn new(id: u32, cells: Vec<Kind>, size: [usize; 3], low: [i32; 3]) -> Body {
        let mut b = Body {
            id, size, cells, count: 0, inv_mass: 0.0, com: [0.0; 3], inv_inertia: [[0.0; 3]; 3], pos: [0.0; 3], rot: [0.0, 0.0, 0.0, 1.0],
            vel: [0.0; 3], spin: [0.0; 3], points: Vec::new(), turned: Vec::new(), radius: 0.0, still: 0.0, age: 0.0, apart: 1.0, footing: [0.0; 4], knock: 0.0, broken: 0, wear: 0.0, stuff: 0, lump: false, thrown: false, passing: false, born: low, live: None, asleep: false, persist_sleep: false, island_id: 0,
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
        b.stuff = b.mostly();
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

    /// What most of it is made of: a tank on steel legs breaks as wood does.
    fn mostly(&self) -> u8 {
        let mut counts = [0u32; 16];
        for &k in &self.cells {
            if k != 0 {
                counts[(material(k) & 15) as usize] += 1;
            }
        }
        (0..16).max_by_key(|&m| counts[m]).unwrap_or(0) as u8
    }

    #[inline]
    fn turn_resist(&self, v: V) -> V {
        turn(self.rot, mul(&self.inv_inertia, back(self.rot, v)))
    }

    /// How fast a point of the body moves, `r` from its middle.
    #[inline]
    fn speed_at(&self, r: V) -> V { add(self.vel, cross(self.spin, r)) }

    /// A point of the world as the body's own cell, if it is in one.
    #[inline]
    fn cell_at(&self, world: V) -> ([i32; 3], V) {
        let q = add(back(self.rot, sub(world, self.pos)), self.com);
        ([q[0].floor() as i32, q[1].floor() as i32, q[2].floor() as i32], q)
    }

    /// Whether this body qualifies for Teardown-style persistent rigid sleeping under the hybrid rest policy:
    /// non-lump structural/prop bodies with `count >= SMALL`, not `passing`, and not small brittle masonry rubble
    /// under `MASONRY_POUR_THRESHOLD` (250) cells.
    #[inline]
    pub fn qualifies_for_persist_sleep(&self) -> bool {
        !self.lump
            && !self.passing
            && self.count >= SMALL
            && !(brittle(self.stuff) && self.count < MASONRY_POUR_THRESHOLD)
    }

    /// Conservative world-space AABB enclosing every solid cell and hull point of this oriented body.
    #[inline]
    pub fn world_aabb(&self) -> Aabb {
        let half = [self.size[0] as f32 * 0.5, self.size[1] as f32 * 0.5, self.size[2] as f32 * 0.5];
        let local_mid = [half[0] - self.com[0], half[1] - self.com[1], half[2] - self.com[2]];
        let mid = add(self.pos, turn(self.rot, local_mid));
        let ax = turn(self.rot, [half[0], 0.0, 0.0]);
        let ay = turn(self.rot, [0.0, half[1], 0.0]);
        let az = turn(self.rot, [0.0, 0.0, half[2]]);
        let ext = [
            ax[0].abs() + ay[0].abs() + az[0].abs() + 0.05,
            ax[1].abs() + ay[1].abs() + az[1].abs() + 0.05,
            ax[2].abs() + ay[2].abs() + az[2].abs() + 0.05,
        ];
        Aabb::new(
            [mid[0] - ext[0], mid[1] - ext[1], mid[2] - ext[2]],
            [mid[0] + ext[0], mid[1] + ext[1], mid[2] + ext[2]],
        )
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
    /// How fast the two were closing along `n` before anything was pushed (under zero when they close).
    closing: f32,
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
        out.push(Touch { a, b, ra, rb, n, depth, pushed: 0.0, rubbed: [0.0; 2], closing: 0.0 });
    }
    found.clear();
}

#[cfg(test)]
thread_local! { pub static SPENT: std::cell::RefCell<[f64; 8]> = const { std::cell::RefCell::new([0.0; 8]) }; }

/// What the solver tells whoever draws: a stream of records, each a tag, how many words follow, and the words.
pub const EDIT: u32 = 1; // low corner (3), high corner (3), then rows of x0, x1, y, z, kind
pub const BORN: u32 = 2; // id, cells, size (3), middle of mass (3, as floats), where it was (3), then faces (two words each)
pub const GONE: u32 = 3; // id
pub const DUST: u32 = 4; // where (3, as floats), kind, how much
pub const MOVES: u32 = 5; // for each body: id, place (3 floats), turn (4 floats)
pub const FIRE: u32 = 7; // how many cells are alight, then where some of them are (3 floats each)
pub const BROKE: u32 = 6; // id: the body is no more, and the pieces it broke into have been born
pub const FLOW: u32 = 8; // water that flows, as heights over a window of columns (water.rs `tell`)
pub const STRUCK: u32 = 10; // what struck what (living.rs `Struck`): a, b or 0 for the world, where (3 floats), closing speed, push, a's kind, b's kind, flags
pub const LIVE: u32 = 11; // for each living thing awake: id, speed along its front (float), feet on the ground, how many touches it had in the last step, what it is told (go, turn, rise as floats), flags (1 aloft, 2 boosting, 4 launching, bits 8..15 boost fuel 0..255, bits 16..23 burnout charge 0..255), and its frame (4 floats: the turn from its own upright to the world's, when its down is not the world's)
pub const FIGURE: u32 = 12; // someone's body is born (living.rs `figure`): id, size (3), middle of mass (3 floats). It is in MOVES as every body is, and is drawn by whoever draws people
pub const TOOK: u32 = 13; // a ghost was struck (living.rs `ghost`): id, the speed the blow would have given it (3 floats, cells a second)
pub const BURST: u32 = 9; // where (3, as floats), radius: a blast the solver set off itself (something went up), for its fire and smoke
pub const POSE: u32 = 14; // ragdoll pose: ragdoll_id, followed by 17 u32 words packing the 67-byte ragdoll::pack_pose buffer (padded to 68 bytes)

/// High-bit tag identifying a ragdoll bone target in `ballistics::DynamicTarget` / `beams::BeamTarget`.
const RAGDOLL_TARGET_BIT: u32 = 1 << 31;

#[inline]
fn encode_ragdoll_target(ragdoll_id: u32, bone: crate::ragdoll::BoneId) -> u32 {
    RAGDOLL_TARGET_BIT | ((ragdoll_id & 0x07FF_FFFF) << 4) | (bone.index() as u32 & 0xF)
}

#[inline]
fn decode_ragdoll_target(target_id: u32) -> Option<(u32, crate::ragdoll::BoneId)> {
    if target_id & RAGDOLL_TARGET_BIT == 0 {
        return None;
    }
    let rid = (target_id & !RAGDOLL_TARGET_BIT) >> 4;
    let bone = crate::ragdoll::BoneId::from_index((target_id & 0xF) as usize)?;
    Some((rid, bone))
}

#[inline]
fn pack_pose_words(id: u32, ragdoll: &crate::ragdoll::Ragdoll) -> [u32; 18] {
    let bytes = ragdoll.pack_pose();
    let mut padded = [0u8; 68];
    padded[..crate::ragdoll::POSE_WIRE_BYTES].copy_from_slice(&bytes);
    let mut words = [0u32; 18];
    words[0] = id;
    for k in 0..17 {
        let o = k * 4;
        words[1 + k] = u32::from_le_bytes([padded[o], padded[o + 1], padded[o + 2], padded[o + 3]]);
    }
    words
}

#[inline]
fn face_tag(n: V) -> u8 {
    let (ax, ay, az) = (n[0].abs(), n[1].abs(), n[2].abs());
    if ax >= ay && ax >= az {
        if n[0] >= 0.0 { 0 } else { 1 }
    } else if ay >= az {
        if n[1] >= 0.0 { 2 } else { 3 }
    } else if n[2] >= 0.0 {
        4
    } else {
        5
    }
}

#[inline]
fn contact_feature_key(local_ra: V, n: V) -> u64 {
    let qx = (local_ra[0] * 2.0).round() as i32;
    let qy = (local_ra[1] * 2.0).round() as i32;
    let qz = (local_ra[2] * 2.0).round() as i32;
    let pt_hash = hash3(qx, qy, qz, 0x4D41_4E49);
    crate::solver::make_feature_key(pt_hash, face_tag(n))
}

/// One active articulated ragdoll tracked by `Bodies` with its stable non-zero ID
/// and any severed independent limbs (`ragdoll::DetachedLimb`).
/// What the Cleave lifted off its cut (`Bodies::cleave_wedge`): carried up off the cut by `lift_vec` over `snap_dur`
/// seconds of real time (eased out, `1 - (1 - t)^3`), held there still until `snap_dur + hang_dur`, then let go
/// with `release_vel` and `release_spin` (`Bodies::hang_tick`). While it hangs the solver neither pulls nor
/// touches it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CleaveHang {
    pub elapsed: f32,
    pub snap_dur: f32,
    pub hang_dur: f32,
    pub start_pos: V,
    pub lift_vec: V,
    pub release_vel: V,
    pub release_spin: V,
}

impl CleaveHang {
    /// A hang from `start_pos`, lifted by `lift_vec`, with Small Magic's timing (0.2 s up, 1.0 s held).
    pub fn new(start_pos: V, lift_vec: V, release_vel: V, release_spin: V) -> Self {
        CleaveHang { elapsed: 0.0, snap_dur: 0.2, hang_dur: 1.0, start_pos, lift_vec, release_vel, release_spin }
    }
}

/// A body something has taken hold of (`Bodies::capture_orbit`): carried round `center` by hand, out of the solver,
/// until it is flung (`Bodies::capture_fling`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CaptureOrbit {
    pub center: V,
    /// How far out it goes round, and its height over the middle.
    pub dist: f32,
    pub height: f32,
    pub angle: f32,
    /// Where it was taken from, and how long it has been held (it is eased onto its round).
    pub from: V,
    pub t: f32,
    pub spin: V,
}

/// The most bodies held in orbit at once, and the most let go in one call of `advance`: with thousands taken and
/// given back in one frame, the solver paid 33 ms a frame for it (Small Magic's `HOLD` and `OUT`).
pub const HOLD: usize = 1000;
pub const OUT: usize = 150;
/// How long a captured body takes to be eased onto its round, and its speed round it (cells a second).
const ORBIT_EASE: f32 = 0.6;
const ORBIT_SPEED: f32 = 60.0;
/// The Cleave's kerf: cells whose middle is this near the cut's sheet are cut (2.5 cells across).
const KERF: f32 = 1.25;
/// How far a cut reaches at most (cells), and how far apart its samples are across the sheet.
const CLEAVE_REACH: f32 = 1024.0;
const CLEAVE_STEP: f32 = 0.5;
/// What is lifted off a cut is lifted this far straight off it (cells, scaled down for a steep cut), slides off at
/// this speed (cells a second) with this much lift, and tips over at this rate (radians a second).
const CLEAVE_LIFT: f32 = 24.0;
const CLEAVE_SLIDE: f32 = 6.5;
const CLEAVE_HOP: f32 = 9.0;
const CLEAVE_TIP: f32 = 0.32;
/// The most boxes asked what a cut let go (each `SETTLE` across): a cut wider than that frees only what is in them.
const CLEAVE_BOXES: usize = 6;

pub struct ActiveRagdoll {
    pub id: u32,
    pub ragdoll: crate::ragdoll::Ragdoll,
    pub detached: Vec<crate::ragdoll::DetachedLimb>,
}

pub struct Bodies {
    pub ground: Ground,
    pub list: Vec<Body>,
    next: u32,
    pub out: Vec<u32>,
    touches: Vec<Touch>,
    /// The pairs of vehicles that touch this step, each eased apart as one (hull.rs): the two, the way the first is
    /// pushed, and how far they are into each other.
    parted: Vec<(usize, usize, V, f32)>,
    /// Time owed to the solver that was not a whole step.
    owed: f32,
    /// How many steps the last call took, and what was counted in them: for measuring.
    pub steps: u32,
    pub tried: u32,
    pub paired: u32,
    pub crushes: u32,
    /// How old each body was when it came to rest, in tenths of a second: for measuring.
    pub rested: Vec<u32>,
    /// Seconds since a landing last broke the world.
    since_crush: f32,
    /// What burns (fire.rs).
    pub fire: crate::fire::Fire,
    /// What flows (water.rs).
    pub water: crate::water::Water,
    /// Wide boxes waiting to be asked about: see `far`.
    far: Vec<Far>,
    /// The last charges, each a place and a radius: a wide box lets go only of what one of them reached.
    scars: Vec<([i32; 3], i32)>,
    /// Blasts that are to go off of themselves: where, how big, and in how many seconds (`go_up`).
    fuses: Vec<([i32; 3], i32, f32)>,
    /// Seconds since the fire was last asked whether it has reached something that goes up.
    since_lit: f32,
    /// What struck what since it was last told (living.rs).
    struck: Vec<Struck>,
    /// The id of the living thing last made, 0 if the last asked for could not be.
    pub spawned: u32,
    /// Spatial broadphase (`SpatialHash` + flat `DynamicBvh`) over active and sleeping bodies (#166).
    broadphase: Broadphase,
    broadphase_stale: bool,
    pairs: Vec<(usize, usize)>,
    query_buf: Vec<usize>,
    /// Union-Find simulation island solver and persistent contact-graph memory for island sleeping.
    islands: IslandSolver,
    recent_contacts: Map<(u32, u32), u8>,
    id_to_idx: Map<u32, usize>,
    next_island: u32,
    /// Opt-in hybrid rest policy: when true, newly released/shattered bodies qualifying under
    /// `Body::qualifies_for_persist_sleep` sleep in place as oriented rigid bodies while brittle rubble pours.
    pub persist_debris: bool,
    /// 6-DOF joints, hinges, motors, ropes, and winches (`joints.rs`, #166).
    pub joints: crate::joints::JointSet,
    /// Active 13-bone articulated ragdolls (`ragdoll.rs`, #166).
    pub ragdolls: Vec<ActiveRagdoll>,
    next_ragdoll: u32,
    /// Active ballistic projectiles and guided shaped-charge rockets (`ballistics.rs`, #166).
    pub ballistics: crate::ballistics::BallisticSim,
    /// Active occluded blast shockwaves and directional shrapnel (`ballistics.rs`, #166).
    pub shockwaves: crate::ballistics::ShockwaveQueue,
    /// Continuous multi-bounce thermal laser/beam system (`beams.rs`, #166).
    pub beams: crate::beams::BeamSystem,
    /// Last traced beam result (segments, events, thermal glows) from `beams_fire`.
    pub last_beam: crate::beams::BeamResult,
    /// Incremental time-sliced structural support jobs (`support.rs`, #166).
    pub support_jobs: Vec<crate::support::SupportJob>,
    /// Active rain intensity in `0.0..=1.0` for extinguishing static and dynamic flames.
    pub rain_intensity: f32,
    /// Optional global sea-level plane Y in cells (`None` by default so dry-town tests are unaffected).
    pub sea_level: Option<f32>,
    /// Persistent contact manifold impulse cache for warm-starting resting rigid contacts (`solver.rs`, #166).
    pub manifold_cache: crate::solver::ManifoldCache,
    solver_step: u64,
    /// Reusable per-step scratch buffers for joint and ballistic coupling.
    joint_bodies_buf: Vec<crate::joints::SolverBody>,
    ballistic_targets_buf: Vec<crate::ballistics::DynamicTarget>,
    shock_targets_buf: Vec<crate::ballistics::DynamicTarget>,
    ballistic_events_buf: Vec<crate::ballistics::BallisticEvent>,
    /// What the Cleave holds in the air, by body id (`cleave_wedge`, `hang_tick`).
    hangs: Vec<(u32, CleaveHang)>,
    /// What is held in orbit, by body id (`capture_orbit`).
    orbits: Vec<(u32, CaptureOrbit)>,
    /// Flung bodies still held, waiting to be let go `OUT` a call: id, velocity, spin, distance out. The outermost is
    /// last, and goes first.
    outgoing: Vec<(u32, V, V, f32)>,
}

/// A wide box that is to be asked what stands in it (`Bodies::far`): its low corner, how many seconds it still
/// waits, and, once it has been asked, what came loose and is being gathered.
struct Far {
    low: [i32; 3],
    wait: f32,
    found: Option<Found>,
}

/// What a wide box said is loose: the blocks, which of them, and the cells of the box round them, gathered a few
/// sectors a step (the sectors still to come are `keys` from `next` on).
struct Found {
    blocks: support::Blocks,
    loose: Vec<bool>,
    part: Region,
    keys: Vec<[i32; 3]>,
    next: usize,
}

impl Bodies {
    pub fn new() -> Self {
        Bodies {
            ground: Ground::new(),
            list: Vec::new(),
            next: 1,
            out: Vec::new(),
            touches: Vec::new(),
            parted: Vec::new(),
            owed: 0.0,
            steps: 0,
            tried: 0,
            paired: 0,
            crushes: 0,
            rested: Vec::new(),
            since_crush: 1.0,
            fire: crate::fire::Fire::default(),
            water: crate::water::Water::default(),
            far: Vec::new(),
            scars: Vec::new(),
            fuses: Vec::new(),
            since_lit: 0.0,
            struck: Vec::new(),
            spawned: 0,
            broadphase: Broadphase::new(),
            broadphase_stale: true,
            pairs: Vec::new(),
            query_buf: Vec::new(),
            islands: IslandSolver::new(),
            recent_contacts: Map::default(),
            id_to_idx: Map::default(),
            next_island: 1,
            persist_debris: false,
            joints: crate::joints::JointSet::new(),
            ragdolls: Vec::new(),
            next_ragdoll: 1,
            ballistics: crate::ballistics::BallisticSim::new(),
            shockwaves: crate::ballistics::ShockwaveQueue::new(),
            beams: crate::beams::BeamSystem::new(),
            last_beam: crate::beams::BeamResult::default(),
            support_jobs: Vec::new(),
            rain_intensity: 0.0,
            sea_level: None,
            manifold_cache: crate::solver::ManifoldCache::new(),
            solver_step: 0,
            joint_bodies_buf: Vec::new(),
            ballistic_targets_buf: Vec::new(),
            shock_targets_buf: Vec::new(),
            ballistic_events_buf: Vec::new(),
            hangs: Vec::new(),
            orbits: Vec::new(),
            outgoing: Vec::new(),
        }
    }

    /// Rebuilds both the spatial hash and flat BVH over all bodies in `self.list`.
    pub fn rebuild_broadphase(&mut self) {
        self.broadphase.clear();
        for (i, b) in self.list.iter().enumerate() {
            self.broadphase.insert(i, b.world_aabb());
        }
        self.broadphase.rebuild();
        self.broadphase_stale = false;
    }

    /// Fast O(N) spatial-hash-only rebuild used inside 120 Hz physics substeps.
    fn rebuild_broadphase_hash(&mut self) {
        self.broadphase.clear_hash_only();
        for (i, b) in self.list.iter().enumerate() {
            self.broadphase.insert_hash_only(i, b.world_aabb());
        }
        self.broadphase.rebuild_hash();
    }

    /// Queries the broadphase for all body indices whose world AABB intersects `aabb` (sorted, deduplicated).
    pub fn broadphase_query_aabb(&self, aabb: Aabb, out: &mut Vec<usize>) {
        if !self.broadphase_stale && self.broadphase.len() == self.list.len() {
            self.broadphase.query_aabb(aabb, out);
        } else {
            out.clear();
            for (i, b) in self.list.iter().enumerate() {
                if b.world_aabb().intersects(&aabb) {
                    out.push(i);
                }
            }
        }
    }

    /// Raycasts against all body world AABBs via the broadphase BVH (sorted, deduplicated indices).
    pub fn broadphase_raycast(&self, origin: [f32; 3], inv_dir: [f32; 3], max_t: f32, out: &mut Vec<usize>) {
        if !self.broadphase_stale && self.broadphase.len() == self.list.len() {
            self.broadphase.raycast(origin, inv_dir, max_t, out);
        } else {
            out.clear();
            for (i, b) in self.list.iter().enumerate() {
                if b.world_aabb().ray_hit(origin, inv_dir, max_t).is_some() {
                    out.push(i);
                }
            }
        }
    }

    fn wake_island_id(&mut self, id: u32) {
        if id == 0 {
            return;
        }
        for b in &mut self.list {
            if b.island_id == id {
                b.asleep = false;
                b.still = 0.0;
                b.island_id = 0;
            }
        }
    }

    fn wake_body_and_island(&mut self, idx: usize) {
        let Some(b) = self.list.get_mut(idx) else { return };
        let id = b.island_id;
        b.asleep = false;
        b.still = 0.0;
        b.island_id = 0;
        if id != 0 {
            self.wake_island_id(id);
        }
    }

    /// Propagates any wake triggered externally (e.g. direct `b.asleep = false`, `kick`, `drive`, `stir`, `shove`)
    /// to every body in the same sleeping simulation island before the step runs.
    fn propagate_wakes(&mut self) {
        let mut woken: Vec<u32> = Vec::new();
        for b in &mut self.list {
            if !b.asleep && b.island_id != 0 {
                woken.push(b.island_id);
                b.island_id = 0;
                b.still = 0.0;
            }
        }
        for id in woken {
            self.wake_island_id(id);
        }
    }

    /// Wakes every sleeping body intersecting `[lo, hi]` and immediately wakes each hit body's entire sleeping island.
    pub fn wake_in_aabb(&mut self, lo: [f32; 3], hi: [f32; 3]) {
        if self.list.is_empty() || !self.list.iter().any(|b| b.asleep || b.island_id != 0) {
            return;
        }
        if self.broadphase_stale || self.broadphase.len() != self.list.len() {
            self.rebuild_broadphase();
        }
        let aabb = Aabb::new(lo, hi);
        let mut hits = std::mem::take(&mut self.query_buf);
        self.broadphase.query_aabb(aabb, &mut hits);
        for &idx in &hits {
            if let Some(b) = self.list.get(idx) {
                if b.asleep || b.island_id != 0 {
                    self.wake_body_and_island(idx);
                }
            }
        }
        self.query_buf = hits;
    }

    /// Builds simulation islands over active contacts and applies island-wide sleep: an island sleeps ONLY when every
    /// non-ghost body in the island meets its stillness threshold for `STILL_FOR` seconds.
    fn settle_islands(&mut self) {
        let n = self.list.len();
        if n == 0 {
            self.recent_contacts.clear();
            return;
        }
        self.id_to_idx.clear();
        for (i, b) in self.list.iter().enumerate() {
            self.id_to_idx.insert(b.id, i);
        }
        // Drop contact edges whose bodies disappeared or have separated beyond a 1-cell margin.
        let list = &self.list;
        let id_to_idx = &self.id_to_idx;
        self.recent_contacts.retain(|&(id_a, id_b), _| {
            let (Some(&ia), Some(&ib)) = (id_to_idx.get(&id_a), id_to_idx.get(&id_b)) else {
                return false;
            };
            list[ia].world_aabb().expand(1.0).intersects(&list[ib].world_aabb())
        });
        self.islands.reset(n);
        for &(id_a, id_b) in self.recent_contacts.keys() {
            if let (Some(&ia), Some(&ib)) = (self.id_to_idx.get(&id_a), self.id_to_idx.get(&id_b)) {
                self.islands.union(ia, ib);
            }
        }
        if self.joints.active_count() > 0 {
            for j in self.joints.joints() {
                if !j.broken && j.body_a != 0 && j.body_b != 0 {
                    if let (Some(&ia), Some(&ib)) = (self.id_to_idx.get(&j.body_a), self.id_to_idx.get(&j.body_b)) {
                        self.islands.union(ia, ib);
                    }
                }
            }
        }
        let mut next_island = self.next_island;
        let islands = self.islands.build_islands(n);
        let mut slept_ids: Vec<u32> = Vec::new();
        for island in islands {
            let mut has_dynamic = false;
            let mut all_already_asleep = true;
            let mut all_ready = true;
            for &m in &island.members {
                let b = &self.list[m];
                if b.live.as_ref().is_some_and(|live| live.ghost) {
                    continue;
                }
                has_dynamic = true;
                if !(b.asleep && b.island_id != 0) {
                    all_already_asleep = false;
                }
                let ready = if b.live.is_some() {
                    b.asleep
                } else if b.persist_sleep {
                    b.asleep || b.still >= STILL_FOR
                } else {
                    false
                };
                if !ready {
                    all_ready = false;
                }
            }
            if !has_dynamic || all_already_asleep {
                continue;
            }
            if all_ready {
                let island_id = next_island;
                next_island = next_island.wrapping_add(1).max(1);
                for &m in &island.members {
                    let b = &mut self.list[m];
                    if b.live.as_ref().is_some_and(|live| live.ghost) {
                        continue;
                    }
                    b.asleep = true;
                    b.vel = [0.0; 3];
                    b.spin = [0.0; 3];
                    b.still = 0.0;
                    b.island_id = island_id;
                    slept_ids.push(b.id);
                }
            } else {
                // Keep every dynamic member of an active island awake together.
                for &m in &island.members {
                    let b = &mut self.list[m];
                    if b.live.as_ref().is_some_and(|live| live.ghost) {
                        continue;
                    }
                    if b.asleep {
                        b.asleep = false;
                        b.island_id = 0;
                    }
                }
            }
        }
        self.next_island = next_island;
        if !slept_ids.is_empty() {
            self.recent_contacts.retain(|&(a, b), _| {
                let a_asleep = self.id_to_idx.get(&a).is_some_and(|&i| self.list[i].asleep);
                let b_asleep = self.id_to_idx.get(&b).is_some_and(|&i| self.list[i].asleep);
                !(a_asleep && b_asleep)
            });
        }
    }

    /// How many bodies move, and wide boxes/jobs/ragdolls/projectiles still active: while it is not nothing the solver
    /// is to be called on, for what a charge left standing may yet come loose.
    pub fn busy(&self) -> usize {
        self.list.iter().filter(|b| !b.asleep).count()
            + self.far.len()
            + self.fuses.len()
            + self.support_jobs.len()
            + self.ragdolls.len()
            + self.ballistics.projectiles.len()
            + self.ballistics.shockwaves.active_waves()
            + self.ballistics.shockwaves.active_shrapnel()
            + self.shockwaves.active_waves()
            + self.shockwaves.active_shrapnel()
    }

    /// Configures environment sea level (`None` disables global sea plane) and rain intensity (`0..=1`).
    pub fn set_env(&mut self, sea_level: Option<f32>, rain_intensity: f32) {
        self.sea_level = sea_level.filter(|v| v.is_finite());
        self.rain_intensity = if rain_intensity.is_finite() { rain_intensity.clamp(0.0, 1.0) } else { 0.0 };
    }

    /// Enqueues an incremental time-sliced `SupportJob` covering `[low, low + size)`.
    pub fn enqueue_support_job(&mut self, low: [i32; 3], size: [usize; 3], shove: Option<([i32; 3], i32)>) {
        let region = self.ground.region(low, size);
        self.support_jobs.push(crate::support::SupportJob::new(region, shove));
    }

    /// Wakes a body by ID along with its entire sleeping simulation island.
    pub fn wake_body_id(&mut self, body_id: u32) {
        if body_id == 0 {
            return;
        }
        if let Some(idx) = self.list.iter().position(|b| b.id == body_id) {
            self.wake_body_and_island(idx);
        }
    }

    fn wake_joint_bodies(&mut self, joint_ids: &[u32]) {
        if joint_ids.is_empty() {
            return;
        }
        let mut to_wake: Vec<u32> = Vec::with_capacity(joint_ids.len() * 2);
        for &jid in joint_ids {
            if let Some(j) = self.joints.get(jid) {
                if j.body_a != 0 {
                    to_wake.push(j.body_a);
                }
                if j.body_b != 0 {
                    to_wake.push(j.body_b);
                }
            }
        }
        for bid in to_wake {
            self.wake_body_id(bid);
        }
    }

    /// Cleans up dynamic fire and active joints referencing a body that broke, settled, or was destroyed.
    fn detach_removed_body(&mut self, body_id: u32) {
        self.fire.remove_body(body_id);
        if self.joints.active_count() == 0 {
            return;
        }
        let mut snapped = self.joints.invalidate_body_cells(body_id, |_| false);
        let mut partners: Vec<u32> = Vec::new();
        for j in self.joints.joints() {
            if !j.broken && (j.body_a == body_id || j.body_b == body_id) {
                snapped.push(j.id);
                let other = if j.body_a == body_id { j.body_b } else { j.body_a };
                if other != 0 {
                    partners.push(other);
                }
            }
        }
        for &jid in &snapped {
            if let Some(j) = self.joints.get_mut(jid) {
                j.broken = true;
            }
        }
        self.wake_joint_bodies(&snapped);
        for other in partners {
            self.wake_body_id(other);
        }
    }

    /// Checks all active world-cell joint anchors against `self.ground` and wakes any coupled bodies
    /// whose joint snapped. Returns the snapped joint IDs.
    pub fn invalidate_joint_world_anchors(&mut self) -> Vec<u32> {
        if self.joints.active_count() == 0 {
            return Vec::new();
        }
        let mut checked: Vec<([i32; 3], bool)> = Vec::new();
        for j in self.joints.joints() {
            if j.broken {
                continue;
            }
            for anchor in [j.anchor_a, j.anchor_b] {
                if let crate::joints::VoxelAnchorKind::WorldCell(c) = anchor.kind {
                    if !checked.iter().any(|&(p, _)| p == c) {
                        let solid = self.ground.solid(c[0], c[1], c[2]);
                        checked.push((c, solid));
                    }
                }
            }
        }
        if checked.is_empty() || checked.iter().all(|&(_, s)| s) {
            return Vec::new();
        }
        let snapped = self.joints.invalidate_world_cells(|c| {
            checked.iter().find(|&&(p, _)| p == c).is_none_or(|&(_, s)| s)
        });
        self.wake_joint_bodies(&snapped);
        snapped
    }

    fn world_point_to_body_local(&self, body_id: u32, world: [f32; 3]) -> Option<[f32; 3]> {
        if body_id == 0 {
            return Some(world);
        }
        let b = self.list.iter().find(|b| b.id == body_id)?;
        Some(back(b.rot, sub(world, b.pos)))
    }

    fn world_dir_to_body_local(&self, body_id: u32, dir: [f32; 3]) -> Option<[f32; 3]> {
        let u = unit(dir);
        if body_id == 0 {
            return Some(u);
        }
        let b = self.list.iter().find(|b| b.id == body_id)?;
        Some(unit(back(b.rot, u)))
    }

    /// Adds a 1-DOF revolute hinge between `a` and `b` (`0` = static world) at world `pivot` along world `axis`,
    /// optionally anchored to `world_cell` (pass `[i32::MIN; 3]` for a free world anchor). Returns the joint ID or `0`.
    pub fn add_hinge(
        &mut self,
        a: u32,
        b: u32,
        pivot: [f32; 3],
        axis: [f32; 3],
        world_cell: [i32; 3],
    ) -> u32 {
        if a == 0 && b == 0 {
            return 0;
        }
        let Some(local_a) = self.world_point_to_body_local(a, pivot) else { return 0 };
        let Some(local_b) = self.world_point_to_body_local(b, pivot) else { return 0 };
        let Some(axis_a) = self.world_dir_to_body_local(a, axis) else { return 0 };
        let Some(axis_b) = self.world_dir_to_body_local(b, axis) else { return 0 };
        let mut joint = crate::joints::Joint::hinge(
            a,
            b,
            local_a,
            local_b,
            crate::joints::HingeJoint::new(axis_a, axis_b),
        );
        if world_cell != [i32::MIN; 3] {
            if a == 0 {
                joint.anchor_a = crate::joints::VoxelAnchor::world_cell(world_cell);
            } else if b == 0 {
                joint.anchor_b = crate::joints::VoxelAnchor::world_cell(world_cell);
            }
        }
        let id = self.joints.add(joint);
        self.wake_body_id(a);
        self.wake_body_id(b);
        id
    }

    /// Adds a breakable weld between `a` and `b` (`0` = static world) anchored at world points `world_a` and `world_b`,
    /// holding the two as they are turned now. `break_force` / `break_torque` (`<= 0` or not finite: unbreakable);
    /// `yield_torque` makes it plastic (it bends past it and stays bent) and `break_bend` is how far it bends before it
    /// snaps (`<= 0` or not finite: never). Returns the joint ID, or `0` if an endpoint body was not found.
    #[allow(clippy::too_many_arguments)]
    pub fn add_fixed(
        &mut self,
        a: u32,
        b: u32,
        world_a: [f32; 3],
        world_b: [f32; 3],
        break_force: f32,
        break_torque: f32,
        yield_torque: f32,
        break_bend: f32,
    ) -> u32 {
        if a == 0 && b == 0 {
            return 0;
        }
        let rot_of = |id: u32| if id == 0 { Some([0.0, 0.0, 0.0, 1.0]) } else { self.list.iter().find(|x| x.id == id).map(|x| x.rot) };
        let (Some(qa), Some(qb)) = (rot_of(a), rot_of(b)) else { return 0 };
        let Some(local_a) = self.world_point_to_body_local(a, world_a) else { return 0 };
        let Some(local_b) = self.world_point_to_body_local(b, world_b) else { return 0 };
        let limit = |v: f32| if v.is_finite() && v > 0.0 { v } else { f32::INFINITY };
        let rel = crate::joints::quat_mul(crate::joints::quat_conj(qa), qb);
        let cfg = crate::joints::FixedJoint::default().with_rel_rot(rel).plastic(limit(yield_torque), limit(break_bend));
        let joint = crate::joints::Joint::fixed(a, b, local_a, local_b, cfg).with_break(limit(break_force), limit(break_torque));
        let id = self.joints.add(joint);
        self.wake_body_id(a);
        self.wake_body_id(b);
        id
    }

    /// How far weld `id` has bent for good (radians), or `-1` if it is gone, broken, or not a weld.
    pub fn joint_bend(&self, id: u32) -> f32 {
        match self.joints.get(id) {
            Some(j) if !j.broken => match j.kind {
                crate::joints::JointKind::Fixed(cfg) => cfg.yielded_angle,
                _ => -1.0,
            },
            _ => -1.0,
        }
    }

    /// Adds a unilateral rope/cable between `a` and `b` (`0` = static world) anchored at world points
    /// `world_a` and `world_b`, with taut length `max_len` (`<= 0` uses initial separation) and optional
    /// `break_force` (`<= 0` or non-finite = unbreakable). Returns the joint ID or `0`.
    pub fn add_rope(
        &mut self,
        a: u32,
        b: u32,
        world_a: [f32; 3],
        world_b: [f32; 3],
        max_len: f32,
        break_force: f32,
    ) -> u32 {
        if a == 0 && b == 0 {
            return 0;
        }
        let Some(local_a) = self.world_point_to_body_local(a, world_a) else { return 0 };
        let Some(local_b) = self.world_point_to_body_local(b, world_b) else { return 0 };
        let max_dist = if max_len.is_finite() && max_len > 0.0 {
            max_len
        } else {
            let d = sub(world_b, world_a);
            dot(d, d).sqrt().max(0.1)
        };
        let mut joint = crate::joints::Joint::rope(a, b, local_a, local_b, max_dist);
        if break_force.is_finite() && break_force > 0.0 {
            joint = joint.with_break(break_force, f32::INFINITY);
        }
        let id = self.joints.add(joint);
        self.wake_body_id(a);
        self.wake_body_id(b);
        id
    }

    /// Sets the reel speed (cells/s; positive reels in, negative pays out) on a distance/rope joint.
    /// Returns `true` if `joint_id` exists and is a distance/rope joint.
    pub fn set_winch(&mut self, joint_id: u32, speed: f32) -> bool {
        if !speed.is_finite() {
            return false;
        }
        let bodies = match self.joints.get_mut(joint_id) {
            Some(j) if !j.broken => match &mut j.kind {
                crate::joints::JointKind::Distance(d) => {
                    d.winch_speed = speed;
                    (j.body_a, j.body_b)
                }
                _ => return false,
            },
            _ => return false,
        };
        self.wake_body_id(bodies.0);
        self.wake_body_id(bodies.1);
        true
    }

    /// Spawns an upright standing 13-bone active ragdoll at `feet_pos` facing `yaw`. Returns its non-zero ID.
    pub fn ragdoll_spawn(&mut self, feet_pos: [f32; 3], yaw: f32) -> u32 {
        let id = self.next_ragdoll;
        self.next_ragdoll = self.next_ragdoll.wrapping_add(1).max(1);
        let ragdoll = crate::ragdoll::Ragdoll::standing(feet_pos, yaw);
        self.ragdolls.push(ActiveRagdoll { id, ragdoll, detached: Vec::new() });
        id
    }

    /// Applies an impact impulse (`kg * cells/s`) and optional `cut_energy` (`> 0` enables Tier-A severing)
    /// to bone index `bone` of ragdoll `id`. Returns `true` if the hit was applied.
    pub fn ragdoll_hit(&mut self, id: u32, bone: u32, impulse: [f32; 3], cut_energy: f32) -> bool {
        let Some(bone_id) = crate::ragdoll::BoneId::from_index(bone as usize) else { return false };
        let Some(active) = self.ragdolls.iter_mut().find(|r| r.id == id) else { return false };
        let world_pos = active.ragdoll.bones[bone_id.index()].pos;
        let is_edged = cut_energy.is_finite() && cut_energy > 0.0;
        let res = active.ragdoll.apply_hit(bone_id, world_pos, impulse, cut_energy.max(0.0), is_edged);
        if let Some(limb) = res.detached {
            active.detached.push(limb);
        }
        res.applied
    }

    /// Fires a ballistic projectile of `caliber` from `origin` along `dir`. Returns its projectile ID.
    pub fn ballistics_fire(
        &mut self,
        caliber: crate::ballistics::Caliber,
        origin: [f32; 3],
        dir: [f32; 3],
    ) -> u32 {
        self.ballistics.spawn_projectile(caliber, origin, dir)
    }

    /// Spawns an occluded delayed blast shockwave and directional shrapnel against `self.ground`.
    /// Returns the number of active shockwaves in `self.shockwaves`.
    pub fn shockwave_blast(
        &mut self,
        center: [f32; 3],
        radius: f32,
        pressure: f32,
        shrapnel: u32,
    ) -> usize {
        let (shockwaves, ground) = (&mut self.shockwaves, &mut self.ground);
        shockwaves.spawn_blast(center, radius, pressure, shrapnel, |[x, y, z]| ground.kind(x, y, z));
        self.shockwaves.active_waves()
    }

    /// Fires a continuous multi-bounce thermal beam from `origin` along `dir` with thermal `power` for `dt` seconds.
    /// Applies voxel ignition (`Fire`), voxel melting (`EDIT`/`DUST`), and dynamic-body/ragdoll thermal burns.
    /// Returns the number of traced beam segments.
    pub fn beams_fire(
        &mut self,
        origin: [f32; 3],
        dir: [f32; 3],
        power: f32,
        dt: f32,
    ) -> u32 {
        let spec = crate::beams::BeamSpec {
            origin,
            dir,
            power,
            max_range: 512.0,
            max_bounces: crate::beams::MAX_BOUNCES,
            color: 0xFF3322,
        };
        let mut targets: Vec<crate::beams::BeamTarget> =
            Vec::with_capacity(self.list.len() + self.ragdolls.len() * crate::ragdoll::BONE_COUNT);
        for b in &self.list {
            if b.live.as_ref().is_some_and(|l| l.ghost) || b.count == 0 {
                continue;
            }
            let half = [b.size[0] as f32 * 0.5, b.size[1] as f32 * 0.5, b.size[2] as f32 * 0.5];
            let local_mid = [half[0] - b.com[0], half[1] - b.com[1], half[2] - b.com[2]];
            let center = add(b.pos, turn(b.rot, local_mid));
            let rep_kind = b
                .cells
                .iter()
                .copied()
                .find(|&k| k & crate::kinds::POLISHED != 0)
                .unwrap_or_else(|| crate::kinds::kind(b.stuff, crate::kinds::OWN));
            targets.push(crate::beams::BeamTarget::obb(b.id, center, half, b.rot, rep_kind));
        }
        for r in &self.ragdolls {
            for bone in crate::ragdoll::BoneId::ALL {
                if r.ragdoll.is_missing(bone) {
                    continue;
                }
                let bs = &r.ragdoll.bones[bone.index()];
                let (a, b_end) = bs.capsule_endpoints();
                targets.push(crate::beams::BeamTarget::capsule(
                    encode_ragdoll_target(r.id, bone),
                    a,
                    b_end,
                    bs.radius,
                ));
            }
        }
        let result = {
            let (beams, ground) = (&mut self.beams, &mut self.ground);
            beams.fire_step(&spec, dt, |[x, y, z]| ground.kind(x, y, z), &targets)
        };
        let mut ignite_cells: Vec<[i32; 3]> = Vec::new();
        let mut melted_runs: Vec<Run> = Vec::new();
        let mut dyn_burns: Vec<(u32, [f32; 3], f32, f32)> = Vec::new();
        for ev in &result.events {
            match *ev {
                crate::beams::BeamEvent::IgniteVoxel { cell } => {
                    ignite_cells.push(cell);
                }
                crate::beams::BeamEvent::MeltedVoxel { cell, kind } => {
                    melted_runs.push(Run { x0: cell[0], x1: cell[0] + 1, y: cell[1], z: cell[2], kind: 0 });
                    self.record(
                        DUST,
                        &[
                            (cell[0] as f32 + 0.5).to_bits(),
                            (cell[1] as f32 + 0.5).to_bits(),
                            (cell[2] as f32 + 0.5).to_bits(),
                            kind as u32,
                            2,
                        ],
                    );
                }
                crate::beams::BeamEvent::DynamicBurn { body_id, pos, energy_delta, sever_power, .. } => {
                    dyn_burns.push((body_id, pos, energy_delta, sever_power));
                }
                crate::beams::BeamEvent::MirrorBounce { .. } => {}
            }
        }
        if !melted_runs.is_empty() {
            self.change(melted_runs);
        }
        if !ignite_cells.is_empty() {
            self.ignite_ground_cells(&ignite_cells);
        }
        for (body_id, pos, energy_delta, sever_power) in dyn_burns {
            if let Some((rid, bone)) = decode_ragdoll_target(body_id) {
                if let Some(active) = self.ragdolls.iter_mut().find(|r| r.id == rid) {
                    let cut = sever_power * dt.max(0.0);
                    let hit = active.ragdoll.apply_hit(bone, pos, [0.0; 3], cut, true);
                    if let Some(limb) = hit.detached {
                        active.detached.push(limb);
                    }
                }
            } else if let Some(idx) = self.list.iter().position(|b| b.id == body_id) {
                let (cell, cell_kind, stuff) = {
                    let b = &self.list[idx];
                    let (c, _) = b.cell_at(pos);
                    let k = if b.solid(c) {
                        b.cells[b.at(c[0] as usize, c[1] as usize, c[2] as usize)]
                    } else {
                        0
                    };
                    (c, k, b.stuff)
                };
                if cell_kind != 0 && burns(material(cell_kind)).0 != 0 && energy_delta > 0.0 {
                    self.fire.ignite_body(body_id, [cell[0] as usize, cell[1] as usize, cell[2] as usize], cell_kind);
                }
                if energy_delta >= crate::beams::melt_threshold(stuff) {
                    self.carve_sphere(body_id, pos, 0.75);
                }
            }
        }
        let segs = result.segments.len() as u32;
        self.last_beam = result;
        segs
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
        let emptied = runs.iter().any(|r| r.kind == 0);
        self.record(EDIT, &words);
        self.wake_in_aabb(lo.map(|v| v as f32 - 2.0), hi.map(|v| v as f32 + 2.0));
        self.stir(lo, hi);
        self.ground.push(Edit::Runs(runs), true, None);
        if emptied && self.joints.active_count() > 0 {
            self.invalidate_joint_world_anchors();
        }
    }

    fn emit_born(&mut self, id: u32, count: usize, size: [usize; 3], com: V, born: [i32; 3], faces: Vec<u32>) {
        let mut words = Vec::with_capacity(11 + faces.len());
        words.extend_from_slice(&[id, count as u32, size[0] as u32, size[1] as u32, size[2] as u32]);
        words.extend(com.iter().map(|v| v.to_bits()));
        words.extend(born.iter().map(|&v| v as u32));
        words.extend(faces);
        self.record(BORN, &words);
    }

    fn born(&mut self, body: &Body) {
        let faces = support::faces_of(&body.cells, body.size);
        self.emit_born(body.id, body.count, body.size, body.com, body.born, faces);
    }

    /// Carves a world-space sphere out of a moving body, updating or splitting it in place.
    /// Returns the number of cells removed.
    pub fn carve_sphere(&mut self, body_id: u32, center: [f32; 3], radius: f32) -> usize {
        self.carve_body(body_id, |b, next| carve::carve_sphere(b, center, radius, next))
    }

    /// Carves a world-space sphere out of a moving body with material-resistance options.
    pub fn carve_sphere_with(&mut self, body_id: u32, center: [f32; 3], radius: f32, opts: carve::CarveOptions) -> usize {
        self.carve_body(body_id, |b, next| carve::carve_sphere_with(b, center, radius, opts, next))
    }

    /// Carves a world-space capsule (swept blade or bullet tunnel) out of a moving body.
    /// Returns the number of cells removed.
    pub fn carve_capsule(&mut self, body_id: u32, a: [f32; 3], b: [f32; 3], radius: f32) -> usize {
        self.carve_body(body_id, |body, next| carve::carve_capsule(body, a, b, radius, next))
    }

    /// Slices a moving body along a world-space plane of given kerf thickness.
    /// Returns the number of cells removed.
    pub fn carve_plane(&mut self, body_id: u32, point: [f32; 3], normal: [f32; 3], thickness: f32) -> usize {
        self.carve_body(body_id, |body, next| carve::carve_plane(body, point, normal, thickness, next))
    }

    fn carve_body(&mut self, body_id: u32, f: impl FnOnce(&mut Body, &mut u32) -> carve::CarveReport) -> usize {
        let Some(idx) = self.list.iter().position(|b| b.id == body_id) else {
            return 0;
        };
        let (old_pos, old_rot, old_com, old_radius, old_born) = {
            let b = &self.list[idx];
            (b.pos, b.rot, b.com, b.radius, b.born)
        };
        let mut next = self.next;
        let report = f(&mut self.list[idx], &mut next);
        self.next = next;
        if report.removed == 0 {
            return 0;
        }
        let n = report.removed_cells.len();
        let chunks = (n / 16).clamp(1, 8);
        let step = n.div_ceil(chunks);
        for chunk in report.removed_cells.chunks(step) {
            let mut sum = [0.0f32; 3];
            for &(c, _) in chunk {
                let local = [c[0] as f32 + 0.5, c[1] as f32 + 0.5, c[2] as f32 + 0.5];
                let world = add(old_pos, turn(old_rot, sub(local, old_com)));
                sum = add(sum, world);
            }
            let p = scale(sum, 1.0 / chunk.len() as f32);
            let kind = chunk[0].1;
            self.record(DUST, &[p[0].to_bits(), p[1].to_bits(), p[2].to_bits(), kind as u32, chunk.len() as u32]);
        }
        let reach = old_radius.ceil() as i32 + 2;
        let center = old_pos.map(|v| v.round() as i32);
        self.stir(center.map(|c| c - reach), center.map(|c| c + reach));

        if report.destroyed {
            let body = self.list.swap_remove(idx);
            self.detach_removed_body(body.id);
            let mut words = vec![body.id];
            words.extend(body.pos.iter().chain(body.rot.iter()).map(|v| v.to_bits()));
            self.record(GONE, &words);
            return report.removed;
        }

        self.list[idx].asleep = false;
        self.list[idx].still = 0.0;
        carve::sync_hull_after_carve(&mut self.list[idx]);
        if self.joints.active_count() > 0 {
            let (new_born, new_com) = (self.list[idx].born, self.list[idx].com);
            let born_delta = [new_born[0] - old_born[0], new_born[1] - old_born[1], new_born[2] - old_born[2]];
            let com_shift = [
                born_delta[0] as f32 + new_com[0] - old_com[0],
                born_delta[1] as f32 + new_com[1] - old_com[1],
                born_delta[2] as f32 + new_com[2] - old_com[2],
            ];
            let body_ref = &self.list[idx];
            let snapped = self.joints.invalidate_body_cells(body_id, |c| {
                let shifted = [
                    c[0] as i32 - born_delta[0],
                    c[1] as i32 - born_delta[1],
                    c[2] as i32 - born_delta[2],
                ];
                body_ref.solid(shifted)
            });
            // Keep surviving joints anchored to the same physical voxels after tight cropping.
            if born_delta != [0, 0, 0] || dot(com_shift, com_shift) > 1e-10 {
                let mut active_ids: Vec<u32> = Vec::new();
                for j in self.joints.joints() {
                    if !j.broken && (j.body_a == body_id || j.body_b == body_id) {
                        active_ids.push(j.id);
                    }
                }
                for jid in active_ids {
                    if let Some(j) = self.joints.get_mut(jid) {
                        if j.body_a == body_id {
                            j.local_a = sub(j.local_a, com_shift);
                            if let crate::joints::VoxelAnchorKind::BodyCell { body_id: bid, cell } = j.anchor_a.kind {
                                if bid == body_id {
                                    j.anchor_a = crate::joints::VoxelAnchor::body_cell(
                                        bid,
                                        [
                                            (cell[0] as i32 - born_delta[0]).max(0) as usize,
                                            (cell[1] as i32 - born_delta[1]).max(0) as usize,
                                            (cell[2] as i32 - born_delta[2]).max(0) as usize,
                                        ],
                                    );
                                }
                            }
                        }
                        if j.body_b == body_id {
                            j.local_b = sub(j.local_b, com_shift);
                            if let crate::joints::VoxelAnchorKind::BodyCell { body_id: bid, cell } = j.anchor_b.kind {
                                if bid == body_id {
                                    j.anchor_b = crate::joints::VoxelAnchor::body_cell(
                                        bid,
                                        [
                                            (cell[0] as i32 - born_delta[0]).max(0) as usize,
                                            (cell[1] as i32 - born_delta[1]).max(0) as usize,
                                            (cell[2] as i32 - born_delta[2]).max(0) as usize,
                                        ],
                                    );
                                }
                            }
                        }
                    }
                }
            }
            self.wake_joint_bodies(&snapped);
        }
        self.record(BROKE, &[body_id]);
        let (id, count, size, com, born, faces) = {
            let b = &self.list[idx];
            (b.id, b.count, b.size, b.com, b.born, carve::rebuild_faces(b))
        };
        self.emit_born(id, count, size, com, born, faces);
        for mut island in report.split_bodies {
            island.asleep = false;
            island.still = 0.0;
            let faces = carve::rebuild_faces(&island);
            self.emit_born(island.id, island.count, island.size, island.com, island.born, faces);
            self.list.push(island);
        }
        report.removed
    }

    /// What is no longer held round a point comes loose and is a body. `radius` is how big the blast there was:
    /// what it loosened is thrown from it, small pieces harder than big. Returns how many bodies were made.
    pub fn release(&mut self, at: [i32; 3], radius: i32) -> usize {
        self.release_in(at, radius, SETTLE[0])
    }

    /// The same, asked of a box `side` cells across (22 m tall, most of it above the point): a small change needs
    /// only a narrow box, which is quick.
    pub fn release_in(&mut self, at: [i32; 3], radius: i32, side: usize) -> usize {
        self.release_box(at, radius, [side, SETTLE[1], side], usize::MAX)
    }

    /// As `release`, asked in a box of a given size round the place. A thing that reaches the box's top is left alone,
    /// so a blast asks in one as tall as ever, however narrow. A landing's dent asks in a small one: it is asked eight
    /// times a second while a house comes down, and the asking is most of what the solver then does.
    fn release_box(&mut self, at: [i32; 3], radius: i32, size: [usize; 3], max_bodies: usize) -> usize {
        self.release_box_below(at, radius, size, 48.min(size[1] as i32 / 2), max_bodies)
    }

    /// Like `release_box`, with an explicit downward margin (`below` cells under `at[1]`) so street-level vehicle
    /// impacts bias their scan window upward to catch tall severed tree trunks and canopies without leaving them floating.
    fn release_box_below(&mut self, at: [i32; 3], radius: i32, size: [usize; 3], below: i32, max_bodies: usize) -> usize {
        let side = size[0];
        let low = [at[0] - side as i32 / 2, at[1] - below.min(size[1] as i32 / 2), at[2] - side as i32 / 2];
        let hi = [low[0] + size[0] as i32, low[1] + size[1] as i32, low[2] + size[2] as i32];
        self.wake_in_aabb(low.map(|v| v as f32 - 2.0), hi.map(|v| v as f32 + 2.0));
        #[cfg(test)]
        let t0 = std::time::Instant::now();
        let mut region = self.ground.region(low, size);
        #[cfg(test)]
        let t1 = std::time::Instant::now();
        let (pieces, dust) = support::release(&mut region, Some((at, radius)));
        #[cfg(test)]
        if std::env::var("TIMES").is_ok() { eprintln!("    release in {size:?}: gathered in {:.0} ms, asked in {:.0} ms, {} pieces", (t1 - t0).as_secs_f32() * 1e3, t1.elapsed().as_secs_f32() * 1e3, pieces.len()) }
        self.take(pieces, dust, Some((at, radius)), max_bodies)
    }

    /// Pieces that have come loose leave the world and are bodies; crumbs of them are dust. A blast throws them.
    fn take(&mut self, pieces: Vec<support::Loose>, dust: Vec<Run>, thrown: Option<([i32; 3], i32)>, max_bodies: usize) -> usize {
        let mut taken: Vec<Run> = Vec::new();
        for r in dust.iter().chain(pieces.iter().flat_map(|p| p.runs.iter())) {
            taken.push(Run { kind: 0, ..*r });
        }
        for r in &dust {
            let words = [(r.x0 as f32 + 0.5).to_bits(), (r.y as f32 + 0.5).to_bits(), (r.z as f32 + 0.5).to_bits(), r.kind as u32, (r.x1 - r.x0) as u32];
            self.record(DUST, &words);
        }
        self.change(taken);
        // What nothing threw (a fire ate what held it, a wide box let it go) and is small comes down as rubble at
        // once, and is told as dust. As bodies, a burning street's crumbs were 500 new ones a second for as long as it
        // burnt (asked once a second, where the fire last ate), and the solver never caught up.
        let quiet = thrown.is_none_or(|(_, radius)| radius == 0);
        let (crumbs, pieces): (Vec<support::Loose>, Vec<support::Loose>) = pieces.into_iter().partition(|p| quiet && p.cells < SMALL);
        if !crumbs.is_empty() {
            let mut loose: Vec<([i32; 3], Kind)> = Vec::new();
            for p in &crumbs {
                let words = [((p.low[0] + p.high[0]) as f32 * 0.5).to_bits(), ((p.low[1] + p.high[1]) as f32 * 0.5).to_bits(), ((p.low[2] + p.high[2]) as f32 * 0.5).to_bits(), p.runs[0].kind as u32, p.cells as u32];
                self.record(DUST, &words);
                loose.extend(p.runs.iter().flat_map(|r| (r.x0..r.x1).map(move |x| ([x, r.y, r.z], r.kind))));
            }
            loose.sort_unstable_by_key(|&(c, _)| (c[1], c[2], c[0]));
            self.heap(&loose);
        }
        let mut made = 0;
        let mut debris = self.list.iter().filter(|b| b.live.is_none()).count();
        for p in pieces {
            if made >= max_bodies || (p.cells < SMALL && debris >= DEBRIS) {
                self.record(DUST, &[(p.low[0] as f32).to_bits(), (p.low[1] as f32).to_bits(), (p.low[2] as f32).to_bits(), p.runs[0].kind as u32, p.cells as u32]);
                continue;
            }
            made += 1;
            debris += 1;
            let size = [(p.high[0] - p.low[0]) as usize, (p.high[1] - p.low[1]) as usize, (p.high[2] - p.low[2]) as usize];
            let mut body = Body::new(self.next, support::grid_of(&p.runs, p.low, size), size, p.low);
            self.next += 1;
            if max_bodies != usize::MAX {
                body.limit_points(LUMP_POINTS);
                body.lump = true;
                body.passing = body.count < 40;
            }
            if self.persist_debris {
                body.persist_sleep = body.qualifies_for_persist_sleep();
            }
            if let Some((at, radius)) = thrown {
                self.throw(&mut body, at, radius);
            }
            self.born(&body);
            self.list.push(body);
            self.broadphase_stale = true;
        }
        made
    }

    /// Has a wide box round a place asked about in a moment (`far`). Boxes are whole sectors, so charges set near
    /// one another ask about the same box, and one that is waiting waits again from now.
    fn ask_far(&mut self, at: [i32; 3], radius: i32) {
        let s = SIDE as i32;
        let low = [(at[0] - WIDE[0] as i32 / 2 + s / 2).div_euclid(s) * s, (at[1] - s).div_euclid(s) * s, (at[2] - WIDE[2] as i32 / 2 + s / 2).div_euclid(s) * s];
        if self.scars.len() >= 48 {
            self.scars.remove(0);
        }
        self.scars.push((at, radius));
        match self.far.iter_mut().find(|f| f.low == low) {
            Some(waiting) => *waiting = Far { low, wait: FAR_AFTER, found: None },
            None => self.far.push(Far { low, wait: FAR_AFTER, found: None }),
        }
    }

    /// What a narrow box could not say: a thing wider than the box round a blast stands on that box's sides, which
    /// are taken for ground, however little is left under it. So a moment after a charge a box twice as wide is asked
    /// about in blocks of four cells (support.rs `far_loose`), and what is loose there, of what a charge reached,
    /// comes out as bodies. The work is spread over the solver's calls, at most `most` sectors made in each: a wide
    /// box is a hundred sectors, and made in one call they held everything in the air still for a third of a second.
    /// Returns how many bodies were made.
    fn far(&mut self, mut most: usize) -> usize {
        let Some(k) = self.far.iter().position(|f| f.wait <= 0.0) else { return 0 };
        let low = self.far[k].low;
        #[cfg(test)]
        let t0 = std::time::Instant::now();
        if self.far[k].found.is_none() {
            let (made, all) = self.ground.ready(low, WIDE, most);
                if !all {
                return 0;
            }
            most -= made;
            let blocks = self.ground.blocks(low, WIDE);
            let loose = support::far_loose(&blocks, &self.scars);
            let Some((lo, hi)) = support::far_box(&blocks, &loose) else {
                self.far.remove(k);
                return 0;
            };
            let s = SIDE as i32;
            let mut keys = Vec::new();
            for sy in lo[1].div_euclid(s)..=(hi[1] - 1).div_euclid(s) {
                for sz in lo[2].div_euclid(s)..=(hi[2] - 1).div_euclid(s) {
                    for sx in lo[0].div_euclid(s)..=(hi[0] - 1).div_euclid(s) {
                        keys.push([sx, sy, sz]);
                    }
                }
            }
            let part = Region::new(lo, [(hi[0] - lo[0]) as usize, (hi[1] - lo[1]) as usize, (hi[2] - lo[2]) as usize]);
            #[cfg(test)]
            if std::env::var("TIMES").is_ok() { eprintln!("    far at {low:?}: asked in {:.0} ms ({made} sectors made); loose from {lo:?} to {hi:?}, {} sectors to gather", t0.elapsed().as_secs_f32() * 1e3, keys.len()) }
            self.far[k].found = Some(Found { blocks, loose, part, keys, next: 0 });
        }
        let found = self.far[k].found.as_mut().unwrap();
        while found.next < found.keys.len() {
            if most == 0 {
                return 0;
            }
            let key = found.keys[found.next];
            self.ground.fill(key);
            found.part.take(&self.ground.scratch, key[0], key[1], key[2]);
            found.next += 1;
            most -= 1;
        }
        let Far { found: Some(mut found), .. } = self.far.remove(k) else { unreachable!() };
        // The gathering took several calls: a cell that has left the world since (another charge, a landing) is not taken twice.
        let ground = &mut self.ground;
        let (pieces, dust) = support::release_far(&mut found.part, &found.blocks, &found.loose, |c| ground.solid(c[0], c[1], c[2]));
        // What stands in one piece across several houses is not one stiff thing.
        #[cfg(test)]
        let t1 = std::time::Instant::now();
        let whole = pieces.len();
        let pieces: Vec<support::Loose> = pieces.into_iter().flat_map(parts).collect();
        #[cfg(test)]
        let t2 = std::time::Instant::now();
        let (n, cells, biggest) = (pieces.len(), pieces.iter().map(|p| p.cells).sum::<usize>(), pieces.iter().map(|p| p.cells).max().unwrap_or(0));
        let made = self.take(pieces, dust, None, usize::MAX);
        #[cfg(test)]
        if std::env::var("TIMES").is_ok() { eprintln!("    far at {low:?}: last gather and pieces {:.0} ms, parts {:.0} ms, bodies {:.0} ms; {whole} pieces as {n} bodies of {cells} cells, the biggest {biggest}", (t1 - t0).as_secs_f32() * 1e3, (t2 - t1).as_secs_f32() * 1e3, t2.elapsed().as_secs_f32() * 1e3) }
        let _ = (whole, n, cells, biggest);
        made
    }

    /// A blast at a point. What it empties does not all vanish: away from its middle the stuff comes out in lumps,
    /// which are bodies thrown from it (glass, and the middle, are dust). Then what it left unheld comes loose.
    /// `after` is how many of the solver's own edits the blast's maker had heard of; `spark` is whether it sets things
    /// alight. Returns how many bodies were made.
    pub fn blast(&mut self, at: [i32; 3], radius: i32, after: Option<usize>, spark: bool) -> usize {
        let far = radius * 3 + 2;
        let (low, size) = (at.map(|c| c - far), [(2 * far + 1) as usize; 3]);
        #[cfg(test)]
        let t0 = std::time::Instant::now();
        // The blast of someone who had not heard of all the solver's edits goes in among them, and the box is
        // gathered twice; one that goes in last (as nearly all do) is worked out on each sector as it is made.
        let (before, left) = if after.is_none_or(|k| k >= self.ground.own()) {
            self.ground.blasted(at, radius, low, size, true)
        } else {
            let before = self.ground.region(low, size);
            self.ground.push(Edit::Ball { centre: at, radius, kind: 0 }, false, after);
            (before, self.ground.region(low, size))
        };
        #[cfg(test)]
        let t1 = std::time::Instant::now();
        #[cfg(test)]
        let t2 = std::time::Instant::now();
        self.caught(&before, at, radius);
        self.invalidate_joint_world_anchors();
        self.wake_in_aabb(at.map(|c| (c - far) as f32), at.map(|c| (c + far + 1) as f32));
        self.shove(at, radius);
        let made = self.lumps(&before, &left, at, radius, usize::MAX);
        #[cfg(test)]
        if std::env::var("TIMES").is_ok() { eprintln!("    blast of {radius}: before {:.0} ms, push and left {:.0} ms, lumps {:.0} ms", (t1 - t0).as_secs_f32() * 1e3, (t2 - t1).as_secs_f32() * 1e3, t2.elapsed().as_secs_f32() * 1e3) }
        // What can burn round the blast, and is still there, may catch: about one cell in twelve.
        if spark {
            self.ignite(at, radius + radius / 2, true);
        }
        // A hammer blow is asked about in a small box, a charge in the whole one, and then in a wider one.
        if radius >= FAR_FROM {
            self.ask_far(at, radius);
        }
        made + self.release_in(at, radius, ((radius.max(4) * 8 + 32) as usize).min(SETTLE[0]))
    }

    /// What a blast emptied (the cells solid in `before` and not in `left`): all but its middle as bodies thrown from
    /// it, lumps a few cells across whose edges wander; and its inner part, and what there can be no body for, as
    /// rubble that falls where it was (`heap`). Glass is dust. Returns how many bodies were made.
    fn lumps(&mut self, before: &Region, left: &Region, at: [i32; 3], radius: i32, max_lumps: usize) -> usize {
        let (low, size) = (before.low, before.size);
        let mut lumps: Map<[i32; 3], Vec<([i32; 3], Kind)>> = Map::default();
        let mut loose: Vec<([i32; 3], Kind)> = Vec::new();
        let wander = |a: i32, b: i32, seed: u32| (hash3(a >> 2, b >> 2, seed as i32, 11) & 3) as i32;
        // Bigger lumps from a bigger blast: it empties more than there can be bodies for at the size a charge's are,
        // and what had no body was nothing.
        let (wide, tall) = ((radius / 3).clamp(5, 14), (radius / 4).clamp(4, 11));
        for y in 0..size[1] {
            for z in 0..size[2] {
                for x in 0..size[0] {
                    let i = before.at(x, y, z);
                    let kind = before.cells[i];
                    // Glass is dust, and what goes up when hit is gone in its own blast.
                    if kind == 0 || left.cells[i] != 0 || material(kind) == GLASS || charged(kind) {
                        continue;
                    }
                    let c = [low[0] + x as i32, low[1] + y as i32, low[2] + z as i32];
                    let d = sub([c[0] as f32, c[1] as f32, c[2] as f32], [at[0] as f32, at[1] as f32, at[2] as f32]);
                    // The inner part of what a blast empties is ground small and falls where it was, as rubble. All but
                    // the very middle of it is thrown as lumps too: stuff broken small takes up about half as much room
                    // again as the wall it was, and a blast that threw less looked like a hole and specks.
                    if dot(d, d) < (radius * radius) as f32 * 0.45 {
                        loose.push((c, kind));
                    }
                    if dot(d, d) < (radius * radius) as f32 * 0.16 {
                        continue;
                    }
                    let key = [(c[0] + wander(c[1], c[2], 1)).div_euclid(wide), (c[1] + wander(c[0], c[2], 2)).div_euclid(tall), (c[2] + wander(c[0], c[1], 3)).div_euclid(wide)];
                    lumps.entry(key).or_default().push((c, kind));
                }
            }
        }
        let mut keys: Vec<[i32; 3]> = lumps.keys().copied().collect();
        keys.sort_unstable();
        let mut made = 0;
        let mut debris = self.list.iter().filter(|b| b.live.is_none()).count();
        for key in keys {
            let cells = &lumps[&key];
            // What is too small to be a body, or one more than there can be, falls as rubble too.
            if made >= max_lumps || (cells.len() < SMALL && debris >= DEBRIS) {
                let (p, kind) = cells[0];
                self.record(DUST, &[(p[0] as f32).to_bits(), (p[1] as f32).to_bits(), (p[2] as f32).to_bits(), kind as u32, cells.len() as u32]);
                continue;
            }
            if cells.len() < 3 || self.list.len() >= MOST {
                loose.extend(cells.iter().copied());
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
            body.lump = true;
            // A lump meets only the world, and lies where it lands: a few points do. With all a body's size allows
            // (112 for a lump of a hundred cells) 1,700 bodies were tried at 150,000 points a call, and in the page
            // the solver ran four times behind.
            body.limit_points(LUMP_POINTS);
            body.passing = max_lumps != usize::MAX && body.count < 40;
            self.throw(&mut body, at, radius);
            self.born(&body);
            self.list.push(body);
            made += 1;
            debris += 1;
        }
        loose.sort_unstable_by_key(|&(c, _)| (c[1], c[2], c[0]));
        if max_lumps == usize::MAX {
            self.heap(&loose);
        } else if !loose.is_empty() {
            // Crash crumbs cost no solver bodies or subsequent world/GPU sector rebuilds.
            self.record(DUST, &[(at[0] as f32).to_bits(), (at[1] as f32).to_bits(), (at[2] as f32).to_bits(), loose[0].1 as u32, loose.len() as u32]);
        }
        made
    }

    /// A body that lands hard breaks what it lands on: where it struck, the world is emptied as by a small blast (as
    /// far as each material gives), what was there comes out as lumps, and what that leaves unheld comes loose.
    /// `push` is how hard it struck: its weight times the speed it lost.
    fn crush(&mut self, at: [i32; 3], push: f32, fragments: bool) {
        let radius = ((push / 500.0).cbrt() as i32).clamp(2, 6);
        let far = radius * 3 + 4;
        self.wake_in_aabb(at.map(|c| (c - far) as f32), at.map(|c| (c + far + 1) as f32));
        let hit_mat = material(self.ground.kind(at[0], at[1], at[2]));
        // Detect street/park trees (leaves at impact or canopy above a struck wood trunk) so a severed trunk
        // uses a tall upward-biased support box and does not leave its crown hovering in mid-air, without
        // widening masonry/house collapse crushes.
        let is_tree = hit_mat == LEAVES || (hit_mat == WOOD && {
            let mut has_canopy = false;
            let mut y = at[1] + 6;
            while y <= at[1] + 120 {
                if material(self.ground.kind(at[0], y, at[2])) == LEAVES
                    || material(self.ground.kind(at[0] + 6, y, at[2])) == LEAVES
                    || material(self.ground.kind(at[0] - 6, y, at[2])) == LEAVES
                    || material(self.ground.kind(at[0], y, at[2] + 6)) == LEAVES
                    || material(self.ground.kind(at[0], y, at[2] - 6)) == LEAVES
                {
                    has_canopy = true;
                    break;
                }
                y += 6;
            }
            has_canopy
        });
        // Falling intact structures still need the wider support query and solid rubble to topple correctly.
        // Vehicles and already loose fragments use a bounded, cheap impact path; for trees reserve at least 1
        // body slot for the newly severed upper trunk + canopy so burst() cannot starve release_box.
        let budget = if fragments { CRASH_LUMPS } else { usize::MAX };
        let burst_budget = if fragments && is_tree { budget.saturating_sub(1) } else { budget };
        let before = self.next;
        if self.burst(at, radius, burst_budget) {
            let size = if is_tree {
                [64, 160, 64]
            } else {
                match radius { 0..=3 if fragments => [20, 32, 20], 4..=5 if fragments => [28, 48, 28], _ => [48, 96, 48] }
            };
            let below = if is_tree { 14 } else { 48.min(size[1] as i32 / 2) };
            let remaining = if fragments { budget.saturating_sub((self.next - before) as usize) } else { budget };
            self.release_box_below(at, radius, size, below, remaining);
            if is_tree {
                self.ask_far(at, radius.max(4));
            }
        }
    }

    /// A blast of the solver's own making. It does not go into the world as a blast: what it empties goes in as rows
    /// of the solver's own, which is how the page hears of it, and comes out as lumps and rubble. Whether it emptied
    /// anything.
    fn burst(&mut self, at: [i32; 3], radius: i32, max_lumps: usize) -> bool {
        let far = radius * 3 + 2;
        let (low, size) = (at.map(|c| c - far), [(2 * far + 1) as usize; 3]);
        let (before, left) = self.ground.blasted(at, radius, low, size, false);
        let mut gone: Vec<Run> = Vec::new();
        for y in 0..size[1] {
            for z in 0..size[2] {
                for x in 0..size[0] {
                    let i = before.at(x, y, z);
                    if before.cells[i] != 0 && left.cells[i] == 0 {
                        let (wx, wy, wz) = (low[0] + x as i32, low[1] + y as i32, low[2] + z as i32);
                        match gone.last_mut() {
                            Some(r) if r.y == wy && r.z == wz && r.x1 == wx => r.x1 += 1,
                            _ => gone.push(Run { x0: wx, x1: wx + 1, y: wy, z: wz, kind: 0 }),
                        }
                    }
                }
            }
        }
        if gone.is_empty() {
            return false;
        }
        self.change(gone);
        self.caught(&before, at, radius);
        self.lumps(&before, &left, at, radius, max_lumps);
        true
    }

    /// What a blast caught that goes up when hit (kinds.rs `CHARGED`): every such cell within the blast's radius,
    /// whether or not the blast emptied it (steel barely gives).
    fn caught(&mut self, before: &Region, at: [i32; 3], radius: i32) {
        let mut seeds: Vec<[i32; 3]> = Vec::new();
        for (i, _) in before.cells.iter().enumerate().filter(|(_, k)| charged(**k)) {
            let (x, y, z) = before.place(i);
            let c = [before.low[0] + x as i32, before.low[1] + y as i32, before.low[2] + z as i32];
            if (0..3).map(|a| (c[a] - at[a]).pow(2)).sum::<i32>() <= radius * radius {
                seeds.push(c);
            }
        }
        self.go_up(&seeds);
    }

    /// Things that go up when hit, hit at these cells. Each thing (cells of the kind that touch, the world over) is
    /// gone from the world at once, and a blast of its own, bigger the more of it there was, goes off where its
    /// middle was a moment later: so a row of them goes off one after another, each caught by the last.
    fn go_up(&mut self, seeds: &[[i32; 3]]) {
        let mut seen: std::collections::HashSet<[i32; 3], BuildHasherDefault<Mix>> = Default::default();
        for &seed in seeds {
            if seen.contains(&seed) || !charged(self.ground.kind(seed[0], seed[1], seed[2])) {
                continue;
            }
            let (mut cells, mut stack) = (Vec::new(), vec![seed]);
            seen.insert(seed);
            while let Some(c) = stack.pop() {
                cells.push(c);
                if cells.len() >= 20_000 {
                    break;
                }
                for d in [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] {
                    let n = [c[0] + d[0], c[1] + d[1], c[2] + d[2]];
                    if !seen.contains(&n) && charged(self.ground.kind(n[0], n[1], n[2])) {
                        seen.insert(n);
                        stack.push(n);
                    }
                }
            }
            let n = cells.len() as i64;
            let middle = [0, 1, 2].map(|a| (cells.iter().map(|c| c[a] as i64).sum::<i64>() / n) as i32);
            cells.sort_unstable_by_key(|c| (c[1], c[2], c[0]));
            self.change(cells.iter().map(|c| Run { x0: c[0], x1: c[0] + 1, y: c[1], z: c[2], kind: 0 }).collect());
            // A drum 80 cm across empties 2.5 m round it; a tank as far as the biggest charge there is.
            let radius = (((n as f32).cbrt() * 4.0) as i32).clamp(10, 40);
            let wait = 0.2 + (hash3(middle[0], middle[1], middle[2], 53) % 100) as f32 * 0.002;
            self.fuses.push((middle, radius, wait));
        }
    }

    /// A fuse that has run out: the blast goes off. It sets alight what burns, is told (`BURST`) for its fire and
    /// smoke, and what it leaves unheld comes loose as after any charge.
    fn went_off(&mut self, at: [i32; 3], radius: i32) {
        self.record(BURST, &[(at[0] as f32).to_bits(), (at[1] as f32).to_bits(), (at[2] as f32).to_bits(), radius as u32]);
        self.burst(at, radius, usize::MAX);
        self.ignite(at, radius + radius / 2, true);
        if radius >= FAR_FROM {
            self.ask_far(at, radius);
        }
        self.release_in(at, radius, ((radius.max(4) * 8 + 32) as usize).min(SETTLE[0]));
    }

    /// A ball of one kind, `radius` cells across its half, sent from a place at a speed: a cannon's shot. What it
    /// strikes hard enough breaks (`crush`), and so may it.
    pub fn throw_ball(&mut self, from: V, speed: V, radius: i32, kind: Kind) {
        let side = (2 * radius + 1) as usize;
        let mut grid = vec![0 as Kind; side * side * side];
        for y in -radius..=radius {
            for z in -radius..=radius {
                for x in -radius..=radius {
                    if x * x + y * y + z * z <= radius * radius {
                        grid[(x + radius) as usize + side * ((z + radius) as usize + side * (y + radius) as usize)] = kind;
                    }
                }
            }
        }
        let low = [from[0].round() as i32 - radius, from[1].round() as i32 - radius, from[2].round() as i32 - radius];
        let mut body = Body::new(self.next, grid, [side; 3], low);
        self.next += 1;
        body.vel = speed;
        self.born(&body);
        self.list.push(body);
    }

    /// A blast's push on a body: stronger near, and on small things, with a little spin.
    fn throw(&self, body: &mut Body, at: [i32; 3], radius: i32) {
        let away = sub(body.pos, [at[0] as f32, at[1] as f32, at[2] as f32]);
        let far = dot(away, away).sqrt();
        let r = radius as f32;
        // What a blast throws out lands near: flung as far as it was, a wall lay thinly across the whole street and
        // there was no heap at its foot.
        let push = (30.0 * r * r / (far + r) / (body.count as f32).cbrt()).min(160.0) * if body.lump { 0.45 } else { 1.0 };
        let h = |seed: u32| hash3(body.born[0], body.born[1], body.born[2], seed) as f32 / u32::MAX as f32 - 0.5;
        body.thrown = radius > 0;
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
        let from_vehicle = whole.live.as_ref().is_some_and(|l| l.rides());
        self.detach_removed_body(whole.id);
        self.record(BROKE, &[whole.id]);
        let mut debris = self.list.iter().filter(|b| b.live.is_none()).count();
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
            if share.len() < 4 || (share.len() < SMALL && debris >= DEBRIS) || self.list.len() >= MOST {
                if let Some(c) = share.first() {
                    let p = add(whole.pos, r);
                    self.record(DUST, &[p[0].to_bits(), p[1].to_bits(), p[2].to_bits(), whole.cells[whole.at(c[0], c[1], c[2])] as u32, share.len() as u32]);
                }
                continue;
            }
            let size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
            let mut grid = vec![0 as Kind; size[0] * size[1] * size[2]];
            for c in &share {
                let mut cell_kind = whole.cells[whole.at(c[0], c[1], c[2])];
                // Extinguish headlight/taillight voxels on wrecked vehicle chunks so detached wrecks never glow.
                if from_vehicle && material(cell_kind) == crate::kinds::LAMP {
                    cell_kind = crate::kinds::kind(GLASS, crate::kinds::grey(11));
                }
                grid[c[0] - lo[0] + size[0] * (c[2] - lo[2] + size[2] * (c[1] - lo[1]))] = cell_kind;
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
            // Wrecked vehicle chunks tumble dramatically then clear into dust instead of baking jagged debris into roads.
            body.passing = whole.passing || from_vehicle || body.count < 40;
            body.lump = whole.lump || body.count < 80;
            body.limit_points(if body.count < 80 { LUMP_POINTS } else { 48 });
            if !from_vehicle && (self.persist_debris || whole.persist_sleep) {
                body.persist_sleep = body.qualifies_for_persist_sleep();
            }
            debris += 1;
            self.born(&body);
            self.list.push(body);
            self.broadphase_stale = true;
        }
    }

    /// Moves every body on by `dt` seconds, in whole steps; what is left over is owed to the next call.
    pub fn advance(&mut self, dt: f32) {
        // With few bodies awake a step costs next to nothing, and a call is given all the time it is owed up to a tenth
        // of a second (#367): held to three steps, a frame of 33 ms moved everything on by 25, so at thirty frames a
        // second a person walked at three quarters of their pace, and at twenty at half.
        let most = if self.list.iter().filter(|b| !b.asleep).take(MANY + 1).count() > MANY { STEPS } else { FEW_STEPS };
        self.owed = (self.owed + dt).min(STEP * most);
        self.steps = 0;
        self.tried = 0;
        self.paired = 0;
        // One time-sliced structural support job advances per call with bounded work (`50_000` ops).
        if !self.support_jobs.is_empty() {
            if self.support_jobs[0].step(50_000) {
                let job = self.support_jobs.remove(0);
                let (_region, pieces, dust) = job.finish();
                self.take(pieces, dust, None, MOST);
            }
        }
        // One wide box that has waited its time is asked about.
        for waiting in &mut self.far {
            waiting.wait -= dt;
        }
        self.far(if self.list.len() > 200 { 3 } else { 6 });
        // Fuses run down, and the first that has run out goes off.
        for fuse in &mut self.fuses {
            fuse.2 -= dt;
        }
        if let Some(due) = self.fuses.iter().position(|f| f.2 <= 0.0) {
            let (at, radius, _) = self.fuses.remove(due);
            self.went_off(at, radius);
        }
        // Wake sleeping bodies attached to an active winch or motorized joint before stepping.
        if self.joints.active_count() > 0 {
            let mut wake_ids: Vec<u32> = Vec::new();
            for j in self.joints.joints() {
                if j.broken {
                    continue;
                }
                let motorized = match j.kind {
                    crate::joints::JointKind::Distance(d) => d.winch_speed != 0.0,
                    crate::joints::JointKind::Hinge(h) => h.motor.max_effort > 0.0,
                    crate::joints::JointKind::Slider(s) => s.motor.max_effort > 0.0,
                    crate::joints::JointKind::Ball(b) => b.drive.is_some(),
                    _ => false,
                };
                if motorized {
                    if j.body_a != 0 {
                        wake_ids.push(j.body_a);
                    }
                    if j.body_b != 0 {
                        wake_ids.push(j.body_b);
                    }
                }
            }
            for bid in wake_ids {
                self.wake_body_id(bid);
            }
        }
        self.let_out();
        // What is held (hung by the Cleave, in something's grip) is out of the solver while it steps.
        let held = self.take_held();
        if !held.is_empty() {
            self.rebuild_broadphase();
        }
        while self.owed >= STEP && self.list.iter().any(|b| !b.asleep) {
            self.owed -= STEP;
            self.step(STEP);
            self.steps += 1;
        }
        let any_held = !held.is_empty();
        self.put_held(held);
        if self.steps > 0 || any_held {
            self.rebuild_broadphase();
        }
        if !self.list.iter().any(|b| !b.asleep) {
            self.owed = 0.0;
        }
        self.step_ballistics(dt);
        self.step_ragdolls(dt);
        if !self.beams.thermal.is_empty() {
            self.beams.cool(dt);
        }
        self.tell_struck();
        self.step_dynamic_fire(dt);
        self.burn(dt);
        // A fire beside something that goes up sets it off: asked five times a second, of some of what burns, and only
        // once a sector has been made that holds any such thing.
        self.since_lit += dt;
        if self.ground.charged && self.since_lit >= 0.2 && !self.fire.alight.is_empty() {
            self.since_lit = 0.0;
            let lit: Vec<[i32; 3]> = self.fire.alight.keys().take(600).copied().collect();
            let mut seeds = Vec::new();
            for c in lit {
                for d in [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] {
                    let n = [c[0] + d[0], c[1] + d[1], c[2] + d[2]];
                    if self.ground.solid(n[0], n[1], n[2]) && !self.ground.fuel(n[0], n[1], n[2]) && charged(self.ground.kind(n[0], n[1], n[2])) {
                        seeds.push(n);
                    }
                }
            }
            self.go_up(&seeds);
        }
        self.flow(dt);
        let mut words: Vec<u32> = Vec::with_capacity(self.list.len() * 8);
        for b in &self.list {
            // A ghost is where whoever it stands for is: nobody need be told.
            if b.live.as_ref().is_some_and(|live| live.ghost) {
                continue;
            }
            words.push(b.id);
            words.extend(b.pos.iter().chain(b.rot.iter()).map(|v| v.to_bits()));
        }
        self.record(MOVES, &words);
        self.tell_live();
        if !self.ragdolls.is_empty() {
            let poses: Vec<[u32; 18]> = self.ragdolls.iter().map(|r| pack_pose_words(r.id, &r.ragdoll)).collect();
            for p in &poses {
                self.record(POSE, p);
            }
        }
    }

    fn step_dynamic_fire(&mut self, dt: f32) {
        let steam_kind = crate::kinds::kind(WATER, crate::kinds::WHITE) as u32;
        if !self.fire.alight.is_empty()
            && (self.sea_level.is_some() || self.water.wet() > 0 || self.rain_intensity > 0.0)
        {
            let steam = self.fire.extinguish_in_water(&self.water, self.sea_level, self.rain_intensity);
            for p in steam {
                self.record(DUST, &[p[0].to_bits(), p[1].to_bits(), p[2].to_bits(), steam_kind, 3]);
            }
        }
        if self.list.is_empty() {
            if !self.fire.dynamic.is_empty() || !self.fire.dynamic_flames.is_empty() {
                self.fire.dynamic.clear();
                self.fire.dynamic_flames.clear();
            }
            return;
        }
        if self.fire.dynamic.is_empty() && self.fire.alight.is_empty() {
            return;
        }
        let report = {
            let views: Vec<crate::fire::DynamicFireBodyView<'_>> =
                self.list.iter().map(crate::fire::DynamicFireBodyView::from_body).collect();
            self.fire.step_dynamic_bodies(dt, &views, self.sea_level, &self.water, self.rain_intensity)
        };
        for p in &report.steam_puffs {
            self.record(DUST, &[p[0].to_bits(), p[1].to_bits(), p[2].to_bits(), steam_kind, 4]);
        }
        if !report.burnt_out.is_empty() {
            let mut touched_bodies: Vec<u32> = Vec::new();
            for burnt in &report.burnt_out {
                if let Some(body) = self.list.iter_mut().find(|b| b.id == burnt.body_id) {
                    if burnt.cell[0] < body.size[0]
                        && burnt.cell[1] < body.size[1]
                        && burnt.cell[2] < body.size[2]
                    {
                        let idx = body.at(burnt.cell[0], burnt.cell[1], burnt.cell[2]);
                        let was_solid = body.cells[idx] != 0;
                        body.cells[idx] = burnt.replacement;
                        if was_solid && burnt.replacement == 0 && body.count > 0 {
                            body.count -= 1;
                        }
                        if !touched_bodies.contains(&body.id) {
                            touched_bodies.push(body.id);
                        }
                    }
                }
            }
            if self.joints.active_count() > 0 {
                for bid in touched_bodies {
                    if let Some(body) = self.list.iter().find(|b| b.id == bid) {
                        let snapped = self.joints.invalidate_body_cells(bid, |c| {
                            body.solid([c[0] as i32, c[1] as i32, c[2] as i32])
                        });
                        self.wake_joint_bodies(&snapped);
                    }
                }
            }
        }
        if !report.ignite_ground.is_empty() {
            self.ignite_ground_cells(&report.ignite_ground);
        }
    }

    fn step_ragdolls(&mut self, dt: f32) {
        if self.ragdolls.is_empty() || dt <= 0.0 || !dt.is_finite() {
            return;
        }
        let mut rem = dt.min(0.25);
        while rem > 1e-6 {
            let h = rem.min(1.0 / 30.0);
            rem -= h;
            let (ragdolls, ground) = (&mut self.ragdolls, &mut self.ground);
            for active in ragdolls.iter_mut() {
                active.ragdoll.step(h, |[x, y, z]| ground.solid(x, y, z));
                for limb in &mut active.detached {
                    limb.step(h, |[x, y, z]| ground.solid(x, y, z));
                }
            }
            if ragdolls.len() > 1 {
                for i in 0..ragdolls.len() {
                    let (left, right) = ragdolls.split_at_mut(i + 1);
                    for other in right.iter_mut() {
                        crate::ragdoll::Ragdoll::collide_ragdolls(&mut left[i].ragdoll, &mut other.ragdoll);
                    }
                }
            }
        }
    }

    fn step_ballistics(&mut self, dt: f32) {
        let has_projectiles = !self.ballistics.projectiles.is_empty();
        let has_sim_waves = self.ballistics.shockwaves.active_waves() > 0
            || self.ballistics.shockwaves.active_shrapnel() > 0;
        let has_waves = self.shockwaves.active_waves() > 0 || self.shockwaves.active_shrapnel() > 0;
        if !has_projectiles && !has_sim_waves && !has_waves && self.ballistics.events.is_empty() {
            return;
        }

        let mut proj_targets = std::mem::take(&mut self.ballistic_targets_buf);
        let mut shock_targets = std::mem::take(&mut self.shock_targets_buf);
        let mut events = std::mem::take(&mut self.ballistic_events_buf);
        proj_targets.clear();
        shock_targets.clear();
        events.clear();
        events.extend(self.ballistics.events.drain(..));

        for b in &self.list {
            if b.live.as_ref().is_some_and(|l| l.ghost) || b.count == 0 {
                continue;
            }
            let aabb = b.world_aabb();
            let tgt = crate::ballistics::DynamicTarget {
                id: b.id,
                min: aabb.min,
                max: aabb.max,
                material: b.stuff,
                mass: if b.inv_mass > 0.0 { 1.0 / b.inv_mass } else { 1e9 },
            };
            proj_targets.push(tgt);
            shock_targets.push(tgt);
        }
        for r in &self.ragdolls {
            let (rlo, rhi) = r.ragdoll.aabb();
            shock_targets.push(crate::ballistics::DynamicTarget {
                id: encode_ragdoll_target(r.id, crate::ragdoll::BoneId::Chest),
                min: rlo,
                max: rhi,
                material: WOOD,
                mass: r.ragdoll.active_mass().max(1.0),
            });
            for bone in crate::ragdoll::BoneId::ALL {
                if r.ragdoll.is_missing(bone) {
                    continue;
                }
                let bs = &r.ragdoll.bones[bone.index()];
                let (min, max) = bs.aabb();
                proj_targets.push(crate::ballistics::DynamicTarget {
                    id: encode_ragdoll_target(r.id, bone),
                    min,
                    max,
                    material: WOOD,
                    mass: bs.mass,
                });
            }
        }

        let mut detonations: Vec<([f32; 3], crate::ballistics::ProjectileSpec)> = Vec::new();
        if has_projectiles {
            let (ballistics, ground) = (&mut self.ballistics, &mut self.ground);
            for proj in &mut ballistics.projectiles {
                if let Some(det) = crate::ballistics::step_projectile(
                    proj,
                    dt,
                    &proj_targets,
                    &mut |[x, y, z]| ground.kind(x, y, z),
                    &mut events,
                ) {
                    detonations.push(det);
                }
            }
            ballistics.projectiles.retain(|p| p.alive);
        }
        for (pos, spec) in detonations {
            let (shockwaves, ground) = (&mut self.shockwaves, &mut self.ground);
            shockwaves.spawn_blast(
                pos,
                spec.blast_radius,
                spec.blast_pressure,
                spec.blast_shrapnel,
                |[x, y, z]| ground.kind(x, y, z),
            );
        }
        if has_sim_waves {
            self.ballistics.shockwaves.step(dt, &shock_targets, &mut events);
        }
        if self.shockwaves.active_waves() > 0 || self.shockwaves.active_shrapnel() > 0 {
            self.shockwaves.step(dt, &shock_targets, &mut events);
        }

        let mut chip_runs: Vec<Run> = Vec::new();
        for ev in events.drain(..) {
            match ev {
                crate::ballistics::BallisticEvent::VoxelChip { cell, kind, .. } => {
                    chip_runs.push(Run { x0: cell[0], x1: cell[0] + 1, y: cell[1], z: cell[2], kind: 0 });
                    self.record(
                        DUST,
                        &[
                            (cell[0] as f32 + 0.5).to_bits(),
                            (cell[1] as f32 + 0.5).to_bits(),
                            (cell[2] as f32 + 0.5).to_bits(),
                            kind as u32,
                            1,
                        ],
                    );
                }
                crate::ballistics::BallisticEvent::Ricochet { pos, material, .. } => {
                    self.record(
                        DUST,
                        &[pos[0].to_bits(), pos[1].to_bits(), pos[2].to_bits(), material as u32, 2],
                    );
                }
                crate::ballistics::BallisticEvent::BodyHit { body_id, pos, impulse, .. } => {
                    if let Some((rid, bone)) = decode_ragdoll_target(body_id) {
                        if let Some(active) = self.ragdolls.iter_mut().find(|r| r.id == rid) {
                            let res = active.ragdoll.apply_hit(bone, pos, impulse, 0.0, false);
                            if let Some(limb) = res.detached {
                                active.detached.push(limb);
                            }
                        }
                    } else if let Some(idx) = self.list.iter().position(|b| b.id == body_id) {
                        self.wake_body_and_island(idx);
                        let b = &mut self.list[idx];
                        if b.inv_mass > 0.0 {
                            let r = sub(pos, b.pos);
                            b.vel = add(b.vel, scale(impulse, b.inv_mass));
                            b.spin = add(b.spin, b.turn_resist(cross(r, impulse)));
                            b.still = 0.0;
                        }
                    }
                }
                crate::ballistics::BallisticEvent::RocketDetonate { pos, radius, jet_cells, .. } => {
                    self.record(
                        BURST,
                        &[pos[0].to_bits(), pos[1].to_bits(), pos[2].to_bits(), radius.round() as u32],
                    );
                    for c in jet_cells {
                        chip_runs.push(Run { x0: c[0], x1: c[0] + 1, y: c[1], z: c[2], kind: 0 });
                    }
                    self.wake_in_aabb(
                        [pos[0] - radius, pos[1] - radius, pos[2] - radius],
                        [pos[0] + radius, pos[1] + radius, pos[2] + radius],
                    );
                }
                crate::ballistics::BallisticEvent::ShockwaveHit { target_id, impulse, .. } => {
                    if let Some((rid, bone)) = decode_ragdoll_target(target_id) {
                        if let Some(active) = self.ragdolls.iter_mut().find(|r| r.id == rid) {
                            let hit_pos = active.ragdoll.bones[bone.index()].pos;
                            let res = active.ragdoll.apply_hit(bone, hit_pos, impulse, 0.0, false);
                            if let Some(limb) = res.detached {
                                active.detached.push(limb);
                            }
                        }
                    } else if let Some(idx) = self.list.iter().position(|b| b.id == target_id) {
                        self.wake_body_and_island(idx);
                        let b = &mut self.list[idx];
                        if b.inv_mass > 0.0 {
                            b.vel = add(b.vel, scale(impulse, b.inv_mass));
                            b.still = 0.0;
                        }
                    }
                }
            }
        }

        if !chip_runs.is_empty() {
            chip_runs.sort_unstable_by_key(|r| (r.y, r.z, r.x0));
            chip_runs.dedup_by_key(|r| (r.x0, r.y, r.z));
            self.change(chip_runs);
        }

        self.ballistic_targets_buf = proj_targets;
        self.shock_targets_buf = shock_targets;
        self.ballistic_events_buf = events;
    }

    fn step(&mut self, h: f32) {
        #[cfg(test)]
        let mut lap = std::time::Instant::now();
        #[cfg(test)]
        let mut mark = |k: usize| { SPENT.with(|s| s.borrow_mut()[k] += lap.elapsed().as_secs_f64()); lap = std::time::Instant::now(); };
        // Propagate any external wake (direct `asleep = false`, `kick`, `drive`, `stir`, `shove`) to its entire island.
        self.solver_step = self.solver_step.wrapping_add(1);
        self.propagate_wakes();
        self.recent_contacts.retain(|_, ttl| {
            *ttl = ttl.saturating_sub(1);
            *ttl > 0
        });
        // What lives is moved by its motor; then what pulls and what touches.
        self.motors(h);
        self.touches.clear();
        self.parted.clear();
        let water_active = self.sea_level.is_some() || self.water.wet() > 0 || self.water.flowing();
        let mut found: Vec<(V, V, V, f32)> = Vec::new();
        let mut ploughed: Vec<[i32; 3]> = Vec::new();
        for i in 0..self.list.len() {
            let b = &mut self.list[i];
            // What sleeps is not stepped; and a ghost (living.rs) is where it is put, and meets bodies only.
            if b.asleep || b.live.as_ref().is_some_and(|live| live.ghost) {
                continue;
            }
            b.vel[1] -= G * h;
            b.spin = scale(b.spin, 1.0 - 0.4 * h);
            if water_active && b.inv_mass > 0.0 {
                let enclosed_air = if b.live.as_ref().is_some_and(|live| live.hull.is_some()) {
                    let hollow = (b.size[0] * b.size[1] * b.size[2]).saturating_sub(b.count);
                    (hollow / 3).min(b.count * 2)
                } else {
                    0
                };
                let buoy = self.water.compute_buoyancy(
                    b.pos,
                    b.rot,
                    b.com,
                    b.size,
                    &b.cells,
                    b.vel,
                    b.spin,
                    self.sea_level,
                    enclosed_air,
                );
                if buoy.submerged_cells > 0 {
                    b.vel = add(b.vel, scale(buoy.force, b.inv_mass * h));
                    b.spin = add(b.spin, b.turn_resist(scale(buoy.torque, h)));
                }
            }

            b.age += h;
            b.apart += h;
            b.knock = 0.0;
            b.footing = [f32::MAX, f32::MIN, f32::MAX, f32::MIN];
            let (pos, rot) = (b.pos, b.rot);
            self.list[i].turned.clear();
            for k in 0..self.list[i].points.len() {
                let r = turn(rot, self.list[i].points[k]);
                self.list[i].turned.push(r);
                let p = add(pos, r);
                let cell = [p[0].floor() as i32, p[1].floor() as i32, p[2].floor() as i32];
                self.tried += 1;
                if !self.ground.solid(cell[0], cell[1], cell[2]) {
                    continue;
                }
                // A living thing that is told to go ploughs through loose rubble, from standing too: a car that broke a wall sat on the heap
                // with its belly caught on it, and could go neither on nor back.
                if self.list[i].live.as_ref().is_some_and(|live| live.going() && !live.figure) && ploughed.len() < 48 && rubble(self.ground.kind(cell[0], cell[1], cell[2])) {
                    ploughed.push(cell);
                    continue;
                }
                // What rides on feet goes up over the top of a step it meets low down, as a wheel would: pushed back
                // out of the riser's face, a car at 190 km/h that grazed one with a corner was stopped dead and broke.
                if r[1] < 0.0 && self.list[i].live.as_ref().is_some_and(|live| live.rides()) && !self.ground.solid(cell[0], cell[1] + 1, cell[2]) {
                    found.push((r, [0.0; 3], [0.0, 1.0, 0.0], (cell[1] + 1) as f32 - p[1]));
                    continue;
                }
                // Shut in deep: out is back towards the body's own middle.
                let ground = &mut self.ground;
                let out_of = if self.list[i].live.is_some() { r } else { [0.0; 3] };
                let (n, deep) = way_back(p, cell, out_of, |c| ground.solid(c[0], c[1], c[2])).unwrap_or_else(|| (unit(scale(r, -1.0)), 1.0));
                found.push((r, [0.0; 3], n, deep));
            }
            if !found.is_empty() {
                self.list[i].apart = 0.0;
            }
            keep(&mut found, i, NONE, &mut self.touches);
        }
        if !ploughed.is_empty() {
            ploughed.sort_unstable();
            ploughed.dedup();
            for c in ploughed.iter().step_by(6) {
                let kind = self.ground.kind(c[0], c[1], c[2]);
                self.record(DUST, &[(c[0] as f32 + 0.5).to_bits(), (c[1] as f32 + 0.5).to_bits(), (c[2] as f32 + 0.5).to_bits(), kind as u32, 6]);
            }
            self.change(ploughed.iter().map(|c| Run { x0: c[0], x1: c[0] + 1, y: c[1], z: c[2], kind: 0 }).collect());
        }
        #[cfg(test)]
        mark(0);
        // Body against body via spatial broadphase (#166): eliminates O(N*M) scanning while preserving exact filters
        // (lumps vs non-living, sleeping pairs, living hull checks, deterministic ordering).
        let is_big = |b: &Body| ((b.count >= SMALL || b.persist_sleep) && !b.lump) || b.live.is_some();
        self.rebuild_broadphase_hash();
        let mut pairs = std::mem::take(&mut self.pairs);
        self.broadphase.query_pairs(&mut pairs);
        for &(p, q) in &pairs {
            let big_p = is_big(&self.list[p]);
            let big_q = is_big(&self.list[q]);
            if !big_p && !big_q {
                continue;
            }
            // Keep exact pair orientation: big body first if only one is big, lower index first if both are big.
            let (i, j) = if big_p { (p, q) } else { (q, p) };
            if (self.list[j].lump && self.list[i].live.is_none()) || (self.list[i].asleep && self.list[j].asleep) {
                continue;
            }
            let (a, b) = (&self.list[i], &self.list[j]);
            let apart = sub(b.pos, a.pos);
            let reach = a.radius + b.radius;
            if dot(apart, apart) > reach * reach {
                continue;
            }
            // Two rolling vehicles meet as whole hulls, parted one way (hull.rs): cell by cell a car in another's
            // hollow cabin touched nothing, and its shell was pushed the short way, into the cabin or up over the roof.
            let hulls = a.live.as_ref().and_then(|live| live.hull.as_ref()).zip(b.live.as_ref().and_then(|live| live.hull.as_ref()));
            if let Some((ha, hb)) = hulls {
                self.paired += (a.points.len() + b.points.len()) as u32;
                if let Some((n, deep)) = hull::meet(a, ha, b, hb, &mut found) {
                    self.parted.push((i, j, n, deep));
                }
            }
            for (one, other, flip) in [(i, j, false), (j, i, true)].into_iter().take(if hulls.is_some() { 0 } else { 2 }) {
                let (a, b) = (&self.list[one], &self.list[other]);
                self.paired += a.points.len() as u32;
                for &ra in &a.turned {
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
                let (id_a, id_b) = (self.list[i].id, self.list[j].id);
                let edge = if id_a < id_b { (id_a, id_b) } else { (id_b, id_a) };
                self.recent_contacts.insert(edge, CONTACT_TTL);
                for k in [i, j] {
                    self.list[k].apart = 0.0;
                    if self.list[k].asleep || self.list[k].island_id != 0 {
                        self.wake_body_and_island(k);
                    }
                }
            }
            keep(&mut found, i, j, &mut self.touches);
        }
        self.pairs = pairs;
        #[cfg(test)]
        mark(1);
        // What each body stands on: the stretch its touches cover.
        for t in &self.touches {
            for (who, r) in [(t.a, t.ra), (t.b, t.rb)] {
                if who != NONE {
                    let f = &mut self.list[who].footing;
                    *f = [f[0].min(r[0]), f[1].max(r[0]), f[2].min(r[2]), f[3].max(r[2])];
                }
            }
        }
        // Each touch stops what is closing and rubs against what is sliding, a few times over. How hard each touch
        // is to push along its own way and the two ways across it is worked out once: nothing turns while the pushes
        // are shared out, and worked out at every push it was half of all the solver did.
        // For each touch: the three ways, how hard each is to push, and the spin a push of one along each gives its
        // two bodies.
        // Legs handle figures' traction (0.03 body friction); tyres handle rolling vehicles' traction.
        // Metal bodywork glances at 0.24, while masonry/debris keeps 0.7.
        for b in &mut self.list {
            if let Some(live) = &mut b.live {
                live.given = [0.0; 3];
            }
        }
        let person = |i: usize| i != NONE && self.list[i].live.as_ref().is_some_and(|live| live.figure);
        let rides = |i: usize| i != NONE && self.list[i].live.as_ref().is_some_and(|live| live.rides());
        let vehicles: Vec<bool> = self.touches.iter().map(|t| rides(t.a) || rides(t.b)).collect();
        // Hull against hull (hull.rs): what each of the two loses to the other is kept, for what breaks it below.
        let hulled = |i: usize| i != NONE && self.list[i].live.as_ref().is_some_and(|live| live.hull.is_some());
        let hulls: Vec<bool> = self.touches.iter().map(|t| hulled(t.a) && hulled(t.b)).collect();
        let rubs: Vec<f32> = self.touches.iter().enumerate().map(|(i, t)|
            if person(t.a) || person(t.b) { 0.03 } else if vehicles[i] { 0.24 } else { 0.7 }).collect();
        // Store approach speeds before any contact is solved. Otherwise earlier points hide the hit from later ones.
        for t in &mut self.touches {
            let va = self.list[t.a].speed_at(t.ra);
            let vb = if t.b == NONE { [0.0; 3] } else { self.list[t.b].speed_at(t.rb) };
            t.closing = dot(sub(va, vb), t.n);
        }
        let ways: Vec<([V; 3], [f32; 3], [V; 3], [V; 3])> = self.touches.iter().map(|t| {
            let across = if t.n[1].abs() < 0.9 { unit(cross(t.n, [0.0, 1.0, 0.0])) } else { unit(cross(t.n, [1.0, 0.0, 0.0])) };
            let ds = [t.n, across, cross(t.n, across)];
            let spins_a = ds.map(|d| self.list[t.a].turn_resist(cross(t.ra, d)));
            let spins_b = if t.b == NONE { [[0.0; 3]; 3] } else { ds.map(|d| self.list[t.b].turn_resist(cross(t.rb, d))) };
            let weights = [0, 1, 2].map(|k| {
                let mut w = self.list[t.a].inv_mass + dot(cross(spins_a[k], t.ra), ds[k]);
                if t.b != NONE {
                    w += self.list[t.b].inv_mass + dot(cross(spins_b[k], t.rb), ds[k]);
                }
                w
            });
            (ds, weights, spins_a, spins_b)
        }).collect();
        // Warm-start persistent resting rigid contacts from `solver::ManifoldCache` (#166).
        let mut manifold_keys: Vec<Option<crate::solver::ManifoldKey>> = Vec::with_capacity(self.touches.len());
        let has_cache = !self.manifold_cache.is_empty();
        for (t_idx, t) in self.touches.iter_mut().enumerate() {
            let live_a = self.list[t.a].live.as_ref();
            let live_b = if t.b != NONE { self.list[t.b].live.as_ref() } else { None };
            let eligible = live_a.is_none() && live_b.is_none();
            if !eligible {
                manifold_keys.push(None);
                continue;
            }
            let id_a = self.list[t.a].id;
            let id_b = if t.b == NONE { crate::solver::WORLD_BODY_ID } else { self.list[t.b].id };
            let local_ra = back(self.list[t.a].rot, t.ra);
            let key = crate::solver::ManifoldKey::new(id_a, id_b, contact_feature_key(local_ra, t.n));
            manifold_keys.push(Some(key));
            if has_cache && t.closing > -40.0 {
                if let Some(cached) = self.manifold_cache.get(key) {
                    let s = crate::solver::DEFAULT_WARM_START_SCALE;
                    let jn = (cached.jn * s).max(0.0);
                    let (ds, _, spins_a, spins_b) = &ways[t_idx];
                    let jt_world = add(scale(cached.t1, cached.jt1), scale(cached.t2, cached.jt2));
                    let max_f = rubs[t_idx] * jn;
                    let jt1 = (dot(jt_world, ds[1]) * s).clamp(-max_f, max_f);
                    let jt2 = (dot(jt_world, ds[2]) * s).clamp(-max_f, max_f);
                    t.pushed = jn;
                    t.rubbed = [jt1, jt2];
                    let (a, b) = (t.a, t.b);
                    for (k, by) in [(0usize, jn), (1usize, jt1), (2usize, jt2)] {
                        if by == 0.0 {
                            continue;
                        }
                        self.list[a].vel = add(self.list[a].vel, scale(ds[k], by * self.list[a].inv_mass));
                        self.list[a].spin = add(self.list[a].spin, scale(spins_a[k], by));
                        if b != NONE {
                            self.list[b].vel = sub(self.list[b].vel, scale(ds[k], by * self.list[b].inv_mass));
                            self.list[b].spin = sub(self.list[b].spin, scale(spins_b[k], by));
                        }
                    }
                }
            }
        }
        for round in 0..8 {
            for t in 0..self.touches.len() {
                let (a, b, ra, rb, n) = { let t = &self.touches[t]; (t.a, t.b, t.ra, t.rb, t.n) };
                let (ds, weights, spins_a, spins_b) = &ways[t];
                // A push of `by` along the touch's way `k`: on the first body, and back on the second.
                let push = |list: &mut Vec<Body>, k: usize, by: f32| {
                    list[a].vel = add(list[a].vel, scale(ds[k], by * list[a].inv_mass));
                    list[a].spin = add(list[a].spin, scale(spins_a[k], by));
                    if b != NONE {
                        list[b].vel = sub(list[b].vel, scale(ds[k], by * list[b].inv_mass));
                        list[b].spin = sub(list[b].spin, scale(spins_b[k], by));
                    }
                };
                let rel = |list: &Vec<Body>| {
                    let va = list[a].speed_at(ra);
                    if b == NONE { va } else { sub(va, list[b].speed_at(rb)) }
                };
                let v = rel(&self.list);
                let closing = dot(v, n);
                if round == 0 && !vehicles[t] { self.touches[t].closing = closing; }
                let approach = self.touches[t].closing;
                // Keep the small crumple rebound as a target through all iterations: recomputing it from
                // the residual velocity cancels the bounce on the very next pass.
                let rebound = if vehicles[t] && approach < -50.0 { -approach * 0.1 } else { 0.0 };
                let bounce = if !vehicles[t] && closing < -40.0 { 0.12 } else { 0.0 };
                let was = self.touches[t].pushed;
                let now = (was - ((1.0 + bounce) * closing - rebound) / weights[0]).max(0.0);
                self.touches[t].pushed = now;
                let knock = now * self.list[a].inv_mass;
                self.list[a].knock = self.list[a].knock.max(knock);
                if b != NONE {
                    let knock = now * self.list[b].inv_mass;
                    self.list[b].knock = self.list[b].knock.max(knock);
                }
                push(&mut self.list, 0, now - was);
                if hulls[t] {
                    for (who, by) in [(a, now - was), (b, was - now)] {
                        let given = scale(n, by * self.list[who].inv_mass);
                        let live = self.list[who].live.as_mut().unwrap();
                        live.given = add(live.given, given);
                    }
                }
                // Rubbing, across the touch, no more than the push allows.
                for k in 0..2 {
                    let d = ds[k + 1];
                    let sliding = dot(rel(&self.list), d);
                    let most = rubs[t] * self.touches[t].pushed;
                    let was = self.touches[t].rubbed[k];
                    let now = (was - sliding / weights[k + 1]).clamp(-most, most);
                    self.touches[t].rubbed[k] = now;
                    push(&mut self.list, k + 1, now - was);
                }
            }
        }
        // Persist solved contact impulses into `solver::ManifoldCache` and evict stale contacts.
        for (t_idx, key_opt) in manifold_keys.into_iter().enumerate() {
            if let Some(key) = key_opt {
                let t = &self.touches[t_idx];
                if t.pushed > 0.0 {
                    let (ds, _, _, _) = &ways[t_idx];
                    self.manifold_cache.store(
                        key,
                        crate::solver::CachedImpulse {
                            jn: t.pushed,
                            jt1: t.rubbed[0],
                            jt2: t.rubbed[1],
                            t1: ds[1],
                            t2: ds[2],
                            last_step: self.solver_step,
                        },
                    );
                }
            }
        }
        if !self.manifold_cache.is_empty() {
            self.manifold_cache.evict_stale(self.solver_step);
        }
        #[cfg(test)]
        mark(2);
        #[cfg(test)]
        SPENT.with(|s| s.borrow_mut()[6] += self.touches.len() as f64);
        // What overlaps is eased apart, without that becoming speed.
        for t in &self.touches {
            let ease = ((t.depth - 0.05) * 0.2).clamp(0.0, 0.3);
            if ease <= 0.0 {
                continue;
            }
            if t.b == NONE {
                self.list[t.a].pos = add(self.list[t.a].pos, scale(t.n, ease));
            } else {
                // A ghost stays where it is put: the other body is eased out of it all the way.
                let still = |b: &Body| b.live.as_ref().is_some_and(|live| live.ghost);
                let (ma, mb) = (if still(&self.list[t.a]) { 0.0 } else { self.list[t.a].inv_mass }, if still(&self.list[t.b]) { 0.0 } else { self.list[t.b].inv_mass });
                if ma + mb == 0.0 {
                    continue;
                }
                self.list[t.a].pos = add(self.list[t.a].pos, scale(t.n, ease * ma / (ma + mb)));
                self.list[t.b].pos = sub(self.list[t.b].pos, scale(t.n, ease * mb / (ma + mb)));
            }
        }
        for &(a, b, n, deep) in &self.parted {
            let (ma, mb) = (self.list[a].inv_mass, self.list[b].inv_mass);
            let ease = hull::ease(deep);
            self.list[a].pos = add(self.list[a].pos, scale(n, ease * ma / (ma + mb)));
            self.list[b].pos = sub(self.list[b].pos, scale(n, ease * mb / (ma + mb)));
        }
        // What met hard enough to be told of (living.rs), before anything of it is broken.
        let met = self.meetings();
        // Where a big body struck the standing world hardest, the world breaks too: one such place a step, a few a second.
        self.since_crush += h;
        if self.since_crush > 0.12 && self.list.len() < MOST {
            let mut worst: Option<([i32; 3], f32, u32, Option<(V, V)>, bool)> = None;
            for t in &self.touches {
                let body = &self.list[t.a];
                // A living thing may stand on a pavement for an hour: its weight alone breaks nothing, only a blow.
                let vehicle = body.live.as_ref().is_some_and(|live| live.rides());
                if vehicle && (self.since_crush < 0.32 || t.closing >= -35.0) { continue; }
                if t.b == NONE && body.count >= 60 && t.pushed > HARD && body.live.as_ref().is_none_or(|live| t.closing < -15.0 && !live.figure) && worst.as_ref().is_none_or(|w| t.pushed > w.1) {
                    let p = sub(add(body.pos, t.ra), scale(t.n, 0.5));
                    worst = Some(([p[0].floor() as i32, p[1].floor() as i32, p[2].floor() as i32], t.pushed, body.id, body.live.is_some().then_some((add(body.pos, t.ra), t.n)), vehicle || body.lump || body.broken > 0));
                }
            }
            // The ground itself is not broken by what lands on it: only what is built.
            if let Some((at, push, id, live, fragments)) = worst {
                // A living thing goes fast and what it hits may be thin: the cell it met is looked for.
                let at = live.and_then(|(p, n)| self.met(p, n)).unwrap_or(at);
                if !matches!(material(self.ground.kind(at[0], at[1], at[2])), 0 | EARTH | ROCK | GRASS | SAND | WATER | ASPHALT) {
                    self.since_crush = 0.0;
                    self.crushes += 1;
                    self.broke(id, met);
                    self.crush(at, push, fragments);
                }
            }
        }
        #[cfg(test)]
        mark(3);
        // What was knocked harder than it can take breaks where it is.
        let mut i = 0;
        while i < self.list.len() {
            let b = &mut self.list[i];
            // Living damage uses total delta-V: a chassis shares its blow across many contact points.
            // Rolling bodies spend their crumple reserve; other motors retain their original threshold.
            let (knock, takes) = match &b.live {
                None => (b.knock, breaks_at(b.stuff) * (1.0 + b.broken as f32)),
                // Bodywork gives against bodywork: of what another vehicle's hull took from it, `hull::YIELDS` is not counted.
                Some(live) => { let lost = sub(sub(b.vel, live.was), scale(live.given, hull::YIELDS)); (if live.hurt { f32::MAX } else { dot(lost, lost).sqrt() }, live.tough) }
            };
            #[cfg(test)]
            if b.live.as_ref().is_some_and(|l| l.rides()) && knock > 30.0 && std::env::var_os("CRASH_TRACE").is_some() {
                let closing = self.touches.iter().filter(|t| t.a == i || t.b == i).map(|t| -t.closing).fold(0.0, f32::max);
                eprintln!("impact id={} knock={knock:.6} closing={closing:.6}", b.id);
            }
            let fails = if b.live.as_ref().is_some_and(|live| live.rides() && !live.hurt) {
                b.crumple(knock, takes)
            } else { knock > takes };
            if let Some(live) = &mut b.live {
                live.jolt = live.jolt.max(knock);
            }
            let b = &self.list[i];
            if b.count >= WHOLE && !b.asleep && fails && !b.live.as_ref().is_some_and(|live| live.figure) {
                let whole = self.list.swap_remove(i);
                self.broke(whole.id, met);
                self.shatter(whole);
            } else {
                i += 1;
            }
        }
        #[cfg(test)]
        mark(4);
        // Solve 6-DOF joints velocity phase before integrating positions (`joints.rs`, #166).
        let joint_cfg = crate::joints::SolverConfig::default();
        let mut joint_bodies = std::mem::take(&mut self.joint_bodies_buf);
        joint_bodies.clear();
        if self.joints.active_count() > 0 {
            self.invalidate_joint_world_anchors();
            if self.joints.active_count() > 0 {
                let mut ref_ids: Vec<u32> = Vec::new();
                for j in self.joints.joints() {
                    if j.broken {
                        continue;
                    }
                    if j.body_a != 0 && !ref_ids.contains(&j.body_a) {
                        ref_ids.push(j.body_a);
                    }
                    if j.body_b != 0 && !ref_ids.contains(&j.body_b) {
                        ref_ids.push(j.body_b);
                    }
                }
                for &bid in &ref_ids {
                    if let Some(b) = self.list.iter().find(|b| b.id == bid) {
                        joint_bodies.push(crate::joints::SolverBody::from_local_inertia(
                            b.id,
                            b.pos,
                            b.rot,
                            b.vel,
                            b.spin,
                            b.inv_mass,
                            b.inv_inertia,
                            b.asleep,
                        ));
                    }
                }
                if !joint_bodies.is_empty() {
                    let events = self.joints.solve_velocities(&mut joint_bodies, h, &joint_cfg);
                    let mut woken_ids: Vec<u32> = Vec::new();
                    for sb in &joint_bodies {
                        if let Some(b) = self.list.iter_mut().find(|b| b.id == sb.id) {
                            let woke = b.asleep && !sb.asleep;
                            b.vel = sb.vel;
                            b.spin = sb.spin;
                            if woke {
                                woken_ids.push(b.id);
                            }
                        }
                    }
                    for bid in woken_ids {
                        self.wake_body_id(bid);
                    }
                    if !events.is_empty() {
                        let broken_ids: Vec<u32> = events
                            .iter()
                            .map(|&crate::joints::JointEvent::Broken { id, .. }| id)
                            .collect();
                        self.wake_joint_bodies(&broken_ids);
                    }
                }
            }
        }
        // On they go; what has lain still long enough is cells again.
        let mut i = 0;
        while i < self.list.len() {
            let b = &mut self.list[i];
            if b.asleep {
                i += 1;
                continue;
            }
            // A ghost that was struck does not go anywhere: what the blow would have done to it is told, for whoever
            // moves the body it stands for, and it waits where it was put.
            if b.live.as_ref().is_some_and(|live| live.ghost) {
                let (id, took) = (b.id, b.vel);
                (b.vel, b.spin, b.asleep) = ([0.0; 3], [0.0; 3], true);
                if dot(took, took) > 0.01 {
                    self.record(TOOK, &[id, took[0].to_bits(), took[1].to_bits(), took[2].to_bits()]);
                }
                i += 1;
                continue;
            }
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
            // The longer a non-persistent body has been about, the less still it need be: something rocking in a
            // corner is put down. Persistent rigid bodies use strict low-velocity stillness thresholds and sleep
            // together by simulation island in `settle_islands`.
            let ease = if b.persist_sleep { 1.0 } else { 1.0 + (b.age - 2.5).max(0.0) * 0.8 };
            let slow = dot(b.vel, b.vel) < (STILL_SPEED * ease).powi(2) && dot(b.spin, b.spin) < (STILL_SPIN * ease).powi(2);
            // And it is at rest only if its weight is over what it touches: a chimney starting to go over is slow, not still.
            let f = b.footing;
            // Asked only of big things: a lump lies as it lands, propped on whatever is under it.
            let over = b.count < 1500 || (f[0] <= 0.5 && f[1] >= -0.5 && f[2] <= 0.5 && f[3] >= -0.5);
            b.still = if slow && b.apart < 0.1 && (over || (!b.persist_sleep && b.age > OLD)) { b.still + h } else { 0.0 };
            // Old and still on its way (a chimney going over takes its time) is left to it, up to a point.
            let stuck = !b.persist_sleep && b.age >= OLD && dot(b.vel, b.vel) < 400.0 && dot(b.spin, b.spin) < 0.25;
            let jointed = !joint_bodies.is_empty()
                && self.joints.joints().iter().any(|j| !j.broken && (j.body_a == b.id || j.body_b == b.id));
            if b.live.is_some() {
                Self::drowse(b, h);
                i += 1;
            } else if b.persist_sleep || jointed {
                i += 1;
            } else if b.still >= STILL_FOR || stuck || b.age >= OLD * 3.0 {
                let body = self.list.swap_remove(i);
                self.rested.push((body.age * 10.0) as u32);
                self.rest(body);
            } else {
                i += 1;
            }
        }
        // Post-integration XPBD position projection & zero-bias velocity relaxation for active joints.
        if !joint_bodies.is_empty() && self.joints.active_count() > 0 {
            for sb in &mut joint_bodies {
                if let Some(b) = self.list.iter().find(|b| b.id == sb.id) {
                    sb.pos = b.pos;
                    sb.rot = b.rot;
                    sb.vel = b.vel;
                    sb.spin = b.spin;
                    sb.asleep = b.asleep;
                    sb.refresh_world_inertia(b.inv_inertia);
                }
            }
            // A plastic weld that gave this step holds where it bent before positions are projected.
            let mut yielded = Vec::new();
            self.joints.evaluate_plastic_yield(&joint_bodies, h, &mut yielded);
            if !yielded.is_empty() {
                let ids: Vec<u32> = yielded.iter().map(|&crate::joints::JointEvent::Broken { id, .. }| id).collect();
                self.wake_joint_bodies(&ids);
            }
            self.joints.solve_positions(&mut joint_bodies, h, &joint_cfg);
            for sb in &joint_bodies {
                if let Some(b) = self.list.iter_mut().find(|b| b.id == sb.id) {
                    b.pos = sb.pos;
                    b.rot = sb.rot;
                    b.vel = sb.vel;
                    b.spin = sb.spin;
                }
            }
        }
        self.joint_bodies_buf = joint_bodies;
        self.settle_islands();
        self.broadphase_stale = true;
        #[cfg(test)]
        mark(5);
    }

    /// A body that has come to rest is cells of the world again, as it lies. One lying nearly square to the world is
    /// put down square, cell for cell; one lying askew is cut along the world's cells, which changes how many it is.
    fn rest(&mut self, mut body: Body) {
        self.detach_removed_body(body.id);
        // What passes leaves nothing where it stops but a little dust.
        if body.passing {
            let mut words = vec![body.id];
            words.extend(body.pos.iter().chain(body.rot.iter()).map(|v| v.to_bits()));
            self.record(DUST, &[body.pos[0].to_bits(), body.pos[1].to_bits(), body.pos[2].to_bits(), body.stuff as u32, (body.count as u32).min(6)]);
            self.record(GONE, &words);
            return;
        }
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
        // A big piece of masonry that has stopped is no one stiff thing: see `sitting`.
        let stays = if body.broken == 0 && body.count >= BREAKS && brittle(body.stuff) && self.list.len() < MOST { Some(self.sitting(&body, lo, hi)) } else { None };
        let across = (hi[0] - lo[0]) as usize;
        let deep = (hi[2] - lo[2]) as usize;
        if !square && pours(body.stuff) {
            self.pour(&body, lo, hi, stays.as_deref());
            let mut words = vec![body.id];
            words.extend(body.pos.iter().chain(body.rot.iter()).map(|v| v.to_bits()));
            self.record(GONE, &words);
            return;
        }
        let mut runs: Vec<Run> = Vec::new();
        for y in lo[1]..hi[1] {
            for z in lo[2]..hi[2] {
                let mut open: Option<Run> = None;
                for x in lo[0]..hi[0] {
                    let (cell, _) = body.cell_at([x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5]);
                    let here = match &stays {
                        Some(stays) => stays[(x - lo[0]) as usize + across * ((z - lo[2]) as usize + deep * (y - lo[1]) as usize)],
                        None => true,
                    };
                    let kind = if here && body.solid(cell) && !self.ground.solid(x, y, z) { body.cells[body.at(cell[0] as usize, cell[1] as usize, cell[2] as usize)] } else { 0 };
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
        // What goes up when hit, thrown and come to rest, goes up where it lies: a drum blown across the street by the
        // one beside it was otherwise a drum lying in the street, and the row of them stopped there.
        // Only what a blast threw: a drum that rolls over when it is set down does not.
        let lit: Vec<[i32; 3]> = runs.iter().filter(|r| body.thrown && charged(r.kind)).take(1).map(|r| [r.x0, r.y, r.z]).collect();
        self.change(runs);
        self.go_up(&lit);
        // Where it lies is told once more, so that it is drawn there until the cells are in the picture.
        let mut words = vec![body.id];
        words.extend(body.pos.iter().chain(body.rot.iter()).map(|v| v.to_bits()));
        self.record(GONE, &words);
    }
}

/// Whether a body mostly of this, stopped askew, lies as rubble: masonry and glass do. Steel and wood keep their shape
/// and are cut along the world's cells as they lie.
fn pours(material: u8) -> bool {
    brittle(material) || material == GLASS
}

/// How far a cell of rubble comes down a heap's side before it stays where it is, in cells sideways.
const SLIDES: usize = 24;
/// The furthest a cell of rubble falls to what is under it.
const FALLS: i32 = 3000;

impl Bodies {
    /// A body of masonry that has stopped askew cannot lie as cells of the world, which are square to it: cut along
    /// them it was a slab of stairs with holes in it. It is rubble. Each of its cells, the lowest first, comes down
    /// its own column onto what is under it, and where the heap beside it is two cells or more lower, on down that
    /// side: so what lies there is a heap with nothing under it empty and sides no steeper than one in one. Most
    /// of it is the grey of its dust; a bit here and there keeps the colour it had. `stays` is `sitting`'s answer, if asked.
    fn pour(&mut self, body: &Body, lo: [i32; 3], hi: [i32; 3], stays: Option<&[bool]>) {
        let (across, deep) = ((hi[0] - lo[0]) as usize, (hi[2] - lo[2]) as usize);
        let mut loose: Vec<([i32; 3], Kind)> = Vec::new();
        for y in lo[1]..hi[1] {
            for z in lo[2]..hi[2] {
                for x in lo[0]..hi[0] {
                    let (cell, _) = body.cell_at([x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5]);
                    let here = stays.is_none_or(|stays| stays[(x - lo[0]) as usize + across * ((z - lo[2]) as usize + deep * (y - lo[1]) as usize)]);
                    if here && body.solid(cell) {
                        loose.push(([x, y, z], body.cells[body.at(cell[0] as usize, cell[1] as usize, cell[2] as usize)]));
                    }
                }
            }
        }
        self.heap(&loose);
    }

    /// Loose cells, the lowest first, each where it was when it came loose, come down as rubble: see `pour`.
    fn heap(&mut self, loose: &[([i32; 3], Kind)]) {
        let mut put: Map<[i32; 3], Kind> = Map::default();
        let ground = &mut self.ground;
        let mut full = |put: &Map<[i32; 3], Kind>, c: [i32; 3]| put.contains_key(&c) || ground.solid(c[0], c[1], c[2]);
        for &(at, kind) in loose {
            // Where it lay in something, the cell is on top of it.
            let mut c = at;
            let mut up = 0;
            while full(&put, c) && up < 12 {
                c[1] += 1;
                up += 1;
            }
            if full(&put, c) {
                continue;
            }
            let floor = c[1] - FALLS;
            for slide in 0..=SLIDES {
                while c[1] > floor && !full(&put, [c[0], c[1] - 1, c[2]]) {
                    c[1] -= 1;
                }
                if slide == SLIDES {
                    break;
                }
                // The four sides, begun at one that differs from cell to cell: down the first that is two lower,
                // and now and then down one that is only one lower, so a heap's foot spreads a little.
                let h = hash3(c[0], c[1], c[2], 77);
                let lazy = h >> 8 & 3 == 0;
                let mut slid = false;
                for d in 0..4 {
                    let (dx, dz) = [(1, 0), (-1, 0), (0, 1), (0, -1)][((h + d) % 4) as usize];
                    let s = [c[0] + dx, c[1], c[2] + dz];
                    if !full(&put, s) && !full(&put, [s[0], s[1] - 1, s[2]]) && (lazy || !full(&put, [s[0], s[1] - 2, s[2]])) {
                        c = [s[0], s[1] - 1, s[2]];
                        slid = true;
                        break;
                    }
                }
                if !slid {
                    break;
                }
            }
            // Dust: most of a heap is the grey of what the stuff is ground to, a bit here and there the colour it was.
            // By patches two cells across: cell by cell it was confetti.
            let d = hash3(c[0] >> 1, c[1] >> 1, c[2] >> 1, 91);
            put.insert(c, crate::kinds::RUBBLE | if d % 100 < 72 { crate::kinds::kind(material(kind), crate::kinds::grey(4 + (d >> 8) as u8 % 3)) } else { kind });
        }
        let mut cells: Vec<([i32; 3], Kind)> = put.into_iter().collect();
        cells.sort_unstable_by_key(|&(c, _)| (c[1], c[2], c[0]));
        let mut runs: Vec<Run> = Vec::new();
        for (c, kind) in cells {
            match runs.last_mut() {
                Some(r) if r.y == c[1] && r.z == c[2] && r.x1 == c[0] && r.kind == kind => r.x1 += 1,
                _ => runs.push(Run { x0: c[0], x1: c[0] + 1, y: c[1], z: c[2], kind }),
            }
        }
        self.change(runs);
    }
}

/// A piece this big that a wide box let go is taken apart as it comes loose, unless it is a tall thin thing.
const APART: usize = 24_000;
/// How far apart the middles of its parts are, in cells: a room's width, so walls and floors come down as panels.
const PART: i32 = 48;

/// A piece that came loose, as the parts that fall: itself, or, if it is big and not a tall thin thing (which goes
/// over whole), its cells shared out among middles scattered one to a box of `PART` cells.
fn parts(piece: support::Loose) -> Vec<support::Loose> {
    let size = [0, 1, 2].map(|a| piece.high[a] - piece.low[a]);
    if piece.cells < APART || size[1] >= 2 * size[0].max(size[2]) {
        return vec![piece];
    }
    let mut shares: Map<[i32; 3], support::Loose> = Map::default();
    let mut put = |x0: i32, x1: i32, r: &Run, to: [i32; 3]| {
        let part = shares.entry(to).or_insert_with(|| support::Loose { runs: Vec::new(), cells: 0, low: [i32::MAX; 3], high: [i32::MIN; 3] });
        part.runs.push(Run { x0, x1, ..*r });
        part.cells += (x1 - x0) as usize;
        part.low = [part.low[0].min(x0), part.low[1].min(r.y), part.low[2].min(r.z)];
        part.high = [part.high[0].max(x1), part.high[1].max(r.y + 1), part.high[2].max(r.z + 1)];
    };
    for r in &piece.runs {
        let (mut from, mut of) = (r.x0, nearest_middle([r.x0, r.y, r.z], PART));
        for x in r.x0 + 1..r.x1 {
            let to = nearest_middle([x, r.y, r.z], PART);
            if to != of {
                put(from, x, r, of);
                (from, of) = (x, to);
            }
        }
        put(from, r.x1, r, of);
    }
    let mut keys: Vec<[i32; 3]> = shares.keys().copied().collect();
    keys.sort_unstable();
    keys.into_iter().map(|k| shares.remove(&k).unwrap()).collect()
}

/// The nearest to a cell of middles scattered one to a box of `apart` cells: which box it is in.
fn nearest_middle(c: [i32; 3], apart: i32) -> [i32; 3] {
    let g = c.map(|v| v.div_euclid(apart));
    let (mut best, mut near) = ([0; 3], i32::MAX);
    for d in 0..27 {
        let b = [g[0] + d % 3 - 1, g[1] + d / 3 % 3 - 1, g[2] + d / 9 - 1];
        let m = [0, 1, 2].map(|a| b[a] * apart + (hash3(b[0], b[1], b[2], 31 + a as u32) % apart as u32) as i32);
        let far = (0..3).map(|a| (c[a] - m[a]).pow(2)).sum::<i32>();
        if far < near {
            (best, near) = (b, far);
        }
    }
    best
}

/// A body this big, of stuff that breaks, is looked at for what sits when it stops.
const BREAKS: usize = 600;
/// How far apart the middles of its chunks are, in cells.
const CHUNK: i32 = 24;

/// Whether a big body mostly of this breaks up where it is not held up: masonry does, steel and wood hold together.
fn brittle(material: u8) -> bool {
    matches!(material, BRICK | PLASTER | CONCRETE | ROOFING | ROCK | ASPHALT)
}

impl Bodies {
    /// Which cells of a big body that has stopped stay where it lies: for each cell of the box `lo` to `hi`, x then z
    /// then y. Two storeys of a house that stop on the walls either side of a hole would lie across it like a plank,
    /// so the body is taken as chunks a room's wall across. A chunk stays when half of its underside is on the
    /// world, or on a chunk that stays, with its middle over that. The rest are bodies again, each by itself, and
    /// come down.
    fn sitting(&mut self, body: &Body, lo: [i32; 3], hi: [i32; 3]) -> Vec<bool> {
        let size = [(hi[0] - lo[0]) as usize, (hi[1] - lo[1]) as usize, (hi[2] - lo[2]) as usize];
        let at = |x: i32, y: i32, z: i32| (x - lo[0]) as usize + size[0] * ((z - lo[2]) as usize + size[2] * (y - lo[1]) as usize);
        // Which chunk each cell is of (one more than its place in `chunks`), and what it is made of.
        let mut chunk_of = vec![0u32; size[0] * size[1] * size[2]];
        let mut kinds = vec![0 as Kind; chunk_of.len()];
        let mut of: Map<[i32; 3], u32> = Map::default();
        let mut chunks: Vec<Vec<[i32; 3]>> = Vec::new();
        for y in lo[1]..hi[1] {
            for z in lo[2]..hi[2] {
                for x in lo[0]..hi[0] {
                    let (cell, _) = body.cell_at([x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5]);
                    if !body.solid(cell) || self.ground.solid(x, y, z) {
                        continue;
                    }
                    // The nearest of middles scattered one to a box of CHUNK cells.
                    let c = [x, y, z];
                    let best = nearest_middle(c, CHUNK);
                    let next = chunks.len() as u32 + 1;
                    let id = *of.entry(best).or_insert_with(|| {
                        chunks.push(Vec::new());
                        next
                    });
                    chunk_of[at(x, y, z)] = id;
                    kinds[at(x, y, z)] = body.cells[body.at(cell[0] as usize, cell[1] as usize, cell[2] as usize)];
                    chunks[id as usize - 1].push(c);
                }
            }
        }
        // Asked again while any more are found to sit, for a chunk can sit on a chunk.
        let mut sits = vec![false; chunks.len()];
        loop {
            let mut more = false;
            for k in 0..chunks.len() {
                if sits[k] {
                    continue;
                }
                let (mut under, mut on, mut low, mut high, mut mid) = (0usize, 0usize, [i32::MAX; 2], [i32::MIN; 2], [0i64; 2]);
                for &[x, y, z] in &chunks[k] {
                    mid = [mid[0] + x as i64, mid[1] + z as i64];
                    let below = if y > lo[1] { chunk_of[at(x, y - 1, z)] } else { 0 };
                    if below == k as u32 + 1 {
                        continue;
                    }
                    under += 1;
                    if (below != 0 && sits[below as usize - 1]) || (below == 0 && self.ground.solid(x, y - 1, z)) {
                        on += 1;
                        low = [low[0].min(x), low[1].min(z)];
                        high = [high[0].max(x), high[1].max(z)];
                    }
                }
                let n = chunks[k].len() as i64;
                let mid = [(mid[0] / n) as i32, (mid[1] / n) as i32];
                if on * 2 >= under && on > 0 && mid[0] >= low[0] - 2 && mid[0] <= high[0] + 2 && mid[1] >= low[1] - 2 && mid[1] <= high[1] + 2 {
                    sits[k] = true;
                    more = true;
                }
            }
            if !more {
                break;
            }
        }
        // What does not sit is a body again, where it is, and will not be asked this twice.
        for (k, cells) in chunks.iter().enumerate() {
            if sits[k] || cells.len() < 4 {
                continue;
            }
            let (mut low, mut high) = ([i32::MAX; 3], [i32::MIN; 3]);
            for c in cells {
                for a in 0..3 {
                    low[a] = low[a].min(c[a]);
                    high[a] = high[a].max(c[a] + 1);
                }
            }
            let part = [(high[0] - low[0]) as usize, (high[1] - low[1]) as usize, (high[2] - low[2]) as usize];
            let mut grid = vec![0 as Kind; part[0] * part[1] * part[2]];
            for c in cells {
                grid[(c[0] - low[0]) as usize + part[0] * ((c[2] - low[2]) as usize + part[2] * (c[1] - low[1]) as usize)] = kinds[at(c[0], c[1], c[2])];
            }
            let mut chunk = Body::new(self.next, grid, part, low);
            self.next += 1;
            chunk.broken = 1;
            self.born(&chunk);
            self.list.push(chunk);
        }
        chunk_of.iter().map(|&k| k != 0 && sits[k as usize - 1]).collect()
    }
}

// ── The Cleave, holding and letting go, and poses put from outside (#226) ───────────────────────────────────────

impl Bodies {
    fn held(&self, id: u32) -> bool {
        self.hangs.iter().any(|h| h.0 == id) || self.orbits.iter().any(|o| o.0 == id) || self.outgoing.iter().any(|o| o.0 == id)
    }

    /// Whether `id` hangs where the Cleave lifted it.
    pub fn hang_of(&self, id: u32) -> Option<&CleaveHang> {
        self.hangs.iter().find(|h| h.0 == id).map(|h| &h.1)
    }

    /// How many bodies are held in orbit or waiting to be let go.
    pub fn captured(&self) -> usize {
        self.orbits.len() + self.outgoing.len()
    }

    fn jointed(&self, id: u32) -> bool {
        self.joints.active_count() > 0 && self.joints.joints().iter().any(|j| !j.broken && (j.body_a == id || j.body_b == id))
    }

    /// Takes the held bodies out of the list, each with where it was, in order. Holds whose bodies are gone are dropped.
    fn take_held(&mut self) -> Vec<(usize, Body)> {
        if self.hangs.is_empty() && self.orbits.is_empty() && self.outgoing.is_empty() {
            return Vec::new();
        }
        let mut ids: Vec<u32> = self.hangs.iter().map(|h| h.0).chain(self.orbits.iter().map(|o| o.0)).chain(self.outgoing.iter().map(|o| o.0)).collect();
        ids.sort_unstable();
        let mut held = Vec::new();
        let mut kept = Vec::with_capacity(self.list.len());
        for (i, b) in std::mem::take(&mut self.list).into_iter().enumerate() {
            if ids.binary_search(&b.id).is_ok() {
                held.push((i, b));
            } else {
                kept.push(b);
            }
        }
        self.list = kept;
        let mut found: Vec<u32> = held.iter().map(|(_, b)| b.id).collect();
        found.sort_unstable();
        let there = |id: &u32| found.binary_search(id).is_ok();
        self.hangs.retain(|h| there(&h.0));
        self.orbits.retain(|o| there(&o.0));
        self.outgoing.retain(|o| there(&o.0));
        held
    }

    /// Puts what `take_held` took back where it was.
    fn put_held(&mut self, held: Vec<(usize, Body)>) {
        if held.is_empty() {
            return;
        }
        for (i, b) in held {
            let at = i.min(self.list.len());
            self.list.insert(at, b);
        }
        self.broadphase_stale = true;
    }

    /// Lets go of up to `OUT` flung bodies, the outermost first.
    fn let_out(&mut self) {
        for _ in 0..OUT {
            let Some((id, vel, spin, _)) = self.outgoing.pop() else { break };
            if let Some(b) = self.list.iter_mut().find(|b| b.id == id) {
                b.vel = vel;
                b.spin = spin;
                b.asleep = false;
                b.still = 0.0;
                b.apart = 1.0;
            }
        }
    }

    /// Moves what the Cleave holds on by `real_dt` seconds of the clock on the wall (not the world's, which may be
    /// slowed): lifted off the cut over its `snap_dur`, held, then let go, sliding and tipping. What is held in orbit
    /// is carried round too. Returns how many bodies still hang. Their poses are told in `advance`'s `MOVES`.
    pub fn hang_tick(&mut self, real_dt: f32) -> usize {
        if real_dt <= 0.0 || (self.hangs.is_empty() && self.orbits.is_empty()) {
            return self.hangs.len();
        }
        let index: Map<u32, usize> = self.list.iter().enumerate().map(|(i, b)| (b.id, i)).collect();
        let mut k = 0;
        while k < self.hangs.len() {
            let (id, h) = &mut self.hangs[k];
            let Some(&i) = index.get(id) else {
                self.hangs.remove(k);
                continue;
            };
            h.elapsed += real_dt;
            let u = (h.elapsed / h.snap_dur.max(1e-4)).min(1.0);
            let e = 1.0 - (1.0 - u) * (1.0 - u) * (1.0 - u);
            let b = &mut self.list[i];
            b.pos = add(h.start_pos, scale(h.lift_vec, e));
            if h.elapsed >= h.snap_dur + h.hang_dur {
                (b.vel, b.spin, b.asleep, b.still, b.apart) = (h.release_vel, h.release_spin, false, 0.0, 1.0);
                self.hangs.remove(k);
            } else {
                (b.vel, b.spin) = ([0.0; 3], [0.0; 3]);
                k += 1;
            }
        }
        for (id, o) in &mut self.orbits {
            let Some(&i) = index.get(id) else { continue };
            o.t += real_dt;
            o.angle += real_dt * ORBIT_SPEED / o.dist.max(1.0);
            let round = add(o.center, [o.angle.cos() * o.dist, o.height, o.angle.sin() * o.dist]);
            let e = (o.t / ORBIT_EASE).min(1.0);
            let ease = e * e * (3.0 - 2.0 * e);
            let b = &mut self.list[i];
            let to = add(o.from, scale(sub(round, o.from), ease));
            b.vel = scale(sub(to, b.pos), 1.0 / real_dt);
            b.pos = to;
            b.spin = o.spin;
        }
        self.broadphase_stale = true;
        self.hangs.len()
    }

    /// Takes hold of what lies loose within `radius` of `center`, the nearest first and no more than `max_count`
    /// (nor more than `HOLD` in all): each is lifted out of the solver and carried round the middle by `hang_tick`.
    /// Living things and jointed bodies are left alone. Returns how many were taken.
    pub fn capture_orbit(&mut self, center: V, radius: f32, max_count: usize) -> usize {
        let room = HOLD.saturating_sub(self.captured()).min(max_count);
        if room == 0 || radius <= 0.0 {
            return 0;
        }
        let mut near: Vec<(f32, u32)> = Vec::new();
        for b in &self.list {
            if b.live.is_some() || b.count == 0 {
                continue;
            }
            let d = sub(b.pos, center);
            let d2 = dot(d, d);
            if d2 <= radius * radius {
                near.push((d2, b.id));
            }
        }
        near.retain(|&(_, id)| !self.held(id) && !self.jointed(id));
        near.sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        near.truncate(room);
        for &(_, id) in &near {
            let Some(i) = self.list.iter().position(|b| b.id == id) else { continue };
            // What rested on it is woken before it is taken away.
            self.wake_body_and_island(i);
            let b = &self.list[i];
            let d = sub(b.pos, center);
            let h = |seed: u32| hash3(id as i32, b.born[0], b.born[2], seed) as f32 / u32::MAX as f32 - 0.5;
            let flat = (d[0] * d[0] + d[2] * d[2]).sqrt();
            let angle = if flat > 1e-3 { d[2].atan2(d[0]) } else { h(1) * std::f32::consts::TAU };
            let orbit = CaptureOrbit {
                center,
                dist: flat.clamp(4.0, radius.max(4.0)),
                height: d[1] * 0.3,
                angle,
                from: b.pos,
                t: 0.0,
                spin: [h(2) * 4.0, h(3) * 4.0, h(4) * 4.0],
            };
            self.orbits.push((id, orbit));
        }
        near.len()
    }

    /// Flings what is held in orbit: each goes out from the middle (and along `dir`, if it is not zero) at about
    /// `speed`, a quarter of its speed round kept. They are let go `OUT` a call of `advance`, the outermost first, so
    /// they are never all in one place at once. Returns how many were flung.
    pub fn capture_fling(&mut self, dir: V, speed: f32) -> usize {
        if self.orbits.is_empty() {
            return 0;
        }
        let along = if dot(dir, dir) > 1e-12 { unit(dir) } else { [0.0; 3] };
        let index: Map<u32, usize> = self.list.iter().enumerate().map(|(i, b)| (b.id, i)).collect();
        let orbits = std::mem::take(&mut self.orbits);
        let n = orbits.len();
        for (id, o) in orbits {
            let Some(&i) = index.get(&id) else { continue };
            let b = &self.list[i];
            let h = |seed: u32| hash3(id as i32, b.born[0], b.born[1], seed) as f32 / u32::MAX as f32;
            let d = sub(b.pos, o.center);
            let flat = (d[0] * d[0] + d[2] * d[2]).sqrt();
            let out = if flat > 0.3 { [d[0] / flat, 0.0, d[2] / flat] } else { let a = h(1) * std::f32::consts::TAU; [a.cos(), 0.0, a.sin()] };
            let sp = speed * (0.6 + 0.8 * h(2));
            let mut vel = add(scale(b.vel, 0.25), scale(add(out, along), sp));
            vel[1] += sp * (0.1 + 0.3 * h(3));
            self.outgoing.push((id, vel, o.spin, dot(d, d)));
        }
        // The outermost last: `let_out` pops it first.
        self.outgoing.sort_by(|a, b| a.3.total_cmp(&b.3).then(a.0.cmp(&b.0)));
        n
    }

    /// Puts a body where it was (a rewind, resumed): its place, turn, speed and spin, awake. A hold on it is let go.
    /// Returns false if there is no such body.
    pub fn set_pose(&mut self, id: u32, pos: V, rot: Q, vel: V, spin: V) -> bool {
        let Some(i) = self.list.iter().position(|b| b.id == id) else { return false };
        let l = (rot[0] * rot[0] + rot[1] * rot[1] + rot[2] * rot[2] + rot[3] * rot[3]).sqrt();
        let rot = if l > 1e-6 { [rot[0] / l, rot[1] / l, rot[2] / l, rot[3] / l] } else { [0.0, 0.0, 0.0, 1.0] };
        let b = &mut self.list[i];
        (b.pos, b.rot, b.vel, b.spin, b.still, b.apart) = (pos, rot, vel, spin, 0.0, 1.0);
        // Its contact points are turned afresh from its turn on the next step; the joints read its inertia from it.
        b.turned.clear();
        self.hangs.retain(|h| h.0 != id);
        self.orbits.retain(|o| o.0 != id);
        self.outgoing.retain(|o| o.0 != id);
        self.wake_body_and_island(i);
        self.broadphase_stale = true;
        true
    }

    /// The Cleave: everything in the wedge of the sheet through `eye` with normal `normal`, between the ways `e1` and
    /// `e1` turned by `theta` toward `e2`, within `reach` cells, comes apart along it.
    ///
    /// Moving bodies the sheet crosses are sliced (`carve_plane`). The world is cut by a fan of samples across the
    /// wedge (no more than 0.7 cells apart, as far as `CLEAVE_REACH`): every solid cell whose middle is within `KERF`
    /// of the sheet goes (water stays), told as `EDIT` and `DUST`. Then what the cut left unheld comes loose
    /// (`support::release` in up to `CLEAVE_BOXES` boxes over the cut), and every piece above the sheet (and every
    /// sliced half above it) is lifted off the cut and held there in the air (`CleaveHang`), to be let go sliding along
    /// `slide` and tipping over its far edge. Returns how many pieces it lifted.
    pub fn cleave_wedge(&mut self, eye: V, normal: V, e1: V, e2: V, theta: f32, reach: f32, slide: V) -> usize {
        if !(theta > 0.0) || !(reach > 0.0) || dot(normal, normal) < 1e-12 || dot(e1, e1) < 1e-12 || dot(e2, e2) < 1e-12 {
            return 0;
        }
        let n = unit(normal);
        let up = if n[1] < 0.0 { scale(n, -1.0) } else { n };
        let (e1, e2) = (unit(e1), unit(e2));
        let theta = theta.min(std::f32::consts::TAU);
        let reach = reach.min(CLEAVE_REACH);
        let (ct, st) = (theta.cos(), theta.sin());
        let first = self.next;
        // Whether a point lies in the wedge, `slack` cells either side of its edges (half-planes, no angles).
        let in_wedge = |v: V, slack: f32| -> bool {
            let r = reach + slack;
            if dot(v, v) > r * r {
                return false;
            }
            let (x, y) = (dot(v, e1), dot(v, e2));
            let past_start = y >= -slack;
            let before_end = x * st - y * ct >= -slack;
            if theta <= std::f32::consts::PI { past_start && before_end } else { past_start || before_end }
        };

        // 1. Moving bodies the sheet crosses are sliced along it.
        let crossed: Vec<u32> = self
            .list
            .iter()
            .filter(|b| b.live.is_none() && b.count > 0 && !self.held(b.id))
            .filter(|b| {
                let v = sub(b.pos, eye);
                dot(n, v).abs() <= b.radius + KERF && in_wedge(v, b.radius)
            })
            .map(|b| b.id)
            .collect();
        for &id in &crossed {
            self.carve_plane(id, eye, n, KERF * 2.0);
        }

        // 2. The world: samples on rings out from the eye, each ring as many as keep them CLEAVE_STEP apart along it
        // (turned by a fixed small turn, so no sine is asked of each one), and the kerf's cells round each.
        let offsets = [-1.0f32, -0.5, 0.0, 0.5, 1.0];
        let mut cells: Vec<[i32; 3]> = Vec::new();
        let mut last = [i32::MIN; 3];
        let mut t = CLEAVE_STEP;
        while t <= reach {
            let m = ((theta * t / CLEAVE_STEP).ceil() as usize).max(1);
            let d = theta / m as f32;
            let (cd, sd) = (d.cos(), d.sin());
            let (mut c, mut si) = (1.0f32, 0.0f32);
            for _ in 0..=m {
                let dir = add(scale(e1, c), scale(e2, si));
                let p = add(eye, scale(dir, t));
                for &o in &offsets {
                    let q = add(p, scale(n, o));
                    let cell = [q[0].floor() as i32, q[1].floor() as i32, q[2].floor() as i32];
                    if cell == last {
                        continue;
                    }
                    last = cell;
                    let mid = [cell[0] as f32 + 0.5 - eye[0], cell[1] as f32 + 0.5 - eye[1], cell[2] as f32 + 0.5 - eye[2]];
                    if dot(n, mid).abs() <= KERF && self.ground.solid(cell[0], cell[1], cell[2]) {
                        cells.push(cell);
                    }
                }
                (c, si) = (c * cd - si * sd, c * sd + si * cd);
            }
            t += CLEAVE_STEP;
        }
        // In sector order, so what each is made of is asked of few sectors at a time.
        cells.sort_unstable_by_key(|c| ([c[1] >> 6, c[2] >> 6, c[0] >> 6], c[1], c[2], c[0]));
        cells.dedup();
        let mut cut: Vec<([i32; 3], Kind)> = Vec::with_capacity(cells.len());
        for c in cells {
            let kind = self.ground.kind(c[0], c[1], c[2]);
            if kind != 0 && material(kind) != WATER {
                cut.push((c, kind));
            }
        }
        let mut made = 0;
        if !cut.is_empty() {
            let (mut lo, mut hi) = ([i32::MAX; 3], [i32::MIN; 3]);
            for (c, _) in &cut {
                for a in 0..3 {
                    lo[a] = lo[a].min(c[a]);
                    hi[a] = hi[a].max(c[a] + 1);
                }
            }
            let chunks = (cut.len() / 16).clamp(1, 8);
            let per = cut.len().div_ceil(chunks);
            for chunk in cut.chunks(per) {
                let mut sum = [0.0f32; 3];
                for (c, _) in chunk {
                    sum = add(sum, [c[0] as f32 + 0.5, c[1] as f32 + 0.5, c[2] as f32 + 0.5]);
                }
                let p = scale(sum, 1.0 / chunk.len() as f32);
                self.record(DUST, &[p[0].to_bits(), p[1].to_bits(), p[2].to_bits(), chunk[0].1 as u32, chunk.len() as u32]);
            }
            let mut runs: Vec<Run> = Vec::new();
            cut.sort_unstable_by_key(|(c, _)| (c[1], c[2], c[0]));
            for (c, _) in &cut {
                match runs.last_mut() {
                    Some(r) if r.y == c[1] && r.z == c[2] && r.x1 == c[0] => r.x1 += 1,
                    _ => runs.push(Run { x0: c[0], x1: c[0] + 1, y: c[1], z: c[2], kind: 0 }),
                }
            }
            self.change(runs);

            // 3. What the cut left unheld comes loose: boxes over the cut, as few as cover it.
            let side = SETTLE[0] as i32;
            let span = |a: usize| ((hi[a] - lo[a] + 32 + side - 1) / side).max(1);
            let (nx, nz) = (span(0), span(2));
            let mut boxes = 0;
            'boxes: for bz in 0..nz {
                for bx in 0..nx {
                    if boxes >= CLEAVE_BOXES {
                        break 'boxes;
                    }
                    boxes += 1;
                    let low = [lo[0] - 16 + bx * side, lo[1] - 48, lo[2] - 16 + bz * side];
                    let size = [SETTLE[0], SETTLE[1], SETTLE[2]];
                    let top = [low[0] + side, low[1] + SETTLE[1] as i32, low[2] + SETTLE[2] as i32];
                    self.wake_in_aabb(low.map(|v| v as f32 - 2.0), top.map(|v| v as f32 + 2.0));
                    let mut region = self.ground.region(low, size);
                    let (pieces, dust) = support::release(&mut region, None);
                    made += self.take(pieces, dust, None, usize::MAX);
                }
            }
        }
        let _ = made;

        // 4. Every piece above the sheet that this cut made is lifted off it and held, every one by the same amount.
        let upper: Vec<usize> = (0..self.list.len())
            .filter(|&i| {
                let b = &self.list[i];
                (b.id >= first || crossed.contains(&b.id)) && b.live.is_none() && dot(up, sub(b.pos, eye)) > 0.0
            })
            .collect();
        if upper.is_empty() {
            return 0;
        }
        let slide = if dot(slide, slide) > 1e-12 {
            unit(slide)
        } else {
            // Down the sheet if it slopes; along the stroke if it lies flat.
            let down = add([0.0, -1.0, 0.0], scale(up, up[1]));
            if dot(down, down) > 0.09 { unit(down) } else { unit(sub(add(scale(e1, ct), scale(e2, st)), e1)) }
        };
        // Straight off the cut, never down; a steep cut parts its halves by less.
        let lift_dir = unit([up[0], up[1].max(0.0), up[2]]);
        let lift = scale(lift_dir, CLEAVE_LIFT * (0.35 + 0.65 * up[1].abs()));
        // It turns as one about the middle of what lies on the cut, tipping over toward the slide.
        let near_cut: Vec<V> = upper.iter().map(|&i| self.list[i].pos).filter(|p| dot(up, sub(*p, eye)) < 12.0).collect();
        let pool: Vec<V> = if near_cut.is_empty() { upper.iter().map(|&i| self.list[i].pos).collect() } else { near_cut };
        let pivot = scale(pool.iter().fold([0.0; 3], |s, p| add(s, *p)), 1.0 / pool.len() as f32);
        let spin = scale(cross(up, slide), CLEAVE_TIP);
        let mut hung = 0;
        for &i in &upper {
            let b = &mut self.list[i];
            let r = sub(b.pos, pivot);
            let mut vel = add(scale(slide, CLEAVE_SLIDE), cross(spin, r));
            vel[1] += CLEAVE_HOP;
            (b.vel, b.spin, b.asleep, b.still) = ([0.0; 3], [0.0; 3], false, 0.0);
            let hang = CleaveHang::new(b.pos, lift, vel, spin);
            let id = b.id;
            self.hangs.retain(|h| h.0 != id);
            self.hangs.push((id, hang));
            hung += 1;
        }
        hung
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
    /// The box of rows of finer cells that end at the last whole number: its high corner is past its low one.
    #[test]
    fn the_box_of_fine_rows_at_the_end_of_the_numbers() {
        let edits = crate::read_edits(&[3, 1, 2147483646, 2147483647, 0, 0, 0x0509, 4, 1, i32::MIN, i32::MIN + 9, i32::MAX, i32::MIN, 1]);
        assert_eq!(super::reach(&edits[0]), ([536870911, 0, 0], [536870912, 1, 1]));
        assert_eq!(super::reach(&edits[1]), ([-268435456, 268435455, -268435456], [-268435454, 268435456, -268435455]));
    }

    use super::*;
    use crate::kinds::{BRICK, CONCRETE, OWN, kind};

    /// A street: flat, hard, nothing over it.
    const X: i32 = 700;
    const Z: i32 = 4070;

    fn block(size: [usize; 3], k: Kind) -> Vec<Kind> {
        vec![k; size[0] * size[1] * size[2]]
    }

    fn has_record(out: &[u32], tag: u32, id: u32) -> bool {
        let mut i = 0;
        while i < out.len() {
            if out[i] == tag && out[i + 2] == id { return true; }
            i += 2 + out[i + 1] as usize;
        }
        false
    }

    #[test]
    fn car_survives_oblique_wall_scrape_and_moderate_bump() {
        for glance in [true, false] {
            let mut bodies = Bodies::new();
            let low = living::tests::level(&mut bodies);
            if glance {
                let z = low[2] + 22;
                let wall: Vec<Run> = (2400..2432).map(|y|
                    Run { x0: low[0] - 20, x1: low[0] + 200, y, z, kind: kind(crate::kinds::STEEL, OWN) }).collect();
                bodies.ground.push(Edit::Runs(wall), false, None);
            } else {
                living::tests::car(&mut bodies, [low[0] + 52, low[1], low[2]]);
            }
            let id = living::tests::car(&mut bodies, low);
            // 76 km/h oblique scrape, or a 54 km/h bump into another car that can give way.
            bodies.kick(id, if glance { [195.0, 0.0, 80.0] } else { [150.0, 0.0, 0.0] });
            let out = living::tests::run(&mut bodies, 0.25, id, [1.0, 0.0, 0.0]);
            assert!(has_record(&out, STRUCK, id) || (!glance && has_record(&out, STRUCK, 1)), "collision must be told");
            assert!(!has_record(&out, BROKE, id));
            let b = living::tests::the(&bodies, id);
            eprintln!("glance={glance}: velocity={:?}, wear={}, jolt={}", b.vel, b.wear, b.live.as_ref().unwrap().jolt);
            assert!(b.live.is_some() && b.wear < 1.0);
            assert!(b.wear > 0.0, "a substantial bump consumes some chassis integrity");
            if glance { assert!(b.vel[0] > 160.0, "a glance keeps forward momentum: {:?}", b.vel); }
            assert!(bodies.drive(id, -1.0, 0.5, 0.0, false, false), "still drivable");
        }
    }

    #[test]
    fn chassis_wear_accumulates_but_curb_chatter_does_not() {
        let mut b = Body::new(1, block([4, 4, 4], kind(crate::kinds::STEEL, OWN)), [4, 4, 4], [0; 3]);
        for _ in 0..1000 { assert!(!b.crumple(30.0, 120.0)); }
        assert_eq!(b.wear, 0.0);
        assert!(!b.crumple(125.0, 120.0), "one blow above the former binary threshold is survivable");
        let mut failed = false;
        for _ in 0..10 { failed |= b.crumple(125.0, 120.0); }
        assert!(failed && b.wear == 1.0, "repeated severe blows exhaust the chassis");
        b.wear = 0.0;
        assert!(b.crumple(145.0, 120.0), "a catastrophic blow fails a fresh chassis");
    }

    #[test]
    fn repeated_survivable_collisions_eventually_break_the_chassis() {
        let mut bodies = Bodies::new();
        let low = living::tests::level(&mut bodies);
        let id = living::tests::car(&mut bodies, low);
        let origin = living::tests::the(&bodies, id).pos;
        let mut previous = 0.0;
        for hit in 0..20 {
            let x = low[0] + 50;
            let wall: Vec<Run> = (2400..2432).flat_map(|y| (low[2] - 8..low[2] + 30)
                .map(move |z| Run { x0: x, x1: x + 2, y, z, kind: kind(crate::kinds::STEEL, OWN) })).collect();
            bodies.ground.push(Edit::Runs(wall), false, None);
            assert!(bodies.place(id, origin, [0.0, 0.0, 0.0, 1.0]));
            bodies.kick(id, [100.0, 0.0, 0.0]);
            let out = living::tests::run(&mut bodies, 0.25, id, [1.0, 0.0, 0.0]);
            if has_record(&out, BROKE, id) {
                assert!(hit > 0, "a fresh chassis survives this blow");
                return;
            }
            let b = living::tests::the(&bodies, id);
            assert!(b.wear > previous && b.live.as_ref().unwrap().jolt < 144.0);
            previous = b.wear;
        }
        panic!("repeated collisions never exhausted chassis integrity");
    }

    #[test]
    fn overturned_car_recovers_onto_wheels_with_steering_input() {
        let mut bodies = Bodies::new();
        let low = living::tests::level(&mut bodies);
        let id = living::tests::car(&mut bodies, low);
        let pos = living::tests::the(&bodies, id).pos;
        // Flip the car completely upside down (180 degrees around X) resting on the road.
        assert!(bodies.place(id, [pos[0], low[1] as f32 + 5.5, pos[2]], [1.0, 0.0, 0.0, 0.0]));
        let _ = living::tests::run(&mut bodies, 0.5, id, [0.0, 0.0, 0.0]);
        let before_up = turn(living::tests::the(&bodies, id).rot, [0.0, 1.0, 0.0])[1];
        assert!(before_up < -0.5, "car should start resting upside down (up.y={before_up})");
        // Steer to right the overturned car.
        let _ = living::tests::run(&mut bodies, 2.5, id, [0.0, 1.0, 0.0]);
        let after = living::tests::the(&bodies, id);
        let after_up = turn(after.rot, [0.0, 1.0, 0.0])[1];
        assert!(after_up > 0.85, "overturned car must roll back onto its wheels when steered (up.y={after_up})");
        assert!(after.live.as_ref().unwrap().on >= 2, "recovered car should land on its wheels");
    }

    #[test]
    fn shattered_vehicle_shards_pass_to_dust_and_extinguish_lamps() {
        let mut bodies = Bodies::new();
        let low = living::tests::level(&mut bodies);
        let id = living::tests::car(&mut bodies, low);
        // Put glowing headlight LAMP voxels on the car chassis before shattering.
        let idx = bodies.list.iter().position(|b| b.id == id).unwrap();
        let mut lit = 0;
        for cell in &mut bodies.list[idx].cells {
            if *cell != 0 && lit < 8 {
                *cell = kind(crate::kinds::LAMP, OWN);
                lit += 1;
            }
        }
        let edits_before = bodies.ground.edits.len();
        let whole = bodies.list.remove(idx);
        bodies.shatter(whole);
        assert!(!bodies.list.is_empty(), "shattered vehicle should spawn tumbling shards");
        for shard in &bodies.list {
            assert!(shard.passing, "vehicle wreck shards must be marked passing so they never bake into roads");
            assert!(
                !shard.cells.iter().any(|&c| material(c) == crate::kinds::LAMP),
                "vehicle wreck shards must extinguish LAMP voxels"
            );
        }
        // Advance until all shards come to rest and verify zero permanent road edits were baked.
        for _ in 0..400 {
            bodies.advance(0.05);
            if bodies.list.is_empty() {
                break;
            }
        }
        assert!(bodies.list.is_empty(), "passing vehicle shards should settle into dust and clear");
        assert_eq!(
            bodies.ground.edits.len(),
            edits_before,
            "shattered vehicle shards must not bake static voxel debris into the road"
        );
    }

    #[test]
    fn crash_fragments_have_bounded_points_and_small_debris_becomes_dust() {
        let mut bodies = Bodies::new();
        let low = living::tests::level(&mut bodies);
        let id = living::tests::car(&mut bodies, low);
        let whole = bodies.list.pop().unwrap();
        bodies.shatter(whole);
        assert!(has_record(&bodies.out, BROKE, id));
        assert!(bodies.list.iter().all(|b| b.points.len() <= 48 && (b.count >= 80 || b.lump)));
        while bodies.list.len() < DEBRIS {
            bodies.list.push(Body::new(bodies.next, block([4, 4, 4], kind(BRICK, OWN)), [4, 4, 4], low));
            bodies.next += 1;
        }
        let whole = Body::new(bodies.next, block([5, 5, 5], kind(BRICK, OWN)), [5, 5, 5], low);
        bodies.out.clear();
        bodies.shatter(whole);
        assert_eq!(bodies.list.len(), DEBRIS, "small pieces do not expand a crowded debris field");
        assert!(bodies.out.windows(2).any(|w| w == [DUST, 5]));
    }

    #[test]
    fn crush_release_reaches_above_impact_and_respects_total_fragment_budget() {
        let mut bodies = Bodies::new();
        // A floating brick block entirely above the hit. A short box with the old -48 y offset misses it.
        let at = [760, 2410, 4055];
        let rows: Vec<Run> = (at[1]..at[1] + 5).flat_map(|y| (at[2] - 4..at[2] + 5)
            .map(move |z| Run { x0: at[0] - 4, x1: at[0] + 5, y, z, kind: kind(BRICK, OWN) })).collect();
        bodies.ground.push(Edit::Runs(rows), false, None);
        bodies.crush(at, 9000.0, true); // radius two, smallest support scan
        assert!(!bodies.ground.solid(at[0], at[1] + 4, at[2]), "unsupported brick above the crater releases");
        assert!(bodies.list.len() <= CRASH_LUMPS);
        assert!(bodies.list.iter().all(|b| b.points.len() <= LUMP_POINTS && (b.count >= 40 || b.passing)));
    }

    #[test]
    fn crush_severing_tall_street_tree_releases_upper_trunk_and_canopy() {
        let mut bodies = Bodies::new();
        // Ground slab at y = 2400 with a 10 m tall street tree (trunk y = 2401..2475, canopy y = 2470..2500).
        let cx = 760;
        let cz = 4055;
        let mut rows: Vec<Run> = Vec::new();
        for z in cz - 20..=cz + 20 {
            rows.push(Run { x0: cx - 20, x1: cx + 21, y: 2400, z, kind: kind(CONCRETE, OWN) });
        }
        for y in 2401..2476 {
            for z in cz - 1..=cz + 1 {
                rows.push(Run { x0: cx - 1, x1: cx + 2, y, z, kind: kind(WOOD, OWN) });
            }
        }
        for y in 2470..2500 {
            for z in cz - 8..=cz + 8 {
                rows.push(Run { x0: cx - 8, x1: cx + 9, y, z, kind: kind(LEAVES, OWN) });
            }
        }
        bodies.ground.push(Edit::Runs(rows), false, None);
        // Vehicle hits the base of the trunk at y = 2410.
        bodies.crush([cx, 2410, cz], 500_000.0, true);
        assert!(!bodies.ground.solid(cx, 2450, cz), "severed upper tree trunk must not remain floating in mid-air");
        assert!(!bodies.ground.solid(cx, 2485, cz), "severed tree canopy must not remain floating in mid-air");
        assert!(bodies.list.len() <= CRASH_LUMPS);
    }

    /// Run alone on the target machine: cargo test --release car_crash_step_time -- --ignored --nocapture.
    /// Wall rebuilds/spawns are outside the timer; every advance, including collision and settlement, is inside.
    #[test]
    #[ignore = "wall-clock budget: run alone, not beside the rest of the suite"]
    fn car_crash_step_time_stays_within_60fps_budget() {
        let mut bodies = Bodies::new();
        let low = living::tests::level(&mut bodies);
        let mut times = Vec::new();
        let (mut peak, mut hits, mut broken) = (0, 0, 0);
        for crash in 0..12 {
            let x = low[0] + 110;
            let wall: Vec<Run> = (2399..2432).flat_map(|y| (low[2] - 8..low[2] + 30)
                .map(move |z| Run { x0: x, x1: x + 2, y, z, kind: kind(BRICK, OWN) })).collect();
            bodies.ground.push(Edit::Runs(wall), false, None);
            if crash % 2 == 1 {
                living::tests::car(&mut bodies, [low[0] + 60, low[1], low[2]]);
            }
            let id = living::tests::car(&mut bodies, low);
            bodies.kick(id, [if crash % 3 == 0 { 110.0 } else { 220.0 }, 0.0, 0.0]);
            for _ in 0..90 {
                bodies.drive(id, 1.0, 0.0, 0.0, false, false);
                bodies.out.clear();
                let start = std::time::Instant::now();
                bodies.advance(1.0 / 60.0);
                times.push(start.elapsed().as_secs_f64() * 1000.0);
                peak = peak.max(bodies.list.len());
                let mut i = 0;
                while i < bodies.out.len() {
                    hits += (bodies.out[i] == STRUCK) as usize;
                    broken += (bodies.out[i] == BROKE) as usize;
                    i += 2 + bodies.out[i + 1] as usize;
                }
            }
            bodies.vanish(id);
        }
        times.sort_by(f64::total_cmp);
        let (p50, p95, max) = (times[times.len() / 2], times[times.len() * 95 / 100], times[times.len() - 1]);
        eprintln!("crash advance ms p50={p50:.3} p95={p95:.3} max={max:.3}; peak bodies={peak}, hits={hits}, broke={broken}, crushes={}", bodies.crushes);
        assert!(hits >= 12 && broken > 0 && bodies.crushes > 0, "must exercise collisions and destruction");
        assert!(peak <= 128, "pileup has {peak} bodies");
        assert!(p95 < 5.0 && max < 16.0, "crash advance exceeded the 60 FPS budget");
    }

    /// A sector all of one kind is still there to read when 4,096 others have been asked about since the last
    /// clearing out: the clearing out dropped the very sector that was being read (#264).
    #[test]
    fn a_sector_asked_for_after_thousands_is_read() {
        let mut b = Bodies::new();
        for i in 0..4200 {
            assert_eq!(b.ground.kind(X + i * 64, 60_000, Z), 0);
        }
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

    /// A wall of brick six metres long that stops leaning a third of the way over lies as a heap: nothing under any
    /// cell of it is empty, no side of it is steeper than one in one, and little of it is lost.
    #[test]
    fn masonry_that_stops_askew_lies_as_a_heap() {
        use std::time::Instant;
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let size = [60, 30, 6];
        let mut wall = Body::new(1, block(size, kind(BRICK, OWN)), size, [X - 30, ground + 1, Z]);
        // Turned about its length, and a little about the way up, with its lowest corner on the street.
        let (a, b) = (0.3f32, 0.1f32);
        wall.rot = [a.sin(), b.sin(), 0.0, a.cos() * b.cos()];
        let l = wall.rot.iter().map(|v| v * v).sum::<f32>().sqrt();
        wall.rot = wall.rot.map(|v| v / l);
        let low = (0..8).map(|d| add(wall.pos, turn(wall.rot, sub([if d & 1 == 0 { 0.0 } else { 60.0 }, if d & 2 == 0 { 0.0 } else { 30.0 }, if d & 4 == 0 { 0.0 } else { 6.0 }], wall.com)))[1]).fold(f32::MAX, f32::min);
        wall.pos[1] += (ground + 1) as f32 - low;
        // It has been looked at for what sits (`sitting`) already: this is what did.
        wall.broken = 1;
        let t0 = Instant::now();
        bodies.rest(wall);
        let ms = t0.elapsed().as_secs_f32() * 1000.0;
        let (mut top, mut cells): (Map<[i32; 2], i32>, i32) = (Map::default(), 0);
        let (mut i, out) = (0, bodies.out.clone());
        while i < out.len() {
            let (tag, n) = (out[i], out[i + 1] as usize);
            if tag == EDIT {
                for r in out[i + 8..i + 2 + n].chunks_exact(5) {
                    for x in r[0] as i32..r[1] as i32 {
                        let (y, z) = (r[2] as i32, r[3] as i32);
                        cells += 1;
                        let t = top.entry([x, z]).or_insert(i32::MIN);
                        *t = (*t).max(y);
                        assert!(bodies.ground.solid(x, y - 1, z), "a cell of the heap at {x}, {y}, {z} has nothing under it");
                    }
                }
            }
            i += 2 + n;
        }
        let high = top.values().max().unwrap() - ground;
        eprintln!("{cells} cells of {} lie over {} columns, the highest {high} over the street, put down in {ms:.1} ms", 60 * 30 * 6, top.len());
        assert!(cells as f32 > 60.0 * 30.0 * 6.0 * 0.9 && (cells as f32) < 60.0 * 30.0 * 6.0 * 1.1, "{cells} cells of {} lie down", 60 * 30 * 6);
        assert!(high < 20, "a wall three metres high lying as rubble is a heap {high} cells high");
        let steep = top.iter().filter(|&(&[x, z], &y)| [[1, 0], [-1, 0], [0, 1], [0, -1]].iter().any(|d| y - top.get(&[x + d[0], z + d[1]]).copied().unwrap_or_else(|| city::ground(x + d[0], z + d[1])) > 2)).count();
        assert_eq!(steep, 0, "{steep} of {} columns stand more than two cells over the one beside them", top.len());
        // About 10 ms by itself. Beside the page checks, which share the machine, it has taken 50: the bound is for a
        // rule gone wrong (every cell asking the world hundreds of times), not for a busy machine.
        assert!(ms < 250.0, "putting it down took {ms:.1} ms");
    }

    /// A heap is loose: a stub of wall that touches its side, with nothing under it, is not held up by it.
    #[test]
    fn a_heap_holds_up_nothing_beside_it() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        // A heap: a block of brick eight cells each way, poured where it stands.
        let loose: Vec<([i32; 3], Kind)> = (1..=8).flat_map(|y| (0..8).flat_map(move |z| (0..8).map(move |x| ([X + x, ground + y, Z + z], kind(BRICK, OWN))))).collect();
        bodies.heap(&loose);
        bodies.out.clear();
        // A place on its side where a cell of it has air beside it and under that air: a step two cells high.
        let (x, y) = (1..12).rev().flat_map(|y| (0..40).map(move |x| (x, y))).find(|&(x, y)| {
            let g = &mut bodies.ground;
            g.solid(X + x - 1, ground + y, Z + 4) && !g.solid(X + x, ground + y, Z + 4) && !g.solid(X + x, ground + y - 1, Z + 4) && (0..4).all(|k| !g.solid(X + x + k, ground + y - 1, Z + 4) && !g.solid(X + x + k, ground + y, Z + 4))
        }).expect("the heap has a step on its side");
        // The stub: four cells of brick out from that cell, level, with nothing under any of them.
        bodies.change(vec![Run { x0: X + x, x1: X + x + 4, y: ground + y, z: Z + 4, kind: kind(BRICK, OWN) }]);
        let made = bodies.release([X + x + 2, ground + y, Z + 4], 4);
        let left = (0..4).filter(|&k| bodies.ground.solid(X + x + k, ground + y, Z + 4)).count();
        eprintln!("a stub at {x}, {y} over the street: release made {made} bodies and left {left} of its four cells in the air");
        assert_eq!(left, 0, "{left} cells of a stub beside a heap, with nothing under them, stay in the air");
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
        // The second, landing from three metres, chips the first: lumps of it are thrown and lie about.
        let lying: i32 = put.iter().map(|r| if r.kind == 0 { -(r.x1 - r.x0) } else { r.x1 - r.x0 }).sum();
        assert!((lying - 800).abs() <= 40, "about as many cells lie as fell ({lying} of 800; {cells} rows' worth told)");
        // The street climbs a tread under the first, so heights are told from where it lies.
        let (low, top) = (put.iter().map(|r| r.y).min().unwrap(), put.iter().filter(|r| r.kind != 0).map(|r| r.y).max().unwrap());
        assert!(low <= ground + 2, "the first lies on the street");
        assert!(top >= low + 5 && top <= low + 9, "the second lies on the first (its top is {} cells over the first's foot)", top - low);
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
    fn a_water_tower_with_two_legs_cut_goes_over() {
        use crate::city::{BLOCK_X, BLOCK_Z, YARD, YARD_TOWER};
        let (x, z) = (YARD.0 * BLOCK_X + YARD_TOWER.0, YARD.1 * BLOCK_Z + YARD_TOWER.1);
        let g = city::ground(x, z);
        let mut bodies = Bodies::new();
        // Untouched, nothing comes loose.
        let made = bodies.release([x, g + 10, z], 0);
        assert_eq!(made, 0, "the tower stands by itself: {:?}", bodies.list.iter().map(|b| (b.count, b.size, [b.born[0] - x, b.born[1] - g, b.born[2] - z], b.stuff)).collect::<Vec<_>>());
        // The two legs on its low-x side are cut through near the ground.
        for dz in [-19, 19] {
            // Steel gives a quarter as far as the blast is wide: this cuts a leg two cells thick.
            bodies.blast([x - 19, g + 12, z + dz], 14, None, false);
        }
        let big = bodies.list.iter().map(|b| b.count).max().unwrap_or(0);
        assert!(big > 8000, "the tank, its platform and what is left of the legs came loose as one body ({big} cells)");
        let put = run(&mut bodies, 16.0);
        assert!(bodies.list.is_empty(), "{} bodies never came to rest", bodies.list.len());
        let top = put.iter().filter(|r| r.kind != 0).map(|r| r.y).max().unwrap();
        assert!(top < g + 100, "the tank is down (the highest cell put back is {} over the ground; it stood 170)", top - g);
    }

    #[test]
    fn a_chimney_with_its_foot_blown_out_on_one_side_goes_over() {
        use crate::city::{BLOCK_X, BLOCK_Z, YARD, YARD_CHIMNEY};
        let (x, z) = (YARD.0 * BLOCK_X + YARD_CHIMNEY.0, YARD.1 * BLOCK_Z + YARD_CHIMNEY.1);
        let g = city::ground(x, z);
        let mut bodies = Bodies::new();
        bodies.blast([x + 6, g + 10, z], 18, None, false);
        let big = bodies.list.iter().map(|b| b.count).max().unwrap_or(0);
        assert!(big > 5000, "the chimney came loose as one body ({big} cells)");
        let put = run(&mut bodies, 16.0);
        assert!(bodies.list.is_empty(), "{} bodies never came to rest", bodies.list.len());
        // Where it stood nothing is put back high up (a lump thrown by the blast may land on a roof down the street).
        let top = put.iter().filter(|r| r.kind != 0 && (r.x0 - x).abs() < 12 && (r.z - z).abs() < 12).map(|r| r.y).max().unwrap_or(g);
        assert!(top < g + 60, "the chimney lies down (the highest cell put back where it stood is {} over the ground; it stood 178)", top - g);
        let far = put.iter().filter(|r| r.kind != 0).map(|r| ((r.x0 - x).abs()).max((r.z - z).abs())).max().unwrap();
        assert!(far > 60, "it lies along the ground: cells are put back {far} cells from where it stood");
    }

    #[test]
    fn what_the_solver_keeps_is_the_world() {
        // Charges with fire along a row of houses, and what they bring down left to fall for a while: then every
        // sector the solver keeps (as cells, as bits, in blocks) must be what the rules and all the edits make.
        use crate::city::{BLOCK_X, BLOCK_Z, Block, block as what};
        let (bx, bz) = (-12..12).flat_map(|bz| (-12..12).map(move |bx| (bx, bz))).find(|&(bx, bz)| what(bx, bz) == Block::Homes && city::ground(bx * BLOCK_X + 500, bz * BLOCK_Z + 150) > 80).unwrap();
        let (x, z) = (bx * BLOCK_X + 140 + 76 * 4 + 38, bz * BLOCK_Z + 150);
        let mut bodies = Bodies::new();
        for k in 0..3 {
            bodies.blast([x - 60 + k * 60, city::ground(x, z) + 15, z + 10 + k * 25], 32, None, true);
            for _ in 0..90 { bodies.out.clear(); bodies.advance(1.0 / 60.0) }
        }
        for _ in 0..240 { bodies.out.clear(); bodies.advance(1.0 / 60.0) }
        let ground = &mut bodies.ground;
        let mut fresh = Scratch::new();
        let (mut cells, mut bits) = (0, 0);
        let keys: Vec<[i32; 3]> = ground.kept.keys().copied().collect();
        assert!(keys.len() > 40, "{} sectors are kept", keys.len());
        for key in keys {
            crate::fill(&mut fresh, key[0], key[1], key[2], 0, &ground.edits);
            match &ground.kept[&key].0 {
                Kept::Same(kind) => assert!(fresh.cells.iter().all(|k| k == kind), "the sector {key:?} is kept as all {kind} and is not"),
                Kept::Cells(kept) => {
                    let wrong = (0..CELLS).filter(|&i| kept[i] != fresh.cells[i]).count();
                    assert_eq!(wrong, 0, "{wrong} cells of the sector {key:?} are not kept as they are");
                    cells += 1;
                }
            }
            if let Some(Sector::Bits(solid, fuel, coarse)) = ground.sectors.get(&key).map(|&slot| &ground.slots[slot as usize]) {
                let mut count = [0u8; BLOCKS];
                for (i, &k) in fresh.cells.iter().enumerate() {
                    assert_eq!(solid[i >> 6] >> (i & 63) & 1 != 0, k != 0, "the sector {key:?}: a cell's solid bit");
                    assert_eq!(fuel[i >> 6] >> (i & 63) & 1 != 0, k != 0 && burns(material(k)).0 != 0, "the sector {key:?}: a cell's fuel bit");
                    let built = k != 0 && !support::is_ground(k);
                    assert_eq!(coarse.built[i >> 6] >> (i & 63) & 1 != 0, built, "the sector {key:?}: a cell's built bit");
                    count[Coarse::block(i)] += built as u8;
                }
                assert!(count == coarse.count, "the sector {key:?}: its blocks' counts");
                bits += 1;
            }
        }
        assert!(cells > 10 && bits > 10, "{cells} sectors kept as cells and {bits} as bits were looked at");
    }

    #[test]
    fn a_house_with_its_walls_charged_comes_down_and_the_one_two_doors_off_stands() {
        // A house in a row, 7.6 m wide and about 19 m deep: charges at the feet of both its side walls, from the front
        // back. The box round each charge is 16 m across and takes its own sides for ground, so by that alone the
        // storeys above stand on the neighbours; asked again in a wide box they come down.
        use crate::city::{BLOCK_X, BLOCK_Z, Block, block as what};
        let (bx, bz) = (-12..12).flat_map(|bz| (-12..12).map(move |bx| (bx, bz))).find(|&(bx, bz)| what(bx, bz) == Block::Homes && city::ground(bx * BLOCK_X + 500, bz * BLOCK_Z + 150) > 80).unwrap();
        let (x, z) = (bx * BLOCK_X + 140 + 76 * 4 + 38, bz * BLOCK_Z + 150);
        let ground = city::ground(x, z);
        let mut bodies = Bodies::new();
        // What is built 3.5 m or more over the street in a lot: `lot` is how many lots along from the one charged.
        let up = |bodies: &mut Bodies, lot: i32| {
            let r = bodies.ground.region([x - 38 + lot * 76, ground + 35, z - 10], [76, 140, 220]);
            r.cells.iter().filter(|&&k| k != 0 && !support::is_ground(k)).count()
        };
        let before = [up(&mut bodies, 0), up(&mut bodies, 2)];
        for dz in [20, 70, 120, 170] {
            for dx in [-38, 38] {
                bodies.blast([x + dx, ground + 15, z + dz], 32, None, false);
                for _ in 0..30 { bodies.out.clear(); bodies.advance(1.0 / 60.0) }
            }
        }
        let mut t = 0.0;
        while bodies.busy() > 0 && t < 60.0 { bodies.out.clear(); bodies.advance(1.0 / 60.0); t += 1.0 / 60.0 }
        assert_eq!(bodies.busy(), 0, "bodies still move after a minute");
        let after = [up(&mut bodies, 0), up(&mut bodies, 2)];
        // Its front and back walls stay: the neighbours' walls hold them, within three metres either side.
        assert!(after[0] * 2 < before[0], "of {} cells built over the charged house's ground floor {} still are", before[0], after[0]);
        assert!(after[1] * 100 > before[1] * 97, "of {} cells built over the ground floor two doors off {} still are", before[1], after[1]);
    }

    #[test]
    fn what_goes_up_when_hit_sets_off_the_next() {
        // Three drums of the kind that goes up, put on the street by an edit, 2.5 m apart along a house front. A
        // charge catches the first and no other. Each goes off a moment after it is caught, and catches the next.
        use crate::city::{BLOCK_X, BLOCK_Z, Block, block as what};
        use crate::kinds::{CHARGED, STEEL, colour, kind};
        let (bx, bz) = (-12..12).flat_map(|bz| (-12..12).map(move |bx| (bx, bz))).find(|&(bx, bz)| what(bx, bz) == Block::Homes && city::ground(bx * BLOCK_X + 500, bz * BLOCK_Z + 150) > 80).unwrap();
        let (x, z) = (bx * BLOCK_X + 140 + 76 * 4 + 38, bz * BLOCK_Z + 150 - 30);
        let y = (0..3).map(|k| city::ground(x + 25 * k, z)).max().unwrap() + 6;
        let mut bodies = Bodies::new();
        let drums: Vec<[i32; 3]> = (0..3).map(|k| [x + 25 * k, y, z]).collect();
        for at in &drums {
            bodies.ground.push(Edit::Ball { centre: *at, radius: 4, kind: kind(STEEL, colour(0, 4)) | CHARGED }, false, None);
        }
        let left = |bodies: &mut Bodies, at: [i32; 3]| bodies.ground.region(at.map(|c| c - 4), [9; 3]).cells.iter().filter(|&&k| charged(k)).count();
        assert!(drums.iter().all(|at| left(&mut bodies, *at) > 200), "the drums are there");
        let wall = |bodies: &mut Bodies| bodies.ground.region([x - 20, y, z + 20], [110, 30, 30]).cells.iter().filter(|&&k| k != 0 && !crate::kinds::rubble(k)).count();
        let wall_before = wall(&mut bodies);
        // A charge of 12, 10 cells short of the first drum: the second is 35 off.
        let bursts = |bodies: &Bodies| { let (mut n, mut i) = (0, 0); while i < bodies.out.len() { n += (bodies.out[i] == BURST) as usize; i += 2 + bodies.out[i + 1] as usize } n };
        bodies.blast([x - 10, y, z], 12, None, false);
        assert_eq!(bursts(&bodies), 0, "nothing goes off in the same breath as the charge");
        assert_eq!([left(&mut bodies, drums[0]) > 0, left(&mut bodies, drums[1]) > 200, left(&mut bodies, drums[2]) > 200], [false, true, true], "the first drum is gone and the others stand");
        // When each went off, in sixtieths of a second.
        let mut went: Vec<i32> = Vec::new();
        for tick in 0..150 {
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            for _ in 0..bursts(&bodies) { went.push(tick) }
        }
        assert_eq!(went.len(), 3, "three drums went off, at {went:?}");
        assert!(went[0] >= 6 && went.windows(2).all(|w| w[1] - w[0] >= 6), "each a moment after the last: {went:?}");
        assert!(drums.iter().all(|at| left(&mut bodies, *at) == 0), "no drum is left");
        let wall_after = wall(&mut bodies);
        assert!(wall_after + 500 < wall_before, "the house front beside them is broken into: {wall_before} cells before, {wall_after} after");
        let mut t = 0.0;
        while bodies.busy() > 0 && t < 40.0 { bodies.out.clear(); bodies.advance(1.0 / 60.0); t += 1.0 / 60.0 }
        assert_eq!(bodies.busy(), 0, "all is at rest");
    }

    /// Not a check: how long the solver's calls take when big charges go off along a row of houses. `cargo test --release big_charges -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn big_charges_timed() {
        use crate::city::{BLOCK_X, BLOCK_Z, Block, block as what};
        use std::time::Instant;
        let (bx, bz) = (-12..12).flat_map(|bz| (-12..12).map(move |bx| (bx, bz))).find(|&(bx, bz)| what(bx, bz) == Block::Homes && city::ground(bx * BLOCK_X + 500, bz * BLOCK_Z + 150) > 80).unwrap();
        let (x, z) = (bx * BLOCK_X + 140 + 76 * 4 + 38, bz * BLOCK_Z + 150);
        let mut bodies = Bodies::new();
        let mut t = 0.0f32;
        let mut worst = (0.0f32, 0usize, 0.0f32);
        for k in 0..5 {
            let at = [x - 150 + k * 76, city::ground(x, z) + 20, z + 20];
            let t0 = Instant::now();
            let made = bodies.blast(at, 40, None, false);
            eprintln!("{t:5.1} s: blast {k} made {made} bodies in {:.0} ms; {} moving", t0.elapsed().as_secs_f32() * 1000.0, bodies.list.len());
            for _ in 0..54 {
                bodies.out.clear();
                let (n, t0) = (bodies.list.len(), Instant::now());
                bodies.advance(1.0 / 60.0);
                let ms = t0.elapsed().as_secs_f32() * 1000.0;
                if ms > worst.0 { worst = (ms, n, t) }
                if ms > 30.0 { eprintln!("{t:5.1} s: a call took {ms:.0} ms with {n} bodies ({} cells), {} points tried, {} pair points, {} crushes, {} put down", bodies.list.iter().map(|b| b.count).sum::<usize>(), bodies.tried, bodies.paired, bodies.crushes, bodies.rested.len()) }
                t += 1.0 / 60.0;
            }
        }
        while !bodies.list.is_empty() && t < 40.0 {
            bodies.out.clear();
            let (n, t0) = (bodies.list.len(), Instant::now());
            bodies.advance(1.0 / 60.0);
            let ms = t0.elapsed().as_secs_f32() * 1000.0;
            if ms > worst.0 { worst = (ms, n, t) }
            if ms > 30.0 { eprintln!("{t:5.1} s: a call took {ms:.0} ms with {n} bodies, {} points tried, {} pair points, {} crushes", bodies.tried, bodies.paired, bodies.crushes) }
            t += 1.0 / 60.0;
        }
        eprintln!("all at rest at {t:.1} s; the longest call took {:.0} ms with {} bodies at {:.1} s; {} bodies in all", worst.0, worst.1, worst.2, bodies.rested.len());
    }

    /// Not a check: where the stuff goes when the board's rubble and ruin rows are acted on the houses across from the
    /// start (#160). `cargo test --release where_the_stuff_goes -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn where_the_stuff_goes() {
        use crate::kinds::*;
        let home = [700, city::ground(700, 4070), 4070];
        let (low, size) = ([380, home[1] - 60, 3820], [640usize, 300, 320]);
        let built = |k: Kind| !matches!(material(k), 0 | EARTH | ROCK | GRASS | SAND | ASPHALT);
        // The rows as rows.mjs had them on November 12 (ruin has since used six charges of 32): where the eye is, how
        // it is turned and tilted, the charges' turns and size.
        let rows: [(&str, [i32; 3], f32, f32, [f32; 5], i32); 2] = [
            ("rubble", [home[0], home[1] + 35, home[2] + 40], 9f32.to_radians(), 12.6f32.to_radians(), [-0.22, 0.0, 0.22, -0.11, 0.11], 16),
            ("ruin", [home[0] + 80, home[1] + 170, home[2] + 130], 0.0, -0.62, [-0.5, -0.25, 0.0, 0.25, 0.5], 40),
        ];
        for (name, eye, yaw, pitch, turns, radius) in rows {
            // With fire too when asked: SPARKS=1.
            for spark in if std::env::var("SPARKS").is_ok() { vec![false, true] } else { vec![false] } {
                let mut bodies = Bodies::new();
                let before = Region::gather(low, size, &bodies.ground.edits, &mut bodies.ground.scratch);
                let solid = |r: &Region, p: [f32; 3]| {
                    let c = [p[0].floor() as i32 - low[0], p[1].floor() as i32 - low[1], p[2].floor() as i32 - low[2]];
                    c.iter().zip(size).all(|(&v, n)| v >= 0 && (v as usize) < n) && r.cells[r.at(c[0] as usize, c[1] as usize, c[2] as usize)] != 0
                };
                let (mut emptied, mut middle, mut glass, mut born_small, mut born_big, mut biggest, mut t) = (0usize, 0usize, 0usize, 0usize, 0usize, 0usize, 0.0f32);
                for turn in turns {
                    let (y, p) = (yaw + turn, pitch);
                    let f = [y.sin() * p.cos(), p.sin(), -y.cos() * p.cos()];
                    let now = Region::gather(low, size, &bodies.ground.edits, &mut bodies.ground.scratch);
                    let mut d = 0.0f32;
                    while d < 900.0 && !solid(&now, [eye[0] as f32 + f[0] * d, eye[1] as f32 + f[1] * d, eye[2] as f32 + f[2] * d]) { d += 0.5 }
                    let reach = d + radius as f32 * 0.3;
                    let at = [(eye[0] as f32 + f[0] * reach).round() as i32, (eye[1] as f32 + f[1] * reach).round() as i32, (eye[2] as f32 + f[2] * reach).round() as i32];
                    bodies.ground.push(Edit::Ball { centre: at, radius, kind: 0 }, false, None);
                    let left = Region::gather(low, size, &bodies.ground.edits, &mut bodies.ground.scratch);
                    bodies.ground.undo();
                    for i in 0..now.cells.len() {
                        if now.cells[i] != 0 && left.cells[i] == 0 {
                            emptied += 1;
                            let (x, yy, z) = ((i % size[0]) as i32 + low[0], (i / (size[0] * size[2])) as i32 + low[1], ((i / size[0]) % size[2]) as i32 + low[2]);
                            let dd = (x - at[0]).pow(2) + (yy - at[1]).pow(2) + (z - at[2]).pow(2);
                            if material(now.cells[i]) == GLASS { glass += 1 } else if (dd as f32) < (radius * radius) as f32 * 0.16 { middle += 1 }
                        }
                    }
                    let first = bodies.next;
                    bodies.blast(at, radius, None, spark);
                    for b in bodies.list.iter().filter(|b| b.id >= first) {
                        if b.count <= 100 { born_small += b.count } else { born_big += b.count }
                        biggest = biggest.max(b.count);
                    }
                    eprintln!("  {name} spark {spark}: charge at {at:?}, {d:.0} cells off; {} bodies now", bodies.list.len());
                    for _ in 0..40 { bodies.out.clear(); bodies.advance(1.0 / 60.0); t += 1.0 / 60.0 }
                }
                while (!bodies.list.is_empty() || !bodies.fire.alight.is_empty()) && t < 200.0 { bodies.out.clear(); bodies.advance(1.0 / 60.0); t += 1.0 / 60.0 }
                let after = Region::gather(low, size, &bodies.ground.edits, &mut bodies.ground.scratch);
                let (s0, s1) = (before.cells.iter().filter(|&&k| built(k)).count(), after.cells.iter().filter(|&&k| built(k)).count());
                // What is where nothing was: by height over the ground there, and street side or house side of the fronts.
                let (mut gone, mut new, mut by_height, mut street, mut wood0, mut wood1) = (0usize, 0usize, [0usize; 4], 0usize, 0usize, 0usize);
                for i in 0..before.cells.len() {
                    let (b, a) = (before.cells[i], after.cells[i]);
                    if matches!(material(b), WOOD | ROOFING | LEAVES) { wood0 += 1 }
                    if matches!(material(a), WOOD | ROOFING | LEAVES) { wood1 += 1 }
                    if b != 0 && a == 0 { gone += 1 }
                    if b == 0 && a != 0 {
                        new += 1;
                        let (x, y, z) = ((i % size[0]) as i32 + low[0], (i / (size[0] * size[2])) as i32 + low[1], ((i / size[0]) % size[2]) as i32 + low[2]);
                        let h = y - city::ground(x, z);
                        by_height[if h < 5 { 0 } else if h < 15 { 1 } else if h < 40 { 2 } else { 3 }] += 1;
                        if z >= 4000 { street += 1 }
                    }
                }
                eprintln!("{name}, sparks {spark}: at rest after {t:.0} s. Built cells {s0} before, {s1} after ({} lost).", s0 as i64 - s1 as i64);
                eprintln!("  the charges emptied {emptied}: {middle} in their middles (dust), {glass} glass (dust); bodies born of {born_small} cells in lumps of 100 or fewer, {born_big} in bigger (the biggest {biggest})");
                eprintln!("  cells gone from where they were {gone}; cells now where nothing was {new}: {} under 0.5 m over the ground, {} to 1.5 m, {} to 4 m, {} higher; {street} of them on the street side of the fronts", by_height[0], by_height[1], by_height[2], by_height[3]);
                eprintln!("  what burns (wood, roofing, leaves): {wood0} before, {wood1} after\n");
            }
        }
    }

    /// Not a check: what holds up what still stands when the board's ruin row has been acted (#160): for every built
    /// cell over the street's first metre, where the path that holds it reaches the ground (the box's floor or one
    /// of its sides) and what the path cost. `cargo test --release what_holds_a_gutted_front -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn what_holds_a_gutted_front() {
        use crate::kinds::*;
        let home = [700, city::ground(700, 4070), 4070];
        let eye = [home[0] + 80, home[1] + 170, home[2] + 130];
        let mut bodies = Bodies::new();
        let (low, size) = ([380, home[1] - 60, 3820], [640usize, 300, 320]);
        let mut struck: Vec<[i32; 3]> = Vec::new();
        for turn in [-0.9f32, -0.7, -0.5, -0.3, -0.1, 0.1, 0.3, 0.5, 0.7, 0.9] {
            let (y, p) = (turn, -0.62f32);
            let f = [y.sin() * p.cos(), p.sin(), -y.cos() * p.cos()];
            let mut d = 0.0f32;
            while d < 900.0 && !bodies.ground.solid((eye[0] as f32 + f[0] * d).floor() as i32, (eye[1] as f32 + f[1] * d).floor() as i32, (eye[2] as f32 + f[2] * d).floor() as i32) { d += 0.5 }
            let reach = d + 32.0 * 0.3;
            let at = [(eye[0] as f32 + f[0] * reach).round() as i32, (eye[1] as f32 + f[1] * reach).round() as i32, (eye[2] as f32 + f[2] * reach).round() as i32];
            bodies.blast(at, 32, None, std::env::var("SPARKS").is_ok());
            struck.push(at);
            for _ in 0..42 { bodies.out.clear(); let (n, big, t0) = (bodies.list.len(), bodies.list.iter().map(|b| b.count).max().unwrap_or(0), std::time::Instant::now()); bodies.advance(1.0 / 60.0); let ms = t0.elapsed().as_secs_f32() * 1e3; if ms > 80.0 { eprintln!("    a call took {ms:.0} ms with {n} bodies (the biggest {big} cells), {} after; {} words told", bodies.list.len(), bodies.out.len()) } }
        }
        // GRID=1: charges set through the houses as well, at the feet of the walls that carry them, every 5 m.
        if std::env::var("GRID").is_ok() {
            for z in [3850, 3900, 3950] {
                for x in (600..=950).step_by(50) {
                    let at = [x, city::ground(x, z) + 15, z];
                    let n = bodies.blast(at, 32, None, std::env::var("SPARKS").is_ok());
                    struck.push(at);
                    eprintln!("  charge at {at:?} made {n} bodies; {} moving", bodies.list.len());
                    for _ in 0..42 { bodies.out.clear(); let (n, big, t0) = (bodies.list.len(), bodies.list.iter().map(|b| b.count).max().unwrap_or(0), std::time::Instant::now()); bodies.advance(1.0 / 60.0); let ms = t0.elapsed().as_secs_f32() * 1e3; if ms > 80.0 { eprintln!("    a call took {ms:.0} ms with {n} bodies (the biggest {big} cells), {} after; {} words told", bodies.list.len(), bodies.out.len()) } }
                }
            }
        }
        let mut t = 0.0;
        while (!bodies.list.is_empty() || !bodies.far.is_empty()) && t < 120.0 { bodies.out.clear(); let (n, big, t0) = (bodies.list.len(), bodies.list.iter().map(|b| b.count).max().unwrap_or(0), std::time::Instant::now()); bodies.advance(1.0 / 60.0); let ms = t0.elapsed().as_secs_f32() * 1e3; if ms > 80.0 { eprintln!("    a call took {ms:.0} ms with {n} bodies (the biggest {big} cells), {} after; {} words told", bodies.list.len(), bodies.out.len()) } t += 1.0 / 60.0; if ((t * 60.0) as i32) % 120 == 0 { eprintln!("  {t:.0} s on: {} bodies moving of {} cells, {} born so far; lumps {}, broken {}, other under 160 cells {}, other bigger {}; points {}; oldest {:.0} s", bodies.list.len(), bodies.list.iter().map(|b| b.count).sum::<usize>(), bodies.next, bodies.list.iter().filter(|b| b.lump).count(), bodies.list.iter().filter(|b| !b.lump && b.broken > 0).count(), bodies.list.iter().filter(|b| !b.lump && b.broken == 0 && b.count < 160).count(), bodies.list.iter().filter(|b| !b.lump && b.broken == 0 && b.count >= 160).count(), bodies.list.iter().map(|b| b.points.len()).sum::<usize>(), bodies.list.iter().map(|b| b.age).fold(0.0, f32::max)) } }
        eprintln!("at rest {t:.0} s after the last charge; {} bodies in all, {} still moving, {} crushes", bodies.next, bodies.list.len(), bodies.crushes);
        SPENT.with(|s| { let s = s.borrow(); eprintln!("the steps spent: points against the world {:.1} s, bodies against bodies {:.1} s, the touches' pushes {:.1} s ({:.0} touches in all), easing and crushing {:.1} s, breaking {:.1} s, moving on and lying down {:.1} s", s[0], s[1], s[2], s[6], s[3], s[4], s[5]) });
        if std::env::var("FAST").is_ok() { return }
        let tell = |name: &str, r: &Region| {
            let (out, join, cost) = support::loose_how(r, None);
            let [nx, _, nz] = r.size;
            let layer = nx * nz;
            // Where each cell's path ends: 1 the floor, 2 to 5 the sides -x, +x, -z, +z; 0 not followed yet.
            let mut root = vec![0u8; r.cells.len()];
            let (mut by_root, mut by_cost, mut by_stuff, mut unheld) = ([0usize; 6], [0usize; 6], std::collections::BTreeMap::<(u8, u8), usize>::new(), 0usize);
            let mut path: Vec<usize> = Vec::new();
            for i in 0..r.cells.len() {
                let k = r.cells[i];
                if k == 0 || support::is_ground(k) { continue }
                let (x, y, z) = (i % nx, i / layer, i / nx % nz);
                if (r.low[1] + y as i32) < city::ground(r.low[0] + x as i32, r.low[2] + z as i32) + 10 { continue }
                if out[i] { unheld += 1; continue }
                path.clear();
                let mut j = i;
                while root[j] == 0 {
                    path.push(j);
                    let (jx, jy, jz) = (j % nx, j / layer, j / nx % nz);
                    match join[j] & 127 {
                        1 => { root[j] = if jx == 0 { 2 } else if jx == nx - 1 { 3 } else if jz == 0 { 4 } else if jz == nz - 1 { 5 } else if jy == 0 { 1 } else { 1 }; }
                        2 => j -= layer,
                        3 => j -= 1,
                        4 => j += 1,
                        5 => j -= nx,
                        6 => j += nx,
                        7 => j += layer,
                        _ => { root[j] = 1 }
                    }
                }
                let at = root[j];
                for &p in &path { root[p] = at }
                by_root[at as usize] += 1;
                let c = cost[i];
                let b = if c == 0 { 0 } else if c <= 10 { 1 } else if c <= 30 { 2 } else if c <= 50 { 3 } else if c <= 90 { 4 } else { 5 };
                by_cost[b] += 1;
                if c > 0 { *by_stuff.entry((material(k), b as u8)).or_insert(0) += 1 }
            }
            eprintln!("{name}: paths end at the floor {}, the sides -x {}, +x {}, -z {}, +z {}; not held {unheld}", by_root[1], by_root[2], by_root[3], by_root[4], by_root[5]);
            eprintln!("  by cost: resting all the way {}, 1 to 10 {}, to 30 {}, to 50 {}, to 90 {}, more {}", by_cost[0], by_cost[1], by_cost[2], by_cost[3], by_cost[4], by_cost[5]);
            eprintln!("  not resting, by (material, cost band): {by_stuff:?}");
            // The pieces the unheld cells make, and why each is or is not let go.
            let unreached = (0..r.cells.len()).filter(|&i| out[i] && cost[i] == 255).count();
            eprintln!("  of all unheld cells {} were never reached, {} were on a join that tore", unreached, out.iter().filter(|&&l| l).count() - unreached);
            let mut seen = vec![false; r.cells.len()];
            let mut pieces: Vec<(usize, [usize; 3], [usize; 3], usize)> = Vec::new();
            for start in 0..r.cells.len() {
                if !out[start] || seen[start] { continue }
                let (mut n, mut lo, mut hi, mut torn, mut stack) = (0usize, [usize::MAX; 3], [0usize; 3], 0usize, vec![start]);
                seen[start] = true;
                while let Some(i) = stack.pop() {
                    n += 1;
                    if cost[i] != 255 { torn += 1 }
                    let c = [i % nx, i / layer, i / nx % nz];
                    for a in 0..3 { lo[a] = lo[a].min(c[a]); hi[a] = hi[a].max(c[a]) }
                    let mut go = |j: usize| if out[j] && !seen[j] { seen[j] = true; stack.push(j) };
                    if c[0] > 0 { go(i - 1) }
                    if c[0] + 1 < nx { go(i + 1) }
                    if c[2] > 0 { go(i - nx) }
                    if c[2] + 1 < nz { go(i + nx) }
                    if c[1] > 0 { go(i - layer) }
                    if c[1] + 1 < r.size[1] { go(i + layer) }
                }
                pieces.push((n, lo, hi, torn));
            }
            pieces.sort_unstable_by_key(|p| std::cmp::Reverse(p.0));
            for (n, lo, hi, torn) in pieces.iter().take(8) {
                let edge = lo[0] == 0 || lo[2] == 0 || hi[0] == nx - 1 || hi[2] == nz - 1 || hi[1] == r.size[1] - 1;
                eprintln!("    a piece of {n} cells ({torn} on torn joins) from {:?} to {:?} in the world{}", [0, 1, 2].map(|a| r.low[a] + lo[a] as i32), [0, 1, 2].map(|a| r.low[a] + hi[a] as i32), if edge { ": at the box's edge, left alone" } else { "" });
            }
            eprintln!("    {} pieces in all", pieces.len());
        };
        let untouched = Region::gather(low, size, &[], &mut bodies.ground.scratch);
        tell("the whole row before anything, in one box", &untouched);
        let t0 = std::time::Instant::now();
        let whole = Region::gather(low, size, &bodies.ground.edits, &mut bodies.ground.scratch);
        let t1 = std::time::Instant::now();
        support::loose(&whole);
        eprintln!("gathering the whole row ({} edits) took {:.0} ms, asking what is loose in it {:.0} ms", bodies.ground.edits.len(), (t1 - t0).as_secs_f32() * 1e3, t1.elapsed().as_secs_f32() * 1e3);
        tell("the whole row in one box", &whole);
        // Asked again where each charge went off, round after round, until nothing more comes loose.
        let census = |bodies: &mut Bodies| {
            let r = Region::gather(low, size, &bodies.ground.edits, &mut bodies.ground.scratch);
            let (mut high, mut street) = (0usize, 0usize);
            for i in 0..r.cells.len() {
                let k = r.cells[i];
                if k == 0 || support::is_ground(k) { continue }
                let (x, y, z) = (low[0] + (i % size[0]) as i32, low[1] + (i / (size[0] * size[2])) as i32, low[2] + (i / size[0] % size[2]) as i32);
                let h = y - city::ground(x, z);
                if z < 4000 && h >= 30 && x >= 560 && x < 980 { high += 1 }
                if z >= 4012 && h >= 2 { street += 1 }
            }
            (high, street)
        };
        eprintln!("built cells 3 m or more up behind the fronts, and cells over the street: {:?}", census(&mut bodies));
        if std::env::var("AGAIN").is_ok() {
            for round in 0..8 {
                let (mut made, t0) = (0, std::time::Instant::now());
                for at in &struck { made += bodies.release(*at, 0) }
                let ms = t0.elapsed().as_secs_f32() * 1e3;
                let cells: usize = bodies.list.iter().map(|b| b.count).sum();
                let biggest = bodies.list.iter().map(|b| (b.count, b.stuff)).max().unwrap_or((0, 0));
                let mut t = 0.0;
                while (!bodies.list.is_empty() || !bodies.far.is_empty()) && t < 120.0 { bodies.out.clear(); bodies.advance(1.0 / 60.0); t += 1.0 / 60.0 }
                eprintln!("round {round}: asking again made {made} bodies of {cells} cells (the biggest {biggest:?}) in {ms:.0} ms, at rest in {t:.0} s; {:?}", census(&mut bodies));
                if made == 0 { break }
            }
        }
        for at in [struck[4], struck[5]] {
            let r = Region::gather([at[0] - 80, at[1] - 48, at[2] - 80], SETTLE, &bodies.ground.edits, &mut bodies.ground.scratch);
            let t0 = std::time::Instant::now();
            support::loose(&r);
            eprintln!("asking what is loose in the box round a charge took {:.0} ms", t0.elapsed().as_secs_f32() * 1e3);
            tell(&format!("the box round the charge at {at:?}"), &r);
        }
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
        // What is built in a box well round the house, before anything moves and when all is still again.
        let (low, size) = ([x - 200, y - 80, z - 200], [400usize, 320, 400]);
        let built = |bodies: &mut Bodies| Region::gather(low, size, &bodies.ground.edits, &mut bodies.ground.scratch).cells.iter().filter(|&&k| k != 0 && !crate::support::is_ground(k)).count();
        let before = built(&mut bodies);
        let made = bodies.release(at, 16);
        assert!(made > 0, "nothing came loose");
        let loose: usize = bodies.list.iter().map(|b| b.count).sum();
        run(&mut bodies, 40.0);
        assert!(bodies.list.is_empty(), "{} bodies never came to rest", bodies.list.len());
        // No cell is made by falling, and under a tenth are lost: what lands hard breaks, and the smallest bits of that are dust.
        let after = built(&mut bodies);
        assert!(after <= before && (before - after) * 10 < loose, "{before} cells were built before {loose} of them came loose, and {after} when they lay down")
    }

    #[test]
    fn island_stack_of_three_persistent_bodies_sleeps_and_wakes_together() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let size = [10, 4, 10];
        for level in 0..3 {
            let mut b = Body::new(level + 1, block(size, kind(crate::kinds::WOOD, OWN)), size, [X, ground + 1 + level as i32 * 4, Z]);
            b.persist_sleep = true;
            bodies.list.push(b);
        }
        // Let the stack settle and fall asleep together as one island.
        let mut t = 0.0f32;
        while bodies.busy() > 0 && t < 8.0 {
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            t += 1.0 / 60.0;
        }
        assert_eq!(bodies.list.len(), 3, "persistent bodies must stay as oriented rigid bodies rather than converting to world cells");
        assert!(bodies.list.iter().all(|b| b.asleep), "all 3 stacked bodies must sleep together: {:?}", bodies.list.iter().map(|b| (b.id, b.asleep, b.vel, b.still, b.island_id)).collect::<Vec<_>>());
        let island_id = bodies.list[0].island_id;
        assert_ne!(island_id, 0, "sleeping stack must have a non-zero island id");
        assert!(bodies.list.iter().all(|b| b.island_id == island_id), "all 3 stacked bodies must share one island id: {:?}", bodies.list.iter().map(|b| b.island_id).collect::<Vec<_>>());
        assert_eq!(bodies.busy(), 0);

        // Verify 0 velocity/position updates while asleep, even when an unrelated awake body elsewhere forces `step()` to run.
        let saved: Vec<(V, Q)> = bodies.list.iter().map(|b| (b.pos, b.rot)).collect();
        let mut distant = Body::new(99, block([6, 6, 6], kind(crate::kinds::WOOD, OWN)), [6, 6, 6], [X + 400, ground + 80, Z + 400]);
        distant.persist_sleep = true;
        bodies.list.push(distant);
        for _ in 0..30 {
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            for (k, &(pos, rot)) in saved.iter().enumerate() {
                assert!(bodies.list[k].asleep, "sleeping stack body {k} must stay asleep");
                assert_eq!(bodies.list[k].vel, [0.0; 3], "sleeping stack body {k} must have 0 velocity updates");
                assert_eq!(bodies.list[k].spin, [0.0; 3], "sleeping stack body {k} must have 0 spin updates");
                assert_eq!(bodies.list[k].pos, pos, "sleeping stack body {k} must not drift while asleep");
                assert_eq!(bodies.list[k].rot, rot, "sleeping stack body {k} must not rotate while asleep");
            }
        }
        bodies.list.pop();

        // Wake ONLY the bottom body via `wake_in_aabb` covering strictly the bottom half of body 0 (well below body 1 & 2).
        let bottom_aabb = bodies.list[0].world_aabb();
        let bottom_lo = bottom_aabb.min;
        let bottom_hi = [bottom_aabb.max[0], bottom_aabb.min[1] + 1.0, bottom_aabb.max[2]];
        assert!(!bodies.list[1].world_aabb().intersects(&Aabb::new(bottom_lo, bottom_hi)), "query box must not touch middle body");
        assert!(!bodies.list[2].world_aabb().intersects(&Aabb::new(bottom_lo, bottom_hi)), "query box must not touch top body");
        bodies.wake_in_aabb(bottom_lo, bottom_hi);
        assert!(bodies.list.iter().all(|b| !b.asleep), "waking the bottom body must wake all 3 bodies in its island immediately");

        // Let them sleep again, then verify direct wake (`list[0].asleep = false`) wakes all 3 in the exact same step.
        t = 0.0;
        while bodies.busy() > 0 && t < 8.0 {
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            t += 1.0 / 60.0;
        }
        assert!(bodies.list.iter().all(|b| b.asleep));
        bodies.list[0].asleep = false;
        bodies.step(STEP);
        assert!(bodies.list.iter().all(|b| !b.asleep), "waking the bottom body must wake all 3 in the same step");
    }

    #[test]
    fn hybrid_persist_policy_keeps_structural_bodies_and_pours_brittle_rubble() {
        let ground = city::ground(X, Z);
        // Unit policy checks on `qualifies_for_persist_sleep`.
        let wood_prop = Body::new(1, block([6, 6, 6], kind(crate::kinds::WOOD, OWN)), [6, 6, 6], [X, ground + 10, Z]); // 216 cells wood
        assert!(wood_prop.qualifies_for_persist_sleep());

        let small_brick = Body::new(2, block([6, 6, 6], kind(BRICK, OWN)), [6, 6, 6], [X, ground + 10, Z]); // 216 cells brittle < 250
        assert!(!small_brick.qualifies_for_persist_sleep());

        let big_brick = Body::new(3, block([8, 6, 6], kind(BRICK, OWN)), [8, 6, 6], [X, ground + 10, Z]); // 288 cells brittle >= 250
        assert!(big_brick.qualifies_for_persist_sleep());

        let mut lump = Body::new(4, block([8, 6, 6], kind(crate::kinds::WOOD, OWN)), [8, 6, 6], [X, ground + 10, Z]);
        lump.lump = true;
        assert!(!lump.qualifies_for_persist_sleep());

        let mut passing = Body::new(5, block([8, 6, 6], kind(crate::kinds::WOOD, OWN)), [8, 6, 6], [X, ground + 10, Z]);
        passing.passing = true;
        assert!(!passing.qualifies_for_persist_sleep());

        let tiny = Body::new(6, block([4, 4, 4], kind(crate::kinds::WOOD, OWN)), [4, 4, 4], [X, ground + 10, Z]); // 64 < SMALL
        assert!(!tiny.qualifies_for_persist_sleep());

        // End-to-end check: structural prop sleeps in place while small brittle masonry converts back to world cells.
        let mut bodies = Bodies::new();
        bodies.persist_debris = true;
        let mut prop = wood_prop;
        prop.persist_sleep = prop.qualifies_for_persist_sleep();
        let mut rubble_block = Body::new(7, block([6, 6, 6], kind(BRICK, OWN)), [6, 6, 6], [X + 30, ground + 10, Z]);
        rubble_block.persist_sleep = rubble_block.qualifies_for_persist_sleep();
        bodies.list.push(prop);
        bodies.list.push(rubble_block);

        let mut t = 0.0f32;
        while bodies.busy() > 0 && t < 8.0 {
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            t += 1.0 / 60.0;
        }
        assert_eq!(bodies.list.len(), 1, "brittle masonry < 250 cells must pour into world cells while structural prop persists");
        assert_eq!(bodies.list[0].id, 1);
        assert!(bodies.list[0].asleep);
    }

    #[test]
    fn bodies_broadphase_query_and_raycast_find_expected_bodies() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        bodies.list.push(Body::new(1, block([8, 8, 8], kind(crate::kinds::WOOD, OWN)), [8, 8, 8], [X, ground + 10, Z]));
        bodies.list.push(Body::new(2, block([8, 8, 8], kind(crate::kinds::WOOD, OWN)), [8, 8, 8], [X + 40, ground + 10, Z]));
        bodies.list.push(Body::new(3, block([8, 8, 8], kind(crate::kinds::WOOD, OWN)), [8, 8, 8], [X + 20, ground + 50, Z]));
        bodies.rebuild_broadphase();

        let mut hits = Vec::new();
        bodies.broadphase_query_aabb(
            Aabb::new([X as f32 - 2.0, (ground + 8) as f32, Z as f32 - 2.0], [X as f32 + 12.0, (ground + 20) as f32, Z as f32 + 12.0]),
            &mut hits,
        );
        assert_eq!(hits, vec![0]);

        let origin = [X as f32 - 10.0, (ground + 14) as f32, (Z + 4) as f32];
        let inv_dir = [1.0, f32::INFINITY, f32::INFINITY];
        bodies.broadphase_raycast(origin, inv_dir, 100.0, &mut hits);
        assert_eq!(hits, vec![0, 1], "horizontal +X ray must hit bodies 0 and 1 and skip elevated body 2");
    }

    #[test]
    fn systemic_hinge_anchor_destruction_drops_door() {
        let ground = city::ground(X, Z);
        let y0 = ground + 90;
        let mut bodies = Bodies::new();

        // Build a solid concrete doorframe post high above the street so the door hangs over open air.
        let post: Vec<Run> = (y0..y0 + 16)
            .map(|y| Run { x0: X, x1: X + 1, y, z: Z, kind: kind(CONCRETE, OWN) })
            .collect();
        bodies.ground.push(Edit::Runs(post), false, None);
        assert!(bodies.ground.solid(X, y0 + 8, Z), "anchor voxel must start solid");

        // Spawn a wooden door panel beside the post with open air underneath it.
        let door_size = [8, 12, 2];
        let door = Body::new(1, block(door_size, kind(WOOD, OWN)), door_size, [X + 2, y0 + 2, Z]);
        let initial_y = door.pos[1];
        bodies.list.push(door);
        bodies.next = 2;

        // Hinge the door to the world doorframe voxel `(X, y0 + 8, Z)`.
        let pivot = [(X + 2) as f32, (y0 + 8) as f32, Z as f32 + 1.0];
        let jid = bodies.add_hinge(0, 1, pivot, [0.0, 1.0, 0.0], [X, y0 + 8, Z]);
        assert_ne!(jid, 0, "hinge creation must return a non-zero joint id");
        assert_eq!(bodies.joints.active_count(), 1);

        // Hold for 0.6 s: the hinge supports the door against gravity and prevents solidification.
        for _ in 0..36 {
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
        }
        assert_eq!(bodies.joints.active_count(), 1, "hinge must stay intact while its world voxel stands");
        assert_eq!(bodies.list.len(), 1, "hinged door must remain a dynamic body");
        let y_held = bodies.list[0].pos[1];
        assert!(
            (y_held - initial_y).abs() < 1.5,
            "hinged door must stay suspended near initial_y={initial_y:.2} (got {y_held:.2})"
        );

        // Destroy the world voxel anchoring the hinge via `blast`: the joint must snap automatically.
        bodies.blast([X, y0 + 8, Z], 4, None, false);
        assert!(!bodies.ground.solid(X, y0 + 8, Z), "blast must clear the hinge anchor voxel");
        assert_eq!(bodies.joints.active_count(), 0, "destroying the anchor voxel must snap the hinge automatically");

        // Step another 0.5 s: the unhinged door falls freely under gravity.
        for _ in 0..30 {
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
        }
        let door_after = bodies.list.iter().find(|b| b.id == 1).expect("door should still be falling in air");
        assert!(
            door_after.pos[1] < initial_y - 6.0 && door_after.vel[1] < -20.0,
            "unhinged door must fall under gravity (initial_y={initial_y:.2}, pos_y={:.2}, vel_y={:.2})",
            door_after.pos[1],
            door_after.vel[1]
        );
    }

    #[test]
    fn systemic_burning_wood_floats_and_extinguishes_in_water() {
        let ground = city::ground(X, Z);
        let sea_y = (ground + 70) as f32;
        let mut bodies = Bodies::new();
        bodies.set_env(Some(sea_y), 0.0);

        // Drop a burning wooden crate from above the sea plane so it plunges underwater,
        // quenches with steam puffs, and floats near its hydrostatic equilibrium waterline.
        let wood = kind(WOOD, OWN);
        let size = [6, 4, 6];
        let mut crate_body = Body::new(1, block(size, wood), size, [X, sea_y as i32 + 10, Z]);
        crate_body.persist_sleep = true;
        bodies.list.push(crate_body);
        bodies.next = 2;

        // Ignite bottom and middle cells of the wooden crate.
        assert!(bodies.fire.ignite_body(1, [2, 0, 2], wood));
        assert!(bodies.fire.ignite_body(1, [3, 1, 3], wood));
        assert!(bodies.fire.ignite_body(1, [2, 2, 2], wood));
        assert!(bodies.fire.dynamic_cell_count() >= 3);

        let steam_kind = kind(WATER, crate::kinds::WHITE) as u32;
        let mut saw_steam = false;
        let mut min_y = f32::MAX;
        for _ in 0..240 {
            bodies.out.clear();
            bodies.advance(1.0 / 60.0);
            if let Some(b) = bodies.list.iter().find(|b| b.id == 1) {
                min_y = min_y.min(b.pos[1]);
            }
            let mut i = 0;
            while i < bodies.out.len() {
                let tag = bodies.out[i];
                let len = bodies.out[i + 1] as usize;
                if tag == DUST && len >= 5 && bodies.out[i + 5] == steam_kind {
                    saw_steam = true;
                }
                i += 2 + len;
            }
        }

        let b = bodies.list.iter().find(|b| b.id == 1).expect("wooden body must remain afloat");
        assert!(saw_steam, "water quenching dynamic fire must emit steam DUST puffs");
        assert_eq!(
            bodies.fire.dynamic_cell_count(),
            0,
            "plunging burning wood into water must extinguish its flames"
        );
        // Equilibrium COM of a 4-cell wood block (rho=0.6 vs 1.025) sits ~0.34 cells below sea_y.
        assert!(
            b.pos[1] > sea_y - 3.0 && b.pos[1] < sea_y + 3.0,
            "wooden crate must float near sea_y={sea_y:.1} (got pos_y={:.2}, min_y={min_y:.2}, ground={ground})",
            b.pos[1]
        );
    }

    #[test]
    fn systemic_bullet_penetrates_wood_and_hits_ragdoll() {
        use crate::ragdoll::{BoneId, POSE_WIRE_BYTES, RagdollMode, unpack_pose};

        let ground = city::ground(X, Z);
        let base_y = ground + 90;
        let mut bodies = Bodies::new();

        // Build a concrete floor platform and a 1-cell wooden wall panel in front of the ragdoll.
        let mut runs: Vec<Run> = Vec::new();
        for z in Z - 12..=Z + 12 {
            runs.push(Run { x0: X - 10, x1: X + 40, y: base_y - 1, z, kind: kind(CONCRETE, OWN) });
        }
        for y in base_y..base_y + 22 {
            for z in Z - 6..=Z + 6 {
                runs.push(Run { x0: X + 10, x1: X + 11, y, z, kind: kind(WOOD, OWN) });
            }
        }
        bodies.ground.push(Edit::Runs(runs), false, None);

        // Spawn a standing active ragdoll behind the wood wall.
        let rid = bodies.ragdoll_spawn([(X + 22) as f32, base_y as f32, Z as f32], 0.0);
        assert_eq!(bodies.ragdolls.len(), 1);
        assert_eq!(bodies.ragdolls[0].ragdoll.mode, RagdollMode::Locomotion);

        let chest = bodies.ragdolls[0].ragdoll.bones[BoneId::Chest.index()].pos;
        let panel_cell = [X + 10, chest[1].floor() as i32, chest[2].floor() as i32];
        assert!(bodies.ground.solid(panel_cell[0], panel_cell[1], panel_cell[2]), "wood panel must stand before shot");

        // Fire a 5.56mm rifle bullet straight through the wood panel into the ragdoll's chest.
        let pid = bodies.ballistics_fire(
            crate::ballistics::Caliber::Rifle556,
            [(X + 2) as f32, chest[1], chest[2]],
            [1.0, 0.0, 0.0],
        );
        assert_ne!(pid, 0);

        bodies.out.clear();
        bodies.advance(1.0 / 60.0);

        // 1. Wood panel was penetrated and chipped out.
        assert!(
            !bodies.ground.solid(panel_cell[0], panel_cell[1], panel_cell[2]),
            "rifle bullet must punch through and chip wood panel cell {panel_cell:?}"
        );
        // 2. Ragdoll behind panel took the chest impact and entered HitReaction.
        assert_eq!(
            bodies.ragdolls[0].ragdoll.mode,
            RagdollMode::HitReaction,
            "penetrating rifle bullet must trigger ragdoll HitReaction"
        );
        assert!(
            bodies.ragdolls[0].ragdoll.bones[BoneId::Chest.index()].vel[0] > 0.1,
            "chest bone must gain forward +X velocity from bullet momentum transfer"
        );

        // 3. `POSE` (tag 14) record emitted with 1 + 17 = 18 payload words unpacking cleanly to 67 bytes.
        let mut unpacked_pose = None;
        let mut i = 0;
        while i < bodies.out.len() {
            let tag = bodies.out[i];
            let len = bodies.out[i + 1] as usize;
            if tag == POSE {
                assert_eq!(len, 18, "POSE record payload must be ragdoll_id + 17 packed u32 words");
                assert_eq!(bodies.out[i + 2], rid);
                let mut padded = [0u8; 68];
                for k in 0..17 {
                    padded[k * 4..k * 4 + 4].copy_from_slice(&bodies.out[i + 3 + k].to_le_bytes());
                }
                let raw: [u8; POSE_WIRE_BYTES] = padded[..POSE_WIRE_BYTES].try_into().unwrap();
                unpacked_pose = Some(unpack_pose(&raw));
            }
            i += 2 + len;
        }
        let pose = unpacked_pose.expect("Bodies::advance must emit a POSE (tag 14) wire record");
        assert_eq!(pose.mode, RagdollMode::HitReaction);
        assert!(pose.pelvis_pos.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn systemic_mirror_laser_ignites_wood_around_corner() {
        let ground = city::ground(X, Z);
        let y0 = ground + 95;
        let mut bodies = Bodies::new();

        // Build:
        // - A concrete baffle wall between `(X, y0, Z)` and `(X + 40, y0, Z)` blocking direct sight.
        // - A `POLISHED | STEEL` mirror wall at `z = Z + 20` (facing `-Z`).
        // - A flammable `WOOD` wall around the corner at `x = X + 40`.
        let mut runs: Vec<Run> = Vec::new();
        for y in y0 - 2..=y0 + 2 {
            for z in Z - 5..=Z + 5 {
                runs.push(Run { x0: X + 20, x1: X + 21, y, z, kind: kind(CONCRETE, OWN) });
                runs.push(Run { x0: X + 40, x1: X + 41, y, z, kind: kind(WOOD, OWN) });
            }
            runs.push(Run {
                x0: X + 14,
                x1: X + 28,
                y,
                z: Z + 20,
                kind: kind(crate::kinds::STEEL, OWN) | crate::kinds::POLISHED,
            });
        }
        bodies.ground.push(Edit::Runs(runs), false, None);

        // Fire a 45-degree laser toward `(1, 0, 1)`: bounces off the polished mirror at `z = Z + 20`
        // into `(1, 0, -1)` around the concrete corner and strikes the wood wall at `x = X + 40`.
        let origin = [X as f32 + 0.5, y0 as f32 + 0.5, Z as f32 + 0.5];
        let segs = bodies.beams_fire(origin, [1.0, 0.0, 1.0], 200.0, 0.1);
        assert!(segs >= 2, "laser must bounce off the POLISHED mirror (segments={segs})");
        assert!(
            bodies
                .last_beam
                .events
                .iter()
                .any(|e| matches!(e, crate::beams::BeamEvent::MirrorBounce { .. })),
            "expected a MirrorBounce event off POLISHED steel"
        );
        assert!(
            bodies
                .last_beam
                .events
                .iter()
                .any(|e| matches!(e, crate::beams::BeamEvent::IgniteVoxel { cell } if cell[0] == X + 40)),
            "expected reflected beam to ignite the wood wall at x={} (events={:?})",
            X + 40,
            bodies.last_beam.events
        );
        assert!(
            !bodies.fire.alight.is_empty(),
            "ignited wood voxel around the corner must be live in `Bodies.fire.alight`"
        );
        assert!(
            bodies.fire.alight.keys().any(|c| c[0] == X + 40),
            "alight cell must lie on the around-the-corner wood wall"
        );

        // Advance simulation: fire emits `FIRE` record and thermal map cools smoothly.
        bodies.out.clear();
        bodies.advance(0.1);
        let mut saw_fire = false;
        let mut i = 0;
        while i < bodies.out.len() {
            if bodies.out[i] == FIRE {
                saw_fire = true;
            }
            i += 2 + bodies.out[i + 1] as usize;
        }
        assert!(saw_fire, "burning wood wall ignited by reflected laser must emit FIRE output");
    }

    #[test]
    fn systemic_timesliced_support_job_no_stall() {
        let ground = city::ground(X, Z);
        let y0 = ground + 80;
        let mut bodies = Bodies::new();

        // Place an unsupported 10x6x10 (600 cells >= SMALL) floating brick slab well inside a 160x128x160 box.
        let mut runs: Vec<Run> = Vec::new();
        for y in y0..y0 + 6 {
            for z in Z - 5..Z + 5 {
                runs.push(Run { x0: X - 5, x1: X + 5, y, z, kind: kind(BRICK, OWN) });
            }
        }
        bodies.ground.push(Edit::Runs(runs), false, None);
        assert!(bodies.ground.solid(X, y0 + 2, Z));

        // Enqueue a time-sliced SupportJob onto Bodies.
        bodies.enqueue_support_job([X - 80, y0 - 32, Z - 80], [160, 128, 160], None);
        assert_eq!(bodies.support_jobs.len(), 1);

        let mut slices = 0usize;
        let mut prev_progress = 0.0f32;
        let mut max_slice_ms = 0.0f64;
        while !bodies.support_jobs.is_empty() && slices < 500 {
            let p = bodies.support_jobs[0].progress();
            assert!(p >= prev_progress - 1e-6, "SupportJob progress must be monotonic ({p} < {prev_progress})");
            prev_progress = p;
            bodies.out.clear();
            let t0 = std::time::Instant::now();
            bodies.advance(1.0 / 60.0);
            let ms = t0.elapsed().as_secs_f64() * 1000.0;
            max_slice_ms = max_slice_ms.max(ms);
            slices += 1;
        }
        eprintln!(
            "systemic SupportJob(160x128x160, budget=50_000): {slices} slices, max_slice={max_slice_ms:.2} ms, spawned_bodies={}",
            bodies.list.len()
        );
        assert!(bodies.support_jobs.is_empty(), "SupportJob must finish within 500 slices");
        assert!(slices > 1, "160x128x160 SupportJob must advance incrementally across multiple frames (slices={slices})");
        assert!(
            !bodies.ground.solid(X, y0 + 2, Z),
            "finished SupportJob must remove unsupported slab cells from Ground"
        );
        assert!(
            !bodies.list.is_empty() && bodies.list.iter().map(|b| b.count).sum::<usize>() == 600,
            "finished SupportJob must spawn the 600-cell unsupported slab as a dynamic body via `take()`"
        );
        #[cfg(not(debug_assertions))]
        assert!(
            max_slice_ms < 25.0,
            "time-sliced SupportJob per-frame step must stay bounded (got max={max_slice_ms:.2} ms)"
        );
    }

    /// A concrete pillar 10 by 60 by 10 cells stood on the street at (X, Z), as cells of the world.
    fn pillar(bodies: &mut Bodies) -> i32 {
        let ground = city::ground(X, Z);
        let mut runs = Vec::new();
        for y in ground + 1..ground + 61 {
            for z in Z..Z + 10 {
                runs.push(Run { x0: X, x1: X + 10, y, z, kind: kind(CONCRETE, OWN) });
            }
        }
        bodies.change(runs);
        ground
    }

    #[test]
    fn the_cleave_cuts_a_pillar_and_lifts_holds_and_lets_go_of_its_top() {
        let mut bodies = Bodies::new();
        let ground = pillar(&mut bodies);
        assert_eq!(bodies.release([X + 5, ground + 30, Z + 5], 0), 0, "the pillar stands by itself");
        // A sheet tipped a little about x, through the pillar 30 cells up, swept across it from 40 cells off.
        let cut_y = (ground + 30) as f32;
        let n = unit([0.0, 1.0, 0.2]);
        let along = [1.0, 0.0, 0.0];
        let across = cross(n, along);
        let (c, s) = (0.3f32.cos(), 0.3f32.sin());
        let e1 = sub(scale(along, c), scale(across, s));
        let e2 = add(scale(along, s), scale(across, c));
        let eye = [(X - 40) as f32, cut_y, (Z + 5) as f32];
        bodies.out.clear();
        let hung = bodies.cleave_wedge(eye, n, e1, e2, 0.6, 50.0, [1.0, 0.0, 0.0]);
        assert!(hung >= 1, "the pillar's top is lifted off the cut");
        let out = bodies.out.clone();
        let (mut tags, mut i) = (Vec::new(), 0);
        while i < out.len() {
            tags.push(out[i]);
            i += 2 + out[i + 1] as usize;
        }
        assert!(tags.contains(&EDIT) && tags.contains(&DUST) && tags.contains(&BORN), "the cut is told as an edit, dust and a body born: {tags:?}");
        let top_cells = bodies.list.iter().find(|b| b.id == bodies.hangs[0].0).unwrap().count;
        assert!(top_cells > 2000, "the whole top comes away as one ({top_cells} cells)");
        // The kerf: the pillar's middle at the sheet is empty, a few cells off it is not.
        let mid = [X + 5, Z + 5];
        let on_sheet = |x: i32, z: i32| (cut_y - (dot(n, [x as f32 + 0.5 - eye[0], 0.0, z as f32 + 0.5 - eye[2]]) / n[1]) - 0.5).round() as i32;
        let y = on_sheet(mid[0], mid[1]);
        assert!(!bodies.ground.solid(mid[0], y, mid[1]), "the kerf is cut");
        assert!(bodies.ground.solid(mid[0], y - 4, mid[1]), "below the kerf the pillar stands");
        // The top hangs, out of the solver: lifted over 0.2 s of real time, held till 1.2 s, then let go.
        let id = bodies.hangs[0].0;
        let start = bodies.hang_of(id).unwrap().start_pos;
        let lift = bodies.hang_of(id).unwrap().lift_vec;
        assert!(bodies.list.iter().find(|b| b.id == id).unwrap().born[1] > ground + 25, "what hangs is the top");
        let pos = |b: &Bodies| b.list.iter().find(|b| b.id == id).unwrap().pos;
        for _ in 0..10 {
            bodies.advance(1.0 / 60.0);
        }
        assert_eq!(pos(&bodies), start, "nothing pulls on what hangs");
        assert_eq!(bodies.hang_tick(0.1), 1);
        let up = dot(sub(pos(&bodies), start), unit(lift)) / dot(lift, lift).sqrt();
        assert!((up - 0.875).abs() < 1e-3, "eased out: half the time, seven eighths of the way ({up})");
        bodies.hang_tick(0.1);
        let top = add(start, lift);
        assert!(dot(sub(pos(&bodies), top), sub(pos(&bodies), top)) < 1e-6, "all the way up at 0.2 s");
        for _ in 0..30 {
            bodies.advance(1.0 / 60.0);
        }
        assert!(dot(sub(pos(&bodies), top), sub(pos(&bodies), top)) < 1e-6, "held where it was lifted");
        assert_eq!(bodies.hang_tick(0.5), 1, "still held at 0.7 s");
        assert_eq!(bodies.hang_tick(0.6), 0, "let go at 1.2 s");
        let b = bodies.list.iter().find(|b| b.id == id).unwrap();
        assert!(b.vel[0] > 3.0 && b.vel[1] > 3.0 && !b.asleep, "let go sliding along and up off the cut: {:?}", b.vel);
        assert!(dot(b.spin, b.spin) > 0.01, "and tipping");
        bodies.advance(1.0 / 60.0);
        assert!(pos(&bodies) != top, "once let go it moves");
    }

    #[test]
    fn the_cleave_slices_a_moving_body_and_lifts_its_upper_half() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let size = [8, 12, 8];
        bodies.list.push(Body::new(1, block(size, kind(WOOD, OWN)), size, [X, ground + 300, Z]));
        bodies.next = 2;
        let eye = [(X - 30) as f32, (ground + 306) as f32, (Z + 4) as f32];
        let (c, s) = (0.2f32.cos(), 0.2f32.sin());
        bodies.out.clear();
        let hung = bodies.cleave_wedge(eye, [0.0, 1.0, 0.0], [c, 0.0, s], [s, 0.0, -c], 0.4, 60.0, [0.0; 3]);
        assert_eq!(bodies.list.len(), 2, "the block is cut in two");
        assert!(bodies.out.contains(&BROKE));
        assert_eq!(hung, 1, "its upper half is lifted");
        let up = bodies.list.iter().find(|b| bodies.hang_of(b.id).is_some()).unwrap();
        let down = bodies.list.iter().find(|b| bodies.hang_of(b.id).is_none()).unwrap();
        assert!(up.pos[1] > eye[1] && down.pos[1] < eye[1]);
    }

    #[test]
    fn capture_holds_the_nearest_and_lets_them_go_a_few_at_a_time() {
        let ground = city::ground(X, Z);
        let y = ground + 200;
        let mut bodies = Bodies::new();
        let mut id = 1;
        for i in 0..14 {
            for k in 0..12 {
                bodies.list.push(Body::new(id, block([2, 2, 2], kind(WOOD, OWN)), [2, 2, 2], [X + i * 6, y, Z + k * 6]));
                id += 1;
            }
        }
        let center = [X as f32 + 40.0, y as f32, Z as f32 + 33.0];
        assert_eq!(bodies.capture_orbit(center, 10.0, 3), 3, "no more than asked");
        let taken: Vec<u32> = bodies.orbits.iter().map(|o| o.0).collect();
        let nearest = |b: &Body| dot(sub(b.pos, center), sub(b.pos, center));
        let worst_taken = taken.iter().map(|t| nearest(bodies.list.iter().find(|b| b.id == *t).unwrap())).fold(0.0, f32::max);
        let closer_left = bodies.list.iter().filter(|b| !taken.contains(&b.id)).any(|b| nearest(b) < worst_taken - 1e-3);
        assert!(!closer_left, "the nearest are taken first");
        let y_before: Vec<f32> = taken.iter().map(|t| bodies.list.iter().find(|b| b.id == *t).unwrap().pos[1]).collect();
        for _ in 0..6 {
            bodies.advance(1.0 / 60.0);
        }
        let y_after: Vec<f32> = taken.iter().map(|t| bodies.list.iter().find(|b| b.id == *t).unwrap().pos[1]).collect();
        assert_eq!(y_before, y_after, "what is held does not fall");
        // All of them, then flung: OUT go each call, the outermost first.
        let all = bodies.capture_orbit(center, 1000.0, 10_000);
        assert_eq!(all + 3, 168, "everything in reach is taken");
        assert_eq!(bodies.captured(), 168);
        bodies.hang_tick(0.2);
        assert_eq!(bodies.capture_fling([0.0, 0.0, 0.0], 50.0), 168);
        let first_out = bodies.outgoing.last().unwrap().3;
        assert!(bodies.outgoing.iter().all(|o| o.3 <= first_out), "the outermost goes first");
        bodies.advance(1.0 / 60.0);
        assert_eq!(bodies.captured(), 168 - OUT, "no more than OUT let go in one call");
        bodies.advance(1.0 / 60.0);
        assert_eq!(bodies.captured(), 0);
        let moving = bodies.list.iter().filter(|b| b.vel[0].abs() + b.vel[2].abs() > 20.0).count();
        assert!(moving >= 160, "what was flung goes ({moving} of 168 moving)");
    }

    #[test]
    fn set_pose_puts_a_body_back_awake_and_lets_go_of_a_hold() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        bodies.list.push(Body::new(1, block([4, 4, 4], kind(WOOD, OWN)), [4, 4, 4], [X, ground + 100, Z]));
        bodies.list[0].asleep = true;
        assert_eq!(bodies.capture_orbit(bodies.list[0].pos, 20.0, 1), 1);
        let to = [X as f32, (ground + 120) as f32, Z as f32];
        let l = (0.7f32 * 0.7 + 1.7 * 1.7).sqrt();
        let q = [0.0, 0.7 / l, 0.0, 1.7 / l];
        assert!(bodies.set_pose(1, to, [0.0, 0.7, 0.0, 1.7], [1.0, 2.0, 3.0], [0.0, 0.5, 0.0]));
        let b = &bodies.list[0];
        assert_eq!((b.pos, b.vel, b.spin, b.asleep), (to, [1.0, 2.0, 3.0], [0.0, 0.5, 0.0], false));
        assert!(b.rot.iter().zip(q).all(|(a, b)| (a - b).abs() < 1e-5), "its turn is put, made whole: {:?}", b.rot);
        assert_eq!(bodies.captured(), 0, "a body put from outside is let go");
        assert!(!bodies.set_pose(99, to, q, [0.0; 3], [0.0; 3]));
    }

    #[test]
    fn a_plastic_weld_bends_in_the_live_solver() {
        let ground = city::ground(X, Z);
        let mut bodies = Bodies::new();
        let size = [20, 4, 4];
        bodies.list.push(Body::new(1, block(size, kind(WOOD, OWN)), size, [X, ground + 100, Z]));
        let root = [X as f32, (ground + 102) as f32, Z as f32 + 2.0];
        let id = bodies.add_fixed(0, 1, root, root, 0.0, 0.0, 5_000.0, 0.15);
        assert!(id > 0 && bodies.joint_bend(id) == 0.0);
        let mut broke = false;
        for _ in 0..240 {
            bodies.advance(1.0 / 60.0);
            if bodies.joint_bend(id) < 0.0 {
                broke = true;
                break;
            }
        }
        assert!(broke, "an overloaded plastic weld bends to its limit and breaks in Bodies::advance");
    }
}
