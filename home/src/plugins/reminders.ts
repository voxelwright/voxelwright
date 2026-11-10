// Reminders on the fridge (#86). The person asks their villager for a reminder (host/src/reminders.ts keeps it);
// when it is due, the villager's note is pinned to the fridge door with a magnet in their colour, and a paper slip
// in the villager's hand comes up over the room with a soft cue: tick it off, or put it off an hour or until
// tomorrow morning. Choosing the fridge shows the today note (today's reminders, from the host, no model call)
// beside the notes on the door.
//
// Delivery: the page asks the host every 30 s, and at once when it becomes visible. A due reminder (late or not) is
// shown, then acknowledged; the host moves it to `shown` only on that ack, so a lost ack means it arrives again
// (deduped here by id, so the cue plays once per page) rather than never. Nothing runs per frame unless a slip
// is following the fridge on screen or a note is being pinned.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { releaseGpu, replace } from '../kernel'
import { canvas, rng, toTexture } from '../paint'
import { actOnReminder, ME, reminders, type ReminderView } from '../villager'
import { inkOf } from './talk'

/** The fridge's board, for the fridge entry: open it when the fridge is chosen, close it when let go. */
export interface ReminderBoard {
  open(): void
  close(): void
}
declare module 'cordis' {
  interface Context {
    reminders: ReminderBoard
  }
}

const POLL_MS = 30_000
/** The villager's hand, as in the notebook; the person's labels stay in the house hand. */
const VILLAGER_HAND = '"Snell Roundhand", "Apple Chancery", "Segoe Script", cursive'
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
/** At most this many notes on the door; more are counted on the last one. */
const ON_DOOR = 3

/** A colour mixed toward dark brown: the villager's ink, deep enough to read on cream. */
function deepen(hex: string, k = 0.38) {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number, d: number) => Math.round(c + (d - c) * k)
  return `rgb(${mix(n >> 16, 40)}, ${mix((n >> 8) & 255, 22)}, ${mix(n & 255, 12)})`
}

