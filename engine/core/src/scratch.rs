//! A sector being made: its cells laid out flat, and the shapes that fill them. Shapes are told
//! in the world's finest cells; the scratch may be coarser (a far copy), so each fill says how a
//! shape that is thinner than a coarse cell is to be treated.

use crate::hash::hash3;
use crate::kinds::{crumbles, gives, material};
use crate::tree::{CELLS, Kind, SIDE, at};

/// A row of cells of one kind along x, in the finest cells: from `x0` up to but not `x1`, at `y` and `z`. Kind 0 empties them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Run {
    pub x0: i32,
    pub x1: i32,
    pub y: i32,
    pub z: i32,
    pub kind: Kind,
}

/// How a shape meets cells bigger than its detail.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Meet {
    /// Every cell the shape touches: a wall stays a wall however coarse.
    Touch,
    /// Cells whose middle is in the shape: trim and panes come and go fairly.
    Middle,
    /// Only cells wholly inside the shape: hollowing never eats the wall round it.
    Within,
}

/// How many blocks of finer cells one sector may hold (#259), and how many of its cells one edit of finer cells may
/// reach. An edit that would pass either is refused there whole (`Scratch::fine_runs`). So while an edit is tried
/// the scratch holds at most twice this many blocks, each 1 KiB.
pub const FINE_BLOCKS: usize = 16384;
/// How many words a sector's tree may be. One with no finer cells is never over `PLAIN_WORDS`; an edit of finer
/// cells whose blocks and their leaves' tables could take the tree past this is refused there whole.
pub const TREE_WORDS: usize = 1 << 19;
/// The most words a tree of cells alone can be: the root, 64 mids, 4,096 leaves, and every cell's kind (tree.rs).
pub const PLAIN_WORDS: usize = 4 + 4 * 64 + 4 * 4096 + CELLS / 2;
/// How many blocks' room a scratch keeps from one sector to the next: more is given back when the next is begun.
const KEPT_BLOCKS: usize = 1024;
const NONE: u32 = u32::MAX;

pub struct Scratch {
    pub cells: Vec<Kind>,
    /// The sector's low corner, in its own (perhaps coarse) cells.
    pub low: [i32; 3],
    /// How many times a cell's edge has doubled: 0 is the world's finest.
    pub lod: u32,
    /// Whether cells may hold finer cells (#259, the page's `bricks`): where they may not, an edit of finer cells is
    /// refused whole and the sector is what it would be without it.
    pub finer: bool,
    /// How many edits of finer cells this sector refused: the switch is off, or a limit above.
    pub refused: u32,
    /// Cells that hold finer cells (kinds.rs FINE): which block each such cell has (by its place in `cells`), and the
    /// blocks, each 8 x 8 x 8 kinds at x + 8 z + 64 y. A cell of quarter cells is written here two times each way;
    /// the tree says which it is (tree.rs `encode_fine`). A cell has the mark only while it has a block here that is
    /// neither empty nor all one kind: `fine_runs` alone gives the mark, and no shape or edit can (`plain`). A cell
    /// that lost its mark to a later shape may still be listed until the next edit of finer cells.
    pub fine_of: std::collections::HashMap<u32, u32>,
    pub fine: Vec<[Kind; 512]>,
    /// Blocks of `fine` that are no cell's, to be used again; how many words each block is in the tree; the cells an
    /// edit being tried reaches, a bit each; and what it changed: the cell, what it was, its block before and now.
    spare: Vec<u32>,
    words: Vec<u32>,
    reached: Vec<u64>,
    tried: Vec<(u32, Kind, u32, u32)>,
}

/// How far apart two places are, squared: an edit's ball may be anywhere, so it stops at the end of the numbers.
#[inline]
fn apart(dx: i64, dy: i64, dz: i64) -> i64 {
    dx.saturating_mul(dx).saturating_add(dy.saturating_mul(dy)).saturating_add(dz.saturating_mul(dz))
}

/// A kind as a shape or an edit may give it to a cell: without the mark of finer cells, which is the scratch's own.
#[inline]
pub const fn plain(kind: Kind) -> Kind {
    kind & !crate::kinds::FINE
}

impl Scratch {
    pub fn new() -> Self {
        Scratch { cells: vec![0; CELLS], low: [0; 3], lod: 0, finer: false, refused: 0, fine_of: Default::default(), fine: Vec::new(), spare: Vec::new(), words: Vec::new(), reached: Vec::new(), tried: Vec::new() }
    }

