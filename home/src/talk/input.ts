// The always-on input (#42 prototype), behind ?talk=npc&input=held|speech.
// A keypress anywhere starts writing; Enter sends the line on its way to whoever
// it is addressed to (your own villager unless you have turned to someone else).
//
//   held    your own small notepad, held at the bottom of the view like a hand in
//           a game: a real 3D object riding with the camera, lit by the room.
//           Your words are written on it in your ink; Enter tears the note off and
//           it flies to its recipient.
//   speech  no box at all until you type: your words rise from the bottom centre
//           as your own speech card, kin to the villagers' cards but clearly yours.
//
// Both keep a tiny felt journal beside the input: one click (or J) opens the journal.
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { releaseGpu, type Stage } from '../kernel'
import type { Entries } from '../plugins/entries'
import { canvas, paintLinen, toTexture } from '../paint'

export type Variant = 'held' | 'speech'
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
  /** Where a sent line flies: the recipient's head, in world space. */
  target(): THREE.Vector3 | null
  /** Enter, with the time it was pressed. */
  submit(text: string, t0: number): void
  /** Something else has the keyboard (the open journal): the input stays out of the way. */
  blocked(): boolean
  /** The journal entry's id, chosen by the felt book or J. */
  journal: string
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
  const paperMat = new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.92, emissive: '#ffffff', emissiveMap: paperTex, emissiveIntensity: 0.32 })
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
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.34, 0.12, 4, 0.06), mitten)
  palm.position.set(-PADW / 2 - 0.02, -0.12, -0.07)
  palm.rotation.z = 0.25
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.12, 6, 12), mitten)
  thumb.position.set(-PADW / 2 + 0.06, -0.06, 0.03)
  thumb.rotation.z = -0.9
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.12, 20), new THREE.MeshStandardMaterial({ color: '#e7dcc6', roughness: 1 }))
  cuff.position.set(-PADW / 2 - 0.1, -0.33, -0.07)
  cuff.rotation.z = 0.25
  pad.add(back, stack, sheet, binding, palm, thumb, cuff)
  pad.visible = hooks.variant === 'held'
  hud.add(mark(pad))

  // The torn note on its way.
  const flyMat = new THREE.MeshStandardMaterial({ roughness: 0.92, transparent: true, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0.3 })
  const flyer = new THREE.Mesh(new THREE.PlaneGeometry(PADW, PADH * 0.62), flyMat)
  flyer.name = 'talk note in flight'
  flyer.visible = false
  scene.add(mark(flyer))
  let flight: { t: number; from: THREE.Matrix4; to: THREE.Vector3 } | null = null

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
  tab.textContent = 'You'
  document.body.append(speech)
  const journalButton = document.createElement('button')
  journalButton.type = 'button'
  journalButton.className = 'talk-journal'
  journalButton.setAttribute('aria-label', 'Open the journal (J)')
  journalButton.title = 'Journal (J)'
  document.body.append(journalButton)

  // ── Writing ──────────────────────────────────────────────────────────────
  let text = ''
  let shownTo = ''
  let dirty = true
  let caretOn = true
  let blink = 0
  /** Seconds since the last send, for the "sent" beat on the card. */
  let sent = 99
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
    // To whom, in their colour, top right like the address on a note.
    const to = hooks.addressee()
    g.font = `italic 44px ${HAND}`
    g.textAlign = 'right'
    g.fillStyle = 'rgba(70, 50, 36, 0.7)'
    const name = to.label
    g.font = `700 58px ${HAND}`
    const nameW = g.measureText(name).width
    g.font = `italic 44px ${HAND}`
    g.fillText('to ', PW - 60 - nameW, 92)
    g.font = `700 58px ${HAND}`
    g.fillStyle = to.colour
    g.fillText(name, PW - 60, 92)
    g.textAlign = 'left'
    g.font = `64px ${HAND}`
    if (!text) {
      g.fillStyle = 'rgba(70, 50, 36, 0.42)'
      g.font = `italic 50px ${HAND}`
      g.fillText('just start typing…', 120, 180)
      if (caretOn) {
        g.fillStyle = INK
        g.fillRect(118, 130, 4, 58)
      }
      return
    }
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

  const start = (e: KeyboardEvent) => {
    if (hooks.blocked()) return
    const t = e.target as HTMLElement | null
    if (t && t !== field && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
    if (document.activeElement === field) return
    // J (lowercase, nothing written yet) opens the journal; a capital J still starts a line.
    if (e.key === 'j' && !text) {
      e.preventDefault()
      openJournal()
      return
    }
    if (e.key === ' ') return
    e.preventDefault()
    field.focus({ preventScroll: true })
    field.value += e.key
    onInput()
  }
  const onInput = () => {
    text = field.value
    caretOn = true
    blink = 0
    dirty = true
  }
  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      const line = field.value.trim()
      if (!line) return
      const t0 = performance.now()
      send()
      hooks.submit(line, t0)
    } else if (e.key === 'Escape') {
      // Escape clears the line first; with nothing written it goes on to the room.
      if (field.value) {
        e.preventDefault()
        e.stopPropagation()
        field.value = ''
        onInput()
      } else field.blur()
    }
  }
  /** The note leaves: the pad tears it off and it flies to the recipient; the speech card rises toward them. */
  const send = () => {
    sent = 0
    const target = hooks.target()
    if (hooks.variant === 'held') {
      paintPad()
      flyMat.map?.dispose()
      const [c, g] = canvas(PW, Math.round(PH * 0.62))
      g.drawImage(paperCanvas, 0, 0, PW, PH * 0.62, 0, 0, PW, PH * 0.62)
      flyMat.map = toTexture(c)
      flyMat.emissiveMap = flyMat.map
      flyMat.needsUpdate = true
      sheet.updateWorldMatrix(true, false)
      flyer.matrixWorld.copy(sheet.matrixWorld)
      if (target && !reducedMotion.matches) flight = { t: 0, from: sheet.matrixWorld.clone(), to: target.clone() }
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
    field.value = ''
    onInput()
  }

  const openJournal = () => {
    field.blur()
    entries.choose(hooks.journal)
  }
  journalButton.addEventListener('click', openJournal)
  field.addEventListener('input', onInput)
  field.addEventListener('keydown', onFieldKey)
  addEventListener('keydown', start, true)

  // ── Each frame: ride with the camera, paint, fly ─────────────────────────
  const fwd = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const tmp = new THREE.Vector3()
  const scl = new THREE.Vector3()
  let hover = 0
  let lift = 0
  const frame = (dt: number, t: number) => {
    const away = hooks.blocked()
    hud.visible = !away
    if (away) speech.classList.remove('shown')
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
    // Breathing, as a held thing does, and a lift while you write.
    lift += ((text ? 1 : 0) - lift) * (1 - Math.exp(-dt * 6))
    const breathe = reducedMotion.matches ? 0 : Math.sin(t * 1.3) * 0.006
    pad.position.set(0.05, -0.93 + lift * 0.1 + breathe, 0)
    pad.rotation.set(-0.62 + lift * 0.12, 0.02, 0.03)
    const jx = -aspect + 0.3
    hover += ((entries.hovered === hooks.journal ? 1 : 0) - hover) * (1 - Math.exp(-dt * 10))
    journal.position.set(jx, -0.8 + hover * 0.06, 0.02)
    journal.scale.setScalar(0.55 + hover * 0.04)
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

    // The torn note: up off the pad, then a curve to the recipient, shrinking as it goes.
    if (flight) {
      flight.t += dt / 0.8
      const k = Math.min(1, flight.t)
      flight.from.decompose(tmp, q, scl)
      const start = tmp.clone()
      const end = flight.to
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
      const e = 1 - (1 - k) ** 2
      const pos = start.clone().lerp(end, e).addScaledVector(up, Math.sin(k * Math.PI) * 0.25)
      flyer.matrixAutoUpdate = true
      flyer.position.copy(pos)
      flyer.quaternion.copy(q)
      flyer.rotateZ(Math.sin(k * 9) * 0.18 * (1 - k))
      flyer.rotateX(-k * 0.8)
      flyer.scale.copy(scl).multiplyScalar(1 - 0.85 * e)
      flyMat.opacity = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25
      flyer.visible = true
      if (k >= 1) {
        flight = null
        flyer.visible = false
      }
    }
  }

  const dispose = () => {
    removeEventListener('keydown', start, true)
    field.remove()
    speech.remove()
    journalButton.remove()
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
    get text() {
      return text
    },
    /** Put a line back after it could not be sent. */
    restore: (line: string) => {
      field.value = line
      onInput()
    },
    state: () => ({ variant: hooks.variant, text, to: hooks.addressee().label, flying: Boolean(flight) || document.querySelector('.talk-mine.flying') !== null, speechShown: speech.classList.contains('shown'), padVisible: pad.visible && hud.visible, focused: document.activeElement === field, sentAgo: sent }),
    /** The journal button's place on screen, for the checks. */
    journalRect: () => journalButton.getBoundingClientRect().toJSON(),
  }
}

function css() {
  const paper = `radial-gradient(120% 90% at 20% 0%, #fffaf0 0%, #fbf1dd 55%, #f3e3c4 100%)`
  return `
  .talk-input-field { position: fixed; left: -9999px; top: 0; width: 200px; opacity: 0; }
  .talk-journal { position: fixed; z-index: 5; padding: 0; border: 0; background: none; cursor: pointer; border-radius: 10px; }
  .talk-journal:focus-visible { outline: 3px solid rgba(255, 236, 200, 0.9); outline-offset: 2px; }
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
