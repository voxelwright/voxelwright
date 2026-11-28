//! EQS-Lite Tactical Spatial Queries over cached walkable nav tiles and 10 cm voxels (#164).
//!
//! Provides fast, scored spatial queries directly in Rust/WASM:
//! - [`find_cover`]: Hard & crouching/waist-high cover occluded from a threat `(tx, ty, tz)`.
//! - [`find_shelter`]: Walkable rain shelter under solid overhead awnings/overhangs (`+18..+60` cells).
//! - [`find_vantage`]: Elevated or clear-LOS firing/observation positions within `[min_range, max_range]`.
//!
//! Results are stored in a reusable flat buffer of up to [`EQS_MAX_RESULTS`] (`32`) entries,
//! each 4 `f32`s `[x, y, z, score]` sorted descending by `score`.

use crate::kinds::{LEAVES, WATER};
use crate::nav::heightfield::{
    AGENT_TALL, MOVE_WALK, NAV_STEP, SPAN_RUBBLE, TILE_COLS, VoxelSource, col_center, col_index,
    world_to_tile,
};
use crate::nav::tiles::TileCache;
use crate::perception::{CHEST, EYES, HEAD, VoxelQuery, has_los, is_visually_clear, los_hit};
use std::cell::RefCell;

/// Maximum ranked spatial candidates returned by any EQS query.
pub const EQS_MAX_RESULTS: usize = 32;
/// Floats per EQS result (`[x, y, z, score]`).
pub const EQS_STRIDE: usize = 4;
/// Total `f32`s in the reusable EQS output buffer (`32 * 4 = 128`).
pub const EQS_BUF_FLOATS: usize = EQS_MAX_RESULTS * EQS_STRIDE;

/// Minimum spacing (fine cells) between returned EQS results so a squad receives spatially diverse options.
const RESULT_MIN_SPACING: f32 = 6.0;
/// Maximum distance from candidate to threat-facing wall considered "real hard cover" (2.0 m).
const HARD_COVER_DIST: f32 = 20.0;
/// Crouching torso/head height above feet (0.8 m) for waist-high cover checks.
const CROUCH_HEIGHT: f32 = 8.0;
/// Standing peek height above feet (1.7 m) for checking open sightline over waist-high cover.
const PEEK_HEIGHT: f32 = 17.0;
/// Overhead roof/awning height band above walkable floor for rain shelter (1.8 m..6.0 m).
const SHELTER_MIN_CLEARANCE: u16 = AGENT_TALL as u16;
const SHELTER_MAX_CLEARANCE: u16 = 60;

/// One scored spatial candidate.
#[derive(Clone, Copy, Debug)]
pub struct EqsResult {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub score: f32,
}

/// Reusable scratch and output buffer for EQS queries (zero steady-state allocations).
pub struct EqsState {
    /// Flat output buffer: `[x, y, z, score]` repeated up to `EQS_MAX_RESULTS` times.
    out: [f32; EQS_BUF_FLOATS],
    len: usize,
    scratch: Vec<EqsResult>,
    cover_pre: Vec<CoverCand>,
    vantage_pre: Vec<VantageCand>,
}

#[derive(Clone, Copy)]
struct CoverCand {
    x: f32,
    y: f32,
    z: f32,
    d_obs: f32,
    d_threat: f32,
    wall_dist: f32,
    has_low_cover: bool,
    has_high_cover: bool,
    can_peek_over: bool,
    is_rubble: bool,
    pre_score: f32,
}

#[derive(Clone, Copy)]
struct VantageCand {
    x: f32,
    y: f32,
    z: f32,
    d_target: f32,
    pre_score: f32,
}

impl Default for EqsState {
    fn default() -> Self {
        Self::new()
    }
}

impl EqsState {
    pub fn new() -> Self {
        Self {
            out: [0.0; EQS_BUF_FLOATS],
            len: 0,
            scratch: Vec::with_capacity(256),
            cover_pre: Vec::with_capacity(512),
            vantage_pre: Vec::with_capacity(512),
        }
    }

    #[inline]
    pub fn results_ptr(&self) -> *const f32 {
        self.out.as_ptr()
    }

    #[inline]
    pub fn results_len(&self) -> usize {
        self.len
    }

    pub fn results_slice(&self) -> &[f32] {
        &self.out[..self.len * EQS_STRIDE]
    }

    /// Sorts `self.scratch` descending by `score`, applies light 3D de-clustering, and writes up to
    /// `EQS_MAX_RESULTS` entries into `self.out`.
    fn finalize(&mut self) -> usize {
        self.scratch
            .sort_unstable_by(|a, b| b.score.total_cmp(&a.score));
        self.len = 0;
        let min_sp_sq = RESULT_MIN_SPACING * RESULT_MIN_SPACING;

        for i in 0..self.scratch.len() {
            let c = self.scratch[i];
            if !c.score.is_finite() {
                continue;
            }
            let mut too_close = false;
            for k in 0..self.len {
                let ox = self.out[k * EQS_STRIDE];
                let oy = self.out[k * EQS_STRIDE + 1];
                let oz = self.out[k * EQS_STRIDE + 2];
                let dx = c.x - ox;
                let dy = c.y - oy;
                let dz = c.z - oz;
                if dx * dx + dy * dy + dz * dz < min_sp_sq {
                    too_close = true;
                    break;
                }
            }
            if too_close {
                continue;
            }
            let base = self.len * EQS_STRIDE;
            self.out[base] = c.x;
            self.out[base + 1] = c.y;
            self.out[base + 2] = c.z;
            self.out[base + 3] = c.score;
            self.len += 1;
            if self.len >= EQS_MAX_RESULTS {
                break;
            }
        }
        self.len
    }
}

