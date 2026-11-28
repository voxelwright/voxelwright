// Standalone WebGPU Temporal Anti-Aliasing & Spatial-Temporal Upscaling engine (TSR-lite, #165).
//
// Designed for zero-GC dynamic-resolution rendering (0.50x-1.0x active sub-rect inside persistent
// allocated color/depth/velocity textures) reconstructing crisp native-resolution linear HDR output
// ready for glow.ts.
//
// Pipeline:
//   1. `cs_resolve` (@workgroup_size(8, 8)):
//      - 3x3 closest-depth velocity dilation in render-res space (0 = near, 1 = far).
//      - 5-tap Catmull-Rom bicubic history sampling in Karis tone-mapped space (zero bilinear drift).
//      - Dual-kernel sub-pixel spatial reconstruction (tight output-space Gaussian for direct jitter
//        hits + smooth render-space fallback for frame 0 / disocclusions).
//      - 3x3 YCoCg variance clipping (mu +/- gamma*sigma intersected with 3x3 min/max, ray-clipped
//        toward mu, tighter under high velocity) in reversible Karis luminance space.
//      - Confidence-weighted temporal accumulation (stored in history .a) for sharp TSR convergence
//        and fast disocclusion recovery without reallocating on renderSize changes.
//   2. `cs_sharpen` (@workgroup_size(8, 8), skipped when sharpness <= 0):
//      - Anti-ringing RCAS sharpening in Karis tone-mapped space clamped to the 5-tap cross bounds,
//        preserving HDR emissives with zero black halo rings and never feeding back into history.
import { shader } from '../probe/gpu.ts'

/** Number of samples in the repeating Halton(2, 3) sub-pixel jitter cycle. */
export const HALTON_COUNT = 16

function halton(index: number, base: number): number {
  let factor = 1
  let result = 0
  let i = index
  while (i > 0) {
    factor /= base
    result += factor * (i % base)
    i = Math.floor(i / base)
  }
  return result
}

const HALTON_16: readonly (readonly [number, number])[] = Array.from({ length: HALTON_COUNT }, (_, i) => [
  halton(i + 1, 2) - 0.5,
  halton(i + 1, 3) - 0.5,
] as const)

/**
 * Returns the 16-sample Halton(2, 3) pixel jitter centered in `[-0.5, 0.5]` render-resolution pixels.
 * Zero-GC: returns a pre-allocated tuple.
 *
 * Sign convention: render pixel `(ix, iy)` samples the scene at `(ix + 0.5 + jx, iy + 0.5 + jy)`.
 */
export function haltonJitter(
  frameIndex: number,
  _renderWidth = 1,
  _renderHeight = 1,
): readonly [number, number] {
  return HALTON_16[(frameIndex | 0) & 15]
}

/**
 * Converts the frame's Halton(2, 3) pixel jitter into WebGPU clip/NDC offset `[+2*jx/w, -2*jy/h]`.
 * Raymarchers add this offset to the primary ray NDC; rasterizers subtract it from clip XY
 * (`clip.xy -= ndcJitter * clip.w`) so pixel centers sample the same continuous scene point.
 */
export function haltonJitterNdc(
  frameIndex: number,
  renderWidth: number,
  renderHeight: number,
): readonly [number, number] {
  const [jx, jy] = HALTON_16[(frameIndex | 0) & 15]
  const w = Math.max(1, renderWidth)
  const h = Math.max(1, renderHeight)
  return [(2 * jx) / w, (-2 * jy) / h]
}

export interface TaaInput {
  /** Linear HDR current frame color (may occupy the top-left `renderSize` sub-rect of `allocSize`). */
  color: GPUTextureView
  /** Current frame depth (`depth24plus`, 0 = near, 1 = far; same active sub-rect as `color`). */
  depth: GPUTextureView
  /** Screen-space UV motion vectors (`rg16float`, `prevUV - curUV`; same active sub-rect as `color`). */
  velocity: GPUTextureView
  /** Active rendered pixels `[width, height]` inside `color` / `depth` / `velocity`. */
  renderSize: readonly [number, number]
  /** Allocated dimensions `[width, height]` of `color` / `depth` / `velocity` (for zero-realloc `uvScale`). */
  allocSize: readonly [number, number]
  /** Native target output resolution `[width, height]` (e.g. canvas size). */
  outputSize: readonly [number, number]
  /** Current frame's pixel jitter `[jx, jy]` in render-resolution pixels (`[-0.5, 0.5]`). */
  jitter: readonly [number, number]
  /** Hard history reset on teleport, camera cut, or realm switch. */
  reset?: boolean
  /** Optional RCAS sharpening strength in `[0, 1]` (default `0.25`; `0` skips sharpening). */
  sharpness?: number
}

