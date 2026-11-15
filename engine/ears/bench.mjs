// The benchmark clips (#410): what the engine really plays, rendered to WAV files with nobody listening. The
// synthesiser is the page's own worklet file run in Node (page/sound/dsp.ts imports nothing and the page connects
// it straight to the output), events are placed as page/sound/sound.ts places them, and music is given to it as
// the conductor gives it (music/perform.ts). The set and its seeds are fixed: it is what the judge (judge.py)
// scores, before and after a change.
//
//   node ears/bench.mjs --out dir [--only name,name] [--held 1]
//
// --held 1 renders the same clips from other seeds: the ones a change is never tuned on.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SET, Synth } from '../page/sound/dsp.ts'
import { compile } from '../page/sound/patch.ts'
import { BREAK, HIT, WORLD } from '../page/sound/kinds.ts'
import { LIKES } from '../page/sound/likes.ts'
import { guitar, ocarina, piano } from '../page/sound/instruments.ts'
import { MOODS, arc, compose, moodKey, resolve } from '../page/sound/music/compose.ts'
import { length, perform } from '../page/sound/music/perform.ts'
import * as ears from '../test/ears.mjs'
import { arg } from '../test/kit.mjs'

export const SR = 48000
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12)

/** A synthesiser with what a clip needs to drive it as the page does. */
export function stage(seed = 1) {
  const synth = new Synth(SR), ids = new Map(), list = [], marks = []
  let s = seed >>> 0 || 1
  const rand = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296 }
  const id = (p) => { if (!ids.has(p)) { ids.set(p, ids.size + 1); synth.define(ids.get(p), compile(p)) } return ids.get(p) }
  /** As sound.ts `hear`: how loud, how dull and how late a thing `far` metres off is, `side` -1 to 1. */
  const hear = (far, reach = 4, side = 0) => ({ gain: reach / (reach + far), pan: side * Math.min(1, far / 1.5) * 0.9, lp: 400 + 19600 * Math.exp(-far / 90), late: far / 343, send: Math.min(0.5, 0.08 + far / 120) })
  /** As sound.ts `play`. `how.far` places it in the world; without it, it is at the ear (a step, a tool in hand). */
  const play = (patch, at, how = {}) => {
    let gain = how.gain ?? 1, pan = how.pan ?? 0, lp = 0, late = 0, send = how.room ?? 0
    if (how.far !== undefined) { const h = hear(how.far, how.reach, how.side ?? 0); gain = h.gain; pan = h.pan; lp = h.lp; late = how.travels === false ? 0 : h.late; send = h.send }
    list.push(Math.round((at + late) * SR), id(patch), how.pitch ?? 0, how.size ?? 1, how.force ?? 0.7, how.dur ?? 0, gain * Math.sqrt(0.5 * (1 - pan)) * 1.25, gain * Math.sqrt(0.5 * (1 + pan)) * 1.25, lp, send, how.bus ?? 0, 0)
    if ((how.bus ?? 0) === 0 && how.mark !== false) marks.push(+(at + late).toFixed(4))
  }
  /** As the conductor: sections of a mood one after another from `at`, a layer at a time. Returns its length. */
  const music = (mood, at, count, from = 7, stopAt = Infinity, takingOver = false) => {
    const m = resolve(mood), layers = arc(m.sections, Math.max(...m.voices.map((v) => v.layer)), takingOver)
    let figure, len = 0
    for (let i = 0; i < count; i++) {
      const sec = compose(m, from + i, { groove: from + (i >> 1) * 7919, figure, tries: 800 })
      figure ??= sec.parts.find((p) => p.line)?.line
      len = length(sec)
      for (const n of perform(sec, i * sec.steps * sec.bars, (i + 1) * sec.steps * sec.bars, layers[Math.min(i, layers.length - 1)], rand)) {
        if (at + n.at >= stopAt) continue
        play(n.patch, at + n.at, { bus: 1, pitch: n.hz, force: n.force, dur: n.dur, pan: n.pan, gain: n.gain, room: n.room })
      }
    }
    return len * count
  }
  const render = (seconds, sets = []) => {
    synth.notes(list)
    const l = new Float32Array(Math.round(seconds * SR)), r = new Float32Array(l.length)
    // A bed's level is eased to, and set at a moment: [seconds, which, value].
    const moments = sets.map(([t, which, v]) => [Math.round(t * SR), which, v]).sort((a, b) => a[0] - b[0])
    let at = 0
    for (const [f, which, v] of [...moments, [l.length, -1, 0]]) {
      const to = Math.min(l.length, Math.max(at, f - (f % 128)))
      if (to > at) synth.render(l.subarray(at, to), r.subarray(at, to))
      at = to
      if (which >= 0) synth.set(which, v)
    }
    return { l, r, marks: marks.filter((t) => t < seconds), stats: synth.stats }
  }
  return { rand, play, music, render, synth }
}

