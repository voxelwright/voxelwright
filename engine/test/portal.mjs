// The portal, measured (#264, an experiment): another realm seen live through a window in this one, and stepped
// into. Prints what it costs to hold and to draw, and how long a step through takes; keeps pictures with --out.
//
//   node test/portal.mjs [--out dir] [--size 1280x720]
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, here, still } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = join(tmpdir(), `engine-portal-${process.pid}`), out = arg('out', ''), [W, H] = arg('size', '1280x720').split('x').map(Number)
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
if (out) mkdirSync(out, { recursive: true })
const server = spawn('node', ['serve.mjs', '--port', '0', '--reports', '/dev/null', '--world', join(dir, 'home.log'), '--realms', join(dir, 'realms')], { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] })
const url = await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => { const m = /engine page on (http:\/\/127\.0\.0\.1:\d+)/.exec(String(chunk)); if (m) resolve(m[1]) })
  server.on('exit', (code) => reject(new Error(`the server ended (${code})`)))
})
const post = (path, body) => fetch(url + path, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.status)
const get = (path) => fetch(url + path).then((r) => r.json())
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const over = async (x, z) => (await get(`/world/at?x=${x}&y=0&z=${z}`)).ground + 1
const browser = await chrome()
try {
  // The other realm: the like street seven blocks east, at dusk in rain, tinted, with brick stood about in it.
  await post('/realms', { by: 'check', id: 'dusk', name: 'Dusk in the east', about: 'the east end, late', arrive: { at: [9660, 4070] }, look: { hour: 18.6, rain: 0.4, tint: [0.78, 1, 0.82] } })
  const D = await over(9660, 4040)
  for (let i = 0; i < 200; i++) { const x = 9560 + (i % 20) * 11, z = 4030 + Math.floor(i / 20) * 9; if (await post('/realm/dusk/world/ask', { by: 'check', edit: [0, x, D + 1, z, 2, i % 3 ? 8 : 7], release: [x, D + 1, z] }) === 429) { await wait(1000); i-- } }
  await post('/realm/dusk/world/join', { by: 'bo', at: [9650, 4009] })
  await wait(2500)

  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  page ${m.type()}: ${m.text().slice(0, 300)}`) })
  await page.goto(`${url}/city?fly=0&shared=1&fire=0&sound=0&name=Cy&scale=1&at=70,17.2,411&look=0,-4${arg('workers', '') ? `&portalworkers=${arg('workers', '')}` : ''}`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await still(page, { limit: 90_000 })
  await page.evaluate(() => { globalThis.sameDocument = true })
  const frames = () => page.evaluate(async () => { const e = globalThis.engine; await new Promise((r) => setTimeout(r, 2500)); return { fps: Math.round(1000 / e.frameMs), gpu: Number(e.gpuMs.toFixed(1)), cpu: Number(e.cpuMs.toFixed(1)) } })
  const before = await frames()
  // A window three metres wide and four high, eight metres up the street, leading to the same spot of the other realm's street.
  const G = await over(700, 4030), gate = { at: [700, G + 20, 4030], yaw: 0, size: [30, 40], to: [9660, (await over(9660, 4030)) + 20, 4030] }
  const gaps = () => page.evaluate(() => { globalThis.gaps = []; let last = performance.now(); const tick = (now) => { globalThis.gaps.push(now - last); last = now; if (globalThis.gaps.length < 1200) requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  await gaps()
  const opened = await page.evaluate((g) => globalThis.engine.portal.open('dusk', g), gate)
  const opening = await page.evaluate(() => { const g = globalThis.gaps.slice().sort((a, b) => a - b); return { worst: g.at(-1), p95: g[Math.floor(g.length * 0.95)], frames: g.length } })
  const memory = await page.evaluate(() => globalThis.engine.portal.memory)
  console.log(`  opening: ${opened.ready.toFixed(0)} ms to read the realm, ${opened.built.toFixed(0)} ms to make the second world's store and marcher (once), ${opened.shown.toFixed(0)} ms to a picture of the other place with nothing missing, ${opened.made.toFixed(0)} ms to all of it made (${opened.sectors} sectors, ${opened.poolMb.toFixed(0)} MB of trees)`)
  console.log(`  while it opened: ${opening.frames} frames, the longest ${opening.worst.toFixed(0)} ms, 95 in 100 within ${opening.p95.toFixed(0)} ms. The second world takes ${memory.pool.toFixed(0)} MB of the GPU for its trees and boxes, ${memory.sun.toFixed(0)} MB for its sun's maps, ${memory.picture.toFixed(0)} MB for the window's picture`)
  await page.waitForFunction(() => globalThis.engine.portal.undrawn === 0, null, { timeout: 60_000 }).catch(() => console.log('  the other world\'s sun maps were not all drawn in a minute'))
  const during = await frames()
  console.log(`  frames: ${before.fps} a second before (march ${before.gpu} ms, this thread ${before.cpu} ms), ${during.fps} with the window open (march ${during.gpu} ms, this thread ${during.cpu} ms); the window covers ${await page.evaluate(() => { const e = globalThis.engine, r = e.portal.stats.rect; return ((r[2] * r[3]) / (e.gpu ? document.querySelector('canvas').width * document.querySelector('canvas').height : 1) * 100).toFixed(0) })}% of the picture`)
  if (out) await page.screenshot({ path: join(out, 'portal-open.png') })
  // Nearer, so the window is most of the picture.
  await page.evaluate(() => { globalThis.engine.pose.z = 406 })
  await page.waitForTimeout(800)
  if (out) await page.screenshot({ path: join(out, 'portal-near.png') })
  const bench = await page.evaluate(() => { const e = globalThis.engine, c = document.querySelector('canvas'); return e.portal.bench(e.view(), e.flags, [c.width, c.height]) })
  console.log(`  the GPU, ms a frame at ${W} x ${H} at its own pace:`)
  for (const [k, v] of Object.entries(bench)) console.log(`    ${k.padEnd(22)} ${v.toFixed(2)}`)

  // Through it. Brick put down in the other realm as the step is taken is in the world one arrives in.
  const gap = () => page.evaluate(() => { globalThis.gaps = []; let last = performance.now(); const tick = (now) => { globalThis.gaps.push(now - last); last = now; if (globalThis.gaps.length < 600) requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  await gap()
  // Walked through: the eye goes north past the window, a step a frame.
  const LATE = (await over(9660, 4000)) + 2
  void post('/realm/dusk/world/ask', { by: 'check', edit: [0, 9660, LATE, 4000, 2, 8], release: [9660, LATE, 4000] })
  await page.evaluate(async () => { const e = globalThis.engine; for (let i = 0; i < 30 && e.realms.here === 'home'; i++) { e.pose.z -= 0.2; await new Promise((r) => requestAnimationFrame(r)) } })
  await page.waitForFunction(() => globalThis.engine.portal.stats.steps.length === 1, null, { timeout: 60_000 })
  const through = await page.evaluate(() => globalThis.engine.portal.stats.steps[0])
  const worst = await page.evaluate(() => Math.max(...globalThis.gaps))
  await page.waitForTimeout(1500)
  await still(page, { limit: 60_000 })
  const late = await page.evaluate(async (y) => { const e = globalThis.engine; e.pose.yaw = 0; e.pose.pitch = -0.6; await new Promise((r) => setTimeout(r, 400)); return [e.wand.kind(9660, y, 4000) & 15, (await e.pick())?.material] }, LATE)
  check(late[0] === 8, `brick put down in the other realm while the step was being taken is known to the page that arrived (its core has ${late[0]} there)`)
  const there = await page.evaluate(() => { const e = globalThis.engine; return { realm: e.realms.here, others: e.others, same: globalThis.sameDocument === true, hour: e.look().hour, pose: [e.pose.x, e.pose.y, e.pose.z].map(Math.round), to: e.portal.to } })
  check(there.realm === 'dusk' && there.same && Math.abs(there.hour - 18.6) < 1e-6 && there.pose[0] === 966 && there.pose[2] <= 403 && there.to === 'home', `through the window the page is in the other realm, not loaded again, and the window leads back (${JSON.stringify(there)})`)
  console.log(`  the step through: ${through.ready.toFixed(0)} ms to read, ${through.went.toFixed(0)} ms to go over, everything made after ${through.whole.toFixed(0)} ms (${through.sectors} sectors made); the longest frame while it happened ${worst.toFixed(0)} ms; the window back was ready after ${through.back.made.toFixed(0)} ms more (${through.back.sectors} sectors)`)
  await page.waitForTimeout(1500)
  const after = await frames()
  console.log(`  frames in the other realm with the window back open: ${after.fps} a second (march ${after.gpu} ms)`)
  // Turned round, the window back is seen: home by day through it.
  await page.evaluate(() => { const e = globalThis.engine; e.pose.z -= 5; e.pose.yaw = Math.PI; e.pose.pitch = -0.05 })
  await page.waitForTimeout(1500)
  if (out) await page.screenshot({ path: join(out, 'portal-back.png') })
  await gap()
  await page.evaluate(async () => { const e = globalThis.engine; for (let i = 0; i < 60 && e.realms.here !== 'home'; i++) { e.pose.z += 0.2; await new Promise((r) => requestAnimationFrame(r)) } })
  await page.waitForFunction(() => globalThis.engine.portal.stats.steps.length === 2, null, { timeout: 60_000 })
  const back = await page.evaluate(() => globalThis.engine.portal.stats.steps[1])
  const worstBack = await page.evaluate(() => Math.max(...globalThis.gaps))
  const home = await page.evaluate(() => { const e = globalThis.engine; return { realm: e.realms.here, hour: e.look().hour, to: e.portal.to } })
  check(home.realm === 'home' && home.hour === null && home.to === 'dusk', `and back through it the page is at home again (${JSON.stringify(home)})`)
  console.log(`  the step back: everything made after ${back.whole.toFixed(0)} ms (${back.sectors} sectors made); the longest frame ${worstBack.toFixed(0)} ms; the window back ready after ${back.back.made.toFixed(0)} ms (${back.back.sectors} sectors)`)
  if (out) { await page.waitForTimeout(1000); await page.screenshot({ path: join(out, 'portal-home-again.png') }) }
} catch (e) { failures.push(`the check itself failed: ${e.stack ?? e}`) }
await browser.close()
server.kill()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('portal: ok')