export interface TaaStats {
  /** Number of internal history/output texture reallocations (always 0 across `renderSize` changes). */
  reallocs: number
  /** Total resolved frames since creation. */
  frames: number
  /** Total history resets (explicit or output-size change). */
  resets: number
  /** Whether temporal history is valid for the next frame. */
  historyValid: boolean
  /** Currently allocated persistent history/output capacity `[width, height]`. */
  capacity: readonly [number, number]
  /** Last resolved `outputSize` `[width, height]`. */
  outputSize: readonly [number, number]
  /** Last active `renderSize` `[width, height]`. */
  renderSize: readonly [number, number]
}

export interface TaaPass {
  /** Resolves and temporally upscales the current frame into a native-res linear HDR `GPUTextureView`. */
  resolve(encoder: GPUCommandEncoder, input: TaaInput, timing?: GPUComputePassTimestampWrites): GPUTextureView
  /** Underlying `GPUTexture` of the most recently returned resolved output view. */
  readonly texture: GPUTexture
  /** Marks temporal history invalid so the next `resolve()` starts fresh without blending stale history. */
  reset(): void
  /** Returns allocation and frame statistics. */
  stats(): TaaStats
  /** Destroys all GPU resources owned by this TAA instance. */
  destroy(): void
}

const DEFAULT_SHARPNESS = 0.25
const PARAMS_FLOATS = 20
const PARAMS_BYTES = PARAMS_FLOATS * 4
const RESOLVE_PASS_DESC: GPUComputePassDescriptor = { label: 'taa-resolve' }
const SHARPEN_PASS_DESC: GPUComputePassDescriptor = { label: 'taa-sharpen' }
const HISTORY_USAGE =
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.STORAGE_BINDING |
  GPUTextureUsage.RENDER_ATTACHMENT |
  GPUTextureUsage.COPY_SRC

