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

/// Reusable scratch buffers for support analysis (`loose`, `topple`, `adrift`, `taken_from`) so blasts do not
/// allocate and page-fault ~80 MB of transient arrays on every detonation (#139).
/// `cost_enc`, `join`, and `load` stay zeroed between calls via sparse resets over `order`.
struct SupportScratch {
    /// Encoded reach cost: `0` means `UNREACHED`, `(c + 1)` means cost `c` (`c <= 254`).
    cost_enc: Vec<u8>,
    join: Vec<u8>,
    load: Vec<u32>,
    torn: Vec<u8>,
    solid_bits: Vec<u64>,
    ground_bits: Vec<u64>,
    built_bits: Vec<u64>,
    non_vert_built_bits: Vec<u64>,
    standing_bits: Vec<u64>,
    edge_bits: Vec<u64>,
    seen_bits: Vec<u64>,
    vert_prev: Vec<u64>,
    order: Vec<u32>,
    waiting: Vec<Vec<u32>>,
    stack: Vec<u32>,
    cells: Vec<u32>,
    levels: Vec<(f64, f64, f64, [usize; 2], [usize; 2], f64)>,
    feet: Vec<([usize; 2], [usize; 2])>,
}

impl SupportScratch {
    fn new() -> Self {
        SupportScratch {
            cost_enc: Vec::new(),
            join: Vec::new(),
            load: Vec::new(),
            torn: Vec::new(),
            solid_bits: Vec::new(),
            ground_bits: Vec::new(),
            built_bits: Vec::new(),
            non_vert_built_bits: Vec::new(),
            standing_bits: Vec::new(),
            edge_bits: Vec::new(),
            seen_bits: Vec::new(),
            vert_prev: Vec::new(),
            order: Vec::new(),
            waiting: vec![Vec::new(); 256],
            stack: Vec::new(),
            cells: Vec::new(),
            levels: Vec::new(),
            feet: Vec::new(),
        }
    }
}

thread_local! {
    static SUPPORT_SCRATCH: std::cell::RefCell<SupportScratch> = std::cell::RefCell::new(SupportScratch::new());
}

/// Minimum `bears(material)` across all materials in `kinds.rs` (`GLASS => 3_000`).
/// A purely vertical column of built cells standing directly on ground with height `<= MIN_BEARS`
/// can never crush any cell beneath it and is guaranteed 100% supported.
const MIN_BEARS: usize = 3_000;

/// Bit-packed 3D occupancy and reachability grid: 64 X-cells per `u64` word, laid out as
/// `wx + words_x * (z + nz * y)` where `words_x = (nx + 63) / 64`.
///
/// Unused high bits in the final X-word (`wx == words_x - 1`) are always zero in `solid` and
/// `reached`, so bit-parallel X shifts never bleed across rows.
pub struct BitGrid {
    pub nx: usize,
    pub ny: usize,
    pub nz: usize,
    pub active_ny: usize,
    pub words_x: usize,
    pub layer_words: usize,
    pub solid: Vec<u64>,
    pub reached: Vec<u64>,
}

/// Propagates reached bits horizontally (`+X` and `-X`) across contiguous solid runs inside one
/// 64-bit X-word using a 6-step Kogge-Stone prefix fill masked by `s`.
#[inline]
fn spread_x_within_word(r: u64, s: u64) -> u64 {
    let mut left = r;
    let mut m = s;
    left |= (left << 1) & m;
    m &= m << 1;
    left |= (left << 2) & m;
    m &= m << 2;
    left |= (left << 4) & m;
    m &= m << 4;
    left |= (left << 8) & m;
    m &= m << 8;
    left |= (left << 16) & m;
    m &= m << 16;
    left |= (left << 32) & m;

    let mut right = left;
    let mut m = s;
    right |= (right >> 1) & m;
    m &= m >> 1;
    right |= (right >> 2) & m;
    m &= m >> 2;
    right |= (right >> 4) & m;
    m &= m >> 4;
    right |= (right >> 8) & m;
    m &= m >> 8;
    right |= (right >> 16) & m;
    m &= m >> 16;
    right |= (right >> 32) & m;
    right
}

/// Runs one Y-layer of 6-connected bit-parallel flood fill over `solid` / `reached` bit-words.
/// Uses cross-word X shifts `(w << 1) | (prev >> 63)` and `(w >> 1) | (next << 63)` plus direct
/// `u64` bitwise ORs along Y and Z. Returns `true` if any bit in `reached` changed.
fn bit_reach_layer_raw(
    solid: &[u64],
    reached: &mut [u64],
    ny: usize,
    nz: usize,
    words_x: usize,
    y: usize,
    forward: bool,
) -> bool {
    let layer_words = words_x * nz;
    if layer_words == 0 || y >= ny {
        return false;
    }
    let mut changed = false;
    let y_off = y * layer_words;
    let has_yn = y > 0;
    let has_yp = y + 1 < ny;
    if forward {
        for z in 0..nz {
            let z_off = y_off + z * words_x;
            let has_zn = z > 0;
            let has_zp = z + 1 < nz;
            for wx in 0..words_x {
                let idx = z_off + wx;
                let s = solid[idx];
                if s == 0 {
                    continue;
                }
                let old = reached[idx];
                if old == s {
                    continue;
                }
                let prev = if wx > 0 { reached[idx - 1] } else { 0 };
                let next = if wx + 1 < words_x { reached[idx + 1] } else { 0 };
                let mut r = old | ((old << 1) | (prev >> 63)) | ((old >> 1) | (next << 63));
                if has_yn {
                    r |= reached[idx - layer_words];
                }
                if has_yp {
                    r |= reached[idx + layer_words];
                }
                if has_zn {
                    r |= reached[idx - words_x];
                }
                if has_zp {
                    r |= reached[idx + words_x];
                }
                r &= s;
                if r != old {
                    if r != s {
                        r = spread_x_within_word(r, s);
                    }
                    reached[idx] = r;
                    changed = true;
                }
            }
        }
    } else {
        for z in (0..nz).rev() {
            let z_off = y_off + z * words_x;
            let has_zn = z > 0;
            let has_zp = z + 1 < nz;
            for wx in (0..words_x).rev() {
                let idx = z_off + wx;
                let s = solid[idx];
                if s == 0 {
                    continue;
                }
                let old = reached[idx];
                if old == s {
                    continue;
                }
                let prev = if wx > 0 { reached[idx - 1] } else { 0 };
                let next = if wx + 1 < words_x { reached[idx + 1] } else { 0 };
                let mut r = old | ((old << 1) | (prev >> 63)) | ((old >> 1) | (next << 63));
                if has_yn {
                    r |= reached[idx - layer_words];
                }
                if has_yp {
                    r |= reached[idx + layer_words];
                }
                if has_zn {
                    r |= reached[idx - words_x];
                }
                if has_zp {
                    r |= reached[idx + words_x];
                }
                r &= s;
                if r != old {
                    if r != s {
                        r = spread_x_within_word(r, s);
                    }
                    reached[idx] = r;
                    changed = true;
                }
            }
        }
    }
    changed
}

/// Mask of cells in X-word `wx` at `(y, z)` that touch any of the 6 outer faces of a `[nx, ny, nz]` box.
#[inline]
fn border_word_mask(nx: usize, ny: usize, nz: usize, y: usize, z: usize, wx: usize, words_x: usize) -> u64 {
    if y == 0 || y + 1 == ny || z == 0 || z + 1 == nz {
        return u64::MAX;
    }
    let mut mask = 0u64;
    if wx == 0 {
        mask |= 1u64;
    }
    if wx + 1 == words_x && nx > 0 {
        mask |= 1u64 << ((nx - 1) & 63);
    }
    mask
}

impl BitGrid {
    /// Allocates an empty `BitGrid` for dimensions `[nx, ny, nz]`.
    pub fn new(nx: usize, ny: usize, nz: usize) -> Self {
        let words_x = nx.div_ceil(64);
        let layer_words = words_x * nz;
        let total_words = layer_words * ny;
        BitGrid {
            nx,
            ny,
            nz,
            active_ny: 0,
            words_x,
            layer_words,
            solid: vec![0u64; total_words],
            reached: vec![0u64; total_words],
        }
    }

    /// Packs solid occupancy of `r` into 64-bit X-words (`reached` starts empty).
    pub fn from_region(r: &Region) -> Self {
        let [nx, ny, nz] = r.size;
        let mut grid = BitGrid::new(nx, ny, nz);
        let active_ny = active_layers(r);
        grid.active_ny = active_ny;
        let layer = nx * nz;
        for y in 0..active_ny {
            let y_off = y * layer;
            let yw_off = y * grid.layer_words;
            for z in 0..nz {
                let row = y_off + z * nx;
                let rw_off = yw_off + z * grid.words_x;
                for wx in 0..grid.words_x {
                    let x0 = wx << 6;
                    let x1 = (x0 + 64).min(nx);
                    let mut s_word = 0u64;
                    let mut x = x0;
                    while x + 4 <= x1 {
                        let (c0, c1, c2, c3) = (r.cells[row + x], r.cells[row + x + 1], r.cells[row + x + 2], r.cells[row + x + 3]);
                        if (c0 | c1 | c2 | c3) != 0 {
                            let base = x - x0;
                            if c0 != 0 { s_word |= 1u64 << base; }
                            if c1 != 0 { s_word |= 1u64 << (base + 1); }
                            if c2 != 0 { s_word |= 1u64 << (base + 2); }
                            if c3 != 0 { s_word |= 1u64 << (base + 3); }
                        }
                        x += 4;
                    }
                    while x < x1 {
                        if r.cells[row + x] != 0 {
                            s_word |= 1u64 << (x - x0);
                        }
                        x += 1;
                    }
                    grid.solid[rw_off + wx] = s_word;
                }
            }
        }
        grid
    }

    /// Single-pass pack of `solid` occupancy and `reached` ground/border seeds from `r`.
    pub fn from_region_grounded(r: &Region) -> Self {
        let [nx, ny, nz] = r.size;
        let mut grid = BitGrid::new(nx, ny, nz);
        let active_ny = active_layers(r);
        grid.active_ny = active_ny;
        let layer = nx * nz;
        for y in 0..active_ny {
            let y_edge = y == 0;
            let y_off = y * layer;
            let yw_off = y * grid.layer_words;
            for z in 0..nz {
                let yz_edge = y_edge || z == 0 || z + 1 == nz;
                let row = y_off + z * nx;
                let rw_off = yw_off + z * grid.words_x;
                for wx in 0..grid.words_x {
                    let x0 = wx << 6;
                    let x1 = (x0 + 64).min(nx);
                    let gb = if y > 0 { grid.reached[rw_off - grid.layer_words + wx] } else { 0 };
                    let mut s_word = 0u64;
                    let mut g_word = 0u64;
                    let mut x = x0;
                    while x + 4 <= x1 {
                        let (c0, c1, c2, c3) = (r.cells[row + x], r.cells[row + x + 1], r.cells[row + x + 2], r.cells[row + x + 3]);
                        if (c0 | c1 | c2 | c3) != 0 {
                            let base = x - x0;
                            for (dx, k) in [(0usize, c0), (1, c1), (2, c2), (3, c3)] {
                                if k != 0 {
                                    let bit = 1u64 << (base + dx);
                                    s_word |= bit;
                                    let xx = x + dx;
                                    if yz_edge || xx == 0 || xx + 1 == nx || (is_ground(k) && (gb & bit) != 0) {
                                        g_word |= bit;
                                    }
                                }
                            }
                        }
                        x += 4;
                    }
                    while x < x1 {
                        let k = r.cells[row + x];
                        if k != 0 {
                            let bit = 1u64 << (x - x0);
                            s_word |= bit;
                            if yz_edge || x == 0 || x + 1 == nx || (is_ground(k) && (gb & bit) != 0) {
                                g_word |= bit;
                            }
                        }
                        x += 1;
                    }
                    grid.solid[rw_off + wx] = s_word;
                    grid.reached[rw_off + wx] = g_word;
                }
            }
        }
        grid
    }

    /// Seeds `reached` with all solid border cells (`y == 0`, `x == 0`, `x == nx - 1`, `z == 0`,
    /// `z == nz - 1`) and vertical ground columns resting on them.
    pub fn seed_ground_and_borders(&mut self, r: &Region) {
        let [nx, ny, nz] = r.size;
        debug_assert_eq!((nx, ny, nz), (self.nx, self.ny, self.nz));
        let active_ny = if self.active_ny > 0 { self.active_ny } else { active_layers(r) };
        self.active_ny = active_ny;
        let layer = nx * nz;
        self.reached[..active_ny * self.layer_words].fill(0);
        for y in 0..active_ny {
            let y_edge = y == 0;
            let y_off = y * layer;
            let yw_off = y * self.layer_words;
            for z in 0..nz {
                let yz_edge = y_edge || z == 0 || z + 1 == nz;
                let row = y_off + z * nx;
                let rw_off = yw_off + z * self.words_x;
                for wx in 0..self.words_x {
                    let s_word = self.solid[rw_off + wx];
                    if s_word == 0 {
                        continue;
                    }
                    if yz_edge {
                        self.reached[rw_off + wx] = s_word;
                        continue;
                    }
                    let x0 = wx << 6;
                    let gb = if y > 0 { self.reached[rw_off - self.layer_words + wx] } else { 0 };
                    let mut g_word = 0u64;
                    if wx == 0 && (s_word & 1) != 0 {
                        g_word |= 1;
                    }
                    if wx + 1 == self.words_x && nx > 0 {
                        let last = 1u64 << ((nx - 1) & 63);
                        if (s_word & last) != 0 {
                            g_word |= last;
                        }
                    }
                    let mut cand = s_word & gb & !g_word;
                    while cand != 0 {
                        let bit = cand.trailing_zeros() as usize;
                        cand &= cand - 1;
                        if is_ground(r.cells[row + x0 + bit]) {
                            g_word |= 1u64 << bit;
                        }
                    }
                    self.reached[rw_off + wx] = g_word;
                }
            }
        }
    }

    #[inline]
    pub fn word_index(&self, x: usize, y: usize, z: usize) -> (usize, u64) {
        (y * self.layer_words + z * self.words_x + (x >> 6), 1u64 << (x & 63))
    }

    #[inline]
    pub fn is_solid(&self, x: usize, y: usize, z: usize) -> bool {
        let (idx, bit) = self.word_index(x, y, z);
        (self.solid[idx] & bit) != 0
    }

    #[inline]
    pub fn is_reached(&self, x: usize, y: usize, z: usize) -> bool {
        let (idx, bit) = self.word_index(x, y, z);
        (self.reached[idx] & bit) != 0
    }

