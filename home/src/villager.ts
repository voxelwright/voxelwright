// The page's side of the villager API (host/src/villager.ts), reached on the
// page's own origin at /villager/api/*.
//
// Pairing (#85): the host prints a one-time link (…/#pair=<code>). A fragment never
// reaches a server; the page takes it out of the address bar and history, and trades
// it once at POST /pair for a session the host keeps in an HttpOnly cookie. No script
// on the page, promoted plugins included, can read that cookie; the page only knows
// the session's public tag, which it keeps (with the person) to tag queued lines.

/**
 * away: the host was not reached, so the line can be sent again. cut: the reply broke off or stalled after the host had the line.
 * link: this device is not paired, or the host answered 401 (its pairing was replaced): open a new link; resending won't help.
 * refused: the host answered 403, this device is paired to someone other than the page's person (#40), so nothing was sent.
 * other: the line was written under a different pairing than this device has now, so it was not sent (see `tag`).
 * route: the reply named a route the host refused.
 */
export type Said = { ok: true; reply: string; routed?: Routed } | { ok: false; why: 'away' | 'busy' | 'failed' | 'cut' | 'route' | 'refused' | 'link' | 'other' }
/** The page's own person: synthetic until family isolation is proven (AGENTS.md). Any other villager is a visit (#42). */
/** Your own villager's path, or your visit to another person's villager, kept under you (#42). */
const talkPath = (person: string) => (person === ME ? `/people/${ME}` : `/people/${ME}/visits/${person}`)
/** A reply that sends nothing for this long is abandoned. */
const IDLE_MS = 30_000
/** The last pairing the host confirmed: { person, tag }. Public, never the session itself. */
const PAIRED_KEY = 'village.villager.paired'
/** The person's time zone, sent with every line and reminder call (#86): the villager reads "tomorrow at nine" in it. */
export const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
export interface Line { from: 'person' | 'villager'; text?: string; unanswered?: boolean }

/** This device's pairing: the person and the session's public tag. */
export interface Paired { person: string; tag: string }
/** Fired on window when this device is paired anew (a link was opened). */
export const PAIRED_EVENT = 'village:paired'

const remembered = (): Paired | null => {
  try {
    const p = JSON.parse(localStorage.getItem(PAIRED_KEY) ?? 'null')
    return p && typeof p.person === 'string' && typeof p.tag === 'string' ? { person: p.person, tag: p.tag } : null
  } catch {
    return null
  }
}
/**
 * The page's person: whoever this device is paired as (A4), from the last pairing the host confirmed, then from the
 * host itself. A live binding: importers always read the current value. Alex until the device is paired.
 */
export let ME = remembered()?.person ?? 'alex'
/** The host named this device's person. Another person than the page started as: load the page again as them, so every plugin that read ME at load reads it anew. */
function becomes(person: string) {
  if (person === ME) return
  ME = person
  location.reload()
}
const remember = (p: Paired | null) => {
  try {
    if (p) localStorage.setItem(PAIRED_KEY, JSON.stringify(p))
    else localStorage.removeItem(PAIRED_KEY)
  } catch {}
}

/** What the host says about this device. Null: not paired. When the host is away, the last pairing it confirmed. */
async function askSession(): Promise<Paired | null> {
  const res = await fetch('/villager/api/session').catch(() => null)
  if (res?.status === 401) {
    remember(null)
    return null
  }
  if (!res || !res.ok || !res.headers.get('content-type')?.startsWith('application/json')) return remembered()
  const { person, tag } = await res.json()
  const p = { person, tag }
  remember(p)
  becomes(person)
  return p
}

/**
 * Trades a link's one-time code for this device's session. True when paired; false when the host refused the code
 * (used, old or unknown); null when the host was not reached. Until it settles, sessionTag() waits for it.
 */
