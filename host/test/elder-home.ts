// End-to-end proof of the Elder from inside the home (#87), with stub executors and
// the stub router, so no model is called. It installs a scratch live home, starts the
// villager host (`--agent stub`) and the home's dev server on temporary folders, and
// in headless Chrome: writes "Elder, put a small brass bell on the table" on the
// notepad, watches the card's stages, opens the approval page from the card's link,
// presses Keep there with the keyboard, checks the live copy has the plugin, presses
// Undo there and checks it is gone. Then every refusal: a non-operator, a visit, a
// second run, a failed gate (reason on the card), a candidate edited after its check,
// forged approvals (no browser headers, cross-site, another origin, the home's own API
// even with the approval Origin forged, another candidate, the router's and the
// candidate's own claims), and a run interrupted by a restart.
//
//   node test/elder-home.ts [--dev 5350] [--host 5351] [--live-port 5352] [--approval 5353] [--shots DIR] [--keep]
//   node test/elder-home.ts --real [--shots DIR]   one real run through the page (claude-code, the operator's login)
//
// Writes host/proof/<timestamp>-elder-home.json (not committed). Exits 1 when any step fails.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Page } from 'playwright'
import { STUB_BELL } from '../src/elder-stubs.ts'
import { install } from '../src/live.ts'
import { mustGit } from '../src/proc.ts'
import { pairingStore } from '../src/pairing.ts'
import { pairDevice } from './paired.ts'

const { values } = parseArgs({
  options: {
    dev: { type: 'string', default: '5350' },
    host: { type: 'string', default: '5351' },
    'live-port': { type: 'string', default: '5352' },
    approval: { type: 'string', default: '5353' },
    shots: { type: 'string' },
    keep: { type: 'boolean', default: false },
    real: { type: 'boolean', default: false },
  },
})
const devPort = Number(values.dev)
const hostPort = Number(values.host)
const livePort = Number(values['live-port'])
const approvalPort = Number(values.approval)
const approvalOrigin = `http://localhost:${approvalPort}`
const source = process.cwd()
const homeDir = join(source, '..', 'home')
const scratch = await mkdtemp(join(tmpdir(), 'elder-home-'))
const root = join(scratch, 'root')
const candidates = join(scratch, 'candidates')
const live = join(scratch, 'live')
const base = `http://localhost:${devPort}/`
const shots = values.shots
if (shots) await mkdir(shots, { recursive: true })
const steps: { step: string; ok: boolean; detail?: unknown }[] = []
const measured: Record<string, unknown> = {}
const check = (step: string, ok: boolean, detail?: unknown) => {
  steps.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 400)}`)
}

const children = new Set<ChildProcess>()
function start(cmd: string, argv: string[], cwd: string, env: Record<string, string>, ready: RegExp, ms = 90_000): Promise<ChildProcess> {
  // Synthetic people only; the environment is the shell's minus nothing secret printed (output is never logged).
  const child = spawn(cmd, argv, { cwd, env: { ...process.env, ...env } as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`${cmd} did not start: ${out.replace(/pair=\w+/g, 'pair=…').slice(-400)}`)), ms)
    const read = (d: Buffer) => {
      out += d
      if (ready.test(out)) {
        clearTimeout(timer)
        resolve(child)
      }
    }
    child.stdout!.on('data', read)
    child.stderr!.on('data', read)
    child.on('exit', (code) => reject(new Error(`${cmd} exited ${code}: ${out.replace(/pair=\w+/g, 'pair=…').slice(-400)}`)))
  })
}
const stop = (child: ChildProcess | undefined, signal: NodeJS.Signals = 'SIGTERM') =>
  new Promise<void>((resolve) => {
    if (!child || !children.has(child)) return resolve()
    child.once('exit', () => resolve())
    process.kill(-child.pid!, signal)
  })

/** One paired session per person (#85), made once and kept across the restart: sessions survive it. */
const sessions: Record<string, string> = {}
async function sessionOf(person: string) {
  sessions[person] ??= (await pairDevice(pairingStore(root), `http://localhost:${devPort}/villager/api`, person)) ?? ''
  return sessions[person]
}
let host: ChildProcess | undefined
const startHost = () =>
  start(
    process.execPath,
    ['src/villager-cli.ts', '--agent', 'stub', '--port', String(hostPort), '--root', root, '--candidates', candidates, '--live', live, '--home', base, '--elder-per-hour', '4', '--approval-port', String(approvalPort), ...(values.real ? ['--elder-executor', 'claude-code'] : [])],
    source,
    { VILLAGER_PEOPLE: 'alex:Alex,sam:Sam,mia:Mia' },
    /listening on/,
  )

