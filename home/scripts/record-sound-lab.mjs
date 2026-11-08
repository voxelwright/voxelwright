// Records the listening room's videos (#52): one short clip of the real home per
// interaction that has variants, with the sound rendered offline once per variant over
// the same timeline and muxed in. Playwright video has no audio, so (as in
// demo-babble.mjs) the page is covered in black until the clip starts; the moment the
// cover goes is stamped on the audio clock, ffmpeg's blackdetect finds it in the video,
// and the cues are placed by `window.village.sound.log`. The offline render plays the
// cues through the same Player and mix, the villagers' words through the Babbler, and the
// music bed at its level, with only the cue under test forced to each variant.
// Writes public/sound-lab/<cue>-<variant>.mp4 and manifest.json (gitignored).
// Checks each MP4 has an audio stream and that the first cue is heard within 50 ms of its
// logged time in the video. Usage: node scripts/record-sound-lab.mjs [base-url]
// (dev server running, 5491 by default; ffmpeg and ffprobe on PATH). Exits non-zero on a failed check.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5491/'
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const out = join(here, '../public/sound-lab')
const work = mkdtempSync(join(tmpdir(), 'sound-lab-'))
mkdirSync(out, { recursive: true })
const SR = 48000
const SIZE = { width: 960, height: 540 }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const errors = []

/** A black cover over everything from the first paint; it lets pointer events through. */
const COVER = () => {
  const add = () => {
    const c = document.createElement('div')
    c.id = 'lab-cover'
    c.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483647;pointer-events:none'
    document.documentElement.append(c)
  }
  if (document.documentElement) add()
  else document.addEventListener('DOMContentLoaded', add)
}

/** Hover Mia (she pauses), then click where she is now, as check-talk-npc.mjs does; she turns and her hello card appears. */
async function clickMia(p) {
  let mia = await p.evaluate(() => window.village.talk.screen('mia'))
  await p.mouse.move(mia.x, mia.y, { steps: 6 })
  await p.waitForTimeout(500)
  mia = await p.evaluate(() => window.village.talk.screen('mia'))
  await p.mouse.move(mia.x, mia.y)
  await p.waitForTimeout(150)
  await p.mouse.click(mia.x, mia.y)
  await p.waitForTimeout(3600)
}

/** Type a line on the notepad and send it to Moss (no model runs; the note only flies). */
async function sendToMoss(p) {
  await p.keyboard.type('chat with Moss', { delay: 55 })
  await p.waitForTimeout(250)
  await p.keyboard.press('Enter')
  await p.waitForTimeout(2600)
}

/** Each clip: how it is made, and what the page says about it. */
const CLIPS = [
  {
    cue: 'chose', how: 'real', note: 'Real: the pointer moves onto the notebook and clicks it (the plain home, without the villagers or music).', query: 'talk=off&build=0',
    async act(p) {
      const book = await spot(p, 'notebook')
      await p.mouse.move(book.x - 120, book.y + 60)
      await p.mouse.move(book.x, book.y, { steps: 8 })
      await p.waitForTimeout(450)
      await p.mouse.click(book.x, book.y)
      await p.waitForTimeout(2600)
    },
  },
  {
    cue: 'card', how: 'real', note: 'Real: clicking Mia; she turns and her hello card appears.', act: clickMia,
  },
  {
    cue: 'sent', how: 'real', note: 'Real: a line typed on the notepad and sent to Moss (no model runs; the note only flies).', act: sendToMoss,
  },
  { cue: 'turned', how: 'real', note: 'Real: clicking Mia; she turns to face you (her card follows).', act: clickMia },
  {
    cue: 'pad-up', how: 'real', note: 'Real: typing starts on the notepad and it rises.',
    async act(p) {
      await p.keyboard.type('hello Mia', { delay: 70 })
      await p.waitForTimeout(2200)
    },
  },
  { cue: 'pad-down', how: 'real', note: 'Real: a line sent to Moss; the notepad goes down as the note flies.', act: sendToMoss },
  {
    cue: 'news', how: 'real', note: 'Real "!" over Mia, shown by the dev hook (in the home it appears after her chore by the plant).',
    async act(p) {
      await p.evaluate(() => window.village.talk.notify('mia'))
      await p.waitForTimeout(2600)
    },
  },
  {
    cue: 'placed', how: 'emitted', note: 'Emitted: furnishing needs a model, so the "placed" event is sent from the dev handle while the camera shows the room; nothing new appears.',
    async act(p) {
      await p.evaluate(() => window.village.kernel.root.emit('village/furnish', { state: 'placed' }))
      await p.waitForTimeout(2200)
    },
  },
  {
    cue: 'page', how: 'real', note: 'Real: in the open journal, Arrow Down turns one leaf (to the tasks), then Arrow Right riffles four (the next villager).',
    async setup(p) {
      await p.keyboard.press('j')
      await p.waitForTimeout(1600)
    },
    async act(p) {
      await p.keyboard.press('ArrowDown')
      await p.waitForTimeout(1300)
      await p.keyboard.press('ArrowRight')
      await p.waitForTimeout(1800)
    },
  },
]

