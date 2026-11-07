// #47 setup, dev only: five sewing-kit controls on the workshop table, each a
// physical thing you drag, not a web slider. A tape measure for size, a rail of
// thread spools for felt colour, a toy xylophone for voice pitch, a metronome for
// pace and a wind-up key for energy. Each has a paper tag that is a real
// role="slider" element, so Tab and the arrow keys reach it; the tag is the label.
// Values are 0 to 1, 0.5 is the villager as the model made it.
import * as THREE from 'three/webgpu'
import type { Stage } from '../../kernel'
import { feltTexture } from '../kinds'
import { HAND, TOP, spool } from './workshop'

export type Key = 'size' | 'hue' | 'pitch' | 'pace' | 'energy' | 'warmth' | 'playful' | 'chatty' | 'humour'
export const KEYS: Key[] = ['size', 'hue', 'pitch', 'pace', 'energy', 'warmth', 'playful', 'chatty', 'humour']
/** The persona's dials: data only, kept with the villager, never sent to a model. */
export const PERSONA_KEYS: Key[] = ['warmth', 'playful', 'chatty', 'humour']
/** The humour dial's three positions, 0, 0.5 and 1. */
export const HUMOUR = ['clean', 'cheeky', 'crude'] as const

const LABEL: Record<Key, { tag: string; aria: string; low: string; high: string }> = {
  size: { tag: 'size', aria: 'Size, a tape measure', low: 'smaller', high: 'bigger' },
  hue: { tag: 'colour', aria: 'Felt colour, a rail of thread spools', low: 'cooler', high: 'warmer' },
  pitch: { tag: 'pitch', aria: 'Voice pitch, a toy xylophone', low: 'lower', high: 'higher' },
  pace: { tag: 'pace', aria: 'Voice pace, a metronome', low: 'slower', high: 'quicker' },
  energy: { tag: 'energy', aria: 'Energy, a wind-up key', low: 'calmer', high: 'livelier' },
  warmth: { tag: 'manner', aria: 'Manner, from blunt to warm, a ribbon with a button', low: 'blunter', high: 'warmer' },
  playful: { tag: 'play', aria: 'Humour, from serious to playful, a ribbon with a button', low: 'more serious', high: 'more playful' },
  chatty: { tag: 'talk', aria: 'Talk, from brief to chatty, a ribbon with a button', low: 'briefer', high: 'chattier' },
  humour: { tag: 'jokes', aria: 'Humour, clean, cheeky or crude, a three-position stitch dial', low: 'cleaner', high: 'cruder' },
}