    pub fn start(&mut self, sx: i32, sy: i32, sz: i32, lod: u32) {
        self.cells.fill(0);
        // What a sector of many finer cells took is given back: only a little is kept for the next.
        if self.fine.capacity() > KEPT_BLOCKS {
            self.fine = Vec::new();
            self.fine_of = Default::default();
            self.spare = Vec::new();
            self.words = Vec::new();
            self.tried = Vec::new();
        }
        self.fine_of.clear();
        self.fine.clear();
        self.spare.clear();
        self.words.clear();
        self.refused = 0;
        self.low = [sx.wrapping_mul(SIDE as i32), sy.wrapping_mul(SIDE as i32), sz.wrapping_mul(SIDE as i32)];
        self.lod = lod;
    }

    /// The sector's low and high corners in the finest cells (high exclusive).
    pub fn bounds(&self) -> ([i32; 3], [i32; 3]) {
        let s = SIDE as i32;
        (self.low.map(|v| v << self.lod), self.low.map(|v| (v + s) << self.lod))
    }

    /// A span of the finest cells as a span of this scratch's cells along one axis, clipped to the sector.
    #[inline]
    fn span(&self, axis: usize, lo: i64, hi: i64, meet: Meet) -> (usize, usize) {
        let k = self.lod;
        let (a, b) = if k == 0 {
            (lo, hi)
        } else {
            let s = 1i64 << k;
            match meet {
                Meet::Touch => (lo >> k, (hi + s - 1) >> k),
                Meet::Middle => ((lo + s / 2 - 1) >> k, (hi + s / 2 - 1) >> k),
                Meet::Within => ((lo + s - 1) >> k, hi >> k),
            }
        };
        let (a, b) = (a - self.low[axis] as i64, b - self.low[axis] as i64);
        (a.clamp(0, SIDE as i64) as usize, b.clamp(0, SIDE as i64) as usize)
    }

    /// Fills a box, corners in the finest cells (`hi` exclusive). Kind 0 empties it.
    pub fn fill(&mut self, lo: [i32; 3], hi: [i32; 3], kind: Kind, meet: Meet) {
        let (x0, x1) = self.span(0, lo[0] as i64, hi[0] as i64, meet);
        let (y0, y1) = self.span(1, lo[1] as i64, hi[1] as i64, meet);
        let (z0, z1) = self.span(2, lo[2] as i64, hi[2] as i64, meet);
        if x0 >= x1 || y0 >= y1 || z0 >= z1 {
            return;
        }
        for y in y0..y1 {
            for z in z0..z1 {
                self.cells[at(x0, y, z)..at(x1, y, z)].fill(kind);
            }
        }
    }

    /// Fills a ball, centre and radius in the finest cells. `thin` of every 256 cells are left as they were (a tree's crown
    /// has gaps), by `seed`. With `within` only the air inside that box (low corner, high corner exclusive) is filled:
    /// a crown grows round what is there and stops at a line, it does not eat into a wall.
    pub fn ball(&mut self, centre: [i32; 3], r: i32, kind: Kind, thin: u32, seed: u32, within: Option<([i32; 3], [i32; 3])>) {
        // A ball of no size or less holds nothing.
        let (c, r) = (centre.map(|v| v as i64), r as i64);
        let (x0, x1) = self.span(0, c[0] - r, c[0] + r + 1, Meet::Touch);
        let (y0, y1) = self.span(1, c[1] - r, c[1] + r + 1, Meet::Touch);
        let (z0, z1) = self.span(2, c[2] - r, c[2] + r + 1, Meet::Touch);
        let (k, half) = (self.lod, (1i64 << self.lod) / 2);
        let r2 = r * r;
        for y in y0..y1 {
            for z in z0..z1 {
                for x in x0..x1 {
                    // The cell's middle, in the finest cells.
                    let wx = (((self.low[0] + x as i32) as i64) << k) + half;
                    let wy = (((self.low[1] + y as i32) as i64) << k) + half;
                    let wz = (((self.low[2] + z as i32) as i64) << k) + half;
                    let (dx, dy, dz) = (wx - centre[0] as i64, wy - centre[1] as i64, wz - centre[2] as i64);
                    if apart(dx, dy, dz) > r2 {
                        continue;
                    }
                    if let Some((lo, hi)) = within {
                        let inside = wx >= lo[0] as i64 && wx < hi[0] as i64 && wy >= lo[1] as i64 && wy < hi[1] as i64 && wz >= lo[2] as i64 && wz < hi[2] as i64;
                        if !inside || self.cells[at(x, y, z)] != 0 {
                            continue;
                        }
                    }
                    if thin > 0 && hash3(wx as i32, wy as i32, wz as i32, seed) & 255 < thin {
                        continue;
                    }
                    self.cells[at(x, y, z)] = kind;
                }
            }
        }
    }

