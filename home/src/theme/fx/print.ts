// The frame as a printed comic: three prototype styles for regroup 2 (#50), side by side
// behind `&comic=c1|c2|c3` on the comic look (../presets/comic.ts).
//   tones  (C1): every base colour snapped to one shared set of comic inks, light in three
//                flat steps, dots printing the two shade steps.
//   plates (C2): the finished frame separated into cyan, magenta, yellow and black plates,
//                each solid, a Ben-Day tint or bare, on newsprint with grain and bleed.
//   line   (C3): paper and ink; flat spot colour only on saturated things, spotted blacks on
//                dark ones, hatching instead of shading.
import * as THREE from 'three/webgpu'
import {
  Fn, If, Loop, dot, float, floor, fract, int, length, log2, luminance, max, mix, screenCoordinate, screenSize, sin,
  smoothstep, sRGBTransferOETF, step, uniform, uniformArray, uv, vec2, vec3, vec4,
} from 'three/tsl'
import type { Fx } from './index'
import type { Stage } from '../tokens'
import { withAlbedo } from './halftone'
import { oklab, oklabCpu, oklabLinear } from './pixel'

type Spec = Extract<Stage, { kind: 'print' }>
type F = THREE.Node<'float'>
type V2 = THREE.Node<'vec2'>
type V3 = THREE.Node<'vec3'>

const FOV = 40
const DEBUG = new URLSearchParams(location.search).get('printdbg') === '1'

const toDisplay = new THREE.Color()
function displayRgb(hex: string): THREE.Vector3 {
  const { r, g, b } = toDisplay.setStyle(hex, THREE.SRGBColorSpace).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace)
  return new THREE.Vector3(r, g, b)
}
const vec = (hex: string) => {
  const v = displayRgb(hex)
  return vec3(v.x, v.y, v.z)
}

/** A cheap per-pixel hash, 0 to 1. */
const hash = (p: V2): F => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453)) as unknown as F

/** Screen position rotated by `deg` and divided into cells `cellPx` wide. */
const grid = (p: V2, deg: number, cellPx: F): V2 => {
  const a = (deg * Math.PI) / 180
  return vec2(p.x.mul(Math.cos(a)).sub(p.y.mul(Math.sin(a))), p.x.mul(Math.sin(a)).add(p.y.mul(Math.cos(a)))).div(cellPx) as unknown as V2
}

/** Coverage of a round dot of `radius` (cell units) at this pixel, with `rough` cells of edge noise. */
const dotMask = (p: V2, deg: number, cellPx: F, radius: F | number, rough: F | number = 0): F => {
  const d = length(fract(grid(p, deg, cellPx)).sub(0.5)).add(rough)
  const aa = float(1.1).div(cellPx)
  const r = (typeof radius === 'number' ? float(radius) : radius) as F
  return smoothstep(r.add(aa), r.sub(aa), d) as unknown as F
}

/** Coverage of hatch lines at `deg`, `width` 0 to 0.5 of the pitch. */
const hatch = (p: V2, deg: number, cellPx: F, width: F | number): F => {
  const a = (deg * Math.PI) / 180
  const t = fract(p.x.mul(Math.cos(a)).add(p.y.mul(Math.sin(a))).div(cellPx)).sub(0.5).abs()
  const aa = float(0.9).div(cellPx)
  const w = (typeof width === 'number' ? float(width) : width) as F
  return smoothstep(w.add(aa), w.sub(aa), t) as unknown as F
}

/** Nearest palette entry by OKLab: its display colour and index. Call inside an Fn. */
function nearest(lab: V3, labs: THREE.Node, rgbs: THREE.Node, count: number) {
  const best = vec3(0, 0, 0).toVar()
  const index = int(0).toVar()
  const bestD = float(1e9).toVar()
  Loop(count, ({ i }) => {
    const p = (labs as unknown as { element(i: unknown): V3 }).element(i)
    const d = dot(lab.sub(p), lab.sub(p))
    If(d.lessThan(bestD), () => {
      bestD.assign(d)
      best.assign((rgbs as unknown as { element(i: unknown): V3 }).element(i))
      index.assign(i)
    })
  })
  return { best, index }
}

