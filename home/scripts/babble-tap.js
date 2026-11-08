// check-babble.mjs's measurement tap: an AudioWorklet that reports each 128-sample
// block's peak with its audio time. A file, so the page's CSP ('self' scripts only) loads it.
registerProcessor('babble-tap', class extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0][0]
    let p = 0
    if (ch) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]))
    this.port.postMessage([currentTime, p])
    return true
  }
})
