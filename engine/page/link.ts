// A page's line to a shared world (#140): in place of the worker that moves what is loose, the
// world process behind the page server (world.mjs), which does that for everyone in it. Asks go
// up as they would to the worker; what comes down is the world's stream, in the world's order:
// echoes of what anyone asked, at the moment it was done, and the core's words for what came of
// it. Nothing here is decided by the page.
import type { Answer, Ask } from './mover.ts'
import type { Thing } from './things.ts'

/** An ask as the world did it: who asked, and what. An edit comes with the box of cells it can change, worked out by the server. */
export interface Echo { by: string; blast?: [number, number, number]; radius?: number; spark?: boolean; ignite?: [number, number, number]; edit?: number[]; box?: [number, number, number, number, number, number]; release?: [number, number, number]
  /** A made thing's record (things.ts): whole, with the edit that is its cells, or an id and the fields a lane changed. */
  thing?: Partial<Omit<Thing, 'cells' | 'box'>> & { id: string }
  /** A made thing that is no more, by its id. */
  gone?: string
  /** What the realm says of itself, or a change to that (#264): only what is given. */
  realm?: Partial<Realm> }
/** What a realm is (serve.mjs `recorded`): its name, what it is about in the words of whoever asked for it, where one arrives and how it looks. All of it is data someone sent. */
export interface Realm {
  name: string
  about: string
  /** Where one's feet are set down (the world's finest cells; without a height, on the ground there) and how one faces, radians. */
  arrive?: { at: [number, number] | [number, number, number]; yaw: number; pitch: number }
  /** What a page shows there: the hour (null: the sun where it always stood), rain 0 to 1, the last pass's colour and contrast in place of the hour's own, and what the finished picture is multiplied by. */
  look?: { hour?: number | null; rain?: number; grade?: [number, number]; tint?: [number, number, number] }
}
/** A realm's record after a change to it, as the server makes it (serve.mjs `changed`). */
const changed = (record: Realm, change: Partial<Realm>): Realm => ({ ...record, ...change, ...(change.look ? { look: { ...record.look, ...change.look } } : {}) })
/** What of a figure may be chosen (people.ts `figure`); whatever is left out comes of who they are. */
export type { Look } from './wear.ts'
import type { Look } from './wear.ts'
import type { Move } from './moves.ts'
/** Someone in the world as the world tells of them: where their feet are, how they face, what they are doing. `seat` is a body the world moves for someone outside a page. */
export interface Someone { by: string; name: string; at: [number, number, number]; yaw: number; walking: number; down: boolean; flinch: boolean; seat: boolean; gone?: boolean; /** What a rule chose of how its actor looks (#264): colours as #rrggbb, build against the usual. The world's process has checked it. */ look?: Look; /** Which of the town's residents this body was until a rule took it (#218): the rule's own number for them, and the step they were in. Pages leave that resident out of the town's rule meanwhile. */ was?: number; stride?: number; /** What it is doing with its limbs (moves.ts): which setting of it this is, when it began on the world's clock (ms), a name or keys, and what it is aimed at. The world's process has checked it. */ move?: { n: number; since: number; name?: string; keys?: Move; aim?: [number, number, number] } }
/** Something a rule offers people to do (rules/hands.mjs): a word to show, held or tapped, aimed or not, the key it would like, and who it is for (null: everyone). */
export interface Offer { rule: string; id: string; word: string; hold: boolean; aim: boolean; key: string; to: string[] | null }
/** Something a rule shows people (rules/hands.mjs): a line, meters (how full, 0 to 1), a score, picks to choose from, and who it is for (null: everyone). All of it is text a rule wrote: to be put as text. */
export interface Shown { rule: string; id: string; line: string; meters: { label: string; full: number; colour: string }[]; score: { label: string; value: string } | null; choice: { id: string; word: string }[] | null; to: string[] | null }
export interface Link {
  postMessage(ask: Ask & { box?: readonly number[] }): void
  onmessage: ((e: { data: Answer }) => void) | null
  onerror: ((e: { message: string }) => void) | null
  /** An ask of anyone's, as the world does it. `live` is false for what was done before this page joined. */
  onecho: ((echo: Echo, live: boolean) => void) | null
  /** Which body a living thing is now (#245), by its thing's id; body 0 when it lives no more. Said as it changes and to each page as it joins. */
  onliving: ((living: { thing: string; body: number }) => void) | null
  /** What the realm's music is like, if a rule has said (rules/sound.mjs), or null: as last said, told at once to whoever starts to listen. */
  onmusic: ((music: unknown) => void) | null
  /** A sound a rule made (rules/sound.mjs): what it holds came through a rule, and is read again by whoever plays it. */
  onsound: ((sound: unknown) => void) | null
  /** What the world's rules offer people to do, all of it, whenever it changes (and as it stands, when this is set). */
  onoffers: ((offers: Offer[]) => void) | null
  /** What the world's rules show people, all of it, whenever it changes (and as it stands, when this is set). */
  onshown: ((shown: Shown[]) => void) | null
  /** Picks from a choice a rule shows. */
  pick(rule: string, id: string, pick: string): void
  /** Does something a rule offers: which, whether it goes down or comes up, where the eyes are and which way they look. */
  act(rule: string, id: string, phase: 'down' | 'up', from: readonly [number, number, number], to: readonly [number, number, number]): void
  /** Says what a living thing is to do (go, turn and rise from -1 to 1), held by the world for a second. */
  drive(id: string, go: number, turn: number, rise: number, once?: 'roll' | 'jump'): void
  /** An ask in the world's own words (`GET /world/` says which): a thing with its cells, a change to a thing's fields. Resolves to whether it was taken. */
  ask(body: Record<string, unknown>): Promise<boolean>
  /** Says where this page's eye is (the world's finest cells) and which way it faces, under a name others see. */
  here(at: readonly [number, number, number], yaw: number, name?: string): void
  /** Where someone else in the world is, when the world says. */
  onhere: ((who: Someone) => void) | null
  /** Says something as this page's body (a name for it, then the words): everyone near hears. */
  say(name: string, text: string): void
  /** Something someone said, this page's own words among them. What it holds is text someone typed: to be shown, never obeyed. */
  onsaid: ((said: { n: number; by: string; name: string; text: string; at: [number, number, number] }) => void) | null
  /** Seconds on the world's own clock, which every page of it shares: the town's residents go by it. */
  clock(): number
  /** This page's name in the world: an echo `by` it is its own. */
  readonly me: string
  /** Where the world this line is to is kept: `/world` is home, `/realm/<id>/world` another realm. */
  readonly base: string
  /** What the realm says of itself, as far as has been read. */
  readonly realm: Realm
  /** The realm's record: once when all that was kept has been read, and again whenever someone changes it. */
  onrealm: ((realm: Realm) => void) | null
  /**
   * Makes ready to be in another world (#264): opens its stream and holds what it says, this page still being in
   * the one it is in. Resolves when all that was kept there has been read, with what that realm is. Asked again for
   * another, the one made ready before is let go.
   */
  ready(base: string): Promise<Realm>
  /**
   * Leaves this world for the one made ready, at once: the old stream is hung up on, living things and people of
   * the old world are said to be gone (as the world would say it), `between` is called for the page to put away
   * what else it holds of the old world, and everything held of the other is said in order, as what was done before
   * this page joined. False if none is ready.
   */
  go(between: () => void): boolean
  /** Whether all that was kept before this page joined has been read. */
  readonly live: boolean
}