/// Ensures all nav tiles overlapping `[cx - r .. cx + r] × [cz - r .. cz + r]` are baked and
/// rebakes nearby dirty tiles so recent blasts/edits immediately affect EQS queries.
fn ensure_query_tiles<S: VoxelSource>(
    cache: &mut TileCache,
    src: &mut S,
    cx: f32,
    cz: f32,
    radius: f32,
) -> (i32, i32, i32, i32) {
    let tx0 = world_to_tile((cx - radius).floor() as i32);
    let tx1 = world_to_tile((cx + radius).ceil() as i32);
    let tz0 = world_to_tile((cz - radius).floor() as i32);
    let tz1 = world_to_tile((cz + radius).ceil() as i32);

    if cache.dirty_count() > 0 {
        let budget = (((tx1 - tx0 + 1) * (tz1 - tz0 + 1)) as usize).clamp(4, 32);
        cache.rebake_budget(src, cx, cz, budget);
    }
    for tz in tz0..=tz1 {
        for tx in tx0..=tx1 {
            cache.ensure_tile(src, (tx, tz));
        }
    }
    (tx0, tx1, tz0, tz1)
}

#[inline]
fn adaptive_stride(radius: f32) -> usize {
    if radius <= 56.0 {
        1
    } else if radius <= 128.0 {
        2
    } else if radius <= 224.0 {
        3
    } else {
        (radius / 72.0).ceil() as usize
    }
}

