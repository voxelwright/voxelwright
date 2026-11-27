// Verifies the lower-window effects below the sky-gap drone video screen (#133, page/eggs-pictures.ts,
// page/realm-ui.ts, page/eggs.ts):
//   - Settings toggle (`Window glow`: Ambient [default], EQ, Off), persistence in `localStorage` (`village.windowEffect`),
//     and clean layout across desk (1440x900), upright phone (390x844), and landscape phone (844x390).
//   - Live switching while a video egg plays:
//       * `off`       flat dim outside framing below `march.screen.rect[3]`
//       * `ambilight` smooth vertically-mirrored skylight spill with downward alpha fade back into warm lamps
//       * `equalizer` live Web Audio AnalyserNode vertical bars with peak-hold caps animating below the skyline
//
//   node test/sf-window-fx.mjs [--no-build] [--dist dist-sf] [--shots ~/.village/engine/sf/window-fx]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf'))
const shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'window-fx'))
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
const hasMedia = readFileSync(join(dist, 'sf/index.html'), 'utf8').includes('data-egg-media')
if (!hasMedia) {
  console.log('skip: dist-sf was built without VOXELWRIGHT_EGG_MEDIA (no video eggs installed)')
  process.exit(0)
}

mkdirSync(shots, { recursive: true })
const site = await plain(dist, '127.0.0.1', 0)
const back = await turn()
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { back(); process.exit(1) })
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
const results = {}

/** Reads back march.screen.texture (256x144 RGBA) and summarizes the region strictly below `rect[3]`. */
const inspectLowerBand = (page) => page.evaluate(async () => {
  const e = globalThis.engine, d = e.gpu.device, t = e.march.screen.texture
  const rect = [...e.march.screen.rect]
  const b = d.createBuffer({ size: t.width * t.height * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  const enc = d.createCommandEncoder()
  enc.copyTextureToBuffer({ texture: t }, { buffer: b, bytesPerRow: t.width * 4 }, [t.width, t.height])
  d.queue.submit([enc.finish()])
  await b.mapAsync(GPUMapMode.READ)
  const px = new Uint8Array(b.getMappedRange()).slice()
  b.unmap()
  b.destroy()
  const yStart = Math.min(t.height - 2, Math.ceil(rect[3] * t.height) + 1)
  const yMid = Math.floor((yStart + t.height) / 2)
  let sumLuma = 0, maxLuma = 0, minLuma = 255, n = 0
  let topAlpha = 0, topN = 0, botAlpha = 0, botN = 0
  const colMax = new Float32Array(t.width)
  for (let y = yStart; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) {
      const i = (y * t.width + x) * 4
      const luma = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
      sumLuma += luma
      if (luma > maxLuma) maxLuma = luma
      if (luma < minLuma) minLuma = luma
      if (luma > colMax[x]) colMax[x] = luma
      n++
      if (y < yStart + 6) { topAlpha += px[i + 3]; topN++ }
      if (y >= t.height - 6) { botAlpha += px[i + 3]; botN++ }
    }
  }
  // Column-to-column luminance standard deviation (high for EQ bars with dark gaps, smooth/low for flat outside).
  let colMean = 0
  for (let x = 0; x < t.width; x++) colMean += colMax[x]
  colMean /= t.width
  let colVar = 0
  for (let x = 0; x < t.width; x++) colVar += (colMax[x] - colMean) ** 2
  const colStd = Math.sqrt(colVar / t.width)
  // Sample 16 evenly spaced columns from the lower band for frame-to-frame motion comparison.
  const sig = []
  for (let k = 0; k < 16; k++) {
    const x = Math.floor(((k + 0.5) * t.width) / 16)
    const i = (yMid * t.width + x) * 4
    sig.push(Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]))
  }
  return {
    rect,
    yStart,
    rows: t.height - yStart,
    meanLuma: Math.round((sumLuma / Math.max(1, n)) * 10) / 10,
    maxLuma: Math.round(maxLuma),
    minLuma: Math.round(minLuma),
    topAlpha: Math.round(topAlpha / Math.max(1, topN)),
    botAlpha: Math.round(botAlpha / Math.max(1, botN)),
    colStd: Math.round(colStd * 10) / 10,
    sig,
  }
})

