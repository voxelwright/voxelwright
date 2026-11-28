//! Hierarchical HPA* portal pathfinding, local tile-level A* refinement,
//! and multi-layer line-of-sight string-pulling / funnel smoothing (#164).

use crate::nav::heightfield::{
    DIR_OFFSETS, MOVE_WALK, NAV_ALLOW_CLIMB, NAV_ALLOW_DROP, NAV_ALLOW_VAULT, NAV_STEP,
    NAV_WALK_ONLY, TILE_COLS, VoxelSource, move_allowed, opposite_dir, world_to_tile,
};
use crate::nav::tiles::{NavMap, NavSet, NavTile, TileCache, TileKey, edge_step_cost, tile_dijkstra};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// Maximum on-demand tiles baked during a single `find_path` call so a distant query cannot stall.
const MAX_ON_DEMAND_TILES: usize = 196;
/// Maximum fine-level A* node expansions per search.
const MAX_FINE_EXPANSIONS: usize = 16_384;
/// Maximum coarse HPA* portal expansions per search.
const MAX_PORTAL_EXPANSIONS: usize = 4_096;

/// One waypoint in the smoothed output path (stored as 4 `f32`s in WASM linear memory).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Waypoint {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub move_kind: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct SpanRef {
    tile: TileKey,
    span: u16,
}

