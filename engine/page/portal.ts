// The portal (#264), as an experiment: another realm seen live through a window standing in this one, and stepped
// into with nothing to wait for. A second world like the page's own is held beside it (world.ts), made round the
// place the window leads to with the other realm's edits (its stream is held by link.ts `ready`), and marched by
// a second marcher into the window's pixels alone. Walking through, the two worlds change places (world.ts
// `trade`): no sector is made and nothing is copied. What it costs is measured by `bench`.
import { offscreen, pace, shader, type Gpu, type Offscreen, type Target } from '../probe/gpu.ts'
import { ball, rows, type Edit } from './edits.ts'
import type { Echo, Link, Realm } from './link.ts'
import type { Marcher, View } from './march.ts'
import { baseOf, type Pose, type Realms } from './realms.ts'
import { SUN_SIDE } from './sun.ts'
import { read } from './told.ts'
import type { World } from './world.ts'

/** A window: where its middle stands in this world and which way it faces (cells, radians from north towards east), how wide and high it is, and the place of the other world that its middle is. */
export interface Gate { at: [number, number, number]; yaw: number; size: [number, number]; to: [number, number, number] }

const CODE = /* wgsl */ `
const NEAR = 1.0;
const FAR = 100000.0;
struct U { at: vec3f, tanHalf: f32, right: vec3f, aspect: f32, up: vec3f, scale: f32, forward: vec3f, open: f32, across: vec3f, halfWide: f32, tint: vec3f, halfHigh: f32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var other: texture_2d<f32>;
struct Out { @builtin(position) pos: vec4f, @location(0) c: vec2f }
@vertex fn vs(@builtin(vertex_index) v: u32) -> Out {
  let c = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(1, 1), vec2f(-1, -1), vec2f(1, 1), vec2f(-1, 1))[v];
  // The window's middle is given from the eye; it opens from its middle outwards.
  let world = u.at + u.across * c.x * u.halfWide * u.open + vec3f(0.0, 1.0, 0.0) * c.y * u.halfHigh * u.open;
  let d = dot(world, u.forward);
  var out: Out;
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.c = c;
  return out;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  // The other world's picture at this very pixel: it was marched from an eye as far from the place the window leads to as this eye is from the window.
  let seen = textureLoad(other, vec2i(in.pos.xy * u.scale), 0).rgb * u.tint;
  // A bright rim, so that the window is seen to be one.
  let rim = smoothstep(0.93, 1.0, max(abs(in.c.x), abs(in.c.y)));
  return vec4f(mix(seen, vec3f(1.0, 0.92, 0.7) * 1.6, rim), 1.0);
}
`

/** What a world said, as edits of cells: its asks as echoes and the core's words. */
function editsOf(frames: { echo?: Echo; words?: Uint32Array<ArrayBuffer> }[]): Edit[] {
  const out: Edit[] = []
  for (const f of frames) {
    if (f.echo?.blast) out.push(ball(f.echo.blast[0], f.echo.blast[1], f.echo.blast[2], f.echo.radius ?? 12, 0))
    else if (f.echo?.edit && f.echo.box) out.push({ words: Int32Array.from(f.echo.edit), box: f.echo.box })
    else if (f.words) for (const e of read(f.words).edits) out.push(rows(e.runs, e.box))
  }
  return out
}

