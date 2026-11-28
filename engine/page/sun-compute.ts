// Single-dispatch compute sun shadow tile updater (#165).
//
// Replaces per-tile `beginRenderPass` blocks (`fs_sun`, up to 8 render passes a frame on
// 1024x1024 r32float attachments) with a single compute pass (`cs_sun_tiles`, workgroup 8x8x1,
// dispatched `(8, 8, tileCount)`) that writes directly into the `texture_2d_array<r32float>`
// via `texture_storage_2d_array<r32float, write>` (`STORAGE_BINDING` write-only is core WebGPU
// on both Chrome and Safari Metal). On Apple TBDR GPUs this eliminates per-tile full-attachment
// load/store bandwidth and per-tile uniform buffer juggling.
import { shader } from '../probe/gpu.ts'
import { SUN_SIDE, SUN_TILE, type SunMaps, type SunTile } from './sun.ts'

/** Maximum dirty sun-map tiles updated in a single compute dispatch. */
export const MAX_SUN_TILES = 16
/** Edge length of one sun-map tile in texels (64x64). */
export const SUN_TILE_SIZE = SUN_TILE
/** Compute workgroup size along X and Y (8x8x1 threads per workgroup). */
export const SUN_TILE_WORKGROUP = 8
/** Workgroups dispatched along X and Y per 64x64 tile (8x8 workgroups = 64x64 threads). */
export const SUN_TILE_WORKGROUPS_PER_AXIS = SUN_TILE_SIZE / SUN_TILE_WORKGROUP
/** Byte size of one packed `SunTileDesc` record (32 bytes, 16-byte aligned for uniform arrays). */
export const SUN_TILE_DESC_BYTES = 32
/** Total byte size of the batch uniform buffer (`MAX_SUN_TILES * 32 = 512` bytes). */
export const SUN_TILE_BATCH_BYTES = MAX_SUN_TILES * SUN_TILE_DESC_BYTES

/** A scheduled sun-map tile ready for batch compute dispatch. */
export interface SunComputeTile extends SunTile {
  /** World-space UV of texel (0, 0)'s center relative to the frame anchor (`sunMaps.corner(tile, anchor)`). */
  readonly corner?: readonly [number, number]
  /** World cells per texel; defaults to `1 << level`. */
  readonly texel?: number
}

/** Timestamp query writes accepted by `dispatch()`, supporting both WebGPU's descriptor and `march.tend()`'s `{ querySet, begin, end }`. */
export type SunComputeTiming =
  | GPUComputePassTimestampWrites
  | { readonly querySet: GPUQuerySet; readonly begin: number; readonly end: number }

/** Options for generating the `cs_sun_tiles` WGSL snippet. */
export interface SunTileBatchWgslOptions {
  /** Bind group index for `sunBatch` (binding 0) and `sunOut` (binding 1). Defaults to `1`. */
  readonly batchGroup?: number
  /** Enable bit-0 fine-cell tagging in stored `r32float` distances (matches `world.options.fineSun`). */
  readonly fineSun?: boolean
  /** Maximum raymarch steps per sun texel (defaults to `768`, matching `fs_sun`). */
  readonly maxSteps?: number
  /**
   * When true, the caller's WGSL supplies `fn sunShadowDist(tile: SunTileDesc, local: vec2u) -> f32`
   * directly instead of `g: Globals` + `trace(...)`.
   */
  readonly customEvaluator?: boolean
  /** Compute entry point name. Defaults to `'cs_sun_tiles'`. */
  readonly entryPoint?: string
}

/**
 * Generate the WGSL declarations and `cs_sun_tiles` compute entry point that update up to
 * `MAX_SUN_TILES` (16) `64x64` sun-map tiles in a single `dispatchWorkgroups(8, 8, tileCount)` pass.
 *
 * When `customEvaluator` is false (default), the generated shader shares the exact ray setup and
 * `trace(..., through = true)` math of `march.ts`'s `fs_sun`, producing bit-exact identical
 * `r32float` shadow distances.
 */
