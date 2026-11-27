#!/usr/bin/env node
// GTA-style automated & AI-scriptable open-world playtest runner (#64).
// Exercises realistic chaotic player behavior in real Chrome with WebGPU — stealing/summoning cars,
// destroying buildings with charges/cannon/fire, high-speed driving & collisions into cars and buildings,
// parkour over rubble, and in-game bug reporting — while recording full black-box telemetry into the inbox
// and running the session anomaly scanner.
//
//   node playtest.mjs [--scenarios all|destroy-buildings,steal-drive,high-speed-crash,rubble-parkour]
//                     [--sf] [--dist dist-sf] [--script actions.json]
//                     [--inbox ~/.village/engine/inbox] [--out DIR] [--headed] [--strict]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arg, chrome, has, here, serve, still } from './test/kit.mjs'
import { plain } from './player/serve.mjs'
import { createInboxRoutes, DEFAULT_INBOX } from './inbox.mjs'
import { scanInbox } from './scan.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * High-level action driver over a live Voxelwright browser page.
 * Used both by built-in GTA playtest scenarios and by external AI playtest agents (`--script` or import).
 */
export class PlaytestDriver {
  constructor(page, outDir) {
    this.page = page
    this.outDir = outDir
    this.shots = []
    this.seenAnomalies = 0
  }

  /** Captures a screenshot immediately whenever new high/critical anomalies fire during play. */
  async captureNewAnomalies(tag = 'auto') {
    const fresh = await this.page.evaluate((seen) => {
      const all = globalThis.engine.recorder.anomalies
      return { total: all.length, items: all.slice(seen).filter((a) => a.severity === 'critical' || a.severity === 'high') }
    }, this.seenAnomalies)
    this.seenAnomalies = fresh.total
    if (fresh.items.length) {
      const kind = fresh.items[0].kind
      await this.screenshot(`anomaly-${this.shots.length + 1}-${kind}-${tag}`)
    }
    return fresh.items
  }

  async mark(name, data = {}) {
    await this.page.evaluate(({ name, data }) => globalThis.engine.recorder.mark(name, data), { name, data })
  }

  async state() {
    return this.page.evaluate(() => {
      const e = globalThis.engine
      const r = e.alive.riding
      return {
        pose: { ...e.pose },
        onFoot: e.me.on,
        foot: e.me.feet,
        riding: r ? { id: r.id, name: r.name, where: e.alive.where(r), telemetry: e.alive.telemetry, dents: e.alive.damage(r)?.dents?.length ?? 0 } : null,
        tool: e.tool,
        bodies: e.bodies,
        burning: e.burning,
        summary: e.recorder.summary(),
        anomalies: [...e.recorder.anomalies],
      }
    })
  }

  async screenshot(name) {
    const file = join(this.outDir, `${name}.png`)
    await this.page.screenshot({ path: file })
    this.shots.push(file)
    return file
  }

  async teleport(x, y, z, yaw = 0, pitch = -0.1, { walk = false } = {}) {
    await this.page.evaluate(({ x, y, z, yaw, pitch, walk }) => {
      const e = globalThis.engine
      if (e.alive.riding) e.alive.mount(null)
      if (e.me.on) e.me.walk(false)
      Object.assign(e.pose, { x, y, z, yaw, pitch })
      if (walk) e.me.walk(true)
    }, { x, y, z, yaw, pitch, walk })
    await this.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    await still(this.page, { limit: 45_000 }).catch(() => {})
    await sleep(250)
  }

  async walk(keys, durationMs, { yaw, pitch } = {}) {
    await this.page.evaluate(({ keys, yaw, pitch }) => {
      const e = globalThis.engine
      if (yaw !== undefined) e.pose.yaw = yaw
      if (pitch !== undefined) e.pose.pitch = pitch
      for (const k of keys) e.input.hold(k, true)
    }, { keys, yaw, pitch })
    await sleep(durationMs)
    await this.page.evaluate((keys) => { for (const k of keys) globalThis.engine.input.hold(k, false) }, keys)
  }

  async selectTool(index) {
    await this.page.evaluate((i) => globalThis.engine.pickTool(i), index)
  }