export async function pairWith(code: string): Promise<boolean | null> {
  const trade = (async (): Promise<{ ok: boolean | null; p: Paired | null }> => {
    const res = await fetch('/villager/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }).catch(() => null)
    if (!res || res.status >= 500) return { ok: null, p: null }
    if (!res.ok) return { ok: false, p: null }
    const { person, tag } = await res.json()
    remember({ person, tag })
    return { ok: true, p: { person, tag } }
  })()
  pairing = trade.then(({ p }) => p ?? askSession())
  const { ok, p } = await trade
  if (ok) dispatchEvent(new Event(PAIRED_EVENT))
  if (p) becomes(p.person)
  return ok
}

/** The code in a pairing link (…#pair=<code>), or null. */
export const codeIn = (text: string) => /[#&]pair=([0-9a-f]{64})\b/.exec(text)?.[1] ?? null

let pairing: Promise<Paired | null> = Promise.resolve(remembered())
/** Takes a pairing code from the address bar, out of the bar and history first, and pairs this device. */
function adoptLink() {
  const code = codeIn(location.hash)
  if (!code) return
  history.replaceState(history.state, '', location.pathname + location.search)
  void pairWith(code)
}
/** An installed home-screen app: iOS may copy the browser's cookies into it, but not its storage, so it asks. */
export const installed = () => typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)
// A page with no remembered pairing asks the host nothing until it is paired (#40): no request, no 401 in its console.
if (codeIn(location.hash)) adoptLink()
else if (remembered() || installed()) pairing = askSession()
// A new link opened in the same tab changes only the fragment.
addEventListener('hashchange', adoptLink)

/** This device's pairing, as last known: null when not paired. */
export const paired = (): Promise<Paired | null> => pairing

/**
 * The public tag of this device's session, so a kept line can say which pairing it was written under. Null when not
 * paired. One promise for all callers, so they resolve in order.
 */
export function sessionTag(): Promise<string | null> {
  return pairing.then((p) => p?.tag ?? null)
}

/**
 * Null when the host is unreachable. 'link' when this device is not paired (401). With `tag`, the host serves the
 * request only under that session (else 412). With `hostErrors`, a 5xx the host itself answered (JSON; the dev
 * server's proxy answers plain text when the host is down) is returned, so the caller can say it failed, not that the
 * host is away (#47).
 */
export async function authorized(path: string, init: RequestInit = {}, hostErrors = false, tag?: string | null): Promise<Response | null | 'link'> {
  if (!(await pairing)) {
    // Not paired, as far as this page knows. Another tab may have paired this browser since: then it remembered it.
    if (!remembered()) return 'link'
    pairing = askSession()
    if (!(await pairing)) return 'link'
  }
  const headers = new Headers(init.headers)
  if (tag) headers.set('x-village-session', tag)
  const res = await fetch(`/villager/api${path}`, { ...init, headers }).catch(() => null)
  if (!res || (res.status >= 500 && !(hostErrors && res.headers.get('content-type')?.startsWith('application/json')))) return null
  if (res.status === 401) {
    remember(null)
    pairing = Promise.resolve(null)
    return 'link'
  }
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
  /** The session tag (sessionTag) the line was written under: sent only under that session, else why 'other'. */
  tag?: string | null
}

/**
 * Send a line and stream the reply. Stops when signal aborts, or when the host
 * sends nothing for IDLE_MS, so a hung host never leaves the page waiting.
 */
export async function say(person: string, text: string, onText: (t: string) => void, { context, routing, sketch, signal, tag }: SayOptions = {}): Promise<Said> {
  // A line written under a pairing goes only under that pairing: checked here, and by the host (412) when it is sent.
  if (tag !== undefined && (await sessionTag()) !== tag) return { ok: false, why: 'other' }
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
      body: JSON.stringify({ text, zone: ZONE, ...(context ? { context } : {}), ...(routing ? { route: routing.route } : {}), ...(sketch ? { sketch } : {}) }),
      signal: stop.signal,
    }, false, tag)
    // Stopped before an answer began: the host may already have the line.
    if (!res) return { ok: false, why: stop.signal.aborted ? 'cut' : 'away' }
    if (res === 'link') return { ok: false, why: 'link' }
    if (res.status === 409) return { ok: false, why: 'busy' }
    if (res.status === 412) return { ok: false, why: 'other' }
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
  route: 'talk' | 'answer' | 'furnish' | 'project' | 'journal' | 'theme' | 'build' | 'physics' | 'elder'
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
  const res = await authorized(`/people/${person}/villagers/${item}/send-off`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tuning, voice }) }, true)
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

