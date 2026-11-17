// Keys a tooltip offers keep working in one page (#245): in a shared world, E gets on a car and G picks up a made
// thing after a ride, after B twice (also pressed while a car's cue shows) and after a trip to another realm and
// back, with no reload. Each of these takes the person off their feet and puts them back, and the feet's mode used to
// take every mode put over it with it: E's (`beside`) and the hands' (`offered`) were gone while their owners
// thought they were there. The real server, world process and page; no model is run.
//
//   node test/keys-stay.mjs
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chrome, serve, still } from './kit.mjs'

const dir = join(tmpdir(), `engine-keys-stay-${process.pid}`)
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const server = await serve('/dev/null', ['--world', join(dir, 'home.log'), '--realms', join(dir, 'realms')])
const post = async (path, body) => { for (;;) { const r = await fetch(server.url + path, { method: 'POST', body: JSON.stringify(body) }); if (r.status === 429) { await wait(400); continue } return r } }
const START = { x: 70, y: 17.8, z: 406, yaw: 0, pitch: -0.25 }

let browser
try {
  check((await post('/realms', { by: 'check', id: 'yard', name: 'A quiet yard', arrive: { at: [700, 4060] } })).status < 300, 'a second realm is made')
  browser = await chrome()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${server.url}/city?shared=1&walk=1&people=0&fire=0&scale=0.5&name=Ada&at=${START.x},${START.y},${START.z}&look=0,-14`)
  await page.waitForFunction(() => globalThis.engine?.hands && globalThis.engine.alive && globalThis.engine.realms, null, { timeout: 90_000 })
  await still(page)
  await page.waitForFunction(() => globalThis.engine.me.on && globalThis.engine.me.feet, null, { timeout: 20_000 })

  const tap = async (code) => { await page.keyboard.press(code); await wait(150) }
  const modes = () => page.evaluate(() => { const i = globalThis.engine.input; return { top: i.top, offered: i.live('offered'), afoot: i.live('afoot') } })
  /** A car made beside the person, its cue showing; E gets on, W drives a little, E gets off. Answers whether E got on. */
  let cars = 0
  const car = async () => {
    const ref = await page.evaluate(async () => {
      const e = globalThis.engine, f = e.me.feet.at, x = Math.round(f[0]) + 14, z = Math.round(f[2]) - 9, ground = Math.round(e.ground(x / 10, z / 10) * 10)
      return (await e.alive.spawn(e.car([x, ground + 5, z]))).ref
    })
    cars++
    return ref
  }
  const ride = async () => {
    const near = await page.waitForFunction(() => globalThis.engine.alive.near?.ref ?? null, null, { timeout: 10_000 }).then((h) => h.jsonValue(), () => null)
    await tap('KeyE')
    const on = await page.waitForFunction(() => globalThis.engine.alive.riding?.ref ?? null, null, { timeout: 3000 }).then((h) => h.jsonValue(), () => null)
    if (!on) return { near, on }
    await page.keyboard.down('KeyW'); await wait(700); await page.keyboard.up('KeyW')
    await page.keyboard.down('KeyS'); await wait(700); await page.keyboard.up('KeyS')
    await wait(600)
    await tap('KeyE')
    const off = await page.waitForFunction(() => !globalThis.engine.alive.riding && globalThis.engine.me.on && globalThis.engine.me.feet, null, { timeout: 10_000 }).then(() => true, () => false)
    return { near, on, off }
  }
  /** A post of cells made just ahead of the person and looked at; G picks it up and G puts it down. */
  let posts = 0
  const pickUp = async () => {
    const id = `post-${++posts}`
    // Off a car or out of the air, the body is made where the eye was and falls: it is let land first.
    for (let was = NaN, n = 0; n < 40; n++) { const y = await page.evaluate(() => globalThis.engine.me.feet?.at[1] ?? NaN); if (Math.abs(y - was) < 0.05) break; was = y; await wait(250) }
    // A metre from the eye, on the side away from every car (or the post would stand behind one, or in it), looked at
    // from the head and down: from behind, the eye is too far back to reach it.
    const at = await page.evaluate(() => {
      const e = globalThis.engine, cars = e.alive.things.map((t) => e.alive.where(t)?.at).filter(Boolean)
      const ways = [[0, -1], [0, 1], [-1, 0], [1, 0]], f = e.me.feet.at
      const clear = (w) => Math.min(Infinity, ...cars.map((c) => Math.hypot(f[0] + w[0] * 10 - c[0], f[2] + w[1] * 10 - c[2])))
      const way = ways.reduce((a, b) => (clear(b) > clear(a) ? b : a))
      e.me.view = 'head'; e.pose.yaw = Math.atan2(way[0], -way[1]); e.pose.pitch = -0.6
      // (From the head the eye is over the feet; the eye itself moves there only with the next frame.)
      return [Math.floor(f[0]) + way[0] * 10, Math.round(f[1]), Math.floor(f[2]) + way[1] * 10]
    })
    // Three cells square, so the eye's line runs through its middle.
    const rows = [], [x, , z] = at, low = at[1] - 2
    for (let y = 0; y < 14; y++) for (let d = -1; d < 2; d++) rows.push(x - 1, x + 2, low + y, z + d, 12 | (180 << 8))
    const made = await post('/world/ask', { by: 'tester', edit: [1, rows.length / 5, ...rows], release: [x, low + 16, z], thing: { id, name: `a post (${posts})`, wish: 'a post', at: [x, low, z], size: [3, 14, 3], facing: 'south' } })
    if (!made.ok) throw new Error(`the post was not made: ${made.status} ${await made.text()}`)
    const reach = await page.waitForFunction((id) => globalThis.engine.hands.reach?.id === id, id, { timeout: 10_000 }).then(() => true, () => false)
    await tap('KeyG')
    const held = await page.waitForFunction((id) => globalThis.engine.hands.holding?.id === id, id, { timeout: 5000 }).then(() => true, () => false)
    if (held) { await tap('KeyG'); await page.waitForFunction(() => !globalThis.engine.hands.holding, null, { timeout: 5000 }).catch(() => {}) }
    await page.evaluate(() => { globalThis.engine.me.view = 'behind' })
    return { reach, held }
  }

  console.log('At the start')
  const first = await pickUp()
  check(first.reach && first.held, `G picks up a made thing that is aimed at within reach (in reach ${first.reach}, picked up ${first.held})`)
  await car()
  const one = await ride()
  check(!!one.on && one.off, `E gets on a car beside the person, W drives it and E gets off (${JSON.stringify(one)})`)

  console.log('After a ride')
  let m = await modes()
  check(m.offered && m.afoot, `the hands' keys and the feet's are still there (${JSON.stringify(m)})`)
  const again = await ride()
  check(!!again.on && again.off, `E gets on the same car again (${JSON.stringify(again)})`)
  const g1 = await pickUp()
  check(g1.reach && g1.held, `G picks up a made thing (${JSON.stringify(g1)})`)

  console.log('After B twice, pressed while a car\'s cue shows')
  // Still beside the car just ridden, its cue showing.
  await page.waitForFunction(() => globalThis.engine.alive.near, null, { timeout: 10_000 }).catch(() => {})
  const cue = await page.evaluate(() => globalThis.engine.input.live('beside'))
  await tap('KeyB'); await page.waitForFunction(() => !globalThis.engine.me.on, null, { timeout: 5000 }).catch(() => {})
  await wait(400)
  await tap('KeyB'); await page.waitForFunction(() => globalThis.engine.me.on && globalThis.engine.me.feet, null, { timeout: 10_000 }).catch(() => {})
  await wait(800)
  m = await modes()
  check(cue && m.offered && m.afoot, `the cue's key was there as B was pressed (${cue}), and the hands' and the feet's are there after (${JSON.stringify(m)})`)
  const b = await ride()
  check(!!b.on && b.off, `E gets on the car whose cue showed (${JSON.stringify(b)})`)
  const g2 = await pickUp()
  check(g2.reach && g2.held, `G picks up a made thing (${JSON.stringify(g2)})`)

  console.log('After a trip to another realm and back')
  await page.evaluate((pose) => globalThis.engine.realms.step('yard', pose), START); await still(page, { limit: 90_000 })
  check(await page.evaluate(() => globalThis.engine.realms.here === 'yard'), 'the page steps into the other realm without loading again')
  await page.evaluate((pose) => globalThis.engine.realms.step('home', pose), START); await still(page, { limit: 90_000 })
  await page.waitForFunction(() => globalThis.engine.realms.here === 'home' && globalThis.engine.me.on && globalThis.engine.me.feet, null, { timeout: 20_000 }).catch(() => {})
  await wait(800)
  m = await modes()
  check(m.offered && m.afoot, `and back home, on foot, the hands' keys and the feet's are there (${JSON.stringify(m)})`)
  await car()
  const r = await ride()
  check(!!r.on && r.off, `E gets on a car (${JSON.stringify(r)})`)
  const g3 = await pickUp()
  check(g3.reach && g3.held, `G picks up a made thing (${JSON.stringify(g3)})`)
} catch (e) { failures.push(`stopped: ${e.message}`); console.error(e) }
await browser?.close()
server.stop()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('keys-stay: ok (no model was run)')
process.exit(0)
