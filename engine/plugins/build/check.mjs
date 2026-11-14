// The build plugin's check: two rules that are not alike and neither a game. A road mender lays a path over open
// country, fences it, and takes it up again; a carpenter puts up a platform in the street with rails and a gate.
// What they build is in the world's cells for everyone (someone who joins later reads it from the world's stream),
// outlives the server, is refused whole where it should be, and when it is taken away the world is as it was.
// The real server; no page and no model.
//
//   node plugins/build/check.mjs
import { existsSync, readFileSync } from 'node:fs'
import { guideFor } from '../../make/rules.mjs'
import { until, wait, world } from '../../test/plugkit.mjs'

const w = await world(), { check } = w
/** The plain east of the town (rolling ground), and the street by the yard. */
const P = [45000, 4300], S = [760, 4062]
const MENDER = `
const P = [${P}]
const say = (world, e) => { world.keep.heard = (world.keep.heard || []).concat([e]).slice(-40) }
const path = (world) => world.build('path', { at: P, parts: [
  ['line', 'asphalt', 'grey:9', [[-100, 0], [0, 30], [100, 40]], 20, 2, -2],
  ['posts', 'wood', 'own', [[-100, -15], [-60, -3], [-20, 9], [20, 17], [60, 21], [100, 25]], 2, 10],
  ['line', 'wood', 'own', [[-100, -15], [-60, -3], [-20, 9], [20, 17], [60, 21], [100, 25]], 1, 1, 8],
] })
on('start', (world) => path(world))
on('built', say)
on('said', (world, e) => {
  if (/again/.test(e.text)) path(world)
  if (/take it up/.test(e.text)) world.build('path', { clear: true })
  if (/hut/.test(e.text)) world.build('hut', { at: [P[0], P[1] + 200], parts: [['box', 'wood', 'own', -10, 0, -10, 10, 20, 10]] })
  if (/over the path/.test(e.text)) world.build('slab', { at: P, parts: [['box', 'concrete', 'own', -5, -3, 20, 5, 3, 40]] })
  if (/beside/.test(e.text)) world.build('slab', { at: [P[0], P[1] - 120], parts: [['disc', 'concrete', 'own', 0, 0, 12, 1, -1]] })
  const bad = { material: [['box', 'cheese', 'own', 0, 0, 0, 4, 4, 4]], colour: [['box', 'wood', 'puce', 0, 0, 0, 4, 4, 4]], shape: [['dome', 'wood', 'own', 0, 0, 0, 4, 4, 4]], far: [['box', 'wood', 'own', 0, 0, 0, 5000, 4, 4]],
    cells: [['box', 'rock', 'own', -600, 0, -600, 600, 10, 600]], rows: [['box', 'brick', 'own', 0, 0, -2000, 2, 30, 2000]], kind: [['box', 5, 'own', 0, 0, 0, 4, 4, 4]], points: [['line', 'wood', 'own', [[0, 0]], 2, 2]] }
  const m = /^wrong (\\w+)/.exec(e.text)
  if (m && bad[m[1]]) world.build('wrong-' + m[1], { at: [P[0] + 400, P[1]], parts: bad[m[1]] })
  if (/no parts/.test(e.text)) world.build('wrong-none', { at: P, parts: 'a hut' })
  if (/nowhere/.test(e.text)) world.build('wrong-at', { parts: [['box', 'wood', 'own', 0, 0, 0, 4, 4, 4]] })
})`
const stage = (gate) => `
const S = [${S}]
const say = (world, e) => { world.keep.heard = (world.keep.heard || []).concat([e]).slice(-40) }
on('start', (world) => world.build('stage', { at: S, parts: [
  ['box', 'wood', '3:8', -20, 0, -20, 20, 6, 20],
  ['steps', 'wood', '2:8', -32, 0, -6, -20, 6, 6, '-x', 2],
  ['posts', 'steel', '0:4', [[-19, -19], [18, -19], [18, 18], [-19, 18]], 2, 22],
  ['box', 'steel', 'white', -19, 16, 18, 19, 17, 19], ['box', 'steel', 'white', 18, 16, -19, 19, 17, 19],
  ${gate ? '' : "['box', 'steel', 'white', -19, 16, -19, 19, 17, -18],"}
] }))
on('built', (world, e) => { say(world, e); if (!e.failed && !e.cleared) world.actor('carpenter', { name: 'Odo', at: S }) })
on('said', (world, e) => { if (/strike the stage/.test(e.text)) world.build('stage', { clear: true }) })`

