// The listening page (#247): every sound the engine has, to be played by hand and heard, with a picture of what is
// sounding. It is for ears: the checks (test/sound.mjs) measure, and cannot say whether a hammer on brick is one.
import { sound, SET } from './sound.ts'
import { BREAK, HIT, WORLD } from './kinds.ts'
import { LIKES } from './likes.ts'
import { patch, sounds, type Patch } from './patch.ts'
import { conductor } from './music/conductor.ts'
import { speak } from './voice.ts'
import { playable, surface } from './instrument.ts'
import { INSTRUMENTS, type Instrument } from './instruments.ts'
import { MODES, MOODS, TRIES, moodKey } from './music/compose.ts'

const voice = await sound()
const sections = document.querySelector('#sections')!, state = document.querySelector('#state')!
const section = (title: string, about = '') => {
  const h = document.createElement('h2'); h.textContent = title; sections.append(h)
  if (about) { const p = document.createElement('p'); p.textContent = about; sections.append(p) }
  const row = document.createElement('div'); row.className = 'row'; sections.append(row)
  return row
}
const button = (row: Element, name: string, press: () => void) => { const b = document.createElement('button'); b.textContent = name; b.addEventListener('click', press); row.append(b); return b }
const slider = (row: Element, name: string, value: number, change: (v: number) => void) => {
  const l = document.createElement('label'), s = document.createElement('span'), i = document.createElement('input')
  s.textContent = name; i.type = 'range'; i.min = '0'; i.max = '1'; i.step = '0.01'; i.value = String(value)
  i.addEventListener('input', () => change(Number(i.value)))
  l.append(s, i); l.style.flex = '1 1 100%'; row.append(l)
  return i
}

// How hard, how big and how far everything on this page is played.
let force = 0.8, size = 1, far = 3, side = 0
const where = (): [number, number, number] => [side * far * 10, 0, -far * 10]
voice.listen([0, 0, 0], 0)
const hit = (p: Patch, more = {}) => voice.play(p, { at: where(), force: force * (0.9 + 0.2 * Math.random()), size: size * (0.94 + 0.12 * Math.random()), ...more })

const knobs = section('How', 'How hard, how big, how far off and to which side. Every blow differs a little from the last, as in the world.')
slider(knobs, 'force', force, (v) => { force = v })
slider(knobs, 'size', 0.33, (v) => { size = 0.25 * 16 ** v })
slider(knobs, 'far (to 600 m)', 0.11, (v) => { far = 1 + 599 * v * v })
slider(knobs, 'side', 0.5, (v) => { side = v * 2 - 1 })

const struck = section('A hammer on', 'One blow on each of the world’s materials.')
for (const [name, p] of Object.entries(HIT)) button(struck, name, () => hit(p))
const broken = section('Coming apart', 'The same stuff breaking: the blow, then its pieces.')
for (const name of ['glass', 'brick', 'concrete', 'rock', 'wood', 'plaster', 'steel', 'earth', 'leaves']) button(broken, name, () => hit(BREAK[name], { reach: 8 }))