    #[inline]
    pub fn set_solid(&mut self, x: usize, y: usize, z: usize) {
        let (idx, bit) = self.word_index(x, y, z);
        self.solid[idx] |= bit;
        if y + 1 > self.active_ny {
            self.active_ny = y + 1;
        }
    }

    #[inline]
    pub fn set_reached(&mut self, x: usize, y: usize, z: usize) {
        let (idx, bit) = self.word_index(x, y, z);
        self.reached[idx] |= bit & self.solid[idx];
    }

    pub fn solid_count(&self) -> usize {
        let end = self.active_ny * self.layer_words;
        self.solid[..end].iter().map(|w| w.count_ones() as usize).sum()
    }

    pub fn reached_count(&self) -> usize {
        let end = self.active_ny * self.layer_words;
        self.reached[..end].iter().map(|w| w.count_ones() as usize).sum()
    }

    /// One bidirectional (forward + backward) 6-connected bit-parallel flood-fill pass.
    /// Returns `true` if any bit in `reached` was newly set.
    pub fn bit_reach_pass(&mut self) -> bool {
        let ny = self.active_ny;
        if ny == 0 || self.solid.is_empty() {
            return false;
        }
        let mut changed = false;
        for y in 0..ny {
            changed |= bit_reach_layer_raw(&self.solid, &mut self.reached, ny, self.nz, self.words_x, y, true);
        }
        for y in (0..ny).rev() {
            changed |= bit_reach_layer_raw(&self.solid, &mut self.reached, ny, self.nz, self.words_x, y, false);
        }
        changed
    }

    /// Runs `bit_reach_pass` to convergence and returns the number of passes performed.
    pub fn flood_fill(&mut self) -> usize {
        let mut passes = 0;
        while self.bit_reach_pass() {
            passes += 1;
        }
        passes
    }
}

/// Packs one `(y, z)` row of `cells` into `solid`, `ground`, `built`, `non_vert_built`, and optional
/// `non_ground` 64-bit X-words while updating rolling vertical-column support `v_prev`.
#[inline]
#[allow(clippy::too_many_arguments)]
fn pack_row_bits(
    cells_row: &[Kind],
    nx: usize,
    yz_edge: bool,
    g_below: Option<&[u64]>,
    v_prev: &mut [u64],
    solid_out: &mut [u64],
    ground_out: &mut [u64],
    built_out: &mut [u64],
    non_vert_built_out: &mut [u64],
    mut non_ground_out: Option<&mut [u64]>,
) -> (bool, bool, usize) {
    let words_x = solid_out.len();
    let mut any_built = false;
    let mut all_vert = true;
    let mut built_count = 0usize;
    for wx in 0..words_x {
        let x0 = wx << 6;
        let x1 = (x0 + 64).min(nx);
        let gb = g_below.map_or(0, |row| row[wx]);
        let mut s_word = 0u64;
        let mut g_word = 0u64;
        let mut ng_word = 0u64;
        let mut x = x0;
        while x + 4 <= x1 {
            let c0 = cells_row[x];
            let c1 = cells_row[x + 1];
            let c2 = cells_row[x + 2];
            let c3 = cells_row[x + 3];
            if (c0 | c1 | c2 | c3) != 0 {
                let base = x - x0;
                for (dx, k) in [(0usize, c0), (1, c1), (2, c2), (3, c3)] {
                    if k != 0 {
                        let bit = 1u64 << (base + dx);
                        s_word |= bit;
                        let is_g = is_ground(k);
                        if !is_g {
                            ng_word |= bit;
                        }
                        let xx = x + dx;
                        if yz_edge || xx == 0 || xx + 1 == nx || (is_g && (gb & bit) != 0) {
                            g_word |= bit;
                        }
                    }
                }
            }
            x += 4;
        }
        while x < x1 {
            let k = cells_row[x];
            if k != 0 {
                let bit = 1u64 << (x - x0);
                s_word |= bit;
                let is_g = is_ground(k);
                if !is_g {
                    ng_word |= bit;
                }
                if yz_edge || x == 0 || x + 1 == nx || (is_g && (gb & bit) != 0) {
                    g_word |= bit;
                }
            }
            x += 1;
        }
        let b_word = s_word & !g_word;
        let v_word = g_word | (s_word & v_prev[wx]);
        v_prev[wx] = v_word;
        solid_out[wx] = s_word;
        ground_out[wx] = g_word;
        built_out[wx] = b_word;
        non_vert_built_out[wx] = b_word & !v_word;
        if let Some(ng) = non_ground_out.as_deref_mut() {
            ng[wx] = ng_word;
        }
        if b_word != 0 {
            any_built = true;
            built_count += b_word.count_ones() as usize;
        }
        if v_word != s_word {
            all_vert = false;
        }
    }
    (any_built, all_vert, built_count)
}

#[inline]
fn holder_of(i: usize, how: u8, nx: usize, layer: usize) -> usize {
    match how & 127 {
        RESTS => i - layer,
        3 => i - 1,
        4 => i + 1,
        5 => i - nx,
        6 => i + nx,
        HANGS => i + layer,
        _ => i,
    }
}

/// Computes the 6-neighbor frontier mask of `ground_bits` words touching `built_bits` at word `idx`.
#[inline]
fn frontier_seed_mask(
    ground_bits: &[u64],
    built_bits: &[u64],
    active_ny: usize,
    nz: usize,
    words_x: usize,
    layer_words: usize,
    y: usize,
    z: usize,
    wx: usize,
    idx: usize,
) -> u64 {
    let g = ground_bits[idx];
    if g == 0 {
        return 0;
    }
    let b = built_bits[idx];
    let b_prev = if wx > 0 { built_bits[idx - 1] } else { 0 };
    let b_next = if wx + 1 < words_x { built_bits[idx + 1] } else { 0 };
    let mut adj = ((b << 1) | (b_prev >> 63)) | ((b >> 1) | (b_next << 63));
    if y + 1 < active_ny {
        adj |= built_bits[idx + layer_words];
    }
    if y > 0 {
        adj |= built_bits[idx - layer_words];
    }
    if z > 0 {
        adj |= built_bits[idx - words_x];
    }
    if z + 1 < nz {
        adj |= built_bits[idx + words_x];
    }
    g & adj
}

#[inline]
fn has_nonzero_kind(slice: &[Kind]) -> bool {
    let mut chunks = slice.chunks_exact(4);
    for c in &mut chunks {
        if (c[0] | c[1] | c[2] | c[3]) != 0 {
            return true;
        }
    }
    chunks.remainder().iter().any(|&k| k != 0)
}

/// Highest `y + 1` in `r` that contains any non-air cell: empty sky layers above it need never be scanned.
#[inline]
fn active_layers(r: &Region) -> usize {
    let layer = r.size[0] * r.size[2];
    if layer == 0 {
        return 0;
    }
    let mut top = r.size[1];
    while top > 0 {
        if has_nonzero_kind(&r.cells[(top - 1) * layer..top * layer]) {
            break;
        }
        top -= 1;
    }
    top
}

#[inline]
fn pack_xyz(x: usize, y: usize, z: usize) -> u32 {
    (x as u32) | ((z as u32) << 10) | ((y as u32) << 20)
}

#[inline]
fn unpack_xyz(q: u32) -> (usize, usize, usize) {
    ((q & 1023) as usize, (q >> 20) as usize, ((q >> 10) & 1023) as usize)
}

