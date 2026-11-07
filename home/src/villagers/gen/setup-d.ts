// #47 regroup 2, strategy D: a real fitting mirror in the room. A cheval mirror stands at the
// table's left end, sized like a dressing-table mirror for a villager (about 0.9 m to its finials),
// with a felt fitting box in front of it; the villager stands on the box, facing you, its back in the
// glass. The controls are parts of the furniture, laid over their faces each frame from the camera:
// a tape measure up the frame's left rail (its brass marker rides the villager's head), felt colour
// dots pinned down the right rail, three dials on the box's top drawer, the three manner ribbons tied
// across its lower drawer with the jokes switch under them. Before there is a villager the pattern
// swatches are tucked into the glass. The kitchen stays round it on a wide screen or a tablet; a phone
// comes close, so the mirror fills the width.
import * as THREE from 'three/webgpu'
import { reflector, vec3 } from 'three/tsl'
import { feltTexture } from '../kinds'
import { SCALE } from '../../plugins/villagers'
import { HAND, TOP } from './workshop'
import type { Key } from './sliders'
import type { Rect, Scene, Strategy } from './setup-strategy'
import { footFor } from './setup-rack'
import { sizeAt } from './setup-b'

const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
/** Where the mirror stands: the table's left end, square to the room. */
const AT = new THREE.Vector3(-0.86, TOP, 0.06)
/** Its measures (metres, in its own space: x across, y up from the table, z toward the room). */
const M = { w: 0.46, bottom: 0.2, top: 0.83, rail: 0.045, post: 0.25, box: { w: 0.44, h: 0.27, d: 0.22, z: 0.16, split: 0.148 } }
const RIBBON: Record<'warmth' | 'playful' | 'chatty', { ground: string; ends: [string, string] }> = {
  warmth: { ground: '#c4553f', ends: ['blunt', 'warm'] },
  playful: { ground: '#d6b45c', ends: ['serious', 'playful'] },
  chatty: { ground: '#6f86a8', ends: ['brief', 'chatty'] },
}
const DIAL: Record<'pitch' | 'pace' | 'energy', { ends: [string, string] }> = {
  pitch: { ends: ['low', 'high'] },
  pace: { ends: ['slow', 'quick'] },
  energy: { ends: ['calm', 'lively'] },
}