/** How a 0..1 value reads aloud: "as made", "a little bigger", "much smaller". */
export function valueText(key: Key, v: number): string {
  if (key === 'humour') return HUMOUR[Math.round(v * 2)]
  const d = v - 0.5
  if (Math.abs(d) < 0.04) return 'as made'
  const word = d > 0 ? LABEL[key].high : LABEL[key].low
  return Math.abs(d) < 0.2 ? `a little ${word}` : Math.abs(d) < 0.38 ? word : `much ${word}`
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const std = (color: string, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
const feltMat = (c: string, seed: number) => new THREE.MeshStandardMaterial({ color: '#ffffff', map: feltTexture(c, seed, { band: false }), roughness: 1 })

/** The CPU twin of TSL's hue(): rotate a linear colour about the grey axis by `a` radians. */
export function rotateHue(c: THREE.Color, a: number): THREE.Color {
  const k = 0.57735
  const cos = Math.cos(a), sin = Math.sin(a)
  const { r, g, b } = c
  const dot = k * (r + g + b)
  const cx = k * (b - g), cy = k * (r - b), cz = k * (g - r) // k × c
  return new THREE.Color(
    Math.max(0, r * cos + cx * sin + k * dot * (1 - cos)),
    Math.max(0, g * cos + cy * sin + k * dot * (1 - cos)),
    Math.max(0, b * cos + cz * sin + k * dot * (1 - cos)),
  )
}

/** The felt colour slider's range: a hue turn of up to 60 degrees either way. */
export const HUE_SPAN = Math.PI / 3

interface Tool {
  key: Key
  group: THREE.Group
  /** Where a drag moves the value from 0 to 1, in the tool's own space; null drags sideways on screen. */
  axis: [THREE.Vector3, THREE.Vector3] | null
  /** Under the tool, where its tag hangs. */
  tagAt: THREE.Vector3
  show(v: number): void
  tick?(dt: number, t: number): void
  /** Discrete positions (the humour dial's three), else continuous. */
  steps?: number
  /** Show or hide a lock on the top position. */
  lock?(on: boolean): void
  glow: THREE.MeshStandardMaterial[]
}

function tapeMeasure(): Tool {
  const g = new THREE.Group()
  const caseMat = std('#c4553f', 0.55)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.03, 28), caseMat)
  body.rotation.x = Math.PI / 2
  body.position.set(0, 0.038, 0)
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.032, 24), std('#efe3c8', 0.6))
  face.rotation.x = Math.PI / 2
  face.position.copy(body.position)
  const crank = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.004), std('#8a6a3c', 0.4, 0.4))
  crank.position.set(0, 0.038, 0.018)
  g.add(body, face, crank)
  // The tape: yellow oilcloth with inch marks, drawn out to the right along the table.
  const [c, x] = (() => {
    const cv = document.createElement('canvas')
    cv.width = 256
    cv.height = 32
    return [cv, cv.getContext('2d')!] as const
  })()
  x.fillStyle = '#e9c45a'
  x.fillRect(0, 0, 256, 32)
  x.fillStyle = '#5a3f22'
  for (let i = 0; i < 32; i++) x.fillRect(i * 8, 0, 1.5, i % 4 === 0 ? 14 : 7)
  x.font = '600 11px sans-serif'
  for (let i = 0; i < 8; i++) x.fillText(String(i + 1), i * 32 + 3, 27)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  const tapeMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })
  const tape = new THREE.Mesh(new THREE.BoxGeometry(1, 0.0015, 0.02), tapeMat)
  const tab = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.016, 0.024), std('#b88a3a', 0.35, 0.6))
  g.add(tape, tab)
  const x0 = 0.035, span = 0.24
  return {
    key: 'size', group: g, glow: [caseMat],
    axis: [new THREE.Vector3(x0 + 0.03, 0, 0), new THREE.Vector3(x0 + 0.03 + span, 0, 0)],
    tagAt: new THREE.Vector3(0.05, 0, 0.07),
    show(v) {
      const len = 0.03 + v * span
      tape.scale.x = len
      tape.position.set(x0 + len / 2, 0.003, 0.004)
      tex.repeat.x = len / 0.24
      tab.position.set(x0 + len, 0.008, 0.004)
    },
  }
}

function spoolRail(): Tool & { colours(c: THREE.Color[]): void } {
  const g = new THREE.Group()
  const wood = std('#c99a62', 0.6)
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.012, 0.05), wood)
  rail.position.y = 0.006
  g.add(rail)
  const n = 7, gap = 0.046
  const spools = Array.from({ length: n }, (_, i) => {
    const s = spool('#d9a35f', 0.016, 0.042)
    s.group.position.set((i - (n - 1) / 2) * gap, 0.012, 0)
    g.add(s.group)
    return s
  })
  // A big pin marks the chosen thread.
  const pin = new THREE.Group()
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.009, 14, 10), std('#2f4a6b', 0.3))
  head.position.y = 0.075
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.06, 6), std('#d0d0d0', 0.3, 0.7))
  shaft.position.y = 0.045
  pin.add(head, shaft)
  g.add(pin)
  const x0 = -((n - 1) / 2) * gap, x1 = ((n - 1) / 2) * gap
  let current = 0.5
  return {
    key: 'hue', group: g, glow: [wood],
    axis: [new THREE.Vector3(x0, 0, 0), new THREE.Vector3(x1, 0, 0)],
    tagAt: new THREE.Vector3(0, 0, 0.06),
    show(v) {
      current = v
      pin.position.x = x0 + (x1 - x0) * v
      spools.forEach((s, i) => {
        const near = Math.max(0, 1 - Math.abs(i / (n - 1) - v) * (n - 1))
        s.group.position.y = 0.012 + near * 0.014
      })
    },
    colours(list) {
      spools.forEach((s, i) => s.thread.color.copy(list[i]))
      this.show(current)
    },
  }
}

