// Codex exec in the candidate, using the operator's existing login in place.
// Disabled unless ELDER_ALLOW_CODEX=1: a lock file on the maintainer's machine can block codex.
// workspace-write limits writes, not reads, so codex can read the operator's files.
//
// -s workspace-write lets the agent write only inside -C (plus temp dirs) and
// keeps network off. --ignore-user-config skips the operator's config, hooks
// and MCP servers (auth still comes from CODEX_HOME), so the model and effort
// are passed explicitly. --ephemeral keeps the session off disk.
import type { Context } from 'cordis'
import { register, type ExecutorTask } from '../elder.ts'
import { allowedEnv, exec } from '../proc.ts'

export const codexDisabled = 'The codex executor is off: a local lock file can block codex. Set ELDER_ALLOW_CODEX=1 only when the owner runs it.'

export interface Config {
  model?: string
  effort?: string
  /** The npm install of codex on this machine lacks its native binary; the ChatGPT app ships one. */
  bin?: string
}

export default {
  name: 'codex',
  inject: ['elder'],
  apply(ctx: Context, config: Config = {}) {
    if (process.env.ELDER_ALLOW_CODEX !== '1') return
    const model = config.model ?? 'gpt-6.1-sol'
    const bin = config.bin ?? process.env.ELDER_CODEX_BIN ?? 'codex'
    register(ctx, ctx.elder.executors, 'codex', {
      async run(task: ExecutorTask) {
        const args = [
          'exec',
          '-s', 'workspace-write',
          '-C', task.dir,
          '--ignore-user-config',
          '--ephemeral',
          '--color', 'never',
          '-m', model,
          '-c', `model_reasoning_effort="${config.effort ?? 'medium'}"`,
          task.prompt,
        ]
        const result = await exec(bin, args, { cwd: task.dir, env: allowedEnv(), timeoutMs: task.timeoutMs, logFile: task.logFile })
        // Codex prints its session header, including `model: <name>`, on stderr.
        const reported = /^model: (.+)$/m.exec(result.stderr)?.[1]
        return {
          status: result.timedOut ? 'timeout' : result.code === 0 && !result.spawnError ? 'completed' : 'failed',
          exitCode: result.code,
          model: reported ?? `${model} (requested; none reported)`,
          durationMs: result.durationMs,
          detail: result.spawnError ?? result.stdout.slice(-2000),
        }
      },
    })
  },
}
