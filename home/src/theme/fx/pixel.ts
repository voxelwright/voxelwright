import * as THREE from 'three/webgpu'
import {
  Fn, If, Loop, cbrt, clamp, dot, float, floor, int, max, mod, mrt, normalView, output, packNormalToRGB,
  length, mix, perspectiveDepthToViewZ, sRGBTransferEOTF, screenCoordinate, screenSize, smoothstep, step, textureSize, uniform, uniformArray,
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

function oklabCpu(c: THREE.Color): THREE.Vector3 {
  const l = [c.r, c.g, c.b] // THREE.Color holds linear values
  const m = [0, 1, 2].map((i) => Math.cbrt(LMS[i * 3] * l[0] + LMS[i * 3 + 1] * l[1] + LMS[i * 3 + 2] * l[2]))
  return new THREE.Vector3(...[0, 1, 2].map((i) => LAB[i * 3] * m[0] + LAB[i * 3 + 1] * m[1] + LAB[i * 3 + 2] * m[2]))
}

/** Display (sRGB) colour to OKLab on the GPU. */
const oklab = (srgb: V3): V3 => {
  const lin = sRGBTransferEOTF(srgb) as unknown as V3
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

/** 4x4 ordered-dither thresholds, centred on zero. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5)

/**
 * 16-bit pixel art. The scene renders at a low height whose cell is a whole
 * number of device pixels (so every art pixel is the same size at DPR 1 and 2)
 * with nearest filtering. In linear colour, objects get a dark outline where they
 * stand in front of something (from the depth buffer) and a light edge on convex
 * creases (from normals), both one art pixel wide. In display colour, a 4x4
 * ordered dither aligned to the art pixels, then a snap to the palette by OKLab.
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
    quiet: { bloom: true, grain: true, vignette: true, fxaa: true },
    scene({ stage, scenePass }) {
      // Whole device pixels per art pixel; the row count follows from it.
      const size = new THREE.Vector2()
      const fit = () => {
        const physical = stage.renderer.getDrawingBufferSize(size).y
        const c = Math.max(1, Math.round(physical / spec.height))
        scenePass.setResolutionScale(1 / c)
        cell.value = c
      }
      fit()
      addEventListener('resize', fit)
      unfit = () => removeEventListener('resize', fit)
      ;(scenePass.options as { samples?: number }).samples = spec.samples ?? 0
      if (outline || crease) {
        const normal = mrt({ normal: packNormalToRGB(normalView) })
        const had = scenePass.getMRT()
        if (!had) scenePass.setMRT(mrt({ output }).merge(normal))
        else if (!had.has('normal')) scenePass.setMRT(had.merge(normal))
      }
      for (const tex of scenePass.renderTarget.textures) tex.minFilter = tex.magFilter = THREE.NearestFilter
    },
    hdr(color, { stage, scenePass }) {
      if (!outline && !crease) return color
      const camera = stage.camera as THREE.PerspectiveCamera
      const near = uniform(camera.near).onRenderUpdate(() => camera.near)
      const far = uniform(camera.far).onRenderUpdate(() => camera.far)
      const depthTex = scenePass.getTextureNode('depth')
      const normalTex = scenePass.getTextureNode('normal')
      return Fn(() => {
        const size = vec2(textureSize(depthTex) as unknown as THREE.Node<'ivec2'>)
        const at = floor(uv().mul(size)).add(0.5).toVar()
        // 1 / view distance is affine across a flat surface, so its Laplacian is zero
        // on walls and floors at any angle and large only where depth jumps.
        const inv = (dx: number, dy: number): F => {
          const d = depthTex.sample(at.add(vec2(dx, dy)).div(size)).x
          return float(-1).div(perspectiveDepthToViewZ(d, near, far)) as unknown as F
        }
        const nrm = (dx: number, dy: number): V3 => unpackRGBToNormal(normalTex.sample(at.add(vec2(dx, dy)).div(size)).rgb).normalize() as unknown as V3
        const i0 = inv(0, 0).toVar(), iE = inv(1, 0), iW = inv(-1, 0), iN = inv(0, 1), iS = inv(0, -1)
        // Positive where this pixel is nearer than its neighbours on either axis: the near side of an edge.
        const jump = max(i0.mul(2).sub(iE).sub(iW), i0.mul(2).sub(iN).sub(iS)).div(i0)
        const edge = smoothstep(0.05, 0.12, jump)
        const n0 = nrm(0, 0).toVar()
        let bend: F = float(0)
        for (const [dx, dy, ik] of [[1, 0, iE], [-1, 0, iW], [0, 1, iN], [0, -1, iS]] as const) {
          const nk = nrm(dx, dy)
          // Only the nearer face lights the crease, and only on the side facing up and towards the light.
          const nearer = step(ik, i0.mul(1.0025))
          const facing = clamp(smoothstep(-0.01, 0.01, dot(n0.sub(nk), vec3(1, 1, 1))), 0, 1)
          bend = bend.add(float(1).sub(dot(n0, nk)).mul(nearer).mul(facing)) as F
        }
        const lit = step(0.15, bend).mul(step(edge, 0.001))
        const k = float(1).sub(edge.mul(outline)).add(lit.mul(crease))
        return vec4(color.rgb.mul(k), color.a)
      })() as unknown as THREE.Node<'vec4'>
    },
    display(color) {
      const v = theme().post.vignette
      return Fn(() => {
        const at = floor(screenCoordinate.xy.div(cell))
        // The theme's vignette, taken here once per art pixel so it cannot split one.
        const centre = at.add(0.5).mul(cell).div(screenSize)
        const d = length(centre.sub(0.5).mul(vec2(1.25, 1)))
        const shade = mix(float(1), float(1 - v.amount), smoothstep(v.inner, v.outer, d))
        const t = bayer.element(int(mod(at.x, 4).add(mod(at.y, 4).mul(4)))) as unknown as F
        const c = clamp(color.rgb.mul(shade).add(t.mul(spread)), 0, 1)
        const lab = oklab(c as unknown as V3).toVar()
        const best = vec3(rgbs.element(0) as unknown as V3).toVar()
        const bestD = float(1e9).toVar()
        Loop(count, ({ i }) => {
          const p = labs.element(i) as unknown as V3
          const d = dot(lab.sub(p), lab.sub(p))
          If(d.lessThan(bestD), () => {
            bestD.assign(d)
            best.assign(rgbs.element(i) as unknown as V3)
          })
        })
        return vec4(best, 1)
      })() as unknown as THREE.Node<'vec4'>
    },
    dispose() {
      unfit?.()
    },
  }
}