/** Blows of one thing a while apart, as hard and as big as the page varies them. */
const blows = (patch, how = {}, n = 5, gap = 1.1) => (st) => { for (let i = 0; i < n; i++) st.play(patch, 0.3 + i * gap, { force: (how.force ?? 0.7) * (0.9 + 0.2 * st.rand()), size: (how.size ?? 1) * (0.9 + 0.2 * st.rand()), far: how.far ?? 2, reach: how.reach ?? 5, travels: false, dur: how.dur }); return [0.3 + n * gap + (how.tail ?? 1)] }
const walk = (patch, pace = 0.48) => (st) => { for (let i = 0; i < 16; i++) st.play(patch, 0.3 + i * pace * (0.96 + 0.08 * st.rand()), { force: 0.55 * (0.85 + 0.3 * st.rand()), size: 0.92 + 0.16 * st.rand(), pan: i % 2 ? 0.12 : -0.12 }); return [0.3 + 16 * pace + 0.7] }
const bed = (which, level, more = []) => () => [14, [[0, which, level], ...more]]
const tune = (patch, notes, gap, how = {}) => (st) => { notes.forEach((n, i) => [].concat(n).forEach((m, k) => st.play(patch, 0.3 + i * gap + k * (how.roll ?? 0), { pitch: hz(m), force: (how.force ?? 0.7) * (0.92 + 0.16 * st.rand()), dur: how.dur ?? 0, far: 2, reach: 25, travels: false }))); return [0.3 + notes.length * gap + (how.tail ?? 2.5)] }
/** A place's music for most of a minute, from the piece's start. */
const piece = (mood, from) => (st) => { const m = resolve(mood), one = length(compose(m, from, { tries: 50 })), count = Math.max(2, Math.min(m.sections, Math.ceil(56 / one))); return [Math.min(64, st.music(mood, 0.2, count, from) + 3)] }

