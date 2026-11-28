//! Multi-layer 16×16 voxel heightfield extraction for a 6.4 m × 6.4 m nav tile (#164).
//!
//! Each tile aligns 1-to-1 in XZ with one 64×64 fine-cell sector column (`TILE_CELLS = 64`).
//! At `NAV_STEP = 4` (40 cm), each tile holds `16 × 16 = 256` walkable columns, each with
//! zero or more stacked [`NavSpan`] layers (supporting bridges, underpasses, multi-storey
//! interiors, roofs, freshly blasted craters, and player-built voxel bridges).

use crate::bodies::Ground;
use crate::city;
use crate::kinds::{WATER, material, rubble};
use crate::support::Region;
use crate::tree::Kind;

/// Fine cells (10 cm each) along one side of a nav tile: 64 cells = 6.4 m.
pub const TILE_CELLS: i32 = 64;
/// Fine cells between adjacent nav columns: 4 cells = 40 cm.
pub const NAV_STEP: i32 = 4;
/// Walkable nav columns per side of a tile: 64 / 4 = 16.
pub const TILE_COLS: usize = (TILE_CELLS / NAV_STEP) as usize;
/// Total walkable nav columns per tile: 16 * 16 = 256.
pub const TILE_COL_COUNT: usize = TILE_COLS * TILE_COLS;

/// Minimum vertical air clearance above a walkable floor cell (18 cells = 1.8 m).
pub const AGENT_TALL: i32 = 18;
/// Maximum height change for ordinary walking (<= 2 cells = 20 cm).
pub const STEP_MAX: i32 = 2;
/// Maximum step-up for vaulting with hands (3..=10 cells = 0.3..1.0 m, matching `about.mjs` `HANDS`).
pub const VAULT_MAX: i32 = 10;
/// Maximum safe drop-down (3..=30 cells = 0.3..3.0 m, matching `about.mjs`).
pub const DROP_MAX: i32 = 30;
/// Maximum climbable vertical rise for climbing-capable agents (11..=64 cells = 1.1..6.4 m).
pub const CLIMB_MAX: i32 = 64;

/// Cardinal directions for intra-tile and border transitions.
pub const DIR_POS_X: u8 = 0;
pub const DIR_NEG_X: u8 = 1;
pub const DIR_POS_Z: u8 = 2;
pub const DIR_NEG_Z: u8 = 3;

pub const DIR_OFFSETS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

#[inline]
pub const fn opposite_dir(dir: u8) -> u8 {
    dir ^ 1
}

/// Movement transition class encoded into path waypoints and portal edges.
pub const MOVE_WALK: u8 = 0;
pub const MOVE_VAULT: u8 = 1;
pub const MOVE_DROP: u8 = 2;
pub const MOVE_CLIMB: u8 = 3;
pub const MOVE_NONE: u8 = 255;

/// Pathfinding capability bitflags for `nav_find_path`.
/// When `flags == 0`, standard pedestrian navigation (`NAV_ALLOW_VAULT | NAV_ALLOW_DROP`) is used.
pub const NAV_ALLOW_VAULT: u32 = 1 << 0;
pub const NAV_ALLOW_DROP: u32 = 1 << 1;
pub const NAV_ALLOW_CLIMB: u32 = 1 << 2;
pub const NAV_WALK_ONLY: u32 = 1 << 3;

/// Span metadata flags.
pub const SPAN_RUBBLE: u8 = 1 << 0;

/// Returns whether a transition of `move_kind` is permitted under `flags`.
#[inline]
pub const fn move_allowed(move_kind: u8, flags: u32) -> bool {
    if move_kind == MOVE_WALK {
        return true;
    }
    if flags & NAV_WALK_ONLY != 0 {
        return false;
    }
    let effective = if flags == 0 {
        NAV_ALLOW_VAULT | NAV_ALLOW_DROP
    } else {
        flags
    };
    match move_kind {
        MOVE_VAULT => effective & NAV_ALLOW_VAULT != 0,
        MOVE_DROP => effective & NAV_ALLOW_DROP != 0,
        MOVE_CLIMB => effective & NAV_ALLOW_CLIMB != 0,
        _ => false,
    }
}

