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
    /// For a coarse copy taking rows (`rows`): how many of each cell's finest cells rows emptied, of all of them
    /// and of those that count, and which cells have a count.
    emptied: Vec<[u32; 2]>,
    counted: Vec<u32>,
}

/// How far apart two places are, squared: an edit's ball may be anywhere, so it stops at the end of the numbers.
#[inline]
fn apart(dx: i64, dy: i64, dz: i64) -> i64 {
    dx.saturating_mul(dx).saturating_add(dy.saturating_mul(dy)).saturating_add(dz.saturating_mul(dz))
}

/// Whether a blast of radius `r` at `centre` empties a cell of `kind` whose middle is `at`: each material as far out
/// as it gives (kinds.rs), the edge left ragged by `seed` where it crumbles. Cells in fours share a number, so the
/// edge breaks in pieces bigger than a cell.
#[inline]
fn blown(at: [i64; 3], kind: Kind, centre: [i64; 3], r: i64, seed: u32) -> bool {
    let m = material(kind);
    let lump = (hash3((at[0] >> 1) as i32, (at[1] >> 1) as i32, (at[2] >> 1) as i32, seed) & 15) as i64 - 8;
    let out = r * (gives(m) as i64 * 8 + crumbles(m) as i64 * lump) / 128;
    out > 0 && apart(at[0] - centre[0], at[1] - centre[1], at[2] - centre[2]) <= out.saturating_mul(out)
}

/// The whole number whose square is the most that is not over `v` (which is not below zero).
fn root(v: i64) -> i64 {
    let v = v.min(1 << 62);
    let mut w = (v as f64).sqrt() as i64;
    while w.saturating_mul(w) > v {
        w -= 1;
    }
    while (w + 1).saturating_mul(w + 1) <= v {
        w += 1;
    }
    w
}

/// A kind as a shape or an edit may give it to a cell: without the mark of finer cells, which is the scratch's own.
#[inline]
pub const fn plain(kind: Kind) -> Kind {
    kind & !crate::kinds::FINE
}

impl Scratch {
    pub fn new() -> Self {
        Scratch { cells: vec![0; CELLS], low: [0; 3], lod: 0, finer: false, refused: 0, fine_of: Default::default(), fine: Vec::new(), spare: Vec::new(), words: Vec::new(), reached: Vec::new(), tried: Vec::new(), emptied: Vec::new(), counted: Vec::new() }
    }

    pub fn start(&mut self, sx: i32, sy: i32, sz: i32, lod: u32) {
        self.cells.fill(0);
        self.start_raw(sx, sy, sz, lod);
    }

