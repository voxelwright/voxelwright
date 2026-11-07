// The sound contract (#52). Plugins announce what happened with the events below and
// never name a sound; src/sound/map.ts is the one place that turns an event into a cue.
// Other threads (build mode, themes, screens, bring-your-own-bot) add an event here and
// a line in the map, not a clip of their own.
//
// Positions are world space. The sound plugin projects them through the stage camera
// for stereo pan, so a plugin passes what it has (a head, a prop, a door) and nothing
// about the screen.

/** A world position: a THREE.Vector3 or anything with x, y, z. */
export interface Where { x: number; y: number; z: number }

/** Part of a timed motion: `seconds` is how long it will take; 0 when reduced motion makes it instant. */
export interface Timed { seconds: number }

declare module 'cordis' {
  interface Events {
    /** The pointer or keyboard focus landed on an entry (its glow starts). Not sent when it leaves. */
    'village/hover'(e: { id: string; at?: Where }): void
    /** An entry was chosen (click, tap or Enter). */
    'village/chose'(e: { id: string; at?: Where }): void
    /** The chosen entry was let go (Escape or a click elsewhere). */
    'village/backed'(e: { id: string }): void
    /** The camera starts an eased move. Not sent for jumps. */
    'village/glide'(e: Timed & { to?: Where }): void
    /** A villager was chosen and turns to face the person. */
    'village/turned'(e: { villager: string; at?: Where }): void
    /** A villager waves on hover. */
    'village/greeted'(e: { villager: string; at?: Where }): void
    /** A reply card appeared (`page` 0) or turned to its next page. */
    'village/card'(e: { villager: string; page: number; at?: Where }): void
    /** The notepad rose (up) or went down. */
    'village/pad'(e: { up: boolean }): void
    /** Text changed on the notepad: `added` characters (negative for deletions). Sent per input event. */
    'village/wrote'(e: { added: number }): void
    /**
     * Sketching on the pad: the pen or rubber moving (at most one per 75 ms while it moves),
     * or a stroke undone or the page cleared (once each).
     */
    'village/sketched'(e: { tool: 'pen' | 'rubber' | 'undo' | 'clear' }): void
    /** The slip, or a sketched page, was torn off and flies to `to` (a villager id), landing after `seconds`. */
    'village/sent'(e: Timed & { to?: string; from?: Where; at?: Where }): void
    /** A note found where it goes. `route` is talk.ts's route name; `ok` false when it found nowhere. */
    'village/routed'(e: { route: string; ok: boolean; villager?: string; at?: Where }): void
    /** Furnishing: a ghost appears, the prop arrives, is kept, undone, or making it failed. */
    'village/furnish'(e: { state: 'ghost' | 'placed' | 'kept' | 'undone' | 'failed'; at?: Where }): void
    /** The journal opened or closed. */
    'village/book'(e: Timed & { open: boolean }): void
    /** Journal leaves turned: `leaves` of them, `dir` +1 forward, -1 back. */
    'village/page'(e: Timed & { leaves: number; dir: 1 | -1 }): void
    /** A villager sat down at the table (the hop lands after `seconds`). */
    'village/sat'(e: Timed & { villager: string; at?: Where }): void
    /** Everyone at the table said goodbye and left. */
    'village/farewell'(e: { villagers: string[] }): void
    /** A villager has news: the "!" over its head appeared. */
    'village/news'(e: { villager: string; at?: Where }): void
    /** A room walk: `leave` as the camera heads for the door, `arrive` as the new room eases in. */
    'village/walk'(e: Timed & { phase: 'leave' | 'arrive'; from: string; to: string; at?: Where }): void
    /** Something can't be used yet (the closed Workshop door). */
    'village/refused'(e: { id: string; at?: Where }): void
  }
}

/**
 * The mix. Every sound goes through one bus, then the master and a soft limiter on the
 * shared context (voice/context.ts). `voices` ducks `music`; `ui` and `world` do not.
 */
export type BusName = 'ui' | 'world' | 'voices' | 'music'

/** What the player hands a cue for one play. */
export interface Play {
  /** Start time on the context's clock. */
  at: number
  /** Stereo position, -1 to 1 (already clamped by the player to the room's width). */
  pan: number
  /** Linear gain for this play: the cue's level with volume jitter applied. */
  gain: number
  /** Playback-rate / pitch multiplier for this play (pitch jitter); 1 is as designed. */
  rate: number
  /** Round-robin index: 0, 1, 2, ... per cue, so takes rotate and never repeat back to back. */
  index: number
  /** Seeded random in [0, 1) for this play, so a render with the same seed is the same. */
  random: () => number
  /** The event's `seconds` when it has one, else NaN. 0 means the motion is instant. */
  seconds: number
  /** The event's payload, for cues that read more (e.g. `added`, `leaves`). */
  event: Record<string, unknown>
}

/** What a cue may use besides the context. */
export interface Kit {
  /** A decoded sample from public/audio/sfx/, or undefined while it is still loading (then play nothing or a synth stand-in). */
  sample(name: string): AudioBuffer | undefined
  /** One second of seeded white noise, mono, for synthesized breath, paper and air. */
  noise: AudioBuffer
}

/** The cues src/sound/map.ts can reach. A cue may have several variants ('a', 'b', ...) for listening rounds. */
export type CueName =
  | 'hover' | 'chose' | 'backed' | 'glide' | 'turned' | 'card'
  | 'pad-up' | 'pad-down' | 'writing' | 'sketch' | 'sent' | 'routed' | 'unrouted'
  | 'ghost' | 'placed' | 'kept' | 'undone' | 'failed'
  | 'book-open' | 'book-close' | 'page' | 'sat' | 'farewell' | 'news' | 'walk' | 'refused'

/**
 * Every cue's variants. The palette's CHOSEN names the owner's pick per cue, and `a` plays
 * for any cue it does not name. `?sfx=chose:b,sent:c` (or the listening page's stored picks)
 * chooses another for a visit. src/sound/palette/index.ts exports one of these.
 */
export type Palette = Record<CueName, Record<string, Cue>>

/**
 * One sound. A cue builds its nodes into `out` (a panner on its bus) at `p.at` and
 * leaves them to end on their own; it must not connect to the destination itself.
 * It works on any BaseAudioContext, so the checks render it offline.
 */
export interface Cue {
  bus: BusName
  /** Sample files (in public/audio/sfx/) this cue uses: fetched and decoded after the first gesture, never on first play. */
  samples?: string[]
  /** Level in dB on its bus before jitter. */
  level: number
  /** Per-play variation: pitch in cents (±) and volume in dB (±). */
  jitter?: { cents?: number; db?: number }
  /** Seconds that must pass before this cue plays again; calls inside it are dropped. */
  gap?: number
  /** Longest the cue can ring, in seconds (for offline renders and CPU checks). */
  length: number
  play(audio: BaseAudioContext, out: AudioNode, p: Play, kit: Kit): void
}
