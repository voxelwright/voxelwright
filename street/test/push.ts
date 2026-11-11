// Walking into a crate, several times over (#118 spike): for each test delay and each way of
// drawing, fresh worlds and one page that walks downhill into the first wall. Reports the
// middle and the spread of: touching a crate to seeing it move, and how deep the walker
// was drawn inside it. A trial whose world ticked late (p95 over 5 ms) is marked: the
// machine was busy and the number is not the street's.
// Usage: node test/push.ts [--delays 0,50,100] [--trials 3]
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const arg = (name: string, otherwise: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : otherwise }
const delays = arg('delays', '0,50,100').split(',').map(Number), trials = Number(arg('trials', '3'))
const here = new URL('..', import.meta.url).pathname
const WT = 4633, HTTP = 4634, PAGE = 5338
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const WAYS = [['ahead, walks into things', ''], ['ahead, stops at things', '&stop=1'], ['from the answer', '&predict=0']] as const

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
const spread = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? `${Math.round(s[Math.floor(s.length / 2)])} (${Math.round(s[0])}-${Math.round(s[s.length - 1])})` : 'none' }

const vite = await start('npx', ['vite', '--port', String(PAGE)], 'Local', { STREET_HTTP: String(HTTP) })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] })
try {
  for (const delay of delays) for (const [way, query] of WAYS) {
    const move: number[] = [], deep: number[] = []
    let busy = 0, missed = 0
    for (let t = 0; t < trials; t++) {
      const world = await start('node', ['run.mjs', '--port', String(WT), '--http', String(HTTP), '--balls', '0'], '/where')
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
        await page.goto(`http://localhost:${PAGE}/?delay=${delay}${query}`)
        await page.waitForFunction('window.__street?.ready', undefined, { timeout: 15_000 })
        await sleep(1200)
        const push = await page.evaluate(`window.__street.pushCrate('KeyW')`) as { touchToMoveMs: number; deepestMm: number } | null
        const stats = await (await fetch(`http://127.0.0.1:${HTTP}/stats`)).json() as { lateMs: { p95: number } }
        if (stats.lateMs.p95 > 5) busy++
        else if (!push) missed++
        else { move.push(push.touchToMoveMs); deep.push(push.deepestMm) }
        await page.close()
      } finally { world.kill(); await sleep(300) }
    }
    console.log(JSON.stringify({ delayEachWayMs: delay, way, touchToCrateMovingMs: spread(move), drawnInsideMm: spread(deep), counted: move.length, busy, missed }))
  }
} finally {
  await browser.close()
  vite.kill()
}
