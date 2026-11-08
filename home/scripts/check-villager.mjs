// Headless proof of talking to the villager through the notebook (#40).
// Starts its own villager host with the stub agent (no model is called) and its
// own dev server, both on a throwaway VILLAGE_ROOT, and stops them at the end.
// Usage: node scripts/check-villager.mjs [--shot=path] [--agent=claude] [--line="..."] [--dev=5182] [--host=5191]
//   --agent=claude runs one real exchange instead of the checks and prints its usage line.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const shot = opt('shot')
const agent = opt('agent') ?? 'stub'
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const root = await mkdtemp(join(tmpdir(), 'villager-page-'))
const hostPort = Number(opt('host') ?? 5191)
const devPort = Number(opt('dev') ?? 5182)
const base = `http://localhost:${devPort}/`
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const children = new Set()

function run(cmd, argv, cwd, env, ready) {
  const child = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`${cmd} did not start: ${out.slice(-400)}`)), 30_000)
    const onData = (d) => {
      out += d
      child.out = out
      if (ready.test(out)) {
        clearTimeout(timer)
        resolve(child)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => reject(new Error(`${cmd} exited ${code}: ${out.slice(-400)}`)))
  })
}
// The host prints each person's link; the token is in its fragment.
const startHost = () => run('node', ['src/villager-cli.ts', '--agent', agent, '--port', String(hostPort), '--root', root, '--home', base], hostDir, {}, /alex: \S+#token=[0-9a-f]{64}\n/)
const linkOf = (child) => /alex: (\S+#token=[0-9a-f]{64})/.exec(child.out)[1]
const tokenOf = (child) => /#token=([0-9a-f]{64})/.exec(linkOf(child))[1]
const stop = (child) => new Promise((resolve) => {
  if (!children.has(child)) return resolve()
  child.once('exit', resolve)
  process.kill(-child.pid, 'SIGTERM')
})
const conversationFile = () => readFile(join(root, 'people', 'alex', 'conversation.jsonl'), 'utf8').then((s) => s.trim().split('\n').map((l) => JSON.parse(l)), () => [])

let host = await startHost()
const dev = await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGE_ROOT: root, VILLAGER_PORT: String(hostPort) }, /Local:/)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })

