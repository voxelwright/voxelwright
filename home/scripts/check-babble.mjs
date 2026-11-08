// Headless proof of the villagers' babble voices (#42). Models cannot listen, so this measures:
// offline renders (OfflineAudioContext) for pitch, brightness, loudness, prosody and
// determinism; the live plugin (AudioContext, tapped by an AudioWorklet stamped with the
// audio clock) for latency, stop, mute, gating and unload.
// Usage: node scripts/check-babble.mjs [base-url] [--wav=dir]   (dev server running)
// Exits non-zero when any check fails.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5181/'
const wavDir = args.find((a) => a.startsWith('--wav='))?.slice(6)
const SR = 48000
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const report = {}

// ── analysis (Node side) ────────────────────────────────────────────────────
const decode = (b64) => new Float32Array(Buffer.from(b64, 'base64').buffer.slice(0))
const db = (x) => 20 * Math.log10(Math.max(x, 1e-12))
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const FRAME = 2048
const HOP = 512

function frames(x, fn) {
  let maxRms = 0
  const rms = []
  for (let i = 0; i + FRAME <= x.length; i += HOP) {
    let s = 0
    for (let j = 0; j < FRAME; j++) s += x[i + j] ** 2
    rms.push(Math.sqrt(s / FRAME))
    maxRms = Math.max(maxRms, rms.at(-1))
  }
  const out = []
  rms.forEach((r, k) => {
    if (r > maxRms * 0.2) {
      const v = fn(x.subarray(k * HOP, k * HOP + FRAME), k * HOP)
      if (v != null && Number.isFinite(v.value ?? v)) out.push(v)
    }
  })
  return out
}

/**
 * YIN fundamental estimate for one frame, 90 to 900 Hz. Takes the shortest lag
 * whose normalized difference is close to the frame's best, so a formant on the
 * second harmonic does not read as an octave up and multiples of the period do
 * not read as an octave down.
 */
function yin(frame) {
  const W = FRAME / 2
  const minLag = Math.floor(SR / 900)
  const maxLag = Math.ceil(SR / 90)
  const cmnd = new Float32Array(maxLag + 1)
  let sum = 0
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0
    for (let j = 0; j < W; j++) {
      const v = frame[j] - frame[j + tau]
      s += v * v
    }
    sum += s
    cmnd[tau] = (s * tau) / (sum || 1)
  }
  let best = Infinity
  for (let tau = minLag; tau <= maxLag; tau++) best = Math.min(best, cmnd[tau])
  if (best > 0.3) return null
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmnd[tau] < best + 0.06) {
      while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) tau++
      return SR / tau
    }
  }
  return null
}

function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k)
        const wi = Math.sin(ang * k)
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
      }
    }
  }
}

function centroid(frame) {
  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  for (let j = 0; j < FRAME; j++) re[j] = frame[j] * (0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (FRAME - 1)))
  fft(re, im)
  let num = 0
  let den = 0
  for (let k = 1; k < FRAME / 2; k++) {
    const m = Math.hypot(re[k], im[k])
    num += ((k * SR) / FRAME) * m
    den += m
  }
  return den ? num / den : null
}

/** BS.1770-4 integrated loudness at 48 kHz (K-weighting, 400 ms blocks, absolute and relative gates). */
function lufs(x) {
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
  const k = biquad(biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]), [1, -2, 1], [1, -1.99004745483398, 0.99007225036621])
  const block = 0.4 * SR
  const step = block / 4
  const z = []
  for (let i = 0; i + block <= k.length; i += step) {
    let s = 0
    for (let j = 0; j < block; j++) s += k[i + j] ** 2
    z.push(s / block)
  }
  const level = (zs) => -0.691 + 10 * Math.log10(zs.reduce((a, b) => a + b, 0) / zs.length)
  const abs = z.filter((v) => -0.691 + 10 * Math.log10(v) > -70)
  const rel = level(abs) - 10
  return level(abs.filter((v) => -0.691 + 10 * Math.log10(v) > rel))
}

const peakOf = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

function wav(x, path) {
  const data = Buffer.alloc(x.length * 2)
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24)
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([h, data]))
}

