//! Tiled destructible navmesh cache, dirty-tile invoker queue, region segmentation,
//! and HPA* cross-tile portal graph (#164).

use crate::bodies::Mix;
use crate::nav::heightfield::{
    DIR_NEG_X, DIR_NEG_Z, DIR_OFFSETS, DIR_POS_X, DIR_POS_Z, MOVE_CLIMB, MOVE_DROP, MOVE_NONE,
    MOVE_VAULT, MOVE_WALK, NAV_STEP, NavSpan, SPAN_RUBBLE, SpanEdge, TILE_CELLS, TILE_COL_COUNT,
    TILE_COLS, VoxelSource, classify_transition, col_center, col_index, extract_tile,
    move_allowed, opposite_dir, world_to_col, world_to_tile,
};
use std::collections::{BinaryHeap, HashMap, HashSet, VecDeque};
use std::cmp::Reverse;
use std::hash::BuildHasherDefault;

pub type TileKey = (i32, i32);
pub type NavMap<K, V> = HashMap<K, V, BuildHasherDefault<Mix>>;
pub type NavSet<K> = HashSet<K, BuildHasherDefault<Mix>>;

/// Maximum contiguous border columns merged into a single cross-tile portal (8 * 40 cm = 3.2 m).
const MAX_PORTAL_WIDTH: usize = 8;
/// Soft cap on cached nav tiles (4096 tiles = ~167,000 m² of detailed 40 cm navmesh).
const MAX_CACHED_TILES: usize = 4096;
/// Maximum dirty box extent in tiles along one axis before restricting invalidation to cached tiles.
const MAX_DIRTY_SPAN: i32 = 48;

/// Directed cross-tile portal endpoint stored on a tile's boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BorderPortal {
    /// Local span index on this tile's border column.
    pub local_span: u16,
    /// Neighbor tile coordinate `(tx, tz)`.
    pub neighbor_tile: TileKey,
    /// Span index on the neighbor tile's facing border column.
    pub neighbor_span: u16,
    /// Cardinal direction from this tile to `neighbor_tile` (`0=+X, 1=-X, 2=+Z, 3=-Z`).
    pub dir: u8,
    /// Transition kind going FROM this tile TO `neighbor_tile` (`MOVE_*`, or `MOVE_NONE`).
    pub move_out: u8,
    /// Transition kind coming FROM `neighbor_tile` TO this tile (`MOVE_*`, or `MOVE_NONE`).
    pub move_in: u8,
    /// Number of contiguous border columns represented by this portal.
    pub width: u8,
    /// World center coordinates of the local portal anchor (fine cells).
    pub wx: i32,
    pub wy: i32,
    pub wz: i32,
}

/// Precomputed shortest-path cost between two portals on the same tile across movement tiers.
#[derive(Clone, Copy, Debug)]
pub struct IntraPortalLink {
    pub from_portal: u16,
    pub to_portal: u16,
    /// Cost using `MOVE_WALK` only (`f32::INFINITY` if unreachable).
    pub cost_walk: f32,
    /// Cost using `MOVE_WALK | MOVE_VAULT | MOVE_DROP`.
    pub cost_parkour: f32,
    /// Cost using all moves including `MOVE_CLIMB`.
    pub cost_climb: f32,
}

/// Complete baked navigation tile (6.4 m × 6.4 m, 16×16 multi-layer columns).
pub struct NavTile {
    pub tx: i32,
    pub tz: i32,
    /// Monotonic generation incremented on every rebake.
    pub generation: u32,
    /// `(start_index, count)` into `spans` for each column `cz * 16 + cx`.
    pub col_spans: [(u16, u8); TILE_COL_COUNT],
    pub spans: Vec<NavSpan>,
    pub edges: Vec<SpanEdge>,
    /// Number of walk-connected regions in this tile.
    pub region_count: u16,
    /// Outgoing/incoming border portals shared with existing cardinal neighbor tiles.
    pub portals: Vec<BorderPortal>,
    /// Precomputed intra-tile portal-to-portal abstract edges for HPA*.
    pub intra_links: Vec<IntraPortalLink>,
    /// Whether `intra_links` needs refreshing after a neighbor tile changed border portals.
    pub abstract_dirty: bool,
    /// Whether this tile has any non-walk intra-tile edges (fast-path skips redundant tiers).
    pub has_special_edges: bool,
    /// Direct border transition pairs cached per border edge for fast fine-level cross-tile stepping.
    /// Indexed by `dir` (`0..4`): entries are `(local_span, neighbor_span, move_out)`.
    pub border_links: [Vec<(u16, u16, u8)>; 4],
}

