// A world's server, by its address (#220): how the maker (make/maker.mjs) asks it what is where (`/world/at`,
// `/world/look`, `/world/tops`), what is made in it (`/world/things`), has it keep a living thing's look
// (`/world/fine`), and sends it a thing as one edit (`POST /world/ask`), which the world takes whole or refuses whole.
// The one place where a world is an address: make.mjs, helper.mjs, the checks and a page in a lobby (page/maker.ts,
// over the door's `fetch`) hand the maker `served(address)`. Nothing here is on the server, and nothing here is Node's.
import { beside, edit, samples } from './place.mjs'

const no = (why) => { throw new Error(why) }
const json = async (res) => { if (!res.ok) throw new Error(`the world said ${res.status}: ${(await res.text()).slice(0, 120)}`); return res.json() }
/**
 * A question of the world, asked again while it says to wait (429): a world, or a door in front of it (door.mjs),
 * gives each asker so many a second. A question that is refused is never taken for an answer.
 */
async function asked(url, f = fetch) {
  for (let tries = 0; ; tries++) {
    const res = await f(url)
    if (res.status !== 429 || tries === 40) return json(res)
    await new Promise((r) => setTimeout(r, 300))
  }
}
export const at = (world, [x, y, z], f = fetch) => asked(`${world}/world/at?x=${x}&y=${y}&z=${z}`, f)
/** The first thing down every column of a rectangle, looked for from height `y`: { high, material }, a row of x for each z. */
export const tops = (world, [x0, z0, x1, z1], y, f = fetch) => asked(`${world}/world/tops?x0=${x0}&z0=${z0}&x1=${x1}&z1=${z1}&y=${y}`, f)
export const look = (world, [x, y, z], [dx, dy, dz], f = fetch) => asked(`${world}/world/look?x=${x}&y=${y}&z=${z}&dx=${dx}&dy=${dy}&dz=${dz}`, f)

/** Many questions, a few at a time (fewer than a door lets one asker have under way: door.mjs `INFLIGHT_MOST`). */
async function all(items, ask, together = 6) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: together }, async () => { while (next < items.length) { const i = next++; out[i] = await ask(items[i]) } }))
  return out
}

/** How many of the sampled cells are what they should be. */
export async function counted(world, cells, kind, f = fetch) {
  const found = await all(cells, (c) => at(world, c, f))
  // A cell asked after as -1 is one that only has to hold something (a cell of finer cells has no one kind).
  return found.filter((f, i) => { const want = kind ?? cells[i][3]; return want === -1 ? f.material !== 0 : f.kind === want }).length
}

/**
 * Sends the thing: one ask. Resolves to 'there' once the world's own cells are the thing's and stay so, 'fell'
 * if they were and then were not, 'not there' if they never were, and 'unknown' if the world could not be asked.
 * `gone`: the id of a made thing to take out, cells and record on one ask: the world empties the cells it keeps for it (`made` only says where to ask after them).
 * `replaces`: the id of a made thing this one is sent in place of: it is taken out on the same ask, which the world does whole or refuses whole.
 * `post` sends it and `get` asks after it (both `fetch` unless said: a page in a lobby gives the door's).
 * It never sends twice: after a send whose answer was lost it asks the world what is there, and says.
 */
export async function send(world, made, by, { kind, thing, gone, replaces, fine, wait = 5000, settle = 1500, pause = (ms) => new Promise((r) => setTimeout(r, ms)), post = fetch, get = fetch } = {}) {
  const ask = (cells) => counted(world, cells, kind, get)
  // A thing of finer cells (`fine`: { grain, rows }) is sent as those rows; `made` is then its stand-in in the
  // world's cells, which says where to ask after it: a cell of the world that holds any of it is no longer air.
  const cells = samples(made).map((c) => (fine ? [c[0], c[1], c[2], kind === 0 ? 0 : -1] : c))
  let sent = 'lost', laid = null
  try {
    // Cells are sent with `wait`: the world answers once it has laid them, with how many pieces they left unheld.
    const res = await post(`${world}/world/ask`, { method: 'POST', body: JSON.stringify(gone ? { by, gone, release: beside(made), wait: true } : { by, edit: fine ? edit(fine.rows, kind, fine.grain) : edit(made, kind), release: beside(made), thing, ...(replaces ? { gone: replaces } : {}), wait: true }) })
    if (res.status !== 202) return { state: 'not there', why: `the world refused it (${res.status}): ${(await res.text()).slice(0, 160)}` }
    sent = 'taken'
    try { const said = await res.json(); if (said.laid) laid = said } catch { /* said nothing more */ }
  } catch { /* the answer was lost: whether the ask arrived is not known, so the world is asked */ }
  try {
    // Taken out: the world emptied the very rows it kept for the thing, and says it has (a cell of it that lay in the
    // land is the land again, so its cells are not looked at).
    if (gone && laid) return { state: 'there' }
    // A living thing (make/alive.mjs): its cells leave the world as it is brought to life, so they are not looked
    // for. The world says whether it lives.
    if (thing?.controls) return laid ? (laid.alive ? { state: 'there' } : { state: 'not there', why: 'the world could not bring it to life' }) : { state: 'unknown', why: sent === 'lost' ? 'the world could not be reached when it was sent' : 'the world did not say whether it lives' }
    // Pieces came loose somewhere round it (they may be its own or not): it is watched as before, until it settles.
    // Laid, and nothing came loose: it stands as it was put, and one look at its cells says the world took all of it
    // (a sector that holds too many finer cells takes none of them). Nothing is waited for.
    if (laid?.loose === 0) {
      const seen = await ask(cells)
      if (seen === cells.length) return { state: 'there' }
    }
    let seen = 0
    for (const began = Date.now(); Date.now() - began < wait;) {
      seen = await ask(cells)
      if (seen === cells.length) break
      await pause(250)
    }
    if (seen < cells.length) return { state: 'not there', why: sent === 'lost' ? 'the world could not be reached when it was sent, and it is not there' : `only ${seen} of ${cells.length} cells asked after are there` }
    // Whatever was going to come loose has by now.
    await pause(settle)
    const stayed = await ask(cells)
    return stayed === cells.length ? { state: 'there' } : { state: 'fell', why: `${cells.length - stayed} of ${cells.length} cells asked after came loose` }
  } catch (e) {
    return { state: 'unknown', why: `the world stopped answering after it was sent (${e.message}): look before making it again` }
  }
}

