// World-entry & 3D Map fast-travel transition (#23): 3D Map-to-Reality Optical Dive.
//
// From Ina Coolbrith Park's first view, the EXPLORE board arms on click 1 (letters light, eye leans in, quiet hint,
// Financial District tiles pre-warm; Esc / click away / pointer away / timeout disarms cleanly so accidental clicks
// never enter). Click 2 (or host `explore` / `explore.go()`) lifts smoothly off the park into the stylized 3D WebGPU
// map of San Francisco, locks the live voxel + farModel camera pixel-for-pixel behind it (0-frame parallax lag),
// optically dissolves the 3D map straight into sunlit 10 cm streets, and swings behind the character's shoulder.
//
// Clicking `Visit` in the fullscreen 3D Map runs the exact same optical dive starting directly from the user's current
// map camera with zero jump. Pressing Backquote (`) or `Back to the view` arcs smoothly back to Ina Coolbrith Park.
//
// Fetched lazily after `seen.near`, adding zero bytes to cold load and zero `/bay/map.bin` fetches before click 2.
import type { Explore, Needs as ExploreNeeds } from './explore.ts'
import { LENS, footing, stand as findStand, type Ground } from './arrival.ts'
import { behindAt } from './person.ts'
import { cameraMatrices, type MapCamera } from './map-gpu.ts'
import { sampleElevation } from './nav-data.ts'
import type { MapCameraSnapshot, MapSystem } from './minimap.ts'

const M = 10
const EYES = 16.5
const DOWN = -0.1
/** How long an EXPLORE arming prompt stands (ms), how far the eye leans, and its lens push. */
const STANDS = 6000
const LEAN = 0.08
const PUSH = 0.965
/** Guard against accidental double-clicks or held key repeats counting as two distinct asks (ms). */
const AGAIN = 300
/** Default Financial District street landing target (metres, facing the skyline/canyon). */
const DEFAULT_TARGET: Required<EntryTarget> = {
  x: 52420,
  z: 66920,
  name: 'Financial District',
  yaw: 2.18,
}
type V3 = [number, number, number]

export interface EntryTarget {
  /** World metres (x east, z south). */
  x: number
  z: number
  /** Optional display label for the dive beacon and fleeting arrival title. */
  name?: string
  /** Optional desired arrival heading in radians (0 = North, +pi/2 = East). */
  yaw?: number
}

export interface EntryNeeds extends ExploreNeeds {
  map: MapSystem | null
  /** Triggers lazy MAP1 load if not already requested; resolves true when `map.ready` becomes true. */
  ensureMap(): Promise<boolean>
  /** Unlocks full 155-square farModel immediately. */
  leaveFar(): void
  /** Ground & voxel queries for guaranteed dry street placement (arrival.ts). */
  ground: Ground
  /** Bare terrain elevation in cells (`core.ground_at`). */
  terrainAt(x: number, z: number): number
  /** Ensures underfoot tiles around `(x, z)` cells are loaded in main core & workers. */
  hold(x: number, z: number): Promise<boolean>
  /** Current daylight level (0 = night, 1 = day). */
  day(): number
}

export interface EntryController {
  readonly state: Explore['state']
  /** Enters San Francisco via 3D Map-to-Reality Optical Dive (defaults to Financial District). */
  enter(target?: EntryTarget): Promise<void>
  /** Fast-travels from the 3D Map via optical dive from the user's current map camera. */
  visit(x: number, z: number, name: string, cam?: MapCameraSnapshot): Promise<void>
  /** Cancels an active Map Dive cleanly (e.g. if the player re-opens the map mid-dive with M). */
  cancelDive(): void
  /** Returns to the Ina Coolbrith Park first view cleanly. */
  back(): Promise<void>
  /** `Explore` interface wired into `main.ts` (`engine.explore`). */
  readonly explore: Explore
}

