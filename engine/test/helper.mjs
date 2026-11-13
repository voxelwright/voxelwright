// The seam (#243, #244): the helper on the asker's machine, one ask from the real page, the record the world
// keeps of a made thing, and the page's one owner of keys.
//
// NO MODEL IS RUN HERE. A reply kept in this file stands in for one: this proves who the helper answers, that an
// ask from the page in Chrome reaches it across origins and comes back as a thing with a record, and that the
// record outlives a restart. That a real model answers in the form is proved by a real run.
//
//   node test/helper.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { helper, shaped } from '../helper.mjs'
import { CHROME, serve } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = mkdtempSync(join(tmpdir(), 'engine-helper-')), file = join(dir, 'world.log')
let server = await serve('/dev/null', ['--world', file])
const world = server.url

const CRATE = { name: 'tea crate', size: [10, 9, 8], parts: [
  ['box', 'wood', 'own', 0, 0, 0, 10, 8, 8], ['box', 'wood', '2:6', 0, 3, 0, 10, 4, 8], ['box', 'steel', 'own', 0, 8, 0, 10, 9, 8],
] }
let asked = 0
const model = async () => { asked++; return { text: JSON.stringify(CRATE), model: 'a kept reply', ms: 0, cost: 0 } }
const h = await helper({ world, port: 0, model, journal: join(dir, 'made.jsonl') })
const port = new URL(h.url).port
/** A request as something that is not a browser makes it: any Host, any Origin. */
const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => { let text = ''; res.on('data', (c) => { text += c }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text })) })
  req.on('error', reject)
  req.end(body)
})
const from = { eye: [700, 172, 4060], toward: [0, -0.2, -1] }
const secret = { 'x-village-secret': h.secret }