const blasts = section('A blast', 'Heard after its flash by its distance: 343 m a second. Near, a crack and a boom; far, a late thump.')
const blast = (radius: number) => {
  flash()
  const at = where(), reach = 6 * radius
  voice.play(WORLD.crack, { at, force: 1, size: 0.6 + radius / 20, reach: reach * 0.35 })
  voice.play(WORLD.boom, { at, force: 1, size: 0.7 + radius / 16, reach })
}
button(blasts, 'hammer blow', () => { hit(HIT.brick); hit(BREAK.brick, { force: 0.5, reach: 8 }) })
button(blasts, 'charge', () => blast(12))
button(blasts, 'big charge', () => blast(32))
button(blasts, 'house coming down', () => {
  blast(20)
  // What comes loose lands over the next seconds: big pieces first and low, then the small.
  for (let i = 0; i < 60; i++) { const t = 0.5 + 2.8 * Math.random() ** 1.5, big = Math.random() ** 2; hit(Math.random() < 0.7 ? HIT.brick : Math.random() < 0.5 ? HIT.wood : HIT.glass, { after: t, size: 0.6 + 3 * big, force: 0.3 + 0.6 * Math.random(), reach: 10 }) }
  hit(BREAK.brick, { after: 0.4, size: 3, reach: 25 }); hit(BREAK.concrete, { after: 1.1, size: 4, reach: 25 }); hit(BREAK.glass, { after: 0.2, reach: 10 })
  rumble(1, 4)
})
const rumble = (level: number, seconds: number) => { voice.set(SET.rumble, level); voice.flush(); setTimeout(() => { voice.set(SET.rumble, 0); voice.flush() }, seconds * 1000) }
const flash = () => { document.body.style.background = '#fff3d0'; setTimeout(() => { document.body.style.background = '' }, 60) }

const kept = section('What a rule can ask for by a word', 'The kept sounds a realm\u2019s rule may make by saying what it is like (world.sound). Held ones last a second here.')
for (const [name, like] of Object.entries(LIKES)) button(kept, name, () => { for (const p of like.patches) hit(p, { reach: like.reach, dur: like.held ? 1 : 0 }) })
const tools = section('Tools and steps')
button(tools, 'torch catches', () => hit(WORLD.catch))
button(tools, 'cutter', () => hit(WORLD.cut, { dur: 0.7 }))
button(tools, 'cannon', () => hit(WORLD.shot, { reach: 20 }))
button(tools, 'brick set down', () => hit(WORLD.place))
let walking = 0
const walk = (p: Patch) => { clearInterval(walking); let n = 0; walking = setInterval(() => { voice.play(p, { force: 0.45 + 0.2 * Math.random(), size: 0.92 + 0.16 * Math.random(), pan: n % 2 ? 0.15 : -0.15 }); if (++n > 9) clearInterval(walking) }, 480) as unknown as number }
button(tools, 'steps on paving', () => walk(WORLD.step))
button(tools, 'steps on earth', () => walk(WORLD.stepSoft))
button(tools, 'steps on sand', () => walk(WORLD.stepLoose))

const beds = section('Weather and places', 'Each is noise shaped slowly, and small grains: drops, cracks, bubbles. Slide them up.')
slider(beds, 'rain', 0, (v) => voice.set(SET.rain, v))
slider(beds, 'wind', 0, (v) => voice.set(SET.wind, v))
slider(beds, 'fire', 0, (v) => voice.set(SET.fire, v))
slider(beds, 'surf', 0, (v) => voice.set(SET.surf, v))
slider(beds, 'under the sea', 0, (v) => { voice.set(SET.under, v); voice.set(SET.muffle, 20000 * (700 / 20000) ** v); voice.set(SET.cover, v) })
slider(beds, 'rubble', 0, (v) => voice.set(SET.rumble, v))

