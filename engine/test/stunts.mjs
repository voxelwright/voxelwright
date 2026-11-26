// Driving Stunt & Combo System check (#30):
// 1. Fast deterministic unit tests of createStuntEngine (drift tiers, Big Air distance & upright
//    landing vs rollover bust, 180/360 J-turns, near-miss events, Speed Demon, x1->x5 multiplier,
//    2.8s grace timer banking, hard impact >45 cells/s COMBO BUSTED, localStorage persistence).
// 2. Real Chrome WebGPU browser check on /city?living=finecar: verifies zero HUD clutter while
//    parked/cruising, active drift combo HUD visibility & layout (no overlap with car/#card/drive-hud),
//    custom `voxelwright:nearmiss` event chaining, banking, busting, reduced-motion, and captures
//    screenshots when `--out <dir>` is passed.
//
//   node test/stunts.mjs [--unit-only] [--out dir]
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createStuntEngine } from '../page/stunts.ts'
import { arg, has, start, still } from './kit.mjs'

const failures = []
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

// ── 1. Deterministic Node unit tests ─────────────────────────────────────────
console.log('stunts unit tests')
{
  const store = new Map()
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v) } }
  const feedback = []
  const eng = createStuntEngine({ storage })
  eng.onFeedback = (kind, meta) => feedback.push({ kind, ...meta })

  const upright = [0, 0, 0, 1]
  const rolled = [1, 0, 0, 0] // 180° roll (upside down: up = -1)
  const frontOf = (yaw) => [Math.sin(yaw), 0, -Math.cos(yaw)]

  // Idle / parked / normal cruise must stay completely idle
  for (let i = 0; i < 60; i++) {
    eng.step({ driving: true, dt: 1 / 60, kmh: 50, slip: 0.05, drifting: false, feet: 4, at: [i * 2, 10, 0], rot: upright, front: [1, 0, 0] })
  }
  check(eng.state.phase === 'idle' && eng.state.score === 0, 'cruising at 50 km/h stays completely idle')

  // Drift progression: Drift -> Great Drift -> Ultimate Drift
  let x = 0
  const labelsSeen = new Set()
  for (let i = 0; i < 240; i++) {
    x += 220 * (1 / 60) // ~79 km/h
    eng.step({ driving: true, dt: 1 / 60, kmh: 85, slip: 0.9, drifting: true, feet: 4, at: [x, 10, 0], rot: upright, front: [1, 0, 0] })
    if (eng.state.phase === 'active') labelsSeen.add(eng.state.label)
  }
  check(
    labelsSeen.has('Drift') && labelsSeen.has('Great Drift') && labelsSeen.has('Ultimate Drift'),
    `continuous drift upgrades labels cleanly (${[...labelsSeen].join(' -> ')})`,
  )
  check(eng.state.multiplier === 1 && eng.state.driftPoints >= 1200, `active drift score ${eng.state.driftPoints} at x${eng.state.multiplier}`)

  // Stop drifting -> commits drift and starts 2.8s grace timer
  for (let i = 0; i < 15; i++) {
    x += 200 * (1 / 60)
    eng.step({ driving: true, dt: 1 / 60, kmh: 72, slip: 0.05, drifting: false, feet: 4, at: [x, 10, 0], rot: upright, front: [1, 0, 0] })
  }
  check(eng.state.phase === 'active' && !eng.state.drifting && eng.state.chain.length === 1 && eng.state.grace > 2.4, `drift committed to chain with grace timer (${eng.state.grace.toFixed(2)}s)`)

  // Chain Near Miss (matching reactive SF traffic #29 payload: speedKmh + clearance) -> bumps multiplier to x2
  const nmOk = eng.nearMiss({ speedKmh: 115, clearance: 1.4 })
  check(nmOk && eng.state.multiplier === 2 && eng.state.label === 'Near Miss', `near-miss chains onto drift and bumps multiplier to x${eng.state.multiplier}`)

  // Chain Big Air (32m horizontal jump off an SF hill, clean upright landing) -> bumps multiplier to x3
  const jumpStartX = x
  for (let i = 0; i < 72; i++) {
    // 1.2s airborne covering 32m (320 cells)
    const t = (i + 1) / 72
    const jx = jumpStartX + 320 * t
    const jy = 10 + Math.sin(t * Math.PI) * 35
    eng.step({ driving: true, dt: 1 / 60, kmh: 96, slip: 0, drifting: false, feet: 0, at: [jx, jy, 0], rot: upright, front: [1, 0, 0] })
  }
  check(eng.state.airborne && /Air/.test(eng.state.label), `mid-jump shows live airborne state ("${eng.state.label}", ${eng.state.airDistance}m)`)
  x = jumpStartX + 320
  eng.step({ driving: true, dt: 1 / 60, kmh: 96, slip: 0, drifting: false, feet: 4, at: [x, 10, 0], rot: upright, front: [1, 0, 0] })
  check(!eng.state.airborne && eng.state.label === 'Big Air 32m!' && eng.state.multiplier === 3, `clean upright 32m landing awards "${eng.state.label}" and bumps multiplier to x${eng.state.multiplier}`)

  // Chain 180° J-Turn and 360° Spin -> bumps multiplier to x4
  let yaw = 0
  const spinLabels = new Set()
  for (let i = 0; i < 65; i++) {
    yaw += (Math.PI * 2.05) / 65 // rapid ~370° spin in ~1.08s
    x += 120 * (1 / 60)
    eng.step({ driving: true, dt: 1 / 60, kmh: 45, slip: 0.75, drifting: false, feet: 4, at: [x, 10, 0], rot: upright, front: frontOf(yaw) })
    spinLabels.add(eng.state.label)
  }
  check(spinLabels.has('180° J-Turn') && spinLabels.has('360° Spin!'), `rapid slide spin awards 180° J-Turn and 360° Spin! (${[...spinLabels].join(', ')})`)
  check(eng.state.multiplier === 4, `spin chained onto air bumps multiplier to x${eng.state.multiplier}`)

  // Chain Speed Demon (>130 km/h sustained 2.5s) -> bumps multiplier to x5 (capped at x5!)
  for (let i = 0; i < 160; i++) {
    x += 400 * (1 / 60)
    eng.step({ driving: true, dt: 1 / 60, kmh: 145, slip: 0, drifting: false, feet: 4, at: [x, 10, 0], rot: upright, front: [1, 0, 0] })
  }
  check(eng.state.label === 'Speed Demon' && eng.state.multiplier === 5, `sustained >130 km/h awards "${eng.state.label}" and caps multiplier at x${eng.state.multiplier}`)

  // Let grace timer (2.8s) expire cleanly -> banks points & persists localStorage records!
  for (let i = 0; i < 180; i++) {
    x += 150 * (1 / 60)
    eng.step({ driving: true, dt: 1 / 60, kmh: 60, slip: 0, drifting: false, feet: 4, at: [x, 10, 0], rot: upright, front: [1, 0, 0] })
  }
  check(eng.state.phase === 'banked' && eng.state.lastBanked > 10000, `grace timer banks combo cleanly (+${eng.state.lastBanked})`)
  check(feedback.some((f) => f.kind === 'bank'), 'banking triggers audio/UI bank feedback')

  // Verify localStorage persistence across fresh instance
  const reloaded = createStuntEngine({ storage })
  check(
    reloaded.records.bestCombo === eng.state.lastBanked && reloaded.records.longestDrift > 50 && reloaded.records.biggestJump >= 31,
    `localStorage persists bestCombo=${reloaded.records.bestCombo}, longestDrift=${reloaded.records.longestDrift}m, biggestJump=${reloaded.records.biggestJump}m`,
  )

  // Hard crash (>45 cells/s) busts active combo without banking
  const bankedBeforeBust = eng.records.totalBanked
  eng.nearMiss({ kmh: 100 })
  check(eng.state.phase === 'active' && eng.state.score > 0, 'fresh combo started before crash')
  eng.step({ driving: true, dt: 1 / 60, kmh: 80, slip: 0.1, drifting: false, feet: 4, at: [x + 2, 10, 0], rot: upright, front: [1, 0, 0], impacts: [62] })
  check(eng.state.phase === 'busted' && eng.state.label === 'COMBO BUSTED', `hard crash (62 cells/s) triggers "${eng.state.label}"`)
  check(eng.records.totalBanked === bankedBeforeBust, 'busted combo does not add to banked score')

  // Upside-down jump landing busts active combo
  eng.resetSession()
  eng.nearMiss({ kmh: 90 })
  for (let i = 0; i < 30; i++) {
    eng.step({ driving: true, dt: 1 / 60, kmh: 80, slip: 0, drifting: false, feet: 0, at: [x + i * 3, 25, 0], rot: rolled, front: [1, 0, 0] })
  }
  eng.step({ driving: true, dt: 1 / 60, kmh: 80, slip: 0, drifting: false, feet: 4, at: [x + 95, 10, 0], rot: rolled, front: [1, 0, 0] })
  check(eng.state.phase === 'busted' && eng.state.label === 'COMBO BUSTED', 'upside-down landing busts active combo')
}