impl NavTile {
    #[inline]
    pub fn col_slice(&self, cidx: usize) -> (u16, &[NavSpan]) {
        let (start, count) = self.col_spans[cidx];
        (start, &self.spans[start as usize..start as usize + count as usize])
    }

    #[inline]
    pub fn span_edges(&self, span_idx: u16) -> &[SpanEdge] {
        let sp = &self.spans[span_idx as usize];
        let s = sp.edge_start as usize;
        &self.edges[s..s + sp.edge_count as usize]
    }

    /// World center `(wx, wy, wz)` of a local span.
    #[inline]
    pub fn span_world(&self, span_idx: u16) -> (i32, i32, i32) {
        let sp = &self.spans[span_idx as usize];
        let cx = (sp.col as usize) % TILE_COLS;
        let cz = (sp.col as usize) / TILE_COLS;
        (col_center(self.tx, cx), sp.y, col_center(self.tz, cz))
    }

    /// Finds the span in column `(cx, cz)` closest vertically to `target_y` within `max_dy`.
    #[inline]
    pub fn nearest_span_in_col(&self, cx: usize, cz: usize, target_y: i32, max_dy: i32) -> Option<u16> {
        let (start, slice) = self.col_slice(col_index(cx, cz));
        let mut best: Option<(u16, i32)> = None;
        for (i, sp) in slice.iter().enumerate() {
            let dy = (sp.y - target_y).abs();
            if dy <= max_dy && best.is_none_or(|(_, bdy)| dy < bdy) {
                best = Some((start + i as u16, dy));
            }
        }
        best.map(|(idx, _)| idx)
    }

    /// Recomputes `intra_links` between all border portals on this tile.
    pub fn refresh_intra_links(&mut self) {
        self.intra_links.clear();
        self.abstract_dirty = false;
        let np = self.portals.len();
        if np < 2 || self.spans.is_empty() {
            return;
        }
        let n_spans = self.spans.len();
        let mut dist_walk = vec![f32::INFINITY; n_spans];
        let mut dist_parkour = vec![f32::INFINITY; n_spans];
        let mut dist_climb = vec![f32::INFINITY; n_spans];
        let mut heap: BinaryHeap<Reverse<(u32, u16)>> = BinaryHeap::new();

        for i in 0..np {
            let src_span = self.portals[i].local_span;
            // Tier 0: Walk only.
            tile_dijkstra(self, src_span, crate::nav::heightfield::NAV_WALK_ONLY, &mut dist_walk, &mut heap);
            if self.has_special_edges {
                tile_dijkstra(
                    self,
                    src_span,
                    crate::nav::heightfield::NAV_ALLOW_VAULT | crate::nav::heightfield::NAV_ALLOW_DROP,
                    &mut dist_parkour,
                    &mut heap,
                );
                tile_dijkstra(
                    self,
                    src_span,
                    crate::nav::heightfield::NAV_ALLOW_VAULT
                        | crate::nav::heightfield::NAV_ALLOW_DROP
                        | crate::nav::heightfield::NAV_ALLOW_CLIMB,
                    &mut dist_climb,
                    &mut heap,
                );
            }
            for j in 0..np {
                if i == j {
                    continue;
                }
                let dst_span = self.portals[j].local_span as usize;
                let cw = dist_walk[dst_span];
                let (cp, cc) = if self.has_special_edges {
                    (dist_parkour[dst_span], dist_climb[dst_span])
                } else {
                    (cw, cw)
                };
                if cw.is_finite() || cp.is_finite() || cc.is_finite() {
                    self.intra_links.push(IntraPortalLink {
                        from_portal: i as u16,
                        to_portal: j as u16,
                        cost_walk: cw,
                        cost_parkour: cp,
                        cost_climb: cc,
                    });
                }
            }
        }
    }
}

