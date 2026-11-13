// People (#218): the town's residents, by rule. Asked of the core alone: the rule says the same
// people in the same places whenever it is asked the same, and nobody it names stands in anything
// (a wall, a trunk, a lamp, a parked car) or on nothing. Asked of the real page in Chrome: they are
// drawn, the picture shows them, and what they cost this thread a frame is within their budget.
//
//   node test/people.mjs
import { readFileSync } from 'node:fs'
import { start, still } from './kit.mjs'
import { residents } from '../page/residents.ts'

/** What a frame may spend on working out and packing everyone in sight, ms on this thread (measured: 0.5 for 120 people). */
const BUDGET = 1.5
const { city, check, failures, finish } = await start()
try {
  const core = (await WebAssembly.instantiate(readFileSync(new URL('../page/core.wasm', import.meta.url)), {})).instance.exports
  const a = [], b = []
  const n = residents(core, [700, 4070], 1400, 86_400 * 3 + 0.25, 10.5, a), m = residents(core, [700, 4070], 1400, 86_400 * 3 + 0.25, 10.5, b)
  const key = (list, n) => list.slice(0, n).map((r) => `${r.seed}:${r.at.map((v) => v.toFixed(3))}:${r.yaw.toFixed(4)}`).join(' ')
  check(n > 40 && n === m && key(a, n) === key(b, m), `asked twice about one moment, the rule names the same ${n} people in the same places`)
  const night = residents(core, [700, 4070], 1400, 86_400 * 3 + 0.25, 3, b)
  check(night < n / 4 && night > 0, `fewer are out at three in the morning (${night}) than at half past ten (${n})`)
  // Homes round the start, towers to the east, a park, the town's far side: every resident at forty moments, and
  // the world's own cells from their feet to over their heads.
  let asked = 0, inside = 0, brushed = 0, floating = 0
  const where = []
  for (const eye of [[700, 4070], [3200, 4400], [-1900, 2500], [700, 6500], [5800, 4070]]) {
    for (let k = 0; k < 40; k++) {
      const count = residents(core, eye, 900, 1000 + k * 37.3, 12, a)
      for (const r of a.slice(0, count)) {
        asked++
        // Someone walking is on the street's own ground; someone standing on a lot's paving is at the height the lot was levelled to.
        const x = Math.round(r.at[0]), z = Math.round(r.at[2]), feet = r.stride === 0 && r.walking === 0 ? r.at[1] : core.feet_at(x, z)
        let hit = -1
        for (let y = feet; y < feet + 18 && hit < 0; y++) if (core.world_kind(x, y, z) !== 0) hit = y - feet
        // Under the shoulders it is a wall, a trunk, a post or a car. Over them it is a bough or the foot of a bay.
        if (hit >= 0 && hit < 15) { inside++; if (where.length < 6) where.push(`${x},${z}`) } else if (hit >= 15) brushed++
        if (core.world_kind(x, feet - 1, z) === 0 || Math.abs(r.at[1] - feet) > 1.01) floating++
      }
    }
  }
  check(asked > 2000 && inside === 0, `of ${asked} residents asked about over forty moments in five parts of town, none stands in anything (${inside}${where.length ? `: ${where.join(' ')}` : ''})`)
  check(brushed < asked / 200, `${brushed} of them (under one in two hundred) have a bough or the foot of a bay at the height of their head`)
  check(floating === 0, `and every one has ground under their feet (${floating} have not)`)

  // Where a block's own ground is paved (a towers' block, south of the start) people stand about on it: the rule
  // finds the places a few at a time, so it is asked until it has them.
  let plaza = 0
  for (let k = 0; k < 400; k++) plaza = residents(core, [640, 5270], 500, 5000, 12, a)
  const stood = a.slice(0, plaza).filter((r) => r.walking === 0 && r.stride === 0)
  const sound = stood.filter((r) => { let clear = (core.world_kind(r.at[0], r.at[1] - 1, r.at[2]) & 15) === 7; for (let y = r.at[1]; y < r.at[1] + 18 && clear; y++) clear = core.world_kind(r.at[0], y, r.at[2]) === 0; return clear && core.world_kind(r.at[0], r.at[1] - 1, r.at[2]) !== 0 })
  check(stood.length >= 6 && sound.length === stood.length, `on a towers' block's own paving ${stood.length} stand about, each on paving with nothing in them (${sound.length})`)
  // Something goes off beside one of them: that one is thrown down and stays where they were, others near shrink
  // from it, and three quarters of a minute on everyone is where they would have been had nothing happened.
  const t0 = 86_400 * 3 + 0.25, count = residents(core, [700, 4070], 1400, t0, 10.5, a)
  const one = a.slice(0, count).find((r) => r.walking === 1 && a.slice(0, count).some((o) => { const far = Math.hypot(o.at[0] - r.at[0], o.at[2] - r.at[2]); return far > 50 && far < 110 }))
  const bang = [{ at: [one.at[0] + 6, one.at[1] + 4, one.at[2]], radius: 10, t: t0 }], was = [...one.at]
  const after = (seconds) => { const list = []; const n = residents(core, [700, 4070], 1400, t0 + seconds, 10.5, list, bang); return list.slice(0, n) }
  const soon = after(0.25), hit = soon.find((r) => r.seed === one.seed), near = soon.filter((r) => r.flinch > 0.5).length
  const later = after(2.5).find((r) => r.seed === one.seed), up = after(9).find((r) => r.seed === one.seed)
  check(hit.down > 0.5 && later.down === 1 && Math.hypot(later.at[0] - was[0], later.at[2] - was[2]) < 0.01 && near > 0, `a blast beside someone throws them down where they were (down ${hit.down.toFixed(2)} after a quarter of a second, lying after two and a half), and ${near} near them shrink from it`)
  check(up.down === 0 && up.walking > 0, `nine seconds on they are up and walking (down ${up.down}, walking ${up.walking.toFixed(2)})`)
  const calm = residents(core, [700, 4070], 1400, t0 + 44, 10.5, b)
  check(key(after(44), calm) === key(b, calm), 'and three quarters of a minute on everyone is where they would have been')

  const page = await city('scale=0.5&fire=0')
  await still(page)
  await page.evaluate(() => {
    const e = globalThis.engine
    e.folkClock.now = () => 5000
    Object.assign(e.pose, { x: 60, y: e.ground(60, 404.5) + 7, z: 404.5, yaw: 70 * Math.PI / 180, pitch: -22 * Math.PI / 180 })
    e.hour = 10.5
  })
  await page.waitForTimeout(400)
  await still(page, { sun: true })
  await page.waitForTimeout(1500)
  const drawn = await page.evaluate(() => ({ ...globalThis.engine.folk.drawn }))
  check(drawn.people > 20, `the page draws the residents round it (${drawn.people} people, ${drawn.boxes} boxes)`)
  check(drawn.ms < BUDGET, `working them out costs this thread ${drawn.ms.toFixed(2)} ms a frame (the budget is ${BUDGET})`)
  // The same picture with them and without: they are in it.
  const differ = async () => {
    const shot = async () => (await page.screenshot()).toString('base64')
    const withThem = await shot()
    await page.evaluate(() => globalThis.engine.off.add('people'))
    await page.waitForTimeout(300)
    const without = await shot()
    await page.evaluate(() => globalThis.engine.off.delete('people'))
    return page.evaluate(async ([a, b]) => {
      const read = async (png) => { const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob()); const paper = new OffscreenCanvas(640, 360).getContext('2d'); paper.drawImage(bitmap, 0, 0, 640, 360); return paper.getImageData(0, 0, 640, 360).data }
      const [p, q] = [await read(a), await read(b)]
      let n = 0
      for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 60) n++
      return n
    }, [withThem, without])
  }
  const pixels = await differ()
  check(pixels > 150, `and they are in the picture: ${pixels} of 230,400 pixels are theirs`)
} catch (e) {
  failures.push(String(e.stack ?? e))
}
await finish('people')
