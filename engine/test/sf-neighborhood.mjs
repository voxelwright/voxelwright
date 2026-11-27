// Live WebGPU browser verification & visual capture for SF neighborhood character (#93).
// Checks Noe Valley Town Square (exact user feedback camera + close-ups + 24th St storefronts + night view)
// and additional SF neighborhoods (Hayes Valley / Patricia's Green, North Beach / Washington Square)
// from the built static SF realm (`engine/dist-sf`).
//
//   node engine/test/sf-neighborhood.mjs [--shots <dir>] [--no-build]
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, 'dist-sf')
const shotsDir = arg('shots', '')
const failures = []
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

if (!has('no-build') || !existsSync(join(dist, 'sf/index.html'))) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs')], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) {
    console.error(built.stdout + built.stderr)
    process.exit(1)
  }
}
if (shotsDir) mkdirSync(shotsDir, { recursive: true })

const site = await plain(dist, '127.0.0.1')
const back = await turn()
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) errors.push(`console: ${m.text()}`)
})

const waitSettled = async (ms = 60_000) => {
  await page.waitForFunction(
    () => {
      const e = globalThis.engine
      if (!e?.world?.stats) return false
      return e.world.stats.wanted === 0 && e.world.stats.stale === 0
    },
    null,
    { timeout: ms, polling: 200 },
  ).catch(() => null)
  // Allow 1.5s for neighborhood streaming, offscreen canvas atlas uploads, and frames to settle cleanly.
  await page.waitForTimeout(1500)
}

const moveTo = async ({ x, y, z, yaw, pitch, fov = 75, hour = 17.25, aboveGround = null }) => {
  await page.evaluate(
    ({ x, y, z, yaw, pitch, fov, hour, aboveGround }) => {
      const e = globalThis.engine
      e.rests = false
      e.hour = hour
      e.fov = fov
      const targetY = aboveGround !== null ? e.ground(x, z) + aboveGround : y
      Object.assign(e.pose, { x, y: targetY, z, yaw, pitch })
    },
    { x, y, z, yaw, pitch, fov, hour, aboveGround },
  )
  await waitSettled()
}

const shot = async (name) => {
  if (!shotsDir) return
  const out = join(shotsDir, `${name}.png`)
  await page.screenshot({ path: out })
  console.log(`  shot -> ${out}`)
}

const report = {}

