// The page's side of the villager API (host/src/villager.ts), reached through
// the dev server, which forwards /villager/api/* to the host on 127.0.0.1.
//
// The token comes from the link the host prints (http://localhost:5181/#token=…).
// A fragment never reaches a server; the page keeps the token for this tab in
// sessionStorage and takes it out of the address bar.

/**
 * away: the host was not reached, so the line can be sent again. cut: the reply broke off or stalled after the host had the line.
 * refused: the host answered 403, this tab's token is for another person (#40). route: the reply named a route the host refused.
 */
export type Said = { ok: true; reply: string; routed?: Routed } | { ok: false; why: 'away' | 'busy' | 'failed' | 'cut' | 'route' | 'refused' }
/** A reply that sends nothing for this long is abandoned. */
const IDLE_MS = 30_000
const TOKEN_KEY = 'village.villager.token'
export interface Line { from: 'person' | 'villager'; text?: string; unanswered?: boolean }

let token: string | null = null
try {
  token = sessionStorage.getItem(TOKEN_KEY)
} catch {}
/** Takes a token from the address bar's #token=…, keeps it for this tab and clears it from the bar. */
function adoptLink() {
  const linked = new URLSearchParams(location.hash.slice(1)).get('token')
  if (!linked) return
  token = linked
  try {
    sessionStorage.setItem(TOKEN_KEY, linked)
  } catch {}
  history.replaceState(history.state, '', location.pathname + location.search)
}
adoptLink()
// A new link opened in the same tab (after the host restarts) changes only the fragment.
addEventListener('hashchange', adoptLink)

/** Null when there is no token, the host is unreachable, or the token is from an earlier launch (open the new link). */
export async function authorized(path: string, init: RequestInit = {}): Promise<Response | null> {
  if (!token) return null
  const res = await fetch(`/villager/api${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } }).catch(() => null)
  if (!res || res.status >= 500 || res.status === 401) return null
  return res
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

export interface SayOptions {
  /** Background the person did not say (the table's round so far): the villager hears it, the conversation never stores it. */
  context?: string
  /** With routing, one call either answers (text streams) or names a route (onRoute, no text). */
  routing?: Routing
  /** A drawing handed over (#42, sketch.ts), by reference: the drawer's id and the sketch's. */
  sketch?: { from: string; id: string }
  signal?: AbortSignal
}

/**
 * Send a line and stream the reply. Stops when signal aborts, or when the host
 * sends nothing for IDLE_MS, so a hung host never leaves the page waiting.
 */
export async function say(person: string, text: string, onText: (t: string) => void, { context, routing, sketch, signal }: SayOptions = {}): Promise<Said> {
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
    const res = await authorized(`/people/${person}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...(context ? { context } : {}), ...(routing ? { route: routing.route } : {}), ...(sketch ? { sketch } : {}) }),
      signal: stop.signal,
    })
    // Stopped before an answer began: the host may already have the line.
    if (!res) return { ok: false, why: stop.signal.aborted ? 'cut' : 'away' }
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
export type Outcome<T> = ({ ok: true; ms: number } & T) | { ok: false; why: 'away' | 'failed' | 'busy' | 'refused'; ms: number }

export async function call<T>(path: string, body?: unknown): Promise<Outcome<T>> {
  const t0 = performance.now()
  const res = await authorized(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const ms = performance.now() - t0
  if (!res) return { ok: false, why: 'away', ms }
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
