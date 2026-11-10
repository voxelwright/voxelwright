// A real stop of the host during Keep or Undo (#87): the villager host (`villager-cli --agent stub`) runs in a child
// process over a scratch live repo and real candidates (a commit adding one plugin each, recorded as passed). A
// SIGTERM 20 ms after a Keep or an Undo must leave no promote lock and a clean live tree, and Keep or Undo works after
// a restart. A SIGKILL mid-Keep, and a lock left by a process that is gone with the tree half changed, are recovered on
// start. No model, no browser.
//
//   node test/stop.ts [--host 5354] [--dev 5355] [--approval 5356]
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { sha256 } from '../src/candidate.ts'
import { IGNORED } from '../src/live.ts'
import { pairingStore } from '../src/pairing.ts'
import { mustGit } from '../src/proc.ts'

const { values } = parseArgs({ options: { host: { type: 'string', default: '5354' }, dev: { type: 'string', default: '5355' }, approval: { type: 'string', default: '5356' } } })
const hostPort = Number(values.host)
const devPort = Number(values.dev)
const approvalPort = Number(values.approval)
const checks: { name: string; pass: boolean }[] = []
const check = (name: string, pass: unknown, detail?: unknown) => {
  checks.push({ name, pass: Boolean(pass) })
  console.log(`${pass ? 'pass' : 'FAIL'}  ${name}${pass ? '' : `  ${JSON.stringify(detail)}`}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const scratch = await mkdtemp(join(tmpdir(), 'stop-check-'))
const root = join(scratch, 'root')
const live = join(scratch, 'live')
const candidatesRoot = join(scratch, 'candidates')
const PLUGIN = 'home/src/plugins/bell.ts'
const GIT = ['-c', 'user.name=Check', '-c', 'user.email=check@village.invalid']
const lock = join(live, '.git', 'village-promote.lock')

async function repo(dir: string, files: Record<string, string>) {
  await mkdir(join(dir, 'home/src/plugins'), { recursive: true })
  await mustGit(['init', '--quiet', '-b', 'main'], dir)
  for (const [path, text] of Object.entries(files)) await writeFile(join(dir, path), text)
  await mustGit(['add', '-A'], dir)
  await mustGit([...GIT, 'commit', '--quiet', '-m', 'base'], dir)
  return mustGit(['rev-parse', 'HEAD'], dir)
}
async function candidate(id: string) {
  const dir = join(candidatesRoot, id, 'repo')
  const base = await repo(dir, { 'home/src/plugins/.keep': '' })
  await writeFile(join(dir, PLUGIN), `export default { name: '${id}', apply() {} }\n`)
  await mustGit(['add', '-A'], dir)
  await mustGit([...GIT, 'commit', '--quiet', '-m', 'bell'], dir)
  const commit = await mustGit(['rev-parse', 'HEAD'], dir)
  await writeFile(join(candidatesRoot, id, 'result.json'), JSON.stringify({ status: 'passed', files: { [PLUGIN]: await sha256(join(dir, PLUGIN)) }, commit, baseCommit: base, checks: { 'controller-files': 'pass' } }))
  const at = new Date().toISOString()
  await mkdir(join(root, 'elder'), { recursive: true })
  await appendFile(join(root, 'elder', 'runs.jsonl'), JSON.stringify({ e: 'asked', id, person: 'alex', request: 'a bell', at }) + '\n' + JSON.stringify({ e: 'finished', id, at, status: 'passed', stages: [], pictures: false }) + '\n')
}

let child: ChildProcess | undefined
function start(): Promise<ChildProcess> {
  const c = spawn(process.execPath, ['src/villager-cli.ts', '--agent', 'stub', '--port', String(hostPort), '--home', `http://localhost:${devPort}/`, '--approval-port', String(approvalPort), '--root', root, '--candidates', candidatesRoot, '--live', live], { env: { ...process.env, VILLAGER_PEOPLE: 'alex:Alex' }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    let out = ''
    const read = (d: Buffer) => ((out += d), /listening on/.test(out) && resolve(c))
    c.stdout!.on('data', read)
    c.stderr!.on('data', read)
    c.on('exit', (code) => reject(new Error(`host exited ${code}: ${out.replace(/pair=\w+/g, 'pair=…').slice(-400)}`)))
  })
}
const exited = (c: ChildProcess) => new Promise<void>((resolve) => (c.exitCode !== null || c.signalCode !== null ? resolve() : c.once('exit', () => resolve())))

