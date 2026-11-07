// Headless proof of the music bed (#42). Models cannot listen, so this measures:
// the shipped file and its offline renders (OfflineAudioContext) for loudness, the loop
// and its seam, and ducking; the live plugin (AudioContext, tapped by an AudioWorklet
// stamped with the audio clock) for the gesture rule, the fade-in, ducking, both mute
// switches, the credit and unloading.
// Usage: node scripts/check-music.mjs [base-url]   (dev server running; 5322 by default)
// Exits non-zero when any check fails.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5322/'
const SR = 48000
const LOOP_SAMPLES = 1_024_000 // eight bars at 90 BPM, 21.333 s at 48 kHz
const SOURCE = 'https://freesound.org/s/203099/'
const LICENCE = 'https://creativecommons.org/licenses/by/4.0/'
/** Sample step at the loop point may be at most this fraction of full scale (-60 dBFS), and no sharper than the music's own 99th percentile. */
const SEAM_STEP_MAX = 1e-3

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const report = {}
const db = (x) => 20 * Math.log10(Math.max(x, 1e-12))
const rmsOf = (x, from = 0, to = x.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] ** 2
  return Math.sqrt(s / (to - from))
}
const decode = (b64) => new Float32Array(Buffer.from(b64, 'base64').buffer.slice(0))

/** BS.1770-4 integrated loudness of a stereo signal at 48 kHz (K-weighting, 400 ms blocks, absolute and relative gates). */
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
  const rel = level(abs) - 10
  return level(abs.filter((v) => -0.691 + 10 * Math.log10(v) > rel))
}

// ── the files ───────────────────────────────────────────────────────────────
const ogg = join(here, '../public/audio/groove-music.ogg')
const size = statSync(ogg).size
report.fileKB = Math.round(size / 1024)
check('The loop is an Ogg Opus file under 400 KB', size < 400 * 1024 && readFileSync(ogg).subarray(0, 4).toString() === 'OggS', `${report.fileKB} KB`)
const creditsFiles = [join(here, '../public/audio/CREDITS.md'), join(here, '../../CREDITS.md')]
const credits = creditsFiles.map((f) => (existsSync(f) ? readFileSync(f, 'utf8') : ''))
check(
  'CREDITS.md (beside the file and at the repo root) names title, author, source, licence and the changes',
  credits.every((t) => ['Groove Music', 'benpm', SOURCE, LICENCE, 'Attribution 4.0', 'Opus'].every((s) => t.includes(s))),
  creditsFiles.map((f, i) => `${f.split('/').slice(-2).join('/')}: ${credits[i].length} bytes`).join(', '),
)

// ── offline renders ─────────────────────────────────────────────────────────
const context = await browser.newContext()
const errors = []
const page = await context.newPage()
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`${base}?talk=npc&plugins=music`)
await page.evaluate(() => window.village.ready(5000))