function xylophone(): Tool {
  const g = new THREE.Group()
  const frame = std('#b8875a', 0.6)
  for (const z of [-0.03, 0.03]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.012), frame)
    r.position.set(0, 0.006, z)
    r.scale.z = 1
    g.add(r)
  }
  const tones = ['#b5654b', '#c98a4b', '#d6b45c', '#8fa86a', '#6f9a95', '#6f86a8', '#8a76a0', '#a46a86']
  const n = tones.length, gap = 0.036
  const bars = tones.map((c, i) => {
    const len = 0.115 - i * 0.0075
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.008, len), std(c, 0.55))
    bar.position.set((i - (n - 1) / 2) * gap, 0.016, 0)
    g.add(bar)
    return bar
  })
  // The felt mallet lies across the bars; its head sits on the chosen note.
  const mallet = new THREE.Group()
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.013, 16, 12), feltMat('#e7d7b8', 55))
  ball.position.set(0, 0.034, 0.02)
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.12, 8), std('#d9b07a', 0.6))
  stick.rotation.x = Math.PI / 2 - 0.12
  stick.position.set(0, 0.03, 0.08)
  mallet.add(ball, stick)
  g.add(mallet)
  const x0 = -((n - 1) / 2) * gap, x1 = ((n - 1) / 2) * gap
  return {
    key: 'pitch', group: g, glow: [frame],
    axis: [new THREE.Vector3(x0, 0, 0), new THREE.Vector3(x1, 0, 0)],
    tagAt: new THREE.Vector3(0, 0, 0.085),
    show(v) {
      mallet.position.x = x0 + (x1 - x0) * v
      bars.forEach((b, i) => (b.position.y = 0.016 - Math.max(0, 1 - Math.abs(i / (n - 1) - v) * (n - 1)) * 0.003))
    },
  }
}

function metronome(): Tool & { rate: number } {
  const g = new THREE.Group()
  const wood = std('#a8703a', 0.55)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.05, 0.16, 4, 1), wood)
  body.rotation.y = Math.PI / 4
  body.position.y = 0.08
  body.scale.z = 0.7
  g.add(body)
  const faceMat = std('#efe3c8', 0.7)
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.12), faceMat)
  face.position.set(0, 0.085, 0.024)
  face.rotation.x = -0.21
  g.add(face)
  // The pendulum: a rod pivoting near the base, with a brass weight that slides on it.
  const arm = new THREE.Group()
  arm.position.set(0, 0.03, 0.03)
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.13, 6), std('#d8d4c8', 0.3, 0.7))
  rod.position.y = 0.065
  const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.014, 4), std('#c49a3c', 0.32, 0.65))
  weight.rotation.y = Math.PI / 4
  arm.add(rod, weight)
  arm.rotation.x = -0.21
  g.add(arm)
  const top = 0.115, bottom = 0.035
  let phase = 0
  const tool: Tool & { rate: number } = {
    key: 'pace', group: g, glow: [wood], rate: 1,
    // The weight's travel, from slow at the top to quick at the bottom.
    axis: [new THREE.Vector3(0, 0.03 + top, 0.03), new THREE.Vector3(0, 0.03 + bottom, 0.03)],
    tagAt: new THREE.Vector3(0, 0, 0.07),
    show(v) {
      weight.position.y = top + (bottom - top) * v
    },
    tick(dt) {
      if (reducedMotion.matches) {
        arm.rotation.z = 0
        return
      }
      phase += dt * Math.PI * tool.rate
      arm.rotation.z = Math.sin(phase) * 0.42
    },
  }
  return tool
}

