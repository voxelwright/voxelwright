// Gamepad API & touch steering curve tests (#34).
// Runs fast Node unit tests by default (zero browser needed).
// Pass `--browser [--out dir]` to also verify end-to-end gamepad driving on `/city?living=finecar` in real Chrome.
//
//   node test/gamepad.mjs
//   node test/gamepad.mjs --browser --out /tmp/gamepad-shots
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  STICK_DEADZONE,
  TOUCH_DEADZONE,
  TRIGGER_DEADZONE,
  deadzone,
  gamepad,
  lookCurve,
  radialDeadzone,
  steerCurve,
  touchSteerCurve,
  triggerCurve,
} from '../page/gamepad.ts'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const approx = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps

// Helper: make a standard 16-button, 4-axis mock Gamepad (Xbox / DualSense layout).
function makePad({ index = 0, connected = true, axes = [0, 0, 0, 0], buttons = {}, rumble = true, throwRumble = false, rejectRumble = false } = {}) {
  const btns = Array.from({ length: 16 }, (_, i) => {
    const spec = buttons[i]
    if (typeof spec === 'number') return { pressed: spec >= 0.5, value: spec }
    if (typeof spec === 'boolean') return { pressed: spec, value: spec ? 1 : 0 }
    if (spec && typeof spec === 'object') return { pressed: Boolean(spec.pressed), value: spec.value ?? (spec.pressed ? 1 : 0) }
    return { pressed: false, value: 0 }
  })
  const effects = []
  let resets = 0
  const vibrationActuator = rumble
    ? {
        playEffect(type, params) {
          if (throwRumble) throw new Error('playEffect unsupported')
          effects.push({ type, ...params })
          return rejectRumble ? Promise.reject(new Error('not allowed')) : Promise.resolve('complete')
        },
        reset() {
          resets++
          if (throwRumble) throw new Error('reset unsupported')
          return rejectRumble ? Promise.reject(new Error('not allowed')) : Promise.resolve('complete')
        },
      }
    : undefined
  return {
    pad: { index, connected, mapping: 'standard', axes: [...axes], buttons: btns, vibrationActuator },
    effects,
    get resets() { return resets },
  }
}

// ── 1. Curve & deadzone math ──────────────────────────────────────────────────
check(deadzone(0) === 0 && deadzone(0.119) === 0 && deadzone(-0.12) === 0, `deadzone zeroes inputs within +- ${STICK_DEADZONE}`)
check(approx(deadzone(1), 1) && approx(deadzone(-1), -1), 'deadzone reaches exact +-1 at full deflection')
check(deadzone(0.56) > 0.49 && deadzone(0.56) < 0.51, `deadzone rescales smoothly past edge (0.56 -> ${deadzone(0.56).toFixed(3)})`)

const [rdx0, rdy0] = radialDeadzone(0.08, 0.08)
check(rdx0 === 0 && rdy0 === 0, 'radialDeadzone zeroes diagonal micro-drift inside circle')
const [rdx1, rdy1] = radialDeadzone(1, 1)
check(approx(Math.hypot(rdx1, rdy1), 1, 1e-3), `radialDeadzone clamps diagonal full deflection to unit circle (${Math.hypot(rdx1, rdy1).toFixed(4)})`)

// Precision cubic steering curve: gentle near center, full lock at rim, odd-symmetric.
check(steerCurve(0.11) === 0 && steerCurve(-0.12) === 0, 'steerCurve honors 0.12 deadzone')
const sQuarter = steerCurve(0.34) // ~0.25 normalized past 0.12
const sHalf = steerCurve(0.56)    // ~0.50 normalized past 0.12
const sFull = steerCurve(1.0)
check(sQuarter > 0 && sQuarter < 0.12 && sHalf > sQuarter && sHalf < 0.30 && approx(sFull, 1),
  `steerCurve is gentle around center (${sQuarter.toFixed(3)} at 25%, ${sHalf.toFixed(3)} at 50%) and full lock at edge (${sFull.toFixed(3)})`)
check(approx(steerCurve(-0.6), -steerCurve(0.6)), 'steerCurve is strictly odd-symmetric')

