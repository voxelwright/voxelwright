// Headless proof of the notebook interaction (#36).
// Usage: node scripts/check-notebook.mjs [base-url] [--shot=path]   (dev server running)
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5181/'
const shot = args.find((a) => a.startsWith('--shot='))?.slice(7)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })

async function open(reducedMotion) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion })
  const page = await context.newPage()
  await page.goto(`${base}?talk=off&build=0`)
  await page.evaluate(() => localStorage.removeItem('village.notebook.lines'))
  await page.reload()
  const ready = await page.evaluate(() => window.village.ready())
  // Quality calibration may step the tier down and rebuild postfx; wait until it has settled.
  await page.waitForFunction(() => window.village.snapshot().tierSettled, null, { timeout: 30000 })
  await page.waitForTimeout(800)
  return { context, page, ready }
}
const cam = (page) => page.evaluate(() => {
  const { camera } = window.village.kernel.root.get('stage')
  return camera.position.toArray().map((v) => +v.toFixed(3))
})
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

// Keyboard path with motion: Tab, Enter, type, Enter, Escape.
{
  const { context, page, ready } = await open('no-preference')
  check('page ready with notebook active', ready.ok && ready.active.includes('notebook'), ready)
  const seat = await cam(page)
  // The notebook is one entry among several; Tab cycles them in screen order.
  const visited = []
  for (let i = 0; i < 6 && visited.at(-1) !== 'notebook'; i++) {
    await page.keyboard.press('Tab')
    visited.push(await page.evaluate(() => document.activeElement?.dataset?.entry))
  }
  const label = await page.evaluate(() => document.querySelector('.village-label.shown')?.textContent)
  check('Tab reaches the notebook entry and shows its label', visited.at(-1) === 'notebook' && label === 'Notebook', { visited, label })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  const midway = await cam(page)
  await page.waitForTimeout(1800)
  const framed = await cam(page)
  check('camera eases towards the page', dist(seat, midway) > 0.02 && dist(midway, framed) > 0.02 && dist(seat, framed) > 1, { seat, midway, framed })
  await page.keyboard.type('Pancakes on Saturday')
  await page.waitForTimeout(300)
  if (shot) await page.screenshot({ path: shot.replace('.png', '-typing.png') })
  await page.keyboard.press('Enter')
  await page.keyboard.type('Call grandma')
  await page.waitForTimeout(400)
  if (shot) await page.screenshot({ path: shot })
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('village.notebook.lines') ?? '[]'))
  check('Enter keeps the line in local storage', stored.length === 1 && stored[0] === 'Pancakes on Saturday', stored)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(2200)
  const back = await cam(page)
  check('Escape eases back to the seat', dist(back, seat) < 0.2, { back, seat })
  // Lines survive a reload and the uncommitted draft does not.
  await page.reload()
  await page.evaluate(() => window.village.ready())
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('village.notebook.lines') ?? '[]'))
  check('kept lines survive a reload', kept.length === 1, kept)
  await context.close()
}

