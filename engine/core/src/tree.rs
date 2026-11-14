//! A sector: 64 cells a side, kept as a tree three nodes deep. Each node splits its cube into
//! 4 x 4 x 4 and says in 64 bits which of those hold anything, so a ray (or a falling body)
//! steps over empty space a block at a time and reads memory only where there is something.
//! A cube that is all one kind is one node with no children. The same words are what the
//! renderer marches, what the solver collides with, and what is kept or sent.
//!
//! A node is four words: the mask's low and high halves, where its children are (words from the
//! start of the sector; for a leaf, where its cells' kinds are, two to a word), and its kind
//! (the low 16 bits, what it looks like from far off) with [`UNIFORM`] set when it is all that kind.
//! Child `c` of a node is at x + 4 z + 16 y within it. Children present are stored in that order.
//!
//! A node also says how much of its cube its contents fill: the box round them. A city is flat
//! things (ground, roofs, walls), so the box is usually a thin slab, and a ray that passes over
//! a roof steps past the whole node instead of through it cell by cell. A leaf's box is in
//! cells (2 bits a number, bits 16 to 27 of its kind word: low x, y, z then high x, y, z). A
//! mid's is in cells and the root's in leaves (4 bits a number: the low corner in bits 16 to 27
//! of the kind word, the high corner in bits 20 to 31 of the children word, whose low 20 bits
//! are where the children are). High corners are the last cell that holds something.

pub const SIDE: usize = 64;
pub const CELLS: usize = SIDE * SIDE * SIDE;
pub const UNIFORM: u32 = 1 << 31;

/// A cell's kind: what it is made of in the low byte, its colour in the high byte. 0 is air.
pub type Kind = u16;

/// Where a cell is in a sector's dense scratch.
#[inline]
pub const fn at(x: usize, y: usize, z: usize) -> usize {
    x + SIDE * (z + SIDE * y)
}

/// What a sector turned out to be.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Whole {
    Empty,
    /// Every cell is this kind.
    Uniform(Kind),
    /// A tree of this many words was written.
    Tree(usize),
}

/// The low 20 bits of a root's or a mid's children word: where its children are.
pub const CHILD: u32 = (1 << 20) - 1;

#[derive(Clone, Copy, Default)]
struct Leaf {
    mask: u64,
    kind: Kind,
    uniform: bool,
    /// The box round what it holds: the first and last cell along x, y, z (for the root, the first and last leaf).
    lo: [u8; 3],
    hi: [u8; 3],
}

/// The kind most of `kinds` are (the first such, so the answer does not depend on anything but the cells).
fn most(kinds: &[Kind]) -> Kind {
    let (mut best, mut best_n) = (0, 0);
    for (i, &k) in kinds.iter().enumerate() {
        if k == best || kinds[..i].contains(&k) {
            continue;
        }
        let n = kinds[i..].iter().filter(|&&o| o == k).count();
        if n > best_n {
            best = k;
            best_n = n;
        }
    }
    best
}

/// Writes a sector's cells as a tree into `out` (cleared first).
pub fn encode(cells: &[Kind], out: &mut Vec<u32>) -> Whole {
    encode_fine(cells, &Default::default(), &[], out)
}

