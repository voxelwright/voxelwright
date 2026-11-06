// npm run elder -- "put a small radio on the windowsill" [--executor codex] [--timeout-ms 360000]
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Context } from 'cordis'
import { core } from './elder.ts'
import claudeCode from './plugins/claude-code.ts'
import codex, { codexDisabled } from './plugins/codex.ts'
import homeChecks from './plugins/home-checks.ts'
import { runOnce } from './run.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    executor: { type: 'string', default: 'claude-code' },
    'timeout-ms': { type: 'string', default: String(6 * 60_000) },
    candidates: { type: 'string', default: join(homedir(), '.village', 'candidates') },
  },
})
const request = positionals.join(' ').trim()
if (!request) {
  console.error('Usage: npm run elder -- "<request>" [--executor claude-code|codex] [--timeout-ms N] [--candidates DIR]')
  process.exit(2)
}

const root = new Context()
const fibers = [root.plugin(core), root.plugin(claudeCode), root.plugin(codex), root.plugin(homeChecks)]
for (const fiber of fibers) await fiber.await()

if (values.executor === 'codex' && !root.elder.executors.has('codex')) {
  console.error(codexDisabled)
  process.exit(2)
}

try {
  const { result, resultPath } = await runOnce(root.elder, {
    request,
    executor: values.executor,
    source: process.env.INIT_CWD ?? process.cwd(),
    candidatesRoot: values.candidates,
    timeoutMs: Number(values['timeout-ms']),
  })
  console.log(JSON.stringify({ status: result.status, executor: result.executor, model: result.model, checks: result.checks, durations: result.durations, screenshot: result.screenshot, result: resultPath }, null, 2))
  process.exitCode = result.status === 'passed' ? 0 : 1
} finally {
  for (const fiber of fibers.reverse()) await fiber.dispose()
}