/** What a rule heard of its builds, as it keeps it (the server writes what rules keep beside the world's file within two seconds). */
const heard = (rule) => { try { return JSON.parse(readFileSync(`${w.file}.people.json`, 'utf8'))[rule]?.keep?.heard ?? [] } catch { return [] } }
const told = (rule, what, ok) => until(`${rule} hears ${what}`, async () => heard(rule).find(ok), 12_000)
/** The first thing down every column of a rectangle: what the world looks like there, to compare. */
const tops = async ([x0, z0, x1, z1]) => JSON.stringify(await w.get(`tops?x0=${x0}&z0=${z0}&x1=${x1}&z1=${z1}&y=420`))
const at = (x, y, z) => w.get(`at?x=${x}&y=${y}&z=${z}`)
/** The world's kept history as someone who joins now is sent it: every echo that is an edit. */
async function edits() {
  const reader = (await fetch(`${w.url}/world/stream?from=0`)).body.getReader(), out = []
  let held = Buffer.alloc(0), quiet = false
  while (!quiet) {
    const got = await Promise.race([reader.read(), wait(400).then(() => null)])
    if (!got || got.done) { quiet = true; break }
    held = Buffer.concat([held, got.value])
    while (held.length >= 12 && held.length >= 12 + held.readUInt32LE(8)) {
      const size = held.readUInt32LE(8)
      if (held.readUInt32LE(0) === 3) { const echo = JSON.parse(held.subarray(12, 12 + size).toString('utf8')); if (echo.edit) out.push(echo) }
      held = held.subarray(12 + size)
    }
  }
  void reader.cancel().catch(() => {})
  return out
}
const say = (text) => w.post('say', { by: 'wren', text })
const PLAIN = [P[0] - 125, P[1] - 150, P[0] + 125, P[1] + 60], STREET = [S[0] - 40, S[1] - 30, S[0] + 30, S[1] + 30]

