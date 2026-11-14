// The model that voices people (#264): the owner's own Claude Code, on their own machine and subscription, one
// process for one reply. As the maker's (make/model.mjs) it has no tools, no servers, no settings, no session and an
// empty folder; why each flag: .agents/skills/claude-code-headless/SKILL.md. Two things differ, both for speed:
//   - its words are read as they come (`--include-partial-messages`), so the first sentence can be said at once;
//   - a process can be started before it is wanted (`warm`): the binary takes about 1.7 s to start and then waits
//     for its one message on stdin, so the wait is paid before anyone speaks. Each still answers once and ends:
//     no two people of a world ever share a context.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Only what the binary needs to find itself and its login. */
const ENV = ['HOME', 'PATH', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'SHELL']
/** A process that waits is ended and started again after this long (ms): what it would be told by then may be stale. */
const WAITS_MOST = 10 * 60_000

/**
 * @param system  what every reply is told first (the same for all, so it is read from the provider's cache)
 * @param warm    how many processes are kept started and waiting
 * @param limit   how long one reply may take (ms) before it is stopped
 * @returns `reply(prompt, heard)` resolves to { text, model, ms, first, cost, tokens } or throws; `heard(soFar)` is
 *          called with the reply so far as it comes. `close()` ends what waits.
 */
export function mind({ system, model = 'haiku', binary = 'claude', warm = 0, limit = 30_000 }) {
  const env = Object.fromEntries(ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]))
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  const args = ['-p', '--model', model, '--system-prompt', system, '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']
  /** Processes started and not yet asked anything. */
  const waiting = []
  let closed = false
  async function start() {
    const cwd = await mkdtemp(join(tmpdir(), 'voice-'))
    const child = spawn(binary, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    const one = { child, cwd, began: Date.now(), dead: false, err: '', gone: null, stale: null }
    child.stdin.on('error', () => {})
    child.stderr.on('data', (c) => { one.err = (one.err + c).slice(-400) })
    one.gone = new Promise((resolve) => { child.on('error', () => resolve(-1)); child.on('close', resolve) }).then((code) => { one.dead = true; clearTimeout(one.stale); void rm(cwd, { recursive: true, force: true }); return code })
    return one
  }
  const top = () => { while (!closed && waiting.length < warm) { const p = start(); waiting.push(p); void p.then((one) => { one.stale = setTimeout(() => { const i = waiting.indexOf(p); if (i >= 0) { waiting.splice(i, 1); one.child.kill('SIGTERM'); top() } }, WAITS_MOST); void one.gone.then(() => { const i = waiting.indexOf(p); if (i >= 0) { waiting.splice(i, 1); setTimeout(top, 1000) } }) }) } }
  top()
  return {
    async reply(prompt, heard = () => {}) {
      const began = Date.now()
      let one = await (waiting.shift() ?? start())
      const warmed = Date.now() - one.began > 1500
      if (one.dead) one = await start()
      clearTimeout(one.stale)
      top()
      const { child } = one
      let buffer = '', text = '', init = null, result = null, late = false, first = 0
      child.stdout.on('data', (c) => {
        buffer += c
        for (let at; (at = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, at); buffer = buffer.slice(at + 1)
          let m
          try { m = JSON.parse(line) } catch { continue }
          if (m.type === 'system' && m.subtype === 'init') init = m
          else if (m.type === 'result') result = m
          // Its words as they come: passed on only from a run that could do nothing but write.
          else if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta' && init && !init.tools?.length && !init.mcp_servers?.length) {
            if (!first) first = Date.now() - began
            text += m.event.delta.text
            try { heard(text) } catch { /* whoever listens is not this run's to fail for */ }
          }
        }
      })
      child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } }) + '\n')
      const timer = setTimeout(() => { late = true; child.kill('SIGTERM') }, limit)
      const code = await one.gone.finally(() => clearTimeout(timer))
      if (late) throw new Error(`the model took over ${limit / 1000} s and was stopped`)
      if (!init || !result) throw new Error(`the model's run ended (${code}) without a result: ${one.err.trim().slice(0, 200)}`)
      if (init.tools?.length || init.mcp_servers?.length) throw new Error('the model was started with tools or servers: its reply is not used')
      if (code !== 0 || result.is_error || result.subtype !== 'success' || typeof result.result !== 'string') throw new Error(`the model's run failed (${result.subtype}): ${String(result.result ?? result.errors ?? '').slice(0, 200)}`)
      const u = result.usage ?? {}
      return { text: result.result, model: init.model, ms: Date.now() - began, first, warmed, cost: result.total_cost_usd ?? 0, tokens: { in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cached: u.cache_read_input_tokens ?? 0, out: u.output_tokens ?? 0 } }
    },
    close() { closed = true; for (const p of waiting.splice(0)) void p.then((one) => { clearTimeout(one.stale); one.child.kill('SIGTERM') }) },
  }
}
