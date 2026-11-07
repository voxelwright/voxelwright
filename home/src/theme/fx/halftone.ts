import type { Fx } from './index'
import type { Stage } from '../tokens'

/** Placeholder: passes the frame through until the halftone stage is built (#50). */
export function halftone(_spec: Extract<Stage, { kind: 'halftone' }>): Fx {
  return {}
}