const CSS = `
.rem-layer { position: fixed; inset: 0; pointer-events: none; z-index: 20; }
.rem-slip, .rem-today { pointer-events: auto; position: absolute; box-sizing: border-box; color: var(--deep);
  background: linear-gradient(170deg, #fffaf0 0%, #fbf1dc 60%, #f3e3c3 100%);
  filter: drop-shadow(0 7px 10px rgba(60, 30, 10, .26)) drop-shadow(0 1px 1px rgba(60, 30, 10, .2));
  clip-path: polygon(0 3px, 6% 0, 13% 2px, 21% 0, 30% 3px, 38% 1px, 47% 3px, 55% 0, 64% 2px, 72% 0, 81% 3px, 90% 1px, 100% 2px, 100% 100%, 0 100%); }
.rem-slip { width: 250px; padding: 26px 20px 14px; rotate: var(--tilt, -1.2deg); transform-origin: 50% 0;
  transition: opacity .35s ease, translate .45s cubic-bezier(.2, .9, .3, 1.2); }
.rem-slip.arriving { opacity: 0; translate: 0 -18px; }
.rem-slip::before { content: ''; position: absolute; left: 50%; top: 4px; width: 20px; height: 20px; margin-left: -10px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.75), var(--ink) 45%, color-mix(in srgb, var(--ink), #000 30%));
  box-shadow: 0 2px 3px rgba(40, 20, 6, .35); }
.rem-what { font: 600 italic 25px/1.2 ${VILLAGER_HAND}; margin: 4px 0 6px; overflow-wrap: anywhere; }
.rem-when { font: italic 14px/1.3 ${BOOK}; color: #6d5340; margin: 0; }
.rem-missed { display: inline-block; margin: 0 0 6px; padding: 1px 8px; border: 1.5px solid rgba(120, 70, 50, .55); border-radius: 3px;
  font: 700 11px/1.4 ${BOOK}; letter-spacing: .07em; text-transform: uppercase; white-space: nowrap; color: rgba(120, 60, 40, .85); rotate: -3deg; }
.rem-sign { font: italic 17px ${VILLAGER_HAND}; text-align: right; margin: 2px 0 8px; color: var(--deep); }
.rem-acts { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; border-top: 1px dashed rgba(120, 85, 50, .35); padding-top: 9px; }
.rem-acts button, .rem-close { font: 17px ${HAND}; color: #5a4030; background: none; border: 0; padding: 4px 2px; cursor: pointer;
  text-decoration: underline; text-decoration-color: rgba(90, 64, 48, .35); text-underline-offset: 4px; border-radius: 4px; }
.rem-acts .rem-done { font-weight: 700; color: var(--deep); text-decoration: none; display: inline-flex; gap: 6px; align-items: center; }
.rem-done .box { width: 16px; height: 16px; border: 2px solid var(--deep); border-radius: 3px; display: inline-grid; place-items: center; font-size: 15px; line-height: 1; }
.rem-acts button:hover, .rem-close:hover { color: var(--deep); text-decoration-color: currentColor; }
.rem-acts button:focus-visible, .rem-close:focus-visible { outline: 2px solid var(--deep); outline-offset: 2px; }
.rem-close { position: absolute; right: 6px; top: 4px; width: 30px; height: 30px; font-size: 17px; text-decoration: none; color: #8a6a50; }
.rem-oops { font: italic 14px ${BOOK}; color: #9a3a22; margin: 6px 0 0; }
.rem-slip.ticked .rem-what { text-decoration: line-through; text-decoration-thickness: 2px; opacity: .6; }
.rem-today { width: 270px; padding: 24px 22px 16px 34px;
  background-image: linear-gradient(90deg, transparent 23px, rgba(200, 90, 80, .4) 23px, rgba(200, 90, 80, .4) 24px, transparent 24px),
    repeating-linear-gradient(180deg, transparent 0 27px, rgba(120, 150, 190, .35) 27px 28px), linear-gradient(170deg, #fffaf0, #f6ead0);
  background-position: 0 0, 0 50px, 0 0; rotate: 1.4deg; }
.rem-today h2 { margin: 0 0 6px; font: 700 23px/1.2 ${HAND}; color: #4a3424; }
.rem-today h2 small { display: block; font: italic 14px ${BOOK}; color: #7a5d48; font-weight: 400; }
.rem-today ul { list-style: none; margin: 0; padding: 0; }
.rem-today li { font: 600 italic 19px/28px ${VILLAGER_HAND}; color: var(--deep); display: flex; gap: 10px; }
.rem-today li time { font: italic 13px/28px ${BOOK}; color: #7a5d48; min-width: 58px; }
.rem-today li.done span { text-decoration: line-through; opacity: .55; }
.rem-today .rem-none { font: italic 16px/28px ${BOOK}; color: #7a5d48; }
.rem-board .rem-slip { position: relative; margin: 0 0 18px; }
.rem-board { position: absolute; pointer-events: none; display: flex; gap: 22px; align-items: flex-start; }
.rem-board > * { pointer-events: auto; }
.rem-board .rem-today { position: relative; }
.rem-notes { display: flex; flex-direction: column; }
@media (max-width: 640px) {
  .rem-board { left: 12px !important; right: 12px; top: auto !important; bottom: 72px; flex-direction: column-reverse; gap: 10px; max-height: calc(100vh - 140px); overflow: auto; }
  .rem-slip, .rem-today { width: auto; max-width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .rem-slip { transition: none; } .rem-slip.arriving { translate: none; } }
`

