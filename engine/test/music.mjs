// The music, measured (#247): the rules, the search and what comes of them, in Node with no browser. A section is
// composed from a number, played through the same synthesiser the page runs, and what comes out is measured.
//
// What this stands in for: that the rules measure what they say (a tresillo is a tresillo), that the search finds
// patterns that score far better than chance, that the same number gives the same music and another number another,
// that every note is in the place's scale, that a piece is neither silent nor loud, and that going from one place's
// music to another's leaves no hole and no click. What it cannot say: whether any of it is good to listen to.
//
//   node test/music.mjs [--out dir]     with --out, a WAV and a picture of each place's music are kept
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CEILING, SET, Synth } from '../page/sound/dsp.ts'
import { compile, patch } from '../page/sound/patch.ts'
import { MOODS, TRIES, arc, compose } from '../page/sound/music/compose.ts'
import { length, perform } from '../page/sound/music/perform.ts'
import * as R from '../page/sound/music/rules.ts'
import * as ears from './ears.mjs'
import { arg } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const out = arg('out', '')
if (out) mkdirSync(out, { recursive: true })
const show = (b) => b.map((v) => (v > 0 ? 'x' : '.')).join('')
const around = { steps: 16, beat: 4, scale: [0, 2, 3, 5, 7, 9, 10], minor: true, chords: [[0, 2, 4]], want: 4 }

console.log('The rules measure what they say')
{
  check(show(R.euclid(3, 8)) === 'x..x..x.', `three strokes in eight, spread as evenly as may be, is the tresillo (${show(R.euclid(3, 8))})`)
  const turns = (a, b) => { for (let r = 0; r < a.length; r++) if (a.every((v, i) => v === b[(i + r) % b.length])) return true; return false }
  check(turns(show(R.euclid(5, 8)).split(''), 'x.xx.xx.'.split('')) && turns(show(R.euclid(5, 12)).split(''), 'x..x.x..x.x.'.split('')) && turns(show(R.euclid(7, 16)).split(''), 'x..x.x.x..x.x.x.'.split('')), `five in eight is a turn of the cinquillo, five in twelve of the Venda clap, seven in sixteen of the samba (Toussaint’s list: ${show(R.euclid(5, 8))}, ${show(R.euclid(5, 12))}, ${show(R.euclid(7, 16))})`)
  const floor = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], off = floor.map((_, i) => (i % 4 === 2 ? 1 : 0)), tres = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0]
  check(R.onTheFloor.score(floor, around) === 1 && R.onTheFloor.score(tres, around) < 0.8, 'a kick on every beat is four on the floor; a tresillo is not')
  check(R.syncopation(floor, 16, 4) === 0 && R.syncopation(tres, 16, 4) > R.syncopation(floor, 16, 4) && R.syncopation(off, 16, 4) > 0, `strokes on the beat do not push; a tresillo does (${R.syncopation(tres, 16, 4).toFixed(2)}), strokes between the beats do (${R.syncopation(off, 16, 4).toFixed(2)})`)
  check(R.fillsGaps.score(off, { ...around, kick: floor }) === 1 && R.fillsGaps.score(floor, { ...around, kick: floor }) === 0, 'a hat between the kicks fills the gaps; one on them does not')
  check(R.even.score(floor, around) === 1 && R.even.score([1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], around) < 0.3, 'four strokes a beat apart are evenly spread; four in a clump are not')
  const scale = [0, 1, 2, 3, 4, 3, 2, 1, 0, -2, -2, -2, -1, -1, -1, -1], leaps = [0, 6, 1, 7, 0, 6, 1, 7, 0, 6, 1, 7, 0, 6, 1, 7]
  check(R.bySteps.score(scale, around) > R.bySteps.score(leaps, around) + 0.5, 'a line up and down the scale moves by step; one that jumps a seventh each time does not')
  const dorian = [0, 2, 4, 7, 4, 2, 0, -2, -2, -2, -2, -2, -1, -1, -1, -1], wrong = { ...around, scale: [1, 3, 6, 8, 10, 11, 13] }
  check(R.inKey.score(dorian, around) > R.inKey.score(dorian, wrong) + 0.3, `a line on the key’s chord sounds in its key (${R.inKey.score(dorian, around).toFixed(2)}); the same shape a semitone off does not (${R.inKey.score(dorian, wrong).toFixed(2)})`)
  check(R.comesHome.score(dorian, around) === 1 && R.comesHome.score([0, 1, 2, 1, -1, -1, -1, -1], around) < 0.5, 'a line that ends held on the tonic comes to rest; one that ends on the second does not')
  const all = Object.values(R).filter((r) => r && typeof r === 'object' && 'score' in r)
  check(all.every((r) => r.name && r.why && r.source && ['read', 'from memory', 'ours'].includes(r.read)), `each of the ${all.length} rules says what it is for, where it comes from and whether that was read (${all.filter((r) => r.read === 'read').length} read, ${all.filter((r) => r.read === 'from memory').length} from memory, ${all.filter((r) => r.read === 'ours').length} ours)`)
}

