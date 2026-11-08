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
// Round 5 (the mark is the owner's colour): a thin pencil mark is refused for too little owner colour, a prop
// beside the hand is refused, the prompt's bent-cone cap is one piece, the marked toque is dyed in the accent,
// and an orange body under a blue owner is moved off the owners' colours while a tan one is left alone.
// Round 6 (marks told apart by place, and sitting on what holds them): the example's pleated toque, a duster held
// out beside the head, a mortarboard lying on a skullcap and the prompt's blunt-ended cap pass; round 5's squat
// toque, an off-centre toque, a plume over the head, a board on a stalk or floating over its cap, a pom-pom off
// the tip, and round 5's own sheep (pom-pom on a needle point), ox (lens off its arm) and elephant (board on a
// tall band) are refused, each naming the mark.
// Round 7 (appeal): a mortarboard 1.2 head widths across and a sun hat 1.75 across, tilted back, pass with the face clear
// 20 degrees steeper than the dollhouse view, and a duster of 5 feathers on a knot passes; a board or brim too wide or too
// small, a hat that clears the eyes only 15 degrees steeper, a one-ball plume, and round 6's elephant (board 1.47), hippo
// (brim 2.10) and hedgehog (one-ball plume) and round 5's giraffe (one-ball plume) are refused, each naming the mark.
// The felt kit as the default (kit council, November 7): checks.ts now guards the kit's own marks, so the mark tests
// above run on the round-7 prompt (fixtures/round7-arm-code.md) with the kit off. With it on, the new prompt example marks
// only an anchor and passes in every role but the tidier's (it holds a spoon, not a duster), the setup stub's tall ears
// get stitched holes in the board and the sun hat, the requested role wins over the model's about() with a fix line, a
// marked head is refused with the anchor named, a spoon 6 cm off the mitten is moved into it and wrapped, and a duster
// handle held up beside the head gets the kit's plume.
// The sewn skin as the default (skin council): the spiny hedgehog sews with no specks and no inward triangle (an inward
// triangle is culled and showed as a pale fleck), a ball that breaks the head's surface by a few millimetres leaves no
// speck of its felt, a tutor's skullcap is fitted to the skin with the board resting on it across at least half its
// width and every mark part held on the skin, the toque never slides onto the brow, and &skin=0 still builds the parts.
// Usage: node scripts/check-villager-gen.mjs [base-url]   (dev server running; default http://localhost:5332/)
// Exits non-zero when any check fails.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.argv[2] ?? 'http://localhost:5332/'
const fixture = (name) => readFileSync(join(here, 'villagers/fixtures', name), 'utf8')
const exampleOf = (md) => md.split('Example (')[1].match(/export default function \(villager, api\) \{[\s\S]*?\n\}/)[0]
/** The round-7 prompt, whose example builds its own toque: the checks on a model-built mark are tested on it, kit off. */
const round7 = readFileSync(join(here, 'villagers/fixtures/round7-arm-code.md'), 'utf8')
const example = exampleOf(round7)
/** Today's prompt: the example marks only an anchor, and the felt kit sews the mark. */
const kitExample = exampleOf(readFileSync(join(here, 'villagers/arm-code.md'), 'utf8'))

const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass) })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

/**
 * A small plush cook, sound by default. Options break one thing each:
 * scarfY moves the scarf ring (0.43 is across the eyes), lift raises the head and eyes,
 * prop scales the held spoon, wide stretches the body sideways, off moves the spoon forward out of the hand,
 * nub (the sewn skin) sets a brown ball in the back of the head that breaks the surface by a few millimetres: a fleck of felt.
 */
