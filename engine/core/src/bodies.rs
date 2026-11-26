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
use crate::kinds::{ASPHALT, BRICK, CONCRETE, EARTH, GLASS, GRASS, LEAVES, PLASTER, ROCK, ROOFING, SAND, WATER, WOOD, breaks_at, burns, charged, material, rubble, weighs};
use crate::scratch::{Run, Scratch};
use crate::support::{self, Region};
use crate::tree::{CELLS, Kind, SIDE, at, at as at_cell};
use crate::{Edit, SETTLE, WIDE, city, fill_of};
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

mod living;
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
        let kept = if self.scratch.cells.iter().all(|&k| k == first) { Kept::Same(first) } else { Kept::Cells(self.scratch.cells.clone().into_boxed_slice()) };
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
        self.scratch.start(key[0], key[1], key[2], 0);
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

    fn make(&mut self, key: [i32; 3]) -> Sector {
        let s = SIDE as i32;
        let (lo, hi) = (key.map(|k| k * s), key.map(|k| (k + 1) * s));
        // Far under the ground or over the roofs nothing needs making, unless an edit reached there.
        let (first, last) = city::span(key[0], key[2], 0);
        if (key[1] < first || key[1] > last) && !self.boxes.iter().any(|(a, b)| (0..3).all(|i| a[i] < hi[i] && b[i] > lo[i])) {
            return if key[1] < first { Sector::Solid } else { Sector::Air };
        }
        self.fill(key);
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
                if burns(material(kind)).0 != 0 {
                    coarse.sorted(i, material(kind));
                }
                if burns(material(kind)).0 != 0 {
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
        let slot = self.slot([x >> 6, y >> 6, z >> 6]);
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
    pub fn kind(&mut self, x: i32, y: i32, z: i32) -> Kind {
        let key = [x >> 6, y >> 6, z >> 6];
        let i = at((x & 63) as usize, (y & 63) as usize, (z & 63) as usize);
        self.keep(key);
        match &self.kept[&key].0 {
            Kept::Same(kind) => *kind,
            Kept::Cells(cells) => cells[i],
        }
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
    /// The same as they are turned in this step, from its middle.
    turned: Vec<V>,
    radius: f32,
    still: f32,
    age: f32,
    /// How long since it last touched anything.
    apart: f32,
    /// The stretch its touches cover this step, from its middle of mass: least and most along x and z.
    footing: [f32; 4],
    /// The hardest single knock it took in the last step, as a change of speed; and how many times it has broken already.
    knock: f32,
    broken: u8,
    /// What most of it is made of.
    stuff: u8,
    /// Whether it is a lump a blast threw out: these are many, and are not tried against each other however big.
    lump: bool,
    /// Whether a blast threw it (and not merely let it go).
    thrown: bool,
    /// Whether it passes: come to rest it is gone, and is cells of nothing. A shot is not litter in the street.
    pub passing: bool,
    /// Where its low corner was in the world when it came loose: its cells keep the shades they had.
    pub born: [i32; 3],
    /// What makes it a living thing (living.rs), if it is one: it is then never put down as cells for lying still.
    pub live: Option<Box<Live>>,
    /// Whether it sleeps: a living thing left alone is not stepped until something stirs it.
    pub asleep: bool,
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
            vel: [0.0; 3], spin: [0.0; 3], points: Vec::new(), turned: Vec::new(), radius: 0.0, still: 0.0, age: 0.0, apart: 1.0, footing: [0.0; 4], knock: 0.0, broken: 0, stuff: 0, lump: false, thrown: false, passing: false, born: low, live: None, asleep: false,
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
        Bodies { ground: Ground::new(), list: Vec::new(), next: 1, out: Vec::new(), touches: Vec::new(), owed: 0.0, steps: 0, tried: 0, paired: 0, crushes: 0, rested: Vec::new(), since_crush: 1.0, fire: crate::fire::Fire::default(), water: crate::water::Water::default(), far: Vec::new(), scars: Vec::new(), fuses: Vec::new(), since_lit: 0.0, struck: Vec::new(), spawned: 0 }
    }

    /// How many bodies move, and wide boxes still to be asked about: while it is not nothing the solver is to be
    /// called on, for what a charge left standing may yet come loose.
    pub fn busy(&self) -> usize {
        self.list.iter().filter(|b| !b.asleep).count() + self.far.len() + self.fuses.len()
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
        self.stir(lo, hi);
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
        self.release_in(at, radius, SETTLE[0])
    }

    /// The same, asked of a box `side` cells across (22 m tall, most of it above the point): a small change needs
    /// only a narrow box, which is quick.
    pub fn release_in(&mut self, at: [i32; 3], radius: i32, side: usize) -> usize {
        self.release_box(at, radius, [side, SETTLE[1], side])
    }

    /// As `release`, asked in a box of a given size round the place. A thing that reaches the box's top is left alone,
    /// so a blast asks in one as tall as ever, however narrow. A landing's dent asks in a small one: it is asked eight
    /// times a second while a house comes down, and the asking is most of what the solver then does.
    fn release_box(&mut self, at: [i32; 3], radius: i32, size: [usize; 3]) -> usize {
        let side = size[0];
        let low = [at[0] - side as i32 / 2, at[1] - 48, at[2] - side as i32 / 2];
        #[cfg(test)]
        let t0 = std::time::Instant::now();
        let mut region = self.ground.region(low, size);
        #[cfg(test)]
        let t1 = std::time::Instant::now();
        let (pieces, dust) = support::release(&mut region, Some((at, radius)));
        #[cfg(test)]
        if std::env::var("TIMES").is_ok() { eprintln!("    release in {size:?}: gathered in {:.0} ms, asked in {:.0} ms, {} pieces", (t1 - t0).as_secs_f32() * 1e3, t1.elapsed().as_secs_f32() * 1e3, pieces.len()) }
        self.take(pieces, dust, Some((at, radius)))
    }

    /// Pieces that have come loose leave the world and are bodies; crumbs of them are dust. A blast throws them.
    fn take(&mut self, pieces: Vec<support::Loose>, dust: Vec<Run>, thrown: Option<([i32; 3], i32)>) -> usize {
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
        let made = pieces.len();
        for p in pieces {
            let size = [(p.high[0] - p.low[0]) as usize, (p.high[1] - p.low[1]) as usize, (p.high[2] - p.low[2]) as usize];
            let mut body = Body::new(self.next, support::grid_of(&p.runs, p.low, size), size, p.low);
            self.next += 1;
            if let Some((at, radius)) = thrown {
                self.throw(&mut body, at, radius);
            }
            self.born(&body);
            self.list.push(body);
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
        let made = self.take(pieces, dust, None);
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
        self.shove(at, radius);
        let made = self.lumps(&before, &left, at, radius);
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
    fn lumps(&mut self, before: &Region, left: &Region, at: [i32; 3], radius: i32) -> usize {
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
        for key in keys {
            let cells = &lumps[&key];
            // What is too small to be a body, or one more than there can be, falls as rubble too.
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
            if body.points.len() > LUMP_POINTS {
                let all = std::mem::take(&mut body.points);
                body.points = (0..LUMP_POINTS).map(|k| all[k * all.len() / LUMP_POINTS]).collect();
            }
            self.throw(&mut body, at, radius);
            self.born(&body);
            self.list.push(body);
            made += 1;
        }
        loose.sort_unstable_by_key(|&(c, _)| (c[1], c[2], c[0]));
        self.heap(&loose);
        made
    }

    /// A body that lands hard breaks what it lands on: where it struck, the world is emptied as by a small blast (as
    /// far as each material gives), what was there comes out as lumps, and what that leaves unheld comes loose.
    /// `push` is how hard it struck: its weight times the speed it lost.
    fn crush(&mut self, at: [i32; 3], push: f32) {
        let radius = ((push / 500.0).cbrt() as i32).clamp(2, 6);
        if self.burst(at, radius) {
            self.release_box(at, radius, [48, 96, 48]);
        }
    }

    /// A blast of the solver's own making. It does not go into the world as a blast: what it empties goes in as rows
    /// of the solver's own, which is how the page hears of it, and comes out as lumps and rubble. Whether it emptied
    /// anything.
    fn burst(&mut self, at: [i32; 3], radius: i32) -> bool {
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
        self.lumps(&before, &left, at, radius);
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
        self.burst(at, radius);
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
            body.passing = whole.passing;
            self.born(&body);
            self.list.push(body);
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
        while self.owed >= STEP && self.list.iter().any(|b| !b.asleep) {
            self.owed -= STEP;
            self.step(STEP);
            self.steps += 1;
        }
        if !self.list.iter().any(|b| !b.asleep) {
            self.owed = 0.0;
        }
        self.tell_struck();
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
    }

    fn step(&mut self, h: f32) {
        #[cfg(test)]
        let mut lap = std::time::Instant::now();
        #[cfg(test)]
        let mut mark = |k: usize| { SPENT.with(|s| s.borrow_mut()[k] += lap.elapsed().as_secs_f64()); lap = std::time::Instant::now(); };
        // What lives is moved by its motor; then what pulls and what touches.
        self.motors(h);
        self.touches.clear();
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
        // Body against body: the points of each tried in the cells of the other. Only pairs with a big body in them
        // are tried, so each big body is asked which others are near it.
        // A living thing meets every other body, however small either is: a frog is not passed through.
        let is_big = |b: &Body| (b.count >= SMALL && !b.lump) || b.live.is_some();
        let big: Vec<usize> = (0..self.list.len()).filter(|&i| is_big(&self.list[i])).collect();
        for &i in &big {
            for j in 0..self.list.len() {
                // Two big bodies are a pair once. What a blast threw out meets only the world: a house coming down in
                // forty panels among a thousand lumps tried each panel against every lump near it.
                if j == i || (is_big(&self.list[j]) && j < i) || (self.list[j].lump && self.list[i].live.is_none()) || (self.list[i].asleep && self.list[j].asleep) {
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
                    for k in [i, j] {
                        self.list[k].apart = 0.0;
                        self.list[k].asleep = false;
                    }
                }
                keep(&mut found, i, j, &mut self.touches);
            }
        }
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
        // What a touch rubs with: 0.7 of its push, but a person's body hardly at all (#367). Someone goes by their legs,
        // which hold them to the ground; their body rubbing on a wall as stone rubs on stone, they stopped dead
        // against any wall met within 35 degrees of square and crept along one met at more. Now they go along it.
        let person = |i: usize| i != NONE && self.list[i].live.as_ref().is_some_and(|live| live.figure);
        let rubs: Vec<f32> = self.touches.iter().map(|t| if person(t.a) || person(t.b) { 0.03 } else { 0.7 }).collect();
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
                if round == 0 {
                    self.touches[t].closing = closing;
                }
                let bounce = if closing < -40.0 { 0.12 } else { 0.0 };
                let was = self.touches[t].pushed;
                let now = (was - (1.0 + bounce) * closing / weights[0]).max(0.0);
                self.touches[t].pushed = now;
                let knock = now * self.list[a].inv_mass;
                self.list[a].knock = self.list[a].knock.max(knock);
                if b != NONE {
                    let knock = now * self.list[b].inv_mass;
                    self.list[b].knock = self.list[b].knock.max(knock);
                }
                push(&mut self.list, 0, now - was);
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
        // What met hard enough to be told of (living.rs), before anything of it is broken.
        let met = self.meetings();
        // Where a big body struck the standing world hardest, the world breaks too: one such place a step, a few a second.
        self.since_crush += h;
        if self.since_crush > 0.12 && self.list.len() < MOST {
            let mut worst: Option<([i32; 3], f32, u32, Option<(V, V)>)> = None;
            for t in &self.touches {
                let body = &self.list[t.a];
                // A living thing may stand on a pavement for an hour: its weight alone breaks nothing, only a blow.
                if t.b == NONE && body.count >= 60 && t.pushed > HARD && body.live.as_ref().is_none_or(|live| t.closing < -15.0 && !live.figure) && worst.as_ref().is_none_or(|w| t.pushed > w.1) {
                    let p = sub(add(body.pos, t.ra), scale(t.n, 0.5));
                    worst = Some(([p[0].floor() as i32, p[1].floor() as i32, p[2].floor() as i32], t.pushed, body.id, body.live.is_some().then_some((add(body.pos, t.ra), t.n))));
                }
            }
            // The ground itself is not broken by what lands on it: only what is built.
            if let Some((at, push, id, live)) = worst {
                // A living thing goes fast and what it hits may be thin: the cell it met is looked for.
                let at = live.and_then(|(p, n)| self.met(p, n)).unwrap_or(at);
                if !matches!(material(self.ground.kind(at[0], at[1], at[2])), 0 | EARTH | ROCK | GRASS | SAND | WATER | ASPHALT) {
                    self.since_crush = 0.0;
                    self.crushes += 1;
                    self.broke(id, met);
                    self.crush(at, push);
                }
            }
        }
        #[cfg(test)]
        mark(3);
        // What was knocked harder than it can take breaks where it is.
        let mut i = 0;
        while i < self.list.len() {
            let b = &self.list[i];
            // A living thing breaks at the knock its motor says, or when a blast has reached it; and then lives no more.
            let (knock, takes) = match &b.live {
                None => (b.knock, breaks_at(b.stuff) * (1.0 + b.broken as f32)),
                Some(live) => { let lost = sub(b.vel, live.was); (if live.hurt { f32::MAX } else { dot(lost, lost).sqrt() }, live.tough) }
            };
            if let Some(live) = &mut self.list[i].live {
                live.jolt = live.jolt.max(knock);
            }
            let b = &self.list[i];
            if b.count >= WHOLE && !b.asleep && knock > takes && self.list.len() < MOST && !b.live.as_ref().is_some_and(|live| live.figure) {
                let whole = self.list.swap_remove(i);
                self.broke(whole.id, met);
                self.shatter(whole);
            } else {
                i += 1;
            }
        }
        #[cfg(test)]
        mark(4);
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
            // The longer a body has been about, the less still it need be: something rocking in a corner is put down.
            let ease = 1.0 + (b.age - 2.5).max(0.0) * 0.8;
            let slow = dot(b.vel, b.vel) < (STILL_SPEED * ease).powi(2) && dot(b.spin, b.spin) < (STILL_SPIN * ease).powi(2);
            // And it is at rest only if its weight is over what it touches: a chimney starting to go over is slow, not still.
            let f = b.footing;
            // Asked only of big things: a lump lies as it lands, propped on whatever is under it.
            let over = b.count < 1500 || (f[0] <= 0.5 && f[1] >= -0.5 && f[2] <= 0.5 && f[3] >= -0.5);
            b.still = if slow && b.apart < 0.1 && (over || b.age > OLD) { b.still + h } else { 0.0 };
            // Old and still on its way (a chimney going over takes its time) is left to it, up to a point.
            let stuck = b.age >= OLD && dot(b.vel, b.vel) < 400.0 && dot(b.spin, b.spin) < 0.25;
            if b.live.is_some() {
                Self::drowse(b, h);
                i += 1;
            } else if b.still >= STILL_FOR || stuck || b.age >= OLD * 3.0 {
                let body = self.list.swap_remove(i);
                self.rested.push((body.age * 10.0) as u32);
                self.rest(body);
            } else {
                i += 1;
            }
        }
        #[cfg(test)]
        mark(5);
    }

    /// A body that has come to rest is cells of the world again, as it lies. One lying nearly square to the world is
    /// put down square, cell for cell; one lying askew is cut along the world's cells, which changes how many it is.
    fn rest(&mut self, mut body: Body) {
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
}
