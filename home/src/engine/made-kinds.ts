// The gadget kinds a toy made from a sentence may contain (#88), and nothing else: no fire (the
// flame kind) and nothing that needs a key a made toy does not get (hinge, piston). The one list:
// the page's checker (made.ts) refuses other kinds, and the host quotes only these to the model.
// No imports, so the host can read it as it is.
// With the logic parts (#108) a made toy can be a whole game: a round, a score shown on a card, lamps
// and a bell, a time limit, a set to complete, a best score, and its pieces put back for the next round. No
// spawner (it places a part anywhere in the toy's frame), and no freeze or shake: those reach
// past the toy, to the whole world and the person's view.
export const MADE_KINDS = ['sensor', 'kick', 'pivot', 'zone', 'emitter', 'counter', 'points', 'collect', 'game', 'timer', 'tilt', 'restart', 'record', 'lamp', 'bell'] as const
/** The name a mechanic's toy (#106) uses for its own new kind; the page gives the kind its real name. */
export const INVENTED = 'invented'

/** The limits on a toy written as data: the checker (made.ts) enforces them, and the host quotes them to the model. */
export const MADE = {
  parts: 40,
  /** Moving parts cost every step; ten pins and a ball is 11. */
  moving: 16,
  /** A game is a couple of dozen: a sensor a pin, counters, a round, lamps, a bell (#108). */
  gadgets: 32,
  wires: 64,
  /** Half extents and radii, m. */
  size: [0.004, 0.5] as const,
  /** kg. */
  mass: [0.005, 10] as const,
  /** A part may sink this far into the surface (m) and still be on it. */
  slack: 0.01,
  /** Shapes one part may be made of (a part made of pieces is one body). */
  pieces: 24,
}

/** The limits a place sets on a toy written as data: the home's are MADE; a street asks for bigger things and fewer kinds. */
export interface Limits {
  parts: number
  moving: number
  gadgets: number
  wires: number
  size: readonly [number, number]
  mass: readonly [number, number]
  slack: number
  pieces: number
  /** The gadget kinds allowed, when not the whole made kit. */
  kinds?: readonly string[]
}
