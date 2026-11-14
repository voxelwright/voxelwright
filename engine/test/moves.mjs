// Moves and looks as data (#218, for #264). Asked of the modules alone: what a stranger sends as a move or a look
// is cut down to what a figure can do and wear, and a move laid over a pose does what its keys say. Asked of the
// real server, world process and a page in Chrome, with a rule that is no game (someone who minds a crossing: waves
// when greeted, holds a hand up, salutes with keys of the rule's own, sits down to rest, runs when called): the
// move a rule sets is the move the page plays, on the world's clock; a body that runs is drawn running.
//
//   node test/moves.mjs [--out directory]
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, serve, still } from './kit.mjs'
import { CHANNELS, KEYS_MOST, NAMED, moveOf, play } from '../page/moves.ts'
import { lookOf } from '../page/wear.ts'

const out = arg('out', '')
if (out) mkdirSync(out, { recursive: true })
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const J = Object.fromEntries(CHANNELS.map((c, i) => [c, i])), pose = (set = {}) => { const p = new Float64Array(CHANNELS.length); for (const [k, v] of Object.entries(set)) p[J[k]] = v; return p }

// What a stranger sends.
const wild = moveOf({ keys: [{ t: 0.2, liftR: 99, nonsense: 4, crouch: -3 }, { t: 0.1, bendR: 'x', sit: 0.5 }, ...Array.from({ length: 60 }, (_, i) => ({ t: 1 + i, lean: 0.1 }))], loop: 'yes' })
check(wild.keys.length === KEYS_MOST && wild.keys[0].liftR === 3.3 && wild.keys[0].crouch === 0 && !('nonsense' in wild.keys[0]) && wild.keys[1].t === 0.2 && wild.keys[1].bendR === undefined && wild.loop === false, `a move from a stranger keeps only the joints there are, each within what a joint can do, ${KEYS_MOST} keys at most, in order of time`)
check(moveOf('fly-away') === null && moveOf({ keys: [] }) === null && moveOf({ keys: [{ liftR: 1 }] }) === null && moveOf(7) === null && moveOf('wave') === NAMED.wave, 'what is no move is refused: a name there is not, no keys, a key with no time')
const look = lookOf({ coat: '#1C1D22', legs: 'red', tall: 9, wear: ['suit', 'tie #7a1c1c', 'cloak', 'tie; drop', 7], carry: 'bazooka', extra: [{ on: 'head', at: [0, 3.4, 0], size: [0.6, 99, 0.6], colour: '#c9a23a' }, { on: 'tail', at: [0, 0, 0], size: [1, 1, 1], colour: '#ffffff' }, { on: 'chest', at: [0, 1, 'x'], size: [1, 1, 1], colour: '#ffffff' }] })
check(look.coat === '#1c1d22' && look.legs === undefined && look.tall === 1.2 && look.wear.join() === 'suit,tie #7a1c1c' && look.carry === undefined && look.extra.length === 1 && look.extra[0].size[1] === 14, 'a look from a stranger keeps the colours that are colours, the things there are, and the boxes that are boxes, cut to size')
// A move laid over a pose.
const walking = pose({ swingL: 0.3, liftR: -0.2 })
play(NAMED.wave, 0.4, walking)
check(Math.abs(walking[J.swingL] - 0.3) < 1e-9 && walking[J.outR] > 2, 'a wave lifts the arm and leaves the legs to walk')
const held = pose(), over = pose({ liftL: 0.5 }), gone = pose({ liftL: 0.5 })
check(play(NAMED.sit, 30, held) && held[J.sit] === 1 && play(NAMED.strike, 0.23, over) && over[J.aimR] === 1 && !play(NAMED.strike, 5, gone) && gone[J.liftL] === 0.5, 'a held move stays in its last pose; a strike is at full reach at its blow and afterwards the body is as it was')

