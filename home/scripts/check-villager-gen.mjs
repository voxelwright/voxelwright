// Headless proof of the generated-villager checks (#47 round 2, src/villagers/gen/checks.ts):
// the hand-made three, their specs, the prompt's own example and a round-1 frog pass; a scarf
// across the face (round 1's bear and a synthetic one), a sun-hat brim hiding the eyes from the
// dollhouse camera (round 2's first frog), a floating head, a speck of a prop and a
// too-wide body are refused with a plain reason. Also the spec checker cuts a huge untrusted name
// before working on it (Sentinel, round 2). Round 3, species: round 1's tortoise and round 3's heron
// pass; the prompt's own example, round 2's shell-less tortoise and its mouse-as-a-bear are refused
// as the default round template. Round 4, role mark: the example's toque (villager.mark()) and the setup
// stub built from it pass; no mark, a mark inside the outline (a hip pouch) and a marked whole head are refused.
// Setup fix (live giraffe): a stocking cap bigger than its head passes; a marked head sphere, a marked body and a
// mark bigger than the rest of the villager are refused, each naming the role's mark.
// Usage: node scripts/check-villager-gen.mjs [base-url]   (dev server running; default http://localhost:5332/)
// Exits non-zero when any check fails.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.argv[2] ?? 'http://localhost:5332/'
const fixture = (name) => readFileSync(join(here, 'villagers/fixtures', name), 'utf8')
const example = readFileSync(join(here, 'villagers/arm-code.md'), 'utf8').split('Example (')[1].match(/export default function \(villager, api\) \{[\s\S]*?\n\}/)[0]

const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass) })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

/**
 * A small plush cook, sound by default. Options break one thing each:
 * scarfY moves the scarf ring (0.43 is across the eyes), lift raises the head and eyes,
 * prop scales the held spoon, wide stretches the body sideways.
 */
