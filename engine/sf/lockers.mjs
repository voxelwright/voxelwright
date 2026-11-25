// Places the eggs' lockers (#450, page/eggs-lockers.ts): gives every egg that has no window one of the city's
// windows the landing's eye sees, and writes sf/lockers.json, which the page reads (as eggs/lockers.json).
//
//   node sf/lockers.mjs [--no-build] [--again] [--shots ~/.village/engine/sf/lockers]
//
// The windows are measured in the realm's first view as the page draws it (main.ts `lockerWindows`), in Chrome with
// WebGPU, on a desk at 4:3 (the narrowest a desk's picture is: wider ones see more of the same skyline) and on a phone
// held upright (its own framing, sf/realm.json `upright`). A window is a candidate where both see it whole (its bay one
// patch of pixels, not two walls that share a key), its glass big enough to be seen and pointed at, and clear of the
// keys in the corners. Eggs without a locker get one in turn, each the candidate farthest from those already taken on
// the desk's picture (a bigger pane a little preferred), one a building. A locker whose window is no longer a candidate
// (the far model was baked again) is placed anew; --again places them all anew.
//
// The eggs, in order: the landing's own that play in the first view (the Matrix, the Rickroll, Bad Apple!!, a barrel
// roll, +30 lives), then every meme of sf/memes.json. A locker may also say `find` (a thing of eggs-things.ts that
// unlocks it once used) and `hint` (where it is): written by hand, and kept.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from '../test/kit.mjs'
import { plain } from '../player/serve.mjs'
import { memes } from './add-egg.mjs'

const LIST = join(import.meta.dirname, 'lockers.json')
const shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'lockers'))
/** The landing's own eggs that show something in the first view (page/eggs.ts `act`), before the memes. */
export const OWN = ['matrix', 'rickroll', 'apple', 'roll', 'lives']
/** How a locker is written: one a line. */
const save = (list) => writeFileSync(LIST, '[\n' + list.map((l) => '  ' + JSON.stringify(l)).join(',\n') + '\n]\n')
export const lockers = () => (existsSync(LIST) ? JSON.parse(readFileSync(LIST, 'utf8')) : [])

/**
 * The two pictures measured: size (CSS px), whether by touch, the least glass a window must show (px), and the parts of
 * the picture kept clear (fractions of its width and height: the keys' corners, and a margin all round).
 */
const VIEWS = {
  desk: { size: [1200, 900], touch: false, glass: 12, margin: [0.05, 0.1, 0.05, 0.1], clear: [[0, 0.86, 0.3, 1], [0.86, 0, 1, 0.14]] },
  upright: { size: [390, 844], touch: true, glass: 3, margin: [0.06, 0.15, 0.06, 0.14], clear: [] },
}
/** Two lockers' windows are at least this far apart on the desk's picture (px), where there is room. */
const APART = 40

