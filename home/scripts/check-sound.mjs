// Headless proof of the home's sounds (#52). Models cannot listen, so this measures:
// offline renders through the real bus -> master -> limiter chain (loudness, peak,
// repetition, render cost), the live plugin tapped by an AudioWorklet stamped with the
// audio clock (latency, mute, the gesture rule), the event map, the sample budget, and
// a real walk through the scene (hover and choose the notebook, walk to the living room).
// Usage: node scripts/check-sound.mjs [base-url]   (dev server running; 5490 by default)
// Exits non-zero when any check fails.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadavg } from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5490/'
const SR = 48000
const SFX_BUDGET = 400 * 1024
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const report = {}
const db = (x) => 20 * Math.log10(Math.max(x, 1e-12))
const decode = (b64) => new Float32Array(Buffer.from(b64, 'base64').buffer.slice(0))
const peakOf = (chs) => Math.max(...chs.map((x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)))
const rmsOf = (x, from = 0, to = x.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] ** 2
  return Math.sqrt(s / Math.max(1, to - from))
}

/** BS.1770-4 integrated loudness at 48 kHz (K-weighting, 400 ms blocks, absolute and relative gates); as in check-music.mjs. */
function lufs(channels) {
  const biquad = (input, b, a) => {
    const y = new Float64Array(input.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < input.length; i++) {
      const v = b[0] * input[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
      x2 = x1; x1 = input[i]; y2 = y1; y1 = v
      y[i] = v
    }
    return y
  }
  const weighted = channels.map((x) => biquad(biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]), [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]))
  const block = 0.4 * SR
  const step = block / 4
  const z = []
  for (let i = 0; i + block <= weighted[0].length; i += step) {
    let power = 0
    for (const k of weighted) {
      let s = 0
      for (let j = 0; j < block; j++) s += k[i + j] ** 2
      power += s / block
    }
    z.push(power)
  }
  const level = (zs) => -0.691 + 10 * Math.log10(zs.reduce((a, b) => a + b, 0) / zs.length)
  const abs = z.filter((v) => -0.691 + 10 * Math.log10(v) > -70)
  if (!abs.length) return -Infinity
  const rel = level(abs) - 10
  return level(abs.filter((v) => -0.691 + 10 * Math.log10(v) > rel))
}

/** Hann-windowed spectral centroid of a segment (a 4096-point DFT on its loudest part, by brute force on 64 bins per octave is overkill; a plain DFT is enough here). */
function centroid(x) {
  const n = 2048
  let at = 0, best = 0
  for (let i = 0; i + n <= x.length; i += 256) {
    const r = rmsOf(x, i, i + n)
    if (r > best) (best = r), (at = i)
  }
  let num = 0, den = 0
  for (let k = 1; k < n / 2; k += 2) {
    let re = 0, im = 0
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
      const v = (x[at + i] ?? 0) * w
      re += v * Math.cos((2 * Math.PI * k * i) / n)
      im -= v * Math.sin((2 * Math.PI * k * i) / n)
    }
    const mag = Math.hypot(re, im)
    num += mag * ((k * SR) / n)
    den += mag
  }
  return den ? num / den : 0
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const context = await browser.newContext()
// Counts the AudioContexts a page makes and how long each constructor took on the main thread.
await context.addInitScript(() => {
  const Native = window.AudioContext
  window.audioContexts = 0
  window.contextMs = []
  window.AudioContext = class extends Native {
    constructor(...args) {
      const t0 = performance.now()
      super(...args)
      window.contextMs.push(performance.now() - t0)
      window.audioContexts++
    }
  }
})
const errors = []
const open = async (query) => {
  const p = await context.newPage()
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(`${base}?${query}${/(^|&)talk=/.test(query) ? '' : '&talk=off&build=0'}`)
  await p.evaluate(() => window.village.ready(15000))
  await p.waitForFunction(() => window.village.sound, null, { timeout: 5000 })
  return p
}
// `pre` taps the master before the limiter: the limiter caps everything at -1 dBFS, so a level check after it could never fail.
const render = (p, plays, seconds, seed = 1, solo, pre = true) =>
  p.evaluate(async ([plays, seconds, seed, solo, pre]) => window.village.sound.render(plays, seconds, seed, solo, pre), [plays, seconds, seed, solo, pre])
/** The limiter is linear below 0.6 (-4.4 dBFS): under it, the limiter never touches a sound. */
const LINEAR_DBFS = 20 * Math.log10(0.6)
/** Each bus's loudness over a minute of use stays this far under the villagers' voices (about -29 LUFS short-term). */
const BUS_LUFS_MAX = -32

