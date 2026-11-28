//! Destructible-world voxel navigation, HPA* portals, panic flow fields, and ORCA/RVO2
//! crowd avoidance (#164).
//!
//! Operates directly over Voxelwright's live 10 cm cell world (`bodies::Ground`), with zero
//! external dependencies and deterministic plain C-ABI exports for both native and `wasm32`.

pub mod astar;
pub mod flow;
pub mod heightfield;
pub mod rvo;
pub mod tiles;

use crate::bodies::{self, Ground};
use flow::FlowField;
use heightfield::world_to_tile;
use rvo::Crowd;
use tiles::{TileCache, TileKey};

/// Per-instance navigation and crowd state owned inside `lib.rs` `Instance`.
pub struct NavWorld {
    pub cache: TileCache,
    pub flow: FlowField,
    pub crowd: Crowd,
    /// Reusable flat output buffer for `nav_find_path`: `[x, y, z, move_kind]` per waypoint.
    pub path_out: Vec<f32>,
    /// Number of edits in `Ground::edits` already mirrored into `cache`'s dirty queue.
    pub seen_edits: usize,
}

impl Default for NavWorld {
    fn default() -> Self {
        Self::new()
    }
}

impl NavWorld {
    pub fn new() -> Self {
        Self {
            cache: TileCache::new(),
            flow: FlowField::new(),
            crowd: Crowd::new(),
            path_out: Vec::new(),
            seen_edits: 0,
        }
    }

    pub fn reset(&mut self) {
        self.cache.clear();
        self.flow.clear();
        self.crowd.reset();
        self.path_out.clear();
        self.seen_edits = 0;
    }

    #[inline]
    pub fn mark_dirty_box(&mut self, lo: [i32; 3], hi: [i32; 3]) {
        self.cache.mark_dirty_box(lo, hi);
    }

    /// Mirrors any solver-generated edits (e.g. settled rubble from `bodies_advance` or fire)
    /// added to `ground.edits` since the last sync into the dirty tile queue.
    pub fn sync_edits(&mut self, ground: &Ground) {
        if ground.edits.len() < self.seen_edits {
            self.seen_edits = 0;
        }
        if ground.edits.len() > self.seen_edits {
            for e in &ground.edits[self.seen_edits..] {
                let (lo, hi) = bodies::reach(e);
                self.cache.mark_dirty_box(lo, hi);
            }
            self.seen_edits = ground.edits.len();
        }
    }

    /// Incrementally rebakes up to `max_tiles` dirty tiles nearest to `(fx, fz)`.
    pub fn rebake_budget(&mut self, ground: &mut Ground, fx: f32, fz: f32, max_tiles: usize) -> usize {
        self.sync_edits(ground);
        self.cache.rebake_budget(ground, fx, fz, max_tiles)
    }

    /// Ensures tiles within `radius_tiles` around `(fx, fz)` are baked (up to `max_tiles` nearest-first).
    pub fn bake_area(
        &mut self,
        ground: &mut Ground,
        fx: f32,
        fz: f32,
        radius_tiles: i32,
        max_tiles: usize,
    ) -> usize {
        self.sync_edits(ground);
        let r = radius_tiles.clamp(0, 16);
        let cx = world_to_tile(fx.floor() as i32);
        let cz = world_to_tile(fz.floor() as i32);
        let mut missing: Vec<(TileKey, i32)> = Vec::new();
        for dz in -r..=r {
            for dx in -r..=r {
                let key = (cx + dx, cz + dz);
                if self.cache.get(key).is_none() {
                    missing.push((key, dx * dx + dz * dz));
                }
            }
        }
        missing.sort_unstable_by_key(|&(_, d2)| d2);
        let mut baked = 0usize;
        for (key, _) in missing.into_iter().take(max_tiles) {
            self.cache.bake_tile(ground, key.0, key.1);
            baked += 1;
        }
        baked
    }

    /// Computes a smoothed multi-layer HPA* path in `self.path_out` and returns the waypoint count.
    #[allow(clippy::too_many_arguments)]
    pub fn find_path(
        &mut self,
        ground: &mut Ground,
        sx: f32,
        sy: f32,
        sz: f32,
        gx: f32,
        gy: f32,
        gz: f32,
        flags: u32,
    ) -> usize {
        self.sync_edits(ground);
        astar::find_path(
            &mut self.cache,
            ground,
            sx,
            sy,
            sz,
            gx,
            gy,
            gz,
            flags,
            &mut self.path_out,
        )
    }

    /// Builds the multi-threat escape flow field over walkable nav tiles.
    pub fn flow_build(&mut self, ground: &mut Ground) -> usize {
        self.sync_edits(ground);
        self.flow.build(&mut self.cache, ground)
    }

