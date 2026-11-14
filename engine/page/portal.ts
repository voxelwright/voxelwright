// The portal (#264): another realm seen live through a window standing in this one, and walked into with nothing
// to wait for. A second world like the page's own is held beside it (world.ts), made round the place the window
// leads to with the other realm's edits (its stream is held by link.ts `ready`), and marched by a second marcher
// into the window's pixels alone, with the people who are there. The time the other place takes to be made is
// the time the window takes to open: until every box of it is whole over half its width the window shows light,
// and grows; then it clears. Walking through, the two worlds change places (world.ts `trade`, sun.ts `trade`):
// no sector is made, nothing is drawn again, and the window leads back.
import { offscreen, pace, shader, type Gpu, type Offscreen, type Target } from '../probe/gpu.ts'
import { ball, rows, type Edit } from './edits.ts'
import type { Held, Link, Realm, Someone } from './link.ts'
import type { Marcher, View } from './march.ts'
import type { People, Person } from './people.ts'
import { baseOf, type Pose, type Realms } from './realms.ts'
import { SUN_SIDE } from './sun.ts'
import { read } from './told.ts'
import type { World } from './world.ts'

/** A window: where its middle stands in this world and which way it faces (cells, radians from north towards east), how wide and high it is, and the place of the other world that its middle is. */
export interface Gate { at: [number, number, number]; yaw: number; size: [number, number]; to: [number, number, number] }
/** How wide and high a window is, in cells: three metres by four, a doorway for a person and what they ride. */
export const SIZE: [number, number] = [30, 40]

const CODE = /* wgsl */ `
const NEAR = 1.0;
const FAR = 100000.0;
struct U { at: vec3f, tanHalf: f32, right: vec3f, aspect: f32, up: vec3f, veil: f32, forward: vec3f, open: f32, across: vec3f, halfWide: f32, tint: vec3f, halfHigh: f32, size: vec2f, time: f32, pad: f32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var other: texture_2d<f32>;
@group(0) @binding(2) var smooth_: sampler;
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
  let seen = textureSampleLevel(other, smooth_, in.pos.xy / u.size, 0.0).rgb * u.tint;
  // Until the place behind it is made the window is light: slow bands of it, brighter to the middle.
  let r = length(in.c);
  let bands = 0.5 + 0.5 * sin(r * 9.0 - u.time * 3.0 + sin(in.c.x * 4.0 + u.time) * 1.5);
  let light = mix(vec3f(0.55, 0.7, 1.0), vec3f(1.0, 0.97, 0.9), bands * (1.0 - 0.6 * r)) * (1.1 - 0.35 * r);
  // A bright rim, so that the window is seen to be one.
  let rim = smoothstep(0.93, 1.0, max(abs(in.c.x), abs(in.c.y)));
  return vec4f(mix(mix(seen, light, u.veil), vec3f(1.0, 0.92, 0.7) * 1.6, rim), 1.0);
}
`

/** What a world said, as edits of cells: its asks as echoes and the core's words. */
function editsOf(frames: Held[]): Edit[] {
  const out: Edit[] = []
  for (const f of frames) {
    if (f.echo?.blast) out.push(ball(f.echo.blast[0], f.echo.blast[1], f.echo.blast[2], f.echo.radius ?? 12, 0))
    else if (f.echo?.edit && f.echo.box) out.push({ words: Int32Array.from(f.echo.edit), box: f.echo.box })
    else if (f.words) for (const e of read(f.words).edits) out.push(rows(e.runs, e.box))
  }
  return out
}
/** A number of its own for a name, so that a name always looks the same person (as presence.ts has it). */
const seedOf = (name: string) => { let h = 2166136261; for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h | 0 }