/// Finds up to `32` tactical cover positions within `radius` cells of observer `(ox, oy, oz)`
/// occluded from threat `(tx, ty, tz)`.
///
/// Rewards:
/// - Real hard cover: opaque voxel wall within `1..=20` cells of the candidate on the threat-facing side.
/// - Waist-high / crouching cover (`8..=16` cells tall) with an open standing peek sightline above,
///   or full-height corner walls with a lateral step-out peek.
/// - Proximity to observer and safe distance away from the threat.
#[allow(clippy::too_many_arguments)]
pub fn find_cover<S: VoxelSource + VoxelQuery>(
    state: &mut EqsState,
    cache: &mut TileCache,
    src: &mut S,
    ox: f32,
    oy: f32,
    oz: f32,
    tx: f32,
    ty: f32,
    tz: f32,
    radius: f32,
) -> usize {
    state.len = 0;
    state.scratch.clear();
    state.cover_pre.clear();
    if !ox.is_finite()
        || !oy.is_finite()
        || !oz.is_finite()
        || !tx.is_finite()
        || !ty.is_finite()
        || !tz.is_finite()
        || !radius.is_finite()
        || radius <= 0.0
    {
        return 0;
    }

    let r = radius.clamp(8.0, 512.0);
    let r_sq = r * r;
    let (tx0, tx1, tz0, tz1) = ensure_query_tiles(cache, src, ox, oz, r);
    let stride = adaptive_stride(r);
    let obs_threat_dist = ((tx - ox) * (tx - ox) + (tz - oz) * (tz - oz)).sqrt();

    // Stage 1: Sample walkable spans and probe local threat-facing cover (1..=20 cells).
    for tile_z in tz0..=tz1 {
        for tile_x in tx0..=tx1 {
            let Some(tile) = cache.get((tile_x, tile_z)) else {
                continue;
            };
            let mut cz = 0usize;
            while cz < TILE_COLS {
                let wz = col_center(tile_z, cz) as f32;
                let dz_o = wz - oz;
                if dz_o.abs() <= r + NAV_STEP as f32 {
                    let mut cx = 0usize;
                    while cx < TILE_COLS {
                        let wx = col_center(tile_x, cx) as f32;
                        let dx_o = wx - ox;
                        let d_obs_sq = dx_o * dx_o + dz_o * dz_o;
                        if d_obs_sq <= r_sq {
                            let (_, slice) = tile.col_slice(col_index(cx, cz));
                            for sp in slice {
                                let wy = sp.y as f32;
                                if (wy - oy).abs() > 72.0 {
                                    continue;
                                }
                                let dx_t = tx - wx;
                                let dz_t = tz - wz;
                                let d_threat_sq = dx_t * dx_t + dz_t * dz_t;
                                if d_threat_sq < 36.0 {
                                    // Too close to the threat itself (< 60 cm).
                                    continue;
                                }
                                let d_threat = d_threat_sq.sqrt();
                                let d_obs = d_obs_sq.sqrt();
                                let inv_dt = 1.0 / d_threat;
                                let ux = dx_t * inv_dt;
                                let uz = dz_t * inv_dt;

                                let probe_len = HARD_COVER_DIST.min(d_threat - 1.0).max(1.0);
                                let px_end = wx + ux * probe_len;
                                let pz_end = wz + uz * probe_len;

                                // Probe waist/chest height (y + 10, right inside 8..16 cover band)
                                // and head height (y + 16) toward threat within 1..20 cells.
                                let low_hit = los_hit(
                                    src,
                                    [wx, wy + 10.0, wz],
                                    [px_end, wy + 10.0, pz_end],
                                );
                                let (has_low, has_high, can_peek_over, wall_dist) =
                                    if let Some((_, t_low)) = low_hit {
                                        let wd = (t_low * probe_len).clamp(1.0, HARD_COVER_DIST);
                                        let high_hit = los_hit(
                                            src,
                                            [wx, wy + HEAD, wz],
                                            [px_end, wy + HEAD, pz_end],
                                        );
                                        let high = high_hit.is_some();
                                        let peek = if !high {
                                            // Verify open standing peek sightline above the waist-high barrier.
                                            has_los(
                                                src,
                                                [wx, wy + PEEK_HEIGHT, wz],
                                                [wx + ux * (wd + 4.0), wy + PEEK_HEIGHT, wz + uz * (wd + 4.0)],
                                            )
                                        } else {
                                            false
                                        };
                                        (true, high, peek, wd)
                                    } else {
                                        // Also check lower waist (y + 8) in case cover is exactly 8..9 cells tall.
                                        let crouch_hit = los_hit(
                                            src,
                                            [wx, wy + CROUCH_HEIGHT, wz],
                                            [px_end, wy + CROUCH_HEIGHT, pz_end],
                                        );
                                        if let Some((_, t_c)) = crouch_hit {
                                            let wd = (t_c * probe_len).clamp(1.0, HARD_COVER_DIST);
                                            let peek = has_los(
                                                src,
                                                [wx, wy + PEEK_HEIGHT, wz],
                                                [wx + ux * (wd + 4.0), wy + PEEK_HEIGHT, wz + uz * (wd + 4.0)],
                                            );
                                            (true, false, peek, wd)
                                        } else {
                                            (false, false, false, HARD_COVER_DIST + 1.0)
                                        }
                                    };

                                let prox = 20.0 * (1.0 - d_obs / r).clamp(0.0, 1.0);
                                let safe_d = 15.0 * (d_threat / (obs_threat_dist.max(40.0) + 40.0)).clamp(0.0, 1.2);
                                let near_wall_bonus = if has_low {
                                    // Prefer hugging cover at ~3..8 cells behind the wall.
                                    let hug = 1.0 - ((wall_dist - 4.0).abs() / HARD_COVER_DIST).clamp(0.0, 0.75);
                                    40.0 * hug + if can_peek_over { 14.0 } else if has_high { 8.0 } else { 0.0 }
                                } else {
                                    0.0
                                };
                                let pre_score = near_wall_bonus + prox + safe_d - (wy - oy).abs() * 0.25;

                                state.cover_pre.push(CoverCand {
                                    x: wx,
                                    y: wy,
                                    z: wz,
                                    d_obs,
                                    d_threat,
                                    wall_dist,
                                    has_low_cover: has_low,
                                    has_high_cover: has_high,
                                    can_peek_over,
                                    is_rubble: (sp.flags & SPAN_RUBBLE) != 0,
                                    pre_score,
                                });
                            }
                        }
                        cx += stride;
                    }
                }
                cz += stride;
            }
        }
    }

    if state.cover_pre.is_empty() {
        return 0;
    }

    // Sort descending by cheap pre-score so hard-cover candidates right behind walls are verified first.
    state
        .cover_pre
        .sort_unstable_by(|a, b| b.pre_score.total_cmp(&a.pre_score));

    // Stage 2: Exact threat-to-candidate LOS verification on top candidates.
    let threat_eye = [tx, ty + EYES, tz];
    let verify_cap = state.cover_pre.len().min(128);

    for i in 0..verify_cap {
        let c = state.cover_pre[i];
        let head_clear = has_los(src, threat_eye, [c.x, c.y + HEAD, c.z]);
        let chest_clear = has_los(src, threat_eye, [c.x, c.y + CHEST, c.z]);
        let crouch_clear = if !chest_clear {
            false
        } else {
            has_los(src, threat_eye, [c.x, c.y + CROUCH_HEIGHT, c.z])
        };

        // Completely exposed (even crouched) -> not cover!
        if head_clear && chest_clear && crouch_clear {
            continue;
        }

        // Occlusion quality:
        // - Full standing cover (head & chest blocked) or solid crouch cover (crouch/chest blocked by near wall).
        let mut score = if !head_clear && !chest_clear {
            52.0
        } else if !chest_clear {
            46.0
        } else {
            // Only crouch height occluded (waist-high barricade ~8..10 cells tall).
            42.0
        };

        // Real hard cover bonus when an opaque wall sits within 1..20 cells on the threat-facing side.
        if c.has_low_cover {
            let hug = 1.0 - ((c.wall_dist - 4.0).abs() / HARD_COVER_DIST).clamp(0.0, 0.72);
            score += 40.0 * hug;

            if c.can_peek_over && head_clear {
                // Waist-high crouch cover with an open peek sightline above!
                score += 18.0;
            } else if c.has_high_cover && !head_clear {
                // Full-height wall: check for a corner peek (±8 cells perpendicular to threat).
                let inv_dt = 1.0 / c.d_threat.max(1.0);
                let px_dir = -(tz - c.z) * inv_dt;
                let pz_dir = (tx - c.x) * inv_dt;
                let corner_left = has_los(
                    src,
                    [c.x, c.y + HEAD, c.z],
                    [c.x + px_dir * 8.0, c.y + HEAD, c.z + pz_dir * 8.0],
                ) && has_los(
                    src,
                    [c.x + px_dir * 8.0, c.y + HEAD, c.z + pz_dir * 8.0],
                    [c.x + px_dir * 8.0 + (tx - c.x) * inv_dt * (c.wall_dist + 4.0), c.y + HEAD, c.z + pz_dir * 8.0 + (tz - c.z) * inv_dt * (c.wall_dist + 4.0)],
                );
                let corner_right = !corner_left
                    && has_los(
                        src,
                        [c.x, c.y + HEAD, c.z],
                        [c.x - px_dir * 8.0, c.y + HEAD, c.z - pz_dir * 8.0],
                    )
                    && has_los(
                        src,
                        [c.x - px_dir * 8.0, c.y + HEAD, c.z - pz_dir * 8.0],
                        [c.x - px_dir * 8.0 + (tx - c.x) * inv_dt * (c.wall_dist + 4.0), c.y + HEAD, c.z - pz_dir * 8.0 + (tz - c.z) * inv_dt * (c.wall_dist + 4.0)],
                    );
                if corner_left || corner_right {
                    score += 12.0;
                }
            }
        }

        // Proximity to observer and safe distance away from threat.
        score += 20.0 * (1.0 - c.d_obs / r).clamp(0.0, 1.0);
        score += 15.0 * (c.d_threat / (obs_threat_dist.max(40.0) + 40.0)).clamp(0.0, 1.2);
        if c.d_threat < 24.0 {
            score -= 22.0 * (1.0 - c.d_threat / 24.0);
        }
        score -= (c.y - oy).abs() * 0.25;
        if !c.is_rubble {
            score += 2.0;
        }

        state.scratch.push(EqsResult {
            x: c.x,
            y: c.y,
            z: c.z,
            score,
        });
    }

    state.finalize()
}

