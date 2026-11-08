// The villager service: a loopback-only HTTP API through which a person talks
// to their villager. Each launch gives every person their own token, which
// opens only that person's paths, /people/<id>/…; any other person's answer 403.
// Talking with someone else's villager is a visit, at /people/<id>/visits/<owner>/,
// kept under the visitor and shown only the owner's persona. The tokens are written with mode
// 0600 to <root>/villager/launch.json, and the CLI prints each person's link
// (the token rides in the URL fragment). Replies stream as server-sent events.
//
// Per person, under <root>/people/<id>/:
//   notes/*.md          the villager's private notes (its only tools)
//   villager.json       the Agent SDK session id to resume, and its running cost
//   persona.json        who the villager is (#42), written by a villager generator; checked, never trusted as rules
//   preferences.json    what the person said they want (the humour dial), written by host code from their own words
//   conversation.jsonl  what each side said (the person's own lines only, never context)
//   usage.jsonl         one line per turn: model, tokens, cost, timings
//   routes.jsonl        the separate router (#42, ?route=separate): each line routed, the checked route, timings
//   library/<item>.json props made for them: module text (never run here) and metadata
//   projects.jsonl      things too big for the fast path, recorded as "being made"
//   visits/<owner>/     this person's talks with another person's villager (#42): its own conversation,
//                       usage, session and notes. A visit reads only the owner's persona.json, and
//                       writes the visitor's own preferences.json and sketches.jsonl as on any turn.
//
// The house is shared: <root>/house/plans/ holds its plan versions (plans.ts),
// served at /house/plans to any person's own token. A version may newly place
// only the caller's own kept library items (plans.ts checkKept).
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Context } from 'cordis'
import { planStore } from './plans.ts'
import type { Agent } from './villager-agent.ts'
import { checkRouted, cleanName, ROUTE_PREFIX, routeInReply, type Maker, type Router, type RouteAsk, type Routed } from './villager-input.ts'
import { checkProfile, humourOf, humourWords, loadCharacter, loadVisitCharacter, writePreferences, type AgeBand, type Humour, type Profile } from './persona.ts'
import { loadSketch, noteSketch, SKETCH, sketchRoute, type SketchImage, type SketchMaker } from './sketch.ts'

export interface Config {
  root: string
  agent: Agent
  /** 0 picks a free port. */
  port?: number
  /** Person id to the name the villager uses. Synthetic until isolation is proven. */
  people?: Record<string, string>
  /** Person id to their profile (#42): trusted operator data the villager reads and never writes. A missing one is age "unknown". */
  profiles?: Record<string, Profile>
  turnTimeoutMs?: number
  /** The always-on input's router and prop maker (#42). Without them those endpoints answer 503. */
  router?: Router
  maker?: Maker
  /** Sketching (#42, sketch.ts): a drawing to a prop module. Without it a sketch on /props answers 503. */
  sketchMaker?: SketchMaker
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
  return parsePeopleSpec(spec).people
}

/** The same list with each person's profile: `alex:Alex:adult:en`, where the age band and language are optional. */
export function parsePeopleSpec(spec: string): { people: Record<string, string>; profiles: Record<string, Profile> } {
  const people: Record<string, string> = {}
  const profiles: Record<string, Profile> = {}
  for (const entry of spec.split(',').map((e) => e.trim()).filter(Boolean)) {
    const [id, name = '', age, language, ...rest] = entry.split(':').map((p) => p.trim())
    if (!PERSON.test(id) || !name || name.length > 40 || rest.length) throw new Error(`"${entry}" is not id:Name[:age[:language]] with a lowercase id`)
    if (Object.hasOwn(people, id)) throw new Error(`"${id}" is listed twice`)
    people[id] = name
    try {
      profiles[id] = checkProfile({ age: (age || 'unknown') as AgeBand, ...(language ? { language } : {}) })
    } catch (error) {
      throw new Error(`"${entry}": ${(error as Error).message}`)
    }
  }
  if (!Object.keys(people).length) throw new Error('no people listed')
  return { people, profiles }
}

