//! Continuous multi-bounce thermal laser and energy beams (#166).
//!
//! Traces instantaneous 3D DDA rays across voxel worlds and dynamic body/ragdoll proxies
//! (`BeamTarget`), handling specular mirror reflections off `POLISHED` steel/metal surfaces
//! and Fresnel grazing-angle reflection/split off `GLASS`. Deposited energy accumulates in a
//! sparse cooling `ThermalMap`, cleanly boring tunnels through solid voxels once energy
//! reaches each material's calibrated melt threshold, igniting flammable materials
//! (`kinds::burns`) before they melt, and emitting `HeatGlow` records for `lights.ts` and
//! `puffs.ts`.

use std::collections::HashMap;

use crate::kinds::{
    ASPHALT, BRICK, CONCRETE, EARTH, GLASS, GRASS, LAMP, LEAVES, PLASTER, POLISHED, ROCK, ROOFING,
    SAND, STEEL, WATER, WOOD, burns, material,
};
use crate::tree::Kind;

/// Hard upper bound on reflection/split bounces per beam.
pub const MAX_BOUNCES: u8 = 8;
/// Maximum total segments emitted by one `fire_step` (caps branching through multiple glass panes).
const MAX_SEGMENTS: usize = 32;
/// Minimum remaining beam power required to continue bouncing or splitting.
pub const MIN_BEAM_POWER: f32 = 1e-3;
/// Cells cool below this normalized heat are evicted from `ThermalMap`.
pub const EVICT_HEAT_THRESHOLD: f32 = 0.01;
/// Surface offset applied when spawning reflected or transmitted rays to prevent self-intersection.
const SURFACE_EPS: f32 = 1e-4;
/// Specular reflectivity of `POLISHED` steel/mirror surfaces (85% reflected, 15% absorbed).
pub const POLISHED_REFLECTIVITY: f32 = 0.85;
/// Grazing-angle cosine threshold (`cos(theta) < 0.45`, i.e. < ~27 deg from surface) for `GLASS`.
pub const GLASS_GRAZING_COS: f32 = 0.45;
/// Normalized heat level at which a heated voxel begins igniting orthogonally adjacent fuel cells.
const ADJACENT_IGNITE_HEAT: f32 = 0.6;
/// Default exponential-style passive cooling rate (1/s).
const DEFAULT_COOLING_RATE: f32 = 0.55;
/// Default ambient radiative cooling floor (fraction of melt threshold per second).
const DEFAULT_AMBIENT_COOL: f32 = 0.03;

/// Specification for a single thermal laser / energy beam firing step.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BeamSpec {
    /// World-space beam origin in finest cells (10 cm units).
    pub origin: [f32; 3],
    /// Beam travel direction (normalized internally; zero vector produces an empty result).
    pub dir: [f32; 3],
    /// Thermal power in energy units per second (`E += power * dt`).
    pub power: f32,
    /// Maximum total travel distance across all bounces, in finest cells.
    pub max_range: f32,
    /// Maximum number of mirror/grazing bounces (clamped to [`MAX_BOUNCES`]).
    pub max_bounces: u8,
    /// Packed `0xRRGGBB` beam tint for rendering and glow records.
    pub color: u32,
}

/// One straight segment of a traced beam, ready for direct WebGPU instanced rendering.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BeamSegment {
    pub start: [f32; 3],
    pub end: [f32; 3],
    pub power: f32,
    pub bounce: u8,
}

/// Thermal glow and smoke/spark record for `lights.ts` and `puffs.ts`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HeatGlow {
    /// World-space position in finest cells.
    pub pos: [f32; 3],
    /// Normalized incandescent intensity in `0.0..=1.0`.
    pub heat: f32,
    /// Suggested point-light radius in cells.
    pub radius: f32,
    /// Packed `0xRRGGBB` blackbody glow colour.
    pub color: u32,
    /// True when the heated spot should vent smoke/sparks (`puffs.ts`).
    pub smoke: bool,
}

/// Geometric proxy for a dynamic body, ragdoll limb, or oriented mirror panel.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TargetShape {
    /// Axis-aligned bounding box in finest cells.
    Aabb { min: [f32; 3], max: [f32; 3] },
    /// Oriented bounding box with unit quaternion `[qx, qy, qz, qw]`.
    Obb {
        center: [f32; 3],
        half_extents: [f32; 3],
        rotation: [f32; 4],
    },
    /// Bounding sphere in finest cells.
    Sphere { center: [f32; 3], radius: f32 },
    /// Capsule from `a` to `b` with `radius` (ragdoll limbs and torsos).
    Capsule {
        a: [f32; 3],
        b: [f32; 3],
        radius: f32,
    },
}

/// Dynamic body or ragdoll proxy that beams can intersect, burn, sever, or reflect off.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BeamTarget {
    pub body_id: u32,
    pub shape: TargetShape,
    /// Optional voxel kind (`kinds::STEEL | kinds::POLISHED` for a moving mirror; `0` for generic body).
    pub kind: Kind,
    /// Thermal cut resistance multiplier (`1.0` default; higher resists severing).
    pub resistance: f32,
}

impl BeamTarget {
    pub const fn aabb(body_id: u32, min: [f32; 3], max: [f32; 3]) -> Self {
        Self {
            body_id,
            shape: TargetShape::Aabb { min, max },
            kind: 0,
            resistance: 1.0,
        }
    }

    pub const fn obb(
        body_id: u32,
        center: [f32; 3],
        half_extents: [f32; 3],
        rotation: [f32; 4],
        kind: Kind,
    ) -> Self {
        Self {
            body_id,
            shape: TargetShape::Obb {
                center,
                half_extents,
                rotation,
            },
            kind,
            resistance: 1.0,
        }
    }

    pub const fn sphere(body_id: u32, center: [f32; 3], radius: f32) -> Self {
        Self {
            body_id,
            shape: TargetShape::Sphere { center, radius },
            kind: 0,
            resistance: 1.0,
        }
    }

    pub const fn capsule(body_id: u32, a: [f32; 3], b: [f32; 3], radius: f32) -> Self {
        Self {
            body_id,
            shape: TargetShape::Capsule { a, b, radius },
            kind: 0,
            resistance: 1.0,
        }
    }
}

/// Gameplay and visual events emitted during a beam step.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BeamEvent {
    /// A voxel absorbed enough energy to melt/vaporize and should be carved out of the world.
    MeltedVoxel { cell: [i32; 3], kind: Kind },
    /// A flammable voxel reached ignition temperature and should be handed to `fire.rs`.
    IgniteVoxel { cell: [i32; 3] },
    /// Continuous thermal burn/cut applied to a dynamic body or ragdoll proxy.
    DynamicBurn {
        body_id: u32,
        pos: [f32; 3],
        normal: [f32; 3],
        energy_delta: f32,
        sever_power: f32,
    },
    /// Specular or grazing-angle reflection off a polished metal or glass surface.
    MirrorBounce {
        pos: [f32; 3],
        normal: [f32; 3],
        remaining_power: f32,
    },
}

/// Output of a single [`BeamSystem::fire_step`] call.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BeamResult {
    pub segments: Vec<BeamSegment>,
    pub events: Vec<BeamEvent>,
    pub glows: Vec<HeatGlow>,
}

/// Accumulated thermal state for one voxel cell.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ThermalCell {
    /// Accumulated thermal energy (`power * dt`).
    pub energy: f32,
    /// Normalized incandescent glow in `0.0..=1.0`.
    pub heat: f32,
    /// Material melt threshold cached at deposition time.
    pub melt_threshold: f32,
    /// True once `IgniteVoxel` has been emitted for this heating cycle.
    pub ignited: bool,
}

/// Sparse map of heated voxels that cools passively over time and evicts cold cells.
#[derive(Debug, Clone)]
pub struct ThermalMap {
    cells: HashMap<[i32; 3], ThermalCell>,
    cooling_rate: f32,
    ambient_cool: f32,
}

impl Default for ThermalMap {
    fn default() -> Self {
        Self::new()
    }
}

impl ThermalMap {
    pub fn new() -> Self {
        Self {
            cells: HashMap::new(),
            cooling_rate: DEFAULT_COOLING_RATE,
            ambient_cool: DEFAULT_AMBIENT_COOL,
        }
    }

