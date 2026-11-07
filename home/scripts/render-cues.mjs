// Renders every cue variant of the sound palette (#52) offline and measures it, since models
// cannot listen. Starts a Vite dev server on port 5495, imports src/sound/palette from a
// headless Chrome page, renders each variant with OfflineAudioContext at 48 kHz, writes WAVs
// and spectrogram PNGs, and prints a table: loudness (BS.1770 momentary and short-term max),
// peak before the limiter, spectral centroid, length to -60 dB below peak, and how different
// four consecutive round-robin plays are. Renders the villagers' babble the same way as the
// reference the cues must stay under.
// Usage: node scripts/render-cues.mjs [--out=dir] [--only=cue]   (exits non-zero when a target fails)
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const out = resolve(arg('out') ?? join(here, '../generated/cues'))
const only = arg('only')
const SR = 48000
const PORT = 5495
const base = `http://localhost:${PORT}/`
/** Short-term loudness no cue may exceed, and the peak before the master no cue may exceed. */
const MAX_SHORT_LUFS = -24
const MAX_PEAK_DBFS = -3

mkdirSync(out, { recursive: true })

// ── analysis (Node side) ────────────────────────────────────────────────────
const decode = (b64) => new Float32Array(Buffer.from(b64, 'base64').buffer.slice(0))
const db = (x) => 20 * Math.log10(Math.max(x, 1e-12))
const peakOf = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

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
/** BS.1770-4 K-weighting at 48 kHz (from scripts/check-music.mjs). */
const kWeight = (x) => biquad(biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]), [1, -2, 1], [1, -1.99004745483398, 0.99007225036621])
/** Mean-square blocks of `seconds` length every 100 ms over the K-weighted signal, as LUFS. */
function blocks(k, seconds) {
  const n = Math.round(seconds * SR)
  const hop = 0.1 * SR
  const zs = []
  // Pad with silence so a short cue still fills one whole window.
  for (let i = -n + hop; i < k.length; i += hop) {
    let s = 0
    for (let j = Math.max(0, i); j < Math.min(k.length, i + n); j++) s += k[j] ** 2
    zs.push(s / n)
  }
  return zs.map((z) => -0.691 + 10 * Math.log10(Math.max(z, 1e-20)))
}
/** Momentary (400 ms) and short-term (3 s) maximum, and BS.1770 gated integrated loudness. */
function loudness(x) {
  const k = kWeight(x)
  const momentary = blocks(k, 0.4)
  const z = []
  for (let i = 0; i + 0.4 * SR <= k.length; i += 0.1 * SR) {
    let s = 0
    for (let j = 0; j < 0.4 * SR; j++) s += k[i + j] ** 2
    z.push(s / (0.4 * SR))
  }
  const level = (zs) => -0.691 + 10 * Math.log10(zs.reduce((a, b) => a + b, 0) / zs.length)
  const abs = z.filter((v) => -0.691 + 10 * Math.log10(v) > -70)
  const integrated = abs.length ? level(abs.filter((v) => -0.691 + 10 * Math.log10(v) > level(abs) - 10)) : -Infinity
  return { momentaryMax: Math.max(...momentary), shortMax: Math.max(...blocks(k, 3)), integrated }
}

const FRAME = 2048
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k)
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
      }
    }
  }
}
/** Power-weighted spectral centroid over every frame, and the share of power above 3 kHz. */
function spectrum(x) {
  let num = 0, den = 0, high = 0
  for (let i = 0; i + FRAME <= x.length; i += FRAME / 2) {
    const re = new Float64Array(FRAME), im = new Float64Array(FRAME)
    for (let j = 0; j < FRAME; j++) re[j] = x[i + j] * (0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (FRAME - 1)))
    fft(re, im)
    for (let k = 1; k < FRAME / 2; k++) {
      const f = (k * SR) / FRAME
      const pw = re[k] ** 2 + im[k] ** 2
      num += f * pw; den += pw
      if (f > 3000) high += pw
    }
  }
  return { centroid: den ? num / den : 0, above3k: den ? high / den : 0 }
}
/** Seconds from the first sample to the last 5 ms window within 60 dB of the peak; and the attack (first sample to 90% of peak). */
function shape(x) {
  const p = peakOf(x)
  const w = 240
  let first = -1, last = 0
  for (let i = 0; i + w <= x.length; i += w) {
    let m = 0
    for (let j = 0; j < w; j++) m = Math.max(m, Math.abs(x[i + j]))
    if (m > p * 1e-3) { if (first < 0) first = i; last = i + w }
  }
  let atk = 0
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= 0.9 * p) { atk = i; break }
  return { length: (last - Math.max(0, first)) / SR, attackMs: ((atk - Math.max(0, first)) / SR) * 1000 }
}
/** The largest sample step relative to peak: a click shows as a step far above the signal's own. */
function maxStep(x) {
  let m = 0
  for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]))
  return m
}

