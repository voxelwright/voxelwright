// What a realm puts in a person's hands (#264, the HANDS lane): for the world's process. A rule offers people
// things to do (`world.offer`), each a word to show and how it is done (tapped or held, aimed or not). Pages turn
// them into keys and buttons without knowing what any of them means, and when someone does one the rule that
// offered it hears `act`: who, which, and what their aim met. An aim meets people and actors as well as cells:
// figures are in no cell, so they are looked for here, where everyone's feet are known.
//
// Nothing here knows what an action is for. A punch, a purchase and a wave are an id and a word.

const ID = /^[a-z0-9][a-z0-9-]{0,23}$/, KEY = /^Key[A-Z]$/
/** Keys that move the body or belong to the page whatever a realm offers. */
const KEPT = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyX', 'KeyC'])
/** The most a rule may offer, the most people one offer may be for, and the most a person may do a second. */
const OFFERS_MOST = 16, FOR_MOST = 64, ACTS_A_SECOND = 30
/** How far round its middle a body is met by an aim, cells. */
const GIRTH = 4

/**
 * @param folk    everyone with a body, by the name the world knows them by: {by, name, at (feet), rule?, short?, seat, down}
 * @param tall    how tall a body is, cells
 * @param look    the first cell along a line that is not air: (from, to) => {at, kind, far}
 * @param text    what cleans text someone wrote, to a length
 * @param tell    says something to the server (the offers as they stand, for pages)
 * @param hear    tells one rule something happened: (rule id, event, e)
 */
export function hands({ folk, tall, look, text, tell, hear }) {
  /** By rule and id: what is offered. */
  const offers = new Map()
  const acted = new Map()
  const said = () => tell({ offers: [...offers.values()] })
  /** `world.offer(id, {word, hold, aim, key, to})`: offers something to do, changes it, or (word: null) takes it back. */
  const offer = (rule, w, _now, wrong) => {
    const id = w.id
    if (typeof id !== 'string' || !ID.test(id)) return wrong('what is offered has an id of its rule\'s own: lower-case letters, digits and dashes, up to 24')
    const at = `${rule.id}/${id}`
    if (w.word === null) { if (offers.delete(at)) said(); return }
    const old = offers.get(at), word = w.word === undefined ? old?.word : text(w.word, 24)
    if (!word) return wrong(`offer "${id}" needs a word to show: word, up to 24 characters`)
    if (!old) { let mine = 0; for (const o of offers.values()) if (o.rule === rule.id) mine++; if (mine >= OFFERS_MOST) return wrong(`a rule may offer ${OFFERS_MOST} things to do`) }
    const next = { rule: rule.id, id, word, hold: old?.hold ?? false, aim: old?.aim ?? false, key: old?.key ?? '', to: old?.to ?? null }
    if (w.hold !== undefined) next.hold = w.hold === true
    if (w.aim !== undefined) next.aim = w.aim === true
    if (w.key !== undefined) { if (typeof w.key === 'string' && KEY.test(w.key) && !KEPT.has(w.key)) next.key = w.key; else { next.key = ''; if (w.key) wrong(`a key is "KeyE" to "KeyZ" and not one the body moves by (${[...KEPT].map((k) => k.slice(3)).join(', ')}): the page picks one`) } }
    // Who it is for: one person, several, or (null) everyone. They are named as world.people names them.
    if (w.to !== undefined) {
      const who = w.to === null ? null : (Array.isArray(w.to) ? w.to : [w.to]).filter((v) => typeof v === 'string' && v.length <= 24).slice(0, FOR_MOST)
      if (w.to !== null && !who.length) wrong('who an offer is for is to: an id of world.people, a list of them, or null for everyone')
      else next.to = who
    }
    offers.set(at, next)
    said()
  }
  /** What a look from a place along a way meets first: someone's body, or a cell. Null for the sky. `skip` is whoever is looking. */
  const meets = (from, to, skip, ruleId) => {
    const long = Math.hypot(...to)
    if (!(long > 0)) return null
    const d = to.map((v) => v / long), cell = look(from, d)
    let best = cell.at ? { kind: 'cells', at: cell.at, far: cell.far, material: cell.kind & 15 } : null
    const flat = d[0] * d[0] + d[2] * d[2]
    for (const p of folk.values()) {
      if (p === skip) continue
      // The body as an upright post: where the look passes nearest its middle, seen from above, and how high it is there.
      const dx = p.at[0] - from[0], dz = p.at[2] - from[2]
      const t = flat > 1e-9 ? (dx * d[0] + dz * d[2]) / flat : (d[1] > 0 ? p.at[1] - from[1] : p.at[1] + tall - from[1]) / d[1]
      if (!(t > 0) || t > (best?.far ?? 800)) continue
      const off = Math.hypot(from[0] + d[0] * t - p.at[0], from[2] + d[2] * t - p.at[2]), high = from[1] + d[1] * t - p.at[1]
      const height = p.down > Date.now() ? tall / 3 : tall
      if (off > GIRTH || high < 0 || high > height) continue
      best = { kind: p.rule ? 'actor' : p.seat ? 'seat' : 'page', id: p.rule === ruleId ? p.short : p.by, name: p.name, mine: p.rule === ruleId, at: p.at.map(Math.round), far: Math.round(t), up: Number(Math.max(0, Math.min(1, high / tall)).toFixed(2)) }
    }
    return best
  }
  return {
    offer,
    /** A rule is gone: so is what it offered. */
    dropped(ruleId) { let any = false; for (const [at, o] of offers) if (o.rule === ruleId) { offers.delete(at); any = true } if (any) said() },
    meets,
    /** Someone did something that was offered: {by, rule, id, phase, from, to}. Says why not, or nothing. */
    act(m) {
      const o = offers.get(`${m.rule}/${m.id}`), p = folk.get(m.by), now = Date.now()
      if (!o) return 'nothing of that name is offered'
      if (!p || p.rule) return 'nobody of that name has a body here'
      if (o.to && !o.to.includes(m.by)) return 'that is not offered to you'
      const count = acted.get(m.by)
      if (!count || now - count.since > 1000) acted.set(m.by, { since: now, n: 1 })
      else if (++count.n > ACTS_A_SECOND) return 'too many things done in a second'
      if (acted.size > 4096) acted.clear()
      const phase = o.hold ? (m.phase === 'up' ? 'up' : 'down') : 'tap'
      const e = { by: m.by, name: p.name, action: o.id, phase, at: p.at.map(Math.round), from: m.from.map((v) => Number(v.toFixed(1))), to: m.to.map((v) => Number(v.toFixed(3))) }
      // Aimed or not, the rule is told what was ahead: a wave has someone it was at.
      e.met = meets(m.from, m.to, p, o.rule)
      hear(o.rule, 'act', e)
      return ''
    },
  }
}
