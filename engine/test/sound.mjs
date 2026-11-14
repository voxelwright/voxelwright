// The synthesiser, measured (#247): the same file the page's audio thread runs (page/sound/dsp.ts), rendered here in
// Node, where nobody can hear it, and judged by numbers: where a sound's pitches are, how long it rings, how bright
// it is, how loud. No browser, no model.
//
// What these stand in for: that a patch does what its words say (steel rings longer than brick, a hard blow is
// brighter than a soft one, a big thing is lower than a small one, a string is in tune), that the form refuses what
// is not a patch, that nothing a patch can say gets past the ceiling, and what it all costs.
// What they cannot say: whether any of it sounds like the thing, or is pleasant. That takes ears.
//
//   node test/sound.mjs [--out dir]    with --out, a WAV and a picture of each sound are kept there
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CEILING, NOTE, SET, Synth } from '../page/sound/dsp.ts'
import { compile, patch, sounds } from '../page/sound/patch.ts'
import { BREAK, HIT, MATERIALS, WORLD } from '../page/sound/kinds.ts'
import * as ears from './ears.mjs'
import { arg } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const out = arg('out', '')
if (out) mkdirSync(out, { recursive: true })

/** One patch played once, by itself with no room: left, right, and the synthesiser after. */
function play(p, { sr = 48000, secs = 3, force = 0.8, size = 1, dur = 0, pitch = 0, room = 0 } = {}) {
  const s = new Synth(sr)
  s.define(1, compile(p)); s.set(SET.roomGain, room)
  s.notes([0, 1, pitch, size, force, dur, 0.7, 0.7, 0, room ? 0.3 : 0, 0, 0])
  const l = new Float32Array(Math.round(sr * secs)), r = new Float32Array(l.length)
  s.render(l, r)
  return { l, r, sr, s }
}
const keep = (name, { l, r, sr }) => { if (out) { ears.wav(join(out, `${name}.wav`), l, r, sr); ears.spectrogram(join(out, `${name}.png`), l, sr, { tick: 0.5 }) } }

console.log('The form')
{
  const good = { how: 'struck', hard: 0.5, rough: 0.2, shape: 'bar', pitch: 300, ring: 0.5, damp: 0.5, gain: 0.7 }
  check('patch' in patch(good), 'a plain patch is taken')
  const bad = [
    ['not an object', 'x'], ['an array', [good]], ['a key it has not', { ...good, script: 'alert(1)' }], ['a how it has not', { ...good, how: 'exploded' }],
    ['a number out of range', { ...good, gain: 4 }], ['a number that is not one', { ...good, pitch: NaN }], ['a number as text', { ...good, ring: '0.5' }], ['infinity', { ...good, ring: Infinity }],
    ['a shape and modes both', { ...good, modes: [[1, 1]] }], ['neither shape nor modes', { ...good, shape: undefined }], ['a shape it has not', { ...good, shape: 'constructor' }],
    ['too many modes', { ...good, shape: undefined, modes: Array(13).fill([1, 1]) }], ['a mode out of range', { ...good, shape: undefined, modes: [[0.5, 1]] }], ['modes all silent', { ...good, shape: undefined, modes: [[1, 0]] }],
    ['pieces with a stray key', { ...good, pieces: { count: 3, over: 0.2, spread: 0.1, each: {} } }], ['too many pieces', { ...good, pieces: { count: 400, over: 0.2, spread: 0.1 } }], ['half a piece', { ...good, pieces: { count: 2.5, over: 0.2, spread: 0.1 } }],
    ['air out of range', { ...good, air: { from: 10, to: 100, for: 1, gain: 1 } }], ['a patch with a prototype', Object.assign(Object.create({ how: 'struck' }), good)],
  ]
  for (const [name, v] of bad) { const read = patch(v !== undefined && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)).constructor === Object && Object.getPrototypeOf(v) !== Object.prototype ? v : Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) : v); check('refused' in read, `refused: ${name}${'refused' in read ? ` ("${read.refused}")` : ''}`) }
  check('refused' in sounds({ hit: good, explode: good }) && 'sounds' in sounds({ hit: good, break: good }), 'a thing’s sounds go by the names of what happens to it, and no other')
  const all = [...Object.values(HIT), ...Object.values(BREAK), ...Object.values(WORLD)]
  check(all.every((p) => 'patch' in patch(JSON.parse(JSON.stringify(p)))), `every sound the world has is a patch in that form (${all.length} of them, read back from JSON)`)
  check(MATERIALS.slice(1).every((m) => HIT[m] && BREAK[m]), 'every material of the core has a sound struck and a sound breaking')
}

