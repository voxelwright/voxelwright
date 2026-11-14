// Moves (#218, for #264): what a figure does with its limbs, as data. A pose is a number for each
// of a figure's joints (the channels below); a move is poses over time (keys), each naming only
// the joints it sets, so a wave leaves the legs to walk and a kick leaves the arms where they
// were. The figure (people.ts) works out what the body would be doing anyway (standing, walking,
// running, shrinking from a blast), and a move is laid over that. Nothing here knows what a move
// is for: a rule of a world, or a model writing one, can send keys nobody foresaw, and the ones
// with names below are no more than keys written down.
//
// This file is read by the page and by the world's process alike (which checks what a rule sends).

/**
 * The joints. Angles are radians.
 *   lean   the chest forward (back if under 0)      twist  the chest to its right     tilt  the chest over to its right
 *   nod    the head down                            turn   the head to its right
 *   liftL, liftR   an arm forward and up from hanging: 1.57 is straight ahead, 3.14 straight up
 *   outL, outR     an arm out sideways from the body: 1.57 is level
 *   bendL, bendR   an elbow
 *   swingL, swingR a thigh forward (back if under 0)      kneeL, kneeR  a knee
 *   crouch 0 to 1: down on both knees' bend         sit    0 to 1: thighs level, as on a seat
 *   rise   cells off the ground (a jump)            lie    0 to 1: over onto the back; to -1: onto the front
 *   aimL, aimR     0 to 1: that arm straight at what the move is aimed at
 */
export const CHANNELS = ['lean', 'twist', 'tilt', 'nod', 'turn', 'liftL', 'outL', 'bendL', 'liftR', 'outR', 'bendR', 'swingL', 'kneeL', 'swingR', 'kneeR', 'crouch', 'sit', 'rise', 'lie', 'aimL', 'aimR'] as const
export type Channel = (typeof CHANNELS)[number]
/** A pose at a moment of a move: `t` seconds in, and the joints it sets. */
export type Key = { t: number } & Partial<Record<Channel, number>>
/** Poses over time. `loop`: it goes round until another is set. `hold`: it stays in its last pose (someone sitting, aiming, lying); otherwise the body goes back to what it was doing. */
export interface Move { keys: Key[]; loop?: boolean; hold?: boolean }

/** What each joint may be set to. */
const RANGE: Record<Channel, [number, number]> = Object.fromEntries(CHANNELS.map((c) => [c, c === 'crouch' || c === 'sit' || c === 'aimL' || c === 'aimR' ? [0, 1] : c === 'rise' ? [0, 15] : c === 'lie' ? [-1, 1] : [-3.3, 3.3]])) as Record<Channel, [number, number]>
/** The most keys a move may have, and the longest it may be (seconds). */
export const KEYS_MOST = 24, LONGEST = 30
/** How long a body takes to go back to what it was doing when a move ends, and to come into one (seconds). */
const OUT = 0.3, IN = 0.1

