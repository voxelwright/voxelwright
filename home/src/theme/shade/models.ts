// A theme's own shading models, applied by material class (regroup S2, #50). Each model
// makes a twin for a plugin's material; ./apply.ts renders the twin in its place and copies
// the original's live values (colour, emissive, opacity) into it every frame, so the theme
// plugin's shifts and the entries hover glow keep working on the original.
import * as THREE from 'three/webgpu'
import {
  cameraViewMatrix, color, float, luminance, reflectVector, materialColor, materialEmissive, mix, normalView, positionViewDirection,
  smoothstep, texture, uniform, vec3, vec4,
} from 'three/tsl'
import type { MaterialClass } from './classify'

export type Model = 'toon' | 'wet' | 'class'

type Lit = THREE.MeshStandardMaterial & Partial<Pick<THREE.MeshPhysicalMaterial, 'transmission' | 'sheen' | 'clearcoat'>> & {
  colorNode?: THREE.Node | null; emissiveNode?: THREE.Node | null; opacityNode?: THREE.Node | null; positionNode?: THREE.Node | null
}

export interface Twin {
  material: THREE.Material
  /** Copies the original's live values in, then applies the class's own changes. */
  sync(): void
  /** The original's map when the twin was made: a new map (a theme's paint) remakes the twin. */
  map: THREE.Texture | null | undefined
  dispose(): void
}

/** The key light's direction (world, towards the light), shared by every toon highlight. */
export const keyDirection = uniform(new THREE.Vector3(0.4, 0.8, 0.4))

/** Comic: two hard light steps and a dark side. Texel per quarter of dot(N, L) * 0.5 + 0.5. */
let gradient: THREE.DataTexture | null = null
function toonGradient() {
  if (gradient) return gradient
  const v = [40, 40, 160, 255]
  gradient = new THREE.DataTexture(new Uint8Array(v.flatMap((x) => [x, x, x, 255])), v.length, 1, THREE.RGBAFormat)
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter
  gradient.needsUpdate = true
  return gradient
}

/** A map's mean colour (linear) and whether it is a picture (much colour variance) rather than a material's grain. */
const means = new WeakMap<THREE.Texture, { mean: THREE.Color; picture: boolean }>()
function meanOf(map: THREE.Texture) {
  const known = means.get(map)
  if (known) return known
  const out = { mean: new THREE.Color(1, 1, 1), picture: false }
  const img = map.image as CanvasImageSource & { width?: number; height?: number } | undefined
  try {
    if (img && img.width && img.height) {
      const N = 32
      const c = new OffscreenCanvas(N, N)
      const g = c.getContext('2d', { willReadFrequently: true })!
      g.drawImage(img, 0, 0, N, N)
      const d = g.getImageData(0, 0, N, N).data
      let r = 0, gg = 0, b = 0, r2 = 0, g2 = 0, b2 = 0
      const n = N * N
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; gg += d[i + 1]; b += d[i + 2]
        r2 += d[i] * d[i]; g2 += d[i + 1] * d[i + 1]; b2 += d[i + 2] * d[i + 2]
      }
      r /= n; gg /= n; b /= n
      const spread = Math.sqrt(Math.max(0, r2 / n - r * r) + Math.max(0, g2 / n - gg * gg) + Math.max(0, b2 / n - b * b))
      out.picture = spread > 55
      if (map.colorSpace === THREE.SRGBColorSpace) out.mean.setRGB(r / 255, gg / 255, b / 255, THREE.SRGBColorSpace)
      else out.mean.setRGB(r / 255, gg / 255, b / 255, THREE.LinearSRGBColorSpace)
    }
  } catch { /* an image the canvas can't read keeps white */ }
  means.set(map, out)
  return out
}

/** What every twin shares with its original and has to follow. */
function follow(twin: Lit, o: Lit) {
  twin.side = o.side
  twin.transparent = o.transparent
  twin.alphaTest = o.alphaTest
  twin.depthWrite = o.depthWrite
  twin.depthTest = o.depthTest
  twin.blending = o.blending
  twin.fog = o.fog
  twin.vertexColors = o.vertexColors
  twin.alphaMap = o.alphaMap
  twin.polygonOffset = o.polygonOffset
  twin.polygonOffsetFactor = o.polygonOffsetFactor
  twin.polygonOffsetUnits = o.polygonOffsetUnits
  twin.positionNode = o.positionNode ?? null
  twin.opacityNode = o.opacityNode ?? null
  twin.name = `${o.name || o.type} (shaded)`
}

/** Values that change while the home runs: copied every frame. */
function live(twin: Lit, o: Lit) {
  twin.color.copy(o.color)
  twin.emissive.copy(o.emissive)
  twin.emissiveIntensity = o.emissiveIntensity
  twin.opacity = o.opacity
  twin.visible = o.visible
}

/** A small hard highlight from the key light: a printed white spot on metal and glass. */
function highlight(size: number, strength: number) {
  const lightView = cameraViewMatrix.mul(vec4(keyDirection, 0)).xyz.normalize()
  const r = positionViewDirection.negate().reflect(normalView)
  return vec3(smoothstep(1 - size, 1 - size * 0.8, r.dot(lightView)).mul(strength))
}

/**
 * Comic: a toon model. Flat fill from the base and vertex colour, two hard light steps and
 * a dark side from the key light, no specular except a small hard spot on metal and glass,
 * and maps flattened to their mean colour (a picture keeps its colours, posterised), with
 * their strong darks (plank seams, writing) kept as a printed line.
 */
