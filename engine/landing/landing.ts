// The landing world (#421): the front door of the owner's site as a place in the engine. A street corner of the
// town with the site's menu stood on its roofs as billboards (block.mjs). The eye flies in over the town, comes to
// rest before the row, and flies to the sign that is chosen; the page that holds this one is then told to go there.
// Everything is the world's own cells, so everything can be knocked about: a tap throws a ball, a hold throws it
// hard, and what stands on glass comes down. A while after, the corner is as it was.
//
// It stands on the stage (player/stage.ts). It asks no server anything and calls no model.
//
// What the page that holds this one is told, each a message { village: 'landing', type, ... }:
//   unsupported { reason } | loading {} | ready { ms, firstFrame } | error { message }     as the player says them (index.html)
//   seen      {}                the first picture is drawn: the eye is high over the town, and may be shown
//   at        { id, flying }    where the eye is or is going: 'sky', 'home', a sign's id, or 'face'
//   navigate  { id }            a sign was chosen and flown to: the holder follows its own link of that name
//   slow      { ms, scale }     frames are late even at the fewest pixels: the holder may show its flat page
//   broke     { }               something came down;   mended {}   the corner is as it was
// What it is told by its holder, each { village: 'host', type, ... }:
//   enter {}            the world is shown: the eye flies in        skip {}        the flight in is cut short
//   look { id }         fly to a place and stay                     choose { id }  fly to a sign and go
//   rest {} | go {}     stop and start drawing                      mend {}        put the corner back now
import type { View } from '../page/march.ts'
import { stage } from '../player/stage.ts'
import { face as makeFace } from './face.ts'

export type Tell = (type: string, more?: Record<string, unknown>) => void
type V3 = [number, number, number]
interface Shot { eye: V3; at: V3 }
interface Sign { id: string; word: string; box: [number, number, number, number, number, number]; at: V3 }
interface Places { centre: V3; street: { z: number; ground: number }; row: { x0: number; x1: number; front: number; roof: number }; signs: Sign[]; table: { at: V3 }; face: { at: V3; wide: number; tall: number; normal: V3 }; colours: { blue: number; yellow: number } }

/** The owner's two colours, as a screen shows them. */
const BRAND = { blue: [0x0e, 0x22, 0xff], yellow: [0xff, 0xf6, 0x00] } as const
const light = (c: readonly number[]): V3 => [(c[0] / 255) ** 2.2, (c[1] / 255) ** 2.2, (c[2] / 255) ** 2.2]
/** How long a press is before it is a hold, how long the hardest hold is, ms; and how far a press may move and still be one, px. */
const HOLD_FROM = 220, HOLD_FULL = 800, STILL = 7
/** How long the flights take, s: in over the town, from one place to another, and through a chosen sign. */
const FLY_IN = 2.6, FLY = 1.05, PUSH = 0.5
/** How long after the last thing moved the corner is put back, s. */
const MEND_AFTER = 6

