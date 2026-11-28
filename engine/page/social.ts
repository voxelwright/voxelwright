// Client-side RDR2/GTA 6 social interaction & living-city status HUD (#164).
//
// Obeys .agents/skills/game-hud/SKILL.md:
//   - Zero clutter at rest: completely hidden (`hidden`, `display: none`, `pointer-events: none`)
//     when no NPC/resident is within 6 m (60 cells) in the forward 70° view cone, or while driving,
//     typing, in the first view, viewing the map, or opening a menu/wheel.
//   - Living-city Heat / Witness pill auto-hides completely when `heat === 0` and no witness is reporting.
//   - Never overlaps the character's box (`avoidBoxes`) or phone safe areas.
//   - Instant 0 ms local barks for solo/offline SF pedestrians + authoritative `POST /world/social`
//     and lightweight `GET /world/city` polling on shared worlds.
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import type { Person } from './people.ts'

/** Maximum interaction distance in world cells (10 cm per cell => 60 cells = 6.0 m). */
export const SOCIAL_RANGE_CELLS = 60
/** Full forward view cone angle in degrees (±35° from forward). */
export const SOCIAL_CONE_DEG = 70
/** Maximum vertical height difference in cells (3.5 m) so roof/below-floor NPCs are excluded. */
export const SOCIAL_MAX_DY_CELLS = 35
/** Lightweight polling interval for `GET /world/city` on shared worlds (ms). */
export const SOCIAL_POLL_MS = 2500
/** Conflict-free contextual keys (all declared in `engine/page/keys.ts` OWN/YIELDED, never FREE). */
export const SOCIAL_KEYS = {
  greet: 'KeyG',
  antagonize: 'KeyH',
  defuse: 'KeyF',
} as const

const COS_HALF_CONE = Math.cos(((SOCIAL_CONE_DEG * 0.5) * Math.PI) / 180)
const ESCALATION_WINDOW_SEC = 30
const NEIGHBORHOOD_TONES = ['aloof', 'friendly', 'hurried', 'cynical', 'defensive'] as const

export type NeighborhoodTone = (typeof NEIGHBORHOOD_TONES)[number]
export type SocialAction = 'greet' | 'antagonize' | 'defuse' | 'intimidate' | 'apologize' | 'bribe'

export interface SocialCandidate {
  /** Shared-world actorId (`<rule>/<id>`) or local pedestrian id (`local:<seed>`). */
  id: string
  /** Display name shown on the contextual prompt pill. */
  name: string
  /** Feet position in world cells (10 cm). */
  at: readonly [number, number, number]
  /** True when backed by a live shared-world actor (`POST /world/social`). */
  remote: boolean
  /** Pedestrian/resident seed for deterministic barks & 3D overhead speech pills. */
  seed?: number
  /** Optional district/neighborhood name for tone modulation. */
  district?: string
}

export interface SocialObserver {
  /** Player feet (or eye) position in world cells (10 cm). */
  at: readonly [number, number, number]
  /** Horizontal forward vector or 3D camera forward vector. */
  forward?: readonly [number, number, number]
  /** Yaw in radians (0 = north / -z, +π/2 = east / +x); used when `forward` is omitted or vertical. */
  yaw?: number
}

export interface SocialTarget {
  candidate: SocialCandidate
  distanceCells: number
  distanceM: number
  angleDeg: number
  isWitness: boolean
}

export interface WitnessInfo {
  witnessId: string
  crimeId?: string
  kind?: string
  state?: string
  method?: string
  pos?: readonly [number, number, number]
  remainingMs?: number
}

export interface CityStatus {
  heat: number
  witnesses: readonly WitnessInfo[]
  dominantMood: string
  panicRatio: number
  updatedAt: number
}

export interface LocalBark {
  text: string
  tone: NeighborhoodTone
  mood: string
  moodDelta: number
  trustDelta: number
  escalateToMind: boolean
  outcome: string
  step: number
  ms: number
}

export interface SocialResult {
  actorId: string
  name: string
  action: SocialAction
  bark: LocalBark
  trust: number
  mood: string
  intercepted: boolean
  escalateToMind: boolean
  remote: boolean
}

export interface HudBox {
  left: number
  top: number
  right: number
  bottom: number
}

export interface SocialWorldLink {
  /** World HTTP base path (e.g. `/world` or `/realm/<id>/world`). */
  base: string
  /** Local player's id in the shared world. */
  me: string
  /** Local player's display name. */
  name(): string
  /** Fetch function (direct or through WebRTC door). */
  fetch(path: string, init?: RequestInit): Promise<Response>
}

export interface SocialOptions {
  /** Optional HUD layer to mount the auto-hiding social panel inside (`hud.panel('social')`). */
  hud?: Pick<Hud, 'panel' | 'heard'> | null
  /** Optional direct mount element (used in tests or standalone mounts). */
  mount?: HTMLElement | null
  /** Optional input stack to bind contextual `G` / `H` / `F` keys cleanly. */
  input?: Pick<Input, 'push'> | null
  /** Shared-world connection for `POST /world/social` and `GET /world/city`, or null for solo/offline play. */
  world?: SocialWorldLink | null
  /** Returns current player observer position & look direction (world cells). */
  observer: () => SocialObserver | null
  /** Returns current remote/shared-world candidate NPCs. */
  candidates?: () => readonly SocialCandidate[]
  /** Returns whether social prompts and keys must be hidden/disabled (e.g. driving, typing, first view, map). */
  disabled?: () => boolean
  /** Optional per-key suppression check (e.g. `KeyG` when holding/reaching a made thing in `hands.ts`). */
  suppressKey?: (code: string) => boolean
  /** Optional character body boxes to avoid overlapping (`playHud.parts()`). */
  avoidBoxes?: () => readonly HudBox[] | null | undefined
  /** Current weather label (`'clear' | 'rain' | 'fog' | 'night'`) for local contextual barks. */
  weather?: () => 'clear' | 'rain' | 'fog' | 'night'
  /** Current district/neighborhood label for local tone selection. */
  district?: () => string
  /** Whether free-text Talk / Mind input is available in this world. */
  canTalk?: () => boolean
  /** Invoked when an exchange hits `escalateToMind: true` (e.g. 3rd Greet or high-tension confrontation). */
  onEscalateToMind?: (target: SocialTarget, result: SocialResult) => void
  /** Invoked when the player clicks the `[↵] Talk` nudge to open/focus the Talk input. */
  openTalk?: (target: SocialTarget, result: SocialResult | null) => void
  /** Optional clock override (ms) for deterministic tests. */
  now?: () => number
  /** Polling interval override (ms). Defaults to `SOCIAL_POLL_MS` (2500 ms). */
  pollMs?: number
}