function windupKey(): Tool {
  const g = new THREE.Group()
  // A felt-covered drum, the toy's body, with a brass key in its side.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.042, 0.05, 26), feltMat('#7b9a6e', 61))
  drum.position.y = 0.025
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.006, 26), std('#d9b07a', 0.6))
  lid.position.y = 0.052
  g.add(drum, lid)
  const brass = std('#c49a3c', 0.32, 0.65)
  const key = new THREE.Group()
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 8), brass)
  stem.rotation.z = Math.PI / 2
  stem.position.x = 0.015
  key.add(stem)
  for (const s of [-1, 1]) {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.0045, 8, 18), brass)
    bow.position.set(0.036, s * 0.014, 0)
    bow.rotation.y = Math.PI / 2
    bow.scale.set(1, 1, 0.55)
    key.add(bow)
  }
  key.position.set(0.04, 0.028, 0)
  g.add(key)
  return {
    key: 'energy', group: g, glow: [brass],
    axis: null,
    tagAt: new THREE.Vector3(0.01, 0, 0.07),
    show(v) {
      key.rotation.x = v * Math.PI * 1.6
    },
  }
}

/** A sewing machine's stitch selector with three marks; a small brass padlock sits on "crude" when it is locked. */
function stitchDial(): Tool {
  const g = new THREE.Group()
  const cv = document.createElement('canvas')
  cv.width = cv.height = 512
  const x = cv.getContext('2d')!
  x.fillStyle = '#efe3c8'
  x.beginPath()
  x.arc(256, 256, 250, 0, Math.PI * 2)
  x.fill()
  x.strokeStyle = 'rgba(120, 80, 50, 0.55)'
  x.lineWidth = 6
  x.setLineDash([18, 12])
  x.beginPath()
  x.arc(256, 256, 232, 0, Math.PI * 2)
  x.stroke()
  x.setLineDash([])
  x.font = `700 72px ${HAND}`
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  const marks: [string, number, string][] = [['clean', -0.95, '#3f6a35'], ['cheeky', 0, '#8a5a1c'], ['crude', 0.95, '#8a3b2a']]
  for (const [word, a, ink] of marks) {
    x.save()
    x.translate(256 + Math.sin(a) * 168, 256 - Math.cos(a) * 168)
    x.rotate(a)
    x.fillStyle = ink
    x.fillText(word, 0, 0)
    x.restore()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.098, 0.012, 40), [std('#b8875a', 0.6), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), std('#b8875a', 0.6)])
  plate.position.y = 0.006
  g.add(plate)
  const wood = std('#a8703a', 0.5)
  const knob = new THREE.Group()
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.03, 28), wood)
  cap.position.y = 0.027
  const pointer = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, 0.05), std('#2f241c', 0.5))
  pointer.position.set(0, 0.043, -0.026)
  knob.add(cap, pointer)
  g.add(knob)
  // The padlock: a brass body and a shackle, on the crude mark.
  const brass = std('#c49a3c', 0.32, 0.65)
  const padlock = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.018, 0.012), brass)
  body.position.y = 0.021
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.0075, 0.0022, 8, 16, Math.PI), std('#cfd2d4', 0.3, 0.75))
  shackle.position.y = 0.03
  padlock.add(body, shackle)
  padlock.position.set(Math.sin(0.95) * 0.062, 0, -Math.cos(0.95) * 0.062)
  padlock.rotation.y = -0.95
  padlock.visible = false
  g.add(padlock)
  return {
    key: 'humour', group: g, glow: [wood], steps: 3,
    axis: null,
    tagAt: new THREE.Vector3(0, 0, -0.14),
    show(v) {
      knob.rotation.y = -(Math.round(v * 2) - 1) * 0.95
    },
    lock(on) {
      padlock.visible = on
    },
  }
}

