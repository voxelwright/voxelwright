// Unified SF Street Life, District-Clocked Daily Routines, Three-Ring AI LOD & World Resident Promotion (#164).
// Proves:
//   1. Bit-for-bit deterministic pedestrian state across independent WalkGraph instances (even in reversed square load order)
//      and zero red-light crossings across hundreds of timestamps.
//   2. District-clocked daily routines across morning commute, workday, evening commute, nightlife, late quiet, and rain shelter.
//   3. Three-Ring AI LOD classification, ring budget caps, seamless Ring 3 -> Ring 2 -> Ring 1 materialization, and `taken` suppression.
//   4. Live SF World Process (`world.mjs` under `serve.mjs --release`): `world.residents` populated, zero-teleport `take()`,
//      `/world/stream` `was` broadcast for page duplicate suppression, smooth `release()`/`goingBack()`, and default `talk.rule.js`
//      conversing with an SF pedestrian.
//
//   node engine/test/sf-residents.mjs [--release <sf-release-dir>]
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARCHETYPES,
  RING1_RADIUS,
  RING2_RADIUS,
  RING3_RADIUS,
  classifyLod,
  createWalkGraph,
  lightFor,
  schedulePhase,
} from '../sf-walks.mjs'
import { voice } from '../mind/voice.mjs'
import { arg, here, serve } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (what, ask, ms = 12_000) => {
  for (const began = Date.now(); Date.now() - began < ms; await wait(120)) {
    const v = await ask()
    if (v) return v
  }
  throw new Error(`never: ${what}`)
}

// ── 1. Shared Deterministic Evaluator (Order-Independent Server vs Page) ─────
console.log('1. Deterministic SF evaluator & signal compliance')
const pilotDir = join(here, 'sf', 'pilot-life')
const pilotIndex = JSON.parse(readFileSync(join(pilotDir, 'index.json'), 'utf8'))
const squareNames = Object.keys(pilotIndex.life).sort()
const squareData = new Map(squareNames.map((name) => [name, JSON.parse(readFileSync(join(pilotDir, pilotIndex.life[name].path), 'utf8'))]))

const serverGraph = createWalkGraph()
const pageGraph = createWalkGraph()
for (const name of squareNames) serverGraph.addSquare(name, squareData.get(name))
for (const name of [...squareNames].reverse()) pageGraph.addSquare(name, squareData.get(name))

check(
  serverGraph.walkCount > 5000 && serverGraph.walkCount === pageGraph.walkCount && serverGraph.residentCount === pageGraph.residentCount,
  `both graphs loaded ${serverGraph.squareCount} squares (${serverGraph.walkCount} walks, ${serverGraph.residentCount} residents) identically in forward vs reverse order`,
)

const COLUMBUS = [522628, 664243]
const POWELL = [519580, 668046]
const RUSSIAN_HILL = [515700, 663500]

let bitMismatch = 0
let compared = 0
for (const [eye, t, hour, rain] of [
  [COLUMBUS, 1000.25, 8.2, 0],
  [COLUMBUS, 1234.5, 13.0, 0],
  [POWELL, 5678.9, 22.5, 0],
  [COLUMBUS, 9012.3, 12.0, 0.8],
]) {
  const a = serverGraph.query(eye, { reach: 1400, t, hour, rain })
  const b = pageGraph.query(eye, { reach: 1400, t, hour, rain })
  if (a.people.length !== b.people.length) { bitMismatch++; continue }
  for (let i = 0; i < a.people.length; i++) {
    const p = a.people[i], q = b.people[i]
    compared++
    const exact =
      p.seed === q.seed &&
      p.id === q.id &&
      p.x === q.x &&
      p.z === q.z &&
      p.yaw === q.yaw &&
      p.speed === q.speed &&
      p.stride === q.stride &&
      p.phase === q.phase &&
      p.archetype === q.archetype &&
      p.activity === q.activity &&
      p.lod === q.lod &&
      p.home[0] === q.home[0] &&
      p.home[1] === q.home[1] &&
      p.home[2] === q.home[2]
    if (!exact) bitMismatch++
  }
}
check(compared > 200 && bitMismatch === 0, `bit-for-bit identical server vs page evaluation across ${compared} pedestrians (${bitMismatch} mismatches)`)

