// The way into a realm from its first view (#450): the EXPLORE board, asked twice, and the flight that follows.
//
// The first view is a still picture (first.ts). One of its boards does something in place of leading somewhere
// (boards.ts `does: 'explore'`): it takes the visitor into the realm, onto the roof it stands on. Nobody gets there by
// chance, and nobody who means it is slowed:
//
//   asked once    a click, a tap or Enter on the board's button: its letters light, the eye leans a little towards
//                 it, a quiet line under it says how to go on, and what the roof needs that the park did not starts
//                 to come (the finest tiles round it). Esc, the pointer taken well away, a click anywhere else, or
//                 a few seconds with nothing done, and it is as it was.
//   asked twice   the same again within those seconds: the flight. The host's `explore` (host.ts) is meant, and flies at once.
//
// The flight is the time the roof's world has to come. The eye goes from the park through the city to the board, its
// lens opening from the park's long one; the world's boxes are made round the roof from early in it, not round the
// eye (the far model draws the city passed on the way). There the visitor's own body stands beside the sign
// (person.ts), and the eye goes once round it, high, while the city turns behind, then comes down behind its shoulder
// and is the body's own. If the roof's cells are not all made by then the round goes on until they are. Any key or
// touch on the way cuts to the end. Where motion is not wanted there is no flight: the still picture fades into the
// view from the roof.
//
// Then the realm's controls come (first.ts `engage`), with a small card at the top right that says the two things
// this roof is for: a canopy, opened in the air, and flying. It goes when both have been done, or after a while.
// The hour's panel, whose corner that is, is folded behind its key (realm-ui.ts).
//
// And back (`back`): Back to the view, a key in that panel, or the backquote key (under Esc, which the pointer's lock and
// the eggs have). The eye leaves the body as it came to it, up and out behind its shoulder, and flies back to the first
// view's eye, framed for how the phone is held now, its lens closing to the park's. There the body is put away and the
// first view is as the page opens it (first.ts `back`): the controls hidden, a click on a board a click, the banner kept
// in the picture, and the board able to take the visitor in again. The world is as they left it. Where motion is not
// wanted there is no flight: the picture fades into the first view.
//
// Fetched once the park is shown (main.ts), so none of this is in the bytes before it.
import type { Board, Boards } from './boards.ts'
import type { First } from './first.ts'
import type { Input } from './input.ts'
import type { View } from './march.ts'
import { behindAt, type Me } from './person.ts'

export interface Needs {
  /** The board that leads in, and whoever lays it. */
  board: Board
  boards: Boards
  first: First
  input: Input
  canvas: HTMLCanvasElement
  /** The eye: metres, radians. */
  pose: { x: number; y: number; z: number; yaw: number; pitch: number }
  view(): View
  /** The eye's angle from top to bottom, degrees. */
  fov(): number
  setFov(degrees: number): void
  me: Me
  /** Where feet would stand at a column (cells), as this page's core has it: true once the tiles there have come. */
  feet(x: number, z: number): number
  /** Asks every core for the tiles round a place (cells). Resolves when this page's own has been asked for them all: true if they came. */
  near(x: number, z: number): Promise<boolean>
  /** Makes the world's boxes round a place (cells) in place of the eye, until given null. */
  focus(at: readonly [number, number, number] | null): void
  /** Whether every box of the world round its focus is made, and the far model has what the view needs. */
  whole(): boolean
  /** Who places the eye after the page's own movers have, each frame: `before` them, and `after` (seconds since the last). Null gives it back. */
  shot(by: { before?(): void; after(dt: number): void } | null): void
  /** The click of the press now down does nothing, however long it is held: this has already taken the press. */
  hush(): void
  /** Called every frame with the gap since the last, ms. Returns what stops it. */
  watch(each: (gap: number) => void): () => void
  /** The realm's controls (realm-ui.ts): their root, the kit once it has come, and the hour's panel folded behind its key. */
  ui: { root: HTMLElement; readonly kit: { adopt(root?: Element): void; refresh?(el: Element): void } | null; fold(on: boolean): void } | null
  /** The first view's eye as the page opens it, framed for how the phone is held now: metres, radians, degrees. */
  home(): { at: readonly number[]; yaw: number; pitch: number; fov: number }
  /** Off whatever the visitor rides, on their feet beside it. */
  alight(): void
}

export interface Explore {
  /** Where it is: the first view, the board asked once, the flight, in the realm, or on the way back to the first view. */
  readonly state: 'idle' | 'armed' | 'going' | 'in' | 'leaving'
  /** The board was asked: once arms it, again within a few seconds goes. */
  act(): void
  /** The first view was framed again (a phone turned): the eye as it is now is the one an ask leans from and goes back to. */
  reframed(): void
  /** As it was before it was asked. */
  disarm(): void
  /** Goes, unasked: the host's word, which is meant. Resolves when the visitor stands on the roof (on the way back, once back). */
  go(): Promise<void>
  /** Back to the first view, from the realm. Resolves when the first view is as the page opens it. */
  back(): Promise<void>
  /** Where the visitor stands on the roof (cells) and which way they look (radians). */
  readonly stand: { x: number; z: number; yaw: number }
  /** For the checks: when it was armed, when the flight began, when what the roof needs had come and when the eye was the body's own (ms as `performance.now` has them, 0 until then), and whether the round was drawn out to wait. */
  readonly times: { armed: number; went: number; loaded: number; settled: number; waited: number }
}