const spot = (p, id) => p.evaluate((id) => window.village.snapshot().entries.find((e) => e.id === id), id)

/** Record one clip: returns the webm, the cover's end on the audio clock, and what played. */
async function record(clip) {
  const dir = join(work, clip.cue)
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir, size: SIZE } })
  await context.addInitScript(COVER)
  const p = await context.newPage()
  p.on('pageerror', (e) => errors.push(`${clip.cue}: ${e}`))
  await p.goto(`${base}?${clip.query ?? 'talk=npc'}`)
  await p.evaluate(() => window.village.ready(15000))
  await p.waitForFunction((talk) => window.village.sound && (!talk || window.village.talk), (clip.query ?? 'talk=npc').includes('talk=npc'), { timeout: 8000 })
  await p.mouse.click(5, 5)
  await p.waitForFunction(() => window.village.sound.audio?.state === 'running', null, { timeout: 8000 })
  await p.evaluate(async () => {
    const { SOUND_EVENTS } = await import('/src/sound/map.ts')
    const s = window.village.sound
    const root = window.village.kernel.root
    window.labEvents = []
    window.labSaid = []
    const copy = (e) => JSON.parse(JSON.stringify(e ?? {}))
    for (const name of SOUND_EVENTS) root.on(name, (e) => window.labEvents.push({ name, e: copy(e), t: s.audio.currentTime }))
    root.on('village/said', (e) => window.labSaid.push({ e: copy(e), t: s.audio.currentTime }))
  })
  await p.waitForTimeout(1500)
  if (clip.setup) await clip.setup(p)
  const reveal = await p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
    const t0 = window.village.sound.audio.currentTime
    document.getElementById('lab-cover').remove()
    resolve({ t0, music: Boolean(window.village.music?.bed?.playing) })
  })))
  const wall0 = Date.now()
  await p.waitForTimeout(900)
  await clip.act(p)
  const seconds = (Date.now() - wall0) / 1000
  const got = await p.evaluate(() => ({ log: window.village.sound.log, events: window.labEvents, said: window.labSaid }))
  await context.close()
  const webm = join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')))
  return { webm, ...reveal, seconds, ...got }
}

/** The plays after the cover went, each with its event's payload (paired by context time and cue). */
async function playsOf(page, rec) {
  return page.evaluate(async ([rec]) => {
    const { MAP } = await import('/src/sound/map.ts')
    const used = new Set()
    const plays = []
    for (const l of rec.log) {
      if (l.at < rec.t0 - 0.001) continue
      const i = rec.events.findIndex((ev, k) => !used.has(k) && ev.t === l.contextTime && MAP[ev.name](ev.e) === l.cue)
      const ev = i >= 0 ? rec.events[i] : null
      if (i >= 0) used.add(i)
      plays.push({ cue: l.cue, variant: l.variant, t: l.at - rec.t0, pan: l.pan, seconds: typeof ev?.e.seconds === 'number' ? ev.e.seconds : undefined, event: ev?.e ?? {} })
    }
    return plays
  }, [rec])
}

