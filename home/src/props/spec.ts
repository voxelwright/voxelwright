// #42 experiment, dev only. A declarative prop spec written by a model, turned
// into meshes by trusted code. The spec is data: it is validated and clamped
// here and never executed. Hard errors (unknown shape or preset, missing
// numbers, too many parts) fail validation; out-of-range numbers are clamped.
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { paintFabric, paintPlaster, paintWallpaper, paintWood } from '../paint'

type Vec3 = [number, number, number]
type RGB = [number, number, number]

export const LIMITS = { parts: 60, materials: 8, extent: 3, minExtent: 0.002, points: 48, sides: 48 }
const SHAPES = ['box', 'cylinder', 'sphere', 'lathe', 'extrude'] as const
const PRESETS = ['wood', 'fabric', 'painted', 'metal', 'ceramic', 'wallpaper'] as const

export interface Material {
  preset: (typeof PRESETS)[number]
  species?: 'oak' | 'pine' | 'walnut' | 'cherry' | 'birch'
  tone?: 'light' | 'medium' | 'dark'
  color?: string
  color2?: string
  pattern?: string
  finish?: 'matte' | 'satin' | 'gloss'
  kind?: 'brass' | 'steel' | 'iron' | 'copper'
  stripe?: number
}

export interface Part {
  shape: (typeof SHAPES)[number]
  material: string
  at?: Vec3
  rot?: Vec3
  size?: Vec3
  bevel?: number
  radius?: number
  radiusTop?: number
  radiusBottom?: number
  height?: number
  sides?: number
  profile?: [number, number][]
  outline?: [number, number][]
  depth?: number
}

export interface PropSpec {
  name: string
  size: Vec3
  materials: Record<string, Material>
  parts: Part[]
}