// Music: the place picks it. Each voice was found among thousands of random patterns by its rules.
const tunes = section('Music that follows the place', `Composed here as it plays: for each voice ${TRIES} random patterns are scored against named rules and the best is kept. Pick a place; picking another hands over at the next bar.`)
const music = conductor(voice)
const moodButtons = new Map<string, HTMLButtonElement>()
// What a realm's rule may say of its music (world.music): the mood, a pace and a mode of its own, and how much of it is in.
let liked: string | null = null, pace = 0, mode = ''
const retune = () => music.want(liked ? moodKey(liked, 0, mode) : null, true, pace)
const pickMood = (name: string | null) => { liked = name; retune(); for (const [k, b] of moodButtons) b.classList.toggle('on', k === name) }
for (const name of Object.keys(MOODS)) moodButtons.set(name, button(tunes, name, () => pickMood(name)))
button(tunes, 'none', () => pickMood(null))
const asRule = section('As a realm\u2019s rule sets it', 'A rule says what the music is like and changes it with its own numbers: a pace, a mode, and how much of it is playing. The pace and the mode come in at the next beat here; drive at once.')
slider(asRule, 'pace (own, 40 to 180)', 0, (v) => { pace = v === 0 ? 0 : Math.round(40 + 140 * v); retune() })
slider(asRule, 'drive (off, 0 to 1)', 0, (v) => { music.drive = v === 0 ? null : v; music.steady = v > 0 })
for (const name of ['', ...Object.keys(MODES)]) button(asRule, name || 'its own mode', () => { mode = name; retune() })
const sheet = document.createElement('div')
sheet.className = 'sheet'
tunes.after(sheet)
music.state.onsection = (s, index, layers) => {
  const cell = (text: string, tag = 'td') => { const c = document.createElement(tag); c.textContent = text; return c }
  sheet.textContent = ''
  const head = document.createElement('p')
  head.textContent = `${s.mood}: ${s.idiom}, ${s.bpm} beats a minute, section ${index + 1}, ${layers} layer${layers === 1 ? '' : 's'} in, found in ${s.ms.toFixed(0)} ms`
  sheet.append(head)
  for (const p of s.parts) {
    if (!p.tried) continue
    const box = document.createElement('details'), sum = document.createElement('summary'), table = document.createElement('table')
    sum.textContent = `${p.voice}${p.layer > layers ? ' (not in yet)' : ''}: ${(p.total * 100).toFixed(0)}% (a random pattern: ${(p.mean * 100).toFixed(0)}%)`
    for (const r of p.rules) { const row = document.createElement('tr'); row.append(cell(`${(r.score * 100).toFixed(0)}%`), cell(r.name), cell(r.why), cell(`${r.source}${r.read === 'read' ? '' : r.read === 'ours' ? ' (ours)' : ' (from memory)'}`)); table.append(row) }
    box.append(sum, table); sheet.append(box)
  }
}
setInterval(() => music.tick(), 50)

// Instruments: a voice and a surface to play it by, both data.
const played = section('Instruments', 'Each is a patch and a surface, written as data: touch it, or use the keys shown on it. The music steps back while one is out.')
const stage = document.createElement('div')
stage.className = 'stage'
let out: ReturnType<typeof playable> | null = null
const take = (it: Instrument | null) => {
  out?.close(); out = null
  stage.style.display = it ? 'block' : 'none'
  if (!it) return
  stage.style.aspectRatio = `${it.sounds.surface.size[0]} / ${it.sounds.surface.size[1]}`
  out = playable(stage, voice, it.sounds.play, it.sounds.surface)
}
for (const it of INSTRUMENTS) button(played, it.name, () => take(it))
button(played, 'put away', () => take(null))
played.after(stage)
take(null)
addEventListener('keydown', (e) => { if (!e.repeat && !(e.target instanceof HTMLTextAreaElement) && out?.key(e.code, true)) e.preventDefault() })
addEventListener('keyup', (e) => { out?.key(e.code, false) })

// Written by a model: kept replies of one run each (voice.mjs), read through the same check as anything else.
const written = section('Written by a model', 'Each of these was written by a model in one reply to the thing\u2019s name and nothing else, and is played as it was written. The instruments open above; the rest play by their buttons.')
for (const name of ['kalimba', 'theremin', 'steel-drum', 'church-bell', 'wind-chime', 'vase', 'duck']) {
  void fetch(`/page/sound/kept/${name}.json`).then((r) => r.json()).then((kept: { wish: string; sounds: unknown }) => {
    const read = sounds(kept.sounds)
    if ('refused' in read) { button(written, `${name}: refused`, () => { said.textContent = read.refused }); return }
    const s = read.sounds
    if (s.play && s.surface) button(written, `play ${kept.wish}`, () => { take({ name, sounds: { play: s.play!, surface: s.surface! } }); stage.scrollIntoView({ block: 'center' }) })
    for (const role of ['hit', 'use', 'break', 'step', 'hum'] as const) if (s[role]) button(written, `${name}: ${role}`, () => hit(s[role]!, { dur: 1.2, reach: 6 }))
  })
}

