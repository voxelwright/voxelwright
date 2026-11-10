// Plays the pinball table headless on a phone-sized screen and records it (#108): a clip to look
// at, and numbers about how a round goes (seconds a ball lasts, score a round, flips that met the
// ball). A simple player in the page holds a flipper when the ball comes down onto it and pulls
// the plunger when a ball waits in the lane (missing a share of them, --skill); it sets the table's inputs by name each frame
// (headless touch input is too slow to time a flip), so this shows the game, not the fingers:
// check-physics-touch.mjs and check-physics-game.mjs prove those.
// Usage: node scripts/demo-pinball.mjs <out.mp4> [--dev=5455] [--rounds=1] [--seconds=90] [--skill=0.9] [--q=high]
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const out = args.find((a) => !a.startsWith('--'))
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
if (!out) throw new Error('usage: demo-pinball.mjs <out.mp4> [--dev=5455] [--rounds=1] [--seconds=90] [--skill=0.9] [--q=high]')
const devPort = Number(opt('dev') ?? 5455)
const rounds = Number(opt('rounds') ?? 1)
const seconds = Number(opt('seconds') ?? 90)
const skill = Number(opt('skill') ?? 0.9)
const query = `?cam=iso&talk=off&build=0&q=${opt('q') ?? 'high'}`
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = `http://localhost:${devPort}/`
const size = { width: 390, height: 844 }

const server = spawn('npx', ['vite', '--port', String(devPort), '--strictPort'], { cwd: homeDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
/** Stops vite and everything it started; nothing to do when it has gone already. */
const stopServer = () => new Promise((resolve) => {
  if (server.exitCode !== null || server.signalCode !== null) return resolve()
  server.once('exit', resolve)
  try {
    process.kill(-server.pid, 'SIGTERM')
  } catch {
    resolve()
  }
})
const up = new Promise((resolve, reject) => {
  let log = ''
  const timer = setTimeout(() => reject(new Error(`vite did not start: ${log.slice(-400)}`)), 30_000)
  server.stdout.on('data', (d) => (/Local:/.test((log += d)) ? (clearTimeout(timer), resolve()) : undefined))
  server.stderr.on('data', (d) => (log += d))
  server.on('exit', (code) => reject(new Error(`vite exited ${code}: ${log.slice(-400)}`)))
})
await up.catch(async (error) => {
  await stopServer()
  throw error
})
const dir = mkdtempSync(join(tmpdir(), 'pinball-video-'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
let stats
try {
  // Warm once outside the recording, so shader compiles do not land in the clip.
  const warm = await browser.newPage({ viewport: size })
  await warm.goto(base + query)
  await warm.evaluate(() => window.village.ready())
  await warm.waitForTimeout(3000)
  await warm.close()

  const context = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2, recordVideo: { dir, size } })
  const page = await context.newPage()
  const t0 = Date.now()
  await page.goto(base + query)
  await page.evaluate(() => window.village.ready())
  await page.waitForFunction(() => window.village?.physics?.stats().bodies > 50, null, { timeout: 30_000 })
  await page.evaluate(() => window.village.physics.play(true))
  await page.waitForTimeout(2000)
  const start = (Date.now() - t0) / 1000

  stats = await page.evaluate(({ rounds, seconds, skill }) => new Promise((resolve) => {
    const p = window.village.physics
    const BALLS = ['pinball/ball', 'pinball/ball-2', 'pinball/ball-3']
    const t0 = performance.now()
    const sig = (k) => p.signals()[`pinball/${k}`] ?? 0
    const sum = (re) => Object.entries(p.signals()).filter(([k]) => re.test(k)).reduce((a, [, n]) => a + n, 0)
    const s = { rounds: [], flips: 0, frames: 0 }
    let pull = 0, lost = sig('game.lost')
    const hold = { left: 0, right: 0 }, at = { left: null, right: null }
    const tick = () => {
      const now = performance.now()
      s.frames++
      // A ball waiting in the lane: pull, hold a while, let go.
      const waiting = BALLS.some((k) => { const b = p.thing(k); return b.local[0] > 0.22 && b.local[2] > 0.4 && Math.hypot(...b.velocity) < 0.05 })
      if (!pull && waiting) {
        pull = now + 450 + Math.random() * 400
        p.input('plunger', true)
      } else if (pull && now > pull) {
        p.input('plunger', false)
        pull = 0
      }
      // A ball over a flipper: decide once where along the bat to flip (or, now and then, to miss).
      const want = { left: false, right: false }
      for (const key of BALLS) {
        const [x, , z] = p.thing(key).local
        for (const [side, lo, hi] of [['left', -0.125, -0.027], ['right', -0.023, 0.075]]) {
          if (z < 0.385 || z > 0.455 || x < lo || x > hi) continue
          at[side] ??= Math.random() < skill ? (side === 'left' ? -0.08 + Math.random() * 0.035 : 0.03 - Math.random() * 0.035) : 99
          if (at[side] !== 99 && (side === 'left' ? x >= at[side] : x <= at[side])) want[side] = true
        }
      }
      for (const side of ['left', 'right']) {
        if (want[side] && !hold[side]) {
          hold[side] = now + 200
          p.input(side, true)
          s.flips++
        } else if (hold[side] && now > hold[side]) {
          hold[side] = 0
          at[side] = null
          p.input(side, false)
        }
      }
      if (sig('game.lost') > lost) {
        lost = sig('game.lost')
        s.rounds.push({ score: p.counters()['pinball/score'], at: +((now - t0) / 1000).toFixed(1) })
      }
      if (s.rounds.length >= rounds || now - t0 > seconds * 1000) {
        for (const name of ['left', 'right', 'plunger']) p.input(name, false)
        Object.assign(s, {
          seconds: +((now - t0) / 1000).toFixed(1), score: p.counters()['pinball/score'], bumpers: sum(/bumper-.-sensor\.hit$/), slingshots: sum(/sling-.*-sensor\.hit$/),
          lanes: sum(/lane-.-zone\.enter$/), targets: sum(/target-.-sensor\.hit$/), multiballs: sig('lanes.all'), targetSets: sig('targets.all'), ballsServed: sig('serve.spawned'),
        })
        return resolve(s)
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }), { rounds, seconds, skill })
  await page.waitForTimeout(2500)
  await context.close()
  const webm = readdirSync(dir).find((f) => f.endsWith('.webm'))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-i', join(dir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-movflags', '+faststart', out])
} finally {
  await browser.close().catch(() => {})
  await stopServer()
  rmSync(dir, { recursive: true, force: true })
}
console.log(JSON.stringify(stats, null, 1))
