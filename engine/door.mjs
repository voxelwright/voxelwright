// The door of a dedicated server (#526): strangers' pages reach the world through it, and nothing else does.
//
// It holds the host's socket to a master server (protocol v1, issue #526 and master/README.md), answers each page's
// whole offer with a whole answer (node-datachannel, the lobby-transport skill's recipe), and carries the world's HTTP
// over three data channels:
//   ctl   JSON. The page's hello first: {hello: {proto, pin, name, key, sig, password?}}, where key is the page's
//         public key (SPKI, base64) and sig its signature (ECDSA P-256, SHA-256, IEEE P1363, base64) over
//         `village-door-1 <this connection's DTLS fingerprint>` (page/wire.ts `signed`). The door answers
//         {welcome: {you, name, spot, server}} (spot: the lowest place number nobody else here holds) or {refuse: {why}} and closes. Then {ping} and {pong}, {unstream: n} (the
//         page stops reading a stream), an admin's password and the lobby's ops ({n, admin}, {n, lobby: {op}}
//         answered {n, ok} or {n, why}), who is here for anyone let in ({n, people: true}: {n, ok, people: [{name, me?}]}), {told: {text}} (the server says something), {end: {n, why}} (a stream ended)
//         and {gone: {why}} (the door closes this connection).
//   up    a request: a JSON head {n, m (method), p (path and query), k (parts)}, then k binary parts that are its
//         body. Its reply: {n, s (status), t (type), k}, then k binary parts; or {n, s: 200, stream: true} for a stream.
//   down  a stream's bytes: each message is four bytes (the request's n, little-endian) and what follows.
// A message is at most what both ends take (page/wire.ts CHUNK), and a peer that takes less than CHUNK_LEAST is refused.
//
// Who someone is comes from their connection: `you` is made from the page's public key, with a key only this server
// holds, and the page proves it holds the private key on this connection alone. Every request a connection makes is
// done as `you`, whatever `by` the page wrote. The door passes only the routes in ROUTES, rebuilds each address from
// the table, and holds each connection to limits of its own. Nothing a page sends is run: it is checked and passed on
// as data, or refused.
import { createHmac, createPublicKey, randomBytes, scrypt as scryptCb, timingSafeEqual, verify } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { promisify } from 'node:util'
import { RTCPeerConnection } from 'node-datachannel/polyfill'
import { text } from './text.mjs'
import { CHUNK, CHUNK_LEAST, PROTO, fingerprintOf, gathered, signed } from './page/wire.ts'
import { BEHIND, BODIES, ECHO, SKIPPED } from './page/frames.ts'

const scrypt = promisify(scryptCb)
/** A down channel's bytes in flight before the door waits for it to drain, and where it starts sending again. */
const HIGH = 1 << 20, LOW = 256 << 10
/**
 * A join that has not said hello (its channels not open yet, open and silent, or its hello still being checked) holds a
 * place at the door for JOIN_WAIT from its offer at most. PENDING_MOST of them wait at once, as many as the master lets
 * wait on one host. An offer waits PLACE_WAIT at most for a place before it is refused as busy: well under the 10 s the
 * master waits for an answer, with gathering's 0.6 to 3 s after it.
 */
const JOIN_WAIT = 8_000, PLACE_WAIT = 3_000, SILENT = 15_000, PENDING_MOST = 8
/**
 * A join's answer is on its way for FRESH after it leaves for the master: the join is not let go before then unless its
 * channels are open, or the page would have an answer for a connection already closed (and say its network is at fault,
 * not that the server was busy). A page's connects in under a second (the lobby-transport skill: 0.4 to 0.6 s across
 * a NAT); on a loaded host, one took over a second here. One not connected CONNECT_GRACE after its answer left is likely never to be: it is let go first.
 */
const FRESH = 2_000, CONNECT_GRACE = 3_000
/** How long a join whose channels are open has for its hello before it may be let go (a page sends it at once). */
const HELLO_GRACE = 500
/**
 * Messages to the master in any second, at most: it closes a host that sends over 50 (`host_messages_per_second`), and
 * a burst of offers refused at once would otherwise be a burst of replies.
 */
const MASTER_RATE = 40
/** The most a request's body may be: 8 MB, and 16 MB for a look's cells (POST /world/fine). */
const BODY_MOST = 8 << 20, FINE_MOST = 16 << 20
const CTL_MOST = 4096, INFLIGHT_MOST = 8, STREAMS_MOST = 1
const RULE_ID = /^[a-z0-9][a-z0-9-]{0,23}$/
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/

/**
 * What passes the door, and nothing else (the README says why each is on its side). `who`: everyone, builders
 * (everyone, or admins only when the server says so) or admins. `by`: where the door writes who asked (the body's
 * `by`, and for `here` its `name` too). `q`: the query's names that are passed on, each a whole number or a short
 * word; anything else in a query is dropped. `rate`: a pool of the connection's own that the route also counts against
 * (`pools` in `answer`). A path is matched whole and the address upstream is built from the match: a page's path is
 * never sent as it came.
 */