const file = join(mkdtempSync(join(tmpdir(), 'engine-moves-')), 'world.log')
let server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(400); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const until = async (what, ask, ms = 10_000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(120)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }
const how = async (id) => (await send('rules')).find((r) => r.id === id)

const CROSSING = `
on('start', (world, e) => { if (!world.people.some((p) => p.mine)) world.actor('warden', { name: 'Crossing warden', at: [708, 4010], look: { coat: '#2a3a5c', wear: ['plain', 'vest', 'cap #1f2a3d', 'gloves #e2dfd6'], carry: 'torch', extra: [{ on: 'chest', at: [0, 3.2, -1.3], size: [0.5, 0.5, 0.1], colour: '#c9a23a', shiny: true }] } }) })
on('said', (world, e) => {
  if (/hello/i.test(e.text)) world.actor('warden', { face: e.at, move: 'wave' })
  if (/may i cross/i.test(e.text)) world.actor('warden', { move: 'point', aim: e.by, say: 'Go on.' })
  if (/thank/i.test(e.text)) world.actor('warden', { move: { keys: [{ t: 0.25, liftR: 1.9, outR: 0.5, bendR: 2.3, wings: 3 }, { t: 1.2, liftR: 1.9, outR: 0.5, bendR: 2.3 }, { t: 1.5, liftR: 0, outR: 0, bendR: 0.1 }] } })
  if (/rest/i.test(e.text)) world.actor('warden', { move: 'sit' })
  if (/quick/i.test(e.text)) world.actor('warden', { move: null, to: [960, 4010], pace: 60 })
  if (/dance/i.test(e.text)) world.actor('warden', { move: 'the-macarena' })
})`
let browser
try {
  await post('join', { by: 'wren', at: [700, 4011] })
  await post('ask', { by: 'tester', rule: { id: 'crossing', name: 'Someone minds the crossing', source: CROSSING } })
  await until('the warden is there', async () => (await how('crossing'))?.actors === 1)
  browser = await chrome()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&shared=1&fire=0&scale=0.6&hour=10.5&people=0&name=iris`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await page.evaluate(() => { const e = globalThis.engine; Object.assign(e.pose, { x: 70.3, y: e.ground(70.3, 403.6) + 2.2, z: 403.75, yaw: 0, pitch: -0.2 }) })
  await still(page)
  /** The warden as the page draws it this frame. */
  const warden = () => page.evaluate(() => { const e = globalThis.engine, p = e.folk.from.flatMap((f) => f(e.view(), 0)).find((p) => p.name === 'Crossing warden'); return p ? { look: p.look, running: p.running, walking: p.walking, keys: p.move?.move.keys, t: p.move?.t, loop: p.move?.move.loop, hold: p.move?.move.hold, aim: p.move?.aim, was: !!p.was } : null })
  const shot = async (name) => { if (out) { await page.waitForTimeout(350); await page.screenshot({ path: join(out, `moves-${name}.png`) }) } }
  const first = await until('the page has the warden', warden)
  check(first.look.wear.join() === 'plain,vest,cap #1f2a3d,gloves #e2dfd6' && first.look.carry === 'torch' && first.look.extra.length === 1 && first.keys === undefined, 'a page draws the actor in what its rule had it wear and carry, a box of the rule\'s own among it')
  await shot('0-stands')

  await post('say', { by: 'wren', text: 'Hello!' })
  const waving = await until('it waves', async () => { const w = await warden(); return w?.loop ? w : null })
  await wait(700)
  const later = await warden()
  check(JSON.stringify(waving.keys) === JSON.stringify(NAMED.wave.keys) && later.t > waving.t + 0.5 && later.t < waving.t + 1.5, `greeted, it waves: the move with that name, ${later.t.toFixed(2)} s into it on the world's clock`)
  await shot('1-waves')
  await post('say', { by: 'wren', text: 'May I cross?' })
  const pointing = await until('it points', async () => { const w = await warden(); return w?.hold && w.aim ? w : null })
  check(Math.abs(pointing.aim[0] - 700) < 2 && Math.abs(pointing.aim[2] - 4011) < 2 && pointing.was, `asked, it points at who asked (aimed at ${pointing.aim}), taking over from the wave without a jump`)
  await shot('2-points')
  // Whoever it is aimed at walks off: the aim goes with them, and the body turns to keep facing them.
  const yawOf = () => page.evaluate(() => { const e = globalThis.engine; return e.folk.from.flatMap((f) => f(e.view(), 0)).find((p) => p.name === 'Crossing warden').yaw })
  const faced = await yawOf()
  await post('walk', { by: 'wren', to: [660, 4030] })
  const followed = await until('the aim follows', async () => { const w = await warden(); return w?.aim && Math.abs(w.aim[0] - 660) < 3 && Math.abs(w.aim[2] - 4030) < 3 ? w : null }, 15_000)
  await wait(600)
  const turned = await yawOf(), want = Math.atan2(660 - 708, -(4030 - 4010))
  let off = turned - want; off -= Math.round(off / (Math.PI * 2)) * Math.PI * 2
  check(Math.abs(off) < 0.15 && Math.abs(turned - faced) > 0.15, `aimed at someone, it follows them as they walk off (aim ${followed.aim}) and turns to face them (${faced.toFixed(2)} to ${turned.toFixed(2)} radians)`)
  await shot('2b-turns')
  await post('walk', { by: 'wren', to: [700, 4011] })
  await until('wren is back', async () => !(await send('me?by=wren')).you.walking, 15_000)
  await post('say', { by: 'wren', text: 'Thank you' })
  const salute = await until('it salutes', async () => { const w = await warden(); return w?.keys?.length === 3 ? w : null })
  check(salute.keys[0].liftR === 1.9 && !('wings' in salute.keys[0]) && !salute.loop && !salute.hold, 'thanked, it salutes: keys of the rule\'s own reach the page, without the joint there is not')
  await shot('3-salutes')
  await post('say', { by: 'wren', text: 'have a rest' })
  await until('it sits', async () => { const w = await warden(); return w?.hold && w.keys?.[0].sit === 1 })
  await shot('4-sits')
  await post('say', { by: 'wren', text: 'do a dance' })
  await until('the rule is told there is no such move', async () => /not a move with a name/.test((await how('crossing'))?.error ?? ''))
  check((await warden()).keys?.[0].sit === 1, `a move there is not is refused and says so (${(await how('crossing')).error.slice(0, 60)}), and it sits on`)
  // A body that runs is drawn running.
  await post('say', { by: 'wren', text: 'quick!' })
  const ran = await until('it runs', async () => { const w = await warden(); return w && w.running > 0.8 && w.walking > 0.8 ? w : null })
  check(ran.running > 0.8, `called, it gets up and runs: at 6 m/s the page draws ${Math.round(ran.running * 100)}% of a run`)
  await shot('5-runs')
  await until('it stands again', async () => { const w = await warden(); return w && w.walking < 0.1 && w.running < 0.3 })
  check(true, 'and there it stands')
  // Someone sitting sits on when the world is started again.
  await post('say', { by: 'wren', text: 'have a rest' })
  await until('it sits again', async () => { const w = await warden(); return w?.hold && w.keys?.[0].sit === 1 })
  await wait(2600)
  server.stop()
  await wait(400)
  server = await serve('/dev/null', ['--world', file])
  await post('join', { by: 'wren', at: [700, 4011] })
  await page.goto(`${server.url}/city?fly=0&shared=1&fire=0&scale=0.6&hour=10.5&people=0&name=iris`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  const sat = await until('the page has the warden again', async () => { const w = await warden(); return w?.keys ? w : null }, 20_000)
  check(sat.hold && sat.keys[0].sit === 1 && sat.t > 0.5, 'started again, the world has it sitting still: a held move is kept')
} catch (e) {
  failures.push(String(e.stack ?? e))
}
await browser?.close().catch(() => {})
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('moves: ok')
process.exit(0)
