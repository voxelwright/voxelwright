import * as THREE from 'three/webgpu'
import {
  Fn, abs, clamp, float, log, luminance, max, mix, mx_noise_float, perspectiveDepthToViewZ, pow,
  screenCoordinate, screenSize, smoothstep, textureSize, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl'
import type { Fx } from './index'
import type { Stage } from '../tokens'

type Spec = Extract<Stage, { kind: 'paper' }>
type V3 = THREE.Node<'vec3'>
type F = THREE.Node<'float'>

/**
 * Watercolour on paper, in two places. Before bloom (linear colour), pigment pools
 * at the edges of shapes: where depth jumps (a soft coloured line on the near side
 * of a silhouette, never black) and where the colour itself changes sharply, the
 * colour turns a darker sienna; where it varies only a little (wood grain, fibres) it
 * is evened out towards its neighbours. In display colour, the wash is uneven in
 * broad blooms, the paper's tooth shows through the pigment in fine specks, darks
 * lean towards `shadow`, and the whole frame sits on the paper's tint. Film grain
 * is replaced. Costs about 2.5 ms of GPU at 1440x900, DPR 2, on an M1 Pro.
 */
export function paper(spec: Spec): Fx {
  // Display (sRGB) values: THREE.Color stores linear.
  const display = (hex: string) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace)
  const tint = display(spec.tint ?? '#ffffff')
  // The shadow pigment's hue only, scaled to unit luminance so it cools the darks without darkening them.
  const s = display(spec.shadow ?? '#ffffff')
  const sl = 0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b || 1
  const shadow = [s.r / sl, s.g / sl, s.b / sl] as const
  return {
    quiet: { grain: true },
    hdr(color, { stage, scenePass }) {
      if (spec.edges <= 0) return color
      const camera = stage.camera as THREE.PerspectiveCamera
      const near = uniform(camera.near).onRenderUpdate(() => camera.near)
      const far = uniform(camera.far).onRenderUpdate(() => camera.far)
      const depthTex = scenePass.getTextureNode('depth')
      const colourTex = scenePass.getTextureNode()
      return Fn(() => {
        const size = vec2(textureSize(depthTex) as unknown as THREE.Node<'ivec2'>)
        // One tap is a fixed share of the frame's height (1/900), at least one texel.
        const o = vec2(size.y.div(900).max(1)).div(size)
        const at = uv()
        const inv = (dx: number, dy: number): F =>
          float(-1).div(perspectiveDepthToViewZ(depthTex.sample(at.add(o.mul(vec2(dx, dy)))).x, near, far)) as unknown as F
        const i0 = inv(0, 0).toVar()
        // 1 / view distance is affine across a flat surface, so this is zero on walls and floors and large where depth jumps.
        const jump = max(i0.mul(2).sub(inv(1, 0)).sub(inv(-1, 0)), i0.mul(2).sub(inv(0, 1)).sub(inv(0, -1))).div(i0)
        const line = smoothstep(0.03, 0.1, jump)
        // Pigment also pools where the colour changes sharply: painted edges, shadows' borders.
        const tap = (dx: number, dy: number): V3 => colourTex.sample(at.add(o.mul(vec2(dx, dy).mul(1.5)))).rgb as unknown as V3
        const cE = tap(1, 0).toVar(), cW = tap(-1, 0).toVar(), cN = tap(0, 1).toVar(), cS = tap(0, -1).toVar()
        const lum = (c: V3): F => log(luminance(c).add(0.03)) as unknown as F
        const grad = abs(lum(cE).sub(lum(cW))).add(abs(lum(cN).sub(lum(cS))))
        const pool = smoothstep(0.35, 1.0, grad).mul(0.3)
        const e = max(line, pool).mul(spec.edges)
        // A wash has no fine texture: where the colour varies only a little (wood grain, fibres), it is
        // evened out towards its neighbours; real edges (large gradients, depth jumps) are left alone.
        const flat = smoothstep(0.35, 0.05, grad).mul(float(1).sub(line)).mul(0.7)
        const evened = mix(color.rgb, cE.add(cW).add(cN).add(cS).add(color.rgb).div(5), flat)
        // The pooled edge is a darker, slightly earthier version of the colour under it (a sienna, not black).
        return vec4(evened.mul(mix(vec3(1), vec3(0.5, 0.42, 0.38), e)), color.a)
      })() as unknown as THREE.Node<'vec4'>
    },
    display(color) {
      return Fn(() => {
        // Paper units: 900 across the frame's height at any DPR.
        const p = screenCoordinate.xy.div(screenSize.y.div(900)).toVar()
        const tooth = mx_noise_float(p.mul(0.6)).mul(0.6).add(mx_noise_float(p.mul(0.17)).mul(0.4)).toVar()
        const bloom = mx_noise_float(p.div(150)).add(mx_noise_float(p.div(55)).mul(0.5))
        let c: V3 = clamp(color.rgb, 0, 1) as unknown as V3
        // Broad wash: pigment a little thicker in some blooms and thinner in others.
        c = pow(c, vec3(float(1).add(bloom.mul(0.16 * spec.grain)))) as unknown as V3
        // Tooth: paper shows through the pigment on the ridges, pigment settles in the valleys; more where it is dark.
        const ink = float(1).sub(luminance(c))
        c = c.add(tooth.mul(spec.grain * 0.09).mul(ink.mul(0.7).add(0.3))) as unknown as V3
        // Shadows painted in a cooler pigment rather than black.
        if (spec.shadow) c = c.mul(mix(vec3(1), vec3(...shadow), smoothstep(0.85, 0.2, luminance(c)).mul(0.5))) as unknown as V3
        // Laid on tinted paper: a multiply, as pigment on paper is.
        c = c.mul(vec3(tint.r, tint.g, tint.b)) as unknown as V3
        return vec4(clamp(c, 0, 1), 1)
      })() as unknown as THREE.Node<'vec4'>
    },
  }
}
