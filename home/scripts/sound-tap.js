// check-sound.mjs's and check-sound-lab.mjs's measurement tap: an AudioWorklet that reports
// each 128-sample block's peak across all channels with its audio time. A file, so the page's
// CSP ('self' scripts only, no blob:) loads it; the dev server serves it from scripts/.
registerProcessor('sound-tap', class extends AudioWorkletProcessor {
  process(inputs) {
    let p = 0
    for (const ch of inputs[0] ?? []) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]))
    this.port.postMessage([currentTime, p])
    return true
  }
})
