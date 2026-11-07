// I3, the theme repaints the whole room by material class (#50, regroup 3, `&repaint=1`,
// deliberately too bold). Every classified interior surface is drawn through a gouache twin
// (../shade/apply.ts swaps it in per draw): its colour is pulled towards one shared palette
// in OKLab, so walls, wood, fabric and enamel speak one language; its map is kept as detail
// over the map's own mean colour (magnets, drawings and book spines stay, wood grain softens);
// and a brush texture, laid in world space by class (long strokes on wood, dabs on fabric,
// faint on enamel), replaces the render's smooth gradients. Metal becomes enamel, nothing is glossy.
import * as THREE from 'three/webgpu'
import {
  Fn, If, Loop, abs, dot, float, luminance, materialColor, mix, normalWorld, positionWorld, pow, texture, uniform, uniformArray, vec2, vec3, vertexColor,
} from 'three/tsl'
import { paintGouacheWall } from '../paint'
import { oklabCpu, oklabLinear } from '../fx/pixel'
import { follow, live, meanOf, type Twin } from '../shade/models'
import type { MaterialClass } from '../shade/classify'
import type { Theme } from '../tokens'

const ON = new URLSearchParams(location.search).get('repaint') === '1'

type V3 = THREE.Node<'vec3'>
type F = THREE.Node<'float'>

interface Repaint { palette: string[]; pull: number }
/** Looks that repaint their room under `&repaint=1`: one palette for the whole room. */
const REPAINTS: Record<string, Repaint> = {
  pastoral: {
    // Creams and honey wood, sienna and umber, sage to leaf green, faded indigo and sky, terracotta,
    // butter yellow, a pale oak and a warm grey: a gouache box, not the render's colours.
    palette: [
      '#f6ecd8', '#ead8b4', '#d9b886', '#c08a52', '#8e5a36', '#5a3a2a',
      '#b5c49a', '#7f9a5e', '#4f6e44', '#a8bcd8', '#5a6e9a', '#d27a5a',
      '#e8c070', '#e0c49a', '#9a8c80', '#3a3436',
    ],
    pull: 0.6,
  },
}

/** The shading model a theme's room takes under `&repaint=1`, for ../shade/apply.ts. */
export function repaintModel(t: Theme): 'gouache' | null {
  return ON && Object.hasOwn(REPAINTS, t.id) ? 'gouache' : null
}

/** How each class is painted: brush scale in metres along and across the stroke, its strength, and the finish. */
const BRUSH: Partial<Record<MaterialClass, { along: number; across: number; strength: number; roughness: number }>> = {
  wood: { along: 0.9, across: 0.18, strength: 0.55, roughness: 0.8 },
  fabric: { along: 0.3, across: 0.22, strength: 0.75, roughness: 1 },
  ceramic: { along: 0.45, across: 0.35, strength: 0.3, roughness: 0.55 },
  metal: { along: 0.45, across: 0.35, strength: 0.3, roughness: 0.5 },
  painted: { along: 0.8, across: 0.6, strength: 0.3, roughness: 0.9 },
  unknown: { along: 0.8, across: 0.6, strength: 0.3, roughness: 0.9 },
}

let brushMap: THREE.Texture | null = null
let brushMean = 1
function brush() {
  if (brushMap) return brushMap
  brushMap = paintGouacheWall(29)
  brushMap.wrapS = brushMap.wrapT = THREE.RepeatWrapping
  brushMap.colorSpace = THREE.SRGBColorSpace
  const { mean } = meanOf(brushMap)
  brushMean = Math.max(0.05, 0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b)
  return brushMap
}

let shared: { rgb: THREE.Node; lab: THREE.Node; count: number; pull: THREE.UniformNode<'float', number> } | null = null
function palette(spec: Repaint) {
  if (shared) return shared
  const rgb = spec.palette.map((h) => {
    const c = new THREE.Color(h)
    return new THREE.Vector3(c.r, c.g, c.b)
  })
  const lab = spec.palette.map((h) => oklabCpu(new THREE.Color(h)))
  shared = { rgb: uniformArray(rgb, 'vec3'), lab: uniformArray(lab, 'vec3'), count: rgb.length, pull: uniform(spec.pull) }
  return shared
}

/** The nearest palette colour to a linear colour, by OKLab, keeping the colour's own lightness a little. */
const nearest = (c: V3, p: NonNullable<typeof shared>): V3 => Fn(() => {
  const lab = oklabLinear(c).toVar()
  const best = vec3(0).toVar()
  const bestD = float(1e9).toVar()
  Loop(p.count, ({ i }) => {
    const q = (p.lab as unknown as { element(i: unknown): V3 }).element(i)
    const d = dot(lab.sub(q), lab.sub(q))
    If(d.lessThan(bestD), () => {
      bestD.assign(d)
      best.assign((p.rgb as unknown as { element(i: unknown): V3 }).element(i))
    })
  })
  return best
})() as unknown as V3

/** A gouache twin of a plugin's material (null for glass, glowing things and the theme's own world: they keep their own). */
export function gouache(o: THREE.MeshStandardMaterial, cls: MaterialClass, t: Theme, mesh: THREE.Object3D): Twin | null {
  const spec = REPAINTS[t.id]
  const b = BRUSH[cls]
  if (!spec || !b) return null
  for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (p.userData.themeOwned) return null
  const p = palette(spec)
  const tw = new THREE.MeshStandardNodeMaterial() as unknown as THREE.MeshStandardMaterial & { colorNode: THREE.Node | null }
  follow(tw as never, o as never)
  tw.vertexColors = false
  const map = o.map
  const known = map ? meanOf(map) : null
  const mean = uniform(known ? known.mean.clone() : new THREE.Color(1, 1, 1))
  const vc = o.vertexColors ? vertexColor().rgb : vec3(1)
  const base = (materialColor.rgb as V3).mul(vc).mul(mean) as V3
  const pulled = mix(base, nearest(base, p), p.pull)
  // Detail over the map's mean: a picture keeps it whole, a material's grain softens to a wash.
  let detail: V3 = vec3(1) as unknown as V3
  if (map) {
    const ratio = texture(map).rgb.div((mean as unknown as V3).max(0.02)).clamp(0, 4)
    detail = (known!.picture ? ratio : pow(ratio, vec3(0.35))) as V3
  }
  // The brush, laid in world space on the three axis planes and blended by the surface's facing.
  const tex = brush()
  const n = abs(normalWorld).pow(4).toVar()
  const w = n.div(n.x.add(n.y).add(n.z))
  const at = positionWorld
  const s = vec2(1 / b.along, 1 / b.across)
  const lum = (uv: THREE.Node<'vec2'>): F => luminance(texture(tex, uv).rgb) as unknown as F
  const stroke = lum(vec2(at.z, at.y).mul(s)).mul(w.x).add(lum(vec2(at.x, at.z).mul(s)).mul(w.y)).add(lum(vec2(at.x, at.y).mul(s)).mul(w.z))
  const k = float(1).add(stroke.div(brushMean).sub(1).mul(b.strength * 4)).clamp(0.55, 1.4)
  tw.colorNode = pulled.mul(detail).mul(k) as never
  tw.map = null
  return {
    material: tw,
    map,
    sync() {
      live(tw as never, o as never)
      tw.roughness = b.roughness
      tw.metalness = 0
    },
    dispose: () => tw.dispose(),
  }
}