/// Traversal cost of one cardinal step (`NAV_STEP = 4` cells) between two spans.
#[inline]
pub fn edge_step_cost(from_y: i32, to_span: &NavSpan, move_kind: u8) -> f32 {
    let dy = (to_span.y - from_y).abs() as f32;
    let base = NAV_STEP as f32 * if to_span.flags & SPAN_RUBBLE != 0 { 1.25 } else { 1.0 };
    match move_kind {
        MOVE_WALK => base + dy * 0.5,
        MOVE_VAULT => base + 28.0 + dy * 1.0,
        MOVE_DROP => base + 8.0 + dy * 1.2,
        MOVE_CLIMB => base + 40.0 + dy * 2.5,
        _ => f32::INFINITY,
    }
}

/// Fast intra-tile Dijkstra from `start_span` under movement capability `flags`.
pub fn tile_dijkstra(
    tile: &NavTile,
    start_span: u16,
    flags: u32,
    dist: &mut [f32],
    heap: &mut BinaryHeap<Reverse<(u32, u16)>>,
) {
    dist.fill(f32::INFINITY);
    heap.clear();
    let s = start_span as usize;
    if s >= dist.len() {
        return;
    }
    dist[s] = 0.0;
    heap.push(Reverse((0, start_span)));
    while let Some(Reverse((bits, u))) = heap.pop() {
        let d = f32::from_bits(bits);
        if d > dist[u as usize] {
            continue;
        }
        let uy = tile.spans[u as usize].y;
        for e in tile.span_edges(u) {
            if !move_allowed(e.move_kind, flags) {
                continue;
            }
            let v = e.to_span as usize;
            let nd = d + edge_step_cost(uy, &tile.spans[v], e.move_kind);
            if nd < dist[v] {
                dist[v] = nd;
                heap.push(Reverse((nd.to_bits(), e.to_span)));
            }
        }
    }
}

/// Assigns walk-connected region IDs to all spans in `spans`.
fn segment_regions(spans: &mut [NavSpan], edges: &[SpanEdge]) -> u16 {
    let mut region_id = 0u16;
    let mut queue: VecDeque<u16> = VecDeque::with_capacity(64);
    for i in 0..spans.len() {
        if spans[i].region != u16::MAX {
            continue;
        }
        let rid = region_id;
        region_id = region_id.saturating_add(1);
        spans[i].region = rid;
        queue.push_back(i as u16);
        while let Some(u) = queue.pop_front() {
            let start = spans[u as usize].edge_start as usize;
            let end = start + spans[u as usize].edge_count as usize;
            for e in &edges[start..end] {
                if e.move_kind == MOVE_WALK && spans[e.to_span as usize].region == u16::MAX {
                    spans[e.to_span as usize].region = rid;
                    queue.push_back(e.to_span);
                }
            }
        }
    }
    region_id
}

/// Manages cached navigation tiles, dirty invalidation queue, edit Y-bounds, and cross-tile portals.
pub struct TileCache {
    pub tiles: NavMap<TileKey, NavTile>,
    dirty_queue: Vec<TileKey>,
    dirty_set: NavSet<TileKey>,
    /// Recorded edit `(min_y, max_y)` bounds per tile so vertical scans always include deep craters & skybridges.
    edit_y_bounds: NavMap<TileKey, (i32, i32)>,
    generation: u32,
}

impl Default for TileCache {
    fn default() -> Self {
        Self::new()
    }
}

impl TileCache {
    pub fn new() -> Self {
        Self {
            tiles: NavMap::default(),
            dirty_queue: Vec::new(),
            dirty_set: NavSet::default(),
            edit_y_bounds: NavMap::default(),
            generation: 0,
        }
    }