const checkSettingsPanel = (page) => page.evaluate(() => {
  const sky = document.querySelector('#realm .sky')
  const vis = (el) => !!el && !el.closest('[hidden]') && el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getBoundingClientRect().width > 2
  const ctl = [...sky.querySelectorAll('header, .vx-toggle-group > label, .vx-slider, .res-auto, .foot > .vx-button')].filter(vis)
  const p = sky.getBoundingClientRect()
  const cell = parseFloat(getComputedStyle(sky).getPropertyValue('--vx')) || 4
  const meet = [], out = [], cramped = []
  for (let i = 0; i < ctl.length; i++) {
    const a = ctl[i].getBoundingClientRect()
    if (a.left < p.left - 0.5 || a.right > p.right + 0.5 || a.top < p.top - 0.5 || a.bottom > p.bottom + 0.5 || a.right > innerWidth || a.bottom > innerHeight) out.push(ctl[i].textContent.trim().slice(0, 20))
    for (let j = i + 1; j < ctl.length; j++) {
      if (ctl[i].contains(ctl[j]) || ctl[j].contains(ctl[i])) continue
      const b = ctl[j].getBoundingClientRect()
      if (a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5) meet.push(`${ctl[i].textContent.trim().slice(0, 16)} on ${ctl[j].textContent.trim().slice(0, 16)}`)
    }
  }
  for (const l of sky.querySelectorAll('.vx-toggle-group > label')) {
    if (!vis(l)) continue
    const w = (l.querySelector('.vx-label') ?? l).getBoundingClientRect(), r = l.getBoundingClientRect()
    if (w.left < r.left + 2 * cell || w.right > r.right - 2 * cell) cramped.push(l.textContent.trim())
  }
  return { meet, out, cramped, winFxVisible: vis(sky.querySelector('.win-fx')), checked: sky.querySelector('input[name=realm-window-fx]:checked')?.value ?? null }
})