console.log('True to what it says')
{
  const ring = Object.fromEntries(['steel', 'glass', 'wood', 'brick', 'earth'].map((m) => { const o = play(HIT[m]); keep(`hit-${m}`, o); return [m, ears.decay(o.l, o.sr, 40)] }))
  check(ring.steel > ring.glass && ring.glass > ring.wood && ring.wood > ring.brick, `steel rings longer than glass, glass than wood, wood than brick (${Object.entries(ring).map(([m, t]) => `${m} ${t.toFixed(2)} s`).join(', ')}, to 40 dB down)`)
  const bright = (m, o) => ears.centroid(play(HIT[m], o).l, 48000, 0, 4096)
  check(bright('glass') > bright('wood') && bright('wood') > bright('earth') * 0.5 && bright('rock') > bright('earth'), `glass is brighter than wood, rock than earth (${['glass', 'rock', 'wood', 'earth'].map((m) => `${m} ${bright(m).toFixed(0)} Hz`).join(', ')})`)
  const soft = play(HIT.steel, { force: 0.08 }), hard = play(HIT.steel, { force: 1 })
  check(ears.centroid(hard.l, 48000, 0, 4096) > ears.centroid(soft.l, 48000, 0, 4096) * 1.15 && ears.peak(hard.l) > ears.peak(soft.l) * 8, `struck harder it is louder and brighter (steel: ${ears.db(ears.peak(soft.l)).toFixed(0)} dB at ${ears.centroid(soft.l, 48000, 0, 4096).toFixed(0)} Hz, then ${ears.db(ears.peak(hard.l)).toFixed(0)} dB at ${ears.centroid(hard.l, 48000, 0, 4096).toFixed(0)} Hz)`)
  const felt = play({ ...HIT.steel, hard: 0.1 }), nail = play({ ...HIT.steel, hard: 1 })
  check(ears.centroid(nail.l, 48000, 0, 4096) > ears.centroid(felt.l, 48000, 0, 4096) * 1.3, `the same plate struck with something soft is duller than with something hard (${ears.centroid(felt.l, 48000, 0, 4096).toFixed(0)} against ${ears.centroid(nail.l, 48000, 0, 4096).toFixed(0)} Hz)`)
  const small = ears.peaks(play(HIT.wood, { size: 0.5 }).l, 48000, { most: 1 })[0].hz, big = ears.peaks(play(HIT.wood, { size: 2 }).l, 48000, { most: 1 })[0].hz
  check(Math.abs(small / big - 4) < 0.2, `a thing four times the size is two octaves lower (${small.toFixed(0)} and ${big.toFixed(0)} Hz)`)
  const one = play({ how: 'struck', hard: 0.9, rough: 0, modes: [[1, 1]], pitch: 440, ring: 1.5, damp: 0.5, gain: 0.8 }, { secs: 3 })
  const hz = ears.peaks(one.l, 48000, { most: 1, size: 32768 })[0].hz, t60 = ears.decay(one.l, 48000, 60, 5)
  check(Math.abs(1200 * Math.log2(hz / 440)) < 3 && Math.abs(t60 / 1.5 - 1) < 0.1, `one mode at 440 Hz said to ring 1.5 s is at ${hz.toFixed(1)} Hz and rings ${t60.toFixed(2)} s`)
  const bar = ears.peaks(play({ ...HIT.steel, shape: 'bar', pitch: 400 }).l, 48000, { most: 3, size: 32768 }).map((p) => p.hz).sort((a, b) => a - b)
  check(Math.abs(bar[1] / bar[0] - 2.756) < 0.03, `a bar's second mode is 2.756 times its first (${(bar[1] / bar[0]).toFixed(3)})`)
  const tine = ears.peaks(play({ how: 'plucked', hard: 0.7, rough: 0.05, shape: 'bar', pitch: 300, ring: 2, damp: 0.3, gain: 0.7 }).l, 48000, { most: 3, size: 32768 }).map((p) => p.hz).sort((a, b) => a - b)
  check(Math.abs(tine[1] / tine[0] - 2.756) < 0.03, `a bar that is plucked (a kalimba's tine) rings as a bar, not as a string (its second mode is ${(tine[1] / tine[0]).toFixed(3)} times its first)`)
  const shatter = play(BREAK.glass, { secs: 2 }), knock = play(HIT.glass, { secs: 2 })
  keep('break-glass', shatter); keep('break-brick', play(BREAK.brick)); keep('boom', play(WORLD.boom, { secs: 4 })); keep('crack', play(WORLD.crack))
  const events = (x) => { const e = ears.envelope(x, 48000, 5); let n = 0; for (let i = 2; i < e.length; i++) if (e[i] > e[i - 1] * 1.8 && e[i] > 0.004) n++; return n }
  check(events(shatter.l) >= events(knock.l) + 6, `glass breaking goes on in pieces after the blow (${events(shatter.l)} rises in loudness against ${events(knock.l)} for a knock)`)
  const again = play(BREAK.glass, { secs: 2 })
  check(shatter.l.every((v, i) => v === again.l[i]), 'the same patch from the same start renders the same samples (the checks can be trusted twice)')
  const a = new Synth(48000); a.define(1, compile(HIT.brick)); a.set(SET.roomGain, 0)
  a.notes([0, 1, 0, 1, 0.8, 0, 0.7, 0.7, 0, 0, 0, 0, 24000, 1, 0, 1, 0.8, 0, 0.7, 0.7, 0, 0, 0, 0])
  const al = new Float32Array(48000), ar = new Float32Array(48000); a.render(al, ar)
  check(al.slice(0, 12000).some((v, i) => Math.abs(v - al[24000 + i]) > 1e-3), 'two blows on the same brick are not the same sound (the grit in each differs)')
}