// Pointer path with reduced motion: click the book, click outside.
{
  const { context, page } = await open('reduce')
  const seat = await cam(page)
  const at = await page.evaluate(() => {
    const { scene, camera } = window.village.kernel.root.get('stage')
    const p = scene.getObjectByName('notebook right page').getWorldPosition(camera.position.clone())
    p.project(camera)
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight }
  })
  await page.mouse.click(at.x + 40, at.y)
  await page.waitForTimeout(100)
  const framed = await cam(page)
  check('click on the book frames the page instantly with reduced motion', dist(seat, framed) > 1, { seat, framed })
  await page.mouse.click(40, 40)
  await page.waitForTimeout(100)
  const back = await cam(page)
  check('click outside goes back instantly with reduced motion', dist(back, seat) < 0.05, { back, seat })

  // Unload: DOM, listeners and page texture go away cleanly; reload works.
  const controls = '.village-offscreen, [data-entry="notebook"]'
  // The input, the villager's polite live region and the entry button.
  const domBefore = await page.evaluate((sel) => document.querySelectorAll(sel).length, controls)
  const before = await page.evaluate(() => window.village.snapshot())
  await page.evaluate(() => window.village.unload('notebook'))
  await page.waitForTimeout(300)
  const after = await page.evaluate((sel) => ({ s: window.village.snapshot(), dom: document.querySelectorAll(sel).length }), controls)
  check('unload removes the notebook controls and frame hook', after.dom === 0 && after.s.frameHooks === before.frameHooks - 1 && !after.s.plugins.registered.includes('notebook'), { dom: after.dom, hooks: [before.frameHooks, after.s.frameHooks] })
  await page.evaluate(() => window.village.load('notebook'))
  await page.waitForTimeout(400)
  const again = await page.evaluate((sel) => ({ s: window.village.snapshot(), dom: document.querySelectorAll(sel).length }), controls)
  check('reload restores it', again.dom === domBefore && domBefore === 3 && again.s.plugins.active.includes('notebook') && again.s.frameHooks === before.frameHooks, { dom: again.dom })

  // The table owns the book: after the table reloads, hover and click still reach the notebook.
  await page.evaluate(async () => {
    await window.village.unload('table')
    window.village.load('table')
  })
  await page.waitForTimeout(600)
  const spot = await page.evaluate(() => {
    const { scene, camera } = window.village.kernel.root.get('stage')
    const p = scene.getObjectByName('notebook right page').getWorldPosition(camera.position.clone())
    p.project(camera)
    return { x: ((p.x + 1) / 2) * innerWidth + 40, y: ((1 - p.y) / 2) * innerHeight }
  })
  await page.mouse.move(spot.x, spot.y)
  await page.waitForTimeout(200)
  const hovered = await page.evaluate(() => window.village.kernel.root.get('entries').hovered)
  await page.mouse.click(spot.x, spot.y)
  await page.waitForTimeout(150)
  const chosen = await page.evaluate(() => window.village.kernel.root.get('entries').active)
  check('after the table reloads, hover and click reach the notebook', hovered === 'notebook' && chosen === 'notebook', { hovered, chosen })
  await page.mouse.click(40, 40)
  await context.close()
}

// The villager is away: a kept line waits in the outbox and is sent once the host
// answers again; a line typed while it answers waits its turn. Each queued line
// carries the person and the public tag of the pairing it was written under (#85),
// never the session, which is an HttpOnly cookie the page cannot read.
const ALEX = 'a1'.repeat(8)
const SAM = 'b2'.repeat(8)
const queues = (page) => page.evaluate(() => ({
  outbox: JSON.parse(localStorage.getItem('village.notebook.outbox') ?? '[]'),
  held: JSON.parse(localStorage.getItem('village.notebook.held') ?? '[]'),
  state: document.querySelector('[data-villager]').dataset.villager,
  text: document.querySelector('[data-villager]').textContent,
}))
const writeLine = async (page, text) => {
  await page.focus('[data-entry="notebook"]')
  await page.keyboard.press('Enter')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}
