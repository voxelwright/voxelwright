// The page's side of the villager API (host/src/villager.ts), reached through
// the dev server, which forwards /villager/api/* to the host on 127.0.0.1.
//
// The token comes from the link the host prints (http://localhost:5181/#token=…).
// A fragment never reaches a server; the page keeps the token for this tab in
// sessionStorage and takes it out of the address bar.

/**
 * away: the host was not reached, so the line can be sent again. cut: the reply broke off or stalled after the host had the line.
 * link: there is no token, or the host answered 401 (a link from an earlier launch): open the latest link; resending won't help.
 * refused: the host answered 403, this tab's token is for someone other than the page's person (#40), so nothing was sent.
 * other: the line was written under a different link than this tab holds now, so it was not sent (see `tag`).
 * route: the reply named a route the host refused.
 */
export type Said = { ok: true; reply: string; routed?: Routed } | { ok: false; why: 'away' | 'busy' | 'failed' | 'cut' | 'route' | 'refused' | 'link' | 'other' }
/** The page's own person: synthetic until family isolation is proven (AGENTS.md). Any other villager is a visit (#42). */
export const ME = 'alex'
/** Your own villager's path, or your visit to another person's villager, kept under you (#42). */
const talkPath = (person: string) => (person === ME ? `/people/${ME}` : `/people/${ME}/visits/${person}`)
/** A reply that sends nothing for this long is abandoned. */
const IDLE_MS = 30_000
const TOKEN_KEY = 'village.villager.token'
export interface Line { from: 'person' | 'villager'; text?: string; unanswered?: boolean }

let token: string | null = null
try {
  token = sessionStorage.getItem(TOKEN_KEY)
} catch {}
/** Fired on window when a link installs a different token in this tab. */
export const TOKEN_EVENT = 'village:token'
/** Takes a token from the address bar's #token=…, keeps it for this tab and clears it from the bar. */
function adoptLink() {
  const linked = new URLSearchParams(location.hash.slice(1)).get('token')
  if (!linked) return
  const changed = linked !== token
  token = linked
  try {
    sessionStorage.setItem(TOKEN_KEY, linked)
  } catch {}
  history.replaceState(history.state, '', location.pathname + location.search)
  if (changed) dispatchEvent(new Event(TOKEN_EVENT))
}

/**
 * A short fingerprint of a token (the first 12 hex digits of its SHA-256), so a kept line can say which link it was
 * written under without storing the token. Null with no token. One promise per token, so callers resolve in order.
 */
let tagged: { token: string; tag: Promise<string> } | null = null
async function fingerprint(t: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))
  return [...digest.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
export function tokenTag(): Promise<string | null> {
  const t = token
  if (!t) return Promise.resolve(null)
  if (tagged?.token !== t) tagged = { token: t, tag: fingerprint(t) }
  return tagged.tag
}
adoptLink()
// A new link opened in the same tab (after the host restarts) changes only the fragment.
addEventListener('hashchange', adoptLink)

/**
 * Null when the host is unreachable. 'link' when there is no token or the host answered 401 (the token is from an
 * earlier launch: open the new link). `as` sends that token instead of the tab's current one. With `hostErrors`, a 5xx
 * the host itself answered (JSON; the dev server's proxy answers plain text when the host is down) is returned, so the
 * caller can say it failed, not that the host is away (#47).
 */
export async function authorized(path: string, init: RequestInit = {}, as: string | null = token, hostErrors = false): Promise<Response | null | 'link'> {
  if (!as) return 'link'
  const res = await fetch(`/villager/api${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${as}` } }).catch(() => null)
  if (!res || (res.status >= 500 && !(hostErrors && res.headers.get('content-type')?.startsWith('application/json')))) return null
  if (res.status === 401) return 'link'
  return res
}

/** The conversation with `person`'s villager: your own, or your visit's. Null when it could not be read. */
export async function conversation(person: string): Promise<Line[] | null> {
  const res = await authorized(`${talkPath(person)}/conversation`)
  return res && res !== 'link' && res.ok ? (await res.json()).lines : null
}

export interface Routing {
  /** Your own villager's name and the cast: the line may be routed in its reply (#42). */
  route: { primary: string; villagers: { id: string; name: string; role: string }[] }
  /** Called once, as soon as the host has read a route in the reply. */
  onRoute(routed: Routed): void
}

export interface SayOptions {
  /** Background the person did not say (the table's round so far): the villager hears it, the conversation never stores it. */
  context?: string
  /** With routing, one call either answers (text streams) or names a route (onRoute, no text). */
  routing?: Routing
  /** A drawing handed over (#42, sketch.ts), by reference: the drawer's id and the sketch's. */
  sketch?: { from: string; id: string }
  signal?: AbortSignal
  /** The fingerprint (tokenTag) of the link the line was written under: sent only under that link, else why 'other'. */
  tag?: string | null
}

/**
 * Send a line and stream the reply. Stops when signal aborts, or when the host
 * sends nothing for IDLE_MS, so a hung host never leaves the page waiting.
 */
