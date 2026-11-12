//! What holds up, and what falls. After a change, the cells round it are asked whether the
//! ground still reaches them: resting on a held cell costs nothing, a cell sideways costs one,
//! a cell hung from above two, and a cell further than its material spans is not held
//! (kinds.rs). Reach alone would let a wall hang by a thread, so each sideways or hanging join
//! also carries only so many cells: past that it tears and all it carried is loose.
//!
//! Loose cells that touch one another are a piece. `release` takes the pieces out for the solver
//! to move (bodies.rs). `settle` is the older answer, kept for this rule's own tests: each piece
//! falls straight down, in whole cells, until something is under it. This is the rule for what
//! stands, in whole numbers, the same on every machine.

use crate::kinds::{LEAVES, join_carries, material, spans};
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
    fn place(&self, i: usize) -> (usize, usize, usize) {
        let layer = self.size[0] * self.size[2];
        (i % self.size[0], i / layer, (i % layer) / self.size[0])
    }

    /// The world as it stands in this box: the city's rules, then the edits, a sector at a time.
    pub fn gather(low: [i32; 3], size: [usize; 3], edits: &[Edit], s: &mut Scratch) -> Self {
        let mut region = Region::new(low, size);
        let side = SIDE as i32;
        let high = [low[0] + size[0] as i32, low[1] + size[1] as i32, low[2] + size[2] as i32];
        for sy in low[1].div_euclid(side)..=(high[1] - 1).div_euclid(side) {
            for sz in low[2].div_euclid(side)..=(high[2] - 1).div_euclid(side) {
                for sx in low[0].div_euclid(side)..=(high[0] - 1).div_euclid(side) {
                    fill(s, sx, sy, sz, 0, edits);
                    // The part of the sector that is in the box.
                    let from = [(low[0] - sx * side).max(0), (low[1] - sy * side).max(0), (low[2] - sz * side).max(0)];
                    let to = [(high[0] - sx * side).min(side), (high[1] - sy * side).min(side), (high[2] - sz * side).min(side)];
                    for y in from[1]..to[1] {
                        for z in from[2]..to[2] {
                            let src = at(from[0] as usize, y as usize, z as usize);
                            let dst = region.at((sx * side + from[0] - low[0]) as usize, (sy * side + y - low[1]) as usize, (sz * side + z - low[2]) as usize);
                            let n = (to[0] - from[0]) as usize;
                            region.cells[dst..dst + n].copy_from_slice(&s.cells[src..src + n]);
                        }
                    }
                }
            }
        }
        region
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

/// Which solid cells of a region the ground does not hold: one true a cell.
pub fn loose(r: &Region) -> Vec<bool> {
    let [nx, ny, nz] = r.size;
    let (n, layer) = (r.cells.len(), nx * nz);
    let mut cost = vec![UNREACHED; n];
    let mut join = vec![NONE; n];
    let mut order: Vec<u32> = Vec::new();
    let mut waiting: Vec<Vec<u32>> = vec![Vec::new(); 256];
    // What is at the bottom of the box, and at its sides, goes on beyond it: the ground's.
    for i in 0..n {
        if r.cells[i] == 0 {
            continue;
        }
        let (x, y, z) = r.place(i);
        if y == 0 || x == 0 || x == nx - 1 || z == 0 || z == nz - 1 {
            cost[i] = 0;
            join[i] = GROUND;
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
                if kind == 0 || to >= cost[j] as usize || to > spans(material(kind)) as usize {
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
            if x > 0 { reach(i - 1, 1, LEANS + 1, &mut at_cost, &mut waiting) }
            if x + 1 < nx { reach(i + 1, 1, LEANS, &mut at_cost, &mut waiting) }
            if z > 0 { reach(i - nx, 1, LEANS + 3, &mut at_cost, &mut waiting) }
            if z + 1 < nz { reach(i + nx, 1, LEANS + 2, &mut at_cost, &mut waiting) }
            if y > 0 { reach(i - layer, 2, HANGS, &mut at_cost, &mut waiting) }
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
        load[i] += 1;
        let how = join[i] & 127;
        if how != GROUND {
            let h = holder(i, how);
            load[h] += load[i];
        }
    }
    // A sideways or hanging join that carries more than it can tears, and all it carried is loose.
    let mut out = vec![false; n];
    for &i in &order {
        let i = i as usize;
        let how = join[i] & 127;
        if how == GROUND {
            continue;
        }
        let h = holder(i, how);
        let strength = join_carries(material(r.cells[i]), material(r.cells[h]));
        out[i] = out[h] || (how != RESTS && load[i] > strength);
    }
    for i in 0..n {
        if r.cells[i] != 0 && cost[i] == UNREACHED {
            out[i] = true;
        }
    }
    out
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
fn pieces_of(r: &Region, is_loose: &[bool], piece_of: &mut [u32]) -> Vec<Vec<u32>> {
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
            edge |= x == 0 || x == nx - 1 || z == 0 || z == nz - 1 || y == ny - 1;
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

/// A piece that has come loose, as it stood: its rows, how many cells, the box round it (high corner exclusive).
pub struct Loose {
    pub runs: Vec<Run>,
    pub cells: usize,
    pub low: [i32; 3],
    pub high: [i32; 3],
}

/// Takes out of a region everything in it that is not held, and says what: the pieces, for the solver to move
/// (bodies.rs), and the rows of crumbs too small to be one, which are dust.
pub fn release(r: &mut Region) -> (Vec<Loose>, Vec<Run>) {
    let is_loose = loose(r);
    let mut piece_of = vec![0u32; r.cells.len()];
    let (mut out, mut dust) = (Vec::new(), Vec::new());
    for mut cells in pieces_of(r, &is_loose, &mut piece_of) {
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

/// Lets everything in a region that is not held fall until it is. At most `rounds` times over: what lands may
/// leave something perched. The region is left as the world then stands.
pub fn settle(r: &mut Region, rounds: u32) -> Settled {
    let [nx, _, nz] = r.size;
    let (n, layer) = (r.cells.len(), nx * nz);
    let mut done = Settled { moves: Vec::new(), dust: 0 };
    let mut piece_of = vec![0u32; n];
    for round in 0..rounds {
        let is_loose = loose(r);
        let pieces = pieces_of(r, &is_loose, &mut piece_of);
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
    use crate::{ROUNDS, SETTLE};

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
                for (dx, dz) in [(400, 250), (70, 70), (700, 150), (1000, 600)] {
                    let mut r = city_at(bx * BLOCK_X + dx, bz * BLOCK_Z + dz);
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
        assert!(seen.len() >= 3, "homes, towers and a park were all looked at");
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
        assert!(more.is_empty(), "after it has come down, more falls (pieces, cells, furthest drop each time round): {more:?}");
    }
}
