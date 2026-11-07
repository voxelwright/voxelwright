import * as THREE from 'three/webgpu'
import { Fn, If, Loop, dot, float, floor, int, mod, screenCoordinate, uniform, uniformArray, vec3, vec4 } from 'three/tsl'
import type { Fx } from './index'
import type { Stage } from '../tokens'

/** #rrggbb as display (sRGB) values, not converted to linear: the palette is matched after tone mapping. */
const display = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** 4x4 ordered-dither thresholds, centred on zero. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5)

/**
 * Pixel art: the scene renders at a low internal height with nearest filtering,
 * then each low-resolution pixel snaps to the nearest palette colour after a
 * 4x4 ordered dither, in display space.
 */
export function pixel(spec: Extract<Stage, { kind: 'pixel' }>): Fx {
  const cell = uniform(1)
  const palette = uniformArray(spec.palette.map(display), 'vec3')
  const bayer = uniformArray(BAYER4, 'float')
  const spread = uniform(spec.dither)
  const count = spec.palette.length
  return {
    quiet: { bloom: true, grain: true },
    scene({ stage, scenePass }) {
      const physical = stage.renderer.getDrawingBufferSize(new THREE.Vector2()).y
      const scale = Math.min(1, spec.height / physical)
      scenePass.setResolutionScale(scale)
      cell.value = 1 / scale
      const tex = scenePass.renderTarget.texture
      tex.minFilter = tex.magFilter = THREE.NearestFilter
    },
    display(color) {
      return Fn(() => {
        const at = floor(screenCoordinate.xy.div(cell))
        const t = bayer.element(int(mod(at.x, 4).add(mod(at.y, 4).mul(4)))) as unknown as THREE.Node<'float'>
        const c = color.rgb.add(t.mul(spread)).toVar()
        const best = vec3(palette.element(0) as unknown as THREE.Node<'vec3'>).toVar()
        const bestD = float(1e9).toVar()
        Loop(count, ({ i }) => {
          const p = palette.element(i) as unknown as THREE.Node<'vec3'>
          const d = dot(c.sub(p), c.sub(p))
          If(d.lessThan(bestD), () => {
            bestD.assign(d)
            best.assign(p)
          })
        })
        return vec4(best, 1)
      })()
    },
  }
}