function furniture(quality: string) {
  const g = new THREE.Group()
  g.name = 'workshop mirror'
  g.position.copy(AT)
  const wood = new THREE.MeshStandardMaterial({ color: '#b07a45', roughness: 0.5 })
  const dark = new THREE.MeshStandardMaterial({ color: '#7d5230', roughness: 0.6 })
  const brass = new THREE.MeshStandardMaterial({ color: '#d2aa58', roughness: 0.32, metalness: 0.85 })
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
    b.position.set(x, y, z)
    b.castShadow = b.receiveShadow = true
    g.add(b)
    return b
  }
  // The stand: two posts on splayed feet, brass finials, a stretcher low between them.
  for (const s of [-1, 1]) {
    box(0.026, 0.86, 0.026, wood, s * M.post, 0.43, -0.02)
    box(0.04, 0.022, 0.24, dark, s * M.post, 0.011, -0.03)
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 12), brass)
    ball.position.set(s * M.post, 0.875, -0.02)
    g.add(ball)
    // The pivot's brass boss, where the frame swings.
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 16), brass)
    boss.rotation.z = Math.PI / 2
    boss.position.set(s * (M.post - 0.02), 0.52, -0.02)
    g.add(boss)
  }
  box(M.post * 2, 0.02, 0.02, dark, 0, 0.1, -0.03)
  // The frame: four rails round the glass, swung forward on its pivots so the glass shows the table and the floor
  // (the room's open side, behind the camera, is empty and would read as a dark glass).
  const frame = new THREE.Group()
  frame.position.set(0, 0.52, -0.02)
  frame.rotation.x = 0.16
  g.add(frame)
  const h = M.top - M.bottom, cy = (M.top + M.bottom) / 2 - 0.52
  const rail = (w: number, hh: number, x: number, y: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, 0.03), wood)
    b.position.set(x, y, 0)
    b.castShadow = true
    frame.add(b)
  }
  rail(M.rail, h, -(M.w - M.rail) / 2, cy)
  rail(M.rail, h, (M.w - M.rail) / 2, cy)
  rail(M.w, M.rail, 0, M.top - 0.52 - M.rail / 2)
  rail(M.w, M.rail, 0, M.bottom - 0.52 + M.rail / 2)
  const back = new THREE.Mesh(new THREE.BoxGeometry(M.w - 0.01, h - 0.01, 0.01), dark)
  back.position.set(0, cy, -0.012)
  frame.add(back)
  // The glass: a real reflection. A villager is small in a mirror this size, so a third of the screen's resolution is
  // enough on the low tier.
  const gw = M.w - M.rail * 2, gh = h - M.rail * 2
  const mirrorNode = reflector({ resolutionScale: quality === 'low' ? 0.35 : 0.5 })
  const glassMat = new THREE.MeshBasicNodeMaterial()
  // Silvered glass: a little warm and a little darker than the room.
  glassMat.colorNode = mirrorNode.mul(vec3(0.78, 0.76, 0.72)).add(vec3(0.16, 0.15, 0.13))
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), glassMat)
  glass.add(mirrorNode.target)
  glass.position.set(0, cy, 0.0)
  frame.add(glass)
  // The fitting box: felt over wood, two drawers' worth of front, a round felt pad on top to stand on.
  const B = M.box
  const feltTex = feltTexture('#56785f', 11, { band: false })
  feltTex.wrapS = feltTex.wrapT = THREE.RepeatWrapping
  feltTex.repeat.set(1.6, 1)
  const felt = new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.95 })
  const body = box(B.w, B.h, B.d, felt, 0, B.h / 2, B.z)
  void body
  box(B.w + 0.012, 0.012, B.d + 0.012, wood, 0, B.h, B.z)
  box(B.w + 0.006, 0.008, 0.006, wood, 0, B.split, B.z + B.d / 2 + 0.002)
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.125, 0.012, 40), new THREE.MeshStandardMaterial({ color: '#b6533f', roughness: 0.95 }))
  pad.position.set(0, B.h + 0.012, B.z - 0.035)
  pad.receiveShadow = true
  g.add(pad)
  return {
    group: g,
    frame,
    glass,
    dispose() {
      g.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) mesh.geometry.dispose()
      })
      for (const m of [wood, dark, brass, felt, pad.material as THREE.Material, glass.material as THREE.Material]) m.dispose()
      feltTex.dispose()
      mirrorNode.dispose()
    },
  }
}

