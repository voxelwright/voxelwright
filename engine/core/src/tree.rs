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

const TAG_MULTI: u32 = 0;
const TAG_MONO: u32 = 1 << 28;
const TAG_FINE: u32 = 2 << 28;
const TAG_MASK: u32 = 3 << 28;

/// Compact 16-byte leaf summary kept in `TREE_SCRATCH.leaves` (4096 × 16 B = 64 KiB).
#[derive(Clone, Copy, Default)]
struct Leaf {
    mask: u64,
    /// `TAG_MULTI`: offset in `kinds_out`; `TAG_MONO`: slot index in `mono_table`; uniform/fine: 0.
    kinds_off: u32,
    /// Low 16 bits: `kind`; bits 16..28: packed 2-bit `lo`/`hi` bounds; bits 28..30: internal tag; bit 31: `UNIFORM`.
    word3: u32,
}

#[inline]
fn pack_leaf_word3(kind: Kind, lo: [u8; 3], hi: [u8; 3], tag_or_uniform: u32) -> u32 {
    let bounds = (lo[0] as u32)
        | ((lo[1] as u32) << 2)
        | ((lo[2] as u32) << 4)
        | ((hi[0] as u32) << 6)
        | ((hi[1] as u32) << 8)
        | ((hi[2] as u32) << 10);
    (kind as u32) | (bounds << 16) | tag_or_uniform
}

#[derive(Clone, Copy, Default)]
struct Mid {
    mask: u64,
    kind: Kind,
    uniform: bool,
    /// The box round what it holds: the first and last cell along x, y, z (for the root, the first and last leaf).
    lo: [u8; 3],
    hi: [u8; 3],
}

const LEAF_TABLE_SIZE: usize = 8192; // >= 2 * 4096 max leaves per sector
const MONO_TABLE_SIZE: usize = 8192; // >= 2 * 4096 max distinct mono kinds per sector
const MID_TABLE_SIZE: usize = 256; // >= 4 * 64 max mids per sector

#[derive(Clone, Copy, Default)]
struct DedupSlot {
    stamp: u32,
    hash: u32,
    offset: u32,
    len: u16,
}

#[derive(Clone, Copy, Default)]
struct MonoSlot {
    stamp: u32,
    offset: u32,
    kind: Kind,
    max_n: u16,
}

#[inline]
fn hash_words(words: &[u32]) -> u32 {
    let mut h = (words.len() as u32).wrapping_mul(0x9e37_79b1);
    for &w in words {
        h = (h.rotate_left(5) ^ w).wrapping_mul(0x27d4_eb2d);
    }
    h ^= h >> 15;
    h = h.wrapping_mul(0x85eb_ca6b);
    h ^= h >> 13;
    h
}

#[inline]
fn next_stamp_dedup(stamp: &mut u32, table: &mut [DedupSlot]) -> u32 {
    *stamp = stamp.wrapping_add(1);
    if *stamp == 0 {
        for s in table.iter_mut() {
            s.stamp = 0;
        }
        *stamp = 1;
    }
    *stamp
}

#[inline]
fn next_stamp_mono(stamp: &mut u32, table: &mut [MonoSlot]) -> u32 {
    *stamp = stamp.wrapping_add(1);
    if *stamp == 0 {
        for s in table.iter_mut() {
            s.stamp = 0;
        }
        *stamp = 1;
    }
    *stamp
}

#[inline]
fn pack_kinds(kinds: &[Kind], out: &mut [u32; 32]) -> usize {
    let mut w = 0usize;
    let mut i = 0usize;
    while i + 1 < kinds.len() {
        out[w] = (kinds[i] as u32) | ((kinds[i + 1] as u32) << 16);
        w += 1;
        i += 2;
    }
    if i < kinds.len() {
        out[w] = kinds[i] as u32;
        w += 1;
    }
    w
}

/// Inserts or finds an exact word slice in `storage` via a generation-stamped open-addressing table.
#[inline]
fn dedup_slice(table: &mut [DedupSlot], stamp: u32, storage: &mut Vec<u32>, words: &[u32]) -> u32 {
    let mask = table.len() - 1;
    let h = hash_words(words);
    let len = words.len() as u16;
    let mut idx = (h as usize) & mask;
    loop {
        let slot = table[idx];
        if slot.stamp != stamp {
            let off = storage.len() as u32;
            storage.extend_from_slice(words);
            table[idx] = DedupSlot { stamp, hash: h, offset: off, len };
            return off;
        }
        if slot.hash == h && slot.len == len {
            let off = slot.offset as usize;
            if &storage[off..off + words.len()] == words {
                return slot.offset;
            }
        }
        idx = (idx + 1) & mask;
    }
}

/// Records a mono-kind non-uniform leaf (`n` copies of `kind`) and returns its slot index in `table`.
#[inline]
fn record_mono(table: &mut [MonoSlot], stamp: u32, list: &mut Vec<u16>, kind: Kind, n: u16) -> u32 {
    let mask = table.len() - 1;
    let mut idx = ((kind as u32).wrapping_mul(0x9e37_79b1) >> 19) as usize & mask;
    loop {
        let slot = &mut table[idx];
        if slot.stamp != stamp {
            *slot = MonoSlot { stamp, offset: 0, kind, max_n: n };
            list.push(idx as u16);
            return idx as u32;
        }
        if slot.kind == kind {
            if n > slot.max_n {
                slot.max_n = n;
            }
            return idx as u32;
        }
        idx = (idx + 1) & mask;
    }
}

/// The kind most of `kinds` are (the first such, so the answer does not depend on anything but the cells).
#[inline]
fn most(kinds: &[Kind]) -> Kind {
    debug_assert!(kinds.len() <= 64);
    let mut uniq = [(0 as Kind, 0u8); 64];
    let mut ulen = 0usize;
    for &k in kinds {
        let mut found = false;
        for slot in &mut uniq[..ulen] {
            if slot.0 == k {
                slot.1 += 1;
                found = true;
                break;
            }
        }
        if !found {
            uniq[ulen] = (k, 1);
            ulen += 1;
        }
    }
    let (mut best, mut best_n) = (0, 0u8);
    for &(k, cnt) in &uniq[..ulen] {
        if cnt > best_n {
            best = k;
            best_n = cnt;
        }
    }
    best
}