const WGSL = /* wgsl */ `
struct TaaParams {
  // xy: active renderSize, zw: 1 / renderSize
  renderInfo: vec4f,
  // xy: allocated input texture size, zw: 1 / allocSize
  allocInfo: vec4f,
  // xy: active outputSize, zw: 1 / outputSize
  outputInfo: vec4f,
  // xy: persistent history/output capacity, zw: 1 / capacity
  capInfo: vec4f,
  // xy: pixel jitter in render-res pixels, z: RCAS sharpness (0..1), w: reset flag (1 = reset, 0 = normal)
  jitterFlags: vec4f,
}

@group(0) @binding(0) var colorTex: texture_2d<f32>;
@group(0) @binding(1) var depthTex: texture_depth_2d;
@group(0) @binding(2) var velTex: texture_2d<f32>;
@group(0) @binding(3) var historyIn: texture_2d<f32>;
@group(0) @binding(4) var historyOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var linSamp: sampler;
@group(0) @binding(6) var<uniform> params: TaaParams;

// Replace NaN/Inf/negative values so corrupt inputs can never poison history.
fn cleanRgb(c: vec3f) -> vec3f {
  let nonNeg = select(vec3f(0.0), c, c >= vec3f(0.0));
  return select(vec3f(65000.0), nonNeg, nonNeg <= vec3f(65000.0));
}

// Luminance matching the Y channel of YCoCg so Karis tone-mapping stays strictly invertible inside YCoCg AABBs.
fn ycocgLuma(c: vec3f) -> f32 {
  return 0.25 * c.r + 0.5 * c.g + 0.25 * c.b;
}

// Reversible Karis / inverse-luminance HDR weighting: maps [0, inf) -> Y in [0, 1).
fn karisFwd(c: vec3f) -> vec3f {
  return c / (1.0 + ycocgLuma(c));
}

fn karisInv(c: vec3f) -> vec3f {
  let clamped = max(c, vec3f(0.0));
  let l = min(ycocgLuma(clamped), 0.9995);
  return clamped / max(1.0 - l, 0.0005);
}

fn rgbToYCoCg(c: vec3f) -> vec3f {
  let y  =  0.25 * c.r + 0.5 * c.g + 0.25 * c.b;
  let co =  0.5  * c.r             - 0.5  * c.b;
  let cg = -0.25 * c.r + 0.5 * c.g - 0.25 * c.b;
  return vec3f(y, co, cg);
}

fn yCoCgToRgb(ycc: vec3f) -> vec3f {
  let tmp = ycc.x - ycc.z;
  return max(vec3f(tmp + ycc.y, ycc.x + ycc.z, tmp - ycc.y), vec3f(0.0));
}

// Exact ray-to-AABB clip from history toward neighborhood mean mu.
// Returns (clippedYCoCg, clipFrac) where clipFrac = 0 means untouched and 1 means clipped all the way to mu.
struct ClipResult {
  col: vec3f,
  amount: f32,
}

fn clipTowardMu(boxMin: vec3f, boxMax: vec3f, mu: vec3f, hist: vec3f) -> ClipResult {
  let d = hist - mu;
  var t = 1.0;
  if (d.x > 1e-6) {
    t = min(t, (boxMax.x - mu.x) / d.x);
  } else if (d.x < -1e-6) {
    t = min(t, (boxMin.x - mu.x) / d.x);
  }
  if (d.y > 1e-6) {
    t = min(t, (boxMax.y - mu.y) / d.y);
  } else if (d.y < -1e-6) {
    t = min(t, (boxMin.y - mu.y) / d.y);
  }
  if (d.z > 1e-6) {
    t = min(t, (boxMax.z - mu.z) / d.z);
  } else if (d.z < -1e-6) {
    t = min(t, (boxMin.z - mu.z) / d.z);
  }
  let tc = clamp(t, 0.0, 1.0);
  return ClipResult(mu + d * tc, 1.0 - tc);
}

// 5-tap Catmull-Rom bicubic history fetch in Karis tone-mapped space.
// Clamps every tap inside the active outputSize sub-rect of historyIn.
fn fetchHistoryBicubic(prevUV: vec2f, outSize: vec2f, invCap: vec2f) -> vec4f {
  let pos = prevUV * outSize;
  let texPos1 = floor(pos - 0.5) + 0.5;
  let f = pos - texPos1;

  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);

  let w12 = w1 + w2;
  let off12 = w2 / max(w12, vec2f(1e-5));

  let lo = vec2f(0.5);
  let hi = outSize - vec2f(0.5);
  let tc0 = clamp(texPos1 - 1.0, lo, hi) * invCap;
  let tc12 = clamp(texPos1 + off12, lo, hi) * invCap;
  let tc3 = clamp(texPos1 + 2.0, lo, hi) * invCap;

  let s0 = textureSampleLevel(historyIn, linSamp, vec2f(tc12.x, tc0.y), 0.0);
  let s1 = textureSampleLevel(historyIn, linSamp, vec2f(tc0.x, tc12.y), 0.0);
  let s2 = textureSampleLevel(historyIn, linSamp, vec2f(tc12.x, tc12.y), 0.0);
  let s3 = textureSampleLevel(historyIn, linSamp, vec2f(tc3.x, tc12.y), 0.0);
  let s4 = textureSampleLevel(historyIn, linSamp, vec2f(tc12.x, tc3.y), 0.0);

  let wt0 = w12.x * w0.y;
  let wt1 = w0.x * w12.y;
  let wt2 = w12.x * w12.y;
  let wt3 = w3.x * w12.y;
  let wt4 = w12.x * w3.y;
  let wtSum = max(wt0 + wt1 + wt2 + wt3 + wt4, 1e-4);

  let k0 = karisFwd(cleanRgb(s0.rgb));
  let k1 = karisFwd(cleanRgb(s1.rgb));
  let k2 = karisFwd(cleanRgb(s2.rgb));
  let k3 = karisFwd(cleanRgb(s3.rgb));
  let k4 = karisFwd(cleanRgb(s4.rgb));

  let bicubic = (k0 * wt0 + k1 * wt1 + k2 * wt2 + k3 * wt3 + k4 * wt4) / wtSum;
  // Confidence uses the central bilinear tap (no negative ringing on confidence).
  let conf = clamp(select(0.0, s2.a, s2.a >= 0.0 && s2.a <= 1.0), 0.0, 1.0);
  return vec4f(max(bicubic, vec3f(0.0)), conf);
}

// Unjittered 3x3 Karis-weighted Gaussian reconstruction for dynamic overlays (cars, people, wheels,
// water, puffs) that are rasterized without Halton jitter and tagged with velocity == (2.0, 2.0).
fn reconstructUnjittered(renderPos: vec2f, unjitCenterI: vec2i, renderMaxI: vec2i) -> vec3f {
  var unjitSum = vec3f(0.0);
  var unjitW = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let tc = clamp(unjitCenterI + vec2i(dx, dy), vec2i(0), renderMaxI);
      let cKaris = karisFwd(cleanRgb(textureLoad(colorTex, tc, 0).rgb));
      let dRenderU = (vec2f(tc) + 0.5) - renderPos;
      let wf = exp(-2.35 * dot(dRenderU, dRenderU));
      unjitSum += cKaris * wf;
      unjitW += wf;
    }
  }
  return karisInv(unjitSum / max(unjitW, 1e-5));
}

@compute @workgroup_size(8, 8)
fn cs_resolve(@builtin(global_invocation_id) gid: vec3u) {
  let outSizeF = params.outputInfo.xy;
  let outSizeI = vec2i(outSizeF);
  let px = vec2i(gid.xy);
  if (px.x >= outSizeI.x || px.y >= outSizeI.y) {
    return;
  }

  let invOut = params.outputInfo.zw;
  let curUV = (vec2f(px) + 0.5) * invOut;
  let renderSizeF = params.renderInfo.xy;
  let invRender = params.renderInfo.zw;
  let renderMaxI = vec2i(renderSizeF) - vec2i(1, 1);
  let jitter = params.jitterFlags.xy;
  let resetFlag = params.jitterFlags.w;

  // Unjittered pixel coordinate in render-res space, and nearest jittered render texel center.
  let renderPos = curUV * renderSizeF;
  let unjitCenterI = clamp(vec2i(floor(renderPos)), vec2i(0), renderMaxI);
  let scaleRatio = outSizeF * invRender;

  // Dynamic overlays (cars, people, wheels, water, puffs) are rasterized unjittered and tagged with
  // velocity == (2.0, 2.0) by march-trace.ts fs_patch_vel. Reconstruct them without Halton jitter
  // so they never vibrate by +/-0.5 render pixels per frame.
  let centerVel = textureLoad(velTex, unjitCenterI, 0).xy;
  if (centerVel.x > 1.5 && centerVel.y > 1.5) {
    textureStore(historyOut, px, vec4f(reconstructUnjittered(renderPos, unjitCenterI, renderMaxI), 0.01));
    return;
  }

  let centerI = clamp(vec2i(floor(renderPos - jitter)), vec2i(0), renderMaxI);

  // Single 3x3 render-space pass:
  //   - Closest-depth search for velocity dilation (0 = near, 1 = far).
  //   - Dual Karis-weighted spatial reconstruction:
  //       sharpSum   : tight output-space Gaussian (strong only on direct sub-pixel hits)
  //       fallbackSum: smooth render-space Gaussian (hole-free for frame 0 & disocclusions)
  //   - 3x3 YCoCg moments (m1, m2, boxMin, boxMax) for variance clipping.
  var closestDepth = 2.0;
  var closestCoord = centerI;

  var sharpSum = vec3f(0.0);
  var sharpW = 0.0;
  var fallbackSum = vec3f(0.0);
  var fallbackW = 0.0;

  var m1 = vec3f(0.0);
  var m2 = vec3f(0.0);
  var boxMin = vec3f(1e6);
  var boxMax = vec3f(-1e6);

  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let tc = clamp(centerI + vec2i(dx, dy), vec2i(0), renderMaxI);

      let d = textureLoad(depthTex, tc, 0);
      if (d < closestDepth) {
        closestDepth = d;
        closestCoord = tc;
      }

      let cRaw = cleanRgb(textureLoad(colorTex, tc, 0).rgb);
      let cKaris = karisFwd(cRaw);
      let cYcc = rgbToYCoCg(cKaris);

      m1 += cYcc;
      m2 += cYcc * cYcc;
      boxMin = min(boxMin, cYcc);
      boxMax = max(boxMax, cYcc);

      // Exact distance from this render texel's jittered sample to the current output pixel center.
      let dRender = (vec2f(tc) + 0.5 + jitter) - renderPos;
      let dOut = dRender * scaleRatio;
      let dist2Out = dot(dOut, dOut);
      let dist2Render = dot(dRender, dRender);

      // Tight output-pixel Gaussian (sigma ~ 0.43 output px) preserves native-res super-resolution.
      if (dist2Out < 3.2) {
        let ws = exp(-2.7 * dist2Out);
        sharpSum += cKaris * ws;
        sharpW += ws;
      }

      // Smooth render-space Gaussian (sigma ~ 0.46 render px) guarantees clean hole-free fallback.
      let wf = exp(-2.35 * dist2Render);
      fallbackSum += cKaris * wf;
      fallbackW += wf;
    }
  }

  let fallbackKaris = fallbackSum / max(fallbackW, 1e-5);
  let sharpKaris = select(fallbackKaris, sharpSum / max(sharpW, 1e-5), sharpW > 1e-4);
  let curKaris = mix(fallbackKaris, sharpKaris, smoothstep(0.02, 0.18, sharpW));

  // Dilated velocity at closest foreground depth (prevUV - curUV).
  let velRaw = textureLoad(velTex, closestCoord, 0).xy;
  if (velRaw.x > 1.5 && velRaw.y > 1.5) {
    // 1-pixel silhouette border around an unjittered dynamic overlay: reconstruct unjittered too.
    textureStore(historyOut, px, vec4f(reconstructUnjittered(renderPos, unjitCenterI, renderMaxI), 0.01));
    return;
  }
  let vel = select(vec2f(0.0), velRaw, abs(velRaw) < vec2f(10.0));
  let prevUV = curUV + vel;
  let velPx = length(vel * outSizeF);

  let offScreen = prevUV.x < 0.0 || prevUV.x > 1.0 || prevUV.y < 0.0 || prevUV.y > 1.0;

  // Max effective sample capacity scales slightly with upscaling ratio so sub-pixel hits converge cleanly.
  let upscaleArea = clamp(scaleRatio.x * scaleRatio.y, 1.0, 4.0);
  let maxSamples = mix(10.0, 14.0, clamp((upscaleArea - 1.0) / 3.0, 0.0, 1.0));

  if (resetFlag > 0.5 || offScreen) {
    // Use smooth render-space reconstruction on frame 0 / camera cuts / off-screen edges to avoid blocky aliasing,
    // while recording sub-pixel hit proximity in confidence so subsequent jittered hits lock onto native detail.
    let initConf = clamp(max(sharpW, 0.08) / maxSamples, 0.01, 1.0);
    textureStore(historyOut, px, vec4f(karisInv(fallbackKaris), initConf));
    return;
  }

  let hist = fetchHistoryBicubic(prevUV, outSizeF, params.capInfo.zw);
  let histConf = hist.a;
  if (histConf <= 0.001) {
    let initConf = clamp(max(sharpW, 0.08) / maxSamples, 0.01, 1.0);
    textureStore(historyOut, px, vec4f(karisInv(fallbackKaris), initConf));
    return;
  }

  // 3x3 YCoCg variance clipping: gamma ~ 1.25 static, tightening to 0.75 under fast motion.
  let mu = m1 * (1.0 / 9.0);
  let variance = max(m2 * (1.0 / 9.0) - mu * mu, vec3f(0.0));
  let sigma = sqrt(variance);
  let motionT = clamp(velPx * 0.16, 0.0, 1.0);
  let gamma = mix(1.25, 0.75, motionT);

  let clipMin = max(boxMin, mu - gamma * sigma);
  let clipMax = min(boxMax, mu + gamma * sigma);

  let histYcc = rgbToYCoCg(hist.rgb);
  let clipped = clipTowardMu(clipMin, clipMax, mu, histYcc);
  let clippedKaris = yCoCgToRgb(clipped.col);

  // Confidence-driven spatial-temporal accumulation:
  //   - Direct sub-pixel hits (high sharpW) accumulate strongly into native history.
  //   - Missed pixels (low sharpW while upscaling) preserve crisp converged history instead of blurring.
  //   - Motion & heavy variance clipping decay old confidence so disoccluded areas lock on rapidly.
  var hPrev = histConf * maxSamples;
  let motionCap = mix(maxSamples, 5.0, motionT);
  hPrev = min(hPrev, motionCap);
  hPrev *= (1.0 - 0.72 * clipped.amount);

  let upscaleT = smoothstep(1.02, 1.25, max(scaleRatio.x, scaleRatio.y));
  let baseFloor = mix(0.45, 0.015, upscaleT);
  let wFloor = mix(baseFloor, 0.42, max(motionT, clipped.amount));
  let wIn = max(sharpW, wFloor);

  let alpha = clamp(wIn / max(hPrev + wIn, 1e-4), 0.005, 1.0);
  let resolvedKaris = mix(clippedKaris, curKaris, alpha);
  let hNew = min(hPrev + wIn, maxSamples);

  textureStore(historyOut, px, vec4f(karisInv(resolvedKaris), clamp(hNew / maxSamples, 0.01, 1.0)));
}
`