/// As `encode`, where some cells hold finer cells (#259; kinds.rs FINE, scratch.rs): one more level, only there. A
/// leaf with such a cell has, after its cells' kinds, a word for each of its cells: 0, or where that cell's block is
/// (words from the start of the sector), with the top bit set where the block is 8 cells a side and not 4. A block
/// is its mask (2 words of x + 4 z + 16 y, or 16 of x + 8 z + 64 y), then its one kind with [`UNIFORM`] set, or 0
/// and the kinds of the cells present, two to a word. A block all of whose cells are alike in twos each way is
/// written 4 a side. A leaf with such a cell is never
/// all one kind, so nothing above it is, and the kinds nodes show from far off do not have the mark.
///
/// A kind is written with the mark only where its cell has a block that holds something: any other cell is written
/// as a plain cell, whatever its kind says. So whoever reads a tree (`fine_at`, the page's `fineWord`) finds a table
/// and a block behind every mark.
pub fn encode_fine(cells: &[Kind], fine_of: &std::collections::HashMap<u32, u32>, fine: &[[Kind; 512]], out: &mut Vec<u32>) -> Whole {
    let fine_mark = crate::kinds::FINE;
    assert_eq!(cells.len(), CELLS);
    out.clear();
    // A cell's block, where it has the mark and a block that is not empty.
    let block_of = |i: usize| -> Option<&[Kind; 512]> {
        if cells[i] & fine_mark == 0 {
            return None;
        }
        fine_of.get(&(i as u32)).and_then(|&b| fine.get(b as usize)).filter(|b| b.iter().any(|&k| k != 0))
    };
    // A cell's kind as the tree says it.
    let kind_of = |i: usize| -> Kind {
        let k = cells[i];
        if k & fine_mark != 0 && block_of(i).is_none() { k & !fine_mark } else { k }
    };
    // Leaves: 16 a side, each 4 cells a side.
    let mut leaves = vec![Leaf::default(); 4096];
    let mut any = false;
    for ly in 0..16 {
        for lz in 0..16 {
            for lx in 0..16 {
                let mut mask = 0u64;
                let mut kinds = [0 as Kind; 64];
                let mut n = 0;
                let (mut lo, mut hi) = ([3u8; 3], [0u8; 3]);
                for c in 0..64usize {
                    let k = kind_of(at(lx * 4 + (c & 3), ly * 4 + (c >> 4), lz * 4 + ((c >> 2) & 3)));
                    if k != 0 {
                        mask |= 1 << c;
                        kinds[n] = k;
                        n += 1;
                        for (a, v) in [c & 3, c >> 4, (c >> 2) & 3].into_iter().enumerate() {
                            lo[a] = lo[a].min(v as u8);
                            hi[a] = hi[a].max(v as u8);
                        }
                    }
                }
                if n == 0 {
                    continue;
                }
                any = true;
                let uniform = n == 64 && kinds.iter().all(|&k| k == kinds[0]) && kinds[0] & fine_mark == 0;
                leaves[lx + 16 * (lz + 16 * ly)] = Leaf { mask, kind: if uniform { kinds[0] } else { most(&kinds[..n]) & !fine_mark }, uniform, lo, hi };
            }
        }
    }
    if !any {
        return Whole::Empty;
    }
    // Mids: 4 a side, each 4 leaves a side.
    let leaf_of = |mid: usize, c: usize| {
        let (mx, mz, my) = (mid & 3, (mid >> 2) & 3, mid >> 4);
        (mx * 4 + (c & 3)) + 16 * ((mz * 4 + ((c >> 2) & 3)) + 16 * (my * 4 + (c >> 4)))
    };
    let mut mids = [Leaf::default(); 64];
    for (mid, slot) in mids.iter_mut().enumerate() {
        let mut mask = 0u64;
        let mut kinds = [0 as Kind; 64];
        let mut n = 0;
        let mut uniform = true;
        let (mut lo, mut hi) = ([15u8; 3], [0u8; 3]);
        for c in 0..64usize {
            let leaf = leaves[leaf_of(mid, c)];
            if leaf.mask != 0 {
                mask |= 1 << c;
                kinds[n] = leaf.kind;
                n += 1;
                for (a, v) in [c & 3, c >> 4, (c >> 2) & 3].into_iter().enumerate() {
                    lo[a] = lo[a].min(v as u8 * 4 + leaf.lo[a]);
                    hi[a] = hi[a].max(v as u8 * 4 + leaf.hi[a]);
                }
            }
            uniform &= leaf.uniform;
        }
        if n > 0 {
            let uniform = uniform && n == 64 && kinds.iter().all(|&k| k == kinds[0]);
            *slot = Leaf { mask, kind: if uniform { kinds[0] } else { most(&kinds[..n]) }, uniform, lo, hi };
        }
    }
    // The root's box, in leaves.
    let (mut root_lo, mut root_hi) = ([15u8; 3], [0u8; 3]);
    for (i, mid) in mids.iter().enumerate().filter(|(_, m)| m.mask != 0) {
        for (a, v) in [i & 3, i >> 4, (i >> 2) & 3].into_iter().enumerate() {
            root_lo[a] = root_lo[a].min(v as u8 * 4 + mid.lo[a] / 4);
            root_hi[a] = root_hi[a].max(v as u8 * 4 + mid.hi[a] / 4);
        }
    }
    let root_mask = mids.iter().enumerate().fold(0u64, |m, (i, mid)| if mid.mask != 0 { m | (1 << i) } else { m });
    if root_mask == u64::MAX && mids.iter().all(|m| m.uniform && m.kind == mids[0].kind) {
        return Whole::Uniform(mids[0].kind);
    }
    let root_kinds: Vec<Kind> = mids.iter().filter(|m| m.mask != 0).map(|m| m.kind).collect();
    // Laid out as: the root, the mids present, the leaves of each mid that is not uniform, then the cells' kinds.
    let mid_count = root_mask.count_ones() as usize;
    let leaf_count: usize = mids.iter().filter(|m| m.mask != 0 && !m.uniform).map(|m| m.mask.count_ones() as usize).sum();
    // `fine` is a leaf, whose box is 2 bits a number, all in the kind word.
    let node = |out: &mut Vec<u32>, mask: u64, child: usize, n: &Leaf, fine: bool| {
        let (lo, hi) = (n.lo.map(|v| v as u32), n.hi.map(|v| v as u32));
        let flag = if n.uniform { UNIFORM } else { 0 };
        if fine {
            let bounds = lo[0] | lo[1] << 2 | lo[2] << 4 | hi[0] << 6 | hi[1] << 8 | hi[2] << 10;
            out.extend_from_slice(&[mask as u32, (mask >> 32) as u32, child as u32, n.kind as u32 | bounds << 16 | flag]);
        } else {
            assert!(child as u32 <= CHILD);
            let (low, high) = (lo[0] | lo[1] << 4 | lo[2] << 8, hi[0] | hi[1] << 4 | hi[2] << 8);
            out.extend_from_slice(&[mask as u32, (mask >> 32) as u32, child as u32 | high << 20, n.kind as u32 | low << 16 | flag]);
        }
    };
    node(out, root_mask, 4, &Leaf { mask: root_mask, kind: most(&root_kinds), uniform: false, lo: root_lo, hi: root_hi }, false);
    let mut next_leaf = 4 + 4 * mid_count;
    for mid in mids.iter().filter(|m| m.mask != 0) {
        node(out, mid.mask, if mid.uniform { 0 } else { next_leaf }, mid, false);
        if !mid.uniform {
            next_leaf += 4 * mid.mask.count_ones() as usize;
        }
    }
    let mut next_kinds = 4 + 4 * mid_count + 4 * leaf_count;
    let mut kinds_out: Vec<u32> = Vec::new();
    // The blocks of fine cells, and where in `kinds_out` each is pointed to from (counted from the blocks' start until all are written).
    let (mut blocks_out, mut pointers): (Vec<u32>, Vec<usize>) = (Vec::new(), Vec::new());
    for (m, mid) in mids.iter().enumerate() {
        if mid.mask == 0 || mid.uniform {
            continue;
        }
        for c in 0..64 {
            if mid.mask & (1 << c) == 0 {
                continue;
            }
            let i = leaf_of(m, c);
            let leaf = leaves[i];
            node(out, leaf.mask, if leaf.uniform { 0 } else { next_kinds }, &leaf, true);
            if leaf.uniform {
                continue;
            }
            let (lx, lz, ly) = (i & 15, (i >> 4) & 15, i >> 8);
            let (mut word, mut half) = (0u32, 0);
            let mut any_fine = false;
            for cell in 0..64usize {
                if leaf.mask & (1 << cell) == 0 {
                    continue;
                }
                let k = kind_of(at(lx * 4 + (cell & 3), ly * 4 + (cell >> 4), lz * 4 + ((cell >> 2) & 3))) as u32;
                any_fine |= k as Kind & fine_mark != 0;
                word |= k << (16 * half);
                half += 1;
                if half == 2 {
                    kinds_out.push(word);
                    word = 0;
                    half = 0;
                }
            }
            if half == 1 {
                kinds_out.push(word);
            }
            if any_fine {
                for cell in (0..64usize).filter(|c| leaf.mask & (1 << c) != 0) {
                    let i = at(lx * 4 + (cell & 3), ly * 4 + (cell >> 4), lz * 4 + ((cell >> 2) & 3));
                    let Some(block) = block_of(i) else {
                        kinds_out.push(0);
                        continue;
                    };
                    pointers.push(kinds_out.len());
                    let (coarse, began) = (alike_in_twos(block), blocks_out.len());
                    kinds_out.push(blocks_out.len() as u32 | if coarse { 0 } else { 1 << 31 });
                    let cells: Vec<Kind> = if coarse { (0..64).map(|c| block[(c & 3) * 2 + 8 * ((c >> 2) & 3) * 2 + 64 * (c >> 4) * 2]).collect() } else { block.to_vec() };
                    for part in cells.chunks(32) {
                        blocks_out.push(part.iter().enumerate().fold(0u32, |m, (c, &k)| if k != 0 { m | 1 << c } else { m }));
                    }
                    let present: Vec<Kind> = cells.iter().copied().filter(|&k| k != 0).collect();
                    if present.iter().all(|&k| k == present[0]) {
                        blocks_out.push(present[0] as u32 | UNIFORM);
                    } else {
                        blocks_out.push(0);
                        blocks_out.extend(present.chunks(2).map(|p| p[0] as u32 | (*p.get(1).unwrap_or(&0) as u32) << 16));
                    }
                    debug_assert_eq!(blocks_out.len() - began, block_words(block));
                }
            }
            next_kinds = 4 + 4 * mid_count + 4 * leaf_count + kinds_out.len();
        }
    }
    for at in pointers {
        kinds_out[at] += (4 + 4 * mid_count + 4 * leaf_count + kinds_out.len()) as u32;
    }
    out.extend_from_slice(&kinds_out);
    out.extend_from_slice(&blocks_out);
    Whole::Tree(out.len())
}