// ── offline renders (page side) ─────────────────────────────────────────────
const context = await browser.newContext()
// Counts the AudioContexts a page makes, so the checks can tell one shared context from several.
await context.addInitScript(() => {
  const Native = window.AudioContext
  window.audioContexts = 0
  window.AudioContext = class extends Native {
    constructor(...args) {
      super(...args)
      window.audioContexts++
    }
  }
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`${base}?talk=npc&plugins=babble`)
await page.evaluate(() => window.village.ready(5000))

// Installs window.render(events, seconds) -> base64 mono float32 at 48 kHz, plus the render's wall time.
await page.evaluate(async (SR) => {
  const { Babbler } = await import('/src/voice/engine.ts')
  const { busFor } = await import('/src/voice/buses.ts')
  const { timeline } = await import('/src/voice/demo.ts')
  const b64 = (f32) => {
    const bytes = new Uint8Array(f32.buffer)
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
  }
  window.render = async (events, seconds, opts = {}) => {
    const off = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR)
    const babbler = new Babbler(off, busFor(off, 'voices'), opts)
    for (const { t, e } of events) babbler.said(e, t)
    const t0 = performance.now()
    const buf = await off.startRendering()
    return { samples: b64(buf.getChannelData(0)), ms: performance.now() - t0 }
  }
  window.lineEvents = (villager, text, start = 0) =>
    timeline([{ villager, text }]).map(({ t, e }) => ({ t: t - 0.4 + start, e }))
  window.demoEvents = () => timeline()
}, SR)

const VILLAGERS = ['Dumpling', 'Moss', 'Tuft']
const SHARED = 'Hello there, the soup is nearly ready and the basil looks happy today. Shall we sit down for a while?'

// 1. Each villager is recognizable: median fundamental and spectral centroid on the same line.
const voices = {}
for (const v of VILLAGERS) {
  const r = await page.evaluate(([v, text]) => window.render(window.lineEvents(v, text), 4.5), [v, SHARED])
  const x = decode(r.samples)
  voices[v] = { f0: median(frames(x, yin)), centroid: median(frames(x, centroid)) }
}
report.voices = Object.fromEntries(Object.entries(voices).map(([k, v]) => [k, { f0Hz: Math.round(v.f0), centroidHz: Math.round(v.centroid) }]))
const semis = (a, b) => Math.abs(12 * Math.log2(a / b))
for (const [a, b] of [['Dumpling', 'Moss'], ['Moss', 'Tuft'], ['Dumpling', 'Tuft']]) {
  const df = semis(voices[a].f0, voices[b].f0)
  const dc = Math.abs(voices[a].centroid - voices[b].centroid) / Math.min(voices[a].centroid, voices[b].centroid)
  check(`${a} is lower and darker than ${b}: 3+ semitones and a 15%+ lower spectral centroid`, voices[a].f0 < voices[b].f0 && df >= 3 && voices[a].centroid < voices[b].centroid && dc >= 0.15, `${df.toFixed(1)} st, centroid ${(dc * 100).toFixed(0)}%`)
}

// 2. A question rises: the last 150 ms of voice sits higher than the first 150 ms.
const QUESTION = 'Do you want some soup with bread?'
report.question = {}
for (const v of VILLAGERS) {
  const r = await page.evaluate(([v, text]) => window.render(window.lineEvents(v, text), 2), [v, QUESTION])
  const x = decode(r.samples)
  const f0s = frames(x, (f, at) => ({ at, value: yin(f) })).filter((p) => p.value)
  const startAt = f0s[0].at
  const endAt = f0s.at(-1).at
  const head = median(f0s.filter((p) => p.at - startAt < 0.15 * SR).map((p) => p.value))
  const tail = median(f0s.filter((p) => endAt - p.at < 0.15 * SR).map((p) => p.value))
  report.question[v] = { startHz: Math.round(head), endHz: Math.round(tail) }
  check(`${v}: a question ends higher than it starts`, tail > head * 2 ** (2 / 12), `${Math.round(head)} -> ${Math.round(tail)} Hz`)
}

// 3. The same word sounds the same: two renders bit for bit, and twice in one render.
const same = await page.evaluate(async () => {
  const e = { villager: 'Moss', word: 'basil', index: 0, last: false }
  const a = await window.render([{ t: 0.1, e }], 0.5)
  const b = await window.render([{ t: 0.1, e }], 0.5)
  // In one context, as the first word of two sentences, 0.5 s apart (a whole number of samples).
  const c = await window.render([{ t: 0.1, e }, { t: 0.6, e }], 1.1)
  return { a: a.samples, b: b.samples, c: c.samples }
})
{
  const a = decode(same.a)
  const b = decode(same.b)
  const c = decode(same.c)
  let diffAB = 0
  for (let i = 0; i < a.length; i++) diffAB = Math.max(diffAB, Math.abs(a[i] - b[i]))
  // Start times round to a whole sample, which can differ by one between 0.1 s and 0.6 s, so align first.
  let diffIn = Infinity
  for (let shift = -2; shift <= 2; shift++) {
    let d = 0
    for (let i = 0.1 * SR; i < 0.5 * SR; i++) d = Math.max(d, Math.abs(c[i] - c[i + 0.5 * SR + shift]))
    diffIn = Math.min(diffIn, d)
  }
  check('The same word renders the same in two contexts (within -120 dBFS)', diffAB < 1e-6 && peakOf(a) > 0.001, `max difference ${diffAB.toExponential(1)} (${db(diffAB).toFixed(0)} dBFS)`)
  check('The same word renders the same twice in one context (within -70 dBFS)', diffIn < 3.2e-4, `max difference ${diffIn.toExponential(1)} (${db(diffIn).toFixed(0)} dBFS)`)
}

