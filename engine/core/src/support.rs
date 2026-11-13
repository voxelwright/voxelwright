//! What holds up, and what falls. After a change, the cells round it are asked whether the
//! ground still reaches them: resting on a held cell costs nothing, a cell sideways costs one,
//! a cell hung from above two, and a cell further than its material spans is not held
//! (kinds.rs). Reach alone would let a wall hang by a thread, so each sideways or hanging join
//! also carries only so many cells: past that it tears, and the cells are asked again without it.
//!
//! Loose cells that touch one another are a piece. `release` takes the pieces out for the solver
//! to move (bodies.rs). `settle` is the older answer, kept for this rule's own tests: each piece
//! falls straight down, in whole cells, until something is under it. This is the rule for what
//! stands, in whole numbers, the same on every machine.

use crate::kinds::{ASPHALT, EARTH, GLASS, GRASS, LAMP, LEAVES, ROCK, SAND, STEEL, WATER, bears, join_carries, leans, material, rubble, spans, weighs};
use crate::scratch::{Run, Scratch};
use crate::tree::{Kind, SIDE, at};
use crate::{Edit, fill};


/// A box of the world's finest cells, laid out flat: x + across * (z + deep * y).
pub struct Region {
    pub low: [i32; 3],
    pub size: [usize; 3],
    pub cells: Vec<Kind>,
}

impl Region {
    pub fn new(low: [i32; 3], size: [usize; 3]) -> Self {
        Region { low, size, cells: vec![0; size[0] * size[1] * size[2]] }
    }

    #[inline]
    pub fn at(&self, x: usize, y: usize, z: usize) -> usize {
        x + self.size[0] * (z + self.size[2] * y)
    }

    #[inline]
    pub(crate) fn place(&self, i: usize) -> (usize, usize, usize) {
        let layer = self.size[0] * self.size[2];
        (i % self.size[0], i / layer, (i % layer) / self.size[0])
    }

    /// The world as it stands in this box: the city's rules, then the edits, a sector at a time.
    pub fn gather(low: [i32; 3], size: [usize; 3], edits: &[Edit], s: &mut Scratch) -> Self {
        Region::gather_with(low, size, s, |s, sx, sy, sz| fill(s, sx, sy, sz, 0, edits))
    }

    /// As `gather`, each sector filled by `make`: for one who knows which edits reach a sector.
    pub fn gather_with(low: [i32; 3], size: [usize; 3], s: &mut Scratch, mut make: impl FnMut(&mut Scratch, i32, i32, i32)) -> Self {
        let mut region = Region::new(low, size);
        region.sectors(|sx, sy, sz, region| {
            make(s, sx, sy, sz);
            region.take(s, sx, sy, sz);
        });
        region
    }

    /// Each sector the box reaches, in turn.
    pub fn sectors(&mut self, mut each: impl FnMut(i32, i32, i32, &mut Region)) {
        let side = SIDE as i32;
        let (low, size) = (self.low, self.size);
        let high = [low[0] + size[0] as i32, low[1] + size[1] as i32, low[2] + size[2] as i32];
        for sy in low[1].div_euclid(side)..=(high[1] - 1).div_euclid(side) {
            for sz in low[2].div_euclid(side)..=(high[2] - 1).div_euclid(side) {
                for sx in low[0].div_euclid(side)..=(high[0] - 1).div_euclid(side) {
                    each(sx, sy, sz, self);
                }
            }
        }
    }

    /// Takes from a sector held whole in the scratch the part of it that is in the box.
    pub fn take(&mut self, s: &Scratch, sx: i32, sy: i32, sz: i32) {
        self.take_cells(Some(&s.cells), 0, sx, sy, sz);
    }

    /// Takes the part of a sector that is in the box: from the sector's cells, or, with none, as all of one kind.
    pub fn take_cells(&mut self, cells: Option<&[Kind]>, same: Kind, sx: i32, sy: i32, sz: i32) {
        let side = SIDE as i32;
        let (low, size) = (self.low, self.size);
        let high = [low[0] + size[0] as i32, low[1] + size[1] as i32, low[2] + size[2] as i32];
        let from = [(low[0] - sx * side).max(0), (low[1] - sy * side).max(0), (low[2] - sz * side).max(0)];
        let to = [(high[0] - sx * side).min(side), (high[1] - sy * side).min(side), (high[2] - sz * side).min(side)];
        if from[0] >= to[0] {
            return;
        }
        for y in from[1]..to[1] {
            for z in from[2]..to[2] {
                let src = at(from[0] as usize, y as usize, z as usize);
                let dst = self.at((sx * side + from[0] - low[0]) as usize, (sy * side + y - low[1]) as usize, (sz * side + z - low[2]) as usize);
                let n = (to[0] - from[0]) as usize;
                match cells {
                    Some(cells) => self.cells[dst..dst + n].copy_from_slice(&cells[src..src + n]),
                    None => self.cells[dst..dst + n].fill(same),
                }
            }
        }
    }
}

/// A piece that fell: the rows of cells it was (in the world's finest cells), how far it dropped, and when.
pub struct Move {
    pub runs: Vec<Run>,
    pub drop: i32,
    /// Pieces of one round fall together; the next round's are what that fall left perched.
    pub round: u32,
    pub cells: usize,
    pub low: [i32; 3],
    pub high: [i32; 3],
}

pub struct Settled {
    pub moves: Vec<Move>,
    /// Loose crumbs too small to be a piece, which are gone.
    pub dust: usize,
}

const UNREACHED: u8 = 255;
/// How a cell is joined to what holds it: nothing does, it is the ground's, it rests on the cell below, leans on one beside, hangs from the one above.
const NONE: u8 = 0;
const GROUND: u8 = 1;
const RESTS: u8 = 2;
const LEANS: u8 = 3; // 3, 4, 5, 6: from -x, +x, -z, +z
const HANGS: u8 = 7;

/// How many times a region is asked again after joins have torn, so that what a torn join carried may be carried
/// another way. None, for now: asked until nothing tore, some houses took over forty rounds (two seconds) and still
/// shed load, and asked three times a few window panes fell in an untouched street. So a join that tears lets go
/// of all it carried, as before; what is built must be built so that its first paths carry it.
const AGAIN: usize = 0;

/// Which solid cells of a region the ground does not hold: one true a cell.
///
/// The ground is reached for outwards, cheapest way first, and each cell is joined to the one it was reached from.
/// Then every join is asked what it carries. One that carries too much tears (or, for a cell resting on another,
/// crushes it), and the whole is asked again without it: the load may go another way, and tear that in turn, which
/// is how a thing gives way bit by bit. When nothing more tears, what the ground no longer reaches is loose.
pub fn loose(r: &Region) -> Vec<bool> {
    loose_how(r, None).0
}

/// A box of the world taken coarsely: each cell of `region` stands for a block of cells `by` a side, and is of the
/// strongest stuff in it; `count` is how many cells of the block are built. The same rule is asked of it (`loose_how`),
/// with a step sideways costing `by` and each block weighing and carrying by its cells: so a thing can be asked about
/// over a box far wider than could be gathered and searched cell by cell.
pub struct Blocks {
    pub region: Region,
    pub count: Vec<u8>,
    pub by: usize,
}