const M = 10, DEG = Math.PI / 180
/** How long an ask stands, ms; how far the eye leans to the board (of the turn to it) and how far its lens closes on it. */
const STANDS = 6000, LEAN = 0.08, PUSH = 0.965
/** How soon after the first ask a second counts, ms: a double click, or a key held until it repeats, is one ask, and the line that says how to go on has been there to read. */
const AGAIN = 300
/** The lens in the realm, degrees (wider where the picture is taller than wide, which sees a third as much across); how long the flight is, s; the round: how far out and how high over the body's feet it begins and comes to, m, its turn in radians a second, the least of it before it comes down, how long the coming down is and how long the roof is waited for, s, and how far over whatever is under it the eye keeps, m. */
const LENS = { wide: 58, upright: 80 }, FLY = 3, ROUND = { far: [26, 18], high: [24, 12], turn: 1.35, least: 1.5, down: 2.2, wait: 8, clear: 2.5 }
/** How the body looks from behind its shoulder as the eye becomes its own, radians down. */
const DOWN = -0.1
/** How far the body's eye stands off where it arrives (person.ts `standOff`): out from the roof, so that the body is seen whole beside the sign and the sign's face is read. */
const STAND_OFF = 1

/** How high the eyes are over the feet, cells (person.ts). */
const EYES = 16.5
/** The way back: how long the eye takes to go up and out behind the body, and the flight to the first view, s. */
const BACK = { up: 1.1, fly: 2.6 }

const STYLE = /* css */ `
/* The line under the board: there in a sixth of a second, out of the board it hangs under (it grows a little from its top), and gone quicker than it came. Asked by a key, it is simply there. */
#explore-hint { position: fixed; left: 0; top: 0; z-index: 7; margin: 0; padding: 5px 11px 6px; border-radius: 999px; font: 500 13px/1.25 var(--vx-font, system-ui, sans-serif); letter-spacing: 0.01em; white-space: nowrap; color: #fff; background: rgb(14 16 20 / 0.62); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); pointer-events: none; opacity: 0; scale: 0.97; transform-origin: 50% 0; transition: opacity 0.12s cubic-bezier(0.23, 1, 0.32, 1), scale 0.12s cubic-bezier(0.23, 1, 0.32, 1); will-change: transform, opacity; }
#explore-hint.on { opacity: 1; scale: 1; transition-duration: 0.16s; }
#explore-hint.keys { transition: none; }
#explore-hint i { font-style: normal; opacity: 0.62; }
@media (prefers-reduced-transparency: reduce) { #explore-hint { background: rgb(14 16 20 / 0.94); -webkit-backdrop-filter: none; backdrop-filter: none; } }
#explore-still { position: fixed; inset: 0; z-index: 4; inline-size: 100%; block-size: 100%; pointer-events: none; opacity: 1; transition: opacity 0.45s ease-out; }
/* The card of what this roof is for: top right, under the key the hour's panel is folded behind; out of the way while that panel is open. */
#realm .help { position: absolute; right: max(16px, env(safe-area-inset-right)); top: calc(max(16px, env(safe-area-inset-top)) + 60px); box-sizing: border-box; max-inline-size: min(calc(100vw - 32px), calc(var(--vx) * 84)); margin: 0; padding: calc(var(--vx) * 4) calc(var(--vx) * 5); display: grid; gap: calc(var(--vx) * 3); font-size: 14px; line-height: 1.5; pointer-events: none; opacity: 0; translate: 0 -8px; transition: opacity 0.3s cubic-bezier(0.23, 1, 0.32, 1), translate 0.4s cubic-bezier(0.23, 1, 0.32, 1); }
#realm .help.on { opacity: 1; translate: 0 0; }
#realm .help p { margin: 0; transition: opacity 0.4s ease-out; }
#realm .help p.done { opacity: 0.38; }
#realm.open .help { display: none; }
@media (pointer: coarse) { #realm .help { right: max(12px, env(safe-area-inset-right)); top: calc(max(12px, env(safe-area-inset-top)) + 56px); font-size: 13px; } }
/* Back to the view: the first of the hour's panel's keys at its foot. Where they do not all fit across the panel the rest
   go under it, each to the right as the foot has them (the panel is no wider for it). */
#realm .sky .foot { flex-wrap: wrap; row-gap: calc(var(--vx) * 3); min-inline-size: 0; }
@media (prefers-reduced-motion: reduce) { #explore-hint, #realm .help, #realm .help p { transition: none; scale: 1; translate: 0 0; } }
`