console.log('The search')
const sections = {}
{
  let worst = 1, least = 1, ms = 0, n = 0
  for (const m of Object.values(MOODS)) {
    const s = sections[m.name] = compose(m, 7)
    ms = Math.max(ms, s.ms)
    for (const p of s.parts) if (p.tried) { n++; worst = Math.min(worst, p.total); least = Math.min(least, p.total - p.mean) }
  }
  check(worst > 0.75 && least > 0.12, `of ${TRIES} patterns tried for each of ${n} voices in seven places, the one kept scores ${(worst * 100).toFixed(0)}% at worst, and at least ${(least * 100).toFixed(0)} points over what a pattern scores on average`)
  const town = sections.town, part = (name) => town.parts.find((p) => p.voice === name)
  check(show(Array.from({ length: 16 }, (_, i) => (part('kick').notes.some((x) => x.at === i) ? 1 : 0))) === 'x...x...x...x...', 'the town’s kick, found among random patterns, is four on the floor')
  check(part('hat').notes.every((x) => x.at % 4 !== 0), `its hat is all between the kicks (${show(Array.from({ length: 16 }, (_, i) => (part('hat').notes.some((x) => x.at === i) ? 1 : 0)))})`)
  check(compose(MOODS.town, 7).parts.every((p, i) => JSON.stringify(p.notes) === JSON.stringify(town.parts[i].notes)), 'the same number gives the same section')
  const leads = new Set(), hats = new Set()
  for (let seed = 0; seed < 40; seed++) { const s = compose(MOODS.town, seed * 977, { tries: 600 }); leads.add(JSON.stringify(s.parts.find((p) => p.voice === 'lead').notes.map((x) => [x.at, x.midi]))); hats.add(show(Array.from({ length: 16 }, (_, i) => (s.parts.find((p) => p.voice === 'hat').notes.some((x) => x.at === i) ? 1 : 0)))) }
  check(leads.size === 40, `forty numbers give forty different melodies (and ${hats.size} different hats: the rules leave a hat less room)`)
  let outside = 0, notes = 0
  for (const m of Object.values(MOODS)) for (const p of sections[m.name].parts) for (const x of p.notes) if (x.midi) { notes++; if (!m.scale.includes((((x.midi - m.tonic) % 12) + 12) % 12)) outside++ }
  check(outside === 0 && new Set(Object.values(MOODS).map((m) => m.tonic % 12)).size === 1, `every one of ${notes} notes is in its place’s scale, and every place has the same tonic (D)`)
  check(ms < 400, `a section is found in ${ms.toFixed(0)} ms at most here (on a thread of its own in the page, with a section’s length to spare)`)
  const patches = new Set(Object.values(MOODS).flatMap((m) => m.voices.map((v) => v.patch)))
  check([...patches].every((p) => 'patch' in patch(JSON.parse(JSON.stringify(p)))), `the ${patches.size} instruments are patches in the same form as any other sound`)
}