export interface SocialController {
  /** Per-frame update: target lock, visibility, witness alert, and body-box avoidance. */
  frame(nowMs?: number): void
  /** Trigger a social action against the currently locked target (or an explicit target). */
  act(action: SocialAction, explicit?: SocialTarget | null): Promise<SocialResult | null>
  /** Poll `GET /world/city` immediately on shared worlds. */
  pollCity(): Promise<CityStatus | null>
  /** Observe local pedestrian/resident arrays during `folk.draw` and inject active 0 ms overhead speech pills. */
  observeLocal(list: readonly Person[]): void
  /** Read any active timed local speech line for a pedestrian seed. */
  speechFor(seed: number, nowMs?: number): string
  /** Inject city status directly (useful for deterministic tests or server push hooks). */
  setCityStatus(status: Partial<CityStatus>): void
  /** Currently target-locked NPC within 6 m & 70° cone, or null. */
  readonly target: SocialTarget | null
  /** Latest living-city Heat & Witness status. */
  readonly status: CityStatus
  /** Latest social interaction result. */
  readonly lastResult: SocialResult | null
  /** Whether the contextual prompt is currently shown. */
  readonly promptVisible: boolean
  /** Whether the living-city Heat / Witness status pill is currently shown. */
  readonly statusVisible: boolean
  /** Mounted DOM root container. */
  readonly root: HTMLElement | null
  /** Cleanly unmount DOM, stop timers, and pop the input mode. */
  destroy(): void
}

// ── Neighborhood Tone & Browser-Safe 0 ms Bark Engine ────────────────────────
// Mirrors `engine/rules/barks.mjs` with zero Node/server imports so it runs natively
// in browsers under `serve.mjs` (`OPEN = ['probe', 'page']`) and offline SF builds.

const DISTRICT_TONES: Readonly<Record<string, NeighborhoodTone>> = {
  'financial district': 'aloof',
  fidi: 'aloof',
  'pacific heights': 'aloof',
  marina: 'aloof',
  'nob hill': 'aloof',
  mission: 'friendly',
  'noe valley': 'friendly',
  'inner sunset': 'friendly',
  'north beach': 'friendly',
  castro: 'friendly',
  soma: 'hurried',
  'market street': 'hurried',
  'union square': 'hurried',
  embarcadero: 'hurried',
  downtown: 'hurried',
  tenderloin: 'cynical',
  'civic center': 'cynical',
  haight: 'cynical',
  'haight-ashbury': 'cynical',
  dogpatch: 'defensive',
  bayview: 'defensive',
  industrial: 'defensive',
  docks: 'defensive',
}

/** Map a district/street label or tone name to one of the 5 neighborhood tones. */
export function localDistrictTone(districtOrTone?: string | null): NeighborhoodTone {
  const raw = String(districtOrTone ?? '').trim().toLowerCase()
  if (!raw) return 'hurried'
  if ((NEIGHBORHOOD_TONES as readonly string[]).includes(raw)) return raw as NeighborhoodTone
  if (raw in DISTRICT_TONES) return DISTRICT_TONES[raw]
  for (const [name, tone] of Object.entries(DISTRICT_TONES)) {
    if (raw.includes(name)) return tone
  }
  return 'hurried'
}

function pickDet(list: readonly string[], seed: string): string {
  if (!list.length) return ''
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return list[h % list.length]
}

const WEATHER_TAGS: Readonly<Record<string, Readonly<Record<NeighborhoodTone, string>>>> = {
  rain: {
    aloof: 'Lovely drizzle for ruining a coat.',
    friendly: 'Stay dry out here, yeah?',
    hurried: 'Rain always doubles the commute.',
    cynical: 'Wet sidewalks, slick tempers.',
    defensive: 'Rain hides too much on this block.',
  },
  fog: {
    aloof: 'Karl is back right on schedule.',
    friendly: 'Thick marine layer today, huh?',
    hurried: 'Can barely see the crosswalk in this fog.',
    cynical: 'Fog rolls in and everyone forgets how to walk.',
    defensive: 'Stay where I can see you in this mist.',
  },
  night: {
    aloof: 'Late hour to be lingering.',
    friendly: 'Quiet night on the strip.',
    hurried: 'Trying to catch the last owl bus.',
    cynical: 'Nothing good opens after midnight around here.',
    defensive: 'Keep moving, it is late.',
  },
}

