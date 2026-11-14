// Blows (#264, the bodies lane): real Chrome, the real server, nothing stubbed. The rule is no game: someone who
// throws a ball at whoever asks, and says aloud what was struck by what. A person at a page is struck by a thrown
// ball and thrown by it, the rule hears whom, by what, from whom and how fast; an actor is struck too and only its
// own rule hears; a rule pushes someone and puts them on the ground; a car driven into someone is a blow by a thing;
// what is out of range is refused. The rule counts the blows itself: the engine has no word for health.
//
//   node test/blows.mjs [--out dir]
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
const server = await serve('/dev/null', ['--world', join(mkdtempSync(join(tmpdir(), 'engine-blows-')), 'world.log')])
const post = (path, body) => fetch(`${server.url}/world/${path}`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())
const open = async (name, x, z, yaw) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&fire=0&people=0&shared=1&name=${name}`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await still(page)
  await page.evaluate(([x, z, yaw]) => { const e = globalThis.engine; e.pose.x = x; e.pose.z = z; e.pose.y = e.ground(x, z) + 3; e.pose.yaw = yaw; e.pose.pitch = -0.15; e.me.walk(true) }, [x, z, yaw])
  await page.waitForFunction(() => globalThis.engine.me.feet, null, { timeout: 10_000 })
  await page.waitForTimeout(1500)
  return page
}
const feet = (page) => page.evaluate(() => globalThis.engine.me.feet.at)
/** What the watcher has heard said since it last asked. */
let since = 0
const heard = async () => { const a = await (await fetch(`${server.url}/world/around?by=watcher&since=${since}`)).json(); since = a.heard_up_to; return a.heard.map((h) => h.text) }
const until = async (what, test, tries = 40) => { let all = []; for (let i = 0; i < tries; i++) { all = all.concat(await heard()); const found = all.find(test); if (found) { if (process.env.DEBUG) console.log('   heard:', JSON.stringify(all)); return found } await new Promise((r) => setTimeout(r, 250)) } console.log(`  (heard while waiting for ${what}: ${JSON.stringify(all)})`); return null }
const RULE = `on('start', (world) => { world.actor('pitcher', {name: 'Pitcher', at: [820, 4083]}); world.actor('post', {name: 'Post', at: [820, 4050]}); world.keep.hits = 0 })
on('said', (world, e) => {
  if (/throw at me/.test(e.text)) world.throw({from: 'pitcher', at: e.by, speed: 250, size: 2, material: 'wood'})
  if (/throw at the post/.test(e.text)) world.throw({from: 'pitcher', at: 'post', speed: 250, size: 2, material: 'wood'})
  if (/push me/.test(e.text)) world.push(e.by, {to: [0, 0.4, 1], speed: 90})
  if (/down/.test(e.text)) world.down(e.by, {for: 2.5})
  if (/lob/.test(e.text)) world.throw({from: 'pitcher', to: [1, 0.35, 0], speed: 110, material: 'steel', tag: 'lob'})
  const where = /burn (-?[0-9]+) (-?[0-9]+) (-?[0-9]+)/.exec(e.text)
  if (where) world.ignite({at: [Number(where[1]), Number(where[2]), Number(where[3])], radius: 2})
  if (/too wide/.test(e.text)) world.blast({at: [800, 170, 4083], radius: 99})
  if (/too hard/.test(e.text)) world.throw({from: 'pitcher', at: e.by, speed: 9999})
})
on('landed', (world, e) => {
  world.actor('pitcher', {say: 'landed ' + (e.tag || '') + ' on ' + e.met + ' at ' + e.at.join(' ') + ' going ' + e.speed + (e.from ? ' from ' + e.from.id : '')})
  if (e.tag === 'lob') world.blast({at: e.at, radius: 6})
})
on('struck', (world, e) => {
  world.keep.hits += 1
  world.actor('pitcher', {say: 'struck ' + e.whom.name + (e.whom.mine ? ' (mine)' : '') + ' by ' + e.by.kind + ' ' + (e.by.material || e.by.id) + (e.by.from ? ' from ' + e.by.from.id : '') + ' at ' + e.speed + ', ' + world.keep.hits + ' so far'})
})`
try {
  // She stands in the street six metres west of where the pitcher will be, facing east; he watches from the side.
  const ada = await open('Ada', 76, 408.3, Math.PI / 2), ben = await open('Ben', 79, 410.2, -0.5)
  await post('join', { by: 'watcher', at: [800, 4100] })
  check((await post('ask', { by: 'tester', rule: { id: 'pitcher', name: 'Someone who throws when asked', source: RULE } })).asked, 'a rule that throws and listens for blows is taken')
  await ada.waitForTimeout(1500)
  // A ball at her.
  const stood = await feet(ada)
  const thrown = async () => { await ada.evaluate(() => globalThis.engine.say('throw at me')); return until('a blow on Ada', (t) => /^struck Ada by thrown wood from pitcher/.test(t)) }
  let told
  if (out) { const took = await film(ben, 4, async () => { told = await thrown() }); writeFileSync(join(out, 'struck.webm'), took.webm); spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(out, 'struck.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-vf', 'scale=1280:-2', join(out, 'struck.mp4')]); spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(out, 'struck.webm'), '-vf', `fps=${(12 / took.seconds).toFixed(3)},scale=480:-1,tile=4x3`, '-frames:v', '1', join(out, 'struck-strip.jpg')]) } else told = await thrown()
  // Seen in flight on the watching page, and nothing of it lies in the street afterwards.
  await ben.waitForTimeout(3500)
  const drawn = await ben.evaluate(() => ({ shots: globalThis.engine.shots.seen, loose: globalThis.engine.dropping }))
  const litter = await (async () => { let wood = 0; for (let x = 740; x <= 830; x += 2) for (const dy of [1, 2, 3]) { const c = await (await fetch(`${server.url}/world/at?x=${x}&y=${Math.round(stood[1]) + dy - 1}&z=${Math.round(stood[2])}`)).json(); if (c.material === 10) wood++ } return wood })()
  check(drawn.shots >= 1 && litter === 0, `the watching page drew it as a shot (a streak, a flash at each end), and where it stopped it is gone: no wood lies along its way (${litter} cells)`)
  check(!!told, `a ball thrown at someone at a page strikes them, and the rule hears whom, by what and from whom ("${told}")`)
  await ada.waitForTimeout(800)
  const after = await feet(ada)
  check(stood[0] - after[0] > 4, `and she is thrown by it (${((stood[0] - after[0]) / 10).toFixed(2)} m back, the way the ball went)`)
  // A ball at an actor: its own rule hears, with the id it gave.
  await ada.evaluate(() => globalThis.engine.say('throw at the post'))
  const post2 = await until('a blow on the post', (t) => /^struck Post \(mine\) by thrown wood/.test(t))
  check(!!post2 && / 2 so far/.test(post2), `a ball thrown at an actor strikes it too, its rule hears it as its own, and the count is the rule's ("${post2}")`)
  // A push, and the ground.
  await ada.waitForTimeout(1200)
  const before = await feet(ada)
  await ada.evaluate(() => globalThis.engine.say('push me'))
  await ada.waitForTimeout(900)
  const pushed = await feet(ada)
  check(pushed[2] - before[2] > 8, `a rule's push throws her along the way it gave (${((pushed[2] - before[2]) / 10).toFixed(1)} m south)`)
  await ada.waitForTimeout(1500)
  await ada.evaluate(() => globalThis.engine.say('down'))
  await ada.waitForTimeout(400)
  const lay = await feet(ada)
  await ada.keyboard.down('KeyW'); await ada.waitForTimeout(1400)
  const still1 = await feet(ada)
  await ada.waitForTimeout(2200)
  const up = await feet(ada)
  await ada.keyboard.up('KeyW')
  check(Math.hypot(still1[0] - lay[0], still1[2] - lay[2]) < 2 && Math.hypot(up[0] - lay[0], up[2] - lay[2]) > 6, 'put on the ground for two and a half seconds she cannot walk, and then she can')
  // A car driven into her: a blow by a thing.
  const where = await feet(ada)
  await ben.evaluate(async ([x, y, z]) => { const e = globalThis.engine; globalThis.car = await e.alive.spawn(e.car([Math.round(x) - 140, Math.round(y) + 4, Math.round(z) - 9])) }, where)
  const ref = await ben.evaluate(() => globalThis.car.ref)
  await ada.waitForTimeout(1500)
  for (let i = 0; i < 10; i++) { await fetch(`${server.url}/world/drive`, { method: 'POST', body: JSON.stringify({ by: 'tester', id: ref, go: 1, turn: 0, rise: 0 }) }); await ada.waitForTimeout(300) }
  const car = await until('a blow by the car', (t) => /^struck Ada by thing /.test(t), 20)
  check(!!car && car.includes(ref), `a car driven into her is a blow by a thing, named ("${car}")`)
  // What is thrown and meets no body lands: its rule hears where, how fast and on what, and can break the world there.
  const cell = async (x, y, z) => (await (await fetch(`${server.url}/world/at?x=${x}&y=${y}&z=${z}`)).json())
  await ada.evaluate(() => globalThis.engine.say('lob'))
  const fell = await until('where it landed', (t) => /^landed lob on /.test(t), 40)
  const m = fell && /^landed lob on (\w+) at (-?\d+) (-?\d+) (-?\d+) going (\d+) from pitcher/.exec(fell)
  check(!!m && Number(m[2]) > 860 && Number(m[5]) > 20, `a thing thrown up the street that meets nobody lands, and its rule hears it: "${fell}"`)
  if (m) {
    const [x, y, z] = [Number(m[2]), Number(m[3]), Number(m[4])]
    let under = null
    for (let i = 0; i < 20; i++) { under = await cell(x, y - 2, z); if (under.kind === 0) break; await ada.waitForTimeout(250) }
    const pieces = await ada.evaluate(() => globalThis.engine.fell.pieces)
    check(under?.kind === 0, `the rule sets off a blast where it landed (world.blast): the street two cells under it is gone (${pieces} pieces came loose on her page)`)
    if (out) { await ben.evaluate(([x, y, z]) => { const e = globalThis.engine; Object.assign(e.pose, { x: x / 10 - 3, y: y / 10 + 2.5, z: z / 10 + 3, yaw: 0.8, pitch: -0.5 }) }, [x, y, z]); await ben.waitForTimeout(1500); await ben.screenshot({ path: join(out, 'blast-where-it-landed.png') }) }
    // A fire lit by a rule: a block of wood up the street, and the rule told where.
    const rows = []
    for (let dy = 0; dy < 6; dy++) for (let dz = -3; dz < 3; dz++) rows.push(x + 40, x + 46, y + dy, z + dz, 10)
    await post('ask', { by: 'tester', edit: [1, rows.length / 5, ...rows], release: [x + 43, y + 8, z] })
    await ada.waitForTimeout(800)
    await ada.evaluate((at) => globalThis.engine.say(`burn ${at.join(' ')}`), [x + 43, y + 3, z])
    await ada.waitForFunction(() => globalThis.engine.burning > 0, null, { timeout: 8000 }).catch(() => {})
    const alight = await ada.evaluate(() => globalThis.engine.burning)
    check(alight > 0, `the rule lights a block of wood (world.ignite): ${alight} cells are alight on her page`)
  }
  await ada.evaluate(() => globalThis.engine.say('too wide'))
  await ada.waitForTimeout(1200)
  check(/blast's radius is a whole number of cells from 1 to 40/.test(JSON.stringify((await (await fetch(`${server.url}/world/rules`)).json()).find((r) => r.id === 'pitcher'))), 'a blast too wide is refused, and the rule is told why')
  // Out of range.
  await ada.evaluate(() => globalThis.engine.say('too hard'))
  await ada.waitForTimeout(1200)
  const how = JSON.stringify((await (await fetch(`${server.url}/world/rules`)).json()).find((r) => r.id === 'pitcher'))
  check(/speed is 10 to 700/.test(how), 'a throw out of range is refused, and the rule is told why')
} catch (e) {
  failures.push(String(e.stack ?? e))
}
await browser.close().catch(() => {})
server.stop()
done?.()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('blows: ok')
process.exit(0)
