// The Cleave (#226): a line of light is drawn across the world, and everything it crossed comes apart along it.
// After Small Magic's cleave.js (MIT), its gesture, its numbers and its beats kept; lengths are this world's finest
// cells (10 to the metre).
//
// A press takes the point out: the world all but stops, the view is held and opens wide, dark at its edges, and the
// point (a glint of light) is free to be carried anywhere over it. Pressed again and held, it draws: a seam of gold
// light is opened from where the point is to where it is carried. Let go, and the cut is the flat sheet through the
// eye and both ends of the seam: what was drawn across on the screen is exactly what is cut.
//
// The instant is the spell. The circle is written round the view; the seam flares and is written over with runes;
// the day goes to indigo and gold, and light spills from the line; then the dark, in which the picture itself is
// parted along the line, slivers of gold thrown from it; and the day comes back through gold. Only then does time
// come back: the circle's rims go out in the cut's own sheet, a shell of bending air with them, a glowing seam on
// every cut face, and what was above the cut is thrown up off it. Each beat is held for whole thirtieths of a
// second: the holding is its weight.
//
// What is here: the gesture and its clock (`step`), the seam and the point drawn in the world (`draw`), and what the
// last pass is told (`postFx`, glow.ts). What the cut does to the world is its caller's: `step` hands the sheet back
// once (`executeCut`), for the mover's `cleave` ask.
import { shader, type Gpu, type Target } from '../probe/gpu.ts'
import { runeAtlas, type PostFx } from './glow.ts'
import type { Mode } from './input.ts'
import type { View } from './march.ts'

type V3 = [number, number, number]

/** Cells in a metre. */
const M = 10
// How far it reaches, how far before the eye the stroke is laid (cells), and half the breadth of the seam's ribbon
// there (as a share of that distance: its light is the middle third, the rest its glow and a rim of shade).
const REACH = 95 * M, LAY = 6 * M, INK = 0.078
/** The shortest stroke that cuts (radians). Anything less is let go of. */
const SHORTEST = 0.07
// The instant, in beats of whole thirtieths of a second, in seconds of real time from letting go:
//   0-2    a charge runs the length of the seam; the circle is written round the view; runes are written behind the charge
//   3-4    the day in two colours, indigo and gold, frozen; light spills from the line, wider on the second. The cut is made.
//   5      a blink of light: all that is dark in indigo
//   6-9    the dark: the world in indigo, edged in gold, parted along the line, further each frame; slivers of gold
//   10     a blink of light again
//   11-12  the day comes back through gold, its halves closing
//   then the world is held a frame more, and comes back slowly; the rings go out from frame 14.
const F = 1 / 30
const T = { write: 3 * F, duo: 5 * F, flash: 6 * F, dark: 10 * F, flash2: 11 * F, back: 13 * F, still: 14 * F, rings: 14 * F }
// How long the seam glows (s: full while what was cut hangs above it, then out in SEAM_OUT), its half breadth (cells), how long the rings go out (s), and how long they stand before they burst.
const SEAM = 1.2, SEAM_OUT = 0.45, SEAM_W = 0.07 * M, RINGS = 0.9, RING_HOLD = 0.1
// Time while it is aimed and drawn goes at SLOW of itself; after the cut the world is all but stopped (AFTER) while
// what was cut hangs in the air, HANG seconds, and comes back over BACK seconds.
const SLOW = 0.05, AFTER = 0.16, HANG = 0.8, BACK = 0.45
// The view opens by WIDE degrees while it is aimed, and after the cut is PUNCH degrees narrower than it should be, easing back.
const WIDE = 14, PUNCH = 15
/** How far the blast of air the rings are goes over the ground before it is spent (cells). */
const WIND_FAR = 190 * M
/** Pieces of the ribbon along its length. */
const N = 64

