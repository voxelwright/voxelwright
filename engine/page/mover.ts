// The worker that moves what has come loose (#146): one instance of the core, which holds the
// bodies and the world as they meet it. The page tells it of each blast, which answers with
// what the blast threw out and loosened, and then asks it every frame to move the bodies on. It answers in the core's own
// words (told.ts reads them). Everything is done in the order asked.

/** What the page asks: a blast (where, how big, and how many of the mover's own edits the page had applied when it made it), or time to move on by. */
export interface Ask { blast?: [number, number, number]; radius?: number; after?: number; tick?: number }
/** What comes back: the core's words, how long it took, how many bodies still move and how many points it tried against the world. */
export interface Answer { words: Uint32Array<ArrayBuffer>; ms: number; bodies: number; tried: number; released: boolean; failed?: string }

interface Core {
  memory: WebAssembly.Memory
  edits_room(words: number): number
  bodies_blast(x: number, y: number, z: number, radius: number, after: number): number
  bodies_advance(dt: number): number
  bodies_words(): number
  bodies_count(): number
  bodies_tried(): number
}
const ready: Promise<Core> = WebAssembly.instantiateStreaming(fetch('/page/core.wasm'), {}).then((r) => r.instance.exports as unknown as Core)
const post = (answer: Answer) => (self as unknown as Worker).postMessage(answer, [answer.words.buffer])

self.onmessage = async (e: MessageEvent<Ask>) => {
  const ask = e.data, t0 = performance.now(), released = !!ask.blast
  try {
    const core = await ready
    const n = ask.blast ? core.bodies_blast(ask.blast[0], ask.blast[1], ask.blast[2], ask.radius ?? 0, ask.after ?? -1) : core.bodies_advance(ask.tick ?? 0)
    // The call first, then the memory: making bodies may have grown it.
    const at = core.bodies_words()
    post({ words: new Uint32Array(core.memory.buffer, at, n).slice(), ms: performance.now() - t0, bodies: core.bodies_count(), tried: core.bodies_tried(), released })
  } catch (failed) {
    // Out of memory, most likely: the page is told, so that a device can report it.
    post({ words: new Uint32Array(0), ms: performance.now() - t0, bodies: 0, tried: 0, released, failed: String(failed) })
  }
}