// ── Reminders (#86) ─────────────────────────────────────────────────────────
/** A reminder as the host gives it to the page: `when` is in words, in the zone the page sent. States are host/src/reminders.ts's. */
export interface ReminderView {
  id: string
  what: string
  at: string
  state: 'pending' | 'put off' | 'due' | 'shown' | 'done'
  /** It arrived after its time, while the home was closed or the host down. */
  late?: true
  when: string
  today: boolean
}
/** Your own reminders, settled by the host: due ones (late when they arrived while the home was closed) are on their way to the fridge. */
export const reminders = () => call<{ villager: string; zone: string; reminders: ReminderView[] }>(`/people/${ME}/reminders?zone=${encodeURIComponent(ZONE)}`)
/** Tell the host the page showed it, it was ticked off, or put off (an hour, or tomorrow morning). */
export const actOnReminder = (id: string, action: 'shown' | 'done' | 'later', until?: 'hour' | 'morning') =>
  call<{ reminder: { state: string; when: string } }>(`/people/${ME}/reminders/${id}`, { action, ...(until ? { until } : {}), zone: ZONE })

// ── #87 the Elder from inside the home ──────────────────────────────────────
// The host (host/src/elder-home.ts) runs the Elder and keeps the record. The page only shows what the host says; it
// never keeps, undoes or turns a change down (host/src/approval.ts says why).

/** A stage of an Elder run; `label` is the host's words for it (host/src/elder-home.ts STAGES). */
export type ElderStage = { name: string; label?: string; state: 'waiting' | 'now' | 'pass' | 'fail' | 'warn' | 'skipped'; ms?: number }
export interface ElderRun {
  id: string
  request: string
  status: 'running' | 'passed' | 'failed' | 'interrupted' | 'kept' | 'undone' | 'declined'
  stages: ElderStage[]
  reason?: string
  detail?: string
  warning?: string
  totalMs?: number
  costUsd?: number | null
  pictures?: boolean
  promotion?: string
  said?: string
  liveUrl?: string | null
  /** This page is the live home, so a kept change appears in it. */
  here?: boolean
}
/** What the host answered: the run, or a refusal in plain words (not an operator, busy, the hourly cap, Keep refused). */
export type ElderAnswer =
  | { ok: true; run: ElderRun | null; operator?: boolean; busy?: boolean; left?: number; approval?: string[] }
  | { ok: false; why: 'away' | 'link' | 'refused' | 'failed'; refused?: string; message?: string; run?: ElderRun }

async function elderCall(path: string, body?: unknown): Promise<ElderAnswer> {
  const res = await authorized(`/people/${ME}/elder${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, true)
  if (!res) return { ok: false, why: 'away' }
  if (res === 'link') return { ok: false, why: 'link' }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!data) return { ok: false, why: 'failed' }
  if (!res.ok) return { ok: false, why: typeof data.refused === 'string' ? 'refused' : 'failed', refused: data.refused as string | undefined, message: typeof data.message === 'string' ? data.message : undefined, run: data.run as ElderRun | undefined }
  return { ok: true, run: (data.run as ElderRun | null) ?? null, operator: data.operator as boolean | undefined, busy: data.busy as boolean | undefined, left: data.left as number | undefined, approval: Array.isArray(data.approval) ? data.approval.filter((u): u is string => typeof u === 'string') : undefined }
}

/** Whether this person may ask the Elder, and their latest run. */
export const elderState = () => elderCall('')
/** Ask the Elder for a change, in the person's own words. Starts a run at most. */
export const askElder = (text: string) => elderCall('/runs', { text })
export const elderRun = (id: string) => elderCall(`/runs/${encodeURIComponent(id)}`)
/**
 * The approval page for a run: the host's address for it whose host name is this page's (localhost, 127.0.0.1 or the
 * tailnet name, so the device's pairing cookie goes with it), else the first. Null when the host named none.
 */
export function approvalLink(urls: string[] | undefined, id: string): string | null {
  const list = (urls ?? []).flatMap((u) => {
    try {
      const url = new URL(u)
      return url.protocol === 'http:' || url.protocol === 'https:' ? [url] : []
    } catch {
      return []
    }
  })
  const url = list.find((u) => u.hostname === location.hostname) ?? list[0]
  return url ? `${url.origin}/#run=${encodeURIComponent(id)}` : null
}
/** The home without (before) or with (after) the change, as an object URL; the caller revokes it. */
export async function elderPicture(id: string, which: 'before' | 'after'): Promise<string | null> {
  const res = await authorized(`/people/${ME}/elder/runs/${encodeURIComponent(id)}/${which}`)
  if (!res || res === 'link' || !res.ok || res.headers.get('content-type') !== 'image/png') return null
  return URL.createObjectURL(await res.blob())
}
