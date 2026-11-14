// A place from words (#264, the BUILD lane): a realm asked for gets ground of its own on the planet and is built
// there. The idea says what land the realm belongs on; the maker finds it with the land's own rule, makes the
// realm arrive there, and tells whoever writes its rules where to build. Kept replies stand in for the model: this
// checks the path, not what a model makes of it. The real server; no page.
//
//   node test/place.mjs
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { facing, fitted, plan, read as readPlan, source, turned } from '../make/plan.mjs'
import { imagine, placeOf, read, realm, site } from '../make/realm.mjs'
import { here, serve } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const core = (await WebAssembly.instantiate(readFileSync(join(here, 'page', 'core.wasm')), {})).instance.exports
const server = await serve('/dev/null', ['--world', join(mkdtempSync(join(tmpdir(), 'engine-place-')), 'world.log')])
/** A kept idea, as a model fleshes one out; and a kept rule, written from where it was told the place is. */
const IDEA = JSON.stringify({ name: 'Regatta', about: 'A sailing club on a beach. A starter with a flag stands on a wooden jetty and people watch from a low stand.', place: { land: 'shore', room: 400 }, look: { hour: 9 }, questions: [] })
/** A kept plan of a place, with what models get wrong in it: colours written "hue:0:4", a material that is not one, a part that is no shape. */
const PLAN = JSON.stringify({ land: 'shore', room: 300, stands: 'A jetty runs north into the sea from a marker post; a low stand faces it from the east.', builds: [
  { name: 'Jetty', parts: [['posts', 'steel', 'hue:0:4', [[0, -100]], 4, 30], ['line', 'wood', 'own', [[0, -100], [0, -260]], 12, 2, 4], ['posts', 'rubber', 'hue:4', [[-20, -100], [20, -100]], 2, 10], ['dome', 'glass', 'own', 0, 0, 0, 4, 4, 4]] },
  { name: 'stand', parts: [['steps', 'concrete', 'grey:8', 120, 0, -40, 160, 16, 40, '-x', 4], ['box', 'cheese', 'own', 0, 0, 0, 4, 4, 4]] }] })
