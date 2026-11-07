// The page's side of the villager API (host/src/villager.ts), reached through
// the dev server: /villager/launch gives the per-launch token and
// /villager/api/* is forwarded to the host on 127.0.0.1.

/** away: the host was not reached, so the line can be sent again. cut: the reply broke off or stalled after the host had the line. */
export type Said = { ok: true; reply: string } | { ok: false; why: 'away' | 'busy' | 'failed' | 'cut' }
/** A reply that sends nothing for this long is abandoned. */
const IDLE_MS = 30_000
export interface Line { from: 'person' | 'villager'; text?: string; unanswered?: boolean }

let token: string | null = null

async function authorized(path: string, init: RequestInit = {}): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) {
      const launch = await fetch('/villager/launch', { cache: 'no-store', signal: init.signal }).catch(() => null)
      if (!launch?.ok) return null
      // A server without the launch route (vite preview) answers with the page itself.
      token = ((await launch.json().catch(() => null)) as { token?: string } | null)?.token ?? null
      if (!token) return null
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

/**
 * Send a line and stream the reply. Stops when signal aborts, or when the host
 * sends nothing for IDLE_MS, so a hung host never leaves the page waiting.
 */
export async function say(person: string, text: string, onText: (t: string) => void, signal?: AbortSignal): Promise<Said> {
  const stop = new AbortController()
  const abort = () => stop.abort()
  signal?.addEventListener('abort', abort)
  let idle = setTimeout(abort, IDLE_MS)
  try {
    const res = await authorized(`/people/${person}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: stop.signal,
    })
    // Stopped before an answer began: the host may already have the line.
    if (!res) return { ok: false, why: stop.signal.aborted ? 'cut' : 'away' }
    if (res.status === 409) return { ok: false, why: 'busy' }
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
          else if (name === 'done') return { ok: true, reply: data.reply }
          else if (name === 'failed') return { ok: false, why: 'failed' }
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
