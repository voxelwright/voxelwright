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
    DIR_OFFSETS, MOVE_DROP, MOVE_VAULT, MOVE_WALK, NAV_STEP, TILE_CELLS, VoxelSource,
    col_center, col_index, world_to_col, world_to_tile,
};
use crate::nav::tiles::{TileCache, edge_step_cost};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// Maximum threat radius clamped per threat source (500 cells = 50 m).
const MAX_THREAT_RADIUS: f32 = 500.0;
/// Maximum flow bounding box width/height in nav tiles (12 * 6.4 m = 76.8 m across).
const MAX_FLOW_TILES_SIDE: i32 = 12;

#[derive(Clone, Copy, Debug)]
pub struct Threat {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub radius: f32,
}

/// Built panic flow field ready for O(1) per-agent sampling, with reusable flat CSR scratch buffers
/// so repeated builds during explosions allocate zero nested `Vec`s.
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
    // Reusable flat scratch buffers for `build_budgeted` (zero per-call nested heap allocations).
    wx_arr: Vec<f32>,
    wy_arr: Vec<f32>,
    wz_arr: Vec<f32>,
    danger: Vec<f32>,
    is_safe: Vec<u8>,
    escape: Vec<f32>,
    raw_edges: Vec<(u32, u32, f32)>,
    rev_offsets: Vec<u32>,
    rev_cursor: Vec<u32>,
    rev_edges: Vec<(u32, f32)>,
    sum_x: Vec<f32>,
    sum_z: Vec<f32>,
    best_drop: Vec<f32>,
    best_dx: Vec<f32>,
    best_dz: Vec<f32>,
    heap: BinaryHeap<Reverse<(u32, u32)>>,
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

    /// Builds the escape flow field for all registered threats, baking all missing tiles in the window.
    /// Returns number of walkable spans populated.
    pub fn build<S: VoxelSource>(&mut self, cache: &mut TileCache, src: &mut S) -> usize {
        self.build_budgeted(cache, src, usize::MAX)
    }

    /// Builds the escape flow field over cached tiles in the threat window while baking at most `max_bake`
    /// missing tiles (ordered nearest to any active threat) so main-thread crash/strike spikes never stall
    /// synchronously baking hundreds of cold tiles.
    pub fn build_budgeted<S: VoxelSource>(
        &mut self,
        cache: &mut TileCache,
        src: &mut S,
        max_bake: usize,
    ) -> usize {
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
        self.tile_offsets.clear();
        self.tile_offsets.resize(gw * gh, u32::MAX);

        // Bake up to `max_bake` missing tiles in the threat window, nearest-to-threat first.
        if max_bake == usize::MAX {
            for tz in min_tz..=max_tz {
                for tx in min_tx..=max_tx {
                    cache.ensure_tile(src, (tx, tz));
                }
            }
        } else if max_bake > 0 {
            let mut missing: Vec<((i32, i32), f32)> = Vec::new();
            for tz in min_tz..=max_tz {
                let cz = (tz * TILE_CELLS + TILE_CELLS / 2) as f32;
                for tx in min_tx..=max_tx {
                    if cache.get((tx, tz)).is_some() {
                        continue;
                    }
                    let cx = (tx * TILE_CELLS + TILE_CELLS / 2) as f32;
                    let mut best_d2 = f32::INFINITY;
                    for t in &self.threats {
                        let dx = cx - t.x;
                        let dz = cz - t.z;
                        best_d2 = best_d2.min(dx * dx + dz * dz);
                    }
                    missing.push(((tx, tz), best_d2));
                }
            }
            missing.sort_unstable_by(|a, b| a.1.total_cmp(&b.1));
            for (key, _) in missing.into_iter().take(max_bake) {
                cache.ensure_tile(src, key);
            }
        }

        // Assign dense span IDs across all cached tiles in the threat window.
        let mut total_spans = 0usize;
        for tz in min_tz..=max_tz {
            for tx in min_tx..=max_tx {
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

        // Reuse flat metadata & edge scratch buffers (zero nested Vec allocations).
        self.wx_arr.clear();
        self.wx_arr.resize(total_spans, 0.0);
        self.wy_arr.clear();
        self.wy_arr.resize(total_spans, 0.0);
        self.wz_arr.clear();
        self.wz_arr.resize(total_spans, 0.0);
        self.danger.clear();
        self.danger.resize(total_spans, 0.0);
        self.is_safe.clear();
        self.is_safe.resize(total_spans, 0);
        self.raw_edges.clear();
        self.rev_cursor.clear();
        self.rev_cursor.resize(total_spans, 0);

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
                    self.wx_arr[u] = fx;
                    self.wy_arr[u] = fy;
                    self.wz_arr[u] = fz;

                    // Evaluate danger and safe-exit status across all threats.
                    let mut safe_all = true;
                    let mut pen = 0.0f32;
                    for t in &self.threats {
                        let dx = fx - t.x;
                        let dz = fz - t.z;
                        let dy = (fy - t.y) * 0.5;
                        let d2 = dx * dx + dy * dy + dz * dz;
                        if d2 < t.radius * t.radius {
                            safe_all = false;
                            let frac = 1.0 - (d2.sqrt() / t.radius);
                            // Strong quadratic threat core penalty keeps paths routing around blasts.
                            pen += frac * frac * 64.0;
                        }
                    }
                    self.is_safe[u] = safe_all as u8;
                    self.danger[u] = pen;

                    let uy = tile.spans[sidx].y;
                    // Intra-tile transitions (Walk, Vault, Drop — never Climb for panic crowds).
                    for e in tile.span_edges(sidx as u16) {
                        if !matches!(e.move_kind, MOVE_WALK | MOVE_VAULT | MOVE_DROP) {
                            continue;
                        }
                        let v = base + e.to_span as u32;
                        let step = edge_step_cost(uy, &tile.spans[e.to_span as usize], e.move_kind);
                        self.raw_edges.push((u as u32, v, step));
                        self.rev_cursor[v as usize] += 1;
                    }
                }
                // Cross-tile border transitions once per (tile, dir) in O(border_links) instead of O(spans * border_links).
                for dir in 0..4usize {
                    if tile.border_links[dir].is_empty() {
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
                        if !matches!(mk, MOVE_WALK | MOVE_VAULT | MOVE_DROP) {
                            continue;
                        }
                        let u = base + fs as u32;
                        let v = nbase + ts as u32;
                        let uy = tile.spans[fs as usize].y;
                        let step = edge_step_cost(uy, &ntile.spans[ts as usize], mk);
                        self.raw_edges.push((u, v, step));
                        self.rev_cursor[v as usize] += 1;
                    }
                }
            }
        }

        // Build flat CSR reverse adjacency in O(V + E).
        self.rev_offsets.clear();
        self.rev_offsets.reserve(total_spans + 1);
        let mut acc = 0u32;
        self.rev_offsets.push(0);
        for i in 0..total_spans {
            let deg = self.rev_cursor[i];
            self.rev_cursor[i] = acc;
            acc += deg;
            self.rev_offsets.push(acc);
        }
        self.rev_edges.resize(acc as usize, (0, 0.0));
        for &(u, v, step) in &self.raw_edges {
            let dst = self.rev_cursor[v as usize] as usize;
            self.rev_cursor[v as usize] += 1;
            self.rev_edges[dst] = (u, step);
        }

        // Pass 1: Safe-Boundary Dijkstra propagating escape integration cost inward from all safe spans.
        self.escape.clear();
        self.escape.resize(total_spans, f32::INFINITY);
        self.heap.clear();
        for u in 0..total_spans {
            if self.is_safe[u] != 0 {
                self.escape[u] = 0.0;
                self.heap.push(Reverse((0, u as u32)));
            }
        }

        run_reverse_dijkstra(&self.rev_offsets, &self.rev_edges, &self.danger, &mut self.escape, &mut self.heap);

        // Fallback for enclosed rooms / pockets or large threat radii exceeding the cached tile window:
        // seed the furthest connected unreached span from the nearest threat (skipping isolated 1-span specks).
        for _ in 0..16 {
            let mut best_u: Option<(usize, f32)> = None;
            for u in 0..total_spans {
                if self.escape[u].is_finite() || self.rev_offsets[u] == self.rev_offsets[u + 1] {
                    continue;
                }
                let mut min_d2 = f32::INFINITY;
                for t in &self.threats {
                    let dx = self.wx_arr[u] - t.x;
                    let dz = self.wz_arr[u] - t.z;
                    min_d2 = min_d2.min(dx * dx + dz * dz);
                }
                if best_u.is_none_or(|(_, bd2)| min_d2 > bd2) {
                    best_u = Some((u, min_d2));
                }
            }
            let Some((seed, _)) = best_u else { break };
            self.escape[seed] = 0.0;
            self.heap.push(Reverse((0, seed as u32)));
            run_reverse_dijkstra(&self.rev_offsets, &self.rev_edges, &self.danger, &mut self.escape, &mut self.heap);
        }

        // Compute smooth unit escape vector `[dx, dz]` per span from steepest downhill descent in one flat edge pass.
        self.sum_x.clear();
        self.sum_x.resize(total_spans, 0.0);
        self.sum_z.clear();
        self.sum_z.resize(total_spans, 0.0);
        self.best_drop.clear();
        self.best_drop.resize(total_spans, 0.0);
        self.best_dx.clear();
        self.best_dx.resize(total_spans, 0.0);
        self.best_dz.clear();
        self.best_dz.resize(total_spans, 0.0);

        for &(u, v, _) in &self.raw_edges {
            let ui = u as usize;
            if self.is_safe[ui] != 0 {
                continue;
            }
            let cu = self.escape[ui];
            let vi = v as usize;
            let cv = self.escape[vi];
            if !cu.is_finite() || !cv.is_finite() || cv >= cu {
                continue;
            }
            let drop = cu - cv;
            let dx = self.wx_arr[vi] - self.wx_arr[ui];
            let dz = self.wz_arr[vi] - self.wz_arr[ui];
            let len = (dx * dx + dz * dz).sqrt();
            if len < 1e-4 {
                continue;
            }
            let ux = dx / len;
            let uz = dz / len;
            self.sum_x[ui] += ux * drop;
            self.sum_z[ui] += uz * drop;
            if drop > self.best_drop[ui] {
                self.best_drop[ui] = drop;
                self.best_dx[ui] = ux;
                self.best_dz[ui] = uz;
            }
        }

        self.vectors.clear();
        self.vectors.resize(total_spans, [0.0, 0.0]);
        let mut active = 0usize;
        for u in 0..total_spans {
            if self.is_safe[u] != 0 || !self.escape[u].is_finite() {
                continue;
            }
            let sx = self.sum_x[u];
            let sz = self.sum_z[u];
            let slen = (sx * sx + sz * sz).sqrt();
            if slen > 1e-4 {
                self.vectors[u] = [sx / slen, sz / slen];
                active += 1;
            } else if self.best_drop[u] > 0.0 {
                self.vectors[u] = [self.best_dx[u], self.best_dz[u]];
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
    rev_offsets: &[u32],
    rev_edges: &[(u32, f32)],
    danger: &[f32],
    escape: &mut [f32],
    heap: &mut BinaryHeap<Reverse<(u32, u32)>>,
) {
    while let Some(Reverse((bits, v))) = heap.pop() {
        let dv = f32::from_bits(bits);
        let vi = v as usize;
        if dv > escape[vi] {
            continue;
        }
        let start = rev_offsets[vi] as usize;
        let end = rev_offsets[vi + 1] as usize;
        for &(u, step) in &rev_edges[start..end] {
            let ui = u as usize;
            let nu = dv + step + danger[ui];
            if nu < escape[ui] {
                escape[ui] = nu;
                heap.push(Reverse((nu.to_bits(), u)));
            }
        }
    }
}