/** Plays sections of a mood one after another from `at` seconds on, as the conductor would. */
const sr = 48000
function play(synth, ids, mood, at, count, seed = 7, stopAt = Infinity, takingOver = false) {
  const m = MOODS[mood], layers = arc(m.sections, Math.max(...m.voices.map((v) => v.layer)), takingOver), list = []
  let figure, len = 0
  let jit = 1
  const jitter = () => { jit = (jit * 1103515245 + 12345) >>> 0; return jit / 4294967296 }
  for (let i = 0; i < count; i++) {
    const s = compose(m, seed + i, { groove: seed + (i >> 1) * 7919, figure, tries: 800 })
    figure ??= s.parts.find((p) => p.line)?.line
    len = length(s)
    for (const n of perform(s, i * s.steps * s.bars, (i + 1) * s.steps * s.bars, layers[Math.min(i, layers.length - 1)], jitter)) {
      if (at + n.at >= stopAt) continue
      if (!ids.has(n.patch)) { ids.set(n.patch, ids.size + 1); synth.define(ids.get(n.patch), compile(n.patch)) }
      list.push(Math.round((at + n.at) * sr), ids.get(n.patch), n.hz, 1, n.force, n.dur, n.gain * Math.sqrt(0.5 * (1 - n.pan)) * 1.25, n.gain * Math.sqrt(0.5 * (1 + n.pan)) * 1.25, 0, n.room, 1, 0)
    }
  }
  synth.notes(list)
  return len * count
}

console.log('Played')
{
  const loud = {}
  let top = 0
  for (const mood of Object.keys(MOODS)) {
    const s = new Synth(sr), secs = Math.min(70, play(s, new Map(), mood, 0.1, 6) + 3), l = new Float32Array(Math.round(secs * sr)), r = new Float32Array(l.length)
    s.render(l, r)
    loud[mood] = ears.lufs(l, r, sr); top = Math.max(top, ears.peak(l), ears.peak(r))
    if (out) { ears.wav(join(out, `music-${mood}.wav`), l, r, sr); ears.spectrogram(join(out, `music-${mood}.png`), l, sr, { tick: 5 }) }
  }
  check(Object.values(loud).every((v) => v > -38 && v < -20) && top < CEILING, `each place’s music lies under the world: between -38 and -20 LUFS (${Object.entries(loud).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}), peak ${ears.db(top).toFixed(0)} dB`)
  // Town to coast at a bar line: the town stops being struck, the coast comes in.
  const s = new Synth(sr), ids = new Map(), town = sections.town, bar = length(town) / town.bars, change = 0.1 + 5 * length(town) + 2 * bar
  play(s, ids, 'town', 0.1, 8, 7, change)
  play(s, ids, 'coast', change, 3, 11, Infinity, true)
  const l = new Float32Array(Math.round((change + 14) * sr)), r = new Float32Array(l.length)
  s.render(l, r)
  if (out) { ears.wav(join(out, 'music-town-to-coast.wav'), l, r, sr); ears.spectrogram(join(out, 'music-town-to-coast.png'), l.subarray(Math.round((change - 14) * sr)), sr, { tick: 2 }) }
  const env = ears.envelope(l, sr, 250), at = Math.round(change / 0.25), before = env.slice(at - 16, at), after = env.slice(at, at + 24)
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, quietest = Math.min(...after), usual = mean(before)
  check(quietest > usual * 0.05, `going from the town’s music to the coast’s leaves no hole: the quietest quarter second of the six after is ${ears.db(quietest / usual).toFixed(0)} dB against the town before`)
  let jump = 0
  for (let i = Math.round((change - 0.5) * sr); i < Math.round((change + 0.5) * sr); i++) jump = Math.max(jump, Math.abs(l[i] - l[i - 1]))
  let usualJump = 0
  for (let i = Math.round((change - 6) * sr); i < Math.round((change - 1) * sr); i++) usualJump = Math.max(usualJump, Math.abs(l[i] - l[i - 1]))
  check(jump <= usualJump * 1.5, `and no click: the biggest step between two samples round the change is ${jump.toFixed(4)}, and ${usualJump.toFixed(4)} in the town’s own music before it`)
}

if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('music: ok')
