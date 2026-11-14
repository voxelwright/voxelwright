// A figure stands by its body's own up (#218, for #264). A rule that is no game makes the west down for whoever
// says so; a wall is put west of Ada, she falls onto its face and stands on it. Bea, at another page, must see
// her figure standing out from the wall: Ada's frame comes over the world's stream, and the figure drawn from it
// has its head east of its feet, not above them.
//
//   node test/upright.mjs [--out dir]
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, serve, still } from './kit.mjs'

const out = arg('out', '')
if (out) mkdirSync(out, { recursive: true })
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const server = await serve('/dev/null', ['--world', join(mkdtempSync(join(tmpdir(), 'engine-upright-')), 'world.log')])
const post = (path, body) => fetch(`${server.url}/world/${path}`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())
const browser = await chrome()
const open = async (name, x, z, walks) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&fire=0&people=0&shared=1&hour=10.5&scale=0.6&name=${name}`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await still(page)
  await page.evaluate(([x, z, walks]) => { const e = globalThis.engine; e.pose.x = x; e.pose.z = z; e.pose.y = e.ground(x, z) + 3; e.pose.yaw = -Math.PI / 2; e.pose.pitch = -0.1; if (walks) e.me.walk(true) }, [x, z, walks])
  if (walks) await page.waitForFunction(() => globalThis.engine.me.feet, null, { timeout: 10_000 })
  await page.waitForTimeout(1200)
  return page
}
/** How a page draws someone: what it was given of them, and where the middle of their figure's boxes is from their feet. */
const drawn = (page, name) => page.evaluate(async (name) => {
  const e = globalThis.engine, { figure } = await import('/page/people.ts')
  const view = { eye: [e.pose.x * 10, e.pose.y * 10, e.pose.z * 10], forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0], tanHalf: 1 }
  for (const from of e.folk.from) for (const p of from(view, performance.now() / 1000)) {
    if (name ? p.name !== name : p.name) continue
    const boxes = new Float32Array(20 * 200), n = figure(p, boxes, 0, p.at) / 20, mid = [0, 0, 0]
    for (let b = 0; b < n; b++) for (let a = 0; a < 3; a++) mid[a] += boxes[b * 20 + a] / n
    return { frame: p.frame ?? null, at: [...p.at], mid }
  }
  return null
}, name)

const RULE = `on('said', (world, e) => {
  if (/the west is down/.test(e.text)) world.person(e.by, {down: [-1, 0, 0]})
  if (/as it was/.test(e.text)) world.person(e.by, {down: null})
})`
try {
  const ada = await open('Ada', 76, 408.3, true), bea = await open('Bea', 76.6, 409.4, false)
  check((await post('ask', { by: 'tester', rule: { id: 'west', name: 'The west is down for whoever says so', source: RULE } })).asked, 'a rule that turns down for whoever asks is taken')
  const from = await ada.evaluate(() => globalThis.engine.me.feet.at)
  // A wall four metres high, two metres west of her.
  const w0 = Math.round(from[0]) - 40, wy = Math.round(from[1]) - 2, wall = []
  for (let y = wy; y < wy + 44; y++) for (let z = Math.round(from[2]) - 14; z < Math.round(from[2]) + 14; z++) wall.push(w0, w0 + 20, y, z, 8)
  await post('ask', { by: 'tester', edit: [1, wall.length / 5, ...wall], release: [w0 + 23, wy + 50, Math.round(from[2])] })
  await ada.waitForTimeout(800)
  const level = await drawn(bea, 'Ada')
  check(level && !level.frame && level.mid[1] > 6 && Math.abs(level.mid[0]) < 2, `standing on the street, Bea sees Ada upright: the middle of her figure ${level?.mid[1].toFixed(1)} cells over her feet`)
  if (out) { await bea.waitForTimeout(600); await bea.screenshot({ path: join(out, 'up-0-on-the-street.png') }) }

  await ada.evaluate(() => globalThis.engine.say('the west is down'))
  await ada.waitForFunction(() => globalThis.engine.me.can.down, null, { timeout: 8000 })
  // She falls west onto the wall's face and stands on it. (A step first: a body that stands still sleeps, and is not asked which way is down until it stirs.)
  await ada.keyboard.down('KeyW'); await ada.waitForTimeout(250); await ada.keyboard.up('KeyW')
  let stood = null
  for (let i = 0; i < 80 && !stood; i++) { await ada.waitForTimeout(100); const f = await ada.evaluate(() => globalThis.engine.me.feet); if (f.frame && f.speed < 1 && Math.abs(f.at[0] - (w0 + 21)) < 3) stood = f }
  check(!!stood, `said "the west is down", Ada falls onto the wall's face and stands on it (feet at x ${stood?.at[0].toFixed(1)}, the face at ${w0 + 21})`)
  await bea.waitForTimeout(700)
  const seen = await drawn(bea, 'Ada')
  const up = seen?.frame ? (([x, y, z, w]) => [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)])(seen.frame) : null
  check(up && up[0] > 0.98, `Bea is told Ada's own up: ${up?.map((v) => v.toFixed(2))} (east, out of the wall)`)
  check(seen && seen.mid[0] > 6 && Math.abs(seen.mid[1]) < 2 && Math.abs(seen.at[0] - (w0 + 21)) < 3, `and draws her standing out from the wall: the middle of her figure ${seen?.mid[0].toFixed(1)} cells east of her feet and ${seen?.mid[1].toFixed(1)} over them, feet on the face`)
  if (out) {
    await bea.evaluate(([x, y, z]) => { const e = globalThis.engine; Object.assign(e.pose, { x: (x + 30) / 10, y: (y + 10) / 10, z: (z + 45) / 10, yaw: -0.55, pitch: -0.05 }) }, seen.at)
    await bea.waitForTimeout(900); await bea.screenshot({ path: join(out, 'up-1-on-the-wall.png') })
  }
  // A seat or a plain client that says where it is with a frame is shown by it too; a bad one is no frame.
  await post('here', { by: 'cy', name: 'Cy', at: [from[0], from[1] + 16.5, from[2] + 30], yaw: 0, frame: [0, 0, 2, 2] })
  await post('here', { by: 'di', name: 'Di', at: [from[0], from[1] + 16.5, from[2] + 40], yaw: 0, frame: ['x', 0, 0, 1] })
  await bea.waitForTimeout(500)
  const cy = await drawn(bea, 'Cy'), di = await drawn(bea, 'Di')
  check(cy?.frame && Math.abs(Math.hypot(...cy.frame) - 1) < 0.01 && di && !di.frame, 'anyone who says where they are may say their up: it is made a unit turn, and one that is no turn is left out')

  await ada.evaluate(() => globalThis.engine.say('as it was'))
  await ada.waitForFunction(() => !globalThis.engine.me.can.down, null, { timeout: 8000 })
  await ada.keyboard.down('KeyW'); await ada.waitForTimeout(250); await ada.keyboard.up('KeyW')
  let back = null
  for (let i = 0; i < 60 && !back; i++) { await bea.waitForTimeout(150); const s = await drawn(bea, 'Ada'); if (s && !s.frame && s.mid[1] > 6) back = s }
  check(!!back, 'down put back, she is drawn upright again')
} catch (e) {
  failures.push(String(e.stack ?? e))
}
await browser.close()
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('upright: ok')
process.exit(0)