  async useTool(times = 1, gapMs = 220) {
    for (let i = 0; i < times; i++) {
      await this.page.evaluate(() => globalThis.engine.input.use())
      if (i + 1 < times) await sleep(gapMs)
    }
  }

  async spawnAndMountCar(offsetAheadM = 6, { fine = true, heading = 0 } = {}) {
    return this.page.evaluate(async ({ offsetAheadM, fine, heading }) => {
      const e = globalThis.engine
      if (e.alive.riding) e.alive.mount(null)
      const f = e.me.feet
      const ox = f ? f.at[0] : e.pose.x * 10
      const oz = f ? f.at[2] : e.pose.z * 10
      const cx = Math.round(ox + Math.sin(heading) * offsetAheadM * 10)
      const cz = Math.round(oz - Math.cos(heading) * offsetAheadM * 10)
      const gy = Math.round(e.ground(cx / 10, cz / 10) * 10) + 4
      const spec = (fine ? e.fineCar : e.car)([cx, gy, cz])
      const thing = await e.alive.spawn(spec)
      if (thing.alive) e.alive.mount(thing)
      return { id: thing.id, alive: thing.alive, name: thing.name, at: [cx, gy, cz] }
    }, { offsetAheadM, fine, heading })
  }

  /** Steals the nearest drivable SF street car if present, otherwise summons/spawns a car and mounts it. */
  async stealOrSummonCar() {
    const stolen = await this.page.evaluate(async () => {
      const e = globalThis.engine
      if (e.alive.riding) return { ok: true, how: 'already-riding', name: e.alive.riding.name }
      // Try mounting an existing nearby living vehicle first (like pressing E beside a street car)
      if (e.alive.near) {
        e.alive.mount(e.alive.near)
        return { ok: true, how: 'stolen-near', name: e.alive.near.name }
      }
      // If SF street life has parked/traffic cars nearby, move right beside one so it wakes
      if (e.street) {
        const f = e.me.feet
        const ox = f ? f.at[0] : e.pose.x * 10, oz = f ? f.at[2] : e.pose.z * 10
        const near = e.street.cars(ox, oz, 1200).filter((c) => c.kind === 'parked' || c.kind === 'traffic')
        if (near.length) {
          near.sort((a, b) => Math.hypot(a.x - ox, a.z - oz) - Math.hypot(b.x - ox, b.z - oz))
          const c = near[0]
          if (e.me.on) e.me.walk(false)
          Object.assign(e.pose, { x: (c.x - 25) / 10, y: (c.y + 18) / 10, z: c.z / 10 })
          e.me.walk(true)
          return { ok: false, how: 'approaching', target: c.name }
        }
      }
      await e.summonCar()
      return { ok: false, how: 'summoned' }
    })
    if (stolen.ok) return stolen
    await sleep(900)
    const mounted = await this.page.evaluate(() => {
      const e = globalThis.engine
      if (e.alive.riding) return { ok: true, how: 'riding', name: e.alive.riding.name }
      const target = e.alive.near || e.alive.things.find((t) => t.alive)
      if (target) { e.alive.mount(target); return { ok: true, how: 'mounted', name: target.name } }
      return { ok: false, how: 'none' }
    })
    if (mounted.ok) return mounted
    const spawned = await this.spawnAndMountCar(5, { fine: true })
    return { ok: spawned.alive, how: 'spawned', name: spawned.name }
  }

  async drive({ throttle = 1, steer = 0, drift = false, boost = false, horn = false, durationMs = 1500 }) {
    const keys = []
    if (throttle > 0) keys.push('KeyW')
    else if (throttle < 0) keys.push('KeyS')
    if (steer < 0) keys.push('KeyA')
    else if (steer > 0) keys.push('KeyD')
    if (drift) keys.push('Space')
    if (boost) keys.push('ShiftLeft')
    if (horn) keys.push('KeyH')
    await this.page.evaluate((ks) => { for (const k of ks) globalThis.engine.input.hold(k, true) }, keys)
    await sleep(durationMs)
    await this.page.evaluate((ks) => { for (const k of ks) globalThis.engine.input.hold(k, false) }, keys)
  }