/// Finds a multi-layer path from `(sx, sy, sz)` to `(gx, gy, gz)` under capability `flags`,
/// writing compact `[x, y, z, move_kind]` floats into `out` and returning the waypoint count.
#[allow(clippy::too_many_arguments)]
pub fn find_path<S: VoxelSource>(
    cache: &mut TileCache,
    src: &mut S,
    sx: f32,
    sy: f32,
    sz: f32,
    gx: f32,
    gy: f32,
    gz: f32,
    flags: u32,
    out: &mut Vec<f32>,
) -> usize {
    out.clear();
    if !sx.is_finite() || !sy.is_finite() || !sz.is_finite() || !gx.is_finite() || !gy.is_finite() || !gz.is_finite() {
        return 0;
    }

    let stx = world_to_tile(sx.floor() as i32);
    let stz = world_to_tile(sz.floor() as i32);
    let gtx = world_to_tile(gx.floor() as i32);
    let gtz = world_to_tile(gz.floor() as i32);

    // Ensure tiles in a padded corridor around start and goal exist in cache.
    let tile_dist = (stx - gtx).abs().max((stz - gtz).abs());
    let pad = if tile_dist <= 2 { 1 } else { 2 };
    let min_tx = stx.min(gtx) - pad;
    let max_tx = stx.max(gtx) + pad;
    let min_tz = stz.min(gtz) - pad;
    let max_tz = stz.max(gtz) + pad;

    let mut baked = 0usize;
    // Always ensure start & goal tiles first.
    for key in [(stx, stz), (gtx, gtz)] {
        if cache.ensure_tile(src, key) {
            baked += 1;
        }
    }
    'fill: for tz in min_tz..=max_tz {
        for tx in min_tx..=max_tx {
            if baked >= MAX_ON_DEMAND_TILES {
                break 'fill;
            }
            if cache.ensure_tile(src, (tx, tz)) {
                baked += 1;
            }
        }
    }

    let Some((start_tile, start_span)) = cache.snap_to_span(sx, sy, sz) else {
        return 0;
    };
    let Some((goal_tile, goal_span)) = cache.snap_to_span(gx, gy, gz) else {
        return 0;
    };

    if start_tile == goal_tile && start_span == goal_span {
        let Some(tile) = cache.get(goal_tile) else { return 0 };
        let (_, wy, _) = tile.span_world(goal_span);
        out.extend_from_slice(&[gx, wy as f32, gz, MOVE_WALK as f32]);
        return 1;
    }

    let start = SpanRef { tile: start_tile, span: start_span };
    let goal = SpanRef { tile: goal_tile, span: goal_span };

    // Short-range queries (within 2 tiles): run direct fine-column A* over the local window.
    let raw_steps = if tile_dist <= 2 {
        let mut allowed = NavSet::default();
        for tz in (start_tile.1.min(goal_tile.1) - 1)..=(start_tile.1.max(goal_tile.1) + 1) {
            for tx in (start_tile.0.min(goal_tile.0) - 1)..=(start_tile.0.max(goal_tile.0) + 1) {
                if cache.get((tx, tz)).is_some() {
                    allowed.insert((tx, tz));
                }
            }
        }
        fine_astar(cache, start, goal, flags, Some(&allowed))
    } else {
        // Longer queries: coarse HPA* over cross-tile portals -> fine A* refinement inside the tile corridor.
        let corridor = coarse_hpa_corridor(cache, start, goal, flags);
        if let Some(mut tiles_set) = corridor {
            // Expand corridor by 1 tile around portal tiles (already cached only) so local refinement
            // cuts cleanly across corners without detouring through portal midpoints.
            let base: Vec<TileKey> = tiles_set.iter().copied().collect();
            for (tx, tz) in base {
                for &(dx, dz) in &DIR_OFFSETS {
                    let nk = (tx + dx, tz + dz);
                    if cache.get(nk).is_some() {
                        tiles_set.insert(nk);
                    }
                }
            }
            fine_astar(cache, start, goal, flags, Some(&tiles_set))
                .or_else(|| {
                    if tile_dist <= 8 {
                        fine_astar(cache, start, goal, flags, None)
                    } else {
                        None
                    }
                })
        } else if tile_dist <= 8 {
            // Fallback for narrow single-flag edge cases where coarse portal tiers didn't connect.
            fine_astar(cache, start, goal, flags, None)
        } else {
            None
        }
    };

    let Some(steps) = raw_steps else {
        return 0;
    };

    let smoothed = string_pull(cache, &steps);
    out.reserve(smoothed.len() * 4);
    for (idx, wp) in smoothed.iter().enumerate() {
        // Preserve exact snapped elevation; use exact requested start/goal XZ if on the same column.
        let mut x = wp.x;
        let mut z = wp.z;
        if idx == 0 {
            let dx = (sx - wp.x).abs();
            let dz = (sz - wp.z).abs();
            if dx <= NAV_STEP as f32 * 0.5 && dz <= NAV_STEP as f32 * 0.5 {
                x = sx;
                z = sz;
            }
        } else if idx + 1 == smoothed.len() {
            let dx = (gx - wp.x).abs();
            let dz = (gz - wp.z).abs();
            if dx <= NAV_STEP as f32 * 0.5 && dz <= NAV_STEP as f32 * 0.5 {
                x = gx;
                z = gz;
            }
        }
        out.extend_from_slice(&[x, wp.y, z, wp.move_kind as f32]);
    }
    smoothed.len()
}

