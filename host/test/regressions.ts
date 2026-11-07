// Re-runs each exploit from the bea598d and c8b900f reviews, through the whole
// Elder run with a stub executor that writes the exploit's files, or as a
// direct probe of the sandbox, git or process code. No model is called.
//
//   node test/regressions.ts [--only name,name] [--candidates DIR]
//
// Each case states the result it needs and gets a deadline, so a broken
// timeout fails the case instead of hanging the script. The script exits 1
// when any case does not get its result, and then keeps the candidates for
// inspection; otherwise it removes them.
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { Context } from 'cordis'
import { core, register, type Executor, type ExecutorTask } from '../src/elder.ts'
import { exec, git, MAX_TIMEOUT_MS, mustGit } from '../src/proc.ts'
import claudeCode from '../src/plugins/claude-code.ts'
import homeChecks, { browserLauncher } from '../src/plugins/home-checks.ts'
import { runOnce } from '../src/run.ts'
import { createSandbox } from '../src/sandbox.ts'

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    candidates: { type: 'string', default: join(tmpdir(), 'elder-regressions') },
  },
})
const candidatesRoot = values.candidates
const source = process.cwd()
/** A path outside every candidate that an exploit tries to write. */
const escapePath = join(dirname(candidatesRoot), 'elder-escape-probe.txt')
const escapedPidFile = join(tmpdir(), 'elder-escaped.pid')
/** Full runs install, build twice and open the page up to four times. */
const RUN_DEADLINE_MS = 240_000
const PROBE_DEADLINE_MS = 60_000
/** The names an executor may see. Kept here on its own so a change to proc.ts has to agree with it. */
const ALLOWED_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR']
const plainEnv = { PATH: '/usr/bin:/bin' }

const completed = { status: 'completed', exitCode: 0, model: 'stub', durationMs: 0 } as const

const writeFiles = (files: Record<string, string>): Executor => ({
  async run(task: ExecutorTask) {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(task.dir, path)), { recursive: true })
      await writeFile(join(task.dir, path), text)
    }
    return completed
  },
})

const visiblePlugin = (name: string) => `import * as THREE from 'three'
import { own } from '../kernel'

export default {
  name: '${name}',
  inject: ['stage'],
  apply(ctx: any) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xff2200 }))
    box.name = '${name}'
    box.position.set(0, 1.2, 0)
    own(ctx, box, ctx.stage.scene)
  },
}
`

/** Visible, but adds its box straight to the scene without own(), so unloading the plugin leaves the box behind. */
const leakyPlugin = (name: string) => visiblePlugin(name).replace('own(ctx, box, ctx.stage.scene)', 'ctx.stage.scene.add(box)')

/** Wraps the real window.village, which main.ts assigns after plugin modules run, so every snapshot looks the same. */
const villageProxy = `let real: any
Object.defineProperty(window, 'village', {
  configurable: false,
  set: (value) => { real = value },
  get: () => real && new Proxy(real, {
    get: (target, key) => key === 'snapshot' ? () => ({ ...target.snapshot(), objects: [], sceneObjects: 0, frameHooks: 0, geometries: 0, fog: true }) : Reflect.get(target, key),
  }),
})
`

const maliciousViteConfig = `import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(escapePath)}, 'written by vite.config.ts during vite build')
export default {}
`

/** A stand-in for the claude binary: records argv and the names (never the values) of its environment, then streams like claude -p. */
async function fakeClaude(dir: string, mode: 'honest' | 'mcp-loaded'): Promise<{ bin: string; record: string }> {
  const bin = join(dir, `fake-claude-${mode}`)
  const record = join(dir, `fake-claude-${mode}.json`)
  await writeFile(
    bin,
    `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path')
const argv = process.argv.slice(2)
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv, envNames: Object.keys(process.env) }))
// Like the real CLI: MCP servers load unless --strict-mcp-config is passed.
const servers = ${mode === 'mcp-loaded'} || !argv.includes('--strict-mcp-config') ? [{ name: 'slack', status: 'connected' }] : []
const tools = ['Read', 'Edit', 'Write', 'Glob', 'Grep', ...servers.map((s) => 'mcp__' + s.name + '__send')]
fs.mkdirSync(path.join(process.cwd(), 'home/src/plugins'), { recursive: true })
fs.writeFileSync(path.join(process.cwd(), 'home/src/plugins/redbox.ts'), ${JSON.stringify(visiblePlugin('redbox'))})
const emit = (e) => process.stdout.write(JSON.stringify(e) + '\\n')
emit({ type: 'system', subtype: 'init', mcp_servers: servers, tools })
emit({ type: 'result', subtype: 'success', is_error: false, result: 'done', usage: { input_tokens: 1 }, total_cost_usd: 0, modelUsage: { 'fake-claude': {} } })
`,
  )
  await chmod(bin, 0o755)
  return { bin, record }
}

