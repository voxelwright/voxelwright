// Re-runs each exploit from the bea598d review through the whole Elder run
// with a stub executor that writes the exploit's files. No model is called.
//
//   node test/regressions.ts [--only name,name] [--candidates DIR]
//
// Each case states the result it needs. The script exits 1 when any case
// does not get it.
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { Context } from 'cordis'
import { core, register, type Executor, type ExecutorTask } from '../src/elder.ts'
import { exec } from '../src/proc.ts'
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

const writeFiles = (files: Record<string, string>): Executor => ({
  async run(task: ExecutorTask) {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(task.dir, path)), { recursive: true })
      await writeFile(join(task.dir, path), text)
    }
    return { status: 'completed', exitCode: 0, model: 'stub', durationMs: 0 }
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

const maliciousViteConfig = `import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(escapePath)}, 'written by vite.config.ts during vite build')
export default {}
`

interface Case {
  name: string
  expect: string
  executor?: Executor
  /** Leave the checks plugin out entirely. */
  noChecks?: boolean
  timeoutMs?: number
  setup?: () => void
  teardown?: () => void
  verify: (result: any) => string | true | Promise<string | true>
}

const failedAt = (result: any, check: string) => result.status === 'failed' && result.checks?.[check] === 'fail'

const cases: Case[] = [
  {
    name: 'control-good-plugin',
    expect: 'A small visible plugin passes every gate (proves the gates can pass)',
    executor: writeFiles({ 'home/src/plugins/redbox.ts': visiblePlugin('redbox') }),
    verify: (r) => r.status === 'passed' || `status ${r.status}: ${JSON.stringify(r.checks)} ${r.error ?? ''}`,
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
        return { status: 'completed', exitCode: 0, model: 'stub', durationMs: 0 }
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
    name: 'empty-registry',
    expect: 'The run fails before copying: expected checks are not registered',
    noChecks: true,
    executor: writeFiles({ 'home/src/plugins/redbox.ts': visiblePlugin('redbox') }),
    verify: (r) => (r.status === 'failed' && /Expected checks are not registered: controller-files, build, screenshot, plugin-lifecycle/.test(r.error)) || r.error,
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
    name: 'timeout-escaped-child',
    expect: 'An executor whose grandchild leaves the process group and holds the pipes still times out within the deadline plus 5 s',
    timeoutMs: 3000,
    executor: {
      async run(task) {
        // The grandchild starts its own process group (detached) and inherits stdout/stderr, so `close` never comes.
        const script = `const { spawn } = require('node:child_process'); const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'inherit' }); require('node:fs').writeFileSync(${JSON.stringify(join(tmpdir(), 'elder-escaped.pid'))}, String(c.pid)); setInterval(() => {}, 1000)`
        const result = await exec(process.execPath, ['-e', script], { cwd: task.dir, env: {}, timeoutMs: 3000 })
        return { status: result.timedOut ? 'timeout' : 'completed', exitCode: result.code, model: 'stub', durationMs: result.durationMs }
      },
    },
    teardown: () => {
      void readFile(join(tmpdir(), 'elder-escaped.pid'), 'utf8').then((pid) => process.kill(Number(pid), 'SIGKILL')).catch(() => {})
    },
    verify: (r) => (r.status === 'failed' && r.executorOutcome?.status === 'timeout' && r.executorOutcome.durationMs < 9000 && r.checks.build === 'not run') || JSON.stringify(r.executorOutcome),
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
    name: 'chrome-launch-failure',
    expect: 'Chrome fails to launch: screenshot fails with the launch error and no vite preview is left running',
    executor: writeFiles({ 'home/src/plugins/redbox.ts': visiblePlugin('redbox') }),
    setup: () => {
      const real = browserLauncher.launch
      let calls = 0
      // Let the base render launch normally; fail every launch after the executor.
      browserLauncher.launch = (...args) => (++calls > 1 ? Promise.reject(new Error('simulated Chrome launch failure')) : real(...args))
      cleanup.push(() => (browserLauncher.launch = real))
    },
    verify: async (r) => {
      const preview = await exec('pgrep', ['-f', `${r.repo}/home/node_modules/.bin/vite preview`], { cwd: '/', env: { PATH: '/usr/bin:/bin' } })
      return (failedAt(r, 'screenshot') && /simulated Chrome launch failure/.test(JSON.stringify(r.checkDetails.screenshot.detail)) && preview.stdout.trim() === '') ||
        `${JSON.stringify(r.checks)} preview pids: ${preview.stdout.trim()}`
    },
  },
]
const cleanup: (() => void)[] = []

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
  const browser = await browserLauncher.launch(`127.0.0.1:${allowed}`, tmpdir())
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${allowed}/`)
    const tries = await page.evaluate(async (urls) => {
      const out: Record<string, string> = {}
      for (const url of urls) out[url] = await fetch(url, { mode: 'no-cors' }).then((r) => r.text(), () => 'blocked')
      return out
    }, ['https://example.com/', 'http://1.1.1.1/', `http://127.0.0.1:${blockedPort}/`, `http://127.0.0.1:${allowed}/`])
    const ps = await exec('ps', ['-axo', 'args'], { cwd: '/', env: { PATH: '/usr/bin:/bin' } })
    const noSandbox = ps.stdout.split('\n').filter((l) => l.includes('--proxy-server=http://127.0.0.1:9') && l.includes('--no-sandbox')).length
    const ok = tries[`http://127.0.0.1:${allowed}/`] === 'ok' && Object.entries(tries).every(([u, v]) => u.endsWith(`:${allowed}/`) || v === 'blocked') && noSandbox === 0
    return ok || `fetches ${JSON.stringify(tries)}, Chrome processes with --no-sandbox: ${noSandbox}`
  } finally {
    await browser.close()
    server.close()
    other.close()
  }
}