/// Converts a world fine-cell coordinate to its nav tile coordinate.
#[inline]
pub const fn world_to_tile(v: i32) -> i32 {
    v.div_euclid(TILE_CELLS)
}

/// Converts a world fine-cell coordinate to its local column index `0..TILE_COLS`.
#[inline]
pub const fn world_to_col(v: i32) -> usize {
    (v.rem_euclid(TILE_CELLS) / NAV_STEP) as usize
}

/// World fine-cell center coordinate for column `c` (`0..TILE_COLS`) of tile `t`.
#[inline]
pub const fn col_center(t: i32, c: usize) -> i32 {
    t * TILE_CELLS + (c as i32) * NAV_STEP + (NAV_STEP / 2)
}

/// Column index `0..256` from `(cx, cz)`.
#[inline]
pub const fn col_index(cx: usize, cz: usize) -> usize {
    cz * TILE_COLS + cx
}

/// One walkable surface layer in a tile column.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NavSpan {
    /// Foot elevation (first air cell directly above solid floor cell `y - 1`).
    pub y: i32,
    /// Vertical air clearance above `y` in fine cells (`>= AGENT_TALL`, `u16::MAX` for open sky).
    pub clearance: u16,
    /// Floor material (low 4 bits of `Kind`).
    pub material: u8,
    /// Span flags (`SPAN_RUBBLE`, etc.).
    pub flags: u8,
    /// Connected walkable region ID inside this tile (`u16::MAX` if unassigned).
    pub region: u16,
    /// Start index into `NavTile::edges`.
    pub edge_start: u16,
    /// Number of outgoing intra-tile edges in `NavTile::edges`.
    pub edge_count: u8,
    /// Column index (`cz * 16 + cx`) that owns this span.
    pub col: u8,
}

/// Directed walkable transition between two spans inside the same tile.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SpanEdge {
    pub to_span: u16,
    pub dir: u8,
    pub move_kind: u8,
}

/// Abstract voxel world query source used by heightfield extraction.
/// Implemented directly for live `bodies::Ground` and synthetic unit-test worlds.
pub trait VoxelSource {
    /// Returns the `Kind` of fine cell `(x, y, z)` (`0` for air).
    fn kind(&mut self, x: i32, y: i32, z: i32) -> Kind;
    /// Optional bulk snapshot of `[tx*64..(tx+1)*64) × [y_lo..y_hi) × [tz*64..(tz+1)*64)` so
    /// tile extraction and intra-tile wall checks run directly over a flat slice with zero
    /// per-cell HashMap lookups or `Sector::Bits` rebuilds.
    fn tile_region(&mut self, _tx: i32, _tz: i32, _y_lo: i32, _y_hi: i32) -> Option<Region> {
        None
    }
    /// Returns inclusive-low, exclusive-high vertical scan range `(y_lo, y_hi)` for tile `(tx, tz)`,
    /// expanding for any recorded edit vertical range `edit_y`.
    fn tile_y_bounds(&mut self, tx: i32, tz: i32, edit_y: Option<(i32, i32)>) -> (i32, i32);
    /// Lowest foot elevation considered dry (default `0`, since `y < 0` is submerged in `city::SEA`).
    fn min_foot_y(&self) -> i32 {
        0
    }
}

impl VoxelSource for Ground {
    #[inline]
    fn kind(&mut self, x: i32, y: i32, z: i32) -> Kind {
        Ground::kind(self, x, y, z)
    }

    fn tile_region(&mut self, tx: i32, tz: i32, y_lo: i32, y_hi: i32) -> Option<Region> {
        let h = (y_hi - y_lo).max(1) as usize;
        Some(self.region(
            [tx * TILE_CELLS, y_lo, tz * TILE_CELLS],
            [TILE_CELLS as usize, h, TILE_CELLS as usize],
        ))
    }

