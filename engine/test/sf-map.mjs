// 3D Minimap, Full-Screen 2D/3D Map & GPS Navigation verification (page/minimap.ts, map-gpu.ts, gps.ts, nav-data.ts).
// Verifies cold-load zero-byte invariant, first-view hidden invariant, 3D minimap rendering & smooth frame pacing,
// hotkey (M/Esc) and click/tap open/close, interactive click-to-route GPS navigation, live distance updates & arrival,
// 2D/3D mode toggle, and captures full-size desktop + upright phone + landscape phone screenshots for visual inspection.
//
//   node test/sf-map.mjs [--no-build] [--dist dist-sf] [--shots ~/.village/engine/sf/map-check]
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf'))
const shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'map-check'))
const failures = [], errors = []
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

const until = (page, fn, ms = 60_000) => page.waitForFunction(fn, null, { timeout: ms }).then(() => true, () => false)

try {
  // ── 1. Desktop (1280 x 720) ──
  console.log('\ndesktop (1280x720):')
  const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const page = await deskCtx.newPage()
  const gpuErrors = []
  page.on('pageerror', (e) => errors.push(`desk: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') gpuErrors.push(m.text()) })
  await page.goto(`${site.url}/sf/index.html`)
  await page.waitForFunction(() => globalThis.engine?.seen?.near > 0 && globalThis.engine.explore && globalThis.engine.map, null, { timeout: 180_000 })
  await page.waitForTimeout(800)

  // First-view invariants: zero /bay/map.bin fetch and #minimap hidden!
  const beforeEngage = await page.evaluate(() => {
    const mm = document.querySelector('#minimap')
    return {
      first: document.documentElement.classList.contains('first'),
      engaged: globalThis.engine.first.engaged,
      visible: !!mm?.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
      ready: globalThis.engine.map.ready,
    }
  })
  const mapRequestsBefore = site.asked.filter((a) => a.path === '/bay/map.bin').length
  check(beforeEngage.first && !beforeEngage.engaged && !beforeEngage.visible && mapRequestsBefore === 0,
    `first view keeps minimap hidden and fetches zero map bytes (visible=${beforeEngage.visible}, requests=${mapRequestsBefore})`)

  // Enter the realm!
  await page.evaluate(() => { globalThis.engine.scale = 0.75; void globalThis.engine.explore.go() })
  const inside = await until(page, () => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet && globalThis.engine.map.ready, 90_000)
  check(inside, 'engaged on roof and MAP1 loaded into WebGPU')
  await page.evaluate(() => { globalThis.engine.me.standOff = 0 })
  await page.waitForTimeout(1000)

  const loaded = await page.evaluate(() => {
    const mm = document.querySelector('#minimap'), r = mm.getBoundingClientRect()
    const stats = globalThis.engine.map.stats
    return {
      visible: mm.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
      rect: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      stats,
    }
  })
  check(loaded.visible && loaded.rect.w >= 240 && loaded.stats.edges > 5000 && loaded.stats.buildings > 5000,
    `3D minimap visible at ${JSON.stringify(loaded.rect)} with ${loaded.stats.edges} road edges, ${loaded.stats.buildings} 3D buildings, render ${loaded.stats.renderMs} ms`)
  await page.screenshot({ path: join(shots, '01-desk-minimap-idle.png') })

  // Press M to open fullscreen map
  await page.keyboard.press('KeyM')
  await page.waitForTimeout(500)
  const openedByKey = await page.evaluate(() => ({
    open: globalThis.engine.map.open,
    opaque: globalThis.engine.map.opaque,
    visible: !!document.querySelector('#world-map')?.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
    topMode: globalThis.engine.input.top,
  }))
  check(openedByKey.open && openedByKey.opaque && openedByKey.visible && openedByKey.topMode === 'map',
    `M opens fullscreen map in solid 'map' input mode (${JSON.stringify(openedByKey)})`)

  // WASD while map is open must NOT move the player's body!
  const feetBefore = await page.evaluate(() => [...globalThis.engine.me.feet.at])
  await page.keyboard.down('KeyW'); await page.waitForTimeout(400); await page.keyboard.up('KeyW')
  const feetAfter = await page.evaluate(() => [...globalThis.engine.me.feet.at])
  const drift = Math.hypot(feetAfter[0] - feetBefore[0], feetAfter[2] - feetBefore[2])
  check(drift < 2, `WASD pans the map without moving player body (drift ${(drift / 10).toFixed(2)} m)`)

  // Click on the map stage to place a GPS destination and verify A* route computation!
  await page.mouse.click(780, 410)
  await page.waitForTimeout(450)
  const clickedRoute = await page.evaluate(() => {
    const m = globalThis.engine.map
    return {
      dest: m.destination,
      routed: m.route?.routed ?? false,
      totalM: Math.round(m.route?.totalM ?? 0),
      pts: m.route ? m.route.cum.length : 0,
      computeMs: m.route ? Math.round(m.route.computeMs * 100) / 100 : -1,
      cardVisible: !!document.querySelector('#world-map .wm-route-card')?.checkVisibility(),
    }
  })
  check(!!clickedRoute.dest && clickedRoute.routed && clickedRoute.totalM > 50 && clickedRoute.computeMs < 30 && clickedRoute.cardVisible,
    `click on map sets GPS destination & computes A* road route (${JSON.stringify(clickedRoute)})`)

  // Also test clicking a quick-destination chip (Ferry Building) for an iconic multi-block downtown route!
  const chipOk = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('#world-map .wm-chip')].find((b) => b.textContent.includes('Ferry Building'))
    if (!chip) return false
    chip.click()
    return true
  })
  await page.waitForTimeout(650)
  const ferryRoute = await page.evaluate(() => {
    const m = globalThis.engine.map
    return { name: m.destination?.name, totalM: Math.round(m.route?.totalM ?? 0), pts: m.route?.cum.length ?? 0, computeMs: Math.round((m.route?.computeMs ?? 0) * 100) / 100 }
  })
  check(chipOk && ferryRoute.name === 'Ferry Building' && ferryRoute.totalM > 400,
    `landmark chip routes cleanly to Ferry Building (${JSON.stringify(ferryRoute)})`)
  await page.screenshot({ path: join(shots, '02-desk-fullscreen-2d-route.png') })

  // Toggle 3D mode on the fullscreen map and inspect!
  await page.click('#world-map .wm-3d')
  await page.waitForTimeout(750)
  const mode3d = await page.evaluate(() => ({ mode: globalThis.engine.map.mode, renderMs: globalThis.engine.map.stats.renderMs }))
  check(mode3d.mode === '3d', `3D button switches fullscreen map to 3D tilted view (render ${mode3d.renderMs} ms)`)
  await page.screenshot({ path: join(shots, '03-desk-fullscreen-3d-route.png') })

  // Measure frame pacing smoothness while fullscreen 3D map is animating/panning!
  const mapFps = await page.evaluate(async () => {
    const gaps = []
    let prev = performance.now()
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => requestAnimationFrame(() => r()))
      const now = performance.now()
      gaps.push(now - prev)
      prev = now
    }
    gaps.sort((a, b) => a - b)
    return { p50: Math.round(gaps[gaps.length >> 1] * 10) / 10, p95: Math.round(gaps[Math.floor(gaps.length * 0.95)] * 10) / 10 }
  })
  check(mapFps.p50 <= 18.5, `fullscreen 3D map runs smoothly at 60 fps (p50 ${mapFps.p50} ms, p95 ${mapFps.p95} ms)`)

  // Close fullscreen map with Escape and inspect 3D minimap with active glowing pink route!
  await page.keyboard.press('Escape')
  await page.waitForTimeout(550)
  const closedByEsc = await page.evaluate(() => ({
    open: globalThis.engine.map.open,
    mmVisible: !!document.querySelector('#minimap')?.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
    destStillActive: !!globalThis.engine.map.destination,
  }))
  check(!closedByEsc.open && closedByEsc.mmVisible && closedByEsc.destStillActive,
    `Escape closes fullscreen map while keeping active GPS route on 3D minimap (${JSON.stringify(closedByEsc)})`)

  // Drop player onto a street in downtown/North Beach facing along the route so we see 3D buildings + pink route on minimap!
  await page.evaluate(() => {
    const e = globalThis.engine, r = e.map.route
    if (r && r.cum.length >= 6) {
      // Place player near 10th route vertex looking down the road!
      const idx = Math.min(8, r.cum.length - 3)
      const x = r.points[idx * 2], z = r.points[idx * 2 + 1]
      const nx = r.points[(idx + 1) * 2], nz = r.points[(idx + 1) * 2 + 1]
      const yaw = Math.atan2(nx - x, -(nz - z))
      e.me.walk(false)
      const gy = e.ground(x, z)
      Object.assign(e.pose, { x, y: Math.max(gy + 4, 8), z, yaw, pitch: -0.05 })
    }
  })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: join(shots, '04-desk-minimap-3d-route.png') })
  // Also take a crisp cropped screenshot of just the #minimap element so we can inspect every pixel beside Ref 1 & 2!
  const mmBox = await page.locator('#minimap').boundingBox()
  if (mmBox) {
    await page.screenshot({
      path: join(shots, '05-desk-minimap-closeup.png'),
      clip: { x: Math.max(0, mmBox.x - 14), y: Math.max(0, mmBox.y - 14), width: mmBox.width + 28, height: mmBox.height + 28 },
    })
  }

  // Test live distance update + arrival auto-clear!
  const remBefore = await page.evaluate(() => globalThis.engine.map.progress?.remainingM ?? 0)
  await page.evaluate(() => {
    const e = globalThis.engine, d = e.map.destination
    if (d) { Object.assign(e.pose, { x: d.x, z: d.z }) }
  })
  await page.waitForTimeout(350)
  const arrivedState = await page.evaluate(() => ({ dest: globalThis.engine.map.destination, route: globalThis.engine.map.route }))
  check(remBefore > 200 && !arrivedState.dest && !arrivedState.route,
    `reaching destination auto-clears GPS route cleanly (remaining before=${Math.round(remBefore)} m)`)

  // Test clicking the minimap opens the fullscreen map, and clicking Visit fast-travels cleanly!
  await page.click('#minimap')
  await page.waitForTimeout(350)
  check(await page.evaluate(() => globalThis.engine.map.open), 'clicking #minimap opens fullscreen map')
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('#world-map .wm-chip')].find((b) => b.textContent.includes('Coit Tower'))
    chip?.click()
  })
  await page.waitForTimeout(250)
  const beforeVisit = await page.evaluate(() => ({ x: globalThis.engine.pose.x, z: globalThis.engine.pose.z }))
  await page.click('#world-map .wm-visit')
  await page.waitForTimeout(900)
  const afterVisit = await page.evaluate(() => ({
    open: globalThis.engine.map.open,
    dest: globalThis.engine.map.destination,
    movedM: Math.round(Math.hypot(globalThis.engine.pose.x - 55200, globalThis.engine.pose.z - 66100)),
    x: globalThis.engine.pose.x,
    z: globalThis.engine.pose.z,
  }))
  const visitDist = Math.hypot(afterVisit.x - beforeVisit.x, afterVisit.z - beforeVisit.z)
  check(!afterVisit.open && !afterVisit.dest && visitDist > 150,
    `Visit button fast-travels to Coit Tower (${Math.round(visitDist)} m jump) and closes map cleanly`)
  await page.keyboard.press('KeyM')
  await page.waitForTimeout(300)
  check(await page.evaluate(() => globalThis.engine.map.open), 'M re-opens map after Visit')
  await page.keyboard.press('KeyM')
  await page.waitForTimeout(300)
  check(await page.evaluate(() => !globalThis.engine.map.open), 'pressing M closes fullscreen map')

  const deskFaults = await page.evaluate(() => globalThis.engine.gpu.faults.slice(0, 5))
  check(deskFaults.length === 0, `zero WebGPU device faults on desktop${deskFaults.length ? `: ${deskFaults.join(' | ')}` : ''}`)

  await deskCtx.close()

  // ── 2. Upright Phone (390 x 844, touch + iPhone safe insets) ──
  console.log('\nupright phone (390x844):')
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const pPage = await phoneCtx.newPage()
  pPage.on('pageerror', (e) => errors.push(`phone: ${e.message}`))
  const cdpP = await phoneCtx.newCDPSession(pPage)
  await cdpP.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34, left: 0, right: 0 } })
  await pPage.goto(`${site.url}/sf/index.html`)
  await pPage.waitForFunction(() => globalThis.engine?.seen?.near > 0 && globalThis.engine.explore && globalThis.engine.map, null, { timeout: 180_000 })
  await pPage.evaluate(() => { globalThis.engine.scale = 0.6; void globalThis.engine.explore.go() })
  await until(pPage, () => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet && globalThis.engine.map.ready, 90_000)
  await pPage.evaluate(() => { globalThis.engine.me.standOff = 0 })
  await pPage.waitForTimeout(900)
  // Route to actual Ferry Building landmark via chip!
  await pPage.evaluate(() => {
    const chip = [...document.querySelectorAll('#world-map .wm-chip')].find((b) => b.textContent.includes('Ferry Building'))
    chip?.click()
  })
  await pPage.waitForTimeout(500)
  await pPage.screenshot({ path: join(shots, '06-phone-portrait-minimap.png') })

  const pBox = await pPage.locator('#minimap').boundingBox()
  check(!!pBox && pBox.y >= 59 && pBox.width >= 120, `portrait phone minimap clears safe area top (y=${pBox?.y}, w=${pBox?.width})`)
  if (pBox) await pPage.touchscreen.tap(pBox.x + pBox.width / 2, pBox.y + pBox.height / 2)
  await pPage.waitForTimeout(550)
  check(await pPage.evaluate(() => globalThis.engine.map.open), 'tapping minimap on phone opens fullscreen map')
  await pPage.screenshot({ path: join(shots, '07-phone-portrait-fullscreen.png') })
  await phoneCtx.close()

  // ── 3. Landscape Phone (844 x 390, touch + iPhone safe insets) ──
  console.log('\nlandscape phone (844x390):')
  const sideCtx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const sPage = await sideCtx.newPage()
  sPage.on('pageerror', (e) => errors.push(`side: ${e.message}`))
  const cdpS = await sideCtx.newCDPSession(sPage)
  await cdpS.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 21, left: 59, right: 59 } })
  await sPage.goto(`${site.url}/sf/index.html`)
  await sPage.waitForFunction(() => globalThis.engine?.seen?.near > 0 && globalThis.engine.explore && globalThis.engine.map, null, { timeout: 180_000 })
  await sPage.evaluate(() => { globalThis.engine.scale = 0.6; void globalThis.engine.explore.go() })
  await until(sPage, () => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet && globalThis.engine.map.ready, 90_000)
  await sPage.evaluate(() => {
    globalThis.engine.me.standOff = 0
    const chip = [...document.querySelectorAll('#world-map .wm-chip')].find((b) => b.textContent.includes('Ferry Building'))
    chip?.click()
  })
  await sPage.waitForTimeout(700)
  await sPage.screenshot({ path: join(shots, '08-phone-landscape-minimap.png') })
  const sBox = await sPage.locator('#minimap').boundingBox()
  check(!!sBox && sBox.x >= 59 && sBox.width >= 120, `landscape phone minimap clears safe area left (x=${sBox?.x}, w=${sBox?.width})`)
  await sideCtx.close()

  check(gpuErrors.length === 0, `zero WebGPU / console errors${gpuErrors.length ? `: ${gpuErrors.slice(0, 3).join(' | ')}` : ''}`)
  check(errors.length === 0, `zero page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
} catch (e) {
  console.log(`  FAIL ${e.message}`)
  failures.push(e.message)
} finally {
  await browser.close()
  site.stop()
  back()
}

writeFileSync(join(shots, 'summary.json'), JSON.stringify({ failures, errors }, null, 2))
console.log(failures.length ? `\nsf-map: ${failures.length} failed\n${failures.map((f) => `  - ${f}`).join('\n')}` : `\nsf-map: passed (screenshots in ${shots})`)
process.exit(failures.length ? 1 : 0)