// 4. The full demo exchange: peak, loudness and render cost.
const demo = await page.evaluate(async () => {
  const events = window.demoEvents()
  const seconds = events.at(-1).t + 1.5
  const r = await window.render(events, seconds)
  return { ...r, seconds, words: events.length }
})
{
  const x = decode(demo.samples)
  const peak = db(peakOf(x))
  const loud = lufs(x)
  report.demo = { seconds: +demo.seconds.toFixed(1), words: demo.words, peakDbfs: +peak.toFixed(1), integratedLufs: +loud.toFixed(1), renderMs: Math.round(demo.ms), renderMsPerAudioSecond: +(demo.ms / demo.seconds).toFixed(1) }
  check('No clipping: peak under -1 dBFS', peak < -1, `${peak.toFixed(1)} dBFS`)
  check('Quiet by default: integrated loudness between -34 and -24 LUFS', loud >= -34 && loud <= -24, `${loud.toFixed(1)} LUFS`)
  if (wavDir) {
    mkdirSync(wavDir, { recursive: true })
    wav(x, join(wavDir, 'babble-demo-scripted.wav'))
  }
}

// ── the live plugin ─────────────────────────────────────────────────────────
// A worklet on the mix's limiter (voice/buses.ts) reports each 128-sample block's peak with its audio time.
async function tap(p) {
  return p.evaluate(async () => {
    const audio = window.village.babble.audio
    // The page's CSP takes worklets from its own origin only (#40); the dev server serves this file.
    await audio.audioWorklet.addModule('/scripts/babble-tap.js')
    const node = new AudioWorkletNode(audio, 'babble-tap')
    const sink = new GainNode(audio, { gain: 0 })
    window.village.sound.mix.output.connect(node).connect(sink).connect(audio.destination)
    window.blocks = []
    node.port.onmessage = (m) => window.blocks.push(m.data)
    await new Promise((r) => setTimeout(r, 100))
  })
}
const say = (p, villager, word, index = 0, last = true) =>
  p.evaluate(([villager, word, index, last]) => {
    const t = window.village.babble.audio.currentTime
    window.village.kernel.root.emit('village/said', { villager, word, index, last })
    return t
  }, [villager, word, index, last])
const blocksAfter = (p, t) => p.evaluate((t) => window.blocks.filter(([bt]) => bt >= t), t)