    fn tile_y_bounds(&mut self, tx: i32, tz: i32, edit_y: Option<(i32, i32)>) -> (i32, i32) {
        let x0 = tx * TILE_CELLS;
        let z0 = tz * TILE_CELLS;
        let mut g_min = i32::MAX;
        let mut g_max = i32::MIN;
        // Sample 3×3 points across the 6.4 m tile to bound baseline terrain elevation quickly.
        for iz in 0..3 {
            let wz = z0 + iz * 30 + 2;
            for ix in 0..3 {
                let wx = x0 + ix * 30 + 2;
                let f = city::footing(wx, wz).0;
                g_min = g_min.min(f);
                g_max = g_max.max(f);
            }
        }
        let (sy_lo, sy_hi) = city::span(tx, tz, 0);
        let mut y_lo = (g_min - 14).max(sy_lo * TILE_CELLS).max(-1);
        // Cap untouched tall blocks to 12.8 m above local ground (covers all 2–4 storey houses,
        // roofs, and overpasses), and bound edit expansion to walkable pedestrian elevation (+16 m /
        // -9.6 m craters) so high-altitude skyscraper blasts never force scanning 9–30 vertical sectors.
        let span_hi = (sy_hi + 1) * TILE_CELLS + AGENT_TALL;
        let walk_hi = g_max + 160 + AGENT_TALL;
        let mut y_hi = span_hi.min(g_max + 128 + AGENT_TALL);
        if let Some((ey0, ey1)) = edit_y {
            y_lo = y_lo.min(ey0 - 4).max(g_min - 96).max(-1);
            y_hi = y_hi.max((ey1 + AGENT_TALL + 4).min(walk_hi));
        }
        if y_hi < y_lo + AGENT_TALL + 4 {
            y_hi = y_lo + AGENT_TALL + 4;
        }
        (y_lo, y_hi)
    }
}

/// Reusable column scanner state for layer-major extraction.
#[derive(Clone, Copy)]
struct ColScan {
    has_floor: bool,
    emitted: bool,
    floor_y: i32,
    floor_mat: u8,
    floor_flags: u8,
    air_run: u16,
    last_span: u16,
}

impl ColScan {
    const EMPTY: Self = Self {
        has_floor: false,
        emitted: false,
        floor_y: 0,
        floor_mat: 0,
        floor_flags: 0,
        air_run: 0,
        last_span: u16::MAX,
    };
}

/// Extracted multi-layer heightfield for one tile (before region & portal attachment).
pub struct RawHeightfield {
    pub tx: i32,
    pub tz: i32,
    /// `(start_index, count)` into `spans` for each column `cz * 16 + cx`.
    pub col_spans: [(u16, u8); TILE_COL_COUNT],
    pub spans: Vec<NavSpan>,
    pub edges: Vec<SpanEdge>,
}

/// Classifies a vertical transition `dy = y_to - y_from` and checks headroom overlap & thin intermediate walls.
///
/// `(wx_a, wz_a)` and `(wx_b, wz_b)` must be adjacent nav column centers (4 cells apart along X or Z).
/// Returns `(move_ab, move_ba)` so a single intermediate wall probe validates both directions.
#[inline]
pub fn classify_transition<S: VoxelSource>(
    src: &mut S,
    wx_a: i32,
    wz_a: i32,
    span_a: &NavSpan,
    wx_b: i32,
    wz_b: i32,
    span_b: &NavSpan,
) -> (u8, u8) {
    classify_transition_with(
        |x, y, z| src.kind(x, y, z) != 0,
        wx_a,
        wz_a,
        span_a,
        wx_b,
        wz_b,
        span_b,
    )
}

