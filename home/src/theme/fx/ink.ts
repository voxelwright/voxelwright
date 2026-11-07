import type { Fx } from './index'
import type { Stage } from '../tokens'

/** Placeholder: passes the frame through until the ink stage is built (#50). */
export function ink(_spec: Extract<Stage, { kind: 'ink' }>): Fx {
  return {}
}