/** The moves that have names: written as anyone's would be. Times are seconds. */
export const NAMED: Record<string, Move> = {
  wave: { loop: true, keys: [{ t: 0, outR: 2.45, liftR: 0.25, bendR: 0.35, turn: 0.1 }, { t: 0.28, bendR: 1.15 }, { t: 0.56, bendR: 0.35 }] },
  cheer: { loop: true, keys: [{ t: 0, liftL: 2.75, liftR: 2.75, outL: 0.3, outR: 0.3, bendL: 0.35, bendR: 0.35, crouch: 0.16, rise: 0, nod: -0.2 }, { t: 0.22, liftL: 3.05, liftR: 3.05, bendL: 0.1, bendR: 0.1, crouch: 0, rise: 1.6 }, { t: 0.46, liftL: 2.75, liftR: 2.75, bendL: 0.35, bendR: 0.35, crouch: 0.16, rise: 0 }] },
  clap: { loop: true, keys: [{ t: 0, liftL: 1.15, liftR: 1.15, bendL: 1.25, bendR: 1.25, outL: 0.35, outR: 0.35 }, { t: 0.16, outL: -0.32, outR: -0.32 }, { t: 0.34, outL: 0.35, outR: 0.35 }] },
  point: { hold: true, keys: [{ t: 0.22, aimR: 1, twist: -0.15 }] },
  // A fist thrown with the right: the guard, the blow with the shoulder behind it, the guard again.
  strike: { keys: [{ t: 0.1, liftR: 0.95, bendR: 2.1, liftL: 1.05, bendL: 2.05, outL: -0.1, outR: -0.1, twist: 0.38, crouch: 0.12 }, { t: 0.2, aimR: 1, liftR: 1.55, bendR: 0.05, twist: -0.5, lean: 0.22, swingL: 0.25, swingR: -0.25 }, { t: 0.27, aimR: 1, liftR: 1.55, bendR: 0.05, twist: -0.5, lean: 0.22 }, { t: 0.48, aimR: 0, liftR: 0.95, bendR: 2.1, twist: 0.1, lean: 0.05, swingL: 0, swingR: 0 }, { t: 0.7, liftR: 0.95, bendR: 2.1, liftL: 1.05, bendL: 2.05, twist: 0, crouch: 0.12 }] },
  kick: { keys: [{ t: 0.12, swingR: -0.35, kneeR: 0.9, lean: 0.1, liftL: 0.9, bendL: 1.6, liftR: 0.7, bendR: 1.5, outL: 0.3, outR: 0.3 }, { t: 0.24, swingR: 1.0, kneeR: 1.5, lean: -0.1 }, { t: 0.33, swingR: 1.55, kneeR: 0.05, lean: -0.38, twist: 0.2 }, { t: 0.4, swingR: 1.55, kneeR: 0.05, lean: -0.38 }, { t: 0.58, swingR: 0.5, kneeR: 1.1, lean: -0.05, twist: 0 }, { t: 0.8, swingR: 0, kneeR: 0.06, lean: 0, liftL: 0.9, bendL: 1.6, liftR: 0.7, bendR: 1.5, outL: 0.3, outR: 0.3 }] },
  block: { hold: true, keys: [{ t: 0.12, liftL: 1.5, bendL: 2.25, liftR: 1.5, bendR: 2.25, outL: -0.28, outR: -0.28, crouch: 0.22, nod: 0.25, lean: 0.12 }] },
  duck: { hold: true, keys: [{ t: 0.14, crouch: 0.85, lean: 0.75, nod: 0.3, liftL: 2.3, bendL: 1.9, liftR: 2.3, bendR: 1.9 }] },
  // One hand out at what is aimed at; and with both, as a long thing is held.
  aim: { hold: true, keys: [{ t: 0.18, aimR: 1, twist: -0.3, liftL: 0.25, bendL: 0.5, swingL: 0.18, swingR: -0.18 }] },
  'aim-both': { hold: true, keys: [{ t: 0.2, aimR: 1, aimL: 1, twist: -0.25, lean: 0.1, swingL: 0.2, swingR: -0.2, crouch: 0.1 }] },
  // What is fired kicks: from an aim, and back into it.
  fire: { hold: true, keys: [{ t: 0, aimR: 1, twist: -0.3, liftL: 0.25, bendL: 0.5, swingL: 0.18, swingR: -0.18, lean: 0 }, { t: 0.05, aimR: 0.8, lean: -0.1, twist: -0.2 }, { t: 0.24, aimR: 1, lean: 0, twist: -0.3 }] },
  'fire-both': { hold: true, keys: [{ t: 0, aimR: 1, aimL: 1, twist: -0.25, lean: 0.1, swingL: 0.2, swingR: -0.2, crouch: 0.1 }, { t: 0.05, aimR: 0.86, aimL: 0.86, lean: -0.04, twist: -0.12 }, { t: 0.22, aimR: 1, aimL: 1, lean: 0.1, twist: -0.25 }] },
  throw: { keys: [{ t: 0.2, liftR: 2.6, bendR: 1.6, twist: 0.5, lean: -0.15, liftL: 1.3, swingL: 0.3, swingR: -0.25 }, { t: 0.34, liftR: 1.7, bendR: 0.1, twist: -0.55, lean: 0.35 }, { t: 0.5, liftR: 0.6, bendR: 0.2, twist: -0.3, lean: 0.25, liftL: 0.2 }, { t: 0.8, twist: 0, lean: 0, swingL: 0, swingR: 0 }] },
  // Struck: knocked back a step, and upright again.
  hit: { keys: [{ t: 0.07, lean: -0.5, nod: -0.35, liftL: 0.9, outL: 0.7, liftR: 0.75, outR: 0.65, bendL: 0.6, bendR: 0.5, crouch: 0.22, swingR: -0.35, twist: 0.25 }, { t: 0.3, lean: -0.2, nod: 0, crouch: 0.3, swingR: -0.2, twist: 0.1 }, { t: 0.6, lean: 0.1, crouch: 0.1, swingR: 0, twist: 0, liftL: 0.3, outL: 0.2, liftR: 0.3, outR: 0.2 }] },
  fall: { hold: true, keys: [{ t: 0.14, lean: -0.3, crouch: 0.55, liftL: 1.3, liftR: 1.3, outL: 0.8, outR: 0.8, lie: 0.1 }, { t: 0.32, lie: 0.55, crouch: 0.8, lean: 0.45 }, { t: 0.55, lie: 1, crouch: 0.08, lean: 0, liftL: 0.35, liftR: 0.35, outL: 1.0, outR: 1.0, swingL: 0.1, kneeL: 0.3 }] },
  'fall-forward': { hold: true, keys: [{ t: 0.14, lean: 0.5, crouch: 0.5, liftL: 1.5, liftR: 1.5, bendL: 0.6, bendR: 0.6, lie: -0.1 }, { t: 0.5, lie: -1, crouch: 0.05, lean: 0, liftL: 2.6, liftR: 2.7, bendL: 0.9, bendR: 0.7, outL: 0.5, outR: 0.5 }] },
  'get-up': { keys: [{ t: 0, lie: 1, crouch: 0.08 }, { t: 0.5, lie: 0.55, crouch: 0.9, lean: 0.7, liftL: 0.6, liftR: 0.6 }, { t: 0.95, lie: 0, crouch: 0.6, lean: 0.5 }, { t: 1.3, crouch: 0, lean: 0, liftL: 0, liftR: 0 }] },
  sit: { hold: true, keys: [{ t: 0.5, sit: 1, lean: 0.08, liftL: 0.55, bendL: 0.75, liftR: 0.55, bendR: 0.75 }] },
  jump: { keys: [{ t: 0.14, crouch: 0.55, liftL: -0.5, liftR: -0.5, lean: 0.25 }, { t: 0.34, rise: 6, crouch: 0, liftL: 2.3, liftR: 2.3, lean: 0 }, { t: 0.58, rise: 0, crouch: 0.45, liftL: 0.6, liftR: 0.6 }, { t: 0.8, crouch: 0, liftL: 0, liftR: 0 }] },
  shrug: { keys: [{ t: 0.2, liftL: 0.5, outL: 0.5, bendL: 1.3, liftR: 0.5, outR: 0.5, bendR: 1.3, tilt: 0.06, nod: -0.1 }, { t: 0.7, liftL: 0.5, outL: 0.5, bendL: 1.3, liftR: 0.5, outR: 0.5, bendR: 1.3 }, { t: 1.0, liftL: 0, outL: 0, bendL: 0.12, liftR: 0, outR: 0, bendR: 0.12, tilt: 0, nod: 0 }] },
  'hands-up': { hold: true, keys: [{ t: 0.25, liftL: 2.9, liftR: 2.9, outL: 0.45, outR: 0.45, bendL: 0.25, bendR: 0.25 }] },
}