/// Coarse HPA* search over cross-tile portals. Returns the set of tiles on the optimal portal chain.
fn coarse_hpa_corridor(
    cache: &mut TileCache,
    start: SpanRef,
    goal: SpanRef,
    flags: u32,
) -> Option<NavSet<TileKey>> {
    // Refresh dirty abstract portal links for start & goal tiles up front.
    cache.refresh_abstract_if_dirty(start.tile);
    cache.refresh_abstract_if_dirty(goal.tile);

    let (gx, gy, gz) = {
        let gt = cache.get(goal.tile)?;
        gt.span_world(goal.span)
    };

    // 1. Distances from `start.span` to every portal on `start.tile`.
    let start_portal_dists: Vec<(u16, f32)> = {
        let st = cache.get(start.tile)?;
        let mut dist = vec![f32::INFINITY; st.spans.len()];
        let mut heap = BinaryHeap::new();
        tile_dijkstra(st, start.span, flags, &mut dist, &mut heap);
        st.portals
            .iter()
            .enumerate()
            .filter_map(|(pi, p)| {
                let d = dist[p.local_span as usize];
                d.is_finite().then_some((pi as u16, d))
            })
            .collect()
    };
    if start_portal_dists.is_empty() {
        return None;
    }

    // 2. Distances from every portal on `goal.tile` to `goal.span` (reverse intra-tile Dijkstra).
    let goal_portal_dists: NavMap<u16, f32> = {
        let gt = cache.get(goal.tile)?;
        let rev = tile_dijkstra_reverse(gt, goal.span, flags);
        gt.portals
            .iter()
            .enumerate()
            .filter_map(|(pi, p)| {
                let d = rev[p.local_span as usize];
                d.is_finite().then_some((pi as u16, d))
            })
            .collect()
    };
    if goal_portal_dists.is_empty() {
        return None;
    }

    #[derive(Clone, Copy, PartialEq, Eq, Hash)]
    struct PNode {
        tile: TileKey,
        portal: u16,
    }

    let mut g_score: NavMap<PNode, f32> = NavMap::default();
    let mut parent: NavMap<PNode, PNode> = NavMap::default();
    let mut open: BinaryHeap<Reverse<(u32, TileKey, u16)>> = BinaryHeap::new();

    for &(pi, d) in &start_portal_dists {
        let node = PNode { tile: start.tile, portal: pi };
        let Some(tile) = cache.get(start.tile) else { continue };
        let p = tile.portals[pi as usize];
        let f = d + heuristic_3d(p.wx, p.wy, p.wz, gx, gy, gz);
        g_score.insert(node, d);
        open.push(Reverse((f.to_bits(), start.tile, pi)));
    }

    let mut best_goal: Option<(PNode, f32)> = None;
    let mut expansions = 0usize;

    while let Some(Reverse((f_bits, tile_key, portal_idx))) = open.pop() {
        let f_cur = f32::from_bits(f_bits);
        if best_goal.is_some_and(|(_, best_cost)| f_cur >= best_cost) {
            break;
        }
        let cur = PNode { tile: tile_key, portal: portal_idx };
        let g_cur = *g_score.get(&cur).unwrap_or(&f32::INFINITY);
        if !g_cur.is_finite() {
            continue;
        }
        expansions += 1;
        if expansions > MAX_PORTAL_EXPANSIONS {
            break;
        }

        // Check if this portal sits on `goal.tile` and reaches `goal.span`.
        if tile_key == goal.tile {
            if let Some(&to_goal) = goal_portal_dists.get(&portal_idx) {
                let total = g_cur + to_goal;
                if best_goal.is_none_or(|(_, bc)| total < bc) {
                    best_goal = Some((cur, total));
                }
            }
        }

        // Ensure tile's intra-tile links are fresh.
        cache.refresh_abstract_if_dirty(tile_key);

        let Some(tile) = cache.get(tile_key) else { continue };
        let p = tile.portals[portal_idx as usize];

        // A. Cross-tile transition through this portal to its matched portal on `p.neighbor_tile`.
        if move_allowed(p.move_out, flags) {
            if let Some(ntile) = cache.get(p.neighbor_tile) {
                if let Some(npi) = ntile.portals.iter().position(|np| {
                    np.neighbor_tile == tile_key
                        && np.local_span == p.neighbor_span
                        && np.dir == opposite_dir(p.dir)
                }) {
                    let step = edge_step_cost(p.wy, &ntile.spans[p.neighbor_span as usize], p.move_out);
                    let ng = g_cur + step;
                    let next = PNode { tile: p.neighbor_tile, portal: npi as u16 };
                    if ng < *g_score.get(&next).unwrap_or(&f32::INFINITY) {
                        g_score.insert(next, ng);
                        parent.insert(next, cur);
                        let np = ntile.portals[npi];
                        let nf = ng + heuristic_3d(np.wx, np.wy, np.wz, gx, gy, gz);
                        open.push(Reverse((nf.to_bits(), next.tile, next.portal)));
                    }
                }
            }
        }

        // B. Intra-tile transitions to sibling portals on the same tile.
        let tile = cache.get(tile_key).unwrap();
        for link in &tile.intra_links {
            if link.from_portal != portal_idx {
                continue;
            }
            let cost = pick_intra_cost(link, flags);
            if !cost.is_finite() {
                continue;
            }
            let ng = g_cur + cost;
            let next = PNode { tile: tile_key, portal: link.to_portal };
            if ng < *g_score.get(&next).unwrap_or(&f32::INFINITY) {
                g_score.insert(next, ng);
                parent.insert(next, cur);
                let np = tile.portals[link.to_portal as usize];
                let nf = ng + heuristic_3d(np.wx, np.wy, np.wz, gx, gy, gz);
                open.push(Reverse((nf.to_bits(), next.tile, next.portal)));
            }
        }
    }

    let (end_node, _) = best_goal?;
    let mut corridor = NavSet::default();
    corridor.insert(start.tile);
    corridor.insert(goal.tile);
    let mut cursor = end_node;
    loop {
        corridor.insert(cursor.tile);
        if let Some(&prev) = parent.get(&cursor) {
            cursor = prev;
        } else {
            break;
        }
    }
    Some(corridor)
}

