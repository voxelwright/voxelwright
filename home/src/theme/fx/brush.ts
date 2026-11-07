import type * as THREE from 'three/webgpu'
import { Fn, convertToTexture, float, mix, rtt, screenUV, textureSize, vec2, vec3, vec4 } from 'three/tsl'
import type { Fx } from './index'
import type { Stage } from '../tokens'

type Spec = Extract<Stage, { kind: 'brush' }>
type V3 = THREE.Node<'vec3'>
type F = THREE.Node<'float'>

/** The brush works on a half-resolution copy of the frame: patches are a few pixels wide anyway, and it quarters the taps. */
const SCALE = 0.5

/**
 * Brush patches: a four-sector Kuwahara filter on the display colour. Each pixel
 * takes the mean of whichever quarter of its neighbourhood varies least, so flat
 * areas become patches of one colour and edges stay where they are. It runs at
 * half resolution and is mixed over the frame by `strength`; the low tier skips it.
 * Measured: about 4.4 ms of GPU at 1440x900, DPR 2, M1 Pro, and the half-resolution
 * patches smear small painted detail (photos, wood grain) into blocks, so no preset uses it yet.
 */
export function brush(spec: Spec): Fx {
  const nodes: Array<{ dispose(): void }> = []
  return {
    display(color, { stage }) {
      if (stage.quality === 'low' || spec.strength <= 0) return color
      const src = convertToTexture(color, null, null, { resolutionScale: SCALE }) as unknown as THREE.TextureNode
      const R = Math.max(1, Math.round(spec.radius))
      const taps = (R + 1) * (R + 1)
      const kuwahara = Fn(() => {
        const size = vec2(textureSize(src) as unknown as THREE.Node<'ivec2'>)
        // Tap spacing in source texels, so the patch is a fixed share of the frame's height at any DPR.
        const step = size.y.div(540 * SCALE).max(1).div(size)
        let best: V3 = vec3(0)
        let bestVar: F = float(1e9)
        for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          let sum: V3 = vec3(0)
          let sq: V3 = vec3(0)
          for (let i = 0; i <= R; i++)
            for (let j = 0; j <= R; j++) {
              const c = src.sample(screenUV.add(vec2(i * sx, j * sy).mul(step))).rgb as unknown as V3
              sum = sum.add(c) as V3
              sq = sq.add(c.mul(c)) as V3
            }
          const mean = sum.div(taps).toVar() as unknown as V3
          const v = sq.div(taps).sub(mean.mul(mean))
          const total = v.x.add(v.y).add(v.z).toVar() as unknown as F
          const better = total.lessThan(bestVar)
          best = better.select(mean, best) as V3
          bestVar = better.select(total, bestVar) as F
        }
        return vec4(best, 1)
      })()
      const painted = rtt(kuwahara, null, null, { resolutionScale: SCALE })
      nodes.push(src as unknown as { dispose(): void }, painted)
      return vec4(mix(color.rgb, painted.sample(screenUV).rgb, spec.strength), 1) as unknown as THREE.Node<'vec4'>
    },
    dispose() {
      for (const n of nodes) n.dispose()
    },
  }
}