    /// A blast: empties the cells round `centre`, each as far out as its material gives (kinds.rs), with the
    /// edge left ragged by `seed` where the material crumbles. `r` is the blast's own radius, in the finest cells.
    pub fn blast(&mut self, centre: [i32; 3], r: i32, seed: u32) {
        let (c, reach) = (centre.map(|v| v as i64), r as i64 * 44 / 16 + 1);
        let (x0, x1) = self.span(0, c[0] - reach, c[0] + reach + 1, Meet::Touch);
        let (y0, y1) = self.span(1, c[1] - reach, c[1] + reach + 1, Meet::Touch);
        let (z0, z1) = self.span(2, c[2] - reach, c[2] + reach + 1, Meet::Touch);
        let (k, half) = (self.lod, (1i64 << self.lod) / 2);
        for y in y0..y1 {
            for z in z0..z1 {
                for x in x0..x1 {
                    let kind = self.cells[at(x, y, z)];
                    if kind == 0 {
                        continue;
                    }
                    let wx = (((self.low[0] + x as i32) as i64) << k) + half;
                    let wy = (((self.low[1] + y as i32) as i64) << k) + half;
                    let wz = (((self.low[2] + z as i32) as i64) << k) + half;
                    let (dx, dy, dz) = (wx - centre[0] as i64, wy - centre[1] as i64, wz - centre[2] as i64);
                    let m = material(kind);
                    // Lumps: cells in fours share a number, so the edge breaks in pieces bigger than a cell.
                    let lump = (hash3((wx >> 1) as i32, (wy >> 1) as i32, (wz >> 1) as i32, seed) & 15) as i64 - 8;
                    let out = (r as i64) * (gives(m) as i64 * 8 + crumbles(m) as i64 * lump) / 128;
                    if out > 0 && apart(dx, dy, dz) <= out.saturating_mul(out) {
                        self.cells[at(x, y, z)] = 0;
                    }
                }
            }
        }
    }

