// Who voices a world (#264): the server's side of thinking. The server never runs a model. It hands each ask the
// world's process made (think.mjs) to one helper that has come to voice this world, and passes that helper's
// answers back to the world's process, which checks them.
//
// Whose machine it is. One helper voices everyone in a world at a time: the first that came, for as long as it
// keeps asking. Its model runs on its own machine, on the subscription of whoever started it, and what people
// near an actor say goes to that model. If it stops asking for ten seconds the next helper to come takes over.
// The world asks nobody who they are, so "first" is all that can be said yet: when a realm has an owner the
// server can tell from anyone else, the owner's helper should come first.
//
//   GET  /world/minds?voice=key     held until there is something to answer (at most eight seconds): {asks: [{n, ask}]}
//   POST /world/mind                {voice: key, n, say, more: true} with the words so far, as they come; {voice, n, say, notes} with all of them at the end; {voice, n, failed}; {voice, leave: true} when it closes
import { randomBytes } from 'node:crypto'

/** How long a helper may go without asking before it no longer voices the world, and how long one of its asks is held (ms). */
const QUIET_MOST = 10_000, HELD_MOST = 8000
/** With nobody to voice the world, a rule is told so after this long (ms): a helper that is just starting has that long to come. */
const NOBODY = 1000
/** The most asks that may wait for a voice. */
const WAITING_MOST = 32
const KEY = /^[A-Za-z0-9_-]{16,64}$/

/** @param answer  passes an answer to the world's process; `voiced` says whether anyone voices the world, when that changes */
export function door({ answer, send, voiced = () => {} }) {
  /** Who voices the world now: its key, when it last asked, and the request of its that is being held. */
  let voice = null
  /** Asks not yet handed out, and by number those handed out and to which key. */
  const waiting = [], out = new Map()
  const live = () => voice && Date.now() - voice.last < QUIET_MOST
  /** The world's process is told when someone comes to voice the world and when nobody does any more: rules may ask. */
  let was = false
  const say = () => { const now = !!live(); if (now !== was) { was = now; voiced(now) } }
  const give = () => {
    if (!live() || !voice.held || !waiting.length) return
    const { res, timer } = voice.held
    voice.held = null; clearTimeout(timer)
    const asks = waiting.splice(0)
    const now = Date.now()
    // What was handed out and never answered (the world gave up on it long ago) is forgotten.
    for (const [n, o] of out) if (now - o.since > 60_000) out.delete(n)
    for (const a of asks) out.set(a.n, { key: voice.key, since: now })
    send(res, 200, JSON.stringify({ asks }), 'application/json')
  }
  // A voice that has gone quiet with asks in its hands: their rules are told now, not when the world gives up on them.
  const watch = setInterval(() => { say(); if (!live()) for (const n of [...out.keys()]) { out.delete(n); answer({ n, failed: 'the voice that was answering has gone' }) } }, 2000).unref()
  return {
    /** An ask from the world's process. */
    think(m) {
      if (waiting.length >= WAITING_MOST) return answer({ n: m.n, failed: 'too many thoughts are waiting for a voice' })
      waiting.push(m)
      if (live()) return give()
      // Nobody is here to answer: said soon, so that a rule can do something else. A helper that comes meanwhile is given it.
      setTimeout(() => { const i = waiting.indexOf(m); if (i >= 0 && !live()) { waiting.splice(i, 1); answer({ n: m.n, failed: 'nobody voices this world: no helper is running for it' }) } }, NOBODY)
    },
    /** A helper asks what there is to answer. */
    take(url, res) {
      const key = url.searchParams.get('voice') ?? ''
      if (!KEY.test(key)) return send(res, 400, 'a voice has a key of its own: 16 to 64 letters, digits, - and _')
      if (live() && voice.key !== key) return send(res, 409, 'someone else voices this world now')
      if (voice?.key !== key) { for (const [n, o] of out) if (o.key !== key) { out.delete(n); answer({ n, failed: 'the voice that was answering has gone' }) } voice = { key, last: 0, held: null } }
      // One request of a voice's is held at a time: an older one is let go with nothing.
      if (voice.held) { clearTimeout(voice.held.timer); send(voice.held.res, 200, '{"asks":[]}', 'application/json') }
      voice.last = Date.now()
      say()
      const held = { res, timer: setTimeout(() => { if (voice?.held === held) { voice.held = null; voice.last = Date.now(); send(res, 200, '{"asks":[]}', 'application/json') } }, HELD_MOST) }
      voice.held = held
      res.on('close', () => { if (voice?.held === held) { clearTimeout(held.timer); voice.held = null } })
      give()
    },
    /** A helper answers: only the one that was handed the ask may. */
    mind(b, res) {
      // A helper that is closing says so: what it held fails now, and the next to come voices the world at once.
      if (b && b.leave === true && voice?.key === b.voice) {
        if (voice.held) { clearTimeout(voice.held.timer); send(voice.held.res, 200, '{"asks":[]}', 'application/json') }
        voice = null
        say()
        for (const n of [...out.keys()]) { out.delete(n); answer({ n, failed: 'the voice that was answering has gone' }) }
        return send(res, 202, '{}', 'application/json')
      }
      if (!b || typeof b !== 'object' || !KEY.test(String(b.voice)) || !Number.isInteger(b.n)) return send(res, 400, 'an answer is {voice, n, say, notes}, {voice, n, say, more: true} or {voice, n, failed}')
      if (out.get(b.n)?.key !== b.voice) return send(res, 409, 'that was not asked of this voice, or is answered already')
      if (voice?.key === b.voice) voice.last = Date.now()
      if (b.more !== true) out.delete(b.n)
      answer({ n: b.n, say: b.say, more: b.more, notes: b.notes, failed: b.failed })
      send(res, 202, '{}', 'application/json')
    },
    /** The world is stopped: a helper that is held is let go, and nothing more is watched. */
    close() { clearInterval(watch); if (voice?.held) { clearTimeout(voice.held.timer); send(voice.held.res, 200, '{"asks":[]}', 'application/json') } voice = null },
    /** Whether anyone voices the world now. */
    get voiced() { return !!live() },
  }
}
/** A key for a helper that comes to voice a world. */
export const key = () => randomBytes(18).toString('base64url')