/// Whether every two cells each way of a block are alike: it is then written 4 a side.
fn alike_in_twos(block: &[Kind; 512]) -> bool {
    (0..512).all(|c| block[c] == block[c & !0b001_001_001])
}

/// How many words `encode_fine` writes for a block that holds something: its mask, its one kind or a 0, and then its
/// kinds where they are not all one.
pub fn block_words(block: &[Kind; 512]) -> usize {
    let coarse = alike_in_twos(block);
    let mut present = block.iter().filter(|&&k| k != 0);
    let Some(&first) = present.next() else { return 0 };
    let (mut count, mut one) = (1usize, true);
    for &k in present {
        count += 1;
        one &= k == first;
    }
    let (mask, cells) = if coarse { (2, count / 8) } else { (16, count) };
    mask + 1 + if one { 0 } else { cells.div_ceil(2) }
}

/// How many of a mask's bits below `bit` are set: where child `bit` is among the children present.
#[inline]
fn before(mask: u64, bit: usize) -> usize {
    (mask & ((1u64 << bit) - 1)).count_ones() as usize
}

/// The kind of one cell of a sector's tree. `x`, `y`, `z` are 0 to 63.
pub fn kind_at(tree: &[u32], x: usize, y: usize, z: usize) -> Kind {
    let mut node = 0usize;
    for shift in [4, 2, 0] {
        let mask = tree[node] as u64 | (tree[node + 1] as u64) << 32;
        let c = ((x >> shift) & 3) + 4 * ((z >> shift) & 3) + 16 * ((y >> shift) & 3);
        if mask & (1 << c) == 0 {
            return 0;
        }
        if tree[node + 3] & UNIFORM != 0 {
            return tree[node + 3] as Kind;
        }
        if shift == 0 {
            let (child, i) = (tree[node + 2] as usize, before(mask, c));
            return (tree[child + i / 2] >> (16 * (i % 2))) as Kind;
        }
        node = (tree[node + 2] & CHILD) as usize + 4 * before(mask, c);
    }
    unreachable!()
}