export async function say(person: string, text: string, onText: (t: string) => void, { context, routing, sketch, signal, tag }: SayOptions = {}): Promise<Said> {
  // The token is read once: the one checked against the line's tag is the one it is sent with.
  const as = token
  if (tag !== undefined && (as ? await fingerprint(as) : null) !== tag) return { ok: false, why: 'other' }
  const stop = new AbortController()
  const abort = () => stop.abort()
  signal?.addEventListener('abort', abort)
  let idle = setTimeout(abort, IDLE_MS)
  let routed: Routed | undefined
  const onRoute = (r: Routed) => {
    if (routed) return
    routed = r
    routing?.onRoute(r)
  }
  try {
    const res = await authorized(`${talkPath(person)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...(context ? { context } : {}), ...(routing ? { route: routing.route } : {}), ...(sketch ? { sketch } : {}) }),
      signal: stop.signal,
    }, as)
    // Stopped before an answer began: the host may already have the line.
    if (!res) return { ok: false, why: stop.signal.aborted ? 'cut' : 'away' }
    if (res === 'link') return { ok: false, why: 'link' }
    if (res.status === 409) return { ok: false, why: 'busy' }
    if (res.status === 403) return { ok: false, why: 'refused' }
    if (!res.ok || !res.body) return { ok: false, why: 'failed' }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        clearTimeout(idle)
        idle = setTimeout(abort, IDLE_MS)
        buffer += value
        let cut
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          const name = /^event: (.*)$/m.exec(block)?.[1]
          const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null')
          if (name === 'text') onText(data.t)
          else if (name === 'route' && routing) onRoute(data.routed)
          else if (name === 'done') {
            if (data.routed && routing) onRoute(data.routed)
            return { ok: true, reply: data.reply, ...(routed ? { routed } : {}) }
          } else if (name === 'failed') return { ok: false, why: data?.reason === 'route' ? 'route' : 'failed' }
        }
      }
    } catch {
      return { ok: false, why: 'cut' }
    }
    // The stream ended without an answer: the host went away mid-reply.
    return { ok: false, why: 'cut' }
  } finally {
    clearTimeout(idle)
    signal?.removeEventListener('abort', abort)
  }
}

// ── The always-on input (#42 prototype) ─────────────────────────────────────
// Everything that comes back is model output the host checked or stored as text:
// the page treats it as data. Prop modules only ever run in the prop sandbox.

export interface Routed {
  route: 'talk' | 'answer' | 'furnish' | 'project' | 'journal' | 'theme' | 'build' | 'physics'
  to?: string
  say?: string
  message?: string
  what?: string
  where?: string
  count?: number
  size?: [number, number, number]
  /** furnish: how it is mounted, as the router proposed it; place.ts checks it. */
  mount?: string
  replace?: string
  copy?: boolean
  library?: string
  section?: 'talk' | 'tasks'
  /** build: a change to the house, as data (checked again by src/build/intent.ts). */
  intent?: unknown
  /** physics: the line asks to build a toy (#88). Picks the host's prompt and model only; every toy is checked here. */
  toy?: boolean
}
export type Outcome<T> = ({ ok: true; ms: number } & T) | { ok: false; why: 'away' | 'failed' | 'busy' | 'refused' | 'link'; ms: number }

export async function call<T>(path: string, body?: unknown): Promise<Outcome<T>> {
  const t0 = performance.now()
  const res = await authorized(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const ms = performance.now() - t0
  if (!res) return { ok: false, why: 'away', ms }
  if (res === 'link') return { ok: false, why: 'link', ms }
  if (res.status === 409) return { ok: false, why: 'busy', ms }
  if (res.status === 403) return { ok: false, why: 'refused', ms }
  if (!res.ok) return { ok: false, why: 'failed', ms }
  try {
    return { ok: true, ms, ...((await res.json()) as T) }
  } catch {
    return { ok: false, why: 'failed', ms }
  }
}

/** Your own villager decides what a line meant. */
export const route = (person: string, text: string, primary: string, villagers: { id: string; name: string; role: string }[]) =>
  call<{ routed: Routed; models: string[]; costUsd: number | null }>(`/people/${person}/route`, { text, primary, villagers })

/** A prop made by the model, as module text for the sandbox, and its library id. */
export const makeProp = (person: string, what: string, size?: number[], variant = 0) =>
  call<{ item: string; name: string; module: string; costUsd: number | null }>(`/people/${person}/props`, { what, ...(size ? { size } : {}), variant })

export const libraryItem = (person: string, item: string) => call<{ id: string; name: string; module: string; size?: number[] }>(`/people/${person}/library/${item}`)
export const keepItem = (person: string, item: string) => call<{ ok: true }>(`/people/${person}/library/${item}/keep`, {})
export const library = (person: string) => call<{ items: { id: string; name: string }[] }>(`/people/${person}/library`)
export const startProject = (person: string, what: string, where: string | undefined, text: string) =>
  call<{ project: { id: string; what: string; state: string } }>(`/people/${person}/projects`, { what, where, text })
export const projects = (person: string) => call<{ projects: { id: string; what: string; where?: string; state: string }[] }>(`/people/${person}/projects`)

// ── #47 villager setup (dev only) ───────────────────────────────────────────
/**
 * A villager written by the model from a description (and a pattern: a built-in id, or "<maker>:<id>"), as module
 * text for the prop sandbox, its record id, and its persona checked by the host (#42's checkPersona) or the reason
 * it was refused. `dials` are where the setup's sliders start. A `role` (one of the home's roles) decides the felt kit's
 * mark; the host stores it and returns it on make, read and remake.
 */
export interface MadeVillager { item: string; module: string; role?: string; persona: unknown; personaRefused?: string; dials: Record<string, number> | null; models: string[]; costUsd: number | null; outputTokens: number | null }
export const makeVillager = (person: string, description: string, accent: string, template?: string, role?: string) =>
  call<MadeVillager>(`/people/${person}/villagers`, { description, accent, ...(template ? { template } : {}), ...(role ? { role } : {}) })
/** A made villager whose module the home's checks, or whose persona the host's check, refused: made again once with the reason. */
export const remakeVillager = (person: string, item: string, reason: string) =>
  call<MadeVillager>(`/people/${person}/villagers/${item}/remake`, { reason })
/**
 * "Off you go": the tuned villager becomes the person's (people/<id>/persona.json) with its babble voice, all or nothing
 * on the host. Besides call()'s outcomes ('failed': nothing stored; 'away': no answer; 'refused': this tab's link is
 * someone else's), 'persona' means the host refused the persona itself: retrying cannot help, so the page says so.
 */
export async function sendOffVillager(person: string, item: string, tuning: Record<string, number>, voice: Record<string, number>): Promise<Outcome<{ name: string; persona: unknown }> | { ok: false; why: 'persona'; reason: string; ms: number }> {
  const t0 = performance.now()
  const res = await authorized(`/people/${person}/villagers/${item}/send-off`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tuning, voice }) }, token, true)
  const ms = performance.now() - t0
  if (!res) return { ok: false, why: 'away', ms }
  if (res === 'link') return { ok: false, why: 'link', ms }
  if (res.status === 403) return { ok: false, why: 'refused', ms }
  const body = (await res.json().catch(() => null)) as { refused?: unknown; error?: unknown; name?: unknown; persona?: unknown } | null
  if (res.status === 422 && body?.refused === true) return { ok: false, why: 'persona', reason: typeof body.error === 'string' ? body.error.slice(0, 200) : '', ms }
  if (res.status === 409) return { ok: false, why: 'busy', ms }
  if (!res.ok || !body || typeof body.name !== 'string') return { ok: false, why: 'failed', ms }
  return { ok: true, ms, name: body.name, persona: body.persona }
}
/** The person's villager now, and its babble voice, as the host keeps them. */
export const currentVillager = (person: string) => call<{ persona: unknown; voice: Record<string, number> | null }>(`/people/${person}/villager`)

/** Patterns (#47): the built-in ones this person may pick, their own saved ones, their profile and the jokes dial, all from the host. */
export interface PatternData { id: string; name: string; persona: Record<string, unknown>; audience: 'any' | 'adult' | 'child'; shared?: boolean; maker?: string }
/** The jokes dial as the host's humourCeiling decides it: locked at a level (by the admin's setting, or the person's own words) or free. */
export interface HumourDial { locked: 'clean' | 'cheeky' | 'crude' | null; by?: 'admin' | 'asked' }
export const personaTemplates = (person: string) =>
  call<{ builtin: PatternData[]; templates: PatternData[]; profile: unknown; humour: HumourDial }>(`/people/${person}/persona-templates`)
export const familyTemplates = (person: string) => call<{ templates: PatternData[] }>(`/people/${person}/family-templates`)
/**
 * Saved as a whole persona with the dials beside it; the host maps the dials in and checks it. `item` is the made
 * villager it came from: the host reads its pattern from there to decide who may see the saved one (the page never says).
 */
export const saveTemplate = (person: string, name: string, persona: unknown, dials: Record<string, number> | undefined, shared: boolean, item?: string) =>
  call<{ template: PatternData }>(`/people/${person}/persona-templates`, { name, persona, ...(dials ? { dials } : {}), shared, ...(item ? { item } : {}) })
/** A theme written from a sentence (#50): unchecked theme data, a one-line note, and the prop and costume hints. */
export const askTheme = (person: string, text: string, current: unknown) =>
  call<{ theme: unknown; note: string; hints: { props: unknown; costumes: unknown }; models: string[]; costUsd: number | null; outputTokens: number | null; apiMs: number | null }>(`/people/${person}/theme`, { text, current })
/**
 * World rules, acts and a toy written from a sentence (#74, #88): unchecked rules, acts and toy and a one-line note;
 * physics/ask.ts checks every field, act and part. `things` names what acts may target, `surfaces` where a toy may stand.
 */
export const askRules = (person: string, text: string, current: unknown, things: string[] = [], surfaces: unknown[] = [], toy = false) =>
  call<{ rules?: unknown; acts?: unknown; toy?: unknown; note: string; models: string[]; costUsd: number | null; outputTokens: number | null; apiMs: number | null }>(`/people/${person}/physics`, { text, current, things, surfaces, ...(toy ? { toy } : {}) })