const plush = ({ scarfY = 0.27, lift = 0, prop = 1, wide = 1 } = {}) => `export default function (villager, { THREE }) {
  const felt = (c, r = 1) => new THREE.MeshStandardMaterial({ color: c, roughness: r })
  const at = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m }
  at(villager, new THREE.SphereGeometry(0.17, 20, 12), felt('#c9a27a'), 0, 0.17, 0).scale.set(${wide}, 1, 1)
  const scarf = at(villager, new THREE.TorusGeometry(0.13, 0.03, 8, 24), felt('#c8553d'), 0, ${scarfY}, 0.02)
  scarf.rotation.x = Math.PI / 2
  const head = villager.tag(new THREE.Group(), 'head')
  head.position.set(0, ${0.42 + lift}, 0)
  villager.add(head)
  at(head, new THREE.SphereGeometry(0.13, 20, 12), felt('#c9a27a'), 0, 0, 0)
  for (const s of [-1, 1]) {
    villager.tag(at(villager, new THREE.SphereGeometry(0.025, 12, 8), felt('#241a18', 0.25), s * 0.05, ${0.44 + lift}, 0.12), s < 0 ? 'eye-left' : 'eye-right')
    villager.tag(at(villager, new THREE.SphereGeometry(0.035, 12, 8), felt('#c9a27a'), s * 0.17 * ${wide}, 0.18, 0.02), s < 0 ? 'hand-left' : 'hand-right')
    villager.tag(at(villager, new THREE.SphereGeometry(0.04, 12, 8), felt('#c9a27a'), s * 0.08, 0.03, 0.02), s < 0 ? 'foot-left' : 'foot-right')
  }
  const spoon = villager.tag(new THREE.Group(), 'held')
  spoon.position.set(-0.17 * ${wide}, 0.16, 0.06)
  spoon.scale.setScalar(${prop})
  villager.add(spoon)
  at(spoon, new THREE.CylinderGeometry(0.01, 0.012, 0.2, 8), felt('#a8703a'), 0, 0.06, 0)
  at(spoon, new THREE.SphereGeometry(0.035, 12, 8), felt('#a8703a'), 0, 0.17, 0).scale.set(1, 1.3, 0.5)
  villager.about({ name: 'Probe', role: 'cook', bark: 'Hello.', voice: { pitch: 240 } })
}`

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  await page.goto(`${base}?plugins=renderer,camera&q=low&villager=gen&gen=none`)
  await page.waitForFunction(() => window.villagerGen, null, { timeout: 30000 })
  const trial = (code, opts = {}) => page.evaluate(([c, o]) => window.villagerGen.trial(c, o), [code, opts])

  // Passing: the hand-made plush, their specs, the prompt's example, a sound probe and a round-1 frog.
  for (const id of ['hand:dumpling', 'hand:tuft', 'hand:moss', 'spec:dumpling', 'spec:tuft', 'spec:moss']) {
    const r = await page.evaluate((i) => window.villagerGen.audit(i), id)
    check(`${id} passes every check (species measured, not applied: they are the round template)`, r.failures.length === 0 && r.measures.species, r.failures.length ? r.failures : r.measures.species)
  }
  for (const [name, code, opts] of [['the prompt example (Dumpling with a toque), species off', example], ['a sound probe cook, species off', plush()], ['round 1 frog (code-5)', fixture('round1-frog.code.txt'), { species: true, accent: '#3d7cc8' }], ['round 1 tortoise (code-1)', fixture('round1-tortoise.code.txt'), { species: true }], ['round 3 heron (a probe before the final prompt)', fixture('round3-heron.code.txt'), { species: true, accent: '#e0b53a' }]]) {
    const r = await trial(code, opts)
    check(`${name} passes`, r.ok, r.ok ? r.measures : r.reason)
    if (code === example) check('the prompt example\'s about() carries no persona: it is the ```json block after the module, for the host\'s check', r.persona === undefined && r.name === 'Dumpling', r.persona)
  }

  // Failing, each with a reason a model can act on.
  const refused = async (name, code, pattern, opts) => {
    const r = await trial(code, opts)
    check(`${name} is refused`, !r.ok && pattern.test(r.reason), r.reason ?? r.measures)
  }
  await refused('round 1 bear (code-3, scarf ring across the face)', fixture('round1-bear.code.txt'), /eye is hidden from the front/)
  await refused('a scarf ring across the eyes', plush({ scarfY: 0.43 }), /eye is hidden from the front behind a #c8553d body part/)
  await refused('a level sun-hat brim over the eyes (round 2 first pass, frog)', fixture('round2a-frog-brim.code.txt'), /eye is hidden from the dollhouse view/)
  await refused('a head lifted 0.12 off the body', plush({ lift: 0.12 }), /float.* free of the rest/)
  await refused('a spoon at a fifth of its size', plush({ prop: 0.2 }), /held prop .* too small to read/)
  await refused('a body stretched three times as wide', plush({ wide: 3 }), /wide and only .* tall/)
  // Species (round 3): the default round body with a head on top is refused, whatever hat or bag it wears.
  const template = /default round body with a head on top.*no snout, muzzle or beak.*no legs.*no neck/
  await refused('the prompt example (the round template, with a toque)', example, template, { species: true })
  await refused('round 2 tortoise (no shell, head on top, ledger satchel)', fixture('round2-tortoise-noshell.code.txt'), template, { species: true })
  await refused('round 2 mouse (a bear in a cap with a mail bag)', fixture('round2-mouse-teddy.code.txt'), template, { species: true, accent: '#3d7cc8' })

  // Role mark (round 4): tagged with villager.mark() and breaking the outline above or beside the head.
  const toque = /  villager\.mark\(add\(head, new THREE\.CylinderGeometry[^\n]*\n  villager\.mark\(add\(head, new THREE\.SphereGeometry[^\n]*\n/
  if (!toque.test(example)) throw new Error('arm-code.md example no longer marks its toque on two lines')
  // host/src/villager-make.ts stubVillagerMaker: the example given a snout and tall ears, as the setup scene's stand-in.
  const stub = example.replace('\n  villager.add(head)\n', `\n  villager.add(head)
  add(head, new THREE.CapsuleGeometry(0.045, 0.06, 6, 10), felt('#f6e6cc'), 0, -0.06, 0.17).rotation.x = Math.PI / 2
  for (const s of [-1, 1]) add(head, new THREE.CapsuleGeometry(0.03, 0.12, 6, 10), felt('#e2b98a'), s * 0.1, 0.2, -0.02).rotation.z = -s * 0.2
`)
  for (const [name, code, opts] of [['the prompt example (its toque marked), mark on', example, { mark: true }], ['the setup stub (example, snout and tall ears), species and mark on', stub, { species: true, mark: true }]]) {
    const r = await trial(code, opts)
    check(`${name} passes`, r.ok && r.measures.mark.above >= 0.1, r.ok ? r.measures.mark : r.reason)
  }
  await refused('a sound probe cook with no marked part', plush(), /nothing is tagged as the cook's toque.*villager\.mark\(\)/, { mark: true })
  const pouch = example.replace(toque, `  villager.mark(add(villager, new THREE.BoxGeometry(0.1, 0.08, 0.06), felt('#8a6a4a'), 0.12, 0.12, 0.12))\n`)
  await refused('the example with a hip pouch as its mark (inside the outline)', pouch, /the cook's toque stays inside the outline seen from in front and above/, { mark: true })
  await refused('the example with its whole head marked', example.replace("villager.tag(new THREE.Group(), 'head')", "villager.mark(villager.tag(new THREE.Group(), 'head'))"), /the head itself is tagged with villager\.mark\(\); tag only the cook's toque/, { mark: true })
  // Setup's live run (giraffe, carer): the largest head part was taken to be the head even when it was the hat.
  // The head is now the largest unmarked head part; a marked part is the head when it holds an eye's centre.
  const headSphere = 'add(head, new THREE.SphereGeometry(0.164, 32, 20), tan, 0, 0, 0)'
  const bodySphere = 'add(villager, new THREE.SphereGeometry(0.2, 32, 20), tan, 0, 0.146, 0)'
  if (!example.includes(headSphere) || !example.includes(bodySphere)) throw new Error('arm-code.md example no longer has its head and body spheres as written here')
  const bigCap = example.replace(toque, `  villager.mark(add(head, new THREE.ConeGeometry(0.2, 0.25, 24), white, 0, 0.2, -0.01))\n`)
  const big = await trial(bigCap, { mark: true })
  check('a tall stocking cap bigger than the head it sits on passes the mark check (it is a hat, not the head)', big.ok && big.measures.mark.core === null && big.measures.mark.above >= 0.1, big.ok ? big.measures.mark : big.reason)
  await refused('the example with only its head sphere marked (it holds the eyes)', example.replace(headSphere, `villager.mark(${headSphere})`), /the head itself is tagged with villager\.mark\(\); tag only the cook's toque, not the head/, { mark: true })
  await refused('the example with its body marked', example.replace(bodySphere, `villager.mark(${bodySphere})`), /the body itself is tagged with villager\.mark\(\); tag only the cook's toque, not the body/, { mark: true })
  await refused('a marked cap bigger than the rest of the villager', example.replace(toque, `  villager.mark(add(head, new THREE.ConeGeometry(0.3, 0.3, 24), white, 0, 0.2, -0.25))\n`).replace('CylinderGeometry(0.008, 0.01, 0.2, 8)', 'CylinderGeometry(0.008, 0.01, 0.3, 8)'), /^check: the parts tagged with villager\.mark\(\) are \d+% of the villager; tag only the cook's toque, at most 40% of it$/, { mark: true })

  // Sentinel (round 2): a huge untrusted name is cut before any work on it, so it costs no more than a short one.
  const huge = await page.evaluate(async () => {
    const { check } = await import('/src/villagers/gen/build.ts')
    const name = ' x'.repeat(16 * 1024 * 1024)
    const t0 = performance.now()
    const r = check({ name, role: 'x'.repeat(1e6), bark: name })
    return { ms: Math.round(performance.now() - t0), name: r.spec.name.length, bark: r.spec.bark.length, longestFix: Math.max(...r.fixes.map((f) => f.length)) }
  })
  check('a 32M-character name and bark are cut short in under 50 ms', huge.ms < 50 && huge.name <= 40 && huge.bark <= 200 && huge.longestFix < 120, huge)
  // Persona (#47 on #42's schema): the page keeps only a persona of the persona.json shape, for display; the
  // host's checkPersona is the authority. A hostile one is left out in flat time; crude is never a persona's lean.
  const persona = await page.evaluate(async ([block]) => {
    const { check, personaShape } = await import('/src/villagers/gen/build.ts')
    const long = ' y'.repeat(8 * 1024 * 1024)
    const t0 = performance.now()
    const hostile = check({ persona: { name: 'Bad', role: long, speciality: long, temperament: 'hyper', register: { evil: 1 }, humour: 'deadpan', quirks: Array(1e6).fill(long), cares: 'not a list', lengths: { card: 9 } } })
    const ms = Math.round(performance.now() - t0)
    const good = JSON.parse(block)
    return {
      ms, hostile: hostile.spec.persona === undefined && hostile.fixes.some((f) => /persona: not in the persona\.json shape/.test(f)),
      example: personaShape(good)?.name ?? null,
      crude: personaShape({ ...good, humour: { style: 'x', lean: 'crude' } }),
      oldShape: personaShape({ role: 'Fixes things', speciality: 'Hinges', temperament: 'wry', register: 'casual', humour: 'dry', quirks: [], topics: ['doors'], dials: { warmth: 0.5, playful: 0.5, chatty: 0.5, humour: 'crude' } }),
      none: check({}).spec.persona === undefined,
    }
  }, [/Its persona block, after the module:\n```json\n([\s\S]*?)\n```/.exec(readFileSync(join(here, 'villagers/arm-code.md'), 'utf8'))[1]])
  check('a hostile persona is left out of the spec, with a fix, in under 50 ms', persona.ms < 50 && persona.hostile && persona.none, persona)
  check('arm-code.md\'s persona block example is in the persona.json shape', persona.example === 'Dumpling', persona)
  check('a crude lean, or the old dials shape, is never kept on the page', persona.crude === null && persona.oldShape === null, persona)
  check('no page errors', errors.length === 0, errors)
} finally {
  await browser.close()
}
const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length} of ${checks.length} passed`)
process.exit(failed.length ? 1 : 0)
