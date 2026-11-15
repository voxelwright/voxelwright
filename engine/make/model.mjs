// The model (#220): the asker's own Claude Code, run once for one reply, on the asker's own machine and
// subscription. It is given no tools, no servers, no settings and no files, it keeps no session, and it is run in
// an empty folder made for it. Why each flag: .agents/skills/claude-code-headless/SKILL.md.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Only what the binary needs to find itself and its login: nothing else of the asker's shell goes with it. */
const ENV = ['HOME', 'PATH', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'SHELL']

/**
 * One reply to one prompt, and to the pictures that come with it ({ type, data: base64 }), if any. Resolves to { text, model, ms, cost, tokens } or throws: on a run that fails, is too
 * slow (it is stopped), says it had a tool or a server after all, or ends without a result.
 */
export async function reply({ system, prompt, pictures = [], model = 'opus', effort, binary = 'claude', limit = 240_000 }) {
  const cwd = await mkdtemp(join(tmpdir(), 'thing-'))
  const env = Object.fromEntries(ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]))
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  const args = ['-p', '--model', model, '--system-prompt', system, '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence', '--output-format', 'stream-json', '--verbose']
  // A picture goes in as the message itself (the model has no tool to open a file with): one line of JSON on stdin.
  // Nothing of it is written anywhere: no session is kept, and the folder made for the run stays empty.
  // How hard it thinks before it replies (low to max): left to the binary unless said.
  if (effort) args.push('--effort', effort)
  if (pictures.length) args.push('--input-format', 'stream-json')
  const said = pictures.length ? JSON.stringify({ type: 'user', message: { role: 'user', content: [...pictures.map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.type, data: p.data } })), { type: 'text', text: prompt }] } }) + '\n' : prompt
  const began = Date.now()
  try {
    const child = spawn(binary, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = '', late = false
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { err += c })
    child.stdin.on('error', () => {})
    child.stdin.end(said)
    const timer = setTimeout(() => { late = true; child.kill('SIGTERM') }, limit)
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) }).finally(() => clearTimeout(timer))
    if (late) throw new Error(`the model took over ${limit / 1000} s and was stopped`)
    const lines = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    const init = lines.find((m) => m.type === 'system' && m.subtype === 'init'), result = lines.find((m) => m.type === 'result')
    if (!init || !result) throw new Error(`the model's run ended (${code}) without a result: ${err.trim().slice(0, 200)}`)
    // What it returns is only trusted to be data if it could do nothing but write.
    if (init.tools?.length || init.mcp_servers?.length) throw new Error(`the model was started with tools or servers (${[...(init.tools ?? []), ...(init.mcp_servers ?? []).map((s) => s.name)].slice(0, 5).join(', ')}): its reply is not used`)
    if (code !== 0 || result.is_error || result.subtype !== 'success' || typeof result.result !== 'string') throw new Error(`the model's run failed (${result.subtype}): ${String(result.result ?? result.errors ?? '').slice(0, 200)}`)
    const u = result.usage ?? {}
    return { text: result.result, model: init.model, ms: Date.now() - began, cost: result.total_cost_usd ?? 0, tokens: { in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), out: u.output_tokens ?? 0 } }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}
