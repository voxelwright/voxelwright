// A realm this page runs alone (#450): no page server, no world's process. Its record is in the page itself, a
// `<script type="application/json" id="realm">` that the static folder's build writes (sf/build.mjs, from
// sf/realm.json), so that a host of plain files serves it and nothing is asked for before the page knows where it is.
// A realm the server keeps (realms.ts, link.ts) says the same things of itself: a name, where one arrives, how it
// looks. A local realm adds which world it is (`world`) and what its visitors may do (`rules`).
//
// The rules are the realm's, not the address's: nothing in the query string turns them back on.
import type { Realm } from './link.ts'
import type { SignsFile } from './boards.ts'

export interface Rules {
  /**
   * Whether anything here may ask a model: making from words or pictures, a thing made drivable, rules and realms
   * written, people who answer by thinking, spells by prompt, the workshop's sessions. Off, the page never learns of a
   * helper (ask.ts) and shows no bar to type a wish on. Stage 2 of #450 turns it on for the realm's admin.
   */
  models: boolean
}

export interface Local extends Realm {
  id: string
  /** Which world it is: `bay` as `?bay=` says it (bay.ts). */
  world?: { bay?: string }
  rules: Rules
  /** Living things from a kept library, set down where the realm begins: each an address beside the page (sf/kept.mjs writes them). */
  kept?: { file: string; at: [number, number, number]; yaw?: number; /** Set down at the kerb of a street near `at`, not at it (main.ts `kerbside`). */ kerb?: boolean }[]
  /** Where the world's tiles come from: a release pointer beside the page (sf/release.md), read once a page load. */
  release?: string
  /** The eye's angle from top to bottom, degrees, where the address does not say. */
  fov?: number
  /** How far the picture is turned about the look, degrees clockwise: a photograph's camera has it (#423). */
  roll?: number
  /** The far model (far.ts): the folder beside the page its far.json is in. */
  far?: string
  /**
   * The realm's air (#450, march.ts `Air`): haze and cloud against the town's own, its sky by day, and the sun and
   * grade of the afternoon it is seen in until the hour is set. The SF realm's is the landing photograph's (#423).
   */
  air?: { haze?: number; clouds?: number; sky?: { zenith: [number, number, number]; horizon: [number, number, number] }; sun?: [number, number, number]; grade?: [number, number] }
  /** Its billboards and the banner its plane tows (boards.ts): sf/boards.json, put here by the build. */
  signs?: SignsFile
  /** Street life (street.ts): where its graphs of each square (`life/index.json`) and its kept vehicles (`cars/index.json`) are, beside the page. Its people take the place of the town's residents. */
  street?: { life: string; cars: string }
}

/** Rules where a page is in no local realm: as the engine's page always was. */
const OPEN: Rules = { models: true }

function read(): Local | null {
  // A worker has no page: it is told what it needs in its own address (bay.ts `BAY`).
  const tag = typeof document === 'undefined' ? null : document.getElementById('realm')
  if (!tag?.textContent) return null
  const realm = JSON.parse(tag.textContent) as Local
  // Rules left unsaid are off: a realm turns on what it allows.
  realm.rules = { models: realm.rules?.models === true }
  return realm
}

/** The realm this page runs alone, or null where it is the engine's own page or a view of a world the server keeps. */
export const LOCAL: Local | null = read()
/** What this page may do: the local realm's rules, or everything. */
export const RULES: Rules = LOCAL?.rules ?? OPEN