/** [name, kind, what it does to a stage (returns [seconds, sets?]), the seed, and for a mix the stems it is made of]. */
export function clips(held = false) {
  const k = held ? 4000 : 0, list = []
  const add = (name, kind, make, seed = 1) => list.push({ name, kind, make, seed: seed + k })
  // What is struck and what breaks.
  add('step-hard', 'oneshot', walk(WORLD.step))
  add('step-soft', 'oneshot', walk(WORLD.stepSoft))
  add('step-loose', 'oneshot', walk(WORLD.stepLoose))
  for (const stuff of ['wood', 'steel', 'glass', 'brick', 'earth', 'concrete']) add(`hit-${stuff}`, 'oneshot', blows(HIT[stuff], { tail: stuff === 'steel' ? 2.5 : 1 }))
  for (const stuff of ['glass', 'brick', 'wood']) add(`break-${stuff}`, 'oneshot', blows(BREAK[stuff], { force: 0.55, reach: 6, tail: 1.5 }, 4, 1.6))
  add('blast-near', 'oneshot', (st) => { for (const [i, far] of [12, 40, 120].entries()) { st.play(WORLD.crack, 0.3 + i * 4, { force: 1, size: 0.9, far, reach: 72 * 0.35 }); st.play(WORLD.boom, 0.3 + i * 4, { force: 1, size: 1.1, far, reach: 72 }) } return [13] })
  for (const like of ['bell', 'drum', 'clang', 'knock', 'shot', 'cheer', 'whoosh', 'splash', 'clap']) add(`like-${like}`, 'oneshot', (st) => { for (let i = 0; i < 3; i++) for (const p of LIKES[like].patches) st.play(p, 0.3 + i * (like === 'cheer' ? 4 : like === 'bell' ? 3 : 1.5), { force: 0.7 * (0.94 + 0.12 * st.rand()), far: 4, reach: LIKES[like].reach }); return [like === 'cheer' ? 13 : like === 'bell' ? 13 : 6] })
  for (const like of ['pipe', 'horn', 'whistle', 'engine']) add(`like-${like}`, 'tone', (st) => { for (let i = 0; i < 3; i++) for (const p of LIKES[like].patches) st.play(p, 0.3 + i * 2, { force: 0.7, dur: 1.4, far: 4, reach: LIKES[like].reach }); return [7] })
  add('tool-cutter', 'tone', blows(WORLD.cut, { force: 0.8, dur: 0.6, reach: 8, far: 2 }, 3, 1.4))
  // What goes on all the while.
  add('bed-rain', 'bed', bed(SET.rain, 0.8, [[0, SET.wind, 0.22]]))
  add('bed-wind', 'bed', bed(SET.wind, 0.5))
  add('bed-fire', 'bed', bed(SET.fire, 0.7))
  add('bed-surf', 'bed', bed(SET.surf, 0.8, [[0, SET.wind, 0.1]]))
  add('bed-undersea', 'bed', bed(SET.under, 1, [[0, SET.muffle, 650], [0, SET.cover, 1]]))
  // What is played by hand.
  const D = [62, 66, 69, 74, 69, 66, 62, 64, 66, 67, 69, 71, 73, 74]
  add('play-piano', 'instrument', tune(piano.sounds.play, [...D, [50, 62, 66, 69], [43, 59, 62, 67], [45, 61, 64, 69], [50, 62, 66, 74]], 0.42, { dur: 0.5, tail: 3 }))
  add('play-guitar', 'instrument', tune(guitar.sounds.play, [[45, 50, 57, 62, 66, 69], [43, 47, 50, 55, 59, 67], [45, 52, 57, 61, 64, 69], [47, 54, 59, 62, 66, 71], [45, 50, 57, 62, 66, 69], 62, 66, 69, 74, 69, 66], 0.8, { roll: 0.022, tail: 3.5 }))
  add('play-ocarina', 'instrument', tune(ocarina.sounds.play, [62, 65, 69, 71, 74, 71, 69, 65, 62, 69, 74], 0.5, { dur: 0.42, tail: 1.5 }))
  // Each place's music, from two numbers.
  for (const mood of Object.keys(MOODS)) for (const [i, from] of [7, 1234].entries()) add(`music-${mood}-${'ab'[i]}`, 'music', piece(mood, from + k), 11 + i)
  add('music-realm-phrygian', 'music', piece(moodKey('town', 140, 'phrygian'), 3 + k), 13)
  add('music-town-to-coast', 'music', (st) => { const town = compose(MOODS.town, 7 + k, { tries: 50 }), bar = length(town) / town.bars, change = 0.2 + 3 * length(town) + 2 * bar; st.music('town', 0.2, 5, 7 + k, change); st.music('coast', change, 3, 11 + k, Infinity, true); return [Math.min(64, change + 24)] }, 14)
  // Music with the world over it, as a walk through the town is: steps, a hammer on brick and wood, a charge.
  add('mix-town-walk', 'mix', (st) => {
    st.music('town', 0.2, 4, 21 + k)
    for (let i = 0; i < 60; i++) st.play(WORLD.step, 2 + i * 0.5 * (0.97 + 0.06 * st.rand()), { force: 0.55 * (0.85 + 0.3 * st.rand()), size: 0.92 + 0.16 * st.rand(), pan: i % 2 ? 0.12 : -0.12 })
    for (const [t, stuff] of [[8, 'brick'], [9.2, 'brick'], [14, 'wood'], [15.1, 'wood'], [21, 'glass'], [26, 'steel']]) { st.play(HIT[stuff], t, { force: 0.7, far: 2, reach: 5, travels: false }); st.play(BREAK[stuff] ?? BREAK.brick, t, { force: 0.55, far: 2, reach: 6, travels: false, mark: false }) }
    st.play(BREAK.brick, 31, { force: 0.9, size: 2, far: 18, reach: 20 })
    return [40]
  }, 31)
  add('mix-night-rain', 'mix', (st) => { st.music('night', 0.2, 3, 5 + k); for (let i = 0; i < 40; i++) st.play(WORLD.stepSoft, 3 + i * 0.62, { force: 0.5 * (0.85 + 0.3 * st.rand()), pan: i % 2 ? 0.12 : -0.12 }); return [36, [[0, SET.rain, 0.6], [0, SET.wind, 0.2]]] }, 32)
  add('mix-danger-blasts', 'mix', (st) => { st.music('danger', 0.2, 4, 9 + k); for (const [t, far] of [[6, 30], [13, 14], [19, 60], [24, 22]]) { st.play(WORLD.crack, t, { force: 1, size: 0.9, far, reach: 25 }); st.play(WORLD.boom, t, { force: 1, size: 1.1, far, reach: 72, mark: false }) } return [32, [[5, SET.fire, 0.5], [5, SET.rumble, 0.3]]] }, 33)
  return list
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = arg('out', ''), only = arg('only', '').split(',').filter(Boolean), held = arg('held', '') === '1'
  if (!out) { console.error('say where: --out dir'); process.exit(1) }
  mkdirSync(out, { recursive: true })
  const manifest = []
  for (const c of clips(held)) {
    if (only.length && !only.some((o) => c.name.startsWith(o))) continue
    const st = stage(c.seed), [seconds, sets] = c.make(st), { l, r, marks, stats } = st.render(seconds, sets)
    ears.wav(join(out, `${c.name}.wav`), l, r, SR)
    const row = { name: c.name, kind: c.kind, seconds: +seconds.toFixed(2), marks, dropped: stats.dropped, stolen: stats.stolen, reset: stats.reset }
    // A mix is also kept as the world alone and the music alone, so that what the music hides can be measured.
    if (c.kind === 'mix') for (const [stem, bus] of [['world', SET.music], ['music', SET.world]]) {
      const alone = stage(c.seed); alone.synth.set(bus, 0)
      // The level is eased to: let it get there before anything sounds.
      const warm = new Float32Array(SR / 2); alone.synth.render(warm, new Float32Array(warm.length)); alone.synth.frame = 0
      const [s2, sets2] = c.make(alone), got = alone.render(s2, sets2)
      ears.wav(join(out, `${c.name}.${stem}.wav`), got.l, got.r, SR)
    }
    manifest.push(row)
    console.log(`${c.name.padEnd(24)} ${c.kind.padEnd(10)} ${seconds.toFixed(1).padStart(5)} s  ${ears.lufs(l, r, SR).toFixed(1).padStart(6)} LUFS  peak ${ears.db(Math.max(ears.peak(l), ears.peak(r))).toFixed(1)} dB${stats.dropped ? `  dropped ${stats.dropped}` : ''}${stats.stolen ? `  stolen ${stats.stolen}` : ''}`)
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1))
}
