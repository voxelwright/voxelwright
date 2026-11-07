import * as THREE from 'three/webgpu'
import {
  Fn, If, Loop, cbrt, clamp, diffuseColor, dot, exp2, float, floor, int, log2, max, mod, mrt, normalView, output, packNormalToRGB,
  length, luminance, min, mix, perspectiveDepthToViewZ, round, sRGBTransferEOTF, screenCoordinate, screenSize, smoothstep, step, textureSize, uniform, uniformArray,
  unpackRGBToNormal, uv, vec2, vec3, vec4,
} from 'three/tsl'
import type { Fx } from './index'
import { theme } from '../index'
import type { Stage } from '../tokens'

type Spec = Extract<Stage, { kind: 'pixel' }>
type V3 = THREE.Node<'vec3'>
type F = THREE.Node<'float'>

// OKLab (Björn Ottosson, 2020): distances in it follow perceived colour difference,
// so wood and skin stay warm when snapped instead of drifting to grey as in RGB.
const LMS = [0.4122214708, 0.5363325363, 0.0514459929, 0.2119034982, 0.6806995451, 0.1073969566, 0.0883024619, 0.2817188376, 0.6299787005]
const LAB = [0.2104542553, 0.7936177850, -0.0040720468, 1.9779984951, -2.4285922050, 0.4505937099, 0.0259040371, 0.7827717662, -0.8086757660]

export function oklabCpu(c: THREE.Color): THREE.Vector3 {
  const l = [c.r, c.g, c.b] // THREE.Color holds linear values
  const m = [0, 1, 2].map((i) => Math.cbrt(LMS[i * 3] * l[0] + LMS[i * 3 + 1] * l[1] + LMS[i * 3 + 2] * l[2]))
  return new THREE.Vector3(...[0, 1, 2].map((i) => LAB[i * 3] * m[0] + LAB[i * 3 + 1] * m[1] + LAB[i * 3 + 2] * m[2]))
}

/** Linear colour to OKLab on the GPU. */
export const oklabLinear = (lin: V3): V3 => {
  const r = lin.x, g = lin.y, b = lin.z
  const l = cbrt(r.mul(LMS[0]).add(g.mul(LMS[1])).add(b.mul(LMS[2])).max(0))
  const m = cbrt(r.mul(LMS[3]).add(g.mul(LMS[4])).add(b.mul(LMS[5])).max(0))
  const s = cbrt(r.mul(LMS[6]).add(g.mul(LMS[7])).add(b.mul(LMS[8])).max(0))
  return vec3(
    l.mul(LAB[0]).add(m.mul(LAB[1])).add(s.mul(LAB[2])),
    l.mul(LAB[3]).add(m.mul(LAB[4])).add(s.mul(LAB[5])),
    l.mul(LAB[6]).add(m.mul(LAB[7])).add(s.mul(LAB[8])),
  )
}

/** Display (sRGB) colour to OKLab on the GPU. */
export const oklab = (srgb: V3): V3 => oklabLinear(sRGBTransferEOTF(srgb) as unknown as V3)

/**
 * The dollhouse view's own sizing (#50 regroup 3, I2), set by ../interior/isofit.ts. `rows`
 * replaces the spec's height when above 0; `edge` above 0 finds outlines by a depth jump of
 * about that many metres (so a chair reads against the floor 15 m away) instead of by a
 * share of the view distance; `flat` is how much dither a flat midtone keeps (0.35 as before,
 * 0 keeps dither for silhouettes and shadow edges). `refit` re-sizes every live pixel stage.
 */
export const pixelFit = { rows: 0, edge: uniform(0), flat: uniform(0.35), fits: new Set<() => void>(), refit: () => pixelFit.fits.forEach((f) => f()) }

/**
 * Light is drawn in bands, as pixel art paints it: the ratio of a pixel's colour to its
 * surface's own colour is rounded to steps this many stops apart (about four bands from a
 * room's shadow to its lamp-lit wall), so a lamp's soft falloff reads as a few clean rings
 * instead of palette blotches. A surface this dark, a glow this many times its own colour,
 * or the sky are left as they are.
 */
const LIGHT_STEP = 0.6
const DARK_ALBEDO = 0.03
const GLOW_RATIO = 4
/** Outlines: a silhouette (a jump of a few of the look's steps) is drawn at full strength, a small step between parts at this share. */
const SEAM = 0.3

/** 4x4 ordered-dither thresholds, centred on zero. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5)

/**
 * 16-bit pixel art. The scene renders at a low height whose cell is a whole
 * number of device pixels (so every art pixel is the same size at DPR 1 and 2)
 * with nearest filtering. In linear colour, objects get a dark outline where they
 * stand in front of something (from the depth buffer) and a light edge on convex
 * creases (from normals), both one art pixel wide. In display colour, a snap to
 * the nearest palette colour by OKLab, with a 4x4 ordered dither aligned to the art
 * pixels only where a pixel sits near the boundary between its two nearest colours.
 */
