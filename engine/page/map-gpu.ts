// WebGPU 3D Map & Minimap Renderer: shares the engine's existing GPUDevice (zero extra device overhead),
// renders with 4x MSAA, spatial 500 m chunk culling, stylized GTA VI terrain/coastline shallows,
// anti-aliased multi-tier vector roads, real 3D extruded SF buildings with architectural shading,
// and a glowing animated neon-pink GPS route ribbon + 3D destination beacon.
import { palette } from './march.ts'
import { TIER } from './bay.ts'
import type { MapData } from './nav-data.ts'
import type { GpsRoute } from './gps.ts'

export interface MapCamera {
  /** Target center on the ground plane in world metres (x east, z south). */
  cx: number
  cz: number
  /** Camera bearing in radians (0 = North up / -z up, +pi/2 = East up). */
  yaw: number
  /** Tilt from straight down in radians: 0 = flat 2D top-down, ~0.88 (50 deg) = GTA VI 3D chase view. */
  tilt: number
  /** Vertical half-span visible at the camera target in world metres (smaller = zoomed in). */
  span: number
  /** Style blend: 0 = sleek dark GTA VI 3D minimap, 1 = vibrant GTA VI cartographic fullscreen map. */
  style: number
  /** Vertical building extrusion factor (0.05..1.0). */
  extrude: number
  /** Screen vertical offset of target (-0.45..0.45, e.g., -0.22 places player in lower third of minimap). */
  targetOffsetY: number
  /** Player world metres (for camera-to-player skyscraper clearance tunnel on 3D minimap). */
  playerX: number
  playerZ: number
  /** Route progress in metres (trims/fades passed portion behind player on minimap). */
  routeAlong: number
  /** Fade-in distance ahead of player on minimap (metres; 0 on fullscreen map). */
  routeFadeLen: number
  /** Animation time in seconds. */
  time: number
  /** Active waypoint destination in world metres (if active). */
  destActive: boolean
  destX: number
  destZ: number
  /** Night ambience blend (0 = day, 1 = night). */
  night: number
}

interface ChunkRange {
  first: number
  count: number
  baseVertex: number
  x0: number
  z0: number
  x1: number
  z1: number
}

interface SurfaceState {
  canvas: HTMLCanvasElement
  context: GPUCanvasContext
  msaaTex: GPUTexture | null
  msaaView: GPUTextureView | null
  depthTex: GPUTexture | null
  depthView: GPUTextureView | null
  w: number
  h: number
}

const SAMPLE_COUNT = 4

// ── Matrix math (column-major Float32Array, WebGPU clip depth [0, 1]) ──
function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3]
    o[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3
  }
  return o
}

function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY * 0.5), nf = 1 / (near - far)
  const m = new Float32Array(16)
  m[0] = f / aspect
  m[5] = f
  m[10] = far * nf
  m[11] = -1
  m[14] = far * near * nf
  return m
}

function mat4LookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Float32Array {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2]
  const zl = Math.hypot(zx, zy, zz) || 1
  zx /= zl; zy /= zl; zz /= zl
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx
  const xl = Math.hypot(xx, xy, xz) || 1
  xx /= xl; xy /= xl; xz /= xl
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx
  const m = new Float32Array(16)
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2])
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2])
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2])
  m[15] = 1
  return m
}

/** Computes the exact view-projection matrix, eye position, and world-space forward/right vectors for a MapCamera. */
export function cameraMatrices(cam: MapCamera, aspect: number) {
  const fov = 36 * (Math.PI / 180)
  const tanHalf = Math.tan(fov * 0.5)
  const dist = Math.max(25, cam.span / tanHalf)
  const fx = Math.sin(cam.yaw), fz = -Math.cos(cam.yaw)
  const rx = Math.cos(cam.yaw), rz = Math.sin(cam.yaw)
  // Shift camera target slightly ahead of player when targetOffsetY < 0 so player sits cleanly in lower third!
  const ahead = -cam.targetOffsetY * cam.span * 1.15
  const tx = cam.cx + fx * ahead
  const tz = cam.cz + fz * ahead
  const tilt = Math.max(0.001, Math.min(1.12, cam.tilt))
  const sinT = Math.sin(tilt), cosT = Math.cos(tilt)
  const eye: [number, number, number] = [tx - fx * dist * sinT, dist * cosT, tz - fz * dist * sinT]
  const up: [number, number, number] = tilt < 0.05 ? [fx, 0, fz] : [0, 1, 0]
  const view = mat4LookAt(eye, [tx, 0, tz], up)
  const proj = mat4Perspective(fov, Math.max(0.2, aspect), Math.max(2, dist * 0.03), Math.max(12000, dist * 10))
  const vp = mat4Mul(proj, view)
  return { vp, eye, tx, tz, dist, fx, fz, rx, rz, fov }
}

/** Projects a world ground point (wx, wz, wy) to CSS pixel coordinates inside a canvas of (w, h), or null if behind eye. */
export function projectMapPoint(vp: Float32Array, wx: number, wy: number, wz: number, w: number, h: number): [number, number, number] | null {
  const cx = vp[0] * wx + vp[4] * wy + vp[8] * wz + vp[12]
  const cy = vp[1] * wx + vp[5] * wy + vp[9] * wz + vp[13]
  const cz = vp[2] * wx + vp[6] * wy + vp[10] * wz + vp[14]
  const cw = vp[3] * wx + vp[7] * wy + vp[11] * wz + vp[15]
  if (cw <= 0.1) return null
  const ndcX = cx / cw, ndcY = cy / cw
  return [(ndcX * 0.5 + 0.5) * w, (0.5 - ndcY * 0.5) * h, cz / cw]
}

/** Unprojects a CSS pixel (px, py) on the map canvas onto the ground plane y = 0 (world metres). */
export function unprojectToGround(cam: MapCamera, px: number, py: number, w: number, h: number): [number, number] | null {
  if (w <= 0 || h <= 0) return null
  const aspect = w / h
  const { eye, tx, tz, fov } = cameraMatrices(cam, aspect)
  const ndcX = (px / w) * 2 - 1
  const ndcY = 1 - (py / h) * 2
  const tanHalf = Math.tan(fov * 0.5)
  // Camera orthonormal basis matching mat4LookAt:
  let fvx = tx - eye[0], fvy = -eye[1], fvz = tz - eye[2]
  const fl = Math.hypot(fvx, fvy, fvz) || 1
  fvx /= fl; fvy /= fl; fvz /= fl
  const fx = Math.sin(cam.yaw), fz = -Math.cos(cam.yaw)
  const upRef: [number, number, number] = cam.tilt < 0.05 ? [fx, 0, fz] : [0, 1, 0]
  let rvx = fvy * upRef[2] - fvz * upRef[1], rvy = fvz * upRef[0] - fvx * upRef[2], rvz = fvx * upRef[1] - fvy * upRef[0]
  const rl = Math.hypot(rvx, rvy, rvz) || 1
  rvx /= rl; rvy /= rl; rvz /= rl
  const uvx = rvy * fvz - rvz * fvy, uvy = rvz * fvx - rvx * fvz, uvz = rvx * fvy - rvy * fvx
  const sx = ndcX * tanHalf * aspect, sy = ndcY * tanHalf
  const dx = fvx + rvx * sx + uvx * sy
  const dy = fvy + rvy * sx + uvy * sy
  const dz = fvz + rvz * sx + uvz * sy
  if (dy >= -1e-4) return null
  const t = -eye[1] / dy
  if (t <= 0 || t > 1e6) return null
  return [eye[0] + dx * t, eye[2] + dz * t]
}