console.log('In tune, and on time')
{
  const string = { how: 'plucked', hard: 0.7, rough: 0.1, shape: 'string', pitch: 196, ring: 4, damp: 0.5, gain: 0.8 }
  for (const sr of [44100, 48000]) for (const f of [82.41, 196, 440, 1318.5]) {
    const o = play(string, { sr, pitch: f, secs: 2 }), got = ears.peaks(o.l, sr, { most: 1, size: 65536 })[0].hz
    // Its loudest partial, against the whole multiple of the pitch it is nearest.
    const cents = 1200 * Math.log2(got / (Math.round(got / f) * f))
    check(Math.abs(cents) < 6, `a string asked for ${f} Hz at ${sr} is ${cents.toFixed(1)} cents off`)
  }
  keep('string-196', play(string, { secs: 4 }))
  const pipe = { how: 'blown', hard: 0.7, rough: 0.15, shape: 'hollow', pitch: 880, ring: 0.08, damp: 0.6, gain: 0.8 }
  const tone = play(pipe, { dur: 1, secs: 2 }), tp = ears.peaks(tone.l, 48000, { from: 12000, most: 3, size: 32768 })
  keep('ocarina-880', tone)
  check(Math.abs(1200 * Math.log2(tp[0].hz / 880)) < 3, `a blown tone asked for 880 Hz is at ${tp[0].hz.toFixed(1)}`)
  check(tp.length < 2 || tp[1].power < tp[0].power * 0.02, 'a hollow thing blown is nearly a pure tone (its next partial is under a fiftieth of its power)')
  const held = ears.envelope(tone.l, 48000, 50)
  check(held[10] > 0.02 && held[30] < held[10] * 0.01, `it sounds while held and stops when let go (${ears.db(held[10]).toFixed(0)} dB at half a second, ${ears.db(held[30]).toFixed(0)} dB half a second after)`)
  const late = new Synth(48000); late.define(1, compile(HIT.steel)); late.notes([12345, 1, 0, 1, 1, 0, 0.7, 0.7, 0, 0, 0, 0])
  const ll = new Float32Array(48000), lr = new Float32Array(48000); late.render(ll, lr)
  const first = ll.findIndex((v) => v !== 0)
  check(first - 12345 === Math.round(0.003 * 48000), `a note asked for at frame 12345 leaves at exactly that frame (plus the 3 ms the ceiling looks ahead: ${first})`)
  const o441 = play(HIT.steel, { sr: 44100 }), o48 = play(HIT.steel, { sr: 48000 })
  const f1 = ears.peaks(o441.l, 44100, { most: 1 })[0].hz, f2 = ears.peaks(o48.l, 48000, { most: 1 })[0].hz
  check(Math.abs(f1 / f2 - 1) < 0.005 && Math.abs(ears.decay(o441.l, 44100, 40) / ears.decay(o48.l, 48000, 40) - 1) < 0.1, `the same at 44,100 and 48,000 frames a second (${f1.toFixed(1)} and ${f2.toFixed(1)} Hz)`)
}

