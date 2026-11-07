// #47 look regroup (screenshots/villager-gen/LEARNING-look.md): the code arm's prompt for each
// strategy, as exact replacements on style.md + arm-code.md. The trusted half lives in
// src/villagers/gen/assemble.ts (Strategy). Every replacement must match once, or the run stops:
// a silent miss would hand every strategy today's scarf prompt.

const RULE3 = /^3\. Colour = owner\..*$/m
const MARK_RULE = 'they rise at least 0.1 H above the top of the head'
const MARK_CHECK = 'they must rise at least 0.1 of the height above the top of the head'
const ACCENT_LINE = /^The owner's accent colour is given with the request: make the scarf.*$/m
const EXAMPLE_SHOWS = 'It shows the API: slots, the scarf, the role mark'
const EXAMPLE_SCARF = /^ {2}const scarf = add\(villager.*\n {2}scarf\.rotation\.x.*\n {2}\/\/ The tails hang.*\n {2}for \(const s of \[-1, 1\]\) add\(villager, new THREE\.CapsuleGeometry.*\n/m
const FACE = 'The home is seen from in front and above, so no brim, hood or hat may hide the eyes from up there either.'

export const STRATEGIES = {
  a: [
    [RULE3, `3. Colour = owner. The owner's accent colour is given to you and is fixed. Wear it as a snug, thick collar round the neck (a torus, tube radius at least 0.028, at the neck below the head) or as a wide band round one upper arm, and nothing else: no tails, ends, ties, knots or anything that hangs. The home removes any owner-colour part that hangs below the chin in front of the face, because at dollhouse distance a strip of colour under the mouth reads as a tongue. If you like, one trim on the role's mark (a hat band) may be that colour too. Nothing else is that colour, and the body felt is never that colour. ${FACE}`],
    [MARK_RULE, `they rise at least 0.15 H above the top of the head. Busy bodies (spines, a shell, wool, a mane) swallow a mark of body size and body colour, so on them make the mark half again as big as the table says, in a felt colour well apart from the body's (cream or dark brown against a mid-tone)`],
    [MARK_CHECK, 'they must rise at least 0.15 of the height above the top of the head'],
    [ACCENT_LINE, "The owner's accent colour is given with the request: make a snug collar round the neck (or a band round one upper arm) in exactly that colour, with nothing hanging from it (and at most one trim on the role's mark), and use it nowhere else."],
    [EXAMPLE_SHOWS, 'It shows the API: slots, the collar, the role mark'],
    [EXAMPLE_SCARF, `  // The owner's collar: snug at the neck, nothing hanging from it.
  const collar = add(villager, new THREE.TorusGeometry(0.15, 0.032, 10, 28), felt('#c8553d'), 0, 0.24, 0)
  collar.rotation.x = Math.PI / 2
`],
  ],
  b: [
    [RULE3, `3. Colour = owner. The owner's accent colour is given to you and is fixed. Wear it as one round felt badge on the front of the chest: a flat disc (CylinderGeometry, radius at least 0.055, about 0.012 thick) facing forward and tipped up about 30 degrees towards the camera above, below the chin and off to one side of the middle, where neither the head nor the held prop covers it from in front and above. No scarf, collar, tie or anything that hangs. Nothing else is that colour, and the body felt is never that colour. Make the role's mark in any plain felt colour: the home recolours it to a tone that stands out from the body. ${FACE}`],
    [ACCENT_LINE, "The owner's accent colour is given with the request: make the round chest badge in exactly that colour, and use it nowhere else. The home picks the role mark's colour itself."],
    [EXAMPLE_SHOWS, 'It shows the API: slots, the chest badge, the role mark'],
    [EXAMPLE_SCARF, `  // The owner's badge: a flat disc on the chest, tipped up to the camera, off to one side, below the chin.
  add(villager, new THREE.CylinderGeometry(0.06, 0.06, 0.012, 24), felt('#c8553d'), 0.07, 0.17, 0.155).rotation.x = Math.PI / 2 - 0.5
`],
  ],
  c: [
    [RULE3, `3. Colour = owner, and the owner's colour is the role's mark. The owner's accent colour is fixed, and the home dyes every part you pass to villager.mark() in it: the mark's shape says the role, its colour says whose villager it is. Make the mark in any felt colour (it is replaced), and pass all of its parts to villager.mark(). No scarf, collar, badge or anything else in the owner's colour, and the body felt is never that colour. ${FACE}`],
    [ACCENT_LINE, "The owner's accent colour is given with the request: do not use it yourself. The home dyes the parts you pass to villager.mark() in it, so mark all of the mark's parts (a toque's band and puff, a lens's ring and its arm) and nothing else."],
    [EXAMPLE_SHOWS, 'It shows the API: slots, the role mark'],
    [EXAMPLE_SCARF, '  // No scarf: the home dyes the toque (villager.mark()) in the owner\'s colour.\n'],
  ],
}

/** The code arm's system prompt for a strategy; unset returns it unchanged. */
export function withStrategy(text, strategy) {
  if (!strategy) return text
  const patches = STRATEGIES[strategy]
  if (!patches) throw new Error(`no strategy "${strategy}" (a, b or c)`)
  for (const [from, to] of patches) {
    const hits = typeof from === 'string' ? text.split(from).length - 1 : (text.match(new RegExp(from.source, `${from.flags}g`)) ?? []).length
    if (hits !== 1) throw new Error(`strategy ${strategy}: ${from} matched ${hits} times, not once`)
    text = text.replace(from, () => to)
  }
  if (strategy !== 'a' && /scarf round the neck|tails hang/.test(text)) throw new Error(`strategy ${strategy}: the prompt still asks for a scarf`)
  return text
}
