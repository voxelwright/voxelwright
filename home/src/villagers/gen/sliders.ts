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

/** Each tool's tag: its name, what its two ends do (shown on the tag), and what a screen reader hears. */
const LABEL: Record<Key, { tag: string; aria: string; low: string; high: string; ends: [string, string] }> = {
  size: { tag: 'size', aria: 'Size, a tape measure', low: 'smaller', high: 'bigger', ends: ['small', 'big'] },
  hue: { tag: 'colour', aria: 'Felt colour, a rail of thread spools', low: 'turned one way', high: 'turned the other way', ends: ['', ''] },
  pitch: { tag: 'pitch', aria: 'Voice pitch, a toy xylophone', low: 'lower', high: 'higher', ends: ['low', 'high'] },
  pace: { tag: 'pace', aria: 'Voice pace, a metronome', low: 'slower', high: 'quicker', ends: ['slow', 'quick'] },
  energy: { tag: 'energy', aria: 'Energy, a wind-up key', low: 'calmer', high: 'livelier', ends: ['calm', 'lively'] },
  warmth: { tag: 'manner', aria: 'Manner, from blunt to warm, a ribbon with a button', low: 'blunter', high: 'warmer', ends: ['blunt', 'warm'] },
  playful: { tag: 'play', aria: 'Humour, from serious to playful, a ribbon with a button', low: 'more serious', high: 'more playful', ends: ['serious', 'playful'] },
  chatty: { tag: 'talk', aria: 'Talk, from brief to chatty, a ribbon with a button', low: 'briefer', high: 'chattier', ends: ['brief', 'chatty'] },
  humour: { tag: 'jokes', aria: 'Jokes, clean or cheeky, a stitch dial; crude only when the household admin sets it', low: 'cleaner', high: 'cheekier', ends: ['', ''] },
}
const RIBBONS: Key[] = ['warmth', 'playful', 'chatty']

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
  /** Under the tool, where its tag hangs (a ribbon's: its left end). */
  tagAt: THREE.Vector3
  /** A ribbon's right end, where its second tag hangs. */
  endAt?: THREE.Vector3
  show(v: number): void
  tick?(dt: number, t: number): void
  /** Discrete positions (the humour dial's three), else continuous. */
  steps?: number
  /** Show or hide a lock on the top position. */
  lock?(on: boolean): void
  /** Tapping a part sets the value directly (a xylophone bar, a spool); null for any other part. */
  pick?(part: THREE.Object3D): number | null
  /** How to use it, shown as a stitched arrow: along its axis (drag), or round a point (turn). */
  gesture: 'drag' | { turn: THREE.Vector3; radius: number }
  /** Show the tool nudged a little off its value (d in -1..1) without changing it. */
  wiggle?(d: number): void
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
    key: 'size', group: g, glow: [caseMat], gesture: 'drag',
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
    key: 'hue', group: g, glow: [wood], gesture: 'drag',
    pick(part) {
      const i = spools.findIndex((s) => { let o: THREE.Object3D | null = part; while (o && o !== s.group) o = o.parent; return o === s.group })
      return i < 0 ? null : i / (n - 1)
    },
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
    key: 'pitch', group: g, glow: [frame], gesture: 'drag',
    pick(part) {
      const i = bars.findIndex((b) => b === part)
      return i < 0 ? null : i / (n - 1)
    },
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
    key: 'pace', group: g, glow: [wood], rate: 1, gesture: 'drag',
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
    gesture: { turn: new THREE.Vector3(0.05, 0.028, 0), radius: 0.03 },
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
  let at = 0.5
  return {
    key: 'humour', group: g, glow: [wood], steps: 3,
    axis: null,
    gesture: { turn: new THREE.Vector3(0, 0.03, 0), radius: 0.055 },
    tagAt: new THREE.Vector3(0, 0, -0.14),
    show(v) {
      at = v
      knob.rotation.y = -(Math.round(v * 2) - 1) * 0.95
    },
    wiggle(d) {
      knob.rotation.y = -(Math.round(at * 2) - 1) * 0.95 - d * 0.3
    },
    lock(on) {
      padlock.visible = on
    },
  }
}