const SHARPEN_WGSL = /* wgsl */ `
struct TaaParams {
  renderInfo: vec4f,
  allocInfo: vec4f,
  outputInfo: vec4f,
  capInfo: vec4f,
  jitterFlags: vec4f,
}

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var dstTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: TaaParams;

fn cleanRgb(c: vec3f) -> vec3f {
  let nonNeg = select(vec3f(0.0), c, c >= vec3f(0.0));
  return select(vec3f(65000.0), nonNeg, nonNeg <= vec3f(65000.0));
}

fn ycocgLuma(c: vec3f) -> f32 {
  return 0.25 * c.r + 0.5 * c.g + 0.25 * c.b;
}

fn karisFwd(c: vec3f) -> vec3f {
  return c / (1.0 + ycocgLuma(c));
}

fn karisInv(c: vec3f) -> vec3f {
  let clamped = max(c, vec3f(0.0));
  let l = min(ycocgLuma(clamped), 0.9995);
  return clamped / max(1.0 - l, 0.0005);
}

// Lightweight anti-ringing RCAS in Karis tone-mapped space.
// Clamping to the 5-tap cross [min5, max5] guarantees zero black halos around HDR emissive dots.
@compute @workgroup_size(8, 8)
fn cs_sharpen(@builtin(global_invocation_id) gid: vec3u) {
  let outSizeI = vec2i(params.outputInfo.xy);
  let px = vec2i(gid.xy);
  if (px.x >= outSizeI.x || px.y >= outSizeI.y) {
    return;
  }

  let maxPx = outSizeI - vec2i(1, 1);
  let sharpness = clamp(params.jitterFlags.z, 0.0, 1.0);

  let cLin = cleanRgb(textureLoad(srcTex, px, 0).rgb);
  let nLin = cleanRgb(textureLoad(srcTex, clamp(px + vec2i(0, -1), vec2i(0), maxPx), 0).rgb);
  let sLin = cleanRgb(textureLoad(srcTex, clamp(px + vec2i(0, 1), vec2i(0), maxPx), 0).rgb);
  let wLin = cleanRgb(textureLoad(srcTex, clamp(px + vec2i(-1, 0), vec2i(0), maxPx), 0).rgb);
  let eLin = cleanRgb(textureLoad(srcTex, clamp(px + vec2i(1, 0), vec2i(0), maxPx), 0).rgb);

  let c = karisFwd(cLin);
  let n = karisFwd(nLin);
  let s = karisFwd(sLin);
  let w = karisFwd(wLin);
  let e = karisFwd(eLin);

  let min5 = min(c, min(min(n, s), min(w, e)));
  let max5 = max(c, max(max(n, s), max(w, e)));

  let lC = ycocgLuma(c);
  let lN = ycocgLuma(n);
  let lS = ycocgLuma(s);
  let lW = ycocgLuma(w);
  let lE = ycocgLuma(e);

  let lMin = min(lC, min(min(lN, lS), min(lW, lE)));
  let lMax = max(lC, max(max(lN, lS), max(lW, lE)));

  // Adaptive lobe bounded so filter stays strictly stable and suppresses extreme contrast ringing.
  let limLo = lMin / max(4.0 * lMax, 1e-4);
  let limHi = (1.0 - lMax) / max(4.0 * (1.0 - lMin), 1e-4);
  let peak = -min(limLo, limHi);
  let lobe = max(peak, -0.1875) * sharpness;

  let sharpened = ((n + s + w + e) * lobe + c) / (1.0 + 4.0 * lobe);
  let safeKaris = clamp(sharpened, min5, max5);

  textureStore(dstTex, px, vec4f(karisInv(safeKaris), 1.0));
}
`

