// The villager service: a loopback-only HTTP API through which a person talks
// to their villager. Every request needs the per-launch token, which is
// written with mode 0600 to <root>/villager/launch.json for the home's dev
// server to hand to the page. Replies stream as server-sent events.
//
// Per person, under <root>/people/<id>/:
//   notes/*.md          the villager's private notes (its only tools)
//   villager.json       the Agent SDK session id to resume, and its running cost
//   conversation.jsonl  what each side said (the person's own lines only, never context)
//   usage.jsonl         one line per turn: model, tokens, cost, timings
//   routes.jsonl        the always-on input (#42): each line routed, the checked route, timings
//   library/<item>.json props made for them: module text (never run here) and metadata
//   projects.jsonl      things too big for the fast path, recorded as "being made"
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Context } from 'cordis'
import type { Agent } from './villager-agent.ts'
import { checkRouted, type Maker, type Router } from './villager-input.ts'

export interface Config {
  root: string
  agent: Agent
  /** 0 picks a free port. */
  port?: number
  /** Person id to the name the villager uses. Synthetic until isolation is proven. */
  people?: Record<string, string>
  turnTimeoutMs?: number
  /** The always-on input's router and prop maker (#42). Without them those endpoints answer 503. */
  router?: Router
  maker?: Maker
}

/** A stored prop. The module is text the home runs in its sandbox; the host never imports or evaluates it. */
interface LibraryItem { id: string; name: string; module: string; size?: number[]; models: string[]; costUsd: number | null; ms: number; at: string; kept: boolean }
interface Project { id: string; what: string; where?: string; text?: string; state: 'being made'; at: string }

interface SessionState {
  sessionId?: string
  sessionCostUsd?: number
}