declare module 'cordis' {
  interface Context {
    villager: { port: number; launchFile: string; tokens: Record<string, string> }
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

type Cast = { id: string; name: string; role: string }[]
/** The page's cast for routing: villagers of listed people with plain names, at most 8. Null when any entry is not. */
function castOf(villagers: unknown, people: Record<string, string>): Cast | null {
  const cast = Array.isArray(villagers) ? villagers.slice(0, 8) : []
  const known = cast.filter((v): v is Cast[number] =>
    v && typeof v === 'object' && typeof v.id === 'string' && Object.hasOwn(people, v.id) && typeof v.name === 'string' && VILLAGER_NAME.test(v.name) && typeof v.role === 'string' && VILLAGER_NAME.test(v.role))
  return known.length && known.length === cast.length ? known : null
}

const DAY_MS = 86_400_000

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
    const tokens = Object.fromEntries(Object.keys(people).map((id) => [id, randomBytes(32).toString('hex')]))
    const busy = new Set<string>()
    const turns = new Set<Promise<unknown>>()
    const personDir = (id: string) => join(config.root, 'people', id)
    // The library is this service's: a placed item must belong to a listed person and be kept (unparseable counts as not kept).
    const plans = planStore(config.root, async (person, item) => Object.hasOwn(people, person) && (await readItem(person, item).catch(() => null))?.kept === true)

    /** The person whose token the request carries, or undefined. */
    const holder = (req: IncomingMessage) => {
      const given = Buffer.from(req.headers.authorization ?? '')
      return Object.keys(tokens).find((id) => {
        const expected = Buffer.from(`Bearer ${tokens[id]}`)
        return given.length === expected.length && timingSafeEqual(given, expected)
      })
    }
    const send = (res: ServerResponse, status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }

    const profileOf = (id: string): Profile => config.profiles?.[id] ?? { age: 'unknown' }
    /** Who the villager is and who it is talking to, from trusted files and config; the humour ceiling never comes from a reply. */
    const characterOf = (id: string) => loadCharacter(id, personDir(id), profileOf(id))
    /** A visit (#42): `visitor` talking with `owner`'s villager. Everything it writes is the visitor's, under their folder. */
    const visitDir = (visitor: string, owner: string) => join(personDir(visitor), 'visits', owner)
    const visitCharacterOf = (visitor: string, owner: string) =>
      loadVisitCharacter({ person: visitor, personDir: personDir(visitor), profile: profileOf(visitor) }, { person: owner, personDir: personDir(owner), name: people[owner] }, visitDir(visitor, owner))

