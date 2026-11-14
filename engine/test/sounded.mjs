// What a realm sounds like (#264, #247): a rule makes a sound at a place or on someone, and everyone near hears it
// as the world's own sounds are heard. The real server, the real world process and the real page, its sound tapped
// as it leaves the synthesiser and measured here. Two rules that are not alike and are no game: a clock on a tower
// that strikes and plays its quarters, and a smith who hammers while someone stands by, with an anvil whose sound
// the rule wrote itself. A third sends what no rule should, and none of it is heard.
//
// What this cannot say: whether a bell sounds like a bell. That is for ears (/page/sound/lab.html).
//
//   node test/sounded.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chrome, serve } from './kit.mjs'
import * as ears from './ears.mjs'
import { LIKES } from '../page/sound/likes.ts'
import { patch } from '../page/sound/patch.ts'

const file = join(mkdtempSync(join(tmpdir(), 'engine-sounded-')), 'world.log')
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(400); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const rule = (id, source) => post('ask', { by: 'tester', rule: { id, name: id, source } })
const how = async (id) => (await send('rules')).find((r) => r.id === id)
const until = async (what, ask, ms = 8000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(100)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }
/** Every sound the world tells of from now for so long: frames of kind 10. */
const listen = async (ms) => {
  const r = await fetch(`${server.url}/world/stream?from=0`), reader = r.body.getReader(), found = []
  let held = Buffer.alloc(0)
  // One read is asked for at a time and waited on until it answers: a read left behind would take the next frames with it.
  let reading = null
  for (const until = Date.now() + ms; Date.now() < until;) {
    reading ??= reader.read()
    const got = await Promise.race([reading, wait(Math.max(1, until - Date.now())).then(() => null)])
    if (!got) break
    reading = null
    if (!got.value) break
    held = Buffer.concat([held, got.value])
    let at = 0
    for (; held.length - at >= 12;) { const kind = held.readUInt32LE(at), size = held.readUInt32LE(at + 8); if (held.length - at < 12 + size) break; if (kind === 10) found.push(JSON.parse(held.subarray(at + 12, at + 12 + size).toString())); at += 12 + size }
    held = held.subarray(at)
  }
  void reader.cancel()
  return found
}

// A clock on a tower 60 m east of the street's start: it strikes a big bell every two seconds, and when someone
// says "quarters" it plays four notes on smaller bells.
const CLOCK = `
on('tick', (world) => {
  world.keep.n = (world.keep.n || 0) + 1
  if (world.keep.n % 4 === 0) world.sound({ like: 'bell', at: [1300, 4012], size: 2, force: 0.9, reach: 80 })
})
on('said', (world, e) => {
  if (/quarters/.test(e.text)) world.sound({ like: 'bell', at: [1300, 4012], notes: [76, 72, 74, 67], gap: 400, size: 0.7 })
})`
// A smith by the pavement: he hammers while anyone is within ten metres, each blow of its own weight, on an anvil
// whose sound is the rule's own patch; when they go he stops.
const ANVIL = { how: 'struck', hard: 1, rough: 0.1, shape: 'bar', pitch: 940, ring: 0.7, damp: 0.15, gain: 0.8 }
const SMITH = `
on('start', (world) => { world.actor('smith', { name: 'Odo', at: [760, 4012] }) })
on('tick', (world) => {
  const me = world.people.find((p) => p.mine)
  if (!me || !world.near(me.at, 100).some((p) => !p.mine)) return
  world.keep.blows = (world.keep.blows || 0) + 1
  world.sound({ on: 'smith', patch: ${JSON.stringify(ANVIL)}, force: world.keep.blows % 3 ? 0.5 : 1, reach: 15 })
})`
// What no rule should send. Every line of it is left, and the rule is told why.
const ROT = `
on('said', (world, e) => {
  if (e.text === 'rot') {
    world.sound({ like: 'trombone', at: [700, 4012] })
    world.sound({ like: 'bell' })
    world.sound({ like: 'bell', on: 'nobody-here' })
    world.sound({ like: 'bell', at: [700, 4012], script: 'x' })
    world.sound({ at: [700, 4012], patch: { how: 'struck', hard: 9, rough: 0, shape: 'bar', pitch: 440, ring: 1, damp: 0, gain: 1 } })
    world.sound({ at: [700, 4012], patch: { how: 'struck', hard: 1, rough: 0, shape: 'bar', pitch: 440, ring: 1, damp: 0, gain: 1, run: 'alert(1)' } })
    world.sound({ at: [700, 4012], like: 'bell', patch: {} })
    world.sound({ at: [700, 4012], patch: { how: 'struck', hard: 1, rough: 0, modes: Array(12).fill([1.000001, 0.123456789]).concat(Array(200).fill([2, 1])), pitch: 440, ring: 1, damp: 0, gain: 1 } })
  }
  if (e.text === 'flood') for (let i = 0; i < 40; i++) world.sound({ like: 'click', at: [700, 4012] })
  if (e.text === 'edges') world.sound({ like: 'pipe', at: [700, 4012], force: 7, size: 99, note: 900, gap: -3, for: 600, reach: 1e9 })
})`