console.log('Played by hand')
{
  const sr = 48000, s = new Synth(sr), pipe = { how: 'blown', hard: 0.7, rough: 0.1, shape: 'hollow', pitch: 587, ring: 0.1, damp: 0.6, gain: 0.8 }, string = { how: 'plucked', hard: 0.6, rough: 0.1, shape: 'string', pitch: 196, ring: 5, damp: 0.4, gain: 0.8 }, key = { how: 'struck', hard: 0.5, rough: 0.03, shape: 'string', pitch: 262, ring: 5, damp: 0.4, gain: 0.8 }
  s.define(1, compile(pipe)); s.define(2, compile(string)); s.define(3, compile(key)); s.set(SET.roomGain, 0)
  const l = new Float32Array(sr * 3), r = new Float32Array(sr * 3), part = (from, to) => s.render(l.subarray(Math.round(from * sr), Math.round(to * sr)), r.subarray(Math.round(from * sr), Math.round(to * sr)))
  // A tone held from the start, bent up a fifth at one second, let go at two.
  s.notes([0, 1, 440, 1, 0.8, 0, 0.7, 0.7, 0, 0, 2, 7])
  part(0, 1); s.glide(7, 660, -1); part(1, 2); s.release(7); part(2, 3)
  const at = (t) => ears.peaks(l, sr, { from: Math.round(t * sr), size: 16384, most: 1 })[0].hz
  check(Math.abs(at(0.5) - 440) < 2 && Math.abs(at(1.5) - 660) < 3, `a held tone stays until it is let go and goes where it is bent (${at(0.5).toFixed(0)} Hz, then ${at(1.5).toFixed(0)})`)
  const moved = ears.peaks(l, sr, { from: Math.round(1.02 * sr), size: 1024, most: 1 })[0].hz
  check(ears.rms(l, 1.9 * sr, 2 * sr) > 0.05 && ears.rms(l, 2.5 * sr, 3 * sr) < 1e-4 && moved > 600, `the bend arrives within 20 ms (${moved.toFixed(0)} Hz by then) and letting go ends it (${ears.db(ears.rms(l, 2.5 * sr, 3 * sr)).toFixed(0)} dB half a second after)`)
  for (const [id, name] of [[2, 'a plucked string'], [3, 'a struck string']]) {
    const t = new Synth(sr); t.define(id, compile(id === 2 ? string : key)); t.set(SET.roomGain, 0)
    const a = new Float32Array(sr * 2), b = new Float32Array(sr * 2)
    t.notes([0, id, 0, 1, 0.8, 0, 0.7, 0.7, 0, 0, 2, 9])
    t.render(a.subarray(0, sr), b.subarray(0, sr)); t.release(9); t.render(a.subarray(sr), b.subarray(sr))
    check(ears.rms(a, 0.9 * sr, sr) > 0.01 && ears.rms(a, 1.4 * sr, 1.5 * sr) < ears.rms(a, 0.9 * sr, sr) * 0.02, `${name} rings while held and is damped when let go (${ears.db(ears.rms(a, 1.4 * sr, 1.5 * sr) / ears.rms(a, 0.9 * sr, sr)).toFixed(0)} dB 0.4 s after)`)
  }
  // Sixteen tones held by hand, then the music asks for sixteen more: none of the held is cut for them.
  const u = new Synth(sr); u.define(1, compile(pipe))
  const held = [], more = []
  for (let i = 0; i < 16; i++) held.push(0, 1, 300 + i * 40, 1, 0.5, 0, 0.1, 0.1, 0, 0, 2, 10 + i)
  for (let i = 0; i < 16; i++) more.push(4800, 1, 200 + i * 30, 1, 0.5, 2, 0.1, 0.1, 0, 0, 1, 0)
  u.notes(held); u.notes(more)
  const x = new Float32Array(sr), y = new Float32Array(sr); u.render(x, y)
  check(u.stats.voices === 16 && u.stats.stolen === 0 && u.stats.dropped === 16, `what is played by hand is never cut short for the music (${u.stats.voices} still held, ${u.stats.dropped} of the music's notes went unplayed)`)
  // A note asked for now is on its way out 3 ms later: the ceiling's look ahead, and nothing else.
  const n = new Synth(sr); n.define(3, compile(key)); n.frame = 99999
  n.notes([99990, 3, 0, 1, 1, 0, 0.7, 0.7, 0, 0, 2, 5])
  const p = new Float32Array(1024), q = new Float32Array(1024); n.render(p, q)
  const first = p.findIndex((v) => v !== 0)
  check(first === Math.round(0.003 * sr), `a note played by hand leaves the synthesiser ${((first / sr) * 1000).toFixed(1)} ms after it arrives`)
}

