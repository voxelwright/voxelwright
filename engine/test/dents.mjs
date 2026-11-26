// A car struck hard is dented where it was struck (#37, page/deform.ts): the fine car of `?living=finecar`, driven
// into a block of concrete by the real core in real Chrome. Its look takes a dent at the corner it struck, the
// driver's head room stays clear, the picture of that corner changes (read from the screen, against the same view
// repaired), repair makes it as it was made, and a car taken away leaves no dents behind for the next.
//
//   node test/dents.mjs [--out dir]     with --out: the struck corner, dented and repaired
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { arg, start, still } from './kit.mjs'

const out = arg('out', '') && resolve(arg('out', ''))
if (out) mkdirSync(out, { recursive: true })
const { city, check, finish } = await start()
const page = await city('fire=0&people=0&hour=11', { size: [1280, 720], dpr: 1 })
await still(page)
await page.evaluate(async () => {
  const e = globalThis.engine, x = 600, z = 4074, ground = Math.round(e.ground(x / 10, z / 10) * 10)
  globalThis.car = await e.alive.spawn(e.fineCar([x, ground + 5, z]))
})
await page.waitForFunction(() => globalThis.engine.bodies === 0 && globalThis.engine.alive.where(globalThis.car), null, { timeout: 20_000 })
const drive = async (go, ms) => { const end = Date.now() + ms; while (Date.now() < end) { await page.evaluate((go) => globalThis.engine.alive.drive(globalThis.car, go, 0, 0), go); await page.waitForTimeout(100) } }
// A block ahead and to its right: struck on its front corner at about 16 km/h.
const faces = await page.evaluate(() => {
  const e = globalThis.engine, w = e.alive.where(globalThis.car)
  for (let k = 0; k < 4; k++) e.set([Math.round(w.at[0]) + 75, Math.round(w.at[1]) + k * 6, Math.round(w.at[2]) + 9], 9, 7)
  return e.falling.faces
})
await page.waitForTimeout(1500)
// The picture's size held, so two pictures of one view differ only in what changed in it.
await page.evaluate(() => { globalThis.engine.scale = 0.75 })
check(await page.evaluate(() => globalThis.engine.alive.damage(globalThis.car) === null), 'a car never struck has no dents')
await drive(1, 2600); await drive(0, 1200); await drive(-1, 1100); await drive(0, 1500)
const struck = await page.evaluate(() => {
  const e = globalThis.engine, t = globalThis.car, d = e.alive.damage(t)
  if (!d) return null
  const dents = d.dents.slice(0, d.dentCount).map((x) => ({ center: [...x.center], radius: x.radius, depth: x.depth }))
  // The driver's eye in the look's own cells (its look is one part of 4 cells to the body's, from its low corner).
  const eye = t.eye.map((v) => v * 4), box = [...d.cabin]
  const outside = (p) => Math.hypot(Math.max(box[0] - p[0], 0, p[0] - box[3]), Math.max(box[1] - p[1], 0, p[1] - box[4]), Math.max(box[2] - p[2], 0, p[2] - box[5]))
  return { dents, hood: d.hoodDamage, scuff: d.scuff, eyeInside: outside(eye) === 0, clear: dents.every((x) => x.depth === 0 || x.radius + 1.18 * x.depth <= outside(x.center) + 1e-6), faces: e.falling.faces }
})
check(!!struck && struck.dents.some((x) => x.depth > 2), `struck at the corner, its look is dented (${JSON.stringify(struck?.dents.map((x) => [+x.depth.toFixed(1), +x.radius.toFixed(1)]))} fine cells deep and round)`)
check(!!struck && struck.scuff > 0, `its paint is scuffed there (${struck?.scuff.toFixed(2)})`)
check(!!struck && struck.eyeInside && struck.clear, 'the driver\'s eye is in the room kept clear, and no dent reaches into it')
check(!!struck && struck.faces > faces, `a dented look is drawn a cell at a time so that bent faces still meet (${faces} faces, ${struck?.faces} dented)`)
// The same view of the struck corner, dented and repaired, read from the screen.
const aim = () => page.evaluate(() => {
  const e = globalThis.engine, t = globalThis.car, p = e.alive.look(t).parts[0], d = e.alive.damage(t), k = d.dents.slice(0, d.dentCount).reduce((a, x, i) => (x.depth > d.dents[a].depth ? i : a), 0), dent = d.dents[k]
  const turn = (q, v) => { const [x, y, z, s] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + s * tx + (y * tz - z * ty), v[1] + s * ty + (z * tx - x * tz), v[2] + s * tz + (x * ty - y * tx)] }
  const c = turn(p.rot, [...dent.center].map((v) => v * p.cell)).map((v, i) => v + p.pos[i]), n = turn(p.rot, [...dent.dir]), a = Math.atan2(n[2], n[0]) + 0.5
  const cam = [c[0] - Math.cos(a) * 20, c[1] + 8, c[2] - Math.sin(a) * 20], v = [c[0] - cam[0], c[1] - cam[1], c[2] - cam[2]]
  e.pose.x = cam[0] / 10; e.pose.y = cam[1] / 10; e.pose.z = cam[2] / 10; e.pose.yaw = Math.atan2(v[0], -v[2]); e.pose.pitch = Math.atan2(v[1], Math.hypot(v[0], v[2]))
})
const clip = { x: 440, y: 210, width: 400, height: 300 }
const shoot = async (name) => { await page.waitForTimeout(700); const png = await page.screenshot({ clip }); if (out) await page.screenshot({ path: join(out, `${name}.png`) }); return png }
const differ = (a, b) => page.evaluate(async ([a, b]) => {
  const read = async (b64) => { const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()), c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext('2d'); g.drawImage(bitmap, 0, 0); return g.getImageData(0, 0, bitmap.width, bitmap.height).data }
  const x = await read(a), y = await read(b)
  let sum = 0
  for (let i = 0; i < x.length; i += 4) sum += (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])) / 3
  return sum / (x.length / 4)
}, [a.toString('base64'), b.toString('base64')])
await aim()
const dented = await shoot('dented')
const kept = await page.evaluate(() => { const d = globalThis.engine.alive.damage(globalThis.car); return d.dentCount })
await page.evaluate(() => globalThis.engine.alive.repair(globalThis.car))
const repaired = await shoot('repaired'), again = await shoot('repaired-again')
const change = await differ(dented, repaired), noise = await differ(repaired, again)
check(kept > 0 && change > Math.max(1.5, noise * 3), `the struck corner looks different dented (${change.toFixed(2)} levels a pixel on average from the same view repaired; ${noise.toFixed(2)} between two pictures of it repaired)`)
const mended = await page.evaluate(() => { const e = globalThis.engine, d = e.alive.damage(globalThis.car); return { dents: d.dentCount, hood: d.hoodDamage, scuff: d.scuff, faces: e.falling.faces } })
check(mended.dents === 0 && mended.hood === 0 && mended.scuff === 0 && mended.faces === faces, `repaired, it is as it was made and drawn from its own faces again (${JSON.stringify(mended)})`)
// Taken away, its dents go with it: a body's id may be another thing's later.
const gone = await page.evaluate(() => { const e = globalThis.engine, t = globalThis.car; e.alive.vanish(t); return e.alive.damage(t) })
check(gone === null, 'a car taken away leaves no dents behind')
await finish('dents')