/**
 * Creates a persistent, zero-GC WebGPU Temporal Anti-Aliasing & Spatial-Temporal Upscaling pass.
 *
 * Persistent ping-pong `rgba16float` history textures are allocated once at `maxOutputSize` and
 * only grow if `input.outputSize` exceeds that capacity; dynamic `renderSize` changes never reallocate.
 */
export async function createTaa(
  device: GPUDevice,
  maxOutputSize: readonly [number, number],
): Promise<TaaPass> {
  const [resolveModule, sharpenModule] = await Promise.all([
    shader(device, 'taa-resolve', WGSL),
    shader(device, 'taa-sharpen', SHARPEN_WGSL),
  ])

  const resolveBindLayout = device.createBindGroupLayout({
    label: 'taa-resolve-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  })

  const sharpenBindLayout = device.createBindGroupLayout({
    label: 'taa-sharpen-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  })

  const [resolvePipeline, sharpenPipeline] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'taa-resolve',
      layout: device.createPipelineLayout({ bindGroupLayouts: [resolveBindLayout] }),
      compute: { module: resolveModule, entryPoint: 'cs_resolve' },
    }),
    device.createComputePipelineAsync({
      label: 'taa-sharpen',
      layout: device.createPipelineLayout({ bindGroupLayouts: [sharpenBindLayout] }),
      compute: { module: sharpenModule, entryPoint: 'cs_sharpen' },
    }),
  ])

  const sampler = device.createSampler({
    label: 'taa-linear',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })

  const uniformBuffer = device.createBuffer({
    label: 'taa-params',
    size: PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const uniformRaw = new ArrayBuffer(PARAMS_BYTES)
  const uniformF32 = new Float32Array(uniformRaw)

  let capW = Math.max(1, Math.round(maxOutputSize[0]))
  let capH = Math.max(1, Math.round(maxOutputSize[1]))

  const makeTarget = (label: string, w: number, h: number) =>
    device.createTexture({ label, size: [w, h], format: 'rgba16float', usage: HISTORY_USAGE })

  let histTex: [GPUTexture, GPUTexture] = [makeTarget('taa-hist-0', capW, capH), makeTarget('taa-hist-1', capW, capH)]
  let histView: [GPUTextureView, GPUTextureView] = [histTex[0].createView(), histTex[1].createView()]
  let sharpTex = makeTarget('taa-sharp', capW, capH)
  let sharpView = sharpTex.createView()

  const buildSharpenBinds = (): [GPUBindGroup, GPUBindGroup] => [
    device.createBindGroup({
      label: 'taa-sharpen-0',
      layout: sharpenBindLayout,
      entries: [
        { binding: 0, resource: histView[0] },
        { binding: 1, resource: sharpView },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    }),
    device.createBindGroup({
      label: 'taa-sharpen-1',
      layout: sharpenBindLayout,
      entries: [
        { binding: 0, resource: histView[1] },
        { binding: 1, resource: sharpView },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    }),
  ]
  let sharpBinds: [GPUBindGroup, GPUBindGroup] = buildSharpenBinds()

  // Cached resolve bind groups for ping=0 and ping=1 so steady-state frames allocate zero bind groups.
  let cachedColor: GPUTextureView | null = null
  let cachedDepth: GPUTextureView | null = null
  let cachedVelocity: GPUTextureView | null = null
  let resolveBinds: [GPUBindGroup, GPUBindGroup] | null = null

  let readIdx: 0 | 1 = 0
  let historyValid = false
  let reallocs = 0
  let frames = 0
  let resets = 0
  let lastOutW = 0
  let lastOutH = 0
  let lastRenderW = 0
  let lastRenderH = 0
  let lastTexture: GPUTexture = sharpTex
  let destroyed = false

  const ensureCapacity = (outW: number, outH: number) => {
    if (outW <= capW && outH <= capH) return
    capW = Math.max(capW, outW)
    capH = Math.max(capH, outH)
    histTex[0].destroy()
    histTex[1].destroy()
    sharpTex.destroy()
    histTex = [makeTarget('taa-hist-0', capW, capH), makeTarget('taa-hist-1', capW, capH)]
    histView = [histTex[0].createView(), histTex[1].createView()]
    sharpTex = makeTarget('taa-sharp', capW, capH)
    sharpView = sharpTex.createView()
    sharpBinds = buildSharpenBinds()
    resolveBinds = null
    cachedColor = null
    cachedDepth = null
    cachedVelocity = null
    historyValid = false
    reallocs++
  }

  const getResolveBinds = (color: GPUTextureView, depth: GPUTextureView, velocity: GPUTextureView): [GPUBindGroup, GPUBindGroup] => {
    if (resolveBinds && cachedColor === color && cachedDepth === depth && cachedVelocity === velocity) {
      return resolveBinds
    }
    cachedColor = color
    cachedDepth = depth
    cachedVelocity = velocity
    resolveBinds = [
      device.createBindGroup({
        label: 'taa-resolve-0to1',
        layout: resolveBindLayout,
        entries: [
          { binding: 0, resource: color },
          { binding: 1, resource: depth },
          { binding: 2, resource: velocity },
          { binding: 3, resource: histView[0] },
          { binding: 4, resource: histView[1] },
          { binding: 5, resource: sampler },
          { binding: 6, resource: { buffer: uniformBuffer } },
        ],
      }),
      device.createBindGroup({
        label: 'taa-resolve-1to0',
        layout: resolveBindLayout,
        entries: [
          { binding: 0, resource: color },
          { binding: 1, resource: depth },
          { binding: 2, resource: velocity },
          { binding: 3, resource: histView[1] },
          { binding: 4, resource: histView[0] },
          { binding: 5, resource: sampler },
          { binding: 6, resource: { buffer: uniformBuffer } },
        ],
      }),
    ]
    return resolveBinds
  }

  const self: TaaPass = {
    get texture() {
      return lastTexture
    },
    resolve(encoder, input, timing) {
      if (destroyed) throw new Error('TaaPass was destroyed')

      const outW = Math.max(1, Math.round(input.outputSize[0]))
      const outH = Math.max(1, Math.round(input.outputSize[1]))
      const allocW = Math.max(1, Math.round(input.allocSize[0]))
      const allocH = Math.max(1, Math.round(input.allocSize[1]))
      const renderW = Math.max(1, Math.min(allocW, Math.round(input.renderSize[0])))
      const renderH = Math.max(1, Math.min(allocH, Math.round(input.renderSize[1])))

      ensureCapacity(outW, outH)

      const sizeChanged = historyValid && (outW !== lastOutW || outH !== lastOutH)
      const doReset = !historyValid || !!input.reset || sizeChanged
      if (doReset) resets++

      const sharpness = Math.max(0, Math.min(1, input.sharpness ?? DEFAULT_SHARPNESS))

      uniformF32[0] = renderW
      uniformF32[1] = renderH
      uniformF32[2] = 1 / renderW
      uniformF32[3] = 1 / renderH
      uniformF32[4] = allocW
      uniformF32[5] = allocH
      uniformF32[6] = 1 / allocW
      uniformF32[7] = 1 / allocH
      uniformF32[8] = outW
      uniformF32[9] = outH
      uniformF32[10] = 1 / outW
      uniformF32[11] = 1 / outH
      uniformF32[12] = capW
      uniformF32[13] = capH
      uniformF32[14] = 1 / capW
      uniformF32[15] = 1 / capH
      uniformF32[16] = input.jitter[0]
      uniformF32[17] = input.jitter[1]
      uniformF32[18] = sharpness
      uniformF32[19] = doReset ? 1 : 0
      device.queue.writeBuffer(uniformBuffer, 0, uniformRaw)

      const binds = getResolveBinds(input.color, input.depth, input.velocity)
      const writeIdx: 0 | 1 = readIdx === 0 ? 1 : 0
      const groupsX = (outW + 7) >> 3
      const groupsY = (outH + 7) >> 3
      const useSharpen = sharpness > 1e-4

      const resolvePass = encoder.beginComputePass(
        timing
          ? {
              label: 'taa-resolve',
              timestampWrites: useSharpen
                ? { querySet: timing.querySet, beginningOfPassWriteIndex: timing.beginningOfPassWriteIndex }
                : timing,
            }
          : RESOLVE_PASS_DESC,
      )
      resolvePass.setPipeline(resolvePipeline)
      resolvePass.setBindGroup(0, binds[readIdx])
      resolvePass.dispatchWorkgroups(groupsX, groupsY)
      resolvePass.end()

      readIdx = writeIdx
      historyValid = true
      frames++
      lastOutW = outW
      lastOutH = outH
      lastRenderW = renderW
      lastRenderH = renderH

      if (!useSharpen) {
        lastTexture = histTex[writeIdx]
        return histView[writeIdx]
      }

      const sharpPass = encoder.beginComputePass(
        timing
          ? {
              label: 'taa-sharpen',
              timestampWrites: { querySet: timing.querySet, endOfPassWriteIndex: timing.endOfPassWriteIndex },
            }
          : SHARPEN_PASS_DESC,
      )
      sharpPass.setPipeline(sharpenPipeline)
      sharpPass.setBindGroup(0, sharpBinds[writeIdx])
      sharpPass.dispatchWorkgroups(groupsX, groupsY)
      sharpPass.end()

      lastTexture = sharpTex
      return sharpView
    },
    reset() {
      historyValid = false
    },
    stats() {
      return {
        reallocs,
        frames,
        resets,
        historyValid,
        capacity: [capW, capH],
        outputSize: [lastOutW, lastOutH],
        renderSize: [lastRenderW, lastRenderH],
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      histTex[0].destroy()
      histTex[1].destroy()
      sharpTex.destroy()
      uniformBuffer.destroy()
      resolveBinds = null
      cachedColor = null
      cachedDepth = null
      cachedVelocity = null
    },
  }

  return self
}