/// Finds up to `32` walkable rain-shelter positions within `radius` cells of `(ox, oy, oz)`
/// that have a solid overhead roof/awning between `+18` and `+60` cells above the floor.
///
/// Prefers open-sided awnings and storefront arcades close to the observer with comfortable
/// walkable headroom (`22..=45` cells) and clean adjacent walk edges.
pub fn find_shelter<S: VoxelSource + VoxelQuery>(
    state: &mut EqsState,
    cache: &mut TileCache,
    src: &mut S,
    ox: f32,
    oy: f32,
    oz: f32,
    radius: f32,
) -> usize {
    state.len = 0;
    state.scratch.clear();
    if !ox.is_finite()
        || !oy.is_finite()
        || !oz.is_finite()
        || !radius.is_finite()
        || radius <= 0.0
    {
        return 0;
    }

    let r = radius.clamp(8.0, 512.0);
    let r_sq = r * r;
    let (tx0, tx1, tz0, tz1) = ensure_query_tiles(cache, src, ox, oz, r);
    // Shelter Stage 1 skips open-sky spans in O(1) via `clearance`, so stride 1 stays well under 0.1 ms.
    let stride = if r <= 128.0 { 1 } else { adaptive_stride(r) };

    for tile_z in tz0..=tz1 {
        for tile_x in tx0..=tx1 {
            let Some(tile) = cache.get((tile_x, tile_z)) else {
                continue;
            };
            let mut cz = 0usize;
            while cz < TILE_COLS {
                let wz = col_center(tile_z, cz);
                let dz_o = wz as f32 - oz;
                if dz_o.abs() <= r + NAV_STEP as f32 {
                    let mut cx = 0usize;
                    while cx < TILE_COLS {
                        let wx = col_center(tile_x, cx);
                        let dx_o = wx as f32 - ox;
                        let d_obs_sq = dx_o * dx_o + dz_o * dz_o;
                        if d_obs_sq <= r_sq {
                            let (_, slice) = tile.col_slice(col_index(cx, cz));
                            for sp in slice {
                                if sp.clearance < SHELTER_MIN_CLEARANCE
                                    || sp.clearance > SHELTER_MAX_CLEARANCE
                                {
                                    continue;
                                }
                                let wy = sp.y;
                                let dy = (wy as f32 - oy).abs();
                                if dy > 72.0 {
                                    continue;
                                }

                                // Confirm solid non-water, non-leaf roof/awning voxel overhead.
                                let roof_y = wy + sp.clearance as i32;
                                let roof_k = src.kind(wx, roof_y, wz);
                                let roof_mat = (roof_k & 15) as u8;
                                if roof_mat == 0 || roof_mat == WATER || roof_mat == LEAVES {
                                    continue;
                                }

                                // Measure local roof coverage around the overhead point so 1-cell ledges rank lower.
                                let mut roof_cover = 0u32;
                                for &(ox_r, oz_r) in &[(2, 0), (-2, 0), (0, 2), (0, -2)] {
                                    let nk = src.kind(wx + ox_r, roof_y, wz + oz_r);
                                    let nm = (nk & 15) as u8;
                                    if nm != 0 && nm != WATER && nm != LEAVES {
                                        roof_cover += 1;
                                    } else {
                                        // Allow slightly sloped roofs (+/- 1 cell).
                                        let nk_up = src.kind(wx + ox_r, roof_y + 1, wz + oz_r);
                                        let nm_up = (nk_up & 15) as u8;
                                        if nm_up != 0 && nm_up != WATER && nm_up != LEAVES {
                                            roof_cover += 1;
                                        }
                                    }
                                }
                                if roof_cover == 0 {
                                    continue;
                                }

                                // Check whether this sheltered spot is open-sided (arcade / awning with open air nearby).
                                let mut open_sky_sides = 0u32;
                                for &(dx_c, dz_c) in &[(2isize, 0isize), (-2, 0), (0, 2), (0, -2)] {
                                    let ncx = cx as isize + dx_c;
                                    let ncz = cz as isize + dz_c;
                                    if (0..TILE_COLS as isize).contains(&ncx)
                                        && (0..TILE_COLS as isize).contains(&ncz)
                                    {
                                        let (_, nslice) = tile.col_slice(col_index(ncx as usize, ncz as usize));
                                        if nslice.iter().any(|ns| (ns.y - wy).abs() <= 4 && ns.clearance == u16::MAX) {
                                            open_sky_sides += 1;
                                        }
                                    }
                                }

                                let d_obs = d_obs_sq.sqrt();
                                let prox = 35.0 * (1.0 - d_obs / r).clamp(0.0, 1.0);
                                let headroom = if (22..=45).contains(&sp.clearance) {
                                    14.0
                                } else {
                                    8.0
                                };
                                let walkable_edges = (sp.edge_count.min(4) as f32) * 2.5;
                                let arcade_bonus = if open_sky_sides >= 1 { 14.0 } else { 0.0 };
                                let cover_bonus = (roof_cover as f32) * 3.5;
                                let rubble_bonus = if sp.flags & SPAN_RUBBLE == 0 { 2.0 } else { 0.0 };
                                let score = 30.0
                                    + prox
                                    + headroom
                                    + walkable_edges
                                    + arcade_bonus
                                    + cover_bonus
                                    + rubble_bonus
                                    - dy * 0.3;

                                state.scratch.push(EqsResult {
                                    x: wx as f32,
                                    y: wy as f32,
                                    z: wz as f32,
                                    score,
                                });
                            }
                        }
                        cx += stride;
                    }
                }
                cz += stride;
            }
        }
    }

    state.finalize()
}