    /// Rows of cells finer than the world's (#259): x0, x1, y and z count cells of which `1 << shift` lie along one of
    /// the world's (4 or 8). Returns whether the sector took them: it takes all of them or none.
    ///
    /// In the finest copy a cell they reach holds a block of finer cells (a cell that was whole is first that kind all
    /// through, so a row of kind 0 cuts a notch a fine cell wide); a block left empty is air again and one left full
    /// of one kind a plain cell. The rows are refused where the switch is off (`finer`), where they reach more than
    /// `FINE_BLOCKS` of the sector's cells (a row of kind 0 does not reach a cell of air), where the sector would
    /// then hold more than `FINE_BLOCKS` blocks, and where its blocks and their leaves' tables could then take its
    /// tree past `TREE_WORDS`. A sector that refuses them is as it was before them, and says so in `refused`.
    ///
    /// A coarser copy takes them as it takes rows of the world's own cells (`runs`): a row through the middle of one
    /// of its cells sets or empties that cell, a later row over an earlier. So what rows put there, the same rows of
    /// kind 0 take away. It has no blocks and no limit, and takes rows the finest copy refused for a limit.
    pub fn fine_runs(&mut self, runs: &[Run], shift: u32) -> bool {
        use crate::kinds::FINE;
        if !self.finer || !(2..=3).contains(&shift) {
            self.refused += 1;
            return false;
        }
        let (low, side) = (self.low.map(|v| v as i64), SIDE as i64);
        if self.lod > 0 {
            let k = shift + self.lod;
            if k > 40 {
                return true;
            }
            let (half, mask) = ((1i64 << k) / 2, (1i64 << k) - 1);
            for r in runs {
                if r.y as i64 & mask != half || r.z as i64 & mask != half {
                    continue;
                }
                let (y, z) = ((r.y as i64 >> k) - low[1], (r.z as i64 >> k) - low[2]);
                if y < 0 || y >= side || z < 0 || z >= side {
                    continue;
                }
                let x0 = (((r.x0 as i64 + half - 1) >> k) - low[0]).clamp(0, side) as usize;
                let x1 = (((r.x1 as i64 + half - 1) >> k) - low[0]).clamp(0, side) as usize;
                if x0 < x1 {
                    self.cells[at(x0, y as usize, z as usize)..at(x1, y as usize, z as usize)].fill(plain(r.kind));
                }
            }
            return true;
        }
        let per = 1i64 << shift;
        // The part of a row that lies in this sector: its line of cells, and from which fine cell to which along it,
        // counted from the sector's side.
        let clip = |r: &Run| {
            let (y, z) = ((r.y as i64 >> shift) - low[1], (r.z as i64 >> shift) - low[2]);
            let (x0, x1) = ((r.x0 as i64 - low[0] * per).max(0), (r.x1 as i64 - low[0] * per).min(side * per));
            (y >= 0 && y < side && z >= 0 && z < side && x0 < x1).then_some((y as usize, z as usize, x0, x1))
        };
        // Cells that lost their mark to a later shape give their blocks back.
        {
            let Scratch { cells, fine_of, spare, .. } = self;
            fine_of.retain(|&i, slot| {
                let keeps = cells[i as usize] & FINE != 0;
                if !keeps {
                    spare.push(*slot);
                }
                keeps
            });
        }
        // How many cells the rows reach, before any is given a block. Nothing taken out of air changes it.
        self.reached.clear();
        self.reached.resize(CELLS / 64, 0);
        let mut reached = 0;
        for r in runs {
            let Some((y, z, x0, x1)) = clip(r) else { continue };
            for x in (x0 >> shift) as usize..=((x1 - 1) >> shift) as usize {
                let i = at(x, y, z);
                if self.reached[i / 64] >> (i % 64) & 1 == 0 && (plain(r.kind) != 0 || self.cells[i] != 0) {
                    self.reached[i / 64] |= 1 << (i % 64);
                    reached += 1;
                }
            }
            if reached > FINE_BLOCKS {
                self.refused += 1;
                return false;
            }
        }
        if reached == 0 {
            return true;
        }
        // The rows are tried: each cell they reach gets a block of its own to be changed in, and the block it had is
        // kept until it is known that the sector takes them.
        self.tried.clear();
        // How many of a block's cells one of the rows' cells is, each way.
        let wide = (8 >> shift) as usize;
        for r in runs {
            let Some((y, z, x0, x1)) = clip(r) else { continue };
            let (kind, ly, lz) = (plain(r.kind), (r.y as i64 & (per - 1)) as usize * wide, (r.z as i64 & (per - 1)) as usize * wide);
            for x in (x0 >> shift)..=((x1 - 1) >> shift) {
                let i = at(x as usize, y, z);
                let slot = if self.reached[i / 64] >> (i % 64) & 1 != 0 {
                    self.reached[i / 64] &= !(1 << (i % 64));
                    let was = self.cells[i];
                    let old = if was & FINE != 0 { self.fine_of.get(&(i as u32)).copied().unwrap_or(NONE) } else { NONE };
                    let from = if old != NONE { self.fine[old as usize] } else { [plain(was); 512] };
                    let slot = match self.spare.pop() {
                        Some(slot) => {
                            self.fine[slot as usize] = from;
                            slot
                        }
                        None => {
                            self.fine.push(from);
                            self.words.push(0);
                            self.fine.len() as u32 - 1
                        }
                    };
                    self.fine_of.insert(i as u32, slot);
                    self.tried.push((i as u32, was, old, slot));
                    slot
                } else {
                    let Some(&slot) = self.fine_of.get(&(i as u32)) else { continue };
                    slot
                };
                let (from, to) = ((x0.max(x * per) - x * per) as usize * wide, (x1.min((x + 1) * per) - x * per) as usize * wide);
                for dy in 0..wide {
                    for dz in 0..wide {
                        let line = 8 * (lz + dz) + 64 * (ly + dy);
                        self.fine[slot as usize][line + from..line + to].fill(kind);
                    }
                }
            }
        }
        // What each block came to: air, a plain cell, or a cell of fine cells whose own kind is what most of them are.
        let mut counts: Vec<(Kind, u32)> = Vec::new();
        for &(i, _, _, slot) in &self.tried {
            let b = &self.fine[slot as usize];
            counts.clear();
            for &k in b.iter().filter(|&&k| k != 0) {
                match counts.iter_mut().find(|c| c.0 == k) {
                    Some(c) => c.1 += 1,
                    None => counts.push((k, 1)),
                }
            }
            self.cells[i as usize] = match counts.iter().max_by_key(|c| c.1) {
                None => 0,
                Some(&(k, 512)) => k,
                Some(&(k, _)) => k | FINE,
            };
            self.words[slot as usize] = crate::tree::block_words(b) as u32;
        }
        // How many blocks the sector now has, and what they and a table for each leaf that has one are in its tree.
        let (mut blocks, mut words, mut leaves) = (0, 0, [0u64; 64]);
        for (&i, &slot) in &self.fine_of {
            if self.cells[i as usize] & FINE == 0 {
                continue;
            }
            blocks += 1;
            let i = i as usize;
            let leaf = (i % SIDE) / 4 + 16 * ((i / SIDE % SIDE) / 4 + 16 * (i / (SIDE * SIDE) / 4));
            if leaves[leaf / 64] >> (leaf % 64) & 1 == 0 {
                leaves[leaf / 64] |= 1 << (leaf % 64);
                words += 64;
            }
            words += self.words[slot as usize] as usize;
        }
        let took = blocks <= FINE_BLOCKS && PLAIN_WORDS + words <= TREE_WORDS;
        for &(i, was, old, slot) in &self.tried {
            if !took {
                // As it was: the cell, and the block it had.
                self.spare.push(slot);
                self.cells[i as usize] = was;
                if old != NONE {
                    self.fine_of.insert(i, old);
                } else {
                    self.fine_of.remove(&i);
                }
                continue;
            }
            if old != NONE {
                self.spare.push(old);
            }
            if self.cells[i as usize] & FINE == 0 {
                self.fine_of.remove(&i);
                self.spare.push(slot);
            }
        }
        self.refused += !took as u32;
        took
    }