    pub fn clear(&mut self) {
        self.tiles.clear();
        self.dirty_queue.clear();
        self.dirty_set.clear();
        self.edit_y_bounds.clear();
        self.generation = 0;
    }

    #[inline]
    pub fn dirty_count(&self) -> usize {
        self.dirty_queue.len()
    }

    #[inline]
    pub fn tile_count(&self) -> usize {
        self.tiles.len()
    }

    #[inline]
    pub fn get(&self, key: TileKey) -> Option<&NavTile> {
        self.tiles.get(&key)
    }

    #[inline]
    pub fn edit_y_for(&self, key: TileKey) -> Option<(i32, i32)> {
        self.edit_y_bounds.get(&key).copied()
    }

    /// Marks all nav tiles intersecting world fine-cell box `[lo..hi)` dirty, including a 1-tile
    /// border margin so cross-tile portals stay consistent.
    pub fn mark_dirty_box(&mut self, lo: [i32; 3], hi: [i32; 3]) {
        if lo[0] >= hi[0] || lo[2] >= hi[2] {
            return;
        }
        let raw_tx0 = world_to_tile(lo[0]);
        let raw_tx1 = world_to_tile(hi[0].saturating_sub(1));
        let raw_tz0 = world_to_tile(lo[2]);
        let raw_tz1 = world_to_tile(hi[2].saturating_sub(1));

        let tx0 = raw_tx0.saturating_sub(1);
        let tx1 = raw_tx1.saturating_add(1);
        let tz0 = raw_tz0.saturating_sub(1);
        let tz1 = raw_tz1.saturating_add(1);

        let record_y = lo[1] < hi[1] && lo[1] > i32::MIN / 4 && hi[1] < i32::MAX / 4;

        // Guard against unbounded/corrupt edit boxes (e.g. fuzz inputs spanning i32::MIN..i32::MAX).
        if tx1.saturating_sub(tx0) > MAX_DIRTY_SPAN || tz1.saturating_sub(tz0) > MAX_DIRTY_SPAN {
            let keys: Vec<TileKey> = self
                .tiles
                .keys()
                .copied()
                .filter(|&(tx, tz)| tx >= tx0 && tx <= tx1 && tz >= tz0 && tz <= tz1)
                .collect();
            for key in keys {
                self.push_dirty(key);
                if record_y {
                    self.merge_edit_y(key, lo[1], hi[1]);
                }
            }
            return;
        }

        for tz in tz0..=tz1 {
            for tx in tx0..=tx1 {
                let key = (tx, tz);
                self.push_dirty(key);
                if record_y && tx >= raw_tx0 && tx <= raw_tx1 && tz >= raw_tz0 && tz <= raw_tz1 {
                    self.merge_edit_y(key, lo[1], hi[1]);
                }
            }
        }
    }

    #[inline]
    pub fn push_dirty(&mut self, key: TileKey) {
        if self.dirty_set.insert(key) {
            self.dirty_queue.push(key);
        }
    }

    #[inline]
    fn merge_edit_y(&mut self, key: TileKey, y0: i32, y1: i32) {
        self.edit_y_bounds
            .entry(key)
            .and_modify(|(lo, hi)| {
                *lo = (*lo).min(y0);
                *hi = (*hi).max(y1);
            })
            .or_insert((y0, y1));
    }