if (has('unit-only')) {
  console.log(failures.length ? `FAILED (${failures.length})` : 'stunts unit tests ok')
  process.exit(failures.length ? 1 : 0)
}

// ── 2. Real Chrome WebGPU browser check ──────────────────────────────────────
console.log('\nstunts browser check (/city?living=finecar)')
const out = arg('out', '') && resolve(arg('out', ''))
if (out) await mkdir(out, { recursive: true })
const { city, check: bCheck, failures: bFailures, finish } = await start()
try {
  const page = await city('fire=0&people=0&living=finecar', { size: [1280, 720], dpr: 1 })
  await still(page)
  await page.waitForFunction(() => globalThis.engine?.stunts && globalThis.engine.alive.things.length === 1 && globalThis.engine.alive.where(globalThis.engine.alive.things[0]), null, { timeout: 30_000 })

  // Mount the car and confirm stunt HUD is completely hidden when parked
  await page.evaluate(() => {
    const e = globalThis.engine
    e.alive.mount(e.alive.things[0])
  })
  await page.waitForFunction(() => !!globalThis.engine.alive.riding, null, { timeout: 5000 })
  await page.waitForTimeout(300)

  const parkedVis = await page.evaluate(() => {
    const el = document.querySelector('[data-panel="stunts"]')
    return { exists: !!el, display: el ? getComputedStyle(el).display : null, state: globalThis.engine.stunts.state.phase }
  })
  bCheck(parkedVis.exists && parkedVis.display === 'none' && parkedVis.state === 'idle', `parked in car: [data-panel="stunts"] is completely hidden (display=${parkedVis.display})`)
  if (out) await page.screenshot({ path: join(out, '01-parked.png') })

  // Accelerate down the open street, then kick into a real drift with W + Space + A!
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1900)
  await page.keyboard.down('Space')
  await page.keyboard.down('KeyA')
  await page.waitForFunction(() => globalThis.engine.stunts.state.phase === 'active' && globalThis.engine.stunts.state.drifting, null, { timeout: 6000 }).catch(() => {})
  await page.waitForTimeout(180)
  const driftOnly = await page.evaluate(() => ({ state: globalThis.engine.stunts.state, tel: globalThis.engine.alive.telemetry }))
  if (out) await page.screenshot({ path: join(out, '02a-active-drift.png') })
  // Release steering/throttle right away so the car coasts cleanly in the street instead of hitting the kerbside wall.
  await page.keyboard.up('KeyA')
  await page.keyboard.up('Space')
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(260)

  // Dispatch a real `voxelwright:nearmiss` custom event within the 2.8s grace window to verify event wiring + x2 combo multiplier!
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('voxelwright:nearmiss', { detail: { kmh: 112 } }))
  })
  await page.waitForTimeout(100)

  const activeInfo = await page.evaluate(() => {
    const e = globalThis.engine
    const panel = document.querySelector('[data-panel="stunts"]')
    const card = document.querySelector('#card')
    const hud = document.querySelector('#hud')
    const driveHud = document.querySelector('[data-panel="drive-hud"]')
    const r = panel.getBoundingClientRect()
    const meets = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const cardOverlap = card && !card.hidden ? meets(r, card.getBoundingClientRect()) : false
    const hudOverlap = hud && getComputedStyle(hud).display !== 'none' ? meets(r, hud.getBoundingClientRect()) : false
    const dhOverlap = driveHud && getComputedStyle(driveHud).display !== 'none' ? meets(r, driveHud.getBoundingClientRect()) : false
    return {
      display: getComputedStyle(panel).display,
      state: e.stunts.state,
      rect: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) },
      cardOverlap,
      hudOverlap,
      dhOverlap,
      text: panel.textContent.trim(),
    }
  })
  if (out) await page.screenshot({ path: join(out, '02-active-combo.png') })

  bCheck(driftOnly.state.phase === 'active' && driftOnly.state.driftPoints > 0, `real driving drift activates stunt HUD (driftPts=${driftOnly.state.driftPoints}, kmh=${Math.round(driftOnly.tel?.kmh ?? 0)})`)
  bCheck(activeInfo.display === 'flex' && activeInfo.state.phase === 'active' && activeInfo.state.score > 0, `real drift + nearmiss shows active combo HUD ("${activeInfo.text}", mult x${activeInfo.state.multiplier})`)
  bCheck(activeInfo.state.multiplier >= 2, `chaining nearmiss onto drift bumps multiplier (x${activeInfo.state.multiplier})`)
  bCheck(!activeInfo.cardOverlap && !activeInfo.hudOverlap && !activeInfo.dhOverlap && activeInfo.rect.top >= 18 && activeInfo.rect.bottom < 160, `stunts HUD sits cleanly in top-center sky (${JSON.stringify(activeInfo.rect)}, overlaps: card=${activeInfo.cardOverlap}, hud=${activeInfo.hudOverlap}, driveHud=${activeInfo.dhOverlap})`)

  // Let grace timer (2.8s) bank the combo cleanly
  await page.waitForFunction(() => globalThis.engine.stunts.state.phase === 'banked', null, { timeout: 6000 }).catch(() => {})
  const bankedInfo = await page.evaluate(() => ({
    state: globalThis.engine.stunts.state,
    stored: localStorage.getItem('voxelwright.stunts.v1'),
    text: document.querySelector('[data-panel="stunts"]').textContent.trim(),
  }))
  if (out) await page.screenshot({ path: join(out, '03-banked.png') })
  bCheck(bankedInfo.state.phase === 'banked' && bankedInfo.state.lastBanked > 0 && !!bankedInfo.stored, `combo banks cleanly and persists to localStorage ("${bankedInfo.text}")`)

  // Wait for banked banner to fade out completely back to display: none
  await page.waitForFunction(() => globalThis.engine.stunts.state.phase === 'idle', null, { timeout: 4000 }).catch(() => {})
  const afterBankDisplay = await page.evaluate(() => getComputedStyle(document.querySelector('[data-panel="stunts"]')).display)
  bCheck(afterBankDisplay === 'none', `after banking, stunts HUD hides completely again (display=${afterBankDisplay})`)

  // Trigger a fresh combo + bust and verify COMBO BUSTED state
  const bustedInfo = await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('voxelwright:nearmiss', { detail: { kmh: 105 } }))
    globalThis.engine.stunts.bust()
    const el = document.querySelector('[data-panel="stunts"]')
    return { state: globalThis.engine.stunts.state.phase, label: globalThis.engine.stunts.state.label, display: getComputedStyle(el).display, text: el.textContent.trim() }
  })
  if (out) await page.screenshot({ path: join(out, '04-busted.png') })
  bCheck(bustedInfo.state === 'busted' && bustedInfo.label === 'COMBO BUSTED' && bustedInfo.display === 'flex', `bust state renders cleanly ("${bustedInfo.text}")`)

  // Verify prefers-reduced-motion disables bounce animation
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedAnim = await page.evaluate(() => {
    const el = document.querySelector('[data-panel="stunts"]')
    el.classList.add('pop')
    return getComputedStyle(el).animationName
  })
  bCheck(reducedAnim === 'none', `prefers-reduced-motion disables pop animation (animationName=${reducedAnim})`)

  for (const f of failures) bFailures.push(f)
} catch (e) {
  bFailures.push(String(e.stack ?? e))
}
await finish('stunts')
