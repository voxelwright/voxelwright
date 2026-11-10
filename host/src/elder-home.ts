// The Elder from inside the home (#87): the villager host's endpoints for asking
// the Elder for a change, following its run, and keeping or undoing it. They are
// all under /people/<id>/elder…, so a person's paired session opens only their own, and a
// visit (/people/<id>/visits/…) never reaches them.
//
//   GET  /people/<id>/elder                         who may ask, the limits, and this person's latest run
//   POST /people/<id>/elder/runs        {text}      start a run (operators only; one at a time; a cap per hour)
//   GET  /people/<id>/elder/runs/<run>              the run: its stages as they go, then passed or failed and why
//   GET  /people/<id>/elder/runs/<run>/before|after the home's picture without and with the change (PNG)
//   POST /people/<id>/elder/runs/<run>/keep    {candidate}  approval.ts decides; promote() puts it in the live home
//   POST /people/<id>/elder/runs/<run>/undo    {promotion}  approval.ts decides; rollback() takes it out
//   POST /people/<id>/elder/runs/<run>/decline {}           "Not this": recorded, nothing changes
//
// `handle` answers the reads and starting a run, on the home and on the approval
// server; `decide` answers the last three, on the approval server only (approval.ts says why).
//
// Authoring (the executor in run.ts), checking (the gates in home-checks.ts) and
// approval (approval.ts) stay separate: this file starts runs and records what
// happened, and calls promote() or rollback() only after approval.ts says yes.
//
// The record, <root>/elder/runs.jsonl, is the host's own: one line per event
// (asked, finished, interrupted, kept, undone, declined, refused). Whether a run's
// change is in the home is not read from it: <live>/promotions.jsonl owns that
// (promote.ts livePromotions), and `kept` / `undone` here are an audit trail. A run that was
// asked but never finished when the host starts again is recorded as interrupted:
// it is never shown as passed, never kept and never run again.
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { approvalOrigins, mayDecline, mayKeep, mayUndo } from './approval.ts'
import type { Elder } from './elder.ts'
import { livePromotions, promote, recoverDeadLock, rollback } from './promote.ts'
import { jsonBody } from './villager.ts'
import { checkTimeoutMs, processTag, tagRunning } from './proc.ts'
import { candidateId, runOnce, type StageEvent } from './run.ts'

export interface ElderHomeConfig {
  /** The Elder's registries: executors and checks. */
  elder: Elder
  executor: string
  /** The checkout a candidate is copied from (its current commit). */
  source: string
  candidatesRoot: string
  live: string
  /** Who may ask the Elder and keep or undo its changes. */
  operators: string[]
  /**
   * The approval page's addresses for the port its server listens on (approval-server.ts): Keep, Undo and Not this
   * must come from their origins. Known once that server listens (`approvalListening`); until then nothing approves.
   */
  approvalUrls: (port: number) => string[]
  /** The live home is the page people use (npm run village): a kept change appears in it. */
  liveIsHome?: boolean
  timeoutMs?: number
  /** Runs started per rolling hour, for the whole host. */
  perHour?: number
}

/** The stages a person sees, in order, with the words they read (the card and the approval page show `label`). */
export const STAGES = [
  { name: 'copy', label: 'Copy the house' },
  { name: 'install', label: 'Gather what it needs' },
  { name: 'before', label: 'Picture it as it is' },
  { name: 'write', label: 'Write the change' },
  { name: 'controller-files', label: 'Leave the house itself alone' },
  { name: 'build', label: 'Build' },
  { name: 'screenshot', label: 'Show in the home' },
  { name: 'plugin-lifecycle', label: 'Leave nothing behind' },
] as const
type StageName = (typeof STAGES)[number]['name']
const LABEL = Object.fromEntries(STAGES.map((s) => [s.name, s.label])) as Record<StageName, string>
/** run.ts's stage names (its events and a failed result's `stage`) as the stage a person sees. */
const STAGE_OF: Record<string, StageName> = { copy: 'copy', install: 'install', inodes: 'install', prepare: 'before', executor: 'write', checks: 'controller-files' }
/** The checks after the write, in order. */
const CHECK_STAGES = ['controller-files', 'build', 'screenshot', 'plugin-lifecycle'] as const
type StageState = 'waiting' | 'now' | 'pass' | 'fail' | 'warn' | 'skipped'
/** A stage of a run; `label` is added when it is shown (view). */
interface Stage { name: StageName; state: StageState; ms?: number; label?: string }

