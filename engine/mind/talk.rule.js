// People answer by default (#264). This is a rule like any other, kept with the engine as text: a world that has
// no rule of its own for talk is given it under the id "talk", and a world's own rule replaces it by taking that
// id, or by listening for 'thought' itself (this one then stands back). Nothing in the engine knows what it does.
//
// Someone at a page or in a seat speaks; the nearest of the town's residents within earshot of an ordinary voice
// stops, turns, and answers as whoever they are. Left alone for a while they go back to their round. What they
// were told before, the world remembers for them.
const NEAR = 90, QUIET = 25, HELD_MOST = 6
const NAMES = ['Ana', 'Bao', 'Cleo', 'Dev', 'Edda', 'Faro', 'Gus', 'Hana', 'Ivo', 'June', 'Kofi', 'Lena', 'Milo', 'Nour', 'Otis', 'Pia', 'Quin', 'Rosa', 'Sami', 'Tess', 'Ugo', 'Vera', 'Wim', 'Yara']
const TRADES = ['a nurse coming off a night shift', 'a plumber between two jobs', 'a retired teacher out for a walk', 'a courier with a parcel to deliver', 'a cook on the way to open a kitchen', 'a student late for a class', 'an electrician looking for an address', 'a shopkeeper from a few doors down', 'a carpenter carrying a bag of tools', 'a bus driver on a day off', 'a gardener who looks after the trees here', 'a bookkeeper on a lunch break']
const MANNERS = ['dry and quick', 'warm and talkative', 'polite but in a hurry', 'calm and a little amused', 'blunt, not unkind', 'shy at first, then friendly', 'cheerful', 'tired but patient']
const pick = (list, id, salt) => { let h = salt; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return list[h % list.length] }
const far = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])

on('said', (world, e) => {
  // With nobody's model to answer, nobody is stopped in the street: the town goes about its day as it did.
  // And a world whose own rules hear thoughts sees to its own talk.
  if (!world.voiced || world.others.includes('thought')) return
  const speaker = world.people.find((p) => p.id === e.by)
  if (!speaker || speaker.kind === 'actor') return
  const held = world.keep.held || (world.keep.held = {})
  // Whoever of ours is nearest and not already thinking; else the nearest resident, taken for a while.
  let id = null, best = NEAR
  for (const p of world.people) if (p.mine && !p.thinking && far(p.at, e.at) < best) { id = p.id; best = far(p.at, e.at) }
  if (!id && Object.keys(held).length < HELD_MOST) {
    let r = null
    for (const o of world.residents) if (far(o.at, e.at) < best) { r = o; best = far(o.at, e.at) }
    if (!r) return
    id = r.id
    world.actor(id, { take: r.id, name: pick(NAMES, id, 7) })
  }
  if (!id) return
  held[id] = world.now
  world.actor(id, { to: null, face: e.at })
  world.think(id, { who: 'Someone who lives in this town: ' + pick(TRADES, id, 3) + ', ' + pick(MANNERS, id, 5) + '. Their name is ' + pick(NAMES, id, 7) + '. They were walking somewhere when they were spoken to, and answer as people do in the street: briefly.', where: 'out on a street of the town they live in', heard: e.text, from: e.name })
})
on('thought', (world, e) => {
  const held = world.keep.held || {}
  // Nobody to answer for them (no helper is running): they walk on, as someone who did not catch it would.
  if (e.failed && held[e.id] !== undefined) { delete held[e.id]; world.gone(e.id) }
  else if (held[e.id] !== undefined) held[e.id] = world.now
})
on('tick', (world) => {
  const held = world.keep.held || {}
  for (const id of Object.keys(held)) {
    const p = world.people.find((p) => p.mine && p.id === id)
    if (!p) delete held[id]
    else if (!p.thinking && world.now - held[id] > QUIET) { delete held[id]; world.gone(id) }
  }
})