try {
  // Open directly near Noe Valley Town Square (exact user feedback camera pose & hour!)
  await page.goto(`${site.url}/sf/index.html?hour=17.25&scale=0.85&rest=0`)
  await page.waitForFunction(() => globalThis.engine?.seen?.near > 0, null, { timeout: 120_000 })

  // 1. Exact user feedback camera at Noe Valley Town Square (`[50309.12, 57.05, 71585.83, -2.425, -0.253, 80]`, hour 17.25)
  await moveTo({ x: 50309.12, y: 57.05, z: 71585.83, yaw: -2.425, pitch: -0.253, fov: 80, hour: 17.25 })
  await page.waitForFunction(() => globalThis.engine?.neighborhood?.ready && globalThis.engine.neighborhood.stats.activeSigns > 0, null, { timeout: 30_000 })
  await page.waitForTimeout(1000)
  const nvStats = await page.evaluate(() => ({
    stats: globalThis.engine.neighborhood.stats,
    signs: globalThis.engine.neighborhood.visibleSigns(),
    near: globalThis.engine.neighborhood.near(50303, 71621, 220),
    inspect: globalThis.engine.neighborhood.inspect(),
    gpuMs: globalThis.engine.gpuMs,
    cpuMs: globalThis.engine.cpuMs,
    frameMs: globalThis.engine.frameMs,
    folkDrawn: globalThis.engine.folk.drawn,
  }))
  report.noeFeedback = nvStats
  console.log('Noe Valley feedback camera:', JSON.stringify(nvStats.stats), `gpuMs=${nvStats.gpuMs.toFixed(1)}`, `folk=${nvStats.folkDrawn}`)
  check(nvStats.stats.totalShops >= 8000, `citywide storefronts loaded (${nvStats.stats.totalShops})`)
  check(nvStats.stats.totalPlazas >= 200, `citywide plazas loaded (${nvStats.stats.totalPlazas})`)
  check(nvStats.stats.activePlazas >= 1, `Noe Valley Town Square active (${nvStats.stats.activePlazas})`)
  check(nvStats.stats.activeSigns >= 10, `storefront + plaza signs active at Noe Valley (${nvStats.stats.activeSigns})`)
  check(nvStats.stats.activeProps >= 20, `3D voxel plaza & sidewalk props active (${nvStats.stats.activeProps})`)
  check(nvStats.stats.activePeople >= 12, `gathering neighborhood crowd active (${nvStats.stats.activePeople})`)
  const nvPlaza = nvStats.inspect.plazas.find((p) => p.id === 'noe-valley-town-square')
  check(!!nvPlaza && nvPlaza.groundM > 20 && nvPlaza.propMinYM >= nvPlaza.groundM - 1.5, `Noe Valley Town Square props seated on live L0 ground (ground=${nvPlaza?.groundM.toFixed(1)}m, propMinY=${nvPlaza?.propMinYM.toFixed(1)}m)`)
  check(!!nvPlaza && nvPlaza.roadPropHits === 0, `Noe Valley Town Square has zero props on asphalt road (hits=${nvPlaza?.roadPropHits})`)
  check(nvStats.signs.filter((s) => s.title.includes('NOE VALLEY TOWN SQUARE')).length >= 2, 'NOE VALLEY TOWN SQUARE front & back archway plaques active')
  check(nvStats.near.shops.some((s) => s.parody && s.brandId === 'whole-foods'), 'Whole Foods parody present on 24th St')
  await shot('01-noe-valley-feedback-camera')

  // 2. Inside Noe Valley Town Square looking south into the pavilion, benches, market stalls & crowd (eye level)
  await moveTo({ x: 50300.5, y: 0, z: 71596.5, yaw: 3.12, pitch: -0.06, fov: 72, hour: 15.5, aboveGround: 2.2 })
  await shot('02-noe-valley-square-inside')

  // 3. Street-level look down 24th St (westbound showing Martha & Bros Coffee patio, Holey Bagel, Banán, Haystack Pizza, Hi-Way Burger!)
  await moveTo({ x: 50318.0, y: 0, z: 71590.5, yaw: -1.58, pitch: -0.04, fov: 72, hour: 16.0, aboveGround: 2.0 })
  await shot('03-noe-24th-st-storefronts')

  // 4. Further west on 24th St toward Whole Moods Market (parody Whole Foods at ~3950 24th St -> x≈50185, z≈71580)
  const wfPos = await page.evaluate(() => {
    const near = globalThis.engine.neighborhood.near(50220, 71585, 280)
    return near.shops.find((s) => s.brandId === 'whole-foods') ?? null
  })
  if (wfPos) {
    // Stand across the street looking directly at Whole Moods Market!
    await moveTo({ x: wfPos.x + 12, y: 0, z: wfPos.z + 14, yaw: -0.7, pitch: -0.05, fov: 70, hour: 16.0, aboveGround: 2.2 })
    const wfLook = await page.evaluate((wf) => {
      const e = globalThis.engine
      const dx = wf.x - e.pose.x, dz = wf.z - e.pose.z
      e.pose.yaw = Math.atan2(dx, -dz)
      e.pose.pitch = 0.05
      const insp = e.neighborhood.inspect()
      const wm = insp.shops.find((s) => s.brandId === 'whole-foods') ?? null
      return { yaw: e.pose.yaw, signs: e.neighborhood.visibleSigns().map((s) => s.title), wm }
    }, wfPos)
    await page.waitForTimeout(800)
    console.log('Whole Moods Market check:', wfPos.name, wfLook.wm, 'visible signs:', wfLook.signs.filter((t) => /whole|moods|starbuxx|books|tulip/i.test(t)))
    check(!!wfLook.wm && wfLook.wm.signYM >= wfLook.wm.groundM + 2.8, `Whole Moods fascia mounted cleanly above ground/awning (signY=${wfLook.wm?.signYM.toFixed(1)}m, ground=${wfLook.wm?.groundM.toFixed(1)}m, clearedAwning=${wfLook.wm?.clearedAwning})`)
    await shot('04-noe-whole-moods-parody')
  }

  // 5. Night view of Noe Valley Town Square (glowing string lights & backlit archway + signs!)
  await moveTo({ x: 50309.12, y: 57.05, z: 71585.83, yaw: -2.425, pitch: -0.253, fov: 80, hour: 21.0 })
  await shot('05-noe-valley-night')

  // 6. Systemic check #2: Hayes Valley / Patricia's Green (looking straight west from Octavia St into the square!)
  await moveTo({ x: 50706, y: 0, z: 68853, yaw: -1.55, pitch: -0.06, fov: 74, hour: 16.0, aboveGround: 3.2 })
  const hvStats = await page.evaluate(() => ({
    stats: globalThis.engine.neighborhood.stats,
    signs: globalThis.engine.neighborhood.visibleSigns().slice(0, 12).map((s) => s.title),
    inspect: globalThis.engine.neighborhood.inspect(),
  }))
  report.hayesValley = hvStats
  console.log('Hayes Valley:', JSON.stringify(hvStats.stats), hvStats.signs.slice(0, 6))
  const pgPlaza = hvStats.inspect.plazas.find((p) => p.id === 'patricias-green')
  check(hvStats.stats.activePlazas >= 1 && hvStats.stats.activeSigns >= 8, `Hayes Valley plaza & storefronts active (${hvStats.stats.activePlazas} plazas, ${hvStats.stats.activeSigns} signs)`)
  check(!!pgPlaza && pgPlaza.propMinYM >= pgPlaza.groundM - 1.5, `Patricia's Green props seated cleanly on L0 ground (ground=${pgPlaza?.groundM.toFixed(1)}m, propMinY=${pgPlaza?.propMinYM.toFixed(1)}m)`)
  check(!!pgPlaza && pgPlaza.roadPropHits === 0, `Patricia's Green has zero props on asphalt road (hits=${pgPlaza?.roadPropHits})`)
  await shot('06-hayes-valley-patricias-green')

  // 7. Systemic check #3: North Beach / Washington Square + Columbus Ave
  await moveTo({ x: 51908, y: 0, z: 66168, yaw: 0.55, pitch: -0.08, fov: 74, hour: 16.0, aboveGround: 3.6 })
  const nbStats = await page.evaluate(() => ({
    stats: globalThis.engine.neighborhood.stats,
    signs: globalThis.engine.neighborhood.visibleSigns().slice(0, 12).map((s) => s.title),
    inspect: globalThis.engine.neighborhood.inspect(),
  }))
  report.northBeach = nbStats
  console.log('North Beach:', JSON.stringify(nbStats.stats), nbStats.signs.slice(0, 6))
  const wsPlaza = nbStats.inspect.plazas.find((p) => p.id === 'washington-square')
  check(nbStats.stats.activePlazas >= 1 && nbStats.stats.activeSigns >= 8, `North Beach plaza & storefronts active (${nbStats.stats.activePlazas} plazas, ${nbStats.stats.activeSigns} signs)`)
  check(!!wsPlaza && wsPlaza.propMinYM >= wsPlaza.groundM - 1.5, `Washington Square props seated cleanly on L0 ground (ground=${wsPlaza?.groundM.toFixed(1)}m, propMinY=${wsPlaza?.propMinYM.toFixed(1)}m)`)
  check(!!wsPlaza && wsPlaza.roadPropHits === 0, `Washington Square has zero props on asphalt road (hits=${wsPlaza?.roadPropHits})`)
  await shot('07-north-beach-washington-sq')

  check(errors.length === 0, `zero page/console errors (${errors.length}${errors.length ? ': ' + errors[0] : ''})`)
  if (shotsDir) writeFileSync(join(shotsDir, 'report.json'), JSON.stringify(report, null, 2))
} finally {
  await browser.close()
  site.stop()
  back()
}

if (failures.length) {
  console.error(`FAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log('PASS sf-neighborhood')
