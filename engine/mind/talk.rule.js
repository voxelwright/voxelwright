// People answer by default (#264, #164). This is a rule like any other, kept with the engine as text: a world
// that has no rule of its own for talk is given it under the id "talk", and a world's own rule replaces it by
// taking that id, or by listening for 'thought' itself (this one then stands back). Nothing in the engine knows
// what it does.
//
// Hybrid Classical <-> LLM street talk:
// - Quick trivial greets/antagonizes/defuses and unvoiced worlds resolve in 0 ms with contextual fast barks and
//   per-pair trust memory in `world.keep.mem`.
// - Open-ended speech and escalated confrontations hand off to `world.think` with compact Blackboard context
//   (`district`, `activity`, `mood`, `reputation`) and request behavioral notes (`mood`, `intent`, `trust_delta`),
//   then execute the returned classical action (`flee`, `follow`, `confront`, `report`, `help`) cleanly.
const NEAR = 90, QUIET = 25, HELD_MOST = 6, MEM_MOST = 32
const NAMES = ['Ana', 'Bao', 'Cleo', 'Dev', 'Edda', 'Faro', 'Gus', 'Hana', 'Ivo', 'June', 'Kofi', 'Lena', 'Milo', 'Nour', 'Otis', 'Pia', 'Quin', 'Rosa', 'Sami', 'Tess', 'Ugo', 'Vera', 'Wim', 'Yara']
const TRADES = ['a nurse coming off a night shift', 'a plumber between two jobs', 'a retired teacher out for a walk', 'a courier with a parcel to deliver', 'a cook on the way to open a kitchen', 'a student late for a class', 'an electrician looking for an address', 'a shopkeeper from a few doors down', 'a carpenter carrying a bag of tools', 'a bus driver on a day off', 'a gardener who looks after the trees here', 'a bookkeeper on a lunch break']
const MANNERS = ['dry and quick', 'warm and talkative', 'polite but in a hurry', 'calm and a little amused', 'blunt, not unkind', 'shy at first, then friendly', 'cheerful', 'tired but patient']
const FAST_BARKS = {
  greet: ['Hey there! Nice seeing a friendly face.', 'Morning—how is it going?', 'Good to see you out here.'],
  greet2: ['Haha, appreciate the good energy! Take care.', 'Always nice to share a word on this block.', 'You are alright—have a good one!'],
  antagonize: ['Whoa, easy there—watch your tone.', 'Hey, no need for that. Keep walking.', 'Back off, I am not looking for trouble.'],
  antagonize2: ['Last warning—leave me alone or I am calling this in!', 'Step back right now!'],
  defuse: ['Alright, no harm done. Take it easy.', 'Fair enough—let us both move on.'],
  unvoiced: ['Sorry, in a bit of a hurry right now.', 'Nice day for a walk, huh?', 'Catch you around the block.'],
}
const BEHAVIOR_ASK = {
  mood: { ask: 'how the person feels now after what was heard', is: ['calm', 'warm', 'wary', 'annoyed', 'angry', 'alarmed'] },
  intent: { ask: 'what physical action the person chooses to take next', is: ['stay', 'flee', 'follow', 'report', 'confront', 'help', 'use_object'] },
  trust_delta: { ask: 'how much their trust in the speaker changes (-2 to 2)', is: [-2, 2] },
}
const pick = (list, id, salt) => { let h = salt; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return list[h % list.length] }
const far = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const heldTime = (entry) => (typeof entry === 'number' ? entry : entry && typeof entry.t === 'number' ? entry.t : 0)
const socialKind = (raw) => {
  const s = String(raw || '').toLowerCase().replace(/[.!?]+$/g, '').trim()
  if (/^(hi|hey|hello|howdy|yo|morning|good morning|afternoon|evening|hey there|sup)$/.test(s)) return 'greet'
  if (/^(sorry|my bad|excuse me|pardon|chill|my mistake|no trouble)$/.test(s)) return 'defuse'
  if (/^(get lost|shut up|back off|watch it|beat it|move it|out of my way|buzz off|scram)$/.test(s)) return 'antagonize'
  return null
}
const memOf = (world, id, by) => {
  const mem = world.keep.mem || (world.keep.mem = {})
  const key = id + '|' + by
  if (!mem[key]) {
    const keys = Object.keys(mem)
    if (keys.length >= MEM_MOST) delete mem[keys[0]]
    mem[key] = { trust: 0, mood: 'calm', mode: 'neutral', step: 0, t: world.now }
  }
  return mem[key]
}

