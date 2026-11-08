// The always-on input (#42 prototype), behind ?talk=npc&input=held|speech.
// A keypress anywhere starts writing; Enter sends the line on its way to whoever
// it is addressed to (your own villager unless you have turned to someone else).
//
//   held    (the default) your own small notepad, held low on the right in a knitted
//           mitten and seen in perspective: a real 3D object riding with the camera.
//           At rest it shows whom it is to; the first keypress or a click raises it
//           to writing size, and it settles back after sending or Escape. Your words
//           are written on it in your ink; Enter tears the note off, folds it in three
//           and it flies to its recipient (the camera waits for it to land).
//   speech  no box at all until you type: your words rise from the bottom centre
//           as your own speech card, kin to the villagers' cards but clearly yours.
//
// Both keep a tiny felt journal beside the input: one click (or J) opens the journal.
// Keys reach this file only through `key(e)`, called from talk.ts's one keyboard path.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { releaseGpu, type Stage } from '../kernel'
import type { Entries } from '../plugins/entries'
import { canvas, paintLinen, toTexture } from '../paint'

export type Variant = 'held' | 'speech'
/**
 * The one rule for which input a page has (#42): with ?talk=npc the held notepad by default,
 * ?input=speech for the speech card, and none (the paper slip) with ?input=slip or ?slip=always.
 */