export interface Checked {
  spec: PropSpec | null
  errors: string[]
  clamped: string[]
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Validate and clamp a parsed spec. Returns errors for anything that cannot be built. */
export function check(input: unknown): Checked {
  const errors: string[] = [], clamped: string[] = []
  const clamp = (v: number, lo: number, hi: number, where: string) => {
    const c = Math.min(hi, Math.max(lo, v))
    if (c !== v) clamped.push(`${where}: ${v} -> ${c}`)
    return c
  }
  const vec = (v: unknown, where: string, lo: number, hi: number, fallback?: Vec3): Vec3 | undefined => {
    if (v === undefined) return fallback
    if (!Array.isArray(v) || v.length !== 3 || !v.every(num)) return void errors.push(`${where} must be [x, y, z] numbers`)
    return v.map((x, i) => clamp(x, lo, hi, `${where}[${i}]`)) as Vec3
  }
  const pts = (v: unknown, where: string): [number, number][] | undefined => {
    if (!Array.isArray(v) || v.length < 3 || !v.every((p) => Array.isArray(p) && p.length === 2 && p.every(num)))
      return void errors.push(`${where} must be at least 3 [a, b] number pairs`)
    if (v.length > LIMITS.points) errors.push(`${where} has ${v.length} points, at most ${LIMITS.points}`)
    return (v as [number, number][]).map(([a, b], i) => [clamp(a, -LIMITS.extent, LIMITS.extent, `${where}[${i}]`), clamp(b, -LIMITS.extent, LIMITS.extent, `${where}[${i}]`)])
  }
  const o = input as Partial<PropSpec>
  if (!o || typeof o !== 'object') return { spec: null, errors: ['spec must be a JSON object'], clamped }
  const size = vec(o.size, 'size', 0.02, LIMITS.extent)
  if (!size) errors.push('size [width, height, depth] in metres is required')
  const materials: Record<string, Material> = {}
  const mats = o.materials && typeof o.materials === 'object' ? Object.entries(o.materials) : []
  if (!mats.length) errors.push('materials must name at least one material')
  if (mats.length > LIMITS.materials) errors.push(`${mats.length} materials, at most ${LIMITS.materials}`)
  for (const [key, m] of mats) {
    if (!m || !PRESETS.includes(m.preset)) errors.push(`material "${key}": preset must be one of ${PRESETS.join(', ')}`)
    else materials[key] = m
  }
  const parts: Part[] = []
  if (!Array.isArray(o.parts) || !o.parts.length) errors.push('parts must be a non-empty array')
  else if (o.parts.length > LIMITS.parts) errors.push(`${o.parts.length} parts, at most ${LIMITS.parts}`)
  else
    o.parts.forEach((p: Part, i) => {
      const at = `parts[${i}]`
      if (!p || !SHAPES.includes(p.shape)) return void errors.push(`${at}.shape must be one of ${SHAPES.join(', ')}`)
      if (!materials[p.material]) return void errors.push(`${at}.material "${p.material}" is not in materials`)
      const out: Part = { shape: p.shape, material: p.material }
      out.at = vec(p.at, `${at}.at`, -LIMITS.extent, LIMITS.extent, [0, 0, 0])
      out.rot = vec(p.rot, `${at}.rot`, -360, 360, [0, 0, 0])
      const len = (v: unknown, name: string, fallback?: number) => {
        if (v === undefined && fallback !== undefined) return fallback
        if (!num(v)) return void errors.push(`${at}.${name} must be a number`)
        return clamp(v, LIMITS.minExtent, LIMITS.extent, `${at}.${name}`)
      }
      out.bevel = num(p.bevel) ? clamp(p.bevel, 0, 0.1, `${at}.bevel`) : 0
      out.sides = num(p.sides) ? Math.round(clamp(p.sides, 3, LIMITS.sides, `${at}.sides`)) : 24
      if (p.shape === 'box') out.size = vec(p.size, `${at}.size`, LIMITS.minExtent, LIMITS.extent) ?? void errors.push(`${at}.size is required`)
      if (p.shape === 'cylinder') {
        out.radiusTop = len(p.radiusTop ?? p.radius, 'radiusTop')
        out.radiusBottom = len(p.radiusBottom ?? p.radius, 'radiusBottom')
        out.height = len(p.height, 'height')
      }
      if (p.shape === 'sphere') out.radius = len(p.radius, 'radius')
      if (p.shape === 'lathe') out.profile = pts(p.profile, `${at}.profile`)
      if (p.shape === 'extrude') {
        out.outline = pts(p.outline, `${at}.outline`)
        out.depth = len(p.depth, 'depth')
      }
      parts.push(out)
    })
  if (errors.length) return { spec: null, errors, clamped }
  return { spec: { name: String(o.name ?? 'prop').slice(0, 60), size: size!, materials, parts }, errors, clamped }
}

const SPECIES: Record<string, [RGB, RGB]> = {
  oak: [[236, 198, 144], [204, 160, 108]],
  pine: [[232, 190, 132], [196, 150, 98]],
  walnut: [[150, 104, 70], [96, 62, 40]],
  cherry: [[196, 122, 84], [150, 82, 52]],
  birch: [[240, 218, 180], [214, 188, 146]],
}
const METALS: Record<string, string> = { brass: '#c9a45c', steel: '#b9b6ae', iron: '#4a4642', copper: '#c27a52' }
const rgb = (hex: string | undefined, fallback: RGB): RGB => {
  const c = new THREE.Color()
  try {
    c.set(hex ?? '')
  } catch {
    return fallback
  }
  return hex ? [c.r * 255, c.g * 255, c.b * 255].map((v) => Math.round(v)) as RGB : fallback
}
const ROUGH = { matte: 0.85, satin: 0.55, gloss: 0.25 }

function material(m: Material, seed: number): THREE.MeshStandardMaterial {
  const color = (fallback: RGB) => rgb(m.color, fallback)
  switch (m.preset) {
    case 'wood': {
      const [light, dark] = SPECIES[m.species ?? 'oak'] ?? SPECIES.oak
      const k = m.tone === 'dark' ? 0.7 : m.tone === 'medium' ? 0.86 : 1
      const tone = (c: RGB) => c.map((v) => v * k) as RGB
      return new THREE.MeshStandardMaterial({ map: paintWood({ seed, planks: 2, light: tone(light), dark: tone(dark), knots: 1, w: 256, h: 256 }), roughness: 0.5 })
    }
    case 'fabric': {
      const pattern = (['plain', 'stripes', 'check', 'velvet'] as const).find((p) => p === m.pattern) ?? 'plain'
      return new THREE.MeshStandardMaterial({ map: paintFabric(seed, color([227, 220, 207]), pattern, rgb(m.color2, [240, 232, 214])), roughness: pattern === 'velvet' ? 0.75 : 0.95 })
    }
    case 'painted':
      return new THREE.MeshStandardMaterial({ map: paintPlaster(seed, color([244, 241, 234]), 256, 256, 0.3), roughness: ROUGH[m.finish ?? 'satin'] ?? 0.55 })
    case 'metal':
      return new THREE.MeshStandardMaterial({ color: METALS[m.kind ?? 'steel'] ?? METALS.steel, metalness: 0.85, roughness: 0.35 })
    case 'ceramic':
      return new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...color([233, 220, 196]).map((v) => v / 255) as RGB, THREE.SRGBColorSpace), roughness: m.finish === 'matte' ? 0.7 : 0.3 })
    case 'wallpaper': {
      const pattern = (['plain', 'stripes', 'floral', 'trellis'] as const).find((p) => p === m.pattern) ?? 'plain'
      const stripe = num(m.stripe) ? Math.min(0.3, Math.max(0.01, m.stripe)) : 0.06
      return new THREE.MeshStandardMaterial({ map: paintWallpaper(seed, pattern, color([238, 228, 206]), rgb(m.color2, [178, 190, 160]), stripe), roughness: 0.9 })
    }
  }
}