    /// Rebuilds one tile from `src`, segments regions, and updates cross-tile portals with existing neighbors.
    pub fn bake_tile<S: VoxelSource>(&mut self, src: &mut S, tx: i32, tz: i32) {
        let key = (tx, tz);
        self.dirty_set.remove(&key);

        let edit_y = self.edit_y_for(key);
        let raw = extract_tile(src, tx, tz, edit_y);
        let mut spans = raw.spans;
        let edges = raw.edges;
        let region_count = segment_regions(&mut spans, &edges);
        let has_special_edges = edges.iter().any(|e| e.move_kind != MOVE_WALK);

        self.generation = self.generation.wrapping_add(1).max(1);
        let mut tile = NavTile {
            tx,
            tz,
            generation: self.generation,
            col_spans: raw.col_spans,
            spans,
            edges,
            region_count,
            portals: Vec::new(),
            intra_links: Vec::new(),
            abstract_dirty: true,
            has_special_edges,
            border_links: [Vec::new(), Vec::new(), Vec::new(), Vec::new()],
        };

        // Link borders with each existing cardinal neighbor tile.
        for dir in 0..4u8 {
            let (dx, dz) = DIR_OFFSETS[dir as usize];
            let nkey = (tx + dx, tz + dz);
            if let Some(mut neighbor) = self.tiles.remove(&nkey) {
                let opp = opposite_dir(dir);
                // Strip stale portals and border links on `neighbor` pointing back to `key`.
                neighbor.portals.retain(|p| p.neighbor_tile != key);
                neighbor.border_links[opp as usize].clear();

                build_border_portals(src, &mut tile, &mut neighbor, dir);
                neighbor.abstract_dirty = true;
                self.tiles.insert(nkey, neighbor);
            }
        }

        // Leave `abstract_dirty = true` so intra-tile portal costs refresh lazily on HPA* queries,
        // keeping single-tile incremental rebake latency minimal (< 0.5 ms).
        self.tiles.insert(key, tile);

        if self.tiles.len() > MAX_CACHED_TILES {
            self.evict_furthest(tx, tz);
        }
    }

    /// Sorts the dirty queue by squared distance to `(fx, fz)` (fine cells) and incrementally
    /// rebakes up to `max_tiles` nearest dirty tiles. Returns the number of tiles rebaked.
    pub fn rebake_budget<S: VoxelSource>(
        &mut self,
        src: &mut S,
        fx: f32,
        fz: f32,
        max_tiles: usize,
    ) -> usize {
        if max_tiles == 0 || self.dirty_queue.is_empty() {
            return 0;
        }
        // Drop any keys already baked out-of-band.
        self.dirty_queue.retain(|k| self.dirty_set.contains(k));
        if self.dirty_queue.is_empty() {
            return 0;
        }

        // Sort descending by squared distance so we can `pop()` nearest tiles in O(1).
        self.dirty_queue.sort_unstable_by(|&(ax, az), &(bx, bz)| {
            let da = tile_dist_sq(ax, az, fx, fz);
            let db = tile_dist_sq(bx, bz, fx, fz);
            db.total_cmp(&da)
        });

        let mut baked = 0usize;
        while baked < max_tiles {
            let Some(key) = self.dirty_queue.pop() else { break };
            if !self.dirty_set.remove(&key) {
                continue;
            }
            self.bake_tile(src, key.0, key.1);
            baked += 1;
        }
        baked
    }

    /// Ensures a single tile exists in cache; bakes it if absent.
    pub fn ensure_tile<S: VoxelSource>(&mut self, src: &mut S, key: TileKey) -> bool {
        if self.tiles.contains_key(&key) {
            return false;
        }
        self.bake_tile(src, key.0, key.1);
        true
    }

    /// Refreshes any tile whose `abstract_dirty` flag is set (needed before coarse HPA*).
    pub fn refresh_abstract_if_dirty(&mut self, key: TileKey) {
        if let Some(tile) = self.tiles.get_mut(&key) {
            if tile.abstract_dirty {
                tile.refresh_intra_links();
            }
        }
    }