    /// Creates a thermal map with custom passive cooling parameters (both clamped to `>= 0.0`).
    pub fn with_cooling(cooling_rate: f32, ambient_cool: f32) -> Self {
        Self {
            cells: HashMap::new(),
            cooling_rate: cooling_rate.max(0.0),
            ambient_cool: ambient_cool.max(0.0),
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.cells.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }

    pub fn clear(&mut self) {
        self.cells.clear();
    }

    #[inline]
    pub fn get(&self, cell: [i32; 3]) -> Option<&ThermalCell> {
        self.cells.get(&cell)
    }

    #[inline]
    pub fn heat_at(&self, cell: [i32; 3]) -> f32 {
        self.cells.get(&cell).map_or(0.0, |c| c.heat)
    }

    #[inline]
    pub fn energy_at(&self, cell: [i32; 3]) -> f32 {
        self.cells.get(&cell).map_or(0.0, |c| c.energy)
    }

    /// Removes a cell directly (for example after an external blast destroys it).
    #[inline]
    pub fn remove(&mut self, cell: [i32; 3]) -> Option<ThermalCell> {
        self.cells.remove(&cell)
    }

    /// Passively cools every tracked cell over `dt` seconds and evicts cells once `heat < 0.01`.
    pub fn cool(&mut self, dt: f32) {
        if dt <= 0.0 || !dt.is_finite() {
            return;
        }
        // Rational decay `1 / (1 + r * dt)` is unconditionally stable, deterministic across
        // platforms, and avoids software `exp` in wasm32.
        let decay = 1.0 / (1.0 + self.cooling_rate * dt);
        let ambient = self.ambient_cool * dt;
        self.cells.retain(|_, cell| {
            let floor = ambient * cell.melt_threshold;
            cell.energy = (cell.energy * decay - floor).max(0.0);
            cell.heat = if cell.melt_threshold > 0.0 {
                (cell.energy / cell.melt_threshold).clamp(0.0, 1.0)
            } else {
                0.0
            };
            cell.heat >= EVICT_HEAT_THRESHOLD
        });
    }

    /// Iterates over all currently hot cells for molten-edge and glow rendering.
    pub fn hot_cells(&self) -> impl Iterator<Item = ([i32; 3], ThermalCell)> + '_ {
        self.cells.iter().map(|(&coord, &cell)| (coord, cell))
    }

    /// Collects `HeatGlow` records for every cell in the map above `min_heat`.
    pub fn collect_glows(&self, min_heat: f32, out: &mut Vec<HeatGlow>) {
        for (&coord, &cell) in &self.cells {
            if cell.heat >= min_heat {
                out.push(HeatGlow {
                    pos: [
                        coord[0] as f32 + 0.5,
                        coord[1] as f32 + 0.5,
                        coord[2] as f32 + 0.5,
                    ],
                    heat: cell.heat,
                    radius: 2.0 + 5.0 * cell.heat,
                    color: heat_color(cell.heat),
                    smoke: cell.heat >= 0.35,
                });
            }
        }
    }

    /// Deposits `energy_delta` into `cell` of `kind`. Returns `(heat_after, melted, newly_ignited)`.
    fn deposit(&mut self, cell: [i32; 3], kind: Kind, energy_delta: f32) -> (f32, bool, bool) {
        let mat = material(kind);
        let threshold = melt_threshold(mat);
        let ignite_at = ignite_threshold(mat);

        let entry = self.cells.entry(cell).or_insert(ThermalCell {
            energy: 0.0,
            heat: 0.0,
            melt_threshold: threshold,
            ignited: false,
        });
        entry.melt_threshold = threshold;
        if energy_delta > 0.0 {
            entry.energy += energy_delta;
        }
        entry.heat = if threshold > 0.0 {
            (entry.energy / threshold).clamp(0.0, 1.0)
        } else {
            1.0
        };

        let newly_ignited = if let Some(ign) = ignite_at {
            if !entry.ignited && entry.energy >= ign {
                entry.ignited = true;
                true
            } else {
                false
            }
        } else {
            false
        };

        let heat = entry.heat;
        let melted = entry.energy >= threshold;
        if melted {
            self.cells.remove(&cell);
        }
        (heat, melted, newly_ignited)
    }

    /// Marks an adjacent flammable voxel ignited if not already ignited, returning true if newly lit.
    fn try_ignite_adjacent(&mut self, cell: [i32; 3], kind: Kind) -> bool {
        let mat = material(kind);
        let Some(ign) = ignite_threshold(mat) else {
            return false;
        };
        let threshold = melt_threshold(mat);
        let entry = self.cells.entry(cell).or_insert(ThermalCell {
            energy: ign,
            heat: (ign / threshold).clamp(0.0, 1.0),
            melt_threshold: threshold,
            ignited: false,
        });
        if entry.ignited {
            return false;
        }
        entry.ignited = true;
        if entry.energy < ign {
            entry.energy = ign;
            entry.heat = (entry.energy / threshold).clamp(0.0, 1.0);
        }
        true
    }
}

/// Calibrated energy required to melt or shatter one voxel of `material` (`kinds.rs`).
///
/// Glass shatters quickly, wood and roofing are low-moderate (and ignite before melting),
/// plaster/brick sit in the middle, concrete and rock are tough, and steel has the highest
/// threshold. `POLISHED` steel reflects ~85% of incident power so it absorbs only 15%.
pub const fn melt_threshold(mat: u8) -> f32 {
    match mat {
        LEAVES => 10.0,
        GRASS => 12.0,
        GLASS => 16.0,
        LAMP => 20.0,
        WATER => 25.0,
        WOOD => 32.0,
        ROOFING => 36.0,
        PLASTER => 40.0,
        EARTH | SAND => 45.0,
        ASPHALT => 55.0,
        BRICK => 60.0,
        CONCRETE => 95.0,
        ROCK => 120.0,
        STEEL => 180.0,
        _ => 50.0,
    }
}

/// Energy at which a flammable material (`kinds::burns`) catches fire, always below [`melt_threshold`].
pub const fn ignite_threshold(mat: u8) -> Option<f32> {
    if burns(mat).0 == 0 {
        return None;
    }
    let frac = match mat {
        LEAVES => 0.25,
        GRASS => 0.30,
        WOOD => 0.30,
        ROOFING => 0.38,
        _ => 0.35,
    };
    Some(melt_threshold(mat) * frac)
}

/// Optical reflection/transmission fractions for a surface hit.
#[derive(Debug, Clone, Copy, PartialEq)]
struct SurfaceResponse {
    /// Fraction of incident power reflected specularly (`0.0..=0.85`).
    reflectivity: f32,
    /// Fraction of incident power transmitted through the cell (grazing Fresnel split on `GLASS`).
    transmittance: f32,
    /// Fraction of incident power absorbed as heat (`reflectivity + transmittance + absorption == 1.0`).
    absorption: f32,
}

/// Computes reflection, transmission, and absorption fractions from `kind` and `cos_theta = -dot(dir, normal)`.
fn surface_response(kind: Kind, cos_theta: f32) -> SurfaceResponse {
    if kind == 0 {
        return SurfaceResponse {
            reflectivity: 0.0,
            transmittance: 0.0,
            absorption: 1.0,
        };
    }
    let mat = material(kind);
    let polished = (kind & POLISHED) != 0;

    // Polished steel (or silvered polished glass) acts as a high-efficiency mirror (~85% reflected).
    if polished && (mat == STEEL || mat == GLASS) {
        return SurfaceResponse {
            reflectivity: POLISHED_REFLECTIVITY,
            transmittance: 0.0,
            absorption: 1.0 - POLISHED_REFLECTIVITY,
        };
    }

    // Unpolished glass reflects at shallow/grazing angles via a Schlick-like Fresnel ramp
    // and splits the remainder between transmitted light and thermal absorption.
    if mat == GLASS && cos_theta < GLASS_GRAZING_COS {
        let om = (1.0 - cos_theta.clamp(0.0, 1.0)).clamp(0.0, 1.0);
        let om3 = om * om * om;
        let reflectivity = (0.04 + 0.86 * om3).clamp(0.15, 0.85);
        let rem = 1.0 - reflectivity;
        let absorption = rem * 0.5;
        let transmittance = rem - absorption;
        return SurfaceResponse {
            reflectivity,
            transmittance,
            absorption,
        };
    }

    SurfaceResponse {
        reflectivity: 0.0,
        transmittance: 0.0,
        absorption: 1.0,
    }
}