#[inline]
fn pick_intra_cost(link: &crate::nav::tiles::IntraPortalLink, flags: u32) -> f32 {
    if flags & NAV_WALK_ONLY != 0 {
        return link.cost_walk;
    }
    if flags == 0 {
        return link.cost_parkour;
    }
    if flags & NAV_ALLOW_CLIMB != 0 {
        return link.cost_climb;
    }
    if flags & (NAV_ALLOW_VAULT | NAV_ALLOW_DROP) != 0 {
        return link.cost_parkour;
    }
    link.cost_walk
}

/// Reverse intra-tile Dijkstra: shortest distance from every span on `tile` to `goal_span`.
fn tile_dijkstra_reverse(tile: &NavTile, goal_span: u16, flags: u32) -> Vec<f32> {
    let n = tile.spans.len();
    let mut rev_adj: Vec<Vec<(u16, f32)>> = vec![Vec::new(); n];
    for u in 0..n {
        let uy = tile.spans[u].y;
        for e in tile.span_edges(u as u16) {
            if move_allowed(e.move_kind, flags) {
                let c = edge_step_cost(uy, &tile.spans[e.to_span as usize], e.move_kind);
                rev_adj[e.to_span as usize].push((u as u16, c));
            }
        }
    }
    let mut dist = vec![f32::INFINITY; n];
    let mut heap: BinaryHeap<Reverse<(u32, u16)>> = BinaryHeap::new();
    let g = goal_span as usize;
    if g < n {
        dist[g] = 0.0;
        heap.push(Reverse((0, goal_span)));
    }
    while let Some(Reverse((bits, v))) = heap.pop() {
        let d = f32::from_bits(bits);
        if d > dist[v as usize] {
            continue;
        }
        for &(u, cost) in &rev_adj[v as usize] {
            let nd = d + cost;
            if nd < dist[u as usize] {
                dist[u as usize] = nd;
                heap.push(Reverse((nd.to_bits(), u)));
            }
        }
    }
    dist
}

