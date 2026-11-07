// #47 regroup, strategy C (the bold one): no tools. The villager stands big on the mat and you
// tune it by talking to it on a paper slip: "a bit taller", "warmer", "lower voice", "less
// chatty", "keep the jokes clean". setup-talk.ts reads the phrase as data (no model call); each
// change is a small stitched note with a felt swatch of what changed, and Undo. The villager
// answers in its babble voice.
import * as THREE from 'three/webgpu'
import { HAND, MAT, TOP } from './workshop'
import type { Key } from './sliders'
import type { Scene, Strategy } from './setup-strategy'
import { hueOfHex, parseTweak, type Change } from './setup-talk'

const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
const EXAMPLES = ['a bit taller', 'warmer', 'lower voice', 'talk slower', 'livelier', 'less chatty', 'more playful', 'greener', 'keep the jokes clean']
/** Each value's felt, for the swatch on its note (the colour's own swatch is the felt it turned to). */
const FELT: Record<Key, string> = { size: '#d6b45c', hue: '#d9a35f', pitch: '#6f86a8', pace: '#6f9a95', energy: '#7b9a6e', warmth: '#c4553f', playful: '#e0a63c', chatty: '#8a76a0', humour: '#a8703a' }
const NAME: Record<Key, string> = { size: 'size', hue: 'colour', pitch: 'pitch', pace: 'pace', energy: 'energy', warmth: 'manner', playful: 'play', chatty: 'talk', humour: 'jokes' }

