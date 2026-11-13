// A page's line to a shared world (#140): in place of the worker that moves what is loose, the
// world process behind the page server (world.mjs), which does that for everyone in it. Asks go
// up as they would to the worker; what comes down is the world's stream, in the world's order:
// echoes of what anyone asked, at the moment it was done, and the core's words for what came of
// it. Nothing here is decided by the page.
import type { Answer, Ask } from './mover.ts'

/** An ask as the world did it: who asked, and what. An edit comes with the box of cells it can change, worked out by the server. */
export interface Echo { by: string; blast?: [number, number, number]; radius?: number; spark?: boolean; ignite?: [number, number, number]; edit?: number[]; box?: [number, number, number, number, number, number]; release?: [number, number, number] }
export interface Link {
  postMessage(ask: Ask & { box?: readonly number[] }): void
  onmessage: ((e: { data: Answer }) => void) | null
  onerror: ((e: { message: string }) => void) | null
  /** An ask of anyone's, as the world does it. `live` is false for what was done before this page joined. */
  onecho: ((echo: Echo, live: boolean) => void) | null
  /** Says where this page's eye is (the world's finest cells) and which way it faces. */
  here(at: readonly [number, number, number], yaw: number): void
  /** Where someone else in the world is, when they say. */
  onhere: ((who: { by: string; at: [number, number, number]; yaw: number }) => void) | null
  /** This page's name in the world: an echo `by` it is its own. */
  readonly me: string
  /** Whether all that was kept before this page joined has been read. */
  readonly live: boolean
}

const LOG = 1, STATE = 2, ECHO = 3, NOW = 4, HERE = 5

export function link(): Link {
  let live = false
  const self: Link = {
    me: Math.random().toString(36).slice(2, 10),
    onmessage: null, onerror: null, onecho: null, onhere: null,
    here(at, yaw) { void fetch('/world/here', { method: 'POST', body: JSON.stringify({ by: self.me, at, yaw }) }).catch(() => {}) },
    get live() { return live },
    postMessage(ask) {
      // The world has its own clock: a page never asks it for time.
      if (!ask.blast && !ask.ignite && !ask.ball && !ask.edit) return
      const body = { by: self.me, blast: ask.blast, radius: ask.radius, spark: ask.spark, ignite: ask.ignite, ball: ask.ball, edit: ask.edit && Array.from(ask.edit), release: ask.release }
      void fetch('/world/ask', { method: 'POST', body: JSON.stringify(body) }).then(async (r) => { if (!r.ok) self.onerror?.({ message: `the world refused: ${await r.text()}` }) }, (e) => self.onerror?.({ message: String(e) }))
    },
  }
  void (async () => {
    const response = await fetch('/world/stream?from=0')
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
        if (kind === NOW) live = true
        else if (kind === ECHO) self.onecho?.(JSON.parse(new TextDecoder().decode(payload)) as Echo, live)
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
