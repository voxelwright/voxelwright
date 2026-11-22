// Every vehicle of the SF realm's library close up (#450), for looking at beside the saloon: the line-up (street.ts
// `lineup`) spread 12 m apart on the Embarcadero, and each seen from 8 m off its front corner and from its side.
//
//   node sf/vehicle-shots.mjs --out ~/.village/engine/sf/street/vehicles-new [--dist dist-sf] [--no-build] [--hour 12.5]
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from '../test/kit.mjs'
import { plain } from '../player/serve.mjs'

const out = arg('out', join(homedir(), '.village', 'engine', 'sf', 'street', 'vehicles-new')), dist = join(here, arg('dist', 'dist-sf'))
mkdirSync(out, { recursive: true })
if (!has('no-build')) { const b = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' }); if (b.status !== 0) throw new Error(b.stdout + b.stderr) }
const back = await turn(), browser = await chromium.launch(CHROME), site = await plain(dist, '127.0.0.1', 0, {})
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
page.on('pageerror', (e) => console.log('page error:', e.message))
try {
  await page.goto(`${site.url}/sf/index.html?hour=${arg('hour', '12.5')}&first=0&people=0`)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.street?.ready, null, { timeout: 300_000 })
  await page.addStyleTag({ content: '#hud, #aim, #boom, #tools, #over, #where, #realm, #first { display: none !important }' })
  const settle = () => page.waitForFunction(() => { const s = globalThis.engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 90_000, polling: 250 }).catch(() => null)
  // The Embarcadero's middle near Pier 7 (sf-life's line-up), the row along the street.
  const graphs = readdirSync(join(here, 'sf/pilot-graph')).map((f) => JSON.parse(readFileSync(join(here, 'sf/pilot-graph', f), 'utf8')))
  let best = null
  for (const g of graphs) for (const r of g.roads) if (r.name === 'The Embarcadero') { const [a, b] = r.line, d = Math.hypot((a[0] + b[0]) / 2 - 528000, (a[1] + b[1]) / 2 - 661600); if (!best || d < best.d) best = { d, a, b } }
  const l = Math.hypot(best.b[0] - best.a[0], best.b[1] - best.a[1]), dx = (best.b[0] - best.a[0]) / l, dz = (best.b[1] - best.a[1]) / l
  // The row along the street (street.ts lineup: it goes off to the vehicles' left), each across it, the fronts 6 m past its middle.
  const heading = Math.atan2(dx, -dz), at = [(best.a[0] + best.b[0]) / 2 - dx * 500 + Math.cos(heading) * 60, (best.a[1] + best.b[1]) / 2 - dz * 500 + Math.sin(heading) * 60]
  const row = await page.evaluate(({ at, heading }) => {
    const e = globalThis.engine, names = e.street.lineup(at, heading, 120)
    return names
  }, { at, heading })
  // Where each stands: as lineup places them (its front on the line, the row off to its left, `gap` 120 between).
  const realm = JSON.parse(readFileSync(join(dist, 'sf/index.html'), 'utf8').match(/<script type="application\/json" id="realm">([^<]+)<\/script>/)[1])
  const sizes = JSON.parse(readFileSync(join(dist, 'sf', realm.street.cars, 'index.json'), 'utf8')).cars.map((c) => ({ long: c.front < 2 ? c.size[0] : c.size[2], wide: c.front < 2 ? c.size[2] : c.size[0] }))
  console.log('  line-up:', row.join(', '))
  await page.waitForTimeout(4000)
  const fx = Math.cos(heading), fz = Math.sin(heading), lx = fz, lz = -fx
  let along = 0
  for (const [i, name] of row.entries()) {
    const m = sizes?.[i] ?? { long: 50, wide: 22 }
    const cx = at[0] + lx * (along + m.wide / 2) - fx * m.long / 2, cz = at[1] + lz * (along + m.wide / 2) - fz * m.long / 2
    along += m.wide + 120
    for (const [view, ex, ez] of [['corner', cx + fx * (m.long / 2 + 45) - lx * (m.wide / 2 + 45), cz + fz * (m.long / 2 + 45) - lz * (m.wide / 2 + 45)], ['side', cx - lx * (m.wide / 2 + 70), cz - lz * (m.wide / 2 + 70)]]) {
      await page.evaluate(({ ex, ez, cx, cz }) => { const e = globalThis.engine; Object.assign(e.pose, { x: ex / 10, z: ez / 10, y: e.ground(ex / 10, ez / 10) + 1.7, yaw: Math.atan2(cx - ex, -(cz - ez)), pitch: -0.08 }); e.fov = 60 }, { ex, ez, cx, cz })
      await page.waitForTimeout(1500); await settle(); await page.waitForTimeout(2500)
      await page.screenshot({ path: join(out, `${name.replace(/ /g, '-')}-${view}.png`) })
    }
  }
  console.log(`  ${row.length * 2} pictures in ${out}`)
} finally { await browser.close(); back() }
process.exit(0)
