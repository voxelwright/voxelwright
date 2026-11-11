// A look at the street (#118): a fresh world, one page, a short walk, and a picture of it.
// Usage: node test/look.ts <out.png> [query, e.g. "shadows=0"] [width] [height]
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium } from 'playwright'

const out = process.argv[2], query = process.argv[3] ?? '', width = Number(process.argv[4] ?? 1280), height = Number(process.argv[5] ?? 720)
if (!out) throw new Error('Usage: node test/look.ts <out.png> [query] [width] [height]')
const here = new URL('..', import.meta.url).pathname
const WT = 4833, HTTP = 4834, PAGE = 5348
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
function start(command: string, argv: string[], ready: string, env: Record<string, string> = {}): Promise<ChildProcess> {
  const child = spawn(command, argv, { cwd: here, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    let seen = ''
    const on = (chunk: Buffer) => { seen += chunk; if (seen.includes(ready)) resolve(child) }
    child.stdout!.on('data', on)
    child.stderr!.on('data', on)
    child.on('exit', (code) => reject(new Error(`${command} ended (${code}):\n${seen}`)))
    setTimeout(() => reject(new Error(`${command} was not ready in 20 s:\n${seen}`)), 20_000)
  })
}
const vite = await start('npx', ['vite', '--port', String(PAGE)], 'Local', { STREET_HTTP: String(HTTP) })
const world = await start('node', ['run.mjs', '--port', String(WT), '--http', String(HTTP)], '/where')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
  const said: string[] = []
  page.on('pageerror', (e) => said.push(`error: ${e}`))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') said.push(`${m.type()}: ${m.text().slice(0, 300)}`) })
  await page.goto(`http://localhost:${PAGE}/?${query}`)
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 20_000 }).catch(() => said.push('never ready'))
  await page.evaluate(`window.__street?.hold('KeyW', true)`)
  await sleep(1400)
  await page.evaluate(`window.__street?.hold('KeyW', false)`)
  await sleep(2500)
  await page.screenshot({ path: out })
  console.log(JSON.stringify({ stats: await page.evaluate('window.__street?.stats()'), census: await page.evaluate('window.__street?.census()'), said: said.slice(0, 8) }))
} finally {
  await browser.close()
  world.kill()
  vite.kill()
}
