// Renders every generated villager's babble voice offline on one fixed line and measures it (#47).
// Input: JSON [{id, arm?, description, name, voice?}]. Each entry renders as "model" (its own voice, if given)
// and as "mapped" (voiceFromDescription). Writes WAVs, results.md and results.json to --wav=dir.
// Usage: node scripts/villagers/voices.mjs <voices.json> [base-url] --wav=<dir>   (dev server running)
// Exits non-zero when a directional check fails. Models cannot listen: these are numbers, not taste.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { SR, decode, db, median, frames, yin, centroid, lufs, peakOf, wav, rate } from './audio.mjs'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--') && a.endsWith('.json'))
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:5331/'
const wavDir = args.find((a) => a.startsWith('--wav='))?.slice(6)
if (!file || !wavDir) {
  console.error('usage: node scripts/villagers/voices.mjs <voices.json> [base-url] --wav=<dir>')
  process.exit(2)
}
mkdirSync(wavDir, { recursive: true })
const entries = JSON.parse(readFileSync(file, 'utf8'))
const LINE = 'Good morning! I put the soup on, and the basil looks thirsty. Shall we eat at six?'
// A slow reveal (chars a second) so no voice falls behind its text and skips words: the test measures voices, not lag.
const REVEAL = 14
const SECONDS = 10

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const page = await (await browser.newContext()).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`${base}?talk=npc&plugins=babble`)
await page.evaluate(() => window.village.ready(5000))
await page.evaluate(async (SR) => {
  const { Babbler } = await import('/src/voice/engine.ts')
  const { timeline } = await import('/src/voice/demo.ts')
  const { registerVoice, unregisterVoice } = await import('/src/voice/profiles.ts')
  const { voiceFromDescription, clampVoice } = await import('/src/voice/gen.ts')
  const b64 = (f32) => {
    const bytes = new Uint8Array(f32.buffer)
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
  }
  // Registers the profile under `id`, renders the line as that villager, unregisters.
  window.renderVoice = async (id, profile, text, seconds, reveal) => {
    registerVoice(id, profile)
    try {
      const events = timeline([{ villager: id, text }], reveal).map(({ t, e }) => ({ t: t - 0.4, e }))
      const off = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR)
      const babbler = new Babbler(off, off.destination, {})
      for (const { t, e } of events) babbler.said(e, t)
      return b64((await off.startRendering()).getChannelData(0))
    } finally {
      unregisterVoice(id)
    }
  }
  window.mapVoice = (d) => voiceFromDescription(d)
  window.clamp = (v) => clampVoice(v)
}, SR)

const jobs = []
for (const e of entries) {
  if (e.voice) jobs.push({ ...e, arm: 'model', profile: await page.evaluate((v) => window.clamp(v), e.voice) })
  jobs.push({ ...e, arm: 'mapped', profile: await page.evaluate((d) => window.mapVoice(d), e.description) })
}

const rows = []
for (const j of jobs) {
  const b64 = await page.evaluate(([id, p, t, s, r]) => window.renderVoice(id, p, t, s, r), [`${j.id}-${j.arm}`, j.profile, LINE, SECONDS, REVEAL])
  const x = decode(b64)
  const f0s = frames(x, yin)
  const gate = 0.05 * peakOf(x)
  const voiced = [x.findIndex((v) => Math.abs(v) > gate), x.length - 1 - [...x].reverse().findIndex((v) => Math.abs(v) > gate)]
  const row = {
    id: j.id, name: j.name, arm: j.arm, profile: j.profile,
    f0Hz: Math.round(median(f0s)), f0Frames: f0s.length, centroidHz: Math.round(median(frames(x, centroid))),
    syllablesPerSec: +rate(x).toFixed(1), lufs: +lufs(x).toFixed(1), peakDbfs: +db(peakOf(x)).toFixed(1),
    durationS: +((voiced[1] - voiced[0]) / SR).toFixed(2),
  }
  wav(x, join(wavDir, `${j.id}-${j.arm}.wav`))
  rows.push(row)
}