export type RunStatus = 'running' | 'passed' | 'failed' | 'interrupted' | 'kept' | 'undone' | 'declined'
export interface RunView {
  id: string
  person: string
  request: string
  at: string
  status: RunStatus
  stages: Stage[]
  /** Why it failed, in plain words, and a short technical line beside it. */
  reason?: string
  detail?: string
  /** A warning that does not change the status (the in-page lifecycle check). */
  warning?: string
  totalMs?: number
  costUsd?: number | null
  model?: string
  pictures?: boolean
  promotion?: string
  /** What Keep or Undo said, in plain words. */
  said?: string
  /** Where the live home is served, when its server is running. */
  liveUrl?: string | null
  /** The page people use is the live home, so a kept change shows in it. */
  here?: boolean
}

type Event =
  /** `owner`: the host running it (proc.ts processTag), so another host on the same root never marks it interrupted while it runs. */
  | { e: 'asked'; id: string; person: string; request: string; at: string; owner?: string }
  | { e: 'finished'; id: string; at: string; status: 'passed' | 'failed'; stages: Stage[]; reason?: string; detail?: string; warning?: string; totalMs?: number; costUsd?: number | null; model?: string; pictures: boolean }
  | { e: 'interrupted'; id: string; at: string; stages?: Stage[] }
  | { e: 'kept'; id: string; at: string; promotion: string; liveCommit: string; said: string }
  | { e: 'undone'; id: string; at: string; rollback: string; liveCommit: string; said: string }
  | { e: 'declined'; id: string; at: string }
  | { e: 'refused'; id: string; at: string; action: string; reason: string; said: string }
  /** On start: a Keep or Undo whose process died left the live copy locked; it was put back to its last commit. */
  | { e: 'recovered'; at: string; holder: string; discarded: string[] }

const HOUR_MS = 3_600_000
const RUN_ID = /^[\w.-]{1,120}$/
const MAX_REQUEST = 300

/** The person's words as the Elder hears them: one plain line, without "Elder," in front. */
export function elderRequest(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f\s]+/g, ' ')
    .trim()
    .replace(/^(?:(?:hey|ok|okay|dear|please)[ ,]+)?(?:the )?elder\b[ ,:;!.-]*/i, '')
    .replace(/^(?:could you |can you |would you |please )+/i, '')
    .replace(/^(?:ask|tell|get) the elder (?:to )?/i, '')
    .trim()
    .slice(0, MAX_REQUEST)
}