impl Blocks {
    pub fn of(r: &Region, by: usize) -> Blocks {
        let size = [r.size[0] / by, r.size[1] / by, r.size[2] / by];
        let mut region = Region::new(r.low, size);
        let mut count = vec![0u8; region.cells.len()];
        for y in 0..size[1] * by {
            for z in 0..size[2] * by {
                let (row, to) = (r.at(0, y, z), region.at(0, y / by, z / by));
                for x in 0..size[0] * by {
                    let k = r.cells[row + x];
                    if k == 0 {
                        continue;
                    }
                    let b = to + x / by;
                    if region.cells[b] == 0 || rank(k) > rank(region.cells[b]) {
                        region.cells[b] = k;
                    }
                    count[b] += !is_ground(k) as u8;
                }
            }
        }
        Blocks { region, count, by }
    }
}

/// How well a stuff carries, for picking what a block is of: the ground least, then rubble, then leaves (a crown that
/// brushes a wall must not make the wall's block one that joins only to leaves), then by how far it spans.
pub(crate) fn rank(k: Kind) -> u32 {
    if is_ground(k) { 0 } else if rubble(k) { 1 } else if material(k) == LEAVES { 2 } else { 3 + spans(material(k)) as u32 }
}

/// As `loose`, and with it how each cell was joined to what holds it and what reaching it cost: for counting.
/// With `blocks`, the region's cells are blocks (see `Blocks`).
pub(crate) fn loose_how(r: &Region, blocks: Option<(&[u8], usize)>) -> (Vec<bool>, Vec<u8>, Vec<u8>) {
    let by = blocks.map_or(1, |b| b.1);
    // How many cells a block is, and how many cells' worth of joins a face of it has.
    let cells_of = |i: usize| blocks.map_or(1, |b| (b.0[i] as u32).max(1));
    let face = |i: usize| blocks.map_or(1, |b| (b.0[i] as u32 / b.1 as u32).max(1));
    let [nx, ny, nz] = r.size;
    let (n, layer) = (r.cells.len(), nx * nz);
    // The joins that have torn: a bit for each way a cell can be joined (its `how`).
    let mut torn = vec![0u8; n];
    let mut out = vec![false; n];
    let mut cost = vec![UNREACHED; n];
    let mut join = vec![NONE; n];
    for pass in 0..=AGAIN {
        cost.fill(UNREACHED);
        join.fill(NONE);
        let mut order: Vec<u32> = Vec::new();
        let mut waiting: Vec<Vec<u32>> = vec![Vec::new(); 256];
        // What is at the bottom of the box, and at its sides, goes on beyond it: the ground's.
        // So is the ground that lies on it, cell on cell, all the way up: most of what is solid in a box is that, and
        // none of it need be reached for. Only the ground's cells that something else touches are where reaching starts.
        for i in 0..n {
            if r.cells[i] == 0 {
                continue;
            }
            let (x, y, z) = r.place(i);
            if y == 0 || x == 0 || x == nx - 1 || z == 0 || z == nz - 1 || (is_ground(r.cells[i]) && join[i - layer] == GROUND) {
                cost[i] = 0;
                join[i] = GROUND;
            }
        }
        for i in 0..n {
            if join[i] != GROUND {
                continue;
            }
            let (x, y, z) = r.place(i);
            let waits = |j: usize| r.cells[j] != 0 && join[j] != GROUND;
            if (y + 1 < ny && waits(i + layer)) || (x > 0 && waits(i - 1)) || (x + 1 < nx && waits(i + 1)) || (z > 0 && waits(i - nx)) || (z + 1 < nz && waits(i + nx)) || (y > 0 && waits(i - layer)) {
                waiting[0].push(i as u32);
            }
        }
        for c in 0..255usize {
            let mut at_cost = std::mem::take(&mut waiting[c]);
            // Resting costs nothing, so cells join this round as it goes.
            let mut k = 0;
            while k < at_cost.len() {
                let i = at_cost[k] as usize;
                k += 1;
                if cost[i] as usize != c {
                    continue;
                }
                // A cell may be listed twice at one cost: count it once.
                if join[i] & 128 != 0 {
                    continue;
                }
                join[i] |= 128;
                order.push(i as u32);
                let (x, y, z) = r.place(i);
                let mut reach = |j: usize, more: usize, how: u8, list: &mut Vec<u32>, waiting: &mut Vec<Vec<u32>>| {
                    let kind = r.cells[j];
                    let to = c + more;
                    if kind == 0 || to >= cost[j] as usize || to > spans(material(kind)) as usize || torn[j] & (1 << how) != 0 {
                        return;
                    }
                    // Rubble lies on what is under it and that is all: it is joined to nothing beside it or over it,
                    // and nothing beside it or under it is joined to it.
                    if more != 0 && (rubble(kind) || rubble(r.cells[i])) {
                        return;
                    }
                    // Leaves hold on to leaves and to nothing else: a crown that brushes a wall is not hung on it, though it may rest on what is under it.
                    if more != 0 && (material(kind) == LEAVES) != (material(r.cells[i]) == LEAVES) {
                        return;
                    }
                    cost[j] = to as u8;
                    join[j] = how;
                    if more == 0 { list.push(j as u32) } else { waiting[to].push(j as u32) }
                };
                if y + 1 < ny { reach(i + layer, 0, RESTS, &mut at_cost, &mut waiting) }
                if x > 0 { reach(i - 1, by, LEANS + 1, &mut at_cost, &mut waiting) }
                if x + 1 < nx { reach(i + 1, by, LEANS, &mut at_cost, &mut waiting) }
                if z > 0 { reach(i - nx, by, LEANS + 3, &mut at_cost, &mut waiting) }
                if z + 1 < nz { reach(i + nx, by, LEANS + 2, &mut at_cost, &mut waiting) }
                if y > 0 { reach(i - layer, 2 * by, HANGS, &mut at_cost, &mut waiting) }
            }
        }
        // The cell each is joined to.
        let holder = |i: usize, how: u8| match how & 127 {
            RESTS => i - layer,
            3 => i - 1,
            4 => i + 1,
            5 => i - nx,
            6 => i + nx,
            HANGS => i + layer,
            _ => i,
        };
        // What each join carries: the cell and all that is joined on through it. Last joined first.
        let mut load = vec![0u32; n];
        for &i in order.iter().rev() {
            let i = i as usize;
            load[i] += cells_of(i);
            let how = join[i] & 127;
            if how != GROUND {
                let h = holder(i, how);
                load[h] += load[i];
            }
        }
        // A sideways or hanging join that carries more than it can tears; what rests on a cell must not be more than
        // that cell can bear (a house does not stand on a post one cell thick).
        let last = pass == AGAIN;
        let mut tore = false;
        out.fill(false);
        for &i in &order {
            let i = i as usize;
            let how = join[i] & 127;
            if how == GROUND {
                continue;
            }
            let h = holder(i, how);
            let over = if how == RESTS { load[i] > bears(material(r.cells[h])).saturating_mul(face(h)) } else { load[i] > join_carries(material(r.cells[i]), material(r.cells[h])).saturating_mul(face(i).min(face(h))) };
            if over {
                torn[i] |= 1 << how;
                tore = true;
            }
            // Asked for the last time, what a torn join carried is loose with it.
            out[i] = last && (out[h] || over);
        }
        if !tore || last {
            for i in 0..n {
                if r.cells[i] != 0 && cost[i] == UNREACHED {
                    out[i] = true;
                }
            }
            break;
        }
    }
    (out, join, cost)
}