export function inputVariant(query: URLSearchParams): Variant | null {
  if (query.get('talk') !== 'npc' || query.get('input') === 'slip' || query.get('slip') === 'always') return null
  return query.get('input') === 'speech' ? 'speech' : 'held'
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
/** Your ink: blue-black, the same as the slip and the notebook. */
const INK = '#23395a'
/** The owner's colour (Alex), worn by your mitten and your speech card's tab. */
const MINE = '#3c5a8a'

export interface Addressee { label: string; colour: string }
export interface InputHooks {
  variant: Variant
  /** Who a line goes to now. */
  addressee(): Addressee
  /** Where a sent line flies: the reader's paws, or the table, in world space. */
  target(): THREE.Vector3 | null
  /** Whose paws the note lands in (it stays held there until it opens into the reply); none: it lies where it lands. */
  holder?(): THREE.Object3D | null
  /** Enter, with the time it was pressed. */
  submit(text: string, t0: number): void
  /** Something else has the keyboard (the open journal): the input stays out of the way. */
  blocked(): boolean
  /** The journal entry's id, chosen by the felt book or J. */
  journal: string
  /** Open the journal where it makes sense (the last conversation). */
  openJournal(): void
  /** Announce what happened (sound/contract.ts): the pad, the writing, the send. */
  emit: Context['emit']
  /** Sketching (#42, sketch.ts): Enter while drawing is the page's, not a line's. True when it took the key. */
  enter?(): boolean
}

export function alwaysOn(stage: Stage, entries: Entries, hooks: InputHooks) {
  const { camera, scene } = stage
  // The keyboard lands in one off-screen input, so editing, IME and screen readers work as usual.
  const field = document.createElement('input')
  field.className = 'talk-input-field'
  field.type = 'text'
  field.maxLength = 600
  field.autocomplete = 'off'
  field.setAttribute('aria-label', 'Write a line')
  field.enterKeyHint = 'send'
  field.placeholder = 'Write a line…'
  // On a touch screen no key press can focus a hidden field, so a tap shows this one as a real line
  // and focuses it inside the tap, which is what raises the phone's keyboard (#42).
  const touch = matchMedia('(pointer: coarse)')
  const showField = (on: boolean) => field.classList.toggle('touch', on && touch.matches)
  const vv = window.visualViewport
  /** Keep the line just above the keyboard: the visual viewport shrinks and scrolls while it is up. */
  const placeField = () => {
    if (!vv) return
    field.style.bottom = `${Math.max(0, innerHeight - (vv.offsetTop + vv.height))}px`
  }
  vv?.addEventListener('resize', placeField)
  vv?.addEventListener('scroll', placeField)
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  document.body.append(field)

  // ── The rig riding with the camera ───────────────────────────────────────
  const hud = new THREE.Group()
  hud.name = 'talk input'
  hud.userData.hud = true
  scene.add(hud)
  const mark = (o: THREE.Object3D) => {
    o.traverse((n) => {
      n.userData.hud = true
      if ((n as THREE.Mesh).isMesh) n.castShadow = n.receiveShadow = false
    })
    return o
  }

  // The tiny felt journal: in both variants, at the bottom left, wearing a ribbon.
  const journal = new THREE.Group()
  journal.name = 'talk journal button'
  const linen = toTexture(paintLinen(7, [92, 120, 86], 256))
  const felt = new THREE.MeshStandardMaterial({ map: linen, color: '#9fbf8f', roughness: 1, emissive: '#2a3a24', emissiveIntensity: 0.25 })
  const pages = new THREE.MeshStandardMaterial({ color: '#f6ecd8', roughness: 0.95, emissive: '#3a3020', emissiveIntensity: 0.2 })
  const ribbonMat = new THREE.MeshStandardMaterial({ color: '#b84a36', roughness: 0.9 })
  const cover = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.44, 0.06, 3, 0.025), felt)
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.41, 0.045), pages)
  block.position.x = 0.012
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.006), ribbonMat)
  ribbon.position.set(0.06, -0.27, 0.02)
  ribbon.rotation.z = 0.12
  // A stitched "J" patch on the cover, so it reads as the journal.
  const [pc, pg] = canvas(256, 256)
  pg.fillStyle = '#f2e6cc'
  pg.beginPath()
  pg.arc(128, 128, 116, 0, Math.PI * 2)
  pg.fill()
  pg.strokeStyle = 'rgba(120, 80, 40, 0.75)'
  pg.lineWidth = 6
  pg.setLineDash([16, 12])
  pg.beginPath()
  pg.arc(128, 128, 96, 0, Math.PI * 2)
  pg.stroke()
  pg.setLineDash([])
  pg.fillStyle = '#5a3a24'
  pg.font = `700 120px ${HAND}`
  pg.textAlign = 'center'
  pg.textBaseline = 'middle'
  pg.fillText('J', 128, 136)
  const patch = new THREE.Mesh(new THREE.CircleGeometry(0.085, 32), new THREE.MeshStandardMaterial({ map: toTexture(pc), roughness: 1, transparent: true, emissive: '#3a2a18', emissiveIntensity: 0.15 }))
  patch.position.set(0, 0.04, 0.032)
  journal.add(cover, block, ribbon, patch)
  journal.rotation.set(-0.35, 0.28, 0.12)
  hud.add(mark(journal))

  // The notepad (held variant): paper on a card back, a stitched felt binding, your mitten holding it.
  const pad = new THREE.Group()
  pad.name = 'talk notepad'
  const PW = 1024, PH = 600
  const [paperCanvas, paper] = canvas(PW, PH)
  const paperTex = toTexture(paperCanvas)
  // Unlit, held under the bloom threshold: a lamp near the camera never bleaches the words (#42 regroup).
  const paperMat = new THREE.MeshBasicMaterial({ map: paperTex, color: new THREE.Color(0.8, 0.75, 0.65), fog: false })
  const board = new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 0.9 })
  const PADW = 1.0, PADH = 0.6
  const back = new THREE.Mesh(new RoundedBoxGeometry(PADW + 0.04, PADH + 0.05, 0.02, 2, 0.012), board)
  back.position.z = -0.012
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(PADW, PADH), paperMat)
  const stackMat = new THREE.MeshStandardMaterial({ color: '#efe3cb', roughness: 0.95 })
  const stack = new THREE.Mesh(new THREE.BoxGeometry(PADW, PADH, 0.012), stackMat)
  stack.position.z = -0.0065
  const binding = new THREE.Mesh(new RoundedBoxGeometry(PADW + 0.05, 0.075, 0.035, 2, 0.015), new THREE.MeshStandardMaterial({ map: toTexture(paintLinen(3, [178, 74, 54], 256)), roughness: 1 }))
  binding.position.set(0, PADH / 2 + 0.01, 0.006)
  const mitten = new THREE.MeshStandardMaterial({ map: toTexture(paintLinen(11, [60, 90, 138], 256)), roughness: 1, emissive: '#101828', emissiveIntensity: 0.2 })
  // A knitted mitten holding the pad from below: the palm behind, the thumb pressed on the front.
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), mitten)
  palm.scale.set(0.17, 0.2, 0.09)
  palm.position.set(-PADW / 2 + 0.06, -0.2, -0.08)
  palm.rotation.z = 0.35
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.1, 8, 16), mitten)
  thumb.position.set(-PADW / 2 + 0.12, -0.13, 0.035)
  thumb.rotation.z = -1.0
  thumb.scale.z = 0.7
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.045, 12, 28), new THREE.MeshStandardMaterial({ map: toTexture(paintLinen(12, [236, 226, 204], 256)), roughness: 1 }))
  cuff.position.set(-PADW / 2 - 0.02, -0.38, -0.08)
  cuff.rotation.set(1.3, 0, 0.35)
  pad.add(back, stack, sheet, binding, palm, thumb, cuff)
  pad.visible = hooks.variant === 'held'
  hud.add(mark(pad))

  // The torn note on its way.
  // Its glow is warm paper, not white: a white glow bloomed into a slab in flight (ui-craft round 1), and none left it unlit.
  const flyMat = new THREE.MeshStandardMaterial({ roughness: 0.92, transparent: true, side: THREE.FrontSide, emissive: '#b8a888', emissiveIntensity: 0.12 })
  const NOTEH = PADH * 0.62
  // The note folds its right third over as it lifts (#42 regroup); the back of the paper is blank.
  const backMat = new THREE.MeshStandardMaterial({ color: '#efe3c8', roughness: 0.95, side: THREE.BackSide, transparent: true, emissive: '#8a7a5a', emissiveIntensity: 0.25 })
  const part = (u0: number, u1: number) => {
    const g = new THREE.PlaneGeometry(PADW * (u1 - u0), NOTEH)
    const uv = g.attributes.uv
    for (let k = 0; k < uv.count; k++) uv.setX(k, u0 + uv.getX(k) * (u1 - u0))
    const face = new THREE.Mesh(g, flyMat)
    face.add(new THREE.Mesh(g, backMat))
    return face
  }
  const flyer = new THREE.Group()
  const flat = part(0, 2 / 3), flap = part(2 / 3, 1)
  flat.position.x = -PADW / 6
  const hinge = new THREE.Group()
  hinge.position.set(PADW / 6, 0, 0.002)
  flap.position.x = PADW / 6
  hinge.add(flap)
  flyer.add(flat, hinge)
  flyer.name = 'talk note in flight'
  flyer.visible = false
  scene.add(mark(flyer))
  // Its shadow crosses the floor under it, so the note is seen to be in the air.
  flat.castShadow = flap.castShadow = true
  let flight: { t: number; from: THREE.Matrix4; to: THREE.Vector3; holder: THREE.Object3D | null; local: THREE.Vector3; size: number } | null = null
  /**
   * Landed: held in the reader's paws (following them) or lying on the table, folded, until it opens
   * (#42 paper climb: the note used to fade at the reader's head and the reply came from nowhere).
   */
  let held: { holder: THREE.Object3D | null; local: THREE.Vector3; t: number; opening: number; size: number } | null = null
  /** Waiting for the note in flight to land (talk.ts holds the camera until then). */
  let landings: (() => void)[] = []
  const land = () => {
    for (const done of landings) done()
    landings = []
  }
  /** Where the pad's paper is on screen, so the villagers' cards keep clear of it. */
  let padRect = { left: 0, top: 0, width: 0, height: 0 }

  // ── The speech card (speech variant) ─────────────────────────────────────
  const speech = document.createElement('div')
  speech.className = 'talk-mine'
  speech.setAttribute('aria-hidden', 'true')
  const tab = document.createElement('div')
  tab.className = 'mine-tab'
  const toTag = document.createElement('span')
  toTag.className = 'mine-to'
  const words = document.createElement('p')
  words.className = 'mine-words'
  const caret = document.createElement('i')
  caret.className = 'mine-caret'
  speech.append(tab, toTag, words)
  // Speech has no box at rest; until the first line, a pencilled hint says how to start.
  const hint = document.createElement('div')
  hint.className = 'talk-input-hint'
  hint.textContent = 'just start typing · J opens your journal'
  hint.hidden = hooks.variant !== 'speech'
  document.body.append(hint)
  tab.textContent = 'You'
  document.body.append(speech)
  const journalButton = document.createElement('button')
  journalButton.type = 'button'
  journalButton.className = 'talk-journal'
  journalButton.setAttribute('aria-label', 'Open the journal (J)')
  journalButton.title = 'Journal (J)'
  document.body.append(journalButton)
  // The resting pad is a real button too: a click raises it for writing.
  const padButton = document.createElement('button')
  padButton.type = 'button'
  padButton.className = 'talk-pad'
  padButton.setAttribute('aria-label', 'Write a line')
  padButton.hidden = hooks.variant !== 'held'
  document.body.append(padButton)

  // ── Writing ──────────────────────────────────────────────────────────────
  let text = ''
  let shownTo = ''
  let dirty = true
  let caretOn = true
  let blink = 0
  /** Seconds since the last send, for the "sent" beat on the card. */
  let sent = 99
  let everSent = false
  /** The pad shows the fresh sheet under a note just torn off; repainted with the address after. */
  let tornFresh = false
  const wrap = (g: CanvasRenderingContext2D, s: string, width: number) => {
    const out: string[] = []
    let line = ''
    for (const word of s.split(/(\s+)/)) {
      if (g.measureText(line + word).width > width && line.trim()) {
        out.push(line.trimEnd())
        line = word.trimStart()
      } else line += word
    }
    out.push(line)
    return out
  }
  const paintPad = () => {
    const g = paper
    g.fillStyle = '#fbf3e1'
    g.fillRect(0, 0, PW, PH)
    // Fibres and a soft warm edge.
    for (let i = 0; i < 500; i++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(150,110,60,0.06)'
      g.fillRect(Math.random() * PW, Math.random() * PH, 2 + Math.random() * 10, 1)
    }
    const edge = g.createRadialGradient(PW / 2, PH / 2, PH * 0.4, PW / 2, PH / 2, PW * 0.65)
    edge.addColorStop(0, 'rgba(0,0,0,0)')
    edge.addColorStop(1, 'rgba(150, 100, 50, 0.16)')
    g.fillStyle = edge
    g.fillRect(0, 0, PW, PH)
    g.strokeStyle = 'rgba(120, 150, 190, 0.45)'
    g.lineWidth = 2
    for (let y = 196; y < PH; y += 92) {
      g.beginPath()
      g.moveTo(40, y)
      g.lineTo(PW - 40, y)
      g.stroke()
    }
    g.strokeStyle = 'rgba(200, 90, 80, 0.4)'
    g.beginPath()
    g.moveTo(96, 0)
    g.lineTo(96, PH)
    g.stroke()
    // To whom, in their colour, like the address at the head of a note: one size and one place at rest and
    // while writing (#42 paper climb: it moved and changed size between the two); the pad itself comes nearer.
    const to = hooks.addressee()
    const resting = !writing()
    g.textAlign = 'left'
    // Just torn: a fresh sheet for a moment, then the address is written on it again (#42 paper climb: the
    // address showing faintly under the note as it tore off read as a copy).
    if (flight && sent < 0.45) {
      tornFresh = true
      return
    }
    g.font = `italic 50px ${HAND}`
    const toW = g.measureText('to ').width
    g.fillStyle = 'rgba(70, 50, 36, 0.7)'
    g.fillText('to ', 120, 100)
    g.font = `700 86px ${HAND}`
    g.fillStyle = to.colour
    g.fillText(to.label, 120 + toW, 100)
    // The pencilled hint only until the first line is sent: after that it would read as a form's placeholder.
    if (resting && !everSent) {
      g.font = `italic 48px ${HAND}`
      g.fillStyle = 'rgba(70, 50, 36, 0.8)'
      g.fillText('just start typing…', 124, 184)
    }
    if (resting) return
    g.textAlign = 'left'
    g.font = `56px ${HAND}`
    if (!text) {
      g.fillStyle = 'rgba(70, 50, 36, 0.42)'
      g.font = `italic 50px ${HAND}`
      if (sketching) {
        if (sketchHint) g.fillText(sketchHint, 120, 180)
        return
      }
      g.fillText('just start typing…', 120, 180)
      if (caretOn) {
        g.fillStyle = INK
        g.fillRect(118, 130, 4, 58)
      }
      return
    }
    // A firm hand: lighter strokes were hard to read on the held pad before sending (#42 paper climb).
    g.font = `700 56px ${HAND}`
    g.fillStyle = INK
    const lines = wrap(g, text, PW - 190).slice(-4)
    lines.forEach((l, i) => g.fillText(l, 120, 180 + i * 92))
    if (caretOn) {
      const last = lines.at(-1) ?? ''
      const x = 124 + g.measureText(last).width
      g.fillRect(x, 180 + (lines.length - 1) * 92 - 50, 4, 60)
    }
  }
  const paintSpeech = () => {
    const to = hooks.addressee()
    toTag.textContent = `to ${to.label}`
    toTag.style.setProperty('--c', to.colour)
    words.textContent = text
    words.append(caret)
    speech.classList.toggle('shown', text.length > 0)
  }

  /**
   * One key from talk.ts's keyboard path. True when the input owns it: any key
   * while the line has the keyboard (Escape only while there are words to clear),
   * `j` with nothing written (the journal), and a printable key, which starts a line.
   */
  const key = (e: KeyboardEvent): boolean => {
    if (hooks.blocked()) return false
    const t = e.target as HTMLElement | null
    if (t === field || document.activeElement === field) return e.key !== 'Escape' || field.value.length > 0
    // A line put back after a failed send waits on the pad without the keyboard: Escape clears it.
    if (e.key === 'Escape' && field.value) {
      e.preventDefault()
      field.value = ''
      onInput()
      return true
    }
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return false
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ') return false
    // j (lowercase, nothing written yet) opens the journal; a capital J still starts a line.
    e.preventDefault()
    if (e.key === 'j' && !field.value) {
      openJournal()
      return true
    }
    field.focus({ preventScroll: true })
    field.value += e.key
    onInput()
    return true
  }
  /** Raised for writing: the field has the keyboard, or words are on the pad, or you are drawing on it. */
  const writing = () => document.activeElement === field || text.length > 0 || sketching
  // ── Sketching (#42, sketch.ts owns the drawing): the pad grows to drawing size ──
  let sketching = false
  let sketchHint = ''
  /** 0 writing size, 1 drawing size. */
  let draw = 0
  const onInput = () => {
    const added = field.value.length - text.length
    if (added) hooks.emit('village/wrote', { added })
    text = field.value
    caretOn = true
    blink = 0
    dirty = true
  }
  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      // Sketching (#42): while drawing, Enter makes or gives the page (sketch.ts).
      if (sketching && hooks.enter?.()) return
      const line = field.value.trim()
      if (!line) return
      const t0 = performance.now()
      send()
      // Sent: the pad settles back; the next keypress (or tap) raises it again.
      field.blur()
      showField(false)
      hooks.submit(line, t0)
    } else if (e.key === 'Escape') {
      // Escape clears the line and settles the pad; with nothing written it goes on to the room.
      if (field.value) {
        e.preventDefault()
        e.stopPropagation()
        field.value = ''
        onInput()
      }
      field.blur()
    }
  }
  /** The note leaves: the pad tears it off and it flies to the recipient; the speech card rises toward them. */
  const send = () => {
    sent = 0
    everSent = true
    const target = hooks.target()
    if (hooks.variant === 'held') {
      // The note leaves without the caret.
      const caret = caretOn
      caretOn = false
      paintPad()
      caretOn = caret
      flyMat.map?.dispose()
      const [c, g] = canvas(PW, Math.round(PH * 0.62))
      g.drawImage(paperCanvas, 0, 0, PW, PH * 0.62, 0, 0, PW, PH * 0.62)
      flyMat.map = toTexture(c)
      flyMat.emissiveMap = flyMat.map
      flyMat.needsUpdate = true
      sheet.updateWorldMatrix(true, false)
      flyer.matrixWorld.copy(sheet.matrixWorld)
      held = null
      flyer.visible = false
      const holder = hooks.holder?.() ?? null
      // Held: about a postcard to a villager; on the table, a little larger, so it reads from the table shot.
      if (target && !reducedMotion.matches) flight = { t: 0, from: sheet.matrixWorld.clone(), to: target.clone(), holder, local: holder ? holder.worldToLocal(target.clone()) : target.clone(), size: holder ? 0.28 : 0.3 }
    } else if (target && !reducedMotion.matches) {
      const p = target.clone().project(camera)
      const r = stage.renderer.domElement.getBoundingClientRect()
      const box = speech.getBoundingClientRect()
      speech.style.setProperty('--fly-x', `${r.left + ((p.x + 1) / 2) * r.width - (box.left + box.width / 2)}px`)
      speech.style.setProperty('--fly-y', `${r.top + ((1 - p.y) / 2) * r.height - (box.top + box.height / 2)}px`)
      const ghost = speech.cloneNode(true) as HTMLElement
      ghost.classList.add('flying')
      ghost.querySelector('.mine-caret')?.remove()
      document.body.append(ghost)
      requestAnimationFrame(() => requestAnimationFrame(() => ghost.classList.add('go')))
      setTimeout(() => ghost.remove(), 750)
    }
    hooks.emit('village/sent', { seconds: reducedMotion.matches || !target ? 0 : hooks.variant === 'held' ? 1.25 : 0.75, at: target ?? undefined })
    text = '' // the line left with the note: clearing the field is not writing
    field.value = ''
    onInput()
    hint.hidden = true
  }

  const openJournal = () => {
    field.blur()
    hooks.openJournal()
  }
  journalButton.addEventListener('click', openJournal)
  // Focus inside the tap or click itself: on a phone that is what raises the keyboard.
  const writeHere = () => {
    showField(true)
    placeField()
    field.focus({ preventScroll: true })
  }
  padButton.addEventListener('click', writeHere)
  field.addEventListener('input', onInput)
  field.addEventListener('keydown', onFieldKey)
  // Focus changes raise and settle the pad, and repaint it between its two looks.
  const repaint = () => {
    dirty = true
  }
  field.addEventListener('focus', repaint)
  field.addEventListener('blur', () => {
    repaint()
    if (!field.value) showField(false)
  })

  // ── Each frame: ride with the camera, paint, fly ─────────────────────────
  const fwd = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const tmp = new THREE.Vector3()
  const scl = new THREE.Vector3()
  let hover = 0
  let lift = 0
  /** 0 at rest, tucked small at the bottom edge; 1 raised to writing size. */
  let raise = 0
  let padUp = false
  const screenBox = (o: THREE.Object3D) => {
    o.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(o)
    const r = stage.renderer.domElement.getBoundingClientRect()
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = tmp.set(x, y, z).project(camera)
      const sx = r.left + ((p.x + 1) / 2) * r.width, sy = r.top + ((1 - p.y) / 2) * r.height
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy)
    }
    return { x0, y0, x1, y1: Math.min(y1, innerHeight) }
  }
  const frame = (dt: number, t: number) => {
    const away = hooks.blocked()
    hud.visible = !away
    if (away) speech.classList.remove('shown')
    hint.classList.toggle('shown', !away && !text)
    // In front of the camera at 0.5 m, scaled to the view so it keeps its place on screen.
    const d = 0.5
    const h = d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    const aspect = camera.aspect
    camera.getWorldPosition(tmp)
    camera.getWorldQuaternion(q)
    fwd.set(0, 0, -1).applyQuaternion(q)
    hud.position.copy(tmp).addScaledVector(fwd, d)
    hud.quaternion.copy(q)
    hud.scale.setScalar(h)
    // Breathing, as a held thing does; it rises to writing size while you write and settles after.
    const ease = (goal: number, rate: number, v: number) => reducedMotion.matches ? goal : v + (goal - v) * (1 - Math.exp(-dt * rate))
    raise = ease(writing() ? 1 : 0, 9, raise)
    if (writing() !== padUp) hooks.emit('village/pad', { up: (padUp = writing()) })
    lift = ease(text ? 1 : 0, 6, lift)
    draw = ease(sketching ? 1 : 0, 8, draw)
    const breathe = reducedMotion.matches ? 0 : Math.sin(t * 1.3) * 0.006 * (1 - draw)
    // At rest about a third of its writing size, and mostly below the edge: only its top line, "to Dumpling", shows.
    // Drawing (#42): nearly facing you, as large as fits, lower middle of the view.
    const big = Math.min(1.75, (2 * aspect * 0.92) / 1.04, 1.25 / 0.65)
    // Rest and writing poses: scale, x, y, tilt back, turn, roll. Held low on the right in perspective,
    // as a hand would (#42 regroup: square to the view it read as a card on the screen). On a tall
    // (phone) screen it sits bottom right at rest and centred while writing.
    const narrow = aspect < 0.8
    const [rest, up] = narrow
      ? [[0.4, aspect - 0.2, -0.9, -0.8, -0.3, 0.1], [0.86, 0, -0.64, -0.74, -0.12, 0.04]]
      : [[0.6, aspect - 0.6, -0.86, -0.82, -0.38, 0.14], [0.9, 0.42, -0.68, -0.74, -0.22, 0.07]]
    const pose = (i: number) => THREE.MathUtils.lerp(rest[i], up[i], raise)
    pad.scale.setScalar(THREE.MathUtils.lerp(pose(0), big, draw))
    pad.position.set(THREE.MathUtils.lerp(pose(1), 0, draw), THREE.MathUtils.lerp(pose(2) + lift * 0.1, -0.98 + big * 0.36, draw) + breathe, 0)
    pad.rotation.set(THREE.MathUtils.lerp(pose(3) + lift * 0.12, -0.1, draw), pose(4) * (1 - draw), THREE.MathUtils.lerp(pose(5), 0, draw))
    // In the bottom left corner; on a phone smaller and tucked to the edge, above the sound buttons.
    const jx = narrow ? -aspect + 0.15 : -aspect + 0.3
    hover += ((entries.hovered === hooks.journal ? 1 : 0) - hover) * (1 - Math.exp(-dt * 10))
    // On a phone it stands clear above the sound buttons in the corner (#42 paper climb: it sat on them).
    journal.position.set(jx, (narrow ? -0.64 : -0.8) + hover * 0.06, 0.02)
    journal.scale.setScalar((narrow ? 0.42 : 0.55) + hover * 0.04)
    // The real button sits over the felt journal on screen.
    journal.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(cover)
    const a = box.min.clone().project(camera), b = box.max.clone().project(camera)
    const r = stage.renderer.domElement.getBoundingClientRect()
    const x0 = r.left + ((Math.min(a.x, b.x) + 1) / 2) * r.width, x1 = r.left + ((Math.max(a.x, b.x) + 1) / 2) * r.width
    const y0 = r.top + ((1 - Math.max(a.y, b.y)) / 2) * r.height, y1 = r.top + ((1 - Math.min(a.y, b.y)) / 2) * r.height
    journalButton.style.left = `${x0}px`
    journalButton.style.top = `${y0}px`
    journalButton.style.width = `${Math.max(24, x1 - x0)}px`
    journalButton.style.height = `${Math.max(24, Math.min(innerHeight, y1) - y0)}px`
    journalButton.hidden = away

    if (hooks.variant === 'held') {
      const p = screenBox(sheet)
      padRect = { left: p.x0, top: p.y0, width: p.x1 - p.x0, height: Math.max(0, p.y1 - p.y0) }
      padButton.style.left = `${p.x0}px`
      padButton.style.top = `${p.y0}px`
      padButton.style.width = `${Math.max(24, p.x1 - p.x0)}px`
      padButton.style.height = `${Math.max(24, p.y1 - p.y0)}px`
      padButton.hidden = away || document.activeElement === field || sketching
    }

    blink += dt
    if (blink > 0.55) {
      blink = 0
      caretOn = !caretOn
      if (hooks.variant === 'held') dirty = true
    }
    const to = hooks.addressee()
    if (to.label !== shownTo) {
      shownTo = to.label
      dirty = true
    }
    if (dirty) {
      dirty = false
      if (hooks.variant === 'held') {
        paintPad()
        paperTex.needsUpdate = true
      } else paintSpeech()
    }
    caret.classList.toggle('on', caretOn)
    sent += dt
    if (tornFresh && sent >= 0.45) {
      tornFresh = false
      dirty = true
    }

    // The torn note: up off the pad, then a curve to the reader's paws (or down onto the table).
    if (flight) {
      flight.t += dt / 1.7
      // First the note lifts off the pad and turns to face its way, then it flies.
      const lifted = Math.min(1, flight.t / 0.28)
      const k = Math.max(0, Math.min(1, (flight.t - 0.34) / 0.66))
      flight.from.decompose(tmp, q, scl)
      const start = tmp.clone()
      // Follows the reader if it moves while the note is on its way.
      const end = flight.holder ? flight.holder.localToWorld(flight.to.copy(flight.local)) : flight.to
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
      // Even across the screen, not across the room: moving evenly in the world, a note that starts half a metre
      // from the camera covers most of the screen in its first moments and seems to have arrived by 0.8 s
      // (#42 paper climb). Weighting by inverse distance makes its screen path even, so it is seen in the air.
      camera.getWorldPosition(camAt)
      const near = 1 / Math.max(0.2, start.distanceTo(camAt)), far = 1 / Math.max(0.2, end.distanceTo(camAt))
      const s = THREE.MathUtils.smoothstep(k, 0, 1)
      const e = (s * far) / ((1 - s) * near + s * far)
      const pos = start.clone().addScaledVector(up, 0.05 * lifted).lerp(end, e)
      // Its arc is the same height on screen all the way: in metres it grows with its distance from the camera
      // (a fixed 0.3 m arc lifted it out of the top of the frame while it was still near).
      pos.y += Math.sin(k * Math.PI) * 0.07 * pos.distanceTo(camAt)
      flyer.matrixAutoUpdate = true
      flyer.position.copy(pos)
      // It arrives turned to be read: held up toward you, or flat on the table with its words your way.
      const goal = landing(flight.holder, end)
      // It flutters as paper does, rocking and tipping, and settles as it lands.
      const sway = Math.sin(k * 11) * 0.22 * (1 - k)
      flyer.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5 * lifted + Math.sin(k * 7 + 1) * 0.25 * (1 - k), sway * 0.6, sway))).slerp(goal, THREE.MathUtils.smoothstep(k, 0.45, 1))
      // Half its size by the time it has folded and lifted; then its size on screen eases to its size where it
      // lands, so it is never a speck on the way (#42 paper climb: growing evenly in the world, it was).
      const away = pos.distanceTo(camAt)
      const ratio = THREE.MathUtils.lerp((scl.x * THREE.MathUtils.lerp(1, 0.7, lifted)) / Math.max(0.2, start.distanceTo(camAt)), flight.size / Math.max(0.2, end.distanceTo(camAt)), s)
      flyer.scale.setScalar(ratio * away)
      // Folded once while it lifts, the right third over, so the words still show on its way.
      hinge.rotation.y = -Math.PI * 0.985 * THREE.MathUtils.smoothstep(flight.t, 0.04, 0.22)
      flyMat.opacity = backMat.opacity = 1
      flyer.visible = true
      if (flight.t >= 1) {
        held = { holder: flight.holder, local: flight.local.clone(), t: 0, opening: -1, size: flight.size }
        flight = null
        dirty = true
        land()
      }
    } else if (held) {
      // Held in the reader's paws (it follows them as they turn and hop), or lying on the table, until it opens.
      held.t += dt
      const at = held.holder ? held.holder.localToWorld(tmp.copy(held.local)) : tmp.copy(held.local)
      flyer.position.copy(at).y += held.holder ? Math.sin(held.t * 2.2) * 0.004 : 0
      flyer.quaternion.slerp(landing(held.holder, at), 1 - Math.exp(-dt * 6))
      flyer.scale.setScalar(held.size)
      // Nobody opened it (the reader is away): it opens by itself after a while.
      if (held.opening < 0 && held.t > 8) held.opening = 0
      if (held.opening >= 0) {
        held.opening += dt
        // It unfolds, then gives way to the slip it opens into.
        hinge.rotation.y = -Math.PI * 0.985 * (1 - THREE.MathUtils.smoothstep(held.opening, 0, 0.22))
        flyMat.opacity = backMat.opacity = 1 - THREE.MathUtils.smoothstep(held.opening, 0.12, 0.34)
        if (held.opening > 0.34) {
          held = null
          flyer.visible = false
        }
      }
    }
  }
  const camAt = new THREE.Vector3()
  const toCam = new THREE.Vector3()
  /** How a landed note turns: held up toward you, leaning back a little; or flat on the table, its words toward you. */
  const landing = (holder: THREE.Object3D | null, at: THREE.Vector3) => {
    camera.getWorldPosition(camAt)
    toCam.copy(camAt).sub(at)
    const yaw = Math.atan2(toCam.x, toCam.z)
    return new THREE.Quaternion().setFromEuler(holder ? new THREE.Euler(-0.25, yaw, 0, 'YXZ') : new THREE.Euler(-Math.PI / 2, yaw, 0, 'YXZ'))
  }

  const dispose = () => {
    land()
    held = null
    vv?.removeEventListener('resize', placeField)
    vv?.removeEventListener('scroll', placeField)
    field.remove()
    padButton.remove()
    speech.remove()
    journalButton.remove()
    hint.remove()
    style.remove()
    for (const o of document.querySelectorAll('.talk-mine.flying')) o.remove()
    hud.removeFromParent()
    flyer.removeFromParent()
    releaseGpu(hud)
    releaseGpu(flyer)
  }

  return {
    frame,
    dispose,
    focus: () => field.focus({ preventScroll: true }),
    key,
    /** A sent note is on its way; `landed()` resolves when it arrives (at once when none is). */
    get flying() {
      return flight !== null
    },
    landed: () => (flight ? new Promise<void>((done) => landings.push(done)) : Promise.resolve()),
    /** The landed note, held in the reader's paws or lying on the table, not yet opened. */
    get holding() {
      return held !== null && held.opening < 0
    },
    /** Whose paws the note in flight is going to (none: the table, or nothing in flight). */
    flyingTo: () => flight?.holder ?? null,
    /** Whose paws hold the landed note (none: it lies on the table). */
    heldBy: () => held?.holder ?? null,
    /** Where the landed note is on screen (its middle and width, CSS pixels), to open the slip from. */
    heldAt: () => {
      if (!held || !flyer.visible) return null
      const p = screenBox(flat)
      return { x: (p.x0 + p.x1) / 2, y: (p.y0 + p.y1) / 2, w: p.x1 - p.x0 }
    },
    /** The landed note opens: it unfolds and gives way to the slip it opens into. */
    release: () => {
      if (held && held.opening < 0) held.opening = 0
    },
    /** Words are being written, so navigation keys are for the line, not the room. */
    get writing() {
      return writing()
    },
    padRect: () => ({ ...padRect }),
    /** Sketching (#42, sketch.ts): the pad's paper, to draw on. */
    parts: () => ({ pad, PADW, PADH }),
    /** Sketching (#42): grow the pad to drawing size (or settle it back); `hint` is pencilled on an empty page. */
    setSketching: (on: boolean, hint = '') => {
      if (sketching !== on || sketchHint !== hint) dirty = true
      sketching = on
      sketchHint = hint
    },
    /** Sketching (#42): the words went with the page; the pad is fresh. */
    clearText: () => {
      field.value = ''
      onInput()
    },
    get text() {
      return text
    },
    /** Put a line back after it could not be sent. */
    restore: (line: string) => {
      field.value = line
      onInput()
    },
    state: () => ({ variant: hooks.variant, text, to: hooks.addressee().label, flying: Boolean(flight) || document.querySelector('.talk-mine.flying') !== null, holding: held !== null && held.opening < 0, speechShown: speech.classList.contains('shown'), padVisible: pad.visible && hud.visible, focused: document.activeElement === field, sentAgo: sent, raise, padScale: pad.scale.x }),
    /** The journal button's place on screen, for the checks. */
    journalRect: () => journalButton.getBoundingClientRect().toJSON(),
  }
}