on('said', (world, e) => {
  // A world whose own rules hear thoughts sees to its own talk.
  if (world.others.includes('thought')) return
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
  held[id] = { t: world.now, by: e.by }
  const rec = memOf(world, id, e.by)
  if (world.now - rec.t > 30) { rec.mode = 'neutral'; rec.step = 0 }
  rec.t = world.now

  const quick = socialKind(e.text)
  // Fast 0 ms contextual bark path: when unvoiced, or on early trivial greet/antagonize/defuse steps.
  if (!world.voiced || quick) {
    let act = quick
    if (act === 'defuse' || (act === 'greet' && rec.mode === 'antagonize')) {
      rec.mode = 'neutral'; rec.step = 0; rec.trust = clamp(rec.trust + 1, -10, 10); rec.mood = 'calm'
      world.actor(id, { to: null, face: e.at, say: pick(FAST_BARKS.defuse, id, 11) })
      return
    }
    if (act === 'greet') {
      rec.mode = 'greet'; rec.step = Math.min(3, rec.step + 1)
      if (!world.voiced || rec.step < 3) {
        rec.trust = clamp(rec.trust + (rec.step === 2 ? 2 : 1), -10, 10)
        rec.mood = rec.step >= 2 ? 'warm' : 'calm'
        const line = pick(rec.step === 2 ? FAST_BARKS.greet2 : FAST_BARKS.greet, id, 13 + rec.step)
        world.actor(id, { to: null, face: e.at, say: line })
        return
      }
    } else if (act === 'antagonize') {
      rec.mode = 'antagonize'; rec.step = Math.min(3, rec.step + 1)
      if (!world.voiced || rec.step < 2) {
        rec.trust = clamp(rec.trust - (rec.step + 1), -10, 10)
        rec.mood = rec.step >= 2 ? 'angry' : 'annoyed'
        const line = pick(rec.step >= 2 ? FAST_BARKS.antagonize2 : FAST_BARKS.antagonize, id, 17 + rec.step)
        const move = rec.step >= 2 ? { to: null, face: e.at, move: 'yell', say: line } : { to: null, face: e.at, say: line }
        if (!world.voiced && rec.step >= 3) world.actor(id, { pace: 55, flee: e.by, keep: 180, say: line })
        else world.actor(id, move)
        return
      }
    } else if (!world.voiced) {
      world.actor(id, { to: null, face: e.at, say: pick(FAST_BARKS.unvoiced, id, 23) })
      return
    }
  }

  world.actor(id, { to: null, face: e.at })
  const district = (world.realm && world.realm.name) ? world.realm.name : 'street'
  const rep = 'trust ' + (rec.trust >= 0 ? '+' : '') + rec.trust
  world.think(id, {
    who: 'Someone who lives here: ' + pick(TRADES, id, 3) + ', ' + pick(MANNERS, id, 5) + '. Their name is ' + pick(NAMES, id, 7) + '. They were walking somewhere when they were spoken to, and answer as people do in the street: briefly.',
    where: 'out in the street, on the way somewhere',
    context: { district: district, activity: 'walking in the street', mood: rec.mood || 'calm', reputation: rep },
    heard: e.text,
    from: e.name,
    notes: BEHAVIOR_ASK,
  })
})
on('thought', (world, e) => {
  const held = world.keep.held || {}
  // Nobody to answer for them (no helper is running): they walk on, as someone who did not catch it would.
  if (e.failed && held[e.id] !== undefined) { delete held[e.id]; world.gone(e.id); return }
  if (held[e.id] === undefined) return
  const by = typeof held[e.id] === 'object' ? held[e.id].by : ''
  held[e.id] = { t: world.now, by: by }
  const notes = e.notes || {}
  if (by) {
    const rec = memOf(world, e.id, by)
    if (typeof notes.trust_delta === 'number') rec.trust = clamp(rec.trust + notes.trust_delta, -10, 10)
    if (typeof notes.mood === 'string') rec.mood = notes.mood
    rec.t = world.now
  }
  const speaker = by ? world.people.find((p) => p.id === by) : null
  if (!speaker) return
  if (notes.intent === 'flee') world.actor(e.id, { pace: 55, flee: by, keep: 180 })
  else if (notes.intent === 'follow') world.actor(e.id, { pace: 26, follow: by, keep: 20 })
  else if (notes.intent === 'confront') world.actor(e.id, { to: null, face: speaker.at, move: 'yell' })
  else if (notes.intent === 'report') world.actor(e.id, { pace: 48, flee: by, keep: 200 })
  else if (notes.intent === 'help') world.actor(e.id, { to: null, face: speaker.at, move: 'wave' })
})
on('tick', (world) => {
  const held = world.keep.held || {}
  for (const id of Object.keys(held)) {
    const p = world.people.find((p) => p.mine && p.id === id)
    if (!p) delete held[id]
    else if (!p.thinking && world.now - heldTime(held[id]) > QUIET) { delete held[id]; world.gone(id) }
  }
})