const selected = values.only ? cases.filter((c) => values.only!.split(',').includes(c.name)) : cases
await rm(candidatesRoot, { recursive: true, force: true })
await rm(escapePath, { force: true })
await mkdir(candidatesRoot, { recursive: true })
const rows: { name: string; expect: string; ok: boolean; note: string; result: string; ms: number }[] = []
let lastRepo: string | undefined
for (const c of selected) {
  const root = new Context()
  const fibers = [root.plugin(core), ...(c.noChecks ? [] : [root.plugin(homeChecks)])]
  for (const fiber of fibers) await fiber.await()
  register(root, root.elder.executors, 'stub', c.executor!)
  c.setup?.()
  const t = performance.now()
  let verdict: string | true
  let resultPath = ''
  try {
    const run = await runOnce(root.elder, { request: c.name, executor: 'stub', source, candidatesRoot, timeoutMs: c.timeoutMs ?? 60_000, keep: 100 })
    resultPath = run.resultPath
    const onDisk = JSON.parse(await readFile(run.resultPath, 'utf8'))
    verdict = await c.verify(onDisk)
    if (onDisk.repo && c.name === 'control-good-plugin') lastRepo = onDisk.repo
  } catch (error) {
    verdict = `runOnce threw: ${error}`
  } finally {
    c.teardown?.()
    for (const undo of cleanup.splice(0)) undo()
    for (const fiber of fibers.reverse()) await fiber.dispose()
  }
  rows.push({ name: c.name, expect: c.expect, ok: verdict === true, note: verdict === true ? '' : verdict, result: resultPath, ms: Math.round(performance.now() - t) })
  console.log(`${verdict === true ? 'PASS' : 'FAIL'} ${c.name} (${Math.round(performance.now() - t)} ms) ${verdict === true ? '' : verdict}`)
}
if (lastRepo) {
  const verdict = await sandboxContainsViteConfig(lastRepo)
  rows.push({ name: 'malicious-vite-config-under-srt', expect: 'Gate bypassed on purpose: vite build under srt exits non-zero with EPERM and writes nothing outside', ok: verdict === true, note: verdict === true ? '' : verdict, result: '', ms: 0 })
  console.log(`${verdict === true ? 'PASS' : 'FAIL'} malicious-vite-config-under-srt ${verdict === true ? '' : verdict}`)
}
{
  const verdict = await browserIsolated()
  rows.push({ name: 'browser-network-and-sandbox', expect: 'The check browser cannot reach the internet or a non-preview loopback port, and runs with Chrome\'s sandbox on', ok: verdict === true, note: verdict === true ? '' : verdict, result: '', ms: 0 })
  console.log(`${verdict === true ? 'PASS' : 'FAIL'} browser-network-and-sandbox ${verdict === true ? '' : verdict}`)
}
await writeFile(join(candidatesRoot, 'regressions.json'), JSON.stringify(rows, null, 2) + '\n')
console.log(`Summary: ${rows.filter((r) => r.ok).length}/${rows.length} as expected. ${join(candidatesRoot, 'regressions.json')}`)
process.exitCode = rows.every((r) => r.ok) ? 0 : 1