/** A session for Alex, paired on the home's host (as through its dev server), so the approval page opens it. */
async function pair() {
  const code = await pairingStore(root).mint('alex', { keep: true })
  return new Promise<string>((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port: hostPort, path: '/pair', method: 'POST', headers: { host: `localhost:${devPort}`, 'content-type': 'application/json' } }, (res) => {
      res.resume()
      resolve(String(res.headers['set-cookie'] ?? '').split(';')[0])
    })
    r.on('error', reject)
    r.end(JSON.stringify({ code }))
  })
}
let cookie = ''
const approvalBase = `http://localhost:${approvalPort}/villager/api/people/alex/elder/runs/`
const act = (run: string, what: string, body: unknown) =>
  fetch(`${approvalBase}${run}/${what}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: `http://localhost:${approvalPort}` }, body: JSON.stringify(body) })
const read = async (run: string) => ((await (await fetch(`${approvalBase}${run}`, { headers: { cookie } })).json()) as { run: { status: string; promotion?: string } }).run
const clean = async () => (await mustGit(['status', '--porcelain'], live)) === ''
/** Keep a passed run, or Undo a kept one: whichever it is now. */
const decideNow = async (run: string) => {
  const now = await read(run)
  const r = now.status === 'kept' ? await act(run, 'undo', { promotion: now.promotion }) : await act(run, 'keep', { candidate: run })
  return { was: now.status, status: r.status }
}

try {
  await repo(live, { 'promotions.jsonl': '', 'home/src/plugins/.keep': '', '.gitignore': IGNORED.join('\n') + '\n' })
  for (const id of ['run-a', 'run-b', 'run-c', 'run-d', 'run-e']) await candidate(id)
  child = await start()
  cookie = await pair()
  check('the host serves the run through the approval page', (await read('run-a')).status === 'passed')

  // SIGTERM 20 ms after Keep: the stop waits for the Keep.
  const keeping = act('run-a', 'keep', { candidate: 'run-a' }).then((r) => r.status, () => 0)
  await sleep(20)
  child.kill('SIGTERM')
  const keptStatus = await keeping
  await exited(child)
  check('SIGTERM 20 ms after a Keep: no promote lock left, the live tree is clean, and the Keep was answered', !existsSync(lock) && (await clean()) && keptStatus === 200, { lock: existsSync(lock), keptStatus })
  child = await start()
  const afterKeep = await decideNow('run-a')
  check('after the restart Keep or Undo answers 200', afterKeep.status === 200, afterKeep)

  // SIGTERM 20 ms after Undo.
  await act('run-d', 'keep', { candidate: 'run-d' })
  const kept = await read('run-d')
  const undoing = act('run-d', 'undo', { promotion: kept.promotion }).then((r) => r.status, () => 0)
  await sleep(20)
  child.kill('SIGTERM')
  const undoStatus = await undoing
  await exited(child)
  check('SIGTERM 20 ms after an Undo: no promote lock left, the live tree is clean, and the Undo was answered', kept.status === 'kept' && !existsSync(lock) && (await clean()) && undoStatus === 200, { lock: existsSync(lock), undoStatus, kept: kept.status })
  child = await start()
  const afterUndo = await act('run-e', 'keep', { candidate: 'run-e' })
  check('after the restart Keep answers 200 again, and the Undo stands', afterUndo.status === 200 && (await read('run-d')).status === 'undone', afterUndo.status)
  await act('run-e', 'undo', { promotion: (await read('run-e')).promotion })

  // SIGKILL mid-Keep: no time to wait. The next start puts things right.
  const killing = act('run-b', 'keep', { candidate: 'run-b' }).catch(() => null)
  await sleep(60)
  child.kill('SIGKILL')
  await killing
  await exited(child)
  const leftLock = existsSync(lock)
  child = await start()
  const record = (await readFile(join(root, 'elder', 'runs.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { e: string })
  check('SIGKILL mid-Keep: after the restart no lock, a clean tree, and a left lock is recorded as recovered', !existsSync(lock) && (await clean()) && (!leftLock || record.some((e) => e.e === 'recovered')), { leftLock })
  const afterKill = await decideNow('run-b')
  check('after it Keep or Undo answers 200', afterKill.status === 200, afterKill)

  // Ctrl+C reaches the whole process group and npm forwards it again: two signals in a row are still one stop.
  const twice = decideNow('run-b').then((r) => r.status, () => 0)
  await sleep(20)
  child.kill('SIGINT')
  await sleep(10) // apart, or the kernel delivers the two as one
  child.kill('SIGINT')
  const twiceStatus = await twice
  await exited(child)
  check('two SIGINTs 20 ms after a Keep or Undo: it was answered, no promote lock left, the live tree is clean', twiceStatus === 200 && !existsSync(lock) && (await clean()), { twiceStatus, lock: existsSync(lock) })
  child = await start()

  // A Keep whose body never arrives is not a decision in flight: it must not hold the stop.
  const stalled = connect(approvalPort, '127.0.0.1')
  await new Promise((r) => stalled.once('connect', r))
  stalled.on('error', () => {})
  stalled.write(`POST /villager/api/people/alex/elder/runs/run-b/keep HTTP/1.1\r\nHost: localhost:${approvalPort}\r\nCookie: ${cookie}\r\nContent-Type: application/json\r\nSec-Fetch-Site: same-origin\r\nOrigin: http://localhost:${approvalPort}\r\nContent-Length: 40\r\n\r\n{"candidate":`)
  await sleep(200)
  const stopAt = Date.now()
  child.kill('SIGTERM')
  await Promise.race([exited(child), sleep(20_000)])
  const stopMs = Date.now() - stopAt
  stalled.destroy()
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await exited(child)
  check('a Keep whose body stalls does not hold the stop (under 5 s)', stopMs < 5000, stopMs)
  child = await start()

  // A lock whose owner is gone, with the tree half changed (a promotion cut off before its commit).
  child.kill('SIGTERM')
  await exited(child)
  const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim()
  await writeFile(lock, gone)
  await writeFile(join(live, 'home/src/plugins/half.ts'), 'export default {}\n')
  await appendFile(join(live, 'promotions.jsonl'), '{"type":"promotion","id":"p-cut","candidate":"run-c","files":{}}\n')
  child = await start()
  const recovered = (await readFile(join(root, 'elder', 'runs.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { e: string; holder?: string; discarded?: string[] }).filter((e) => e.e === 'recovered').at(-1)
  check("a dead owner's lock: on start the tree is put back to its last commit, the lock removed, and it is recorded", !existsSync(lock) && (await clean()) && !existsSync(join(live, 'home/src/plugins/half.ts')) && recovered?.holder === gone && (recovered?.discarded ?? []).length === 2, recovered)
  const afterRecovery = await act('run-c', 'keep', { candidate: 'run-c' })
  check('then Keep works (200), and run-c was never in the home', afterRecovery.status === 200, afterRecovery.status)
  // Never while the owner is alive: a lock naming a running process stays, and Keep says the home is busy.
  child.kill('SIGTERM')
  await exited(child)
  // This check's own process, tagged as an owner (pid and start): it is running, so its lock stays.
  await writeFile(lock, `${process.pid}@${Math.round(performance.timeOrigin)}`)
  child = await start()
  const busy = await decideNow('run-b')
  check("a lock whose owner is still running is left alone (live-busy)", existsSync(lock) && busy.status === 409, busy)
  await rm(lock, { force: true })
} catch (error) {
  check('the check ran to the end', false, String((error as Error).stack ?? error))
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    await exited(child)
  }
  await rm(scratch, { recursive: true, force: true })
}
const failed = checks.filter((c) => !c.pass)
console.log(`${checks.length - failed.length} of ${checks.length} passed`)
process.exit(failed.length ? 1 : 0)
