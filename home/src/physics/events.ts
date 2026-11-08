// What the physics world tells everyone else (#74), as plain data on one Cordis event,
// `village/physics` (declared in sound/contract.ts with the home's other events). Sound and
// dust read impacts now; villagers' agents will read the same stream later.
import type { Rules } from './rules'

export interface At { x: number; y: number; z: number }

export type PhysicsEvent =
  /** Two things met. `a` and `b` are thing keys (`toy/part`, or `villager/<id>`); impulse is an estimate in N·s. */
  | { kind: 'impact'; a: string; b: string; materials: [string, string]; at: At; impulse: number; hardness: number; impact: number }
  /** A gadget output fired: a sensor's `hit`, a zone's `enter`, a counter's `changed`. */
  | { kind: 'signal'; gadget: string; port: string; value: number; thing?: string; at?: At }
  /** The world rules changed, all at once. `clamped` lists fields that were out of range or not numbers. */
  | { kind: 'rules'; rules: Rules; by: 'preset' | 'panel' | 'talk' | 'code'; preset?: string; clamped: string[] }
  /** A thing went faster than the speed limit and was slowed to it, or fell out of the world and was put back. */
  | { kind: 'clamped'; thing: string; speed: number; at: At; reset: boolean }