console.log('Written by a model (kept replies of November 13, 2026; no model is run here)')
{
  const dir = new URL('../page/sound/kept/', import.meta.url), kept = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(new URL(f, dir), 'utf8'))]))
  const read = Object.fromEntries(Object.entries(kept).map(([name, k]) => [name, sounds(k.sounds)]))
  const names = Object.keys(kept)
  check(names.length >= 7 && names.every((n) => 'sounds' in read[n]), `${names.length} things a model gave sounds to, each in one reply to its name alone, are all in the form (${names.map((n) => `${n}: ${Object.keys(kept[n].sounds).join(' ')}`).join('; ')})`)
  check(names.every((n) => kept[n].tries.length === 1), `every one was taken on its first try (${names.map((n) => `${(kept[n].tries[0].ms / 1000).toFixed(0)} s`).join(', ')}; ${[...new Set(names.map((n) => kept[n].tries[0].model))].join(' and ')})`)
  const of = (name, role) => read[name].sounds[role]
  const bell = play(of('church-bell', 'use'), { secs: 12 }), chime = play(of('wind-chime', 'hit'), { secs: 6 }), duck = play(of('duck', 'hit')), vase = play(of('vase', 'break'), { secs: 2 }), knock = play(of('vase', 'hit'), { secs: 2 })
  keep('model-church-bell', bell); keep('model-vase-break', vase); keep('model-wind-chime', chime); keep('model-duck', play(of('duck', 'use'), { dur: 0.3 }))
  const low = (o) => Math.min(...ears.peaks(o.l, o.sr, { most: 6, size: 32768, floor: 0.01 }).map((p) => p.hz))
  check(ears.decay(bell.l, 48000, 40) > 4 && low(bell) < 420 && low(chime) > 800, `the model's church bell rings long and low, its wind chime high (the bell ${ears.decay(bell.l, 48000, 40).toFixed(1)} s to 40 dB down from ${low(bell).toFixed(0)} Hz; the chime from ${low(chime).toFixed(0)} Hz)`)
  check(ears.decay(duck.l, 48000, 40) < 0.2, `its rubber duck does not ring (${ears.decay(duck.l, 48000, 40).toFixed(2)} s)`)
  const rises = (x) => { const e = ears.envelope(x, 48000, 5); let n = 0; for (let i = 2; i < e.length; i++) if (e[i] > e[i - 1] * 1.8 && e[i] > 0.004) n++; return n }
  check(rises(vase.l) > rises(knock.l) + 3, `its vase breaking goes on in pieces (${rises(vase.l)} rises in loudness against ${rises(knock.l)} for a knock on it)`)
  const tines = read.kalimba.sounds.surface.parts.filter((p) => p.note !== undefined), keys = new Set(tines.map((p) => p.key))
  const longest = tines.reduce((a, b) => (b.at[3] > a.at[3] ? b : a)), lowest = tines.reduce((a, b) => (b.note < a.note ? b : a))
  check(tines.length >= 8 && keys.size === tines.length && longest === lowest, `its kalimba has ${tines.length} tines, each with a key of its own, and the longest is the lowest (${lowest.label})`)
  const wand = read.theremin.sounds.surface.parts.find((p) => p.slide)
  check(wand && wand.level && Math.abs(wand.slide.to - wand.note) >= 12, `its theremin is one part that slides: ${Math.abs(wand.slide.to - wand.note)} semitones along ${wand.slide.along}, loudness along ${wand.level}`)
  let top = 0
  for (const n of names) for (const [role, p] of Object.entries(read[n].sounds)) if (role !== 'surface') { const o = play(p, { force: 1, dur: 1 }); top = Math.max(top, ears.peak(o.l)) }
  check(top <= CEILING, `all of them at full force stay under the ceiling (${ears.db(top).toFixed(1)} dB)`)
}