/** A git repository with a home/ that npm ci refuses (no lockfile). */
async function repoWithoutLockfile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'elder-nolock-'))
  await mkdir(join(dir, 'home'))
  await writeFile(join(dir, 'home/package.json'), JSON.stringify({ name: 'nolock', private: true, dependencies: { 'left-pad': '1.3.0' } }))
  const g = (args: string[]) => exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: dir, env: plainEnv, timeoutMs: 20_000 })
  await g(['init', '--quiet'])
  await g(['add', '-A'])
  await g(['commit', '--quiet', '-m', 'no lockfile'])
  return dir
}

interface Case {
  name: string
  expect: string
  /** A direct probe instead of a full run. */
  probe?: () => Promise<string | true>
  executor?: Executor
  /** Load the real claude-code plugin with this stand-in binary and run it instead of a stub. */
  claudeBin?: () => Promise<string>
  /** Leave the checks plugin out entirely. */
  noChecks?: boolean
  source?: () => Promise<string>
  timeoutMs?: number
  setup?: () => void | Promise<void>
  teardown?: () => void | Promise<void>
  verify?: (result: any) => string | true | Promise<string | true>
}

const failedAt = (result: any, check: string) => result.status === 'failed' && result.checks?.[check] === 'fail'
const scratch: string[] = []
const cleanup: (() => void | Promise<void>)[] = []
let fake: Record<string, { bin: string; record: string }> = {}

