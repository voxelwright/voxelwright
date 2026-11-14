// The rules of a world, kept running (#264): for the world's process, which never runs a line of one. Each rule
// has a thread of its own (thread.mjs) holding its interpreter. The world posts it what happened and goes on with
// its own clock; what the rule answers comes back as a message, like an ask from anyone, and is done then.
//
// So a rule can hold up nothing but itself. What ends one: its text does not run; a call or its start takes longer
// than the clock allows (its thread is ended, whatever it was doing); its thread dies; or it fails too often.
// A rule that is ended stays in the world's file and says why (`doing`): putting it again starts it afresh.
import { Worker } from 'node:worker_threads'

/** The most rules a world may have: each is a thread and an interpreter (about 40 MB at most). */
export const RULES_MOST = 16
/** How long a rule's thread may take to start and run the rule's own text, and how long one call may take, by the clock (ms). Generous: a busy machine is slow, and nothing waits on a rule but the rule. */
const START_MOST = 30_000, CALL_MOST = 1000
/**
 * The clock is this process's own, and this process can be busy with the world's work (a big blast, hundreds of
 * edits that fall) or held up with the whole machine. Time it could not have read an answer in is not time the rule
 * took: so the clock goes by beats, and a beat that comes late counts as one beat and a half at most. A healthy
 * rule put into a busy world was stopped as slow to start (the realms lane, November 13) when one deadline was set
 * for each call.
 */
const BEAT = 100, BEAT_MOST = 150
/** A call that took the rule's own thread longer than this (ms) counts against it, though it answered. */
const SLOW = 100
/** Failures count one each and a good call takes a quarter off: at five the rule is stopped. One that fails four times in five is stopped as surely as one that always fails. */
const STRIKES = 5, MENDS = 0.25
/** The most that may wait for a rule that is still at work, and the most it may keep (as JSON). */
const WAITING_MOST = 16, KEEP_MOST = 64 << 10
/** How many of the last things a rule got wrong are kept for whoever asks how it is doing. */
const ERRORS_KEPT = 8

/**
 * @param people  who is there, as a rule is to be told it: asked when a call is sent, so it is as fresh as the call
 * @param residents  the town's residents near people, as a rule is to be told them (#218)
 * @param things  the living things near people, as a rule is to be told them (#245)
 * @param does    the names of what a rule may ask for here: told to it with every call
 * @param voiced  whether a model answers for this world's people now (mind/door.mjs)
 * @param realm   what this world is called and is about, as its record says: {name, about}, or null
 * @param still   whether the rule under an id is at rest now (the world says which and when): it is told nothing, and what a call of its that was under way asks for is left
 * @param obey    what a rule wants done (the `out` of its answer), for the world to check and do
 */
