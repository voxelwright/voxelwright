// The eggs' lockers in the San Francisco realm (#450, page/eggs-lockers.ts): the city's windows in the first view that
// hold an egg, in Chrome with WebGPU, from the static folder.
//
//   node test/sf-lockers.mjs [--no-build] [--shots ~/.village/engine/sf/lockers] [--headed]
//
// On a desk (1440 x 900), with some lockers seen before (kept in the browser) and two locked (sf/lockers.json as
// served, with a `find`): every locker is drawn where the page says it is, its window against the same picture with
// the lockers held off (how far its colour moved), by day and by night; a new one in a television's cool light, a seen
// one green, a locked one red. The pointer over a new one lights it up and says “???”; a click opens it (its egg plays), it is seen from then
// on, the words say what it was and the key in the corner counts it; after a reload it is still seen and says its name.
// A locked one says so and opens nothing until what finds it is found. The key's card shows every locker, and a new one
// chosen there is lit up where it is. Gone in, they are not shown. On a phone held upright a tap opens one, its words go
// after a while, and the key stands by the credits key, clear of the settings key; on its side the settings panel
// opened is clear of the key. The far model's GPU time with the lockers shown, beside held off.
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'lockers'))
const round = (n, to = 1) => Math.round(n * 10 ** to) / 10 ** to
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs')], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })
const LIST = JSON.parse(readFileSync(join(here, 'sf', 'lockers.json'), 'utf8'))
if (LIST.length < 2) { console.error('sf/lockers.json has no lockers: node sf/lockers.mjs'); process.exit(1) }
// Locked for the check: the third and the fourth, by the payphone and the jukebox.
const LOCKS = { 2: 'payphone', 3: 'jukebox' }
const served = LIST.map((l, i) => (LOCKS[i] ? { ...l, find: LOCKS[i], hint: 'by a ringing payphone' } : l))
// Seen before: the fifth and the sixth.
const SEEN = [LIST[4]?.egg, LIST[5]?.egg].filter(Boolean)
const site = await plain(join(here, 'dist-sf'), '127.0.0.1')
const back = await turn()
const browser = await chromium.launch(CHROME)

/** A page of the realm's first view, the lockers come, with this visitor's past (`seen`) kept in its browser. */
const open = async (context, { seen = SEEN, fresh = true } = {}) => {
  const page = await context.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) page.errors.push(m.text()) })
  await page.route('**/eggs/lockers.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(served) }))
  if (fresh) await page.addInitScript((seen) => { if (!sessionStorage.getItem('kept')) { localStorage.setItem('village.sf.lockers', JSON.stringify({ seen, found: [] })); sessionStorage.setItem('kept', '1') } }, seen)
  await page.goto(`${site.url}/sf/index.html`)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.eggs?.lockers?.state.lockers.length > 0, null, { timeout: 240_000 })
  await page.waitForFunction(() => globalThis.engine.far.whole, null, { timeout: 120_000 }).catch(() => {})
  await page.waitForFunction(() => globalThis.engine.eggs.lockers.state.shown === 1, null, { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(1500)
  return page
}
const lockers = (page) => page.evaluate(() => globalThis.engine.eggs.lockers.state)
/** The mean colour (0 to 255) round each point (client px) in a screenshot of the page: `r` px each way. */
const around = async (page, points, name) => {
  const png = await page.screenshot(name ? { path: join(shots, `${name}.png`) } : {})
  return page.evaluate(async ({ url, points }) => {
    const img = new Image(); img.src = url; await img.decode()
    const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0)
    const k = img.width / innerWidth
    return points.map((p) => {
      if (!p) return null
      const r = Math.min(4, Math.max(1, p.tall * 0.18)), x0 = Math.max(0, Math.round((p.x - r) * k)), y0 = Math.max(0, Math.round((p.y - r) * k)), w = Math.max(1, Math.round(2 * r * k))
      const d = x.getImageData(x0, y0, w, w).data, s = [0, 0, 0]
      for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2] }
      return s.map((v) => v / (d.length / 4))
    })
  }, { url: `data:image/png;base64,${png.toString('base64')}`, points })
}
const light = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
/** How far a colour moved (0 to 255 a channel): a pane given its own colour may be no lighter than the pale wall it is in, but it shows. */
const moved = (c) => Math.hypot(...c)
/** Each locker's light with the lockers shown, less with them held off; and the colour that adds. */
const drawn = async (page, name) => {
  const s = await lockers(page), points = s.lockers.map((l) => l.on)
  await page.evaluate(() => globalThis.engine.eggs.lockers.force(0)); await page.waitForTimeout(400)
  const off = await around(page, points, `${name}-off`)
  await page.evaluate(() => globalThis.engine.eggs.lockers.force(null)); await page.waitForTimeout(800)
  const on = await around(page, points, name)
  return s.lockers.map((l, i) => ({ ...l, i, add: on[i] && off[i] ? on[i].map((v, c) => v - off[i][c]) : null }))
}
/** What the far model costs the GPU a frame with the lockers shown at `shown` (main.ts farPasses: ms, the middle of five). */
const farCost = async (page, shown) => {
  await page.evaluate((v) => globalThis.engine.eggs.lockers.force(v), shown); await page.waitForTimeout(400)
  const p = await page.evaluate(() => globalThis.engine.farPasses(5))
  return round(p.withFar - p.march, 2)
}

