// Headless proof of talking to the villager through the notebook (#40).
// Starts its own villager host with the stub agent (no model is called) and its
// own dev server, both on a throwaway VILLAGE_ROOT, and stops them at the end.
// Usage: node scripts/check-villager.mjs [--shot=path] [--agent=claude] [--line="..."]
//   --agent=claude runs one real exchange instead of the checks and prints its usage line.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
const hostPort = 5191
const devPort = 5182
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
const startHost = () => run('node', ['src/villager-cli.ts', '--agent', agent, '--port', String(hostPort), '--root', root], hostDir, {}, /listening on/)
const stop = (child) => new Promise((resolve) => {
  if (!children.has(child)) return resolve()
  child.once('exit', resolve)
  process.kill(-child.pid, 'SIGTERM')
})
const conversationFile = () => readFile(join(root, 'people', 'alex', 'conversation.jsonl'), 'utf8').then((s) => s.trim().split('\n').map((l) => JSON.parse(l)), () => [])

let host = await startHost()
const dev = await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGE_ROOT: root, VILLAGER_PORT: String(hostPort) }, /Local:/)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })

async function openNotebook(page) {
  await page.goto(base)
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
  const page = await context.newPage()
  await openNotebook(page)

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
    const cross = await fetch(`${base}villager/launch`, { headers: { 'sec-fetch-site': 'cross-site' } })
    check('the token is not handed to other sites', cross.status === 403, cross.status)

    const first = await write(page, 'I keep forgetting to water the plants')
    const convo = await conversationFile()
    check('Enter sends the line and the reply is written onto the facing page', first.voice.state === 'answered' && convo.at(-1)?.from === 'villager' && first.voice.text === convo.at(-1).text, { voice: first.voice, last: convo.at(-1) })
    check('the reply appears gradually, as if written', first.states >= 8, { distinctPages: first.states })
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('village.notebook.lines') ?? '[]'))
    check('the line is still kept in this browser', stored.includes('I keep forgetting to water the plants'), stored)
    const written = await leftPage(page)
    if (shot) await page.screenshot({ path: shot })

    // The proxy streams: pieces arrive spread out, before the end.
    const { token } = await (await fetch(`${base}villager/launch`)).json()
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

    // Host restart: a new token, the same conversation.
    await stop(host)
    host = await startHost()
    await page.focus('[data-entry="notebook"]')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1800)
    const resumed = await write(page, 'did you remember?')
    check('after a host restart the page gets the new token and the villager resumes', resumed.voice.state === 'answered' && /3 lines/.test(resumed.voice.text) && resumed.voice.text.includes('water the plants'), resumed.voice)

    // Host down: the page says so warmly and keeps the line.
    await stop(host)
    const away = await write(page, 'are you there?')
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('village.notebook.lines') ?? '[]'))
    check('with the host down the page says so warmly', away.voice.state === 'away' && /out for a moment/.test(away.voice.text), away.voice)
    check('with the host down the line is still kept', kept.at(-1) === 'are you there?', kept)
    check('the away note replaces the reply on the page', (await leftPage(page)) !== written)
    if (shot) await page.screenshot({ path: shot.replace('.png', '-away.png') })
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