/** Paper for a note on the door: torn top, a little foxed, the words in the villager's hand. */
function paintNote(what: string, ink: string, seed: number, more: number) {
  const W = 256, H = 300
  const [c, g] = canvas(W, H)
  const r = rng(seed)
  g.beginPath()
  g.moveTo(0, 8)
  for (let x = 12; x < W; x += 12) g.lineTo(x, 4 + r() * 8)
  g.lineTo(W, 8)
  g.lineTo(W, H)
  g.lineTo(0, H)
  g.closePath()
  const fill = g.createLinearGradient(0, 0, W * 0.3, H)
  fill.addColorStop(0, '#fffaf0')
  fill.addColorStop(1, '#f1e1c0')
  g.fillStyle = fill
  g.fill()
  g.save()
  g.clip()
  for (let i = 0; i < 500; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.4)' : 'rgba(150,110,60,0.07)'
    g.fillRect(r() * W, r() * H, 1 + r() * 7, 0.8)
  }
  g.restore()
  g.fillStyle = deepen(ink)
  g.font = `600 italic 46px ${VILLAGER_HAND}`
  const words = what.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if (g.measureText(`${line} ${w}`.trim()).width > W - 40 && line) {
      lines.push(line)
      line = w
    } else line = `${line} ${w}`.trim()
  }
  if (line) lines.push(line)
  const shown = lines.slice(0, 3)
  if (lines.length > 3) shown[2] = shown[2].replace(/\s*\S*$/, ' …')
  shown.forEach((l, i) => g.fillText(l, 20, 118 + i * 50))
  if (more > 0) {
    g.font = `italic 30px ${BOOK}`
    g.fillStyle = '#7a5d48'
    g.fillText(`+${more} more`, 20, 280)
  }
  return c
}