/// Column-level A* over cached tiles (optionally restricted to `allowed_tiles`), supporting
/// cardinal Walk/Vault/Drop/Climb edges plus corner-safe diagonal Walk steps.
fn fine_astar(
    cache: &TileCache,
    start: SpanRef,
    goal: SpanRef,
    flags: u32,
    allowed_tiles: Option<&NavSet<TileKey>>,
) -> Option<Vec<(SpanRef, u8)>> {
    let (gx, gy, gz) = cache.get(goal.tile)?.span_world(goal.span);

    let mut g_score: NavMap<SpanRef, f32> = NavMap::default();
    let mut came_from: NavMap<SpanRef, (SpanRef, u8)> = NavMap::default();
    let mut open: BinaryHeap<Reverse<(u32, TileKey, u16)>> = BinaryHeap::new();

    let (sx, sy, sz) = cache.get(start.tile)?.span_world(start.span);
    g_score.insert(start, 0.0);
    open.push(Reverse((heuristic_3d(sx, sy, sz, gx, gy, gz).to_bits(), start.tile, start.span)));

    let mut expansions = 0usize;
    let mut found = false;

    while let Some(Reverse((_, tkey, sidx))) = open.pop() {
        let cur = SpanRef { tile: tkey, span: sidx };
        if cur == goal {
            found = true;
            break;
        }
        let g_cur = *g_score.get(&cur).unwrap_or(&f32::INFINITY);
        if !g_cur.is_finite() {
            continue;
        }
        expansions += 1;
        if expansions > MAX_FINE_EXPANSIONS {
            break;
        }

        let Some(tile) = cache.get(tkey) else { continue };
        let cur_y = tile.spans[sidx as usize].y;
        let mut walk_card: [Option<SpanRef>; 4] = [None; 4];

        // 1. Intra-tile cardinal edges.
        for e in tile.span_edges(sidx) {
            if !move_allowed(e.move_kind, flags) {
                continue;
            }
            let next = SpanRef { tile: tkey, span: e.to_span };
            if e.move_kind == MOVE_WALK && (e.dir as usize) < 4 {
                walk_card[e.dir as usize] = Some(next);
            }
            let step = edge_step_cost(cur_y, &tile.spans[e.to_span as usize], e.move_kind);
            let ng = g_cur + step;
            if ng < *g_score.get(&next).unwrap_or(&f32::INFINITY) {
                g_score.insert(next, ng);
                came_from.insert(next, (cur, e.move_kind));
                let (nx, ny, nz) = tile.span_world(e.to_span);
                let nf = ng + heuristic_3d(nx, ny, nz, gx, gy, gz);
                open.push(Reverse((nf.to_bits(), next.tile, next.span)));
            }
        }

        // 2. Cross-tile border edges if this span sits on a tile edge.
        let col = tile.spans[sidx as usize].col as usize;
        let cx = col % TILE_COLS;
        let cz = col / TILE_COLS;
        let on_border = [cx == TILE_COLS - 1, cx == 0, cz == TILE_COLS - 1, cz == 0];
        for dir in 0..4usize {
            if !on_border[dir] {
                continue;
            }
            let (dx, dz) = DIR_OFFSETS[dir];
            let nkey = (tkey.0 + dx, tkey.1 + dz);
            if let Some(allowed) = allowed_tiles {
                if !allowed.contains(&nkey) {
                    continue;
                }
            }
            let Some(ntile) = cache.get(nkey) else { continue };
            for &(from_sp, to_sp, mk) in &tile.border_links[dir] {
                if from_sp != sidx || !move_allowed(mk, flags) {
                    continue;
                }
                let next = SpanRef { tile: nkey, span: to_sp };
                if mk == MOVE_WALK {
                    walk_card[dir] = Some(next);
                }
                let step = edge_step_cost(cur_y, &ntile.spans[to_sp as usize], mk);
                let ng = g_cur + step;
                if ng < *g_score.get(&next).unwrap_or(&f32::INFINITY) {
                    g_score.insert(next, ng);
                    came_from.insert(next, (cur, mk));
                    let (nx, ny, nz) = ntile.span_world(to_sp);
                    let nf = ng + heuristic_3d(nx, ny, nz, gx, gy, gz);
                    open.push(Reverse((nf.to_bits(), next.tile, next.span)));
                }
            }
        }

        // 3. Corner-safe diagonal Walk steps: allowed ONLY when BOTH orthogonal walk neighbors exist
        // AND both step cleanly into the shared diagonal span (never clips wall corners or craters).
        const DIAG_PAIRS: [(usize, usize); 4] = [(0, 2), (0, 3), (1, 2), (1, 3)];
        for &(d_x, d_z) in &DIAG_PAIRS {
            let (Some(nx_ref), Some(nz_ref)) = (walk_card[d_x], walk_card[d_z]) else {
                continue;
            };
            let Some(diag_a) = walk_step_dir(cache, nx_ref, d_z as u8) else { continue };
            let Some(diag_b) = walk_step_dir(cache, nz_ref, d_x as u8) else { continue };
            if diag_a != diag_b {
                continue;
            }
            if let Some(allowed) = allowed_tiles {
                if !allowed.contains(&diag_a.tile) {
                    continue;
                }
            }
            let Some(dtile) = cache.get(diag_a.tile) else { continue };
            let dy = (dtile.spans[diag_a.span as usize].y - cur_y).abs() as f32;
            let step = (NAV_STEP as f32) * std::f32::consts::SQRT_2 + dy * 0.5;
            let ng = g_cur + step;
            if ng < *g_score.get(&diag_a).unwrap_or(&f32::INFINITY) {
                g_score.insert(diag_a, ng);
                came_from.insert(diag_a, (cur, MOVE_WALK));
                let (nx, ny, nz) = dtile.span_world(diag_a.span);
                let nf = ng + heuristic_3d(nx, ny, nz, gx, gy, gz);
                open.push(Reverse((nf.to_bits(), diag_a.tile, diag_a.span)));
            }
        }
    }

    if !found {
        return None;
    }

    let mut path = Vec::new();
    let mut cursor = goal;
    while cursor != start {
        let &(prev, mk) = came_from.get(&cursor)?;
        path.push((cursor, mk));
        cursor = prev;
    }
    path.push((start, MOVE_WALK));
    path.reverse();
    Some(path)
}

