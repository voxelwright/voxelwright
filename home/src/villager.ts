// The page's side of the villager API (host/src/villager.ts), reached through
// the dev server: /villager/launch gives the per-launch token and
// /villager/api/* is forwarded to the host on 127.0.0.1.

export type Said = { ok: true; reply: string } | { ok: false; why: 'away' | 'busy' | 'failed' }
export interface Line { from: 'person' | 'villager'; text?: string; unanswered?: boolean }

let token: string | null = null

async function authorized(path: string, init: RequestInit = {}): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) {
      const launch = await fetch('/villager/launch', { cache: 'no-store' }).catch(() => null)
      if (!launch?.ok) return null
      token = (await launch.json()).token
    }
    const res = await fetch(`/villager/api${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } }).catch(() => null)
    if (!res || res.status >= 500) return null
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

/** `context` is background the person did not say (the table's last round): the villager hears it, the conversation never stores it. */
export async function say(person: string, text: string, onText: (t: string) => void, context?: string): Promise<Said> {
  const res = await authorized(`/people/${person}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, ...(context ? { context } : {}) }),
  })
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
        else if (name === 'done') return { ok: true, reply: data.reply }
        else if (name === 'failed') return { ok: false, why: 'failed' }
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
  replace?: string
  copy?: boolean
  library?: string
  section?: 'talk' | 'tasks'
}
export type Outcome<T> = ({ ok: true; ms: number } & T) | { ok: false; why: 'away' | 'failed' | 'busy'; ms: number }

async function call<T>(path: string, body?: unknown): Promise<Outcome<T>> {
  const t0 = performance.now()
  const res = await authorized(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
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
/** A villager written by the model from a description, as module text for the prop sandbox, and its record id. */
export const makeVillager = (person: string, description: string, accent: string) =>
  call<{ item: string; module: string; persona: unknown; models: string[]; costUsd: number | null; outputTokens: number | null }>(`/people/${person}/villagers`, { description, accent })
/** The slider values chosen for a made villager, kept beside its module text. */
export const tuneVillager = (person: string, item: string, tuning: Record<string, number>) =>
  call<{ ok: true }>(`/people/${person}/villagers/${item}/tuning`, tuning)
/** Persona templates (#47): the person's own saved patterns and their profile, the family's shared ones, and saving one. All data, gated by the host. */
export interface SavedTemplate { id: string; name: string; persona: Record<string, unknown>; audience: 'any' | 'adult' | 'child'; shared: boolean; maker: string }
export const personaTemplates = async (person: string) => {
  const r = await call<{ templates: SavedTemplate[]; profile?: unknown }>(`/people/${person}/persona-templates`)
  return r.ok ? { ...r, profile: profileOf(r.profile) } : r
}
/** The host's profile of a person as plain data: two booleans, or null (unknown) for anything else. */
const profileOf = (v: unknown): { adult: boolean; crudeOptIn: boolean } | null =>
  v !== null && typeof v === 'object' && typeof (v as { adult?: unknown }).adult === 'boolean' && typeof (v as { crudeOptIn?: unknown }).crudeOptIn === 'boolean'
    ? { adult: (v as { adult: boolean }).adult, crudeOptIn: (v as { crudeOptIn: boolean }).crudeOptIn }
    : null
/** A made villager the home's checks refused, made again once with the reason. Module text for the sandbox, as makeVillager. */
export const remakeVillager = (person: string, item: string, reason: string) =>
  call<{ item: string; module: string; persona: unknown; models: string[]; costUsd: number | null; outputTokens: number | null }>(`/people/${person}/villagers/${item}/remake`, { reason })
export const familyTemplates = (person: string) => call<{ templates: SavedTemplate[] }>(`/family/persona-templates?for=${person}`)
export const saveTemplate = (person: string, name: string, persona: unknown, shared: boolean) =>
  call<{ template: SavedTemplate }>(`/people/${person}/persona-templates`, { name, persona, shared })