const name = (key) => key.join()
const usable = (w, v) => {
  const [W, H] = v.size, cx = (w.box[0] + w.box[2]) / 2 / W, cy = (w.box[1] + w.box[3]) / 2 / H
  const [l, t, r, b] = v.margin
  if (cx < l || cx > 1 - r || cy < t || cy > 1 - b) return false
  if (v.clear.some(([x0, y0, x1, y1]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1)) return false
  // One patch: a bay whose pixels lie in a box no more than twice as big as they are (two walls that share a key do not).
  const area = (w.box[2] - w.box[0] + 1) * (w.box[3] - w.box[1] + 1)
  return w.glass >= v.glass && area <= w.bay * 2
}

if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs')], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })
const site = await plain(join(here, 'dist-sf'), '127.0.0.1')
const back = await turn()
const browser = await chromium.launch(CHROME)
const seen = {}
for (const [which, v] of Object.entries(VIEWS)) {
  const context = await browser.newContext({ viewport: { width: v.size[0], height: v.size[1] }, deviceScaleFactor: v.touch ? 3 : 1, isMobile: v.touch, hasTouch: v.touch })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log(`  ${which}: ${e.message}`))
  await page.goto(`${site.url}/sf/index.html`)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.lockerWindows, null, { timeout: 240_000 })
  // Every band of the far model the view needs (the landing's cut draws the same skyline, and the same keys), and the
  // boards, whose boxes stay the cells' (a window placed before they came was under cells once they had).
  await page.waitForFunction(() => globalThis.engine.far.whole && globalThis.engine.eggs, null, { timeout: 120_000 }).catch(() => console.log(`  ${which}: the far model was not whole after 2 minutes; measured as it was`))
  await page.waitForTimeout(4000)
  // Measured twice, a few seconds apart: a window is kept only where both saw it.
  const once = await page.evaluate((size) => globalThis.engine.lockerWindows(size, 1), v.size)
  await page.waitForTimeout(3000)
  const again = new Set((await page.evaluate((size) => globalThis.engine.lockerWindows(size, 1), v.size)).map((w) => name(w.key)))
  const windows = once.filter((w) => again.has(name(w.key)))
  seen[which] = new Map(windows.filter((w) => usable(w, v)).map((w) => [name(w.key), w]))
  console.log(`${which}: ${once.length} windows seen, ${windows.length} both times, ${seen[which].size} usable`)
  await page.screenshot({ path: join(shots, `${which}.png`) })
  await context.close()
}
await browser.close()
back()
site.close?.()

// ── Candidates: seen whole by both, one locker a building ──
const candidates = [...seen.desk.values()].filter((w) => seen.upright.has(name(w.key)))
console.log(`${candidates.length} windows usable on both`)
const eggs = [...OWN, ...memes().map((m) => m.id)]
/** What each egg's locker said by hand (find, hint): kept whether its window is kept or placed anew. */
const written = new Map(lockers().map((l) => [l.egg, l]))
const was = has('again') ? [] : lockers()
const kept = was.filter((l) => eggs.includes(l.egg) && candidates.some((w) => name(w.key) === name(l.key)))
for (const l of was) if (!kept.includes(l) && eggs.includes(l.egg)) console.log(`  ${l.egg}: its window ${name(l.key)} is no longer seen whole; placed anew`)
const taken = kept.map((l) => seen.desk.get(name(l.key)))
const buildings = new Set(kept.map((l) => l.key[0]))
const middle = (w) => [(w.box[0] + w.box[2]) / 2, (w.box[1] + w.box[3]) / 2]
const out = [...kept]
for (const egg of eggs) {
  if (out.some((l) => l.egg === egg)) continue
  let best = null, score = -Infinity
  for (const w of candidates) {
    if (buildings.has(w.key[0])) continue
    const [x, y] = middle(w)
    const apart = taken.length ? Math.min(...taken.map((t) => Math.hypot(x - middle(t)[0], y - middle(t)[1]))) : 1000 - Math.hypot(x - VIEWS.desk.size[0] / 2, y - VIEWS.desk.size[1] / 2)
    const s = Math.min(apart, 400) * (1 + 0.15 * Math.log2(w.glass))
    if (s > score) { score = s; best = w }
  }
  if (!best) { console.log(`  no window left for ${egg}`); continue }
  if (taken.length && score / (1 + 0.15 * Math.log2(best.glass)) < APART) console.log(`  ${egg}: the nearest other locker is under ${APART} px off`)
  taken.push(best)
  buildings.add(best.key[0])
  out.push({ egg, key: best.key, at: best.at })
}
// What was written by hand of a locker (find, hint) stays, wherever its window is now.
const order = (l) => eggs.indexOf(l.egg)
out.sort((a, b) => order(a) - order(b))
save(out.map((l) => { const w = written.get(l.egg) ?? {}; return { egg: l.egg, key: l.key, at: l.at, ...(w.find ? { find: w.find } : {}), ...(w.hint ? { hint: w.hint } : {}) } }))
console.log(`${out.length} lockers in sf/lockers.json (${out.length - kept.length} placed now)`)
process.exit(0)