function css() {
  const paper = `radial-gradient(120% 90% at 20% 0%, #fffaf0 0%, #fbf1dd 55%, #f3e3c4 100%)`
  return `
  .talk-input-field { position: fixed; left: -9999px; top: 0; width: 200px; opacity: 0; }
  /* Touch: the same field as a real line of paper just above the keyboard, at least 44 px tall. */
  .talk-input-field.touch { left: 12px; right: 12px; top: auto; bottom: 0; width: auto; opacity: 1; z-index: 6; box-sizing: border-box; min-height: 48px; margin-bottom: 8px;
    padding: 10px 14px; border: 0; border-radius: 12px; outline: none; background: #fbf3e1; color: ${INK}; font: 18px/1.3 ${BOOK};
    box-shadow: 0 6px 18px rgba(60, 30, 10, 0.28), inset 0 0 0 1.5px rgba(150, 100, 60, 0.35); }
  .talk-input-field.touch::placeholder { color: rgba(70, 50, 36, 0.55); font-style: italic; }
  .talk-input-hint { position: fixed; z-index: 4; left: 50%; bottom: 30px; translate: -50% 0; pointer-events: none; opacity: 0; transition: opacity 400ms ease;
    font: italic 22px ${HAND}; color: #fff8ec; text-shadow: 0 1px 2px rgba(60, 30, 10, 0.6), 0 0 14px rgba(60, 30, 10, 0.4); white-space: nowrap; }
  .talk-input-hint.shown { opacity: 0.92; }
  .talk-journal { position: fixed; z-index: 5; padding: 0; border: 0; background: none; cursor: pointer; border-radius: 10px; }
  .talk-journal:focus-visible { outline: 3px solid rgba(255, 236, 200, 0.9); outline-offset: 2px; }
  .talk-pad { position: fixed; z-index: 4; padding: 0; border: 0; background: none; cursor: text; border-radius: 8px; }
  .talk-pad:focus-visible { outline: 3px solid rgba(255, 236, 200, 0.9); outline-offset: 2px; }
  .talk-pad[hidden] { display: none; }
  .talk-mine { position: fixed; z-index: 5; left: 50%; bottom: 26px; box-sizing: border-box; width: fit-content; min-width: 220px; max-width: min(520px, calc(100vw - 32px));
    padding: 22px 24px 16px; border-radius: 16px; color: #23395a; background: ${paper};
    box-shadow: 0 12px 28px rgba(30, 40, 70, 0.26), 0 2px 0 rgba(255, 255, 255, 0.7) inset, 0 -3px 0 rgba(60, 90, 138, 0.14) inset;
    opacity: 0; translate: -50% 24px; scale: 0.96; pointer-events: none;
    transition: opacity 200ms ease, translate 260ms cubic-bezier(.2, 1.3, .4, 1), scale 260ms ease; }
  .talk-mine::before { content: ''; position: absolute; inset: 7px; border: 2px dashed rgba(60, 90, 138, 0.32); border-radius: 11px; pointer-events: none; }
  .talk-mine.shown { opacity: 1; translate: -50% 0; scale: 1; }
  .talk-mine.flying { transition: translate 650ms cubic-bezier(.5, 0, .3, 1), scale 650ms ease-in, opacity 650ms cubic-bezier(.7, 0, 1, 1); }
  .talk-mine.flying.go { translate: calc(-50% + var(--fly-x, 0px)) var(--fly-y, -200px); scale: 0.22; opacity: 0; }
  .talk-mine .mine-tab { position: absolute; left: 18px; top: -19px; padding: 3px 14px 5px; border-radius: 11px 11px 5px 5px;
    background: ${MINE}; color: #fffaf0; font: 700 19px/1.15 ${HAND}; box-shadow: 0 4px 10px rgba(30, 40, 70, 0.25); }
  .talk-mine .mine-tab::after { content: ''; position: absolute; inset: 3px; border: 1.5px dashed rgba(255, 248, 236, 0.6); border-radius: 8px 8px 3px 3px; }
  .talk-mine .mine-to { position: absolute; right: 20px; top: -15px; padding: 2px 12px 3px; border-radius: 9px; background: #fffaf0;
    color: color-mix(in oklab, var(--c, #8a6a48) 85%, #2a1608); font: italic 700 17px ${HAND};
    box-shadow: 0 2px 6px rgba(60, 30, 10, 0.14), inset 0 0 0 1.5px color-mix(in oklab, var(--c, #8a6a48) 50%, transparent); }
  .talk-mine .mine-words { margin: 0; white-space: pre-wrap; font: 21px/1.4 ${BOOK}; }
  .talk-mine .mine-caret { display: inline-block; width: 2px; height: 1.05em; margin-left: 2px; vertical-align: -0.15em; background: #23395a; opacity: 0; }
  .talk-mine .mine-caret.on { opacity: 0.8; }
  @media (prefers-reduced-motion: reduce) { .talk-mine { transition: none; } }
  `
}

export type AlwaysOn = ReturnType<typeof alwaysOn>
