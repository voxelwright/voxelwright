// The gadget kinds a toy made from a sentence may contain (#88), and nothing else: no fire (the
// flame kind) and nothing that needs a key a made toy does not get (hinge, piston). The one list:
// the page's checker (made.ts) refuses other kinds, and the host quotes only these to the model.
// No imports, so the host can read it as it is.
// With the logic parts (#108) a made toy can be a whole game: a round, a score shown on a card, lamps
// and a bell, a time limit, a set to complete, a best score, and its pieces put back for the next round. No
// spawner (it places a part anywhere in the toy's frame), and no freeze or shake: those reach
// past the toy, to the whole world and the person's view.
export const MADE_KINDS = ['sensor', 'kick', 'pivot', 'zone', 'emitter', 'counter', 'points', 'collect', 'game', 'timer', 'tilt', 'restart', 'record', 'lamp', 'bell'] as const
