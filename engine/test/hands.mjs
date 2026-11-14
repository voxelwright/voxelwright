// What a realm puts in a person's hands (#264): a rule offers things to do, the page makes keys and buttons of
// them knowing nothing of what they mean, and the rule hears who did which and what their aim met: a person, an
// actor or cells. The real server, the real world process and the real page; nothing stubbed. Two rules that are
// not alike and are no game: a stall that sells to whoever asks while looking at its keeper, and someone who can
// be waved at for as long as the wave is held, by one person only.
//
//   node test/hands.mjs [--out picture.png]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, serve } from './kit.mjs'

const file = join(mkdtempSync(join(tmpdir(), 'engine-hands-')), 'world.log')
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(400); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const get = (path) => send(path)
const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const until = async (what, ask, ms = 6000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(100)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }
const rule = (id, source, name = id) => post('ask', { by: 'tester', rule: { id, name, source } })
const how = async (id) => (await get('rules')).find((r) => r.id === id)
const heard = async (by) => (await get(`around?by=${by}&within=1200`)).heard.map((h) => h.text)
/** What the stream last said of a kind: 8 what is offered, 9 what is shown. */
const last = async (want) => {
  const r = await fetch(`${server.url}/world/stream?from=0`), reader = r.body.getReader()
  let held = Buffer.alloc(0), found = null
  const until = Date.now() + 1500
  while (Date.now() < until) {
    const got = await Promise.race([reader.read(), wait(300).then(() => null)])
    if (!got) { if (found) break; continue }
    held = Buffer.concat([held, got.value])
    for (let at = 0; held.length - at >= 12;) { const kind = held.readUInt32LE(at), size = held.readUInt32LE(at + 8); if (held.length - at < 12 + size) break; if (kind === want) found = JSON.parse(held.subarray(at + 12, at + 12 + size).toString()); at += 12 + size; if (held.length === at) held = Buffer.alloc(0) }
  }
  void reader.cancel()
  return found ?? []
}
const offered = () => last(8), shown = () => last(9)