export type CleavePhase = 'idle' | 'aim' | 'draw' | 'strike'
/** The cut: the flat sheet through `eye`, facing `normal` (up, so that what is above it is what slides), across the wedge from `e1` turned `theta` radians towards `e2`, out to `reach` cells; and the way what is above it goes. What the mover's `cleave` ask takes. */
export interface CleaveCut { eye: V3; normal: V3; e1: V3; e2: V3; theta: number; reach: number; slide: V3 }
export interface CleaveStep {
  /** How fast the world goes: all but stopped while it is aimed, stopped for the instant, eased back after. */
  timeScale: number
  /** Degrees to add to the view's own: wide while it is aimed, punched narrow after the cut. */
  fovDelta: number
  /** How the eye is turned by the blows (pitch, yaw, roll; radians), moved to a new place 30 times a second. */
  jolt: readonly [number, number, number]
  /** How hard the ground shakes under the eye as the blast of air arrives, for whoever shakes the view. */
  shake: number
  phase: CleavePhase
  /** Aimed or being drawn: the view is to be held still (the look moves the point, through `steer`). */
  locked: boolean
  /** How far the stroke is drawn, 0 to 1, for a bar or a hand. */
  charge: number
  /** What was cut still hangs in the air: the mover's `hang` ask is owed each frame, by the wall's clock. */
  hanging: boolean
  /** The frame the cut is made, once: the sheet to cut the world along. */
  executeCut?: CleaveCut
}
export interface CleaveOptions {
  /** The cut is made (the same frame `step` hands it back). */
  onCut?(cut: CleaveCut): void
  /** What is to be heard (sound/world.ts `cleave`): 'aim', 'draw' (again as the stroke lengthens: `intensity` is its span), 'cancel', 'strike' as it is let go, 'hit' as the cut lands (`intensity`: `stats.much`). */
  onCue?(what: 'aim' | 'draw' | 'cancel' | 'strike' | 'hit', intensity: number): void
  /** How far off the first thing along a way from the eye is (cells), or null for nothing within reach: the rings go out round the middle of the cut, as far off as what it struck there. */
  probe?(eye: Readonly<V3>, dir: Readonly<V3>, reach: number): number | null
  /** How far the cut reaches from the eye (cells): 95 m unless told. The seam on the cut faces goes as far. */
  reach?: number
}
export interface Cleave {
  readonly phase: CleavePhase
  readonly busy: boolean
  /** Aimed or being drawn: the view is held, and the look and the stick move the point. */
  readonly locked: boolean
  /** The button going down: the first takes the point out, the second begins the stroke. True if it was taken. */
  pointerDown(): boolean
  /** The button coming up: the stroke is let go, and cuts if enough was drawn. True if it was taken. */
  pointerUp(): boolean
  /** One press with no release of its own (a pad's button, a thumb): point out, then begin the stroke, then let go. */
  tap(): void
  /** While it is aimed or drawn the look moves the point, not the view (radians: right, up). True: the view is to stay still. */
  steer(dx: number, dy: number): boolean
  /** Put away while it is aimed or drawn (a right click, Escape, another tool taken): nothing comes of it. */
  cancel(): void
  /** Nothing of it is left: the point put away, the seam gone out, its rings gone. */
  clear(): void
  /** Each frame, by the wall's clock, whatever is in hand. `view` (and the picture's width over its height) is the camera this frame. */
  step(realDt: number, view?: View, aspect?: number): CleaveStep
  /** The seam and the point, drawn into the picture over everything (before the last pass). */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, realT: number): void
  /** Fills the Cleave's own part of what the last pass is told (glow.ts): every frame, so that it also goes out. */
  postFx(out: PostFx): void
  /** Draws a stroke from one way to another and lets go, as a player would: for the checks and for `engine.cut()`. */
  strike(eye: Readonly<V3>, fromDir: Readonly<V3>, toDir: Readonly<V3>): void
  /** A mode for page/input.ts: the press, its release, the look, a right click and Escape, while the Cleave is in hand. */
  mode(): Mode
  /** How many cuts were made, how much the last one cut (0 to 1: its caller says, before the cut lands four frames on; it is how hard the hit sounds), and the last sheet. */
  stats: { cuts: number; much: number; last: CleaveCut | null }
}