/// Finds up to `32` vantage positions within `[min_range, max_range]` cells of target `(tx, ty, tz)`
/// with clear eye-to-head or eye-to-chest line of sight to the target.
///
/// Rewards elevation advantage (`y > ty`), moderate ideal standoff distance, observer proximity,
/// and nearby partial cover (such as roof parapets or balcony railings).
#[allow(clippy::too_many_arguments)]
pub fn find_vantage<S: VoxelSource + VoxelQuery>(
    state: &mut EqsState,
    cache: &mut TileCache,
    src: &mut S,
    ox: f32,
    oy: f32,
    oz: f32,
    tx: f32,
    ty: f32,
    tz: f32,
    min_range: f32,
    max_range: f32,
) -> usize {
    state.len = 0;
    state.scratch.clear();
    state.vantage_pre.clear();
    if !ox.is_finite()
        || !oy.is_finite()
        || !oz.is_finite()
        || !tx.is_finite()
        || !ty.is_finite()
        || !tz.is_finite()
        || !min_range.is_finite()
        || !max_range.is_finite()
        || max_range <= 0.0
        || min_range > max_range
    {
        return 0;
    }

    let min_r = min_range.max(0.0);
    let max_r = max_range.clamp(min_r.max(8.0), 640.0);
    let min_r_sq = min_r * min_r;
    let max_r_sq = max_r * max_r;
    let range_span = (max_r - min_r).max(16.0);
    let ideal_r = min_r + range_span * 0.45;

    let (tx0, tx1, tz0, tz1) = ensure_query_tiles(cache, src, tx, tz, max_r);
    // Stage 1 only reads cached NavSpan structs (zero voxel queries), so stride 1 up to 128 cells
    // ensures narrow balcony lips right behind parapets are never skipped.
    let stride = if max_r <= 128.0 { 1 } else { adaptive_stride(max_r) };

    // Stage 1: Gather walkable spans inside [min_range, max_range] of target and pre-score.
    for tile_z in tz0..=tz1 {
        for tile_x in tx0..=tx1 {
            let Some(tile) = cache.get((tile_x, tile_z)) else {
                continue;
            };
            let mut cz = 0usize;
            while cz < TILE_COLS {
                let wz = col_center(tile_z, cz) as f32;
                let dz_t = wz - tz;
                if dz_t.abs() <= max_r + NAV_STEP as f32 {
                    let mut cx = 0usize;
                    while cx < TILE_COLS {
                        let wx = col_center(tile_x, cx) as f32;
                        let dx_t = wx - tx;
                        let d_t_sq = dx_t * dx_t + dz_t * dz_t;
                        if d_t_sq >= min_r_sq && d_t_sq <= max_r_sq {
                            let (span_start, slice) = tile.col_slice(col_index(cx, cz));
                            let d_target = d_t_sq.sqrt();
                            let d_obs = ((wx - ox) * (wx - ox) + (wz - oz) * (wz - oz)).sqrt();
                            let standoff = 20.0 * (1.0 - (d_target - ideal_r).abs() / range_span).clamp(0.0, 1.0);
                            let obs_prox = 15.0 / (1.0 + d_obs / max_r.max(64.0));

                            for (si, sp) in slice.iter().enumerate() {
                                let wy = sp.y as f32;
                                let elev = wy - ty;
                                let elev_score = if elev > 0.0 {
                                    // Strong monotonic reward for elevated roofs, balconies and ridges.
                                    45.0 * (elev / 50.0).min(1.6)
                                } else {
                                    (elev * 0.25).max(-15.0)
                                };
                                let rubble_bonus = if sp.flags & SPAN_RUBBLE == 0 { 2.0 } else { 0.0 };
                                let walk_edges = tile
                                    .span_edges(span_start + si as u16)
                                    .iter()
                                    .filter(|e| e.move_kind == MOVE_WALK)
                                    .count();
                                let footing_bonus = if walk_edges >= 3 {
                                    4.0
                                } else if walk_edges <= 2 {
                                    // Prefer proper roof/balcony decks over perching on narrow 1-column parapets.
                                    -10.0
                                } else {
                                    0.0
                                };
                                let pre_score =
                                    20.0 + elev_score + standoff + obs_prox + rubble_bonus + footing_bonus;
                                state.vantage_pre.push(VantageCand {
                                    x: wx,
                                    y: wy,
                                    z: wz,
                                    d_target,
                                    pre_score,
                                });
                            }
                        }
                        cx += stride;
                    }
                }
                cz += stride;
            }
        }
    }

    if state.vantage_pre.is_empty() {
        return 0;
    }

    state
        .vantage_pre
        .sort_unstable_by(|a, b| b.pre_score.total_cmp(&a.pre_score));

    // Stage 2: Verify exact eye-to-head/chest LOS and reward nearby partial cover (parapet/pillar).
    let target_head = [tx, ty + HEAD, tz];
    let target_chest = [tx, ty + CHEST, tz];
    let max_rays = 256usize;
    let enough_valid = EQS_MAX_RESULTS * 2;
    let mut tested = 0usize;

    for i in 0..state.vantage_pre.len() {
        if tested >= max_rays || state.scratch.len() >= enough_valid {
            break;
        }
        let c = state.vantage_pre[i];
        tested += 1;
        let eye = [c.x, c.y + EYES, c.z];
        let head_ok = has_los(src, eye, target_head);
        let chest_ok = if head_ok {
            true
        } else {
            has_los(src, eye, target_chest)
        };
        if !head_ok && !chest_ok {
            continue;
        }

        let vis_bonus = if head_ok { 12.0 } else { 5.0 };

        // Check nearby partial cover: waist-high parapet/railing toward target OR lateral pillar.
        let mut cover_bonus = 0.0f32;
        if c.d_target > 4.0 {
            let inv_d = 1.0 / c.d_target;
            let ux = (tx - c.x) * inv_d;
            let uz = (tz - c.z) * inv_d;
            let parapet_probe = 12.0f32.min(c.d_target - 1.0);
            let low_hit = los_hit(
                src,
                [c.x, c.y + CROUCH_HEIGHT, c.z],
                [c.x + ux * parapet_probe, c.y + CROUCH_HEIGHT, c.z + uz * parapet_probe],
            );
            if low_hit.is_some() {
                // Solid waist-high parapet with clear eye LOS above!
                cover_bonus = 18.0;
            } else {
                // Check nearby lateral wall/pillar at ±6 cells perpendicular to target.
                let px = -uz * 6.0;
                let pz = ux * 6.0;
                let side_cover = !is_visually_clear(src.kind(
                    (c.x + px).floor() as i32,
                    (c.y + CHEST).floor() as i32,
                    (c.z + pz).floor() as i32,
                )) || !is_visually_clear(src.kind(
                    (c.x - px).floor() as i32,
                    (c.y + CHEST).floor() as i32,
                    (c.z - pz).floor() as i32,
                ));
                if side_cover {
                    cover_bonus = 8.0;
                }
            }
        }

        state.scratch.push(EqsResult {
            x: c.x,
            y: c.y,
            z: c.z,
            score: c.pre_score + vis_bonus + cover_bonus,
        });
    }

    state.finalize()
}

