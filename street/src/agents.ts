// A door for agents (#118): a resident of the street may be an agent in its own harness (a Claude
// Code or Codex session on its owner's own subscription). It sits down through a standard
// streamable-HTTP MCP server with a key that a resident already here asked for, and gets a body
// like anyone's: it is told what is around it as data, says where to walk, talks, and makes
// things. The world walks its body for it, because an agent thinks in seconds and a step is a
// sixtieth of one. Recipes: .agents/skills/seat-transport (stateless transport, a bare 401, no
// OAuth metadata).
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { Vec3 } from '../../home/src/engine/core.ts'
import type { Seen } from './block.ts'
import { HALF_L, HALF_W, NORMAL, ROAD, TRENCH, heightAt, overTrench, planeAt } from './ground.ts'
import { FRONT } from './houses.ts'
import { standing } from './walk.ts'
import type { Self } from './wire.ts'

/** Something that happened on the street, as a resident who was not looking is told it. */
export interface StreetEvent { seq: number; kind: 'arrived' | 'left' | 'said' | 'made' | 'took-back' | 'wants' | 'solved'; who: string; text?: string; thing?: string }
export interface Outcome { ok: boolean; say: string; toy?: string }

/** What the door asks of the world process behind it. */
export interface Street {
  join(name: string): number
  leave(id: number): void
  rename(id: number, name: string): void
  self(id: number): Self | null
  /** Who on the street wants something now, in their words, and where they stand. */
  wanted(): { who: string; wants: string; at: Vec3 }[]
  seen(): Seen
  drive(id: number, to: { x: number; z: number; jump: boolean } | null): void
  say(id: number, text: string): void
  make(id: number, text: string, yaw: number): Promise<Outcome>
  build(id: number, toy: unknown, yaw: number): Outcome
  unmake(id: number): string | null
  top(id: number): void
  guide(): Promise<string>
  /** Events after `cursor`: at once when there are some, else when one comes or after `ms`. */
  events(cursor: number, ms: number): Promise<StreetEvent[]>
}

interface Walk { to: [number, number]; started: number; checked: number; from: Vec3; stuck: number; done: (how: string) => void }
interface Session { by: string; expires: number; seat?: number; name: string; yaw: number; last: number; walk?: Walk }

const KEY_HOURS = 12
/** A seat nobody has called for this long is given up; the key still works and sits down again. */
const IDLE_MS = 5 * 60_000
const ARRIVED = 0.45
const r1 = (v: number) => Math.round(v * 10) / 10

const ABOUT = [
  `The Block is one block of a hill street in San Francisco, ${HALF_L * 2} m long (z from ${-HALF_L} to ${HALF_L}), sloping down towards +z and the bay. A roadway (x from ${-ROAD} to ${ROAD}) runs between two pavements; a row of eight painted houses stands along each side, their fronts at x = ${-r1(FRONT)} and ${r1(FRONT)}, and striped barriers close each end. Lamps and trees stand on the pavements. Everything is physical: things fall, roll, stack and can be pushed.`,
  `A trench ${TRENCH.depth} m deep crosses the whole street from z = ${r1(TRENCH.from / Math.hypot(1, 0.14))} to z = ${r1(TRENCH.to / Math.hypot(1, 0.14))}: too wide to jump (a resident jumps about 4 m) and too deep to climb out of (they jump 1.1 m high and step up 0.45 m).`,
  'Residents arrive at the top, near z = -26. People and agents share the street; each can say things, and make things appear by describing them. Some residents want something (look lists them under "wanted"): helping one is what there is to do here.',
].join(' ')

export class Agents {
  private sessions = new Map<string, Session>()

  constructor(private street: Street, private log: (line: string) => void = () => {}) {}

  /** A new key, for one agent, asked for by `by`. The key is a secret: hand it to whoever asked and nobody else, and never log it. */
  issue(by: string): { key: string; hours: number } {
    const key = `street_${randomBytes(24).toString('base64url')}`
    this.sessions.set(key, { by, expires: Date.now() + KEY_HOURS * 3600_000, name: '', yaw: 0, last: 0 })
    return { key, hours: KEY_HOURS }
  }

  private sessionFor(req: IncomingMessage): Session | null {
    const given = Buffer.from(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '')
    for (const [key, session] of this.sessions) {
      const want = Buffer.from(key)
      if (given.length === want.length && timingSafeEqual(given, want)) {
        if (Date.now() < session.expires) return session
        this.sessions.delete(key)
      }
    }
    return null
  }

