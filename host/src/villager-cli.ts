// npm run villager -- [--agent warm|claude|stub] [--model haiku] [--thinking] [--router-model sonnet] [--maker-model sonnet] [--theme-model sonnet] [--rules-model haiku] [--toy-model sonnet] [--sketch-model sonnet] [--sketch-effort low] [--port 5190] [--root ~/.village] [--home http://localhost:5181/]
// warm (the default, #42) keeps one Claude Code process per person between turns; claude starts one per turn.
// VILLAGER_PEOPLE=alex:Alex,sam:Sam,mia:Mia lists the synthetic people; the default is alex:Alex.
// Each entry may add an age band and a language (alex:Alex:adult:en). VILLAGER_PROFILES=<file.json> sets
// whole profiles ({"alex": {"age": "adult", "language": "en", "style": "...", "humour": "cheeky"}}) and wins.
// This is the development path: the home's own dev server (port 5181) forwards /villager/api here.
// `npm run village` (village.ts) runs the live home and the villagers together.
//
// Pairing (#85, pairing.ts): a device paired once stays paired across restarts. At start, each
// person with no paired device gets a new one-time link, printed only to a terminal (a log file
// would keep it); `npm run village -- link <person>` makes one any time.
//
// The Elder from inside the home (#87): --operators alex (default: the first listed person) may ask it; Keep, Undo
// and Not this happen only on the approval page (approval.ts, approval-server.ts), on its own port:
// [--approval-port <a free one>] [--approval-url https://<mac>.<tailnet>.ts.net:8443/]. [--candidates <root>/candidates]
// [--live ~/.village/live] [--elder-executor claude-code] [--elder-timeout-ms 360000] [--elder-per-hour 6].
// With --agent stub the executor is the stub (src/elder-stubs.ts).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Context } from 'cordis'
import villager, { parsePeopleSpec, type Config } from './villager.ts'
import { checkProfile, type Profile } from './persona.ts'
import { pairLink, type PairingStore } from './pairing.ts'
import { claudeAgent, stubAgent, warmAgent } from './villager-agent.ts'
import { claudeMaker, claudeRouter, stubMaker, stubRouter } from './villager-input.ts'
import { claudeVillagerMaker, stubVillagerMaker } from './villager-make.ts'
import { claudeThemer, stubThemer } from './villager-theme.ts'
import { claudeRuler, stubRuler } from './villager-physics.ts'
import { claudeSketchMaker, stubSketchMaker } from './sketch.ts'
import { core, register } from './elder.ts'
import { elderHome } from './elder-home.ts'
import { stubElder } from './elder-stubs.ts'
import { DEFAULT_LIVE } from './live.ts'
import claudeCode from './plugins/claude-code.ts'
import homeChecks from './plugins/home-checks.ts'

export const villagerOptions = {
  agent: { type: 'string', default: 'warm' },
  model: { type: 'string', default: 'haiku' },
  thinking: { type: 'boolean', default: false },
  'router-model': { type: 'string', default: 'sonnet' },
  'maker-model': { type: 'string', default: 'sonnet' },
  'theme-model': { type: 'string', default: 'sonnet' },
  'rules-model': { type: 'string', default: 'haiku' },
  'toy-model': { type: 'string', default: 'sonnet' },
  'sketch-model': { type: 'string', default: 'sonnet' },
  'sketch-effort': { type: 'string', default: 'low' },
  root: { type: 'string', default: join(homedir(), '.village') },
  operators: { type: 'string' },
  candidates: { type: 'string' },
  'elder-executor': { type: 'string' },
  'elder-timeout-ms': { type: 'string', default: String(6 * 60_000) },
  'elder-per-hour': { type: 'string', default: '6' },
  'approval-port': { type: 'string' },
  'approval-url': { type: 'string' },
} as const

/** The parsed shared options, as parseArgs types them. */
export type Values = ReturnType<typeof parseArgs<{ options: typeof villagerOptions }>>['values']

