// #47: the trusted spec interpreter. check() turns untrusted JSON into a VillagerSpec
// (every number clamped to RANGES, unknown enum values replaced, colours checked);
// build() makes a felt-plush Figure for the shared rig from the kinds.ts felt kit.
// Nothing in a spec is executed; the owner's accent comes from the caller, never the spec.
import * as THREE from 'three/webgpu'
import { canvas, rng, toTexture } from '../../paint'
import { buttonEye, faceTexture, feltKit, feltTexture, fuzzFill, hand, mesh, part, prop as heldBase, skeleton, srgb, stitchPath, type Prop } from '../kinds'
import type { Figure, Villager } from '../rig'
import { ENUMS, PERSONA_TEXT, RANGES, type Accessory, type BodyShape, type HeldProp, type VillagerSpec, type VoiceSpec } from './spec'

// ─── check ────────────────────────────────────────────────────────────────

export const DEFAULT: VillagerSpec = {
  name: 'Button', role: 'carer', bark: 'Hello!',
  body: { shape: 'round', r: 0.17, tall: 1.1, head: 0.82, legs: 0 },
  face: { snout: 'muzzle', ears: 'round', eyes: 1 },
  tail: 'none', back: 'none', pattern: 'belly',
  palette: { felt: '#c9a27a', belly: '#f2e4cc', inner: '#e8a3a0' },
  accessories: [], prop: 'none',
  gait: { speed: 0.38, stride: 0.24, bob: 0.04, stepped: true, fidget: 0.3 },
  voice: { pitch: 240, range: 3, formant: 1.1, rate: 10, breath: 0.1, wobble: 0.25, wobbleRate: 5, tilt: 1.6, gain: 0.9 },
}
const MAX_ACCESSORIES = 3
const HEX = /^#[0-9a-f]{6}$/i

export interface Checked { spec: VillagerSpec; fixes: string[] }

/**
 * Untrusted text to at most `max` characters of single-spaced text. Cut first, so the cost does not
 * grow with the input; a cut lands on a word boundary when there is one in the last third.
 */
function cap(v: string, max: number) {
  const s = v.slice(0, 4 * max).replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.66 ? cut.slice(0, space) : cut).replace(/[\s,;:-]+$/, '')
}

/** A short note of an untrusted value for `fixes`; its cost never grows with the value's size. */
const brief = (v: unknown, n: number) => (typeof v === 'string' ? JSON.stringify(v.slice(0, n)) : v !== null && typeof v === 'object' ? (Array.isArray(v) ? 'an array' : 'an object') : String(v).slice(0, n))