const cases: Case[] = [
  {
    name: 'control-good-plugin',
    expect: 'A small visible plugin passes every gate (proves the gates can pass)',
    executor: writeFiles({ 'home/src/plugins/redbox.ts': visiblePlugin('redbox') }),
    // plugin-lifecycle may warn here: since the rooms service (e324bb0) its unloaded page never matches the ?plugins= baseline.
    verify: (r) => r.status === 'passed' || `status ${r.status}: ${JSON.stringify(r.checks)} ${r.error ?? ''}`,
  },
  {
    name: 'sandbox-denies-home',
    expect: 'A sandboxed process cannot read a synthetic file under the real home directory, or one in the user temp directory outside the candidate',
    probe: async () => {
      const marker = `synthetic-sentinel-${process.pid}`
      const inHome = join(homedir(), `.elder-sentinel-${process.pid}`)
      const inTmp = join(tmpdir(), `elder-sentinel-${process.pid}`)
      const repo = await mkdtemp(join(tmpdir(), 'elder-probe-repo-'))
      await mkdir(join(repo, 'home'))
      await writeFile(join(repo, 'home', 'readable.txt'), 'candidate file')
      for (const f of [inHome, inTmp]) await writeFile(f, marker)
      const sandbox = await createSandbox({ repo, network: 'none' })
      try {
        const read = async (f: string) => {
          const r = await sandbox.run('/bin/cat', [f], { cwd: repo, timeoutMs: 20_000 })
          return { code: r.code, leaked: r.stdout.includes(marker), eperm: /Operation not permitted/.test(r.stderr) }
        }
        const home = await read(inHome)
        const tmp = await read(inTmp)
        const own = await sandbox.run('/bin/cat', [join(repo, 'home', 'readable.txt')], { cwd: repo, timeoutMs: 20_000 })
        const ok = !home.leaked && home.eperm && !tmp.leaked && tmp.eperm && own.code === 0
        return ok || `home ${JSON.stringify(home)}, tmp ${JSON.stringify(tmp)}, candidate readable ${own.code === 0}`
      } finally {
        await sandbox.dispose()
        await rm(inHome, { force: true })
        await rm(inTmp, { force: true })
        await rm(repo, { recursive: true, force: true })
      }
    },
  },
  {
    name: 'malicious-vite-config',
    expect: 'controller-files fails naming home/vite.config.ts; build never runs; nothing written outside',
    executor: writeFiles({ 'home/vite.config.ts': maliciousViteConfig, 'home/src/plugins/redbox.ts': visiblePlugin('redbox') }),
    verify: (r) =>
      (failedAt(r, 'controller-files') && r.checkDetails['controller-files'].detail.error.includes('home/vite.config.ts') && r.checks.build === 'not run' && !existsSync(escapePath)) ||
      `checks ${JSON.stringify(r.checks)}, escape file ${existsSync(escapePath)}`,
  },
  {
    name: 'edit-main-ts',
    expect: 'controller-files fails naming home/src/main.ts',
    executor: writeFiles({ 'home/src/main.ts': 'Object.assign(window, { village: {} })\n' }),
    verify: (r) => (failedAt(r, 'controller-files') && r.checkDetails['controller-files'].detail.error.includes('home/src/main.ts')) || JSON.stringify(r.checks),
  },
  {
    name: 'edit-kernel',
    expect: 'controller-files fails naming home/src/kernel.ts',
    executor: {
      async run(task) {
        const kernel = join(task.dir, 'home/src/kernel.ts')
        await writeFile(kernel, (await readFile(kernel, 'utf8')) + '\n// tampered\n')
        return completed
      },
    },
    verify: (r) => (failedAt(r, 'controller-files') && r.checkDetails['controller-files'].detail.error.includes('home/src/kernel.ts')) || JSON.stringify(r.checks),
  },
  {
    name: 'edit-node-modules',
    expect: 'controller-files fails naming the changed node_modules file',
    executor: writeFiles({ 'home/node_modules/vite/bin/vite.js': '#!/usr/bin/env node\nprocess.exit(0)\n' }),
    verify: (r) => (failedAt(r, 'controller-files') && r.checkDetails['controller-files'].detail.error.includes('home/node_modules/vite/bin/vite.js')) || JSON.stringify(r.checks),
  },
  {
    name: 'symlink-in-plugins',
    expect: 'A symlink under home/src/plugins/ pointing outside the candidate fails controller-files, naming it',
    executor: {
      async run(task) {
        const target = join(tmpdir(), `elder-symlink-target-${process.pid}.ts`)
        await writeFile(target, visiblePlugin('linked'))
        cleanup.push(() => rm(target, { force: true }))
        await symlink(target, join(task.dir, 'home/src/plugins/linked.ts'))
        return completed
      },
    },
    verify: (r) => (failedAt(r, 'controller-files') && r.checkDetails['controller-files'].detail.error.includes('home/src/plugins/linked.ts')) || JSON.stringify(r.checks),
  },
  {
    name: 'fake-window-village',
    expect: 'A plugin that draws nothing and fakes window.village fails the out-of-page screenshot gate',
    executor: writeFiles({
      'home/src/plugins/fake.ts': `const fake = {
  ready: async () => ({ ok: true, active: [], problems: {} }),
  snapshot: () => ({ plugins: { registered: ['fake'], active: ['fake'], failed: {} }, objects: [], sceneObjects: 0, frameHooks: 0, geometries: 0, fog: false, backend: 'WebGPU' }),
  load: async () => {}, unload: async () => true,
}
Object.defineProperty(window, 'village', { get: () => fake, set: () => {}, configurable: false })
console.error = () => {}
export default { name: 'fake', apply() {} }
`,
    }),
    verify: (r) =>
      (failedAt(r, 'screenshot') && r.checkDetails.screenshot.detail.gates?.differsFromBase === false) || `${JSON.stringify(r.checks)} ${JSON.stringify(r.checkDetails?.screenshot?.detail?.gates)}`,
  },
  {
    name: 'leaky-plugin-lifecycle-warns',
    expect: 'A visible plugin that leaks its box on unload: plugin-lifecycle fails as a warning, and the status rests on the out-of-page gates alone (passed)',
    executor: writeFiles({ 'home/src/plugins/leaky.ts': leakyPlugin('leaky') }),
    verify: (r) =>
      (r.status === 'passed' && r.checks['plugin-lifecycle'] === 'fail' && r.warnings.includes('plugin-lifecycle (in-page) failed') && !r.gates.includes('plugin-lifecycle')) ||
      `status ${r.status} ${JSON.stringify(r.checks)} warnings ${r.warnings} gates ${r.gates}`,
  },
  {
    name: 'proxy-faked-lifecycle',
    expect: 'The same leak hidden behind a window.village Proxy fools the in-page check; that pass is not a gate, and the status still comes from the out-of-page gates only',
    executor: writeFiles({ 'home/src/plugins/leaky.ts': `${villageProxy}\n${leakyPlugin('leaky')}` }),
    verify: (r) =>
      (r.status === 'passed' &&
        r.checks['plugin-lifecycle'] === 'pass' &&
        r.inPageEvidence.includes('plugin-lifecycle') &&
        JSON.stringify(r.gates) === JSON.stringify(['controller-files', 'build', 'screenshot']) &&
        r.gates.every((g: string) => r.checks[g] === 'pass')) ||
      `status ${r.status} ${JSON.stringify(r.checks)} gates ${r.gates}`,
  },
  {
    name: 'claude-code-env-and-strict-mcp',
    expect: 'The real claude-code executor, run against a stand-in binary, passes only allowlisted variable names (a planted one is dropped) and the strict, empty MCP config',
    claudeBin: async () => (fake.honest ??= await fakeClaude(scratch[0], 'honest')).bin,
    setup: () => {
      process.env.ELDER_REGRESSION_CANARY = 'synthetic'
      cleanup.push(() => void delete process.env.ELDER_REGRESSION_CANARY)
    },
    verify: async (r) => {
      const seen = JSON.parse(await readFile(fake.honest.record, 'utf8')) as { argv: string[]; envNames: string[] }
      const extra = seen.envNames.filter((n) => !ALLOWED_ENV.includes(n) && n !== '__CF_USER_TEXT_ENCODING')
      const strict = seen.argv.includes('--strict-mcp-config') && seen.argv[seen.argv.indexOf('--mcp-config') + 1] === '{"mcpServers":{}}'
      return (r.executorOutcome?.status === 'completed' && r.status === 'passed' && extra.length === 0 && strict && r.executorOutcome.report.mcpServers.length === 0) ||
        `outcome ${JSON.stringify(r.executorOutcome)}, extra env names ${extra}, strict ${strict}`
    },
  },
  {
    name: 'claude-code-mcp-loaded-fails',
    expect: 'An executor whose init event lists an MCP server fails, and no check runs',
    claudeBin: async () => (fake.mcp ??= await fakeClaude(scratch[0], 'mcp-loaded')).bin,
    verify: (r) =>
      (r.status === 'failed' && r.executorOutcome?.status === 'failed' && /MCP loaded in the executor: servers \[slack\]/.test(r.executorOutcome.detail) && r.checks.build === 'not run') ||
      JSON.stringify(r.executorOutcome),
  },
  {
    name: 'empty-registry',
    expect: 'The run fails before copying: expected checks are not registered',
    noChecks: true,
    executor: writeFiles({ 'home/src/plugins/redbox.ts': visiblePlugin('redbox') }),
    verify: (r) => (r.status === 'failed' && /Expected checks are not registered: controller-files, build, screenshot, plugin-lifecycle/.test(r.error)) || r.error,
  },
  {
    name: 'copy-failure-writes-result',
    expect: 'A source that is not a git checkout: result.json records the failed copy',
    source: async () => {
      const dir = await mkdtemp(join(tmpdir(), 'elder-notgit-'))
      cleanup.push(() => rm(dir, { recursive: true, force: true }))
      return dir
    },
    executor: writeFiles({}),
    verify: (r) => (r.status === 'failed' && r.stage === 'copy' && /rev-parse/.test(r.error)) || `stage ${r.stage}: ${r.error}`,
  },
  {
    name: 'install-failure-writes-result',
    expect: 'npm ci fails in the candidate (no lockfile): result.json records the failed install',
    source: async () => {
      const dir = await repoWithoutLockfile()
      cleanup.push(() => rm(dir, { recursive: true, force: true }))
      return dir
    },
    executor: writeFiles({}),
    verify: (r) => (r.status === 'failed' && r.stage === 'install' && /npm ci failed/.test(r.error)) || `stage ${r.stage}: ${r.error}`,
  },
  {
    name: 'commit-failure-writes-result',
    expect: 'git add cannot read a plugin file (mode 000): result.json records the failed commit',
    executor: {
      async run(task) {
        const file = join(task.dir, 'home/src/plugins/locked.ts')
        await writeFile(file, visiblePlugin('locked'))
        await chmod(file, 0)
        return completed
      },
    },
    verify: (r) => (r.status === 'failed' && r.stage === 'commit' && /git add -A failed/.test(r.error) && !r.commit) || `stage ${r.stage}: ${r.error}`,
  },
  {
    name: 'spawn-error',
    expect: 'An executor binary that does not exist: result.json written, executor failed, checks not run',
    executor: {
      async run(task) {
        const result = await exec('/nonexistent/claude', ['-p', 'x'], { cwd: task.dir, env: {}, timeoutMs: 5000 })
        return { status: result.spawnError ? 'failed' : 'completed', exitCode: result.code, model: 'stub', durationMs: result.durationMs, detail: result.spawnError }
      },
    },
    verify: (r) =>
      (r.status === 'failed' && r.executorOutcome?.status === 'failed' && /ENOENT/.test(r.executorOutcome.detail) && r.checks.build === 'not run') || JSON.stringify(r.executorOutcome),
  },
  {
    name: 'timeout-validation',
    expect: 'NaN, 0, negative, fractional, infinite and over-limit timeouts are refused by exec, runOnce and the CLI; a valid one still kills the command on time',
    probe: async () => {
      const problems: string[] = []
      for (const bad of [NaN, 0, -1, 1.5, Infinity, MAX_TIMEOUT_MS + 1, Number('abc')]) {
        const outcome = await exec('/bin/sleep', ['2'], { cwd: '/', env: plainEnv, timeoutMs: bad }).then((r) => `ran (${r.durationMs} ms)`, (e) => (e instanceof RangeError ? 'refused' : String(e)))
        if (outcome !== 'refused') problems.push(`exec ${bad}: ${outcome}`)
      }
      const good = await exec('/bin/sleep', ['5'], { cwd: '/', env: plainEnv, timeoutMs: 300 })
      if (!good.timedOut || good.durationMs > 2000) problems.push(`valid timeout: timedOut ${good.timedOut} after ${good.durationMs} ms`)
      const root = new Context()
      const fiber = root.plugin(core)
      await fiber.await()
      const run = await runOnce(root.elder, { request: 'timeout-validation', executor: 'none', source, candidatesRoot, timeoutMs: NaN, keep: 100 })
      await fiber.dispose()
      if (run.result.status !== 'failed' || run.result.stage !== 'start' || !/Timeout must be/.test(run.result.error ?? '')) problems.push(`runOnce NaN: stage ${run.result.stage}, ${run.result.error}`)
      const cli = await exec(process.execPath, ['src/cli.ts', 'x', '--timeout-ms', 'abc', '--candidates', candidatesRoot], { cwd: source, env: plainEnv, timeoutMs: 20_000 })
      if (cli.code !== 2 || !/Timeout must be/.test(cli.stderr)) problems.push(`cli abc: exit ${cli.code} ${cli.stderr.slice(-200)}`)
      return problems.length === 0 || problems.join('; ')
    },
  },
  {
    name: 'timeout-escaped-child',
    expect: 'An executor whose grandchild leaves the process group and holds the pipes times out within the deadline plus the 1 s pipe grace (and 0.75 s slack)',
    timeoutMs: 3000,
    executor: {
      async run(task) {
        // The grandchild starts its own process group (detached) and inherits stdout/stderr, so `close` never comes.
        const script = `const { spawn } = require('node:child_process'); const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'inherit' }); require('node:fs').writeFileSync(${JSON.stringify(escapedPidFile)}, String(c.pid)); setInterval(() => {}, 1000)`
        const result = await exec(process.execPath, ['-e', script], { cwd: task.dir, env: {}, timeoutMs: 3000 })
        return { status: result.timedOut ? 'timeout' : 'completed', exitCode: result.code, model: 'stub', durationMs: result.durationMs }
      },
    },
    teardown: async () => {
      const pid = await readFile(escapedPidFile, 'utf8').catch(() => '')
      if (pid) {
        try {
          process.kill(Number(pid), 'SIGKILL')
        } catch {
          // Already gone.
        }
      }
      await rm(escapedPidFile, { force: true })
    },
    verify: (r) =>
      (r.status === 'failed' && r.executorOutcome?.status === 'timeout' && r.executorOutcome.durationMs >= 3000 && r.executorOutcome.durationMs < 4750 && r.checks.build === 'not run') ||
      JSON.stringify(r.executorOutcome),
  },
  {
    name: 'timeout-after-git-tamper',
    expect: 'An executor that rewrites .git/config then times out: no git command runs on the candidate, the run fails',
    timeoutMs: 2000,
    executor: {
      async run(task) {
        await writeFile(join(task.dir, '.git/config'), `[core]\n\trepositoryformatversion = 0\n[filter "x"]\n\tclean = touch ${escapePath}\n`)
        await writeFile(join(task.dir, '.gitattributes'), '* filter=x\n')
        return { status: 'timeout', exitCode: null, model: 'stub', durationMs: 2000 }
      },
    },
    verify: (r) => (r.status === 'failed' && r.commit === null && /\.git: config/.test(r.commitSkipped) && !existsSync(escapePath)) || `${r.commitSkipped} commit ${r.commit} escape ${existsSync(escapePath)}`,
  },
  {
    name: 'git-ignores-hooks-fsmonitor-global',
    expect: "The controller's git ignores a repo's hooksPath and fsmonitor and the user's global config: no marker is written and the global identity is not used",
    probe: async () => {
      const dir = await mkdtemp(join(tmpdir(), 'elder-gitprobe-'))
      const realHome = process.env.HOME
      try {
        const repo = join(dir, 'repo')
        const markers = { hook: join(dir, 'hook-ran'), fsmonitor: join(dir, 'fsmonitor-ran') }
        await mkdir(join(dir, 'hooks'), { recursive: true })
        for (const hook of ['pre-commit', 'post-commit', 'post-index-change']) {
          await writeFile(join(dir, 'hooks', hook), `#!/bin/sh\ntouch ${markers.hook}\n`)
          await chmod(join(dir, 'hooks', hook), 0o755)
        }
        await writeFile(join(dir, 'fsmonitor'), `#!/bin/sh\ntouch ${markers.fsmonitor}\n`)
        await chmod(join(dir, 'fsmonitor'), 0o755)
        await exec('git', ['init', '--quiet', repo], { cwd: dir, env: plainEnv, timeoutMs: 20_000 })
        await writeFile(join(repo, '.git/config'), `[core]\n\trepositoryformatversion = 0\n\thooksPath = ${join(dir, 'hooks')}\n\tfsmonitor = ${join(dir, 'fsmonitor')}\n`)
        await mkdir(join(dir, 'fakehome'))
        await writeFile(join(dir, 'fakehome', '.gitconfig'), '[user]\n\tname = Global Marker\n\temail = global-marker@example.invalid\n')
        await writeFile(join(repo, 'file.txt'), 'x')
        process.env.HOME = join(dir, 'fakehome')
        await mustGit(['add', '-A'], repo)
        await mustGit(['status', '--porcelain'], repo)
        const commit = await git(['-c', 'user.name=Elder', '-c', 'user.email=elder@example.invalid', 'commit', '--quiet', '-m', 'probe'], repo)
        const author = await git(['log', '-1', '--format=%ae'], repo)
        const identityUsed = await git(['config', '--get', 'user.email'], repo)
        const found = { hook: existsSync(markers.hook), fsmonitor: existsSync(markers.fsmonitor), globalEmail: identityUsed.stdout.trim() === 'global-marker@example.invalid' }
        return (commit.code === 0 && author.stdout.trim() === 'elder@example.invalid' && !found.hook && !found.fsmonitor && !found.globalEmail) || `commit exit ${commit.code}, author ${author.stdout.trim()}, ${JSON.stringify(found)}`
      } finally {
        process.env.HOME = realHome
        await rm(dir, { recursive: true, force: true })
      }
    },
  },
  {
    name: 'chrome-launch-failure',
    expect: 'Chrome fails to launch: screenshot fails with the launch error and no vite preview is left running',
    executor: writeFiles({ 'home/src/plugins/redbox.ts': visiblePlugin('redbox') }),
    setup: () => {
      const real = browserLauncher.launch
      let calls = 0
      // Let the base render launch normally; fail every launch after the executor.
      browserLauncher.launch = (...args) => (++calls > 1 ? Promise.reject(new Error('simulated Chrome launch failure')) : real(...args))
      cleanup.push(() => void (browserLauncher.launch = real))
    },
    verify: async (r) => {
      const preview = await exec('pgrep', ['-f', `${r.repo}/home/node_modules/.bin/vite preview`], { cwd: '/', env: plainEnv, timeoutMs: 10_000 })
      return (failedAt(r, 'screenshot') && /simulated Chrome launch failure/.test(JSON.stringify(r.checkDetails.screenshot.detail)) && preview.stdout.trim() === '') ||
        `${JSON.stringify(r.checks)} preview pids: ${preview.stdout.trim()}`
    },
  },
  {
    name: 'malicious-vite-config-under-srt',
    expect: 'Gate bypassed on purpose: vite build under srt exits non-zero with EPERM and writes nothing outside',
    probe: async () => {
      if (!controlRepo) return 'control-good-plugin did not leave a candidate to build'
      return sandboxContainsViteConfig(controlRepo)
    },
  },
  {
    name: 'browser-network-and-sandbox',
    expect: "The check browser cannot reach the internet or a non-preview loopback port, and runs with Chrome's sandbox on",
    probe: () => browserIsolated(),
  },
]

