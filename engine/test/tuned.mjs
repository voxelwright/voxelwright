// A realm's music (#264, #247): a rule says what the realm's music is like and changes it as its own numbers
// change; the page composes it as it plays. The real server, world process and page. Two rules that are not alike
// and are no game: a lighthouse whose music fills as the wind the rule counts rises and turns to alarm in a gale,
// and a dancing class whose teacher sets the pace and the mode by what is said. A third says what no rule should.
//
// What this cannot say: whether it is music anyone would want. That is for ears.
//
//   node test/tuned.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chrome, serve } from './kit.mjs'
import * as ears from './ears.mjs'

const file = join(mkdtempSync(join(tmpdir(), 'engine-tuned-')), 'world.log')
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(400); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const rule = (id, source) => post('ask', { by: 'tester', rule: { id, name: id, source } })
const how = async (id) => (await send('rules')).find((r) => r.id === id)
const until = async (what, ask, ms = 15_000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(150)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }
/** What the world last said the realm's music is: what the music plugin's page side is told as a reader joins (undefined if nothing was ever said). */
const playing = async () => {
  const r = await fetch(`${server.url}/world/stream?from=0`), reader = r.body.getReader()
  let held = Buffer.alloc(0), found, reading = null
  for (const end = Date.now() + 700; Date.now() < end;) {
    reading ??= reader.read()
    const got = await Promise.race([reading, wait(Math.max(1, end - Date.now())).then(() => null)])
    if (!got) break
    reading = null
    if (!got.value) break
    held = Buffer.concat([held, got.value])
    let at = 0
    for (; held.length - at >= 12;) { const kind = held.readUInt32LE(at), size = held.readUInt32LE(at + 8); if (held.length - at < 12 + size) break; if (kind === 11) { const m = JSON.parse(held.subarray(at + 12, at + 12 + size).toString()); if (m.plugin === 'music' && 'state' in m) found = m.state } at += 12 + size }
    held = held.subarray(at)
  }
  void reader.cancel()
  return found
}

// A lighthouse: the rule counts the wind. The music is the coast's, more of it in as the wind rises; in a gale it is
// alarm, faster than alarm's own, at once. Said "calm", the wind drops and the music is the place's again.
const LIGHT = `
on('start', (world) => { world.keep.wind = 0; world.music({ like: 'coast', drive: 0 }) })
on('said', (world, e) => { if (/storm/.test(e.text)) world.keep.rising = true; if (/calm/.test(e.text)) { world.keep.rising = false; world.keep.wind = 0; world.music({ like: null }) } })
on('tick', (world) => {
  if (!world.keep.rising) return
  world.keep.wind = Math.min(12, world.keep.wind + 1)
  if (world.keep.wind >= 8) world.music({ like: 'danger', pace: 150, drive: 1, now: true })
  else world.music({ like: 'coast', drive: world.keep.wind / 8 })
})`
// A dancing class: the teacher sets the music by what is said to her.
const DANCE = `
on('start', (world) => { world.actor('teacher', { name: 'Ines', at: [700, 4012] }); world.keep.pace = 100; world.music({ like: 'town', pace: 100, mode: 'major', drive: 0.3 }) })
on('said', (world, e) => {
  if (/faster/.test(e.text)) world.music({ pace: world.keep.pace += 30 })
  if (/sad/.test(e.text)) world.music({ mode: 'minor' })
  if (/everyone/.test(e.text)) world.music({ drive: 1 })
})`
const ROT = `
on('said', (world, e) => {
  if (e.text !== 'rot') return
  world.music({ like: 'polka' })
  world.music({ like: 'town', pace: 9000, mode: 'x', drive: 7, now: 'yes' })
  world.music({ like: 'town', track: 'http://example.com/a.mp3' })
})`