thread_local! {
    static EQS: RefCell<EqsState> = RefCell::new(EqsState::new());
}

/// Pointer to the reusable `[x, y, z, score]` output buffer (`eqs_results_len() * 4` floats).
pub fn results_ptr() -> *const f32 {
    EQS.with_borrow(|e| e.results_ptr())
}

/// Number of ranked results produced by the last EQS query (`0..=32`).
pub fn results_len() -> usize {
    EQS.with_borrow(|e| e.results_len())
}

#[allow(clippy::too_many_arguments)]
pub fn query_cover<S: VoxelSource + VoxelQuery>(
    cache: &mut TileCache,
    src: &mut S,
    ox: f32,
    oy: f32,
    oz: f32,
    tx: f32,
    ty: f32,
    tz: f32,
    radius: f32,
) -> usize {
    EQS.with_borrow_mut(|e| find_cover(e, cache, src, ox, oy, oz, tx, ty, tz, radius))
}

pub fn query_shelter<S: VoxelSource + VoxelQuery>(
    cache: &mut TileCache,
    src: &mut S,
    ox: f32,
    oy: f32,
    oz: f32,
    radius: f32,
) -> usize {
    EQS.with_borrow_mut(|e| find_shelter(e, cache, src, ox, oy, oz, radius))
}