/** Render a clip's sound offline: cues (with `force` on one cue), and optionally voices and music. */
const renderClip = (page, plays, said, seconds, force, opts) =>
  page.evaluate(async ([plays, said, seconds, force, opts]) => {
    const { Player } = await import('/src/sound/player.ts')
    const { PALETTE } = await import('/src/sound/palette/index.ts')
    const { mixFor, busFor } = await import('/src/voice/buses.ts')
    const { Bed } = await import('/src/voice/bed.ts')
    const { Babbler } = await import('/src/voice/engine.ts')
    const off = new OfflineAudioContext(2, Math.ceil(seconds * 48000), 48000)
    const mix = mixFor(off)
    mix.setMuted(false, 0)
    const player = new Player(off, PALETTE, 11)
    await player.load('/audio/sfx/')
    if (opts.music) {
      const buf = await off.decodeAudioData(await (await fetch('/audio/groove-music.ogg')).arrayBuffer())
      new Bed(off, buf, busFor(off, 'music')).start(0, 0)
    }
    if (opts.voices && said.length) {
      const babbler = new Babbler(off, busFor(off, 'voices'))
      for (const s of said) babbler.said(s.e, Math.max(0, s.t))
      mix.duck(true, Math.max(0, said[0].t))
      mix.duck(false, said.at(-1).t + 0.9)
    }
    for (const p of plays) player.play(p.cue, { ...p, variant: p.cue === force.cue ? force.variant : p.variant, at: p.t })
    const buffer = await off.startRendering()
    const b64 = (f32) => {
      const bytes = new Uint8Array(f32.buffer)
      let s = ''
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(s)
    }
    return [b64(buffer.getChannelData(0)), b64(buffer.getChannelData(1))]
  }, [plays, said, seconds, force, opts])

const decode = (b64) => new Float32Array(Buffer.from(b64, 'base64').buffer.slice(0))
function wav(path, [l, r]) {
  const pcm = Buffer.alloc(l.length * 4)
  for (let i = 0; i < l.length; i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), i * 4)
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), i * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24)
  h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  writeFileSync(path, Buffer.concat([h, pcm]))
}
/** First sample over -50 dBFS, in seconds. */
const onset = (x, from = 0) => {
  for (let i = Math.max(0, Math.floor(from * SR)); i < x.length; i++) if (Math.abs(x[i]) > 0.00316) return i / SR
  return NaN
}
/** The lag (s) that best aligns `y` with `x` around `t`, within ±0.1 s. */
function lag(x, y, t) {
  const a = Math.floor(t * SR), n = Math.floor(0.5 * SR), max = Math.floor(0.1 * SR)
  let best = -Infinity, at = 0
  for (let d = -max; d <= max; d += 8) {
    let s = 0
    for (let i = 0; i < n; i += 2) s += (x[a + i] ?? 0) * (y[a + i + d] ?? 0)
    if (s > best) (best = s), (at = d)
  }
  for (let d = at - 8; d <= at + 8; d++) {
    let s = 0
    for (let i = 0; i < n; i++) s += (x[a + i] ?? 0) * (y[a + i + d] ?? 0)
    if (s > best) (best = s), (at = d)
  }
  return at / SR
}
const mp4Audio = (file) => {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
}

const render = await browser.newPage()
render.on('pageerror', (e) => errors.push(`render: ${e}`))
await render.goto(`${base}?plugins=sound`)
const variantsOf = await render.evaluate(async () => {
  const { PALETTE } = await import('/src/sound/palette/index.ts')
  return Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, Object.keys(v).sort()]))
})