const shared = process.env.ENGINE_KIT ? JSON.parse(process.env.ENGINE_KIT) : null
const browser = shared ? await chromium.connect(shared.ws) : await chromium.launch(CHROME)
try {
  // ── Who the helper answers ──
  check((await raw('/hello', { headers: secret })).status === 200, 'with the secret, by this machine\'s own name: answered')
  check((await raw('/hello')).status === 401 && (await raw('/hello', { headers: { 'x-village-secret': h.secret.slice(0, -1) + 'x' } })).status === 401, 'without the secret, or with one a letter off: 401')
  check((await raw('/hello', { headers: { ...secret, host: `evil.example:${port}` } })).status === 403, 'asked by another name that points here (Host), secret and all: 403')
  const elsewhere = await raw('/ask', { method: 'POST', headers: { ...secret, origin: 'http://evil.example' }, body: JSON.stringify({ wish: 'a crate', from }) })
  check(elsewhere.status === 403 && !elsewhere.headers['access-control-allow-origin'], 'from another site\'s page (Origin), secret and all: 403, and no leave to read the answer')
  const pre = await raw('/ask', { method: 'OPTIONS', headers: { origin: world, 'access-control-request-method': 'POST' } })
  check(pre.status === 204 && pre.headers['access-control-allow-origin'] === world && /x-village-secret/.test(pre.headers['access-control-allow-headers']), 'the world\'s own page is told it may ask (the browser\'s question before a request, which carries no secret)')
  check((await raw('/ask', { method: 'OPTIONS', headers: { origin: 'http://evil.example' } })).status === 403, 'another site\'s page is not')
  check(asked === 0, 'none of that started a model')

  // ── The shape of an ask ──
  const not = (body) => typeof shaped(body) === 'string'
  check(not({ from }) && not({ wish: '  ', from }), 'an ask of nothing is not one')
  check(not({ wish: 'x' }) && not({ wish: 'x', from: { eye: [0, 0, 0], toward: [0, 0, 0] } }), 'an ask says where the asker is and looks')
  check(not({ wish: 'x', from, world: 'http://elsewhere' }) && not({ wish: 'x', from, model: 'opus' }), 'an ask cannot name a world or a model: those are the helper\'s')
  check(not({ wish: 'x', from, link: 'file:///etc/passwd' }) && not({ wish: 'x', from, picture: { type: 'image/svg+xml', data: 'AAAA' } }) && not({ wish: 'x', from, target: { box: [0, 0, 0, 0, 1, 1] } }), 'a link that is not http, a picture that is not one, a box with no inside: refused')
  const full = shaped({ wish: 'like this', picture: { type: 'image/png', data: 'AAAA' }, link: 'https://example.com/a', target: { thing: 'abc-1', part: 'door' }, from, by: 'Ada' })
  check(typeof full === 'object' && full.picture && full.link === 'https://example.com/a' && full.target.part === 'door', 'a wish, a picture, a link and a thing\'s part together are one')
  const later = await raw('/ask', { method: 'POST', headers: secret, body: JSON.stringify({ picture: { type: 'image/png', data: 'AAAA' }, from }) })
  check(later.status === 501 && asked === 0, 'a picture is answered "not yet" before anything is started')

  // ── One ask from the real page ──
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }), page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  page error: ${m.text().slice(0, 300)}`) })
  await page.goto(`${world}/city?fly=0&shared=1&name=Ada&at=70,17.2,406&look=0,-11.3${new URL(h.link).hash}`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  check(await page.evaluate(() => location.hash === '' && engine.asker.known), 'the page keeps the helper\'s address and secret, and they are gone from its own address')
  check(await page.evaluate(() => engine.asker.hello()), 'the page in Chrome reaches the helper across origins (the page is served require-corp)')
  const went = await page.evaluate(async () => { const stages = []; const done = await engine.ask({ wish: 'a tea crate' }, (s) => stages.push(s.stage)); return { done, stages } })
  check(went.done.state === 'there' && asked === 1, `an ask from the page is made: ${went.done.state}${went.done.why ? ` (${went.done.why})` : ''}, ${went.done.name}`)
  check(went.stages.join(' ') === 'place asking sending done', `the page is told how it goes: ${went.stages.join(', ')}`)
  await page.waitForFunction((id) => engine.things.all.has(id), went.done.id, { timeout: 10_000 })
  const seen = await page.evaluate((id) => { const t = engine.things.all.get(id); return { name: t.name, wish: t.wish, by: t.by, rows: t.cells.length / 5, mine: engine.things.at([t.cells[0], t.cells[2], t.cells[3]])?.id === id, none: engine.things.at([t.box[0] - 3, t.box[1], t.box[2]]) } }, went.done.id)
  check(seen.name === 'tea crate' && seen.wish === 'a tea crate' && seen.by === 'Ada' && seen.rows > 10 && seen.mine && seen.none === null, `the page has its record from the world's stream: ${seen.name}, asked by ${seen.by}, ${seen.rows} rows, found by a cell of it`)

  // ── The record the world keeps ──
  const list = await (await fetch(`${world}/world/things`)).json(), one = await (await fetch(`${world}/world/things?id=${went.done.id}`)).json()
  check(list.length === 1 && list[0].id === went.done.id && list[0].cells === undefined && one.cells.length === seen.rows * 5 && one.facing === 'south', 'the world lists it, and gives its cells when asked for the one')
  const post = (body) => fetch(`${world}/world/ask`, { method: 'POST', body: JSON.stringify(body) })
  const again = await post({ by: 'x', edit: [1, 1, 0, 1, 900, 0, 8], release: [0, 900, 0], thing: { id: went.done.id, name: 'a second', wish: '', at: [0, 900, 0], size: [1, 1, 1], facing: 'south' } })
  check(again.status === 409, 'a second thing of the same id is refused')
  check((await post({ by: 'x', thing: { id: went.done.id, name: 'renamed' } })).status === 400 && (await post({ by: 'x', thing: { id: 'no-such', sounds: {} } })).status === 409, 'a change may set only the lanes\' fields, of a thing that is there')
  check((await post({ by: 'x', thing: { id: went.done.id, sounds: { knock: [220, 0.2] }, seats: [{ at: [1, 9, 1] }] } })).status === 202, 'a lane sets its fields of it')
  await page.waitForFunction((id) => engine.things.all.get(id).sounds, went.done.id, { timeout: 10_000 })
  check(await page.evaluate((id) => engine.things.all.get(id).seats[0].at[1] === 9 && engine.things.all.get(id).name === 'tea crate', went.done.id), 'and the page hears of the change')

  // ── Keys have one owner ──
  const z0 = await page.evaluate(() => engine.pose.z)
  await page.keyboard.down('KeyW'); await page.waitForTimeout(300)
  const z1 = await page.evaluate(() => engine.pose.z)
  check(z1 < z0 - 0.5 && await page.evaluate(() => engine.input.top === 'moving'), `W moves the eye (${(z0 - z1).toFixed(1)} m north)`)
  // Enter opens the ask bar with W still down: its keyup goes to the line, and the eye must not walk on for ever after.
  await page.keyboard.press('Enter')
  check(await page.evaluate(() => engine.input.top === 'typing' && document.activeElement?.id === 'line' && !engine.input.held('KeyW')), 'Enter opens the ask bar: the page is typing, and no key is held')
  await page.keyboard.up('KeyW')
  const z2 = await page.evaluate(() => engine.pose.z)
  await page.keyboard.type('hello 1 w')
  await page.waitForTimeout(200)
  check(await page.evaluate((z) => engine.pose.z === z && engine.tool === 'Charge', z2), 'typed letters are letters: the eye stays, the tool picked stays')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('#said')?.textContent.includes('Ada: hello 1 w'), null, { timeout: 5000 })
  const z3 = await page.evaluate(() => engine.pose.z)
  await page.waitForTimeout(200)
  check(await page.evaluate((z) => engine.input.top === 'moving' && engine.pose.z === z, z3), 'sent, it is said, the bar is away and the eye does not walk on')
  await page.keyboard.press('Digit3')
  check(await page.evaluate(() => engine.tool === 'Big charge'), 'and keys are the page\'s again')
  // A mode a lane adds: solid, it has the keys and the click, and the page's own stand still until it is taken off.
  const mounted = await page.evaluate(async () => {
    const got = []
    const off = engine.input.push({ name: 'mounted', solid: true, key: (code) => { got.push(code); return true }, use: () => { got.push('use'); return true } })
    return { off: !!off, live: engine.input.live('moving') }
  })
  await page.keyboard.press('Digit1'); await page.evaluate(() => engine.input.use())
  check(!mounted.live && await page.evaluate(() => engine.tool === 'Big charge' && engine.fell.asks === 0), 'under a solid mode the page\'s own keys and click do nothing')
  await context.close()

  // ── After a restart ──
  server.stop()
  await new Promise((r) => setTimeout(r, 300))
  server = await serve('/dev/null', ['--world', file])
  const back = await (await fetch(`${server.url}/world/things`)).json(), cellsBack = await (await fetch(`${server.url}/world/things?id=${went.done.id}`)).json()
  check(back.length === 1 && back[0].name === 'tea crate' && back[0].sounds?.knock && cellsBack.cells.length === one.cells.length, 'after the world\'s server is started again the record is there, the lane\'s fields and the cells with it')
  check((await fetch(`${server.url}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'x', gone: went.done.id }) })).status === 202, 'it can be forgotten')
  await new Promise((r) => setTimeout(r, 300))
  server.stop()
  await new Promise((r) => setTimeout(r, 300))
  server = await serve('/dev/null', ['--world', file])
  check((await (await fetch(`${server.url}/world/things`)).json()).length === 0, 'and stays forgotten after another restart')
} finally {
  await h.close()
  server.stop()
  await browser.close().catch(() => {})
  rmSync(dir, { recursive: true, force: true })
}
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('helper: ok (a kept reply stood in for the model: no model was run)')
process.exit(0)