const plush = ({ scarfY = 0.27, lift = 0, prop = 1, wide = 1, off = 0, nub = 0 } = {}) => `export default function (villager, { THREE }) {
  const felt = (c, r = 1) => new THREE.MeshStandardMaterial({ color: c, roughness: r })
  const at = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m }
  at(villager, new THREE.SphereGeometry(0.17, 20, 12), felt('#c9a27a'), 0, 0.17, 0).scale.set(${wide}, 1, 1)
  const scarf = at(villager, new THREE.TorusGeometry(0.13, 0.03, 8, 24), felt('#c8553d'), 0, ${scarfY}, 0.02)
  scarf.rotation.x = Math.PI / 2
  const head = villager.tag(new THREE.Group(), 'head')
  head.position.set(0, ${0.42 + lift}, 0)
  villager.add(head)
  at(head, new THREE.SphereGeometry(0.13, 20, 12), felt('#c9a27a'), 0, 0, 0)
  if (${nub}) at(head, new THREE.SphereGeometry(0.05, 16, 10), felt('#7a5a3a'), 0, 0.02, -${nub})
  for (const s of [-1, 1]) {
    villager.tag(at(villager, new THREE.SphereGeometry(0.025, 12, 8), felt('#241a18', 0.25), s * 0.05, ${0.44 + lift}, 0.12), s < 0 ? 'eye-left' : 'eye-right')
    villager.tag(at(villager, new THREE.SphereGeometry(0.035, 12, 8), felt('#c9a27a'), s * 0.17 * ${wide}, 0.18, 0.02), s < 0 ? 'hand-left' : 'hand-right')
    villager.tag(at(villager, new THREE.SphereGeometry(0.04, 12, 8), felt('#c9a27a'), s * 0.08, 0.03, 0.02), s < 0 ? 'foot-left' : 'foot-right')
  }
  const spoon = villager.tag(new THREE.Group(), 'held')
  spoon.position.set(-0.17 * ${wide}, 0.16, ${0.06 + off})
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
  // Kit off unless asked for: most of these test the checks on a model-built mark (the round-7 prompt).
  const trial = (code, opts = {}) => page.evaluate(([c, o]) => window.villagerGen.trial(c, o), [code, { kit: false, ...opts }])

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
  const toque = /  \/\/ The cook's mark[^\n]*\n(?:  [^\n]*\n)*?  villager\.mark\(add\(head, new THREE\.SphereGeometry[^\n]*\n/
  if (!toque.test(example)) throw new Error('arm-code.md example no longer marks its toque as a block from "// The cook\'s mark" to its puff')
  const asRole = (code, role) => code.replace("role: 'cook'", `role: '${role}'`)
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
  const big = await trial(asRole(bigCap, 'carer'), { mark: true })
  check('a tall stocking cap bigger than the head it sits on passes the mark check (it is a hat, not the head)', big.ok && big.measures.mark.core === null && big.measures.mark.above >= 0.1, big.ok ? big.measures.mark : big.reason)
  await refused('the example with only its head sphere marked (it holds the eyes)', example.replace(headSphere, `villager.mark(${headSphere})`), /the head itself is tagged with villager\.mark\(\); tag only the cook's toque, not the head/, { mark: true })
  await refused('the example with its body marked', example.replace(bodySphere, `villager.mark(${bodySphere})`), /the body itself is tagged with villager\.mark\(\); tag only the cook's toque, not the body/, { mark: true })
  await refused('a marked cap bigger than the rest of the villager', example.replace(toque, `  villager.mark(add(head, new THREE.ConeGeometry(0.3, 0.3, 24), white, 0, 0.2, -0.25))\n`).replace('CylinderGeometry(0.008, 0.01, 0.2, 8)', 'CylinderGeometry(0.008, 0.01, 0.3, 8)'), /^check: the parts tagged with villager\.mark\(\) are \d+% of the villager; tag only the cook's toque, at most 40% of it$/, { mark: true })

  // Round 5: the mark is the owner's colour, so it must carry enough of it; props are held; body felt keeps off the owners' hues.
  const pencil = example.replace(toque, `  villager.mark(add(head, new THREE.CylinderGeometry(0.006, 0.006, 0.26, 8), white, 0.14, 0.2, 0)).rotation.z = -0.7\n`)
  await refused('the example with a thin pencil as its mark (too little owner colour)', pencil, /the cook's toque shows only \d+ pixels of the owner's colour from the dollhouse view \(at least 100\)/, { mark: true })
  await refused('a spoon held 6 cm in front of the mitten (it touches the body, not the hand)', plush({ off: 0.06 }), /the held prop near .* does not touch either hand/)
  const capRecipe = /A bent cap in one piece[^\n]*\n\n```js\n([\s\S]*?)```/.exec(round7)?.[1]
  if (!capRecipe) throw new Error('arm-code.md has no bent-cap recipe block')
  const capped = await trial(asRole(example.replace(toque, capRecipe), 'carer'), { mark: true, accent: '#3d7cc8' })
  check('the prompt\'s bent stocking cap is one piece, breaks the outline, and its pom-pom sits on its blunt end', capped.ok && capped.measures.pieces === 1 && capped.measures.mark.above >= 0.1 && capped.measures.ownerPx >= 100 && capped.measures.loose.length === 0, capped.ok ? { pieces: capped.measures.pieces, mark: capped.measures.mark, ownerPx: capped.measures.ownerPx, loose: capped.measures.loose } : capped.reason)
  const dyed = await trial(example, { mark: true, accent: '#3d7cc8' })
  check('the marked toque is dyed in the owner\'s colour and shows from the dollhouse view', dyed.ok && dyed.fixes.includes("mark: 9 part(s) in the owner's colour") && dyed.measures.ownerPx >= 100, dyed.ok ? { fixes: dyed.fixes, ownerPx: dyed.measures.ownerPx } : dyed.reason)
  const orange = await trial(example.replace("tan = felt('#e2b98a')", "tan = felt('#c9793c')"), { mark: true, accent: '#3d7cc8' })
  check('an orange body is moved off the owners\' colours (it is within 30 degrees of Alex\'s rust)', orange.ok && orange.fixes.some((f) => /^felt: #c9793c moved to #[0-9a-f]{6}, off the owners' colours$/.test(f)), orange.ok ? orange.fixes : orange.reason)
  check('a tan body and the wooden spoon are left as written', dyed.ok && !dyed.fixes.some((f) => f.startsWith('felt:')), dyed.fixes)

  // Round 6: the round marks are told apart by place (the toque centred and tall, the plume out beside the head), the
  // board lies on the head, and every marked part sits on what holds it, surface to surface and across more than a point.
  const toqueAt = (x) => `  const shifted = new THREE.Group()\n  shifted.position.x = ${x}\n  head.add(shifted)\n${example.match(toque)[0].replaceAll('villager.mark(add(head,', 'villager.mark(add(shifted,')}`
  const pleated = await trial(example, { mark: true })
  check('the prompt example\'s toque (band, column and puff) is centred, taller than wide, and every part sits on the head', pleated.ok && pleated.measures.place.toque.offset <= 0.15 && pleated.measures.place.toque.ratio >= 1 && pleated.measures.loose.length === 0, pleated.ok ? pleated.measures.place : pleated.reason)
  await refused('the example with round 5\'s toque (a short band and a wide puff)', example.replace(toque, `  // The cook's mark, round 5\n  villager.mark(add(head, new THREE.CylinderGeometry(0.085, 0.08, 0.07, 24), white, 0, 0.16, -0.01))\n  villager.mark(add(head, new THREE.SphereGeometry(0.105, 24, 16), white, 0, 0.25, -0.01)).scale.set(1, 0.85, 1)\n`), /the cook's toque rises only 0\.\d+ times its own width above the top of the head \(at least 1\); make it a tall column on a snug band/, { mark: true })
  await refused('the example with its toque moved 0.1 to one side', example.replace(toque, toqueAt(0.1)), /the cook's toque sits \d+% of the head's width off the head's centre \(at most 15%\)/, { mark: true })
  await refused('round 5\'s badger cook (its toque a band and a wide puff)', fixture('round5-badger-toque.code.txt'), /the cook's toque rises only 0\.8\d times its own width/, { mark: true, species: true, accent: '#c8553d' })
  // A tidier: the example's spoon swapped for a duster on a long handle, the toque taken off.
  const duster = (tilt, length, tufts = true) => asRole(example.replace(toque, '').replace(/  const spoon = villager\.tag[\s\S]*?\n  villager\.gait/, `  const duster = villager.tag(new THREE.Group(), 'held')
  duster.position.set(-0.196, 0.158, 0.02)
  duster.rotation.z = ${tilt}
  villager.add(duster)
  add(duster, new THREE.CylinderGeometry(0.01, 0.012, ${length}, 8), felt('#a8703a'), 0, ${length / 2}, 0)
  villager.mark(add(duster, new THREE.SphereGeometry(0.03, 14, 10), white, 0, ${length}, 0))
${tufts ? `  for (let k = 0; k < 5; k++) {
    const a = (k - 2) * 0.35
    villager.mark(add(duster, new THREE.CapsuleGeometry(0.022, 0.09, 6, 10), white, -0.055 * Math.sin(a), ${length} + 0.055 * Math.cos(a), 0)).rotation.z = a
  }` : `  villager.mark(add(duster, new THREE.SphereGeometry(0.07, 18, 12), white, 0, ${length + 0.03}, 0))`}
  villager.gait`), 'tidier')
  const beside = await trial(duster(0.35, 0.3), { mark: true, accent: '#e0b53a' })
  check('a duster of 5 feathers fanned from a knot, held up beside the head, passes, its plume well out from the head\'s centre', beside.ok && beside.measures.place.plume.offset >= 0.75 && beside.measures.place.plume.parts === 6 && beside.measures.loose.length === 0, beside.ok ? beside.measures.place : beside.reason)
  await refused('a duster whose plume is one ball on a knot (a lollipop)', duster(0.35, 0.3, false), /the tidier's feather duster plume is only 2 pieces, so it reads as a lollipop; make it 5 to 7 feathers/, { mark: true, accent: '#e0b53a' })
  await refused('round 6\'s hedgehog tidier (its plume one ball)', fixture('round6-hedgehog-duster.code.txt'), /the tidier's feather duster plume is (one piece|only \d pieces), so it reads as a lollipop/, { mark: true, species: true, accent: '#e0b53a' })
  await refused('a duster held over the middle of the head', duster(-0.55, 0.45), /the tidier's feather duster plume's centre is only \d+% of the head's width out from the head's centre \(at least 75%\)/, { mark: true, accent: '#e0b53a' })
  await refused('round 5\'s giraffe tidier (its plume held out beside the head, but one ball)', fixture('round5-giraffe-duster.code.txt'), /the tidier's feather duster plume is (one piece|only \d pieces), so it reads as a lollipop/, { mark: true, species: true, accent: '#6a9a4a' })
  // A tutor: a skullcap hugging the head, a board lying on it, a tassel off one corner.
  const tutor = ({ cap = 0.04, capY = 0.14, boardY = 0.17, board = 0.42 } = {}) => asRole(example.replace(toque, `  // The tutor's mark
  villager.mark(add(head, new THREE.CylinderGeometry(0.12, 0.14, ${cap}, 24), white, 0, ${capY}, -0.01))
  villager.mark(add(head, new THREE.BoxGeometry(${board}, 0.02, ${board}), white, 0, ${boardY}, -0.01))
  villager.mark(add(head, new THREE.CylinderGeometry(0.008, 0.008, 0.1, 8), white, ${board / 2 - 0.01}, ${boardY - 0.05}, ${board / 2 - 0.02}))
`), 'tutor')
  const worn = await trial(tutor(), { mark: true, accent: '#6a9a4a' })
  check('a mortarboard 1.2 head widths across, lying on a skullcap, passes with the face clear from above', worn.ok && worn.measures.place.board.lift <= 0.05 && worn.measures.place.board.width >= 1.1 && worn.measures.place.board.width <= 1.3 && worn.measures.loose.length === 0 && Math.min(...worn.measures.faceMargin) >= 0.34, worn.ok ? { place: worn.measures.place, loose: worn.measures.loose, faceMargin: worn.measures.faceMargin } : worn.reason)
  // Round 7: the board and the brim in proportion to the head, and the face clear of the mark with room to spare.
  await refused('a mortarboard 1.7 head widths across (a slab over the head)', tutor({ board: 0.6 }), /the tutor's mortarboard's board is 1\.\d+ times the head's width across \(at most 1\.4\), a flat slab that hides the head from above/, { mark: true, accent: '#6a9a4a' })
  await refused('a mortarboard 0.85 head widths across (a cap)', tutor({ board: 0.3 }), /the tutor's mortarboard's board is only 0\.\d+ times the head's width across \(at least 1\)/, { mark: true, accent: '#6a9a4a' })
  await refused('round 6\'s elephant tutor (its board 1.47 head widths across)', fixture('round6-elephant-board.code.txt'), /the tutor's mortarboard's board is 1\.4\d times the head's width across \(at most 1\.4\)/, { mark: true, species: true, accent: '#6a9a4a' })
  // A gardener: a sun hat on the back of the head, a low crown sunk in the head and a brim on it, tilted back.
  const gardener = ({ r = 0.31, tilt = -0.44, y = 0.1, z = -0.05 } = {}) => asRole(example.replace(toque, `  // The gardener's mark
  const hat = new THREE.Group()
  hat.position.set(0, ${y}, ${z})
  hat.rotation.x = ${tilt}
  head.add(hat)
  villager.mark(add(hat, new THREE.CylinderGeometry(${r}, ${r}, 0.016, 40), white, 0, 0.01, 0))
  villager.mark(add(hat, new THREE.SphereGeometry(0.12, 24, 14), white, 0, 0.03, 0)).scale.set(1, 0.6, 1)
`), 'gardener')
  const hat = await trial(gardener(), { mark: true, accent: '#c8553d' })
  check('a sun hat 1.75 head widths across, tilted back, passes with the face clear from above', hat.ok && hat.measures.place.brim.width >= 1.6 && hat.measures.place.brim.width <= 1.9 && Math.min(...hat.measures.faceMargin) >= 0.34, hat.ok ? { place: hat.measures.place, faceMargin: hat.measures.faceMargin } : hat.reason)
  await refused('a sun hat 2.4 head widths across', gardener({ r: 0.425 }), /the gardener's sun hat's brim is 2\.\d+ times the head's width across \(at most 2\), a flat slab that hides the head from above/, { mark: true, accent: '#c8553d' })
  await refused('a sun hat 1.2 head widths across', gardener({ r: 0.21 }), /the gardener's sun hat's brim is only 1\.\d+ times the head's width across \(at least 1\.45\)/, { mark: true, accent: '#c8553d' })
  await refused(`a sun hat tilted back less and worn further forward, clearing the eyes at the dollhouse pitch but not 20 degrees steeper`, gardener({ tilt: -0.3, y: 0.1, z: 0 }), /the gardener's sun hat clears the eyes only up to \d+ degrees steeper than the dollhouse view \(at least 20\)/, { mark: true, accent: '#c8553d' })
  await refused('round 6\'s hippo gardener (its brim 2.1 head widths across, the face clear only 15 degrees steeper)', fixture('round6-hippo-brim.code.txt'), /the gardener's sun hat's brim is 2\.\d+ times the head's width across[\s\S]*clears the eyes only up to 15 degrees steeper/, { mark: true, species: true, accent: '#3d7cc8' })
  await refused('a mortarboard on a tall band (a stalk)', tutor({ cap: 0.14, capY: 0.19, boardY: 0.27 }), /the tutor's mortarboard's board stands 0\.\d+ above the top of the head \(at most 0\.\d+, a twentieth of the height\)/, { mark: true, accent: '#6a9a4a' })
  await refused('a mortarboard floating 0.02 over its skullcap', tutor({ boardY: 0.19 }), /the tutor's mortarboard has a #f4efe4 head part near \(0\.00, 0\.\d+, -0\.01\) standing 0\.0\d+ clear of everything it could sit on \(at most 0\.005, surface to surface\), so it floats; rest the board's underside on the cap band/, { mark: true, accent: '#6a9a4a' })
  await refused('round 5\'s elephant tutor (its board on a band 0.115 of its height tall)', fixture('round5-elephant-board.code.txt'), /the tutor's mortarboard's board stands/, { mark: true, species: true, accent: '#6a9a4a' })
  // The carer: the old recipe's pom-pom on a cone's needle point, the new one's moved off the tip, and round 5's sheep.
  const needle = capRecipe.replace('CylinderGeometry(0.035, 0.1, 0.3, 20, 12)', 'ConeGeometry(0.1, 0.3, 20, 12)').replace('SphereGeometry(0.055,', 'SphereGeometry(0.05,')
  await refused('the round 5 recipe\'s pom-pom on a cone\'s needle point', asRole(example.replace(toque, needle), 'carer'), /the carer's stocking cap has a #9a8a7a head part near \(0\.17, [\d.]+, -0\.02\) that meets what holds it only at a point \(\d+% of its thickness, at least 50%\), so it reads as floating; end the cap before its point/, { mark: true, accent: '#3d7cc8' })
  await refused('the prompt\'s pom-pom moved 0.14 off the cap\'s end', asRole(example.replace(toque, capRecipe.replace('0.17, 0.31, -0.02))', '0.3, 0.36, -0.02))')), 'carer'), /the carer's stocking cap has a #9a8a7a head part near \(0\.30, [\d.]+, -0\.02\) standing 0\.0\d+ clear of everything it could sit on/, { mark: true, accent: '#3d7cc8' })
  await refused('round 5\'s sheep carer (its pom-pom on the cone\'s needle point)', fixture('round5-sheep-pompom.code.txt'), /the carer's stocking cap has a #9a8a7a head part near .* meets what holds it only at a point/, { mark: true, species: true, accent: '#3d7cc8' })
  await refused('round 5\'s ox maker (its lens ring 0.01 off its arm)', fixture('round5-ox-lens.code.txt'), /the maker's swung-up lens has a #ecdfc6 head part near .* standing 0\.0\d+ clear of everything it could sit on.*join the lens ring to its arm/, { mark: true, species: true, accent: '#6a9a4a' })

  // The felt kit, on by default: the model marks an anchor, trusted code sews the mark, the requested role decides it.
  const anchors = (kitExample.match(/villager\.mark\(/g) ?? []).length
  check('today\'s prompt example marks one anchor and builds no mark of its own', anchors === 1 && !/TorusGeometry|ConeGeometry|CylinderGeometry\(0\.0[67]/.test(kitExample), { anchors })
  const kitStub = kitExample.replace('\n  villager.add(head)\n', `\n  villager.add(head)
  add(head, new THREE.CapsuleGeometry(0.045, 0.06, 6, 10), felt('#f6e6cc'), 0, -0.06, 0.17).rotation.x = Math.PI / 2
  for (const s of [-1, 1]) add(head, new THREE.CapsuleGeometry(0.03, 0.12, 6, 10), felt('#e2b98a'), s * 0.1, 0.2, -0.02).rotation.z = -s * 0.2
`)
  for (const role of ['cook', 'tutor', 'gardener', 'carer', 'keeper', 'maker', 'messenger']) {
    const r = await trial(kitExample, { kit: true, mark: true, role, accent: '#3d7cc8' })
    const s = await trial(kitStub, { kit: true, mark: true, species: true, role, accent: '#3d7cc8' })
    const fix = `role: the model declared "cook"; the requested "${role}" is used`
    const swapped = role === 'cook' ? !r.fixes?.some((f) => f.startsWith('role:')) : r.fixes?.includes(fix)
    check(`kit: the example and the setup stub asked for as a ${role} pass with the kit's ${role} mark${role === 'cook' ? '' : ', the requested role over the model\'s'}`, r.ok && s.ok && r.role === role && swapped && r.measures.ownerPx >= 100 && r.measures.loose.length === 0, r.ok && s.ok ? { role: r.role, ownerPx: r.measures.ownerPx, fixes: r.fixes.filter((f) => /^(role|kit: hat)/.test(f)) } : r.reason ?? s.reason)
    if (role === 'tutor' || role === 'gardener') check(`kit: the stub's tall ears come up through stitched holes in the ${role === 'tutor' ? 'mortarboard' : 'sun hat'}`, s.ok && s.fixes.some((f) => /^kit: hat: .*\d+ stitched hole\(s\) for ears/.test(f)), s.ok ? s.fixes.filter((f) => f.startsWith('kit: hat')) : s.reason)
    if (role === 'tutor') check('kit: the board is a cap, about the head\'s width (1.0 to 1.2 head cores) and on the head', s.ok && s.measures.place.board.width >= 1.0 && s.measures.place.board.width <= 1.2 && s.measures.place.board.lift <= 0.02, s.ok ? s.measures.place : s.reason)
  }
  await refused('kit: the example with its whole head marked', kitExample.replace("villager.tag(new THREE.Group(), 'head')", "villager.mark(villager.tag(new THREE.Group(), 'head'))"), /the head itself is tagged with villager\.mark\(\); the home makes the role's mark, so pass villager\.mark\(\) only the small anchor/, { kit: true, mark: true })
  const moved = await trial(plush({ off: 0.06 }), { kit: true })
  check('kit: a spoon held 6 cm in front of the mitten is moved so its handle runs through the mitten, and wrapped', moved.ok && moved.measures.heldInHand && moved.fixes.some((f) => /^kit: held prop moved 0\.0\d+ so its handle runs through the mitten$/.test(f)) && moved.fixes.includes('kit: held prop wrapped in the mitten'), moved.ok ? moved.fixes.filter((f) => f.startsWith('kit: held')) : moved.reason)
  const kitDuster = kitExample.replace(/  const spoon = villager\.tag[\s\S]*?\n  villager\.gait/, `  const duster = villager.tag(new THREE.Group(), 'held')
  duster.position.set(-0.196, 0.158, 0.02)
  duster.rotation.z = 0.35
  villager.add(duster)
  add(duster, new THREE.CylinderGeometry(0.01, 0.012, 0.36, 8), felt('#a8703a'), 0, 0.12, 0)
  villager.mark(add(duster, new THREE.SphereGeometry(0.02, 12, 8), felt('#a8703a'), 0, 0.3, 0))
  villager.gait`)
  const dusted = await trial(kitDuster, { kit: true, mark: true, role: 'tidier', accent: '#e0b53a' })
  check('kit: a duster handle held up beside the head, its knot marked, gets the kit\'s plume out beside the head', dusted.ok && dusted.measures.place.plume.parts >= 6 && dusted.measures.place.plume.offset >= 0.75 && dusted.measures.loose.length === 0, dusted.ok ? dusted.measures.place : dusted.reason)

  // The sewn skin, on by default since the skin council: sound surfaces, and the kit's mark seated on what is shown.
  const spiny = await trial(fixture('round6-hedgehog-duster.code.txt'), { kit: true, mark: true, species: true, role: 'tidier', accent: '#e0b53a', attach: true })
  check('skin: the spiny hedgehog sews with no specks, no triangle facing inwards, its spines as their own pieces, and its plume held', spiny.ok && spiny.measures.skin && spiny.measures.skin.specks === 0 && spiny.measures.skin.inward === 0 && spiny.measures.skin.pieces > spiny.measures.skin.meshes && spiny.measures.loose.length === 0, spiny.ok ? { skin: spiny.measures.skin, loose: spiny.measures.loose } : spiny.reason)
  for (const [name, code] of [['the example', kitExample], ['the setup stub with tall ears', kitStub]]) {
    const r = await trial(code, { kit: true, mark: true, role: 'tutor', accent: '#6a9a4a', attach: true })
    check(`skin: ${name} as a tutor: the skullcap is fitted to the skin and the board rests on it across at least half its width, every mark part held`, r.ok && r.fixes.some((f) => /^skin: the mark seated on the skin, the skullcap fitted to it/.test(f)) && r.measures.place.board.rest >= 0.5 && r.measures.loose.length === 0 && r.measures.skin.inward === 0, r.ok ? { board: r.measures.place.board, loose: r.measures.loose, skin: r.measures.skin } : r.reason)
  }
  const fleck = await trial(plush({ nub: 0.08 }), { kit: true })
  check('skin: a ball breaking the back of the head by a few millimetres leaves no speck of its felt (it takes the felt around it), and the surface faces out', fleck.ok && fleck.measures.skin.specks === 0 && fleck.measures.skin.inward === 0 && fleck.measures.skin.meshes >= 1, fleck.ok ? { skin: fleck.measures.skin, notes: fleck.fixes.filter((f) => f.startsWith('skin: head')) } : fleck.reason)
  // Round ears set back on the crown, so the most room for the toque is forward (the panda's case).
  const earsBack = kitExample.replace('\n  villager.add(head)\n', `\n  villager.add(head)
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.05, 14, 10), felt('#e2b98a'), s * 0.09, 0.13, -0.05)
`)
  const cooked = await trial(earsBack, { kit: true, mark: true, role: 'cook', accent: '#c8553d' })
  check('skin: with round ears set back, the toque slides forward at most 0.1 head depths, not onto the brow', cooked.ok && cooked.fixes.some((f) => /toque moved 0\.10 head depths forward/.test(f)), cooked.ok ? cooked.fixes.filter((f) => f.startsWith('kit: hat')) : cooked.reason)
  const bare = await trial(kitExample, { kit: true, mark: true, role: 'cook', skin: false })
  check('skin: &skin=0 (debugging) still builds the separate parts, with no skin', bare.ok && !bare.fixes.some((f) => f.startsWith('skin:')) && bare.measures.skin === undefined, bare.ok ? bare.fixes.filter((f) => f.startsWith('skin')) : bare.reason)

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
