// End-to-end proof of promotion and rollback (#43), with stub executors, so no
// model is called. It installs a scratch live home, serves it, opens it in
// headless Chrome, promotes a checked candidate that adds a red box, waits for
// the box to show in the running page without a reload, rolls back, waits for
// it to go, and then exercises every refusal through the CLI.
//
//   node test/promote.ts [--port 5183] [--keep]
//
// Writes host/proof/<timestamp>-promote.json. Exits 1 when any step fails.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Context } from 'cordis'
import { chromium, type Page } from 'playwright'
import { PNG } from 'pngjs'
import { sha256 } from '../src/candidate.ts'
import { core, register, type Executor } from '../src/elder.ts'
import { ELDER_IDENTITY, install } from '../src/live.ts'
import homeChecks from '../src/plugins/home-checks.ts'
import { exec, killGroup, mustGit } from '../src/proc.ts'
import { promote, rollback } from '../src/promote.ts'
import { runOnce } from '../src/run.ts'

const { values } = parseArgs({ options: { port: { type: 'string', default: '5183' }, keep: { type: 'boolean', default: false } } })
const port = Number(values.port)
const source = process.cwd()
const scratch = await mkdtemp(join(tmpdir(), 'elder-promote-'))
const live = join(scratch, 'live')
const candidatesRoot = join(scratch, 'candidates')
const PLUGIN = 'home/src/plugins/promobox.ts'
const steps: { step: string; ok: boolean; detail?: unknown }[] = []
const timings: Record<string, number> = {}
const check = (step: string, ok: boolean, detail?: unknown) => {
  steps.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`)
}

const promobox = `import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'

/** A small red box above the table: the promotion proof's visible object. */
export default {
  name: 'promobox',
  inject: ['stage'],
  apply(ctx: Context) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xff2200 }))
    box.name = 'promobox'
    box.position.set(0, 1.2, 0)
    own(ctx, box)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