    /// Samples the flow field at `(x, y, z)` in O(1), storing `[dx, dz]` in `self.flow.last_vec`.
    pub fn flow_sample(&mut self, x: f32, y: f32, z: f32) -> i32 {
        if let Some(v) = self.flow.sample(&self.cache, x, y, z) {
            self.flow.last_vec = v;
            1
        } else {
            self.flow.last_vec = [0.0, 0.0];
            0
        }
    }

    /// Runs one ORCA/RVO2 crowd step using cached `TileCache` static wall/crater awareness.
    pub fn crowd_step(&mut self, count: usize, dt: f32, time_horizon: f32) -> usize {
        self.crowd.step(count, dt, time_horizon, Some(&self.cache))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bodies::Bodies;
    use crate::city;
    use crate::kinds::{ASPHALT, BRICK, CONCRETE, GLASS, WATER, WOOD, kind};
    use crate::nav::heightfield::{
        MOVE_CLIMB, MOVE_VAULT, MOVE_WALK, NAV_ALLOW_CLIMB, NAV_ALLOW_DROP, NAV_ALLOW_VAULT,
        NAV_WALK_ONLY, VoxelSource, col_index, extract_tile,
    };
    use crate::nav::rvo::{
        CROWD_FLAG_IGNORE_WORLD, CROWD_FLAG_STATIC, Crowd, FIELD_POS_X, FIELD_POS_Z,
        FIELD_PREF_VX, FIELD_PREF_VZ, MAX_AGENTS,
    };
    use crate::scratch::Run;
    use crate::tree::Kind;
    use crate::Edit;
    use std::collections::HashMap;
    use std::time::Instant;

    /// Lightweight synthetic voxel box world for deterministic geometric unit tests.
    struct SyntheticWorld {
        base_floor_y: Option<i32>,
        y_bounds: (i32, i32),
        boxes: Vec<([i32; 3], [i32; 3], Kind)>,
        cells: HashMap<[i32; 3], Kind>,
    }

    impl SyntheticWorld {
        fn new(base_floor_y: Option<i32>, y_lo: i32, y_hi: i32) -> Self {
            Self {
                base_floor_y,
                y_bounds: (y_lo, y_hi),
                boxes: Vec::new(),
                cells: HashMap::new(),
            }
        }
        fn fill(&mut self, lo: [i32; 3], hi: [i32; 3], k: Kind) {
            self.boxes.push((lo, hi, k));
        }
    }

    impl VoxelSource for SyntheticWorld {
        fn kind(&mut self, x: i32, y: i32, z: i32) -> Kind {
            if let Some(&k) = self.cells.get(&[x, y, z]) {
                return k;
            }
            let mut k = if let Some(fy) = self.base_floor_y {
                if y <= fy { kind(ASPHALT, 0) } else { 0 }
            } else {
                0
            };
            for &(lo, hi, bk) in &self.boxes {
                if x >= lo[0] && x < hi[0] && y >= lo[1] && y < hi[1] && z >= lo[2] && z < hi[2] {
                    k = bk;
                }
            }
            k
        }
        fn tile_y_bounds(&mut self, _tx: i32, _tz: i32, _edit_y: Option<(i32, i32)>) -> (i32, i32) {
            self.y_bounds
        }
    }

    /// 1. Multi-layer heightfield extraction: bridge over road + 2-storey building + roof + water exclusion + thin wall.
    #[test]
    fn multilayer_heightfield_bridge_building_water_and_thin_wall() {
        let mut world = SyntheticWorld::new(Some(9), 0, 130);
        // Road is at y <= 9 -> standing foot height y = 10.
        // Overpass bridge deck at y = 40..42 (30 cells clearance under bridge >= 18) across x=16..48, z=0..64.
        world.fill([16, 40, 0], [48, 42, 64], kind(CONCRETE, 0));
        // Multi-storey building at x=4..16, z=4..28:
        // Floor 1 at y=10 (ground), Floor 2 slab at y=38..40 (clearance 28 >= 18), Roof slab at y=68..70 (clearance 28 >= 18).
        world.fill([4, 38, 4], [16, 40, 28], kind(WOOD, 0));
        world.fill([4, 68, 4], [16, 70, 28], kind(BRICK, 0));
        // Low overhang at x=48..60, z=4..16 with deck at y=22..24 (clearance = 12 < 18 -> underpass NOT walkable, top y=24 IS walkable).
        world.fill([48, 22, 4], [60, 24, 16], kind(CONCRETE, 0));
        // Water pool at x=48..60, z=32..48 replacing floor y=9 with WATER -> NOT walkable.
        world.fill([48, 9, 32], [60, 10, 48], kind(WATER, 0));
        // 1-cell-thick glass wall along x = 35 (between col 8 at x=34 and col 9 at x=38) on the road y=10..38.
        world.fill([35, 10, 0], [36, 38, 64], kind(GLASS, 0));

        let hf = extract_tile(&mut world, 0, 0, None);

        // Under bridge & on top of bridge: column (cx=6 -> x=26, cz=8 -> z=34) must have 2 walkable spans: y=10 and y=42.
        let (s0, n) = hf.col_spans[col_index(6, 8)];
        assert_eq!(n, 2, "bridge over road should produce 2 walkable layers");
        let ys: Vec<i32> = hf.spans[s0 as usize..s0 as usize + n as usize].iter().map(|s| s.y).collect();
        assert_eq!(ys, vec![10, 42]);
        assert_eq!(hf.spans[s0 as usize].clearance, 30, "underpass clearance should be 30 cells");

        // Building column (cx=2 -> x=10, cz=3 -> z=14) must have 3 layers: ground y=10, floor 2 y=40, roof y=70.
        let (bs0, bn) = hf.col_spans[col_index(2, 3)];
        assert_eq!(bn, 3, "2-storey building + roof should produce 3 walkable layers");
        let bys: Vec<i32> = hf.spans[bs0 as usize..bs0 as usize + bn as usize].iter().map(|s| s.y).collect();
        assert_eq!(bys, vec![10, 40, 70]);

        // Low overhang column (cx=13 -> x=54, cz=2 -> z=10): only top y=24 walkable (underpass clearance 12 < 18).
        let (os0, on) = hf.col_spans[col_index(13, 2)];
        assert_eq!(on, 1, "low overhang should exclude underpass with < 18 cell clearance");
        assert_eq!(hf.spans[os0 as usize].y, 24);

        // Water pool column (cx=13 -> x=54, cz=10 -> z=42): 0 walkable spans.
        let (_, wn) = hf.col_spans[col_index(13, 10)];
        assert_eq!(wn, 0, "water floor must not produce walkable spans");

        // 1-cell glass wall at x=35 blocks transition between col 8 (x=34) and col 9 (x=38) on road layer y=10,
        // while bridge deck y=42 above the glass wall remains connected!
        let (c8_s, c8_n) = hf.col_spans[col_index(8, 8)];
        assert_eq!(c8_n, 2);
        let road_span = c8_s; // y=10
        let bridge_span = c8_s + 1; // y=42
        let (c9_s, _) = hf.col_spans[col_index(9, 8)];
        let road_9 = c9_s;
        let bridge_9 = c9_s + 1;

        let road_edges = &hf.edges[hf.spans[road_span as usize].edge_start as usize
            ..hf.spans[road_span as usize].edge_start as usize + hf.spans[road_span as usize].edge_count as usize];
        assert!(
            !road_edges.iter().any(|e| e.to_span == road_9),
            "1-cell glass wall must block road walk edge"
        );
        let bridge_edges = &hf.edges[hf.spans[bridge_span as usize].edge_start as usize
            ..hf.spans[bridge_span as usize].edge_start as usize + hf.spans[bridge_span as usize].edge_count as usize];
        assert!(
            bridge_edges.iter().any(|e| e.to_span == bridge_9 && e.move_kind == MOVE_WALK),
            "bridge deck above wall must stay walkable"
        );
    }

    /// 2. Dirty-tile invalidation & incremental rebake after real crater blast in the live city;
    ///    assert single tile rebuild < 0.5 ms in `--release`!
    #[test]
    fn dirty_invalidation_and_fast_rebake_after_blast() {
        let mut bodies = Bodies::new();
        let mut nav = NavWorld::new();
        // Open street intersection near HOME = (700, 4070).
        let bx = 700;
        let bz = 4070;
        let by = city::ground(bx, bz);

        // Pre-bake 5×5 tiles around the street.
        let baked_init = nav.bake_area(&mut bodies.ground, bx as f32, bz as f32, 2, 64);
        assert_eq!(baked_init, 25);
        assert_eq!(nav.cache.dirty_count(), 0);

        // Detonate a crater blast in the road!
        let radius = 14;
        let edits_before = bodies.ground.edits.len();
        bodies.blast([bx, by, bz], radius, None, false);
        let far = radius * 3 + 2;
        nav.mark_dirty_box([bx - far, by - far, bz - far], [bx + far + 1, by + far + 1, bz + far + 1]);
        for e in &bodies.ground.edits[edits_before..] {
            let (lo, hi) = bodies::reach(e);
            nav.mark_dirty_box(lo, hi);
        }
        nav.seen_edits = bodies.ground.edits.len();

        let dirty_before = nav.cache.dirty_count();
        assert!(dirty_before >= 9, "blast + 1-tile portal margin must mark >= 9 tiles dirty (got {dirty_before})");

        // Incremental budgeted rebake: 1 tile at a time, measuring each single-tile rebuild.
        let t0 = Instant::now();
        let n1 = nav.rebake_budget(&mut bodies.ground, bx as f32, bz as f32, 1);
        let single_ms = t0.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(n1, 1);
        assert_eq!(nav.cache.dirty_count(), dirty_before - 1);

        // Rebake remaining dirty tiles and measure average per-tile time.
        let rem = nav.cache.dirty_count();
        let t_rem = Instant::now();
        let n_rem = nav.rebake_budget(&mut bodies.ground, bx as f32, bz as f32, rem);
        let avg_ms = (t_rem.elapsed().as_secs_f64() * 1000.0) / n_rem.max(1) as f64;
        assert_eq!(n_rem, rem);
        assert_eq!(nav.cache.dirty_count(), 0);

        eprintln!(
            "nav tile rebake after blast: center={single_ms:.3} ms, avg_ring({n_rem} tiles)={avg_ms:.3} ms"
        );
        // Release performance gate (< 0.5 ms per single tile rebuild, averaged across the rebaked ring
        // so parallel `cargo test --release` CPU contention on a single sample does not cause false flakes).
        #[cfg(not(debug_assertions))]
        assert!(
            avg_ms < 0.5,
            "average single tile rebuild took {avg_ms:.3} ms (center={single_ms:.3} ms, gate < 0.5 ms)"
        );
    }

    /// 3. Pathfinding around a freshly blasted crater, OVER a newly placed player voxel bridge
    ///    across a chasm, and multi-tile HPA* with vertical vault/drop/climb edges.
    #[test]
    fn pathfinding_around_crater_over_bridge_and_hpa_multilayer() {
        // Part A: Real city street -> blast deep crater -> path routes AROUND crater!
        let mut bodies = Bodies::new();
        let mut nav = NavWorld::new();
        let cx = 700;
        let cz = 4070;
        let cy = city::ground(cx, cz);

        // Pre-bake area around street corridor along X (from x=620 to x=780 at z=4070).
        nav.bake_area(&mut bodies.ground, cx as f32, cz as f32, 3, 64);

        // Carve a deep steep crater (40 cells deep, radius 16) right at (700, cy, 4070) so walking straight is impossible.
        let mut runs = Vec::new();
        for y in (cy - 40)..=(cy + 4) {
            for z in (cz - 16)..=(cz + 16) {
                runs.push(Run { x0: cx - 16, x1: cx + 17, y, z, kind: 0 });
            }
        }
        let edit = Edit::Runs(runs);
        let (lo, hi) = bodies::reach(&edit);
        bodies.ground.push(edit, false, None);
        nav.mark_dirty_box(lo, hi);
        nav.seen_edits = bodies.ground.edits.len();
        nav.rebake_budget(&mut bodies.ground, cx as f32, cz as f32, 64);

        let sx = (cx - 48) as f32;
        let gx = (cx + 48) as f32;
        let sy = (city::footing(sx as i32, cz).0) as f32;
        let gy = (city::footing(gx as i32, cz).0) as f32;
        let t_crater = Instant::now();
        let count = nav.find_path(&mut bodies.ground, sx, sy, cz as f32, gx, gy, cz as f32, NAV_WALK_ONLY);
        let crater_ms = t_crater.elapsed().as_secs_f64() * 1000.0;
        assert!(count >= 3, "path around deep crater should exist and detour (got {count} waypoints)");

        // Verify no waypoint drops into the crater pit, no smoothed segment cuts through the
        // crater interior, and the route detours laterally outside the crater rim.
        let mut max_lateral = 0.0f32;
        for i in 0..count {
            let wx = nav.path_out[i * 4];
            let wy = nav.path_out[i * 4 + 1];
            let wz = nav.path_out[i * 4 + 2];
            assert!(wy >= (cy - 10) as f32, "waypoint {i} fell into crater at y={wy}");
            max_lateral = max_lateral.max((wz - cz as f32).abs());
            if i + 1 < count {
                let nx = nav.path_out[(i + 1) * 4];
                let nz = nav.path_out[(i + 1) * 4 + 2];
                for s in 0..=16 {
                    let t = s as f32 / 16.0;
                    let px = wx + (nx - wx) * t;
                    let pz = wz + (nz - wz) * t;
                    assert!(
                        !((px - cx as f32).abs() < 12.0 && (pz - cz as f32).abs() < 12.0),
                        "smoothed segment {i}->{next} cut through crater core at ({px:.1},{pz:.1})",
                        next = i + 1
                    );
                }
            }
        }
        assert!(
            max_lateral > 14.0,
            "path must detour laterally around crater rim (max |z - cz| = {max_lateral:.1})"
        );

        // Part B: Now build a player voxel bridge straight OVER the crater at y = cy!
        let mut bridge_runs = Vec::new();
        for z in (cz - 6)..=(cz + 6) {
            bridge_runs.push(Run { x0: cx - 20, x1: cx + 21, y: cy, z, kind: kind(WOOD, 0) });
        }
        let bridge_edit = Edit::Runs(bridge_runs);
        let (blo, bhi) = bodies::reach(&bridge_edit);
        bodies.ground.push(bridge_edit, false, None);
        nav.mark_dirty_box(blo, bhi);
        nav.seen_edits = bodies.ground.edits.len();
        nav.rebake_budget(&mut bodies.ground, cx as f32, cz as f32, 64);

        let t_bridge = Instant::now();
        let bcount = nav.find_path(&mut bodies.ground, sx, sy, cz as f32, gx, gy, cz as f32, NAV_WALK_ONLY);
        let bridge_ms = t_bridge.elapsed().as_secs_f64() * 1000.0;
        assert!(bcount >= 2, "path over newly placed voxel bridge must succeed");
        // With string-pulling straight across the bridge, path stays near z = cz and has far fewer detours.
        for i in 0..bcount {
            let wz = nav.path_out[i * 4 + 2];
            assert!(
                (wz - cz as f32).abs() <= 10.0,
                "path should cross straight over the new bridge near z={cz}, got z={wz}"
            );
        }

        // Part C: Synthetic multi-tile HPA* (> 4 tiles) across an abyss with a single narrow bridge + vault & climb.
        let mut syn = SyntheticWorld::new(None, 0, 100);
        // West island: x in [0..128), floor y=20 (feet at 21).
        syn.fill([0, 19, 0], [128, 21, 128], kind(CONCRETE, 0));
        // East island: x in [192..384), floor y=20 (feet at 21).
        syn.fill([192, 19, 0], [384, 21, 128], kind(CONCRETE, 0));
        // Raised platform on East island at x in [320..360), z in [32..96), floor y=28 (feet 29 -> +8 vault!).
        syn.fill([320, 21, 32], [360, 29, 96], kind(BRICK, 0));
        // High ledge at x in [360..384), z in [32..96), floor y=48 (feet 49 -> +20 climb from platform!).
        syn.fill([360, 21, 32], [384, 49, 96], kind(BRICK, 0));

        let mut cache = TileCache::new();
        let mut out = Vec::new();
        let c0 = astar::find_path(&mut cache, &mut syn, 16.0, 21.0, 64.0, 280.0, 21.0, 64.0, 0, &mut out);
        assert_eq!(c0, 0, "unbridged chasm must be unreachable");

        // Place a narrow voxel bridge spanning x in [124..196), z in [80..92), y=20!
        syn.fill([124, 19, 80], [196, 21, 92], kind(WOOD, 0));
        cache.mark_dirty_box([124, 19, 80], [196, 21, 92]);
        cache.rebake_budget(&mut syn, 160.0, 86.0, 32);

        // Pre-bake the synthetic 6×2 island area so `t_hpa` measures pure HPA* + local A* + string-pulling.
        for tx in 0..=6 {
            for tz in 0..=2 {
                cache.ensure_tile(&mut syn, (tx, tz));
            }
        }
        // Long HPA* path (> 5 tiles) from West island (16, 21, 20) over bridge at z=86 to East island vault platform (340, 29, 64).
        let t_hpa = Instant::now();
        let c1 = astar::find_path(
            &mut cache,
            &mut syn,
            16.0,
            21.0,
            20.0,
            340.0,
            29.0,
            64.0,
            NAV_ALLOW_VAULT | NAV_ALLOW_DROP,
            &mut out,
        );
        let hpa_ms = t_hpa.elapsed().as_secs_f64() * 1000.0;
        eprintln!(
            "nav pathfind: crater_detour={crater_ms:.3} ms ({count} wps), bridge={bridge_ms:.3} ms ({bcount} wps), hpa_long={hpa_ms:.3} ms ({c1} wps)"
        );
        assert!(c1 >= 4, "HPA* path over bridge and onto vault platform must succeed (got {c1})");
        let crossed_bridge = (0..c1).any(|i| {
            let x = out[i * 4];
            let z = out[i * 4 + 2];
            x >= 120.0 && x <= 200.0 && z >= 76.0 && z <= 96.0
        });
        assert!(crossed_bridge, "path must cross the newly placed bridge at z=80..92");
        let vaulted = (0..c1).any(|i| out[i * 4 + 3] as u8 == MOVE_VAULT);
        assert!(vaulted, "path onto +8 cell platform must emit MOVE_VAULT");

        // Climb to high ledge (372, 49, 64): fails without NAV_ALLOW_CLIMB, succeeds with it!
        let c_no_climb = astar::find_path(
            &mut cache,
            &mut syn,
            340.0,
            29.0,
            64.0,
            372.0,
            49.0,
            64.0,
            NAV_ALLOW_VAULT | NAV_ALLOW_DROP,
            &mut out,
        );
        assert_eq!(c_no_climb, 0, "+20 cell cliff must be unreachable without NAV_ALLOW_CLIMB");

        let c_climb = astar::find_path(
            &mut cache,
            &mut syn,
            340.0,
            29.0,
            64.0,
            372.0,
            49.0,
            64.0,
            NAV_ALLOW_VAULT | NAV_ALLOW_DROP | NAV_ALLOW_CLIMB,
            &mut out,
        );
        assert!(c_climb >= 2, "+20 cell cliff must be reachable with NAV_ALLOW_CLIMB");
        assert!(
            (0..c_climb).any(|i| out[i * 4 + 3] as u8 == MOVE_CLIMB),
            "climb path must emit MOVE_CLIMB"
        );
    }

    /// 4. Panic flow field routes agents AWAY from a blast AND AROUND a solid obstacle wall.
    #[test]
    fn panic_flow_field_routes_around_wall_and_craters() {
        let mut syn = SyntheticWorld::new(Some(9), 0, 60);
        // Solid wall blocking direct +X escape from x=24..32, z=-40..+40, height y=10..40.
        syn.fill([24, 10, -40], [32, 40, 40], kind(BRICK, 0));
        // Deep crater at x=-40..-20, z=-12..+12.
        syn.fill([-40, 0, -12], [-20, 10, 12], 0);

        let mut cache = TileCache::new();
        let mut flow = FlowField::new();
        // Threat blast at (0, 10, 0) with radius 160 cells (16 m).
        flow.add_threat(0.0, 10.0, 0.0, 160.0);
        let active = flow.build(&mut cache, &mut syn);
        assert!(active > 200, "flow field should cover hundreds of spans (got {active})");

        // Agent trapped between blast at (0,0) and wall at x=24..32 (standing at x=16, z=12):
        // Cannot flee straight +X (wall!), cannot flee -X (blast core!). Must route around wall (+Z)!
        let mut px = 16.0f32;
        let mut pz = 12.0f32;
        let v0 = flow.sample(&cache, px, 10.0, pz).expect("agent near blast must get escape vector");
        let len0 = (v0[0] * v0[0] + v0[1] * v0[1]).sqrt();
        assert!((len0 - 1.0).abs() < 1e-3, "escape vector must be unit length");
        assert!(v0[1] > 0.3, "agent between blast and wall must steer +Z around wall end, got {v0:?}");

        // Follow the flow field for up to 120 steps of 4 cells each; agent must escape past radius 160
        // without hitting the wall or falling into the crater!
        let mut escaped = false;
        for _ in 0..120 {
            if let Some([dx, dz]) = flow.sample(&cache, px, 10.0, pz) {
                px += dx * 3.0;
                pz += dz * 3.0;
                assert!(
                    !(px >= 24.5 && px <= 31.5 && pz >= -39.5 && pz <= 39.5),
                    "agent walked into solid wall at ({px}, {pz})"
                );
                assert!(
                    !(px >= -39.0 && px <= -21.0 && pz >= -11.0 && pz <= 11.0),
                    "agent fell into crater at ({px}, {pz})"
                );
            } else {
                escaped = true;
                break;
            }
        }
        let final_dist = (px * px + pz * pz).sqrt();
        assert!(
            escaped || final_dist >= 150.0,
            "panicking agent should escape blast radius around wall (final=({px:.1},{pz:.1}), d={final_dist:.1})"
        );
    }

    /// 5. ORCA/RVO2 200-agent antipodal crossing & narrow-doorway stress test:
    ///    zero NaNs, zero overlaps below min radius, zero deadlocks, step time < 1.0 ms in `--release`!
    #[test]
    fn rvo2_200_agent_antipodal_crossing_and_narrow_doorway() {
        // Part A: 200-agent antipodal circle crossing.
        let n = 200usize;
        let ring_r = 220.0f32; // 22 m circle in 10 cm cell units (diameter 44 m)
        let agent_r = 3.0f32;  // 30 cm radius (60 cm = APART diameter)
        let max_spd = 30.0f32; // 3.0 m/s
        let dt = 1.0 / 20.0;   // 50 ms step
        let tau = 2.0f32;

        let mut crowd = Crowd::new();
        let mut goals = vec![(0.0f32, 0.0f32); n];
        for i in 0..n {
            let angle = (i as f32) * (std::f32::consts::TAU / n as f32);
            let x = ring_r * angle.cos();
            let z = ring_r * angle.sin();
            goals[i] = (-x, -z);
            crowd.set_agent(i, x, 10.0, z, 0.0, 0.0, 0.0, 0.0, agent_r, max_spd, CROWD_FLAG_IGNORE_WORLD);
        }

        let mut total_step_ms = 0.0f64;
        let steps = 700usize;
        for step in 0..steps {
            for i in 0..n {
                let (px, _, pz) = crowd.agent_pos(i);
                let dx = goals[i].0 - px;
                let dz = goals[i].1 - pz;
                let d = (dx * dx + dz * dz).sqrt();
                let (pvx, pvz) = if d > 1.0 {
                    let s = max_spd.min(d / dt);
                    (dx / d * s, dz / d * s)
                } else {
                    (0.0, 0.0)
                };
                crowd.field_mut(FIELD_PREF_VX)[i] = pvx;
                crowd.field_mut(FIELD_PREF_VZ)[i] = pvz;
            }
            let t0 = Instant::now();
            crowd.step(n, dt, tau, None);
            total_step_ms += t0.elapsed().as_secs_f64() * 1000.0;

            // Every step: check zero NaNs and zero overlaps below combined min radius.
            let xs = crowd.field(FIELD_POS_X);
            let zs = crowd.field(FIELD_POS_Z);
            for i in 0..n {
                assert!(xs[i].is_finite() && zs[i].is_finite(), "NaN at step {step}, agent {i}");
            }
            if step % 35 == 0 || step == steps - 1 {
                let min_allowed = (agent_r * 2.0) * 0.98;
                let min_sq = min_allowed * min_allowed;
                for i in 0..n {
                    for j in (i + 1)..n {
                        let dx = xs[j] - xs[i];
                        let dz = zs[j] - zs[i];
                        let d2 = dx * dx + dz * dz;
                        assert!(
                            d2 >= min_sq,
                            "overlap at step {step} between {i} and {j}: dist={:.3} < {min_allowed:.3}",
                            d2.sqrt()
                        );
                    }
                }
            }
        }

        let mean_step_ms = total_step_ms / steps as f64;
        // Verify agents made strong progress across the circle (zero deadlocks!).
        let mut arrived = 0usize;
        let mut mean_goal_dist = 0.0f32;
        for i in 0..n {
            let (px, _, pz) = crowd.agent_pos(i);
            let d = ((goals[i].0 - px).powi(2) + (goals[i].1 - pz).powi(2)).sqrt();
            mean_goal_dist += d;
            if d < 30.0 {
                arrived += 1;
            }
        }
        mean_goal_dist /= n as f32;
        eprintln!(
            "RVO2 200-agent antipodal crossing: mean step={mean_step_ms:.3} ms, arrived={arrived}/{n}, mean_goal_dist={mean_goal_dist:.1}"
        );
        assert!(arrived >= 180, "expected >= 180/200 agents to cross antipodal ring without deadlock (got {arrived})");
        #[cfg(not(debug_assertions))]
        assert!(
            mean_step_ms < 1.0,
            "200-agent RVO2 step took {mean_step_ms:.3} ms (gate < 1.0 ms)"
        );

        // Part B1: Tight narrow-doorway evacuation crush (30 agents squeezing through a 10-cell / 1.0 m doorway,
        // exercising LP3 infeasible constraint fallback under high wall+crowd pressure).
        crowd.reset();
        crowd.add_obstacle(0.0, -200.0, 0.0, -5.0);
        crowd.add_obstacle(0.0, 5.0, 0.0, 200.0);
        let evac_n = 30usize;
        for i in 0..evac_n {
            let row = (i / 5) as f32;
            let col = (i % 5) as f32 - 2.0;
            crowd.set_agent(
                i,
                -14.0 - row * 7.5,
                10.0,
                col * 7.5,
                0.0,
                0.0,
                0.0,
                0.0,
                2.8,
                24.0,
                CROWD_FLAG_IGNORE_WORLD,
            );
        }
        for step in 0..420 {
            for i in 0..evac_n {
                let (px, _, pz) = crowd.agent_pos(i);
                let (tx, tz) = if px < 2.0 {
                    (if pz.abs() > 2.2 { 0.0 } else { 20.0 }, pz.clamp(-1.8, 1.8))
                } else {
                    (120.0, ((i % 5) as f32 - 2.0) * 8.0)
                };
                let dx = tx - px;
                let dz = tz - pz;
                let d = (dx * dx + dz * dz).sqrt();
                let (pvx, pvz) = if d > 1.0 { (dx / d * 24.0, dz / d * 24.0) } else { (0.0, 0.0) };
                crowd.field_mut(FIELD_PREF_VX)[i] = pvx;
                crowd.field_mut(FIELD_PREF_VZ)[i] = pvz;
            }
            crowd.step(evac_n, dt, 1.5, None);
            let xs = crowd.field(FIELD_POS_X);
            let zs = crowd.field(FIELD_POS_Z);
            for i in 0..evac_n {
                assert!(xs[i].is_finite() && zs[i].is_finite(), "evac doorway NaN at step {step}, agent {i}");
                if zs[i].abs() > 5.5 {
                    assert!(
                        xs[i].abs() >= 2.5,
                        "agent {i} penetrated 1m doorway wall at ({:.2}, {:.2}) step {step}",
                        xs[i],
                        zs[i]
                    );
                }
            }
            if step % 60 == 0 || step == 419 {
                let min_d = 5.6 * 0.97;
                for i in 0..evac_n {
                    for j in (i + 1)..evac_n {
                        let d = ((xs[j] - xs[i]).powi(2) + (zs[j] - zs[i]).powi(2)).sqrt();
                        assert!(d >= min_d, "evac doorway overlap step {step}: {i}&{j} dist={d:.3}");
                    }
                }
            }
        }
        let evac_crossed = (0..evac_n).filter(|&i| crowd.agent_pos(i).0 > 4.0).count();
        eprintln!("RVO2 1.0m narrow doorway evacuation: crossed={evac_crossed}/{evac_n}");
        assert!(
            evac_crossed >= 26,
            "narrow 1.0m doorway should pass >= 26/30 evacuating agents without arching deadlock (got {evac_crossed})"
        );

        // Part B2: Bidirectional opposing crowds crossing a 20-cell (2.0 m) doorway (16 vs 16).
        crowd.reset();
        crowd.add_obstacle(0.0, -200.0, 0.0, -10.0);
        crowd.add_obstacle(0.0, 10.0, 0.0, 200.0);
        let door_n = 32usize;
        let mut door_goals = vec![(0.0f32, 0.0f32); door_n];
        for i in 0..16 {
            let row = (i / 2) as f32;
            let col = (i % 2) as f32;
            // West group heading East (approach slightly favoring right lane +Z, mixed across doorway).
            crowd.set_agent(i, -18.0 - row * 8.0, 10.0, -2.0 + col * 8.0, 0.0, 0.0, 0.0, 0.0, 2.8, 22.0, CROWD_FLAG_IGNORE_WORLD);
            door_goals[i] = (90.0 + row * 8.0, -2.0 + col * 8.0);
            // East group heading West.
            let j = i + 16;
            crowd.set_agent(j, 18.0 + row * 8.0, 10.0, 2.0 - col * 8.0, 0.0, 0.0, 0.0, 0.0, 2.8, 22.0, CROWD_FLAG_IGNORE_WORLD);
            door_goals[j] = (-90.0 - row * 8.0, 2.0 - col * 8.0);
        }
        for step in 0..420 {
            for i in 0..door_n {
                let (px, _, pz) = crowd.agent_pos(i);
                let gx = door_goals[i].0;
                let west = i < 16;
                let (tx, tz) = if west && px < 2.0 {
                    (if pz.abs() > 6.5 { 0.0 } else { 20.0 }, pz.clamp(-6.0, 6.0))
                } else if !west && px > -2.0 {
                    (if pz.abs() > 6.5 { 0.0 } else { -20.0 }, pz.clamp(-6.0, 6.0))
                } else {
                    (gx, door_goals[i].1)
                };
                let dx = tx - px;
                let dz = tz - pz;
                let d = (dx * dx + dz * dz).sqrt();
                let (pvx, pvz) = if d > 1.0 { (dx / d * 22.0, dz / d * 22.0) } else { (0.0, 0.0) };
                crowd.field_mut(FIELD_PREF_VX)[i] = pvx;
                crowd.field_mut(FIELD_PREF_VZ)[i] = pvz;
            }
            crowd.step(door_n, dt, 1.5, None);
            let xs = crowd.field(FIELD_POS_X);
            let zs = crowd.field(FIELD_POS_Z);
            for i in 0..door_n {
                assert!(xs[i].is_finite() && zs[i].is_finite(), "bidir doorway NaN at step {step}, agent {i}");
                if zs[i].abs() > 10.5 {
                    assert!(
                        xs[i].abs() >= 2.5,
                        "agent {i} penetrated 2m doorway wall at ({:.2}, {:.2}) step {step}",
                        xs[i],
                        zs[i]
                    );
                }
            }
            if step % 60 == 0 || step == 419 {
                let min_d = 5.6 * 0.97;
                for i in 0..door_n {
                    for j in (i + 1)..door_n {
                        let d = ((xs[j] - xs[i]).powi(2) + (zs[j] - zs[i]).powi(2)).sqrt();
                        assert!(d >= min_d, "bidir doorway overlap step {step}: {i}&{j} dist={d:.3}");
                    }
                }
            }
        }
        let crossed_west = (0..16).filter(|&i| crowd.agent_pos(i).0 > 4.0).count();
        let crossed_east = (16..32).filter(|&i| crowd.agent_pos(i).0 < -4.0).count();
        eprintln!("RVO2 2.0m bidir doorway: west->east={crossed_west}/16, east->west={crossed_east}/16");
        assert!(
            crossed_west + crossed_east >= 28,
            "2.0m doorway should pass opposing crowds cleanly without deadlock ({crossed_west} + {crossed_east})"
        );

        // Part C: Static agent & max capacity sanity.
        assert_eq!(MAX_AGENTS, 512);
        crowd.reset();
        crowd.set_agent(0, 0.0, 10.0, 0.0, 0.0, 0.0, 20.0, 0.0, 3.0, 20.0, CROWD_FLAG_IGNORE_WORLD);
        crowd.set_agent(1, 20.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 3.0, 0.0, CROWD_FLAG_STATIC | CROWD_FLAG_IGNORE_WORLD);
        for _ in 0..40 {
            crowd.step(2, dt, 1.5, None);
        }
        assert_eq!(crowd.agent_pos(1), (20.0, 10.0, 0.0), "static obstacle agent must never move");
    }
}
