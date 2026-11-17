// A living thing that wears a look in finer cells (#245): the hand-written car with a look of 2.5 cm (`fineCar` in
// page/living.ts). In the page's own core: the look stands where the body is and goes with it, the body's own cells
// are not drawn, V puts the eye in the driver's seat and it stays there at speed, V again puts it behind; broken, the
// look goes and the pieces are drawn. In a shared world: the record says where the look's cells are kept, not the
// cells, and a page that joins later draws the look too. Real Chrome, the real server, nothing stubbed.
//
//   node test/fine-living.mjs [--out dir]     with --out: pictures from behind, from the side and from the seat
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { arg, serve, start, still } from './kit.mjs'

const out = arg('out', '') && resolve(arg('out', ''))
if (out) mkdirSync(out, { recursive: true })
const { browser, city, check, failures, finish } = await start()
const shot = async (page, name) => { if (!out) return; await page.waitForTimeout(400); await page.screenshot({ path: join(out, `${name}.png`) }) }
const tap = async (page, code) => { await page.keyboard.down(code); await page.waitForTimeout(80); await page.keyboard.up(code) }
// In the page: where the thing is, and its look and the eye as drawn, read just after a frame is drawn: the solver's
// answers come between frames, and one read between them finds the body a frame ahead of what was drawn with it.
const state = (page) => page.evaluate(async () => {
  await new Promise((r) => requestAnimationFrame(r))
  const e = globalThis.engine, t = e.alive.things.find((t) => t.alive), w = t && e.alive.where(t)
  if (!w) return null
  const look = e.alive.look(t), q = w.rot
  const turned = (q, v) => { const [x, y, z, s] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + s * tx + (y * tz - z * ty), v[1] + s * ty + (z * tx - x * tz), v[2] + s * tz + (x * ty - y * tx)] }
  const unturned = (v) => turned([-q[0], -q[1], -q[2], q[3]], v)
  // Each part's middle, and the eye, in the thing's own frame from its middle of mass: the same wherever it is if they ride on it.
  const parts = look.parts.map((p) => { const mid = turned(p.rot, p.size.map((s) => s / p.per / 2)); return { cell: p.cell, middle: unturned([p.pos[0] + mid[0] - w.at[0], p.pos[1] + mid[1] - w.at[1], p.pos[2] + mid[2] - w.at[2]]), turn: Math.abs(p.rot[0] * q[0] + p.rot[1] * q[1] + p.rot[2] * q[2] + p.rot[3] * q[3]) } })
  const eye = unturned([e.pose.x * 10 - w.at[0], e.pose.y * 10 - w.at[1], e.pose.z * 10 - w.at[2]])
  return { at: w.at, up: 1 - 2 * (q[0] ** 2 + q[2] ** 2), body: look.body, parts, eye, inside: e.alive.inside, tilted: !!e.pose.tilt, speed: t.state?.speed ?? 0, riding: !!e.alive.riding, bodies: e.bodies }
})
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
try {
  // ── The page's own core.
  const page = await city('fire=0&people=0', { size: [1280, 720], dpr: 1 })
  await still(page)
  const made = await page.evaluate(async () => {
    const e = globalThis.engine, x = 760, z = 4074, ground = Math.round(e.ground(x / 10, z / 10) * 10)
    const thing = await e.alive.spawn(e.fineCar([x, ground + 5, z]))
    e.pose.x = x / 10 - 2.2; e.pose.y = ground / 10 + 1.9; e.pose.z = z / 10 + 4.6; e.pose.yaw = 0.95; e.pose.pitch = -0.22
    return { id: thing.id, ground }
  })
  check(made.id > 0, `a car wearing a look of 2.5 cm cells is brought to life (body ${made.id})`)
  await page.waitForFunction(() => globalThis.engine.bodies === 0 && globalThis.engine.alive.things[0] && globalThis.engine.alive.where(globalThis.engine.alive.things[0]), null, { timeout: 20_000 })
  await page.waitForTimeout(300)
  const parked = await state(page)
  check(parked.parts.length === 1 && parked.parts[0].cell === 0.25 && parked.body === 0, `standing, its look is drawn at a quarter of a cell and its own cells are not drawn (look ${parked.parts[0]?.cell}, body ${parked.body})`)
  // The look's middle lies over the body's: within a cell across, its turn the body's.
  const m0 = parked.parts[0].middle
  check(Math.hypot(m0[0], m0[2]) < 1.5 && parked.parts[0].turn > 0.9999, `the look stands where the body is (its middle ${Math.hypot(m0[0], m0[2]).toFixed(2)} cells across from the body's, turned as it is)`)
  await shot(page, 'parked-side')
  // The shade under it (under.ts): what it costs the GPU, the march and the pieces drawn with it and without, turn about.
  const cost = await page.evaluate(async () => {
    const e = globalThis.engine, a = [], b = []
    for (let i = 0; i < 4; i++) { a.push(await e.paced(e.flags, false, false, true, false, false)); b.push(await e.paced(e.flags, false, false, true, false, true)) }
    const mid = (v) => v.sort((x, y) => x - y)[v.length >> 1]
    e.off.add('under')
    return { without: mid(a), with: mid(b) }
  })
  await shot(page, 'parked-side-no-shade')
  await page.evaluate(() => globalThis.engine.off.delete('under'))
  if (out) { await page.evaluate(() => { globalThis.engine.hour = 17.5 }); await shot(page, 'parked-side-evening'); await page.evaluate(() => { globalThis.engine.hour = null }) }
  // Said, and failed only when far out: beside other checks on the one GPU the two readings differ by more than the shade costs (0.04 to 0.2 ms alone).
  check(cost.with - cost.without < 3, `the shade under it costs ${(cost.with - cost.without).toFixed(3)} ms of the GPU's frame (${cost.without.toFixed(2)} without, ${cost.with.toFixed(2)} with)`)
  await page.evaluate(() => { const e = globalThis.engine, w = e.alive.where(e.alive.things[0]); e.pose.x = w.at[0] / 10 - 4.6; e.pose.y = w.at[1] / 10 + 1.4; e.pose.z = w.at[2] / 10 - 1.6; e.pose.yaw = 1.9; e.pose.pitch = -0.2 })
  await shot(page, 'parked-front')
  await page.evaluate(() => { const e = globalThis.engine, w = e.alive.where(e.alive.things[0]); e.pose.x = w.at[0] / 10 - 1.5; e.pose.y = w.at[1] / 10 + 1.5; e.pose.z = w.at[2] / 10 + 3.5 })
  await page.waitForFunction(() => globalThis.engine.alive.near, null, { timeout: 5000 }).catch(() => {})
  await tap(page, 'KeyE')
  await page.waitForFunction(() => globalThis.engine.alive.riding, null, { timeout: 5000 })
  const card = await page.evaluate(() => document.querySelector('#card').textContent)
  check(/V.*look from the seat/.test(card), `riding, the card says V looks from the seat ("${card}")`)
  await page.waitForTimeout(800)
  await shot(page, 'behind')
  const behind = await state(page)
  check(!behind.inside && behind.eye[1] > 10 && Math.hypot(behind.eye[0], behind.eye[2]) > 30, `the eye rides behind and above at first (${(Math.hypot(behind.eye[0], behind.eye[2]) / 10).toFixed(1)} m back)`)
  // V: in the seat.
  await tap(page, 'KeyV')
  await page.waitForTimeout(300)
  const seated = await state(page)
  const want = [19 - 21, 10, 5.5 - 9] // the car's eye from the middle of its 42 by 18 cells; its middle of mass is a little lower
  check(seated.inside && seated.tilted && Math.abs(seated.eye[0] - want[0]) < 1 && Math.abs(seated.eye[2] - want[2]) < 1 && seated.eye[1] > 3, `V puts the eye in the driver's seat (${seated.eye.map((v) => v.toFixed(1)).join(', ')} cells from its middle of mass), the frame turned with the car`)
  await shot(page, 'seat-ahead')
  await page.mouse.move(640, 360)
  await page.evaluate(() => { const e = globalThis.engine; e.pose.yaw += 0; })
  // Flat out from the seat: the eye stays where it was in the car, and the look stays on the body.
  const from = seated
  await page.keyboard.down('KeyW')
  let worstEye = 0, worstLook = 0, fastest = 0
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(125)
    const s = await state(page)
    worstEye = Math.max(worstEye, apart(s.eye, from.eye))
    worstLook = Math.max(worstLook, apart(s.parts[0].middle, m0))
    fastest = Math.max(fastest, Math.abs(s.speed))
    if (i === 12) await shot(page, 'seat-driving')
  }
  const driven = await state(page)
  await page.keyboard.up('KeyW')
  const went = Math.hypot(driven.at[0] - parked.at[0], driven.at[2] - parked.at[2])
  check(went > 40, `W from the seat drives it ${(went / 10).toFixed(1)} m, up to ${(fastest * 0.36).toFixed(0)} km/h`)
  check(worstEye < 0.6, `the eye stays in the seat at speed (it strays at most ${(worstEye * 10).toFixed(1)} cm in the car's own frame)`)
  check(worstLook < 0.6 && driven.parts[0].turn > 0.9999 && driven.body === 0, `the look goes with the body (${(worstLook * 10).toFixed(1)} cm at most from where it was on it), the body's own cells still not drawn`)
  // V again: behind.
  await tap(page, 'KeyV')
  await page.waitForTimeout(600)
  const back = await state(page)
  check(!back.inside && !back.tilted && Math.hypot(back.eye[0], back.eye[2]) > 20, 'V again puts the eye behind, the frame upright')
  await shot(page, 'behind-driving')
  await page.waitForFunction(() => globalThis.engine.bodies === 0, null, { timeout: 15_000 }).catch(() => {})
  await tap(page, 'KeyE')
  await page.waitForTimeout(300)
  // What a look may not be: cells that are no 16-bit kinds answer (no thing, or a thing with no look), and do not hang.
  const bad = await page.evaluate(async () => {
    const e = globalThis.engine, car = e.fineCar([900, Math.round(e.ground(90, 407.4) * 10) + 5, 4074])
    const t = await Promise.race([e.alive.spawn({ ...car, fine: [{ ...car.fine[0], cells: 'AAA' }] }), new Promise((r) => setTimeout(() => r('hung'), 8000))])
    const out = t === 'hung' ? { hung: true } : { hung: false, alive: t.alive, parts: e.alive.look(t).parts.length }
    if (t !== 'hung' && t.alive) e.alive.end?.(t)
    return out
  })
  check(!bad.hung && bad.parts === 0, `cells that are not 16-bit kinds make a thing with no look, and the making answers (${JSON.stringify(bad)})`)
  // Broken by a blast beside it: the look goes, and what it broke into is drawn as pieces are.
  const broke = await page.evaluate(async () => {
    const e = globalThis.engine, t = e.alive.things[0], w = e.alive.where(t), before = e.pieces()
    e.strike([Math.round(w.at[0]), Math.round(w.at[1]), Math.round(w.at[2])], 14)
    for (let i = 0; i < 60 && t.alive; i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 300))
    return { alive: t.alive, parts: e.alive.look(t).parts.length, before, after: e.pieces() }
  })
  check(!broke.alive && broke.parts === 0 && broke.after > 0, `a blast breaks it: the look is gone, and ${broke.after} pieces are drawn as they are`)
  await shot(page, 'broken')
  await page.context().close()

  // ── A shared world: the record keeps where the look's cells are, and a page that joins later draws it.
  const file = join(mkdtempSync(join(tmpdir(), 'engine-fine-living-')), 'world.log')
  const server = await serve('/dev/null', ['--world', file])
  try {
    const open = async (name) => {
      const context = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 })
      const p = await context.newPage()
      p.on('pageerror', (e) => failures.push(`page error (${name}): ${e.message}`))
      await p.goto(`${server.url}/city?fly=0&shared=1&fire=0&people=0&name=${name}`)
      await p.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
      await still(p)
      return p
    }
    const ada = await open('Ada')
    const ref = await ada.evaluate(async () => {
      const e = globalThis.engine, x = 760, z = 4074, ground = Math.round(e.ground(x / 10, z / 10) * 10)
      return (await e.alive.spawn(e.fineCar([x, ground + 5, z]))).ref
    })
    check(!!ref, `a page brings the car to life in a shared world (${ref})`)
    const record = (await (await fetch(`${server.url}/world/things`)).json()).find((t) => t.id === ref)
    const kept = record?.controls?.fine?.[0]?.kept
    const bytes = JSON.stringify(record?.controls ?? {}).length
    check(!!kept && bytes < 2048 && Array.isArray(record.controls.eye), `its record says where the look's cells are kept, not the cells (its controls are ${bytes} bytes; the look is 1.3 MB of cells)`)
    const cells = await fetch(`${server.url}/world/fine/${kept}`)
    check(cells.status === 200 && (await cells.arrayBuffer()).byteLength === 168 * 52 * 72 * 2, `and the world gives those cells to whoever asks (${cells.status}, gzipped on the way: ${cells.headers.get('content-encoding')})`)
    const ben = await open('Ben')
    await ben.waitForFunction(() => { const e = globalThis.engine, t = e.alive.things[0]; return t && e.alive.where(t) && e.alive.look(t).parts.some((p) => p.cell > 0) }, null, { timeout: 30_000 })
    await ben.waitForTimeout(500)
    const seen = await state(ben)
    check(seen.parts[0].cell === 0.25 && seen.body === 0 && Math.hypot(seen.parts[0].middle[0], seen.parts[0].middle[2]) < 1.5, `a page that joins later draws the look where the car is, and not its cells of 10 cm (look ${seen.parts[0].cell}, body ${seen.body})`)
    await ben.evaluate(() => { const e = globalThis.engine, w = e.alive.where(e.alive.things[0]); e.pose.x = w.at[0] / 10 - 2.2; e.pose.y = w.at[1] / 10 + 1.9; e.pose.z = w.at[2] / 10 + 4.6; e.pose.yaw = 0.95; e.pose.pitch = -0.22 })
    await shot(ben, 'shared-later-page')
    // Ben gets on and looks from the seat; Ada sees it go, still wearing its look.
    await ben.evaluate(() => { const e = globalThis.engine, w = e.alive.where(e.alive.things[0]); e.pose.x = w.at[0] / 10 - 1.5; e.pose.y = w.at[1] / 10 + 1.5; e.pose.z = w.at[2] / 10 + 3.5 })
    await ben.waitForFunction(() => globalThis.engine.alive.near, null, { timeout: 5000 })
    await tap(ben, 'KeyE')
    await ben.waitForFunction(() => globalThis.engine.alive.riding, null, { timeout: 5000 })
    await tap(ben, 'KeyV')
    const benFrom = await state(ben)
    await ben.keyboard.down('KeyW')
    await ben.waitForTimeout(1500)
    const benAt = await state(ben)
    await shot(ben, 'shared-seat-driving')
    await ben.keyboard.up('KeyW')
    const adaSees = await state(ada)
    check(benAt.inside && apart(benAt.eye, benFrom.eye) < 0.8 && Math.hypot(benAt.at[0] - benFrom.at[0], benAt.at[2] - benFrom.at[2]) > 20, `in the shared world the rider's eye is in the seat as it goes (${(apart(benAt.eye, benFrom.eye) * 10).toFixed(1)} cm astray)`)
    check(adaSees.parts[0]?.cell === 0.25 && adaSees.body === 0 && Math.hypot(adaSees.parts[0].middle[0], adaSees.parts[0].middle[2]) < 1.5, 'and the page that made it sees it go, wearing its look')
    await ada.context().close(); await ben.context().close()
  } finally { server.stop() }
} catch (e) {
  failures.push(String(e.stack ?? e))
}
await finish('fine-living')
