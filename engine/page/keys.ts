// Which letter keys are whose (#246): the page's own, the page's but given way to a realm's offer, and the ones the
// page hands to offers that asked for no key. One list, read by the page (hands.ts) and by the world's process
// (rules/hands.mjs, which refuses a rule's offer the page's own). `node test/keys.mjs` reads the page's code for
// every letter key it listens for and fails on one that is not written here, or that is also handed out.
//
// This file is read by the page and by the world's process alike.

/** The page's whatever a realm offers: a rule asking for one is told no, and the page picks another. */
export const OWN: Readonly<Record<string, string>> = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', KeyC: 'down',
  KeyQ: 'the wand in hand', KeyX: 'what the wand shares',
  KeyG: 'pick up and put down', KeyT: 'throw what is held; with nothing held, stop time and hold to wind it back',
  KeyB: 'on foot or flying', KeyP: 'the portal',
  // On foot V is the eye's, and the foot's mode is put over the offers whenever the body is taken up again (after a
  // ride, through the portal): an offer on V worked or not by what the person had done since the page opened.
  KeyV: 'where the eye rides, on foot',
  KeyO: 'open the billboard ahead',
  KeyM: 'the map',
}

/**
 * The page's, but an offer that asks for one has it: the offers' mode is over the page's own (hands.ts). E is the
 * page's again only beside a ride or an instrument, whose modes are put over the offers while they are near.
 * None is handed to an offer that asked for no key.
 */
export const YIELDED: Readonly<Record<string, string>> = {
  KeyE: 'get on a ride, take up an instrument, beside one',
  KeyR: 'rain; open radio while driving', KeyF: 'fire ahead; take a stopped traffic car; repair while driving', KeyH: 'heat', KeyK: 'maps', KeyL: 'shadows',
  KeyN: 'next radio station while driving',
}

/** Handed, in order, to offers that asked for no key: letters the page never listens for. */
export const FREE: readonly string[] = ['KeyY', 'KeyZ', 'KeyU', 'KeyI', 'KeyJ']