export async function portal(o: {
  gpu: Gpu
  far: Link
  realms: Realms
  /** The page's own world and its marcher. */
  world: World
  march: Marcher
  /** Another world made as the page's own is, a marcher for a world, and what draws people lit by a marcher. */
  make(): World
  marcher(world: World): Promise<Marcher>
  people(march: Marcher): Promise<People>
  /** The town's residents as a realm with that look has them, leaving out those a rule there has taken: for the people behind the window. */
  residents(look: () => Realm['look'], taken: ReadonlySet<number>): People['from'][number]
  /** Lights a marcher as a realm's look says (its hour), or as the page's own. */
  light(march: Marcher, look: Realm['look']): void
  /** Stops the page's own frames while something is measured. */
  pause(on: boolean): void
  pose: Pose
  /** Where the person's feet are when on foot (cells) and how they face, or null as an eye. And who they are to look at. */
  feet(): { at: readonly [number, number, number]; yaw: number; speed: number } | null
  /** Where the eye rides when on foot: behind the body, or in its head. Set to change it. */
  riding(to?: 'behind' | 'head'): 'behind' | 'head'
  /** What a cell of this world is, edits and all (0 is air), and how high the land's own ground is at a place. */
  kind(x: number, y: number, z: number): number
  ground(x: number, z: number): number
  /** Where this page began (metres): where home is entered when nothing else says. */
  began: Pose
  /** Says a line to the person. */
  notice(text: string): void
}) {
  const { device } = o.gpu, M = 10
  const module = await shader(device, 'portal', CODE)
  const pipeline = await device.createRenderPipelineAsync({ label: 'portal', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: o.gpu.format }] }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } })
  const uniforms = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  let other: World | null = null, march2: Marcher | null = null, folk2: People | null = null
  /** The other world's picture, kept at each size it has been drawn at: the window's pixels are marched at fewer the more of the picture it covers. */
  const pictures = new Map<string, { to: Offscreen; bind: GPUBindGroup }>()
  let gate: Gate | null = null, id = '', look: Realm['look'], tint: readonly [number, number, number] = [1, 1, 1]
  /** How far open the window is (0 to 1), how far it is to be, and how much of it is still light (1) and not yet the other place (0). */
  let open = 0, veil = 1, closing = false, lastFrame = performance.now()
  /** A size fixed for a measurement, or 0: the window's own choice. */
  let fixed = 0
  let side = 0, stepping = false, asked = 0
  /** How the eye rode before the person came near the window, while it rides in their head; else null. */
  let rode: 'behind' | 'head' | null = null
  const stats = { rect: [0, 0, 0, 0] as [number, number, number, number], scale: 1, share: 0, steps: [] as unknown[], opened: null as unknown, released: false }
  /** How long a closed window keeps the other realm's stream, ms. */
  const LET_GO = Number(new URLSearchParams(location.search).get('portalkeeps') ?? 60) * 1000
  /** Where one left each realm, by its id: the foot of the window one went through there. Going back leads there. */
  const left = new Map<string, [number, number, number]>()
  /** Who is in the other realm, as its held stream says: drawn behind the window. And which residents a rule there has taken. */
  const theirs = new Map<string, { who: Someone; shown: [number, number, number]; yaw: number; stride: number; walking: number; heard: number }>(), taken = new Set<number>()
  const hears = (who: Someone) => {
    if (who.by === o.far.me) return
    if (who.gone) { const was = theirs.get(who.by)?.who.was; if (was !== undefined) taken.delete(was); theirs.delete(who.by); return }
    if (typeof who.was === 'number') taken.add(who.was)
    const known = theirs.get(who.by)
    if (known) { known.who = who; known.heard = performance.now() } else theirs.set(who.by, { who, shown: [...who.at], yaw: who.yaw, stride: 0, walking: 0, heard: performance.now() })
  }
  const shownThere: Person[] = []
  const there: People['from'][number] = (_view, seconds) => {
    const now = performance.now(), ease = 0.2
    shownThere.length = 0
    for (const [by, t] of theirs) {
      if (now - t.heard > 5000) { theirs.delete(by); continue }
      let moved = 0
      for (let a = 0; a < 3; a++) { const step = (t.who.at[a] - t.shown[a]) * ease; t.shown[a] += step; if (a !== 1) moved = Math.hypot(moved, step) }
      let turn = t.who.yaw - t.yaw
      turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2
      t.yaw += turn * ease
      t.stride += moved / 7
      t.walking += ((moved > 0.05 ? 1 : 0) - t.walking) * 0.15
      shownThere.push({ at: t.shown, yaw: t.yaw, seed: t.who.was ?? seedOf(t.who.name), stride: t.stride, walking: t.walking, down: t.who.down ? 1 : 0, time: seconds, name: t.who.name, look: t.who.look })
    }
    return shownThere
  }

  /** Which way the looks through the window go, along the ground (set each frame it is drawn). */
  let way: [number, number] = [0, 0], seenThere = 0
  /** Only those past the window, where it stands in the other world: someone between that eye and the window is not behind it, as the cells there are not (the looks begin at the window). */
  const past = (source: People['from'][number]): People['from'][number] => (view, seconds) => {
    const all = source(view, seconds), g = gate
    const kept = g ? all.filter((p) => (p.at[0] - g.to[0]) * way[0] + (p.at[2] - g.to[2]) * way[1] >= 0) : all
    if (source === there) seenThere = kept.length
    return kept
  }
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
  const fit = (size: readonly [number, number], scale: number) => {
    const want: [number, number] = [Math.max(1, Math.round(size[0] * scale)), Math.max(1, Math.round(size[1] * scale))], key = want.join('x')
    let p = pictures.get(key)
    if (!p) {
      // The page's own picture changes size as it steers: what was kept for other sizes is let go.
      if (pictures.size >= 6) { for (const old of pictures.values()) old.to.destroy(); pictures.clear() }
      const to = offscreen(o.gpu, want)
      pictures.set(key, p = { to, bind: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: to.color }, { binding: 2, resource: sampler }] }) })
    }
    return p
  }
  /** The window's own pass: the other world's picture where the window is nearer than what this world has there. */
  const pane = (encoder: GPUCommandEncoder, to: Target, view: View, bind: GPUBindGroup, open: number, veil: number, time: number) => {
    const g = gate!, a = across(g)
    device.queue.writeBuffer(uniforms, 0, new Float32Array([
      g.at[0] - view.eye[0], g.at[1] - view.eye[1], g.at[2] - view.eye[2], view.tanHalf,
      ...view.right, to.size[0] / to.size[1], ...view.up, veil, ...view.forward, open,
      ...a, g.size[0] / 2, ...tint, g.size[1] / 2, to.size[0], to.size[1], time, 0,
    ]))
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }], depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' } })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bind)
    pass.draw(6)
    pass.end()
  }
  /** The two worlds change places, and each marcher binds what is now its world's; the sun's maps go with their worlds. */
  const trade = () => { o.world.trade(other!); o.march.rebind(); march2!.rebind(); o.march.sun.trade(march2!.sun, device) }
  /** How much of the other place is made, 0 to 1: 1 when every box is whole over half its width, which is a picture with nothing missing. */
  const made = () => {
    if (!other) return 0
    let sum = 0
    for (const l of other.levels) sum += Math.min(1, ...l.whole.high.map((h, a) => (h - l.whole.low[a]) / (l.grid[a] / 2)))
    return sum / other.levels.length
  }
  /** Where the person is, for placing and for going through: the feet when on foot, else under the eye. */
  const body = (): [number, number, number] => { const f = o.feet()?.at; return f ? [f[0], f[1] + 16.5, f[2]] : [o.pose.x * M, o.pose.y * M, o.pose.z * M] }
  const eye = (): [number, number, number] => [o.pose.x * M, o.pose.y * M, o.pose.z * M]
  /** How far a place is before the window (over 0) or past it (under), along the way the window faces, counted from the side the person came up to it on. */
  const before = (g: Gate, p: readonly number[]) => { const a = across(g); return ((p[0] - g.at[0]) * -a[2] + (p[2] - g.at[2]) * a[0]) * side }
  /**
   * A place for a window before the person, facing them: near, on the ground, with room for all of it and a clear
   * walk to it. Tried straight ahead from three metres out to seven, then to each side of that and at last behind;
   * a place with room but no clear walk is taken only if none all the way round has both.
   */
  const stand = (): { at: [number, number, number]; yaw: number } => {
    const at = body(), feet = Math.round(at[1] - 16.5)
    /** Whether a body can be where a column of cells is: nothing from the shins to over the head, taking the ground as it is found. */
    const open = (x: number, z: number, from: number) => { for (let up = 3; up <= 18; up += 3) if (o.kind(x, from + up, z)) return false; return true }
    let roomy: { at: [number, number, number]; yaw: number } | null = null, any: { at: [number, number, number]; yaw: number } | null = null
    // Ahead first; then round to each side, and behind if nowhere ahead can be walked to: a window one must turn to see is better than one behind a wall.
    for (const turn of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.57, -1.57, 2.2, -2.2, Math.PI]) for (const far of [40, 30, 50, 60, 70]) {
      const yaw = o.pose.yaw + turn, ahead = [Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), Math.sin(yaw)]
      const x = Math.round(at[0] + ahead[0] * far), z = Math.round(at[2] + ahead[1] * far)
      // The ground there: the first cell with something under it and air in it, from a little over the eye down.
      let y = Math.round(at[1]) + 20
      while (y > at[1] - 80 && !o.kind(x, y - 1, z)) y--
      if (o.kind(x, y, z) || Math.abs(y - feet) > 12) continue
      const here = { at: [x, y + SIZE[1] / 2, z] as [number, number, number], yaw }
      any ??= here
      let room = true
      for (let across = -SIZE[0] / 2; across <= SIZE[0] / 2 && room; across += 5) for (let up = 3; up < SIZE[1] && room; up += 6) for (let deep = -3; deep <= 3 && room; deep++) {
        if (o.kind(Math.round(x + right[0] * across + ahead[0] * deep), y + up, Math.round(z + right[1] * across + ahead[1] * deep))) room = false
      }
      if (!room) continue
      roomy ??= here
      // The walk to it: a body's width of open way all along, the ground rising or falling no more than a kerb at a step.
      let clear = true, ground = feet
      // A cell at a time: a wall one cell thick is a wall.
      for (let step = 3; step < far && clear; step++) for (const side of [-4, 0, 4]) {
        const px = Math.round(at[0] + ahead[0] * step + right[0] * side), pz = Math.round(at[2] + ahead[1] * step + right[1] * side)
        let g = ground + 3
        while (g > ground - 4 && !o.kind(px, g - 1, pz)) g--
        if (o.kind(px, g, pz) || !open(px, pz, g)) { clear = false; break }
        if (side === 0) ground = g
      }
      if (clear) return here
    }
    return roomy ?? any ?? { at: [Math.round(at[0] + Math.sin(o.pose.yaw) * 40), Math.round(at[1]) + 2, Math.round(at[2] - Math.cos(o.pose.yaw) * 40)], yaw: o.pose.yaw }
  }
  /** The foot of where one enters a realm: where one left it, else where it says one arrives, else where this page began. */
  const entry = (to: string, realm: Realm): [number, number, number] => {
    const was = left.get(to)
    if (was) return was
    const a = realm.arrive?.at
    if (a) return [a[0], a.length === 3 ? a[1] : o.ground(a[0], a[a.length - 1]), a[a.length - 1]]
    return [Math.round(o.began.x * M), o.ground(Math.round(o.began.x * M), Math.round(o.began.z * M)), Math.round(o.began.z * M)]
  }

  const self = {
    get gate() { return gate },
    get to() { return id },
    get other() { return other },
    /** How far open the window is, how much of it is still light, and whether one may walk through. */
    get state() { return { open, veil, passable: !!gate && !closing && veil < 0.5 && !stepping, people: seenThere, there: shownThere.length, drawn: folk2?.drawn.people ?? 0 } },
    /** A size for the other world's picture fixed for a measurement (0: the window's own choice). */
    set scale(v: number) { fixed = v },
    stats,
    /** How many tiles of the other world's sun maps are still to be drawn. */
    get undrawn() { return march2?.sun.undrawn ?? 0 },
    /** What the second world takes of the GPU's memory, MB: its pool of trees and its boxes, its sun's maps, the window's own pictures and depth. */
    get memory() { let picture = 0; for (const p of pictures.values()) picture += (p.to.size[0] * p.to.size[1] * 8) / 2 ** 20; return other ? { pool: (other.poolBuffer.size + other.topBuffer.size) / 2 ** 20, sun: (other.levels.length * SUN_SIDE * SUN_SIDE * 4) / 2 ** 20, picture } : null },
    /**
     * The key: with no window, opens one to a realm (the one given, else from home the selected realm, else home)
     * before the person; with one, closes it. Resolves when the window is open, or closed.
     */
    async toggle(to?: string) {
      if (gate && !closing) { self.close(); return null }
      const target = to ?? (o.realms.here === 'home' ? o.realms.selected : 'home')
      if (!target || target === o.realms.here) { o.notice(target ? 'You are there already' : 'No other realm yet: open the wheel and make one'); return null }
      return self.open(target)
    },
    /**
     * Opens a window to a realm: its stream is held, a second world is made round where the window leads with what
     * was done there, and the window opens as that world arrives. `g` says where it stands and leads; without it,
     * before the person, leading to where one enters that realm. Resolves when all of that world is made, with how
     * long each part took: that time is all the loading there is.
     */
    async open(to: string, g?: Gate, standing = false) {
      const began = performance.now(), mine = ++asked
      stats.released = false
      // Where it stands is settled at once, as the person stood when they asked; where it leads, when the realm has said what it is.
      const here = g ? null : stand()
      let realm: Realm
      try { realm = await o.far.ready(baseOf(to)) } catch { o.notice('That realm could not be reached'); return null }
      if (mine !== asked) return null
      const ready = performance.now() - began
      const first = !other
      other ??= o.make()
      march2 ??= await o.marcher(other)
      if (!folk2) { folk2 = await o.people(march2); folk2.from.push(past(there), past(o.residents(() => look, taken))) }
      const built = performance.now() - began - ready
      const before = other.stats.made
      const held = o.far.held()
      other.swap(editsOf(held))
      theirs.clear(); taken.clear()
      for (const f of held) if (f.here) hears(f.here)
      o.far.onheld = (frame) => { if (frame.here) hears(frame.here); else for (const e of editsOf([frame])) other!.edit(e) }
      look = realm.look
      o.light(march2, look)
      march2.rain = look?.rain ?? 0
      tint = look?.tint ?? [1, 1, 1]
      if (!g) { const foot = entry(to, realm); g = { at: here!.at, yaw: here!.yaw, size: SIZE, to: [foot[0], foot[1] + SIZE[1] / 2, foot[2]] } }
      id = to; gate = g; side = 0; closing = false
      // A window one has just come through stands open and clear.
      open = standing ? 1 : 0.02; veil = standing ? 0 : 1
      let shown = 0, clear = 0
      for (;;) {
        await new Promise((done) => requestAnimationFrame(done))
        if (mine !== asked || gate !== g) return null
        const s = other.stats
        if (!shown && made() >= 1) shown = performance.now() - began
        if (!clear && veil < 0.5 && open >= 1) clear = performance.now() - began
        if (s.wanted === 0 && s.stale === 0 && performance.now() - began > 100) return stats.opened = { to, ready, built: first ? built : 0, shown: shown || performance.now() - began, clear: clear || performance.now() - began, made: performance.now() - began, sectors: s.made - before, poolMb: s.poolUsed / 262144 }
      }
    },
    /** Where a window would stand if it were opened now: for the checks. */
    where: () => stand(),
    /** A window to a realm, whatever is open now: one that leads there already is left as it is, another is closed first. */
    async lead(to: string) {
      if (gate && !closing && id === to) return null
      if (gate) { gate = null; closing = false; if (rode !== null) { o.riding(rode); rode = null } }
      return self.toggle(to)
    },
    /** Closes the window: it goes in on itself. The other world stays held, so opened again it is there at once. */
    close() {
      if (gate) closing = true
      if (rode !== null) { o.riding(rode); rode = null }
      // Left closed for a minute, the other realm's stream is let go, so that a realm nobody is in can rest. Its
      // sectors stay held: opened again, only what was done there since is made.
      const mine = asked
      setTimeout(() => { if (mine === asked && !gate) { o.far.release(); o.far.onheld = null; theirs.clear(); taken.clear(); stats.released = true } }, LET_GO)
    },
    /** A frame: the other world is kept made round where this eye would be in it, and drawn into the window's pixels with whoever is there. Called after the page's own march into `to`. True if the other world was marched this frame (and so timed, if `timing` was given). */
    draw(encoder: GPUCommandEncoder, to: Target, view: View, flags: number, time: number, timing?: GPURenderPassTimestampWrites): boolean {
      const now = performance.now(), dt = Math.min(0.1, (now - lastFrame) / 1000)
      lastFrame = now
      if (!gate || !other || !march2) return false
      // It grows as the place behind it arrives, and no faster than a third of a second for all of it; made, it clears.
      const arrived = made()
      if (closing) { open -= dt / 0.25; if (open <= 0.02) { gate = null; closing = false; return false } }
      else open = Math.min(1, open + dt / 0.35, Math.max(open, 0.12 + 0.88 * arrived))
      veil = Math.max(0, Math.min(1, veil + (arrived >= 1 ? -dt / 0.3 : dt / 0.2)))
      const v2 = through(view)
      other.update(v2.eye)
      for (const level of other.moved) march2.sun.age(level)
      march2.tend(encoder, v2, other.nearlyWhole())
      const r = rect(gate, view, to.size, open)
      if (!r) return false
      stats.rect = r
      // The more of the picture the window covers, the fewer pixels of the other world are marched for each of its own
      // (measured: over half the picture at full size it costs 12.9 ms, at half size 5.1).
      const share = stats.share = (r[2] * r[3]) / (to.size[0] * to.size[1]), scale = stats.scale = fixed || (share <= 0.12 ? 1 : share <= 0.3 ? 0.75 : 0.5)
      const picture = fit(to.size, scale), target = picture.to
      // While it is all light there is nothing of the other world to draw.
      const marched = veil < 1
      if (marched) {
        const only: [number, number, number, number] = [Math.floor(r[0] * scale), Math.floor(r[1] * scale), Math.max(1, Math.min(target.size[0] - Math.floor(r[0] * scale), Math.ceil(r[2] * scale))), Math.max(1, Math.min(target.size[1] - Math.floor(r[1] * scale), Math.ceil(r[3] * scale)))]
        // The other world's looks begin at the window, where it stands there: its land may rise between that eye and the window.
        const a = across(gate), away = Math.sign((view.eye[0] - gate.at[0]) * -a[2] + (view.eye[2] - gate.at[2]) * a[0]) || 1, n: [number, number, number] = [a[2] * away, 0, -a[0] * away]
        way = [n[0], n[2]]
        march2.draw(encoder, target, v2, flags, time, timing, only, [n[0], n[1], n[2], n[0] * gate.to[0] + n[2] * gate.to[2]])
        folk2?.draw(encoder, target, v2, time)
      }
      pane(encoder, to, view, picture.bind, open, veil, time)
      return marched
    },
    /** Each frame, before drawing: whether the person has gone through the window since the last. Through it, the page is in the other realm, the worlds having changed places, and the window leads back. */
    walk() {
      if (!gate || !other || stepping || closing) return
      const g = gate, a = across(g)
      // Near the window a person on foot sees with their own eyes: the eye that rides behind them would be on one side
      // of it and the body on the other, each in a different world. Away from it the eye rides as it did.
      const f = o.feet()?.at
      const near = !!f && Math.abs((f[0] - g.at[0]) * -a[2] + (f[2] - g.at[2]) * a[0]) < 45 && Math.abs((f[0] - g.at[0]) * a[0] + (f[2] - g.at[2]) * a[2]) < g.size[0] / 2 + 12
      if (near && rode === null) { rode = o.riding(); o.riding('head') } else if (!near && rode !== null) { o.riding(rode); rode = null }
      const at = eye(), e = [at[0] - g.at[0], at[1] - g.at[1], at[2] - g.at[2]], far = e[0] * -a[2] + e[2] * a[0]
      // Which side of the window the eye came up to it on: settled once it is a step away from it.
      if (!side) { if (Math.abs(far) > 6) side = Math.sign(far); return }
      // It goes through when it is within two cells of the window, inside its frame: nearer than that the window would
      // be too close to be drawn, and the world behind it seen for a frame.
      if (far * side > 2) return
      if (veil >= 0.5 || Math.abs(e[0] * a[0] + e[2] * a[2]) > g.size[0] / 2 || Math.abs(e[1]) > g.size[1] / 2 + 10) { if (far * side < -6) side = -side; return }
      void self.step()
    },
    /** Steps through, wherever the person is: for the checks. */
    async step() {
      if (!gate || !other || stepping) return null
      stepping = true
      const g = gate, from = o.realms.here, began = performance.now(), a = across(g)
      // The eye is put two cells past the window there, and everything with it: as far from the place the window leads
      // to as it was from the window. On foot the body, which went through before the eye, is set down where it was seen.
      const push = side ? before(g, eye()) + 2 : 0, shift = [g.to[0] - g.at[0] + a[2] * side * push, g.to[1] - g.at[1], g.to[2] - g.at[2] - a[0] * side * push]
      const moved = (p: readonly number[]): Pose => ({ ...o.pose, x: (p[0] + shift[0]) / M, y: (p[1] + shift[1]) / M, z: (p[2] + shift[2]) / M })
      const there = moved(eye()), stood = o.feet() ? moved(body()) : undefined
      left.set(from, [g.at[0], g.at[1] - g.size[1] / 2, g.at[2]])
      // The window then stands in the other world, and leads back to where it stood in this one: from the very
      // moment the worlds change places, or the world behind it would be made round a place that is neither's.
      const back: Gate = { at: g.to, yaw: g.yaw, size: g.size, to: g.at }
      const stepped = await o.realms.step(id, there, () => { trade(); gate = back; id = from; side = 0; theirs.clear(); taken.clear() }, stood)
      const again = await self.open(from, back, true)
      stepping = false
      const took = { ...stepped, total: performance.now() - began, back: again }
      stats.steps.push(took)
      return took
    },
    /** What the window costs the GPU: the page's own march by itself, then with the other world marched into a window of a share of the picture, at the device's own pace, ms a frame at the canvas's full size. */
    async bench(view: View, flags: number, canvas: readonly [number, number]) {
      if (!gate || !other || !march2) return null
      const to = offscreen(o.gpu, canvas), v2 = through(view), out: Record<string, number> = {}
      o.pause(true)
      out.own = (await pace(o.gpu, to, (encoder, t) => o.march.draw(encoder, t, view, flags, 0), 100)).ms
      out.other = (await pace(o.gpu, to, (encoder, t) => march2!.draw(encoder, t, v2, flags, 0), 100)).ms
      for (const share of [0.1, 0.25, 0.5, 1]) for (const s of [1, 0.75, 0.5]) {
        const picture = fit(canvas, s), side = Math.sqrt(share), w = Math.round(canvas[0] * side), h = Math.round(canvas[1] * side), x = (canvas[0] - w) >> 1, y = (canvas[1] - h) >> 1
        const only: [number, number, number, number] = [Math.floor(x * s), Math.floor(y * s), Math.max(1, Math.floor(w * s)), Math.max(1, Math.floor(h * s))]
        out[`window ${share * 100}% at ${s}`] = (await pace(o.gpu, to, (encoder, t) => { o.march.draw(encoder, t, view, flags, 0); march2!.draw(encoder, picture.to, v2, flags, 0, undefined, only); folk2?.draw(encoder, picture.to, v2, 0); pane(encoder, t, view, picture.bind, 1, 0, 0) }, 100)).ms
        // What one march that changed worlds at the window would cost at best: this world's march without the window's pixels, and the other's within them.
        if (s === 1) out[`own without ${share * 100}%`] = out.own - (await pace(o.gpu, to, (encoder, t) => o.march.draw(encoder, t, view, flags, 0, undefined, [x, y, w, h]), 100)).ms
      }
      o.pause(false)
      to.destroy()
      return out
    },
  }
  return self
}