export async function portal(o: {
  gpu: Gpu
  far: Link
  realms: Realms
  /** The page's own world and its marcher. */
  world: World
  march: Marcher
  /** Another world made as the page's own is, and a marcher for a world. */
  make(): World
  marcher(world: World): Promise<Marcher>
  /** Lights a marcher as a realm's look says (its hour), or as the page's own. */
  light(march: Marcher, look: Realm['look']): void
  /** Stops the page's own frames while something is measured. */
  pause(on: boolean): void
  pose: Pose
}) {
  const { device } = o.gpu, M = 10
  const module = await shader(device, 'portal', CODE)
  const pipeline = await device.createRenderPipelineAsync({ label: 'portal', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: o.gpu.format }] }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } })
  const uniforms = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  let other: World | null = null, march2: Marcher | null = null, to2: Offscreen | null = null, bind: GPUBindGroup | null = null
  let gate: Gate | null = null, id = '', tint: readonly [number, number, number] = [1, 1, 1], opened = 0
  /** How many pixels of the other world are marched for each pixel of the window, each way; and how long the window takes to open, ms. */
  let scale = 1, opens = 600
  let side = 0, stepping = false
  const stats = { rect: [0, 0, 0, 0] as [number, number, number, number], steps: [] as unknown[] }

  /** The other world's eye for this one's: as far from where the window leads as this eye is from the window. */
  const through = (view: View): View => ({ ...view, eye: [view.eye[0] + gate!.to[0] - gate!.at[0], view.eye[1] + gate!.to[1] - gate!.at[1], view.eye[2] + gate!.to[2] - gate!.at[2]] })
  const across = (g: Gate): [number, number, number] => [Math.cos(g.yaw), 0, Math.sin(g.yaw)]
  /** The pixels of a picture the window covers (x, y, width, height), or null when none of it is in sight. */
  const rect = (g: Gate, view: View, size: readonly [number, number], open: number): [number, number, number, number] | null => {
    const a = across(g)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = 0
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [g.at[0] + a[0] * cx * g.size[0] / 2 * open - view.eye[0], g.at[1] + cy * g.size[1] / 2 * open - view.eye[1], g.at[2] + a[2] * cx * g.size[0] / 2 * open - view.eye[2]]
      const dot = (v: readonly number[]) => v[0] * p[0] + v[1] * p[1] + v[2] * p[2], z = dot(view.forward)
      if (z < 1) { behind++; continue }
      const x = (0.5 + dot(view.right) / z / view.tanHalf / (size[0] / size[1]) / 2) * size[0], y = (0.5 - dot(view.up) / z / view.tanHalf / 2) * size[1]
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
    if (behind === 4) return null
    // A corner behind the eye: the window may cover anything.
    if (behind) return [0, 0, size[0], size[1]]
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(size[0], Math.ceil(x1)); y1 = Math.min(size[1], Math.ceil(y1))
    return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null
  }
  const fit = (size: readonly [number, number]) => {
    const want: [number, number] = [Math.max(1, Math.round(size[0] * scale)), Math.max(1, Math.round(size[1] * scale))]
    if (!to2 || to2.size[0] !== want[0] || to2.size[1] !== want[1]) { to2?.destroy(); to2 = offscreen(o.gpu, want); bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: to2.color }] }) }
    return to2
  }
  /** The window's own pass: the other world's picture where the window is nearer than what this world has there. */
  const pane = (encoder: GPUCommandEncoder, to: Target, view: View, open: number) => {
    const g = gate!, a = across(g)
    device.queue.writeBuffer(uniforms, 0, new Float32Array([
      g.at[0] - view.eye[0], g.at[1] - view.eye[1], g.at[2] - view.eye[2], view.tanHalf,
      ...view.right, to.size[0] / to.size[1], ...view.up, scale, ...view.forward, open,
      ...a, g.size[0] / 2, ...tint, g.size[1] / 2,
    ]))
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }], depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' } })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bind!)
    pass.draw(6)
    pass.end()
  }
  /** The two worlds change places, and each marcher binds what is now its world's. The sun's maps are of the worlds as they were: drawn again. */
  const trade = () => { o.world.trade(other!); o.march.rebind(); march2!.rebind(); o.march.sun.spoilAll(); march2!.sun.spoilAll() }

  const self = {
    get gate() { return gate },
    get to() { return id },
    get other() { return other },
    /** How many tiles of the other world's sun maps are still to be drawn. */
    get undrawn() { return march2?.sun.undrawn ?? 0 },
    /** What the second world takes of the GPU's memory, MB: its pool of trees and its boxes, its sun's maps, the window's own picture and depth. */
    get memory() { return other ? { pool: (other.poolBuffer.size + other.topBuffer.size) / 2 ** 20, sun: (other.levels.length * SUN_SIDE * SUN_SIDE * 4) / 2 ** 20, picture: to2 ? (to2.size[0] * to2.size[1] * 8) / 2 ** 20 : 0 } : null },
    get scale() { return scale },
    set scale(v: number) { scale = v },
    get opens() { return opens },
    set opens(ms: number) { opens = ms },
    stats,
    /**
     * Opens a window to a realm: its stream is held, a second world is made round where the window leads with what
     * was done there, and the window opens. Resolves when all of that world is made, with how long each part took:
     * that time is all the loading there is.
     */
    async open(to: string, g: Gate, standing = false) {
      const began = performance.now()
      const realm = await o.far.ready(baseOf(to))
      const ready = performance.now() - began
      const first = !other
      other ??= o.make()
      march2 ??= await o.marcher(other)
      const built = performance.now() - began - ready
      const before = other.stats.made
      other.swap(editsOf(o.far.held()))
      o.far.onheld = (frame) => { for (const e of editsOf([frame])) other!.edit(e) }
      o.light(march2, realm.look)
      march2.rain = realm.look?.rain ?? 0
      tint = realm.look?.tint ?? [1, 1, 1]
      id = to; gate = g; side = 0
      // A window one has just come through stands open.
      opened = standing ? 0 : performance.now()
      let shown = 0
      for (;;) {
        await new Promise((done) => requestAnimationFrame(done))
        const s = other.stats
        if (!shown && other.levels.every((l) => l.whole.high.every((h, a) => h - l.whole.low[a] >= l.grid[a] / 2))) shown = performance.now() - began
        if (s.wanted === 0 && s.stale === 0 && performance.now() - began > 100) return { ready, built: first ? built : 0, shown, made: performance.now() - began, sectors: s.made - before, poolMb: s.poolUsed / 262144 }
      }
    },
    close() { gate = null; o.far.onheld = null },
    /** A frame: the other world is kept made round where this eye would be in it, and drawn into the window's pixels. Called after the page's own march into `to`. */
    draw(encoder: GPUCommandEncoder, to: Target, view: View, flags: number, time: number) {
      if (!gate || !other || !march2) return
      const v2 = through(view), open = Math.min(1, (performance.now() - opened) / opens)
      other.update(v2.eye)
      for (const level of other.moved) march2.sun.age(level)
      march2.tend(encoder, v2, other.nearlyWhole())
      const r = rect(gate, view, to.size, open)
      if (!r) return
      stats.rect = r
      const target = fit(to.size)
      march2.draw(encoder, target, v2, flags, time, undefined, [Math.floor(r[0] * scale), Math.floor(r[1] * scale), Math.max(1, Math.min(target.size[0] - Math.floor(r[0] * scale), Math.ceil(r[2] * scale))), Math.max(1, Math.min(target.size[1] - Math.floor(r[1] * scale), Math.ceil(r[3] * scale)))])
      pane(encoder, to, view, open)
    },
    /** Each frame, before drawing: whether the eye has gone through the window since the last. Through it, the page is in the other realm, the worlds having changed places, and the window leads back. */
    walk() {
      if (!gate || !other || stepping) return
      const g = gate, e = [o.pose.x * M - g.at[0], o.pose.y * M - g.at[1], o.pose.z * M - g.at[2]], a = across(g)
      // Which side of the window the eye is on, along the way the window faces.
      const now = Math.sign(e[0] * -a[2] + e[2] * a[0]) || side
      const was = side
      side = now
      if (!was || now === was || Math.abs(e[0] * a[0] + e[2] * a[2]) > g.size[0] / 2 || Math.abs(e[1]) > g.size[1] / 2) return
      void self.step()
    },
    /** Steps through, wherever the eye is: for a key, and for the checks. */
    async step() {
      if (!gate || !other || stepping) return null
      stepping = true
      const g = gate, from = o.realms.here, began = performance.now()
      const there: Pose = { ...o.pose, x: o.pose.x + (g.to[0] - g.at[0]) / M, y: o.pose.y + (g.to[1] - g.at[1]) / M, z: o.pose.z + (g.to[2] - g.at[2]) / M }
      // The window then stands in the other world, and leads back to where it stood in this one: from the very
      // moment the worlds change places, or the world behind it would be made round a place that is neither's.
      const back: Gate = { at: g.to, yaw: g.yaw, size: g.size, to: g.at }
      const stepped = await o.realms.step(id, there, () => { trade(); gate = back; id = from; side = 0 })
      const again = await self.open(from, back, true)
      stepping = false
      const took = { ...stepped, total: performance.now() - began, back: again }
      stats.steps.push(took)
      return took
    },
    /** What the window costs the GPU: the page's own march by itself, then with the other world marched into a window of a share of the picture, at the device's own pace, ms a frame at the canvas's full size. */
    async bench(view: View, flags: number, canvas: readonly [number, number]) {
      if (!gate || !other || !march2) return null
      const to = offscreen(o.gpu, canvas), v2 = through(view), was = scale, out: Record<string, number> = {}
      o.pause(true)
      out.own = (await pace(o.gpu, to, (encoder, t) => o.march.draw(encoder, t, view, flags, 0), 100)).ms
      out.other = (await pace(o.gpu, to, (encoder, t) => march2!.draw(encoder, t, v2, flags, 0), 100)).ms
      for (const share of [0.1, 0.25, 0.5, 1]) for (const s of [1, 0.5]) {
        scale = s
        const target = fit(canvas), side = Math.sqrt(share), w = Math.round(canvas[0] * side), h = Math.round(canvas[1] * side), x = (canvas[0] - w) >> 1, y = (canvas[1] - h) >> 1
        const only: [number, number, number, number] = [Math.floor(x * s), Math.floor(y * s), Math.max(1, Math.floor(w * s)), Math.max(1, Math.floor(h * s))]
        out[`window ${share * 100}% at ${s}`] = (await pace(o.gpu, to, (encoder, t) => { o.march.draw(encoder, t, view, flags, 0); march2!.draw(encoder, target, v2, flags, 0, undefined, only); pane(encoder, t, view, 1) }, 100)).ms
        // What one march that changed worlds at the window would cost at best: this world's march without the window's pixels, and the other's within them.
        if (s === 1) out[`own without ${share * 100}%`] = out.own - (await pace(o.gpu, to, (encoder, t) => o.march.draw(encoder, t, view, flags, 0, undefined, [x, y, w, h]), 100)).ms
      }
      scale = was
      o.pause(false)
      to.destroy()
      return out
    },
  }
  return self
}
