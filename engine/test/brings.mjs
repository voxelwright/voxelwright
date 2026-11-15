// A rule brings living things into the world (#245, for #264). No page: the real server and world process, and a
// rule that is no game (a marshal who sets out what is asked for, puts people in the seats, sends them off and
// clears up). The kept set (rules/kept.mjs) stands, drives, hovers; seats are for as many as a thing has room for;
// what the rule brought it takes away, and all of it goes when the rule does.
//
//   node test/brings.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from './kit.mjs'

const server = await serve('/dev/null', ['--world', join(mkdtempSync(join(tmpdir(), 'engine-brings-')), 'world.log')])
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const post = async (path, body) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, { method: 'POST', body: JSON.stringify(body) }); if (r.status === 429) { await wait(300); continue } return r.json().catch(() => ({})) } }
const how = async () => JSON.stringify((await (await fetch(`${server.url}/world/rules`)).json()).find((r) => r.id === 'marshal'))
const RULE = `on('start', (world) => { world.actor('marshal', {name: 'Marshal', at: [700, 4100]}); world.actor('ann', {name: 'Ann', at: [704, 4100]}); world.actor('bo', {name: 'Bo', at: [708, 4100]}); world.actor('cy', {name: 'Cy', at: [712, 4100]}); world.actor('clerk', {name: 'Clerk', at: [700, 4106]}) })
on('crossed', (world, e) => { world.keep.n = (world.keep.n || 0) + 1; world.actor('clerk', {say: world.keep.n + ' crossed ' + e.line + ' ' + (e.own || e.thing || e.who) + ' ' + e.way + ' ' + e.speed + ' ' + e.when + ' ' + (e.riders || []).join('+')}) })
on('tick', (world) => { world.actor('marshal', {say: world.things.map((t) => [t.own || t.id, t.name, t.at.join(' '), t.yaw, t.speed, t.upright ? 'up' : 'over', t.seats, (t.riders || []).join('+')].join('|')).join(' ; ') || 'nothing'}) })
on('said', (world, e) => {
  if (/set out/.test(e.text)) { world.thing('k1', {like: 'kart', at: [790, 4072], yaw: Math.PI / 2, colour: 0}); world.thing('c1', {like: 'car', at: [790, 4094], yaw: Math.PI / 2}); world.thing('b1', {like: 'broom', at: [740, 4076], yaw: -Math.PI / 2}); world.thing('h1', {like: 'craft', at: [700, 4076], yaw: -Math.PI / 2}) }
  if (/mount/.test(e.text)) { world.seat('ann', {on: 'k1'}); world.seat('bo', {on: 'c1'}); world.seat('cy', {on: 'c1'}); world.seat('marshal', {on: 'c1'}) }
  if (/launch/.test(e.text)) world.drive('h1', {go: 1})
  if (/beach it/.test(e.text)) world.drive('h1', {go: 0})
  if (/up/.test(e.text)) world.drive('b1', {rise: 1})
  if (/along/.test(e.text)) world.drive('b1', {rise: 0, go: 0.5})
  if (/line up/.test(e.text)) { world.drive('k1', {hold: true}); world.line('finish', {from: [830, 4050], to: [830, 4100]}); world.line('pit', {at: [880, 4072], within: 15}) }
  if (/release/.test(e.text)) world.drive('k1', {hold: false})
  if (/go/.test(e.text)) { world.drive('k1', {go: 1}); world.drive('c1', {go: 1}) }
  if (/stop/.test(e.text)) { world.drive('k1', {go: 0}); world.drive('c1', {go: 0}) }
  if (/a tank/.test(e.text)) world.thing('t1', {like: 'tank', at: [700, 4083]})
  if (/clear the kart/.test(e.text)) world.thing('k1', {like: null})
})`
let since = 0
const says = async (ok, tries = 40) => { let text = ''; for (let i = 0; i < tries; i++) { const a = await (await fetch(`${server.url}/world/around?by=steward&since=${since}`)).json(); for (const h of a.heard ?? []) if (h.name === 'Marshal') { text = h.text; since = Math.max(since, h.n) } const t = text && Object.fromEntries(text.split(' ; ').map((l) => l.split('|')).map((f) => [f[0], { name: f[1], at: (f[2] || '').split(' ').map(Number), yaw: Number(f[3]), speed: Number(f[4]), up: f[5] === 'up', seats: Number(f[6]), riders: f[7] ? f[7].split('+') : [] }])); if (t && ok(t)) return t; await wait(250) } console.log('  the marshal last said', text); return null }
try {
  // The steward stands clear of where the craft is sent (#367): at 4104 they stood at its side, the craft met them and stopped short, and whether it had gone its four metres by then turned on a tick.
  await post('join', { by: 'steward', at: [704, 4150] })
  check((await post('ask', { by: 'tester', rule: { id: 'marshal', name: 'A marshal', source: RULE } })).asked, 'a rule that brings living things is taken')
  await wait(1200)
  await post('say', { by: 'steward', text: 'set out' })
  const out = await says((t) => t.k1 && t.c1 && t.b1 && t.h1 && Object.values(t).every((x) => x.speed === 0))
  check(!!out && out.k1.name === 'kart' && out.c1.name === 'car' && out.k1.up && out.c1.up && out.k1.seats === 1 && out.c1.seats === 2 && out.h1.seats === 6, `said "set out", a kart, a car, a broom and a craft are in the world at once, by the rule's own ids, upright, with their seats (${out ? Object.entries(out).map(([k, v]) => `${k} ${v.name} ${v.seats}`).join(', ') : '?'})`)
  const ground = Math.round((await (await fetch(`${server.url}/world/at?x=760&y=0&z=4078`)).json()).ground)
  check(!!out && Math.abs(out.k1.yaw - 1.57) < 0.1 && Math.abs(out.b1.yaw + 1.57) < 0.1 && Math.abs(out.k1.at[0] - 790) < 6 && Math.abs(out.k1.at[2] - 4072) < 6, `each stands where it was asked and faces as asked (the kart at ${out?.k1.at} facing ${out?.k1.yaw}, the broom facing ${out?.b1.yaw})`)
  // The craft rides over the street as it would over water (the sea and a beach are in the core's own test), level,
  // and low: over the street, not up on something. It is set down in an open lane (#245): at [715, 4094] its hull
  // stood over the rule's own actors and its path ran into a town car parked at x 644 to 686, z 4096 to 4112.
  // It went its four metres only when it had been shoved up onto the actors and rode 1.4 m up, over the car.
  await post('say', { by: 'steward', text: 'launch' })
  await wait(1500)
  await post('say', { by: 'steward', text: 'beach it' })
  const rode = await says((t) => t.h1 && t.h1.speed === 0 && out.h1.at[0] - t.h1.at[0] > 40, 30)
  check(!!rode && rode.h1.up && rode.h1.at[1] <= out.h1.at[1] + 3, `the craft, sent off, rides ${rode ? ((out.h1.at[0] - rode.h1.at[0]) / 10).toFixed(1) : '?'} m west over the street, level (from ${out?.h1.at[1]} high to ${rode?.h1.at[1]})`)
  // What flies: told to rise, the broom goes up; told to go, it goes the way it was set to face (west).
  await post('say', { by: 'steward', text: 'up' })
  await wait(1200)
  await post('say', { by: 'steward', text: 'along' })
  const flew = await says((t) => t.b1 && t.b1.at[1] - out.b1.at[1] > 30 && out.b1.at[0] - t.b1.at[0] > 20, 30)
  check(!!flew, `the broom rises when the rule says (${flew ? ((flew.b1.at[1] - out.b1.at[1]) / 10).toFixed(1) : '?'} m up) and flies the way it faces (${flew ? ((out.b1.at[0] - flew.b1.at[0]) / 10).toFixed(1) : '?'} m west)`)
  // Seats: one in the kart, two in the car, and no room for a third.
  await post('say', { by: 'steward', text: 'mount' })
  const sat = await says((t) => t.k1?.riders.length === 1 && t.c1?.riders.length === 2)
  await wait(700)
  const told = await how()
  check(!!sat && sat.k1.riders[0] === 'ann' && sat.c1.riders.join() === 'bo,cy' && /no seat left/.test(told), `the rule's people are in their seats (the kart: ${sat?.k1.riders}; the car: ${sat?.c1.riders}), and a third for the car's two seats is refused`)
  const people = (await (await fetch(`${server.url}/world/around?by=steward`)).json()).people
  const bo = people.find((p) => p.name === 'Bo'), cy = people.find((p) => p.name === 'Cy')
  check(!!bo && !!cy && bo.far !== cy.far, 'the two in the car sit in seats of their own, not in each other')
  // A fair start: the kart is held still whoever drives it, while the car goes; let go, it goes.
  await post('say', { by: 'steward', text: 'line up' })
  await wait(700)
  await post('say', { by: 'steward', text: 'go' })
  for (let i = 0; i < 5; i++) { await fetch(`${server.url}/world/drive`, { method: 'POST', body: JSON.stringify({ by: 'a script', id: 'marshal-k1', go: 1, turn: 0, rise: 0 }) }); await wait(300) }
  const heldStill = await says((t) => t.k1 && t.c1 && t.c1.at[0] - out.c1.at[0] > 30)
  check(!!heldStill && Math.abs(heldStill.k1.at[0] - out.k1.at[0]) < 3 && heldStill.k1.speed === 0, `held still by the rule, the kart does not move for the rule's own word or a rider's (${heldStill ? (heldStill.k1.at[0] - out.k1.at[0]).toFixed(0) : '?'} cells), while the car goes ${heldStill ? ((heldStill.c1.at[0] - out.c1.at[0]) / 10).toFixed(1) : '?'} m`)
  // Let go, it races over the line and through the place: the rule hears each, which way, how fast and when.
  const crossings = []
  const clerk = async (n, tries = 60) => { let from = 0; for (let i = 0; i < tries && !n(); i++) { const a = await (await fetch(`${server.url}/world/around?by=steward&since=${from}`)).json(); for (const h of a.heard ?? []) { from = Math.max(from, h.n); const m = h.name === 'Clerk' && /^(\d+) crossed (\S+) (\S+) (\S+) (\d+) ([\d.]+) (\S*)$/.exec(h.text); if (m && !crossings.some((c) => c.n === m[1])) crossings.push({ n: m[1], line: m[2], what: m[3], way: m[4], speed: Number(m[5]), when: Number(m[6]), riders: m[7] }) } await wait(200) } }
  await post('say', { by: 'steward', text: 'release' })
  await clerk(() => crossings.some((c) => c.line === 'pit' && c.way === 'out'))
  await post('say', { by: 'steward', text: 'stop' })
  const fin = crossings.find((c) => c.line === 'finish' && c.what === 'k1'), into = crossings.find((c) => c.line === 'pit' && c.way === 'in'), outOf = crossings.find((c) => c.line === 'pit' && c.way === 'out')
  check(!!fin && fin.speed > 20 && fin.riders === 'ann' && (fin.way === '1' || fin.way === '-1'), `let go, it crosses the line and the rule hears it: its own id, which way (${fin?.way}), ${fin?.speed} cells a second, with its rider, at ${fin?.when} s`)
  check(!!into && !!outOf && outOf.when > into.when && into.when > (fin?.when ?? Infinity), `and into a place and out of it again, in that order (in at ${into?.when}, out at ${outOf?.when})`)
  const went = await says((t) => t.k1 && t.c1 && t.k1.speed === 0 && t.c1.speed === 0, 40)
  check(!!went && went.k1.at[0] - out.k1.at[0] > 60 && went.k1.up && went.c1.up, `both went east upright with their riders (the kart ${went ? ((went.k1.at[0] - out.k1.at[0]) / 10).toFixed(1) : '?'} m)`)
  // What is not in the kept set is refused; what the rule brought it takes away.
  await post('say', { by: 'steward', text: 'a tank' })
  await wait(900)
  check(/like one of: kart, car, broom, craft/.test(await how()), 'a thing that is not kept is refused, and the rule is told what is')
  await post('say', { by: 'steward', text: 'clear the kart' })
  const cleared = await says((t) => !t.k1 && t.c1)
  const things = await (await fetch(`${server.url}/world/things`)).json().catch(() => null)
  check(!!cleared && !JSON.stringify(things).includes('marshal-k1') && JSON.stringify(things).includes('marshal-c1'), 'the rule takes its kart away: it is gone from the world and its record with it, the car still there')
  // The rule taken out, everything it brought goes with it.
  await post('ask', { by: 'tester', unrule: 'marshal' })
  await wait(1500)
  const left = JSON.stringify(await (await fetch(`${server.url}/world/things`)).json().catch(() => null))
  check(!/marshal-/.test(left), 'the rule taken out, everything it brought is gone')
} catch (e) { failures.push(String(e.stack ?? e)) }
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('brings: ok')
process.exit(0)
