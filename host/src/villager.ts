// The villager service: a loopback-only HTTP API through which a person talks
// to their villager. Every request needs the per-launch token, which is
// written with mode 0600 to <root>/villager/launch.json for the home's dev
// server to hand to the page. Replies stream as server-sent events.
//
// Per person, under <root>/people/<id>/:
//   notes/*.md          the villager's private notes (its only tools)
//   villager.json       the Agent SDK session id to resume, and its running cost
//   conversation.jsonl  what was written on each side of the notebook
//   usage.jsonl         one line per turn: model, tokens, cost, timings
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Context } from 'cordis'
import type { Agent } from './villager-agent.ts'

export interface Config {
  root: string
  agent: Agent
  /** 0 picks a free port. */
  port?: number
  /** Person id to the name the villager uses. Synthetic until isolation is proven. */
  people?: Record<string, string>
  turnTimeoutMs?: number
}

interface SessionState {
  sessionId?: string
  sessionCostUsd?: number
}

const PERSON = /^[a-z][a-z0-9-]{0,31}$/
const MAX_TEXT = 2000

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

    async function converse(id: string, text: string, res: ServerResponse) {
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
        const result = await config.agent({ name: people[id], text, sessionId: state.sessionId, notesDir, personDir: dir, signal: deadline, onText: (t) => event('text', { t }) })
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

    async function handle(req: IncomingMessage, res: ServerResponse) {
      if (!authorized(req)) return send(res, 401, { error: 'token required' })
      const match = /^\/people\/([^/]+)\/(conversation|messages)$/.exec(new URL(req.url ?? '/', 'http://x').pathname)
      if (!match) return send(res, 404, { error: 'not found' })
      const [, id, what] = match
      if (!PERSON.test(id) || !Object.hasOwn(people, id)) return send(res, 404, { error: 'no such person' })
      if (what === 'conversation' && req.method === 'GET') {
        const lines = await readJsonl(join(personDir(id), 'conversation.jsonl'))
        return send(res, 200, { name: people[id], lines: lines.slice(-40) })
      }
      if (what === 'messages' && req.method === 'POST') {
        let text: unknown
        try {
          text = ((await body(req)) as { text?: unknown })?.text
        } catch {
          return send(res, 400, { error: 'expected JSON {"text": "..."}' })
        }
        if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return send(res, 400, { error: `text is 1 to ${MAX_TEXT} characters` })
        if (busy.has(id)) return send(res, 409, { error: 'the villager is still writing' })
        busy.add(id)
        const turn = converse(id, text.trim(), res).finally(() => {
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
