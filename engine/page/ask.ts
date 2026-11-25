// One ask (#243, #244): what the page sends to have something made, and the one function that sends it. The
// ask bar, the wand and anything else that wants a thing made call `ask` here; none of them talks to the helper
// itself.
//
// The helper (engine/helper.mjs) runs on the asker's own machine and starts their own model. The page is told
// where it is and its secret once, in the part of the address after # (`#helper=http://127.0.0.1:5762&secret=…`),
// which is taken out of the address at once and kept by this page (localStorage). The world's server never sees it.
import { RULES } from './local.ts'

/** What an ask is aimed at: a place, a box of cells (low corner, high corner not included), or a made thing and, if one is meant, which part of it. */
export type Target = { point: [number, number, number] } | { box: [number, number, number, number, number, number] } | { thing: string; part?: string }

/** One ask. At least one of a wish, a picture and a link. All of it is data for the model: none of it is obeyed by anything. */
export interface Ask {
  /** What is wanted, up to 400 characters. */
  wish?: string
  /** A picture to make it from: its bytes in base64. It goes to the helper and the asker's own model, and is kept nowhere. */
  picture?: { type: 'image/png' | 'image/jpeg' | 'image/webp'; data: string }
  /** An address to make it from. The helper fetches it itself, from public hosts only. */
  link?: string
  /** Make it anew, even if one like it was made before and is kept. */
  fresh?: boolean
  /** It is for a hand (#366): the maker is told to make the thing alone, and it is kept apart from a standing thing of the same words. */
  hand?: boolean
  /** Where or what it is for. Without one: what is ahead of the eye. */
  target?: Target
  /** The kept thing to make (the ghost the ask bar showed for the words: `Asker.guess`): made from what was kept, with no model. */
  kept?: string
  /** A person typed these words on the bar (making.ts sets it). Only such a wish may be drawn (#245): a rule's `world.make` is not one, and spends nothing. */
  typed?: boolean
}

/** What is kept for words being typed, and where it would stand (the helper's `/kept`): drawn with `Asker.faces`. */
export interface Guess { id: string; name: string; sure: number; /** Where it would stand, if there is a place for it where the eye is (no place: nothing is drawn, and Enter still makes it, held). */ placed?: { facing: string; /** Where its lowest corner goes, in the world's cells. */ at: [number, number, number]; /** How many of its cells make one of the world's. */ grain: number; size: [number, number, number] } }

/** How an ask goes, as the helper says it. `place` comes before the model is asked: where the thing will stand. */
export type Stage =
  | { stage: 'waiting'; ahead: number }
  | { stage: 'reading' }
  | { stage: 'known'; name: string }
  | { stage: 'place'; at: [number, number, number]; facing: string }
  /** Waiting for the visitor to connect their own AI before anything is sent to a model (#526). */
  | { stage: 'connect' }
  | { stage: 'asking'; try: number }
  /** A wish nothing kept answers is being drawn from five sides (#245, make/drawn.mjs), and then carved from the drawing. */
  | { stage: 'drawing' }
  | { stage: 'carving'; name: string }
  | { stage: 'shaped'; name: string; size: [number, number, number]; facing: string }
  | { stage: 'refused'; why: string }
  | { stage: 'note'; why: string }
  | { stage: 'writing'; try: number }
  | { stage: 'trying'; name: string }
  | { stage: 'putting'; name: string }
  | { stage: 'realm'; id: string; name: string }
  | { stage: 'placed'; id: string; name: string }
  | { stage: 'sending'; id: string; name: string; at: [number, number, number]; size: [number, number, number]; facing: string }
  | Done
/** How it ended. `there`: it stands in the world, and the world's stream brings it. Anything else: nothing was made, and `why`. */
/** `held`: it is made and no place near would take it. `held` is what `put` takes to stand it where the asker says next. */
export interface Done { stage: 'done'; state: 'there' | 'fell' | 'not there' | 'unknown' | 'refused' | 'held'; held?: string; moved?: number; left?: number; /** A rule that was written: its id; what it could not do with what the engine offers; `rough` if it was put in though its trial went wrong. A realm that was made: its id. */ rule?: string; realm?: string; cannot?: string[]; rough?: string; /** A rule that was here and was changed: what is different now, in a sentence for whoever plays. `undone`: the last change was taken back. */ changed?: string; undone?: boolean; /** The helper stopped answering while it was being made (it was closed or started again): nothing more will come of this ask, and what was begun may be gone on with. */ cut?: boolean; /** Its rules were written quickly to be played at once: fuller ones are being written and will take their place. */ more?: boolean; why?: string; id?: string; name?: string; at?: [number, number, number]; size?: [number, number, number]; ms?: number; tries?: number }