const LOG = 1, STATE = 2, ECHO = 3, NOW = 4, HERE = 5, SAID = 6, LIVING = 7, OFFERS = 8, SHOWN = 9, SOUND = 10, MUSIC = 11

/** A line to the world kept at `base`: `/world` is home, `/realm/<id>/world` another realm of the same server (#264). */
export function link(base = '/world'): Link {
  let live = false
  /** What is offered, as last said, and who hears it. */
  let offers: Offer[] = [], hears: ((offers: Offer[]) => void) | null = null
  let shown: Shown[] = [], sees: ((shown: Shown[]) => void) | null = null
  /** What this realm says of itself, and what of this world must be said to be gone when it is left: who is there, which things live. */
  let realm: Realm = { name: '', about: '' }
  const there = new Map<string, Someone>(), alive = new Set<string>()
  /** The stream being read, and one made ready beside it: what it has said so far, and whether all that was kept has come. */
  interface Line { base: string; stop: AbortController; held: { kind: number; data: unknown }[] | null; realm: Realm; whole: boolean }
  let line: Line, next: Line | null = null
  /** What the realm's music is like, as last said, and who is told. */
  let music: unknown = null, tunes: ((music: unknown) => void) | null = null
  // How far this machine's clock is behind the world's, ms.
  let behind = 0
  const self: Link = {
    me: Math.random().toString(36).slice(2, 10),
    onmessage: null, onerror: null, onecho: null, onhere: null, onsaid: null, onliving: null, onsound: null, onrealm: null,
    get base() { return base },
    ready: () => Promise.reject(new Error('not yet')), go: () => false,
    get realm() { return realm },
    get onshown() { return sees },
    set onshown(f: ((shown: Shown[]) => void) | null) { sees = f; f?.(shown) },
    pick(rule, id, pick) { void fetch(`${base}/pick`, { method: 'POST', body: JSON.stringify({ by: self.me, rule, id, pick }) }).catch(() => {}) },
    get onoffers() { return hears },
    set onoffers(f: ((offers: Offer[]) => void) | null) { hears = f; f?.(offers) },
    get onmusic() { return tunes },
    set onmusic(f: ((music: unknown) => void) | null) { tunes = f; f?.(music) },
    act(rule, id, phase, from, to) { void fetch(`${base}/act`, { method: 'POST', body: JSON.stringify({ by: self.me, rule, id, phase, from, to }) }).catch(() => {}) },
    drive(id, go, turn, rise, once) { void fetch(`${base}/drive`, { method: 'POST', body: JSON.stringify({ by: self.me, id, go, turn, rise, roll: once === 'roll', jump: once === 'jump' }) }).catch(() => {}) },
    ask: (body) => fetch(`${base}/ask`, { method: 'POST', body: JSON.stringify({ by: self.me, ...body }) }).then(async (r) => { if (!r.ok) self.onerror?.({ message: `the world refused: ${await r.text()}` }); return r.ok }, () => false),
    here(at, yaw, name) { void fetch(`${base}/here`, { method: 'POST', body: JSON.stringify({ by: self.me, name, at, yaw }) }).catch(() => {}) },
    // A page's body is its own to place, so the world has it as a page's; to speak it takes a seat's voice under the page's name.
    say(name, text) { void fetch(`${base}/say`, { method: 'POST', body: JSON.stringify({ by: self.me, name, text }) }).then(async (r) => { if (!r.ok) self.onerror?.({ message: `not said: ${await r.text()}` }) }, () => {}) },
    clock: () => (Date.now() + behind) / 1000,
    get live() { return live },
    postMessage(ask) {
      // The world has its own clock: a page never asks it for time.
      if (!ask.blast && !ask.ignite && !ask.ball && !ask.edit) return
      const body = { by: self.me, blast: ask.blast, radius: ask.radius, spark: ask.spark, ignite: ask.ignite, ball: ask.ball, edit: ask.edit && Array.from(ask.edit), release: ask.release }
      void fetch(`${base}/ask`, { method: 'POST', body: JSON.stringify(body) }).then(async (r) => { if (!r.ok) self.onerror?.({ message: `the world refused: ${await r.text()}` }) }, (e) => self.onerror?.({ message: String(e) }))
    },
  }
  const text = new TextDecoder()
  /** A frame, read: JSON for what is JSON, the core's words for the rest. */
  const read = (kind: number, payload: Uint8Array<ArrayBuffer>): unknown => kind === NOW ? (payload.length >= 8 ? new Float64Array(payload.buffer, 0, 1)[0] : 0) : kind === LOG || kind === STATE ? new Uint32Array(payload.buffer, 0, payload.length / 4) : JSON.parse(text.decode(payload))
  /** A frame of the world this page is in, said to the page. */
  const say = (kind: number, data: unknown) => {
    if (kind === NOW) { live = true; if (data) behind = (data as number) - Date.now(); self.onrealm?.(realm) }
    else if (kind === SAID) self.onsaid?.(data as Parameters<NonNullable<Link['onsaid']>>[0])
    else if (kind === ECHO) {
      const echo = data as Echo
      if (echo.realm) { realm = changed(realm, echo.realm); if (live) self.onrealm?.(realm) }
      self.onecho?.(echo, live)
    }
    else if (kind === SHOWN) { shown = data as Shown[]; self.onshown?.(shown) }
    else if (kind === OFFERS) { offers = data as Offer[]; self.onoffers?.(offers) }
    else if (kind === MUSIC) { music = data; self.onmusic?.(music) }
    else if (kind === SOUND) { if (live) self.onsound?.(data as Parameters<NonNullable<Link['onsound']>>[0]) }
    else if (kind === LIVING) { const l = data as { thing: string; body: number }; if (l.body) alive.add(l.thing); else alive.delete(l.thing); self.onliving?.(l) }
    else if (kind === HERE) { const who = data as Someone; if (who.by === self.me) return; if (who.gone) there.delete(who.by); else there.set(who.by, who); self.onhere?.(who) }
    else if (kind === LOG || kind === STATE) {
      const words = data as Uint32Array<ArrayBuffer>
      self.onmessage?.({ data: { words: words.slice(4), ms: 0, bodies: words[0], tried: 0, burning: words[1], flowing: words[2] !== 0, released: words[3] !== 0 } })
    }
  }
  /** Reads a world's stream from its start: each frame is said to the page, or held while the page is in another world. `whole` is called when all that was kept has come. */
  const open = (at: string, whole?: (l: Line) => void): Line => {
    const l: Line = { base: at, stop: new AbortController(), held: whole ? [] : null, realm: { name: '', about: '' }, whole: false }
    void (async () => {
      const response = await fetch(`${at}/stream?from=0`, { signal: l.stop.signal })
      if (!response.ok || !response.body) throw new Error(`no shared world here (${response.status})`)
      const reader = response.body.getReader()
      let held = new Uint8Array(0)
      for (;;) {
        const { done, value } = await reader.read()
        if (done) throw new Error('the world hung up')
        const joined = new Uint8Array(held.length + value.length)
        joined.set(held); joined.set(value, held.length)
        held = joined
        let from = 0
        for (;;) {
          if (held.length - from < 12) break
          const head = new DataView(held.buffer, held.byteOffset + from, 12), kind = head.getUint32(0, true), size = head.getUint32(8, true)
          if (held.length - from < 12 + size) break
          const data = read(kind, held.slice(from + 12, from + 12 + size))
          from += 12 + size
          if (l.stop.signal.aborted) return
          if (!l.held) { say(kind, data); continue }
          // Held for a page that is elsewhere: where things were a moment ago is of no use later, the rest is.
          // A sound is heard when it is made or not at all.
          if (kind === SOUND) continue
          if (kind === STATE || kind === HERE) { if (l.whole) { const last = l.held.findLastIndex((h) => h.kind === kind && (kind === STATE || (h.data as Someone).by === (data as Someone).by)); if (last >= 0) l.held.splice(last, 1) } else continue }
          if (kind === ECHO && (data as Echo).realm) l.realm = changed(l.realm, (data as Echo).realm!)
          l.held.push({ kind, data })
          if (kind === NOW) { l.whole = true; whole?.(l) }
        }
        held = held.slice(from)
      }
    })().catch((e) => { if (!l.stop.signal.aborted) self.onerror?.({ message: String(e) }) })
    return l
  }
  line = open(base)
  self.ready = (at) => new Promise((resolve) => {
    next?.stop.abort()
    next = open(at, (l) => resolve(l.realm))
  })
  self.go = (between) => {
    const to = next
    if (!to?.whole || !to.held) return false
    next = null
    line.stop.abort()
    // What lives and who is there, of the world left behind, are gone from this page: said as the world says it.
    for (const thing of alive) self.onliving?.({ thing, body: 0 })
    alive.clear()
    between()
    for (const who of there.values()) self.onhere?.({ ...who, gone: true })
    there.clear()
    line = to; base = to.base; live = false; realm = { name: '', about: '' }
    // What the old world showed and offered is no longer shown or offered: the other says its own.
    shown = []; self.onshown?.(shown)
    offers = []; self.onoffers?.(offers)
    music = null; self.onmusic?.(music)
    // All that was held, in order: what came before "now" is what was done before this page joined.
    const held = to.held
    to.held = null
    for (const h of held) say(h.kind, h.data)
    return true
  }
  return self
}