export function fitting(scene: Scene): Strategy {
  const { tools, patterns, stage } = scene
  const room = furniture(stage.quality)
  scene.group.add(room.group)

  const el = (tag: string, cls: string, parent?: HTMLElement) => {
    const e = document.createElement(tag)
    e.className = cls
    parent?.append(e)
    return e
  }
  const root = el('div', 'vs-fit')
  /** One layer per face of the furniture; each is laid over its face every frame. */
  const face = (name: string) => el('div', `face ${name}`, root)
  const leftRail = face('left'), rightRail = face('right'), drawer = face('drawer'), lower = face('lower'), glassFace = face('glass')
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  document.body.append(root)

  let lineTimer = 0
  const changed = () => {
    clearTimeout(lineTimer)
    lineTimer = window.setTimeout(() => scene.tuned(), 380)
  }
  const slider = (e: HTMLElement, key: Key, label: string) => {
    e.tabIndex = 0
    e.setAttribute('role', 'slider')
    e.setAttribute('aria-label', label)
    e.setAttribute('aria-valuemin', '0')
    e.setAttribute('aria-valuemax', '100')
    e.dataset.key = key
    e.addEventListener('keydown', (ev) => {
      const step = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05, PageUp: 0.2, PageDown: -0.2 }[ev.key]
      const v = step !== undefined ? tools.values[key] + step : ev.key === 'Home' ? 0 : ev.key === 'End' ? 1 : null
      if (v === null) return
      ev.preventDefault()
      tools.set(key, Math.min(1, Math.max(0, v)))
      changed()
    })
  }
  const drag = (e: HTMLElement, key: Key, to: (ev: PointerEvent, from: { x: number; y: number; v: number }) => number) => {
    e.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return
      ev.preventDefault()
      e.focus({ preventScroll: true })
      e.setPointerCapture(ev.pointerId)
      const from = { x: ev.clientX, y: ev.clientY, v: tools.values[key] }
      tools.set(key, Math.min(1, Math.max(0, to(ev, from))))
      const move = (m: PointerEvent) => tools.set(key, Math.min(1, Math.max(0, to(m, from))))
      const up = () => {
        e.removeEventListener('pointermove', move)
        e.removeEventListener('pointerup', up)
        e.removeEventListener('pointercancel', up)
        changed()
      }
      e.addEventListener('pointermove', move)
      e.addEventListener('pointerup', up)
      e.addEventListener('pointercancel', up)
    })
  }

  // ── The frame's left rail: the tape measure; its marker rides the villager's head ──
  const tape = el('div', 'tape', leftRail)
  const marker = el('div', 'marker', tape)
  el('b', 'tag', leftRail).textContent = 'height'
  slider(marker, 'size', 'Height: drag the marker to their head')
  drag(tape, 'size', (ev) => sizeAt(scene, ev.clientY))

  // ── The right rail: felt colour dots, pinned down it ──
  const colours = el('div', 'colours', rightRail)
  colours.setAttribute('role', 'radiogroup')
  colours.setAttribute('aria-label', 'Felt colour')
  el('b', 'tag', rightRail).textContent = 'colour'
  const dots = Array.from({ length: 7 }, (_, i) => {
    const d = el('button', 'dot', colours) as HTMLButtonElement
    d.type = 'button'
    d.setAttribute('role', 'radio')
    d.setAttribute('aria-label', i === 3 ? 'Colour as made' : `Colour turned ${i < 3 ? 'one way' : 'the other way'}, ${Math.abs(i - 3)} of 3`)
    d.dataset.key = 'hue'
    d.addEventListener('click', () => {
      tools.set('hue', i / 6)
      changed()
    })
    return d
  })

  // ── The box's top drawer: three dials ──
  const knobs = (Object.keys(DIAL) as (keyof typeof DIAL)[]).map((key) => {
    const box = el('div', 'dial', drawer)
    box.dataset.key = key
    el('b', 'dial-name', box).textContent = key
    const knob = el('div', 'knob', box)
    el('i', 'notch', knob)
    const ends = el('div', 'dial-ends', box)
    el('span', '', ends).textContent = DIAL[key].ends[0]
    el('span', '', ends).textContent = DIAL[key].ends[1]
    slider(knob, key, `${key}, a dial from ${DIAL[key].ends[0]} to ${DIAL[key].ends[1]}`)
    drag(knob, key, (ev, from) => from.v + ((ev.clientX - from.x) - (ev.clientY - from.y)) / 160)
    return { key, knob }
  })

  // ── The lower drawer: the manner ribbons tied across it, the jokes switch under them ──
  const ribbons = (Object.keys(RIBBON) as (keyof typeof RIBBON)[]).map((key) => {
    const row = el('div', 'ribbon-row', lower)
    row.dataset.key = key
    el('span', 'end', row).textContent = RIBBON[key].ends[0]
    const strip = el('div', 'ribbon', row)
    strip.style.setProperty('--ground', RIBBON[key].ground)
    const button = el('i', 'button', strip)
    el('span', 'end', row).textContent = RIBBON[key].ends[1]
    slider(strip, key, `${RIBBON[key].ends[0]} to ${RIBBON[key].ends[1]}, a ribbon`)
    drag(strip, key, (ev) => {
      const r = strip.getBoundingClientRect()
      return (ev.clientX - r.left) / r.width
    })
    return { key, strip, button }
  })
  const jokes = el('div', 'jokes', lower)
  el('b', 'jokes-name', jokes).textContent = 'jokes'
  jokes.setAttribute('role', 'radiogroup')
  jokes.setAttribute('aria-label', 'Jokes')
  const steps = (['clean', 'cheeky', 'crude'] as const).map((word, i) => {
    const b = el('button', 'step', jokes) as HTMLButtonElement
    b.type = 'button'
    b.setAttribute('role', 'radio')
    b.textContent = word
    b.dataset.key = 'humour'
    b.addEventListener('click', () => {
      tools.set('humour', i / 2)
      changed()
    })
    return b
  })

  // ── In the glass, before there is a villager: the pattern swatches, tucked into the frame ──
  const hang = el('div', 'hang', glassFace)
  let shown = ''
  const drawSwatches = () => {
    const cards = scene.cards()
    const sig = cards.map((c) => c.template.id).join(',') + `|${patterns.picked?.template.id}`
    if (sig === shown) return
    shown = sig
    hang.textContent = ''
    for (const card of cards) {
      const b = el('button', 'vs-swatch', hang) as HTMLButtonElement
      b.type = 'button'
      b.dataset.template = card.template.id
      b.style.setProperty('--felt', patterns.feltOf(card))
      b.setAttribute('aria-pressed', String(patterns.picked?.template.id === card.template.id))
      el('b', '', b).textContent = card.template.name
      const foot = footFor(card)
      if (foot) el('small', '', b).textContent = foot
      b.addEventListener('click', () => patterns.pick(patterns.picked?.template.id === card.template.id ? null : card))
    }
  }

  // ── Projection: the furniture's faces on the page ──
  const v = new THREE.Vector3()
  /** A face of the furniture (corners in its own space) as a page rectangle through a camera. */
  const rectOf = (pts: [number, number, number][], cam: THREE.Camera, obj: THREE.Object3D = room.group): Rect => {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    obj.updateMatrixWorld(true)
    for (const p of pts) {
      v.set(...p).applyMatrix4(obj.matrixWorld).project(cam)
      const x = ((v.x + 1) / 2) * innerWidth, y = ((1 - v.y) / 2) * innerHeight
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    return { left, top, right, bottom }
  }
  const quad = (x0: number, x1: number, y0: number, y1: number, z: number): [number, number, number][] => [[x0, y0, z], [x1, y0, z], [x0, y1, z], [x1, y1, z]]
  const B = M.box
  // The frame's faces are in the tilted frame's space (its middle at the pivot).
  const fy = (y: number) => y - 0.52
  const FACES = {
    left: () => rectOf(quad(-M.w / 2, -M.w / 2 + M.rail, fy(M.bottom), fy(M.top), 0.016), stage.camera, room.frame),
    right: () => rectOf(quad(M.w / 2 - M.rail, M.w / 2, fy(M.bottom), fy(M.top), 0.016), stage.camera, room.frame),
    glass: () => rectOf(quad(-M.w / 2 + M.rail, M.w / 2 - M.rail, fy(M.bottom + M.rail), fy(M.top - M.rail), 0.001), stage.camera, room.frame),
    drawer: () => rectOf(quad(-B.w / 2, B.w / 2, B.split, B.h - 0.012, B.z + B.d / 2), stage.camera),
    lower: () => rectOf(quad(-B.w / 2, B.w / 2, 0, B.split, B.z + B.d / 2), stage.camera),
  }
  const lay = (e: HTMLElement, r: Rect) => {
    const at = `${Math.round(r.left)}px ${Math.round(r.top)}px`
    if (e.style.translate !== at) e.style.translate = at
    const w = `${Math.round(r.right - r.left)}px`, h = `${Math.round(r.bottom - r.top)}px`
    if (e.style.width !== w) e.style.width = w
    if (e.style.height !== h) e.style.height = h
  }

  // ── The camera: square on to the mirror, the whole of it and the box in a page rectangle ──
  const fit = new THREE.PerspectiveCamera()
  const BOUNDS: [number, number, number][] = []
  for (const x of [-M.post - 0.03, M.post + 0.03]) for (const y of [0, 0.9]) for (const z of [-0.1, B.z + B.d / 2]) BOUNDS.push([x, y, z])
  const narrow = () => scene.layout() === 'narrow'
  /** The furniture fitted between page rows and columns, by stepping back and panning. */
  const frameIt = (o: { top: number; bottom: number; left: number; right: number; fov: number; slope: number }) => {
    scene.lens(o.fov)
    fit.fov = o.fov
    fit.aspect = innerWidth / innerHeight
    fit.near = 0.05
    fit.far = 60
    fit.updateProjectionMatrix()
    const dir = new THREE.Vector3(0, o.slope, 1).normalize()
    const look = AT.clone().add(new THREE.Vector3(0, 0.45, 0.05))
    const tan = Math.tan(THREE.MathUtils.degToRad(o.fov / 2))
    let dist = 0.6
    for (let n = 0; n < 80; n++, dist *= 1.03) {
      let r: Rect = { left: 0, top: 0, right: 0, bottom: 0 }
      for (let i = 0; i < 30; i++) {
        fit.position.copy(look).addScaledVector(dir, dist)
        fit.lookAt(look)
        fit.updateMatrixWorld(true)
        r = rectOf(BOUNDS, fit)
        const wpp = (2 * dist * tan) / innerHeight
        const dx = (r.left + r.right) / 2 - (o.left + o.right) / 2, dy = (r.top + r.bottom) / 2 - (o.top + o.bottom) / 2
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break
        look.x += THREE.MathUtils.clamp(dx * wpp * 0.8, -0.05, 0.05)
        look.y -= THREE.MathUtils.clamp(dy * wpp * 0.8, -0.05, 0.05)
      }
      if (r.bottom - r.top <= o.bottom - o.top && r.right - r.left <= o.right - o.left) break
    }
    return { position: look.clone().addScaledVector(dir, dist), look }
  }
  const at = () => (narrow()
    // A phone: close, the mirror the width of the screen; room above for the name, below for the two tags.
    ? frameIt({ top: 96, bottom: innerHeight - 78, left: 6, right: innerWidth - 6, fov: 50, slope: 0.16 })
    // Wide or a tablet: the mirror and its box most of the height, the kitchen round them.
    : frameIt({ top: 78, bottom: innerHeight - 28, left: 0, right: innerWidth, fov: 40, slope: 0.14 }))

  const showing = () => {
    const s = scene.state()
    return !scene.watching() && (s === 'empty' || s === 'failed' || s === 'stitching' || s === 'tuning')
  }
  const tuningNow = () => scene.state() === 'tuning' || scene.state() === 'stitching'
  const card = () => document.querySelector<HTMLElement>('.vs-card')

  return {
    id: 'd',
    standAt: () => AT.clone().add(new THREE.Vector3(0, B.h + 0.018, B.z - 0.035)),
    turn: () => 0.06,
    // The mirror is furniture, not resized to the villager: a big one is shown smaller on the box, so at its biggest size
    // it still stands inside the glass, clear of the rails, with room above its head for what it says.
    fit(body) {
      const big = SCALE * 2 ** 0.32
      const w = Math.max(body.max.x - body.min.x, (body.max.z - body.min.z) * 0.7) * big
      const h = (body.max.y - Math.min(0, body.min.y)) * big
      return Math.min(1, (M.w - M.rail * 2 - 0.08) / w, 0.44 / h)
    },
    toolsVisible: () => false,
    pose(state) {
      if (state === 'waiting') return scene.overMat()
      if (state === 'empty' || state === 'failed' || state === 'stitching' || state === 'tuning') return at()
      return null
    },
    tuning() {
      root.classList.add('tuning')
      marker.focus({ preventScroll: true })
    },
    leaving() {
      root.classList.remove('tuning')
      const c = card()
      if (c) c.style.maxWidth = ''
    },
    slip(w) {
      if (!showing()) return null
      void w
      // Below the glass's swatches: over the box's front (bare until there is a villager), inside the screen.
      const h = scene.slip.offsetHeight
      const g = FACES.glass(), d = FACES.lower()
      const width = `${Math.round(Math.min(innerWidth - 24, 440))}px`
      if (scene.slip.style.width !== width && !scene.slip.classList.contains('invite')) scene.slip.style.width = width
      return { x: (g.left + g.right) / 2, y: Math.min(innerHeight - h / 2 - 14, d.bottom - h / 2) }
    },
    place(what, w, h) {
      if (!showing()) return null
      if (what === 'card') {
        // In the glass above the head, never over the rails' controls.
        const g = FACES.glass(), r = scene.villager()
        const c = card()
        if (c && c.style.maxWidth !== `${Math.round(g.right - g.left - 8)}px`) c.style.maxWidth = `${Math.round(g.right - g.left - 8)}px`
        if (!r) return null
        const x = THREE.MathUtils.clamp((r.left + r.right) / 2 - w / 2, g.left + 4, Math.max(g.left + 4, g.right - 4 - w))
        return { x, y: Math.max(8, r.top - h - 6) }
      }
      return null
    },
    frame() {
      const on = showing()
      root.classList.toggle('shown', on)
      root.classList.toggle('tuning', tuningNow())
      patterns.group.visible = false
      if (!on) return
      drawSwatches()
      lay(leftRail, FACES.left())
      lay(rightRail, FACES.right())
      lay(glassFace, FACES.glass())
      lay(drawer, FACES.drawer())
      lay(lower, FACES.lower())
      // Before there is a villager, the swatches keep clear of the slip below them.
      if (!tuningNow()) {
        const slipTop = scene.slip.getBoundingClientRect().top
        const g = glassFace.getBoundingClientRect()
        hang.style.maxHeight = `${Math.max(60, Math.round(slipTop - g.top - 14))}px`
      }
      const val = tools.values
      // The marker rides the villager's head; without one it reads the value on the tape.
      const r = scene.villager(), t = tape.getBoundingClientRect()
      const y = r && scene.state() === 'tuning' ? THREE.MathUtils.clamp(r.top - t.top, 8, t.height - 8) : t.height * (1 - val.size)
      marker.style.top = `${Math.round(y)}px`
      marker.setAttribute('aria-valuenow', String(Math.round(val.size * 100)))
      dots.forEach((d, i) => {
        const c = scene.hueAt(i / 6)
        if (c) d.style.background = c
        const here = Math.abs(val.hue - i / 6) < 0.05
        d.classList.toggle('at', here)
        d.setAttribute('aria-checked', String(here))
      })
      for (const k of knobs) {
        k.knob.style.setProperty('--turn', `${Math.round(-135 + val[k.key] * 270)}deg`)
        k.knob.setAttribute('aria-valuenow', String(Math.round(val[k.key] * 100)))
      }
      for (const rb of ribbons) {
        rb.button.style.left = `${(val[rb.key] * 100).toFixed(1)}%`
        rb.strip.setAttribute('aria-valuenow', String(Math.round(val[rb.key] * 100)))
      }
      const level = Math.round(val.humour * 2)
      steps.forEach((s, i) => {
        s.classList.toggle('at', i === level)
        s.setAttribute('aria-checked', String(i === level))
      })
      // Crude shows only as a level the household's admin set: otherwise a locked mark, never a choice.
      steps[2].classList.toggle('locked', level !== 2)
    },
    api: {
      /** A control's middle on the page, to click or drag it. */
      control: (key: Key) => {
        const e = key === 'size' ? tape : key === 'hue' ? dots[0] : key === 'humour' ? steps[0] : (knobs.find((k) => k.key === key)?.knob ?? ribbons.find((r) => r.key === key)!.strip)
        const b = e.getBoundingClientRect()
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }
      },
      glass: () => glassFace.getBoundingClientRect().toJSON(),
    },
    dispose() {
      clearTimeout(lineTimer)
      patterns.group.visible = true
      room.group.removeFromParent()
      room.dispose()
      const c = card()
      if (c) c.style.maxWidth = ''
      root.remove()
      style.remove()
    },
  }
}

