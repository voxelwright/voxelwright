// A line-up (#371): the same few people in the same poses, place and light, near and far, as pictures. It is how a
// change to the figure is judged: run on the commit before and on the commit after, the pictures are a pair. Nothing
// is checked; looking is the check.
//
//   node test/lineup.mjs --out directory [--only stand,run] [--eyes near,row] [--hour 10.5]
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { arg, chrome, serve, still } from './kit.mjs'
import { NAMED } from '../page/moves.ts'

const out = arg('out', '')
if (!out) throw new Error('say where the pictures go: --out directory')
mkdirSync(out, { recursive: true })
const only = arg('only', '').split(',').filter(Boolean)
const hour = Number(arg('hour', '10.5'))
const eyes = arg('eyes', '').split(',').filter(Boolean)
/** Other people for the line, by their numbers, in place of the usual six: to look at more of the town. */
const seeds = arg('seeds', '').split(',').filter(Boolean).map(Number)

/** Who stands in the line: three by their own numbers, and three a rule dressed. */
let WHO = [
  { seed: 11 }, { seed: 4242 }, { seed: 90210 },
  { seed: 7, look: { coat: '#1c1d22', hair: '#17130f', wear: ['suit', 'tie #7a1c1c', 'glasses', 'short-hair'] } },
  { seed: 8, look: { coat: '#5a4632', legs: '#22242a', wear: ['coat', 'hat', 'scarf #a03a2e', 'gloves'], carry: 'case' } },
  { seed: 9, look: { coat: '#2a3a5c', wear: ['plain', 'vest', 'cap #1f2a3d'], carry: 'torch' } },
]
if (seeds.length) WHO.splice(0, WHO.length, ...seeds.map((seed) => ({ seed })))
/** What they are doing in each picture: what a Person is given besides who and where. */
const POSES = {
  stand: { time: 3 },
  walk: { walking: 1, stride: 0.2 },
  walk2: { walking: 1, stride: 0.45 },
  run: { walking: 1, running: 1, stride: 0.2 },
  sit: { move: { move: NAMED.sit, t: 5 } },
  wave: { move: { move: NAMED.wave, t: 0.28 } },
  strike: { move: { move: NAMED.strike, t: 0.23 } },
  hit: { move: { move: NAMED.hit, t: 0.1 } },
  // Struck from in front (they face south, the blow goes north) and from their left.
  reel: { struck: { t: 0.16, way: [0, 0, -1] } },
  reel2: { struck: { t: 0.16, way: [-1, 0, 0] } },
  down: { down: 1 },
  // On the way down, and up again.
  down1: { down: 0.25 }, down2: { down: 0.5 }, down3: { down: 0.75 },
  read: { reading: 1, time: 3 },
  rain: { umbrella: true, walking: 1, stride: 0.2 },
}
/** Where the eye is for each picture: how far in front of the middle of the line (metres), how high, how far round to the side (radians), and how narrow the look is. */
const EYES = { face: { off: 1.0, high: 1.62, round: 0.3, of: 1.5 }, near: { off: 2.2, high: 1.5, round: 0.35, of: 1 }, dressed: { off: 2.2, high: 1.5, round: -0.35, of: 4 }, row: { off: 5.5, high: 1.5, round: 0, of: null }, side: { off: 2.8, high: 1.5, round: 1.3, of: 5 }, far: { off: 50, high: 3, round: 0.3, of: null } }

const server = await serve('/dev/null')
const browser = await chrome()
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })).newPage()
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  page ${m.type()}: ${m.text().slice(0, 900)}`) })
  await page.goto(`${server.url}/city?fly=0&fire=0&scale=1&hour=${hour}&people=0`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await page.addStyleTag({ content: 'body > *:not(canvas) { visibility: hidden !important }' })
  const place = (eye) => page.evaluate(({ eye, n }) => {
    const e = globalThis.engine, mid = [68.4, 401.0], of = eye.of === null ? (n - 1) / 2 : eye.of
    // The line runs east along the pavement, facing south; the eye is south of it, round to the east by `round`.
    const cx = mid[0] + (of - (n - 1) / 2) * 1.2, x = cx + Math.sin(eye.round) * eye.off, z = mid[1] + Math.cos(eye.round) * eye.off
    Object.assign(e.pose, { x, y: e.ground(cx, mid[1]) + eye.high, z, yaw: -eye.round, pitch: eye.off < 1.5 ? 0 : eye.off < 3 ? -0.08 : -0.04 })
  }, { eye, n: WHO.length })
  const pose = (name) => page.evaluate(({ who, pose }) => {
    const e = globalThis.engine
    if (!globalThis.lineup) { globalThis.lineup = []; e.folk.from.push(() => globalThis.lineup) }
    globalThis.lineup = who.map((w, i) => { const x = 684 + (i - (who.length - 1) / 2) * 12, z = 4010; return { ...w, ...pose, at: [x, e.feet(x, z), z], yaw: Math.PI } })
  }, { who: WHO, pose: POSES[name] })
  await place(EYES.row)
  await still(page, { sun: true }).catch(() => console.log("  never still at the start"))
  console.log("  up")
  for (const name of Object.keys(POSES)) {
    if (only.length && !only.includes(name)) continue
    await pose(name)
    for (const [where, eye] of Object.entries(EYES)) {
      if (eyes.length && !eyes.includes(where)) continue
      if ((where === 'face' || where === 'dressed') && name !== 'stand') continue
      if (where === 'side' && !['stand', 'walk', 'run', 'sit', 'hit', 'reel', 'down1', 'down2', 'down3'].includes(name)) continue
      if (where === 'far' && !['stand', 'walk', 'run'].includes(name)) continue
      await place(eye)
      await still(page, { sun: true, limit: 40_000 }).catch(() => console.log(`  ${name} ${where}: never still`))
      await page.waitForTimeout(400)
      await page.screenshot({ path: join(out, `${name}-${where}.png`) })
    }
    console.log(`  ${name}`)
  }
  console.log(JSON.stringify(await page.evaluate(() => globalThis.engine.folk.drawn)))
} finally {
  await browser.close()
  server.stop()
}