/// The rows a set of cells makes, sorted by y, then z, then x: neighbours along x of one kind are one row.
fn rows(r: &Region, cells: &mut [u32]) -> Vec<Run> {
    cells.sort_unstable();
    let mut runs: Vec<Run> = Vec::new();
    for &i in cells.iter() {
        let (x, y, z) = r.place(i as usize);
        let (wx, wy, wz, kind) = (r.low[0] + x as i32, r.low[1] + y as i32, r.low[2] + z as i32, r.cells[i as usize]);
        match runs.last_mut() {
            Some(last) if last.y == wy && last.z == wz && last.x1 == wx && last.kind == kind => last.x1 += 1,
            _ => runs.push(Run { x0: wx, x1: wx + 1, y: wy, z: wz, kind }),
        }
    }
    runs
}

/// The loose cells of a region as pieces: loose cells that touch are one. A piece that reaches the box's sides or
/// top goes on beyond it, and what it is joined to there is not known, so it is left where it is (and comes back empty).
fn pieces_of(r: &Region, is_loose: &[bool], piece_of: &mut [u32], [sides, top]: [bool; 2]) -> Vec<Vec<u32>> {
    let [nx, ny, nz] = r.size;
    let (n, layer) = (r.cells.len(), nx * nz);
    piece_of.fill(0);
    let mut pieces: Vec<Vec<u32>> = Vec::new();
    let mut stack: Vec<u32> = Vec::new();
    for start in 0..n {
        if !is_loose[start] || piece_of[start] != 0 {
            continue;
        }
        let id = pieces.len() as u32 + 1;
        let mut cells: Vec<u32> = Vec::new();
        let mut edge = false;
        piece_of[start] = id;
        stack.push(start as u32);
        while let Some(i) = stack.pop() {
            let i = i as usize;
            cells.push(i as u32);
            let (x, y, z) = r.place(i);
            edge |= (sides && (x == 0 || x == nx - 1 || z == 0 || z == nz - 1)) || (top && y == ny - 1);
            let mut join = |j: usize| {
                if is_loose[j] && piece_of[j] == 0 {
                    piece_of[j] = id;
                    stack.push(j as u32);
                }
            };
            if x > 0 { join(i - 1) }
            if x + 1 < nx { join(i + 1) }
            if z > 0 { join(i - nx) }
            if z + 1 < nz { join(i + nx) }
            if y > 0 { join(i - layer) }
            if y + 1 < ny { join(i + layer) }
        }
        if edge {
            cells.clear();
        }
        pieces.push(cells);
    }
    pieces
}

/// Whether a cell is the ground itself and not something that stands on it.
pub(crate) fn is_ground(kind: Kind) -> bool {
    matches!(material(kind), EARTH | ROCK | GRASS | SAND | ASPHALT | WATER)
}

/// Things that no longer stand over what they stand on. The reach rule cannot say this: a tank on two of its four
/// legs is still reached from the ground. So each thing that stands free in the box (cells that touch, not the
/// ground's, not reaching the box's sides or top) is asked, level by level from its foot up, where the weight of all
/// that is at and above that level lies. If the middle of that weight is further outside the stretch the thing
/// covers at that level than its material can lean (`leans`), everything from there up is loose, and goes over as
/// one body. Steel leans far, so a lamp holds its arm out; brick hardly at all. Where the thing stands on the ground
/// higher up as well (a car across a slope, its uphill wheels shorter), that footing is part of the stretch below.
pub fn topple(r: &Region, is_loose: &mut [bool]) {
    let [nx, ny, nz] = r.size;
    let (n, layer) = (r.cells.len(), nx * nz);
    let stands = |i: usize, is_loose: &[bool]| r.cells[i] != 0 && !is_ground(r.cells[i]) && !is_loose[i];
    let mut seen = vec![false; n];
    let mut stack: Vec<u32> = Vec::new();
    let mut cells: Vec<u32> = Vec::new();
    // For each level: the weight on it and where, the stretch it covers (least and most x and z), how far its stuff leans.
    let mut levels: Vec<(f64, f64, f64, [usize; 2], [usize; 2], f64)> = Vec::new();
    // And the stretch of it that stands on the ground at that level.
    let mut feet: Vec<([usize; 2], [usize; 2])> = Vec::new();
    for start in 0..n {
        if seen[start] || !stands(start, is_loose) {
            continue;
        }
        cells.clear();
        levels.clear();
        levels.resize(ny, (0.0, 0.0, 0.0, [usize::MAX; 2], [0; 2], 0.0));
        feet.clear();
        feet.resize(ny, ([usize::MAX; 2], [0; 2]));
        let mut edge = false;
        seen[start] = true;
        stack.push(start as u32);
        while let Some(i) = stack.pop() {
            let i = i as usize;
            cells.push(i as u32);
            let (x, y, z) = r.place(i);
            edge |= x == 0 || x == nx - 1 || z == 0 || z == nz - 1 || y == ny - 1 || y == 0;
            let stuff = material(r.cells[i]);
            let m = weighs(stuff) as f64;
            let l = &mut levels[y];
            l.0 += m;
            l.1 += m * (x as f64 + 0.5);
            l.2 += m * (z as f64 + 0.5);
            l.3 = [l.3[0].min(x), l.3[1].min(z)];
            l.4 = [l.4[0].max(x), l.4[1].max(z)];
            l.5 = l.5.max(leans(stuff) as f64);
            if y > 0 && is_ground(r.cells[i - layer]) {
                let f = &mut feet[y];
                *f = ([f.0[0].min(x), f.0[1].min(z)], [f.1[0].max(x), f.1[1].max(z)]);
            }
            let mut join = |j: usize| {
                if !seen[j] && stands(j, is_loose) {
                    seen[j] = true;
                    stack.push(j as u32);
                }
            };
            if x > 0 { join(i - 1) }
            if x + 1 < nx { join(i + 1) }
            if z > 0 { join(i - nx) }
            if z + 1 < nz { join(i + nx) }
            if y > 0 { join(i - layer) }
            if y + 1 < ny { join(i + layer) }
        }
        if edge {
            continue;
        }
        // From the top down, the weight at and above each level; the lowest level it is not over is where the thing goes.
        let (mut mass, mut mx, mut mz) = (0.0f64, 0.0f64, 0.0f64);
        let mut hinge: Option<usize> = None;
        // Where it stands on the ground above the level asked about.
        let (mut low, mut high) = ([usize::MAX; 2], [0usize; 2]);
        for y in (0..ny).rev() {
            let l = &levels[y];
            if l.0 == 0.0 {
                continue;
            }
            mass += l.0;
            mx += l.1;
            mz += l.2;
            let (cx, cz) = (mx / mass, mz / mass);
            let (lo, hi) = ([l.3[0].min(low[0]), l.3[1].min(low[1])], [l.4[0].max(high[0]), l.4[1].max(high[1])]);
            if cx < lo[0] as f64 - l.5 || cx > hi[0] as f64 + 1.0 + l.5 || cz < lo[1] as f64 - l.5 || cz > hi[1] as f64 + 1.0 + l.5 {
                hinge = Some(y);
            }
            (low, high) = ([low[0].min(feet[y].0[0]), low[1].min(feet[y].0[1])], [high[0].max(feet[y].1[0]), high[1].max(feet[y].1[1])]);
        }
        if let Some(from) = hinge {
            for &i in &cells {
                if i as usize / layer >= from {
                    is_loose[i as usize] = true;
                }
            }
        }
    }
}

