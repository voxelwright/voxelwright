// Headless proof of the generated-villager checks (#47 round 2, src/villagers/gen/checks.ts):
// the hand-made three, their specs, the prompt's own example and a round-1 frog pass; a scarf
// across the face (round 1's bear and a synthetic one), a sun-hat brim hiding the eyes from the
// dollhouse camera (round 2's first frog), a floating head, a speck of a prop and a
// too-wide body are refused with a plain reason. Also the spec checker cuts a huge untrusted name
// before working on it (Sentinel, round 2).
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
  const trial = (code) => page.evaluate((c) => window.villagerGen.trial(c), code)

  // Passing: the hand-made plush, their specs, the prompt's example, a sound probe and a round-1 frog.
  for (const id of ['hand:dumpling', 'hand:tuft', 'hand:moss', 'spec:dumpling', 'spec:tuft', 'spec:moss']) {
    const r = await page.evaluate((i) => window.villagerGen.audit(i), id)
    check(`${id} passes every check`, r.failures.length === 0, r.failures.length ? r.failures : r.measures)
  }
  for (const [name, code] of [['the prompt example (Dumpling with a toque)', example], ['a sound probe cook', plush()], ['round 1 frog (code-5)', fixture('round1-frog.code.txt')]]) {
    const r = await trial(code)
    check(`${name} passes`, r.ok, r.ok ? r.measures : r.reason)
    if (code === example) check('the prompt example comes back with a whole persona', r.persona?.temperament === 'warm' && r.persona.quirks.length === 2 && r.persona.topics.length === 3 && r.persona.dials.warmth === 0.8, r.persona)
  }

  // Failing, each with a reason a model can act on.
  const refused = async (name, code, pattern) => {
    const r = await trial(code)
    check(`${name} is refused`, !r.ok && pattern.test(r.reason), r.reason ?? r.measures)
  }
  await refused('round 1 bear (code-3, scarf ring across the face)', fixture('round1-bear.code.txt'), /eye is hidden from the front/)
  await refused('a scarf ring across the eyes', plush({ scarfY: 0.43 }), /eye is hidden from the front behind a #c8553d body part/)
  await refused('a level sun-hat brim over the eyes (round 2 first pass, frog)', fixture('round2a-frog-brim.code.txt'), /eye is hidden from the dollhouse view/)
  await refused('a head lifted 0.12 off the body', plush({ lift: 0.12 }), /float.* free of the rest/)
  await refused('a spoon at a fifth of its size', plush({ prop: 0.2 }), /held prop .* too small to read/)
  await refused('a body stretched three times as wide', plush({ wide: 3 }), /wide and only .* tall/)

  // Sentinel (round 2): a huge untrusted name is cut before any work on it, so it costs no more than a short one.
  const huge = await page.evaluate(async () => {
    const { check } = await import('/src/villagers/gen/build.ts')
    const name = ' x'.repeat(16 * 1024 * 1024)
    const t0 = performance.now()
    const r = check({ name, role: 'x'.repeat(1e6), bark: name })
    return { ms: Math.round(performance.now() - t0), name: r.spec.name.length, bark: r.spec.bark.length, longestFix: Math.max(...r.fixes.map((f) => f.length)) }
  })
  check('a 32M-character name and bark are cut short in under 50 ms', huge.ms < 50 && huge.name <= 40 && huge.bark <= 200 && huge.longestFix < 120, huge)
  // Persona (#47): every string and list is capped, enums and dials are checked, and the cost stays flat.
  const persona = await page.evaluate(async () => {
    const { check } = await import('/src/villagers/gen/build.ts')
    const long = ' y'.repeat(8 * 1024 * 1024)
    const t0 = performance.now()
    const r = check({ persona: { role: long, speciality: long, temperament: 'hyper', register: { evil: 1 }, humour: 'deadpan', quirks: Array(1e6).fill(long), topics: 'not a list', dials: { warmth: 7, playful: -1, chatty: 'x' } } })
    const p = r.spec.persona
    return { ms: Math.round(performance.now() - t0), role: p.role.length, speciality: p.speciality.length, temperament: p.temperament, register: p.register, humour: p.humour, quirks: p.quirks.length, quirk: p.quirks[0].length, topics: p.topics.length, dials: p.dials, none: check({}).spec.persona === undefined }
  })
  check('a hostile persona is capped, deduplicated and checked in under 50 ms', persona.ms < 50 && persona.role <= 64 && persona.speciality <= 80 && persona.quirks === 1 && persona.quirk <= 60 && persona.topics === 0 && persona.temperament === 'calm' && persona.register === 'plain' && persona.humour === 'deadpan' && persona.dials.warmth === 1 && persona.dials.playful === 0 && persona.dials.chatty === 0.4 && persona.none, persona)
  // Crude humour (templates.ts gatePersona): only a known adult who opted in keeps it; a template or the model cannot grant it.
  const gate = await page.evaluate(async () => {
    const { check } = await import('/src/villagers/gen/build.ts')
    const { BUILTIN_TEMPLATES, applyTemplate, gatePersona, templatesFor } = await import('/src/villagers/gen/templates.ts')
    const model = check({ persona: { role: 'Fixes things', speciality: 'Hinges', temperament: 'wry', register: 'casual', humour: 'dry', quirks: [], topics: ['doors'], dials: { warmth: 0.5, playful: 0.5, chatty: 0.5, humour: 'crude' } } }).spec.persona
    const buddy = applyTemplate({ ...model, dials: { ...model.dials, humour: 'clean' } }, BUILTIN_TEMPLATES.find((t) => t.id === 'buddy'))
    const out = {}
    for (const [name, p] of [['model', model], ['template', buddy]]) for (const [who, profile] of [['child', { adult: false, crudeOptIn: true }], ['unknown', null], ['adult', { adult: true, crudeOptIn: false }], ['adult opted in', { adult: true, crudeOptIn: true }]]) out[`${name}, ${who}`] = gatePersona(p, profile).dials.humour
    return { out, merged: { topics: buddy.topics, speciality: buddy.speciality, temperament: buddy.temperament, playful: buddy.dials.playful }, child: templatesFor({ adult: false, crudeOptIn: false }).map((t) => t.id), unknown: templatesFor(null).map((t) => t.id) }
  })
  const g = gate.out
  check('a model or template saying crude comes out cheeky for a child, an unknown profile or an adult who did not opt in', ['model', 'template'].every((n) => g[`${n}, child`] === 'cheeky' && g[`${n}, unknown`] === 'cheeky' && g[`${n}, adult`] === 'cheeky'), g)
  check('an adult who opted in keeps crude', g['model, adult opted in'] === 'crude' && g['template, adult opted in'] === 'crude', g)
  check('a template wins on temperament and dials; the description keeps speciality and topics', gate.merged.temperament === 'wry' && gate.merged.playful === 0.8 && gate.merged.speciality === 'Hinges' && gate.merged.topics[0] === 'doors', gate.merged)
  check('the adult-only template is not offered for a child or an unknown profile', !gate.child.includes('buddy') && !gate.unknown.includes('buddy') && gate.child.includes('companion') && !gate.unknown.includes('companion'), { child: gate.child, unknown: gate.unknown })
  check('no page errors', errors.length === 0, errors)
} finally {
  await browser.close()
}
const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length} of ${checks.length} passed`)
process.exit(failed.length ? 1 : 0)