console.log('A voice for what is said (a direction being tried: babble)')
{
  const { babble, pitchOf, TONE, WHISPER } = await import('../page/sound/voice.ts')
  const asks = babble('Have you seen the lighthouse keeper?', 'Odo'), tells = babble('Good morning to you all.', 'Odo')
  check(asks.length === 10 && tells.length === 6, `a syllable is sounded for each syllable of the words (${asks.length} for "Have you seen the lighthouse keeper?", ${tells.length} for "Good morning to you all.")`)
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
  check(asks.at(-1).hz > mean(asks.slice(0, 5).map((x) => x.hz)) * 1.1 && mean(tells.slice(-2).map((x) => x.hz)) < mean(tells.slice(0, 2).map((x) => x.hz)), `a question ends higher than it began (${asks[0].hz.toFixed(0)} to ${asks.at(-1).hz.toFixed(0)} Hz) and a statement lower (${tells[0].hz.toFixed(0)} to ${tells.at(-1).hz.toFixed(0)} Hz)`)
  const names = ['Odo', 'Marta', 'Ines', 'Bram', 'Wren', 'Ada'].map(pitchOf)
  check(Math.max(...names) / Math.min(...names) > 1.4 && names.every((hz) => hz >= 95 && hz <= 230), `each speaker has a pitch of their own, from a low voice to a high one (${names.map((h) => h.toFixed(0)).join(', ')} Hz)`)
  check(JSON.stringify(babble('la la lo li '.repeat(400), 'Odo').length) === '60' && babble('', 'Odo').length === 0 && babble('<script>alert(1)</script> !!! ???', 'Odo').length > 0, 'a long speech is cut at sixty syllables, an empty one is silence, and markup is only letters to sound')
  // Sounded through the synthesiser: the vowels differ as vowels do, and the whole is speech-paced and not loud.
  const sr = 48000, s = new Synth(sr), ids = new Map(), id = (p) => { if (!ids.has(p)) { ids.set(p, ids.size + 1); s.define(ids.get(p), compile(p)) } return ids.get(p) }
  s.set(SET.roomGain, 0)
  const notes = []
  for (const y of asks) notes.push(Math.round(y.at * sr), id(TONE[y.vowel]), y.hz, 1, y.force, y.dur, 0.5, 0.5, 0, 0, 0, 0, Math.round(y.at * sr), id(WHISPER[y.vowel]), 0, 1, y.force * 0.8, y.dur, 0.5, 0.5, 0, 0, 0, 0)
  s.notes(notes)
  const secs = asks.at(-1).at + 0.6, l = new Float32Array(Math.round(secs * sr)), r = new Float32Array(l.length)
  s.render(l, r)
  keep('voice-babble-question', { l, r, sr })
  const vowel = (v) => { const t = new Synth(sr); t.define(1, compile(WHISPER[v])); t.define(2, compile(TONE[v])); t.set(SET.roomGain, 0); t.notes([0, 1, 0, 1, 0.7, 0.3, 0.5, 0.5, 0, 0, 0, 0, 0, 2, 140, 1, 0.7, 0.3, 0.5, 0.5, 0, 0, 0, 0]); const a = new Float32Array(sr / 2), b = new Float32Array(sr / 2); t.render(a, b); return ears.centroid(a, sr, 2400, 8192) }
  check(vowel('i') > vowel('u') * 1.3 && vowel('e') > vowel('o'), `the vowels are told apart by where their weight lies: i ${vowel('i').toFixed(0)} Hz, e ${vowel('e').toFixed(0)}, a ${vowel('a').toFixed(0)}, o ${vowel('o').toFixed(0)}, u ${vowel('u').toFixed(0)}`)
  const rate = asks.length / asks.at(-1).at, loud = ears.lufs(l, r, sr)
  check(rate > 3.5 && rate < 8 && loud > -40 && loud < -14 && ears.peak(l) < CEILING, `it goes at the pace of speech (${rate.toFixed(1)} syllables a second) and is not loud (${loud.toFixed(0)} LUFS beside the speaker, peak ${ears.db(ears.peak(l)).toFixed(0)} dB)`)
}

