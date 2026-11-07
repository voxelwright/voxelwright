// The talk look's shot list (#42 regroup), the same for every ?look=: the notepad at rest,
// writing and sent, a one-villager talk, the table mid-round, the dollhouse, ?q=low, and a
// phone width. Replies are scripted (Playwright answers the villager API), so every look
// gets the same words with the same timing; no host runs. Headless only.
// Usage: node scripts/talk-shots.mjs <out-dir> [--look=a] [--dev=5580] [--only=desktop|phone|low]
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const out = args.find((a) => !a.startsWith('--'))
if (!out) throw new Error('usage: talk-shots.mjs <out-dir> [--look=a] [--dev=5580]')
const look = opt('look')
const only = opt('only')
const devPort = Number(opt('dev') ?? 5580)
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(out, { recursive: true })

/** Scripted replies, written like the real ones in the README's runs. */
const REPLIES = {
  alex: {
    dinner: "Leek and potato soup, with the crusty bread from this morning. Give it twenty minutes and I'll call everyone.",
    table: "I'd love that. Basil, parsley and chives are friendly ones to start with, and I'd use every leaf.",
  },
  mia: {
    basil: "It's perking up nicely. I pinched the top leaves this morning, so it'll grow bushy, and you'll have a handful for supper by Friday.",
    table: "Oh yes! Let's start with sturdy ones like parsley, and I'll fetch the big clay pot from the back step.",
  },
  sam: {
    table: "I'll clear the windowsill on Saturday morning, so the pots get all the sun.",
  },
}
const replyFor = (person, text, context) => {
  const r = REPLIES[person] ?? {}
  if (context) return r.table ?? 'That sounds lovely.'
  if (/dinner/i.test(text)) return r.dinner ?? 'Soup, I think.'
  if (/basil/i.test(text)) return r.basil ?? 'Growing well.'
  return r.table ?? 'That sounds lovely.'
}

