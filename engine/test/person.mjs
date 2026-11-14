// A person has a body (#264, the bodies lane): the city page in the installed Chrome, the real server, nothing stubbed.
// Alone: the eye gets down onto its feet and walks, runs, climbs the road's steps, jumps, steps aside, is stopped by
// what is built, rides in its own head or behind it, and flies again. On a phone the left thumb walks. In a shared
// world another page sees the figure walk where the feet are, a seat is told so, and a rule that is no game (someone
// who follows whoever is there) finds them by their feet.
//
//   node test/person.mjs [--out dir]
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { arg, CHROME, film, serve, still, turn } from './kit.mjs'

const out = arg('out', '') && resolve(arg('out', ''))
if (out) mkdirSync(out, { recursive: true })
const kit = process.env.ENGINE_KIT ? JSON.parse(process.env.ENGINE_KIT) : null
const done = await turn()
const browser = kit ? await chromium.connect(kit.ws) : await chromium.launch(CHROME)
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const file = join(mkdtempSync(join(tmpdir(), 'engine-person-')), 'world.log')
const server = await serve('/dev/null', ['--world', file])
const open = async (query, { phone = false, size = [1280, 720] } = {}) => {
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, ...(phone ? { hasTouch: true, isMobile: true } : {}) })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&fire=0&people=0&${query}`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await still(page)
  return page
}
/** The eye over the street the page starts above, looking east along it, then down onto the feet. */
const down = (page) => page.evaluate(() => { const e = globalThis.engine; e.pose.x = 76; e.pose.z = 408.3; e.pose.y = e.ground(76, 408.3) + 3; e.pose.yaw = Math.PI / 2; e.pose.pitch = -0.15; e.me.walk(true) })
const feet = (page) => page.evaluate(() => { const e = globalThis.engine, f = e.me.feet; return f && { at: f.at, speed: f.speed, yaw: f.yaw, eye: [e.pose.x * 10, e.pose.y * 10, e.pose.z * 10], top: e.input.top } })
const settled = (page) => page.waitForFunction(() => { const f = globalThis.engine.me.feet; return f && f.speed < 1 }, null, { timeout: 15_000 })
try {
  // ── Alone ──
  const page = await open('')
  await down(page)
  await page.waitForFunction(() => globalThis.engine.me.feet, null, { timeout: 10_000 })
  await page.waitForTimeout(1200)
  const stood = await feet(page), street = await page.evaluate(() => globalThis.engine.ground(76, 408.3) * 10)
  check(Math.abs(stood.at[1] - (street + 1)) < 1.5 && stood.speed < 1, `got down from the air, the body stands with its feet on the street (${(stood.at[1] - street).toFixed(1)} cells over the land's top)`)
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(2000)
  const walked = await feet(page)
  check(walked.speed > 11 && walked.speed < 18 && walked.at[0] - stood.at[0] > 15, `W walks it east at ${(walked.speed / 10).toFixed(1)} m/s (${((walked.at[0] - stood.at[0]) / 10).toFixed(1)} m in two seconds)`)
  if (out) await page.screenshot({ path: join(out, 'walking.png') })
  await page.keyboard.down('ShiftLeft')
  await page.waitForTimeout(2000)
  const ran = await feet(page)
  check(ran.speed > 38 && ran.at[1] - stood.at[1] > 2, `with Shift it runs at ${(ran.speed / 10).toFixed(1)} m/s, up the road's steps (${((ran.at[1] - stood.at[1]) / 10).toFixed(1)} m higher)`)
  await page.keyboard.press('Space')
  let high = 0
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(60); high = Math.max(high, (await feet(page)).at[1] - ran.at[1]) }
  check(high > 4, `Space jumps (${(high / 10).toFixed(2)} m off the road, still running)`)
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW')
  await settled(page)
  // To its left, the eye still looking east: the body turns that way and goes (cars are parked close on the right).
  const before = await feet(page)
  await page.keyboard.down('KeyA'); await page.waitForTimeout(800); await page.keyboard.up('KeyA')
  await settled(page)
  const aside = await feet(page)
  check(before.at[2] - aside.at[2] > 6 && Math.abs(aside.at[0] - before.at[0]) < 4, `A takes it to the left of where the eye looks (${((before.at[2] - aside.at[2]) / 10).toFixed(1)} m north)`)
  // Something built in its way stops it, and it breaks nothing.
  const fell = await page.evaluate(() => { const e = globalThis.engine, f = e.me.feet; e.set([Math.round(f.at[0]) + 40, Math.round(f.at[1]) + 6, Math.round(f.at[2])], 12, 8); return e.fell.pieces })
  await page.waitForTimeout(600)
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW')
  await page.waitForTimeout(2500)
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW')
  const stopped = await feet(page)
  check(stopped.at[0] - aside.at[0] > 15 && stopped.at[0] - aside.at[0] < 34, `a block of brick in its way stops it (${((stopped.at[0] - aside.at[0]) / 10).toFixed(1)} m on, short of the brick's middle at 4 m)`)
  check(await page.evaluate((n) => globalThis.engine.fell.pieces === n, fell), 'and nothing of the brick is broken by it')
  // In its head, and behind again; then up to fly.
  const behind = await feet(page)
  await page.keyboard.press('KeyV')
  await page.waitForTimeout(400)
  const head = await feet(page)
  check(Math.hypot(head.eye[0] - head.at[0], head.eye[2] - head.at[2]) < 1 && Math.abs(head.eye[1] - head.at[1] - 16.5) < 1.5 && Math.hypot(behind.eye[0] - behind.at[0], behind.eye[2] - behind.at[2]) > 20, 'V puts the eye in its head (it was behind and above)')
  if (out) await page.screenshot({ path: join(out, 'head.png') })
  await page.keyboard.press('KeyV')
  await page.keyboard.press('KeyB')
  await page.waitForTimeout(200)
  const flying = await page.evaluate(() => ({ on: globalThis.engine.me.on, y: globalThis.engine.pose.y }))
  await page.keyboard.down('Space'); await page.waitForTimeout(500); await page.keyboard.up('Space')
  check(!flying.on && await page.evaluate((y) => globalThis.engine.pose.y > y + 0.5, flying.y), 'B flies again: the eye rises with Space as it always did')
  if (out) {
    // A film of it: down onto the feet, a walk, a run, a jump, a turn, as the page shows it.
    await page.evaluate(() => { const e = globalThis.engine; e.pose.x = 76; e.pose.z = 407.2; e.pose.y = e.ground(76, 407.2) + 3; e.pose.yaw = Math.PI / 2; e.pose.pitch = -0.15; e.me.walk(true) })
    await page.waitForTimeout(1500)
    const took = await film(page, 7, async () => {
      await page.keyboard.down('KeyW'); await page.waitForTimeout(1800)
      await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(1500)
      await page.keyboard.press('Space'); await page.waitForTimeout(900)
      await page.keyboard.down('KeyA'); await page.waitForTimeout(1000); await page.keyboard.up('KeyA')
      await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW')
    })
    writeFileSync(join(out, 'walk.webm'), took.webm)
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(out, 'walk.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-vf', 'scale=1280:-2', join(out, 'walk.mp4')])
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(out, 'walk.webm'), '-vf', `fps=${(12 / took.seconds).toFixed(3)},scale=480:-1,tile=4x3`, '-frames:v', '1', join(out, 'walk-strip.jpg')])
    console.log(`  filmed: ${took.frames} frames in ${took.seconds.toFixed(1)} s, gaps p50 ${took.p50.toFixed(1)} p95 ${took.p95.toFixed(1)} worst ${took.worst.toFixed(1)} ms`)
  }
  await page.context().close()

  // ── A phone: the left thumb walks ──
  const phone = await open('walk=1', { phone: true, size: [844, 390] })
  await phone.waitForFunction(() => globalThis.engine.me.feet, null, { timeout: 10_000 })
  await phone.evaluate(() => { globalThis.engine.pose.yaw = Math.PI / 2 })
  await phone.waitForTimeout(2500)
  const p0 = await feet(phone)
  const cdp = await phone.context().newCDPSession(phone)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 280 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120, y: 200 }] })
  await phone.waitForTimeout(1500)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const p1 = await feet(phone)
  check(p0 && p1 && Math.hypot(p1.at[0] - p0.at[0], p1.at[2] - p0.at[2]) > 25, `on a phone, started on foot by the address, the left thumb pushed up walks it (${p0 && p1 ? (Math.hypot(p1.at[0] - p0.at[0], p1.at[2] - p0.at[2]) / 10).toFixed(1) : '?'} m)`)
  await phone.context().close()

  // ── In a shared world ──
  const post = (path, body) => fetch(`${server.url}/world/${path}`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())
  const ada = await open('shared=1&name=Ada'), ben = await open('shared=1&name=Ben')
  await ben.evaluate(() => { const e = globalThis.engine; e.pose.x = 78; e.pose.z = 410.5; e.pose.y = e.ground(78, 410.5) + 2.2; e.pose.yaw = -0.6; e.pose.pitch = -0.2 })
  await down(ada)
  await ada.waitForFunction(() => globalThis.engine.me.feet, null, { timeout: 10_000 })
  await ada.waitForTimeout(1500)
  // Someone builds a block in the street after she is down: her own core is told, and she is stopped by it.
  await post('ask', { by: 'tester', edit: [0, 800, Math.round(street) + 7, 4083, 12, 8], release: [800, Math.round(street) + 30, 4083] })
  await ada.waitForTimeout(800)
  await ada.keyboard.down('ShiftLeft'); await ada.keyboard.down('KeyW')
  await ada.waitForTimeout(2500)
  const blocked = await feet(ada)
  check(blocked.at[0] > 770 && blocked.at[0] < 794, `in a shared world she walks, and what someone else built since stops her (at x ${blocked.at[0].toFixed(0)}, the block from 788)`)
  if (out) await ben.screenshot({ path: join(out, 'seen.png') })
  await ada.keyboard.up('ShiftLeft'); await ada.keyboard.up('KeyW')
  await settled(ada)
  await ada.waitForTimeout(600)
  const hers = await feet(ada)
  // A seat is told where she is: on her feet, on the street.
  await post('join', { by: 'watcher', at: [760, 4010] })
  const around = await (await fetch(`${server.url}/world/around?by=watcher`)).json()
  const seen = around.people.find((p) => p.name === 'Ada')
  check(seen && seen.what === 'at a page' && Math.hypot(seen.at[0] - hers.at[0], seen.at[2] - hers.at[2]) < 6 && Math.abs(seen.at[1] - hers.at[1]) < 3, `the world has her where her feet are (${seen && seen.at}), not where her eye rides`)
  check(await ben.evaluate(() => globalThis.engine.others) >= 1, 'another page has her as a figure')
  // A rule that is no game: someone who follows whoever is at a page, found by their feet.
  await post('ask', { by: 'tester', rule: { id: 'tail', name: 'Someone who follows', source: "on('start', (world) => world.actor('tail', {name: 'Wim', at: [700, 4083]}))\non('tick', (world) => { const p = world.people.find((p) => p.kind === 'page' && p.name === 'Ada'); if (p) world.actor('tail', {to: [p.at[0] - 14, p.at[2]], pace: 60}) })" } })
  let wim = null
  for (let i = 0; i < 40 && !(wim && Math.hypot(wim.at[0] - hers.at[0], wim.at[2] - hers.at[2]) < 30); i++) { await ada.waitForTimeout(500); wim = (await (await fetch(`${server.url}/world/around?by=watcher`)).json()).people.find((p) => p.name === 'Wim') }
  check(wim && Math.hypot(wim.at[0] - hers.at[0], wim.at[2] - hers.at[2]) < 30, `a rule finds her by her feet: its actor has walked up to her (${wim ? (Math.hypot(wim.at[0] - hers.at[0], wim.at[2] - hers.at[2]) / 10).toFixed(1) : '?'} m off)`)
  if (out) await ben.screenshot({ path: join(out, 'followed.png') })
} catch (e) {
  failures.push(String(e.stack ?? e))
}
await browser.close().catch(() => {})
server.stop()
done?.()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('person: ok')
process.exit(0)