  /** Once a tick: walks each agent towards where it said it was going, and gives up seats nobody uses. */
  tick() {
    const now = performance.now()
    for (const session of this.sessions.values()) {
      if (session.seat === undefined) continue
      if (now - session.last > IDLE_MS && !session.walk) {
        this.log(`${session.name} (an agent) went quiet and left`)
        this.street.leave(session.seat)
        session.seat = undefined
        continue
      }
      const walk = session.walk, self = walk && this.street.self(session.seat)
      if (!walk || !self) continue
      const dx = walk.to[0] - self.p[0], dz = walk.to[1] - self.p[2], d = Math.hypot(dx, dz)
      let jump = false
      if (now - walk.checked > 750) {
        // Not getting anywhere: a hop first (a low thing in the way), then it is blocked.
        if (Math.hypot(self.p[0] - walk.from[0], self.p[2] - walk.from[2]) < 0.25) { walk.stuck++; jump = true } else walk.stuck = 0
        walk.checked = now
        walk.from = self.p
      }
      if (d < ARRIVED) walk.done('arrived')
      else if (walk.stuck >= 3) walk.done('blocked: something is in the way, or the ground ends')
      else if (now - walk.started > 20_000) walk.done('still on the way after 20 s: call walk_to again to keep going')
      else {
        session.yaw = Math.atan2(dx, dz)
        this.street.drive(session.seat, { x: dx / d, z: dz / d, jump })
      }
    }
  }

  /** Where a session's body is, in words an agent can act on. */
  private whereabouts(session: Session) {
    const self = this.street.self(session.seat!)
    if (!self) return null
    const [x, y, z] = self.p, feet = y - standing(NORMAL)
    const where = overTrench(z) && feet < planeAt(z) - 1 ? 'in the trench (too deep to climb out: make stairs or a ramp, or call top)' : feet > heightAt(z) + 0.25 ? 'standing on something' : !self.grounded ? 'in the air' : 'on the road'
    return { name: session.name, at: [r1(x), r1(z)], height: r1(feet), where, facing: [r1(Math.sin(session.yaw)), r1(Math.cos(session.yaw))] }
  }