    /// Sets rows of cells: a piece taken out of the world (kind 0) or put down in it. The rows are sorted by y, then z,
    /// then x. A copy a little coarser takes a row where it passes through a cell's middle. A copy coarser still, in
    /// which a house is solid, takes each line of rows from its first cell to its last, as the solid thing the piece is:
    /// when the rows are one piece's (`lines`), and each row by itself when they are what many edits came to.
    pub fn runs(&mut self, runs: &[Run], lines: bool) {
        let (k, side) = (self.lod, SIDE as i64);
        let low = self.low.map(|v| v as i64);
        if k == 0 {
            // The rows are sorted by y: only those at this sector's heights are looked at.
            let (first, last) = (runs.partition_point(|r| (r.y as i64) < low[1]), runs.partition_point(|r| (r.y as i64) < low[1] + side));
            // Rows that are not in order may give a first past the last: then all are looked at.
            let rows = if first <= last { &runs[first..last] } else { runs };
            for r in rows {
                let (y, z) = (r.y as i64 - low[1], r.z as i64 - low[2]);
                if y < 0 || y >= side || z < 0 || z >= side {
                    continue;
                }
                let (x0, x1) = ((r.x0 as i64 - low[0]).clamp(0, side) as usize, (r.x1 as i64 - low[0]).clamp(0, side) as usize);
                if x0 < x1 {
                    self.cells[at(x0, y as usize, z as usize)..at(x1, y as usize, z as usize)].fill(plain(r.kind));
                }
            }
            return;
        }
        if k > 30 {
            return;
        }
        let (half, mask) = ((1 << k) / 2, (1 << k) - 1);
        let mut i = 0;
        while i < runs.len() {
            // The runs of one line.
            let mut j = i + 1;
            while j < runs.len() && runs[j].y == runs[i].y && runs[j].z == runs[i].z {
                j += 1;
            }
            let line = &runs[i..j];
            i = j;
            let (wy, wz) = (line[0].y, line[0].z);
            if wy & mask != half || wz & mask != half {
                continue;
            }
            let (y, z) = ((wy >> k) as i64 - low[1], (wz >> k) as i64 - low[2]);
            if y < 0 || y >= side || z < 0 || z >= side {
                continue;
            }
            if k >= 2 && lines {
                let (x0, x1) = self.span(0, line[0].x0 as i64, line[line.len() - 1].x1 as i64, Meet::Middle);
                if x0 < x1 {
                    self.cells[at(x0, y as usize, z as usize)..at(x1, y as usize, z as usize)].fill(plain(line[0].kind));
                }
            } else {
                for r in line {
                    let (x0, x1) = self.span(0, r.x0 as i64, r.x1 as i64, Meet::Middle);
                    if x0 < x1 {
                        self.cells[at(x0, y as usize, z as usize)..at(x1, y as usize, z as usize)].fill(plain(r.kind));
                    }
                }
            }
        }
    }
}