/** Untrusted JSON to a spec. Never fails: anything wrong is clamped or replaced, and listed in `fixes`. */
export function check(raw: unknown): Checked {
  const fixes: string[] = []
  // Own properties only, so "__proto__" or "constructor" keys are just missing fields.
  const own = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined)
  const num = (o: unknown, k: string, [lo, hi]: readonly [number, number], fallback: number, where: string) => {
    const v = own(o, k)
    if (typeof v !== 'number' || !Number.isFinite(v)) return fixes.push(`${where}: missing, ${fallback}`), fallback
    const c = Math.min(hi, Math.max(lo, v))
    if (c !== v) fixes.push(`${where}: ${v} -> ${c}`)
    return c
  }
  const pick = <T extends string>(o: unknown, k: string, options: readonly T[], fallback: T, where: string): T => {
    const v = own(o, k)
    if (typeof v === 'string' && (options as readonly string[]).includes(v)) return v as T
    fixes.push(`${where}: ${brief(v, 30)} -> ${fallback}`)
    return fallback
  }
  const text = (o: unknown, k: string, max: number, fallback: string, where: string) => {
    const v = own(o, k)
    const s = typeof v === 'string' ? cap(v, max) : ''
    if (s) return s
    fixes.push(`${where}: missing`)
    return fallback
  }
  const hex = (o: unknown, k: string, fallback: string, where: string) => {
    const v = own(o, k)
    if (typeof v === 'string' && HEX.test(v)) return v.toLowerCase()
    fixes.push(`${where}: ${brief(v, 20)} -> ${fallback}`)
    return fallback
  }
  const D = DEFAULT
  const body = own(raw, 'body'), face = own(raw, 'face'), palette = own(raw, 'palette'), gait = own(raw, 'gait'), voice = own(raw, 'voice')
  const accessoriesRaw = own(raw, 'accessories')
  const accessories: Accessory[] = []
  if (Array.isArray(accessoriesRaw)) {
    for (const a of accessoriesRaw) {
      if (typeof a !== 'string' || !(ENUMS.accessory as readonly string[]).includes(a)) { fixes.push(`accessory ${brief(a, 20)} dropped`); continue }
      if (a === 'none' || accessories.includes(a as Accessory)) continue
      if (accessories.length >= MAX_ACCESSORIES) { fixes.push(`accessory ${a} dropped (at most ${MAX_ACCESSORIES})`); continue }
      accessories.push(a as Accessory)
    }
  } else if (accessoriesRaw !== undefined) fixes.push('accessories: not a list')
  const patternColour = own(palette, 'pattern')
  const v = RANGES.voice
  const spec: VillagerSpec = {
    name: text(raw, 'name', 24, D.name, 'name'),
    role: pick(raw, 'role', ENUMS.role, D.role, 'role'),
    bark: text(raw, 'bark', 140, D.bark, 'bark'),
    body: {
      shape: pick(body, 'shape', ENUMS.shape, D.body.shape, 'body.shape'),
      r: num(body, 'r', RANGES.body.r, D.body.r, 'body.r'),
      tall: num(body, 'tall', RANGES.body.tall, D.body.tall, 'body.tall'),
      head: num(body, 'head', RANGES.body.head, D.body.head, 'body.head'),
      legs: num(body, 'legs', RANGES.body.legs, D.body.legs, 'body.legs'),
    },
    face: {
      snout: pick(face, 'snout', ENUMS.snout, D.face.snout, 'face.snout'),
      ears: pick(face, 'ears', ENUMS.ears, D.face.ears, 'face.ears'),
      eyes: num(face, 'eyes', RANGES.eyes, D.face.eyes, 'face.eyes'),
    },
    tail: pick(raw, 'tail', ENUMS.tail, D.tail, 'tail'),
    back: pick(raw, 'back', ENUMS.back, D.back, 'back'),
    pattern: pick(raw, 'pattern', ENUMS.pattern, D.pattern, 'pattern'),
    palette: {
      felt: hex(palette, 'felt', D.palette.felt, 'palette.felt'),
      belly: hex(palette, 'belly', D.palette.belly, 'palette.belly'),
      inner: hex(palette, 'inner', D.palette.inner, 'palette.inner'),
      ...(patternColour === undefined ? {} : { pattern: hex(palette, 'pattern', D.palette.inner, 'palette.pattern') }),
    },
    accessories,
    prop: pick(raw, 'prop', ENUMS.prop, D.prop, 'prop'),
    gait: {
      speed: num(gait, 'speed', RANGES.gait.speed, D.gait.speed, 'gait.speed'),
      stride: num(gait, 'stride', RANGES.gait.stride, D.gait.stride, 'gait.stride'),
      bob: num(gait, 'bob', RANGES.gait.bob, D.gait.bob, 'gait.bob'),
      stepped: typeof own(gait, 'stepped') === 'boolean' ? own(gait, 'stepped') as boolean : (fixes.push('gait.stepped: missing, true'), true),
      fidget: num(gait, 'fidget', RANGES.gait.fidget, D.gait.fidget, 'gait.fidget'),
    },
    voice: Object.fromEntries((Object.keys(v) as (keyof VoiceSpec)[]).map((k) => [k, num(voice, k, v[k], D.voice[k], `voice.${k}`)])) as unknown as VoiceSpec,
  }
  const persona = own(raw, 'persona')
  if (persona !== undefined) {
    const dials = own(persona, 'dials')
    const P = PERSONA_TEXT
    // Arrays are cut to their cap before anything looks at their items.
    const list = (k: string, n: number, max: number) => {
      const a = own(persona, k)
      if (!Array.isArray(a)) {
        fixes.push(`persona.${k}: not a list`)
        return []
      }
      if (a.length > n) fixes.push(`persona.${k}: kept ${n} of ${a.length}`)
      // Duplicates dropped: a repeated quirk reads as a glitch.
      return [...new Set(a.slice(0, n).map((x) => (typeof x === 'string' ? cap(x, max) : '')).filter(Boolean))]
    }
    spec.persona = {
      role: text(persona, 'role', P.role, spec.role, 'persona.role'),
      speciality: text(persona, 'speciality', P.speciality, spec.role, 'persona.speciality'),
      temperament: pick(persona, 'temperament', ENUMS.temperament, 'calm', 'persona.temperament'),
      register: pick(persona, 'register', ENUMS.register, 'plain', 'persona.register'),
      humour: pick(persona, 'humour', ENUMS.humour, 'none', 'persona.humour'),
      quirks: list('quirks', P.quirks, P.quirk),
      topics: list('topics', P.topics, P.topic),
      dials: {
        warmth: num(dials, 'warmth', RANGES.persona.warmth, 0.5, 'persona.dials.warmth'),
        playful: num(dials, 'playful', RANGES.persona.playful, 0.3, 'persona.dials.playful'),
        chatty: num(dials, 'chatty', RANGES.persona.chatty, 0.4, 'persona.dials.chatty'),
        humour: pick(dials, 'humour', ENUMS.humourDial, 'clean', 'persona.dials.humour'),
      },
    }
  }
  return { spec, fixes }
}

// ─── shapes ───────────────────────────────────────────────────────────────