export function sunTileBatchWgsl(options: SunTileBatchWgslOptions = {}): string {
  const batchGroup = options.batchGroup ?? 1
  const fineSun = options.fineSun ?? false
  const maxSteps = options.maxSteps ?? 768
  const customEvaluator = options.customEvaluator ?? false
  const entryPoint = options.entryPoint ?? 'cs_sun_tiles'

  const evaluator = customEvaluator
    ? ''
    : fineSun
      ? /* wgsl */ `
fn sunShadowDist(tile: SunTileDesc, local: vec2u) -> f32 {
  // Explicit fma() locks the IEEE-754 contraction order so compute (indexed by gid.z) and fragment
  // (uniform per draw) produce bit-exact identical rays on Apple Metal.
  let uv = fma(vec2f(f32(local.x), f32(local.y)), vec2f(tile.texel), tile.corner);
  let eyeSun = g.sun * dot(g.eye, g.sun);
  let o = fma(g.sunV, vec3f(uv.y), fma(g.sunU, vec3f(uv.x), eyeSun));
  let lv = g.level[tile.level];
  let invSun = 1.0 / g.sun;
  let boxMax = fma(lv.boxSize, vec3f(1.0 / lv.scale), lv.boxMin);
  let a = (lv.boxMin - o) * invSun;
  let b = (boxMax - o) * invSun;
  let nearT = min(a, b);
  let hiT = max(a, b);
  let come = max(nearT.x, max(nearT.y, nearT.z));
  if (come >= min(hiT.x, min(hiT.y, hiT.z))) { return -1e30; }
  let hit = trace(o, g.sun, fma(0.01, tile.texel, come), tile.level, ${maxSteps}u, 0.0, 0.0, false, true, false);
  if (hit.kind == 0u) { return -1e30; }
  let inside = vec3i(floor((fma(g.sun, vec3f(hit.t - 0.01 / lv.scale), o) - lv.boxMin) * lv.scale));
  let marked = fineWord(sectorOf(inside, tile.level), inside) != 0u;
  return bitcast<f32>((bitcast<u32>(dot(o, g.sun) + hit.t + g.sunFar) & 0xfffffffeu) | u32(marked));
}`
      : /* wgsl */ `
fn sunShadowDist(tile: SunTileDesc, local: vec2u) -> f32 {
  // Explicit fma() locks the IEEE-754 contraction order so compute (indexed by gid.z) and fragment
  // (uniform per draw) produce bit-exact identical rays on Apple Metal.
  let uv = fma(vec2f(f32(local.x), f32(local.y)), vec2f(tile.texel), tile.corner);
  let eyeSun = g.sun * dot(g.eye, g.sun);
  let o = fma(g.sunV, vec3f(uv.y), fma(g.sunU, vec3f(uv.x), eyeSun));
  let lv = g.level[tile.level];
  let invSun = 1.0 / g.sun;
  let boxMax = fma(lv.boxSize, vec3f(1.0 / lv.scale), lv.boxMin);
  let a = (lv.boxMin - o) * invSun;
  let b = (boxMax - o) * invSun;
  let nearT = min(a, b);
  let hiT = max(a, b);
  let come = max(nearT.x, max(nearT.y, nearT.z));
  if (come >= min(hiT.x, min(hiT.y, hiT.z))) { return -1e30; }
  let hit = trace(o, g.sun, fma(0.01, tile.texel, come), tile.level, ${maxSteps}u, 0.0, 0.0, false, true, false);
  if (hit.kind == 0u) { return -1e30; }
  return dot(o, g.sun) + hit.t + g.sunFar;
}`

  return /* wgsl */ `
// Batch descriptor for up to ${MAX_SUN_TILES} dirty ${SUN_TILE_SIZE}x${SUN_TILE_SIZE} sun shadow tiles (32 bytes each).
struct SunTileDesc {
  corner: vec2f,
  texel: f32,
  level: u32,
  slotX: u32,
  slotY: u32,
  tx: i32,
  ty: i32,
}
struct SunTileBatch {
  tiles: array<SunTileDesc, ${MAX_SUN_TILES}>,
}

@group(${batchGroup}) @binding(0) var<uniform> sunBatch: SunTileBatch;
@group(${batchGroup}) @binding(1) var sunOut: texture_storage_2d_array<r32float, write>;
${evaluator}

@compute @workgroup_size(${SUN_TILE_WORKGROUP}, ${SUN_TILE_WORKGROUP}, 1)
fn ${entryPoint}(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.z >= ${MAX_SUN_TILES}u || gid.x >= ${SUN_TILE_SIZE}u || gid.y >= ${SUN_TILE_SIZE}u) { return; }
  let tile = sunBatch.tiles[gid.z];
  let dist = sunShadowDist(tile, gid.xy);
  let dst = vec2u(tile.slotX * ${SUN_TILE_SIZE}u + gid.x, tile.slotY * ${SUN_TILE_SIZE}u + gid.y);
  textureStore(sunOut, dst, tile.level, vec4f(dist, 0.0, 0.0, 0.0));
}
`
}