/** Shared comic inks for 'tones' when the spec gives none: display colours. */
const TONES = ['#fbf0d9', '#ffffff', '#f2c14e', '#e6c08a', '#e8893a', '#d4442f', '#ee9fb4', '#4f9fd8', '#24427a', '#5ba84c', '#8fa66a', '#2f6e44', '#c07a3e', '#a8794e', '#b89a74', '#7a4a2e', '#a3a1a8', '#3a3540']
/** Spot inks for 'line'. */
const SPOTS = ['#d8392b', '#f5c62f', '#2f7fd0', '#3f9a4a', '#ec7fa3', '#ee8a2c']

export function print(spec: Spec): Fx {
  const paperHex = spec.paper ?? '#f6ecd4'
  const inkHex = spec.ink ?? '#1e1a1c'
  return {
    quiet: spec.style === 'tones' ? { grain: true } : { grain: true, bloom: true, vignette: true },
    scene({ scenePass }) {
      withAlbedo(scenePass)
    },
    display(color, { stage, scenePass }) {
      const camera = stage.camera as THREE.PerspectiveCamera
      const rows = uniform(spec.cell).onRenderUpdate(() => spec.cell * Math.min(2, Math.max(1, FOV / camera.fov)))
      const pr = spec.style === 'plates' ? press(paperHex) : null
      const lit = scenePass.getTextureNode()
      const albedo = scenePass.getTextureNode('albedo')
      return Fn(() => {
        const at = uv().toVar()
        const alb = albedo.sample(at).toVar()
        const has = step(0.5, alb.a).toVar()
        const la = max(luminance(alb.rgb), 0.02)
        // Light on this pixel in stops: 0 is lit as brightly as the surface's own colour.
        const stops = log2(max(luminance(lit.sample(at).rgb), 1e-4).div(la)).toVar()
        const p = screenCoordinate.xy.toVar() as unknown as V2
        const cellPx = screenSize.y.div(rows).toVar() as unknown as F
        const c = color.rgb.clamp(0, 1).toVar()
        if (DEBUG) {
          // Integer stops as bands: red above -1, yellow -1..-2, green -2..-3, blue -3..-4, black below.
          const band = floor(stops.negate()).clamp(0, 4)
          const dbg = mix(mix(mix(vec3(1, 0.2, 0.2), vec3(1, 0.9, 0.2), step(1, band)), mix(vec3(0.2, 0.8, 0.3), vec3(0.2, 0.4, 1), step(3, band)), step(2, band)), vec3(0, 0, 0), step(4, band))
          return vec4(mix(c, dbg, has.mul(0.85)), 1)
        }
        if (pr) {
          // A colourist's flats first, so plates break on material and shadow edges, not on
          // plaster grain or soft gradients: the surface's own colour (the frame's where there
          // is none) snapped to the comic inks, in three light steps, then separated.
          const lab = mix(oklab(c as unknown as V3), oklabLinear(alb.rgb as unknown as V3), has)
          const { index } = nearest(lab as unknown as V3, pr.flatLabs, pr.flatRgbs, TONES.length)
          // Each flat in each light step has a fixed plate recipe, worked out once on the CPU.
          const lightStep = step(stops, -0.75).add(step(stops, -2.9)).mul(has)
          const cov = (pr.covs as unknown as { element(i: unknown): THREE.Node<'vec4'> }).element(int(index.mul(3).add(int(lightStep)))).toVar()
          return vec4(plates(cov as unknown as THREE.Node<'vec4'>, p, cellPx, pr), 1)
        }
        if (spec.style === 'tones') {
          const pal = spec.palette ?? TONES
          const labs = uniformArray(pal.map((h) => oklabCpu(new THREE.Color(h))), 'vec3')
          const rgbs = uniformArray(pal.map(displayRgb), 'vec3')
          // The surface's own colour where there is one; the frame's colour (sky, glass) elsewhere.
          const lab = mix(oklab(c as unknown as V3), oklabLinear(alb.rgb as unknown as V3), has)
          const { best } = nearest(lab as unknown as V3, labs, rgbs, pal.length)
          // Three flat light steps from the toon light: sunlit, the room's ambient, shadow.
          const mid = smoothstep(-0.95, -1.05, stops).mul(has)
          const shadow = smoothstep(-1.85, -1.95, stops).mul(has)
          const shade = vec3(0.3, 0.24, 0.42) // the shadow ink, a cool plum
          const toned = best.mul(mix(float(1), float(0.93), mid)).mul(mix(float(1), float(0.82), shadow))
          // Dots print the shade: a fine screen in the ambient step, merging in the shadow step.
          const radius = mix(float(0.17), float(0.5), shadow)
          const dots = dotMask(p, 45, cellPx, radius).mul(mid)
          const printed = mix(toned, toned.mul(shade).mul(1.1), dots.mul(mix(float(0.45), float(0.8), shadow)))
          // Bright light (a lamp's glow, the window card's sky) prints as paper.
          const bulb = smoothstep(1.2, 2.2, stops).mul(has)
          return vec4(mix(printed, vec(spec.paper ?? '#fff8e8'), bulb), 1)
        }
        // 'line': paper, spot colour on saturated things, spotted blacks on dark ones, hatching.
        const labs = uniformArray(SPOTS.map((h) => oklabCpu(new THREE.Color(h))), 'vec3')
        const rgbs = uniformArray(SPOTS.map(displayRgb), 'vec3')
        const lab = mix(oklab(c as unknown as V3), oklabLinear(alb.rgb as unknown as V3), has).toVar()
        const chroma = length(lab.yz)
        const spot = smoothstep(0.085, 0.105, chroma)
        const { best } = nearest(lab as unknown as V3, labs, rgbs, SPOTS.length)
        const paper = vec(paperHex)
        const ink = vec(inkHex)
        // Dark and colourless (the fridge, chair legs, text on a page): solid black, as an inker spots blacks.
        const black = smoothstep(0.43, 0.41, lab.x).mul(float(1).sub(spot))
        const base = mix(mix(paper, best, spot), ink, black).toVar()
        // Hatching for shade: one direction below the ambient, crossed further down.
        const tone = smoothstep(-2.3, -2.9, stops).mul(has)
        const deep = smoothstep(-3.4, -4, stops).mul(has)
        const h1 = hatch(p, 45, cellPx, mix(float(0.06), float(0.16), tone)).mul(step(0.01, tone))
        const h2 = hatch(p, -45, cellPx, mix(float(0.06), float(0.14), deep)).mul(step(0.01, deep))
        const lines = max(h1, h2).mul(float(1).sub(black))
        // Bare paper keeps a faint grain so it reads as a page, not a blank screen.
        const grain = hash(floor(p.div(screenSize.y.div(900)))).sub(0.5).mul(0.035)
        return vec4(mix(base.add(grain), ink, lines.mul(0.9)), 1)
      })() as unknown as THREE.Node<'vec4'>
    },
  }
}

