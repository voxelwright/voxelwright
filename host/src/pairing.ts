// Pairing (#85): how a device becomes a person's and stays theirs across host restarts.
//
// `mint` makes a one-time pairing code for a person; the operator hands it over as a
// link (…/#pair=<code>). The page exchanges it once (`pair`) for a session secret, which
// the server sets as an HttpOnly cookie, so page scripts (promoted plugins included, #45)
// can use the session but never read it. Minting revokes the person's other sessions
// and codes unless `keep` is set (a second device).
//
// A session belongs to the home it was paired on: the request's Host at /pair (never a
// forwarded host) is stored with it, and only that host opens it. Cookies ignore ports, so
// the browser sends every home's cookie to every localhost port; this binding is what keeps
// a dev server's page from acting through another home's session. Each home's cookie has its
// own name (cookieName), so two homes on one machine do not overwrite each other.
//
// At rest, <root>/villager/pairing.json (mode 0600) holds only SHA-256 hashes of codes
// and secrets, plus each session's host and public tag, as { version: 1, people: {…} }; any
// other shape is refused with a plain error rather than read as empty. A session lasts
// SESSION_TTL_MS from pairing, at rest as in its cookie, and expired ones are pruned. `unlink`
// (revoke) ends every session and code of a person (a random id the page may see, used to
// say which session a queued line was written under). Every change holds an exclusive
// lock file and replaces the file atomically, so the `link` command and a running host
// can both write it. A running host rereads it when it changes.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { statSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { withFileLock } from './file-lock.ts'
import { join } from 'node:path'

/** A pairing code stays usable this long after minting. */
export const CODE_TTL_MS = 24 * 3600_000
/** A session lasts this long from pairing: the cookie's Max-Age and the stored session both end then. */
export const SESSION_TTL_MS = 400 * 86_400_000

interface Pending { hash: string; expires: number }
interface Stored { hash: string; tag: string; host: string; pairedAt: string }
interface PersonState { pending: Pending[]; sessions: Stored[] }
type State = Record<string, PersonState>
interface File { version: 1; people: State }

export interface Session { person: string; tag: string }

const hashOf = (secret: string) => createHash('sha256').update(secret).digest()
/** Compares every stored hash even after a match, so timing does not reveal which code matched. */
function findHash<T extends { hash: string }>(items: T[], secret: string): T | undefined {
  const given = hashOf(secret)
  let found: T | undefined
  for (const item of items) {
    const stored = Buffer.from(item.hash, 'hex')
    if (stored.length === given.length && timingSafeEqual(stored, given) && !found) found = item
  }
  return found
}
const SECRET = /^[0-9a-f]{64}$/

