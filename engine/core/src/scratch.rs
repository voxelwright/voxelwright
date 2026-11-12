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

pub struct Scratch {
    pub cells: Vec<Kind>,
    /// The sector's low corner, in its own (perhaps coarse) cells.
    pub low: [i32; 3],
    /// How many times a cell's edge has doubled: 0 is the world's finest.
    pub lod: u32,
}

impl Scratch {
    pub fn new() -> Self {
        Scratch { cells: vec![0; CELLS], low: [0; 3], lod: 0 }
    }

    pub fn start(&mut self, sx: i32, sy: i32, sz: i32, lod: u32) {
        self.cells.fill(0);
        self.low = [sx * SIDE as i32, sy * SIDE as i32, sz * SIDE as i32];
        self.lod = lod;
    }

    /// The sector's low and high corners in the finest cells (high exclusive).
    pub fn bounds(&self) -> ([i32; 3], [i32; 3]) {
        let s = SIDE as i32;
        (self.low.map(|v| v << self.lod), self.low.map(|v| (v + s) << self.lod))
    }

    /// A span of the finest cells as a span of this scratch's cells along one axis, clipped to the sector.
    #[inline]
    fn span(&self, axis: usize, lo: i32, hi: i32, meet: Meet) -> (usize, usize) {
        let k = self.lod;
        let (a, b) = if k == 0 {
            (lo, hi)
        } else {
            let s = 1 << k;
            match meet {
                Meet::Touch => (lo >> k, (hi + s - 1) >> k),
                Meet::Middle => ((lo + s / 2 - 1) >> k, (hi + s / 2 - 1) >> k),
                Meet::Within => ((lo + s - 1) >> k, hi >> k),
            }
        };
        let (a, b) = (a - self.low[axis], b - self.low[axis]);
        (a.clamp(0, SIDE as i32) as usize, b.clamp(0, SIDE as i32) as usize)
    }

    /// Fills a box, corners in the finest cells (`hi` exclusive). Kind 0 empties it.
    pub fn fill(&mut self, lo: [i32; 3], hi: [i32; 3], kind: Kind, meet: Meet) {
        let (x0, x1) = self.span(0, lo[0], hi[0], meet);
        let (y0, y1) = self.span(1, lo[1], hi[1], meet);
        let (z0, z1) = self.span(2, lo[2], hi[2], meet);
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
        let (x0, x1) = self.span(0, centre[0] - r, centre[0] + r + 1, Meet::Touch);
        let (y0, y1) = self.span(1, centre[1] - r, centre[1] + r + 1, Meet::Touch);
        let (z0, z1) = self.span(2, centre[2] - r, centre[2] + r + 1, Meet::Touch);
        let (k, half) = (self.lod, (1i64 << self.lod) / 2);
        let r2 = (r as i64) * (r as i64);
        for y in y0..y1 {
            for z in z0..z1 {
                for x in x0..x1 {
                    // The cell's middle, in the finest cells.
                    let wx = (((self.low[0] + x as i32) as i64) << k) + half;
                    let wy = (((self.low[1] + y as i32) as i64) << k) + half;
                    let wz = (((self.low[2] + z as i32) as i64) << k) + half;
                    let (dx, dy, dz) = (wx - centre[0] as i64, wy - centre[1] as i64, wz - centre[2] as i64);
                    if dx * dx + dy * dy + dz * dz > r2 {
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
        let reach = r * 44 / 16 + 1;
        let (x0, x1) = self.span(0, centre[0] - reach, centre[0] + reach + 1, Meet::Touch);
        let (y0, y1) = self.span(1, centre[1] - reach, centre[1] + reach + 1, Meet::Touch);
        let (z0, z1) = self.span(2, centre[2] - reach, centre[2] + reach + 1, Meet::Touch);
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
                    if out > 0 && dx * dx + dy * dy + dz * dz <= out * out {
                        self.cells[at(x, y, z)] = 0;
                    }
                }
            }
        }
    }

    /// Sets rows of cells: a piece taken out of the world (kind 0) or put down in it. The rows are sorted by y, then z,
    /// then x. A copy a little coarser takes a row where it passes through a cell's middle. A copy coarser still, in
    /// which a house is solid, takes each line of rows from its first cell to its last, as the solid thing the piece is:
    /// when the rows are one piece's (`lines`), and each row by itself when they are what many edits came to.
    pub fn runs(&mut self, runs: &[Run], lines: bool) {
        let (k, side) = (self.lod, SIDE as i32);
        if k == 0 {
            for r in runs {
                let (y, z) = (r.y - self.low[1], r.z - self.low[2]);
                if y < 0 || y >= side || z < 0 || z >= side {
                    continue;
                }
                let (x0, x1) = ((r.x0 - self.low[0]).clamp(0, side) as usize, (r.x1 - self.low[0]).clamp(0, side) as usize);
                if x0 < x1 {
                    self.cells[at(x0, y as usize, z as usize)..at(x1, y as usize, z as usize)].fill(r.kind);
                }
            }
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
            let (y, z) = ((wy >> k) - self.low[1], (wz >> k) - self.low[2]);
            if y < 0 || y >= side || z < 0 || z >= side {
                continue;
            }
            if k >= 2 && lines {
                let (x0, x1) = self.span(0, line[0].x0, line[line.len() - 1].x1, Meet::Middle);
                if x0 < x1 {
                    self.cells[at(x0, y as usize, z as usize)..at(x1, y as usize, z as usize)].fill(line[0].kind);
                }
            } else {
                for r in line {
                    let (x0, x1) = self.span(0, r.x0, r.x1, Meet::Middle);
                    if x0 < x1 {
                        self.cells[at(x0, y as usize, z as usize)..at(x1, y as usize, z as usize)].fill(r.kind);
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