// Zero red-light crossings across 240 frozen timestamps at Columbus & Broadway.
let litObserved = 0, redObserved = 0
for (let k = 0; k < 240; k++) {
  const t = 2000 + k * 0.77
  const res = serverGraph.query(COLUMBUS, { reach: 1400, t, hour: 12.5, rain: 0, applyCaps: false })
  for (const p of res.people) {
    if (!p.sig) continue
    litObserved++
    if (lightFor(serverGraph.junctionOf(p.sig), p.cdx, p.cdz, t) === 'red') redObserved++
  }
}
check(litObserved > 20 && redObserved === 0, `signal compliance: ${litObserved} lit crossings checked, ${redObserved} at red`)

// ── 2. District-Clocked Daily Routines & Weather Shelter ─────────────────────
console.log('2. District-clocked daily routines & weather shelter')
check(
  schedulePhase(8) === 'morning_commute' &&
  schedulePhase(13) === 'work_day' &&
  schedulePhase(18.5) === 'evening_commute' &&
  schedulePhase(22.5) === 'nightlife' &&
  schedulePhase(3) === 'late_quiet',
  'schedulePhase maps morning commute, work day, evening commute, nightlife, and late quiet',
)

const morning = serverGraph.query(COLUMBUS, { reach: 1400, t: 3600, hour: 8.0, rain: 0, applyCaps: false })
const midday = serverGraph.query(COLUMBUS, { reach: 1400, t: 3600, hour: 13.0, rain: 0, applyCaps: false })
const nightlife = serverGraph.query(COLUMBUS, { reach: 1400, t: 3600, hour: 22.5, rain: 0, applyCaps: false })
const lateQuiet = serverGraph.query(COLUMBUS, { reach: 1400, t: 3600, hour: 3.5, rain: 0, applyCaps: false })
const rainy = serverGraph.query(COLUMBUS, { reach: 1400, t: 3600, hour: 13.0, rain: 0.85, applyCaps: false })
const hillMidday = serverGraph.query(RUSSIAN_HILL, { reach: 1400, t: 3600, hour: 13.0, rain: 0, applyCaps: false })

const seenArchetypes = new Set(midday.people.map((p) => p.archetype))
check(ARCHETYPES.every((a) => seenArchetypes.has(a)), `all 6 resident archetypes appear on SF streets (${[...seenArchetypes].join(', ')})`)
check(
  morning.people.some((p) => p.activity === 'commuting_to_work') &&
  midday.people.some((p) => p.activity === 'tending_storefront' || p.activity === 'sightseeing' || p.activity === 'browsing_storefront') &&
  nightlife.people.some((p) => p.activity === 'nightlife_crawl'),
  'distinct daily activities fire in morning commute, midday, and nightlife',
)
const rainyShelterCount = rainy.people.filter((p) => p.shelter && (p.activity === 'seeking_shelter' || p.activity === 'sheltering' || p.activity === 'waiting_for_signal')).length
const rainyUmbrellas = rainy.people.filter((p) => p.umbrella).length
const dryNonRunnerAvg = midday.people.filter((p) => p.archetype !== 'runner').reduce((s, p) => s + p.speed, 0) / Math.max(1, midday.people.filter((p) => p.archetype !== 'runner').length)
const wetNonRunnerAvg = rainy.people.filter((p) => p.archetype !== 'runner').reduce((s, p) => s + p.speed, 0) / Math.max(1, rainy.people.filter((p) => p.archetype !== 'runner').length)
check(
  rainyShelterCount > rainy.people.length * 0.8 && rainyUmbrellas > rainy.people.length * 0.4 && wetNonRunnerAvg > dryNonRunnerAvg * 1.1,
  `rain shelter shift active (${rainyShelterCount}/${rainy.people.length} sheltering, ${rainyUmbrellas} umbrellas, speed ${dryNonRunnerAvg.toFixed(1)} -> ${wetNonRunnerAvg.toFixed(1)} cells/s)`,
)
check(
  midday.people.length > lateQuiet.people.length * 2 && midday.people.length > hillMidday.people.length,
  `crowd density tracks hour & district (midday Columbus ${midday.people.length} > late night ${lateQuiet.people.length}, and > Russian Hill ${hillMidday.people.length})`,
)

// Persistent origin -> destination trips survive camera movement / frustum exit cleanly.
const sampleP = midday.people.find((p) => p.walking > 0.5 && Math.hypot(p.destX - p.originX, p.destZ - p.originZ) > 150)
const sampleLater = sampleP ? serverGraph.whereabouts(sampleP.seed, sampleP.home, 3601.0, 13.0, 0) : null
const moved1s = sampleP && sampleLater ? Math.hypot(sampleLater.x - sampleP.x, sampleLater.z - sampleP.z) : Infinity
check(
  !!sampleP && !!sampleLater && sampleLater.round === sampleP.round && sampleLater.destX === sampleP.destX && sampleLater.destZ === sampleP.destZ && moved1s > 2 && moved1s <= sampleP.speed * 1.5 + 3,
  `origin -> destination trip persists cleanly across clock ticks (trip ${sampleP ? Math.round(Math.hypot(sampleP.destX - sampleP.originX, sampleP.destZ - sampleP.originZ) / 10) : 0} m, 1s step ${moved1s.toFixed(1)} cells)`,
)