export interface Asker {
  /** Whether this page knows of a helper (it may not be running: `hello` asks it). */
  readonly known: boolean
  /** Asks the helper whether it is there and takes this page's secret. */
  hello(): Promise<boolean>
  /**
   * Sends one ask. `each` hears every stage, the last among them. Resolves to how it ended; never throws.
   * The helper makes one thing at a time: an ask made while another is being made waits its turn here
   * (`each` hears `{stage: 'waiting', ahead}` at once), so the bar and the wand need not know of each other.
   */
  ask(ask: Ask, each?: (stage: Stage) => void): Promise<Done>
  /**
   * Stands a held thing (a `Done` whose state is `held`): at what `aim` says (the wand's), else where the eye looks now; or with `clear` at the place first
   * asked for, with whatever is there emptied. No model is asked. Resolves as `ask` does.
   */
  put(held: Done, how: { clear: boolean }, each?: (stage: Stage) => void): Promise<Done>
  /**
   * Asks for a rule: what the people of this world do, a game in it, a power (#264). The asker's own model writes
   * it, it is tried in a world of its own, and put into this one. `change` is the id of a rule that is here, to be
   * changed as asked: it keeps its actors and what it kept. Resolves as `ask` does, with `rule`, `cannot`, `rough`.
   */
  rule(wish: string, how?: { change?: string; /** The last change to this world's game is taken back: the rule as it was before, from the world's own record. No model is asked. */ undo?: boolean; /** It is the realm's director that is asked for (make/director.mjs): written if there is none, changed as `wish` says if there is, and turned on. */ director?: boolean }, each?: (stage: Stage) => void): Promise<Done>
  /** An idea for a realm, fleshed out by the asker's own model before anything is built: what it is about, how it looks, and a few questions where the idea leaves a choice open. Null if it could not be. */
  imagine(idea: string): Promise<{ name: string; about: string; look?: unknown; place?: unknown; questions: { ask: string; options: string[] }[] } | null>
  /** Makes a realm on the world's server and has its rules written into it. Resolves as `ask` does, with `realm` (its id). */
  realm(spec: { name: string; about: string; look?: unknown; place?: unknown; /** A realm that is there already and has no rules yet (its making was cut off): they are written into it, and no new realm is made. */ into?: string; answers?: { ask: string; answer: string }[]; /** With a director, written for it once its first rules are in. */ director?: boolean }, each?: (stage: Stage) => void): Promise<Done>
  /** What is kept that the words typed so far mean, and where it would stand now; null for nothing, or no helper. */
  guess(words: string): Promise<Guess | null>
  /** Whether words that point at a thing ("make it drivable") would bring what the eye or the wand aims at to life: the asker's own made thing, not alive (the helper says: make.mjs `aimed`). False with no helper. */
  drivable(): Promise<boolean>
  /** The outside faces of a kept thing facing a way (page/fine.ts `faces`), made by the helper ahead of time. */
  faces(id: string, facing: string): Promise<Uint32Array<ArrayBuffer> | null>
  /** Which kept thing a wish of these words is to be made from, if any says (the ghost on the ask bar): asked as each ask is sent. */
  kept: ((wish: string) => string | undefined) | null
  /** How many asks are being made, written or waiting. */
  readonly busy: number
  /** Something else asked of the helper, by its address there (the workshop's, #264): what it answered and whether it was a yes. Null with no helper, or one that cannot be reached. */
  call(path: string, body?: unknown): Promise<{ ok: boolean; value: Record<string, unknown> } | null>
  /**
   * What an ask with no target of its own is aimed at, if anything says (the wand's: it sets this while it aims).
   * Null, or a function that returns undefined: what is ahead of the eye.
   */
  aim: (() => Target | undefined) | null
}

const KEPT = 'village.helper'
/** How long an ask may go with nothing said before the helper is asked whether it is still there (ms). */
const QUIET = 15_000
/** Whether an address is this machine's own (plain, as a browser allows of loopback) or, over TLS, the host this page was served by. */
const ours = (address: string) => { const u = URL.parse(address); return !!u && ((u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)) || (u.protocol === 'https:' && u.hostname === location.hostname)) }

