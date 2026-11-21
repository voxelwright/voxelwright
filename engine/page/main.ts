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
import { COUNT, FLAT, HEAT, MIRRORS, PICK, SHADOWS, marcher, materials, palette, type View } from './march.ts'
import { crumbs } from './crumbs.ts'
import { flowing } from './water.ts'
import { space } from './space.ts'
import { link } from './link.ts'
import { realms, type Pose } from './realms.ts'
import { portal } from './portal.ts'
import { wheel } from './wheel.ts'
import { car, fineCar, living, type Making } from './living.ts'
import { person } from './person.ts'
import { shots } from './shots.ts'
import { puffs } from './puffs.ts'
import { ball, fineRows, rows, stream, type Edit } from './edits.ts'
import { people, townsfolk, type Person } from './people.ts'
import { street as streetOf, type Street } from './street.ts'
import { NAMED } from './moves.ts'
import { pieces, type Piece } from './pieces.ts'
import { under } from './under.ts'
import { restedRows, rowsOf, thing } from './fine.ts'
import { presence, seedOf } from './presence.ts'
import type { Shock } from './residents.ts'
import type { Answer, Ask } from './mover.ts'
import { read } from './told.ts'
import { wand, type Target as Aim } from './wand.ts'
import { hands } from './hands.ts'
import { before as beforeEye, block, inHand as carried } from './held.ts'
import { passes as pluginPasses, plugins } from './plugins.ts'
import { workshop } from './workshop.ts'
import { LIBRARY, caster, known, type Spell } from './spells.ts'
import { World } from './world.ts'
import { far as farOf } from './far.ts'
import { fog } from './fog.ts'
import { BAY, DEVICE, HOLD, names as streets, ON as BAY_ON, START as BAY_START, STREAM, end, memory, near, open, share, silent, tally, underfoot, water as seaAsked, where, whereabouts } from './bay.ts'
import { flight } from './flight.ts'
import { input } from './input.ts'
import { hud } from './hud.ts'
import { things } from './things.ts'
import { asker } from './ask.ts'
import { LOCAL, RULES } from './local.ts'
import { realmControls } from './realm-ui.ts'
import { making } from './making.ts'
import { kept } from './kept.ts'
import { boards } from './boards.ts'
import { firstView } from './first.ts'
import { tell } from './host.ts'
import { signs } from './signs.ts'
import { gather } from './gather.ts'
import { cadence, describe, environment, reporter } from '../probe/tell.ts'
import { sound } from './sound/sound.ts'
import { hearing } from './sound/world.ts'

const query = new URLSearchParams(location.search)
const numbers = (name: string, fallback: number[]) => query.get(name)?.split(',').map(Number) ?? fallback
const canvas = document.querySelector('canvas')!
// One device class for the whole page (bay.ts `DEVICE`): what it draws and what it holds.
const phone = DEVICE === 'phone'
/** Keys, pointer and touch (input.ts), and what is shown over the picture (hud.ts): the one owner of each. */
const controls = input(canvas, { phone, useButton: document.querySelector('#boom') })
const over = hud(controls)

/** Cells in a metre. */
const M = 10
/** `?fine=1` or `2` (#259, an experiment): the world's finest cells are 5 or 2.5 cm, in one or two more boxes round the eye that hold the core's cells written out finer. Only the march knows: nothing else drawn or done is scaled. */
const FINE = 1 << Number(query.get('fine') ?? 0)
const { report, post: send } = reporter('city-4')
/** A realm this page runs alone (local.ts) has no page server to send what was measured to. */
const post: typeof send = LOCAL ? async () => false : send
if (query.get('status') === '1') document.body.classList.add('status')
const flying = !LOCAL && (query.get('fly') ?? (location.pathname === '/' ? '1' : '0')) === '1'

