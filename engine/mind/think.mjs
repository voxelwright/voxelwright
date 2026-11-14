// A rule asks one of its actors to think (#264): the world's side of it. `world.think(id, {...})` in a rule comes
// here, is checked as anything from a rule is, and is handed out through the server to whoever voices this world
// (door.mjs): a helper on a person's own machine, which runs that person's own model. This process never runs one.
// What comes back is a stranger's too. It is matched to an ask this process kept, its words are checked and said
// by the actor, and its notes are made to fit what the asking rule said each may be (form.mjs): only then is the
// rule told, and only that rule, as something heard: on('thought', (world, e) => ...).
//
// Nothing here knows what a note means, or what any world is about.
import { text } from '../text.mjs'
import { BEFORE_MOST, HEARD_MOST, LATELY_MOST, LISTENING_MOST, REALM_MOST, SAY_MOST, WHERE_MOST, WHO_MOST, lines, noted, wanted } from './form.mjs'

/** How long a thought may take before its rule is told it failed (ms). */
const THOUGHT_MOST = 20_000
/** The most thoughts of one rule in flight at once, and the most it may ask for in a minute. */
const TOGETHER_MOST = 8, A_MINUTE_MOST = 40
/** How long what was said is remembered (ms), and of how many actors. */
const REMEMBERED = 60 * 60_000, PEOPLE_MOST = 512
/** Whose talk a kept line is: a rule's id, a stroke, its actor's id. */
const KEY = /^[a-z0-9][a-z0-9-]{0,23}\/[a-z0-9][a-z0-9-]{0,23}$/
const READ_ID = /^[a-z0-9][a-z0-9-]{0,23}$/

/**
 * @param actor   an actor of a rule's, by the rule's id and the actor's own: the body, or undefined
 * @param say     makes a body say words now
 * @param show    tells pages how a body is (it thinks, it has stopped thinking)
 * @param hand    hands an ask to the server, for whoever voices the world
 * @param happen  tells one rule that something happened
 * @param realm   what this world is called and is about, in its maker's words: {name, about}, or null
 */
