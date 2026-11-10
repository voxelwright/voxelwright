// The gadget kinds a toy made from a sentence may contain (#88), and nothing else: no fire (the
// flame kind) and nothing that needs a key a made toy does not get (hinge, piston). The one list:
// the page's checker (made.ts) refuses other kinds, and the host quotes only these to the model.
// No imports, so the host can read it as it is.
/** The name a mechanic's toy (#106) uses for its own new kind; the page gives the kind its real name. */
export const INVENTED = 'invented'
export const MADE_KINDS = ['sensor', 'kick', 'pivot', 'zone', 'emitter', 'counter'] as const

/** The limits on a toy written as data: the checker (made.ts) enforces them, and the host quotes them to the model. */
export const MADE = {
  parts: 40,
  /** Moving parts cost every step; ten pins and a ball is 11. */
  moving: 16,
  gadgets: 16,
  wires: 32,
  /** Half extents and radii, m. */
  size: [0.004, 0.5] as const,
  /** kg. */
  mass: [0.005, 10] as const,
  /** A part may sink this far into the surface (m) and still be on it. */
  slack: 0.01,
}