// window.renderBed(seconds, ops, fade) -> channel samples (base64) and the decoded buffer's shape.
await page.evaluate(async (SR) => {
  const { Bed, LEVEL } = await import('/src/voice/bed.ts')
  const bytes = await (await fetch('/audio/groove-music.ogg')).arrayBuffer()
  const b64 = (f32) => {
    const raw = new Uint8Array(f32.buffer)
    let s = ''
    for (let i = 0; i < raw.length; i += 0x8000) s += String.fromCharCode(...raw.subarray(i, i + 0x8000))
    return btoa(s)
  }
  window.LEVEL = LEVEL
  window.renderBed = async (seconds, ops = [], fade = 0, ship = true) => {
    const off = new OfflineAudioContext(2, Math.round(seconds * SR), SR)
    const buffer = await off.decodeAudioData(bytes.slice(0))
    const bed = new Bed(off, buffer, off.destination)
    bed.start(0, fade)
    // Each duck is made when the render reaches it (as the plugin does), so it starts from the gain the render has by then.
    for (const op of ops) off.suspend(op.t).then(() => { bed.duck(op.duck, off.currentTime); off.resume() })
    const out = await off.startRendering()
    const a = out.getChannelData(0)
    const b = out.getChannelData(1)
    return { length: buffer.length, rate: buffer.sampleRate, duration: buffer.duration, channels: buffer.numberOfChannels, samples: ship ? [b64(a), b64(b)] : null }
  }
  // The loop point of two passes back to back, measured here to avoid shipping 16 MB.
  window.seam = async () => {
    const off = new OfflineAudioContext(2, 1, SR)
    const n = (await off.decodeAudioData(bytes.slice(0))).length
    const two = new OfflineAudioContext(2, 2 * n, SR)
    const bed = new Bed(two, await two.decodeAudioData(bytes.slice(0)), two.destination)
    bed.start(0, 0)
    const out = await two.startRendering()
    const stats = []
    let repeat = 0
    for (let c = 0; c < 2; c++) {
      const x = out.getChannelData(c)
      const steps = []
      const bends = []
      for (let i = 1; i < x.length; i++) {
        if (i === n) continue
        steps.push(Math.abs(x[i] - x[i - 1]))
        if (i > 1 && i - 1 !== n) bends.push(Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]))
      }
      const pct = (arr, q) => [...arr].sort((p, r) => p - r)[Math.floor(q * arr.length)]
      stats.push({
        seamStep: Math.abs(x[n] - x[n - 1]),
        seamBend: Math.max(Math.abs(x[n] - 2 * x[n - 1] + x[n - 2]), Math.abs(x[n + 1] - 2 * x[n] + x[n - 1])),
        stepP50: pct(steps, 0.5), stepP99: pct(steps, 0.99),
                bendP999: pct(bends, 0.999),
      })
      for (let i = 0; i < n; i++) repeat = Math.max(repeat, Math.abs(x[i] - x[i + n]))
    }
    return { n, stats, repeat }
  }
}, SR)

const loud = await page.evaluate(() => window.renderBed(1024000 / 48000))
report.decoded = { samples: loud.length, rate: loud.rate, seconds: +loud.duration.toFixed(4), channels: loud.channels }
check('The decoded loop is exactly eight bars: 1,024,000 samples at 48 kHz, stereo', loud.length === LOOP_SAMPLES && loud.rate === SR && loud.channels === 2, JSON.stringify(report.decoded))
const stereo = loud.samples.map(decode)
report.lufs = +lufs(stereo).toFixed(1)
report.peakDb = +db(Math.max(...stereo.map((x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)))).toFixed(1)
report.sourceLufs = +(report.lufs - db(await page.evaluate(() => window.LEVEL))).toFixed(1)
check('Quiet by default: -33 to -30 LUFS integrated, peaks below -12 dBFS', report.lufs >= -33 && report.lufs <= -30 && report.peakDb < -12, `${report.lufs} LUFS (the file alone is ${report.sourceLufs}), peak ${report.peakDb} dBFS`)

const seam = await page.evaluate(() => window.seam())
report.seam = {
  samples: seam.n,
  stepDb: seam.stats.map((s) => +db(s.seamStep).toFixed(1)),
  stepOverP50: seam.stats.map((s) => +(s.seamStep / s.stepP50).toFixed(2)),
  stepOverP99: seam.stats.map((s) => +(s.seamStep / s.stepP99).toFixed(3)),
  bendOverP999: seam.stats.map((s) => +(s.seamBend / s.bendP999).toFixed(3)),
  repeatMaxDiff: seam.repeat,
}
check('Two passes back to back are the same signal (the loop repeats exactly)', seam.n === LOOP_SAMPLES && seam.repeat < 1e-6, `max difference ${seam.repeat.toExponential(1)}`)
check(
  `No click at the loop point: the sample step is under ${SEAM_STEP_MAX} (-60 dBFS) and no sharper than the music's own 99th percentile, in both channels`,
  seam.stats.every((s) => s.seamStep < SEAM_STEP_MAX && s.seamStep <= s.stepP99 && s.seamBend <= s.bendP999),
  `step ${report.seam.stepDb.join(', ')} dBFS = ${report.seam.stepOverP50.join(', ')} x the median step, ${report.seam.stepOverP99.join(', ')} x the 99th percentile; bend ${report.seam.bendOverP999.join(', ')} x the 99.9th`,
)