/**
 * Default WGSL snippet (group 1, standard `r32float` distance) so `march.ts` / `march-trace.ts`
 * can compile `cs_sun_tiles` in one line beside `trace(...)`.
 */
export const SUN_TILE_BATCH_WGSL: string = sunTileBatchWgsl()

/**
 * Pack up to `MAX_SUN_TILES` tile descriptors into a contiguous 32-byte-per-tile `ArrayBuffer`
 * for a single `queue.writeBuffer` upload.
 */
export function packSunTileBatch(
  tiles: readonly SunComputeTile[],
  target: ArrayBuffer = new ArrayBuffer(SUN_TILE_BATCH_BYTES),
): { readonly buffer: ArrayBuffer; readonly count: number; readonly byteLength: number } {
  const count = Math.min(tiles.length, MAX_SUN_TILES)
  const f32 = new Float32Array(target)
  const u32 = new Uint32Array(target)
  const i32 = new Int32Array(target)
  for (let i = 0; i < count; i++) {
    const tile = tiles[i]
    const texel = tile.texel ?? (1 << tile.level)
    const cx = tile.corner ? tile.corner[0] : (tile.tx * SUN_TILE_SIZE + 0.5) * texel
    const cy = tile.corner ? tile.corner[1] : (tile.ty * SUN_TILE_SIZE + 0.5) * texel
    const o = i * 8
    f32[o + 0] = cx
    f32[o + 1] = cy
    f32[o + 2] = texel
    u32[o + 3] = tile.level >>> 0
    u32[o + 4] = tile.slotX >>> 0
    u32[o + 5] = tile.slotY >>> 0
    i32[o + 6] = tile.tx | 0
    i32[o + 7] = tile.ty | 0
  }
  return { buffer: target, count, byteLength: count * SUN_TILE_DESC_BYTES }
}

/** Attach anchor-relative `corner` UVs from `SunMaps.corner()` to planned `SunTile`s. */
export function prepareSunTiles(
  tiles: readonly SunTile[],
  sunMaps: Pick<SunMaps, 'corner'>,
  anchor: readonly [number, number, number],
): SunComputeTile[] {
  return tiles.map((tile) => ({
    level: tile.level,
    slotX: tile.slotX,
    slotY: tile.slotY,
    tx: tile.tx,
    ty: tile.ty,
    corner: sunMaps.corner(tile, anchor),
    texel: 1 << tile.level,
  }))
}

/** Create the compute bind group layout for `sunBatch` (binding 0) and `sunOut` (binding 1). */
export function createSunBatchBindGroupLayout(device: GPUDevice, label = 'sun-compute-batch'): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label,
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', minBindingSize: SUN_TILE_BATCH_BYTES },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: 'write-only',
          format: 'r32float',
          viewDimension: '2d-array',
        },
      },
    ],
  })
}

/**
 * Create a `1024x1024xlevels` `r32float` `texture_2d_array` with `STORAGE_BINDING` enabled for
 * direct compute writes alongside sampling and copies.
 */
export function createSunComputeTexture(
  device: GPUDevice,
  levels: number,
  side = SUN_SIDE,
  extraUsage: GPUTextureUsageFlags = 0,
): { readonly texture: GPUTexture; readonly view: GPUTextureView } {
  const texture = device.createTexture({
    label: 'sun maps compute',
    size: [side, side, levels],
    format: 'r32float',
    usage:
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST |
      extraUsage,
  })
  const view = texture.createView({ dimension: '2d-array' })
  return { texture, view }
}

/** Lifetime and last-dispatch counters returned by `ComputeSunUpdater.stats()`. */
export interface SunComputeStats {
  /** Number of non-empty compute dispatches encoded. */
  readonly dispatches: number
  /** Total tiles updated across all dispatches. */
  readonly tilesUpdated: number
  /** Tiles updated in the most recent `dispatch()` call (0 on no-op). */
  readonly lastTileCount: number
  /** Maximum batch size supported per single dispatch (`MAX_SUN_TILES = 16`). */
  readonly maxBatchTiles: number
  /** Total 8x8x1 workgroups dispatched (`64 * tilesUpdated`). */
  readonly workgroupsDispatched: number
  /** Whether `destroy()` has been called. */
  readonly destroyed: boolean
}