  async dismount() {
    await this.page.evaluate(() => { if (globalThis.engine.alive.riding) globalThis.engine.alive.mount(null) })
    await sleep(250)
  }

  async submitFeedback(message, category = 'other') {
    return this.page.evaluate(({ message, category }) => globalThis.engine.feedback.submit(message, category), { message, category })
  }

  /** Runs a JSON list of actions (for AI-driven playtest agents). */
  async runScript(actions) {
    for (const step of actions) {
      await this.mark(`script:${step.action}`, step)
      switch (step.action) {
        case 'teleport': await this.teleport(step.x, step.y, step.z, step.yaw ?? 0, step.pitch ?? -0.1, { walk: !!step.walk }); break
        case 'walk': await this.walk(step.keys ?? ['KeyW'], step.durationMs ?? 1000, step); break
        case 'selectTool': await this.selectTool(step.index ?? 1); break
        case 'useTool': await this.useTool(step.times ?? 1, step.gapMs ?? 220); break
        case 'stealOrSummonCar': await this.stealOrSummonCar(); break
        case 'drive': await this.drive(step); break
        case 'dismount': await this.dismount(); break
        case 'wait': await sleep(step.ms ?? 500); break
        case 'screenshot': await this.screenshot(step.name || `step-${this.shots.length + 1}`); break
        case 'feedback': await this.submitFeedback(step.message || 'AI playtest report', step.category || 'other'); break
        default: throw new Error(`Unknown playtest action: ${step.action}`)
      }
    }
  }
}

/** Finds a clear street point and a facing angle that points straight at a nearby building facade. */
async function findStreetAndBuilding(page) {
  return page.evaluate(async () => {
    const e = globalThis.engine
    const startX = e.pose.x, startZ = e.pose.z
    const g = e.ground(startX, startZ)
    // Probe 8 directions from eye height (g + 4 m) to find a building wall 8..35 m away
    for (let k = 0; k < 12; k++) {
      const yaw = (k * Math.PI * 2) / 12
      Object.assign(e.pose, { x: startX, y: g + 4, z: startZ, yaw, pitch: -0.04 })
      const hit = await e.pick(0, 0)
      if (hit && hit.t > 60 && hit.t < 380 && [1, 2, 3, 4, 8, 9, 10, 11, 12].includes(hit.material)) {
        return { x: startX, y: g + 2, z: startZ, yaw, pitch: -0.04, distM: hit.t / 10, material: hit.material }
      }
    }
    return { x: startX, y: g + 2, z: startZ, yaw: e.pose.yaw, pitch: -0.08, distM: 15, material: 0 }
  })
}