export function pixel(spec: Spec): Fx {
  const cell = uniform(1)
  const toDisplay = new THREE.Color()
  const paletteRgb = spec.palette.map((hex) => {
    const { r, g, b } = toDisplay.setStyle(hex, THREE.SRGBColorSpace).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace)
    return new THREE.Vector3(r, g, b)
  })
  const paletteLab = spec.palette.map((hex) => oklabCpu(new THREE.Color(hex)))
  const rgbs = uniformArray(paletteRgb, 'vec3')
  const labs = uniformArray(paletteLab, 'vec3')
  const bayer = uniformArray(BAYER4, 'float')
  const spread = uniform(spec.dither)
  const outline = spec.outline ?? 0
  const crease = spec.crease ?? 0
  const count = spec.palette.length
  let unfit: (() => void) | null = null

  return {
    // Bloom stays: at the low resolution it rings the lamp in palette steps, as pixel art draws a glow.
    quiet: { grain: true, vignette: true, fxaa: true },
    scene({ stage, scenePass }) {
      // Whole device pixels per art pixel; the row count follows from it.
      const size = new THREE.Vector2()
      const fit = () => {
        const physical = stage.renderer.getDrawingBufferSize(size).y
        const c = Math.max(1, Math.round(physical / (pixelFit.rows || spec.height)))
        scenePass.setResolutionScale(1 / c)
        cell.value = c
      }
      fit()
      addEventListener('resize', fit)
      pixelFit.fits.add(fit)
      unfit = () => {
        removeEventListener('resize', fit)
        pixelFit.fits.delete(fit)
      }
      ;(scenePass.options as { samples?: number }).samples = spec.samples ?? 0
      // The surface's own colour, for banding the light, and its normal, for outlines.
      const add = mrt({ diffuseColor, ...(outline || crease ? { normal: packNormalToRGB(normalView) } : {}) })
      const had = scenePass.getMRT()
      scenePass.setMRT(had ? had.merge(add) : mrt({ output }).merge(add))
      scenePass.getTexture('diffuseColor').type = THREE.UnsignedByteType
      for (const tex of scenePass.renderTarget.textures) tex.minFilter = tex.magFilter = THREE.NearestFilter
    },
    hdr(color, { stage, scenePass }) {
      const camera = stage.camera as THREE.PerspectiveCamera
      const near = uniform(camera.near).onRenderUpdate(() => camera.near)
      const far = uniform(camera.far).onRenderUpdate(() => camera.far)
      const depthTex = scenePass.getTextureNode('depth')
      const albedoTex = scenePass.getTextureNode('diffuseColor')
      const normalTex = outline || crease ? scenePass.getTextureNode('normal') : null
      return Fn(() => {
        const size = vec2(textureSize(depthTex) as unknown as THREE.Node<'ivec2'>)
        const at = floor(uv().mul(size)).add(0.5).toVar()
        // The light, banded.
        const albedo = luminance(albedoTex.sample(at.div(size)).rgb)
        const ratio = luminance(color.rgb).div(albedo.max(1e-3)).max(1e-4).toVar()
        const banded = exp2(round(log2(ratio).div(LIGHT_STEP)).mul(LIGHT_STEP))
        const sky = step(0.99999, depthTex.sample(at.div(size)).x)
        const keep = step(DARK_ALBEDO, albedo).mul(step(ratio, GLOW_RATIO)).mul(float(1).sub(sky))
        const lit = color.rgb.mul(mix(float(1), banded.div(ratio), keep)).toVar()
        if (!normalTex) return vec4(lit, color.a)
        // 1 / view distance is affine across a flat surface, so its Laplacian is zero
        // on walls and floors at any angle and large only where depth jumps.
        const inv = (dx: number, dy: number): F => {
          const d = depthTex.sample(at.add(vec2(dx, dy)).div(size)).x
          return float(-1).div(perspectiveDepthToViewZ(d, near, far)) as unknown as F
        }
        const nrm = (dx: number, dy: number): V3 => unpackRGBToNormal(normalTex!.sample(at.add(vec2(dx, dy)).div(size)).rgb).normalize() as unknown as V3
        const i0 = inv(0, 0).toVar(), iE = inv(1, 0), iW = inv(-1, 0), iN = inv(0, 1), iS = inv(0, -1)
        // Positive where this pixel is nearer than its neighbours on either axis: the near side of an edge.
        const jump = max(i0.mul(2).sub(iE).sub(iW), i0.mul(2).sub(iN).sub(iS)).div(i0)
        // With `pixelFit.edge` set, the jump is weighed in metres (jump times view distance).
        const metres = pixelFit.edge.max(1e-4)
        // Selective: a silhouette (a chair against the floor, a shelf against the wall) at full
        // strength, a small step between an object's own parts (a drawer, a seat) quiet.
        const rel = max(smoothstep(0.02, 0.04, jump).mul(SEAM), smoothstep(0.06, 0.14, jump))
        const jm = jump.div(i0)
        const abs = max(smoothstep(metres.mul(0.3), metres.mul(0.5), jm).mul(SEAM), smoothstep(metres, metres.mul(2.2), jm))
        const edge = mix(rel, abs, step(1e-4, pixelFit.edge))
        const n0 = nrm(0, 0).toVar()
        let bend: F = float(0)
        for (const [dx, dy, ik] of [[1, 0, iE], [-1, 0, iW], [0, 1, iN], [0, -1, iS]] as const) {
          const nk = nrm(dx, dy)
          // Only the nearer face lights the crease, and only on the side facing up and towards the light.
          const nearer = step(ik, i0.mul(1.0025))
          const facing = clamp(smoothstep(-0.01, 0.01, dot(n0.sub(nk), vec3(1, 1, 1))), 0, 1)
          bend = bend.add(float(1).sub(dot(n0, nk)).mul(nearer).mul(facing)) as F
        }
        // A real crease also bends the depth; a normal change on flat depth is a transparent
        // shape (the sunbeam's shells write their normals but not their depth), not geometry.
        const creased = step(0.15, bend).mul(step(edge, 0.001)).mul(step(0.0004, jump.abs()))
        const k = float(1).sub(edge.mul(outline)).add(creased.mul(crease))
        return vec4(lit.mul(k), color.a)
      })() as unknown as THREE.Node<'vec4'>
    },
    display(color, { scenePass }) {
      const v = theme().post.vignette
      const sceneTex = scenePass.getTextureNode()
      return Fn(() => {
        // How much the light changes across this art pixel's neighbours, from the scene's own
        // linear colour: high at shadow edges and silhouettes, near zero across a plaster wall.
        const size = vec2(textureSize(sceneTex) as unknown as THREE.Node<'ivec2'>)
        const here = floor(uv().mul(size)).add(0.5).toVar()
        const lum = (dx: number, dy: number): F => luminance(sceneTex.sample(here.add(vec2(dx, dy)).div(size)).rgb) as unknown as F
        const l0 = lum(0, 0), lE = lum(1, 0), lW = lum(-1, 0), lN = lum(0, 1), lS = lum(0, -1)
        const hi = max(max(l0, lE), max(max(lW, lN), lS)), lo = min(min(l0, lE), min(min(lW, lN), lS))
        const busy = smoothstep(0.08, 0.2, hi.sub(lo).div(hi.add(0.04)))
        const at = floor(screenCoordinate.xy.div(cell))
        // The theme's vignette, taken here once per art pixel so it cannot split one.
        const centre = at.add(0.5).mul(cell).div(screenSize)
        const d = length(centre.sub(0.5).mul(vec2(1.25, 1)))
        const shade = mix(float(1), float(1 - v.amount), smoothstep(v.inner, v.outer, d))
        const t = bayer.element(int(mod(at.x, 4).add(mod(at.y, 4).mul(4)))) as unknown as F
        const c = clamp(color.rgb.mul(shade), 0, 1)
        const lab = oklab(c as unknown as V3).toVar()
        // The two nearest palette colours. A flat midtone snaps to its nearest; only a
        // pixel near the boundary between two (a ramp step, a shadow edge) is dithered.
        const best = vec3(rgbs.element(0) as unknown as V3).toVar()
        const next = vec3(rgbs.element(0) as unknown as V3).toVar()
        const bestLab = vec3(labs.element(0) as unknown as V3).toVar()
        const nextLab = vec3(labs.element(0) as unknown as V3).toVar()
        const bestD = float(1e9).toVar()
        const nextD = float(1e9).toVar()
        Loop(count, ({ i }) => {
          const p = labs.element(i) as unknown as V3
          const d = dot(lab.sub(p), lab.sub(p))
          If(d.lessThan(bestD), () => {
            nextD.assign(bestD)
            next.assign(best)
            nextLab.assign(bestLab)
            bestD.assign(d)
            best.assign(rgbs.element(i) as unknown as V3)
            bestLab.assign(p)
          }).ElseIf(d.lessThan(nextD), () => {
            nextD.assign(d)
            next.assign(rgbs.element(i) as unknown as V3)
            nextLab.assign(p)
          })
        })
        // 0 on the boundary, 1 on the nearest colour; inside the band the share of the
        // second colour rises to half, in a 4x4 ordered pattern.
        const gap = length(nextLab.sub(bestLab)).max(1e-4)
        const away = nextD.sqrt().sub(bestD.sqrt()).div(gap)
        // Where the light changes fast the band is full width; across a flat midtone it narrows
        // to a seam at the ramp step, so a wall shows clean bands instead of a dithered field.
        const band = spread.max(1e-4).mul(mix(pixelFit.flat, float(1), busy))
        const share = clamp(float(1).sub(away.div(band)), 0, 1).mul(0.5)
        return vec4(mix(best, next, step(t.add(0.5), share)), 1)
      })() as unknown as THREE.Node<'vec4'>
    },
    dispose() {
      unfit?.()
    },
  }
}