// ── the map and the palette ─────────────────────────────────────────────────
const contract = readFileSync(join(here, '../src/sound/contract.ts'), 'utf8')
const contractEvents = [...contract.matchAll(/^\s+'(village\/[a-z-]+)'\(/gm)].map((m) => m[1])
const page = await open('plugins=sound')
const meta = await page.evaluate(async () => {
  const { SOUND_EVENTS } = await import('/src/sound/map.ts')
  const { PALETTE } = await import('/src/sound/palette/index.ts')
  return { events: SOUND_EVENTS, cues: Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, c]) => [n, { length: c.length, gap: c.gap ?? 0, bus: c.bus }]))])) }
})
const missing = contractEvents.filter((e) => !meta.events.includes(e))
const extra = meta.events.filter((e) => !contractEvents.includes(e))
check('Every contract event has a line in sound/map.ts (and the map has no others)', contractEvents.length > 0 && !missing.length && !extra.length, `${contractEvents.length} events; missing ${missing.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'}`)

// ── offline: each cue alone ─────────────────────────────────────────────────
report.cues = {}
let worstPeak = -Infinity
for (const [cue, variants] of Object.entries(meta.cues)) {
  for (const [variant, { length }] of Object.entries(variants)) {
    const seconds = Math.max(0.6, length + 0.25)
    const r = await render(page, [{ cue, variant, t: 0.05 }], seconds)
    const chs = r.channels.map(decode)
    const peak = db(peakOf(chs))
    worstPeak = Math.max(worstPeak, peak)
    report.cues[`${cue}:${variant}`] = { lufs: +lufs(chs).toFixed(1), peakDbfs: +peak.toFixed(1) }
  }
}
const silent = Object.entries(report.cues).filter(([, v]) => !(v.peakDbfs > -80)).map(([k]) => k)
check('Every cue makes a sound offline (peak above -80 dBFS)', !silent.length, silent.join(', ') || `${Object.keys(report.cues).length} cue variants`)
check('No cue reaches the limiter: peak before it under -4.4 dBFS', worstPeak < LINEAR_DBFS, `loudest ${worstPeak.toFixed(1)} dBFS`)

// ── offline: a minute of use, per bus ───────────────────────────────────────
// A scripted minute: looking around, choosing things, writing two notes, the journal, a walk.
const minute = []
const at = (t, cue, event = {}) => minute.push({ cue, t, event, seconds: typeof event.seconds === 'number' ? event.seconds : undefined, pan: Math.sin(t) * 0.5 })
for (let t = 1; t < 58; t += 2.7) at(t, 'hover')
for (const t of [3, 12, 25, 40]) at(t, 'chose'), at(t + 0.02, 'glide', { seconds: 1 })
for (const t of [9, 22, 37]) at(t, 'backed'), at(t + 0.02, 'glide', { seconds: 1 })
for (const [start, n] of [[14, 30], [44, 24]]) {
  at(start, 'pad-up')
  for (let i = 0; i < n; i++) at(start + 0.3 + i * 0.16, 'writing', { added: 1 })
  at(start + 0.4 + n * 0.16, 'sent', { seconds: 1.25 })
  at(start + 1.8 + n * 0.16, 'routed')
  at(start + 2 + n * 0.16, 'pad-down')
  at(start + 2.6 + n * 0.16, 'card', { page: 0 })
  at(start + 5 + n * 0.16, 'card', { page: 1 })
}
at(26, 'turned'), at(27, 'news'), at(29, 'book-open', { seconds: 0.7 })
for (const t of [31, 32.5, 34]) at(t, 'page', { leaves: 1, dir: 1, seconds: 0.42 })
at(36, 'book-close', { seconds: 0.7 }), at(50, 'walk', { seconds: 0.95 }), at(53, 'refused'), at(55, 'sat', { seconds: 0.7 })
minute.sort((a, b) => a.t - b.t)
report.minute = { plays: minute.length }
{
  const all = await render(page, minute, 60, 7)
  const chs = all.channels.map(decode)
  report.minute.masterLufs = +lufs(chs).toFixed(1)
  report.minute.masterPeakDbfs = +db(peakOf(chs)).toFixed(1)
  // Wall time rises with whatever else the machine runs; the fastest of three renders is the
  // cost of the mix itself (other processes only ever add time).
  let fastest = all.ms
  for (let i = 0; i < 2; i++) fastest = Math.min(fastest, (await render(page, minute, 60, 7)).ms)
  report.minute.renderMsPerAudioSecond = +(fastest / 60).toFixed(2)
  for (const bus of ['ui', 'world']) {
    const r = await render(page, minute, 60, 7, bus)
    report.minute[`${bus}Lufs`] = +lufs(r.channels.map(decode)).toFixed(1)
  }
  check('A minute of use never reaches the limiter (peak before it under -4.4 dBFS)', report.minute.masterPeakDbfs < LINEAR_DBFS, `${report.minute.masterPeakDbfs} dBFS, ${report.minute.masterLufs} LUFS`)
  check(`Each bus over the minute stays under ${BUS_LUFS_MAX} LUFS, below the voices`, report.minute.uiLufs < BUS_LUFS_MAX && report.minute.worldLufs < BUS_LUFS_MAX, `ui ${report.minute.uiLufs}, world ${report.minute.worldLufs} LUFS`)
  check('Rendering costs under 50 ms per audio second (offline, the whole mix, fastest of three)', report.minute.renderMsPerAudioSecond < 50, `${report.minute.renderMsPerAudioSecond} ms/s`)
}