// A stall: its keeper sells to whoever does "buy" while looking at them, and counts what each has had.
const STALL = `
on('start', (world) => {
  world.actor('keeper', { name: 'Marta', at: [700, 4009] })
  world.offer('buy', { word: 'Buy a pretzel', aim: true, key: 'KeyE' })
})
on('act', (world, e) => {
  if (e.action !== 'buy') return
  if (!e.met || !e.met.mine || e.met.id !== 'keeper') { world.actor('keeper', { say: 'Over here, ' + e.name + ': ' + (e.met ? e.met.kind : 'nothing') }); return }
  const had = world.keep[e.by] = (world.keep[e.by] || 0) + 1
  world.actor('keeper', { face: e.at, say: 'Pretzel ' + had + ' for ' + e.name + ', ' + e.met.far + ' cells off.' })
})`
// A kettle: nothing of a game. It shows everyone how near the boil it is and how many cups it has poured, and
// whoever asks for tea is shown a choice that is theirs alone.
const KETTLE = `
on('start', (world) => { world.keep.heat = 0; world.keep.cups = 0; world.show('kettle', { line: 'The kettle is on', meters: [{ label: 'Kettle', value: 0, of: 100, colour: '#e0803a' }], score: { label: 'cups', value: 0 } }) })
on('tick', (world) => {
  if (world.keep.heat >= 100) return
  world.keep.heat = Math.min(100, world.keep.heat + 20)
  world.show('kettle', { meters: [{ label: 'Kettle', value: world.keep.heat, of: 100, colour: '#e0803a' }], ...(world.keep.heat >= 100 ? { line: 'The kettle has boiled' } : {}) })
})
on('said', (world, e) => {
  if (/tea/i.test(e.text)) world.show('how-' + e.by.toLowerCase().replace(/[^a-z0-9]/g, ''), { line: 'How do you take it, ' + e.name + '?', choice: [{ id: 'milk', word: 'With milk' }, { id: 'lemon', word: 'With lemon' }], to: e.by })
  if (/markup/i.test(e.text)) world.show('odd', { line: '<img src=x onerror=globalThis.pwned=1><b>bold</b>', meters: [{ label: '<i>x</i>', value: 5, of: 2, colour: 'red;position:fixed' }, 'nonsense'], score: { label: 'n', value: 12.3456 }, choice: ['plain', { id: 'Bad Id', word: 'no' }] })
})
on('pick', (world, e) => {
  world.keep.cups += 1
  world.show(e.show, { hide: true })
  world.show('kettle', { score: { label: 'cups', value: world.keep.cups }, line: 'Tea ' + (e.pick === 'lemon' ? 'with lemon' : 'with milk') + ' for ' + e.name })
})`
// Someone to wave at: held, not aimed, and offered to one person alone.
const WAVER = `
on('start', (world) => world.actor('friend', { name: 'Ines', at: [716, 4009] }))
on('said', (world, e) => { if (/may i wave/i.test(e.text)) world.offer('wave', { word: 'Wave', hold: true, to: e.by }) ; if (/no more waving/i.test(e.text)) world.offer('wave', { word: null }) })
on('act', (world, e) => {
  if (e.phase === 'down') { world.keep.since = world.now; world.actor('friend', { face: e.at, say: e.name + ' waves at ' + (e.met && e.met.name ? e.met.name : 'nobody') + '.' }) }
  if (e.phase === 'up') world.actor('friend', { say: 'Waved.' })
})`
try {
  await post('join', { by: 'wren', at: [700, 4040] })
  await post('join', { by: 'robin', at: [716, 4040] })
  check((await rule('stall', STALL, 'A stall that sells')).asked && (await rule('waver', WAVER, 'Someone to wave at')).asked, 'two rules are taken')
  await until('both run', async () => (await how('stall'))?.actors === 1 && (await how('waver'))?.actors === 1)
  const first = await until('the stall offers', async () => { const o = await offered(); return o.length ? o : null })
  check(first.length === 1 && first[0].rule === 'stall' && first[0].id === 'buy' && first[0].word === 'Buy a pretzel' && first[0].aim && !first[0].hold && first[0].key === 'KeyE' && first[0].to === null, `what is offered is told to whoever joins the stream (${JSON.stringify(first)})`)
  check((await how('stall')).listens.includes('act'), 'the rule listens for act')

  // An aim that meets an actor: the keeper stands north of wren, whose eyes are 16 cells over their feet.
  const me = (await get('me?by=wren')).you, eyes = [me.at[0] + 0.5, me.at[1] + 16.5, me.at[2] + 0.5]
  const keeper = (await get('around?by=wren&within=1200')).people.find((p) => p.name === 'Marta')
  const at = (who, up = 9) => [who.at[0] + 0.5 - eyes[0], who.at[1] + up - eyes[1], who.at[2] + 0.5 - eyes[2]]
  check((await post('act', { by: 'wren', rule: 'stall', id: 'buy', from: eyes, to: at(keeper) })).done, 'something offered is done')
  await until('the keeper sells', async () => (await heard('wren')).some((t) => /^Pretzel 1 for wren, \d+ cells off\.$/.test(t)))
  check(true, `an aim that meets an actor reaches its rule as that actor (${(await heard('wren')).at(-1)})`)
  // An aim that meets someone else: robin, in a seat.
  const robin = (await get('around?by=wren&within=1200')).people.find((p) => p.name === 'robin')
  await post('act', { by: 'wren', rule: 'stall', id: 'buy', from: eyes, to: at(robin) })
  await until('the keeper is told who was met', async () => (await heard('wren')).includes('Over here, wren: seat'))
  check(true, 'an aim that meets a person says so (a seat, not the keeper)')
  // An aim at the ground meets cells; at the sky, nothing.
  await post('act', { by: 'wren', rule: 'stall', id: 'buy', from: eyes, to: [0.3, -1, 0.2] })
  await until('cells are met', async () => (await heard('wren')).includes('Over here, wren: cells'))
  await post('act', { by: 'wren', rule: 'stall', id: 'buy', from: eyes, to: [0, 1, 0] })
  await until('the sky is nothing', async () => (await heard('wren')).includes('Over here, wren: nothing'))
  check(true, 'an aim at the ground meets cells, and at the sky nothing')
  // Behind a wall the keeper is not met: the house fronts stand north of the pavement.
  await post('act', { by: 'wren', rule: 'stall', id: 'buy', from: [eyes[0], eyes[1], 3960], to: [0, 0, 1] })
  await wait(600)
  check(!(await heard('wren')).some((t) => t.startsWith('Pretzel 2')), 'through a house front the keeper is not met')
  // At arm's length the one in front is met though the eye's line passes beside them: an eye behind the shoulder, looking past the keeper.
  await post('walk', { by: 'wren', to: [keeper.at[0], keeper.at[2] + 14] })
  const close = await until('wren stands by the keeper', async () => { const y = (await get('me?by=wren')).you; return !y.walking && Math.hypot(y.at[0] - keeper.at[0], y.at[2] - keeper.at[2]) < 22 ? y : null }, 20_000)
  const sold = (await heard('wren')).filter((t) => t.startsWith('Pretzel')).length
  await post('act', { by: 'wren', rule: 'stall', id: 'buy', from: [close.at[0] + 9, close.at[1] + 22, close.at[2] + 32], to: [0, -0.1, -1] })
  const near = await until('the keeper sells at arm\'s length', async () => (await heard('wren')).filter((t) => t.startsWith('Pretzel'))[sold])
  check(Number(/(\d+) cells off/.exec(near)[1]) <= 22, `at arm's length the one in front is met though the eye's line passes beside them, and how far is told from the person, not the eye (${near})`)
  await post('walk', { by: 'wren', to: [me.at[0], me.at[2]] })
  await until('wren is back', async () => { const y = (await get('me?by=wren')).you; return !y.walking && Math.hypot(y.at[0] - me.at[0], y.at[2] - me.at[2]) < 6 }, 20_000)

  // Held, and for one person alone.
  await post('say', { by: 'robin', text: 'may I wave?' })
  const both = await until('the wave is offered', async () => { const o = await offered(); return o.length === 2 ? o : null })
  const wave = both.find((o) => o.id === 'wave')
  check(wave.hold && !wave.aim && wave.to.length === 1 && wave.to[0] === 'robin' && wave.key === '', `a held thing is offered to one person (${JSON.stringify(wave)})`)
  const no = await post('act', { by: 'wren', rule: 'waver', id: 'wave', from: eyes, to: [0, 0, -1] })
  check(no.refused === 409, `someone it is not offered to cannot do it (${no.why})`)
  const before = (await heard('robin')).filter((t) => t.startsWith('Over here')).length
  const rob = (await get('me?by=robin')).you, robEyes = [rob.at[0] + 0.5, rob.at[1] + 16.5, rob.at[2] + 0.5]
  const ines = (await get('around?by=robin&within=1200')).people.find((p) => p.name === 'Ines')
  const wavedAt = [ines.at[0] + 0.5 - robEyes[0], ines.at[1] + 9 - robEyes[1], ines.at[2] + 0.5 - robEyes[2]]
  await post('act', { by: 'robin', rule: 'waver', id: 'wave', phase: 'down', from: robEyes, to: wavedAt })
  await until('the wave is seen', async () => (await heard('robin')).includes('robin waves at Ines.'))
  await post('act', { by: 'robin', rule: 'waver', id: 'wave', phase: 'up', from: robEyes, to: wavedAt })
  await until('the wave ends', async () => (await heard('robin')).includes('Waved.'))
  check(true, 'held and let go, the rule hears both, and who the wave was at')
  check((await heard('robin')).filter((t) => t.startsWith('Over here')).length === before, 'and the other rule heard nothing of it')

  // What is not as it should be is said, and the rest stands; taken back, it is gone; a rule gone takes its offers.
  await rule('stall', STALL.replace("key: 'KeyE'", "key: 'KeyW'"))
  await until('the changed rule runs', async () => /a key is/.test((await how('stall'))?.error ?? ''))
  check((await offered()).find((o) => o.id === 'buy').key === '', 'a key the body moves by is not given, and the rule is told')
  check((await post('act', { by: 'wren', rule: 'stall', id: 'nothing', from: eyes, to: [0, 0, -1] })).refused === 409, 'what was never offered cannot be done')
  await post('say', { by: 'robin', text: 'no more waving' })
  await until('the wave is taken back', async () => (await offered()).length === 1)
  await post('ask', { by: 'tester', unrule: 'stall' })
  await until('a rule that is gone offers nothing', async () => (await offered()).length === 0)
  check(true, 'taken back, or its rule taken out, an offer is gone')

  // What a realm shows: a line, a meter, a score, to everyone; a choice, to the one who asked.
  check((await rule('kettle', KETTLE, 'A kettle')).asked, 'a third rule is taken')
  const first9 = await until('the kettle is shown', async () => { const s = await shown(); return s.length ? s : null })
  check(first9.length === 1 && first9[0].rule === 'kettle' && first9[0].line === 'The kettle is on' && first9[0].meters[0].label === 'Kettle' && first9[0].meters[0].colour === '#e0803a' && first9[0].score.value === '0' && first9[0].to === null, `what is shown is told to whoever joins the stream (${JSON.stringify(first9[0])})`)
  const boiled = await until('the kettle boils by the rule\'s own count', async () => { const s = (await shown())[0]; return s.meters[0].full === 1 && s.line === 'The kettle has boiled' ? s : null }, 12_000)
  check(boiled.meters[0].full === 1, 'a meter is the rule\'s own number, moved by its ticks')
  await post('say', { by: 'wren', text: 'tea, please' })
  const asked = await until('a choice is shown to the one who asked', async () => (await shown()).find((s) => s.choice))
  check(asked.to.length === 1 && asked.to[0] === 'wren' && asked.choice.map((c) => c.id).join() === 'milk,lemon' && asked.line === 'How do you take it, wren?', `a choice is shown to the one who asked (${JSON.stringify(asked)})`)
  check((await post('pick', { by: 'robin', rule: 'kettle', id: asked.id, pick: 'lemon' })).refused === 409, 'someone it is not shown to cannot pick')
  check((await post('pick', { by: 'wren', rule: 'kettle', id: asked.id, pick: 'whisky' })).refused === 409, 'nor can anyone pick what is not among the picks')
  check((await post('pick', { by: 'wren', rule: 'kettle', id: asked.id, pick: 'lemon' })).done, 'a pick is taken')
  const poured = await until('the rule hears the pick', async () => { const all = await shown(); return all.length === 1 && all[0].score.value === '1' ? all[0] : null })
  check(poured.line === 'Tea with lemon for wren', `the rule hears who picked what, and the choice is gone (${poured.line})`)
  // What is not as it should be is cleaned or left out, and the rule is told.
  await post('say', { by: 'wren', text: 'markup' })
  const odd = await until('the odd one is shown', async () => (await shown()).find((s) => s.id === 'odd'))
  check(odd.meters.length === 1 && odd.meters[0].full === 1 && odd.meters[0].colour === '' && odd.score.value === '12.35' && odd.choice.length === 1 && odd.choice[0].id === 'plain', `a meter over full is full, a colour that is no colour is none, a pick with a bad id is left out (${JSON.stringify(odd)})`)
  check(/a pick of "odd"|a meter of "odd"/.test((await how('kettle')).error), `and the rule is told what was wrong (${(await how('kettle')).error})`)

  // The page: keys and buttons made of what is offered, by code that knows nothing of pretzels.
  await rule('stall', STALL)
  await until('the stall is back', async () => (await offered()).length === 1)
  const browser = await chrome()
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
    // In the street south of the keeper, looking north at her.
    await page.goto(`${server.url}/city?fly=0&shared=1&name=Ada&scale=0.5&people=0&at=70.05,${(me.at[1] + 16.5) / 10},402.6&look=0,-8`)
    await page.waitForFunction(() => globalThis.engine?.hands, null, { timeout: 90_000 })
    await page.waitForFunction(() => globalThis.engine.hands.offered.length === 1, null, { timeout: 20_000 })
    const buttons = await page.evaluate(() => [...document.querySelectorAll('[data-panel="offers"] button')].map((b) => b.textContent))
    check(buttons.length === 1 && /E\s*Buy a pretzel/.test(buttons[0]), `the page shows what is offered, with its key (${buttons.join(' | ')})`)
    await page.waitForFunction(() => globalThis.engine.others >= 1)
    await page.keyboard.press('KeyE')
    await until('the key sells', async () => (await heard('wren')).some((t) => /^Pretzel 1 for Ada/.test(t)), 8000)
    check(true, `the key does it, at what the eye is on (${(await heard('wren')).find((t) => /for Ada/.test(t))})`)
    await page.click('[data-panel="offers"] button')
    await until('the button sells', async () => (await heard('wren')).some((t) => /^Pretzel 2 for Ada/.test(t)), 8000)
    check(true, 'so does its button')
    // What the realm shows is on the screen: the rule's words as text, never as markup; its meter as wide as it is full.
    await page.waitForFunction(() => globalThis.engine.hands.shown.length === 2, null, { timeout: 10_000 })
    const cards = await page.evaluate(() => { const k = document.querySelector('[data-show="kettle/kettle"]'), o = document.querySelector('[data-show="kettle/odd"]'), fill = k.querySelector('.meter i i'), bar = k.querySelector('.meter > i'); return { line: k.querySelector('.line').textContent, score: k.querySelector('.score b').textContent, full: fill.getBoundingClientRect().width / bar.getBoundingClientRect().width, colour: getComputedStyle(fill).backgroundColor, odd: o.querySelector('.line').textContent, tags: o.querySelectorAll('img, b:not(.score b)').length - o.querySelectorAll('.score b').length, pwned: globalThis.pwned === 1, oddFill: o.querySelector('.meter i i').getAttribute('style') } })
    check(/^Tea with lemon for wren$/.test(cards.line) && cards.score === '1' && cards.full > 0.98 && cards.colour === 'rgb(224, 128, 58)', `the page shows the line, the score and the meter as full and in the colour the rule gave (${cards.line}; ${cards.score}; ${cards.full.toFixed(2)}; ${cards.colour})`)
    check(cards.odd.startsWith('<img src=x') && !cards.pwned && !/position|red/.test(cards.oddFill), `markup a rule shows is words on the screen and runs nothing (${cards.odd.slice(0, 24)}…)`)
    await page.evaluate(() => globalThis.engine.say('tea for me'))
    await page.waitForSelector('[data-panel="shown"] .picks button', { timeout: 10_000 })
    const mine = await page.evaluate(() => globalThis.engine.hands.shown.filter((s) => s.choice && s.line.includes('Ada')).length)
    check(mine === 1, 'a choice asked for from the page is shown on that page')
    if (arg('out')) { await page.waitForFunction(() => { const st = globalThis.engine.world.stats; return st.wanted === 0 && st.stale === 0 && st.ready > 0 }, null, { timeout: 120_000 }).catch(() => {}); await page.waitForTimeout(500); await page.screenshot({ path: arg('out').replace(/\.png$/, '-shown.png') }) }
    await page.click('[data-panel="shown"] .picks button:has-text("With milk")')
    await until('the page\'s pick is heard', async () => (await shown()).some((s) => s.line === 'Tea with milk for Ada'), 8000)
    const went = await page.waitForFunction(() => globalThis.engine.hands.shown.every((s) => !s.line.includes('How do you take it, Ada')) && [...document.querySelectorAll('[data-panel="shown"] .line')].every((l) => !l.textContent.includes('How do you take it, Ada')), null, { timeout: 8000 }).then(() => true, () => false)
    check(went, 'picked on the page, the rule hears it and the choice is gone from the screen')
    // With the wand in hand, what is aimed is an entry of the wand's wheel, and a cast does it.
    const entries = await page.evaluate(() => { const w = globalThis.engine.wand; w.held = true; return w.powers.map((p) => p.name) })
    check(entries.includes('Buy a pretzel') && entries.length === 2, `the wand's wheel has it beside the spell in hand (${entries.join(', ')})`)
    await page.evaluate(() => { const w = globalThis.engine.wand; w.power = w.powers.findIndex((p) => p.name === 'Buy a pretzel'); w.cast() })
    await until('the wand sells', async () => (await heard('wren')).some((t) => /^Pretzel 3 for Ada/.test(t)), 8000)
    check(true, 'and a cast with it chosen does it')
    await page.evaluate(() => { globalThis.engine.wand.held = false })
    if (arg('out')) { await page.waitForFunction(() => { const st = globalThis.engine.world.stats; return st.wanted === 0 && st.stale === 0 && st.ready > 0 }, null, { timeout: 120_000 }).catch(() => {}); await page.waitForTimeout(800); await page.screenshot({ path: arg('out') }) }
    // The wave, held: offered to this page alone when it asks.
    await page.evaluate(() => globalThis.engine.say('may I wave?'))
    await page.waitForFunction(() => globalThis.engine.hands.offered.length === 2, null, { timeout: 10_000 })
    const key = await page.evaluate(() => globalThis.engine.hands.offered.find((o) => o.id === 'wave').code)
    check(/^Key[A-Z]$/.test(key) && key !== 'KeyE', `the page picks a key of its own for one that asked for none (${key})`)
    await page.keyboard.down(key)
    await until('the held key is heard', async () => (await heard('wren')).some((t) => /^Ada waves at /.test(t)), 8000)
    const waved = async () => (await heard('wren')).filter((t) => t === 'Waved.').length
    await wait(700)
    check(await waved() === 1, 'held, it is not yet let go')
    await page.keyboard.up(key)
    await until('let go is heard', async () => await waved() === 2, 8000)
    check(true, 'a held key is heard going down and coming up')
    await context.close()

    // A phone: buttons to touch, held for as long as the finger is down.
    const small = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, screen: { width: 844, height: 390 } })
    const phone = await small.newPage()
    phone.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
    await phone.goto(`${server.url}/city?fly=0&shared=1&name=Bea&scale=0.5&people=0&at=70.05,${(me.at[1] + 16.5) / 10},402.6&look=0,-8`)
    // A page's first words, said the moment it is up and before the world has heard where it is, are heard: the world
    // refuses them (409) until it has, and they used to be lost without a word.
    await phone.waitForFunction(() => globalThis.engine?.say, null, { timeout: 90_000 })
    await phone.evaluate(() => globalThis.engine.say('tea for me'))
    const first = await until('first words', async () => (await shown()).some((s) => s.line === 'How do you take it, Bea?'), 8000).then(() => true, () => false)
    check(first, 'what a page says the moment it opens is heard')
    await phone.waitForFunction(() => globalThis.engine?.hands?.offered.length === 1, null, { timeout: 90_000 })
    await phone.waitForFunction(() => globalThis.engine.others >= 1)
    await phone.tap('[data-panel="offers"] button')
    await until('a touch sells', async () => (await heard('wren')).some((t) => /^Pretzel 1 for Bea/.test(t)), 8000)
    const box = await phone.evaluate(() => { const r = document.querySelector('[data-panel="offers"] button').getBoundingClientRect(); return [r.width, r.height] })
    check(box[1] >= 44, `on a phone it is a button big enough to touch (${box.map(Math.round).join(' by ')}), and a touch does it`)
    if (arg('out')) await phone.screenshot({ path: arg('out').replace(/\.png$/, '-phone.png') })
    await small.close()
  } finally { await browser.close() }
} catch (e) {
  check(false, `the check ran to its end (${e.message.split('\n')[0]})`)
}
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('hands: ok')
process.exit(0)