// Mobile touch steering curve polish.
check(touchSteerCurve(TOUCH_DEADZONE * 0.9) === 0, `touchSteerCurve zeroes small thumb jitter within ${TOUCH_DEADZONE}`)
const tSmall = touchSteerCurve(0.30, 0)
const tFull = touchSteerCurve(1.0, 0)
check(tSmall > 0 && tSmall < 0.18 && approx(tFull, 1) && approx(touchSteerCurve(-0.5, 0), -touchSteerCurve(0.5, 0)),
  `touchSteerCurve softens small thumb movement (0.30 -> ${tSmall.toFixed(3)}) and hits full lock (${tFull.toFixed(3)})`)

// Progressive analog triggers.
check(triggerCurve(0) === 0 && triggerCurve(TRIGGER_DEADZONE) === 0, `triggerCurve ignores resting noise <= ${TRIGGER_DEADZONE}`)
const trigHalf = triggerCurve(0.52)
check(trigHalf > 0.30 && trigHalf < 0.45 && approx(triggerCurve(1), 1),
  `triggerCurve provides progressive partial-throttle modulation (0.52 -> ${trigHalf.toFixed(3)}, 1.0 -> ${triggerCurve(1).toFixed(3)})`)

// Right-stick look curve.
const [lk0x, lk0y] = lookCurve(0.1, -0.05)
const [lk1x, lk1y] = lookCurve(1, 0)
check(lk0x === 0 && lk0y === 0 && approx(lk1x, 1) && approx(lk1y, 0), 'lookCurve applies radial deadzone and reaches full speed at edge')

// ── 2. Zero overhead when disconnected ────────────────────────────────────────
{
  const target = new EventTarget()
  let getPadsCalls = 0
  let currentPads = []
  const origNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const gp = gamepad({
    target,
    getGamepads: () => { getPadsCalls++; return currentPads },
    reducedMotion: () => false,
  })
  const turnIdle = gp.poll(1 / 60)
  gp.rumble({ rpm: 0.9, slip: 0.8, rough: 0.9, speed: 120, grounded: true, drifting: true })
  gp.pulse('crash', 1)
  check(getPadsCalls === 0 && !gp.connected && !gp.active && gp.driveAxes === null && turnIdle[0] === 0 && turnIdle[1] === 0,
    'zero overhead before gamepadconnected: getGamepads() never called and driveAxes is null')

  // Connect and disconnect cleanly.
  const m = makePad({ axes: [0.56, 0, 0.8, -0.5], buttons: { 7: 0.6 } })
  currentPads = [m.pad]
  const ev = new Event('gamepadconnected')
  Object.defineProperty(ev, 'gamepad', { value: m.pad })
  target.dispatchEvent(ev)
  const turnActive = gp.poll(1 / 60)
  check(getPadsCalls === 1 && gp.connected && gp.active && gp.driveAxes !== null && gp.driveAxes.go > 0.3 && turnActive[0] > 0 && turnActive[1] > 0,
    `after gamepadconnected: polls pad, maps RT throttle (${gp.driveAxes?.go.toFixed(3)}), left steer (${gp.driveAxes?.turn.toFixed(3)}), right-stick look (${turnActive[0].toFixed(3)}, ${turnActive[1].toFixed(3)})`)

  // Disconnect returns to zero overhead and clears state.
  currentPads = []
  const disc = new Event('gamepaddisconnected')
  Object.defineProperty(disc, 'gamepad', { value: m.pad })
  target.dispatchEvent(disc)
  const callsAfterDisc = getPadsCalls
  gp.poll(1 / 60)
  check(!gp.connected && !gp.active && gp.driveAxes === null && getPadsCalls === callsAfterDisc,
    'after gamepaddisconnected: returns to zero polling overhead and nulls driveAxes')
  gp.dispose()
  if (origNav) Object.defineProperty(globalThis, 'navigator', origNav)
}