#[inline]
fn classify_transition_with(
    mut is_solid: impl FnMut(i32, i32, i32) -> bool,
    wx_a: i32,
    wz_a: i32,
    span_a: &NavSpan,
    wx_b: i32,
    wz_b: i32,
    span_b: &NavSpan,
) -> (u8, u8) {
    let dy = span_b.y - span_a.y;
    let mut ab = classify_dy(dy);
    let mut ba = classify_dy(-dy);
    if ab == MOVE_NONE && ba == MOVE_NONE {
        return (MOVE_NONE, MOVE_NONE);
    }

    let ceil_a = span_a.y.saturating_add(span_a.clearance as i32);
    let ceil_b = span_b.y.saturating_add(span_b.clearance as i32);
    let y_hi = span_a.y.max(span_b.y);

    // Headroom check: moving onto or over a higher ledge needs full agent clearance at the shared ceiling.
    if ab != MOVE_NONE {
        let ok = match ab {
            MOVE_WALK => ceil_a.min(ceil_b) >= y_hi + AGENT_TALL,
            MOVE_VAULT | MOVE_CLIMB => ceil_a >= span_b.y + AGENT_TALL,
            MOVE_DROP => ceil_b >= span_a.y + AGENT_TALL,
            _ => false,
        };
        if !ok {
            ab = MOVE_NONE;
        }
    }
    if ba != MOVE_NONE {
        let ok = match ba {
            MOVE_WALK => ceil_a.min(ceil_b) >= y_hi + AGENT_TALL,
            MOVE_VAULT | MOVE_CLIMB => ceil_b >= span_a.y + AGENT_TALL,
            MOVE_DROP => ceil_a >= span_b.y + AGENT_TALL,
            _ => false,
        };
        if !ok {
            ba = MOVE_NONE;
        }
    }
    if ab == MOVE_NONE && ba == MOVE_NONE {
        return (MOVE_NONE, MOVE_NONE);
    }

    // Intermediate thin-wall probe across the 3 fine cells strictly between column centers.
    // Prevents walking or vaulting through 1-cell glass panes or 2-cell brick/plaster walls.
    let step_x = (wx_b - wx_a).signum();
    let step_z = (wz_b - wz_a).signum();
    let mut high_blocked = false;
    let mut low_blocked = false;
    let mut mid_y_top = y_hi;
    for s in 1..NAV_STEP {
        let mx = wx_a + step_x * s;
        let mz = wz_a + step_z * s;
        // Upper body & head band (above vault height 10): solid here is a wall/lintel.
        if is_solid(mx, y_hi + 11, mz)
            || is_solid(mx, y_hi + 15, mz)
            || is_solid(mx, y_hi + AGENT_TALL - 1, mz)
        {
            high_blocked = true;
            break;
        }
        // Knee / waist band (above 2-cell step): solid here is a low barrier / railing / fence.
        if is_solid(mx, y_hi + 3, mz) || is_solid(mx, y_hi + 7, mz) {
            low_blocked = true;
            // Estimate barrier top to check whether vaulting clears the ceiling.
            if is_solid(mx, y_hi + 7, mz) {
                mid_y_top = mid_y_top.max(y_hi + 10);
            } else {
                mid_y_top = mid_y_top.max(y_hi + 6);
            }
        }
    }
    if high_blocked {
        return (MOVE_NONE, MOVE_NONE);
    }
    if low_blocked {
        // Low barrier requires vaulting over it; reject if no vault headroom above both sides.
        let can_vault_over = ceil_a.min(ceil_b) >= mid_y_top + AGENT_TALL;
        if !can_vault_over {
            return (MOVE_NONE, MOVE_NONE);
        }
        if ab == MOVE_WALK {
            ab = MOVE_VAULT;
        }
        if ba == MOVE_WALK {
            ba = MOVE_VAULT;
        }
    }

    (ab, ba)
}

#[inline]
const fn classify_dy(dy: i32) -> u8 {
    if dy >= -STEP_MAX && dy <= STEP_MAX {
        MOVE_WALK
    } else if dy > STEP_MAX && dy <= VAULT_MAX {
        MOVE_VAULT
    } else if dy < -STEP_MAX && dy >= -DROP_MAX {
        MOVE_DROP
    } else if dy > VAULT_MAX && dy <= CLIMB_MAX {
        MOVE_CLIMB
    } else {
        MOVE_NONE
    }
}

