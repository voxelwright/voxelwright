// The voice of a world's people (#264): the helper's side of thinking. It runs on a person's own machine beside
// the helper (helper.mjs starts it), asks the world what its people have been asked to think (door.mjs), has that
// person's own Claude Code answer each (model.mjs), and sends the answers back: the first sentence as soon as it
// is whole, the rest and the notes at the end.
//
// What it is sent is a stranger's text (a rule's, and what people typed): it goes to the model as data under
// labels (form.mjs) and to nothing else. What the model answers is read as words and notes and nothing else, and
// the world checks it again.
//
// It spends the subscription of whoever started it on what any rule in the world asks for, so it keeps its own
// count: so many answers a minute and so many at once, whatever the world sends.
import { key as newKey } from './door.mjs'
import { READING, SYSTEM, asked, read, readNotes, reading, sofar } from './form.mjs'
import { mind } from './model.mjs'

/**
 * @param world     the world it voices
 * @param model     `(prompt, heard) => Promise<{text}>`: stands in for the real one in checks
 * @param most      the most answers a minute
 * @param name      which model answers, and `warm` how many of its processes are kept started ahead (model.mjs says why Sonnet, and why ahead)
 * @param together  the most at once
 * @returns { close(), counts }: counts are how many were answered, failed and turned away
 */
export function voice({ world, model, name = 'sonnet', binary = 'claude', warm = 2, most = 40, together = 3, say = () => {}, shared }) {
  const own = model || shared ? null : mind({ system: SYSTEM, model: name, binary, warm })
  const reply = shared?.reply ?? model ?? own.reply
  // What only reads (world.read) is told something else first, so it is a run of its own kind: one waits started.
  const reader = model || shared ? null : mind({ system: READING, model: name, binary, warm: Math.min(1, warm) })
  const readIt = shared?.read ?? model ?? reader.reply
  // What is spent is counted once for everything a helper voices: `shared` is that count, when there is more than one world.
  const spent = shared ?? { counts: { answered: 0, failed: 0, refused: 0, tokens: { in: 0, cached: 0, out: 0 } }, busy: 0, since: Date.now(), count: 0, queue: [] }
  const key = newKey(), { counts, queue } = spent
  let closed = false
  const stop = new AbortController()
  const post = (body) => fetch(`${world}/world/mind`, { method: 'POST', body: JSON.stringify({ voice: key, ...body }) }).then(() => {}, () => {})
  async function one({ n, ask }) {
    const began = Date.now()
    if (ask.reads) {
      try {
        const r = await readIt(reading(ask)), got = readNotes(r.text, ask.notes)
        if (r.tokens) for (const k of ['in', 'cached', 'out']) counts.tokens[k] += r.tokens[k] ?? 0
        if (got.failed) { counts.failed++; say(`  a reading: ${got.failed}`); return post({ n, failed: got.failed }) }
        counts.answered++
        say(`  read (${Date.now() - began} ms): ${JSON.stringify(got.notes)}`)
        return await post({ n, notes: got.notes })
      } catch (e) { counts.failed++; say(`  a reading: ${e.message}`); return post({ n, failed: 'the model did not answer' }) }
    }
    let sent = ''
    try {
      const r = await reply(asked(ask), (text) => {
        // The first whole sentence is said while the rest is still coming: once.
        if (sent) return
        const { words } = sofar(text)
        if (words.trim().length > 1) { sent = words; void post({ n, say: words, more: true }) }
      })
      const got = read(r.text, ask.notes)
      if (r.tokens) for (const k of ['in', 'cached', 'out']) counts.tokens[k] += r.tokens[k] ?? 0
      if (got.failed) { counts.failed++; say(`  ${ask.name}: ${got.failed}`); return post({ n, failed: got.failed }) }
      counts.answered++
      const all = got.say.join(' ')
      say(`  ${ask.name} (${Date.now() - began} ms${r.first ? `, first word ${r.first} ms` : ''}): ${all}`)
      await post({ n, say: all, notes: got.notes })
    } catch (e) { counts.failed++; say(`  ${ask.name}: ${e.message}`); await post({ n, failed: 'the model did not answer' }) }
  }
  const next = () => { while (spent.busy < together && queue.length) { spent.busy++; void queue.shift()().finally(() => { spent.busy--; next() }) } }
  void (async () => {
    while (!closed) {
      try {
        const res = await fetch(`${world}/world/minds?voice=${key}`, { signal: stop.signal })
        if (res.status === 409) { await new Promise((r) => setTimeout(r, 5000)); continue }
        if (!res.ok) throw new Error(`the world said ${res.status}`)
        for (const a of (await res.json()).asks ?? []) {
          const now = Date.now()
          if (now - spent.since > 60_000) { spent.since = now; spent.count = 0 }
          if (++spent.count > most) { counts.refused++; void post({ n: a.n, failed: 'the voice has answered as much as it may this minute' }); continue }
          queue.push(() => one(a))
        }
        next()
      } catch { if (!closed) await new Promise((r) => setTimeout(r, 1000)) }
    }
  })()
  return { counts, close() { closed = true; stop.abort(); own?.close(); reader?.close(); return post({ leave: true }) } }
}

/**
 * A voice for every world of a server that someone is in (#264): home always, and each realm while it is awake with
 * a page reading it (a realm nobody is in is left to rest: asking it anything would keep it awake). One model and
 * one count of what is spent for all of them. `server` is the server's own address, with no realm in it.
 */
export function voices({ server, model, name = 'sonnet', binary = 'claude', warm = 2, most = 40, together = 3, say = () => {} }) {
  const own = model ? null : mind({ system: SYSTEM, model: name, binary, warm })
  const reader = model ? null : mind({ system: READING, model: name, binary, warm: Math.min(1, warm) })
  const shared = { reply: model ?? own.reply, read: model ?? reader.reply, counts: { answered: 0, failed: 0, refused: 0, tokens: { in: 0, cached: 0, out: 0 } }, busy: 0, since: Date.now(), count: 0, queue: [] }
  const all = new Map([['', voice({ world: server, most, together, say, shared })]])
  const look = async () => {
    let list
    try { list = (await (await fetch(`${server}/realms`)).json()).realms } catch { return }
    if (!Array.isArray(list)) return
    const wanted = new Set(list.filter((r) => !r.home && r.awake && r.pages > 0 && typeof r.id === 'string').map((r) => r.id))
    for (const id of wanted) if (!all.has(id)) { say(`  voicing the people of the realm ${id}`); all.set(id, voice({ world: `${server}/realm/${id}`, most, together, say, shared })) }
    for (const [id, v] of all) if (id && !wanted.has(id)) { all.delete(id); void v.close() }
  }
  const watch = setInterval(look, 2000)
  void look()
  return { counts: shared.counts, get worlds() { return all.size }, close() { clearInterval(watch); own?.close(); reader?.close(); return Promise.all([...all.values()].map((v) => v.close())) } }
}