/// The kind of one cell an eighth the size of a sector's own (#259): `x`, `y`, `z` are 0 to 511. Where the sector's
/// cell there holds no finer cells it is that cell's kind.
pub fn fine_at(tree: &[u32], x: usize, y: usize, z: usize) -> Kind {
    let mut node = 0usize;
    for shift in [7, 5, 3] {
        let mask = tree[node] as u64 | (tree[node + 1] as u64) << 32;
        let c = ((x >> shift) & 3) + 4 * ((z >> shift) & 3) + 16 * ((y >> shift) & 3);
        if mask & (1 << c) == 0 {
            return 0;
        }
        if tree[node + 3] & UNIFORM != 0 {
            return tree[node + 3] as Kind;
        }
        if shift == 3 {
            let (child, i, n) = (tree[node + 2] as usize, before(mask, c), mask.count_ones() as usize);
            let kind = (tree[child + i / 2] >> (16 * (i % 2))) as Kind;
            if kind & crate::kinds::FINE == 0 {
                return kind;
            }
            // Every mark has a table and a block behind it (`encode_fine`); a tree that did not would read as a plain cell.
            let Some(&word) = tree.get(child + n.div_ceil(2) + i).filter(|&&w| w != 0) else { return kind & !crate::kinds::FINE };
            let (block, side) = ((word & !(1 << 31)) as usize, if word >> 31 != 0 { 8 } else { 4 });
            let (x, y, z) = ((x & 7) * side / 8, (y & 7) * side / 8, (z & 7) * side / 8);
            let (c, words) = (x + side * (z + side * y), side * side * side / 32);
            if tree[block + c / 32] & (1 << (c % 32)) == 0 {
                return 0;
            }
            if tree[block + words] & UNIFORM != 0 {
                return tree[block + words] as Kind;
            }
            let i = (0..c / 32).map(|w| tree[block + w].count_ones() as usize).sum::<usize>() + (tree[block + c / 32] & ((1 << (c % 32)) - 1)).count_ones() as usize;
            return (tree[block + words + 1 + i / 2] >> (16 * (i % 2))) as Kind;
        }
        node = (tree[node + 2] & CHILD) as usize + 4 * before(mask, c);
    }
    unreachable!()
}