async function openNotebook(page, url) {
  await page.goto(url)
  await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(600)
  await page.focus('[data-entry="notebook"]')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1800)
}
const leftPage = (page) => page.evaluate(() => {
  const mesh = window.village.kernel.root.get('stage').scene.getObjectByName('notebook left page')
  return mesh.material.map.image.toDataURL()
})
const voice = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-villager]')
  return { state: el?.dataset.villager, text: el?.textContent }
})
async function write(page, line) {
  const states = new Set()
  const started = Date.now()
  await page.keyboard.type(line)
  await page.keyboard.press('Enter')
  // Sample the facing page while the villager writes.
  let firstInk = null
  const blank = await leftPage(page)
  while (Date.now() - started < 240_000) {
    const now = await leftPage(page)
    if (now !== blank) firstInk ??= Date.now() - started
    states.add(now)
    const v = await voice(page)
    if (v.state !== 'writing' && v.state !== 'quiet') break
    await page.waitForTimeout(100)
  }
  // Keep sampling while the pen finishes, until the page is still for 1.5 s.
  for (let still = 0, last = null; still < 15; ) {
    const now = await leftPage(page)
    still = now === last ? still + 1 : 0
    last = now
    states.add(now)
    await page.waitForTimeout(100)
  }
  return { states: states.size, firstInkMs: firstInk, totalMs: Date.now() - started, voice: await voice(page) }
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  // Every Content Security Policy violation the page reports, and the console.
  await context.addInitScript(() => {
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI }))
  })
  const page = await context.newPage()
  const consoleLines = []
  page.on('console', (m) => consoleLines.push(m.text()))
  await openNotebook(page, linkOf(host))

  if (agent === 'claude') {
    const line = opt('line') ?? 'I keep forgetting to water the plants'
    const result = await write(page, line)
    if (shot) await page.screenshot({ path: shot })
    const usage = (await readFile(join(root, 'people', 'alex', 'usage.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
    const { readdir } = await import('node:fs/promises')
    const notesDir = join(root, 'people', 'alex', 'notes')
    const notes = {}
    for (const name of await readdir(notesDir)) notes[name] = await readFile(join(notesDir, name), 'utf8')
    console.log(JSON.stringify({ page: result, usage, notes, conversation: await conversationFile() }, null, 2))
  } else {
    // Token and proxy: the API needs the token, and the dev server does not buffer the stream.
    const bare = await fetch(`${base}villager/api/people/alex/conversation`)
    check('the API refuses a request without the token', bare.status === 401, bare.status)
    const launch = await fetch(`${base}villager/launch`)
    check('launch-route-gone: the dev server hands out no token', launch.status === 404 && !(await launch.text()).includes(tokenOf(host)), launch.status)
    check('the link leaves the address bar, and the tab keeps the token', page.url() === base && (await page.evaluate(() => sessionStorage.getItem('village.villager.token'))) === tokenOf(host), page.url())

    // Content Security Policy: page scripts (promoted plugins included) reach only this origin.
    const csp = (await fetch(base)).headers.get('content-security-policy') ?? ''
    check('csp-header: the page is served with default-src and connect-src limited to self', /default-src 'self'/.test(csp) && /connect-src 'self'(;|$)/.test(csp) && /script-src 'self'(;|$)/.test(csp), csp)
    let leaks = 0
    const sink = createServer((req, res) => (leaks++, res.end('ok')))
    await new Promise((r) => sink.listen(0, '127.0.0.1', r))
    const sinkUrl = `http://127.0.0.1:${sink.address().port}/leak`
    const attempt = await page.evaluate(async (url) => {
      const fetched = await fetch(url, { mode: 'no-cors', method: 'POST', body: 'secret' }).then(() => 'sent', (e) => String(e))
      new Image().src = `${url}?img`
      navigator.sendBeacon?.(`${url}?beacon`, 'secret')
      await new Promise((r) => setTimeout(r, 500))
      return { fetched, violations: window.__csp.filter((v) => v.blocked.startsWith(url)) }
    }, sinkUrl)
    sink.close()
    check('csp-blocks-external: a page script cannot send to another origin', leaks === 0 && attempt.fetched !== 'sent' && attempt.violations.some((v) => v.directive === 'connect-src'), { leaks, ...attempt })

    const first = await write(page, 'I keep forgetting to water the plants')
    const convo = await conversationFile()
    check('Enter sends the line and the reply is written onto the facing page', first.voice.state === 'answered' && convo.at(-1)?.from === 'villager' && first.voice.text === convo.at(-1).text, { voice: first.voice, last: convo.at(-1) })
    check('the reply appears gradually, as if written', first.states >= 8, { distinctPages: first.states })
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('village.notebook.lines') ?? '[]'))
    check('the line is still kept in this browser', stored.includes('I keep forgetting to water the plants'), stored)
    const written = await leftPage(page)
    if (shot) await page.screenshot({ path: shot })

    // The proxy streams: pieces arrive spread out, before the end.
    const token = tokenOf(host)
    const res = await fetch(`${base}villager/api/people/alex/messages`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'through the proxy' }) })
    const arrivals = []
    for await (const chunk of res.body) arrivals.push(Date.now())
    check('the dev server forwards the stream without buffering it', arrivals.length >= 5 && arrivals.at(-1) - arrivals[0] >= 200, { chunks: arrivals.length, spreadMs: arrivals.at(-1) - arrivals[0] })

    // Reload: the last answer is back on the page.
    await page.reload()
    await page.evaluate(() => window.village.ready())
    await page.waitForTimeout(1500)
    const back = await voice(page)
    check('after a reload the last answer is on the page', back.state === 'remembered' && back.text === (await conversationFile()).at(-1).text, back)
    check('the reloaded page draws a reply, not the bare page', (await leftPage(page)) !== '' && back.text.length > 0)

    // Host restart: a new token, the same conversation, once the new link is opened.
    await stop(host)
    host = await startHost()
    await openNotebook(page, linkOf(host))
    const resumed = await write(page, 'did you remember?')
    check('after a host restart the new link opens the same villager, which resumes', resumed.voice.state === 'answered' && /3 lines/.test(resumed.voice.text) && resumed.voice.text.includes('water the plants'), resumed.voice)

    // Host down: the page says so warmly and keeps the line.
    await stop(host)
    const away = await write(page, 'are you there?')
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('village.notebook.lines') ?? '[]'))
    check('with the host down the page says so warmly', away.voice.state === 'away' && /out for a moment/.test(away.voice.text), away.voice)
    check('with the host down the line is still kept', kept.at(-1) === 'are you there?', kept)
    check('the away note replaces the reply on the page', (await leftPage(page)) !== written)
    if (shot) await page.screenshot({ path: shot.replace('.png', '-away.png') })
    const violations = (await page.evaluate(() => window.__csp)).filter((v) => !v.blocked.startsWith('http://127.0.0.1:'))
    check('the home works under the policy: no other violations, and the HMR socket connected', violations.length === 0 && consoleLines.some((l) => /\[vite\] connected/.test(l)), { violations, vite: consoleLines.filter((l) => l.includes('[vite]')) })
  }
  await context.close()
} finally {
  await browser.close()
  for (const child of [...children]) await stop(child)
  check('host and dev server stopped', children.size === 0 && !existsSync(join(root, 'villager', 'launch.json')))
  await rm(root, { recursive: true, force: true })
}

if (agent !== 'claude') {
  for (const c of checks) console.log(`${c.pass ? 'pass' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
  const failed = checks.filter((c) => !c.pass).length
  console.log(`${checks.length - failed} of ${checks.length} passed`)
  process.exitCode = failed ? 1 : 0
}