// ── 3. Three-Ring Multi-Tier AI LOD & Taken Suppression ──────────────────────
console.log('3. Three-Ring AI LOD & taken suppression')
check(
  classifyLod(0) === 1 && classifyLod(RING1_RADIUS) === 1 &&
  classifyLod(RING1_RADIUS + 1) === 2 && classifyLod(RING2_RADIUS) === 2 &&
  classifyLod(RING2_RADIUS + 1) === 3 && classifyLod(RING3_RADIUS) === 3 &&
  classifyLod(RING3_RADIUS + 1) === 0,
  `classifyLod boundaries verified (R1 <= ${RING1_RADIUS}, R2 <= ${RING2_RADIUS}, R3 <= ${RING3_RADIUS})`,
)

const fullLod = serverGraph.query(COLUMBUS, { reach: RING3_RADIUS, t: 4200, hour: 13.0, rain: 0 })
check(
  fullLod.stats.ring1 > 0 && fullLod.stats.ring2 > 0 && fullLod.stats.ring3 > 0 &&
  fullLod.stats.ring1 <= fullLod.stats.caps[1] && fullLod.stats.ring2 <= fullLod.stats.caps[2] && fullLod.stats.ring3 <= fullLod.stats.caps[3],
  `all three LOD rings populated within caps (R1=${fullLod.stats.ring1}/${fullLod.stats.caps[1]}, R2=${fullLod.stats.ring2}/${fullLod.stats.caps[2]}, R3=${fullLod.stats.ring3}/${fullLod.stats.caps[3]})`,
)

const tightLod = serverGraph.query(COLUMBUS, { reach: RING3_RADIUS, t: 4200, hour: 13.0, rain: 0, caps: { 1: 4, 2: 8, 3: 12 } })
check(
  tightLod.stats.ring1 <= 4 && tightLod.stats.ring2 <= 8 && tightLod.stats.ring3 <= 12 && tightLod.stats.capped > 0,
  `custom ring caps enforced cleanly (R1=${tightLod.stats.ring1}, R2=${tightLod.stats.ring2}, R3=${tightLod.stats.ring3}, capped=${tightLod.stats.capped})`,
)

// Seamless Ring 3 -> Ring 2 -> Ring 1 transition with zero position/yaw jump.
const macroPed = fullLod.people.find((p) => p.lod === 3)
let transitionDelta = Infinity, yawDelta = Infinity, ringSeq = []
if (macroPed) {
  ringSeq.push(macroPed.lod)
  const r2Eye = [macroPed.x + 700, macroPed.z]
  const r1Eye = [macroPed.x + 150, macroPed.z]
  const inR2 = serverGraph.query(r2Eye, { reach: RING3_RADIUS, t: 4200, hour: 13.0, rain: 0, applyCaps: false }).people.find((p) => p.seed === macroPed.seed)
  const inR1 = serverGraph.query(r1Eye, { reach: RING3_RADIUS, t: 4200, hour: 13.0, rain: 0, applyCaps: false }).people.find((p) => p.seed === macroPed.seed)
  if (inR2 && inR1) {
    ringSeq.push(inR2.lod, inR1.lod)
    transitionDelta = Math.max(Math.hypot(inR2.x - macroPed.x, inR2.z - macroPed.z), Math.hypot(inR1.x - macroPed.x, inR1.z - macroPed.z))
    yawDelta = Math.max(Math.abs(inR2.yaw - macroPed.yaw), Math.abs(inR1.yaw - macroPed.yaw))
  }
}
check(
  ringSeq.join('->') === '3->2->1' && transitionDelta === 0 && yawDelta === 0,
  `seamless Ring 3 -> Ring 2 -> Ring 1 materialization (${ringSeq.join('->')}, pos delta ${transitionDelta}, yaw delta ${yawDelta})`,
)