// ── 3. Analog throttle/brake, driving buttons & edge-triggers ─────────────────
{
  const target = new EventTarget()
  let nowMs = 1000
  let mounted = true
  let textMode = false
  let currentPads = []
  const keysFired = []
  let usesFired = 0

  const gp = gamepad({
    target,
    getGamepads: () => currentPads,
    reducedMotion: () => false,
    now: () => nowMs,
    isMounted: () => mounted,
    isText: () => textMode,
    key: (code) => keysFired.push(code),
    use: () => { usesFired++ },
  })

  const connect = (m) => {
    currentPads = [m.pad]
    const ev = new Event('gamepadconnected')
    Object.defineProperty(ev, 'gamepad', { value: m.pad })
    target.dispatchEvent(ev)
  }

  // Partial RT gas + slight LT trail-brake + curved left steering + A handbrake + B boost + LB look-back + L3 horn.
  const m1 = makePad({
    axes: [-0.6, 0, 0, 0],
    buttons: { 0: 0.75, 1: 1, 3: true, 4: true, 5: true, 6: 0.25, 7: 0.85, 10: true, 11: true },
  })
  connect(m1)
  gp.poll(1 / 60)
  const da1 = { ...gp.driveAxes }
  const expectedGo = triggerCurve(0.85) - triggerCurve(0.25)
  check(approx(da1.go, expectedGo, 1e-3), `analog RT (0.85) - LT (0.25) = ${da1.go.toFixed(3)} (expected ${expectedGo.toFixed(3)})`)
  check(approx(da1.turn, steerCurve(-0.6), 1e-3), `curved steering axis = ${da1.turn.toFixed(3)}`)
  check(approx(da1.handbrake, 0.75, 1e-3) && approx(da1.boost, 1, 1e-3) && da1.lookBack === true,
    'A handbrake, B boost, and LB lookBack map cleanly into driveAxes')
  check(gp.held('KeyH') && gp.held('ShiftLeft'), 'L3 holds KeyH (horn) and B holds ShiftLeft (boost) while mounted')
  check(keysFired.includes('KeyE') && keysFired.includes('KeyC') && keysFired.includes('KeyV'),
    `rising edge triggers Y->KeyE, RB->KeyC, R3->KeyV (fired: ${keysFired.join(', ')})`)

  // Holding the same buttons on the next frame MUST NOT re-fire edge-triggered keys!
  const countBefore = keysFired.length
  gp.poll(1 / 60)
  check(keysFired.length === countBefore, 'holding buttons does not repeat edge-triggered keys')

  // Release and press D-pad Up (12) -> KeyV again.
  currentPads = [makePad({ buttons: {} }).pad]
  gp.poll(1 / 60)
  check(!gp.held('KeyH') && gp.driveAxes.lookBack === false && gp.driveAxes.go === 0, 'releasing buttons clears held keys and zeroes driveAxes')
  currentPads = [makePad({ buttons: { 12: true } }).pad]
  gp.poll(1 / 60)
  check(keysFired.at(-1) === 'KeyV', 'D-pad Up edge-triggers KeyV (driver seat)')

  // D-pad Right (15) -> KeyF (repair vehicle) while mounted.
  currentPads = [makePad({ buttons: { 15: true } }).pad]
  gp.poll(1 / 60)
  check(keysFired.at(-1) === 'KeyF', 'D-pad Right edge-triggers KeyF (repair vehicle) while mounted')

  // Full reverse on LT alone.
  currentPads = [makePad({ buttons: { 6: 0.9 } }).pad]
  gp.poll(1 / 60)
  check(gp.driveAxes.go < -0.6 && gp.driveAxes.go >= -1, `LT brake/reverse produces negative go (${gp.driveAxes.go.toFixed(3)})`)

  // On-foot mode: left stick walks, A jumps (Space), RT/X uses tool, L3/LB sprints, Y enters vehicle (KeyE).
  mounted = false
  keysFired.length = 0
  usesFired = 0
  currentPads = [makePad({ axes: [0.5, -0.8, 0, 0], buttons: { 0: true, 2: true, 4: true, 7: 0.9, 13: true } }).pad]
  gp.poll(1 / 60)
  check(gp.stick[0] > 0 && gp.stick[1] < 0, `on-foot left stick drives stick [${gp.stick[0].toFixed(2)}, ${gp.stick[1].toFixed(2)}]`)
  check(gp.held('Space') && gp.held('ShiftLeft') && keysFired.includes('Space') && keysFired.includes('KeyB') && usesFired >= 1,
    `on-foot bindings fire Space jump, ShiftLeft sprint, KeyB walk/fly, and tool use() (uses=${usesFired})`)

  // Text mode suppresses all gamepad actions.
  textMode = true
  keysFired.length = 0
  usesFired = 0
  currentPads = [makePad({ axes: [1, -1, 1, -1], buttons: { 0: true, 3: true, 7: 1, 10: true } }).pad]
  const turnText = gp.poll(1 / 60)
  check(turnText[0] === 0 && turnText[1] === 0 && gp.stick[0] === 0 && gp.driveAxes.go === 0 && !gp.held('Space') && keysFired.length === 0 && usesFired === 0,
    'text mode suppresses stick, look, triggers, held keys, and edge triggers')
  gp.dispose()
}