    /** A turn with `id`'s villager. With `visitor`, it is their visit: the turn reads and writes only under the visitor. */
    async function converse(id: string, text: string, context: string | undefined, route: Omit<RouteAsk, 'text' | 'signal'> | undefined, res: ServerResponse, sketch?: { from: string; id: string; image: SketchImage }, visitor?: string) {
      const talker = visitor ?? id
      const dir = visitor ? visitDir(visitor, id) : personDir(id)
      const notesDir = join(dir, 'notes')
      await mkdir(notesDir, { recursive: true, mode: 0o700 })
      const stateFile = join(dir, 'villager.json')
      const state = await readJson<SessionState>(stateFile, {})
      // The humour dial (#42): words in a direct talk can only turn it down. The host cannot tell who is
      // typing at a shared screen, so crude comes only from the operator's profile (Sentinel, #42).
      const asked = context === undefined ? humourWords(text) : null
      if (asked === 'clean') await writePreferences(personDir(talker), { humour: 'clean', at: new Date().toISOString() })
      const { character, personaRefused } = visitor ? await visitCharacterOf(visitor, id) : await characterOf(id)
      // At the table, crude only if everyone listed has crude on their own; otherwise cheeky for that turn.
      // Each other person's level comes from their profile, preferences and persona only, never their notes.
      let humourCap: Humour | undefined
      if (context !== undefined && character.humour === 'crude') {
        const others = await Promise.all(Object.keys(people).filter((p) => p !== id).map((p) => humourOf(p, personDir(p), profileOf(p))))
        if (others.some((h) => h !== 'crude')) humourCap = 'cheeky'
      }
      const at = new Date().toISOString()
      // A drawing handed over is kept as a reference beside the person's line, never its bytes.
      await appendJsonl(join(dir, 'conversation.jsonl'), { at, from: 'person', text, ...(sketch ? { sketch: { from: sketch.from, id: sketch.id } } : {}) })

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.flushHeaders()
      const event = (name: string, data: unknown) => {
        if (!res.writableEnded && !res.destroyed) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
      }
      // The turn finishes and is recorded even if the page goes away mid-reply.
      const deadline = AbortSignal.timeout(config.turnTimeoutMs ?? 180_000)
      const started = Date.now()
      // A line that may be routed (#42): the first words decide. A reply starting with ROUTE is
      // held back and read as a route, never shown as words; anything else streams as usual.
      const ids = route?.villagers.map((v) => v.id) ?? []
      const items = route?.library.map((l) => l.id) ?? []
      let held = route ? '' : null
      let routed: { routed: Routed } | { reason: string } | null = null
      const onText = (t: string) => {
        if (held === null) return event('text', { t })
        held += t
        const head = held.trimStart()
        if (head.length < ROUTE_PREFIX.length && ROUTE_PREFIX.startsWith(head)) return
        if (!head.startsWith(ROUTE_PREFIX)) {
          event('text', { t: held })
          held = null
          return
        }
        // Act on the route as soon as its JSON is whole, before the turn's result.
        if (!routed && head.includes('}')) {
          const read = routeInReply(head, ids, items)
          if (read && 'routed' in read) {
            routed = read
            event('route', { routed: read.routed, ms: Date.now() - started })
          }
        }
      }
      try {
        const result = await config.agent({ name: people[talker], text, context, route, character, humourCap, ...(sketch ? { image: sketch.image } : {}), sessionId: state.sessionId, notesDir, personDir: dir, signal: deadline, onText })
        const totalMs = Date.now() - started
        if (held !== null && !routed) {
          routed = routeInReply(held, ids, items)
          // A reply too short to decide on is words after all.
          if (!routed && held) event('text', { t: held })
        }
        const previous = result.sessionId === state.sessionId ? state.sessionCostUsd ?? 0 : 0
        const costUsd = result.sessionCostUsd === null ? null : Math.max(0, result.sessionCostUsd - previous)
        await writeFile(stateFile, JSON.stringify({ sessionId: result.sessionId, sessionCostUsd: result.sessionCostUsd ?? state.sessionCostUsd } satisfies SessionState), { mode: 0o600 })
        const r = routed as { routed: Routed } | { reason: string } | null
        // A routed line is stored with the route's spoken line, never the JSON; a refused route is not acted on.
        const said = r && 'routed' in r ? r.routed.say ?? `(${r.routed.route})` : r ? '' : result.reply
        await appendJsonl(join(dir, 'conversation.jsonl'), { at: new Date().toISOString(), from: 'villager', ...(r && 'reason' in r ? { unanswered: true } : { text: said }), ...(r && 'routed' in r ? { route: r.routed.route } : {}) })
        await appendJsonl(join(dir, 'usage.jsonl'), { at, models: result.models, usage: result.usage, costUsd, sessionCostUsd: result.sessionCostUsd, ttftMs: result.ttftMs, totalMs, sessionId: result.sessionId, resumed: Boolean(state.sessionId), villager: character.persona.name, age: character.profile.age, humour: humourCap ?? character.humour, ...(visitor ? { visiting: id } : {}), ...(personaRefused ? { personaRefused } : {}), ...(route ? { route: r ? ('routed' in r ? r.routed.route : `refused: ${r.reason}`) : 'answer' } : {}) })
        if (r && 'reason' in r) event('failed', { reason: 'route' })
        else event('done', { reply: said, ttftMs: result.ttftMs, totalMs, ...(r ? { routed: r.routed } : {}) })
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
    const routing = new Set<string>()
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
        const known = castOf(villagers, people)
        if (!known) return send(res, 400, { error: 'villagers are {id, name, role} for listed people' })
        // One route at a time per person: each call starts a billed model process (Sentinel, #42).
        if (routing.has(id)) return send(res, 409, { error: 'already routing a line' })
        routing.add(id)
        const started = Date.now()
        const at = new Date().toISOString()
        let library: LibraryItem[] = []
        try {
          await mkdir(dir, { recursive: true, mode: 0o700 })
          library = await listLibrary(id)
          const call = await config.router({ name: people[id], primary, text: text.trim(), villagers: known, library: library.map((l) => ({ id: l.id, name: l.name })), signal: AbortSignal.timeout(30_000) })
          const ms = Date.now() - started
          const checked = checkRouted(call.raw, known.map((v) => v.id), library.map((l) => l.id))
          await appendJsonl(join(dir, 'routes.jsonl'), { at, text: text.trim(), ...('routed' in checked ? { routed: checked.routed } : { refused: checked.reason }), ms, models: call.models, costUsd: call.costUsd, outputTokens: call.outputTokens })
          if ('reason' in checked) return send(res, 422, { error: checked.reason, ms })
          return send(res, 200, { routed: checked.routed, ms, models: call.models, costUsd: call.costUsd })
        } catch (error) {
          await appendJsonl(join(dir, 'routes.jsonl'), { at, text: text.trim(), failed: String((error as Error).message ?? error).slice(0, 300), ms: Date.now() - started }).catch(() => {})
          return send(res, 422, { error: 'the router failed', ms: Date.now() - started })
        } finally {
          routing.delete(id)
        }
      }
      if (what === 'props' && req.method === 'POST') {
        if (!config.maker) return send(res, 503, { error: 'no maker' })
        let b: { what?: unknown; size?: unknown; variant?: unknown; sketch?: unknown }
        try {
          b = ((await body(req)) ?? {}) as typeof b
        } catch {
          return send(res, 400, { error: 'expected JSON {"what", "size"?, "variant"?, "sketch"?}' })
        }
        // Sketching (#42): "sketch" names one of this person's own drawings; a vision maker reads it.
        let image: SketchImage | null = null
        if (b.sketch !== undefined) {
          if (typeof b.sketch !== 'string' || !SKETCH.test(b.sketch)) return send(res, 400, { error: 'sketch is a sketch id' })
          if (!config.sketchMaker) return send(res, 503, { error: 'no sketch maker' })
          image = await loadSketch(dir, b.sketch)
          if (!image) return send(res, 404, { error: 'no such sketch' })
        }
        if (typeof b.what !== 'string' || !b.what.trim() || b.what.length > 200) return send(res, 400, { error: 'what is 1 to 200 characters' })
        const size = Array.isArray(b.size) && b.size.length === 3 && b.size.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 4) ? b.size as [number, number, number] : undefined
        if (b.size !== undefined && !size) return send(res, 400, { error: 'size is three numbers in metres, each at most 4' })
        const variant = Number.isInteger(b.variant) && (b.variant as number) >= 0 && (b.variant as number) < 10 ? b.variant as number : 0
        if (making.has(id)) return send(res, 409, { error: 'already making something' })
        making.add(id)
        const started = Date.now()
        try {
          const made = image
            ? await config.sketchMaker!({ what: b.what.trim(), words: b.what.trim(), image, size, variant, signal: AbortSignal.timeout(120_000) })
            : await config.maker({ what: b.what.trim(), size, variant, signal: AbortSignal.timeout(90_000) })
          const ms = Date.now() - started
          if (typeof made.module !== 'string' || !made.module.trim() || made.module.length > MAX_MODULE) return send(res, 422, { error: 'the maker returned no usable module', ms })
          // Stored as text for the home's sandbox; never imported, evaluated or run by the host.
          const entry: LibraryItem = { id: randomBytes(6).toString('hex'), name: cleanName(image ? made.name || b.what : b.what), module: made.module, size, models: made.models, costUsd: made.costUsd, ms, at: new Date().toISOString(), kept: false }
          if (image) await noteSketch(dir, { id: b.sketch as string, made: entry.id })
          await mkdir(libraryDir(id), { recursive: true, mode: 0o700 })
          await writeFile(join(libraryDir(id), `${entry.id}.json`), JSON.stringify(entry), { mode: 0o600 })
          await pruneDrafts(id, entry.id)
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

    const itemIds = async (id: string) => (await readdir(libraryDir(id)).catch(() => [] as string[])).filter((f) => f.endsWith('.json') && ITEM.test(f.slice(0, -5))).map((f) => f.slice(0, -5))
    /** Kept items, newest first. Drafts (made but not kept) are not offered, and are pruned after a day. */
    async function listLibrary(id: string): Promise<LibraryItem[]> {
      const items = await Promise.all((await itemIds(id)).map((item) => readItem(id, item)))
      return items.filter((i): i is LibraryItem => Boolean(i?.kept)).sort((a, b) => b.at.localeCompare(a.at))
    }
    /** Unkept drafts older than a day go when a new one is written (Sentinel, #42), so listing never reads a pile of them. */
    async function pruneDrafts(id: string, keep: string) {
      for (const item of await itemIds(id)) {
        if (item === keep) continue
        const old = await readItem(id, item).catch(() => null)
        if (old && !old.kept && Date.now() - Date.parse(old.at) > DAY_MS) await rm(join(libraryDir(id), `${item}.json`), { force: true })
      }
    }

    async function handle(req: IncomingMessage, res: ServerResponse) {
      const person = holder(req)
      if (!person) return send(res, 401, { error: 'token required' })
      const path = new URL(req.url ?? '/', 'http://x').pathname
      const plansMatch = /^\/house\/plans(?:\/(versions|head|names))?$/.exec(path)
      // The house is the household's: any person's own token opens it (#48); what a version may newly place is the caller's own.
      if (plansMatch) return plans(plansMatch[1] as 'versions' | 'head' | 'names' | undefined, req, res, person)
      // Every route below is /people/<id>/…, and a token opens its own person's and no other (#40).
      // A visit (#42) is explicit and under the visitor: /people/<me>/visits/<owner>/(conversation|messages).
      const first = /^\/people\/([^/]+)\//.exec(path)?.[1]
      if (first === undefined) return send(res, 404, { error: 'not found' })
      if (first !== person) return send(res, 403, { error: 'this token is for another person' })
      const visitMatch = /^\/people\/[^/]+\/visits\/([^/]+)\/(conversation|messages)$/.exec(path)
      if (visitMatch && (visitMatch[1] === person || !PERSON.test(visitMatch[1]) || !Object.hasOwn(people, visitMatch[1]))) return send(res, 404, { error: 'no such villager' })
      const visitor = visitMatch ? person : undefined
      // Sketching (#42, sketch.ts): a person's own drawings.
      const sketchMatch = /^\/people\/([^/]+)\/sketches(?:\/([^/]+))?$/.exec(path)
      if (sketchMatch) {
        const [, id, sid] = sketchMatch
        await mkdir(personDir(id), { recursive: true, mode: 0o700 })
        return sketchRoute(personDir(id), sid, req, res, send)
      }
      const inputMatch = /^\/people\/([^/]+)\/(?:(route|props|projects|library)|library\/([^/]+)(\/keep)?)$/.exec(path)
      if (inputMatch) {
        const [, id, plain, item, keep] = inputMatch
        if (item !== undefined && !ITEM.test(item)) return send(res, 404, { error: 'no such item' })
        return input(id, plain ?? (keep ? 'keep' : 'library'), item, req, res)
      }
      const own = /^\/people\/([^/]+)\/(conversation|messages)$/.exec(path)
      if (!own && !visitMatch) return send(res, 404, { error: 'not found' })
      // On a visit, `id` is the visited villager's person; everything is read and written under `visitor`.
      const [id, what] = visitMatch ? [visitMatch[1], visitMatch[2]] : [own![1], own![2]]
      if (what === 'conversation' && req.method === 'GET') {
        const lines = await readJsonl(join(visitor ? visitDir(visitor, id) : personDir(id), 'conversation.jsonl'))
        return send(res, 200, { name: people[id], lines: lines.slice(-40) })
      }
      if (what === 'messages' && req.method === 'POST') {
        let text: unknown, context: unknown, route: unknown, sketchRef: unknown
        try {
          ({ text, context, route, sketch: sketchRef } = ((await body(req)) ?? {}) as { text?: unknown; context?: unknown; route?: unknown; sketch?: unknown })
        } catch {
          return send(res, 400, { error: 'expected JSON {"text": "...", "context"?: "...", "route"?: {"primary", "villagers"}}' })
        }
        if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return send(res, 400, { error: `text is 1 to ${MAX_TEXT} characters` })
        // Context (what others at the table said) reaches the villager's turn but is never stored as the person's line.
        if (context !== undefined && (typeof context !== 'string' || context.length > MAX_TEXT)) return send(res, 400, { error: `context is a string of at most ${MAX_TEXT} characters` })
        // The always-on input (#42): the line may be routed in the villager's own reply.
        let ask: Omit<RouteAsk, 'text' | 'signal'> | undefined
        if (route !== undefined) {
          // Only your own villager routes your line; a visit is a conversation and nothing more.
          if (visitor) return send(res, 400, { error: 'a visit is never routed' })
          const { primary, villagers } = (route ?? {}) as { primary?: unknown; villagers?: unknown }
          const known = castOf(villagers, people)
          if (typeof primary !== 'string' || !VILLAGER_NAME.test(primary) || !known) return send(res, 400, { error: 'route is {"primary": a villager name, "villagers": [{id, name, role}] of listed people}' })
          ask = { name: people[id], primary, villagers: known, library: [] }
        }
        // Sketching (#42): a drawing handed over, by its drawer's id and the sketch's. It never comes with a route,
        // so nothing drawn on it can steer who hears what.
        let sketch: { from: string; id: string; image: SketchImage } | undefined
        if (sketchRef !== undefined) {
          const { from, id: sid } = (sketchRef ?? {}) as { from?: unknown; id?: unknown }
          if (route !== undefined) return send(res, 400, { error: 'a drawing is never routed' })
          if (typeof from !== 'string' || typeof sid !== 'string' || !SKETCH.test(sid)) return send(res, 400, { error: 'sketch is {"from": your own id, "id": a sketch id}' })
          // Only the token holder's own drawing (#40): another person's sketches are theirs to hand over.
          if (from !== person) return send(res, 403, { error: 'this token is for another person' })
          const image = await loadSketch(personDir(from), sid)
          if (!image) return send(res, 404, { error: 'no such sketch' })
          sketch = { from, id: sid, image: { ...image, by: people[from] } }
        }
        // One turn at a time per conversation: your own, or each of your visits (so a visit never blocks the owner).
        const conversationKey = visitor ? `${visitor}>${id}` : id
        if (busy.has(conversationKey)) return send(res, 409, { error: 'the villager is still writing' })
        busy.add(conversationKey)
        const turn = (async () => {
          if (ask) ask.library = (await listLibrary(id)).map((l) => ({ id: l.id, name: cleanName(l.name) }))
          if (sketch) await noteSketch(personDir(sketch.from), { id: sketch.id, given: id })
          return converse(id, (text as string).trim(), (context as string | undefined)?.trim() || undefined, ask, res, sketch, visitor)
        })().finally(() => {
          busy.delete(conversationKey)
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
    await writeFile(launchFile, JSON.stringify({ port, tokens, pid: process.pid }), { mode: 0o600 })
    ctx.provide('villager', { port, launchFile, tokens })
    // Warm agents start each listed person's process now, so their first line skips the start-up.
    if (config.agent.warm) for (const id of Object.keys(people)) {
      const dir = personDir(id)
      await mkdir(join(dir, 'notes'), { recursive: true, mode: 0o700 })
      const { sessionId } = await readJson<SessionState>(join(dir, 'villager.json'), {})
      config.agent.warm({ name: people[id], notesDir: join(dir, 'notes'), personDir: dir, sessionId, character: (await characterOf(id)).character })
    }

    ctx.effect(() => async () => {
      await rm(launchFile, { force: true })
      server.close()
      server.closeAllConnections()
      await Promise.allSettled(turns)
      config.agent.close?.()
    }, 'villager server')
  },
}
