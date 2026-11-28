// The lettering boards' own light (#450): channel letters, lit from within, as a rooftop letter sign is by night.
//
// As the lights come on (march.ts `lights`), or when a board first comes into view with them on, its letters strike
// a beat apart and not in order, some with a stutter first; each then warms up over half a second to its own
// brightness and hue (the tubes of one sign are not one batch). A lit letter's face burns near white and its returns
// softer, and it throws its light on its panel, the roof and the wall under it (march.ts `lettered`); round its strokes
// is a halo, drawn here: a small soft light over each lit cell of its glyph, so it hugs the letter as a real halo does
// and is no round blot. By day, or with the lights off, they are painted letters. Hover and focus brighten a board.
//
// What a broken letter has left is lit and nothing more: a cell of lamp that is gone has no halo, and a letter that has
// lost most of its lamp no light (boards.ts `letterStands`).
//
//   ?arms=0   no lamps on arms over the letters (and no wash of their light on the panels): the letters' own light alone
//
// The old site's marquee (~/Developer/site/static/landing, signs.js and sign-renderer.js) is where this comes from:
// bulbs struck in turn with a 30 Hz stutter, a halo of a wide soft falloff and a tight hot core.
import { shader, type Target } from '../probe/gpu.ts'
import { LIT_LETTERS, type View } from './march.ts'

const query = new URLSearchParams(location.search)
/** Whether the boards keep 489's lamps on arms and their wash (`?arms=0` leaves them off). */
export const ARMS = query.get('arms') !== '0'

/** A letter as the light knows it: its box (world cells, low and high), which way its face looks (boards.ts facing), and where the middle of each cell of its lamp is, with how big a cell is. */
export interface LitLetter { lo: [number, number, number]; hi: [number, number, number]; facing: number; cells: [number, number, number][]; cell: number }

const CODE = /* wgsl */ `
struct U {
  right: vec3f, tanHalf: f32,
  up: vec3f, aspect: f32,
  forward: vec3f, glow: f32,
  // The eye, from the corner everything here is measured from (cells); how wide a pixel is a cell away (cells).
  eye: vec3f, pixel: f32,
  // Each letter: how far it is lit, its hue (-1 to 1), how far it is hovered, 0.
  letters: array<vec4f, ${LIT_LETTERS}>,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var faced: texture_depth_2d;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) light: vec3f }
const NEAR = 1.0;
const FAR = 100000.0;
// One cell of a lit letter's lamp: where its middle is (from the corner), its size and which letter it is.
@vertex fn vs(@builtin(vertex_index) v: u32, @location(0) at: vec4f, @location(1) which: f32) -> Out {
  let l = u.letters[u32(which)];
  let corner = vec2f(f32(v & 1u), f32(v >> 1u)) * 2.0 - 1.0;
  // A halo reaches a cell and a half past the cell it is over (about a sixth of a capital round the strokes), and never
  // less than four pixels: what is scattered in the air and the eye is as wide seen from far as from near, and then
  // spread over that the more thinly, so a word far off is not one blot. From the park (over 120 m) at a quarter: a
  // phone's letters were burnt out to white by their halos over their own faces (sf-boards, lamp under 235).
  let far = length(at.xyz - u.eye);
  let own = at.w * (1.6 + 0.5 * l.z);
  let reach = max(own, far * u.pixel * 4.0);
  var p = at.xyz - u.eye + (u.right * corner.x + u.up * corner.y) * reach;
  // (Before the face, so that the face itself does not hide it; a cell's own light is in front of it.)
  p -= normalize(p) * at.w * 1.5;
  let d = dot(p, u.forward);
  var out: Out;
  out.pos = vec4f(dot(p, u.right) / (u.tanHalf * u.aspect), dot(p, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.uv = corner;
  let colour = vec3f(1.0, 0.54 + 0.06 * l.y, 0.18 + 0.10 * l.y);
  out.light = colour * l.x * (1.0 + 0.6 * l.z) * u.glow * 1.8 * min(1.0, (own * own) / (reach * reach)) * mix(1.0, 0.25, smoothstep(400.0, 1200.0, far));
  return out;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  if (dot(in.light, vec3f(1.0)) <= 0.0) { discard; }
  let size = textureDimensions(faced);
  if (size.x > 1u) {
    let behind = textureLoad(faced, min(vec2u(in.pos.xy), size - 1u), 0);
    if (behind > in.pos.w * 1.004) { discard; }
  }
  // Light scattered in the air round a bright source: a soft skirt and a tighter core (the old site's halo, signs).
  let r = dot(in.uv, in.uv);
  let glow = max(exp(-4.5 * r) - 0.011, 0.0) * 0.11 + exp(-14.0 * r) * 0.09;
  return vec4f(in.light * glow, 0.0);
}
`

/** A letter's clock as it strikes: when (seconds after the board's strike), the blinks before it holds, how bright it settles and its hue. */
interface Clock { at: number; blinks: [number, number][]; most: number; hue: number }
interface Board { id: string; letters: LitLetter[]; clocks: Clock[]; struck: number | null; offAt: number | null; seen: boolean; there: boolean[][]; /** How lit each letter was as it went out: it fades from that. */ was: number[] }

