// Two browsers on one street (#118 spike). For each test delay, with your walker drawn ahead
// of the world's answer and then drawn from it, a fresh world and two pages: A walks, B
// watches. It times what a hand would feel (key to motion, touching a crate to the crate
// moving), how far the page's guess is put right, and what the wire and the world cost.
// Usage: node test/two.ts [--delays 0,50,100] [--crates 120] [--balls 24] [--headed]
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Page } from 'playwright'

const args = process.argv.slice(2)
const arg = (name: string, otherwise: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : otherwise }
const delays = arg('delays', '0,50,100').split(',').map(Number)
const here = new URL('..', import.meta.url).pathname
const WT = 4533, HTTP = 4534, PAGE = 5328
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]

function start(command: string, argv: string[], ready: string, env: Record<string, string> = {}): Promise<ChildProcess> {
  const child = spawn(command, argv, { cwd: here, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    let seen = ''
    const on = (chunk: Buffer) => { seen += chunk; if (seen.includes(ready)) resolve(child) }
    child.stdout!.on('data', on)
    child.stderr!.on('data', on)
    child.on('exit', (code) => reject(new Error(`${command} ${argv.join(' ')} ended (${code}):\n${seen}`)))
    setTimeout(() => reject(new Error(`${command} was not ready in 20 s:\n${seen}`)), 20_000)
  })
}
const street = (page: Page) => ({
  call: <T>(body: string) => page.evaluate(`(async () => { const s = window.__street; return ${body} })()`) as Promise<T>,
})

const vite = await start('npx', ['vite', '--port', String(PAGE)], 'Local', { STREET_HTTP: String(HTTP) })
const browser = await chromium.launch({ channel: 'chrome', headless: !args.includes('--headed'), args: ['--use-angle=metal'] })
try {
  for (const delay of delays) for (const predict of [1, 0]) {
    const world = await start('node', ['run.mjs', '--port', String(WT), '--http', String(HTTP), '--crates', arg('crates', '120'), '--balls', arg('balls', '24')], '/where')
    try {
      const a = await browser.newPage({ viewport: { width: 1280, height: 720 } }), b = await browser.newPage({ viewport: { width: 640, height: 400 } })
      const errors: string[] = []
      for (const page of [a, b]) page.on('pageerror', (e) => errors.push(String(e)))
      await a.goto(`http://localhost:${PAGE}/?predict=${predict}&delay=${delay}`)
      await b.goto(`http://localhost:${PAGE}/`)
      const A = street(a), B = street(b)
      for (const page of [a, b]) await page.waitForFunction('window.__street?.ready', undefined, { timeout: 15_000 })
      await a.bringToFront()
      await sleep(1500)
      const you = await A.call<number>('s.you')
      // Key to motion, five times, back and forth so the walker stays put.
      const key: number[] = []
      for (let i = 0; i < 6; i++) { key.push(await A.call<number>(`s.keyToMotion('${i % 2 ? 'KeyA' : 'KeyD'}')`)); await sleep(500) }
      // Walking free across the street: how far the guess is put right.
      await A.call('s.clearFixes()')
      const seenBefore = await B.call<number[]>(`s.shownOf(${you})`)
      await A.call(`s.hold('KeyD', true)`); await sleep(700); await A.call(`s.hold('KeyD', false)`)
      await sleep(500)
      const seenAfter = await B.call<number[]>(`s.shownOf(${you})`)
      await A.call(`s.hold('KeyA', true)`); await sleep(700); await A.call(`s.hold('KeyA', false)`)
      await sleep(500)
      const free = (await A.call<{ fixMm: unknown }>('s.stats()')).fixMm
      // Downhill into the wall of crates.
      await A.call('s.clearFixes()')
      const push = await A.call<{ touchToMoveMs: number; deepestMm: number } | null>(`s.pushCrate('KeyW')`)
      await A.call(`s.hold('KeyW', true)`); await sleep(1500); await A.call(`s.hold('KeyW', false)`)
      await sleep(600)
      const stats = await A.call<Record<string, unknown>>('s.stats()')
      const worldStats = await (await fetch(`http://127.0.0.1:${HTTP}/stats`)).json() as Record<string, unknown>
      const run = {
        delayEachWayMs: delay, walker: predict ? 'ahead of the answer' : 'from the answer',
        roundTripMs: stats.rttMs, keyToMotionMs: { median: Math.round(median(key)), all: key.map(Math.round) },
        fixWalkingFreeMm: predict ? free : null, fixPushingMm: predict ? stats.fixMm : null,
        touchToCrateMovingMs: push && Math.round(push.touchToMoveMs), walkerDrawnInsideCrateMm: push && Math.round(push.deepestMm),
        downBps: stats.downBps, upBps: stats.upBps, snapshotsLostPct: stats.snapshotsLostPct, frameMs: stats.frameMs, pageWorkMs: stats.workMs,
        otherPageSawWalkerMove: Math.hypot(seenAfter[0] - seenBefore[0], seenAfter[2] - seenBefore[2]) > 0.05,
        otherPageSawWalkerAt: { before: seenBefore.map((x) => +x.toFixed(2)), after: seenAfter.map((x) => +x.toFixed(2)) },
        world: worldStats, pageErrors: errors,
      }
      console.log(JSON.stringify(run))
      // As a check: both pages are in one world, a walker drawn ahead answers within a few frames, and nothing threw.
      if (!run.otherPageSawWalkerMove || errors.length || (predict && run.keyToMotionMs.median > 60) || Number(run.snapshotsLostPct) > 5) { console.log('FAILED:', JSON.stringify({ saw: run.otherPageSawWalkerMove, errors, key: run.keyToMotionMs.median, lost: run.snapshotsLostPct })); process.exitCode = 1 }
      await a.close(); await b.close()
    } finally { world.kill(); await sleep(400) }
  }
} finally {
  await browser.close()
  vite.kill()
}