const BARK_LINES = {
  greet_1: {
    aloof: ['Mmm. Good day.', 'Afternoon. Excuse me.', 'Yes? Hello.'],
    friendly: ['Hey there! Good seeing a friendly face.', 'Morning, neighbor! How is it going?', 'Hey! Beautiful day out here.'],
    hurried: ['Hey—sorry, running late.', 'Morning, gotta dash.', 'Hi there, catching the train.'],
    cynical: ['Yeah, yeah, hey.', 'What do you want? Oh, just saying hi.', 'Alright, alright. Hey.'],
    defensive: ['Keep your distance. Evening.', 'Hey. You from around here?', 'Yeah? Make it quick.'],
  },
  greet_2: {
    aloof: ['Well, you certainly have manners. Good day to you.', 'Refreshing to meet someone polite on this avenue.', 'Alright, I appreciate the courtesy.'],
    friendly: ['Haha, I like your energy! Have a great one out there.', 'Always room for a decent chat on this block.', 'You are alright, neighbor—stay well!'],
    hurried: ['Okay, okay, you got a smile out of me. Take care!', 'Appreciate the check-in, really.', 'Thanks—needed a breather anyway.'],
    cynical: ['Huh. Most folks here just stare at their phones. Fair enough.', 'Alright, maybe today is not a total wash.', 'You are persistent—I respect it.'],
    defensive: ['Fair enough, no trouble then. Good day.', 'Alright, you seem square. Watch your step out here.', 'Okay, we are cool. Take it easy.'],
  },
  greet_3: {
    aloof: ['Since you insist on a proper conversation, what is on your mind?', 'You have my attention—speak your piece.'],
    friendly: ['Tell you what, I have a minute—what is the word around town?', 'You seem like you have a story to tell. Go on!'],
    hurried: ['Alright, the bus can wait one minute—what did you want to talk about?', 'Go ahead, you caught me while I am stopped.'],
    cynical: ['Third time is a conversation. Alright, lay it on me.', 'Okay, spill it—what are we actually talking about?'],
    defensive: ['You have been talking a lot. Speak plain—what do you need?', 'Alright, I am listening. Say what you came to say.'],
  },
  antagonize_1: {
    aloof: ['Excuse me? Mind your tone.', 'Do not speak to me like that.', 'How terribly rude. Walk on.'],
    friendly: ['Whoa, hey—no need for that.', 'Easy there, what is eating you?', 'Come on now, keep it civil.'],
    hurried: ['I do not have time for this—move!', 'Watch your mouth and get out of my way.', 'Seriously? Not today.'],
    cynical: ['Yeah, real tough. Keep walking.', 'Save the attitude for somebody who cares.', 'Big talk on a public sidewalk.'],
    defensive: ['Try saying that again and see what happens.', 'Back off. Right now.', 'Watch yourself, friend.'],
  },
  antagonize_2: {
    aloof: ['That is quite enough. Leave me alone or I am calling this in.', 'Step back right now—you are making a scene.'],
    friendly: ['Hey, I warned you! Back off before someone calls the cops.', 'Stop pushing it! I am not looking for trouble.'],
    hurried: ['Get out of my face! Somebody get a cop over here!', 'Touch me and I am dialing dispatch right now.'],
    cynical: ['You really want to start something right here? Think twice.', 'Keep barking and I will make it everyone else\'s problem too.'],
    defensive: ['Last warning—take one more step and we have a problem.', 'You picked the wrong block to test me.'],
  },
  antagonize_3: {
    confront: ['Alright, you asked for it—square up!', 'That is it! I am not backing down from you!'],
    flee: ['Stay away from me! Help!', 'Forget this—I am getting out of here!'],
    report: ['That does it—I am calling the police right now!', 'Hello, dispatch? Somebody is threatening people on the street!'],
  },
  defuse: {
    aloof: ['Hmph. Apology noted. Good day.', 'Very well. Let us both move on.'],
    friendly: ['Hey, no hard feelings! We all have rough mornings.', 'All good, neighbor—breathe easy.'],
    hurried: ['Fine, fine, forget it. Just watch it next time.', 'Yeah, whatever—we are good.'],
    cynical: ['Smart move backing off. Later.', 'Alright, no harm done. Keep moving.'],
    defensive: ['Good choice. Keep walking and we stay square.', 'Alright, cool it then. Move along.'],
  },
  intercept: [
    'Alright, alright—I did not see a thing! Just leave me alone!',
    'Okay, okay! Phone is away—I am walking out of here!',
  ],
} as const

export interface LocalExchangeState {
  mode: 'neutral' | 'greet' | 'antagonize'
  step: number
  trust: number
  lastAt: number
}

/** Deterministic 0 ms browser-safe Greet / Antagonize / Defuse state machine for solo/offline play. */
export function createLocalBarks({ escalationWindow = ESCALATION_WINDOW_SEC } = {}) {
  const exchanges = new Map<string, LocalExchangeState>()

  return {
    interact({
      actorId = 'npc',
      subjectId = 'player',
      action = 'greet' as SocialAction,
      district = 'downtown',
      weather = 'clear' as 'clear' | 'rain' | 'fog' | 'night',
      courage = 0.5,
      now = 0,
      seed = 0,
    }: {
      actorId?: string
      subjectId?: string
      action?: SocialAction
      district?: string
      weather?: 'clear' | 'rain' | 'fog' | 'night'
      courage?: number
      now?: number
      seed?: number
    } = {}): { bark: LocalBark; trust: number; state: LocalExchangeState } {
      const pairKey = `${actorId}|${subjectId}`
      let ex = exchanges.get(pairKey)
      if (!ex || now - ex.lastAt > escalationWindow) {
        ex = { mode: 'neutral', step: 0, trust: ex?.trust ?? 0, lastAt: now }
      }

      const tone = localDistrictTone(district)
      let resolved: 'greet' | 'antagonize' | 'defuse' | 'intimidate' = 'greet'
      let step = 1

      if (action === 'intimidate') {
        resolved = 'intimidate'
        ex.mode = 'antagonize'
        ex.step = 2
        step = 2
      } else if (action === 'defuse' || action === 'apologize' || (action === 'greet' && ex.mode === 'antagonize')) {
        resolved = 'defuse'
        ex.mode = 'neutral'
        ex.step = 0
        step = 1
      } else if (action === 'antagonize') {
        resolved = 'antagonize'
        ex.mode = 'antagonize'
        ex.step = Math.min(3, ex.step + 1)
        step = ex.step
      } else {
        resolved = 'greet'
        ex.mode = 'greet'
        ex.step = Math.min(3, ex.step + 1)
        step = ex.step
      }

      const key = `${actorId}:${subjectId}:${resolved}:${step}:${seed}`
      let bark: LocalBark

      if (resolved === 'intimidate') {
        bark = {
          text: pickDet(BARK_LINES.intercept, key),
          tone,
          mood: 'alarmed',
          moodDelta: -3,
          trustDelta: -4,
          escalateToMind: true,
          outcome: 'flee',
          step: 2,
          ms: 0,
        }
      } else if (resolved === 'defuse') {
        bark = {
          text: pickDet(BARK_LINES.defuse[tone], key),
          tone,
          mood: 'calm',
          moodDelta: 2,
          trustDelta: 1,
          escalateToMind: false,
          outcome: 'defused',
          step: 1,
          ms: 0,
        }
      } else if (resolved === 'antagonize') {
        if (step === 1) {
          bark = {
            text: pickDet(BARK_LINES.antagonize_1[tone], key),
            tone,
            mood: 'annoyed',
            moodDelta: -2,
            trustDelta: -2,
            escalateToMind: false,
            outcome: 'warn',
            step: 1,
            ms: 0,
          }
        } else if (step === 2) {
          bark = {
            text: pickDet(BARK_LINES.antagonize_2[tone], key),
            tone,
            mood: 'angry',
            moodDelta: -3,
            trustDelta: -3,
            escalateToMind: true,
            outcome: 'defensive',
            step: 2,
            ms: 0,
          }
        } else {
          const outcome = (tone === 'defensive' || courage >= 0.72)
            ? 'confront'
            : (tone === 'aloof' || tone === 'hurried' || courage >= 0.4)
              ? 'report'
              : 'flee'
          bark = {
            text: pickDet(BARK_LINES.antagonize_3[outcome], key),
            tone,
            mood: outcome === 'flee' ? 'alarmed' : 'angry',
            moodDelta: -4,
            trustDelta: -4,
            escalateToMind: true,
            outcome,
            step: 3,
            ms: 0,
          }
        }
      } else {
        const weatherNote = WEATHER_TAGS[weather]?.[tone] ?? ''
        if (step === 1) {
          const base = pickDet(BARK_LINES.greet_1[tone], key)
          const spoken = weatherNote && base.length + weatherNote.length + 1 <= 195 ? `${base} ${weatherNote}` : base
          const warmStart = ex.trust >= 4
          bark = {
            text: warmStart ? `${spoken} Good to see you again.` : spoken,
            tone,
            mood: warmStart ? 'warm' : 'calm',
            moodDelta: 1,
            trustDelta: 1,
            escalateToMind: false,
            outcome: 'chat',
            step: 1,
            ms: 0,
          }
        } else if (step === 2) {
          bark = {
            text: pickDet(BARK_LINES.greet_2[tone], key),
            tone,
            mood: 'warm',
            moodDelta: 1,
            trustDelta: 2,
            escalateToMind: false,
            outcome: 'warm',
            step: 2,
            ms: 0,
          }
        } else {
          bark = {
            text: pickDet(BARK_LINES.greet_3[tone], key),
            tone,
            mood: 'warm',
            moodDelta: 1,
            trustDelta: 1,
            escalateToMind: true,
            outcome: 'converse',
            step: 3,
            ms: 0,
          }
        }
      }

      ex.trust = Math.max(-10, Math.min(10, ex.trust + bark.trustDelta))
      ex.lastAt = now
      exchanges.set(pairKey, ex)
      return { bark, trust: ex.trust, state: { ...ex } }
    },

    stateOf(actorId: string, subjectId = 'player', now?: number): LocalExchangeState {
      const ex = exchanges.get(`${actorId}|${subjectId}`)
      if (!ex) return { mode: 'neutral', step: 0, trust: 0, lastAt: 0 }
      if (now !== undefined && now - ex.lastAt > escalationWindow) {
        return { mode: 'neutral', step: 0, trust: ex.trust, lastAt: ex.lastAt }
      }
      return { ...ex }
    },

    clear(): void {
      exchanges.clear()
    },
  }
}