// ── 4. Dual-motor haptic rumble & safe browser fallbacks ──────────────────────
{
  const target = new EventTarget()
  let nowMs = 1000
  let reduced = false
  const m = makePad({ rumble: true })
  const currentPads = [m.pad]

  const gp = gamepad({
    target,
    getGamepads: () => currentPads,
    reducedMotion: () => reduced,
    now: () => nowMs,
    isMounted: () => true,
  })
  const ev = new Event('gamepadconnected')
  Object.defineProperty(ev, 'gamepad', { value: m.pad })
  target.dispatchEvent(ev)
  gp.poll(1 / 60)

  // Drift + high RPM -> weak motor purr + slip scrub.
  gp.rumble({ rpm: 0.85, slip: 0.7, rough: 0.05, speed: 120, grounded: true, drifting: true })
  check(m.effects.length === 1 && m.effects[0].type === 'dual-rumble' && m.effects[0].weakMagnitude > 0.35 && m.effects[0].strongMagnitude > 0.1,
    `drift telemetry triggers dual-rumble (weak=${m.effects[0]?.weakMagnitude.toFixed(2)}, strong=${m.effects[0]?.strongMagnitude.toFixed(2)})`)

  // Throttling: immediate second call within 50ms is skipped.
  nowMs += 16
  gp.rumble({ rpm: 0.85, slip: 0.7, rough: 0.05, speed: 120, grounded: true, drifting: true })
  check(m.effects.length === 1, 'continuous rumble is throttled within 50ms window')

  // Off-road gravel texture buzz after 60ms.
  nowMs += 60
  gp.rumble({ rpm: 0.45, slip: 0, rough: 0.9, speed: 80, grounded: true, drifting: false })
  check(m.effects.length === 2 && m.effects[1].weakMagnitude > 0.12 && m.effects[1].strongMagnitude > 0.06,
    `off-road gravel triggers crisp dual-motor texture buzz (weak=${m.effects[1]?.weakMagnitude.toFixed(2)}, strong=${m.effects[1]?.strongMagnitude.toFixed(2)})`)

  // One-shot impact pulses: landing, upshift, crash.
  gp.pulse('land', 0.8)
  const landFx = m.effects.at(-1)
  check(landFx.strongMagnitude > 0.7 && landFx.duration >= 150, `SF hill landing fires strong-motor thump (strong=${landFx.strongMagnitude.toFixed(2)}, ${landFx.duration}ms)`)

  gp.pulse('shift', 0.8)
  const shiftFx = m.effects.at(-1)
  check(shiftFx.strongMagnitude > 0.3 && shiftFx.duration <= 80, `gear upshift fires crisp short kick (strong=${shiftFx.strongMagnitude.toFixed(2)}, ${shiftFx.duration}ms)`)

  gp.pulse('crash', 1.0)
  const crashFx = m.effects.at(-1)
  check(crashFx.strongMagnitude >= 0.99 && crashFx.duration >= 250, `hard crash fires heavy impact thump (strong=${crashFx.strongMagnitude.toFixed(2)}, ${crashFx.duration}ms)`)

  // prefers-reduced-motion: reduce silences haptics and stops active motors.
  reduced = true
  const beforeReduced = m.effects.length
  const resetsBefore = m.resets
  gp.pulse('crash', 1)
  gp.rumble({ rpm: 0.9, slip: 0.9, rough: 0.9, speed: 150, grounded: true, drifting: true })
  check(m.effects.length === beforeReduced && m.resets > resetsBefore, 'prefers-reduced-motion: reduce suppresses rumble and resets motors')

  // Null telemetry stops rumble cleanly.
  reduced = false
  nowMs += 500
  gp.rumble({ rpm: 0.8, slip: 0.5, rough: 0.05, speed: 100, grounded: true, drifting: true })
  const resetsBeforeNull = m.resets
  gp.rumble(null)
  check(m.resets > resetsBeforeNull, 'rumble(null) silences active motors')
  gp.dispose()
}

