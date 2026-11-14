// Stepping between realms with no loading (#264): a page in one realm of a server is in another, and back, without
// being loaded again. The stream, the edits, the made things, the living things, the people and actors all become
// the other world's; one arrives where the realm says and it looks as the realm says; what the page then asks is
// done in the realm it is in and nowhere else. And how long a step takes, which is what a portal must hide.
//
//   node test/step.mjs [--out dir]     --out keeps a picture of each realm
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, here, still } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = join(tmpdir(), `engine-step-${process.pid}`), out = arg('out', '')
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
/** A thing of a few rows of brick with a record, as a helper would send it. */
const thing = (id, x, y, z) => ({ by: 'check', edit: [1, 3, x, x + 6, y, z, 8, x, x + 6, y + 1, z, 8, x, x + 6, y + 2, z, 8], release: [x, y, z], thing: { id, name: id, wish: 'a low wall', at: [x + 3, y, z], size: [6, 3, 1], facing: 'south' } })
/** The height of the first cell of air over the land at a place: the land slopes. */
const over = async (x, z) => (await get(`/world/at?x=${x}&y=0&z=${z}`)).ground + 1
const RULE = { id: 'greeter', name: 'Someone', source: 'on("start", (world) => world.actor("guide", {name: "Odile", at: [9670, 4009]}))\non("tick", (world) => { if (!world.people.some((p) => p.mine)) world.actor("guide", {name: "Odile", at: [9670, 4009]}) })' }
const browser = await chrome()
try {
  // Two realms unlike each other: home, where the town starts, with a wall and someone in a seat; and one 896 m east
  // at dawn, tinted, with a wall of its own, a rule's actor, someone else in a seat, and a history of a few hundred edits.
  const H = await over(690, 4040), D = await over(9660, 4040), P = await over(9700, 4070)
  await post('/world/ask', thing('home-wall', 690, H, 4040))
  check(await post('/world/join', { by: 'ada', at: [700, 4009] }) === 200, 'someone takes a seat at home')
  check(await post('/realms', { by: 'check', id: 'dawn', name: 'A grey dawn', about: 'the east end, early', arrive: { at: [9660, 4070], yaw: 0.3, pitch: -0.1 }, look: { hour: 6.4, rain: 0.2, grade: [0.5, 0.2], tint: [0.8, 1, 0.85] } }) === 201, 'a second realm is made: 896 m east, at dawn, tinted')
  await post('/realm/dawn/world/ask', thing('dawn-wall', 9660, D, 4040))
  for (let i = 0; i < 300; i++) { const x = 9460 + (i % 30) * 14, z = 4030 + Math.floor(i / 30) * 9; if (await post('/realm/dawn/world/ask', { by: 'check', edit: [0, x, D + 3, z, 2, i % 3 ? 8 : 7], release: [x, D + 3, z] }) === 429) { await wait(1000); i-- } }
  // The rule goes in once the world has done the rest: put while it was busy with these asks it was stopped as slow to start.
  await wait(3000)
  await post('/realm/dawn/world/ask', { by: 'check', rule: RULE })
  for (let i = 0; i < 40 && !(await get('/realm/dawn/world/rules'))[0]?.actors; i++) await wait(500)
  const sat = await post('/realm/dawn/world/join', { by: 'bo', at: [9650, 4009] }), ruled = (await get('/realm/dawn/world/rules'))[0]
  check(sat === 200 && ruled?.actors === 1, `in the other realm someone else takes a seat, and its rule has an actor (${sat}, ${JSON.stringify(ruled)})`)
  await wait(1500)

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  let loads = 0
  page.on('load', () => loads++)
  await page.goto(`${url}/city?fly=0&shared=1&fire=0&sound=0&name=Cy&living=car`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await still(page, { limit: 90_000 })
  await page.evaluate(() => { globalThis.sameDocument = true })
  await page.waitForFunction(() => globalThis.engine.alive.things.length === 1, null, { timeout: 30_000 })
  const seen = () => page.evaluate(() => { const e = globalThis.engine; return { realm: e.realms.here, things: [...e.things.all.keys()].filter((id) => !id.startsWith('living-') && e.things.all.get(id).name !== 'car'), living: e.alive.things.length, riding: !!e.alive.riding, others: e.others, pose: [e.pose.x, e.pose.y, e.pose.z].map(Math.round), yaw: e.pose.yaw, look: e.look(), edits: e.world.done().length, pieces: e.pieces(), search: location.search } })
  const kind = (at) => page.evaluate((c) => globalThis.engine.wand.kind(c[0], c[1], c[2]) & 15, at)
  const atHome = await seen()
  check(atHome.realm === 'home' && atHome.things.join() === 'home-wall' && atHome.others === 1 && atHome.look.hour === null, `at home the page knows home's wall and sees one other person (${JSON.stringify(atHome).slice(0, 140)})`)
  check(await kind([692, H + 1, 4040]) === 8 && await kind([9662, D + 1, 4040]) === 0, 'and its own core has home\'s wall and not the other realm\'s')
  if (out) await page.screenshot({ path: join(out, 'step-home.png') })

  // The step, taken while riding a living thing.
  await page.evaluate(() => globalThis.engine.alive.mount(globalThis.engine.alive.things[0]))
  check((await seen()).riding && atHome.living === 1, 'at home a car lives, and the page gets on it')
  const there = await page.evaluate(() => globalThis.engine.realms.step('dawn'))
  await still(page, { limit: 90_000 })
  await page.waitForTimeout(1200)
  const atDawn = await seen()
  check(await page.evaluate(() => globalThis.sameDocument === true) && loads === 1, 'the page stepped into the other realm without being loaded again')
  check(atDawn.realm === 'dawn' && atDawn.search.includes('realm=dawn') && !atDawn.search.includes('shared'), 'its address says where it now is')
  check(atDawn.pose[0] === 966 && atDawn.pose[2] === 407 && Math.abs(atDawn.yaw - 0.3) < 1e-6, `it arrived where the realm says one arrives, facing as it says (${atDawn.pose.join(', ')} m)`)
  check(Math.abs(atDawn.look.hour - 6.4) < 1e-6 && atDawn.look.rain === 0.2 && atDawn.look.tint[0] === 0.8 && atDawn.look.grade[0] === 0.5, `it looks as the realm says: the hour, the rain, the grade and the tint (${JSON.stringify(atDawn.look)})`)
  check(atDawn.things.join() === 'dawn-wall', `the made things it knows are the other realm's (${atDawn.things.join()})`)
  check(atDawn.living === 0 && !atDawn.riding && atDawn.pieces === 0, `the car that lives at home is not there: the page is off it, and no body of home's is drawn (${atDawn.living} living, ${atDawn.pieces} bodies)`)
  check(atDawn.others === 2, `the people it sees are the other realm's: someone in a seat and a rule's actor (${atDawn.others})`)
  check(atDawn.edits >= 301 && atDawn.edits < 3000, `the edits its sectors are made with are the other realm's alone (${atDawn.edits})`)
  check(await kind([9662, D + 1, 4040]) === 8 && await kind([692, H + 1, 4040]) === 0, 'its own core has the other realm\'s wall and has forgotten home\'s')
  const list = await get('/realms')
  check(list.realms.find((r) => r.id === 'home').pages === 0 && list.realms.find((r) => r.id === 'dawn').pages === 1, 'the server has it reading the other realm\'s stream and no longer home\'s')
  if (out) await page.screenshot({ path: join(out, 'step-dawn.png') })
  console.log(`  the step took ${there.ready.toFixed(0)} ms to read the realm's history (${there.edits} edits), ${there.went.toFixed(0)} ms to go over, ${there.shown.toFixed(0)} ms to a picture with every box whole over half its width, ${there.near.toFixed(0)} ms to a picture with the three nearest boxes whole, ${there.whole.toFixed(0)} ms to everything made (${there.sectors} sectors)`)

  // What it asks now is done there and nowhere else.
  await page.evaluate((y) => globalThis.engine.set([9700, y + 3, 4070], 3, 8), P)
  await wait(800)
  const [inDawn, inHome] = [await get(`/realm/dawn/world/at?x=9700&y=${P + 3}&z=4070`), await get(`/world/at?x=9700&y=${P + 3}&z=4070`)]
  check(inDawn.material === 8 && inHome.material === 0, 'brick the page puts down is in the realm it is in, and not at home')
  // A change to how the realm looks is shown at once.
  await post('/realm/dawn/world/ask', { by: 'check', realm: { look: { hour: 21 } } })
  await wait(500)
  const later = await seen()
  check(later.look.hour === 21 && later.look.tint[0] === 0.8, 'an ask that changes the realm\'s hour is shown by the page there, the rest of its look as it was')

  // On foot: the body walks on the cells of the realm it is in, not on those of the one it left.
  await page.evaluate(([x, y, z]) => { const e = globalThis.engine; e.alive.mount(null); Object.assign(e.pose, { x: x / 10, y: y / 10 + 3, z: z / 10, yaw: 0, pitch: -0.2 }); e.me.walk(true) }, [9700, P + 6, 4070])
  await page.waitForTimeout(2500)
  await page.waitForFunction(() => { const f = globalThis.engine.me.feet; return f && f.speed < 1 }, null, { timeout: 15_000 }).catch(() => {})
  const stood = await page.evaluate(() => globalThis.engine.me.feet?.at)
  check(stood && Math.abs(stood[1] - (P + 7)) <= 1.5, `on foot in the other realm the body stands on the brick that was put down there (feet at ${stood?.map((v) => v.toFixed(1))}, the brick's top at ${P + 7})`)
  // And back, to where it was left.
  const back = await page.evaluate((to) => globalThis.engine.realms.step('home', to), { x: 70, y: 17, z: 412, yaw: 0, pitch: -0.2 })
  await still(page, { limit: 90_000 })
  await page.waitForTimeout(1200)
  const again = await seen()
  check(again.realm === 'home' && again.things.join() === 'home-wall' && again.others === 1 && Math.abs(again.pose[0] - 70) <= 3 && loads === 1, `stepped back, it is at home with home's wall and home's people, still not loaded again (${JSON.stringify(again).slice(0, 120)})`)
  await page.waitForFunction(() => globalThis.engine.alive.things.length === 1, null, { timeout: 15_000 }).catch(() => {})
  check((await seen()).living === 1, 'the car that lives at home is there again')
  const walked = await page.evaluate(() => globalThis.engine.me.on)
  await page.waitForTimeout(2500)
  await page.waitForFunction(() => { const f = globalThis.engine.me.feet; return f && f.speed < 1 }, null, { timeout: 15_000 }).catch(() => {})
  const homeFeet = await page.evaluate(() => globalThis.engine.me.feet?.at)
  check(walked && homeFeet && Math.abs(homeFeet[1] - (await over(700, 4120))) <= 3, `having stepped on foot it is on foot at home, on home's ground (${homeFeet?.map((v) => v.toFixed(1))})`)
  await page.evaluate(() => globalThis.engine.me.walk(false))
  check(again.look.hour === null && again.look.rain === 0 && again.look.grade === null && again.look.tint[0] === 1, 'and home, which says nothing of how it looks, looks as the page did before')
  check(await kind([692, H + 1, 4040]) === 8 && await kind([9700, P + 3, 4070]) === 0, 'its core has home\'s cells again and none of the other realm\'s')
  console.log(`  the step back took ${back.ready.toFixed(0)} ms to read, ${back.shown.toFixed(0)} ms to every box half whole, ${back.near.toFixed(0)} ms to the near boxes whole, ${back.whole.toFixed(0)} ms to everything made (${back.sectors} sectors)`)

  // A step to a realm at the same place: only the sectors that either world's edits reach are made again.
  await post('/realms', { by: 'check', id: 'twin', name: 'The same street', arrive: { at: [700, 4070] } })
  await post('/realm/twin/world/ask', thing('twin-wall', 705, await over(705, 4050), 4050))
  await wait(300)
  await page.evaluate(() => globalThis.engine.realms.step('home', { x: 70, y: 17, z: 407, yaw: 0, pitch: -0.2 }))
  await still(page, { limit: 90_000 })
  const near = await page.evaluate(() => globalThis.engine.realms.step('twin', { x: 70, y: 17, z: 407, yaw: 0, pitch: -0.2 }))
  check(near.sectors < 400 && (await seen()).things.join() === 'twin-wall', `a step to a realm at the same place makes again only what the two worlds' edits reach (${near.sectors} sectors, ${near.whole.toFixed(0)} ms)`)
  // And to one that sleeps: its process starts as the step asks for its stream.
  await post('/realms', { by: 'check', id: 'asleep', name: 'Nobody has been here' })
  const woke = await page.evaluate(() => globalThis.engine.realms.step('asleep', { x: 70, y: 17, z: 407, yaw: 0, pitch: -0.2 }))
  console.log(`  a step in place to a realm that sleeps took ${woke.ready.toFixed(0)} ms to wake and read it, ${woke.whole.toFixed(0)} ms to everything made (${woke.sectors} sectors)`)
  console.log(`  a step in place took ${near.ready.toFixed(0)} ms to read, ${near.whole.toFixed(0)} ms to everything made (${near.sectors} sectors)`)
} catch (e) { failures.push(`the check itself failed: ${e.stack ?? e}`) }
await browser.close()
server.kill()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('step: ok')
