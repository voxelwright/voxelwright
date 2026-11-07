import type { Fx } from './index'
import type { Stage } from '../tokens'

/** Placeholder: passes the frame through until the brush stage is built (#50). */
export function brush(_spec: Extract<Stage, { kind: 'brush' }>): Fx {
  return {}
}