/** The host directly, as any local program could call it: a paired session, but no browser headers unless given. */
async function api(person: string, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; as?: string; approval?: boolean } = {}) {
  // Through the home's dev server and the approval page's own port, as a browser reaches them: a session opens only the home it was paired on.
  const res = await fetch(`http://localhost:${init.approval ? approvalPort : devPort}/villager/api${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { cookie: `village_session=${await sessionOf(init.as ?? person)}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const type = res.headers.get('content-type') ?? ''
  return { status: res.status, json: type.startsWith('application/json') ? ((await res.json()) as Record<string, any>) : null }
}
/** Headers a browser would send for a same-origin POST from the approval page. Forging them proves nothing about browsers; it shows what the host checks besides them. */
const pageHeaders = { 'sec-fetch-site': 'same-origin', origin: approvalOrigin }
/** The approval server, as the approval page reaches it. */
const approve = (person: string, path: string, init: { body?: unknown; headers?: Record<string, string>; as?: string } = {}) => api(person, path, { ...init, approval: true })
/** A choice on the approval page by keyboard: Enter held (A3); a tap of Enter chooses nothing. */
async function holdKey(page: Page, ms = 1000) {
  // Focus may have left the page and come back on the way here, which restarts the arming delay.
  await new Promise((r) => setTimeout(r, 1200))
  await page.keyboard.down('Enter')
  await new Promise((r) => setTimeout(r, ms))
  await page.keyboard.up('Enter')
}
/** Opens the approval page from the card's link (decide or undo), as a person's click does. */
async function openApproval(page: Page, key: 'decide' | 'undo') {
  const [approval] = await Promise.all([page.context().waitForEvent('page'), page.locator(`.elder-card a[data-key="${key}"]`).click()])
  await approval.waitForLoadState()
  await approval.bringToFront()
  // A person's first act on the page arms it (A3): here a Tab, as by keyboard.
  await approval.locator('.actions button').first().waitFor({ timeout: 10_000 })
  for (let i = 0; i < 5 && (await approval.locator('.actions button[aria-disabled="false"]').count()) === 0; i++) {
    // One Tab, then longer than the arming delay: more Tabs would walk focus out of the page, which disarms it.
    await approval.keyboard.press('Tab')
    await new Promise((r) => setTimeout(r, 2000))
  }
  await approval.locator('.actions button[aria-disabled="false"]').first().waitFor({ timeout: 10_000 })
  return approval
}
const promotions = async () => (await readFile(join(live, 'promotions.jsonl'), 'utf8')).split('\n').filter(Boolean).length
const liveHead = () => mustGit(['rev-parse', 'HEAD'], live)

const elder = (page: Page) => page.evaluate(() => (window as any).village?.talk?.state().elder ?? null)
async function until<T>(get: () => Promise<T>, test: (v: T) => boolean, ms = 240_000, every = 250): Promise<T> {
  const end = Date.now() + ms
  let v = await get()
  while (!test(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, every))
    v = await get()
  }
  return v
}
async function shot(page: Page, name: string) {
  if (!shots) return
  const box = await page.locator('.elder-card').boundingBox()
  await page.screenshot({ path: join(shots, `${name}.png`) })
  if (box) await page.screenshot({ path: join(shots, `${name}-card.png`), clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 24), width: box.width + 48, height: box.height + 48 } })
}
async function openHome(page: Page) {
  // A query that changes each time, so a new link reloads the page rather than only changing the fragment.
  await page.goto(`${base}?open=${Date.now()}#pair=${await pairingStore(root).mint('alex', { keep: true })}`)
  await page.evaluate(() => (window as any).village.ready())
  await page.waitForTimeout(800)
}
async function write(page: Page, text: string) {
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}
/** Tab from the page's start until `selector` has the keyboard; how many presses it took, or -1. */
async function tabTo(page: Page, selector: string, max = 40) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab')
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return i
  }
  return -1
}

