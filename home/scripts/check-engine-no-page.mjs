// The engine's World with no page (#118): the street's world process runs it in Node, where
// there is no document and nothing is drawn. This builds the pinball table, plays it blind,
// and proves the three things a world outside the home needs: a card is still its text, a
// part marked upright never tips, and the floor may be lower than the home's.
// Usage: node scripts/check-engine-no-page.mjs
// Vite loads the TypeScript in-process (no port, no browser).
import * as THREE from 'three/webgpu'
import { createServer } from 'vite'

const vite = await createServer({ root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } })
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass) })
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
}
try {
  const { loadJolt, createJolt } = await vite.ssrLoadModule('/src/engine/jolt.ts')
  const { World } = await vite.ssrLoadModule('/src/engine/world.ts')
  const { PINBALL, PINBALL_STAND } = await vite.ssrLoadModule('/src/physics/toys/pinball-table.ts')
  check('there is no page here', typeof document === 'undefined' && typeof window === 'undefined')
  await loadJolt()

  // The pinball table, built and played with no page.
  const events = {}
  const world = new World(createJolt(), (e) => { events[e.kind] = (events[e.kind] ?? 0) + 1 })
  world.addToy(PINBALL_STAND)
  world.addToy(PINBALL)
  const built = world.census()
  check('the pinball table builds', built.things > 40 && built.gadgets > 40, built)
  world.input('plunger', true)
  world.advance(1)
  world.input('plunger', false)
  for (let i = 0; i < 600; i++) {
    if (i % 40 === 0) { world.input('left', true); world.input('right', true) }
    if (i % 40 === 8) { world.input('left', false); world.input('right', false) }
    world.advance(1 / 60)
  }
  const fired = Object.values(world.signals()).reduce((a, b) => a + b, 0)
  check('it plays: the ball hits things and gadgets fire', events.impact > 0 && fired > 0, { events, fired })
  const cards = world.texts()
  check('a card is its text, with no canvas made', Object.keys(cards).length >= 1 && Object.values(cards).every((t) => typeof t === 'string' && t.length > 0) && world.census().displays === 0, { cards, displays: world.census().displays })
  const glows = world.census().glows
  world.glow(Object.keys(cards)[0], 1)
  check('a part with a card takes no glow, as on a page', world.census().glows === glows, { before: glows, after: world.census().glows })
  world.removeToy(PINBALL.id)
  check('a toy taken out takes its cards', Object.keys(world.texts()).length === 0, world.texts())
  world.dispose()

  // An upright part never tips; one that is not, standing on the same slope, does.
  const slope = new World(createJolt(), () => {})
  const capsule = { kind: 'capsule', halfHeight: 0.3, radius: 0.1 }
  slope.addToy({
    id: 'hill', label: 'A hill', frame: { at: [0, 0, 0], yaw: 0, tilt: 0.5 }, gadgets: [], wires: [], inputs: {},
    parts: [
      { id: 'ground', shape: { kind: 'box', half: [3, 0.1, 3] }, material: 'cork', at: [0, -0.1, 0] },
      { id: 'steady', shape: capsule, material: 'cork', motion: 'dynamic', upright: true, at: [-1, 0.41, 0] },
      { id: 'loose', shape: capsule, material: 'cork', motion: 'dynamic', at: [1, 0.41, 0] },
    ],
  })
  slope.advance(2)
  const steady = slope.upright('hill/steady'), loose = slope.upright('hill/loose')
  check('an upright part stays as it was made', steady > 0.999, steady)
  check('a part not marked upright tips on the same slope', loose < 0.9, loose)
  let refused = ''
  try { slope.addToy({ id: 'bad', label: '', frame: { at: [0, 0, 0], yaw: 0, tilt: 0 }, gadgets: [], wires: [], inputs: {}, parts: [{ id: 'p', shape: capsule, material: 'cork', at: [0, 5, 0], upright: 'yes' }] }) } catch (e) { refused = String(e.message) }
  check('upright that is not true or false is refused', /upright/.test(refused) && !slope.hasToy('bad'), refused)
  // A gadget kind may look down: the ground under a part, by a ray. (That the API kinds are given says so is the typecheck's to prove.)
  const { registerGadget, unregisterGadget } = await vite.ssrLoadModule('/src/engine/gadgets.ts')
  registerGadget({ kind: 'feeler', about: 'Says what is under its part.', knobs: {}, inputs: [], outputs: [], step(g, w) { const t = w.thing(g.part); const hit = t && w.castRay(t.position, [0, -2, 0], [g.part]); g.state.under = hit?.key === 'hill/ground' ? 1 : 0; g.state.up = hit ? hit.normal[1] : 0 } })
  slope.addToy({ id: 'probe', label: 'A probe', frame: { at: [0, 0, 0], yaw: 0, tilt: 0 }, wires: [], inputs: {}, parts: [{ id: 'eye', shape: { kind: 'sphere', radius: 0.05 }, material: 'cork', at: [0, 1, 0], sensor: true }], gadgets: [{ id: 'feel', kind: 'feeler', part: 'eye' }] })
  slope.advance(0.1)
  const feel = slope.state('probe/feel')
  check('an unknown gadget has no state', slope.state('probe/nobody') === null)
  check('a gadget kind finds the ground under its part by a ray', feel.under === 1 && Math.abs(feel.up - Math.cos(0.5)) < 0.01, feel)
  unregisterGadget('feeler')
  slope.dispose()

  // The floor: a ball over nothing is lost a metre under the home's floor, and falls on where the floor is lower.
  const ball = (id) => ({ id, label: 'A ball', frame: { at: [0, 0, 0], yaw: 0, tilt: 0 }, gadgets: [], wires: [], inputs: {}, parts: [{ id: 'ball', shape: { kind: 'sphere', radius: 0.05 }, material: 'rubber', motion: 'dynamic', at: [0, 0.5, 0] }] })
  const lost = []
  const home = new World(createJolt(), (e) => { if (e.kind === 'clamped' && e.reset) lost.push(e.thing) })
  home.addToy(ball('a'))
  home.advance(1.1)
  check('in the home a ball that falls out is put back', lost.includes('a/ball') && home.thing('a/ball').position[1] > -1.01, { lost, y: home.thing('a/ball').position[1] })
  check('in the home nothing is moved below the floor', home.moveTo('a/ball', [0, -3, 0], [0, 0, 0]) === false)
  home.dispose()
  const fell = []
  const street = new World(createJolt(), (e) => { if (e.kind === 'clamped' && e.reset) fell.push(e.thing) }, undefined, -12)
  street.addToy(ball('b'))
  street.advance(1.1)
  const y = street.thing('b/ball').position[1]
  check('with a lower floor the same ball is still falling', fell.length === 0 && y < -4, { fell, y })
  check('with a lower floor a thing may be moved below 0', street.moveTo('b/ball', [0, -3, 0], [0, 0, 0]) === true)
  street.advance(2)
  // It was at -3 and falling: back above that, it was put home. (Its `clamped` event may go unsaid: a speed limit said within the last quarter second hides it.)
  check('and it is lost a metre under that floor', street.thing('b/ball').position[1] > -3, { fell, y: street.thing('b/ball').position[1] })
  // The margin: a ball resting half a metre under that floor is not lost; and a bound thing follows the same floor as a toy's part.
  const edge = []
  const low = new World(createJolt(), (e) => { if (e.kind === 'clamped') edge.push(e) }, undefined, -12)
  low.addToy({ id: 'c', label: 'A ledge', frame: { at: [0, -12.6, 0], yaw: 0, tilt: 0 }, gadgets: [], wires: [], inputs: {}, parts: [{ id: 'ledge', shape: { kind: 'box', half: [0.5, 0.05, 0.5] }, material: 'cork', at: [0, -0.05, 0] }, { id: 'ball', shape: { kind: 'sphere', radius: 0.05 }, material: 'cork', motion: 'dynamic', at: [0, 0.06, 0] }] })
  const box = new THREE.Object3D()
  box.position.set(3, 0.5, 0)
  low.bind('box', box, { shape: { kind: 'box', half: [0.1, 0.1, 0.1] }, motion: 'dynamic', material: 'cork' })
  low.applyImpulse('box', [0, 0.001, 0])
  low.advance(1.1)
  const rest = low.thing('c/ball').position[1]
  // Poses: what is awake, and everything when asked. The ball came to rest on its ledge; the box is still falling.
  const awake = low.poses().map((x) => x.key), all = low.poses(true)
  check('poses are the moving things awake, or all of them', awake.includes('box') && !awake.includes('c/ball') && !all.some((x) => x.key === 'c/ledge') && all.find((x) => x.key === 'c/ball')?.awake === false && Math.abs(all.find((x) => x.key === 'box').position[1] - box.position.y) < 1e-6, { awake, all })
  check('a thing resting half a metre under the floor is not lost', edge.length === 0 && Math.abs(rest - -12.55) < 0.02, { edge, rest })
  check('with a lower floor a bound thing is still falling too', box.position.y < -4, box.position.y)
  low.dispose()
  const up = new World(createJolt(), () => {})
  const box2 = new THREE.Object3D()
  box2.position.set(3, 0.5, 0)
  up.bind('box', box2, { shape: { kind: 'box', half: [0.1, 0.1, 0.1] }, motion: 'dynamic', material: 'cork' })
  up.applyImpulse('box', [0, 0.001, 0])
  up.advance(1.1)
  check('in the home a bound thing that falls out is put back', box2.position.y > -1.01, box2.position.y)
  up.dispose()
  street.dispose()
} catch (e) {
  check('ran to the end', false, String(e?.stack ?? e).split('\n').slice(0, 4))
}
await vite.close()
const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} passed`)
process.exit(failed.length ? 1 : 0)