// `taken` suppression removes promoted actor from street crowd.
const suppressTarget = fullLod.people.find((p) => p.lod === 1)
const takenSet = new Set(suppressTarget ? [suppressTarget.seed] : [])
const afterSuppress = serverGraph.query(COLUMBUS, { reach: RING3_RADIUS, t: 4200, hour: 13.0, rain: 0, taken: takenSet })
check(
  !!suppressTarget && !afterSuppress.people.some((p) => p.seed === suppressTarget.seed) && afterSuppress.stats.suppressedTaken === 1,
  `taken suppression hides promoted seed ${suppressTarget?.seed} cleanly (suppressedTaken=${afterSuppress.stats.suppressedTaken})`,
)

// ── 4. Authoritative SF World Process (`world.mjs` + `take`/`release` + `talk.rule.js`) ──
console.log('4. Live SF world process: residents, zero-teleport take/release, and talk.rule.js')
const defaultStaged = join(homedir(), '.village', 'engine', 'bay', '450-city-paint', 'sf')
const releaseDir = arg('release', '') ? resolve(here, arg('release', '')) : (existsSync(join(defaultStaged, 'current.json')) ? defaultStaged : '')

if (!releaseDir) {
  console.log('  skip live --release check: no staged SF release directory found')
} else {
  const scratch = mkdtempSync(join(tmpdir(), 'engine-sf-residents-'))
  const worldFile = join(scratch, 'world.log')
  const cacheDir = join(scratch, 'cache')
  const server = await serve('/dev/null', ['--world', worldFile, '--release', releaseDir, '--release-cache', cacheDir, '--ground-wait', '15000'])
  const send = async (path, init) => {
    for (;;) {
      const r = await fetch(`${server.url}/world/${path}`, init)
      if (r.status === 429) { await wait(300); continue }
      return r.ok ? r.json() : { refused: r.status, why: await r.text() }
    }
  }
  const get = (path) => send(path)
  const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
  const how = async (id) => (await get('rules')).find((r) => r.id === id)
  const around = (by = 'wren') => get(`around?by=${by}&within=400`)

  // Listen to /world/stream binary frames to verify `here` broadcasts include `was` (for page takenOff suppression).
  const streamCtrl = new AbortController()
  const streamHeres = []
  const streamDone = (async () => {
    try {
      const r = await fetch(`${server.url}/world/stream`, { signal: streamCtrl.signal })
      let buf = Buffer.alloc(0)
      for await (const chunk of r.body) {
        buf = Buffer.concat([buf, Buffer.from(chunk)])
        while (buf.length >= 12) {
          const kind = buf.readUInt32LE(0)
          const len = buf.readUInt32LE(8)
          if (buf.length < 12 + len) break
          const payload = buf.subarray(12, 12 + len)
          buf = buf.subarray(12 + len)
          if (kind === 5) { // HERE frame
            try { streamHeres.push(JSON.parse(payload.toString('utf8'))) } catch {}
          }
        }
      }
    } catch {}
  })()

  let helperVoice = null
  try {
    // Join on Columbus & Broadway where SF pavements and pedestrians are dense.
    const joined = await post('join', { by: 'wren', at: COLUMBUS })
    check(!joined.error && joined.you?.at?.length === 3, `seat joined SF world at Columbus & Broadway (${joined.you?.at})`)

    const ar0 = await until('SF residents appear around seat', async () => {
      const a = await around()
      return a.residents?.near > 0 ? a : null
    }, 10_000)
    const sampleRes = ar0.residents.nearest[0]
    check(
      ar0.residents.near > 0 && typeof sampleRes?.archetype === 'string' && typeof sampleRes?.activity === 'string' && sampleRes?.lod >= 1,
      `/world/around reports ${ar0.residents.near} SF residents with routine metadata (${sampleRes?.archetype}, ${sampleRes?.activity}, ring ${sampleRes?.lod})`,
    )

    // Rule that inspects world.residents, takes nearest SF pedestrian, reports exact coords + seed, and releases on "thank you".
    const SF_PASSER = `
on('said', (world, e) => {
  const mine = world.people.filter((p) => p.mine)
  if (/excuse me/i.test(e.text)) {
    const r = world.residents.slice().sort((a, b) => Math.hypot(a.at[0] - e.at[0], a.at[2] - e.at[2]) - Math.hypot(b.at[0] - e.at[0], b.at[2] - e.at[2]))[0]
    if (!r) return
    world.keep.takenId = r.id
    world.keep.takenSeed = r.seed
    world.keep.takenHome = r.home
    world.keep.beforeAt = r.at
    world.actor('sf-local', {
      take: r.id,
      name: 'SF Local',
      face: e.at,
      say: 'TAKEN ' + JSON.stringify({ id: r.id, seed: r.seed, at: r.at, archetype: r.archetype, activity: r.activity, lod: r.lod, home: r.home }),
    })
  }
  if (/where are you/i.test(e.text) && mine[0]) {
    world.actor(mine[0].id, { say: 'ACTOR_AT ' + JSON.stringify({ at: mine[0].at, was: mine[0].was }) })
  }
  if (/thank you/i.test(e.text)) {
    for (const p of mine) world.gone(p.id)
  }
})`
    await post('ask', { by: 'tester', rule: { id: 'sf-passer', name: 'SF passer test', source: SF_PASSER } })
    await until('sf-passer running', async () => (await how('sf-passer'))?.running, 8000)

    await post('say', { by: 'wren', text: 'Excuse me!' })
    const takenLine = await until('SF resident taken', async () => (await around()).heard.find((h) => h.text.startsWith('TAKEN ')), 8000)
    const takenInfo = JSON.parse(takenLine.text.slice(6))
    const promoted = (await around()).people.find((p) => p.name === 'SF Local')
    const jumpDist = promoted ? Math.hypot(promoted.at[0] - takenInfo.at[0], promoted.at[2] - takenInfo.at[2]) : Infinity
    check(
      !!promoted && Number.isInteger(takenInfo.seed) && Array.isArray(takenInfo.home) && takenInfo.home.length === 3 && jumpDist < 12,
      `zero-teleport SF take(): promoted ${takenInfo.id} (${takenInfo.archetype}/${takenInfo.activity}, ring ${takenInfo.lod}) at ${promoted?.at} vs ${takenInfo.at} (delta ${jumpDist.toFixed(1)} cells)`,
    )

    // Verify /world/stream broadcast carried `was: seed` so browser pages suppress the analytic duplicate in street.ts.
    const broadcast = await until('stream broadcast with was', () => streamHeres.find((h) => h.by === 'sf-passer/sf-local' && h.was === takenInfo.seed), 5000)
    check(broadcast?.was === takenInfo.seed, `/world/stream broadcast carries was=${broadcast?.was} so connected pages suppress duplicate pedestrian`)

    // Release and confirm smooth goingBack() return to the street crowd (ends with `gone: true` broadcast).
    await post('say', { by: 'wren', text: 'Thank you!' })
    await until('sf-passer actor released', async () => (await how('sf-passer'))?.actors === 0, 8000)
    const goneBroadcast = await until('released SF actor finishes goingBack()', () => streamHeres.find((h) => h.by === 'sf-passer/sf-local' && h.gone === true), 50_000)
    check(!!goneBroadcast, 'released SF resident walked back cleanly and returned to street crowd')

    // Remove custom rule and verify default engine `talk.rule.js` can address and converse with an SF pedestrian!
    await post('ask', { by: 'tester', unrule: 'sf-passer' })
    await until('sf-passer removed', async () => !(await how('sf-passer')), 5000)

    const model = async () => ({ text: 'SAY: Fog is rolling in off the bay today.\n===\n' })
    helperVoice = voice({ world: server.url, model })
    await until('default engine talk rule active', async () => {
      const all = await get('rules?given=1')
      return Array.isArray(all) && all.find((r) => r.id === 'talk' && r.running)
    }, 10_000)

    // Walk wren right beside the nearest active SF pedestrian so talk.rule.js's 9 m earshot (NEAR = 90 cells) catches them immediately.
    const nearestNow = serverGraph.query(COLUMBUS, { reach: 400, t: Date.now() / 1000, hour: 11, rain: 0 }).people[0]
    if (nearestNow) {
      await post('leave', { by: 'wren' })
      await post('join', { by: 'wren', at: [Math.round(nearestNow.x), Math.round(nearestNow.z)] })
    }
    const talked = await until('talk.rule.js answers as an SF pedestrian', async () => {
      await post('say', { by: 'wren', text: 'Lovely afternoon in San Francisco!' })
      await wait(1200)
      const a = await around()
      return a.heard.find((h) => h.text === 'Fog is rolling in off the bay today.')
    }, 20_000)
    const talkState = (await get('rules?given=1')).find((r) => r.id === 'talk')
    check(!!talked && talkState?.actors >= 1, `default engine talk.rule.js promoted & answered as SF pedestrian ${talked?.name} ("${talked?.text}")`)
  } catch (e) {
    failures.push(String(e?.stack ?? e))
  } finally {
    await helperVoice?.close().catch(() => {})
    streamCtrl.abort()
    await streamDone
    server.stop()
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\nsf-residents: ok')
process.exit(0)