/// Blackbody-style RGB colour (`0xRRGGBB`) for normalized heat `0.0..=1.0`.
/// Uses piecewise linear ramps (no `powf`) for deterministic wasm32 performance.
pub fn heat_color(heat: f32) -> u32 {
    let h = heat.clamp(0.0, 1.0);
    let (r, g, b) = if h < 0.35 {
        let t = h / 0.35;
        (0.25 + 0.75 * t, 0.06 * t, 0.01 * t)
    } else if h < 0.75 {
        let t = (h - 0.35) / 0.40;
        (1.0, 0.06 + 0.64 * t, 0.01 + 0.14 * t)
    } else {
        let t = (h - 0.75) / 0.25;
        (1.0, 0.70 + 0.30 * t, 0.15 + 0.85 * t)
    };
    let ri = (r.clamp(0.0, 1.0) * 255.0 + 0.5) as u32;
    let gi = (g.clamp(0.0, 1.0) * 255.0 + 0.5) as u32;
    let bi = (b.clamp(0.0, 1.0) * 255.0 + 0.5) as u32;
    (ri << 16) | (gi << 8) | bi
}

/// Helper to construct a unit quaternion `[qx, qy, qz, qw]` from an axis and angle in radians.
pub fn quat_axis_angle(axis: [f32; 3], radians: f32) -> [f32; 4] {
    let n = normalize3(axis).unwrap_or([0.0, 1.0, 0.0]);
    let half = radians * 0.5;
    let s = half.sin();
    let c = half.cos();
    [n[0] * s, n[1] * s, n[2] * s, c]
}

/// Stateful thermal beam simulator holding the sparse voxel [`ThermalMap`].
#[derive(Debug, Clone, Default)]
pub struct BeamSystem {
    pub thermal: ThermalMap,
}

#[derive(Clone, Copy)]
struct RayJob {
    /// Visual start point of the emitted `BeamSegment`.
    vis_start: [f32; 3],
    /// Trace origin (may be slightly offset from `vis_start` to avoid self-intersection).
    origin: [f32; 3],
    dir: [f32; 3],
    power: f32,
    remaining_range: f32,
    bounce: u8,
    skip_cell: Option<[i32; 3]>,
    skip_body: Option<u32>,
}

impl BeamSystem {
    pub fn new() -> Self {
        Self {
            thermal: ThermalMap::new(),
        }
    }

    pub fn with_thermal(thermal: ThermalMap) -> Self {
        Self { thermal }
    }

    /// Passively cools all cells in the thermal map and evicts cold entries.
    #[inline]
    pub fn cool(&mut self, dt: f32) {
        self.thermal.cool(dt);
    }

    /// Traces one continuous thermal beam for `dt` seconds across the voxel world and
    /// `dynamic_targets`, accumulating heat, carving melted cells, igniting flammables, and
    /// returning all beam segments, events, and glow records.
    pub fn fire_step(
        &mut self,
        spec: &BeamSpec,
        dt: f32,
        kind_at: impl FnMut([i32; 3]) -> Kind,
        dynamic_targets: &[BeamTarget],
    ) -> BeamResult {
        let cap = (spec.max_bounces.min(MAX_BOUNCES) as usize) + 1;
        let mut out = BeamResult {
            segments: Vec::with_capacity(cap),
            events: Vec::with_capacity(cap * 2),
            glows: Vec::with_capacity(cap),
        };
        self.fire_step_into(spec, dt, kind_at, dynamic_targets, &mut out);
        out
    }

    /// Zero-allocation variant of [`Self::fire_step`] that appends into caller-owned buffers.
    pub fn fire_step_into(
        &mut self,
        spec: &BeamSpec,
        dt: f32,
        mut kind_at: impl FnMut([i32; 3]) -> Kind,
        dynamic_targets: &[BeamTarget],
        out: &mut BeamResult,
    ) {
        if !spec.power.is_finite()
            || spec.power <= MIN_BEAM_POWER
            || !spec.max_range.is_finite()
            || spec.max_range <= 0.0
            || !is_finite3(spec.origin)
            || !is_finite3(spec.dir)
        {
            return;
        }
        let Some(init_dir) = normalize3(spec.dir) else {
            return;
        };
        let dt = if dt.is_finite() && dt > 0.0 { dt } else { 0.0 };
        let max_bounces = spec.max_bounces.min(MAX_BOUNCES);

        // Fixed stack on the stack: zero heap allocation during multi-bounce / Fresnel split.
        let mut stack = [RayJob {
            vis_start: [0.0; 3],
            origin: [0.0; 3],
            dir: [0.0; 3],
            power: 0.0,
            remaining_range: 0.0,
            bounce: 0,
            skip_cell: None,
            skip_body: None,
        }; MAX_SEGMENTS];
        let mut sp = 1usize;
        stack[0] = RayJob {
            vis_start: spec.origin,
            origin: spec.origin,
            dir: init_dir,
            power: spec.power,
            remaining_range: spec.max_range,
            bounce: 0,
            skip_cell: None,
            skip_body: None,
        };

        let mut emitted_segments = 0usize;
        while sp > 0 && emitted_segments < MAX_SEGMENTS {
            sp -= 1;
            let job = stack[sp];
            if job.power <= MIN_BEAM_POWER || job.remaining_range <= 1e-4 {
                continue;
            }

            // 1. Test dynamic targets first so voxel DDA can early-out at the dynamic hit distance.
            let dyn_hit = intersect_dynamic_targets(
                job.origin,
                job.dir,
                job.remaining_range,
                job.skip_body,
                dynamic_targets,
            );
            let voxel_limit = dyn_hit.map_or(job.remaining_range, |h| h.t);

            // 2. 3D DDA voxel traversal up to `voxel_limit`.
            let vox_hit = trace_voxels(
                job.origin,
                job.dir,
                voxel_limit,
                job.skip_cell,
                &mut kind_at,
            );

            // 3. Resolve whichever hit is closer (or miss at full range).
            if let Some(vh) = vox_hit {
                out.segments.push(BeamSegment {
                    start: job.vis_start,
                    end: vh.pos,
                    power: job.power,
                    bounce: job.bounce,
                });
                emitted_segments += 1;

                let cos_theta = (-dot3(job.dir, vh.normal)).clamp(0.0, 1.0);
                let resp = surface_response(vh.kind, cos_theta);

                let absorbed_power = job.power * resp.absorption;
                if absorbed_power > 0.0 && dt > 0.0 {
                    let energy_delta = absorbed_power * dt;
                    let (heat, melted, newly_ignited) =
                        self.thermal.deposit(vh.cell, vh.kind, energy_delta);
                    if newly_ignited {
                        out.events.push(BeamEvent::IgniteVoxel { cell: vh.cell });
                    }
                    if melted {
                        out.events.push(BeamEvent::MeltedVoxel {
                            cell: vh.cell,
                            kind: vh.kind,
                        });
                    }
                    if melted || heat >= ADJACENT_IGNITE_HEAT {
                        ignite_adjacent_flammables(&mut self.thermal, vh.cell, &mut kind_at, out);
                    }
                    let glow_heat = if melted { 1.0 } else { heat };
                    if glow_heat >= EVICT_HEAT_THRESHOLD {
                        out.glows.push(HeatGlow {
                            pos: vh.pos,
                            heat: glow_heat,
                            radius: 2.0 + 6.0 * glow_heat,
                            color: heat_color(glow_heat),
                            smoke: melted || glow_heat >= 0.35,
                        });
                    }
                } else if resp.reflectivity > 0.0 {
                    // Subtle glint glow at mirror bounce point even when dt == 0.
                    out.glows.push(HeatGlow {
                        pos: vh.pos,
                        heat: 0.25,
                        radius: 2.5,
                        color: spec.color,
                        smoke: false,
                    });
                }

                let rem_range = (job.remaining_range - vh.t).max(0.0);

                // Push transmitted ray first (so reflected ray runs next on LIFO stack, keeping
                // primary mirror path ordered first).
                if resp.transmittance > 0.0 && job.bounce < max_bounces && rem_range > 1e-3 {
                    let trans_power = job.power * resp.transmittance;
                    if trans_power > MIN_BEAM_POWER && sp < MAX_SEGMENTS {
                        let start_inside = add_scaled3(vh.pos, job.dir, SURFACE_EPS);
                        stack[sp] = RayJob {
                            vis_start: vh.pos,
                            origin: start_inside,
                            dir: job.dir,
                            power: trans_power,
                            remaining_range: rem_range,
                            bounce: job.bounce + 1,
                            skip_cell: Some(vh.cell),
                            skip_body: None,
                        };
                        sp += 1;
                    }
                }

                if resp.reflectivity > 0.0 && job.bounce < max_bounces && rem_range > 1e-3 {
                    let refl_power = job.power * resp.reflectivity;
                    if refl_power > MIN_BEAM_POWER {
                        out.events.push(BeamEvent::MirrorBounce {
                            pos: vh.pos,
                            normal: vh.normal,
                            remaining_power: refl_power,
                        });
                        if let Some(refl_dir) = reflect3(job.dir, vh.normal) {
                            if sp < MAX_SEGMENTS {
                                let bounce_origin = add_scaled3(vh.pos, vh.normal, SURFACE_EPS);
                                stack[sp] = RayJob {
                                    vis_start: vh.pos,
                                    origin: bounce_origin,
                                    dir: refl_dir,
                                    power: refl_power,
                                    remaining_range: rem_range,
                                    bounce: job.bounce + 1,
                                    skip_cell: Some(vh.cell),
                                    skip_body: None,
                                };
                                sp += 1;
                            }
                        }
                    }
                }
            } else if let Some(dh) = dyn_hit {
                out.segments.push(BeamSegment {
                    start: job.vis_start,
                    end: dh.pos,
                    power: job.power,
                    bounce: job.bounce,
                });
                emitted_segments += 1;

                let cos_theta = (-dot3(job.dir, dh.normal)).clamp(0.0, 1.0);
                let resp = surface_response(dh.kind, cos_theta);

                let absorbed_power = job.power * resp.absorption;
                if absorbed_power > 0.0 {
                    let energy_delta = absorbed_power * dt;
                    let sever_power = absorbed_power / dh.resistance.max(0.1);
                    out.events.push(BeamEvent::DynamicBurn {
                        body_id: dh.body_id,
                        pos: dh.pos,
                        normal: dh.normal,
                        energy_delta,
                        sever_power,
                    });
                    let glow_heat = (absorbed_power / 100.0).clamp(0.2, 1.0);
                    out.glows.push(HeatGlow {
                        pos: dh.pos,
                        heat: glow_heat,
                        radius: 2.5 + 5.0 * glow_heat,
                        color: heat_color(glow_heat),
                        smoke: absorbed_power >= 15.0,
                    });
                }

                let rem_range = (job.remaining_range - dh.t).max(0.0);
                if resp.reflectivity > 0.0 && job.bounce < max_bounces && rem_range > 1e-3 {
                    let refl_power = job.power * resp.reflectivity;
                    if refl_power > MIN_BEAM_POWER {
                        out.events.push(BeamEvent::MirrorBounce {
                            pos: dh.pos,
                            normal: dh.normal,
                            remaining_power: refl_power,
                        });
                        if let Some(refl_dir) = reflect3(job.dir, dh.normal) {
                            if sp < MAX_SEGMENTS {
                                let bounce_origin = add_scaled3(dh.pos, dh.normal, SURFACE_EPS);
                                stack[sp] = RayJob {
                                    vis_start: dh.pos,
                                    origin: bounce_origin,
                                    dir: refl_dir,
                                    power: refl_power,
                                    remaining_range: rem_range,
                                    bounce: job.bounce + 1,
                                    skip_cell: None,
                                    skip_body: Some(dh.body_id),
                                };
                                sp += 1;
                            }
                        }
                    }
                }
            } else {
                // Unobstructed beam reaches maximum remaining range.
                let end = add_scaled3(job.origin, job.dir, job.remaining_range);
                out.segments.push(BeamSegment {
                    start: job.vis_start,
                    end,
                    power: job.power,
                    bounce: job.bounce,
                });
                emitted_segments += 1;
            }
        }
    }
}