const ROUTES = [
  // Being in the world
  { m: 'GET', p: '/world/stream', who: 'all', q: ['from'], stream: true, rate: 'stream', why: 'the world as it happens: what is kept, then what is done' },
  { m: 'POST', p: '/world/here', who: 'all', by: 'here', rate: 'here', why: 'where this page\'s person is, under the name it joined with' },
  { m: 'POST', p: '/world/say', who: 'all', by: 'body', rate: 'say', why: 'talking: heard by whoever is near' },
  { m: 'POST', p: '/world/act', who: 'all', by: 'body', rate: 'act', why: 'doing what a rule offers (playing its game)' },
  { m: 'POST', p: '/world/pick', who: 'all', by: 'body', rate: 'act', why: 'picking from what a rule shows' },
  { m: 'POST', p: '/world/drive', who: 'all', by: 'drive', rate: 'drive', why: 'riding a living thing: only the one this connection is on' },
  // Asking about the world: answers, nothing changed
  { m: 'GET', p: '/world/at', who: 'all', q: ['x', 'y', 'z'], rate: 'look', why: 'what a cell is' },
  { m: 'GET', p: '/world/look', who: 'all', q: ['x', 'y', 'z', 'dx', 'dy', 'dz'], rate: 'look', why: 'what a line meets' },
  { m: 'GET', p: '/world/tops', who: 'all', q: ['x0', 'z0', 'x1', 'z1', 'y'], rate: 'look', columns: true, why: 'the first thing down a rectangle of columns' },
  { m: 'GET', p: '/world/things', who: 'all', q: ['id'], rate: 'look', why: 'the made things\' records, and one with its cells' },
  { m: 'GET', p: '/world/realm', who: 'all', rate: 'look', why: 'what the world is called and how it looks' },
  { m: 'GET', p: '/world/ground', who: 'all', rate: 'look', why: 'what the world stands on' },
  { m: 'GET', p: '/world/rules', who: 'all', q: ['given'], rate: 'look', why: 'how each rule is doing, without its source' },
  { m: 'GET', p: /^\/world\/fine\/([0-9a-f]{64})$/, who: 'all', rate: 'look', why: 'a living thing\'s look in finer cells' },
  { m: 'HEAD', p: /^\/world\/fine\/([0-9a-f]{64})$/, who: 'all', rate: 'look', why: 'whether such a look is kept' },
  // Changing the world: what a person does with their hands
  { m: 'POST', p: '/world/ask', who: 'build', by: 'body', rate: 'ask', ask: true, why: 'blasts, fire, balls, bricks, made things and what is done with them; rules and the realm\'s record are refused here (below)' },
  { m: 'POST', p: '/world/fine', who: 'build', rate: 'fine', most: FINE_MOST, why: 'the cells of a living thing\'s look' },
  // What changes the game for everyone: admins only
  { m: 'POST', p: '/world/ask', who: 'admin', by: 'body', rate: 'ask', rules: true, why: 'a rule put in, changed or taken out; the realm\'s name, about, arrival, look and director' },
  { m: 'GET', p: '/world/rules', who: 'admin', q: ['id'], rate: 'look', why: 'a rule\'s source: the host\'s work' },
  { m: 'POST', p: '/world/gap', who: 'admin', by: 'body', rate: 'ask', why: 'what a rule\'s maker could not do, kept for the workshop' },
  { m: 'GET', p: '/gaps', who: 'admin', rate: 'look', why: 'all of those' },
  { m: 'GET', p: '/realms', who: 'admin', rate: 'look', why: 'the realms this server keeps' },
  { m: 'POST', p: '/realms', who: 'admin', by: 'body', rate: 'ask', why: 'a realm made' },
  { m: 'DELETE', p: /^\/realm\/([a-z0-9][a-z0-9-]{0,39})$/, who: 'admin', rate: 'ask', why: 'a realm taken out' },
  { m: 'GET', p: '/plugins', who: 'admin', rate: 'look', why: 'the engine\'s plugins on the host' },
  { m: 'POST', p: '/plugins/look', who: 'admin', rate: 'ask', why: 'the plugins read again from the host\'s disk' },
  { m: 'POST', p: '/core/look', who: 'admin', rate: 'ask', why: 'the core read again from the host\'s disk' },
]
/** A connection's own limits, a second unless said (flags of server.mjs). `backlog` is bytes of replies a page has asked for and not read. */
const LIMITS = { asks: 30, upMinute: 24 << 20, columns: 65536, backlog: 32 << 20, ask: 15, say: 3, here: 15, act: 10, drive: 12, look: 20,
  // What one person who is not an admin may make (#526), kept by who they are, not by their connection: things made a
  // minute, changes to things' records a minute (each is kept for good), things standing and their cells all told
  // (the world's server counts those: serve.mjs `stranger`), and how far from where their page says they are (cells).
  thingsMinute: 6, changesMinute: 30, things: 40, cells: 4_000_000, reach: 1200,
  // Joins that have not said hello from one address at once (known once their connection is: the offer's own
  // addresses are whatever its sender wrote). Past it, that address's oldest is let go.
  waitingPerAddress: 2 }

/** A pool that fills again over `per` ms: `take(n)` is false when it would go under. */
const pool = (most, per = 1000) => { let left = most, since = Date.now(); const fill = () => { const now = Date.now(); left = Math.min(most, left + ((now - since) / per) * most); since = now }; return { take(n = 1) { fill(); if (left < n) return false; left -= n; return true }, give(n = 1) { fill(); left = Math.min(most, left + n) }, left() { fill(); return left } } }

/** A password as it is kept: a slow hash and its salt. */
const sealed = async (password, salt) => (await scrypt(String(password).normalize('NFC'), Buffer.from(salt, 'hex'), 32, { N: 1 << 14 })).toString('hex')
const seal = async (password) => { const salt = randomBytes(16).toString('hex'); return { salt, hash: await sealed(password, salt) } }
/** Whether a password matches the kept hash: compared in constant time, never logged. */
const same = async (password, kept) => { if (!kept || typeof password !== 'string' || password.length > 256) return false; const a = Buffer.from(await sealed(password, kept.salt), 'hex'), b = Buffer.from(kept.hash, 'hex'); return a.length === b.length && timingSafeEqual(a, b) }

/**
 * Tries at a password, by connection and by address. A try is counted before its hash is worked out, so guesses sent
 * together wait as guesses sent one by one do: two seconds before the next, doubled with each, to half a minute. A
 * right one clears what it was counted against.
 */
function tries() {
  const by = new Map()
  const wait = (key) => { const t = by.get(key); return t ? Math.max(0, t.until - Date.now()) : 0 }
  return {
    wait: (keys) => Math.max(0, ...keys.map(wait)),
    tried(keys) { for (const key of keys) { const t = by.get(key) ?? { fails: 0, until: 0 }; t.fails++; t.until = Date.now() + Math.min(30_000, 2000 * 2 ** (t.fails - 1)); t.last = Date.now(); by.set(key, t) } },
    passed(keys) { for (const key of keys) by.delete(key) },
    // Forgotten a quarter of an hour after the last try.
    sweep() { for (const [key, t] of by) if (Date.now() - t.last > 15 * 60_000) by.delete(key) },
  }
}

/** STUN servers as IPv4 literals: libdatachannel with a hostname and no IPv6 route never finishes gathering (the skill). */
async function literal(servers) {
  const out = []
  for (const s of servers ?? []) for (const url of [].concat(s.urls ?? [])) {
    const m = /^(stuns?):([^:?]+)(?::(\d+))?/.exec(url)
    if (!m) continue
    try { out.push({ urls: `${m[1]}:${(await lookup(m[2], { family: 4 })).address}:${m[3] ?? '3478'}` }) } catch { /* not found: left out */ }
  }
  return out
}
/** The addresses an SDP's candidates name (to refuse a banned one before any channel opens). */
const addressesIn = (sdp) => [...String(sdp).matchAll(/a=candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ/g)].map((m) => m[1]).filter((a) => !a.endsWith('.local'))
/**
 * Who an address is for per-address limits, eviction rank and bans: an IPv4 address unchanged, an IPv4-mapped IPv6
 * address as its IPv4, and any other IPv6 address as its /56 (the same rule the master uses in `master/src/text.rs`).
 */