const asked = [], order = []
const model = async (q) => {
  if (q.system.includes('You design the PLACE')) { order.push('plan'); return { text: PLAN, model: 'a kept reply', ms: 0, cost: 0 } }
  order.push(q.system.startsWith('Someone in a world made of small cubes') ? 'idea' : 'rule')
  if (q.system.startsWith('Someone in a world made of small cubes')) return { text: IDEA, model: 'a kept reply', ms: 0, cost: 0 }
  asked.push(q.prompt)
  const [, x, z] = /its middle is at \[(-?\d+), (-?\d+)\]/i.exec(q.prompt) ?? [], [, ax, az] = /People arrive at \[(-?\d+), (-?\d+)\]/.exec(q.prompt) ?? []
  return { model: 'a kept reply', ms: 0, cost: 0, text: `NAME: regatta\nCANNOT:\nnothing\nRULE:\n\`\`\`js\nconst M = [${x}, ${z}]\non('start', (world) => { world.build('club', { at: M, parts: [['box', 'wood', '3:8', -22, 0, -22, 22, 14, 22]] }); if (!world.people.some((p) => p.mine)) world.actor('starter', { name: 'Starter', at: [${ax} + 30, ${az}] }) })\non('built', (world, e) => { world.keep.built = e })\n\`\`\`` }
}
try {
  // ── The idea says where the realm belongs, as data read strictly.
  const idea = await imagine({ idea: 'a sailing club on a beach', model })
  check(idea.place?.land === 'shore' && idea.place.room === 400 && idea.look?.hour === 9, `an idea says what land the realm belongs on and how much room it needs: ${JSON.stringify(idea.place)}`)
  check(placeOf({ land: 'moon', room: 300 }) === undefined && placeOf({ land: 'water' }) === undefined && placeOf('sand') === undefined && placeOf({ land: 'sand', room: 1e9 }).room === 3000 && placeOf({ land: 'grass' }).room === 300 && read('{"name": "x", "about": "y", "place": {"land": "sand", "room": "<script>"}}').place.room === 300, 'a place that is not one of the lands is left out, and a room that is no number or too big is put right')

  // ── The ground is found for each kind of land, and one arrives on dry ground at its edge, looking at its middle.
  const HOME = [700, 4070]
  for (const [land, room, want] of [['sand', 600, (s) => s.at[0] > HOME[0] + 30000 && s.of === 'sand'], ['shore', 600, (s) => s.of === 'sand' && !!s.water], ['street', 100, (s) => s.of === 'asphalt' && Math.hypot(s.at[0] - HOME[0], s.at[2] - HOME[1]) < 3000], ['high', 300, (s) => s.at[1] > 3000], ['grass', 300, (s) => s.of === 'grass'], ['open', 1200, (s) => s.town === null]]) {
    const began = performance.now(), s = await site({ land, room }, core), ms = performance.now() - began
    const dry = s && core.ground_at(s.arrive.at[0], s.arrive.at[1]) >= 3, far = s ? Math.hypot(s.at[0] - s.arrive.at[0], s.at[2] - s.arrive.at[1]) : 0
    const facing = s ? Math.abs(Math.atan2(s.at[0] - s.arrive.at[0], -(s.at[2] - s.arrive.at[1])) - s.arrive.yaw) < 0.01 : false
    check(s && want(s) && dry && far >= 79 && far <= 321 && facing && ms < 2000, `${land} with ${room} cells of room: ${s ? `${s.of} at ${s.at[0]}, ${s.at[2]}, ${(Math.hypot(s.at[0] - HOME[0], s.at[2] - HOME[1]) / 10000).toFixed(1)} km from the town, rising ${s.rise}; one arrives ${Math.round(far)} cells off on dry ground, facing it (${ms.toFixed(0)} ms)` : 'none found'}`)
  }

  // ── A realm asked for is made there: it arrives at its place, its rule is told where, and what it builds is in the realm.
  const r = await realm({ server: server.url, name: idea.name, about: idea.about, look: idea.look, place: idea.place, by: 'check', model, cannot: '/dev/null' })
  const record = (await (await fetch(`${server.url}/realms`)).json()).realms.find((x) => x.id === r.realm)
  check(r.state === 'there' && !r.rough && r.site && record?.arrive?.at?.[0] === r.site.arrive.at[0] && record.arrive.at[1] === r.site.arrive.at[1] && Math.abs(record.arrive.yaw - r.site.arrive.yaw) < 0.01, `the realm is made and one arrives at its place: ${JSON.stringify(record?.arrive)}${r.rough ? ` (${r.rough})` : ''}`)
  check(asked.length === 1 && asked[0].includes('THE PLACE.') && asked[0].includes(`its middle is at [${r.site.at[0]}, ${r.site.at[2]}]`) && asked[0].includes('the sea lies to the') && asked[0].includes(`The asker stands at [${r.site.arrive.at[0]}, ${r.site.arrive.at[1]}]`), 'whoever writes its rules is told where the place is, how the land lies, where the sea is and where people arrive')
  let built = null
  for (let i = 0; i < 60 && !built; i++) { await new Promise((res) => setTimeout(res, 250)); const k = await (await fetch(`${server.url}/realm/${r.realm}/world/at?x=${r.site.at[0]}&y=${r.site.at[1] + 12}&z=${r.site.at[2]}`)).json(); if (k.material === 10) built = k }
  const home = await (await fetch(`${server.url}/world/at?x=${r.site.at[0]}&y=${r.site.at[1] + 12}&z=${r.site.at[2]}`)).json()
  check(built && home.material === 0, 'what the rule built stands at the place in the realm, and not at home')

  // ── The place before its rule: planned as data, read as a stranger's, turned to lie as the ground does, built by a rule of its own.
  const design = await plan({ idea: 'a sailing club on a beach', model })
  check(design.land === 'shore' && design.builds.length === 2 && design.builds[0].name === 'jetty' && design.builds[0].parts.length === 3 && design.builds[1].parts.length === 1 && design.left === 2 && design.why.length === 2, `a place is planned as data: ${design.builds.map((b) => `${b.name} (${b.parts.length} parts)`).join(', ')}; a colour written "hue:0:4" and a material called rubber are read, and the ${design.left} parts that are no shape or no material are left out and said`)
  check(JSON.stringify(turned(['steps', 'wood', 'own', 10, 0, 20, 30, 8, 26, '-z', 2], 1)) === JSON.stringify(['steps', 'wood', 'own', -25, 0, 10, -19, 8, 30, '+x', 2]) && JSON.stringify(turned(['line', 'wood', 'own', [[0, -100], [5, 0]], 2, 2], 2)) === JSON.stringify(['line', 'wood', 'own', [[0, 100], [-5, 0]], 2, 2]) && JSON.stringify(turned(turned(turned(turned(['box', 'wood', 'own', 3, 0, -7, 9, 4, 2], 1), 1), 1), 1)) === JSON.stringify(['box', 'wood', 'own', 3, 0, -7, 9, 4, 2]), 'a part is turned by quarter turns: its box, its points and the way it slopes, and four turns bring it back')
  let threw = ''
  try { readPlan('{"land": "moon", "builds": []}') } catch (e) { threw = e.message }
  check(/land is one of/.test(threw) && source([{ id: 'a', parts: [['box', 'wood', 'own', 0, 0, 0, 2, 2, 2]] }], [10, 0, 20]).includes('const AT = [10, 20]'), 'a plan that names no land of the planet is refused; the rule that builds a place is written by the engine, with the parts in it as data')
  order.length = 0; asked.length = 0
  const stages = []
  const early = await realm({ server: server.url, name: 'Regatta', about: idea.about, look: idea.look, plan: Promise.resolve(design), by: 'check', model, cannot: '/dev/null', say: (words, stage) => { if (stage) stages.push({ ...stage, rules: order.filter((o) => o === 'rule').length }) } })
  const placedAt = stages.find((x) => x.stage === 'placed'), rulesThere = await (await fetch(`${server.url}/realm/${early.realm}/world/rules`)).json()
  check(early.state === 'there' && placedAt && placedAt.rules === 0 && placedAt.id === early.realm && rulesThere.some((x) => x.id === 'place' && x.running && !x.error), `the place stands, and the page is told so, before any rule is asked of a model (${rulesThere.map((x) => x.id).join(', ')} are the realm's rules after)`)
  const g = early.site, k = facing(g), [mx, , mz] = g.at, post = turned(['posts', 'steel', 'own', [[0, -100]], 4, 30], k)[3][0]
  const away = (post[0] * (mx - g.arrive.at[0]) + post[1] * (mz - g.arrive.at[1])) > 0, steel = await (await fetch(`${server.url}/realm/${early.realm}/world/at?x=${mx + post[0]}&y=${core.feet_at(mx + post[0], mz + post[1]) + 12}&z=${mz + post[1]}`)).json()
  check(away && steel.material === 12 && early.place?.builds.join() === 'jetty,stand', `the plan is turned to lie as the ground does: what it put to its north stands beyond the middle from where one arrives (a steel post at ${mx + post[0]}, ${mz + post[1]})`)
  check(asked.length === 1 && asked[0].includes('THE PLACE IS ALREADY BUILT') && asked[0].includes('"jetty"') && asked[0].includes('do not build it again') && !asked[0].includes('THE PLACE. This realm has ground'), 'whoever writes the people and the game is told what stands there and not to build it again')
  // The rule of the people and the game put again changed (the fuller rule landing): the place is another rule's, and nothing of it is built again.
  const rulesOf = async () => (await fetch(`${server.url}/realm/${early.realm}/world/rules`)).json(), placeBefore = (await rulesOf()).find((x) => x.id === 'place')
  const game = await (await fetch(`${server.url}/realm/${early.realm}/world/rules?id=${early.rule}`)).json()
  await fetch(`${server.url}/realm/${early.realm}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'check', rule: { id: early.rule, name: game.name, source: `${game.source}\n// fuller\n` } }) })
  await new Promise((res) => setTimeout(res, 1500))
  const placeAfter = (await rulesOf()).find((x) => x.id === 'place'), still = await (await fetch(`${server.url}/realm/${early.realm}/world/at?x=${mx + post[0]}&y=${core.feet_at(mx + post[0], mz + post[1]) + 12}&z=${mz + post[1]}`)).json()
  check(placeAfter.calls === placeBefore.calls && !placeAfter.error && still.material === 12 && (await rulesOf()).find((x) => x.id === early.rule)?.running, 'the game\'s rule put again changed leaves the place as it stands: its rule is not called and nothing is built again')
  const fit = fitted(design, g, core)
  check(fit.builds.length === 2 && fit.cells > 1000 && fit.left === 2, `the same plan fits its ground again the same: ${fit.cells} cells`)

  // ── A realm with no place is what it was: it arrives where realms always did.
  const plain = await realm({ server: server.url, name: 'Plain', about: 'The town as it stands.', by: 'check', model: async (q) => ({ ...(await model({ ...q, prompt: `${q.prompt} its middle is at [700, 4200] People arrive at [700, 4060]` })) }), cannot: '/dev/null' })
  const plainRecord = (await (await fetch(`${server.url}/realms`)).json()).realms.find((x) => x.id === plain.realm)
  check(plain.state === 'there' && !plain.site && !asked[1].includes('THE PLACE.') && JSON.stringify(plainRecord.arrive ?? null) !== JSON.stringify(record.arrive), 'a realm whose idea names no place is made as before, with nothing said of a place')
} catch (e) { failures.push(String(e?.stack ?? e)) }
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('place: ok')
process.exit(0)
