// The stage (#419, #421): one scene of the engine drawn from static files, and what comes loose in it moved. It is
// what the player (player.ts) and the landing world (landing/landing.ts) both stand on: the core, the makers of
// sectors, the march, the mover, the pieces, crumbs and smoke, and the frame that draws them. Whoever uses it says
// where the eye is each frame (`view`), and may add to a frame (`each`, `passes`) and hear what breaks (`broke`).
// No server is asked anything: there is no making, no talk, no realm and no shared world.
//
//   ?scene=scenes/sample.json   the scene (scene.ts says what one holds), an address beside the page or anywhere that lets it be read
//   ?grid=8,8,8  ?levels=6  ?pool=64  ?workers=4   how much of the world round the scene is held: small, for a picture in a page
//   ?scale=0.75  pixels drawn for each pixel shown, each way: unsaid, it follows the GPU as main.ts does
import { offscreen, openGpu, type Gpu, type Offscreen, type Target } from '../probe/gpu.ts'
import { glow } from '../page/glow.ts'
import { MIRRORS, SHADOWS, marcher, materials, palette, type Marcher, type View } from '../page/march.ts'
import { crumbs, type Crumbs } from '../page/crumbs.ts'
import { puffs, type Puffs } from '../page/puffs.ts'
import { pieces, type Piece } from '../page/pieces.ts'
import { rows, stream, type Edit } from '../page/edits.ts'
import { read } from '../page/told.ts'
import { World } from '../page/world.ts'
import { open } from '../page/bay.ts'
import type { Answer, Ask } from '../page/mover.ts'
import { sceneOf, type Scene } from './scene.ts'

/** How the core pulls things down, cells a second each second (bodies.rs `G`). */
export const G = 98

export interface Core { memory: WebAssembly.Memory; ground_at(x: number, z: number): number; world_kind(x: number, y: number, z: number): number; edits_room(words: number): number; merge_rows(lod: number, x0: number, x1: number, z0: number, z1: number): number; merged_words(): number }

/** What is under a place on the picture: how far off (cells), where, and of what. */
export interface Met { t: number; at: [number, number, number]; material: number; colour: number }

export interface Stage {
  readonly canvas: HTMLCanvasElement
  readonly query: URLSearchParams
  readonly gpu: Gpu
  readonly core: Core
  readonly scene: Scene
  readonly world: World
  readonly march: Marcher
  readonly debris: Crumbs
  readonly smoke: Puffs
  /** The tangent of half the angle the picture covers from top to bottom. */
  readonly tanHalf: number
  /** Where the eye is this frame: whoever uses the stage says, before `start`. */
  view: () => View
  /** Called at the start of every frame with the seconds since the last, before the view is asked for. */
  each: ((dt: number) => void) | null
  /** Drawn after the world and what moves in it, each frame, in order: into the picture, tested against its depth. */
  readonly passes: ((encoder: GPUCommandEncoder, to: Target, v: View, time: number) => void)[]
  /** Heard when cells were taken out of the world by what moves in it (something broke): the box they were in, and how many rows. */
  broke: ((box: Edit['box'], rows: number) => void) | null
  /** Heard once, when the first picture with the scene in it has been drawn: ms since the page was asked for, and when the first picture of all was. */
  seenNear: ((ms: number, first: number) => void) | null
  /** The view turned to look along the line through a place on the picture (CSS pixels from its corner). */
  through(px: number, py: number): View
  /** What is under a place on the picture, or null for sky. */
  under(px: number, py: number): Promise<Met | null>
  /** Throws a ball along a view at something `far` cells off: `hard` is 0 for a tap to 1 for the hardest. It is lifted by what it will drop on the way, so a soft throw lands where it was aimed. */
  toss(v: View, far: number, hard: number, kind?: number): void
  /** The hour of the day, 0 to 24: null is the sun where it always stands. */
  hour(h: number | null): void
  /** The world as the scene has it again: everything broken, fallen and thrown since is forgotten. */
  restore(): void
  /** For this many seconds nothing that is loose moves on: the moment after something big breaks. */
  still: number
  /** Whether frames are drawn. While they are not, nothing is asked of the GPU or of the mover. */
  readonly running: boolean
  rest(): void
  go(): void
  start(): void
  /** For whoever measures: nothing of the page's own reads these. */
  readonly gaps: number[]
  readonly seen: { first: number; near: number; whole: number }
  readonly frameMs: number
  readonly gpuMs: number
  readonly cpuMs: number
  readonly scale: number
  readonly bodies: number
  readonly pieces: number
  readonly thrown: number
  readonly broken: number
  readonly frames: number
}