// ── A desk ──
console.log('a desk, 1440 x 900')
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  let page = await open(context)
  let s = await lockers(page)
  check(s.lockers.length === LIST.length && s.count === `${SEEN.length}/${LIST.length}`, `${s.lockers.length} lockers of sf/lockers.json come; the key says ${s.count} (${SEEN.length} seen before)`)
  check(s.lockers.filter((l) => l.state === 'locked').length === 2 && SEEN.every((egg) => s.lockers.find((l) => l.egg === egg)?.state === 'seen'), `states: ${['new', 'seen', 'locked'].map((k) => `${s.lockers.filter((l) => l.state === k).length} ${k}`).join(', ')}`)
  const inside = s.lockers.filter((l) => l.on && l.on.x > 0 && l.on.x < 1440 && l.on.y > 0 && l.on.y < 900)
  check(inside.length === s.lockers.length, `every locker's window is in the picture (${inside.length} of ${s.lockers.length})`)
  // Drawn by the far model here: each locker's window among the windows its faces draw at this size (main.ts lockerWindows).
  const drawnKeys = new Set((await page.evaluate(() => globalThis.engine.lockerWindows([1440, 900], 1))).map((w) => w.key.join()))
  const missing = LIST.filter((l) => !drawnKeys.has(l.key.join()))
  check(!missing.length, `every locker's window is drawn by the far model at 1440 x 900 (missing: ${missing.map((l) => l.egg).join(', ') || 'none'})`)

  // Drawn, by day, each in its own light.
  for (const [hour, when] of [[null, 'day'], [21.5, 'night']]) {
    if (hour !== null) { await page.evaluate((h) => { globalThis.engine.hour = h }, hour); await page.waitForTimeout(5000) }
    const d = await drawn(page, `desk-${when}`)
    const lit = d.filter((l) => l.add && moved(l.add) > 30), faint = d.filter((l) => !lit.includes(l)).map((l) => `${l.egg} ${l.add ? round(moved(l.add)) : '-'}`)
    check(lit.length >= d.length * 0.9, `${when}: ${lit.length} of ${d.length} lockers' windows show against the picture without them (colour moved: median ${round(d.map((l) => (l.add ? moved(l.add) : 0)).sort((a, b) => a - b)[Math.floor(d.length / 2)])}; faint: ${faint.join(', ') || 'none'})`)
    const mean = (k) => { const ls = d.filter((l) => l.state === k && l.add); return ls.length ? [0, 1, 2].map((c) => round(ls.reduce((s, l) => s + l.add[c], 0) / ls.length)) : null }
    const [n, g, r] = ['new', 'seen', 'locked'].map(mean)
    check(n && n[2] >= n[0], `${when}: a new one adds a cool light (rgb ${n})`)
    check(g && g[1] > g[0] && g[1] > g[2], `${when}: a seen one adds green (rgb ${g})`)
    check(r && r[0] > r[1] && r[0] > r[2], `${when}: a locked one adds red (rgb ${r})`)
  }
  await page.evaluate(() => { globalThis.engine.hour = 13.45 }); await page.waitForTimeout(4000)

  // The cost: the far model's GPU time a frame with them shown, and held off (the frame gaps of a GPU other checks share say little).
  const costs = { shown: await farCost(page, 1), off: await farCost(page, 0) }
  await page.evaluate(() => globalThis.engine.eggs.lockers.force(null))
  console.log(`  the far model's GPU time a frame: ${costs.shown} ms with the lockers shown, ${costs.off} ms held off`)

  // The pointer over a new one, and a click on it.
  s = await lockers(page)
  const pick = s.lockers.findIndex((l) => l.state === 'new' && !['matrix', 'roll', 'lives'].includes(l.egg))
  const it = s.lockers[pick]
  const [before] = await around(page, [it.on])
  await page.mouse.move(it.on.x, it.on.y, { steps: 4 })
  await page.waitForTimeout(500)
  s = await lockers(page)
  const [over] = await around(page, [it.on], 'desk-hover')
  const cursor = await page.evaluate(() => document.querySelector('canvas').style.cursor)
  check(s.hot === pick && s.words === '??? · What’s on in there? Click to find out.' && cursor === 'pointer', `over a new one (${it.egg}): "${s.words}", the cursor ${cursor}`)
  check(light(over) > light(before) + 20, `its window lights up under the pointer (${round(light(before))} to ${round(light(over))})`)
  await page.mouse.click(it.on.x, it.on.y)
  const playing = await page.waitForFunction((egg) => globalThis.engine.eggs.state.running === egg, it.egg, { timeout: 30_000 }).then(() => true, () => false)
  s = await lockers(page)
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('village.sf.lockers')))
  check(playing, `a click opens it: ${it.egg} plays`)
  check(s.lockers[pick].state === 'seen' && /^.+ · Found! \d+ of \d+ opened\.$/.test(s.words ?? '') && s.count === `${SEEN.length + 1}/${LIST.length}` && kept.seen.includes(it.egg), `it is seen: "${s.words}", the key says ${s.count}, kept ${kept.seen.length}`)
  await page.screenshot({ path: join(shots, 'desk-found.png') })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !globalThis.engine.eggs.state.running && globalThis.engine.eggs.state.up === 0, null, { timeout: 20_000 }).catch(() => {})

  // A locked one: says so, opens nothing; found, it is new.
  const locked = s.lockers.findIndex((l) => l.state === 'locked')
  await page.mouse.move(s.lockers[locked].on.x, s.lockers[locked].on.y, { steps: 4 }); await page.waitForTimeout(400)
  s = await lockers(page)
  check(s.words === 'Locked · Find it in the city: by a ringing payphone', `over a locked one: "${s.words}"`)
  await page.mouse.click(s.lockers[locked].on.x, s.lockers[locked].on.y); await page.waitForTimeout(800)
  check(!(await page.evaluate(() => globalThis.engine.eggs.state.running)), 'a click on it opens nothing')
  await page.evaluate(() => globalThis.engine.eggs.lockers.found('payphone'))
  s = await lockers(page)
  check(s.lockers[locked].state === 'new', `the payphone used, it is new (${s.lockers[locked].state})`)

  // The key's card: every locker; a new one chosen there is lit up where it is.
  await page.mouse.move(700, 880)
  await page.click('.egg-count')
  await page.waitForTimeout(400)
  const card = await page.evaluate(() => ({ open: document.querySelector('#egg-windows')?.matches(':popover-open'), cells: document.querySelectorAll('#egg-windows .egg-windows button').length, told: document.querySelector('#egg-windows .told')?.textContent }))
  await page.screenshot({ path: join(shots, 'desk-card.png') })
  check(card.open && card.cells === LIST.length, `the key opens the card: ${card.cells} windows, "${card.told}"`)
  const unseen = s.lockers.findIndex((l) => l.state === 'new')
  await page.click(`#egg-windows button[data-slot="${unseen}"]`)
  await page.waitForTimeout(500)
  s = await lockers(page)
  check(s.lit === unseen && s.words?.startsWith('???'), `a new one chosen there is lit up where it is: "${s.words}"`)
  await page.screenshot({ path: join(shots, 'desk-shown.png') })

  // Kept: after a reload it is still seen, and says its name.
  await page.close()
  page = await open(context, { fresh: false })
  s = await lockers(page)
  await page.mouse.move(s.lockers[pick].on.x, s.lockers[pick].on.y, { steps: 4 }); await page.waitForTimeout(400)
  s = await lockers(page)
  check(s.lockers[pick].state === 'seen' && s.words?.endsWith('· Click to play it again.') && !s.words.startsWith('???'), `after a reload it is seen: "${s.words}"`)

  // Gone in: not shown.
  await page.evaluate(() => globalThis.engine.first.engage())
  await page.evaluate(() => { Object.assign(globalThis.engine.pose, { x: globalThis.engine.pose.x + 3 }) })
  await page.waitForTimeout(1200)
  s = await lockers(page)
  check(s.shown === 0 && s.count === null && s.words === null, `gone in, the lockers are not shown (shown ${s.shown}, the key ${s.count ?? 'hidden'})`)
  check(!page.errors.length, `no errors (${page.errors.slice(0, 3).join(' | ')})`)
  await context.close()
}

