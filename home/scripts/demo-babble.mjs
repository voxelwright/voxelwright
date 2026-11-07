// Records the babble demo (#42): a headless video of ?talk=npc&babble=demo, the same
// exchange rendered offline to a WAV from the logged event times, and an MP4 with the
// two joined by ffmpeg. Playwright video has no sound, so the page holds a black cover
// until the demo starts and ffmpeg's blackdetect finds that moment in the video.
// Also measures the cost: offline render time per audio second, main-thread time per
// word, and rAF frame intervals with the voices playing and with ?babble=off.
// Usage: node scripts/demo-babble.mjs [base-url] --out=dir   (dev server running; ffmpeg on PATH)
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5181/'
const out = args.find((a) => a.startsWith('--out='))?.slice(6)
if (!out) throw new Error('--out=dir is required')
mkdirSync(out, { recursive: true })
const SR = 48000
const SIZE = { width: 1280, height: 720 }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })

/** Frame intervals (ms) over `seconds`, sampled with rAF. */
const frameIntervals = (page, seconds) =>
  page.evaluate((seconds) => new Promise((resolve) => {
    const ds = []
    let last = performance.now()
    const end = last + seconds * 1000
    const step = (now) => {
      ds.push(now - last)
      last = now
      if (now < end) requestAnimationFrame(step)
      else resolve(ds)
    }
    requestAnimationFrame(step)
  }), seconds)
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return { frames: s.length, medianMs: +s[Math.floor(s.length / 2)].toFixed(1), p95Ms: +s[Math.floor(s.length * 0.95)].toFixed(1) }
}

// 1. The recording.
const videoDir = join(out, 'video-tmp')
const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: videoDir, size: SIZE } })
const page = await context.newPage()
await page.goto(`${base}?talk=npc&babble=demo`)
await page.evaluate(() => window.village.ready(15000))
await page.waitForTimeout(1500)
await page.mouse.click(SIZE.width / 2, SIZE.height / 2)
const during = frameIntervals(page, 12)
await page.waitForFunction(() => window.babbleDemo?.done, null, { timeout: 60000 })
const playing = stats(await during)
await page.waitForTimeout(1500)
const log = await page.evaluate(() => window.babbleDemo.log)
await context.close()
const webm = readdirSync(videoDir).find((f) => f.endsWith('.webm'))
renameSync(join(videoDir, webm), join(out, 'babble-demo-video.webm'))

// 2. The same events, rendered offline, and the cost of rendering and scheduling them.
const render = await browser.newPage()
await render.goto(`${base}?plugins=babble`)
const wav = await render.evaluate(async ([log, SR]) => {
  const { Babbler } = await import('/src/voice/engine.ts')
  const seconds = log.at(-1).t + 1.5
  const off = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR)
  const babbler = new Babbler(off, off.destination)
  const s0 = performance.now()
  for (const { t, e } of log) babbler.said(e, t)
  const scheduleMs = performance.now() - s0
  const r0 = performance.now()
  const buf = await off.startRendering()
  const renderMs = performance.now() - r0
  const bytes = new Uint8Array(buf.getChannelData(0).buffer)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { b64: btoa(s), seconds, renderMs, scheduleMsPerWord: scheduleMs / log.length }
}, [log, SR])
const x = new Float32Array(Buffer.from(wav.b64, 'base64').buffer.slice(0))
const pcm = Buffer.alloc(x.length * 2)
for (let i = 0; i < x.length; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), i * 2)
const h = Buffer.alloc(44)
h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24)
h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
const wavPath = join(out, 'babble-demo.wav')
writeFileSync(wavPath, Buffer.concat([h, pcm]))
writeFileSync(join(out, 'babble-demo-events.json'), JSON.stringify(log, null, 1))

// 3. The baseline: the same room with the voices off.
const quiet = await browser.newPage({ viewport: SIZE })
await quiet.goto(`${base}?talk=npc&babble=off`)
await quiet.evaluate(() => window.village.ready(15000))
await quiet.waitForTimeout(1500)
const off = stats(await frameIntervals(quiet, 12))
await browser.close()

// 4. Find the end of the black cover and join the sound to the picture there.
const video = join(out, 'babble-demo-video.webm')
const { stderr } = spawnSync('ffmpeg', ['-hide_banner', '-i', video, '-vf', 'blackdetect=d=0.1:pix_th=0.05', '-an', '-f', 'null', '-'], { encoding: 'utf8' })
const blackEnd = Number(/black_end:([\d.]+)/.exec(stderr)?.[1] ?? NaN)
if (!Number.isFinite(blackEnd)) throw new Error('no black cover found in the video')
const mp4 = join(out, 'babble-demo.mp4')
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-itsoffset', String(blackEnd), '-i', wavPath,
  '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', mp4])

const result = {
  mp4, wav: wavPath, video,
  audioStartsInVideoAt: blackEnd,
  words: log.length,
  seconds: +wav.seconds.toFixed(1),
  offlineRenderMsPerAudioSecond: +(wav.renderMs / wav.seconds).toFixed(1),
  scheduleMsPerWord: +wav.scheduleMsPerWord.toFixed(3),
  frames: { voicesPlaying: playing, voicesOff: off },
}
writeFileSync(join(out, 'babble-demo-result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