/** Process inks, display colours, and the dot screen angle of each plate. */
const INKS: Array<[string, number]> = [['#18a4dd', 15], ['#e3237f', 75], ['#fae232', 0], ['#221d20', 45]]
/** Ben-Day tints: the share of its cell a dot covers, light and full. */
const LIGHT = 0.2
const TINT = 0.45

/** C2's light steps: lit, the room's ambient, shadow, as multipliers on a flat. */
const STEPS = [1, 0.92, 0.7]

/**
 * C2's press. Its overprints: each colour plate bare, a light tint, a tint or solid, at most
 * two inked; black a tint with at most one colour, or solid alone, each averaging to a colour
 * on the paper (multiplied in display terms). Every comic ink in every light step is matched
 * to its nearest overprint by OKLab here, once, so the GPU only looks the recipe up.
 */
function press(paperHex: string) {
  const paper = displayRgb(paperHex)
  const inks = INKS.map(([h]) => displayRgb(h))
  const combos: number[][] = []
  const levels = [0, LIGHT, TINT, 1]
  for (const c of levels) for (const m of levels) for (const y of levels) {
    const inked = [c, m, y].filter((v) => v > 0).length
    if (inked > 2) continue
    combos.push([c, m, y, 0])
    if (inked <= 1) combos.push([c, m, y, TINT])
  }
  combos.push([0, 0, 0, 1])
  const lin = new THREE.Color()
  const labOf = (v: THREE.Vector3) => oklabCpu(lin.setRGB(v.x, v.y, v.z, THREE.SRGBColorSpace))
  const mixed = combos.map((cov) => {
    const out = paper.clone()
    cov.forEach((v, i) => out.multiply(new THREE.Vector3(1, 1, 1).lerp(inks[i], v)))
    return labOf(out)
  })
  // Each inked plate costs a little, black a little more: a flat settles on fewer plates.
  const cost = combos.map((v) => v.slice(0, 3).filter((x) => x > 0).length * 0.0018 + (v[3] > 0 ? 0.0025 : 0))
  const recipes: THREE.Vector4[] = []
  for (const hex of TONES) for (const k of STEPS) {
    const lab = labOf(displayRgb(hex).multiplyScalar(k))
    let best = 0, bestD = Infinity
    mixed.forEach((m, j) => {
      const d = m.distanceToSquared(lab) + cost[j]
      if (d < bestD) { bestD = d; best = j }
    })
    recipes.push(new THREE.Vector4(...combos[best]))
  }
  return {
    paper, inks,
    flatLabs: uniformArray(TONES.map((h) => oklabCpu(new THREE.Color(h))), 'vec3'),
    flatRgbs: uniformArray(TONES.map(displayRgb), 'vec3'),
    covs: uniformArray(recipes, 'vec4'),
  }
}