// ── offline: repetition ─────────────────────────────────────────────────────
// Eight plays in a row, each after its gap: round robin and jitter must make each differ from the last.
report.repetition = {}
const identical = []
for (const [cue, { a }] of Object.entries(meta.cues)) {
  const slot = Math.max(a.length, a.gap) + 0.1
  const plays = Array.from({ length: 8 }, (_, i) => ({ cue, t: 0.05 + i * slot }))
  const r = await render(page, plays, 0.1 + 8 * slot, 3)
  const x = decode(r.channels[0])
  const segs = plays.map(({ t }) => x.subarray(Math.round(t * SR), Math.round((t + a.length) * SR)))
  let minDiff = Infinity, minRmsDb = Infinity, minCentroid = Infinity
  for (let i = 1; i < segs.length; i++) {
    let d = 0
    for (let k = 0; k < segs[i].length; k++) d = Math.max(d, Math.abs(segs[i][k] - segs[i - 1][k]))
    minDiff = Math.min(minDiff, d)
    minRmsDb = Math.min(minRmsDb, Math.abs(db(rmsOf(segs[i])) - db(rmsOf(segs[i - 1]))))
    const c0 = centroid(segs[i - 1]), c1 = centroid(segs[i])
    minCentroid = Math.min(minCentroid, Math.abs(c1 - c0) / Math.max(c0, 1))
  }
  report.repetition[cue] = { minRmsDiffDb: +minRmsDb.toFixed(2), minCentroidDiffPct: +(minCentroid * 100).toFixed(1), minSampleDiffDbfs: +db(minDiff).toFixed(0) }
  if (minDiff < 1e-4) identical.push(cue)
}
check('No cue plays the same twice in a row: consecutive takes differ by more than -80 dBFS', !identical.length, identical.join(', ') || `closest consecutive takes differ by ${Math.min(...Object.values(report.repetition).map((v) => v.minSampleDiffDbfs))} dBFS (sample peak)`)
await page.close()

// ── live: the gesture rule, latency, every event, CPU per event ─────────────
const tap = (p) =>
  p.evaluate(async () => {
    const { audio, mix } = window.village.sound
    // The page's CSP takes worklets from its own origin only (#40); the dev server serves this file.
    await audio.audioWorklet.addModule('/scripts/sound-tap.js')
    const taps = {}
    for (const [name, node] of [['output', mix.output], ['music', mix.ducked]]) {
      const t = new AudioWorkletNode(audio, 'sound-tap')
      node.connect(t).connect(new GainNode(audio, { gain: 0 })).connect(audio.destination)
      taps[name] = []
      t.port.onmessage = (m) => taps[name].push(m.data)
    }
    window.taps = taps
    await new Promise((r) => setTimeout(r, 100))
  })
const peakAfter = (p, t, tapName = 'output', until = Infinity) => p.evaluate(([t, name, until]) => Math.max(0, ...window.taps[name].filter(([bt]) => bt >= t && bt < until).map(([, pk]) => pk)), [t, tapName, until])
const emit = (p, name, e) =>
  p.evaluate(([name, e]) => {
    const t = window.village.sound.audio.currentTime
    window.village.kernel.root.emit(name, e)
    return t
  }, [name, e])

