// Live server + world.mjs Living-City AI end-to-end test (#164):
//   1. Player-made things with `affordances` (top-level and `behaviour.affordances`) register live Smart Object
//      slots visible via `GET /world/city` and `world.city`, and survive restart.
//   2. Non-omniscient blast stimulus: witness blocked by a solid concrete wall leaves `heat === 0` and 0 witnesses;
//      witness with clear voxel LOS enters spotting/reporting and escalates descriptor Heat + BOLO + dispatch units.
//   3. `POST /world/social`: 0 ms Greet/Antagonize barks, trust/mood changes, `escalateToMind`, witness interception,
//      and strict security validation (Origin, body size, allowlist, actorId).
//   4. Sandboxed rule reading `world.city` (`heat`, `smartObjects`, `mood`, `directorBrief`) and calling bounded
//      `world.stimulus(...)`, `world.social(...)`, `world.smartObject(...)` — with invalid wants refused via `refused`
//      and rule Smart Objects cleaned up on `unrule`.
//
//   node engine/test/world-living-city.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from './kit.mjs'

const dir = mkdtempSync(join(tmpdir(), 'engine-world-living-city-'))
const file = join(dir, 'world.log')
const failures = []
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

let server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => {
  for (;;) {
    const r = await fetch(`${server.url}/world/${path}`, init)
    if (r.status === 429) { await wait(350); continue }
    const txt = await r.text()
    let json = null
    try { json = JSON.parse(txt) } catch { /* plain text */ }
    return { status: r.status, ok: r.ok, json, text: txt }
  }
}
const get = (path) => send(path)
const post = (path, body, headers = {}) => send(path, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
const until = async (what, ask, ms = 12_000) => {
  for (const began = Date.now(); Date.now() - began < ms; await wait(120)) {
    const v = await ask()
    if (v) return v
  }
  throw new Error(`never: ${what}`)
}

try {
  // ── 1. Made things with affordances -> live Smart Objects in GET /world/city ──
  console.log('1. Made things with affordances -> live Smart Objects')
  const gBench = (await get('at?x=700&y=154&z=4050')).json.ground
  const yBench = gBench + 1

  const benchRes = await post('ask', {
    by: 'maker',
    wait: true,
    edit: [1, 1, 696, 704, yBench, 4050, 10],
    release: [700, yBench + 2, 4050],
    thing: {
      id: 'park-bench-1',
      name: 'Park Bench',
      wish: 'a wooden park bench',
      at: [700, yBench, 4050],
      size: [18, 9, 6],
      facing: 'south',
      affordances: [
        { kind: 'sit', pos: [5, 4, 2], yaw: 0, tags: ['seating'] },
        { kind: 'sit', pos: [13, 4, 2], yaw: 0, tags: ['seating'] },
      ],
    },
  })
  check(benchRes.ok && benchRes.json?.laid === true, 'placed made Park Bench with top-level affordances')

  const gCart = (await get('at?x=714&y=154&z=4050')).json.ground
  const yCart = gCart + 1
  const cartRes = await post('ask', {
    by: 'maker',
    wait: true,
    edit: [1, 1, 712, 717, yCart, 4050, 10],
    release: [714, yCart + 2, 4050],
    thing: {
      id: 'coffee-cart-1',
      name: 'Coffee Cart',
      wish: 'a sidewalk coffee cart',
      at: [714, yCart, 4050],
      size: [12, 14, 8],
      facing: 'south',
      behaviour: {
        affordances: [{ kind: 'browse', pos: [6, 0, 4], yaw: 0, tags: ['vendor'] }],
      },
    },
  })
  check(cartRes.ok && cartRes.json?.laid === true, 'placed made Coffee Cart with behaviour.affordances')

  const city1 = (await get('city')).json
  const benchObj = city1?.smartObjects?.find((o) => o.id === 'park-bench-1')
  const cartObj = city1?.smartObjects?.find((o) => o.id === 'coffee-cart-1')
  check(
    Boolean(benchObj) && benchObj.slotCount === 2 && benchObj.kinds.includes('sit'),
    `GET /world/city lists Park Bench Smart Object (${benchObj?.slotCount ?? 0} sit slots)`,
  )
  check(
    Boolean(cartObj) && cartObj.slotCount === 1 && cartObj.kinds.includes('browse') && city1.slots >= 3,
    `GET /world/city lists Coffee Cart Smart Object (${cartObj?.slotCount ?? 0} browse slot, total slots=${city1?.slots})`,
  )
  check(
    typeof city1?.directorBrief === 'string' && city1.directorBrief.includes('Park Bench'),
    'GET /world/city directorBrief includes player-made Park Bench affordance',
  )

  // ── 2. Non-omniscient blast witness & descriptor heat ───────────────────────
  console.log('2. Non-omniscient blast witness (blocked wall vs clear LOS)')
  const gStreet = (await get('at?x=700&y=154&z=4065')).json.ground
  const yStreet = gStreet + 1
  await post('join', { by: 'bomber', at: [700, 4065] })

  // Build an opaque concrete wall at z = 4030..4031, x = 685..716, y = yStreet..yStreet+30
  // between the hidden witness (z = 4015) and the blast (z = 4065).
  const wallRows = []
  for (let wy = yStreet; wy <= yStreet + 30; wy++) {
    wallRows.push(685, 716, wy, 4030, 7)
    wallRows.push(685, 716, wy, 4031, 7)
  }
  const wallRes = await post('ask', {
    by: 'builder',
    wait: true,
    edit: [1, wallRows.length / 5, ...wallRows],
    release: [700, yStreet + 32, 4030],
  })
  check(wallRes.ok && wallRes.json?.laid === true, 'built solid concrete sight-blocking wall between z=4015 and z=4065')

  await post('ask', {
    by: 'tester',
    rule: {
      id: 'watch-blocked',
      name: 'Blocked witness',
      source: `on('start', (world) => { world.actor('hidden', { name: 'Hidden', at: [700, 4015], face: [700, 4065] }) })`,
    },
  })
  await until('hidden actor spawns', async () => (await get('around?by=bomber&within=1200')).json?.people?.some((p) => p.name === 'Hidden'))

  const blockedBlast = await post('ask', { by: 'bomber', blast: [700, yStreet + 6, 4065], radius: 4, wait: true })
  check(blockedBlast.ok, 'triggered blast behind solid concrete wall')
  await wait(800)
  const cityBlocked = (await get('city')).json
  check(
    cityBlocked.witnesses.length === 0 && cityBlocked.heat === 0,
    `zero omniscience: hidden witness behind concrete wall creates 0 witnesses and heat 0 (witnesses=${cityBlocked.witnesses.length}, heat=${cityBlocked.heat})`,
  )

  // Now spawn an unobstructed witness on the same side of the wall facing the blast site.
  await post('ask', {
    by: 'tester',
    rule: {
      id: 'watch-open',
      name: 'Open witness',
      source: `on('start', (world) => { world.actor('spotter', { name: 'Spotter', at: [700, 4045], face: [700, 4065] }) })`,
    },
  })
  await until('spotter actor spawns', async () => (await get('around?by=bomber&within=1200')).json?.people?.some((p) => p.name === 'Spotter'))

  const openBlast = await post('ask', { by: 'bomber', blast: [700, yStreet + 6, 4065], radius: 4, wait: true })
  check(openBlast.ok, 'triggered blast in clear LOS of Spotter')

  const sawWitness = await until(
    'active witness appears in GET /world/city',
    async () => {
      const c = (await get('city')).json
      return c.witnesses.find((w) => w.witnessId === 'watch-open/spotter') ? c : null
    },
    4000,
  )
  check(
    sawWitness.witnesses.some((w) => w.witnessId === 'watch-open/spotter' && w.kind === 'blast'),
    `open-LOS witness spotted blast (${sawWitness.witnesses[0]?.state} via ${sawWitness.witnesses[0]?.method})`,
  )

  // Wait for witness report countdown (~5.5–8.5 s) to file descriptor BOLO & elevate heat.
  const heatedCity = await until(
    'descriptor heat escalates after witness completes report',
    async () => {
      const c = (await get('city')).json
      return c.heat > 0 && c.bolos.length > 0 ? c : null
    },
    13_000,
  )
  check(
    heatedCity.heat >= 4 && heatedCity.bolos.length >= 1 && heatedCity.units.length >= 1 && /Heat: [1-5]\/5/.test(heatedCity.directorBrief),
    `witness report escalated descriptor heat=${heatedCity.heat}, bolos=${heatedCity.bolos.length}, units=${heatedCity.units.length}`,
  )

  // ── 3. POST /world/social: 0 ms barks, witness interception & security ──────
  console.log('3. POST /world/social (0 ms barks, witness interception, security bounds)')
  const badOrigin = await post('social', { by: 'bomber', actorId: 'watch-open/spotter', action: 'greet' }, { Origin: 'http://elsewhere.example' })
  check(badOrigin.status === 403, `POST /world/social blocks cross-origin request (${badOrigin.status})`)

  const badSize = await post('social', JSON.stringify({ by: 'bomber', actorId: 'watch-open/spotter', action: 'greet', pad: 'x'.repeat(2500) }))
  check(badSize.status === 413, `POST /world/social enforces 2048-byte body limit (${badSize.status})`)

  const badAction = await post('social', { by: 'bomber', actorId: 'watch-open/spotter', action: 'hack_city' })
  check(badAction.status === 400, `POST /world/social enforces action allowlist (${badAction.status})`)

  const badActor = await post('social', { by: 'bomber', actorId: '__proto__', action: 'greet' })
  check(badActor.status === 400, `POST /world/social rejects forbidden actorId (${badActor.status})`)

  const missingActor = await post('social', { by: 'bomber', actorId: 'nobody-here', action: 'greet' })
  check(missingActor.status === 404, `POST /world/social returns 404 for unknown actor (${missingActor.status})`)

  const greetRes = await post('social', { by: 'citizen', actorId: 'watch-open/spotter', action: 'greet' })
  check(
    greetRes.ok && greetRes.json?.bark?.ms === 0 && typeof greetRes.json?.bark?.text === 'string' && greetRes.json.bark.text.length > 0 && greetRes.json.trust > 0,
    `POST /world/social greet returns 0 ms bark ("${greetRes.json?.bark?.text?.slice(0, 48)}", trust=${greetRes.json?.trust})`,
  )

  const ant1 = await post('social', { by: 'heckler', actorId: 'watch-open/spotter', action: 'antagonize' })
  const ant2 = await post('social', { by: 'heckler', actorId: 'watch-open/spotter', action: 'antagonize' })
  const ant3 = await post('social', { by: 'heckler', actorId: 'watch-open/spotter', action: 'antagonize' })
  check(
    ant1.ok && ant2.ok && ant3.ok && ant3.json.trust < 0 && ant3.json.escalateToMind === true,
    `POST /world/social antagonize escalates trust=${ant3.json?.trust}, mood=${ant3.json?.mood}, escalateToMind=${ant3.json?.escalateToMind}`,
  )

  // Spawn a fresh witness and intercept their report via POST /world/social intimidate.
  await post('ask', {
    by: 'tester',
    rule: {
      id: 'watch-intercept',
      name: 'Interceptable witness',
      source: `on('start', (world) => { world.actor('witness-b', { name: 'WitnessB', at: [722, 4045], face: [722, 4065] }) })`,
    },
  })
  await until('witness-b spawns', async () => (await get('around?by=bomber&within=1200')).json?.people?.some((p) => p.name === 'WitnessB'))
  await post('ask', { by: 'bomber', blast: [722, yStreet + 6, 4065], radius: 3, wait: true })
  await until(
    'witness-b becomes active witness',
    async () => (await get('city')).json.witnesses.some((w) => w.witnessId === 'watch-intercept/witness-b'),
    4000,
  )
  const interceptRes = await post('social', { by: 'bomber', actorId: 'watch-intercept/witness-b', action: 'intimidate' })
  const cityAfterIntercept = (await get('city')).json
  check(
    interceptRes.ok && interceptRes.json?.intercepted === true && !cityAfterIntercept.witnesses.some((w) => w.witnessId === 'watch-intercept/witness-b'),
    `POST /world/social intimidate intercepts active witness report cleanly (intercepted=${interceptRes.json?.intercepted})`,
  )

  // ── 4. Sandboxed rule reading world.city & calling world.stimulus/social/smartObject ──
  console.log('4. Sandboxed rule world.city + world.stimulus + world.social + world.smartObject')
  const RULE_SOURCE = `
on('start', (world) => {
  world.actor('scribe', { name: 'Scribe', at: [730, 4045] })
  world.smartObject('rule-stall', {
    name: 'Taco Stand',
    at: [732, 4045],
    size: [14, 12, 10],
    facing: 'south',
    affordances: [{ kind: 'browse', pos: [7, 0, 5], yaw: 0, tags: ['vendor'] }],
  })
  world.stimulus('horn', [730, 4050], { radius: 300 })
  world.social('watch-open/spotter', 'defuse', { by: 'heckler', quiet: true })
  // Deliberately invalid wants to prove security bounds & refusal reporting:
  world.stimulus('laser_beam', [730, 4050])
  world.social('watch-open/spotter', 'teleport_away')
})
on('refused', (world, e) => {
  world.keep.refused = (world.keep.refused || 0) + e.what.length
  world.keep.refusedDos = e.what.map((w) => w.do).join(',')
})
on('tick', (world) => {
  const c = world.city || {}
  const objs = Array.isArray(c.smartObjects) ? c.smartObjects.length : 0
  const hasBrief = typeof c.directorBrief === 'string' && c.directorBrief.includes('CITY TELEMETRY') ? 1 : 0
  const ref = world.keep.refused || 0
  world.actor('scribe', { name: 'h=' + (c.heat || 0) + ' o=' + objs + ' b=' + hasBrief + ' r=' + ref })
})`

  await post('ask', { by: 'tester', rule: { id: 'city-rule', name: 'City rule', source: RULE_SOURCE } })
  const scribe = await until(
    'city-rule reads world.city and records refusals',
    async () => {
      const p = (await get('around?by=bomber&within=1200')).json?.people?.find((x) => /^h=\d+ o=\d+ b=1 r=[2-9]/.test(x.name))
      return p ?? null
    },
    8000,
  )
  check(
    /^h=[1-5] o=[3-9]\d* b=1 r=[2-9]/.test(scribe.name),
    `sandboxed rule read live world.city and had invalid wants refused (${scribe.name})`,
  )

  const cityWithRule = (await get('city')).json
  check(
    cityWithRule.smartObjects.some((o) => o.id === 'rule:city-rule:rule-stall' && o.name === 'Taco Stand'),
    'world.smartObject registered rule-scoped Taco Stand in GET /world/city',
  )
  check(
    cityWithRule.recentEvents.some((e) => e.kind === 'horn'),
    'world.stimulus emitted horn event visible in GET /world/city recentEvents',
  )

  // Shout via /world/say emits a shout stimulus.
  await post('say', { by: 'bomber', text: 'WATCH OUT!' })
  const cityAfterShout = await until(
    'shout stimulus recorded in GET /world/city',
    async () => {
      const c = (await get('city')).json
      return c.recentEvents.some((e) => e.kind === 'shout') ? c : null
    },
    3000,
  )
  check(cityAfterShout.recentEvents.some((e) => e.kind === 'shout'), 'POST /world/say shout emits shout stimulus into livingCity')

  // Unruling city-rule cleans up its rule-owned Smart Objects cleanly.
  await post('ask', { by: 'tester', unrule: 'city-rule' })
  await until(
    'rule Smart Object removed on unrule',
    async () => !(await get('city')).json.smartObjects.some((o) => o.id === 'rule:city-rule:rule-stall'),
    4000,
  )
  check(true, 'unruling city-rule cleans up rule-owned Smart Objects')
} catch (e) {
  failures.push(String(e.stack ?? e))
} finally {
  server.stop()
  rmSync(dir, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`FAILED\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('world-living-city: ok')
process.exit(0)
