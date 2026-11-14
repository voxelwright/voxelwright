// A living thing in a shared world (#245): the world's own process moves it, and everyone there sees the same.
// One page brings a car to life; a page that joins later finds it where it stands and gets on; the first page sees
// it go; a plain request drives it too; where it sleeps is in its record; and after the server is started again on
// the same file it stands there and can be driven. Real Chrome, the real server, nothing stubbed.
//
//   node test/driven.mjs
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { CHROME, serve, still } from './kit.mjs'

const file = join(mkdtempSync(join(tmpdir(), 'engine-driven-')), 'world.log')
const shared = process.env.ENGINE_KIT ? JSON.parse(process.env.ENGINE_KIT) : null
const browser = shared ? await chromium.connect(shared.ws) : await chromium.launch(CHROME)
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
let server = await serve('/dev/null', ['--world', file])
const open = async (name) => {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error (${name}): ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&shared=1&fire=0&people=0&name=${name}`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await still(page)
  return page
}
/** The one living thing a page knows, where it is, and whether anything is being moved. */
const car = (page) => page.evaluate(() => { const e = globalThis.engine, t = e.alive.things[0], w = t && e.alive.where(t); return w ? { at: w.at, up: 1 - 2 * (w.rot[0] ** 2 + w.rot[2] ** 2), ref: t.ref, bodies: e.bodies } : null })
const near = (a, b, within) => a && b && Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]) < within
const asleep = (page) => page.waitForFunction(() => globalThis.engine.bodies === 0 && globalThis.engine.alive.things.length === 1 && globalThis.engine.alive.where(globalThis.engine.alive.things[0]), null, { timeout: 30_000 })
try {
  const ada = await open('Ada')
  const made = await ada.evaluate(async () => {
    const e = globalThis.engine, x = 760, z = 4074, ground = Math.round(e.ground(x / 10, z / 10) * 10)
    const thing = await e.alive.spawn(e.car([x, ground + 5, z]))
    return { id: thing.id, ref: thing.ref }
  })
  check(made.id > 0 && !!made.ref, `a page brings a car to life in the shared world (thing ${made.ref}, body ${made.id})`)
  await asleep(ada)
  const first = await car(ada)
  // Someone who joins later finds it where it stands, though a thing asleep says nothing.
  const ben = await open('Ben')
  await asleep(ben)
  const found = await car(ben)
  check(near(first, found, 1) && found.ref === made.ref, `a page that joins later finds it where it stands (${found && found.at.map((v) => v.toFixed(0))})`)
  // The later page gets on and drives; the first sees it go, and both agree where it stopped.
  await ben.evaluate(() => { const e = globalThis.engine, w = e.alive.where(e.alive.things[0]); e.pose.x = w.at[0] / 10 - 2.5; e.pose.y = w.at[1] / 10 + 1.5; e.pose.z = w.at[2] / 10 + 4.5 })
  await ben.waitForFunction(() => globalThis.engine.alive.near, null, { timeout: 5000 })
  await ben.keyboard.press('KeyE')
  await ben.keyboard.down('KeyW')
  await ben.waitForTimeout(1500)
  await ben.keyboard.up('KeyW')
  await asleep(ada); await asleep(ben)
  const [a, b] = [await car(ada), await car(ben)]
  const went = Math.hypot(a.at[0] - first.at[0], a.at[2] - first.at[2])
  check(went > 30 && near(a, b, 0.5), `one page drives it ${(went / 10).toFixed(1)} m and the other sees it go: both have it at the same place`)
  // Anything that can send a request can drive it: for a second after it is told.
  const told = await fetch(`${server.url}/world/drive`, { method: 'POST', body: JSON.stringify({ by: 'a script', id: made.ref, go: 1, turn: 0, rise: 0 }) })
  await ada.waitForTimeout(600)
  const moving = await car(ada)
  await asleep(ada)
  const c = await car(ada)
  const more = Math.hypot(c.at[0] - a.at[0], c.at[2] - a.at[2])
  check(told.status === 202 && moving.bodies > 0 && more > 3, `a plain request drives it too, for the second it holds (${(more / 10).toFixed(1)} m more), and it stops by itself`)
  const none = await fetch(`${server.url}/world/drive`, { method: 'POST', body: JSON.stringify({ by: 'a script', id: 'no-such-thing', go: 1 }) })
  check(none.status === 409, `telling a thing that is not there is refused (${none.status})`)
  // Where it sleeps is in its record; what struck what never reaches the file.
  // Written at most every twenty seconds, and only when it has moved: the file must not fill with a thing's naps.
  const resting = async () => (await (await fetch(`${server.url}/world/things`)).json()).find((t) => t.id === made.ref)?.controls?.rest
  let rest = null
  for (let i = 0; i < 60 && !(rest && Math.hypot(rest.at[0] - c.at[0], rest.at[1] - c.at[1], rest.at[2] - c.at[2]) < 0.5); i++) { await ada.waitForTimeout(500); rest = await resting() }
  check(rest && Math.hypot(rest.at[0] - c.at[0], rest.at[1] - c.at[1], rest.at[2] - c.at[2]) < 0.5, `its record says where it sleeps (${rest && rest.at.map((v) => v.toFixed(0))})`)
  // A blast across the street and one beside it: neither moves it far enough to matter here, and a sleeper that
  // is woken and sleeps again where it was writes nothing.
  const changes = () => { const all = readFileSync(file).toString('latin1'); return all.split('"controls"').length - 1 }
  const before = changes()
  await fetch(`${server.url}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'a script', blast: [Math.round(c.at[0]) + 600, Math.round(c.at[1]), Math.round(c.at[2])], radius: 6 }) })
  await fetch(`${server.url}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'a script', edit: [0, Math.round(c.at[0]), Math.round(c.at[1]) + 40, Math.round(c.at[2]), 1, 8], release: [Math.round(c.at[0]), Math.round(c.at[1]) + 44, Math.round(c.at[2])] }) })
  await ada.waitForTimeout(3000)
  await asleep(ada)
  check(changes() === before, `woken by what changes near it and asleep again, it writes nothing more to the world's file (${before} changes of its controls kept)`)
  const kept = readFileSync(file)
  let impacts = 0
  for (let at = 0; at + 12 <= kept.length;) {
    const kind = kept.readUInt32LE(at), size = kept.readUInt32LE(at + 8)
    if (kind === 1) { const w = new Uint32Array(kept.buffer.slice(kept.byteOffset + at + 12 + 16, kept.byteOffset + at + 12 + size)); for (let i = 0; i < w.length; i += 2 + w[i + 1]) if (w[i] === 10 || w[i] === 11) impacts++ }
    at += 12 + size
  }
  check(impacts === 0, 'nothing of what struck what, or of how a thing is doing, is kept in the world\'s file')
  // The server is started again on the same file: bodies are not kept, and the car stands where it slept.
  await ada.context().close(); await ben.context().close()
  server.stop()
  await new Promise((done) => setTimeout(done, 500))
  server = await serve('/dev/null', ['--world', file])
  const cy = await open('Cy')
  await asleep(cy)
  const back = await car(cy)
  check(near(back, c, 1.5) && back.up > 0.98, `after the server is started again it stands where it slept, on its feet (${back && back.at.map((v) => v.toFixed(0))})`)
  await fetch(`${server.url}/world/drive`, { method: 'POST', body: JSON.stringify({ by: 'a script', id: made.ref, go: -1 }) })
  await cy.waitForTimeout(700)
  await asleep(cy)
  const again = await car(cy)
  check(Math.hypot(again.at[0] - back.at[0], again.at[2] - back.at[2]) > 3, 'and can be driven again')
} catch (e) {
  failures.push(String(e.stack ?? e))
}
if (shared) await browser.close().catch(() => {}); else await browser.close()
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('driven: ok')
process.exit(0)