// ── Simple robust ear-clipping triangulator for CCW 2D polygons in (x, z) ──
function earClip(xs: Float32Array, zs: Float32Array, first: number, count: number): number[] {
  const out: number[] = []
  if (count < 3) return out
  if (count === 3) return [0, 1, 2]
  if (count === 4) return [0, 1, 2, 0, 2, 3]
  const idx: number[] = []
  for (let i = 0; i < count; i++) idx.push(i)
  const px = (i: number) => xs[(first + i) * 2]
  const pz = (i: number) => zs[(first + i) * 2 + 1]
  const cross = (a: number, b: number, c: number) => (px(b) - px(a)) * (pz(c) - pz(a)) - (pz(b) - pz(a)) * (px(c) - px(a))
  const inTri = (p: number, a: number, b: number, c: number) => {
    const c1 = cross(a, b, p), c2 = cross(b, c, p), c3 = cross(c, a, p)
    return c1 >= -1e-4 && c2 >= -1e-4 && c3 >= -1e-4
  }
  let guard = count * count + 10
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false
    const n = idx.length
    for (let i = 0; i < n; i++) {
      const a = idx[(i + n - 1) % n], b = idx[i], c = idx[(i + 1) % n]
      if (cross(a, b, c) <= 1e-5) continue
      let clear = true
      for (let j = 0; j < n; j++) {
        const p = idx[j]
        if (p === a || p === b || p === c) continue
        if (inTri(p, a, b, c)) { clear = false; break }
      }
      if (clear) {
        out.push(a, b, c)
        idx.splice(i, 1)
        clipped = true
        break
      }
    }
    if (!clipped) {
      // Fallback fan on degenerate polygon so nothing drops out.
      for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0], idx[i], idx[i + 1])
      return out
    }
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2])
  return out
}

// ── WGSL Shaders ──
// Uniform struct (160 bytes, 16-byte aligned):
// vp: mat4x4f (0..64)
// bounds: vec4f (x0, z0, spanX, spanZ) (64..80)
// eyeStyle: vec4f (eyeX, eyeY, eyeZ, style) (80..96)
// player: vec4f (playerX, playerZ, extrude, time) (96..112)
// route: vec4f (routeAlong, routeFadeLen, span, night) (112..128)
// dest: vec4f (destX, destZ, destActive, zoomRoadScale) (128..144)
// extra: vec4f (rw, rh, yaw, tilt) (144..160)
const COMMON = /* wgsl */ `
struct U {
  vp: mat4x4f,
  bounds: vec4f,
  eyeStyle: vec4f,
  player: vec4f,
  route: vec4f,
  dest: vec4f,
  extra: vec4f,
}
@group(0) @binding(0) var<uniform> u: U;
`

const TERRAIN_WGSL = /* wgsl */ `
${COMMON}
@group(0) @binding(1) var rasterTex: texture_2d<f32>;
@group(0) @binding(2) var rasterSamp: sampler;

struct Out { @builtin(position) pos: vec4f, @location(0) wxz: vec2f }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> Out {
  let corners = array<vec2f, 6>(
    vec2f(-0.55, -0.55), vec2f(1.55, -0.55), vec2f(1.55, 1.55),
    vec2f(-0.55, -0.55), vec2f(1.55, 1.55), vec2f(-0.55, 1.55)
  );
  let uv = corners[vi];
  let wx = u.bounds.x + uv.x * u.bounds.z;
  let wz = u.bounds.y + uv.y * u.bounds.w;
  var out: Out;
  out.wxz = vec2f(wx, wz);
  out.pos = u.vp * vec4f(wx, 0.0, wz, 1.0);
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  let uv = (in.wxz - u.bounds.xy) / u.bounds.zw;
  let inBounds = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
  let uvClamped = clamp(uv, vec2f(0.0), vec2f(1.0));
  let style = u.eyeStyle.w;
  let night = u.route.w;
  let deepWaterMini = mix(vec3f(0.11, 0.28, 0.34), vec3f(0.07, 0.17, 0.22), night);
  let deepWaterFull = mix(vec3f(0.055, 0.34, 0.60), vec3f(0.035, 0.19, 0.36), night * 0.55);
  let deepWater = mix(deepWaterMini, deepWaterFull, style);

  // Sample unconditionally in uniform control flow (WGSL requirement).
  let s = textureSample(rasterTex, rasterSamp, uvClamped);
  let dx = vec2f(1.5 / max(u.extra.x, 1.0), 0.0);
  let dz = vec2f(0.0, 1.5 / max(u.extra.y, 1.0));
  let eL = textureSample(rasterTex, rasterSamp, clamp(uvClamped - dx, vec2f(0.0), vec2f(1.0))).a;
  let eR = textureSample(rasterTex, rasterSamp, clamp(uvClamped + dx, vec2f(0.0), vec2f(1.0))).a;
  let eU = textureSample(rasterTex, rasterSamp, clamp(uvClamped - dz, vec2f(0.0), vec2f(1.0))).a;
  let eD = textureSample(rasterTex, rasterSamp, clamp(uvClamped + dz, vec2f(0.0), vec2f(1.0))).a;

  if (!inBounds) {
    return vec4f(deepWater, 1.0);
  }
  // Channels packed in upload: R = landMask (0 water, 1 land), G = shoreDist (0 near shore .. 1 deep), B = greenPark (0..1), A = elev (0..1)
  let land = smoothstep(0.32, 0.68, s.r);
  let shore = s.g;
  let park = smoothstep(0.18, 0.72, s.b);

  // Compute crisp hillshade from elevation texture gradient.
  let nrm = normalize(vec3f((eL - eR) * 5.2, 0.32, (eU - eD) * 5.2));
  let shade = clamp(dot(nrm, normalize(vec3f(-0.6, 0.75, -0.45))) * 0.5 + 0.5, 0.0, 1.0);
  let hill = mix(0.89, 1.08, shade);

  // Water: GTA VI rich deep marine blue -> bright turquoise shallow coastal shelf -> crisp white shoreline foam!
  let midWaterMini = mix(vec3f(0.16, 0.38, 0.44), vec3f(0.10, 0.24, 0.29), night);
  let shalWaterMini = mix(vec3f(0.24, 0.50, 0.55), vec3f(0.15, 0.33, 0.38), night);
  let midWaterFull = mix(vec3f(0.09, 0.50, 0.72), vec3f(0.06, 0.31, 0.49), night * 0.55);
  let shalWaterFull = mix(vec3f(0.24, 0.80, 0.79), vec3f(0.13, 0.52, 0.56), night * 0.55);
  let foamFull = mix(vec3f(0.76, 0.94, 0.95), vec3f(0.42, 0.68, 0.74), night * 0.55);

  let midW = mix(midWaterMini, midWaterFull, style);
  let shalW = mix(shalWaterMini, shalWaterFull, style);
  var waterCol = mix(shalW, midW, smoothstep(0.0, 0.42, shore));
  waterCol = mix(waterCol, deepWater, smoothstep(0.32, 0.92, shore));
  // Subtle shoreline coastal glow & delicate ripple contour lines in fullscreen map.
  let foamBand = (1.0 - smoothstep(0.0, 0.14, shore)) * style;
  waterCol = mix(waterCol, foamFull, foamBand * 0.55);

  // Land: sleek dark-slate on minimap (Ref 1 & 2) vs clean GTA 6 illustrated urban-grey + sage parks on fullscreen (Ref 3)!
  let urbanMini = mix(vec3f(0.28, 0.31, 0.35), vec3f(0.19, 0.22, 0.26), night);
  let parkMini = mix(vec3f(0.22, 0.40, 0.34), vec3f(0.14, 0.28, 0.24), night);
  let urbanFull = mix(vec3f(0.74, 0.76, 0.80), vec3f(0.24, 0.27, 0.32), night * 0.6);
  let parkFull = mix(vec3f(0.57, 0.72, 0.58), vec3f(0.20, 0.35, 0.27), night * 0.6);
  let urban = mix(urbanMini, urbanFull, style);
  let parkCol = mix(parkMini, parkFull, style);
  var landCol = mix(urban, parkCol, park) * hill;
  // Subtle elevation warmth on high hills in fullscreen map.
  let elevNorm = clamp((s.a - 0.02) * 2.2, 0.0, 1.0);
  landCol *= mix(1.0, 1.06, elevNorm * style * 0.5);

  // Crisp subtle shoreline contour outline.
  let coastEdge = smoothstep(0.25, 0.5, s.r) * (1.0 - smoothstep(0.5, 0.76, s.r));
  var col = mix(waterCol, landCol, land);
  let rimCol = mix(vec3f(0.42, 0.52, 0.56), vec3f(0.86, 0.88, 0.84), style);
  col = mix(col, rimCol, coastEdge * mix(0.25, 0.45, style));
  return vec4f(col, 1.0);
}
`