/** The listed people and their profiles, from VILLAGER_PEOPLE (`fallback` when unset: alex alone) and VILLAGER_PROFILES. Throws a plain message. */
export function listedPeople(fallback: Record<string, string> = { alex: 'Alex' }): { people: Record<string, string>; profiles?: Record<string, Profile> } {
  let people: Record<string, string> = { ...fallback }
  let profiles: Record<string, Profile> | undefined
  try {
    if (process.env.VILLAGER_PEOPLE) ({ people, profiles } = parsePeopleSpec(process.env.VILLAGER_PEOPLE))
  } catch (error) {
    throw new Error(`VILLAGER_PEOPLE: ${(error as Error).message}`)
  }
  try {
    if (process.env.VILLAGER_PROFILES) {
      const file = JSON.parse(readFileSync(process.env.VILLAGER_PROFILES, 'utf8')) as Record<string, unknown>
      profiles = { ...profiles }
      for (const [id, raw] of Object.entries(file)) profiles[id] = checkProfile(raw)
    }
  } catch (error) {
    throw new Error(`VILLAGER_PROFILES: ${(error as Error).message}`)
  }
  return { people, profiles }
}

/** The villager plugin's config from the shared options and the listed people. Throws a plain message on bad input. */
export function villagerConfig(values: Values, port: number, fallback?: Record<string, string>): Config {
  if (values.agent !== 'warm' && values.agent !== 'claude' && values.agent !== 'stub') throw new Error('--agent is warm, claude or stub')
  const { people, profiles } = listedPeople(fallback)
  const stub = values.agent === 'stub'
  return {
    root: values.root,
    port,
    people,
    profiles,
    agent: stub ? stubAgent() : (values.agent === 'warm' ? warmAgent : claudeAgent)({ model: values.model, thinking: values.thinking }),
    router: stub ? stubRouter() : claudeRouter(values['router-model']),
    maker: stub ? stubMaker() : claudeMaker(values['maker-model']),
    villagerMaker: stub ? stubVillagerMaker() : claudeVillagerMaker(values['maker-model']),
    themer: stub ? stubThemer() : claudeThemer(values['theme-model']),
    ruler: stub ? stubRuler() : claudeRuler(values['rules-model'], values['toy-model']),
    sketchMaker: stub ? stubSketchMaker(1500) : claudeSketchMaker(values['sketch-model'], values['sketch-effort'] as 'low' | 'medium' | 'high'),
  }
}

/**
 * Where the Elder copies from and promotes into, and its approval page's port (0: a free one). `liveIsHome`: the page
 * people use is that live home (npm run village), so a kept change appears in it.
 */
export interface ElderPlaces { source: string; live: string; approvalPort: number; liveIsHome?: boolean }

/** The Host values a home is reached at: this Mac's two names for its port, and any other URL it is served under. */
export function homeHosts(port: number, ...urls: (string | undefined)[]) {
  return [...new Set([`localhost:${port}`, `127.0.0.1:${port}`, ...urls.filter((u): u is string => Boolean(u)).map((u) => new URL(u).host)])]
}

/** The approval page's addresses: this Mac's own, and any --approval-url (comma-separated) such as a tailnet name. */
export function approvalUrls(port: number, extra?: string) {
  const urls = [`http://localhost:${port}/`, `http://127.0.0.1:${port}/`]
  for (const raw of (extra ?? '').split(',').map((u) => u.trim()).filter(Boolean)) {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('--approval-url is an http or https address')
    urls.unshift(String(new URL('/', url)))
  }
  return [...new Set(urls)]
}

/**
 * The Elder in the villager host (#87): its registries (the checks always; the stub executor with --agent stub)
 * and the run record under <root>/elder. Operators default to the first listed person. Throws a plain message.
 */
