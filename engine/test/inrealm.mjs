// Sound and music in a realm that is not home (#264, #247). The other sound checks run in the home world; a made
// realm has a world process and a line of its own, and a page steps into it without loading again. Here a rule in a
// made realm tolls a bell and says what the realm's music is like; a page at home hears neither, steps in and hears
// both, steps home and hears the place's own again, and steps back.
//
//   node test/inrealm.mjs
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chrome, serve, still } from './kit.mjs'

const dir = join(tmpdir(), `engine-inrealm-${process.pid}`)
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const server = await serve('/dev/null', ['--world', join(dir, 'home.log'), '--realms', join(dir, 'realms')])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const post = async (path, body) => { for (;;) { const r = await fetch(server.url + path, { method: 'POST', body: JSON.stringify(body) }); if (r.status === 429) { await wait(400); continue } return r.status } }

// A hall with a bell: it tolls every tick beside where one arrives, and its music is the snow's in dorian at 90.
const HALL = `
on('start', (world) => { world.music({ like: 'snow', mode: 'dorian', pace: 90, drive: 0.5 }); world.actor('piper', { name: 'a piper', at: [705, 4070] }); world.sound({ as: 'pipe', on: 'piper', like: 'pipe', note: 67 }) })
on('tick', (world) => world.sound({ like: 'bell', at: [700, 4070], note: 62, force: 0.8 }))`
const POSE = { x: 70, y: 17.8, z: 406, yaw: 0, pitch: 0 }

let browser
try {
  console.log('In a realm that is not home')
  check(await post('/realms', { by: 'check', id: 'hall', name: 'A hall with a bell', arrive: { at: [700, 4060] } }) < 300, 'a realm is made')
  check(await post('/realm/hall/world/ask', { by: 'check', rule: { id: 'bell', name: 'bell', source: HALL } }) < 300, 'a rule goes into it that tolls a bell and says what its music is like')
  browser = await chrome()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&shared=1&scale=0.4&people=0&music=1&at=70,17.8,406&look=0,0`)
  await page.waitForFunction(() => globalThis.engine?.ears, null, { timeout: 90_000 })
  await page.mouse.click(640, 300)
  await page.waitForFunction(() => globalThis.engine.ears.voice.running)
  const now = () => page.evaluate(() => { const e = globalThis.engine, s = e.ears.music.state; return { realm: e.realms.here, mood: s.mood, pace: s.pace, rules: e.ears.count.rules, held: e.ears.following.filter((f) => f.sounding).length } })
  const step = async (to) => { await page.evaluate(([id, pose]) => globalThis.engine.realms.step(id, pose), [to, POSE]); await still(page, { limit: 90_000 }) }
  const mood = (want, ms = 30_000) => page.waitForFunction((m) => (m ? globalThis.engine.ears.music.state.mood === m : !String(globalThis.engine.ears.music.state.mood).includes('|')), want, { timeout: ms }).catch(() => {})
  const tolls = async (ms) => { const a = (await now()).rules; await wait(ms); return (await now()).rules - a }

  await wait(2500)
  const home = await now()
  check(home.realm === 'home' && home.rules === 0 && home.held === 0 && !String(home.mood).includes('|'), `at home the page hears no bell and the music is the place's own (${JSON.stringify(home)})`)

  await step('hall')
  await mood('snow|0|dorian')
  const heard = await tolls(3000), there = await now()
  check(there.held === 1, 'and the pipe that stays on the hall\'s piper')
  check(there.realm === 'hall' && heard > 0, `stepped into the hall without loading again, it hears the rule's bell (${heard} in 3 s)`)
  check(there.mood === 'snow|0|dorian' && there.pace === 90, `and the music is what the hall's rule said: ${there.mood} at ${there.pace} beats a minute`)

  await step('home')
  await mood(null)
  const quiet = await tolls(3000), back = await now()
  check(back.held === 0, 'nor the piper\'s pipe')
  check(back.realm === 'home' && quiet === 0, `stepped home, the hall's bell is not heard (${quiet} in 3 s)`)
  check(!String(back.mood).includes('|'), `and the music is the place's own again (${back.mood})`)

  await step('hall')
  await mood('snow|0|dorian')
  const again = await tolls(3000), last = await now()
  check(last.mood === 'snow|0|dorian' && last.pace === 90 && again > 0 && last.held === 1, `stepped back, the hall's bell and its music are there again (${again} in 3 s, ${last.mood} at ${last.pace})`)
  const told = await page.evaluate(() => globalThis.engine.ears.voice.told)
  check(told && told.reset === 0 && told.peak <= 0.891, 'nothing went over the ceiling')
} catch (e) { failures.push(String(e?.stack ?? e)); console.log(`  FAIL ${e?.message ?? e}`) } finally {
  await browser?.close(); server.stop(); rmSync(dir, { recursive: true, force: true })
}
if (failures.length) { console.log(`FAILED: ${failures.length}`); process.exit(1) }
console.log('ok')