export function pairingStore(root: string) {
  const dir = join(root, 'villager')
  const file = join(dir, 'pairing.json')
  let cache: { key: string; state: State } | null = null

  async function load(): Promise<State> {
    let key = 'none'
    try {
      const s = statSync(file)
      key = `${s.mtimeMs}:${s.size}:${s.ino}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (cache?.key === key) return cache.state
    const state = key === 'none' ? {} : checkFile(JSON.parse(await readFile(file, 'utf8')))
    cache = { key, state }
    return state
  }
  /** The people in a pairing file, or a plain error for any other shape. */
  function checkFile(raw: unknown): State {
    const f = raw as File
    const ok = f && f.version === 1 && f.people && typeof f.people === 'object' && !Array.isArray(f.people) &&
      Object.values(f.people).every((p) => p && Array.isArray(p.pending) && Array.isArray(p.sessions) && p.sessions.every((s) => typeof s?.hash === 'string' && typeof s.tag === 'string' && typeof s.pairedAt === 'string'))
    if (!ok) throw new Error(`${file} is not a version 1 pairing file; move it aside and pair the devices again`)
    return f.people
  }
  const alive = (s: Stored, now: number) => now - Date.parse(s.pairedAt) < SESSION_TTL_MS

  /** Read, change and write under the file's lock (file-lock.ts), so `link` and running hosts can all write it. */
  function change<T>(fn: (state: State) => T): Promise<T> {
    return withFileLock(file, async () => {
      cache = null
      const state = structuredClone(await load())
      const now = Date.now()
      for (const p of Object.values(state)) {
        p.pending = p.pending.filter((c) => c.expires > now)
        p.sessions = p.sessions.filter((s) => alive(s, now))
      }
      const out = fn(state)
      const tmp = `${file}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify({ version: 1, people: state } satisfies File, null, 2) + '\n', { mode: 0o600 })
      await rename(tmp, file)
      cache = null
      return out
    })
  }

  const personOf = (state: State, person: string) => (state[person] ??= { pending: [], sessions: [] })

  return {
    file,
    /**
     * A new one-time code for `person`. Without `keep`, the person's other codes end now, and so do their sessions:
     * those of the home at `hosts` when given (a link for the live home leaves a dev home's devices paired), else all.
     */
    mint: (person: string, { keep = false, hosts }: { keep?: boolean; hosts?: string[] } = {}) => change((state) => {
      const code = randomBytes(32).toString('hex')
      const p = personOf(state, person)
      if (!keep) {
        p.sessions = hosts ? p.sessions.filter((s) => !hosts.includes(s.host)) : []
        p.pending = []
      }
      p.pending.push({ hash: hashOf(code).toString('hex'), expires: Date.now() + CODE_TTL_MS })
      return code
    }),
    /** Exchanges a code, once, for a new session of the home at `host`. Null for an unknown, used or expired code. */
    async pair(code: string, host: string): Promise<(Session & { secret: string }) | null> {
      if (!SECRET.test(code) || !host) return null
      // A cheap read first, so a wrong code never takes the lock or writes.
      const now = Date.now()
      const known = Object.values(await load()).some((p) => findHash(p.pending.filter((c) => c.expires > now), code))
      if (!known) return null
      return change((state) => {
        for (const [person, p] of Object.entries(state)) {
          const hit = findHash(p.pending, code)
          if (!hit) continue
          p.pending = p.pending.filter((c) => c !== hit)
          const secret = randomBytes(32).toString('hex')
          const tag = randomBytes(8).toString('hex')
          p.sessions.push({ hash: hashOf(secret).toString('hex'), tag, host, pairedAt: new Date().toISOString() })
          return { person, tag, secret }
        }
        return null
      })
    },
    /** The session a secret opens on the home at `host`, or undefined. A session paired on another host (or stored without one) opens nothing. */
    async session(secret: string | undefined, host: string | undefined): Promise<Session | undefined> {
      if (!secret || !SECRET.test(secret) || !host) return undefined
      const state = await load()
      let found: Session | undefined
      for (const [person, p] of Object.entries(state)) {
        const hit = findHash(p.sessions, secret)
        if (hit && hit.host === host && alive(hit, Date.now()) && !found) found = { person, tag: hit.tag }
      }
      return found
    },
    /** Ends every session and code of `person`. */
    revoke: (person: string) => change((state) => {
      delete state[person]
    }),
    /** Per person: paired sessions (of the home at `hosts` when given: only those open it) and unexpired codes, as counts. */
    async status(hosts?: string[]): Promise<Record<string, { sessions: number; codes: number }>> {
      const state = await load()
      const now = Date.now()
      const counted = (s: Stored) => alive(s, now) && (!hosts || hosts.includes(s.host))
      return Object.fromEntries(Object.entries(state).map(([person, p]) => [person, { sessions: p.sessions.filter(counted).length, codes: p.pending.filter((c) => c.expires > now).length }]))
    },
  }
}
export type PairingStore = ReturnType<typeof pairingStore>

/** A person's pairing link: the code rides in the fragment, which the browser never sends to a server. */
export const pairLink = (home: string, code: string) => String(new URL(`#pair=${code}`, home))

/** Session cookies are named village_<…>. */
const COOKIE_PREFIX = 'village_'
/** The session cookie's name for the home at `host` (localhost:5183, or a tailnet name): one per home, so homes on one machine keep their own. */
export const cookieName = (host: string) => `${COOKIE_PREFIX}${createHash('sha256').update(host).digest('hex').slice(0, 12)}`
/** The session cookie for the home at `host`: HttpOnly, SameSite=Strict, scoped to the API path, Secure when the page is https. */
export function sessionCookie(host: string, secret: string, secure: boolean) {
  return `${cookieName(host)}=${secret}; Path=/villager/api; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}
/**
 * Every session secret in a Cookie header (each home's cookie reaches every port). Which one, if any, belongs to the
 * home asked is the store's decision (`session(secret, host)`), never the cookie's name. No cap on how many: a page
 * can set decoys that sort before the real cookie, and Node's header size limit already bounds the count.
 */
export function cookieSecrets(header: string | undefined): string[] {
  const out: string[] = []
  for (const part of (header ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    const value = rest.join('=')
    if (name.startsWith(COOKIE_PREFIX) && SECRET.test(value)) out.push(value)
  }
  return out
}
/** The host name of a Host value (localhost:5183 → localhost), for matching the approval page to its home. */
export const hostName = (host: string) => host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