// ── A phone held upright ──
console.log('a phone held upright, 390 x 844')
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await open(context)
  let s = await lockers(page)
  const inside = s.lockers.filter((l) => l.on && l.on.x > 0 && l.on.x < 390 && l.on.y > 0 && l.on.y < 844)
  check(inside.length === s.lockers.length, `every locker's window is in the picture (${inside.length} of ${s.lockers.length})`)
  const d = await drawn(page, 'phone')
  const lit = d.filter((l) => l.add && moved(l.add) > 30)
  check(lit.length >= d.length * 0.9, `${lit.length} of ${d.length} lockers' windows show against the picture without them`)
  const keys = await page.evaluate(() => { const r = (q) => document.querySelector(q)?.getBoundingClientRect(); const c = r('.egg-count'), g = r('#realm .fold'), k = r('#first .credits'); return { c: c && [c.left, c.top, c.right, c.bottom], g: g && [g.left, g.top, g.right, g.bottom], k: k && [k.left, k.top, k.right, k.bottom] } })
  const apart = (a, b) => !a || !b || a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]
  check(keys.c && apart(keys.c, keys.g) && apart(keys.c, keys.k) && Math.abs(keys.c[1] - keys.k[1]) < 12, `the key stands beside the credits key, clear of the settings key (${JSON.stringify(keys)})`)
  const pick = s.lockers.findIndex((l) => l.state === 'new' && !['matrix', 'roll', 'lives'].includes(l.egg))
  await page.touchscreen.tap(s.lockers[pick].on.x, s.lockers[pick].on.y)
  const playing = await page.waitForFunction((egg) => globalThis.engine.eggs.state.running === egg, s.lockers[pick].egg, { timeout: 30_000 }).then(() => true, () => false)
  s = await lockers(page)
  await page.screenshot({ path: join(shots, 'phone-found.png') })
  check(playing && s.lockers[pick].state === 'seen' && s.words?.includes('Found!'), `a tap opens one (${s.lockers[pick].egg}): "${s.words}"`)
  // A tap is not a pointer left over the window: its words go, and the window is the screen's again.
  await page.waitForTimeout(4500)
  s = await lockers(page)
  check(s.words === null && s.lit === null, `the tap's words go after a while (words ${s.words}, lit ${s.lit})`)
  check(!page.errors.length, `no errors (${page.errors.slice(0, 3).join(' | ')})`)
  await context.close()
}