/** `eye` says where this page's eye is and looks (the world's finest cells), `by` the name it goes by. */
export function asker(eye: () => { eye: [number, number, number]; toward: [number, number, number] }, by: () => string): Asker {
  let helper: { url: string; secret: string } | null = null
  // In a realm whose rules allow no models (local.ts), there is no helper: none kept, none given, none asked.
  if (RULES.models) try { helper = JSON.parse(localStorage.getItem(KEPT) ?? 'null') } catch { /* a page that may keep nothing */ }
  // Given in the address: kept, and taken out of the address so it is not left in the bar or passed on.
  const given = new URLSearchParams(location.hash.slice(1))
  if (RULES.models && given.get('helper') && given.get('secret')) {
    // A helper is on this machine, or on the machine this page came from: an address that says otherwise (a link
    // someone made, to have wishes and pictures sent to them) is not taken.
    if (ours(given.get('helper')!)) {
      helper = { url: given.get('helper')!.replace(/\/$/, ''), secret: given.get('secret')! }
      try { localStorage.setItem(KEPT, JSON.stringify(helper)) } catch { /* the same */ }
    }
    history.replaceState(null, '', location.pathname + location.search)
  }
  if (helper && !ours(helper.url)) helper = null
  const headers = () => ({ 'Content-Type': 'application/json', 'X-Village-Secret': helper!.secret })
  const failed = (why: string): Done => ({ stage: 'done', state: 'refused', why })
  let last: Promise<unknown> = Promise.resolve(), busy = 0
  /** What is written (a rule, a realm, a director) waits its turn among what is written, and never holds up a thing: the helper has a lane for each. */
  let lastWritten: Promise<unknown> = Promise.resolve(), written = 0
  /** The realm this page is in now, if it is not home (the address says, and is kept true as the page steps between realms, #264): what is asked for is made there. */
  const realmNow = () => new URLSearchParams(location.search).get('realm') ?? undefined
  /** One thing asked of the helper, in its turn after whatever was asked before. */
  const turn = async (path: string, what: { from?: { eye: [number, number, number]; toward: [number, number, number] } } & Record<string, unknown>, each: (stage: Stage) => void): Promise<Done> => {
    const end = (done: Done) => { written--; each(done); return done }
    const body = JSON.stringify(what)
    if (written++) each({ stage: 'waiting', ahead: written - 1 })
    const before = lastWritten
    let free!: () => void
    lastWritten = new Promise<void>((r) => { free = r })
    await before
    try { return await send(path, body, each, end, what.from ?? eye()) } finally { free() }
  }
  const self: Asker = {
    aim: null,
    kept: null,
    async guess(words) {
      if (!helper) return null
      try { const r = await fetch(`${helper.url}/kept`, { method: 'POST', headers: headers(), body: JSON.stringify({ words, from: eye(), realm: realmNow() }) }); const v = await r.json(); return r.ok && v.id ? { id: v.id, name: v.name, sure: v.sure, ...(v.at ? { placed: { facing: v.facing, at: v.at, grain: v.grain, size: v.size } } : {}) } : null } catch { return null }
    },
    async drivable() {
      if (!helper) return false
      try { const r = await fetch(`${helper.url}/drivable`, { method: 'POST', headers: headers(), body: JSON.stringify({ from: eye(), target: self.aim?.(), by: by(), realm: realmNow() }) }); return r.ok && (await r.json()).mine === true } catch { return false }
    },
    async faces(id, facing) {
      if (!helper) return null
      try { const r = await fetch(`${helper.url}/kept/faces?id=${encodeURIComponent(id)}&facing=${encodeURIComponent(facing)}`, { headers: headers() }); return r.ok ? new Uint32Array(await r.arrayBuffer()) : null } catch { return null }
    },
    get busy() { return busy + written },
    async call(path, body) {
      if (!helper) return null
      try { const r = await fetch(`${helper.url}${path}`, body === undefined ? { headers: headers() } : { method: 'POST', headers: headers(), body: JSON.stringify(body) }); return { ok: r.ok, value: await r.json() } } catch { return null }
    },
    get known() { return helper !== null },
    async hello() {
      if (!helper) return false
      try { return (await fetch(`${helper.url}/hello`, { headers: headers() })).ok } catch { return false }
    },
    async ask(ask, each = () => {}) {
      const end = (done: Done) => { busy--; each(done); return done }
      // Where the eye is and what is aimed at are as they were when it was asked, not when its turn comes.
      const kept = ask.kept ?? (ask.wish && !ask.picture && !ask.link && !ask.fresh && !ask.hand ? self.kept?.(ask.wish) : undefined)
      const body = JSON.stringify({ ...ask, ...(kept ? { kept } : {}), target: ask.target ?? self.aim?.(), from: eye(), by: by(), realm: realmNow() })
      if (busy++) each({ stage: 'waiting', ahead: busy - 1 })
      const before = last
      let free!: () => void
      last = new Promise<void>((r) => { free = r })
      await before
      try { return await send('/ask', body, each, end, JSON.parse(body).from) } finally { free() }
    },
    rule: (wish, how = {}, each = () => {}) => turn('/rule', { wish, change: how.change, director: how.director, undo: how.undo, from: eye(), by: by(), realm: realmNow() }, each),
    realm: (spec, each = () => {}) => turn('/realm', { ...spec, by: by() }, each),
    async imagine(idea) {
      if (!helper) return null
      try { const r = await fetch(`${helper.url}/imagine`, { method: 'POST', headers: headers(), body: JSON.stringify({ idea }) }); const v = await r.json(); return r.ok && v.name ? v : null } catch { return null }
    },
    async put(held, how, each = () => {}) {
      const end = (done: Done) => { busy--; each(done); return done }
      const from = how.clear ? asked.get(held) ?? eye() : eye(), body = JSON.stringify({ held: held.held, clear: how.clear, from, by: by(), target: how.clear ? undefined : self.aim?.(), realm: realmNow() })
      busy++
      const before = last
      let free!: () => void
      last = new Promise<void>((r) => { free = r })
      await before
      try { return await send('/put', body, each, end, from) } finally { free() }
    },
  }
  /** Where the eye was and looked when each held thing was asked for: to clear a place is to mean that one. */
  const asked = new WeakMap<Done, { eye: [number, number, number]; toward: [number, number, number] }>()
  const send = async (path: string, body: string, each: (stage: Stage) => void, end: (done: Done) => Done, from: { eye: [number, number, number]; toward: [number, number, number] }): Promise<Done> => {
    {
      if (!helper) return end(failed('no helper is known to this page: run node helper.mjs on your machine and open the address it prints'))
      let res: Response
      try { res = await fetch(`${helper.url}${path}`, { method: 'POST', headers: headers(), body }) } catch { return end(failed('the helper is not answering: is node helper.mjs running on your machine?')) }
      if (!res.ok || !res.body) { let why = `the helper said ${res.status}`; try { why = (await res.json()).why ?? why } catch { /* no reason given */ } return end(failed(why)) }
      // Lines of JSON as it goes; the last says how it ended.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let held = '', done: Done | null = null, cut = false, heard = performance.now()
      // A rule takes minutes with nothing said meanwhile, and a helper that was closed or started again may leave
      // this end open and silent (seen November 14: a page on "writing its rules" for 500 s). So while nothing
      // comes the helper is asked now and then whether it is there, with this page's secret: one that does not
      // answer, or no longer knows the secret, is another helper than the one that was asked, and the wait ends.
      const watch = setInterval(() => {
        if (performance.now() - heard < QUIET) return
        heard = performance.now()
        void fetch(`${helper!.url}/hello`, { headers: headers() }).then((r) => r.ok, () => false).then((there) => { if (!there) { cut = true; void reader.cancel().catch(() => {}) } })
      }, 2000)
      try {
        for (;;) {
          const { value, done: ended } = await reader.read()
          heard = performance.now()
          if (ended) break
          held += value
          for (let at = held.indexOf('\n'); at >= 0; at = held.indexOf('\n')) {
            const stage = JSON.parse(held.slice(0, at)) as Stage
            held = held.slice(at + 1)
            if (stage.stage === 'done') done = stage
            else each(stage)
          }
        }
      } catch { /* cut off: said below */ } finally { clearInterval(watch) }
      if (done?.state === 'held') asked.set(done, from)
      return end(done ?? { ...failed(cut ? 'the helper stopped answering while this was being made: it was closed or started again' : 'the helper stopped before it was made'), cut: true })
    }
  }
  return self
}

