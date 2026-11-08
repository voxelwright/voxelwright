// check-music.mjs's measurement tap: an AudioWorklet that reports each 128-sample
// block's sum of squares and peak with its audio time. A file, so the page's CSP ('self' scripts only) loads it.
registerProcessor('music-tap', class extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0][0]
    let s = 0, p = 0
    if (ch) for (let i = 0; i < ch.length; i++) { s += ch[i] * ch[i]; p = Math.max(p, Math.abs(ch[i])) }
    this.port.postMessage([currentTime, s, p])
    return true
  }
})