/** This browser was paired as `person` before (the host confirmed it then); the page reloads knowing that. */
const pairedBefore = async (page, person, tag) => {
  await page.evaluate((p) => {
    ['village.notebook.outbox', 'village.notebook.held'].forEach((k) => localStorage.removeItem(k))
    localStorage.setItem('village.villager.paired', JSON.stringify(p))
  }, { person, tag })
  await page.reload()
  await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(800)
}
{
  const { context, page } = await open('reduce')
  await pairedBefore(page, 'alex', ALEX)
  await writeLine(page, 'Buy milk')
  await page.waitForTimeout(800)
  const waiting = await queues(page)
  check('with the host away the line waits in the outbox, tagged with its person and pairing tag', waiting.outbox.length === 1 && waiting.outbox[0].text === 'Buy milk' && waiting.outbox[0].person === 'alex' && waiting.outbox[0].tag === ALEX && waiting.state === 'away', waiting)
  // The host comes back (a stand-in on the page's routes); the first reply is slow.
  const sent = []
  await page.route('**/villager/api/people/alex/messages', async (r) => {
    sent.push({ text: JSON.parse(r.request().postData()).text, session: r.request().headers()['x-village-session'] })
    if (sent.length === 1) await new Promise((x) => setTimeout(x, 1500))
    await r.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: done\ndata: ${JSON.stringify({ reply: `heard ${sent.at(-1).text}` })}\n\n` })
  })
  await page.waitForTimeout(6000)
  await page.keyboard.type('And eggs')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(3000)
  const done = await queues(page)
  check('when the host is back the outbox is sent in order, under the pairing it was written under, and emptied', sent.map((x) => x.text).join() === 'Buy milk,And eggs' && sent.every((x) => x.session === ALEX) && done.outbox.length === 0 && done.text === 'heard And eggs', { sent, done })
  await context.close()
}

// A tagged line is never sent under another pairing (#42, #85): Alex queues a line while the host is away, then
// Sam's link is opened in the same tab. Every request the page makes is recorded.
{
  const { context, page } = await open('reduce')
  const requests = []
  let mode = 'away'
  let who = { person: 'alex', tag: ALEX }
  await page.route('**/villager/api/**', async (r) => {
    const body = r.request().postData()
    const path = new URL(r.request().url()).pathname
    requests.push({ path, session: r.request().headers()['x-village-session'], text: body ? JSON.parse(body).text : undefined })
    if (mode === 'away') return r.fulfill({ status: 502, body: 'away' })
    if (mode === 'unauth') return r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"this device is not paired"}' })
    if (path.endsWith('/pair')) {
      who = { person: 'sam', tag: SAM }
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'set-cookie': `village_session=${'c'.repeat(64)}; Path=/villager/api; HttpOnly; SameSite=Strict` }, body: JSON.stringify(who) })
    }
    if (path.endsWith('/session')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(who) })
    if (mode === 'forbidden') return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"this device is paired to another person"}' })
    if (!body) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"lines":[]}' })
    await r.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: done\ndata: ${JSON.stringify({ reply: 'heard' })}\n\n` })
  })
  await pairedBefore(page, 'alex', ALEX)
  await writeLine(page, 'For Alex only')
  await page.waitForTimeout(800)
  const queued = await queues(page)
  mode = 'ok'
  await page.evaluate((code) => (location.hash = `pair=${code}`), 'd'.repeat(64))
  await page.waitForTimeout(7000)
  const underSam = requests.filter((x) => x.text === 'For Alex only' && x.session !== ALEX)
  const after = await queues(page)
  const url = page.url()
  check("a line queued under Alex's pairing is never sent once the device is paired as Sam", queued.outbox[0]?.tag === ALEX && underSam.length === 0 && after.outbox.length === 0 && after.held.some((q) => q.text === 'For Alex only' && q.tag === ALEX) && !url.includes('pair='), { underSam, url, after: { outbox: after.outbox, held: after.held } })
  check('the page says the line was held, not sent', after.state === 'other' && /another pairing/.test(after.text), { state: after.state, text: after.text })
  // Reloaded, paired as Sam: still held, still unsent. An untagged line from before tagging is held too.
  await page.evaluate(() => localStorage.setItem('village.notebook.outbox', JSON.stringify(['an old untagged line'])))
  await page.reload()
  await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(7000)
  const reloaded = await queues(page)
  check("after a reload paired as Sam, held and untagged lines are still never sent", requests.filter((x) => x.text === 'For Alex only').every((x) => x.session === ALEX) && !requests.some((x) => x.text === 'an old untagged line') && reloaded.outbox.length === 0 && reloaded.held.some((q) => q.text === 'an old untagged line'), { requests: requests.filter((x) => x.text), reloaded: { outbox: reloaded.outbox, held: reloaded.held } })
  // 401: this device's pairing ended (a new link for this person, elsewhere). Its own state, not retried.
  mode = 'unauth'
  await writeLine(page, 'stale link line')
  await page.waitForTimeout(7000)
  const stale = await queues(page)
  const staleTries = requests.filter((x) => x.text === 'stale link line').length
  check('401 is its own state ("open your pairing link"), not away, and the line is kept without retrying', stale.state === 'link' && /Open your link/.test(stale.text) && stale.outbox.some((q) => q.text === 'stale link line') && staleTries === 1, { state: stale.state, text: stale.text, staleTries })
  // 403: paired to someone else. Said plainly, never "your line is kept; try me again".
  // Paired again by a new link, and the host (mocked here) refuses this device's lines with 403.
  mode = 'forbidden'
  await page.evaluate((code) => (location.hash = `pair=${code}`), 'e'.repeat(64))
  await page.waitForTimeout(500)
  await writeLine(page, 'refused line')
  await page.waitForTimeout(1500)
  const refused = await queues(page)
  check('403 is the refused state and never promises a retry', refused.state === 'refused' && /someone else/.test(refused.text) && !/try me again/.test(refused.text) && refused.outbox.length === 0 && refused.held.some((q) => q.text === 'refused line'), { state: refused.state, text: refused.text })
  await context.close()
}

await browser.close()
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
const failures = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failures}/${checks.length} checks passed`)
if (failures) process.exitCode = 1