const fresh = (): Stage[] => STAGES.map(({ name }) => ({ name, state: 'waiting' }))
const minutes = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`)
const firstLine = (text: unknown) =>
  String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /error|TS\d{4}/i.test(l)) ?? String(text ?? '').trim().split('\n').at(-1) ?? ''

/** The finished run's stages, reason and pictures, read from its result.json. */
function outcomeOf(result: Record<string, unknown>, live: Stage[], timeoutMs: number, onlyWarns: (check: string) => boolean): Omit<Extract<Event, { e: 'finished' }>, 'e' | 'id' | 'at'> {
  const stages = live.map((s) => ({ ...s }))
  const set = (name: StageName, state: StageState) => {
    const s = stages.find((x) => x.name === name)!
    s.state = state
  }
  const checks = (result.checks ?? {}) as Record<string, string>
  const details = (result.checkDetails ?? {}) as Record<string, { detail?: unknown }>
  const executor = result.executorOutcome as { status?: string; report?: { totalCostUsd?: number | null }; detail?: string } | undefined
  const failedAt = STAGE_OF[String(result.stage)] as StageName | undefined
  // Every stage before the one that stopped it passed; the rest never ran.
  let reached = true
  for (const s of stages) {
    if (failedAt && s.name === failedAt && result.error) {
      s.state = 'fail'
      reached = false
    } else if (!reached) s.state = 'skipped'
    else if (s.state === 'now' || s.state === 'waiting') s.state = 'pass'
  }
  if (executor) set('write', executor.status === 'completed' ? 'pass' : 'fail')
  for (const name of CHECK_STAGES) {
    if (!(name in checks)) continue
    const v = checks[name]
    set(name, v === 'pass' ? 'pass' : v === 'not run' ? 'skipped' : onlyWarns(name) ? 'warn' : 'fail')
  }
  if (!executor && !failedAt) for (const name of ['write', ...CHECK_STAGES] as const) set(name, 'skipped')

  let reason: string | undefined
  let detail: string | undefined
  if (result.error) {
    const where = failedAt ? { copy: 'copying the house to try it', install: "fetching the house's parts", before: 'taking a picture of the home as it is', write: 'starting the Elder' }[failedAt as string] ?? 'trying it' : 'trying it'
    reason = `Something went wrong while ${where}, so nothing was changed.`
    detail = String(result.error)
  } else if (executor && executor.status !== 'completed') {
    reason = executor.status === 'timeout' ? `The Elder ran out of time (${minutes(timeoutMs)}) before it finished.` : 'The Elder stopped before it finished the change.'
    detail = executor.detail
  } else if (checks['controller-files'] === 'fail') {
    const owned = ((details['controller-files']?.detail as { controllerOwned?: string[] } | undefined)?.controllerOwned ?? []).slice(0, 4)
    reason = `The Elder changed files outside the plugins folder${owned.length ? ` (${owned.join(', ')})` : ''}, which it isn't allowed to do.`
  } else if (checks.build === 'fail') {
    const d = details.build?.detail as { output?: string } | string | undefined
    reason = "The change doesn't build, so the home can't run it."
    detail = firstLine(typeof d === 'string' ? d : d?.output)
  } else if (checks.screenshot === 'fail') {
    const d = details.screenshot?.detail as { pageErrors?: unknown[]; changedShare?: number } | string | undefined
    if (typeof d === 'object' && d?.pageErrors?.length) reason = 'The home showed an error with the change in it.'
    else if (typeof d === 'object' && typeof d.changedShare === 'number') reason = "The change didn't show in the picture of the home: nothing looked different."
    else reason = "I couldn't take a picture of the home with the change in it."
    detail = typeof d === 'string' ? d : d?.pageErrors?.length ? String(d.pageErrors[0]) : undefined
  } else if (result.commitSkipped) {
    reason = "The change tried to rewrite the house's saved versions, so I left it out. Nothing in the home changed."
    detail = String(result.commitSkipped)
  } else if (result.status !== 'passed') reason = "The change didn't pass its checks."
  const durations = (result.durations ?? {}) as { totalMs?: number }
  const runDir = typeof result.repo === 'string' ? resolve(result.repo, '..') : undefined
  return {
    status: result.status === 'passed' ? 'passed' : 'failed',
    stages,
    ...(reason ? { reason } : {}),
    ...(detail ? { detail: detail.slice(0, 300) } : {}),
    // In-page checks only warn (run.ts result.warnings). The lifecycle one warns on nearly every change today.
    ...(Array.isArray(result.warnings) && result.warnings.length ? { warning: "I couldn't confirm this change can be switched off again. It passed everything else." } : {}),
    totalMs: durations.totalMs,
    costUsd: executor?.report?.totalCostUsd ?? null,
    model: typeof result.model === 'string' ? result.model : undefined,
    pictures: Boolean(runDir && existsSync(join(runDir, 'base.png')) && existsSync(join(runDir, 'screenshot.png'))),
  }
}

/** Bodies here are a few short fields. */
const MAX_BODY = 4000

type Send = (res: ServerResponse, status: number, value: unknown) => void
export type ElderHome = Awaited<ReturnType<typeof elderHome>>

