import * as THREE from 'three/webgpu'
import {
  Fn, dot, float, max, min, mix, mrt, normalView, output, packNormalToRGB, perspectiveDepthToViewZ, screenSize,
  smoothstep, step, uniform, unpackRGBToNormal, uv, vec2, vec3, vec4,
} from 'three/tsl'
import type { Fx } from './index'
import type { Stage } from '../tokens'

type Spec = Extract<Stage, { kind: 'ink' }>
type F = THREE.Node<'float'>
type V3 = THREE.Node<'vec3'>

/**
 * Ink lines drawn in display colour, over everything else: a bold line on the
 * near side of every depth jump (silhouettes, an object in front of the wall)
 * and a finer one where two faces of one object fold (from the normals). The
 * scene pass gains a normal attachment for it. `width` is the line in pixels at
 * 900 rows, so it keeps its weight at any device pixel ratio; `depth` and `normal`
 * are how strongly each kind of edge is inked, 0 to 1.
 */
export function ink(spec: Spec): Fx {
  // Display-space value of the ink (THREE.Color holds linear).
  const { r, g, b } = new THREE.Color(spec.color ?? '#1c1418').getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace)
  return {
    scene({ scenePass }) {
      const normal = mrt({ normal: packNormalToRGB(normalView) })
      const had = scenePass.getMRT()
      if (!had) scenePass.setMRT(mrt({ output }).merge(normal))
      else if (!had.has('normal')) scenePass.setMRT(had.merge(normal))
    },
    display(color, { stage, scenePass }) {
      const camera = stage.camera as THREE.PerspectiveCamera
      const near = uniform(camera.near).onRenderUpdate(() => camera.near)
      const far = uniform(camera.far).onRenderUpdate(() => camera.far)
      const normalTex = scenePass.getTextureNode('normal')
      const depth = scenePass.getTextureNode('depth')
      return Fn(() => {
        const at = uv().toVar()
        // One line width, in uv, from a width given in pixels at 900 rows.
        const px = vec2(screenSize.y.div(screenSize.x), 1).mul(spec.width / 900).toVar()
        // 1 / view distance is affine across a flat surface: its Laplacian is zero on walls
        // and floors at any angle, and large only where depth jumps.
        const inv = (dx: number, dy: number): F => {
          const d = depth.sample(at.add(px.mul(vec2(dx, dy)))).x
          return float(-1).div(perspectiveDepthToViewZ(d, near, far)) as unknown as F
        }
        const nrm = (dx: number, dy: number): V3 =>
          unpackRGBToNormal(normalTex.sample(at.add(px.mul(vec2(dx, dy)))).rgb) as unknown as V3
        const i0 = inv(0, 0).toVar()
        const iE = inv(1, 0), iW = inv(-1, 0), iN = inv(0, 1), iS = inv(0, -1)
        // Positive on the nearer side of an edge, so each line sits on the object in front.
        const lapX = i0.mul(2).sub(iE).sub(iW), lapY = i0.mul(2).sub(iN).sub(iS)
        const jump = max(lapX, lapY).div(i0)
        const silhouette = smoothstep(0.012, 0.05, jump)
        // Creases: how far the normal turns across the line. A real fold also bends the
        // depth, which keeps out normals smeared by additive glows (sunbeam, window glass)
        // that write no depth; never on the far plane.
        const bent = smoothstep(0.0015, 0.006, max(lapX.abs(), lapY.abs()).div(i0))
        const n0 = nrm(0, 0).toVar()
        const fold = min(min(dot(n0, nrm(1, 0)), dot(n0, nrm(-1, 0))), min(dot(n0, nrm(0, 1)), dot(n0, nrm(0, -1))))
        const crease = smoothstep(0.72, 0.5, fold).mul(bent).mul(step(depth.sample(at).x, 0.99999))
        const line = max(silhouette.mul(spec.depth), crease.mul(spec.normal))
        return vec4(mix(color.rgb, vec3(r, g, b), line), color.a)
      })() as unknown as THREE.Node<'vec4'>
    },
  }
}
