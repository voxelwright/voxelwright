#!/usr/bin/env node
// Deterministic issue & play-session replayer (#64).
// Loads a saved feedback or session bundle from ~/.village/engine/inbox/ into real Chrome with WebGPU,
// restores world settings & recorded edits, captures the exact visual view + pick target, and replays
// physics/input and traffic windows to confirm whether reported bugs or anomalies reproduce.
//
//   node replay.mjs <bundle.json> [--out DIR] [--url http://127.0.0.1:port] [--dist dist-sf] [--headed]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arg, chrome, here, serve, still } from './test/kit.mjs'
import { plain } from './player/serve.mjs'
import { classifyFeedback } from './scan.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Replays a saved feedback or session bundle against the live engine in headless Chrome.
 * Can be called programmatically (e.g. from test/telemetry.mjs or playtest.mjs) or via CLI.
 */
export async function replayBundle(bundlePath, options = {}) {
  const absBundle = resolve(bundlePath)
  const bundle = JSON.parse(readFileSync(absBundle, 'utf8'))
  const outDir = resolve(options.out || join(tmpdir(), `voxelwright-replay-${bundle.id || Date.now()}`))
  mkdirSync(outDir, { recursive: true })

  // Copy original screenshot beside replay output when present
  const origShotSrc = bundle.screenshotFile ? join(dirname(absBundle), bundle.screenshotFile) : null
  let originalScreenshot = null
  if (origShotSrc && existsSync(origShotSrc)) {
    const ext = origShotSrc.endsWith('.png') ? '.png' : '.webp'
    originalScreenshot = join(outDir, `original${ext}`)
    copyFileSync(origShotSrc, originalScreenshot)
  }

  const meta = bundle.meta || {}
  const useSf = Boolean(options.dist || (meta.localRealm === 'sf' && existsSync(join(here, 'dist-sf', 'sf', 'index.html'))))
  const distDir = options.dist ? resolve(options.dist) : join(here, 'dist-sf')

  let server = null
  let baseUrl = options.url || ''
  if (!baseUrl) {
    if (useSf && existsSync(join(distDir, 'sf', 'index.html'))) {
      server = await plain(distDir, '127.0.0.1', 0)
      baseUrl = server.url
    } else {
      server = await serve('/dev/null')
      baseUrl = server.url
    }
  }

  const browser = options.browser || await chrome()
  const ownBrowser = !options.browser
  const viewport = Array.isArray(meta.viewport) && meta.viewport.length === 2 ? { width: Math.max(320, Math.min(1920, meta.viewport[0])), height: Math.max(240, Math.min(1200, meta.viewport[1])) } : { width: 1280, height: 720 }

  const pageErrors = []
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
    const page = await context.newPage()
    page.on('pageerror', (e) => pageErrors.push(e.message))

    const settings = meta.settings || {}
    const params = new URLSearchParams()
    if (!useSf) {
      params.set('fly', '0')
      if (meta.bay && !meta.localRealm) params.set('bay', '1')
    }
    if (settings.hour !== null && settings.hour !== undefined) params.set('hour', String(settings.hour))
    if (settings.rain) params.set('rain', String(settings.rain))
    if (settings.fog) params.set('fog', String(settings.fog))
    params.set('scale', String(settings.scale || 0.75))

    const targetUrl = useSf
      ? `${baseUrl}/sf/index.html?${params.toString()}`
      : `${baseUrl}/city?${params.toString()}`

    await page.goto(targetUrl)
    await page.waitForFunction(() => globalThis.engine?.recorder && globalThis.engine?.world?.stats?.ready > 0, null, { timeout: 90_000 })

    // If SF landing first-view is up, engage directly so pose/streetLife are live.
    if (useSf) {
      await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine?.explore, null, { timeout: 120_000 }).catch(() => {})
      await page.evaluate(() => {
        const e = globalThis.engine
        if (e.explore && e.explore.state !== 'in') void e.explore.go()
      })
      await page.waitForFunction(() => !globalThis.engine.explore || globalThis.engine.explore.state === 'in', null, { timeout: 60_000 }).catch(() => {})
    }

    // 1. Replay recorded world edits (up to last reset, then edits after)
    const allEdits = Array.isArray(bundle.edits) ? bundle.edits : []
    const lastResetIdx = allEdits.map((e) => e.op).lastIndexOf('reset')
    const editsToApply = lastResetIdx >= 0 ? allEdits.slice(lastResetIdx + 1) : allEdits
    if (editsToApply.length) {
      await page.evaluate((edits) => {
        const e = globalThis.engine
        e.recorder.enabled = false
        for (const ed of edits) e.replayEdit?.(ed)
        e.recorder.enabled = true
      }, editsToApply)
      await still(page, { limit: 45_000 }).catch(() => {})
    }

    // 2. Visual / Building view repro at the exact rendered camera eye (or fallback to last keyframe pose)
    const keyframes = Array.isArray(bundle.keyframes) ? bundle.keyframes : []
    const lastKf = keyframes.at(-1) || null
    const visualPose = Array.isArray(meta.camera) && meta.camera.length >= 5 ? meta.camera : (lastKf?.pose || null)
    if (visualPose) {
      await page.evaluate(({ pose, settings }) => {
        const e = globalThis.engine
        if (e.alive?.riding) e.alive.mount(null)
        if (e.me?.on) e.me.walk(false)
        Object.assign(e.pose, { x: pose[0], y: pose[1], z: pose[2], yaw: pose[3], pitch: pose[4] })
        if (Number.isFinite(pose[5])) e.fov = pose[5]
        if (settings.hour !== null && settings.hour !== undefined) e.hour = settings.hour
        if (typeof settings.rain === 'number') e.rain = settings.rain
        if (typeof settings.fog === 'number') e.fog = settings.fog
      }, { pose: visualPose, settings })
      // Let world.update() enqueue the sectors around the teleported eye before waiting for still().
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      await still(page, { limit: 45_000 }).catch(() => {})
      await sleep(250)
    }

    const replayViewPath = join(outDir, 'replay-view.png')
    await page.screenshot({ path: replayViewPath })
    const replayPick = await page.evaluate((pin) => globalThis.engine.recorder.pickAt(pin ?? null), bundle.feedback?.pin ?? null)

    const origPick = bundle.pick || null
    const pickDeltaCells = origPick && replayPick
      ? Math.round(Math.hypot(origPick.cell[0] - replayPick.cell[0], origPick.cell[1] - replayPick.cell[1], origPick.cell[2] - replayPick.cell[2]) * 10) / 10
      : null

    // 3. Decide whether physics/input replay or traffic replay is needed
    const anomalies = Array.isArray(bundle.anomalies) ? bundle.anomalies : []
    const fbCat = bundle.feedback ? classifyFeedback(bundle.feedback.message, bundle.feedback.category) : ''
    const wantPhysics =
      fbCat === 'stuck' ||
      anomalies.some((a) => ['player_stuck', 'fell_under_ground', 'inside_solid', 'nan_state'].includes(a.kind)) ||
      keyframes.some((k) => k.mode !== 'flying' && k.input?.held?.length > 0)

    const wantTraffic =
      fbCat === 'vehicle' ||
      anomalies.some((a) => ['vehicle_overlap', 'vehicle_stuck', 'vehicle_in_solid'].includes(a.kind))

    let physicsRepro = null
    if (wantPhysics && keyframes.length >= 2) {
      // Replay up to the last 8 seconds of keyframes containing foot/riding inputs
      const endT = keyframes.at(-1).t
      const windowKfs = keyframes.filter((k) => k.t >= endT - 8000)
      const firstKf = windowKfs[0]
      if (firstKf) {
        await page.evaluate((kf) => {
          const e = globalThis.engine
          e.recorder.clear()
          if (e.alive?.riding) e.alive.mount(null)
          if (e.me?.on) e.me.walk(false)
          if (kf.foot) {
            Object.assign(e.pose, { x: kf.foot.at[0] / 10, y: (kf.foot.at[1] + 16.5) / 10, z: kf.foot.at[2] / 10, yaw: kf.pose[3], pitch: kf.pose[4] })
            e.me.walk(true)
          } else {
            Object.assign(e.pose, { x: kf.pose[0], y: kf.pose[1], z: kf.pose[2], yaw: kf.pose[3], pitch: kf.pose[4] })
            if (kf.mode === 'foot') e.me.walk(true)
          }
        }, firstKf)
        await sleep(300)

        // Step recorded inputs at their original cadence (capped to keep replay snappy)
        const heldNow = new Set()
        for (let i = 0; i < windowKfs.length; i++) {
          const kf = windowKfs[i]
          const next = windowKfs[i + 1]
          const stepMs = next ? Math.max(50, Math.min(300, next.t - kf.t)) : 200
          const wantKeys = new Set(kf.input?.held || [])
          const toRelease = [...heldNow].filter((k) => !wantKeys.has(k))
          const toPress = [...wantKeys].filter((k) => !heldNow.has(k))
          for (const k of toRelease) heldNow.delete(k)
          for (const k of toPress) heldNow.add(k)
          await page.evaluate(({ toRelease, toPress, yaw, pitch }) => {
            const e = globalThis.engine
            for (const k of toRelease) e.input.hold(k, false)
            for (const k of toPress) e.input.hold(k, true)
            e.pose.yaw = yaw
            e.pose.pitch = pitch
          }, { toRelease, toPress, yaw: kf.pose[3], pitch: kf.pose[4] })
          await sleep(stepMs)
        }
        await page.evaluate((keys) => { for (const k of keys) globalThis.engine.input.hold(k, false) }, [...heldNow])

        const physShot = join(outDir, 'replay-physics-end.png')
        await page.screenshot({ path: physShot })
        const physState = await page.evaluate(() => {
          const e = globalThis.engine
          return {
            pose: { ...e.pose },
            foot: e.me?.feet ?? null,
            anomalies: [...e.recorder.anomalies],
            summary: e.recorder.summary(),
          }
        })
        const startPos = firstKf.foot ? firstKf.foot.at : [firstKf.pose[0] * 10, firstKf.pose[1] * 10, firstKf.pose[2] * 10]
        const endPos = physState.foot ? physState.foot.at : [physState.pose.x * 10, physState.pose.y * 10, physState.pose.z * 10]
        const targetKinds = new Set(anomalies.filter((a) => ['player_stuck', 'fell_under_ground', 'inside_solid', 'nan_state'].includes(a.kind)).map((a) => a.kind))
        if (fbCat === 'stuck') targetKinds.add('player_stuck')
        const matched = physState.anomalies.filter((a) => targetKinds.size === 0 || targetKinds.has(a.kind))
        physicsRepro = {
          replayedFrames: windowKfs.length,
          displacementM: Math.round(Math.hypot(endPos[0] - startPos[0], endPos[2] - startPos[2])) / 10,
          reproduced: matched.length > 0,
          matchedAnomalies: matched,
          allAnomalies: physState.anomalies,
          screenshot: physShot,
        }
      }
    }

    let trafficRepro = null
    if (wantTraffic && keyframes.length >= 1) {
      const endT = keyframes.at(-1).t
      const firstKf = keyframes.find((k) => k.t >= endT - 6000) || keyframes[0]
      const hasStreet = await page.evaluate((kf) => {
        const e = globalThis.engine
        if (!e.street) return false
        e.recorder.clear()
        Object.assign(e.pose, { x: kf.pose[0], y: kf.pose[1], z: kf.pose[2], yaw: kf.pose[3], pitch: kf.pose[4] })
        e.street.reset()
        if (typeof kf.streetRng === 'number' && kf.streetRng !== 0) e.street.rng = kf.streetRng
        return true
      }, firstKf)
      if (hasStreet) {
        await sleep(3500)
        const trShot = join(outDir, 'replay-traffic-end.png')
        await page.screenshot({ path: trShot })
        const trState = await page.evaluate(() => ({
          anomalies: [...globalThis.engine.recorder.anomalies],
          cars: globalThis.engine.street.snapshot(globalThis.engine.pose.x * 10, globalThis.engine.pose.z * 10, 900).length,
        }))
        const vehAnom = trState.anomalies.filter((a) => ['vehicle_overlap', 'vehicle_stuck', 'vehicle_in_solid'].includes(a.kind))
        trafficRepro = {
          streetRng: firstKf.streetRng,
          carsObserved: trState.cars,
          reproduced: vehAnom.length > 0,
          anomalies: vehAnom,
          screenshot: trShot,
        }
      }
    }

    const report = {
      bundlePath: absBundle,
      bundleId: bundle.id || bundle.sessionId || null,
      feedback: bundle.feedback || null,
      replayedAt: new Date().toISOString(),
      targetUrl,
      editsReplayed: editsToApply.length,
      pageErrors,
      visual: {
        pose: visualPose,
        screenshot: replayViewPath,
        originalScreenshot,
        pick: replayPick,
        originalPick: origPick,
        pickDeltaCells,
      },
      physicsRepro,
      trafficRepro,
      reproduced: Boolean(
        physicsRepro?.reproduced ||
        trafficRepro?.reproduced ||
        (bundle.feedback && replayPick && (!origPick || (pickDeltaCells !== null && pickDeltaCells < 25))),
      ),
    }

    const reportPath = join(outDir, 'replay-report.json')
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    await context.close()
    return { report, reportPath, outDir }
  } finally {
    if (ownBrowser) await browser.close()
    if (server) server.stop()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file || file.startsWith('--')) {
    console.error('Usage: node engine/replay.mjs <bundle.json> [--out DIR] [--url URL] [--dist dist-sf] [--headed]')
    process.exit(2)
  }
  const { report, reportPath } = await replayBundle(file, {
    out: arg('out', ''),
    url: arg('url', ''),
    dist: arg('dist', ''),
  })
  console.log(`Replay complete -> ${reportPath}`)
  if (report.feedback?.message) console.log(`  feedback: "${report.feedback.message}"`)
  console.log(`  visual:   ${report.visual.screenshot}`)
  if (report.visual.pick) {
    const g = report.visual.pick.geo
    console.log(`  pick:     cell ${report.visual.pick.cell.join(',')} mat=${report.visual.pick.material} dist=${report.visual.pick.distanceM}m${g?.tile ? ` tile=${g.tile} (${g.latLon?.join(', ')})` : ''}${report.visual.pickDeltaCells !== null ? ` delta=${report.visual.pickDeltaCells} cells` : ''}`)
  }
  if (report.physicsRepro) console.log(`  physics:  reproduced=${report.physicsRepro.reproduced} (${report.physicsRepro.replayedFrames} frames, moved ${report.physicsRepro.displacementM} m, ${report.physicsRepro.allAnomalies.length} anomalies)`)
  if (report.trafficRepro) console.log(`  traffic:  reproduced=${report.trafficRepro.reproduced} (${report.trafficRepro.carsObserved} cars, ${report.trafficRepro.anomalies.length} anomalies)`)
  if (report.pageErrors.length) console.log(`  errors:   ${report.pageErrors.join('; ')}`)
}