/** The ball a poke throws: its half in cells, and what it is made of (wood). Of 60 cells or more, as this is, a body breaks what is built where it strikes hard enough (bodies.rs); thrown softly it only knocks, and held longest it breaks itself as well. */
const BALL = { radius: 3, kind: 10 }
/** How fast a tap throws it and how fast the hardest throw does, cells a second. */
const SOFT = 90, HARD = 600

/** `unsaid` is the scene shown when the page's address names none. */
export async function stage(failed: (e: unknown) => void, unsaid = 'scenes/sample.json'): Promise<Stage> {
  const query = new URLSearchParams(location.search)
  const numbers = (name: string, fallback: number[]) => query.get(name)?.split(',').map(Number) ?? fallback
  const canvas = document.querySelector('canvas')!
  const fail = (e: unknown) => { stopped = true; console.error(e); failed(e) }
  let stopped = false, resting = false, begun = false

  const [gpu, scene, core] = await Promise.all([
    openGpu(),
    fetch(query.get('scene') ?? unsaid).then(async (r) => { if (!r.ok) throw new Error(`the scene could not be read: ${r.status}`); return sceneOf(await r.json()) }),
    open<Core>(new URL('../page/core.wasm', import.meta.url).href),
  ])
  const { device } = gpu
  void device.lost.then((info) => fail(new Error(`the GPU was lost: ${info.message || info.reason}`)))
  const context = canvas.getContext('webgpu')!
  context.configure({ device, format: gpu.format, alphaMode: 'opaque' })

  // Edits, one after another, as one edit of rows (the core's `merge_rows`): as main.ts has it.
  const merge = (edits: readonly Edit[], lod: number, x0: number, x1: number, z0: number, z1: number): Edit => {
    const words = stream(edits), room = core.edits_room(words.length)
    new Int32Array(core.memory.buffer, room, words.length).set(words)
    const n = core.merge_rows(lod, x0, x1, z0, z1), merged = new Int32Array(core.memory.buffer, core.merged_words(), n).slice()
    let y0 = 0, y1 = 0
    for (let i = 2; i < n; i += 5) { y0 = i === 2 ? merged[4] : Math.min(y0, merged[i + 2]); y1 = i === 2 ? merged[4] + 1 : Math.max(y1, merged[i + 2] + 1) }
    return { words: merged, box: [x0, y0, z0, x1, y1, z1] }
  }
  // A picture in a page holds far less of the world than the engine's own page does (main.ts: 16 x 8 x 16 sectors, 9
  // boxes, 256 MB, up to 6 makers): two of these share a page with its words.
  const room = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
  const poolMb = Math.min(Number(query.get('pool') ?? 64), Math.floor(room / (1 << 20)))
  const world = new World(device, {
    merge,
    grid: numbers('grid', [8, 8, 8]) as [number, number, number],
    levels: Number(query.get('levels') ?? 6),
    poolWords: (poolMb << 20) / 4,
    workers: Number(query.get('workers') ?? Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 2))),
  })
  // The scene's own cells are there before the first sector is made: nothing is made twice.
  const sceneEdits: Edit[] = scene.edits.map((e) => ({ words: Int32Array.from(e.edit), box: e.box }))
  for (const edit of sceneEdits) world.edit(edit)

  const march = await marcher(device, gpu.format, world)
  const [blit, debris, smoke] = await Promise.all([glow(gpu), crumbs(device, gpu.format), puffs(device, gpu.format)])
  const falling = await pieces(device, gpu.format, march)
  const colours = palette(), stuff = materials()
  const hue = (kind: number) => (kind >> 8 ? colours.subarray((kind >> 8) * 4, (kind >> 8) * 4 + 3) : stuff.subarray((kind & 15) * 8, (kind & 15) * 8 + 3))
  const tanHalf = Math.tan((Number(query.get('fov') ?? 50) * Math.PI) / 360)

  /** The view turned to look along the line through a place on the picture (CSS pixels from its corner). */
  const through = (px: number, py: number): View => {
    const v = self.view(), h = canvas.clientHeight / 2, x = ((px - canvas.clientWidth / 2) / h) * tanHalf, y = ((h - py) / h) * tanHalf
    const d = v.forward.map((f, a) => f + v.right[a] * x + v.up[a] * y), l = Math.hypot(d[0], d[1], d[2])
    return { ...v, forward: [d[0] / l, d[1] / l, d[2] / l] }
  }

  // ── The hour ────────────────────────────────────────────────────────────
  // As main.ts has it: the sun goes from the east at six over the south to the west at eighteen.
  /** How much colour and how much contrast the last pass gives the picture (glow.ts): the day's, until an hour is set. */
  let grade: [number, number] = [0.9, 0.1]
  const hour = (h: number | null) => {
    let sun: [number, number, number] = [0.52, 0.62, 0.59], day = 1, low = 0
    if (h !== null) {
      const a = (((((h % 24) + 24) % 24) - 6) / 12) * Math.PI, east = [0.8, 0, 0.6], top = [-0.27, 0.9, 0.36]
      const at = east.map((e, i) => Math.cos(a) * e + Math.sin(a) * top[i])
      const ease = (lo: number, hi: number, v: number) => { const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t) }
      day = ease(-0.1, 0.1, at[1])
      low = 1 - ease(0.02, 0.5, at[1])
      sun = day === 0 ? [0.45, 0.7, -0.55] : [at[0], Math.max(at[1], 0.06), at[2]]
    }
    march.light(sun, day, low)
    const noon = day * (1 - low)
    grade = h === null ? [0.9, 0.1] : [1.25 - 0.2 * noon, 0.35 - 0.1 * noon]
    smoke.light(sun, day)
    debris.light(sun, day)
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  // How many pixels are marched for each pixel shown follows the GPU, by main.ts's rule (`steer`), without its
  // answer to a sudden dear view, and with one more test of the GPU's clock.
  const fixed = query.has('scale')
  let scale = Number(query.get('scale') ?? 0.75), wait = 0
  const clocked = gpu.canTime && navigator.maxTouchPoints === 0
  const steer = (budget: number) => {
    if (fixed || --wait > 0) return
    const late = frameMs > budget * 1.12
    // A clock that says the march took longer than the frames are apart is not believed: WebKit's said 19 ms with a
    // frame every 6, and by it the picture was held at three tenths of its size.
    const believed = clocked && gpuMs > 0 && gpuMs <= frameMs
    const want = late ? scale * 0.85 : believed ? scale * Math.sqrt((0.6 * budget) / gpuMs) : scale + 0.05
    const next = Math.round(Math.max(0.3, Math.min(1, want)) * 20) / 20
    if (next === scale) return
    scale = next
    wait = late ? 45 : believed ? 20 : 45
  }
  let target: Offscreen | null = null
  const fit = () => {
    const dpr = devicePixelRatio || 1
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; target?.destroy(); target = null }
    const size: [number, number] = [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))]
    if (!target || target.size[0] !== size[0] || target.size[1] !== size[1]) { target?.destroy(); target = offscreen(gpu, size) }
    return target
  }
  const clock = gpu.canTime ? {
    set: device.createQuerySet({ type: 'timestamp', count: 2 }),
    resolved: device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
    read: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
    busy: false,
  } : null
  let gpuMs = 0, cpuMs = 0, frameMs = 16.7, last = performance.now(), frames = 0, screenMs = 16.7, shortest = Infinity
  const started = last
  /** When the first picture was drawn, when the first with the scene in it was (every box whole across its middle half, as main.ts counts a world shown: the boxes fill from the middle, where the scene is), and when the first with every box whole was: ms since the page was asked for. */
  const seen = { first: 0, near: 0, whole: 0 }
  /** Every gap between frames since it was last emptied, ms: for whoever measures. */
  const gaps: number[] = []
  const flags = SHADOWS | MIRRORS

  const frame = (now: number) => {
    if (stopped || resting) return
    const began = performance.now(), gap = now - last, dt = Math.min(0.1, gap / 1000)
    frameMs += (gap - frameMs) * 0.05
    gaps.push(gap)
    shortest = Math.min(shortest, gap)
    if (frames % 120 === 119) { screenMs = Math.max(4, shortest); shortest = Infinity }
    last = now
    steer(Math.max(1000 / 60, screenMs))
    self.each?.(dt)
    const v = self.view(), to = fit()
    // The moment after something big breaks, what is loose hangs where it is.
    const moved = self.still > 0 ? 0 : dt
    self.still = Math.max(0, self.still - dt)
    fallOn(moved)
    // The boxes of the world lie round the scene's middle, not round the eye: what the scene is about is always in
    // the finest cells, and nothing is made again as the eye moves.
    world.update(scene.centre)
    const whole = world.stats.wanted === 0 && world.stats.stale === 0
    if (spoiled.length && whole) { for (const edit of spoiled) march.sun.spoil(edit); spoiled.length = 0 }
    const encoder = device.createCommandEncoder(), timed = clock && !clock.busy, time = (now - started) / 1000
    debris.step(moved, (x, z) => core.ground_at(Math.floor(x), Math.floor(z)))
    smoke.step(moved)
    for (const level of world.moved) march.sun.age(level)
    march.tend(encoder, v, world.nearlyWhole())
    march.draw(encoder, to, v, flags, time, timed ? { querySet: clock.set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined)
    falling.draw(encoder, to, v, march.sun.s)
    debris.draw(encoder, to, v)
    smoke.draw(encoder, to, v)
    for (const pass of self.passes) pass(encoder, to, v, time)
    blit(encoder, to, context.getCurrentTexture().createView(), 0, time, grade, 0, [1, 1, 1])
    if (timed) { encoder.resolveQuerySet(clock.set, 0, 2, clock.resolved, 0); encoder.copyBufferToBuffer(clock.resolved, 0, clock.read, 0, 16) }
    device.queue.submit([encoder.finish()])
    if (timed) {
      clock.busy = true
      void clock.read.mapAsync(GPUMapMode.READ).then(() => {
        const [a, b] = new BigUint64Array(clock.read.getMappedRange().slice(0))
        clock.read.unmap()
        clock.busy = false
        if (b > a) gpuMs += (Number(b - a) / 1e6 - gpuMs) * 0.1
      })
    }
    // The first picture drawn with the middle of every box whole is the scene seen. Their edges are still being made
    // then, and fill in behind it.
    const after = (what: 'first' | 'near' | 'whole', then?: () => void) => { seen[what] = -1; void device.queue.onSubmittedWorkDone().then(() => { seen[what] = performance.now(); then?.() }) }
    if (!seen.first) after('first')
    if (!seen.near && frames > 0 && world.stats.stale === 0 && world.levels.every((l) => l.whole.high.every((h, a) => h - l.whole.low[a] >= l.grid[a] / 2))) after('near', () => self.seenNear?.(Math.round(seen.near), Math.round(seen.first)))
    if (!seen.whole && frames > 0 && whole) after('whole')
    frames++
    cpuMs += (performance.now() - began - cpuMs) * 0.05
    requestAnimationFrame(frame)
  }

  // ── What comes loose ────────────────────────────────────────────────────
  // As in main.ts: the mover holds the bodies and the world as they meet it, says what a throw broke and loosened,
  // and is asked every frame to move the bodies on while there are any. Its edits are applied in its order.
  const mover = new Worker(new URL('../page/mover.ts', import.meta.url), { type: 'module' })
  const spoiled: Edit[] = []
  const moving = new Map<number, Piece>()
  let lying: { piece: Piece; shown: number }[] = []
  let putting: { runs: Int32Array<ArrayBuffer>; box: Edit['box'] }[] = [], putSince = 0
  /** How many times the world was restored: an answer the mover gave about the world before the last is not this world's. */
  let age = 0, answering: number[] = []
  let ticking = false, owed = 0, bodies = 0, running = false, thrown = 0, broken = 0
  const change = (edit: Edit) => { world.edit(edit); spoiled.push(edit) }
  const put = () => {
    if (!putting.length) return
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
    for (const p of putting) for (let a = 0; a < 3; a++) { box[a] = Math.min(box[a], p.box[a]); box[a + 3] = Math.max(box[a + 3], p.box[a + 3]) }
    const all = merge(putting.map((p) => rows(p.runs, p.box)), 0, box[0], box[3], box[2], box[5])
    putting = []
    change(all)
  }
  /** Asks the mover something it answers: the answer is known for this world's or an older one's by when it was asked. */
  const ask = (what: Ask) => { answering.push(age); mover.postMessage(what) }
  mover.onerror = (e) => fail(new Error(`the mover failed: ${e.message}`))
  mover.onmessage = (e: MessageEvent<Answer>) => {
    const answer = e.data, of = answering.shift()
    if (of !== age) return
    ticking = false
    if (answer.failed) return fail(new Error(`moving failed: ${answer.failed}`))
    const told = read(answer.words)
    for (const { runs, box } of told.edits) {
      // Cells put back wait a moment for others near them; cells taken out go at once, after whatever was waiting.
      if (runs[4] !== 0) { if (!putting.length) putSince = performance.now(); putting.push({ runs, box }); continue }
      put()
      change(rows(runs, box))
      broken++
      self.broke?.(box, runs.length / 5)
    }
    for (const born of told.born) moving.set(born.id, falling.add(born))
    for (const id of told.broke) { moving.get(id)?.destroy(); moving.delete(id) }
    for (const at of [...told.moves, ...told.gone]) { const piece = moving.get(at.id); if (piece) { piece.pos = at.pos; piece.rot = at.rot } }
    for (const { id } of told.gone) {
      const piece = moving.get(id)
      if (!piece) continue
      moving.delete(id)
      lying.push({ piece, shown: 0 })
      const c = hue(piece.born.faces[1] >> 16), size = piece.born.size
      if (piece.born.cells > 20) smoke.dust(piece.pos, (size[0] + size[2]) / 4, Math.min(8, 2 + Math.round(piece.born.cells / 120)), [0.35 + 0.5 * c[0] ** 0.45, 0.35 + 0.5 * c[1] ** 0.45, 0.35 + 0.5 * c[2] ** 0.45])
    }
    for (const d of told.dust) { const c = hue(d.kind); debris.burst(d.at, 2, d.amount * 3, [c[0], c[1], c[2]], 0.8) }
    bodies = answer.bodies
    running = answer.flowing
  }
  /** Moves what is loose on by `dt` seconds: the mover is asked once a frame, and not again until it has answered. */
  const fallOn = (dt: number) => {
    owed = Math.min(owed + dt, 0.1)
    if (putting.length && (performance.now() - putSince > 180 || bodies === 0)) put()
    if ((bodies > 0 || running) && !ticking && owed > 0) { ticking = true; ask({ tick: owed }); owed = 0 }
    if (bodies === 0 && !running) owed = 0
    const made = world.stats.stale === 0 && world.stats.wanted === 0
    lying = lying.filter((l) => { if (++l.shown > 2 && made) { l.piece.destroy(); return false } return true })
  }
  // The mover's own core is told the scene, as the makers of sectors were.
  const tellScene = () => { if (sceneEdits.length) ask({ edit: stream(sceneEdits), after: -1 }) }
  tellScene()

  const self: Stage = {
    canvas, query, gpu, core, scene, world, march, debris, smoke, tanHalf,
    view: () => { throw new Error('the stage was started before it was told where the eye is') },
    each: null,
    passes: [],
    broke: null,
    seenNear: null,
    through,
    async under(px, py) {
      const v = through(px, py), hit = await march.pick(v)
      return hit && { ...hit, at: [v.eye[0] + v.forward[0] * hit.t, v.eye[1] + v.forward[1] * hit.t, v.eye[2] + v.forward[2] * hit.t] }
    },
    toss(v, far, hard, kind = BALL.kind) {
      const speed = SOFT + (HARD - SOFT) * Math.max(0, Math.min(1, hard)), start = Math.min(14, far / 2)
      const from = v.eye.map((e, a) => e + v.forward[a] * start) as [number, number, number], time = (far - start) / speed
      ask({ ball: { from, speed: [v.forward[0] * speed, v.forward[1] * speed + (G * time) / 2, v.forward[2] * speed], radius: BALL.radius, kind } })
      // Until the answer says how many bodies there are, there is at least this one to move.
      bodies = Math.max(bodies, 1)
      thrown++
    },
    hour,
    restore() {
      // The mover forgets everything done and everything that moves, and is told the scene again (`forget` has no
      // answer); whatever it still says of the world as it was is let by. The world keeps every sector that nothing
      // had reached, and makes the others again as the scene has them (world.ts `swap`).
      age++
      mover.postMessage({ forget: true } satisfies Ask)
      for (const piece of moving.values()) piece.destroy()
      for (const l of lying) l.piece.destroy()
      moving.clear(); lying = []; putting = []
      ticking = false; bodies = 0; running = false; owed = 0
      for (const old of world.swap(sceneEdits)) spoiled.push(old)
      tellScene()
    },
    still: 0,
    get running() { return begun && !resting && !stopped },
    rest() { resting = true },
    go() { if (!resting) return; resting = false; last = performance.now(); if (begun && !stopped) requestAnimationFrame(frame) },
    start() { if (begun) return; begun = true; last = performance.now(); if (!resting) requestAnimationFrame(frame) },
    gaps, seen,
    get frameMs() { return frameMs }, get gpuMs() { return gpuMs }, get cpuMs() { return cpuMs }, get scale() { return scale },
    get bodies() { return bodies }, get pieces() { return moving.size + lying.length + putting.length }, get thrown() { return thrown }, get broken() { return broken }, get frames() { return frames },
  }
  return self
}