function geometry(p: Part): THREE.BufferGeometry {
  switch (p.shape) {
    case 'box': {
      const [x, y, z] = p.size!
      const r = Math.min(p.bevel ?? 0, x / 2, y / 2, z / 2)
      return r > 0.001 ? new RoundedBoxGeometry(x, y, z, 2, r) : new THREE.BoxGeometry(x, y, z)
    }
    case 'cylinder':
      return new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.sides)
    case 'sphere':
      return new THREE.SphereGeometry(p.radius, p.sides, Math.max(6, Math.round(p.sides! * 0.66)))
    case 'lathe':
      return new THREE.LatheGeometry(p.profile!.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), p.sides)
    case 'extrude': {
      const shape = new THREE.Shape(p.outline!.map(([x, y]) => new THREE.Vector2(x, y)))
      const bevel = p.bevel ?? 0
      const g = new THREE.ExtrudeGeometry(shape, { depth: p.depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2 })
      g.translate(0, 0, -p.depth! / 2)
      return g
    }
  }
}

/** Build a checked spec: parts in the spec's own frame, then fitted uniformly into its declared size. */
export function build(spec: PropSpec, seed = 1): THREE.Group {
  const group = new THREE.Group()
  group.name = spec.name
  const cache = new Map<string, THREE.MeshStandardMaterial>()
  const d = THREE.MathUtils.degToRad
  spec.parts.forEach((p) => {
    if (!cache.has(p.material)) cache.set(p.material, material(spec.materials[p.material], seed + cache.size * 7))
    const mesh = new THREE.Mesh(geometry(p), cache.get(p.material)!)
    mesh.position.set(...p.at!)
    mesh.rotation.set(d(p.rot![0]), d(p.rot![1]), d(p.rot![2]))
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
  })
  for (const [key, mat] of cache) if (spec.materials[key].preset === 'wallpaper' && mat.map) {
    const box = new THREE.Box3().setFromObject(group)
    const s = box.getSize(new THREE.Vector3())
    mat.map.repeat.set(Math.max(1, s.x / 0.6), Math.max(1, s.y / 0.6))
  }
  const box = new THREE.Box3().setFromObject(group)
  const s = box.getSize(new THREE.Vector3())
  const k = Math.min(spec.size[0] / Math.max(s.x, 1e-3), spec.size[1] / Math.max(s.y, 1e-3), spec.size[2] / Math.max(s.z, 1e-3))
  if (Number.isFinite(k) && k > 0) group.scale.setScalar(Math.min(k, 4))
  return group
}