function wav(x, path) {
  const data = Buffer.alloc(x.length * 2)
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24)
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([h, data]))
}
const spectrogram = (wavPath, pngPath) =>
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', wavPath, '-lavfi', 'showspectrumpic=s=900x320:legend=1:stop=8000:scale=log:color=intensity', pngPath])

// ── the server and the page ─────────────────────────────────────────────────
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: join(here, '..'), stdio: ['ignore', 'pipe', 'pipe'] })
let browser
let failed = 0
let typing = null
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(base)).ok) break } catch {}
    if (i > 150) throw new Error('vite did not start on port ' + PORT)
    await new Promise((r) => setTimeout(r, 200))
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  // A same-origin text document, so the three.js home never boots; modules import from it.
  await page.goto(`${base}src/sound/contract.ts`)
  await page.evaluate(async (SR) => {
    const { PALETTE, DESCRIPTIONS } = await import('/src/sound/palette/index.ts')
    const { seededRandom } = await import('/src/sound/palette/synth.ts')
    const b64 = (f32) => {
      const bytes = new Uint8Array(f32.buffer)
      let s = ''
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(s)
    }
    const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)
    /** The Babbler's soft-clip limiter curve (src/voice/engine.ts): linear to 0.6, a tanh shoulder to -1 dBFS. */
    const clip = (() => {
      const n = 4097, c = new Float32Array(n)
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x); c[i] = Math.sign(x) * (a <= 0.6 ? a : 0.6 + 0.29 * Math.tanh((a - 0.6) / 0.29)) }
      return c
    })()
    // The palette's sample files, decoded once, as the player's kit would hand them over.
    const decoded = new Map()
    const names = [...new Set(Object.values(PALETTE).flatMap((vs) => Object.values(vs).flatMap((c) => c.samples ?? [])))]
    const decoder = new OfflineAudioContext(1, 1, SR)
    for (const n of names) decoded.set(n, await decoder.decodeAudioData(await (await fetch(`/audio/sfx/${n}`)).arrayBuffer()))
    const { SPRITES } = await import('/src/sound/palette/sprites.ts')
    /** Where each sprite's first take really starts after decoding, against the table (Opus pre-skip). */
    window.spriteAlignment = () => Object.values(SPRITES).map(({ file, takes }) => {
      const d = decoded.get(file)?.getChannelData(0)
      if (!d) return { file, missing: true }
      let i = 0
      while (i < d.length && Math.abs(d[i]) < 1e-3) i++
      return { file, tableStart: takes[0][0], firstSoundS: +(i / SR).toFixed(4), seconds: +(d.length / SR).toFixed(3) }
    })
    window.cueList = () => Object.entries(PALETTE).flatMap(([name, vs]) => Object.keys(vs).map((v) => ({ name, v, length: vs[v].length, bus: vs[v].bus, level: vs[v].level, gap: vs[v].gap, sampled: Boolean(vs[v].samples?.length), description: DESCRIPTIONS[name]?.[v] ?? '' })))
    /**
     * Renders plays of one cue variant as the player would hand them over: gain from the level
     * with seeded volume jitter, rate from seeded pitch jitter, round-robin index, seeded random.
     * Channel 0 is before the limiter, channel 1 after it.
     */
    window.renderCue = async (name, v, plays, seconds, standIn = false) => {
      const c = PALETTE[name][v]
      const off = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR)
      const noise = new AudioBuffer({ length: SR, sampleRate: SR, numberOfChannels: 1 })
      const nr = seededRandom(hash('village sfx noise'))
      noise.getChannelData(0).forEach((_, i, d) => { d[i] = nr() * 2 - 1 })
      const kit = { noise, sample: (n) => (standIn ? undefined : decoded.get(n)) }
      const merge = new ChannelMergerNode(off, { numberOfInputs: 2 })
      const pre = new GainNode(off)
      const limiter = new WaveShaperNode(off, { curve: clip })
      pre.connect(merge, 0, 0)
      pre.connect(limiter).connect(merge, 0, 1)
      merge.connect(off.destination)
      const t0 = performance.now()
      for (const { at, index, event } of plays) {
        const random = seededRandom(hash(`${name}:${v}:${index}`))
        const j = c.jitter ?? {}
        const gain = 10 ** ((c.level + (j.db ?? 0) * (2 * random() - 1)) / 20)
        const rate = 2 ** (((j.cents ?? 0) * (2 * random() - 1)) / 1200)
        const out = new GainNode(off)
        out.connect(pre)
        c.play(off, out, { at, pan: 0, gain, rate, index, random, seconds: Number(event.seconds ?? NaN), event }, kit)
      }
      const buf = await off.startRendering()
      return { pre: b64(buf.getChannelData(0)), post: b64(buf.getChannelData(1)), ms: performance.now() - t0 }
    }
    // The villagers' scripted demo exchange through the real Babbler, as the level to stay under.
    window.renderBabble = async () => {
      const { Babbler } = await import('/src/voice/engine.ts')
      const { timeline } = await import('/src/voice/demo.ts')
      const events = timeline()
      const off = new OfflineAudioContext(1, Math.ceil((events.at(-1).t + 1.5) * SR), SR)
      const b = new Babbler(off, off.destination)
      for (const { t, e } of events) b.said(e, t)
      return b64((await off.startRendering()).getChannelData(0))
    }
  }, SR)

  /** A typical event per cue for the render (seconds and payloads as the map would send them). */
  const EVENTS = {
    glide: { seconds: 0.9 }, sent: { seconds: 0.7 }, walk: { seconds: 1.2, phase: 'leave' },
    'book-open': { seconds: 0.4, open: true }, 'book-close': { seconds: 0.3, open: false },
    page: { seconds: 0.3, leaves: 1, dir: 1 }, sat: { seconds: 0.25 }, card: { page: 0 }, writing: { added: 1 },
  }

  const babble = decode(await page.evaluate(() => window.renderBabble()))
  const voice = loudness(babble)
  wav(babble, join(out, 'babble-reference.wav'))

  const rows = []
  const alignment = await page.evaluate(() => window.spriteAlignment())
  const standIns = []
  for (const { name, v, length, bus, level, description, sampled } of await page.evaluate(() => window.cueList())) {
    if (only && name !== only) continue
    const event = EVENTS[name] ?? {}
    const span = Math.max(3.5, length + 0.5)
    // Four plays, each alone, for the measurements and the round-robin difference.
    const takes = []
    let ms = 0
    for (let index = 0; index < 4; index++) {
      const r = await page.evaluate(([n, v, e, i, s]) => window.renderCue(n, v, [{ at: 0.05, index: i, event: e }], s), [name, v, event, index, span])
      takes.push({ pre: decode(r.pre), post: decode(r.post) })
      ms += r.ms
    }
    const x = takes[0].pre
    const peak = Math.max(...takes.map((t) => db(peakOf(t.pre))))
    const ld = loudness(x)
    const sp = spectrum(x)
    const sh = shape(x)
    let rr = Infinity
    for (let i = 1; i < 4; i++) {
      let d = 0
      for (let k = 0; k < x.length; k++) d = Math.max(d, Math.abs(takes[i].pre[k] - takes[i - 1].pre[k]))
      rr = Math.min(rr, d / Math.max(peakOf(takes[i].pre), 1e-9))
    }
    // The listening file: the four plays in a row, after the limiter.
    const gapS = Math.max(0.6, length + 0.25)
    const seq = await page.evaluate(([n, v, e, g]) => window.renderCue(n, v, [0, 1, 2, 3].map((i) => ({ at: 0.05 + i * g, index: i, event: e })), 0.1 + 4 * g), [name, v, event, gapS])
    const file = `${name}-${v}`
    wav(decode(seq.post), join(out, `${file}.wav`))
    spectrogram(join(out, `${file}.wav`), join(out, `${file}.png`))
    const row = {
      cue: `${name}:${v}`, bus, level, momentaryMax: +ld.momentaryMax.toFixed(1), shortMax: +ld.shortMax.toFixed(1), peakDbfs: +peak.toFixed(1),
      centroidHz: Math.round(sp.centroid), above3kPct: +(sp.above3k * 100).toFixed(0), lengthS: +sh.length.toFixed(2), attackMs: +sh.attackMs.toFixed(1),
      maxStepDb: +(db(maxStep(x)) - db(peakOf(x))).toFixed(0), roundRobinDiffDb: +db(rr).toFixed(0), renderMsPerPlay: +(ms / 4).toFixed(1), description,
    }
    const fails = []
    if (row.peakDbfs > MAX_PEAK_DBFS) fails.push(`peak ${row.peakDbfs} dBFS`)
    if (row.shortMax > MAX_SHORT_LUFS) fails.push(`short-term ${row.shortMax} LUFS`)
    if (row.momentaryMax > voice.momentaryMax) fails.push(`louder than the voices (${row.momentaryMax} > ${voice.momentaryMax.toFixed(1)} LUFS momentary)`)
    if (rr < 1e-4) fails.push('consecutive plays identical')
    row.fails = fails
    if (sampled) {
      // The synthesized stand-in that plays until the files have loaded: its level beside the recording's.
      const r = await page.evaluate(([n, v, e, s]) => window.renderCue(n, v, [{ at: 0.05, index: 0, event: e }], s, true), [name, v, event, span])
      const y = decode(r.pre)
      standIns.push({ cue: `${name}:${v}`, momentaryMax: +loudness(y).momentaryMax.toFixed(1), peakDbfs: +db(peakOf(y)).toFixed(1), recordedMomentaryMax: row.momentaryMax })
    }
    failed += fails.length ? 1 : 0
    rows.push(row)
  }

  // Typing: 2 s of keystrokes about 9 a second, dropped inside the cue's gap as the player does,
  // to show the grains joining into one scratch, and its level.
  if (!only || only === 'writing') {
    const { gap } = (await page.evaluate(() => window.cueList())).find((c) => c.name === 'writing') ?? {}
    const keys = []
    let last = -Infinity
    for (let k = 0, t = 0.05; t < 2.05; k++, t += 0.085 + 0.06 * ((k * 7919) % 13) / 13) {
      if (t - last < (gap ?? 0)) continue
      keys.push({ at: t, index: keys.length, event: { added: 1 } })
      last = t
    }
    const r = await page.evaluate(([ks]) => window.renderCue('writing', 'a', ks, 3.5), [keys])
    const x = decode(r.pre)
    const ld = loudness(x)
    wav(decode(r.post), join(out, 'writing-a-typing.wav'))
    spectrogram(join(out, 'writing-a-typing.wav'), join(out, 'writing-a-typing.png'))
    typing = { keys: keys.length, momentaryMax: +ld.momentaryMax.toFixed(1), shortMax: +ld.shortMax.toFixed(1), peakDbfs: +db(peakOf(x)).toFixed(1) }
    if (typing.shortMax > MAX_SHORT_LUFS || typing.momentaryMax > voice.momentaryMax) failed++
  }

  // UI cues sit under world cues: compare the median momentary max of each bus.
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  const ui = median(rows.filter((r) => r.bus === 'ui').map((r) => r.momentaryMax))
  const world = median(rows.filter((r) => r.bus === 'world').map((r) => r.momentaryMax))
  const summary = {
    voices: { momentaryMax: +voice.momentaryMax.toFixed(1), shortMax: +voice.shortMax.toFixed(1), integrated: +voice.integrated.toFixed(1) },
    medianMomentary: { ui: ui ?? null, world: world ?? null }, uiUnderWorld: ui === undefined || world === undefined || ui < world,
    typing,
    standIns,
    alignment,
    errors,
  }
  if (!summary.uiUnderWorld) failed++
  if (errors.length) failed++
  writeFileSync(join(out, 'measurements.json'), JSON.stringify({ summary, rows }, null, 2))
  const pad = (s, n) => String(s).padEnd(n)
  console.log(pad('cue', 14), pad('bus', 6), pad('M max', 7), pad('S max', 7), pad('peak', 6), pad('cent', 6), pad('>3k%', 5), pad('len s', 6), pad('atk ms', 7), pad('rr dB', 6), pad('step', 5), 'fails')
  for (const r of rows) console.log(pad(r.cue, 14), pad(r.bus, 6), pad(r.momentaryMax, 7), pad(r.shortMax, 7), pad(r.peakDbfs, 6), pad(r.centroidHz, 6), pad(r.above3kPct, 5), pad(r.lengthS, 6), pad(r.attackMs, 7), pad(r.roundRobinDiffDb, 6), pad(r.maxStepDb, 5), r.fails.join('; '))
  console.log(JSON.stringify(summary))
  console.log(`WAVs, spectrograms and measurements.json in ${out}`)
} finally {
  await browser?.close()
  vite.kill()
}
process.exit(failed ? 1 : 0)
