// The engine's page (#140): a generated city of 10 cm cells, flown through. Raw WebGPU, the
// core as wasm in workers, nothing else.
//
//   ?grid=16,8,16  sectors a side of every box      ?levels=9   how many boxes, each twice as far
//   ?pool=256      MB of trees the GPU keeps        ?scale=1    pixels drawn for each pixel shown, each way
//   ?at=x,y,z      where to start, metres           ?look=yaw,pitch  degrees
//   ?fly=1 (on by default at the address /): the flight that measures this device and posts what it found; ?seconds=40 how long it flies
//   ?shadows=0  ?mirrors=0  ?heat=1 (show how many steps each pixel took)  ?detail=1 (pixels a thing must be wide to be drawn as itself)
import { offscreen, openGpu, pace, type Offscreen } from '../probe/gpu.ts'
import { glow } from './glow.ts'
import { fill } from '../probe/fill.ts'
import { COUNT, FLAT, HEAT, MIRRORS, SHADOWS, marcher, materials, palette, type View } from './march.ts'
import { crumbs } from './crumbs.ts'
import { flowing } from './water.ts'
import { space } from './space.ts'
import { link } from './link.ts'
import { car, living } from './living.ts'
import { puffs } from './puffs.ts'
import { ball, rows, stream, type Edit } from './edits.ts'
import { people, townsfolk } from './people.ts'
import { pieces, type Piece } from './pieces.ts'
import { presence } from './presence.ts'
import type { Shock } from './residents.ts'
import type { Answer, Ask } from './mover.ts'
import { read } from './told.ts'
import { wand, type Target as Aim } from './wand.ts'
import { LIBRARY, caster, known, type Spell } from './spells.ts'
import { World } from './world.ts'
import { flight } from './flight.ts'
import { input } from './input.ts'
import { hud } from './hud.ts'
import { things } from './things.ts'
import { asker } from './ask.ts'
import { making } from './making.ts'
import { gather } from './gather.ts'
import { cadence, describe, environment, reporter } from '../probe/tell.ts'
import { sound } from './sound/sound.ts'
import { hearing } from './sound/world.ts'

const query = new URLSearchParams(location.search)
const numbers = (name: string, fallback: number[]) => query.get(name)?.split(',').map(Number) ?? fallback
const canvas = document.querySelector('canvas')!
const phone = navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 600
/** Keys, pointer and touch (input.ts), and what is shown over the picture (hud.ts): the one owner of each. */
const controls = input(canvas, { phone, useButton: document.querySelector('#boom') })
const over = hud(controls)

/** Cells in a metre. */
const M = 10
const { report, post } = reporter('city-4')
const flying = (query.get('fly') ?? (location.pathname === '/' ? '1' : '0')) === '1'