/** C2: one plate recipe (cyan, magenta, yellow, black coverage) printed plate by plate on newsprint. Call inside an Fn. */
function plates(cov: THREE.Node<'vec4'>, p: V2, cellPx: F, pr: ReturnType<typeof press>) {
  const px900 = screenSize.y.div(900)
  // Paper: newsprint fibre at two scales.
  const fine = hash(floor(p.div(px900)))
  const coarse = hash(floor(p.div(px900.mul(5))))
  const out = vec3(pr.paper.x, pr.paper.y, pr.paper.z).mul(float(1).sub(fine.mul(0.05)).sub(coarse.mul(0.035))).toVar()
  // Ink soaks unevenly into the dot edges.
  const bleed = hash(floor(p.div(px900.mul(1.5)))).sub(0.5).mul(0.07)
  const c4 = cov as unknown as { x: F; y: F; z: F; w: F }
  INKS.forEach(([, deg], i) => {
    const v = [c4.x, c4.y, c4.z, c4.w][i]
    const solid = step(0.9, v)
    const tinted = step(0.1, v).mul(float(1).sub(solid))
    // A dot whose area is the plate's share of the cell.
    const radius = v.div(Math.PI).sqrt() as unknown as F
    const mask = solid.add(tinted.mul(dotMask(p, deg, cellPx, radius, bleed)))
    const ink = vec3(pr.inks[i].x, pr.inks[i].y, pr.inks[i].z)
    // Solids print a touch uneven, like ink on cheap paper.
    const density = mix(float(1), float(0.9).add(coarse.mul(0.1)), solid)
    out.assign(out.mul(mix(vec3(1, 1, 1), ink, mask.mul(density))))
  })
  return out
}