// ── A phone on its side ──
console.log('a phone on its side, 844 x 390')
{
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await open(context)
  const s = await lockers(page)
  const inside = s.lockers.filter((l) => l.on && l.on.x > 0 && l.on.x < 844 && l.on.y > 0 && l.on.y < 390)
  check(inside.length === s.lockers.length, `every locker's window is in the picture (${inside.length} of ${s.lockers.length})`)
  // The settings panel opened from its key: clear of the count key, which stands under the credits key.
  const fold = await page.evaluate(() => { const r = document.querySelector('#realm .fold')?.getBoundingClientRect(); return r && [r.left + r.width / 2, r.top + r.height / 2] })
  if (fold) await page.touchscreen.tap(fold[0], fold[1])
  await page.waitForTimeout(700)
  const keys = await page.evaluate(() => { const r = (q) => { const b = document.querySelector(q)?.getBoundingClientRect(); return b && b.width ? [b.left, b.top, b.right, b.bottom] : null }; return { c: r('.egg-count'), k: r('#first .credits'), sky: r('#realm .sky') } })
  await page.screenshot({ path: join(shots, 'side-panel.png') })
  const apart = (a, b) => !a || !b || a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]
  check(keys.c && keys.sky && apart(keys.c, keys.sky) && apart(keys.c, keys.k), `the settings panel opened lies clear of the count key (${JSON.stringify(keys)})`)
  check(!page.errors.length, `no errors (${page.errors.slice(0, 3).join(' | ')})`)
  await context.close()
}

await browser.close()
back()
site.close?.()
console.log(failures.length ? `\n${failures.length} failed` : '\nall ok')
process.exit(failures.length ? 1 : 0)
