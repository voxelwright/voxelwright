// A tap on what is heard (#247), for the checks and for recording a clip: it passes sound through untouched and
// posts what passed, left and right, with the frame of the context's clock each stretch began at. A file of its own
// because a worklet module is loaded by address.
declare const AudioWorkletProcessor: { new (): { port: MessagePort } }
declare const registerProcessor: (name: string, ctor: unknown) => void
declare const currentFrame: number
const SIZE = 4096
class Tap extends AudioWorkletProcessor {
  l = new Float32Array(SIZE); r = new Float32Array(SIZE); at = 0; from = 0
  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const a = inputs[0]?.[0], b = inputs[0]?.[1] ?? a
    if (!a) return true
    outputs[0]?.[0]?.set(a); outputs[0]?.[1]?.set(b!)
    if (this.at === 0) this.from = currentFrame
    this.l.set(a, this.at); this.r.set(b!, this.at); this.at += a.length
    if (this.at >= SIZE) { this.port.postMessage({ from: this.from, l: this.l.slice(), r: this.r.slice() }); this.at = 0 }
    return true
  }
}
registerProcessor('village-tap', Tap)
