// Instant 3D Map Picker & Optical Dive checks (#23): verifies clean first view (zero map bytes on cold load),
// 1-click EXPLORE opening the 3D map immediately with scenic default (North Beach) + background preloading,
// Esc returning cleanly to Ina Coolbrith Park, custom spot picking + Start confirmation diving optically onto
// Columbus Ave, in-game 3D Map Visit to Coit Tower, mid-dive M interrupt, Backquote return, reduced-motion,
// and portrait phone 1-tap EXPLORE → map → Start.
//
//   node test/sf-entry.mjs [--no-build] [--dist dist-sf] [--shots ~/.village/engine/sf/entry]
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf'))
const shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'entry'))
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })
const site = await plain(dist, '127.0.0.1', 0)
const back = await turn()
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { back(); process.exit(1) })
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
const errors = []

const waitReady = async (page) => {
  await page.waitForFunction(() => globalThis.engine?.seen?.near > 0 && globalThis.engine?.entry && globalThis.engine?.explore && globalThis.engine?.boards, null, { timeout: 60_000 })
}

try {
  // ── 1. Desktop (1280x720): Pure First View → 1-Click EXPLORE Map Picker → Esc → Start Dive → Map Visit → M Interrupt → Backquote ──
  console.log('\ndesktop (1280x720): 1-click EXPLORE map picker, preloading & Optical Dive')
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  const mapRequests = []
  page.on('pageerror', (e) => { console.error('  PAGEERROR:', e.message); errors.push(`pageerror: ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') { console.error('  CONSOLE:', m.text()); errors.push(`console: ${m.text()}`) } })
  page.on('response', (r) => {
    if (r.url().includes('/bay/map.bin')) mapRequests.push({ status: r.status(), at: Date.now() })
    if (r.status() >= 400 && !r.url().includes('/weather')) { console.error('  HTTP:', r.status(), r.url()); errors.push(`http ${r.status()} ${r.url()}`) }
  })

  await page.goto(`${site.url}/sf/index.html`)
  await waitReady(page)
  await page.waitForTimeout(900)

  const init = await page.evaluate(() => ({
    state: globalThis.engine.explore.state,
    engaged: globalThis.engine.first.engaged,
    noSwitcher: !document.querySelector('#first .entry-btn') && !document.getElementById('entry-picker') && !document.getElementById('threshold-ui') && !document.getElementById('skydive-hud'),
    noExploreHint: !document.getElementById('explore-hint'),
  }))
  check(init.state === 'idle' && !init.engaged && init.noSwitcher && init.noExploreHint, `first view boots clean with zero switcher or arming hint chrome (${JSON.stringify(init)})`)
  check(mapRequests.length === 0, `zero /bay/map.bin requests on cold first view (${mapRequests.length})`)
  await page.screenshot({ path: join(shots, '01-first-view-desktop.png') })

  // Click 1 on EXPLORE: immediately opens fullscreen 3D map picker with scenic default (North Beach) & starts background preloading!
  const boardPos = await page.evaluate(() => { const w = globalThis.engine.boards.where('explore'); return w && { x: w.x, y: w.y } })
  check(!!boardPos, `EXPLORE board visible in first view (${JSON.stringify(boardPos)})`)
  const clickAt = Date.now()
  await page.mouse.click(boardPos.x, boardPos.y)
  await page.waitForFunction(() => globalThis.engine.map?.open && globalThis.engine.map?.picking, null, { timeout: 3000 })
  const openMs = Date.now() - clickAt
  await page.waitForFunction(() => globalThis.engine.map?.ready, null, { timeout: 15_000 })
  await page.waitForTimeout(650)

  const picked = await page.evaluate(() => ({
    state: globalThis.engine.explore.state,
    engaged: globalThis.engine.first.engaged,
    mapOpen: globalThis.engine.map.open,
    picking: globalThis.engine.map.picking,
    mode: globalThis.engine.map.mode,
    name: document.querySelector('#world-map .wm-route-name')?.textContent ?? '',
    startText: document.querySelector('#world-map .wm-visit')?.textContent ?? '',
    clearHidden: getComputedStyle(document.querySelector('#world-map .wm-clear')).display === 'none',
    noHint: !document.getElementById('explore-hint'),
  }))
  check(
    picked.state === 'picking' && !picked.engaged && picked.mapOpen && picked.picking && picked.mode === '3d' && picked.name === 'North Beach' && picked.startText === 'Start' && picked.clearHidden && picked.noHint && openMs < 500,
    `click 1 opens 3D map picker in ${openMs} ms with default scenic spot (${JSON.stringify(picked)})`,
  )
  check(mapRequests.length >= 1, `opening map triggered /bay/map.bin fetch (${mapRequests.length})`)
  await page.screenshot({ path: join(shots, '02-entry-map-desktop.png') })

  // Pressing Esc closes the map cleanly back to Ina Coolbrith Park first view without engaging!
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
  const escaped = await page.evaluate(() => ({
    state: globalThis.engine.explore.state,
    engaged: globalThis.engine.first.engaged,
    mapOpen: globalThis.engine.map.open,
    picking: globalThis.engine.map.picking,
  }))
  check(escaped.state === 'idle' && !escaped.engaged && !escaped.mapOpen && !escaped.picking, `Esc returns cleanly to first view (${JSON.stringify(escaped)})`)

  // Re-click EXPLORE: map re-opens instantaneously (cached map.bin); select another spot then return to North Beach and confirm Start!
  const reopenAt = Date.now()
  await page.mouse.click(boardPos.x, boardPos.y)
  await page.waitForFunction(() => globalThis.engine.map?.open && globalThis.engine.map?.picking, null, { timeout: 2000 })
  const reopenMs = Date.now() - reopenAt
  check(reopenMs < 400, `re-opening cached map is instantaneous (${reopenMs} ms)`)

  // Verify user can pick any landmark or arbitrary point on the map
  await page.locator('#world-map .wm-chip', { hasText: 'Palace of Fine Arts' }).click()
  await page.waitForTimeout(250)
  const customPicked = await page.evaluate(() => document.querySelector('#world-map .wm-route-name')?.textContent ?? '')
  check(customPicked === 'Palace of Fine Arts', `clicking landmark chip updates selected start spot (${customPicked})`)

  // Select default scenic North Beach chip again and click Start!
  await page.locator('#world-map .wm-chip', { hasText: 'North Beach' }).click()
  await page.waitForTimeout(450)
  const diveStart = Date.now()
  await page.locator('#world-map .wm-visit').click()
  await page.waitForFunction(() => document.getElementById('world-map')?.classList.contains('dive'), null, { timeout: 10_000 })
  await page.waitForTimeout(750)
  const midDive = await page.evaluate(() => {
    const wm = document.getElementById('world-map')
    return {
      isDive: wm?.classList.contains('dive') ?? false,
      opacity: wm ? parseFloat(getComputedStyle(wm).opacity) : -1,
      opaque: globalThis.engine.map?.opaque,
      fov: Math.round(globalThis.engine.fov),
      y: Math.round(globalThis.engine.pose.y),
    }
  })
  await page.screenshot({ path: join(shots, '03-dive-mid-desktop.png') })
  check(midDive.isDive && midDive.opaque === false, `during Map Dive live world renders underneath (opaque=${midDive.opaque}, opacity=${midDive.opacity.toFixed(2)}, fov=${midDive.fov}, y=${midDive.y}m)`)

  await page.waitForFunction(() => globalThis.engine.first.engaged && globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet, null, { timeout: 25_000 })
  const diveMs = Date.now() - diveStart
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(shots, '04-dive-landed-desktop.png') })
  const landed = await page.evaluate(() => ({
    engaged: globalThis.engine.first.engaged,
    onFoot: globalThis.engine.me.on,
    diveCleared: !document.getElementById('world-map')?.classList.contains('dive'),
    pos: [Math.round(globalThis.engine.pose.x), Math.round(globalThis.engine.pose.y), Math.round(globalThis.engine.pose.z)],
    stand: globalThis.engine.explore.stand,
    fov: Math.round(globalThis.engine.fov),
    skyPanelFolded: !document.querySelector('#realm .sky')?.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
    backButtons: document.querySelectorAll('#realm .home').length,
    streetReady: globalThis.engine.street?.ready ?? false,
  }))
  check(landed.engaged && landed.onFoot && landed.diveCleared && landed.skyPanelFolded && landed.backButtons === 1, `Start Map Dive settled on foot in ${diveMs} ms at ${landed.pos.join(',')} (fov=${landed.fov}, streetReady=${landed.streetReady})`)
  check(Math.hypot(landed.stand.x / 10 - 52125, landed.stand.z / 10 - 66340) < 40, `landed at North Beach scenic spot (${Math.round(landed.stand.x / 10)}, ${Math.round(landed.stand.z / 10)})`)

  // Open in-game 3D Map (`M`), verify Visit Coit Tower via Optical Dive!
  await page.keyboard.press('KeyM')
  await page.waitForFunction(() => globalThis.engine.map?.open && !globalThis.engine.map?.picking && globalThis.engine.map?.ready, null, { timeout: 10_000 })
  await page.waitForTimeout(400)
  const beforeVisit = await page.evaluate(() => ({ x: globalThis.engine.pose.x, z: globalThis.engine.pose.z }))
  await page.locator('#world-map .wm-chip', { hasText: 'Coit Tower' }).click()
  await page.waitForTimeout(300)
  const visitText = await page.evaluate(() => document.querySelector('#world-map .wm-visit')?.textContent ?? '')
  check(visitText === 'Visit', `in-game map button restores Visit label (${visitText})`)
  await page.locator('#world-map .wm-visit').click()
  await page.waitForTimeout(650)
  await page.screenshot({ path: join(shots, '05-visit-coit-mid-desktop.png') })
  await page.waitForFunction(() => globalThis.engine.explore.state === 'in' && !document.getElementById('world-map')?.classList.contains('dive'), null, { timeout: 20_000 })
  await page.waitForTimeout(550)
  await page.screenshot({ path: join(shots, '06-visit-coit-landed-desktop.png') })
  const afterVisit = await page.evaluate((before) => ({
    dist: Math.round(Math.hypot(globalThis.engine.pose.x - before.x, globalThis.engine.pose.z - before.z)),
    mapOpen: globalThis.engine.map.open,
    onFoot: globalThis.engine.me.on,
  }), beforeVisit)
  check(!afterVisit.mapOpen && afterVisit.dist > 250 && afterVisit.onFoot, `Map Visit optically dove ${afterVisit.dist} m to Coit Tower cleanly on foot`)

  // Press M mid-dive during a Visit to Ferry Building — must cancel dive cleanly and reopen map immediately!
  await page.keyboard.press('KeyM')
  await page.waitForFunction(() => globalThis.engine.map?.open, null, { timeout: 5000 })
  await page.locator('#world-map .wm-chip', { hasText: 'Ferry Building' }).click()
  await page.waitForTimeout(200)
  await page.locator('#world-map .wm-visit').click()
  await page.waitForTimeout(700)
  await page.keyboard.press('KeyM')
  await page.waitForTimeout(350)
  const midInterrupt = await page.evaluate(() => ({
    mapOpen: globalThis.engine.map.open,
    diveCleared: !document.getElementById('world-map')?.classList.contains('dive'),
    state: globalThis.engine.explore.state,
  }))
  check(midInterrupt.mapOpen && midInterrupt.diveCleared && midInterrupt.state === 'in', `pressing M mid-dive cancels dive cleanly and opens map (${JSON.stringify(midInterrupt)})`)
  await page.keyboard.press('KeyM')
  await page.waitForTimeout(300)

  // Return to Ina Coolbrith Park via Backquote (`)
  await page.keyboard.press('Backquote')
  await page.waitForFunction(() => !globalThis.engine.first.engaged && globalThis.engine.explore.state === 'idle', null, { timeout: 15_000 })
  check(true, 'Backquote returned cleanly to Ina Coolbrith Park first view')
  await ctx.close()

  // ── 2. Reduced Motion Check ──
  console.log('\nreduced motion check (default Map Dive)')
  const rmCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' })
  const rmPage = await rmCtx.newPage()
  rmPage.on('pageerror', (e) => errors.push(`rm pageerror: ${e.message}`))
  await rmPage.goto(`${site.url}/sf/index.html`)
  await waitReady(rmPage)
  await rmPage.evaluate(() => globalThis.engine.explore.go())
  await rmPage.waitForTimeout(650)
  const rmState = await rmPage.evaluate(() => ({
    engaged: globalThis.engine.first.engaged,
    state: globalThis.engine.explore.state,
    stillGone: !document.getElementById('entry-still'),
  }))
  check(rmState.engaged && rmState.state === 'in' && rmState.stillGone, `prefers-reduced-motion completes default Map Dive via clean cross-fade (${JSON.stringify(rmState)})`)
  await rmCtx.close()

  // ── 3. Portrait Phone (390x844, safe areas, touch) ──
  console.log('\nportrait phone (390x844): 1-tap EXPLORE → map → Start')
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const phone = await phoneCtx.newPage()
  phone.on('pageerror', (e) => errors.push(`phone pageerror: ${e.message}`))
  const cdp = await phoneCtx.newCDPSession(phone)
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34, left: 0, right: 0 } })
  await phone.goto(`${site.url}/sf/index.html`)
  await waitReady(phone)
  await phone.waitForTimeout(700)

  const phoneBoard = await phone.evaluate(() => { const w = globalThis.engine.boards.where('explore'); return w && { x: w.x, y: w.y } })
  await phone.touchscreen.tap(phoneBoard.x, phoneBoard.y)
  await phone.waitForFunction(() => globalThis.engine.map?.open && globalThis.engine.map?.picking && globalThis.engine.map?.ready, null, { timeout: 15_000 })
  await phone.waitForTimeout(600)
  await phone.screenshot({ path: join(shots, '07-entry-map-phone.png') })
  const phonePicking = await phone.evaluate(() => ({
    state: globalThis.engine.explore.state,
    startBtn: document.querySelector('#world-map .wm-visit')?.textContent ?? '',
    name: document.querySelector('#world-map .wm-route-name')?.textContent ?? '',
  }))
  check(phonePicking.state === 'picking' && phonePicking.startBtn === 'Start' && phonePicking.name === 'North Beach', `phone tap 1 opens entry map with North Beach & Start (${JSON.stringify(phonePicking)})`)

  await phone.locator('#world-map .wm-visit').tap()
  await phone.waitForFunction(() => globalThis.engine.first.engaged && globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet, null, { timeout: 25_000 })
  await phone.waitForTimeout(550)
  await phone.screenshot({ path: join(shots, '08-dive-landed-phone.png') })
  const phoneLanded = await phone.evaluate(() => {
    const titleR = document.getElementById('entry-title')?.getBoundingClientRect()
    const mmR = document.getElementById('minimap')?.getBoundingClientRect()
    const hitsMm = !!(titleR && mmR && titleR.width > 0 && titleR.left < mmR.right && titleR.right > mmR.left && titleR.top < mmR.bottom && titleR.bottom > mmR.top)
    return {
      engaged: globalThis.engine.first.engaged,
      onFoot: globalThis.engine.me.on,
      fov: Math.round(globalThis.engine.fov),
      hasWalks: !!document.querySelector('#realm .walks'),
      titleTop: titleR ? Math.round(titleR.top) : -1,
      mmBottom: mmR ? Math.round(mmR.bottom) : -1,
      hitsMm,
    }
  })
  check(phoneLanded.engaged && phoneLanded.onFoot && phoneLanded.fov >= 75 && phoneLanded.hasWalks && !phoneLanded.hitsMm, `phone 1-tap map Start settled on foot cleanly with title clear of minimap (${JSON.stringify(phoneLanded)})`)
  await phoneCtx.close()

  check(errors.length === 0, `zero page/console/http errors (${errors.length}${errors.length ? `: ${errors.slice(0, 3).join('; ')}` : ''})`)
  writeFileSync(join(shots, 'results.json'), JSON.stringify({ failures, errors }, null, 2))
} finally {
  await browser.close()
  site.stop()
  back()
}

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log(`\npassed — screenshots written to ${shots}`)