  private server(session: Session) {
    const street = this.street
    const server = new McpServer({ name: 'the-block', version: '0.1.0' }, { instructions: `${ABOUT} You have a body here. Call arrive with your name first, then look. Positions are [x, z] in metres. Walking takes seconds; look again after you move. Be good company: people are here to play.` })
    const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }], isError })
    const here = <A>(run: (args: A, seat: number) => unknown | Promise<unknown>) => async (args: A) => {
      session.last = performance.now()
      if (session.seat === undefined || !street.self(session.seat)) return text('You are not on the street yet: call arrive with your name first.', true)
      try { return text(await run(args, session.seat)) } catch (e) { return text(e instanceof Error ? e.message : String(e), true) }
    }
    const stopWalking = (how: string) => { session.walk?.done(how) }

    server.registerTool('arrive', {
      description: 'Sit down on the street as a resident with this name. Call it first. Calling it again renames you.',
      inputSchema: { name: z.string().min(1).max(24).describe('What others read over your head') },
    }, async ({ name }) => {
      session.last = performance.now()
      const clean = name.replace(/[\u0000-\u001f\u007f<>]+/g, ' ').trim().slice(0, 24) || 'An agent'
      if (session.seat !== undefined && street.self(session.seat)) street.rename(session.seat, clean)
      else {
        session.seat = street.join(clean)
        session.yaw = 0
        // An agent's seat is always walked by the world: standing still until told where to go.
        street.drive(session.seat, { x: 0, z: 0, jump: false })
        this.log(`${clean} (an agent of ${session.by}) sat down`)
      }
      session.name = clean
      return text({ about: ABOUT, you: this.whereabouts(session), next: 'Call look to see who and what is here.' })
    })

    server.registerTool('look', {
      description: 'What is around you: where you are, who is here, what things are on the street, and the last things said. Call it after you move or wait.',
      inputSchema: {},
    }, here(async (_: Record<string, never>, seat) => {
      const seen = street.seen(), me = street.self(seat)!, away = (at: Vec3) => r1(Math.hypot(at[0] - me.p[0], at[2] - me.p[2]))
      return {
        you: this.whereabouts(session),
        residents: seen.residents.filter((r) => r.id !== seat).map((r) => ({ name: r.name, at: [r1(r.at[0]), r1(r.at[2])], away: away(r.at) })),
        things: seen.things.map((t) => ({ id: t.id, what: t.what, askedFor: t.askedFor, by: t.by, at: [r1(t.at[0]), r1(t.at[2])], height: r1(t.at[1] - planeAt(t.at[2])), size: t.size, material: t.material, moves: t.moves, away: away(t.at) })),
        loose: `${seen.loose.crates} wooden crates stacked in walls across the upper street and ${seen.loose.balls} rubber balls rolling down it`,
        // Who wants something now. The world itself tells when they have it, and says so in `observe` (kind "solved").
        wanted: street.wanted().map((w) => ({ who: w.who, wants: w.wants, at: [r1(w.at[0]), r1(w.at[2])], away: away(w.at) })),
        // What nobody made, nearest first: houses are given at the middle of their fronts.
        street: seen.still.map((s) => ({ what: s.what, at: [r1(s.at[0]), r1(s.at[2])], away: away(s.at) })).sort((a, b) => a.away - b.away),
        heard: (await street.events(-1, 0)).filter((e) => e.kind === 'said').slice(-6).map((e) => `${e.who}: ${e.text}`),
      }
    }))

    server.registerTool('walk_to', {
      description: 'Walk to a point on the street. Returns when you arrive, are blocked, or after 20 s. You walk at 4.5 m/s in a straight line, step onto things up to 0.45 m high, and fall into the trench if you walk over it without a bridge.',
      inputSchema: { x: z.number().min(-HALF_W).max(HALF_W), z: z.number().min(-HALF_L).max(HALF_L) },
    }, here(({ x, z: toZ }: { x: number; z: number }, seat) => new Promise((resolve) => {
      stopWalking('interrupted by a new walk_to')
      const now = performance.now(), self = street.self(seat)!
      session.walk = { to: [x, toZ], started: now, checked: now, from: self.p, stuck: 0, done: (how) => {
        session.walk = undefined
        street.drive(seat, { x: 0, z: 0, jump: false })
        resolve({ result: how, you: this.whereabouts(session) })
      } }
    })))

    server.registerTool('face', {
      description: 'Turn to face a point. What you make appears on the ground about 4.5 m in front of where you face.',
      inputSchema: { x: z.number(), z: z.number() },
    }, here(({ x, z: toZ }: { x: number; z: number }, seat) => {
      const self = street.self(seat)!
      session.yaw = Math.atan2(x - self.p[0], toZ - self.p[2])
      return { you: this.whereabouts(session) }
    }))

    server.registerTool('say', {
      description: 'Say something out loud: everyone on the street reads it over your head.',
      inputSchema: { text: z.string().min(1).max(200) },
    }, here(({ text: words }: { text: string }, seat) => { street.say(seat, words); return 'said' }))

    server.registerTool('make', {
      description: 'Ask the street\'s own maker for a thing, from one sentence ("a plank bridge across the trench", "a big red dog"). It appears in front of you after 10 to 30 s. Prefer build when you can design the thing yourself.',
      inputSchema: { text: z.string().min(2).max(200) },
    }, here(({ text: words }: { text: string }, seat) => street.make(seat, words, session.yaw)))

    server.registerTool('guide', {
      description: 'How to write a thing yourself for build: the format, the materials, the sizes and the frame it stands in. Read it once before your first build.',
      inputSchema: {},
    }, here(() => street.guide()))

    server.registerTool('build', {
      description: 'Put a thing you designed yourself on the ground in front of you, at once. `toy` is the "toy" object the guide describes: {"label", "parts": [...], "gadgets": [], "wires": []}. It is checked, and must come to rest when dropped; a refusal says why.',
      inputSchema: { toy: z.record(z.string(), z.unknown()).describe('The toy, as the guide describes it'), say: z.string().max(120).optional().describe('A few words about it, said for you') },
    }, here(({ toy, say }: { toy: Record<string, unknown>; say?: string }, seat) => street.build(seat, { say: say ?? '', toy }, session.yaw)))

    server.registerTool('undo', {
      description: 'Take back the last thing you made or built that is still here.',
      inputSchema: {},
    }, here((_: Record<string, never>, seat) => ({ removed: street.unmake(seat) })))

    server.registerTool('top', {
      description: 'Go back to where residents arrive, at the top of the street (the way out of the trench when all else fails).',
      inputSchema: {},
    }, here((_: Record<string, never>, seat) => { stopWalking('interrupted by top'); street.top(seat); return { you: this.whereabouts(session) } }))

    server.registerTool('observe', {
      description: 'Wait up to 20 s for something to happen on the street (someone arrives, speaks, makes a thing) after event number `cursor`, and return what did. Start with cursor 0, then pass the last seq you were given.',
      inputSchema: { cursor: z.number().int().min(0).default(0) },
    }, here(async ({ cursor }: { cursor: number }) => {
      const events = await street.events(cursor, 20_000)
      session.last = performance.now()
      return { events, cursor: events.at(-1)?.seq ?? cursor }
    }))
    return server
  }

  /** Serves /mcp. A request without a live key gets a bare 401, so a harness never starts an OAuth flow. */
  async handle(req: IncomingMessage, res: ServerResponse) {
    const session = this.sessionFor(req)
    if (!session) { res.writeHead(401, { 'content-type': 'text/plain' }).end('unknown or expired key'); return }
    let body: unknown
    if (req.method === 'POST') {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += (chunk as Buffer).length
        if (size > 512_000) { res.writeHead(413).end(); return }
        chunks.push(chunk as Buffer)
      }
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { res.writeHead(400).end(); return }
    }
    // Stateless: a fresh server and transport for each request; what lasts is the session behind the key.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    const server = this.server(session)
    res.on('close', () => { void transport.close(); void server.close() })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  }
}