/**
 * Who is in the world now and where: every page there says where its eye is a few times a second (`/world/here`),
 * and the world's stream carries it. Listens for `ms` and returns the last word from each who is still there:
 * { by, name, at (their feet), yaw, seat (true for an agent's body, which is not a page) }.
 */
export async function people(world, ms = 1500) {
  const stop = new AbortController(), seen = new Map()
  const timer = setTimeout(() => stop.abort(), ms)
  try {
    // From past the end of what is kept: only what happens from now.
    const res = await fetch(`${world}/world/stream?from=2147483647`, { signal: stop.signal })
    let bytes = Buffer.alloc(0)
    for await (const chunk of res.body) {
      bytes = Buffer.concat([bytes, chunk])
      let i = 0
      for (; i + 12 <= bytes.length && i + 12 + bytes.readUInt32LE(i + 8) <= bytes.length; i += 12 + bytes.readUInt32LE(i + 8)) {
        if (bytes.readUInt32LE(i) !== 5) continue
        try { const who = JSON.parse(bytes.subarray(i + 12, i + 12 + bytes.readUInt32LE(i + 8)).toString('utf8')); if (who.gone) seen.delete(who.by); else seen.set(who.by, who) } catch { /* not for us */ }
      }
      bytes = bytes.subarray(i)
    }
  } catch { /* the listening was ended */ }
  clearTimeout(timer)
  return [...seen.values()]
}
/** How high over their feet someone's eyes are, in cells (the page's own figure: page/main.ts). */
const EYES = 17
/** The look of someone in the world: from their eyes, the way they face, a little down. The world says where their feet are and which way they face, not how high they look. */
export const gaze = (who) => ({ from: [Math.round(who.at[0]), Math.round(who.at[1]) + EYES, Math.round(who.at[2])], toward: [Math.sin(who.yaw) * 0.97, -0.24, -Math.cos(who.yaw) * 0.97] })

/** A look's cells as the world names them: the sha256 of their bytes. Worked out once for each part. */
const shas = new WeakMap()
const bytesOf = (kinds) => new Uint8Array(kinds.buffer, kinds.byteOffset, kinds.byteLength)
const shaOf = (kinds) => { if (!shas.has(kinds)) shas.set(kinds, crypto.subtle.digest('SHA-256', bytesOf(kinds)).then((d) => [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''))); return shas.get(kinds) }

/** What a world is known to keep already, by `world sha`: asked once each, so a second car of a kind sends nothing. */
/** What each world is known to keep, or is being sent now: a look is asked after and sent once, however many ask at once (a ghost asks at every key). */
const known = new Map()
/**
 * Has the world keep each part of a look (`POST /world/fine`, which answers by the sha256 of the cells), unless it
 * says it has it already (`HEAD /world/fine/<sha>`). Resolves to what the record's `controls.fine` says, or throws
 * with why: a look that could not be kept is not made at all.
 */
export async function keepLook(world, look, { post = fetch } = {}) {
  return Promise.all(look.map(async (part) => {
    const p = { ...part, sha: await shaOf(part.kinds) }, key = `${world} ${p.sha}`
    if (!known.has(key)) {
      const sent = (async () => {
        const there = await post(`${world}/world/fine/${p.sha}`, { method: 'HEAD' }).then((r) => r.ok, () => false)
        if (there) return
        const r = await post(`${world}/world/fine`, { method: 'POST', body: bytesOf(p.kinds) }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }))
        if (!r.ok) no(`the world would not keep its look (${r.status}): ${(await r.text()).slice(0, 120)}`)
        const said = await r.json()
        if (said.kept !== p.sha) no('the world kept its look under another name')
      })()
      known.set(key, sent)
      // One that failed is asked after again the next time.
      sent.catch(() => known.delete(key))
    }
    await known.get(key)
    return { size: p.size, per: p.per, low: p.low, kept: p.sha }
  }))
}

/**
 * The world at `address` as the maker takes a world (make/maker.mjs `World`): every question is asked of its server.
 * `address` names it in the journal, so `undo` finds what was made there. `f` is how it is asked: a page in a lobby
 * gives the door's `fetch` (page/door.ts), and `address` is then '' (the door takes paths) and `name` what the journal calls it.
 */
export function served(address, f = fetch, name = null) {
  const world = String(address).replace(/\/$/, '')
  return {
    address: name ?? world,
    at: (c) => at(world, c, f),
    tops: (rect, y) => tops(world, rect, y, f),
    look: (from, toward) => look(world, from, toward, f),
    things: () => asked(`${world}/world/things`, f),
    async thing(id) { const r = await f(`${world}/world/things?id=${encodeURIComponent(id)}`); return r.ok ? r.json() : null },
    send: (made, by, how) => send(world, made, by, { post: f, get: f, ...how }),
    keepLook: (parts) => keepLook(world, parts, { post: f }),
    async empty(rows, by) { for (const part of rows) await f(`${world}/world/ask`, { method: 'POST', body: JSON.stringify({ by, edit: edit(part), release: beside(part) }) }) },
  }
}