/// Steps one cardinal nav column along `dir` via `MOVE_WALK` (intra-tile or cross-tile).
#[inline]
fn walk_step_dir(cache: &TileCache, from: SpanRef, dir: u8) -> Option<SpanRef> {
    let tile = cache.get(from.tile)?;
    for e in tile.span_edges(from.span) {
        if e.dir == dir && e.move_kind == MOVE_WALK {
            return Some(SpanRef { tile: from.tile, span: e.to_span });
        }
    }
    let (dx, dz) = DIR_OFFSETS[dir as usize];
    let nkey = (from.tile.0 + dx, from.tile.1 + dz);
    for &(fs, ts, mk) in &tile.border_links[dir as usize] {
        if fs == from.span && mk == MOVE_WALK {
            return Some(SpanRef { tile: nkey, span: ts });
        }
    }
    None
}

/// String-pulling / visibility smoothing over the multi-layer heightfield.
/// Collapses redundant collinear / zig-zag `MOVE_WALK` segments while preserving every
/// `Vault`, `Drop`, and `Climb` takeoff/landing anchor and never cutting across walls or craters.
fn string_pull(cache: &TileCache, steps: &[(SpanRef, u8)]) -> Vec<Waypoint> {
    if steps.is_empty() {
        return Vec::new();
    }
    let to_wp = |sr: SpanRef, mk: u8| -> Waypoint {
        let (x, y, z) = cache.get(sr.tile).map_or((0, 0, 0), |t| t.span_world(sr.span));
        Waypoint { x: x as f32, y: y as f32, z: z as f32, move_kind: mk }
    };
    if steps.len() <= 2 {
        return steps.iter().map(|&(sr, mk)| to_wp(sr, mk)).collect();
    }

    let mut out = Vec::with_capacity(steps.len());
    out.push(to_wp(steps[0].0, MOVE_WALK));

    let mut anchor = 0usize;
    while anchor + 1 < steps.len() {
        // If the very next step is a special move (Vault/Drop/Climb), emit it directly.
        if steps[anchor + 1].1 != MOVE_WALK {
            anchor += 1;
            out.push(to_wp(steps[anchor].0, steps[anchor].1));
            continue;
        }
        // Find the end of the contiguous `MOVE_WALK` run starting from `anchor`.
        // Stop BEFORE any special move's landing so its exact takeoff anchor stays intact.
        let mut run_end = anchor + 1;
        while run_end + 1 < steps.len() && steps[run_end + 1].1 == MOVE_WALK {
            run_end += 1;
        }
        // Greedily jump to the furthest visible waypoint inside `anchor + 1 ..= run_end`.
        let mut furthest = anchor + 1;
        for cand in ((anchor + 2)..=run_end).rev() {
            if walk_line_of_sight(cache, steps[anchor].0, steps[cand].0) {
                furthest = cand;
                break;
            }
        }
        anchor = furthest;
        out.push(to_wp(steps[anchor].0, MOVE_WALK));
    }

    out
}