export function talk(scene: Scene): Strategy {
  const { tools } = scene
  const band = document.createElement('div')
  band.className = 'vs-talk'
  // The examples: a paper card of things to say. Each is a button that says it.
  const card = document.createElement('div')
  card.className = 'vs-examples'
  const head = document.createElement('b')
  head.textContent = 'Try saying'
  const list = document.createElement('div')
  list.className = 'ex'
  for (const phrase of EXAMPLES) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = `“${phrase}”`
    b.addEventListener('click', () => submit(phrase))
    list.append(b)
  }
  card.append(head, list)
  // The talking slip: the same paper as the describing slip.
  const form = document.createElement('form')
  form.className = 'vs-slip vs-say'
  form.setAttribute('aria-label', 'Tell the villager what to change')
  const tab = document.createElement('div')
  tab.className = 'tab'
  const tabName = document.createElement('b')
  tab.append(tabName)
  const input = document.createElement('textarea')
  input.className = 'line'
  input.rows = 1
  input.maxLength = 160
  input.placeholder = 'e.g. a bit taller, and a lower voice'
  input.setAttribute('aria-label', 'What to change')
  const foot = document.createElement('div')
  foot.className = 'foot'
  const hint = document.createElement('p')
  hint.className = 'status'
  hint.setAttribute('role', 'status')
  hint.setAttribute('aria-live', 'polite')
  hint.textContent = 'Say what to change. Nothing here asks a model.'
  const send = document.createElement('button')
  send.type = 'submit'
  send.className = 'sew'
  send.textContent = 'Tell them'
  foot.append(hint, send)
  form.append(tab, input, foot)
  // What changed: stitched notes, newest first, each with a swatch; the newest can be undone.
  const changes = document.createElement('div')
  changes.className = 'vs-changes'
  changes.setAttribute('aria-label', 'What changed')
  band.append(card, form, changes)
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  document.body.append(band)

  type Done = { said: string; changes: (Change & { from: number; got: number })[]; el: HTMLElement }
  const history: Done[] = []
  let first: Record<Key, number> | null = null
  const hueOf = (v: number) => {
    const hex = scene.hueAt(v)
    return hex ? hueOfHex(hex) : null
  }
  const swatch = (c: { key: Key; got: number }) => {
    const s = document.createElement('i')
    s.className = 'sw'
    s.style.background = c.key === 'hue' ? (scene.hueAt(c.got) ?? FELT.hue) : FELT[c.key]
    if (c.key !== 'hue') {
      // A stitch with a bead where the value now sits, like a tag's gauge.
      const bead = document.createElement('span')
      bead.style.left = `${(c.got * 100).toFixed(0)}%`
      s.append(bead)
    }
    return s
  }
  const render = () => {
    changes.textContent = ''
    history.slice(-3).reverse().forEach((d, i) => {
      const note = document.createElement('div')
      note.className = 'vs-change'
      for (const c of d.changes) {
        const row = document.createElement('span')
        row.className = 'row'
        const words = document.createElement('span')
        const locked = c.key === 'humour' && c.got !== c.to
        words.textContent = locked ? `jokes stay ${c.got >= 1 ? 'crude' : c.got >= 0.5 ? 'cheeky' : 'clean'}` : c.word
        const small = document.createElement('small')
        small.textContent = locked ? 'set by the household’s admin' : NAME[c.key]
        row.append(swatch(c), words, small)
        note.append(row)
      }
      if (i === 0) {
        const undo = document.createElement('button')
        undo.type = 'button'
        undo.className = 'undo'
        undo.textContent = 'Undo'
        undo.addEventListener('click', () => undoLast())
        note.append(undo)
      }
      changes.append(note)
    })
  }
  const undoLast = () => {
    const d = history.pop()
    if (!d) return false
    for (const c of [...d.changes].reverse()) tools.set(c.key, c.from)
    render()
    scene.tuned()
    hint.textContent = `Undone: ${d.said}.`
    return true
  }
  /** Read a message and apply it; returns what changed, for the checks. */
  const submit = (text: string) => {
    if (scene.state() !== 'tuning') return null
    input.value = ''
    const parsed = parseTweak(text, tools.values, hueOf)
    if (parsed.undo) {
      undoLast()
      return { undo: true, changes: [] }
    }
    if (parsed.reset && first) {
      parsed.changes = (Object.keys(first) as Key[]).filter((k) => tools.values[k] !== first![k]).map((k) => ({ key: k, to: first![k], word: `${NAME[k]} as made` }))
    }
    if (!parsed.changes.length) {
      hint.textContent = `I didn't catch “${text.trim().slice(0, 40)}”. Try one on the card.`
      card.classList.remove('nudge')
      void card.offsetWidth
      card.classList.add('nudge')
      scene.say('Sorry, say that another way?', true)
      return { unread: parsed.unread, changes: [] }
    }
    const done: Done = { said: text.trim(), changes: [], el: changes }
    for (const c of parsed.changes) {
      const from = tools.values[c.key]
      tools.set(c.key, c.to)
      done.changes.push({ ...c, from, got: tools.values[c.key] })
    }
    history.push(done)
    render()
    hint.textContent = parsed.unread.length ? `Didn't catch “${parsed.unread[0].slice(0, 30)}”.` : 'Say another, or send them off.'
    scene.tuned()
    return { changes: done.changes.map((c) => ({ key: c.key, from: c.from, to: c.got, word: c.word })), unread: parsed.unread }
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    submit(input.value)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit(input.value)
    }
  })

  const narrow = () => scene.layout() === 'narrow'
  return {
    id: 'c',
    standAt: () => new THREE.Vector3(MAT.x, TOP + 0.006, MAT.z - (narrow() ? 0.08 : 0.04)),
    turn: () => 0.22,
    // No tools at all: the table is the villager and the mat.
    toolsVisible: () => false,
    pose(state) {
      if (state === 'waiting') return scene.overMat()
      if (state !== 'stitching' && state !== 'tuning') return null
      const r = band.getBoundingClientRect()
      // A phone keeps a row above the band for the save and send-off tags.
      return scene.front({ top: narrow() ? 178 : 140, bottom: r.top - (narrow() ? 84 : 16), slope: narrow() ? 0.5 : 0.62, fov: narrow() ? 50 : undefined })
    },
    tuning() {
      const made = scene.made()
      tabName.textContent = made ? `Tell ${made.name} what to change` : 'Tell them what to change'
      first = { ...tools.values }
      history.length = 0
      render()
      band.classList.add('shown')
      form.classList.add('shown')
      scene.reflow()
      input.focus({ preventScroll: true })
    },
    leaving() {
      band.classList.remove('shown')
      form.classList.remove('shown')
      history.length = 0
      render()
    },
    place(what, w, h) {
      // The save and send-off tags sit just above the band, at its two sides.
      if (what !== 'save' && what !== 'done' || !band.classList.contains('shown')) return null
      const top = band.getBoundingClientRect().top - h - 10
      return what === 'save' ? { x: 16, y: top } : { x: innerWidth - 16 - w, y: top }
    },
    api: {
      talk: (text: string) => submit(text),
      undo: () => undoLast(),
    },
    dispose() {
      band.remove()
      style.remove()
    },
  }
}

