// Blending two themes token by token, for a live switch that keeps the post chain's shape.
import * as THREE from 'three/webgpu'
import type { Hex, Post, Shift, Surface, Surfaces, Theme } from './tokens'

/**
 * What postfx builds its chain from: the extra stages (with their settings, since a stage
 * is built from them), vetoed features, and whether reflections and a sky are in the chain.
 * Two themes with the same shape switch by blending uniforms; any other pair rebuilds postfx.
 */
export function shape(t: Theme): string {
  return JSON.stringify([t.post.stages, [...t.post.veto].sort(), Boolean(t.post.reflect), Boolean(t.post.sky)])
}

export const sameShape = (a: Theme, b: Theme) => shape(a) === shape(b)

const mix = (a: number, b: number, k: number) => a + (b - a) * k
const ca = new THREE.Color(), cb = new THREE.Color()
const mixHex = (a: Hex, b: Hex, k: number): Hex => `#${ca.set(a).lerp(cb.set(b), k).getHexString()}`
/** A value one theme leaves unset has no number to blend from: it changes at the midpoint. */
const snap = <T>(a: T, b: T, k: number): T => (k < 0.5 ? a : b)
const both = <T>(a: T | undefined, b: T | undefined, k: number, f: (a: T, b: T) => T): T | undefined =>
  a !== undefined && b !== undefined ? f(a, b) : snap(a, b, k)

/**
 * A shift's colour pull, blended. An unset colour pulls nowhere (tint 0), so blending
 * towards a theme that sets one scales its tint up from zero, and the light or surface
 * moves continuously from its own colour.
 */
function mixPull(a: Shift, b: Shift, k: number): Shift {
  const out: Shift = {}
  if (a.color && b.color) Object.assign(out, { color: mixHex(a.color, b.color, k), tint: mix(a.tint ?? 0, b.tint ?? 0, k) })
  else if (b.color) Object.assign(out, { color: b.color, tint: (b.tint ?? 0) * k })
  else if (a.color) Object.assign(out, { color: a.color, tint: (a.tint ?? 0) * (1 - k) })
  if (a.gain !== undefined || b.gain !== undefined) out.gain = mix(a.gain ?? 1, b.gain ?? 1, k)
  return out
}

function mixSurface(a: Surface, b: Surface, k: number): Surface {
  const out: Surface = mixPull(a, b, k)
  const set = <K extends keyof Surface>(key: K, v: Surface[K] | undefined) => v !== undefined && (out[key] = v)
  set('roughness', both(a.roughness, b.roughness, k, (x, y) => mix(x, y, k)))
  set('metalness', both(a.metalness, b.metalness, k, (x, y) => mix(x, y, k)))
  set('emissive', both(a.emissive, b.emissive, k, (x, y) => mixHex(x, y, k)))
  set('glow', both(a.glow, b.glow, k, (x, y) => mix(x, y, k)))
  set('paint', snap(a.paint, b.paint, k))
  return out
}

function mixPost(a: Post, b: Post, k: number): Post {
  const m = (x: number, y: number) => mix(x, y, k)
  const m3 = (x: [number, number, number], y: [number, number, number]) => [m(x[0], y[0]), m(x[1], y[1]), m(x[2], y[2])] as [number, number, number]
  return {
    bloom: { strength: m(a.bloom.strength, b.bloom.strength), radius: m(a.bloom.radius, b.bloom.radius), threshold: m(a.bloom.threshold, b.bloom.threshold) },
    vignette: { amount: m(a.vignette.amount, b.vignette.amount), inner: m(a.vignette.inner, b.vignette.inner), outer: m(a.vignette.outer, b.vignette.outer) },
    warm: m3(a.warm, b.warm),
    grain: m(a.grain, b.grain),
    grade: { saturation: m(a.grade.saturation, b.grade.saturation), contrast: m(a.grade.contrast, b.grade.contrast), lift: m3(a.grade.lift, b.grade.lift) },
    ...(a.sky && b.sky ? { sky: mixHex(a.sky, b.sky, k) } : b.sky ? { sky: b.sky } : {}),
    ...(a.reflect && b.reflect ? {
      reflect: {
        maxDistance: m(a.reflect.maxDistance, b.reflect.maxDistance), thickness: m(a.reflect.thickness, b.reflect.thickness),
        resolutionScale: b.reflect.resolutionScale, strength: m(a.reflect.strength, b.reflect.strength),
      },
    } : b.reflect ? { reflect: b.reflect } : {}),
    veto: b.veto,
    stages: b.stages,
  }
}

const ROLES: (keyof Surfaces)[] = ['wall', 'floor', 'view', 'beam', 'glow', 'other', 'trim', 'backdrop', 'foliage']

/** The theme `k` of the way from a to b (0 is a, 1 is b). Names, hints and stages are b's. */
export function blend(a: Theme, b: Theme, k: number): Theme {
  const surfaces = {} as Surfaces
  for (const role of ROLES) {
    const sa = a.surfaces[role], sb = b.surfaces[role]
    if (!sa && !sb) continue
    // An optional role a theme leaves out reads as its `other`, as the theme plugin does.
    surfaces[role] = mixSurface(sa ?? a.surfaces.other, sb ?? b.surfaces.other, k)
  }
  const ground = (t: Theme) => t.light.fill.ground ?? t.light.fill.color
  const ga = ground(a), gb = ground(b)
  return {
    ...b,
    light: {
      key: {
        ...mixPull(a.light.key, b.light.key, k),
        ...(a.light.key.soften !== undefined || b.light.key.soften !== undefined ? { soften: mix(a.light.key.soften ?? 1, b.light.key.soften ?? 1, k) } : {}),
      },
      fill: { ...mixPull(a.light.fill, b.light.fill, k), ...(ga && gb ? { ground: mixHex(ga, gb, k) } : gb ? { ground: gb } : ga ? { ground: ga } : {}) },
      rim: mixPull(a.light.rim, b.light.rim, k),
      practical: mixPull(a.light.practical, b.light.practical, k),
      exposure: mix(a.light.exposure, b.light.exposure, k),
    },
    surfaces,
    fog: mixPull(a.fog, b.fog, k),
    post: mixPost(a.post, b.post, k),
    motion: snap(a.motion, b.motion, k),
    sky: snap(a.sky, b.sky, k),
  }
}
