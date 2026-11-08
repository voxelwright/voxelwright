// #42 experiment: capture every generated prop in ?cam=iso and a close view,
// record draw calls and triangles against a baseline, and time the floor
// (placing a copy of the existing chair from a parsed command).
// Usage: node scripts/props/capture.mjs <out-dir> [base-url]   (dev server running)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const out = resolve(process.argv[2])
const base = process.argv[3] ?? 'http://localhost:5302/'
const results = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'))
mkdirSync(join(out, 'shots'), { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })

async function shoot(query, file) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(`${base}?talk=off&build=0&cam=iso&q=high&${query}`)
  await page.waitForFunction(() => window.village && window.villageProps, null, { timeout: 30000 })
  await page.evaluate(() => window.village.ready())
  const report = await page.evaluate(() => window.villageProps.loaded)
  await page.waitForTimeout(2500)
  const render = await page.evaluate(() => window.village.snapshot().render)
  if (file) await page.screenshot({ path: join(out, 'shots', file), type: 'jpeg', quality: 85 })
  await page.close()
  return { report, render }
}

const baseline = await shoot('props=none', 'baseline-iso.jpg')
const ids = Object.keys(results).sort()
let next = 0
await Promise.all([0, 1].map(async () => {
  while (next < ids.length) {
    const id = ids[next++]
    const iso = await shoot(`props=${id}`, `${id}-iso.jpg`)
    const close = await shoot(`props=${id}&focus=1`, `${id}-close.jpg`)
    results[id].capture = {
      report: iso.report[id],
      drawCalls: iso.render.drawCalls - baseline.render.drawCalls,
      triangles: iso.render.triangles - baseline.render.triangles,
      closeReport: close.report[id],
    }
    console.log(id, JSON.stringify(results[id].capture))
  }
}))

// Floor: no generation, a parsed command places a copy of the existing chair.
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto(`${base}?talk=off&build=0&cam=iso&q=high&props=none`)
await page.waitForFunction(() => window.village && window.villageProps, null, { timeout: 30000 })
await page.evaluate(() => window.village.ready())
await page.waitForTimeout(1500)
const floor = []
for (const command of ['put a chair by the window', 'add another chair near the fridge', 'place a chair by the door', 'put a chair next to the table', 'put a sofa by the window'])
  floor.push({ command, ...(await page.evaluate((c) => window.villageProps.place(c), command)) })
await page.waitForTimeout(800)
await page.screenshot({ path: join(out, 'shots', 'floor-chairs-iso.jpg'), type: 'jpeg', quality: 85 })
await page.close()
console.log('floor', JSON.stringify(floor))

writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1))
writeFileSync(join(out, 'floor.json'), JSON.stringify({ baseline: baseline.render, floor }, null, 1))
await browser.close()
