//! Multi-threat panic flow fields over walkable nav tiles (#164).
//!
//! Uses a two-pass Safe-Boundary Dijkstra over walkable tile spans within the threat radii:
//! 1. Compute threat distance & local danger cost around all active threats (explosions, gunfire).
//! 2. Propagate escape cost inward from the safe outer frontier (or furthest corner if enclosed),
//!    penalizing proximity to threat cores so panicking crowds route cleanly *around* walls,
//!    craters, and explosions rather than dead-ending against obstacles.
//!
//! Sampling `FlowField::sample(x, y, z)` runs in O(1) per agent (hundreds of panicking NPCs
//! per tick with zero per-agent A* searches).

use crate::nav::heightfield::{
    DIR_OFFSETS, MOVE_DROP, MOVE_VAULT, MOVE_WALK, NAV_STEP, TILE_CELLS, TILE_COLS, VoxelSource,
    col_center, col_index, world_to_col, world_to_tile,
};
use crate::nav::tiles::{TileCache, edge_step_cost};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// Maximum threat radius clamped per threat source (500 cells = 50 m).
const MAX_THREAT_RADIUS: f32 = 500.0;
/// Maximum flow bounding box width/height in nav tiles (20 * 6.4 m = 128 m across).
const MAX_FLOW_TILES_SIDE: i32 = 20;

#[derive(Clone, Copy, Debug)]
pub struct Threat {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub radius: f32,
}

/// Built panic flow field ready for O(1) per-agent sampling.
#[derive(Default)]
pub struct FlowField {
    threats: Vec<Threat>,
    /// Tile bounding box of the built flow field (`[tx0..tx0+grid_w, tz0..tz0+grid_h)`).
    tx0: i32,
    tz0: i32,
    grid_w: usize,
    grid_h: usize,
    /// Per-tile offset into `vectors` (`u32::MAX` if tile not included).
    tile_offsets: Vec<u32>,
    /// Unit escape vector `[dx, dz]` per dense span index (`[0.0, 0.0]` outside danger / safe).
    vectors: Vec<[f32; 2]>,
    /// Reusable output slot for WASM C-ABI `nav_flow_sample` / `nav_flow_vec_ptr`.
    pub last_vec: [f32; 2],
}

impl FlowField {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn clear(&mut self) {
        self.threats.clear();
        self.grid_w = 0;
        self.grid_h = 0;
        self.tile_offsets.clear();
        self.vectors.clear();
        self.last_vec = [0.0, 0.0];
    }

    pub fn add_threat(&mut self, x: f32, y: f32, z: f32, radius: f32) {
        if !x.is_finite() || !y.is_finite() || !z.is_finite() || !radius.is_finite() || radius <= 0.0 {
            return;
        }
        let r = radius.clamp(NAV_STEP as f32, MAX_THREAT_RADIUS);
        self.threats.push(Threat { x, y, z, radius: r });
    }