/** Radius factor of each body shape at normalized height yn (-1 bottom, 1 top), and how far its middle leans forward. */
function profile(shape: BodyShape, yn: number): { s: number; z: number } {
  switch (shape) {
    case 'egg': return { s: 1.04 - 0.14 * yn, z: 0 }
    case 'pear': return { s: 0.96 - 0.22 * yn - 0.06 * yn * yn, z: 0 }
    case 'bean': return { s: 1 - 0.06 * yn, z: 0.13 * (1 - yn * yn) }
    case 'tall': return { s: 1, z: 0 }
    default: return { s: 1, z: 0 }
  }
}

/**
 * A unit sphere deformed into a body shape and scaled to (R, bodyH/2, R * depth).
 * Sphere UVs survive, so u = 0.25 still faces +z for the felt painters.
 */
function bodyGeometry(shape: BodyShape, R: number, halfH: number, depth: number, grow = 1, segments: [number, number] = [40, 24], slice?: [number, number, number, number]) {
  const g = slice ? new THREE.SphereGeometry(1, segments[0], segments[1], ...slice) : new THREE.SphereGeometry(1, segments[0], segments[1])
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const h = Math.hypot(x, z)
    if (shape === 'tall' && h > 1e-6) {
      // A soft column: the sides go straight, the top and bottom stay round.
      const k = Math.pow(1 - Math.pow(Math.abs(y), 3), 1 / 3) / h
      x *= k
      z *= k
    }
    const { s, z: lean } = profile(shape, y)
    p.setXYZ(i, x * R * s * grow, y * halfH * grow, (z * depth * s + lean) * R * grow)
  }
  g.computeVertexNormals()
  smoothSeam(g)
  return g
}