const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c) }
/** From 0 to 1 over 0 to 1, leaving at `v0` and arriving at `v1` (how fast, in whole lengths a whole time). */
const hermite = (t: number, v0: number, v1: number) => { const c = Math.max(0, Math.min(1, t)), c2 = c * c, c3 = c2 * c; return -2 * c3 + 3 * c2 + (c3 - 2 * c2 + c) * v0 + (c3 - c2) * v1 }
/** The turn from one bearing to another, the short way: -π to π. */
const turnTo = (from: number, to: number) => { let d = (to - from) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d }
type V3 = [number, number, number]
const mix = (a: readonly number[], b: readonly number[], t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

export function explore(o: Needs): Explore {
  const { board, boards, pose } = o, still = matchMedia('(prefers-reduced-motion: reduce)')
  const style = document.createElement('style')
  style.textContent = STYLE
  const hint = Object.assign(document.createElement('p'), { id: 'explore-hint' })
  hint.setAttribute('role', 'status')
  document.head.append(style)
  document.body.append(hint)

  let state: Explore['state'] = o.first.engaged ? 'in' : 'idle'
  const times = { armed: 0, went: 0, loaded: 0, settled: 0, waited: 0 }
  // Where the visitor stands on the roof and which way they look: the record's, or before the middle of the sign looking where it looks.
  const sign = board.at, facing = [270, 0, 90, 180][board.facing] * DEG
  const stand = board.stand ? { x: board.stand[0], z: board.stand[1], yaw: board.stand[2] * DEG } : { x: sign[0] + Math.sin(facing) * 40, z: sign[2] - Math.cos(facing) * 40, yaw: facing }
  /** What the roof needs that the park did not, asked for once: the finest tiles round it. True if they came; if not, the next ask is made again. */
  let loading: Promise<boolean> | null = null
  const fetchRoof = () => (loading ??= Promise.resolve(o.near(Math.round(stand.x), Math.round(stand.z))).then(Boolean, () => false).then((had) => { if (!had) loading = null; return had }))

  // ── Asked once: the letters lit, the eye leaning in, the line under the board ──
  /** The eye as the first view has it, and how far it leans from that (0 to 1, eased every frame). */
  let rest: { at: V3; yaw: number; pitch: number; fov: number } | null = null, lean = 0, lit = 0, timer = 0, pointer = 'mouse'
  addEventListener('pointerdown', (e) => { pointer = e.pointerType }, true)
  const where = () => boards.where(board.id)
  const place = () => {
    const w = where()
    if (!w) return
    const half = hint.offsetWidth / 2, x = Math.max(8 + half, Math.min(innerWidth - 8 - half, w.x)), y = Math.min(innerHeight - 40, w.y + w.high / 2 + 9)
    hint.style.transform = `translate(${Math.round(x - half)}px, ${Math.round(y)}px)`
  }
  const frame = (gap: number) => {
    if (state !== 'idle' && state !== 'armed') return
    const dt = Math.min(0.1, gap / 1000), on = state === 'armed' ? 1 : 0, quick = still.matches
    // The letters come up in a sixth of a second and go down in a quarter; the eye leans as a head does, and goes back slower.
    const was = lit
    lit = quick ? on : Math.max(0, Math.min(1, lit + (on ? dt / 0.16 : -dt / 0.26)))
    if (lit !== was) boards.light(board.id, Math.round(smooth(lit) * 8) / 8)
    // The eye taken somewhere meanwhile (a flight to another board): the ask is over, and the eye is whoever's took it, its lens as it was.
    if (rest && Math.hypot(pose.x * M - rest.at[0], pose.y * M - rest.at[1], pose.z * M - rest.at[2]) > 1) { o.setFov(rest.fov); rest = null; lean = 0; disarm() }
    if (rest && !quick) {
      lean += (on - lean) * (1 - Math.exp(-dt * (on ? 7 : 4.5)))
      if (!on && lean < 0.002) lean = 0
      const to = [sign[0] - rest.at[0], sign[1] + 60 - rest.at[1], sign[2] - rest.at[2]], k = LEAN * lean
      pose.yaw = rest.yaw + turnTo(rest.yaw, Math.atan2(to[0], -to[2])) * k
      pose.pitch = rest.pitch + (Math.atan2(to[1], Math.hypot(to[0], to[2])) - rest.pitch) * k
      o.setFov(rest.fov * (1 - (1 - PUSH) * lean))
      // Back as it was: the eye is the page's again.
      if (!on && !lean) rest = null
    }
    if (on) place()
  }
  o.watch(frame)
  const away = (e: PointerEvent) => {
    if (state !== 'armed' || e.pointerType !== 'mouse') return
    const w = where()
    // Well away: further from the board than it is wide, and a hand's width at least.
    if (w && Math.hypot(Math.max(0, Math.abs(e.clientX - w.x) - w.wide / 2), Math.max(0, Math.abs(e.clientY - w.y) - w.high / 2)) > Math.max(140, w.wide)) disarm()
  }
  const keyed = (e: KeyboardEvent) => { if (state === 'armed' && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); disarm() } }
  const elsewhere = () => { if (state === 'armed') disarm() }
  addEventListener('pointermove', away)
  addEventListener('keydown', keyed, true)
  // (A click on the board never comes this far: boards.ts takes it first.)
  o.canvas.addEventListener('click', elsewhere)
  addEventListener('blur', elsewhere)
  const arm = () => {
    if (state !== 'idle') return
    state = 'armed'
    times.armed = performance.now()
    rest ??= { at: [pose.x * M, pose.y * M, pose.z * M], yaw: pose.yaw, pitch: pose.pitch, fov: o.fov() }
    const keys = (document.activeElement as HTMLElement | null)?.dataset?.board === board.id
    hint.classList.toggle('keys', keys)
    hint.innerHTML = keys ? 'Press Enter again to explore <i>· Esc to stay</i>' : pointer === 'mouse' ? 'Click again to explore <i>· Esc to stay</i>' : 'Tap again to explore'
    place()
    hint.classList.add('on')
    void fetchRoof()
    clearTimeout(timer)
    timer = window.setTimeout(disarm, STANDS)
  }
  const disarm = () => {
    if (state !== 'armed') return
    state = 'idle'
    times.armed = 0
    clearTimeout(timer)
    hint.classList.remove('on')
  }

  // ── Asked twice: the flight, the round, and the eye given to the body ──
  /**
   * Any key, any touch or click, the wheel, from a third of a second after `since`: to the end of a flight (`cut`), and
   * that is all it does. The key is nobody else's (into the realm it would be the realm's first key: Backspace put the
   * world back, Enter opened a line; out of it, a key of the first view), and the click that follows a press is no click
   * on a board passed on the way. Heard from now; what it returns stops it.
   */
  const skipping = (since: number, cut: () => void) => {
    const skip = (e: Event) => {
      const key = e instanceof KeyboardEvent ? e : null
      // (A key with Ctrl, Alt or the command key, and the keys along the top, are the browser's own: reload, the tools, full screen.)
      if (key && (['Shift', 'Control', 'Alt', 'Meta'].includes(key.key) || key.ctrlKey || key.metaKey || key.altKey || /^F\d+$/.test(key.key))) return
      key?.preventDefault()
      e.stopImmediatePropagation()
      if (e.type === 'pointerdown') o.hush()
      // (A key still held from before, saying itself again, is no new key: the Enter that asked twice, held, cuts nothing.)
      if (key?.repeat) return
      if (performance.now() - since > 350) cut()
    }
    const types = ['keydown', 'pointerdown', 'wheel']
    for (const type of types) addEventListener(type, skip, true)
    return () => { for (const type of types) removeEventListener(type, skip, true) }
  }
  /** The picture as it stands, kept to lay over the page (`#explore-still`), not yet laid: see the flight's `fade`. */
  const still_ = async () => {
    const held = Object.assign(document.createElement('canvas'), { id: 'explore-still', width: o.canvas.width, height: o.canvas.height })
    await new Promise<void>((done) => setTimeout(() => requestAnimationFrame(() => { try { held.getContext('2d')!.drawImage(o.canvas, 0, 0) } catch { /* a picture that cannot be kept: the cut is bare */ } done() }), 0))
    return held
  }
  const unveil = (held: HTMLCanvasElement) => { held.style.opacity = '0'; setTimeout(() => held.remove(), 500) }
  /** The eye on the round: `a` its bearing from the body, `far` and `high` how far out and how high over the body's feet (cells), looking at the body's chest. */
  const feetAt = () => { const y = o.feet(Math.round(stand.x), Math.round(stand.z)); return Number.isFinite(y) && Math.abs(y - board.at[1]) < 400 ? y : board.at[1] }
  const round = (a: number, far: number, high: number, foot: number) => {
    const at: V3 = [stand.x + Math.sin(a) * far, foot + high, stand.z - Math.cos(a) * far]
    return { at, yaw: a + Math.PI, pitch: Math.atan2(foot + 13 - at[1], far) }
  }
  /** How high whatever is under a place stands, cells: the roof or the ground there, and the sign itself, a little grown. */
  const box = boards.box(board.id)
  const under = (x: number, z: number) => Math.max(o.feet(Math.round(x), Math.round(z)), box && x > box[0] - 25 && x < box[3] + 25 && z > box[2] - 25 && z < box[5] + 25 ? box[4] : -Infinity)
  let gone: Promise<void> | null = null, leaving: Promise<void> | null = null
  const go = (): Promise<void> => (leaving ? leaving.then(go) : (gone ??= new Promise((done) => {
    if (state === 'in') return done()
    clearTimeout(timer)
    hint.classList.remove('on')
    state = 'going'
    // (The board's button, if it was asked by the keyboard, has done its work: left in focus it would stand over the flight.)
    if ((document.activeElement as HTMLElement | null)?.dataset?.board === board.id) (document.activeElement as HTMLElement).blur()
    times.went = performance.now()
    // (Tiles that did not come are asked for again, once a second, for as long as the flight lasts.)
    const roof = () => void fetchRoof().then((had) => { if (had) times.loaded ||= performance.now(); else if (!ended) setTimeout(roof, 1000) })
    const from = { at: [pose.x * M, pose.y * M, pose.z * M] as V3, yaw: pose.yaw, pitch: pose.pitch, fov: o.fov() }
    // From the park's side of the roof, and round the long way to behind the body's shoulder.
    const a0 = Math.atan2(from.at[0] - stand.x, -(from.at[2] - stand.z)), a1 = stand.yaw + Math.PI
    const way = turnTo(a0, a1) >= 0 ? -1 : 1
    let foot = feetAt(), began = performance.now(), phase: 'fly' | 'round' | 'down' = 'fly', a = a0, downFrom = { a: 0, to: 0 }, bodied = false, ended = false, focused = 0, lift = 0
    roof()
    /**
     * The eye on the round, kept clear: over whatever stands under it there and a little either way round (the sign it
     * passes, a higher roof next door), by ROUND.clear, the lift that takes eased so that a wall met is a rise and no jump.
     */
    const clear = (a: number, far: number, high: number, dt: number) => {
      let most = -Infinity
      for (let da = -0.3; da <= 0.301; da += 0.1) most = Math.max(most, under(stand.x + Math.sin(a + da) * far, stand.z - Math.cos(a + da) * far))
      const want = Math.max(0, most + ROUND.clear * M - (foot + high))
      lift += (want - lift) * (1 - Math.exp(-dt * (want > lift ? 9 : 2.5)))
      return round(a, far, high + lift, foot)
    }
    /** The world's boxes round where the eye will settle from now, and whether they have been long enough for `whole` to be the roof's. */
    // (Round where the eye will settle, stood off the roof (`STAND_OFF`): what it sees then is the roof and the sign from there.)
    const settles = () => behindAt([stand.x, foot, stand.z], stand.yaw, DOWN, STAND_OFF)
    const focus = () => { o.focus(settles()); focused ||= performance.now() }
    const made = () => focused > 0 && performance.now() - focused > 300 && times.loaded > 0 && o.whole()
    /** The body, set down where it is to stand, the eye in its head for the moment it is made. Not before the roof's tiles have come: it would fall through a world that is not there, and the visitor is then an eye over the roof. */
    const body = () => {
      if (bodied || !times.loaded) return
      bodied = true
      foot = feetAt()
      Object.assign(pose, { x: stand.x / M, y: (foot + EYES + 2) / M, z: stand.z / M, yaw: stand.yaw, pitch: DOWN })
      o.me.view = 'behind'
      // (Stood off, so that the body is seen whole and the sign beside it: in to its own place once it walks.)
      o.me.standOff = STAND_OFF
      o.me.walk(true)
    }
    /** Its feet, once the core has said where they are: the round is about them (the roof may be a step off what was asked). */
    const feet = () => { const f = o.me.feet; if (f) foot = f.at[1]; return f }
    const open = o.canvas.clientHeight > o.canvas.clientWidth ? LENS.upright : LENS.wide
    const lens = (t: number) => o.setFov(from.fov + (open - from.fov) * smooth(t))
    // The flight's line: out along the look, then in on the round's own way round, a little over the straight line.
    const p3 = round(a0, ROUND.far[0] * M, ROUND.high[0] * M, foot), long = Math.hypot(p3.at[0] - from.at[0], p3.at[1] - from.at[1], p3.at[2] - from.at[2])
    const ahead: V3 = [Math.sin(from.yaw) * Math.cos(from.pitch), Math.sin(from.pitch), -Math.cos(from.yaw) * Math.cos(from.pitch)], along: V3 = [Math.cos(a0) * way, 0, Math.sin(a0) * way]
    const p1: V3 = [from.at[0] + ahead[0] * long * 0.3, from.at[1] + ahead[1] * long * 0.3 + long * 0.035, from.at[2] + ahead[2] * long * 0.3]
    const p2: V3 = [p3.at[0] - along[0] * long * 0.12, p3.at[1] + long * 0.02, p3.at[2] - along[2] * long * 0.12]
    const bezier = (t: number): V3 => { const u = 1 - t; return [0, 1, 2].map((k) => u * u * u * from.at[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3.at[k]) as V3 }
    const set = (at: readonly number[], yaw: number, pitch: number) => Object.assign(pose, { x: at[0] / M, y: at[1] / M, z: at[2] / M, yaw, pitch })
    const end = () => {
      if (ended) return
      ended = true
      o.shot(null)
      o.focus(null)
      skips()
      const eye = { ...pose }
      body()
      // (With no body the eye stays where the flight left it, behind where the body would stand.)
      Object.assign(pose, bodied ? {} : eye, { yaw: stand.yaw, pitch: DOWN })
      o.setFov(open)
      boards.light(board.id, 0)
      times.settled = performance.now()
      state = 'in'
      o.first.engage()
      shown()
      done()
    }
    const skips = skipping(times.went, () => cut())
    /** Cut to the end: at once if the roof is made, else the picture as it is fades into the roof when it has come. */
    const cut = () => { if (ended || fading) return; if (made()) end(); else void fade() }
    let fading = false, last = performance.now()
    const fade = async () => {
      if (fading) return
      fading = true
      // The picture as it stands, laid over the page; under it the eye goes to the roof and the roof is made.
      // Taken in a frame, after the page has drawn it and before it is shown: once shown, the canvas holds nothing to
      // copy (a copy made from a click's own turn was blank, and the fade a bare cut). The timeout puts this frame's
      // ask after the page's own, which is made while the page draws.
      const held = await still_()
      if (ended) return
      document.body.append(held)
      o.shot(null)
      foot = feetAt()
      focus()
      o.setFov(open)
      const behind = round(a1, 32, 8, foot)
      set(behind.at, stand.yaw, DOWN)
      // (Waited for as long as the round would wait, and no longer: on a link that does not bring the roof the visitor is let in as an eye.)
      const until = performance.now() + ROUND.wait * 1000
      await Promise.race([fetchRoof(), new Promise((r) => setTimeout(r, ROUND.wait * 1000))])
      foot = feetAt()
      focus()
      while (!made() && performance.now() < until) await new Promise((r) => setTimeout(r, 100))
      end()
      await new Promise((r) => setTimeout(r, 250))
      unveil(held)
    }
    // (Heard where there is no flight too: while the still picture waits for the roof, a click on a board in it opens nothing.)
    if (still.matches) { void fade(); return }
    o.shot({
      // While the eye comes down it asks the body where its own eye would be, looking as it will look.
      before() { if (phase === 'down') Object.assign(pose, { yaw: stand.yaw, pitch: DOWN }) },
      after() {
        // (By the clock, not by the frame's own count of it: a slow frame is a longer step, and the round is as long on a slow phone.)
        const now = performance.now(), t = (now - began) / 1000, dt = Math.min(0.25, (now - last) / 1000)
        last = now
        if (phase === 'fly') {
          const u = t / FLY, s = hermite(u, 0, (ROUND.turn * ROUND.far[0] * M * FLY) / (long * 0.36))
          // The world is made round the roof from a quarter of the way: the park's foreground is behind by then.
          if (u > 0.25) focus()
          lens(u * 0.8)
          // Its letters go down as it is come up to: lit, it is a face (boards.ts), and from near its cells are the better look.
          boards.light(board.id, Math.round((1 - smooth((u - 0.35) / 0.25)) * 8) / 8)
          set(bezier(s), from.yaw + turnTo(from.yaw, p3.yaw) * smooth(u), from.pitch + (p3.pitch - from.pitch) * smooth(u))
          if (u < 1) return
          phase = 'round'; began = now; body()
          set(p3.at, p3.yaw, p3.pitch)
          return
        }
        // (The body, if the roof had not come when the round began.)
        if (!bodied && times.loaded) { const eye = { ...pose }; body(); Object.assign(pose, eye) }
        feet()
        if (phase === 'round') {
          // Round, coming in: for the least of it, and on until the roof is all made (or it has been waited for long enough).
          a += way * ROUND.turn * dt
          const u = Math.min(1, t / ROUND.least), ready = made() || t > ROUND.wait
          lens(0.8 + 0.2 * u)
          const r = clear(a, (ROUND.far[0] + (ROUND.far[1] - ROUND.far[0]) * smooth(u)) * M, (ROUND.high[0] + (ROUND.high[1] - ROUND.high[0]) * smooth(u)) * M, dt)
          set(r.at, r.yaw, r.pitch)
          // Down when what is left of the way round is about what the coming down turns through, slowing from this pace to a stop.
          const left = (((way * (a1 - a)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), wants = ROUND.turn * ROUND.down * 0.5
          if (t >= ROUND.least && ready && left > wants * 0.7 && left < wants * 1.6) { phase = 'down'; began = now; downFrom = { a, to: a + way * left } }
          // Past where it would have come down, and round again: the round is drawn out for what has not come.
          else if (!ready && !times.waited && t >= ROUND.least && left < wants * 0.7) times.waited = now
          return
        }
        // Down: the rest of the way round, slowing to a stop behind the shoulder, and from half way the body's own eye more and more.
        const u = Math.min(1, t / ROUND.down), mine: V3 = [pose.x * M, pose.y * M, pose.z * M]
        a = downFrom.a + (downFrom.to - downFrom.a) * hermite(u, (ROUND.turn * ROUND.down) / Math.max(0.01, Math.abs(downFrom.to - downFrom.a)), 0)
        const r = clear(a, (ROUND.far[1] * M + (Math.hypot(settles()[0] - stand.x, settles()[2] - stand.z) - ROUND.far[1] * M) * smooth(u)), (ROUND.high[1] * M + (settles()[1] - foot - ROUND.high[1] * M) * smooth(u)), dt), own = o.me.feet ? smooth((u - 0.45) / 0.55) : 0
        set(mix(r.at, mine, own), r.yaw + turnTo(r.yaw, stand.yaw) * own, r.pitch + (DOWN - r.pitch) * own)
        if (u >= 1) end()
      },
    })
  })))

  // ── Back: from the body up and out, and home to the first view's eye ──
  const back = (): Promise<void> => {
    if (leaving) return leaving
    if (state !== 'in') return Promise.resolve()
    state = 'leaving'
    return (leaving = new Promise<void>((done) => {
      const home = o.home(), to: V3 = [home.at[0] * M, home.at[1] * M, home.at[2] * M]
      const from = { at: [pose.x * M, pose.y * M, pose.z * M] as V3, yaw: pose.yaw, pitch: pose.pitch, fov: o.fov() }
      // A line being written is put away as its Esc does (the ask bar's, the eggs'): its mode would stay over the first
      // view's, and over the realm's keys on the next way in.
      const line = document.activeElement
      if (line instanceof HTMLInputElement || line instanceof HTMLTextAreaElement) { line.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); line.blur() }
      // Off a ride first: its seat would have the eye and the keys under the first view's.
      o.alight()
      // The controls go at once, and a click is a click again (no pointer is taken): the first view's.
      o.first.back()
      if (document.pointerLockElement) document.exitPointerLock()
      const set = (at: readonly number[], yaw: number, pitch: number) => Object.assign(pose, { x: at[0] / M, y: at[1] / M, z: at[2] / M, yaw, pitch })
      // Up and out: behind the body as it faces, where the round came down from, high over it and looking at it.
      const f = o.me.feet, foot = f ? f.at[1] : from.at[1] - EYES, body = f ? f.at : from.at
      // (From the eye's own place behind it; in its head, or flying with no body, straight back from the look.)
      const a = Math.hypot(from.at[0] - body[0], from.at[2] - body[2]) > 5 ? Math.atan2(from.at[0] - body[0], -(from.at[2] - body[2])) : from.yaw + Math.PI, far = ROUND.far[0] * M, high = ROUND.high[0] * M
      const out = { at: [body[0] + Math.sin(a) * far, foot + high, body[2] - Math.cos(a) * far] as V3, yaw: a + Math.PI, pitch: Math.atan2(13 - high, far) }
      // Then home, the forward flight's line the other way: on from where the round was, and in along the first view's look.
      // (Over the roofs between: from the roof the park is lower, and a line straight down to it went along the tower's own wall.)
      const long = Math.hypot(to[0] - out.at[0], to[1] - out.at[1], to[2] - out.at[2])
      const ahead: V3 = [Math.sin(home.yaw) * Math.cos(home.pitch), Math.sin(home.pitch), -Math.cos(home.yaw) * Math.cos(home.pitch)], away: V3 = [Math.sin(a), 0, -Math.cos(a)]
      const p1: V3 = [out.at[0] + away[0] * long * 0.12, out.at[1] + long * 0.15, out.at[2] + away[2] * long * 0.12]
      const p2: V3 = [to[0] + ahead[0] * long * 0.3, to[1] + ahead[1] * long * 0.3 + long * 0.035, to[2] + ahead[2] * long * 0.3]
      const bezier = (t: number): V3 => { const u = 1 - t; return [0, 1, 2].map((k) => u * u * u * out.at[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * to[k]) as V3 }
      let ended = false
      /** Home: the first view as the page opens it. Keys and touches stay swallowed (`skips`) while a still picture is over it (`held`), until it is gone. */
      const end = (held?: HTMLCanvasElement) => {
        if (ended) return
        ended = true
        o.shot(null)
        o.focus(null)
        if (held) setTimeout(skips, 650); else skips()
        // The body put away (its eye was the page's), and the eye where the first view has it.
        if (o.me.on) o.me.walk(false)
        o.me.standOff = 0
        // (Framed for how the phone is held now: it may have been turned on the way.)
        const now = o.home()
        set(to, now.yaw, now.pitch)
        o.setFov(now.fov)
        lit = 0; lean = 0; rest = null
        boards.light(board.id, 0)
        Object.assign(times, { armed: 0, went: 0, loaded: 0, settled: 0, waited: 0 })
        gone = null; leaving = null
        state = 'idle'
        done()
      }
      // The park's boxes are made from when the eye leaves the roof, so that the first view is whole when the eye is there
      // (the far model draws the city passed on the way, as on the way in).
      const focus = () => o.focus(to)
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
      /** The picture as it is, laid over the page, and under it the eye home and the park made: where motion is not wanted, and for a key or a touch on the way. */
      let fading = false
      const fade = async () => {
        if (fading || ended) return
        fading = true
        const held = await still_()
        if (ended) return
        document.body.append(held)
        o.shot(null)
        focus()
        // (The body put away first: on its feet its eye is its own, and would be put back behind it every frame. A body
        // just asked for, a ride left a moment ago, is let come first: one put away before it is made stays in the world.)
        const t0 = performance.now()
        while (o.me.on && !o.me.feet && performance.now() - t0 < 1500) await wait(100)
        if (o.me.on) o.me.walk(false)
        set(to, home.yaw, home.pitch)
        o.setFov(home.fov)
        // (As long as the way in waits for the roof's, and no longer: the boxes round the park are made again from nothing
        // when the eye is cut home early. A click meanwhile is on the picture laid over the page, and does nothing.)
        const until = performance.now() + ROUND.wait * 1000
        await wait(300)
        while (!o.whole() && performance.now() < until) await wait(100)
        end(held)
        await wait(150)
        unveil(held)
      }
      const skips = skipping(performance.now(), () => void fade())
      if (still.matches) { void fade(); return }
      const since = performance.now()
      o.shot({
        after() {
          const t = (performance.now() - since) / 1000
          if (t < BACK.up) {
            const u = smooth(t / BACK.up)
            set(mix(from.at, out.at, u), from.yaw + turnTo(from.yaw, out.yaw) * u, from.pitch + (out.pitch - from.pitch) * u)
            return
          }
          const u = Math.min(1, (t - BACK.up) / BACK.fly), s = smooth(u)
          focus()
          o.setFov(from.fov + (home.fov - from.fov) * smooth(u * 1.15))
          set(bezier(s), out.yaw + turnTo(out.yaw, home.yaw) * smooth(u * 1.2), out.pitch + (home.pitch - out.pitch) * smooth(u * 1.2))
          // (A body just asked for, a ride left as the way back began, is let come first, a second and a half at most: one put away before it is made stays in the world.)
          if (u >= 1 && (!o.me.on || o.me.feet || t > BACK.up + BACK.fly + 1.5)) end()
        },
      })
    }))
  }
  // The backquote key, under Esc, wherever the realm's own keys are heard (not on a line being written, nor in a vehicle or the wheel).
  o.input.always('Backquote', (e) => { if (state !== 'in' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || !o.input.live('moving')) return false; e.preventDefault(); void back(); return true })

  // ── In the realm: the card of what the roof is for, a thumb's keys, and the way back ──
  let furnished = false
  const shown = () => {
    const ui = o.ui
    if (!ui) return
    ui.fold(true)
    // (Made once: in again, it is all where it was, and the card that said what the roof is for has said it.)
    if (furnished) return
    furnished = true
    const leave = Object.assign(document.createElement('button'), { className: 'vx-button home', type: 'button', textContent: 'Back to the view', title: 'Back to the first view (`)' })
    leave.setAttribute('aria-keyshortcuts', '`')
    leave.addEventListener('click', () => void back())
    ui.root.querySelector('.sky .foot')?.prepend(leave)
    const touch = matchMedia('(pointer: coarse)').matches
    const card = document.createElement('aside')
    card.className = 'vx-card help'
    card.setAttribute('aria-label', 'What you can do here')
    card.innerHTML = touch
      ? '<p class="chute">Tap <kbd class="vx-kbd">Chute</kbd> in the air to deploy a parachute.</p><p class="flies">Tap <kbd class="vx-kbd">Fly</kbd> to fly.</p>'
      : '<p class="chute">Press <kbd class="vx-kbd">Space</kbd> in the air to deploy a parachute.</p><p class="flies">Press <kbd class="vx-kbd">B</kbd> to fly.</p>'
    ui.root.append(card)
    // A thumb's key for B, over the two that rise and sink (on its feet the body has no use for the one that sinks,
    // and it is put away); the key that rises is the one that jumps and opens the canopy, and says so.
    const up = ui.root.querySelector<HTMLButtonElement>('.act .up'), down = ui.root.querySelector<HTMLButtonElement>('.act .down')
    const walks = Object.assign(document.createElement('button'), { className: 'vx-button walks', type: 'button', textContent: 'Fly' })
    walks.addEventListener('click', () => o.me.walk(!o.me.on))
    up?.before(walks)
    // (On its feet that key is Space as a key pressed is, not only held: the body's own mode jumps and opens the canopy by it.)
    up?.addEventListener('pointerdown', () => { if (o.me.on) dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })) })
    const adopt = () => { if (!ui.kit) return false; ui.kit.adopt(card); ui.kit.adopt(walks); ui.kit.adopt(leave); return true }
    if (!adopt()) { const wait = setInterval(() => { if (adopt()) clearInterval(wait) }, 200) }
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('on')))
    const said = { up: '', walks: '' }, did = { chute: false, flies: false }
    const legend = (el: HTMLElement | null, key: 'up' | 'walks', text: string) => { if (!el || said[key] === text) return; said[key] = text; (el.querySelector('.vx-label') ?? el).textContent = text; ui.kit?.refresh?.(el) }
    const since = performance.now()
    let leaving = 0
    const stop = o.watch(() => {
      const afoot = o.me.on
      legend(up, 'up', afoot ? (o.me.aloft && !o.me.canopy ? 'Chute' : 'Jump') : 'Up')
      legend(walks, 'walks', afoot ? 'Fly' : 'Walk')
      if (down) down.hidden = afoot
      if (o.me.canopy && !did.chute) { did.chute = true; card.querySelector('.chute')?.classList.add('done') }
      if (!afoot && !did.flies) { did.flies = true; card.querySelector('.flies')?.classList.add('done') }
      // Both done, or two minutes: it has said what it had to.
      if (!leaving && ((did.chute && did.flies) || performance.now() - since > 120_000)) { leaving = performance.now() + 2200 }
      if (leaving && performance.now() > leaving) { card.classList.remove('on'); setTimeout(() => card.remove(), 500); leaving = Infinity }
    })
    void stop
  }

  return {
    get state() { return state },
    act() { if (state === 'idle') arm(); else if (state === 'armed' && performance.now() - times.armed >= AGAIN) void go() },
    reframed() { if (rest) rest = { at: [pose.x * M, pose.y * M, pose.z * M], yaw: pose.yaw, pitch: pose.pitch, fov: o.fov() } },
    disarm,
    go,
    back,
    stand,
    times,
  }
}