// Roads shader: extruded quad strips with rounded end-caps, clean casing, and GTA VI warm gold arterial accents.
// Vertex layout (32 bytes/vert):
// loc 0: pos (vec2f) — endpoint world metres (x, z)
// loc 1: dir (vec2f) — unit direction along segment (tx, tz)
// loc 2: sideCap (vec2f) — x = side (-1 or +1), y = end (-1 at start, +1 at end)
// loc 3: meta (vec2f) — x = tier (0..3), y = lanes (1..4) + bridgeFlag*8
const ROAD_WGSL = /* wgsl */ `
${COMMON}
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) tier: f32,
  @location(2) @interpolate(flat) bridge: f32,
  @location(3) distAlong: f32,
}

@vertex fn vs(
  @location(0) p: vec2f,
  @location(1) dir: vec2f,
  @location(2) sideCap: vec2f,
  @location(3) roadInfo: vec2f,
) -> Out {
  let tier = roadInfo.x;
  let rawLanes = roadInfo.y;
  let bridge = step(6.0, rawLanes);
  let lanes = rawLanes - bridge * 8.0;
  let style = u.eyeStyle.w;
  let zoomScale = u.dest.w;

  // World half-width in metres: sleek GTA VI road proportions on both 3D minimap and cartographic fullscreen map.
  let baseMini = select(select(select(2.8, 4.4, tier > 0.5), 6.0, tier > 1.5), 7.6 + lanes * 0.65, tier > 2.5);
  let baseFull = select(select(select(1.4, 2.5, tier > 0.5), 4.1, tier > 1.5), 6.4 + lanes * 0.65, tier > 2.5);
  let hw = mix(baseMini, baseFull, style) * zoomScale;

  let perp = vec2f(-dir.y, dir.x);
  // Extend slightly past endpoints for rounded caps that join intersections cleanly with zero gaps!
  let worldXZ = p + perp * (sideCap.x * hw) + dir * (sideCap.y * hw * 0.92);
  // Layer higher-tier roads slightly above lower-tier roads so arterials cleanly draw over local streets.
  let y = 0.08 + tier * 0.05 + bridge * 0.14;
  var out: Out;
  out.pos = u.vp * vec4f(worldXZ.x, y, worldXZ.y, 1.0);
  out.uv = sideCap;
  out.tier = tier;
  out.bridge = bridge;
  out.distAlong = dot(worldXZ, dir);
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  let style = u.eyeStyle.w;
  let night = u.route.w;
  let across = abs(in.uv.x);
  // Fade subtle alleys when zoomed far out on fullscreen map so the city never turns noisy.
  let span = u.route.z;
  let alleyFade = select(1.0, 1.0 - smoothstep(750.0, 1600.0, span), in.tier < 0.5);
  let localFade = select(1.0, 1.0 - smoothstep(2600.0, 4200.0, span) * 0.55, in.tier < 1.5);
  let aa = max(fwidth(across), 0.04);
  let edgeAlpha = (1.0 - smoothstep(1.0 - aa, 1.0, across)) * alleyFade * localFade;
  if (edgeAlpha < 0.02) { discard; }

  // Minimap colors (Ref 1 & 2): sleek grey streets, lighter arterials, signature muted golden-sand major roads!
  let caseMini = mix(vec3f(0.20, 0.23, 0.27), vec3f(0.13, 0.15, 0.19), night);
  let fillLocalMini = mix(vec3f(0.47, 0.50, 0.54), vec3f(0.32, 0.35, 0.40), night);
  let fillArtMini = mix(vec3f(0.55, 0.57, 0.60), vec3f(0.39, 0.42, 0.46), night);
  let fillMajMini = mix(vec3f(0.64, 0.59, 0.44), vec3f(0.48, 0.44, 0.34), night);

  // Fullscreen map colors (Ref 3): refined dark casings, clean crisp light streets, warm golden-sand freeways & grand boulevards!
  let caseFull = mix(vec3f(0.24, 0.28, 0.34), vec3f(0.10, 0.12, 0.16), night * 0.5);
  let caseMajFull = mix(vec3f(0.12, 0.15, 0.20), vec3f(0.06, 0.08, 0.12), night * 0.5);
  let fillLocalFull = mix(vec3f(0.93, 0.94, 0.96), vec3f(0.36, 0.40, 0.46), night * 0.65);
  let fillArtFull = mix(vec3f(0.99, 0.98, 0.95), vec3f(0.48, 0.50, 0.54), night * 0.65);
  let fillMajFull = mix(vec3f(0.95, 0.85, 0.56), vec3f(0.64, 0.56, 0.38), night * 0.55);

  let casing = mix(caseMini, select(caseFull, caseMajFull, in.tier > 1.5), style);
  var fill = mix(fillLocalMini, fillLocalFull, style);
  if (in.tier > 2.5) {
    fill = mix(fillMajMini, fillMajFull, style);
  } else if (in.tier > 1.5) {
    fill = mix(fillArtMini, fillArtFull, style);
  }
  if (in.bridge > 0.5) {
    fill = mix(fill, mix(vec3f(0.70, 0.63, 0.48), vec3f(0.97, 0.83, 0.50), style), 0.5);
  }

  // Subtle dark road border casing (finer on local streets, crisp bold outline on arterials & highways like Ref 3!).
  let caseWidth = mix(0.84, select(0.78, 0.72, in.tier > 1.5), style);
  let inCase = smoothstep(caseWidth - aa, caseWidth + aa, across);
  let caseStrength = mix(0.58, select(0.62, 0.88, in.tier > 1.5), style);
  var col = mix(fill, casing, inCase * caseStrength);

  // Subtle center divider line on major roads in minimap view (like Ref 1 & 2!).
  if (in.tier > 1.5 && span < 650.0) {
    let centerLine = 1.0 - smoothstep(0.06, 0.12 + aa, across);
    let lineCol = mix(vec3f(0.72, 0.68, 0.52), vec3f(0.42, 0.45, 0.50), style);
    col = mix(col, lineCol, centerLine * (1.0 - style * 0.55) * 0.48);
  }
  return vec4f(col, edgeAlpha);
}
`