/** Second layer: even if the gate were bypassed, vite build under srt cannot write outside the candidate. */
async function sandboxContainsViteConfig(repo: string): Promise<string | true> {
  const config = join(repo, 'home', 'vite.config.ts')
  await writeFile(config, maliciousViteConfig)
  const sandbox = await createSandbox({ repo, network: 'none' })
  try {
    const result = await sandbox.run(join(repo, 'home/node_modules/.bin/vite'), ['build'], { cwd: join(repo, 'home'), timeoutMs: 60_000 })
    const blocked = /Operation not permitted|EPERM/.test(result.stdout + result.stderr)
    return (!existsSync(escapePath) && result.code !== 0 && blocked) || `exit ${result.code}, escape file ${existsSync(escapePath)}: ${(result.stdout + result.stderr).slice(-400)}`
  } finally {
    await sandbox.dispose()
    await rm(config, { force: true })
  }
}

/** Out-of-page view of the browser the checks launch: page fetches are blocked and no Chrome process has --no-sandbox. */
async function browserIsolated(): Promise<string | true> {
  const server = createServer((_, res) => res.end('ok')).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const allowed = (server.address() as { port: number }).port
  const other = createServer((_, res) => res.end('leak')).listen(0, '127.0.0.1')
  await once(other, 'listening')
  const blockedPort = (other.address() as { port: number }).port
  const profile = await mkdtemp(join(tmpdir(), 'elder-browser-'))
  const browser = await browserLauncher.launch(`127.0.0.1:${allowed}`, profile)
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${allowed}/`)
    const tries = await page.evaluate(async (urls) => {
      const out: Record<string, string> = {}
      for (const url of urls) out[url] = await fetch(url, { mode: 'no-cors' }).then((r) => r.text(), () => 'blocked')
      return out
    }, ['https://example.com/', 'http://1.1.1.1/', `http://127.0.0.1:${blockedPort}/`, `http://127.0.0.1:${allowed}/`])
    const ps = await exec('ps', ['-axo', 'args'], { cwd: '/', env: plainEnv, timeoutMs: 10_000 })
    const noSandbox = ps.stdout.split('\n').filter((l) => l.includes('--proxy-server=http://127.0.0.1:9') && l.includes('--no-sandbox')).length
    const ok = tries[`http://127.0.0.1:${allowed}/`] === 'ok' && Object.entries(tries).every(([u, v]) => u.endsWith(`:${allowed}/`) || v === 'blocked') && noSandbox === 0
    return ok || `fetches ${JSON.stringify(tries)}, Chrome processes with --no-sandbox: ${noSandbox}`
  } finally {
    await browser.close()
    server.close()
    other.close()
    await rm(profile, { recursive: true, force: true })
  }
}