/** A number from 0 to 1 for a board and a letter, the same every time (so a picture can be taken again). */
const seeded = (text: string, k: number) => { let h = 2166136261 ^ k; for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) } h ^= h >>> 13; h = Math.imul(h, 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }

export interface LetterLight {
  /** A lettering board's letters (null: it has none now). Struck again if the lights are on. */
  board(id: string, letters: LitLetter[] | null): void
  /** Which of a letter's lamp cells are still there (boards.ts): a halo only over those, no light from a letter that has lost most of them. */
  standing(id: string, there: boolean[][]): void
  /** The board under the pointer or with the focus, brightened (null: none). */
  hot: string | null
  /** Holds the strike's clock at so many seconds after it (null: it runs): for the checks and pictures. */
  hold: number | null
  /** Whether every lit board's letters have struck and warmed up (or are out): for a picture of them lit. */
  readonly settled: boolean
  /** What each board's letters are doing now, 0 (out) to 1 (lit): for the checks. */
  readonly power: Record<string, number[]>
  /** Moves the clocks on and says what the march is told (Looks.letters, world cells). `seen(id)`: whether the board is in the picture now. */
  step(lights: number, seen: (id: string) => boolean): Float32Array
  draw(encoder: GPUCommandEncoder, to: Target, view: View, faced: GPUTextureView | null): void
}