let browser
try {
  console.log('Said by rules')
  // A server's guide is without its plugins' lines for its first moments: asked again until they are in.
  let guide = ''
  for (const began = Date.now(); Date.now() - began < 8000; await wait(100)) { guide = await (await fetch(`${server.url}/world/`)).text(); if (guide.includes('world.music(')) break }
  check(/world\.music\(/.test(guide) && ['town', 'coast', 'sea', 'snow', 'night', 'danger', 'making', 'phrygian', 'drive'].every((w) => guide.includes(w)), 'the guide names world.music, every mood it can be like, the modes and drive')
  await post('join', { by: 'ada', at: [700, 4012] })
  check(await playing() === undefined, 'a realm with no word about music says nothing of it: it keeps the place’s')
  await rule('light', LIGHT)
  const first = await until('the lighthouse sets its music', async () => { const p = await playing(); return p?.like === 'coast' ? p : null })
  check(first.drive === 0 && first.pace === 0 && first.mode === '', `a lighthouse's music is the coast's, one voice of it (${JSON.stringify(first)})`)
  await post('say', { by: 'ada', text: 'a storm is coming' })
  const rising = await until('the wind rises', async () => { const p = await playing(); return p?.like === 'coast' && p.drive >= 0.35 && p.drive < 1 ? p : null })
  const gale = await until('a gale', async () => { const p = await playing(); return p?.like === 'danger' ? p : null })
  check(rising.drive > 0 && gale.pace === 150 && gale.drive === 1, `as the rule's wind rises more of it is in (drive ${rising.drive}), and in a gale it is alarm at 150 beats a minute (${JSON.stringify(gale)})`)
  await post('say', { by: 'ada', text: 'calm now' })
  await until('calm', async () => (await playing()) === null)
  check(true, 'said "calm", the rule gives the music back to the place')
  await post('ask', { by: 'tester', unrule: 'light' })
  await rule('dance', DANCE)
  const lesson = await until('the class starts', async () => { const p = await playing(); return p?.like === 'town' ? p : null })
  await post('say', { by: 'ada', text: 'faster please' })
  const quick = await until('faster', async () => { const p = await playing(); return p?.pace === 130 ? p : null })
  await post('say', { by: 'ada', text: 'something sad' })
  const sad = await until('sad', async () => { const p = await playing(); return p?.mode === 'minor' ? p : null })
  check(lesson.pace === 100 && lesson.mode === 'major' && lesson.drive === 0.3 && quick.mode === 'major' && sad.pace === 130 && sad.like === 'town', `a dancing class sets pace and mode by what is said, a field at a time (${JSON.stringify(lesson)} then pace ${quick.pace}, then ${sad.mode} still at ${sad.pace})`)
  await rule('rot', ROT)
  await post('say', { by: 'ada', text: 'rot' })
  await wait(800)
  const after = await playing(), why = (await how('rot'))?.error
  check(after.like === 'town' && after.pace === 130 && after.mode === 'minor' && after.drive === 0.3 && why, `a mood that is not kept, a pace, mode and drive out of range, and a track by address are all left (${JSON.stringify(after)}); the rule is told ("${why}")`)
  await post('ask', { by: 'tester', unrule: 'rot' })

  console.log('Played')
  browser = await chrome()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&shared=1&scale=0.4&people=0&at=70,17.8,403&look=0,0`)
  await page.waitForFunction(() => globalThis.engine?.ears, null, { timeout: 90_000 })
  await page.mouse.click(640, 300)
  await page.waitForFunction(() => globalThis.engine.ears.voice.running)
  const now = () => page.evaluate(() => { const e = globalThis.engine.ears, s = e.music.state; return { place: e.place, mood: s.mood, bpm: s.pace, scale: s.section ? [...new Set(s.section.parts.flatMap((p) => p.notes.map((n) => n.midi)).filter(Boolean).map((m) => ((m - 50) % 12 + 12) % 12))].sort((a, b) => a - b) : [], layers: s.layers, t: e.voice.context.currentTime } })
  // The page joined after the rule spoke: it is told what the music is as it joins.
  await page.waitForFunction(() => globalThis.engine.ears.music.state.mood === 'town|0|minor' && globalThis.engine.ears.music.state.pace === 130, null, { timeout: 30_000 }).catch(() => {})
  const joined = await now()
  const minor = [0, 2, 3, 5, 7, 8, 10]
  check(joined.mood === 'town|0|minor' && joined.bpm === 130 && joined.scale.every((n) => minor.includes(n)) && joined.scale.includes(3), `a page that joins later plays what the rule last said: the town's music at ${joined.bpm} beats a minute, every note in the minor scale (${joined.scale.join(' ')}), ${joined.layers} of 4 layers in`)
  await post('say', { by: 'ada', text: 'everyone dance' })
  await page.waitForFunction(() => globalThis.engine.ears.music.state.layers === 4, null, { timeout: 8000 }).catch(() => {})
  const full = await now()
  check(full.layers === 4 && full.mood === joined.mood, `drive changes at once and nothing else: all ${full.layers} layers are in ${(full.t - joined.t).toFixed(1)} s later, the same piece`)
  // Tap it: with every layer in it is louder than a moment ago, and it is sound.
  await page.evaluate(async () => {
    const v = globalThis.engine.ears.voice, ctx = v.context
    await ctx.audioWorklet.addModule('/page/sound/tap.ts')
    const tap = new AudioWorkletNode(ctx, 'village-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
    v.out.connect(tap)
    globalThis.heard = { parts: [], sr: ctx.sampleRate }
    tap.port.onmessage = (e) => globalThis.heard.parts.push(e.data)
  })
  await wait(4200)
  const got = await page.evaluate(() => { const h = globalThis.heard, n = h.parts.reduce((s, p) => s + p.l.length, 0), l = new Float32Array(n); let at = 0; for (const p of h.parts) { for (let i = 0; i < p.l.length; i++) l[at + i] = p.l[i] + p.r[i]; at += p.l.length } const u = new Uint8Array(l.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return { l: btoa(s), sr: h.sr } })
  const buf = Buffer.from(got.l, 'base64'), x = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)
  // The kick is four to the bar: the loudest low-band pulses are a beat apart.
  // Under 150 Hz is the kick and the bass: the rest would count the hats and the keys' pushes.
  const low = new Float32Array(x.length), c = 1 - Math.exp((-2 * Math.PI * 150) / got.sr)
  for (let i = 0, a = 0, b = 0; i < x.length; i++) { a += c * (x[i] - a); b += c * (a - b); low[i] = b }
  const env = ears.envelope(low, got.sr, 10), mean = env.reduce((a, b) => a + b, 0) / env.length
  let best = 0, lag = 0
  for (let k = 30; k < 70; k++) { let s = 0; for (let i = 0; i + k < env.length; i++) s += (env[i] - mean) * (env[i + k] - mean); if (s > best) { best = s; lag = k } }
  const beat = 60 / 130, heardBeat = lag * 0.01, ratio = heardBeat / beat
  check(ears.rms(x) > 0.003 && Math.abs(ratio - 1) < 0.06, `what is heard keeps that pace: its low end comes round every ${(heardBeat * 1000).toFixed(0)} ms (a beat at 130 is ${(beat * 1000).toFixed(0)} ms)`)
  // Asked to go faster, the same piece goes faster: nothing starts again.
  const index = await page.evaluate(() => globalThis.engine.ears.music.state.composed)
  await post('say', { by: 'ada', text: 'faster' })
  await page.waitForFunction(() => globalThis.engine.ears.music.state.pace === 160, null, { timeout: 8000 }).catch(() => {})
  const faster = await now()
  check(faster.bpm === 160 && faster.mood === joined.mood && faster.layers === 4, `asked to go faster the piece playing goes faster (${faster.bpm} beats a minute ${(faster.t - full.t - 4.2).toFixed(1)} s after it was said), all its layers still in: it does not start again`)
  // The lean eases over about two seconds, so six seconds in it has not quite reached an eighth down (140): it peaks at 141.
  // A second rule leans on it for six seconds and never has it: the piece playing thins and slows, and comes back.
  await rule('hand', `on('said', (world, e) => { if (/lower/.test(e.text)) world.music({ lean: -1, for: 6 }); if (/lift/.test(e.text)) world.music({ lean: 1, for: 6 }) })`)
  await post('say', { by: 'ada', text: 'lower it' })
  await page.waitForFunction(() => globalThis.engine.ears.music.state.pace <= 141 && globalThis.engine.ears.music.state.layers < 4, null, { timeout: 12_000 }).catch(() => {})
  const leantDown = await now()
  await page.waitForFunction(() => globalThis.engine.ears.music.state.pace === 160 && globalThis.engine.ears.music.state.layers === 4, null, { timeout: 30_000 }).catch(() => {})
  const again = await now()
  check(leantDown.bpm >= 140 && leantDown.bpm <= 141 && leantDown.layers < 4 && leantDown.mood === faster.mood && again.bpm === 160 && again.layers === 4 && again.mood === faster.mood, `a second rule leans the music down for six seconds: the piece playing goes to ${leantDown.bpm} beats a minute with ${leantDown.layers} of its layers, and ${(again.t - leantDown.t).toFixed(0)} s later is back at ${again.bpm} with all ${again.layers}, the same piece, the realm's rule never asked`)
  // The rule is taken out: the place's own music comes back.
  await post('ask', { by: 'tester', unrule: 'dance' })
  await page.waitForFunction(() => globalThis.engine.ears.place === 'town', null, { timeout: 8000 }).catch(() => {})
  await page.waitForFunction(() => globalThis.engine.ears.music.state.mood === 'town', null, { timeout: 30_000 }).catch(() => {})
  const back = await now()
  check(back.place === 'town' && back.mood === 'town' && back.bpm === 116, `the rule taken out, the place's own music comes back at the next bar (${back.mood}, ${back.bpm} beats a minute)`)
  // With no rule's music at all, a lean lies on the place's own.
  await post('say', { by: 'ada', text: 'lift it' })
  await page.waitForFunction(() => globalThis.engine.ears.music.state.pace >= 130, null, { timeout: 12_000 }).catch(() => {})
  const up = await now()
  await page.waitForFunction(() => globalThis.engine.ears.music.state.pace === 116 && globalThis.engine.ears.lean === 0, null, { timeout: 30_000 }).catch(() => {})
  const down = await now()
  check(up.bpm >= 130 && up.mood === 'town' && down.bpm === 116 && down.mood === 'town', `leant up, the place's own music goes to ${up.bpm} beats a minute and comes back to ${down.bpm} by itself`)
  await post('ask', { by: 'tester', unrule: 'hand' })
  // The lighthouse in a gale: alarm on the beat, not after the bar.
  await rule('light', LIGHT)
  await page.waitForFunction(() => globalThis.engine.ears.place === 'coast', null, { timeout: 10_000 }).catch(() => {})
  await post('say', { by: 'ada', text: 'storm' })
  const t0 = Date.now()
  await page.waitForFunction(() => globalThis.engine.ears.place === 'danger', null, { timeout: 15_000 }).catch(() => {})
  const said = Date.now()
  await page.waitForFunction(() => globalThis.engine.ears.music.state.mood === 'danger' && globalThis.engine.ears.music.state.pace === 150, null, { timeout: 15_000 }).catch(() => {})
  const alarm = await now()
  check(alarm.mood === 'danger' && alarm.bpm === 150 && Date.now() - said < 3000, `in the rule's gale the music is alarm at ${alarm.bpm} beats a minute ${((Date.now() - said) / 1000).toFixed(1)} s after the rule says so (${((said - t0) / 1000).toFixed(1)} s after the storm was called: the rule's own count)`)
  const told = await page.evaluate(() => globalThis.engine.ears.voice.told)
  check(told && told.reset === 0 && told.peak <= 0.891, `nothing left over the ceiling (peak ${ears.db(told?.peak ?? 0).toFixed(1)} dB)`)
} catch (e) { check(false, `the check itself failed: ${e.stack ?? e}`) }
await browser?.close().catch(() => {})
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('tuned: ok')
process.exit(0)