const PERSON = /^[a-z][a-z0-9-]{0,31}$/
const ITEM = /^[a-f0-9]{12}$/
const VILLAGER_NAME = /^[A-Za-z][A-Za-z' -]{0,23}$/
const MAX_TEXT = 2000
const MAX_MODULE = 120_000

/**
 * Parses the operator's list of synthetic people, `alex:Alex,sam:Sam`, into
 * `people`. Throws on a malformed entry or id, so a typo never starts a host
 * that silently answers for the wrong people.
 */
export function parsePeople(spec: string): Record<string, string> {
  const people: Record<string, string> = {}
  for (const entry of spec.split(',').map((e) => e.trim()).filter(Boolean)) {
    const at = entry.indexOf(':')
    const id = at < 0 ? entry : entry.slice(0, at).trim()
    const name = at < 0 ? '' : entry.slice(at + 1).trim()
    if (!PERSON.test(id) || !name || name.length > 40) throw new Error(`"${entry}" is not id:Name with a lowercase id`)
    if (Object.hasOwn(people, id)) throw new Error(`"${id}" is listed twice`)
    people[id] = name
  }
  if (!Object.keys(people).length) throw new Error('no people listed')
  return people
}

declare module 'cordis' {
  interface Context {
    villager: { port: number; launchFile: string }
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

async function readJsonl(path: string): Promise<unknown[]> {
  const raw = await readFile(path, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

const appendJsonl = (path: string, value: unknown) => appendFile(path, JSON.stringify(value) + '\n', { mode: 0o600 })

async function body(req: IncomingMessage): Promise<unknown> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > MAX_TEXT * 4) throw new Error('too large')
  }
  return JSON.parse(raw)
}

export default {
  name: 'villager',
  async apply(ctx: Context, config: Config) {
    const people = config.people ?? { alex: 'Alex' }
    const token = randomBytes(32).toString('hex')
    const expected = Buffer.from(`Bearer ${token}`)
    const busy = new Set<string>()
    const turns = new Set<Promise<unknown>>()
    const personDir = (id: string) => join(config.root, 'people', id)

    const authorized = (req: IncomingMessage) => {
      const given = Buffer.from(req.headers.authorization ?? '')
      return given.length === expected.length && timingSafeEqual(given, expected)
    }
    const send = (res: ServerResponse, status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }

    async function converse(id: string, text: string, context: string | undefined, res: ServerResponse) {
      const dir = personDir(id)
      const notesDir = join(dir, 'notes')
      await mkdir(notesDir, { recursive: true, mode: 0o700 })
      const stateFile = join(dir, 'villager.json')
      const state = await readJson<SessionState>(stateFile, {})
      const at = new Date().toISOString()
      await appendJsonl(join(dir, 'conversation.jsonl'), { at, from: 'person', text })

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.flushHeaders()
      const event = (name: string, data: unknown) => {
        if (!res.writableEnded && !res.destroyed) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
      }
      // The turn finishes and is recorded even if the page goes away mid-reply.
      const deadline = AbortSignal.timeout(config.turnTimeoutMs ?? 180_000)
      const started = Date.now()
      try {
        const result = await config.agent({ name: people[id], text, context, sessionId: state.sessionId, notesDir, personDir: dir, signal: deadline, onText: (t) => event('text', { t }) })
        const totalMs = Date.now() - started
        const previous = result.sessionId === state.sessionId ? state.sessionCostUsd ?? 0 : 0
        const costUsd = result.sessionCostUsd === null ? null : Math.max(0, result.sessionCostUsd - previous)
        await writeFile(stateFile, JSON.stringify({ sessionId: result.sessionId, sessionCostUsd: result.sessionCostUsd ?? state.sessionCostUsd } satisfies SessionState), { mode: 0o600 })
        await appendJsonl(join(dir, 'conversation.jsonl'), { at: new Date().toISOString(), from: 'villager', text: result.reply })
        await appendJsonl(join(dir, 'usage.jsonl'), { at, models: result.models, usage: result.usage, costUsd, sessionCostUsd: result.sessionCostUsd, ttftMs: result.ttftMs, totalMs, sessionId: result.sessionId, resumed: Boolean(state.sessionId) })
        event('done', { reply: result.reply, ttftMs: result.ttftMs, totalMs })
      } catch (error) {
        // The stored session id is left as it was; the person's line stays recorded as unanswered.
        await appendJsonl(join(dir, 'conversation.jsonl'), { at: new Date().toISOString(), from: 'villager', unanswered: true })
        await appendJsonl(join(dir, 'usage.jsonl'), { at, failed: deadline.aborted ? 'timeout' : String((error as Error).message ?? error).slice(0, 300), totalMs: Date.now() - started })
        event('failed', { reason: deadline.aborted ? 'timeout' : 'error' })
      } finally {
        res.end()
      }
    }

    const making = new Set<string>()
    const libraryDir = (id: string) => join(personDir(id), 'library')
    const readItem = (id: string, item: string) => readJson<LibraryItem | null>(join(libraryDir(id), `${item}.json`), null)

    /** The always-on input's endpoints. Everything a model wrote is checked or stored as text; nothing is run. */
    async function input(id: string, what: string, item: string | undefined, req: IncomingMessage, res: ServerResponse) {
      const dir = personDir(id)
      if (what === 'route' && req.method === 'POST') {
        if (!config.router) return send(res, 503, { error: 'no router' })
        let b: { text?: unknown; primary?: unknown; villagers?: unknown }
        try {
          b = ((await body(req)) ?? {}) as typeof b
        } catch {
          return send(res, 400, { error: 'expected JSON {"text", "primary", "villagers"}' })
        }
        // Model failures answer 422, not 5xx: the page reads 5xx as the host being away.
        const { text, primary, villagers } = b
        if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return send(res, 400, { error: `text is 1 to ${MAX_TEXT} characters` })
        if (typeof primary !== 'string' || !VILLAGER_NAME.test(primary)) return send(res, 400, { error: 'primary is a villager name' })
        const cast = Array.isArray(villagers) ? villagers.slice(0, 8) : []
        const known = cast.filter((v): v is { id: string; name: string; role: string } =>
          v && typeof v === 'object' && typeof v.id === 'string' && Object.hasOwn(people, v.id) && typeof v.name === 'string' && VILLAGER_NAME.test(v.name) && typeof v.role === 'string' && VILLAGER_NAME.test(v.role))
        if (!known.length || known.length !== cast.length) return send(res, 400, { error: 'villagers are {id, name, role} for listed people' })
        await mkdir(dir, { recursive: true, mode: 0o700 })
        const library = await listLibrary(id)
        const started = Date.now()
        const at = new Date().toISOString()
        try {
          const call = await config.router({ name: people[id], primary, text: text.trim(), villagers: known, library: library.map((l) => ({ id: l.id, name: l.name })), signal: AbortSignal.timeout(30_000) })
          const ms = Date.now() - started
          const checked = checkRouted(call.raw, known.map((v) => v.id), library.map((l) => l.id))
          await appendJsonl(join(dir, 'routes.jsonl'), { at, text: text.trim(), ...('routed' in checked ? { routed: checked.routed } : { refused: checked.reason }), ms, models: call.models, costUsd: call.costUsd, outputTokens: call.outputTokens })
          if ('reason' in checked) return send(res, 422, { error: checked.reason, ms })
          return send(res, 200, { routed: checked.routed, ms, models: call.models, costUsd: call.costUsd })
        } catch (error) {
          await appendJsonl(join(dir, 'routes.jsonl'), { at, text: text.trim(), failed: String((error as Error).message ?? error).slice(0, 300), ms: Date.now() - started })
          return send(res, 422, { error: 'the router failed', ms: Date.now() - started })
        }
      }
      if (what === 'props' && req.method === 'POST') {
        if (!config.maker) return send(res, 503, { error: 'no maker' })
        let b: { what?: unknown; size?: unknown; variant?: unknown }
        try {
          b = ((await body(req)) ?? {}) as typeof b
        } catch {
          return send(res, 400, { error: 'expected JSON {"what", "size"?, "variant"?}' })
        }
        if (typeof b.what !== 'string' || !b.what.trim() || b.what.length > 200) return send(res, 400, { error: 'what is 1 to 200 characters' })
        const size = Array.isArray(b.size) && b.size.length === 3 && b.size.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 4) ? b.size as [number, number, number] : undefined
        if (b.size !== undefined && !size) return send(res, 400, { error: 'size is three numbers in metres, each at most 4' })
        const variant = Number.isInteger(b.variant) && (b.variant as number) >= 0 && (b.variant as number) < 10 ? b.variant as number : 0
        if (making.has(id)) return send(res, 409, { error: 'already making something' })
        making.add(id)
        const started = Date.now()
        try {
          const made = await config.maker({ what: b.what.trim(), size, variant, signal: AbortSignal.timeout(90_000) })
          const ms = Date.now() - started
          if (typeof made.module !== 'string' || !made.module.trim() || made.module.length > MAX_MODULE) return send(res, 422, { error: 'the maker returned no usable module', ms })
          // Stored as text for the home's sandbox; never imported, evaluated or run by the host.
          const entry: LibraryItem = { id: randomBytes(6).toString('hex'), name: b.what.trim().slice(0, 80), module: made.module, size, models: made.models, costUsd: made.costUsd, ms, at: new Date().toISOString(), kept: false }
          await mkdir(libraryDir(id), { recursive: true, mode: 0o700 })
          await writeFile(join(libraryDir(id), `${entry.id}.json`), JSON.stringify(entry), { mode: 0o600 })
          return send(res, 200, { item: entry.id, name: entry.name, module: entry.module, ms, models: made.models, costUsd: made.costUsd, outputTokens: made.outputTokens })
        } catch {
          return send(res, 422, { error: 'the maker failed', ms: Date.now() - started })
        } finally {
          making.delete(id)
        }
      }
      if (what === 'library' && req.method === 'GET' && !item) {
        return send(res, 200, { items: (await listLibrary(id)).map(({ id: i, name, size, at }) => ({ id: i, name, size, at })) })
      }
      if (what === 'library' && item && req.method === 'GET') {
        const found = await readItem(id, item)
        if (!found) return send(res, 404, { error: 'no such item' })
        return send(res, 200, { id: found.id, name: found.name, module: found.module, size: found.size, kept: found.kept })
      }
      if (what === 'keep' && item && req.method === 'POST') {
        const found = await readItem(id, item)
        if (!found) return send(res, 404, { error: 'no such item' })
        found.kept = true
        await writeFile(join(libraryDir(id), `${item}.json`), JSON.stringify(found), { mode: 0o600 })
        return send(res, 200, { ok: true })
      }
      if (what === 'projects' && req.method === 'GET') {
        return send(res, 200, { projects: (await readJsonl(join(dir, 'projects.jsonl'))).slice(-50) })
      }
      if (what === 'projects' && req.method === 'POST') {
        let b: { what?: unknown; where?: unknown; text?: unknown }
        try {
          b = ((await body(req)) ?? {}) as typeof b
        } catch {
          return send(res, 400, { error: 'expected JSON {"what", "where"?, "text"?}' })
        }
        if (typeof b.what !== 'string' || !b.what.trim() || b.what.length > 200) return send(res, 400, { error: 'what is 1 to 200 characters' })
        if (b.where !== undefined && (typeof b.where !== 'string' || b.where.length > 100)) return send(res, 400, { error: 'where is at most 100 characters' })
        if (b.text !== undefined && (typeof b.text !== 'string' || b.text.length > MAX_TEXT)) return send(res, 400, { error: `text is at most ${MAX_TEXT} characters` })
        const project: Project = { id: randomBytes(6).toString('hex'), what: b.what.trim(), ...(b.where ? { where: (b.where as string).trim() } : {}), ...(b.text ? { text: (b.text as string).trim() } : {}), state: 'being made', at: new Date().toISOString() }
        await mkdir(dir, { recursive: true, mode: 0o700 })
        await appendJsonl(join(dir, 'projects.jsonl'), project)
        return send(res, 200, { project })
      }
      return send(res, 405, { error: 'method not allowed' })
    }

    /** Kept items, newest first. Drafts (made but not kept) stay on disk but are not offered. */
    async function listLibrary(id: string): Promise<LibraryItem[]> {
      const files = await readdir(libraryDir(id)).catch(() => [] as string[])
      const items = await Promise.all(files.filter((f) => ITEM.test(f.replace(/\.json$/, '')) && f.endsWith('.json')).map((f) => readItem(id, f.replace(/\.json$/, ''))))
      return items.filter((i): i is LibraryItem => Boolean(i?.kept)).sort((a, b) => b.at.localeCompare(a.at))
    }

    async function handle(req: IncomingMessage, res: ServerResponse) {
      if (!authorized(req)) return send(res, 401, { error: 'token required' })
      const path = new URL(req.url ?? '/', 'http://x').pathname
      const inputMatch = /^\/people\/([^/]+)\/(?:(route|props|projects|library)|library\/([^/]+)(\/keep)?)$/.exec(path)
      if (inputMatch) {
        const [, id, plain, item, keep] = inputMatch
        if (!PERSON.test(id) || !Object.hasOwn(people, id)) return send(res, 404, { error: 'no such person' })
        if (item !== undefined && !ITEM.test(item)) return send(res, 404, { error: 'no such item' })
        return input(id, plain ?? (keep ? 'keep' : 'library'), item, req, res)
      }
      const match = /^\/people\/([^/]+)\/(conversation|messages)$/.exec(path)
      if (!match) return send(res, 404, { error: 'not found' })
      const [, id, what] = match
      if (!PERSON.test(id) || !Object.hasOwn(people, id)) return send(res, 404, { error: 'no such person' })
      if (what === 'conversation' && req.method === 'GET') {
        const lines = await readJsonl(join(personDir(id), 'conversation.jsonl'))
        return send(res, 200, { name: people[id], lines: lines.slice(-40) })
      }
      if (what === 'messages' && req.method === 'POST') {
        let text: unknown, context: unknown
        try {
          ({ text, context } = ((await body(req)) ?? {}) as { text?: unknown; context?: unknown })
        } catch {
          return send(res, 400, { error: 'expected JSON {"text": "...", "context"?: "..."}' })
        }
        if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return send(res, 400, { error: `text is 1 to ${MAX_TEXT} characters` })
        // Context (what others at the table said) reaches the villager's turn but is never stored as the person's line.
        if (context !== undefined && (typeof context !== 'string' || context.length > MAX_TEXT)) return send(res, 400, { error: `context is a string of at most ${MAX_TEXT} characters` })
        if (busy.has(id)) return send(res, 409, { error: 'the villager is still writing' })
        busy.add(id)
        const turn = converse(id, text.trim(), (context as string | undefined)?.trim() || undefined, res).finally(() => {
          busy.delete(id)
          turns.delete(turn)
        })
        turns.add(turn)
        return turn
      }
      return send(res, 405, { error: 'method not allowed' })
    }

    const server: Server = createServer((req, res) => {
      handle(req, res).catch(() => {
        if (!res.headersSent) send(res, 500, { error: 'internal error' })
        else res.end()
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port ?? 0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const launchFile = join(config.root, 'villager', 'launch.json')
    await mkdir(join(config.root, 'villager'), { recursive: true, mode: 0o700 })
    await writeFile(launchFile, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 })
    ctx.provide('villager', { port, launchFile })

    ctx.effect(() => async () => {
      await rm(launchFile, { force: true })
      server.close()
      server.closeAllConnections()
      await Promise.allSettled(turns)
    }, 'villager server')
  },
}