/// Edits of rows, one after another, as rows that leave a column of sectors the same in the copy `lod` times coarser:
/// only what that copy reads of them (see `Scratch::runs`), a later row over an earlier, cut to the column (`x` and
/// `z`, low and high, in the finest cells). Sorted by y, then z, then x. Edits that are not rows are passed over.
pub fn merged(edits: &[crate::Edit], lod: u32, x: [i32; 2], z: [i32; 2]) -> Vec<Run> {
    use std::collections::BTreeMap;
    let (half, mask) = ((1 << lod) / 2, (1 << lod) - 1);
    let mut lines: BTreeMap<(i32, i32), Vec<Run>> = BTreeMap::new();
    let mut lay = |r: Run| {
        let r = Run { x0: r.x0.max(x[0]), x1: r.x1.min(x[1]), ..r };
        if r.x0 >= r.x1 {
            return;
        }
        let line = lines.entry((r.y, r.z)).or_default();
        // What it covers of the rows already there is cut away.
        let mut kept = Vec::with_capacity(line.len() + 2);
        for old in line.drain(..) {
            if old.x1 <= r.x0 || old.x0 >= r.x1 {
                kept.push(old);
                continue;
            }
            if old.x0 < r.x0 {
                kept.push(Run { x1: r.x0, ..old });
            }
            if old.x1 > r.x1 {
                kept.push(Run { x0: r.x1, ..old });
            }
        }
        kept.push(r);
        kept.sort_unstable_by_key(|r| r.x0);
        *line = kept;
    };
    for e in edits {
        let (runs, whole) = match e {
            crate::Edit::Runs(runs) => (runs, lod >= 2),
            crate::Edit::Rows(runs) => (runs, false),
            _ => continue,
        };
        let mut i = 0;
        while i < runs.len() {
            let mut j = i + 1;
            while j < runs.len() && runs[j].y == runs[i].y && runs[j].z == runs[i].z {
                j += 1;
            }
            let line = &runs[i..j];
            i = j;
            let (y, wz) = (line[0].y, line[0].z);
            if wz < z[0] || wz >= z[1] || (lod > 0 && (y & mask != half || wz & mask != half)) {
                continue;
            }
            if whole {
                lay(Run { x0: line[0].x0, x1: line[line.len() - 1].x1, ..line[0] });
            } else {
                for r in line {
                    lay(*r);
                }
            }
        }
    }
    lines.into_values().flatten().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kinds::{BRICK, kind};
    use crate::{Edit, fill, hash::hash};

    #[test]
    fn many_edits_of_rows_merged_leave_every_copy_the_same() {
        // Rows scattered through one sector's place at each coarseness, some over others, some emptying.
        for lod in 0..4u32 {
            let side = (SIDE as i32) << lod;
            let (sx, sy, sz) = (3, 0, 5);
            let low = [sx * side, sy * side, sz * side];
            let edits: Vec<Edit> = (0..12)
                .map(|e| {
                    let mut runs: Vec<Run> = (0..300)
                        .map(|i| {
                            let h = |n: u32| hash(e, i, n) as i32;
                            let x0 = low[0] - 20 + h(1).rem_euclid(side + 20);
                            Run { x0, x1: x0 + 1 + h(2).rem_euclid(40 << lod), y: low[1] + h(3).rem_euclid(side), z: low[2] - 4 + h(4).rem_euclid(side + 8), kind: if h(5) % 3 == 0 { 0 } else { kind(BRICK, 1 + (e as u8 % 5)) } }
                        })
                        .collect();
                    runs.sort_unstable_by_key(|r| (r.y, r.z, r.x0));
                    Edit::Runs(runs)
                })
                .collect();
            let (mut one, mut other) = (Scratch::new(), Scratch::new());
            fill(&mut one, sx, sy, sz, lod, &edits);
            let rows = merged(&edits, lod, [low[0], low[0] + side], [low[2], low[2] + side]);
            assert!(rows.windows(2).all(|w| (w[0].y, w[0].z, w[0].x1) <= (w[1].y, w[1].z, w[1].x0)), "the merged rows are in order and none lies over another");
            fill(&mut other, sx, sy, sz, lod, &[Edit::Rows(rows)]);
            let differ = one.cells.iter().zip(&other.cells).filter(|(a, b)| a != b).count();
            assert_eq!(differ, 0, "{lod} times coarser, {differ} cells differ between the edits one after another and merged");
        }
    }
}