const CODE = /* wgsl */ `
struct U {
  fwd: vec4f,    // the eye's forward; tan of half the view's height
  right: vec4f,  // its right; width over height
  up: vec4f,     // its up; the clock (s)
  ink: vec4f,    // the seam: how much of it is there, its seed, how far the runes are written, where the charge is (-1 none)
  more: vec4f,   // how many runes along it; the point: how bright, how far turned, its size (cells)
  glint: vec4f,  // where the point is, from the eye (cells)
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smooth_: sampler;
@group(0) @binding(2) var runes: texture_2d<f32>;

// A place from the eye, as the picture has it. Nothing here is hidden by anything: it is drawn over the world.
fn seen(p: vec3f) -> vec4f {
  let z = dot(p, u.fwd.xyz);
  return vec4f(dot(p, u.right.xyz) / (u.fwd.w * u.right.w), dot(p, u.up.xyz) / u.fwd.w, 0.5 * z, z);
}
struct Lit { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex fn ribbonVs(@location(0) pos: vec3f, @location(1) uv: vec2f) -> Lit {
  var out: Lit;
  out.pos = seen(pos);
  out.uv = uv;
  return out;
}
// The stroke is a seam of light, as if the air had been opened: white at its heart, gold about it, pointed where it
// began and fullest at the point, with a shimmer running along it and beads of light toward the point; outside it a
// rim of shade, so that it is read against a bright day as well as a dark wall. Let go, a charge runs the length of
// it and it is written over with runes, end to end.
@fragment fn ribbonFs(in: Lit) -> @location(0) vec4f {
  let x = in.uv.x;
  let a = abs(in.uv.y);
  let time = u.up.w;
  let seed = u.ink.y;
  let flare = u.ink.z;
  let surge = u.ink.w;
  let body = mix(0.08, 1.0, smoothstep(0.0, 0.32, x)) * (1.0 - 0.3 * smoothstep(0.94, 1.0, x));
  let aa = a / max(body, 1.0e-3);
  let ends = smoothstep(0.0, 0.02, x) * (1.0 - smoothstep(0.99, 1.0, x));
  let heart = 1.0 - smoothstep(0.1, 0.19, aa);
  let shimmer = 0.78 + 0.22 * sin(x * 80.0 - time * 26.0 + seed) * sin(x * 27.0 + time * 9.0);
  let bead = pow(0.5 + 0.5 * sin(x * 30.0 - time * 34.0), 10.0);
  let glow = exp(-aa * aa * 5.5) * shimmer;
  var col = mix(vec3f(1.0, 0.7, 0.26), vec3f(1.0, 0.96, 0.86), heart) * (1.1 + 1.6 * heart + 1.6 * bead * heart);
  var light = max(heart, glow * 0.62);
  let shade = (1.0 - smoothstep(0.5, 1.0, aa)) * 0.6;
  // (let go: where the charge has passed the seam is drawn thin and white hot; at its head it swells)
  if (surge >= 0.0) {
    let behind = step(x, surge);
    let lead = (x - surge) / 0.06;
    let wire = 1.0 - smoothstep(0.07, 0.13, aa);
    light = mix(light, max(wire, glow * 0.3), behind);
    col = mix(col, vec3f(1.0, 0.98, 0.92) * 3.2, behind * wire);
    let lobe = exp(-lead * lead) * exp(-aa * aa * 1.6);
    col += vec3f(1.0, 0.92, 0.7) * 3.0 * lobe;
    light = max(light, lobe);
  }
  col = mix(vec3f(0.055, 0.04, 0.12), col, clamp(light * 1.5, 0.0, 1.0));
  var alpha = max(light, shade) * ends;
  if (flare > 0.0) {
    // (runes, one after another along it, standing across it)
    let k = x * u.more.x;
    let g0 = floor(k) * 5.0 + 3.0 + floor(seed);
    let g = g0 - 32.0 * floor(g0 / 32.0);
    let gv = vec2f(fract(k) * 1.2 - 0.1, in.uv.y * 0.62 + 0.5);
    var rune = 0.0;
    if (gv.x >= 0.0 && gv.x <= 1.0 && gv.y >= 0.0 && gv.y <= 1.0) {
      rune = textureSampleLevel(runes, smooth_, (vec2f(g - 8.0 * floor(g / 8.0), floor(g / 8.0)) + vec2f(gv.x, 1.0 - gv.y)) / vec2f(8.0, 4.0), 0.0).r;
    }
    rune *= step(x, flare * 1.05) * ends;
    col = mix(col, vec3f(1.0, 0.95, 0.8) * 2.6, rune);
    alpha = max(alpha * (1.0 + flare), rune);
    col *= 1.0 + 0.8 * flare;
  }
  return vec4f(col, min(alpha, 1.0) * u.ink.x);
}

// The point, where the seam is being opened: a four-pointed glint of light, turning, always facing the eye.
@vertex fn glintVs(@builtin(vertex_index) i: u32) -> Lit {
  let corner = vec2f(f32(i & 1u), f32((i >> 1u) & 1u)) * 2.0 - 1.0;
  let c = cos(u.more.z);
  let s = sin(u.more.z);
  let turned = vec2f(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  var out: Lit;
  out.pos = seen(u.glint.xyz + (u.right.xyz * turned.x + u.up.xyz * turned.y) * u.more.w);
  out.uv = corner;
  return out;
}
// One arm pair of the glint: a long thin lens of light along x.
fn lens(p: vec2f, len: f32, wide: f32) -> f32 {
  let along = abs(p.x) / len;
  if (along >= 1.0) { return 0.0; }
  let h = wide * (1.0 - along * along);
  return 1.0 - smoothstep(h * 0.55, h, abs(p.y));
}
@fragment fn glintFs(in: Lit) -> @location(0) vec4f {
  let r = length(in.uv);
  // a soft warm round of light, falling away, and the four points over it
  let halo = mix(0.9, 0.42, clamp(r / 0.18, 0.0, 1.0)) * (1.0 - smoothstep(0.0, 0.97, r)) * mix(1.0, (1.0 - r) * (1.0 - r), clamp((r - 0.18) / 0.82, 0.0, 1.0));
  let star = max(max(lens(in.uv, 0.94, 0.04), lens(in.uv.yx, 0.94, 0.04)), max(lens(in.uv, 0.09, 0.1), lens(in.uv.yx, 0.09, 0.1)));
  let col = vec3f(1.0, 0.82, 0.5) * halo * 1.4 + vec3f(1.0, 0.98, 0.92) * star * 3.2;
  return vec4f(col * u.more.y, 0.0);
}
`

