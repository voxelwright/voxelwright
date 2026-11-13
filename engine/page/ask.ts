// One ask (#243, #244): what the page sends to have something made, and the one function that sends it. The
// ask bar, the wand and anything else that wants a thing made call `ask` here; none of them talks to the helper
// itself.
//
// The helper (engine/helper.mjs) runs on the asker's own machine and starts their own model. The page is told
// where it is and its secret once, in the part of the address after # (`#helper=http://127.0.0.1:5762&secret=…`),
// which is taken out of the address at once and kept by this page (localStorage). The world's server never sees it.

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
  /** Where or what it is for. Without one: what is ahead of the eye. */
  target?: Target
}

/** How an ask goes, as the helper says it. `place` comes before the model is asked: where the thing will stand. */
export type Stage =
  | { stage: 'waiting'; ahead: number }
  | { stage: 'reading' }
  | { stage: 'known'; name: string }
  | { stage: 'place'; at: [number, number, number]; facing: string }
  | { stage: 'asking'; try: number }
  | { stage: 'shaped'; name: string; size: [number, number, number]; facing: string }
  | { stage: 'refused'; why: string }
  | { stage: 'note'; why: string }
  | { stage: 'sending'; id: string; name: string; at: [number, number, number]; size: [number, number, number]; facing: string }
  | Done
/** How it ended. `there`: it stands in the world, and the world's stream brings it. Anything else: nothing was made, and `why`. */
/** `held`: it is made and no place near would take it. `held` is what `put` takes to stand it where the asker says next. */
export interface Done { stage: 'done'; state: 'there' | 'fell' | 'not there' | 'unknown' | 'refused' | 'held'; held?: string; moved?: number; left?: number; why?: string; id?: string; name?: string; at?: [number, number, number]; size?: [number, number, number]; ms?: number; tries?: number }

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
  /** How many asks are being made or waiting. */
  readonly busy: number
  /**
   * What an ask with no target of its own is aimed at, if anything says (the wand's: it sets this while it aims).
   * Null, or a function that returns undefined: what is ahead of the eye.
   */
  aim: (() => Target | undefined) | null
}

const KEPT = 'village.helper'

/** `eye` says where this page's eye is and looks (the world's finest cells), `by` the name it goes by. */
export function asker(eye: () => { eye: [number, number, number]; toward: [number, number, number] }, by: () => string): Asker {
  let helper: { url: string; secret: string } | null = null
  try { helper = JSON.parse(localStorage.getItem(KEPT) ?? 'null') } catch { /* a page that may keep nothing */ }
  // Given in the address: kept, and taken out of the address so it is not left in the bar or passed on.
  const given = new URLSearchParams(location.hash.slice(1))
  if (given.get('helper') && given.get('secret')) {
    helper = { url: given.get('helper')!.replace(/\/$/, ''), secret: given.get('secret')! }
    try { localStorage.setItem(KEPT, JSON.stringify(helper)) } catch { /* the same */ }
    history.replaceState(null, '', location.pathname + location.search)
  }
  const headers = () => ({ 'Content-Type': 'application/json', 'X-Village-Secret': helper!.secret })
  const failed = (why: string): Done => ({ stage: 'done', state: 'refused', why })
  let last: Promise<unknown> = Promise.resolve(), busy = 0
  const self: Asker = {
    aim: null,
    get busy() { return busy },
    get known() { return helper !== null },
    async hello() {
      if (!helper) return false
      try { return (await fetch(`${helper.url}/hello`, { headers: headers() })).ok } catch { return false }
    },
    async ask(ask, each = () => {}) {
      const end = (done: Done) => { busy--; each(done); return done }
      // Where the eye is and what is aimed at are as they were when it was asked, not when its turn comes.
      const body = JSON.stringify({ ...ask, target: ask.target ?? self.aim?.(), from: eye(), by: by() })
      if (busy++) each({ stage: 'waiting', ahead: busy - 1 })
      const before = last
      let free!: () => void
      last = new Promise<void>((r) => { free = r })
      await before
      try { return await send('/ask', body, each, end, JSON.parse(body).from) } finally { free() }
    },
    async put(held, how, each = () => {}) {
      const end = (done: Done) => { busy--; each(done); return done }
      const from = how.clear ? asked.get(held) ?? eye() : eye(), body = JSON.stringify({ held: held.held, clear: how.clear, from, by: by(), target: how.clear ? undefined : self.aim?.() })
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
      let held = '', done: Done | null = null
      try {
        for (;;) {
          const { value, done: ended } = await reader.read()
          if (ended) break
          held += value
          for (let at = held.indexOf('\n'); at >= 0; at = held.indexOf('\n')) {
            const stage = JSON.parse(held.slice(0, at)) as Stage
            held = held.slice(at + 1)
            if (stage.stage === 'done') done = stage
            else each(stage)
          }
        }
      } catch { /* cut off: said below */ }
      if (done?.state === 'held') asked.set(done, from)
      return end(done ?? failed('the helper stopped before it was made'))
    }
  }
  return self
}