const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mix = (a: readonly number[], b: readonly number[], t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
/** Slow, fast, slow: for what moves across the picture. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
/** Fast, then slower and slower: for arriving. */
const arrive = (t: number) => 1 - (1 - t) ** 4

export async function land(tell: Tell): Promise<void> {
  const failed = (e: unknown) => tell('error', { message: e instanceof Error ? e.message : String(e) })
  const [on, places] = await Promise.all([stage(failed, 'scenes/corner.json'), fetch(new URL('scenes/places.json', location.href)).then((r) => r.json() as Promise<Places>)])
  const { canvas, core, query, march } = on
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches || query.has('calm')

  // The owner's colours stand where the palette's vivid blue and vivid yellow were: the signs and the ball are
  // made of those two places in it (block.mjs).
  const blue = light(BRAND.blue), yellow = light(BRAND.yellow)
  on.gpu.device.queue.writeBuffer(march.looks, places.colours.blue * 16, new Float32Array([...blue, 1]))
  on.gpu.device.queue.writeBuffer(march.looks, places.colours.yellow * 16, new Float32Array([...yellow, 1]))
  on.hour(Number(query.get('hour') ?? 10.4))
  const ball = 10 | (places.colours.yellow << 8)

  // ── Where the eye stands ────────────────────────────────────────────────
  const aspect = () => canvas.clientWidth / Math.max(1, canvas.clientHeight)
  /** The tangent of half the picture's angle, top to bottom. A tall, narrow picture is given a wider one, so that it still sees a street's width: as a game does on a phone held upright. */
  const tan = () => Math.min(0.9, Math.max(on.tanHalf, 0.42 / aspect()))
  const ground = (x: number, z: number) => core.ground_at(Math.floor(x), Math.floor(z))
  /** Before a sign: far enough that its board fills most of the picture's width, a little under it, looking up. */
  const before = (s: Sign): Shot => {
    const w = s.box[3] - s.box[0], far = Math.max(150, w / 2 / (tan() * aspect() * 0.78))
    const eye: V3 = [s.at[0] - far * 0.16, s.at[1] - far * 0.2, s.at[2] + far]
    eye[1] = Math.max(eye[1], ground(eye[0], eye[2]) + 22)
    return { eye, at: [s.at[0], s.at[1] - 3, s.at[2]] }
  }
  /** Home: the whole row, from across the street and a little to the west, so that the houses show their sides. Where the picture is tall and narrow the row is looked along instead, from the corner. */
  const home = (): Shot => {
    const { x0, x1, front, roof } = places.row, mid = (x0 + x1) / 2, a = aspect()
    if (a < 1) return { eye: [x0 - 95, roof - 30, front + 270], at: [mid - 70, roof + 5, front] }
    const far = ((x1 - x0) / 2 + 40) / (tan() * a * 0.86)
    return { eye: [mid - far * 0.28, roof + 6 + far * 0.02, front + far], at: [mid, roof - 22, front] }
  }
  const sky = (): Shot => { const h = home(); return { eye: [h.eye[0] - 1500, h.eye[1] + 1500, h.eye[2] + 2300], at: h.at } }
  const faceShot = (): Shot => {
    const f = places.face, far = Math.max(95, f.tall / 2 / (tan() * 0.62), f.wide / 2 / (tan() * aspect() * 0.7))
    return { eye: [f.at[0] + f.normal[0] * far, f.at[1] - 2, f.at[2] + f.normal[2] * far], at: [f.at[0], f.at[1], f.at[2]] }
  }
  const shot = (id: string): Shot => id === 'home' ? home() : id === 'sky' ? sky() : id === 'face' ? faceShot() : before(places.signs.find((s) => s.id === id) ?? places.signs[0])

  /** Where the eye is, or is going. */
  let where = query.get('at') ?? 'sky'
  let cam: Shot = shot(where)
  /** A flight: from where to where, how far along, how long, and what is done on arriving. `bend` is how far the middle of the way is pulled aside. */
  let flight: { from: Shot; to: Shot; t: number; long: number; bend: V3; curve: (t: number) => number; then?: () => void } | null = null
  /** How far the eye is turned from where it looks by a drag, and how far a knock has shaken it. */
  const turned = { yaw: 0, pitch: 0 }
  let shake = 0, clock = 0
  const say = () => tell('at', { id: where, flying: !!flight })
  const fly = (id: string, long: number, then?: () => void, curve = ease) => {
    const to = shot(id), far = Math.hypot(...sub(to.eye, cam.eye))
    where = id
    if (calm || long <= 0 || far < 1) { cam = to; flight = null; turned.yaw = turned.pitch = 0; say(); then?.(); return }
    // The way bends up and back from the row, as a flight between buildings does.
    flight = { from: { eye: [...cam.eye], at: [...cam.at] }, to, t: 0, long, bend: [0, far * 0.1, far * 0.14], curve, then }
    say()
  }
  const view = (): View => {
    const d = sub(cam.at, cam.eye), flat = Math.hypot(d[0], d[2])
    // A slow drift, as a menu's picture breathes; none for whoever asked for less motion.
    const drift = calm || flight ? 0 : 1
    const yaw = Math.atan2(d[0], -d[2]) + turned.yaw + drift * 0.012 * Math.sin(clock * 0.31) + shake * Math.sin(clock * 61)
    const pitch = Math.max(-1.5, Math.min(1.5, Math.atan2(d[1], flat) + turned.pitch + drift * 0.006 * Math.sin(clock * 0.23 + 1) + shake * Math.sin(clock * 47 + 1)))
    const cp = Math.cos(pitch), forward = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp] as const
    const right = [Math.cos(yaw), 0, Math.sin(yaw)] as const
    const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]] as const
    return { eye: cam.eye, forward, right, up, tanHalf: tan() }
  }
  on.view = view

  // ── The face ────────────────────────────────────────────────────────────
  // The slot for the owner's picture: `?face=address` of an image. Unsaid, the stand-in is drawn.
  const photo = query.get('face') ? await fetch(query.get('face')!).then((r) => r.blob()).then((b) => createImageBitmap(b)).catch(() => undefined) : undefined
  const head = await makeFace(on.gpu.device, on.gpu.format, march, places.face, blue, yellow, photo)
  on.passes.push((encoder, to, v) => head.draw(encoder, to, v))

  // ── Choosing ────────────────────────────────────────────────────────────
  const signOf = (id: string) => places.signs.find((s) => s.id === id)
  /** Flies to a place and stays there. */
  const look = (id: string) => { if (id !== where || flight) fly(id, FLY) }
  /** Flies to a sign, then on through it, and tells the holder to go where it leads. */
  const choose = (id: string) => {
    const s = signOf(id)
    if (!s) return
    const through = () => {
      const to: Shot = { eye: mix(cam.eye, s.at, 0.62), at: s.at }
      if (calm) return tell('navigate', { id })
      flight = { from: cam, to, t: 0, long: PUSH, bend: [0, 0, 0], curve: (t) => t * t, then: () => tell('navigate', { id }) }
      say()
    }
    if (where === id && !flight) through()
    else fly(id, FLY, through)
  }
  /** The sign a look meets first, if any: its board, a little more than its size. */
  const signAt = (v: View) => {
    let best: Sign | null = null, near = Infinity
    for (const s of places.signs) {
      let t0 = 0, t1 = Infinity
      for (let a = 0; a < 3; a++) {
        const lo = (s.box[a] - 3 - v.eye[a]) / v.forward[a], hi = (s.box[a + 3] + 3 - v.eye[a]) / v.forward[a]
        t0 = Math.max(t0, Math.min(lo, hi)); t1 = Math.min(t1, Math.max(lo, hi))
      }
      if (t0 <= t1 && t0 < near) { near = t0; best = s }
    }
    return best
  }

  // ── What breaks, and mending ────────────────────────────────────────────
  let stirred = 0, dirty = false, stopped = 0
  const breaks: V3[] = []
  on.broke = (box, rows) => {
    dirty = true; stirred = clock
    const at: V3 = [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2]
    if (breaks.length < 12 && !breaks.some((b) => Math.hypot(...sub(b, at)) < 20)) breaks.push(at)
    if (breaks.length === 1) tell('broke')
    if (calm || rows < 24) return
    // Something big gave: the world hangs a moment and the eye is knocked, a little, and never more than so much.
    if (clock - stopped > 0.6) { on.still = 0.07; stopped = clock }
    shake = Math.min(0.01, shake + 0.003 + rows * 0.00002)
  }
  const mend = () => {
    if (!dirty) return
    on.restore()
    // Where things broke, a puff in the owner's yellow as they come back.
    for (const at of breaks) { on.smoke.dust(at, 5, 5, [1, 0.96, 0.35]); on.debris.burst(at, 4, 26, yellow, 0.7, 1.2, 1.6) }
    breaks.length = 0
    dirty = false
    tell('mended')
  }
  /** Throws the ball at what is under a place on the picture. */
  const toss = async (px: number, py: number, hard: number) => {
    const v = on.through(px, py)
    // The face wobbles when struck: it is no cells, so the ball goes by.
    const struck = head.met(v.eye, v.forward)
    if (struck && where === 'face') head.knock(struck.at, 30 + hard * 90)
    const hit = await march.pick(v)
    on.toss(v, hit ? hit.t : 400, hard, ball)
    dirty = true; stirred = clock
  }

  // ── Each frame ──────────────────────────────────────────────────────────
  let probing = 0, probed = false, probeFrames = 0
  on.each = (dt) => {
    clock += dt
    shake *= Math.exp(-dt * 9)
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / flight.long)
      const k = flight.curve(flight.t), arc = 4 * k * (1 - k)
      cam = { eye: mix(flight.from.eye, flight.to.eye, k).map((v, a) => v + flight!.bend[a] * arc) as V3, at: mix(flight.from.at, flight.to.at, Math.min(1, k * 1.25)) }
      // What a drag turned comes back as the eye leaves.
      turned.yaw *= 1 - k; turned.pitch *= 1 - k
      if (flight.t >= 1) { const then = flight.then; cam = flight.to; flight = null; say(); then?.() }
    }
    head.step(dt)
    if (press && !press.moved && !press.grab) ring(press.x, press.y, (performance.now() - press.t - HOLD_FROM) / (HOLD_FULL - HOLD_FROM))
    if (dirty && on.bodies === 0 && clock - stirred > MEND_AFTER && !head.held) mend()
    else if (on.bodies > 0) stirred = clock
    // Once the world is seen, the frames are watched for two seconds: fewer than twenty-five a second over them, at
    // whatever size the picture has been brought down to by then, and the holder is told. (`dt` is never more than a
    // tenth of a second, so the window is counted by the clock.)
    if (seenAt && !probed) {
      if (!probing) probing = performance.now()
      probeFrames++
      const took = performance.now() - probing
      if (took > 2000) { probed = true; if (probeFrames < took / 40) tell('slow', { ms: Math.round(took / probeFrames), scale: on.scale }) }
    }
    // For the check alone: `?drag=50` wastes so many ms a frame, as a slow device would.
    if (drag) { const until = performance.now() + drag; while (performance.now() < until) { /* spin */ } }
  }
  const drag = Number(query.get('drag') ?? 0)
  let seenAt = 0
  on.seenNear = (ms, firstFrame) => { seenAt = ms; tell('ready', { ms, firstFrame }) }
  const entered = () => { if (where === 'sky') fly('home', FLY_IN, undefined, arrive) }
  const skip = () => { if (where === 'home' && flight) { cam = flight.to; flight = null; say() } else if (where === 'sky') fly('home', 0) }

  // ── Mouse, touch and keys ───────────────────────────────────────────────
  // One table: a press on the face takes hold of it; a press that moves turns the eye; a tap on a sign chooses it; a
  // tap anywhere else throws the ball softly; a hold throws it hard, the harder the longer.
  let press: { id: number; x: number; y: number; x0: number; y0: number; t: number; moved: boolean; grab: boolean } | null = null
  const charge = document.querySelector<HTMLElement>('#charge')
  const ring = (x: number, y: number, full: number) => {
    if (!charge) return
    const k = Math.max(0, Math.min(1, full))
    charge.hidden = full <= 0
    charge.style.transform = `translate(${x}px, ${y}px) scale(${0.35 + 0.65 * k})`
    charge.classList.toggle('full', k >= 1)
  }
  const place = (e: PointerEvent): [number, number] => { const box = canvas.getBoundingClientRect(); return [e.clientX - box.left, e.clientY - box.top] }
  canvas.addEventListener('pointerdown', (e) => {
    if (press) return
    // Any touch during the flight in cuts it short, and is nothing else.
    if (where === 'sky' || (where === 'home' && flight)) return skip()
    canvas.setPointerCapture(e.pointerId)
    const [x, y] = place(e), v = on.through(x, y)
    press = { id: e.pointerId, x, y, x0: x, y0: y, t: performance.now(), moved: false, grab: where === 'face' && !flight && head.grab(v.eye, v.forward) }
    if (press.grab) canvas.classList.add('holding')
  })
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = place(e)
    if (!press) {
      // A mouse over a sign or the face: the pointer says it can be chosen.
      if (e.pointerType === 'mouse') { const v = on.through(x, y); canvas.classList.toggle('choosable', !!signAt(v) || !!head.met(v.eye, v.forward)) }
      return
    }
    if (e.pointerId !== press.id) return
    const dx = x - press.x, dy = y - press.y
    press.x = x; press.y = y
    if (press.grab) { const v = on.through(x, y); head.drag(v.eye, v.forward); return }
    if (!press.moved && Math.hypot(x - press.x0, y - press.y0) > STILL) { press.moved = true; ring(0, 0, 0) }
    if (!press.moved) return
    // The picture follows the finger: what is under it stays under it, near enough.
    const per = (2 * tan()) / Math.max(1, canvas.clientHeight)
    turned.yaw = Math.max(-0.9, Math.min(0.9, turned.yaw - dx * per))
    turned.pitch = Math.max(-0.5, Math.min(0.5, turned.pitch + dy * per))
  })
  const lift = (e: PointerEvent, ended: boolean) => {
    if (!press || e.pointerId !== press.id) return
    const p = press
    press = null
    ring(0, 0, 0)
    canvas.classList.remove('holding')
    if (p.grab) return head.release()
    if (p.moved || !ended) return
    const held = performance.now() - p.t, v = on.through(p.x, p.y)
    if (held < HOLD_FROM) {
      const s = signAt(v)
      if (s) return choose(s.id)
      if (where !== 'face' && head.met(v.eye, v.forward)) return look('face')
    }
    void toss(p.x, p.y, held < HOLD_FROM ? 0 : 0.35 + 0.65 * Math.min(1, (held - HOLD_FROM) / (HOLD_FULL - HOLD_FROM))).catch(failed)
  }
  canvas.addEventListener('pointerup', (e) => lift(e, true))
  canvas.addEventListener('pointercancel', (e) => lift(e, false))
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  // Keys, when this page has them: left and right go from sign to sign, Enter goes in, Escape comes home, Space
  // throws at the middle of the picture (held, harder), F finds the face, R mends.
  const stops = ['home', ...places.signs.map((s) => s.id)]
  let spaceAt = 0
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (where === 'sky' || (where === 'home' && flight)) { if (e.key !== 'Tab') { e.preventDefault(); skip() } return }
    const at = stops.indexOf(where)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') look(stops[at < 0 ? 1 : Math.min(stops.length - 1, at + 1)])
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') look(stops[at < 0 ? 0 : Math.max(0, at - 1)])
    else if (e.key === 'Enter' && signOf(where)) choose(where)
    else if (e.key === 'Escape') look('home')
    else if (e.key === 'f' || e.key === 'F') look('face')
    else if (e.key === 'r' || e.key === 'R') mend()
    else if (e.key === ' ') { if (!e.repeat) spaceAt = performance.now() }
    else return
    e.preventDefault()
  })
  addEventListener('keyup', (e) => {
    if (e.key !== ' ' || !spaceAt) return
    const held = performance.now() - spaceAt
    spaceAt = 0
    void toss(canvas.clientWidth / 2, canvas.clientHeight / 2, held < HOLD_FROM ? 0 : 0.35 + 0.65 * Math.min(1, (held - HOLD_FROM) / (HOLD_FULL - HOLD_FROM))).catch(failed)
  })
  // The picture changed shape (a phone turned): the eye stands where the new shape puts it.
  addEventListener('resize', () => { if (!flight) cam = shot(where) })

  // ── The holder, and whether anyone is looking ───────────────────────────
  let wanted = true
  // Until the scene has been seen once it is drawn whoever is looking: the holder waits for that word.
  const pace = () => { if ((wanted || !seenAt) && !document.hidden) on.go(); else on.rest() }
  document.addEventListener('visibilitychange', pace)
  addEventListener('message', (e) => {
    if (e.source !== parent || e.data?.village !== 'host') return
    const { type, id } = e.data as { type: string; id?: string }
    if (type === 'enter') entered()
    else if (type === 'skip') skip()
    else if (type === 'look' && typeof id === 'string' && (stops.includes(id) || id === 'face')) look(id)
    else if (type === 'choose' && typeof id === 'string') choose(id)
    else if (type === 'rest') { wanted = false; pace() }
    else if (type === 'go') { wanted = true; pace() }
    else if (type === 'mend') mend()
  })
  // Alone on a page, nobody says the world is shown: it is.
  if (parent === window && where === 'sky') on.seenNear = (ms, firstFrame) => { seenAt = ms; tell('ready', { ms, firstFrame }); entered() }

  /** Where a place in the world is on the picture, CSS pixels from its corner: for whoever drives the page from outside. */
  const spot = (p: readonly number[]): [number, number] => {
    const v = view(), d = sub(p, v.eye), dot = (a: readonly number[]) => d[0] * a[0] + d[1] * a[1] + d[2] * a[2], far = dot(v.forward), h = canvas.clientHeight / 2
    return [canvas.clientWidth / 2 + (dot(v.right) / far / v.tanHalf) * h, h - (dot(v.up) / far / v.tanHalf) * h]
  }
  // For whoever measures and for the console: nothing of the page's own reads it.
  Object.assign(globalThis, { landing: { on, places, head, look, choose, mend, skip, toss, shot, view, spot, get where() { return where }, get flying() { return !!flight }, get dirty() { return dirty }, get cam() { return cam }, set cam(to: Shot) { cam = to; flight = null } } })
  pace()
  on.start()
  tell('seen')
}