const manifest = { generated: new Date().toISOString(), audio: 'the cues, the villagers\' voices and the music', clips: [] }
const checks = []
for (const clip of CLIPS) {
  if (only && !only.includes(clip.cue)) continue
  const rec = await record(clip)
  const { stderr } = spawnSync('ffmpeg', ['-hide_banner', '-i', rec.webm, '-vf', 'blackdetect=d=0.1:pix_th=0.05', '-an', '-f', 'null', '-'], { encoding: 'utf8' })
  const blackEnd = Number(/black_end:([\d.]+)/.exec(stderr)?.[1] ?? NaN)
  if (!Number.isFinite(blackEnd)) throw new Error(`${clip.cue}: no black cover found in the video`)
  // A clip longer than 8 s (slow typing on a busy machine) loses its start, not its end.
  const skip = Math.max(0, rec.seconds - 8)
  const plays = (await playsOf(render, rec)).map((p) => ({ ...p, t: p.t - skip })).filter((p) => p.t >= 0)
  if (process.env.DEBUG) console.log(JSON.stringify({ t0: rec.t0, log: rec.log.slice(-8), events: rec.events.slice(-8).map((e) => [e.name, e.t]) }))
  const said = rec.said.filter((s) => s.t >= rec.t0 - 0.5).map((s) => ({ ...s, t: s.t - rec.t0 - skip }))
  const seconds = rec.seconds - skip
  const target = plays.find((p) => p.cue === clip.cue)
  if (!target) throw new Error(`${clip.cue}: the interaction did not play ${clip.cue} (played ${plays.map((p) => p.cue).join(' ') || 'nothing'})`)
  // The first cue on its own (no music or voices), to find its onset exactly.
  const cuesOnly = decode((await renderClip(render, plays, [], seconds, { cue: clip.cue, variant: 'a' }, {}))[0])
  const first = plays[0]
  const fits = plays.filter((p) => p.cue === clip.cue).every((p) => p.t + 0.3 < seconds)
  checks.push({ name: `${clip.cue}: every ${clip.cue} cue starts inside the clip`, pass: fits, detail: `${plays.filter((p) => p.cue === clip.cue).map((p) => p.t.toFixed(2)).join(', ')} s of ${seconds.toFixed(1)} s` })
  const heardOnce = new Set()
  const entry = { cue: clip.cue, how: clip.how, note: clip.note, music: rec.music, voices: said.length > 0, played: plays.map((p) => p.cue), firstCueAt: +first.t.toFixed(3), videos: {} }
  for (const variant of variantsOf[clip.cue]) {
    const chs = (await renderClip(render, plays, said, seconds, { cue: clip.cue, variant }, { music: rec.music, voices: true })).map(decode)
    const wavPath = join(work, `${clip.cue}-${variant}.wav`)
    wav(wavPath, chs)
    heardOnce.add(createHash('sha1').update(chs[0]).update(chs[1]).digest('hex'))
    const mp4 = join(out, `${clip.cue}-${variant}.mp4`)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(blackEnd + skip), '-i', rec.webm, '-i', wavPath, '-t', String(seconds),
      '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '24', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', mp4])
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4], { encoding: 'utf8' }))
    const hasAudio = probe.streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac')
    const duration = Number(probe.format.duration)
    // Where the first cue is heard in the MP4: its onset in the exact render plus how far the MP4's audio is shifted from that render.
    const heard = mp4Audio(mp4)
    const mono = chs[0].map((v, i) => (v + chs[1][i]) / 2)
    const cueOnset = onset(cuesOnly, first.t - 0.05)
    const shift = lag(mono, heard, Math.max(0, cueOnset - 0.1))
    const offMs = (cueOnset + shift - first.t) * 1000
    entry.videos[variant] = `sound-lab/${clip.cue}-${variant}.mp4`
    checks.push({ name: `${clip.cue}-${variant}.mp4`, pass: hasAudio && duration >= 3 && duration <= 8.1 && Math.abs(offMs) <= 50,
      detail: `${duration.toFixed(1)} s, audio ${hasAudio ? 'aac' : 'missing'}, first cue (${first.cue}) at ${first.t.toFixed(3)} s, heard ${offMs.toFixed(1)} ms from it (mux shift ${(shift * 1000).toFixed(1)} ms), ${(statSync(mp4).size / 1024).toFixed(0)} KB` })
  }
  checks.push({ name: `${clip.cue}: each variant sounds different`, pass: heardOnce.size === variantsOf[clip.cue].length, detail: `${heardOnce.size} distinct renders of ${variantsOf[clip.cue].length}` })
  manifest.clips.push(entry)
  console.log(`${clip.cue}: cover ends at ${blackEnd.toFixed(2)} s in the webm; played ${entry.played.join(' ')}; music ${rec.music}, voices ${entry.voices}`)
}
await browser.close()
// --only re-records some clips and keeps the others' entries.
const before = only && existsSync(join(out, 'manifest.json')) ? JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).clips : []
manifest.clips = CLIPS.map((c) => manifest.clips.find((x) => x.cue === c.cue) ?? before.find((x) => x.cue === c.cue)).filter(Boolean)
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
rmSync(work, { recursive: true, force: true })
if (errors.length) checks.push({ name: 'No page errors', pass: false, detail: errors.join(' | ') })
const total = readdirSync(out).filter((f) => f.endsWith('.mp4')).reduce((n, f) => n + statSync(join(out, f)).size, 0)
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`)
console.log(`\n${checks.filter((c) => c.pass).length}/${checks.length} pass; ${manifest.clips.length} clips, ${(total / 1048576).toFixed(1)} MB in public/sound-lab/`)
process.exit(checks.every((c) => c.pass) ? 0 : 1)