#[allow(clippy::too_many_arguments)]
pub fn query_vantage<S: VoxelSource + VoxelQuery>(
    cache: &mut TileCache,
    src: &mut S,
    ox: f32,
    oy: f32,
    oz: f32,
    tx: f32,
    ty: f32,
    tz: f32,
    min_range: f32,
    max_range: f32,
) -> usize {
    EQS.with_borrow_mut(|e| {
        find_vantage(e, cache, src, ox, oy, oz, tx, ty, tz, min_range, max_range)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kinds::{ASPHALT, BRICK, CONCRETE, WOOD, kind};
    use crate::tree::Kind;
    use std::time::Instant;

    struct SyntheticEqsWorld {
        floor_y: i32,
        y_bounds: (i32, i32),
        boxes: Vec<([i32; 3], [i32; 3], Kind)>,
    }

    impl SyntheticEqsWorld {
        fn new(floor_y: i32, y_lo: i32, y_hi: i32) -> Self {
            Self {
                floor_y,
                y_bounds: (y_lo, y_hi),
                boxes: Vec::new(),
            }
        }
        fn fill(&mut self, lo: [i32; 3], hi: [i32; 3], k: Kind) {
            self.boxes.push((lo, hi, k));
        }
    }

    impl VoxelSource for SyntheticEqsWorld {
        fn kind(&mut self, x: i32, y: i32, z: i32) -> Kind {
            let mut k = if y <= self.floor_y { kind(ASPHALT, 0) } else { 0 };
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

    impl VoxelQuery for SyntheticEqsWorld {
        fn voxel_kind(&mut self, x: i32, y: i32, z: i32) -> Kind {
            VoxelSource::kind(self, x, y, z)
        }
    }

    #[test]
    fn find_cover_picks_behind_concrete_wall_and_is_fast() {
        let mut world = SyntheticEqsWorld::new(9, 0, 80);
        // Solid concrete wall at x = 36..40, y = 10..34, z = 14..50 (2.4 m tall, 3.6 m wide).
        world.fill([36, 10, 14], [40, 34, 50], kind(CONCRETE, 0));

        let mut cache = TileCache::new();
        let mut state = EqsState::new();
        // Threat at East (80, 10, 32), observer at West (20, 10, 32).
        let n = find_cover(&mut state, &mut cache, &mut world, 20.0, 10.0, 32.0, 80.0, 10.0, 32.0, 80.0);
        assert!(n >= 5, "expected multiple cover spots behind concrete wall (got {n})");

        let res = state.results_slice();
        // Verify sorted descending and top results sit strictly behind the wall (x < 36, z in 14..50)
        // with occluded LOS to threat!
        for i in 0..n {
            let cx = res[i * 4];
            let cy = res[i * 4 + 1];
            let cz = res[i * 4 + 2];
            let sc = res[i * 4 + 3];
            if i > 0 {
                assert!(sc <= res[(i - 1) * 4 + 3], "results must be sorted descending");
            }
            assert!(
                !has_los(&mut world, [80.0, 10.0 + EYES, 32.0], [cx, cy + CHEST, cz]),
                "cover candidate {i} at ({cx}, {cy}, {cz}) must be occluded at chest height from threat"
            );
        }
        let best_x = res[0];
        let best_z = res[2];
        assert!(
            best_x < 36.0 && best_x >= 16.0 && best_z >= 14.0 && best_z <= 50.0,
            "best cover should hug the protected West face of the wall, got ({best_x}, {best_z})"
        );

        // Benchmark query speed (tiles already cached).
        let iters = 50;
        let t0 = Instant::now();
        for _ in 0..iters {
            find_cover(&mut state, &mut cache, &mut world, 20.0, 10.0, 32.0, 80.0, 10.0, 32.0, 80.0);
        }
        let avg_ms = (t0.elapsed().as_secs_f64() * 1000.0) / iters as f64;
        eprintln!("eqs_find_cover (r=80, cached tiles): {avg_ms:.3} ms ({n} results)");
        #[cfg(not(debug_assertions))]
        assert!(avg_ms < 0.5, "eqs_find_cover took {avg_ms:.3} ms (gate < 0.5 ms)");
    }

    #[test]
    fn find_cover_recognizes_waist_high_crouch_cover() {
        let mut world = SyntheticEqsWorld::new(9, 0, 80);
        // Waist-high concrete barricade: y = 10..21 (11 cells = 1.1 m tall) at x = 36..40, z = 20..44.
        world.fill([36, 10, 20], [40, 21, 44], kind(CONCRETE, 0));

        let mut cache = TileCache::new();
        let mut state = EqsState::new();
        let n = find_cover(&mut state, &mut cache, &mut world, 24.0, 10.0, 32.0, 80.0, 10.0, 32.0, 64.0);
        assert!(n >= 1, "waist-high barricade should provide valid crouching cover");
        let res = state.results_slice();
        let best_x = res[0];
        let best_y = res[1];
        let best_z = res[2];
        assert!(
            best_x < 36.0 && best_z >= 20.0 && best_z <= 44.0,
            "best waist-high cover must be behind barricade, got ({best_x}, {best_y}, {best_z})"
        );
        // Crouch height occluded while standing head has open peek sightline!
        assert!(!has_los(&mut world, [80.0, 10.0 + EYES, 32.0], [best_x, best_y + CROUCH_HEIGHT, best_z]));
        assert!(has_los(&mut world, [80.0, 10.0 + EYES, 32.0], [best_x, best_y + PEEK_HEIGHT, best_z]));
    }

    #[test]
    fn find_shelter_picks_under_rain_awning_and_rejects_open_sky() {
        let mut world = SyntheticEqsWorld::new(9, 0, 90);
        // Open sky everywhere EXCEPT a wooden rain awning at x = 20..44, z = 20..44, y = 36..38 (26 cells above floor).
        world.fill([20, 36, 20], [44, 38, 44], kind(WOOD, 0));

        let mut cache = TileCache::new();
        let mut state = EqsState::new();
        // Query right under/near the awning.
        let n = find_shelter(&mut state, &mut cache, &mut world, 10.0, 10.0, 32.0, 80.0);
        assert!(n >= 4, "expected sheltered positions under awning (got {n})");
        let res = state.results_slice();
        for i in 0..n {
            let sx = res[i * 4];
            let sy = res[i * 4 + 1];
            let sz = res[i * 4 + 2];
            assert!(
                sx >= 20.0 && sx < 44.0 && sz >= 20.0 && sz < 44.0 && sy == 10.0,
                "shelter result {i} must lie strictly under awning at y=10, got ({sx}, {sy}, {sz})"
            );
        }

        // Far away in pure open sky -> 0 shelter results!
        let n_open = find_shelter(&mut state, &mut cache, &mut world, 240.0, 10.0, 240.0, 64.0);
        assert_eq!(n_open, 0, "open sky must return 0 shelter positions");

        // Benchmark cached shelter query.
        let iters = 50;
        let t0 = Instant::now();
        for _ in 0..iters {
            find_shelter(&mut state, &mut cache, &mut world, 10.0, 10.0, 32.0, 80.0);
        }
        let avg_ms = (t0.elapsed().as_secs_f64() * 1000.0) / iters as f64;
        eprintln!("eqs_find_shelter (r=80, cached tiles): {avg_ms:.3} ms ({n} results)");
        #[cfg(not(debug_assertions))]
        assert!(avg_ms < 0.5, "eqs_find_shelter took {avg_ms:.3} ms (gate < 0.5 ms)");
    }

    #[test]
    fn find_vantage_picks_elevated_balcony_with_clear_los_and_rejects_obstructed() {
        let mut world = SyntheticEqsWorld::new(9, 0, 110);
        // Target stands in courtyard at (90, 10, 32).
        // Elevated balcony/roof A (GOOD): x = 20..44, z = 16..48, deck y = 48..50 (standing y = 50, +40 elevation!)
        // with a waist-high parapet at x = 42..44, y = 50..59 (9 cells tall -> clear eye LOS at y=66!).
        world.fill([20, 48, 16], [44, 50, 48], kind(CONCRETE, 0));
        world.fill([42, 50, 16], [44, 59, 48], kind(BRICK, 0));

        // Elevated roof B (OBSTRUCTED): x = 136..160, z = 16..48, deck y = 58..60 (even higher: y=60!),
        // but sealed by a tall solid wall on its West target-facing edge x = 136..138, y = 60..86!
        world.fill([136, 58, 16], [160, 60, 48], kind(CONCRETE, 0));
        world.fill([136, 60, 16], [138, 86, 48], kind(BRICK, 0));

        let mut cache = TileCache::new();
        let mut state = EqsState::new();
        let n = find_vantage(
            &mut state,
            &mut cache,
            &mut world,
            60.0,
            10.0,
            32.0,
            90.0,
            10.0,
            32.0,
            30.0,
            90.0,
        );
        assert!(n >= 4, "expected clear vantage points (got {n})");
        let res = state.results_slice();

        // Top vantage point MUST be on elevated balcony A (y == 50, x in 20..44) and NEVER on obstructed roof B!
        assert_eq!(res[1], 50.0, "top vantage point should be on elevated balcony y=50 (got y={})", res[1]);
        assert!(res[0] >= 20.0 && res[0] < 44.0, "top vantage x={} should be on balcony A", res[0]);

        for i in 0..n {
            let vx = res[i * 4];
            let vy = res[i * 4 + 1];
            let vz = res[i * 4 + 2];
            // Must NOT pick any position on obstructed roof B.
            assert!(
                !(vx >= 136.0 && vx < 160.0 && vy >= 58.0),
                "obstructed roof B must be rejected, got ({vx}, {vy}, {vz})"
            );
            // Must have clear eye-to-head or eye-to-chest LOS to target.
            let eye = [vx, vy + EYES, vz];
            assert!(
                has_los(&mut world, eye, [90.0, 10.0 + HEAD, 32.0])
                    || has_los(&mut world, eye, [90.0, 10.0 + CHEST, 32.0]),
                "vantage {i} at ({vx}, {vy}, {vz}) lacks clear LOS to target"
            );
            let d = ((vx - 90.0).powi(2) + (vz - 32.0).powi(2)).sqrt();
            assert!(d >= 29.9 && d <= 90.1, "vantage {i} distance {d} out of [30, 90]");
        }

        // Benchmark cached vantage query.
        let iters = 50;
        let t0 = Instant::now();
        for _ in 0..iters {
            find_vantage(
                &mut state,
                &mut cache,
                &mut world,
                60.0,
                10.0,
                32.0,
                90.0,
                10.0,
                32.0,
                30.0,
                90.0,
            );
        }
        let avg_ms = (t0.elapsed().as_secs_f64() * 1000.0) / iters as f64;
        eprintln!("eqs_find_vantage (range 30..90, cached tiles): {avg_ms:.3} ms ({n} results)");
        #[cfg(not(debug_assertions))]
        assert!(avg_ms < 0.5, "eqs_find_vantage took {avg_ms:.3} ms (gate < 0.5 ms)");
    }
}