// ── Target Acquisition & Forward Cone Selection ──────────────────────────────

/**
 * Picks the best facing NPC/resident within `rangeCells` (default 60 = 6 m) and forward `coneDeg`
 * (default 70°). Prefers active reporting witnesses and candidates closest to the player's gaze.
 */
export function selectSocialTarget(
  observer: SocialObserver,
  candidates: readonly SocialCandidate[],
  opts: {
    rangeCells?: number
    coneDeg?: number
    maxDyCells?: number
    witnessIds?: ReadonlySet<string>
  } = {},
): SocialTarget | null {
  const range = opts.rangeCells ?? SOCIAL_RANGE_CELLS
  const cosHalf = opts.coneDeg !== undefined
    ? Math.cos(((opts.coneDeg * 0.5) * Math.PI) / 180)
    : COS_HALF_CONE
  const maxDy = opts.maxDyCells ?? SOCIAL_MAX_DY_CELLS
  const witnessIds = opts.witnessIds

  let fx = 0
  let fz = -1
  if (observer.forward) {
    const hl = Math.hypot(observer.forward[0], observer.forward[2])
    if (hl > 1e-4) {
      fx = observer.forward[0] / hl
      fz = observer.forward[2] / hl
    } else if (Number.isFinite(observer.yaw)) {
      fx = Math.sin(observer.yaw!)
      fz = -Math.cos(observer.yaw!)
    }
  } else if (Number.isFinite(observer.yaw)) {
    fx = Math.sin(observer.yaw!)
    fz = -Math.cos(observer.yaw!)
  }

  let best: SocialTarget | null = null
  let bestScore = Infinity

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    const dx = c.at[0] - observer.at[0]
    const dy = Math.abs(c.at[1] - observer.at[1])
    const dz = c.at[2] - observer.at[2]
    if (dy > maxDy) continue
    const dist = Math.hypot(dx, dz)
    if (dist > range || dist < 0.5) continue
    const cosAngle = (dx * fx + dz * fz) / dist
    if (cosAngle < cosHalf) continue
    const isWitness = witnessIds ? witnessIds.has(c.id) : false
    const score = dist * (1.25 - 0.25 * cosAngle) - (isWitness ? 8 : 0)
    if (score < bestScore) {
      bestScore = score
      const clampedCos = Math.max(-1, Math.min(1, cosAngle))
      best = {
        candidate: c,
        distanceCells: dist,
        distanceM: Number((dist / 10).toFixed(2)),
        angleDeg: Number(((Math.acos(clampedCos) * 180) / Math.PI).toFixed(1)),
        isWitness,
      }
    }
  }

  return best
}

// ── Scoped Auto-Hiding HUD Styles (game-hud/SKILL.md compliant) ──────────────