export function thinking({ actor, say, show, hand, happen, realm = () => null }) {
  /** Asks in flight, by number: whose, for which actor, what notes were wanted, and what has been said of the answer so far. */
  const asks = new Map()
  let n = 0
  /**
   * What each actor has lately heard and said, by rule and actor: so that someone spoken to a minute ago knows it.
   * Kept here and not by rules, so every rule's people remember with nothing written for it: a few turns each, and
   * what is older than an hour is forgotten. It outlives a rest and a restart as a rule's actors do: `kept` is what
   * the server writes beside the world's file, `back` reads it as anything from outside is read.
   */
  const talk = new Map()
  const recalled = (key, now) => { const t = (talk.get(key) ?? []).filter((b) => now - b.t < REMEMBERED); if (t.length) talk.set(key, t); else talk.delete(key); return t.map(({ who, text }) => ({ who, text })) }
  const remember = (ask, now) => {
    const key = `${ask.rule}/${ask.id}`, t = talk.get(key) ?? []
    if (ask.heard) t.push({ who: ask.from || 'someone', text: ask.heard, t: now })
    t.push({ who: 'self', text: ask.said, t: now })
    talk.set(key, t.slice(-BEFORE_MOST))
    // Only so many people are remembered: the one who spoke longest ago is forgotten first.
    if (talk.size > PEOPLE_MOST) talk.delete(talk.keys().next().value)
  }
  const end = (ask, e) => {
    asks.delete(ask.n)
    // A reading has no actor: the rule that asked is told what was read, and nobody else anything.
    if (ask.reads) return happen('read', { id: ask.id, from: ask.from, said: ask.heard, ms: Date.now() - ask.since, notes: e.notes, ...(e.failed ? { failed: e.failed } : {}) }, ask.rule)
    const p = actor(ask.rule, ask.id)
    if (p?.asked === ask.n) { p.asked = 0; if (p.thinking) { p.thinking = false; show(p) } }
    // An actor that has gone, or a rule taken out, is told nothing.
    if (p) happen('thought', { id: ask.id, from: ask.from, heard: ask.heard, ms: Date.now() - ask.since, ...e }, ask.rule)
  }
  /** The words of an answer so far, said by the actor a go at a time: only what goes beyond what it has said already. */
  const speak = (ask, words) => {
    const p = actor(ask.rule, ask.id), all = lines(words).join(' ')
    if (!all.startsWith(ask.said)) return
    for (const line of lines(all.slice(ask.said.length))) {
      ask.said += (ask.said ? ' ' : '') + line
      // Its first words end the pause: the dots over its head give way to what it says.
      if (p?.thinking && p.asked === ask.n) { p.thinking = false; show(p) }
      if (p && !ask.quiet) say(p, line)
    }
  }
  return {
    /** `world.think(id, {who, where, lately, heard, from, notes, quiet})`: the `does` entry. */
    ask(rule, w, now, wrong) {
      const p = typeof w.id === 'string' ? actor(rule.id, w.id) : undefined
      if (!p) return wrong(`"${String(w.id).slice(0, 24)}" is not an actor of this rule: only an actor can be asked to think`)
      if (p.asked) return wrong(`actor "${w.id}" is still thinking: wait for its thought`)
      const who = text(w.who, WHO_MOST), want = wanted(w.notes)
      if (!who) return wrong('a thought needs who the actor is: who, in words')
      if (typeof want === 'string') return wrong(want)
      if (now - (rule.thinks?.since ?? 0) > 60_000) rule.thinks = { since: now, count: 0 }
      let together = 0
      for (const a of asks.values()) if (a.rule === rule.id) together++
      if (together >= TOGETHER_MOST || ++rule.thinks.count > A_MINUTE_MOST) return wrong(`a rule may have ${TOGETHER_MOST} actors thinking at once and ask for ${A_MINUTE_MOST} thoughts a minute`)
      const ask = { n: ++n, rule: rule.id, id: w.id, want, from: text(w.from, 24), heard: text(w.heard, HEARD_MOST), quiet: w.quiet === true, since: now, said: '' }
      asks.set(ask.n, ask)
      p.asked = ask.n; p.thinking = true; show(p)
      // What was said before: what the world remembers of this actor's talk, unless the rule says what it was (before: [] and they remember nothing).
      const before = Array.isArray(w.before) ? w.before.slice(-BEFORE_MOST).map((b) => ({ who: b?.who === 'self' ? 'self' : text(b?.who, 24), text: text(b?.text, SAY_MOST) })).filter((b) => b.who && b.text) : recalled(`${rule.id}/${w.id}`, now)
      // Where they live: what the realm is called and is about, unless the rule says they are not to be told (realm: false).
      const r = w.realm === false ? null : realm(), here = r && (r.name || r.about) ? { name: text(r.name, 40), about: text(r.about, REALM_MOST) } : undefined
      hand({ n: ask.n, ask: { realm: here, name: p.name, who, where: text(w.where, WHERE_MOST), lately: text(w.lately, LATELY_MOST), before, from: ask.from, heard: ask.heard, notes: want } })
    },
    /**
     * `world.read(id, {said, from, listening, notes})`: the `does` entry. The model reads what a person said for
     * the notes the rule wants; no actor answers, nothing is said and nothing shows. Counted with a rule's thoughts.
     */
    read(rule, w, now, wrong) {
      if (typeof w.id !== 'string' || !READ_ID.test(w.id)) return wrong('a reading has an id of the rule\'s own, to know its answer by: lower-case letters, digits and dashes, up to 24')
      const said = text(w.said, HEARD_MOST), want = wanted(w.notes)
      if (!said) return wrong(`reading "${w.id}" needs what was said: said, in words`)
      if (typeof want === 'string') return wrong(want)
      if (!Object.keys(want).length) return wrong(`reading "${w.id}" needs notes: what is to be read in what was said`)
      if (now - (rule.thinks?.since ?? 0) > 60_000) rule.thinks = { since: now, count: 0 }
      let together = 0
      for (const a of asks.values()) { if (a.rule !== rule.id) continue; together++; if (a.reads && a.id === w.id) return wrong(`reading "${w.id}" is still being read: wait for it, or give this one another id`) }
      if (together >= TOGETHER_MOST || ++rule.thinks.count > A_MINUTE_MOST) return wrong(`a rule may have ${TOGETHER_MOST} thoughts and readings under way at once and ask for ${A_MINUTE_MOST} a minute`)
      const ask = { n: ++n, reads: true, rule: rule.id, id: w.id, want, from: text(w.from, 24), heard: said, since: now, said: '' }
      asks.set(ask.n, ask)
      const r = w.realm === false ? null : realm(), here = r && (r.name || r.about) ? { name: text(r.name, 40), about: text(r.about, REALM_MOST) } : undefined
      hand({ n: ask.n, ask: { reads: true, realm: here, listening: text(w.listening, LISTENING_MOST), from: ask.from, said, notes: want } })
    },
    /** What came back for an ask, from the server: `{n, say, more}` while it is still coming (the words so far), `{n, say, notes}` at its end (all of them), or `{n, failed}`. */
    answer(m) {
      const ask = m && asks.get(m.n)
      if (!ask) return
      if (typeof m.failed === 'string') return end(ask, { say: ask.said, notes: noted(ask.want, null), failed: text(m.failed, 200) || 'it failed' })
      // What was read is notes and no more: whatever words came with it are nobody's to say.
      if (ask.reads) return m.more === true ? undefined : end(ask, { notes: noted(ask.want, m.notes) })
      if (typeof m.say === 'string') speak(ask, m.say)
      if (m.more === true) return
      if (!ask.said) return end(ask, { say: '', notes: noted(ask.want, null), failed: 'the answer held nothing a person of the world would say' })
      remember(ask, Date.now())
      end(ask, { say: ask.said, notes: noted(ask.want, m.notes) })
    },
    /** What is remembered, to be kept over a restart: by rule and actor, the lines and when each was said. */
    kept() { return Object.fromEntries(talk) },
    /** What was kept is remembered again. It comes from a file: every part of it is checked, and what is too old is left. */
    back(was, now = Date.now()) {
      if (!was || typeof was !== 'object' || Array.isArray(was)) return
      for (const [key, lines] of Object.entries(was).slice(0, PEOPLE_MOST)) {
        if (!KEY.test(key) || !Array.isArray(lines)) continue
        const t = lines.slice(-BEFORE_MOST).map((b) => ({ who: b?.who === 'self' ? 'self' : text(b?.who, 24), text: text(b?.text, SAY_MOST), t: Number(b?.t) })).filter((b) => b.who && b.text && Number.isFinite(b.t) && b.t <= now && now - b.t < REMEMBERED)
        if (t.length) talk.set(key, t)
      }
    },
    /** Called now and then: a thought that has taken too long has failed, and its actor stops thinking. */
    tidy(now) { for (const ask of [...asks.values()]) if (now - ask.since > THOUGHT_MOST) end(ask, { say: ask.said, notes: noted(ask.want, null), failed: 'no answer came in time' }) },
    /** A rule was taken out: what it asked for is forgotten. */
    drop(rule) { for (const ask of [...asks.values()]) if (ask.rule === rule) asks.delete(ask.n); for (const key of [...talk.keys()]) if (key.startsWith(`${rule}/`)) talk.delete(key) },
  }
}
