// End-to-end verification of Voxelwright's tennis court controller, core.wasm sports bridge,
// modal tennis foley hook, and 100 ms RTT deterministic rollback synchronization (#166).
// Runs directly against REAL `engine/page/core.wasm` (zero physics mocks).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  BALL_RADIUS_CELLS,
  DeterministicRollbackClient,
  ITF_COURT,
  SNAPSHOT_BYTES,
  SportsWasm,
  TICK_DT,
  TennisCourtController,
  cellsPerSecToKmh,
  decodeBallSnapshot,
  encodeBallSnapshot,
  kmhToCellsPerSec,
  racketPoseFromNormal,
} from '../page/sports-court.ts'
import { COMBAT_PATCHES, combatSound } from '../page/sound/combat.ts'

const here = dirname(fileURLToPath(import.meta.url))
const wasmPath = join(here, '..', 'page', 'core.wasm')
const wasmBytes = readFileSync(wasmPath)

async function instantiateSports() {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {})
  return SportsWasm.fromInstance(instance)
}

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function allFinite3(v) {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
}

// ── Test 0: 32-Byte Wire Snapshot Codec Parity with core.wasm ───────────────

async function testWireSnapshotParity() {
  const wasm = await instantiateSports()
  wasm.reset()
  wasm.setCourt('hard', 0, 0, true)
  const id = wasm.spawn([12.345, 18.75, -64.125], [42.5, -18.25, 555.56], [285.5, -19.25, 44.75])
  wasm.step(5, false)

  const wasmSnapBytes = wasm.writeSnapshot(id)
  assert.ok(wasmSnapBytes instanceof Uint8Array && wasmSnapBytes.byteLength === SNAPSHOT_BYTES)

  const state = wasm.readBall(id)
  assert.ok(state)
  const tsSnapBytes = encodeBallSnapshot({
    tick: wasm.tick,
    pos: state.pos,
    vel: state.vel,
    spin: state.spin,
  })
  assert.equal(tsSnapBytes.byteLength, SNAPSHOT_BYTES)
  assert.deepEqual(tsSnapBytes, wasmSnapBytes, 'TS 32-byte encoder must match core.wasm byte-for-byte')

  const decoded = decodeBallSnapshot(wasmSnapBytes)
  assert.equal(decoded.tick, wasm.tick)
  assert.deepEqual(decoded.pos, state.pos, 'position must round-trip losslessly as f32')
  assert.ok(dist3(decoded.vel, state.vel) < 0.05, `vel quantization error too large: ${dist3(decoded.vel, state.vel)}`)
  assert.ok(dist3(decoded.spin, state.spin) < 0.05, `spin quantization error too large: ${dist3(decoded.spin, state.spin)}`)
  console.log('[pass] Test 0: 32-byte wire codec matches core.wasm byte-for-byte')
}

// ── Test 1: 200 km/h Serve + Surface Bounces + Topspin Dip + Scoring ────────