export const SCENARIOS = {
  /** GTA Scenario 1: Blow open a building with charges, cannon, and torch, then walk into the rubble. */
  async 'destroy-buildings'(d) {
    await d.mark('scenario:destroy-buildings:start')
    const spot = await findStreetAndBuilding(d.page)
    await d.teleport(spot.x, spot.y + 1.5, spot.z, spot.yaw, -0.04, { walk: true })
    await d.screenshot('destroy-before')

    // Hammer -> Charge -> Big charge -> Cannon -> Torch
    await d.selectTool(0); await d.useTool(1)
    await sleep(300)
    await d.selectTool(1); await d.useTool(2, 350)
    await sleep(450)
    await d.selectTool(2); await d.useTool(2, 450)
    await d.selectTool(3); await d.useTool(2, 300)
    await d.selectTool(4); await d.useTool(1)
    await sleep(1600)
    await d.screenshot('destroy-after-blasts')

    // Sprint forward into the newly created rubble & doorway
    await d.walk(['KeyW', 'ShiftLeft'], 1400, { yaw: spot.yaw, pitch: -0.15 })
    await d.walk(['KeyW', 'Space'], 700, { yaw: spot.yaw, pitch: -0.15 })
    await d.screenshot('destroy-in-rubble')
    await d.mark('scenario:destroy-buildings:end')
  },

  /** GTA Scenario 2: Steal or summon a car, cruise fast, drift turns, honk, boost, and dismount. */
  async 'steal-drive'(d) {
    await d.mark('scenario:steal-drive:start')
    const res = await d.stealOrSummonCar()
    await d.mark('scenario:steal-drive:mounted', res)
    await sleep(300)
    await d.screenshot('steal-mounted')

    // Full throttle launch + nitrous boost + drift right + weave left + honk
    await d.drive({ throttle: 1, boost: true, durationMs: 1400 })
    await d.drive({ throttle: 1, steer: 1, drift: true, horn: true, durationMs: 900 })
    await d.drive({ throttle: 1, steer: -1, durationMs: 900 })
    await d.drive({ throttle: -1, durationMs: 600 })
    await d.screenshot('steal-after-cruise')
    await d.dismount()
    await d.mark('scenario:steal-drive:end')
  },

  /** GTA Scenario 3: Full-throttle oncoming traffic chaos & multi-car pileups (SF street traffic + parked cars). */
  async 'oncoming-traffic-chaos'(d) {
    await d.mark('scenario:oncoming-traffic-chaos:start')
    const res = await d.stealOrSummonCar()
    await d.mark('scenario:oncoming-traffic-chaos:mounted', res)
    await sleep(300)
    // Accelerate hard straight down the street, then swerve aggressively across lanes into traffic and kerbs
    await d.drive({ throttle: 1, boost: true, durationMs: 2200 })
    await d.captureNewAnomalies('traffic-run1')
    await d.screenshot('traffic-chaos-1')
    await d.drive({ throttle: 1, steer: -1, boost: true, horn: true, durationMs: 900 })
    await d.drive({ throttle: 1, steer: 1, boost: true, durationMs: 1300 })
    await d.captureNewAnomalies('traffic-run2')
    await d.drive({ throttle: -1, steer: 1, durationMs: 900 })
    await d.drive({ throttle: 1, boost: true, durationMs: 1800 })
    await d.captureNewAnomalies('traffic-run3')
    await d.screenshot('traffic-chaos-2')
    await d.dismount()
    await d.mark('scenario:oncoming-traffic-chaos:end')
  },

  /** GTA Scenario 4: Full-speed boosted head-on ram into building facades & corners (wall clipping / deformation test). */
  async 'building-ram-crash'(d) {
    await d.mark('scenario:building-ram-crash:start')
    await d.stealOrSummonCar()
    await sleep(250)
    // Turn sharply off the road straight into building walls at full boost, back up, and ram again
    await d.drive({ throttle: 1, boost: true, durationMs: 1600 })
    await d.drive({ throttle: 1, steer: 1, boost: true, durationMs: 1200 })
    await d.captureNewAnomalies('building-ram1')
    await d.screenshot('building-ram-1')
    await d.drive({ throttle: -1, durationMs: 1100 })
    await d.drive({ throttle: 1, steer: -1, boost: true, durationMs: 1600 })
    await d.captureNewAnomalies('building-ram2')
    await d.screenshot('building-ram-2')
    await d.dismount()
    await d.mark('scenario:building-ram-crash:end')
  },

  /** GTA Scenario 5: Full-throttle crash into another car AND straight into a building wall. */
  async 'high-speed-crash'(d) {
    await d.mark('scenario:high-speed-crash:start')
    // Position on a clear street line with a second parked car right ahead, and a building beyond.
    // In SF (`e.street`), snap to a real flat road segment aligned along +x (car spawn front=0) instead of spawning into a building.
    const setup = await d.page.evaluate(async () => {
      const e = globalThis.engine
      if (e.alive.riding) e.alive.mount(null)
      if (e.me.on) e.me.walk(false)
      let bx = Math.round(e.pose.x * 10), bz = Math.round(e.pose.z * 10)
      if (e.street) {
        const roads = e.street.roads(bx, bz, 3000)
        for (const r of roads) {
          for (let i = 0; i + 3 < r.line.length; i += 2) {
            const dx = r.line[i + 2] - r.line[i], dz = r.line[i + 3] - r.line[i + 1]
            const len = Math.hypot(dx, dz)
            if (len > 300 && dx / len > 0.92 && Math.abs(dz / len) < 0.35) {
              bx = Math.round(r.line[i] + dx * 0.2)
              bz = Math.round(r.line[i + 1] + dz * 0.2)
              Object.assign(e.pose, { x: bx / 10, y: e.ground(bx / 10, bz / 10) + 2, z: bz / 10 })
              break
            }
          }
        }
      }
      const g1 = Math.round(e.ground(bx / 10, bz / 10) * 10) + 4
      const g2 = Math.round(e.ground((bx + 220) / 10, bz / 10) * 10) + 4
      // Target parked vehicle 22 m east (+x, car front=0 points +x)
      const victim = await e.alive.spawn(e.car([bx + 220, g2, bz]))
      // Player's fast car behind it, aimed directly at the victim
      const playerCar = await e.alive.spawn(e.fineCar([bx, g1, bz]))
      if (playerCar.alive) e.alive.mount(playerCar)
      return { victimId: victim.id, playerId: playerCar.id, ok: victim.alive && playerCar.alive }
    })
    await d.mark('scenario:high-speed-crash:setup', setup)
    await sleep(300)
    await d.screenshot('crash-before')

    // Floor it with boost directly through the parked car and into whatever building stands ahead!
    await d.drive({ throttle: 1, boost: true, durationMs: 2200 })
    await d.screenshot('crash-impact')
    // Reverse out and veer hard left into another obstacle
    await d.drive({ throttle: -1, steer: -1, durationMs: 900 })
    await d.drive({ throttle: 1, steer: 1, boost: true, durationMs: 1400 })
    await d.screenshot('crash-after')
    await d.dismount()
    await d.mark('scenario:high-speed-crash:end')
  },

  /** GTA Scenario 4: Blast rubble craters, jump/parkour across debris, and file an in-game feedback report. */
  async 'rubble-parkour'(d) {
    await d.mark('scenario:rubble-parkour:start')
    await d.selectTool(1) // Charge
    // Look down slightly at the road/curb ahead and blast two craters
    await d.page.evaluate(() => { globalThis.engine.pose.pitch = -0.35 })
    await d.useTool(2, 350)
    await sleep(800)
    // Walk and jump repeatedly across the crater & rubble
    await d.page.evaluate(() => { if (!globalThis.engine.me.on) globalThis.engine.me.walk(true) })
    await sleep(300)
    await d.walk(['KeyW', 'Space'], 900)
    await d.walk(['KeyW', 'KeyD', 'Space'], 900)
    await d.walk(['KeyW', 'KeyA', 'ShiftLeft'], 900)
    await d.screenshot('parkour-rubble')

    // Submit a realistic in-game feedback report with canvas screenshot + pick + 30 s trace
    await d.page.evaluate(() => { globalThis.engine.pose.pitch = -0.05 })
    const fb = await d.submitFeedback('Automated GTA playtest check: verifying building facade, rubble, and physics state', 'building')
    await d.mark('scenario:rubble-parkour:feedback', { sent: fb.sent, id: fb.id })
    await d.mark('scenario:rubble-parkour:end')
  },
}

