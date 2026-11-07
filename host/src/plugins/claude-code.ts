// Headless Claude Code in the candidate, using the operator's existing login.
//
// --restricted confines the file tools to the working directory and ignores
// user and project settings. --strict-mcp-config with an empty --mcp-config
// keeps every MCP server the operator has configured (and the claude.ai
// connectors) out of the session. --tools leaves out Bash on purpose: the
// model can edit package.json scripts, so even an allow-listed `npm run build`
// could run anything outside the candidate. --permission-prompts none denies
// anything that would otherwise ask, such as a write outside the candidate.
//
// stream-json (which needs --verbose) puts the session's init event, every
// tool call and the final result in executor.log. The run fails when the init
// event is missing or lists any MCP server or MCP tool.
import type { Context } from 'cordis'
import { register, type ExecutorTask } from '../elder.ts'
import { allowedEnv, exec } from '../proc.ts'

export interface Config {
  model?: string
  /** For tests: a stand-in for the claude binary. */
  bin?: string
}

interface StreamEvent {
  type?: string
  subtype?: string
  mcp_servers?: { name: string; status?: string }[]
  tools?: string[]
  is_error?: boolean
  result?: string
  usage?: Record<string, unknown>
  total_cost_usd?: number
  modelUsage?: Record<string, unknown>
}

export default {
  name: 'claude-code',
  inject: ['elder'],
  apply(ctx: Context, config: Config = {}) {
    const model = config.model ?? 'sonnet'
    const bin = config.bin ?? 'claude'
    register(ctx, ctx.elder.executors, 'claude-code', {
      async run(task: ExecutorTask) {
        // Allowlisted environment only (no NODE_OPTIONS, tokens or cloud settings); the login comes from the keychain.
        const env = allowedEnv()
        const args = [
          '-p', task.prompt,
          '--model', model,
          '--output-format', 'stream-json',
          '--verbose',
          '--restricted',
          '--strict-mcp-config',
          '--mcp-config', '{"mcpServers":{}}',
          '--permission-mode', 'acceptEdits',
          '--permission-prompts', 'none',
          '--tools', 'Read,Edit,Write,Glob,Grep',
          '--no-session-persistence',
        ]
        const result = await exec(bin, args, { cwd: task.dir, env, timeoutMs: task.timeoutMs, logFile: task.logFile })
        const events: StreamEvent[] = []
        for (const line of result.stdout.split('\n')) {
          try {
            if (line.trim()) events.push(JSON.parse(line))
          } catch {
            // A partial line from a killed process.
          }
        }
        const init = events.find((e) => e.type === 'system' && e.subtype === 'init')
        const reported = events.find((e) => e.type === 'result') ?? {}
        const mcpServers = init?.mcp_servers?.map((s) => s.name) ?? []
        const mcpTools = init?.tools?.filter((t) => t.startsWith('mcp__')) ?? []
        const sessionProblem = !init ? 'No init event in the stream' : mcpServers.length || mcpTools.length ? `MCP loaded in the executor: servers [${mcpServers.join(', ')}], tools [${mcpTools.join(', ')}]` : undefined
        const models = Object.keys(reported.modelUsage ?? {})
        return {
          status: result.timedOut ? 'timeout' : result.code === 0 && !result.spawnError && !reported.is_error && !sessionProblem ? 'completed' : 'failed',
          exitCode: result.code,
          model: models.length ? models.join(',') : `${model} (requested; none reported)`,
          durationMs: result.durationMs,
          detail: result.spawnError ?? sessionProblem ?? reported.result?.slice(-2000),
          report: { mcpServers: init?.mcp_servers ?? null, tools: init?.tools ?? null, usage: reported.usage ?? null, totalCostUsd: reported.total_cost_usd ?? null },
        }
      },
    })
  },
}
