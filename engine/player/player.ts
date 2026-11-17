// The player (#419): one scene of the engine, from static files. It draws the world and moves what comes loose,
// and nothing else: no server is asked anything, so there is no making, no talk, no realm and no shared world.
// It is a second, smaller page beside page/main.ts, made of the same parts (the core, the makers of sectors, the
// march, the mover, the pieces, crumbs and smoke); what main.ts does with them in a frame is done again here.
//
//   ?scene=scenes/sample.json   the scene (scene.ts says what one holds), an address beside index.html or anywhere that lets it be read
//   ?grid=8,8,8  ?levels=6  ?pool=64  ?workers=4   how much of the world round the scene is held: small, for a picture in a page
//   ?scale=0.75  pixels drawn for each pixel shown, each way: unsaid, it follows the GPU as main.ts does
//
// The eye turns about the scene's middle: drag to turn it, pinch or the wheel to come nearer. A tap throws a ball of
// wood at what is under the finger; held longer it is thrown harder, and what is brittle breaks.
import { offscreen, openGpu, type Offscreen } from '../probe/gpu.ts'
import { glow } from '../page/glow.ts'
import { MIRRORS, SHADOWS, marcher, materials, palette, type View } from '../page/march.ts'
import { crumbs } from '../page/crumbs.ts'
import { puffs } from '../page/puffs.ts'
import { pieces, type Piece } from '../page/pieces.ts'
import { rows, stream, type Edit } from '../page/edits.ts'
import { read } from '../page/told.ts'
import { World } from '../page/world.ts'
import { open } from '../page/bay.ts'
import type { Answer, Ask } from '../page/mover.ts'
import { sceneOf } from './scene.ts'

/** What the page that holds the player is told (index.html): the scene is seen, or something failed after WebGPU was found. */
export type Tell = (type: 'ready' | 'error', more: Record<string, unknown>) => void

/** Cells in a metre. */
const M = 10
/** The ball a poke throws: its half in cells, and what it is made of (wood). Of 60 cells or more, as this is, a body breaks what is built where it strikes hard enough (bodies.rs); thrown softly it only knocks, and held longest it breaks itself as well. */
const BALL = { radius: 3, kind: 10 }
/** How fast a tap throws it and how fast the longest hold does, cells a second; and how long that hold is, ms. */
const SOFT = 90, HARD = 600, HOLD = 700
/** How the core pulls things down, cells a second each second (bodies.rs `G`). */
const G = 98

interface Core { memory: WebAssembly.Memory; ground_at(x: number, z: number): number; world_kind(x: number, y: number, z: number): number; edits_room(words: number): number; merge_rows(lod: number, x0: number, x1: number, z0: number, z1: number): number; merged_words(): number }