/** A grosgrain ribbon with its two ends embroidered, and a button that slides along it. */
function ribbon(key: Key, ground: string, ink: string, left: string, right: string): Tool {
  const g = new THREE.Group()
  const W = 1024, H = 96
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const x = cv.getContext('2d')!
  x.fillStyle = ground
  x.fillRect(0, 0, W, H)
  // Grosgrain ribs and a stitched edge.
  for (let i = 0; i < W; i += 4) {
    x.fillStyle = i % 8 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'
    x.fillRect(i, 0, 2, H)
  }
  x.strokeStyle = 'rgba(255, 248, 232, 0.55)'
  x.lineWidth = 3
  x.setLineDash([14, 10])
  for (const y of [9, H - 9]) {
    x.beginPath()
    x.moveTo(0, y)
    x.lineTo(W, y)
    x.stroke()
  }
  x.setLineDash([])
  x.fillStyle = ink
  x.font = `700 58px ${HAND}`
  x.textBaseline = 'middle'
  x.fillText(left, 22, H / 2 + 2)
  x.textAlign = 'right'
  x.fillText(right, W - 22, H / 2 + 2)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const ribbonMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 })
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.002, 0.046), ribbonMat)
  strip.position.y = 0.001
  g.add(strip)
  // A four-hole wooden button.
  const button = new THREE.Group()
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.007, 24), std('#e9dcc0', 0.5))
  disc.position.y = 0.005
  button.add(disc)
  for (const [hx, hz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.007, 8), std('#5a3d27', 0.8))
    hole.position.set(hx * 0.0055, 0.0058, hz * 0.0055)
    button.add(hole)
  }
  g.add(button)
  const x0 = -0.13, x1 = 0.13
  return {
    key, group: g, glow: [disc.material as THREE.MeshStandardMaterial],
    axis: [new THREE.Vector3(x0, 0, 0), new THREE.Vector3(x1, 0, 0)],
    tagAt: new THREE.Vector3(-0.27, 0, -0.01),
    show(v) {
      button.position.x = x0 + (x1 - x0) * v
    },
  }
}

export interface Controls {
  group: THREE.Group
  readonly values: Record<Key, number>
  /** Set a value as if dragged (input fires, release does not). */
  set(key: Key, v: number): void
  /** Lay the tools at a villager's starting values, without firing input. */
  init(values: Partial<Record<Key, number>>): void
  /** Lock a stepped tool's top position (crude humour): the dial stops one short and shows a padlock. */
  lock(key: Key, on: boolean): void
  enable(on: boolean): void
  /** The thread colours for the colour rail: the main felt turned through the slider's range. */
  felt(main: THREE.Color): void
  /** Metronome tempo, as a multiple of the made pace. */
  tempo(rate: number): void
  /** Move keyboard focus to a tool's tag. */
  focus(key: Key): void
  /** Where a tool's handle (its value's end of the axis) is on screen, for the checks. */
  screen(key: Key): { x: number; y: number }
  frame(dt: number, t: number): void
  dispose(): void
}

/** Where each tool sits along the near edge of the table, in world space. */
const PLACES: Record<Key, [number, number, number]> = {
  size: [-0.98, 0.5, 0.2],
  hue: [-0.56, 0.53, 0.04],
  pitch: [-0.12, 0.52, 0],
  pace: [0.22, 0.47, -0.35],
  energy: [0.45, 0.5, -0.5],
  warmth: [0.42, 0.1, -0.06],
  playful: [0.42, 0.2, -0.06],
  chatty: [0.42, 0.3, -0.06],
  humour: [-1.0, 0.27, 0.15],
}