fn ignite_adjacent_flammables(
    thermal: &mut ThermalMap,
    cell: [i32; 3],
    kind_at: &mut impl FnMut([i32; 3]) -> Kind,
    out: &mut BeamResult,
) {
    const DIRS: [[i32; 3]; 6] = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
    ];
    for d in DIRS {
        let n = [cell[0] + d[0], cell[1] + d[1], cell[2] + d[2]];
        let nk = kind_at(n);
        if nk != 0 && burns(material(nk)).0 > 0 && thermal.try_ignite_adjacent(n, nk) {
            out.events.push(BeamEvent::IgniteVoxel { cell: n });
        }
    }
}

// ── 3D DDA Voxel Raycast ────────────────────────────────────────────────────

#[derive(Clone, Copy)]
struct VoxelHit {
    t: f32,
    pos: [f32; 3],
    cell: [i32; 3],
    normal: [f32; 3],
    kind: Kind,
}

fn trace_voxels(
    origin: [f32; 3],
    dir: [f32; 3],
    max_dist: f32,
    skip_cell: Option<[i32; 3]>,
    kind_at: &mut impl FnMut([i32; 3]) -> Kind,
) -> Option<VoxelHit> {
    if max_dist <= 0.0 {
        return None;
    }

    let mut cx = origin[0].floor() as i32;
    let mut cy = origin[1].floor() as i32;
    let mut cz = origin[2].floor() as i32;

    // Check if the ray originates inside a solid cell (unless explicitly skipped).
    let start_cell = [cx, cy, cz];
    if Some(start_cell) != skip_cell {
        let k = kind_at(start_cell);
        if k != 0 {
            return Some(VoxelHit {
                t: 0.0,
                pos: origin,
                cell: start_cell,
                normal: dominant_neg_axis(dir),
                kind: k,
            });
        }
    }

    let (step_x, mut t_max_x, t_delta_x) = dda_axis(origin[0], dir[0], cx);
    let (step_y, mut t_max_y, t_delta_y) = dda_axis(origin[1], dir[1], cy);
    let (step_z, mut t_max_z, t_delta_z) = dda_axis(origin[2], dir[2], cz);

    // Safety cap against degenerate coordinates; normally exits via `t > max_dist`.
    let max_steps = ((max_dist.ceil() as usize).saturating_mul(3)).saturating_add(8);

    for _ in 0..max_steps {
        let (t, normal) = if t_max_x <= t_max_y && t_max_x <= t_max_z {
            let t = t_max_x;
            if t > max_dist {
                break;
            }
            cx += step_x;
            t_max_x += t_delta_x;
            (t, [-step_x as f32, 0.0, 0.0])
        } else if t_max_y <= t_max_z {
            let t = t_max_y;
            if t > max_dist {
                break;
            }
            cy += step_y;
            t_max_y += t_delta_y;
            (t, [0.0, -step_y as f32, 0.0])
        } else {
            let t = t_max_z;
            if t > max_dist {
                break;
            }
            cz += step_z;
            t_max_z += t_delta_z;
            (t, [0.0, 0.0, -step_z as f32])
        };

        let cell = [cx, cy, cz];
        if Some(cell) == skip_cell {
            continue;
        }
        let kind = kind_at(cell);
        if kind != 0 {
            let t_clamped = t.max(0.0);
            return Some(VoxelHit {
                t: t_clamped,
                pos: add_scaled3(origin, dir, t_clamped),
                cell,
                normal,
                kind,
            });
        }
    }

    None
}

#[inline]
fn dda_axis(origin: f32, dir: f32, cell: i32) -> (i32, f32, f32) {
    if dir > 1e-12 {
        let inv = 1.0 / dir;
        let next = (cell as f32) + 1.0;
        (1, (next - origin) * inv, inv)
    } else if dir < -1e-12 {
        let inv = 1.0 / dir;
        let next = cell as f32;
        (-1, (next - origin) * inv, -inv)
    } else {
        (0, f32::INFINITY, f32::INFINITY)
    }
}

#[inline]
fn dominant_neg_axis(dir: [f32; 3]) -> [f32; 3] {
    let ax = dir[0].abs();
    let ay = dir[1].abs();
    let az = dir[2].abs();
    if ax >= ay && ax >= az {
        [if dir[0] >= 0.0 { -1.0 } else { 1.0 }, 0.0, 0.0]
    } else if ay >= az {
        [0.0, if dir[1] >= 0.0 { -1.0 } else { 1.0 }, 0.0]
    } else {
        [0.0, 0.0, if dir[2] >= 0.0 { -1.0 } else { 1.0 }]
    }
}