try {
  // ── 1. Portrait phone (390 x 844, matching IMG_6792.png): Settings toggle + Doom & Rickroll visual + pixel proof ──
  console.log('\nportrait phone (390 x 844)')
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const phone = await phoneCtx.newPage()
  const phoneErrors = []
  phone.on('pageerror', (e) => phoneErrors.push(e.message))
  phone.on('console', (m) => { if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) phoneErrors.push(m.text()) })
  await phone.goto(`${site.url}/sf/index.html`)
  await phone.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.eggs && globalThis.engine.far?.whole, null, { timeout: 180_000 })
  await phone.waitForTimeout(1200)

  // Open Settings via tap on the gear, verify default 'ambilight', zero cramping/overlap.
  const gearBox = await phone.locator('#realm .fold').boundingBox()
  await phone.touchscreen.tap(gearBox.x + gearBox.width / 2, gearBox.y + gearBox.height / 2)
  await phone.waitForTimeout(600)
  const panelPhone = await checkSettingsPanel(phone)
  check(panelPhone.winFxVisible && panelPhone.checked === 'ambilight' && !panelPhone.meet.length && !panelPhone.out.length && !panelPhone.cramped.length,
    `portrait Settings: Window glow visible, default Ambient checked, clean layout (${JSON.stringify(panelPhone)})`)
  // Close Settings before starting video eggs.
  await phone.touchscreen.tap(gearBox.x + gearBox.width / 2, gearBox.y + gearBox.height / 2)
  await phone.waitForTimeout(400)

  // Start Rickroll (long lively music video with steady beat + rich colors) in portrait!
  await phone.evaluate(() => { globalThis.engine.eggs.say('never gonna give you up') })
  await phone.waitForFunction(() => globalThis.engine.eggs.state.running === 'rickroll' && globalThis.engine.eggs.state.playing && globalThis.engine.march.screen.up >= 0.99, null, { timeout: 30_000 })
  // Tuck player aside so screenshots match IMG_6792.png cleanly.
  const tuckBtn = phone.locator('.egg-player .tuck')
  if (await tuckBtn.isVisible()) await tuckBtn.tap()
  await phone.waitForTimeout(900)

  // Hold at 20 s for an apples-to-apples Off vs Ambilight comparison on the exact same frame.
  await phone.evaluate(() => { globalThis.engine.eggs.hold(20) })
  await phone.waitForFunction(() => { const m = globalThis.engine.eggs.media; return m && !m.seeking && Math.abs(m.currentTime - 20) < 0.25 }, null, { timeout: 10_000 })
  await phone.waitForTimeout(600)

  const ambilightRick = await inspectLowerBand(phone)
  await phone.screenshot({ path: join(shots, 'phone-rick-ambilight.png') })

  await phone.evaluate(() => { globalThis.engine.windowEffect = 'off' })
  await phone.waitForTimeout(350)
  const offRick = await inspectLowerBand(phone)
  await phone.screenshot({ path: join(shots, 'phone-rick-off.png') })

  check(ambilightRick.rows >= 30, `portrait leaves a tall lower window band (${ambilightRick.rows} of 144 texels below video)`)
  check(ambilightRick.meanLuma > offRick.meanLuma + 15 && ambilightRick.topAlpha > ambilightRick.botAlpha + 80,
    `Ambilight lights lower windows (mean luma ${ambilightRick.meanLuma} vs off ${offRick.meanLuma}) and fades lamp mask downward (alpha ${ambilightRick.topAlpha} -> ${ambilightRick.botAlpha})`)
  check(offRick.maxLuma - offRick.minLuma <= 2, `Off keeps flat dim outside framing (min ${offRick.minLuma}, max ${offRick.maxLuma})`)

  // Now unhold Rickroll and switch to Equalizer via the real Settings UI tap!
  await phone.evaluate(() => { globalThis.engine.eggs.hold(null) })
  await phone.touchscreen.tap(gearBox.x + gearBox.width / 2, gearBox.y + gearBox.height / 2)
  await phone.waitForTimeout(450)
  const eqLabel = await phone.locator('#realm .window-fx label:has(input[value="equalizer"])').boundingBox()
  await phone.touchscreen.tap(eqLabel.x + eqLabel.width / 2, eqLabel.y + eqLabel.height / 2)
  await phone.waitForTimeout(300)
  const persisted = await phone.evaluate(() => ({ mode: globalThis.engine.windowEffect, stored: localStorage.getItem('village.windowEffect') }))
  check(persisted.mode === 'equalizer' && persisted.stored === 'equalizer', `tapping EQ in Settings switches live and persists (${JSON.stringify(persisted)})`)
  await phone.touchscreen.tap(gearBox.x + gearBox.width / 2, gearBox.y + gearBox.height / 2)
  await phone.waitForTimeout(900)

  const eqRick1 = await inspectLowerBand(phone)
  await phone.screenshot({ path: join(shots, 'phone-rick-equalizer.png') })
  await phone.waitForTimeout(450)
  const eqRick2 = await inspectLowerBand(phone)
  const eqDelta = eqRick1.sig.reduce((s, v, i) => s + Math.abs(v - eqRick2.sig[i]), 0)
  check(eqRick1.maxLuma > 120 && eqRick1.colStd > 15 && eqDelta > 10,
    `Equalizer renders bright, distinct, live-moving audio bars (maxLuma ${eqRick1.maxLuma}, colStd ${eqRick1.colStd}, motion delta ${eqDelta})`)

  // Also capture Doom ("I Like Ya Cut, G (Doom)" from IMG_6792.png) in Ambilight + Equalizer + Off!
  await phone.evaluate(() => { globalThis.engine.windowEffect = 'ambilight'; globalThis.engine.eggs.say('doom') })
  await phone.waitForFunction(() => globalThis.engine.eggs.state.running === 'doom' && globalThis.engine.eggs.state.playing && globalThis.engine.march.screen.up >= 0.99, null, { timeout: 30_000 })
  await phone.waitForTimeout(1400)
  await phone.evaluate(() => { globalThis.engine.eggs.hold(2.2) })
  await phone.waitForFunction(() => { const m = globalThis.engine.eggs.media; return m && !m.seeking }, null, { timeout: 5_000 })
  await phone.waitForTimeout(450)
  await phone.screenshot({ path: join(shots, 'phone-doom-ambilight.png') })
  await phone.evaluate(() => { globalThis.engine.windowEffect = 'off' })
  await phone.waitForTimeout(300)
  await phone.screenshot({ path: join(shots, 'phone-doom-off.png') })

  // Restore default 'ambilight' and test clean stop
  await phone.evaluate(() => { globalThis.engine.windowEffect = 'ambilight'; globalThis.engine.eggs.undo(true); localStorage.removeItem('village.windowEffect') })
  check(phoneErrors.length === 0, `no errors on portrait phone (${phoneErrors.slice(0, 2).join(' | ') || 'clean'})`)
  results.phone = { panelPhone, ambilightRick, offRick, eqRick1, eqRick2, eqDelta }

  // ── 2. Landscape phone (844 x 390): Settings panel stays clean & clear ──
  console.log('\nlandscape phone (844 x 390)')
  const sideCtx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const side = await sideCtx.newPage()
  const sideErrors = []
  side.on('pageerror', (e) => sideErrors.push(e.message))
  await side.goto(`${site.url}/sf/index.html`)
  await side.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.eggs && globalThis.engine.far?.whole, null, { timeout: 180_000 })
  await side.waitForTimeout(1000)
  const sideGear = await side.locator('#realm .fold').boundingBox()
  await side.touchscreen.tap(sideGear.x + sideGear.width / 2, sideGear.y + sideGear.height / 2)
  await side.waitForTimeout(500)
  const panelSide = await checkSettingsPanel(side)
  check(!panelSide.meet.length && !panelSide.out.length && !panelSide.cramped.length,
    `landscape phone first-view Settings clean (${JSON.stringify(panelSide)})`)
  check(sideErrors.length === 0, `no errors on landscape phone`)
  results.side = { panelSide }

  // ── 3. Desktop landscape (1440 x 900): verify Ambilight & Equalizer on 4:3 Rickroll side pillars ──
  console.log('\ndesktop (1440 x 900)')
  const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const desk = await deskCtx.newPage()
  const deskErrors = []
  desk.on('pageerror', (e) => deskErrors.push(e.message))
  await desk.goto(`${site.url}/sf/index.html`)
  await desk.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.eggs && globalThis.engine.far?.whole, null, { timeout: 180_000 })
  await desk.waitForTimeout(1000)
  await desk.evaluate(() => { globalThis.engine.eggs.say('never gonna give you up') })
  await desk.waitForFunction(() => globalThis.engine.eggs.state.running === 'rickroll' && globalThis.engine.eggs.state.playing && globalThis.engine.march.screen.up >= 0.99, null, { timeout: 30_000 })
  await desk.waitForTimeout(1200)
  await desk.screenshot({ path: join(shots, 'desk-rick-ambilight.png') })
  await desk.evaluate(() => { globalThis.engine.windowEffect = 'equalizer' })
  await desk.waitForTimeout(900)
  await desk.screenshot({ path: join(shots, 'desk-rick-equalizer.png') })
  check(deskErrors.length === 0, `no errors on desktop`)
  results.desk = { ok: deskErrors.length === 0 }
} catch (e) {
  console.error(e)
  failures.push(String(e))
} finally {
  writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 2))
  // Exit cleanly without waiting on macOS WebGPU context teardown hang.
  site.stop?.()
  back()
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join('\n  ')}` : '\nall window-fx checks passed')
  process.exit(failures.length ? 1 : 0)
}