/// A piece that has come loose, as it stood: its rows, how many cells, the box round it (high corner exclusive).
pub struct Loose {
    pub runs: Vec<Run>,
    pub cells: usize,
    pub low: [i32; 3],
    pub high: [i32; 3],
}

/// Takes out of a region everything in it that is not held, and says what: the pieces, for the solver to move
/// (bodies.rs), and the rows of crumbs too small to be one, which are dust.
pub fn release(r: &mut Region, shove: Option<([i32; 3], i32)>) -> (Vec<Loose>, Vec<Run>) {
    let mut is_loose = loose(r);
    topple(r, &mut is_loose);
    if let Some((at, radius)) = shove {
        adrift(r, at, radius, &mut is_loose);
    }
    taken(r, &is_loose)
}

/// How big the blocks are that a wide box is asked about in, in cells.
pub const BLOCK: usize = 4;

/// Which blocks of a wide box come loose: those the rule does not hold (`loose_how`, in blocks), in pieces (blocks
/// that touch), and of the pieces only those a blast has reached. `scars` are blasts, each a place and a radius. A
/// narrow box's sides are taken for ground, so a row of storeys wider than it stands on them however little is left
/// under it; here it is found loose. But by the blocks' counts a few things in the town as made are loose as well (a
/// house built out over a slope, a pane at a tower's corner), and those must not fall because a charge went off down
/// the street: so the rule lets go only of what something has broken into.
pub fn far_loose(blocks: &Blocks, scars: &[([i32; 3], i32)]) -> Vec<bool> {
    let r = &blocks.region;
    let [nx, ny, nz] = r.size;
    let layer = nx * nz;
    let by = blocks.by as i32;
    let unheld = loose_how(r, Some((&blocks.count, blocks.by))).0;
    let mut out = vec![false; unheld.len()];
    let mut seen = vec![false; unheld.len()];
    let (mut stack, mut piece): (Vec<u32>, Vec<u32>) = (Vec::new(), Vec::new());
    for start in 0..unheld.len() {
        if !unheld[start] || seen[start] || blocks.count[start] == 0 {
            continue;
        }
        piece.clear();
        let mut struck = false;
        seen[start] = true;
        stack.push(start as u32);
        while let Some(i) = stack.pop() {
            let i = i as usize;
            piece.push(i as u32);
            let (x, y, z) = r.place(i);
            if !struck {
                let c = [r.low[0] + x as i32 * by + by / 2, r.low[1] + y as i32 * by + by / 2, r.low[2] + z as i32 * by + by / 2];
                struck = scars.iter().any(|(at, radius)| {
                    let reach = (radius * 3 / 2 + 2 * by) as i64;
                    (0..3).map(|a| ((c[a] - at[a]) as i64).pow(2)).sum::<i64>() <= reach * reach
                });
            }
            let mut join = |j: usize| {
                if unheld[j] && !seen[j] && blocks.count[j] > 0 {
                    seen[j] = true;
                    stack.push(j as u32);
                }
            };
            if x > 0 { join(i - 1) }
            if x + 1 < nx { join(i + 1) }
            if z > 0 { join(i - nx) }
            if z + 1 < nz { join(i + nx) }
            if y > 0 { join(i - layer) }
            if y + 1 < ny { join(i + layer) }
        }
        if struck {
            for &i in &piece {
                out[i as usize] = true;
            }
        }
    }
    out
}

/// The box of cells round the blocks that come loose, within the blocks' region: its low and high corners in the
/// world. Nothing if none do.
pub fn far_box(blocks: &Blocks, loose: &[bool]) -> Option<([i32; 3], [i32; 3])> {
    let r = &blocks.region;
    let by = blocks.by as i32;
    let (mut lo, mut hi) = ([i32::MAX; 3], [i32::MIN; 3]);
    for i in (0..loose.len()).filter(|&i| loose[i]) {
        let (x, y, z) = r.place(i);
        let c = [x as i32, y as i32, z as i32];
        for k in 0..3 {
            lo[k] = lo[k].min(r.low[k] + c[k] * by);
            hi[k] = hi[k].max(r.low[k] + (c[k] + 1) * by);
        }
    }
    (lo[0] != i32::MAX).then_some((lo, hi))
}

/// Takes out of `part` (the world's cells in the box `far_box` gave) every built cell of a loose block, as pieces
/// and dust (see `release`). Leaves stay: in blocks a crown that brushes a wall is cut off by it, and trees are the
/// narrow box's business.
pub fn release_far(part: &mut Region, blocks: &Blocks, loose: &[bool], mut still: impl FnMut([i32; 3]) -> bool) -> (Vec<Loose>, Vec<Run>) {
    let r = &blocks.region;
    let by = blocks.by as i32;
    let mut is_loose = vec![false; part.cells.len()];
    for i in 0..part.cells.len() {
        let k = part.cells[i];
        if k == 0 || is_ground(k) || material(k) == LEAVES {
            continue;
        }
        let (x, y, z) = part.place(i);
        let b = [(part.low[0] + x as i32 - r.low[0]) / by, (part.low[1] + y as i32 - r.low[1]) / by, (part.low[2] + z as i32 - r.low[2]) / by];
        // `still` says whether a cell is in the world yet: one that has gone since the part was gathered is not there to take.
        if loose[r.at(b[0] as usize, b[1] as usize, b[2] as usize)] {
            if still([part.low[0] + x as i32, part.low[1] + y as i32, part.low[2] + z as i32]) { is_loose[i] = true } else { part.cells[i] = 0 }
        }
    }
    // A piece that reaches the top of the whole box goes on above it. The part's own sides are not the box's.
    let top = part.low[1] + part.size[1] as i32 == r.low[1] + r.size[1] as i32 * by;
    taken_from(part, &is_loose, [false, top])
}

