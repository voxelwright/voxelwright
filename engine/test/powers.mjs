// What a body can do is numbers a rule sets, and so is the world's clock (#264, the bodies lane). Real Chrome, the
// real server, nothing stubbed. The rule is no game: it listens to what people say and sets numbers for whoever
// said it. Said "quick", she runs faster; "lighter", she jumps high and comes down slowly; "climb", she goes up a
// wall and over it; "wings", she flies and hangs; "slow", the world and everyone else goes at a quarter while she
// goes as she did. Numbers out of range are refused, a rule cannot set an actor's, and taken out, all is as it was.
//
//   node test/powers.mjs [--out dir]
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME, film, serve, still, turn } from './kit.mjs'

const out = arg('out', '') && resolve(arg('out', ''))
if (out) mkdirSync(out, { recursive: true })
const kit = process.env.ENGINE_KIT ? JSON.parse(process.env.ENGINE_KIT) : null
const done = await turn()
const browser = kit ? await chromium.connect(kit.ws) : await chromium.launch(CHROME)
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const server = await serve('/dev/null', ['--world', join(mkdtempSync(join(tmpdir(), 'engine-powers-')), 'world.log')])
const post = (path, body) => fetch(`${server.url}/world/${path}`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())
const rules = async () => (await fetch(`${server.url}/world/rules`)).json()
const open = async (name, z) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&fire=0&people=0&shared=1&name=${name}`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await still(page)
  await page.evaluate((z) => { const e = globalThis.engine; e.pose.x = 76; e.pose.z = z; e.pose.y = e.ground(76, z) + 3; e.pose.yaw = Math.PI / 2; e.pose.pitch = -0.15; e.me.walk(true) }, z)
  await page.waitForFunction(() => globalThis.engine.me.feet, null, { timeout: 10_000 })
  await page.waitForTimeout(1200)
  return page
}
const feet = (page) => page.evaluate(() => { const e = globalThis.engine, f = e.me.feet; return { at: f.at, speed: f.speed, can: e.me.can, tempo: e.tempo.rate, clock: e.me.clock } })
const say = async (page, text, until) => { await page.evaluate((t) => globalThis.engine.say(t), text); await page.waitForFunction(until, null, { timeout: 8000 }) }
/** Standing: not going along the ground, and no higher or lower than half a second ago. */
const settled = async (page) => { for (let i = 0, was = NaN; i < 60; i++) { const f = await page.evaluate(() => globalThis.engine.me.feet); if (f.speed < 1 && Math.abs(f.at[1] - was) < 0.3) return; was = f.at[1]; await page.waitForTimeout(500) } throw new Error('never came to stand') }
const RULE = `on('said', (world, e) => {
  if (/quick/.test(e.text)) world.person(e.by, {pace: 120})
  if (/lighter/.test(e.text)) world.person(e.by, {fall: 0.25, jump: 40})
  if (/climb/.test(e.text)) world.person(e.by, {climb: 100000})
  if (/wings/.test(e.text)) world.person(e.by, {fly: 80})
  if (/slow/.test(e.text)) world.clock({rate: 0.25, spare: [e.by]})
  if (/hold fast/.test(e.text)) world.person(e.by, {cling: true})
  if (/westward/.test(e.text)) world.person(e.by, {down: [-1, 0, 0]})
  if (/too much/.test(e.text)) world.person(e.by, {pace: 9999})
  if (/as it was/.test(e.text)) { world.person(e.by, {pace: null, fall: null, jump: null, climb: null, fly: null, cling: null, down: null}); world.clock({rate: 1}) }
})
on('start', (world) => world.actor('post', {name: 'Someone standing', at: [700, 4009]}))
on('tick', (world) => { if (!world.keep.tried) { world.keep.tried = true; world.person('post', {pace: 100}) } })`
try {
  const ada = await open('Ada', 408.3), ben = await open('Ben', 407.0)
  check((await post('ask', { by: 'tester', rule: { id: 'powers', name: 'Whoever says so can', source: RULE } })).asked, 'a rule that sets numbers for whoever asks is taken')
  const before = await feet(ada)
  // An actor's body is not a person's to set: the rule tried at its first tick, and is told why not.
  let told = ''
  for (let i = 0; i < 20 && !/someone at a page/.test(told); i++) { await ada.waitForTimeout(300); told = JSON.stringify((await rules()).find((r) => r.id === 'powers')) }
  check(/someone at a page/.test(told), 'a rule that tries to set the body of an actor is told it is for someone at a page')
  check(before.can.pace === 45 && before.can.climb === 0 && before.can.fly === 0 && before.can.fall === 1, 'as she is: runs at 4.5 m/s, climbs steps only, does not fly')
  // Quick.
  await say(ada, 'quick', () => globalThis.engine.me.can.pace === 120)
  await ada.keyboard.down('ShiftLeft'); await ada.keyboard.down('KeyW')
  await ada.waitForTimeout(1500)
  const quick = await feet(ada)
  await ada.keyboard.up('ShiftLeft'); await ada.keyboard.up('KeyW')
  check(quick.speed > 80, `said "quick", the rule gives her a pace of 120 and she runs at ${(quick.speed / 10).toFixed(1)} m/s`)
  await settled(ada)
  await say(ada, 'as it was', () => globalThis.engine.me.can.pace === 45)
  // Lighter: a jump of 4 m, and slow to come down.
  await say(ada, 'lighter', () => globalThis.engine.me.can.jump === 40)
  const ground = (await feet(ada)).at[1]
  await ada.keyboard.press('Space')
  let high = 0, aloft = 0
  const began = Date.now()
  for (let i = 0; i < 120; i++) { await ada.waitForTimeout(100); const y = (await feet(ada)).at[1] - ground; high = Math.max(high, y); if (y > 2) aloft = (Date.now() - began) / 1000; else if (i > 5) break }
  check(high > 30 && aloft > 2.5, `said "lighter", she jumps ${(high / 10).toFixed(1)} m and is ${aloft.toFixed(1)} s in the air (0.8 m and under a second as she was)`)
  await say(ada, 'as it was', () => globalThis.engine.me.can.jump === 7.4)
  await settled(ada)
  // Climb: a wall 3 m high and 2 m thick across her way.
  if (process.env.DEBUG) console.log('before the wall', JSON.stringify(await ada.evaluate(() => { const e = globalThis.engine, f = e.me.feet; return { feet: f.at, land: e.ground(f.at[0] / 10, f.at[2] / 10) * 10, can: e.me.can } })))
  const at = (await feet(ada)).at, x0 = Math.round(at[0]) + 40, y0 = Math.round(at[1]) - 2, rows = []
  for (let y = y0; y < y0 + 32; y++) for (let z = Math.round(at[2]) - 16; z < Math.round(at[2]) + 16; z++) rows.push(x0, x0 + 20, y, z, 8)
  await post('ask', { by: 'tester', edit: [1, rows.length / 5, ...rows], release: [x0 - 3, y0 + 40, Math.round(at[2])] })
  await ada.waitForTimeout(800)
  await ada.keyboard.down('KeyW'); await ada.waitForTimeout(3000)
  const stopped = await feet(ada)
  check(stopped.at[0] < x0 && stopped.at[1] - at[1] < 3, 'as she is, a wall three metres high stops her')
  await say(ada, 'climb', () => globalThis.engine.me.can.climb === 100000)
  if (process.env.DEBUG) { await ada.waitForTimeout(1000); console.log('wall from', x0, 'feet were', JSON.stringify(at), 'now', JSON.stringify(await feet(ada)), JSON.stringify(await ada.evaluate(async () => { const r = []; const f = globalThis.engine.me.feet.at; for (let dx = 0; dx < 8; dx++) r.push((await (await fetch(`/world/at?x=${Math.round(f[0]) + dx}&y=${Math.round(f[1]) + 9}&z=${Math.round(f[2])}`)).json()).material); return r }))) }
  let top = 0
  const climbing = async () => { for (let i = 0; i < 100; i++) { await ada.waitForTimeout(100); const f = (await feet(ada)).at; top = Math.max(top, f[1] - at[1]); if (f[0] > x0 + 24) break } }
  if (out) { const took = await film(ada, 8, climbing); writeFileSync(join(out, 'climb.webm'), took.webm); spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(out, 'climb.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-vf', 'scale=1280:-2', join(out, 'climb.mp4')]); spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(out, 'climb.webm'), '-vf', `fps=${(12 / took.seconds).toFixed(3)},scale=480:-1,tile=4x3`, '-frames:v', '1', join(out, 'climb-strip.jpg')]) } else await climbing()
  await ada.keyboard.up('KeyW')
  const over = await feet(ada)
  check(top > 28 && over.at[0] > x0 + 18, `said "climb", still walking she goes up it (${(top / 10).toFixed(1)} m) and over to the far side`)
  await settled(ada)
  // Wings.
  await say(ada, 'wings', () => globalThis.engine.me.can.fly === 80)
  const low = (await feet(ada)).at[1]
  await ada.keyboard.down('Space'); await ada.waitForTimeout(1500); await ada.keyboard.up('Space')
  const up = (await feet(ada)).at[1]
  await ada.waitForTimeout(1500)
  const hung = (await feet(ada)).at[1]
  check(up - low > 60 && Math.abs(hung - up) < 12, `said "wings", Space takes her ${((up - low) / 10).toFixed(1)} m up and let go she hangs there`)
  await ada.keyboard.down('KeyC'); await ada.waitForTimeout(2500); await ada.keyboard.up('KeyC')
  await say(ada, 'as it was', () => globalThis.engine.me.can.fly === 0)
  await ada.waitForTimeout(1500)
  await settled(ada)
  // Which way is down. A second wall, four metres high and two thick, four metres on.
  const from = (await feet(ada)).at, w0 = Math.round(from[0]) + 40, wy = Math.round(from[1]) - 2, more = []
  for (let y = wy; y < wy + 42; y++) for (let z = Math.round(from[2]) - 16; z < Math.round(from[2]) + 16; z++) more.push(w0, w0 + 20, y, z, 8)
  await post('ask', { by: 'tester', edit: [1, more.length / 5, ...more], release: [w0 - 3, wy + 50, Math.round(from[2])] })
  await ada.waitForTimeout(800)
  // Holding fast: walked at it, the wall becomes her floor and her eye turns with her; over the top and down the far side.
  await say(ada, 'hold fast', () => globalThis.engine.me.can.cling === true)
  await ada.keyboard.down('KeyW')
  let onWall = false, rose = 0, past = false
  for (let i = 0; i < 150 && !past; i++) { await ada.waitForTimeout(100); const f = await ada.evaluate(() => ({ at: globalThis.engine.me.feet.at, tilt: globalThis.engine.pose.tilt })); if (f.tilt && f.at[1] - from[1] > 12) onWall = true; rose = Math.max(rose, f.at[1] - from[1]); past = onWall && !f.tilt && f.at[0] > w0 + 24 && f.at[1] - from[1] < 6 }
  await ada.keyboard.up('KeyW')
  check(onWall && rose > 36 && past, `said "hold fast", she walks up the wall with it as her floor and her eye turned with her (${(rose / 10).toFixed(1)} m up), over the top and down the far side to the street`)
  await settled(ada)
  await say(ada, 'as it was', () => globalThis.engine.me.can.cling === false)
  // Down to the west: she falls onto the wall's east face and stands on it.
  await say(ada, 'westward', () => !!globalThis.engine.me.can.down)
  let stoodOn = null
  for (let i = 0; i < 60 && !stoodOn; i++) { await ada.waitForTimeout(100); const f = await ada.evaluate(() => ({ at: globalThis.engine.me.feet.at, speed: globalThis.engine.me.feet.speed, tilt: globalThis.engine.pose.tilt })); if (f.tilt && Math.abs(f.at[0] - (w0 + 20)) < 2.5 && f.speed < 1) stoodOn = f }
  check(!!stoodOn, `said "westward", a rule turns her down to the west: she falls onto the wall's east face and stands on it (feet at x ${stoodOn ? stoodOn.at[0].toFixed(0) : '?'}, the face at ${w0 + 20})`)
  await say(ada, 'as it was', () => !globalThis.engine.me.can.down)
  await ada.waitForTimeout(1500)
  await settled(ada)
  check(!(await ada.evaluate(() => globalThis.engine.pose.tilt)) && (await feet(ada)).at[1] - from[1] < 6, 'her down the world\'s again, she is on the street and her eye is level')
  // Slow: the world's clock at a quarter, and she is spared.
  await say(ada, 'slow', () => globalThis.engine.tempo.rate === 0.25)
  await ben.waitForFunction(() => globalThis.engine.tempo.rate === 0.25, null, { timeout: 5000 })
  await ada.keyboard.down('KeyW'); await ben.keyboard.down('KeyW')
  await ada.waitForTimeout(3000)
  if (process.env.DEBUG) console.log(JSON.stringify(await feet(ada)), JSON.stringify(await ada.evaluate(() => ({ top: globalThis.engine.input.top, w: globalThis.engine.input.held('KeyW'), on: globalThis.engine.me.on }))))
  const [hers, his] = [await feet(ada), await feet(ben)]
  await ada.keyboard.up('KeyW'); await ben.keyboard.up('KeyW')
  check(hers.clock === 1 && his.clock === 0.25 && hers.speed > 8 && his.speed > 2 && his.speed < 6, `said "slow", the world goes at a quarter: she, spared, still walks at ${(hers.speed / 10).toFixed(1)} m/s; the other page's person at ${(his.speed / 10).toFixed(2)}`)
  // What is out of range is refused and said; an actor's body is not a person's to set.
  await ada.evaluate(() => globalThis.engine.say('too much'))
  await ada.waitForTimeout(1500)
  const how = (await rules()).find((r) => r.id === 'powers')
  check((await feet(ada)).can.pace === 45 && /pace is a number from 0 to 400/.test(JSON.stringify(how)), 'a pace out of range is refused, and the rule is told why')
  // Taken out, everything it set goes back.
  await post('ask', { by: 'tester', unrule: 'powers' })
  await ada.waitForFunction(() => globalThis.engine.tempo.rate === 1 && globalThis.engine.me.clock === 1, null, { timeout: 5000 })
  check((await feet(ben)).tempo === 1, 'the rule taken out, the clock goes as it did, for everyone')
} catch (e) {
  failures.push(String(e.stack ?? e))
}
await browser.close().catch(() => {})
server.stop()
done?.()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('powers: ok')
process.exit(0)