export async function elderHome(root: string, config: ElderHomeConfig) {
  const dir = join(root, 'elder')
  const file = join(dir, 'runs.jsonl')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const timeoutMs = checkTimeoutMs(config.timeoutMs ?? 6 * 60_000)
  const perHour = config.perHour ?? 6
  const operators = new Set(config.operators)
  let approvalUrls: string[] = []
  /** A check whose failure only warns: in-page evidence (the registry says so), which never decides a run (run.ts). */
  const onlyWarns = (check: string) => Boolean(config.elder.checks?.get(check)?.evidence)
  let origins: string[] = []
  const runs = new Map<string, RunView>()
  /** The process that asked for each run (from its `asked` event). */
  const owners = new Map<string, string>()
  const asked: number[] = []
  /** The one run going now, for the whole host. */
  let current: { id: string; started: number; stageAt: number; done: Promise<void> } | null = null

  const append = async (event: Event) => {
    await appendFile(file, JSON.stringify(event) + '\n', { mode: 0o600 })
    fold(event)
  }
  function fold(event: Event) {
    if (event.e === 'asked') {
      runs.set(event.id, { id: event.id, person: event.person, request: event.request, at: event.at, status: 'running', stages: fresh() })
      if (event.owner) owners.set(event.id, event.owner)
      asked.push(Date.parse(event.at))
      return
    }
    if (event.e === 'recovered') return
    const run = runs.get(event.id)
    if (!run) return
    if (event.e === 'finished') Object.assign(run, { status: event.status, stages: event.stages, reason: event.reason, detail: event.detail, warning: event.warning, totalMs: event.totalMs, costUsd: event.costUsd, model: event.model, pictures: event.pictures })
    else if (event.e === 'interrupted') Object.assign(run, { status: 'interrupted', reason: 'The house stopped while this was being made, so it was never finished or checked. Nothing was changed.', stages: (event.stages ?? run.stages).map((s) => (s.state === 'now' ? { ...s, state: 'fail' } : s.state === 'waiting' ? { ...s, state: 'skipped' } : s)) })
    else if (event.e === 'kept' || event.e === 'undone') run.said = event.said
    else if (event.e === 'declined') run.status = 'declined'
    else if (event.e === 'refused') run.said = event.said
  }

  // Read the record; anything asked and never finished was cut off by a stop.
  const text = existsSync(file) ? await readFile(file, 'utf8') : ''
  // A write cut short leaves a last line with no newline: end it now, so the next event starts a line of its own.
  if (text && !text.endsWith('\n')) await appendFile(file, '\n')
  text.split('\n').forEach((line, i) => {
    if (!line) return
    try {
      fold(JSON.parse(line) as Event)
    } catch {
      console.error(`Elder: line ${i + 1} of ${file} is not an event (a write cut short?); skipped`)
    }
  })
  // A run asked but never finished was cut off by a stop, unless the host running it is still going (two hosts on one root).
  for (const run of runs.values()) if (run.status === 'running' && !tagRunning(owners.get(run.id) ?? '')) await append({ e: 'interrupted', id: run.id, at: new Date().toISOString() })
  // A Keep or Undo cut off by a crash (not a stop: close() waits for those) must not leave every later one live-busy.
  // A failed recovery (another host recovering at the same moment, a git error) leaves the lock: the host still starts.
  const recovered = await recoverDeadLock(config.live).catch((error) => {
    console.error(`Elder: could not recover the live home's promote lock (${(error as Error).message}); Keep and Undo may answer that the home is busy`)
    return null
  })
  if (recovered) await appendFile(file, JSON.stringify({ e: 'recovered', at: new Date().toISOString(), ...recovered } satisfies Event) + '\n', { mode: 0o600 })

  const liveUrl = async () => {
    try {
      const server = JSON.parse(await readFile(join(config.live, 'server.json'), 'utf8')) as { url?: unknown }
      return typeof server.url === 'string' ? server.url : null
    } catch {
      return null
    }
  }
  /** The run as it stands: its record, and kept or undone as the live home's promotions say. Views and verdicts both read this. */
  const resolved = async (run: RunView): Promise<RunView> => {
    const { open, last } = await livePromotions(config.live)
    const promotion = open.get(run.id)
    if (promotion) return { ...run, status: 'kept', promotion }
    if (last.has(run.id)) return { ...run, status: 'undone', promotion: last.get(run.id) }
    return { ...run }
  }
  const view = async (stored: RunView): Promise<RunView> => {
    const run = await resolved(stored)
    const out: RunView = { ...run, stages: run.stages.map((s) => ({ ...s, label: LABEL[s.name] })) }
    if (current?.id === run.id) {
      const now = out.stages.find((s) => s.state === 'now')
      if (now) now.ms = Date.now() - current.stageAt
      out.totalMs = Date.now() - current.started
    }
    if (run.status === 'kept' || run.status === 'undone') {
      out.liveUrl = await liveUrl()
      if (config.liveIsHome) out.here = true
    }
    return out
  }
  const latest = (person: string) => [...runs.values()].filter((r) => r.person === person).at(-1)

  async function start(person: string, request: string): Promise<RunView> {
    const id = candidateId(config.executor)
    const started = Date.now()
    // Taken before any await, so a second ask at the same moment is refused.
    const ticket: NonNullable<typeof current> = { id, started, stageAt: started, done: Promise.resolve() }
    current = ticket
    const onStage = (event: StageEvent) => {
      const run = runs.get(id)
      if (!run) return
      const now = Date.now()
      if ('check' in event) {
        const s = run.stages.find((x) => x.name === event.check)
        if (s) Object.assign(s, { state: event.pass ? 'pass' : onlyWarns(event.check) ? 'warn' : 'fail', ms: now - ticket.stageAt })
        ticket.stageAt = now
        const next = run.stages.find((x) => x.state === 'waiting')
        if (next && (event.pass || onlyWarns(event.check))) next.state = 'now'
        return
      }
      const name = STAGE_OF[event.stage]
      if (!name) return
      const at = run.stages.findIndex((s) => s.name === name)
      for (const s of run.stages.slice(0, at)) if (s.state === 'now') Object.assign(s, { state: 'pass', ms: now - ticket.stageAt })
      run.stages[at].state = 'now'
      ticket.stageAt = now
    }
    try {
      await append({ e: 'asked', id, person, request, at: new Date(started).toISOString(), owner: processTag() })
    } catch (error) {
      current = null
      throw error
    }
    const run = runs.get(id)!
    ticket.done = (async () => {
      try {
        const { result } = await runOnce(config.elder, { request, executor: config.executor, source: config.source, candidatesRoot: config.candidatesRoot, timeoutMs, id, onStage })
        await append({ e: 'finished', id, at: new Date().toISOString(), ...outcomeOf(result, run.stages, timeoutMs, onlyWarns) })
      } catch (error) {
        await append({ e: 'finished', id, at: new Date().toISOString(), status: 'failed', stages: run.stages.map((s) => (s.state === 'now' ? { ...s, state: 'fail' as const } : s.state === 'waiting' ? { ...s, state: 'skipped' as const } : s)), reason: 'Something went wrong while trying it, so nothing was changed.', detail: String((error as Error).message ?? error).slice(0, 300), pictures: false })
      } finally {
        if (current === ticket) current = null
      }
    })().catch(() => {})
    return run
  }

  /**
   * The home's side, /people/<person>/elder…: who may ask, start a run, read a run and its pictures. False when the
   * path is not one of these, so Keep, Undo and Not this are not found here (decide owns them, on the approval
   * server). `person` is the session's own, already checked against the path.
   */
  async function handle(path: string, req: IncomingMessage, res: ServerResponse, person: string, send: Send): Promise<boolean> {
    const m = /^\/people\/[^/]+\/elder(?:\/runs(?:\/([^/]+)(?:\/(before|after))?)?)?$/.exec(path)
    if (!m) return false
    const [, runId, picture] = m
    const operator = operators.has(person)
    const notOperator = () => send(res, 403, { refused: 'not-operator', message: 'Only the people who look after the house can ask the Elder to change it.' })

    if (!runId && !path.endsWith('/runs') && req.method === 'GET') {
      if (!operator) return send(res, 200, { operator: false }), true
      const run = latest(person)
      const hour = asked.filter((t) => Date.now() - t < HOUR_MS).length
      return send(res, 200, { operator: true, busy: Boolean(current), left: Math.max(0, perHour - hour), perHour, timeoutMs, approval: approvalUrls, run: run ? await view(run) : null }), true
    }
    if (!runId && path.endsWith('/runs') && req.method === 'POST') {
      if (!operator) return notOperator(), true
      let b: Record<string, unknown>
      try {
        b = await jsonBody(req, MAX_BODY)
      } catch {
        return send(res, 400, { error: 'expected JSON {"text"}' }), true
      }
      const request = typeof b.text === 'string' ? elderRequest(b.text) : ''
      if (request.length < 3) return send(res, 400, { refused: 'empty', message: 'Tell the Elder what to change, in a few words.' }), true
      if (current) return send(res, 409, { refused: 'busy', message: "The Elder is already making a change. Ask again when it's done." }), true
      const hour = asked.filter((t) => Date.now() - t < HOUR_MS).sort((a, b) => a - b)
      if (hour.length >= perHour) {
        const free = new Date(hour[hour.length - perHour] + HOUR_MS)
        return send(res, 429, { refused: 'hourly', message: `The Elder has made ${perHour} changes in the last hour. Ask again after ${free.toTimeString().slice(0, 5)}.` }), true
      }
      return send(res, 202, { run: await view(await start(person, request)) }), true
    }
    if (!runId || !RUN_ID.test(runId)) return send(res, 404, { error: 'not found' }), true
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' }), true
    if (!operator) return notOperator(), true
    const stored = runs.get(runId)
    // A run is shown only to the person who asked for it.
    if (!stored || stored.person !== person) return send(res, 404, { error: 'no such run' }), true
    if (!picture) return send(res, 200, { run: await view(stored) }), true
    const png = stored.pictures ? await readFile(join(config.candidatesRoot, stored.id, picture === 'before' ? 'base.png' : 'screenshot.png')).catch(() => null) : null
    if (!png) return send(res, 404, { error: 'no picture' }), true
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' })
    res.end(png)
    return true
  }

  /**
   * The approval page's side, POST /people/<person>/elder/runs/<run>/keep|undo|decline. approval.ts decides every part
   * of whether it counts; this looks the run up, hands it over, records the answer and acts on a yes. False when the
   * path is not one of these.
   */
  /** Keep, Undo and Not this being answered now: a stop waits for them (close). */
  const deciding = new Set<Promise<boolean>>()
  let stopping = false
  async function decide(path: string, req: IncomingMessage, res: ServerResponse, person: string, send: Send): Promise<boolean> {
    if (!/^\/people\/[^/]+\/elder\/runs\/[^/]+\/(keep|undo|decline)$/.test(path)) return false
    // The body first: a request whose body never arrives is not a decision in flight, so it cannot hold a stop.
    let b: Record<string, unknown>
    try {
      b = await jsonBody(req, MAX_BODY)
    } catch {
      return send(res, 400, { error: 'expected JSON' }), true
    }
    if (stopping) return send(res, 503, { refused: 'stopping', message: 'The house is stopping. Ask again in a moment.' }), true
    const answering = decideNow(path, b, req, res, person, send)
    deciding.add(answering)
    try {
      return await answering
    } finally {
      deciding.delete(answering)
    }
  }
  async function decideNow(path: string, b: Record<string, unknown>, req: IncomingMessage, res: ServerResponse, person: string, send: Send): Promise<boolean> {
    const m = /^\/people\/[^/]+\/elder\/runs\/([^/]+)\/(keep|undo|decline)$/.exec(path)
    if (!m) return false
    const [, runId, action] = m
    const stored = RUN_ID.test(runId) ? runs.get(runId) : undefined
    const run = stored ? await resolved(stored) : undefined
    const operator = operators.has(person)
    const verdict =
      action === 'keep' ? mayKeep(req, origins, operator, person, run, b.candidate)
      : action === 'undo' ? mayUndo(req, origins, operator, person, run, b.promotion)
      : mayDecline(req, origins, operator, person, run)
    const at = new Date().toISOString()
    // A refusal is recorded under the run when it is this person's.
    const mine = stored && stored.person === person ? stored : undefined
    if (!verdict.ok) {
      if (mine) await append({ e: 'refused', id: mine.id, at, action, reason: verdict.reason, said: verdict.message })
      return send(res, verdict.status, { refused: verdict.reason, message: verdict.message, ...(mine ? { run: await view(mine) } : {}) }), true
    }
    if (action === 'decline') {
      await append({ e: 'declined', id: mine!.id, at })
      return send(res, 200, { run: await view(mine!) }), true
    }
    const outcome = action === 'keep'
      ? await promote({ candidate: mine!.id, approve: true, candidatesRoot: config.candidatesRoot, live: config.live })
      : await rollback({ target: run!.promotion!, live: config.live })
    if (outcome.result === 'refused') {
      // promote.ts's own refusals (changed since its check, live busy or edited by hand, and so on), in its words.
      const said = outcome.message.replace(/"npm run [^"]*"/g, 'the Workshop')
      await append({ e: 'refused', id: mine!.id, at, action, reason: String(outcome.reason), said })
      return send(res, 409, { refused: outcome.reason, message: said, run: await view(mine!) }), true
    }
    if (action === 'keep') {
      const promotion = (outcome.promotion as { id: string }).id
      await append({ e: 'kept', id: mine!.id, at, promotion, liveCommit: String(outcome.liveCommit), said: 'It is in the live home now.' })
    } else {
      await append({ e: 'undone', id: mine!.id, at, rollback: (outcome.rollback as { id: string }).id, liveCommit: String(outcome.liveCommit), said: 'It is out of the live home again; everything it changed is back as it was.' })
    }
    return send(res, 200, { run: await view(mine!) }), true
  }

  return {
    handle,
    decide,
    /** The approval server listens on `port`: its addresses and origins are now the only ones that approve. */
    approvalListening(port: number) {
      approvalUrls = config.approvalUrls(port)
      origins = approvalOrigins(approvalUrls)
    },
    /** For checks: the run going now finishes. */
    settled: () => current?.done ?? Promise.resolve(),
    /**
     * Stop: refuse new Keeps, Undos and Not this (503) and wait for the ones being answered to finish (a promotion is
     * never cut off by a stop). A run still going stops with the process, unfinished in the record, so the next start
     * shows it as interrupted.
     */
    async close() {
      stopping = true
      await Promise.allSettled([...deciding])
    },
  }
}