/// Which solid cells of a region the ground does not hold: one true a cell.
///
/// The ground is reached for outwards, cheapest way first, and each cell is joined to the one it was reached from.
/// Then every join is asked what it carries. One that carries too much tears (or, for a cell resting on another,
/// crushes it), and the whole is asked again without it: the load may go another way, and tear that in turn, which
/// is how a thing gives way bit by bit. When nothing more tears, what the ground no longer reaches is loose.
pub fn loose(r: &Region) -> Vec<bool> {
    loose_inner(r, None, false).0
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
#[cfg(test)]
pub(crate) fn loose_how(r: &Region, blocks: Option<(&[u8], usize)>) -> (Vec<bool>, Vec<u8>, Vec<u8>) {
    loose_inner(r, blocks, true)
}

fn loose_inner(r: &Region, blocks: Option<(&[u8], usize)>, need_meta: bool) -> (Vec<bool>, Vec<u8>, Vec<u8>) {
    let by = blocks.map_or(1, |b| b.1);
    // How many cells a block is, and how many cells' worth of joins a face of it has.
    let cells_of = |i: usize| blocks.map_or(1, |b| (b.0[i] as u32).max(1));
    let face = |i: usize| blocks.map_or(1, |b| (b.0[i] as u32 / b.1 as u32).max(1));
    let [nx, ny, nz] = r.size;
    let (n, layer) = (r.cells.len(), nx * nz);
    let active_ny = active_layers(r);
    let active_n = active_ny * layer;
    let mut out = vec![false; n];
    if active_n == 0 {
        return if need_meta { (out, vec![NONE; n], vec![UNREACHED; n]) } else { (out, Vec::new(), Vec::new()) };
    }
    let words_x = nx.div_ceil(64);
    let layer_words = words_x * nz;
    let total_words = layer_words * active_ny;
    let pack = nx <= 1024 && ny <= 4096 && nz <= 1024;

    SUPPORT_SCRATCH.with_borrow_mut(|s| {
        if s.solid_bits.len() < total_words { s.solid_bits.resize(total_words, 0); }
        if s.ground_bits.len() < total_words { s.ground_bits.resize(total_words, 0); }
        if s.built_bits.len() < total_words { s.built_bits.resize(total_words, 0); }
        if s.non_vert_built_bits.len() < total_words { s.non_vert_built_bits.resize(total_words, 0); }
        if s.vert_prev.len() < layer_words { s.vert_prev.resize(layer_words, 0); }

        let solid_bits = &mut s.solid_bits[..total_words];
        let ground_bits = &mut s.ground_bits[..total_words];
        let built_bits = &mut s.built_bits[..total_words];
        let non_vert_built_bits = &mut s.non_vert_built_bits[..total_words];
        let vert_prev = &mut s.vert_prev[..layer_words];
        let cells = &r.cells[..active_n];

        // Single pass packs solid, ground (borders + vertical ground columns), built, and non-vertically-supported
        // built bitsets, and checks whether every solid cell rests vertically on ground (trivially anchored fast-path).
        let mut any_built = false;
        let mut all_vert_supported = true;
        for y in 0..active_ny {
            let y_edge = y == 0;
            let y_off = y * layer;
            let yw_off = y * layer_words;
            if y == 0 {
                for z in 0..nz {
                    let yz_edge = true;
                    let row = y_off + z * nx;
                    let rw = z * words_x;
                    let (ab, av, _) = pack_row_bits(
                        &cells[row..row + nx],
                        nx,
                        yz_edge,
                        None,
                        &mut vert_prev[rw..rw + words_x],
                        &mut solid_bits[rw..rw + words_x],
                        &mut ground_bits[rw..rw + words_x],
                        &mut built_bits[rw..rw + words_x],
                        &mut non_vert_built_bits[rw..rw + words_x],
                        None,
                    );
                    any_built |= ab;
                    all_vert_supported &= av;
                }
            } else {
                let (prev_g, cur_g) = ground_bits.split_at_mut(yw_off);
                let prev_layer_g = &prev_g[yw_off - layer_words..];
                for z in 0..nz {
                    let yz_edge = y_edge || z == 0 || z + 1 == nz;
                    let row = y_off + z * nx;
                    let rw = z * words_x;
                    let w_off = yw_off + rw;
                    let (ab, av, _) = pack_row_bits(
                        &cells[row..row + nx],
                        nx,
                        yz_edge,
                        Some(&prev_layer_g[rw..rw + words_x]),
                        &mut vert_prev[rw..rw + words_x],
                        &mut solid_bits[w_off..w_off + words_x],
                        &mut cur_g[rw..rw + words_x],
                        &mut built_bits[w_off..w_off + words_x],
                        &mut non_vert_built_bits[w_off..w_off + words_x],
                        None,
                    );
                    any_built |= ab;
                    all_vert_supported &= av;
                }
            }
        }

        // Fast-path 1: no built cells at all, or every built cell stands purely vertically on ground
        // within the minimum bearing limit (cost 0 RESTS everywhere, zero tears possible).
        if !need_meta && (!any_built || (all_vert_supported && blocks.is_none() && active_ny <= MIN_BEARS)) {
            return (out, Vec::new(), Vec::new());
        }
        let ground_bits: &[u64] = &*ground_bits;
        let built_bits: &[u64] = &*built_bits;
        let non_vert_built_bits: &[u64] = &*non_vert_built_bits;

        if s.cost_enc.len() < active_n { s.cost_enc.resize(active_n, 0); }
        if s.join.len() < active_n { s.join.resize(active_n, NONE); }
        if s.load.len() < active_n { s.load.resize(active_n, 0); }
        if AGAIN > 0 {
            if s.torn.len() < active_n { s.torn.resize(active_n, 0); }
            s.torn[..active_n].fill(0);
        }
        let cost_enc = &mut s.cost_enc[..active_n];
        let join = &mut s.join[..active_n];
        let load = &mut s.load[..active_n];
        let torn = &mut s.torn;
        let order = &mut s.order;
        let waiting = &mut s.waiting;

        let mut full_join = if need_meta { vec![NONE; n] } else { Vec::new() };
        let mut full_cost = if need_meta { vec![UNREACHED; n] } else { Vec::new() };

        for pass in 0..=AGAIN {
            order.clear();
            for q in waiting.iter_mut() {
                q.clear();
            }

            // Bit-parallel frontier detection: only GROUND cells touching a built (non-ground solid)
            // 6-neighbor seed the reach search, emitted in exact (y, z, x) order.
            for y in 0..active_ny {
                let y_off = y * layer;
                let yw_off = y * layer_words;
                for z in 0..nz {
                    let row = y_off + z * nx;
                    let rw_off = yw_off + z * words_x;
                    for wx in 0..words_x {
                        let idx = rw_off + wx;
                        let mut seeds = frontier_seed_mask(
                            ground_bits,
                            built_bits,
                            active_ny,
                            nz,
                            words_x,
                            layer_words,
                            y,
                            z,
                            wx,
                            idx,
                        );
                        while seeds != 0 {
                            let bit = seeds.trailing_zeros() as usize;
                            seeds &= seeds - 1;
                            let x = (wx << 6) + bit;
                            let i = row + x;
                            cost_enc[i] = 1; // cost 0
                            join[i] = GROUND;
                            waiting[0].push(if pack { pack_xyz(x, y, z) } else { i as u32 });
                        }
                    }
                }
            }

            // Fast-path 2: trivially disconnected region (no built cell touches ground at all).
            if waiting[0].is_empty() {
                if any_built {
                    for y in 0..active_ny {
                        let y_off = y * layer;
                        let yw_off = y * layer_words;
                        for z in 0..nz {
                            let row = y_off + z * nx;
                            let rw_off = yw_off + z * words_x;
                            for wx in 0..words_x {
                                let mut b = built_bits[rw_off + wx];
                                while b != 0 {
                                    let bit = b.trailing_zeros() as usize;
                                    b &= b - 1;
                                    out[row + (wx << 6) + bit] = true;
                                }
                            }
                        }
                    }
                }
                if need_meta {
                    for y in 0..active_ny {
                        let y_off = y * layer;
                        let yw_off = y * layer_words;
                        for z in 0..nz {
                            let row = y_off + z * nx;
                            let rw_off = yw_off + z * words_x;
                            for wx in 0..words_x {
                                let mut g = ground_bits[rw_off + wx];
                                while g != 0 {
                                    let bit = g.trailing_zeros() as usize;
                                    g &= g - 1;
                                    let i = row + (wx << 6) + bit;
                                    full_cost[i] = 0;
                                    full_join[i] = GROUND;
                                }
                            }
                        }
                    }
                }
                break;
            }

            for c in 0..255usize {
                let mut at_cost = std::mem::take(&mut waiting[c]);
                let c_enc = (c + 1) as u8;
                // Resting costs nothing, so cells join this round as it goes.
                let mut k = 0;
                while k < at_cost.len() {
                    let raw = at_cost[k];
                    k += 1;
                    let (x, y, z, i) = if pack {
                        let (x, y, z) = unpack_xyz(raw);
                        (x, y, z, x + nx * (z + nz * y))
                    } else {
                        let i = raw as usize;
                        let (x, y, z) = r.place(i);
                        (x, y, z, i)
                    };
                    if cost_enc[i] != c_enc {
                        continue;
                    }
                    // A cell may be listed twice at one cost: count it once.
                    if join[i] & 128 != 0 {
                        continue;
                    }
                    join[i] |= 128;
                    order.push(i as u32);
                    let src_kind = cells[i];
                    let src_rubble = rubble(src_kind);
                    let src_leaves = material(src_kind) == LEAVES;
                    let mut reach = |j: usize, nx_c: usize, ny_c: usize, nz_c: usize, more: usize, how: u8, list: &mut Vec<u32>, waiting: &mut Vec<Vec<u32>>| {
                        // Bit-packed check rejects air, GROUND, and (for more != 0) vertically-supported
                        // cost-0 cells in one L2 bit test, avoiding hundreds of thousands of stale pushes.
                        let bw = ny_c * layer_words + nz_c * words_x + (nx_c >> 6);
                        let mask_bits = if AGAIN == 0 && more != 0 { non_vert_built_bits } else { built_bits };
                        if (mask_bits[bw] & (1u64 << (nx_c & 63))) == 0 {
                            return;
                        }
                        let kind = cells[j];
                        let to = c + more;
                        if to >= cost_enc[j].wrapping_sub(1) as usize || to > spans(material(kind)) as usize {
                            return;
                        }
                        if AGAIN > 0 && torn[j] & (1 << how) != 0 {
                            return;
                        }
                        // Rubble lies on what is under it and that is all: it is joined to nothing beside it or over it,
                        // and nothing beside it or under it is joined to it.
                        if more != 0 && (rubble(kind) || src_rubble) {
                            return;
                        }
                        // Leaves hold on to leaves and to nothing else: a crown that brushes a wall is not hung on it, though it may rest on what is under it.
                        if more != 0 && (material(kind) == LEAVES) != src_leaves {
                            return;
                        }
                        cost_enc[j] = (to + 1) as u8;
                        join[j] = how;
                        let entry = if pack { pack_xyz(nx_c, ny_c, nz_c) } else { j as u32 };
                        if more == 0 { list.push(entry) } else { waiting[to].push(entry) }
                    };
                    if y + 1 < active_ny { reach(i + layer, x, y + 1, z, 0, RESTS, &mut at_cost, waiting) }
                    if x > 0 { reach(i - 1, x - 1, y, z, by, LEANS + 1, &mut at_cost, waiting) }
                    if x + 1 < nx { reach(i + 1, x + 1, y, z, by, LEANS, &mut at_cost, waiting) }
                    if z > 0 { reach(i - nx, x, y, z - 1, by, LEANS + 3, &mut at_cost, waiting) }
                    if z + 1 < nz { reach(i + nx, x, y, z + 1, by, LEANS + 2, &mut at_cost, waiting) }
                    if y > 0 { reach(i - layer, x, y - 1, z, 2 * by, HANGS, &mut at_cost, waiting) }
                }
                at_cost.clear();
                waiting[c] = at_cost;
            }
            // What each join carries: the cell and all that is joined on through it. Last joined first.
            for &i in order.iter().rev() {
                let i = i as usize;
                load[i] += cells_of(i);
                let how = join[i] & 127;
                if how != GROUND {
                    let h = holder_of(i, how, nx, layer);
                    load[h] += load[i];
                }
            }
            // A sideways or hanging join that carries more than it can tears; what rests on a cell must not be more than
            // that cell can bear (a house does not stand on a post one cell thick).
            let last = pass == AGAIN;
            let mut tore = false;
            if pass > 0 {
                out[..active_n].fill(false);
            }
            for &i in order.iter() {
                let i = i as usize;
                let how = join[i] & 127;
                if how == GROUND {
                    continue;
                }
                let h = holder_of(i, how, nx, layer);
                let over = if how == RESTS {
                    load[i] > bears(material(cells[h])).saturating_mul(face(h))
                } else {
                    load[i] > join_carries(material(cells[i]), material(cells[h])).saturating_mul(face(i).min(face(h)))
                };
                if over {
                    if AGAIN > 0 {
                        torn[i] |= 1 << how;
                    }
                    tore = true;
                }
                // Asked for the last time, what a torn join carried is loose with it.
                if last && (out[h] || over) {
                    out[i] = true;
                }
            }
            let done = !tore || last;
            if done {
                // Only built cells can be unreached: iterate set bits of built_bits instead of all cells.
                for y in 0..active_ny {
                    let y_off = y * layer;
                    let yw_off = y * layer_words;
                    for z in 0..nz {
                        let row = y_off + z * nx;
                        let rw_off = yw_off + z * words_x;
                        for wx in 0..words_x {
                            let mut b = built_bits[rw_off + wx];
                            while b != 0 {
                                let bit = b.trailing_zeros() as usize;
                                b &= b - 1;
                                let j = row + (wx << 6) + bit;
                                if cost_enc[j] == 0 {
                                    out[j] = true;
                                }
                            }
                        }
                    }
                }
                if need_meta {
                    for y in 0..active_ny {
                        let y_off = y * layer;
                        let yw_off = y * layer_words;
                        for z in 0..nz {
                            let row = y_off + z * nx;
                            let rw_off = yw_off + z * words_x;
                            for wx in 0..words_x {
                                let mut g = ground_bits[rw_off + wx];
                                while g != 0 {
                                    let bit = g.trailing_zeros() as usize;
                                    g &= g - 1;
                                    let i = row + (wx << 6) + bit;
                                    full_cost[i] = 0;
                                    full_join[i] = GROUND;
                                }
                            }
                        }
                    }
                    for &i in order.iter() {
                        let i = i as usize;
                        full_cost[i] = cost_enc[i].wrapping_sub(1);
                        full_join[i] = join[i];
                    }
                }
            }
            // Sparsely reset `cost_enc`, `join`, and `load` back to zero so the next call does not memset 34 MB.
            for &i in order.iter() {
                let i = i as usize;
                cost_enc[i] = 0;
                join[i] = NONE;
                load[i] = 0;
            }
            if done {
                break;
            }
        }
        (out, full_join, full_cost)
    })
}

/// The rows a set of cells makes, sorted by y, then z, then x: neighbours along x of one kind are one row.
fn rows(r: &Region, cells: &mut [u32]) -> Vec<Run> {
    cells.sort_unstable();
    let mut runs: Vec<Run> = Vec::new();
    let [nx, _, nz] = r.size;
    let layer = nx * nz;
    let (mut prev_i, mut x, mut y, mut z) = (usize::MAX, 0usize, 0usize, 0usize);
    for &i in cells.iter() {
        let iu = i as usize;
        if iu == prev_i.wrapping_add(1) && x + 1 < nx {
            x += 1;
        } else {
            y = iu / layer;
            let rem = iu - y * layer;
            z = rem / nx;
            x = rem - z * nx;
        }
        prev_i = iu;
        let (wx, wy, wz, kind) = (r.low[0] + x as i32, r.low[1] + y as i32, r.low[2] + z as i32, r.cells[iu]);
        match runs.last_mut() {
            Some(last) if last.y == wy && last.z == wz && last.x1 == wx && last.kind == kind => last.x1 += 1,
            _ => runs.push(Run { x0: wx, x1: wx + 1, y: wy, z: wz, kind }),
        }
    }
    runs
}

/// The loose cells of a region as pieces: loose cells that touch are one. A piece that reaches the box's sides or
/// top goes on beyond it, and what it is joined to there is not known, so it is left where it is (and comes back empty).
fn pieces_of(r: &Region, is_loose: &[bool], seen_bits: &mut Vec<u64>, [sides, top]: [bool; 2]) -> Vec<Vec<u32>> {
    let [nx, ny, nz] = r.size;
    let layer = nx * nz;
    let active_ny = active_layers(r);
    let active_n = active_ny * layer;
    let mut pieces: Vec<Vec<u32>> = Vec::new();
    if active_n == 0 {
        return pieces;
    }
    let words_x = nx.div_ceil(64);
    let layer_words = words_x * nz;
    let total_words = layer_words * active_ny;
    if seen_bits.len() < total_words {
        seen_bits.resize(total_words, 0);
    }
    let mut seen_cleared = false;
    let pack = nx <= 1024 && ny <= 4096 && nz <= 1024;
    let mut stack: Vec<u32> = Vec::new();
    let mut start = 0usize;
    while start < active_n {
        // Fast skip 8 false bytes at a time (99%+ of a region is not loose).
        if start + 8 <= active_n {
            let any8 = is_loose[start] | is_loose[start + 1] | is_loose[start + 2] | is_loose[start + 3]
                | is_loose[start + 4] | is_loose[start + 5] | is_loose[start + 6] | is_loose[start + 7];
            if !any8 {
                start += 8;
                continue;
            }
        }
        if !is_loose[start] {
            start += 1;
            continue;
        }
        if !seen_cleared {
            seen_bits[..total_words].fill(0);
            seen_cleared = true;
        }
        let (sx, sy, sz) = r.place(start);
        let sw = sy * layer_words + sz * words_x + (sx >> 6);
        let sbit = 1u64 << (sx & 63);
        if (seen_bits[sw] & sbit) != 0 {
            start += 1;
            continue;
        }
        let mut cells: Vec<u32> = Vec::new();
        let mut edge = false;
        seen_bits[sw] |= sbit;
        stack.push(if pack { pack_xyz(sx, sy, sz) } else { start as u32 });
        while let Some(raw) = stack.pop() {
            let (x, y, z, i) = if pack {
                let (x, y, z) = unpack_xyz(raw);
                (x, y, z, x + nx * (z + nz * y))
            } else {
                let i = raw as usize;
                let (x, y, z) = r.place(i);
                (x, y, z, i)
            };
            cells.push(i as u32);
            edge |= (sides && (x == 0 || x == nx - 1 || z == 0 || z == nz - 1)) || (top && y == ny - 1);
            let mut join = |j: usize, nx_c: usize, ny_c: usize, nz_c: usize| {
                if !is_loose[j] {
                    return;
                }
                let jw = ny_c * layer_words + nz_c * words_x + (nx_c >> 6);
                let jbit = 1u64 << (nx_c & 63);
                if (seen_bits[jw] & jbit) == 0 {
                    seen_bits[jw] |= jbit;
                    stack.push(if pack { pack_xyz(nx_c, ny_c, nz_c) } else { j as u32 });
                }
            };
            if x > 0 { join(i - 1, x - 1, y, z) }
            if x + 1 < nx { join(i + 1, x + 1, y, z) }
            if z > 0 { join(i - nx, x, y, z - 1) }
            if z + 1 < nz { join(i + nx, x, y, z + 1) }
            if y > 0 { join(i - layer, x, y - 1, z) }
            if y + 1 < active_ny { join(i + layer, x, y + 1, z) }
        }
        if edge {
            cells.clear();
        }
        pieces.push(cells);
        start += 1;
    }
    pieces
}

/// Whether a cell is the ground itself and not something that stands on it.
pub(crate) fn is_ground(kind: Kind) -> bool {
    matches!(material(kind), EARTH | ROCK | GRASS | SAND | ASPHALT | WATER)
}

/// Packs standing non-ground cells (`cells != 0 && !is_ground && !is_loose`) and seeds their
/// box-edge boundary bits for bit-parallel edge-component pruning in `topple` and `adrift`.
/// Returns `(any_edge_seed, any_interior_standing)`.
fn build_standing_and_edge_bits(
    r: &Region,
    is_loose: &[bool],
    active_ny: usize,
    standing_bits: &mut [u64],
    edge_bits: &mut [u64],
) -> (bool, bool) {
    let [nx, ny, nz] = r.size;
    let layer = nx * nz;
    let words_x = nx.div_ceil(64);
    let layer_words = words_x * nz;
    let rcells = &r.cells[..active_ny * layer];
    let mut any_edge_seed = false;
    let mut any_interior_standing = false;
    for y in 0..active_ny {
        let y_off = y * layer;
        let yw_off = y * layer_words;
        for z in 0..nz {
            let row = y_off + z * nx;
            let rw_off = yw_off + z * words_x;
            for wx in 0..words_x {
                let x0 = wx << 6;
                let x1 = (x0 + 64).min(nx);
                let mut s_word = 0u64;
                let mut x = x0;
                while x + 4 <= x1 {
                    let (c0, c1, c2, c3) = (rcells[row + x], rcells[row + x + 1], rcells[row + x + 2], rcells[row + x + 3]);
                    if (c0 | c1 | c2 | c3) != 0 {
                        let base = x - x0;
                        for (dx, k) in [(0usize, c0), (1, c1), (2, c2), (3, c3)] {
                            if k != 0 && !is_ground(k) && !is_loose[row + x + dx] {
                                s_word |= 1u64 << (base + dx);
                            }
                        }
                    }
                    x += 4;
                }
                while x < x1 {
                    let k = rcells[row + x];
                    if k != 0 && !is_ground(k) && !is_loose[row + x] {
                        s_word |= 1u64 << (x - x0);
                    }
                    x += 1;
                }
                let e_word = s_word & border_word_mask(nx, ny, nz, y, z, wx, words_x);
                standing_bits[rw_off + wx] = s_word;
                edge_bits[rw_off + wx] = e_word;
                if e_word != 0 {
                    any_edge_seed = true;
                }
                if (s_word & !e_word) != 0 {
                    any_interior_standing = true;
                }
            }
        }
    }
    if any_edge_seed && any_interior_standing {
        loop {
            let mut changed = false;
            for y in 0..active_ny {
                changed |= bit_reach_layer_raw(standing_bits, edge_bits, active_ny, nz, words_x, y, true);
            }
            for y in (0..active_ny).rev() {
                changed |= bit_reach_layer_raw(standing_bits, edge_bits, active_ny, nz, words_x, y, false);
            }
            if !changed {
                break;
            }
        }
    }
    (any_edge_seed, any_interior_standing)
}

/// Runs `topple` and optionally `adrift` sharing a single bit-parallel box-edge pruning pass.
fn topple_and_adrift_sync(r: &Region, shove: Option<([i32; 3], i32)>, is_loose: &mut [bool]) {
    let [nx, ny, nz] = r.size;
    let layer = nx * nz;
    let active_ny = active_layers(r);
    let active_n = active_ny * layer;
    if active_n == 0 {
        return;
    }
    let words_x = nx.div_ceil(64);
    let layer_words = words_x * nz;
    let total_words = layer_words * active_ny;
    let pack = nx <= 1024 && ny <= 4096 && nz <= 1024;
    let rcells = &r.cells[..active_n];

    SUPPORT_SCRATCH.with_borrow_mut(|s| {
        if s.standing_bits.len() < total_words { s.standing_bits.resize(total_words, 0); }
        if s.edge_bits.len() < total_words { s.edge_bits.resize(total_words, 0); }
        if s.seen_bits.len() < total_words { s.seen_bits.resize(total_words, 0); }
        let standing_bits = &mut s.standing_bits[..total_words];
        let edge_bits = &mut s.edge_bits[..total_words];
        let seen_bits = &mut s.seen_bits[..total_words];

        let (_, any_interior) = build_standing_and_edge_bits(r, is_loose, active_ny, standing_bits, edge_bits);
        if !any_interior {
            return;
        }

        let stack = &mut s.stack;
        let cells = &mut s.cells;
        let levels = &mut s.levels;
        let feet = &mut s.feet;

        // Pass 1: topple on non-edge freestanding components.
        seen_bits.fill(0);
        stack.clear();
        let mut any_freestanding = false;
        for y in 0..active_ny {
            let yw_off = y * layer_words;
            for z in 0..nz {
                let rw_off = yw_off + z * words_x;
                for wx in 0..words_x {
                    let w = rw_off + wx;
                    loop {
                        let cand = standing_bits[w] & !edge_bits[w] & !seen_bits[w];
                        if cand == 0 {
                            break;
                        }
                        any_freestanding = true;
                        let bit = cand.trailing_zeros() as usize;
                        seen_bits[w] |= 1u64 << bit;
                        let sx = (wx << 6) + bit;
                        let start = y * layer + z * nx + sx;
                        cells.clear();
                        levels.clear();
                        levels.resize(active_ny, (0.0, 0.0, 0.0, [usize::MAX; 2], [0; 2], 0.0));
                        feet.clear();
                        feet.resize(active_ny, ([usize::MAX; 2], [0; 2]));
                        stack.push(if pack { pack_xyz(sx, y, z) } else { start as u32 });
                        while let Some(raw) = stack.pop() {
                            let (x, cy, cz, i) = if pack {
                                let (x, cy, cz) = unpack_xyz(raw);
                                (x, cy, cz, x + nx * (cz + nz * cy))
                            } else {
                                let i = raw as usize;
                                let (x, cy, cz) = r.place(i);
                                (x, cy, cz, i)
                            };
                            cells.push(i as u32);
                            let stuff = material(rcells[i]);
                            let m = weighs(stuff) as f64;
                            let l = &mut levels[cy];
                            l.0 += m;
                            l.1 += m * (x as f64 + 0.5);
                            l.2 += m * (cz as f64 + 0.5);
                            l.3 = [l.3[0].min(x), l.3[1].min(cz)];
                            l.4 = [l.4[0].max(x), l.4[1].max(cz)];
                            l.5 = l.5.max(leans(stuff) as f64);
                            if cy > 0 && is_ground(rcells[i - layer]) {
                                let f = &mut feet[cy];
                                *f = ([f.0[0].min(x), f.0[1].min(cz)], [f.1[0].max(x), f.1[1].max(cz)]);
                            }
                            let mut join = |j: usize, nx_c: usize, ny_c: usize, nz_c: usize| {
                                let jw = ny_c * layer_words + nz_c * words_x + (nx_c >> 6);
                                let jbit = 1u64 << (nx_c & 63);
                                if (standing_bits[jw] & jbit) != 0 && (seen_bits[jw] & jbit) == 0 {
                                    seen_bits[jw] |= jbit;
                                    stack.push(if pack { pack_xyz(nx_c, ny_c, nz_c) } else { j as u32 });
                                }
                            };
                            if x > 0 { join(i - 1, x - 1, cy, cz) }
                            if x + 1 < nx { join(i + 1, x + 1, cy, cz) }
                            if cz > 0 { join(i - nx, x, cy, cz - 1) }
                            if cz + 1 < nz { join(i + nx, x, cy, cz + 1) }
                            if cy > 0 { join(i - layer, x, cy - 1, cz) }
                            if cy + 1 < active_ny { join(i + layer, x, cy + 1, cz) }
                        }
                        // From the top down, the weight at and above each level; the lowest level it is not over is where the thing goes.
                        let (mut mass, mut mx, mut mz) = (0.0f64, 0.0f64, 0.0f64);
                        let mut hinge: Option<usize> = None;
                        // Where it stands on the ground above the level asked about.
                        let (mut low, mut high) = ([usize::MAX; 2], [0usize; 2]);
                        for ly in (0..active_ny).rev() {
                            let l = &levels[ly];
                            if l.0 == 0.0 {
                                continue;
                            }
                            mass += l.0;
                            mx += l.1;
                            mz += l.2;
                            let (cx, cz_m) = (mx / mass, mz / mass);
                            let (lo, hi) = ([l.3[0].min(low[0]), l.3[1].min(low[1])], [l.4[0].max(high[0]), l.4[1].max(high[1])]);
                            if cx < lo[0] as f64 - l.5 || cx > hi[0] as f64 + 1.0 + l.5 || cz_m < lo[1] as f64 - l.5 || cz_m > hi[1] as f64 + 1.0 + l.5 {
                                hinge = Some(ly);
                            }
                            (low, high) = ([low[0].min(feet[ly].0[0]), low[1].min(feet[ly].0[1])], [high[0].max(feet[ly].1[0]), high[1].max(feet[ly].1[1])]);
                        }
                        if let Some(from) = hinge {
                            let min_idx = from * layer;
                            for &i in cells.iter() {
                                let iu = i as usize;
                                if iu >= min_idx {
                                    is_loose[iu] = true;
                                    let (cx, cy, cz) = r.place(iu);
                                    let cw = cy * layer_words + cz * words_x + (cx >> 6);
                                    standing_bits[cw] &= !(1u64 << (cx & 63));
                                }
                            }
                        }
                    }
                }
            }
        }

        // Pass 2: adrift on remaining non-edge freestanding components (reusing edge_bits).
        let Some((at, radius)) = shove else { return };
        if !any_freestanding {
            return;
        }
        let centre = [at[0] - r.low[0], at[1] - r.low[1], at[2] - r.low[2]];
        let reach = (2 * radius as i64).pow(2);
        seen_bits.fill(0);
        stack.clear();
        for y in 0..active_ny {
            let yw_off = y * layer_words;
            for z in 0..nz {
                let rw_off = yw_off + z * words_x;
                for wx in 0..words_x {
                    let w = rw_off + wx;
                    loop {
                        let cand = standing_bits[w] & !edge_bits[w] & !seen_bits[w];
                        if cand == 0 {
                            break;
                        }
                        let bit = cand.trailing_zeros() as usize;
                        seen_bits[w] |= 1u64 << bit;
                        let sx = (wx << 6) + bit;
                        let start = y * layer + z * nx + sx;
                        cells.clear();
                        let (mut hard, mut near) = (0usize, i64::MAX);
                        stack.push(if pack { pack_xyz(sx, y, z) } else { start as u32 });
                        while let Some(raw) = stack.pop() {
                            let (x, cy, cz, i) = if pack {
                                let (x, cy, cz) = unpack_xyz(raw);
                                (x, cy, cz, x + nx * (cz + nz * cy))
                            } else {
                                let i = raw as usize;
                                let (x, cy, cz) = r.place(i);
                                (x, cy, cz, i)
                            };
                            cells.push(i as u32);
                            hard += matches!(material(rcells[i]), STEEL | GLASS | LAMP) as usize;
                            near = near.min((x as i64 - centre[0] as i64).pow(2) + (cy as i64 - centre[1] as i64).pow(2) + (cz as i64 - centre[2] as i64).pow(2));
                            let mut join = |j: usize, nx_c: usize, ny_c: usize, nz_c: usize| {
                                let jw = ny_c * layer_words + nz_c * words_x + (nx_c >> 6);
                                let jbit = 1u64 << (nx_c & 63);
                                if (standing_bits[jw] & jbit) != 0 && (seen_bits[jw] & jbit) == 0 {
                                    seen_bits[jw] |= jbit;
                                    stack.push(if pack { pack_xyz(nx_c, ny_c, nz_c) } else { j as u32 });
                                }
                            };
                            if x > 0 { join(i - 1, x - 1, cy, cz) }
                            if x + 1 < nx { join(i + 1, x + 1, cy, cz) }
                            if cz > 0 { join(i - nx, x, cy, cz - 1) }
                            if cz + 1 < nz { join(i + nx, x, cy, cz + 1) }
                            if cy > 0 { join(i - layer, x, cy - 1, cz) }
                            if cy + 1 < active_ny { join(i + layer, x, cy + 1, cz) }
                        }
                        if near <= reach && cells.len() <= 20_000 && hard * 10 >= cells.len() * 7 {
                            for &i in cells.iter() {
                                is_loose[i as usize] = true;
                            }
                        }
                    }
                }
            }
        }
    });
}

/// Things that no longer stand over what they stand on. The reach rule cannot say this: a tank on two of its four
/// legs is still reached from the ground. So each thing that stands free in the box (cells that touch, not the
/// ground's, not reaching the box's sides or top) is asked, level by level from its foot up, where the weight of all
/// that is at and above that level lies. If the middle of that weight is further outside the stretch the thing
/// covers at that level than its material can lean (`leans`), everything from there up is loose, and goes over as
/// one body. Steel leans far, so a lamp holds its arm out; brick hardly at all. Where the thing stands on the ground
/// higher up as well (a car across a slope, its uphill wheels shorter), that footing is part of the stretch below.
pub fn topple(r: &Region, is_loose: &mut [bool]) {
    topple_and_adrift_sync(r, None, is_loose);
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
    topple_and_adrift_sync(r, shove, &mut is_loose);
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
    let unheld = loose_inner(r, Some((&blocks.count, blocks.by)), false).0;
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
    let pieces = SUPPORT_SCRATCH.with_borrow_mut(|s| pieces_of(r, is_loose, &mut s.seen_bits, edged));
    let (mut out, mut dust) = (Vec::new(), Vec::new());
    for mut cells in pieces {
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
    let layer = nx * nz;
    let active_ny = active_layers(r);
    let active_n = active_ny * layer;
    if active_n == 0 {
        return;
    }
    let words_x = nx.div_ceil(64);
    let layer_words = words_x * nz;
    let total_words = layer_words * active_ny;
    let pack = nx <= 1024 && ny <= 4096 && nz <= 1024;
    let centre = [at[0] - r.low[0], at[1] - r.low[1], at[2] - r.low[2]];
    let reach = (2 * radius as i64).pow(2);
    let rcells = &r.cells[..active_n];
    SUPPORT_SCRATCH.with_borrow_mut(|s| {
        if s.standing_bits.len() < total_words { s.standing_bits.resize(total_words, 0); }
        if s.edge_bits.len() < total_words { s.edge_bits.resize(total_words, 0); }
        if s.seen_bits.len() < total_words { s.seen_bits.resize(total_words, 0); }
        let standing_bits = &mut s.standing_bits[..total_words];
        let edge_bits = &mut s.edge_bits[..total_words];
        let seen_bits = &mut s.seen_bits[..total_words];

        let (_, any_interior) = build_standing_and_edge_bits(r, is_loose, active_ny, standing_bits, edge_bits);
        if !any_interior {
            return;
        }
        seen_bits.fill(0);
        let stack = &mut s.stack;
        let cells = &mut s.cells;
        stack.clear();
        for y in 0..active_ny {
            let yw_off = y * layer_words;
            for z in 0..nz {
                let rw_off = yw_off + z * words_x;
                for wx in 0..words_x {
                    let w = rw_off + wx;
                    loop {
                        let cand = standing_bits[w] & !edge_bits[w] & !seen_bits[w];
                        if cand == 0 {
                            break;
                        }
                        let bit = cand.trailing_zeros() as usize;
                        seen_bits[w] |= 1u64 << bit;
                        let sx = (wx << 6) + bit;
                        let start = y * layer + z * nx + sx;
                        cells.clear();
                        let (mut hard, mut near) = (0usize, i64::MAX);
                        stack.push(if pack { pack_xyz(sx, y, z) } else { start as u32 });
                        while let Some(raw) = stack.pop() {
                            let (x, cy, cz, i) = if pack {
                                let (x, cy, cz) = unpack_xyz(raw);
                                (x, cy, cz, x + nx * (cz + nz * cy))
                            } else {
                                let i = raw as usize;
                                let (x, cy, cz) = r.place(i);
                                (x, cy, cz, i)
                            };
                            cells.push(i as u32);
                            hard += matches!(material(rcells[i]), STEEL | GLASS | LAMP) as usize;
                            near = near.min((x as i64 - centre[0] as i64).pow(2) + (cy as i64 - centre[1] as i64).pow(2) + (cz as i64 - centre[2] as i64).pow(2));
                            let mut join = |j: usize, nx_c: usize, ny_c: usize, nz_c: usize| {
                                let jw = ny_c * layer_words + nz_c * words_x + (nx_c >> 6);
                                let jbit = 1u64 << (nx_c & 63);
                                if (standing_bits[jw] & jbit) != 0 && (seen_bits[jw] & jbit) == 0 {
                                    seen_bits[jw] |= jbit;
                                    stack.push(if pack { pack_xyz(nx_c, ny_c, nz_c) } else { j as u32 });
                                }
                            };
                            if x > 0 { join(i - 1, x - 1, cy, cz) }
                            if x + 1 < nx { join(i + 1, x + 1, cy, cz) }
                            if cz > 0 { join(i - nx, x, cy, cz - 1) }
                            if cz + 1 < nz { join(i + nx, x, cy, cz + 1) }
                            if cy > 0 { join(i - layer, x, cy - 1, cz) }
                            if cy + 1 < active_ny { join(i + layer, x, cy + 1, cz) }
                        }
                        if near <= reach && cells.len() <= 20_000 && hard * 10 >= cells.len() * 7 {
                            for &i in cells.iter() {
                                is_loose[i as usize] = true;
                            }
                        }
                    }
                }
            }
        }
    });
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SupportPhase {
    SeedPack,
    SeedFrontier,
    Propagate,
    LoadAccum,
    LoadTear,
    MarkUnreached,
    ToppleEdgeFill,
    ToppleScan,
    AdriftScan,
    ExtractPieces,
    Done,
}

/// Incremental, time-sliced support solver producing bit-exact results identical to [`release`].
///
/// Advances through `Seed` -> `Propagate` -> `LoadAndTear` -> `ToppleAndAdrift` -> `ExtractPieces`
/// -> `Done` in bounded work budgets via [`SupportJob::step`].
pub struct SupportJob {
    region: Region,
    shove: Option<([i32; 3], i32)>,
    active_ny: usize,
    active_n: usize,
    words_x: usize,
    layer_words: usize,
    total_words: usize,
    pack: bool,
    phase: SupportPhase,

    solid_bits: Vec<u64>,
    ground_bits: Vec<u64>,
    built_bits: Vec<u64>,
    non_vert_built_bits: Vec<u64>,
    non_ground_bits: Vec<u64>,
    loose_bits: Vec<u64>,
    standing_bits: Vec<u64>,
    edge_bits: Vec<u64>,
    seen_bits: Vec<u64>,
    vert_prev: Vec<u64>,

    cost_enc: Vec<u8>,
    join: Vec<u8>,
    load: Vec<u32>,
    order: Vec<u32>,
    waiting: Vec<Vec<u32>>,

    seed_y: usize,
    seed_z: usize,
    any_built: bool,
    all_vert_supported: bool,
    built_count: usize,

    frontier_word: usize,
    frontier_y: usize,
    frontier_z: usize,
    frontier_wx: usize,
    frontier_count: usize,

    cur_cost: usize,
    cur_k: usize,
    load_idx: usize,
    tear_idx: usize,

    mark_word: usize,
    mark_y: usize,
    mark_z: usize,
    mark_wx: usize,
    any_loose: bool,

    edge_init_word: usize,
    edge_init_y: usize,
    edge_init_z: usize,
    edge_init_wx: usize,
    edge_init_done: bool,
    any_edge_seed: bool,
    any_interior_standing: bool,
    edge_fill_y: usize,
    edge_fill_forward: bool,
    edge_fill_changed: bool,
    edge_fill_layers_done: usize,

    scan_word: usize,
    scan_y: usize,
    scan_z: usize,
    scan_wx: usize,
    in_component: bool,
    any_freestanding: bool,
    stack: Vec<u32>,
    comp_cells: Vec<u32>,
    comp_edge: bool,
    levels: Vec<(f64, f64, f64, [usize; 2], [usize; 2], f64)>,
    feet: Vec<([usize; 2], [usize; 2])>,
    adrift_hard: usize,
    adrift_near: i64,

    pieces: Vec<Loose>,
    dust: Vec<Run>,
}

impl SupportJob {
    /// Creates a new incremental support job for `region` with optional blast `shove` `(centre, radius)`.
    pub fn new(region: Region, shove: Option<([i32; 3], i32)>) -> Self {
        let [nx, ny, nz] = region.size;
        let layer = nx * nz;
        let active_ny = active_layers(&region);
        let active_n = active_ny * layer;
        let words_x = nx.div_ceil(64);
        let layer_words = words_x * nz;
        let total_words = layer_words * active_ny;
        let pack = nx <= 1024 && ny <= 4096 && nz <= 1024;
        let phase = if active_n == 0 { SupportPhase::Done } else { SupportPhase::SeedPack };
        SupportJob {
            region,
            shove,
            active_ny,
            active_n,
            words_x,
            layer_words,
            total_words,
            pack,
            phase,
            solid_bits: vec![0u64; total_words],
            ground_bits: vec![0u64; total_words],
            built_bits: vec![0u64; total_words],
            non_vert_built_bits: vec![0u64; total_words],
            non_ground_bits: vec![0u64; total_words],
            loose_bits: vec![0u64; total_words],
            standing_bits: Vec::new(),
            edge_bits: Vec::new(),
            seen_bits: Vec::new(),
            vert_prev: vec![0u64; layer_words],
            cost_enc: Vec::new(),
            join: Vec::new(),
            load: Vec::new(),
            order: Vec::new(),
            waiting: if active_n == 0 { Vec::new() } else { vec![Vec::new(); 256] },
            seed_y: 0,
            seed_z: 0,
            any_built: false,
            all_vert_supported: true,
            built_count: 0,
            frontier_word: 0,
            frontier_y: 0,
            frontier_z: 0,
            frontier_wx: 0,
            frontier_count: 0,
            cur_cost: 0,
            cur_k: 0,
            load_idx: 0,
            tear_idx: 0,
            mark_word: 0,
            mark_y: 0,
            mark_z: 0,
            mark_wx: 0,
            any_loose: false,
            edge_init_word: 0,
            edge_init_y: 0,
            edge_init_z: 0,
            edge_init_wx: 0,
            edge_init_done: false,
            any_edge_seed: false,
            any_interior_standing: false,
            edge_fill_y: 0,
            edge_fill_forward: true,
            edge_fill_changed: false,
            edge_fill_layers_done: 0,
            scan_word: 0,
            scan_y: 0,
            scan_z: 0,
            scan_wx: 0,
            in_component: false,
            any_freestanding: false,
            stack: Vec::new(),
            comp_cells: Vec::new(),
            comp_edge: false,
            levels: Vec::new(),
            feet: Vec::new(),
            adrift_hard: 0,
            adrift_near: i64::MAX,
            pieces: Vec::new(),
            dust: Vec::new(),
        }
    }

    #[inline]
    fn advance_word_cursor(word: &mut usize, y: &mut usize, z: &mut usize, wx: &mut usize, words_x: usize, nz: usize) {
        *word += 1;
        *wx += 1;
        if *wx == words_x {
            *wx = 0;
            *z += 1;
            if *z == nz {
                *z = 0;
                *y += 1;
            }
        }
    }

    fn prepare_topple_edge_fill(&mut self) {
        self.standing_bits.resize(self.total_words, 0);
        self.edge_bits.resize(self.total_words, 0);
        self.edge_init_word = 0;
        self.edge_init_y = 0;
        self.edge_init_z = 0;
        self.edge_init_wx = 0;
        self.edge_init_done = false;
        self.any_edge_seed = false;
        self.any_interior_standing = false;
        self.edge_fill_layers_done = 0;
        self.phase = SupportPhase::ToppleEdgeFill;
    }

    fn prepare_topple_scan(&mut self) {
        if self.seen_bits.len() < self.total_words {
            self.seen_bits.resize(self.total_words, 0);
        } else {
            self.seen_bits[..self.total_words].fill(0);
        }
        self.scan_word = 0;
        self.scan_y = 0;
        self.scan_z = 0;
        self.scan_wx = 0;
        self.in_component = false;
        self.any_freestanding = false;
        self.stack.clear();
        self.comp_cells.clear();
        self.phase = SupportPhase::ToppleScan;
    }

    fn prepare_extract_pieces(&mut self) {
        if !self.any_loose {
            self.phase = SupportPhase::Done;
            return;
        }
        if self.seen_bits.len() < self.total_words {
            self.seen_bits.resize(self.total_words, 0);
        } else {
            self.seen_bits[..self.total_words].fill(0);
        }
        self.scan_word = 0;
        self.scan_y = 0;
        self.scan_z = 0;
        self.scan_wx = 0;
        self.in_component = false;
        self.stack.clear();
        self.comp_cells.clear();
        self.phase = SupportPhase::ExtractPieces;
    }

    /// Advances the job by at most `budget_ops` work units. Returns `true` when finished.
    pub fn step(&mut self, budget_ops: usize) -> bool {
        if self.phase == SupportPhase::Done {
            return true;
        }
        let mut remaining = budget_ops.max(1);
        let [nx, ny, nz] = self.region.size;
        let layer = nx * nz;
        let words_x = self.words_x;
        let layer_words = self.layer_words;
        let active_ny = self.active_ny;
        let pack = self.pack;

        while remaining > 0 && self.phase != SupportPhase::Done {
            match self.phase {
                SupportPhase::SeedPack => {
                    let row_cost = nx.div_ceil(8).max(1);
                    while self.seed_y < active_ny && remaining > 0 {
                        let y = self.seed_y;
                        let z = self.seed_z;
                        let yz_edge = y == 0 || z == 0 || z + 1 == nz;
                        let row = y * layer + z * nx;
                        let rw = z * words_x;
                        let yw_off = y * layer_words;
                        let w_off = yw_off + rw;
                        let (ab, av, bc) = if y == 0 {
                            pack_row_bits(
                                &self.region.cells[row..row + nx],
                                nx,
                                true,
                                None,
                                &mut self.vert_prev[rw..rw + words_x],
                                &mut self.solid_bits[w_off..w_off + words_x],
                                &mut self.ground_bits[w_off..w_off + words_x],
                                &mut self.built_bits[w_off..w_off + words_x],
                                &mut self.non_vert_built_bits[w_off..w_off + words_x],
                                Some(&mut self.non_ground_bits[w_off..w_off + words_x]),
                            )
                        } else {
                            let (prev_g, cur_g) = self.ground_bits.split_at_mut(yw_off);
                            let prev_row_g = &prev_g[yw_off - layer_words + rw..yw_off - layer_words + rw + words_x];
                            pack_row_bits(
                                &self.region.cells[row..row + nx],
                                nx,
                                yz_edge,
                                Some(prev_row_g),
                                &mut self.vert_prev[rw..rw + words_x],
                                &mut self.solid_bits[w_off..w_off + words_x],
                                &mut cur_g[rw..rw + words_x],
                                &mut self.built_bits[w_off..w_off + words_x],
                                &mut self.non_vert_built_bits[w_off..w_off + words_x],
                                Some(&mut self.non_ground_bits[w_off..w_off + words_x]),
                            )
                        };
                        self.any_built |= ab;
                        self.all_vert_supported &= av;
                        self.built_count += bc;
                        remaining = remaining.saturating_sub(row_cost);
                        self.seed_z += 1;
                        if self.seed_z == nz {
                            self.seed_z = 0;
                            self.seed_y += 1;
                        }
                    }
                    if self.seed_y == active_ny {
                        if !self.any_built {
                            self.phase = SupportPhase::Done;
                        } else if self.all_vert_supported && active_ny <= MIN_BEARS {
                            self.prepare_topple_edge_fill();
                        } else {
                            self.cost_enc.resize(self.active_n, 0);
                            self.join.resize(self.active_n, NONE);
                            self.frontier_word = 0;
                            self.frontier_y = 0;
                            self.frontier_z = 0;
                            self.frontier_wx = 0;
                            self.frontier_count = 0;
                            self.phase = SupportPhase::SeedFrontier;
                        }
                    }
                }
                SupportPhase::SeedFrontier => {
                    while self.frontier_word < self.total_words && remaining > 0 {
                        let idx = self.frontier_word;
                        let y = self.frontier_y;
                        let z = self.frontier_z;
                        let wx = self.frontier_wx;
                        let mut seeds = frontier_seed_mask(
                            &self.ground_bits,
                            &self.built_bits,
                            active_ny,
                            nz,
                            words_x,
                            layer_words,
                            y,
                            z,
                            wx,
                            idx,
                        );
                        remaining = remaining.saturating_sub(1);
                        if seeds != 0 {
                            let row = y * layer + z * nx;
                            let x_base = wx << 6;
                            while seeds != 0 {
                                let bit = seeds.trailing_zeros() as usize;
                                seeds &= seeds - 1;
                                let x = x_base + bit;
                                let i = row + x;
                                self.cost_enc[i] = 1; // cost 0
                                self.join[i] = GROUND;
                                self.waiting[0].push(if pack { pack_xyz(x, y, z) } else { i as u32 });
                                self.frontier_count += 1;
                                remaining = remaining.saturating_sub(1);
                            }
                        }
                        Self::advance_word_cursor(&mut self.frontier_word, &mut self.frontier_y, &mut self.frontier_z, &mut self.frontier_wx, words_x, nz);
                    }
                    if self.frontier_word == self.total_words {
                        if self.waiting[0].is_empty() {
                            self.mark_word = 0;
                            self.mark_y = 0;
                            self.mark_z = 0;
                            self.mark_wx = 0;
                            self.phase = SupportPhase::MarkUnreached;
                        } else {
                            self.cur_cost = 0;
                            self.cur_k = 0;
                            self.phase = SupportPhase::Propagate;
                        }
                    }
                }
                SupportPhase::Propagate => {
                    while self.cur_cost < 255 && remaining > 0 {
                        if self.cur_k >= self.waiting[self.cur_cost].len() {
                            self.waiting[self.cur_cost].clear();
                            self.cur_cost += 1;
                            self.cur_k = 0;
                            continue;
                        }
                        let c = self.cur_cost;
                        let c_enc = (c + 1) as u8;
                        let raw = self.waiting[c][self.cur_k];
                        self.cur_k += 1;
                        remaining = remaining.saturating_sub(3);

                        let (x, y, z, i) = if pack {
                            let (x, y, z) = unpack_xyz(raw);
                            (x, y, z, x + nx * (z + nz * y))
                        } else {
                            let i = raw as usize;
                            let (x, y, z) = self.region.place(i);
                            (x, y, z, i)
                        };
                        if self.cost_enc[i] != c_enc {
                            continue;
                        }
                        if self.join[i] & 128 != 0 {
                            continue;
                        }
                        self.join[i] |= 128;
                        self.order.push(i as u32);
                        let src_kind = self.region.cells[i];
                        let src_rubble = rubble(src_kind);
                        let src_leaves = material(src_kind) == LEAVES;
                        let cells = &self.region.cells;
                        let built_bits = &self.built_bits;
                        let non_vert_built_bits = &self.non_vert_built_bits;
                        let cost_enc = &mut self.cost_enc;
                        let join = &mut self.join;
                        let waiting = &mut self.waiting;
                        let mut reach = |j: usize, nx_c: usize, ny_c: usize, nz_c: usize, more: usize, how: u8| {
                            let bw = ny_c * layer_words + nz_c * words_x + (nx_c >> 6);
                            let mask_bits = if more != 0 { non_vert_built_bits } else { built_bits };
                            if (mask_bits[bw] & (1u64 << (nx_c & 63))) == 0 {
                                return;
                            }
                            let kind = cells[j];
                            let to = c + more;
                            if to >= cost_enc[j].wrapping_sub(1) as usize || to > spans(material(kind)) as usize {
                                return;
                            }
                            if more != 0 && (rubble(kind) || src_rubble) {
                                return;
                            }
                            if more != 0 && (material(kind) == LEAVES) != src_leaves {
                                return;
                            }
                            cost_enc[j] = (to + 1) as u8;
                            join[j] = how;
                            let entry = if pack { pack_xyz(nx_c, ny_c, nz_c) } else { j as u32 };
                            waiting[to].push(entry);
                        };
                        if y + 1 < active_ny { reach(i + layer, x, y + 1, z, 0, RESTS) }
                        if x > 0 { reach(i - 1, x - 1, y, z, 1, LEANS + 1) }
                        if x + 1 < nx { reach(i + 1, x + 1, y, z, 1, LEANS) }
                        if z > 0 { reach(i - nx, x, y, z - 1, 1, LEANS + 3) }
                        if z + 1 < nz { reach(i + nx, x, y, z + 1, 1, LEANS + 2) }
                        if y > 0 { reach(i - layer, x, y - 1, z, 2, HANGS) }
                    }
                    if self.cur_cost == 255 {
                        self.load.resize(self.active_n, 0);
                        self.load_idx = self.order.len();
                        self.phase = SupportPhase::LoadAccum;
                    }
                }
                SupportPhase::LoadAccum => {
                    while self.load_idx > 0 && remaining > 0 {
                        self.load_idx -= 1;
                        remaining -= 1;
                        let i = self.order[self.load_idx] as usize;
                        self.load[i] += 1;
                        let how = self.join[i] & 127;
                        if how != GROUND {
                            let h = holder_of(i, how, nx, layer);
                            self.load[h] += self.load[i];
                        }
                    }
                    if self.load_idx == 0 {
                        self.tear_idx = 0;
                        self.phase = SupportPhase::LoadTear;
                    }
                }
                SupportPhase::LoadTear => {
                    while self.tear_idx < self.order.len() && remaining > 0 {
                        let i = self.order[self.tear_idx] as usize;
                        self.tear_idx += 1;
                        remaining -= 1;
                        let how = self.join[i] & 127;
                        if how == GROUND {
                            continue;
                        }
                        let h = holder_of(i, how, nx, layer);
                        let over = if how == RESTS {
                            self.load[i] > bears(material(self.region.cells[h]))
                        } else {
                            self.load[i] > join_carries(material(self.region.cells[i]), material(self.region.cells[h]))
                        };
                        let h_loose = if !over && self.any_loose {
                            let (hx, hy, hz) = self.region.place(h);
                            (self.loose_bits[hy * layer_words + hz * words_x + (hx >> 6)] & (1u64 << (hx & 63))) != 0
                        } else {
                            false
                        };
                        if over || h_loose {
                            let (ix, iy, iz) = self.region.place(i);
                            self.loose_bits[iy * layer_words + iz * words_x + (ix >> 6)] |= 1u64 << (ix & 63);
                            self.any_loose = true;
                        }
                    }
                    if self.tear_idx == self.order.len() {
                        self.mark_word = 0;
                        self.mark_y = 0;
                        self.mark_z = 0;
                        self.mark_wx = 0;
                        self.phase = SupportPhase::MarkUnreached;
                    }
                }
                SupportPhase::MarkUnreached => {
                    while self.mark_word < self.total_words && remaining > 0 {
                        let w = self.mark_word;
                        let mut b = self.built_bits[w];
                        remaining = remaining.saturating_sub(1);
                        if b != 0 {
                            if self.cost_enc.is_empty() {
                                self.loose_bits[w] |= b;
                                self.any_loose = true;
                            } else {
                                let base = self.mark_y * layer + self.mark_z * nx + (self.mark_wx << 6);
                                let mut unreached = 0u64;
                                while b != 0 {
                                    let bit = b.trailing_zeros() as usize;
                                    b &= b - 1;
                                    if self.cost_enc[base + bit] == 0 {
                                        unreached |= 1u64 << bit;
                                    }
                                    remaining = remaining.saturating_sub(1);
                                }
                                if unreached != 0 {
                                    self.loose_bits[w] |= unreached;
                                    self.any_loose = true;
                                }
                            }
                        }
                        Self::advance_word_cursor(&mut self.mark_word, &mut self.mark_y, &mut self.mark_z, &mut self.mark_wx, words_x, nz);
                    }
                    if self.mark_word == self.total_words {
                        self.prepare_topple_edge_fill();
                    }
                }
                SupportPhase::ToppleEdgeFill => {
                    if !self.edge_init_done {
                        while self.edge_init_word < self.total_words && remaining > 0 {
                            let w = self.edge_init_word;
                            let s = self.non_ground_bits[w] & !self.loose_bits[w];
                            let e = s & border_word_mask(nx, ny, nz, self.edge_init_y, self.edge_init_z, self.edge_init_wx, words_x);
                            self.standing_bits[w] = s;
                            self.edge_bits[w] = e;
                            if e != 0 {
                                self.any_edge_seed = true;
                            }
                            if (s & !e) != 0 {
                                self.any_interior_standing = true;
                            }
                            remaining -= 1;
                            Self::advance_word_cursor(&mut self.edge_init_word, &mut self.edge_init_y, &mut self.edge_init_z, &mut self.edge_init_wx, words_x, nz);
                        }
                        if self.edge_init_word == self.total_words {
                            self.edge_init_done = true;
                            if !self.any_interior_standing {
                                self.prepare_extract_pieces();
                            } else if !self.any_edge_seed {
                                self.prepare_topple_scan();
                            } else {
                                self.edge_fill_y = 0;
                                self.edge_fill_forward = true;
                                self.edge_fill_changed = false;
                            }
                        }
                    } else {
                        let layer_cost = layer_words.max(1);
                        while remaining > 0 && self.phase == SupportPhase::ToppleEdgeFill {
                            if self.edge_fill_forward {
                                self.edge_fill_changed |= bit_reach_layer_raw(&self.standing_bits, &mut self.edge_bits, active_ny, nz, words_x, self.edge_fill_y, true);
                                self.edge_fill_y += 1;
                                if self.edge_fill_y == active_ny {
                                    self.edge_fill_forward = false;
                                }
                            } else {
                                self.edge_fill_y -= 1;
                                self.edge_fill_changed |= bit_reach_layer_raw(&self.standing_bits, &mut self.edge_bits, active_ny, nz, words_x, self.edge_fill_y, false);
                                if self.edge_fill_y == 0 {
                                    if self.edge_fill_changed {
                                        self.edge_fill_changed = false;
                                        self.edge_fill_forward = true;
                                    } else {
                                        self.prepare_topple_scan();
                                    }
                                }
                            }
                            self.edge_fill_layers_done += 1;
                            remaining = remaining.saturating_sub(layer_cost);
                        }
                    }
                }
                SupportPhase::ToppleScan => {
                    while remaining > 0 {
                        if !self.in_component {
                            if self.scan_word >= self.total_words {
                                if self.shove.is_some() && self.any_freestanding {
                                    self.seen_bits[..self.total_words].fill(0);
                                    self.scan_word = 0;
                                    self.scan_y = 0;
                                    self.scan_z = 0;
                                    self.scan_wx = 0;
                                    self.in_component = false;
                                    self.stack.clear();
                                    self.comp_cells.clear();
                                    self.phase = SupportPhase::AdriftScan;
                                } else {
                                    self.prepare_extract_pieces();
                                }
                                break;
                            }
                            let w = self.scan_word;
                            let cand = self.standing_bits[w] & !self.edge_bits[w] & !self.seen_bits[w];
                            if cand == 0 {
                                remaining -= 1;
                                Self::advance_word_cursor(&mut self.scan_word, &mut self.scan_y, &mut self.scan_z, &mut self.scan_wx, words_x, nz);
                                continue;
                            }
                            self.any_freestanding = true;
                            let bit = cand.trailing_zeros() as usize;
                            self.seen_bits[w] |= 1u64 << bit;
                            let sx = (self.scan_wx << 6) + bit;
                            let start = self.scan_y * layer + self.scan_z * nx + sx;
                            self.comp_cells.clear();
                            self.levels.clear();
                            self.levels.resize(active_ny, (0.0, 0.0, 0.0, [usize::MAX; 2], [0; 2], 0.0));
                            self.feet.clear();
                            self.feet.resize(active_ny, ([usize::MAX; 2], [0; 2]));
                            self.stack.clear();
                            self.stack.push(if pack { pack_xyz(sx, self.scan_y, self.scan_z) } else { start as u32 });
                            self.in_component = true;
                        }
                        while let Some(raw) = self.stack.pop() {
                            remaining = remaining.saturating_sub(2);
                            let (x, cy, cz, i) = if pack {
                                let (x, cy, cz) = unpack_xyz(raw);
                                (x, cy, cz, x + nx * (cz + nz * cy))
                            } else {
                                let i = raw as usize;
                                let (x, cy, cz) = self.region.place(i);
                                (x, cy, cz, i)
                            };
                            self.comp_cells.push(i as u32);
                            let stuff = material(self.region.cells[i]);
                            let m = weighs(stuff) as f64;
                            let l = &mut self.levels[cy];
                            l.0 += m;
                            l.1 += m * (x as f64 + 0.5);
                            l.2 += m * (cz as f64 + 0.5);
                            l.3 = [l.3[0].min(x), l.3[1].min(cz)];
                            l.4 = [l.4[0].max(x), l.4[1].max(cz)];
                            l.5 = l.5.max(leans(stuff) as f64);
                            if cy > 0 && is_ground(self.region.cells[i - layer]) {
                                let f = &mut self.feet[cy];
                                *f = ([f.0[0].min(x), f.0[1].min(cz)], [f.1[0].max(x), f.1[1].max(cz)]);
                            }
                            let standing_bits = &self.standing_bits;
                            let seen_bits = &mut self.seen_bits;
                            let stack = &mut self.stack;
                            let mut join = |j: usize, nx_c: usize, ny_c: usize, nz_c: usize| {
                                let jw = ny_c * layer_words + nz_c * words_x + (nx_c >> 6);
                                let jbit = 1u64 << (nx_c & 63);
                                if (standing_bits[jw] & jbit) != 0 && (seen_bits[jw] & jbit) == 0 {
                                    seen_bits[jw] |= jbit;
                                    stack.push(if pack { pack_xyz(nx_c, ny_c, nz_c) } else { j as u32 });
                                }
                            };
                            if x > 0 { join(i - 1, x - 1, cy, cz) }
                            if x + 1 < nx { join(i + 1, x + 1, cy, cz) }
                            if cz > 0 { join(i - nx, x, cy, cz - 1) }
                            if cz + 1 < nz { join(i + nx, x, cy, cz + 1) }
                            if cy > 0 { join(i - layer, x, cy - 1, cz) }
                            if cy + 1 < active_ny { join(i + layer, x, cy + 1, cz) }
                            if remaining == 0 {
                                break;
                            }
                        }
                        if self.stack.is_empty() {
                            let (mut mass, mut mx, mut mz) = (0.0f64, 0.0f64, 0.0f64);
                            let mut hinge: Option<usize> = None;
                            let (mut low, mut high) = ([usize::MAX; 2], [0usize; 2]);
                            for ly in (0..active_ny).rev() {
                                let l = &self.levels[ly];
                                if l.0 == 0.0 {
                                    continue;
                                }
                                mass += l.0;
                                mx += l.1;
                                mz += l.2;
                                let (cx, cz_m) = (mx / mass, mz / mass);
                                let (lo, hi) = ([l.3[0].min(low[0]), l.3[1].min(low[1])], [l.4[0].max(high[0]), l.4[1].max(high[1])]);
                                if cx < lo[0] as f64 - l.5 || cx > hi[0] as f64 + 1.0 + l.5 || cz_m < lo[1] as f64 - l.5 || cz_m > hi[1] as f64 + 1.0 + l.5 {
                                    hinge = Some(ly);
                                }
                                (low, high) = ([low[0].min(self.feet[ly].0[0]), low[1].min(self.feet[ly].0[1])], [high[0].max(self.feet[ly].1[0]), high[1].max(self.feet[ly].1[1])]);
                            }
                            if let Some(from) = hinge {
                                let min_idx = from * layer;
                                for &i in self.comp_cells.iter() {
                                    let iu = i as usize;
                                    if iu >= min_idx {
                                        let (cx, cy, cz) = self.region.place(iu);
                                        let cw = cy * layer_words + cz * words_x + (cx >> 6);
                                        let cbit = 1u64 << (cx & 63);
                                        self.loose_bits[cw] |= cbit;
                                        self.standing_bits[cw] &= !cbit;
                                        self.any_loose = true;
                                    }
                                }
                            }
                            self.in_component = false;
                        }
                    }
                }
                SupportPhase::AdriftScan => {
                    let Some((at, radius)) = self.shove else {
                        self.prepare_extract_pieces();
                        continue;
                    };
                    let centre = [at[0] - self.region.low[0], at[1] - self.region.low[1], at[2] - self.region.low[2]];
                    let reach = (2 * radius as i64).pow(2);
                    while remaining > 0 {
                        if !self.in_component {
                            if self.scan_word >= self.total_words {
                                self.prepare_extract_pieces();
                                break;
                            }
                            let w = self.scan_word;
                            let cand = self.standing_bits[w] & !self.edge_bits[w] & !self.seen_bits[w];
                            if cand == 0 {
                                remaining -= 1;
                                Self::advance_word_cursor(&mut self.scan_word, &mut self.scan_y, &mut self.scan_z, &mut self.scan_wx, words_x, nz);
                                continue;
                            }
                            let bit = cand.trailing_zeros() as usize;
                            self.seen_bits[w] |= 1u64 << bit;
                            let sx = (self.scan_wx << 6) + bit;
                            let start = self.scan_y * layer + self.scan_z * nx + sx;
                            self.comp_cells.clear();
                            self.adrift_hard = 0;
                            self.adrift_near = i64::MAX;
                            self.stack.clear();
                            self.stack.push(if pack { pack_xyz(sx, self.scan_y, self.scan_z) } else { start as u32 });
                            self.in_component = true;
                        }
                        while let Some(raw) = self.stack.pop() {
                            remaining = remaining.saturating_sub(2);
                            let (x, cy, cz, i) = if pack {
                                let (x, cy, cz) = unpack_xyz(raw);
                                (x, cy, cz, x + nx * (cz + nz * cy))
                            } else {
                                let i = raw as usize;
                                let (x, cy, cz) = self.region.place(i);
                                (x, cy, cz, i)
                            };
                            self.comp_cells.push(i as u32);
                            self.adrift_hard += matches!(material(self.region.cells[i]), STEEL | GLASS | LAMP) as usize;
                            self.adrift_near = self.adrift_near.min(
                                (x as i64 - centre[0] as i64).pow(2)
                                    + (cy as i64 - centre[1] as i64).pow(2)
                                    + (cz as i64 - centre[2] as i64).pow(2),
                            );
                            let standing_bits = &self.standing_bits;
                            let seen_bits = &mut self.seen_bits;
                            let stack = &mut self.stack;
                            let mut join = |j: usize, nx_c: usize, ny_c: usize, nz_c: usize| {
                                let jw = ny_c * layer_words + nz_c * words_x + (nx_c >> 6);
                                let jbit = 1u64 << (nx_c & 63);
                                if (standing_bits[jw] & jbit) != 0 && (seen_bits[jw] & jbit) == 0 {
                                    seen_bits[jw] |= jbit;
                                    stack.push(if pack { pack_xyz(nx_c, ny_c, nz_c) } else { j as u32 });
                                }
                            };
                            if x > 0 { join(i - 1, x - 1, cy, cz) }
                            if x + 1 < nx { join(i + 1, x + 1, cy, cz) }
                            if cz > 0 { join(i - nx, x, cy, cz - 1) }
                            if cz + 1 < nz { join(i + nx, x, cy, cz + 1) }
                            if cy > 0 { join(i - layer, x, cy - 1, cz) }
                            if cy + 1 < active_ny { join(i + layer, x, cy + 1, cz) }
                            if remaining == 0 {
                                break;
                            }
                        }
                        if self.stack.is_empty() {
                            if self.adrift_near <= reach && self.comp_cells.len() <= 20_000 && self.adrift_hard * 10 >= self.comp_cells.len() * 7 {
                                for &i in self.comp_cells.iter() {
                                    let (cx, cy, cz) = self.region.place(i as usize);
                                    let cw = cy * layer_words + cz * words_x + (cx >> 6);
                                    self.loose_bits[cw] |= 1u64 << (cx & 63);
                                    self.any_loose = true;
                                }
                            }
                            self.in_component = false;
                        }
                    }
                }
                SupportPhase::ExtractPieces => {
                    while remaining > 0 {
                        if !self.in_component {
                            if self.scan_word >= self.total_words {
                                self.phase = SupportPhase::Done;
                                break;
                            }
                            let w = self.scan_word;
                            let cand = self.loose_bits[w] & !self.seen_bits[w];
                            if cand == 0 {
                                remaining -= 1;
                                Self::advance_word_cursor(&mut self.scan_word, &mut self.scan_y, &mut self.scan_z, &mut self.scan_wx, words_x, nz);
                                continue;
                            }
                            let bit = cand.trailing_zeros() as usize;
                            self.seen_bits[w] |= 1u64 << bit;
                            let sx = (self.scan_wx << 6) + bit;
                            let start = self.scan_y * layer + self.scan_z * nx + sx;
                            self.comp_cells.clear();
                            self.comp_edge = false;
                            self.stack.clear();
                            self.stack.push(if pack { pack_xyz(sx, self.scan_y, self.scan_z) } else { start as u32 });
                            self.in_component = true;
                        }
                        while let Some(raw) = self.stack.pop() {
                            remaining = remaining.saturating_sub(2);
                            let (x, cy, cz, i) = if pack {
                                let (x, cy, cz) = unpack_xyz(raw);
                                (x, cy, cz, x + nx * (cz + nz * cy))
                            } else {
                                let i = raw as usize;
                                let (x, cy, cz) = self.region.place(i);
                                (x, cy, cz, i)
                            };
                            self.comp_cells.push(i as u32);
                            self.comp_edge |= x == 0 || x + 1 == nx || cz == 0 || cz + 1 == nz || cy + 1 == ny;
                            let loose_bits = &self.loose_bits;
                            let seen_bits = &mut self.seen_bits;
                            let stack = &mut self.stack;
                            let mut join = |j: usize, nx_c: usize, ny_c: usize, nz_c: usize| {
                                let jw = ny_c * layer_words + nz_c * words_x + (nx_c >> 6);
                                let jbit = 1u64 << (nx_c & 63);
                                if (loose_bits[jw] & jbit) != 0 && (seen_bits[jw] & jbit) == 0 {
                                    seen_bits[jw] |= jbit;
                                    stack.push(if pack { pack_xyz(nx_c, ny_c, nz_c) } else { j as u32 });
                                }
                            };
                            if x > 0 { join(i - 1, x - 1, cy, cz) }
                            if x + 1 < nx { join(i + 1, x + 1, cy, cz) }
                            if cz > 0 { join(i - nx, x, cy, cz - 1) }
                            if cz + 1 < nz { join(i + nx, x, cy, cz + 1) }
                            if cy > 0 { join(i - layer, x, cy - 1, cz) }
                            if cy + 1 < active_ny { join(i + layer, x, cy + 1, cz) }
                            if remaining == 0 {
                                break;
                            }
                        }
                        if self.stack.is_empty() {
                            if !self.comp_edge && !self.comp_cells.is_empty() {
                                let runs = rows(&self.region, &mut self.comp_cells);
                                for &i in &self.comp_cells {
                                    self.region.cells[i as usize] = 0;
                                }
                                if self.comp_cells.len() < 4 {
                                    self.dust.extend(runs);
                                } else {
                                    let (mut low, mut high) = ([i32::MAX; 3], [i32::MIN; 3]);
                                    for run in &runs {
                                        low = [low[0].min(run.x0), low[1].min(run.y), low[2].min(run.z)];
                                        high = [high[0].max(run.x1), high[1].max(run.y + 1), high[2].max(run.z + 1)];
                                    }
                                    self.pieces.push(Loose { runs, cells: self.comp_cells.len(), low, high });
                                }
                                remaining = remaining.saturating_sub(self.comp_cells.len());
                            }
                            self.in_component = false;
                        }
                    }
                }
                SupportPhase::Done => break,
            }
        }
        self.phase == SupportPhase::Done
    }

    /// Monotonic progress estimate in `0.0..=1.0`.
    pub fn progress(&self) -> f32 {
        let total_words = self.total_words.max(1) as f32;
        match self.phase {
            SupportPhase::SeedPack => {
                let total_rows = (self.active_ny * self.region.size[2]).max(1) as f32;
                let done_rows = (self.seed_y * self.region.size[2] + self.seed_z) as f32;
                0.20 * (done_rows / total_rows).clamp(0.0, 1.0)
            }
            SupportPhase::SeedFrontier => 0.20 + 0.05 * (self.frontier_word as f32 / total_words).clamp(0.0, 1.0),
            SupportPhase::Propagate => {
                let denom = (self.built_count + self.frontier_count).max(1) as f32;
                0.25 + 0.35 * (self.order.len() as f32 / denom).clamp(0.0, 1.0)
            }
            SupportPhase::LoadAccum => {
                let denom = self.order.len().max(1) as f32;
                0.60 + 0.10 * ((self.order.len() - self.load_idx) as f32 / denom).clamp(0.0, 1.0)
            }
            SupportPhase::LoadTear => {
                let denom = self.order.len().max(1) as f32;
                0.70 + 0.10 * (self.tear_idx as f32 / denom).clamp(0.0, 1.0)
            }
            SupportPhase::MarkUnreached => 0.80 + 0.04 * (self.mark_word as f32 / total_words).clamp(0.0, 1.0),
            SupportPhase::ToppleEdgeFill => {
                if !self.edge_init_done {
                    0.84 + 0.02 * (self.edge_init_word as f32 / total_words).clamp(0.0, 1.0)
                } else {
                    let passes = self.edge_fill_layers_done as f32 / (self.active_ny.max(1) as f32 * 2.0);
                    0.86 + 0.02 * (1.0 - 1.0 / (1.0 + passes))
                }
            }
            SupportPhase::ToppleScan => 0.88 + 0.04 * (self.scan_word as f32 / total_words).clamp(0.0, 1.0),
            SupportPhase::AdriftScan => 0.92 + 0.03 * (self.scan_word as f32 / total_words).clamp(0.0, 1.0),
            SupportPhase::ExtractPieces => 0.95 + 0.05 * (self.scan_word as f32 / total_words).clamp(0.0, 1.0),
            SupportPhase::Done => 1.0,
        }
    }

    /// Consumes the job (completing any remaining work if called early) and returns the updated
    /// region, detached pieces, and dust runs.
    pub fn finish(mut self) -> (Region, Vec<Loose>, Vec<Run>) {
        while !self.step(usize::MAX / 2) {}
        (self.region, self.pieces, self.dust)
    }
}

/// Lets everything in a region that is not held fall until it is. At most `rounds` times over: what lands may
/// leave something perched. The region is left as the world then stands.
pub fn settle(r: &mut Region, rounds: u32) -> Settled {
    let [nx, _, nz] = r.size;
    let (n, layer) = (r.cells.len(), nx * nz);
    let mut done = Settled { moves: Vec::new(), dust: 0 };
    let mut piece_of = vec![0u32; n];
    let mut seen_bits: Vec<u64> = Vec::new();
    for round in 0..rounds {
        let is_loose = loose(r);
        let pieces = pieces_of(r, &is_loose, &mut seen_bits, [true; 2]);
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
            for &i in cells {
                piece_of[i as usize] = 0;
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
        // By the road on the plain: a windpump with its tank and trough, a sign, the fence.
        let roadside = [(82_960, 4450), (83_010, 4460), (82_300, 4130), (82_060, 4170)];
        // In the grass country: woods, their edges, meadow with bushes and tall grass, reeds by a lake.
        let grass = (0..10).map(|n| (5000 + n * 2300, 46_000 + (n % 4) * 1700)).chain((0..8).map(|n| (-58_000 + n * 1500, 2000 + (n % 3) * 2600)));
        let refuge = [(rx, rz), (rx + 60, rz), (rx - 120, rz - 20), (rx + 90, rz + 60), (rx + 60, rz - 150), (rx - 100, rz - 150), (rx + 110, rz - 140)];
        for (x, z) in hills.chain([(61_000, 4000), (61_400, 4070), (64_000, 5200), (58_000, 3000)]).chain(refuge).chain(roadside).chain(grass) {
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
        // Every 23 m, from four metres of water to seventeen, where no corner of the box is land (a cliff's trees
        // are cut from their ground by the box, as open_country_is_at_rest says): the box is 22 m high from 5 m under its middle's floor, and in deeper water it cuts the kelp
        // off under the top of the sea, so that a blade hanging from a stipe above the cut is held by nothing in it.
        for z in (-17_000..-12_000).step_by(230) {
            for x in (-66_400..-63_000).step_by(230) {
                let g = ground(x, z);
                if g > -40 || g < -170 || [(-80, -80), (80, -80), (-80, 80), (80, 80)].iter().any(|&(dx, dz)| ground(x + dx, z + dz) >= crate::city::SEA) {
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

    #[test]
    fn what_grows_by_the_sea_is_at_rest() {
        // The hills along the coast west of the town, with their woods and scrub, where the ground is near level
        // across the box (on a slope the box cuts trees from the ground they stand in): nothing may be loose or drop.
        let (mut grown, mut fell, mut boxes) = (0, Vec::new(), 0);
        for z in (-24_000..24_000).step_by(410) {
            for x in (-66_000..-58_000).step_by(190) {
                let g = ground(x, z);
                if g < 60 || !crate::land::offshore(x, z).is_some_and(|off| off > -6500.0 && off < 0.0) || [(-80, -80), (80, -80), (-80, 80), (80, 80), (0, 80), (80, 0), (-80, 0), (0, -80)].iter().any(|&(dx, dz)| (ground(x + dx, z + dz) - g).abs() > 14) {
                    continue;
                }
                boxes += 1;
                let mut r = city_at(x, z);
                grown += r.cells.iter().filter(|&&k| matches!(material(k), LEAVES | WOOD)).count();
                let held = loose(&r);
                let unheld = held.iter().filter(|&&l| l).count();
                if unheld > 0 {
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
        assert!(grown > 20_000, "the {boxes} boxes looked at hold trees and scrub ({grown} cells of them)");
        assert!(fell.is_empty(), "{} things by the sea are not at rest:\n{}", fell.len(), fell[..fell.len().min(12)].join("\n"));
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

    fn clone_region(r: &Region) -> Region {
        Region { low: r.low, size: r.size, cells: r.cells.clone() }
    }

    /// Reference scalar 6-connected BFS over all non-air cells seeded from ground & borders,
    /// used to verify bit-exactness and measure speedup of `BitGrid::flood_fill`.
    fn scalar_bfs_reach(r: &Region) -> Vec<bool> {
        let [nx, ny, nz] = r.size;
        let layer = nx * nz;
        let n = r.cells.len();
        let mut reached = vec![false; n];
        let mut queue: Vec<usize> = Vec::new();
        for y in 0..ny {
            for z in 0..nz {
                for x in 0..nx {
                    let i = r.at(x, y, z);
                    let k = r.cells[i];
                    if k == 0 {
                        continue;
                    }
                    let border = y == 0 || x == 0 || x + 1 == nx || z == 0 || z + 1 == nz;
                    if border || (y > 0 && is_ground(k) && reached[i - layer]) {
                        reached[i] = true;
                        queue.push(i);
                    }
                }
            }
        }
        let mut head = 0;
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            let (x, y, z) = r.place(i);
            let mut try_push = |j: usize| {
                if r.cells[j] != 0 && !reached[j] {
                    reached[j] = true;
                    queue.push(j);
                }
            };
            if x > 0 { try_push(i - 1); }
            if x + 1 < nx { try_push(i + 1); }
            if z > 0 { try_push(i - nx); }
            if z + 1 < nz { try_push(i + nx); }
            if y > 0 { try_push(i - layer); }
            if y + 1 < ny { try_push(i + layer); }
        }
        reached
    }

    fn assert_job_matches_release(r: &Region, shove: Option<([i32; 3], i32)>, budget_ops: usize, label: &str) -> (usize, usize) {
        let mut sync_r = clone_region(r);
        let (sync_pieces, sync_dust) = release(&mut sync_r, shove);

        let mut job = SupportJob::new(clone_region(r), shove);
        let mut slices = 0usize;
        let mut prev_prog = 0.0f32;
        loop {
            let done = job.step(budget_ops);
            slices += 1;
            let prog = job.progress();
            assert!(
                (0.0..=1.0).contains(&prog),
                "{label}: progress out of range: {prog}"
            );
            assert!(
                prog + 1e-6 >= prev_prog,
                "{label}: progress regressed from {prev_prog} to {prog} on slice {slices}"
            );
            prev_prog = prog;
            if done {
                assert_eq!(prog, 1.0, "{label}: finished job must report progress 1.0");
                break;
            }
            assert!(slices < 200_000, "{label}: SupportJob did not terminate");
        }
        let (async_r, async_pieces, async_dust) = job.finish();

        assert_eq!(async_r.cells, sync_r.cells, "{label}: region cells diverged after release");
        assert_eq!(async_dust, sync_dust, "{label}: dust runs diverged");
        assert_eq!(async_pieces.len(), sync_pieces.len(), "{label}: piece count diverged");
        for (idx, (ap, sp)) in async_pieces.iter().zip(sync_pieces.iter()).enumerate() {
            assert_eq!(ap.cells, sp.cells, "{label}: piece {idx} cell count diverged");
            assert_eq!(ap.low, sp.low, "{label}: piece {idx} low corner diverged");
            assert_eq!(ap.high, sp.high, "{label}: piece {idx} high corner diverged");
            assert_eq!(ap.runs, sp.runs, "{label}: piece {idx} runs diverged");
        }
        let detached: usize = sync_pieces.iter().map(|p| p.cells).sum::<usize>()
            + sync_dust.iter().map(|run| (run.x1 - run.x0) as usize).sum::<usize>();
        (detached, slices)
    }

    #[test]
    fn bit_grid_flood_fill_arches_islands_and_word_boundaries() {
        let mut r = Region::new([0, 0, 0], [160, 48, 32]);
        let earth = kind(EARTH, OWN);
        let brick = kind(BRICK, OWN);
        let steel = kind(STEEL, OWN);

        // Ground slab at y = 0..2.
        block_of(&mut r, (0, 160), (0, 2), (0, 32), earth);

        // 100-cell-wide arch spanning across the x = 63 <-> 64 word boundary (x = 10..110).
        block_of(&mut r, (10, 14), (2, 22), (8, 12), brick);
        block_of(&mut r, (106, 110), (2, 22), (8, 12), brick);
        block_of(&mut r, (10, 110), (20, 24), (8, 12), steel);

        // Single-legged cantilever arch crossing x = 127 <-> 128 word boundary (x = 115..150).
        block_of(&mut r, (146, 150), (2, 18), (14, 18), brick);
        block_of(&mut r, (115, 150), (16, 18), (14, 18), steel);

        // 1-cell-thick serpentine bridge crossing x = 63 <-> 64 and looping back across x = 64 -> 63.
        block_of(&mut r, (60, 61), (2, 30), (24, 25), steel);
        block_of(&mut r, (60, 70), (29, 30), (24, 25), steel);
        block_of(&mut r, (69, 70), (29, 34), (24, 25), steel);
        block_of(&mut r, (58, 70), (33, 34), (24, 25), steel);

        // Disconnected floating island crossing x = 63 <-> 64 (must remain unreached).
        block_of(&mut r, (50, 80), (36, 42), (4, 14), brick);
        // Second disconnected island crossing x = 127 <-> 128 (must remain unreached).
        block_of(&mut r, (120, 140), (30, 36), (20, 26), brick);

        let expected = scalar_bfs_reach(&r);
        let mut grid = BitGrid::from_region(&r);
        grid.seed_ground_and_borders(&r);
        let passes = grid.flood_fill();
        assert!(passes >= 1, "arch/serpentine should propagate in bit_reach_pass");

        let mut mismatches = 0usize;
        for y in 0..r.size[1] {
            for z in 0..r.size[2] {
                for x in 0..r.size[0] {
                    let i = r.at(x, y, z);
                    if grid.is_reached(x, y, z) != expected[i] {
                        mismatches += 1;
                    }
                }
            }
        }
        assert_eq!(mismatches, 0, "BitGrid::flood_fill must match scalar 6-connected BFS bit-for-bit");
        // Verify cross-word cells on both sides of x = 63 <-> 64 and x = 127 <-> 128.
        assert!(grid.is_reached(63, 21, 10) && grid.is_reached(64, 21, 10));
        assert!(grid.is_reached(127, 17, 16) && grid.is_reached(128, 17, 16));
        assert!(grid.is_reached(58, 33, 24) && grid.is_reached(63, 33, 24) && grid.is_reached(64, 33, 24));
        // Floating islands remain unreached across word boundaries.
        assert!(!grid.is_reached(63, 38, 8) && !grid.is_reached(64, 38, 8));
        assert!(!grid.is_reached(127, 32, 22) && !grid.is_reached(128, 32, 22));
    }

    #[test]
    fn support_job_parity_with_release_on_synthetic_buildings() {
        let wall = kind(PLASTER, WHITE);
        let brick = kind(BRICK, OWN);
        let steel = kind(STEEL, OWN);
        let concrete = kind(CONCRETE, OWN);
        let glass = kind(GLASS, OWN);
        let wood = kind(WOOD, OWN);

        // 1. Cantilever wall: one panel hung by a single cell (tears) + one joined along edge (stands)
        //    + a plaster cantilever past span 30 (breaks) + a tiny 2-cell dust crumb.
        let mut cantilever = yard();
        block_of(&mut cantilever, (20, 24), (4, 64), (20, 24), wall);
        block_of(&mut cantilever, (25, 55), (34, 54), (21, 23), wall);
        block_of(&mut cantilever, (24, 25), (44, 45), (21, 22), wall);
        block_of(&mut cantilever, (24, 50), (4, 24), (30, 32), wall);
        block_of(&mut cantilever, (24, 66), (56, 58), (21, 23), wall);
        block_of(&mut cantilever, (70, 72), (40, 41), (20, 21), brick);
        let (det, slices) = assert_job_matches_release(&cantilever, None, 2048, "cantilever_wall");
        assert!(det >= 1200, "cantilever should detach hung panel and overhang, got {det}");
        assert!(slices > 1, "small budget must span multiple slices");

        // 2. Chimney topple: freestanding tall brick chimney with half its base removed so it is
        //    still reached from ground, yet its centre of mass overhangs past brick's lean (1 cell).
        let mut chimney = yard();
        block_of(&mut chimney, (40, 44), (4, 10), (20, 28), brick);
        block_of(&mut chimney, (40, 54), (10, 62), (20, 28), brick);
        let (det, _) = assert_job_matches_release(&chimney, None, 2048, "chimney_topple");
        assert!(det > 2000, "chimney should topple, got {det}");

        // 3. Multi-story steel/concrete/glass frame with center support blasted out + loose rubble.
        let mut frame = yard();
        // 4 corner steel columns + 3 concrete floor slabs + glass curtain panels.
        for &(cx, cz) in &[(16, 10), (60, 10), (16, 34), (60, 34)] {
            block_of(&mut frame, (cx, cx + 2), (4, 64), (cz, cz + 2), steel);
        }
        for &fy in &[20, 40, 60] {
            block_of(&mut frame, (16, 62), (fy, fy + 2), (10, 36), concrete);
        }
        block_of(&mut frame, (22, 56), (22, 40), (10, 11), glass);
        // Sever one corner column near the base and add floating debris & rubble.
        block_of(&mut frame, (58, 64), (4, 18), (32, 38), 0);
        block_of(&mut frame, (36, 44), (68, 72), (18, 26), brick | RUBBLE);
        let (det, _) = assert_job_matches_release(&frame, Some(([60, 10, 34], 16)), 2048, "multi_story_frame");
        assert!(det > 200, "multi-story frame should detach rubble/loose parts, got {det}");

        // 4. Car adrift: freestanding steel+glass car within 2*radius of blast + wood shed nearby.
        let mut street = yard();
        // Car: steel chassis + glass cabin (100% STEEL|GLASS, <= 20_000 cells).
        block_of(&mut street, (30, 52), (4, 9), (18, 28), steel);
        block_of(&mut street, (35, 47), (9, 14), (19, 27), glass);
        // Wood shed standing nearby: must NOT go adrift.
        block_of(&mut street, (64, 76), (4, 18), (18, 28), wood);
        let (det, _) = assert_job_matches_release(&street, Some(([41, 6, 23], 16)), 2048, "car_adrift");
        assert_eq!(det, 22 * 5 * 10 + 12 * 5 * 8, "car should detach whole while wood shed stays");

        // 5. Edge cases: empty region, pure ground (trivially anchored), pure floating island (trivially disconnected).
        let empty = Region::new([0, 0, 0], [32, 32, 32]);
        assert_job_matches_release(&empty, None, 2048, "empty");

        let mut vertical_only = yard();
        block_of(&mut vertical_only, (20, 40), (4, 20), (15, 30), brick);
        let (det, _) = assert_job_matches_release(&vertical_only, None, 2048, "trivially_anchored");
        assert_eq!(det, 0);

        let mut floating = Region::new([0, 0, 0], [48, 48, 48]);
        block_of(&mut floating, (16, 28), (16, 28), (16, 28), brick);
        let (det, _) = assert_job_matches_release(&floating, None, 2048, "trivially_disconnected");
        assert_eq!(det, 12 * 12 * 12);
    }

    #[test]
    fn support_job_slice_budget_and_speedup_benchmark() {
        use std::time::Instant;

        // Gather a full 160 x 224 x 160 blasted city region (exact SETTLE dimensions).
        let (bx, bz) = (-12..12)
            .flat_map(|bz| (-12..12).map(move |bx| (bx, bz)))
            .find(|&(bx, bz)| block(bx, bz) == Block::Homes && ground(bx * BLOCK_X + 500, bz * BLOCK_Z + 150) > 80)
            .unwrap();
        let (x, z) = (bx * BLOCK_X + 140 + 76 * 4 + 38, bz * BLOCK_Z + 150);
        let y = ground(x, z) + 14;
        let edits: Vec<Edit> = (0..5)
            .flat_map(|i| (0..3).map(move |j| Edit::Ball { centre: [x - 40 + i * 20, y, z + j * 30], radius: 16, kind: 0 }))
            .collect();
        let low = [x - SETTLE[0] as i32 / 2, y - 48, z - SETTLE[2] as i32 / 2];
        let base_region = Region::gather(low, SETTLE, &edits, &mut Scratch::new());
        assert_eq!(base_region.size, [160, 224, 160]);
        let shove = Some(([x, y, z], 16));

        // 1. Compare BitGrid::flood_fill vs scalar 6-connected BFS on the full 160x224x160 region.
        let t_scalar = Instant::now();
        let scalar_reached = scalar_bfs_reach(&base_region);
        let scalar_ms = t_scalar.elapsed().as_secs_f64() * 1000.0;

        let t_bit = Instant::now();
        let mut grid = BitGrid::from_region_grounded(&base_region);
        let passes = grid.flood_fill();
        let bit_ms = t_bit.elapsed().as_secs_f64() * 1000.0;

        let scalar_count = scalar_reached.iter().filter(|&&b| b).count();
        assert_eq!(grid.reached_count(), scalar_count, "BitGrid reached count must match scalar BFS on 160x224x160");

        // 2. Measure warm synchronous release() on 160x224x160.
        let _ = release(&mut clone_region(&base_region), shove);
        let mut sync_r = clone_region(&base_region);
        let t_sync = Instant::now();
        let (sync_pieces, sync_dust) = release(&mut sync_r, shove);
        let sync_ms = t_sync.elapsed().as_secs_f64() * 1000.0;

        // 3. Measure SupportJob per-slice wall time with budget_ops = 50_000 across 3 trials.
        // Taking per-slice min across 3 deterministic runs filters out random OS scheduler
        // preemption during parallel `cargo test` while still catching any real slice spike.
        let mut min_slice_ms: Vec<f64> = Vec::new();
        let mut best_total_ms = f64::INFINITY;
        let mut last_async = None;
        for trial in 0..3 {
            let mut job = SupportJob::new(clone_region(&base_region), shove);
            let mut slice_ms: Vec<f64> = Vec::new();
            let t_async_total = Instant::now();
            loop {
                let ts = Instant::now();
                let done = job.step(50_000);
                slice_ms.push(ts.elapsed().as_secs_f64() * 1000.0);
                if done {
                    break;
                }
            }
            best_total_ms = best_total_ms.min(t_async_total.elapsed().as_secs_f64() * 1000.0);
            if trial == 0 {
                min_slice_ms = slice_ms;
            } else {
                assert_eq!(slice_ms.len(), min_slice_ms.len(), "SupportJob slice count must be deterministic");
                for (m, s) in min_slice_ms.iter_mut().zip(slice_ms.iter()) {
                    *m = m.min(*s);
                }
            }
            last_async = Some(job.finish());
        }
        let (async_r, async_pieces, async_dust) = last_async.unwrap();

        // Bit-exact parity on the full 160x224x160 blasted city scene.
        assert_eq!(async_r.cells, sync_r.cells, "160x224x160 region cells diverged");
        assert_eq!(async_dust, sync_dust, "160x224x160 dust runs diverged");
        assert_eq!(async_pieces.len(), sync_pieces.len(), "160x224x160 piece count diverged");
        for (ap, sp) in async_pieces.iter().zip(sync_pieces.iter()) {
            assert_eq!((ap.cells, ap.low, ap.high, &ap.runs), (sp.cells, sp.low, sp.high, &sp.runs));
        }

        let max_slice = min_slice_ms.iter().copied().fold(0.0f64, f64::max);
        let mut sorted = min_slice_ms.clone();
        sorted.sort_by(|a, b| a.total_cmp(b));
        let p95_slice = sorted[((sorted.len() * 95) / 100).min(sorted.len() - 1)];
        let avg_slice = min_slice_ms.iter().sum::<f64>() / min_slice_ms.len() as f64;
        eprintln!(
            "[#166 bench 160x224x160] BitGrid={bit_ms:.2}ms ({passes} passes) vs scalarBFS={scalar_ms:.2}ms ({:.1}x) | sync release={sync_ms:.2}ms | SupportJob(50k): {} slices, total={best_total_ms:.2}ms, avg={avg_slice:.2}ms, p95={p95_slice:.2}ms, max={max_slice:.2}ms, pieces={}",
            scalar_ms / bit_ms.max(0.001),
            min_slice_ms.len(),
            sync_pieces.len(),
        );

        #[cfg(not(debug_assertions))]
        assert!(
            max_slice < 4.0,
            "every SupportJob(50_000) slice on 160x224x160 must complete in < 4.0 ms in release mode (got max={max_slice:.2} ms, slices={min_slice_ms:?})"
        );
    }
}