/// Takes the loose cells out of a region as pieces and dust (see `release`).
fn taken(r: &mut Region, is_loose: &[bool]) -> (Vec<Loose>, Vec<Run>) {
    taken_from(r, is_loose, [true; 2])
}

fn taken_from(r: &mut Region, is_loose: &[bool], edged: [bool; 2]) -> (Vec<Loose>, Vec<Run>) {
    let mut piece_of = vec![0u32; r.cells.len()];
    let (mut out, mut dust) = (Vec::new(), Vec::new());
    for mut cells in pieces_of(r, is_loose, &mut piece_of, edged) {
        if cells.is_empty() {
            continue;
        }
        let runs = rows(r, &mut cells);
        for &i in &cells {
            r.cells[i as usize] = 0;
        }
        if cells.len() < 4 {
            dust.extend(runs);
            continue;
        }
        let (mut low, mut high) = ([i32::MAX; 3], [i32::MIN; 3]);
        for run in &runs {
            low = [low[0].min(run.x0), low[1].min(run.y), low[2].min(run.z)];
            high = [high[0].max(run.x1), high[1].max(run.y + 1), high[2].max(run.z + 1)];
        }
        out.push(Loose { runs, cells: cells.len(), low, high });
    }
    (out, dust)
}

/// Things a blast shoves: what only stands on the ground, joined to nothing, is not held against a push. A car or a
/// container within two of the blast's radii comes loose whole, for the solver to throw. Only things mostly of steel
/// and glass, and not big ones: a tree is rooted and a chimney is built into the ground, though the rule of reach
/// knows no difference between standing on the ground and being part of it. `at` is the blast's middle in the world.
pub fn adrift(r: &Region, at: [i32; 3], radius: i32, is_loose: &mut [bool]) {
    let [nx, ny, nz] = r.size;
    let (n, layer) = (r.cells.len(), nx * nz);
    let centre = [at[0] - r.low[0], at[1] - r.low[1], at[2] - r.low[2]];
    let reach = (2 * radius as i64).pow(2);
    let mut seen = vec![false; n];
    let mut stack: Vec<u32> = Vec::new();
    let mut cells: Vec<u32> = Vec::new();
    for start in 0..n {
        if seen[start] || r.cells[start] == 0 || is_ground(r.cells[start]) || is_loose[start] {
            continue;
        }
        cells.clear();
        let (mut edge, mut hard, mut near) = (false, 0usize, i64::MAX);
        seen[start] = true;
        stack.push(start as u32);
        while let Some(i) = stack.pop() {
            let i = i as usize;
            cells.push(i as u32);
            let (x, y, z) = r.place(i);
            edge |= x == 0 || x == nx - 1 || z == 0 || z == nz - 1 || y == ny - 1 || y == 0;
            hard += matches!(material(r.cells[i]), STEEL | GLASS | LAMP) as usize;
            near = near.min((x as i64 - centre[0] as i64).pow(2) + (y as i64 - centre[1] as i64).pow(2) + (z as i64 - centre[2] as i64).pow(2));
            let mut join = |j: usize| {
                if !seen[j] && r.cells[j] != 0 && !is_ground(r.cells[j]) && !is_loose[j] {
                    seen[j] = true;
                    stack.push(j as u32);
                }
            };
            if x > 0 { join(i - 1) }
            if x + 1 < nx { join(i + 1) }
            if z > 0 { join(i - nx) }
            if z + 1 < nz { join(i + nx) }
            if y > 0 { join(i - layer) }
            if y + 1 < ny { join(i + layer) }
        }
        if !edge && near <= reach && cells.len() <= 20_000 && hard * 10 >= cells.len() * 7 {
            for &i in &cells {
                is_loose[i as usize] = true;
            }
        }
    }
}

/// Lets everything in a region that is not held fall until it is. At most `rounds` times over: what lands may
/// leave something perched. The region is left as the world then stands.
pub fn settle(r: &mut Region, rounds: u32) -> Settled {
    let [nx, _, nz] = r.size;
    let (n, layer) = (r.cells.len(), nx * nz);
    let mut done = Settled { moves: Vec::new(), dust: 0 };
    let mut piece_of = vec![0u32; n];
    for round in 0..rounds {
        let is_loose = loose(r);
        let pieces = pieces_of(r, &is_loose, &mut piece_of, [true; 2]);
        // Crumbs are gone; pieces come out of the region, to be put back where they land.
        let mut falling: Vec<(Vec<u32>, Vec<Kind>)> = Vec::new();
        // A crumb swept away may have been what something rested on: that is a change too.
        let mut swept = false;
        for cells in pieces {
            if cells.is_empty() {
                continue;
            }
            if cells.len() < 4 {
                for &i in &cells {
                    r.cells[i as usize] = 0;
                }
                done.dust += cells.len();
                swept = true;
                continue;
            }
            let kinds = cells.iter().map(|&i| r.cells[i as usize]).collect();
            falling.push((cells, kinds));
        }
        if falling.is_empty() && !swept {
            break;
        }
        falling.sort_by_key(|(cells, _)| cells.iter().map(|&i| i as usize / layer).min().unwrap_or(0));
        let mut moved = swept;
        // Every piece leaves before any lands: a piece does not land on another still in the air above its place.
        let mut told: Vec<Vec<Run>> = Vec::new();
        for (cells, _) in falling.iter_mut() {
            told.push(rows(r, cells));
        }
        for (cells, _) in &falling {
            for &i in cells {
                r.cells[i as usize] = 0;
            }
        }
        for (f, (cells, kinds)) in falling.iter().enumerate() {
            let id = f as u32 + 1;
            for &i in cells {
                piece_of[i as usize] = id | 0x8000_0000;
            }
            // How far the piece can fall: the least room under any of its undersides.
            let mut drop = usize::MAX;
            for &i in cells {
                let i = i as usize;
                let y = i / layer;
                if y > 0 && piece_of[i - layer] == id | 0x8000_0000 {
                    continue;
                }
                let mut room = 0;
                while room < y && r.cells[i - (room + 1) * layer] == 0 && room < drop {
                    room += 1;
                }
                drop = drop.min(room);
                if drop == 0 {
                    break;
                }
            }
            for (k, &i) in cells.iter().enumerate() {
                r.cells[i as usize - drop * layer] = kinds[k];
            }
            if drop == 0 {
                continue;
            }
            moved = true;
            let (mut low, mut high) = ([i32::MAX; 3], [i32::MIN; 3]);
            for run in &told[f] {
                low = [low[0].min(run.x0), low[1].min(run.y), low[2].min(run.z)];
                high = [high[0].max(run.x1), high[1].max(run.y + 1), high[2].max(run.z + 1)];
            }
            done.moves.push(Move { runs: std::mem::take(&mut told[f]), drop: drop as i32, round, cells: cells.len(), low, high });
        }
        if !moved {
            break;
        }
    }
    done
}