{
  const live = await context.newPage()
  live.on('pageerror', (e) => errors.push(String(e)))
  await live.goto(`${base}?talk=npc&plugins=babble,sound`)
  await live.evaluate(() => window.village.ready(5000))
  await live.waitForTimeout(150)
  // The rule is no sound before a gesture, not no context: the context is made at load so its
  // device start-up (0.4 to 1.7 s on the main thread when made late) is not paid by a key press.
  // A suspended context renders nothing: its audio clock stands still, and a tap on its output
  // sees no blocks, so that is the proof of silence.
  const idleAt = (p) => p.evaluate(async () => {
    const a = window.village.babble?.audio ?? null
    const t0 = a?.currentTime
    await new Promise((r) => setTimeout(r, 300))
    return { made: Boolean(a), state: a?.state, clockMoved: a ? a.currentTime - t0 : null, atZero: a?.currentTime === 0, contexts: window.audioContexts, toggle: Boolean(document.querySelector('.babble-toggle')) }
  })
  const before = await idleAt(live)
  check('No sound before a gesture: one context exists but is suspended, its audio clock stands still at 0', before.made && before.state === 'suspended' && before.clockMoved === 0 && before.atZero && before.contexts === 1 && before.toggle, JSON.stringify(before))
  const quiet = await live.evaluate(() => {
    const babbler = window.village.babble.babbler
    window.village.kernel.root.emit('village/said', { villager: 'Moss', word: 'hello', index: 0, last: true })
    return { graph: Boolean(babbler), sources: babbler.active }
  })
  check('A word said before a gesture makes no sound: nothing is scheduled', quiet.graph && quiet.sources === 0, JSON.stringify(quiet))
  await live.mouse.click(400, 300)
  const running = (p) => p.waitForFunction(() => window.village.babble.audio.state === 'running', null, { timeout: 5000 }).then(() => 'running', () => 'never ran')
  const first = await running(live)
  const detail = await live.evaluate(() => {
    const a = window.village.babble.audio
    return { base: a.baseLatency, output: a.outputLatency, sampleRate: a.sampleRate, contexts: window.audioContexts }
  })
  check('The first touch resumes the one AudioContext', first === 'running' && detail.contexts === 1, JSON.stringify({ first, ...detail }))
  // A context that is not running (a first touch that did not count, or one suspended since) resumes on the next touch.
  await live.evaluate(() => window.village.babble.audio.suspend())
  await live.mouse.click(400, 300)
  const resumed = await running(live)
  check('A later touch resumes a suspended AudioContext', resumed === 'running', resumed)
  await tap(live)

  // Latency: an idle voice, one word at a time.
  const latencies = []
  for (const [v, w] of [['Dumpling', 'Hello'], ['Tuft', 'socks!'], ['Moss', 'basil.'], ['Dumpling', 'soup?'], ['Tuft', 'Hi']]) {
    const t = await say(live, v, w)
    await live.waitForTimeout(450)
    const first = (await blocksAfter(live, t - 0.01)).find(([, p]) => p > 1e-4)
    latencies.push(first ? (first[0] - t) * 1000 : Infinity)
  }
  report.latencyMs = latencies.map((l) => +l.toFixed(1))
  check('Each said word is heard within 20 ms (audio clock, idle voice)', latencies.every((l) => l <= 20), `${report.latencyMs.join(', ')} ms`)

  // Busy voice: words at the reveal pace keep the lag bounded.
  const lag = await live.evaluate(async () => {
    const words = 'The basil by the window has a new leaf and I thought you would like to know about it today.'.split(' ')
    const out = []
    for (const [i, w] of words.entries()) {
      const t = window.village.babble.audio.currentTime
      const start = window.village.babble.babbler.said({ villager: 'Moss', word: w, index: i, last: i === words.length - 1 }, t)
      out.push(start == null ? null : start - t)
      await new Promise((r) => setTimeout(r, ((w.length + 1) / 58) * 1000))
    }
    return out
  })
  // The closing word always sounds, so it alone may wait for the syllables before it.
  const spoken = lag.slice(0, -1).filter((l) => l != null)
  report.busyMoss = { words: lag.length, spoken: spoken.length + 1, maxLagMs: Math.round(Math.max(...spoken) * 1000), lastWordLagMs: Math.round(lag.at(-1) * 1000) }
  check('A busy voice never runs more than 0.3 s behind its text (before the closing word)', Math.max(...spoken) <= 0.3001, JSON.stringify(report.busyMoss))
  await live.waitForTimeout(600)

  // Stop: a long line, cut after 200 ms.
  await live.evaluate(() => {
    const words = 'Oh I have so much to tell you about the soup and the bread and the garden'.split(' ')
    words.forEach((w, i) => window.village.kernel.root.emit('village/said', { villager: 'Dumpling', word: w, index: i, last: false }))
  })
  await live.waitForTimeout(200)
  const stopAt = await live.evaluate(() => {
    window.village.kernel.root.emit('village/said-stop', { villager: 'Moss' })
    const stillSpeaking = window.village.babble.babbler.speaking
    const t = window.village.babble.audio.currentTime
    window.village.kernel.root.emit('village/said-stop', { villager: 'Dumpling' })
    return { t, stillSpeaking }
  })
  check("A stop for someone else leaves the speaker talking", stopAt.stillSpeaking === 'dumpling', stopAt.stillSpeaking)
  await live.waitForTimeout(400)
  const afterStop = await blocksAfter(live, stopAt.t)
  const lastLoud = afterStop.filter(([, p]) => p > 1e-3).at(-1)
  const soundingBefore = (await live.evaluate((t) => window.blocks.filter(([bt, p]) => bt < t && bt > t - 0.1 && p > 1e-3).length, stopAt.t)) > 0
  const silentMs = lastLoud ? (lastLoud[0] - stopAt.t) * 1000 + 2.7 : 0
  const left = await live.evaluate(() => window.village.babble.babbler.active)
  report.stopMs = +silentMs.toFixed(1)
  check('said-stop silences within 50 ms (below -60 dBFS)', soundingBefore && silentMs <= 50, `sounding before: ${soundingBefore}, silent after ${silentMs.toFixed(1)} ms`)
  check('After a stop no sources are left', left === 0, `${left} live`)

  // Group talk: a new speaker fades the previous one; only one voice sounds.
  const group = await live.evaluate(async () => {
    const root = window.village.kernel.root
    'Shall I add bread to the list then'.split(' ').forEach((w, i) => root.emit('village/said', { villager: 'Dumpling', word: w, index: i, last: false }))
    await new Promise((r) => setTimeout(r, 120))
    root.emit('village/said', { villager: 'Tuft', word: 'Bread!', index: 0, last: true })
    await new Promise((r) => setTimeout(r, 60))
    return window.village.babble.babbler.liveBySpeaker()
  })
  check('In group talk only the active speaker babbles', !group.dumpling && group.tuft > 0, JSON.stringify(group))
  await live.waitForTimeout(500)

  // Mute: M toggles, the felt button mirrors it, it persists, and nothing is heard while muted.
  await live.keyboard.press('m')
  const muted = await live.evaluate(() => ({ stored: localStorage.getItem('village.babble.muted'), pressed: document.querySelector('.babble-toggle').getAttribute('aria-pressed'), api: window.village.babble.muted }))
  await live.waitForTimeout(50)
  const tMuted = await say(live, 'Tuft', 'LOUD!')
  await live.waitForTimeout(400)
  const mutedPeak = Math.max(0, ...(await blocksAfter(live, tMuted)).map(([, p]) => p))
  check('M mutes: stored, shown on the felt button, and silent', muted.stored === '1' && muted.pressed === 'true' && muted.api && mutedPeak < 1e-5, `${JSON.stringify(muted)}, peak ${db(mutedPeak).toFixed(0)} dBFS`)
  await live.reload()
  await live.evaluate(() => window.village.ready(5000))
  await live.waitForTimeout(150)
  const persisted = await live.evaluate(() => document.querySelector('.babble-toggle').getAttribute('aria-pressed'))
  check('Mute survives a reload', persisted === 'true', persisted)
  await live.click('.babble-toggle')
  const unmuted = await live.evaluate(() => ({ stored: localStorage.getItem('village.babble.muted'), pressed: document.querySelector('.babble-toggle').getAttribute('aria-pressed') }))
  check('The felt button unmutes', unmuted.stored === '0' && unmuted.pressed === 'false', JSON.stringify(unmuted))
  // Typing in a text field never toggles.
  const typed = await live.evaluate(() => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))
    input.remove()
    return localStorage.getItem('village.babble.muted')
  })
  check('Typing "m" in a text field does not mute', typed === '0', typed)

  // Unload: the context closes and the plugin leaves nothing behind.
  const unloaded = await live.evaluate(async () => {
    const audio = window.village.babble.audio
    const babbler = window.village.babble.babbler
    window.village.kernel.root.emit('village/said', { villager: 'Moss', word: 'goodbye', index: 0, last: true })
    await window.village.unload('babble')
    const openForSound = audio.state !== 'closed'
    await window.village.unload('sound')
    await new Promise((r) => setTimeout(r, 100))
    const storedBefore = localStorage.getItem('village.babble.muted')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }))
    return {
      openForSound,
      state: audio.state,
      handle: 'babble' in window.village || 'sound' in window.village,
      toggle: Boolean(document.querySelector('.babble-toggle')),
      mInert: localStorage.getItem('village.babble.muted') === storedBefore,
      sourcesTracked: babbler.active,
    }
  })
  check('Unloading the voices leaves the shared context open for the sounds; unloading both closes it, removes the toggle and handles, and M goes inert', unloaded.openForSound && unloaded.state === 'closed' && !unloaded.handle && !unloaded.toggle && unloaded.mInert, JSON.stringify(unloaded))
  await live.close()
}

// Gating: with ?talk=off, or with ?babble=off, the plugin adds nothing.
for (const query of ['talk=off&plugins=babble', 'talk=npc&babble=off&plugins=babble']) {
  const p = await context.newPage()
  await p.goto(`${base}?${query}`)
  await p.evaluate(() => window.village.ready(5000))
  await p.mouse.click(10, 10)
  await p.waitForTimeout(150)
  const r = await p.evaluate(() => ({ toggle: Boolean(document.querySelector('.babble-toggle')), handle: 'babble' in window.village, styles: document.querySelectorAll('style').length }))
  check(`?${query} adds nothing`, !r.toggle && !r.handle, JSON.stringify(r))
  await p.close()
}

check('No page errors', errors.length === 0, errors.join(' | '))
await browser.close()

console.log(JSON.stringify(report, null, 2))
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`)
const failed = checks.filter((c) => !c.pass).length
console.log(`\n${checks.length - failed}/${checks.length} checks pass`)
process.exit(failed ? 1 : 0)
