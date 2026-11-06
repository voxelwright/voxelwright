// One Elder run: copy, install, record the base, edit, check, commit, record.
// The controller picks the checks; the run passes only when the executor
// completed and every expected check ran and passed. There is no retry.
// result.json is written on every path, including a failed copy, install,
// executor spawn or commit.
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assertNoSharedInodes, createCandidate, pruneCandidates } from './candidate.ts'
import { EXPECTED_CHECKS, type Candidate, type CheckResult, type Elder, type ExecutorOutcome } from './elder.ts'
import { mustGit } from './proc.ts'
import { createSandbox } from './sandbox.ts'

export interface RunOptions {
  request: string
  executor: string
  source: string
  candidatesRoot: string
  timeoutMs: number
  /** Passed candidates kept besides failed ones. */
  keep?: number
}

export function instructions(request: string, repo: string): string {
  const uiCraft = existsSync(join(repo, '.agents/skills/ui-craft/SKILL.md'))
    ? 'Follow the rubric in .agents/skills/ui-craft/SKILL.md for look and feel. You cannot open a browser here;\n  the controller takes the screenshot, so judge the scene from the code and the existing plugins.\n'
    : ''
  return `You are changing a candidate copy of Village, a family home rendered as a 3D browser scene in home/
(TypeScript, Vite, three.js on WebGPU, every piece a Cordis plugin). Someone in the family asked:

"${request}"

Do it as one new home plugin:
- Read .agents/skills/village-home-stack/SKILL.md and two existing files in home/src/plugins/ first.
- Add home/src/plugins/<name>.ts in the same shape: default export { name, inject: ['stage'], apply(ctx) },
  objects added with own(ctx, ...), and the import.meta.hot line at the end.
- main.ts loads every file in home/src/plugins/ by itself. Do not edit main.ts.
- Change nothing outside home/src/plugins/. The controller fails the run if any other file changes,
  including kernel.ts, main.ts, configs, package files, scripts and node_modules.
${uiCraft}- Keep it small, visible from the default camera, and in keeping with the existing scene.
- Do not install packages, do not commit, and do not run a dev server.
  The controller builds the home and checks it in a browser after you finish.`
}

type Status = 'passed' | 'failed'

export async function runOnce(elder: Elder, options: RunOptions) {
  const id = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}-${options.executor}`
  const started = performance.now()
  const root = resolve(options.candidatesRoot)
  const runDir = join(root, id)
  await mkdir(runDir, { recursive: true })
  const resultPath = join(runDir, 'result.json')

  const result: Record<string, unknown> & { status: Status; error: string | null } = {
    id,
    status: 'failed',
    error: null,
    stage: 'start',
    request: options.request,
    executor: options.executor,
  }
  const checks: Record<string, CheckResult> = {}
  const durations: Record<string, unknown> = {}
  let candidate: Candidate | undefined
  let outcome: ExecutorOutcome | undefined

  try {
    const executor = elder.executors.get(options.executor)
    if (!executor) throw new Error(`No executor named ${options.executor}. Loaded: ${[...elder.executors.keys()].join(', ') || 'none'}`)
    const missing = EXPECTED_CHECKS.filter((name) => !elder.checks.has(name))
    if (missing.length) throw new Error(`Expected checks are not registered: ${missing.join(', ')}`)

    result.stage = 'copy'
    candidate = await createCandidate(options.source, root, id)
    Object.assign(result, { baseCommit: candidate.baseCommit, branch: candidate.branch, repo: candidate.repo })

    // Install from the base commit's lockfile before the executor exists, under srt with only the npm registry reachable.
    result.stage = 'install'
    const sandbox = await createSandbox({ repo: candidate.repo, network: 'npm' })
    const install = await sandbox
      .run('npm', ['ci', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: join(candidate.repo, 'home'), timeoutMs: 300_000, logFile: join(runDir, 'install.log') })
      .finally(() => sandbox.dispose())
    durations.installMs = install.durationMs
    if (install.code !== 0) throw new Error(`npm ci failed in the candidate (${install.spawnError ?? `exit ${install.code}`}); see install.log`)

    result.stage = 'inodes'
    result.inodeCheck = await assertNoSharedInodes(options.source, candidate.repo)

    result.stage = 'prepare'
    for (const name of EXPECTED_CHECKS) await elder.checks.get(name)!.prepare?.(candidate)

    result.stage = 'executor'
    outcome = await executor.run({
      dir: candidate.repo,
      prompt: instructions(options.request, candidate.repo),
      timeoutMs: options.timeoutMs,
      logFile: join(runDir, 'executor.log'),
    })
    Object.assign(result, { model: outcome.model, executorOutcome: outcome })
    durations.executorMs = outcome.durationMs

    result.stage = 'checks'
    let blocked: string | undefined = outcome.status === 'completed' ? undefined : `executor ${outcome.status}`
    for (const name of EXPECTED_CHECKS) {
      const check = elder.checks.get(name)!
      if (blocked) {
        checks[name] = { pass: false, ran: false, evidence: check.evidence, durationMs: 0, detail: `Not run: ${blocked}` }
        continue
      }
      const t = performance.now()
      let checked: Omit<CheckResult, 'durationMs'>
      try {
        checked = await check.run(candidate)
      } catch (error) {
        checked = { pass: false, detail: String(error) }
      }
      checks[name] = { ...checked, evidence: check.evidence, durationMs: Math.round(performance.now() - t) }
      // Later checks run candidate code or trust files an earlier check vouches for.
      if (!checked.pass) blocked = `${name} failed`
    }
    const passed = outcome.status === 'completed' && EXPECTED_CHECKS.every((name) => checks[name]?.pass === true)
    result.status = passed ? 'passed' : 'failed'

    result.stage = 'commit'
    const gitTouched = ((checks['controller-files']?.detail as { controllerOwned?: string[] } | undefined)?.controllerOwned ?? []).some((p) => p === '.git' || p.startsWith('.git/'))
    if (gitTouched) {
      result.commit = null
      result.commitSkipped = 'The candidate changed its .git directory'
    } else {
      await mustGit(['add', '-A'], candidate.repo)
      await mustGit(['commit', '--quiet', '--no-verify', '--allow-empty', '-m', `Elder candidate ${id}: ${result.status}\n\nRequest: ${options.request}\nExecutor: ${options.executor} (${outcome.model}), ${outcome.status}`], candidate.repo)
      result.commit = await mustGit(['rev-parse', 'HEAD'], candidate.repo)
    }
    result.stage = 'done'
  } catch (error) {
    result.status = 'failed'
    result.error = error instanceof Error ? error.message : String(error)
  } finally {
    durations.totalMs = Math.round(performance.now() - started)
    durations.checksMs = Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.durationMs]))
    Object.assign(result, {
      durations,
      checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.ran === false ? 'not run' : v.pass ? 'pass' : 'fail'])),
      inPageEvidence: Object.keys(checks).filter((k) => checks[k].evidence === 'in-page'),
      checkDetails: checks,
      screenshot: (checks.screenshot?.detail as { path?: string } | undefined)?.path ?? null,
    })
    await writeFile(resultPath, JSON.stringify(result, null, 2) + '\n')
  }
  result.pruned = await pruneCandidates(root, options.keep ?? 5).catch((e) => `Prune failed: ${e}`)
  return { result, resultPath }
}
