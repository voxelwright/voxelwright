// The listening room (#52, dev only, /sound-lab.html). Models cannot hear, so the owner
// picks each cue's variant here by ear. Every play goes through a real Player on this
// page's own AudioContext and the real mix (voice/buses.ts); "with music underneath" adds
// the bed at its real level. Picks save to the dev server (POST /sound-lab/picks, see
// vite.config.ts) and to localStorage `village.sfx.picks`, which the home's player reads.
// Round 3 sits at the top with the one cue the owner asked to change again (news); round 2's and
// round 1's cards stay below, folded, with the current picks selected. .sound-lab/history.jsonl
// keeps every round's save.
import type { CueName } from '../sound/contract'
import { Player } from '../sound/player'
import { DESCRIPTIONS, PALETTE, SAMPLE_CREDITS } from '../sound/palette'
import { busFor, mixFor } from '../voice/buses'
import { Bed } from '../voice/bed'

const BASE = import.meta.env.BASE_URL
const PICKS_KEY = 'village.sfx.picks'
/** The server takes notes under 2000 characters. */
const NOTES_MAX = 1999

/** Each cue in plain words: the moment in the home it belongs to. */
const MOMENT: Record<CueName, string> = {
  hover: 'Pointing at something (its glow starts)',
  chose: 'Choosing something in the room',
  backed: 'Letting go of it (Escape, or a click elsewhere)',
  glide: 'The camera eases to a new view',
  turned: 'A villager turns to face you',
  card: "A villager's reply card appears",
  'pad-up': 'Your notepad rises',
  'pad-down': 'Your notepad goes down',
  writing: 'Writing on the notepad',
  sketch: 'Drawing or rubbing out on the notepad',
  sent: 'Tearing off a note or a drawing and sending it',
  routed: 'Your note found where it goes',
  unrouted: 'Your note found nowhere to go',
  ghost: 'A see-through ghost of new furniture appears',
  placed: 'The new furniture lands in place',
  kept: 'Keeping the new furniture',
  undone: 'Undoing the new furniture',
  failed: "Making the furniture didn't work",
  'book-open': 'The journal opens',
  'book-close': 'The journal closes',
  page: 'Turning a page in the journal',
  sat: 'A villager sits down at the table',
  farewell: 'Everyone says goodbye and leaves the table',
  news: 'A villager has news (the "!")',
  walk: 'Walking to another room',
  refused: "A door that isn't open yet",
}

/** A realistic payload for each cue, as its event would carry it in the home. */
const EVENT: Partial<Record<CueName, { seconds?: number; event?: Record<string, unknown> }>> = {
  glide: { seconds: 1 },
  card: { event: { page: 0 } },
  writing: { event: { added: 1 } },
  sketch: { event: { tool: 'pen' } },
  sent: { seconds: 1.25 },
  'book-open': { seconds: 0.7, event: { open: true } },
  'book-close': { seconds: 0.7, event: { open: false } },
  page: { seconds: 0.42, event: { leaves: 1, dir: 1 } },
  sat: { seconds: 0.7 },
  walk: { seconds: 0.95, event: { phase: 'leave' } },
}

/** What the owner said about each cue in round 1 (November 7), as saved in .sound-lab/picks.json then. */
const ROUND1_NOTES: Partial<Record<CueName, string>> = {
  news: 'Sounds a bit harsh still', hover: 'Sounds bland and cheap', turned: 'Softer', 'pad-up': 'Softer', 'pad-down': 'Softer',
  farewell: 'This sounds like notification. No need for a kalimba there',
}

/** What the owner said in round 2 (November 8), as saved in .sound-lab/picks.json then. */
const ROUND2_NOTES: Partial<Record<CueName, string>> = {
  news: 'These all feel annoying. Maybe something a bubble pop would be better',
}

/** Round 3: the cue that changed again, the versions to compare (the current pick first), and what changed since. */
const ROUND3: { cue: CueName; variants: string[]; before: string }[] = [
  { cue: 'news', variants: ['a', 'f', 'g', 'h', 'i'], before: `Round 2: you picked A and said “${ROUND2_NOTES.news}”. A is unchanged, to compare; F to I are small, soft bubble pops, no little melody.` },
]

