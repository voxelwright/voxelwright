// A sound that follows who makes it (#264, #247): a rule says it once and it stays on its maker, heard moving, until
// the rule stops it or its maker or the rule goes. The real server, world process and page, the page's sound tapped
// and measured. Two rules that are not alike and are no game: a milk float that drives past with its motor running,
// and a postman whose feet are heard as he runs on the spot, who hums on whoever asks and starts a car's motor.
//
// What this cannot say: whether a motor sounds like a motor. That is for ears.
//
//   node test/follows.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chrome, serve } from './kit.mjs'
import * as ears from './ears.mjs'

const file = join(mkdtempSync(join(tmpdir(), 'engine-follows-')), 'world.log')
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(400); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const rule = (id, source) => post('ask', { by: 'tester', rule: { id, name: id, source } })
const how = async (id) => (await send('rules')).find((r) => r.id === id)

// A milk float: it waits 14 m to one side of the street's start, and said "go" it drives 28 m past. Its motor is
// said once. Said "faster" the motor's note goes up an octave; said "park" the rule stops it.
const FLOAT = `
on('start', (world) => { world.actor('float', { name: 'the milk float', at: [560, 4010] }); world.sound({ as: 'motor', on: 'float', like: 'engine', note: 45, reach: 6 }) })
on('said', (world, e) => {
  if (/go/.test(e.text)) world.actor('float', { to: [840, 4010] })
  if (/faster/.test(e.text)) world.sound({ as: 'motor', note: 57 })
  if (/park/.test(e.text)) world.sound({ as: 'motor', stop: true })
})`
// A postman: his feet, a thud made again three times a second. Said "hum" he hums on whoever is at a page, starts the motor of a
// living thing he is told of, and leaves when told to.
const POST = `
on('start', (world) => { world.actor('postie', { name: 'Odo', at: [705, 4015] }); world.sound({ as: 'feet', on: 'postie', like: 'thud', every: 300, force: 0.5, reach: 6 }) })
on('said', (world, e) => {
  const page = world.people.find((p) => p.kind === 'page')
  if (/hum/.test(e.text) && page) world.sound({ as: 'hum', on: page.id, like: 'pipe', note: 72 })
  const car = /^car (\\S+)/.exec(e.text)
  if (car) world.sound({ as: 'car', on: car[1], like: 'engine', note: 40 })
  if (/leave/.test(e.text)) world.gone('postie')
})`