async function testServeRallyAndScoring() {
  const surfaceResults = {}

  for (const surface of ['hard', 'clay', 'grass']) {
    const wasm = await instantiateSports()
    const court = new TennisCourtController(wasm, { surface })
    court.serve({ server: 'near', speedKmh: 200, spinRpm: 1500, targetX: 0, targetDepth: 48 })

    const launch = court.readBall()
    assert.ok(launch)
    const launchKmh = cellsPerSecToKmh(Math.hypot(...launch.vel))
    assert.ok(launchKmh >= 199 && launchKmh <= 201, `expected ~200 km/h serve, got ${launchKmh.toFixed(1)} km/h`)

    let firstBounce = null
    let postBounceState = null
    let maxPostBounceY = 0
    for (let t = 0; t < 180; t++) {
      const events = court.step(1)
      const ball = court.readBall()
      assert.ok(ball && allFinite3(ball.pos) && allFinite3(ball.vel) && allFinite3(ball.spin))
      for (const ev of events) {
        if (ev.type === 'bounce' && !firstBounce) {
          firstBounce = ev
          postBounceState = { pos: [...ball.pos], vel: [...ball.vel], spin: [...ball.spin] }
        }
      }
      if (firstBounce && ball.pos[1] > maxPostBounceY) {
        maxPostBounceY = ball.pos[1]
      }
    }

    assert.ok(firstBounce, `expected a court bounce on ${surface}`)
    assert.equal(firstBounce.surface, surface)
    assert.equal(firstBounce.side, 'far', `200 km/h serve must cross net to far court on ${surface}`)
    assert.equal(firstBounce.inBounds, true, `serve should land in service box on ${surface}, pos=${firstBounce.pos}`)
    assert.ok(firstBounce.pos[2] > 0 && firstBounce.pos[2] <= ITF_COURT.serviceLineDist + BALL_RADIUS_CELLS)
    surfaceResults[surface] = { bounce: firstBounce, postBounceState, maxPostBounceY }
  }

  // Verify surface bounce physics order: clay bounces higher than grass (e_n 0.80 vs 0.68),
  // and grass keeps higher forward speed than clay (lower friction mu 0.45 vs 0.85).
  assert.ok(
    surfaceResults.clay.maxPostBounceY > surfaceResults.grass.maxPostBounceY + 1.0,
    `clay apex (${surfaceResults.clay.maxPostBounceY.toFixed(2)}) should exceed grass apex (${surfaceResults.grass.maxPostBounceY.toFixed(2)})`,
  )
  assert.ok(
    surfaceResults.grass.postBounceState.vel[2] > surfaceResults.clay.postBounceState.vel[2] + 5.0,
    `grass post-bounce vz (${surfaceResults.grass.postBounceState.vel[2].toFixed(1)}) should exceed clay (${surfaceResults.clay.postBounceState.vel[2].toFixed(1)})`,
  )

  // Brushing upward racket swing imparts heavy topspin, causing a measurable Magnus topspin dip.
  const wasmRally = await instantiateSports()
  const rallyCourt = new TennisCourtController(wasmRally, { surface: 'hard' })
  // Incoming flat ball heading toward near player along -Z at 18 m/s (-180 cells/s).
  rallyCourt.spawnBall([0, 10.0, -78.5], [0, 0, -180], [0, 0, 0], 'far', 'rally')
  // Near player brushes forward (+Z at 220 cells/s) and upward (+Y at 220 cells/s).
  const prevPose = racketPoseFromNormal([0, 9.2, -80.0], [0, 0, 1], [0, 1, 0])
  const currPose = racketPoseFromNormal(
    [0, 9.2 + 220 * TICK_DT, -80.0 + 220 * TICK_DT],
    [0, 0, 1],
    [0, 1, 0],
  )
  rallyCourt.swingRacket('near', prevPose, currPose)
  const hitEvents = rallyCourt.step(1)
  const racketHit = hitEvents.find((e) => e.type === 'racket')
  assert.ok(racketHit, 'expected brushed racket impact event')
  assert.equal(racketHit.side, 'near')

  const afterHit = rallyCourt.readBall()
  assert.ok(afterHit)
  assert.ok(afterHit.vel[2] > 200, `returned ball should travel along +Z, got vz=${afterHit.vel[2].toFixed(1)}`)
  // Traveling along +Z, topspin is positive X angular velocity so (w x v).y = -wx * vz < 0 (downward Magnus dip).
  assert.ok(afterHit.spin[0] > 180, `expected >180 rad/s topspin from upward brush, got ${afterHit.spin[0].toFixed(1)} rad/s`)

  // Measure topspin landing distance vs an identical flat shot (zero spin) to confirm Magnus dip.
  const measureLandingZ = async (pos, vel, spin) => {
    const w = await instantiateSports()
    const c = new TennisCourtController(w, { surface: 'hard' })
    c.spawnBall(pos, vel, spin, 'near', 'rally')
    for (let t = 0; t < 400; t++) {
      const evs = c.step(1)
      const b = evs.find((e) => e.type === 'bounce')
      if (b) return b.pos[2]
    }
    throw new Error('ball never bounced')
  }
  const topspinLandingZ = await measureLandingZ(afterHit.pos, afterHit.vel, afterHit.spin)
  const flatLandingZ = await measureLandingZ(afterHit.pos, afterHit.vel, [0, 0, 0])
  const magnusDipCells = flatLandingZ - topspinLandingZ
  assert.ok(
    magnusDipCells > 10.0,
    `topspin (${topspinLandingZ.toFixed(1)}) should dip significantly shorter than flat (${flatLandingZ.toFixed(1)})`,
  )

  // Verify full tennis scoring transitions: 0 -> 15 -> 30 -> 40 -> Deuce -> Ad Near -> Deuce -> Ad Far -> Game.
  const scoreCourt = new TennisCourtController(await instantiateSports(), { surface: 'hard' })
  assert.equal(scoreCourt.getScore().call, '0-0')
  scoreCourt.awardPoint('near')
  assert.equal(scoreCourt.getScore().call, '15-0')
  scoreCourt.awardPoint('near')
  assert.equal(scoreCourt.getScore().call, '30-0')
  scoreCourt.awardPoint('near')
  assert.equal(scoreCourt.getScore().call, '40-0')
  scoreCourt.awardPoint('far')
  assert.equal(scoreCourt.getScore().call, '40-15')
  scoreCourt.awardPoint('far')
  assert.equal(scoreCourt.getScore().call, '40-30')
  scoreCourt.awardPoint('far')
  assert.equal(scoreCourt.getScore().call, 'Deuce')
  assert.equal(scoreCourt.getScore().isDeuce, true)
  scoreCourt.awardPoint('near')
  assert.equal(scoreCourt.getScore().call, 'Ad Near')
  assert.equal(scoreCourt.getScore().advantage, 'near')
  scoreCourt.awardPoint('far')
  assert.equal(scoreCourt.getScore().call, 'Deuce')
  scoreCourt.awardPoint('far')
  assert.equal(scoreCourt.getScore().call, 'Ad Far')
  const gameEv = scoreCourt.awardPoint('far')
  assert.equal(gameEv.gameWon, true)
  assert.equal(gameEv.score.farGames, 1)
  assert.equal(gameEv.score.nearGames, 0)
  assert.equal(gameEv.score.server, 'far', 'server must alternate after a game')
  assert.equal(gameEv.score.call, '0-0')

  // Verify live double-bounce point award from a real serve left unreturned.
  const doubleBounceCourt = new TennisCourtController(await instantiateSports(), { surface: 'clay' })
  doubleBounceCourt.serve({ server: 'near', speedKmh: 165, spinRpm: 1200, targetDepth: 44 })
  let pointEvent = null
  for (let t = 0; t < 480 && !pointEvent; t++) {
    const evs = doubleBounceCourt.step(1)
    pointEvent = evs.find((e) => e.type === 'point') ?? null
  }
  assert.ok(pointEvent, 'unreturned serve should end in a point event')
  assert.equal(pointEvent.winner, 'near')
  assert.equal(pointEvent.reason, 'double-bounce')
  assert.equal(doubleBounceCourt.getScore().nearDisplay, '15')

  console.log(
    `[pass] Test 1: 200 km/h serve across hard/clay/grass, topspin=${afterHit.spin[0].toFixed(1)} rad/s, Magnus dip=${magnusDipCells.toFixed(1)} cells, full scoring verified`,
  )
  return { topspinRadS: afterHit.spin[0], magnusDipCells }
}