function css() {
  return `
  .vs-talk { position: fixed; z-index: 6; left: 50%; bottom: 20px; translate: -50% 0; display: flex; align-items: flex-end; gap: 18px;
    width: max-content; max-width: calc(100vw - 32px); visibility: hidden; opacity: 0; transition: opacity 240ms ease, visibility 0s linear 240ms; pointer-events: none; }
  .vs-talk.shown { visibility: visible; opacity: 1; transition: opacity 240ms ease; pointer-events: auto; }
  .vs-talk .vs-slip.vs-say { position: relative; left: auto; top: auto; translate: none; width: 420px; transform: none; rotate: -0.6deg; }
  .vs-talk .vs-say .tab b { font: 700 19px/1.15 ${HAND}; }
  .vs-talk .vs-say .line { min-height: 33px; }
  .vs-examples { position: relative; box-sizing: border-box; width: 250px; padding: 12px 14px 12px; border-radius: 4px 10px 6px 9px; rotate: 1.2deg;
    background: linear-gradient(180deg, #fffaf0, #f3e3c4); color: #4a3220; box-shadow: 0 8px 18px rgba(60, 30, 10, 0.2); }
  .vs-examples::before { content: ''; position: absolute; inset: 5px; border: 1.5px dashed rgba(150, 100, 60, 0.3); border-radius: 3px 7px 4px 6px; pointer-events: none; }
  .vs-examples b { display: block; margin: 0 0 4px 2px; font: 700 17px/1.1 ${HAND}; color: #7a3b2a; }
  .vs-examples .ex { display: flex; flex-wrap: wrap; gap: 2px 6px; }
  .vs-examples button { position: relative; padding: 2px 3px; border: 0; background: none; cursor: pointer; color: #23395a; font: italic 15px/1.35 ${BOOK}; text-align: left; }
  .vs-examples button:hover, .vs-examples button:focus-visible { outline: none; text-decoration: underline 1.5px; text-underline-offset: 3px; }
  .vs-examples.nudge { animation: vs-nudge 520ms ease; }
  @keyframes vs-nudge { 30% { rotate: -1.5deg; translate: 0 -4px; } 60% { rotate: 2.5deg; } }
  .vs-changes { display: flex; flex-direction: column; gap: 8px; width: 240px; }
  .vs-change { position: relative; display: flex; flex-direction: column; gap: 3px; padding: 8px 12px 8px 12px; border-radius: 3px 9px 4px 8px;
    background: linear-gradient(180deg, #fffaf0, #f4e6c9); color: #4a3220; box-shadow: 0 5px 12px rgba(60, 30, 10, 0.2); rotate: -0.8deg; }
  .vs-change:nth-child(2) { opacity: 0.8; rotate: 0.6deg; } .vs-change:nth-child(3) { opacity: 0.6; }
  .vs-change::before { content: ''; position: absolute; inset: 4px; border: 1.4px dashed rgba(150, 100, 60, 0.3); border-radius: 2px 6px 3px 6px; pointer-events: none; }
  .vs-change .row { display: flex; align-items: center; gap: 8px; font: 700 17px/1.2 ${HAND}; }
  .vs-change small { margin-left: auto; font: italic 13px/1.2 ${BOOK}; color: #7a6450; }
  .vs-change .sw { position: relative; flex: none; width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 2px rgba(255, 250, 235, 0.55), 0 1px 2px rgba(60, 30, 10, 0.3);
    background-image: radial-gradient(rgba(255,255,255,0.12) 1px, transparent 1px); background-size: 3px 3px; }
  .vs-change .sw span { position: absolute; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: #fffaf0; box-shadow: 0 0 0 1px rgba(40, 20, 8, 0.35); }
  .vs-change .undo { position: relative; z-index: 1; align-self: flex-end; margin-top: 2px; padding: 0 2px; border: 0; background: none; cursor: pointer; color: #7a3b2a; font: 700 15px/1.2 ${HAND};
    text-decoration: underline 1.2px; text-underline-offset: 3px; }
  @media (max-width: 1200px) and (min-aspect-ratio: 9/10) {
    .vs-talk .vs-slip.vs-say { width: 360px; }
    .vs-examples { width: 220px; }
    .vs-changes { width: 210px; }
  }
  @media (max-aspect-ratio: 9/10) {
    .vs-talk { flex-direction: column; align-items: stretch; gap: 10px; width: calc(100vw - 32px); bottom: 14px; }
    .vs-changes { order: 0; } .vs-examples { order: 1; } .vs-talk .vs-slip.vs-say { order: 2; }
    .vs-talk .vs-slip.vs-say { width: auto; padding: 22px 14px 10px; }
    .vs-talk .vs-say .tab b { font-size: 17px; }
    .vs-examples { width: auto; padding: 8px 12px; rotate: 0.6deg; }
    .vs-examples b { display: inline; margin-right: 6px; font-size: 15px; }
    .vs-examples .ex { display: inline; }
    .vs-examples button { font-size: 14px; padding: 1px 2px; }
    .vs-changes { width: auto; }
    .vs-change:not(:first-child) { display: none; }
    .vs-change { flex-direction: row; flex-wrap: wrap; align-items: center; column-gap: 12px; }
    .vs-change .undo { margin: 0 0 0 auto; }
  }
  @media (prefers-reduced-motion: reduce) { .vs-talk { transition: none; } .vs-examples.nudge { animation: none; } }
  `
}