console.log('Never loud enough to hurt')
{
  // Patches made at random inside the form, all as loud and as hard as the form lets them be, many at once with every bed full up.
  let seed = 7
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const pick = (a) => a[Math.floor(rnd() * a.length)], between = (lo, hi) => lo + (hi - lo) * rnd() ** (rnd() < 0.3 ? 8 : 1) * (rnd() < 0.15 ? 0 : 1) + (rnd() < 0.15 ? hi - lo : 0) * 0
  const wild = () => {
    const p = { how: pick(['struck', 'plucked', 'blown', 'rubbed']), hard: pick([0, 1, rnd()]), rough: pick([0, 1, rnd()]), pitch: pick([20, 8000, between(20, 8000)]), ring: pick([0.01, 12, between(0.01, 12)]), damp: pick([0, 1, rnd()]), gain: 1 }
    if (rnd() < 0.5) p.shape = pick(['bar', 'plate', 'bell', 'skin', 'string', 'tube', 'pipe', 'hollow', 'lump', 'cup'])
    else p.modes = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => [pick([1, 40, 1 + 39 * rnd()]), pick([1, rnd()])])
    if (rnd() < 0.5) p.bend = pick([-2, 2, rnd() * 4 - 2])
    if (rnd() < 0.5) p.waver = rnd()
    if (rnd() < 0.5) p.where = rnd() * 0.5
    if (rnd() < 0.6) p.pieces = { count: 1 + Math.floor(rnd() * 40), over: pick([0.02, 4, between(0.02, 4)]), spread: rnd() }
    if (rnd() < 0.6) p.air = { from: pick([40, 12000, between(40, 12000)]), to: pick([40, 12000, between(40, 12000)]), for: pick([0.01, 6, between(0.01, 6)]), gain: 1, q: pick([0.3, 12, 1]) }
    return p
  }
  let worst = 0, bad = 0, refused = 0, resets = 0, n = 0, stolen = 0
  for (const sr of [44100, 48000]) for (let round = 0; round < 60; round++) {
    const s = new Synth(sr)
    for (const k of ['rain', 'wind', 'fire', 'surf', 'under', 'rumble']) s.set(SET[k], 1)
    const notes = []
    for (let i = 0; i < 20; i++) {
      const p = wild(), read = patch(p)
      if ('refused' in read) { refused++; continue }
      n++
      s.define(i, compile(read.patch))
      for (let k = 0; k < 3; k++) notes.push(Math.floor(rnd() * sr * 0.5), i, pick([0, 0, 16, 20000]), pick([0.125, 1, 8]), 1, pick([0, 0.5, 3]), 1, 1, 0, 1, pick([0, 1, 2]), 0)
    }
    s.notes(notes)
    const l = new Float32Array(sr * 2), r = new Float32Array(sr * 2)
    s.render(l, r)
    for (let i = 0; i < l.length; i++) { if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) bad++; worst = Math.max(worst, Math.abs(l[i]), Math.abs(r[i])) }
    resets += s.stats.reset; stolen += s.stats.stolen
  }
  check(refused === 0, 'every patch made at random inside the form is taken by the check')
  check(bad === 0 && worst <= CEILING + 1e-6, `${n} patches at the edges of the form, sixty notes at once at full force with every bed full: the loudest sample is ${ears.db(worst).toFixed(2)} dB (the ceiling is ${ears.db(CEILING).toFixed(2)}), and every sample is a number`)
  check(resets === 0, `none of them made a number that is not one (${stolen} voices were cut short for newer ones)`)
  // And what the check would never pass, given to the synthesiser anyway: it must still hold.
  const s = new Synth(48000), rot = { how: 0, tau: -1, rough: 9, ratios: [1, NaN, 1e9, -3], gains: [1e9, 1, 1, 1], pitch: 1e9, ring: 1e9, damp: -50, bend: 99, waver: 99, tilt: 99, hard: 99, tone: 0, strung: 0, where: 9, pieces: 1e9, over: -1, spread: 1e9, airFrom: -5, airTo: 1e12, airFor: 1e9, airQ: 0, airGain: 1e9, gain: 1e9 }
  s.define(1, rot); s.define(2, { ...rot, how: 1, strung: 1 }); s.define(3, { ...rot, tone: 1 })
  s.notes([0, 1, 0, 1, 1e9, 0, 1e9, 1e9, 0, 9, 0, 0, 0, 2, 1e9, 0, 1, 1e9, 9, 9, -1, 9, 7, 0, 0, 3, 0.001, 1e9, 1, 1e9, 9, 9, 1e9, 9, 2, 0, NaN, 1, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN])
  for (let i = 0; i < 18; i++) s.set(i, 1e9)
  for (const id of [NaN, -1, 0, 1, 2, 1e9]) { s.release(id); s.glide(id, NaN, NaN); s.glide(id, 1e12, 1e12); s.glide(id, -5, -5) }
  s.notes([0, 3, 440, 1, 1, 0, 1, 1, 0, 1, 2, 2]); s.glide(2, 1e12, 1e12)
  const l = new Float32Array(96000), r = new Float32Array(96000)
  s.render(l, r)
  let top = 0, nan = 0
  for (let i = 0; i < l.length; i++) { if (!Number.isFinite(l[i])) nan++; top = Math.max(top, Math.abs(l[i]), Math.abs(r[i])) }
  check(nan === 0 && top <= CEILING + 1e-6, `numbers no check would pass, given straight to the synthesiser, still leave under the ceiling (${ears.db(top).toFixed(2)} dB; it silenced itself ${s.stats.reset} times)`)
}

