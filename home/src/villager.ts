// The page's side of the villager API (host/src/villager.ts), reached through
// the dev server: /villager/launch gives the per-launch token and
// /villager/api/* is forwarded to the host on 127.0.0.1.

export type Said = { ok: true; reply: string; routed?: Routed } | { ok: false; why: 'away' | 'busy' | 'failed' | 'route' }
export interface Line { from: 'person' | 'villager'; text?: string; unanswered?: boolean }

let token: string | null = null

/**
 * A request to the host, or null when the host is away. With `hostErrors`, a 5xx the host itself answered (JSON; the
 * dev server's proxy answers plain text when the host is down) is returned, so the caller can say it failed, not that
 * the host is away.
 */
export async function authorized(path: string, init: RequestInit = {}, hostErrors = false): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) {
      const launch = await fetch('/villager/launch', { cache: 'no-store' }).catch(() => null)
      if (!launch?.ok) return null
      token = (await launch.json()).token
    }
    const res = await fetch(`/villager/api${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } }).catch(() => null)
    if (!res || (res.status >= 500 && !(hostErrors && res.headers.get('content-type')?.startsWith('application/json')))) return null
    // The host restarted with a new token: fetch it once and try again.
    if (res.status === 401) {
      token = null
      continue
    }
    return res
  }
  return null
}

export async function conversation(person: string): Promise<Line[] | null> {
  const res = await authorized(`/people/${person}/conversation`)
  return res?.ok ? (await res.json()).lines : null
}

export interface Routing {
  /** Your own villager's name and the cast: the line may be routed in its reply (#42). */
  route: { primary: string; villagers: { id: string; name: string; role: string }[] }
  /** Called once, as soon as the host has read a route in the reply. */
  onRoute(routed: Routed): void
}

/**
 * `context` is background the person did not say (the table's round so far): the villager hears it, the conversation never stores it.
 * With `routing`, one call either answers (text streams) or names a route (`onRoute`, no text).
 */
export async function say(person: string, text: string, onText: (t: string) => void, context?: string, routing?: Routing, sketch?: { from: string; id: string }): Promise<Said> {
  const res = await authorized(`/people/${person}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // A drawing handed over (#42, sketch.ts) goes by reference, the drawer's id and the sketch's.
    body: JSON.stringify({ text, ...(context ? { context } : {}), ...(routing ? { route: routing.route } : {}), ...(sketch ? { sketch } : {}) }),
  })
  let routed: Routed | undefined
  const onRoute = (r: Routed) => {
    if (routed) return
    routed = r
    routing?.onRoute(r)
  }
  if (!res) return { ok: false, why: 'away' }
  if (res.status === 409) return { ok: false, why: 'busy' }
  if (!res.ok || !res.body) return { ok: false, why: 'failed' }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
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
    return { ok: false, why: 'away' }
  }
  // The stream ended without an answer: the host went away mid-reply.
  return { ok: false, why: 'away' }
}

// ── The always-on input (#42 prototype) ─────────────────────────────────────
// Everything that comes back is model output the host checked or stored as text:
// the page treats it as data. Prop modules only ever run in the prop sandbox.

export interface Routed {
  route: 'talk' | 'answer' | 'furnish' | 'project' | 'journal'
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
}
export type Outcome<T> = ({ ok: true; ms: number } & T) | { ok: false; why: 'away' | 'failed' | 'busy'; ms: number }

/** With `hostErrors`, a failure the host answered itself (a 5xx in JSON) is 'failed', not 'away' (see authorized). */
export async function call<T>(path: string, body?: unknown, hostErrors = false): Promise<Outcome<T>> {
  const t0 = performance.now()
  const res = await authorized(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, hostErrors)
  const ms = performance.now() - t0
  if (!res) return { ok: false, why: 'away', ms }
  if (res.status === 409) return { ok: false, why: 'busy', ms }
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
 * "Off you go": the tuned villager becomes the person's (people/<id>/persona.json) with its babble voice. All or nothing
 * on the host: 'failed' when it could not store it (nothing changed), 'away' when the host did not answer.
 */
export const sendOffVillager = (person: string, item: string, tuning: Record<string, number>, voice: Record<string, number>) =>
  call<{ ok: true; name: string; persona: unknown }>(`/people/${person}/villagers/${item}/send-off`, { tuning, voice }, true)
/** The person's villager now, and its babble voice, as the host keeps them. */
export const currentVillager = (person: string) => call<{ persona: unknown; voice: Record<string, number> | null }>(`/people/${person}/villager`)

/** Patterns (#47): the built-in ones this person may pick, their own saved ones, their profile and the jokes dial, all from the host. */
export interface PatternData { id: string; name: string; persona: Record<string, unknown>; audience: 'any' | 'adult' | 'child'; shared?: boolean; maker?: string }
/** The jokes dial as the host's humourCeiling decides it: locked at a level (by the admin's setting, or the person's own words) or free. */
export interface HumourDial { locked: 'clean' | 'cheeky' | 'crude' | null; by?: 'admin' | 'asked' }
export const personaTemplates = (person: string) =>
  call<{ builtin: PatternData[]; templates: PatternData[]; profile: unknown; humour: HumourDial }>(`/people/${person}/persona-templates`)
export const familyTemplates = (person: string) => call<{ templates: PatternData[] }>(`/family/persona-templates?for=${person}`)
/**
 * Saved as a whole persona with the dials beside it; the host maps the dials in and checks it. `item` is the made
 * villager it came from: the host reads its pattern from there to decide who may see the saved one (the page never says).
 */
export const saveTemplate = (person: string, name: string, persona: unknown, dials: Record<string, number> | undefined, shared: boolean, item?: string) =>
  call<{ template: PatternData }>(`/people/${person}/persona-templates`, { name, persona, ...(dials ? { dials } : {}), shared, ...(item ? { item } : {}) })