/** `lightsNow`: how far the lights are on now (march.ts `lights`), read where a frame's own may be behind it (`settled`). */
export async function letterLight(device: GPUDevice, format: GPUTextureFormat, lightsNow: () => number): Promise<LetterLight> {
  const module = await shader(device, 'letterlight', CODE)
  const pipeline = await device.createRenderPipelineAsync({
    label: 'letter halos', layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 20, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32' }] }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
    primitive: { topology: 'triangle-strip', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
  })
  const uniforms = device.createBuffer({ size: 64 + 16 * LIT_LETTERS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const nothing = device.createTexture({ size: [1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT })
  { const enc = device.createCommandEncoder(); enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: nothing.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } }).end(); device.queue.submit([enc.finish()]) }
  const none = nothing.createView()
  let bound: { faced: GPUTextureView; group: GPUBindGroup } | null = null
  const bind = (faced: GPUTextureView) => (bound?.faced === faced ? bound : (bound = { faced, group: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: faced }] }) })).group
  const still = matchMedia('(prefers-reduced-motion: reduce)')

  const boards = new Map<string, Board>()
  /** The halos' cells: rebuilt when a board or what stands of it changes. */
  let cells: GPUBuffer | null = null, count = 0, stale = true, anchor: [number, number, number] = [0, 0, 0]
  const powers = new Float32Array(LIT_LETTERS * 4)
  let lights = 0
  const clockOf = (id: string, i: number, n: number): Clock => {
    const r = (k: number) => seeded(id, i * 16 + k)
    // A beat apart, broadly along the word and not in its order: half a second across a word of four, with a jitter of most of a beat.
    const at = 0.25 + (i / Math.max(1, n - 1)) * 0.5 * Math.min(1, n / 4) + r(0) * 0.35
    // About two in five stutter before they hold: on and off a few times in a quarter to half a second.
    const blinks: [number, number][] = []
    if (r(1) < 0.4 && !still.matches) for (let k = 0, t = 0, times = 2 + Math.floor(r(2) * 3); k < times; k++) { const on = 0.03 + r(3 + k) * 0.07, off = 0.04 + r(8 + k) * 0.16; blinks.push([t, t + on]); t += on + off }
    return { at, blinks, most: 0.9 + r(13) * 0.14, hue: r(14) * 2 - 1 }
  }
  /** How lit a letter is `t` seconds after its board struck (or `out` seconds after it went out). */
  const shine = (c: Clock, t: number) => {
    let s = t - c.at
    if (s < 0) return 0
    const last = c.blinks.at(-1)
    if (last && s < last[1] + 0.05) return c.blinks.some(([a, b]) => s >= a && s < b) ? 0.7 : 0.04
    if (last) s -= last[1] + 0.05
    // Warming up: on at a third, full in about half a second.
    const w = Math.min(1, s / (still.matches ? 0.8 : 0.55))
    return c.most * (0.35 + 0.65 * w * w * (3 - 2 * w))
  }
  const now = () => performance.now() / 1000
  let told = false
  const light: LetterLight = {
    hot: null,
    hold: null,
    board(id, letters) {
      if (!letters?.length) { boards.delete(id); stale = true; return }
      const was = boards.get(id)
      // (A board laid again while lit, its words changed or the world put back, strikes again.)
      // (One laid again while it fades out goes on fading, from where it was.)
      const fading = was && was.struck === null && was.offAt !== null && was.was.length === letters.length
      boards.set(id, { id, letters, clocks: letters.map((_, i) => clockOf(id, i, letters.length)), struck: was?.struck != null ? now() : null, offAt: fading ? was.offAt : null, seen: was?.seen ?? false, there: letters.map((l) => l.cells.map(() => true)), was: fading ? was.was : letters.map(() => 0) })
      stale = true
    },
    standing(id, there) {
      const b = boards.get(id)
      if (!b || there.length !== b.letters.length || there.every((t, i) => t.length === b.there[i].length && t.every((v, k) => v === b.there[i][k]))) return
      b.there = there; stale = true
    },
    get settled() {
      const t = now(), on = lightsNow() >= 0.5
      for (const b of boards.values()) {
        // (One the lights are on for and that is in view strikes at the next frame; one never seen is not waited for.)
        if (b.struck === null) { if (on && (b.seen || b.offAt !== null)) return false; continue }
        const since = light.hold ?? t - b.struck
        if (b.clocks.some((c) => shine(c, since) < c.most * 0.99)) return false
      }
      return true
    },
    get power() { const out: Record<string, number[]> = {}; let i = 0; for (const b of boards.values()) out[b.id] = b.letters.map(() => (i < LIT_LETTERS ? powers[4 * i++] : 0)); return out },
    step(level, seen) {
      lights = level
      const t = now(), on = level >= 0.5, off = level < 0.4
      const data = new Float32Array((2 + 2 * LIT_LETTERS) * 4)
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
      let i = 0
      for (const b of boards.values()) {
        b.seen ||= seen(b.id)
        // The lights come on (or are on when it comes into view): it strikes. They go off: it goes out, all at once.
        if (on && b.struck === null && b.seen) { b.struck = t; b.offAt = null }
        if (off && b.struck !== null) { b.was = b.letters.map((_, k) => (i + k < LIT_LETTERS ? powers[4 * (i + k)] : 0)); b.struck = null; b.offAt = t }
        const since = b.struck === null ? -1 : light.hold ?? t - b.struck, out = b.offAt === null ? 1 : Math.max(0, 1 - (t - b.offAt) / 0.35)
        b.letters.forEach((l, k) => {
          if (i >= LIT_LETTERS) { if (!told) { told = true; console.warn(`the lettering boards have more than ${LIT_LETTERS} letters: those past it are not lit (march.ts LIT_LETTERS)`) } return }
          const standing = b.there[k].filter(Boolean).length * 2 > b.there[k].length
          const p = !standing ? 0 : b.struck !== null ? shine(b.clocks[k], since) : b.offAt !== null ? b.was[k] * out : 0
          const hot = light.hot === b.id ? 1 : 0
          powers.set([p * (1 + 0.1 * hot), b.clocks[k].hue, hot, 0], 4 * i)
          data.set([l.lo[0], l.lo[1], l.lo[2], Math.min(1.25, p * (1 + 0.1 * hot)), l.hi[0], l.hi[1], l.hi[2], l.facing + 0.5 + b.clocks[k].hue * 0.45], 8 + 8 * i)
          // Its light reaches round it: two capitals out before it and down it, one each side, half a one over it.
          const size = l.hi[1] - l.lo[1]
          for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], l.lo[a] - (a === 1 ? 2 : 1.2) * size); hi[a] = Math.max(hi[a], l.hi[a] + (a === 1 ? 0.5 : 1.2) * size) }
          i++
        })
      }
      if (i) data.set([lo[0], lo[1], lo[2], i, hi[0], hi[1], hi[2], ARMS ? 1 : 0], 0)
      return data
    },
    draw(encoder, to, view, faced) {
      if (stale) {
        stale = false
        const all: number[] = []
        let i = 0, first = true
        for (const b of boards.values()) b.letters.forEach((l, k) => {
          if (i >= LIT_LETTERS) return
          if (first) { anchor = [Math.round(l.lo[0]), Math.round(l.lo[1]), Math.round(l.lo[2])]; first = false }
          l.cells.forEach((c, m) => { if (b.there[k][m]) all.push(c[0] - anchor[0], c[1] - anchor[1], c[2] - anchor[2], l.cell, i) })
          i++
        })
        count = all.length / 5
        if (count) {
          if (!cells || cells.size < all.length * 4) { cells?.destroy(); cells = device.createBuffer({ size: Math.max(64, all.length * 4), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }) }
          device.queue.writeBuffer(cells, 0, new Float32Array(all))
        }
      }
      if (!count || !cells || lights <= 0 || powers.every((v, k) => k % 4 !== 0 || v <= 0)) return
      const f = new Float32Array(16 + 4 * LIT_LETTERS)
      f.set([...view.right, view.tanHalf, ...view.up, to.size[0] / to.size[1], ...view.forward, Math.min(1, lights * 1.5), view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], (2 * view.tanHalf) / to.size[1]], 0)
      f.set(powers, 16)
      device.queue.writeBuffer(uniforms, 0, f)
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }], depthStencilAttachment: { view: to.depth, depthReadOnly: true } })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind(faced ?? none))
      pass.setVertexBuffer(0, cells)
      pass.draw(4, count)
      pass.end()
    },
  }
  return light
}