function toon(o: Lit, cls: MaterialClass): Twin {
  const t = new THREE.MeshToonNodeMaterial({ gradientMap: toonGradient() }) as unknown as Lit
  follow(t, o)
  const map = o.map
  let fill: THREE.Node | null = o.colorNode ?? null
  if (!fill && map) {
    const { mean, picture } = meanOf(map)
    const tex = texture(map)
    if (picture) {
      // Posterised in display terms: four levels a channel.
      const disp = tex.rgb.pow(1 / 2.2)
      fill = materialColor.rgb.mul(disp.mul(4).round().div(4).pow(2.2))
    } else {
      const m = uniform(mean)
      const lm = luminance(m)
      const l = luminance(tex.rgb)
      const dark = smoothstep(lm.mul(0.8), lm.mul(0.65), l)
      fill = materialColor.rgb.mul(m).mul(mix(float(1), float(0.6), dark))
    }
  }
  if (fill) t.colorNode = fill as never
  let glow: THREE.Node = o.emissiveNode ?? materialEmissive
  if (cls === 'metal') glow = (glow as THREE.Node<'vec3'>).add(highlight(0.06, 1.4))
  if (cls === 'glass') {
    t.transparent = true
    t.depthWrite = false
    t.colorNode = color('#d6eef6')
    glow = (glow as THREE.Node<'vec3'>).add(highlight(0.05, 2))
  }
  t.emissiveNode = glow as never
  const twin: Twin = {
    material: t,
    map,
    sync() {
      live(t, o)
      if (cls === 'glass') t.opacity = 0.22
    },
    dispose: () => t.dispose(),
  }
  return twin
}

const chrome = new THREE.Color('#dfe6f2')
const darkGlass = new THREE.Color('#141a30')
const hsl = { h: 0, s: 0, l: 0 }
/**
 * Neon night: PBR kept and pushed by class. Glass a dark reflective tint, metal chrome,
 * painted and wood surfaces dark satin, fabric matte so neon reads against it, emissive
 * saturated. The wet floor (role 'floor') is left to the tokens.
 */
function wet(o: Lit, cls: MaterialClass): Twin {
  const t = o.clone() as Lit
  const phys = t as Lit & THREE.MeshPhysicalMaterial
  // Chrome with no environment map reflects black: give it the night it stands in, a
  // magenta-to-cyan sky by the reflected direction, strongest at grazing angles.
  if (cls === 'metal') {
    const sky = mix(color('#ff2fa8'), color('#27d8ff'), reflectVector.y.mul(0.5).add(0.5).clamp())
    const grazing = float(1).sub(normalView.dot(positionViewDirection).clamp()).pow(2).mul(0.6).add(0.12)
    t.emissiveNode = ((o.emissiveNode ?? materialEmissive) as THREE.Node<'vec3'>).add(sky.mul(grazing).mul(0.12)) as never
  }
  const twin: Twin = {
    material: t,
    map: o.map,
    sync() {
      live(t, o)
      t.map = o.map
      switch (cls) {
        case 'glass':
          t.color.lerp(darkGlass, 0.3)
          t.roughness = 0.02
          t.metalness = 0.25
          break
        case 'metal':
          // Chrome, but satin: at 0.2 the magenta practical flared across the fridge door.
          t.color.lerp(chrome, 0.6)
          t.roughness = 0.36
          t.metalness = 1
          break
        case 'wood':
          // Wet satin: the table catches the neon in long soft highlights.
          t.color.multiplyScalar(0.7)
          t.roughness = 0.48
          t.metalness = 0.15
          break
        case 'painted':
        case 'unknown':
          // A shade darker but no glossier: satin paint lit the counter edge like a tube.
          t.color.multiplyScalar(0.85)
          break
        case 'ceramic':
          // Darker, and no glossier than it was: polished, the magenta practical blew out the counter.
          t.color.multiplyScalar(0.75)
          t.roughness = Math.max(0.6, o.roughness)
          break
        case 'fabric':
          t.roughness = 1
          t.metalness = 0
          break
        case 'emissive':
          t.emissive.getHSL(hsl)
          t.emissive.setHSL(hsl.h, 1, Math.min(0.6, hsl.l))
          t.emissiveIntensity = o.emissiveIntensity
          break
      }
    },
    dispose: () => t.dispose(),
  }
  return twin
}

export const CLASS_TINT: Record<MaterialClass, string> = {
  metal: '#9aa4b2', glass: '#40e0ff', emissive: '#ffe000', fabric: '#e040a0',
  wood: '#a0602a', painted: '#60c060', ceramic: '#ffffff', unknown: '#ff2020',
}
/** Debug: every class one flat lit colour, for a screenshot of how the home sorts. */
function tint(o: Lit, cls: MaterialClass): Twin {
  const t = new THREE.MeshStandardNodeMaterial({ color: CLASS_TINT[cls], roughness: 0.9 }) as unknown as Lit
  follow(t, o)
  t.vertexColors = false
  return { material: t, map: o.map, sync() { t.opacity = o.opacity; t.visible = o.visible }, dispose: () => t.dispose() }
}

export function makeTwin(model: Model, o: THREE.Material, cls: MaterialClass): Twin | null {
  const m = o as Lit
  if (model === 'class') return tint(m, cls)
  if (model === 'toon') return toon(m, cls)
  // Neon: the floor stays the tokens' wet floor and glass its own; the rest is pushed by class.
  // Walls keep the tokens' paint and emissives their own colour: pushed, they dimmed the room
  // and blazed the counter's strip.
  const role = m.userData.themeRole
  if (role === 'floor' || role === 'backdrop' || role === 'wall' || cls === 'glass' || cls === 'emissive') return null
  return wet(m, cls)
}