export function rules({ people, residents = () => [], things = () => [], does, obey, voiced = () => false, realm = () => null, still = () => false }) {
  /** By id: the thread, what it listens for, what waits for it, what it keeps, and how it has been doing. */
  const all = new Map()
  const stop = (rule, why) => {
    if (rule.stopped) return
    rule.stopped = true; rule.error = why
    rule.owed = null
    rule.waiting.length = 0; rule.at = null
    void rule.thread?.terminate()
  }
  // What each rule's thread owes (its start, an answer) runs down by beats; one that runs out is ended.
  let last = performance.now()
  setInterval(() => {
    const now = performance.now(), passed = Math.min(now - last, BEAT_MOST)
    last = now
    for (const rule of all.values()) if (rule.owed && !rule.stopped && !rule.replaced && (rule.owed.left -= passed) <= 0) stop(rule, rule.owed.why)
  }, BEAT).unref()
  const fault = (rule, why) => { rule.error = why; if ((rule.strikes += 1) >= STRIKES) stop(rule, `stopped after failing too often: ${why}`) }
  /** What the world's other running rules listen for: so that a rule can stand back from what another sees to. */
  const others = (rule) => { const out = new Set(); for (const o of all.values()) if (o !== rule && !o.stopped && o.listens) for (const n of o.listens) out.add(n); return [...out] }
  /** The next thing that waits is sent, if the rule is free. */
  const send = (rule) => {
    if (rule.stopped || !rule.listens || rule.at || !rule.waiting.length || still(rule.id)) return
    const { event, e } = rule.waiting.shift(), now = Date.now()
    rule.at = { n: ++rule.sent, event }
    rule.owed = { left: CALL_MOST, why: `stopped: a call (${event}) took over ${CALL_MOST} ms` }
    rule.thread.postMessage({ n: rule.at.n, json: JSON.stringify({ event, e, now: now / 1000, people: people(rule.id), residents: residents(), things: things(rule.id), keep: rule.keep, does: does(), others: others(rule), voiced: voiced(), realm: realm() }) })
  }
  const answered = (rule, m) => {
    if (m.failed !== undefined) return stop(rule, String(m.failed).slice(0, 300))
    if (m.listens) { rule.owed = null; rule.listens = new Set(Array.isArray(m.listens) ? m.listens.filter((n) => typeof n === 'string').slice(0, 32) : []); rule.waiting = rule.waiting.filter((w) => rule.listens.has(w.event)); return send(rule) }
    if (!rule.at || m.n !== rule.at.n) return
    rule.owed = null
    const took = Number.isFinite(m.ms) ? m.ms : 0, event = rule.at.event
    rule.at = null
    rule.calls++; rule.ms += took; rule.worst = Math.max(rule.worst, took)
    if (m.broken) return stop(rule, String(m.error).slice(0, 300))
    let wants = null
    if (typeof m.error !== 'string') try { wants = JSON.parse(m.value) } catch { /* said below */ }
    if (typeof m.error === 'string') fault(rule, m.error.slice(0, 300))
    else if (!wants || typeof wants !== 'object' || !Array.isArray(wants.out)) fault(rule, 'the rule answered with something that is not an answer')
    else {
      if (took > SLOW) fault(rule, `a call (${event}) took ${Math.round(took)} ms`)
      else rule.strikes = Math.max(0, rule.strikes - MENDS)
      // What it keeps is its own, and only so much of it: more than that and it keeps what it had.
      if (wants.keep && typeof wants.keep === 'object' && !Array.isArray(wants.keep)) { if (JSON.stringify(wants.keep).length <= KEEP_MOST) rule.keep = wants.keep; else rule.error = `what the rule keeps is over ${KEEP_MOST} characters: it keeps what it had` }
      if (!rule.stopped && !still(rule.id)) obey(rule, wants.out, event)
    }
    send(rule)
  }
  return {
    get size() { return all.size },
    has: (id) => all.has(id),
    /** A rule is put in, or put again changed: its old thread is ended, what it kept stays. `why` is what its `start` is told; `kept` is what it kept when the world last stopped. */
    put(r, why, kept) {
      const old = all.get(r.id)
      // The rule the engine itself gives a world (`given`: the one for talk, mind/talk.rule.js) is not one of the world's sixteen.
      if (!old && !r.given && [...all.values()].filter((o) => !o.given).length >= RULES_MOST) return
      if (old) { old.replaced = true; old.owed = null; void old.thread?.terminate() }
      const rule = { id: r.id, name: r.name, by: r.by, given: r.given === true, thread: null, listens: null, waiting: [{ event: 'start', e: { why } }], at: null, sent: 0, owed: null, keep: old?.keep ?? kept ?? {}, errors: [], strikes: 0, calls: 0, ms: 0, worst: 0, stopped: false, replaced: false, says: 0, since: 0 }
      // What a rule last got wrong is `error`, as it was; the few before it are kept too (`errors`), each with when and how
      // often, because the next one used to take its place before anyone had read it.
      let last = ''
      Object.defineProperty(rule, 'error', { get: () => last, set(why) {
        last = why
        if (!why) return
        const was = rule.errors.at(-1)
        if (was && was.why === why) { was.n++; was.at = Date.now() } else { rule.errors.push({ why, at: Date.now(), n: 1 }); if (rule.errors.length > ERRORS_KEPT) rule.errors.shift() }
      } })
      all.set(r.id, rule)
      // A thread that cannot even be started (the machine has no more to give) is a rule that is stopped, and no more.
      let thread
      try { thread = rule.thread = new Worker(new URL('./thread.mjs', import.meta.url), { workerData: { source: r.source }, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } }) } catch (e) { return stop(rule, `stopped: no thread could be started for it (${String(e?.message ?? e).slice(0, 200)})`) }
      rule.owed = { left: START_MOST, why: `stopped: the rule took over ${START_MOST / 1000} s to start` }
      // Whatever a thread does, here it is a message or an ending: nothing of a rule's is thrown into the world's process.
      thread.on('message', (m) => { try { if (!rule.replaced && m && typeof m === 'object') answered(rule, m) } catch (e) { stop(rule, `stopped: ${String(e).slice(0, 200)}`) } })
      thread.on('error', (e) => { if (!rule.replaced) stop(rule, `stopped: its thread failed (${String(e?.message ?? e).slice(0, 200)})`) })
      thread.on('exit', () => { if (!rule.replaced) stop(rule, 'stopped: its thread ended') })
    },
    /** A rule is taken out. */
    drop(id) { const rule = all.get(id); if (!rule) return; rule.replaced = true; rule.owed = null; void rule.thread?.terminate(); all.delete(id) },
    /** Something happened: every rule that listens for it (or the one rule `only`, if it does) is sent it, when it is free. A tick is not kept for a rule still at work on the last one. */
    happen(event, e, only, but) {
      for (const rule of all.values()) {
        if ((only !== undefined && rule.id !== only) || (but !== undefined && rule.id === but)) continue
        if (rule.stopped || (rule.listens && !rule.listens.has(event)) || still(rule.id)) continue
        if (event === 'tick' && (rule.at?.event === 'tick' || rule.waiting.some((w) => w.event === 'tick'))) continue
        if (rule.waiting.length >= WAITING_MOST) { rule.waiting.shift(); rule.error = `more than ${WAITING_MOST} things waited for the rule: the oldest was left out` }
        rule.waiting.push({ event, e })
        send(rule)
      }
    },
    /** What each rule keeps, by id: for whoever keeps it over a restart. */
    keeps: () => [...all.values()].map((r) => [r.id, r.keep]),
    /** How each rule is doing, for whoever asks. */
    doing: (actors) => [...all.values()].map((r) => ({ id: r.id, name: r.name, by: r.by, ...(r.given ? { given: true } : {}), running: !r.stopped && !!r.listens, listens: [...(r.listens ?? [])], actors: actors(r.id), calls: r.calls, ms: r.calls ? Number((r.ms / r.calls).toFixed(3)) : 0, worst: Number(r.worst.toFixed(3)), error: r.error, errors: r.errors.map((e) => ({ why: e.why, n: e.n, ago: Math.round((Date.now() - e.at) / 1000) })) })),
  }
}