// 3D Extruded Buildings shader (GTA VI Ref Image 2 architectural look!).
// Compact 20-byte vertex layout (#83 — cuts GPU building VBO by 55%+ vs float32, lossless on XZ since map.bin stores u16):
// loc 0: posXZ (unorm16x2)      0..4    normalized [0..1] in u.bounds (x0..x0+spanX, z0..z0+spanZ)
// loc 1: heightUV (unorm16x4)   4..12   (y/512, totalH/512, along/2048, 0)
// loc 2: nrm4 (snorm8x4)       12..16   (nx, ny, nz, 0)
// loc 3: colFlags (unorm8x4)   16..20   (r, g, b, isGlass)
const BLDG_WGSL = /* wgsl */ `
${COMMON}
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) nrm: vec3f,
  @location(1) col: vec3f,
  @location(2) wallUV: vec2f, // x = along wall m, y = height m
  @location(3) @interpolate(flat) totalH: f32,
  @location(4) @interpolate(flat) isGlass: f32,
  @location(5) wxz: vec2f,
}

@vertex fn vs(
  @location(0) posXZ: vec2f,
  @location(1) heightUV: vec4f,
  @location(2) nrm4: vec4f,
  @location(3) colFlags: vec4f,
) -> Out {
  let extrude = u.player.z;
  let wx = u.bounds.x + posXZ.x * u.bounds.z;
  let wz = u.bounds.y + posXZ.y * u.bounds.w;
  let yLocal = heightUV.x * 512.0;
  let totalH = heightUV.y * 512.0;
  let along = heightUV.z * 2048.0;
  let isGlass = colFlags.a;
  let style = u.eyeStyle.w;

  // Smooth uniform height compression on the 3D minimap: every roof stays 100% level & flat (zero warping!),
  // mid-rise blocks stay architectural & readable (like Ref 2), and tall skyscrapers stand proud without blocking the road.
  let hSoft = select(yLocal, 44.0 * log(1.0 + yLocal / 44.0), style < 0.5);
  let y = hSoft * extrude;
  var out: Out;
  out.pos = u.vp * vec4f(wx, y, wz, 1.0);
  out.nrm = normalize(nrm4.xyz);
  out.col = colFlags.rgb;
  out.wallUV = vec2f(along, yLocal);
  out.totalH = max(totalH, 1.0);
  out.isGlass = isGlass;
  out.wxz = vec2f(wx, wz);
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  // Compute derivatives unconditionally in uniform control flow (WGSL requirement).
  let bayX = in.wallUV.x / 3.6;
  let floorY = in.wallUV.y / 3.4;
  let ax = max(fwidth(bayX), 0.02);
  let ay = max(fwidth(floorY), 0.02);

  let style = u.eyeStyle.w;
  let night = u.route.w;
  let isRoof = step(0.5, in.nrm.y);

  // Directional sunlit architectural shading (warm key light + crisp cool sky fill).
  let sunDir = normalize(vec3f(-0.55, 0.76, -0.35));
  let ndl = max(dot(in.nrm, sunDir), 0.0);
  let hemi = in.nrm.y * 0.5 + 0.5;
  let light = mix(0.50, 0.74, hemi) + ndl * 0.44;

  // Base architectural palette: warm sandstone/terracotta/slate-concrete like GTA VI Ref Image 2!
  var baseCol = in.col;
  if (isRoof > 0.5) {
    // Clean muted architectural rooftops (slightly cooler slate-grey/sandstone like Ref Image 2!).
    let roofMini = mix(vec3f(0.45, 0.48, 0.52), vec3f(0.30, 0.33, 0.38), night);
    let roofFull = mix(vec3f(0.84, 0.85, 0.88), vec3f(0.34, 0.38, 0.44), night * 0.58);
    let roofNeutral = mix(roofMini, roofFull, style);
    baseCol = mix(roofNeutral, baseCol * 0.88, mix(0.28, 0.22, style));
    // Subtle rooftop mechanical grid texture at close range.
    let rx = fract(in.wxz.x * 0.08);
    let rz = fract(in.wxz.y * 0.08);
    let mech = step(0.18, rx) * step(rx, 0.46) * step(0.22, rz) * step(rz, 0.52);
    let detailFade = 1.0 - smoothstep(220.0, 520.0, u.route.z);
    baseCol *= 1.0 - mech * 0.055 * detailFade;
  } else {
    // Vertical walls: subtle clean architectural window strips (Ref Image 2!) with fwidth anti-aliasing.
    let blur = smoothstep(0.25, 0.75, max(ax, ay));
    let fx = fract(bayX);
    let fy = fract(floorY);
    let winX = smoothstep(0.16 - ax, 0.16 + ax, fx) * (1.0 - smoothstep(0.84 - ax, 0.84 + ax, fx));
    let winY = smoothstep(0.24 - ay, 0.24 + ay, fy) * (1.0 - smoothstep(0.76 - ay, 0.76 + ay, fy));
    // Keep ground floor solid and cornice top clean.
    let validFloor = step(2.6, in.wallUV.y) * step(in.wallUV.y, in.totalH - 1.1);
    let pane = mix(winX * winY, 0.34, blur) * validFloor;
    let winColDay = select(vec3f(0.26, 0.34, 0.42), vec3f(0.34, 0.48, 0.60), in.isGlass > 0.5);
    let winColNight = select(vec3f(0.55, 0.50, 0.36), vec3f(0.45, 0.62, 0.74), in.isGlass > 0.5);
    let winCol = mix(winColDay, winColNight, night * 0.75);
    let winStrength = select(0.58, 0.78, in.isGlass > 0.5) * (1.0 - style * 0.35);
    baseCol = mix(baseCol, winCol, pane * winStrength);

    // Subtle ground contact ambient occlusion darkening at bottom 5 m of wall.
    let ao = mix(0.72, 1.0, smoothstep(0.0, 6.0, in.wallUV.y));
    // Crisp light parapet rim along top 0.9 m of each wall.
    let rim = smoothstep(in.totalH - 1.1, in.totalH - 0.1, in.wallUV.y);
    baseCol = baseCol * ao + vec3f(0.07) * rim;
  }

  var col = baseCol * light;
  // Subtle height-based atmospheric polish so skyscrapers stand out cleanly from mid-rise blocks.
  col = mix(col, col * 1.12 + vec3f(0.03, 0.035, 0.045), clamp(in.wallUV.y / 140.0, 0.0, 0.55));
  if (night > 0.01) {
    col *= mix(1.0, 0.72, night * (1.0 - style * 0.35));
  }
  return vec4f(col, 1.0);
}
`

// Glowing Neon Pink GPS Route Ribbon shader (GTA VI Ref Images 1 & 2!).
// Vertex layout (24 bytes/vert):
// loc 0: pos (vec2f) — world metres (x, z)
// loc 1: perp (vec2f) — unit perpendicular vector
// loc 2: uv (vec2f) — x = side (-1..+1), y = cumulative distance along route (metres)
const ROUTE_WGSL = /* wgsl */ `
${COMMON}
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex fn vs(
  @location(0) p: vec2f,
  @location(1) perp: vec2f,
  @location(2) uv: vec2f,
) -> Out {
  let style = u.eyeStyle.w;
  let zoomScale = u.dest.w;
  // Outer glow ribbon width: wider on fullscreen map so route pops across whole city!
  let hw = mix(5.8, 12.5, style) * zoomScale;
  let worldXZ = p + perp * (uv.x * hw);
  // Sit slightly above all roads (y = 0.55) so route never Z-fights!
  var out: Out;
  out.pos = u.vp * vec4f(worldXZ.x, 0.55, worldXZ.y, 1.0);
  out.uv = uv;
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  let style = u.eyeStyle.w;
  let along = in.uv.y;
  let playerAlong = u.route.x;
  let fadeLen = u.route.y;
  let time = u.player.w;

  // On minimap: cleanly trim everything behind player and softly fade in right ahead of the player arrow (Ref 1 & 2!).
  // On fullscreen map: show active route from player forward cleanly.
  let ahead = along - playerAlong;
  if (ahead < -2.0) { discard; }
  let startFade = select(smoothstep(-1.5, max(fadeLen, 1.0), ahead), smoothstep(-2.0, 4.0, ahead), style > 0.5);

  let d = abs(in.uv.x);
  // Dark magenta outer casing on fullscreen map for instant contrast over light streets; soft neon bloom on minimap!
  let core = 1.0 - smoothstep(0.14, 0.44, d);
  let body = 1.0 - smoothstep(0.42, 0.64, d);
  let glow = (1.0 - smoothstep(0.45, 1.0, d)) * 0.55;

  // Subtle animated energy pulse travelling toward destination.
  let wave = 0.5 + 0.5 * sin(along * 0.14 - time * 5.0);
  let hotCore = vec3f(1.0, 0.78, 0.90);
  let neonPink = vec3f(1.0, 0.17, 0.56);
  let deepPink = vec3f(0.84, 0.06, 0.42);
  let outlineFull = vec3f(0.42, 0.03, 0.22);

  var col = mix(deepPink, neonPink, body);
  col = mix(col, hotCore, core * (0.48 + 0.20 * wave));
  if (style > 0.5) {
    let ring = smoothstep(0.55, 0.72, d) * (1.0 - smoothstep(0.76, 0.95, d));
    col = mix(col, outlineFull, ring * 0.72);
  }
  let alpha = clamp(max(body, glow) * startFade, 0.0, 1.0);
  if (alpha < 0.015) { discard; }
  return vec4f(col, alpha);
}
`