async function main() {
  report.env = environment()
  const gpu = await openGpu()
  const { device } = gpu
  report.env.gpu = await describe(gpu)
  report.faults = gpu.faults
  const context = canvas.getContext('webgpu')!
  context.configure({ device, format: gpu.format, alphaMode: 'opaque' })

  const core = (await WebAssembly.instantiateStreaming(fetch('/page/core.wasm'), {})).instance.exports as unknown as { memory: WebAssembly.Memory; ground_at(x: number, z: number): number; feet_at(x: number, z: number): number; world_edit(after: number): void; paving_at(x: number, z: number): number; world_kind(x: number, y: number, z: number): number; edits_room(words: number): number; merge_rows(lod: number, x0: number, x1: number, z0: number, z1: number): number; merged_words(): number }
  const room = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
  const poolMb = Math.min(Number(query.get('pool') ?? (phone ? 128 : 256)), Math.floor(room / (1 << 20)))
  const grid = numbers('grid', phone ? [8, 8, 8] : [16, 8, 16]) as [number, number, number]
  /** Edits of rows, one after another, as one edit of rows a column of sectors reads the same (the core's `merge_rows`). */
  const merge = (edits: readonly Edit[], lod: number, x0: number, x1: number, z0: number, z1: number): Edit => {
    const words = stream(edits), room = core.edits_room(words.length)
    new Int32Array(core.memory.buffer, room, words.length).set(words)
    const n = core.merge_rows(lod, x0, x1, z0, z1), merged = new Int32Array(core.memory.buffer, core.merged_words(), n).slice()
    let y0 = 0, y1 = 0
    for (let i = 2; i < n; i += 5) { y0 = i === 2 ? merged[4] : Math.min(y0, merged[i + 2]); y1 = i === 2 ? merged[4] + 1 : Math.max(y1, merged[i + 2] + 1) }
    return { words: merged, box: [x0, y0, z0, x1, y1, z1] }
  }
  const world = new World(device, {
    merge,
    grid,
    levels: Number(query.get('levels') ?? (phone ? 8 : 9)),
    poolWords: (poolMb << 20) / 4,
    workers: Number(query.get('workers') ?? Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 2))),
  })
  const march = await marcher(device, gpu.format, world)
  const blit = await glow(gpu)
  const debris = await crumbs(device, gpu.format)
  const smoke = await puffs(device, gpu.format)
  const water = await flowing(device, gpu.format)
  const planet = await space(device, gpu.format)
  /** From this high (metres) the planet is drawn in place of the boxes of cells. The widest box is 13 km tall with the
   * eye at its middle, so the ground is out of it when the eye is 6.5 km up: from 8 km there was a blue square in haze. */
  const SPACE = 6_000
  const falling = await pieces(device, gpu.format, march)
  const folk = await people(device, gpu.format, march)
  // The wand (#246): how a spell is aimed.
  const staff = await wand(device, gpu.format, march, core, controls, over)
  const colours = palette(), stuff = materials()
  // What is heard (#247): `?sound=0` leaves it out. The picture never waits for it: it is there when it is ready, and a
  // page that cannot make sound goes on without it.
  let ears: ReturnType<typeof hearing> | null = null
  if (query.get('sound') !== '0') void sound().then((voice) => { ears = hearing(voice, { ground: core.ground_at, paving: core.paving_at, rain: () => march.rain, under: () => march.under, flames: () => flames, bodies: () => bodies, hour: () => hour ?? 12, making: () => wishes.busy > 0, kind: core.world_kind, seam: () => ({ things: made, hud: over, input: controls }) }, { music: query.get('music') !== '0' }); }).catch(() => {})
  march.detail = Number(query.get('detail') ?? 1)
  march.maps = query.get('maps') !== '0'

  // Start on land, a little above a street.
  let startX = 700, startZ = 4070
  while (core.ground_at(startX, startZ) < 120 && startX < 400_000) startX += 1280
  const at = numbers('at', [startX / M, core.ground_at(startX, startZ) / M + 12, startZ / M])
  const look = numbers('look', [20, -8])
  const pose = { x: at[0], y: at[1], z: at[2], yaw: (look[0] * Math.PI) / 180, pitch: (look[1] * Math.PI) / 180 }
  const street = { x: startX / M, y: core.ground_at(startX, startZ) / M, z: startZ / M }
  let speed = 12

  // ── Moving ──────────────────────────────────────────────────────────────
  // The page's own mode, under any a lane adds (input.ts): the keys and the look move the eye, a click uses the
  // tool picked. `own.keys` and `own.use` are filled in below, where the things they do are made.
  const own = { use: (): boolean | void => {}, keys: new Map<string, () => void>() }
  controls.push({ name: 'moving', use: () => own.use(), key: (code) => { const act = own.keys.get(code); act?.(); return !!act }, wheel: (deltaY) => { speed = Math.max(1, Math.min(400, speed * (deltaY < 0 ? 1.25 : 0.8))); return true } })

  const view = (): View => {
    const cp = Math.cos(pose.pitch), forward = [Math.sin(pose.yaw) * cp, Math.sin(pose.pitch), -Math.cos(pose.yaw) * cp] as const
    const right = [Math.cos(pose.yaw), 0, Math.sin(pose.yaw)] as const
    const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]] as const
    // Under the sea: under its top, where the ground by itself lies under it too (not in a pit dug on land).
    march.under = pose.y < 0 && core.ground_at(Math.round(pose.x * M), Math.round(pose.z * M)) < -1
    return { eye: [pose.x * M, pose.y * M, pose.z * M], forward, right, up, tanHalf: Math.tan((Number(query.get('fov') ?? 70) * Math.PI) / 360) }
  }
  /** Where a place in the world is on the screen (CSS pixels), or null behind the eye: for what the hud keeps beside a thing. */
  const project = (at: readonly [number, number, number]): [number, number] | null => {
    const v = view(), d = [at[0] - v.eye[0], at[1] - v.eye[1], at[2] - v.eye[2]], dot = (a: readonly number[]) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2]
    const z = dot(v.forward)
    if (z <= 1) return null
    const w = canvas.clientWidth, h = canvas.clientHeight
    return [w / 2 + (dot(v.right) / z / v.tanHalf) * (h / 2), h / 2 - (dot(v.up) / z / v.tanHalf) * (h / 2)]
  }
  const walk = (dt: number) => {
    // Only while nothing solid is over this mode: typing, the keys are letters; mounted, they are the vehicle's.
    if (!controls.live('moving')) return
    const [right, up] = controls.turn(), held = controls.held, stick = controls.stick
    pose.yaw += right
    pose.pitch = Math.max(-1.5, Math.min(1.5, pose.pitch + up))
    const v = view(), fast = held('ShiftLeft') || held('ShiftRight') ? 5 : 1
    const ahead = (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0) - stick[1] * 2, side = (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0) + stick[0] * 2
    const rise = (held('Space') ? 1 : 0) - (held('KeyC') || held('ControlLeft') ? 1 : 0)
    // The higher the eye, the faster it goes: at 12 m/s the way up to space would take hours.
    const step = speed * fast * dt * Math.max(1, (pose.y - core.ground_at(Math.round(pose.x * M), Math.round(pose.z * M)) / M) / 400)
    pose.x += (v.forward[0] * ahead + v.right[0] * side) * step
    pose.y += (v.forward[1] * ahead + rise) * step
    pose.z += (v.forward[2] * ahead + v.right[2] * side) * step
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  // How many pixels are marched for each pixel shown, each way. Unless the address fixes it, it follows the
  // GPU: fewer pixels when a view is dear, so the frame rate holds, and all of them when it is cheap.
  const fixed = query.has('scale')
  let scale = Number(query.get('scale') ?? (phone ? 0.5 : 0.75))
  let held = 0
  // A phone's GPU clock is not to be believed: the iPhone's read 0.01 to 10 ms for the same work from one second to the next.
  const clocked = gpu.canTime && navigator.maxTouchPoints === 0
  const steer = (budget: number) => {
    if (fixed || --held > 0) return
    // Frames that come late are the one sure sign: back off. Otherwise, with a clock to believe, aim the march at
    // six tenths of a frame; without one, go up a step at a time while frames keep coming on time.
    const late = frameMs > budget * 1.12
    const want = late ? scale * 0.85 : clocked && gpuMs > 0 ? scale * Math.sqrt((0.6 * budget) / gpuMs) : scale + 0.05
    const next = Math.round(Math.max(0.3, Math.min(1, want)) * 20) / 20
    if (next === scale) return
    scale = next
    held = late ? 45 : clocked ? 20 : 45
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
  // ── The hour ────────────────────────────────────────────────────────────
  // Unasked, the sun stands where it always has. `?hour=18.4` or the [ and ] keys set the time of day: the sun goes
  // from the east at six over the south to the sea in the west at eighteen, and the moon lights the night.
  let hour: number | null = null
  // The town's residents (#218): by rule from place and from the clock every page of a world shares. `?people=0` leaves them out.
  const folkClock = { now: () => Date.now() / 1000 }
  const shocks: Shock[] = []
  if (query.get('people') !== '0') folk.from.push(townsfolk(core, () => hour ?? 11, () => march.rain, () => folkClock.now(), shocks))
  /** How much colour and how much contrast the last pass gives the picture (glow.ts): the day's, until an hour is set. */
  let grade: [number, number] = [0.9, 0.1]
  const setHour = (h: number | null) => {
    hour = h === null ? null : ((h % 24) + 24) % 24
    let sun: [number, number, number] = [0.52, 0.62, 0.59], day = 1, low = 0
    if (hour !== null) {
      const a = ((hour - 6) / 12) * Math.PI, east = [0.8, 0, 0.6], top = [-0.27, 0.9, 0.36]
      const at = east.map((e, i) => Math.cos(a) * e + Math.sin(a) * top[i])
      const ease = (lo: number, hi: number, v: number) => { const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t) }
      day = ease(-0.1, 0.1, at[1])
      low = 1 - ease(0.02, 0.5, at[1])
      // By night the moon's light, from a fixed place; by day the sun's, never from under the ground.
      sun = day === 0 ? [0.45, 0.7, -0.55] : [at[0], Math.max(at[1], 0.06), at[2]]
    }
    march.light(sun, day, low)
    // Full day is 1, dusk and night 0.
    const noon = day * (1 - low)
    grade = [1.25 - 0.35 * noon, 0.35 - 0.25 * noon]
    smoke.light(sun, day)
    debris.light(sun, day)
    water.light(sun, day)
  }
  if (query.has('hour')) setHour(Number(query.get('hour')))
  // `?rain=1` or the R key: rain.
  march.rain = Number(query.get('rain') ?? 0)
  let flags = (query.get('shadows') === '0' ? 0 : SHADOWS) | (query.get('mirrors') === '0' ? 0 : MIRRORS) | (query.get('heat') === '1' ? HEAT : 0) | (query.get('flat') === '1' ? FLAT : 0)
  own.keys.set('KeyH', () => { flags ^= HEAT })
  own.keys.set('KeyR', () => { march.rain = march.rain > 0 ? 0 : 1 })
  own.keys.set('BracketRight', () => setHour((hour ?? 14) + 0.5))
  own.keys.set('BracketLeft', () => setHour((hour ?? 14) - 0.5))
  own.keys.set('KeyL', () => { flags ^= SHADOWS })
  own.keys.set('KeyM', () => { flags ^= MIRRORS })
  own.keys.set('KeyK', () => { march.maps = !march.maps })

  // The GPU's own time for the march, where the device can say.
  const clock = gpu.canTime ? {
    set: device.createQuerySet({ type: 'timestamp', count: 2 }),
    resolved: device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
    read: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
    busy: false,
  } : null
  let gpuMs = 0, frameMs = 16.7, last = performance.now(), frames = 0, started = last
  // The screen's own rate: the shortest gap between frames seen lately.
  let screenMs = 16.7, shortest = Infinity

  const watchers = new Set<(gap: number) => void>()
  let paused = false, saying = ''
  /** Parts of a frame left out, by name, for finding what a slow frame is spent on: pieces, crumbs, puffs, flames, spoil. */
  const off = new Set<string>()
  /** What a frame costs this thread, smoothed, in ms; and what each part of it costs, by name. `heard` is the mover's answers, summed. */
  let cpuMs = 0, mark = 0
  const spent: Record<string, number> = { heard: 0 }
  const lap = (name: string) => { const t = performance.now(); spent[name] = (spent[name] ?? 0) * 0.95 + (t - mark) * 0.05; mark = t }
  const frame = (now: number) => {
    const began = mark = performance.now()
    const dt = Math.min(0.1, (now - last) / 1000)
    for (const each of watchers) each(now - last)
    if (paused) { last = now; requestAnimationFrame(frame); return }
    frameMs += ((now - last) - frameMs) * 0.05
    shortest = Math.min(shortest, now - last)
    if (frames % 120 === 119) { screenMs = Math.max(4, shortest); shortest = Infinity }
    last = now
    // Riding a thing, the eye goes where it goes; otherwise where the keys take it.
    if (!alive.frame(dt)) walk(dt)
    steer(Math.max(1000 / 60, screenMs))
    const v = view(), to = fit()
    staff.frame(v)
    ears?.frame(v.eye, pose.yaw, dt)
    magic.step(dt)
    lap('steer')
    fallOn(dt)
    lap('fallOn')
    world.update(v.eye)
    lap('update')
    if (spoiled.length && !off.has('spoil') && world.stats.stale === 0 && world.stats.wanted === 0) { for (const edit of spoiled) march.sun.spoil(edit); spoiled.length = 0 }
    lap('spoil')
    const encoder = device.createCommandEncoder()
    const timed = clock && !clock.busy
    debris.step(dt, (x, z) => core.ground_at(Math.floor(x), Math.floor(z)))
    gathering.step(dt)
    smoke.step(dt)
    lap('step')
    for (const level of world.moved) march.sun.age(level)
    march.tend(encoder, v, world.nearlyWhole())
    lap('tend')
    if (pose.y > SPACE) {
      // Where the page starts is the land's middle (land.rs HOME), 70 m east and 407 m south of the world's corner.
      planet.draw(encoder, to, v, pose.y / 1000, [(pose.x - 70) / 1000, (pose.z - 407) / 1000], march.sun.s, march.day, (now - started) / 1000, timed ? { querySet: clock.set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined)
    } else {
      march.draw(encoder, to, v, flags, (now - started) / 1000, timed ? { querySet: clock.set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined)
      if (!off.has('water')) water.draw(encoder, to, v, (now - started) / 1000)
      if (!off.has('pieces')) falling.draw(encoder, to, v, march.sun.s)
      if (!off.has('people')) folk.draw(encoder, to, v, (now - started) / 1000)
      if (!off.has('crumbs')) debris.draw(encoder, to, v)
      if (!off.has('puffs')) smoke.draw(encoder, to, v)
      staff.draw(encoder, to, v, (now - started) / 1000)
    }
    blit(encoder, to, context.getCurrentTexture().createView(), march.under || pose.y > SPACE ? 0 : march.rain * (0.35 + 0.65 * march.day), (now - started) / 1000, march.under ? [1.25, 0.35] : grade, march.under || pose.y > SPACE ? 0 : 1 - march.day)
    if (timed) { encoder.resolveQuerySet(clock.set, 0, 2, clock.resolved, 0); encoder.copyBufferToBuffer(clock.resolved, 0, clock.read, 0, 16) }
    device.queue.submit([encoder.finish()])
    lap('draw')
    over.frame(project)
    if (timed) {
      clock.busy = true
      void clock.read.mapAsync(GPUMapMode.READ).then(() => {
        const [a, b] = new BigUint64Array(clock.read.getMappedRange().slice(0))
        clock.read.unmap()
        clock.busy = false
        if (b > a) gpuMs += (Number(b - a) / 1e6 - gpuMs) * 0.1
      })
    }
    if (++frames % 15 === 0) {
      const s = world.stats
      over.status(`${saying ? `${saying} · ` : ''}${(1000 / frameMs).toFixed(0)} fps · march ${gpuMs.toFixed(1)} ms at ${to.size[0]} x ${to.size[1]} · ${s.wanted ? `making ${s.wanted} sectors` : 'world made'} · ${(s.poolUsed / 262144).toFixed(0)} of ${(s.poolWords / 262144).toFixed(0)} MB${s.full ? ` · ${s.full} did not fit` : ''} · ${pose.x.toFixed(0)}, ${pose.y.toFixed(0)}, ${pose.z.toFixed(0)} m · ${speed.toFixed(0)} m/s`)
    }
    cpuMs += (performance.now() - began - cpuMs) * 0.05
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // ── Breaking ────────────────────────────────────────────────────────────
  // The sun's maps are spoiled where the world changed, once the sectors that reached have been made again.
  const spoiled: Edit[] = []
  /** Whether blasts set things alight: `?fire=0` for checks that need a blast to be only a blast. */
  const sparks = query.get('fire') !== '0'
  /** How big a blast is, in cells: keys 1, 2 and 3 pick a hammer blow, a charge, a big one. */
  const force = 12

  // ── What comes loose ────────────────────────────────────────────────────
  // After a blast a worker says what is no longer held (the core's support rule) and moves it: each piece is a
  // body that falls, turns and strikes things, drawn as faces while it moves, and cells of the world again where
  // it comes to rest (bodies.rs). The worker makes edits of its own (cells out, cells back); they are applied here
  // in the order it made them, and it is told how many of them a blast came after.
  // `?shared=1`: the world is the one the page server keeps for everyone (world.mjs), and this page is a view of
  // it. It applies nothing of its own: what it asks comes back in the world's stream, in the world's order, with
  // what everyone else asked.
  // `?realm=id`: another realm that the server keeps (#264), in place of home.
  const far = query.has('realm') ? link(`/realm/${encodeURIComponent(query.get('realm')!)}/world`) : query.has('shared') ? link() : null
  const mover: { postMessage(ask: Ask): void; onmessage: ((e: MessageEvent<Answer>) => void) | null; onerror: ((e: ErrorEvent) => void) | null } = far ? (far as never) : new Worker('/page/mover.ts', { type: 'module' })
  /** In a shared world: whose ask each answer that is still to come answers, in order (true for this page's own). */
  const asked: boolean[] = []
  const moving = new Map<number, Piece>()
  /** Bodies that are cells again, drawn where they lay until those cells are in the picture. */
  let lying: { piece: Piece; shown: number }[] = []
  let heard = 0, waiting = 0, ticking = false, owed = 0, bodies = 0, burning = 0
  /** Whether water is flowing, or may be: after anything is broken the mover is asked once, and says. */
  let running = false
  /** Where it burns, as the mover last said: some of the burning cells. */
  let flames = new Float32Array(0)
  const change = (edit: Edit) => { world.edit(edit); spoiled.push(edit); staff.changed(edit) }
  /** Cells that bodies have become, waiting to be put in the world together. */
  let putting: { runs: Int32Array<ArrayBuffer>; box: Edit["box"] }[] = [], putSince = 0
  const put = () => {
    if (!putting.length) return
    // One edit of them all, its rows in order and none over another: the core sorts them, which here took a tenth of
    // a second when a house's worth of bodies lay down together.
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
    for (const p of putting) for (let a = 0; a < 3; a++) { box[a] = Math.min(box[a], p.box[a]); box[a + 3] = Math.max(box[a + 3], p.box[a + 3]) }
    const all = merge(putting.map((p) => rows(p.runs, p.box)), 0, box[0], box[3], box[2], box[5])
    putting = []
    change(all)
  }
  /** How far over the biggest body is, in degrees from upright: for a picture taken as a tall thing goes over. */
  const leaning = () => {
    let most = 0, lean = 0
    for (const { born, rot: [x, , z] } of moving.values()) if (born.cells > most) { most = born.cells; lean = Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (x * x + z * z)))) * 180 / Math.PI }
    return lean
  }
  const fell = { asks: 0, pieces: 0, cells: 0, dust: 0, ms: 0, stepMs: 0, worstMs: 0, tried: 0, most: 0, bursts: 0 }
  const hue = (kind: number) => (kind >> 8 ? colours.subarray((kind >> 8) * 4, (kind >> 8) * 4 + 3) : stuff.subarray((kind & 15) * 8, (kind & 15) * 8 + 3))
  mover.onmessage = (e: MessageEvent<Answer>) => {
    const answer = e.data, t0 = performance.now()
    queueMicrotask(() => { spent.heard += performance.now() - t0 })
    if (far) { if (answer.released && asked.shift()) waiting-- }
    else if (answer.released) waiting--
    else if (answer.spawned === undefined) ticking = false
    if (answer.failed) { report.notes.push(`moving failed: ${answer.failed}`); return }
    const told = read(answer.words)
    alive.heard(answer, told)
    for (const { runs, box } of told.edits) {
      heard++
      // Cells put back wait a moment for others near them: a heap comes down as hundreds of bodies, and the town
      // is made again once for many of them. Cells taken out go at once, after whatever was waiting.
      if (runs[4] !== 0) { if (!putting.length) putSince = performance.now(); putting.push({ runs, box }); continue }
      put()
      change(rows(runs, box))
    }
    // Born first: a shard may be born and break again within the one answer.
    for (const born of told.born) { moving.set(born.id, falling.add(born)); fell.pieces++; fell.cells += born.cells }
    if (!far || far.live) ears?.told(told, moving)
    for (const id of told.broke) { moving.get(id)?.destroy(); moving.delete(id) }
    // Something went up of itself: the cells it emptied came as edits, and this is its fire, smoke and shock.
    if (!far || far.live) for (const b of told.bursts) { smoke.blast(b.at, b.radius); shocks.push({ at: b.at, radius: b.radius, t: folkClock.now() }); fell.bursts++ }
    for (const at of [...told.moves, ...told.gone]) {
      const piece = moving.get(at.id)
      if (piece) { piece.pos = at.pos; piece.rot = at.rot }
    }
    for (const { id } of told.gone) {
      const piece = moving.get(id)
      if (!piece) continue
      moving.delete(id)
      lying.push({ piece, shown: 0 })
      // Dust of what it is made of, where it came to rest.
      const c = hue(piece.born.faces[1] >> 16), size = piece.born.size
      // Paler than the stuff itself, and as the screen shows it.
      if (piece.born.cells > 20) {
        smoke.dust(piece.pos, (size[0] + size[2]) / 4, Math.min(8, 2 + Math.round(piece.born.cells / 120)), [0.35 + 0.5 * c[0] ** 0.45, 0.35 + 0.5 * c[1] ** 0.45, 0.35 + 0.5 * c[2] ** 0.45])
        // And small bits of it, scattered round where it lies. They are for the eye only, and lie for most of a minute.
        debris.burst(piece.pos, (size[0] + size[2]) / 4, Math.min(10, 1 + Math.round(piece.born.cells / 70)), [c[0], c[1], c[2]], 0.9, 40, 0.45)
      }
    }
    if (!far || far.live) for (const d of told.dust) { const c = hue(d.kind); debris.burst(d.at, 2, d.amount * 3, [c[0], c[1], c[2]], 0.8); fell.dust += d.amount }
    bodies = answer.bodies
    burning = answer.burning
    running = answer.flowing || answer.released
    if (told.water) water.set(told.water)
    if (told.fire) flames = told.fire
    if (!burning) flames = new Float32Array(0)
    fell.most = Math.max(fell.most, bodies)
    if (answer.released) {
      fell.ms = answer.ms
      // Broken by hand, a device says so too: what came loose and how the frames are.
      if (!flying) { report.hand = { ...fell, fps: Math.round(1000 / frameMs), scale }; void post('hand') }
    } else {
      fell.stepMs = answer.ms
      fell.worstMs = Math.max(fell.worstMs, answer.ms)
      fell.tried = answer.tried
    }
  }
  mover.onerror = (e) => { waiting = 0; ticking = false; report.notes.push(`mover: ${e.message}`) }
  // Things that live (#245): bodies that are kept, and driven by whoever rides them. In a shared world the world's
  // own process moves them, and this page says only what a rider asks.
  const alive = living({ send: (ask) => { if (!far) mover.postMessage(ask) }, wake: () => { bodies = Math.max(bodies, 1) }, piece: (id) => moving.get(id), input: controls, hud: over, pose, ground: (x, z) => core.ground_at(Math.round(x * M), Math.round(z * M)) / M, world: far, made: () => made })
  /** How many bodies are on their way down: every body but the living, which are bodies for as long as they live. */
  const loose = () => moving.size - alive.things.reduce((n, t) => n + (moving.has(t.id) ? 1 : 0), 0)
  /** Moves what is loose on by `dt` seconds: the worker is asked once a frame, and not again until it has answered. */
  const fallOn = (dt: number) => {
    owed = Math.min(owed + dt, 0.1)
    if (putting.length && (performance.now() - putSince > 180 || bodies === 0)) put()
    if (!far && (bodies > 0 || burning > 0 || running) && !ticking) { ticking = true; mover.postMessage({ tick: owed } satisfies Ask); owed = 0 }
    if (bodies === 0 && burning === 0 && !running) owed = 0
    if (!off.has('flames')) for (let i = 0; i < flames.length; i += 3) smoke.flame([flames[i], flames[i + 1], flames[i + 2]], dt)
    if (running) for (const at of water.landings) smoke.spray(at, dt)
    // A body that is cells again is drawn until those cells are in the picture.
    const made = world.stats.stale === 0 && world.stats.wanted === 0
    lying = lying.filter((l) => { if (++l.shown > 2 && made) { l.piece.destroy(); return false } return true })
  }

  /** Breaks what is straight ahead. What it is made of decides how far the break goes (the core's kinds), and what that leaves unheld falls. Returns where, or null for sky. */
  const blast = async (radius = force, spark = sparks) => {
    const v = view(), hit = await march.pick(v)
    if (!hit) return null
    // A little inside the face, so a wall is broken through and not grazed.
    const at = v.eye.map((e, a) => Math.round(e + v.forward[a] * (hit.t + radius * 0.3))) as [number, number, number]
    strike(at, radius, spark)
    const colour = hit.colour ? colours.subarray(hit.colour * 4, hit.colour * 4 + 3) : stuff.subarray(hit.material * 8, hit.material * 8 + 3)
    // Glass goes in many small pieces, the rest in fewer lumps; dust of the same stuff either way.
    const glass = hit.material === 11
    debris.burst(at, radius * (glass ? 2 : 1), Math.min(900, radius * radius * (glass ? 9 : 4)), [colour[0], colour[1], colour[2]], glass ? 0.5 : 1.1)
    return { at, ...hit }
  }
  /** A blast at a place (the world's finest cells), whatever is or is not there. */
  const strike = (at: readonly [number, number, number], radius = force, spark = sparks) => {
    fell.asks++
    waiting++
    mover.postMessage({ blast: [at[0], at[1], at[2]], radius, after: heard, spark } satisfies Ask)
    // In a shared world the blast is made when the world says so (its echo), for everyone at once.
    if (!far) struck(at, radius)
  }
  /** A blast as it is made in the world this page draws: the cells it empties, its fire and smoke. */
  const struck = (at: readonly [number, number, number], radius: number, seen = true) => {
    put()
    change(ball(at[0], at[1], at[2], radius, 0))
    if (seen) { smoke.blast(at, radius); shocks.push({ at, radius, t: folkClock.now() }); ears?.blast(at, radius) }
  }
  // Others in a shared world: each person and agent is drawn as the one figure, their name over it (presence.ts).
  const others = far ? presence(far, folk, over, () => ({ at: [pose.x * M, pose.y * M, pose.z * M], yaw: pose.yaw })) : null
  if (far) folkClock.now = far.clock
  /** How this page has a thing made (ask.ts): the ask bar, the wand and the checks all ask through this. */
  const wishes = asker(() => { const v = view(); return { eye: [Math.round(v.eye[0]), Math.round(v.eye[1]), Math.round(v.eye[2])], toward: [v.forward[0], v.forward[1], v.forward[2]] } }, () => others?.name ?? 'someone')
  /** The things made in this world, as the world tells of them (things.ts). Without a shared world there are none. */
  const made = things()
  /** What becomes of a wish: asked, and shown at its place as it goes (making.ts). */
  const wish = making(over, wishes)
  /** What is seen at the place meanwhile: the world's loose cells gathering there (gather.ts). */
  const gathering = gather(debris, smoke, wish, made)
  over.line.starters = ['a market stall with a striped awning', 'a red telephone box', 'a park bench under a lamp', 'a fountain']
  over.line.onask = (ask) => {
    // Things are made in a world that is kept and shared; and by a helper on the asker's own machine.
    if (!far) return over.notice('Things are made in a shared world: open this page with ?shared=1', 7000)
    if (!wishes.known) return over.notice('To make things, run node helper.mjs on your machine and open the address it prints', 9000)
    void wish(ask)
  }
  if (far) far.onecho = (echo, live) => {
    if (echo.blast || echo.edit) asked.push(echo.by === far.me)
    made.heard(echo, live)
    if (echo.blast) struck(echo.blast, echo.radius ?? force, live)
    else if (echo.edit && echo.box) { put(); change({ words: Int32Array.from(echo.edit), box: echo.box }) }
  }

  /** Sets alight what can burn round what is straight ahead. Returns where, or null for sky. */
  const ignite = async (radius = 4) => {
    const v = view(), hit = await march.pick(v)
    if (!hit) return null
    const at = v.eye.map((e, a) => Math.round(e + v.forward[a] * (hit.t + 1))) as [number, number, number]
    // The answer says how many cells burn, which is what keeps the mover asked from then on.
    ticking = true
    mover.postMessage({ ignite: at, radius, tick: 0 } satisfies Ask)
    return { at, ...hit }
  }

  /** A cannon's shot: a steel ball 80 cm across, sent the way the eye looks at 42 m a second. What it strikes breaks. */
  const shoot = () => {
    const v = view()
    mover.postMessage({ ball: { from: [v.eye[0] + v.forward[0] * 14, v.eye[1] + v.forward[1] * 14, v.eye[2] + v.forward[2] * 14], speed: [v.forward[0] * 420, v.forward[1] * 420, v.forward[2] * 420], radius: 4, kind: 12 | (5 << 8) } } satisfies Ask)
    // Until the answer says how many bodies there are, there is at least this one to move.
    bodies = Math.max(bodies, 1)
  }

  /** An edit of the page's own making, told to the mover, which is then asked what it left unheld round `at`. */
  const make = (edit: Edit, at: [number, number, number]) => {
    waiting++
    mover.postMessage({ edit: edit.words, after: heard, release: at } satisfies Ask)
    if (far) return
    put()
    change(edit)
  }

  /** Cuts level through what is ahead: a slot two cells thick and 9 m across. What stood on it has nothing under it. */
  const cut = async () => {
    const v = view(), hit = await march.pick(v)
    if (!hit) return null
    const at = v.eye.map((e, a) => Math.round(e + v.forward[a] * (hit.t + 2))) as [number, number, number], reach = 44, runs: number[] = []
    for (let dy = 0; dy < 2; dy++) for (let dz = -reach; dz <= reach; dz++) {
      const half = Math.floor(Math.sqrt(reach * reach - dz * dz))
      runs.push(at[0] - half, at[0] + half + 1, at[1] + dy, at[2] + dz, 0)
    }
    make(rows(Int32Array.from(runs), [at[0] - reach, at[1], at[2] - reach, at[0] + reach + 1, at[1] + 2, at[2] + reach + 1]), at)
    return { at, ...hit }
  }

  /** Puts a ball of brick a metre across against what is ahead. With nothing under it, it falls. */
  const place = async () => {
    const v = view(), hit = await march.pick(v)
    if (!hit) return null
    const at = v.eye.map((e, a) => Math.round(e + v.forward[a] * (hit.t - 6))) as [number, number, number]
    make(ball(at[0], at[1], at[2], 5, 8 | (30 << 8)), at)
    return { at, ...hit }
  }

  // ── Tools ───────────────────────────────────────────────────────────────
  // What a click, a tap on the red button, or the space of a touch does: one of these, picked by key or from the bar.
  const tools: { name: string; use: () => unknown }[] = [
    { name: 'Hammer', use: () => blast(5, false) },
    { name: 'Charge', use: () => blast(12) },
    { name: 'Big charge', use: () => blast(32) },
    { name: 'Cannon', use: shoot },
    { name: 'Torch', use: () => ignite(4) },
    { name: 'Cutter', use: cut },
    { name: 'Brick', use: place },
  ]
  let tool = 1
  const bar = over.tools(tools.map((t) => t.name), (i) => pickTool(i))
  const pickTool = (i: number) => { tool = i; bar.picked(i) }
  pickTool(tool)
  tools.forEach((_, i) => own.keys.set(`Digit${i + 1}`, () => pickTool(i)))
  own.keys.set('KeyF', () => void ignite())
  own.use = () => { const { name, use } = tools[tool]; void Promise.resolve(use()).then((hit) => ears?.used(name, hit as Parameters<NonNullable<typeof ears>['used']>[1])); return true }

  /** What is ahead when the head is turned a little (radians right and up) from where it looks: for the checks. */
  const pick = async (right = 0, up = 0, plain = false) => {
    pose.yaw += right; pose.pitch += up
    const v = view()
    pose.yaw -= right; pose.pitch -= up
    return march.pick(v, plain)
  }

  /**
   * How many steps the rays of a picture from here take (with the flags given): the mean for a pixel and the most. Time on the GPU is steps times what a step costs: this says which
   * of the two a change moved. For the bench and for finding what is slow.
   */
  const steps = async (withFlags = flags) => {
    // At the size the page draws at: what is drawn as one block goes by how big a pixel is.
    const size: [number, number] = [canvas.width, canvas.height], v = view()
    const to = offscreen(gpu, size), read = device.createBuffer({ size: size[0] * size[1] * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const encoder = device.createCommandEncoder()
    paused = true
    march.draw(encoder, to, v, (withFlags & ~HEAT) | COUNT, 0)
    encoder.copyTextureToBuffer({ texture: to.texture }, { buffer: read, bytesPerRow: size[0] * 4 }, size)
    device.queue.submit([encoder.finish()])
    await read.mapAsync(GPUMapMode.READ)
    const bytes = new Uint8Array(read.getMappedRange().slice(0))
    read.unmap(); read.destroy(); to.destroy()
    paused = false
    // The count is in the first two colours, low byte first; a picture kept blue-first has them the other way about.
    const low = gpu.format.startsWith('bgra') ? 2 : 0
    let sum = 0, most = 0
    for (let i = 0; i < bytes.length; i += 4) { const n = bytes[i + low] + bytes[i + 1] * 256; sum += n; most = Math.max(most, n) }
    return { mean: sum / (bytes.length / 4), most }
  }

  /**
   * How much of the picture from here differs between shadows from the sun's maps and shadows traced: the share
   * of pixels (of a small picture) that differ by more than a tenth of the range in any colour. For the checks.
   */
  const shadowsDiffer = async () => {
    const size: [number, number] = [640, 360], v = view(), was = march.maps
    const shot = async (maps: boolean) => {
      march.maps = maps
      const to = offscreen(gpu, size), read = device.createBuffer({ size: size[0] * size[1] * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const encoder = device.createCommandEncoder()
      march.draw(encoder, to, v, SHADOWS, 0)
      encoder.copyTextureToBuffer({ texture: to.texture }, { buffer: read, bytesPerRow: size[0] * 4 }, size)
      device.queue.submit([encoder.finish()])
      await read.mapAsync(GPUMapMode.READ)
      const bytes = new Uint8Array(read.getMappedRange().slice(0))
      read.unmap(); read.destroy(); to.destroy()
      return bytes
    }
    paused = true
    const a = await shot(true), b = await shot(false)
    paused = false
    march.maps = was
    let differ = 0
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 24 || Math.abs(a[i + 1] - b[i + 1]) > 24 || Math.abs(a[i + 2] - b[i + 2]) > 24) differ++
    return differ / (a.length / 4)
  }

  /** The march from here at the device's own pace, ms a frame at the canvas's full size: for comparing two settings fairly. */
  const paced = async (withFlags = flags, withPeople = false, withWand = false) => {
    const to = offscreen(gpu, [canvas.width, canvas.height]), v = view()
    paused = true
    // With the people in sight drawn over it too, if asked: what they cost the GPU is the difference.
    const p = await pace(gpu, to, (encoder, target) => { march.draw(encoder, target, v, withFlags, 0); if (withPeople) folk.draw(encoder, target, v, 0); if (withWand) staff.draw(encoder, target, v, 0) }, 100)
    paused = false
    to.destroy()
    return p.ms
  }

  /**
   * A fixed piece of work that is none of the engine's (four layers of lit pixels at the canvas's size) at the device's
   * own pace, ms a frame: how busy the GPU is with other things, so that a timing taken beside it can be trusted or not.
   */
  let filler: ReturnType<typeof fill> | null = null
  const quiet = async () => {
    const to = offscreen(gpu, [canvas.width, canvas.height]), draw = (await (filler ??= fill(gpu))).draw(4)
    paused = true
    const p = await pace(gpu, to, draw, 60)
    paused = false
    to.destroy()
    return p.ms
  }

  // ── Spells (#246) ───────────────────────────────────────────────────────
  // A known spell is done at once from the kept library (spells.ts). With the wand in hand a click casts the spell
  // in hand at what is aimed at, and words on the ask bar that call a known spell take it in hand and cast it.
  const magic = caster({
    kind: staff.kind, feet: (x, z) => core.feet_at(x, z), make, strike,
    light: (at, radius) => { ticking = true; mover.postMessage({ ignite: at, radius, tick: 0 } satisfies Ask) },
    ball: smoke.ball, flash: smoke.glint,
  })
  let inHand: Spell = LIBRARY[0]
  staff.label = inHand.name
  /** Casts a spell at a target, and says why not if it could not be. */
  const spell = (which: Spell, target: Aim | null) => { const why = magic.cast(which, target, view()); if (why) over.notice(why); return why }
  staff.oncast = (target) => { spell(inHand, target) }
  // Words alone that call a known spell are taken before they are a wish; anything else is the making lane's wish.
  over.line.take((ask) => {
    if (!staff.held) return false
    const called = ask.wish && !ask.picture && !ask.link ? known(ask.wish) : null
    if (!called) return false
    inHand = called
    staff.label = called.name
    staff.cast()
    return true
  })

  // For the checks, and for looking round from the console.
  Object.assign(globalThis, { engine: { world, pose, gpu, input: controls, hud: over, things: made, asker: wishes, ask: wishes.ask, wish, gathering, march, wand: staff, view, feet: (x: number, z: number) => core.feet_at(x, z), folk, folkClock, paced, steps, quiet, blast, strike, ignite, shoot, cut, place, set: (at: [number, number, number], radius: number, kind: number) => make(ball(at[0], at[1], at[2], radius, kind), at), pickTool, get tool() { return tools[tool].name }, ground: (x: number, z: number) => core.ground_at(Math.round(x * M), Math.round(z * M)) / M, pick, debris, smoke, get burning() { return burning }, get flowing() { return running }, water, get others() { return others?.count ?? 0 }, say: (text: string) => others?.say(text), shadowsDiffer, fell, get dropping() { return loose() + lying.length + putting.length }, get bodies() { return bodies }, get leaning() { return leaning() }, get hour() { return hour }, set hour(h: number | null) { setHour(h) }, get rain() { return march.rain }, set rain(v: number) { march.rain = v }, get settling() { return waiting > 0 }, get gpuMs() { return gpuMs }, get cpuMs() { return cpuMs }, off, spent, get frameMs() { return frameMs }, get scale() { return scale }, set scale(v: number) { scale = v; held = 1e9 }, get flags() { return flags }, set flags(v: number) { flags = v } } })
  Object.defineProperty((globalThis as unknown as { engine: object }).engine, 'ears', { get: () => ears })
  // The wand's spells, on a line of their own (#246).
  Object.assign((globalThis as unknown as { engine: object }).engine, { magic, spell: (words: string, target: Aim | null = staff.target) => { const s = known(words); return s ? spell(s, target) : 'not a known spell' } })

  // `?living=car`: a car to drive stands in the street ahead of where the page starts, with no console needed.
  if (query.get('living') === 'car') void (async () => {
    if (far) while (!far.live) await new Promise((done) => setTimeout(done, 100))
    // In a shared world one is enough: whoever comes later finds the one that is there.
    if (far && [...made.all.values()].some((t) => t.name === 'car')) return
    const x = Math.round(pose.x * M) + 60, z = Math.round(pose.z * M) + 4
    await alive.spawn(car([x, core.ground_at(x, z) + 5, z]))
  })()
  // Living things, on a line of their own: every lane adds to the line above.
  Object.assign((globalThis as unknown as { engine: object }).engine, { alive, car })

  if (flying) {
    // The flight is long and nobody touches the screen: ask that it stay on.
    try { await (navigator as Navigator & { wakeLock?: { request(kind: 'screen'): Promise<unknown> } }).wakeLock?.request('screen') } catch { report.notes.push('no wake lock') }
    if (!('wakeLock' in navigator)) report.notes.push('no wake lock here')
    report.base = await cadence()
    report.env.canvas = [canvas.width, canvas.height]
    await post('start')
    await flight({
      gpu, world, march, pose, view, street, report, post,
      canvas: () => [canvas.width, canvas.height],
      pause: (on) => { paused = on },
      now: () => ({ frameMs, gpuMs, scale }),
      watch: (each) => { watchers.add(each); return () => watchers.delete(each) },
      say: (text) => { saying = text },
      // The flight measures breaking by itself, as it did before there was fire.
      blast: (radius) => blast(radius, false),
      falling: () => ({ settling: waiting > 0, dropping: loose() + lying.length + putting.length, pieces: fell.pieces, cells: fell.cells, ms: fell.ms, stepMs: fell.worstMs, most: fell.most }),
      breaks: query.get('breaks') !== '0',
      seconds: Number(query.get('seconds') ?? 40),
    })
    saying = 'Measured and sent. Fly where you like'
  }
}

main().catch(async (e: unknown) => {
  const text = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
  over.status(`This did not work here: ${text.split('\n')[0]}`)
  console.error(e)
  report.notes.push(`failed: ${text}`)
  await post('error')
})