export default {
  name: 'reminders',
  inject: ['stage', 'entries'],
  apply(ctx: Context) {
    const { scene, camera, renderer } = ctx.stage
    const { entries } = ctx
    const ink = inkOf(ME)
    let villager = 'your villager'
    let list: ReminderView[] = []
    /** Ids whose arrival this page already showed (the cue plays once); acks still owed to the host are retried. */
    const delivered = new Set<string>()
    const owed = new Set<string>()
    let boardOpen = false
    let failedRead = false

    const style = document.createElement('style')
    style.textContent = CSS
    const layer = document.createElement('div')
    layer.className = 'rem-layer'
    layer.style.setProperty('--ink', ink)
    layer.style.setProperty('--deep', deepen(ink))
    const live = document.createElement('div')
    live.className = 'rem-live'
    live.setAttribute('aria-live', 'polite')
    live.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)'
    ctx.effect(() => {
      document.head.append(style)
      document.body.append(layer, live)
      return () => {
        style.remove()
        layer.remove()
        live.remove()
      }
    }, 'reminder layer')

    /** This plugin's frame hooks: only while a slip follows the fridge or a note is pinned, none at rest (the checks read it). */
    let framing = 0
    const onFrame = (fn: (dt: number) => void) => {
      framing++
      const off = ctx.on('village/frame', fn)
      let on = true
      return () => {
        if (!on) return
        on = false
        framing--
        off()
      }
    }

    // ── the notes on the door ──────────────────────────────────────────────
    const notes = new THREE.Group()
    notes.name = 'reminder notes'
    const magnetGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.012, 16)
    const magnetMat = new THREE.MeshStandardMaterial({ color: ink, roughness: 0.3 })
    /** The door to pin to: the fridge's, or the table top when the kitchen has no fridge. */
    const mount = () => {
      const fridge = scene.getObjectByName('fridge')
      if (fridge) return { parent: fridge, at: (i: number) => new THREE.Vector3(0.12 - i * 0.17, 1.42 - (i % 2) * 0.05, 0.34 + 0.008 + i * 0.001), lying: false }
      const table = scene.getObjectByName('table')
      if (table) return { parent: table, at: (i: number) => new THREE.Vector3(-0.3 + i * 0.18, 0.79, 0.15), lying: true }
      return null
    }
    let noteKey = ''
    const drawNotes = () => {
      const onDoor = list.filter((r) => r.state === 'due' || r.state === 'shown')
      const where = mount()
      // The mount is part of the key: a fridge that loads after the first poll still gets its notes.
      const key = `${where?.parent.uuid ?? 'none'}|${onDoor.map((r) => `${r.id}:${r.state}`).join(',')}`
      if (where && notes.parent !== where.parent) where.parent.add(notes)
      if (key === noteKey) return
      noteKey = key
      for (const old of [...notes.children]) {
        old.removeFromParent()
        const m = (old as THREE.Mesh).material as THREE.MeshStandardMaterial
        m.map?.dispose()
        m.dispose()
        ;(old as THREE.Mesh).geometry.dispose()
      }
      if (!where) return
      onDoor.slice(0, ON_DOOR).forEach((r, i) => {
        const seed = parseInt(r.id.slice(0, 6), 16) % 9973
        const more = i === ON_DOOR - 1 ? onDoor.length - ON_DOOR : 0
        const note = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.152), new THREE.MeshStandardMaterial({ map: toTexture(paintNote(r.what, ink, seed, more)), roughness: 0.85, alphaTest: 0.5 }))
        note.name = `reminder ${r.id}`
        note.userData.reminder = r.id
        note.position.copy(where.at(i))
        note.rotation.z = (rng(seed)() - 0.5) * 0.16
        if (where.lying) note.rotation.x = -Math.PI / 2
        note.receiveShadow = true
        const magnet = new THREE.Mesh(magnetGeo, magnetMat)
        magnet.rotation.x = Math.PI / 2
        magnet.position.set(0, 0.062, 0.007)
        magnet.castShadow = true
        note.add(magnet)
        notes.add(note)
      })
      syncEntry(onDoor)
    }
    ctx.effect(() => () => {
      notes.removeFromParent()
      releaseGpu(notes)
      magnetGeo.dispose()
      magnetMat.dispose()
    }, 'reminder notes')

    // Tab and Enter reach the notes on the door: choosing them opens the fridge's board.
    let removeEntry: (() => void) | null = null
    let entryLabel = ''
    const syncEntry = (onDoor: ReminderView[]) => {
      const label = onDoor.length === 1 ? `Reminder: ${onDoor[0].what}` : onDoor.length ? `${onDoor.length} reminders` : ''
      if (label === entryLabel) return
      removeEntry?.()
      removeEntry = null
      entryLabel = label
      if (!label || !notes.parent) return
      removeEntry = entries.add({ id: 'reminder', label, object: notes, select: () => void entries.choose('fridge') })
    }
    ctx.effect(() => () => removeEntry?.(), 'reminder entry')

    // Pinning: the newest note drops onto the door, unless motion is reduced. The only frame hook, and only while it runs.
    const pin = (id: string) => {
      const note = notes.children.find((n) => n.userData.reminder === id)
      if (!note || reducedMotion.matches) return
      const rest = note.position.clone(), turn = note.rotation.z
      let k = 0
      const off = onFrame((dt: number) => {
        k = Math.min(1, k + dt / 0.5)
        const e = 1 - (1 - k) ** 3
        note.position.set(rest.x, rest.y + (1 - e) * 0.08, rest.z + (1 - e) * 0.05)
        note.rotation.z = turn + (1 - e) * 0.35
        note.scale.setScalar(0.7 + 0.3 * e)
        if (k >= 1) off()
      })
    }

    // ── slips over the room ────────────────────────────────────────────────
    /** A note in the villager's hand: what, when, and what to do with it. `onSettled` runs after a tick or put-off went through. */
    const slip = (r: ReminderView, onSettled: () => void) => {
      const el = document.createElement('section')
      el.className = 'rem-slip'
      el.dataset.reminder = r.id
      el.style.setProperty('--tilt', `${((parseInt(r.id.slice(0, 4), 16) % 7) - 3) * 0.6}deg`)
      el.setAttribute('aria-label', `Reminder from ${villager}`)
      const missed = r.late ? `<p class="rem-missed">missed while away</p>` : ''
      el.innerHTML = `${missed}<p class="rem-what"></p><p class="rem-when"></p><p class="rem-sign"></p>
        <div class="rem-acts"><button type="button" class="rem-done"><span class="box" aria-hidden="true"></span>done</button>
        <button type="button" data-until="hour">in an hour</button><button type="button" data-until="morning">tomorrow morning</button></div><p class="rem-oops" hidden></p>`
      el.querySelector('.rem-what')!.textContent = r.what
      el.querySelector('.rem-when')!.textContent = r.late ? `It was for ${r.when}.` : r.when.replace(/^./, (c) => c.toUpperCase())
      el.querySelector('.rem-sign')!.textContent = `— ${villager}`
      const oops = el.querySelector<HTMLElement>('.rem-oops')!
      const buttons = [...el.querySelectorAll<HTMLButtonElement>('.rem-acts button')]
      const settle = async (action: 'done' | 'later', until?: 'hour' | 'morning') => {
        buttons.forEach((b) => (b.disabled = true))
        oops.hidden = true
        if (action === 'done') {
          el.classList.add('ticked')
          el.querySelector('.box')!.textContent = '✓'
        }
        const at = notes.getWorldPosition(new THREE.Vector3())
        const result = await actOnReminder(r.id, action, until)
        buttons.forEach((b) => (b.disabled = false))
        if (!result.ok) {
          // Never looks done when the host did not keep it.
          el.classList.remove('ticked')
          el.querySelector('.box')!.textContent = ''
          oops.textContent = result.why === 'away' ? "Couldn't reach home just now. Try again in a moment." : "That didn't save. Try again."
          oops.hidden = false
          return
        }
        ctx.emit('village/reminder', { state: action, at })
        live.textContent = action === 'done' ? `Ticked off: ${r.what}.` : `Put off until ${result.reminder.when}: ${r.what}.`
        onSettled()
      }
      buttons[0].addEventListener('click', () => void settle('done'))
      buttons[1].addEventListener('click', () => void settle('later', 'hour'))
      buttons[2].addEventListener('click', () => void settle('later', 'morning'))
      return el
    }

    // An arriving slip follows the fridge on screen; the board's are laid out beside it.
    let arrival: { el: HTMLElement; off: () => void; timer: number } | null = null
    const project = (p: THREE.Vector3) => {
      const rect = renderer.domElement.getBoundingClientRect()
      const n = p.clone().project(camera)
      return { x: rect.left + ((n.x + 1) / 2) * rect.width, y: rect.top + ((1 - n.y) / 2) * rect.height }
    }
    const tuck = () => {
      if (!arrival) return
      const { el, off, timer } = arrival
      arrival = null
      off()
      clearTimeout(timer)
      el.remove()
    }
    const arrive = (r: ReminderView) => {
      tuck()
      const el = slip(r, () => {
        tuck()
        void poll()
      })
      const close = document.createElement('button')
      close.type = 'button'
      close.className = 'rem-close'
      close.textContent = '✕'
      close.setAttribute('aria-label', 'Leave it on the fridge')
      close.addEventListener('click', tuck)
      el.prepend(close)
      el.classList.add('arriving')
      layer.append(el)
      requestAnimationFrame(() => el.classList.remove('arriving'))
      const where = new THREE.Vector3()
      const place = () => {
        notes.getWorldPosition(where)
        const s = project(where)
        const w = el.offsetWidth, h = el.offsetHeight
        const x = Math.min(innerWidth - w - 12, Math.max(12, s.x + 40))
        const y = Math.min(innerHeight - h - 12, Math.max(12, s.y - h * 0.4))
        el.style.left = `${x}px`
        el.style.top = `${y}px`
      }
      place()
      // Left alone, it tucks back onto the fridge after a while (focus or the pointer inside keeps it).
      const timer = window.setTimeout(function wait() {
        if (arrival?.el === el && (el.matches(':hover') || el.contains(document.activeElement))) arrival.timer = window.setTimeout(wait, 5000)
        else if (arrival?.el === el) tuck()
      }, 45_000)
      arrival = { el, off: onFrame(place), timer }
    }

    // The board: the today note and every note on the door, beside the framed fridge.
    let board: HTMLElement | null = null
    const renderBoard = () => {
      board?.remove()
      board = null
      if (!boardOpen) return
      board = document.createElement('div')
      board.className = 'rem-board'
      const today = document.createElement('section')
      today.className = 'rem-today'
      today.setAttribute('aria-label', 'Today')
      const date = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
      today.innerHTML = `<h2>Today <small></small></h2><ul></ul><p class="rem-sign"></p>`
      today.querySelector('small')!.textContent = date
      today.querySelector('.rem-sign')!.textContent = `— ${villager}`
      const ul = today.querySelector('ul')!
      const todays = list.filter((r) => r.today)
      for (const r of todays) {
        const li = document.createElement('li')
        if (r.state === 'done') li.className = 'done'
        const time = document.createElement('time')
        time.dateTime = r.at
        time.textContent = r.when.replace(/^today at /, '')
        const span = document.createElement('span')
        span.textContent = r.what
        li.append(time, span)
        ul.append(li)
      }
      if (!todays.length) {
        const none = document.createElement('li')
        none.className = 'rem-none'
        none.textContent = failedRead ? "Couldn't read today's reminders just now." : 'Nothing on today. Ask me to remind you of something.'
        ul.append(none)
      }
      const column = document.createElement('div')
      column.className = 'rem-notes'
      for (const r of list.filter((x) => x.state === 'due' || x.state === 'shown')) column.append(slip(r, () => void poll()))
      board.append(today, column)
      layer.append(board)
      // Beside the fridge, which the camera frames in the middle: to its right where there is room.
      board.style.left = `${Math.min(innerWidth - board.offsetWidth - 16, innerWidth / 2 + Math.min(260, innerWidth * 0.17))}px`
      board.style.top = `${Math.max(16, innerHeight / 2 - board.offsetHeight / 2)}px`
    }

    // ── asking the host ────────────────────────────────────────────────────
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const got = await reminders()
        if (!got.ok) {
          failedRead = got.why !== 'link' && got.why !== 'away'
          return
        }
        failedRead = false
        villager = got.villager
        list = got.reminders
        drawNotes()
        const arriving = list.filter((r) => r.state === 'due' && !delivered.has(r.id))
        for (const r of arriving) {
          delivered.add(r.id)
          owed.add(r.id)
        }
        const newest = arriving.at(-1)
        if (newest) {
          if (!boardOpen) arrive(newest)
          pin(newest.id)
          ctx.emit('village/reminder', { state: newest.late ? 'missed' : 'arrived', at: notes.getWorldPosition(new THREE.Vector3()) })
          live.textContent = arriving.map((r) => `${r.late ? 'Missed reminder' : 'Reminder'} from ${villager}: ${r.what}.`).join(' ')
        }
        // Shown now: tell the host, and again next time if it did not hear.
        for (const id of owed) if (list.find((r) => r.id === id && r.state === 'due')) {
          if ((await actOnReminder(id, 'shown')).ok) owed.delete(id)
        } else owed.delete(id)
        if (boardOpen && !board?.contains(document.activeElement)) renderBoard()
      } finally {
        polling = false
      }
    }
    const timer = window.setInterval(() => void poll(), POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && void poll()
    ctx.effect(() => {
      document.addEventListener('visibilitychange', onVisible)
      addEventListener('focus', onVisible)
      void poll()
      return () => {
        clearInterval(timer)
        document.removeEventListener('visibilitychange', onVisible)
        removeEventListener('focus', onVisible)
        tuck()
        board?.remove()
      }
    }, 'reminder polling')

    ctx.provide('reminders', {
      open() {
        boardOpen = true
        tuck()
        renderBoard()
        // Keyboard focus goes to the first thing to do on the door, if there is one.
        board?.querySelector<HTMLButtonElement>('.rem-slip button')?.focus({ preventScroll: true })
        void poll()
      },
      close() {
        boardOpen = false
        renderBoard()
      },
    })
    // For the checks: what the page holds now.
    ctx.effect(() => {
      const w = window as unknown as { village?: Record<string, unknown> }
      if (w.village) w.village.reminders = { list: () => list, poll, delivered: () => [...delivered], frameHooks: () => framing }
      return () => void (w.village && delete w.village.reminders)
    }, 'reminder probe')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