/// Computes the inclusive `[lo, hi]` 0..=3 bounding box of set bits in a 4x4x4 node mask (`c = x + 4*z + 16*y`) in O(1).
#[inline]
fn bounds_from_mask(mask: u64) -> ([u8; 3], [u8; 3]) {
    debug_assert_ne!(mask, 0);
    let lo_y = (mask.trailing_zeros() >> 4) as u8;
    let hi_y = ((63 - mask.leading_zeros()) >> 4) as u8;
    let mz = (mask | (mask >> 16) | (mask >> 32) | (mask >> 48)) as u16;
    let lo_z = (mz.trailing_zeros() >> 2) as u8;
    let hi_z = ((15 - mz.leading_zeros()) >> 2) as u8;
    let mx = ((mz | (mz >> 4) | (mz >> 8) | (mz >> 12)) & 0xF) as u8;
    let lo_x = mx.trailing_zeros() as u8;
    let hi_x = (7 - mx.leading_zeros()) as u8;
    ([lo_x, lo_y, lo_z], [hi_x, hi_y, hi_z])
}

#[inline]
fn row4_le(cells: &[Kind], base: usize) -> u64 {
    #[cfg(target_endian = "little")]
    {
        debug_assert!(base + 4 <= cells.len());
        // SAFETY: `base + 4 <= cells.len()` gives 8 valid bytes for an unaligned u64 read.
        unsafe { (cells.as_ptr().add(base) as *const u64).read_unaligned() }
    }
    #[cfg(not(target_endian = "little"))]
    {
        (cells[base] as u64)
            | ((cells[base + 1] as u64) << 16)
            | ((cells[base + 2] as u64) << 32)
            | ((cells[base + 3] as u64) << 48)
    }
}

struct TreeScratch {
    leaves: Vec<Leaf>,
    leaf_nodes_out: Vec<u32>,
    kinds_out: Vec<u32>,
    blocks_out: Vec<u32>,
    pointers: Vec<usize>,
    leaf_table: Vec<DedupSlot>,
    leaf_stamp: u32,
    mono_table: Vec<MonoSlot>,
    mono_list: Vec<u16>,
    mono_stamp: u32,
    mid_table: Vec<DedupSlot>,
    mid_stamp: u32,
}