/** Configuration for `createComputeSunUpdater`. */
export interface CreateComputeSunUpdaterOptions {
  /**
   * Bind group layout(s) bound before the updater's batch+output group.
   * Passing one `GPUBindGroupLayout` places it at `@group(0)` and the batch+output at `@group(1)`.
   */
  readonly worldLayout: GPUBindGroupLayout | readonly GPUBindGroupLayout[]
  /**
   * WGSL source providing `g: Globals` + `trace(...)` (and `sectorOf`/`fineWord` when `fineSun` is true),
   * or `sunShadowDist(...)` when `customEvaluator` is true. Required unless `module` is provided.
   */
  readonly traceWgsl?: string
  /** Pre-compiled shader module that already includes `SUN_TILE_BATCH_WGSL` (`cs_sun_tiles`). */
  readonly module?: GPUShaderModule
  /** Enable bit-0 fine-cell tagging in stored `r32float` distances. */
  readonly fineSun?: boolean
  /** Maximum raymarch steps per sun texel (defaults to `768`). */
  readonly maxSteps?: number
  /** Use caller-supplied `sunShadowDist(tile, local)` instead of the default `march.ts` `trace(...)` body. */
  readonly customEvaluator?: boolean
  /** Compute entry point name (defaults to `'cs_sun_tiles'`). */
  readonly entryPoint?: string
  /** Optional WGSL pipeline override constants. */
  readonly constants?: Record<string, GPUPipelineConstantValue>
  /** Optional debug label prefix. */
  readonly label?: string
}

/** Drop-in single-dispatch compute updater for `SunMaps` shadow tiles. */
export interface ComputeSunUpdater {
  /** Layout for the batch uniform buffer (`@binding(0)`) and `r32float` storage texture array (`@binding(1)`). */
  readonly batchLayout: GPUBindGroupLayout
  /** Compute pipeline running `cs_sun_tiles` at `@workgroup_size(8, 8, 1)`. */
  readonly pipeline: GPUComputePipeline
  /** Reusable 512-byte uniform buffer storing up to `MAX_SUN_TILES` descriptors. */
  readonly batchBuffer: GPUBuffer
  /**
   * Upload all scheduled tiles in a single `queue.writeBuffer` and update every tile in one
   * `beginComputePass` (`dispatchWorkgroups(8, 8, count)`).
   *
   * Returns the number of tiles dispatched (`0` for an empty batch, clamped to `MAX_SUN_TILES`).
   * Note: because `queue.writeBuffer` applies before all passes in a submit, encode at most one
   * distinct tile batch per `queue.submit()`.
   */
  dispatch(
    encoder: GPUCommandEncoder,
    tiles: readonly SunComputeTile[],
    targetView: GPUTextureView,
    bindGroups: GPUBindGroup | readonly GPUBindGroup[],
    timing?: SunComputeTiming,
  ): number
  /** Snapshot of lifetime and most-recent dispatch counters. */
  stats(): SunComputeStats
  /** Release owned GPU resources (`batchBuffer`). */
  destroy(): void
}

function normalizeTiming(timing?: SunComputeTiming): GPUComputePassTimestampWrites | undefined {
  if (!timing) return undefined
  if ('begin' in timing) {
    return {
      querySet: timing.querySet,
      beginningOfPassWriteIndex: timing.begin,
      endOfPassWriteIndex: timing.end,
    }
  }
  return timing
}

/**
 * Create a single-dispatch compute sun shadow tile updater (`cs_sun_tiles`, `@workgroup_size(8, 8, 1)`).
 *
 * Accepts either a reusable `traceWgsl` body (compiled alongside `SUN_TILE_BATCH_WGSL`) or a
 * pre-compiled `module` (so `march.ts` can compile `fs` and `cs_sun_tiles` in one shader module).
 */