let browser
try {
  console.log('A sound that follows')
  browser = await chrome()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&shared=1&scale=0.4&people=0&music=0&at=70,17.8,403&look=0,0`)
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
  const now = () => page.evaluate(() => { const e = globalThis.engine.ears; return { t: e.voice.context.currentTime, following: e.following, followed: e.count.followed, rules: e.count.rules } })
  const one = async (key) => (await now()).following.find((f) => f.key === key)
  const until = async (what, ask, ms = 15_000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(120)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }
  /** How loud each side is in the band a motor at that pitch sounds in, over a second ending now. */
  /** How strong one tone is in a second of sound: the tallest line within a fortieth of a pitch. A band would take in the street's own wind. */
  const line1 = (x, sr, hz) => { const p = ears.spectrum(x, 0, 32768), bin = sr / 32768; let m = 0; for (let i = Math.floor((hz * 0.975) / bin); i <= Math.ceil((hz * 1.025) / bin); i++) m = Math.max(m, p[i]); return Math.sqrt(m) }
  const tones = async (hz) => { const t = (await now()).t, s = await take(t - 1.1, t - 0.1); return { l: line1(s.l, s.sr, hz), r: line1(s.r, s.sr, hz), s } }
  const sides = async (lo, hi) => { const t = (await now()).t, s = await take(t - 1.1, t - 0.1); return { l: ears.band(s.l, s.sr, lo, hi), r: ears.band(s.r, s.sr, lo, hi), s } }

  await post('join', { by: 'tester', at: [700, 4060] })
  await rule('float', FLOAT)
  await until('the motor is heard', async () => (await one('float/motor'))?.sounding)
  await wait(1500)
  // Measured at the motor's own strongest tone (twice 110 Hz): the street has a wind of its own across the rest.
  const before = await now(), first = await tones(220)
  await post('say', { by: 'tester', text: 'go' })
  // The float drives past: where it is heard from is read as it goes.
  const line = []
  for (const began = Date.now(); Date.now() - began < 45_000; await wait(250)) {
    const n = await now(), f = n.following.find((f) => f.key === 'float/motor')
    line.push({ t: n.t, gain: f?.gain ?? 0 })
    const top = Math.max(...line.map((p) => p.gain))
    if (line.length > 12 && f && f.gain < top * 0.5 && line.at(-1).gain <= line.at(-4).gain) break
  }
  await wait(800)
  const peak = line.reduce((a, b) => (b.gain > a.gain ? b : a)), mid = await take(peak.t - 0.5, peak.t + 0.5), last = await tones(220), after = await now()
  const midL = line1(mid.l, mid.sr, 220), midR = line1(mid.r, mid.sr, 220)
  check(after.followed - before.followed === 0 && after.rules === 0, `a milk float drove past with its motor running: the motor was begun once and never again over ${(after.t - before.t).toFixed(0)} s, and the rule made no other sound`)
  check(first.l > first.r * 1.3 && last.r > last.l * 1.3, `it was heard on one side as it came and on the other as it went (left over right ${(first.l / first.r).toFixed(2)} then ${(last.l / last.r).toFixed(2)})`)
  check(peak.gain > line[0].gain * 1.5 && peak.gain > line.at(-1).gain * 1.5 && midL + midR > (first.l + first.r) * 1.3, `and loudest as it passed (${line[0].gain.toFixed(2)}, ${peak.gain.toFixed(2)}, ${line.at(-1).gain.toFixed(2)} of full; ${ears.db((midL + midR) / (first.l + first.r)).toFixed(1)} dB over where it began)`)
  // No step anywhere in the pass: the level of each 50 ms never jumps by more than a little against its neighbour.
  const whole = await take(before.t, after.t), env = ears.envelope(whole.l.map((v, i) => v + whole.r[i]), whole.sr, 50)
  let jump = 0
  for (let i = 1; i < env.length; i++) if (env[i - 1] > 1e-4) jump = Math.max(jump, env[i] / env[i - 1])
  // A clip of the pass for ears, if asked for: OUT=<folder>.
  if (process.env.OUT) { ears.wav(join(process.env.OUT, 'float.wav'), whole.l, whole.r, whole.sr); ears.spectrogram(join(process.env.OUT, 'float-spec.png'), whole.l.map((v, i) => v + whole.r[i]), whole.sr) }
  check(jump < 1.6, `nothing stepped: no 50 ms was more than ${jump.toFixed(2)} times as loud as the one before`)

  // Faster: the pitch goes up in the note that is sounding.
  const tone = (x, hz) => ears.band(x.s.l, x.s.sr, hz * 0.96, hz * 1.04) + ears.band(x.s.r, x.s.sr, hz * 0.96, hz * 1.04)
  const was = { at110: tone(last, 110), at440: tone(last, 440) }
  await post('say', { by: 'tester', text: 'faster' })
  const way = []
  for (const began = Date.now(); Date.now() - began < 3000; await wait(60)) { const f = await one('float/motor'); if (f) way.push(f.hz) }
  await wait(600)
  const high = await sides(60, 1000), then = await now()
  check(way.some((hz) => hz > 120 && hz < 200) && Math.abs(way.at(-1) - 220) < 2 && then.followed === after.followed, `said "faster", its pitch glides from 110 to 220 Hz in the note that is sounding (${way.filter((_, i) => i % 6 === 0).map((h) => h.toFixed(0)).join(', ')}): nothing is begun again`)
  check(tone(high, 110) < was.at110 * 0.25 && tone(high, 440) > was.at440 * 2, `and what is heard goes up an octave: its tone at 110 Hz is gone (${ears.db(tone(high, 110) / was.at110).toFixed(0)} dB) and there is one at 440 (${ears.db(tone(high, 440) / was.at440).toFixed(0)} dB)`)
  await post('say', { by: 'tester', text: 'park' })
  await until('the motor stops', async () => !(await one('float/motor')))
  check(true, 'said "park", the rule stops it')
  await post('ask', { by: 'tester', unrule: 'float' })

  // Eight at once from two rules (a rule has six), every kind of long tone among them: the six nearest sound, each begun once and none begun again.
  const band = (from) => "on('start', (world) => { const likes = ['pipe', 'horn', 'whistle', 'engine', 'pipe', 'horn', 'pipe', 'pipe']; for (let i = " + from + "; i < " + (from + 4) + "; i++) { world.actor('p' + i, { name: 'player ' + i, at: [640 + 20 * i, 4000 - 12 * i] }); world.sound({ as: 's' + i, on: 'p' + i, like: likes[i], note: 48 + 3 * i, force: 0.3, reach: 8 }) } })"
  await rule('banda', band(0))
  await rule('bandb', band(4))
  const inBand = (n) => n.following.filter((f) => f.key.startsWith('band'))
  await until('eight said', async () => inBand(await now()).length === 8)
  await until('six of eight', async () => inBand(await now()).filter((f) => f.sounding).length === 6)
  await wait(2500)
  const settled = await now()
  await wait(6000)
  const later = await now(), six = inBand(later).filter((f) => f.sounding)
  check(inBand(later).length === 8 && six.length === 6, `eight long tones on eight people: the six nearest sound (${six.map((f) => f.key.split('/')[1]).join(' ')})`)
  check(later.followed === settled.followed, `and in six seconds none of them is begun again (${later.followed - settled.followed} begun)`)
  await post('ask', { by: 'tester', unrule: 'banda' })
  await post('ask', { by: 'tester', unrule: 'bandb' })
  await until('the band gone', async () => inBand(await now()).length === 0)

  // Feet, a hum on oneself, a living thing.
  await rule('post', POST)
  await until('feet', async () => (await one('post/feet'))?.sounding)
  const a = await now()
  await wait(3000)
  const b = await now(), steps = b.followed - a.followed
  check(steps >= 7 && steps <= 13 && (await how('post')).calls < 6, `a postman's feet are a thud made again three times a second on him (${steps} in 3 s), with the rule saying so once`)
  await post('say', { by: 'tester', text: 'hum' })
  const hum = await until('a hum on oneself', async () => { const f = await one('post/hum'); return f?.sounding ? f : null })
  check(hum.gain > 0.95, `a sound on whoever is at the page is heard by them at the ear (${hum.gain.toFixed(2)} of full)`)
  const car = await page.evaluate(async () => { const e = globalThis.engine, x = 700, z = 3990, ground = Math.round(e.ground(x / 10, z / 10) * 10), thing = await e.alive.spawn(e.car([x, ground + 5, z])); return thing.ref ?? null })
  await post('say', { by: 'tester', text: `car ${car}` })
  const motor = await until('a motor on a living thing', async () => { const f = await one('post/car'); return f?.sounding ? f : null }).catch(() => null)
  check(!!car && !!motor && motor.gain > 0.5, `a sound on a thing that lives is heard where the thing is (${car}, ${motor?.gain.toFixed(2)} of full)`)

  // Endings: its maker goes, the rule goes.
  await post('say', { by: 'tester', text: 'leave' })
  await until('the feet go with him', async () => !(await one('post/feet')), 6000)
  const left = await now()
  check(left.following.some((f) => f.key === 'post/hum') && left.following.some((f) => f.key === 'post/car'), 'the postman gone, his feet go with him and the other two go on')
  const loud = await sides(500, 550)
  await post('ask', { by: 'tester', unrule: 'post' })
  await until('all gone', async () => (await now()).following.length === 0, 6000)
  await wait(1500)
  const end = await now(), silent = await take(end.t - 1, end.t - 0.1)
  const left523 = ears.band(silent.l, silent.sr, 500, 550)
  check(left523 < loud.l * 0.15, `the rule taken out, nothing of it is left sounding (the hum's own tone is ${ears.db(left523 / loud.l).toFixed(0)} dB against what it was)`)
  const told = await page.evaluate(() => globalThis.engine.ears.voice.told)
  check(told && told.reset === 0 && told.dropped === 0 && told.peak <= 0.891, `nothing was dropped and nothing left over the ceiling (peak ${ears.db(told?.peak ?? 0).toFixed(1)} dB)`)
} catch (e) { failures.push(String(e?.stack ?? e)); console.log(`  FAIL ${e?.message ?? e}`) } finally { await browser?.close(); server.stop() }
if (failures.length) { console.log(`FAILED: ${failures.length}`); process.exit(1) }
console.log('ok')