const STYLE = /* css */ `
/* Quiet arming line under EXPLORE on click 1. */
#explore-hint {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 7;
  margin: 0;
  padding: 5px 11px 6px;
  border-radius: 999px;
  font: 500 13px/1.25 var(--vx-font, system-ui, sans-serif);
  letter-spacing: 0.01em;
  white-space: nowrap;
  color: #fff;
  background: rgb(14 16 20 / 0.62);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  pointer-events: none;
  opacity: 0;
  scale: 0.97;
  transform-origin: 50% 0;
  transition: opacity 0.12s cubic-bezier(0.23, 1, 0.32, 1), scale 0.12s cubic-bezier(0.23, 1, 0.32, 1);
  will-change: transform, opacity;
}
#explore-hint.on { opacity: 1; scale: 1; transition-duration: 0.16s; }
#explore-hint.keys { transition: none; }
#explore-hint i { font-style: normal; opacity: 0.62; }
@media (prefers-reduced-transparency: reduce) {
  #explore-hint { background: rgb(14 16 20 / 0.94); -webkit-backdrop-filter: none; backdrop-filter: none; }
}

/* Keep HUD cues, minimap, and corner buttons clear while diving. */
html.entry-going #realm .cue,
html.entry-going #minimap { opacity: 0 !important; pointer-events: none !important; }
html.map-dive #first .corner,
html.map-dive #realm .fold { opacity: 0 !important; pointer-events: none !important; }

/* Back to the view wraps neatly inside the Sky settings panel footer. */
#realm .sky .foot { flex-wrap: wrap; row-gap: calc(var(--vx) * 3); min-inline-size: 0; }

/* Fleeting Vox Zakon arrival title. */
#entry-title {
  position: fixed;
  left: 50%;
  top: max(14vh, calc(env(safe-area-inset-top) + 64px));
  transform: translate(-50%, 6px);
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.55s cubic-bezier(0.22, 1, 0.36, 1), transform 0.65s cubic-bezier(0.22, 1, 0.36, 1);
  text-align: center;
}
#entry-title.on { opacity: 1; transform: translate(-50%, 0); }
#entry-title .et-main {
  font: 700 clamp(22px, 3.6vw, 40px)/1.05 var(--vx-display, var(--vx-font, system-ui, sans-serif));
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: #ffffff;
  text-shadow: 0 3px 20px rgb(0 0 0 / 0.52), 0 1px 2px rgb(0 0 0 / 0.65);
  padding-inline-start: 0.24em;
}
#entry-title .et-sub {
  font: 600 11.5px/1.2 var(--vx-font, -apple-system, system-ui, sans-serif);
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(240 245 252 / 0.86);
  text-shadow: 0 2px 12px rgb(0 0 0 / 0.65);
  padding-inline-start: 0.22em;
}
/* On portrait touch screens, sit cleanly below the top-center minimap, Back/Charge buttons, and street label. */
@media (pointer: coarse) and (orientation: portrait) {
  #entry-title {
    top: calc(env(safe-area-inset-top, 0px) + 184px);
    inline-size: calc(100vw - 32px);
  }
  #entry-title .et-main {
    font-size: clamp(18px, 5vw, 24px);
    letter-spacing: 0.16em;
    padding-inline-start: 0.16em;
  }
}
@media (pointer: coarse) and (orientation: landscape) {
  #entry-title {
    top: max(24vh, calc(env(safe-area-inset-top, 0px) + 98px));
  }
}

#entry-still {
  position: fixed;
  inset: 0;
  z-index: 45;
  inline-size: 100%;
  block-size: 100%;
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.4s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  #explore-hint, #entry-title, #entry-still { transition: none !important; scale: 1; }
}
`

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const smooth = (t: number) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c) }
const easeOutCubic = (t: number) => { const c = clamp(t, 0, 1); return 1 - (1 - c) * (1 - c) * (1 - c) }
const easeInOutCubic = (t: number) => { const c = clamp(t, 0, 1); return c < 0.5 ? 4 * c * c * c : 1 - ((-2 * c + 2) ** 3) / 2 }
const turnTo = (from: number, to: number) => {
  let d = (to - from) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return d
}
const mix3 = (a: readonly number[], b: readonly number[], t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

export function createEntry(o: EntryNeeds): EntryController {
  const { board, boards, pose } = o
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const hint = Object.assign(document.createElement('p'), { id: 'explore-hint' })
  hint.setAttribute('role', 'status')
  document.body.append(hint)

  let state: Explore['state'] = o.first.engaged ? 'in' : 'idle'
  const times = { armed: 0, went: 0, loaded: 0, settled: 0, waited: 0 }
  let resolvedStand = { x: DEFAULT_TARGET.x * M, z: DEFAULT_TARGET.z * M, yaw: DEFAULT_TARGET.yaw }
  let activeRun: Promise<void> | null = null
  let cancelRun: (() => void) | null = null
  let furnished = false

  // ── Fleeting Arrival Title ──
  const titleEl = document.createElement('div')
  titleEl.id = 'entry-title'
  titleEl.setAttribute('aria-live', 'polite')
  titleEl.innerHTML = '<div class="et-main"></div><div class="et-sub"></div>'
  document.body.append(titleEl)
  const titleMain = titleEl.querySelector<HTMLElement>('.et-main')!
  const titleSub = titleEl.querySelector<HTMLElement>('.et-sub')!
  let titleTimer = 0
  const showTitle = (main: string, sub = '', ms = 2400) => {
    clearTimeout(titleTimer)
    titleMain.textContent = main
    titleSub.textContent = sub
    titleSub.hidden = !sub
    titleEl.classList.add('on')
    titleTimer = window.setTimeout(() => titleEl.classList.remove('on'), ms)
  }

  // ── Click-1 Arming on EXPLORE Board (accidental-click guard + tile pre-warm) ──
  const sign = board.at
  let rest: { at: V3; yaw: number; pitch: number; fov: number } | null = null
  let lean = 0
  let lit = 0
  let armTimer = 0
  let pointerType = 'mouse'
  let warmDefault: Promise<boolean> | null = null

  addEventListener('pointerdown', (e) => { pointerType = e.pointerType }, true)
  const boardWhere = () => boards.where(board.id)
  const placeHint = () => {
    const w = boardWhere()
    if (!w) return
    const half = hint.offsetWidth / 2
    const x = Math.max(8 + half, Math.min(innerWidth - 8 - half, w.x))
    const y = Math.min(innerHeight - 40, w.y + w.high / 2 + 9)
    hint.style.transform = `translate(${Math.round(x - half)}px, ${Math.round(y)}px)`
  }

  const clearArmLean = () => {
    clearTimeout(armTimer)
    hint.classList.remove('on')
    rest = null
    lean = 0
    if (lit > 0) { lit = 0; boards.light(board.id, 0) }
  }

  const disarm = () => {
    if (state !== 'armed') return
    state = 'idle'
    times.armed = 0
    clearTimeout(armTimer)
    hint.classList.remove('on')
  }

  const arm = () => {
    if (state !== 'idle' || o.first.engaged) return
    state = 'armed'
    times.armed = performance.now()
    rest ??= { at: [pose.x * M, pose.y * M, pose.z * M], yaw: pose.yaw, pitch: pose.pitch, fov: o.fov() }
    const keys = (document.activeElement as HTMLElement | null)?.dataset?.board === board.id
    hint.classList.toggle('keys', keys)
    hint.innerHTML = keys
      ? 'Press Enter again to explore <i>· Esc to stay</i>'
      : pointerType === 'mouse'
        ? 'Click again to explore <i>· Esc to stay</i>'
        : 'Tap again to explore'
    placeHint()
    hint.classList.add('on')
    // Pre-warm Financial District tiles quietly on click 1 (zero /bay/map.bin bytes until click 2).
    warmDefault ??= Promise.resolve(o.near(Math.round(DEFAULT_TARGET.x * M), Math.round(DEFAULT_TARGET.z * M)))
      .then(Boolean, () => false)
      .then((had) => { if (!had) warmDefault = null; return had })
    clearTimeout(armTimer)
    armTimer = window.setTimeout(disarm, STANDS)
  }

  o.watch((gap) => {
    if (state !== 'idle' && state !== 'armed') return
    const dt = Math.min(0.1, gap / 1000)
    const on = state === 'armed' ? 1 : 0
    const quick = still.matches
    const was = lit
    lit = quick ? on : Math.max(0, Math.min(1, lit + (on ? dt / 0.16 : -dt / 0.26)))
    if (lit !== was) boards.light(board.id, Math.round(smooth(lit) * 8) / 8)
    if (rest && Math.hypot(pose.x * M - rest.at[0], pose.y * M - rest.at[1], pose.z * M - rest.at[2]) > 1) {
      o.setFov(rest.fov)
      rest = null
      lean = 0
      disarm()
    }
    if (rest && !quick) {
      lean += (on - lean) * (1 - Math.exp(-dt * (on ? 7 : 4.5)))
      if (!on && lean < 0.002) lean = 0
      const to = [sign[0] - rest.at[0], sign[1] + 60 - rest.at[1], sign[2] - rest.at[2]]
      const k = LEAN * lean
      pose.yaw = rest.yaw + turnTo(rest.yaw, Math.atan2(to[0], -to[2])) * k
      pose.pitch = rest.pitch + (Math.atan2(to[1], Math.hypot(to[0], to[2])) - rest.pitch) * k
      o.setFov(rest.fov * (1 - (1 - PUSH) * lean))
      if (!on && !lean) rest = null
    }
    if (on) placeHint()
  })

  addEventListener('pointermove', (e) => {
    if (state !== 'armed' || e.pointerType !== 'mouse') return
    const w = boardWhere()
    if (w && Math.hypot(Math.max(0, Math.abs(e.clientX - w.x) - w.wide / 2), Math.max(0, Math.abs(e.clientY - w.y) - w.high / 2)) > Math.max(140, w.wide)) disarm()
  })
  addEventListener('keydown', (e) => {
    if (state === 'armed' && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); disarm() }
  }, true)
  o.canvas.addEventListener('click', () => { if (state === 'armed') disarm() })
  addEventListener('blur', () => { if (state === 'armed') disarm() })

  // ── Realm Controls (`Back to the view` + Phone `Fly`/`Walk`/`Jump`/`Chute` Thumb Legends) ──
  const adoptKit = (...els: (Element | null)[]) => {
    const kit = o.ui?.kit
    if (!kit) return false
    for (const el of els) if (el && !el.hasAttribute('data-vx-live')) kit.adopt(el)
    return true
  }

  const furnishRealm = () => {
    const ui = o.ui
    if (!ui) return
    ui.fold(true)
    if (furnished) return
    furnished = true
    const foot = ui.root.querySelector('.sky .foot')
    let backBtn = foot?.querySelector<HTMLButtonElement>('button.home') ?? null
    if (foot && !backBtn) {
      backBtn = Object.assign(document.createElement('button'), {
        className: 'vx-button home',
        type: 'button',
        textContent: 'Back to the view',
        title: 'Back to the first view (`)',
      })
      backBtn.setAttribute('aria-keyshortcuts', '`')
      backBtn.addEventListener('click', () => void back())
      foot.prepend(backBtn)
    }
    const up = ui.root.querySelector<HTMLButtonElement>('.act .up')
    const down = ui.root.querySelector<HTMLButtonElement>('.act .down')
    let walks = ui.root.querySelector<HTMLButtonElement>('.act .walks')
    if (!walks && up) {
      walks = Object.assign(document.createElement('button'), { className: 'vx-button walks', type: 'button', textContent: 'Fly' })
      walks.addEventListener('click', () => o.me.walk(!o.me.on))
      up.before(walks)
      up.addEventListener('pointerdown', () => { if (o.me.on) dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })) })
      const said = { up: '', walks: '' }
      const legend = (el: HTMLElement | null, key: 'up' | 'walks', text: string) => {
        if (!el || said[key] === text) return
        said[key] = text
        const lbl = el.querySelector('.hud-lbl') ?? el.querySelector('.vx-label') ?? el
        lbl.textContent = text
        el.dataset.state = text.toLowerCase()
        ui.kit?.refresh?.(el)
      }
      o.watch(() => {
        const afoot = o.me.on
        const chuteReady = afoot && o.me.aloft && !o.me.canopy
        legend(up, 'up', afoot ? (chuteReady ? 'Chute' : 'Jump') : 'Up')
        legend(walks, 'walks', afoot ? 'Fly' : 'Walk')
        if (up && up.classList.contains('chute') !== chuteReady) {
          up.classList.toggle('chute', chuteReady)
          ui.kit?.refresh?.(up)
        }
        if (walks && walks.classList.contains('flying') !== !afoot) {
          walks.classList.toggle('flying', !afoot)
          ui.kit?.refresh?.(walks)
        }
        document.documentElement.classList.toggle('flying', o.first.engaged && !afoot)
        if (down) down.hidden = afoot
      })
    }
    if (!adoptKit(backBtn, walks)) {
      const wait = setInterval(() => { if (adoptKit(backBtn, walks)) clearInterval(wait) }, 200)
    }
  }

  // ── Shared Streaming, Street Placement, Reduced-Motion & Skip Helpers ──
  const openFov = () => (o.canvas.clientHeight > o.canvas.clientWidth ? LENS.upright : LENS.wide)
  const setPose = (atCells: readonly number[], yaw: number, pitch: number) => {
    Object.assign(pose, { x: atCells[0] / M, y: atCells[1] / M, z: atCells[2] / M, yaw, pitch })
  }
  const setGoing = (on: boolean) => document.documentElement.classList.toggle('entry-going', on)

  const streamTarget = (xM: number, zM: number, yHintM = 180): Promise<boolean> => {
    const gx = Math.round(xM * M), gz = Math.round(zM * M)
    o.leaveFar()
    o.focus([gx, Math.round(yHintM * M), gz])
    return Promise.all([
      o.hold(gx, gz),
      o.near(gx, gz),
    ]).then(([a, b]) => Boolean(a || b), () => false)
  }

  /** Finds a verified dry, level, clear-sightline street spot around `(xM, zM)` metres via `arrival.ts`. */
  const findStreetSpot = (xM: number, zM: number, preferredYaw: number) => {
    const gx = Math.round(xM * M), gz = Math.round(zM * M)
    const stood = findStand({
      host: null,
      own: { x: gx, z: gz, yaw: preferredYaw },
      spot: 0,
      ground: o.ground,
      others: [],
    })
    if (stood) return { at: stood.at, yaw: stood.yaw, pitch: Math.max(-0.18, stood.pitch), onFoot: true }
    for (let r = 60; r <= 600; r += 60) {
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2
        const cx = Math.round(gx + Math.cos(ang) * r), cz = Math.round(gz + Math.sin(ang) * r)
        const f = footing(o.ground, cx, cz)
        if (f !== null) return { at: [cx, f, cz] as V3, yaw: preferredYaw, pitch: DOWN, onFoot: true }
      }
    }
    const floor = Math.max(0, o.terrainAt(gx, gz), o.feet(gx, gz))
    return { at: [gx, floor + 260, gz] as V3, yaw: preferredYaw, pitch: -0.22, onFoot: false }
  }

  const spawnAtSpot = (spot: { at: V3; yaw: number; pitch: number; onFoot: boolean }) => {
    resolvedStand = { x: spot.at[0], z: spot.at[2], yaw: spot.yaw }
    if (spot.onFoot) {
      if (o.me.on) o.me.walk(false)
      Object.assign(pose, { x: spot.at[0] / M, y: (spot.at[1] + EYES + 2) / M, z: spot.at[2] / M, yaw: spot.yaw, pitch: spot.pitch })
      o.me.view = 'behind'
      o.me.standOff = 0
      o.me.walk(true)
    } else {
      if (o.me.on) o.me.walk(false)
      setPose(spot.at, spot.yaw, spot.pitch)
    }
  }

  const captureStill = async () => {
    const held = Object.assign(document.createElement('canvas'), { id: 'entry-still', width: o.canvas.width, height: o.canvas.height })
    await new Promise<void>((done) => setTimeout(() => requestAnimationFrame(() => {
      try { held.getContext('2d')!.drawImage(o.canvas, 0, 0) } catch { /* ignore */ }
      done()
    }), 0))
    return held
  }
  const fadeOutStill = (held: HTMLCanvasElement) => {
    held.style.opacity = '0'
    setTimeout(() => held.remove(), 460)
  }

  const skipping = (since: number, allowMapKey: boolean, cut: () => void) => {
    const skip = (e: Event) => {
      const key = e instanceof KeyboardEvent ? e : null
      if (key && (['Shift', 'Control', 'Alt', 'Meta'].includes(key.key) || key.ctrlKey || key.metaKey || key.altKey || /^F\d+$/.test(key.key))) return
      // During Map Visit fast-travel, let plain `M` pass through to reopen the map cleanly (cancelling the dive).
      if (allowMapKey && key && key.code === 'KeyM' && !key.shiftKey) return
      key?.preventDefault()
      e.stopImmediatePropagation()
      if (e.type === 'pointerdown') o.hush()
      if (key?.repeat) return
      if (performance.now() - since > 420) cut()
    }
    const types = ['keydown', 'pointerdown', 'wheel']
    for (const type of types) addEventListener(type, skip, true)
    return () => { for (const type of types) removeEventListener(type, skip, true) }
  }

  // ── 3D Map-to-Reality Optical Dive (World Entry & Map Visit) ──
  const runMapDive = async (target: EntryTarget, fromMap?: MapCameraSnapshot): Promise<void> => {
    cancelRun?.()
    clearArmLean()
    let cancelled = false
    const stops: (() => void)[] = []
    let resolvePending: (() => void) | null = null
    const entering = !o.first.engaged

    const cleanup = () => {
      if (cancelled) return
      cancelled = true
      for (const s of stops.splice(0)) s()
      o.shot(null)
      o.focus(null)
      o.map?.setDive(null)
      setGoing(false)
      if (!entering) {
        o.setFov(openFov())
        state = 'in'
      }
      resolvePending?.()
      resolvePending = null
    }
    cancelRun = cleanup

    state = 'going'
    setGoing(true)
    times.went = performance.now()
    o.alight()
    if (o.me.on) o.me.walk(false)

    const destName = target.name ?? DEFAULT_TARGET.name
    const destYaw = target.yaw ?? DEFAULT_TARGET.yaw
    const streamP = streamTarget(target.x, target.z, 180)
    const mapReadyP = o.ensureMap()

    // Reduced-motion path: crisp still-frame cross-fade straight onto the street.
    if (still.matches) {
      const held = await captureStill()
      if (cancelled) return
      document.body.append(held)
      await Promise.race([streamP, new Promise((r) => setTimeout(r, 4500))])
      if (cancelled) { held.remove(); return }
      const spot = findStreetSpot(target.x, target.z, destYaw)
      o.focus(null)
      o.setFov(openFov())
      spawnAtSpot(spot)
      times.loaded = times.settled = performance.now()
      state = 'in'
      setGoing(false)
      if (entering) o.first.engage()
      furnishRealm()
      showTitle(destName, entering ? 'San Francisco' : '')
      await new Promise((r) => setTimeout(r, 180))
      fadeOutStill(held)
      cancelRun = null
      return
    }

    // Give MAP1 a brief window (max 260 ms) to arrive before starting the lift so the 3D map is ready immediately.
    await Promise.race([mapReadyP, new Promise((r) => setTimeout(r, 260))])
    if (cancelled) return

    let streamDone = false
    void streamP.then(() => { streamDone = true; times.loaded ||= performance.now() })

    const startPose = { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch, fov: o.fov() }
    const cam0 = fromMap
      ? { cx: fromMap.cx, cz: fromMap.cz, yaw: fromMap.yaw, tilt: fromMap.tilt, span: Math.max(fromMap.span, 240), extrude: fromMap.extrude }
      : { cx: (pose.x + target.x) * 0.5, cz: (pose.z + target.z) * 0.5, yaw: 0.45, tilt: 0.76, span: 1520, extrude: 1.0 }
    const cam1 = { cx: target.x, cz: target.z, yaw: destYaw, tilt: 0.94, span: 125, extrude: 1.0 }
    const dissolveHi = fromMap ? Math.max(220, Math.min(680, cam0.span * 0.86)) : 680
    const dissolveLo = Math.min(165, dissolveHi - 55)

    const sampleGroundM = () => {
      const gx = Math.round(target.x * M), gz = Math.round(target.z * M)
      const coreG = o.terrainAt(gx, gz) / M
      if (streamDone && Number.isFinite(coreG) && coreG >= 0) return coreG
      if (o.map?.data) return sampleElevation(o.map.data, target.x, target.z)
      return Math.max(0, coreG)
    }
    let groundM = sampleGroundM()

    const aspect = () => Math.max(0.4, (o.canvas.clientWidth || innerWidth) / Math.max(1, o.canvas.clientHeight || innerHeight))
    const buildMapCam = (cx: number, cz: number, yaw: number, tilt: number, span: number, extrude: number, tSec: number): MapCamera => ({
      cx, cz, yaw, tilt, span,
      style: 1,
      extrude,
      targetOffsetY: 0,
      playerX: target.x,
      playerZ: target.z,
      routeAlong: 0,
      routeFadeLen: 0,
      time: tSec,
      destActive: true,
      destX: target.x,
      destZ: target.z,
      night: clamp(1 - o.day(), 0, 1),
    })

    // Syncs the live raymarched + farModel camera pixel-for-pixel to `MapCamera`, offset by real terrain elevation.
    const syncWorldToMap = (cam: MapCamera) => {
      const { eye } = cameraMatrices(cam, aspect())
      const wantG = sampleGroundM()
      groundM += (wantG - groundM) * 0.12
      pose.x = eye[0]
      pose.y = eye[1] + groundM
      pose.z = eye[2]
      pose.yaw = cam.yaw
      pose.pitch = clamp(cam.tilt - Math.PI / 2, -1.48, -0.1)
      o.setFov(36)
    }

    const LIFT_DUR = fromMap ? 0.0 : 0.55
    const DIVE_DUR = fromMap ? 1.95 : 2.05
    const SWING_DUR = 0.58

    await new Promise<void>((resolve) => {
      resolvePending = resolve
      let phase: 'lift' | 'dive' | 'swing' = fromMap ? 'dive' : 'lift'
      let began = performance.now()
      let cutRequested = false
      let swingFrom: { at: V3; yaw: number; pitch: number; fov: number } | null = null
      let spot: { at: V3; yaw: number; pitch: number; onFoot: boolean } | null = null
      let titleShown = false

      const finish = () => {
        if (cancelled) { resolve(); return }
        resolvePending = null
        o.shot(null)
        o.focus(null)
        o.map?.setDive(null)
        setGoing(false)
        for (const s of stops.splice(0)) s()
        spot ??= findStreetSpot(target.x, target.z, destYaw)
        spawnAtSpot(spot)
        o.setFov(openFov())
        if (!titleShown) { titleShown = true; showTitle(destName, entering ? 'San Francisco' : '') }
        times.settled = performance.now()
        state = 'in'
        if (entering) o.first.engage()
        furnishRealm()
        cancelRun = null
        resolve()
      }

      stops.push(skipping(times.went, !entering, () => {
        cutRequested = true
        if (streamDone) finish()
      }))

      // Lift endpoint = exact world pose of `cam0` so Lift → Map Dive has zero jump.
      const cam0Mat = cameraMatrices(buildMapCam(cam0.cx, cam0.cz, cam0.yaw, cam0.tilt, cam0.span, cam0.extrude, 0), aspect())
      const liftToAt: V3 = [cam0Mat.eye[0] * M, (cam0Mat.eye[1] + groundM) * M, cam0Mat.eye[2] * M]
      const liftToYaw = cam0.yaw
      const liftToPitch = clamp(cam0.tilt - Math.PI / 2, -1.48, -0.1)

      o.shot({
        after() {
          if (cancelled) return
          const now = performance.now()
          const elapsed = (now - began) / 1000

          if (phase === 'lift') {
            const u = clamp(elapsed / LIFT_DUR, 0, 1)
            const e = easeInOutCubic(u)
            const fromAt: V3 = [startPose.x * M, startPose.y * M, startPose.z * M]
            const mid = mix3(fromAt, liftToAt, e)
            mid[1] += Math.sin(e * Math.PI) * 1400
            setPose(mid, startPose.yaw + turnTo(startPose.yaw, liftToYaw) * e, startPose.pitch + (liftToPitch - startPose.pitch) * e)
            o.setFov(startPose.fov + (36 - startPose.fov) * e)
            if (o.map?.ready && u > 0.35) {
              const mapIn = smooth((u - 0.35) / 0.65)
              const liveCam0 = buildMapCam(cam0.cx, cam0.cz, cam0.yaw, cam0.tilt, cam0.span, cam0.extrude, now / 1000)
              o.map.setDive({ cam: liveCam0, opacity: mapIn, target: { x: target.x, z: target.z, name: destName } })
            }
            if (u >= 1) {
              phase = 'dive'
              began = now
            }
            return
          }

          if (phase === 'dive') {
            const rawU = clamp(elapsed / DIVE_DUR, 0, 1)
            const uPos = easeOutCubic(rawU)
            const span = cam0.span * Math.pow(cam1.span / cam0.span, easeInOutCubic(rawU))
            const cx = cam0.cx + (cam1.cx - cam0.cx) * uPos
            const cz = cam0.cz + (cam1.cz - cam0.cz) * uPos
            const yaw = cam0.yaw + turnTo(cam0.yaw, cam1.yaw) * easeInOutCubic(rawU)
            const tilt = cam0.tilt + (cam1.tilt - cam0.tilt) * smooth(rawU)
            const extrude = cam0.extrude + (cam1.extrude - cam0.extrude) * smooth(Math.min(1, rawU * 2.2))

            const cam = buildMapCam(cx, cz, yaw, tilt, span, extrude, now / 1000)
            syncWorldToMap(cam)

            if (o.map?.ready) {
              const mapOpacity = span > dissolveHi ? 1 : span < dissolveLo ? 0 : smooth((span - dissolveLo) / (dissolveHi - dissolveLo))
              if (mapOpacity > 0.005) {
                o.map.setDive({ cam, opacity: mapOpacity, target: { x: target.x, z: target.z, name: destName } })
              } else {
                o.map.setDive(null)
              }
            }

            if ((rawU >= 1 || cutRequested) && (streamDone || elapsed > DIVE_DUR + 2.4)) {
              o.map?.setDive(null)
              spot = findStreetSpot(target.x, target.z, destYaw)
              spawnAtSpot(spot)
              swingFrom = { at: [pose.x * M, pose.y * M, pose.z * M], yaw: pose.yaw, pitch: pose.pitch, fov: o.fov() }
              phase = 'swing'
              began = now
              if (!titleShown) { titleShown = true; showTitle(destName, entering ? 'San Francisco' : '') }
              if (cutRequested) finish()
            }
            return
          }

          const u = clamp(elapsed / SWING_DUR, 0, 1)
          const e = easeOutCubic(u)
          const targetEye = spot!.onFoot ? behindAt(spot!.at, spot!.yaw, spot!.pitch, 0) : spot!.at
          setPose(
            mix3(swingFrom!.at, targetEye, e),
            swingFrom!.yaw + turnTo(swingFrom!.yaw, spot!.yaw) * e,
            swingFrom!.pitch + (spot!.pitch - swingFrom!.pitch) * e,
          )
          o.setFov(swingFrom!.fov + (openFov() - swingFrom!.fov) * e)
          if (u >= 1) finish()
        },
      })
    })
  }

  // ── Enter / Visit / Cancel / Back ──
  const enter = (target?: EntryTarget): Promise<void> => {
    if (activeRun) return activeRun
    const run = runMapDive(target ?? DEFAULT_TARGET).finally(() => { activeRun = null })
    activeRun = run
    return run
  }

  const visit = (x: number, z: number, name: string, cam?: MapCameraSnapshot): Promise<void> => {
    if (activeRun) return activeRun
    const run = runMapDive({ x, z, name }, cam).finally(() => { activeRun = null })
    activeRun = run
    return run
  }

  const cancelDive = () => {
    cancelRun?.()
    cancelRun = null
  }

  const back = async (): Promise<void> => {
    cancelDive()
    o.map?.setDive(null)
    if (o.map?.open) o.map.toggle(false)
    if (state !== 'in') return
    state = 'leaving'
    o.alight()
    o.first.back()
    if (document.pointerLockElement) document.exitPointerLock()
    if (o.me.on) o.me.walk(false)
    o.me.standOff = 0

    const home = o.home()
    const homeCells: V3 = [home.at[0] * M, home.at[1] * M, home.at[2] * M]
    o.focus(homeCells)
    void o.hold(Math.round(homeCells[0]), Math.round(homeCells[2]))

    if (still.matches) {
      const held = await captureStill()
      document.body.append(held)
      setPose(homeCells, home.yaw, home.pitch)
      o.setFov(home.fov)
      await new Promise((r) => setTimeout(r, 320))
      o.focus(null)
      state = 'idle'
      fadeOutStill(held)
      return
    }

    const fromAt: V3 = [pose.x * M, pose.y * M, pose.z * M]
    const fromYaw = pose.yaw, fromPitch = pose.pitch, fromFov = o.fov()
    const BACK_DUR = 1.45
    await new Promise<void>((resolve) => {
      const began = performance.now()
      const finish = () => {
        o.shot(null)
        o.focus(null)
        const nowHome = o.home()
        setPose([nowHome.at[0] * M, nowHome.at[1] * M, nowHome.at[2] * M], nowHome.yaw, nowHome.pitch)
        o.setFov(nowHome.fov)
        state = 'idle'
        resolve()
      }
      const stopSkip = skipping(began, false, () => { stopSkip(); finish() })
      o.shot({
        after() {
          const u = clamp((performance.now() - began) / 1000 / BACK_DUR, 0, 1)
          const e = easeInOutCubic(u)
          const at = mix3(fromAt, homeCells, e)
          at[1] += Math.sin(e * Math.PI) * 900
          setPose(at, fromYaw + turnTo(fromYaw, home.yaw) * e, fromPitch + (home.pitch - fromPitch) * e)
          o.setFov(fromFov + (home.fov - fromFov) * e)
          if (u >= 1) { stopSkip(); finish() }
        },
      })
    })
  }

  // Backquote (`) returns cleanly to the first view whenever playing on foot/flying.
  o.input.always('Backquote', (e) => {
    if (state !== 'in' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || !o.input.live('moving')) return false
    e.preventDefault()
    void back()
    return true
  })

  const exploreApi: Explore = {
    get state() { return state },
    act() {
      if (state === 'idle') arm()
      else if (state === 'armed' && performance.now() - times.armed >= AGAIN) void enter()
    },
    reframed() {
      if (rest) rest = { at: [pose.x * M, pose.y * M, pose.z * M], yaw: pose.yaw, pitch: pose.pitch, fov: o.fov() }
    },
    disarm,
    go() { return enter() },
    back,
    get stand() { return resolvedStand },
    times,
  }

  return {
    get state() { return state },
    enter,
    visit,
    cancelDive,
    back,
    explore: exploreApi,
  }
}