/**
 * An Asker that is fetched when it is first asked something (#526): the page's own maker (page/maker.ts) is a module of
 * its own, not in the bytes before the park. Until then, and while it comes, this answers for it: what is set on it
 * (`kept`, `aim`) is handed on at each ask. One that could not be fetched is asked for again next time.
 */
export function later(load: () => Promise<Asker>): Asker {
  let real: Promise<Asker> | null = null, waiting = 0
  const got = () => (real ??= load().catch((e) => { real = null; throw e })).then((a) => { a.kept = self.kept; a.aim = self.aim; return a })
  const failed = (each: (stage: Stage) => void): Done => { const done: Done = { stage: 'done', state: 'refused', why: 'the maker could not be fetched' }; each(done); return done }
  const self: Asker = {
    aim: null,
    kept: null,
    known: true,
    get busy() { return waiting },
    hello: async () => true,
    async ask(ask, each = () => {}) { waiting++; try { return await (await got()).ask(ask, each) } catch { return failed(each) } finally { waiting-- } },
    async put(held, how, each = () => {}) { waiting++; try { return await (await got()).put(held, how, each) } catch { return failed(each) } finally { waiting-- } },
    async rule(wish, how, each = () => {}) { try { return await (await got()).rule(wish, how, each) } catch { return failed(each) } },
    async realm(spec, each = () => {}) { try { return await (await got()).realm(spec, each) } catch { return failed(each) } },
    guess: (words) => got().then((a) => a.guess(words), () => null),
    faces: (id, facing) => got().then((a) => a.faces(id, facing), () => null),
    drivable: async () => false,
    imagine: async () => null,
    call: async () => null,
  }
  return self
}
