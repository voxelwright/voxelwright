// Plays the pinball table headless on a phone-sized screen and records it (#108): a clip to look
// at, and numbers about how a round goes (seconds a ball lasts, score a round, flips that met the
// ball). A simple player in the page holds a flipper when the ball comes down onto it and pulls
// the plunger when the ball waits in the lane; it sets the table's inputs by name each frame
// (headless touch input is too slow to time a flip), so this shows the game, not the fingers:
// check-physics-touch.mjs and check-physics-game.mjs prove those.
// Usage: node scripts/demo-pinball.mjs <out.mp4> [--dev=5455] [--rounds=1] [--seconds=90] [--q=high]
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const out = args.find((a) => !a.startsWith('--'))
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
if (!out) throw new Error('usage: demo-pinball.mjs <out.mp4> [--dev=5455] [--rounds=1] [--seconds=90] [--q=high]')
const devPort = Number(opt('dev') ?? 5455)
const rounds = Number(opt('rounds') ?? 1)
const seconds = Number(opt('seconds') ?? 90)
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

  stats = await page.evaluate(({ rounds, seconds }) => new Promise((resolve) => {
    const p = window.village.physics
    const t0 = performance.now()
    const s = { rounds: [], balls: [], flips: 0, frames: 0 }
    let pull = 0, ballFrom = 0, lost = p.signals()['pinball/game.lost'] ?? 0, used = 3
    const hold = { left: 0, right: 0 }
    const tick = () => {
      const now = performance.now()
      s.frames++
      const ball = p.thing('pinball/ball')
      const [x, , z] = ball.local
      const speed = Math.hypot(...ball.velocity)
      // In the lane and still: pull, hold a while, let go.
      if (x > 0.22 && z > 0.4 && speed < 0.05 && !pull) {
        pull = now + 500 + Math.random() * 400
        p.input('plunger', true)
        if (ballFrom) s.balls.push(+((now - ballFrom) / 1000).toFixed(1))
        ballFrom = 0
      } else if (pull && now > pull) {
        p.input('plunger', false)
        pull = 0
        ballFrom = now
      }
      // Coming down onto a flipper: hold it for a moment.
      for (const [side, lo, hi] of [['left', -0.15, -0.02], ['right', -0.03, 0.1]]) {
        if (!hold[side] && z > 0.385 && z < 0.47 && x > lo && x < hi && ball.velocity[2] > -0.2) {
          hold[side] = now + 140
          p.input(side, true)
          s.flips++
        } else if (hold[side] && now > hold[side] && !(z > 0.385 && z < 0.44 && x > lo && x < hi)) {
          hold[side] = 0
          p.input(side, false)
        }
      }
      const balls = p.counters()['pinball/balls']
      if (balls !== used) used = balls
      const nowLost = p.signals()['pinball/game.lost'] ?? 0
      if (nowLost > lost) {
        lost = nowLost
        s.rounds.push({ score: p.counters()['pinball/score'], at: +((now - t0) / 1000).toFixed(1) })
      }
      if (s.rounds.length >= rounds || now - t0 > seconds * 1000) {
        for (const name of ['left', 'right', 'plunger']) p.input(name, false)
        s.seconds = +((now - t0) / 1000).toFixed(1)
        s.score = p.counters()['pinball/score']
        s.hits = Object.entries(p.signals()).filter(([k]) => /bumper-.-sensor\.hit$/.test(k)).reduce((a, [, n]) => a + n, 0)
        return resolve(s)
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }), { rounds, seconds })
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
