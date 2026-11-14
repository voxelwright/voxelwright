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
  gone?: string }
/** What of a figure may be chosen (people.ts `figure`); whatever is left out comes of who they are. */
export interface Look { coat?: string; legs?: string; hair?: string; skin?: string; shoes?: string; tall?: number; broad?: number }
/** Someone in the world as the world tells of them: where their feet are, how they face, what they are doing. `seat` is a body the world moves for someone outside a page. */
export interface Someone { by: string; name: string; at: [number, number, number]; yaw: number; walking: number; down: boolean; flinch: boolean; seat: boolean; gone?: boolean; /** What a rule chose of how its actor looks (#264): colours as #rrggbb, build against the usual. The world's process has checked it. */ look?: Look; /** Which of the town's residents this body was until a rule took it (#218): the rule's own number for them, and the step they were in. Pages leave that resident out of the town's rule meanwhile. */ was?: number; stride?: number }
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
  /** Whether all that was kept before this page joined has been read. */
  readonly live: boolean
}

const LOG = 1, STATE = 2, ECHO = 3, NOW = 4, HERE = 5, SAID = 6, LIVING = 7, OFFERS = 8, SHOWN = 9

/** A line to the world kept at `base`: `/world` is home, `/realm/<id>/world` another realm of the same server (#264). */
export function link(base = '/world'): Link {
  let live = false
  /** What is offered, as last said, and who hears it. */
  let offers: Offer[] = [], hears: ((offers: Offer[]) => void) | null = null
  let shown: Shown[] = [], sees: ((shown: Shown[]) => void) | null = null
  // How far this machine's clock is behind the world's, ms.
  let behind = 0
  const self: Link = {
    me: Math.random().toString(36).slice(2, 10),
    onmessage: null, onerror: null, onecho: null, onhere: null, onsaid: null, onliving: null,
    get onshown() { return sees },
    set onshown(f: ((shown: Shown[]) => void) | null) { sees = f; f?.(shown) },
    pick(rule, id, pick) { void fetch(`${base}/pick`, { method: 'POST', body: JSON.stringify({ by: self.me, rule, id, pick }) }).catch(() => {}) },
    get onoffers() { return hears },
    set onoffers(f: ((offers: Offer[]) => void) | null) { hears = f; f?.(offers) },
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
  void (async () => {
    const response = await fetch(`${base}/stream?from=0`)
    if (!response.ok || !response.body) throw new Error(`no shared world here (${response.status})`)
    const reader = response.body.getReader()
    let held = new Uint8Array(0)
    for (;;) {
      const { done, value } = await reader.read()
      if (done) throw new Error('the world hung up')
      const joined = new Uint8Array(held.length + value.length)
      joined.set(held); joined.set(value, held.length)
      held = joined
      let at = 0
      for (;;) {
        if (held.length - at < 12) break
        const head = new DataView(held.buffer, held.byteOffset + at, 12), kind = head.getUint32(0, true), size = head.getUint32(8, true)
        if (held.length - at < 12 + size) break
        const payload = held.slice(at + 12, at + 12 + size)
        at += 12 + size
        if (kind === NOW) { live = true; if (size >= 8) behind = new Float64Array(payload.buffer, 0, 1)[0] - Date.now() }
        else if (kind === SAID) self.onsaid?.(JSON.parse(new TextDecoder().decode(payload)))
        else if (kind === ECHO) self.onecho?.(JSON.parse(new TextDecoder().decode(payload)) as Echo, live)
        else if (kind === SHOWN) { shown = JSON.parse(new TextDecoder().decode(payload)) as Shown[]; self.onshown?.(shown) }
        else if (kind === OFFERS) { offers = JSON.parse(new TextDecoder().decode(payload)) as Offer[]; self.onoffers?.(offers) }
        else if (kind === LIVING) self.onliving?.(JSON.parse(new TextDecoder().decode(payload)))
        else if (kind === HERE) { const who = JSON.parse(new TextDecoder().decode(payload)); if (who.by !== self.me) self.onhere?.(who) }
        else if (kind === LOG || kind === STATE) {
          const words = new Uint32Array(payload.buffer, 0, payload.length / 4)
          self.onmessage?.({ data: { words: words.slice(4), ms: 0, bodies: words[0], tried: 0, burning: words[1], flowing: words[2] !== 0, released: words[3] !== 0 } })
        }
      }
      held = held.slice(at)
    }
  })().catch((e) => self.onerror?.({ message: String(e) }))
  return self
}
