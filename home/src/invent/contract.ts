// What an invented mechanic's code sees (#106), and all it sees. The code is model output. It
// runs in a QuickJS interpreter inside a worker inside a sealed frame (./sandbox.ts), where these
// are plain objects made by ./prelude.ts: there is no page, no network and no engine behind
// them. Calling `w.push` only writes a line in a list; the page reads that list as data and
// checks every line before the world moves (src/engine/invent.ts). The host quotes this file to
// the model as it is, so it has no imports.

type Vec3 = [number, number, number]

/** A thing that can move: a ball, a block, a pin. Positions are world space, metres; y is up. */
export interface Thing {
  /** Its name, to act on it: 'house/ball-1'. */
  key: string
  /** 'steel', 'felt', 'maple', 'glass', 'rubber', ... */
  material: string
  position: Vec3
  /** m/s. */
  velocity: Vec3
  /** kg. */
  mass: number
  /** Its largest half extent, m. */
  size: number
}

/** One gadget of your kind, built into the toy. */
export interface Gadget {
  /** The knobs you declared, as tuned now. Read only. */
  knobs: Record<string, number>
  /** Your own numbers, kept between calls and in the world's snapshots: numbers only. Starts empty. */
  state: Record<string, number>
  /** The part this gadget sits on (its own body), when the toy gave it one. A fixed part has zero velocity. */
  part?: Thing
  /** Where the toy stands, in world space: the centre of the surface's top and its x and z directions (unit vectors; y is up). A point [a, b, c] of the toy is at + a·x + b·[0, 1, 0] + c·z. */
  surface: { at: Vec3; x: Vec3; z: Vec3 }
  /** Fires one of the outputs you declared, to whatever is wired to it. */
  fire(port: string, value: number, thing?: string): void
  /** Writes a few characters (a count, a word) on the toy's part this gadget names as its "display": a small card. Without one, nothing is drawn. */
  show(text: string): void
}

/** Something touched this gadget's part. */
export interface Touch {
  /** The other thing's key. It is in `w.things` only when it can move. */
  other: string
  /** How hard, N·s; 0 when the part is a sensor volume. */
  impulse: number
  /** Unit vector from the part towards the other thing. */
  dir: Vec3
  point: Vec3
}

export interface World {
  /** Seconds this call stands for: 1/60 normally, more when calls were skipped. */
  h: number
  /** Simulated seconds since the world started. */
  clock: number
  gravity: Vec3
  /** The things that can move, as they were when this call began. */
  things: Thing[]
  /** Things of the home by name, each a point in world space, read again about twice a second: `w.places['lamp']`. A name that is not here is undefined. */
  places: Record<string, Vec3>
  /** Adds momentum to a thing, N·s: `w.push(t.key, [0, 0.01, 0])`. */
  push(key: string, impulse: Vec3): void
  /** Sets how fast a thing moves, m/s. */
  setVelocity(key: string, velocity: Vec3): void
  /** Puts a thing somewhere else at once, keeping its turn; at rest unless a velocity is given. */
  moveTo(key: string, position: Vec3, velocity?: Vec3): void
}

// A mechanic is plain JavaScript, a script and not a module: no import, no export, no async, no
// timers, no console. It defines any of these three functions at the top level. Everything it
// does to the world happens one step (1/60 s) after the call that asked for it.

/** Each step, for each gadget of your kind. */
declare function step(g: Gadget, w: World): void
/** Something touched the gadget's part. */
declare function touch(g: Gadget, t: Touch, w: World): void
/** A signal arrived on one of the inputs you declared. */
declare function receive(g: Gadget, port: string, signal: { value: number; thing?: string }, w: World): void
