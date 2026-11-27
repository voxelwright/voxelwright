// 3D Map-to-Reality Optical Dive checks (#23): verifies clean first view (no playtest switcher chrome, zero map bytes
// before click 2), 2-click EXPLORE arming + Optical Dive into Financial District, 3D Map Visit optical dive to Coit Tower,
// mid-dive M interrupt, Backquote return to Ina Coolbrith Park, prefers-reduced-motion cross-fade, and portrait phone.
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
  // ── 1. Desktop (1280x720): Pure First View → 2-Click EXPLORE Map Dive → Map Visit → Mid-Dive M → Backquote ──
  console.log('\ndesktop (1280x720): default Map Dive entry & Map Visit')
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
    noMapTravel: !document.querySelector('#world-map .wm-travel'),
  }))
  check(init.state === 'idle' && !init.engaged && init.noSwitcher && init.noMapTravel, `first view boots clean with zero playtest switcher chrome (${JSON.stringify(init)})`)
  check(mapRequests.length === 0, `zero /bay/map.bin requests on cold first view (${mapRequests.length})`)
  await page.screenshot({ path: join(shots, '01-first-view-desktop.png') })

  // Click 1 on EXPLORE: arms cleanly with zero /bay/map.bin bytes fetched!
  const boardPos = await page.evaluate(() => { const w = globalThis.engine.boards.where('explore'); return w && { x: w.x, y: w.y } })
  check(!!boardPos, `EXPLORE board visible in first view (${JSON.stringify(boardPos)})`)
  await page.mouse.click(boardPos.x, boardPos.y)
  await page.waitForTimeout(550)
  const armed = await page.evaluate(() => ({
    state: globalThis.engine.explore.state,
    engaged: globalThis.engine.first.engaged,
    hint: document.getElementById('explore-hint')?.textContent ?? '',
    hintOn: document.getElementById('explore-hint')?.classList.contains('on') ?? false,
  }))
  check(armed.state === 'armed' && !armed.engaged && armed.hintOn && /Click again to explore/.test(armed.hint), `click 1 arms EXPLORE without entering (${JSON.stringify(armed)})`)
  check(mapRequests.length === 0, `click 1 keeps /bay/map.bin unfetched (${mapRequests.length})`)
  await page.screenshot({ path: join(shots, '02-explore-armed-desktop.png') })

  // Click 2 on EXPLORE: launches 3D Map-to-Reality Optical Dive into Financial District!
  const boardPos2 = await page.evaluate(() => { const w = globalThis.engine.boards.where('explore'); return w && { x: w.x, y: w.y } })
  const diveStart = Date.now()
  await page.mouse.click(boardPos2.x, boardPos2.y)
  await page.waitForFunction(() => document.getElementById('world-map')?.classList.contains('dive'), null, { timeout: 10_000 })
  await page.waitForTimeout(820)
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
  await page.waitForTimeout(550)
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
  }))
  check(landed.engaged && landed.onFoot && landed.diveCleared && landed.skyPanelFolded && landed.backButtons === 1, `Map Dive settled on foot in ${diveMs} ms at ${landed.pos.join(',')} (fov=${landed.fov}, skyFolded=${landed.skyPanelFolded}, backBtn=${landed.backButtons})`)
  check(Math.hypot(landed.stand.x / 10 - landed.pos[0], landed.stand.z / 10 - landed.pos[2]) < 30, `explore.stand reflects resolved Financial District street spot (${Math.round(landed.stand.x / 10)}, ${Math.round(landed.stand.z / 10)})`)

  // Open 3D Map (`M`), verify clean dock (no switcher), Visit Coit Tower via Optical Dive!
  await page.keyboard.press('KeyM')
  await page.waitForFunction(() => globalThis.engine.map?.open && globalThis.engine.map?.ready, null, { timeout: 10_000 })
  await page.waitForTimeout(400)
  const beforeVisit = await page.evaluate(() => ({ x: globalThis.engine.pose.x, z: globalThis.engine.pose.z }))
  await page.locator('#world-map .wm-chip', { hasText: 'Coit Tower' }).click()
  await page.waitForTimeout(300)
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
  check(!afterVisit.mapOpen && afterVisit.dist > 300 && afterVisit.onFoot, `Map Visit optically dove ${afterVisit.dist} m to Coit Tower cleanly on foot`)

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
  console.log('\nportrait phone (390x844): 2-tap EXPLORE Map Dive')
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
  await phone.waitForTimeout(500)
  const phoneArmed = await phone.evaluate(() => globalThis.engine.explore.state)
  check(phoneArmed === 'armed', `phone tap 1 arms EXPLORE (${phoneArmed})`)
  const phoneBoard2 = await phone.evaluate(() => { const w = globalThis.engine.boards.where('explore'); return w && { x: w.x, y: w.y } })
  await phone.touchscreen.tap(phoneBoard2.x, phoneBoard2.y)
  await phone.waitForFunction(() => document.getElementById('world-map')?.classList.contains('dive'), null, { timeout: 10_000 })
  await phone.waitForTimeout(750)
  await phone.screenshot({ path: join(shots, '07-dive-mid-phone.png') })
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
  check(phoneLanded.engaged && phoneLanded.onFoot && phoneLanded.fov >= 75 && phoneLanded.hasWalks && !phoneLanded.hitsMm, `phone 2-tap Map Dive settled on foot cleanly with title clear of minimap (${JSON.stringify(phoneLanded)})`)
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
