// The street's problems on the real world, with no page (#118): each one's test is run by the
// world on real bodies. Otis climbs stairs made near him and is up; a tall box with no way up
// he tries from every side and gives up on. Ines is shaded by a made thing between her head
// and the sun, not by one beside her. After the rest what solved each is swept and each is
// wanted again. Usage: node test/problems.mjs
import { createServer } from 'vite'

const here = new URL('..', import.meta.url).pathname
const server = await createServer({ root: here, configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, fs: { allow: ['..'] } }, optimizeDeps: { noDiscovery: true }, logLevel: 'warn' })
const bad = []
const check = (what, ok, seen) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || seen === undefined ? '' : ` ${JSON.stringify(seen).slice(0, 400)}`}`); if (!ok) bad.push(what) }
try {
  const { Block } = await server.ssrLoadModule('/src/block.ts')
  const { Problems, PROBLEMS } = await server.ssrLoadModule('/src/problems.ts')
  const { piecesShape } = await server.ssrLoadModule('../home/src/engine/toy.ts')
  const { planeAt, GRADE } = await server.ssrLoadModule('/src/ground.ts')
  const sim = await Block.make({ crates: 0, balls: 0 })
  const said = [], solved = [], wanted = new Map(), seats = new Map()
  const problems = new Problems({
    join: (name, plush, scarf, at) => { const id = sim.cast(name, plush, scarf, at); seats.set(name, id); return id },
    stand: (id, at) => sim.stand(id, at),
    self: (id) => sim.self(id),
    drive: (id, to) => sim.drive(id, to),
    say: (id, words) => said.push([sim.nameOf(id), words]),
    others: () => [],
    made: () => sim.madeNow(),
    sweep: (ids) => ids.forEach((id) => sim.take(id)),
    meets: (from, along, not) => sim.meets(from, along, not),
    wants: (by, who, text) => wanted.set(who, text),
    solved: (by, entry) => solved.push(entry),
  }, 12_000)
  let now = 0
  /** Runs the world for some seconds, or until `until` is so. */
  const run = (seconds, until = () => false) => { for (let i = 0; i < seconds * 60 && !until(); i++) { now += 1000 / 60; problems.tick(now); sim.step() } }
  const where = (name) => sim.self(seats.get(name)).p
  const feet = (name) => where(name)[1] - 0.75 - planeAt(where(name)[2])
  const otis = PROBLEMS.find((p) => p.id === 'up').who.at, ines = PROBLEMS.find((p) => p.id === 'shade').who.at
  // Laid on the street as a made thing is: tilted with the hill, so a step is as high from the ground at either end.
  const made = (id, label, at, pieces) => ({ id, label, frame: { at, yaw: 0, tilt: Math.atan(GRADE) }, gadgets: [], wires: [], inputs: {}, parts: [{ id: 'body', material: 'maple', at: [0, 0, 0], shape: piecesShape(pieces), pieces }] })
  const box = (half, at) => ({ shape: { kind: 'box', half }, at })
  /** Five steps rising towards -z (up the hill), and a landing 1.8 m up. */
  const stairs = [...[0, 1, 2, 3, 4].map((i) => box([0.8, 0.15 * (i + 1), 0.25], [0, 0.15 * (i + 1), 1.5 - 0.5 * i])), box([0.8, 0.9, 0.6], [0, 0.9, -1.6])]

  run(3)
  check('left alone for three seconds, nothing is solved and all three want something', solved.length === 0 && problems.wanted().map((w) => w.who).sort().join() === 'Ines,Mabel,Otis', solved)

  // A tall box near Otis has no way up: he tries every side, says so, and still wants.
  sim.place(made('made-1', 'Tall box', [otis[0] - 3.5, planeAt(otis[2] + 1), otis[2] + 1], [box([0.7, 1, 0.7], [0, 1, 0])]), 'a tall box', 'Tester')
  run(30)
  check('a tall box with no way up: he tries it from every side, gives up and says so', solved.length === 0 && said.some(([who, words]) => who === 'Otis' && /cannot get up/.test(words)) && feet('Otis') < 0.5, { solved, said: said.filter(([who]) => who === 'Otis'), feet: feet('Otis') })

  // Stairs near him: he finds the side that goes up, climbs, and is up.
  sim.place(made('made-2', 'Stairs', [otis[0] + 0.5, planeAt(otis[2] - 4.5), otis[2] - 4.5], stairs), 'stairs', 'Tester')
  run(30, () => solved.length > 0)
  run(0.5)
  check('stairs: he climbs them himself and is up, and whoever made them is thanked', solved.length === 1 && solved[0].problem === 'up' && solved[0].solver === 'Tester' && solved[0].with === 'Stairs' && feet('Otis') >= 1.4, { solved, feet: feet('Otis'), at: where('Otis'), said: said.filter(([who]) => who === 'Otis') })
  check('he wants nothing now', wanted.get('Otis') === '')

  // A canopy beside Ines, not between her and the sun, is not shade; one over her is.
  sim.place(made('made-3', 'Canopy', [ines[0] - 4.5, ines[1], ines[2] + 3], [box([1, 0.05, 1], [0, 2.6, 0])]), 'a canopy', 'Tester')
  run(1)
  check('a canopy that stands beside her does not shade her', solved.length === 1, solved)
  sim.place(made('made-4', 'Canopy', ines, [box([2.2, 0.05, 2.2], [0, 3, 0])]), 'a canopy', 'Tester')
  run(1)
  check('one between her head and the sun does, and whoever made it is thanked', solved.length === 2 && solved[1].problem === 'shade' && solved[1].who === 'Ines' && solved[1].solver === 'Tester' && solved[1].with === 'Canopy', solved)

  run(14)
  check('after the rest the stairs and that canopy are swept, the rest left, and both want again', sim.madeNow().map((m) => m.id).join() === 'made-1,made-3' && wanted.get('Otis') && wanted.get('Ines'), { made: sim.madeNow().map((m) => m.id), otis: wanted.get('Otis'), ines: wanted.get('Ines') })
  check('Otis is down on the ground again', feet('Otis') < 0.3, { feet: feet('Otis'), at: where('Otis') })
  check('nothing was solved twice', solved.length === 2, solved)
} catch (e) { console.log('FAILED:', e?.stack?.split('\n').slice(0, 8).join('\n')); process.exitCode = 1 }
if (bad.length) { console.log(`FAILED: ${bad.join('; ')}`); process.exitCode = 1 }
await server.close()