export async function createComputeSunUpdater(
  device: GPUDevice,
  options: CreateComputeSunUpdaterOptions,
): Promise<ComputeSunUpdater> {
  const label = options.label ?? 'sun-compute'
  const entryPoint = options.entryPoint ?? 'cs_sun_tiles'
  const worldLayouts: readonly GPUBindGroupLayout[] = Array.isArray(options.worldLayout)
    ? options.worldLayout
    : [options.worldLayout]
  const batchGroupIndex = worldLayouts.length
  const batchLayout = createSunBatchBindGroupLayout(device, `${label}-batch-layout`)
  const pipelineLayout = device.createPipelineLayout({
    label: `${label}-layout`,
    bindGroupLayouts: [...worldLayouts, batchLayout],
  })

  let module = options.module
  if (!module) {
    if (!options.traceWgsl) {
      throw new Error('createComputeSunUpdater requires either `traceWgsl` or a pre-compiled `module`')
    }
    const batchWgsl =
      batchGroupIndex === 1 && !options.fineSun && options.maxSteps === undefined && !options.customEvaluator && entryPoint === 'cs_sun_tiles'
        ? SUN_TILE_BATCH_WGSL
        : sunTileBatchWgsl({
            batchGroup: batchGroupIndex,
            fineSun: options.fineSun,
            maxSteps: options.maxSteps,
            customEvaluator: options.customEvaluator,
            entryPoint,
          })
    module = await shader(device, label, `${options.traceWgsl}\n${batchWgsl}`)
  }

  const pipeline = await device.createComputePipelineAsync({
    label: `${label}-pipeline`,
    layout: pipelineLayout,
    compute: {
      module,
      entryPoint,
      ...(options.constants ? { constants: options.constants } : {}),
    },
  })

  const batchBuffer = device.createBuffer({
    label: `${label}-batch`,
    size: SUN_TILE_BATCH_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  // Persistent staging memory so steady-state frames allocate zero typed arrays.
  const staging = new ArrayBuffer(SUN_TILE_BATCH_BYTES)
  // Cache group-N bind groups per target GPUTextureView for zero per-frame bind group churn.
  const viewBindGroups = new WeakMap<GPUTextureView, GPUBindGroup>()

  let dispatches = 0
  let tilesUpdated = 0
  let lastTileCount = 0
  let workgroupsDispatched = 0
  let destroyed = false

  const getBatchBindGroup = (targetView: GPUTextureView): GPUBindGroup => {
    let bg = viewBindGroups.get(targetView)
    if (!bg) {
      bg = device.createBindGroup({
        label: `${label}-batch-bg`,
        layout: batchLayout,
        entries: [
          { binding: 0, resource: { buffer: batchBuffer } },
          { binding: 1, resource: targetView },
        ],
      })
      viewBindGroups.set(targetView, bg)
    }
    return bg
  }

  return {
    batchLayout,
    pipeline,
    batchBuffer,
    dispatch(encoder, tiles, targetView, bindGroups, timing) {
      if (destroyed) throw new Error('ComputeSunUpdater has been destroyed')
      if (tiles.length === 0) {
        lastTileCount = 0
        return 0
      }
      const { count, byteLength } = packSunTileBatch(tiles, staging)
      device.queue.writeBuffer(batchBuffer, 0, staging, 0, byteLength)

      const groups: readonly GPUBindGroup[] = Array.isArray(bindGroups) ? bindGroups : [bindGroups]
      const timestampWrites = normalizeTiming(timing)
      const computePass = encoder.beginComputePass({
        label: `${label}-pass`,
        ...(timestampWrites ? { timestampWrites } : {}),
      })
      computePass.setPipeline(pipeline)
      for (let i = 0; i < groups.length; i++) {
        computePass.setBindGroup(i, groups[i])
      }
      computePass.setBindGroup(batchGroupIndex, getBatchBindGroup(targetView))
      computePass.dispatchWorkgroups(SUN_TILE_WORKGROUPS_PER_AXIS, SUN_TILE_WORKGROUPS_PER_AXIS, count)
      computePass.end()

      dispatches++
      tilesUpdated += count
      lastTileCount = count
      workgroupsDispatched += SUN_TILE_WORKGROUPS_PER_AXIS * SUN_TILE_WORKGROUPS_PER_AXIS * count
      return count
    },
    stats() {
      return {
        dispatches,
        tilesUpdated,
        lastTileCount,
        maxBatchTiles: MAX_SUN_TILES,
        workgroupsDispatched,
        destroyed,
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      batchBuffer.destroy()
    },
  }
}