// Ducking: down 1.0 s, back 3.0 s. Windows are compared with a control render of the same music.
{
  const seconds = 6
  const ducked = (await page.evaluate((s) => window.renderBed(s, [{ t: 1, duck: true }, { t: 3, duck: false }]), seconds)).samples.map(decode)
  const control = (await page.evaluate((s) => window.renderBed(s), seconds)).samples.map(decode)
  const ratio = (from, to) => db(rmsOf(ducked[0], from * SR, to * SR) / rmsOf(control[0], from * SR, to * SR))
  const settled = ratio(1.6, 2.9)
  const back = ratio(4.5, 5.9)
  // The duck's gain in a 50 ms window: the median ratio of ducked to un-ducked samples that are not near zero.
  const gainDb = (t) => {
    const r = []
    for (let i = Math.round(t * SR); i < Math.round((t + 0.05) * SR); i++) if (Math.abs(control[0][i]) > 0.002) r.push(ducked[0][i] / control[0][i])
    return db(r.sort((a, b) => a - b)[r.length >> 1])
  }
  let attack = NaN, releaseTime = NaN
  for (let t = 1; t < 3; t += 0.05) if (Math.abs(gainDb(t) + 6) < 1) { attack = t - 1; break }
  for (let t = 3; t < 5; t += 0.05) if (Math.abs(gainDb(t)) < 1) { releaseTime = t - 3; break }
  report.duck = { settledDb: +settled.toFixed(2), backDb: +back.toFixed(2), within1dbDownS: +attack.toFixed(2), within1dbBackS: +releaseTime.toFixed(2) }
  check('Ducking is 6 dB (offline): down to -6.0 +/- 0.3 dB, and back to 0 +/- 0.2 dB', Math.abs(settled + 6) < 0.3 && Math.abs(back) < 0.2, JSON.stringify(report.duck))
  check('The duck moves gently: within 1 dB of its target in 0.5 s going down and 1.5 s coming back', attack <= 0.5 && releaseTime <= 1.5, `${report.duck.within1dbDownS} s down, ${report.duck.within1dbBackS} s back`)
}
await page.close()

// ── the live plugin ─────────────────────────────────────────────────────────
const URL_ALL = `${base}?talk=npc&plugins=babble,music`
// A worklet on the bed's output reports each 128-sample block's sum of squares with its audio time.
async function tap(p) {
  await p.evaluate(async () => {
    const { audio, bed } = window.village.music
    const code = `registerProcessor('music-tap', class extends AudioWorkletProcessor {
      process(inputs) { const ch = inputs[0][0]; let s = 0, p = 0; if (ch) for (let i = 0; i < ch.length; i++) { s += ch[i] * ch[i]; p = Math.max(p, Math.abs(ch[i])) }
        this.port.postMessage([currentTime, s, p]); return true } })`
    await audio.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))
    const node = new AudioWorkletNode(audio, 'music-tap')
    const sink = new GainNode(audio, { gain: 0 })
    bed.output.connect(node).connect(sink).connect(audio.destination)
    window.blocks = []
    node.port.onmessage = (m) => window.blocks.push(m.data)
    // The reference: the same music, un-ducked and at full fade, from the decoded buffer's first channel.
    const { LEVEL } = await import('/src/voice/bed.ts')
    const x = bed.buffer.getChannelData(0)
    window.reference = (from, to) => {
      const n = x.length
      const i0 = Math.round(((from - bed.startedAt) * bed.buffer.sampleRate) % n)
      const len = Math.round((to - from) * bed.buffer.sampleRate)
      let s = 0
      for (let i = 0; i < len; i++) s += x[(i0 + i) % n] ** 2
      return Math.sqrt(s / len) * LEVEL
    }
  })
}
const now = (p) => p.evaluate(() => window.village.music.audio.currentTime)
/** Output RMS over the audio-clock window [from, to) and the same window of the music un-ducked, both from the tap. */
const measured = (p, from, to) =>
  p.evaluate(([from, to]) => {
    const inside = window.blocks.filter(([t]) => t >= from && t < to)
    const ms = inside.reduce((a, [, s]) => a + s, 0) / (inside.length * 128)
    return { rms: Math.sqrt(ms), reference: window.reference(from, to), blocks: inside.length, peak: Math.max(0, ...inside.map(([, , pk]) => pk)) }
  }, [from, to])