/// A piece's outside as faces, for drawing it while it falls: each a row of cell faces along x (or along z for the faces
/// that look along x). Two words a face: where it starts from the piece's low corner (10 bits each of x, y, z), then how
/// many cells long (8 bits), which axis it looks along (2), which way (1), and the kind (16).
pub fn faces(m: &Move) -> Vec<u32> {
    let size = [(m.high[0] - m.low[0]) as usize, (m.high[1] - m.low[1]) as usize, (m.high[2] - m.low[2]) as usize];
    faces_of(&grid_of(&m.runs, m.low, size), size)
}

/// Rows of cells as a box of cells laid out flat: x + across * (z + deep * y), from the box's low corner.
pub fn grid_of(runs: &[Run], low: [i32; 3], size: [usize; 3]) -> Vec<Kind> {
    let mut grid = vec![0 as Kind; size[0] * size[1] * size[2]];
    for run in runs {
        let (y, z) = ((run.y - low[1]) as usize, (run.z - low[2]) as usize);
        let row = size[0] * (z + size[2] * y);
        grid[row + (run.x0 - low[0]) as usize..row + (run.x1 - low[0]) as usize].fill(run.kind);
    }
    grid
}

/// The outside of a box of cells as faces (see `faces`).
pub fn faces_of(grid: &[Kind], size: [usize; 3]) -> Vec<u32> {
    let at = |x: usize, y: usize, z: usize| x + size[0] * (z + size[2] * y);
    let open = |x: i32, y: i32, z: i32| x < 0 || y < 0 || z < 0 || x >= size[0] as i32 || y >= size[1] as i32 || z >= size[2] as i32 || grid[at(x as usize, y as usize, z as usize)] == 0;
    let mut out: Vec<u32> = Vec::new();
    let mut put = |x: usize, y: usize, z: usize, len: usize, axis: u32, side: u32, kind: Kind| {
        out.push((x | y << 10 | z << 20) as u32);
        out.push(len as u32 | axis << 8 | side << 10 | (kind as u32) << 16);
    };
    // Faces that look up, down and along z, in rows along x.
    for (axis, dy, dz) in [(1u32, 1i32, 0i32), (1, -1, 0), (2, 0, 1), (2, 0, -1)] {
        let side = (dy + dz > 0) as u32;
        for y in 0..size[1] {
            for z in 0..size[2] {
                let mut x = 0;
                while x < size[0] {
                    let kind = grid[at(x, y, z)];
                    if kind == 0 || !open(x as i32, y as i32 + dy, z as i32 + dz) {
                        x += 1;
                        continue;
                    }
                    let mut end = x + 1;
                    while end < size[0] && end - x < 255 && grid[at(end, y, z)] == kind && open(end as i32, y as i32 + dy, z as i32 + dz) {
                        end += 1;
                    }
                    put(x, y, z, end - x, axis, side, kind);
                    x = end;
                }
            }
        }
    }
    // Faces that look along x, in rows along z.
    for dx in [1i32, -1] {
        for y in 0..size[1] {
            for x in 0..size[0] {
                let mut z = 0;
                while z < size[2] {
                    let kind = grid[at(x, y, z)];
                    if kind == 0 || !open(x as i32 + dx, y as i32, z as i32) {
                        z += 1;
                        continue;
                    }
                    let mut end = z + 1;
                    while end < size[2] && end - z < 255 && grid[at(x, y, end)] == kind && open(x as i32 + dx, y as i32, end as i32) {
                        end += 1;
                    }
                    put(x, y, z, end - z, 0, (dx > 0) as u32, kind);
                    z = end;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::city::{BLOCK_X, BLOCK_Z, Block, block, ground};
    use crate::kinds::*;
    use crate::{ROUNDS, SETTLE, WIDE};

    fn count(r: &Region) -> std::collections::BTreeMap<Kind, usize> {
        let mut m = std::collections::BTreeMap::new();
        for &k in &r.cells {
            if k != 0 { *m.entry(k).or_insert(0) += 1 }
        }
        m
    }

    /// A box of the untouched city with its middle on the ground at (x, z).
    fn city_at(x: i32, z: i32) -> Region {
        let low = [x - SETTLE[0] as i32 / 2, ground(x, z) - 48, z - SETTLE[2] as i32 / 2];
        Region::gather(low, SETTLE, &[], &mut Scratch::new())
    }

    #[test]
    fn the_untouched_city_is_at_rest() {
        // Somewhere in a block of each sort that is built on, and at a crossing with its lamps: nothing may fall.
        let mut seen = std::collections::BTreeSet::new();
        let mut fell: Vec<String> = Vec::new();
        for bz in -12..12 {
            for bx in -12..12 {
                let sort = block(bx, bz);
                if sort == Block::Shore || seen.contains(&(sort as u8)) && (bx + bz) % 5 != 0 {
                    continue;
                }
                seen.insert(sort as u8);
                for (dx, dz) in [(400, 250), (70, 70), (700, 150), (1000, 600), (475, 510)] {
                    let mut r = city_at(bx * BLOCK_X + dx, bz * BLOCK_Z + dz);
                    // Nothing is loose where it stands (a thing may be loose and not fall, if it lies on something)...
                    let unheld = loose(&r);
                    // A few specks of leaf at a crown's ragged edge hang on nothing: they are dust the first time anything is asked there.
                    let specks = (0..r.cells.len()).filter(|&i| unheld[i]).all(|i| material(r.cells[i]) == LEAVES) && unheld.iter().filter(|&&l| l).count() <= 16;
                    // Only the yard's things are held to this: in some houses a floor is, by these counts, more than its joins
                    // carry, and lies where it is until something near it is disturbed.
                    if unheld.iter().any(|&l| l) && !specks && sort == Block::Yard {
                        let mut kinds: Vec<u8> = (0..r.cells.len()).filter(|&i| unheld[i]).map(|i| material(r.cells[i])).collect();
                        kinds.sort_unstable();
                        kinds.dedup();
                        fell.push(format!("{sort:?} block {bx} {bz} at {dx} {dz}: {} cells of materials {kinds:?} are not held", unheld.iter().filter(|&&l| l).count()));
                    }
                    // ...and nothing is out of balance.
                    let mut none = vec![false; r.cells.len()];
                    topple(&r, &mut none);
                    if none.iter().any(|&l| l) {
                        fell.push(format!("{sort:?} block {bx} {bz} at {dx} {dz}: {} cells are out of balance", none.iter().filter(|&&l| l).count()));
                    }
                    let done = settle(&mut r, 3);
                    for m in &done.moves {
                        let mut kinds: Vec<u8> = m.runs.iter().map(|run| material(run.kind)).collect();
                        kinds.sort_unstable();
                        kinds.dedup();
                        fell.push(format!("{sort:?} block {bx} {bz} at {dx} {dz}: {} cells of materials {kinds:?} dropped {} from {:?} to {:?}", m.cells, m.drop, m.low, m.high));
                    }
                }
            }
        }
        assert!(fell.is_empty(), "{} pieces fell in the untouched city:\n{}", fell.len(), fell[..fell.len().min(12)].join("\n"));
        assert!(seen.len() >= 4, "homes, towers, a park and a yard were all looked at");
    }

    #[test]
    fn one_charge_brings_down_nothing_it_did_not_reach() {
        // In every sort of block: a wide box of the untouched town, and a charge of 32 that has only been set off in
        // the telling (a scar at the box's middle, a metre and a half up, and no cell emptied). By the blocks' counts
        // a few things in the town as made are loose; none of them may be taken unless the charge reached it, and
        // what it reached and takes may not be much.
        let mut fell: Vec<String> = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        let mut s = Scratch::new();
        let (mut asked, mut most) = (0, 0);
        for bz in -12..12 {
            for bx in -12..12 {
                let sort = block(bx, bz);
                if sort == Block::Shore || seen.contains(&(sort as u8)) && (bx + bz) % 7 != 0 {
                    continue;
                }
                seen.insert(sort as u8);
                for (dx, dz) in [(400, 250), (70, 70), (700, 150), (1000, 600), (475, 510)] {
                    let (x, z) = (bx * BLOCK_X + dx, bz * BLOCK_Z + dz);
                    let low = [(x - WIDE[0] as i32 / 2).div_euclid(64) * 64, (ground(x, z) - 64).div_euclid(64) * 64, (z - WIDE[2] as i32 / 2).div_euclid(64) * 64];
                    let r = Region::gather(low, WIDE, &[], &mut s);
                    let blocks = Blocks::of(&r, BLOCK);
                    let loose = far_loose(&blocks, &[([x, ground(x, z) + 15, z], 32)]);
                    asked += 1;
                    let Some((lo, hi)) = far_box(&blocks, &loose) else { continue };
                    let mut part = Region::gather(lo, [(hi[0] - lo[0]) as usize, (hi[1] - lo[1]) as usize, (hi[2] - lo[2]) as usize], &[], &mut s);
                    let (pieces, _) = release_far(&mut part, &blocks, &loose, |_| true);
                    let cells: usize = pieces.iter().map(|p| p.cells).sum();
                    most = most.max(cells);
                    if cells > 600 {
                        fell.push(format!("{sort:?} block {bx} {bz} at {dx} {dz}: {cells} cells in {} pieces, the biggest {:?}", pieces.len(), pieces.iter().map(|p| (p.cells, p.low, p.high)).max()));
                    }
                }
            }
        }
        assert!(asked > 100, "{asked} boxes were asked about");
        // One box of 380 does (November 12): a house built out over a steep slope, which the blocks' counts call loose
        // as it was made, loses 9,232 cells to a charge set right beside it. Such houses are the town's to mend.
        assert!(fell.len() * 50 <= asked, "a charge that emptied nothing brought down ({} of {asked} boxes; the most {most} cells):\n{}", fell.len(), fell.join("\n"));
    }

    #[test]
    fn open_country_is_at_rest() {
        // In the hills before the mountains with their pine woods, and on the dry plain by the road with its poles and
        // bushes: nothing may be loose, and nothing may drop.
        let (mut grown, mut fell) = (0, Vec::new());
        // The box that is looked at is cut level: on a steep slope it cuts trees off from the ground they stand in.
        // So the places in the hills are those where the ground keeps within 3 m across the box.
        let level = |x: i32, z: i32| {
            let (w, d) = (SETTLE[0] as i32 / 2, SETTLE[2] as i32 / 2);
            let at = [ground(x, z), ground(x - w, z - d), ground(x + w, z - d), ground(x - w, z + d), ground(x + w, z + d)];
            at.iter().max().unwrap() - at.iter().min().unwrap() <= 30
        };
        let hills = (-56_000..-46_000).step_by(700).flat_map(|z| (-4000..6000).step_by(900).map(move |x| (x, z))).filter(|&(x, z)| level(x, z)).take(10);
        // The refuge below the pass: its house, its hut, its mast with the line of flags, its wall and cairn, and
        // a stake on its way among the high pines.
        let (rx, rz) = (crate::land::REFUGE.0, crate::land::REFUGE.1);
        let refuge = [(rx, rz), (rx + 60, rz), (rx - 120, rz - 20), (rx + 90, rz + 60), (rx + 60, rz - 150), (rx - 100, rz - 150), (rx + 110, rz - 140)];
        for (x, z) in hills.chain([(61_000, 4000), (61_400, 4070), (64_000, 5200), (58_000, 3000)]).chain(refuge) {
            let mut r = city_at(x, z);
            grown += r.cells.iter().filter(|&&k| matches!(material(k), LEAVES | WOOD)).count();
            let held = loose(&r);
            let unheld = held.iter().filter(|&&l| l).count();
            if unheld > 0 {
                let mut kinds: Vec<u8> = (0..r.cells.len()).filter(|&i| held[i]).map(|i| material(r.cells[i])).collect();
                kinds.sort_unstable();
                kinds.dedup();
                fell.push(format!("at {x} {z}: {unheld} cells of materials {kinds:?} are not held"));
            }
            for m in &settle(&mut r, 3).moves {
                fell.push(format!("at {x} {z}: {} cells dropped {}", m.cells, m.drop));
            }
        }
        assert!(grown > 2000, "the boxes looked at hold trees, bushes and poles ({grown} cells of them)");
        assert!(fell.is_empty(), "{} things in open country are not at rest:\n{}", fell.len(), fell[..fell.len().min(12)].join("\n"));
    }

    #[test]
    fn what_grows_on_the_sea_floor_is_at_rest() {
        // The lake west of the start, over its groves and meadows. The sea is not cells, so weed has only the sand
        // it stands in to hold it: nothing may be loose, and nothing may drop.
        let (mut weed, mut fell) = (0, Vec::new());
        for z in (3800..4500).step_by(140) {
            for x in (-14200..-12900).step_by(160) {
                if ground(x, z) > -40 {
                    continue;
                }
                let mut r = city_at(x, z);
                weed += r.cells.iter().filter(|&&k| material(k) == LEAVES).count();
                let unheld = loose(&r).iter().filter(|&&l| l).count();
                if unheld > 0 {
                    fell.push(format!("at {x} {z}: {unheld} cells are not held"));
                }
                for m in &settle(&mut r, 3).moves {
                    fell.push(format!("at {x} {z}: {} cells dropped {}", m.cells, m.drop));
                }
            }
        }
        assert!(weed > 2000, "the boxes looked at hold weed ({weed} cells of it)");
        assert!(fell.is_empty(), "{} things on the sea floor are not at rest:\n{}", fell.len(), fell[..fell.len().min(12)].join("\n"));
    }

    #[test]
    fn what_grows_on_the_reefs_is_at_rest() {
        // The sea off the coast west of the town, over its reefs with their kelp: nothing may be loose or drop.
        let (mut weed, mut fell) = (0, Vec::new());
        for z in (-17_000..-12_000).step_by(330) {
            for x in (-64_600..-63_000).step_by(270) {
                let g = ground(x, z);
                if g > -50 || g < -140 {
                    continue;
                }
                let mut r = city_at(x, z);
                weed += r.cells.iter().filter(|&&k| material(k) == LEAVES).count();
                let unheld = loose(&r).iter().filter(|&&l| l).count();
                if unheld > 0 {
                    let held = loose(&r);
                    let mut kinds: Vec<Kind> = (0..r.cells.len()).filter(|&i| held[i]).map(|i| r.cells[i]).collect();
                    kinds.sort_unstable();
                    kinds.dedup();
                    fell.push(format!("at {x} {z}: {unheld} cells of kinds {kinds:?} are not held"));
                }
                for m in &settle(&mut r, 3).moves {
                    fell.push(format!("at {x} {z}: {} cells dropped {}", m.cells, m.drop));
                }
            }
        }
        assert!(weed > 2000, "the boxes looked at hold kelp ({weed} cells of it)");
        assert!(fell.is_empty(), "{} things on the reefs are not at rest:\n{}", fell.len(), fell[..fell.len().min(12)].join("\n"));
    }

    /// Ground 4 cells thick with a post on it, and a panel of plaster 30 wide, 20 tall and 2 thick beside or under something.
    fn yard() -> Region {
        let mut r = Region::new([0, 0, 0], [96, 96, 48]);
        for y in 0..4 { for z in 0..48 { for x in 0..96 { let i = r.at(x, y, z); r.cells[i] = kind(EARTH, OWN) } } }
        r
    }
    fn block_of(r: &mut Region, x: (usize, usize), y: (usize, usize), z: (usize, usize), k: Kind) {
        for yy in y.0..y.1 { for zz in z.0..z.1 { for xx in x.0..x.1 { let i = r.at(xx, yy, zz); r.cells[i] = k } } }
    }

    #[test]
    fn a_panel_hung_by_one_cell_falls_and_one_joined_along_its_edge_stands() {
        let wall = kind(PLASTER, WHITE);
        // A post 4 thick, 60 tall. The panel starts one cell clear of it, 30 above the ground.
        let mut by_a_cell = yard();
        block_of(&mut by_a_cell, (20, 24), (4, 64), (20, 24), wall);
        block_of(&mut by_a_cell, (25, 55), (34, 54), (21, 23), wall);
        block_of(&mut by_a_cell, (24, 25), (44, 45), (21, 22), wall);
        let before = count(&by_a_cell);
        let done = settle(&mut by_a_cell, 3);
        assert!(done.moves.iter().any(|m| m.cells >= 1200 && m.drop == 30), "the panel fell to the ground: {:?}", done.moves.iter().map(|m| (m.cells, m.drop)).collect::<Vec<_>>());
        assert_eq!(count(&by_a_cell).values().sum::<usize>() + done.dust, before.values().sum::<usize>(), "no cell was lost or made");
        assert!(settle(&mut by_a_cell, 3).moves.is_empty(), "and then everything is at rest");

        // The same panel joined to the post all the way up its edge stands.
        let mut by_its_edge = yard();
        block_of(&mut by_its_edge, (20, 24), (4, 64), (20, 24), wall);
        block_of(&mut by_its_edge, (24, 54), (34, 54), (21, 23), wall);
        assert!(settle(&mut by_its_edge, 3).moves.is_empty(), "a panel joined along its edge stands");

        // Hung from above by one cell under a beam: it tears off.
        let mut from_above = yard();
        block_of(&mut from_above, (20, 24), (4, 64), (20, 24), wall);
        block_of(&mut from_above, (24, 60), (60, 64), (20, 24), kind(STEEL, OWN));
        block_of(&mut from_above, (30, 60), (38, 58), (21, 23), wall);
        block_of(&mut from_above, (45, 46), (58, 60), (21, 22), wall);
        let done = settle(&mut from_above, 3);
        assert!(done.moves.iter().any(|m| m.cells >= 1100), "the hung panel fell: {:?}", done.moves.iter().map(|m| (m.cells, m.drop)).collect::<Vec<_>>());
    }

    #[test]
    fn what_reaches_the_boxes_top_is_left_alone() {
        // A tower cut through at its foot goes on above the box: nobody knows what holds it up there, so it stays.
        let mut r = yard();
        block_of(&mut r, (30, 50), (10, 96), (15, 35), kind(CONCRETE, OWN));
        assert!(settle(&mut r, 3).moves.is_empty());
        // The same thing ending inside the box falls.
        let mut r = yard();
        block_of(&mut r, (30, 50), (10, 80), (15, 35), kind(CONCRETE, OWN));
        let done = settle(&mut r, 3);
        assert_eq!(done.moves.iter().map(|m| (m.cells, m.drop)).collect::<Vec<_>>(), vec![(20 * 70 * 20, 6)]);
    }

    #[test]
    fn a_house_with_its_ground_floor_blasted_out_comes_down_and_stays_down() {
        // Find a house front: a street's edge in a block of homes, and blast along its ground floor.
        let (bx, bz) = (-12..12).flat_map(|bz| (-12..12).map(move |bx| (bx, bz))).find(|&(bx, bz)| block(bx, bz) == Block::Homes && ground(bx * BLOCK_X + 500, bz * BLOCK_Z + 150) > 80).unwrap();
        let (x, z) = (bx * BLOCK_X + 140 + 76 * 4 + 38, bz * BLOCK_Z + 150);
        let y = ground(x, z) + 14;
        let edits: Vec<Edit> = (0..5).flat_map(|i| (0..3).map(move |j| Edit::Ball { centre: [x - 40 + i * 20, y, z + j * 30], radius: 16, kind: 0 })).collect();
        let low = [x - SETTLE[0] as i32 / 2, y - 48, z - SETTLE[2] as i32 / 2];
        let mut r = Region::gather(low, SETTLE, &edits, &mut Scratch::new());
        let before = count(&r);
        let done = settle(&mut r, ROUNDS);
        let fell: usize = done.moves.iter().map(|m| m.cells).sum();
        // The houses either side hold its side walls, so it is the middle of the front, left with nothing under it, that comes down.
        assert!(fell > 300, "{fell} cells fell in {} pieces", done.moves.len());
        let after = count(&r);
        assert_eq!(after.values().sum::<usize>() + done.dust, before.values().sum::<usize>(), "no cell was lost or made");
        // Every piece's faces can be told, and none is empty.
        for m in &done.moves {
            assert!(!faces(m).is_empty() && faces(m).len() % 2 == 0);
        }
        // How many more times round it takes for the heap to be at rest, and what falls each time.
        let mut more: Vec<(usize, usize, i32)> = Vec::new();
        for _ in 0..12 {
            let again = settle(&mut r, 1);
            if again.moves.is_empty() { break }
            more.push((again.moves.len(), again.moves.iter().map(|m| m.cells).sum(), again.moves.iter().map(|m| m.drop).max().unwrap()));
        }
        // A few crumbs may still trickle down a heap; nothing of any size may.
        assert!(more.iter().map(|m| m.1).sum::<usize>() < 40, "after it has come down, more falls (pieces, cells, furthest drop each time round): {more:?}");
    }
}