// ── Dynamic Target Intersections ────────────────────────────────────────────

#[derive(Clone, Copy)]
struct DynamicHit {
    t: f32,
    pos: [f32; 3],
    normal: [f32; 3],
    body_id: u32,
    kind: Kind,
    resistance: f32,
}

fn intersect_dynamic_targets(
    origin: [f32; 3],
    dir: [f32; 3],
    max_dist: f32,
    skip_body: Option<u32>,
    targets: &[BeamTarget],
) -> Option<DynamicHit> {
    let mut best: Option<DynamicHit> = None;
    let mut best_t = max_dist;

    for target in targets {
        let t_min = if Some(target.body_id) == skip_body {
            1e-3
        } else {
            0.0
        };
        let hit = match target.shape {
            TargetShape::Aabb { min, max } => ray_aabb(origin, dir, min, max, t_min, best_t),
            TargetShape::Obb {
                center,
                half_extents,
                rotation,
            } => ray_obb(origin, dir, center, half_extents, rotation, t_min, best_t),
            TargetShape::Sphere { center, radius } => {
                ray_sphere(origin, dir, center, radius, t_min, best_t)
            }
            TargetShape::Capsule { a, b, radius } => {
                ray_capsule(origin, dir, a, b, radius, t_min, best_t)
            }
        };
        if let Some((t, normal)) = hit {
            if t < best_t {
                best_t = t;
                best = Some(DynamicHit {
                    t,
                    pos: add_scaled3(origin, dir, t),
                    normal,
                    body_id: target.body_id,
                    kind: target.kind,
                    resistance: target.resistance,
                });
            }
        }
    }
    best
}

fn ray_aabb(
    origin: [f32; 3],
    dir: [f32; 3],
    min: [f32; 3],
    max: [f32; 3],
    t_min: f32,
    t_max: f32,
) -> Option<(f32, [f32; 3])> {
    let mut t_enter = f32::NEG_INFINITY;
    let mut t_exit = t_max;
    let mut normal = [0.0f32; 3];

    for i in 0..3 {
        if dir[i].abs() < 1e-12 {
            if origin[i] < min[i] || origin[i] > max[i] {
                return None;
            }
        } else {
            let inv = 1.0 / dir[i];
            let mut t0 = (min[i] - origin[i]) * inv;
            let mut t1 = (max[i] - origin[i]) * inv;
            let mut n_sign = -1.0f32;
            if t0 > t1 {
                core::mem::swap(&mut t0, &mut t1);
                n_sign = 1.0;
            }
            if t0 > t_enter {
                t_enter = t0;
                normal = [0.0; 3];
                normal[i] = n_sign;
            }
            if t1 < t_exit {
                t_exit = t1;
            }
            if t_enter > t_exit {
                return None;
            }
        }
    }

    if t_exit < t_min || t_enter > t_max {
        return None;
    }
    if t_enter >= t_min {
        Some((t_enter, normal))
    } else {
        // Ray started inside the box.
        Some((t_min, [-dir[0], -dir[1], -dir[2]]))
    }
}

fn ray_obb(
    origin: [f32; 3],
    dir: [f32; 3],
    center: [f32; 3],
    half_extents: [f32; 3],
    rotation: [f32; 4],
    t_min: f32,
    t_max: f32,
) -> Option<(f32, [f32; 3])> {
    let q = normalize_quat(rotation);
    let q_inv = [-q[0], -q[1], -q[2], q[3]];
    let rel = sub3(origin, center);
    let local_origin = rotate_quat(q_inv, rel);
    let local_dir = rotate_quat(q_inv, dir);
    let neg_ext = [-half_extents[0], -half_extents[1], -half_extents[2]];
    let (t, local_n) = ray_aabb(local_origin, local_dir, neg_ext, half_extents, t_min, t_max)?;
    let world_n = normalize3(rotate_quat(q, local_n)).unwrap_or([-dir[0], -dir[1], -dir[2]]);
    Some((t, world_n))
}

fn ray_sphere(
    origin: [f32; 3],
    dir: [f32; 3],
    center: [f32; 3],
    radius: f32,
    t_min: f32,
    t_max: f32,
) -> Option<(f32, [f32; 3])> {
    if radius <= 0.0 {
        return None;
    }
    let oc = sub3(origin, center);
    let b = dot3(oc, dir);
    let c = dot3(oc, oc) - radius * radius;
    let disc = b * b - c;
    if disc < 0.0 {
        return None;
    }
    let s = disc.sqrt();
    let t0 = -b - s;
    let t1 = -b + s;
    if t1 < t_min || t0 > t_max {
        return None;
    }
    let t = if t0 >= t_min { t0 } else { t_min };
    let hit_pos = add_scaled3(origin, dir, t);
    let n = normalize3(sub3(hit_pos, center)).unwrap_or([-dir[0], -dir[1], -dir[2]]);
    Some((t, n))
}

fn ray_capsule(
    origin: [f32; 3],
    dir: [f32; 3],
    a: [f32; 3],
    b: [f32; 3],
    radius: f32,
    t_min: f32,
    t_max: f32,
) -> Option<(f32, [f32; 3])> {
    if radius <= 0.0 {
        return None;
    }
    let ba = sub3(b, a);
    let baba = dot3(ba, ba);
    if baba < 1e-10 {
        return ray_sphere(origin, dir, a, radius, t_min, t_max);
    }

    let mut best: Option<(f32, [f32; 3])> = None;
    let mut cur_max = t_max;

    // 1. Finite cylinder body.
    let oa = sub3(origin, a);
    let bard = dot3(ba, dir);
    let baoa = dot3(ba, oa);
    let rdoa = dot3(dir, oa);
    let oaoa = dot3(oa, oa);
    let a_q = baba - bard * bard;
    let b_q = baba * rdoa - baoa * bard;
    let c_q = baba * oaoa - baoa * baoa - radius * radius * baba;
    let h = b_q * b_q - a_q * c_q;
    if a_q > 1e-10 && h >= 0.0 {
        let s = h.sqrt();
        let t0 = (-b_q - s) / a_q;
        let t1 = (-b_q + s) / a_q;
        if t1 >= t_min && t0 <= cur_max {
            let t = if t0 >= t_min { t0 } else { t_min };
            let y = baoa + t * bard;
            if y >= 0.0 && y <= baba {
                let hit_pos = add_scaled3(origin, dir, t);
                let axis_pt = add_scaled3(a, ba, y / baba);
                let n = normalize3(sub3(hit_pos, axis_pt)).unwrap_or([-dir[0], -dir[1], -dir[2]]);
                cur_max = t;
                best = Some((t, n));
            }
        }
    }

    // 2. Hemispherical endcaps at `a` and `b`.
    if let Some(hit_a) = ray_sphere(origin, dir, a, radius, t_min, cur_max) {
        cur_max = hit_a.0;
        best = Some(hit_a);
    }
    if let Some(hit_b) = ray_sphere(origin, dir, b, radius, t_min, cur_max) {
        best = Some(hit_b);
    }

    best
}

// ── Small Vector & Quaternion Helpers ───────────────────────────────────────

#[inline]
fn is_finite3(v: [f32; 3]) -> bool {
    v[0].is_finite() && v[1].is_finite() && v[2].is_finite()
}

#[inline]
fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline]
fn sub3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