async function main() {
  report.env = environment()
  const gpu = await openGpu()
  const { device } = gpu
  report.env.gpu = await describe(gpu)
  report.faults = gpu.faults
  const context = canvas.getContext('webgpu')!
  context.configure({ device, format: gpu.format, alphaMode: 'opaque' })

  type Core = { memory: WebAssembly.Memory; ground_at(x: number, z: number): number; top_at(x: number, z: number): number; feet_at(x: number, z: number): number; world_edit(after: number): void; world_forget(): void; paving_at(x: number, z: number): number; world_kind(x: number, y: number, z: number): number; edits_room(words: number): number; merge_rows(lod: number, x0: number, x1: number, z0: number, z1: number): number; merged_words(): number; fine_cells(on: number): void; fine_refused(): number; make_sector(sx: number, sy: number, sz: number, lod: number): number }
  // The page's own core, behind a handle that stays the same when the core is built again and swapped in (#264,
  // `recore` below): whoever was handed `core`, or one of its functions, goes on using the one that is in.
  let inner = await open<Core>(new URL('./core.wasm', import.meta.url).href)
  const core = Object.defineProperties({}, Object.fromEntries(Object.keys(inner).map((k) => [k, typeof (inner as never)[k] === 'function' ? { value: (...a: number[]) => (inner as unknown as Record<string, (...a: number[]) => number>)[k](...a) } : { get: () => (inner as never)[k] }]))) as Core
  const room = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
  const poolMb = Math.min(Number(query.get('pool') ?? (phone ? 128 : 256)), Math.floor(room / (1 << 20)))
  const grid = numbers('grid', phone ? [8, 8, 8] : [16, 8, 16]) as [number, number, number]
  /** Edits, one after another, as one edit of rows a column of sectors reads the same after their balls and blasts (the core's `merge_rows`). */
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
    surveyedWalls: BAY_ON,
    grid,
    levels: Number(query.get('levels') ?? (phone ? 8 : 9) + Number(query.get('fine') ?? 0)),
    poolWords: (poolMb << 20) / 4,
    fine: Number(query.get('fine') ?? 0),
    // Cells may hold finer cells (#259): a made thing may be of cells of 2.5 or 1.25 cm (#372). `?bricks=1` from the
    // start, `?bricks=0` never; otherwise from the moment this world first holds such a thing, so that a world
    // without one pays nothing (world.ts `bricksLater`).
    bricks: query.get('bricks') === '1' || (BAY_ON && query.get('bricks') !== '0'),
    fineSun: query.get('bricks') === '1' && query.get('finesun') !== '0',
    // Shadows at the thing's own grain are dear where a fine thing fills the view (#372: 47% of the frame against 30% without, a car 5 m off and a house front), so they are for `?finesun=1`; without, a fine thing shades as its cells of 10 cm.
    bricksLater: !BAY_ON && query.get('bricks') === null ? { fineSun: query.get('finesun') === '1' } : undefined,
    // Each maker holds its own core and the tiles round what it makes (bay.ts `HOLD`): a phone has two (#450).
    workers: Number(query.get('workers') ?? (phone ? 2 : Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 2)))),
  })
  const march = await marcher(device, gpu.format, world)
  // A world that comes to hold finer cells is drawn by a shader that looks into them: made again behind the frames, the old one drawing until it is ready.
  world.onFine = () => { core.fine_cells(1); void march.reshade((wgsl) => wgsl) }
  const blit = await glow(gpu)
  const debris = await crumbs(device, gpu.format)
  const smoke = await puffs(device, gpu.format)
  const water = await flowing(device, gpu.format)
  const planet = await space(device, gpu.format)
  /** From this high (metres) the planet is drawn in place of the boxes of cells. The widest box is 13 km tall with the
   * eye at its middle, so the ground is out of it when the eye is 6.5 km up: from 8 km there was a blue square in haze. */
  const SPACE = 6_000
  const falling = await pieces(device, gpu.format, march)
  // The far model (#450, far.ts): the city past the cells' reach as faces, where the realm has one (its record's
  // `far`, a folder beside the page) or the address names one (`?far=/path/`).
  // The far model: a realm's pinned release holds it where it has one (bay.ts `where`), else beside the page.
  const released = LOCAL?.release ? await where().catch(() => null) : null
  const farModel = await farOf(device, gpu.format, march, query.get('far') ?? (released?.far ? released.manifest : LOCAL?.far ? new URL(LOCAL.far, location.href).href : null))
  // The marine layer (#450, fog.ts): `?fog=0.8`, or `engine.fog`.
  const marine = await fog(device, gpu.format, march)
  // The shade under each living thing (#245, under.ts): pieces cast nothing into the sun's maps.
  const shade = await under(device, gpu.format)
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
  // In the Bay (#373, `?bay=1`): in Washington Square, looking at Telegraph Hill.
  // A realm run alone (local.ts) says where one arrives: the eye there, in the world's cells, and how it faces in radians.
  const arrive = !query.has('at') && LOCAL?.arrive?.at.length === 3 ? LOCAL.arrive : null
  let startX = arrive ? arrive.at[0] : BAY_START ? BAY_START[0] : BAY_ON ? 519_500 : 700, startZ = arrive ? arrive.at[2]! : BAY_START ? BAY_START[1] : BAY_ON ? 661_150 : 4070
  // Where the Bay comes in tiles, the ones round the start and round where the page was told to stand come first.
  // Before the first picture only the finest round the start (#450): what is asked of the ground there, first on the
  // line. The coarser ones come after; the makers of sectors ask for what they need themselves.
  if (STREAM) { const there = query.get('at')?.split(',').map(Number); await underfoot(inner, startX, startZ); void near(inner, startX, startZ); if (there?.length === 3) await near(inner, Math.round(there[0] * M), Math.round(there[2] * M)) }
  while (!BAY_ON && core.ground_at(startX, startZ) < 120 && startX < 400_000) startX += 1280
  // A place given by latitude and longitude may be a roof: the eye starts over what stands there, not inside it.
  const at = arrive ? arrive.at.map((c) => c / M) : numbers('at', [startX / M, Math.max(core.ground_at(startX, startZ), BAY_START ? core.feet_at(startX, startZ) : 0) / M + 12, startZ / M])
  const look = arrive && !query.has('look') ? [(arrive.yaw * 180) / Math.PI, (arrive.pitch * 180) / Math.PI] : numbers('look', BAY_ON ? [64, 4] : [20, -8])
  /** The eye's angle from top to bottom, degrees. */
  let fov = Number(query.get('fov') ?? LOCAL?.fov ?? 70)
  /** How far the picture is turned about the look, clockwise as the eye sees, radians: a photograph's camera has it (#423). */
  const roll = (Number(query.get('roll') ?? LOCAL?.roll ?? 0) * Math.PI) / 180
  const pose: { x: number; y: number; z: number; yaw: number; pitch: number; tilt?: [number, number, number, number] } = { x: at[0], y: at[1], z: at[2], yaw: (look[0] * Math.PI) / 180, pitch: (look[1] * Math.PI) / 180 }
  const street = { x: startX / M, y: core.ground_at(startX, startZ) / M, z: startZ / M }
  let speed = 12
  // A realm the page runs alone opens on its picture (#450, first.ts): its controls come when the visitor engages.
  const first = LOCAL ? firstView(canvas, query.get('first') !== '0' && query.get('boards') !== 'edit') : null
  if (BAY_ON) void whereabouts(() => [Math.round(pose.x * M), Math.round(pose.z * M)], farModel.listing?.credit ? [farModel.listing.credit] : [], first ? (credits) => first.credits(credits) : undefined)

  // ── Moving ──────────────────────────────────────────────────────────────
  // The page's own mode, under any a lane adds (input.ts): the keys and the look move the eye, a click uses the
  // tool picked. `own.keys` and `own.use` are filled in below, where the things they do are made.
  const own = { use: (): boolean | void => {}, keys: new Map<string, () => void>() }
  controls.push({ name: 'moving', use: () => own.use(), key: (code) => { const act = own.keys.get(code); act?.(); return !!act }, wheel: (deltaY) => { speed = Math.max(1, Math.min(400, speed * (deltaY < 0 ? 1.25 : 0.8))); return true } })

  const view = (): View => {
    const cp = Math.cos(pose.pitch), forward = [Math.sin(pose.yaw) * cp, Math.sin(pose.pitch), -Math.cos(pose.yaw) * cp] as const
    const level = [Math.cos(pose.yaw), 0, Math.sin(pose.yaw)] as const
    const plumb = [level[1] * forward[2] - level[2] * forward[1], level[2] * forward[0] - level[0] * forward[2], level[0] * forward[1] - level[1] * forward[0]] as const
    const cr = Math.cos(roll), sr = Math.sin(roll)
    const right = roll ? ([level[0] * cr + plumb[0] * sr, level[1] * cr + plumb[1] * sr, level[2] * cr + plumb[2] * sr] as const) : level
    const up = roll ? ([plumb[0] * cr - level[0] * sr, plumb[1] * cr - level[1] * sr, plumb[2] * cr - level[2] * sr] as const) : plumb
    // Someone whose down is not the world's (person.ts): the eye's whole frame is turned with them.
    if (pose.tilt) { const q = pose.tilt, t = (v: readonly number[]) => { const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)] as const }; return { eye: [pose.x * M * FINE, pose.y * M * FINE, pose.z * M * FINE], forward: t(forward), right: t(right), up: t(up), tanHalf: Math.tan((fov * Math.PI) / 360) } }
    // Under the sea: under its top, where the ground by itself lies under it too (not in a pit dug on land).
    march.under = pose.y < 0 && core.ground_at(Math.round(pose.x * M), Math.round(pose.z * M)) < -1
    return { eye: [pose.x * M * FINE, pose.y * M * FINE, pose.z * M * FINE], forward, right, up, tanHalf: Math.tan((fov * Math.PI) / 360) }
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
  // How many frames came well late just now.
  let lateRun = 0
  const steer = (budget: number, gap: number) => {
    // Pinned by whoever measures (`engine.scale`): not even a late frame moves it.
    if (fixed || held > 1e6) return
    // A look turned from a cheap view to a dear one (#367): the march is suddenly several frames long, and coming down
    // 15% every 45 frames the picture took three seconds to fit again (60 frames dropped in one turn of the head, with
    // the march at 50 ms). Two late frames close together with the GPU's clock saying why bring it down at once to what fits.
    // (Late frames close together, not only in a row: with a window come into view at once one frame in five was
    // late for a second, never two running. Each late frame counts one and fades by a seventh a frame.)
    lateRun = lateRun * 0.85 + (gap > budget * 1.4 ? 1 : 0)
    if (lateRun >= 1.4 && clocked && marchMs > budget && scale > 0.3) {
      const fits = Math.round(Math.max(0.3, Math.min(scale - 0.05, scale * Math.sqrt((0.6 * budget) / marchMs))) * 20) / 20
      scale = fits; held = 20; lateRun = 0
      return
    }
    if (--held > 0) return
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
  // Who stands in the world for the residents to go round (#371): said once the person's own body and the others are there.
  let inTheWay: () => readonly (readonly [number, number, number])[] = () => []
  // The town's residents (#218): by rule from place and from the clock every page of a world shares. `?people=0` leaves them out.
  const folkClock = { now: () => Date.now() / 1000 }
  const shocks: Shock[] = []
  /** Where the cutter cut (street life closes the roads it broke, as a blast's). */
  const cuts: { at: [number, number, number]; radius: number }[] = []
  /** Residents a rule of the world has taken as its actors: the town's rule leaves them out (presence.ts). */
  const takenOff = new Set<number>()
  // A realm with street life (#450, street.ts) has its own people, on its own pavements: made below, once there are living things to get into.
  let streetLife: Street | null = null
  const lively = !!LOCAL?.street && query.get('street') !== '0'
  if (query.get('people') !== '0' && !LOCAL?.street) folk.from.push(townsfolk(core, () => (worldHour ? worldHour() : hour ?? 11), () => march.rain, () => folkClock.now(), shocks, takenOff, () => inTheWay()))
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
  let portalDraw: ((encoder: GPUCommandEncoder, to: Offscreen, v: View, time: number, timing?: GPURenderPassTimestampWrites) => boolean) | null = null
  /** The passes the engine's plugins add to a frame (plugins.ts). */
  const pluginDraws = pluginPasses()
  const setHour = (h: number | null) => {
    hour = h === null ? null : ((h % 24) + 24) % 24
    const { sun, day, low } = sunOf(hour)
    march.light(sun, day, low)
    // Full day is 1, dusk and night 0.
    const noon = day * (1 - low)
    grade = [1.25 - 0.2 * noon, 0.35 - 0.1 * noon]
    smoke.light(sun, day)
    debris.light(sun, day)
    water.light(sun, day)
  }
  // A local realm's own air (#450): its haze, cloud and sky, and the sun and grade of the afternoon it is seen in, until an hour is set.
  /** The realm's own light (#450): the sun and grade of the afternoon it is seen in, the hour unset (the eggs give it back, eggs.ts). */
  const ownLight = () => {
    if (!LOCAL?.air?.sun) return setHour(null)
    hour = null
    const sun = LOCAL.air.sun
    march.light(sun, 1, 0); smoke.light(sun, 1); debris.light(sun, 1); water.light(sun, 1)
    if (LOCAL.air.grade) grade = LOCAL.air.grade
  }
  if (LOCAL?.air) {
    march.air = { haze: Number(query.get('haze') ?? LOCAL.air.haze ?? 1), clouds: Number(query.get('clouds') ?? LOCAL.air.clouds ?? 1), sky: LOCAL.air.sky }
    if (LOCAL.air.sun && !query.has('hour') && LOCAL.look?.hour === undefined) ownLight()
  }
  if (query.has('hour')) setHour(Number(query.get('hour')))
  else if (LOCAL?.look?.hour !== undefined) setHour(LOCAL.look.hour)
  // `?rain=1` or the R key: rain.
  march.rain = Number(query.get('rain') ?? LOCAL?.look?.rain ?? 0)
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

  // The GPU's own time for the march, where the device can say: the page's own march, and the march of the world
  // seen through an open window (#367). The picture's size is steered by their sum: by the page's own alone, a window
  // open cost a second march the steer knew nothing of, and the page ran at 30 frames a second beside it.
  const clock = gpu.canTime ? {
    set: device.createQuerySet({ type: 'timestamp', count: 4 }),
    resolved: device.createBuffer({ size: 32, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
    read: device.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
    busy: false,
  } : null
  let gpuMs = 0, marchMs = 0, windowMs = 0, frameMs = 16.7, last = performance.now(), frames = 0, started = last
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
  /** The same parts for the frame now being drawn, or the last one drawn, each as it was and not smoothed: one long frame shows here and hardly at all in `spent` (#367). */
  const laps: Record<string, number> = {}
  const lap = (name: string) => { const t = performance.now(); laps[name] = t - mark; spent[name] = (spent[name] ?? 0) * 0.95 + (t - mark) * 0.05; mark = t }
  // How far one is in a room (#163), for the daylight a room is lit by (march.ts shade): something over one's head within
  // 8 m, something standing within 8 m on three of its four sides, and a metre each way either a wall or more cover.
  // Leaves and water are not counted. The last test is what keeps an awning out: under one on the pavement the
  // metre towards the street is open (swept over the start street at 1.5 to 2.5 m: none of the open air counted).
  // Eased over a quarter of a second or so, as eyes take to a room; 0 or 1 once settled.
  let roomed = 0
  const stands = (x: number, y: number, z: number) => { const k = core.world_kind(x, y, z) & 15; return k !== 0 && k !== 5 && k !== 13 }
  const covered = (x: number, y: number, z: number) => { for (let k = 1; k <= 80; k++) if (stands(x, y + k, z)) return true; return false }
  const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  const inRoom = (): boolean => {
    // Asked at one's own head when afoot: the eye behind it is often still in the doorway.
    const f = me.feet, x = Math.floor(f ? f.at[0] : pose.x * M), y = Math.floor(f ? f.at[1] + 16.5 : pose.y * M), z = Math.floor(f ? f.at[2] : pose.z * M)
    if (!covered(x, y, z)) return false
    // A side stands if a wall is met along it, straight out or a metre to either hand: so a doorway and a window
    // across from it in line with one do not open the room.
    const side = (dx: number, dz: number) => { for (const o of [0, 10, -10]) for (let k = 1; k <= 80; k++) if (stands(x + dx * k - dz * o, y, z + dz * k + dx * o)) return true; return false }
    let sides = 0
    for (const [dx, dz] of SIDES) if (side(dx, dz)) sides++
    if (sides < 3) return false
    for (const [dx, dz] of SIDES) {
      let k = 1
      while (k <= 10 && !stands(x + dx * k, y, z + dz * k)) k++
      if (k > 10 && !covered(x + dx * 10, y, z + dz * 10)) return false
    }
    return true
  }
  const roomedBy = (dt: number) => {
    const to = pose.y < SPACE && inRoom() ? 1 : 0
    roomed += (to - roomed) * Math.min(1, dt * 4)
    if (Math.abs(to - roomed) < 0.01) roomed = to
    return roomed
  }
  const frame = (now: number) => {
    const began = mark = performance.now()
    const dt = Math.min(0.1, (now - last) / 1000)
    const gap = now - last
    for (const each of watchers) each(gap)
    if (paused) { last = now; requestAnimationFrame(frame); return }
    frameMs += ((now - last) - frameMs) * 0.05
    shortest = Math.min(shortest, now - last)
    if (frames % 120 === 119) { screenMs = Math.max(4, shortest); shortest = Infinity }
    last = now
    // Riding a thing, the eye goes where it goes; otherwise where the keys take it.
    if (!alive.frame(dt) && !me.frame(dt)) walk(dt)
    steer(Math.max(1000 / 60, screenMs), gap)
    const v = view(), to = fit()
    march.roofed = roomedBy(dt)
    staff.frame(v)
    ears?.frame(v.eye, pose.yaw, dt)
    magic.step(dt)
    grip.frame()
    ownHold(v)
    lap('steer')
    fallOn(dt)
    lap('fallOn')
    streetLife?.frame(dt, v)
    lap('street')
    world.update(v.eye)
    lap('update')
    if (spoiled.length && !off.has('spoil') && world.stats.stale === 0 && world.stats.wanted === 0) { for (const edit of spoiled) march.sun.spoil(edit); spoiled.length = 0 }
    lap('spoil')
    const encoder = device.createCommandEncoder()
    const timed = clock && !clock.busy
    // Whether a window's world was marched this frame: a query nothing wrote keeps what it last read, so the window's
    // time is counted only then (counted always, a window long closed went on costing the picture its size).
    let windowed = false
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
      windowed = portalDraw?.(encoder, to, v, (now - started) / 1000, timed ? { querySet: clock.set, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 } : undefined) === true
      farModel.draw(encoder, to, v)
      marine.draw(encoder, to, farModel.depth, v, (now - started) / 1000)
      if (!off.has('water')) water.draw(encoder, to, v, (now - started) / 1000)
      if (!off.has('under') && alive.things.length) shade.draw(encoder, to, v, shades(), groundUnder, march.day, march.sun.s)
      if (!off.has('pieces')) falling.draw(encoder, to, v, march.sun.s, undefined, (flags & MIRRORS) !== 0)
      if (!off.has('people')) folk.draw(encoder, to, v, (now - started) / 1000)
      if (!off.has('crumbs')) debris.draw(encoder, to, v)
      if (!off.has('puffs')) smoke.draw(encoder, to, v)
      // What the engine's plugins draw (plugins.ts `passes`): after the world and whoever is in it, before the wand's marker.
      pluginDraws.draw(encoder, to, v, (now - started) / 1000)
      staff.draw(encoder, to, v, (now - started) / 1000)
    }
    blit(encoder, to, context.getCurrentTexture().createView(), march.under || pose.y > SPACE ? 0 : march.rain * (0.35 + 0.65 * march.day), (now - started) / 1000, march.under ? [1.25, 0.35] : realmLook.grade ?? grade, march.under || pose.y > SPACE ? 0 : 1 - march.day, realmLook.tint)
    if (timed) { encoder.resolveQuerySet(clock.set, 0, 4, clock.resolved, 0); encoder.copyBufferToBuffer(clock.resolved, 0, clock.read, 0, 32) }
    device.queue.submit([encoder.finish()])
    lap('draw')
    over.frame(project)
    if (timed) {
      clock.busy = true
      void clock.read.mapAsync(GPUMapMode.READ).then(() => {
        const [a, b, c, d] = new BigUint64Array(clock.read.getMappedRange().slice(0))
        clock.read.unmap()
        clock.busy = false
        const through = windowed && d > c ? Number(d - c) / 1e6 : 0
        windowMs += (through - windowMs) * 0.1
        // (The last one as it was is kept beside the smoothed: late frames are answered by what the march took just now.)
        // Both marches as one stretch of the GPU's time, from where the page's own began to where the window's ended: added
        // up, the two overlapped and were counted for more than they took.
        if (b > a) { marchMs = windowed && d > a ? Number(d - a) / 1e6 : Number(b - a) / 1e6; gpuMs += (marchMs - gpuMs) * 0.1 }
      })
    }
    if (++frames % 15 === 0) {
      const s = world.stats
      over.status(`${saying ? `${saying} · ` : ''}${(1000 / frameMs).toFixed(0)} fps · march ${gpuMs.toFixed(1)} ms at ${to.size[0]} x ${to.size[1]} · ${s.wanted ? `making ${s.wanted} sectors` : 'world made'} · ${(s.poolUsed / 262144).toFixed(0)} of ${(s.poolWords / 262144).toFixed(0)} MB${s.full ? ` · ${s.full} did not fit` : ''} · ${pose.x.toFixed(0)}, ${pose.y.toFixed(0)}, ${pose.z.toFixed(0)} m · ${speed.toFixed(0)} m/s`)
    }
    // For whoever measures (test/sf.mjs): the first picture handed to the GPU, and the first with every box of the world made.
    if (!seen.first) seen.first = performance.now()
    // The picture with the place in it (as player/stage.ts counts it): every box whole across its middle half.
    // And the far model's share of it (far.ts `ready`): at the landing, the faces seen from there of every far tile in the
    // view, so that the skyline is in the first picture; only then does the far model fetch the rest.
    if (!seen.near && world.stats.stale === 0 && world.stats.made > 0 && (farModel.ready || pose.y > SPACE) && world.levels.every((l) => l.whole.high.every((h, a) => h - l.whole.low[a] >= l.grid[a] / 2))) { seen.near = performance.now(); farModel.shown() }
    if (!seen.whole && world.stats.wanted === 0 && world.stats.stale === 0 && world.stats.made > 0) seen.whole = performance.now()
    cpuMs += (performance.now() - began - cpuMs) * 0.05
    requestAnimationFrame(frame)
  }
  /** When the first picture was drawn and when the world round the eye was first whole: ms since the page was asked for. */
  const seen = { first: 0, near: 0, whole: 0 }
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
  // The worker that moves things, hired again if it fails (#450): it ends without a word when a tab runs out of
  // memory, so one that answers none of the page's pings for a while is taken for gone too (`moverLost`, below).
  const heed: { message: ((e: MessageEvent<Answer>) => void) | null; error: ((e: ErrorEvent) => void) | null } = { message: null, error: null }
  let moverWorker: Worker | null = null, moverLost = () => {}
  /** How long the mover may say nothing, not even to the page's pings (bay.ts `share`), before it is taken for gone, ms. */
  let moverPatience = 10_000
  /** How many times the world was put back (`reset`): an answer about the world before the last is not this world's. */
  let moverAge = 0
  const hireMover = () => {
    const w = share(new Worker(new URL(`./mover.ts${BAY}`, import.meta.url), { type: 'module' }))
    w.onmessage = (e: MessageEvent<Answer>) => heed.message?.(e)
    w.onerror = (e) => { e.preventDefault(); heed.error?.(e); loseMover(w) }
    return w
  }
  const loseMover = (w: Worker | null) => { if (!w || w !== moverWorker) return; w.terminate(); moverWorker = hireMover(); moverLost() }
  if (!far) moverWorker = hireMover()
  const mover: { postMessage(ask: Ask): void; onmessage: ((e: MessageEvent<Answer>) => void) | null; onerror: ((e: ErrorEvent) => void) | null } = far ? (far as never) : {
    postMessage: (ask: Ask) => moverWorker!.postMessage({ ...ask, age: moverAge }),
    get onmessage() { return heed.message }, set onmessage(f) { heed.message = f },
    get onerror() { return heed.error }, set onerror(f) { heed.error = f },
  }
  /** In a shared world: whose ask each answer that is still to come answers, in order (true for this page's own). */
  const asked: boolean[] = []
  // The Bay in tiles (#373): this page's core and the one that moves things hold what is round the eye, asked again as it moves.
  if (STREAM) { const tell = () => { const x = Math.round(pose.x * M), z = Math.round(pose.z * M); void near(inner, x, z); mover.postMessage({ bay: [x, z] } as never) }; tell(); setInterval(tell, 500) }
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
  // This thread's own core is told of every edit too: it is asked what a cell is made of at once, where the mover could
  // only answer a frame on (what is heard underfoot, and the eye behind a person, which must not be in a wall).
  const tellCore = (words: Int32Array) => { new Int32Array(core.memory.buffer, core.edits_room(words.length), words.length).set(words); core.world_edit(-1) }
  /** `farToo` false: the far model keeps the tile (#450, the billboards: laid in every world, they are no reason to draw their whole tiles as cells from far off). */
  const change = (edit: Edit, farToo = true) => { if (!adopted) world.edit(edit); spoiled.push(edit); if (farToo) farModel.edited(edit.box); staff.changed(edit); me.edit(edit.words); tellCore(edit.words) }
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
  const stale = { answers: 0 }
  mover.onmessage = (e: MessageEvent<Answer>) => {
    const answer = e.data, t0 = performance.now()
    // An answer about the world as it was before it was put back: a blast's cells must not come down in the new one.
    if (!far && answer.age !== moverAge) { stale.answers++; return }
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
  // A living thing's look, its faces made once for each part's cells (a car's are 4.8 million cells and half a second
  // to make): a page fetches each part once (living.ts), so a second car of a kind shares them and makes nothing.
  // (By the cells and by their size: the same cells may be a part of another shape.)
  const lookFaces = new WeakMap<Uint16Array, Map<string, ReturnType<typeof thing>>>()
  const alive = living({ body: () => { const f = me.feet; return f ? [f.at[0], f.at[1] + 10, f.at[2]] : null }, kind: (x, y, z) => core.world_kind(x, y, z), send: (ask) => { if (!far) mover.postMessage(ask) }, wake: () => { bodies = Math.max(bodies, 1) }, piece: (id) => moving.get(id), look: (kinds, size) => { let by = lookFaces.get(kinds); if (!by) lookFaces.set(kinds, by = new Map()); let born = by.get(size.join()); if (!born) { born = thing(kinds, size); by.set(size.join(), born) } return falling.add({ ...born, com: [...born.com], low: [...born.low] }) }, input: controls, hud: over, pose, ground: (x, z) => core.ground_at(Math.round(x * M), Math.round(z * M)) / M, world: far, made: () => made, ridden: (on) => { if (on) { wasAfoot = me.on; if (wasAfoot) me.walk(false) } else if (wasAfoot) { wasAfoot = false; me.walk(true) } }, dropped: (id) => moving.delete(id) })
  /** Where under each living thing the ground is darkened (under.ts): its footprint, turned as it is, and how far it is off the ground. */
  const shades = () => alive.things.flatMap((t) => {
    const w = alive.where(t)
    if (!w) return []
    // Its turn about y: where its own x points (the turn's first column).
    const top = groundUnder(w.at[0], w.at[1], w.at[2]), q = w.rot
    return [{ at: w.at, yaw: Math.atan2(-2 * (q[0] * q[2] - q[1] * q[3]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])), half: [t.size[0] / 2, t.size[2] / 2] as const, high: t.size[1], lift: Math.max(0, w.at[1] - t.size[1] / 2 - top) }]
  })
  /** The top of what is under a place, looked for down from `y` (cells): a kerb, a roof, a bridge as well as the ground. */
  const groundUnder = (x: number, y: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z)
    for (let at = Math.floor(y), end = at - 40; at > end; at--) if (core.world_kind(ix, at, iz)) return at + 1
    return core.ground_at(Math.round(x), Math.round(z))
  }
  /** Whether the person was on foot when they got on what they ride: they are set down on foot again. */
  let wasAfoot = false
  /** How many bodies are on their way down: every body but the living, which are bodies for as long as they live. */
  const loose = () => moving.size - alive.things.reduce((n, t) => n + (moving.has(t.id) ? 1 : 0), 0)
  /** Moves what is loose on by `dt` seconds: the worker is asked once a frame, and not again until it has answered. */
  const fallOn = (dt: number) => {
    owed = Math.min(owed + dt, 0.1)
    if (putting.length && (performance.now() - putSince > 180 || bodies === 0)) put()
    if (!far && (bodies > 0 || burning > 0 || running) && !ticking) { ticking = true; mover.postMessage({ tick: owed * tempo.rate } satisfies Ask); owed = 0 }
    if (!far && silent(moverWorker) > moverPatience) loseMover(moverWorker)
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
  const others = far ? presence(far, folk, over, () => { const f = me.feet; return f ? { at: [f.at[0], f.at[1] + 16.5, f.at[2]], yaw: f.yaw, frame: f.frame } : { at: [pose.x * M, pose.y * M, pose.z * M], yaw: pose.yaw } }, takenOff) : null
  // A person's own body (#264, person.ts): B gets down onto the feet and back up to fly; `?walk=1` starts on foot.
  // This page moves it: in the core that moves everything else here, or in a shared world in a core of its own that
  // is told every edit, so that the body walks on the world as it is.
  const shadow = far ? share(new Worker(new URL(`./mover.ts${BAY}`, import.meta.url), { type: 'module' })) : null
  const me = person({ kind: (x, y, z) => core.world_kind(x, y, z), send: (ask) => (shadow ?? mover).postMessage(ask), wake: () => { if (!far) bodies = Math.max(bodies, 1) }, own: !!shadow, input: controls, hud: over, pose, folk, seed: seedOf(others?.name ?? 'me'), name: others?.name })
  // The residents go round this person's own body when it is on its feet, and round everyone else who is here.
  const waysFull: (readonly [number, number, number])[] = []
  inTheWay = () => { waysFull.length = 0; const f = me.feet; if (f) waysFull.push(f.at); if (others) for (const at of others.standing()) waysFull.push(at); return waysFull }
  if (shadow) shadow.onmessage = (e: MessageEvent<Answer>) => { if (!e.data.failed) me.heard(e.data, read(e.data.words)) }
  // Whoever rides from this page is seen in their seat (#367): from behind, the kart went up the street with nobody in it.
  // The page places its own rider each frame where the thing is, so they are not the tenth of a second behind that others see them.
  const seated: Person = { at: [0, 0, 0], yaw: 0, seed: seedOf(others?.name ?? 'me'), move: { move: NAMED.sit, t: 10 } }
  folk.from.push((_view, seconds) => { const r = alive.rider; if (!r || alive.inside) return []; /* With the eye brought right in over them (a wall behind), their own figure is not drawn in its way: as on foot. */ if (Math.hypot(pose.x * M - r.at[0], pose.y * M - r.at[1] - 12, pose.z * M - r.at[2]) < 9) return []; seated.at = r.at; seated.yaw = r.yaw; seated.time = seconds; seated.look = me.carry ? { ...(me.limbs.look ?? {}), carry: me.carry } : me.limbs.look; return [seated] })
  controls.always('KeyB', () => { me.walk(!me.on); return true })
  // What a rule says this person's body can do, and how fast the world goes (rules/bodies.mjs): the world's clock is
  // everyone's but those a rule spares, who move as they always did while all else slows.
  // A blow on this page's own person (rules/blows.mjs): thrown the way it went, or put on the ground.
  if (far) far.onblow = (b) => { if (b.push) me.push(b.push); if (b.down !== undefined) me.down(b.down) }
  if (far) far.onbodies = (b) => { tempo.rate = b.clock.rate; me.clock = b.clock.spare.includes(far.me) ? 1 : b.clock.rate; me.can = b.can[far.me] ?? {}; me.limbs = b.figure?.[far.me] ?? {}; const to = b.seat?.[far.me] ?? null; if (to !== seatedOn) { seatedOn = to; const thing = to ? alive.things.find((t) => t.ref === to) : null; if (thing) alive.mount(thing); else if (alive.riding) alive.mount(null) } }
  /** The living thing a rule has seated this page's person on (its record's id), as last told. */
  let seatedOn: string | null = null
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
  over.line.take((ask, dry) => {
    if (ask.picture || ask.link || !/\brealm\b/i.test(ask.wish ?? '') || (ask.wish ?? '').replace(/\b(please|create|make|new|start|open|build|imagine|a|an|the|realm|called|named|me|us)\b/gi, '').replace(/[^\p{L}\p{N}]+/gu, '')) return false
    if (dry) return true
    over.notice('Say what the realm is: a name, a place, what happens there', 6000)
    queueMicrotask(beginRealm)
    return true
  })
  const wish = making(over, wishes, gaze, (id) => enterRealm(id), () => setTimeout(beginRealm, 0))
  /** What is seen at the place meanwhile: the world's loose cells gathering there (gather.ts). */
  const gathering = gather(debris, smoke, wish, made)
  // What is kept, shown as a ghost where it would stand while its words are typed (#220).
  const ghost = kept(over, wishes, falling, wish)
  over.line.starters = ['a market stall with a striped awning', 'a red telephone box', 'a park bench under a lamp', 'a fountain']
  // What the bar says Enter will do is what making will do with the words (making.ts `says`).
  over.line.means = (text) => wish.says(text)
  // A realm whose rules allow no models has no bar to type a wish on (local.ts): spells from the kept library are cast with the wand.
  if (!RULES.models) document.querySelector<HTMLElement>('#ask')?.style.setProperty('display', 'none')
  over.line.onask = (ask) => {
    if (!RULES.models) return over.notice('Nothing is made from words in this realm', 5000)
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
      moving.clear(); lying = []; putting = []; asked.length = 0; shocks.length = 0; cuts.length = 0
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
    cuts.push({ at, radius: reach })
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
  const paced = async (withFlags = flags, withPeople = false, withWand = false, withPieces = false, withPasses = false, withUnder = false) => {
    const to = offscreen(gpu, [canvas.width, canvas.height]), v = view()
    paused = true
    // With the people in sight drawn over it too, if asked: what they cost the GPU is the difference.
    const p = await pace(gpu, to, (encoder, target) => { march.draw(encoder, target, v, withFlags, 0); if (withPeople) folk.draw(encoder, target, v, 0); if (withWand) staff.draw(encoder, target, v, 0); if (withUnder) shade.draw(encoder, target, v, shades(), groundUnder, march.day, march.sun.s); if (withPieces) falling.draw(encoder, target, v, march.sun.s, undefined, (withFlags & MIRRORS) !== 0); if (withPasses) pluginDraws.draw(encoder, target, v, 0) }, 100)
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
      falling.draw(encoder, to, v, march.sun.s, { querySet: set, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 }, (withFlags & MIRRORS) !== 0)
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
  const grip = hands(far, controls, over, () => { const v = view(); return { from: v.eye, to: v.forward } }, made, async () => {
    // The first cell the eye meets: the marcher says how far, and the cell is a little past that along the look.
    const v = view(), hit = await march.pick(v)
    if (!hit) return null
    const cell = v.eye.map((e, a) => Math.floor(e + v.forward[a] * (hit.t + 0.3))) as [number, number, number]
    // How far off it is, is from the person: on foot the eye may be three metres behind them, and what lay at their feet was out of reach (#366).
    const feet = me.on ? me.feet?.at : null
    return { cell, far: feet ? Math.hypot(cell[0] - feet[0], cell[1] - (feet[1] + 10), cell[2] - feet[2]) : hit.t }
  })
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
  over.line.take((ask, dry) => {
    if (!staff.held) return false
    const called = ask.wish && !ask.picture && !ask.link ? known(ask.wish) : null
    if (!called || dry) return !!called
    inHand = called
    casts()
    staff.power = 0
    staff.cast()
    return true
  }, 'Cast')

  // For the checks, and for looking round from the console.
  Object.assign(globalThis, { engine: { world, pose, gpu, input: controls, hud: over, things: made, asker: wishes, ask: wishes.ask, wish, gathering, march, wand: staff, view, feet: (x: number, z: number) => core.feet_at(x, z), /** What the ground's top is made of at a column, by the land's rule (cells). */ top: (x: number, z: number) => core.top_at(Math.round(x), Math.round(z)), /** What a cell is made of as this page has it (0: nothing), for the checks: whether the eye is in something. */ kind: (x: number, y: number, z: number) => core.world_kind(Math.floor(x), Math.floor(y), Math.floor(z)), folk, folkClock, paced, steps, quiet, blast, strike, ignite, shoot, cut, place, set: (at: [number, number, number], radius: number, kind: number) => make(ball(at[0], at[1], at[2], radius, kind), at), pickTool, get tool() { return tools[tool].name }, ground: (x: number, z: number) => core.ground_at(Math.round(x * M), Math.round(z * M)) / M, pick, debris, smoke, get burning() { return burning }, get flowing() { return running }, water, get others() { return others?.count ?? 0 }, say: (text: string) => others?.say(text), shadowsDiffer, fell, get dropping() { return loose() + lying.length + putting.length }, get bodies() { return bodies }, get leaning() { return leaning() }, get hour() { return hour }, set hour(h: number | null) { setHour(h) }, get rain() { return march.rain }, set rain(v: number) { march.rain = v }, get settling() { return waiting > 0 }, /** Whether the page has stopped drawing (#367): set while another page on the same GPU is being timed (test/paired.mjs). */ get resting() { return paused }, set resting(on: boolean) { paused = on }, get gpuMs() { return gpuMs }, get windowMs() { return windowMs }, get cpuMs() { return cpuMs }, off, spent, laps, get frameMs() { return frameMs }, get scale() { return scale }, set scale(v: number) { scale = v; held = 1e9 }, get flags() { return flags }, set flags(v: number) { flags = v } } })
  Object.defineProperty((globalThis as unknown as { engine: object }).engine, 'ears', { get: () => ears })
  Object.assign((globalThis as unknown as { engine: object }).engine, { kept: ghost })
  // A voice for what people say (#264: being tried, off unless asked for): others' words, not this page's own.
  if (far && query.has('voices')) { const shown = far.onsaid; far.onsaid = (v) => { shown?.(v); if (v.by !== far.me) ears?.spoke(v, query.get('voices')) } }
  // The core built again and taken while the page runs (#264): this thread's own, then the workers', and every
  // sector is made again behind the picture. A person on foot is taken up, the core their body walks in (`shadow`)
  // takes the new build and is told the world's edits again, and they are set down where they stood, keys held
  // still held. Answers how long this thread's part took. Not carried across, alone: whatever is loose (the mover's core).
  const recore = async (url: string) => {
    const began = performance.now()
    inner = await open<Core>(url)
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
  if (RULES.models) Object.assign((globalThis as unknown as { engine: object }).engine, { workshop: workshop(over, wishes) })
  // The engine's plugins (#264, plugins.ts): page sides the world says to have, imported as it says so; and what they draw with.
  Object.assign((globalThis as unknown as { engine: object }).engine, { draws: pluginDraws })
  if (far) Object.assign((globalThis as unknown as { engine: object }).engine, { plugins: plugins(far) })
  // People (#218): which residents a rule of the world has taken off their rounds.
  Object.assign((globalThis as unknown as { engine: object }).engine, { takenOff })
  // The wand's spells, on a line of their own (#246).
  Object.assign((globalThis as unknown as { engine: object }).engine, { hands: grip, magic, spell: (words: string, target: Aim | null = staff.target) => { const s = known(words); return s ? spell(s, target) : 'not a known spell' } })

  // What this page's person holds, as they see it themselves (#246, held.ts). With a figure of their own in view
  // (the eye behind), the figure carries it as everyone's does. With the eye in the head, or flying as an eye with
  // no body, the thing itself is drawn before the eye: low and to the right, pointing where they look.
  let inView: { id: string; piece: Piece; size: [number, number, number]; grain: number } | null = null
  const ownHold = (v: View) => {
    const h = grip.holding
    if (h?.id !== inView?.id || (h && !me.carry)) {
      inView?.piece.destroy()
      inView = null
      // A thing of finer cells (#372) is carried and seen at its own grain.
      me.carry = h ? carried(h.cells, h.grain ?? 1) : undefined
      if (h) { const b = block(h.cells), born = thing(b.kinds, b.size); born.com = [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2]; inView = { id: h.id, piece: falling.add(born), size: b.size, grain: h.grain ?? 1 } }
    }
    if (!inView) return
    // Behind one's own figure it is in the figure's hand: the thing before the eye is put out of sight (no cell of it has any size).
    const own = me.feet !== null && me.view === 'behind'
    Object.assign(inView.piece, own ? { cell: 0 } : beforeEye(v, inView.size, inView.grain))
  }
  Object.assign((globalThis as unknown as { engine: object }).engine, { held: { get shown() { return inView && inView.piece.cell > 0 ? { id: inView.id, pos: inView.piece.pos, rot: inView.piece.rot, cell: inView.piece.cell } : null } } })

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
  /**
   * The far model (#450) as measured: each pixel's building over the whole picture at `size`, four bytes a pixel, rows
   * from the top. A face of the far model gives its building's number (three bytes) and which way it looks (the fourth,
   * 1 to 5); a cell the march met gives number 1 and way 6; sky and sea give nothing (all four 0).
   */
  const farIds = async (size: [number, number]) => {
    const v = view(), to = offscreen(gpu, size), row = Math.ceil((size[0] * 4) / 256) * 256
    const read = [0, 1].map(() => device.createBuffer({ size: row * size[1], usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }))
    paused = true
    const encoder = device.createCommandEncoder()
    march.draw(encoder, to, v, PICK, 0)
    encoder.copyTextureToBuffer({ texture: to.texture }, { buffer: read[0], bytesPerRow: row }, size)
    farModel.drawIds(encoder, to.color, to.depth, size, v)
    encoder.copyTextureToBuffer({ texture: to.texture }, { buffer: read[1], bytesPerRow: row }, size)
    device.queue.submit([encoder.finish()])
    await Promise.all(read.map((r) => r.mapAsync(GPUMapMode.READ)))
    const [cells, faces] = read.map((r) => new Uint8Array(r.getMappedRange().slice(0)))
    read.forEach((r) => { r.unmap(); r.destroy() }); to.destroy()
    paused = false
    const blue = gpu.format.startsWith('bgra'), out = new Uint8Array(size[0] * size[1] * 4)
    for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
      const i = y * row + x * 4, o = (y * size[0] + x) * 4
      if (faces[i] | faces[i + 1] | faces[i + 2] | faces[i + 3]) { out[o] = faces[blue ? i + 2 : i]; out[o + 1] = faces[i + 1]; out[o + 2] = faces[blue ? i : i + 2]; out[o + 3] = faces[i + 3] }
      else if (cells[i] | cells[i + 1] | cells[i + 2] | cells[i + 3]) { out[o] = 1; out[o + 3] = 6 }
    }
    return out
  }
  /**
   * What the far model costs the GPU here, at the canvas's full size and the device's own pace: the march alone and
   * the march with the far model, turn about, the middle of `rounds` each, ms a frame (a pass's own clock says the
   * march's time on this GPU, not the pass's: #423).
   */
  const farPasses = async (rounds = 5) => {
    const to = offscreen(gpu, [canvas.width, canvas.height]), v = view(), alone: number[] = [], both: number[] = [], fogged: number[] = []
    paused = true
    for (let i = 0; i < rounds; i++) {
      alone.push((await pace(gpu, to, (encoder, target) => { march.draw(encoder, target, v, flags, 0) }, 100)).ms)
      both.push((await pace(gpu, to, (encoder, target) => { march.draw(encoder, target, v, flags, 0); farModel.draw(encoder, target, v) }, 100)).ms)
      // And the marine layer over both, where it is on (fog.ts).
      if (marine.strength > 0) fogged.push((await pace(gpu, to, (encoder, target) => { march.draw(encoder, target, v, flags, 0); farModel.draw(encoder, target, v); marine.draw(encoder, target, farModel.depth, v, 0) }, 100)).ms)
    }
    paused = false
    to.destroy()
    const middle = (xs: number[]) => [...xs].sort((x, y) => x - y)[xs.length >> 1]
    return { march: middle(alone), withFar: middle(both), withFog: fogged.length ? middle(fogged) : null, size: [canvas.width, canvas.height], ...farModel.stats }
  }
  Object.assign((globalThis as unknown as { engine: object }).engine, { fine, fineEdit, fineRest, falling, passes, far: farModel, farIds, farPasses, pause: (on: boolean) => { paused = on } })
  // How thick the marine layer is, 0 to 1 (fog.ts): a property, as the hour and the rain are.
  Object.defineProperty((globalThis as unknown as { engine: object }).engine, 'fog', { get: () => marine.strength, set: (v: number) => { marine.strength = Math.max(0, Math.min(1, v)) } })

  // `?living=car`: a car to drive stands in the street ahead of where the page starts, with no console needed.
  // `?living=finecar`: the same car wearing a look in cells of 2.5 cm, with seats, a dash and a wheel inside (V from the seat).
  if (query.get('living') === 'car' || query.get('living') === 'finecar') void (async () => {
    if (far) while (!far.live) await new Promise((done) => setTimeout(done, 100))
    // In a shared world one is enough: whoever comes later finds the one that is there.
    if (far && [...made.all.values()].some((t) => t.name === 'car')) return
    const x = Math.round(pose.x * M) + 60, z = Math.round(pose.z * M) + 4
    await alive.spawn((query.get('living') === 'finecar' ? fineCar : car)([x, core.ground_at(x, z) + 5, z]))
  })()
  // ── A realm run alone (#450, local.ts) ─────────────────────────────────
  // Its living things come from a kept library: each a plain file beside the page (sf/kept.mjs), set down where the
  // realm says. Nothing is made: a visitor drives what was kept.
  /** A kept thing as sf/kept.mjs writes it: its body's cells and each part of its look as a palette and runs. */
  type Runs = { palette: number[]; runs: string }
  type Kept = Omit<Making, 'low' | 'cells' | 'fine'> & { body: Runs; fine?: (Runs & { size: [number, number, number]; per: number; low: [number, number, number] })[] }
  /** Runs (a count and which of the palette, each unsigned LEB128, in base64) as `n` cells; throws where they do not fill exactly `n`. */
  const unrun = <T extends Int32Array | Uint16Array>(r: Runs, n: number, As: { new (n: number): T }): T => {
    const bytes = Uint8Array.from(atob(r.runs), (c) => c.charCodeAt(0)), out = new As(n)
    let at = 0, i = 0
    const leb = () => { let v = 0, shift = 1, b; do { b = bytes[i++]; v += (b & 127) * shift; shift *= 128 } while (b & 128 && i < bytes.length); return v }
    while (i < bytes.length) { const count = leb(), kind = r.palette[leb()]; if (at + count > n || kind === undefined) throw new Error('a kept thing whose runs do not fit'); out.fill(kind, at, at + count); at += count }
    if (at !== n) throw new Error('a kept thing whose runs do not fill it')
    return out
  }
  const keptFiles = new Map<string, Promise<Omit<Making, 'low'> | null>>()
  /**
   * Where a thing `size` cells big (its length along x) may stand at a kerb near (x, z), as a parked car does: on
   * asphalt, its near side a few cells off a pavement, nothing standing in its box (a tree's crown, a pole) or in
   * the 30 m of road ahead of it. It
   * looks along the streets of the squares (bay.ts `names`) that run along x (the kept thing turns in no other way
   * yet), nearest first, within 300 m. Null where there is none; the street graph (#450, the data lane) will name
   * parking edges in its place.
   */
  const parked = new Map<string, [number, number, number] | null>()
  const kerbside = async (x: number, z: number, size: readonly [number, number, number]): Promise<[number, number, number] | null> => {
    const road = (px: number, pz: number) => (core.top_at(Math.round(px), Math.round(pz)) & 15) === 6
    const clear = (px: number, pz: number) => { const g = core.ground_at(Math.round(px), Math.round(pz)); for (let y = 2; y <= size[1] + 6; y += 2) if (core.world_kind(Math.round(px), g + y, Math.round(pz))) return false; return true }
    const half = size[0] / 2 + 4, wide = size[2] / 2 + 3, candidates: { at: [number, number]; far: number }[] = []
    for (const square of await streets().catch(() => [])) for (const way of square.ways) for (let i = 1; i < way.line.length; i++) {
      const [ax, az] = way.line[i - 1], [bx, bz] = way.line[i], length = Math.hypot(bx - ax, bz - az)
      if (!length || Math.abs(bz - az) / length > 0.25) continue
      for (let d = 0; d <= length; d += 20) { const px = ax + ((bx - ax) * d) / length, pz = az + ((bz - az) * d) / length, far = Math.hypot(px - x, pz - z); if (far < 3000) candidates.push({ at: [px, pz], far }) }
    }
    candidates.sort((a, b) => a.far - b.far)
    for (const { at: [px, pz] } of candidates) for (const side of [1, -1]) {
      // Out from the middle of the road to where the asphalt ends: the kerb.
      let out = 0
      while (out < 160 && road(px, pz + side * (out + 2))) out += 2
      if (out < wide * 2 || out >= 160) continue
      const cz = pz + side * (out - wide), corners = [[-half, -wide], [half, -wide], [-half, wide], [half, wide], [0, 0]]
      // And 30 m of road ahead of its front (+x) to pull out into.
      const ahead = Array.from({ length: 15 }, (_, i) => half + 20 * (i + 1))
      // On a gentle grade (under 1 in 12 along it): the body stands level, and on a steep street one end would be in the hill.
      const grounds = corners.map(([dx, dz]) => core.ground_at(Math.round(px + dx), Math.round(cz + dz)))
      if (Math.max(...grounds) - Math.min(...grounds) > (half * 2) / 12) continue
      if (corners.every(([dx, dz]) => road(px + dx, cz + dz) && clear(px + dx, cz + dz)) && ahead.every((d) => road(px + d, cz) && clear(px + d, cz))) return [Math.round(px), Math.max(...grounds), Math.round(cz)]
    }
    return null
  }
  const setDown = () => Promise.all((LOCAL?.kept ?? []).map(async (k) => {
    if (!keptFiles.has(k.file)) keptFiles.set(k.file, fetch(new URL(k.file, location.href)).then((r) => (r.ok ? r.json() : null)).then((m: Kept | null) => m && { ...m, cells: unrun(m.body, m.size[0] * m.size[1] * m.size[2], Int32Array), fine: m.fine?.map((f) => ({ size: f.size, per: f.per, low: f.low, cells: unrun(f, f.size[0] * f.size[1] * f.size[2], Uint16Array) })) }, () => null))
    const making = await keptFiles.get(k.file)
    if (!making) return null
    // Over the ground where it stands (bay.ts has the tiles there by now: the realm begins beside it), or at the
    // kerb of a street near there.
    const spot = k.kerb ? (parked.get(k.file) ?? parked.set(k.file, await kerbside(k.at[0], k.at[2], making.size)).get(k.file)) : null
    // A kerb's spot says the highest ground under it.
    const [x, , z] = spot ?? k.at, low: [number, number, number] = [Math.round(x - making.size[0] / 2), Math.max(k.at[1], (spot ? spot[1] : core.ground_at(x, z)) + 2), Math.round(z - making.size[2] / 2)]
    return alive.spawn({ ...making, low })
  }))
  if (LOCAL?.kept?.length && !far) void setDown()
  if (LOCAL?.street && lively && !far) {
    const life = streetOf({ life: new URL(LOCAL.street.life, location.href), cars: new URL(LOCAL.street.cars, location.href), land: core, hour: () => hour ?? 11, rain: () => march.rain, clock: () => folkClock.now(), shocks, cuts, bodies: () => inTheWay(), feet: () => me.feet?.at ?? null, pieces: falling, alive, hud: over, input: controls, faces: (kinds, size, born) => { let by = lookFaces.get(kinds); if (!by) lookFaces.set(kinds, by = new Map()); by.set(size.join(), born) } })
    streetLife = life
    if (query.get('people') !== '0') folk.from.push(life.folk)
  }
  // The realm's billboards and the banner its plane tows (#450, boards.ts): where each stands is the realm's record
  // (sf/boards.json). Laid as edits of the world, so every tool breaks them; reset lays them again. The page goes on
  // without them if they cannot be made. `?boards=0` leaves them out, `?boards=edit` opens their editor (sf/boards.mjs).
  const signboards = LOCAL?.signs && !far && query.get('boards') !== '0' ? await boards({
    file: LOCAL.signs, device, format: gpu.format, passes: pluginDraws, pieces: falling,
    lay: (edit) => { put(); change(edit, false); mover.postMessage({ edit: edit.words, after: heard } satisfies Ask) },
    reach: () => farModel.reach * M,
    done: () => world.done().length,
    kind: (x, y, z) => core.world_kind(x, y, z), feet: (x, z) => core.feet_at(x, z), ground: (x, z) => core.ground_at(x, z), top: (x, z) => core.top_at(x, z),
    pose, began, view, canvas, input: controls, hud: over, day: () => march.day, dull: () => Math.max(march.rain, march.cloud, 0.2 * march.fog), faced: () => farModel.depth, pick: () => march.pick(view()),
    aloft: () => { if (me.on) me.walk(false) }, edit: query.get('boards') === 'edit',
  }).catch((e: unknown) => { console.warn(`no billboards: ${e instanceof Error ? e.message : String(e)}`); return null }) : null
  Object.assign((globalThis as unknown as { engine: object }).engine, { boards: signboards, first })
  // The page that holds the realm in a frame is told when the place is shown (host.ts), with its boards if it has any.
  if (LOCAL) { const told = setInterval(() => { if (!seen.near) return; clearInterval(told); tell('ready', { boards: signboards?.listed() ?? [], signs: signs.list().map((s) => ({ id: s.id, kind: s.kind, accepts: s.accepts })) }) }, 100) }
  /**
   * What the signs' screens cost the GPU here (#450): the march and the far model alone, and with the pass that draws
   * the screens, turn about, the middle of `rounds` each, ms a frame at the canvas's full size and the device's own pace.
   */
  const signPasses = async (rounds = 5) => {
    const to = offscreen(gpu, [canvas.width, canvas.height]), v = view(), alone: number[] = [], both: number[] = []
    paused = true
    for (let i = 0; i < rounds; i++) {
      alone.push((await pace(gpu, to, (encoder, target) => { march.draw(encoder, target, v, flags, 0); farModel.draw(encoder, target, v) }, 100)).ms)
      both.push((await pace(gpu, to, (encoder, target) => { march.draw(encoder, target, v, flags, 0); farModel.draw(encoder, target, v); pluginDraws.draw(encoder, target, v, 0) }, 100)).ms)
    }
    paused = false
    to.destroy()
    const middle = (xs: number[]) => [...xs].sort((x, y) => x - y)[xs.length >> 1]
    return { world: middle(alone), withSigns: middle(both), size: [canvas.width, canvas.height] }
  }
  Object.assign((globalThis as unknown as { engine: object }).engine, { signPasses })
  /**
   * The world as the realm has it again (#450): what was broken, burnt, flooded and thrown is forgotten, and so is
   * every living thing and loose body. The world is the tiles as they came plus the edits made since (world.ts, every
   * core): letting go of the edits is the whole of it, and nothing is sent anywhere. The eye goes back to where the
   * realm begins, on foot if it was, and the kept things are set down again.
   */
  /** What else is put back with the world (the eggs, eggs.ts). */
  const resetting = new Set<() => void>()
  const reset = async () => {
    if (far) return over.notice('A shared world is put back by its keeper, not by one page', 5000)
    for (const each of resetting) each()
    const afoot = me.on
    alive.forget()
    if (afoot) me.walk(false)
    mover.postMessage({ forget: true } satisfies Ask)
    moverAge++
    for (const piece of moving.values()) piece.destroy()
    for (const l of lying) l.piece.destroy()
    moving.clear(); lying = []; putting = []; asked.length = 0; shocks.length = 0; cuts.length = 0
    heard = 0; waiting = 0; bodies = 0; burning = 0; running = false; ticking = false; owed = 0; flames = new Float32Array(0)
    spoiled.push(...world.swap([]))
    farModel.forget()
    core.world_forget()
    streetLife?.reset()
    Object.assign(pose, began)
    if (afoot) me.walk(true)
    await setDown()
    signboards?.relay()
    over.notice('The world is as it was', 3000)
  }
  /**
   * The mover was lost and another hired (#450, `loseMover`): it knows nothing, so it is told every edit the world
   * has, and what was moving (loose pieces, living things, someone's body) is let go and set down again, as reset
   * does, but nothing broken is mended.
   */
  let moversLost = 0
  moverLost = () => {
    moversLost++
    moverAge++
    const afoot = me.on
    alive.forget()
    if (afoot) me.walk(false)
    for (const piece of moving.values()) piece.destroy()
    for (const l of lying) l.piece.destroy()
    moving.clear(); lying = []; putting = []; asked.length = 0
    heard = 0; waiting = 0; bodies = 0; burning = 0; running = false; ticking = false; owed = 0; flames = new Float32Array(0)
    const done = world.done()
    if (done.length) mover.postMessage({ edit: stream(done), after: -1 } satisfies Ask)
    if (afoot) me.walk(true)
    void setDown()
    over.notice('Something went wrong with what moves: it was set down again', 4000)
  }
  // Defined, not assigned: Object.assign would copy what a getter says once, and drop a setter.
  Object.defineProperties((globalThis as unknown as { engine: object }).engine, Object.getOwnPropertyDescriptors({
    /** For the checks (#450): ends a worker without a word, as a tab out of memory would, to see the page carry on. */
    kill: (which: 'mover' | 'maker') => end(which === 'mover' ? moverWorker : (world as unknown as { workers: { worker: Worker }[] }).workers[0]?.worker),
    get mended() { return { movers: moversLost, makers: world.stats.crashed, staleAnswers: stale.answers } },
    set patience(ms: number) { moverPatience = ms; world.patience = ms },
  }))
  if (LOCAL) {
    own.keys.set('Backspace', () => void reset())
    // The realm's controls (#450, realm-ui.ts): the hour, the weather, the tools, reset, and a phone's thumbs.
    const realmUi = realmControls({ march, controls, hour: () => hour, setHour, east: () => pose.x * M, tools: tools.map((t) => t.name), tool: () => tool, pickTool, reset, watch: (each) => void watchers.add(each) })
    Object.assign((globalThis as unknown as { engine: object }).engine, { realmControls: realmUi })
    // The landing's easter eggs (#450, eggs.ts): on the city's windows, its sky and the banner its plane tows
    // (signs.ts, boards.ts). Fetched once the park is shown, so that nothing of them is in the bytes before it.
    let hushed: AudioContext | null = null
    const hatch = () => {
      if (!seen.near) return
      watchers.delete(hatch)
      void import('./eggs.ts').then(({ eggs }) => {
        Object.assign((globalThis as unknown as { engine: object }).engine, { signs, eggs: eggs({
          device, march, controls, sky: realmUi.sky, ui: realmUi.root, hour: () => hour, setHour, ownLight, view, pose, signs,
          callPlane: (on) => signboards?.plane?.call(on),
          mood: (m) => { realmLook.grade = m?.grade ? [m.grade[0], m.grade[1]] : null; realmLook.tint = m?.tint ? [m.tint[0], m.tint[1], m.tint[2]] : [1, 1, 1] },
          notice: (text, ms) => over.notice(text, ms), aspect: () => canvas.clientWidth / Math.max(1, canvas.clientHeight),
          watch: (each) => void watchers.add(each), onReset: (each) => void resetting.add(each), base: location.href,
          // The city's sound steps aside for an egg's: taken off the speakers, and put back.
          hush: (on) => {
            const voice = ears?.voice
            if (!voice) return
            if (on && !hushed) { try { voice.out.disconnect(voice.context.destination); hushed = voice.context } catch { /* not connected */ } }
            else if (!on && hushed) { voice.out.connect(hushed.destination); hushed = null }
          },
        }) })
      })
    }
    watchers.add(hatch)
  }
  Object.defineProperties((globalThis as unknown as { engine: object }).engine, Object.getOwnPropertyDescriptors({ tiles: { tally, memory, water: seaAsked, where, device: DEVICE, hold: HOLD }, reset, local: LOCAL, rules: RULES, setDown, get street() { return streetLife }, seen, get fov() { return fov }, set fov(v: number) { fov = v }, watch: (each: (gap: number) => void) => { watchers.add(each); return () => watchers.delete(each) } }))
  // Realms (#264), on a line of their own.
  Object.assign((globalThis as unknown as { engine: object }).engine, { realms: realm, pieces: () => moving.size, look: () => ({ hour, rain: march.rain, ...realmLook }) })
  // Living things, on a line of their own: every lane adds to the line above.
  Object.assign((globalThis as unknown as { engine: object }).engine, { alive, car, fineCar, me, tempo, shots: streaks })
  // The portal (#264, portal.ts), an experiment: a second world like this one, marched into a window.
  // Made last, and the page goes on without it if it cannot be: nothing else waits on it.
  const gate = far && realm ? await portal({
    gpu, far, realms: realm, world, march, pose, began,
    make: () => new World(device, { ...world.options, workers: Number(query.get('portalworkers') ?? world.options.workers) }),
    // The other world's own marcher: made again, as this one's is, when that world comes to hold finer cells (#372).
    marcher: async (w) => { const m = await marcher(device, gpu.format, w, true); w.onFine = () => void m.reshade((wgsl) => wgsl); return m },
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
  portalDraw = gate ? (encoder, to, v, time, timing) => { gate.walk(); return gate.draw(encoder, to, v, flags, time, timing) } : null
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
  // A visitor to a realm run alone (#450) is told plainly, in the middle of the page, and nothing is left to press.
  if (LOCAL) {
    tell('error', { message: text.split('\n')[0] })
    document.querySelector<HTMLElement>('#boom')?.style.setProperty('display', 'none')
    const told = document.createElement('p')
    told.style.cssText = 'position:fixed;inset:0;margin:auto;height:fit-content;max-width:min(30em,calc(100vw - 32px));padding:0 16px;font:500 17px/1.45 system-ui,sans-serif;color:#e8ecf2;text-align:center;z-index:20'
    told.textContent = /webgpu/i.test(text) ? `${LOCAL.name} is drawn with WebGPU, which this browser does not offer here. It opens in a recent Safari, Chrome or Edge.` : `${LOCAL.name} could not open here. Reloading the page may help.`
    document.body.append(told)
  }
  console.error(e)
  report.notes.push(`failed: ${text}`)
  await post('error')
})
