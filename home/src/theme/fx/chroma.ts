import type { Fx } from './index'
import type { Stage } from '../tokens'

/** Placeholder: passes the frame through until the chroma stage is built (#50). */
export function chroma(_spec: Extract<Stage, { kind: 'chroma' }>): Fx {
  return {}
}