// ── pairwise distinctness per arm ───────────────────────────────────────────
const semis = (a, b) => Math.abs(12 * Math.log2(a / b))
const arms = [...new Set(rows.map((r) => r.arm))]
const pairs = []
for (const arm of arms) {
  const rs = rows.filter((r) => r.arm === arm)
  for (let i = 0; i < rs.length; i++)
    for (let k = i + 1; k < rs.length; k++) {
      const st = semis(rs[i].f0Hz, rs[k].f0Hz)
      const cen = Math.abs(rs[i].centroidHz - rs[k].centroidHz) / Math.min(rs[i].centroidHz, rs[k].centroidHz)
      pairs.push({ arm, a: rs[i].id, b: rs[k].id, semitones: +st.toFixed(1), centroidPct: Math.round(cen * 100), tooClose: st < 3 && cen < 0.2 })
    }
}

// ── directional checks (the five fixture descriptions, matched by their key word) ──
const checks = []
for (const arm of arms) {
  const by = (word) => rows.find((r) => r.arm === arm && r.id.includes(word))
  const [mouse, tortoise, bear] = ['mouse', 'tortoise', 'bear'].map(by)
  if (!mouse || !tortoise || !bear) continue
  const fixture = rows.filter((r) => r.arm === arm && !r.id.startsWith('ref-'))
  const slowest = [...fixture].sort((a, b) => a.syllablesPerSec - b.syllablesPerSec).slice(0, 2).map((r) => r.id)
  const c = (name, pass, detail) => checks.push({ arm, name, pass, detail })
  c('mouse f0 > tortoise f0', mouse.f0Hz > tortoise.f0Hz, `${mouse.f0Hz} vs ${tortoise.f0Hz} Hz`)
  c('mouse f0 > bear f0', mouse.f0Hz > bear.f0Hz, `${mouse.f0Hz} vs ${bear.f0Hz} Hz`)
  c('mouse rate > tortoise rate', mouse.syllablesPerSec > tortoise.syllablesPerSec, `${mouse.syllablesPerSec} vs ${tortoise.syllablesPerSec} syl/s`)
  c('bear centroid < mouse centroid', bear.centroidHz < mouse.centroidHz, `${bear.centroidHz} vs ${mouse.centroidHz} Hz`)
  c('tortoise rate is slowest or second slowest', slowest.includes(tortoise.id), `slowest two: ${slowest.join(', ')}`)
}
if (errors.length) checks.push({ arm: '-', name: 'No page errors', pass: false, detail: errors.join(' | ') })
await browser.close()

// ── report ──────────────────────────────────────────────────────────────────
const warn = (r) => [r.f0Frames < 8 ? 'f0 tracker thin' : '', r.peakDbfs > -3 ? 'hot peak' : '', r.lufs < -40 ? 'quiet' : ''].filter(Boolean).join(', ')
const md = [
  `# Voice renders`, '', `Line: "${LINE}"`, '',
  '| id | arm | f0 Hz | centroid Hz | syl/s | LUFS | peak dBFS | voiced s | f0 frames | flags |', '|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${r.arm} | ${r.f0Hz} | ${r.centroidHz} | ${r.syllablesPerSec} | ${r.lufs} | ${r.peakDbfs} | ${r.durationS} | ${r.f0Frames} | ${warn(r)} |`),
  '', '## Pairwise distinctness', 'Flagged when closer than 3 semitones AND 20% centroid.', '',
  '| arm | a | b | semitones | centroid % | flag |', '|---|---|---|---|---|---|',
  ...pairs.map((p) => `| ${p.arm} | ${p.a} | ${p.b} | ${p.semitones} | ${p.centroidPct} | ${p.tooClose ? 'TOO CLOSE' : ''} |`),
  '', '## Directional checks', '',
  ...checks.map((c) => `- ${c.pass ? 'PASS' : 'FAIL'} [${c.arm}] ${c.name} (${c.detail})`), '',
].join('\n')
writeFileSync(join(wavDir, 'results.md'), md)
writeFileSync(join(wavDir, 'results.json'), JSON.stringify({ line: LINE, rows, pairs, checks }, null, 2))
console.log(md)
process.exit(checks.some((c) => !c.pass) ? 1 : 0)