/** Round 2: the cues that changed, the versions to compare (round 1's first), and what changed since. */
const ROUND2: { cue: CueName; variants: string[]; before: string }[] = [
  { cue: 'news', variants: ['a', 'd', 'e'], before: 'Round 1: you picked A and said “Sounds a bit harsh still”. A is unchanged, to compare; D and E are softened.' },
  { cue: 'hover', variants: ['a', 'd', 'e', 'f'], before: 'Round 1: you asked for a change: “Sounds bland and cheap”. A is the round-1 sound; D, E and F are new.' },
  { cue: 'farewell', variants: ['a', 'b', 'c', 'd'], before: 'Round 1: you asked for a change: “This sounds like notification. No need for a kalimba there”. A is the round-1 sound; B, C and D are only people getting up.' },
  { cue: 'turned', variants: ['a', 'b'], before: 'Round 1: you kept it and said “Softer”. A is now softer; B is much softer.' },
  { cue: 'pad-up', variants: ['a', 'b'], before: 'Round 1: you kept it and said “Softer”. A is now softer; B is much softer.' },
  { cue: 'pad-down', variants: ['a', 'b'], before: 'Round 1: you kept it and said “Softer”. A is now softer; B is much softer.' },
]

interface Clip { cue: CueName; how: 'real' | 'emitted'; note: string; videos: Record<string, string> }
interface Manifest { audio: string; clips: Clip[] }
interface Saved { picks: Record<string, string>; notes: Record<string, string>; savedAt?: string }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K]
  e.append(...kids)
  return e
}

const names = Object.keys(PALETTE) as CueName[]
const variantsOf = (cue: CueName) => Object.keys(PALETTE[cue]).sort()
const choosing = names.filter((c) => variantsOf(c).length > 1)
const keeping = names.filter((c) => variantsOf(c).length === 1)
const inRound3 = new Set(ROUND3.map((r) => r.cue))
const inRound2 = new Set(ROUND2.map((r) => r.cue))
/** What the server takes for a cue: a variant or 'none' when it has several, else keep or change. */
const allowed = (cue: CueName) => (variantsOf(cue).length > 1 ? [...variantsOf(cue), 'none'] : ['keep', 'change'])

let audio: AudioContext | null = null
let player: Player | null = null
let bed: Bed | null = null
let bedBuffer: Promise<AudioBuffer> | null = null
const state: Saved = { picks: {}, notes: {} }
let manifest: Manifest | null = null

// ── saving ──────────────────────────────────────────────────────────────────
const status = $('status')
const say = (text: string, saved = false) => {
  status.textContent = text
  status.classList.toggle('saved', saved)
}