// A voice for what people say: two ways, side by side.
const talk = section('What someone sounds like when they speak', 'Two ways being tried. Babble is made here like every other sound and is placed in the world, but says no words. Speech is the browser\u2019s own voice: real words, but it cannot be placed and nothing here measures it.')
const line = document.createElement('textarea')
line.style.height = '56px'
line.value = 'Good morning. Have you seen the lighthouse keeper? Watch out!'
talk.append(line)
for (const who of ['Odo', 'Marta', 'Ines']) {
  button(talk, `${who}: babble`, () => speak(voice, 'babble', { name: who, text: line.value, at: where() }))
  button(talk, `${who}: speech`, () => speak(voice, 'speech', { name: who, text: line.value, at: where() }))
}

const own = section('A patch of your own', 'This is what a model writes beside a thing it makes. It is checked as data and refused with the reason if it is not exactly the form.')
const text = document.createElement('textarea'), said = document.createElement('div')
text.value = JSON.stringify({ how: 'struck', hard: 0.9, rough: 0.1, shape: 'bell', pitch: 620, ring: 3, damp: 0.15, gain: 0.7 }, null, 1)
said.id = 'said'
own.append(text, said)
button(own, 'play it', () => {
  let read
  try { read = patch(JSON.parse(text.value)) } catch { said.textContent = 'That is not JSON.'; return }
  if ('refused' in read) { said.textContent = `Refused: ${read.refused}`; return }
  said.textContent = ''
  hit(read.patch, { dur: 0.8 })
})

// What is sounding: pitch up the picture (40 Hz to 16 kHz), time across it.
const scope = document.querySelector<HTMLCanvasElement>('#scope')!, g = scope.getContext('2d')!
const meter = new AnalyserNode(voice.context, { fftSize: 2048, smoothingTimeConstant: 0 })
voice.out.connect(meter)
const bins = new Float32Array(meter.frequencyBinCount), column = g.createImageData(2, scope.height)
const draw = () => {
  voice.flush()
  meter.getFloatFrequencyData(bins)
  g.drawImage(scope, -2, 0)
  const sr = voice.context.sampleRate
  for (let y = 0; y < scope.height; y++) {
    const hz = 40 * 400 ** (1 - y / (scope.height - 1)), bin = Math.min(bins.length - 1, Math.round((hz * 2048) / sr)), t = Math.max(0, Math.min(1, (bins[bin] + 100) / 80))
    for (let x = 0; x < 2; x++) { const o = (y * 2 + x) * 4; column.data[o] = 255 * Math.min(1, 1.6 * t); column.data[o + 1] = 255 * Math.max(0, 1.5 * t - 0.5); column.data[o + 2] = 255 * (t < 0.4 ? t * 1.6 : Math.max(0, 1.3 - 1.6 * t)); column.data[o + 3] = 255 }
  }
  g.putImageData(column, scope.width - 2, 0)
  const t = voice.told
  state.innerHTML = !voice.running ? 'Tap anything to start sound' : t ? `<b>${t.voices}</b> voices · audio thread <b>${((t.ms / (128000 / sr)) * 100).toFixed(1)}%</b> of its time (worst block ${t.worst.toFixed(2)} ms of ${(128000 / sr).toFixed(2)}) · peak ${(20 * Math.log10(Math.max(t.peak, 1e-5))).toFixed(0)} dB · ${sr} Hz · out ${(((voice.context.baseLatency || 0) + (voice.context.outputLatency || 0)) * 1000).toFixed(0)} ms` : 'Sound is on'
  requestAnimationFrame(draw)
}
requestAnimationFrame(draw)
Object.assign(globalThis, { lab: { voice, music, pickMood, take, INSTRUMENTS, surface, get out() { return out }, hit, blast, HIT, BREAK, WORLD, SET, meter } })
