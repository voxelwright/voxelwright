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
import { realms, type Pose } from './realms.ts'
import { portal } from './portal.ts'
import { wheel } from './wheel.ts'
import { car, living } from './living.ts'
import { person } from './person.ts'
import { shots } from './shots.ts'
import { puffs } from './puffs.ts'
import { ball, fineRows, rows, stream, type Edit } from './edits.ts'
import { people, townsfolk } from './people.ts'
import { pieces, type Piece } from './pieces.ts'
import { restedRows, rowsOf, thing } from './fine.ts'
import { presence, seedOf } from './presence.ts'
import type { Shock } from './residents.ts'
import type { Answer, Ask } from './mover.ts'
import { read } from './told.ts'
import { wand, type Target as Aim } from './wand.ts'
import { hands } from './hands.ts'
import { plugins } from './plugins.ts'
import { workshop } from './workshop.ts'
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
/** `?fine=1` or `2` (#259, an experiment): the world's finest cells are 5 or 2.5 cm, in one or two more boxes round the eye that hold the core's cells written out finer. Only the march knows: nothing else drawn or done is scaled. */
const FINE = 1 << Number(query.get('fine') ?? 0)
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

  type Core = { memory: WebAssembly.Memory; ground_at(x: number, z: number): number; feet_at(x: number, z: number): number; world_edit(after: number): void; world_forget(): void; paving_at(x: number, z: number): number; world_kind(x: number, y: number, z: number): number; edits_room(words: number): number; merge_rows(lod: number, x0: number, x1: number, z0: number, z1: number): number; merged_words(): number; fine_cells(on: number): void; fine_refused(): number; make_sector(sx: number, sy: number, sz: number, lod: number): number }
  // The page's own core, behind a handle that stays the same when the core is built again and swapped in (#264,
  // `recore` below): whoever was handed `core`, or one of its functions, goes on using the one that is in.
  let inner = (await WebAssembly.instantiateStreaming(fetch('/page/core.wasm'), {})).instance.exports as unknown as Core
  const core = Object.defineProperties({}, Object.fromEntries(Object.keys(inner).map((k) => [k, typeof (inner as never)[k] === 'function' ? { value: (...a: number[]) => (inner as unknown as Record<string, (...a: number[]) => number>)[k](...a) } : { get: () => (inner as never)[k] }]))) as Core
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
    levels: Number(query.get('levels') ?? (phone ? 8 : 9) + Number(query.get('fine') ?? 0)),
    poolWords: (poolMb << 20) / 4,
    fine: Number(query.get('fine') ?? 0),
    bricks: query.get('bricks') === '1',
    fineSun: query.get('bricks') === '1' && query.get('finesun') !== '0',
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
  if (query.get('sound') !== '0') void sound().then((voice) => { ears = hearing(voice, { ground: core.ground_at, paving: core.paving_at, rain: () => march.rain, under: () => march.under, flames: () => flames, bodies: () => bodies, hour: () => hour ?? 12, making: () => wishes.busy > 0, kind: core.world_kind, seam: () => ({ things: made, hud: over, input: controls }), who: (id) => { if (far && id === far.me) return 'here'; const o = others?.where(id); if (o) return [o[0], o[1] + 12, o[2]]; const t = alive.things.find((t) => t.alive && t.ref === id), w = t && alive.where(t); return w ? w.at : null } }, { music: query.get('music') !== '0' }); }).catch(() => {})
  march.detail = Number(query.get('detail') ?? 1)
  march.maps = query.get('maps') !== '0'

  // Start on land, a little above a street.
  let startX = 700, startZ = 4070
  while (core.ground_at(startX, startZ) < 120 && startX < 400_000) startX += 1280
  const at = numbers('at', [startX / M, core.ground_at(startX, startZ) / M + 12, startZ / M])
  const look = numbers('look', [20, -8])
  const pose: { x: number; y: number; z: number; yaw: number; pitch: number; tilt?: [number, number, number, number] } = { x: at[0], y: at[1], z: at[2], yaw: (look[0] * Math.PI) / 180, pitch: (look[1] * Math.PI) / 180 }
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
    // Someone whose down is not the world's (person.ts): the eye's whole frame is turned with them.
    if (pose.tilt) { const q = pose.tilt, t = (v: readonly number[]) => { const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)] as const }; return { eye: [pose.x * M * FINE, pose.y * M * FINE, pose.z * M * FINE], forward: t(forward), right: t(right), up: t(up), tanHalf: Math.tan((Number(query.get('fov') ?? 70) * Math.PI) / 360) } }
    // Under the sea: under its top, where the ground by itself lies under it too (not in a pit dug on land).
    march.under = pose.y < 0 && core.ground_at(Math.round(pose.x * M), Math.round(pose.z * M)) < -1
    return { eye: [pose.x * M * FINE, pose.y * M * FINE, pose.z * M * FINE], forward, right, up, tanHalf: Math.tan((Number(query.get('fov') ?? 70) * Math.PI) / 360) }
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
  /** Residents a rule of the world has taken as its actors: the town's rule leaves them out (presence.ts). */
  const takenOff = new Set<number>()
  if (query.get('people') !== '0') folk.from.push(townsfolk(core, () => (worldHour ? worldHour() : hour ?? 11), () => march.rain, () => folkClock.now(), shocks, takenOff))
  /** How much colour and how much contrast the last pass gives the picture (glow.ts): the day's, until an hour is set. */
  let grade: [number, number] = [0.9, 0.1]
  /** Where the light comes from at an hour, how much of the day it is and how low the sun: null is the sun where it always stood. */
  const sunOf = (h: number | null) => {
    const hour = h === null ? null : ((h % 24) + 24) % 24
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
    return { sun, day, low }
  }
  /** What the portal draws each frame, once there is one (#264, portal.ts). */
  let portalDraw: ((encoder: GPUCommandEncoder, to: Offscreen, v: View, time: number) => void) | null = null
  const setHour = (h: number | null) => {
    hour = h === null ? null : ((h % 24) + 24) % 24
    const { sun, day, low } = sunOf(hour)
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
  // A realm's own look (#264, realms.ts): its hour and rain are set as the keys would set them; its grade stands in
  // place of the hour's and its tint multiplies the finished picture (glow.ts), until the page is in another realm.
  const ownLook = { hour, rain: march.rain }
  const realmLook: { grade: [number, number] | null; tint: [number, number, number] } = { grade: null, tint: [1, 1, 1] }
  /** In a shared world, the hour the town's residents are out by: the realm's own, else eleven, as the world's process has it (world.mjs `hourNow`), whatever hour this page shows. Null where the world is the page's own. */
  let worldHour: (() => number) | null = null
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
  /** How fast the world goes (#264): 1 as it does. What this page moves and its dust and smoke go by it; in a shared world the world's process says it. */
  const tempo = { rate: 1 }
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
    if (!alive.frame(dt) && !me.frame(dt)) walk(dt)
    steer(Math.max(1000 / 60, screenMs))
    const v = view(), to = fit()
    staff.frame(v)
    ears?.frame(v.eye, pose.yaw, dt)
    magic.step(dt)
    grip.frame()
    lap('steer')
    fallOn(dt)
    lap('fallOn')
    world.update(v.eye)
    lap('update')
    if (spoiled.length && !off.has('spoil') && world.stats.stale === 0 && world.stats.wanted === 0) { for (const edit of spoiled) march.sun.spoil(edit); spoiled.length = 0 }
    lap('spoil')
    const encoder = device.createCommandEncoder()
    const timed = clock && !clock.busy
    debris.step(dt * tempo.rate, (x, z) => core.ground_at(Math.floor(x), Math.floor(z)))
    gathering.step(dt)
    smoke.step(dt * tempo.rate)
    lap('step')
    for (const level of world.moved) march.sun.age(level)
    march.tend(encoder, v, world.nearlyWhole())
    lap('tend')
    if (pose.y > SPACE) {
      // Where the page starts is the land's middle (land.rs HOME), 70 m east and 407 m south of the world's corner.
      planet.draw(encoder, to, v, pose.y / 1000, [(pose.x - 70) / 1000, (pose.z - 407) / 1000], march.sun.s, march.day, (now - started) / 1000, timed ? { querySet: clock.set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined)
    } else {
      march.draw(encoder, to, v, flags, (now - started) / 1000, timed ? { querySet: clock.set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined)
      portalDraw?.(encoder, to, v, (now - started) / 1000)
      if (!off.has('water')) water.draw(encoder, to, v, (now - started) / 1000)
      if (!off.has('pieces')) falling.draw(encoder, to, v, march.sun.s)
      if (!off.has('people')) folk.draw(encoder, to, v, (now - started) / 1000)
      if (!off.has('crumbs')) debris.draw(encoder, to, v)
      if (!off.has('puffs')) smoke.draw(encoder, to, v)
      staff.draw(encoder, to, v, (now - started) / 1000)
    }
    blit(encoder, to, context.getCurrentTexture().createView(), march.under || pose.y > SPACE ? 0 : march.rain * (0.35 + 0.65 * march.day), (now - started) / 1000, march.under ? [1.25, 0.35] : realmLook.grade ?? grade, march.under || pose.y > SPACE ? 0 : 1 - march.day, realmLook.tint)
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
  /** While a step is taken into a world whose sectors are already held (#264, the portal): they were made with these very edits. */
  let adopted = false
  const change = (edit: Edit) => { if (!adopted) world.edit(edit); spoiled.push(edit); staff.changed(edit); me.edit(edit.words) }
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
    // What goes fast is seen in flight (shots.ts), once this page is up to date with its world.
    if (!far || far.live) streaks.heard(told)
    if (!far) me.heard(answer, told)
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
  const streaks = shots(smoke, debris)
  const alive = living({ send: (ask) => { if (!far) mover.postMessage(ask) }, wake: () => { bodies = Math.max(bodies, 1) }, piece: (id) => moving.get(id), input: controls, hud: over, pose, ground: (x, z) => core.ground_at(Math.round(x * M), Math.round(z * M)) / M, world: far, made: () => made })
  /** How many bodies are on their way down: every body but the living, which are bodies for as long as they live. */
  const loose = () => moving.size - alive.things.reduce((n, t) => n + (moving.has(t.id) ? 1 : 0), 0)
  /** Moves what is loose on by `dt` seconds: the worker is asked once a frame, and not again until it has answered. */
  const fallOn = (dt: number) => {
    owed = Math.min(owed + dt, 0.1)
    if (putting.length && (performance.now() - putSince > 180 || bodies === 0)) put()
    if (!far && (bodies > 0 || burning > 0 || running) && !ticking) { ticking = true; mover.postMessage({ tick: owed * tempo.rate } satisfies Ask); owed = 0 }
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
  // On foot a person is where their feet are, facing the way their body does; flying, where their eye is.
  const others = far ? presence(far, folk, over, () => { const f = me.feet; return f ? { at: [f.at[0], f.at[1] + 16.5, f.at[2]], yaw: f.yaw } : { at: [pose.x * M, pose.y * M, pose.z * M], yaw: pose.yaw } }, takenOff) : null
  // A person's own body (#264, person.ts): B gets down onto the feet and back up to fly; `?walk=1` starts on foot.
  // This page moves it: in the core that moves everything else here, or in a shared world in a core of its own that
  // is told every edit, so that the body walks on the world as it is.
  const shadow = far ? new Worker('/page/mover.ts', { type: 'module' }) : null
  const me = person({ send: (ask) => (shadow ?? mover).postMessage(ask), wake: () => { if (!far) bodies = Math.max(bodies, 1) }, own: !!shadow, input: controls, hud: over, pose, folk, seed: seedOf(others?.name ?? 'me'), name: others?.name })
  if (shadow) shadow.onmessage = (e: MessageEvent<Answer>) => { if (!e.data.failed) me.heard(e.data, read(e.data.words)) }
  controls.always('KeyB', () => { me.walk(!me.on); return true })
  // What a rule says this person's body can do, and how fast the world goes (rules/bodies.mjs): the world's clock is
  // everyone's but those a rule spares, who move as they always did while all else slows.
  // A blow on this page's own person (rules/blows.mjs): thrown the way it went, or put on the ground.
  if (far) far.onblow = (b) => { if (b.push) me.push(b.push); if (b.down !== undefined) me.down(b.down) }
  if (far) far.onbodies = (b) => { tempo.rate = b.clock.rate; me.clock = b.clock.spare.includes(far.me) ? 1 : b.clock.rate; me.can = b.can[far.me] ?? {} }
  if (query.get('walk') === '1') me.walk(true)
  if (far) folkClock.now = far.clock
  if (far) worldHour = () => far.realm.look?.hour ?? 11
  /** How this page has a thing made (ask.ts): the ask bar, the wand and the checks all ask through this. */
  /** Where this page's eye is and looks, in whole cells: what an ask is asked from. */
  const gaze = (): { eye: [number, number, number]; toward: [number, number, number] } => { const v = view(); return { eye: [Math.round(v.eye[0]), Math.round(v.eye[1]), Math.round(v.eye[2])], toward: [v.forward[0], v.forward[1], v.forward[2]] } }
  const wishes = asker(gaze, () => others?.name ?? 'someone')
  /** The things made in this world, as the world tells of them (things.ts). Without a shared world there are none. */
  const made = things()
  /** What becomes of a wish: asked, and shown at its place as it goes (making.ts). */
  /** How one steps into a realm that was just made: a portal to it, once there is one (set below); until then the page is opened there. */
  let enterRealm = (id: string) => { const to = new URLSearchParams(location.search); to.set('realm', id); to.delete('shared'); location.assign(`${location.pathname}?${to}`) }
  /** The line to type on, opened with a new realm's words begun and the caret after them: from the wheel, and again when a realm was asked for with nothing said of it. */
  const beginRealm = () => { over.line.show(); const line = document.querySelector<HTMLInputElement>('#line'); if (line) { line.value = 'Create a realm called '; line.dispatchEvent(new Event('input', { bubbles: true })); line.focus(); line.setSelectionRange(line.value.length, line.value.length) } }
  // Words that say only that a realm is wanted are not sent to be made: the line stays, in the same turn of the keys, so that what is typed next is its idea.
  over.line.take((ask) => {
    if (ask.picture || ask.link || !/\brealm\b/i.test(ask.wish ?? '') || (ask.wish ?? '').replace(/\b(please|create|make|new|start|open|build|imagine|a|an|the|realm|called|named|me|us)\b/gi, '').replace(/[^\p{L}\p{N}]+/gu, '')) return false
    over.notice('Say what the realm is: a name, a place, what happens there', 6000)
    queueMicrotask(beginRealm)
    return true
  })
  const wish = making(over, wishes, gaze, (id) => enterRealm(id), () => setTimeout(beginRealm, 0))
  /** What is seen at the place meanwhile: the world's loose cells gathering there (gather.ts). */
  const gathering = gather(debris, smoke, wish, made)
  over.line.starters = ['a market stall with a striped awning', 'a red telephone box', 'a park bench under a lamp', 'a fountain']
  over.line.onask = (ask) => {
    // Things are made in a world that is kept and shared; and by a helper on the asker's own machine.
    if (!far) return over.notice('Things are made in a shared world: open this page with ?shared=1', 7000)
    if (!wishes.known) return over.notice('To make things, run node helper.mjs on your machine and open the address it prints', 9000)
    void wish(ask)
  }
  // ── Realms (#264) ───────────────────────────────────────────────────────
  // Stepping from the world this page is in to another that the server keeps, with no loading (realms.ts). `leave`
  // is everything this file holds of a world: bodies on their way and lying, cells waiting to be put, fire and
  // water, the made things' records, the edits the sectors and this thread's core were told of.
  const began: Pose = { ...pose }
  let afoot = false, heldKeys: string[] = []
  const realm = far ? realms({
    far, began,
    leave: (trade) => {
      // On foot, the body is taken up first: its own core is about to forget the world it stands on, and it is set down again on arriving.
      afoot = me.on
      // Taking the body up lets go of every key (input.ts `push`): those held to move are held still when it is set down.
      heldKeys = afoot ? ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].filter((code) => controls.held(code)) : []
      if (afoot) me.walk(false)
      shadow?.postMessage({ forget: true })
      for (const piece of moving.values()) piece.destroy()
      for (const l of lying) l.piece.destroy()
      moving.clear(); lying = []; putting = []; asked.length = 0; shocks.length = 0
      heard = 0; waiting = 0; bodies = 0; burning = 0; running = false; flames = new Float32Array(0)
      for (const id of [...made.all.keys()]) made.heard({ by: '', gone: id }, false)
      // The sun's maps are drawn again where the old world's edits were, once those sectors have been made again.
      if (trade) { trade(); adopted = true } else spoiled.push(...world.swap([]))
      core.world_forget()
    },
    came: () => { adopted = false },
    // On foot the body is set down where it is to be, and the eye put back where it rides: it stays there until the body is made.
    place: (to, body) => { Object.assign(pose, body ?? to); if (afoot) { afoot = false; me.walk(true); for (const code of heldKeys) dispatchEvent(new KeyboardEvent('keydown', { code })) } Object.assign(pose, to) },
    arrival: (a) => ({ x: a.at[0] / M, y: (a.at.length === 3 ? a.at[1] : core.feet_at(a.at[0], a.at[a.at.length - 1])) / M + 1.65, z: a.at[a.at.length - 1] / M, yaw: a.yaw, pitch: a.pitch }),
    look: (l) => { setHour(l?.hour !== undefined ? l.hour : ownLook.hour); march.rain = l?.rain ?? ownLook.rain; realmLook.grade = l?.grade ?? null; realmLook.tint = l?.tint ?? [1, 1, 1] },
    made: () => ({ shown: far.live && world.levels.every((l) => l.whole.high.every((h, a) => h - l.whole.low[a] >= l.grid[a] / 2)), near: far.live && world.levels.slice(0, 3).every((l) => l.whole.high.every((h, a) => h - l.whole.low[a] === l.grid[a])) && world.stats.stale === 0, whole: far.live && world.stats.wanted === 0 && world.stats.stale === 0, sectors: world.stats.made, edits: world.done().length }),
  }) : null
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
  const paced = async (withFlags = flags, withPeople = false, withWand = false, withPieces = false) => {
    const to = offscreen(gpu, [canvas.width, canvas.height]), v = view()
    paused = true
    // With the people in sight drawn over it too, if asked: what they cost the GPU is the difference.
    const p = await pace(gpu, to, (encoder, target) => { march.draw(encoder, target, v, withFlags, 0); if (withPeople) folk.draw(encoder, target, v, 0); if (withWand) staff.draw(encoder, target, v, 0); if (withPieces) falling.draw(encoder, target, v, march.sun.s) }, 100)
    paused = false
    to.destroy()
    return p.ms
  }

  /**
   * The GPU's own time for the march and for the bodies drawn over it, each pass by its own clock, at the canvas's full
   * size: the least and the middle of `times` frames, ms. On a GPU other threads share, the wall clock of `paced` says
   * how busy they are; a pass's own least time says more nearly what the pass costs (#259).
   */
  const passes = async (withFlags = flags, times = 40) => {
    if (!gpu.canTime) return null
    const to = offscreen(gpu, [canvas.width, canvas.height]), v = view()
    const set = device.createQuerySet({ type: 'timestamp', count: 4 }), resolved = device.createBuffer({ size: 32, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }), read = device.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const march_: number[] = [], bodies_: number[] = []
    paused = true
    for (let i = 0; i < times; i++) {
      const encoder = device.createCommandEncoder()
      march.draw(encoder, to, v, withFlags, 0, { querySet: set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 })
      falling.draw(encoder, to, v, march.sun.s, { querySet: set, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 })
      encoder.resolveQuerySet(set, 0, 4, resolved, 0)
      encoder.copyBufferToBuffer(resolved, 0, read, 0, 32)
      device.queue.submit([encoder.finish()])
      await read.mapAsync(GPUMapMode.READ)
      const [a, b, c, d] = new BigUint64Array(read.getMappedRange().slice(0))
      read.unmap()
      march_.push(Number(b - a) / 1e6)
      if (falling.count) bodies_.push(Number(d - c) / 1e6)
    }
    paused = false
    to.destroy(); set.destroy(); resolved.destroy(); read.destroy()
    const sum = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s.length ? { least: s[0], middle: s[s.length >> 1] } : null }
    return { march: sum(march_), bodies: sum(bodies_) }
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
  // What a realm's rules offer to do (hands.ts): keys and buttons, and the aimed ones entries of the wand's wheel
  // beside the spell in hand.
  const grip = hands(far, controls, over, () => { const v = view(); return { from: v.eye, to: v.forward } })
  const casts = () => { staff.powers = [{ name: inHand.name }, ...grip.offered.filter((o) => o.aim).map((o) => ({ name: o.word, offer: o }))] }
  grip.onchange = casts
  casts()
  /** Casts a spell at a target, and says why not if it could not be. */
  const spell = (which: Spell, target: Aim | null) => { const why = magic.cast(which, target, view()); if (why) over.notice(why); return why }
  staff.oncast = (target) => {
    const offer = (staff.powers[staff.power] as { offer?: (typeof grip.offered)[number] } | undefined)?.offer
    if (!offer) { spell(inHand, target); return }
    grip.do(offer)
    if (offer.hold) grip.do(offer, 'up')
  }
  // Words alone that call a known spell are taken before they are a wish; anything else is the making lane's wish.
  over.line.take((ask) => {
    if (!staff.held) return false
    const called = ask.wish && !ask.picture && !ask.link ? known(ask.wish) : null
    if (!called) return false
    inHand = called
    casts()
    staff.power = 0
    staff.cast()
    return true
  })

  // For the checks, and for looking round from the console.
  Object.assign(globalThis, { engine: { world, pose, gpu, input: controls, hud: over, things: made, asker: wishes, ask: wishes.ask, wish, gathering, march, wand: staff, view, feet: (x: number, z: number) => core.feet_at(x, z), folk, folkClock, paced, steps, quiet, blast, strike, ignite, shoot, cut, place, set: (at: [number, number, number], radius: number, kind: number) => make(ball(at[0], at[1], at[2], radius, kind), at), pickTool, get tool() { return tools[tool].name }, ground: (x: number, z: number) => core.ground_at(Math.round(x * M), Math.round(z * M)) / M, pick, debris, smoke, get burning() { return burning }, get flowing() { return running }, water, get others() { return others?.count ?? 0 }, say: (text: string) => others?.say(text), shadowsDiffer, fell, get dropping() { return loose() + lying.length + putting.length }, get bodies() { return bodies }, get leaning() { return leaning() }, get hour() { return hour }, set hour(h: number | null) { setHour(h) }, get rain() { return march.rain }, set rain(v: number) { march.rain = v }, get settling() { return waiting > 0 }, get gpuMs() { return gpuMs }, get cpuMs() { return cpuMs }, off, spent, get frameMs() { return frameMs }, get scale() { return scale }, set scale(v: number) { scale = v; held = 1e9 }, get flags() { return flags }, set flags(v: number) { flags = v } } })
  Object.defineProperty((globalThis as unknown as { engine: object }).engine, 'ears', { get: () => ears })
  // A voice for what people say (#264: being tried, off unless asked for): others' words, not this page's own.
  if (far && query.has('voices')) { const shown = far.onsaid; far.onsaid = (v) => { shown?.(v); if (v.by !== far.me) ears?.spoke(v, query.get('voices')) } }
  // The core built again and taken while the page runs (#264): this thread's own, then the workers', and every
  // sector is made again behind the picture. A person on foot is taken up, the core their body walks in (`shadow`)
  // takes the new build and is told the world's edits again, and they are set down where they stood, keys held
  // still held. Answers how long this thread's part took. Not carried across, alone: whatever is loose (the mover's core).
  const recore = async (url: string) => {
    const began = performance.now()
    inner = (await WebAssembly.instantiateStreaming(fetch(url), {})).instance.exports as unknown as Core
    world.recore(url)
    if (shadow) {
      const on = me.on, held = on ? ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].filter((code) => controls.held(code)) : []
      if (on) me.walk(false)
      shadow.postMessage({ core: url } as never)
      for (const e of world.done()) me.edit(e.words)
      if (on) { me.walk(true); for (const code of held) dispatchEvent(new KeyboardEvent('keydown', { code })) }
    }
    return performance.now() - began
  }
  Object.assign((globalThis as unknown as { engine: object }).engine, { recore })
  // The workshop (#264, workshop.ts): what the engine could not do yet, and sending it to a development session.
  Object.assign((globalThis as unknown as { engine: object }).engine, { workshop: workshop(over, wishes) })
  // The engine's plugins (#264, plugins.ts): page sides the world says to have, imported as it says so.
  if (far) Object.assign((globalThis as unknown as { engine: object }).engine, { plugins: plugins(far) })
  // People (#218): which residents a rule of the world has taken off their rounds.
  Object.assign((globalThis as unknown as { engine: object }).engine, { takenOff })
  // The wand's spells, on a line of their own (#246).
  Object.assign((globalThis as unknown as { engine: object }).engine, { hands: grip, magic, spell: (words: string, target: Aim | null = staff.target) => { const s = known(words); return s ? spell(s, target) : 'not a known spell' } })

  // A thing of finer cells stood beside the world (#259, fine.ts): cells as base64 of 16-bit kinds, its size, where
  // the middle of its foot is (the world's cells), how many of its cells make one of the world's, a turn about y.
  const fine = (cells: string, size: [number, number, number], at: [number, number, number], per = 4, turn: number | [number, number, number, number] = 0) => {
    const kinds = new Uint16Array(Uint8Array.from(atob(cells), (c) => c.charCodeAt(0)).buffer)
    const piece = falling.add(thing(kinds, size))
    Object.assign(piece, { pos: at, rot: typeof turn === 'number' ? [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)] : turn, cell: 1 / per })
    beside.set(piece, { kinds, size, per })
    return piece
  }
  // The handover (#259, `?bricks=1`): such a thing, where it lies and as it is turned, becomes finer cells of the
  // world, and is no longer drawn beside it. One edit of rows, known to this page's picture only.
  const beside = new Map<object, { kinds: Uint16Array; size: [number, number, number]; per: number }>()
  // An edit of finer cells is taken whole or not at all. Each sector of the finest box it reaches is made with it
  // here first, on the page's own core, after the edits already there: if one refuses it (the switch is off, or the
  // sector would hold more blocks or words than it may: the core's scratch.rs `FINE_BLOCKS`, `TREE_WORDS`) it is not
  // made part of the world, and the caller is told. A sector that has refused an edit from elsewhere refuses these too.
  const taken = (edit: Edit) => {
    core.fine_cells(world.options.bricks ? 1 : 0)
    const lo = [0, 1, 2].map((a) => Math.floor(edit.box[a] / 64)), hi = [3, 4, 5].map((a) => Math.floor((edit.box[a] - 1) / 64))
    for (let sz = lo[2]; sz <= hi[2]; sz++) for (let sx = lo[0]; sx <= hi[0]; sx++) {
      const words = stream([...world.reaching(sx, sz), edit]), room = core.edits_room(words.length)
      new Int32Array(core.memory.buffer, room, words.length).set(words)
      for (let sy = lo[1]; sy <= hi[1]; sy++) {
        core.make_sector(sx, sy, sz, 0)
        if (core.fine_refused()) { console.warn(`an edit of finer cells was refused: ${world.options.bricks ? `sector ${sx} ${sy} ${sz} would hold too much` : 'cells hold no finer cells here (bricks=1)'}`); return false }
      }
    }
    change(edit)
    return true
  }
  const fineRest = (grain = 4) => {
    let rows = 0, cells = 0, refused = 0
    for (const [piece, t] of beside) {
      const p = piece as { born: { com: [number, number, number] }; pos: [number, number, number]; rot: [number, number, number, number]; destroy(): void }
      const r = restedRows(t.kinds, t.size, p.born.com, p.pos, p.rot, t.per, grain)
      put()
      // One the world refuses stays as it was, beside the world.
      if (!taken(fineRows(r.runs, r.box, grain))) { refused++; continue }
      p.destroy()
      beside.delete(piece)
      rows += r.runs.length / 5; cells += r.cells
    }
    return { rows, cells, refused }
  }
  // The same thing as cells of the world itself, a quarter or an eighth the size (#259, `?bricks=1`): one edit of rows, known to
  // this page's picture only (the solver, a shared world and other pages are not told). Returns how many rows it was: 0
  // when the world refused it.
  const fineEdit = (cells: string, size: [number, number, number], at: [number, number, number], quarters = 0, grain = 4) => {
    const { runs, box } = rowsOf(new Uint16Array(Uint8Array.from(atob(cells), (c) => c.charCodeAt(0)).buffer), size, at, quarters, grain)
    put()
    return taken(fineRows(runs, box, grain)) ? runs.length / 5 : 0
  }
  Object.assign((globalThis as unknown as { engine: object }).engine, { fine, fineEdit, fineRest, falling, passes, pause: (on: boolean) => { paused = on } })

  // `?living=car`: a car to drive stands in the street ahead of where the page starts, with no console needed.
  if (query.get('living') === 'car') void (async () => {
    if (far) while (!far.live) await new Promise((done) => setTimeout(done, 100))
    // In a shared world one is enough: whoever comes later finds the one that is there.
    if (far && [...made.all.values()].some((t) => t.name === 'car')) return
    const x = Math.round(pose.x * M) + 60, z = Math.round(pose.z * M) + 4
    await alive.spawn(car([x, core.ground_at(x, z) + 5, z]))
  })()
  // Realms (#264), on a line of their own.
  Object.assign((globalThis as unknown as { engine: object }).engine, { realms: realm, pieces: () => moving.size, look: () => ({ hour, rain: march.rain, ...realmLook }) })
  // Living things, on a line of their own: every lane adds to the line above.
  Object.assign((globalThis as unknown as { engine: object }).engine, { alive, car, me, tempo, shots: streaks })
  // The portal (#264, portal.ts), an experiment: a second world like this one, marched into a window.
  // Made last, and the page goes on without it if it cannot be: nothing else waits on it.
  const gate = far && realm ? await portal({
    gpu, far, realms: realm, world, march, pose, began,
    make: () => new World(device, { ...world.options, workers: Number(query.get('portalworkers') ?? world.options.workers) }),
    marcher: (w) => marcher(device, gpu.format, w, true),
    people: (m) => people(device, gpu.format, m),
    residents: (look, taken) => query.get('people') === '0' ? () => [] : townsfolk(core, () => look()?.hour ?? 11, () => look()?.rain ?? 0, () => folkClock.now(), [], taken),
    light: (m, l) => { const s = sunOf(l?.hour !== undefined ? l.hour : ownLook.hour); m.light(s.sun, s.day, s.low) },
    pause: (on) => { paused = on },
    feet: () => me.feet,
    riding: (to) => { if (to) me.view = to; return me.view },
    kind: (x, y, z) => core.world_kind(x, y, z),
    ground: (x, z) => core.feet_at(x, z),
    notice: (text) => over.notice(text, 5000),
  }).catch((e: unknown) => { console.warn(`no portal: ${e instanceof Error ? e.message : String(e)}`); return null }) : null
  // P opens a window to the selected realm (from a realm: to home) and closes it; on a phone, a button.
  if (gate) {
    controls.always('KeyP', () => { void gate.toggle(); return true })
    const buttons = over.panel('realms')
    buttons.style.cssText = 'position:absolute;right:16px;top:64px;display:flex;flex-direction:column;gap:10px;pointer-events:auto'
    const button = document.createElement('button')
    button.type = 'button'; button.textContent = 'Portal'; button.title = 'Open or close a portal (P)'
    button.style.cssText = 'font:600 14px system-ui;padding:10px 14px;border-radius:999px;border:0;background:rgba(20,22,28,.72);color:#fff'
    button.onclick = () => void gate.toggle()
    // Tab shows the wheel of realms: picking one selects it and opens a window to it; its last entry makes a new realm from words.
    const ring = wheel({
      hud: over, input: controls, realms: realm!, canvas,
      lead: (id) => void gate.lead(id),
      create: beginRealm,
    })
    // Stepping in leaves the person free to walk: the line they typed the realm on is put away.
    enterRealm = (id) => { over.line.hide(); realm!.selected = id; void gate.lead(id) }
    controls.always('Tab', (e) => { e.preventDefault(); void ring.toggle(); return true })
    const realmsButton = button.cloneNode() as HTMLButtonElement
    realmsButton.textContent = 'Realms'; realmsButton.title = 'Pick or make a realm (Tab)'
    realmsButton.onclick = () => void ring.toggle()
    // Shown on a desktop too, small in the corner: they say that there are keys for these.
    buttons.append(button, realmsButton)
    Object.assign((globalThis as unknown as { engine: object }).engine, { wheel: ring, enterRealm: (id: string) => enterRealm(id) })
  }
  portalDraw = gate ? (encoder, to, v, time) => { gate.walk(); gate.draw(encoder, to, v, flags, time) } : null
  Object.assign((globalThis as unknown as { engine: object }).engine, { portal: gate })

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