    /// Snaps world coordinate `(wx, wy, wz)` to the nearest walkable `(TileKey, span_idx)` in cache.
    pub fn snap_to_span(&self, wx: f32, wy: f32, wz: f32) -> Option<(TileKey, u16)> {
        let ix = wx.floor() as i32;
        let iy = wy.round() as i32;
        let iz = wz.floor() as i32;
        let tx = world_to_tile(ix);
        let tz = world_to_tile(iz);
        let cx = world_to_col(ix);
        let cz = world_to_col(iz);

        // 1. Exact column within reasonable height window.
        if let Some(tile) = self.tiles.get(&(tx, tz)) {
            if let Some(sp) = tile.nearest_span_in_col(cx, cz, iy, 24) {
                return Some(((tx, tz), sp));
            }
        }

        // 2. Search expanding ring of columns up to radius 3 (1.2 m) for closest 3D span.
        let mut best: Option<(TileKey, u16, f32)> = None;
        for r in 1..=3i32 {
            for dz in -r..=r {
                for dx in -r..=r {
                    if dx.abs() != r && dz.abs() != r {
                        continue;
                    }
                    let gx = ix + dx * NAV_STEP;
                    let gz = iz + dz * NAV_STEP;
                    let nkey = (world_to_tile(gx), world_to_tile(gz));
                    let Some(tile) = self.tiles.get(&nkey) else { continue };
                    let (start, slice) = tile.col_slice(col_index(world_to_col(gx), world_to_col(gz)));
                    for (i, sp) in slice.iter().enumerate() {
                        let dy = (sp.y - iy) as f32;
                        if dy.abs() > 48.0 {
                            continue;
                        }
                        let sx = col_center(nkey.0, world_to_col(gx)) as f32;
                        let sz = col_center(nkey.1, world_to_col(gz)) as f32;
                        let d2 = (sx - wx) * (sx - wx) + (sz - wz) * (sz - wz) + dy * dy * 4.0;
                        if best.is_none_or(|(_, _, bd2)| d2 < bd2) {
                            best = Some((nkey, start + i as u16, d2));
                        }
                    }
                }
            }
            if best.is_some() {
                break;
            }
        }
        if let Some((k, sp, _)) = best {
            return Some((k, sp));
        }

        // 3. Last resort: any height in the exact column.
        if let Some(tile) = self.tiles.get(&(tx, tz)) {
            if let Some(sp) = tile.nearest_span_in_col(cx, cz, iy, i32::MAX / 2) {
                return Some(((tx, tz), sp));
            }
        }
        None
    }

    fn evict_furthest(&mut self, keep_tx: i32, keep_tz: i32) {
        let target = MAX_CACHED_TILES - MAX_CACHED_TILES / 8;
        let mut entries: Vec<(TileKey, i64)> = self
            .tiles
            .keys()
            .map(|&(tx, tz)| {
                let dx = (tx - keep_tx) as i64;
                let dz = (tz - keep_tz) as i64;
                ((tx, tz), dx * dx + dz * dz)
            })
            .collect();
        entries.sort_unstable_by_key(|&(_, d2)| std::cmp::Reverse(d2));
        let drop_n = self.tiles.len().saturating_sub(target);
        for &(key, _) in entries.iter().take(drop_n) {
            self.tiles.remove(&key);
            for dir in 0..4u8 {
                let (dx, dz) = DIR_OFFSETS[dir as usize];
                let nkey = (key.0 + dx, key.1 + dz);
                if let Some(n) = self.tiles.get_mut(&nkey) {
                    let opp = opposite_dir(dir);
                    n.portals.retain(|p| p.neighbor_tile != key);
                    n.border_links[opp as usize].clear();
                    n.abstract_dirty = true;
                }
            }
        }
    }
}

#[inline]
fn tile_dist_sq(tx: i32, tz: i32, fx: f32, fz: f32) -> f32 {
    let cx = tx as f32 * TILE_CELLS as f32 + (TILE_CELLS as f32 * 0.5);
    let cz = tz as f32 * TILE_CELLS as f32 + (TILE_CELLS as f32 * 0.5);
    let dx = cx - fx;
    let dz = cz - fz;
    dx * dx + dz * dz
}

