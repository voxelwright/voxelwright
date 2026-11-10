// Every refusal of the approval rule (#87, src/approval.ts) and of the approval page's own
// server (src/approval-server.ts), without a browser or a model. The browser end to end is
// test/daily-home.ts and test/elder-home.ts.
//
//   npm run check-approval
import type { IncomingMessage } from 'node:http'
import { approvalOrigins, mayDecline, mayKeep, mayUndo, type Approval, type ApprovalRun } from '../src/approval.ts'
import { startApprovalServer } from '../src/approval-server.ts'
import { elderHome, type ElderHome } from '../src/elder-home.ts'
import { livePromotions, promote, recoverDeadLock, rollback } from '../src/promote.ts'
import { sha256 } from '../src/candidate.ts'
import { mustGit, processTag, tagRunning } from '../src/proc.ts'
import { IGNORED } from '../src/live.ts'
import type { Elder } from '../src/elder.ts'
import { existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const checks: { name: string; pass: boolean }[] = []
const check = (name: string, pass: unknown, detail?: unknown) => {
  checks.push({ name, pass: Boolean(pass) })
  if (!pass) console.log(`FAIL ${name} ${JSON.stringify(detail)}`)
}

const APPROVAL = 'http://localhost:5184'
const origins = approvalOrigins([`${APPROVAL}/`, 'http://127.0.0.1:5184/', 'https://mac.tailnet.ts.net:8443/'])
check('approval origins are the pages’ origins, once each', origins.join() === `${APPROVAL},http://127.0.0.1:5184,https://mac.tailnet.ts.net:8443`, origins)

const req = (over: { method?: string; site?: string | null; origin?: string | null; type?: string | null } = {}) =>
  ({
    method: over.method ?? 'POST',
    headers: {
      ...(over.site === null ? {} : { 'sec-fetch-site': over.site ?? 'same-origin' }),
      ...(over.origin === null ? {} : { origin: over.origin ?? APPROVAL }),
      ...(over.type === null ? {} : { 'content-type': over.type ?? 'application/json' }),
    },
  }) as unknown as IncomingMessage
const passed: ApprovalRun = { id: 'run-1', person: 'alex', status: 'passed' }
const kept: ApprovalRun = { id: 'run-1', person: 'alex', status: 'kept', promotion: 'p-1' }
const refused = (a: Approval, reason: string, status: number) => !a.ok && a.reason === reason && a.status === status

// Keep.
check('keep: the approval page, an operator, the run shown, passed: yes', mayKeep(req(), origins, true, 'alex', passed, 'run-1').ok)
check('keep: from the tailnet approval origin: yes', mayKeep(req({ origin: 'https://mac.tailnet.ts.net:8443' }), origins, true, 'alex', passed, 'run-1').ok)
check('keep: not an operator (403)', refused(mayKeep(req(), origins, false, 'alex', passed, 'run-1'), 'not-operator', 403))
check('keep: a GET (405)', refused(mayKeep(req({ method: 'GET' }), origins, true, 'alex', passed, 'run-1'), 'method', 405))
check('keep: no Sec-Fetch-Site (403)', refused(mayKeep(req({ site: null }), origins, true, 'alex', passed, 'run-1'), 'not-approval-origin', 403))
check('keep: same-site from the home (403)', refused(mayKeep(req({ site: 'same-site', origin: 'http://localhost:5183' }), origins, true, 'alex', passed, 'run-1'), 'not-approval-origin', 403))
check("keep: same-origin with the home's Origin (403)", refused(mayKeep(req({ origin: 'http://localhost:5183' }), origins, true, 'alex', passed, 'run-1'), 'not-approval-origin', 403))
check('keep: no Origin (403)', refused(mayKeep(req({ origin: null }), origins, true, 'alex', passed, 'run-1'), 'not-approval-origin', 403))
check('keep: not JSON (415)', refused(mayKeep(req({ type: 'text/plain' }), origins, true, 'alex', passed, 'run-1'), 'not-json', 415))
check('keep: no such run (404)', refused(mayKeep(req(), origins, true, 'alex', undefined, 'run-1'), 'no-run', 404))
check("keep: another person's run (404)", refused(mayKeep(req(), origins, true, 'sam', passed, 'run-1'), 'no-run', 404))
check('keep: naming another candidate (409)', refused(mayKeep(req(), origins, true, 'alex', passed, 'run-2'), 'not-shown', 409))
check('keep: already kept (409)', refused(mayKeep(req(), origins, true, 'alex', kept, 'run-1'), 'already-kept', 409))
for (const status of ['running', 'failed', 'interrupted', 'declined', 'undone'])
  check(`keep: a ${status} run (409)`, refused(mayKeep(req(), origins, true, 'alex', { ...passed, status }, 'run-1'), 'not-passed', 409))

// Undo.
check('undo: the approval page, an operator, the promotion shown, kept: yes', mayUndo(req(), origins, true, 'alex', kept, 'p-1').ok)
check('undo: not an operator (403)', refused(mayUndo(req(), origins, false, 'alex', kept, 'p-1'), 'not-operator', 403))
check('undo: another origin (403)', refused(mayUndo(req({ origin: 'http://evil.example' }), origins, true, 'alex', kept, 'p-1'), 'not-approval-origin', 403))
check('undo: not JSON (415)', refused(mayUndo(req({ type: 'application/x-www-form-urlencoded' }), origins, true, 'alex', kept, 'p-1'), 'not-json', 415))
check('undo: no such run (404)', refused(mayUndo(req(), origins, true, 'alex', undefined, 'p-1'), 'no-run', 404))
check('undo: not kept (409)', refused(mayUndo(req(), origins, true, 'alex', passed, 'p-1'), 'not-kept', 409))
check('undo: naming another promotion (409)', refused(mayUndo(req(), origins, true, 'alex', kept, 'p-2'), 'not-shown', 409))

// Not this.
check('decline: the approval page, an operator, a passed run: yes', mayDecline(req(), origins, true, 'alex', passed).ok)
check('decline: not an operator (403)', refused(mayDecline(req(), origins, false, 'alex', passed), 'not-operator', 403))
check('decline: no such run (404)', refused(mayDecline(req(), origins, true, 'alex', undefined), 'no-run', 404))
check('decline: a kept run (409)', refused(mayDecline(req(), origins, true, 'alex', kept), 'not-open', 409))
for (const status of ['running', 'declined', 'undone'])
  check(`decline: a ${status} run (409)`, refused(mayDecline(req(), origins, true, 'alex', { ...passed, status }), 'not-open', 409))
for (const status of ['failed', 'interrupted'])
  check(`decline: a ${status} run: yes`, mayDecline(req(), origins, true, 'alex', { ...passed, status }).ok)
check("decline: another person's run (404)", refused(mayDecline(req(), origins, true, 'sam', passed), 'no-run', 404))
check("undo: another person's run (404)", refused(mayUndo(req(), origins, true, 'sam', kept, 'p-1'), 'no-run', 404))
check('undo: an undone run, which still carries its last promotion (409 not-kept)', refused(mayUndo(req(), origins, true, 'alex', { ...kept, status: 'undone' }, 'p-1'), 'not-kept', 409))
check('undo: a kept run with no promotion recorded (409)', refused(mayUndo(req(), origins, true, 'alex', { ...kept, promotion: undefined }, 'p-1'), 'not-kept', 409))
check('decline: a GET (405), and the method is checked before anything else', refused(mayDecline(req({ method: 'GET', origin: 'http://evil.example' }), origins, false, 'alex', undefined), 'method', 405))
check('keep: an operator is checked before the run and the origin', refused(mayKeep(req({ origin: 'http://evil.example' }), origins, false, 'alex', undefined, 'x'), 'not-operator', 403))

const SECRET = 'a'.repeat(64)
const SAM_SECRET = 'b'.repeat(64)

// ── A Keep cut off by a stop (A1): the live home's promotions decide whether a change is in ──────────────────────
// A scratch live repo and a real candidate (a commit adding one plugin, recorded as passed), no build and no model.
const scratch = await mkdtemp(join(tmpdir(), 'approval-keep-'))
const GIT = ['-c', 'user.name=Check', '-c', 'user.email=check@village.invalid']
const live = join(scratch, 'live')
const candidatesRoot = join(scratch, 'candidates')
const elderRoot = join(scratch, 'root')
const PLUGIN = 'home/src/plugins/bell.ts'
async function repo(dir: string, files: Record<string, string>) {
  await mkdir(join(dir, 'home/src/plugins'), { recursive: true })
  await mustGit(['init', '--quiet', '-b', 'main'], dir)
  for (const [path, text] of Object.entries(files)) await writeFile(join(dir, path), text)
  await mustGit(['add', '-A'], dir)
  await mustGit([...GIT, 'commit', '--quiet', '-m', 'base'], dir)
  return mustGit(['rev-parse', 'HEAD'], dir)
}
async function candidate(id: string, pictures = false) {
  const dir = join(candidatesRoot, id, 'repo')
  const base = await repo(dir, { 'home/src/plugins/.keep': '' })
  await writeFile(join(dir, PLUGIN), `export default { name: '${id}', apply() {} }\n`)
  await mustGit(['add', '-A'], dir)
  await mustGit([...GIT, 'commit', '--quiet', '-m', 'bell'], dir)
  const commit = await mustGit(['rev-parse', 'HEAD'], dir)
  await writeFile(join(candidatesRoot, id, 'result.json'), JSON.stringify({ status: 'passed', files: { [PLUGIN]: await sha256(join(dir, PLUGIN)) }, commit, baseCommit: base, checks: { 'controller-files': 'pass' } }))
  const at = new Date().toISOString()
  await mkdir(join(elderRoot, 'elder'), { recursive: true })
  if (pictures) for (const name of ['base.png', 'screenshot.png']) await writeFile(join(candidatesRoot, id, name), Buffer.from('89504e470d0a1a0a', 'hex'))
  await appendFile(join(elderRoot, 'elder', 'runs.jsonl'), JSON.stringify({ e: 'asked', id, person: 'alex', request: 'a bell', at }) + '\n' + JSON.stringify({ e: 'finished', id, at, status: 'passed', stages: [], pictures }) + '\n')
}
await repo(live, { 'promotions.jsonl': '', 'home/src/plugins/.keep': '', '.gitignore': IGNORED.join('\n') + '\n' })
await candidate('run-a', true)
await candidate('run-b')
const boot = async () => {
  // Two operators: Sam's session is SAM_SECRET.
  const home = await elderHome(elderRoot, { elder: {} as Elder, executor: 'stub', source: scratch, candidatesRoot, live, operators: ['alex', 'sam'], approvalUrls: (port) => [`http://localhost:${port}/`] })
  const holder = async (r: IncomingMessage) => {
    const c = String(r.headers.cookie ?? '')
    return c.includes(`village_session=${SECRET}`) ? { person: 'alex', tag: 't' } : c.includes(`village_session=${SAM_SECRET}`) ? { person: 'sam', tag: 's' } : undefined
  }
  const srv = await startApprovalServer({ port: 0, elder: home, people: { alex: 'Alex', sam: 'Sam' }, holder })
  home.approvalListening(srv.port)
  const at = `http://127.0.0.1:${srv.port}/villager/api/people/alex/elder/runs/`
  const act = (run: string, what: string, body: unknown) =>
    fetch(at + `${run}/${what}`, { method: 'POST', headers: { cookie: `village_session=${SECRET}`, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: `http://localhost:${srv.port}` }, body: JSON.stringify(body) })
  const read = async (run: string) => ((await (await fetch(at + run, { headers: { cookie: `village_session=${SECRET}` } })).json()) as { run: { status: string; promotion?: string } }).run
  return { home, srv, act, read }
}
const entries = async () => (await readFile(join(live, 'promotions.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { type: string; candidate?: string })
try {
  // Two hosts on one root (B3): a run still going in another live host is not marked interrupted; a dead host's is.
  // Owners are `<pid>@<start>` (proc.ts processTag): another host is a real other process here; a pid with another
  // start time (a reboot reused it, even for this very process) and an old record with a bare pid read as gone.
  const otherHost = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 300))
  const otherTag = `${otherHost.pid}@${Date.parse(spawnSync('ps', ['-o', 'lstart=', '-p', String(otherHost.pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).stdout.trim())}`
  // ps prints the start time in the user's language; a live owner must still read as running under another locale.
  const localeBefore = process.env.LC_ALL
  process.env.LC_ALL = 'uk_UA.UTF-8'
  check('a live owner reads as running whatever language ps answers in', tagRunning(otherTag))
  // A process's own tag, as processTag() writes it, and the same pid with another start time (a pid given out again).
  const tagged = spawn(process.execPath, ['-e', "process.stdout.write(process.pid + '@' + Math.round(performance.timeOrigin)); setTimeout(() => {}, 60000)"], { stdio: ['ignore', 'pipe', 'ignore'] })
  const realTag = await new Promise<string>((r) => tagged.stdout!.once('data', (d) => r(String(d))))
  const [tpid, tstart] = realTag.split('@')
  check("another process's own tag reads as running, and its pid with another start reads as gone, in any language", tagRunning(realTag) && !tagRunning(`${tpid}@${Number(tstart) - 3_600_000}`), realTag)
  tagged.kill()
  if (localeBefore === undefined) delete process.env.LC_ALL
  else process.env.LC_ALL = localeBefore
  // Where no live home is installed, recovery finds nothing and makes nothing (an empty .git would pass for an install).
  const noLive = join(elderRoot, 'no-live-here')
  check('recovery where no live home exists returns nothing and creates nothing', (await recoverDeadLock(noLive)) === null && !existsSync(noLive))
  const reusedTag = `${process.pid}@${Math.round(performance.timeOrigin) - 3_600_000}`
  const askedAt = new Date().toISOString()
  const askedBy = (id: string, more: Record<string, unknown>) => JSON.stringify({ e: 'asked', id, person: 'alex', request: 'a lamp', at: askedAt, ...more }) + '\n'
  await appendFile(join(elderRoot, 'elder', 'runs.jsonl'), askedBy('run-x', { owner: otherTag }) + askedBy('run-y', { owner: reusedTag }) + askedBy('run-z', { pid: process.pid }))
  let host = await boot()
  const ownerStates = [(await host.read('run-x')).status, (await host.read('run-y')).status, (await host.read('run-z')).status]
  check("a starting host leaves another live host's run running; this pid with an earlier start, and a bare pid, read as gone (interrupted)", ownerStates.join() === 'running,interrupted,interrupted', ownerStates)
  otherHost.kill()
  // Every answer from the approval server carries its policy, the Elder's pictures and the session included (A6).
  const framed = (r: Response) => /frame-ancestors 'none'/.test(r.headers.get('content-security-policy') ?? '') && r.headers.get('x-frame-options') === 'DENY'
  const picture = await fetch(`http://127.0.0.1:${host.srv.port}/villager/api/people/alex/elder/runs/run-a/after`, { headers: { cookie: `village_session=${SECRET}` } })
  const session = await fetch(`http://127.0.0.1:${host.srv.port}/villager/api/session`, { headers: { cookie: `village_session=${SECRET}` } })
  check('the approval server’s picture and session answers carry frame-ancestors none and X-Frame-Options DENY', picture.status === 200 && picture.headers.get('content-type') === 'image/png' && framed(picture) && session.status === 200 && framed(session), [picture.status, picture.headers.get('x-frame-options'), session.headers.get('x-frame-options')])
  // The approval server's own refusals, with the real Elder behind it.
  const base = `http://127.0.0.1:${host.srv.port}`
  const cookie = { cookie: `village_session=${SECRET}` }
  const page = await fetch(`${base}/`)
  const csp = page.headers.get('content-security-policy') ?? ''
  check('the page: strict policy, no framing, its own opener group, no referrer', page.status === 200 && /default-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /form-action 'none'/.test(csp) && !/unsafe/.test(csp) && page.headers.get('x-frame-options') === 'DENY' && page.headers.get('cross-origin-opener-policy') === 'same-origin' && page.headers.get('referrer-policy') === 'no-referrer', csp)
  const html = await page.text()
  check('the page loads only its own script and style, and has no inline script', /<script src="\/approval.js" defer><\/script>/.test(html) && !/<script>/.test(html) && !/https?:\/\//.test(html.replace(/<meta[^>]*>/g, '')))
  check('a POST to the page is refused (405)', (await fetch(`${base}/`, { method: 'POST' })).status === 405)
  check('any other file is not there (404)', (await fetch(`${base}/../src/approval.ts`)).status === 404 && (await fetch(`${base}/index.html`)).status === 404)
  check('the API without a session is 401', (await fetch(`${base}/villager/api/session`)).status === 401)
  check('a cross-site or same-site read is refused before the session is looked at (403)', (await fetch(`${base}/villager/api/session`, { headers: { ...cookie, 'sec-fetch-site': 'same-site' } })).status === 403 && (await fetch(`${base}/villager/api/session`, { headers: { ...cookie, 'sec-fetch-site': 'cross-site' } })).status === 403)
  const who = await fetch(`${base}/villager/api/session`, { headers: cookie })
  check('the session says who, and nothing else', who.status === 200 && JSON.stringify(await who.json()) === '{"person":"alex","name":"Alex"}')
  check("another person's path is not found (404)", (await fetch(`${base}/villager/api/people/sam/elder/runs/run-a`, { headers: cookie })).status === 404)
  check('only the Elder is served: other paths, and starting a run here, are not found (404)', (await fetch(`${base}/villager/api/people/alex/conversation`, { headers: cookie })).status === 404 && (await fetch(`${base}/villager/api/people/alex/elder/runs`, { method: 'POST', headers: { ...cookie, 'content-type': 'application/json' }, body: '{"text":"a bell"}' })).status === 404)
  // C1: the home's own handler does not route the decisions at all, so the home answers them 404.
  const homeAnswer = await new Promise<number>((resolve) => {
    const fake = { method: 'POST', headers: {}, async *[Symbol.asyncIterator]() {} } as unknown as IncomingMessage
    void host.home.handle('/people/alex/elder/runs/run-a/keep', fake, {} as Parameters<ElderHome['handle']>[2], 'alex', () => resolve(-1)).then((handled) => resolve(handled ? 200 : 404))
  })
  check("the home's handler does not route Keep (the home's server answers 404)", homeAnswer === 404)
  // Refusals at the approval server are recorded under the run.
  const recordBefore = (await readFile(join(elderRoot, 'elder', 'runs.jsonl'), 'utf8')).split('\n').length
  const wrong = await host.act('run-a', 'keep', { candidate: 'not-this-one' })
  const recordAfter = (await readFile(join(elderRoot, 'elder', 'runs.jsonl'), 'utf8')).split('\n').length
  check('a refusal at the approval server is recorded in the run record', wrong.status === 409 && recordAfter === recordBefore + 1, [wrong.status, recordBefore, recordAfter])
  // Keep, then a stop and a start (a real stop in the middle of one is test/stop.ts).
  const first = await host.act('run-a', 'keep', { candidate: 'run-a' })
  await host.home.close()
  const late = await host.act('run-a', 'keep', { candidate: 'run-a' })
  host.srv.close()
  check('keep goes in; once the house is stopping, a new Keep is refused plainly (503)', first.status === 200 && existsSync(join(live, PLUGIN)) && late.status === 503 && /stopping/.test(((await late.json()) as { message?: string }).message ?? ''), [first.status, late.status])
  host = await boot()
  const after = await host.read('run-a')
  check('after the restart the run reads kept, with its promotion, from the live home', after.status === 'kept' && Boolean(after.promotion), after)
  const again = await host.act('run-a', 'keep', { candidate: 'run-a' })
  const direct = await promote({ candidate: 'run-a', approve: true, candidatesRoot, live })
  check('Keep again is refused, and promote() itself refuses a candidate already in (already-promoted)', again.status === 409 && direct.result === 'refused' && direct.reason === 'already-promoted', [again.status, direct.reason])
  check('exactly one promotion entry for the candidate', (await entries()).filter((e) => e.type === 'promotion' && e.candidate === 'run-a').length === 1)
  const undo = await host.act('run-a', 'undo', { promotion: after.promotion })
  check('Undo really takes the plugin out, and the run reads undone', undo.status === 200 && !existsSync(join(live, PLUGIN)) && (await host.read('run-a')).status === 'undone' && !(await livePromotions(live)).open.has('run-a'))
  // A rollback from the Workshop (the command line) shows on the card too.
  const kept = await host.act('run-b', 'keep', { candidate: 'run-b' })
  const workshop = await rollback({ target: 'last', live })
  // Another operator names Alex's run on their own path: not found, nothing about the run, and Alex's record gains nothing.
  const recordBeforeSam = await readFile(join(elderRoot, 'elder', 'runs.jsonl'), 'utf8')
  const samKeep = await fetch(`http://127.0.0.1:${host.srv.port}/villager/api/people/sam/elder/runs/run-b/keep`, { method: 'POST', headers: { cookie: `village_session=${SAM_SECRET}`, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: `http://localhost:${host.srv.port}` }, body: JSON.stringify({ candidate: 'run-b' }) })
  const samBody = (await samKeep.json()) as Record<string, unknown>
  check("another operator's Keep on someone else's run id is 404, says nothing of the run, and records nothing", samKeep.status === 404 && !('run' in samBody) && (await readFile(join(elderRoot, 'elder', 'runs.jsonl'), 'utf8')) === recordBeforeSam, [samKeep.status, Object.keys(samBody)])
  check('a Workshop rollback reads undone, not kept', kept.status === 200 && workshop.result === 'rolled-back' && (await host.read('run-b')).status === 'undone')
  await host.home.close()
  host.srv.close()

  // Start-up recovery of the promote lock (items 3, 4).
  const promoteLock = join(live, '.git', 'village-promote.lock')
  const dirty = async () => {
    await writeFile(join(live, 'home/src/plugins/half.ts'), 'export default {}\n')
  }
  await writeFile(promoteLock, '')
  await dirty()
  check('an empty promote lock is left alone (never taken for a dead owner)', (await recoverDeadLock(live)) === null && existsSync(promoteLock) && existsSync(join(live, 'home/src/plugins/half.ts')))
  await writeFile(promoteLock, processTag())
  check('a lock tagged with this process is left alone', (await recoverDeadLock(live)) === null && existsSync(promoteLock))
  await writeFile(promoteLock, reusedTag)
  const reused = await recoverDeadLock(live)
  check('a lock tagged with this pid but an earlier start (a reboot) is recovered', reused?.holder === reusedTag && !existsSync(promoteLock) && !existsSync(join(live, 'home/src/plugins/half.ts')), reused)
  await dirty()
  await writeFile(promoteLock, `${otherTag.split('@')[0]}`)
  const both = await Promise.allSettled([recoverDeadLock(live), recoverDeadLock(live)])
  check('two recoveries at once over a dead lock both return, one of them recovering', both.every((r) => r.status === 'fulfilled') && both.filter((r) => r.status === 'fulfilled' && r.value).length === 1 && !existsSync(promoteLock), both.map((r) => r.status))

  // A record whose last line was cut short (B2): the next event still starts a line of its own and is read back.
  const at = new Date().toISOString()
  await appendFile(join(elderRoot, 'elder', 'runs.jsonl'), JSON.stringify({ e: 'asked', id: 'run-c', person: 'alex', request: 'a clock', at }) + '\n' + JSON.stringify({ e: 'finished', id: 'run-c', at, status: 'passed', stages: [], pictures: false }) + '\n' + '{"e":"refused","id":"run-c","at":')
  host = await boot()
  const declined = await host.act('run-c', 'decline', {})
  await host.home.close()
  host.srv.close()
  host = await boot()
  check('after a torn last line, the next event (Not this) is kept and read back after a restart', declined.status === 200 && (await host.read('run-c')).status === 'declined')
  await host.home.close()
  host.srv.close()
} finally {
  await rm(scratch, { recursive: true, force: true })
}

const failed = checks.filter((c) => !c.pass)
console.log(`${checks.length - failed.length} of ${checks.length} passed`)
process.exit(failed.length ? 1 : 0)