// ── Test 2: 100 ms RTT (12-tick) & 133 ms (16-tick) Client-Server Rollback ──

async function testRollbackConvergence() {
  // Helper running two independent core.wasm instances (authoritative server + rollback client)
  // across an arbitrary RTT delay in ticks (e.g. 4, 12, 16 ticks = 33, 100, 133 ms).
  async function runScenario(rttTicks, expectNativeWasm) {
    const serverWasm = await instantiateSports()
    const clientWasm = await instantiateSports()

    const initialPos = [0.0, 12.0, -25.0]
    const initialVel = [15.0, 35.0, 320.0]
    const initialSpin = [-220.0, 0.0, 0.0]

    serverWasm.reset()
    serverWasm.setCourt('clay', 0, 0, true)
    const serverBallId = serverWasm.spawn(initialPos, initialVel, initialSpin)

    const client = new DeterministicRollbackClient(clientWasm, {
      surface: 'clay',
      groundY: 0,
      netZ: 0,
      courtEnabled: true,
    })
    client.spawnBall(initialPos, initialVel, initialSpin, 0)

    // Mid-rally opponent perturbation on the server at tick 2 (unknown to client until RTT elapses).
    const opponentSwing = {
      prev: racketPoseFromNormal([0.0, 12.5, -19.0], [0.0, 0.1, -1.0], [0.0, 1.0, 0.0]),
      curr: racketPoseFromNormal([0.0, 13.0, -20.5], [0.0, 0.15, -1.0], [0.0, 1.0, 0.0]),
    }

    // Local client swing at tick 5 (buffered locally and sent to server with tick stamp).
    const localSwingTick = 5
    const localSwing = {
      prev: racketPoseFromNormal([0.4, 11.5, -34.0], [0.0, 0.05, 1.0], [0.0, 1.0, 0.0]),
      curr: racketPoseFromNormal([0.4, 12.4, -32.2], [0.0, 0.05, 1.0], [0.0, 1.0, 0.0]),
    }

    const totalTicks = 2 + rttTicks
    let serverSnapAtTick2 = null

    for (let tick = 1; tick <= totalTicks; tick++) {
      // Client predicts locally and stamps outgoing local swing.
      const pred = client.predictTick(tick === localSwingTick ? localSwing : null)
      assert.equal(pred.tick, tick)
      if (tick === localSwingTick) {
        assert.ok(pred.outgoingInput && pred.outgoingInput.tick === localSwingTick)
      }

      // Authoritative server applies opponent swing at tick 2 and client's stamped swing at tick 5.
      if (tick === 2) {
        serverWasm.racketSwing(opponentSwing.prev, opponentSwing.curr)
      } else if (tick === localSwingTick && pred.outgoingInput) {
        serverWasm.racketSwing(pred.outgoingInput.swing.prev, pred.outgoingInput.swing.curr)
      }
      const sTick = serverWasm.step(1, false)
      assert.equal(sTick, tick)

      if (tick === 2) {
        serverSnapAtTick2 = serverWasm.writeSnapshot(serverBallId)
        assert.ok(serverSnapAtTick2 && serverSnapAtTick2.byteLength === SNAPSHOT_BYTES)
      }
    }

    const serverNow = serverWasm.readBall(serverBallId)
    const clientBefore = client.readBall()
    assert.ok(serverNow && clientBefore)

    const prePosErr = dist3(clientBefore.pos, serverNow.pos)
    assert.ok(prePosErr > 20.0, `expected large pre-rollback divergence for RTT=${rttTicks}, got ${prePosErr.toFixed(2)}`)

    // Late 32-byte server snapshot from tick 2 arrives after `rttTicks` delay!
    const res = client.reconcile(serverSnapAtTick2)
    assert.equal(res.status, 'replayed')
    assert.equal(res.serverTick, 2)
    assert.equal(res.clientTick, totalTicks)
    assert.equal(res.replayedTicks, rttTicks)
    assert.equal(res.usedWasmRollback, expectNativeWasm)
    assert.ok(res.state)

    const clientAfter = res.state
    assert.ok(allFinite3(clientAfter.pos) && allFinite3(clientAfter.vel) && allFinite3(clientAfter.spin), 'zero NaN allowed')

    const posErr = dist3(clientAfter.pos, serverNow.pos)
    const velErr = dist3(clientAfter.vel, serverNow.vel)
    const spinErr = dist3(clientAfter.spin, serverNow.spin)

    assert.ok(posErr < 1e-2, `RTT=${rttTicks} posErr ${posErr} >= 1e-2 cells`)
    assert.ok(velErr < 1e-2, `RTT=${rttTicks} velErr ${velErr} >= 1e-2 cells/s`)
    assert.ok(spinErr < 1e-2, `RTT=${rttTicks} spinErr ${spinErr} >= 1e-2 rad/s`)

    // Confirm a subsequent matching snapshot does not trigger redundant replay.
    const latestSnap = serverWasm.writeSnapshot(serverBallId)
    assert.ok(latestSnap)
    const matchRes = client.reconcile(latestSnap)
    assert.equal(matchRes.status, 'matched')
    assert.equal(matchRes.replayedTicks, 0)

    return { rttTicks, prePosErr, posErr, velErr, spinErr }
  }

  const r4 = await runScenario(4, true)   // 33 ms RTT (native WASM rollback)
  const r12 = await runScenario(12, true) // 100 ms RTT (native WASM rollback)
  const r16 = await runScenario(16, false) // 133 ms RTT (extended deterministic history replay)

  console.log(
    `[pass] Test 2: Rollback convergence — 33ms(4t): pos=${r4.posErr.toExponential(2)} | 100ms(12t): pre=${r12.prePosErr.toFixed(1)} -> pos=${r12.posErr.toExponential(2)} vel=${r12.velErr.toExponential(2)} spin=${r12.spinErr.toExponential(2)} | 133ms(16t): pos=${r16.posErr.toExponential(2)}`,
  )
  return { r4, r12, r16 }
}