/** The picks the home's player reads: real variant ids only. */
function storeLocal() {
  const picks: Record<string, string> = {}
  for (const cue of choosing) if (PALETTE[cue][state.picks[cue]]) picks[cue] = state.picks[cue]
  try {
    localStorage.setItem(PICKS_KEY, JSON.stringify(picks))
  } catch {
    // Private mode or blocked storage: the server copy still holds them.
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
async function save() {
  clearTimeout(timer)
  storeLocal()
  say('Saving…')
  try {
    const r = await fetch('sound-lab/picks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ picks: state.picks, notes: state.notes }) })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    const { savedAt } = (await r.json()) as Saved
    say(`Saved ${new Date(savedAt ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, true)
  } catch (error) {
    console.warn('sound lab: could not save', error)
    say('Not saved on the server (kept on this device)')
  }
}
const saveSoon = () => {
  clearTimeout(timer)
  say('Unsaved changes')
  timer = setTimeout(save, 800)
}

// ── playing ─────────────────────────────────────────────────────────────────
function start() {
  if (audio) return
  audio = new AudioContext({ latencyHint: 'interactive' })
  void audio.resume()
  mixFor(audio).setMuted(false, 0)
  player = new Player(audio, PALETTE, (Math.random() * 2 ** 32) >>> 0)
  void player.load(`${BASE}audio/sfx/`)
  // A touch's pointerdown grants no activation in some browsers: keep resuming on later taps.
  addEventListener('pointerup', () => void (audio?.state !== 'running' && audio?.resume()), { capture: true })
  document.addEventListener('visibilitychange', () => void (document.hidden ? audio?.suspend() : audio?.resume()))
}

async function play(cue: CueName, variant: string, button: HTMLElement) {
  start()
  const p = player!
  await p.load(`${BASE}audio/sfx/`)
  const o = EVENT[cue] ?? {}
  const t = audio!.currentTime + 0.01
  if (cue === 'writing') {
    // A typed word: one event per key, as the notepad sends them.
    for (let i = 0; i < 12; i++) p.play(cue, { variant, at: t + i * 0.15, event: { added: 1 } })
  } else {
    p.play(cue, { variant, at: t, seconds: o.seconds, event: o.event })
  }
  const length = PALETTE[cue][variant].length + (cue === 'writing' ? 1.8 : 0)
  button.classList.add('on')
  setTimeout(() => button.classList.remove('on'), length * 1000)
}

async function setMusic(on: boolean) {
  start()
  const a = audio!
  if (!on) {
    bed?.dispose()
    bed = null
    return
  }
  try {
    bedBuffer ??= fetch(`${BASE}audio/groove-music.ogg`).then((r) => r.arrayBuffer()).then((b) => a.decodeAudioData(b))
    const buffer = await bedBuffer
    if (bed || !($('music') as HTMLInputElement).checked) return
    bed = new Bed(a, buffer, busFor(a, 'music'))
    bed.start(a.currentTime + 0.05, 1)
  } catch (error) {
    bedBuffer = null
    console.warn('sound lab: no music', error)
    say("This browser couldn't play the music")
    ;($('music') as HTMLInputElement).checked = false
  }
}

// ── the cards ───────────────────────────────────────────────────────────────
function card(cue: CueName, variants = variantsOf(cue), before?: string): HTMLElement {
  const clip = manifest?.clips.find((c) => c.cue === cue)
  const section = el('section', { className: 'cue' })
  section.dataset.cue = cue
  section.append(el('header', {}, el('h2', {}, MOMENT[cue] ?? cue), el('span', { className: 'name' }, cue)))
  if (before) section.append(el('p', { className: 'before' }, before))

  for (const v of variants) {
    const row = el('div', { className: 'variant' })
    const label = variants.length > 1 ? `Play ${v.toUpperCase()}` : 'Play'
    const button = el('button', { className: 'play', type: 'button', textContent: `▶ ${label}` })
    button.dataset.variant = v
    button.addEventListener('click', () => void play(cue, v, button))
    row.append(button, el('span', { className: 'what' }, DESCRIPTIONS[cue]?.[v] ?? ''))
    const src = clip?.videos[v]
    if (src) {
      const watch = el('button', { className: 'watch', type: 'button', textContent: 'Watch it in the home' })
      watch.addEventListener('click', () => {
        const video = el('video', { controls: true, playsInline: true, preload: 'auto', src })
        watch.replaceWith(video)
        void video.play().catch(() => {})
      })
      row.append(el('span'), watch)
    }
    section.append(row)
  }
  if (clip?.note) section.append(el('p', { className: 'small' }, clip.note))

  const options = variants.length > 1 ? [...variants.map((v) => [v, v.toUpperCase()]), ['none', 'None of these']] : [['keep', 'Keep'], ['change', 'Change']]
  const picks = el('div', { className: 'picks', role: 'group' })
  picks.setAttribute('aria-label', variants.length > 1 ? 'Your pick' : 'Keep or change')
  const show = () => {
    for (const b of picks.querySelectorAll('button')) b.setAttribute('aria-pressed', String(state.picks[cue] === b.dataset.value))
  }
  for (const [value, text] of options) {
    const b = el('button', { type: 'button', textContent: text })
    b.dataset.value = value
    b.addEventListener('click', () => {
      if (state.picks[cue] === value) delete state.picks[cue]
      else state.picks[cue] = value
      show()
      saveSoon()
    })
    picks.append(b)
  }
  show()
  const notes = el('textarea', { placeholder: 'A note (optional): what to change, what it reminds you of…', maxLength: NOTES_MAX, rows: 1, value: state.notes[cue] ?? '' })
  notes.setAttribute('aria-label', `Notes on ${MOMENT[cue]}`)
  notes.addEventListener('input', () => {
    if (notes.value.trim()) state.notes[cue] = notes.value
    else delete state.notes[cue]
    saveSoon()
  })
  section.append(picks, notes)
  return section
}

function credits(): HTMLElement {
  const list = el('ul')
  for (const c of SAMPLE_CREDITS) {
    list.append(el('li', {}, `“${c.title}” by ${c.author}, `, el('a', { href: c.source, target: '_blank', rel: 'noopener', textContent: 'Freesound' }), ', ',
      el('a', { href: c.licenceUrl, target: '_blank', rel: 'noopener', textContent: c.licence })))
  }
  list.append(el('li', {}, '“Groove Music” by benpm, ', el('a', { href: 'https://freesound.org/s/203099/', target: '_blank', rel: 'noopener', textContent: 'Freesound' }), ', ',
    el('a', { href: 'https://creativecommons.org/licenses/by/4.0/', target: '_blank', rel: 'noopener', textContent: 'CC BY 4.0' }), ' (the music, played quieter than the file)'))
  return el('div', {}, el('p', {}, 'Recordings'), list)
}

async function load() {
  const [saved, found] = await Promise.all([
    fetch('sound-lab/picks').then((r) => (r.ok ? (r.json() as Promise<Saved>) : null)).catch(() => null),
    fetch('sound-lab/manifest.json').then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null)).catch(() => null),
  ])
  if (saved) {
    Object.assign(state.picks, saved.picks)
    Object.assign(state.notes, saved.notes)
  } else {
    try {
      Object.assign(state.picks, JSON.parse(localStorage.getItem(PICKS_KEY) ?? '{}'))
    } catch {
      // Nothing stored.
    }
  }
  // A pick round 2 has made impossible (keep or change on a cue that now has versions) would make
  // the server refuse the whole save: drop it here; history.jsonl still holds round 1.
  for (const [cue, value] of Object.entries(state.picks)) if (!(cue in PALETTE) || !allowed(cue as CueName).includes(value)) delete state.picks[cue]
  // Round 1's notes are quoted on the round-2 cards; the boxes start empty for new notes.
  for (const { cue } of ROUND2) if (state.notes[cue] === ROUND1_NOTES[cue]) delete state.notes[cue]
  // Round 2's notes are quoted on the round-3 card the same way.
  for (const { cue } of ROUND3) if (state.notes[cue] === ROUND2_NOTES[cue]) delete state.notes[cue]
  manifest = found
  const cues = $('cues')
  cues.append(el('p', { className: 'divider' }, 'Round 3'))
  cues.append(el('p', { className: 'lede' }, 'The news sound, again. The card says what you said last time; pick the version you like.'))
  for (const { cue, variants, before } of ROUND3) cues.append(card(cue, variants, before))
  if (manifest) cues.append(el('p', { className: 'small' }, `The videos are the real home recorded headless; their sound is rendered offline over the same timeline (${manifest.audio}).`))
  const round2 = el('details', { className: 'round round2' }, el('summary', {}, `Round 2: ${ROUND2.filter((r) => !inRound3.has(r.cue)).length} more sounds you changed, with your picks`))
  for (const { cue, variants, before } of ROUND2) if (!inRound3.has(cue)) round2.append(card(cue, variants, before))
  cues.append(round2)
  const earlier = (cue: CueName) => inRound2.has(cue) || inRound3.has(cue)
  const round1 = el('details', { className: 'round round1' }, el('summary', {}, `Round 1: the other ${names.filter((c) => !earlier(c)).length} sounds, with your picks`))
  round1.append(el('p', { className: 'divider' }, 'Pick one'))
  for (const cue of choosing) if (!earlier(cue)) round1.append(card(cue))
  round1.append(el('p', { className: 'divider' }, 'Keep or change'))
  for (const cue of keeping) if (!earlier(cue)) round1.append(card(cue))
  cues.append(round1)
  $('credits').append(credits())
  if (saved?.savedAt) say(`Last saved ${new Date(saved.savedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`, true)
}

const ready = load()
$('start').addEventListener('click', async () => {
  start()
  $('start').hidden = true
  $('hint').hidden = true
  await ready
  $('lab').hidden = false
})
$('music').addEventListener('change', (e) => void setMusic((e.target as HTMLInputElement).checked))
$('save').addEventListener('click', () => void save())
$('try').addEventListener('click', () => storeLocal())

/** For the headless check: the page's context and mix. */
;(window as unknown as { soundLab: unknown }).soundLab = { get audio() { return audio }, get mix() { return audio ? mixFor(audio) : null }, state, save }
