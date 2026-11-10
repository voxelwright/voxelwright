// The gadget kinds a toy made from a sentence may contain (#88), and nothing else: no fire (the
// flame kind) and nothing that needs a key a made toy does not get (hinge, piston). The one list:
// the page's checker (made.ts) refuses other kinds, and the host quotes only these to the model.
// No imports, so the host can read it as it is.
export const MADE_KINDS = ['sensor', 'kick', 'pivot', 'zone', 'emitter', 'counter'] as const
