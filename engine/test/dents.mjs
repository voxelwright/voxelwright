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
  globalThis.car = await e.alive.spawn(e.car([x, ground + 5, z]))
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
check(await page.evaluate(() => globalThis.engine.alive.damage(globalThis.car) === null && globalThis.engine.alive.look(globalThis.car).parts.length === 1), 'a car() wears a fine look and has no dents before impact')
const wheelsBefore = await page.evaluate(() => [...(globalThis.engine.wheels.state.get(globalThis.car.id)?.wheels ?? [])].map((w) => ({ off: Math.hypot(...w.offset), tilt: w.tilt })))
check(wheelsBefore.length === 4 && wheelsBefore.every((w) => w.off === 0 && w.tilt === 0), 'undamaged wheels have zero deformation offset and tilt')
await drive(1, 2600); await drive(0, 1200); await drive(-1, 1100); await drive(0, 1500)
const struck = await page.evaluate(() => {
  const e = globalThis.engine, t = globalThis.car, d = e.alive.damage(t)
  if (!d) return null
  const dents = d.dents.slice(0, d.dentCount).map((x) => ({ center: [...x.center], radius: x.radius, depth: x.depth }))
  // The driver's eye in the look's own cells (its look is one part of 4 cells to the body's, from its low corner).
  const eye = t.eye.map((v) => v * 4), box = [...d.cabin]
  const outside = (p) => Math.hypot(Math.max(box[0] - p[0], 0, p[0] - box[3]), Math.max(box[1] - p[1], 0, p[1] - box[4]), Math.max(box[2] - p[2], 0, p[2] - box[5]))
  const wheels = [...(e.wheels.state.get(t.id)?.wheels ?? [])].map((w) => ({ offset: [...w.offset], mag: Math.hypot(...w.offset), tilt: w.tilt }))
  return { dents, hood: d.hoodDamage, scuff: d.scuff, eyeInside: outside(eye) === 0, clear: dents.every((x) => x.depth === 0 || x.radius + 1.18 * x.depth <= outside(x.center) + 1e-6), faces: e.falling.faces, wheels }
})
check(!!struck && struck.dents.some((x) => x.depth > 2), `struck at the corner, its look is dented (${JSON.stringify(struck?.dents.map((x) => [+x.depth.toFixed(1), +x.radius.toFixed(1)]))} fine cells deep and round)`)
check(!!struck && struck.scuff > 0, `its paint is scuffed there (${struck?.scuff.toFixed(2)})`)
check(!!struck && struck.eyeInside && struck.clear, 'the driver\'s eye is in the room kept clear, and no dent reaches into it')
check(!!struck && struck.faces > faces, `a dented look is drawn a cell at a time so that bent faces still meet (${faces} faces, ${struck?.faces} dented)`)
// #61: wheels near the crushed front-right corner move/bend with their dent, while the undamaged rear-left wheel stays put.
const fr = struck?.wheels?.[3], rl = struck?.wheels?.[0]
check(!!fr && !!rl && (fr.mag > 0.15 || fr.tilt > 0.02) && rl.mag < 0.05, `front-right wheel bends with its crushed corner (offset ${fr?.offset.map((v) => v.toFixed(2)).join(', ')}, tilt ${fr?.tilt.toFixed(3)} rad; rear-left ${rl?.mag.toFixed(2)})`)
// #61: per-window crack origins — striking the front windshield then the rear window keeps two distinct origins.
const crackCheck = await page.evaluate(() => {
  const e = globalThis.engine, t = globalThis.car, w = e.alive.where(t)
  const turn = (q, v) => { const [x, y, z, s] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + s * tx + (y * tz - z * ty), v[1] + s * ty + (z * tx - x * tz), v[2] + s * tz + (x * ty - y * tx)] }
  const atLocal = (v) => { const p = turn(w.rot, v); return [w.at[0] + p[0], w.at[1] + p[1], w.at[2] + p[2]] }
  e.alive.hit(t, atLocal([12, 5, 0]), turn(w.rot, [1, 0.3, 0]), 115, 9000)
  const first = e.alive.look(t).parts[0]?.cracks?.[0] ?? null
  e.alive.hit(t, atLocal([-14, 5, 0]), turn(w.rot, [-1, 0.3, 0]), 115, 9000)
  const both = e.alive.look(t).parts[0]?.cracks ?? null
  const dist = first && both?.[1] ? Math.hypot(both[0][0] - both[1][0], both[0][1] - both[1][1], both[0][2] - both[1][2]) : 0
  const stayed = first && both?.[0] ? Math.hypot(both[0][0] - first[0], both[0][1] - first[1], both[0][2] - first[2]) : Infinity
  return { first, both, dist, stayed }
})
check(!!crackCheck.first && !!crackCheck.both?.[1] && crackCheck.stayed === 0 && crackCheck.dist > 20, `per-window crack origins stay distinct (front ${crackCheck.both?.[0]?.map((v) => v.toFixed(0))}, rear ${crackCheck.both?.[1]?.map((v) => v.toFixed(0))}, apart ${crackCheck.dist.toFixed(1)} fine cells)`)
// The same view of the struck corner, dented and repaired via KeyF while riding, read from the screen.
const camPose = await page.evaluate(() => {
  const e = globalThis.engine, t = globalThis.car, p = e.alive.look(t).parts[0], d = e.alive.damage(t), k = d.dents.slice(0, d.dentCount).reduce((a, x, i) => (x.depth > d.dents[a].depth ? i : a), 0), dent = d.dents[k]
  const turn = (q, v) => { const [x, y, z, s] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + s * tx + (y * tz - z * ty), v[1] + s * ty + (z * tx - x * tz), v[2] + s * tz + (x * ty - y * tx)] }
  const c = turn(p.rot, [...dent.center].map((v) => v * p.cell)).map((v, i) => v + p.pos[i]), n = turn(p.rot, [...dent.dir]), a = Math.atan2(n[2], n[0]) + 0.5
  const cam = [c[0] - Math.cos(a) * 20, c[1] + 8, c[2] - Math.sin(a) * 20], v = [c[0] - cam[0], c[1] - cam[1], c[2] - cam[2]]
  return { x: cam[0] / 10, y: cam[1] / 10, z: cam[2] / 10, yaw: Math.atan2(v[0], -v[2]), pitch: Math.atan2(v[1], Math.hypot(v[0], v[2])) }
})
const aim = () => page.evaluate((p) => { Object.assign(globalThis.engine.pose, p) }, camPose)
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
// #61: repair key F is shown on the drive card and repairs the ridden car.
await page.evaluate(() => globalThis.engine.alive.mount(globalThis.car))
await page.waitForTimeout(150)
const card = await page.evaluate(() => document.querySelector('#card')?.textContent ?? '')
check(/F\s*repair/i.test(card), `drive card lists F repair ("${card}")`)
await page.keyboard.down('KeyF'); await page.waitForTimeout(80); await page.keyboard.up('KeyF')
await page.waitForTimeout(150)
await page.evaluate(() => globalThis.engine.alive.mount(null))
await aim()
const repaired = await shoot('repaired'), again = await shoot('repaired-again')
const change = await differ(dented, repaired), noise = await differ(repaired, again)
check(kept > 0 && change > Math.max(1.5, noise * 3), `the struck corner looks different dented (${change.toFixed(2)} levels a pixel on average from the same view repaired; ${noise.toFixed(2)} between two pictures of it repaired)`)
const mended = await page.evaluate(() => {
  const e = globalThis.engine, d = e.alive.damage(globalThis.car)
  const wheels = [...(e.wheels.state.get(globalThis.car.id)?.wheels ?? [])].map((w) => ({ off: Math.hypot(...w.offset), tilt: w.tilt }))
  return { dents: d.dentCount, hood: d.hoodDamage, scuff: d.scuff, cracks: e.alive.look(globalThis.car).parts[0]?.cracks ?? null, faces: e.falling.faces, wheels }
})
check(mended.dents === 0 && mended.hood === 0 && mended.scuff === 0 && mended.cracks === null && mended.faces === faces && mended.wheels.every((w) => w.off === 0 && w.tilt === 0), `KeyF repairs dents, cracks, faces and wheels (${JSON.stringify({ dents: mended.dents, hood: mended.hood, scuff: mended.scuff, cracks: mended.cracks, faces: mended.faces })})`)
// Taken away, its dents go with it: a body's id may be another thing's later.
const gone = await page.evaluate(() => { const e = globalThis.engine, t = globalThis.car; e.alive.vanish(t); return e.alive.damage(t) })
check(gone === null, 'a car taken away leaves no dents behind')
await finish('dents')
