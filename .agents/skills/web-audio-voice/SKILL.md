---
name: web-audio-voice
description: Synthesized character voices and short UI sounds with the Web Audio API in the Village home (formant "babble", envelopes, scheduling, autoplay, offline testing). Load before changing src/voice/* or adding any sound to the home.
---

# Web Audio voices

Version 1, November 6, 2026. Scope: sound made in code in the browser, as in `home/src/voice/` (#42). No
samples, no dependencies. Verified on headless Chrome 158 (Playwright 1.65,
`channel: 'chrome'`) on macOS; Safari and Firefox are not verified.

Primary sources:
- Web Audio API spec: https://www.w3.org/TR/webaudio/ (AudioParam automation,
  OscillatorNode/PeriodicWave, BiquadFilterNode, OfflineAudioContext,
  DynamicsCompressorNode processing).
- MDN: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API,
  `AudioParam.setValueCurveAtTime`, `BaseAudioContext.createPeriodicWave`,
  `OfflineAudioContext.startRendering`, and the autoplay guide
  https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay.
- Vowel formants: Peterson and Barney (1952) and Hillenbrand et al. (1995)
  averages, rounded and scaled per voice.

## Verified recipes

**A syllable.** One `OscillatorNode` with a `PeriodicWave` of every harmonic at
`1/n^tilt` (tilt 1.0 bright, 2.2 dark and round; never odd-only, which is the
harsh square buzz) into a `GainNode` envelope, then three parallel `bandpass`
`BiquadFilterNode`s at the vowel's formants, `Q = f / bandwidth`, plus a little
`lowpass` body. Values in use (Hz, before the per-voice `formant` scale):

| Vowel | F1 | F2 | F3 |
| --- | --- | --- | --- |
| a | 800 | 1250 | 2700 |
| e | 560 | 1900 | 2600 |
| i | 320 | 2300 | 3000 |
| o | 540 | 920 | 2500 |
| u | 360 | 900 | 2300 |

Bandwidths 90, 120 and 170 Hz, levels 1, 0.55 and 0.22, with about x3.2 make-up
gain because band-passes keep only a sliver of the source. A formant scale of
0.92 sounds big and warm, 1.4 small and bright. Consonants: a looped seeded
noise `AudioBufferSourceNode` through a band-pass (s 6.2 kHz, sh 3.2 kHz,
t 3.8 kHz, k 2 kHz, p 0.9 kHz) for 12 to 35 ms.

**Envelopes and pitch as curves.** `setValueCurveAtTime(Float32Array, t, dur)`
for the gain envelope (raised-cosine attack over 12%, decay, cosine release to
0) and for the pitch contour (glide plus vibrato in one array). One automation
event per parameter, deterministic, and no LFO nodes.

**Schedule ahead on the audio clock.** Start at `ctx.currentTime + 0.006`, keep
a cursor so the next word starts after the last, and round every start and
duration to a whole sample (`Math.round(t * sampleRate) / sampleRate`). Sources
start with sub-sample accuracy, so without rounding the same word renders up to
-36 dBFS differently at different times (measured).

**Stop.** Each speaker has its own bus `GainNode`: `cancelScheduledValues(t)`,
`setValueAtTime(1, t)`, `linearRampToValueAtTime(0, t + 0.012)`, then `stop()`
every source on that bus. Silent below -60 dBFS within 17 ms (measured).

**Do not disconnect from `onended`.** It fires on the main thread at a moment
that varies run to run, cutting filter tails at random points (renders then
differed by 1e-3). Finished sources and the nodes after them are released by
the browser; keep only a `Set` of live sources for stop and inspection.

**Limiter.** A `WaveShaperNode` soft clip (linear to 0.6, tanh shoulder to
0.89 = -1 dBFS) is stateless. A `DynamicsCompressorNode` applies make-up gain
and an adaptive release, so a word's sound depended on the words before it.

**Autoplay.** Create the `AudioContext` inside the first `pointerdown` or
`keydown` (capture phase), or at load when `navigator.userActivation.hasBeenActive`
is already true. Call `resume()`. Close it on unload and `pagehide`.

**Testing without ears.** Render with `OfflineAudioContext(1, n, 48000)` from
the page (Vite serves `/src/...ts` to `import()`), return samples as base64
and measure in Node: YIN pitch (take the shortest lag within 0.06 of the best
normalized difference, or a formant on the second harmonic reads an octave
up), Hann-windowed FFT spectral centroid, BS.1770 integrated loudness (K
weighting, 400 ms blocks, -70 and -10 LU gates), sample peak. For the live
context, tap the output with an `AudioWorkletNode` from a Blob URL that posts
each 128-frame block's peak with `currentTime`, so latency is measured on the
audio clock (about 2.7 ms resolution), not with rAF. See
`home/scripts/check-babble.mjs`.

**Recording sound with video.** Playwright video has no audio. Cover the page
in black until the sound starts, find the cover's end with ffmpeg
`blackdetect`, render the WAV offline from the logged event times, and mux with
`-itsoffset`. See `home/scripts/demo-babble.mjs`.

## Limits

- Headless Chrome 158 starts an `AudioContext` without a gesture, so a
  headless test cannot prove the browser's autoplay block; it can only prove
  the plugin creates no context before one.
- `outputLatency` was 0 to 32 ms headless; real devices add their own.
  Measured latencies are on the audio clock, before the device.
- Renders are identical within -138 dBFS across contexts, not bit-exact.
- Cost: about 67 ms of rendering per second of babble offline on an M1 Pro
  (13 to 16 nodes per syllable). Fine for one speaker; measure before
  letting several voices overlap.
- Not verified: Safari (`webkitAudioContext` era quirks), Firefox, mobile
  autoplay, Bluetooth output latency.

Refresh when Chrome changes autoplay or AudioParam behaviour, when another
browser becomes a target, or when a probe contradicts a value above.