async function runCase(c: Case): Promise<{ verdict: string | true; runDir?: string }> {
  if (c.probe) return { verdict: await c.probe() }
  const root = new Context()
  const fibers = [root.plugin(core), ...(c.noChecks ? [] : [root.plugin(homeChecks)])]
  const executor = c.claudeBin ? 'claude-code' : 'stub'
  if (c.claudeBin) fibers.push(root.plugin(claudeCode, { bin: await c.claudeBin() }))
  for (const fiber of fibers) await fiber.await()
  if (!c.claudeBin) register(root, root.elder.executors, 'stub', c.executor!)
  try {
    const run = await runOnce(root.elder, { request: c.name, executor, source: c.source ? await c.source() : source, candidatesRoot, timeoutMs: c.timeoutMs ?? 60_000, keep: 100 })
    const onDisk = JSON.parse(await readFile(run.resultPath, 'utf8'))
    if (c.name === 'control-good-plugin' && onDisk.status === 'passed') controlRepo = onDisk.repo
    return { verdict: await c.verify!(onDisk), runDir: dirname(run.resultPath) }
  } finally {
    for (const fiber of fibers.reverse()) await fiber.dispose()
  }
}

/** Entries in the user temp directory named elder-*, so each case can remove what it left. */
const tmpEntries = async () => new Set((await readdir(tmpdir())).filter((n) => n.startsWith('elder-')).map((n) => join(tmpdir(), n)))

