// End-to-end proof of `npm run village` (#85) with the stub agent: no model is called.
// Starts Village on a scratch root, pairs a headless Chrome through a `link` link, talks and visits through the
// one origin, refuses a page on another port, restarts the host (the device stays paired), re-links (the old
// device is refused), and checks that no code or session reaches the log.
//
//   node test/village.ts [--port 5317] [--approval-port <port + 1>] [--evil-port <port + 2>] [--keep]
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, get as httpGet } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const { values } = parseArgs({ options: { port: { type: 'string', default: '5317' }, 'approval-port': { type: 'string' }, 'evil-port': { type: 'string' }, keep: { type: 'boolean', default: false } } })
const port = Number(values.port)
const approvalArgs = values['approval-port'] ? ['--approval-port', values['approval-port']] : []
const base = `http://localhost:${port}/`
const root = await mkdtemp(join(tmpdir(), 'village-check-'))
const env = { ...process.env, VILLAGER_PEOPLE: 'alex:Alex,sam:Sam,mia:Mia' }
const checks: { name: string; pass: boolean; detail?: unknown }[] = []
const check = (name: string, pass: unknown, detail?: unknown) => checks.push({ name, pass: Boolean(pass), detail })
let log = ''

const cli = (...args: string[]) => new Promise<string>((resolve, reject) => {
  const child = spawn(process.execPath, ['src/village.ts', ...args, '--root', root, '--port', String(port), ...approvalArgs], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (out += d))
  child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(out))))
})
function startVillage(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['src/village.ts', 'start', '--root', root, '--port', String(port), '--agent', 'stub', ...approvalArgs], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let mine = ''
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`village did not start: ${log.slice(-600)}`)), 300_000)
    const onData = (d: Buffer) => {
      log += d
      mine += d
      if (/Village is open at/.test(mine) && /A new device/.test(mine)) {
        clearTimeout(timer)
        child.stdout!.off('data', onData)
        child.stdout!.on('data', (x) => (log += x))
        resolve(child)
      }
    }
    child.stdout!.on('data', onData)
    child.stderr!.on('data', (d) => (log += d))
    child.on('exit', (code) => reject(new Error(`village exited ${code}: ${log.slice(-600)}`)))
  })
}
const stopVillage = (child: ChildProcess) => new Promise<void>((resolve) => {
  if (child.exitCode !== null) return resolve()
  child.once('exit', () => resolve())
  process.kill(-child.pid!, 'SIGTERM')
})
const codeOf = (out: string) => /#pair=([0-9a-f]{64})/.exec(out)?.[1] ?? null
const lines = async (person: string, sub = '') => (await readFile(join(root, 'people', person, sub, 'conversation.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l))

let village = await startVillage()
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const codes: string[] = []
const secrets: string[] = []
try {
  check('start prints no pairing link to a log', !/#pair=/.test(log) && /alex: not paired yet; run npm run village -- link alex/.test(log), log.split('\n').filter((l) => l.startsWith('alex')))
  const linked = await cli('link', 'alex')
  const code = codeOf(linked)
  codes.push(code!)
  check('link prints one link for the person, on this Mac\'s address', code !== null && linked.includes(`${base}#pair=`))
  check('link refuses an unlisted person', await cli('link', 'zoe').then(() => false, (e) => /Name a listed person/.test(String(e))))

  // Pair: the page trades the code for its cookie; the address bar is clean.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await page.goto(`${base}?talk=off&build=0&q=low#pair=${code}`)
  await page.evaluate(() => (window as unknown as { village: { ready: () => Promise<unknown> } }).village.ready())
  const session = await page.evaluate(async () => (await fetch('/villager/api/session')).json())
  const cookie = (await context.cookies(`${base}villager/api/`)).find((c) => c.name.startsWith('village_'))
  secrets.push(cookie?.value ?? '')
  check('pair: one origin serves the page and the villagers; the device is Alex', session.person === 'alex' && !page.url().includes('pair='), { session, url: page.url() })
  check('pair: the session is an HttpOnly, SameSite=Strict cookie the page cannot read', cookie?.httpOnly === true && cookie?.sameSite === 'Strict' && !(await page.evaluate(() => document.cookie)).includes(cookie!.value))
  // Vite's proxy must keep the browser's Host (no changeOrigin): the session is bound to the home it was paired on (A2).
  const pairedOn = ((p) => (p.people ?? p).alex.sessions.map((x: { host?: string }) => x.host))(JSON.parse(await readFile(join(root, 'villager', 'pairing.json'), 'utf8')))
  check("pair: the session is bound to the home's own host, as the browser named it (the proxy keeps Host)", pairedOn.length > 0 && pairedOn.every((h: string) => h === `localhost:${port}`), pairedOn)
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href
    const res = await fetch(link)
    const icon = document.querySelector<HTMLLinkElement>('link[rel=apple-touch-icon]')!.href
    return { ok: res.ok, json: await res.json(), icon: (await fetch(icon)).headers.get('content-type') }
  })
  check('home screen: the manifest opens / standalone, with icons, and an apple-touch-icon is served', manifest.ok && manifest.json.display === 'standalone' && manifest.json.start_url === '/' && manifest.json.icons.length >= 2 && manifest.icon === 'image/png', manifest)

  // Talk and visit through the one origin, as the page does (its cookie, same origin).
  const talk = (path: string, text: string) => page.evaluate(async ([p, t]) => {
    const res = await fetch(`/villager/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t }) })
    return { status: res.status, body: await res.text() }
  }, [path, text] as const)
  const own = await talk('/people/alex/messages', 'water the plants')
  check('talk: Alex talks with their villager through the one origin, streamed', own.status === 200 && /event: done/.test(own.body), own.status)
  const visit = await talk('/people/alex/visits/sam/messages', 'hello Tuft')
  check("visit: Alex's visit to Sam's villager works, kept under Alex", visit.status === 200 && (await lines('alex', 'visits/sam')).length === 2 && (await lines('sam')).length === 0, visit.status)
  check("other person: Alex's device on Sam's own conversation is refused (403)", (await talk('/people/sam/messages', 'as sam')).status === 403)

  // Another origin: a page on another localhost port is same-site (cookies ignore ports), so SameSite alone would let
  // its form in. The host must refuse it, and nothing is written.
  const evil = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<form id=f method=POST enctype=text/plain action="${base}villager/api/people/alex/messages"><input name='{"text":"forged","x":"' value='"}'></form>
      <script>fetch('${base}villager/api/people/alex/messages', { method: 'POST', mode: 'no-cors', credentials: 'include', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ text: 'forged by fetch' }) }).finally(() => document.getElementById('f').submit())</script>`)
  })
  const evilPort = Number(values['evil-port'] ?? port + 2)
  await new Promise<void>((r) => evil.listen(evilPort, '127.0.0.1', () => r()))
  const before = (await lines('alex')).length
  const forger = await context.newPage()
  await forger.goto(`http://localhost:${evilPort}/`)
  await forger.waitForTimeout(2500)
  evil.close()
  const after = await lines('alex')
  check('cross-site: a page on another port cannot post as Alex, by fetch or form', after.length === before && !after.some((l) => /forged/.test(l.text ?? '')), { before, after: after.length })

  // Restart: the device stays paired; the conversation resumes.
  await stopVillage(village)
  check("a SIGTERM is the host's own stop, so a Keep in flight can finish: it exits 0 (Vite's own handler would exit 143)", village.exitCode === 0, { code: village.exitCode, signal: village.signalCode })
  const logBefore = log.length
  village = await startVillage()
  check('restart: start says Alex is paired and prints no link', /alex: 1 paired device/.test(log.slice(logBefore)) && !/#pair=/.test(log), log.split('\n').filter((l) => /^(alex|sam):|pair=/.test(l)))
  await page.reload()
  const again = await page.evaluate(async () => (await fetch('/villager/api/session')).status)
  const resumed = await talk('/people/alex/messages', 'did you remember?')
  check('pair-survives-restart: the paired device is served after the host restarts, and its villager resumes', again === 200 && resumed.status === 200 && /2 lines/.test(resumed.body), { again, resumed: resumed.status })

  // --add: a second device without ending the first.
  const second = codeOf(await cli('link', 'alex', '--add'))
  codes.push(second!)
  const phone = await browser.newContext()
  const phonePage = await phone.newPage()
  await phonePage.goto(`${base}?talk=off&build=0&q=low#pair=${second}`)
  await phonePage.waitForFunction(async () => (await fetch('/villager/api/session')).status === 200, null, { timeout: 30_000, polling: 500 })
  secrets.push((await phone.cookies(`${base}villager/api/`)).find((c) => c.name.startsWith('village_'))?.value ?? '')
  check('link --add: a second device pairs and the first still works', (await page.evaluate(async () => (await fetch('/villager/api/session')).status)) === 200)

  // Re-link: every earlier device is refused; the new link pairs.
  const third = codeOf(await cli('link', 'alex'))
  codes.push(third!)
  const refused = await page.evaluate(async () => (await fetch('/villager/api/people/alex/conversation')).status)
  const refusedPhone = await phonePage.evaluate(async () => (await fetch('/villager/api/people/alex/conversation')).status)
  check('relink: link without --add revokes the earlier devices (401)', refused === 401 && refusedPhone === 401, { refused, refusedPhone })
  check('relink: an opened link cannot pair again', (await page.evaluate(async (c) => (await fetch('/villager/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c }) })).status, code)) === 401)
  await page.goto(`${base}?talk=off&build=0&q=low#pair=${third}`)
  await page.waitForFunction(async () => (await fetch('/villager/api/session')).status === 200, null, { timeout: 30_000, polling: 500 })
  check('relink: the new link pairs the device again', true)
  secrets.push((await context.cookies(`${base}villager/api/`)).find((c) => c.name.startsWith('village_'))?.value ?? '')

  const status = JSON.parse(await cli('status'))
  check('status: live home, people and pairing counts, no secrets', status.live.installed && status.people.alex.sessions === 1 && !codes.concat(secrets).some((s) => JSON.stringify(status).includes(s)), status.people)
  // Home screen: an installed app that is not paired asks for the link to be pasted (src/pair.ts).
  const app = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await app.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }))
  const appPage = await app.newPage()
  await appPage.goto(`${base}?talk=off&build=0&q=low`)
  const card = appPage.locator('form.village-pair')
  await card.waitFor({ timeout: 30_000 })
  await card.locator('input').fill('hello there')
  await card.locator('button').click()
  const badNote = await card.locator('.village-pair-note').textContent()
  const pasted = await cli('link', 'alex', '--add')
  codes.push(codeOf(pasted)!)
  await card.locator('input').fill(pasted.trim().split('\n').at(-1)!)
  await card.locator('button').click()
  await card.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
  const appSession = await appPage.evaluate(async () => (await fetch('/villager/api/session')).json())
  check('home screen: an unpaired installed app shows the paste card, refuses a non-link, and pairs from a pasted link', /doesn.t look like a pairing link/.test(badNote ?? '') && (await card.count()) === 0 && appSession.person === 'alex', { badNote, appSession })
  secrets.push((await app.cookies(`${base}villager/api/`)).find((c) => c.name.startsWith('village_'))?.value ?? '')
  const browserTab = await (await browser.newContext()).newPage()
  await browserTab.goto(`${base}?talk=off&build=0&q=low`)
  await browserTab.waitForTimeout(3000)
  check('home screen: a browser tab never shows the card', (await browserTab.locator('form.village-pair').count()) === 0)
  await app.close()
  await browserTab.context().close()
  // service install keeps every option this command was given (A5), not a hand-picked few: what it would write, without loading it.
  const written = await cli('service', 'plist', '--operators', 'sam', '--elder-per-hour', '2', '--elder-executor', 'stub', '--candidates', 'rel/cands', '--thinking', '--add', '--label', 'dev.village.check')
  const argv = [...written.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1])
  const nextTo = (flag: string) => argv[argv.indexOf(flag) + 1]
  check('service: the plist keeps --operators, --elder-per-hour, --elder-executor, --thinking and resolves --candidates; not --add or --label', nextTo('--operators') === 'sam' && nextTo('--elder-per-hour') === '2' && nextTo('--elder-executor') === 'stub' && argv.includes('--thinking') && nextTo('--candidates') === join(process.cwd(), 'rel/cands') && !argv.includes('--add') && !argv.includes('--label') && nextTo('--root') === root, argv.slice(2))
  const stored = await readFile(join(root, 'villager', 'pairing.json'), 'utf8')
  check('at rest and in logs: no code or session secret in pairing.json or the output', codes.concat(secrets).every((s) => s.length === 64 && !stored.includes(s) && !log.includes(s)))
  // The live home's Vite answers no host name it was not given (A4): not some other tailnet name.
  const asHost = (name: string) => new Promise<number>((resolve) => httpGet({ host: '127.0.0.1', port, path: '/', headers: { host: name } }, (r) => (r.resume(), resolve(r.statusCode ?? 0))).on('error', () => resolve(0)))
  check('vite: another .ts.net host name is refused, the home\'s own is served', (await asHost('someone-else.tail1234.ts.net')) === 403 && (await asHost(`localhost:${port}`)) === 200)
  // unlink ends every device of a person (B7): the paired page is refused afterwards.
  const beforeUnlink = await page.evaluate(async () => (await fetch('/villager/api/session')).status)
  const said = await cli('unlink', 'alex')
  const afterUnlink = await page.evaluate(async () => (await fetch('/villager/api/session')).status)
  check('unlink: every device paired as the person is refused afterwards (401)', beforeUnlink === 200 && afterUnlink === 401 && /Unlinked alex/.test(said), { beforeUnlink, afterUnlink })
  await context.close()
  await phone.close()
} catch (error) {
  check('proof ran to the end', false, String(error))
} finally {
  await browser.close()
  await stopVillage(village)
  if (!values.keep) await rm(root, { recursive: true, force: true })
}

for (const c of checks) console.log(`${c.pass ? 'pass' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
const failed = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failed} of ${checks.length} passed (stub agent, no model)`)
process.exit(failed ? 1 : 0)