    /// Builds the escape flow field for all registered threats. Returns number of walkable spans populated.
    pub fn build<S: VoxelSource>(&mut self, cache: &mut TileCache, src: &mut S) -> usize {
        self.tile_offsets.clear();
        self.vectors.clear();
        self.grid_w = 0;
        self.grid_h = 0;
        if self.threats.is_empty() {
            return 0;
        }

        // Compute tile bounding box covering every threat + 1-tile safe frontier margin.
        let mut min_tx = i32::MAX;
        let mut max_tx = i32::MIN;
        let mut min_tz = i32::MAX;
        let mut max_tz = i32::MIN;
        for t in &self.threats {
            let r = t.radius + TILE_CELLS as f32;
            min_tx = min_tx.min(world_to_tile((t.x - r).floor() as i32));
            max_tx = max_tx.max(world_to_tile((t.x + r).ceil() as i32));
            min_tz = min_tz.min(world_to_tile((t.z - r).floor() as i32));
            max_tz = max_tz.max(world_to_tile((t.z + r).ceil() as i32));
        }
        // Clamp span around center if threats are scattered very far apart.
        if max_tx - min_tx + 1 > MAX_FLOW_TILES_SIDE {
            let mid = (min_tx + max_tx) / 2;
            min_tx = mid - MAX_FLOW_TILES_SIDE / 2;
            max_tx = min_tx + MAX_FLOW_TILES_SIDE - 1;
        }
        if max_tz - min_tz + 1 > MAX_FLOW_TILES_SIDE {
            let mid = (min_tz + max_tz) / 2;
            min_tz = mid - MAX_FLOW_TILES_SIDE / 2;
            max_tz = min_tz + MAX_FLOW_TILES_SIDE - 1;
        }

        let gw = (max_tx - min_tx + 1) as usize;
        let gh = (max_tz - min_tz + 1) as usize;
        self.tx0 = min_tx;
        self.tz0 = min_tz;
        self.grid_w = gw;
        self.grid_h = gh;
        self.tile_offsets = vec![u32::MAX; gw * gh];

        // Ensure all tiles in the threat window exist in cache and assign dense span IDs.
        let mut total_spans = 0usize;
        for tz in min_tz..=max_tz {
            for tx in min_tx..=max_tx {
                cache.ensure_tile(src, (tx, tz));
                if let Some(tile) = cache.get((tx, tz)) {
                    let gidx = (tz - min_tz) as usize * gw + (tx - min_tx) as usize;
                    self.tile_offsets[gidx] = total_spans as u32;
                    total_spans += tile.spans.len();
                }
            }
        }
        if total_spans == 0 {
            return 0;
        }

        // Metadata per dense span id.
        let mut wx_arr = vec![0.0f32; total_spans];
        let mut wy_arr = vec![0.0f32; total_spans];
        let mut wz_arr = vec![0.0f32; total_spans];
        let mut danger = vec![0.0f32; total_spans];
        let mut is_safe = vec![false; total_spans];

        // Forward and reverse walkable adjacency (Walk, Vault, Drop — never Climb for panic crowds).
        let mut fwd_adj: Vec<Vec<(u32, f32)>> = vec![Vec::new(); total_spans];
        let mut rev_adj: Vec<Vec<(u32, f32)>> = vec![Vec::new(); total_spans];

        for tz in min_tz..=max_tz {
            for tx in min_tx..=max_tx {
                let gidx = (tz - min_tz) as usize * gw + (tx - min_tx) as usize;
                let base = self.tile_offsets[gidx];
                if base == u32::MAX {
                    continue;
                }
                let Some(tile) = cache.get((tx, tz)) else { continue };
                for sidx in 0..tile.spans.len() {
                    let u = base as usize + sidx;
                    let (wx, wy, wz) = tile.span_world(sidx as u16);
                    let (fx, fy, fz) = (wx as f32, wy as f32, wz as f32);
                    wx_arr[u] = fx;
                    wy_arr[u] = fy;
                    wz_arr[u] = fz;

                    // Evaluate danger and safe-exit status across all threats.
                    let mut safe_all = true;
                    let mut pen = 0.0f32;
                    for t in &self.threats {
                        let dx = fx - t.x;
                        let dz = fz - t.z;
                        let dy = (fy - t.y) * 0.5;
                        let d = (dx * dx + dy * dy + dz * dz).sqrt();
                        if d < t.radius {
                            safe_all = false;
                            let frac = 1.0 - (d / t.radius);
                            // Strong quadratic threat core penalty keeps paths routing around blasts.
                            pen += frac * frac * 64.0;
                        }
                    }
                    is_safe[u] = safe_all;
                    danger[u] = pen;

                    let uy = tile.spans[sidx].y;
                    // Intra-tile transitions.
                    for e in tile.span_edges(sidx as u16) {
                        if !matches!(e.move_kind, MOVE_WALK | MOVE_VAULT | MOVE_DROP) {
                            continue;
                        }
                        let v = base + e.to_span as u32;
                        let step = edge_step_cost(uy, &tile.spans[e.to_span as usize], e.move_kind);
                        fwd_adj[u].push((v, step));
                        rev_adj[v as usize].push((u as u32, step));
                    }
                    // Cross-tile border transitions inside the flow window.
                    let col = tile.spans[sidx].col as usize;
                    let cx = col % TILE_COLS;
                    let cz = col / TILE_COLS;
                    let on_border = [cx == TILE_COLS - 1, cx == 0, cz == TILE_COLS - 1, cz == 0];
                    for dir in 0..4usize {
                        if !on_border[dir] {
                            continue;
                        }
                        let (ox, oz) = DIR_OFFSETS[dir];
                        let ntx = tx + ox;
                        let ntz = tz + oz;
                        if ntx < min_tx || ntx > max_tx || ntz < min_tz || ntz > max_tz {
                            continue;
                        }
                        let ngidx = (ntz - min_tz) as usize * gw + (ntx - min_tx) as usize;
                        let nbase = self.tile_offsets[ngidx];
                        if nbase == u32::MAX {
                            continue;
                        }
                        let Some(ntile) = cache.get((ntx, ntz)) else { continue };
                        for &(fs, ts, mk) in &tile.border_links[dir] {
                            if fs as usize != sidx || !matches!(mk, MOVE_WALK | MOVE_VAULT | MOVE_DROP) {
                                continue;
                            }
                            let v = nbase + ts as u32;
                            let step = edge_step_cost(uy, &ntile.spans[ts as usize], mk);
                            fwd_adj[u].push((v, step));
                            rev_adj[v as usize].push((u as u32, step));
                        }
                    }
                }
            }
        }

        // Pass 1: Safe-Boundary Dijkstra propagating escape integration cost inward from all safe spans.
        let mut escape = vec![f32::INFINITY; total_spans];
        let mut heap: BinaryHeap<Reverse<(u32, u32)>> = BinaryHeap::new();
        for u in 0..total_spans {
            if is_safe[u] {
                escape[u] = 0.0;
                heap.push(Reverse((0, u as u32)));
            }
        }

        run_reverse_dijkstra(&rev_adj, &danger, &mut escape, &mut heap);

        // Fallback for enclosed rooms / pockets with no walkable exit outside threat radii:
        // seed the furthest span from the nearest threat inside any unreached component.
        let mut unreached_any = false;
        for u in 0..total_spans {
            if !is_safe[u] && !escape[u].is_finite() {
                unreached_any = true;
                break;
            }
        }
        if unreached_any {
            // Find local maxima of minimum distance to threats among unreached spans.
            let mut best_u: Option<(usize, f32)> = None;
            for u in 0..total_spans {
                if escape[u].is_finite() {
                    continue;
                }
                let mut min_d = f32::INFINITY;
                for t in &self.threats {
                    let dx = wx_arr[u] - t.x;
                    let dz = wz_arr[u] - t.z;
                    min_d = min_d.min((dx * dx + dz * dz).sqrt());
                }
                if best_u.is_none_or(|(_, bd)| min_d > bd) {
                    best_u = Some((u, min_d));
                }
            }
            if let Some((seed, _)) = best_u {
                escape[seed] = 0.0;
                heap.push(Reverse((0, seed as u32)));
                run_reverse_dijkstra(&rev_adj, &danger, &mut escape, &mut heap);
            }
        }

        // Compute smooth unit escape vector `[dx, dz]` per span from steepest downhill descent.
        self.vectors = vec![[0.0, 0.0]; total_spans];
        let mut active = 0usize;
        for u in 0..total_spans {
            if is_safe[u] || !escape[u].is_finite() {
                continue;
            }
            let cu = escape[u];
            let mut sum_x = 0.0f32;
            let mut sum_z = 0.0f32;
            let mut best_drop = 0.0f32;
            let mut best_dir = [0.0f32; 2];

            for &(v, _) in &fwd_adj[u] {
                let cv = escape[v as usize];
                if !cv.is_finite() || cv >= cu {
                    continue;
                }
                let drop = cu - cv;
                let dx = wx_arr[v as usize] - wx_arr[u];
                let dz = wz_arr[v as usize] - wz_arr[u];
                let len = (dx * dx + dz * dz).sqrt();
                if len < 1e-4 {
                    continue;
                }
                let ux = dx / len;
                let uz = dz / len;
                sum_x += ux * drop;
                sum_z += uz * drop;
                if drop > best_drop {
                    best_drop = drop;
                    best_dir = [ux, uz];
                }
            }

            let slen = (sum_x * sum_x + sum_z * sum_z).sqrt();
            if slen > 1e-4 {
                self.vectors[u] = [sum_x / slen, sum_z / slen];
                active += 1;
            } else if best_drop > 0.0 {
                self.vectors[u] = best_dir;
                active += 1;
            }
        }

        active
    }