/** Average normals of vertices that share a position, so the sphere's seam and poles don't show. */
function smoothSeam(g: THREE.BufferGeometry) {
  const p = g.attributes.position as THREE.BufferAttribute
  const n = g.attributes.normal as THREE.BufferAttribute
  const groups = new Map<string, number[]>()
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`
    const list = groups.get(key)
    if (list) list.push(i)
    else groups.set(key, [i])
  }
  const v = new THREE.Vector3()
  for (const list of groups.values()) {
    if (list.length < 2) continue
    v.set(0, 0, 0)
    for (const i of list) v.x += n.getX(i), v.y += n.getY(i), v.z += n.getZ(i)
    v.normalize()
    for (const i of list) n.setXYZ(i, v.x, v.y, v.z)
  }
}

// ─── textures ─────────────────────────────────────────────────────────────

/** The body felt: fuzz, the belly patch, an optional pattern and the stitched seams (u = 0.25 faces +z). */
function bodyTexture(s: VillagerSpec, seed: number) {
  const { felt, belly } = s.palette
  const ink = s.palette.pattern ?? s.palette.inner
  if (s.pattern === 'plain') return feltTexture(felt, seed)
  if (s.pattern === 'belly') return feltTexture(felt, seed, { belly })
  const W = 256, H = 128
  const [c, g] = canvas(W, H)
  fuzzFill(g, W, H, seed, srgb(felt))
  const r = rng(seed + 7)
  g.fillStyle = ink
  if (s.pattern === 'spots') {
    for (let i = 0; i < 16; i++) {
      const x = r() * W, y = H * (0.15 + r() * 0.7), rad = 5 + r() * 7
      if (Math.abs(x - W * 0.25) < W * 0.1 && Math.abs(y - H * 0.5) < H * 0.24) continue
      g.beginPath()
      g.ellipse(x, y, rad, rad * 0.8, 0, 0, Math.PI * 2)
      g.fill()
      stitchPath(g, (t) => [x + Math.cos(t * Math.PI * 2) * rad, y + Math.sin(t * Math.PI * 2) * rad * 0.8], 8)
    }
  } else if (s.pattern === 'stripes') {
    for (let j = 0; j < 4; j++) {
      const y = H * (0.2 + j * 0.18)
      g.fillRect(0, y, W, 7)
      stitchPath(g, (t) => [t * W, y + 1], 36)
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const x = W * (0.5 + i * 0.17), y = H * (0.3 + r() * 0.4)
      const pts = Array.from({ length: 9 }, (_, k) => {
        const a = (k / 9) * Math.PI * 2
        const rad = 14 + r() * 10
        return [x + Math.cos(a) * rad * 1.3, y + Math.sin(a) * rad] as [number, number]
      })
      g.beginPath()
      pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py)))
      g.closePath()
      g.fill()
      stitchPath(g, (t) => pts[Math.floor(t * pts.length) % pts.length], 18)
    }
  }
  // The belly patch goes over the pattern, with its own stitch.
  g.fillStyle = belly
  g.beginPath()
  g.ellipse(W * 0.25, H * 0.5, W * 0.09, H * 0.2, 0, 0, Math.PI * 2)
  g.fill()
  stitchPath(g, (t) => [W * 0.25 + Math.cos(t * Math.PI * 2) * W * 0.09, H * 0.5 + Math.sin(t * Math.PI * 2) * H * 0.2], 30)
  stitchPath(g, (t) => [W * 0.75, H * (0.08 + t * 0.84)], 12)
  stitchPath(g, (t) => [t * W, H * 0.5 + Math.sin(t * Math.PI * 4) * 1.5], 40)
  return toTexture(c)
}

/** A shell or a quilted cape: stitched plates or diamonds over fuzz. */
function backTexture(base: string, kind: 'shell' | 'quilt', seed: number) {
  const W = 256, H = 128
  const [c, g] = canvas(W, H)
  fuzzFill(g, W, H, seed, srgb(base))
  if (kind === 'shell') {
    // Hexagonal plates, a lighter felt on each, stitched round.
    for (let row = 0; row < 3; row++) for (let col = 0; col < 7; col++) {
      const x = (col + (row % 2) * 0.5) * (W / 7), y = H * (0.2 + row * 0.28)
      const pts = Array.from({ length: 6 }, (_, k) => [x + Math.cos((k / 6) * Math.PI * 2) * 15, y + Math.sin((k / 6) * Math.PI * 2) * 15] as [number, number])
      g.fillStyle = 'rgba(255, 240, 210, 0.16)'
      g.beginPath()
      pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py)))
      g.closePath()
      g.fill()
      stitchPath(g, (t) => {
        const k = Math.floor(t * 6), f = t * 6 - k
        const a = pts[k % 6], b = pts[(k + 1) % 6]
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
      }, 18)
    }
  } else {
    for (let k = -8; k < 16; k++) {
      stitchPath(g, (t) => [k * 22 + t * H, t * H], 10)
      stitchPath(g, (t) => [k * 22 + t * H, H - t * H], 10)
    }
  }
  return toTexture(c)
}

function shade(c: string, k: number) {
  return '#' + new THREE.Color(c).multiplyScalar(k).getHexString()
}
const luminance = (c: string) => {
  const [r, g, b] = srgb(c)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

// ─── held props ───────────────────────────────────────────────────────────

const BASE_PROPS: readonly string[] = ['spoon', 'duster', 'can', 'letter', 'pouch']

/** The held prop, its origin at the grip. The five originals come from kinds.ts. */
function heldProp(kind: HeldProp, mat: (c: string) => THREE.Material): THREE.Group | null {
  if (kind === 'none') return null
  if (BASE_PROPS.includes(kind)) return heldBase(kind as Prop, mat, 0.85)
  const g = new THREE.Group()
  const k = 0.85
  if (kind === 'book') {
    part(g, mesh(new THREE.BoxGeometry(0.1, 0.13, 0.03), mat('#8a4a3a')), 0, 0.02, 0.02)
    part(g, mesh(new THREE.BoxGeometry(0.092, 0.122, 0.032), mat('#f4ead6')), 0.006, 0.02, 0.02)
  } else if (kind === 'calendar') {
    part(g, mesh(new THREE.BoxGeometry(0.11, 0.13, 0.008), mat('#f4ead6')), 0, 0.03, 0.02)
    part(g, mesh(new THREE.BoxGeometry(0.11, 0.03, 0.01), mat('#b83a3a')), 0, 0.085, 0.021)
    for (const x of [-0.03, 0, 0.03]) part(g, mesh(new THREE.TorusGeometry(0.008, 0.002, 6, 10), mat('#8a8a8a')), x, 0.1, 0.02)
  } else if (kind === 'pencil') {
    part(g, mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), mat('#e8b83a')), 0, 0.04, 0.01)
    part(g, mesh(new THREE.ConeGeometry(0.008, 0.025, 6), mat('#e8c9a0')), 0, 0.122, 0.01)
    part(g, mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 8), mat('#e88f8a')), 0, -0.04, 0.01)
  } else if (kind === 'basket') {
    const wicker = mat('#c99a5a')
    part(g, mesh(new THREE.CylinderGeometry(0.065, 0.05, 0.065, 16, 1, true), wicker), 0, -0.07, 0.02)
    part(g, mesh(new THREE.CircleGeometry(0.05, 16), wicker), 0, -0.1, 0.02).rotation.x = -Math.PI / 2
    part(g, mesh(new THREE.TorusGeometry(0.06, 0.006, 6, 16, Math.PI), wicker), 0, -0.04, 0.02)
    for (const [x, c] of [[-0.02, '#c8553d'], [0.02, '#97a85e']] as const) part(g, mesh(new THREE.SphereGeometry(0.025, 10, 8), mat(c)), x, -0.045, 0.02)
  } else if (kind === 'mug') {
    const clay = mat('#e9dcc4')
    part(g, mesh(new THREE.CylinderGeometry(0.035, 0.032, 0.07, 16), clay), 0.04, -0.01, 0.02)
    part(g, mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 12), clay), 0.002, -0.01, 0.02)
    part(g, mesh(new THREE.CircleGeometry(0.03, 16), mat('#6a4030')), 0.04, 0.026, 0.02).rotation.x = -Math.PI / 2
  } else if (kind === 'wrench') {
    const steel = mat('#a9adb2')
    part(g, mesh(new THREE.BoxGeometry(0.016, 0.13, 0.008), steel), 0, 0.04, 0.015)
    part(g, mesh(new THREE.TorusGeometry(0.018, 0.007, 6, 12, Math.PI * 1.5), steel), 0, 0.115, 0.015).rotation.z = Math.PI * 0.25
  }
  g.scale.setScalar(k)
  return g
}

// ─── build ────────────────────────────────────────────────────────────────

export interface Look { accent: string }

/** A felt villager for the shared rig, from a checked spec. `look.accent` is the owner's colour: scarf and outline. */
export function build(s: VillagerSpec, phys: boolean, look: Look, seed = 1): Figure {
  const { root, pose, head } = skeleton(s.name)
  const P = s.palette
  // Cooler, darker felts get a stronger warm rim so they don't sink into the shade (Dumpling 0.28, Tuft 0.55).
  const rimStrength = THREE.MathUtils.clamp(0.28 + (0.75 - luminance(P.felt)) * 1.8, 0.22, 0.6)
  const { felt, plain, outline } = feltKit(phys, rimStrength, look.accent, seed + 25)
  const R = s.body.r
  const legs = s.body.legs
  const hip = 0.035 + legs
  const bodyH = R * 2 * s.body.tall * 0.62
  const depth = 0.88
  part(pose, mesh(bodyGeometry(s.body.shape, R, bodyH / 2, depth), felt(P.felt, bodyTexture(s, seed))), 0, hip + bodyH / 2, 0)
  /** The body's half-width at a height above the floor (pose space). */
  const widthAt = (y: number) => {
    const yn = THREE.MathUtils.clamp((y - hip - bodyH / 2) / (bodyH / 2), -1, 1)
    const round = Math.sqrt(Math.max(0, 1 - yn * yn))
    const h = s.body.shape === 'tall' ? Math.pow(1 - Math.pow(Math.abs(yn), 3), 1 / 3) : round
    return R * profile(s.body.shape, yn).s * h
  }

  // The head, as Dumpling's.
  const hr = R * s.body.head
  const hy = hip + bodyH + hr * 0.62
  head.position.set(0, hy, 0)
  const painted = s.face.snout === 'none' || s.face.snout === 'button' || s.face.snout === 'beak'
  const skullMap = painted
    ? faceTexture(srgb(P.felt), null, seed + 10, { mouth: s.face.snout === 'beak' ? undefined : 'stitch', cheeks: 'rgba(0,0,0,0)', fuzz: true })
    : feltTexture(P.felt, seed + 10, { band: false })
  const skull = part(head, mesh(new THREE.SphereGeometry(hr, 32, 20), felt(P.felt, skullMap)), 0, 0, 0)
  skull.scale.set(1.08, 0.92, 0.95)
  const nose = (x: number, y: number, z: number) => part(head, mesh(new THREE.SphereGeometry(hr * 0.1, 12, 8), plain('#4a2e28')), x, y, z).scale.set(1.3, 0.8, 0.8)
  if (s.face.snout === 'muzzle') {
    const muzzle = part(head, mesh(new THREE.SphereGeometry(hr * 0.42, 20, 12), felt(P.belly, faceTexture(srgb(P.belly), null, seed + 20, { mouth: 'stitch', cheeks: 'rgba(0,0,0,0)', fuzz: true }))), 0, -hr * 0.24, hr * 0.74)
    muzzle.scale.set(1.15, 0.75, 0.6)
    nose(0, -hr * 0.1, hr * 0.98)
  } else if (s.face.snout === 'button') nose(0, -hr * 0.12, hr * 0.88)
  else if (s.face.snout === 'long') {
    const snout = part(head, mesh(new THREE.CapsuleGeometry(hr * 0.22, hr * 0.42, 6, 14), felt(P.belly, feltTexture(P.belly, seed + 21, { band: false }))), 0, -hr * 0.2, hr * 0.92)
    snout.rotation.x = Math.PI / 2 - 0.15
    snout.scale.set(1.1, 1, 0.85)
    nose(0, -hr * 0.12, hr * 1.42)
  } else if (s.face.snout === 'beak') {
    const beakMat = plain(P.inner)
    const upper = part(head, mesh(new THREE.ConeGeometry(hr * 0.2, hr * 0.62, 16), beakMat), 0, -hr * 0.12, hr * 1.12)
    upper.rotation.x = Math.PI / 2
    upper.scale.set(1.15, 1, 0.7)
    const lower = part(head, mesh(new THREE.ConeGeometry(hr * 0.13, hr * 0.42, 14), beakMat), 0, -hr * 0.26, hr * 1.0)
    lower.rotation.x = Math.PI / 2 + 0.12
    lower.scale.set(1.1, 1, 0.6)
  }
  for (const sx of [-1, 1]) part(head, mesh(new THREE.CircleGeometry(hr * 0.13, 16), plain('#e88f8a')), sx * hr * 0.58, -hr * 0.2, hr * 0.8).rotation.y = sx * 0.6
  const eyes = [-1, 1].map((sx) => buttonEye(head, hr, sx, s.face.eyes))

  // Ears.
  const ears = s.face.ears
  if (ears === 'floppy') {
    for (const sx of [-1, 1]) {
      const ear = part(head, mesh(new THREE.CapsuleGeometry(hr * 0.2, hr * 0.9, 6, 12), felt(P.felt)), sx * hr * 1.0, -hr * 0.1, -hr * 0.05)
      ear.rotation.z = sx * 0.28
      ear.scale.set(1, 1, 0.45)
      part(ear, mesh(new THREE.CapsuleGeometry(hr * 0.12, hr * 0.7, 6, 10), plain(P.inner)), 0, 0, hr * 0.05).scale.set(1, 1, 0.5)
    }
  } else if (ears === 'tuft') {
    const yarn = plain(P.inner)
    for (let k = 0; k < 5; k++) {
      const a = (k - 2) * 0.32
      const strand = part(head, mesh(new THREE.CapsuleGeometry(0.012, 0.07, 4, 8), yarn), Math.sin(a) * 0.03, hr * 0.95 + 0.03, Math.cos(a) * -0.01)
      strand.rotation.z = -a * 1.4
    }
  } else if (ears === 'round') {
    for (const sx of [-1, 1]) {
      const ear = part(head, mesh(new THREE.SphereGeometry(hr * 0.32, 16, 12), felt(P.felt)), sx * hr * 0.7, hr * 0.72, -hr * 0.1)
      ear.scale.set(1, 1, 0.5)
      part(ear, mesh(new THREE.SphereGeometry(hr * 0.2, 12, 10), plain(P.inner)), 0, 0, hr * 0.12).scale.set(1, 1, 0.4)
    }
  } else if (ears === 'pointed') {
    for (const sx of [-1, 1]) {
      const ear = part(head, mesh(new THREE.ConeGeometry(hr * 0.3, hr * 0.62, 14), felt(P.felt)), sx * hr * 0.62, hr * 0.86, -hr * 0.08)
      ear.rotation.z = -sx * 0.38
      ear.scale.set(1, 1, 0.45)
      part(ear, mesh(new THREE.ConeGeometry(hr * 0.18, hr * 0.42, 12), plain(P.inner)), 0, -hr * 0.06, hr * 0.12).scale.set(1, 1, 0.4)
    }
  } else if (ears === 'long') {
    for (const sx of [-1, 1]) {
      const ear = part(head, mesh(new THREE.CapsuleGeometry(hr * 0.17, hr * 1.05, 6, 12), felt(P.felt)), sx * hr * 0.36, hr * 1.35, -hr * 0.1)
      ear.rotation.z = -sx * 0.16
      ear.scale.set(1, 1, 0.45)
      part(ear, mesh(new THREE.CapsuleGeometry(hr * 0.1, hr * 0.85, 6, 10), plain(P.inner)), 0, 0, hr * 0.06).scale.set(1, 1, 0.5)
    }
  } else if (ears === 'antlers') {
    const horn = plain(P.inner)
    for (const sx of [-1, 1]) {
      const beam = part(head, mesh(new THREE.CapsuleGeometry(0.012, hr * 0.7, 4, 8), horn), sx * hr * 0.5, hr * 1.12, -hr * 0.05)
      beam.rotation.z = -sx * 0.45
      for (const [y, a] of [[0.05, 0.9], [-0.1, 1.2]] as const) {
        const tine = part(beam, mesh(new THREE.CapsuleGeometry(0.01, hr * 0.3, 4, 8), horn), sx * 0.02, y * hr * 2, 0)
        tine.rotation.z = sx * a
      }
    }
  }

  // Back: a shell, folded wings or a quilted cape.
  const backColour = P.pattern ?? shade(P.felt, 0.72)
  if (s.back === 'shell' || s.back === 'quilt') {
    const quilt = s.back === 'quilt'
    // The back half of a slightly larger body, so it hugs whatever shape the body is.
    const geo = bodyGeometry(s.body.shape, R, bodyH / 2, quilt ? 0.95 : 1.12, quilt ? 1.06 : 1.13, [32, 18], [Math.PI - 0.35, Math.PI + 0.7, quilt ? 0.12 * Math.PI : 0.08, quilt ? 0.72 * Math.PI : 0.86 * Math.PI])
    const shell = part(pose, mesh(geo, felt(backColour, backTexture(backColour, s.back, seed + 30))), 0, hip + bodyH / 2, 0)
    shell.name = s.back
    ;(shell.material as THREE.Material).side = THREE.DoubleSide
  } else if (s.back === 'wings') {
    for (const sx of [-1, 1]) {
      const y = hip + bodyH * 0.58
      const wing = part(pose, mesh(new THREE.SphereGeometry(R * 0.5, 16, 12), felt(backColour, feltTexture(backColour, seed + 31, { band: false }))), sx * widthAt(y) * 0.92, y, -R * 0.3)
      wing.scale.set(0.32, 1, 0.8)
      wing.rotation.set(-0.35, -sx * 0.4, sx * 0.22)
    }
  }

  // Tail, at the back.
  const tailY = hip + bodyH * 0.22
  const backZ = -widthAt(tailY) * depth
  if (s.tail === 'stub') part(pose, mesh(new THREE.SphereGeometry(R * 0.2, 14, 10), felt(P.felt)), 0, tailY, backZ - R * 0.04)
  else if (s.tail === 'curl') {
    const curl = part(pose, mesh(new THREE.TorusGeometry(R * 0.18, R * 0.06, 8, 20, Math.PI * 1.5), felt(P.felt)), 0, tailY + R * 0.12, backZ - R * 0.14)
    curl.rotation.y = Math.PI / 2
  } else if (s.tail === 'long') {
    const tail = part(pose, mesh(new THREE.CapsuleGeometry(R * 0.07, R * 0.95, 6, 10), felt(P.felt)), 0, tailY - R * 0.05, backZ - R * 0.42)
    tail.rotation.x = -1.15
  } else if (s.tail === 'fluffy') {
    const fluff = plain(P.belly)
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2
      part(pose, mesh(new THREE.SphereGeometry(R * 0.14, 12, 10), fluff), Math.cos(a) * R * 0.1, tailY + Math.sin(a) * R * 0.1, backZ - R * 0.08)
    }
  }

  // The owner's scarf.
  const neckY = hip + bodyH * 0.96
  const wool = plain(look.accent)
  const scarf = part(pose, mesh(new THREE.TorusGeometry(Math.max(widthAt(neckY), R * 0.55) * 1.0 + 0.012, 0.024, 10, 28), wool), 0, neckY, 0)
  scarf.rotation.x = Math.PI / 2
  scarf.scale.set(1, depth + 0.02, 1)
  // The hanging end stays below the neck, however short the body is.
  const tailLength = Math.min(0.15, bodyH * 0.4)
  const endY = neckY - 0.03 - tailLength / 2
  const scarfTail = part(pose, mesh(new THREE.CapsuleGeometry(0.024, tailLength, 4, 8), wool), widthAt(endY) * 0.42, endY, widthAt(endY) * 0.78 + 0.012)
  scarfTail.rotation.z = 0.25

  // Accessories.
  const cream = '#f4ead6'
  for (const a of s.accessories) {
    if (a === 'glasses') {
      const wire = new THREE.MeshStandardMaterial({ color: '#4a3326', roughness: 0.4, metalness: 0.3 })
      for (const sx of [-1, 1]) {
        const ring = part(head, mesh(new THREE.TorusGeometry(hr * 0.2 * Math.max(1, s.face.eyes * 0.9), 0.006, 6, 20), wire), sx * hr * 0.4, hr * 0.12, hr * 0.93)
        ring.rotation.y = sx * 0.35
      }
      part(head, mesh(new THREE.CylinderGeometry(0.004, 0.004, hr * 0.32, 6), wire), 0, hr * 0.16, hr * 0.98).rotation.z = Math.PI / 2
    } else if (a === 'hat') {
      const hat = new THREE.Group()
      const cloth = felt(P.pattern ?? '#6a5a7a')
      part(hat, mesh(new THREE.CylinderGeometry(hr * 0.95, hr * 0.98, 0.012, 28), cloth), 0, 0, 0)
      part(hat, mesh(new THREE.CylinderGeometry(hr * 0.55, hr * 0.62, hr * 0.48, 22), cloth), 0, hr * 0.24, 0)
      part(hat, mesh(new THREE.CylinderGeometry(hr * 0.63, hr * 0.63, hr * 0.1, 22), plain(look.accent)), 0, hr * 0.06, 0)
      hat.rotation.set(-0.1, 0, 0.08)
      part(head, hat, 0, hr * 0.74, -hr * 0.04)
    } else if (a === 'beret') {
      const beret = part(head, mesh(new THREE.SphereGeometry(hr * 0.78, 22, 12), plain(P.pattern ?? '#5b6f9a')), hr * 0.1, hr * 0.78, -hr * 0.05)
      beret.scale.set(1, 0.32, 1)
      beret.rotation.z = -0.25
      part(head, mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.025, 6), plain(P.pattern ?? '#5b6f9a')), hr * 0.12, hr * 1.04, -hr * 0.05)
    } else if (a === 'bow') {
      const ribbon = plain(P.inner)
      const bow = new THREE.Group()
      for (const sx of [-1, 1]) part(bow, mesh(new THREE.ConeGeometry(hr * 0.2, hr * 0.38, 10), ribbon), sx * hr * 0.17, 0, 0).rotation.z = sx * Math.PI / 2
      part(bow, mesh(new THREE.SphereGeometry(hr * 0.1, 10, 8), ribbon), 0, 0, 0)
      bow.rotation.set(0.2, 0, 0.5)
      part(head, bow, hr * 0.55, hr * 0.78, hr * 0.05)
    } else if (a === 'apron') {
      const geo = bodyGeometry(s.body.shape, R, bodyH / 2, depth, 1.035, [20, 12], [Math.PI * 0.5 - 0.62, 1.24, Math.PI * 0.32, Math.PI * 0.5])
      const apron = part(pose, mesh(geo, felt(cream, feltTexture(cream, seed + 40, { band: false }))), 0, hip + bodyH / 2, 0)
      apron.name = 'apron'
    } else if (a === 'satchel') {
      const leather = felt('#a8744a')
      const y = hip + bodyH * 0.38
      const bag = part(pose, mesh(new THREE.BoxGeometry(R * 0.55, R * 0.5, R * 0.22), leather), widthAt(y) + R * 0.05, y, R * 0.15)
      bag.rotation.set(0, 0.5, 0)
      const strap = part(pose, mesh(new THREE.CapsuleGeometry(0.01, bodyH * 0.6, 4, 8), leather), widthAt(y) * 0.85, y + bodyH * 0.32, R * 0.2)
      strap.rotation.z = 0.15
    } else if (a === 'headphones') {
      const pad = felt('#4a4258')
      part(head, mesh(new THREE.TorusGeometry(hr * 1.06, 0.012, 8, 28, Math.PI), pad), 0, hr * 0.05, 0)
      for (const sx of [-1, 1]) part(head, mesh(new THREE.CylinderGeometry(hr * 0.24, hr * 0.24, hr * 0.16, 16), pad), sx * hr * 1.04, hr * 0.05, 0).rotation.z = Math.PI / 2
    } else if (a === 'flower') {
      const flower = new THREE.Group()
      const petal = plain(P.pattern ?? '#f2b8c6')
      for (let k = 0; k < 5; k++) {
        const ang = (k / 5) * Math.PI * 2
        part(flower, mesh(new THREE.SphereGeometry(hr * 0.12, 10, 8), petal), Math.cos(ang) * hr * 0.12, Math.sin(ang) * hr * 0.12, 0).scale.set(1, 1, 0.4)
      }
      part(flower, mesh(new THREE.SphereGeometry(hr * 0.08, 10, 8), plain('#e3a92b')), 0, 0, hr * 0.03)
      flower.rotation.set(-0.3, 0.6, 0)
      part(head, flower, -hr * 0.62, hr * 0.62, hr * 0.25)
    } else if (a === 'leaf') {
      // Moss's sprig.
      const leaf = part(head, mesh(new THREE.SphereGeometry(0.05, 12, 8), plain('#4f8a3a')), 0.02, hr * 1.02, 0)
      leaf.scale.set(0.5, 0.12, 1)
      leaf.rotation.set(0.5, 0.4, 0.6)
    }
  }

  // Arms and the held prop, at the body's side wherever its shape puts it.
  const handY = hip + bodyH * 0.55
  const hands = [-1, 1].map((sx) => {
    const arm = hand(pose, mesh(new THREE.CapsuleGeometry(0.034 * (R / 0.17) ** 0.5, 0.05, 6, 10), felt(P.felt)), sx * widthAt(handY) * 0.98, handY, 0.02)
    arm.rotation.z = sx * 0.5
    return arm
  })
  const held = heldProp(s.prop, (c) => felt(c))
  if (held) {
    part(hands[0], held, 0, -0.03, 0.02)
    held.rotation.z = -0.5
  }

  // Feet, and legs when it has them.
  const footR = 0.048 * (R / 0.17) ** 0.5
  const feet = [-1, 1].map((sx) => {
    const f = part(root, new THREE.Group(), sx * R * 0.5, 0, 0)
    part(f, mesh(new THREE.SphereGeometry(footR, 16, 10), felt(s.face.snout === 'beak' ? P.inner : P.felt)), 0, footR * 0.62, 0.02).scale.set(1, 0.65, 1.3)
    if (legs > 0.004) part(f, mesh(new THREE.CapsuleGeometry(0.016 * (R / 0.17) ** 0.5, legs, 4, 8), felt(s.face.snout === 'beak' ? P.inner : P.felt)), 0, footR * 0.6 + legs / 2 + 0.01, 0)
    return f
  })

  // Fidget: a little head tilt, held on twos like the rest of the pose.
  const fidget = s.gait.fidget
  const touch = fidget > 0.02 ? (v: Villager) => {
    const t = s.gait.stepped ? Math.floor(v.t * 12) / 12 : v.t
    head.rotation.z = v.seated * 0.08 * Math.sin(t * 0.4 + 1) + fidget * 0.12 * Math.sin(t * (1.2 + fidget * 3.5)) * (1 - v.walk * 0.6)
  } : undefined
  return {
    root, pose, head, eyes, feet, hands, height: hy + hr, hip, side: R * 0.5,
    stride: s.gait.stride, speed: s.gait.speed, bob: s.gait.bob, stepped: s.gait.stepped, outline, touch,
  }
}

