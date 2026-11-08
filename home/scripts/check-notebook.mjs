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
  await page.goto(base)
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
// answers again; a line typed while it answers waits its turn.
{
  const { context, page } = await open('reduce')
  await page.evaluate(() => localStorage.removeItem('village.notebook.outbox'))
  await page.focus('[data-entry="notebook"]')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Buy milk')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  const waiting = await page.evaluate(() => ({ outbox: JSON.parse(localStorage.getItem('village.notebook.outbox') ?? '[]'), state: document.querySelector('[data-villager]').dataset.villager }))
  check('with the host away the line waits in the outbox', waiting.outbox.join() === 'Buy milk' && waiting.state === 'away', waiting)
  // The host comes back (a stand-in on the page's routes) and its link is opened in
  // the same tab, which changes only the fragment; the first reply is slow.
  const sent = []
  await page.evaluate(() => (location.hash = 'token=t'))
  await page.route('**/villager/api/people/alex/messages', async (r) => {
    sent.push(JSON.parse(r.request().postData()).text)
    if (sent.length === 1) await new Promise((x) => setTimeout(x, 1500))
    await r.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: done\ndata: ${JSON.stringify({ reply: `heard ${sent.at(-1)}` })}\n\n` })
  })
  await page.waitForTimeout(6000)
  await page.keyboard.type('And eggs')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(3000)
  const done = await page.evaluate(() => ({ outbox: JSON.parse(localStorage.getItem('village.notebook.outbox') ?? '[]'), text: document.querySelector('[data-villager]').textContent }))
  check('when the host is back the outbox is sent in order and emptied', sent.join() === 'Buy milk,And eggs' && done.outbox.length === 0 && done.text === 'heard And eggs', { sent, done })
  await context.close()
}

await browser.close()
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
const failures = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failures}/${checks.length} checks passed`)
if (failures) process.exitCode = 1