    /// Samples the unit escape vector `[dx, dz]` at world fine-cell position `(x, y, z)` in O(1).
    /// Returns `Some([dx, dz])` if the position lies inside an active escape field, or `None` if safe/outside.
    pub fn sample(&self, cache: &TileCache, x: f32, y: f32, z: f32) -> Option<[f32; 2]> {
        if self.grid_w == 0 || self.grid_h == 0 || !x.is_finite() || !y.is_finite() || !z.is_finite() {
            return None;
        }
        let ix = x.floor() as i32;
        let iy = y.round() as i32;
        let iz = z.floor() as i32;
        let tx = world_to_tile(ix);
        let tz = world_to_tile(iz);
        if tx < self.tx0
            || tx >= self.tx0 + self.grid_w as i32
            || tz < self.tz0
            || tz >= self.tz0 + self.grid_h as i32
        {
            return None;
        }
        let gidx = (tz - self.tz0) as usize * self.grid_w + (tx - self.tx0) as usize;
        let base = self.tile_offsets[gidx];
        if base == u32::MAX {
            return None;
        }
        let tile = cache.get((tx, tz))?;
        let cx = world_to_col(ix);
        let cz = world_to_col(iz);

        if let Some(sp) = tile.nearest_span_in_col(cx, cz, iy, 24) {
            let v = self.vectors[base as usize + sp as usize];
            if v[0] != 0.0 || v[1] != 0.0 {
                return Some(v);
            }
        }
        // Check immediate 4-connected neighbors if the exact column is inside a wall or lip of a crater.
        let mut best: Option<([f32; 2], f32)> = None;
        for &(ox, oz) in &DIR_OFFSETS {
            let nx = ix + ox * NAV_STEP;
            let nz = iz + oz * NAV_STEP;
            let ntx = world_to_tile(nx);
            let ntz = world_to_tile(nz);
            if ntx < self.tx0
                || ntx >= self.tx0 + self.grid_w as i32
                || ntz < self.tz0
                || ntz >= self.tz0 + self.grid_h as i32
            {
                continue;
            }
            let ngidx = (ntz - self.tz0) as usize * self.grid_w + (ntx - self.tx0) as usize;
            let nbase = self.tile_offsets[ngidx];
            if nbase == u32::MAX {
                continue;
            }
            let Some(ntile) = cache.get((ntx, ntz)) else { continue };
            let ncx = world_to_col(nx);
            let ncz = world_to_col(nz);
            let (start, slice) = ntile.col_slice(col_index(ncx, ncz));
            for (i, sp) in slice.iter().enumerate() {
                if (sp.y - iy).abs() > 24 {
                    continue;
                }
                let v = self.vectors[nbase as usize + start as usize + i];
                if v[0] == 0.0 && v[1] == 0.0 {
                    continue;
                }
                let wx = col_center(ntx, ncx) as f32;
                let wz = col_center(ntz, ncz) as f32;
                let d2 = (wx - x) * (wx - x) + (wz - z) * (wz - z);
                if best.is_none_or(|(_, bd2)| d2 < bd2) {
                    best = Some((v, d2));
                }
            }
        }
        best.map(|(v, _)| v)
    }
}

fn run_reverse_dijkstra(
    rev_adj: &[Vec<(u32, f32)>],
    danger: &[f32],
    escape: &mut [f32],
    heap: &mut BinaryHeap<Reverse<(u32, u32)>>,
) {
    while let Some(Reverse((bits, v))) = heap.pop() {
        let dv = f32::from_bits(bits);
        if dv > escape[v as usize] {
            continue;
        }
        for &(u, step) in &rev_adj[v as usize] {
            let nu = dv + step + danger[u as usize];
            if nu < escape[u as usize] {
                escape[u as usize] = nu;
                heap.push(Reverse((nu.to_bits(), u)));
            }
        }
    }
}