try {
  const guide = guideFor(await (await fetch(`${w.url}/world/`)).text())
  check(guide.includes('world.build(id, {at, parts})') && guide.includes("on('built'") && guide.includes('stands on top of it'), 'a model writing rules is shown world.build, every line of it, and what it hears (the guide, as make/rules.mjs cuts it)')
  await w.post('join', { by: 'wren', at: [P[0], P[1] - 60] })
  const before = { plain: await tops(PLAIN), street: await tops(STREET) }

  // ── The road mender: a path that follows rolling ground, with a fence whose rail hangs between posts.
  await w.rule('mender', MENDER)
  const path = await told('mender', 'of its path', (e) => e.build === 'path')
  check(path.cells > 3000 && !path.failed && path.at[0] === P[0] && path.low[0] <= P[0] - 100 && path.high[0] >= P[0] + 100, `a rule builds: ${path.cells} cells, from ${path.low} to ${path.high}, and hears of it${path.failed ? ` (${path.failed})` : ''}`)
  const ends = await Promise.all([[-95, 1], [95, 39]].map(async ([dx, dz]) => { const g = (await at(P[0] + dx, 0, P[1] + dz)).ground; return { g, top: (await at(P[0] + dx, g, P[1] + dz)).material, under: (await at(P[0] + dx, g - 2, P[1] + dz)).material, over: (await at(P[0] + dx, g + 1, P[1] + dz)).material } }))
  check(ends.every((e) => e.top === 6 && e.under !== 6 && e.over === 0) && ends[0].g !== ends[1].g, `the path lies in the ground's own top cells where the ground is ${ends[0].g} and where it is ${ends[1].g}: it follows the land`)
  const rail = await Promise.all([-80, -40, 0, 40, 80].map(async (dx) => { const z = P[1] + Math.round(dx < -60 ? -15 + (dx + 100) * 0.3 : dx < -20 ? -3 + (dx + 60) * 0.3 : dx < 20 ? 9 + (dx + 20) * 0.2 : dx < 60 ? 17 + (dx - 20) * 0.1 : 21 + (dx - 60) * 0.1), g = (await at(P[0] + dx, 0, z)).ground; for (const dz of [0, -1, 1]) for (const dy of [9, 10, 8]) if ((await at(P[0] + dx, g + dy, z + dz)).material === 10) return 10; return 0 }))
  check(rail.every((m) => m === 10), `the rail hangs between its posts over ground that steps, and has not fallen (wood at ${rail.filter((m) => m === 10).length} of 5 places along it)`)
  const first = await edits()
  check(first.length >= 1 && first.every((e) => e.built?.rule === 'mender' && e.built.id === 'path' && Array.isArray(e.box) && e.box.length === 6 && e.box[0] < e.box[3] && typeof e.by === 'string'), `someone who joins later is sent it as the world's own edits: ${first.length}, each with the box a page makes again and whose build it is`)
  check(first.every((e) => { for (let i = 2; i < e.edit.length; i += 5) if (e.edit[i] < e.box[0] || e.edit[i + 1] > e.box[3] || e.edit[i + 2] < e.box[1] || e.edit[i + 2] >= e.box[4] || e.edit[i + 3] < e.box[2] || e.edit[i + 3] >= e.box[5]) return false; return e.edit.length <= 65536 && e.edit[1] * 5 + 2 === e.edit.length }), 'every row of every edit lies in its box, and each edit is one the server would take from anyone')
  await say('lay it again'); await wait(600)
  check((await edits()).length === first.length && (await w.how('mender')).error === '', 'asked for again as it is, nothing is done: no edit, no complaint')

  // ── Whole or not at all.
  const g = (await at(P[0], 0, P[1] + 200)).ground
  await w.send('/world/here', { method: 'POST', body: JSON.stringify({ by: 'pat', name: 'Pat', at: [P[0] + 2, g + 17.5, P[1] + 203], yaw: 0 }) })
  await say('build me a hut')
  const hut = await told('mender', 'of the hut', (e) => e.build === 'hut')
  check(/Pat is in the way/.test(hut.waits ?? '') && (await at(P[0] - 8, g + 5, P[1] + 192)).material === 0, `nothing is built where someone at a page stands, not even the part clear of them, and the rule is told it waits: "${(hut.waits ?? '').slice(0, 60)}"`)
  // A rule's later build laid over its earlier one takes those cells as its own; another rule's build may not.
  await say('a slab over the path')
  const slab = await told('mender', 'of the slab', (e) => e.build === 'slab')
  check(slab.cells > 100 && (await at(P[0], (await at(P[0], 0, P[1] + 30)).ground, P[1] + 30)).material === 7, `a rule lays a later build over its own earlier one (${slab.cells} cells of concrete across the path)`)
  await w.rule('rival', `on('start', (world) => world.build('mine', { at: [${P}], parts: [['box', 'brick', 'own', -5, -3, 20, 5, 3, 40]] }))\non('built', (world, e) => { world.keep.heard = [e] })`)
  const rival = await told('rival', 'of its build', (e) => e.build === 'mine')
  check(/another rule's/.test(rival.failed ?? ''), `another rule may not: "${(rival.failed ?? '').slice(0, 70)}"`)
  await w.post('ask', { by: 'wren', unrule: 'rival' })
  for (const [word, why] of [['wrong material', /"cheese" is not a material/], ['wrong colour', /"puce" is not a colour/], ['wrong shape', /"dome" is not a shape/], ['wrong far', /within 3000 of at/], ['wrong cells', /cells and may be|too much to lay at once/], ['wrong rows', /rows of cells and may be/], ['wrong kind', /is not a material/], ['wrong points', /two points or more/], ['no parts', /parts is a list/], ['nowhere', /needs at/]]) {
    await say(word)
    const how = await until(`refused: ${word}`, async () => { const r = await w.how('mender'); return why.test(r.error) && r })
    check(how.running, `"${word}" is refused in words and the rule goes on: ${how.error.slice(0, 80)}`)
  }
  const slabbed = (await edits()).filter((e) => e.built.id !== 'slab' && e.built.id !== 'hut').length
  check(slabbed === first.length, 'none of what was refused changed a cell')
  // Pat has gone (a page that says nothing for five seconds has left): the hut that waited is built, and the rule hears of it without asking again.
  const came = await told('mender', 'that the hut is up', (e) => e.build === 'hut' && e.cells > 0)
  check(came.cells > 1000 && (await at(P[0] - 8, g + 5, P[1] + 192)).material === 10, `when they have stepped away what waited is built, whole (${came.cells} cells), and the rule hears of it`)
  await say('a slab beside it')
  const beside = await told('mender', 'of the slab beside', (e) => e.build === 'slab' && !e.failed && e.at[2] !== P[1])
  check(beside.cells > 300, `the same build asked for where it may be is built (${beside.cells} cells)`)

  // ── The carpenter: a platform people stand on, rails that hang, and a gate that opens by building it again.
  await w.post('join', { by: 'ada', at: [S[0] - 60, S[1]] })
  await w.rule('carpenter', stage(false))
  const up = await told('carpenter', 'of its stage', (e) => e.build === 'stage')
  const base = up.at[1], odo = await until('the carpenter stands', async () => (await w.get('around?by=ada&within=400')).people.find((p) => p.name === 'Odo'), 12_000)
  check(odo.at[1] === base + 6, `an actor placed after the build stands on top of it: feet at ${odo.at[1]}, the floor's top at ${base + 6}`)
  check((await at(S[0], base + 16, S[1] - 19)).material === 12 && (await at(S[0], base + 16, S[1] + 18)).material === 12, 'its rails hang between their posts')
  const n = (await edits()).length
  await w.rule('carpenter', stage(true))
  await until('the gate is open', async () => (await at(S[0], base + 16, S[1] - 19)).material === 0, 12_000)
  const after = (await edits()).slice(n)
  check(after.some((e) => e.built.gone) && after.some((e) => e.built.id === 'stage' && !e.built.gone) && (await at(S[0], base + 16, S[1] + 18)).material === 12 && (await at(S[0], base + 3, S[1])).material === 10, 'built again with other parts, the old build is taken away and the new one stands: the gate\'s rail is gone, the rest is there')

  // ── It outlives the server: a world started again has what was built, remembers what it replaced, and builds nothing twice.
  const kept = (await edits()).length
  await w.again()
  await w.post('join', { by: 'wren', at: [P[0], P[1] - 60] })
  await w.post('join', { by: 'ada', at: [S[0] - 60, S[1]] })
  await until('the rules run again', async () => (await w.how('mender'))?.running && (await w.how('carpenter'))?.running)
  await wait(1500)
  check((await edits()).length === kept && (await at(S[0], base + 3, S[1])).material === 10, 'started again, the world has what was built, and the rules building on start add nothing')
  // A blast takes a corner of the platform: what is broken is the world's now, not the build's.
  await w.post('ask', { by: 'wren', blast: [S[0] + 18, base + 4, S[1] + 18], radius: 8 })
  await wait(2500)
  await say('take it up')
  const gone = await told('mender', 'that the path is gone', (e) => e.build === 'path' && e.cleared)
  await say('strike the stage')
  const struck = await told('carpenter', 'that the stage is gone', (e) => e.build === 'stage' && e.cleared)
  check(gone.back > 3000 && gone.left === 0, `taken up after a restart, every cell the path still held is put back as it was (${gone.back}, none left)`)
  check(struck.left > 0 && struck.back > 0, `what a blast broke is left as the blast left it (${struck.left} cells), the rest is taken away (${struck.back})`)
  // The slab beside the path is still there: taking the rule out takes it.
  await w.post('ask', { by: 'wren', unrule: 'mender' })
  await until('the mender is gone', async () => !(await w.how('mender')))
  await wait(800)
  const plain = await tops(PLAIN)
  check(plain === before.plain, 'with the path taken up and the rule taken out, the plain is cell for cell what it was before anything was built')
  const street = await tops(STREET)
  check(street !== before.street, 'the street is not: a corner of it was blasted, and that is nobody\'s to undo')
  const odoNow = (await w.get('around?by=ada&within=400')).people.find((p) => p.name === 'Odo')
  check(odoNow && odoNow.at[1] < base + 3, `the carpenter was stood again on the ground when the floor went from under him (feet at ${odoNow?.at[1]}, the ground at ${base})`)
  check(existsSync(w.file), 'the world kept all of it in its one file')
} catch (e) { w.failures.push(String(e?.stack ?? e)) }
w.finish('plugin build')
