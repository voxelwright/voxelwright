// What the physics world tells everyone else (#74), as plain data on one Cordis event,
// `village/physics` (declared in sound/contract.ts with the home's other events). Sound and
// dust read impacts now; villagers' agents will read the same stream later.
import type { Shape } from './core'
import type { Rules } from './rules'

export interface At { x: number; y: number; z: number }

export type PhysicsEvent =
  /**
   * Two things met. `a` and `b` are thing keys (`toy/part`, or `villager/<id>`), `materials` and
   * `shapes` theirs (enough to size a mark), `normal` the world-space unit normal from a to b,
   * impulse an estimate in N·s, `impact` the rule that scales how it is heard and seen.
   */
  | { kind: 'impact'; a: string; b: string; materials: [string, string]; shapes: [Shape, Shape]; at: At; normal: At; impulse: number; hardness: number; impact: number }
  /**
   * A villager's foot met the ground (kinematic bodies make no solver contact with the floor,
   * so steps are reported from their stride): where, which way they walk (unit, world xz),
   * which foot, and the foot's size in metres.
   */
  | { kind: 'step'; thing: string; material: string; at: At; heading: At; side: 'left' | 'right'; foot: { length: number; width: number } }
  /** A gadget output fired: a sensor's `hit`, a zone's `enter`, a counter's `changed`. */
  | { kind: 'signal'; gadget: string; port: string; value: number; thing?: string; at?: At }
  /** The world rules changed, all at once. `clamped` lists fields that were out of range or not numbers. */
  | { kind: 'rules'; rules: Rules; by: 'preset' | 'panel' | 'talk' | 'code'; preset?: string; clamped: string[] }
  /** A thing went faster than the speed limit and was slowed to it, or fell out of the world and was put back. */
  | { kind: 'clamped'; thing: string; speed: number; at: At; reset: boolean }
  /**
   * Fire (fire.ts). A part of a thing caught (`thing` its key, `part` its name in the thing, '' for the
   * whole of it), from the heat around it, or set alight by an ask, a gadget or code; `temperature` is
   * the heat it read, °C.
   */
  | { kind: 'ignite'; thing: string; part: string; material: string; at: At; by: 'heat' | 'ask' | 'gadget' | 'code'; temperature: number }
  /** It stopped burning before its fuel ran out: water put it out, or an ask, a gadget or code did. `fuel` is what is left, 0 to 1. */
  | { kind: 'extinguish'; thing: string; part: string; material: string; at: At; by: 'water' | 'ask' | 'gadget' | 'code'; fuel: number }
  /** It burnt out: nothing left to burn, charred. */
  | { kind: 'burnt'; thing: string; part: string; material: string; at: At }
  /** Gadget signals were dropped since the last such event: past the waiting limit, or more than 64 wires from a physical cause (a loop of wires feeding itself). */
  | { kind: 'dropped'; signals: number }