const waitForBed = (p) => p.waitForFunction(() => window.village.music?.bed?.playing, null, { timeout: 5000 })
const said = (p, n, gap = 100) =>
  p.evaluate(async ([n, gap]) => {
    for (let i = 0; i < n; i++) {
      window.village.kernel.root.emit('village/said', { villager: 'Dumpling', word: 'hello', index: i, last: i === n - 1 })
      await new Promise((r) => setTimeout(r, gap))
    }
  }, [n, gap])
const pressed = (p, sel) => p.evaluate((s) => document.querySelector(s)?.getAttribute('aria-pressed'), sel)

{
  const live = await context.newPage()
  const requests = []
  live.on('pageerror', (e) => errors.push(String(e)))
  live.on('request', (r) => requests.push(r.url()))
  await live.goto(URL_ALL)
  await live.evaluate(() => window.village.ready(5000))
  await live.waitForTimeout(300)
  const before = await live.evaluate(() => ({ audio: window.village.music?.audio ?? null, chip: Boolean(document.querySelector('.music-toggle')) }))
  check(
    'No sound before a gesture: no AudioContext, the loop is not even fetched',
    before.audio === null && before.chip && !requests.some((u) => u.includes('groove-music')),
    JSON.stringify({ ...before, fetched: requests.some((u) => u.includes('groove-music')) }),
  )
  await live.mouse.click(400, 300)
  await waitForBed(live)
  await tap(live)
  const t0 = await now(live)
  const state = await live.evaluate(() => ({ state: window.village.music.audio.state, loop: window.village.music.bed.loop, duration: window.village.music.bed.buffer.duration }))
  check('After a gesture the loop plays: running context, a looping source over the whole buffer', state.state === 'running' && state.loop.loop && state.loop.start === 0 && Math.abs(state.loop.end - state.duration) < 1e-9, JSON.stringify(state))
  await live.waitForTimeout(3800)
  const early = await measured(live, t0, t0 + 0.15)
  const full = await measured(live, t0 + 2.2, t0 + 3.6)
  report.live = { fadeStartRms: +early.rms.toExponential(1), playingRmsDb: +db(full.rms).toFixed(1), blocks: full.blocks }
  check('It fades in over about 2 s: nothing at the start, full level (within 1.5 dB of the music at its set level) after 2.2 s', early.peak < 0.01 && full.rms > 0 && Math.abs(db(full.rms / full.reference)) < 1.5, `start peak ${early.peak.toExponential(1)}, level after the fade ${db(full.rms / full.reference).toFixed(2)} dB re reference`)

  // Ducking on the live output, against the same music un-ducked.
  const ta = await now(live)
  await said(live, 12, 100)
  const tb = await now(live)
  const down = await measured(live, ta + 0.7, tb)
  const duringBed = await live.evaluate(() => window.village.music.bed.ducking)
  await live.waitForTimeout(300)
  const stillDown = await live.evaluate(() => window.village.music.bed.ducking)
  await live.waitForTimeout(2400)
  const tc = await now(live)
  await live.waitForTimeout(600)
  const up = await measured(live, tc, tc + 0.6)
  const downDb = db(down.rms / down.reference)
  const upDb = db(up.rms / up.reference)
  report.live.duck = { whileSpeakingDb: +downDb.toFixed(2), gainWhileSpeaking: +duringBed.toFixed(3), gain0_3sAfterLastWord: +stillDown.toFixed(3), laterDb: +upDb.toFixed(2) }
  check('A villager speaking ducks the music by 6 dB on the live output (-6 +/- 1 dB)', Math.abs(downDb + 6) < 1 && Math.abs(duringBed - 0.5) < 0.02, JSON.stringify(report.live.duck))
  check('The duck holds through the pause after the last word (0.3 s later still down)', stillDown < 0.6, `gain ${stillDown.toFixed(3)}`)
  check('The music comes back after the line: 3.3 s after the last word it is within 1 dB of un-ducked', Math.abs(upDb) < 1, `${upDb.toFixed(2)} dB`)
  const cut = await live.evaluate(async () => {
    const root = window.village.kernel.root
    root.emit('village/said', { villager: 'Moss', word: 'hello', index: 0, last: false })
    await new Promise((r) => setTimeout(r, 300))
    const down = window.village.music.bed.ducking
    root.emit('village/said-stop', { villager: 'Moss' })
    await new Promise((r) => setTimeout(r, 2600))
    return { down, back: window.village.music.bed.ducking }
  })
  check('A cut-short reply releases the duck too', cut.down < 0.6 && cut.back > 0.97, JSON.stringify(cut))

  // Mute everything: M and the felt speaker button.
  await live.keyboard.press('m')
  const tm = (await now(live)) + 0.5
  await live.waitForTimeout(1200)
  const mutedAll = await measured(live, tm, tm + 0.6)
  const m1 = await live.evaluate(() => ({ stored: localStorage.getItem('village.babble.muted'), speaker: document.querySelector('.babble-toggle').getAttribute('aria-pressed'), api: window.village.music.muted, musicOnly: window.village.music.musicMuted, voices: window.village.babble.muted }))
  check('M mutes everything: music silent, the speaker button pressed, the choice stored', mutedAll.peak < 1e-5 && m1.stored === '1' && m1.speaker === 'true' && m1.api && !m1.musicOnly && m1.voices, `${JSON.stringify(m1)}, peak ${db(mutedAll.peak).toFixed(0)} dBFS`)
  await live.reload()
  await live.evaluate(() => window.village.ready(5000))
  await live.mouse.click(400, 300)
  await waitForBed(live)
  await tap(live)
  const t1 = await now(live)
  await live.waitForTimeout(2800)
  const afterReload = await measured(live, t1 + 0.5, t1 + 2.5)
  const m2 = await live.evaluate(() => ({ speaker: document.querySelector('.babble-toggle').getAttribute('aria-pressed'), api: window.village.music.muted }))
  check('Mute-all survives a reload: the music starts silent, the speaker button still pressed', afterReload.peak < 1e-5 && m2.api && m2.speaker === 'true', `${JSON.stringify(m2)}, peak ${db(afterReload.peak).toFixed(0)} dBFS`)
  await live.click('.babble-toggle')
  const t2 = (await now(live)) + 0.4
  await live.waitForTimeout(1500)
  const unmuted = await measured(live, t2, t2 + 0.8)
  check('The speaker button unmutes everything: the music is heard again', unmuted.peak > 1e-3 && !(await live.evaluate(() => window.village.music.muted)) && (await pressed(live, '.babble-toggle')) === 'false', `peak ${db(unmuted.peak).toFixed(0)} dBFS`)

  // Mute the music alone: Shift+M, then the note.
  await live.keyboard.press('Shift+M')
  const t3 = (await now(live)) + 0.5
  await live.waitForTimeout(1300)
  const musicOff = await measured(live, t3, t3 + 0.6)
  const m3 = await live.evaluate(() => ({ stored: localStorage.getItem('village.music.muted'), note: document.querySelector('.music-toggle').getAttribute('aria-pressed'), speaker: document.querySelector('.babble-toggle').getAttribute('aria-pressed'), voices: window.village.babble.muted, all: localStorage.getItem('village.babble.muted'), music: window.village.music.musicMuted }))
  check('Shift+M mutes the music alone: silent, the note pressed, the speaker and the voices untouched', musicOff.peak < 1e-5 && m3.stored === '1' && m3.note === 'true' && m3.speaker === 'false' && !m3.voices && m3.all === '0' && m3.music, `${JSON.stringify(m3)}, peak ${db(musicOff.peak).toFixed(0)} dBFS`)
  await live.reload()
  await live.evaluate(() => window.village.ready(5000))
  await live.mouse.click(400, 300)
  await waitForBed(live)
  await tap(live)
  const t4 = await now(live)
  await live.waitForTimeout(2800)
  const afterReload2 = await measured(live, t4 + 0.5, t4 + 2.5)
  const m4 = await live.evaluate(() => ({ note: document.querySelector('.music-toggle').getAttribute('aria-pressed'), speaker: document.querySelector('.babble-toggle').getAttribute('aria-pressed') }))
  check('Mute-music survives a reload: silent, the note pressed, the speaker not', afterReload2.peak < 1e-5 && m4.note === 'true' && m4.speaker === 'false', `${JSON.stringify(m4)}, peak ${db(afterReload2.peak).toFixed(0)} dBFS`)
  await live.click('.music-toggle')
  const t5 = (await now(live)) + 0.4
  await live.waitForTimeout(1500)
  const back = await measured(live, t5, t5 + 0.8)
  check('The note button unmutes the music again', back.peak > 1e-3 && (await pressed(live, '.music-toggle')) === 'false' && (await live.evaluate(() => localStorage.getItem('village.music.muted'))) === '0', `peak ${db(back.peak).toFixed(0)} dBFS`)
  const typed = await live.evaluate(() => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', shiftKey: true, bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))
    input.remove()
    return { music: window.village.music.musicMuted, all: window.village.babble.muted }
  })
  check('Typing "m" or "M" in a text field mutes nothing', !typed.music && !typed.all, JSON.stringify(typed))

  // The credit.
  // Clicking the note left it focused, which also shows the credit; start from rest.
  await live.evaluate(() => document.activeElement?.blur())
  await live.mouse.move(600, 100)
  await live.waitForTimeout(350)
  const hiddenOpacity = await live.evaluate(() => getComputedStyle(document.querySelector('.music-credit')).opacity)
  await live.hover('.music-toggle')
  await live.waitForTimeout(350)
  const credit = await live.evaluate(([source, licence]) => {
    const box = document.querySelector('.music-credit')
    const links = [...box.querySelectorAll('a')].map((a) => ({ text: a.textContent, href: a.href, target: a.target, rel: a.rel }))
    const title = links.find((l) => l.href === source)
    const licenceLink = links.find((l) => l.href === licence)
    const covered = (sel) => {
      const el = [...box.querySelectorAll('a')].find((a) => a.href === sel)
      const r = el.getBoundingClientRect()
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el && r.x >= 0 && r.right <= innerWidth && r.y >= 0
    }
    return { opacity: getComputedStyle(box).opacity, text: box.textContent, title, licenceLink, reachable: covered(source) && covered(licence) }
  }, [SOURCE, LICENCE])
  report.credit = credit.text
  check(
    'The credit shows on hover and links to the source and the licence: "Groove Music by benpm (CC BY 4.0)"',
    hiddenOpacity === '0' && credit.opacity === '1' && credit.text.includes('Groove Music by benpm (CC BY 4.0)') && credit.title?.target === '_blank' && credit.title.rel.includes('noopener') && credit.licenceLink && credit.reachable,
    `${credit.text}; links ${credit.title ? 'source' : 'NO source'}, ${credit.licenceLink ? 'licence' : 'NO licence'}; reachable ${credit.reachable}`,
  )
  // Keyboard: Tab to the note (the speaker button comes first), and the credit shows without a hover.
  await live.mouse.move(600, 100)
  await live.evaluate(() => document.activeElement?.blur())
  let tabs = 0
  while (tabs++ < 8 && !(await live.evaluate(() => document.activeElement?.closest('.music-note')))) await live.keyboard.press('Tab')
  await live.waitForTimeout(350)
  const focusShown = await live.evaluate(() => getComputedStyle(document.querySelector('.music-credit')).opacity)
  check('Tab reaches the note and the credit shows without a hover', focusShown === '1', `${tabs} Tab presses, opacity ${focusShown}`)

  // Unload: stop, disconnect, close.
  const gone = await live.evaluate(async () => {
    const { audio, bed } = window.village.music
    await window.village.unload('music')
    await new Promise((r) => setTimeout(r, 150))
    const before = localStorage.getItem('village.music.muted')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', shiftKey: true }))
    return {
      state: audio.state,
      stopped: !bed.playing,
      handle: 'music' in window.village,
      note: Boolean(document.querySelector('.music-note')),
      style: [...document.querySelectorAll('style')].some((s) => s.textContent.includes('.music-toggle')),
      shiftMInert: localStorage.getItem('village.music.muted') === before,
    }
  })
  check('Unload stops the loop, closes the AudioContext, removes the note, credit and handle, and Shift+M goes inert', gone.state === 'closed' && gone.stopped && !gone.handle && !gone.note && !gone.style && gone.shiftMInert, JSON.stringify(gone))
  await live.close()
}