export function addressKey(address) {
  if (typeof address !== 'string') return null
  const raw = address.trim().replace(/^\[|\]$/g, '').split('%')[0]
  if (!raw) return null
  const family = isIP(raw)
  if (family === 4) return raw
  if (family !== 6) return raw.toLowerCase()
  let text = raw.toLowerCase()
  const lastColon = text.lastIndexOf(':')
  if (lastColon >= 0 && text.includes('.')) {
    const v4 = text.slice(lastColon + 1)
    if (isIP(v4) !== 4) return text
    const b = v4.split('.').map(Number)
    text = `${text.slice(0, lastColon)}:${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return text
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return text
  const s = [...left, ...Array(missing).fill('0'), ...right].map((p) => parseInt(p, 16))
  if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0 && s[4] === 0 && s[5] === 0xffff) {
    return `${s[6] >> 8}.${s[6] & 0xff}.${s[7] >> 8}.${s[7] & 0xff}`
  }
  return `${s[0].toString(16)}:${s[1].toString(16)}:${s[2].toString(16)}:${(s[3] & 0xff00).toString(16)}::/56`
}
/** Whether an SDP has what a WebRTC data-channel offer must have, checked before it waits for or takes a place. */
const looksLikeOffer = (sdp) =>
  typeof sdp === 'string' &&
  sdp.length <= 16384 &&
  /^v=0\r?\n/.test(sdp) &&
  /^m=application /m.test(sdp) &&
  /^a=fingerprint:sha-256 (?:[0-9a-f]{2}:){31}[0-9a-f]{2}\r?$/im.test(sdp) &&
  /^a=ice-ufrag:\S+\r?$/m.test(sdp) &&
  /^a=ice-pwd:\S+\r?$/m.test(sdp)
/** Whether a hello's key signed this connection's fingerprint. */
function proves(h, fingerprint) {
  if (!fingerprint || typeof h.key !== 'string' || typeof h.sig !== 'string' || h.key.length > 200 || h.sig.length > 200) return false
  try { return verify('sha256', Buffer.from(signed(fingerprint)), { key: createPublicKey({ key: Buffer.from(h.key, 'base64'), format: 'der', type: 'spki' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(h.sig, 'base64')) } catch { return false }
}
/** A name someone typed, as others see it: no invisible or direction-turning characters, and no "/" (a rule's actor has one). */
const nameOf = (v) => text(v, 24).normalize('NFKC').replace(/[\p{Cf}\p{Zs}]+/gu, ' ').replace(/\//g, ' ').trim() || 'someone'

/**
 * Opens the door. `o`: {world (the world's server, http://127.0.0.1:port), master (address, or null), name, about,
 * most, listed, pin, keep (the file beside the world's that holds bans and settings), password and admin (as read
 * from their files, or null), ports ([first, last] for ICE), limits}. Answers {lobby: Promise<{id, code}>, close()}.
 * A file of settings that is there and cannot be read stops it: written again, its bans and key would be lost.
 */
export function door(o) {
  const log = console.log
  const limits = { ...LIMITS, ...o.limits }
  // ── What is kept beside the world's file ──
  const fresh = { secret: randomBytes(32).toString('hex'), bans: [], password: null, most: 8, build: 'everyone', name: '', about: '' }
  let kept = fresh
  if (existsSync(o.keep)) {
    try { kept = { ...fresh, ...JSON.parse(readFileSync(o.keep, 'utf8')) } } catch (e) { throw new Error(`the door's settings in ${o.keep} cannot be read (${e.message}): mend or move that file; it holds the bans and the key every player's id is made with`) }
  }
  const save = () => { writeFileSync(`${o.keep}.part`, JSON.stringify(kept, null, 1), { mode: 0o600 }); renameSync(`${o.keep}.part`, o.keep) }
  const keyed = (what, v) => createHmac('sha256', kept.secret).update(`${what}:${v}`).digest('hex')
  /** Who a page's key is here: the same every time it comes, and nothing another server can work out from it. */
  const youOf = (key) => `v${keyed('key', key).slice(0, 9)}`
  /** An address as it is kept: keyed by its IPv4 or IPv6 /56, so the file does not hold it plainly (the key is beside it: see the README). */
  const placeOf = (address) => { const k = addressKey(address); return k ? keyed('address', k).slice(0, 24) : null }
  // What the command line says wins at start; what an admin changes is kept until the next start with a flag that says otherwise.
  if (o.name) kept.name = text(o.name, 48)
  if (o.about !== undefined && o.about !== null) kept.about = text(o.about, 200)
  if (o.most) kept.most = Math.max(1, Math.min(64, Math.floor(o.most)))
  const ready = (async () => { if (o.password) kept.password = await seal(o.password); save() })()
  const adminSealed = o.admin ? seal(o.admin) : null
  const failing = tries()
  setInterval(() => failing.sweep(), 60_000).unref()

  /** What each person has made lately, by who they are: a page that joins again is the same person, with the same pools. */
  const makers = new Map()
  // Forgotten once their pools are full again: nothing is lost by that, and a stream of new keys leaves nothing behind.
  setInterval(() => { for (const [you, m] of makers) if (m.made.left() >= limits.thingsMinute && m.changed.left() >= limits.changesMinute) makers.delete(you) }, 60_000).unref()
  const makerOf = (c) => { if (!makers.has(c.you)) makers.set(c.you, { made: pool(limits.thingsMinute, 60_000), changed: pool(limits.changesMinute, 60_000) }); return makers.get(c.you) }
  /** Whether someone may make a thing now, and why not: asked by their page before any model is (page/door.ts `may`), and again by the ask itself. */
  const mayMake = (c) => (c.admin ? null : kept.build === 'admins' ? 'on this server only admins build' : makerOf(c).made.left() < 1 ? `you have made ${limits.thingsMinute} things this minute: wait a little` : null)
  /** Every connection, welcomed or not; a welcomed one has `you`. */
  const conns = new Set()
  const welcomed = () => [...conns].filter((c) => c.you)
  /** Joins answered and not yet let in or closed. */
  const pending = () => [...conns].filter((c) => !c.you)
  /**
   * Peer connections not yet closed, and offers that have a place and are making theirs. Each holds a UDP port: with
   * --ice-ports that is what the range must hold. A connection closed late (its last word going out) is counted until
   * it is closed, though it is no longer in `conns`.
   */
  let held = 0, placing = 0
  const ports = o.ports ? o.ports[1] - o.ports[0] + 1 : Infinity
  /**
   * Whether a join has had its chance: its channels have been open HELLO_GRACE; or, with none open, its answer left
   * FRESH ago. Before then a page could not have said hello, and one let go would hold an answer for a connection
   * already closed. (Channels that open late still get their HELLO_GRACE: the hello is a round trip behind them.)
   */
  const settled = (c, at) => !!c.sent && (c.ready ? at - c.ready > HELLO_GRACE : at - c.sent > FRESH)
  /** Joins waiting from an address key (IPv4 or IPv6 /56), whether or not they have had their chance. */
  const waitingFrom = (key) => pending().filter((d) => d.addressKey === key && !d.greeting).length
  /**
   * The join to let go when an offer needs its place: one already refused, then one still not connected well after its
   * offer, then one from the address key with the most joins waiting, then the one silent longest (since it connected, or
   * since its offer). A page says hello the moment its channels open, so the one silent longest is the least likely
   * to be one. One whose hello is being checked is not let go: that takes a moment.
   */
  function evictable() {
    const at = Date.now(), silent = pending().filter((c) => settled(c, at) && (!c.greeting || c.refused))
    const rank = (c) => [c.refused ? 1 : 0, !c.connected && at - c.sent > CONNECT_GRACE ? 1 : 0, c.addressKey ? waitingFrom(c.addressKey) : 1, -(c.connected ?? c.sent)]
    const before = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0 }
    return silent.sort(before)[0]
  }
  /** Once a join's address is known (its connection's, never its offer's): past the most for one address key, the one of that key silent longest goes. */
  function counted(c) {
    if (c.closed) return
    c.connected ??= Date.now()
    if (!c.address) try { c.address = c.pc.selectedCandidatePair()?.remote?.address ?? null } catch { /* not known */ }
    const key = addressKey(c.address)
    if (!key) return
    c.addressKey = key
    // Asked again as each join of the address connects and as its channels open. The join that has just come is kept,
    // and so is one that has not had its chance yet (`settled`): a join over the most goes once it has.
    const at = Date.now(), same = pending().filter((d) => d.addressKey === key && !d.greeting)
    let over = same.length - limits.waitingPerAddress
    for (const d of same.filter((d) => d !== c && settled(d, at)).sort((a, b) => a.connected - b.connected)) if (over-- > 0) close(d)
  }
  /**
   * Offers waiting for a place, served strictly in arrival order (first come, first served). Each place claimed here
   * increments `held` and `placing` synchronously before the waiter resumes, so nothing arriving later can jump ahead.
   */
  const waiters = []
  let poll = null, serving = false
  const stopPoll = () => { if (poll) { clearInterval(poll); poll = null } }
  const startPoll = () => { if (!poll) poll = setInterval(serve, 25).unref() }
  function claim() {
    while (held >= ports || pending().length + placing >= PENDING_MOST) {
      const oldest = evictable()
      if (!oldest) return false
      close(oldest)
    }
    held++; placing++
    return true
  }
  function serve() {
    if (serving) return
    serving = true
    try {
      while (waiters.length) {
        if (stopped) {
          const w = waiters.shift()
          w.done = true
          clearTimeout(w.timer)
          w.resolve(false)
          continue
        }
        if (!claim()) break
        const w = waiters.shift()
        w.done = true
        clearTimeout(w.timer)
        w.resolve(true)
      }
      if (!waiters.length) stopPoll()
    } finally {
      serving = false
    }
  }
  function takePlace(until) {
    if (stopped) return false
    if (!waiters.length && claim()) return true
    const left = until - Date.now()
    if (left <= 0) return false
    return new Promise((resolve) => {
      const w = { done: false, resolve, timer: null }
      w.timer = setTimeout(() => {
        if (w.done) return
        w.done = true
        const i = waiters.indexOf(w)
        if (i >= 0) waiters.splice(i, 1)
        if (!waiters.length) stopPoll()
        resolve(false)
        serve()
      }, left)
      waiters.push(w)
      startPoll()
      serve()
    })
  }

  // ── The master ──
  let master = null, stopped = false
  const { promise: lobby, resolve: tellLobby } = Promise.withResolvers()
  let iceServers = []
  const hello = () => ({ proto: PROTO, name: kept.name || 'A Village server', about: kept.about, pin: o.pin, most: kept.most, locked: !!kept.password, listed: o.listed !== false })
  /**
   * What goes to the master, paced to MASTER_RATE in any second; dropped with the socket it was for. An answer that
   * is never sent takes its join with it (`join`): nobody will ever connect to it, and it would hold a place that
   * no offer could take (it is not `settled` until its answer has left).
   */
  let outbox = [], sent = []
  function toMaster(m, then, join) {
    if (master?.readyState !== 1) { if (join) close(join); return }
    outbox.push({ text: JSON.stringify(m), then, join })
    if (outbox.length === 1) drain()
  }
  const unsent = () => { const left = outbox; outbox = []; for (const { join } of left) if (join) close(join) }
  function drain() {
    while (outbox.length && master?.readyState === 1) {
      const at = Date.now()
      sent = sent.filter((t) => at - t < 1000)
      if (sent.length >= MASTER_RATE) return void setTimeout(drain, 1000 - (at - sent[0]) + 5).unref()
      sent.push(at)
      const { text, then } = outbox.shift()
      master.send(text)
      then?.()
    }
  }
  const now = (more = {}) => toMaster({ now: { players: welcomed().length, ...more } })
  async function hold(wait = 1000) {
    if (stopped || !o.master) return
    try { iceServers = await literal((await (await fetch(`${o.master}/ice`, { signal: AbortSignal.timeout(10_000) })).json()).iceServers) } catch { iceServers = [] }
    const ws = new WebSocket(`${o.master.replace(/^http/, 'ws')}/host`)
    master = ws
    let beat = null
    ws.onopen = async () => { await ready; if (master !== ws) return; unsent(); toMaster({ hello: hello() }); beat = setInterval(() => now(), 15_000) }
    ws.onmessage = (e) => {
      let m
      try { m = JSON.parse(String(e.data)) } catch { return }
      if (m.welcome && typeof m.welcome.id === 'string') { wait = 1000; tellLobby({ id: m.welcome.id, code: m.welcome.code }); log(`listed with the master as lobby ${m.welcome.id}${o.listed === false ? ' (not listed: joined by its code only)' : ''}; its private code is ${m.welcome.code}`) }
      else if (m.offer && Number.isInteger(m.offer.n)) void answer(m.offer.n, m.offer.sdp).then(([r, c]) => { if (master === ws) toMaster(r, c && (() => { c.sent = Date.now() }), c); else if (c) close(c) })
    }
    ws.onclose = (e) => {
      clearInterval(beat)
      if (master === ws) { master = null; unsent() }
      if (stopped) return
      if (e.code === 4403) return log(`the master took this lobby off or refused it (${String(e.reason).slice(0, 120)}): nobody can find it now`)
      log(`the master's socket closed (${e.code}${e.reason ? `: ${String(e.reason).slice(0, 120)}` : ''}): trying again in ${Math.round(wait / 1000)} s`)
      setTimeout(() => hold(Math.min(60_000, wait * 2)), wait).unref()
    }
  }
  void hold()

  // ── A join ──
  /** Answers [what the master is told, the join when it has one]. */
  async function answer(n, sdp) {
    if (!looksLikeOffer(sdp)) return [{ refuse: { n, why: 'that is not an offer' } }]
    // Full is said at the hello, once it is known who is asking: the same person from another page is let in there.
    if (addressesIn(sdp).some((a) => kept.bans.some((b) => b.place && b.place === placeOf(a)))) return [{ refuse: { n, why: 'you are banned from this server' } }]
    // A place: a port (with --ice-ports) and fewer than PENDING_MOST joins waiting. Without one, a join that has not
    // said hello gives its up: joins that say nothing cannot keep the door shut. With none to let go (every port a
    // player's, or hellos being checked), the offer waits its turn in order, a while.
    const until = Date.now() + PLACE_WAIT
    if (!(await takePlace(until))) return [{ refuse: { n, why: 'the server is busy: try again in a moment' } }]
    let pc, c, placed = true
    const unplace = () => { if (placed) { placed = false; placing-- } }
    try {
      if (stopped) { unplace(); held--; serve(); return [{ refuse: { n, why: 'the server is busy: try again in a moment' } }] }
      // libdatachannel frees a closed connection's port on a thread of its own, a millisecond or three after close()
      // (measured: 0.6 to 2.7 ms), and a peer connection made before then finds no port in the range: it is made again.
      const bindUntil = Math.max(until, Date.now() + 200)
      for (;;) {
        pc = new RTCPeerConnection({ iceServers, ...(o.ports ? { portRangeBegin: o.ports[0], portRangeEnd: o.ports[1] } : {}) })
        try { await pc.setRemoteDescription({ type: 'offer', sdp }); break } catch (e) {
          try { pc.close() } catch { /* already */ }
          pc = null
          if (!/gather/i.test(String(e?.message)) || Date.now() >= bindUntil || stopped) throw e
          await new Promise((r) => setTimeout(r, 10))
        }
      }
      if (stopped) { try { pc.close() } catch { /* already */ } pc = null; unplace(); held--; serve(); return [{ refuse: { n, why: 'the server is busy: try again in a moment' } }] }
      c = { pc, ch: {}, n, chunk: CHUNK_LEAST, you: null, name: '', admin: false, address: null, addressKey: null, since: Date.now(), last: Date.now(), streams: new Map(), parts: null, inflight: 0, riding: new Set(), seat: null, closed: false, aborts: new Set(), queued: 0, queue: [], drained: null,
        pools: { ctl: pool(20), fine: pool(4, 60_000), stream: pool(2, 10_000), asks: pool(limits.asks), up: pool(limits.upMinute, 60_000), columns: pool(limits.columns), ask: pool(limits.ask), say: pool(limits.say), here: pool(limits.here), act: pool(limits.act), drive: pool(limits.drive), look: pool(limits.look) } }
      // The place is the join's now: its port is given back when it closes. A peer connection closed while it is being
      // answered never settles what it was doing (libdatachannel), so each step is raced against its closing.
      c.gone = Promise.withResolvers()
      const unless = (step) => Promise.race([step, c.gone.promise])
      conns.add(c); unplace()
      // However it stalls (channels never open, open and silent, a hello never finished), it is gone by then.
      // (One whose hello is being checked is left to that: it is welcomed or refused in a moment, with the true reason.)
      c.joinBy = setTimeout(() => { if (c.you || (c.greeting && !c.refused)) return; if (c.ready && !c.refused) refuse(c, 'no hello came'); else close(c) }, JOIN_WAIT)
      pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'connected') counted(c); if (['failed', 'closed'].includes(pc.connectionState)) close(c) })
      pc.addEventListener('datachannel', ({ channel }) => {
        if (!['ctl', 'down', 'up'].includes(channel.label) || c.ch[channel.label]) return channel.close()
        c.ch[channel.label] = channel
        channel.addEventListener('close', () => close(c))
        // Heard from the moment the channel is here: a page may say hello before the door has seen all three open, and
        // a message with nobody listening is lost.
        if (channel.label === 'ctl') channel.addEventListener('message', (e) => void ctl(c, e.data))
        if (channel.label === 'up') channel.addEventListener('message', (e) => up(c, e.data))
        if (channel.label === 'down') channel.addEventListener('bufferedamountlow', () => flush(c))
        channel.addEventListener('open', () => {
          if (c.ready || !['ctl', 'down', 'up'].every((k) => c.ch[k]?.readyState === 'open')) return
          c.ready = Date.now()
          const most = pc.sctp.maxMessageSize
          // A peer that says it takes tiny messages would have every frame sent a byte at a time, or never.
          if (!(most >= CHUNK_LEAST)) return close(c)
          c.chunk = Math.min(CHUNK, most)
          counted(c)
          // Asked again once its own hello's time is up, for the joins of its address that were not yet over it.
          setTimeout(() => counted(c), HELLO_GRACE + 10).unref()
          c.ch.down.bufferedAmountLowThreshold = LOW
        })
      })
      await unless(pc.createAnswer().then((a) => pc.setLocalDescription(a)))
      await unless(gathered(pc, iceServers.length > 0))
      if (c.closed) return [{ refuse: { n, why: 'the server is busy: try again in a moment' } }]
      c.fingerprint = fingerprintOf(pc.localDescription.sdp)
      return [{ answer: { n, sdp: pc.localDescription.sdp } }, c]
    } catch {
      if (c) close(c)
      else { try { pc?.close() } catch { /* already */ } unplace(); held--; serve() }
      return [{ refuse: { n, why: 'the server could not answer that offer' } }]
    }
  }

  const tell = (c, m) => { try { if (c.ch.ctl?.readyState === 'open') c.ch.ctl.send(JSON.stringify(m)) } catch { /* closing */ } }
  const refuse = (c, why) => { c.refused = true; tell(c, { refuse: { why } }); setTimeout(() => close(c), 200); serve() }
  function close(c, why) {
    if (c.closed) return
    if (why && c.you) tell(c, { gone: { why } })
    c.closed = true
    c.gone?.resolve()
    conns.delete(c)
    clearTimeout(c.joinBy)
    for (const a of c.aborts) a.abort()
    c.queue = []; c.queued = 0
    c.drained?.(false)
    // Let a player's last word go out before the line is cut; anyone else's is cut now. Its port is counted as held
    // until then, and is free a moment after (`answer`).
    const cut = () => { try { c.pc.close() } catch { /* already */ } held--; serve() }
    if (why && c.you) setTimeout(cut, 300)
    else cut()
    if (c.you) { log(`${c.name} (${c.you}) left${why ? `: ${why}` : ''}`); now() }
  }
  // A page says something at least every few seconds (its pings): one silent for long is gone, and its place is free.
  setInterval(() => { for (const c of conns) if (c.you && Date.now() - c.last > SILENT) close(c, 'nothing heard from this page for a while') }, 2000).unref()

  // ── ctl ──
  async function ctl(c, data) {
    c.last = Date.now()
    if (typeof data !== 'string' || data.length > CTL_MOST) return close(c, 'that was not a message of this door')
    if (!c.pools.ctl.take()) return close(c, 'too many messages')
    let m
    try { m = JSON.parse(data) } catch { return close(c, 'that was not JSON') }
    if (!m || typeof m !== 'object') return
    if (!c.you) {
      if (!m.hello || c.greeting) return refuse(c, 'the first thing said is hello')
      c.greeting = true
      return greet(c, m.hello)
    }
    if (m.ping !== undefined) return tell(c, { pong: Number(m.ping) || 0 })
    if (m.unstream !== undefined) return void c.streams.get(m.unstream)?.abort()
    if (!Number.isInteger(m.n)) return
    if (m.admin !== undefined) return tell(c, { n: m.n, ...(await becomeAdmin(c, m.admin)) })
    if (m.may === 'make') { const why = mayMake(c); return tell(c, { n: m.n, ...(why ? { why } : { ok: true }) }) }
    // Who is here, for anyone let in: names as the server made them, and which is the asker. No ids, no addresses (an admin's `who` has the ids).
    if (m.people === true) return tell(c, { n: m.n, ok: true, people: welcomed().map((w) => ({ name: w.name, ...(w === c ? { me: true } : {}) })) })
    if (m.lobby && typeof m.lobby === 'object') return tell(c, { n: m.n, ...(await op(c, m.lobby)) })
  }
  async function greet(c, h) {
    if (!h || typeof h !== 'object') return refuse(c, 'a hello is an object')
    if (h.proto !== PROTO) return refuse(c, `this server speaks protocol ${PROTO}`)
    if (h.pin !== o.pin) return refuse(c, o.pin === 'town' ? 'this server is the generated town, and your page was made for another world' : `this server holds San Francisco release ${String(o.pin).slice(0, 12)}, and your page was made for another`)
    if (!proves(h, c.fingerprint)) return refuse(c, 'a hello is signed by the page\'s own key')
    const you = youOf(h.key), place = placeOf(c.address)
    const banned = () => kept.bans.some((b) => b.you === you || (b.place && b.place === place))
    if (banned()) return refuse(c, 'you are banned from this server')
    if (!welcomed().some((w) => w.you === you) && welcomed().length >= kept.most) return refuse(c, 'the server is full')
    if (kept.password) {
      if (typeof h.password !== 'string') return refuse(c, 'this server asks for a password')
      const keys = [`c:${c.n}`, ...(place ? [`a:${place}`] : [])], wait = failing.wait(keys)
      if (wait) return refuse(c, `too many wrong passwords: wait ${Math.ceil(wait / 1000)} s`)
      failing.tried(keys)
      if (!(await same(h.password, kept.password))) return refuse(c, 'wrong password')
      failing.passed(keys)
    }
    if (c.closed || c.refused) return
    // Asked again with nothing awaited from here to `c.you = you`: two hellos at once cannot both pass.
    if (banned()) return refuse(c, 'you are banned from this server')
    const again = welcomed().find((w) => w.you === you)
    if (!again && welcomed().length >= kept.most) return refuse(c, 'the server is full')
    // The same person from another page (a reload): the newer page is them, and the older one is let go.
    if (again) close(again, 'you joined again from another page')
    c.you = you
    // A name is what someone typed: shown, never trusted. Two that look alike are told apart.
    const wanted = nameOf(h.name)
    let name = wanted
    for (let i = 2; welcomed().some((w) => w !== c && w.name.toLowerCase() === name.toLowerCase()); i++) name = `${wanted.slice(0, 20)} (${i})`
    c.name = name
    // Its place among those here (page/arrival.ts): the lowest number nobody else here holds, so that pages let in
    // together stand apart. Only the door sees every join.
    for (c.spot = 0; welcomed().some((w) => w !== c && w !== again && w.spot === c.spot); c.spot++);
    clearTimeout(c.joinBy)
    tell(c, { welcome: { you, name, spot: c.spot, server: { name: kept.name, about: kept.about, most: kept.most, build: kept.build, admins: !!adminSealed } } })
    log(`${name} (${you}) joined`)
    now()
    serve()
  }
  async function becomeAdmin(c, password) {
    if (!adminSealed) return { why: 'this server has no admins' }
    const place = placeOf(c.address), keys = [`admin:${c.n}`, ...(place ? [`admin:${place}`] : [])], wait = failing.wait(keys)
    if (wait) return { why: `too many wrong passwords: wait ${Math.ceil(wait / 1000)} s` }
    failing.tried(keys)
    if (!(await same(password, await adminSealed))) {
      // Said a second later, whatever the wait: a guess costs time.
      await new Promise((r) => setTimeout(r, 1000))
      return { why: 'wrong password' }
    }
    failing.passed(keys)
    c.admin = true
    log(`${c.name} (${c.you}) is an admin`)
    return { ok: true }
  }
  /** What an admin may do to the lobby. Everything here is said back plainly; names and words are text someone typed. */
  async function op(c, l) {
    if (!c.admin) return { why: 'only an admin may' }
    const target = typeof l.you === 'string' ? welcomed().find((w) => w.you === l.you) : null
    switch (l.op) {
      case 'who': return { ok: true, people: welcomed().map((w) => ({ you: w.you, name: w.name, admin: w.admin, since: w.since, address: !!w.address })) }
      case 'kick': if (!target) return { why: 'nobody of that id is here' }; close(target, 'an admin kicked you'); return { ok: true }
      case 'ban': {
        if (typeof l.you !== 'string' || !/^v[0-9a-f]{9}$/.test(l.you)) return { why: 'a ban is of someone\'s id (who)' }
        if (l.address && !target?.address) return { why: 'their address is known only while they are here' }
        kept.bans = kept.bans.filter((b) => b.you !== l.you)
        kept.bans.push({ you: l.you, name: target?.name ?? '', at: new Date().toISOString(), ...(l.address ? { place: placeOf(target.address) } : {}) })
        save()
        if (target) close(target, 'an admin banned you from this server')
        return { ok: true }
      }
      case 'unban': { const was = kept.bans.length; kept.bans = kept.bans.filter((b) => b.you !== l.you); save(); return was === kept.bans.length ? { why: 'nobody of that id is banned' } : { ok: true } }
      case 'bans': return { ok: true, bans: kept.bans.map((b) => ({ you: b.you, name: b.name, at: b.at, address: !!b.place })) }
      case 'password': {
        if (l.password !== null && (typeof l.password !== 'string' || !l.password || l.password.length > 256)) return { why: 'a password is text, or null for none' }
        kept.password = l.password === null ? null : await seal(l.password)
        save(); now({ locked: !!kept.password })
        return { ok: true, locked: !!kept.password }
      }
      case 'most': { const most = Math.floor(Number(l.most)); if (!(most >= 1 && most <= 64)) return { why: 'most is 1 to 64 players' }; kept.most = most; save(); now({ most }); return { ok: true, most } }
      case 'build': { if (!['everyone', 'admins'].includes(l.who)) return { why: 'who may build is "everyone" or "admins"' }; kept.build = l.who; save(); return { ok: true, build: kept.build } }
      case 'say': { const words = text(l.text, 200); if (!words) return { why: 'say something' }; for (const w of welcomed()) tell(w, { told: { text: words } }); return { ok: true } }
      case 'rename': { const name = text(l.name, 48); if (!name) return { why: 'a server has a name' }; kept.name = name; if (l.about !== undefined) kept.about = text(l.about, 200); save(); now({ name, about: kept.about }); return { ok: true, name } }
      default: return { why: 'an op is who, kick, ban, unban, bans, password, most, build, say or rename' }
    }
  }

  // ── up: requests ──
  function up(c, data) {
    c.last = Date.now()
    if (!c.you) return close(c, 'hello first')
    if (typeof data === 'string') {
      if (c.parts) return close(c, 'a request\'s parts broke off')
      if (data.length > CTL_MOST) return close(c, 'a request\'s head is at most 4 KB')
      let h
      try { h = JSON.parse(data) } catch { return close(c, 'that was not JSON') }
      if (!h || !Number.isInteger(h.n) || typeof h.m !== 'string' || typeof h.p !== 'string' || !(Number.isInteger(h.k ?? 0) && (h.k ?? 0) >= 0 && (h.k ?? 0) <= Math.ceil(FINE_MOST / 1024))) return close(c, 'a request is {n, m, p, k}')
      // Over what may be sent this minute: a request with parts still has them read (and dropped), so the line stays whole.
      if (!c.pools.up.take(data.length)) { if (!h.k) return reply(c, h.n, 429, 'too much sent this minute'); c.parts = { h, left: h.k, got: [], size: 0, over: true }; return }
      if (!h.k) return void request(c, h, Buffer.alloc(0))
      c.parts = { h, left: h.k, got: [], size: 0, over: false }
      return
    }
    // A binary part of the request under way: what is over the most is read and dropped, and the request refused.
    if (!c.parts) return close(c, 'a part of no request')
    const part = Buffer.from(data)
    c.parts.size += part.length
    if (c.parts.size > FINE_MOST || !c.pools.up.take(part.length)) { c.parts.over = true; c.parts.got = [] }
    if (!c.parts.over) c.parts.got.push(part)
    if (--c.parts.left === 0) { const { h, got, over, size } = c.parts; c.parts = null; if (over) return reply(c, h.n, size > FINE_MOST ? 413 : 429, size > FINE_MOST ? 'too much' : 'too much sent this minute'); void request(c, h, Buffer.concat(got)) }
  }
  function reply(c, n, s, body, type = 'text/plain; charset=utf-8') {
    if (c.closed || c.ch.up?.readyState !== 'open') return
    // A page that asks and does not read its replies is let go before what waits for it grows without bound.
    if (c.ch.up.bufferedAmount > limits.backlog) return close(c, 'this page does not read what it asked for')
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
    const k = Math.ceil(bytes.length / c.chunk)
    try {
      c.ch.up.send(JSON.stringify({ n, s, t: type, k }))
      for (let i = 0; i < k; i++) c.ch.up.send(bytes.subarray(i * c.chunk, (i + 1) * c.chunk))
    } catch { /* closing */ }
  }
  /** Which route a request is, by its method, its path (matched whole), its body and its query; undefined when it does not pass. */
  function routeOf(m, path, json, query) {
    const candidates = ROUTES.filter((r) => r.m === m && (typeof r.p === 'string' ? r.p === path : r.p.test(path)))
    // One path, two sides: an ask about rules or the realm is the admins'; a rule's source too.
    if (path === '/world/ask') return candidates.find((r) => (json && (json.rule !== undefined || json.unrule !== undefined || json.realm !== undefined) ? r.rules : r.ask))
    if (path === '/world/rules') return candidates.find((r) => r.q.includes('id') === query.has('id'))
    return candidates[0]
  }
  async function request(c, h, raw) {
    if (c.closed) return
    if (!c.pools.asks.take()) return reply(c, h.n, 429, 'too many requests: wait a second')
    // A path is read as a path and nothing else: no host, no "..", no doubled slashes, only letters of a route.
    let url
    try { url = new URL(h.p, 'http://door') } catch { return reply(c, h.n, 400, 'not a path') }
    if (url.host !== 'door' || !h.p.startsWith('/') || h.p.startsWith('//') || !/^\/[a-z0-9/-]*$/.test(url.pathname) || url.pathname.includes('//')) return reply(c, h.n, 404, 'not through this door')
    let json = null
    if (h.m === 'POST' && url.pathname !== '/world/fine' && raw.length) {
      try { json = JSON.parse(raw.toString('utf8')) } catch { return reply(c, h.n, 400, 'not JSON') }
      if (!json || typeof json !== 'object' || Array.isArray(json)) return reply(c, h.n, 400, 'a body is a JSON object')
    }
    const route = routeOf(h.m, url.pathname, json, url.searchParams)
    if (!route) return reply(c, h.n, 404, 'not through this door')
    if (route.who === 'admin' && !c.admin) return reply(c, h.n, 403, 'only an admin may do that on this server')
    if (route.who === 'build' && kept.build === 'admins' && !c.admin) return reply(c, h.n, 403, 'on this server only admins build')
    if (route.rate && !c.pools[route.rate].take()) return reply(c, h.n, 429, 'too many of those: wait a second')
    if (raw.length > (route.most ?? BODY_MOST)) return reply(c, h.n, 413, 'too much')
    if (route.by && !json) return reply(c, h.n, 400, 'a body is a JSON object')
    // The query, rebuilt: only the names the route takes, each a number or a short word.
    const q = new URLSearchParams()
    for (const name of route.q ?? []) { const v = url.searchParams.get(name); if (v !== null && /^[a-z0-9.-]{1,64}$/i.test(v)) q.set(name, v) }
    if (route.columns) { const n = Math.max(0, (Number(q.get('x1')) - Number(q.get('x0'))) * (Number(q.get('z1')) - Number(q.get('z0')))) || 0; if (n > limits.columns || !c.pools.columns.take(n)) return reply(c, h.n, 429, 'too many columns asked after: wait a second') }
    // Who asked is this connection, whatever the page wrote.
    let untaken = null
    if (json) {
      if (route.by) json.by = c.you
      if (route.by === 'here') json.name = c.name
      if (route.by === 'drive') {
        if (typeof json.id !== 'string' || !ID.test(json.id)) return reply(c, h.n, 400, 'what a thing is told is {id, go, turn, rise}')
        if (typeof json.on === 'boolean') { if (json.on) c.riding.add(json.id); else c.riding.delete(json.id) }
        else if (!c.riding.has(json.id) && c.seat !== json.id) return reply(c, h.n, 409, 'you are not on that')
      }
      // Where this page's person is, as it last said: a thing it makes is made near there (serve.mjs `stranger`).
      if (route.by === 'here' && Array.isArray(json.at) && json.at.length === 3 && json.at.every(Number.isFinite)) c.at = json.at.slice()
      // A thing made or changed by someone who is not an admin: counted against what they may (`makers`), and said to be
      // a stranger's to the world's server, which holds it to its own (`as`). Whatever the page wrote there is not read.
      if (route.ask) {
        delete json.as
        if (!c.admin) {
          // (Given back if the world does not take it: only what was made or changed counts.)
          if (json.edit !== undefined && json.thing !== undefined) { const why = mayMake(c); if (why || !makerOf(c).made.take()) return reply(c, h.n, 429, why ?? `you have made ${limits.thingsMinute} things this minute: wait a little`); untaken = () => makerOf(c).made.give() }
          else if (json.thing !== undefined) { if (!makerOf(c).changed.take()) return reply(c, h.n, 429, `you have changed things ${limits.changesMinute} times this minute: wait a little`); untaken = () => makerOf(c).changed.give() }
          json.as = { things: limits.things, cells: limits.cells, at: c.at ?? null, reach: limits.reach }
        }
      }
      if (route.rules && json.rule !== undefined && !(json.rule && typeof json.rule.id === 'string' && RULE_ID.test(json.rule.id))) return reply(c, h.n, 400, 'a rule has an id')
    }
    const path = url.pathname + (q.size ? `?${q}` : '')
    if (route.stream) return stream(c, h.n, path)
    if (c.inflight >= INFLIGHT_MOST) return reply(c, h.n, 429, 'too many requests under way')
    c.inflight++
    const abort = new AbortController()
    c.aborts.add(abort)
    try {
      const r = await fetch(`${o.world}${path}`, { method: h.m, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]), ...(h.m === 'POST' ? { body: json ? JSON.stringify(json) : raw } : {}) })
      const bytes = Buffer.from(await r.arrayBuffer())
      if (r.status !== 202) untaken?.()
      reply(c, h.n, r.status, bytes, r.headers.get('content-type') ?? 'application/octet-stream')
    } catch { reply(c, h.n, 502, 'the world did not answer') }
    finally { c.aborts.delete(abort); c.inflight-- }
  }

  // ── down: the stream ──
  async function stream(c, n, path) {
    if (c.streams.size >= STREAMS_MOST) return reply(c, n, 429, 'one stream at a time')
    const abort = new AbortController()
    c.streams.set(n, abort)
    c.aborts.add(abort)
    let why = 'the world hung up'
    try {
      const r = await fetch(`${o.world}${path}`, { signal: abort.signal })
      if (!r.ok || !r.body) { reply(c, n, r.status, await r.text()); return }
      if (c.ch.up?.readyState === 'open') c.ch.up.send(JSON.stringify({ n, s: 200, stream: true }))
      // What has come and is not yet a whole frame, in a room that grows by doubling: a big frame is copied about twice in all, not once for every piece.
      let room = Buffer.allocUnsafe(1 << 16), length = 0
      for await (const chunk of r.body) {
        if (c.closed) return
        if (length + chunk.length > room.length) { const more = Buffer.allocUnsafe(Math.max(room.length * 2, length + chunk.length)); room.copy(more, 0, 0, length); room = more }
        room.set(chunk, length)
        length += chunk.length
        let at = 0
        while (length - at >= 12) {
          const kind = room.readUInt32LE(at), size = room.readUInt32LE(at + 8)
          if (length - at < 12 + size) break
          let frame = room.subarray(at, at + 12 + size)
          at += 12 + size
          if (kind === BODIES) { try { c.seat = JSON.parse(frame.subarray(12).toString('utf8')).seat?.[c.you] ?? null } catch { /* not ours to read */ } }
          // Where things are, for a reader far behind: by the time it read that, they would be elsewhere.
          if (SKIPPED.has(kind) && c.queued + (c.ch.down?.bufferedAmount ?? 0) > BEHIND) continue
          // A rule's source is the admins' (ROUTES): the stream carries a rule without it.
          if (kind === ECHO && frame.includes('"rule":{', 12)) {
            try { const ask = JSON.parse(frame.subarray(12).toString('utf8')); if (ask.rule?.source !== undefined) { delete ask.rule.source; const body = Buffer.from(JSON.stringify(ask)), head = Buffer.from(frame.subarray(0, 12)); head.writeUInt32LE(body.length, 8); frame = Buffer.concat([head, body]) } } catch { /* not an ask */ }
          }
          c.queue.push(Buffer.concat([Buffer.from(Uint32Array.of(n).buffer), frame]))
          c.queued += frame.length + 4
        }
        room.copyWithin(0, at, length)
        length -= at
        if (room.length > 1 << 22 && length < 1 << 16) room = Buffer.from(room.subarray(0, 1 << 16))
        flush(c)
        // A page behind is waited for, and the world's server holds what it has not read yet. One that takes
        // nothing for a while is let go: it is not buffered here without bound.
        while (!c.closed && c.queued > HIGH) {
          const moved = await new Promise((r) => { c.drained = r; setTimeout(() => r(false), SILENT) })
          c.drained = null
          if (!moved) return close(c, 'this page fell too far behind the world')
        }
      }
    } catch { if (abort.signal.aborted) why = '' } finally {
      c.streams.delete(n); c.aborts.delete(abort)
      if (why && !c.closed) tell(c, { end: { n, why } })
    }
  }
  /** Sends what is queued for a page while its down channel has room, in pieces under a message's size. */
  function flush(c) {
    const down = c.ch.down
    if (!down || down.readyState !== 'open') return
    let sent = false
    while (c.queue.length && down.bufferedAmount < HIGH) {
      const f = c.queue.shift()
      c.queued -= f.length
      sent = true
      try {
        // A frame longer than a piece goes in pieces, each with the stream's number in front.
        if (f.length <= c.chunk) down.send(f)
        else { const head = f.subarray(0, 4); for (let i = 4; i < f.length; i += c.chunk - 4) down.send(Buffer.concat([head, f.subarray(i, i + c.chunk - 4)])) }
      } catch { return }
    }
    if (sent && c.drained) c.drained(true)
  }

  return {
    lobby,
    close() {
      stopped = true
      serve()
      for (const c of [...conns]) close(c, 'the server is stopping')
      try { master?.close(1000, 'stopping') } catch { /* already */ }
    },
  }
}