const children = new Set()
function run(cmd, argv, cwd, ready) {
  const child = spawn(cmd, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return new Promise((resolve, reject) => {
    let log = ''
    const timer = setTimeout(() => reject(new Error(`${cmd} did not start: ${log.slice(-400)}`)), 60_000)
    child.stdout.on('data', (d) => {
      log += d
      if (ready.test(log)) {
        clearTimeout(timer)
        resolve(child)
      }
    })
    child.stderr.on('data', (d) => (log += d))
    child.on('exit', (code) => reject(new Error(`${cmd} exited ${code}: ${log.slice(-400)}`)))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function scripted(context) {
  await context.route('**/villager/launch', (r) => r.fulfill({ json: { token: 'shots' } }))
  await context.route('**/villager/api/**', async (r) => {
    const url = new URL(r.request().url())
    const path = url.pathname.replace('/villager/api', '')
    const m = /^\/people\/([a-z]+)\/messages$/.exec(path)
    if (m && r.request().method() === 'POST') {
      const body = JSON.parse(r.request().postData() ?? '{}')
      const reply = replyFor(m[1], body.text ?? '', body.context)
      await sleep(900)
      const sse = [...reply.match(/.{1,12}/g).map((t) => `event: text\ndata: ${JSON.stringify({ t })}\n\n`), `event: done\ndata: ${JSON.stringify({ reply })}\n\n`].join('')
      return r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse })
    }
    if (/\/projects$/.test(path)) return r.fulfill({ json: { projects: [] } })
    if (/\/conversation$/.test(path)) return r.fulfill({ json: { lines: [] } })
    if (/\/library$/.test(path)) return r.fulfill({ json: { items: [] } })
    if (/\/route$/.test(path)) return r.fulfill({ json: { routed: { route: 'answer' }, models: ['stub'], costUsd: 0 } })
    return r.fulfill({ status: 404, body: '' })
  })
}

const dev = await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, /Local:/)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const base = `http://localhost:${devPort}/`
const suffix = look ? `&look=${look}` : ''
const timings = []

async function session(name, viewport, q, fn, extra = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra })
  await scripted(context)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${base}?talk=npc&q=${q}${suffix}`)
  await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(2500)
  const t0 = Date.now()
  await fn(page, (shot) => page.screenshot({ path: join(out, `${name}-${shot}.jpg`), quality: 86 }))
  timings.push({ name, ms: Date.now() - t0, errors })
  await context.close()
}

const state = (page) => page.evaluate(() => window.village.talk.state())
async function until(page, test, ms = 30_000) {
  const end = Date.now() + ms
  let s
  do {
    s = await state(page)
    if (test(s)) return s
    await page.waitForTimeout(80)
  } while (Date.now() < end)
  throw new Error(`timed out: ${test}`)
}
const choose = (page, id) => page.evaluate((id) => window.village.kernel.root.get('entries').choose(id), id)
const glide = (page, frame) => page.evaluate((f) => window.village.kernel.root.get('view').glide(f, 0), frame)
/** The kitchen, close enough to see who is who. */
const KITCHEN = { x: 0.2, z: 0.6, zoom: 0.62, yaw: 0.42 }

async function seatThree(page) {
  for (const id of ['mia', 'alex', 'sam']) {
    await choose(page, `villager-${id}`)
    await until(page, (s) => s.mode === 'talk' && s.partner === id, 10_000)
    await page.waitForTimeout(300)
    await page.keyboard.type('come sit with me', { delay: 10 })
    await page.keyboard.press('Enter')
    await until(page, (s) => s.mode === 'table' && s.cast[id].seat, 10_000)
  }
  await until(page, (s) => ['mia', 'alex', 'sam'].every((id) => s.cast[id].seated), 40_000)
  await page.waitForTimeout(1500)
}
async function tableRound(page, shot) {
  await page.keyboard.type('Shall we plant some herbs this weekend?', { delay: 25 })
  await page.keyboard.press('Enter')
  // Mid-round: one card said, the next speaker half-way through its words.
  await until(page, (s) => Object.values(s.cards).some((c) => c.as === 'said') && Object.values(s.cards).some((c) => c.as === 'speaking' && !c.finished && c.text.length > 20), 40_000)
  await page.waitForTimeout(700)
  await shot('table')
}

const desktop = { width: 1280, height: 800 }
const phone = { width: 390, height: 844 }
try {
  if (!only || only === 'desktop') await session('desktop', desktop, 'high', async (page, shot) => {
    await shot('house')
    await glide(page, KITCHEN)
    await page.waitForTimeout(1500)
    await shot('rest')
    await page.keyboard.type("What's for dinner tonight?", { delay: 40 })
    await page.waitForTimeout(500)
    await shot('writing')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    await shot('sent')
    await page.waitForTimeout(500)
    await shot('sent-late')
    await until(page, (s) => s.cards.alex?.finished && s.cards.alex.text.length > 40)
    await page.waitForTimeout(800)
    await shot('reply')
    await page.keyboard.press('Escape')
    await until(page, (s) => s.mode === 'room', 5000)
    await choose(page, 'villager-mia')
    await until(page, (s) => s.mode === 'talk' && s.partner === 'mia')
    await page.waitForTimeout(1200)
    await page.keyboard.type('How is the basil doing?', { delay: 30 })
    await page.keyboard.press('Enter')
    await until(page, (s) => s.cards.mia?.finished && /basil|bushy/.test(s.cards.mia.text))
    await page.waitForTimeout(1000)
    await shot('talk')
    await page.keyboard.press('Escape')
    await until(page, (s) => s.mode === 'room', 5000)
    await seatThree(page)
    await tableRound(page, shot)
  })
  if (!only || only === 'low') await session('low', desktop, 'low', async (page, shot) => {
    await glide(page, KITCHEN)
    await page.waitForTimeout(1500)
    await shot('rest')
    await seatThree(page)
    await tableRound(page, shot)
  })
  if (!only || only === 'phone') await session('phone', phone, 'high', async (page, shot) => {
    await glide(page, { ...KITCHEN, zoom: 0.5 })
    await page.waitForTimeout(1500)
    await shot('rest')
    await choose(page, 'villager-mia')
    await until(page, (s) => s.mode === 'talk' && s.partner === 'mia')
    await page.waitForTimeout(1200)
    await page.keyboard.type('How is the basil doing?', { delay: 30 })
    await page.keyboard.press('Enter')
    await until(page, (s) => s.cards.mia?.finished && /basil|bushy/.test(s.cards.mia.text))
    await page.waitForTimeout(1000)
    await shot('talk')
    await page.keyboard.press('Escape')
    await until(page, (s) => s.mode === 'room', 5000)
    await seatThree(page)
    await tableRound(page, shot)
  }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  console.log(JSON.stringify({ look: look ?? 'current', out, timings }))
} finally {
  await browser.close().catch(() => {})
  for (const c of children) process.kill(-c.pid, 'SIGTERM')
}
