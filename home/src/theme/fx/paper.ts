import type { Fx } from './index'
import type { Stage } from '../tokens'

/** Placeholder: passes the frame through until the paper stage is built (#50). */
export function paper(_spec: Extract<Stage, { kind: 'paper' }>): Fx {
  return {}
}