/** A grosgrain ribbon with a stitched edge and a button that slides along it; its ends are labelled by paper tags. */
function ribbon(key: Key, ground: string): Tool {
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
    const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const ribbonMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 })
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.002, 0.046), ribbonMat)
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
  const x0 = -0.11, x1 = 0.11
  return {
    key, group: g, glow: [disc.material as THREE.MeshStandardMaterial], gesture: 'drag',
    axis: [new THREE.Vector3(x0, 0, 0), new THREE.Vector3(x1, 0, 0)],
    tagAt: new THREE.Vector3(-0.185, 0, 0),
    endAt: new THREE.Vector3(0.185, 0, 0),
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
  /** Lock a stepped tool's top position (crude humour): the dial stops one short, shows a padlock, and its tag leaves the word out. */
  lock(key: Key, on: boolean): void
  /** Pin a tool at a value it cannot be moved from (a jokes level the host locks), or free it with null. */
  fix(key: Key, v: number | null): void
  /** 'off' hides the tags, 'preview' shows them quietly with nothing to grab, 'on' makes the tools work. */
  mode(state: 'off' | 'preview' | 'on'): void
  /** Lay the tools out for a wide screen (one row along the near edge) or a narrow one (a grid before the mat). */
  arrange(layout: Layout): void
  /** The thread colours for the colour rail: the main felt turned through the slider's range. */
  felt(main: THREE.Color): void
  /** Metronome tempo, as a multiple of the made pace. */
  tempo(rate: number): void
  /** Move keyboard focus to a tool's tag. */
  focus(key: Key): void
  /** The left edge on screen of the ribbons' left-hand tags, so the slip can keep clear of them (Infinity when hidden). */
  ribbonsLeft(): number
  /** Paper lying over the table (the slip): quiet preview tags under it are hidden, as the paper would hide them. */
  under(rect: DOMRect | null): void
  /** Each tool's bounds on the page, for the layout gate. */
  rects(): { key: Key; left: number; top: number; right: number; bottom: number }[]
  /** Where a tool's handle (its value's end of the axis) is on screen, for the checks. */
  screen(key: Key): { x: number; y: number }
  /** #47 regroup: show the tags of only these tools (null: all), so one tool can be used at a time. */
  only(keys: Key[] | null): void
  /** #47 regroup: put one tool somewhere else than its place on the bench (in a tin, held up), or back with null. */
  override(key: Key, at: { pos: THREE.Vector3; turn: number; scale: number; tilt?: number; quat?: THREE.Quaternion } | null): void
  /** #47 regroup: a tool's two ends on screen (its axis, or either side of a dial), for labelling them. */
  ends(key: Key): [{ x: number; y: number }, { x: number; y: number }]
  frame(dt: number, t: number): void
  dispose(): void
}

export type Layout = 'wide' | 'narrow'

/**
 * Where each tool sits, in world space: [x, z, turn, scale]. Wide: one row along the near edge, the
 * ribbons right of the mat and the stitch dial by the mug. Narrow (a phone held upright): the three
 * ribbons before the mat, each labelled at both ends, then two rows of three tools, each tag lying just
 * under its own tool.
 */
const PLACES: Record<Layout, Record<Key, [number, number, number, number]>> = {
  wide: {
    size: [-0.99, 0.5, 0.2, 1],
    pace: [-0.6, 0.5, -0.15, 1],
    hue: [-0.3, 0.575, 0.02, 1],
    pitch: [0.07, 0.545, 0, 1],
    energy: [0.45, 0.56, -0.45, 1],
    warmth: [0.47, 0.11, -0.04, 1],
    playful: [0.47, 0.235, -0.04, 1],
    chatty: [0.47, 0.36, -0.04, 1],
    humour: [-0.98, 0.25, 0.15, 1],
  },
  narrow: {
    size: [-0.46, 0.45, 0.1, 0.7],
    hue: [-0.21, 0.45, 0, 0.62],
    pitch: [0.04, 0.45, 0, 0.62],
    pace: [-0.4, 0.595, -0.2, 0.72],
    humour: [-0.21, 0.6, 0, 0.62],
    energy: [-0.01, 0.595, -0.4, 0.72],
    warmth: [-0.21, 0.17, 0, 0.62],
    playful: [-0.21, 0.25, 0, 0.62],
    chatty: [-0.21, 0.33, 0, 0.62],
  },
}


/** Narrow: the stitch dial's tag lies in front of it, as every grid tool's does. */
const DIAL_FRONT = new THREE.Vector3(0, 0, 0.13)