export async function play(tell: Tell): Promise<void> {
  const query = new URLSearchParams(location.search)
  const numbers = (name: string, fallback: number[]) => query.get(name)?.split(',').map(Number) ?? fallback
  const canvas = document.querySelector('canvas')!
  /** Whether another page holds this one: there the wheel and an upward swipe are the holder's, to scroll by. */
  const held = parent !== window
  const failed = (e: unknown) => { stopped = true; console.error(e); tell('error', { message: e instanceof Error ? e.message : String(e) }) }
  let stopped = false

  const [gpu, scene, core] = await Promise.all([
    openGpu(),
    fetch(query.get('scene') ?? 'scenes/sample.json').then(async (r) => { if (!r.ok) throw new Error(`the scene could not be read: ${r.status}`); return sceneOf(await r.json()) }),
    open<Core>(new URL('../page/core.wasm', import.meta.url).href),
  ])
  const { device } = gpu
  void device.lost.then((info) => failed(new Error(`the GPU was lost: ${info.message || info.reason}`)))
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

  // ── The eye ─────────────────────────────────────────────────────────────
  const rad = Math.PI / 180
  const eye = { far: scene.eye.far, yaw: scene.eye.yaw * rad, pitch: scene.eye.pitch * rad }
  const nearest = scene.eye.nearest ?? scene.eye.far / 3, farthest = scene.eye.farthest ?? scene.eye.far * 3
  const tanHalf = Math.tan((Number(query.get('fov') ?? 50) * Math.PI) / 360)
  /** How far from the middle the eye is drawn: what was asked for, or less where something stands between, come to over a few frames. */
  let shown = eye.far, clear = eye.far, clearFor = ''
  /**
   * How far out from the middle along a way the world is open, up to `far`: the eye is never put in a wall or behind
   * one. Leaves and water are looked through, and so is what is thin (a lamp's post, a trunk): only what is met
   * again and again over the next two metres stops the eye.
   */
  const stands = (away: readonly number[], d: number) => { const k = core.world_kind(Math.floor(scene.centre[0] + away[0] * d), Math.floor(scene.centre[1] + away[1] * d), Math.floor(scene.centre[2] + away[2] * d)) & 15; return k !== 0 && k !== 5 && k !== 13 }
  const openTo = (away: readonly number[], far: number) => {
    for (let d = 2; d <= far; d += 2) {
      if (!stands(away, d)) continue
      let more = 0
      for (let on = 2; on <= 20; on += 2) if (stands(away, d + on)) more++
      if (more >= 3) return Math.max(2, d - 6)
    }
    return far
  }
  const view = (): View => {
    const cp = Math.cos(eye.pitch), forward = [Math.sin(eye.yaw) * cp, Math.sin(eye.pitch), -Math.cos(eye.yaw) * cp] as const
    const right = [Math.cos(eye.yaw), 0, Math.sin(eye.yaw)] as const
    const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]] as const
    // Asked again only when the eye was moved: the world it is asked of is the one the rules make, which does not change.
    const key = `${eye.yaw},${eye.pitch},${eye.far}`
    if (key !== clearFor) { clearFor = key; clear = openTo([-forward[0], -forward[1], -forward[2]], eye.far) }
    return { eye: [scene.centre[0] - forward[0] * shown, scene.centre[1] - forward[1] * shown, scene.centre[2] - forward[2] * shown], forward, right, up, tanHalf }
  }
  /** The view turned to look along the line through a place on the picture (CSS pixels from its corner). */
  const through = (px: number, py: number): View => {
    const v = view(), h = canvas.clientHeight / 2, x = ((px - canvas.clientWidth / 2) / h) * tanHalf, y = ((h - py) / h) * tanHalf
    const d = v.forward.map((f, a) => f + v.right[a] * x + v.up[a] * y), l = Math.hypot(d[0], d[1], d[2])
    return { ...v, forward: [d[0] / l, d[1] / l, d[2] / l] }
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  // How many pixels are marched for each pixel shown follows the GPU, by main.ts's rule (`steer`), without its
  // answer to a sudden dear view (this eye turns about one place), and with one more test of the GPU's clock.
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
  /** Every gap between frames since it was last emptied, ms: for whoever measures (test/player.mjs). */
  const gaps: number[] = []
  const flags = SHADOWS | MIRRORS

  const frame = (now: number) => {
    if (stopped) return
    const began = performance.now(), gap = now - last, dt = Math.min(0.1, gap / 1000)
    frameMs += (gap - frameMs) * 0.05
    gaps.push(gap)
    shortest = Math.min(shortest, gap)
    if (frames % 120 === 119) { screenMs = Math.max(4, shortest); shortest = Infinity }
    last = now
    steer(Math.max(1000 / 60, screenMs))
    // In quickly when something comes between, out again more slowly.
    shown += (clear - shown) * Math.min(1, dt * (clear < shown ? 14 : 5))
    const v = view(), to = fit()
    fallOn(dt)
    // The boxes of the world lie round the scene's middle, not round the eye: the eye turns about that place, so what it
    // looks at is always in the finest cells and nothing is made again as it turns.
    world.update(scene.centre)
    const whole = world.stats.wanted === 0 && world.stats.stale === 0
    if (spoiled.length && whole) { for (const edit of spoiled) march.sun.spoil(edit); spoiled.length = 0 }
    const encoder = device.createCommandEncoder(), timed = clock && !clock.busy, time = (now - started) / 1000
    debris.step(dt, (x, z) => core.ground_at(Math.floor(x), Math.floor(z)))
    smoke.step(dt)
    for (const level of world.moved) march.sun.age(level)
    march.tend(encoder, v, world.nearlyWhole())
    march.draw(encoder, to, v, flags, time, timed ? { querySet: clock.set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined)
    falling.draw(encoder, to, v, march.sun.s)
    debris.draw(encoder, to, v)
    smoke.draw(encoder, to, v)
    blit(encoder, to, context.getCurrentTexture().createView(), 0, time, [0.9, 0.1], 0, [1, 1, 1])
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
    // The holder is told once the scene is seen: the first picture drawn with the middle of every box whole. Their edges
    // are still being made then, and fill in behind it.
    const after = (what: 'first' | 'near' | 'whole', then?: () => void) => { seen[what] = -1; void device.queue.onSubmittedWorkDone().then(() => { seen[what] = performance.now(); then?.() }) }
    if (!seen.first) after('first')
    if (!seen.near && frames > 0 && world.stats.stale === 0 && world.levels.every((l) => l.whole.high.every((h, a) => h - l.whole.low[a] >= l.grid[a] / 2))) after('near', () => tell('ready', { ms: Math.round(seen.near), firstFrame: Math.round(seen.first), scene: scene.name }))
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
  mover.onerror = (e) => failed(new Error(`the mover failed: ${e.message}`))
  mover.onmessage = (e: MessageEvent<Answer>) => {
    const answer = e.data
    ticking = false
    if (answer.failed) return failed(new Error(`moving failed: ${answer.failed}`))
    const told = read(answer.words)
    for (const { runs, box } of told.edits) {
      // Cells put back wait a moment for others near them; cells taken out go at once, after whatever was waiting.
      if (runs[4] !== 0) { if (!putting.length) putSince = performance.now(); putting.push({ runs, box }); continue }
      put()
      change(rows(runs, box))
      broken++
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
    if ((bodies > 0 || running) && !ticking) { ticking = true; mover.postMessage({ tick: owed } satisfies Ask); owed = 0 }
    if (bodies === 0 && !running) owed = 0
    const made = world.stats.stale === 0 && world.stats.wanted === 0
    lying = lying.filter((l) => { if (++l.shown > 2 && made) { l.piece.destroy(); return false } return true })
  }
  // The mover's own core is told the scene, as the makers of sectors were.
  if (sceneEdits.length) mover.postMessage({ edit: stream(sceneEdits), after: -1 } satisfies Ask)

  /**
   * Throws the ball at what is under a place on the picture: `hard` is 0 for a tap to 1 for the longest hold. It is
   * lifted by what it will drop on the way, so a soft throw lands where it was aimed. Returns what it was thrown at.
   */
  const poke = async (px: number, py: number, hard: number) => {
    const v = through(px, py), hit = await march.pick(v)
    const speed = SOFT + (HARD - SOFT) * Math.max(0, Math.min(1, hard)), far = hit ? hit.t : eye.far, start = Math.min(14, far / 2)
    const from = v.eye.map((e, a) => e + v.forward[a] * start) as [number, number, number], time = (far - start) / speed
    mover.postMessage({ ball: { from, speed: [v.forward[0] * speed, v.forward[1] * speed + (G * time) / 2, v.forward[2] * speed], radius: BALL.radius, kind: BALL.kind } } satisfies Ask)
    // Until the answer says how many bodies there are, there is at least this one to move.
    bodies = Math.max(bodies, 1)
    thrown++
    return hit
  }

  // ── Mouse and touch ─────────────────────────────────────────────────────
  // One finger or the mouse held and moved turns the eye; two fingers, or the wheel, bring it nearer or further.
  // A press that did not move is a poke when it ends, harder the longer it was held. In another page the wheel alone
  // is that page's (it scrolls by it): there the eye comes nearer with the wheel and Ctrl, which is also how a
  // trackpad's pinch arrives.
  const down = new Map<number, { x: number; y: number; x0: number; y0: number; t: number; moved: boolean }>()
  const hint = document.querySelector<HTMLElement>('#hint')
  const zoom = (by: number) => { eye.far = Math.max(nearest, Math.min(farthest, eye.far * by)) }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId)
    down.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), moved: false })
    // A second finger down: neither is a poke.
    if (down.size > 1) for (const p of down.values()) p.moved = true
  })
  canvas.addEventListener('pointermove', (e) => {
    const p = down.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    if (!p.moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 6) p.moved = true
    if (down.size === 2) {
      const [a, b] = [...down.values()], before = Math.hypot(a.x - b.x, a.y - b.y)
      p.x = e.clientX; p.y = e.clientY
      zoom(before / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)))
      return
    }
    p.x = e.clientX; p.y = e.clientY
    if (!p.moved) return
    eye.yaw += dx * 0.006
    eye.pitch = Math.max(-1.45, Math.min(-0.03, eye.pitch - dy * 0.006))
  })
  const lift = (e: PointerEvent, ended: boolean) => {
    const p = down.get(e.pointerId)
    down.delete(e.pointerId)
    if (!p || p.moved || !ended) return
    const box = canvas.getBoundingClientRect()
    if (hint) hint.hidden = true
    void poke(p.x - box.left, p.y - box.top, (performance.now() - p.t - 150) / (HOLD - 150)).catch(failed)
  }
  canvas.addEventListener('pointerup', (e) => lift(e, true))
  canvas.addEventListener('pointercancel', (e) => lift(e, false))
  canvas.addEventListener('wheel', (e) => { if (held && !e.ctrlKey) return; e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0015)) }, { passive: false })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  // For whoever measures and for the console: nothing of the page's own reads it.
  Object.assign(globalThis, { player: { scene, world, eye, view, poke, gaps, seen, get frameMs() { return frameMs }, get gpuMs() { return gpuMs }, get cpuMs() { return cpuMs }, get scale() { return scale }, get bodies() { return bodies }, get pieces() { return moving.size + lying.length + putting.length }, get thrown() { return thrown }, get broken() { return broken }, get faults() { return gpu.faults } } })
  requestAnimationFrame(frame)
}