/** How long a move is: to its last key. */
export const lengthOf = (move: Move) => Math.max(0.05, move.keys[move.keys.length - 1].t)

/**
 * A move as it may be played, from what someone sent: a name of one that has one, or keys. Null if it is neither.
 * Whatever is sent is read as from a stranger: only the joints there are, each within what a joint can do, no more
 * keys than a move may have, in order of time.
 */
export function moveOf(from: unknown): Move | null {
  if (typeof from === 'string') return NAMED[from] ?? null
  if (!from || typeof from !== 'object') return null
  const f = from as { keys?: unknown; loop?: unknown; hold?: unknown }
  if (!Array.isArray(f.keys) || !f.keys.length) return null
  const keys: Key[] = []
  let last = 0
  for (const k of f.keys.slice(0, KEYS_MOST)) {
    if (!k || typeof k !== 'object' || !Number.isFinite((k as Key).t)) return null
    const key: Key = { t: Math.max(last, Math.min(LONGEST, (k as Key).t)) }
    last = key.t
    for (const c of CHANNELS) { const v = (k as Key)[c]; if (typeof v === 'number' && Number.isFinite(v)) key[c] = Math.max(RANGE[c][0], Math.min(RANGE[c][1], v)) }
    keys.push(key)
  }
  return { keys, loop: f.loop === true, hold: f.hold === true }
}

const ease = (v: number) => { const c = Math.max(0, Math.min(1, v)); return c * c * (3 - 2 * c) }

/**
 * Lays a move, `t` seconds in, over a pose: `pose` holds what each joint would be doing anyway (in the order of
 * CHANNELS) and is changed where the move says. Returns whether the move is still going.
 */
export function play(move: Move, t: number, pose: Float64Array): boolean {
  const long = lengthOf(move), keys = move.keys
  if (t < 0) return true
  if (!move.loop && !move.hold && t > long + OUT) return false
  // Round and round: after the first time round, a joint before its first key is where its last key left it.
  const lap = move.loop ? Math.floor(t / long) : 0, at = move.loop ? t - lap * long : Math.min(t, long)
  // Coming in, and going back to what the body was doing when it is over.
  const weight = ease(t / IN) * (move.loop || move.hold ? 1 : 1 - ease((t - long) / OUT))
  for (let c = 0; c < CHANNELS.length; c++) {
    const name = CHANNELS[c]
    let before = -1, after = -1, lastOf = -1
    for (let k = 0; k < keys.length; k++) {
      if (keys[k][name] === undefined) continue
      lastOf = k
      if (keys[k].t <= at) before = k
      else if (after < 0) after = k
    }
    if (lastOf < 0) continue
    const base = pose[c]
    // Before its first key a joint comes from what it was doing (or, going round again, from its last key).
    const v0 = before >= 0 ? keys[before][name]! : lap > 0 ? keys[lastOf][name]! : base, t0 = before >= 0 ? keys[before].t : 0
    const v = after < 0 ? v0 : v0 + (keys[after][name]! - v0) * ease((at - t0) / Math.max(1e-6, keys[after].t - t0))
    pose[c] = base + (v - base) * weight
  }
  return true
}