/// Extracts the complete 16×16 multi-layer walkable heightfield and intra-tile edges for tile `(tx, tz)`.
pub fn extract_tile<S: VoxelSource>(
    src: &mut S,
    tx: i32,
    tz: i32,
    edit_y: Option<(i32, i32)>,
) -> RawHeightfield {
    let (y_lo, y_hi) = src.tile_y_bounds(tx, tz, edit_y);
    let min_foot = src.min_foot_y();
    let region = src.tile_region(tx, tz, y_lo, y_hi);
    let x0 = tx * TILE_CELLS;
    let z0 = tz * TILE_CELLS;
    let h = (y_hi - y_lo).max(1) as usize;

    let mut col_state = [ColScan::EMPTY; TILE_COL_COUNT];
    let mut raw_spans: Vec<NavSpan> = Vec::with_capacity(TILE_COL_COUNT * 2);
    let mut col_counts = [0u8; TILE_COL_COUNT];

    // If any column starts in air at `y_lo` (e.g. a deep crater or steep drop), probe down up to
    // 64 cells once to locate the solid floor directly underneath `y_lo`.
    for cz in 0..TILE_COLS {
        let wz = col_center(tz, cz);
        let lz = cz * (NAV_STEP as usize) + (NAV_STEP as usize / 2);
        for cx in 0..TILE_COLS {
            let wx = col_center(tx, cx);
            let lx = cx * (NAV_STEP as usize) + (NAV_STEP as usize / 2);
            let cidx = col_index(cx, cz);
            let k0 = match &region {
                Some(r) => r.cells[lx + 64 * lz],
                None => src.kind(wx, y_lo, wz),
            };
            if k0 == 0 {
                let mut py = y_lo - 1;
                let stop = (y_lo - 64).max(min_foot - 1);
                while py >= stop {
                    let kp = src.kind(wx, py, wz);
                    if kp != 0 {
                        let mat = material(kp);
                        if mat != WATER && py + 1 >= min_foot {
                            let st = &mut col_state[cidx];
                            st.has_floor = true;
                            st.floor_y = py + 1;
                            st.floor_mat = mat;
                            st.floor_flags = if rubble(kp) { SPAN_RUBBLE } else { 0 };
                            st.air_run = (y_lo - (py + 1)).min(u16::MAX as i32) as u16;
                            if st.air_run >= AGENT_TALL as u16 {
                                let idx = raw_spans.len() as u16;
                                raw_spans.push(NavSpan {
                                    y: st.floor_y,
                                    clearance: st.air_run,
                                    material: st.floor_mat,
                                    flags: st.floor_flags,
                                    region: u16::MAX,
                                    edge_start: 0,
                                    edge_count: 0,
                                    col: cidx as u8,
                                });
                                col_counts[cidx] = col_counts[cidx].saturating_add(1);
                                st.emitted = true;
                                st.last_span = idx;
                            }
                        }
                        break;
                    }
                    py -= 1;
                }
            }
        }
    }

    // Layer-major vertical scan: when `region` is present, reads directly from the flat `Region`
    // slice with zero HashMap lookups or `Sector::Bits` rebuilds.
    if let Some(ref reg) = region {
        let cells = &reg.cells;
        for ly in 0..h {
            let y = y_lo + ly as i32;
            let y_base = ly * 4096;
            for cz in 0..TILE_COLS {
                let z_base = y_base + (cz * 4 + 2) * 64 + 2;
                let row_base = cz * TILE_COLS;
                for cx in 0..TILE_COLS {
                    let cidx = row_base + cx;
                    let k = cells[z_base + cx * 4];
                    let st = &mut col_state[cidx];
                    if k == 0 {
                        if st.has_floor {
                            st.air_run = st.air_run.saturating_add(1);
                            if !st.emitted {
                                if st.air_run >= AGENT_TALL as u16 {
                                    if raw_spans.len() < (u16::MAX as usize) - 1 && col_counts[cidx] < u8::MAX {
                                        let idx = raw_spans.len() as u16;
                                        raw_spans.push(NavSpan {
                                            y: st.floor_y,
                                            clearance: st.air_run,
                                            material: st.floor_mat,
                                            flags: st.floor_flags,
                                            region: u16::MAX,
                                            edge_start: 0,
                                            edge_count: 0,
                                            col: cidx as u8,
                                        });
                                        col_counts[cidx] += 1;
                                        st.emitted = true;
                                        st.last_span = idx;
                                    }
                                }
                            } else {
                                raw_spans[st.last_span as usize].clearance = st.air_run;
                            }
                        }
                    } else {
                        st.air_run = 0;
                        st.emitted = false;
                        let mat = material(k);
                        if mat != WATER && y + 1 >= min_foot {
                            st.has_floor = true;
                            st.floor_y = y + 1;
                            st.floor_mat = mat;
                            st.floor_flags = if rubble(k) { SPAN_RUBBLE } else { 0 };
                        } else {
                            st.has_floor = false;
                        }
                    }
                }
            }
        }
    } else {
        for y in y_lo..y_hi {
            for cz in 0..TILE_COLS {
                let wz = col_center(tz, cz);
                let row_base = cz * TILE_COLS;
                for cx in 0..TILE_COLS {
                    let wx = col_center(tx, cx);
                    let cidx = row_base + cx;
                    let k = src.kind(wx, y, wz);
                    let st = &mut col_state[cidx];
                    if k == 0 {
                        if st.has_floor {
                            st.air_run = st.air_run.saturating_add(1);
                            if !st.emitted {
                                if st.air_run >= AGENT_TALL as u16 {
                                    if raw_spans.len() < (u16::MAX as usize) - 1 && col_counts[cidx] < u8::MAX {
                                        let idx = raw_spans.len() as u16;
                                        raw_spans.push(NavSpan {
                                            y: st.floor_y,
                                            clearance: st.air_run,
                                            material: st.floor_mat,
                                            flags: st.floor_flags,
                                            region: u16::MAX,
                                            edge_start: 0,
                                            edge_count: 0,
                                            col: cidx as u8,
                                        });
                                        col_counts[cidx] += 1;
                                        st.emitted = true;
                                        st.last_span = idx;
                                    }
                                }
                            } else {
                                raw_spans[st.last_span as usize].clearance = st.air_run;
                            }
                        }
                    } else {
                        st.air_run = 0;
                        st.emitted = false;
                        let mat = material(k);
                        if mat != WATER && y + 1 >= min_foot {
                            st.has_floor = true;
                            st.floor_y = y + 1;
                            st.floor_mat = mat;
                            st.floor_flags = if rubble(k) { SPAN_RUBBLE } else { 0 };
                        } else {
                            st.has_floor = false;
                        }
                    }
                }
            }
        }
    }

    // Any span still open to air at the top of the scan window reaches open sky.
    for st in &col_state {
        if st.emitted && st.last_span != u16::MAX {
            raw_spans[st.last_span as usize].clearance = u16::MAX;
        }
    }

    // Pack spans contiguously by column so `col_spans[c]` gives an O(1) slice per column.
    let mut col_spans = [(0u16, 0u8); TILE_COL_COUNT];
    let mut offset = 0u16;
    for c in 0..TILE_COL_COUNT {
        col_spans[c] = (offset, col_counts[c]);
        offset = offset.saturating_add(col_counts[c] as u16);
    }
    let mut write_cursor = [0u16; TILE_COL_COUNT];
    for c in 0..TILE_COL_COUNT {
        write_cursor[c] = col_spans[c].0;
    }
    let mut spans = vec![
        NavSpan {
            y: 0,
            clearance: 0,
            material: 0,
            flags: 0,
            region: u16::MAX,
            edge_start: 0,
            edge_count: 0,
            col: 0,
        };
        raw_spans.len()
    ];
    for s in raw_spans {
        let c = s.col as usize;
        let dst = write_cursor[c] as usize;
        spans[dst] = s;
        write_cursor[c] += 1;
    }

    // Build intra-tile directed neighbor edges along +X/-X and +Z/-Z, probing each wall gap once
    // directly from `region` when available.
    let mut temp_edges: Vec<(u16, SpanEdge)> = Vec::with_capacity(spans.len() * 4);
    let mut probe_solid = |wx: i32, wy: i32, wz: i32| -> bool {
        if let Some(ref reg) = region {
            let lx = wx - x0;
            let ly = wy - y_lo;
            let lz = wz - z0;
            if (0..TILE_CELLS).contains(&lx) && ly >= 0 && (ly as usize) < h && (0..TILE_CELLS).contains(&lz) {
                return reg.cells[lx as usize + 64 * (lz as usize + 64 * ly as usize)] != 0;
            }
        }
        src.kind(wx, wy, wz) != 0
    };

    for cz in 0..TILE_COLS {
        let wz_a = col_center(tz, cz);
        for cx in 0..TILE_COLS {
            let wx_a = col_center(tx, cx);
            let ca = col_index(cx, cz);
            let (sa0, na) = col_spans[ca];
            if na == 0 {
                continue;
            }
            // Pair with +X neighbor.
            if cx + 1 < TILE_COLS {
                let cb = col_index(cx + 1, cz);
                let (sb0, nb) = col_spans[cb];
                let wx_b = col_center(tx, cx + 1);
                for ia in 0..na as u16 {
                    let a_idx = sa0 + ia;
                    let span_a = spans[a_idx as usize];
                    for ib in 0..nb as u16 {
                        let b_idx = sb0 + ib;
                        let span_b = spans[b_idx as usize];
                        let (ab, ba) = classify_transition_with(&mut probe_solid, wx_a, wz_a, &span_a, wx_b, wz_a, &span_b);
                        if ab != MOVE_NONE {
                            temp_edges.push((a_idx, SpanEdge { to_span: b_idx, dir: DIR_POS_X, move_kind: ab }));
                        }
                        if ba != MOVE_NONE {
                            temp_edges.push((b_idx, SpanEdge { to_span: a_idx, dir: DIR_NEG_X, move_kind: ba }));
                        }
                    }
                }
            }
            // Pair with +Z neighbor.
            if cz + 1 < TILE_COLS {
                let cb = col_index(cx, cz + 1);
                let (sb0, nb) = col_spans[cb];
                let wz_b = col_center(tz, cz + 1);
                for ia in 0..na as u16 {
                    let a_idx = sa0 + ia;
                    let span_a = spans[a_idx as usize];
                    for ib in 0..nb as u16 {
                        let b_idx = sb0 + ib;
                        let span_b = spans[b_idx as usize];
                        let (ab, ba) = classify_transition_with(&mut probe_solid, wx_a, wz_a, &span_a, wx_a, wz_b, &span_b);
                        if ab != MOVE_NONE {
                            temp_edges.push((a_idx, SpanEdge { to_span: b_idx, dir: DIR_POS_Z, move_kind: ab }));
                        }
                        if ba != MOVE_NONE {
                            temp_edges.push((b_idx, SpanEdge { to_span: a_idx, dir: DIR_NEG_Z, move_kind: ba }));
                        }
                    }
                }
            }
        }
    }

    // Pack edges into CSR format per span.
    let mut counts = vec![0u16; spans.len()];
    for &(from, _) in &temp_edges {
        counts[from as usize] = counts[from as usize].saturating_add(1);
    }
    let mut edge_off = 0usize;
    let mut cursors = vec![0usize; spans.len()];
    for (i, sp) in spans.iter_mut().enumerate() {
        let c = counts[i].min(u8::MAX as u16);
        sp.edge_start = edge_off.min(u16::MAX as usize) as u16;
        sp.edge_count = c as u8;
        cursors[i] = edge_off;
        edge_off += c as usize;
    }
    let mut edges = vec![SpanEdge { to_span: 0, dir: 0, move_kind: MOVE_NONE }; edge_off];
    for (from, edge) in temp_edges {
        let f = from as usize;
        let end = spans[f].edge_start as usize + spans[f].edge_count as usize;
        if cursors[f] < end {
            edges[cursors[f]] = edge;
            cursors[f] += 1;
        }
    }

    RawHeightfield { tx, tz, col_spans, spans, edges }
}
