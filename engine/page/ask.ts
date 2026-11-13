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
  /** Where or what it is for. Without one: what is ahead of the eye. */
  target?: Target
}

/** How an ask goes, as the helper says it. `place` comes before the model is asked: where the thing will stand. */
export type Stage =
  | { stage: 'place'; at: [number, number, number]; facing: string }
  | { stage: 'asking'; try: number }
  | { stage: 'refused'; why: string }
  | { stage: 'sending'; name: string; at: [number, number, number]; size: [number, number, number] }
  | Done
/** How it ended. `there`: it stands in the world, and the world's stream brings it. Anything else: nothing was made, and `why`. */
export interface Done { stage: 'done'; state: 'there' | 'fell' | 'not there' | 'unknown' | 'refused'; why?: string; id?: string; name?: string; at?: [number, number, number]; size?: [number, number, number]; ms?: number; tries?: number }

export interface Asker {
  /** Whether this page knows of a helper (it may not be running: `hello` asks it). */
  readonly known: boolean
  /** Asks the helper whether it is there and takes this page's secret. */
  hello(): Promise<boolean>
  /** Sends one ask. `each` hears every stage, the last among them. Resolves to how it ended; never throws. */
  ask(ask: Ask, each?: (stage: Stage) => void): Promise<Done>
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
  return {
    get known() { return helper !== null },
    async hello() {
      if (!helper) return false
      try { return (await fetch(`${helper.url}/hello`, { headers: headers() })).ok } catch { return false }
    },
    async ask(ask, each = () => {}) {
      const end = (done: Done) => { each(done); return done }
      if (!helper) return end(failed('no helper is known to this page: run node helper.mjs on your machine and open the address it prints'))
      let res: Response
      try { res = await fetch(`${helper.url}/ask`, { method: 'POST', headers: headers(), body: JSON.stringify({ ...ask, from: eye(), by: by() }) }) } catch { return end(failed('the helper is not answering: is node helper.mjs running on your machine?')) }
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
      return end(done ?? failed('the helper stopped before it was made'))
    },
  }
}