/// A tree's cells written back out, for an edit. `cells` is cleared first.
pub fn decode(tree: &[u32], cells: &mut [Kind]) {
    assert_eq!(cells.len(), CELLS);
    cells.fill(0);
    fn walk(tree: &[u32], node: usize, size: usize, x: usize, y: usize, z: usize, cells: &mut [Kind]) {
        let mask = tree[node] as u64 | (tree[node + 1] as u64) << 32;
        let info = tree[node + 3];
        if info & UNIFORM != 0 {
            for yy in y..y + size {
                for zz in z..z + size {
                    cells[at(x, yy, zz)..at(x + size, yy, zz)].fill(info as Kind);
                }
            }
            return;
        }
        let part = size / 4;
        let child = if part == 1 { tree[node + 2] as usize } else { (tree[node + 2] & CHILD) as usize };
        let mut seen = 0;
        for c in 0..64usize {
            if mask & (1 << c) == 0 {
                continue;
            }
            let (cx, cy, cz) = (x + (c & 3) * part, y + (c >> 4) * part, z + ((c >> 2) & 3) * part);
            if part == 1 {
                cells[at(cx, cy, cz)] = (tree[child + seen / 2] >> (16 * (seen % 2))) as Kind;
            } else {
                walk(tree, child + 4 * seen, part, cx, cy, cz, cells);
            }
            seen += 1;
        }
    }
    walk(tree, 0, SIDE, 0, 0, 0, cells);
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::hash::hash3;

    fn round_trip(cells: &[Kind]) -> Whole {
        let mut tree = Vec::new();
        let whole = encode(cells, &mut tree);
        if let Whole::Tree(words) = whole {
            assert_eq!(words, tree.len());
            let mut back = vec![0; CELLS];
            decode(&tree, &mut back);
            assert!(back == cells, "decode gives the cells back");
            for i in (0..CELLS).step_by(37) {
                let (x, z, y) = (i % SIDE, (i / SIDE) % SIDE, i / (SIDE * SIDE));
                assert_eq!(kind_at(&tree, x, y, z), cells[i], "cell {x} {y} {z}");
            }
        }
        whole
    }

    #[test]
    fn empty_and_uniform_need_no_tree() {
        assert_eq!(round_trip(&vec![0; CELLS]), Whole::Empty);
        assert_eq!(round_trip(&vec![7; CELLS]), Whole::Uniform(7));
    }

    #[test]
    fn ground_with_a_wall_is_small() {
        let mut cells = vec![0 as Kind; CELLS];
        for y in 0..SIDE {
            for z in 0..SIDE {
                for x in 0..SIDE {
                    if y < 20 { cells[at(x, y, z)] = 1 } else if y == 20 { cells[at(x, y, z)] = 3 } else if x == 30 && y < 50 { cells[at(x, y, z)] = 0x0509 }
                }
            }
        }
        let Whole::Tree(words) = round_trip(&cells) else { panic!("a tree") };
        // 20 full layers collapse to whole nodes: far fewer words than cells.
        assert!(words < 12_000, "{words} words");
    }

    /// The box a node says its contents fill, in cells from the sector's corner: (low, high), high exclusive.
    fn said(tree: &[u32], node: usize, size: usize) -> ([usize; 3], [usize; 3]) {
        let (info, child) = (tree[node + 3], tree[node + 2]);
        let (bits, unit, lo, hi) = if size == 4 { (2, 1, info >> 16, info >> 22) } else { (4, size / 16, info >> 16, child >> 20) };
        let at = |v: u32, a: usize| ((v >> (bits * a)) & ((1 << bits) - 1)) as usize;
        ([0, 1, 2].map(|a| at(lo, a) * unit), [0, 1, 2].map(|a| (at(hi, a) + 1) * unit))
    }

    #[test]
    fn every_node_says_how_much_of_itself_it_fills() {
        let mut cells = vec![0 as Kind; CELLS];
        // A floor, a wall, a post and a few stray cells.
        for i in 0..CELLS {
            let (x, z, y) = (i % SIDE, (i / SIDE) % SIDE, i / (SIDE * SIDE));
            if y == 9 || (x == 41 && y < 30) || (x == 7 && z == 50) || crate::hash::hash3(x as i32, y as i32, z as i32, 4) % 997 == 0 { cells[i] = 3 }
        }
        let mut tree = Vec::new();
        assert!(matches!(encode(&cells, &mut tree), Whole::Tree(_)));
        // Walk every node; its box must hold all its cells and touch one on each side.
        fn walk(tree: &[u32], cells: &[Kind], node: usize, size: usize, o: [usize; 3], seen: &mut usize) {
            let mask = tree[node] as u64 | (tree[node + 1] as u64) << 32;
            let (lo, hi) = said(tree, node, size);
            let unit = if size == 64 { 4 } else { 1 };
            let (mut real_lo, mut real_hi) = ([usize::MAX; 3], [0usize; 3]);
            for y in 0..size { for z in 0..size { for x in 0..size {
                if cells[at(o[0] + x, o[1] + y, o[2] + z)] == 0 { continue }
                for (a, v) in [x, y, z].into_iter().enumerate() { real_lo[a] = real_lo[a].min(v / unit * unit); real_hi[a] = real_hi[a].max(v / unit * unit + unit) }
            } } }
            assert_eq!((lo, hi), (real_lo, real_hi), "node of {size} at {o:?}");
            *seen += 1;
            if tree[node + 3] & UNIFORM != 0 || size == 4 { return }
            let child = (tree[node + 2] & CHILD) as usize;
            let mut k = 0;
            for c in 0..64usize {
                if mask & (1 << c) == 0 { continue }
                let part = size / 4;
                walk(tree, cells, child + 4 * k, part, [o[0] + (c & 3) * part, o[1] + (c >> 4) * part, o[2] + ((c >> 2) & 3) * part], seen);
                k += 1;
            }
        }
        let mut seen = 0;
        walk(&tree, &cells, 0, SIDE, [0; 3], &mut seen);
        assert!(seen > 500, "{seen} nodes");
    }

    #[test]
    fn noise_survives() {
        for seed in 0..4 {
            let cells: Vec<Kind> = (0..CELLS).map(|i| { let h = hash3(i as i32, seed, 3, 9); if h % 3 == 0 { 0 } else { (h >> 8) as Kind % 5 + 1 } }).collect();
            assert!(matches!(round_trip(&cells), Whole::Tree(_)));
        }
    }

    /// A wall of the world's cells with a thing of quarter cells and a thing of eighth cells before it and a notch a
    /// quarter cell wide cut in it: every fine cell reads back, the world's cells round them are as they were, a cell
    /// of quarter cells alone is written 4 a side, and the tree says how big it is.
    #[test]
    fn finer_cells_survive() {
        use crate::scratch::{Run, Scratch};
        let mut s = Scratch::new();
        s.finer = true;
        s.start(0, 0, 0, 0);
        for y in 0..40 { for z in 0..64 { s.cells[at(30, y, z)] = 0x0509; } }
        // What is wanted, in eighth cells.
        let mut want = std::collections::HashMap::new();
        let (mut quarters, mut eighths) = (Vec::new(), Vec::new());
        for i in 0..4000u32 {
            let h = hash3(i as i32, 7, 1, 3);
            let (x, y, z, kind) = (40 + (h % 50) as i32, 8 + ((h >> 8) % 90) as i32, 60 + ((h >> 16) % 70) as i32, 0x0300 + 8 + ((h >> 24) % 3) as Kind);
            quarters.push(Run { x0: x, x1: x + 1, y, z, kind });
            for d in 0..8 { want.insert((x * 2 + (d & 1), y * 2 + ((d >> 1) & 1), z * 2 + (d >> 2)), kind); }
        }
        // The notch: through the wall, one quarter cell high and wide.
        quarters.push(Run { x0: 118, x1: 126, y: 81, z: 9, kind: 0 });
        for x in 236..252 { for d in 0..4 { want.insert((x, 162 + (d & 1), 18 + (d >> 1)), 0); } }
        // Eighth cells, some among the quarter ones and some apart.
        for i in 0..4000u32 {
            let h = hash3(i as i32, 11, 2, 5);
            let (x, y, z, kind) = (150 + (h % 200) as i32, 16 + ((h >> 8) % 180) as i32, 200 + ((h >> 16) % 250) as i32, 0x0400 + 8 + ((h >> 24) % 3) as Kind);
            eighths.push(Run { x0: x, x1: x + 1, y, z, kind });
            want.insert((x, y, z), kind);
        }
        s.fine_runs(&quarters, 2);
        s.fine_runs(&eighths, 3);
        let mut tree = Vec::new();
        let Whole::Tree(words) = encode_fine(&s.cells, &s.fine_of, &s.fine, &mut tree) else { panic!("a tree") };
        assert_eq!(words, tree.len());
        for (&(x, y, z), &kind) in &want {
            assert_eq!(fine_at(&tree, x as usize, y as usize, z as usize), kind, "eighth cell {x} {y} {z}");
        }
        for y in 0..512usize { for z in (0..512usize).step_by(5) { for x in (0..512usize).step_by(7) {
            if want.contains_key(&(x as i32, y as i32, z as i32)) { continue }
            let wall = x / 8 == 30 && y / 8 < 40;
            assert_eq!(fine_at(&tree, x, y, z), if wall { 0x0509 } else { 0 }, "eighth cell {x} {y} {z}");
        } } }
        // The world's own cells read as they did, but for the mark on those that hold finer ones.
        assert_eq!(kind_at(&tree, 30, 5, 5), 0x0509);
        assert_eq!(kind_at(&tree, 30, 20, 2) & !crate::kinds::FINE, 0x0509);
        assert_ne!(kind_at(&tree, 30, 20, 2) & crate::kinds::FINE, 0);
        // A sector of quarter cells only has no block 8 a side: its tree is no bigger than it was when blocks were 4 a side.
        s.start(0, 0, 0, 0);
        s.fine_runs(&quarters, 2);
        let Whole::Tree(_) = encode_fine(&s.cells, &s.fine_of, &s.fine, &mut tree) else { panic!("a tree") };
        for (i, cell) in s.cells.iter().enumerate().filter(|c| c.1 & crate::kinds::FINE != 0) {
            let (x, y, z) = (i % 64, i / 4096, (i / 64) % 64);
            let _ = cell;
            // Read through the tree: the word for this cell has no top bit.
            let mut node = 0usize;
            for shift in [4, 2, 0] {
                let mask = tree[node] as u64 | (tree[node + 1] as u64) << 32;
                let c = ((x >> shift) & 3) + 4 * ((z >> shift) & 3) + 16 * ((y >> shift) & 3);
                if shift == 0 {
                    let (child, n) = (tree[node + 2] as usize, mask.count_ones() as usize);
                    assert_eq!(tree[child + n.div_ceil(2) + before(mask, c)] >> 31, 0, "cell {x} {y} {z} is 4 a side");
                } else {
                    node = (tree[node + 2] & CHILD) as usize + 4 * before(mask, c);
                }
            }
        }
    }

    /// Whether a tree is sound: every part of it lies inside it, no node's kind has the mark of finer cells, and every
    /// cell whose kind has it has a table, a pointer in it and a block that holds something. Returns how many cells
    /// have the mark.
    pub(crate) fn sound(tree: &[u32]) -> usize {
        fn walk(tree: &[u32], node: usize, size: usize, marked: &mut usize) {
            let mask = tree[node] as u64 | (tree[node + 1] as u64) << 32;
            let (info, n) = (tree[node + 3], mask.count_ones() as usize);
            assert_eq!(info as Kind & crate::kinds::FINE, 0, "a node's own kind has the mark");
            if info & UNIFORM != 0 {
                return;
            }
            if size > 4 {
                for k in 0..n {
                    walk(tree, (tree[node + 2] & CHILD) as usize + 4 * k, size / 4, marked);
                }
                return;
            }
            let child = tree[node + 2] as usize;
            let kinds: Vec<Kind> = (0..n).map(|i| (tree[child + i / 2] >> (16 * (i % 2))) as Kind).collect();
            for (i, _) in kinds.iter().enumerate().filter(|k| k.1 & crate::kinds::FINE != 0) {
                *marked += 1;
                let word = tree[child + n.div_ceil(2) + i];
                assert_ne!(word, 0, "a cell with the mark has no block");
                let (block, words) = ((word & !(1 << 31)) as usize, if word >> 31 != 0 { 16 } else { 2 });
                assert!(block >= child + n.div_ceil(2) + n, "a block before its leaf's table");
                let present: usize = (0..words).map(|w| tree[block + w].count_ones() as usize).sum();
                assert!(present > 0, "a block that holds nothing");
                if tree[block + words] & UNIFORM == 0 {
                    assert!(block + words + present.div_ceil(2) < tree.len(), "a block's kinds past the tree's end");
                }
            }
        }
        let mut marked = 0;
        walk(tree, 0, SIDE, &mut marked);
        marked
    }

    /// A kind that has the mark of finer cells in a sector with no blocks, or with a block that is another cell's or
    /// empty: the tree says a plain cell, so no reader looks for a table or a block that is not there.
    #[test]
    fn a_mark_is_written_only_with_its_block() {
        use crate::kinds::FINE;
        let mut cells = vec![0 as Kind; CELLS];
        cells[at(10, 5, 5)] = 0x0509 | FINE;
        cells[at(11, 5, 5)] = 0x0509;
        cells[at(40, 40, 40)] = 0x0303 | FINE;
        let mut tree = Vec::new();
        for (fine_of, fine) in [
            (std::collections::HashMap::new(), vec![]),
            (std::collections::HashMap::from([(at(10, 5, 5) as u32, 0u32), (at(40, 40, 40) as u32, 7)]), vec![[0 as Kind; 512]]),
            (std::collections::HashMap::from([(at(11, 5, 5) as u32, 0u32)]), vec![[0x0303 as Kind; 512]]),
        ] {
            assert!(matches!(encode_fine(&cells, &fine_of, &fine, &mut tree), Whole::Tree(_)));
            assert_eq!(sound(&tree), 0);
            assert_eq!(kind_at(&tree, 10, 5, 5), 0x0509);
            assert_eq!(kind_at(&tree, 40, 40, 40), 0x0303);
            assert_eq!(fine_at(&tree, 83, 43, 44), 0x0509);
            assert_eq!(fine_at(&tree, 91, 43, 44), 0x0509);
        }
        // A whole sector of such a kind is all one kind, without the mark.
        assert_eq!(encode(&vec![0x0509 | FINE; CELLS], &mut tree), Whole::Uniform(0x0509));
    }

    #[test]
    fn one_cell_and_all_but_one() {
        let mut cells = vec![0 as Kind; CELLS];
        cells[at(63, 0, 17)] = 0xffbf;
        assert_eq!(round_trip(&cells), Whole::Tree(4 + 4 + 4 + 1));
        let mut cells = vec![2 as Kind; CELLS];
        cells[at(5, 60, 9)] = 0;
        assert!(matches!(round_trip(&cells), Whole::Tree(_)));
    }
}
