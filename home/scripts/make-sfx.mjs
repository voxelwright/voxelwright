// Turns chosen takes from Freesound originals into the palette's small sample files (#52).
// Each sound becomes one mono Ogg Opus sprite in public/audio/sfx/: every take trimmed to its
// event, high-passed (rumble) and gently low-passed, faded in and out with raised cosines,
// matched in loudness to the others (K-weighted RMS of its loudest 50 ms), and laid end to end
// with silence between. Writes src/sound/palette/sprites.ts with each take's start and length,
// so a cue can pick a take by round-robin index.
// Usage: node scripts/make-sfx.mjs --samples=<dir with <id>/<file> and meta.json>
// The originals are untrusted data: they are only decoded by ffmpeg, never run or imported.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const samples = process.argv.slice(2).find((a) => a.startsWith('--samples='))?.slice(10)
if (!samples) throw new Error('usage: node scripts/make-sfx.mjs --samples=<dir>')
const SR = 48000
const OUT = join(here, '../public/audio/sfx')
const BITRATE = '56k'
/** Loudest-50-ms K-weighted RMS each take is matched to, in dBFS; peaks are kept under -1 dBFS. */
const TARGET = -18
const GAP = 0.08

/**
 * The takes, in seconds of each original, picked from measured event windows (not by ear).
 * `rate` retunes a tonal sample to the palette's key before encoding.
 */
const SPRITES = {
  'wood-clicks': { id: '565027', takes: [[0.19, 0.38], [0.57, 0.76], [1.39, 1.58], [1.81, 2.0], [2.27, 2.46], [2.71, 2.9]] },
  'kalimba-g5': { id: '691805', takes: [[0.0, 0.75]] },
  'music-box-g5': { id: '732943', takes: [[0.12, 1.3]], cents: -28 },
  tears: { id: '759322', takes: [[0.18, 0.86], [1.44, 1.94], [2.24, 2.74], [3.56, 4.2]] },
  'paper-swish': { id: '389809', takes: [[0.36, 0.84], [1.06, 1.44], [1.62, 1.98]] },
  'paper-slide': { id: '560352', takes: [[0.22, 0.74], [0.72, 1.0], [1.4, 1.85]] },
  cushion: { id: '593948', takes: [[0.14, 0.44], [1.38, 1.68], [2.66, 2.96], [3.72, 4.02], [7.02, 7.32]] },
  'page-turn': { id: '136778', takes: [[0.06, 1.66]] },
}

const kWeight = (x) => {
  const bq = (input, b, a) => {
    const y = new Float64Array(input.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < input.length; i++) {
      const v = b[0] * input[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
      x2 = x1; x1 = input[i]; y2 = y1; y1 = v
      y[i] = v
    }
    return y
  }
  return bq(bq(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]), [1, -2, 1], [1, -1.99004745483398, 0.99007225036621])
}
const loudest = (x) => {
  const k = kWeight(x)
  const w = 0.05 * SR
  let best = 0
  for (let i = 0; i + w <= k.length; i += w / 4) {
    let s = 0
    for (let j = 0; j < w; j++) s += k[i + j] ** 2
    best = Math.max(best, s / w)
  }
  return 10 * Math.log10(Math.max(best, 1e-20))
}

function decode(file, cents = 0) {
  // Mono, rumble and the top octave rolled off, resampled to 48 kHz; a retune resamples by the rate.
  const rate = 2 ** (cents / 1200)
  const filters = ['highpass=f=90:p=2', 'lowpass=f=11000']
  if (cents) filters.unshift(`aresample=${SR}`, `asetrate=${Math.round(SR * rate)}`, `aresample=${SR}`)
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-af', filters.join(','), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  if (r.status) throw new Error(`ffmpeg could not decode ${file}: ${r.stderr}`)
  return { x: new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4), rate }
}

const cos = (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)))
mkdirSync(OUT, { recursive: true })
const tmp = join(here, '../generated/sfx-tmp')
mkdirSync(tmp, { recursive: true })
const table = {}
const used = []
let total = 0
for (const [name, spec] of Object.entries(SPRITES)) {
  const dir = join(samples, spec.id)
  const file = readdirSync(dir).find((f) => f !== 'meta.json')
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
  const { x, rate } = decode(join(dir, file), spec.cents ?? 0)
  const parts = []
  const takes = []
  let cursor = GAP
  for (const [from, to] of spec.takes) {
    // A retune shortens the take in time by its rate.
    const a = Math.round((from / rate) * SR)
    const b = Math.min(x.length, Math.round((to / rate) * SR))
    const t = Float32Array.from(x.subarray(a, b))
    const fadeIn = Math.round(0.004 * SR)
    const fadeOut = Math.min(Math.round(0.06 * SR), Math.floor(t.length / 3))
    for (let i = 0; i < fadeIn; i++) t[i] *= cos(i / fadeIn)
    for (let i = 0; i < fadeOut; i++) t[t.length - 1 - i] *= cos(i / fadeOut)
    let g = 10 ** ((TARGET - loudest(t)) / 20)
    const peak = t.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    g = Math.min(g, 10 ** (-1 / 20) / peak)
    for (let i = 0; i < t.length; i++) t[i] *= g
    takes.push([+cursor.toFixed(4), +(t.length / SR).toFixed(4)])
    parts.push(new Float32Array(Math.round(GAP * SR)), t)
    cursor += t.length / SR + GAP
  }
  parts.push(new Float32Array(Math.round(GAP * SR)))
  const n = parts.reduce((s, p) => s + p.length, 0)
  const all = new Float32Array(n)
  let o = 0
  for (const p of parts) { all.set(p, o); o += p.length }
  const raw = join(tmp, `${name}.f32`)
  writeFileSync(raw, Buffer.from(all.buffer))
  const ogg = join(OUT, `${name}.ogg`)
  const enc = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', raw, '-map_metadata', '-1', '-c:a', 'libopus', '-b:a', BITRATE, '-vbr', 'on', '-compression_level', '10', '-application', 'audio', ogg])
  if (enc.status) throw new Error(`ffmpeg could not encode ${ogg}: ${enc.stderr}`)
  const kb = statSync(ogg).size / 1024
  total += kb
  table[name] = { file: `${name}.ogg`, takes }
  used.push({ name, id: spec.id, file, meta, takes: spec.takes, cents: spec.cents ?? 0 })
  console.log(`${name}.ogg  ${spec.takes.length} takes  ${(n / SR).toFixed(2)} s  ${kb.toFixed(1)} KB  from ${spec.id} (${meta.author})`)
}
rmSync(tmp, { recursive: true, force: true })

const ts = `// Generated by scripts/make-sfx.mjs; do not edit by hand. Each sprite is one file in
// public/audio/sfx/ holding several takes of a sound: [start, length] in seconds.
export const SPRITES = {
${Object.entries(table).map(([k, v]) => `  '${k}': { file: '${v.file}', takes: [${v.takes.map(([a, b]) => `[${a}, ${b}]`).join(', ')}] },`).join('\n')}
} as const

export type SpriteName = keyof typeof SPRITES
`
writeFileSync(join(here, '../src/sound/palette/sprites.ts'), ts)
writeFileSync(join(here, '../generated/sfx-sources.json'), JSON.stringify(used, null, 2))
console.log(`total ${total.toFixed(1)} KB in ${OUT}`)