/// Verifies a continuous, corner-safe `MOVE_WALK` line of sight across nav columns from `a` to `b`.
fn walk_line_of_sight(cache: &TileCache, a: SpanRef, b: SpanRef) -> bool {
    let (Some(ta), Some(tb)) = (cache.get(a.tile), cache.get(b.tile)) else {
        return false;
    };
    let (ax, _, az) = ta.span_world(a.span);
    let (bx, _, bz) = tb.span_world(b.span);
    let gx0 = (ax - NAV_STEP / 2).div_euclid(NAV_STEP);
    let gz0 = (az - NAV_STEP / 2).div_euclid(NAV_STEP);
    let gx1 = (bx - NAV_STEP / 2).div_euclid(NAV_STEP);
    let gz1 = (bz - NAV_STEP / 2).div_euclid(NAV_STEP);

    let dx = (gx1 - gx0).abs();
    let dz = (gz1 - gz0).abs();
    let sx = (gx1 - gx0).signum();
    let sz = (gz1 - gz0).signum();

    let dir_x = if sx > 0 { 0u8 } else { 1u8 };
    let dir_z = if sz > 0 { 2u8 } else { 3u8 };

    let mut x = gx0;
    let mut z = gz0;
    let mut err = dx - dz;
    let mut cur = a;
    let max_steps = (dx + dz + 2) as usize;

    for _ in 0..max_steps {
        if x == gx1 && z == gz1 {
            return cur == b;
        }
        let e2 = err * 2;
        let step_x = e2 > -dz && x != gx1;
        let step_z = e2 < dx && z != gz1;

        if step_x && step_z {
            // Diagonal step: verify BOTH orthogonal shoulders pass cleanly (prevents clipping corners/craters).
            let Some(nx) = walk_step_dir(cache, cur, dir_x) else { return false };
            let Some(nz) = walk_step_dir(cache, cur, dir_z) else { return false };
            let Some(da) = walk_step_dir(cache, nx, dir_z) else { return false };
            let Some(db) = walk_step_dir(cache, nz, dir_x) else { return false };
            if da != db {
                return false;
            }
            cur = da;
            err -= dz;
            err += dx;
            x += sx;
            z += sz;
        } else if step_x {
            let Some(nx) = walk_step_dir(cache, cur, dir_x) else { return false };
            cur = nx;
            err -= dz;
            x += sx;
        } else if step_z {
            let Some(nz) = walk_step_dir(cache, cur, dir_z) else { return false };
            cur = nz;
            err += dx;
            z += sz;
        } else {
            break;
        }
    }
    cur == b
}

#[inline]
fn heuristic_3d(x0: i32, y0: i32, z0: i32, x1: i32, y1: i32, z1: i32) -> f32 {
    let dx = (x1 - x0) as f32;
    let dy = (y1 - y0) as f32;
    let dz = (z1 - z0) as f32;
    (dx * dx + dz * dz).sqrt() + dy.abs() * 0.5
}