/// Scans the shared 16-column border between `tile_a` and `tile_b` (with `tile_b` in direction `dir`
/// from `tile_a`), populating both fine `border_links` and merged coarse `BorderPortal`s on both tiles.
fn build_border_portals<S: VoxelSource>(
    src: &mut S,
    tile_a: &mut NavTile,
    tile_b: &mut NavTile,
    dir: u8,
) {
    let opp = opposite_dir(dir);
    let key_a = (tile_a.tx, tile_a.tz);
    let key_b = (tile_b.tx, tile_b.tz);

    // Candidate border link along the 16 positions `p in 0..TILE_COLS`.
    #[derive(Clone, Copy)]
    struct Pair {
        pos: usize,
        span_a: u16,
        span_b: u16,
        reg_a: u16,
        reg_b: u16,
        move_ab: u8,
        move_ba: u8,
    }

    let mut pairs: Vec<Pair> = Vec::with_capacity(32);

    for p in 0..TILE_COLS {
        let (cxa, cza, cxb, czb) = match dir {
            DIR_POS_X => (TILE_COLS - 1, p, 0, p),
            DIR_NEG_X => (0, p, TILE_COLS - 1, p),
            DIR_POS_Z => (p, TILE_COLS - 1, p, 0),
            DIR_NEG_Z => (p, 0, p, TILE_COLS - 1),
            _ => unreachable!(),
        };
        let wx_a = col_center(tile_a.tx, cxa);
        let wz_a = col_center(tile_a.tz, cza);
        let wx_b = col_center(tile_b.tx, cxb);
        let wz_b = col_center(tile_b.tz, czb);

        let (sa0, na) = tile_a.col_spans[col_index(cxa, cza)];
        let (sb0, nb) = tile_b.col_spans[col_index(cxb, czb)];
        for ia in 0..na as u16 {
            let a_idx = sa0 + ia;
            let span_a = tile_a.spans[a_idx as usize];
            for ib in 0..nb as u16 {
                let b_idx = sb0 + ib;
                let span_b = tile_b.spans[b_idx as usize];
                let (ab, ba) = classify_transition(src, wx_a, wz_a, &span_a, wx_b, wz_b, &span_b);
                if ab == MOVE_NONE && ba == MOVE_NONE {
                    continue;
                }
                if ab != MOVE_NONE {
                    tile_a.border_links[dir as usize].push((a_idx, b_idx, ab));
                }
                if ba != MOVE_NONE {
                    tile_b.border_links[opp as usize].push((b_idx, a_idx, ba));
                }
                pairs.push(Pair {
                    pos: p,
                    span_a: a_idx,
                    span_b: b_idx,
                    reg_a: span_a.region,
                    reg_b: span_b.region,
                    move_ab: ab,
                    move_ba: ba,
                });
            }
        }
    }

    if pairs.is_empty() {
        return;
    }

    // Group contiguous runs sharing `(reg_a, reg_b, move_ab, move_ba)` into compact portals.
    // Sort by group key then border position so multi-layer overlaps stay separated cleanly.
    pairs.sort_unstable_by_key(|p| (p.reg_a, p.reg_b, p.move_ab, p.move_ba, p.pos));

    let mut i = 0usize;
    while i < pairs.len() {
        let head = pairs[i];
        let mut j = i + 1;
        while j < pairs.len()
            && j - i < MAX_PORTAL_WIDTH
            && pairs[j].reg_a == head.reg_a
            && pairs[j].reg_b == head.reg_b
            && pairs[j].move_ab == head.move_ab
            && pairs[j].move_ba == head.move_ba
            && pairs[j].pos == pairs[j - 1].pos + 1
        {
            j += 1;
        }
        let mid = pairs[(i + j - 1) / 2];
        let width = (j - i) as u8;
        let (wxa, wya, wza) = tile_a.span_world(mid.span_a);
        let (wxb, wyb, wzb) = tile_b.span_world(mid.span_b);

        tile_a.portals.push(BorderPortal {
            local_span: mid.span_a,
            neighbor_tile: key_b,
            neighbor_span: mid.span_b,
            dir,
            move_out: mid.move_ab,
            move_in: mid.move_ba,
            width,
            wx: wxa,
            wy: wya,
            wz: wza,
        });
        tile_b.portals.push(BorderPortal {
            local_span: mid.span_b,
            neighbor_tile: key_a,
            neighbor_span: mid.span_a,
            dir: opp,
            move_out: mid.move_ba,
            move_in: mid.move_ab,
            width,
            wx: wxb,
            wy: wyb,
            wz: wzb,
        });

        i = j;
    }
}