let browser
try {
  console.log('The form')
  check(Object.values(LIKES).every((l) => l.patches.every((p) => 'patch' in patch(JSON.parse(JSON.stringify(p)))) && l.says && l.reach >= 2 && l.reach <= 300), `the ${Object.keys(LIKES).length} kept sounds are patches in the form, each with what it is like and how far it carries`)
  const guide = await (await fetch(`${server.url}/world/`)).text()
  check(/world\.sound\(/.test(guide) && Object.keys(LIKES).every((k) => guide.includes(`${k} (`)) && guide.includes('patch: a sound of your own'), 'the guide a model writes rules from names world.sound, every kept sound and the patch’s form')

  console.log('Two rules that are not alike')
  await post('join', { by: 'ada', at: [700, 4012] })
  await rule('clock', CLOCK)
  // A rule takes a moment to start: counted from its first strike.
  await until('the clock strikes', async () => (await listen(600)).some((s) => s.like === 'bell'), 15_000)
  let heard = await listen(4600)
  const strikes = heard.filter((s) => s.like === 'bell')
  check(strikes.length >= 2 && strikes.length <= 3 && strikes.every((s) => s.size === 2 && s.reach === 80 && s.at[0] === 1300 && s.at[2] === 4012 && s.hz.length === 0), `a clock strikes its bell by the rule's own count: ${strikes.length} in 4.6 s, each at the tower (${JSON.stringify(strikes[0]?.at)}), size 2`)
  const tune = listen(1500)
  await post('say', { by: 'ada', text: 'play the quarters' })
  const quarters = (await tune).find((s) => s.hz?.length === 4)
  check(quarters && Math.abs(quarters.hz[0] - 659.26) < 0.1 && quarters.gap === 400, `asked, it plays four notes one after another (${quarters?.hz.map((h) => h.toFixed(0)).join(', ')} Hz, ${quarters?.gap} ms apart)`)
  await post('ask', { by: 'tester', unrule: 'clock' })
  await rule('smith', SMITH)
  await post('join', { by: 'ada', at: [730, 4012] })
  await until('the smith hammers', async () => (await listen(600)).some((s) => s.patch), 15_000)
  heard = await listen(2300)
  const blows = heard.filter((s) => s.patch)
  check(blows.length >= 3 && blows.every((s) => JSON.stringify(s.patch) === JSON.stringify(ANVIL) && s.at[0] === 760 && s.at[1] > 160) && new Set(blows.map((s) => s.force)).size === 2, `a smith hammers while someone stands by, on an anvil whose sound the rule wrote: ${blows.length} blows where he stands (${JSON.stringify(blows[0]?.at)}), light and heavy`)
  await post('join', { by: 'ada', at: [1100, 4012] })
  await wait(700)
  heard = await listen(1800)
  check(heard.length === 0, 'she walks off and he stops')
  await post('join', { by: 'ada', at: [730, 4012] })

  console.log('From a stranger')
  await rule('rot', ROT)
  let rubbish = listen(1500)
  await post('say', { by: 'ada', text: 'rot' })
  rubbish = (await rubbish).filter((s) => !s.patch || JSON.stringify(s.patch) !== JSON.stringify(ANVIL))
  const why = (await how('rot'))?.error
  check(rubbish.length === 0 && why, `a sound like nothing kept, at no place, on nobody, with a stray field, with a patch out of range, with a patch that has a stray key, with both, with a patch too long: none is told to anyone, and the rule is told why ("${why}")`)
  let flood = listen(1600)
  await post('say', { by: 'ada', text: 'flood' })
  flood = (await flood).filter((s) => s.like === 'click')
  check(flood.length === 12, `forty sounds asked for in one answer: ${flood.length} are made (twelve a second from one rule) and the rule is told ("${(await how('rot'))?.error}")`)
  await wait(1100)
  let edges = listen(1500)
  await post('say', { by: 'ada', text: 'edges' })
  edges = (await edges).find((s) => s.like === 'pipe')
  check(edges && edges.force === 0.7 && edges.size === 1 && edges.hz.length === 0 && edges.gap === 0 && edges.for === 0 && edges.reach === LIKES.pipe.reach, `numbers out of range are left at what they would have been unsaid (${JSON.stringify({ force: edges?.force, size: edges?.size, for: edges?.for, reach: edges?.reach })})`)
  await post('ask', { by: 'tester', unrule: 'rot' })
  await post('ask', { by: 'tester', unrule: 'smith' })
  await post('leave', { by: 'ada' })

  console.log('Heard')
  browser = await chrome()
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  // Standing 30 m west of the smith, facing north: he is on the right. The clock's tower is 54 m beyond him.
  await rule('smith', SMITH)
  await page.goto(`${server.url}/city?fly=0&shared=1&scale=0.4&people=0&music=0&at=46,17.8,401.2&look=0,0`)
  await page.waitForFunction(() => globalThis.engine?.ears, null, { timeout: 90_000 })
  await page.mouse.click(640, 300)
  await page.waitForFunction(() => globalThis.engine.ears.voice.running)
  await page.evaluate(async () => {
    const v = globalThis.engine.ears.voice, ctx = v.context
    await ctx.audioWorklet.addModule('/page/sound/tap.ts')
    const tap = new AudioWorkletNode(ctx, 'village-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
    v.out.connect(tap)
    globalThis.heard = { parts: [], sr: ctx.sampleRate }
    tap.port.onmessage = (e) => globalThis.heard.parts.push(e.data)
  })
  const take = async (from, to) => {
    const got = await page.evaluate(([from, to]) => {
      const h = globalThis.heard, a = Math.round(from * h.sr), b = Math.round(to * h.sr), l = new Float32Array(b - a), r = new Float32Array(b - a)
      for (const p of h.parts) for (let i = Math.max(0, a - p.from); i < p.l.length && p.from + i < b; i++) { l[p.from + i - a] = p.l[i]; r[p.from + i - a] = p.r[i] }
      const text = (x) => { const u = new Uint8Array(x.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }
      return { l: text(l), r: text(r), sr: h.sr }
    }, [from, to])
    const f = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4) }
    return { l: f(got.l), r: f(got.r), sr: got.sr }
  }
  const clock = () => page.evaluate(() => globalThis.engine.ears.voice.context.currentTime)
  // The smith hammers when someone is within ten metres: the page is not, so a seat stands by him.
  await post('join', { by: 'bea', at: [750, 4012] })
  await page.waitForFunction(() => globalThis.engine.ears.count.rules > 0, null, { timeout: 15_000 })
  let t0 = await clock()
  await wait(2200)
  const smithy = await take(t0, t0 + 2), mono = smithy.l.map((v, i) => v + smithy.r[i])
  const ring = ears.peaks(mono, smithy.sr, { most: 3, size: 32768 }).map((p) => p.hz)
  check(ring.some((hz) => Math.abs(hz / 940 - 1) < 0.02) && ears.rms(smithy.r) > ears.rms(smithy.l) * 1.3, `the page hears the anvil at its own pitch (${ring.map((h) => h.toFixed(0)).join(', ')} Hz) and from the right, where the smith is (right ${ears.db(ears.rms(smithy.r) / ears.rms(smithy.l)).toFixed(1)} dB over left)`)
  await post('leave', { by: 'bea' })
  await post('ask', { by: 'tester', unrule: 'smith' })
  await wait(1500)
  // The clock, 57 m off: its bell arrives late by the distance, and low (a bell of size 2).
  await rule('clock', CLOCK)
  const began = await page.evaluate(() => new Promise((done) => { const e = globalThis.engine.ears, n = e.count.rules, c = e.voice.context; const look = () => (e.count.rules > n ? done(c.currentTime) : setTimeout(look, 5)); look() }))
  await wait(1600)
  const bell = await take(began, began + 1.4), bm = bell.l.map((v, i) => v + bell.r[i]), quiet = ears.rms(bm, 0, Math.round(0.1 * bell.sr))
  const arrived = ears.onset(bm, bell.sr, Math.max(0.004, quiet * 8)), far = Math.hypot(1300 - 460, 16) / 10, low = ears.peaks(bm, bell.sr, { from: Math.round((arrived + 0.05) * bell.sr), most: 4, size: 16384 }).map((p) => p.hz)
  check(Math.abs(arrived - far / 343) < 0.05, `the clock's bell, ${far.toFixed(0)} m off, is heard ${arrived.toFixed(2)} s after the rule strikes it (sound takes ${(far / 343).toFixed(2)} s)`)
  check(low.some((hz) => Math.abs(hz / 260 - 1) < 0.03), `and it is a big bell: its lowest tone is at ${Math.min(...low).toFixed(0)} Hz (a bell of 520 Hz at size 2)`)
  const told = await page.evaluate(() => globalThis.engine.ears.voice.told)
  check(told && told.reset === 0 && told.dropped === 0 && told.peak <= 0.891, `nothing was dropped and nothing left over the ceiling (peak ${ears.db(told?.peak ?? 0).toFixed(1)} dB)`)
} catch (e) { check(false, `the check itself failed: ${e.stack ?? e}`) }
await browser?.close().catch(() => {})
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('sounded: ok')
process.exit(0)