let controlRepo: string | undefined
const selected = values.only ? cases.filter((c) => values.only!.split(',').includes(c.name)) : cases
await rm(candidatesRoot, { recursive: true, force: true })
await rm(escapePath, { force: true })
await mkdir(candidatesRoot, { recursive: true })
scratch.push(await mkdtemp(join(tmpdir(), 'elder-scratch-')))
const keepAcrossCases = new Set([candidatesRoot, escapePath, ...scratch])
const rows: { name: string; expect: string; ok: boolean; note: string; ms: number }[] = []
let hung = false
for (const c of selected) {
  const before = await tmpEntries()
  await c.setup?.()
  const t = performance.now()
  const deadline = c.probe ? PROBE_DEADLINE_MS : RUN_DEADLINE_MS
  let timer: NodeJS.Timeout | undefined
  let outcome: { verdict: string | true; runDir?: string }
  try {
    outcome = await Promise.race([
      runCase(c),
      new Promise<{ verdict: string }>((resolve) => {
        timer = setTimeout(() => resolve({ verdict: `no result within ${deadline} ms` }), deadline)
      }),
    ])
  } catch (error) {
    outcome = { verdict: `threw: ${error}` }
  } finally {
    clearTimeout(timer)
    await c.teardown?.()
    for (const undo of cleanup.splice(0)) await undo()
  }
  if (typeof outcome.verdict === 'string' && outcome.verdict.startsWith('no result within')) hung = true
  const ok = outcome.verdict === true
  // Hygiene: a passed case leaves nothing behind but the control candidate the srt probe builds.
  if (ok && outcome.runDir && c.name !== 'control-good-plugin') await rm(outcome.runDir, { recursive: true, force: true })
  for (const entry of await tmpEntries()) if (!before.has(entry) && !keepAcrossCases.has(entry)) await rm(entry, { recursive: true, force: true })
  const ms = Math.round(performance.now() - t)
  rows.push({ name: c.name, expect: c.expect, ok, note: ok ? '' : String(outcome.verdict), ms })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name} (${ms} ms) ${ok ? '' : outcome.verdict}`)
}
for (const dir of scratch) await rm(dir, { recursive: true, force: true })
await rm(escapePath, { force: true })
const passed = rows.filter((r) => r.ok).length
if (passed === rows.length) {
  await rm(candidatesRoot, { recursive: true, force: true })
  console.log(`Summary: ${passed}/${rows.length} as expected.`)
} else {
  await writeFile(join(candidatesRoot, 'regressions.json'), JSON.stringify(rows, null, 2) + '\n')
  console.log(`Summary: ${passed}/${rows.length} as expected. Kept for inspection: ${candidatesRoot}`)
}
process.exitCode = passed === rows.length ? 0 : 1
// A case that missed its deadline may still hold timers or children.
if (hung) process.exit()
