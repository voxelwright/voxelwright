// Where a villager turn's time goes (#42). Real model calls on the operator's login.
// node test/turn-bench.ts <config>... > out.json
//   configs: before default, and cold-*/warm-* variants (see RUNS)
// Each config runs 8 turns in one session and records, from the moment the turn
// is asked: the init event (process start), the first stream event, the first
// text, the result, thinking blocks seen, tool calls and every model used.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { NOTE_TOOLS, notesServer, systemPrompt } from '../src/villager-agent.ts'
import { allowedEnv } from '../src/proc.ts'

const LINES = [
  'I keep forgetting to water the plants',
  'what should we cook tonight?',
  "I'm a bit tired today",
  'do you remember what I said about the plants?',
  'any idea for a rainy Saturday?',
  'tell me something nice',
  'should I tidy the toy shelf now or later?',
  'thanks, that helps',
]

interface Turn { line: string; initMs: number | null; firstEventMs: number | null; ttftMs: number | null; totalMs: number; thinking: number; tools: number; models: string[]; reply: string }

function options(model: string, cwd: string, extra: Partial<Options> = {}, env: Record<string, string> = {}): Options {
  return {
    model,
    cwd,
    env: allowedEnv(env),
    systemPrompt: { type: 'custom', prompt: systemPrompt('Alex') },
    settingSources: [],
    tools: [],
    strictMcpConfig: true,
    mcpServers: {},
    permissionMode: 'dontAsk',
    includePartialMessages: true,
    maxTurns: 6,
    ...extra,
  }
}

function observe() {
  const t0 = performance.now()
  const turn = { initMs: null as number | null, firstEventMs: null as number | null, ttftMs: null as number | null, thinking: 0, tools: 0, reply: '' }
  const see = (m: SDKMessage) => {
    const at = Math.round(performance.now() - t0)
    if (m.type === 'system' && m.subtype === 'init') turn.initMs ??= at
    if (m.type === 'stream_event' && m.parent_tool_use_id === null) {
      turn.firstEventMs ??= at
      const e = m.event
      if (e.type === 'content_block_start' && e.content_block.type === 'thinking') turn.thinking++
      if (e.type === 'content_block_start' && e.content_block.type === 'tool_use') turn.tools++
      if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') {
        turn.ttftMs ??= at
        turn.reply += e.delta.text
      }
    }
  }
  return { t0, turn, see }
}

async function cold(model: string, extra: Partial<Options> = {}, env: Record<string, string> = {}, notes = false): Promise<Turn[]> {
  const cwd = await mkdtemp(join(tmpdir(), 'turn-bench-'))
  if (notes) extra = { ...withNotes(cwd), ...extra }
  let sessionId: string | undefined
  const out: Turn[] = []
  for (const line of LINES) {
    const { t0, turn, see } = observe()
    const stream = query({ prompt: line, options: options(model, cwd, { ...extra, ...(sessionId ? { resume: sessionId } : {}) }, env) })
    for await (const m of stream) {
      see(m)
      if (m.type === 'result') {
        sessionId = m.session_id
        out.push({ line, ...turn, totalMs: Math.round(performance.now() - t0), models: Object.keys(m.modelUsage ?? {}) })
        break
      }
    }
    stream.close()
    console.error(model, 'cold', JSON.stringify(out.at(-1)))
  }
  return out
}

const withNotes = (cwd: string): Partial<Options> => ({ mcpServers: { notes: notesServer(cwd) }, allowedTools: NOTE_TOOLS })

async function warm(model: string, notes = false, extra: Partial<Options> = {}, env: Record<string, string> = {}): Promise<Turn[]> {
  const cwd = await mkdtemp(join(tmpdir(), 'turn-bench-'))
  // One process for the whole conversation: each line is pushed into its input.
  let push: ((m: SDKUserMessage) => void) | null = null
  const queue: SDKUserMessage[] = []
  async function* input(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      if (queue.length) yield queue.shift()!
      else await new Promise<void>((r) => (push = (m) => { queue.push(m); push = null; r() }))
    }
  }
  const startedAt = performance.now()
  const stream = query({ prompt: input(), options: options(model, cwd, { ...(notes ? withNotes(cwd) : {}), ...extra }, env) })
  const out: Turn[] = []
  // Let the process start before the first line, as a host would at launch.
  await stream.initializationResult()
  console.error(model, 'warm start', Math.round(performance.now() - startedAt))
  for (const line of LINES) {
    const { t0, turn, see } = observe()
    const msg: SDKUserMessage = { type: 'user', message: { role: 'user', content: line }, parent_tool_use_id: null } as SDKUserMessage
    if (push) (push as (m: SDKUserMessage) => void)(msg)
    else queue.push(msg)
    for (;;) {
      const { value: m, done } = await stream.next()
      if (done) throw new Error('stream ended')
      see(m)
      if (m.type === 'result') {
        out.push({ line, ...turn, totalMs: Math.round(performance.now() - t0), models: Object.keys(m.modelUsage ?? {}) })
        break
      }
    }
    console.error(model, 'warm', JSON.stringify(out.at(-1)))
  }
  stream.close()
  return out
}

const RUNS: Record<string, () => Promise<Turn[]>> = {
  'cold-sonnet': () => cold('sonnet'),
  'cold-haiku': () => cold('haiku'),
  'cold-sonnet-quiet': () => cold('sonnet', {}, { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }),
  'cold-sonnet-nothink': () => cold('sonnet', { thinking: { type: 'disabled' } }),
  'cold-sonnet-notes': () => cold('sonnet', {}, {}, true),
  'cold-haiku-notes': () => cold('haiku', {}, {}, true),
  'warm-sonnet': () => warm('sonnet'),
  'warm-sonnet-notes': () => warm('sonnet', true),
  'warm-haiku-notes': () => warm('haiku', true),
  'warm-sonnet-nothink': () => warm('sonnet', false, { thinking: { type: 'disabled' } }),
  'warm-haiku-nothink': () => warm('haiku', false, { thinking: { type: 'disabled' } }),
  // The default since #42: warm, Haiku, thinking off, notes on, no helper call.
  'default': () => warm('haiku', true, { thinking: { type: 'disabled' } }, { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }),
  // The same with Sonnet, for the persona comparison (#42).
  'default-sonnet': () => warm('sonnet', true, { thinking: { type: 'disabled' } }, { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }),
  // The default before #42: a process per turn, Sonnet, notes on, the helper call.
  'before': () => cold('sonnet', {}, {}, true),
  'warm-haiku': () => warm('haiku'),
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}
const results: Record<string, unknown> = {}
for (const name of process.argv.slice(2)) {
  const turns = await RUNS[name]()
  const ttft = turns.map((t) => t.ttftMs ?? t.totalMs)
  results[name] = { p50: pct(ttft, 50), p90: pct(ttft, 90), totalP50: pct(turns.map((t) => t.totalMs), 50), turns }
  console.error(name, 'ttft p50', pct(ttft, 50), 'p90', pct(ttft, 90))
}
console.log(JSON.stringify(results, null, 1))