const SAMPLE = {
  'village/physics': { kind: 'impact', a: 'pinball/ball', b: 'pinball/bumper-a', materials: ['steel', 'rubber'], shapes: [{ kind: 'sphere', radius: 0.0135 }, { kind: 'cylinder', halfHeight: 0.02, radius: 0.03 }], at: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 }, impulse: 0.1, hardness: 0.6, impact: 1 },
  'village/hover': { id: 'notebook' }, 'village/chose': { id: 'notebook' }, 'village/backed': { id: 'notebook' },
  'village/glide': { seconds: 1 }, 'village/turned': { villager: 'mia' }, 'village/greeted': { villager: 'sam' },
  'village/card': { villager: 'mia', page: 0 }, 'village/pad': { up: true }, 'village/wrote': { added: 1 }, 'village/sketched': { tool: 'pen' },
  'village/sent': { seconds: 1.25 }, 'village/routed': { route: 'talk', ok: true }, 'village/furnish': { state: 'placed' },
  'village/book': { open: true, seconds: 0.7 }, 'village/page': { leaves: 1, dir: 1, seconds: 0.42 }, 'village/sat': { villager: 'mia', seconds: 0.7 },
  'village/farewell': { villagers: ['mia'] }, 'village/news': { villager: 'mia' }, 'village/walk': { phase: 'leave', from: 'kitchen', to: 'living', seconds: 0.95 },
  'village/refused': { id: 'workshop' },
}
{
  const live = await open('talk=npc&plugins=babble,music,sound')
  const requests = []
  live.on('request', (r) => requests.push(r.url()))
  // No sound before a gesture: the context is suspended with its clock at 0, and an event plays nothing.
  const before = await live.evaluate(async () => {
    const s = window.village.sound
    window.village.kernel.root.emit('village/chose', { id: 'notebook' })
    const t0 = s.audio.currentTime
    await new Promise((r) => setTimeout(r, 300))
    return { state: s.audio.state, clockMoved: s.audio.currentTime - t0, atZero: s.audio.currentTime === 0, plays: s.log.length, contexts: window.audioContexts, contextMs: window.contextMs }
  })
  check('No sound before a gesture: one shared context, suspended at 0, and an event plays nothing', before.state === 'suspended' && before.atZero && before.clockMoved === 0 && before.plays === 0 && before.contexts === 1 && !requests.some((u) => u.includes('/audio/sfx/')), JSON.stringify(before))
  await live.mouse.click(400, 300)
  await live.waitForFunction(() => window.village.sound.audio.state === 'running', null, { timeout: 5000 })
  await tap(live)

  // Latency: event to the first audible block at the master, on the audio clock, on a page
  // with no music (the bed would be the first audible block).
  const quiet = await open('plugins=sound')
  await quiet.mouse.click(400, 300)
  await quiet.waitForFunction(() => window.village.sound.audio.state === 'running', null, { timeout: 5000 })
  await tap(quiet)
  const lat = {}
  for (const [name, e] of [['village/chose', SAMPLE['village/chose']], ['village/hover', SAMPLE['village/hover']], ['village/sent', SAMPLE['village/sent']], ['village/routed', SAMPLE['village/routed']], ['village/refused', SAMPLE['village/refused']]]) {
    const t = await emit(quiet, name, e)
    // Long enough for the slowest cue (sent, about 1.3 s) to end before the next event is timed.
    await quiet.waitForTimeout(1500)
    const first = await quiet.evaluate((t) => window.taps.output.find(([bt, p]) => bt >= t - 0.01 && p > 1e-4), t)
    lat[name.slice(8)] = first ? +((first[0] - t) * 1000).toFixed(1) : null
  }
  report.latencyMs = lat
  const detail = await quiet.evaluate(() => ({ base: window.village.sound.audio.baseLatency, output: window.village.sound.audio.outputLatency }))
  await quiet.close()
  check('Each cue is heard within 20 ms of its event (audio clock, at the master)', Object.values(lat).every((l) => l !== null && l <= 20), `${JSON.stringify(lat)} ms; baseLatency ${detail.base * 1000} ms`)

  // Every event in the map reaches a cue that plays (each cue's first play: cold code).
  let firstPlay = {}
  const reached = await live.evaluate(async (SAMPLE) => {
    const s = window.village.sound
    const { SOUND_EVENTS } = await import('/src/sound/map.ts')
    const out = {}
    const first = {}
    for (const name of SOUND_EVENTS) {
      const n = s.log.length
      window.village.kernel.root.emit(name, SAMPLE[name] ?? {})
      out[name] = s.log.length > n ? s.log.at(-1).cue : null
      if (out[name]) first[name] = s.handled.at(-1)
      await new Promise((r) => setTimeout(r, 120))
    }
    return { out, first }
  }, SAMPLE).then(({ out, first }) => ((firstPlay = first), out))
  const unreached = Object.entries(reached).filter(([, c]) => !c).map(([e]) => e)
  check('Every event in sound/map.ts reaches a cue that plays', !unreached.length, unreached.join(', ') || Object.entries(reached).map(([e, c]) => `${e.slice(8)}->${c}`).join(' '))
  // Main-thread time per event: the sound plugin's handler (map, pan, play), timed by the
  // plugin itself, so the event bus is not in it. Measured warm, as a session plays them:
  // ROUNDS rounds of every event, 250 ms apart so no cue's gap drops it, counting only the
  // emits that played. One sample per event is not a measurement on a loaded machine (the
  // load average sits at 50 to 350 while agents run), so the targets apply to medians: the
  // median of all plays under 1 ms, and the slowest event's median under 4 ms. Each cue's
  // first play (unoptimized code, once per session) is reported apart, not gated.
  const ROUNDS = 12
  const warm = await live.evaluate(async ([SAMPLE, ROUNDS]) => {
    const s = window.village.sound
    const { SOUND_EVENTS } = await import('/src/sound/map.ts')
    const per = {}
    for (let r = 0; r < ROUNDS; r++) {
      for (const name of SOUND_EVENTS) {
        const n = s.log.length
        window.village.kernel.root.emit(name, SAMPLE[name] ?? {})
        if (s.log.length > n) (per[name] ??= []).push(s.handled.at(-1))
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    return per
  }, [SAMPLE, ROUNDS])
  const quantile = (xs, q) => { const v = [...xs].sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(v.length * q))] }
  const ms3 = (x) => +x.toFixed(3)
  const all = Object.values(warm).flat()
  const medians = Object.fromEntries(Object.entries(warm).map(([e, xs]) => [e.slice(8), ms3(quantile(xs, 0.5))]))
  const slowest = Object.entries(medians).sort((a, b) => b[1] - a[1])[0]
  report.mainThreadPerEventMs = {
    median: ms3(quantile(all, 0.5)), p95: ms3(quantile(all, 0.95)), max: ms3(Math.max(...all)), plays: all.length,
    slowestEventMedian: slowest, perEventMedian: medians,
    firstPlay: { median: ms3(quantile(Object.values(firstPlay), 0.5)), max: ms3(Math.max(...Object.values(firstPlay))) },
    loadAverage: loadavg().map((x) => +x.toFixed(0)),
  }
  const pe = report.mainThreadPerEventMs
  check('Main-thread time per event under 1 ms (median of all plays) and 4 ms (slowest event\'s median)', pe.median < 1 && slowest[1] < 4,
    `median ${pe.median} ms, p95 ${pe.p95}, max ${pe.max} over ${pe.plays} plays; slowest ${slowest[0]} ${slowest[1]} ms; first plays (cold) median ${pe.firstPlay.median}, max ${pe.firstPlay.max} ms; load average ${pe.loadAverage.join(' ')}`)

  // Mute: M silences every bus at the master; Shift+M silences only the music.
  await live.waitForFunction(() => window.village.music.bed?.playing, null, { timeout: 5000 })
  await live.waitForTimeout(2500)
  await live.keyboard.press('m')
  await live.waitForTimeout(60)
  const tm = await emit(live, 'village/chose', SAMPLE['village/chose'])
  await emit(live, 'village/furnish', { state: 'placed' })
  await emit(live, 'village/said', { villager: 'Tuft', word: 'LOUD!', index: 0, last: true })
  await live.waitForTimeout(500)
  const mutedPeak = await peakAfter(live, tm)
  const pressed = await live.evaluate(() => document.querySelector('.babble-toggle').getAttribute('aria-pressed'))
  await live.click('.babble-toggle')
  await live.waitForTimeout(100)
  const tu = await emit(live, 'village/chose', SAMPLE['village/chose'])
  await live.waitForTimeout(300)
  const unmutedPeak = await peakAfter(live, tu)
  check('M mutes every bus (ui, world, voices, music) at the master; the speaker button unmutes', mutedPeak < 1e-5 && pressed === 'true' && unmutedPeak > 1e-3, `muted ${db(mutedPeak).toFixed(0)} dBFS, after the button ${db(unmutedPeak).toFixed(0)} dBFS`)
  await live.keyboard.press('Shift+M')
  await live.waitForTimeout(300)
  const ts = await emit(live, 'village/chose', SAMPLE['village/chose'])
  await live.waitForTimeout(400)
  const musicPeak = await peakAfter(live, ts, 'music')
  const uiPeak = await peakAfter(live, ts)
  check('Shift+M mutes only the music: the cues still sound', musicPeak < 1e-5 && uiPeak > 1e-3, `music ${db(musicPeak).toFixed(0)} dBFS, master ${db(uiPeak).toFixed(0)} dBFS`)
  await live.keyboard.press('Shift+M')
  await live.close()
}

