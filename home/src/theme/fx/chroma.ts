import type * as THREE from 'three/webgpu'
import { screenSize, uv, vec2, vec4 } from 'three/tsl'
import type { Fx } from './index'
import type { Stage } from '../tokens'

type Spec = Extract<Stage, { kind: 'chroma' }>
type Sampled = THREE.Node<'vec4'> & { isTextureNode?: boolean; sample?(uv: THREE.Node): THREE.Node<'vec4'>; getTextureNode?(): Sampled }

/**
 * Colour plates printed slightly out of register: red and blue are taken from
 * the frame a fraction of the screen height to either side, green stays put.
 * Runs on linear colour before bloom and the ink, so the ink stays registered,
 * as the black plate does on a press. Three taps of the texture it is given (the
 * scene pass, or TRAA's resolved frame), so no extra pass.
 */
export function chroma(spec: Spec): Fx {
  const a = ((spec.angle ?? 30) * Math.PI) / 180
  return {
    hdr(color, { scenePass }) {
      const given = color as Sampled
      const tex = (given.isTextureNode ? given : given.getTextureNode?.()) ?? (scenePass.getTextureNode() as Sampled)
      // `offset` is a fraction of the screen height; x is scaled by the aspect so the shift is round.
      const o = vec2(Math.cos(a) * spec.offset, Math.sin(a) * spec.offset).mul(vec2(screenSize.y.div(screenSize.x), 1))
      const r = tex.sample!(uv().add(o)).r
      const b = tex.sample!(uv().sub(o)).b
      return vec4(r, color.g, b, color.a)
    },
  }
}
