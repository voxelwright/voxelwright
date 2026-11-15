// The portal in play (#264): a key opens a window to the selected realm before the person; it opens as the other
// place is made behind it and never shows it half made; the people there are seen through it; the person walks
// through on foot and is there, turns round and walks back; the key closes it. And what it costs: the time to
// open, the frames meanwhile and on the way through, the GPU's time for a window of each size.
//
//   node test/portal.mjs [--out dir] [--size 1280x720] [--clip] [--bench]
//     --out keeps pictures (and with --clip a film of opening, walking through and back); --bench prints the GPU table
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, film, here, still } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = join(tmpdir(), `engine-portal-${process.pid}`), out = arg('out', ''), [W, H] = arg('size', '1280x720').split('x').map(Number)
const clip = process.argv.includes('--clip'), bench = process.argv.includes('--bench')
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
  // The other realm: the like street seven blocks east, at dusk in rain, tinted, with brick stood about in it, someone
  // in a seat where one arrives and a rule's actor beside them.
  await post('/realms', { by: 'check', id: 'dusk', name: 'Dusk in the east', about: 'the east end, late', arrive: { at: [9660, 4070] }, look: { hour: 17.6, rain: 0.3, tint: [0.8, 1, 0.84] } })
  const D = await over(9660, 4040)
  // The brick stands up the street from where one arrives, with a way left clear down the middle.
  for (let i = 0; i < 200; i++) { const x = 9560 + (i % 20) * 11 + ((i % 20) >= 10 ? 60 : -60), z = 3996 + Math.floor(i / 20) * 5; if (await post('/realm/dusk/world/ask', { by: 'check', edit: [0, x, D + 1, z, 2, i % 3 ? 8 : 7], release: [x, D + 1, z] }) === 429) { await wait(1000); i-- } }
  await wait(2500)
  await post('/realm/dusk/world/ask', { by: 'check', rule: { id: 'greeter', name: 'Someone', source: 'on("start", (world) => world.actor("guide", {name: "Odile", at: [9672, 4052]}))\non("tick", (world) => { if (!world.people.some((p) => p.mine)) world.actor("guide", {name: "Odile", at: [9672, 4052]}) })' } })
  // And a rule there that gives everyone at a page a faster pace and a coat: what a realm of powers does.
  await post('/realm/dusk/world/ask', { by: 'check', rule: { id: 'powers', name: 'Powers', source: 'on("tick", (world) => { for (const p of world.people) if (p.kind === "page") world.person(p.id, {pace: 60, look: {coat: "#101010"}}) })' } })
  check(await post('/realm/dusk/world/join', { by: 'bo', at: [9650, 4050] }) === 200 && await post('/realm/dusk/world/join', { by: 'nia', at: [9662, 4100] }) === 200, 'two people have seats in the other realm: one past where one arrives, one three metres short of it')
  // They stay: a seat nobody asks anything of goes after three minutes.
  const keep = setInterval(() => { void get('/realm/dusk/world/me?by=bo').catch(() => {}); void get('/realm/dusk/world/me?by=nia').catch(() => {}) }, 20_000)

  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  page error: ${m.text().slice(0, 300)}`) })
  await page.goto(`${url}/city?fly=0&shared=1&fire=0&sound=0&name=Cy&at=70,17.2,412.5&look=0,-4&portalkeeps=3${arg('workers', '') ? `&portalworkers=${arg('workers', '')}` : ''}`)
  await page.waitForFunction(() => globalThis.engine?.portal, null, { timeout: 90_000 })
  await still(page, { limit: 90_000 })
  await page.evaluate(() => { globalThis.sameDocument = true; globalThis.engine.realms.selected = 'dusk' })
  const state = () => page.evaluate(() => { const e = globalThis.engine, p = e.portal; return { ...p.state, gate: p.gate && { at: p.gate.at, to: p.gate.to }, to: p.to, realm: e.realms.here, afoot: e.me.on, feet: e.me.feet?.at ?? null, hour: e.look().hour, rain: e.rain, fly: e.me.can.fly ?? 0, pace: e.me.can.pace ?? 0, coat: e.me.limbs.look?.coat ?? '', others: e.others, same: globalThis.sameDocument === true, undrawn: e.march.sun.undrawn, scale: p.stats.scale, share: p.stats.share, fps: Math.round(1000 / e.frameMs) } })
  const gaps = () => page.evaluate(() => { globalThis.gaps = []; let last = performance.now(); const tick = (now) => { globalThis.gaps.push(now - last); last = now; if (globalThis.gaps.length < 3000) requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  const worst = () => page.evaluate(() => { const g = globalThis.gaps.slice().sort((a, b) => a - b); globalThis.gaps.length = 3000; return { worst: g.at(-1) ?? 0, p95: g[Math.floor(g.length * 0.95)] ?? 0, frames: g.length } })
  // On foot in the home street, facing up it.
  await page.evaluate(() => globalThis.engine.me.walk(true))
  await page.waitForFunction(() => { const f = globalThis.engine.me.feet; return f && f.speed < 1 }, null, { timeout: 15_000 })
  await page.waitForTimeout(600)
  await page.evaluate(() => { globalThis.ownPace = globalThis.engine.me.can.pace ?? 0 })
  if (out) await page.screenshot({ path: join(out, 'play-1-before.png') })

  const run = async () => {
    // The key.
    await gaps()
    await page.keyboard.press('KeyP')
    await page.waitForFunction(() => globalThis.engine.portal.gate, null, { timeout: 10_000 })
    const early = await state()
    let veiled = null
    if (out) { await page.waitForTimeout(450); veiled = await state(); await page.screenshot({ path: join(out, 'play-2-opening.png') }) }
    await page.waitForFunction(() => globalThis.engine.portal.state.passable && globalThis.engine.portal.state.open >= 1, null, { timeout: 60_000 })
    await page.waitForFunction(() => globalThis.engine.portal.stats.opened, null, { timeout: 60_000 })
    const opened = await page.evaluate(() => globalThis.engine.portal.stats.opened), opening = await worst(), ready = await state()
    check(early.gate && early.veil === 1 && early.open < 0.5, `the key stands a window before the person, small and all light to begin with (open ${early.open.toFixed(2)}, light ${early.veil})`)
    const ahead = Math.hypot(ready.gate.at[0] - ready.feet[0], ready.gate.at[2] - ready.feet[2])
    check(ahead > 30 && ahead < 110 && Math.abs(ready.gate.at[1] - 20 - ready.feet[1]) < 12, `it stands on the ground ${(ahead / 10).toFixed(1)} m before them`)
    check(ready.gate.to[0] === 9660 && ready.gate.to[2] === 4070, 'and leads to where the realm says one arrives')
    check(ready.open === 1 && ready.veil === 0, 'once the place behind it is made it is full size and clear')
    console.log(`  opening: the window was clear and could be walked through ${opened.clear.toFixed(0)} ms after the key (${opened.ready.toFixed(0)} ms to read the realm, ${opened.built.toFixed(0)} ms once for the second world's store, marcher and people, a whole picture of the place after ${opened.shown.toFixed(0)} ms); all of it was made after ${opened.made.toFixed(0)} ms (${opened.sectors} sectors, ${opened.poolMb.toFixed(0)} MB of trees)`)
    console.log(`  while it opened: ${opening.frames} frames, the longest ${opening.worst.toFixed(0)} ms, 95 in 100 within ${opening.p95.toFixed(0)} ms`)
    await page.waitForTimeout(1200)
    const seen = await state()
    check(seen.people === 2 && seen.there === 3 && seen.drawn >= 2, `the people of the other realm past the window are drawn behind it: someone in a seat and a rule's actor; the one who stands short of it, between that eye and the window, is not (${seen.people} of ${seen.there}; ${seen.drawn} drawn with the residents in sight)`)
    console.log(`  the window is ${(seen.share * 100).toFixed(0)}% of the picture from where they stand, drawn at ${seen.scale} of its pixels each way; ${seen.fps} frames a second`)
    check(seen.rain === 0, `it rains in the other realm and not at home, where the window stands (${seen.rain})`)
    if (out) await page.screenshot({ path: join(out, 'play-3-open.png') })

    // Through it, on foot.
    await gaps()
    await page.keyboard.down('KeyW')
    await page.waitForFunction(() => globalThis.engine.realms.here === 'dusk', null, { timeout: 30_000 })
    await page.waitForFunction(() => globalThis.engine.portal.stats.steps.length >= 1 && globalThis.engine.portal.gate, null, { timeout: 30_000 })
    await page.waitForTimeout(900)
    await page.keyboard.up('KeyW')
    await page.waitForFunction(() => globalThis.engine.me.limbs.look?.coat, null, { timeout: 10_000 }).catch(() => {})
    const through = await page.evaluate(() => globalThis.engine.portal.stats.steps.at(-1)), stepGaps = await worst(), there = await state()
    check(there.realm === 'dusk' && there.same && there.afoot && Math.abs(there.hour - 17.6) < 1e-6 && there.to === 'home', `walked through, the person is in the other realm on their feet, the page not loaded again, and the window leads back (${JSON.stringify({ realm: there.realm, afoot: there.afoot, to: there.to })})`)
    check(there.feet && Math.abs(there.feet[0] - 9660) < 20 && there.feet[2] < 4070, `they are just past where the realm says one arrives, as far past the window there as they were here (feet at ${there.feet?.map(Math.round)})`)
    check(there.undrawn < 40, `the sun's maps came with the world: ${there.undrawn} tiles to draw, not all of them`)
    console.log(`  the step through: ${through.ready.toFixed(0)} ms to read, ${through.went.toFixed(0)} ms to go over, everything made after ${through.whole.toFixed(0)} ms (${through.sectors} sectors); while walking up, through and on, ${stepGaps.frames} frames, the longest ${stepGaps.worst.toFixed(0)} ms, 95 in 100 within ${stepGaps.p95.toFixed(0)} ms; ${there.fps} frames a second after`)
    if (out) await page.screenshot({ path: join(out, 'play-4-there.png') })

    // Turned round, and back through the same window.
    await page.evaluate(() => { globalThis.engine.pose.yaw += Math.PI })
    await page.waitForTimeout(1200)
    if (out) await page.screenshot({ path: join(out, 'play-5-looking-back.png') })
    await gaps()
    await page.keyboard.down('KeyW')
    await page.waitForFunction(() => globalThis.engine.realms.here === 'home', null, { timeout: 30_000 })
    await page.waitForFunction(() => globalThis.engine.portal.stats.steps.length >= 2 && globalThis.engine.portal.gate, null, { timeout: 30_000 })
    await page.waitForTimeout(900)
    await page.keyboard.up('KeyW')
    const back = await page.evaluate(() => globalThis.engine.portal.stats.steps.at(-1)), backGaps = await worst(), home = await state()
    const own = await page.evaluate(() => globalThis.ownPace)
    await page.waitForTimeout(1500)
    const homeLater = await state()
    check(there.pace === 60 && there.coat === '#101010' && home.pace === own && home.coat === '' && homeLater.pace === own && homeLater.coat === '', `what the realm's rule gave the body (pace ${there.pace}, a coat ${there.coat}) is the realm's: walked back home the body is its own (pace ${home.pace}, coat "${home.coat}"), and still 1.5 s later (pace ${homeLater.pace}, coat "${homeLater.coat}")`)
    check(home.rain === 0 && there.rain === 0.3, `in the other realm it rained, and back at home it does not (${there.rain}, then ${home.rain})`)
    check(home.realm === 'home' && home.hour === null && home.afoot && home.to === 'dusk' && home.same, `turned round and walked back through the same window, they are at home on their feet (${JSON.stringify({ realm: home.realm, afoot: home.afoot, to: home.to })})`)
    console.log(`  the step back: everything made after ${back.whole.toFixed(0)} ms (${back.sectors} sectors); the longest frame ${backGaps.worst.toFixed(0)} ms, 95 in 100 within ${backGaps.p95.toFixed(0)} ms; ${home.fps} frames a second after`)
    // The key closes it.
    await page.evaluate(() => { globalThis.engine.pose.yaw += Math.PI })
    await page.waitForTimeout(800)
    if (out) await page.screenshot({ path: join(out, 'play-6-home-again.png') })
    await page.keyboard.press('KeyP')
    await page.waitForTimeout(700)
    check((await state()).gate === null, 'the key again, and the window is closed')
  }
  if (clip && out) {
    const f = await film(page, 1, run)
    writeFileSync(join(out, 'portal-play.webm'), f.webm)
    console.log(`  filmed ${f.seconds.toFixed(0)} s: ${f.frames} frames, half within ${f.p50.toFixed(0)} ms, 95 in 100 within ${f.p95.toFixed(0)} ms, the longest ${f.worst.toFixed(0)} ms`)
  } else await run()

  // Opened again: the other place is still held, so it is there in the time the window takes to grow.
  await page.waitForTimeout(500)
  const t1 = Date.now()
  await page.keyboard.press('KeyP')
  await page.waitForFunction(() => globalThis.engine.portal.state.passable && globalThis.engine.portal.state.open >= 1, null, { timeout: 60_000 })
  console.log(`  opened again, it could be walked through after ${Date.now() - t1} ms`)
  check(Date.now() - t1 < 1500, 'a window opened again to a place still held opens in under a second and a half')
  // Closed and left for a while, it lets go of the other realm's stream, so that realm can rest; opened again it is there all the same.
  await page.keyboard.press('KeyP')
  await page.waitForFunction(() => globalThis.engine.portal.stats.released, null, { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(400)
  const let_ = { released: await page.evaluate(() => globalThis.engine.portal.stats.released), pages: (await get('/realms')).realms.find((r) => r.id === 'dusk').pages }
  check(let_.released && let_.pages === 0, `a window left closed lets go of the other realm's stream: the server has nobody reading that realm (${JSON.stringify(let_)})`)
  const t2 = Date.now()
  await page.keyboard.press('KeyP')
  await page.waitForFunction(() => globalThis.engine.portal.state.passable && globalThis.engine.portal.state.open >= 1, null, { timeout: 60_000 })
  check(Date.now() - t2 < 2500, `and opened again after that it can be walked through after ${Date.now() - t2} ms: its sectors were still held`)
  // With a wall across the way three metres ahead, the window stands where the walk to it is clear, not behind the wall.
  await page.keyboard.press('KeyP')
  await page.waitForFunction(() => !globalThis.engine.portal.gate, null, { timeout: 5000 })
  const me = await page.evaluate(() => { const e = globalThis.engine; e.pose.yaw = 0; return e.me.feet.at.map(Math.round) })
  const wall = []
  // From a little under the ground up and six cells thick, so that it stands (one cell thick, it sometimes went over before the key was pressed).
  for (let up = -2; up <= 22; up++) for (let deep = 28; deep <= 33; deep++) wall.push(me[0] - 40, me[0] + 41, me[1] + up, me[2] - deep, 8)
  const walled = await post('/world/ask', { by: 'check', edit: [1, wall.length / 5, ...wall], release: [me[0], me[1] + 1, me[2] - 28] })
  await page.waitForTimeout(1500)
  check(walled === 202 && await page.evaluate(([x, y, z]) => (globalThis.engine.wand.kind(x, y, z) & 15) === 8, [me[0], me[1] + 10, me[2] - 28]), 'a wall of brick is put across the way, and the page knows of it')
  await page.keyboard.press('KeyP')
  await page.waitForFunction(() => globalThis.engine.portal.gate, null, { timeout: 10_000 })
  const stood = await page.evaluate(() => globalThis.engine.portal.gate.at)
  const still_ = await page.evaluate(([x, y, z]) => (globalThis.engine.wand.kind(x, y, z) & 15) === 8, [me[0], me[1] + 10, me[2] - 28])
  // The walk: nothing at the height of a body's middle along the straight line from the person to the window.
  const walk = await page.evaluate(([from, to]) => { let met = 0; for (let i = 3; i < 100; i++) { const t = i / 100; if (globalThis.engine.wand.kind(Math.round(from[0] + (to[0] - from[0]) * t), from[1] + 9, Math.round(from[2] + (to[2] - from[2]) * t))) met++ } return met }, [me, stood])
  check(still_ && walk === 0, `with a wall three metres ahead the window stands where the walk to it is clear (nothing met on the way; ${Math.round(me[0] - stood[0])} cells across, ${Math.round(me[2] - stood[2])} ahead; the wall is 28 ahead)`)
  if (out) { await page.waitForFunction(() => globalThis.engine.portal.state.passable && globalThis.engine.portal.state.open >= 1, null, { timeout: 60_000 }).catch(() => {}); await page.waitForTimeout(600); await page.screenshot({ path: join(out, 'play-6b-wall.png') }) }
  // Hemmed in: walls two metres to each side and behind, the wall still ahead, and a planter two metres before them,
  // half a metre high. Nowhere three metres off can be walked to: the window stands nearer, short of the planter,
  // not past it, and they walk into it.
  await page.keyboard.press('KeyP')
  await page.waitForFunction(() => !globalThis.engine.portal.gate, null, { timeout: 5000 })
  const [X, Y, Z] = me, box = (x0, x1, y0, y1, z0, z1) => { const c = []; for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) c.push(x0, x1, y, z, 8); return c }
  const nook = [...box(X - 22, X - 18, Y - 2, Y + 22, Z - 27, Z + 22), ...box(X + 18, X + 22, Y - 2, Y + 22, Z - 27, Z + 22), ...box(X - 17, X + 17, Y - 2, Y + 22, Z + 18, Z + 22), ...box(X - 17, X + 17, Y - 2, Y + 6, Z - 23, Z - 18)]
  const nooked = await post('/world/ask', { by: 'check', edit: [1, nook.length / 5, ...nook], release: [X, Y + 1, Z] })
  const planted = await page.waitForFunction(([x, y, z]) => (globalThis.engine.wand.kind(x, y, z) & 15) === 8 && (globalThis.engine.wand.kind(x + 20, y, z) & 15) === 8, [X, Y + 4, Z - 20], { timeout: 10_000 }).then(() => true, () => false)
  await page.waitForTimeout(800)
  await page.evaluate(() => { globalThis.engine.pose.yaw = 0 })
  await page.keyboard.press('KeyP')
  await page.waitForFunction(() => globalThis.engine.portal.gate, null, { timeout: 10_000 })
  const nookGate = await page.evaluate(() => globalThis.engine.portal.gate.at), nookFeet = await page.evaluate(() => globalThis.engine.me.feet.at.map(Math.round))
  // The walk, from the shins to over the head, along the straight line from the feet to the window.
  const nookWalk = await page.evaluate(([from, to]) => { let met = 0; for (let i = 3; i < 100; i++) { const t = i / 100; for (let up = 3; up <= 18; up += 3) if (globalThis.engine.wand.kind(Math.round(from[0] + (to[0] - from[0]) * t), from[1] + up, Math.round(from[2] + (to[2] - from[2]) * t))) { met++; break } } return met }, [nookFeet, nookGate])
  // (Straight ahead, nearer than the planter, the street's kerb is in its frame: it may stand to one side in the nook.)
  check(nooked === 202 && planted && nookWalk === 0 && Z - nookGate[2] < 18 && Math.abs(nookGate[0] - X) < 18 && nookGate[2] - Z < 18 && Math.hypot(nookGate[0] - X, nookGate[2] - Z) > 8, `hemmed in, with a planter two metres ahead, the window stands in the nook short of the planter where the walk to it is clear (${Math.round(X - nookGate[0])} cells across, ${Math.round(Z - nookGate[2])} ahead, ${nookWalk} points of the walk met something; the planter is 18 ahead, the walls 18 to each side)`)
  const nookSteps = await page.evaluate(() => globalThis.engine.portal.stats.steps.length)
  await page.waitForFunction(() => globalThis.engine.portal.state.passable, null, { timeout: 60_000 }).catch(() => {})
  // Turned to it, and on.
  await page.evaluate(([x, z]) => { const e = globalThis.engine, f = e.me.feet.at; e.pose.yaw = Math.atan2(x - f[0], -(z - f[2])) }, [nookGate[0], nookGate[2]])
  if (out) { await page.waitForFunction(() => globalThis.engine.portal.state.passable && globalThis.engine.portal.state.open >= 1, null, { timeout: 60_000 }).catch(() => {}); await page.waitForTimeout(600); await page.screenshot({ path: join(out, 'play-7-nook.png') }) }
  await page.keyboard.down('KeyW')
  const walkedIn = await page.waitForFunction((n) => globalThis.engine.portal.stats.steps.length > n && globalThis.engine.realms.here === 'dusk', nookSteps, { timeout: 30_000 }).then(() => true, () => false)
  await page.waitForTimeout(900)
  await page.keyboard.up('KeyW')
  check(walkedIn, 'and walking ahead, they go through it into the other realm')
  // (Had they not, they are put through, so that what follows is seen all the same.)
  if (!walkedIn) { await page.evaluate(() => globalThis.engine.portal.step()); await page.waitForFunction(() => globalThis.engine.realms.here === 'dusk' && globalThis.engine.portal.gate, null, { timeout: 30_000 }) }
  // In the realm, one press of the key is a way home: the window they came by stands before them, still leading home.
  await page.waitForTimeout(600)
  await page.keyboard.press('KeyP')
  await page.waitForTimeout(800)
  const homeway = await page.evaluate(() => { const e = globalThis.engine, p = e.portal, f = e.me.feet?.at, g = p.gate; return { realm: e.realms.here, to: p.to, passable: p.state.passable, ahead: g && f ? (g.at[0] - f[0]) * Math.sin(e.pose.yaw) - (g.at[2] - f[2]) * Math.cos(e.pose.yaw) : null, off: g && f ? Math.hypot(g.at[0] - f[0], g.at[2] - f[2]) : null } })
  check(homeway.realm === 'dusk' && homeway.to === 'home' && homeway.passable && homeway.ahead > 8 && homeway.off < 75, `in the realm, one press of the key and a window home stands before them (${JSON.stringify(homeway)})`)
  // The key again closes it, and once more opens one home.
  await page.keyboard.press('KeyP')
  await page.waitForTimeout(700)
  const shut = await page.evaluate(() => globalThis.engine.portal.gate === null)
  await page.keyboard.press('KeyP')
  const reopened = await page.waitForFunction(() => globalThis.engine.portal.gate && globalThis.engine.portal.to === 'home' && globalThis.engine.portal.state.passable && globalThis.engine.portal.state.open >= 1, null, { timeout: 30_000 }).then(() => true, () => false)
  check(shut && reopened, `the key again closes it (${shut}), and once more opens a window home (${reopened})`)
  const homeSteps = await page.evaluate(() => globalThis.engine.portal.stats.steps.length)
  await page.keyboard.down('KeyW')
  const wentHome = await page.waitForFunction((n) => globalThis.engine.portal.stats.steps.length > n && globalThis.engine.realms.here === 'home', homeSteps, { timeout: 30_000 }).then(() => true, () => false)
  await page.waitForTimeout(900)
  await page.keyboard.up('KeyW')
  check(wentHome, 'and walking ahead, they are home')
  const memory = await page.evaluate(() => globalThis.engine.portal.memory)
  console.log(`  the second world takes ${memory.pool.toFixed(0)} MB of the GPU for its trees and boxes, ${memory.sun.toFixed(0)} MB for its sun's maps, ${memory.picture.toFixed(0)} MB for the window's pictures`)
  if (bench) {
    await page.evaluate(() => globalThis.engine.me.walk(false))
    const table = await page.evaluate(() => { const e = globalThis.engine, c = document.querySelector('canvas'); return e.portal.bench(e.view(), e.flags, [c.width, c.height]) })
    console.log(`  the GPU, ms a frame at ${W} x ${H} (the canvas's own pixels) at its own pace:`)
    for (const [k, v] of Object.entries(table)) console.log(`    ${k.padEnd(22)} ${v.toFixed(2)}`)
  }
  clearInterval(keep)
} catch (e) { failures.push(`the check itself failed: ${e.stack ?? e}`) }
await browser.close()
server.kill()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('portal: ok')