// 3D Glowing Waypoint Beacon Ring + Vertical Beam at Destination (visible on 3D minimap & tilted map!).
const BEACON_WGSL = /* wgsl */ `
${COMMON}
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> Out {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0)
  );
  let c = corners[vi];
  let rad = mix(16.0, 34.0, u.eyeStyle.w) * u.dest.w;
  let wx = u.dest.x + c.x * rad;
  let wz = u.dest.y + c.y * rad;
  var out: Out;
  out.pos = u.vp * vec4f(wx, 0.75, wz, 1.0);
  out.local = c;
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  if (u.dest.z < 0.5) { discard; }
  let r = length(in.local);
  if (r > 1.0) { discard; }
  let pulse = fract(u.player.w * 0.85);
  let ring = smoothstep(pulse - 0.14, pulse, r) * (1.0 - smoothstep(pulse, pulse + 0.14, r)) * (1.0 - pulse);
  let dotFill = 1.0 - smoothstep(0.28, 0.38, r);
  let border = smoothstep(0.32, 0.42, r) * (1.0 - smoothstep(0.42, 0.50, r));
  let glow = (1.0 - smoothstep(0.25, 0.95, r)) * 0.45;
  var col = vec3f(1.0, 0.19, 0.58);
  col = mix(col, vec3f(1.0, 0.92, 0.96), border * 0.9 + dotFill * 0.25);
  let alpha = clamp(max(max(dotFill, border), max(ring * 0.85, glow)), 0.0, 1.0);
  return vec4f(col, alpha);
}
`

export class MapGpu {
  private device: GPUDevice
  private format: GPUTextureFormat
  private uniformBuf: GPUBuffer
  private uniformData = new Float32Array(40) // 160 bytes
  private sampler: GPUSampler
  private terrainPipe: GPURenderPipeline
  private roadPipe: GPURenderPipeline
  private bldgPipe: GPURenderPipeline
  private routePipe: GPURenderPipeline
  private beaconPipe: GPURenderPipeline
  private commonBind: GPUBindGroup
  private terrainBind: GPUBindGroup | null = null
  private rasterTex: GPUTexture | null = null

  private roadVBuf: GPUBuffer | null = null
  private roadIBuf: GPUBuffer | null = null
  private roadCount = 0

  private bldgVBuf: GPUBuffer | null = null
  private bldgIBuf: GPUBuffer | null = null
  private bldgChunks: ChunkRange[] = []

  private routeVBuf: GPUBuffer | null = null
  private routeIBuf: GPUBuffer | null = null
  private routeCount = 0

  private map: MapData | null = null
  private surfaces = new Map<HTMLCanvasElement, SurfaceState>()
  private pal = palette()
  private palSrgb = new Float32Array(256 * 3)

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device
    this.format = format
    for (let i = 0; i < 256; i++) {
      this.palSrgb[i * 3] = Math.pow(Math.max(0, this.pal[i * 4] || 0.45), 0.45)
      this.palSrgb[i * 3 + 1] = Math.pow(Math.max(0, this.pal[i * 4 + 1] || 0.40), 0.45)
      this.palSrgb[i * 3 + 2] = Math.pow(Math.max(0, this.pal[i * 4 + 2] || 0.36), 0.45)
    }
    this.uniformBuf = device.createBuffer({ label: 'map-uniforms', size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })

