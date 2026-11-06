// Headless Claude Code in the candidate, using the operator's existing login.
//
// --restricted confines the file tools to the working directory and ignores
// user and project settings. --tools leaves out Bash on purpose: the model can
// edit package.json scripts, so even an allow-listed `npm run build` could run
// anything outside the candidate. --permission-prompts none denies anything
// that would otherwise ask, such as a write outside the candidate.
import type { Context } from 'cordis'
import { register, type ExecutorTask } from '../elder.ts'
import { exec } from '../proc.ts'

export interface Config {
  model?: string
}

export default {
  name: 'claude-code',
  inject: ['elder'],
  apply(ctx: Context, config: Config = {}) {
    const model = config.model ?? 'sonnet'
    register(ctx, ctx.elder.executors, 'claude-code', {
      async run(task: ExecutorTask) {
        // The operator's shell wraps `claude` to drop NODE_OPTIONS; do the same.
        const { NODE_OPTIONS: _, ...env } = process.env
        const args = [
          '-p', task.prompt,
          '--model', model,
          '--output-format', 'json',
          '--restricted',
          '--permission-mode', 'acceptEdits',
          '--permission-prompts', 'none',
          '--tools', 'Read,Edit,Write,Glob,Grep',
          '--no-session-persistence',
        ]
        const result = await exec('claude', args, { cwd: task.dir, env, timeoutMs: task.timeoutMs, logFile: task.logFile })
        let reported: { is_error?: boolean; result?: string; modelUsage?: Record<string, unknown> } = {}
        try {
          reported = JSON.parse(result.stdout)
        } catch {
          // Killed or crashed before printing its result.
        }
        const models = Object.keys(reported.modelUsage ?? {})
        return {
          status: result.timedOut ? 'timeout' : result.code === 0 && !reported.is_error ? 'completed' : 'failed',
          exitCode: result.code,
          model: models.length ? models.join(',') : `${model} (requested; none reported)`,
          durationMs: result.durationMs,
          detail: reported.result?.slice(-2000),
        }
      },
    })
  },
}