const STYLE_ID = 'vw-social-style'
const STYLE_CSS = /* css */ `
[data-panel="social"] {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 7;
  font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}
html:is(.first, .driving, .riding, .choosing, .drawer, .map-open) [data-panel="social"],
html:has(#ask.open, #realm.open, #radio-picker[open]) [data-panel="social"] {
  display: none !important;
}
[data-panel="social"] [hidden] {
  display: none !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* Top-center living-city Heat / Witness alert pill (auto-hidden completely when calm). */
.vw-city-status {
  position: absolute;
  left: 50%;
  top: max(18px, calc(env(safe-area-inset-top, 0px) + 12px));
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(16, 21, 30, 0.84);
  border: 1.5px solid rgba(255, 168, 64, 0.48);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.34);
  color: #f4f7fb;
  font: 600 12px/1.2 inherit;
  letter-spacing: 0.02em;
  pointer-events: none;
  white-space: nowrap;
  max-width: calc(100vw - 120px);
  overflow: hidden;
  transition: opacity 0.2s ease-out;
}
.vw-city-heat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255, 86, 64, 0.22);
  border: 1px solid rgba(255, 110, 88, 0.55);
  color: #ff9c8e;
  font: 700 11px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.05em;
}
.vw-city-heat[data-level="4"],
.vw-city-heat[data-level="5"] {
  background: rgba(235, 52, 46, 0.34);
  border-color: rgba(255, 96, 84, 0.8);
  color: #ffd0ca;
}
.vw-city-witness {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #ffd57a;
  font: 600 12px/1.1 inherit;
}
.vw-city-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ffaa2b;
  box-shadow: 0 0 8px rgba(255, 170, 43, 0.85);
  flex: none;
}

/* Instant 0 ms speech feedback pill (auto-fades & hides at rest). */
.vw-social-bark {
  position: absolute;
  left: 50%;
  bottom: calc(max(80px, env(safe-area-inset-bottom, 0px) + 74px));
  transform: translateX(-50%);
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  max-width: min(440px, calc(100vw - 40px));
  padding: 7px 13px;
  border-radius: 10px;
  background: rgba(14, 19, 28, 0.88);
  border: 1px solid rgba(124, 148, 184, 0.38);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.34);
  color: #eef3fa;
  font: 500 13px/1.35 inherit;
  pointer-events: none;
  transition: opacity 0.2s ease-out;
}
.vw-social-bark-who {
  font-weight: 700;
  color: #9ec5ff;
  white-space: nowrap;
  flex: none;
}
.vw-social-bark[data-mood="angry"] .vw-social-bark-who,
.vw-social-bark[data-mood="alarmed"] .vw-social-bark-who {
  color: #ff9c8e;
}
.vw-social-bark-text {
  overflow-wrap: anywhere;
}

/* Contextual RDR2-style prompt pill (only visible when facing an NPC within 6 m). */
.vw-social-prompt {
  position: absolute;
  left: 50%;
  bottom: max(22px, calc(env(safe-area-inset-bottom, 0px) + 16px));
  transform: translate(calc(-50% + var(--soc-dx, 0px)), var(--soc-dy, 0px));
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px 5px 11px;
  border-radius: 999px;
  background: rgba(16, 22, 32, 0.84);
  border: 1.5px solid rgba(108, 134, 174, 0.44);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  color: #f0f4fa;
  pointer-events: auto;
  white-space: nowrap;
  max-width: calc(100vw - 24px);
  transition: opacity 0.18s ease-out;
}
.vw-social-prompt[data-witness="true"] {
  border-color: rgba(255, 170, 48, 0.72);
}
.vw-social-who {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding-right: 6px;
  margin-right: 2px;
  border-right: 1px solid rgba(255, 255, 255, 0.14);
  font: 700 12px/1.1 inherit;
  color: #dbe6f5;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vw-social-prompt[data-witness="true"] .vw-social-who {
  color: #ffd57a;
}
.vw-social-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  border-radius: 999px;
  padding: 5px 10px 5px 7px;
  background: rgba(232, 238, 248, 0.1);
  color: #f0f4fa;
  font: 600 12px/1 inherit;
  cursor: pointer;
  touch-action: manipulation;
  transition: background 0.12s ease-out;
}
.vw-social-btn:hover {
  background: rgba(232, 238, 248, 0.2);
}
.vw-social-btn[data-act="antagonize"] {
  background: rgba(235, 82, 66, 0.18);
  color: #ffc2ba;
}
.vw-social-btn[data-act="antagonize"]:hover {
  background: rgba(235, 82, 66, 0.3);
}
.vw-social-btn[data-act="intercept"] {
  background: rgba(255, 168, 42, 0.24);
  color: #ffe09e;
}
.vw-social-btn[data-act="talk"] {
  background: rgba(58, 122, 255, 0.28);
  color: #dcebff;
}
.vw-social-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.2);
  font: 700 10.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #ffffff;
}

@media (pointer: coarse) {
  .vw-social-prompt {
    bottom: auto;
    top: max(66px, calc(env(safe-area-inset-top, 0px) + 58px));
    padding: 4px 6px 4px 10px;
    gap: 5px;
  }
  .vw-social-btn {
    min-height: 44px;
    padding: 0 12px;
    font-size: 13px;
  }
  .vw-social-kbd {
    display: none;
  }
  .vw-social-bark {
    bottom: auto;
    top: max(122px, calc(env(safe-area-inset-top, 0px) + 114px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .vw-city-status,
  .vw-social-bark,
  .vw-social-prompt,
  .vw-social-btn {
    transition: none !important;
  }
}
`

