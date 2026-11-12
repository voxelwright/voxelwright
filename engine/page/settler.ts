// The worker that says what falls (#140): one instance of the core. Told everything done to
// the world and where the last change was, it answers with the pieces that are no longer held
// there, how far each drops and what its outside looks like. It keeps nothing between asks.

export interface Fall {
  /** Rows of cells the piece is, where it was: x0, x1, y, z, kind each. */
  runs: Int32Array<ArrayBuffer>
  /** Its outside as faces, two words each (the core's `support::faces`). */
  faces: Uint32Array<ArrayBuffer>
  /** The box round it where it was, in the finest cells (high corner exclusive). */
  box: [number, number, number, number, number, number]
  /** How many cells down it lands. */
  drop: number
  /** Pieces of one round fall together; the next round's are what that fall left perched. */
  round: number
  cells: number
}
export interface Settled { id: number; falls: Fall[]; dust: number; ms: number }

interface Core {
  memory: WebAssembly.Memory
  edits_room(words: number): number
  settle_round(x: number, y: number, z: number): number
  settled_words(): number
}
const ready: Promise<Core> = WebAssembly.instantiateStreaming(fetch('/page/core.wasm'), {}).then((r) => r.instance.exports as unknown as Core)

self.onmessage = async (e: MessageEvent<{ id: number; edits: Int32Array; at: [number, number, number] }>) => {
  const core = await ready, { id, edits, at } = e.data, t0 = performance.now()
  const roomAt = core.edits_room(edits.length)
  new Int32Array(core.memory.buffer, roomAt, edits.length).set(edits)
  const n = core.settle_round(at[0], at[1], at[2])
  const words = new Int32Array(core.memory.buffer, core.settled_words(), n)
  const falls: Fall[] = [], keep: ArrayBuffer[] = []
  let i = 2
  for (let m = 0; m < words[0]; m++) {
    const runs = words[i + 9], faces = words[i + 10], from = i + 11
    const fall: Fall = {
      drop: words[i], round: words[i + 1], cells: words[i + 2],
      box: [words[i + 3], words[i + 4], words[i + 5], words[i + 6], words[i + 7], words[i + 8]],
      runs: words.slice(from, from + runs * 5),
      faces: new Uint32Array(words.slice(from + runs * 5, from + runs * 5 + faces * 2).buffer),
    }
    falls.push(fall)
    keep.push(fall.runs.buffer, fall.faces.buffer)
    i = from + runs * 5 + faces * 2
  }
  const answer: Settled = { id, falls, dust: words[1], ms: performance.now() - t0 }
  ;(self as unknown as Worker).postMessage(answer, keep)
}
