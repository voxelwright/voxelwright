// Rules in a running world (#264): text put into a world makes people who do what it says, changed while it runs,
// kept across a restart, and held by its box whatever it tries. The real server and the real world process;
// nothing stubbed. One page at the end, to see that a look a rule chose is the look the figure has.
//
//   node test/rules.mjs [--out picture.png]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { MessageChannel } from 'node:worker_threads'
import { join } from 'node:path'
import { rules as keep } from '../rules/run.mjs'
import { arg, chrome, serve } from './kit.mjs'

const file = join(mkdtempSync(join(tmpdir(), 'engine-rules-')), 'world.log')
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
let server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
/** One request; told there are too many a second (the world's own cap on bodies), it waits and asks again. */
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(400); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const get = (path) => send(path)
const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
/** Asks until something is so, or says it never was. */
const until = async (what, ask, ms = 5000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(100)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }
const rule = (id, source, name = id) => post('ask', { by: 'tester', rule: { id, name, source } })
const how = async (id) => (await get('rules')).find((r) => r.id === id)
const around = async () => get('around?by=wren&within=1200')
const person = async (name) => (await around()).people.find((p) => p.name === name)

// A rule that has nothing to do with any game: someone who stands on the pavement, comes when called, and wears
// what they are told to.
const GREETER = `
on('start', (world) => {
  // Put again changed, its actor is still there, where it had walked to; in a world started again it is not.
  const there = world.people.some((p) => p.mine && p.id === 'guide')
  world.actor('guide', there ? { look: { coat: '#c9a23a' } } : { name: 'Odile', at: [700, 4009], look: { coat: '#c9a23a' } })
})
on('said', (world, e) => {
  world.keep.heard = (world.keep.heard || 0) + 1
  if (/come here/i.test(e.text)) world.actor('guide', { to: [e.at[0], e.at[2] - 28], pace: 30, say: 'Coming, ' + e.name + '.' })
  if (/how many/i.test(e.text)) world.actor('guide', { face: e.at, say: 'I have heard ' + world.keep.heard + ' things.' })
})`
try {
  // The clock on a rule is kept by the world's process, and that process can be busy with its own work (a big
  // blast, hundreds of edits). Found by the realms lane: a healthy rule put in then was stopped as slow. So here
  // the keeper is held up exactly as the world would hold it: inside the handling of a message (as an ask is),
  // this thread does nothing for a second and a half while a rule's answer waits to be read.
  {
    const keeper = keep({ people: () => [], residents: () => [], does: () => ['actor', 'gone'], obey: () => {} })
    const { port1, port2 } = new MessageChannel()
    /** Does something and then nothing for so long, inside the handling of a message. */
    const held = (first, ms) => new Promise((done) => { port1.once('message', () => { first(); for (const until = performance.now() + ms; performance.now() < until;); done() }); port2.postMessage(0) })
    keeper.put({ id: 'steady', name: 'steady', by: 'tester', source: `on('tick', () => {})` }, 'put')
    await until('it starts', async () => keeper.doing(() => 0)[0].running || keeper.doing(() => 0)[0].error, 15000)
    for (let i = 0; i < 3; i++) { await held(() => keeper.happen('tick', { dt: 0.5 }), 1500); await wait(200) }
    port1.close()
    const steady = keeper.doing(() => 0)[0]
    check(steady.running && steady.error === '' && steady.calls === 3, `a rule is not stopped for the time the world itself was busy (${steady.error || `${steady.calls} calls, running`})`)
    keeper.put({ id: 'stuck', name: 'stuck', by: 'tester', source: `on('tick', () => { const big = 'x'.repeat(200000); for (let i = 0; i < 100000; i++) big.split('x').join('y') })` }, 'put')
    await until('it starts', async () => keeper.doing(() => 0)[1].running, 15000)
    keeper.happen('tick', { dt: 0.5 })
    await until('the clock ends it', async () => !keeper.doing(() => 0)[1].running, 8000)
    check(/took over 1000 ms/.test(keeper.doing(() => 0)[1].error), 'and one that is truly at work for over a second is still ended by the clock')
    keeper.drop('steady'); keeper.drop('stuck')
  }
  await post('join', { by: 'wren', at: [700, 4060] })
  check((await rule('greeter', GREETER, 'Someone who comes when called')).asked, 'a rule is taken')
  await until('the rule runs', async () => (await how('greeter'))?.actors === 1)
  const first = await how('greeter')
  check(first.running && first.listens.includes('said') && first.error === '', `it runs, listens for ${first.listens.join(' and ')}, and made its actor`)
  const stood = await person('Odile')
  check(stood && stood.doing === 'standing' && stood.what === 'an actor of a rule', 'someone in a seat is told of the actor, and what it is')

  await post('say', { by: 'wren', text: 'Odile, come here please' })
  const came = await until('the actor comes', async () => { const p = await person('Odile'); return p && p.far < 40 && p.doing === 'standing' ? p : null }, 8000)
  check(came.far < 40, `called, it walks over (${stood.far} cells off, then ${came.far})`)
  const heard = (await around()).heard.map((h) => h.text)
  check(heard.includes('Coming, wren.'), 'and what it says is heard')

  // Changed while it runs: the same actor, what it kept, a new way of doing things.
  await post('say', { by: 'wren', text: 'how many?' })
  await until('it counts', async () => (await around()).heard.some((h) => h.text === 'I have heard 2 things.'))
  const walked = await person('Odile')
  await rule('greeter', GREETER.replace("'I have heard '", "'So far: '"))
  await until('the changed rule runs', async () => (await how('greeter'))?.calls === 1)
  await post('say', { by: 'wren', text: 'how many now?' })
  await until('it counts on', async () => (await around()).heard.some((h) => h.text === 'So far: 3 things.'))
  const stayed = await person('Odile')
  check((await how('greeter')).actors === 1 && stayed.at[2] === walked.at[2], 'put again changed, the rule keeps its actor where it stood and what it had counted, and says it the new way')

  // What a rule may not do.
  await rule('hog', `on('said', () => { for (;;) {} })`)
  await rule('glut', `on('said', () => { let s = 'x'; for (;;) s += s })`)
  await rule('hoard', `on('said', (world) => { world.keep.all = 'x'.repeat(100000) })`)
  await rule('thief', `on('said', (world, e) => {
    world.actor('wren', { to: [0, 0] })
    world.actor('greeter/guide', { to: [0, 0] })
    world.actor('guide', { to: [0, 0] })
    world.actor('nowhere', { at: [NaN, 1e99] })
    const round = world.keep.round = (world.keep.round || 0) + 1
    for (let i = 0; i < 50; i++) world.actor('crowd-' + round + '-' + i, { at: [690 + i % 40, 4009], name: 'A'.repeat(100) + '\\u0007', pace: 1e9, look: { coat: 'javascript:alert(1)', tall: 50, extra: { deep: true } }, say: 'again' })
  })`)
  await rule('broken', `on('start', () => {`)
  await rule('shouts', `on('said', (world, e) => { world.actor('echo', { at: [720, 4009], say: e.text }) })`)
  // What the count of steps does not see, and what a security pass found (Sentinel, November 13): memory taken as
  // the rule's text is first run, with the refusal caught; the same in a handler; a regex that backtracks; work
  // inside the interpreter's own functions, which no count interrupts; and a rule that fails four times in five.
  const GROW = `try { for (;;) h.push(new Array(1000).fill(1)) } catch (e) {}`
  for (const n of [1, 2, 3]) await rule(`grow-${n}`, `globalThis.h = []; ${GROW}; on('tick', () => {})`)
  await rule('thrash', `on('said', () => { const h = []; ${GROW} })`)
  await rule('regex', `on('said', () => { /(a+)+$/.test('a'.repeat(40) + 'b') })`)
  await rule('stall', `on('said', () => { const big = 'x'.repeat(200000); for (let i = 0; i < 100000; i++) big.split('x').join('y') })`)
  await rule('mostly', `let n = 0; on('said', () => { if (++n % 5) throw new Error('four times in five') })`)
  await until('they are in', async () => (await get('rules')).length === 14)
  await until('they have started', async () => (await get('rules')).every((r) => r.running || r.error))
  check((await how('broken')).running === false && /SyntaxError/.test((await how('broken')).error), 'text that is no script does not run, and says why')
  const before = await person('Odile')
  let slowest = 0
  for (let i = 0; i < 8; i++) {
    await post('say', { by: 'wren', text: `still here ${i}` })
    const began = Date.now()
    await get('at?x=700&y=154&z=4070')
    slowest = Math.max(slowest, Date.now() - began)
  }
  await until('the hog is stopped', async () => (await how('hog')).running === false)
  const hog = await how('hog'), glut = await how('glut'), hoard = await how('hoard'), thief = await how('thief')
  check(/interrupted/.test(hog.error) && hog.calls === 5, `a rule that never returns is stopped each time and then for good (${hog.worst} ms at worst)`)
  check(glut.running === false && glut.error !== '', 'a rule that builds one endless string is stopped the same')
  const grown = await Promise.all([1, 2, 3].map((n) => how(`grow-${n}`)))
  // With its memory full a rule may run on in what it has, or fail call after call and be stopped: which, goes with
  // how many people it is told of and how busy the machine is (four runs in five failed here at load 20 when it had
  // to be running). What is checked is that it is one or the other, and said.
  check(grown.every((r) => r.running || r.error), `rules that take all the memory they can as they start are refused more by the platform: ${grown.filter((r) => r.running).length} of 3 run on in what they have, the rest say why not (${grown.find((r) => !r.running)?.error.slice(0, 60) ?? 'none'})`)
  await until('the stall is ended by the clock', async () => (await how('stall')).running === false, 8000)
  const stall = await how('stall'), regex = await how('regex'), mostly = await how('mostly'), thrash = await how('thrash')
  check(/took over 1000 ms/.test(stall.error), `a rule at work where no count of steps reaches is ended by the clock (${stall.error})`)
  check(regex.running === false && /interrupted/.test(regex.error), 'a regex that backtracks for ever is stopped')
  check(mostly.running === false && /four times in five/.test(mostly.error), 'a rule that fails four times in five is stopped as one that always fails is')
  // How long that takes goes with the machine (29 ms a call alone, 73 to 126 at load 10, where some calls count as slow):
  // said, not bounded. It runs on, or it has been stopped and says why.
  check(thrash.running || thrash.error !== '', `a rule that fills its memory every call does it in ${thrash.ms} ms a call (${thrash.worst} at worst) and ${thrash.running ? 'runs on' : 'was stopped'}`)
  // No rule runs in the world's own thread: whatever they did, the world answered.
  check(slowest < 5000, `and the world answered a question within ${slowest} ms all the while`)
  check(/keeps what it had/.test(hoard.error), 'a rule may keep only so much')
  const now = await person('Odile'), wren = (await around()).you
  check(Math.abs(now.at[0] - before.at[0]) < 2 && !wren.walking, 'a rule moves nobody but its own actors: not a person, not another rule\'s')
  check(thief.actors === 64, `a rule has at most 64 actors (${thief.actors})`)
  const crowd = (await around()).people.filter((p) => /^A+$/.test(p.name))
  check(crowd.length === 64 && crowd.every((p) => p.name.length === 24), 'names are cut and cleaned as anyone\'s are')
  const said = (await around()).heard
  check(said.filter((h) => h.text === 'again').length <= 8 * 2, 'what its actors say in a second is capped')
  const echoed = said.filter((h) => h.name === 'echo').length
  check(echoed >= 1 && echoed <= 8, `what an actor says is not told to rules: eight things were said and ${echoed} echoed, none of them an echo of an echo`)
  check((await rule('big', 'x'.repeat(40000))).refused === 400, 'a rule of more than 32,768 characters is refused')
  check((await post('join', { by: 'greeter/guide' })).refused === 400 && (await post('join', { by: 'anyone/at-all' })).refused === 400, 'nobody outside goes by a name that could be an actor\'s')
  await rule('fifteenth', `on('start', () => {})`); await rule('sixteenth', `on('start', () => {})`)
  check((await rule('seventeenth', `on('start', () => {})`)).refused === 409, 'a world has at most sixteen rules')
  check((await fetch(`${server.url}/world/ask`, { method: 'POST', headers: { Origin: 'http://elsewhere.example' }, body: JSON.stringify({ by: 'x', rule: { id: 'x', source: '1' } }) })).status === 403, 'a page of another site cannot put a rule in')

  // What sixty-four actors cost a rule that looks at every pair of people twice a second.
  for (const id of ['hog', 'glut', 'hoard', 'broken', 'shouts', 'thrash', 'regex', 'stall', 'mostly', 'fifteenth', 'sixteenth']) await post('ask', { by: 'tester', unrule: id })
  await rule('pairs', `on('tick', (world) => { let near = 0; for (const a of world.people) for (const b of world.people) if (Math.hypot(a.at[0] - b.at[0], a.at[2] - b.at[2]) < 30) near++; world.keep.near = near })`)
  await until('it has ticked', async () => (await how('pairs'))?.calls >= 6, 8000)
  const pairs = await how('pairs')
  // How long a call takes is said, not bounded: on a Mac shared by nine lanes (load 20) three lanes saw this line fail
  // for the machine's sake alone. Alone it is 1.3 to 2.8 ms. That the rule is still running is what is checked.
  check(pairs.running, `a rule that compares every pair of ${(await around()).people.length + 1} people takes ${pairs.ms} ms a call (${pairs.worst} at worst), twice a second, and runs on`)
  await post('ask', { by: 'tester', unrule: 'thief' })
  await until('the crowd goes with its rule', async () => !(await around()).people.some((p) => /^A+$/.test(p.name)))
  check(true, 'a rule taken out takes its actors with it')
  await post('ask', { by: 'tester', realm: { name: 'A street with a guide', about: 'Someone stands on the pavement and comes when called.' } })
  // An ask is answered before the world has done it: the server is not stopped until the name is the world's own.
  await until('the name is kept', async () => (await get('realm')).name === 'A street with a guide')
  await until('the thief is out', async () => !(await get('realm')).rules.includes('thief'))

  // The world started again on the same file: the rules are there, and their actors stand up again.
  server.stop()
  await wait(300)
  server = await serve('/dev/null', ['--world', file])
  await post('join', { by: 'wren', at: [700, 4060] })
  await until('the rule is back', async () => (await how('greeter'))?.actors === 1)
  const realm = await get('realm')
  check(realm.name === 'A street with a guide' && realm.rules.includes('greeter') && realm.rules.includes('pairs') && !realm.rules.includes('thief'), 'started again, the world has its name and its rules, and not the ones taken out')
  await until('the greedy ones are started again', async () => (await get('rules')).filter((r) => r.id.startsWith('grow-') && (r.running || r.error)).length === 3, 30000)
  check(true, 'and rules that take all the memory they can do not keep the world from starting')
  check((await get('rules?id=greeter')).source.includes('So far: '), 'each as it was last put')

  // The look a rule chose is the look the figure has.
  const browser = await chrome()
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&shared=1&fire=0&people=0&name=iris`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await page.evaluate(() => { const e = globalThis.engine; Object.assign(e.pose, { x: 70.25, y: e.ground(70.25, 403.4) + 1.6, z: 403.4, yaw: 0, pitch: -0.12 }) })
  await rule('greeter', GREETER.replaceAll("'#c9a23a'", "'#a8452f', tall: 1.15"))
  const seen = await page.waitForFunction(() => { const e = globalThis.engine; return e.folk.from.flatMap((f) => f(e.view(), 0)).find((p) => p.name === 'Odile' && p.look?.coat === '#a8452f') }, null, { timeout: 20_000 }).then((h) => h.jsonValue())
  check(seen.look.tall === 1.15, 'a page draws the actor in the coat and the build its rule chose, changed while the page watches')
  await page.evaluate(() => globalThis.engine.hud.line.onsubmit?.('Odile, come here'))
  await until('the actor answers a page', async () => (await get('around?by=wren&within=1200')).heard.some((h) => h.text === 'Coming, iris.'))
  check(true, 'what is typed on a page\'s ask bar is heard by the rule')
  if (arg('out', '')) { await page.waitForTimeout(4000); await page.screenshot({ path: arg('out', '') }) }
  await browser.close().catch(() => {})
} catch (e) {
  failures.push(String(e.stack ?? e))
}
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('rules: ok')
process.exit(0)