function css() {
  return `
  [data-vs-strategy=d] .vs-rack, [data-vs-strategy=d] .vs-saved { display: none !important; }
  .vs-fit { position: fixed; inset: 0; z-index: 4; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity 320ms ease, visibility 0s linear 320ms; }
  .vs-fit.shown { opacity: 1; visibility: visible; transition: opacity 320ms ease; }
  .vs-fit .face { position: absolute; left: 0; top: 0; box-sizing: border-box; display: flex; }
  .vs-fit .face > * { pointer-events: auto; }
  .vs-fit .tag { position: absolute; font: 700 15px/1 ${HAND}; color: #4a3220; text-shadow: 0 0 3px rgba(255, 248, 232, 0.95), 0 1px 0 rgba(255, 248, 232, 0.9); white-space: nowrap; }
  /* Controls come out with the villager; before that the glass holds the swatches. */
  .vs-fit:not(.tuning) .left > *, .vs-fit:not(.tuning) .right > *, .vs-fit:not(.tuning) .drawer > *, .vs-fit:not(.tuning) .lower > * { visibility: hidden; }
  .vs-fit.tuning .hang { display: none; }
  /* The tape measure up the left rail. */
  .vs-fit .left { flex-direction: column; align-items: center; padding: 6px 0; }
  .vs-fit .left .tag { top: -20px; left: 50%; translate: -50% 0; }
  .vs-fit .tape { position: relative; flex: 1; width: min(24px, 78%); border-radius: 2px; cursor: ns-resize; touch-action: none;
    background: repeating-linear-gradient(0deg, #5a3f22 0 1.5px, transparent 1.5px 8px) right / 8px 100% no-repeat, repeating-linear-gradient(0deg, #5a3f22 0 2px, transparent 2px 32px) right / 13px 100% no-repeat, #e9c45a;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(90, 60, 30, 0.4); }
  .vs-fit .marker { position: absolute; left: -10px; width: 46px; height: 18px; margin-top: -9px; border-radius: 3px 9px 9px 3px; background: linear-gradient(180deg, #e2bd6a, #b88a3a);
    box-shadow: 0 2px 5px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255, 240, 200, 0.6); transition: top 120ms ease; }
  .vs-fit .marker::after { content: '↕'; position: absolute; right: 5px; top: -1px; font: 700 14px/18px ${HAND}; color: #3d2a1c; }
  .vs-fit .marker:focus-visible { outline: 3px solid #fffaf0; outline-offset: 2px; }
  /* The colour dots pinned down the right rail. */
  .vs-fit .right { flex-direction: column; align-items: center; padding: 10px 0; }
  .vs-fit .right .tag { top: -20px; left: 50%; translate: -50% 0; }
  .vs-fit .colours { flex: 1; display: flex; flex-direction: column; justify-content: space-evenly; align-items: center; }
  .vs-fit .dot { width: 26px; height: 26px; border: 0; border-radius: 50%; cursor: pointer; background: #d9a35f; position: relative;
    background-image: radial-gradient(rgba(255,255,255,0.14) 1px, transparent 1.4px); background-size: 4px 4px;
    box-shadow: inset 0 0 0 2px rgba(255, 245, 225, 0.35), 0 2px 4px rgba(0,0,0,0.4); transition: scale 120ms ease; }
  .vs-fit .dot::before { content: ''; position: absolute; left: 50%; top: 3px; width: 6px; height: 6px; margin-left: -3px; border-radius: 50%; background: #e9dcc0; box-shadow: 0 1px 1px rgba(0,0,0,0.4); }
  .vs-fit .dot.at { scale: 1.18; box-shadow: inset 0 0 0 2px rgba(255, 245, 225, 0.5), 0 0 0 3px #fff3dc, 0 4px 8px rgba(0,0,0,0.45); }
  .vs-fit .dot:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 3px; }
  /* The box's top drawer: three dials. */
  .vs-fit .drawer { justify-content: space-evenly; align-items: center; padding: 4px 10px; }
  .vs-fit .dial { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 84px; }
  .vs-fit .dial-name { font: 700 14px/1 ${HAND}; color: #ffe9c4; }
  .vs-fit .knob { position: relative; width: 36px; height: 36px; border-radius: 50%; cursor: grab; touch-action: none;
    background: radial-gradient(circle at 35% 30%, #e6c578, #a07832 70%); box-shadow: 0 3px 6px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(255, 235, 190, 0.45); }
  .vs-fit .knob::before { content: ''; position: absolute; inset: -5px; border-radius: 50%; border: 2px dotted rgba(255, 240, 210, 0.55); clip-path: polygon(50% 50%, 0 100%, 0 0, 100% 0, 100% 100%); }
  .vs-fit .notch { position: absolute; left: 50%; top: 4px; width: 3px; height: 13px; margin-left: -1.5px; border-radius: 2px; background: #3d2a1c; transform-origin: 50% 14px; rotate: var(--turn, 0deg); }
  .vs-fit .knob:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 5px; }
  .vs-fit .dial-ends { display: flex; justify-content: space-between; width: 76px; font: 700 12px/1 ${HAND}; color: #ffe9c4; }
  /* The lower drawer: the ribbons tied across it, the jokes switch beneath. */
  .vs-fit .lower { flex-direction: column; justify-content: center; gap: 4px; padding: 4px 8px; }
  .vs-fit .ribbon-row { display: grid; grid-template-columns: 56px 1fr 56px; align-items: center; gap: 6px; font: 700 13px/1 ${HAND}; color: #fff3dc; }
  .vs-fit .ribbon-row .end:first-child { text-align: right; }
  .vs-fit .ribbon { position: relative; height: 15px; border-radius: 2px; cursor: pointer; touch-action: none; background: var(--ground);
    background-image: repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0 2px, rgba(0,0,0,0.06) 2px 4px); box-shadow: 0 2px 3px rgba(0,0,0,0.3); }
  .vs-fit .ribbon::after { content: ''; position: absolute; inset: 3px 0; border-top: 1.2px dashed rgba(255, 248, 232, 0.6); border-bottom: 1.2px dashed rgba(255, 248, 232, 0.6); }
  .vs-fit .ribbon .button { position: absolute; top: 50%; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; background: #e9dcc0;
    box-shadow: 0 2px 4px rgba(0,0,0,0.4), inset 0 0 0 2px rgba(120, 80, 50, 0.35); z-index: 1; }
  .vs-fit .ribbon .button::after { content: '⁘'; position: absolute; inset: 0; font: 13px/20px serif; text-align: center; color: #5a3d27; }
  .vs-fit .ribbon:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 3px; }
  .vs-fit .jokes { display: flex; align-items: center; justify-content: center; gap: 5px; margin-top: 2px; }
  .vs-fit .jokes-name { font: 700 14px/1 ${HAND}; color: #ffe9c4; margin-right: 2px; }
  .vs-fit .step { white-space: nowrap; padding: 3px 9px 4px; border: 0; border-radius: 4px 9px 9px 4px; cursor: pointer; background: rgba(255, 243, 220, 0.2); color: #fff3dc; font: 700 14px/1.1 ${HAND}; }
  .vs-fit .step.at { background: #fffaf0; color: #23395a; box-shadow: 0 2px 5px rgba(0,0,0,0.3); }
  .vs-fit .step.locked { opacity: 0.55; text-decoration: line-through 1px; }
  .vs-fit .step.locked::after { content: ' 🔒'; font-size: 10px; text-decoration: none; }
  /* The swatches tucked into the glass: felt samples with pinked edges. */
  .vs-fit .glass { padding: 10px; }
  .vs-fit .hang { display: flex; flex-wrap: wrap; align-content: flex-start; justify-content: center; gap: 10px 8px; overflow: hidden; width: 100%; }
  .vs-fit .vs-swatch { position: relative; width: calc(50% - 6px); max-width: 128px; min-height: 58px; padding: 10px 6px 12px; border: 0; cursor: pointer; background: var(--felt, #7b9a6e); color: #fffaf0;
    clip-path: polygon(0 0, 100% 0, 100% 88%, 95% 100%, 90% 88%, 85% 100%, 80% 88%, 75% 100%, 70% 88%, 65% 100%, 60% 88%, 55% 100%, 50% 88%, 45% 100%, 40% 88%, 35% 100%, 30% 88%, 25% 100%, 20% 88%, 15% 100%, 10% 88%, 5% 100%, 0 88%);
    text-align: center; text-shadow: 0 1px 0 rgba(40, 20, 8, 0.35); transform-origin: 50% 0; transition: rotate 200ms ease, translate 200ms ease; }
  .vs-fit .vs-swatch::before { content: ''; position: absolute; left: 50%; top: 3px; width: 7px; height: 7px; margin-left: -3.5px; border-radius: 50%; background: #e9dcc0; box-shadow: 0 1px 2px rgba(0,0,0,0.4); }
  .vs-fit .vs-swatch b { display: block; font: 700 15px/1.1 ${HAND}; }
  .vs-fit .vs-swatch small { display: block; margin-top: 3px; font: italic 11px/1.2 ${BOOK}; opacity: 0.9; }
  .vs-fit .vs-swatch:nth-child(odd) { rotate: -1.5deg; } .vs-fit .vs-swatch:nth-child(even) { rotate: 1.2deg; }
  .vs-fit .vs-swatch[aria-pressed=true] { translate: 0 5px; rotate: 0deg; filter: brightness(1.08); }
  .vs-fit .vs-swatch[aria-pressed=true] b { text-decoration: underline 1.5px; text-underline-offset: 3px; }
  .vs-fit .vs-swatch:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 2px; }
  /* A phone: the box's drawers are shorter on the page, so the dials pack closer. */
  @media (max-aspect-ratio: 9/10) {
    .vs-fit .drawer { padding: 1px 8px; }
    .vs-fit .dial { gap: 1px; }
    .vs-fit .knob { width: 30px; height: 30px; }
    .vs-fit .notch { height: 11px; transform-origin: 50% 11px; top: 3px; }
  }
  @media (prefers-reduced-motion: reduce) { .vs-fit, .vs-fit .marker, .vs-fit .vs-swatch, .vs-fit .dot { transition: none; } }
  `
}