    /// As `start`, without zero-filling `cells`: for callers (`Ground::fill`) that immediately overwrite every cell.
    pub fn start_raw(&mut self, sx: i32, sy: i32, sz: i32, lod: u32) {
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
                    if blown([wx, wy, wz], kind, c, r as i64, seed) {
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
    /// A coarser copy takes them by its cells' middles (rows of the world's own cells no longer: `rows`): a row
    /// through the middle of one of its cells sets or empties that cell, a later row over an earlier. So what rows put there, the same rows of
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

    /// Sets rows of cells in the finest copy: a piece taken out of the world (kind 0) or put down in it. The rows are
    /// sorted by y, then z, then x.
    pub fn runs(&mut self, runs: &[Run]) {
        let side = SIDE as i64;
        let low = self.low.map(|v| v as i64);
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
    }

    /// What rows of the finest cells come to in a coarser copy. `runs` are what every edit of rows left, a later
    /// over an earlier (`Laid`): none lies over another, sorted by y, then z, then x. A coarse cell stands for all
    /// the cells it covers, as the town's own rule has it (a wall touches, the ground's top cell is the surface's
    /// kind): a cell any row fills is solid and is the kind of the highest row that fills it, so a thing one cell
    /// thin is in every copy; a cell no row fills is air once rows have emptied half of it or more, so a thing
    /// taken away is gone and a nick is not a pit. A cell the ground's top passes through (anywhere between the
    /// lowest and the highest of its column's ground and the four columns' beside it) is mostly air already, and
    /// taking away what stood on the ground empties only air there: in such a cell only what is emptied under the
    /// lowest of those tops counts, against that much of the cell (or the cell is emptied whole), so the ground is
    /// dug away by digging and not by clearing what was on it. Emptying is counted in cells up to 2^10 across; coarser than that rows only fill.
    pub fn rows(&mut self, runs: &[Run]) {
        let (k, side) = (self.lod, SIDE as i64);
        if k == 0 || k > 30 {
            return;
        }
        let low = self.low.map(|v| v as i64);
        // The row's line and the cells along it that it reaches in this sector, and where the sector begins in the finest cells.
        let from = low[0] << k;
        let reach = |r: &Run| {
            let (y, z) = ((r.y as i64 >> k) - low[1], (r.z as i64 >> k) - low[2]);
            let (x0, x1) = ((r.x0 as i64).max(from), (r.x1 as i64).min(from + (side << k)));
            (y >= 0 && y < side && z >= 0 && z < side && x0 < x1).then(|| (y as usize, z as usize, x0 - from, x1 - from))
        };
        if k <= 10 && runs.iter().any(|r| r.kind == 0) {
            self.emptied.resize(CELLS, [0; 2]);
            // The ground's top at the middle of each column that is asked about and of those beside it, as the
            // town's far copies take it; then the lowest and highest of a column's and its four neighbours'.
            let wide = SIDE + 2;
            let mut tops = vec![i64::MIN; wide * wide];
            let mut band = |x: usize, z: usize| {
                let mut top = |x: usize, z: usize| {
                    let t = &mut tops[x + wide * z];
                    if *t == i64::MIN {
                        let middle = |v: i64| (((v << k) + (1 << k) / 2).clamp(i32::MIN as i64, i32::MAX as i64)) as i32;
                        *t = crate::city::ground(middle(low[0] + x as i64 - 1), middle(low[2] + z as i64 - 1)) as i64;
                    }
                    *t
                };
                let all = [top(x + 1, z + 1), top(x, z + 1), top(x + 2, z + 1), top(x + 1, z), top(x + 1, z + 2)];
                (all.into_iter().min().unwrap_or(0), all.into_iter().max().unwrap_or(0))
            };
            // How many sheets of a cell count: all `1 << k`, or in a cell the ground's top passes through those under the lowest top (none, perhaps).
            let sheets = |y: usize, (lo, hi): (i64, i64)| {
                let (y0, y1) = ((low[1] + y as i64) << k, ((low[1] + y as i64 + 1) << k) - 1);
                if y1 < lo || y0 > hi { 1 << k } else { (lo.min(y1) - y0 + 1).max(0) }
            };
            for r in runs.iter().filter(|r| r.kind == 0) {
                let Some((y, z, x0, x1)) = reach(r) else { continue };
                for x in x0 >> k..=(x1 - 1) >> k {
                    let (i, n) = (at(x as usize, y, z), (x1.min((x + 1) << k) - x0.max(x << k)) as u32);
                    if self.emptied[i][0] == 0 {
                        self.counted.push(i as u32);
                    }
                    self.emptied[i][0] += n;
                    if (r.y as i64 - ((low[1] + y as i64) << k)) < sheets(y, band(x as usize, z)) {
                        self.emptied[i][1] += n;
                    }
                }
            }
            for i in std::mem::take(&mut self.counted) {
                let i = i as usize;
                let has = sheets(i / (SIDE * SIDE), band(i % SIDE, i / SIDE % SIDE)) << (2 * k);
                let [all, under] = self.emptied[i].map(|n| n as i64);
                if all == 1 << (3 * k) || (has > 0 && under * 2 >= has) {
                    self.cells[i] = 0;
                }
                self.emptied[i] = [0; 2];
            }
        }
        for r in runs.iter().filter(|r| r.kind != 0) {
            let Some((y, z, x0, x1)) = reach(r) else { continue };
            self.cells[at((x0 >> k) as usize, y, z)..=at(((x1 - 1) >> k) as usize, y, z)].fill(plain(r.kind));
        }
    }
}

/// What edits of rows have come to, in the finest cells: every row laid, a later over an earlier, line by line,
/// within a box (low corner, high corner exclusive). It is what the finest copy holds wherever a row has been, so a
/// coarser copy can be made from it (`Scratch::rows`), and a blast or a ball that came after the rows is told to it
/// as it is to the finest cells.
///
/// Rows that come already laid (what `merged` gave a column earlier) are kept as they are, and only the lines that
/// something comes to after them are taken out to be changed: a far column holds every row of a built place, and
/// each edit near it must not cost a walk of them all.
pub struct Laid {
    /// Rows taken as they came: none over another, sorted by y, then z, then x.
    base: Vec<Run>,
    /// The lines laid on since, each whole: what `base` had on that line is in it, and counts there no more.
    lines: std::collections::BTreeMap<(i32, i32), Vec<Run>>,
    low: [i32; 3],
    high: [i32; 3],
}

impl Laid {
    pub fn within(low: [i32; 3], high: [i32; 3]) -> Self {
        Laid { base: Vec::new(), lines: Default::default(), low, high }
    }

    /// The box of a sector `lod` times coarser, in the finest cells, held to the end of the numbers.
    pub fn of(s: &Scratch) -> Self {
        let end = |v: i32| ((v as i64) << s.lod.min(31)).clamp(i32::MIN as i64, i32::MAX as i64) as i32;
        Laid::within(s.low.map(end), s.low.map(|v| end(v.saturating_add(SIDE as i32))))
    }

    /// A row as far as it is in the box.
    fn cut(&self, r: &Run) -> Option<Run> {
        let r = Run { x0: r.x0.max(self.low[0]), x1: r.x1.min(self.high[0]), kind: plain(r.kind), ..*r };
        (r.x0 < r.x1 && r.y >= self.low[1] && r.y < self.high[1] && r.z >= self.low[2] && r.z < self.high[2]).then_some(r)
    }

    /// A line to be changed: with what the rows taken as they came had on it.
    fn line(&mut self, y: i32, z: i32) -> &mut Vec<Run> {
        let base = &self.base;
        self.lines.entry((y, z)).or_insert_with(|| {
            let from = base.partition_point(|r| (r.y, r.z) < (y, z));
            base[from..from + base[from..].partition_point(|r| (r.y, r.z) == (y, z))].to_vec()
        })
    }

    /// Lays one row over what is there. With `under` it goes only where no row has filled.
    fn lay(&mut self, r: Run, under: bool) {
        let Some(r) = self.cut(&r) else { return };
        let line = self.line(r.y, r.z);
        if line.last().is_none_or(|l| l.x1 <= r.x0) {
            line.push(r);
            return;
        }
        // What it covers of the rows already there is cut away; under them, it is cut where they fill.
        let mut kept = Vec::with_capacity(line.len() + 2);
        let mut from = r.x0;
        for old in line.drain(..) {
            if old.x1 <= r.x0 || old.x0 >= r.x1 {
                kept.push(old);
                continue;
            }
            if under && old.kind != 0 {
                if old.x0 > from {
                    kept.push(Run { x0: from, x1: old.x0, ..r });
                }
                from = from.max(old.x1);
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
        if from < r.x1 {
            kept.push(Run { x0: from, ..r });
        }
        kept.sort_unstable_by_key(|r| r.x0);
        *line = kept;
    }

    /// Takes one edit of rows. With `whole`, a line of rows that only empty is a piece taken out of something that
    /// far copies hold solid (a house): the line is emptied from its first cell to its last, but not where an
    /// earlier edit filled.
    pub fn take(&mut self, runs: &[Run], whole: bool) {
        if !whole && self.base.is_empty() && self.lines.is_empty() && laid(runs) {
            self.base = runs.iter().filter_map(|r| self.cut(r)).collect();
            return;
        }
        let mut i = 0;
        while i < runs.len() {
            let mut j = i + 1;
            while j < runs.len() && runs[j].y == runs[i].y && runs[j].z == runs[i].z {
                j += 1;
            }
            let line = &runs[i..j];
            i = j;
            let (y, z) = (line[0].y, line[0].z);
            if y < self.low[1] || y >= self.high[1] || z < self.low[2] || z >= self.high[2] {
                continue;
            }
            for r in line {
                self.lay(*r, false);
            }
            if whole && line.len() > 1 && line.iter().all(|r| r.kind == 0) {
                for w in line.windows(2) {
                    self.lay(Run { x0: w[0].x1, x1: w[1].x0, ..w[0] }, true);
                }
            }
        }
    }

    /// The lines within `reach` of a place that may be changed there: those with a row within `reach` of it along x
    /// too (with `filled`, a row that fills). Each is taken out to be changed.
    fn near(&mut self, c: [i64; 3], reach: i64, filled: bool) -> Vec<(i32, i32)> {
        let end = |v: i64| v.clamp(i32::MIN as i64, i32::MAX as i64) as i32;
        let (y0, y1, z0, z1) = (end(c[1] - reach), end(c[1] + reach), end(c[2] - reach), end(c[2] + reach));
        let touched = |r: &Run| !(filled && r.kind == 0) && (r.x1 as i64) > c[0] - reach && (r.x0 as i64) <= c[0] + reach;
        let rows = &self.base[self.base.partition_point(|r| r.y < y0)..self.base.partition_point(|r| r.y <= y1)];
        let mut found: Vec<(i32, i32)> = rows.iter().filter(|r| r.z >= z0 && r.z <= z1 && touched(r)).map(|r| (r.y, r.z)).collect();
        found.dedup();
        // The lines laid on since, a height at a time; a reach taller than there are lines is looked through whole.
        let any = |line: &Vec<Run>| line.iter().any(touched);
        if (y1 as i64 - y0 as i64) < self.lines.len() as i64 {
            for y in y0..=y1 {
                found.extend(self.lines.range((y, z0)..=(y, z1)).filter(|(_, line)| any(line)).map(|(&at, _)| at));
            }
        } else {
            found.extend(self.lines.range((y0, i32::MIN)..=(y1, i32::MAX)).filter(|(at, line)| at.1 >= z0 && at.1 <= z1 && any(line)).map(|(&at, _)| at));
        }
        found.sort_unstable();
        found.dedup();
        for &(y, z) in &found {
            self.line(y, z);
        }
        found
    }

    /// A blast after the rows: every cell a row filled is emptied or not as the finest copy's is (`blown`).
    pub fn blast(&mut self, centre: [i32; 3], r: i32, seed: u32) {
        let (c, reach) = (centre.map(|v| v as i64), r as i64 * 44 / 16 + 1);
        if r <= 0 {
            return;
        }
        for (y, z) in self.near(c, reach, true) {
            let Some(line) = self.lines.get_mut(&(y, z)) else { continue };
            let mut kept: Vec<Run> = Vec::with_capacity(line.len() + 2);
            let mut put = |r: Run| match kept.last_mut() {
                Some(l) if l.x1 == r.x0 && l.kind == r.kind => l.x1 = r.x1,
                _ => kept.push(r),
            };
            for old in line.drain(..) {
                let (x0, x1) = ((old.x0 as i64).max(c[0] - reach), (old.x1 as i64).min(c[0] + reach + 1));
                if old.kind == 0 || x0 >= x1 {
                    put(old);
                    continue;
                }
                if (old.x0 as i64) < x0 {
                    put(Run { x1: x0 as i32, ..old });
                }
                // Nearer than the least its material gives, every cell goes; past the most, none: only between
                // the two is each cell asked.
                let (m, off) = (material(old.kind), apart(0, y as i64 - c[1], z as i64 - c[2]));
                let out = |lump: i64| (r as i64 * (gives(m) as i64 * 8 + crumbles(m) as i64 * lump) / 128).max(0);
                let half = |out: i64| if out == 0 || out.saturating_mul(out) < off { -1 } else { root(out.saturating_mul(out) - off) };
                let (sure, may) = (half(out(-8)), half(out(7)));
                let mut x = x0;
                while x < x1 {
                    let d = (x - c[0]).abs();
                    let (kind, to) = if d > may {
                        (old.kind, if x < c[0] { c[0] - may } else { x1 })
                    } else if d <= sure {
                        (0, c[0] + sure + 1)
                    } else {
                        (if blown([x, y as i64, z as i64], old.kind, c, r as i64, seed) { 0 } else { old.kind }, x + 1)
                    };
                    let to = to.clamp(x + 1, x1);
                    put(Run { x0: x as i32, x1: to as i32, kind, ..old });
                    x = to;
                }
                if (old.x1 as i64) > x1 {
                    put(Run { x0: x1 as i32, ..old });
                }
            }
            *line = kept;
        }
    }

    /// A ball filled after the rows: inside it the rows say nothing any more, and the ball is what is there.
    pub fn ball(&mut self, centre: [i32; 3], r: i32) {
        if r < 0 {
            return;
        }
        let (c, r) = (centre.map(|v| v as i64), r as i64);
        for (y, z) in self.near(c, r, false) {
            let Some(line) = self.lines.get_mut(&(y, z)) else { continue };
            let left = r * r - apart(0, y as i64 - c[1], z as i64 - c[2]);
            if left < 0 {
                continue;
            }
            let w = root(left);
            let (x0, x1) = (c[0] - w, c[0] + w + 1);
            let mut kept = Vec::with_capacity(line.len() + 1);
            for old in line.drain(..) {
                if (old.x1 as i64) <= x0 || (old.x0 as i64) >= x1 {
                    kept.push(old);
                    continue;
                }
                if (old.x0 as i64) < x0 {
                    kept.push(Run { x1: x0 as i32, ..old });
                }
                if (old.x1 as i64) > x1 {
                    kept.push(Run { x0: x1 as i32, ..old });
                }
            }
            *line = kept;
        }
    }

    /// The rows: none over another, sorted by y, then z, then x.
    pub fn rows(self) -> Vec<Run> {
        if self.lines.is_empty() {
            return self.base;
        }
        let (base, mut at, mut out) = (&self.base, 0, Vec::with_capacity(self.base.len() + self.lines.len()));
        for (key, line) in self.lines {
            let to = at + base[at..].partition_point(|r| (r.y, r.z) < key);
            out.extend_from_slice(&base[at..to]);
            at = to + base[to..].partition_point(|r| (r.y, r.z) == key);
            out.extend(line);
        }
        out.extend_from_slice(&base[at..]);
        out
    }
}

/// Whether rows are as `Laid::rows` gives them: none empty, none over another, sorted by y, then z, then x.
pub fn laid(runs: &[Run]) -> bool {
    runs.iter().all(|r| r.x0 < r.x1) && runs.windows(2).all(|w| (w[0].y, w[0].z, w[0].x1) <= (w[1].y, w[1].z, w[1].x0))
}

/// Edits, one after another, as rows that leave a column of sectors the same in the copy `lod` times coarser when
/// they are put in after every ball and blast among the edits, those in their own order: every row, a later over
/// an earlier, each ball and blast told to the rows before it as the finest cells are told, cut to the column (`x`
/// and `z`, low and high, in the finest cells). A coarser copy needs all the rows, not a sample: it shows a cell for
/// what all the cells it covers hold. Sorted by y, then z, then x. Edits of finer cells are passed over: a list with
/// one among its rows is not to be merged across it.
pub fn merged(edits: &[crate::Edit], lod: u32, x: [i32; 2], z: [i32; 2]) -> Vec<Run> {
    let mut laid = Laid::within([x[0], i32::MIN, z[0]], [x[1], i32::MAX, z[1]]);
    for e in edits {
        match e {
            crate::Edit::Runs(runs) => laid.take(runs, lod >= 2),
            crate::Edit::Rows(runs) => laid.take(runs, false),
            crate::Edit::Ball { centre, radius, kind: 0 } => laid.blast(*centre, *radius, lumps(centre)),
            crate::Edit::Ball { centre, radius, .. } => laid.ball(*centre, *radius),
            crate::Edit::Fine(..) => {}
        }
    }
    laid.rows()
}

/// The number a blast's ragged edge is made from: the blast's own, the same wherever it is worked out.
pub fn lumps(centre: &[i32; 3]) -> u32 {
    crate::hash::hash(centre[0], centre[2], centre[1] as u32)
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

    const ASPHALT: Kind = kind(crate::kinds::ASPHALT, 0);
    /// The plain east of the town: rolling open ground.
    const PLAIN: [i32; 2] = [45000, 4300];

    /// Where feet stand at a column: the cell over the ground's top.
    fn feet(x: i32, z: i32) -> i32 {
        crate::city::footing(x, z).0
    }

    /// The sector of the copy `lod` times coarser that holds the plain's ground, and its low corner in the finest cells.
    fn plain(lod: u32) -> ([i32; 3], [i32; 3]) {
        let side = (SIDE as i32) << lod;
        let at = [PLAIN[0].div_euclid(side), feet(PLAIN[0], PLAIN[1]).div_euclid(side), PLAIN[1].div_euclid(side)];
        (at, at.map(|v| v * side))
    }

    fn sorted(mut runs: Vec<Run>) -> Vec<Run> {
        runs.sort_unstable_by_key(|r| (r.y, r.z, r.x0));
        runs
    }

    /// A path one cell wide along x on the ground across the sector, and a wall one cell thick and twenty high along z.
    fn path_and_wall(lod: u32) -> (Vec<Run>, Vec<Run>) {
        let (side, (_, low)) = ((SIDE as i32) << lod, plain(lod));
        let (pz, wx) = (low[2] + side / 2 + 3, low[0] + side / 2 + 5);
        let path = (low[0]..low[0] + side).map(|x| Run { x0: x, x1: x + 1, y: feet(x, pz), z: pz, kind: ASPHALT }).collect();
        let wall = (low[2]..low[2] + side).flat_map(|z| (0..20).map(move |up| Run { x0: wx, x1: wx + 1, y: feet(wx, z) + up, z, kind: kind(BRICK, 0) })).collect();
        (sorted(path), sorted(wall))
    }

    /// Of the coarse cells in the sector that hold a cell of `runs`, how many are `kind`: (are, all).
    fn held(s: &Scratch, runs: &[Run], kind: Kind, but: impl Fn(&Run) -> bool) -> (usize, usize) {
        let (k, mut cells) = (s.lod, std::collections::BTreeMap::new());
        for r in runs.iter().filter(|r| !but(r)) {
            for x in r.x0..r.x1 {
                let c = [(x >> k) - s.low[0], (r.y >> k) - s.low[1], (r.z >> k) - s.low[2]];
                if c.iter().all(|&v| v >= 0 && v < SIDE as i32) {
                    cells.insert(c, s.cells[at(c[0] as usize, c[1] as usize, c[2] as usize)] == kind);
                }
            }
        }
        (cells.values().filter(|&&is| is).count(), cells.len())
    }

    #[test]
    fn a_thing_one_cell_thin_is_in_every_coarser_copy() {
        for lod in 1..=8u32 {
            let ((sx, sy, sz), (path, wall)) = (plain(lod).0.into(), path_and_wall(lod));
            let mut s = Scratch::new();
            fill(&mut s, sx, sy, sz, lod, &[Edit::Runs(path.clone()), Edit::Runs(wall.clone())]);
            // Where the two cross, the cell is the kind of the higher row: those cells are left out of both counts.
            let (wx, pz) = (wall[0].x0 >> lod, path[0].z >> lod);
            let (road, of) = held(&s, &path, ASPHALT, |r| r.x0 >> lod == wx);
            let (bricks, all) = held(&s, &wall, kind(BRICK, 0), |r| r.z >> lod == pz);
            println!("{lod} times coarser: the path is in {road} of the {of} cells it crosses, the wall in {bricks} of {all}");
            assert!(of >= 50 && all >= 60, "{lod} times coarser the path crosses {of} cells of the sector and the wall {all}");
            assert_eq!((road, bricks), (of, all), "{lod} times coarser: the path is in {road} of {of} cells, the wall in {bricks} of {all}");
        }
    }

    #[test]
    fn what_rows_put_the_same_rows_take_away_in_every_copy() {
        for lod in 0..=8u32 {
            let (((sx, sy, sz), low), (path, wall)) = ((plain(lod).0.into(), plain(lod).1), path_and_wall(lod));
            let gone = |runs: &[Run]| Edit::Runs(runs.iter().map(|r| Run { kind: 0, ..*r }).collect());
            // A ball of brick in a corner of the sector, away from the path and the wall, put in between.
            let ball = Edit::Ball { centre: [low[0] + (8 << lod), feet(low[0], low[2]), low[2] + (8 << lod)], radius: 6 << lod, kind: kind(BRICK, 2) };
            let (mut bare, mut one, mut other) = (Scratch::new(), Scratch::new(), Scratch::new());
            fill(&mut bare, sx, sy, sz, lod, &[ball.clone()]);
            fill(&mut one, sx, sy, sz, lod, &[Edit::Runs(path.clone()), Edit::Runs(wall.clone()), gone(&wall), gone(&path)]);
            fill(&mut other, sx, sy, sz, lod, &[Edit::Runs(wall.clone()), Edit::Runs(path.clone()), ball.clone(), gone(&path[..path.len() / 2]), gone(&wall), gone(&path[path.len() / 2..])]);
            let mut none = Scratch::new();
            fill(&mut none, sx, sy, sz, lod, &[]);
            assert_eq!(one.cells.iter().zip(&none.cells).filter(|(a, b)| a != b).count(), 0, "{lod} times coarser: built and taken away, the sector is not what it was");
            assert_eq!(other.cells.iter().zip(&bare.cells).filter(|(a, b)| a != b).count(), 0, "{lod} times coarser: built, a ball put elsewhere, taken away in parts: the sector is not the ball alone");
        }
    }

    #[test]
    fn a_thick_thing_built_and_taken_away_leaves_the_ground_whole() {
        for lod in 1..=8u32 {
            let ((sx, sy, sz), low) = (plain(lod).0.into(), plain(lod).1);
            let side = (SIDE as i32) << lod;
            let (x, z) = (low[0] + side / 2 + 3, low[2] + side / 2 + 3);
            // A box 40 cells a side stood on the ground under each of its columns, a wall two thick and 30 high along
            // x, and two posts 30 high on one line of rows, 90 cells apart.
            let mut built: Vec<Run> = (0..40).flat_map(|dz| (0..40).flat_map(move |dx| (0..40).map(move |up| Run { x0: x + dx, x1: x + dx + 1, y: feet(x + dx, z + dz) + up, z: z + dz, kind: kind(BRICK, 0) }))).collect();
            built.extend((0..2).flat_map(|dz| (-200..200).flat_map(move |dx| (0..30).map(move |up| Run { x0: x + dx, x1: x + dx + 1, y: feet(x + dx, z + 80 + dz) + up, z: z + 80 + dz, kind: kind(BRICK, 1) }))));
            let base = feet(x, z - 40);
            built.extend((0..30).flat_map(|up| [0, 90].map(|dx| Run { x0: x + dx, x1: x + dx + 2, y: base + up, z: z - 40, kind: kind(BRICK, 2) })));
            let built = sorted(built);
            let gone = Edit::Runs(built.iter().map(|r| Run { kind: 0, ..*r }).collect());
            let (mut s, mut none) = (Scratch::new(), Scratch::new());
            fill(&mut none, sx, sy, sz, lod, &[]);
            fill(&mut s, sx, sy, sz, lod, &[Edit::Runs(built.clone())]);
            assert!(s.cells.iter().zip(&none.cells).filter(|(a, b)| a != b).count() > 0, "{lod} times coarser: nothing was built in the sector");
            fill(&mut s, sx, sy, sz, lod, &[Edit::Runs(built), gone]);
            let differ = s.cells.iter().zip(&none.cells).filter(|(a, b)| a != b).count();
            println!("{lod} times coarser: a box, a thick wall and two posts built and taken away left {differ} cells changed");
            assert_eq!(differ, 0, "{lod} times coarser: a box, a thick wall and two posts built and taken away left {differ} cells changed");
        }
    }

    #[test]
    fn a_nick_is_not_a_pit_and_a_cell_emptied_whole_is_air() {
        let mut buried = 0;
        for lod in 1..=8u32 {
            let ((sx, sy, sz), low) = (plain(lod).0.into(), plain(lod).1);
            let (side, cell) = ((SIDE as i32) << lod, 1 << lod);
            let mut none = Scratch::new();
            fill(&mut none, sx, sy, sz, lod, &[]);
            // One cell of the ground's top, and a ditch one cell wide and deep along x. (At twice the size a ditch
            // is half of a cell's ground where that is one sheet, and shows there: it is dug from four times up.)
            let (x, z) = (low[0] + side / 2, low[2] + side / 2);
            let ditch = sorted((low[0]..low[0] + if lod == 1 { 0 } else { side }).map(|x| Run { x0: x, x1: x + 1, y: feet(x, z) - 1, z, kind: 0 }).collect());
            let mut s = Scratch::new();
            fill(&mut s, sx, sy, sz, lod, &[Edit::Runs(vec![Run { x0: x, x1: x + 1, y: feet(x, z + 9) - 1, z: z + 9, kind: 0 }]), Edit::Runs(ditch)]);
            assert_eq!(s.cells.iter().zip(&none.cells).filter(|(a, b)| a != b).count(), 0, "{lod} times coarser: a cell and a ditch one cell wide dug from the ground changed the copy");
            // The ground's top cell emptied whole; and a cell well under the ground emptied but for one sheet (in
            // a cell the ground's top passes through, that much would not be known to be half of what is there).
            let c = (0..SIDE).rev().map(|y| [SIDE / 2, y, SIDE / 2]).find(|c| none.cells[at(c[0], c[1], c[2])] != 0).expect("ground in the sector");
            let rows = |c: [usize; 3], but: i32| -> Vec<Run> {
                let corner = [low[0] + c[0] as i32 * cell, low[1] + c[1] as i32 * cell, low[2] + c[2] as i32 * cell];
                (0..cell).flat_map(|dy| (but..cell).map(move |dz| Run { x0: corner[0], x1: corner[0] + cell, y: corner[1] + dy, z: corner[2] + dz, kind: 0 })).collect()
            };
            let mut dug = rows(c, 0);
            let deep = (c[1] >= 4).then(|| [c[0] + 2, c[1] - 4, c[2]]);
            dug.extend(deep.iter().flat_map(|&c| rows(c, 1)));
            buried += deep.is_some() as u32;
            fill(&mut s, sx, sy, sz, lod, &[Edit::Runs(sorted(dug))]);
            assert_eq!(s.cells[at(c[0], c[1], c[2])], 0, "{lod} times coarser: the ground's top cell emptied whole is not air");
            if let Some(c) = deep {
                assert_eq!(s.cells[at(c[0], c[1], c[2])], 0, "{lod} times coarser: a cell under the ground emptied but for one sheet is not air");
            }
            assert_eq!(s.cells.iter().zip(&none.cells).filter(|(a, b)| a != b).count(), 1 + deep.is_some() as usize, "{lod} times coarser: emptying cells changed others");
        }
        assert!(buried >= 4, "a cell under the ground was dug at {buried} levels");
    }

    #[test]
    fn a_built_wall_blasted_is_in_a_coarser_copy_what_is_left_of_it() {
        // A wall one cell thick along x, 40 high, with a charge at its foot: what the finest copy holds of it after.
        let (x0, z) = (PLAIN[0], PLAIN[1]);
        let wall = sorted((x0..x0 + 240).flat_map(|x| (0..40).map(move |up| Run { x0: x, x1: x + 1, y: feet(x, z) + up, z, kind: kind(BRICK, 0) })).collect());
        let centre = [x0 + 120, feet(x0 + 120, z) + 6, z];
        let edits = [Edit::Runs(wall.clone()), Edit::Ball { centre, radius: 16, kind: 0 }];
        let mut left = std::collections::BTreeSet::new();
        let mut s = Scratch::new();
        for r in &wall {
            let at_ = [r.x0.div_euclid(SIDE as i32), r.y.div_euclid(SIDE as i32), r.z.div_euclid(SIDE as i32)];
            if s.low != at_.map(|v| v * SIDE as i32) || s.lod != 0 || left.is_empty() {
                fill(&mut s, at_[0], at_[1], at_[2], 0, &edits);
            }
            if s.cells[at((r.x0 - s.low[0]) as usize, (r.y - s.low[1]) as usize, (r.z - s.low[2]) as usize)] == r.kind {
                left.insert([r.x0, r.y, r.z]);
            }
        }
        assert!(left.len() > wall.len() / 2 && left.len() < wall.len() - 300, "{} of the wall's {} cells are left near", left.len(), wall.len());
        for lod in 1..=6u32 {
            let side = (SIDE as i32) << lod;
            let (sx, sy, sz) = (centre[0].div_euclid(side), centre[1].div_euclid(side), centre[2].div_euclid(side));
            fill(&mut s, sx, sy, sz, lod, &edits);
            let mut bare = Scratch::new();
            fill(&mut bare, sx, sy, sz, lod, &edits[1..]);
            let (mut stands, mut gone) = (0, 0);
            for c in wall.iter().map(|r| [r.x0 >> lod, r.y >> lod, r.z >> lod]).collect::<std::collections::BTreeSet<_>>() {
                let i = [c[0] - s.low[0], c[1] - s.low[1], c[2] - s.low[2]];
                if i.iter().any(|&v| v < 0 || v >= SIDE as i32) {
                    continue;
                }
                let i = at(i[0] as usize, i[1] as usize, i[2] as usize);
                let any = wall.iter().any(|r| [r.x0 >> lod, r.y >> lod, r.z >> lod] == c && left.contains(&[r.x0, r.y, r.z]));
                if any {
                    stands += 1;
                    assert_eq!(s.cells[i], kind(BRICK, 0), "{lod} times coarser: a cell that still holds wall near is not wall");
                } else {
                    gone += 1;
                    assert_eq!(s.cells[i], bare.cells[i], "{lod} times coarser: wall blasted away near still stands");
                }
            }
            assert!(stands > 0 && (gone > 0 || lod > 3), "{lod} times coarser: {stands} cells of wall stand, {gone} are gone");
        }
    }

    #[test]
    fn edits_merged_with_balls_among_them_leave_every_copy_the_same() {
        for lod in 0..=5u32 {
            let (((sx, sy, sz), low), side) = ((plain(lod).0.into(), plain(lod).1), (SIDE as i32) << lod);
            let rows = |e: u32| {
                Edit::Runs(sorted((0..400).map(|i| {
                    let h = |n: u32| hash(e as i32, i, n) as i32;
                    let (x0, z) = (low[0] - 20 + h(1).rem_euclid(side + 20), low[2] + h(4).rem_euclid(side));
                    Run { x0, x1: x0 + 1 + h(2).rem_euclid(40 << lod), y: feet(x0.max(low[0]), z) - 6 + h(3).rem_euclid(30), z, kind: if h(5) % 3 == 0 { 0 } else { kind(BRICK, 1 + (e as u8 % 5)) } }
                }).collect()))
            };
            let ball = |e: u32, kind: Kind| Edit::Ball { centre: [low[0] + hash(e as i32, 1, 9).rem_euclid(side as u32) as i32, feet(low[0] + side / 2, low[2] + side / 2), low[2] + hash(e as i32, 2, 9).rem_euclid(side as u32) as i32], radius: 12 << lod, kind };
            let edits = [rows(1), rows(2), rows(3), ball(4, 0), rows(5), rows(6), ball(7, kind(BRICK, 7)), rows(8), rows(9)];
            let (x, z) = ([low[0], low[0] + side], [low[2], low[2] + side]);
            // As the page tidies a column: every ball and blast in their order, then all the rows as one.
            let tidy = [edits[3].clone(), edits[6].clone(), Edit::Rows(merged(&edits, lod, x, z))];
            // And tidied again when more has come: the merged rows, a blast, more rows.
            let more = [ball(10, 0), rows(11), rows(12)];
            let all: Vec<Edit> = edits.iter().chain(&more).cloned().collect();
            let after: Vec<Edit> = tidy.iter().chain(&more).cloned().collect();
            let again = [edits[3].clone(), edits[6].clone(), more[0].clone(), Edit::Rows(merged(&after, lod, x, z))];
            let (mut whole, mut twice, mut thrice) = (Scratch::new(), Scratch::new(), Scratch::new());
            fill(&mut whole, sx, sy, sz, lod, &all);
            fill(&mut twice, sx, sy, sz, lod, &after);
            fill(&mut thrice, sx, sy, sz, lod, &again);
            assert!(whole.cells == twice.cells && whole.cells == thrice.cells, "{lod} times coarser: edits after a tidied column differ from the same edits one after another");
            let (mut one, mut other) = (Scratch::new(), Scratch::new());
            fill(&mut one, sx, sy, sz, lod, &edits);
            fill(&mut other, sx, sy, sz, lod, &tidy);
            let differ = one.cells.iter().zip(&other.cells).filter(|(a, b)| a != b).count();
            assert_eq!(differ, 0, "{lod} times coarser, {differ} cells differ between edits one after another and the balls then the rows merged");
        }
    }
}
