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
import { COUNT, FINE_ASKED, FLAT, HEAT, MAX_LEVELS, MIRRORS, PICK, SHADOWS, SUN_TILES_A_FRAME, WHOLE_MOON, bounded, marcher, materials, palette, type Moon, type View } from './march.ts'
import { LIGHT_EXTRA, type LocalLightSink } from './lights.ts'
import type { Heavens } from './almanac.ts'
import type { WindowEffect } from './eggs-pictures.ts'
import { crumbs } from './crumbs.ts'
import { flowing } from './water.ts'
import { space } from './space.ts'
import { link } from './link.ts'
import { realms, type Pose } from './realms.ts'
import { portal } from './portal.ts'
import { wheel } from './wheel.ts'
import { car, fineCar, living, type Making } from './living.ts'
import { stunts } from './stunts.ts'
import { behindAt, person } from './person.ts'
import { shots } from './shots.ts'
import { engineOut, engineVent, puffs } from './puffs.ts'
import { ball, fineRows, rows, stream, type Edit } from './edits.ts'
import { people, townsfolk, type Person } from './people.ts'
import { street as streetOf, type Street } from './street.ts'
import { adoptRobotaxiModels, buildRobotaxiModel, ROBOTAXI_SERVICES, type RobotaxiModel } from './robotaxi.ts'
import { createNeighborhood, type Neighborhood, type PlacesPayload } from './neighborhood.ts'
import { NAMED } from './moves.ts'
import { pieces, type Piece } from './pieces.ts'
import { under } from './under.ts'
import { tracks } from './tracks.ts'
import { wheels, type WheelVehicle } from './wheels.ts'
import { restedRows, rowsOf, thing } from './fine.ts'
import { useFineCore } from './fine-core.ts'
import { presence, seedOf } from './presence.ts'
import type { Shock } from './residents.ts'
import type { Answer, Ask } from './mover.ts'
import { read, type Born } from './told.ts'
import { wand, type Target as Aim } from './wand.ts'
import { hands } from './hands.ts'
import { before as beforeEye, block, inHand as carried } from './held.ts'
import { passes as pluginPasses, plugins } from './plugins.ts'
import { workshop } from './workshop.ts'
import { LIBRARY, caster, known, type Spell } from './spells.ts'
import { SIDE, World } from './world.ts'
import { far as farOf, samePath } from './far.ts'
import { fog } from './fog.ts'
import { eggSky } from './eggs-sky.ts'
import { BAY, BUDGET, DEVICE, HOLD, holds, heroes as landmarksOf, mapData, place as placeOf, placesData, names as streets, ON as BAY_ON, START as BAY_START, STREAM, end, lists, marks as roadMarks, memory, near, open, share, silent, streetLamps, tally, underfoot, warm, water as seaAsked, where, whereabouts, WORLD } from './bay.ts'
import { flight } from './flight.ts'
import { input } from './input.ts'
import { hud } from './hud.ts'
import { things } from './things.ts'
import { asker, later } from './ask.ts'
import { LOCAL, MAKING, MASTER, MASTER_NAMED, RULES } from './local.ts'
import { realmControls } from './realm-ui.ts'
import { playHud } from './play-hud.ts'
import { making } from './making.ts'
import { kept } from './kept.ts'
import { boards } from './boards.ts'
import { firstView } from './first.ts'
import { embedded, hear, tell } from './host.ts'
import { signs } from './signs.ts'
import { gather } from './gather.ts'
import { cadence, describe, environment, reporter } from '../probe/tell.ts'
import { loading } from './loading.ts'
import { sound } from './sound/sound.ts'
import { hearing } from './sound/world.ts'
import type { Patch } from './sound/patch.ts'
import { buildTownMap, parseMap } from './nav-data.ts'
import { createMapSystem, type MapSystem } from './minimap.ts'
import { createCarSummon } from './summon.ts'
import { createRecorder, type Recorder } from './recorder.ts'
import { steerScale, type SteerState } from './steer.ts'
import { feedbackUi, type FeedbackUi } from './feedback.ts'
import { initPwa } from './pwa.ts'

const query = new URLSearchParams(location.search)
const numbers = (name: string, fallback: number[]) => query.get(name)?.split(',').map(Number) ?? fallback
const canvas = document.querySelector('canvas')!
// The canvas's size on the page (CSS pixels), kept as the page lays it out (#73). Asked of the canvas in the middle of
// every frame, after the HUD had written to the page, it had the page laid out there and then: the largest single
// self time on the page's thread in San Francisco (0.6 to 1.1 s of a 20 to 28 s drive, in Chrome's samples).
const laid = { w: canvas.clientWidth, h: canvas.clientHeight }
new ResizeObserver(() => { laid.w = canvas.clientWidth; laid.h = canvas.clientHeight }).observe(canvas)
// One device class for the whole page (bay.ts `DEVICE`): what it draws and what it holds.
const phone = DEVICE === 'phone'
/** The world's pool of cells on the GPU (MiB) and its makers of sectors, by device class (bay.ts `BUDGETS`): a tablet has less than a laptop (#81). */
const POOL_MB = BUDGET.pool, WORKERS = phone ? BUDGET.workers : Math.max(2, Math.min(BUDGET.workers, (navigator.hardwareConcurrency || 4) - 2))
/** Keys, pointer and touch (input.ts), and what is shown over the picture (hud.ts): the one owner of each. */
const controls = input(canvas, { phone, useButton: document.querySelector('#boom') })
const over = hud(controls)
const pwa = initPwa({ notice: (text, ms) => over.notice(text, ms) })

/** Cells in a metre. */
const M = 10
/** `?fine=1` or `2` (#259, an experiment): the world's finest cells are 5 or 2.5 cm, in one or two more boxes round the eye that hold the core's cells written out finer. Only the march knows: nothing else drawn or done is scaled. */
const FINE = 1 << FINE_ASKED
const { report, post: send } = reporter('city-4')
/** A realm this page runs alone (local.ts) has no page server to send what was measured to. */
const post: typeof send = LOCAL ? async () => false : send
if (query.get('status') === '1') document.body.classList.add('status')
const flying = !LOCAL && (query.get('fly') ?? (location.pathname === '/' ? '1' : '0')) === '1'

/**
 * The host's `explore` (host.ts), heard from the moment this script runs: said before there is anyone to take it (the
 * GPU, the core and the first tiles are waited for first), it is kept for whoever does.
 */
let explores: (() => void) | null = null, explored = false
/** The GPU device is gone (`onLost`): no frame is drawn again. */
let lost = false
if (embedded) hear((m) => { if (m.type === 'explore') { if (explores) explores(); else explored = true } })

/**
 * A card in the middle of the page that says why the realm is not shown and what to do (#81): over the loader's
 * dimmed view (loading.html styles `.vw-fail`), or over the last picture where the GPU was lost after it opened.
 * One at a time; the realm's own controls are hidden under it.
 */
function failCard(o: { title: string; lines: (string | HTMLElement)[]; keys: { label: string; main?: boolean; run: (key: HTMLButtonElement) => void }[]; links?: { label: string; href: string }[] }): void {
  document.documentElement.dataset.failed = '1'
  document.querySelector('.vw-fail')?.remove()
  document.querySelector<HTMLElement>('#boom')?.style.setProperty('display', 'none')
  const card = document.createElement('section'), h = document.createElement('h2'), keys = document.createElement('div')
  card.className = 'vw-fail'; card.setAttribute('role', 'alertdialog'); card.setAttribute('aria-labelledby', 'vw-fail-h')
  h.id = 'vw-fail-h'; h.textContent = o.title
  card.append(h, ...o.lines.map((l) => { if (typeof l !== 'string') return l; const p = document.createElement('p'); p.textContent = l; return p }))
  keys.className = 'keys'
  for (const k of o.keys) { const b = document.createElement('button'); b.type = 'button'; b.textContent = k.label; if (k.main) b.className = 'main'; b.addEventListener('click', () => k.run(b)); keys.append(b) }
  card.append(keys)
  if (o.links?.length) {
    const links = document.createElement('p')
    links.className = 'links'
    for (const l of o.links) { const a = document.createElement('a'); a.href = l.href; a.textContent = l.label; a.rel = 'noopener'; links.append(a) }
    card.append(links)
  }
  document.body.append(card)
  keys.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
}
/** Whether the page is in an app's own browser (X, Instagram, Facebook and the like), which most often leave WebGPU out. */
const inApp = () => /\b(FBAN|FBAV|Instagram|Twitter|TwitterAndroid|LinkedInApp|Line\/|Snapchat|TikTok|musical_ly|GSA\/)|; wv\)/i.test(navigator.userAgent)
/** Copies this page's address, and says so on the key only if it was copied (an app's browser often has no clipboard). */
const copyLink = async (key: HTMLButtonElement) => {
  const was = key.textContent
  let copied = false
  try { await navigator.clipboard.writeText(location.href); copied = true } catch { /* no clipboard here */ }
  key.textContent = copied ? 'Copied' : 'Copy it from the address bar'
  setTimeout(() => { key.textContent = was }, 2200)
}