`

const completed = { status: 'completed', exitCode: 0, model: 'stub', durationMs: 0 } as const
const executors: Record<string, Executor> = {
  'stub-promobox': {
    async run(task) {
      await writeFile(join(task.dir, PLUGIN), promobox)
      return completed
    },
  },
  'stub-fails': { run: async () => ({ ...completed, status: 'failed', exitCode: 1 }) },
  'stub-gitignore': {
    async run(task) {
      await writeFile(join(task.dir, PLUGIN), promobox)
      await writeFile(join(task.dir, 'home/src/plugins/.gitignore'), '*.ts\n')
      return completed
    },
  },
}

async function candidate(executor: string) {
  const root = new Context()
  const fibers = [root.plugin(core), root.plugin(homeChecks)]
  for (const fiber of fibers) await fiber.await()
  for (const [name, ex] of Object.entries(executors)) register(root, root.elder.executors, name, ex)
  try {
    return (await runOnce(root.elder, { request: `promote proof: ${executor}`, executor, source, candidatesRoot, timeoutMs: 60_000, keep: 100 })).result
  } finally {
    for (const fiber of fibers.reverse()) await fiber.dispose()
  }
}

/** The Elder CLI, as a person runs it. */
async function elder(args: string[]) {
  const run = await exec(process.execPath, ['src/cli.ts', ...args, '--live', live, '--candidates', candidatesRoot], { cwd: source, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '' }, timeoutMs: 60_000 })
  const json = run.stdout.slice(run.stdout.indexOf('\n{') + 1)
  return { code: run.code, message: run.stdout.split('\n')[0], outcome: JSON.parse(json || '{}') }
}

async function lastResult() {
  const lines = (await readFile(join(live, 'results.jsonl'), 'utf8')).trim().split('\n')
  return JSON.parse(lines.at(-1)!)
}

function changedShare(a: Buffer, b: Buffer): number {
  const x = PNG.sync.read(a)
  const y = PNG.sync.read(b)
  let changed = 0
  for (let i = 0; i < x.data.length; i += 4) if (Math.abs(x.data[i] - y.data[i]) > 8 || Math.abs(x.data[i + 1] - y.data[i + 1]) > 8 || Math.abs(x.data[i + 2] - y.data[i + 2]) > 8) changed++
  return changed / (x.width * x.height)
}

/** Share of pixels that are the box's red now but were not in the base: the pixel diff aimed at the promoted object. */
function redGain(a: Buffer, b: Buffer): number {
  const x = PNG.sync.read(a)
  const y = PNG.sync.read(b)
  const red = (d: Buffer, i: number) => d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 80
  let gained = 0
  for (let i = 0; i < y.data.length; i += 4) if (red(y.data, i) && !red(x.data, i)) gained++
  return gained / (y.width * y.height)
}

const active = (page: Page) => page.evaluate(() => (window as unknown as { village: { snapshot: () => { plugins: { active: string[] } } } }).village.snapshot().plugins.active)

/** Poll until the page shows (or no longer shows) promobox, by the kernel's active list and by pixels. */
async function waitFor(page: Page, base: Buffer, present: boolean, threshold: number, timeoutMs = 10_000) {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    const isActive = (await active(page)).includes('promobox')
    const shot = await page.screenshot()
    const red = redGain(base, shot)
    if (isActive === present && (present ? red > threshold : red < threshold / 10)) return { ms: Math.round(performance.now() - start), redGain: red, changedShare: changedShare(base, shot), isActive }
    await new Promise((r) => setTimeout(r, 100))
  }
  const shot = await page.screenshot()
  return { ms: -1, redGain: redGain(base, shot), changedShare: changedShare(base, shot), isActive: (await active(page)).includes('promobox') }
}

let server: ChildProcess | undefined
const serverLog: string[] = []
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  // 1. Live install and server.
  let t = performance.now()
  const installed = await install(live, source)
  timings.installMs = Math.round(performance.now() - t)
  check('live install is a physical copy at a recorded commit', installed.inodes.candidateFiles > 0, { sourceCommit: installed.sourceCommit, ...installed.inodes })
  server = spawn(process.execPath, ['src/live.ts', 'serve', '--live', live, '--port', String(port)], { cwd: source, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stderr!.on('data', (d: Buffer) => serverLog.push(String(d)))
  await new Promise<void>((resolve, reject) => {
    server!.stdout!.on('data', (d: Buffer) => (serverLog.push(String(d)), String(d).includes('"serving"') && resolve()))
    server!.on('exit', (code) => reject(new Error(`live server exited ${code}`)))
  })

  // 2. Candidates, through the real Elder run with stub executors.
  t = performance.now()
  const good = await candidate('stub-promobox')
  timings.passingCandidateMs = Math.round(performance.now() - t)
  check('passing candidate', good.status === 'passed', { id: good.id, checks: good.checks, files: good.files })
  const bad = await candidate('stub-fails')
  check('failing candidate', bad.status === 'failed', { id: bad.id, checks: bad.checks })

  // 3. The running page.
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  let loads = 0
  page.on('load', () => (loads++, serverLog.push(`[proof] page load ${loads}\n`)))
  await page.goto(`http://127.0.0.1:${port}/?q=low`)
  const ready = await page.evaluate(() => (window as unknown as { village: { ready: (ms: number) => Promise<{ ok: boolean }> } }).village.ready(30_000))
  check('live page ready', ready.ok)
  const csp = (await fetch(`http://127.0.0.1:${port}/`)).headers.get('content-security-policy') ?? ''
  check('live-csp: the live server sends the home\'s Content Security Policy', /default-src 'self'/.test(csp) && /connect-src 'self'(;|$)/.test(csp), csp)
  await page.evaluate(() => Object.assign(window, { promoteMarker: 'still here' }))
  await new Promise((r) => setTimeout(r, 1000))
  const before = await page.screenshot()
  await new Promise((r) => setTimeout(r, 500))
  const second = await page.screenshot()
  const noise = { changedShare: changedShare(before, second), redGain: redGain(before, second) }
  // The box covers about 1% of the frame; the threshold sits well above measured red noise.
  const threshold = Math.max(0.002, noise.redGain * 10)
  check('baseline noise measured', noise.redGain < 0.0005, { noise, threshold })

  // 4. Promote, and see it in the running page.
  t = performance.now()
  const promoted = await elder(['promote', good.id as string, '--approve'])
  const promoteCliMs = Math.round(performance.now() - t)
  check('promote succeeds', promoted.code === 0 && promoted.outcome.result === 'promoted', { message: promoted.message, cliMs: promoteCliMs })
  const shown = await waitFor(page, before, true, threshold)
  timings.promoteCliMs = promoteCliMs
  timings.promotedToVisibleMs = shown.ms
  check('promobox visible without reload', shown.ms >= 0 && loads === 1 && (await page.evaluate(() => (window as unknown as { promoteMarker?: string }).promoteMarker)) === 'still here', { ...shown, loads })
  const liveHash = await sha256(join(live, PLUGIN))
  const entry = promoted.outcome.promotion
  check('promotion entry and hashes', liveHash === (good.files as Record<string, string>)[PLUGIN] && entry?.files[PLUGIN].before === null && entry?.files[PLUGIN].after === liveHash && (await mustGit(['status', '--porcelain'], live)) === '', { promotion: entry?.id, liveHash, liveCommit: promoted.outcome.liveCommit })

  // 5. Roll back, and see it go.
  t = performance.now()
  const rolled = await elder(['rollback', 'last'])
  timings.rollbackCliMs = Math.round(performance.now() - t)
  check('rollback succeeds', rolled.code === 0 && rolled.outcome.result === 'rolled-back', { message: rolled.message })
  const gone = await waitFor(page, before, false, threshold)
  timings.rollbackToGoneMs = gone.ms
  check('promobox gone without reload', gone.ms >= 0 && loads === 1, { ...gone, loads })
  const restored = await sha256(join(live, PLUGIN)).catch(() => null)
  check('files match previous hashes', restored === entry.files[PLUGIN].before && rolled.outcome.rollback.files[PLUGIN].after === null && (await mustGit(['status', '--porcelain'], live)) === '', { restored })

  // 6. Refusals: each is refused, explained, and recorded in results.jsonl.
  const refusal = async (step: string, args: string[], reason: string) => {
    const r = await elder(args)
    const recorded = await lastResult()
    check(`refuses: ${step}`, r.code === 1 && r.outcome.reason === reason && recorded.result === 'refused' && recorded.reason === reason, { message: r.message })
  }
  await refusal('no --approve', ['promote', good.id as string], 'not-approved')
  await refusal('missing candidate', ['promote', 'no-such-candidate', '--approve'], 'missing-candidate')
  await refusal('failed candidate', ['promote', bad.id as string, '--approve'], 'not-passed')
  const candidateFile = join(good.repo as string, PLUGIN)
  const original = await readFile(candidateFile)
  await appendFile(candidateFile, '// edited after the check\n')
  await refusal('files changed since checked', ['promote', good.id as string, '--approve'], 'changed-since-check')
  await writeFile(candidateFile, original)
  await writeFile(join(live, 'home', 'NOTES.txt'), 'an uncommitted note\n')
  await refusal('live has uncommitted changes', ['promote', good.id as string, '--approve'], 'live-uncommitted')
  await rm(join(live, 'home', 'NOTES.txt'))
  const again = await elder(['promote', good.id as string, '--approve'])
  check('promote again after refusals', again.outcome.result === 'promoted')
  await appendFile(join(live, PLUGIN), '// a hand edit in the live home\n')
  await mustGit([...ELDER_IDENTITY, 'commit', '--quiet', '-am', 'A manual edit'], live)
  await refusal('rollback past a manual edit', ['rollback', 'last'], 'manual-edit')
  check('page never reloaded', loads === 1, { loads })

  // 7. Regressions for Sentinel's promotion findings, in process.
  const head = () => mustGit(['rev-parse', 'HEAD'], live)
  const clean = async () => (await mustGit(['status', '--porcelain'], live)) === ''
  const settle = (p: Promise<{ result: string; reason?: string }>) => p.then((o) => o.reason ?? o.result, (e) => `threw: ${e}`)
  const promoteGood = () => promote({ candidate: good.id as string, approve: true, candidatesRoot, live })
  await mustGit(['rm', '--quiet', '--', PLUGIN], live)
  await mustGit([...ELDER_IDENTITY, 'commit', '--quiet', '-m', 'Remove promobox by hand'], live)

  // Two promotions at once: one goes in, the other is refused, and history has one commit.
  let h0 = await head()
  const pair = (await Promise.all([settle(promoteGood()), settle(promoteGood())])).sort()
  const added = (await mustGit(['rev-list', '--count', `${h0}..HEAD`], live)).trim()
  check('promote-concurrent-refused: a second promotion at the same time is refused', pair.join() === 'live-busy,promoted' && added === '1' && (await clean()), { pair, added })
  await settle(rollback({ target: 'last', live }))
  await writeFile(join(live, '.git', 'village-promote.lock'), '999999')
  const stale = await settle(promoteGood())
  check('promote-stale-lock-refused: a lock left behind is refused and named', stale === 'live-busy' && (await lastResult()).message.includes('village-promote.lock'), { stale })
  await rm(join(live, '.git', 'village-promote.lock'))

  // The candidate file is swapped right after its hash is checked: only the committed bytes may reach live.
  const swappedText = 'export default { name: "swapped", apply() { fetch("https://example.invalid") } }\n'
  const realStream = fs.createReadStream
  let swapped = false
  fs.createReadStream = ((path: fs.PathLike, ...rest: unknown[]) => {
    const stream = (realStream as (...a: unknown[]) => fs.ReadStream)(path, ...rest)
    if (!swapped && String(path) === candidateFile)
      stream.once('end', () => {
        swapped = true
        fs.writeFileSync(candidateFile, swappedText)
      })
    return stream
  }) as typeof fs.createReadStream
  syncBuiltinESMExports()
  h0 = await head()
  const results0 = (await readFile(join(live, 'results.jsonl'), 'utf8')).split('\n').length
  const swapOutcome = await settle(promoteGood())
  fs.createReadStream = realStream
  syncBuiltinESMExports()
  const liveText = await readFile(join(live, PLUGIN), 'utf8').catch(() => null)
  const recordedSwap = (await readFile(join(live, 'results.jsonl'), 'utf8')).split('\n').length > results0
  check(
    'promote-swap-after-check: a file swapped after its check never reaches live; live gets the committed bytes or stays unchanged, and the attempt is recorded',
    swapped && !swapOutcome.startsWith('threw') && recordedSwap && (await clean()) && liveText !== swappedText && (swapOutcome === 'promoted' ? (await sha256(join(live, PLUGIN))) === (good.files as Record<string, string>)[PLUGIN] : (await head()) === h0),
    { swapped, swapOutcome, recordedSwap },
  )
  await writeFile(candidateFile, original)
  if (swapOutcome === 'promoted') await settle(rollback({ target: 'last', live }))

  // Writing into live fails partway: refused, recorded, live unchanged.
  await mkdir(join(live, PLUGIN))
  h0 = await head()
  const blocked = await settle(promoteGood())
  check('promote-write-failure-refused: a failed write is a recorded refusal and live is unchanged', blocked === 'write-failed' && (await lastResult()).reason === 'write-failed' && (await head()) === h0 && (await clean()), { blocked })
  await rm(join(live, PLUGIN), { recursive: true, force: true })

  // A candidate that adds a .gitignore beside its plugin, which could hide later edits.
  const hiding = await candidate('stub-gitignore')
  h0 = await head()
  const ignored = hiding.status === 'passed' ? await settle(promote({ candidate: hiding.id as string, approve: true, candidatesRoot, live })) : `candidate ${hiding.status}`
  check('promote-gitignore-refused: only home/src/plugins/<name>.ts can be promoted', ignored === 'controller-owned' && (await head()) === h0 && !fs.existsSync(join(live, 'home/src/plugins/.gitignore')), { ignored, files: hiding.files })
} catch (error) {
  check('proof ran to the end', false, String(error))
} finally {
  await browser.close()
  if (server?.pid) killGroup(server.pid, 'SIGTERM')
  const ok = steps.every((s) => s.ok)
  if (!ok) console.log(serverLog.join(''))
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
  await writeFile(join(source, 'proof', `${stamp}-promote.json`), JSON.stringify({ ok, timings, steps }, null, 2) + '\n')
  if (!values.keep) await rm(scratch, { recursive: true, force: true })
  console.log(`${ok ? 'All' : 'Not all'} ${steps.filter((s) => s.ok).length}/${steps.length} steps passed. Timings: ${JSON.stringify(timings)}`)
  process.exitCode = ok ? 0 : 1
}