    const commonLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    })
    const terrainLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    })
    this.commonBind = device.createBindGroup({ layout: commonLayout, entries: [{ binding: 0, resource: { buffer: this.uniformBuf } }] })

    const blend: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    }
    const msaa = { count: SAMPLE_COUNT }
    const depthNoWrite: GPUDepthStencilState = { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' }
    const depthWrite: GPUDepthStencilState = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' }

    const tMod = device.createShaderModule({ label: 'map-terrain', code: TERRAIN_WGSL })
    this.terrainPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [terrainLayout] }),
      vertex: { module: tMod, entryPoint: 'vs' },
      fragment: { module: tMod, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: depthNoWrite,
      multisample: msaa,
    })

    const rMod = device.createShaderModule({ label: 'map-roads', code: ROAD_WGSL })
    this.roadPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [commonLayout] }),
      vertex: {
        module: rMod,
        entryPoint: 'vs',
        buffers: [{
          arrayStride: 32,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' },
            { shaderLocation: 2, offset: 16, format: 'float32x2' },
            { shaderLocation: 3, offset: 24, format: 'float32x2' },
          ],
        }],
      },
      fragment: { module: rMod, entryPoint: 'fs', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: depthNoWrite,
      multisample: msaa,
    })

    const bMod = device.createShaderModule({ label: 'map-bldgs', code: BLDG_WGSL })
    this.bldgPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [commonLayout] }),
      vertex: {
        module: bMod,
        entryPoint: 'vs',
        buffers: [{
          arrayStride: 20,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'unorm16x2' },
            { shaderLocation: 1, offset: 4, format: 'unorm16x4' },
            { shaderLocation: 2, offset: 12, format: 'snorm8x4' },
            { shaderLocation: 3, offset: 16, format: 'unorm8x4' },
          ],
        }],
      },
      fragment: { module: bMod, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthWrite,
      multisample: msaa,
    })

    const rtMod = device.createShaderModule({ label: 'map-route', code: ROUTE_WGSL })
    this.routePipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [commonLayout] }),
      vertex: {
        module: rtMod,
        entryPoint: 'vs',
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' },
            { shaderLocation: 2, offset: 16, format: 'float32x2' },
          ],
        }],
      },
      fragment: { module: rtMod, entryPoint: 'fs', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: depthNoWrite,
      multisample: msaa,
    })

    const bcMod = device.createShaderModule({ label: 'map-beacon', code: BEACON_WGSL })
    this.beaconPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [commonLayout] }),
      vertex: { module: bcMod, entryPoint: 'vs' },
      fragment: { module: bcMod, entryPoint: 'fs', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: depthNoWrite,
      multisample: msaa,
    })
  }

  /** Uploads a MapData's terrain texture, vector road mesh, and spatially-chunked 3D buildings to GPU buffers. */
  setMap(map: MapData) {
    this.map = map
    this.uploadRaster(map)
    this.uploadRoads(map)
    this.uploadBuildings(map)
  }

  private uploadRaster(map: MapData) {
    this.rasterTex?.destroy()
    const { rw, rh, raster } = map
    const rgba = new Uint8Array(rw * rh * 4)
    for (let i = 0; i < rw * rh; i++) {
      const b0 = raster[i * 2], b1 = raster[i * 2 + 1]
      const cls = b0 & 15, hi = (b0 >> 4) & 15
      rgba[i * 4] = cls === 0 ? 0 : 255 // R: land mask
      rgba[i * 4 + 1] = cls === 0 ? Math.round((hi / 15) * 255) : 0 // G: shore distance
      rgba[i * 4 + 2] = cls === 2 ? 255 : cls === 1 && hi > 5 ? 90 : 0 // B: park green
      rgba[i * 4 + 3] = b1 // A: elevation
    }
    this.rasterTex = this.device.createTexture({
      label: 'map-raster',
      size: [rw, rh],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.device.queue.writeTexture({ texture: this.rasterTex }, rgba, { bytesPerRow: rw * 4 }, [rw, rh])
    this.terrainBind = this.device.createBindGroup({
      layout: this.terrainPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: this.rasterTex.createView() },
        { binding: 2, resource: this.sampler },
      ],
    })
  }

  private uploadRoads(map: MapData) {
    this.roadVBuf?.destroy()
    this.roadIBuf?.destroy()
    const { nEdges, edgeA, edgeB, edgeFlags, nodes } = map
    if (nEdges === 0) { this.roadCount = 0; return }
    // Sort edges by tier ascending (0 -> 3) so major roads & bridges always draw cleanly on top of minor streets!
    const order = new Uint32Array(nEdges)
    for (let i = 0; i < nEdges; i++) order[i] = i
    order.sort((a, b) => {
      const ta = ((edgeFlags[a] >> 2) & 3) + (edgeFlags[a] & 64 ? 4 : 0)
      const tb = ((edgeFlags[b] >> 2) & 3) + (edgeFlags[b] & 64 ? 4 : 0)
      return ta - tb
    })
    const verts = new Float32Array(nEdges * 4 * 8)
    const idx = new Uint32Array(nEdges * 6)
    let vc = 0, ic = 0
    for (let k = 0; k < nEdges; k++) {
      const ei = order[k]
      const a = edgeA[ei], b = edgeB[ei]
      const ax = nodes[a * 2], az = nodes[a * 2 + 1], bx = nodes[b * 2], bz = nodes[b * 2 + 1]
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz)
      if (l < 0.2) continue
      const tx = dx / l, tz = dz / l
      const flags = edgeFlags[ei]
      const tier = (flags >> 2) & 3
      const lanes = ((flags >> 4) & 3) + 1 + (flags & 64 ? 8 : 0)
      const baseV = vc
      // 4 corners: (a, left), (a, right), (b, right), (b, left)
      const corners: [number, number, number, number][] = [
        [ax, az, -1, -1], [ax, az, 1, -1], [bx, bz, 1, 1], [bx, bz, -1, 1],
      ]
      for (const [px, pz, side, cap] of corners) {
        const o = vc * 8
        verts[o] = px; verts[o + 1] = pz; verts[o + 2] = tx; verts[o + 3] = tz
        verts[o + 4] = side; verts[o + 5] = cap; verts[o + 6] = tier; verts[o + 7] = lanes
        vc++
      }
      idx[ic++] = baseV; idx[ic++] = baseV + 1; idx[ic++] = baseV + 2
      idx[ic++] = baseV; idx[ic++] = baseV + 2; idx[ic++] = baseV + 3
    }
    this.roadCount = ic
    if (ic === 0) return
    const vSlice = verts.subarray(0, vc * 8), iSlice = idx.subarray(0, ic)
    this.roadVBuf = this.device.createBuffer({ label: 'map-roads-v', size: vSlice.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    this.roadIBuf = this.device.createBuffer({ label: 'map-roads-i', size: iSlice.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
    this.device.queue.writeBuffer(this.roadVBuf, 0, vSlice)
    this.device.queue.writeBuffer(this.roadIBuf, 0, iSlice)
  }

  private uploadBuildings(map: MapData) {
    this.bldgVBuf?.destroy()
    this.bldgIBuf?.destroy()
    this.bldgChunks = []
    const { nBldgs, bldgFirst, bldgCount, bldgColor, bldgFlags, bldgHeight, bldgVerts, x0, z0, spanX, spanZ } = map
    if (nBldgs === 0) return

    // Tier-aware simplification (#83): desktop keeps 100% lossless footprints. On phone/tablet, only simplify
    // compact, nearly axis-aligned rectangular low-rises (<= 32 m side, polygon area >= 75% of AABB) so angled piers
    // and L-shaped blocks keep their exact silhouettes without oversized boxes.
    const minH = TIER === 'phone' ? 4.5 : 0
    const boxBelow = TIER === 'phone' ? 14 : TIER === 'tablet' ? 10 : 0
    const canBox = new Uint8Array(nBldgs)
    const boxBounds = boxBelow > 0 ? new Float32Array(nBldgs * 4) : null

    // Group buildings into 500 m spatial chunks for fast frustum/distance culling on the minimap!
    const CHUNK = 500
    const buckets = new Map<string, number[]>()
    let totalVerts = 0, totalIdx = 0
    for (let i = 0; i < nBldgs; i++) {
      const f = bldgFirst[i], c = bldgCount[i]
      if (c < 3) continue
      const rawH = bldgHeight[i], isGlass = (bldgFlags[i] & 1) !== 0
      if (!isGlass && rawH < minH) continue
      let sx = 0, sz = 0
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (let k = 0; k < c; k++) {
        const vx = bldgVerts[(f + k) * 2], vz = bldgVerts[(f + k) * 2 + 1]
        sx += vx; sz += vz
        if (vx < minX) minX = vx
        if (vx > maxX) maxX = vx
        if (vz < minZ) minZ = vz
        if (vz > maxZ) maxZ = vz
      }
      let vcEff = c
      if (boxBounds && !isGlass && rawH < boxBelow && c > 4) {
        const bw = maxX - minX, bd = maxZ - minZ
        if (bw > 0.5 && bd > 0.5 && bw <= 32 && bd <= 32) {
          let area2 = 0
          for (let k = 0; k < c; k++) {
            const k2 = (k + 1) % c
            area2 += bldgVerts[(f + k) * 2] * bldgVerts[(f + k2) * 2 + 1] - bldgVerts[(f + k2) * 2] * bldgVerts[(f + k) * 2 + 1]
          }
          if (Math.abs(area2) * 0.5 >= bw * bd * 0.75) {
            canBox[i] = 1
            boxBounds[i * 4] = minX; boxBounds[i * 4 + 1] = maxX
            boxBounds[i * 4 + 2] = minZ; boxBounds[i * 4 + 3] = maxZ
            vcEff = 4
          }
        }
      }
      totalVerts += vcEff * 5 // 4 per wall edge + 1 per roof vertex
      totalIdx += vcEff * 6 + (vcEff - 2) * 3
      const cx = Math.floor(sx / c / CHUNK), cz = Math.floor(sz / c / CHUNK)
      const key = `${cx},${cz}`
      let list = buckets.get(key)
      if (!list) buckets.set(key, (list = []))
      list.push(i)
    }
    if (totalVerts === 0) return

    const vBuf = new ArrayBuffer(totalVerts * 20)
    const vU16 = new Uint16Array(vBuf)
    const vI8 = new Int8Array(vBuf)
    const vU8 = new Uint8Array(vBuf)
    // Chunk-local uint16 indices (+1 padding slot for 4-byte writeBuffer alignment).
    const iData = new Uint16Array(totalIdx + 1)
    let vc = 0, ic = 0

    const invSpanX = spanX > 0 ? 65535 / spanX : 0
    const invSpanZ = spanZ > 0 ? 65535 / spanZ : 0
    const H_SCALE = 65535 / 512
    const ALONG_SCALE = 65535 / 2048
    const boxXs = new Float32Array(4)
    const boxZs = new Float32Array(4)

    const pushV = (x: number, y: number, z: number, nx: number, ny: number, nz: number, rByte: number, gByte: number, bByte: number, glassByte: number, along: number, totalH: number) => {
      const o16 = vc * 10
      const px = Math.round((x - x0) * invSpanX)
      const pz = Math.round((z - z0) * invSpanZ)
      vU16[o16] = px < 0 ? 0 : px > 65535 ? 65535 : px
      vU16[o16 + 1] = pz < 0 ? 0 : pz > 65535 ? 65535 : pz
      const hy = Math.round(y * H_SCALE)
      const ht = Math.round(totalH * H_SCALE)
      const ha = Math.round((along % 2048) * ALONG_SCALE)
      vU16[o16 + 2] = hy < 0 ? 0 : hy > 65535 ? 65535 : hy
      vU16[o16 + 3] = ht < 0 ? 0 : ht > 65535 ? 65535 : ht
      vU16[o16 + 4] = ha < 0 ? 0 : ha > 65535 ? 65535 : ha
      vU16[o16 + 5] = 0
      const o8 = vc * 20
      vI8[o8 + 12] = Math.round(nx * 127)
      vI8[o8 + 13] = Math.round(ny * 127)
      vI8[o8 + 14] = Math.round(nz * 127)
      vI8[o8 + 15] = 0
      vU8[o8 + 16] = rByte
      vU8[o8 + 17] = gByte
      vU8[o8 + 18] = bByte
      vU8[o8 + 19] = glassByte
      return vc++
    }

    for (const [key, list] of buckets) {
      const [cx, cz] = key.split(',').map(Number)
      const bx0 = cx * CHUNK - 30, bz0 = cz * CHUNK - 30, bx1 = (cx + 1) * CHUNK + 30, bz1 = (cz + 1) * CHUNK + 30
      let chunkStart = ic, chunkBaseV = vc
      for (const bi of list) {
        const first = bldgFirst[bi], count = bldgCount[bi]
        if (count < 3) continue
        // Tasteful GTA VI architectural height: true scale up to 170 m, gently compressed past that so skyscrapers stay heroic without poking through the camera.
        const rawH = bldgHeight[bi]
        const h = rawH <= 140 ? rawH : 140 + (rawH - 140) * 0.45
        const isGlass = (bldgFlags[bi] & 1) !== 0
        const useBox = canBox[bi] === 1
        const effCount = useBox ? 4 : count
        if (vc - chunkBaseV + effCount * 5 > 65535) {
          if (ic > chunkStart) {
            this.bldgChunks.push({ first: chunkStart, count: ic - chunkStart, baseVertex: chunkBaseV, x0: bx0, z0: bz0, x1: bx1, z1: bz1 })
          }
          chunkStart = ic
          chunkBaseV = vc
        }
        const ci = bldgColor[bi] & 255
        // Blend real SF palette color (gamma-decoded back to gentle sRGB via precomputed LUT) with warm architectural sandstone/terracotta.
        const pr = this.palSrgb[ci * 3], pg = this.palSrgb[ci * 3 + 1], pb = this.palSrgb[ci * 3 + 2]
        const warmR = isGlass ? 0.62 : 0.78, warmG = isGlass ? 0.68 : 0.63, warmB = isGlass ? 0.74 : 0.54
        const rByte = Math.min(255, Math.round((warmR * 0.62 + pr * 0.38) * 255))
        const gByte = Math.min(255, Math.round((warmG * 0.62 + pg * 0.38) * 255))
        const bByte = Math.min(255, Math.round((warmB * 0.62 + pb * 0.38) * 255))
        const glassByte = isGlass ? 255 : 0

        if (useBox && boxBounds) {
          const minX = boxBounds[bi * 4], maxX = boxBounds[bi * 4 + 1]
          const minZ = boxBounds[bi * 4 + 2], maxZ = boxBounds[bi * 4 + 3]
          // CCW in (x, z) matching outward normal (dz, 0, -dx).
          boxXs[0] = minX; boxZs[0] = minZ
          boxXs[1] = maxX; boxZs[1] = minZ
          boxXs[2] = maxX; boxZs[2] = maxZ
          boxXs[3] = minX; boxZs[3] = maxZ
          let along = 0
          for (let k = 0; k < 4; k++) {
            const k2 = (k + 1) & 3
            const ax = boxXs[k], az = boxZs[k], bx = boxXs[k2], bz = boxZs[k2]
            const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz)
            if (len < 0.05) continue
            const nx = dz / len, nz = -dx / len
            const v0 = pushV(ax, 0, az, nx, 0, nz, rByte, gByte, bByte, glassByte, along, h) - chunkBaseV
            const v1 = pushV(bx, 0, bz, nx, 0, nz, rByte, gByte, bByte, glassByte, along + len, h) - chunkBaseV
            const v2 = pushV(bx, h, bz, nx, 0, nz, rByte, gByte, bByte, glassByte, along + len, h) - chunkBaseV
            const v3 = pushV(ax, h, az, nx, 0, nz, rByte, gByte, bByte, glassByte, along, h) - chunkBaseV
            iData[ic++] = v0; iData[ic++] = v1; iData[ic++] = v2
            iData[ic++] = v0; iData[ic++] = v2; iData[ic++] = v3
            along += len
          }
          const roofBase = vc - chunkBaseV
          for (let k = 0; k < 4; k++) pushV(boxXs[k], h, boxZs[k], 0, 1, 0, rByte, gByte, bByte, glassByte, 0, h)
          iData[ic++] = roofBase; iData[ic++] = roofBase + 1; iData[ic++] = roofBase + 2
          iData[ic++] = roofBase; iData[ic++] = roofBase + 2; iData[ic++] = roofBase + 3
        } else {
          // Extruded vertical walls (4 verts per edge, flat normal for crisp edges!).
          let along = 0
          for (let k = 0; k < count; k++) {
            const k2 = (k + 1) % count
            const ax = bldgVerts[(first + k) * 2], az = bldgVerts[(first + k) * 2 + 1]
            const bx = bldgVerts[(first + k2) * 2], bz = bldgVerts[(first + k2) * 2 + 1]
            const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz)
            if (len < 0.05) continue
            // For CCW in (x, z), outward normal is (dz, 0, -dx) / len.
            const nx = dz / len, nz = -dx / len
            const v0 = pushV(ax, 0, az, nx, 0, nz, rByte, gByte, bByte, glassByte, along, h) - chunkBaseV
            const v1 = pushV(bx, 0, bz, nx, 0, nz, rByte, gByte, bByte, glassByte, along + len, h) - chunkBaseV
            const v2 = pushV(bx, h, bz, nx, 0, nz, rByte, gByte, bByte, glassByte, along + len, h) - chunkBaseV
            const v3 = pushV(ax, h, az, nx, 0, nz, rByte, gByte, bByte, glassByte, along, h) - chunkBaseV
            iData[ic++] = v0; iData[ic++] = v1; iData[ic++] = v2
            iData[ic++] = v0; iData[ic++] = v2; iData[ic++] = v3
            along += len
          }

          // Roof cap via ear-clipping.
          const roofBase = vc - chunkBaseV
          for (let k = 0; k < count; k++) {
            const rx = bldgVerts[(first + k) * 2], rz = bldgVerts[(first + k) * 2 + 1]
            pushV(rx, h, rz, 0, 1, 0, rByte, gByte, bByte, glassByte, 0, h)
          }
          const tris = earClip(bldgVerts, bldgVerts, first, count)
          for (let t = 0; t < tris.length; t++) iData[ic++] = roofBase + tris[t]
        }
      }
      if (ic > chunkStart) {
        this.bldgChunks.push({ first: chunkStart, count: ic - chunkStart, baseVertex: chunkBaseV, x0: bx0, z0: bz0, x1: bx1, z1: bz1 })
      }
    }

    if (ic === 0) return
    const vByteLen = vc * 20
    const iSlice = iData.subarray(0, (ic + 1) & ~1)
    this.bldgVBuf = this.device.createBuffer({ label: 'map-bldgs-v', size: vByteLen, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    this.bldgIBuf = this.device.createBuffer({ label: 'map-bldgs-i', size: iSlice.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
    this.device.queue.writeBuffer(this.bldgVBuf, 0, vBuf, 0, vByteLen)
    this.device.queue.writeBuffer(this.bldgIBuf, 0, iSlice)
  }

  /** Uploads a smooth mitered neon-pink GPS route ribbon mesh to the GPU. */
  setRoute(route: GpsRoute | null) {
    this.routeVBuf?.destroy(); this.routeVBuf = null
    this.routeIBuf?.destroy(); this.routeIBuf = null
    this.routeCount = 0
    if (!route || route.cum.length < 2) return

    const { points, cum } = route
    const n = cum.length
    const verts = new Float32Array(n * 2 * 6) // 2 verts/point, 6 floats/vert (24 bytes)
    const idx = new Uint32Array((n - 1) * 6)
    for (let i = 0; i < n; i++) {
      const px = points[i * 2], pz = points[i * 2 + 1]
      let nx = 0, nz = 0
      if (i > 0) {
        const dx = px - points[(i - 1) * 2], dz = pz - points[(i - 1) * 2 + 1], l = Math.hypot(dx, dz) || 1
        nx += -dz / l; nz += dx / l
      }
      if (i + 1 < n) {
        const dx = points[(i + 1) * 2] - px, dz = points[(i + 1) * 2 + 1] - pz, l = Math.hypot(dx, dz) || 1
        nx += -dz / l; nz += dx / l
      }
      const nl = Math.hypot(nx, nz) || 1
      nx /= nl; nz /= nl
      // Gentle miter compensation capped at 1.24x so tight turns stay smooth with zero spikes!
      let miter = 1
      if (i > 0 && i + 1 < n) {
        const dx = points[(i + 1) * 2] - px, dz = points[(i + 1) * 2 + 1] - pz, l = Math.hypot(dx, dz) || 1
        const dotP = Math.abs(nx * (-dz / l) + nz * (dx / l))
        miter = Math.min(1.24, 1 / Math.max(0.65, dotP))
      }
      const mx = nx * miter, mz = nz * miter, c = cum[i]
      const o0 = (i * 2) * 6, o1 = (i * 2 + 1) * 6
      verts[o0] = px; verts[o0 + 1] = pz; verts[o0 + 2] = mx; verts[o0 + 3] = mz; verts[o0 + 4] = -1; verts[o0 + 5] = c
      verts[o1] = px; verts[o1 + 1] = pz; verts[o1 + 2] = mx; verts[o1 + 3] = mz; verts[o1 + 4] = 1; verts[o1 + 5] = c
    }
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3
      idx[i * 6] = a; idx[i * 6 + 1] = b; idx[i * 6 + 2] = d
      idx[i * 6 + 3] = a; idx[i * 6 + 4] = d; idx[i * 6 + 5] = c
    }
    this.routeCount = idx.length
    this.routeVBuf = this.device.createBuffer({ label: 'map-route-v', size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    this.routeIBuf = this.device.createBuffer({ label: 'map-route-i', size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
    this.device.queue.writeBuffer(this.routeVBuf, 0, verts)
    this.device.queue.writeBuffer(this.routeIBuf, 0, idx)
  }

  private surface(canvas: HTMLCanvasElement, w: number, h: number): SurfaceState | null {
    let s = this.surfaces.get(canvas)
    if (!s) {
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      const context = canvas.getContext('webgpu')
      if (!context) return null
      context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' })
      s = { canvas, context, msaaTex: null, msaaView: null, depthTex: null, depthView: null, w: 0, h: 0 }
      this.surfaces.set(canvas, s)
    }
    if (canvas.width !== w || canvas.height !== h || s.w !== w || s.h !== h) {
      canvas.width = w; canvas.height = h
      s.w = w; s.h = h
      s.msaaTex?.destroy(); s.depthTex?.destroy()
      s.msaaTex = this.device.createTexture({ label: 'map-msaa', size: [w, h], sampleCount: SAMPLE_COUNT, format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT })
      s.msaaView = s.msaaTex.createView()
      s.depthTex = this.device.createTexture({ label: 'map-depth', size: [w, h], sampleCount: SAMPLE_COUNT, format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT })
      s.depthView = s.depthTex.createView()
    }
    return s
  }

  /** Renders one frame to `canvas` (physical pixels `w x h`) with `cam`. Returns the view-projection matrix for 2D overlay alignment. */
  render(canvas: HTMLCanvasElement, w: number, h: number, cam: MapCamera): Float32Array | null {
    if (!this.map || !this.terrainBind || w < 2 || h < 2) return null
    const surf = this.surface(canvas, w, h)
    if (!surf || !surf.msaaView || !surf.depthView) return null

    const aspect = w / h
    const { vp, eye, tx, tz } = cameraMatrices(cam, aspect)
    // Scale road & route widths gracefully with zoom span so lines remain razor-crisp from 120 m up to 4000 m!
    const zoomRoadScale = cam.style < 0.5
      ? Math.max(0.85, Math.min(1.85, Math.pow(cam.span / 150, 0.42)))
      : Math.max(0.55, Math.min(2.5, Math.pow(cam.span / 450, 0.46)))

    const u = this.uniformData
    u.set(vp, 0)
    u[16] = this.map.x0; u[17] = this.map.z0; u[18] = this.map.spanX; u[19] = this.map.spanZ
    u[20] = eye[0]; u[21] = eye[1]; u[22] = eye[2]; u[23] = cam.style
    u[24] = cam.playerX; u[25] = cam.playerZ; u[26] = cam.extrude; u[27] = cam.time
    u[28] = cam.routeAlong; u[29] = cam.routeFadeLen; u[30] = cam.span; u[31] = cam.night
    u[32] = cam.destX; u[33] = cam.destZ; u[34] = cam.destActive ? 1 : 0; u[35] = zoomRoadScale
    u[36] = this.map.rw; u[37] = this.map.rh; u[38] = cam.yaw; u[39] = cam.tilt
    this.device.queue.writeBuffer(this.uniformBuf, 0, u)

    const enc = this.device.createCommandEncoder({ label: 'map-render' })
    const clearCol = cam.style < 0.5
      ? { r: 0.11, g: 0.28, b: 0.34, a: 1 }
      : { r: 0.055, g: 0.34, b: 0.60, a: 1 }
    const pass = enc.beginRenderPass({
      label: 'map-pass',
      colorAttachments: [{
        view: surf.msaaView,
        resolveTarget: surf.context.getCurrentTexture().createView(),
        clearValue: clearCol,
        loadOp: 'clear',
        storeOp: 'discard',
      }],
      depthStencilAttachment: {
        view: surf.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    })

    // 1. Stylized Terrain, Parks, Coastline & Shallow Turquoise Water
    pass.setPipeline(this.terrainPipe)
    pass.setBindGroup(0, this.terrainBind)
    pass.draw(6)

    // 2. Layered Vector Road Network
    if (this.roadVBuf && this.roadIBuf && this.roadCount > 0) {
      pass.setPipeline(this.roadPipe)
      pass.setBindGroup(0, this.commonBind)
      pass.setVertexBuffer(0, this.roadVBuf)
      pass.setIndexBuffer(this.roadIBuf, 'uint32')
      pass.drawIndexed(this.roadCount)
    }

    // 3. Glowing Neon Pink GPS Route Ribbon
    if (this.routeVBuf && this.routeIBuf && this.routeCount > 0) {
      pass.setPipeline(this.routePipe)
      pass.setBindGroup(0, this.commonBind)
      pass.setVertexBuffer(0, this.routeVBuf)
      pass.setIndexBuffer(this.routeIBuf, 'uint32')
      pass.drawIndexed(this.routeCount)
    }

    // 4. 3D Destination Beacon Ring
    if (cam.destActive) {
      pass.setPipeline(this.beaconPipe)
      pass.setBindGroup(0, this.commonBind)
      pass.draw(6)
    }

    // 5. Spatially-Culled 3D Extruded Buildings
    if (this.bldgVBuf && this.bldgIBuf && this.bldgChunks.length > 0 && cam.extrude > 0.01) {
      // Conservative ground visibility radius around camera target for fast chunk culling.
      const cullR = cam.span * Math.max(aspect, 1) * (cam.tilt > 0.3 ? 3.2 : 1.7) + 450
      pass.setPipeline(this.bldgPipe)
      pass.setBindGroup(0, this.commonBind)
      pass.setVertexBuffer(0, this.bldgVBuf)
      pass.setIndexBuffer(this.bldgIBuf, 'uint16')
      for (const ch of this.bldgChunks) {
        if (ch.x1 < tx - cullR || ch.x0 > tx + cullR || ch.z1 < tz - cullR || ch.z0 > tz + cullR) continue
        pass.drawIndexed(ch.count, 1, ch.first, ch.baseVertex)
      }
    }

    pass.end()
    this.device.queue.submit([enc.finish()])
    return vp
  }

  /** Frees GPU attachments & swapchain textures for a canvas when hidden or removed (#83). */
  release(canvas: HTMLCanvasElement) {
    const s = this.surfaces.get(canvas)
    if (!s) return
    s.msaaTex?.destroy()
    s.depthTex?.destroy()
    s.context.unconfigure()
    canvas.width = 1
    canvas.height = 1
    this.surfaces.delete(canvas)
  }
}
