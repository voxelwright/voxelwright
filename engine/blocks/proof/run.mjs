// Drives the proof (blocks/proof) in the installed Chrome and in Playwright's WebKit, one route a visit, and keeps
// what each said and a picture of it.
//
//   node blocks/proof/run.mjs [--only chrome,webkit] [--routes gl,own] [--frames 120]
//     [--shots] [--dark] [--rest] [--motion] [--lose] [--fail] [--headed] [--port 5990] [--out ~/.village/engine/blocks/proof]
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { arg, browsers, has, quiet } from '../../test/kit.mjs'

const port = arg('port', '5990'), only = arg('only', 'chrome').split(','), routes = arg('routes', 'gl,own').split(',')
const dir = arg('out', join(homedir(), '.village', 'engine', 'blocks', 'proof'))
mkdirSync(dir, { recursive: true })
// Its timings are quoted: no other thread's check may draw beside it (test/kit.mjs).
const back = await quiet()
for (const name of only) {
  const browser = await browsers[name]()
  for (const route of routes) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }), page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 300)) })
    await page.goto(`http://127.0.0.1:${port}/blocks/proof/?run=${route}${has('shots') ? '&shots' : ''}${has('dark') ? '&dark' : ''}${has('rest') ? '&rest&brief' : ''}${has('lose') ? '&lose&brief' : ''}${has('fail') ? '&fail&brief' : ''}${has('motion') ? '&motion&brief' : ''}&frames=${arg('frames', '120')}`)
    let said = null
    try {
      await page.waitForFunction(() => document.documentElement.dataset.done, null, { timeout: 120000 })
      said = JSON.parse(await page.locator('#said').textContent())
    } catch (e) { said = { failed: String(e).split('\n')[0] } }
    const tag = `${name}-${route}${has('dark') ? '-dark' : ''}${has('shots') ? '-open' : ''}`
    await page.screenshot({ path: join(dir, `${tag}.png`) })
    writeFileSync(join(dir, `${tag}.json`), JSON.stringify({ ...said, errors }, null, 1))
    const p = said.paced, t = said.together
    const g = (w) => w ? `${w.gapMs.middle}/${w.gapMs.p95}/${w.gapMs.worst} late ${w.late}/${w.frames} thread ${w.pageThreadMs.middle}` : '-'
    console.log(`${name} ${route}: ${said.failed ?? said.none ?? `first part ${said.cold?.firstPartAt} ms | gaps middle/p95/worst: idle ${g(said.idle)} | one ${g(said.one)} | all ${g(said.together)} | dialog ${g(said.dialog)} | paced all ${p?.all.each} (thread ${p?.all.pageThread}) button ${p?.button.each} (${p?.button.pageThread}) dialog ${p?.dialog?.each} (${p?.dialog?.pageThread}) | button differs ${said.picture?.button.differBy3OrMore} worst ${said.picture?.button.worst} | scrolled back ${said.scrolledBack?.filled}`}${errors.length ? `\n  errors: ${errors.slice(0, 4).join(' | ')}` : ''}`)
    // At rest: the page scrolls itself away and back and draws nothing; then another tab is looked at and this one
    // come back to. The picture must be the one from before.
    if (has('rest') && said.cold) {
      const before = await page.screenshot()
      await page.waitForFunction(() => document.documentElement.dataset.rested, null, { timeout: 30000 })
      const drawn = await page.evaluate(() => document.documentElement.dataset.rested), scrolled = await page.screenshot()
      const other = await context.newPage()
      await other.goto('about:blank'); await other.bringToFront(); await other.waitForTimeout(2500)
      const hidden = await page.evaluate(() => document.hidden)
      await page.bringToFront(); await other.close(); await page.waitForTimeout(800)
      const back = await page.screenshot()
      console.log(`  at rest: drawn again ${drawn}; after scrolling away and back the picture is ${before.equals(scrolled) ? 'the same' : 'DIFFERENT'}; after another tab (hidden: ${hidden}) it is ${before.equals(back) ? 'the same' : 'DIFFERENT'}`)
      if (!before.equals(back) || !before.equals(scrolled)) { writeFileSync(join(dir, `${tag}-rest-before.png`), before); writeFileSync(join(dir, `${tag}-rest-scrolled.png`), scrolled); writeFileSync(join(dir, `${tag}-rest-back.png`), back) }
    }
    if (said.failed_for_good) console.log(`  lost for good: ${JSON.stringify(said.failed_for_good)}`)
    if (said.lost) console.log(`  lost and found: ${JSON.stringify(said.lost)}`)
    if (said.motion) for (const [k, v] of Object.entries(said.motion)) console.log(`  ${k}: ${v.pixelsOff} pixels off, worst ${v.worst}${v.where.length ? ` e.g. ${JSON.stringify(v.where[0])}` : ''}`)
    if (said.picture && has('motion')) for (const [k, v] of Object.entries(said.picture)) console.log(`  ${k} at rest: ${v.pixelsOff} of ${v.px[0] * v.px[1]} pixels off, worst ${v.worst}${v.where.length ? ` e.g. ${JSON.stringify(v.where.slice(0, 2))}` : ''}`)
    await context.close()
  }
  await browser.close()
}
back()