#[inline]
fn add_scaled3(a: [f32; 3], b: [f32; 3], s: f32) -> [f32; 3] {
    [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
}

#[inline]
fn normalize3(v: [f32; 3]) -> Option<[f32; 3]> {
    let len2 = dot3(v, v);
    if len2 <= 1e-16 || !len2.is_finite() {
        return None;
    }
    let inv = 1.0 / len2.sqrt();
    Some([v[0] * inv, v[1] * inv, v[2] * inv])
}

#[inline]
fn reflect3(dir: [f32; 3], normal: [f32; 3]) -> Option<[f32; 3]> {
    let k = 2.0 * dot3(dir, normal);
    normalize3([
        dir[0] - k * normal[0],
        dir[1] - k * normal[1],
        dir[2] - k * normal[2],
    ])
}

#[inline]
fn normalize_quat(q: [f32; 4]) -> [f32; 4] {
    let len2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
    if len2 <= 1e-16 || !len2.is_finite() {
        return [0.0, 0.0, 0.0, 1.0];
    }
    let inv = 1.0 / len2.sqrt();
    [q[0] * inv, q[1] * inv, q[2] * inv, q[3] * inv]
}

#[inline]
fn rotate_quat(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let tx = 2.0 * (q[1] * v[2] - q[2] * v[1]);
    let ty = 2.0 * (q[2] * v[0] - q[0] * v[2]);
    let tz = 2.0 * (q[0] * v[1] - q[1] * v[0]);
    [
        v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
        v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
        v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
    ]
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kinds::{OWN, kind};
    use std::time::Instant;

    #[test]
    fn material_thresholds_match_kinds_calibration() {
        // Glass melts/shatters fastest among structural materials; steel is toughest.
        assert!(melt_threshold(GLASS) < melt_threshold(WOOD));
        assert!(melt_threshold(WOOD) < melt_threshold(PLASTER));
        assert!(melt_threshold(PLASTER) < melt_threshold(BRICK));
        assert!(melt_threshold(BRICK) < melt_threshold(CONCRETE));
        assert!(melt_threshold(CONCRETE) < melt_threshold(STEEL));

        // Flammable materials ignite strictly before melting.
        for mat in [LEAVES, GRASS, WOOD, ROOFING] {
            let ign = ignite_threshold(mat).expect("flammable material must have ignite threshold");
            assert!(ign > 0.0 && ign < melt_threshold(mat));
        }
        // Non-flammables never ignite.
        for mat in [GLASS, PLASTER, BRICK, CONCRETE, STEEL, ROCK] {
            assert_eq!(ignite_threshold(mat), None);
        }

        // Polished steel reflects ~85% and absorbs only ~15%.
        let polished_steel = kind(STEEL, OWN) | POLISHED;
        let resp = surface_response(polished_steel, 1.0);
        assert!((resp.reflectivity - 0.85).abs() < 1e-5);
        assert!((resp.absorption - 0.15).abs() < 1e-5);

        // Unpolished steel absorbs 100%.
        let raw_steel = kind(STEEL, OWN);
        let resp_raw = surface_response(raw_steel, 1.0);
        assert_eq!(resp_raw.reflectivity, 0.0);
        assert_eq!(resp_raw.absorption, 1.0);
    }

    #[test]
    fn mirror_reflection_puzzle_axis_aligned_periscope_ignites_wood_around_corner() {
        // Two-mirror axis-aligned periscope using POLISHED steel voxel walls:
        // Beam starts at (4.5, 5.5, 0.5) heading diagonally (+1, 0, +1).
        // Mirror 1 at x = 10 reflects it 90 deg to (-1, 0, +1).
        // Mirror 2 at x = 2 (face x = 3.0) reflects it 90 deg back to (+1, 0, +1).
        // A concrete wall blocks direct line of sight, and a wood target stands around the
        // corner at (10, 5, 20).
        let mut world: HashMap<[i32; 3], Kind> = HashMap::new();
        let mirror = kind(STEEL, OWN) | POLISHED;
        let wall = kind(CONCRETE, OWN);
        let wood = kind(WOOD, OWN);

        // Mirror 1 wall along x = 10, z = 4..=8
        for z in 4..=8 {
            world.insert([10, 5, z], mirror);
        }
        // Mirror 2 wall along x = 2, z = 11..=15
        for z in 11..=15 {
            world.insert([2, 5, z], mirror);
        }
        // Blocking concrete baffle between origin and target (direct ray at z=12 passes x≈8;
        // reflected ray from Mirror 1->Mirror 2 passes x=4 at z=12, clearing the baffle).
        for x in 7..=12 {
            world.insert([x, 5, 12], wall);
        }
        // Wood target around the corner:
        // (4.5, 0.5) -> hit mirror 1 at (10.0, 6.0) [dist 5.5*sqrt(2)]
        // -> hit mirror 2 face x=3.0 at (3.0, 13.0) [dist 7.0*sqrt(2)]
        // -> hit wood cell [10, 5, 20] at (10.0, 20.0) [dist 7.0*sqrt(2)]
        let target_cell = [10, 5, 20];
        world.insert(target_cell, wood);

        let mut beams = BeamSystem::new();
        // Verify direct line-of-sight is blocked by the concrete baffle.
        let direct = beams.fire_step(
            &BeamSpec {
                origin: [4.5, 5.5, 0.5],
                dir: [6.0, 0.0, 20.0],
                power: 60.0,
                max_range: 80.0,
                max_bounces: 4,
                color: 0xff2244,
            },
            0.0,
            |c| world.get(&c).copied().unwrap_or(0),
            &[],
        );
        assert_eq!(direct.segments.len(), 1);
        assert!(
            direct.segments[0].end[2] < 13.5,
            "baffle must block direct sightline to wood target"
        );
        let spec = BeamSpec {
            origin: [4.5, 5.5, 0.5],
            dir: [1.0, 0.0, 1.0],
            power: 60.0,
            max_range: 80.0,
            max_bounces: 4,
            color: 0xff2244,
        };

        let mut ignited = false;
        let mut bounces_seen = 0usize;
        for _ in 0..30 {
            let res = beams.fire_step(&spec, 0.05, |c| world.get(&c).copied().unwrap_or(0), &[]);
            assert_eq!(res.segments.len(), 3, "expected 3 segments across 2 mirrors");
            assert!((res.segments[1].power - 60.0 * 0.85).abs() < 1e-3);
            assert!((res.segments[2].power - 60.0 * 0.85 * 0.85).abs() < 1e-3);

            bounces_seen = res
                .events
                .iter()
                .filter(|e| matches!(e, BeamEvent::MirrorBounce { .. }))
                .count();
            assert_eq!(bounces_seen, 2);

            if res
                .events
                .iter()
                .any(|e| matches!(e, BeamEvent::IgniteVoxel { cell } if *cell == target_cell))
            {
                ignited = true;
                break;
            }
        }
        assert!(
            ignited,
            "reflected periscope beam must ignite the wood target around the corner"
        );
        assert_eq!(bounces_seen, 2);
        // Wood ignited before melting!
        assert!(beams.thermal.heat_at(target_cell) < 1.0);
    }

    #[test]
    fn mirror_reflection_puzzle_45_degree_oriented_obb_periscope_ignites_wood() {
        // Two 45-degree oriented POLISHED steel OBB mirrors form a classic 90-deg periscope:
        // Beam fires straight along +X from (0.5, 5.5, 0.5).
        // Mirror 1 at (10.0, 5.5, 0.5) rotated +45 deg around Y reflects +X -> +Z.
        // Mirror 2 at (10.0, 5.5, 10.5) rotated +45 deg around Y reflects +Z -> +X.
        // Wood target at voxel [18, 5, 10] sits behind an opaque concrete wall.
        let mut world: HashMap<[i32; 3], Kind> = HashMap::new();
        let target_cell = [18, 5, 10];
        world.insert(target_cell, kind(WOOD, OWN));
        // Concrete blocker between origin and target
        for z in 3..=7 {
            world.insert([14, 5, z], kind(CONCRETE, OWN));
        }

        let rot_45 = quat_axis_angle([0.0, 1.0, 0.0], core::f32::consts::FRAC_PI_4);
        let mirror_kind = kind(STEEL, OWN) | POLISHED;
        let mirrors = [
            BeamTarget::obb(101, [10.0, 5.5, 0.5], [0.15, 2.0, 2.5], rot_45, mirror_kind),
            BeamTarget::obb(
                102,
                [10.0, 5.5, 10.5],
                [0.15, 2.0, 2.5],
                rot_45,
                mirror_kind,
            ),
        ];

        let mut beams = BeamSystem::new();
        let spec = BeamSpec {
            origin: [0.5, 5.5, 0.5],
            dir: [1.0, 0.0, 0.0],
            power: 80.0,
            max_range: 60.0,
            max_bounces: 4,
            color: 0x00eeff,
        };

        let mut ignited = false;
        for _ in 0..20 {
            let res = beams.fire_step(
                &spec,
                0.05,
                |c| world.get(&c).copied().unwrap_or(0),
                &mirrors,
            );
            assert_eq!(res.segments.len(), 3);
            let bounce_count = res
                .events
                .iter()
                .filter(|e| matches!(e, BeamEvent::MirrorBounce { .. }))
                .count();
            assert_eq!(bounce_count, 2);

            // Second segment travels along +Z, third segment travels along +X.
            let seg1_dir = normalize3(sub3(res.segments[1].end, res.segments[1].start)).unwrap();
            let seg2_dir = normalize3(sub3(res.segments[2].end, res.segments[2].start)).unwrap();
            assert!((seg1_dir[2] - 1.0).abs() < 1e-3, "seg1 dir = {seg1_dir:?}");
            assert!((seg2_dir[0] - 1.0).abs() < 1e-3, "seg2 dir = {seg2_dir:?}");

            if res
                .events
                .iter()
                .any(|e| matches!(e, BeamEvent::IgniteVoxel { cell } if *cell == target_cell))
            {
                ignited = true;
                break;
            }
        }
        assert!(ignited, "45-deg OBB periscope must ignite wood target");
    }

    #[test]
    fn grazing_angle_glass_reflects_and_splits_while_steep_glass_absorbs_and_shatters() {
        let mut world: HashMap<[i32; 3], Kind> = HashMap::new();
        let glass = kind(GLASS, OWN);
        for x in 0..=20 {
            world.insert([x, 5, 6], glass);
        }

        let mut beams = BeamSystem::new();
        // Shallow grazing angle (~10 deg to the z = 6 glass plane): cos_theta ≈ 0.17 < 0.45.
        let grazing_spec = BeamSpec {
            origin: [1.0, 5.5, 5.0],
            dir: [5.5, 0.0, 1.0],
            power: 100.0,
            max_range: 40.0,
            max_bounces: 3,
            color: 0x88ccff,
        };
        let res = beams.fire_step(&grazing_spec, 0.02, |c| world.get(&c).copied().unwrap_or(0), &[]);
        assert!(
            res.events
                .iter()
                .any(|e| matches!(e, BeamEvent::MirrorBounce { .. })),
            "grazing ray on glass must emit MirrorBounce"
        );
        assert!(
            res.segments.len() >= 3,
            "Fresnel split should produce incident + reflected + transmitted segments, got {}",
            res.segments.len()
        );

        // Steep normal hit on glass: no grazing reflection, melts/shatters rapidly.
        let steep_spec = BeamSpec {
            origin: [10.5, 5.5, 2.0],
            dir: [0.0, 0.0, 1.0],
            power: 200.0,
            max_range: 20.0,
            max_bounces: 3,
            color: 0xff4422,
        };
        let steep = beams.fire_step(&steep_spec, 0.1, |c| world.get(&c).copied().unwrap_or(0), &[]);
        assert!(
            !steep
                .events
                .iter()
                .any(|e| matches!(e, BeamEvent::MirrorBounce { .. })),
            "normal-incidence glass must not mirror-bounce"
        );
        assert!(
            steep
                .events
                .iter()
                .any(|e| matches!(e, BeamEvent::MeltedVoxel { cell, .. } if *cell == [10, 5, 6])),
            "200 power * 0.1 s = 20 energy must shatter glass (threshold 16)"
        );
    }

    #[test]
    fn tunnel_boring_melts_three_cell_concrete_wall_sequentially_and_exposes_behind() {
        let mut world: HashMap<[i32; 3], Kind> = HashMap::new();
        let concrete = kind(CONCRETE, OWN);
        let wood = kind(WOOD, OWN);
        world.insert([10, 5, 5], concrete);
        world.insert([11, 5, 5], concrete);
        world.insert([12, 5, 5], concrete);
        // Flammable target hidden behind the 3-cell concrete wall.
        world.insert([15, 5, 5], wood);

        let mut beams = BeamSystem::new();
        let spec = BeamSpec {
            origin: [2.5, 5.5, 5.5],
            dir: [1.0, 0.0, 0.0],
            power: 250.0,
            max_range: 30.0,
            max_bounces: 2,
            color: 0xff6600,
        };

        let dt = 1.0 / 60.0;
        let mut melted_order: Vec<[i32; 3]> = Vec::new();
        let mut behind_ignited = false;

        for _ in 0..200 {
            let res = beams.fire_step(&spec, dt, |c| world.get(&c).copied().unwrap_or(0), &[]);
            for ev in &res.events {
                match *ev {
                    BeamEvent::MeltedVoxel { cell, .. } => {
                        world.remove(&cell);
                        melted_order.push(cell);
                    }
                    BeamEvent::IgniteVoxel { cell } if cell == [15, 5, 5] => {
                        behind_ignited = true;
                    }
                    _ => {}
                }
            }
            if behind_ignited {
                break;
            }
        }

        assert_eq!(
            melted_order,
            vec![[10, 5, 5], [11, 5, 5], [12, 5, 5]],
            "beam must bore through concrete wall cells 1, 2, 3 in strict order"
        );
        assert!(
            behind_ignited,
            "wood cell behind the concrete wall must be exposed and ignited after tunnel breakthrough"
        );
    }

    #[test]
    fn adjacent_flammable_voxel_ignites_from_heated_neighbor() {
        let mut world: HashMap<[i32; 3], Kind> = HashMap::new();
        world.insert([10, 5, 5], kind(BRICK, OWN));
        world.insert([10, 6, 5], kind(WOOD, OWN)); // directly above the brick

        let mut beams = BeamSystem::new();
        let spec = BeamSpec {
            origin: [4.5, 5.5, 5.5],
            dir: [1.0, 0.0, 0.0],
            power: 120.0,
            max_range: 20.0,
            max_bounces: 1,
            color: 0xff5500,
        };

        // Heat brick to >= 60% of 60.0 = 36.0 (0.35s * 120 = 42.0, below melt 60.0).
        let res = beams.fire_step(&spec, 0.35, |c| world.get(&c).copied().unwrap_or(0), &[]);
        assert!(
            res.events
                .iter()
                .any(|e| matches!(e, BeamEvent::IgniteVoxel { cell } if *cell == [10, 6, 5])),
            "heated brick must ignite adjacent wood voxel"
        );
        // Subsequent step should not spam duplicate IgniteVoxel for the same already-ignited cell.
        let res2 = beams.fire_step(&spec, 0.05, |c| world.get(&c).copied().unwrap_or(0), &[]);
        assert!(
            !res2
                .events
                .iter()
                .any(|e| matches!(e, BeamEvent::IgniteVoxel { cell } if *cell == [10, 6, 5]))
        );
    }

    #[test]
    fn thermal_cooling_decays_partial_heat_and_evicts_cold_cells() {
        let mut world: HashMap<[i32; 3], Kind> = HashMap::new();
        let target = [8, 4, 4];
        world.insert(target, kind(CONCRETE, OWN));

        let mut beams = BeamSystem::new();
        let spec = BeamSpec {
            origin: [1.5, 4.5, 4.5],
            dir: [1.0, 0.0, 0.0],
            power: 100.0,
            max_range: 20.0,
            max_bounces: 0,
            color: 0xff3300,
        };

        // Partial heat: 100 * 0.5 = 50.0 < 95.0 melt threshold -> heat ≈ 0.526.
        let res = beams.fire_step(&spec, 0.5, |c| world.get(&c).copied().unwrap_or(0), &[]);
        assert!(res.events.is_empty());
        assert_eq!(beams.thermal.len(), 1);
        let initial_heat = beams.thermal.heat_at(target);
        assert!(initial_heat > 0.5 && initial_heat < 0.6);
        assert_eq!(beams.thermal.hot_cells().count(), 1);

        // Beam turns off; cool over time in 60 Hz ticks and verify monotonic decay + eviction.
        let mut prev = initial_heat;
        for _ in 0..600 {
            beams.cool(1.0 / 60.0);
            let now = beams.thermal.heat_at(target);
            assert!(now <= prev, "heat must decay monotonically");
            prev = now;
            if beams.thermal.is_empty() {
                break;
            }
        }
        assert!(
            beams.thermal.is_empty(),
            "partially heated cell must cool below 0.01 and evict from ThermalMap (remaining heat = {})",
            beams.thermal.heat_at(target)
        );
        assert_eq!(beams.thermal.hot_cells().count(), 0);
    }

    #[test]
    fn dynamic_target_burn_emits_accurate_hit_and_respects_voxel_occlusion() {
        let mut beams = BeamSystem::new();
        let capsule_limb = BeamTarget {
            body_id: 42,
            shape: TargetShape::Capsule {
                a: [10.0, 4.0, 5.5],
                b: [10.0, 7.0, 5.5],
                radius: 0.5,
            },
            kind: 0,
            resistance: 2.0,
        };
        let far_sphere = BeamTarget::sphere(99, [16.0, 5.5, 5.5], 1.0);
        let targets = [far_sphere, capsule_limb];

        let spec = BeamSpec {
            origin: [2.0, 5.5, 5.5],
            dir: [1.0, 0.0, 0.0],
            power: 160.0,
            max_range: 40.0,
            max_bounces: 2,
            color: 0xff00aa,
        };

        let dt = 0.05;
        let res = beams.fire_step(&spec, dt, |_| 0, &targets);
        assert_eq!(res.segments.len(), 1);
        assert!((res.segments[0].end[0] - 9.5).abs() < 1e-4);

        let burn = res
            .events
            .iter()
            .find_map(|e| match *e {
                BeamEvent::DynamicBurn {
                    body_id,
                    pos,
                    normal,
                    energy_delta,
                    sever_power,
                } => Some((body_id, pos, normal, energy_delta, sever_power)),
                _ => None,
            })
            .expect("must emit DynamicBurn on capsule limb");
        assert_eq!(burn.0, 42);
        assert!((burn.1[0] - 9.5).abs() < 1e-4);
        assert!((burn.1[1] - 5.5).abs() < 1e-4);
        assert!((burn.1[2] - 5.5).abs() < 1e-4);
        assert!((burn.2[0] + 1.0).abs() < 1e-4);
        assert!((burn.3 - 8.0).abs() < 1e-4); // 160 * 0.05
        assert!((burn.4 - 80.0).abs() < 1e-4); // 160 / 2.0
        assert!(!res.glows.is_empty(), "dynamic burn must emit HeatGlow");

        // Place a concrete voxel in front of the ragdoll at x = 6; beam must hit the voxel instead.
        let occluded = beams.fire_step(
            &spec,
            dt,
            |c| if c == [6, 5, 5] { kind(CONCRETE, OWN) } else { 0 },
            &targets,
        );
        assert!(
            !occluded
                .events
                .iter()
                .any(|e| matches!(e, BeamEvent::DynamicBurn { .. })),
            "voxel wall in front must occlude dynamic target"
        );
        assert!((occluded.segments[0].end[0] - 6.0).abs() < 1e-4);
    }

    #[test]
    fn benchmark_16_simultaneous_multi_bounce_beams_under_300us() {
        // Build a fast analytical mirror-corridor world (2 parallel polished steel walls at
        // x = 0 and x = 16, ceiling/floor open, concrete backstop at z = 80) + 8 dynamic proxies.
        let mirror = kind(STEEL, OWN) | POLISHED;
        let backstop = kind(CONCRETE, OWN);
        let kind_at = |c: [i32; 3]| -> Kind {
            if c[0] == 0 || c[0] == 16 {
                mirror
            } else if c[2] >= 80 {
                backstop
            } else {
                0
            }
        };

        let targets: [BeamTarget; 8] = core::array::from_fn(|i| {
            BeamTarget::capsule(
                i as u32 + 1,
                [4.0 + (i as f32) * 1.4, 2.0, 85.0],
                [4.0 + (i as f32) * 1.4, 6.0, 85.0],
                0.4,
            )
        });

        let specs: [BeamSpec; 16] = core::array::from_fn(|i| {
            let side = if i % 2 == 0 { 1.0 } else { -1.0 };
            BeamSpec {
                origin: [8.0, 3.0 + (i as f32) * 0.25, 1.0],
                dir: [side * 0.85, 0.0, 0.52 + (i as f32) * 0.02],
                power: 120.0,
                max_range: 140.0,
                max_bounces: 6,
                color: 0xff2244,
            }
        });

        let mut beams = BeamSystem::new();
        let mut scratch = BeamResult::default();
        let dt = 1.0 / 60.0;

        // Warmup
        for spec in &specs {
            scratch.segments.clear();
            scratch.events.clear();
            scratch.glows.clear();
            beams.fire_step_into(spec, dt, kind_at, &targets, &mut scratch);
        }
        assert!(
            scratch.segments.len() >= 4,
            "benchmark beams must exercise multi-bounce paths, got {} segments",
            scratch.segments.len()
        );

        let frames = 200u32;
        let start = Instant::now();
        let mut total_segments = 0usize;
        for _ in 0..frames {
            beams.cool(dt);
            for spec in &specs {
                scratch.segments.clear();
                scratch.events.clear();
                scratch.glows.clear();
                beams.fire_step_into(spec, dt, kind_at, &targets, &mut scratch);
                total_segments += scratch.segments.len();
            }
        }
        let elapsed = start.elapsed();
        let per_frame_us = elapsed.as_secs_f64() * 1e6 / (frames as f64);
        assert!(total_segments > (frames as usize) * 16 * 3);

        // Release target: < 300 us (0.3 ms) per frame for 16 multi-bounce beams.
        // In debug builds without full opt, keep a generous ceiling; in release enforce 300 us.
        let budget_us = if cfg!(debug_assertions) { 3000.0 } else { 300.0 };
        eprintln!(
            "beams bench: 16 multi-bounce beams ({} segs/frame) = {:.2} us/frame (budget {:.0} us)",
            total_segments / (frames as usize),
            per_frame_us,
            budget_us
        );
        assert!(
            per_frame_us < budget_us,
            "16 multi-bounce beams took {per_frame_us:.2} us/frame, exceeding {budget_us:.0} us budget"
        );
    }

    #[test]
    fn max_bounces_clamps_to_8_and_attenuates_power_monotonically() {
        let mirror = kind(STEEL, OWN) | POLISHED;
        let kind_at = |c: [i32; 3]| -> Kind {
            if c[0] == 0 || c[0] == 10 { mirror } else { 0 }
        };
        let mut beams = BeamSystem::new();
        let res = beams.fire_step(
            &BeamSpec {
                origin: [5.0, 2.5, 0.5],
                dir: [1.0, 0.0, 0.1],
                power: 100.0,
                max_range: 500.0,
                max_bounces: 20, // should clamp to MAX_BOUNCES (8)
                color: 0xffffff,
            },
            0.0,
            kind_at,
            &[],
        );
        assert_eq!(res.segments.len(), (MAX_BOUNCES as usize) + 1);
        for (i, seg) in res.segments.iter().enumerate() {
            assert_eq!(seg.bounce, i as u8);
            let expected = 100.0 * POLISHED_REFLECTIVITY.powi(i as i32);
            assert!((seg.power - expected).abs() < 1e-3);
        }
    }

    #[test]
    fn negative_coordinates_and_degenerate_inputs_handled_cleanly() {
        let mut beams = BeamSystem::new();
        // Zero direction / non-positive power / NaN must return empty without panicking.
        for bad in [
            BeamSpec {
                origin: [0.0; 3],
                dir: [0.0; 3],
                power: 100.0,
                max_range: 10.0,
                max_bounces: 4,
                color: 0,
            },
            BeamSpec {
                origin: [0.0; 3],
                dir: [1.0, 0.0, 0.0],
                power: 0.0,
                max_range: 10.0,
                max_bounces: 4,
                color: 0,
            },
            BeamSpec {
                origin: [f32::NAN, 0.0, 0.0],
                dir: [1.0, 0.0, 0.0],
                power: 100.0,
                max_range: 10.0,
                max_bounces: 4,
                color: 0,
            },
        ] {
            let r = beams.fire_step(&bad, 0.016, |_| 0, &[]);
            assert!(r.segments.is_empty());
            assert!(r.events.is_empty());
        }

        // Negative coordinate voxel hit and reflection.
        let mirror = kind(STEEL, OWN) | POLISHED;
        let target = [-10, -5, -10];
        let wood = kind(WOOD, OWN);
        let res = beams.fire_step(
            &BeamSpec {
                origin: [-5.5, -4.5, -5.5],
                dir: [-1.0, 0.0, 0.0],
                power: 100.0,
                max_range: 30.0,
                max_bounces: 2,
                color: 0x00ff88,
            },
            0.2,
            |c| {
                if c == [-10, -5, -6] {
                    mirror
                } else if c == target {
                    wood
                } else {
                    0
                }
            },
            &[],
        );
        // Ray along -X from -5.5 hits mirror cell [-10, -5, -6] at x = -9.0 (its +X face) and reflects along +X.
        assert_eq!(res.segments.len(), 2);
        assert!((res.segments[0].end[0] - (-9.0)).abs() < 1e-4);
        assert!(res.segments[1].end[0] > res.segments[1].start[0]);
    }
}