thread_local! {
    static TREE_SCRATCH: std::cell::RefCell<TreeScratch> = std::cell::RefCell::new(TreeScratch {
        leaves: vec![Leaf::default(); 4096],
        leaf_nodes_out: Vec::new(),
        kinds_out: Vec::new(),
        blocks_out: Vec::new(),
        pointers: Vec::new(),
        leaf_table: vec![DedupSlot::default(); LEAF_TABLE_SIZE],
        leaf_stamp: 0,
        mono_table: vec![MonoSlot::default(); MONO_TABLE_SIZE],
        mono_list: Vec::new(),
        mono_stamp: 0,
        mid_table: vec![DedupSlot::default(); MID_TABLE_SIZE],
        mid_stamp: 0,
    });
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
///
/// Identical non-uniform leaf payloads (exact multi-kind word slices and shared mono-kind runs) and identical
/// non-uniform mid leaf-node arrays are deduplicated within the sector (intra-sector SVDAG, #165) while keeping the
/// exact same binary format and reader semantics. `FINE` leaves keep dedicated payloads and block pointer tables.
pub fn encode_fine(cells: &[Kind], fine_of: &std::collections::HashMap<u32, u32>, fine: &[[Kind; 512]], out: &mut Vec<u32>) -> Whole {
    let fine_mark = crate::kinds::FINE;
    assert_eq!(cells.len(), CELLS);
    out.clear();
    TREE_SCRATCH.with_borrow_mut(|scratch| {
        let TreeScratch {
            leaves,
            leaf_nodes_out,
            kinds_out,
            blocks_out,
            pointers,
            leaf_table,
            leaf_stamp,
            mono_table,
            mono_list,
            mono_stamp,
            mid_table,
            mid_stamp,
        } = scratch;
        kinds_out.clear();
        mono_list.clear();
        let cur_leaf_stamp = next_stamp_dedup(leaf_stamp, leaf_table);
        let cur_mono_stamp = next_stamp_mono(mono_stamp, mono_table);
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
        let mut any = false;
        let plain_fast = fine_of.is_empty();
        if plain_fast {
            let clear_fine4 = !((fine_mark as u64) * 0x0001_0001_0001_0001u64);
            for ly in 0..16usize {
                let y_base = (ly * 4) * (SIDE * SIDE);
                for lz in 0..16usize {
                    let yz_base = y_base + (lz * 4) * SIDE;
                    let leaf_row = 16 * (lz + 16 * ly);
                    for lx in 0..16usize {
                        let base0 = yz_base + lx * 4;
                        let mut rows = [0u64; 16];
                        let mut any_bits = 0u64;
                        for dy in 0..4usize {
                            let by = base0 + dy * (SIDE * SIDE);
                            let r0 = row4_le(cells, by) & clear_fine4;
                            let r1 = row4_le(cells, by + SIDE) & clear_fine4;
                            let r2 = row4_le(cells, by + 2 * SIDE) & clear_fine4;
                            let r3 = row4_le(cells, by + 3 * SIDE) & clear_fine4;
                            rows[dy * 4] = r0;
                            rows[dy * 4 + 1] = r1;
                            rows[dy * 4 + 2] = r2;
                            rows[dy * 4 + 3] = r3;
                            any_bits |= r0 | r1 | r2 | r3;
                        }
                        if any_bits == 0 {
                            leaves[leaf_row + lx] = Leaf::default();
                            continue;
                        }
                        any = true;
                        let first = rows[0] as Kind;
                        if first != 0 {
                            let rep = (first as u64) * 0x0001_0001_0001_0001u64;
                            let mut diff = 0u64;
                            for &r in &rows {
                                diff |= r ^ rep;
                            }
                            if diff == 0 {
                                leaves[leaf_row + lx] = Leaf {
                                    mask: u64::MAX,
                                    kinds_off: 0,
                                    word3: pack_leaf_word3(first, [0, 0, 0], [3, 3, 3], UNIFORM),
                                };
                                continue;
                            }
                        }
                        let mut mask = 0u64;
                        let mut kinds = [0 as Kind; 64];
                        let mut n = 0usize;
                        for (ri, &r) in rows.iter().enumerate() {
                            if r == 0 {
                                continue;
                            }
                            let c0 = ri * 4;
                            let k0 = r as Kind;
                            if k0 != 0 { mask |= 1u64 << c0; kinds[n] = k0; n += 1; }
                            let k1 = (r >> 16) as Kind;
                            if k1 != 0 { mask |= 1u64 << (c0 + 1); kinds[n] = k1; n += 1; }
                            let k2 = (r >> 32) as Kind;
                            if k2 != 0 { mask |= 1u64 << (c0 + 2); kinds[n] = k2; n += 1; }
                            let k3 = (r >> 48) as Kind;
                            if k3 != 0 { mask |= 1u64 << (c0 + 3); kinds[n] = k3; n += 1; }
                        }
                        let (lo, hi) = bounds_from_mask(mask);
                        let first_k = kinds[0];
                        if kinds[1..n].iter().all(|&k| k == first_k) {
                            let slot_idx = record_mono(mono_table, cur_mono_stamp, mono_list, first_k, n as u16);
                            leaves[leaf_row + lx] = Leaf {
                                mask,
                                kinds_off: slot_idx,
                                word3: pack_leaf_word3(first_k, lo, hi, TAG_MONO),
                            };
                        } else {
                            let mut packed = [0u32; 32];
                            let w = pack_kinds(&kinds[..n], &mut packed);
                            let off = dedup_slice(leaf_table, cur_leaf_stamp, kinds_out, &packed[..w]);
                            leaves[leaf_row + lx] = Leaf {
                                mask,
                                kinds_off: off,
                                word3: pack_leaf_word3(most(&kinds[..n]), lo, hi, TAG_MULTI),
                            };
                        }
                    }
                }
            }
        } else {
            for ly in 0..16usize {
                for lz in 0..16usize {
                    for lx in 0..16usize {
                        let mut mask = 0u64;
                        let mut kinds = [0 as Kind; 64];
                        let mut n = 0;
                        let mut any_fine = false;
                        for c in 0..64usize {
                            let k = kind_of(at(lx * 4 + (c & 3), ly * 4 + (c >> 4), lz * 4 + ((c >> 2) & 3)));
                            if k != 0 {
                                mask |= 1 << c;
                                kinds[n] = k;
                                n += 1;
                                any_fine |= k & fine_mark != 0;
                            }
                        }
                        let idx = lx + 16 * (lz + 16 * ly);
                        if n == 0 {
                            leaves[idx] = Leaf::default();
                            continue;
                        }
                        any = true;
                        let (lo, hi) = bounds_from_mask(mask);
                        let first_k = kinds[0];
                        let all_same = kinds[1..n].iter().all(|&k| k == first_k);
                        if n == 64 && all_same && !any_fine {
                            leaves[idx] = Leaf { mask, kinds_off: 0, word3: pack_leaf_word3(first_k, lo, hi, UNIFORM) };
                        } else if any_fine {
                            leaves[idx] = Leaf { mask, kinds_off: 0, word3: pack_leaf_word3(most(&kinds[..n]) & !fine_mark, lo, hi, TAG_FINE) };
                        } else if all_same {
                            let slot_idx = record_mono(mono_table, cur_mono_stamp, mono_list, first_k, n as u16);
                            leaves[idx] = Leaf { mask, kinds_off: slot_idx, word3: pack_leaf_word3(first_k, lo, hi, TAG_MONO) };
                        } else {
                            let mut packed = [0u32; 32];
                            let w = pack_kinds(&kinds[..n], &mut packed);
                            let off = dedup_slice(leaf_table, cur_leaf_stamp, kinds_out, &packed[..w]);
                            leaves[idx] = Leaf { mask, kinds_off: off, word3: pack_leaf_word3(most(&kinds[..n]), lo, hi, TAG_MULTI) };
                        }
                    }
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
        let mut mids = [Mid::default(); 64];
        for (mid, slot) in mids.iter_mut().enumerate() {
            let mut mask = 0u64;
            let mut kinds = [0 as Kind; 64];
            let mut n = 0;
            let mut uniform = true;
            let (mut lo, mut hi) = ([15u8; 3], [0u8; 3]);
            let (mx, mz, my) = ((mid & 3) * 4, ((mid >> 2) & 3) * 4, (mid >> 4) * 4);
            for c in 0..64usize {
                let (cx, cz, cy) = (c & 3, (c >> 2) & 3, c >> 4);
                let leaf = leaves[(mx + cx) + 16 * ((mz + cz) + 16 * (my + cy))];
                if leaf.mask != 0 {
                    mask |= 1 << c;
                    kinds[n] = leaf.word3 as Kind;
                    n += 1;
                    let (vx, vy, vz) = (cx as u8 * 4, cy as u8 * 4, cz as u8 * 4);
                    let b = leaf.word3 >> 16;
                    lo[0] = lo[0].min(vx + (b & 3) as u8);
                    lo[1] = lo[1].min(vy + ((b >> 2) & 3) as u8);
                    lo[2] = lo[2].min(vz + ((b >> 4) & 3) as u8);
                    hi[0] = hi[0].max(vx + ((b >> 6) & 3) as u8);
                    hi[1] = hi[1].max(vy + ((b >> 8) & 3) as u8);
                    hi[2] = hi[2].max(vz + ((b >> 10) & 3) as u8);
                }
                uniform &= leaf.word3 & UNIFORM != 0;
            }
            if n > 0 {
                let uniform = uniform && n == 64 && kinds.iter().all(|&k| k == kinds[0]);
                *slot = Mid {
                    mask,
                    kind: if uniform { kinds[0] } else { most(&kinds[..n]) },
                    uniform,
                    lo,
                    hi,
                };
            }
        }
        // The root's box, in leaves.
        let (mut root_lo, mut root_hi) = ([15u8; 3], [0u8; 3]);
        let mut root_mask = 0u64;
        let mut root_kinds = [0 as Kind; 64];
        let mut root_n = 0usize;
        let mut root_uniform = true;
        for (i, mid) in mids.iter().enumerate() {
            if mid.mask == 0 {
                root_uniform = false;
                continue;
            }
            root_mask |= 1u64 << i;
            root_kinds[root_n] = mid.kind;
            root_n += 1;
            root_uniform &= mid.uniform && mid.kind == mids[0].kind;
            let (vx, vy, vz) = ((i & 3) as u8 * 4, (i >> 4) as u8 * 4, ((i >> 2) & 3) as u8 * 4);
            root_lo[0] = root_lo[0].min(vx + (mid.lo[0] >> 2));
            root_lo[1] = root_lo[1].min(vy + (mid.lo[1] >> 2));
            root_lo[2] = root_lo[2].min(vz + (mid.lo[2] >> 2));
            root_hi[0] = root_hi[0].max(vx + (mid.hi[0] >> 2));
            root_hi[1] = root_hi[1].max(vy + (mid.hi[1] >> 2));
            root_hi[2] = root_hi[2].max(vz + (mid.hi[2] >> 2));
        }
        if root_mask == u64::MAX && root_uniform {
            return Whole::Uniform(mids[0].kind);
        }
        // Emit one shared payload run for each mono-kind seen across non-uniform leaves.
        for &slot_idx in mono_list.iter() {
            let slot = &mut mono_table[slot_idx as usize];
            slot.offset = kinds_out.len() as u32;
            let pair = (slot.kind as u32) | ((slot.kind as u32) << 16);
            for _ in 0..(slot.max_n >> 1) {
                kinds_out.push(pair);
            }
            if slot.max_n & 1 != 0 {
                kinds_out.push(slot.kind as u32);
            }
        }
        // Laid out as: the root, the mids present, unique leaf-node arrays, deduplicated kinds payloads, then fine blocks.
        let mid_count = root_n;
        let leaves_base = 4 + 4 * mid_count;
        let node = |out: &mut Vec<u32>, mask: u64, child: usize, n: &Mid| {
            assert!(child as u32 <= CHILD);
            let (lo, hi) = (n.lo.map(|v| v as u32), n.hi.map(|v| v as u32));
            let flag = if n.uniform { UNIFORM } else { 0 };
            let (low, high) = (lo[0] | lo[1] << 4 | lo[2] << 8, hi[0] | hi[1] << 4 | hi[2] << 8);
            out.extend_from_slice(&[mask as u32, (mask >> 32) as u32, child as u32 | high << 20, n.kind as u32 | low << 16 | flag]);
        };
        out.reserve(leaves_base);
        node(
            out,
            root_mask,
            4,
            &Mid { mask: root_mask, kind: most(&root_kinds[..root_n]), uniform: false, lo: root_lo, hi: root_hi },
        );
        leaf_nodes_out.clear();
        blocks_out.clear();
        pointers.clear();
        let cur_mid_stamp = next_stamp_dedup(mid_stamp, mid_table);
        let mut mid_leaves = [0u32; 256];
        for (m, mid) in mids.iter().enumerate() {
            if mid.mask == 0 {
                continue;
            }
            if mid.uniform {
                node(out, mid.mask, 0, mid);
                continue;
            }
            let mut len = 0usize;
            let mut mid_has_fine = false;
            let mut mm = mid.mask;
            while mm != 0 {
                let c = mm.trailing_zeros() as usize;
                mm &= mm - 1;
                let i = leaf_of(m, c);
                let leaf = leaves[i];
                let rel_kinds_off = if leaf.word3 & UNIFORM != 0 {
                    0u32
                } else {
                    match leaf.word3 & TAG_MASK {
                        TAG_MONO => mono_table[leaf.kinds_off as usize].offset,
                        TAG_MULTI => leaf.kinds_off,
                        _ => {
                            mid_has_fine = true;
                            let off = kinds_out.len() as u32;
                            let (lx, lz, ly) = (i & 15, (i >> 4) & 15, i >> 8);
                            let (bx, by, bz) = (lx * 4, ly * 4, lz * 4);
                            let (mut word, mut half) = (0u32, 0u32);
                            let mut lm = leaf.mask;
                            while lm != 0 {
                                let cell = lm.trailing_zeros() as usize;
                                lm &= lm - 1;
                                let k = kind_of(at(bx + (cell & 3), by + (cell >> 4), bz + ((cell >> 2) & 3))) as u32;
                                word |= k << (16 * half);
                                half ^= 1;
                                if half == 0 {
                                    kinds_out.push(word);
                                    word = 0;
                                }
                            }
                            if half == 1 {
                                kinds_out.push(word);
                            }
                            let mut fm = leaf.mask;
                            while fm != 0 {
                                let cell = fm.trailing_zeros() as usize;
                                fm &= fm - 1;
                                let ci = at(bx + (cell & 3), by + (cell >> 4), bz + ((cell >> 2) & 3));
                                let Some(block) = block_of(ci) else {
                                    kinds_out.push(0);
                                    continue;
                                };
                                pointers.push(kinds_out.len());
                                let (coarse, began) = (alike_in_twos(block), blocks_out.len());
                                kinds_out.push(blocks_out.len() as u32 | if coarse { 0 } else { 1 << 31 });
                                let bcells: Vec<Kind> = if coarse {
                                    (0..64).map(|c| block[(c & 3) * 2 + 8 * ((c >> 2) & 3) * 2 + 64 * (c >> 4) * 2]).collect()
                                } else {
                                    block.to_vec()
                                };
                                for part in bcells.chunks(32) {
                                    blocks_out.push(part.iter().enumerate().fold(0u32, |m, (c, &k)| if k != 0 { m | 1 << c } else { m }));
                                }
                                let present: Vec<Kind> = bcells.iter().copied().filter(|&k| k != 0).collect();
                                if present.iter().all(|&k| k == present[0]) {
                                    blocks_out.push(present[0] as u32 | UNIFORM);
                                } else {
                                    blocks_out.push(0);
                                    blocks_out.extend(present.chunks(2).map(|p| p[0] as u32 | (*p.get(1).unwrap_or(&0) as u32) << 16));
                                }
                                debug_assert_eq!(blocks_out.len() - began, block_words(block));
                            }
                            off
                        }
                    }
                };
                mid_leaves[len] = leaf.mask as u32;
                mid_leaves[len + 1] = (leaf.mask >> 32) as u32;
                mid_leaves[len + 2] = rel_kinds_off;
                mid_leaves[len + 3] = leaf.word3 & !TAG_MASK;
                len += 4;
            }
            let rel_leaf_off = if mid_has_fine {
                let off = leaf_nodes_out.len();
                leaf_nodes_out.extend_from_slice(&mid_leaves[..len]);
                off
            } else {
                dedup_slice(mid_table, cur_mid_stamp, leaf_nodes_out, &mid_leaves[..len]) as usize
            };
            node(out, mid.mask, leaves_base + rel_leaf_off, mid);
        }
        debug_assert_eq!(out.len(), leaves_base);
        let header_words = (leaves_base + leaf_nodes_out.len()) as u32;
        for chunk in leaf_nodes_out.chunks_exact_mut(4) {
            if chunk[3] & UNIFORM == 0 {
                chunk[2] += header_words;
            }
        }
        let blocks_base = header_words + kinds_out.len() as u32;
        for &at in pointers.iter() {
            kinds_out[at] += blocks_base;
        }
        out.reserve(leaf_nodes_out.len() + kinds_out.len() + blocks_out.len());
        out.extend_from_slice(leaf_nodes_out);
        out.extend_from_slice(kinds_out);
        out.extend_from_slice(blocks_out);
        Whole::Tree(out.len())
    })
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

    #[test]
    fn bounds_from_mask_matches_naive_on_samples() {
        for seed in 0..64 {
            let mut m = 0u64;
            for bit in 0..64usize {
                if hash3(bit as i32, seed, 19, 7) % 11 == 0 {
                    m |= 1u64 << bit;
                }
            }
            if m == 0 {
                continue;
            }
            let (mut lo, mut hi) = ([3u8; 3], [0u8; 3]);
            for c in 0..64usize {
                if m & (1 << c) != 0 {
                    let coords = [(c & 3) as u8, (c >> 4) as u8, ((c >> 2) & 3) as u8];
                    for a in 0..3 {
                        lo[a] = lo[a].min(coords[a]);
                        hi[a] = hi[a].max(coords[a]);
                    }
                }
            }
            assert_eq!(bounds_from_mask(m), (lo, hi), "mask {m:#x}");
        }
    }

    /// Pre-SVDAG plain encoder (test baseline for bit-exact equivalence, compression ratio, and encode speed).
    fn encode_undeduplicated(cells: &[Kind], out: &mut Vec<u32>) -> Whole {
        thread_local! {
            static RAW_SCRATCH: std::cell::RefCell<(Vec<Mid>, Vec<u32>)> =
                std::cell::RefCell::new((vec![Mid::default(); 4096], Vec::new()));
        }
        let fine_mark = crate::kinds::FINE;
        let clear_fine4 = !((fine_mark as u64) * 0x0001_0001_0001_0001u64);
        out.clear();
        RAW_SCRATCH.with_borrow_mut(|(leaves, kinds_out)| {
        let mut any = false;
        for ly in 0..16usize {
            let y_base = (ly * 4) * (SIDE * SIDE);
            for lz in 0..16usize {
                let yz_base = y_base + (lz * 4) * SIDE;
                let leaf_row = 16 * (lz + 16 * ly);
                for lx in 0..16usize {
                    let base0 = yz_base + lx * 4;
                    let mut rows = [0u64; 16];
                    let mut any_bits = 0u64;
                    for dy in 0..4usize {
                        let by = base0 + dy * (SIDE * SIDE);
                        let r0 = row4_le(cells, by) & clear_fine4;
                        let r1 = row4_le(cells, by + SIDE) & clear_fine4;
                        let r2 = row4_le(cells, by + 2 * SIDE) & clear_fine4;
                        let r3 = row4_le(cells, by + 3 * SIDE) & clear_fine4;
                        rows[dy * 4] = r0;
                        rows[dy * 4 + 1] = r1;
                        rows[dy * 4 + 2] = r2;
                        rows[dy * 4 + 3] = r3;
                        any_bits |= r0 | r1 | r2 | r3;
                    }
                    if any_bits == 0 {
                        leaves[leaf_row + lx] = Mid::default();
                        continue;
                    }
                    any = true;
                    let first = rows[0] as Kind;
                    if first != 0 {
                        let rep = (first as u64) * 0x0001_0001_0001_0001u64;
                        let mut diff = 0u64;
                        for &r in &rows {
                            diff |= r ^ rep;
                        }
                        if diff == 0 {
                            leaves[leaf_row + lx] = Mid {
                                mask: u64::MAX,
                                kind: first,
                                uniform: true,
                                lo: [0, 0, 0],
                                hi: [3, 3, 3],
                            };
                            continue;
                        }
                    }
                    let mut mask = 0u64;
                    let mut kinds = [0 as Kind; 64];
                    let mut n = 0usize;
                    for (ri, &r) in rows.iter().enumerate() {
                        if r == 0 {
                            continue;
                        }
                        let c0 = ri * 4;
                        let k0 = r as Kind;
                        if k0 != 0 { mask |= 1u64 << c0; kinds[n] = k0; n += 1; }
                        let k1 = (r >> 16) as Kind;
                        if k1 != 0 { mask |= 1u64 << (c0 + 1); kinds[n] = k1; n += 1; }
                        let k2 = (r >> 32) as Kind;
                        if k2 != 0 { mask |= 1u64 << (c0 + 2); kinds[n] = k2; n += 1; }
                        let k3 = (r >> 48) as Kind;
                        if k3 != 0 { mask |= 1u64 << (c0 + 3); kinds[n] = k3; n += 1; }
                    }
                    let (lo, hi) = bounds_from_mask(mask);
                    leaves[leaf_row + lx] = Mid { mask, kind: most(&kinds[..n]), uniform: false, lo, hi };
                }
            }
        }
        if !any {
            return Whole::Empty;
        }
        let leaf_of = |mid: usize, c: usize| {
            let (mx, mz, my) = (mid & 3, (mid >> 2) & 3, mid >> 4);
            (mx * 4 + (c & 3)) + 16 * ((mz * 4 + ((c >> 2) & 3)) + 16 * (my * 4 + (c >> 4)))
        };
        let mut mids = [Mid::default(); 64];
        for (mid, slot) in mids.iter_mut().enumerate() {
            let mut mask = 0u64;
            let mut kinds = [0 as Kind; 64];
            let mut n = 0;
            let mut uniform = true;
            let (mut lo, mut hi) = ([15u8; 3], [0u8; 3]);
            let (mx, mz, my) = ((mid & 3) * 4, ((mid >> 2) & 3) * 4, (mid >> 4) * 4);
            for c in 0..64usize {
                let (cx, cz, cy) = (c & 3, (c >> 2) & 3, c >> 4);
                let leaf = leaves[(mx + cx) + 16 * ((mz + cz) + 16 * (my + cy))];
                if leaf.mask != 0 {
                    mask |= 1 << c;
                    kinds[n] = leaf.kind;
                    n += 1;
                    let (vx, vy, vz) = (cx as u8 * 4, cy as u8 * 4, cz as u8 * 4);
                    lo[0] = lo[0].min(vx + leaf.lo[0]);
                    lo[1] = lo[1].min(vy + leaf.lo[1]);
                    lo[2] = lo[2].min(vz + leaf.lo[2]);
                    hi[0] = hi[0].max(vx + leaf.hi[0]);
                    hi[1] = hi[1].max(vy + leaf.hi[1]);
                    hi[2] = hi[2].max(vz + leaf.hi[2]);
                }
                uniform &= leaf.uniform;
            }
            if n > 0 {
                let uniform = uniform && n == 64 && kinds.iter().all(|&k| k == kinds[0]);
                *slot = Mid {
                    mask,
                    kind: if uniform { kinds[0] } else { most(&kinds[..n]) },
                    uniform,
                    lo,
                    hi,
                };
            }
        }
        let (mut root_lo, mut root_hi) = ([15u8; 3], [0u8; 3]);
        let mut root_mask = 0u64;
        let mut root_kinds = [0 as Kind; 64];
        let mut root_n = 0usize;
        let mut root_uniform = true;
        let mut leaf_count = 0usize;
        for (i, mid) in mids.iter().enumerate() {
            if mid.mask == 0 {
                root_uniform = false;
                continue;
            }
            root_mask |= 1u64 << i;
            root_kinds[root_n] = mid.kind;
            root_n += 1;
            root_uniform &= mid.uniform && mid.kind == mids[0].kind;
            if !mid.uniform {
                leaf_count += mid.mask.count_ones() as usize;
            }
            let (vx, vy, vz) = ((i & 3) as u8 * 4, (i >> 4) as u8 * 4, ((i >> 2) & 3) as u8 * 4);
            root_lo[0] = root_lo[0].min(vx + (mid.lo[0] >> 2));
            root_lo[1] = root_lo[1].min(vy + (mid.lo[1] >> 2));
            root_lo[2] = root_lo[2].min(vz + (mid.lo[2] >> 2));
            root_hi[0] = root_hi[0].max(vx + (mid.hi[0] >> 2));
            root_hi[1] = root_hi[1].max(vy + (mid.hi[1] >> 2));
            root_hi[2] = root_hi[2].max(vz + (mid.hi[2] >> 2));
        }
        if root_mask == u64::MAX && root_uniform {
            return Whole::Uniform(mids[0].kind);
        }
        let mid_count = root_n;
        let node = |out: &mut Vec<u32>, mask: u64, child: usize, n: &Mid, fine: bool| {
            let (lo, hi) = (n.lo.map(|v| v as u32), n.hi.map(|v| v as u32));
            let flag = if n.uniform { UNIFORM } else { 0 };
            if fine {
                let bounds = lo[0] | lo[1] << 2 | lo[2] << 4 | hi[0] << 6 | hi[1] << 8 | hi[2] << 10;
                out.extend_from_slice(&[mask as u32, (mask >> 32) as u32, child as u32, n.kind as u32 | bounds << 16 | flag]);
            } else {
                let (low, high) = (lo[0] | lo[1] << 4 | lo[2] << 8, hi[0] | hi[1] << 4 | hi[2] << 8);
                out.extend_from_slice(&[mask as u32, (mask >> 32) as u32, child as u32 | high << 20, n.kind as u32 | low << 16 | flag]);
            }
        };
        let header_words = 4 + 4 * mid_count + 4 * leaf_count;
        out.reserve(header_words);
        node(out, root_mask, 4, &Mid { mask: root_mask, kind: most(&root_kinds[..root_n]), uniform: false, lo: root_lo, hi: root_hi }, false);
        let mut next_leaf = 4 + 4 * mid_count;
        for mid in mids.iter().filter(|m| m.mask != 0) {
            node(out, mid.mask, if mid.uniform { 0 } else { next_leaf }, mid, false);
            if !mid.uniform {
                next_leaf += 4 * mid.mask.count_ones() as usize;
            }
        }
        let mut next_kinds = header_words;
        kinds_out.clear();
        for (m, mid) in mids.iter().enumerate() {
            if mid.mask == 0 || mid.uniform {
                continue;
            }
            let mut mm = mid.mask;
            while mm != 0 {
                let c = mm.trailing_zeros() as usize;
                mm &= mm - 1;
                let i = leaf_of(m, c);
                let leaf = leaves[i];
                node(out, leaf.mask, if leaf.uniform { 0 } else { next_kinds }, &leaf, true);
                if leaf.uniform {
                    continue;
                }
                let (lx, lz, ly) = (i & 15, (i >> 4) & 15, i >> 8);
                let (bx, by, bz) = (lx * 4, ly * 4, lz * 4);
                let (mut word, mut half) = (0u32, 0u32);
                let mut lm = leaf.mask;
                while lm != 0 {
                    let cell = lm.trailing_zeros() as usize;
                    lm &= lm - 1;
                    let k = (cells[at(bx + (cell & 3), by + (cell >> 4), bz + ((cell >> 2) & 3))] & !fine_mark) as u32;
                    word |= k << (16 * half);
                    half ^= 1;
                    if half == 0 {
                        kinds_out.push(word);
                        word = 0;
                    }
                }
                if half == 1 {
                    kinds_out.push(word);
                }
                next_kinds = header_words + kinds_out.len();
            }
        }
        out.extend_from_slice(&kinds_out);
        Whole::Tree(out.len())
        })
    }

    fn verify_all_cells_and_bounds(cells: &[Kind], tree: &[u32]) {
        assert_eq!(sound(tree), 0);
        let mut back = vec![0 as Kind; CELLS];
        decode(tree, &mut back);
        assert!(back == cells, "decode differs from source cells");
        for y in 0..SIDE {
            for z in 0..SIDE {
                for x in 0..SIDE {
                    assert_eq!(kind_at(tree, x, y, z), cells[at(x, y, z)], "kind_at mismatch at ({x},{y},{z})");
                }
            }
        }
        fn check_boxes(tree: &[u32], cells: &[Kind], node: usize, size: usize, o: [usize; 3]) {
            let mask = tree[node] as u64 | (tree[node + 1] as u64) << 32;
            let (lo, hi) = said(tree, node, size);
            let unit = if size == 64 { 4 } else { 1 };
            let (mut real_lo, mut real_hi) = ([usize::MAX; 3], [0usize; 3]);
            for y in 0..size {
                for z in 0..size {
                    for x in 0..size {
                        if cells[at(o[0] + x, o[1] + y, o[2] + z)] == 0 {
                            continue;
                        }
                        for (a, v) in [x, y, z].into_iter().enumerate() {
                            real_lo[a] = real_lo[a].min(v / unit * unit);
                            real_hi[a] = real_hi[a].max(v / unit * unit + unit);
                        }
                    }
                }
            }
            assert_eq!((lo, hi), (real_lo, real_hi), "tight AABB mismatch at size {size} origin {o:?}");
            if tree[node + 3] & UNIFORM != 0 || size == 4 {
                return;
            }
            let child = (tree[node + 2] & CHILD) as usize;
            assert!(child <= CHILD as usize);
            let mut k = 0;
            for c in 0..64usize {
                if mask & (1 << c) == 0 {
                    continue;
                }
                let part = size / 4;
                check_boxes(
                    tree,
                    cells,
                    child + 4 * k,
                    part,
                    [o[0] + (c & 3) * part, o[1] + (c >> 4) * part, o[2] + ((c >> 2) & 3) * part],
                );
                k += 1;
            }
        }
        check_boxes(tree, cells, 0, SIDE, [0; 3]);
    }

    #[test]
    fn svdag_round_trip_synthetic_patterns() {
        let (mut tree, mut raw) = (Vec::new(), Vec::new());

        // 1. Repeated brick wall with alternating courses and mortar joints (multi-kind leaves + repeated mids).
        let mut wall = vec![0 as Kind; CELLS];
        for y in 0..56 {
            for x in 0..SIDE {
                for z in 12..14 {
                    let is_window = (y % 16 >= 5 && y % 16 <= 11) && (x % 16 >= 4 && x % 16 <= 10);
                    if is_window {
                        continue;
                    }
                    let k = if y % 4 == 0 { 0x0207 } else if ((x + (y / 4) * 2) / 4) % 2 == 0 { 0x0508 } else { 0x0608 };
                    wall[at(x, y, z)] = k;
                }
            }
        }
        let Whole::Tree(w_dedup) = encode(&wall, &mut tree) else { panic!("brick wall tree") };
        let Whole::Tree(w_raw) = encode_undeduplicated(&wall, &mut raw) else { panic!("brick wall raw") };
        verify_all_cells_and_bounds(&wall, &tree);
        assert!(w_dedup * 3 < w_raw, "brick wall should compress >3x: dedup={w_dedup}, raw={w_raw}");

        // 2. Full 3D checkerboard (every leaf identical multi-kind, every mid identical).
        let mut checker = vec![0 as Kind; CELLS];
        for y in 0..SIDE {
            for z in 0..SIDE {
                for x in 0..SIDE {
                    checker[at(x, y, z)] = if (x ^ y ^ z) & 1 == 0 { 0x0107 } else { 0x0208 };
                }
            }
        }
        let Whole::Tree(c_dedup) = encode(&checker, &mut tree) else { panic!("checker tree") };
        let Whole::Tree(c_raw) = encode_undeduplicated(&checker, &mut raw) else { panic!("checker raw") };
        verify_all_cells_and_bounds(&checker, &tree);
        // 1 root (4) + 64 mids (256) + 1 shared leaf array of 64 leaves (256) + 1 shared 32-word payload = 548 words!
        assert_eq!(c_dedup, 4 + 64 * 4 + 64 * 4 + 32, "checkerboard should collapse to 1 leaf array & 1 payload");
        assert!(c_dedup * 200 < c_raw, "checkerboard compression: dedup={c_dedup}, raw={c_raw}");

        // 3. Layered slabs + mono-kind partial leaves with odd and even popcounts (1, 3, 7, 16, 31, 48).
        let mut slabs = vec![0 as Kind; CELLS];
        for y in 0..SIDE {
            for z in 0..SIDE {
                for x in 0..SIDE {
                    if y == 0 || y == 1 || y == 2 {
                        slabs[at(x, y, z)] = 0x0106; // 3-cell thick asphalt slab
                    } else if y == 16 || y == 17 {
                        slabs[at(x, y, z)] = 0x0307; // 2-cell thick concrete slab
                    } else if y == 33 {
                        slabs[at(x, y, z)] = 0x0409; // 1-cell thick plaster slab
                    }
                }
            }
        }
        // Add isolated mono-kind leaves of odd popcounts (1, 3, 7, 31) using the same kinds.
        slabs[at(0, 48, 0)] = 0x0409; // n = 1
        for dx in 0..3 { slabs[at(4 + dx, 48, 0)] = 0x0409; } // n = 3
        for dx in 0..7 { slabs[at(8 + (dx & 3), 48 + (dx >> 2), 0)] = 0x0409; } // n = 7
        for i in 0..31 { slabs[at(16 + (i & 3), 48 + (i >> 4), (i >> 2) & 3)] = 0x0106; } // n = 31
        // Shifted mid subtree: identical leaf contents at different leaf slots in two mids.
        for dx in 0..4 {
            for dz in 0..4 {
                slabs[at(dx, 56, dz)] = if (dx + dz) & 1 == 0 { 0x070a } else { 0x080a };
                slabs[at(20 + dx, 56, 4 + dz)] = if (dx + dz) & 1 == 0 { 0x070a } else { 0x080a };
            }
        }
        let Whole::Tree(s_dedup) = encode(&slabs, &mut tree) else { panic!("slabs tree") };
        let Whole::Tree(s_raw) = encode_undeduplicated(&slabs, &mut raw) else { panic!("slabs raw") };
        verify_all_cells_and_bounds(&slabs, &tree);
        assert!(s_dedup * 4 < s_raw, "layered slabs compression: dedup={s_dedup}, raw={s_raw}");

        // 4. FINE sub-cell sector combined with repeated walls (verifies FINE leaves stay intact while plain leaves dedup).
        use crate::scratch::{Run, Scratch};
        let mut s = Scratch::new();
        s.finer = true;
        s.start(0, 0, 0, 0);
        for y in 0..48 {
            for z in 0..SIDE {
                s.cells[at(20, y, z)] = if y % 2 == 0 { 0x0508 } else { 0x0608 };
                s.cells[at(44, y, z)] = if y % 2 == 0 { 0x0508 } else { 0x0608 };
            }
        }
        let mut fine_runs = Vec::new();
        for x in 80..88 {
            for y in 16..24 {
                fine_runs.push(Run { x0: x, x1: x + 1, y, z: 40, kind: 0x030c });
            }
        }
        s.fine_runs(&fine_runs, 2);
        let Whole::Tree(f_words) = encode_fine(&s.cells, &s.fine_of, &s.fine, &mut tree) else { panic!("fine tree") };
        assert_eq!(f_words, tree.len());
        assert!(sound(&tree) > 0, "fine sector must preserve marked cells");
        for y in 0..SIDE {
            for z in 0..SIDE {
                for x in 0..SIDE {
                    assert_eq!(kind_at(&tree, x, y, z), s.cells[at(x, y, z)], "fine coarse cell ({x},{y},{z})");
                }
            }
        }
        for r in &fine_runs {
            for d in 0..8 {
                let (fx, fy, fz) = (r.x0 as usize * 2 + (d & 1), r.y as usize * 2 + ((d >> 1) & 1), r.z as usize * 2 + (d >> 2));
                assert_eq!(fine_at(&tree, fx, fy, fz), r.kind, "fine sub-cell ({fx},{fy},{fz})");
            }
        }
    }

    #[test]
    fn svdag_city_sectors_round_trip_and_compression() {
        use crate::scratch::Scratch;
        use std::time::Instant;

        let mut x = 0i32;
        while crate::city::ground(x, 4000) < 100 {
            x += 640;
        }
        let mut s = Scratch::new();
        let (mut tree, mut raw) = (Vec::new(), Vec::new());
        let mut sector_cells: Vec<Vec<Kind>> = Vec::new();
        let mut total_raw = 0usize;
        let mut total_dedup = 0usize;
        let mut full_checked = 0usize;

        for lod in [0u32, 1, 2, 3] {
            let size = 64i32 << lod;
            let (sx0, sz0) = (x.div_euclid(size), 4000i32.div_euclid(size));
            let (mut lod_raw, mut lod_dedup, mut lod_trees) = (0usize, 0usize, 0usize);
            for dz in -2..=2 {
                for dx in -2..=2 {
                    let (lo, hi) = crate::city::span(sx0 + dx, sz0 + dz, lod);
                    for sy in lo..=hi {
                        s.start(sx0 + dx, sy, sz0 + dz, lod);
                        crate::city::make(&mut s);
                        let w_dedup = encode(&s.cells, &mut tree);
                        let w_raw = encode_undeduplicated(&s.cells, &mut raw);
                        match (w_dedup, w_raw) {
                            (Whole::Empty, Whole::Empty) => {}
                            (Whole::Uniform(a), Whole::Uniform(b)) => assert_eq!(a, b),
                            (Whole::Tree(d), Whole::Tree(r)) => {
                                assert_eq!(d, tree.len());
                                assert!(d <= r, "dedup must never exceed raw words: dedup={d}, raw={r}");
                                lod_trees += 1;
                                lod_raw += r;
                                lod_dedup += d;
                                total_raw += r;
                                total_dedup += d;
                                // Full 64^3 bit-exact check on the first 8 sectors per LOD, full decode on every sector.
                                if full_checked < 8 * (lod as usize + 1) {
                                    verify_all_cells_and_bounds(&s.cells, &tree);
                                    full_checked += 1;
                                } else {
                                    assert_eq!(sound(&tree), 0);
                                    let mut back = vec![0 as Kind; CELLS];
                                    decode(&tree, &mut back);
                                    assert!(back == s.cells, "city decode mismatch lod {lod} ({},{},{})", sx0 + dx, sy, sz0 + dz);
                                }
                                if sector_cells.len() < 120 {
                                    sector_cells.push(s.cells.clone());
                                }
                            }
                            other => panic!("Whole variant mismatch: {other:?}"),
                        }
                    }
                }
            }
            let pct = 100.0 * (1.0 - lod_dedup as f64 / lod_raw as f64);
            eprintln!("svdag city lod {lod}: {lod_trees} trees, raw={lod_raw} words, dedup={lod_dedup} words ({pct:.1}% reduction)");
            assert!(lod_trees > 0);
            assert!(pct > 15.0, "expected >15% word reduction on lod {lod}, got {pct:.1}%");
        }

        let overall_pct = 100.0 * (1.0 - total_dedup as f64 / total_raw as f64);
        eprintln!("svdag city overall: raw={total_raw} words, dedup={total_dedup} words ({overall_pct:.1}% reduction), full 64^3 checked={full_checked}");
        assert!(overall_pct > 20.0, "expected >20% overall city word reduction, got {overall_pct:.1}%");

        // Native encode benchmark: before (encode_undeduplicated) vs after (encode) across real city sectors.
        let rounds = 3usize;
        // Warmup
        for c in &sector_cells {
            let _ = encode(c, &mut tree);
            let _ = encode_undeduplicated(c, &mut raw);
        }
        let t0 = Instant::now();
        let mut sink = 0usize;
        for _ in 0..rounds {
            for c in &sector_cells {
                if let Whole::Tree(w) = encode_undeduplicated(c, &mut raw) {
                    sink += w;
                }
            }
        }
        let raw_ms = t0.elapsed().as_secs_f64() * 1000.0 / (rounds * sector_cells.len()) as f64;

        let t1 = Instant::now();
        for _ in 0..rounds {
            for c in &sector_cells {
                if let Whole::Tree(w) = encode(c, &mut tree) {
                    sink += w;
                }
            }
        }
        let dedup_ms = t1.elapsed().as_secs_f64() * 1000.0 / (rounds * sector_cells.len()) as f64;
        eprintln!(
            "svdag native encode speed ({} city sectors x {rounds}): before={raw_ms:.3} ms/sector, after={dedup_ms:.3} ms/sector (sink={sink})",
            sector_cells.len()
        );
    }
}