export function controls(stage: Stage, hooks: { input(key: Key, v: number): void; release(key: Key, v: number): void; locked(key: Key): void }): Controls {
  const group = new THREE.Group()
  group.name = 'villager workshop controls'
  const rail = spoolRail()
  const pace = metronome()
  const tools: Tool[] = [
    tapeMeasure(), rail, xylophone(), pace, windupKey(),
    ribbon('warmth', '#c4553f', '#fff4e2', 'blunt', 'warm'),
    ribbon('playful', '#d6b45c', '#4a3220', 'serious', 'playful'),
    ribbon('chatty', '#6f86a8', '#fff4e2', 'brief', 'chatty'),
    stitchDial(),
  ]
  const locked = new Set<Key>()
  let nudged = false
  const values = Object.fromEntries(KEYS.map((k) => [k, 0.5])) as Record<Key, number>
  for (const tool of tools) {
    const [x, z, ry] = PLACES[tool.key]
    tool.group.position.set(x, TOP, z)
    tool.group.rotation.y = ry
    tool.group.name = `workshop ${tool.key}`
    tool.group.traverse((n) => { n.castShadow = n.receiveShadow = true })
    group.add(tool.group)
    tool.show(0.5)
  }
  let enabled = false

  // ── The tags: real sliders for the keyboard and screen readers ──────────
  const shelf = document.createElement('div')
  shelf.className = 'vs-tools'
  shelf.setAttribute('role', 'group')
  shelf.setAttribute('aria-label', 'Tune the villager')
  const tags = new Map<Key, HTMLDivElement>()
  for (const tool of tools) {
    const tag = document.createElement('div')
    tag.className = 'vs-tool'
    tag.tabIndex = -1
    tag.dataset.key = tool.key
    tag.setAttribute('role', 'slider')
    tag.setAttribute('aria-label', LABEL[tool.key].aria)
    tag.setAttribute('aria-valuemin', '0')
    tag.setAttribute('aria-valuemax', '100')
    tag.textContent = LABEL[tool.key].tag
    shelf.append(tag)
    tags.set(tool.key, tag)
  }
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  document.body.append(shelf)

  const glow = (tool: Tool, on: number) => {
    for (const m of tool.glow) {
      m.emissive.set('#ffcf8a')
      m.emissiveIntensity = on * 0.35
    }
    tool.group.position.y = TOP + on * 0.008
  }
  const apply = (key: Key, v: number) => {
    v = Math.min(1, Math.max(0, v))
    const tool = tools.find((t) => t.key === key)!
    if (tool.steps) v = Math.round(v * (tool.steps - 1)) / (tool.steps - 1)
    if (locked.has(key) && v >= 1) {
      v = (tool.steps! - 2) / (tool.steps! - 1)
      if (values[key] !== v || !nudged) hooks.locked(key)
      nudged = true
    } else nudged = false
    if (values[key] === v && tool.steps) return
    values[key] = v
    tools.find((t) => t.key === key)!.show(v)
    const tag = tags.get(key)!
    tag.setAttribute('aria-valuenow', String(Math.round(v * 100)))
    tag.setAttribute('aria-valuetext', valueText(key, v))
    hooks.input(key, v)
  }
  for (const k of KEYS) {
    const tag = tags.get(k)!
    tag.setAttribute('aria-valuenow', '50')
    tag.setAttribute('aria-valuetext', valueText(k, 0.5))
  }

  // Keyboard: arrows nudge, Page keys jump, Home and End go to the ends. One phrase per run of presses.
  let releaseTimer = 0
  const onKey = (e: KeyboardEvent) => {
    const key = (e.currentTarget as HTMLElement).dataset.key as Key
    if (!enabled) return
    const step = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05, PageUp: 0.2, PageDown: -0.2 }[e.key]
    let v: number | null = null
    const stepped = tools.find((t) => t.key === key)!.steps
    if (step !== undefined) v = values[key] + (stepped ? Math.sign(step) / (stepped - 1) : step)
    else if (e.key === 'Home') v = 0
    else if (e.key === 'End') v = 1
    if (v === null) return
    e.preventDefault()
    apply(key, v)
    clearTimeout(releaseTimer)
    releaseTimer = window.setTimeout(() => hooks.release(key, values[key]), 380)
  }
  for (const tag of tags.values()) {
    tag.addEventListener('keydown', onKey)
    tag.addEventListener('focus', () => glow(tools.find((t) => t.key === tag.dataset.key)!, 1))
    tag.addEventListener('blur', () => glow(tools.find((t) => t.key === tag.dataset.key)!, 0))
  }

  // Pointer: grab a tool (or its tag) and drag along its own axis, as it appears on screen.
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const canvas = stage.renderer.domElement
  let drag: { tool: Tool; x: number; y: number; v: number; dir: THREE.Vector2; len2: number; id: number } | null = null
  const toScreen = (p: THREE.Vector3) => {
    const r = canvas.getBoundingClientRect()
    const q = p.clone().project(stage.camera)
    return new THREE.Vector2(r.left + ((q.x + 1) / 2) * r.width, r.top + ((1 - q.y) / 2) * r.height)
  }
  const hit = (e: PointerEvent): Tool | null => {
    const r = canvas.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    raycaster.setFromCamera(ndc, stage.camera)
    const found = raycaster.intersectObject(group, true)[0]
    if (!found) return null
    return tools.find((t) => { let o: THREE.Object3D | null = found.object; while (o && o !== t.group) o = o.parent; return o === t.group }) ?? null
  }
  const begin = (tool: Tool, e: PointerEvent) => {
    let dir = new THREE.Vector2(170, 0)
    if (tool.axis) {
      tool.group.updateMatrixWorld(true)
      const a = toScreen(tool.axis[0].clone().applyMatrix4(tool.group.matrixWorld))
      const b = toScreen(tool.axis[1].clone().applyMatrix4(tool.group.matrixWorld))
      dir = b.sub(a)
      // Too short on screen to drag precisely (seen end-on): fall back to a sideways drag.
      if (dir.length() < 40) dir = new THREE.Vector2(170, 0)
    }
    drag = { tool, x: e.clientX, y: e.clientY, v: values[tool.key], dir, len2: dir.lengthSq(), id: e.pointerId }
    glow(tool, 1)
    canvas.style.cursor = 'grabbing'
  }
  const onDown = (e: PointerEvent) => {
    if (!enabled || e.button !== 0) return
    const tool = hit(e)
    if (!tool) return
    e.preventDefault()
    begin(tool, e)
  }
  const onTagDown = (e: PointerEvent) => {
    if (!enabled || e.button !== 0) return
    const tag = e.currentTarget as HTMLElement
    tag.focus({ preventScroll: true })
    e.preventDefault()
    begin(tools.find((t) => t.key === tag.dataset.key)!, e)
  }
  const onMove = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) {
      const dv = ((e.clientX - drag.x) * drag.dir.x + (e.clientY - drag.y) * drag.dir.y) / drag.len2
      apply(drag.tool.key, drag.v + dv)
      return
    }
    if (enabled && e.pointerType !== 'touch') canvas.style.cursor = hit(e) ? 'grab' : canvas.style.cursor === 'grab' ? '' : canvas.style.cursor
  }
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    const { tool } = drag
    drag = null
    canvas.style.cursor = ''
    if (document.activeElement !== tags.get(tool.key)) glow(tool, 0)
    hooks.release(tool.key, values[tool.key])
  }
  canvas.addEventListener('pointerdown', onDown)
  for (const tag of tags.values()) tag.addEventListener('pointerdown', onTagDown)
  addEventListener('pointermove', onMove)
  addEventListener('pointerup', onUp)
  addEventListener('pointercancel', onUp)

  const anchor = new THREE.Vector3()
  return {
    group,
    values,
    set: (key, v) => apply(key, v),
    init(start) {
      for (const tool of tools) {
        const v = Math.min(1, Math.max(0, start[tool.key] ?? 0.5))
        values[tool.key] = v
        tool.show(v)
        const tag = tags.get(tool.key)!
        tag.setAttribute('aria-valuenow', String(Math.round(v * 100)))
        tag.setAttribute('aria-valuetext', valueText(tool.key, v))
      }
    },
    enable(on) {
      enabled = on
      shelf.classList.toggle('shown', on)
      for (const tag of tags.values()) tag.tabIndex = on ? 0 : -1
    },
    felt(main) {
      rail.colours(Array.from({ length: 7 }, (_, i) => rotateHue(main, (i / 6 - 0.5) * 2 * HUE_SPAN)))
    },
    tempo(rate) {
      pace.rate = rate
    },
    lock(key, on) {
      if (on) locked.add(key)
      else locked.delete(key)
      tools.find((t) => t.key === key)!.lock?.(on)
      if (on && values[key] >= 1) apply(key, 1)
    },
    focus(key) {
      tags.get(key)!.focus({ preventScroll: true })
    },
    screen(key) {
      const tool = tools.find((t) => t.key === key)!
      tool.group.updateMatrixWorld(true)
      const p = tool.axis ? new THREE.Vector3().lerpVectors(tool.axis[0], tool.axis[1], values[key]) : new THREE.Vector3(0.05, 0.03, 0)
      const q = toScreen(p.applyMatrix4(tool.group.matrixWorld))
      return { x: q.x, y: q.y }
    },
    frame(dt, t) {
      for (const tool of tools) tool.tick?.(dt, t)
      if (!enabled) return
      const r = canvas.getBoundingClientRect()
      for (const tool of tools) {
        tool.group.updateMatrixWorld()
        anchor.copy(tool.tagAt).applyMatrix4(tool.group.matrixWorld).project(stage.camera)
        const x = Math.round(r.left + ((anchor.x + 1) / 2) * r.width)
        const y = Math.round(r.top + ((1 - anchor.y) / 2) * r.height)
        const at = `calc(${x}px - 50%) ${y}px`
        const tag = tags.get(tool.key)!
        if (tag.style.translate !== at) tag.style.translate = at
      }
    },
    dispose() {
      clearTimeout(releaseTimer)
      canvas.removeEventListener('pointerdown', onDown)
      removeEventListener('pointermove', onMove)
      removeEventListener('pointerup', onUp)
      removeEventListener('pointercancel', onUp)
      canvas.style.cursor = ''
      shelf.remove()
      style.remove()
    },
  }
}