async function main() {
  report.env = environment()
  // A lobby (#526): a world on someone else's machine, joined through its door (door.ts) before anything is made; a join that fails says why and the page goes on alone.
  // Only where the realm's rule allows (local.ts `MASTER`): a link alone takes nobody into a stranger's server. The way
  // in is the server list (lobbies.ts), which loads the page again with the lobby chosen in this tab's ticket, taken and
  // forgotten here; an address names one only in a realm's preview (`?lobby=`, for the checks and the console).
  /**
   * Where a request to the master would go, read as the browser reads it (against this page: `//host` and a bare path
   * are addresses too), or null where it is no address and nothing can be sent. The question shows its host only, so
   * nothing a link's author wrote reaches the question but a host name.
   */
  const masterAt = (() => { try { const u = new URL(MASTER ?? '', location.href); return /^https?:$/.test(u.protocol) ? u : null } catch { return null } })()
  /**
   * Whether the visitor agrees to a master the address named (local.ts `MASTER_NAMED`): asked once a tab for that
   * master, before anything is sent to it. One this site's realm names, one on this site, or the engine's own page,
   * needs no asking.
   */
  /** Whether the visitor answered the question yes in this load: a join they chose, as the list's own is (`ticket`). */
  let askedYes = false
  const agreed = (what: 'join' | 'list'): boolean => {
    if (!MASTER_NAMED || !masterAt || masterAt.origin === location.origin) return true
    const masterHost = masterAt.host
    const kept = 'village.master.agreed'
    try { if (sessionStorage.getItem(kept) === MASTER) return true } catch { /* nothing kept: asked each time */ }
    // The browser's own question: it is asked before the page has drawn anything of its own to ask on (the bar and its
    // cards are hidden in the first view, hud.ts), and where a browser will not show it the answer is no.
    const yes = globalThis.confirm(what === 'join'
      ? `This link wants to take you into a server found through ${masterHost}.\n\nThat is not this site. Servers run on players' own machines: the host will see your address and what you do there.\n\nJoin it?`
      : `The link you followed names a server list at ${masterHost}.\n\nThat is not this site: it, and any server you join from it, will see your address.\n\nShow it?`)
    if (!yes) return false
    askedYes = true
    try { sessionStorage.setItem(kept, MASTER!) } catch { /* asked again next time */ }
    return true
  }
  const ticket = (() => { try { const t = sessionStorage.getItem('village.join'); sessionStorage.removeItem('village.join'); const v = t ? JSON.parse(t) : null; return MASTER && v && v.master === MASTER && typeof v.lobby === 'string' && Math.abs(Date.now() - v.at) < 60_000 ? { lobby: String(v.lobby), name: typeof v.name === 'string' ? v.name : null, label: String(v.label ?? '') } : null } catch { return null } })()
  const joined = ticket ? await import('./lobbies.ts').then((l) => l.arrive({ master: MASTER!, ...ticket, hud: over, input: controls }))
    // (In a realm a link is not a choice: found on the live preview on November 25, a link with a master and a lobby
    // had the page ask that master and join that server with no click. It asks first now, and says whose it is;
    // until the visitor agrees nothing is sent to either, and the door's code is not fetched.)
    : query.has('lobby') && MASTER && RULES.lobbies === 'preview' && agreed('join') ? await import('./door.ts').then((d) => d.enter({ master: MASTER!, lobby: query.get('lobby')!, name: query.get('name') }).then((door) => { door.ongone = d.notice; door.ontold = (t) => over.notice(`The server says: ${t}`, 6000); return door }, (e: Error) => { d.notice(e.message); return null })) : null
  type Core = { memory: WebAssembly.Memory; hero_night(sort: number, which: number): number; hero_reach(sort: number, which: number): number; ground_at(x: number, z: number): number; top_at(x: number, z: number): number; feet_at(x: number, z: number): number; world_edit(after: number): void; world_forget(): void; paving_at(x: number, z: number): number; world_kind(x: number, y: number, z: number): number; world_under?(x: number, y: number, z: number, depth: number): number; edits_room(words: number): number; merge_rows(lod: number, x0: number, x1: number, z0: number, z1: number): number; merged_words(): number; fine_cells(on: number): void; fine_refused(): number; make_sector(sx: number, sy: number, sz: number, lod: number): number }
  // Open GPU and the page's WASM core in parallel so core compilation overlaps adapter/device creation (#83).
  const [gpu, innerInit] = await Promise.all([openGpu(), open<Core>(new URL('./core.wasm', import.meta.url).href)])
  useFineCore(innerInit)
  // The device lost (#81: a GPU reset, a phone short of memory, a long while in the background): the frames stop and
  // the visitor is told, with a key that opens the realm again, rather than a picture that silently stands still.
  gpu.onLost((info) => {
    lost = true
    report.notes.push(`device lost: ${info.reason}`)
    if (info.reason === 'destroyed') return
    const name = LOCAL?.name ?? 'The world'
    if (!LOCAL) { over.status(`The GPU was lost (${info.reason}). Reload to go on.`); return }
    loading.fail()
    tell('error', { message: 'the GPU was lost', fatal: true })
    failCard({ title: `${name} stopped drawing`, lines: ['The graphics processor was reset. This happens when a phone runs short of memory, or a tab was in the background for a long time.'], keys: [{ label: `Reload ${name}`, main: true, run: () => location.reload() }] })
  })
  loading.step('gpu')
  const { device } = gpu
  report.env.gpu = await describe(gpu)
  report.faults = gpu.faults
  const context = canvas.getContext('webgpu')!
  context.configure({ device, format: gpu.format, alphaMode: 'opaque' })

  // The page's own core, behind a handle that stays the same when the core is built again and swapped in (#264,
  // `recore` below): whoever was handed `core`, or one of its functions, goes on using the one that is in.
  let inner = innerInit
  const core = Object.defineProperties({}, Object.fromEntries(Object.keys(inner).map((k) => [k, typeof (inner as never)[k] === 'function' ? { value: (...a: number[]) => (inner as unknown as Record<string, (...a: number[]) => number>)[k](...a) } : { get: () => (inner as never)[k] }]))) as Core
  // Start on land, a little above a street — resolve arrival coordinates early so tile & release fetches overlap GPU pipeline creation (#83).
  const upright = innerHeight > innerWidth && !query.has('look') ? LOCAL?.upright : undefined
  const directLL = query.has('ll') && !!BAY_START
  const arrive = !query.has('at') && !directLL && LOCAL?.arrive?.at.length === 3 ? { ...LOCAL.arrive, ...(upright?.yaw !== undefined ? { yaw: upright.yaw } : {}), ...(upright?.pitch !== undefined ? { pitch: upright.pitch } : {}) } : null
  let startX = arrive ? arrive.at[0] : BAY_START ? BAY_START[0] : BAY_ON ? 519_500 : 700, startZ = arrive ? arrive.at[2]! : BAY_START ? BAY_START[1] : BAY_ON ? 661_150 : 4070
  const underfootPromise = STREAM ? underfoot(inner, startX, startZ) : Promise.resolve(true)
  const releasedPromise = LOCAL?.release ? where().catch(() => null) : Promise.resolve(null)

  const room = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
  const poolMb = Math.min(bounded(query.get('pool'), POOL_MB, 16, 2048, true), Math.floor(room / (1 << 20)))
  // (Three whole sizes from 2 to 32 sectors, #81, or the device's own: a link cannot ask for a box past the GPU.)
  const gridAsked = numbers('grid', []), grid = (gridAsked.length === 3 && gridAsked.every((n) => Number.isFinite(n)) ? gridAsked.map((n) => bounded(String(n), 8, 2, 32, true)) : phone ? [8, 8, 8] : [16, 8, 16]) as [number, number, number]
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
    levels: bounded(query.get('levels'), (phone ? 8 : 9) + FINE_ASKED, 1, MAX_LEVELS, true),
    poolWords: (poolMb << 20) / 4,
    fine: FINE_ASKED,
    // Cells may hold finer cells (#259): a made thing may be of cells of 2.5 or 1.25 cm (#372). `?bricks=1` from the
    // start, `?bricks=0` never; otherwise from the moment this world first holds such a thing, so that a world
    // without one pays nothing (world.ts `bricksLater`).
    bricks: query.get('bricks') === '1' || (BAY_ON && query.get('bricks') !== '0'),
    fineSun: query.get('bricks') === '1' && query.get('finesun') !== '0',
    // Shadows at the thing's own grain are dear where a fine thing fills the view (#372: 47% of the frame against 30% without, a car 5 m off and a house front), so they are for `?finesun=1`; without, a fine thing shades as its cells of 10 cm.
    bricksLater: !BAY_ON && query.get('bricks') === null ? { fineSun: query.get('finesun') === '1' } : undefined,
    // Each maker holds its own core and the tiles round what it makes (bay.ts `HOLD`): a phone has two (#450).
    workers: bounded(query.get('workers'), WORKERS, 1, 8, true),
  })
  // Build independent GPU pipelines concurrently in two batches (#83) so shader compilation never serializes startup.
  const [march, blit, debris, smoke, water, planet, shade, roadTracks, released] = await Promise.all([
    marcher(device, gpu.format, world, false, !!LOCAL?.release),
    glow(gpu),
    crumbs(device, gpu.format),
    puffs(device, gpu.format),
    flowing(device, gpu.format),
    space(device, gpu.format),
    under(device, gpu.format),
    tracks(device, gpu.format),
    releasedPromise,
  ])
  // A world that comes to hold finer cells is drawn by a shader that looks into them: made again behind the frames, the old one drawing until it is ready.
  world.onFine = () => { core.fine_cells(1); void march.reshade((wgsl) => wgsl) }
  // In a world whose process holds a release (#526), this page's core holds finer cells from the start, as that process
  // and this page's makers of sectors do: else what it says is underfoot is grass a cell lower than what they have.
  if (world.options.bricks && (WORLD?.release || joined?.pin)) core.fine_cells(1)
  /** From this high (metres) the planet is drawn in place of the boxes of cells. The widest box is 13 km tall with the
   * eye at its middle, so the ground is out of it when the eye is 6.5 km up: from 8 km there was a blue square in haze. */
  const SPACE = 6_000
  loading.step('engine')
  // The far model (#450, far.ts): the city past the cells' reach as faces, where the realm has one (its record's
  // `far`, a folder beside the page) or the address names one (`?far=/path/`).
  // (A path the address names is this site's own or nothing, #81: `samePath`. The realm's own and its release's are as they say.)
  const farAsked = query.get('far') === '' ? '' : query.has('far') ? samePath(query.get('far')) : null
  if (query.has('far') && farAsked === null) console.warn('?far= names no path of this site: the realm\'s own far model is drawn')
  const [falling, farModel, marine, skyEggs, folk, staff, carWheels] = await Promise.all([
    pieces(device, gpu.format, march),
    farOf(device, gpu.format, march, farAsked ?? (released?.far ? released.manifest : LOCAL?.far ? new URL(LOCAL.far, location.href).href : null)),
    fog(device, gpu.format, march),
    eggSky(device, gpu.format, march),
    people(device, gpu.format, march),
    wand(device, gpu.format, march, core, controls, over),
    wheels(device, gpu.format, march.localLights.buffer),
  ])
  // Show the place once its near boxes and skyline are ready. Coarser fallback cells have lower fetch priority.
  const nearLevels = farModel.listing && farModel.reach > 0
    ? world.levels.filter((l) => l.index === 0 || ((l.grid[0] * SIDE) << (l.index - 1)) / 2 < farModel.reach * M)
    : world.levels
  world.farFrom = nearLevels.length
  world.farCovered = (x0, z0, x1, z1) => farModel.covers(x0, z0, x1, z1)
  farModel.onFallback = (x0, z0, x1, z1) => world.refreshFar(x0, z0, x1, z1)
  loading.step('skyline')
  const colours = palette(), stuff = materials()
  // What is heard (#247): `?sound=0` leaves it out. Deferred until after the first picture is drawn (#83) so
  // AudioContext creation (~250-350 ms) never blocks first paint or control.
  let firstPictured = () => {}, nearPictured = () => {}
  const firstPicture = new Promise<void>((r) => { firstPictured = r })
  const nearPicture = new Promise<void>((r) => { nearPictured = r })
  let ears: ReturnType<typeof hearing> | null = null
  // Waymo-style in-car radio & connected music picker (radio-ui.ts): loaded lazily on first open.
  let radioPickerPromise: Promise<import('./radio-ui.ts').RadioPicker> | null = null
  const openRadioPicker = (tab?: import('./sound/radio.ts').ProviderId) => {
    if (!ears) return
    const radio = ears.radio
    void (radioPickerPromise ??= import('./radio-ui.ts').then(({ createRadioPicker }) => createRadioPicker({ radio, input: controls }), (e) => { radioPickerPromise = null; throw e })).then((p) => p.open(tab)).catch(() => {})
  }
  let soundStarted = false
  const startSound = () => {
    if (soundStarted) return
    soundStarted = true
    void sound().then((voice) => {
      ears = hearing(voice, { ground: core.ground_at, paving: core.paving_at, rain: () => march.rain, under: () => march.under, flames: () => flames, bodies: () => bodies, hour: () => hour ?? 12, making: () => wishes.busy > 0, kind: core.world_kind, riding: () => !!alive.riding, inside: () => alive.inside, person: (id) => id !== 0 && id === me.id, driving: () => { const r = alive.riding; if (!r || (r.controls ?? 'drive') !== 'drive') return null; const w = alive.where(r); if (!w) return null; const nearby: [number, number, number][] = []; for (const t of alive.things) { if (t === r || !t.alive) continue; const tw = alive.where(t); if (tw) nearby.push(tw.at) } return { at: w.at, yaw: Math.atan2(w.front[0], -w.front[2]), kmh: alive.telemetry?.kmh ?? 0, nearby } }, seam: () => ({ things: made, hud: over, input: controls }), who: (id) => { if (far && id === far.me) return 'here'; const o = others?.where(id); if (o) return [o[0], o[1] + 12, o[2]]; const t = alive.things.find((t) => t.alive && t.ref === id), w = t && alive.where(t); return w ? w.at : null } }, { music: query.get('music') === '1', query })
      ears.radio.onOpenPicker((tab) => openRadioPicker(tab))
      pwa.bindRadio(ears.radio)
    }).catch(() => {})
  }
  if (query.get('sound') !== '0') void firstPicture.then(() => setTimeout(startSound, 0))
  march.detail = Number(query.get('detail') ?? 1)
  march.maps = query.get('maps') !== '0'

  // Where the Bay comes in tiles, the ones round the start and round where the page was told to stand come first.
  // Before the first picture only the finest round the start (#450): what is asked of the ground there, first on the
  // line. The coarser ones come after; the makers of sectors ask for what they need themselves.
  if (STREAM) { const there = query.get('at')?.split(',').map(Number); await underfootPromise; void near(inner, startX, startZ); if (there?.length === 3) await near(inner, Math.round(there[0] * M), Math.round(there[2] * M)) }
  loading.step('streets')
  while (!BAY_ON && core.ground_at(startX, startZ) < 120 && startX < 400_000) startX += 1280
  // A place given by latitude and longitude may be a roof: the eye starts over what stands there, not inside it.
  const at = arrive ? arrive.at.map((c) => c / M) : numbers('at', [startX / M, Math.max(core.ground_at(startX, startZ), BAY_START ? core.feet_at(startX, startZ) : 0) / M + 12, startZ / M])
  const look = arrive && !query.has('look') ? [(arrive.yaw * 180) / Math.PI, (arrive.pitch * 180) / Math.PI] : numbers('look', directLL ? [0, -10] : BAY_ON ? [64, 4] : [20, -8])
  /** The eye's angle from top to bottom, degrees. */
  let fov = Number(query.get('fov') ?? (arrive && upright?.fov) ?? (directLL ? undefined : LOCAL?.fov) ?? 70)
  /** How far the picture is turned about the look, clockwise as the eye sees, radians: a photograph's camera has it (#423). */
  const roll = (Number(query.get('roll') ?? (directLL ? 0 : LOCAL?.roll) ?? 0) * Math.PI) / 180
  /** Dynamic driving camera offsets set each frame by living.ts (0 whenever not driving). */
  let driveFov = 0, driveRoll = 0, driveEnergy = 0, driveDrift = 0
  // The loader's pictures are of the arrival as the realm frames it (sf/loading.mjs): which one this eye is, or none.
  const pictured = !!arrive && !['look', 'fov', 'roll'].some((k) => query.has(k))
  loading.view(pictured ? (upright ? 'upright' : 'wide') : null)
  const pose: { x: number; y: number; z: number; yaw: number; pitch: number; tilt?: [number, number, number, number] } = { x: at[0], y: at[1], z: at[2], yaw: (look[0] * Math.PI) / 180, pitch: (Math.max(-90, Math.min(90, look[1])) * Math.PI) / 180 }
  // Feed sector workers immediately (#83) so they begin making near tiles while the rest of page init completes.
  world.update([pose.x * M * FINE, pose.y * M * FINE, pose.z * M * FINE])
  const street = { x: startX / M, y: core.ground_at(startX, startZ) / M, z: startZ / M }
  let speed = 12
  // A realm the page runs alone opens on its picture (#450, first.ts): its controls come when the visitor engages.
  // Not after a join the visitor chose (#526: the list's ticket, or the question answered yes in this load): they asked
  // to be in that world, and are. An address alone never skips it, nor does a join that failed.
  const chosen = !!joined && (!!ticket || askedYes)
  const first = LOCAL ? firstView(!chosen && !directLL && query.get('first') !== '0' && query.get('boards') !== 'edit') : null
  // The line of numbers is for whoever measures: a realm the page runs alone shows it only when asked (`?debug=1`; first.ts hides it).
  if (LOCAL && query.get('debug') !== '1') document.documentElement.classList.add('plain')
  if (BAY_ON) void whereabouts(() => [Math.round(pose.x * M), Math.round(pose.z * M)], farModel.listing?.credit ? [farModel.listing.credit] : [], first ? (credits) => first.credits(credits) : undefined)

  // ── Moving ──────────────────────────────────────────────────────────────
  // The page's own mode, under any a lane adds (input.ts): the keys and the look move the eye, a click uses the
  // tool picked. `own.keys` and `own.use` are filled in below, where the things they do are made.
  const own = { use: (): boolean | void => {}, keys: new Map<string, () => void>() }
  controls.push({ name: 'moving', use: () => own.use(), key: (code) => { const act = own.keys.get(code); act?.(); return !!act }, wheel: (deltaY) => { speed = Math.max(1, Math.min(400, speed * (deltaY < 0 ? 1.25 : 0.8))); return true } })
  // A realm's first view is a still picture (first.ts): until the visitor is in the realm a mode lies over the page's
  // own that takes every key and leaves the pointer free. Nothing done by chance moves the eye.
  first?.during(() => controls.push({ name: 'landing', solid: true, still: true }))
  // The way in (#450, explore.ts): where the world's boxes are made round in place of the eye (the roof a flight is on
  // its way to), and who places the eye after the page's own movers have.
  let ahead: readonly [number, number, number] | null = null
  let shot: { before?(): void; after(dt: number): void } | null = null
  // Its EXPLORE board asked twice, or the host's `explore`, which is meant: kept if it comes before the flow has
  // (it is fetched once the park is shown), or before this (it is heard from the script's first line). Where nothing leads in (a realm with no such board,
  // `?boards=0`, boards or a flow that could not be had) the first view ends as it used to, on a key or a click on
  // the picture: nobody is left before a still picture with no way past it.
  let way: import('./explore.ts').Explore | null = null, meant = false, askedAct = false, openly = false
  const enter = (host: boolean) => { if (!first || first.engaged) return; if (way) { if (host) void way.go(); else way.act() } else if (openly) first.engage(); else if (host) meant = true; else askedAct = true }
  const noWayIn = () => {
    if (!first || first.engaged || openly) return
    openly = true
    if (meant) return first.engage()
    addEventListener('keydown', (e) => { if (!['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) first.engage() }, true)
    canvas.addEventListener('click', () => first.engage())
  }
  explores = () => enter(true)
  // A phone turned while its first view is up is framed for how it is held now (local.ts `upright`): turned upright
  // after it opened wide, the board that leads in would be off its picture. Asked once, the ask leans from the new
  // framing (explore.ts `reframed`); once the flight has begun the first view is over, and nothing is framed again
  // until the way back comes to it (explore.ts `back`), framed for how the phone is held then.
  // (The banner's round stays the one it was given as the page opened: boards.ts chooses it once.)
  const opened = { at: [pose.x, pose.y, pose.z], yaw: pose.yaw, pitch: pose.pitch, fov }, reframes = !!(first && arrive && LOCAL?.upright && !query.has('look') && !query.has('fov'))
  let tallNow = !!upright
  /** The first view's eye as the page opens it, framed for how the phone is held now. */
  const firstEye = () => {
    if (!reframes) return opened
    tallNow = innerHeight > innerWidth
    const tall: { yaw?: number; pitch?: number; fov?: number } = tallNow ? LOCAL!.upright! : {}
    return { at: opened.at, yaw: tall.yaw ?? LOCAL!.arrive!.yaw, pitch: tall.pitch ?? LOCAL!.arrive!.pitch, fov: tall.fov ?? LOCAL!.fov ?? opened.fov }
  }
  if (reframes) addEventListener('resize', () => {
    // (Only while the eye is where it arrived: flown to a board, it looks at that board, however the phone is held.)
    if (innerHeight > innerWidth === tallNow || first!.engaged || (way && way.state !== 'idle' && way.state !== 'armed') || Math.hypot(pose.x * M - arrive!.at[0], pose.y * M - arrive!.at[1], pose.z * M - arrive!.at[2]!) > 1) return
    const eye = firstEye()
    Object.assign(pose, { yaw: eye.yaw, pitch: eye.pitch })
    fov = eye.fov
    loading.view(pictured ? (tallNow ? 'upright' : 'wide') : null)
    way?.reframed()
  })
  if (explored) enter(true)
  // A click that is to do nothing more than its press has done (explore.ts: the press that cut a flight short), stopped
  // before the boards or the picture hear it: the click of the press that was down then, however long it is held (it
  // comes with the press's end, or a moment after it), and no other.
  let deaf = false, deafUntil = 0
  addEventListener('pointerdown', () => { deaf = false; deafUntil = 0 }, true)
  for (const type of ['pointerup', 'pointercancel']) addEventListener(type, () => { if (deaf) { deaf = false; deafUntil = performance.now() + 400 } }, true)
  addEventListener('click', (e) => { if (deaf || performance.now() < deafUntil) { deaf = false; deafUntil = 0; e.stopImmediatePropagation(); e.preventDefault() } }, true)

  const view = (): View => {
    const cp = Math.cos(pose.pitch), forward = [Math.sin(pose.yaw) * cp, Math.sin(pose.pitch), -Math.cos(pose.yaw) * cp] as const
    const level = [Math.cos(pose.yaw), 0, Math.sin(pose.yaw)] as const
    const plumb = [level[1] * forward[2] - level[2] * forward[1], level[2] * forward[0] - level[0] * forward[2], level[0] * forward[1] - level[1] * forward[0]] as const
    const curRoll = roll + driveRoll
    // A photographic lens (such as SF's 25.05° landing cut) can be narrower than the driving camera's 40° floor.
    const curFov = driveFov === 0 && fov > 0 && fov < 180 ? fov
      : Math.min(115, Math.max(40, (Number.isFinite(fov) ? fov : 70) + driveFov))
    const cr = Math.cos(curRoll), sr = Math.sin(curRoll)
    const right = curRoll ? ([level[0] * cr + plumb[0] * sr, level[1] * cr + plumb[1] * sr, level[2] * cr + plumb[2] * sr] as const) : level
    const up = curRoll ? ([plumb[0] * cr - level[0] * sr, plumb[1] * cr - level[1] * sr, plumb[2] * cr - level[2] * sr] as const) : plumb
    // Someone whose down is not the world's (person.ts): the eye's whole frame is turned with them.
    if (pose.tilt) { const q = pose.tilt, t = (v: readonly number[]) => { const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)] as const }; return { eye: [pose.x * M * FINE, pose.y * M * FINE, pose.z * M * FINE], forward: t(forward), right: t(right), up: t(up), tanHalf: Math.tan((curFov * Math.PI) / 360) } }
    // Under the sea: under its top, where the ground by itself lies under it too (not in a pit dug on land).
    march.under = pose.y < 0 && core.ground_at(Math.round(pose.x * M), Math.round(pose.z * M)) < -1
    return { eye: [pose.x * M * FINE, pose.y * M * FINE, pose.z * M * FINE], forward, right, up, tanHalf: Math.tan((curFov * Math.PI) / 360) }
  }
  /** Where a place in the world is on the screen (CSS pixels), or null behind the eye: for what the hud keeps beside a thing. */
  const project = (at: readonly [number, number, number]): [number, number] | null => {
    const v = view(), d = [at[0] - v.eye[0], at[1] - v.eye[1], at[2] - v.eye[2]], dot = (a: readonly number[]) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2]
    const z = dot(v.forward)
    if (z <= 1) return null
    const w = laid.w, h = laid.h
    return [w / 2 + (dot(v.right) / z / v.tanHalf) * (h / 2), h / 2 - (dot(v.up) / z / v.tanHalf) * (h / 2)]
  }
  const walk = (dt: number) => {
    // Only while nothing solid is over this mode: typing, the keys are letters; mounted, they are the vehicle's.
    if (!controls.live('moving')) return
    const [right, up] = controls.turn(), held = controls.held, stick = controls.stick
    pose.yaw += right
    // Keep a registered overhead view vertical until the player tilts it.
    if (up) pose.pitch = Math.max(-1.5, Math.min(1.5, pose.pitch + up))
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
  let scale = bounded(query.get('scale'), phone ? 0.5 : 0.75, 0.25, 1.5)
  let held = 0
  // A phone's GPU clock is not to be believed: the iPhone's read 0.01 to 10 ms for the same work from one second to the next.
  const clocked = gpu.canTime && navigator.maxTouchPoints === 0
  const steerState: SteerState = { scale, held, lateRun: 0, backoffs: 0, sinceDrop: 999 }
  const steer = (budget: number, gap: number, calm = false) => {
    steerState.scale = scale
    steerState.held = held
    steerScale(steerState, { budget, gap, frameMs, cpuMs, workCpuMs, gpuMs, marchMs, clocked, calm, fixed })
    scale = steerState.scale
    held = steerState.held
  }
  let target: Offscreen | null = null
  const fit = () => {
    // (At most two device pixels a CSS pixel, #81: a phone's three draws 2.25 times the pixels for little to see.)
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.round(laid.w * dpr)), h = Math.max(1, Math.round(laid.h * dpr))
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
  let neighborhood: Neighborhood | null = null
  const lively = !!LOCAL?.street && query.get('street') !== '0'
  if (query.get('people') !== '0' && !LOCAL?.street && !WORLD?.release) folk.from.push(townsfolk(core, () => (worldHour ? worldHour() : hour ?? 11), () => march.rain, () => folkClock.now(), shocks, takenOff, () => inTheWay()))
  /** How much colour and how much contrast the last pass gives the picture (glow.ts): the day's, until an hour is set. */
  let grade: [number, number] = [0.9, 0.1]
  /** By the sun wherever it is (towards it, a unit direction): how much of the day it is, how low it is, and where the light comes from: by day the sun, never from under the ground; by night the moon, from a fixed place. */
  const sunlight = (at: readonly number[]) => {
    const ease = (lo: number, hi: number, v: number) => { const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t) }
    const day = ease(-0.1, 0.1, at[1]), low = 1 - ease(0.02, 0.5, at[1])
    const sun: [number, number, number] = day === 0 ? [0.45, 0.7, -0.55] : [at[0], Math.max(at[1], 0.06), at[2]]
    return { sun, day, low }
  }
  /** Where the light comes from at an hour, how much of the day it is and how low the sun: null is the sun where it always stood. */
  const sunOf = (h: number | null) => {
    if (h === null) return { sun: [0.52, 0.62, 0.59] as [number, number, number], day: 1, low: 0 }
    // From the east at six over the south to the sea in the west at eighteen.
    const a = ((((h % 24) + 24) % 24 - 6) / 12) * Math.PI, east = [0.8, 0, 0.6], top = [-0.27, 0.9, 0.36]
    return sunlight(east.map((e, i) => Math.cos(a) * e + Math.sin(a) * top[i]))
  }
  /** What the portal draws each frame, once there is one (#264, portal.ts). */
  let portalDraw: ((encoder: GPUCommandEncoder, to: Offscreen, v: View, time: number, timing?: GPURenderPassTimestampWrites) => boolean) | null = null
  /** The passes the engine's plugins add to a frame (plugins.ts). */
  const pluginDraws = pluginPasses()
  /** Lights everything from `sun` (towards it): the march, its moon, and what is drawn beside it; the grade the hour's unless told. */
  let shown = { sun: [0.52, 0.62, 0.59] as readonly number[], day: 1, low: 0 }
  const lightBy = (sun: readonly [number, number, number], day: number, low: number, moon: Moon = WHOLE_MOON, own?: [number, number]) => {
    shown = { sun, day, low }
    march.light(sun, day, low)
    march.moon = moon
    // Full day is 1, dusk and night 0.
    const noon = day * (1 - low)
    grade = own ?? [1.25 - 0.2 * noon, 0.35 - 0.1 * noon]
    smoke.light(sun, day)
    debris.light(sun, day)
    water.light(sun, day)
    carWheels.light(sun, day)
  }
  const setHour = (h: number | null) => {
    hour = h === null ? null : ((h % 24) + 24) % 24
    const { sun, day, low } = sunOf(hour)
    lightBy(sun, day, low)
  }
  /**
   * Lights the page as a real sky is (#524, almanac.ts: San Francisco's now): the hour its clocks say, its sun where it
   * stands, and by night its moon where it stands and as much of it lit as is. A moon down leaves the night's own
   * light from its fixed place, dimmer, and no disc; a moon up but thin gives less light than a full one.
   *
   * `ease`: how far of the way from the light as it is now to that sky's (1: all of it). Called again each frame, the
   * light comes round to it instead of jumping (a mode chosen, the moon taking over from the sun at dusk). Says
   * whether it is there.
   */
  const setSky = (h: number, sky: Heavens, ease = 1) => {
    hour = ((h % 24) + 24) % 24
    const lit = sunlight(sky.sun), byMoon = lit.day === 0 && sky.moon[1] > 0.06
    const to = byMoon ? { sun: sky.moon, day: 0, low: 1 } : lit, toward = to.sun.map((v) => v / Math.hypot(...to.sun))
    // A short way (a minute's move) at once, a long way eased.
    const apart = Math.hypot(...shown.sun.map((v, i) => v - toward[i])) + Math.abs(shown.day - to.day) + Math.abs(shown.low - to.low)
    const k = apart < 0.02 ? 1 : Math.max(0, Math.min(1, ease))
    const dir = shown.sun.map((v, i) => v + (toward[i] - v) * k), length = Math.hypot(dir[0], dir[1], dir[2]) || 1
    const sun: [number, number, number] = [dir[0] / length, dir[1] / length, dir[2] / length]
    const day = shown.day + (to.day - shown.day) * k, low = shown.low + (to.low - shown.low) * k
    const off = Math.hypot(sun[0] - toward[0], sun[1] - toward[1], sun[2] - toward[2])
    // The moon's disc is drawn where the light comes from: shown once the light is the moon's, not sliding there.
    lightBy(sun, day, low, byMoon && off < 0.01 ? { sun: sky.sun, disc: 1, light: 0.55 + 0.45 * sky.lit } : { sun: sky.sun, disc: -1, light: byMoon ? 0.55 + 0.45 * sky.lit : 0.55 })
    return off < 0.003 && Math.abs(day - to.day) < 0.002 && Math.abs(low - to.low) < 0.002
  }
  // A local realm's own air (#450): its haze, cloud and sky, and the sun and grade of the afternoon it is seen in, until an hour is set.
  /** The realm's own light (#450): the sun and grade of the afternoon it is seen in, the hour unset (the eggs give it back, eggs.ts). */
  const ownLight = () => {
    if (!LOCAL?.air?.sun) return setHour(null)
    hour = null
    lightBy(LOCAL.air.sun, 1, 0, WHOLE_MOON, LOCAL.air.grade ? [LOCAL.air.grade[0], LOCAL.air.grade[1]] : grade)
  }
  // The landmarks as the night knows them (#450, heroes.rs `night`): where each stands, and its rule's numbers from the core.
  if (BAY_ON) void landmarksOf().then((list) => {
    march.beacons = list.flatMap((h) => {
      const night = Array.from({ length: 12 }, (_, i) => core.hero_night(h.sort, i)), box = Array.from({ length: 6 }, (_, i) => core.hero_reach(h.sort, i)), at = placeOf(h.at[0], h.at[1])
      return night.some(Number.isNaN) ? [] : [{ at: [at.x, h.foot * 10, at.z] as const, night, reach: Math.hypot(Math.max(-box[0], box[3]), Math.max(-box[2], box[5])) }]
    })
  })
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
  /**
   * An egg's mood (eggs.ts): a grade and a tint that come over the picture, not at once. The hour an egg goes to is
   * glided to in about a second, and its mood set in one frame was a night's green laid over a day's sky: a frame or
   * two washed pale green (#450). It comes over two seconds, the first half of one held back for the dark, and goes in half of one, before the day is back.
   */
  const mood: { of: { grade: [number, number] | null; tint: [number, number, number] } | null; on: boolean; t: number } = { of: null, on: false, t: 0 }
  const easeMood = (dt: number, own: readonly [number, number]) => {
    if (!mood.of) return
    mood.t = mood.on ? Math.min(1, mood.t + dt / 2) : Math.max(0, mood.t - dt / 0.5)
    const k = Math.max(0, Math.min(1, (mood.t - 0.25) / 0.75)), mix = k * k * (3 - 2 * k), of = mood.of
    realmLook.tint = [1 + (of.tint[0] - 1) * mix, 1 + (of.tint[1] - 1) * mix, 1 + (of.tint[2] - 1) * mix]
    realmLook.grade = of.grade && mix > 0 ? [own[0] + (of.grade[0] - own[0]) * mix, own[1] + (of.grade[1] - own[1]) * mix] : null
    if (!mood.on && mood.t === 0) mood.of = null
  }
  /** In a shared world, the hour the town's residents are out by: the realm's own, else eleven, as the world's process has it (world.mjs `hourNow`), whatever hour this page shows. Null where the world is the page's own. */
  let worldHour: (() => number) | null = null
  let flags = (query.get('shadows') === '0' ? 0 : SHADOWS) | (query.get('mirrors') === '0' ? 0 : MIRRORS) | (query.get('heat') === '1' ? HEAT : 0) | (query.get('flat') === '1' ? FLAT : 0)
  let playedHud: import('./play-hud.ts').PlayHud | null = null
  // How the picture is drawn, as chosen in the realm's Sky panel (#450) and kept in this browser. Graphics presets
  // control rendering passes (shadows and mirrors) only and never change resolution. What the address says is kept
  // whatever is chosen: shadows or mirrors it turns off (`?shadows=0`, `?mirrors=0`), and a scale it fixes (`?scale=`).
  const PRESETS = { low: { flags: 0 }, medium: { flags: SHADOWS }, high: { flags: SHADOWS | MIRRORS } } as const
  type Preset = keyof typeof PRESETS
  const addressed = flags & (SHADOWS | MIRRORS)
  let preset: Preset = 'high'
  // Dynamic resolution, as the Sky panel's switch, Target FPS bank and manual slider have it: on by default, steering
  // the march's scale (`steer`) for a target frame rate (30 or 60 FPS, or the screen's own rate = 0); when off, pinned
  // at the slider's scale. Independent of Graphics presets: neither affects the other.
  let rate = 60
  const RATES = [30, 60, 0] as const
  const WINDOW_EFFECTS: readonly WindowEffect[] = ['ambilight', 'equalizer', 'off']
  let windowEffect: WindowEffect = 'ambilight'
  const setWindowEffect = (mode: WindowEffect, keep = true) => {
    if (!WINDOW_EFFECTS.includes(mode)) return
    windowEffect = mode
    if (keep) try { localStorage.setItem('village.windowEffect', mode) } catch { /* this visit only */ }
    ;(globalThis as unknown as { engine: { eggs?: { wakeAudio?(): void } } }).engine.eggs?.wakeAudio?.()
  }
  const steered = () => !fixed && held < 1e6
  const keepResolution = () => { try { localStorage.setItem('village.resolution', JSON.stringify({ auto: steered(), scale, target: rate })) } catch { /* this visit only */ } }
  const draws = (p: Preset, keep = true) => {
    preset = p
    flags = (flags & ~(SHADOWS | MIRRORS)) | (PRESETS[p].flags & addressed)
    // (Storage may be refused, a private window: the choice is then this visit's.)
    if (keep) try { localStorage.setItem('village.graphics', p) } catch { /* this visit only */ }
  }
  /** Dynamic resolution and manual scale: `auto` turns dynamic resolution on or off, `target` is the FPS steered for (0: screen max), `scale` pins a manual scale (0.3 to 1 on steer's 0.05 grid). An address's `?scale=` wins over it. */
  const resolve = (to: { scale?: number; auto?: boolean; target?: number }, keep = true) => {
    if (fixed) return
    if (to.target !== undefined && (RATES as readonly number[]).includes(to.target)) rate = to.target
    if (to.auto === true) held = 0
    else if (to.auto === false || to.scale !== undefined) { scale = Math.round(Math.max(0.3, Math.min(1, to.scale ?? scale)) * 20) / 20; held = 1e9 }
    if (keep) keepResolution()
  }
  // (Taken up again only where the Sky panel is, which can change it: the realm's page, below.)
  const keptGraphics = () => {
    try {
      const kept = localStorage.getItem('village.graphics')
      if (kept && kept in PRESETS) draws(kept as Preset, false)
      const keptFx = localStorage.getItem('village.windowEffect')
      if (keptFx && (WINDOW_EFFECTS as readonly string[]).includes(keptFx)) setWindowEffect(keptFx as WindowEffect, false)
      const res = JSON.parse(localStorage.getItem('village.resolution') ?? 'null') as { auto?: unknown; scale?: unknown; target?: unknown } | null
      if (res && typeof res === 'object') {
        const next: { scale?: number; auto?: boolean; target?: number } = {}
        if (typeof res.target === 'number') next.target = res.target
        if (res.auto === true) next.auto = true
        else if (res.auto === false || typeof res.scale === 'number') {
          next.auto = false
          if (typeof res.scale === 'number') next.scale = res.scale
        }
        resolve(next, false)
      }
    } catch { /* nothing kept */ }
  }
  const graphics = {
    presets: Object.keys(PRESETS) as Preset[], get: () => preset, set: (p: string) => { if (p in PRESETS) draws(p as Preset) },
    resolution: { rates: RATES, get: () => ({ scale, auto: steered(), target: rate, fixed }), set: resolve },
  }
  own.keys.set('KeyH', () => { flags ^= HEAT })
  own.keys.set('KeyR', () => { march.rain = march.rain > 0 ? 0 : 1 })
  own.keys.set('BracketRight', () => setHour((hour ?? 14) + 0.5))
  own.keys.set('BracketLeft', () => setHour((hour ?? 14) - 0.5))
  own.keys.set('KeyL', () => { flags ^= SHADOWS })
  own.keys.set('KeyK', () => { march.maps = !march.maps })

  // The GPU's own time for the march, where the device can say: the page's own march, and the march of the world
  // seen through an open window (#367). The picture's size is steered by their sum: by the page's own alone, a window
  // open cost a second march the steer knew nothing of, and the page ran at 30 frames a second beside it.
  const clock = gpu.canTime ? {
    set: device.createQuerySet({ type: 'timestamp', count: 6 }),
    resolved: device.createBuffer({ size: 48, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
    read: device.createBuffer({ size: 48, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
    busy: false,
  } : null
  // ── The sun's maps and the frame (#73) ──
  // A tile of the sun's maps is 4,096 rays through everything up-sun of them (sun.ts). Eight were drawn in any frame
  // that had eight to draw, and whenever the eye moves there are. What a tile takes of the GPU depends on the place and
  // the hour: 0.4 ms in San Francisco at midday, 3.5 ms there with the sun low, 2.5 to 3 ms in the town, whose far
  // boxes hold land. In the town, on a GPU other work was drawing on, eight a frame made one frame in twelve late at any
  // speed from 60 km/h, and none with the tiles held back, in the same session (test/drive-smooth.mjs `--curve
  // --sun-most 8,own`); in San Francisco at midday neither way was a frame more late. So while the eye moves the tiles
  // have a share of the frame's time on the GPU, a twelfth of it, counted in what a tile was last measured to take there.
  // What a frame does not use is kept, up to one tile's worth: a tile dearer than the share is drawn every few frames.
  // The picture is right meanwhile: a place whose tile is not drawn is answered from the next coarser box's map.
  // An eye that stands has eight a frame as before: nothing passes for a late frame to be seen in, and the first
  // picture's shadows are traced ray by ray until its tiles are drawn.
  const sunRoom = { tileMs: 1, share: 0, owed: 0, most: 0, drew: 0, moving: false, /** `?suntiles=n`: so many tiles a frame whatever they cost (8: as it was before #73), for measuring what the share is worth. */ fixed: query.has('suntiles') ? bounded(query.get('suntiles'), 8, 0, 64, true) : null as number | null }
  const SUN_SHARE = 1 / 12
  /** How many tiles this frame has room for: `budget` is the frame's time (ms), `moving` whether the eye moved. */
  const sunMost = (budget: number, moving: boolean): number => {
    if (sunRoom.fixed !== null) return sunRoom.fixed
    if (!moving) { sunRoom.owed = 0; return SUN_TILES_A_FRAME }
    const share = sunRoom.share = SUN_SHARE * budget
    sunRoom.owed = Math.min(sunRoom.owed + share, Math.max(share, sunRoom.tileMs))
    return Math.min(SUN_TILES_A_FRAME, Math.floor(sunRoom.owed / sunRoom.tileMs))
  }
  let eyeWas: readonly [number, number, number] | null = null
  let gpuMs = 0, marchMs = 0, windowMs = 0, frameMs = 16.7, last = performance.now(), frames = 0, started = last
  // The screen's own rate: the shortest gap between frames seen lately; and the shortest it has been seen to keep up,
  // two counts running agreeing (a lone short gap is not a screen), which a frame rate of 'the screen's own' aims at.
  let screenMs = 16.7, shortest = Infinity, fastestMs = 16.7

  // The first view left alone (nobody has pressed, moved the pointer or a key for two seconds, the eye where it arrived,
  // the fog gone) is drawn 30 times a second, not at the screen's rate: steered to six tenths of every frame, the
  // landing kept the GPU two thirds busy (9.8 ms a frame at 69 fps) for a picture that only drifts. `?rest=0` keeps the
  // screen's rate, for checks that time frames there.
  const REST_MS = 1000 / 30
  let rests = query.get('rest') !== '0', stirred = 0, resting = false
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(type, () => { stirred = performance.now() }, { capture: true, passive: true })
  /** Whether the eye is where the first view arrives. */
  const atArrival = () => !arrive || Math.hypot(pose.x * M - arrive.at[0], pose.y * M - arrive.at[1], pose.z * M - arrive.at[2]!) <= 1
  /** Whether the first view is up and still: as is the eggs' `still` below, and its picture is in. */
  const firstStill = () => !!first && !first.engaged && (!way || way.state === 'idle' || way.state === 'armed') && atArrival()
  // The first view as it was left needs only its own picture (#523): the far model keeps to the landing's cut of the
  // view, which from that eye draws the skyline every band does (a hundredth of the faces), and street life sleeps,
  // none of it in sight from there. Far model unlocks when the map opens; street life ticks once diving/in-world.
  let landing = true
  const leaveLanding = () => {
    if (!landing || !seen.near || (first && !first.engaged && (!way || way.state === 'idle' || way.state === 'picking') && !!arrive && atArrival())) return
    landing = false
    farModel.left()
    if (streetLife) streetLife.enabled = true
    if (neighborhood) neighborhood.enabled = true
  }
  // An eye that turned, or a window screen that is up (an egg playing, eggs.ts), stirs it as a hand does.
  let looked = ''
  const restful = (now: number) => {
    const look = `${pose.yaw} ${pose.pitch} ${fov}`
    if (look !== looked || march.screen.up > 0) { looked = look; stirred = now }
    return rests && seen.near > 0 && now - seen.near > 4000 && now - stirred > 2000 && firstStill()
  }

  const watchers = new Set<(gap: number) => void>()
  let mapSys: MapSystem | null = null
  let telemetry: Recorder | null = null
  let feedback: FeedbackUi | null = null
  let paused = false, saying = ''
  /** Parts of a frame left out, by name, for finding what a slow frame is spent on: pieces, crumbs, puffs, flames, spoil. */
  const off = new Set<string>()
  /** How fast the world goes (#264): 1 as it does. What this page moves and its dust and smoke go by it; in a shared world the world's process says it. */
  const tempo = { rate: 1 }
  /** What a frame costs this thread, smoothed, in ms; split into real JS/encode work vs swapchain/submit wait (#155). `heard` is the mover's answers, summed. */
  let cpuMs = 0, workCpuMs = 0, presentWaitMs = 0, mark = 0
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
  // Not asked of an eye going faster than anyone runs (#73): each cell asked about is asked of the page's own core,
  // which makes the whole sector round it the first time, on this thread. With the eye alone at 180 km/h down Geary
  // Boulevard that was 570 ms of a 12 s pass, 17 to 19 ms in single frames (test/drive-smooth.mjs --sf --profile), to
  // learn that nobody at that speed is in a room: a room has walls on three sides within 8 m. (A car's tracks, wheels
  // and camera ask the core about the ground under it all the same, `groundUnder`: those sectors are still made here.)
  const ROOM_SPEED = 15
  const roomedBy = (dt: number, speed: number) => {
    const to = pose.y < SPACE && speed < ROOM_SPEED && inRoom() ? 1 : 0
    roomed += (to - roomed) * Math.min(1, dt * 4)
    if (Math.abs(to - roomed) < 0.01) roomed = to
    return roomed
  }
  /** Placed world LAMP (material 15) voxel edits tracked so player-built glowing blocks cast real local light. */
  const placedLamps: { x: number; y: number; z: number; r: number; g: number; b: number; range: number }[] = []
  let worldPal: Float32Array | null = null
  const trackLampEdit = (edit: Edit) => {
    const w = edit.words
    if (!w.length) return
    const op = w[0]
    if (op === 0 && w.length >= 6) {
      const cx = w[1], cy = w[2], cz = w[3], radius = w[4], kind = w[5]
      if (kind === 0) {
        // Blast / clear: remove any placed lamps destroyed inside the blast reach.
        const r = Math.ceil((radius * 44) / 16) + 2, r2 = r * r
        for (let i = placedLamps.length - 1; i >= 0; i--) {
          const l = placedLamps[i], dx = l.x - cx, dy = l.y - cy, dz = l.z - cz
          if (dx * dx + dy * dy + dz * dz <= r2) placedLamps.splice(i, 1)
        }
      } else if ((kind & 15) === 15) {
        const ci = (kind >>> 8) & 255
        let r = 1.0, g = 0.78, b = 0.48
        if (ci !== 0 && ci !== 46) {
          const pal = (worldPal ??= palette())
          const o = ci * 4, peak = Math.max(pal[o], pal[o + 1], pal[o + 2], 0.001)
          r = pal[o] / peak; g = pal[o + 1] / peak; b = pal[o + 2] / peak
        }
        const range = Math.min(220, Math.max(95, 75 + radius * 18))
        // Merge with an existing nearby placed lamp rather than duplicating on repeated clicks.
        for (let i = 0; i < placedLamps.length; i++) {
          const l = placedLamps[i], dx = l.x - cx, dy = l.y - cy, dz = l.z - cz
          if (dx * dx + dy * dy + dz * dz < 225) { l.x = cx; l.y = cy; l.z = cz; l.r = r; l.g = g; l.b = b; l.range = Math.max(l.range, range); return }
        }
        if (placedLamps.length >= 64) placedLamps.shift()
        placedLamps.push({ x: cx, y: cy, z: cz, r, g, b, range })
      }
    } else if ((op === 1 || op === 3 || op === 4) && w.length >= 7) {
      const count = w[1], scale = op === 4 ? 0.125 : op === 3 ? 0.25 : 1
      let sx = 0, sy = 0, sz = 0, area = 0, lastCi = 0
      for (let i = 0, o = 2; i < count && o + 4 < w.length; i++, o += 5) {
        const kind = w[o + 4]
        if ((kind & 15) !== 15) continue
        const len = Math.max(1, w[o + 1] - w[o])
        sx += (w[o] + w[o + 1]) * 0.5 * scale * len
        sy += w[o + 2] * scale * len
        sz += w[o + 3] * scale * len
        area += len
        lastCi = (kind >>> 8) & 255
      }
      if (area > 0) {
        const cx = sx / area, cy = sy / area, cz = sz / area
        let r = 1.0, g = 0.78, b = 0.48
        if (lastCi !== 0 && lastCi !== 46) {
          const pal = (worldPal ??= palette())
          const o = lastCi * 4, peak = Math.max(pal[o], pal[o + 1], pal[o + 2], 0.001)
          r = pal[o] / peak; g = pal[o + 1] / peak; b = pal[o + 2] / peak
        }
        if (placedLamps.length >= 64) placedLamps.shift()
        placedLamps.push({ x: cx, y: cy, z: cz, r, g, b, range: Math.min(200, Math.max(95, 75 + Math.sqrt(area) * scale * 16)) })
      }
    }
  }
  const emitPlacedLamps = (sink: LocalLightSink) => {
    if (!placedLamps.length) return
    const scale = 1.85 * (0.45 + 0.55 * Math.min(1, sink.dark * 1.4))
    for (let i = 0; i < placedLamps.length; i++) {
      const l = placedLamps[i]
      sink.addPoint(l.x, l.y, l.z, l.r * scale, l.g * scale, l.b * scale, l.range, l.range * 0.34, 1.05, 85, LIGHT_EXTRA)
    }
  }
  let portalLights: ((sink: LocalLightSink) => void) | null = null
  const updateLocalLights = (v: View) => {
    if (pose.y > SPACE || off.has('lights')) { march.localLights.clear(); return }
    const ancX = Math.floor(v.eye[0] / SIDE) * SIDE
    const ancY = Math.floor(v.eye[1] / SIDE) * SIDE
    const ancZ = Math.floor(v.eye[2] / SIDE) * SIDE
    march.localLights.beginFrame(v, ancX, ancY, ancZ, preset, march.lights, march.rain)
    alive.lights(march.localLights)
    streetLife?.lights(march.localLights)
    falling.emitLights(march.localLights)
    smoke.lights(march.localLights)
    portalLights?.(march.localLights)
    emitPlacedLamps(march.localLights)
    if (BAY_ON && march.lights > 0.02) {
      march.localLights.addStreetLamps(streetLamps(v.eye[0], v.eye[2], preset === 'high' ? 1450 : preset === 'medium' ? 1050 : 650))
    }
    march.localLights.finishFrame()
  }
  const frame = (now: number) => {
    if (lost) return
    // At rest, a screen frame that comes too soon after the last one drawn is let go by, unseen by the watchers too: what
    // they are handed is the time since the last frame drawn. (Two milliseconds short still counts, so 60 Hz gives 30.)
    const wasResting = resting
    resting = restful(now)
    if (resting && now - last < REST_MS - 2) { requestAnimationFrame(frame); return }
    const began = mark = performance.now()
    const dt = Math.min(0.1, (now - last) / 1000)
    const gap = now - last
    for (const each of watchers) each(gap)
    telemetry?.frame(dt, gap, now)
    if (paused) { last = now; requestAnimationFrame(frame); return }
    if (mapSys?.opaque) {
      // While the fullscreen entry map is open, keep background WASM sector workers building the chosen landing spot!
      if (ahead) world.update(ahead)
      last = now
      requestAnimationFrame(frame)
      return
    }
    // Rest is not lateness: the screen's rate, and how long a frame takes, are counted only from frames at that rate.
    if (wasResting && !resting) frameMs = screenMs
    if (!resting) {
      frameMs += ((now - last) - frameMs) * 0.05
      shortest = Math.min(shortest, now - last)
      if (frames % 120 === 119) { const was = screenMs; screenMs = Math.max(4, shortest); shortest = Infinity; if (Math.abs(screenMs - was) < 1) fastestMs = Math.min(fastestMs, screenMs) }
    }
    last = now
    // Riding a thing, the eye goes where it goes; otherwise where the keys take it.
    controls.poll?.(dt)
    shot?.before?.()
    drawAhead(now)
    if (!alive.frame(dt) && !me.frame(dt)) walk(dt)
    stuntHud.frame(dt)
    shot?.after(dt)
    const budget = rate ? Math.max(1000 / rate, screenMs) : fastestMs
    steer(budget, gap, resting)
    const v = view(), to = fit()
    // How fast the eye goes, metres a second.
    const eyeSpeed = eyeWas ? Math.hypot(v.eye[0] - eyeWas[0], v.eye[1] - eyeWas[1], v.eye[2] - eyeWas[2]) / (M * FINE) / Math.max(dt, 1e-3) : 0
    eyeWas = v.eye
    march.roofed = roomedBy(dt, eyeSpeed)
    staff.frame(v)
    ears?.frame(v.eye, pose.yaw, dt)
    magic.step(dt)
    grip.frame()
    ownHold(v)
    lap('steer')
    fallOn(dt)
    lap('fallOn')
    streetLife?.frame(dt, v)
    neighborhood?.frame(v)
    lap('street')
    world.update(ahead ?? v.eye)
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
    roadTracks.step(dt * tempo.rate)
    if (!off.has('wheels')) carWheels.step(dt * tempo.rate, wheelVehicles(), groundUnder)
    lap('step')
    for (const level of world.moved) march.sun.age(level)
    // (Moving: more than a metre a second.)
    const moving = eyeSpeed > 1
    sunRoom.moving = moving
    sunRoom.most = sunMost(budget, moving)
    const sunDrew = sunRoom.drew = march.tend(encoder, v, world.wholeFrom(), sunRoom.most, timed ? { querySet: clock.set, begin: 4, end: 5 } : undefined)
    if (moving) sunRoom.owed -= sunDrew * sunRoom.tileMs
    lap('tend')
    if (pose.y > SPACE) {
      march.localLights.clear()
      // Where the page starts is the land's middle (land.rs HOME), 70 m east and 407 m south of the world's corner.
      planet.draw(encoder, to, v, pose.y / 1000, [(pose.x - 70) / 1000, (pose.z - 407) / 1000], march.sun.s, march.day, (now - started) / 1000, timed ? { querySet: clock.set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined)
    } else {
      updateLocalLights(v)
      march.draw(encoder, to, v, flags, (now - started) / 1000, timed ? { querySet: clock.set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined)
      windowed = portalDraw?.(encoder, to, v, (now - started) / 1000, timed ? { querySet: clock.set, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 } : undefined) === true
      farModel.draw(encoder, to, v)
      skyEggs.draw(encoder, to, farModel.depth, v, (now - started) / 1000)
      marine.draw(encoder, to, farModel.depth, v, (now - started) / 1000)
      if (!off.has('water')) water.draw(encoder, to, v, (now - started) / 1000)
      if (!off.has('under') && alive.things.length) shade.draw(encoder, to, v, shades(), groundUnder, march.day, march.sun.s)
      if (!off.has('under')) roadTracks.draw(encoder, to, v, groundUnder)
      if (!off.has('wheels')) carWheels.draw(encoder, to, v)
      if (!off.has('pieces')) falling.draw(encoder, to, v, march.sun.s, undefined, (flags & MIRRORS) !== 0)
      if (!off.has('signs')) neighborhood?.drawSigns(encoder, to, v, march.sun.s, march.day, Math.max(march.rain, march.cloud, 0.2 * march.fog), farModel.depth)
      if (!off.has('people')) folk.draw(encoder, to, v, (now - started) / 1000)
      if (!off.has('crumbs')) debris.draw(encoder, to, v)
      if (!off.has('puffs')) smoke.draw(encoder, to, v)
      // What the engine's plugins draw (plugins.ts `passes`): after the world and whoever is in it, before the wand's marker.
      pluginDraws.draw(encoder, to, v, (now - started) / 1000)
      staff.draw(encoder, to, v, (now - started) / 1000)
    }
    easeMood(Math.min(resting ? gap : frameMs, 100) / 1000, grade)
    const texBegan = performance.now()
    const backbufferView = context.getCurrentTexture().createView()
    const texMs = performance.now() - texBegan
    blit(encoder, to, backbufferView, march.under || pose.y > SPACE ? 0 : march.rain * (0.35 + 0.65 * march.day) * (alive.inside ? 0.45 : 1), (now - started) / 1000, march.under ? [1.25, 0.35] : realmLook.grade ?? grade, march.under || pose.y > SPACE ? 0 : 1 - march.day, realmLook.tint, driveEnergy, driveDrift)
    if (timed) { encoder.resolveQuerySet(clock.set, 0, 6, clock.resolved, 0); encoder.copyBufferToBuffer(clock.resolved, 0, clock.read, 0, 48) }
    const subBegan = performance.now()
    device.queue.submit([encoder.finish()])
    const presentMs = texMs + (performance.now() - subBegan)
    laps.present = presentMs
    spent.present = (spent.present ?? 0) * 0.95 + presentMs * 0.05
    telemetry?.onPresented(canvas)
    lap('draw')
    over.frame(project, playedHud?.parts())
    if (timed) {
      clock.busy = true
      void clock.read.mapAsync(GPUMapMode.READ).then(() => {
        const [a, b, c, d, e, f] = new BigUint64Array(clock.read.getMappedRange().slice(0))
        clock.read.unmap()
        clock.busy = false
        // What a tile of the sun's maps took, from the first of this frame's beginning to the last one's end (a query
        // nothing wrote keeps what it last read: counted only where tiles were drawn). Held to what a tile can be, so
        // one wild reading (a phone's clock gives them, raw-webgpu) neither stops the maps nor floods the frame.
        if (sunDrew > 0 && f > e) sunRoom.tileMs += (Math.max(0.05, Math.min(8, Number(f - e) / 1e6 / sunDrew)) - sunRoom.tileMs) * 0.2
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
    if (!seen.first) { seen.first = performance.now(); firstPictured() }
    // The picture with the place in it (as player/stage.ts counts it): every box whole across its middle half.
    // And the far model's share of it (far.ts `ready`): at the landing, the faces seen from there of every far tile in the
    // view, so that the skyline is in the first picture; then what the view needs past the cut, and once the visitor leaves the first view the rest (leaveLanding).
    // The loader's last stage (loading.ts): how near the least whole box is to the half across its middle that `near` waits for.
    if (!seen.near) loading.progress(Math.min(...nearLevels.flatMap((l) => [0, 2].map((a) => (l.whole.high[a] - l.whole.low[a]) / (l.grid[a] / 2)))))
    if (!seen.near && world.stats.stale === 0 && world.stats.made > 0 && (farModel.ready || pose.y > SPACE) && nearLevels.every((l) => l.whole.high.every((h, a) => h - l.whole.low[a] >= l.grid[a] / 2))) { seen.near = performance.now(); farModel.shown(); nearPictured() }
    leaveLanding()
    if (!seen.whole && world.stats.wanted === 0 && world.stats.stale === 0 && world.stats.made > 0) seen.whole = performance.now()
    const frameCpuMs = performance.now() - began
    const workMs = Math.max(0, frameCpuMs - presentMs)
    cpuMs += (frameCpuMs - cpuMs) * 0.05
    workCpuMs += (workMs - workCpuMs) * 0.05
    presentWaitMs += (presentMs - presentWaitMs) * 0.05
    requestAnimationFrame(frame)
  }
  /** When the first picture was drawn and when the world round the eye was first whole: ms since the page was asked for. */
  const seen = { first: 0, near: 0, whole: 0 }
  // The road's paint and rails (#450): lines the march draws over the asphalt (marks.ts), asked for once the place is
  // shown round the eye, so the first picture waits on none of their bytes. Until then a road is bare asphalt.
  // One that fails is asked for again, four times at most, 15 s apart.
  let marksAsked = false
  const markRoads = (tries: number): void => {
    marksAsked = true
    void roadMarks().then((bytes) => {
      if (bytes) { if (march.marks(bytes) < 0) console.error('marks.bin is not marks') } else if (tries > 1) setTimeout(() => markRoads(tries - 1), 15_000)
    })
  }
  if (BAY_ON) void nearPicture.then(() => { if (!marksAsked) markRoads(4) })
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
  const far = joined ? link('/world', joined) : query.has('realm') ? link(`/realm/${encodeURIComponent(query.get('realm')!)}/world`) : query.has('shared') ? link() : null
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
  if (STREAM) { const tell = () => { const x = Math.round(ahead ? ahead[0] : pose.x * M), z = Math.round(ahead ? ahead[2] : pose.z * M); void near(inner, x, z); mover.postMessage({ bay: [x, z] } as never) }; tell(); setInterval(tell, 500) }
  const moving = new Map<number, Piece>()
  // ── Where a moving thing is drawn (#73) ──
  // The mover is asked once a frame to move things on by the time the last frame took, and what it answers is what the
  // next frame draws: a thing is drawn where it was a frame ago. With every frame on time nobody can tell. But a frame
  // that comes late shows it going half as fast and then twice as fast, and an answer that comes after the next frame
  // has begun shows it standing still for a frame and then jumping (0.9 m at 200 km/h), with the eye that rides it:
  // the faster it goes, the further. So a thing the last step moved is drawn on from where that step left it, the way
  // it went in that step, to the time of the frame being drawn (a tenth of a second at most; not a thing that went
  // faster than anything goes, which was set down somewhere else). A thing the last step did not move lies where it
  // was said to. `?ahead=0`, or `engine.ahead = false`, draws things as they are said: for measuring.
  type Placed = { pos: [number, number, number]; rot: [number, number, number, number] }
  /** A moving thing's last two places as the mover said them, the frame the last was asked in and the seconds asked for, and which step it was. */
  const went = new WeakMap<Piece, { from: Placed | null; to: Placed; at: number; took: number; step: number }>()
  let aheadOn = query.get('ahead') !== '0', frameAt = 0, tickAt = 0, tickTook = 0, stepped = 0
  const AHEAD_MOST = 0.1, AHEAD_SPEED = 2000
  /** Draws each thing the last step moved on to the time of this frame. */
  const drawAhead = (now: number) => {
    frameAt = now
    if (!aheadOn) return
    for (const piece of moving.values()) {
      const w = went.get(piece)
      if (!w || w.step !== stepped || !w.from || w.took < 1e-3) continue
      const a = w.from, b = w.to, k = Math.min(AHEAD_MOST, Math.max(0, (now - w.at) / 1000)) / w.took
      if (Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]) > AHEAD_SPEED * w.took) continue
      // Its turn goes on the same way: along the short way from the one turn to the other, and as far again.
      const near = a.rot[0] * b.rot[0] + a.rot[1] * b.rot[1] + a.rot[2] * b.rot[2] + a.rot[3] * b.rot[3] < 0 ? -1 : 1
      const q = [0, 1, 2, 3].map((i) => b.rot[i] + (b.rot[i] - near * a.rot[i]) * k), length = Math.hypot(q[0], q[1], q[2], q[3]) || 1
      // (A place of its own each frame, as each answer's is: whoever kept the last one still has the last one.)
      piece.pos = [b.pos[0] + (b.pos[0] - a.pos[0]) * k, b.pos[1] + (b.pos[1] - a.pos[1]) * k, b.pos[2] + (b.pos[2] - a.pos[2]) * k]
      piece.rot = [q[0] / length, q[1] / length, q[2] / length, q[3] / length]
    }
  }
  /** Bodies that are cells again, drawn where they lay until those cells are in the picture. */
  let lying: { piece: Piece; shown: number }[] = []
  let heard = 0, waiting = 0, ticking = false, tickSentAt = 0, moverFailedAt = 0, owed = 0, bodies = 0, burning = 0
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
  const change = (edit: Edit, farToo = true) => { if (!adopted) world.edit(edit); trackLampEdit(edit); spoiled.push(edit); if (farToo) farModel.edited(edit.box); staff.changed(edit); me.edit(edit.words); tellCore(edit.words) }
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
    // (A step's answer: what was asked once a frame, `fallOn`.)
    const step = !far && ticking && !answer.released && answer.spawned === undefined
    if (far) { if (answer.released && asked.shift()) waiting-- }
    else if (answer.released) waiting--
    else if (answer.spawned === undefined) { ticking = false; tickSentAt = 0 }
    if (answer.failed) {
      report.notes.push(`moving failed: ${answer.failed}`)
      const now = performance.now()
      if (!far && now - moverFailedAt > 2000) { moverFailedAt = now; loseMover(moverWorker) }
      return
    }
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
    // What the last step moved and this one did not lies where that step left it, not where it was drawn on to.
    if (step) { stepped++; for (const piece of moving.values()) { const w = went.get(piece); if (w && w.step === stepped - 1) { piece.pos = [...w.to.pos]; piece.rot = [...w.to.rot] } } }
    for (const at of [...told.moves, ...told.gone]) {
      const piece = moving.get(at.id)
      if (piece) { piece.pos = at.pos; piece.rot = at.rot }
    }
    // Where each thing a step moved was before it and is now, for drawing it on (`drawAhead`). Moved by anything else
    // (set down, a blast), it has no way it went, and is drawn as said until two steps have moved it again.
    for (const at of told.moves) {
      const piece = moving.get(at.id)
      if (!piece) continue
      const w = went.get(piece), to: Placed = { pos: [at.pos[0], at.pos[1], at.pos[2]], rot: [at.rot[0], at.rot[1], at.rot[2], at.rot[3]] }
      if (!step) went.delete(piece)
      else if (w) Object.assign(w, { from: w.step === stepped - 1 ? w.to : null, to, at: tickAt, took: tickTook, step: stepped })
      else went.set(piece, { from: null, to, at: tickAt, took: tickTook, step: stepped })
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
    if (!far || far.live) for (const d of told.dust) { const c = hue(d.kind); debris.dust(d.at, d.kind, d.amount, [c[0], c[1], c[2]]); fell.dust += d.amount }
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
  // A world that refuses this page's ask says why, as text: a thing of someone else's in a lobby, or ground that has not come (#526).
  mover.onerror = (e) => { waiting = 0; ticking = false; tickSentAt = 0; report.notes.push(`mover: ${e.message}`); if (joined && e.message.startsWith('the world refused: ')) over.notice(`Not done: ${e.message.slice(19, 219)}`, 6000) }
  // Things that live (#245): bodies that are kept, and driven by whoever rides them. In a shared world the world's
  // own process moves them, and this page says only what a rider asks.
  const streaks = shots(smoke, debris)
  // A living thing's look, its faces made once for each part's cells (a car's are 4.8 million cells and half a second
  // to make): a page fetches each part once (living.ts), so a second car of a kind shares them and makes nothing.
  // (By the cells and by their size: the same cells may be a part of another shape.)
  const lookFaces = new WeakMap<Uint16Array, Map<string, ReturnType<typeof thing>>>()
  // A look made on the page's thread is made square (fine.ts `thing`), and its smooth faces (#38) off it, by a worker
  // of the street's kind (streetfaces.ts): several times the cost, a hitch as someone gets in. Until they come, the
  // pieces wearing it are drawn square; then they are given them (pieces.ts `refit`), and so is every later one.
  const smoothing = new Map<Born, Piece[]>()
  let smoother: Worker | null = null
  type FaceAnswer = { key: number; faces?: Uint32Array<ArrayBuffer>; smooth?: Uint32Array<ArrayBuffer>; cells?: Uint16Array; size?: [number, number, number]; coarseKinds?: Uint16Array; coarseSize?: [number, number, number]; filled?: number }
  const smoothPending = new Map<number, (ans: FaceAnswer) => void>()
  const ensureSmoother = () => {
    if (!smoother) {
      smoother = new Worker(new URL('./streetfaces.ts', import.meta.url), { type: 'module' })
      smoother.onmessage = (e: MessageEvent<FaceAnswer>) => {
        const pending = smoothPending.get(e.data.key)
        if (pending) { smoothPending.delete(e.data.key); pending(e.data); return }
        const born = smoothKeys.get(e.data.key)
        smoothKeys.delete(e.data.key)
        if (!born || !e.data.faces || !e.data.smooth) return
        born.faces = e.data.faces
        born.smooth = e.data.smooth
        for (const piece of smoothing.get(born) ?? []) falling.refit(piece, e.data.faces, e.data.smooth)
        smoothing.delete(born)
      }
    }
    return smoother
  }
  const askSmoother = (msg: Record<string, unknown>): Promise<FaceAnswer> => new Promise((done) => {
    const key = ++smoothAsked
    smoothPending.set(key, done)
    ensureSmoother().postMessage({ key, ...msg })
  })
  /** Builds a fine look's faces (and optional smooth normals) off the page thread and registers them in `lookFaces` (#129). */
  const prebakeLook = async (kinds: Uint16Array, size: readonly [number, number, number], smooth: boolean): Promise<Born> => {
    const key = size.join()
    let by = lookFaces.get(kinds); if (!by) lookFaces.set(kinds, by = new Map())
    const existing = by.get(key)
    if (existing) return existing
    const ans = await askSmoother({ raw: kinds.slice(), size: [size[0], size[1], size[2]], ...(smooth ? { reach: 5 } : {}) })
    const born: Born = { id: 0, cells: ans.filled ?? 0, low: [0, 0, 0], size: [size[0], size[1], size[2]], com: [size[0] / 2, size[1] / 2, size[2] / 2], faces: ans.faces!, ...(ans.smooth ? { smooth: ans.smooth } : {}) }
    by.set(key, born)
    return born
  }
  const smoothen = (kinds: Uint16Array, size: readonly [number, number, number], born: Born) => {
    smoothing.set(born, [])
    const key = ++smoothAsked
    smoothKeys.set(key, born)
    ensureSmoother().postMessage({ key, raw: kinds.slice(), size: [size[0], size[1], size[2]], reach: 5 })
  }
  let smoothAsked = 0
  const smoothKeys = new Map<number, Born>()
  const alive = living({
    body: () => { const f = me.feet; return f ? [f.at[0], f.at[1] + 10, f.at[2]] : null },
    kind: (x, y, z) => core.world_kind(x, y, z),
    send: (ask) => { if (!far) mover.postMessage(ask) },
    wake: () => { bodies = Math.max(bodies, 1) },
    piece: (id) => moving.get(id),
    look: (kinds, size, opts) => {
      const key = size.join()
      let by = lookFaces.get(kinds); if (!by) lookFaces.set(kinds, by = new Map())
      let born = by.get(key)
      if (!born) {
        // When wheel-well carving creates a new array from a street car's uncarved cells, reuse the pre-built smooth
        // Born immediately (avoiding a 20-100ms main-thread `thing()` stall on crash/wake) and refit once the worker finishes.
        const pre = opts?.fallback ? lookFaces.get(opts.fallback)?.get(key) : undefined
        if (pre) {
          born = { ...pre, com: [...pre.com], low: [...pre.low] }
          by.set(key, born)
          if (opts?.smooth !== false) smoothen(kinds, size, born)
        } else {
          born = thing(kinds, size)
          by.set(key, born)
          if (!born.smooth && opts?.smooth !== false) smoothen(kinds, size, born)
        }
      }
      const piece = falling.add({ ...born, com: [...born.com], low: [...born.low] })
      piece.skin = kinds
      smoothing.get(born)?.push(piece)
      return piece
    },
    input: controls, hud: over, pose,
    ground: (x, z) => core.ground_at(Math.round(x * M), Math.round(z * M)) / M,
    world: far, made: () => made,
    ridden: (on) => { if (on) { wasAfoot = me.on; if (wasAfoot) me.walk(false) } else if (wasAfoot) { wasAfoot = false; me.walk(true) } },
    dropped: (id) => moving.delete(id),
    lens: (fovAdd, rollAdd, energy, driftBlur = 0) => { driveFov = fovAdd; driveRoll = rollAdd; driveEnergy = energy; driveDrift = driftBlur },
    fx: {
      smoke: (at, vel, intensity, colour) => smoke.tireSmoke(at, vel, intensity, colour),
      exhaust: (at, dir, pop, boost) => smoke.exhaust(at, dir, pop, boost),
      track: (wheel, at, strength, colour) => roadTracks.mark(wheel, [at[0], groundUnder(at[0], at[1] + 6, at[2]), at[2]], strength, colour),
      lift: (wheel) => roadTracks.lift(wheel),
      light: (at, dir, size, colour, alpha) => roadTracks.spill({ at, dir, size, colour, alpha }),
      sparks: (at, strength) => { debris.burst(at, 1.6, Math.round(5 + strength * 9), [1.0, 0.68, 0.16], 0.12, 0.42, 0.6 + strength * 0.45, true); smoke.glint(at, 4.5 + strength * 5.5) },
      // A hard crash (#37, #62): road dust, tight wreck cluster of painted body chips, dark bumper trim pieces, and glinting glass shards near the impact.
      crash: (at, strength, kind, glass) => {
        const c = hue(kind)
        smoke.crash(at, strength)
        debris.burst(at, 1.1, Math.round(2 + strength * 2), [c[0] * 0.92, c[1] * 0.92, c[2] * 0.92], 0.26, 15, 0.08 + strength * 0.06, true)
        debris.burst(at, 1.1, Math.round(1 + strength * 2), [0.06, 0.06, 0.07], 0.30, 15, 0.07 + strength * 0.05, true)
        if (glass) debris.burst([at[0], at[1] + 0.8, at[2]], 1.0, Math.round(2 + strength * 3), [0.48, 0.55, 0.60], 0.20, 14, 0.09 + strength * 0.06, true)
      },
      engine: (at, level, dt, source) => smoke.engine(engineVent(source, at), level, dt, engineOut(source)),
      rain: () => march.rain,
      day: () => march.day,
      surface: (x, z) => core.top_at(x, z) & 15,
    },
    audio: {
      drive: (v) => ears?.drive(v),
      event: (kind, force) => ears?.carEvent(kind, force),
      horn: (on) => ears?.horn(on),
      radio: (action) => { if (action === 'cycle') ears?.radio.cycle(1); else if (action === 'next') void ears?.radio.nextTrack(); else if (action === 'prev') void ears?.radio.prevTrack(); else if (action === 'open') openRadioPicker(); else ears?.radio.setDriving(action === 'enter') },
    },
  })
  const stuntHud = stunts({ alive, hud: over, sound: () => ears?.voice ?? null })
  /** Where under each living thing the ground is darkened (under.ts): its footprint, turned as it is, and how far it is off the ground. */
  const shades = () => alive.things.flatMap((t) => {
    const w = alive.where(t)
    if (!w) return []
    // Its turn about y: where its own x points (the turn's first column).
    const top = groundUnder(w.at[0], w.at[1], w.at[2]), q = w.rot
    return [{ at: w.at, yaw: Math.atan2(-2 * (q[0] * q[2] - q[1] * q[3]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])), half: [t.size[0] / 2, t.size[2] / 2] as const, high: t.size[1], lift: Math.max(0, w.at[1] - t.size[1] / 2 - top) }]
  })
  /** Active drivable wheeled vehicles fed to the 3D wheel pass (wheels.ts). */
  const wheelVehicles = (): WheelVehicle[] => {
    const out: WheelVehicle[] = []
    const drive = alive.wheelDrive
    for (const t of alive.things) {
      if (!t.alive || t.motor.feet.length < 2 || (t.controls ?? 'drive') !== 'drive' || (t.motor.steer === 0 && t.motor.upright > 0)) continue
      const piece = moving.get(t.id)
      if (!piece) continue
      const active = drive && drive.id === t.id ? drive : null
      const st = !active && t.state ? t.state : null
      const stBrake = st && ((st.go < -0.1 && st.speed > 8) || (st.go > 0.1 && st.speed < -8)) ? Math.min(1, Math.abs(st.go)) : 0
      const deform = alive.damage(t)
      const look0 = deform && deform.dentCount > 0 ? (t.fine?.[0] ?? t.kept?.[0]) : undefined
      out.push({
        id: t.id, pos: piece.pos, rot: piece.rot, size: t.size, low: t.low,
        bornLow: piece.born.low, bornCom: piece.born.com,
        front: t.motor.front, steerLimit: t.motor.steer, topSpeed: t.motor.top,
        feet: t.motor.feet, hasFine: !!(t.fine?.length || t.kept?.length), profile: t.wheelProfile,
        ...(look0 && deform ? { deform, fineLow: look0.low, finePer: look0.per } : {}),
        ...(active ? { steerInput: active.steer, throttle: active.throttle, brake: active.brake, handbrake: active.handbrake, fwdSpeed: active.fwdSpeed, latSpeed: active.latSpeed, slip: active.slip, drifting: active.drifting, burnout: active.burnout, decel: active.decel } : st ? { steerInput: st.turn, throttle: st.go, brake: stBrake, handbrake: st.rise > 0.1, fwdSpeed: st.speed } : {}),
      })
    }
    return out
  }
  /** The top of what is under a place, looked for down from `y` (cells): a kerb, a roof, a bridge as well as the ground. */
  const groundUnder = (x: number, y: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z), iy = Math.floor(y)
    if (core.world_under) {
      const hit = core.world_under(ix, iy, iz, 40)
      if (hit !== -2147483648) return hit
      return core.ground_at(Math.round(x), Math.round(z))
    }
    for (let at = iy, end = at - 40; at > end; at--) if (core.world_kind(ix, at, iz)) return at + 1
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
    if (!far && (bodies > 0 || burning > 0 || running) && !ticking) { ticking = true; tickSentAt = performance.now(); tickAt = frameAt; tickTook = owed; mover.postMessage({ tick: owed * tempo.rate } satisfies Ask); owed = 0 }
    if (!far && (silent(moverWorker) > moverPatience || (ticking && tickSentAt > 0 && performance.now() - tickSentAt > moverPatience))) {
      if (ticking && silent(moverWorker) <= moverPatience) report.notes.push(`mover stalled on step (${Math.round(performance.now() - tickSentAt)} ms)`)
      loseMover(moverWorker)
    }
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
    telemetry?.edit({ op: 'strike', at: [at[0], at[1], at[2]], radius, spark })
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
  // In the Bay in tiles the body's own core holds the ground round the eye too, asked again as it moves: without it a
  // person who got down in a shared world fell through a world their core did not have (#526).
  if (STREAM && shadow) { const tell = () => shadow.postMessage({ bay: [Math.round(pose.x * M), Math.round(pose.z * M)] } as never); tell(); setInterval(tell, 500) }
  // In a lobby (#526, arrival.ts): whoever joins is set down on their feet in a place of their own, round where the
  // host's world says one arrives if this page finds something to stand on there, else round the realm's meeting place
  // (local.ts `meet`), once the tiles there have come and the visitor is past the first view, if it is up (an address's
  // join): nothing moves under the still picture. Until then the keys move nothing; if the eye is moved from where the
  // page opened it anyway (the console, a check), it is left where it was put. `engine.arrival` says how it went.
  const arrival: { state: 'waiting' | 'standing' | 'eye' | 'moved'; round?: 'host' | 'own'; at?: number[]; yaw?: number } = { state: 'waiting' }
  // (An address that says where the eye is, `?at=`, is kept as realms.ts keeps it: nothing is set down.)
  let arriving = joined && !query.has('at') ? controls.push({ name: 'arriving', solid: true }) : null
  const arrived = (state: typeof arrival.state) => { if (arrival.state === 'waiting') arrival.state = state; arriving?.(); arriving = null }
  // (A world that never says where one arrives, in a minute: the keys are given back, and the eye stays.)
  let settling = false
  if (joined) setTimeout(() => { if (!settling) arrived('eye') }, query.has('at') ? 0 : 60_000)
  // (Any move counts: nothing of the page's own moves the eye while the keys are held still, and a check may put it a metre off.)
  const openedAt = [pose.x, pose.y, pose.z], moved = () => Math.hypot(pose.x - openedAt[0], pose.y - openedAt[1], pose.z - openedAt[2]) > 0.05
  const settle = async (told: unknown) => {
    settling = true
    const [{ LENS, said, stand }, within] = await Promise.all([import('./arrival.ts'), lists()])
    const host = said(told), own = said(LOCAL?.meet ?? LOCAL?.arrive)
    if (!own) return arrived('eye')
    // A host that names no place sends the realm's own arrival (serve.mjs `groundWord`): the first view's eye, no place to stand.
    const landing = LOCAL?.arrive ? said(LOCAL.arrive) : null
    const named = host && within(host.x, host.z) && !(landing && Math.hypot(host.x - landing.x, host.z - landing.z) < 1) ? host : null
    const middles = named ? [named, own] : [own]
    for (const m of middles) { mover.postMessage({ bay: [m.x, m.z] } as never); shadow?.postMessage({ bay: [m.x, m.z] } as never) }
    await Promise.race([Promise.all(middles.map((m) => near(inner, m.x, m.z))), new Promise((r) => setTimeout(r, 20_000))])
    // A moment for where everyone already here stands to be heard; and the first view, if it is up, left.
    await new Promise((r) => setTimeout(r, 800))
    while (first && !first.engaged && arrival.state === 'waiting') await new Promise((r) => setTimeout(r, 200))
    if (arrival.state !== 'waiting') return
    if (moved()) return arrived('moved')
    const found = stand({ host: named, own, spot: joined!.spot, others: others?.standing() ?? [], ground: { within, feet: (x, z) => core.feet_at(Math.round(x), Math.round(z)), kind: (x, y, z) => core.world_kind(Math.floor(x), Math.floor(y), Math.floor(z)) } })
    if (!found) return arrived('eye')
    const [x, f, z] = found.at
    shadow?.postMessage({ bay: [x, z] } as never)
    Object.assign(pose, { x: x / M, y: (f + 18.5) / M, z: z / M, yaw: found.yaw, pitch: found.pitch })
    // The realm's own lens, not the first view's long one: whoever stands beside is in the picture.
    fov = canvas.clientHeight > canvas.clientWidth ? LENS.upright : LENS.wide
    me.view = 'behind'
    me.walk(true)
    // Its feet, once its core has said: where it was set down, or it is taken up and left an eye over that place.
    const stood = () => !!me.feet && Math.abs(me.feet.at[1] - f) <= 10 && Math.hypot(me.feet.at[0] - x, me.feet.at[2] - z) <= 10
    for (const until = performance.now() + 8000; performance.now() < until && !stood();) await new Promise((r) => setTimeout(r, 100))
    if (!stood()) { me.walk(false); Object.assign(pose, { x: x / M, y: (f + 16.5) / M, z: z / M }); return arrived('eye') }
    // The look from where the eye rides (behind and over the body; higher and further back on a phone held upright):
    // at the ground 10 m ahead of the feet, so that a wish made at once is made there and not down the hill beyond.
    // Where it rides turns on the look itself (person.ts `behindAt`), so the two are found together, from the feet;
    // not from where the eye is this frame, which may be on its way there still (the look then fell 10.4 or 11.4 m
    // ahead by which frame it was).
    const ax = x + Math.sin(found.yaw) * 100, az = z - Math.cos(found.yaw) * 100, ay = core.feet_at(Math.round(ax), Math.round(az))
    if (Number.isFinite(ay)) {
      let pitch = found.pitch
      for (let i = 0; i < 8; i++) { const eye = behindAt([x, f, z], found.yaw, pitch); pitch = Math.max(-0.6, Math.min(0.05, Math.atan2(ay - eye[1], Math.hypot(ax - eye[0], az - eye[2])))) }
      pose.pitch = pitch
    }
    Object.assign(arrival, { round: found.round, at: found.at, yaw: found.yaw })
    arrived('standing')
  }
  // Whoever rides from this page is seen in their seat (#367): from behind, the kart went up the street with nobody in it.
  // The page places its own rider each frame where the thing is, so they are not the tenth of a second behind that others see them.
  const seated: Person = { at: [0, 0, 0], yaw: 0, seed: seedOf(others?.name ?? 'me'), move: { move: NAMED.sit, t: 10 } }
  folk.from.push((_view, seconds) => { const r = alive.rider; if (!r || alive.inside) return []; /* With the eye brought right in over them (a wall behind), their own figure is not drawn in its way: as on foot. */ if (Math.hypot(pose.x * M - r.at[0], pose.y * M - r.at[1] - 12, pose.z * M - r.at[2]) < 9) return []; seated.at = r.at; seated.yaw = r.yaw; seated.time = seconds; seated.look = me.carry ? { ...(me.limbs.look ?? {}), carry: me.carry } : me.limbs.look; return [seated] })
  controls.always('KeyB', () => { me.walk(!me.on); return true })
  // ── 3D Minimap, Full-Screen Map & GPS Navigation ────────────────────────
  let mapLastX = pose.x, mapLastZ = pose.z, mapLastT = performance.now(), mapSpeed = 0
  let townCenter: [number, number] | null = null
  let entryCtrl: import('./entry.ts').EntryController | null = null
  let sfMapPromise: Promise<boolean> | null = null
  let sfPlacesPromise: Promise<PlacesPayload | null> | null = null
  const ensurePlacesPayload = (): Promise<PlacesPayload | null> => {
    if (!BAY_ON) return Promise.resolve(null)
    return (sfPlacesPromise ??= placesData().then((buf) => {
      if (!buf) { sfPlacesPromise = null; return null }
      try {
        const parsed = JSON.parse(new TextDecoder().decode(buf)) as PlacesPayload
        if (!parsed || !Array.isArray(parsed.shops) || !Array.isArray(parsed.plazas)) { sfPlacesPromise = null; return null }
        mapSys?.setPlacesData(parsed)
        return parsed
      } catch {
        sfPlacesPromise = null
        return null
      }
    }).catch(() => { sfPlacesPromise = null; return null }))
  }
  const loadSfMap = (tries: number): Promise<boolean> => mapData().then((bytes) => {
    const parsed = bytes ? parseMap(bytes, LOCAL?.name ?? 'San Francisco') : null
    if (parsed) { mapSys?.setMapData(parsed); void ensurePlacesPayload(); return true }
    if (tries > 1) return new Promise<boolean>((r) => setTimeout(() => void loadSfMap(tries - 1).then(r), 8000))
    return false
  })
  const ensureMap = (): Promise<boolean> => {
    if (mapSys?.ready) { void ensurePlacesPayload(); return Promise.resolve(true) }
    if (!BAY_ON) { townCenter = [pose.x, pose.z]; mapSys?.setMapData(buildTownMap(core, pose.x, pose.z)); return Promise.resolve(true) }
    return (sfMapPromise ??= loadSfMap(3).then((ok) => { if (!ok) sfMapPromise = null; return ok }))
  }
  const classicVisit = async (x: number, z: number, name: string) => {
    const gx = Math.round(x * M), gz = Math.round(z * M)
    over.notice(`Going to ${name}…`, 2500)
    if (alive.riding) alive.mount(null)
    if (me.on) me.walk(false)
    if (STREAM) {
      mover.postMessage({ bay: [gx, gz] } as never)
      shadow?.postMessage({ bay: [gx, gz] } as never)
      await Promise.race([underfoot(inner, gx, gz), new Promise((r) => setTimeout(r, 6000))])
      void near(inner, gx, gz)
    }
    const floor = Math.max(core.ground_at(gx, gz), core.feet_at(gx, gz)) / M
    Object.assign(pose, { x, y: Math.max(12, floor + 22), z, pitch: -0.22 })
    over.notice(`Arrived at ${name}`, 3000)
  }
  mapSys = createMapSystem({
    device, format: gpu.format, input: controls, hud: over,
    day: () => march.day,
    engaged: () => first?.engaged ?? true,
    paused: () => paused,
    player: () => {
      const r = alive.rider, f = me.feet
      const x = r ? r.at[0] / M : f ? f.at[0] / M : pose.x
      const y = r ? r.at[1] / M : f ? f.at[1] / M : pose.y
      const z = r ? r.at[2] / M : f ? f.at[2] / M : pose.z
      // Heading: use rider yaw when driving, camera yaw when walking/flying so minimap rotates responsively with look!
      const yaw = r ? r.yaw : pose.yaw
      const now = performance.now(), dt = Math.max(0.016, (now - mapLastT) / 1000)
      if (dt > 0.04) {
        const inst = Math.hypot(x - mapLastX, z - mapLastZ) / dt
        mapSpeed += (Math.min(120, inst) - mapSpeed) * 0.25
        mapLastX = x; mapLastZ = z; mapLastT = now
      }
      const tel = alive.telemetry
      const liveSpeed = tel ? tel.kmh / 3.6 : mapSpeed
      return { x, y, z, yaw, speed: liveSpeed, driving: !!r, flying: !r && !me.on, drifting: tel?.drifting ?? false, slip: tel?.slip ?? 0 }
    },
    onEngage: () => { void ensureMap() },
    onOpen: () => { entryCtrl?.cancelDive() },
    onVisit: async (x, z, name, cam) => {
      if (entryCtrl) await entryCtrl.visit(x, z, name, cam)
      else await classicVisit(x, z, name)
    },
  })
  watchers.add((gap) => {
    mapSys?.frame(gap / 1000)
    if (!BAY_ON && townCenter && Math.hypot(pose.x - townCenter[0], pose.z - townCenter[1]) > 650) {
      townCenter = [pose.x, pose.z]
      mapSys?.setMapData(buildTownMap(core, pose.x, pose.z))
    }
  })
  controls.always('KeyM', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false
    if (e.shiftKey) { flags ^= MIRRORS; return true }
    if (first && !first.engaged) return false
    mapSys?.toggle()
    return true
  })
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
  const gaze = (): { eye: [number, number, number]; toward: [number, number, number]; feet?: [number, number, number] } => { const v = view(), f = me.on ? me.feet : null; return { eye: [Math.round(v.eye[0]), Math.round(v.eye[1]), Math.round(v.eye[2])], toward: [v.forward[0], v.forward[1], v.forward[2]], ...(f ? { feet: [Math.round(f.at[0]), Math.round(f.at[1]), Math.round(f.at[2])] as [number, number, number] } : {}) } }
  // A realm the page runs alone, whose rules allow it (local.ts `making`): things are made in the page itself, by the
  // engine's own maker (page/maker.ts), fetched once the bar is first used in the realm. Elsewhere: the helper.
  // In a lobby joined through a door (#526) the same: the maker asks the world on the host's machine, as this page's person.
  const makesHere = MAKING && (!far || !!joined)
  /** The model the maker asks (`engine.making.model`: { system, prompt, pictures } to { text }): the visitor's own, through page/connect.ts, set below; null: none, and the bar says so. */
  const makingSeam: { model: import('./maker.ts').Model | null } = { model: null }
  const wishes = makesHere ? later(() => import('./maker.ts').then(({ pageMaker }) => pageMaker({
      core, made, alive, eye: gaze, by: () => joined?.you ?? 'visitor', hud: over, ...(joined ? { lobby: { fetch: joined.fetch, may: () => joined.may() } } : {}), shelf: new URL('shelf/', location.href).href, core_url: new URL('./core.wasm', import.meta.url).href, hold: (x, z) => underfoot(inner, x, z), model: () => makingSeam.model,
      // As the page lays its own: finer cells only where every box of the world they reach takes them (`taken`).
      lay: (edit, at) => { if (edit.words[0] < 3) { make(edit, at); return true } put(); if (!taken(edit)) return false; waiting++; mover.postMessage({ edit: edit.words, after: heard, release: at } satisfies Ask); return true },
    }))) : asker(gaze, () => others?.name ?? 'someone')
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
  // The visitor's own AI (#526, page/connect.ts): asked for what nothing kept answers, fetched the first time it is needed.
  let connected: Promise<import('./connect.ts').Connect> | null = null
  let asking: import('./ask.ts').Ask | null = null
  if (makesHere) wish.on((stage, ask) => { if (stage.stage === 'asking') asking = ask; else if (stage.stage === 'done' && ask === asking) asking = null })
  const connecting = () => (connected ??= import('./connect.ts').then(({ connect }) => connect({ hud: over, input: controls, wish, asking: () => asking }), (e) => { connected = null; throw e }))
  if (makesHere) {
    const model: import('./maker.ts').Model = (q, tell) => connecting().then((c) => c.ask(q, tell))
    model.ready = (ask) => connecting().then((c) => c.ready(ask))
    makingSeam.model = model
  }
  /** What is seen at the place meanwhile: the world's loose cells gathering there (gather.ts). */
  const gathering = gather(debris, smoke, wish, made)
  // What is kept, shown as a ghost where it would stand while its words are typed (#220).
  const ghost = kept(over, wishes, falling, wish)
  over.line.starters = ['a market stall with a striped awning', 'a red telephone box', 'a park bench under a lamp', 'a fountain']
  // What the bar says Enter will do is what making will do with the words (making.ts `says`).
  over.line.means = (text) => wish.says(text)
  // A realm whose rules allow no models has no bar to type a wish on (local.ts): spells from the kept library are cast with the wand.
  // One that makes things in the page has it once the visitor is in the realm, starting from what is kept.
  const askBar = document.querySelector<HTMLElement>('#ask')
  if (!RULES.models && !makesHere) askBar?.style.setProperty('display', 'none')
  if (makesHere) { over.line.starters = []; first?.during(() => { askBar?.style.setProperty('display', 'none'); return () => askBar?.style.removeProperty('display') }) }
  over.line.onask = (ask) => {
    if (makesHere) return void wish(ask)
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
    far, began, ...(joined ? { land: (a: unknown) => void settle(a) } : {}),
    leave: (trade) => {
      // On foot, the body is taken up first: its own core is about to forget the world it stands on, and it is set down again on arriving.
      afoot = me.on
      // Taking the body up lets go of every key (input.ts `push`): those held to move are held still when it is set down.
      heldKeys = afoot ? ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].filter((code) => controls.held(code)) : []
      if (afoot) me.walk(false)
      shadow?.postMessage({ forget: true })
      for (const piece of moving.values()) piece.destroy()
      for (const l of lying) l.piece.destroy()
      moving.clear(); lying = []; putting = []; asked.length = 0; shocks.length = 0; cuts.length = 0; placedLamps.length = 0
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
    telemetry?.edit({ op: 'ignite', at, radius })
    // The answer says how many cells burn, which is what keeps the mover asked from then on.
    ticking = true
    mover.postMessage({ ignite: at, radius, tick: 0 } satisfies Ask)
    return { at, ...hit }
  }

  /** A cannon's shot: a steel ball 80 cm across, sent the way the eye looks at 42 m a second. What it strikes breaks. */
  const shoot = () => {
    const v = view()
    const from: [number, number, number] = [v.eye[0] + v.forward[0] * 14, v.eye[1] + v.forward[1] * 14, v.eye[2] + v.forward[2] * 14]
    const vel: [number, number, number] = [v.forward[0] * 420, v.forward[1] * 420, v.forward[2] * 420]
    telemetry?.edit({ op: 'shoot', from, speed: vel, radius: 4 })
    mover.postMessage({ ball: { from, speed: vel, radius: 4, kind: 12 | (5 << 8) } } satisfies Ask)
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
    telemetry?.edit({ op: 'cut', at, radius: reach })
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
    telemetry?.edit({ op: 'place', at, radius: 5, kind: 8 | (30 << 8) })
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
  own.use = () => { const { name, use } = tools[tool]; void Promise.resolve(use()).then((hit) => { telemetry?.event('tool', { name, ...(hit && typeof hit === 'object' ? { at: (hit as { at?: number[] }).at, material: (hit as { material?: number }).material } : {}) }); ears?.used(name, hit as Parameters<NonNullable<typeof ears>['used']>[1]) }); return true }

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
  if (joined) Object.assign((globalThis as unknown as { engine: object }).engine, { lobby: joined.lobby, arrival })
  // In a lobby: whose server this is in the corner, who is here, what it says, the way out (lobbies.ts).
  if (joined) void import('./lobbies.ts').then((l) => l.inside({ master: MASTER!, hud: over, input: controls, door: joined }))
  Object.assign((globalThis as unknown as { engine: object }).engine, { kept: ghost })
  // The last thing made in this page, taken out again (page/maker.ts; "undo" on the bar does the same).
  if (makesHere) Object.assign((globalThis as unknown as { engine: object }).engine, { unmake: () => wishes.rule('', { undo: true }), making: makingSeam })
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
   * The windows of the far model the eye sees now, as the eggs' lockers know them (#450, lockers.ts `Key`): for each,
   * its key and style, how many pixels of a picture `size` big its bay covers and how many of them are its glass, the
   * box they lie in (pixels from the top left), and where its glass is (cells: the middle of the points of it). Only
   * walls with windows, and only windows with at least `least` pixels of glass. For sf/lockers.mjs, which places them.
   */
  const lockerWindows = async (size: [number, number], least = 4) => {
    const v = view(), to = offscreen(gpu, size), row = Math.ceil((size[0] * 16) / 256) * 256
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    const keys = device.createTexture({ size, format: 'rgba32uint', usage }), at = device.createTexture({ size, format: 'rgba32float', usage })
    const read = [0, 1].map(() => device.createBuffer({ size: row * size[1], usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }))
    paused = true
    const encoder = device.createCommandEncoder()
    march.draw(encoder, to, v, PICK, 0)
    await farModel.drawKeys(encoder, keys.createView(), at.createView(), to.depth, size, v)
    encoder.copyTextureToBuffer({ texture: keys }, { buffer: read[0], bytesPerRow: row }, size)
    encoder.copyTextureToBuffer({ texture: at }, { buffer: read[1], bytesPerRow: row }, size)
    device.queue.submit([encoder.finish()])
    await Promise.all(read.map((r) => r.mapAsync(GPUMapMode.READ)))
    const k = new Uint32Array(read[0].getMappedRange()), p = new Float32Array(read[1].getMappedRange())
    const seen = new Map<string, { key: [number, number, number, number]; style: number; bay: number; glass: number; sum: [number, number, number]; box: [number, number, number, number] }>()
    for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
      const i = (y * row) / 4 + x * 4, w = k[i], flags = w >>> 28
      if (!(flags & 1)) continue
      const key: [number, number, number, number] = [w & 0xffffff, (w >>> 24) & 7, k[i + 1] | 0, k[i + 2] | 0], name = key.join()
      let f = seen.get(name)
      if (!f) seen.set(name, (f = { key, style: k[i + 3], bay: 0, glass: 0, sum: [0, 0, 0], box: [x, y, x, y] }))
      f.bay++
      f.box = [Math.min(f.box[0], x), Math.min(f.box[1], y), Math.max(f.box[2], x), Math.max(f.box[3], y)]
      if (flags & 2) { f.glass++; f.sum[0] += p[i]; f.sum[1] += p[i + 1]; f.sum[2] += p[i + 2] }
    }
    read.forEach((r) => { r.unmap(); r.destroy() }); keys.destroy(); at.destroy(); to.destroy()
    paused = false
    return [...seen.values()].filter((f) => f.glass >= least).map(({ key, style, bay, glass, sum, box }) => ({ key, style, bay, glass, box, at: sum.map((s, a) => Math.round((v.eye[a] + s / glass) * 10) / 10) }))
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
  Object.assign((globalThis as unknown as { engine: object }).engine, { fine, fineEdit, fineRest, falling, passes, far: farModel, farIds, lockerWindows, farPasses, pause: (on: boolean) => { paused = on } })
  // How thick the marine layer is, 0 to 1 (fog.ts): a property, as the hour and the rain are.
  Object.defineProperty((globalThis as unknown as { engine: object }).engine, 'fog', { get: () => marine.strength, set: (v: number) => { marine.strength = Math.max(0, Math.min(1, v)) } })

  // `?living=car` (or `?living=finecar`): a fine-look car to drive stands in the street ahead of where the page starts, with no console needed (#61).
  if (query.get('living') === 'car' || query.get('living') === 'finecar') void (async () => {
    if (far) while (!far.live) await new Promise((done) => setTimeout(done, 100))
    // In a shared world one is enough: whoever comes later finds the one that is there.
    if (far && [...made.all.values()].some((t) => t.name === 'car')) return
    const x = Math.round(pose.x * M) + 60, z = Math.round(pose.z * M) + 4
    await alive.spawn(car([x, core.ground_at(x, z) + 5, z]))
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
    for (const square of await streets([x, z], 3200).catch(() => [])) for (const way of square.ways) for (let i = 1; i < way.line.length; i++) {
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
    if (!keptFiles.has(k.file)) keptFiles.set(k.file, fetch(new URL(k.file, location.href)).then((r) => (r.ok ? r.json() : null)).then(async (m: Kept | null) => {
      if (!m) return null
      const cells = unrun(m.body, m.size[0] * m.size[1] * m.size[2], Int32Array)
      const fine = m.fine ? await Promise.all(m.fine.map(async (f, i) => {
        // Decode high-res fine vehicle cells & faces off the main thread so boot/landing never stalls (#129).
        const decoded = await askSmoother({ runs: f.runs, kinds: f.palette, size: f.size, cells: true })
        const fineCells = decoded.cells ?? unrun(f, f.size[0] * f.size[1] * f.size[2], Uint16Array)
        await prebakeLook(fineCells, f.size, !(i > 0 && f.per > 4))
        return { size: f.size, per: f.per, low: f.low, cells: fineCells }
      })) : undefined
      return { ...m, cells, fine }
    }, () => null))
    const making = await keptFiles.get(k.file)
    if (!making) return null
    // Over the ground where it stands (bay.ts has the tiles there by now: the realm begins beside it), or at the
    // kerb of a street near there.
    const spot = k.kerb ? (parked.get(k.file) ?? parked.set(k.file, await kerbside(k.at[0], k.at[2], making.size)).get(k.file)) : null
    // A kerb's spot says the highest ground under it.
    const [x, , z] = spot ?? k.at, low: [number, number, number] = [Math.round(x - making.size[0] / 2), Math.max(k.at[1], (spot ? spot[1] : core.ground_at(x, z)) + 2), Math.round(z - making.size[2] / 2)]
    return alive.spawn({ ...making, low })
  }))
  // Defer kept-car spawn (`setDown`) until after `seen.near` so `fine.ts` `thing()` never stalls boot or first control (#83).
  if (LOCAL?.street && lively && !far) {
    const nearMissWhoosh: Patch = { how: 'struck', hard: 0.1, rough: 1, shape: 'lump', pitch: 95, ring: 0.04, damp: 0.95, air: { from: 1800, to: 220, for: 0.28, gain: 0.9, q: 1.1 }, gain: 0.55 }
    // Sculpt robotaxis off the page thread in robotaxi-maker.ts right after first picture (#83).
    const robotaxis = firstPicture.then(() => new Promise<readonly RobotaxiModel[]>((resolve) => {
      const w = new Worker(new URL('./robotaxi-maker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<RobotaxiModel[]>) => { w.terminate(); adoptRobotaxiModels(e.data); resolve(e.data) }
      w.onerror = () => { w.terminate(); resolve(ROBOTAXI_SERVICES.map(buildRobotaxiModel)) }
    }))
    const life = streetOf({
      life: new URL(LOCAL.street.life, location.href), cars: new URL(LOCAL.street.cars, location.href), land: core, fine: (x, z) => !STREAM || holds(inner, x - 40, z - 40, x + 40, z + 40, 1), hour: () => hour ?? 11, rain: () => march.rain, lights: () => march.lights, clock: () => folkClock.now(), shocks, cuts, bodies: () => inTheWay(), feet: () => me.feet?.at ?? null, pieces: falling, alive, hud: over, input: controls,
      faces: (kinds, size, born) => { let by = lookFaces.get(kinds); if (!by) lookFaces.set(kinds, by = new Map()); by.set(size.join(), born) },
      robotaxis,
      onNearMiss: (info) => {
        const intensity = Math.min(1, Math.max(0.35, (info.speedKmh - 55) / 110) * (1.2 - info.clearance * 0.25))
        ears?.voice.play(nearMissWhoosh, { at: info.at, force: intensity, size: 1.15, reach: 16, travels: false })
        window.dispatchEvent(new CustomEvent('voxelwright:nearmiss', { detail: info }))
      },
      onCrash: (info) => {
        debris.burst(info.at, 2.5, Math.round(8 + info.force * 16), [1.0, 0.72, 0.18], 0.35, 1.4, 0.85 + info.force * 0.5)
        smoke.glint(info.at, 4 + info.force * 6)
        ears?.carCrash(info.at, info.force, info.speed)
        window.dispatchEvent(new CustomEvent('voxelwright:crash', { detail: info }))
      },
      onHorn: (info) => {
        ears?.trafficHorn(info.at, info.annoyed)
      },
      onShout: (info) => {
        window.dispatchEvent(new CustomEvent('voxelwright:robotaxi-shout', { detail: info }))
      },
    })
    streetLife = life
    if (landing && first && !first.engaged) life.enabled = false
    if (query.get('people') !== '0') folk.from.push(life.folk)
  }
  if (BAY_ON && !far && query.get('neighborhood') !== '0') {
    void firstPicture.then(() => createNeighborhood({
      device, format: gpu.format, pieces: falling, land: core,
      hour: () => hour ?? 11, rain: () => march.rain, clock: () => folkClock.now(), shocks,
      load: placesData,
      loadPayload: ensurePlacesPayload,
    })).then((n) => {
      neighborhood = n
      if (landing && first && !first.engaged) n.enabled = false
      if (query.get('people') !== '0') folk.from.push(n.folk)
    }).catch((e: unknown) => { console.warn(`no neighborhood places: ${e instanceof Error ? e.message : String(e)}`) })
  }
  // The realm's billboards and the banner its plane tows (#450, boards.ts): where each stands is the realm's record
  // (sf/boards.json). Laid as edits of the world, so every tool breaks them; reset lays them again. The page goes on
  // without them if they cannot be made. `?boards=0` leaves them out, `?boards=edit` opens their editor (sf/boards.mjs).
  const signboards = LOCAL?.signs && !far && query.get('boards') !== '0' ? await boards({
    file: LOCAL.signs, device, format: gpu.format, passes: pluginDraws, pieces: falling,
    lay: (edit) => { put(); change(edit, false); mover.postMessage({ edit: edit.words, after: heard } satisfies Ask) },
    // Their letters are cells: the far model's wedge, which takes over from 100 m, leaves their box to them.
    kept: (box) => farModel.keep(box),
    lights: () => march.lights, letters: (data) => march.letters(data),
    reach: () => farModel.reach * M, handover: (x, z) => (farModel.reach > 0 ? farModel.handover(x, z) : Infinity),
    cell: (x, y, z) => { const p = [x, y, z]; for (const l of world.levels) { const size = SIDE << l.index; if (p.every((v, a) => v >= l.origin[a] * size && v < (l.origin[a] + l.grid[a]) * size)) return 1 << l.index } return Infinity },
    done: () => world.done().length,
    kind: (x, y, z) => core.world_kind(x, y, z), feet: (x, z) => core.feet_at(x, z), ground: (x, z) => core.ground_at(x, z), top: (x, z) => core.top_at(x, z),
    pose, began, view, canvas, input: controls, hud: over, day: () => march.day, dull: () => Math.max(march.rain, march.cloud, 0.2 * march.fog), faced: () => farModel.depth, pick: () => march.pick(view()),
    aloft: () => { if (me.on) me.walk(false) }, edit: query.get('boards') === 'edit',
    does: (b) => { if (b.does !== 'explore' || !first || first.engaged) return false; enter(false); return true },
    home: firstEye, fov: () => fov, setFov: (v) => { fov = v },
    back: () => { if (way?.state !== 'in') return false; void way.back(); return true },
  }).catch((e: unknown) => { console.warn(`no billboards: ${e instanceof Error ? e.message : String(e)}`); return null }) : null
  Object.assign((globalThis as unknown as { engine: object }).engine, { boards: signboards, first })
  // The first view is the picture with the site's name on the banner: until the visitor engages its plane is kept in
  // the picture (boards.ts `call`), and after that it goes round as it will, unless an egg has something to say on it.
  const plane = signboards?.plane
  if (first && plane) first.during(() => { plane.call(true); return () => plane.call(false) })
  // The page that holds the realm in a frame is told when the place is shown (host.ts), with its boards if it has any.
  if (LOCAL) void nearPicture.then(() => {
    signboards?.plane?.begin()
    loading.done()
    tell('ready', { boards: signboards?.listed() ?? [], signs: signs.list().map((s) => ({ id: s.id, kind: s.kind, accepts: s.accepts })) })
    if (LOCAL?.kept?.length && !far) setTimeout(() => void setDown(), 0)
  })
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
    roadTracks.clear()
    carWheels.clear()
    if (afoot) me.walk(false)
    mover.postMessage({ forget: true } satisfies Ask)
    moverAge++
    for (const piece of moving.values()) piece.destroy()
    for (const l of lying) l.piece.destroy()
    moving.clear(); lying = []; putting = []; asked.length = 0; shocks.length = 0; cuts.length = 0; placedLamps.length = 0
    heard = 0; waiting = 0; bodies = 0; burning = 0; running = false; ticking = false; owed = 0; flames = new Float32Array(0)
    spoiled.push(...world.swap([]))
    farModel.forget()
    core.world_forget()
    streetLife?.reset()
    neighborhood?.reset()
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
    roadTracks.clear()
    carWheels.clear()
    if (afoot) me.walk(false)
    for (const piece of moving.values()) piece.destroy()
    for (const l of lying) l.piece.destroy()
    moving.clear(); lying = []; putting = []; asked.length = 0
    heard = 0; waiting = 0; bodies = 0; burning = 0; running = false; ticking = false; tickSentAt = 0; owed = 0; flames = new Float32Array(0)
    if (STREAM) mover.postMessage({ bay: [Math.round(ahead ? ahead[0] : pose.x * M), Math.round(ahead ? ahead[2] : pose.z * M)] } as never)
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
    keptGraphics()
    const windowEffectSetting = document.body.hasAttribute('data-egg-media') ? { modes: WINDOW_EFFECTS, get: () => windowEffect, set: (m: WindowEffect) => setWindowEffect(m) } : undefined
    const realmUi = realmControls({ march, controls, hour: () => hour, setHour, east: () => pose.x * M, tools: tools.map((t) => t.name), tool: () => tool, pickTool, reset, watch: (each) => void watchers.add(each), graphics, windowEffect: windowEffectSetting, report: () => void feedback?.open(), driveControls: () => alive.touch.open(), install: pwa.install, say: () => (globalThis as unknown as { engine: { eggs?: { open(): void } } }).engine.eggs?.open(),
      // Light, Dark or San Francisco now (#524): only where the realm is lit as San Francisco is (its own light is the photograph's).
      modes: LOCAL.air?.sun ? { setSky, claim: () => (globalThis as unknown as { engine: { eggs?: { letSkyGo(): void } } }).engine.eggs?.letSkyGo(), weather: new URL('/weather', location.href).href, pinned: query.has('hour') || query.has('rain') || LOCAL.look?.hour !== undefined || LOCAL.look?.rain !== undefined } : undefined, ...(makesHere ? { ai: () => void connecting().then((c) => c.open()) } : {}), ...(query.get('sound') !== '0' ? { radio: () => openRadioPicker() } : {}),
      // The servers (#526, lobbies.ts): where the realm's rule allows lobbies and a master is known, out of any lobby; fetched when first pressed.
      ...(MASTER && !joined ? { servers: () => { if (agreed('list')) void import('./lobbies.ts').then((l) => l.open({ master: MASTER!, hud: over, input: controls, door: null })) } } : {}) })
    // Sync mobile status bar & desktop PWA titlebar theme-color to the live sky zenith, and hold Screen Wake Lock in play.
    watchers.add(() => pwa.theme.update({ day: march.day, cloud: march.cloud, fog: march.fog, rain: march.rain, ownSky: march.air.sky?.zenith ?? null }))
    if (first) first.during(() => { pwa.wakeLock.release(); return () => pwa.wakeLock.engage() })
    if (!first || first.engaged) pwa.wakeLock.engage()
    // In the first view the settings key is there, its panel folded behind it (#506, first.ts); as the visitor engages, the
    // panel is as it is unasked (explore.ts folds it again on the roof).
    // In a lobby it stays folded, as it is on the roof alone (#526).
    first?.during(() => { realmUi.fold(true); return () => { if (!joined) realmUi.rest() } })
    if (joined || directLL) realmUi.fold(true)
    Object.assign((globalThis as unknown as { engine: object }).engine, { pwa, realmControls: realmUi, graphics: { get presets() { return graphics.presets }, get preset() { return preset }, set preset(p: string) { graphics.set(p) }, /** The resolution: { scale, auto, target, fixed }; set with any of scale, auto and target, as the panel does. */ get resolution() { return graphics.resolution.get() }, set resolution(to: { scale?: number; auto?: boolean; target?: number }) { resolve(to) }, /** The screen's own frame, ms, as a target of 0 aims at. */ get screenMs() { return fastestMs }, /** Whether the scale is pinned (manual resolution, the address, a check), not the GPU's to steer. */ get pinned() { return fixed || held > 1e6 } } })
    Object.defineProperty((globalThis as unknown as { engine: object }).engine, 'windowEffect', { get: () => windowEffect, set: (m: WindowEffect) => setWindowEffect(m), configurable: true, enumerable: true })
    // The controls in play, kept off the body (#450, play-hud.ts): the wheel, or `?hud=context|quiet`, or `?hud=classic` for the realm's own as they were.
    const played = playHud({ ui: realmUi, me, input: controls, project, fine: FINE, tools: tools.map((t) => t.name), tool: () => tool, pickTool, watch: (each) => void watchers.add(each), engaged: () => first?.engaged ?? true, wand: staff, vehicle: () => alive.riding ? (alive.inside ? [] : alive.corners(alive.riding) ?? []) : null })
    playedHud = played
    Object.assign((globalThis as unknown as { engine: object }).engine, { playHud: played })
    // The landing's easter eggs (#450, eggs.ts): on the city's windows, its sky and the banner its plane tows
    // (signs.ts, boards.ts). Fetched once the park is shown, so that nothing of them is in the bytes before it.
    let hushed: AudioContext | null = null, said: { open(): void } | null = null
    // The eggs' line in the first view, where no key means what it means in the realm: Enter or the slash opens it and
    // does nothing else. Not from a key, a link or a field in focus (Enter on the board's button is the button's: it
    // asks for the way in), nor a key held until it repeats. What is typed is the line's, and its Enter shuts it.
    if (first && !first.engaged) addEventListener('keydown', (e) => {
      if (first.engaged || mapSys?.open || !said || e.repeat || e.metaKey || e.ctrlKey || e.altKey || !['Enter', 'NumpadEnter', 'Slash'].includes(e.code)) return
      if (e.target instanceof Element && e.target.closest('button, a, input, textarea, select, [contenteditable]')) return
      e.preventDefault()
      way?.disarm()
      said.open()
    })
    const leads = signboards?.records.find((b) => b.does === 'explore')
    if (!leads) noWayIn()
    const hatch = () => {
      if (!seen.near) return
      watchers.delete(hatch)
      // The kept sky, once the park is shown: the loader clears onto the day it was pictured in, and the clock goes on from there.
      realmUi.modes?.start()
      if (first && leads && signboards && !first.engaged) void Promise.all([import('./entry.ts'), lists()]).then(([{ createEntry }, within]) => {
        let sharedWarmed = false
        entryCtrl = createEntry({
          board: leads, boards: signboards, first, input: controls, canvas, pose, view, me, ui: realmUi, home: firstEye, alight: () => { if (alive.riding) alive.mount(null) },
          fov: () => fov, setFov: (v) => { fov = v },
          feet: (x, z) => core.feet_at(x, z),
          // Round the destination: this page's own core and the mover hold it, and the finest tiles the makers of sectors
          // will want there are fetched ahead of them (as far out as the boxes of cells up to 80 cm reach: bay.ts `need`).
          near: (x, z) => { mover.postMessage({ bay: [x, z] } as never); shadow?.postMessage({ bay: [x, z] } as never); return Promise.all([near(inner, x, z), warm(x, z, (grid[0] * SIDE * 8) / 2 + 96)]).then(([had]) => had) },
          focus: (at) => { ahead = at }, whole: () => world.stats.wanted === 0 && world.stats.stale === 0 && farModel.whole,
          shot: (by) => { shot = by }, watch: (each) => { watchers.add(each); return () => void watchers.delete(each) },
          hush: () => { deaf = true },
          map: mapSys,
          ensureMap,
          leaveFar: () => farModel.left(),
          prewarmShared: () => {
            if (sharedWarmed) return
            sharedWarmed = true
            farModel.left()
            if (BAY_ON && !marksAsked) markRoads(4)
            streetLife?.prewarm()
            carSummon.prewarm()
          },
          prewarmSpot: (xM, zM) => {
            streetLife?.warmAt(Math.round(xM * M), Math.round(zM * M))
          },
          ground: { within, feet: (x, z) => core.feet_at(Math.round(x), Math.round(z)), kind: (x, y, z) => core.world_kind(Math.floor(x), Math.floor(y), Math.floor(z)) },
          terrainAt: (x, z) => core.ground_at(Math.round(x), Math.round(z)),
          hold: (x, z) => { mover.postMessage({ bay: [x, z] } as never); shadow?.postMessage({ bay: [x, z] } as never); return STREAM ? underfoot(inner, x, z) : Promise.resolve(true) },
          day: () => march.day,
        })
        way = entryCtrl.explore
        Object.assign((globalThis as unknown as { engine: object }).engine, { explore: way, entry: entryCtrl })
        if (meant) void way.go()
        else if (askedAct) { askedAct = false; way.act() }
      }).catch((e) => { console.error('entry init failed:', e); noWayIn() })
      void import('./eggs.ts').then(({ eggs }) => {
        Object.assign((globalThis as unknown as { engine: object }).engine, { signs, eggs: said = eggs({
          device, march, controls, makes: makesHere, sky: realmUi.sky, ui: realmUi.root, hour: () => hour, setHour, ownLight, view, pose, signs,
          // (In the first view its plane is kept in the picture whatever an egg says: what starts and ends them is tapped there, eggs-first.ts.)
          callPlane: (on) => { const plane = signboards?.plane; if (plane) { plane.call(on || !!(first && !first.engaged)); plane.loud = on } }, planeSeen: () => { const plane = signboards?.plane; return plane ? plane.readable && (!plane.loud || plane.come >= 1) : true },
          mood: (m) => { if (m) mood.of = { grade: m.grade ? [m.grade[0], m.grade[1]] : null, tint: m.tint ? [m.tint[0], m.tint[1], m.tint[2]] : [1, 1, 1] }; mood.on = !!m },
          notice: (text, ms) => over.notice(text, ms), aspect: () => laid.w / Math.max(1, laid.h),
          watch: (each) => void watchers.add(each), onReset: (each) => void resetting.add(each), base: location.href,
          canvas, plane: () => signboards?.plane ?? null, calm: () => way?.disarm(), darkBoards: (on) => { if (signboards) signboards.dark = on }, still: firstStill,
          pieces: falling, hud: over, feet: () => me.feet?.at ?? null, ground: (x, z) => core.feet_at(Math.round(x), Math.round(z)), far: farModel, windowEffect: () => windowEffect,
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
  Object.defineProperties((globalThis as unknown as { engine: object }).engine, Object.getOwnPropertyDescriptors({ tiles: { tally, memory, water: seaAsked, where, device: DEVICE, hold: HOLD }, /** Dynamic local lights stats (vehicles, SF street lamps, systemic emissives; active preset budget). */ get localLights() { return march.localLights.stats }, /** The sun's maps' share of a frame (#73): what a tile was last measured to take on the GPU (`tileMs`), the share of a moving frame (`share`, ms), whether the eye moved in the last frame, and how many tiles it had room for and drew. */ sunRoom, /** Whether a thing the last step moved is drawn on to the time of the frame (#73, `drawAhead`; `?ahead=0` turns it off). */ get ahead() { return aheadOn }, set ahead(on: boolean) { aheadOn = on }, reset, local: LOCAL, rules: RULES, setDown, get street() { return streetLife }, get neighborhood() { return neighborhood }, seen, get fov() { return fov }, set fov(v: number) { fov = v }, /** Whether the first view left alone is drawn 30 times a second (`?rest=0` turns it off), and whether it is now. */ get rests() { return rests }, set rests(on: boolean) { rests = on }, get idling() { return resting }, watch: (each: (gap: number) => void) => { watchers.add(each); return () => watchers.delete(each) } }))
  // Realms (#264), on a line of their own.
  Object.assign((globalThis as unknown as { engine: object }).engine, { realms: realm, pieces: () => moving.size, look: () => ({ hour, rain: march.rain, ...realmLook }) })
  const carSummon = createCarSummon({
    land: core, alive, hud: over,
    origin: () => { const f = me.feet; return f ? { x: f.at[0], z: f.at[2], yaw: f.yaw } : { x: pose.x * M, z: pose.z * M, yaw: pose.yaw } },
    street: () => streetLife,
    ways: BAY_ON ? (at, r) => streets(at, r) : undefined,
    bakeCoupe: async (spec, coarserBy) => {
      const ans = await askSmoother({ sculptCoupe: spec, coarserBy, reach: 5 })
      return {
        cells: ans.cells!, size: ans.size!,
        coarseKinds: ans.coarseKinds!, coarseSize: ans.coarseSize!,
        faces: ans.faces, smooth: ans.smooth, filled: ans.filled,
      }
    },
    onPrewarm: (data, prebaked) => {
      const f0 = data.fine?.[0]
      if (prebaked?.faces && f0 && f0.cells instanceof Uint16Array) {
        const born: Born = {
          id: 0, cells: prebaked.filled ?? 0, low: [0, 0, 0],
          size: [f0.size[0], f0.size[1], f0.size[2]],
          com: [f0.size[0] / 2, f0.size[1] / 2, f0.size[2] / 2],
          faces: prebaked.faces,
          ...(prebaked.smooth ? { smooth: prebaked.smooth } : {}),
        }
        let by = lookFaces.get(f0.cells); if (!by) lookFaces.set(f0.cells, by = new Map())
        by.set(f0.size.join(), born)
        return
      }
      (data.fine ?? []).forEach((f, i) => {
        if (!(f.cells instanceof Uint16Array)) return
        void prebakeLook(f.cells, f.size, !(i > 0 && f.per > 4))
      })
    },
  })
  const summonCarNow = () => { telemetry?.event('summon'); return carSummon.summon() }
  own.keys.set('KeyG', () => { if (!alive.riding && !(first && !first.engaged) && !far) void summonCarNow() })
  // Mobile touch trigger for Summon Car (G): sleek 44x44 slim voxel key beside ✦ Make at bottom-left (play-hud.ts).
  const summonPanel = over.panel('summon')
  const summonBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'vx-button' })
  summonBtn.dataset.vxIcon = 'car'
  summonBtn.setAttribute('data-vx-icon-only', '')
  summonBtn.setAttribute('aria-label', 'Summon sports car')
  summonBtn.title = 'Summon sports car (G)'
  summonBtn.addEventListener('click', () => { if (!alive.riding && !(first && !first.engaged) && !far) void summonCarNow() })
  summonPanel.append(summonBtn)
  resetting.add(() => { carSummon.clear(); telemetry?.edit({ op: 'reset' }) })
  // Black-box gameplay flight recorder & passive anomaly watchers + F8 / /bug feedback UI (#64).
  telemetry = createRecorder({
    build: 'city-4',
    localRealm: LOCAL?.id ?? null,
    bay: BAY_ON,
    env: () => report.env,
    release: () => (BAY_ON ? where().then((s) => s.release, () => null) : Promise.resolve(null)),
    gpuFaults: () => gpu.faults,
    input: controls,
    pose,
    fov: () => fov,
    view,
    march,
    me,
    alive,
    street: () => streetLife,
    worldStats: () => world.stats,
    mended: () => ({ movers: moversLost, makers: world.stats.crashed }),
    tileFails: () => tally.failed,
    perf: () => ({ frameMs, gpuMs, cpuMs, workCpuMs, presentWaitMs, scale, bodies, loose: loose(), burning, resting, paused, mapOpen: !!mapSys?.opaque, firstStill: firstStill() }),
    settings: () => ({ hour, rain: march.rain, fog: marine.strength, graphics: preset, hud: (globalThis as unknown as { engine?: { playHud?: { mode: string | null } } }).engine?.playHud?.mode ?? null }),
    clock: () => folkClock.now(),
    groundAt: (x, z) => core.ground_at(x, z),
    topAt: (x, z) => core.top_at(x, z),
    worldKind: (x, y, z) => core.world_kind(x, y, z),
    whereLabel: () => document.querySelector('#where > div')?.textContent?.trim() ?? '',
    diagnostics: () => ({
      tiles: { ...tally },
      mover: { ticking, waitMs: ticking && tickSentAt > 0 ? Math.round(performance.now() - tickSentAt) : 0, bodies, waiting },
      workers: { ...world.workerHealth(), crashed: world.stats.crashed, lacking: world.stats.lacking },
      spent: Object.fromEntries(Object.entries(spent).map(([k, v]) => [k, Math.round(v * 10) / 10])),
      notes: report.notes.slice(-20),
    }),
    endpointBase: !LOCAL || query.get('telemetry') === '1' ? '' : null,
  })
  feedback = feedbackUi({ hud: over, input: controls, recorder: telemetry })
  // Living things, on a line of their own: every lane adds to the line above.
  Object.assign((globalThis as unknown as { engine: object }).engine, { alive, stunts: stuntHud, car, fineCar, me, tempo, shots: streaks, map: mapSys, summonCar: summonCarNow, wheels: carWheels, smoothing: () => smoothing.size, recorder: telemetry, feedback, set: (at: [number, number, number], radius: number, kind: number) => { telemetry?.edit({ op: 'set', at, radius, kind }); make(ball(at[0], at[1], at[2], radius, kind), at) }, replayEdit: (e: { op: string; at?: [number, number, number]; radius?: number; spark?: boolean; kind?: number; from?: [number, number, number]; speed?: [number, number, number] }) => { if (e.op === 'strike' && e.at) strike(e.at, e.radius ?? force, e.spark ?? sparks); else if (e.op === 'ignite' && e.at) { ticking = true; mover.postMessage({ ignite: e.at, radius: e.radius ?? 4, tick: 0 } satisfies Ask) } else if (e.op === 'shoot' && e.from && e.speed) { mover.postMessage({ ball: { from: e.from, speed: e.speed, radius: e.radius ?? 4, kind: 12 | (5 << 8) } } satisfies Ask); bodies = Math.max(bodies, 1) } else if (e.op === 'cut' && e.at) { const reach = e.radius ?? 44, runs: number[] = []; for (let dy = 0; dy < 2; dy++) for (let dz = -reach; dz <= reach; dz++) { const half = Math.floor(Math.sqrt(reach * reach - dz * dz)); runs.push(e.at[0] - half, e.at[0] + half + 1, e.at[1] + dy, e.at[2] + dz, 0) } make(rows(Int32Array.from(runs), [e.at[0] - reach, e.at[1], e.at[2] - reach, e.at[0] + reach + 1, e.at[1] + 2, e.at[2] + reach + 1]), e.at); cuts.push({ at: e.at, radius: reach }) } else if (e.op === 'place' && e.at) make(ball(e.at[0], e.at[1], e.at[2], e.radius ?? 5, e.kind ?? (8 | (30 << 8))), e.at); else if (e.op === 'set' && e.at) make(ball(e.at[0], e.at[1], e.at[2], e.radius ?? 5, e.kind ?? 0), e.at) } })
  // Native in-game T3 Studio & Game-Use runtime (#98): local dev only; computed URL keeps it out of static sf/build.mjs deploys.
  const studioWanted = query.get('studio') !== '0' && (query.get('studio') === '1' || /(?:^|#|&)studio=/.test(location.hash) || (!navigator.webdriver && !!document.querySelector('meta[name="vw-studio"]')))
  if (!LOCAL && studioWanted) {
    const studioEntry = ['./studio', 'index.ts'].join('/')
    void import(studioEntry).then((m: { bootStudio: (o: { engine: unknown; canvas: HTMLCanvasElement }) => Promise<unknown> }) =>
      m.bootStudio({ engine: (globalThis as unknown as { engine: unknown }).engine, canvas }),
    ).catch((e: unknown) => console.warn(`studio: ${e instanceof Error ? e.message : String(e)}`))
  }
  // The portal (#264, portal.ts), an experiment: a second world like this one, marched into a window.
  // Made last, and the page goes on without it if it cannot be: nothing else waits on it.
  const gate = far && realm ? await portal({
    gpu, far, realms: realm, world, march, pose, began,
    make: () => new World(device, { ...world.options, workers: bounded(query.get('portalworkers'), world.options.workers, 1, 8, true) }),
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
    // Shown on a desktop too, small in the corner: they say that there are keys for these. Not in a lobby (#526): a
    // door keeps realms for its admins (door.mjs `ROUTES`), who have the keys, and a visitor is shown nothing they
    // would only be refused; on a phone the two lay over the Charge key there.
    if (!joined) buttons.append(button, realmsButton)
    Object.assign((globalThis as unknown as { engine: object }).engine, { wheel: ring, enterRealm: (id: string) => enterRealm(id) })
  }
  portalDraw = gate ? (encoder, to, v, time, timing) => { gate.walk(); return gate.draw(encoder, to, v, flags, time, timing) } : null
  portalLights = gate ? (sink) => gate.emitLights(sink) : null
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
  loading.fail()
  const text = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
  over.status(`This did not work here: ${text.split('\n')[0]}`)
  // A visitor to a realm run alone (#450) is told plainly, in the middle of the page, with what to do next (#81).
  if (LOCAL) {
    tell('error', { message: text.split('\n')[0] })
    const name = LOCAL.name
    if (/webgpu/i.test(text)) {
      const touch = navigator.maxTouchPoints > 0
      failCard({
        title: `${name} needs WebGPU`,
        lines: [
          `This browser doesn't offer WebGPU here, so ${name} can't be drawn.`,
          inApp() || touch ? 'Open this link in Safari or Chrome. Browsers inside apps, like X\'s, often leave WebGPU out.' : 'It opens in a recent Chrome, Edge or Safari.',
        ],
        keys: [{ label: 'Copy link', main: true, run: (k) => void copyLink(k) }],
        links: [{ label: 'zahynailo.dev', href: 'https://zahynailo.dev' }, { label: 'Voxelwright on GitHub', href: 'https://github.com/voxelwright/voxelwright' }],
      })
    } else {
      failCard({ title: `${name} couldn't open`, lines: ['Something went wrong while it was loading. Reloading often helps.'], keys: [{ label: 'Reload', main: true, run: () => location.reload() }] })
    }
  } else document.documentElement.dataset.failed = '1'
  console.error(e)
  report.notes.push(`failed: ${text}`)
  await post('error')
})
