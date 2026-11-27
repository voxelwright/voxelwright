// The ground a shared world stands on (#526): the generated town, or San Francisco from a pinned release
// (sf/release.md) that `serve.mjs --release <where>` names. One pin for the server's whole life: the pointer is read
// once here, and every world's process (world.mjs, one a realm) and every page it serves gets those same bytes, so a
// pointer moved on disk or on the host meanwhile changes nothing until the server is started again.
//
// <where> is a folder on disk (a built static realm, `node sf/build.mjs`'s dist-sf, or a staged sf folder with its
// current.json) or the address of a current.json (a server run elsewhere): then each object is fetched the first time
// a world's process needs it and kept on disk under --release-cache once page/bay.ts has checked it against the
// manifest. Reading the format and checking it is page/bay.ts's alone (`hold`); this only finds the bytes.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** Where an address's objects are kept once checked: one folder a host. */
export const CACHE = join(homedir(), '.village', 'engine', 'world', 'releases')

/** The file an address's object is kept in. */
const keptAt = (cache, url) => { const u = new URL(url), path = normalize(join(cache, u.host.replace(/[^a-z0-9.-]/gi, '_'), decodeURIComponent(u.pathname))); return path.startsWith(cache + sep) ? path : null }
/** Written beside and moved into place, so a reader never meets half a file (two worlds' processes may keep the same one). */
const keep = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); const part = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.part`; writeFileSync(part, bytes); renameSync(part, path) }

/**
 * What `--release` names, read once: the pointer's bytes and address, the release's digest, the landmarks and the road's
 * marks the server's pages and worlds are given, and where one arrives. Throws, in plain words, where it is not a release.
 */
export async function ground(where, { cache = CACHE, arrive = null } = {}) {
  cache = resolve(cache)
  const remote = /^https?:\/\//.test(where)
  let pointer, bytes, bay
  if (remote) {
    pointer = new URL(where).href
    const answer = await fetch(pointer, { cache: 'no-cache', signal: AbortSignal.timeout(FETCH_MOST) }).catch((e) => { throw new Error(`no release at ${pointer}: ${e.name === 'TimeoutError' ? `nothing came in ${FETCH_MOST / 1000} s` : e.message}`) })
    if (!answer.ok) throw new Error(`no release at ${pointer}: ${answer.status}`)
    bytes = Buffer.from(await answer.arrayBuffer())
    bay = new URL('../bay/', pointer).href
  } else {
    const dir = resolve(where), file = [join(dir, 'sf', 'current.json'), join(dir, 'current.json')].find((f) => existsSync(f))
    if (!file) throw new Error(`no release in ${dir}: neither sf/current.json nor current.json is there`)
    pointer = pathToFileURL(file).href
    bytes = readFileSync(file)
    bay = new URL('../bay/', pointer).href
  }
  let said
  try { said = JSON.parse(bytes.toString('utf8')) } catch { throw new Error(`${pointer} is not a release pointer`) }
  if (said?.version !== 1 || !/^[0-9a-f]{64}$/.test(said.release ?? '')) throw new Error(`${pointer} is not a release pointer this server reads`)
  const release = said.release
  const fetchOnce = once()
  const { read, passed } = reading({ pointer, bytes, cache, remote, fetcher: fetchOnce })
  /** What lies beside the release for every core (landmarks, the road's marks), kept as it was found: null where it is not there. */
  const beside = async (name) => {
    const url = new URL(name, bay).href
    if (!remote) { try { return readFileSync(fileURLToPath(url)) } catch { return null } }
    const path = keptAt(cache, url)
    if (path && existsSync(path)) return readFileSync(path)
    // Within the same time as anything of a release: a host that says nothing does not hold the server's start for ever.
    const answer = await fetch(url, { signal: AbortSignal.timeout(FETCH_MOST) }).catch((e) => { console.error(`${url}: ${e.name === 'TimeoutError' ? `nothing came in ${FETCH_MOST / 1000} s` : e.message}`); return null })
    if (!answer?.ok) return null
    const body = await answer.arrayBuffer().then((b) => Buffer.from(b), () => null)
    if (body && path) keep(path, body)
    return body
  }
  // The landmarks and the squares the marks cover are what every core holds before it makes anything (bay.ts `prepare`).
  // A staged release has none beside it: the engine's own landmarks then, and marks the server makes from the city's graphs.
  // The manifest too, from an address: a host that does not give it fails the start here, plainly and in bounded time,
  // not a world's process later. It is then on its way to that process already (`once` holds it a minute).
  const manifest = remote ? new URL(said.manifest ?? '', pointer).href : null
  const [heroesKept, squares, marks, kerbs, mapBin, listed] = await Promise.all([beside('heroes.json'), beside('marks-squares.bin'), beside('marks.bin'), beside('kerbs.bin'), beside('map.bin'), manifest && (existsSync(keptAt(cache, manifest) ?? '') ? { status: 200 } : fetchOnce(manifest))])
  if (listed && listed.status !== 200) throw new Error(`no release at ${pointer}: its manifest did not come (${listed.status === 503 ? `nothing came in ${FETCH_MOST / 1000} s, or the host could not be reached` : listed.status})`)
  const heroes = heroesKept ?? readFileSync(join(here, 'sf', 'heroes.json'))
  const realm = JSON.parse(readFileSync(join(here, 'sf', 'realm.json'), 'utf8'))
  return {
    release, pointer, bytes, read, passed, heroes, squares, marks, kerbs, map: mapBin, remote, cache, fetchOnce,
    /** An object the release lists, by its path in the manifest, checked (page/bay.ts `listed`), where this process reads an address's release itself: null till then. */
    listed: null,
    /** Where one arrives: `--arrive x,y,z,yaw`, else the SF realm's own record (sf/realm.json). */
    arrive: arrive ?? realm.arrive,
    /** An object a page asks for under `/release/`: the pointer, or one of the pinned release's own. Null for anything else. */
    async object(rest) {
      if (rest === 'current.json') return bytes
      // Plain names under the pinned release only: no step up, no escapes, no backslash (`read` is bounded as well).
      if (!rest.startsWith(`releases/${release}/`) || !/^[A-Za-z0-9._/-]+$/.test(rest) || rest.split('/').some((part) => part === '..' || part === '.' || part === '')) return null
      // From an address: the manifest (kept on disk once checked), or only what it lists, through bay.ts (`listed`, set by
      // serve.mjs), checked as tiles are and so kept on disk once. Nothing else is asked of the host.
      if (remote) {
        if (rest === said.manifest) { const answer = await read(new URL(rest, pointer)).catch(() => null); return answer?.ok ? Buffer.from(await answer.arrayBuffer()) : null }
        const dir = said.manifest.replace(/[^/]*$/, '')
        if (!this.listed || !rest.startsWith(dir)) return null
        const body = await this.listed(rest.slice(dir.length)).catch(() => null)
        return body ? Buffer.from(body) : null
      }
      const answer = await read(new URL(rest, pointer)).catch(() => null)
      return answer?.ok ? Buffer.from(await answer.arrayBuffer()) : null
    },
  }
}

/**
 * How a world's process reads what the pinned release names (page/bay.ts `hold`), from what `ground` read: `read` an
 * object as a Response (the pinned pointer itself, a file, or an address's kept copy, else fetched and not yet kept),
 * and `passed` an object that came and passed bay.ts's checks, which for an address is kept on disk from then on.
 */
export function reading({ pointer, bytes, cache = CACHE, remote, fetcher = once() }) {
  cache = resolve(cache)
  // Nothing is read but the pointer and what lies under its pinned release's folder, however a name was spelled.
  const root = new URL(`releases/${JSON.parse(Buffer.from(bytes).toString('utf8')).release}/`, pointer).href
  const read = async (url, init) => {
    const u = new URL(url)
    if (u.href === pointer) return new Response(bytes)
    if (!u.href.startsWith(root) || u.search || u.hash) return new Response('not of the pinned release', { status: 404 })
    if (u.protocol === 'file:') { try { return new Response(readFileSync(fileURLToPath(u))) } catch { return new Response('not there', { status: 404 }) } }
    const path = keptAt(cache, u)
    if (path && existsSync(path)) return new Response(readFileSync(path))
    const got = await fetcher(u.href)
    return new Response(got.body, { status: got.status })
  }
  const passed = (url, body) => { if (!remote) return; const path = keptAt(cache, url); if (path && !existsSync(path)) keep(path, Buffer.from(body)) }
  return { read, passed }
}

/**
 * An address's object fetched once however many ask for it at the same time, and its answer held a minute (till
 * whoever checks it has kept it on disk): {status, body}. The server's own thread holds the one of these its worlds'
 * processes ask through (world.mjs), so the host is asked for an object once.
 */
export function once() {
  const coming = new Map()
  /** Bytes held for whoever checks them: no more than HELD_MOST, past which what comes is not held after it is handed on. */
  let holding = 0
  return (url) => {
    let got = coming.get(url)
    if (!got) {
      // Never longer than this: everyone in the world waits behind a tile on its way. A body cut short is a failure too.
      got = fetch(url, { signal: AbortSignal.timeout(FETCH_MOST) }).then(async (r) => ({ status: r.status, body: r.ok ? new Uint8Array(await r.arrayBuffer()) : null })).catch(() => ({ status: 503, body: null }))
      coming.set(url, got)
      // What came is held a minute for whoever checks and keeps it; what did not is asked for again next time.
      void got.then((g) => {
        if (!g.body || holding + g.body.byteLength > HELD_MOST) return void coming.delete(url)
        holding += g.body.byteLength
        setTimeout(() => { coming.delete(url); holding -= g.body.byteLength }, 60_000).unref()
      })
    }
    return got
  }
}
/** How long an object of an address's release is waited for, ms. */
const FETCH_MOST = 15_000
/** The most bytes of an address's objects held in memory at once, waiting to be checked and kept. */
const HELD_MOST = 64 << 20

/** `--arrive x,y,z,yaw` (cells, radians) as a realm's arrival, or null; throws where it is not four numbers. */
export function arrival(said) {
  if (!said) return null
  const n = said.split(',').map(Number)
  if (n.length !== 4 || !n.every(Number.isFinite)) throw new Error('--arrive is x,y,z,yaw: cells and radians')
  return { at: n.slice(0, 3), yaw: n[3], pitch: 0 }
}