// ── Test 3: Modal Tennis Audio Foley Hook ───────────────────────────────────

async function testAudioFoleyHook() {
  // 3a. Verify direct callback parameters on sweet-spot hit, rim hit, bounces, and net impact.
  const recorded = { pops: [], bounces: [], nets: [] }
  const synthCalls = []
  const fakeVoice = {
    play(patch, opts) {
      synthCalls.push({ patch, opts })
      return true
    },
    hold() { return 1 },
    release() {},
    glide() {},
    place() {},
  }
  const realCombat = combatSound(fakeVoice, { jitter: false })
  const audioSink = {
    tennisPop(opts) {
      recorded.pops.push(opts)
      return realCombat.tennisPop(opts)
    },
    tennisBounce(opts) {
      recorded.bounces.push(opts)
      return realCombat.tennisBounce(opts)
    },
    tennisNet(opts) {
      recorded.nets.push(opts)
      return realCombat.tennisNet(opts)
    },
  }

  // Sweet-spot racket hit vs off-center rim hit.
  const wasmA = await instantiateSports()
  const court = new TennisCourtController(wasmA, { surface: 'hard', sound: audioSink })
  const events = []
  court.setEventListener((ev) => events.push(ev))

  // Sweet-spot strike (ball centered at [0, 10, -79.2], racket centered at [0, 10, -80]).
  court.spawnBall([0, 10.0, -79.2], [0, 0, -200], [0, 0, 0], 'far', 'rally')
  court.swingRacket(
    'near',
    racketPoseFromNormal([0, 10.0, -80.0], [0, 0, 1]),
    racketPoseFromNormal([0, 10.0, -79.4], [0, 0, 1]),
  )
  court.step(1)

  // Rim strike (ball shifted 1.15 cells off racket center along local Y -> semi_b = 1.25 -> offset ~0.92).
  court.spawnBall([0, 11.15, -79.2], [0, 0, -200], [0, 0, 0], 'far', 'rally')
  court.swingRacket(
    'near',
    racketPoseFromNormal([0, 10.0, -80.0], [0, 0, 1]),
    racketPoseFromNormal([0, 10.0, -79.4], [0, 0, 1]),
  )
  court.step(1)

  const racketEvents = events.filter((e) => e.type === 'racket')
  assert.equal(racketEvents.length, 2, 'expected both sweet-spot and rim racket events')
  const [centerEv, rimEv] = racketEvents
  assert.ok(centerEv.sweetSpotOffset < 0.25, `center hit offset should be small, got ${centerEv.sweetSpotOffset}`)
  assert.ok(rimEv.sweetSpotOffset > 0.7, `rim hit offset should be near 1, got ${rimEv.sweetSpotOffset}`)
  assert.ok(centerEv.sweetSpot > rimEv.sweetSpot + 0.5, 'sweetSpot quality must decrease toward the rim')

  assert.equal(recorded.pops.length, 2)
  for (const p of recorded.pops) {
    assert.ok(p.velocity >= 0.08 && p.velocity <= 1, `invalid tennisPop velocity: ${p.velocity}`)
    assert.ok(p.sweetSpot >= 0 && p.sweetSpot <= 1, `invalid sweetSpot: ${p.sweetSpot}`)
    assert.ok(Array.isArray(p.at) && allFinite3(p.at))
  }
  // Confirm combatSound actually fired tennisPop for center and tennisFrame for rim!
  assert.ok(synthCalls.some((c) => c.patch === COMBAT_PATCHES.tennisPop))
  assert.ok(synthCalls.some((c) => c.patch === COMBAT_PATCHES.tennisFrame))

  // Court bounces across hard, clay, and grass.
  for (const surface of ['hard', 'clay', 'grass']) {
    court.setSurface(surface)
    court.spawnBall([0, 3.0, 20.0], [0, -90, 50], [0, 0, 0], 'near', 'rally')
    for (let t = 0; t < 20; t++) {
      const evs = court.step(1)
      if (evs.some((e) => e.type === 'bounce')) break
    }
  }
  assert.equal(recorded.bounces.length, 3, 'expected 1 bounce per surface preset')
  assert.deepEqual(
    recorded.bounces.map((b) => b.surface),
    ['hard', 'clay', 'grass'],
  )
  for (const b of recorded.bounces) {
    assert.ok(b.velocity >= 0.08 && b.velocity <= 1, `invalid bounce velocity: ${b.velocity}`)
    assert.ok(Array.isArray(b.at) && allFinite3(b.at))
  }
  assert.ok(synthCalls.some((c) => c.patch === COMBAT_PATCHES.tennisBounce))

  // Net mesh impact triggers tennisNet foley.
  court.setSurface('hard')
  court.spawnBall([0, 4.0, -4.0], [0, 0, kmhToCellsPerSec(150)], [0, 0, 0], 'near', 'rally')
  for (let t = 0; t < 12; t++) {
    const evs = court.step(1)
    if (evs.some((e) => e.type === 'net')) break
  }
  assert.ok(recorded.nets.length >= 1, 'expected net impact foley callback')
  assert.ok(recorded.nets[0].velocity >= 0.08 && recorded.nets[0].velocity <= 1)
  assert.ok(synthCalls.some((c) => c.patch === COMBAT_PATCHES.tennisNet))

  console.log(
    `[pass] Test 3: Audio foley verified — pops=${recorded.pops.length} (centerOffset=${centerEv.sweetSpotOffset.toFixed(2)}, rimOffset=${rimEv.sweetSpotOffset.toFixed(2)}), bounces=${recorded.bounces.length} (hard/clay/grass), nets=${recorded.nets.length}`,
  )
}

// ── Run All Checks ──────────────────────────────────────────────────────────

await testWireSnapshotParity()
await testServeRallyAndScoring()
await testRollbackConvergence()
await testAudioFoleyHook()
console.log('ALL SPORTS ROLLBACK & TENNIS CHECKS PASSED')