// ── the sample budget ───────────────────────────────────────────────────────
const sfxDir = join(here, '../public/audio/sfx')
const sizeOf = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).reduce((n, f) => n + (f.isDirectory() ? sizeOf(join(d, f.name)) : statSync(join(d, f.name)).size), 0) : 0)
report.sfxKB = +(sizeOf(sfxDir) / 1024).toFixed(1)
check('public/audio/sfx fits the 400 KB budget', sizeOf(sfxDir) <= SFX_BUDGET, `${report.sfxKB} KB`)

// ── a real walk through the scene ───────────────────────────────────────────
{
  const p = await open('')
  report.contextAtLoad = await p.evaluate(() => ({ contexts: window.audioContexts, constructorMs: window.contextMs.map((m) => +m.toFixed(2)) }))
  await p.evaluate(async () => {
    const { SOUND_EVENTS } = await import('/src/sound/map.ts')
    window.heard = []
    for (const name of SOUND_EVENTS) window.village.kernel.root.on(name, (e) => window.heard.push({ name: name.slice(8), ...(e.phase ? { phase: e.phase } : {}), at: Boolean(e.at) }))
  })
  await p.mouse.click(5, 5)
  await p.waitForTimeout(800)
  const spot = (id) => p.evaluate((id) => window.village.snapshot().entries.find((e) => e.id === id), id)
  const book = await spot('notebook')
  await p.mouse.move(book.x, book.y, { steps: 5 })
  await p.waitForTimeout(300)
  await p.mouse.click(book.x, book.y)
  await p.waitForTimeout(1500)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(1500)
  // The door's centre can sit behind furniture: look around it until the pointer finds the entry (as check-entries.mjs does).
  // Since the rooms became one house (#42) the seated kitchen view may not see the doorway itself; the living-room sign goes there too.
  const doorId = (await spot('to-living'))?.onScreen ? 'to-living' : 'sign-living'
  const door = await spot(doorId)
  const hovered = () => p.evaluate(() => window.village.kernel.root.get('entries').hovered)
  let aim = null
  for (const r of [0, 30, 60, 90, 120]) {
    for (const [dx, dy] of r ? [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]] : [[0, 0]]) {
      await p.mouse.move(door.x + dx * r, door.y + dy * r)
      await p.waitForTimeout(120)
      if ((await hovered()) === doorId) aim = [door.x + dx * r, door.y + dy * r]
      if (aim) break
    }
    if (aim) break
  }
  if (aim) await p.mouse.click(...aim)
  await p.waitForFunction(() => window.village.snapshot().room === 'living' && !window.village.kernel.root.get('rooms').moving, null, { timeout: 10000 }).catch(() => {})
  await p.waitForTimeout(300)
  const walk = await p.evaluate(() => ({ heard: window.heard, played: window.village.sound.log.map((l) => `${l.cue}${l.pan ? `@${l.pan.toFixed(2)}` : ''}`), room: window.village.snapshot().room }))
  report.walk = { events: walk.heard.map((h) => h.name + (h.phase ? `:${h.phase}` : '')).join(' '), played: walk.played.join(' ') }
  const names = walk.heard.map((h) => h.name + (h.phase ? `:${h.phase}` : ''))
  const want = ['hover', 'chose', 'glide', 'backed', 'walk:leave']
  check('A real walk (hover and choose the notebook, back out, walk to the living room) fires its events and plays cues', want.every((w) => names.includes(w)) && walk.room === 'living' && walk.played.some((x) => x.startsWith('walk')) && walk.played.some((x) => x.startsWith('chose')), `${report.walk.events} | played ${report.walk.played}`)
  await p.close()
}

check('No page errors', errors.length === 0, errors.join(' | '))
await browser.close()

console.log(JSON.stringify(report, null, 1))
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`)
const failed = checks.filter((c) => !c.pass).length
console.log(`\n${checks.length - failed}/${checks.length} checks pass`)
process.exit(failed ? 1 : 0)