const dot = (a: Readonly<V3>, b: Readonly<V3>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const set = (out: V3, x: number, y: number, z: number) => { out[0] = x; out[1] = y; out[2] = z; return out }
const copy = (out: V3, a: Readonly<V3>) => set(out, a[0], a[1], a[2])
const cross = (out: V3, a: Readonly<V3>, b: Readonly<V3>) => set(out, a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
const unit = (v: V3) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export async function createCleave(gpu: Gpu, format: GPUTextureFormat = gpu.sceneFormat, options: CleaveOptions = {}): Promise<Cleave> {
  const { device } = gpu
  const reach = options.reach ?? REACH
  const module = await shader(device, 'cleave', CODE)
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const keepAlpha: GPUBlendComponent = { srcFactor: 'zero', dstFactor: 'one' }
  const [ribbonPipe, glintPipe] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'cleave seam', layout: pipelineLayout,
      vertex: { module, entryPoint: 'ribbonVs', buffers: [{ arrayStride: 20, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x2' }] }] },
      fragment: { module, entryPoint: 'ribbonFs', targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: keepAlpha } }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    }),
    device.createRenderPipelineAsync({
      label: 'cleave point', layout: pipelineLayout,
      vertex: { module, entryPoint: 'glintVs' },
      fragment: { module, entryPoint: 'glintFs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: keepAlpha } }] },
      primitive: { topology: 'triangle-strip', cullMode: 'none' },
    }),
  ])
  const atlas = runeAtlas()
  const runeTex = device.createTexture({ label: 'cleave runes', size: [atlas.width, atlas.height], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
  device.queue.writeTexture({ texture: runeTex }, atlas.data, { bytesPerRow: atlas.width }, [atlas.width, atlas.height])
  const block = device.createBuffer({ label: 'cleave', size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const bind = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: block } }, { binding: 1, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) }, { binding: 2, resource: runeTex.createView() }] })
  // The ribbon: two points across at each of N + 1 places along it (where from the eye, and where on the ribbon).
  const verts = new Float32Array((N + 1) * 2 * 5), indices = new Uint16Array(N * 6)
  for (let i = 0; i <= N; i++) {
    verts[i * 10 + 3] = i / N; verts[i * 10 + 4] = -1; verts[i * 10 + 8] = i / N; verts[i * 10 + 9] = 1
    if (i < N) { const a = i * 2; indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6) }
  }
  const vertexBuffer = device.createBuffer({ label: 'cleave seam', size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const indexBuffer = device.createBuffer({ label: 'cleave seam', size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(indexBuffer, 0, indices)
  const uniforms = new Float32Array(24)

  // ── state ──
  // The stroke: the ways its two ends point (d0, d1), the eye it is drawn from, the sheet through them (n, with e1
  // along its start and e2 across), and the angle it spans.
  const d0: V3 = [0, 0, -1], d1: V3 = [0, 0, -1], eye: V3 = [0, 0, 0], n: V3 = [0, 1, 0], e1: V3 = [0, 0, -1], e2: V3 = [1, 0, 0]
  const tmp: V3 = [0, 0, 0], tmp2: V3 = [0, 0, 0], side: V3 = [0, 0, 0], cur: V3 = [0, 0, -1]
  let phase: CleavePhase = 'idle', t = 0, theta = 0, seam = 0, cutDone = false, seed = 0, since = -1, realT = 0
  let aimT = 0, focusK = 0, punch = 0, focus = 0, landed = false
  // While it is aimed the view holds still and the point moves over it: where it is, as turns from the middle of the
  // view (right, up), and the view's own frame when it was taken out.
  const brush = { x: 0, y: 0 }, held = { f: [0, 0, -1] as V3, r: [1, 0, 0] as V3, u: [0, 1, 0] as V3 }
  let cam: View | null = null, aspect = 16 / 9
  // the stroke as it was really drawn: the ways the point has pointed, in order (the cut is the straight of it, end to end)
  const path: V3[] = []
  // what the last pass is told, and what is left in the world after
  const post = { mode: 0, beat: 0, frame: 0, circle: 0, written: 0, split: 0 }
  const ring = { age: -1, at: [0, 0, 0] as V3, normal: [0, 1, 0] as V3, mid: [0, 0, -1] as V3, size: 30 * M, burst: false, reached: false }
  const seamAt = { glow: 0, width: SEAM_W, eye: [0, 0, 0] as V3, normal: [0, 1, 0] as V3, e1: [0, 0, -1] as V3, e2: [1, 0, 0] as V3, theta: 0 }
  let haze = 0, quake = 0, gasp = 0, shakeT = 0
  // The rings are a blast of air as well, going out from the middle of the cut over the ground: fast at first, then rolling on.
  const wind = { on: false, r: 0, age: 0, eye: false }
  // The eye is struck: kicks, each a jolt that dies away, shaken at the reel's 30 a second.
  const jolt: V3 = [0, 0, 0], kicks: { t: number; power: number }[] = []
  const kick = (power: number) => { if (kicks.length < 8) kicks.push({ t: 0, power }) }
  const stats: Cleave['stats'] = { cuts: 0, much: 0.5, last: null }
  const cue = (what: Parameters<NonNullable<CleaveOptions['onCue']>>[0], intensity = 0.5) => options.onCue?.(what, intensity)

  /** The way from the eye at u (0 to 1) along the stroke: the great circle from d0 to d1. */
  const along = (u: number, out: V3) => { const a = theta * u, c = Math.cos(a), s = Math.sin(a); return set(out, e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s) }
  /** The sheet the cut lies in, and the angle the stroke spans, from its two ends (and the eye). */
  const sheet = () => {
    cross(n, d0, d1)
    const l = Math.hypot(n[0], n[1], n[2])
    if (l < 1e-5) { theta = 0; return false }
    n[0] /= l; n[1] /= l; n[2] /= l
    unit(copy(e1, d0)); unit(cross(e2, n, e1))
    theta = Math.atan2(dot(d1, e2), dot(d1, e1))
    return true
  }
  /** The way the point points: the held view turned by where the point is over it. */
  const brushDir = (out: V3) => {
    const cy = Math.cos(brush.y), sy = Math.sin(brush.y), cx = Math.cos(brush.x), sx = Math.sin(brush.x)
    return unit(set(out, held.f[0] * cy * cx + held.r[0] * cy * sx + held.u[0] * sy, held.f[1] * cy * cx + held.r[1] * cy * sx + held.u[1] * sy, held.f[2] * cy * cx + held.r[2] * cy * sx + held.u[2] * sy))
  }
  const angleTo = (a: Readonly<V3>, b: Readonly<V3>) => Math.acos(clamp(dot(a, b), -1, 1))

  /** The ribbon laid before the eye, along the ways it was drawn in (so it stays over what it crosses), as places from the eye. */
  const layRibbon = (width: number) => {
    const last = path.length - 1, w = LAY * width
    for (let i = 0; i <= N; i++) {
      // (along the way the point went, where it has been written down; else along the straight of it)
      if (last >= 2) {
        const f = (i / N) * last, k = Math.min(last - 1, Math.floor(f)), g = f - k, a = path[k], b = path[k + 1]
        unit(set(tmp, a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g))
        const p = path[Math.min(last, k + 2)], q = path[Math.max(0, k - 1)]
        cross(side, tmp, set(tmp2, p[0] - q[0], p[1] - q[1], p[2] - q[2]))
        if (dot(side, side) < 1e-10) copy(side, n); else unit(side)
      } else { along(i / N, tmp); copy(side, n) }
      const o = i * 10
      verts[o] = tmp[0] * LAY - side[0] * w; verts[o + 1] = tmp[1] * LAY - side[1] * w; verts[o + 2] = tmp[2] * LAY - side[2] * w
      verts[o + 5] = tmp[0] * LAY + side[0] * w; verts[o + 6] = tmp[1] * LAY + side[1] * w; verts[o + 7] = tmp[2] * LAY + side[2] * w
    }
  }
  // What is drawn this frame: the seam (how much of it, how wide, its runes and its charge) and the point.
  const shown = { ribbon: false, width: INK, fade: 1, flare: 0, surge: -1, count: 12, glint: false, glintAt: [0, 0, -1] as V3, bright: 1, turn: 0 }

  /** The cut: made once, on its beat. The sheet faces up, so that what is above it is what slides. */
  const cut = (): CleaveCut => {
    cutDone = true
    const up = n[1] < 0 ? -1 : 1, nu: V3 = [n[0] * up, n[1] * up, n[2] * up]
    seam = SEAM; since = 0; haze = 1
    // (the rings: round the middle of the cut, as far off as the first thing it crossed there)
    const mid = along(0.5, [0, 0, 0]), far = options.probe?.(eye, mid, reach) ?? null
    const D = clamp(far ?? 30 * M, 9 * M, 55 * M)
    set(ring.at, eye[0] + mid[0] * D, eye[1] + mid[1] * D, eye[2] + mid[2] * D); copy(ring.normal, nu); copy(ring.mid, mid); ring.size = D
    // which way the halves go: down the sheet if it slopes; along the stroke if it lies flat
    const slide: V3 = [nu[0] * nu[1], -1 + nu[1] * nu[1], nu[2] * nu[1]]
    if (Math.hypot(slide[0], slide[1], slide[2]) > 0.3) unit(slide)
    else { along(1, tmp); along(0, tmp2); unit(set(slide, tmp[0] - tmp2[0], tmp[1] - tmp2[1], tmp[2] - tmp2[2])) }
    copy(seamAt.eye, eye); copy(seamAt.normal, nu); copy(seamAt.e1, e1); copy(seamAt.e2, e2); seamAt.theta = theta
    const made: CleaveCut = { eye: [eye[0], eye[1], eye[2]], normal: nu, e1: [e1[0], e1[1], e1[2]], e2: [e2[0], e2[1], e2[2]], theta, reach, slide }
    stats.cuts++; stats.last = made; landed = true
    return made
  }

  const begin = () => {
    // the first press takes the point out: the world all but stops, the view is held where it is, and the point is free
    if (!cam) return false
    phase = 'aim'; aimT = 0; theta = 0; path.length = 0; brush.x = 0; brush.y = 0
    copy(held.f, cam.forward as V3); copy(held.r, cam.right as V3); copy(held.u, cam.up as V3)
    cue('aim')
    return true
  }
  const draws = () => {
    // pressed again, it draws, from wherever the point is
    phase = 'draw'; brushDir(d0); copy(d1, d0); theta = 0; path.length = 0; path.push([d0[0], d0[1], d0[2]])
    seed = Math.random() * 100
    cue('draw', 0)
  }
  const letGo = () => {
    if (sheet() && Math.abs(theta) >= SHORTEST) { path.push([d1[0], d1[1], d1[2]]); phase = 'strike'; t = 0; cutDone = false; landed = false; cue('strike', Math.min(1, Math.abs(theta) / 0.8)) }
    // (too short a stroke is nothing: the point is still out)
    else { phase = 'aim'; theta = 0; path.length = 0; cue('cancel') }
  }

  const api: Cleave = {
    get phase() { return phase },
    get busy() { return phase !== 'idle' },
    get locked() { return phase === 'aim' || phase === 'draw' },
    stats,
    pointerDown() {
      if (phase === 'strike') return true
      if (phase === 'idle') return begin()
      if (phase === 'aim') draws()
      return true
    },
    pointerUp() {
      if (phase !== 'draw') return false
      letGo()
      return true
    },
    tap() { if (phase === 'idle') begin(); else if (phase === 'aim') draws(); else if (phase === 'draw') letGo() },
    steer(dx, dy) {
      if (phase !== 'aim' && phase !== 'draw') return false
      const half = Math.atan(cam ? cam.tanHalf : 0.7), wide = Math.atan(Math.tan(half) * aspect)
      brush.x = clamp(brush.x + dx, -wide * 0.92, wide * 0.92)
      brush.y = clamp(brush.y + dy, -half * 0.88, half * 0.88)
      return true
    },
    cancel() { if (phase === 'draw' || phase === 'aim') { phase = 'idle'; path.length = 0; cue('cancel') } },
    clear() { api.cancel(); seam = 0; ring.age = -1; haze = 0; wind.on = false; quake = 0; gasp = 0; kicks.length = 0; since = -1; punch = 0 },
    strike(eyeAt, from, to) {
      copy(eye, eyeAt); unit(copy(d0, from)); unit(copy(d1, to)); path.length = 0; path.push([d0[0], d0[1], d0[2]], [d1[0], d1[1], d1[2]])
      if (!sheet()) return
      seed = Math.random() * 100
      phase = 'strike'; t = 0; cutDone = false; landed = false
      cue('strike', Math.min(1, Math.abs(theta) / 0.8))
    },
    mode() {
      return {
        name: 'cleaving',
        pointerDown: () => api.pointerDown(),
        pointerUp: () => api.pointerUp(),
        rightClick: () => { if (!api.locked) return false; api.cancel(); return true },
        move: (dx, dy) => api.steer(dx, dy),
        cancel: () => api.cancel(),
        use: () => { api.tap(); return true },
        key: (code) => { if (code !== 'Escape' || !api.locked) return false; api.cancel(); return true },
      }
    },

    step(realDt, view, aspectNow) {
      if (view) cam = view
      if (aspectNow && aspectNow > 0) aspect = aspectNow
      const dt = Math.min(Math.max(realDt, 0), 0.1)
      let executeCut: CleaveCut | undefined
      realT += dt
      // the seam, the pale day and the rings run on after the instant
      if (seam > 0) { seam = Math.max(0, seam - dt); const s = Math.min(1, seam / SEAM_OUT); seamAt.glow = s * s * (3 - 2 * s) * 1.3; seamAt.width = SEAM_W * (1 + 0.6 * (1 - s)) } else seamAt.glow = 0
      post.mode = 0; post.beat = 0; post.circle = 0; post.split = 0; post.written = 0
      if (since >= 0) { since += dt; if (since > HANG + BACK + 0.5) since = -1 }
      if (ring.age >= 0) { ring.age += dt; if (ring.age > RINGS) ring.age = -1 }
      // (the blast of air: when its front reaches the eye, a great blow, and the ground goes on shaking under it; harder the nearer the cut)
      if (wind.on) {
        wind.age += dt; wind.r += (45 + 330 * Math.exp(-wind.age * 3.2)) * M * dt
        const from = cam ? Math.hypot(cam.eye[0] - ring.at[0], cam.eye[2] - ring.at[2]) : 0
        if (!wind.eye && wind.r >= from) { wind.eye = true; const near = clamp(1.3 - from / M / 110, 0.4, 1); kick(4.2 * near); quake = 2.4 * near; gasp = 1 }
        if (wind.r > WIND_FAR) wind.on = false
      }
      quake *= Math.exp(-dt * 1.7); if (quake < 0.004) quake = 0
      gasp *= Math.exp(-dt * 5); if (gasp < 0.004) gasp = 0
      haze = Math.max(0, haze - dt * 0.7)
      // (the blows: each dies away fast; the eye is moved to new places 30 times a second, not smoothly)
      let amp = 0
      for (const k of kicks) { k.t += dt; amp += k.power * Math.exp(-k.t * 5.5) * Math.min(1, k.t * 60) }
      while (kicks.length && kicks[0].t > 1.2) kicks.shift()
      amp *= 0.6
      shakeT += dt
      if (Math.floor(shakeT * 30) !== Math.floor((shakeT - dt) * 30)) set(jolt, (Math.random() - 0.5) * 0.07 * amp, (Math.random() - 0.5) * 0.06 * amp, (Math.random() - 0.5) * 0.09 * amp)
      if (amp < 0.004) set(jolt, 0, 0, 0)
      // (the view: open wide while it is aimed; snapped close under the first blink of light, before the dark, so
      // that the cut is seen in the dark exactly where, and as large as, it is seen when the day comes back; and let back slowly)
      if (phase === 'aim' || phase === 'draw' || (phase === 'strike' && t < T.duo)) { aimT += dt; focusK += (1 - focusK) * Math.min(1, dt * 10) }
      else if (phase === 'strike' && t < T.still) { focusK = 0; punch = 1 }
      else { focusK += (0 - focusK) * Math.min(1, dt * 14); punch *= Math.exp(-dt * 2.4); if (punch < 0.003) punch = 0 }
      // (the rings stand for three frames before they burst: the wind goes with the burst, and the shell of glass reaches the eye a little after)
      if (ring.age >= RING_HOLD && !ring.burst) { ring.burst = true; wind.on = true; wind.r = 0; wind.age = 0; wind.eye = false }
      if (ring.age > RING_HOLD + 0.09 && !ring.reached) { ring.reached = true; kick(1.6) }
      focus = phase === 'aim' ? 0.62 * Math.min(1, aimT / 0.2) : phase === 'draw' ? 0.62 + 0.38 * Math.min(1, Math.abs(theta) / 0.45) : phase === 'strike' && t < T.duo ? 1 : phase === 'strike' ? 0 : Math.max(0, focus - dt * 6)
      shown.ribbon = false; shown.glint = false
      if (phase === 'aim') {
        brushDir(cur)
        shown.glint = true; copy(shown.glintAt, cur); shown.bright = 0.85 + 0.15 * Math.sin(realT * 9); shown.turn = realT * 0.6
      } else if (phase === 'draw') {
        if (cam) copy(eye, cam.eye as V3)
        brushDir(d1); sheet()
        if (angleTo(path[path.length - 1], d1) > 0.006 && path.length < 400) { path.push([d1[0], d1[1], d1[2]]); cue('draw', Math.min(1, Math.abs(theta) / 0.8)) }
        shown.ribbon = Math.abs(theta) > 0.004; shown.width = INK; shown.flare = 0; shown.surge = -1; shown.fade = 1
        shown.glint = true; copy(shown.glintAt, d1); shown.bright = 1; shown.turn = realT * 2.4
      } else if (phase === 'strike') {
        // (the instant runs in real time: it is the world that is stopped)
        t += dt > 0 ? dt : 1 / 60
        // (whole frames of the reel's: everything below steps on them)
        const f = Math.floor(t / F), ft = f * F, fb = f - 1
        post.frame = f
        // (the charge: smoothly, by the clock, not in steps; the runes are written behind its head)
        const flare = Math.min(1, t / (T.write - F * 0.5))
        shown.ribbon = ft < T.write; shown.width = INK * (1 + 0.35 * flare); shown.flare = flare; shown.surge = ft < T.write ? flare : -1; shown.fade = 1
        shown.count = Math.max(4, Math.round(Math.abs(theta) / (INK * 2.6)))
        if (ft < T.write) { post.circle = 1; post.written = flare }
        else if (ft < T.duo) { post.mode = 1; post.beat = fb - 2; post.circle = 2 }
        else if (ft < T.flash) { post.mode = 2; post.beat = 0.1; post.circle = 3 }
        else if (ft < T.dark) { post.mode = 3; post.beat = (fb - 4) / 4; post.circle = 2; post.split = (fb - 4) / 4 }
        else if (ft < T.flash2) { post.mode = 2; post.beat = 1.1; post.circle = 3; post.split = 1 }
        else if (ft < T.back) { post.mode = 4; post.beat = fb === 10 ? 0.35 : 0.72; post.split = fb === 10 ? 0.6 : 0.25 }
        if (ft >= T.duo && !cutDone) { executeCut = cut(); options.onCut?.(executeCut) }
        if (ft >= T.dark && landed) { landed = false; cue('hit', clamp(stats.much, 0, 1)) }
        if (ft >= T.rings && ring.age < 0 && cutDone && t < T.rings + F * 2) { ring.age = 0; ring.reached = false; ring.burst = false; kick(1) }
        if (t > T.still + 0.4) phase = 'idle'
      }
      // How fast the world goes: all but stopped while it is aimed; stopped until the first blink of light; from
      // there the cut is made and the world goes on, slowly, so that what is seen parting in the dark is the thing itself.
      let timeScale = 1
      if (phase === 'aim' || phase === 'draw') timeScale = 1 - (1 - SLOW) * Math.min(1, aimT / 0.22) ** 0.6
      else if (phase === 'strike' && t < T.duo) timeScale = 0
      else if (phase === 'strike' && t < T.still) timeScale = 0.3
      else if (since >= 0 && since < HANG + BACK) timeScale = AFTER + (1 - AFTER) * (Math.max(0, since - HANG) / BACK) ** 2
      return {
        timeScale, fovDelta: WIDE * focusK - PUNCH * punch + 9 * gasp, jolt, shake: quake, phase, locked: phase === 'aim' || phase === 'draw',
        charge: phase === 'draw' ? Math.min(1, Math.abs(theta) / 0.8) : phase === 'aim' ? 0.06 : 0, hanging: since >= 0, executeCut,
      }
    },

    draw(encoder, to, view, time) {
      cam = view; aspect = to.size[0] / Math.max(1, to.size[1])
      if (!shown.ribbon && !shown.glint) return
      if (shown.ribbon) { layRibbon(shown.width); device.queue.writeBuffer(vertexBuffer, 0, verts) }
      uniforms.set([view.forward[0], view.forward[1], view.forward[2], view.tanHalf, view.right[0], view.right[1], view.right[2], aspect, view.up[0], view.up[1], view.up[2], time,
        shown.fade, seed, shown.flare, shown.surge, shown.count, shown.bright, shown.turn, LAY * 0.1, shown.glintAt[0] * LAY, shown.glintAt[1] * LAY, shown.glintAt[2] * LAY, 0])
      device.queue.writeBuffer(block, 0, uniforms)
      const pass = encoder.beginRenderPass({ label: 'cleave', colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }] })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      pass.setBindGroup(0, bind)
      if (shown.ribbon) { pass.setPipeline(ribbonPipe); pass.setVertexBuffer(0, vertexBuffer); pass.setIndexBuffer(indexBuffer, 'uint16'); pass.drawIndexed(N * 6) }
      if (shown.glint) { pass.setPipeline(glintPipe); pass.draw(4) }
      pass.end()
    },

    postFx(out) {
      out.focus = focus; out.mode = post.mode; out.beat = post.beat; out.frame = post.frame; out.circle = post.circle; out.written = post.written; out.split = post.split
      out.fringe = ring.age >= 0 ? Math.max(0, 1 - ring.age / 0.7) * 0.7 : 0
      out.haze = haze * haze
      const r = out.rings
      r.age = ring.age >= 0 ? Math.max(ring.age, 1e-4) : 0; copy(r.at, ring.at); copy(r.normal, ring.normal); copy(r.mid, ring.mid); r.size = ring.size
      const s = out.seam
      s.glow = seamAt.glow; s.width = seamAt.width; copy(s.eye, seamAt.eye); copy(s.normal, seamAt.normal); copy(s.e1, seamAt.e1); copy(s.e2, seamAt.e2); s.theta = seamAt.theta; s.reach = reach
      // the line on the picture: its two ends, laid before the eye (while it is drawn, struck, and its rings go out)
      if (!cam || (phase === 'idle' && ring.age < 0) || phase === 'aim') return
      const seenAt = (d: Readonly<V3>, at: [number, number]) => { const z = Math.max(dot(d, cam!.forward as V3), 1e-4); at[0] = dot(d, cam!.right as V3) / (z * cam!.tanHalf * aspect); at[1] = dot(d, cam!.up as V3) / (z * cam!.tanHalf); return at }
      const a = seenAt(along(0, tmp), [0, 0]), b = seenAt(along(1, tmp), [0, 0])
      out.line[0] = a[0] * 0.5 + 0.5; out.line[1] = a[1] * 0.5 + 0.5; out.line[2] = b[0] * 0.5 + 0.5; out.line[3] = b[1] * 0.5 + 0.5
      // (which side of the line, on the picture, is above the cut)
      const nuY = n[1] < 0 ? -1 : 1, mid = along(0.5, tmp), pm = seenAt(mid, [0, 0])
      const pn = seenAt(set(tmp2, mid[0] + n[0] * 0.05 * nuY, mid[1] + n[1] * 0.05 * nuY, mid[2] + n[2] * 0.05 * nuY), [0, 0])
      const lx = (b[0] - a[0]) * aspect, ly = b[1] - a[1]
      out.up = (pn[0] - pm[0]) * aspect * -ly + (pn[1] - pm[1]) * lx < 0 ? -1 : 1
    },
  }
  return api
}