export async function startElder(ctx: Context, values: Values, people: string[], places: ElderPlaces) {
  const operators = (values.operators ?? people[0]).split(',').map((o) => o.trim()).filter(Boolean)
  if (!operators.length || operators.some((o) => !people.includes(o))) throw new Error(`--operators must name listed people (${people.join(', ')})`)
  const perHour = Number(values['elder-per-hour'])
  if (!Number.isInteger(perHour) || perHour < 1 || perHour > 60) throw new Error('--elder-per-hour is a whole number from 1 to 60')
  const executor = values['elder-executor'] ?? (values.agent === 'stub' ? 'stub' : 'claude-code')
  const fibers = [ctx.plugin(core), ctx.plugin(homeChecks), ...(executor === 'claude-code' ? [ctx.plugin(claudeCode)] : [])]
  for (const f of fibers) await f.await()
  if (executor === 'stub') register(ctx, ctx.elder.executors, 'stub', stubElder())
  if (!ctx.elder.executors.has(executor)) throw new Error(`--elder-executor: no executor named ${executor}`)
  const candidatesRoot = values.candidates ?? join(values.root, 'candidates')
  approvalUrls(0, values['approval-url'])
  const elder = await elderHome(values.root, {
    elder: ctx.elder,
    executor,
    source: places.source,
    candidatesRoot,
    live: places.live,
    operators,
    approvalUrls: (port) => approvalUrls(port, values['approval-url']),
    liveIsHome: places.liveIsHome,
    timeoutMs: Number(values['elder-timeout-ms']),
    perHour,
  })
  return {
    elder,
    approvalPort: places.approvalPort,
    describe: (approvalPort: number | null) => `Elder (${executor}) for ${operators.join(', ')}; candidates ${candidatesRoot}, live ${places.live}; approval page http://localhost:${approvalPort}/`,
    dispose: async () => {
      for (const f of fibers.reverse()) await f.dispose()
    },
  }
}


/**
 * Says who is paired on this home (its `hosts`). A person with no device paired here gets a new link, printed only to
 * a terminal; anywhere else (a launchd log) the line names the command instead.
 */
export async function announcePairing(pairing: PairingStore, people: string[], home: string, command: string, hosts: string[]) {
  const status = await pairing.status(hosts)
  for (const person of people) {
    const sessions = status[person]?.sessions ?? 0
    if (sessions) console.log(`${person}: ${sessions} paired device${sessions === 1 ? '' : 's'}`)
    else if (process.stdout.isTTY) console.log(`${person}: ${pairLink(home, await pairing.mint(person, { hosts }))}`)
    else console.log(`${person}: not paired yet; run ${command} link ${person}`)
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { ...villagerOptions, port: { type: 'string', default: '5190' }, home: { type: 'string', default: 'http://localhost:5181/' }, live: { type: 'string', default: DEFAULT_LIVE } } })
  const root = new Context()
  let config: Config
  let elder: Awaited<ReturnType<typeof startElder>>
  try {
    config = villagerConfig(values, Number(values.port))
    elder = await startElder(root, values, Object.keys(config.people!), { source: resolve(import.meta.dirname, '..', '..'), live: values.live, approvalPort: Number(values['approval-port'] ?? 0) })
  } catch (error) {
    console.error((error as Error).message)
    process.exit(2)
  }
  const homeUrl = new URL(values.home)
  const fiber = root.plugin(villager, { ...config, elder: elder.elder, approvalPort: elder.approvalPort, homeHosts: homeHosts(Number(homeUrl.port || 80), values.home) })
  await fiber.await()
  const people = Object.keys(config.people!)
  console.log(elder.describe(root.villager.approvalPort))
  console.log(`villager (${values.agent}${values.agent === 'stub' ? '' : `, ${values.model}`}) for ${people.join(', ')} listening on 127.0.0.1:${root.villager.port}`)
  await announcePairing(root.villager.pairing, people, values.home, 'npm run village --', homeHosts(Number(homeUrl.port || 80), values.home))

  let stopping = false
  // `on`, not `once`: Ctrl+C reaches the whole process group and npm forwards it again, and a second signal must not kill a stop in progress.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      if (stopping) return
      stopping = true
      await fiber.dispose()
      await elder.dispose()
      process.exit(0)
    })
  }
}