function ensureStyle(doc: Document): void {
  if (!doc.head || doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE_CSS
  doc.head.append(style)
}

function rectsMeet(a: HudBox, b: HudBox, pad = 6): boolean {
  return a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad
}

/**
 * Creates the self-contained client-side social interaction & living-city HUD controller.
 */
export function createSocial(opts: SocialOptions): SocialController {
  const clock = opts.now ?? (() => Date.now())
  const pollMs = opts.pollMs ?? SOCIAL_POLL_MS
  const barks = createLocalBarks()

  // Local pedestrian observation cache (populated during folk.draw via observeLocal).
  const localCandidates = new Map<string, { candidate: SocialCandidate; seenAt: number }>()
  const localSpeech = new Map<number, { text: string; until: number }>()
  // Tracks actors that were recently antagonized (remote or local) so `[F] Defuse` appears cleanly.
  const antagonized = new Map<string, number>()
  // Tracks actors that have reached `escalateToMind` so `[↵] Talk` surfaces cleanly.
  const escalated = new Map<string, number>()

  let status: CityStatus = {
    heat: 0,
    witnesses: [],
    dominantMood: 'calm',
    panicRatio: 0,
    updatedAt: 0,
  }
  let witnessSet = new Set<string>()
  let target: SocialTarget | null = null
  let lastResult: SocialResult | null = null
  let barkVisibleUntil = 0
  let barkSpeaker = ''
  let barkText = ''
  let barkMood = 'calm'
  let promptVisible = false
  let statusVisible = false
  let destroyed = false
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let pollInFlight: Promise<CityStatus | null> | null = null
  let seedCounter = 0

  // ── Mount minimal auto-hiding DOM overlay ──
  const root: HTMLElement | null = opts.mount ?? opts.hud?.panel('social') ?? null
  const doc = root?.ownerDocument ?? (typeof document !== 'undefined' ? document : null)
  if (doc && root) ensureStyle(doc)

  let statusEl: HTMLElement | null = null
  let heatBadge: HTMLElement | null = null
  let witnessBadge: HTMLElement | null = null
  let witnessTextEl: HTMLElement | null = null

  let barkEl: HTMLElement | null = null
  let barkWhoEl: HTMLElement | null = null
  let barkTextEl: HTMLElement | null = null

  let promptEl: HTMLElement | null = null
  let whoEl: HTMLElement | null = null
  let greetBtn: HTMLButtonElement | null = null
  let antagonizeBtn: HTMLButtonElement | null = null
  let secondaryBtn: HTMLButtonElement | null = null
  let secondaryLabelEl: HTMLElement | null = null
  let talkBtn: HTMLButtonElement | null = null

  const makeBtn = (
    d: Document,
    act: string,
    keyText: string,
    labelText: string,
    onClick: () => void,
  ): { btn: HTMLButtonElement; label: HTMLElement } => {
    const btn = d.createElement('button')
    btn.type = 'button'
    btn.className = 'vw-social-btn'
    btn.dataset.act = act
    const kbd = d.createElement('kbd')
    kbd.className = 'vw-social-kbd'
    kbd.textContent = keyText
    const label = d.createElement('span')
    label.textContent = labelText
    btn.append(kbd, label)
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick()
      btn.blur?.()
    })
    return { btn, label }
  }

  if (doc && root) {
    // 1. Living-city Heat / Witness alert pill
    statusEl = doc.createElement('div')
    statusEl.className = 'vw-city-status'
    statusEl.setAttribute('role', 'status')
    statusEl.setAttribute('aria-live', 'polite')
    statusEl.hidden = true

    heatBadge = doc.createElement('span')
    heatBadge.className = 'vw-city-heat'
    heatBadge.hidden = true

    witnessBadge = doc.createElement('span')
    witnessBadge.className = 'vw-city-witness'
    witnessBadge.hidden = true
    const dot = doc.createElement('span')
    dot.className = 'vw-city-dot'
    dot.setAttribute('aria-hidden', 'true')
    witnessTextEl = doc.createElement('span')
    witnessBadge.append(dot, witnessTextEl)

    statusEl.append(heatBadge, witnessBadge)

    // 2. Instant 0 ms speech feedback pill
    barkEl = doc.createElement('div')
    barkEl.className = 'vw-social-bark'
    barkEl.setAttribute('role', 'status')
    barkEl.setAttribute('aria-live', 'polite')
    barkEl.hidden = true
    barkWhoEl = doc.createElement('span')
    barkWhoEl.className = 'vw-social-bark-who'
    barkTextEl = doc.createElement('span')
    barkTextEl.className = 'vw-social-bark-text'
    barkEl.append(barkWhoEl, barkTextEl)

    // 3. Contextual RDR2-style prompt pill
    promptEl = doc.createElement('div')
    promptEl.className = 'vw-social-prompt'
    promptEl.setAttribute('role', 'group')
    promptEl.setAttribute('aria-label', 'Social actions')
    promptEl.hidden = true

    whoEl = doc.createElement('span')
    whoEl.className = 'vw-social-who'

    const g = makeBtn(doc, 'greet', 'G', 'Greet', () => void self.act('greet'))
    greetBtn = g.btn
    const h = makeBtn(doc, 'antagonize', 'H', 'Antagonize', () => void self.act('antagonize'))
    antagonizeBtn = h.btn
    const f = makeBtn(doc, 'defuse', 'F', 'Defuse', () => {
      const cur = target
      if (!cur) return
      void self.act(cur.isWitness ? 'intimidate' : 'defuse', cur)
    })
    secondaryBtn = f.btn
    secondaryLabelEl = f.label
    secondaryBtn.hidden = true

    const t = makeBtn(doc, 'talk', '\u21b5', 'Talk', () => {
      if (!target) return
      if (opts.openTalk) opts.openTalk(target, lastResult)
      else if (lastResult) opts.onEscalateToMind?.(target, lastResult)
    })
    talkBtn = t.btn
    talkBtn.hidden = true

    promptEl.append(whoEl, greetBtn, antagonizeBtn, secondaryBtn, talkBtn)
    root.append(statusEl, barkEl, promptEl)
  }

  const isDisabled = (): boolean => {
    if (destroyed) return true
    if (opts.disabled?.()) return true
    if (typeof document !== 'undefined') {
      const ae = document.activeElement
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || (ae as HTMLElement).isContentEditable)) {
        return true
      }
    }
    return false
  }

  const canDefuseActor = (actorId: string, nowSec: number): boolean => {
    const until = antagonized.get(actorId)
    if (until !== undefined && nowSec <= until) return true
    const ex = barks.stateOf(actorId, opts.world?.me ?? 'player', nowSec)
    return ex.mode === 'antagonize' && ex.step > 0
  }

  const isEscalatedActor = (actorId: string, nowSec: number): boolean => {
    const until = escalated.get(actorId)
    return until !== undefined && nowSec <= until
  }

  const applyAvoidance = (): void => {
    if (!promptEl || promptEl.hidden) return
    promptEl.style.setProperty('--soc-dx', '0px')
    promptEl.style.setProperty('--soc-dy', '0px')
    const bodies = opts.avoidBoxes?.()
    if (!bodies?.length) return
    const r = promptEl.getBoundingClientRect?.()
    if (!r || r.width <= 0 || r.height <= 0) return
    const box: HudBox = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    if (!bodies.some((b) => rectsMeet(box, b, 8))) return

    const vw = typeof innerWidth === 'number' && innerWidth > 0 ? innerWidth : 1280
    const vh = typeof innerHeight === 'number' && innerHeight > 0 ? innerHeight : 720
    const rightBody = Math.max(...bodies.map((b) => b.right))
    const leftBody = Math.min(...bodies.map((b) => b.left))
    const topBody = Math.min(...bodies.map((b) => b.top))

    // Try shifting right of body, left of body, or above body within viewport bounds.
    const shifts: [number, number][] = [
      [Math.ceil(rightBody + 14 - box.left), 0],
      [Math.floor(leftBody - 14 - box.right), 0],
      [0, Math.floor(topBody - 14 - box.bottom)],
    ]
    for (const [dx, dy] of shifts) {
      const moved: HudBox = {
        left: box.left + dx,
        right: box.right + dx,
        top: box.top + dy,
        bottom: box.bottom + dy,
      }
      if (moved.left < 10 || moved.right > vw - 10 || moved.top < 10 || moved.bottom > vh - 10) continue
      if (!bodies.some((b) => rectsMeet(moved, b, 6))) {
        promptEl.style.setProperty('--soc-dx', `${dx}px`)
        promptEl.style.setProperty('--soc-dy', `${dy}px`)
        return
      }
    }
  }

  const renderDom = (nowMs: number): void => {
    const off = isDisabled()
    const nowSec = nowMs / 1000

    // 1. Living-city Heat & Witness status pill (strictly hidden when calm or disabled)
    const hasHeat = status.heat > 0
    const hasWitness = status.witnesses.length > 0
    statusVisible = !off && (hasHeat || hasWitness)
    if (statusEl) {
      statusEl.hidden = !statusVisible
      if (statusVisible) {
        if (heatBadge) {
          heatBadge.hidden = !hasHeat
          if (hasHeat) {
            heatBadge.dataset.level = String(Math.min(5, Math.max(1, Math.round(status.heat))))
            heatBadge.textContent = `HEAT ${Math.round(status.heat)}/5`
          }
        }
        if (witnessBadge && witnessTextEl) {
          witnessBadge.hidden = !hasWitness
          if (hasWitness) {
            const count = status.witnesses.length
            witnessTextEl.textContent = count > 1
              ? `${count} witnesses reporting… [F]`
              : 'Witness reporting… [F]'
          }
        }
      }
    }

    // 2. Instant speech feedback pill
    const showBark = !off && barkText.length > 0 && nowMs < barkVisibleUntil
    if (barkEl) {
      barkEl.hidden = !showBark
      if (showBark) {
        barkEl.dataset.mood = barkMood
        if (barkWhoEl) barkWhoEl.textContent = barkSpeaker
        if (barkTextEl) barkTextEl.textContent = barkText
      }
    }

    // 3. Contextual RDR2-style prompt pill (strictly hidden when no target or disabled)
    const cur = off ? null : target
    promptVisible = cur !== null
    if (promptEl) {
      promptEl.hidden = !promptVisible
      if (cur) {
        promptEl.dataset.witness = cur.isWitness ? 'true' : 'false'
        if (whoEl) whoEl.textContent = cur.candidate.name
        const showDefuse = canDefuseActor(cur.candidate.id, nowSec)
        const showSecondary = cur.isWitness || showDefuse
        if (secondaryBtn && secondaryLabelEl) {
          secondaryBtn.hidden = !showSecondary
          if (showSecondary) {
            secondaryBtn.dataset.act = cur.isWitness ? 'intercept' : 'defuse'
            secondaryLabelEl.textContent = cur.isWitness ? 'Intercept' : 'Defuse'
          }
        }
        if (talkBtn) {
          const canTalk = opts.canTalk ? opts.canTalk() : Boolean(opts.openTalk || opts.onEscalateToMind)
          talkBtn.hidden = !(canTalk && isEscalatedActor(cur.candidate.id, nowSec))
        }
        applyAvoidance()
      }
    }
  }

  const showBarkLine = (who: string, text: string, mood: string, seed: number | undefined, nowMs: number): void => {
    const clean = text.trim()
    if (!clean) return
    const duration = Math.max(3800, Math.min(8500, clean.length * 65))
    barkSpeaker = who
    barkText = clean
    barkMood = mood || 'calm'
    barkVisibleUntil = nowMs + duration
    if (seed !== undefined) {
      localSpeech.set(seed, { text: clean, until: nowMs + duration })
    }
  }

  const collectCandidates = (nowMs: number): SocialCandidate[] => {
    const merged: SocialCandidate[] = []
    const seen = new Set<string>()
    const remote = opts.candidates?.() ?? []
    for (let i = 0; i < remote.length; i++) {
      const c = remote[i]
      if (!c || seen.has(c.id)) continue
      seen.add(c.id)
      merged.push(c)
    }
    for (const [id, entry] of localCandidates) {
      if (nowMs - entry.seenAt > 600) {
        localCandidates.delete(id)
        continue
      }
      if (seen.has(id)) continue
      seen.add(id)
      merged.push(entry.candidate)
    }
    return merged
  }

  // Push a non-solid mode on `input` so G/H/F only trigger when a target is actively locked.
  const popInput = opts.input?.push({
    name: 'social',
    key(code, e) {
      if (e?.repeat || isDisabled() || !target) return false
      if (opts.suppressKey?.(code)) return false
      if (code === SOCIAL_KEYS.greet) {
        void self.act('greet')
        return true
      }
      if (code === SOCIAL_KEYS.antagonize) {
        void self.act('antagonize')
        return true
      }
      if (code === SOCIAL_KEYS.defuse) {
        const nowSec = clock() / 1000
        if (target.isWitness) {
          void self.act('intimidate')
          return true
        }
        if (canDefuseActor(target.candidate.id, nowSec)) {
          void self.act('defuse')
          return true
        }
      }
      return false
    },
  }) ?? null

  const applyCitySnapshot = (raw: Record<string, unknown>, nowMs: number): CityStatus => {
    const heat = Number.isFinite(raw.heat) ? Math.max(0, Number(raw.heat)) : 0
    const witnesses = Array.isArray(raw.witnesses)
      ? (raw.witnesses as WitnessInfo[]).filter((w) => w && typeof w.witnessId === 'string')
      : []
    const moodObj = (raw.mood && typeof raw.mood === 'object' ? raw.mood : {}) as Record<string, unknown>
    status = {
      heat,
      witnesses,
      dominantMood: typeof moodObj.dominant === 'string' ? moodObj.dominant : 'calm',
      panicRatio: Number.isFinite(moodObj.panicRatio) ? Number(moodObj.panicRatio) : 0,
      updatedAt: nowMs,
    }
    witnessSet = new Set(witnesses.map((w) => w.witnessId))
    return status
  }

  const self: SocialController = {
    get target() { return target },
    get status() { return status },
    get lastResult() { return lastResult },
    get promptVisible() { return promptVisible },
    get statusVisible() { return statusVisible },
    get root() { return root },

    setCityStatus(next) {
      const nowMs = clock()
      status = {
        heat: next.heat ?? status.heat,
        witnesses: next.witnesses ?? status.witnesses,
        dominantMood: next.dominantMood ?? status.dominantMood,
        panicRatio: next.panicRatio ?? status.panicRatio,
        updatedAt: next.updatedAt ?? nowMs,
      }
      witnessSet = new Set(status.witnesses.map((w) => w.witnessId))
      renderDom(nowMs)
    },

    observeLocal(list) {
      const nowMs = clock()
      const obs = opts.observer()
      if (obs) {
        // Refresh nearby local pedestrians within 90 cells (9 m) for target-lock scanning.
        const distLabel = opts.district?.() ?? ''
        for (let i = 0; i < list.length; i++) {
          const p = list[i]
          const dx = p.at[0] - obs.at[0]
          const dz = p.at[2] - obs.at[2]
          if (dx * dx + dz * dz > 90 * 90) continue
          // Guard against observing the player's own figure at the exact observer origin.
          if (dx * dx + dz * dz < 4) continue
          const id = `local:${p.seed}`
          localCandidates.set(id, {
            seenAt: nowMs,
            candidate: {
              id,
              name: p.name?.trim() || 'Resident',
              at: p.at,
              remote: false,
              seed: p.seed,
              district: distLabel,
            },
          })
        }
      }
      // Inject active 0 ms speech pills directly onto local Person figures for 3D overhead rendering.
      if (localSpeech.size > 0) {
        for (let i = 0; i < list.length; i++) {
          const p = list[i]
          const line = localSpeech.get(p.seed)
          if (!line) continue
          if (nowMs >= line.until) {
            localSpeech.delete(p.seed)
            continue
          }
          if (!p.says) (p as { says?: string }).says = line.text
        }
      }
    },

    speechFor(seed, nowMs = clock()) {
      const line = localSpeech.get(seed)
      if (!line) return ''
      if (nowMs >= line.until) {
        localSpeech.delete(seed)
        return ''
      }
      return line.text
    },

    frame(nowMs = clock()) {
      if (destroyed) return
      if (isDisabled()) {
        target = null
        renderDom(nowMs)
        return
      }
      const obs = opts.observer()
      target = obs
        ? selectSocialTarget(obs, collectCandidates(nowMs), { witnessIds: witnessSet })
        : null
      renderDom(nowMs)
    },

    pollCity() {
      if (destroyed || !opts.world) return Promise.resolve(null)
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return Promise.resolve(null)
      if (pollInFlight) return pollInFlight
      pollInFlight = (async () => {
        try {
          const res = await opts.world!.fetch(`${opts.world!.base}/city`)
          if (!res.ok) return null
          const json = await res.json() as Record<string, unknown>
          const next = applyCitySnapshot(json, clock())
          // Re-evaluate target witness flag & render status pill immediately.
          if (target) {
            target = { ...target, isWitness: witnessSet.has(target.candidate.id) }
          }
          renderDom(clock())
          return next
        } catch {
          return null
        } finally {
          pollInFlight = null
        }
      })()
      return pollInFlight
    },

    async act(action, explicit) {
      if (destroyed) return null
      const locked = explicit ?? target
      if (!locked) return null
      const nowMs = clock()
      const nowSec = nowMs / 1000
      const c = locked.candidate
      const district = c.district || opts.district?.() || 'downtown'
      const weather = opts.weather?.() ?? 'clear'
      const seed = ++seedCounter

      // 1. Instant 0 ms local resolution (authoritative offline; instant preview online).
      const localRes = barks.interact({
        actorId: c.id,
        subjectId: opts.world?.me ?? 'player',
        action,
        district,
        weather,
        now: nowSec,
        seed,
      })

      if (action === 'antagonize') {
        antagonized.set(c.id, nowSec + ESCALATION_WINDOW_SEC)
      } else if (action === 'defuse' || action === 'apologize' || localRes.bark.outcome === 'defused') {
        antagonized.delete(c.id)
      }

      const localOutcome: SocialResult = {
        actorId: c.id,
        name: c.name,
        action,
        bark: localRes.bark,
        trust: localRes.trust,
        mood: localRes.bark.mood,
        intercepted: action === 'intimidate' && locked.isWitness,
        escalateToMind: localRes.bark.escalateToMind,
        remote: false,
      }

      showBarkLine(c.name, localRes.bark.text, localRes.bark.mood, c.seed, nowMs)
      if (localOutcome.escalateToMind) {
        escalated.set(c.id, nowSec + ESCALATION_WINDOW_SEC)
      }
      lastResult = localOutcome
      renderDom(nowMs)

      // 2. If offline or targeting a local SF pedestrian, we're done in 0 ms!
      if (!opts.world || !c.remote) {
        if (localOutcome.escalateToMind) {
          opts.onEscalateToMind?.(locked, localOutcome)
        }
        return localOutcome
      }

      // 3. Shared world: authoritative `POST /world/social` round-trip.
      try {
        const res = await opts.world.fetch(`${opts.world.base}/social`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            by: opts.world.me,
            actorId: c.id,
            action,
            seed,
            ...(district ? { district } : {}),
          }),
        })
        if (!res.ok) return localOutcome
        const data = await res.json() as {
          actorId?: string
          name?: string
          action?: SocialAction
          bark?: LocalBark
          trust?: number
          mood?: string
          intercepted?: boolean
          escalateToMind?: boolean
        }
        const authBark: LocalBark = data.bark ?? localRes.bark
        const authResult: SocialResult = {
          actorId: data.actorId ?? c.id,
          name: data.name ?? c.name,
          action: data.action ?? action,
          bark: authBark,
          trust: Number.isFinite(data.trust) ? Number(data.trust) : localRes.trust,
          mood: data.mood ?? authBark.mood,
          intercepted: data.intercepted === true,
          escalateToMind: data.escalateToMind === true,
          remote: true,
        }
        lastResult = authResult
        showBarkLine(authResult.name, authBark.text, authResult.mood, c.seed, clock())
        if (authResult.intercepted) {
          witnessSet.delete(c.id)
          status = {
            ...status,
            witnesses: status.witnesses.filter((w) => w.witnessId !== c.id),
          }
          if (target && target.candidate.id === c.id) {
            target = { ...target, isWitness: false }
          }
        }
        if (authResult.escalateToMind) {
          escalated.set(c.id, clock() / 1000 + ESCALATION_WINDOW_SEC)
          opts.onEscalateToMind?.(locked, authResult)
        }
        renderDom(clock())
        // Refresh live city telemetry after witness interception or high-tension escalation.
        if (authResult.intercepted || authResult.escalateToMind) {
          void self.pollCity()
        }
        return authResult
      } catch {
        return localOutcome
      }
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      if (pollTimer !== null) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      popInput?.()
      statusEl?.remove()
      barkEl?.remove()
      promptEl?.remove()
      localCandidates.clear()
      localSpeech.clear()
      antagonized.clear()
      escalated.clear()
      target = null
      promptVisible = false
      statusVisible = false
    },
  }

  // Start lightweight `/world/city` polling ONLY on shared worlds.
  if (opts.world && pollMs > 0) {
    pollTimer = setInterval(() => {
      if (!isDisabled()) void self.pollCity()
    }, pollMs)
    if (typeof pollTimer === 'object' && pollTimer && 'unref' in pollTimer) {
      ;(pollTimer as { unref(): void }).unref()
    }
  }

  return self
}