// ── 5. Browsers without vibrationActuator or throwing/rejecting playEffect ────
for (const [label, opts] of [
  ['no vibrationActuator (Safari/Firefox)', { rumble: false }],
  ['throwing playEffect', { rumble: true, throwRumble: true }],
  ['rejecting playEffect promise', { rumble: true, rejectRumble: true }],
]) {
  const target = new EventTarget()
  const m = makePad(opts)
  const gp = gamepad({ target, getGamepads: () => [m.pad], reducedMotion: () => false })
  const ev = new Event('gamepadconnected')
  Object.defineProperty(ev, 'gamepad', { value: m.pad })
  target.dispatchEvent(ev)
  let threw = false
  try {
    gp.poll(1 / 60)
    gp.rumble({ rpm: 0.9, slip: 0.8, rough: 0.9, speed: 120, grounded: true, drifting: true })
    gp.pulse('crash', 1)
    gp.pulse('land', 0.9)
    gp.pulse('shift', 0.7)
    gp.rumble(null)
    gp.dispose()
  } catch {
    threw = true
  }
  check(!threw, `never throws on ${label}`)
}

// ── 6. Optional Playwright live-page integration proof (--browser) ────────────
if (process.argv.includes('--browser')) {
  const { arg, start, still } = await import('./kit.mjs')
  const out = arg('out', '') && resolve(arg('out', ''))
  if (out) mkdirSync(out, { recursive: true })
  const { city, finish } = await start()
  try {
    const page = await city('fire=0&people=0&living=finecar', { size: [1280, 720], dpr: 1 })
    await page.waitForFunction(() => globalThis.engine?.alive?.things?.length === 1 && globalThis.engine.alive.where(globalThis.engine.alive.things[0]), null, { timeout: 30_000 })
    await still(page)

    // Inject mock W3C Gamepad on navigator.getGamepads with dual-rumble spy.
    await page.evaluate(() => {
      const state = {
        connected: true,
        index: 0,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
        effects: [],
      }
      const pad = {
        get index() { return state.index },
        get connected() { return state.connected },
        get mapping() { return state.mapping },
        get axes() { return state.axes },
        get buttons() { return state.buttons },
        vibrationActuator: {
          playEffect(type, params) {
            state.effects.push({ type, ...params })
            return Promise.resolve('complete')
          },
          reset() { return Promise.resolve('complete') },
        },
      }
      globalThis.__gp = { state, pad }
      navigator.getGamepads = () => (state.connected ? [pad] : [])
      const ev = new Event('gamepadconnected')
      Object.defineProperty(ev, 'gamepad', { value: pad })
      window.dispatchEvent(ev)
    })

    // Position eye beside the car so Y/Triangle (KeyE) mounts it.
    await page.evaluate(() => {
      const e = globalThis.engine, w = e.alive.where(e.alive.things[0])
      e.pose.x = w.at[0] / 10 - 1.8; e.pose.y = w.at[1] / 10 + 1.5; e.pose.z = w.at[2] / 10 + 3.5; e.pose.yaw = 0.8; e.pose.pitch = -0.2
    })
    await page.waitForFunction(() => !!globalThis.engine.alive.near, null, { timeout: 5000 })
    if (out) await page.screenshot({ path: join(out, '01-before-mount.png') })

    // Press Y/Triangle (button 3) to enter vehicle!
    await page.evaluate(() => { globalThis.__gp.state.buttons[3] = { pressed: true, value: 1 } })
    await page.waitForFunction(() => !!globalThis.engine.alive.riding, null, { timeout: 5000 })
    await page.evaluate(() => { globalThis.__gp.state.buttons[3] = { pressed: false, value: 0 } })
    await page.waitForTimeout(300)
    check(await page.evaluate(() => !!globalThis.engine.alive.riding), 'Playwright: Y/Triangle button mounts the finecar')
    if (out) await page.screenshot({ path: join(out, '02-mounted-chase.png') })

    // Partial analog RT throttle (0.7) + gentle curved steering (0.35) + slight right-stick orbit.
    const startPos = await page.evaluate(() => globalThis.engine.alive.where(globalThis.engine.alive.riding).at)
    await page.evaluate(() => {
      globalThis.__gp.state.buttons[7] = { pressed: true, value: 0.72 }
      globalThis.__gp.state.axes = [0.25, 0, 0, 0]
    })
    await page.waitForTimeout(1600)
    if (out) await page.screenshot({ path: join(out, '03-analog-driving.png') })

    // Pull A/Cross handbrake + sharper right steer for a drift and check dual-rumble telemetry.
    await page.evaluate(() => {
      globalThis.__gp.state.buttons[0] = { pressed: true, value: 1 }
      globalThis.__gp.state.axes = [0.85, 0, 0, 0]
    })
    await page.waitForTimeout(700)
    if (out) await page.screenshot({ path: join(out, '04-drift-haptics.png') })

    // Hold LB/L1 look-back and verify camera flips ~180 deg!
    const yawBeforeLookBack = await page.evaluate(() => globalThis.engine.pose.yaw)
    await page.evaluate(() => {
      globalThis.__gp.state.buttons[0] = { pressed: false, value: 0 }
      globalThis.__gp.state.buttons[4] = { pressed: true, value: 1 }
      globalThis.__gp.state.axes = [0, 0, 0, 0]
    })
    await page.waitForTimeout(180)
    const yawLookBack = await page.evaluate(() => globalThis.engine.pose.yaw)
    const diffBack = Math.abs(Math.atan2(Math.sin(yawLookBack - yawBeforeLookBack), Math.cos(yawLookBack - yawBeforeLookBack)))
    check(diffBack > 2.2, `Playwright: LB/L1 look-back rotates chase view behind (${(diffBack * 180 / Math.PI).toFixed(0)} deg)`)
    if (out) await page.screenshot({ path: join(out, '05-look-back.png') })

    // Release LB, tap R3 (button 11) for driver seat view.
    await page.evaluate(() => {
      globalThis.__gp.state.buttons[4] = { pressed: false, value: 0 }
      globalThis.__gp.state.buttons[7] = { pressed: false, value: 0 }
      globalThis.__gp.state.buttons[11] = { pressed: true, value: 1 }
    })
    await page.waitForFunction(() => globalThis.engine.alive.inside, null, { timeout: 5000 })
    await page.evaluate(() => { globalThis.__gp.state.buttons[11] = { pressed: false, value: 0 } })
    await page.waitForTimeout(250)
    if (out) await page.screenshot({ path: join(out, '06-cockpit-seat.png') })

    const stats = await page.evaluate((from) => {
      const e = globalThis.engine, at = e.alive.where(e.alive.riding).at
      return {
        moved: Math.hypot(at[0] - from[0], at[2] - from[2]),
        inside: e.alive.inside,
        rumbleCount: globalThis.__gp.state.effects.length,
        driveAxes: e.input.driveAxes,
      }
    }, startPos)
    check(stats.moved > 35, `Playwright: analog RT drove finecar ${(stats.moved / 10).toFixed(1)} m`)
    check(stats.inside === true, 'Playwright: R3 switched into driver seat')
    check(stats.rumbleCount > 0, `Playwright: dual-motor haptic rumble fired during drive (${stats.rumbleCount} effects)`)
  } catch (e) {
    failures.push(String(e.stack ?? e))
  }
  await finish('gamepad')
}

if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('gamepad: ok')
