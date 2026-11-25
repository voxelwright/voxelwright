// The kinds of frame in a world's stream (serve.mjs says what each carries): for every reader of it, a page's link.ts
// and the door (door.mjs) among them.
export const LOG = 1, STATE = 2, ECHO = 3, NOW = 4, HERE = 5, SAID = 6, LIVING = 7, OFFERS = 8, SHOWN = 9, PLUGGED = 11, BODIES = 12, BLOW = 13, GROUND = 14
/** What a reader far behind is not sent (where things are now): by the time it read that, they would be elsewhere. */
export const SKIPPED = new Set([STATE, HERE, SHOWN, BLOW])
/** How far behind a reader is far behind, bytes. */
export const BEHIND = 1 << 20