/** Follows a run through the page's card, sampling what it shows, until it is no longer running. */
async function follow(page: Page) {
  const seen: { at: number; stages: string }[] = []
  const t0 = Date.now()
  const final = await until(
    async () => {
      const s = await elder(page)
      const line = (s?.stages ?? []).map((x: { name: string; state: string }) => `${x.name}:${x.state}`).join(' ')
      if (line && seen.at(-1)?.stages !== line) seen.push({ at: Date.now() - t0, stages: line })
      return s
    },
    (s) => s?.status && s.status !== 'running',
    values.real ? 900_000 : 900_000,
  )
  return { final, seen }
}

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let liveServer: ChildProcess | undefined
let vite: ChildProcess | undefined
const t0 = Date.now()
try {
  const installed = await install(live, source)
  measured.liveInstallMs = installed.installMs
  liveServer = await start(process.execPath, ['src/live.ts', 'serve', '--live', live, '--port', String(livePort)], source, {}, /serving/)
  host = await startHost()
  vite = await start('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGER_PORT: String(hostPort) }, /Local:/)
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await openHome(page)
  const headBefore = await liveHead()

  if (!values.real) {
    // ── Who may ask ────────────────────────────────────────────────────────
    const samAsk = await api('sam', '/people/sam/elder/runs', { body: { text: 'Elder, put a bell on the table' } })
    check('a non-operator asking gets a plain refusal and no run starts', samAsk.status === 403 && samAsk.json?.refused === 'not-operator' && !existsSync(join(root, 'elder', 'runs.jsonl')) || (samAsk.status === 403 && !(await readFile(join(root, 'elder', 'runs.jsonl'), 'utf8')).trim()), { status: samAsk.status, message: samAsk.json?.message })
    const samState = await api('sam', '/people/sam/elder')
    check('a non-operator sees only that they are not one', samState.status === 200 && samState.json?.operator === false && !('run' in (samState.json ?? {})), samState.json)
    const visit = await api('alex', '/people/alex/visits/sam/elder/runs', { body: { text: 'Elder, put a bell on the table' } })
    check('a visit never reaches the Elder (404)', visit.status === 404, visit.status)
    const cross = await api('alex', '/people/alex/elder/runs', { body: { text: 'Elder, put a bell on the table' }, as: 'sam' })
    check("another person's session on the operator's path is refused (403)", cross.status === 403, cross.status)
  }

  // ── Ask through the notepad ──────────────────────────────────────────────
  const line = values.real ? 'Elder, put a small brass bell on the table' : 'Elder, put a small brass bell on the table'
  const asked = Date.now()
  await write(page, line)
  const started = await until(() => elder(page), (s) => s?.status === 'running', 30_000)
  measured.enterToCardMs = Date.now() - asked
  check('the notepad line starts a run and the card shows it', started?.status === 'running', { quip: (await page.evaluate(() => (window as any).village.talk.state().input?.quips?.at(-1)?.text)), stages: started?.stages })
  await page.waitForTimeout(400)
  await shot(page, '1-running')
  if (!values.real) {
    const second = await api('alex', '/people/alex/elder/runs', { body: { text: 'Elder, add a clock above the window' } })
    check('a second ask while one runs is refused in plain words (409)', second.status === 409 && /already making a change/.test(second.json?.message ?? ''), second.json)
    const early = await approve('alex', `/people/alex/elder/runs/${started.id}/keep`, { body: { candidate: started.id }, headers: pageHeaders })
    check('Keep on a run still going is refused', early.status === 409 && early.json?.refused === 'not-passed', early.json)
  }
  let midShot = false
  const { final, seen } = await (async () => {
    const r = follow(page)
    // A frame mid-way, when the Elder is writing or the gates are running.
    void until(() => elder(page), (s) => s?.stages?.some((x: { name: string; state: string }) => (x.name === 'write' || x.name === 'build') && x.state === 'now'), 300_000, 200).then(async (s) => {
      if (s?.status === 'running' && !midShot) {
        midShot = true
        await shot(page, '2-gates')
      }
    })
    return r
  })()
  measured.stagesSeen = seen
  const hostRun = (await api('alex', `/people/alex/elder/runs/${final.id}`)).json?.run
  measured.run = { status: hostRun?.status, totalMs: hostRun?.totalMs, costUsd: hostRun?.costUsd, model: hostRun?.model, stages: hostRun?.stages, reason: hostRun?.reason, detail: hostRun?.detail, warning: hostRun?.warning }
  const order = ['copy', 'install', 'before', 'write', 'controller-files', 'build', 'screenshot']
  const nowSeen = order.filter((name) => seen.some((s) => s.stages.includes(`${name}:now`)))
  check('the card showed each stage as it went (copy, install, before, write, each gate)', nowSeen.length >= 6, { nowSeen, samples: seen.length })
  check('the run passed', final.status === 'passed', { reason: final.reason, detail: hostRun?.detail })
  if (final.status !== 'passed') throw new Error('the run did not pass; the rest needs a passed candidate')
  const pics = await until(() => elder(page), (s) => s?.pictures, 10_000)
  await page.locator('.elder-flip-button[data-key="before"]').click()
  const beforeAlt = await page.locator('.elder-photo img').getAttribute('alt')
  await page.locator('.elder-flip-button[data-key="after"]').click()
  check('before and after pictures are on the card, switched in one frame', pics?.pictures === true && /before/.test(beforeAlt ?? '') && /with the change/.test((await page.locator('.elder-photo img').getAttribute('alt')) ?? ''), beforeAlt)
  const picOther = await api('sam', `/people/alex/elder/runs/${final.id}/after`, { as: 'sam' })
  const picSam = await api('sam', `/people/sam/elder/runs/${final.id}/after`)
  check("the pictures are served only to the person who asked", picOther.status === 403 && picSam.status === 403, [picOther.status, picSam.status])
  await page.waitForTimeout(300)
  await shot(page, '3-passed')

  if (!values.real) {
    // ── Nothing but a person's press keeps it ───────────────────────────────
    const noHeaders = await approve('alex', `/people/alex/elder/runs/${final.id}/keep`, { body: { candidate: final.id } })
    const crossSite = await approve('alex', `/people/alex/elder/runs/${final.id}/keep`, { body: { candidate: final.id }, headers: { 'sec-fetch-site': 'cross-site', origin: 'http://evil.example' } })
    const sameSite = await approve('alex', `/people/alex/elder/runs/${final.id}/keep`, { body: { candidate: final.id }, headers: { 'sec-fetch-site': 'same-site', origin: new URL(base).origin } })
    const otherOrigin = await approve('alex', `/people/alex/elder/runs/${final.id}/keep`, { body: { candidate: final.id }, headers: { 'sec-fetch-site': 'same-origin', origin: 'http://localhost:9' } })
    const homeApi = await api('alex', `/people/alex/elder/runs/${final.id}/keep`, { body: { candidate: final.id }, headers: pageHeaders })
    const homeUndo = await api('alex', `/people/alex/elder/runs/${final.id}/undo`, { body: { promotion: 'x' }, headers: pageHeaders })
    const homeDecline = await api('alex', `/people/alex/elder/runs/${final.id}/decline`, { body: {}, headers: pageHeaders })
    const textPlain = await approve('alex', `/people/alex/elder/runs/${final.id}/keep`, { body: { candidate: final.id }, headers: { ...pageHeaders, 'content-type': 'text/plain' } })
    const otherCandidate = await approve('alex', `/people/alex/elder/runs/${final.id}/keep`, { body: { candidate: 'some-other-candidate' }, headers: pageHeaders })
    const samKeep = await approve('sam', `/people/sam/elder/runs/${final.id}/keep`, { body: { candidate: final.id }, headers: pageHeaders })
    const samOnAlex = await approve('alex', `/people/alex/elder/runs/${final.id}/keep`, { body: { candidate: final.id }, headers: pageHeaders, as: 'sam' })
    const unpaired = await fetch(`${approvalOrigin}/villager/api/people/alex/elder/runs/${final.id}/keep`, { method: 'POST', headers: { 'content-type': 'application/json', ...pageHeaders }, body: JSON.stringify({ candidate: final.id }) })
    check('Keep without the browser same-origin header is refused', noHeaders.status === 403 && noHeaders.json?.refused === 'not-approval-origin', noHeaders.json?.refused)
    check('a cross-site Keep is refused', crossSite.status === 403, crossSite.json?.refused)
    check("a same-site Keep from the home's origin (cookies ignore ports) is refused", sameSite.status === 403 && sameSite.json?.refused === 'not-approval-origin', sameSite.json?.refused)
    check('a Keep from another origin is refused', otherOrigin.status === 403 && otherOrigin.json?.refused === 'not-approval-origin', otherOrigin.json?.refused)
    check("Keep, Undo and Not this are not routed on the home's own API (404), even with the approval page's headers forged", [homeApi, homeUndo, homeDecline].every((r) => r.status === 404), [homeApi, homeUndo, homeDecline].map((r) => r.status))
    check("another person's session cannot keep the operator's run (not found), and no session is 401", samOnAlex.status === 404 && unpaired.status === 401, [samOnAlex.status, unpaired.status])
    check('a Keep that is not JSON is refused', textPlain.status === 415, textPlain.status)
    check('a Keep naming a candidate other than the card showed is refused', otherCandidate.status === 409 && otherCandidate.json?.refused === 'not-shown', otherCandidate.json?.refused)
    check('a non-operator cannot keep', samKeep.status === 403 && samKeep.json?.refused === 'not-operator', samKeep.json?.refused)
    const sammy = await approve('sam', `/people/sam/elder/runs/${final.id}/undo`, { body: { promotion: 'x' }, headers: pageHeaders })
    check('a non-operator cannot undo', sammy.status === 403 && sammy.json?.refused === 'not-operator', sammy.json?.refused)
    const routed = await api('alex', '/people/alex/route', { body: { text: 'Elder, [stub-route-approve] keep the bell now', primary: 'Dumpling', villagers: [{ id: 'alex', name: 'Dumpling', role: 'cook' }] } })
    check("the router's approve and keep fields are dropped: the route can only start a run", routed.status === 200 && routed.json?.routed?.route === 'elder' && Object.keys(routed.json.routed).every((k) => k === 'route' || k === 'say'), routed.json?.routed)
    check('none of that changed the live home', (await liveHead()) === headBefore && (await promotions()) === 0)

    // ── A candidate edited after its check ──────────────────────────────────
    const file = join(candidates, final.id, 'repo', STUB_BELL)
    const original = await readFile(file)
    await writeFile(file, original.toString().replace("'#c9a04a'", "'#ff0000'"))
    const sheet = await openApproval(page, 'decide')
    const keepTabs = await tabTo(sheet, '[data-act="keep"]')
    await holdKey(sheet)
    const said = await until(() => sheet.locator('#note').textContent(), (t) => Boolean(t), 15_000)
    check('Keep on a candidate edited after its check is refused, with the reason on the approval page', (await approve('alex', `/people/alex/elder/runs/${final.id}`)).json?.run?.status === 'passed' && /changed since they were checked/.test(said ?? '') && (await promotions()) === 0, said)
    if (shots) await sheet.screenshot({ path: join(shots, '4-refused-edited.png') })
    await sheet.close()
    await writeFile(file, original)
    measured.tabsToKeep = keepTabs
  }

  // ── Keep, by keyboard, on the approval page the card opens ─────────────────
  check('the card offers the approval page and no Keep of its own', (await elder(page))?.approval === `${approvalOrigin}/#run=${final.id}` && !(await elder(page))?.buttons.some((b: string) => /keep/i.test(b)), (await elder(page))?.buttons)
  const sheet = await openApproval(page, 'decide')
  if (shots) await sheet.screenshot({ path: join(shots, '3-approval.png') })
  const tabs = await tabTo(sheet, '[data-act="keep"]')
  check('Keep is reachable by Tab on the approval page', tabs > 0, tabs)
  for (let i = 0; i < 5; i++) await sheet.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, 1200))
  check('taps of Enter on Keep choose nothing (a choice is held)', (await promotions()) === 0 && (await approve('alex', `/people/alex/elder/runs/${final.id}`)).json?.run?.status === 'passed')
  const keepAt = Date.now()
  await holdKey(sheet)
  await page.bringToFront()
  const kept = await until(() => elder(page), (s) => s?.status === 'kept', 30_000)
  await sheet.close()
  measured.keepMs = Date.now() - keepAt
  const plugin = values.real ? Object.keys(JSON.parse(await readFile(join(candidates, final.id, 'result.json'), 'utf8')).files ?? {})[0] : STUB_BELL
  check('Keep puts the plugin in the live copy', kept?.status === 'kept' && Boolean(plugin) && existsSync(join(live, plugin)) && (await promotions()) === 1, { plugin, status: kept?.status })
  const keptText = await page.locator('.elder-card .elder-status').textContent()
  check('the card says the change lives in the live home, not this page', /live home/.test(keptText ?? '') && /won't appear here/.test(keptText ?? ''), keptText)
  await page.waitForTimeout(300)
  await shot(page, '5-kept')

  // ── Undo, on the approval page the card's Undo opens ───────────────────────
  const undoSheet = await openApproval(page, 'undo')
  const undoTabs = await tabTo(undoSheet, '[data-act="undo"]')
  const undoAt = Date.now()
  await holdKey(undoSheet)
  await page.bringToFront()
  const undone = await until(() => elder(page), (s) => s?.status === 'undone', 30_000)
  await undoSheet.close()
  measured.undoMs = Date.now() - undoAt
  check('Undo (by Tab and Enter) takes it out of the live copy', undoTabs > 0 && undone?.status === 'undone' && !existsSync(join(live, plugin)) && (await promotions()) === 2, { undoTabs, status: undone?.status })
  await shot(page, '6-undone')
  await page.locator('.elder-card [data-key="done"]').click()

  if (!values.real) {
    // ── A candidate and its executor claiming approval ──────────────────────
    const claim = await api('alex', '/people/alex/elder/runs', { body: { text: 'Elder, [stub-elder-approve] put a bell on the table' } })
    const claimed = await until(async () => (await api('alex', `/people/alex/elder/runs/${claim.json?.run?.id}`)).json?.run, (r) => r?.status !== 'running', 900_000, 1000)
    await new Promise((r) => setTimeout(r, 2000))
    check('a passed candidate whose plugin, files and executor output claim approval is not kept', claimed?.status === 'passed' && (await promotions()) === 2 && !existsSync(join(live, STUB_BELL)), { status: claimed?.status, promotions: await promotions() })
    const declined = await approve('alex', `/people/alex/elder/runs/${claimed.id}/decline`, { body: {}, headers: pageHeaders })
    const keepDeclined = await approve('alex', `/people/alex/elder/runs/${claimed.id}/keep`, { body: { candidate: claimed.id }, headers: pageHeaders })
    check('Not this settles the run as declined, Keep is then refused, and nothing is promoted', declined.status === 200 && declined.json?.run?.status === 'declined' && keepDeclined.status === 409 && (await approve('alex', `/people/alex/elder/runs/${claimed.id}`)).json?.run?.status === 'declined' && (await promotions()) === 2, [declined.json?.run?.status, keepDeclined.status])

    // ── A failed gate, through the page ─────────────────────────────────────
    await openHome(page)
    await write(page, 'Elder, [stub-elder-broken] add a clock above the window')
    await until(() => elder(page), (s) => s?.status === 'running', 30_000)
    const failed = (await follow(page)).final
    const reasonText = await page.locator('.elder-card .elder-reason').textContent().catch(() => null)
    check('a failed build gate shows its plain reason on the card', failed?.status === 'failed' && /doesn't build/.test(reasonText ?? '') && failed.stages.some((s: { name: string; state: string }) => s.name === 'build' && s.state === 'fail'), { reasonText, stages: failed?.stages })
    const keepFailed = await approve('alex', `/people/alex/elder/runs/${failed.id}/keep`, { body: { candidate: failed.id }, headers: pageHeaders })
    check('Keep on a failed run is refused', keepFailed.status === 409 && keepFailed.json?.refused === 'not-passed', keepFailed.json?.refused)
    await shot(page, '7-failed')

    // ── A run interrupted by a restart ──────────────────────────────────────
    const slow = await api('alex', '/people/alex/elder/runs', { body: { text: 'Elder, [stub-elder-slow] put a bell on the table' } })
    await until(async () => (await api('alex', `/people/alex/elder/runs/${slow.json?.run?.id}`)).json?.run, (r) => r?.stages?.some((s: { name: string; state: string }) => s.name === 'write' && s.state === 'now'), 300_000, 1000)
    await stop(host, 'SIGKILL')
    host = await startHost()
    const after = (await api('alex', `/people/alex/elder/runs/${slow.json?.run?.id}`)).json?.run
    check('a run cut off by a restart is shown as interrupted, never passed', after?.status === 'interrupted' && /stopped while this was being made/.test(after?.reason ?? ''), { status: after?.status, stages: after?.stages })
    const keepCut = await approve('alex', `/people/alex/elder/runs/${after?.id}/keep`, { body: { candidate: after?.id }, headers: pageHeaders })
    check('Keep on an interrupted run is refused', keepCut.status === 409 && keepCut.json?.refused === 'not-passed', keepCut.json?.message)
    const record = (await readFile(join(root, 'elder', 'runs.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l))
    check('the interrupted run is not run again', record.filter((e) => e.id === after?.id && e.e === 'asked').length === 1 && !(await api('alex', '/people/alex/elder')).json?.busy)
    await openHome(page)
    await until(() => elder(page), (s) => s?.status === 'interrupted', 10_000)
    await shot(page, '8-interrupted')

    // ── The hourly cap ──────────────────────────────────────────────────────
    const capped = await api('alex', '/people/alex/elder/runs', { body: { text: 'Elder, add a clock above the window' } })
    check('past the hourly cap a new ask is refused in plain words (429)', capped.status === 429 && /in the last hour/.test(capped.json?.message ?? ''), capped.json?.message)
    const idle = await page.evaluate(() => (window as any).village.talk.state().elder.polling)
    check('the card does not poll while no run is going', idle === false)
  }
} catch (error) {
  check('the proof ran to the end', false, String((error as Error).stack ?? error).replace(/pair=\w+/g, 'pair=…'))
} finally {
  await browser?.close()
  for (const c of [vite, host, liveServer]) await stop(c)
  for (const c of children) await stop(c)
  measured.totalMs = Date.now() - t0
  await mkdir(join(source, 'proof'), { recursive: true })
  const out = join(source, 'proof', `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}-elder-home${values.real ? '-real' : ''}.json`)
  await writeFile(out, JSON.stringify({ steps, measured }, null, 2) + '\n')
  const failed = steps.filter((s) => !s.ok)
  console.log(`${steps.length - failed.length} of ${steps.length} steps; ${JSON.stringify(measured).slice(0, 2000)}`)
  console.log(`proof: ${out}`)
  if (!values.keep) await rm(scratch, { recursive: true, force: true })
  process.exit(failed.length ? 1 : 0)
}
