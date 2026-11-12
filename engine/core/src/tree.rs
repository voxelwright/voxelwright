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
    assert_eq!(cells.len(), CELLS);
    out.clear();
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
                    let k = cells[at(lx * 4 + (c & 3), ly * 4 + (c >> 4), lz * 4 + ((c >> 2) & 3))];
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
                let uniform = n == 64 && kinds.iter().all(|&k| k == kinds[0]);
                leaves[lx + 16 * (lz + 16 * ly)] = Leaf { mask, kind: if uniform { kinds[0] } else { most(&kinds[..n]) }, uniform, lo, hi };
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
            for cell in 0..64usize {
                if leaf.mask & (1 << cell) == 0 {
                    continue;
                }
                let k = cells[at(lx * 4 + (cell & 3), ly * 4 + (cell >> 4), lz * 4 + ((cell >> 2) & 3))] as u32;
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
            next_kinds = 4 + 4 * mid_count + 4 * leaf_count + kinds_out.len();
        }
    }
    out.extend_from_slice(&kinds_out);
    Whole::Tree(out.len())
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
mod tests {
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

    #[test]
    fn one_cell_and_all_but_one() {
        let mut cells = vec![0 as Kind; CELLS];
        cells[at(63, 0, 17)] = 0xffff;
        assert_eq!(round_trip(&cells), Whole::Tree(4 + 4 + 4 + 1));
        let mut cells = vec![2 as Kind; CELLS];
        cells[at(5, 60, 9)] = 0;
        assert!(matches!(round_trip(&cells), Whole::Tree(_)));
    }
}