function css() {
  return `
  .vs-tools { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
  .vs-tool { position: absolute; left: 0; top: 0; padding: 2px 11px 4px; border-radius: 4px 9px 9px 4px; cursor: grab; touch-action: none;
    background: linear-gradient(180deg, #fffaf0, #f4e6c9); color: #5a3d27; font: 700 17px/1.2 ${HAND}; white-space: nowrap;
    box-shadow: 0 3px 8px rgba(60, 30, 10, 0.22), inset 0 0 0 1px rgba(150, 100, 60, 0.18); rotate: -2deg;
    opacity: 0; pointer-events: none; transition: opacity 260ms ease, scale 160ms ease; user-select: none; }
  .vs-tool::before { content: ''; position: absolute; left: -5px; top: 50%; width: 7px; height: 7px; margin-top: -3.5px; border-radius: 50%;
    background: #f8efdc; box-shadow: inset 0 0 0 1.5px rgba(120, 80, 50, 0.5); }
  .vs-tool:nth-child(2n) { rotate: 2deg; }
  .vs-tools.shown .vs-tool { opacity: 1; pointer-events: auto; }
  .vs-tool:hover { scale: 1.06; }
  .vs-tool:focus-visible { outline: none; scale: 1.1; color: #2b3f60; text-decoration: underline wavy rgba(47, 74, 107, 0.6); text-underline-offset: 4px;
    box-shadow: 0 0 0 3px rgba(255, 240, 205, 0.95), 0 0 0 5px rgba(47, 74, 107, 0.55), 0 6px 14px rgba(60, 30, 10, 0.3); }
  @media (max-width: 600px) { .vs-tool { font-size: 14px; padding: 1px 8px 3px; } }
  @media (prefers-reduced-motion: reduce) { .vs-tool { transition: none; } }
  `
}