// ?babble=off: no voices to duck for and no speaker button, so the music takes M itself.
{
  const p = await context.newPage()
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(`${base}?talk=npc&babble=off&plugins=music`)
  await p.evaluate(() => window.village.ready(5000))
  await p.evaluate(() => localStorage.clear())
  await p.reload()
  await p.evaluate(() => window.village.ready(5000))
  await p.mouse.click(400, 300)
  await waitForBed(p)
  await tap(p)
  await p.evaluate(() => window.village.kernel.root.emit('village/said', { villager: 'Dumpling', word: 'hello', index: 0, last: true }))
  await p.waitForTimeout(500)
  const gain = await p.evaluate(() => window.village.music.bed.ducking)
  await p.keyboard.press('m')
  const t = (await now(p)) + 0.5
  await p.waitForTimeout(1300)
  const silent = await measured(p, t, t + 0.6)
  const stored = await p.evaluate(() => ({ all: localStorage.getItem('village.babble.muted'), muted: window.village.music.muted, babbleButton: Boolean(document.querySelector('.babble-toggle')) }))
  check('?babble=off: no ducking, no speaker button, and M still mutes the music (kept under the same key)', gain === 1 && !stored.babbleButton && stored.all === '1' && stored.muted && silent.peak < 1e-5, `gain ${gain}, ${JSON.stringify(stored)}`)
  await p.close()
}

// Gating: without ?talk=npc, or with ?music=off, the plugin adds nothing.
for (const query of ['plugins=music', 'talk=npc&music=off&plugins=music']) {
  const p = await context.newPage()
  await p.goto(`${base}?${query}`)
  await p.evaluate(() => window.village.ready(5000))
  await p.mouse.click(10, 10)
  await p.waitForTimeout(250)
  const r = await p.evaluate(() => ({ note: Boolean(document.querySelector('.music-note')), handle: 'music' in window.village }))
  check(`?${query} adds nothing`, !r.note && !r.handle, JSON.stringify(r))
  await p.close()
}

check('No page errors', errors.length === 0, errors.join(' | '))
await browser.close()

console.log(JSON.stringify(report, null, 2))
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`)
const failed = checks.filter((c) => !c.pass).length
console.log(`\n${checks.length - failed}/${checks.length} checks pass`)
process.exit(failed ? 1 : 0)
