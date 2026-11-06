// One Elder run: copy, edit, check, record. The controller picks the checks;
// the run passes only when the executor completed and every check passed.
// There is no retry. A failed run is committed and recorded as failed.
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCandidate } from './candidate.ts'
import type { CheckResult, Elder, ExecutorOutcome } from './elder.ts'
import { exec, must } from './proc.ts'

export interface RunOptions {
  request: string
  executor: string
  source: string
  candidatesRoot: string
  timeoutMs: number
}

export function instructions(request: string, repo: string): string {
  const uiCraft = existsSync(join(repo, '.agents/skills/ui-craft/SKILL.md'))
    ? 'Follow .agents/skills/ui-craft/SKILL.md for look and feel.\n'
    : ''
  return `You are changing a candidate copy of Village, a family home rendered as a 3D browser scene in home/
(TypeScript, Vite, three.js on WebGPU, every piece a Cordis plugin). Someone in the family asked:

"${request}"

Do it as one new home plugin:
- Read .agents/skills/village-home-stack/SKILL.md and two existing files in home/src/plugins/ first.
- Add home/src/plugins/<name>.ts in the same shape: default export { name, inject: ['stage'], apply(ctx) },
  objects added with own(ctx, ...), and the import.meta.hot line at the end.
- Register it in home/src/main.ts under a key equal to its name.
- Leave home/src/kernel.ts untouched unless the change cannot work without it.
${uiCraft}- Keep it small and in keeping with the existing scene.
- Work only inside this directory. Do not install packages, do not commit, and do not run a dev server.
  The controller builds the home and checks it in a browser after you finish.`
}

export async function runOnce(elder: Elder, options: RunOptions) {
  const executor = elder.executors.get(options.executor)
  if (!executor) throw new Error(`No executor named ${options.executor}. Loaded: ${[...elder.executors.keys()].join(', ')}`)
  const id = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}-${options.executor}`
  const started = performance.now()
  const candidate = await createCandidate(options.source, options.candidatesRoot, id)

  const install = await exec('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], {
    cwd: join(candidate.repo, 'home'),
    logFile: join(candidate.runDir, 'install.log'),
  })
  if (install.code !== 0) throw new Error(`npm ci failed in the candidate; see ${candidate.runDir}/install.log`)

  const outcome: ExecutorOutcome = await executor.run({
    dir: candidate.repo,
    prompt: instructions(options.request, candidate.repo),
    timeoutMs: options.timeoutMs,
    logFile: join(candidate.runDir, 'executor.log'),
  })

  const checks: Record<string, CheckResult> = {}
  for (const [name, check] of elder.checks) {
    if (outcome.status !== 'completed') {
      checks[name] = { pass: false, durationMs: 0, detail: `Not run: executor ${outcome.status}` }
      continue
    }
    const t = performance.now()
    let result: Omit<CheckResult, 'durationMs'>
    try {
      result = await check.run(candidate)
    } catch (error) {
      result = { pass: false, detail: String(error) }
    }
    checks[name] = { ...result, durationMs: Math.round(performance.now() - t) }
  }
  const passed = outcome.status === 'completed' && Object.values(checks).every((c) => c.pass)

  // Changes outside a plugin file are worth a reviewer's eye: the page probe relies on main.ts and the kernel.
  const changed = await must('git', ['status', '--porcelain'], candidate.repo)
  const controllerFilesTouched = await must('git', ['diff', '--stat', candidate.baseCommit, '--', 'home/src/kernel.ts', 'home/scripts', 'home/package.json', 'home/vite.config.ts', 'home/tsconfig.json'], candidate.repo)

  // Never run hooks the model may have planted in the candidate's .git.
  const git = ['-c', 'core.hooksPath=/dev/null']
  await must('git', [...git, 'add', '-A'], candidate.repo)
  await must('git', [...git, 'commit', '--quiet', '--no-verify', '--allow-empty', '-m', `Elder candidate ${id}: ${passed ? 'passed' : 'failed'}\n\nRequest: ${options.request}\nExecutor: ${options.executor} (${outcome.model}), ${outcome.status}`], candidate.repo)
  const commit = await must('git', ['rev-parse', 'HEAD'], candidate.repo)

  const result = {
    id,
    status: passed ? 'passed' : 'failed',
    request: options.request,
    executor: options.executor,
    model: outcome.model,
    executorOutcome: outcome,
    baseCommit: candidate.baseCommit,
    branch: candidate.branch,
    commit,
    repo: candidate.repo,
    inodesSharedWithSource: candidate.inodesShared,
    changedFiles: changed.split('\n').filter(Boolean),
    controllerFilesTouched: controllerFilesTouched || null,
    durations: {
      totalMs: Math.round(performance.now() - started),
      installMs: install.durationMs,
      executorMs: outcome.durationMs,
      checksMs: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.durationMs])),
    },
    checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.pass ? 'pass' : 'fail'])),
    checkDetails: checks,
    screenshot: (checks.screenshot?.detail as { path?: string } | undefined)?.path ?? null,
  }
  const resultPath = join(candidate.runDir, 'result.json')
  await writeFile(resultPath, JSON.stringify(result, null, 2) + '\n')
  return { result, resultPath }
}