export async function runPlaytest(options = {}) {
  const inboxDir = resolve(options.inbox || DEFAULT_INBOX)
  const outDir = resolve(options.out || join(tmpdir(), `voxelwright-playtest-${Date.now()}`))
  mkdirSync(outDir, { recursive: true })
  mkdirSync(inboxDir, { recursive: true })

  const useSf = Boolean(options.sf)
  const distDir = resolve(options.dist || join(here, 'dist-sf'))

  let server = null
  let baseUrl = options.url || ''
  if (!baseUrl) {
    if (useSf) {
      if (!existsSync(join(distDir, 'sf', 'index.html'))) {
        throw new Error(`SF realm build not found at ${distDir}/sf/index.html (run: node engine/sf/build.mjs)`)
      }
      const handleInbox = createInboxRoutes(inboxDir, {
        send: (res, code, body, type = 'text/plain') => { res.writeHead(code, { 'Content-Type': type }); res.end(body) },
        foreign: () => false,
      })
      server = await plain(distDir, '127.0.0.1', 0, {
        extra: (req, res) => handleInbox(req, res, new URL(req.url ?? '/', 'http://127.0.0.1')),
      })
      baseUrl = server.url
    } else {
      server = await serve('/dev/null', ['--inbox', inboxDir])
      baseUrl = server.url
    }
  }

  const browser = options.browser || await chrome()
  const ownBrowser = !options.browser
  const pageErrors = []
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    page.on('pageerror', (e) => pageErrors.push(e.message))

    const targetUrl = useSf
      ? `${baseUrl}/sf/index.html?telemetry=1&scale=0.65`
      : `${baseUrl}/city?fly=0&scale=0.65`

    await page.goto(targetUrl)
    await page.waitForFunction(() => globalThis.engine?.recorder && globalThis.engine?.world?.stats?.ready > 0, null, { timeout: 90_000 })

    if (useSf) {
      await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine?.explore, null, { timeout: 120_000 })
      await page.evaluate(() => { void globalThis.engine.explore.go() })
      await page.waitForFunction(() => globalThis.engine.explore?.state === 'in' && globalThis.engine.me?.feet, null, { timeout: 90_000 })
      await still(page, { limit: 60_000 }).catch(() => {})
      await sleep(1800)
    } else {
      await still(page, { limit: 60_000 })
    }

    const driver = new PlaytestDriver(page, outDir)
    const results = []

    if (options.script) {
      const actions = JSON.parse(readFileSync(resolve(options.script), 'utf8'))
      const t0 = Date.now()
      await driver.runScript(actions)
      results.push({ scenario: 'script', ms: Date.now() - t0, state: await driver.state() })
    } else {
      const names = !options.scenarios || options.scenarios === 'all'
        ? Object.keys(SCENARIOS)
        : String(options.scenarios).split(',').map((s) => s.trim()).filter(Boolean)
      for (const name of names) {
        const fn = SCENARIOS[name]
        if (!fn) throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(SCENARIOS).join(', ')}`)
        const t0 = Date.now()
        console.log(`  playtest: running "${name}"…`)
        await fn(driver)
        await driver.captureNewAnomalies(name)
        const st = await driver.state()
        results.push({ scenario: name, ms: Date.now() - t0, summary: st.summary, anomalyCount: st.anomalies.length })
      }
    }

    // Flush the complete playtest session into the inbox
    const flushed = await page.evaluate(() => globalThis.engine.recorder.flush('playtest', false))
    const finalState = await driver.state()
    const scan = scanInbox(inboxDir, { since: '1h' })

    const report = {
      ranAt: new Date().toISOString(),
      targetUrl,
      inboxDir,
      outDir,
      flushed,
      pageErrors,
      scenarios: results,
      summary: finalState.summary,
      anomalies: finalState.anomalies,
      screenshots: driver.shots,
      scanClusters: scan.clusters,
    }
    const reportPath = join(outDir, 'playtest-report.json')
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    await context.close()
    return { report, reportPath }
  } finally {
    if (ownBrowser) await browser.close()
    if (server) server.stop()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { report, reportPath } = await runPlaytest({
    scenarios: arg('scenarios', 'all'),
    sf: has('sf'),
    dist: arg('dist', ''),
    script: arg('script', ''),
    inbox: arg('inbox', DEFAULT_INBOX),
    out: arg('out', ''),
    url: arg('url', ''),
  })
  const s = report.summary
  console.log(`\nGTA playtest finished -> ${reportPath}`)
  console.log(`  duration: ${s.durationS} s · frames: ${s.frames} · fps p50/p95: ${s.fpsP50}/${s.fpsP95} · worst gap: ${s.worstGapMs} ms`)
  console.log(`  action:   distance ${s.distanceM} m · blasts ${s.blasts} · crashes ${s.crashes} · vehicles driven ${s.vehiclesDriven}`)
  console.log(`  health:   ${report.pageErrors.length} page errors · ${s.anomalyCount} anomalies (${s.criticalCount} critical, ${s.highCount} high)`)
  for (const a of report.anomalies) {
    console.log(`    [${a.severity.toUpperCase()}] ${a.kind}: ${a.summary}`)
  }
  console.log(`  inbox:    ${report.inboxDir} (${report.scanClusters.length} clusters; inspect with: node engine/scan.mjs --inbox ${JSON.stringify(report.inboxDir)})`)
  if (has('strict') && (report.pageErrors.length > 0 || s.criticalCount > 0)) {
    process.exit(1)
  }
}