console.log('How loud things are')
{
  const bed = (which, more = {}) => { const s = new Synth(48000); s.set(SET[which], 1); for (const [k, v] of Object.entries(more)) s.set(SET[k], v); const l = new Float32Array(48000 * 24), r = new Float32Array(l.length); s.render(l, r); const from = 48000 * 4; const o = { l: l.subarray(from), r: r.subarray(from), sr: 48000 }; keep(`bed-${which}`, o); return o }
  const loud = {}
  for (const which of ['rain', 'wind', 'fire', 'surf', 'under', 'rumble']) { const o = bed(which); loud[which] = ears.lufs(o.l, o.r, 48000) }
  check(Object.values(loud).every((v) => v > -45 && v < -16), `each bed full up is between -45 and -16 LUFS (${Object.entries(loud).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')})`)
  const rain = bed('rain'), surf = bed('surf'), fire = bed('fire'), deep = bed('under')
  check(ears.band(rain.l, 48000, 2000, 16000) > 0.5, `rain is mostly hiss (${(ears.band(rain.l, 48000, 2000, 16000) * 100).toFixed(0)}% over 2 kHz)`)
  check(ears.band(fire.l, 48000, 20, 600) > 0.5, `fire is mostly roar (${(ears.band(fire.l, 48000, 20, 600) * 100).toFixed(0)}% under 600 Hz)`)
  check(ears.band(deep.l, 48000, 20, 300) > 0.6, `the sea overhead is a low press (${(ears.band(deep.l, 48000, 20, 300) * 100).toFixed(0)}% under 300 Hz)`)
  const swell = ears.envelope(surf.l, 48000, 500), high = Math.max(...swell), low = Math.min(...swell)
  check(high > low * 2.5, `surf comes and goes: its loud half-seconds are ${(high / low).toFixed(1)} times its quiet ones`)
  // A charge close by with the music playing: the music gives way.
  const s = new Synth(48000), pad = { how: 'blown', hard: 0.2, rough: 0, shape: 'tube', pitch: 220, ring: 0.5, damp: 0.5, gain: 0.8 }
  s.define(1, compile(pad)); s.define(2, compile(WORLD.boom)); s.set(SET.roomGain, 0)
  s.notes([0, 1, 0, 1, 0.6, 6, 0.7, 0, 0, 0, 1, 0, 96000, 2, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0])
  const l = new Float32Array(48000 * 5), r = new Float32Array(l.length); s.render(l, r)
  const before = ears.rms(l, 48000, 90000), during = ears.rms(l, 100000, 110000)
  check(during < before * 0.6, `the music (in one ear) gives way under a blast (in the other) (${ears.db(during / before).toFixed(1)} dB while it sounds)`)
}

console.log('What it costs')
{
  // The most it can be asked: every voice of every kind sounding, every bed up.
  for (const sr of [44100, 48000]) {
    const s = new Synth(sr)
    for (const k of ['rain', 'wind', 'fire', 'surf', 'under', 'rumble']) s.set(SET[k], 1)
    s.define(1, compile({ ...HIT.steel, shape: 'string', ring: 12, damp: 0 })); s.define(2, compile({ how: 'plucked', hard: 0.7, rough: 0.1, shape: 'string', pitch: 110, ring: 12, damp: 0.3, gain: 0.8 })); s.define(3, compile({ how: 'blown', hard: 0.7, rough: 0.5, shape: 'tube', pitch: 220, ring: 1, damp: 0.3, gain: 0.5 })); s.define(4, compile({ ...WORLD.boom, pitch: 400, ring: 12 }))
    const notes = []
    for (let i = 0; i < 64; i++) notes.push(0, 1, 100 + i * 7, 1, 1, 0, 0.1, 0.1, 0, 0.2, 0, 0)
    for (let i = 0; i < 16; i++) notes.push(0, 2, 80 + i * 20, 1, 1, 0, 0.1, 0.1, 0, 0.2, 0, 0, 0, 3, 200 + i * 30, 1, 1, 30, 0.1, 0.1, 0, 0.2, 0, 0)
    for (let i = 0; i < 24; i++) notes.push(0, 4, 0, 1, 1, 0, 0.1, 0.1, 0, 0, 0, 0)
    s.notes(notes)
    const l = new Float32Array(128), r = new Float32Array(128)
    for (let i = 0; i < 400; i++) s.render(l, r)   // warm
    const voices = s.stats.voices, times = []
    for (let i = 0; i < 3000; i++) { const t0 = performance.now(); s.render(l, r); times.push(performance.now() - t0) }
    times.sort((a, b) => a - b)
    // The middle one of three thousand: other work on the machine makes some blocks late, and that is not this code's cost.
    const block = (128 / sr) * 1000, mid = times[times.length >> 1]
    check(mid < block * 0.35 && voices >= 100, `everything at once at ${sr} (${voices} voices, every bed): a block takes ${mid.toFixed(3)} ms of the ${block.toFixed(2)} it has (${((mid / block) * 100).toFixed(0)}%; 99 in 100 within ${times[Math.floor(times.length * 0.99)].toFixed(3)} ms) on this machine, in Node`)
  }
}

if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('sound: ok')