export function controls(stage: Stage, hooks: { input(key: Key, v: number): void; release(key: Key, v: number): void; locked(key: Key): void }): Controls {
  const group = new THREE.Group()
  group.name = 'villager workshop controls'
  const rail = spoolRail()
  const pace = metronome()
  const tools: Tool[] = [
    tapeMeasure(), rail, xylophone(), pace, windupKey(),
    ribbon('warmth', '#c4553f'),
    ribbon('playful', '#d6b45c'),
    ribbon('chatty', '#6f86a8'),
    stitchDial(),
  ]
  const toolOf = (key: Key) => tools.find((t) => t.key === key)!
  const locked = new Set<Key>()
  const fixed = new Map<Key, number>()
  let nudged = false
  const values = Object.fromEntries(KEYS.map((k) => [k, 0.5])) as Record<Key, number>
  for (const tool of tools) {
    tool.group.name = `workshop ${tool.key}`
    tool.group.traverse((n) => { n.castShadow = n.receiveShadow = true })
    group.add(tool.group)
    tool.show(0.5)
  }
  let layout: Layout = 'wide'
  let lift: Partial<Record<Key, number>> = {}
  const overrides = new Map<Key, { pos: THREE.Vector3; turn: number; scale: number; tilt?: number; quat?: THREE.Quaternion }>()
  let only: Set<Key> | null = null
  const baseY = (key: Key) => overrides.get(key)?.pos.y ?? TOP
  const place = () => {
    for (const tool of tools) {
      const o = overrides.get(tool.key)
      const [x, z, ry, k] = o ? [o.pos.x, o.pos.z, o.turn, o.scale] : PLACES[layout][tool.key]
      tool.group.position.set(x, baseY(tool.key) + (lift[tool.key] ?? 0) * 0.008, z)
      if (o?.quat) tool.group.quaternion.copy(o.quat)
      else tool.group.rotation.set(o?.tilt ?? 0, ry, 0, 'YXZ')
      tool.group.scale.setScalar(k)
    }
  }
  place()
  let enabled = false

  // ── The tags: real sliders for the keyboard and screen readers ──────────
  // Each tool's tag says what it is and what its two ends do, with a stitch and a bead for where it is
  // now. A ribbon's tags are its two end words; the left one is the slider, the right one a label.
  const shelf = document.createElement('div')
  shelf.className = 'vs-tools'
  shelf.setAttribute('role', 'group')
  shelf.setAttribute('aria-label', 'Tune the villager')
  const tags = new Map<Key, HTMLDivElement>()
  const ends = new Map<Key, HTMLDivElement>()
  const beads = new Map<Key, HTMLElement>()
  const swatches: HTMLElement[] = []
  const marks: HTMLElement[] = []
  for (const tool of tools) {
    const tag = document.createElement('div')
    tag.className = 'vs-tool vs-tag'
    tag.tabIndex = -1
    tag.dataset.key = tool.key
    tag.setAttribute('role', 'slider')
    tag.setAttribute('aria-label', LABEL[tool.key].aria)
    tag.setAttribute('aria-valuemin', '0')
    tag.setAttribute('aria-valuemax', '100')
    const [lo, hi] = LABEL[tool.key].ends
    if (RIBBONS.includes(tool.key)) {
      tag.classList.add('end', 'lo')
      tag.textContent = lo
      const end = document.createElement('div')
      end.className = 'vs-end vs-tag end hi'
      end.setAttribute('aria-hidden', 'true')
      end.dataset.key = tool.key
      end.textContent = hi
      ends.set(tool.key, end)
    } else {
      const name = document.createElement('b')
      name.textContent = LABEL[tool.key].tag
      const gauge = document.createElement('span')
      gauge.className = 'ga'
      gauge.setAttribute('aria-hidden', 'true')
      if (tool.key === 'humour') {
        for (const word of HUMOUR) {
          const m = document.createElement('i')
          m.textContent = word
          m.dataset.step = word
          marks.push(m)
          gauge.append(m)
        }
      } else {
        const track = document.createElement('span')
        track.className = 'tr'
        const bead = document.createElement('span')
        bead.className = 'bd'
        track.append(bead)
        beads.set(tool.key, bead)
        if (tool.key === 'hue') {
          const a = document.createElement('span'), b = document.createElement('span')
          a.className = b.className = 'sw'
          swatches.push(a, b)
          gauge.append(a, track, b)
        } else {
          const a = document.createElement('i'), b = document.createElement('i')
          a.textContent = lo
          b.textContent = hi
          gauge.append(a, track, b)
        }
      }
      tag.append(name, gauge)
      // The stitch dial's tag stands behind it, so it hangs upward from its anchor.
      if (tool.key === 'humour') tag.classList.add('up')
    }
    shelf.append(tag)
    tags.set(tool.key, tag)
  }
  // The right-hand ribbon ends after every slider, so Tab order stays tool by tool.
  for (const end of ends.values()) shelf.append(end)
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  document.body.append(shelf)

  // How to use each tool: a stitched thread-blue arrow beside it (along its axis for a drag, round it for a turn),
  // and the tool nudging itself once. Shown on hover or focus, and once for each tool as the tools come out.
  const SVG = 'http://www.w3.org/2000/svg'
  const hints = document.createElementNS(SVG, 'svg')
  hints.classList.add('vs-hints')
  hints.setAttribute('aria-hidden', 'true')
  const hintPath = new Map<Key, SVGPathElement>()
  for (const tool of tools) {
    const path = document.createElementNS(SVG, 'path')
    path.classList.add('vs-hint')
    hints.append(path)
    hintPath.set(tool.key, path)
  }
  shelf.append(hints)
  /** The frame clock, so events can start a nudge in the frame's own time. */
  let clock = 0
  const nudges = new Map<Key, number>()
  /** Hints shown for a while: as the tools come out, or on hover. */
  const timed = new Map<Key, { from: number; until: number }>()
  let hover: Key | null = null
  const nudge = (key: Key) => {
    if (!reducedMotion.matches && !nudges.has(key)) nudges.set(key, clock)
  }
  const hoverTo = (key: Key | null) => {
    if (key === hover) return
    hover = key
    if (key) nudge(key)
  }

  const glow = (tool: Tool, on: number) => {
    for (const m of tool.glow) {
      m.emissive.set('#ffcf8a')
      m.emissiveIntensity = on * 0.35
    }
    lift[tool.key] = on
    tool.group.position.y = baseY(tool.key) + on * 0.008
    tags.get(tool.key)!.classList.toggle('on', on > 0)
    ends.get(tool.key)?.classList.toggle('on', on > 0)
  }
  /** The tag's reading of a value: the bead along its stitch, or the humour word in ink. */
  const read = (key: Key, v: number) => {
    const tag = tags.get(key)!
    tag.setAttribute('aria-valuenow', String(Math.round(v * 100)))
    tag.setAttribute('aria-valuetext', valueText(key, v))
    const bead = beads.get(key)
    if (bead) bead.style.left = `${(v * 100).toFixed(1)}%`
    if (key === 'humour') for (const m of marks) m.classList.toggle('at', m.dataset.step === HUMOUR[Math.round(v * 2)])
  }
  const apply = (key: Key, v: number) => {
    v = Math.min(1, Math.max(0, v))
    const tool = toolOf(key)
    if (tool.steps) v = Math.round(v * (tool.steps - 1)) / (tool.steps - 1)
    if (fixed.has(key)) {
      const at = fixed.get(key)!
      if (v !== at && (values[key] !== v || !nudged)) hooks.locked(key)
      nudged = v !== at
      v = at
    } else if (locked.has(key) && v >= 1) {
      v = (tool.steps! - 2) / (tool.steps! - 1)
      if (values[key] !== v || !nudged) hooks.locked(key)
      nudged = true
    } else nudged = false
    if (values[key] === v && tool.steps) return
    values[key] = v
    tool.show(v)
    read(key, v)
    hooks.input(key, v)
  }
  for (const k of KEYS) read(k, 0.5)

  // Keyboard: arrows nudge, Page keys jump, Home and End go to the ends. One phrase per run of presses.
  let releaseTimer = 0
  const onKey = (e: KeyboardEvent) => {
    const key = (e.currentTarget as HTMLElement).dataset.key as Key
    if (!enabled) return
    const step = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05, PageUp: 0.2, PageDown: -0.2 }[e.key]
    let v: number | null = null
    const stepped = toolOf(key).steps
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
    tag.addEventListener('focus', () => {
      glow(toolOf(tag.dataset.key as Key), 1)
      nudge(tag.dataset.key as Key)
    })
    tag.addEventListener('blur', () => glow(toolOf(tag.dataset.key as Key), 0))
  }
  for (const el of [...tags.values(), ...ends.values()]) {
    el.addEventListener('pointerenter', () => enabled && hoverTo(el.dataset.key as Key))
    el.addEventListener('pointerleave', () => hoverTo(null))
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
  let hitPart: THREE.Object3D | null = null
  const hit = (e: PointerEvent): Tool | null => {
    const r = canvas.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    raycaster.setFromCamera(ndc, stage.camera)
    const found = raycaster.intersectObject(group, true)[0]
    hitPart = found?.object ?? null
    if (!found) return null
    return tools.find((t) => { let o: THREE.Object3D | null = found.object; while (o && o !== t.group) o = o.parent; return o === t.group }) ?? null
  }
  const begin = (tool: Tool, e: PointerEvent, part?: THREE.Object3D) => {
    // A tap on a bar or a spool sets it there; the drag goes on from that value.
    const tapped = part && tool.pick ? tool.pick(part) : null
    if (tapped !== null) apply(tool.key, tapped)
    nudges.delete(tool.key)
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
    begin(tool, e, hitPart ?? undefined)
  }
  const onTagDown = (e: PointerEvent) => {
    if (!enabled || e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    const key = el.dataset.key as Key
    tags.get(key)!.focus({ preventScroll: true })
    e.preventDefault()
    begin(toolOf(key), e)
  }
  const onMove = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) {
      const dv = ((e.clientX - drag.x) * drag.dir.x + (e.clientY - drag.y) * drag.dir.y) / drag.len2
      apply(drag.tool.key, drag.v + dv)
      return
    }
    if (enabled && e.pointerType !== 'touch' && e.target === canvas) {
      const over = hit(e)
      canvas.style.cursor = over ? 'grab' : canvas.style.cursor === 'grab' ? '' : canvas.style.cursor
      hoverTo(over?.key ?? null)
    }
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
  for (const el of [...tags.values(), ...ends.values()]) el.addEventListener('pointerdown', onTagDown)
  addEventListener('pointermove', onMove)
  addEventListener('pointerup', onUp)
  addEventListener('pointercancel', onUp)

  const anchor = new THREE.Vector3()
  let shown: 'off' | 'preview' | 'on' = 'off'
  let cover: DOMRect | null = null
  /** Pins a tag to a point on its tool, its middle no higher than minY; returns where its middle went. */
  const pin = (el: HTMLElement, at: THREE.Vector3, tool: Tool, r: DOMRect, minY = -Infinity) => {
    anchor.copy(at).applyMatrix4(tool.group.matrixWorld).project(stage.camera)
    const x = Math.round(r.left + ((anchor.x + 1) / 2) * r.width)
    const y = Math.max(Math.round(r.top + ((1 - anchor.y) / 2) * r.height), Math.round(minY))
    // A ribbon's tags hang off its ends, outward; every other tag hangs under its tool.
    const t = el.classList.contains('lo') ? `calc(${x}px - 100%) calc(${y}px - 50%)` : el.classList.contains('hi') ? `${x}px calc(${y}px - 50%)` : el.classList.contains('up') ? `calc(${x}px - 50%) calc(${y}px - 100%)` : `calc(${x}px - 50%) ${y}px`
    if (el.style.translate !== t) el.style.translate = t
    return y
  }
  const heights = new Map<HTMLElement, number>()
  const heightOf = (el: HTMLElement) => heights.get(el) || (heights.set(el, el.offsetHeight), el.offsetHeight)

  /** A tool's stitched arrow, in page pixels: a double-headed curve beside its axis, or most of a ring round its turning point. */
  const arrow = (tool: Tool) => {
    tool.group.updateMatrixWorld()
    const head = (tip: THREE.Vector2, along: THREE.Vector2) => {
      const a = along.clone().normalize().multiplyScalar(-7)
      const l = a.clone().rotateAround(new THREE.Vector2(), 0.55).add(tip), m = a.clone().rotateAround(new THREE.Vector2(), -0.55).add(tip)
      return ` M ${l.x.toFixed(1)} ${l.y.toFixed(1)} L ${tip.x.toFixed(1)} ${tip.y.toFixed(1)} L ${m.x.toFixed(1)} ${m.y.toFixed(1)}`
    }
    if (tool.gesture === 'drag' && tool.axis) {
      const a = toScreen(tool.axis[0].clone().applyMatrix4(tool.group.matrixWorld))
      const b = toScreen(tool.axis[1].clone().applyMatrix4(tool.group.matrixWorld))
      const d = b.clone().sub(a)
      // Beside the axis, on the screen's upper side (or left of an upright one), clear of the tool itself.
      let n = new THREE.Vector2(-d.y, d.x).normalize()
      if (n.y > 0.2 || (Math.abs(n.y) <= 0.2 && n.x > 0)) n.negate()
      const lift = layout === 'narrow' ? 12 : 16
      const p = a.clone().addScaledVector(d, 0.08).addScaledVector(n, lift), q = a.clone().addScaledVector(d, 0.92).addScaledVector(n, lift)
      const c = p.clone().add(q).multiplyScalar(0.5).addScaledVector(n, 6)
      return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} Q ${c.x.toFixed(1)} ${c.y.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}` + head(q, q.clone().sub(c)) + head(p, p.clone().sub(c))
    }
    const turn = tool.gesture === 'drag' ? { turn: new THREE.Vector3(), radius: 0.04 } : tool.gesture
    const o = toScreen(turn.turn.clone().applyMatrix4(tool.group.matrixWorld))
    const edge = toScreen(turn.turn.clone().add(new THREE.Vector3(turn.radius, 0, 0)).applyMatrix4(tool.group.matrixWorld))
    const rad = Math.max(14, Math.min(60, o.distanceTo(edge) + 8))
    // From the left, over the top, round to the right: a turn.
    const at = (a: number) => new THREE.Vector2(o.x + Math.cos(a) * rad, o.y + Math.sin(a) * rad * 0.62)
    const from = at(Math.PI * 0.95), to = at(Math.PI * 2.15), mid = at(Math.PI * 1.55)
    return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} A ${rad.toFixed(1)} ${(rad * 0.62).toFixed(1)} 0 1 1 ${to.x.toFixed(1)} ${to.y.toFixed(1)}` + head(to, to.clone().sub(mid).rotateAround(new THREE.Vector2(), -0.9))
  }

  return {
    group,
    values,
    set: (key, v) => apply(key, v),
    init(start) {
      for (const tool of tools) {
        const v = Math.min(1, Math.max(0, start[tool.key] ?? 0.5))
        values[tool.key] = v
        tool.show(v)
        read(tool.key, v)
      }
    },
    mode(state) {
      // The tools coming out: each shows how it is used, once, one after another.
      if (state === 'on' && shown !== 'on') tools.forEach((tool, i) => timed.set(tool.key, { from: clock + 0.6 + i * 0.32, until: clock + 2.4 + i * 0.32 }))
      if (state !== 'on') {
        timed.clear()
        hover = null
        for (const path of hintPath.values()) path.classList.remove('shown')
      }
      shown = state
      enabled = state === 'on'
      shelf.classList.toggle('shown', state === 'on')
      shelf.classList.toggle('preview', state === 'preview')
      for (const tag of tags.values()) tag.tabIndex = enabled ? 0 : -1
    },
    arrange(next) {
      layout = next
      shelf.dataset.layout = next
      // Narrow, the dial sits in the grid like the rest, so its tag lies under it too.
      tags.get('humour')!.classList.toggle('up', next === 'wide')
      place()
    },
    felt(main) {
      const list = Array.from({ length: 7 }, (_, i) => rotateHue(main, (i / 6 - 0.5) * 2 * HUE_SPAN))
      rail.colours(list)
      // The colour tag's two swatches are the rail's end threads.
      swatches[0].style.background = `#${list[0].getHexString()}`
      swatches[1].style.background = `#${list[6].getHexString()}`
    },
    tempo(rate) {
      pace.rate = rate
    },
    lock(key, on) {
      if (on) locked.add(key)
      else locked.delete(key)
      toolOf(key).lock?.(on)
      // Crude is shown on the tag only as a level the household's admin set (fix), never as a choice.
      if (key === 'humour') marks.at(-1)!.hidden = on && fixed.get(key) !== 1
      if (on && values[key] >= 1 && !fixed.has(key)) apply(key, 1)
    },
    fix(key, v) {
      if (v === null) fixed.delete(key)
      else fixed.set(key, v)
      toolOf(key).lock?.(v !== null || locked.has(key))
      // Pinned, the tag shows only the level it is pinned at; free, clean and cheeky (crude only if not locked).
      if (key === 'humour') for (const m of marks) m.hidden = v !== null ? m.dataset.step !== HUMOUR[Math.round(v * 2)] : m === marks.at(-1) && locked.has(key)
      if (v !== null) {
        values[key] = v
        toolOf(key).show(v)
        read(key, v)
      }
    },
    focus(key) {
      tags.get(key)!.focus({ preventScroll: true })
    },
    under(rect) {
      cover = rect
    },
    ribbonsLeft() {
      // Their tags show only while tuning; before that there is nothing of theirs for the slip to keep clear of.
      if (shown !== 'on') return Infinity
      return Math.min(...RIBBONS.map((k) => tags.get(k)!.getBoundingClientRect().left))
    },
    rects() {
      const box = new THREE.Box3()
      const p = new THREE.Vector3()
      return tools.map((tool) => {
        box.setFromObject(tool.group)
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
        for (let i = 0; i < 8; i++) {
          const q = toScreen(p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z))
          left = Math.min(left, q.x); right = Math.max(right, q.x); top = Math.min(top, q.y); bottom = Math.max(bottom, q.y)
        }
        return { key: tool.key, left, top, right, bottom }
      })
    },
    screen(key) {
      const tool = toolOf(key)
      tool.group.updateMatrixWorld(true)
      const p = tool.axis ? new THREE.Vector3().lerpVectors(tool.axis[0], tool.axis[1], values[key]) : new THREE.Vector3(0.05, 0.03, 0)
      const q = toScreen(p.applyMatrix4(tool.group.matrixWorld))
      return { x: q.x, y: q.y }
    },
    only(keys) {
      only = keys ? new Set(keys) : null
      for (const [key, el] of [...tags, ...ends]) el.hidden = Boolean(only && !only.has(key))
    },
    override(key, at) {
      if (at) overrides.set(key, at)
      else overrides.delete(key)
      place()
    },
    ends(key) {
      const tool = toolOf(key)
      tool.group.updateMatrixWorld(true)
      if (tool.axis) {
        const a = toScreen(tool.axis[0].clone().applyMatrix4(tool.group.matrixWorld)), b = toScreen(tool.axis[1].clone().applyMatrix4(tool.group.matrixWorld))
        return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }]
      }
      const turn = tool.gesture === 'drag' ? { turn: new THREE.Vector3(), radius: 0.04 } : tool.gesture
      const a = toScreen(turn.turn.clone().add(new THREE.Vector3(-turn.radius * 1.6, 0, 0)).applyMatrix4(tool.group.matrixWorld))
      const b = toScreen(turn.turn.clone().add(new THREE.Vector3(turn.radius * 1.6, 0, 0)).applyMatrix4(tool.group.matrixWorld))
      return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }]
    },
    frame(dt, t) {
      clock = t
      for (const tool of tools) tool.tick?.(dt, t)
      for (const [key, from] of nudges) {
        const u = (t - from) / 0.9
        const tool = toolOf(key)
        if (u >= 1 || drag?.tool === tool) {
          nudges.delete(key)
          tool.show(values[key])
          continue
        }
        // Out one way and back, easing off: about a tenth of the way along, or a click of the dial.
        const d = Math.sin(u * Math.PI * 2) * (1 - u) * 1.3
        if (tool.wiggle) tool.wiggle(d)
        else tool.show(Math.min(1, Math.max(0, values[key] + d * 0.09)))
      }
      for (const [key, h] of timed) {
        if (t >= h.from && t < h.from + 0.1) nudge(key)
        if (t >= h.until) timed.delete(key)
      }
      if (shown === 'off') return
      const r = canvas.getBoundingClientRect()
      // The ribbons' rows of end tags stack: when the camera is far (a phone, a tall villager) a row never rides up onto the one above.
      let floor = -Infinity
      for (const tool of tools) {
        tool.group.updateMatrixWorld()
        const row = RIBBONS.includes(tool.key) ? floor : -Infinity
        const tag = tags.get(tool.key)!
        const y = pin(tag, layout === 'narrow' && tool.key === 'humour' ? DIAL_FRONT : tool.tagAt, tool, r, row)
        const end = ends.get(tool.key)
        if (end && tool.endAt) pin(end, tool.endAt, tool, r, row)
        if (RIBBONS.includes(tool.key)) floor = y + heightOf(tag) + 2
      }
      // The arrows: for the tool being hovered, focused or dragged, and those in the coming-out sequence.
      const focused = (document.activeElement as HTMLElement | null)?.dataset?.key
      for (const tool of tools) {
        const path = hintPath.get(tool.key)!
        const h = timed.get(tool.key)
        const on = shown === 'on' && (!only || only.has(tool.key)) && (tool.key === hover || tool.key === focused || drag?.tool === tool || Boolean(h && t >= h.from))
        path.classList.toggle('shown', on)
        if (on) path.setAttribute('d', arrow(tool))
      }
      if (shown === 'preview') {
        for (const el of [...tags.values(), ...ends.values()]) {
          const b = el.getBoundingClientRect()
          el.classList.toggle('under', Boolean(cover && b.left < cover.right && cover.left < b.right && b.top < cover.bottom && cover.top < b.bottom))
        }
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

/**
 * The one paper-tag style for every label in the workshop (tools, ribbon ends, pattern names, the
 * save and send-off tags): cream card, a punched hole, handwriting. Active (focused or dragged) is the
 * same tag lifted, with a stitched thread-blue edge.
 */
export const TAG_CSS = `
  .vs-tag { box-sizing: border-box; padding: 4px 11px 5px; border-radius: 4px 9px 9px 4px; color: #4a3220;
    background: linear-gradient(180deg, #fffaf0, #f4e6c9); font: 700 18px/1.15 ${HAND}; white-space: nowrap;
    box-shadow: 0 3px 8px rgba(60, 30, 10, 0.22), inset 0 0 0 1px rgba(150, 100, 60, 0.2); }
  .vs-tag.on, .vs-tag:focus-visible { outline: none; color: #23395a; transform: translateY(-2px);
    box-shadow: 0 6px 14px rgba(60, 30, 10, 0.3), inset 0 0 0 1px rgba(150, 100, 60, 0.2); }
  .vs-tag.on::after, .vs-tag:focus-visible::after { content: ''; position: absolute; inset: 3px; border: 1.6px dashed rgba(47, 74, 107, 0.75); border-radius: 3px 7px 7px 3px; pointer-events: none; }
`

function css() {
  return `
  ${TAG_CSS}
  .vs-tools { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
  .vs-tool, .vs-end { position: absolute; left: 0; top: 0; cursor: grab; touch-action: none; user-select: none;
    opacity: 0; pointer-events: none; transition: opacity 260ms ease; }
  .vs-tool { display: flex; flex-direction: column; align-items: center; gap: 1px; padding-left: 13px; }
  .vs-tool::before, .vs-end.lo::before { content: ''; position: absolute; left: 4px; top: 50%; width: 6px; height: 6px; margin-top: -3px; border-radius: 50%;
    background: #e9dcc0; box-shadow: inset 0 0 0 1.5px rgba(120, 80, 50, 0.45); }
  .vs-end.hi { padding-left: 11px; padding-right: 13px; border-radius: 9px 4px 4px 9px; }
  .vs-end.hi::before { content: ''; position: absolute; right: 4px; top: 50%; width: 6px; height: 6px; margin-top: -3px; border-radius: 50%;
    background: #e9dcc0; box-shadow: inset 0 0 0 1.5px rgba(120, 80, 50, 0.45); }
  .vs-tool b { font-weight: 700; }
  .vs-tool .ga { display: flex; align-items: center; gap: 5px; font: 700 14px/1.1 ${HAND}; color: #6a5039; }
  .vs-tool .ga i { font-style: normal; }
  .vs-tool .tr { position: relative; width: 30px; height: 2px; background: repeating-linear-gradient(90deg, rgba(106, 80, 57, 0.6) 0 4px, transparent 4px 7px); }
  .vs-tool .bd { position: absolute; top: 50%; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: #2f4a6b; box-shadow: 0 1px 1px rgba(0,0,0,.25); }
  .vs-tool .sw { width: 11px; height: 11px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(60, 30, 10, 0.3); background: #d9a35f; }
  .vs-tool .ga i[data-step] { opacity: 0.55; }
  .vs-tool .ga i.at { opacity: 1; color: #23395a; text-decoration: underline 1.5px; text-underline-offset: 3px; }
  .vs-tool .ga i.locked { opacity: 0.4; text-decoration: line-through 1px; }
  .vs-tools.shown .vs-tool, .vs-tools.shown .vs-end { opacity: 1; pointer-events: auto; }
  .vs-tools.preview .vs-tool, .vs-tools.preview .vs-end { opacity: 0.6; }
  .vs-tools.preview .under { opacity: 0; }
  .vs-tools [hidden] { display: none !important; }
  /* Before there is a villager the first choice is the slip or a pattern card: the tools carry no labels yet. */
  .vs-tools.preview .vs-tool, .vs-tools.preview .vs-end { display: none; }
  .vs-hints { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
  .vs-hint { fill: none; stroke: #2f4a6b; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 5 4;
    filter: drop-shadow(0 1px 0 rgba(255, 250, 235, 0.85)); opacity: 0; transition: opacity 220ms ease; }
  .vs-hint.shown { opacity: 0.85; }
  .vs-tools.shown .vs-tag:hover { transform: translateY(-1px); }
  .vs-tools[data-layout=narrow] .vs-tag { font-size: 15px; padding: 3px 8px 4px; }
  .vs-tools[data-layout=narrow] .vs-tool { padding-left: 11px; }
  .vs-tools[data-layout=narrow] .vs-end.hi { padding-right: 11px; }
  .vs-tools[data-layout=narrow] .vs-tool .ga { font-size: 12px; gap: 3px; }
  .vs-tools[data-layout=narrow] .vs-tool .tr { width: 22px; }
  @media (prefers-reduced-motion: reduce) { .vs-tool, .vs-end, .vs-hint { transition: none; } }
  `
}
