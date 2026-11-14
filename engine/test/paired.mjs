// A paired, turn-about timing (#367): what a change costs the march, said so that another thread drawing on this
// machine's one GPU cannot make it up. Two ways of the page, A and B, are both up and both resting (`engine.resting`);
// at each of the bench's five places they are measured in turn (A B, B A, ...) seconds apart, with everything on, at
// the full 2560 x 1440 and the device's own pace (`engine.paced`). Beside each measure the fixed work that is none of
// the engine's (`engine.quiet`) says whether the GPU was busy: a pair counts only when it was quiet beside both, and
// pairs are tried until enough count. What is said is the middle pair's B over A, and how far the pairs lie apart,
// which is how much to believe it.
//
//   node test/paired.mjs --b 'bricks=1'                      the same code, B with a query of its own
//   node test/paired.mjs --a 'people=0' --b 'people=1' --people   ... with whoever is in view drawn as well as the march
//   node test/paired.mjs --other ../../main/engine           B is this checkout, A is another checkout's page (say one at origin/main): for a change to the code
//   node test/paired.mjs                                     A against A: how far apart two measures of the same thing lie just now
//   --rounds 5 (pairs kept at each place)   --do 'js run in the page once it is up, before measuring (to put a thing in view, say)'
//
// Both of this machine's turns on the GPU are held while it runs (a few minutes): other threads' checks wait.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, quiet, still } from './kit.mjs'
import { from } from './rows.mjs'

const PLACES = [['street', 0, 1.8, 0, 90, -2], ['fronts', 0, 1.8, 0, 60, 5], ['roofs', 0, 12, 0, 20, -8], ['high', 0, 130, 0, 30, -22], ['far', 0, 730, 0, 200, -30]]
const rounds = Number(arg('rounds', 5)), act = arg('do', ''), people = has('people')
const serveFrom = async (dir) => {
  const server = spawn('node', ['serve.mjs', '--port', '0', '--reports', '/dev/null'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
  const port = await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => { const m = /engine page on http:\/\/127\.0\.0\.1:(\d+)/.exec(String(chunk)); if (m) resolve(Number(m[1])) })
    server.on('exit', (code) => reject(new Error(`the server in ${dir} ended (${code})`)))
  })
  return { url: `http://127.0.0.1:${port}`, stop: () => server.kill() }
}
const done = await quiet(), both = () => {}
const mine = await serveFrom(here), other = arg('other', '') ? await serveFrom(arg('other', '')) : null
const browser = await chromium.launch(CHROME)
const ways = { A: { url: (other ?? mine).url, query: arg('a', '') }, B: { url: mine.url, query: arg('b', '') } }
/** One way of the page, brought up and left resting: it draws only while it is being measured. */
const open = async ({ url, query }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(`${url}/city?fly=0&scale=1&${query}`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await still(page)
  if (act) await page.evaluate(act)
  for (const [, ...at] of PLACES) { await from(page, ...at); await page.waitForTimeout(300); await still(page, { sun: true }) }
  await page.evaluate(() => { globalThis.engine.resting = true })
  return page
}
const pages = { A: await open(ways.A), B: await open(ways.B) }
/** One measure: the fixed work, the march three times (the middle kept), the fixed work again. */
const measure = (page) => page.evaluate(async (people) => {
  const e = globalThis.engine, quiet = [await e.quiet()], three = []
  for (let i = 0; i < 3; i++) three.push(await e.paced(3, people, false, people, people))
  quiet.push(await e.quiet())
  e.resting = true
  return { ms: three.sort((a, b) => a - b)[1], quiet: Math.max(...quiet) }
}, people)
// What quiet is: the fixed work as it was when the bench's baseline was kept on this machine, or its least over a few looks if that is less (or there is no baseline).
const machine = await pages.A.evaluate(() => `${globalThis.engine.gpu.adapter?.info?.description || globalThis.engine.gpu.adapter?.info?.vendor || 'gpu'} ${document.querySelector('canvas').width}x${document.querySelector('canvas').height}`)
let least = JSON.parse(readFileSync(`${here}test/baseline.json`, 'utf8'))[machine]?.quiet ?? Infinity
for (let i = 0; i < 6; i++) { least = Math.min(least, await pages.A.evaluate(async () => { const e = globalThis.engine, q = await e.quiet(); e.resting = true; return q })); await pages.A.waitForTimeout(250) }
console.log(`the fixed work takes ${least.toFixed(2)} ms at its least; a pair counts when it took under ${(least * 1.3).toFixed(2)} ms beside both measures`)
console.log('place     A ms    B ms   B over A   pairs lie between     pairs kept of tried')
let any = false
for (const [name, ...at] of PLACES) {
  for (const page of Object.values(pages)) { await from(page, ...at); await page.evaluate(() => { globalThis.engine.resting = false }); await page.waitForTimeout(400); await still(page, { sun: true }); await page.evaluate(() => { globalThis.engine.resting = true }) }
  const pairs = []
  let tried = 0
  // Turn about: A first in one pair, B first in the next, so that neither is always the one measured second.
  for (; pairs.length < rounds && tried < rounds * 5; tried++) {
    const order = tried % 2 ? ['B', 'A'] : ['A', 'B'], got = {}
    for (const way of order) got[way] = await measure(pages[way])
    least = Math.min(least, got.A.quiet, got.B.quiet)
    if (got.A.quiet < least * 1.3 && got.B.quiet < least * 1.3) pairs.push(got)
  }
  if (!pairs.length) { console.log(`${name.padEnd(8)} the GPU was never quiet in ${tried} pairs: nothing is said`); continue }
  any = true
  const mid = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1], ratios = pairs.map((g) => g.B.ms / g.A.ms).sort((a, b) => a - b)
  console.log(`${name.padEnd(8)} ${mid(pairs.map((g) => g.A.ms)).toFixed(2).padStart(6)}  ${mid(pairs.map((g) => g.B.ms)).toFixed(2).padStart(6)}   ${((mid(ratios) - 1) * 100).toFixed(1).padStart(6)}%   ${((ratios[0] - 1) * 100).toFixed(1)}% and ${((ratios.at(-1) - 1) * 100).toFixed(1)}%   ${pairs.length} of ${tried}`)
}
await browser.close(); mine.stop(); other?.stop(); done(); both()
process.exit(any ? 0 : 3)
