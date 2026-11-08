---
name: web-audio-voice
description: Synthesized character voices and short UI sounds with the Web Audio API in the Village home (formant "babble", envelopes, scheduling, autoplay, offline testing). Load before changing src/voice/* or adding any sound to the home.
---

# Web Audio voices

Version 3.1, November 7, 2026 (curves as plain arrays). Version 3 covered buses, cues, sample sprites and their costs. Version 2 added the shared context and the first-context cost. Scope: sound made in code in the browser, as in `home/src/voice/` (#42). No
samples, no dependencies. Verified on headless Chrome 158 (Playwright 1.65,
`channel: 'chrome'`) on macOS; Safari and Firefox are not verified.

Primary sources:
- Web Audio API spec: https://www.w3.org/TR/webaudio/ (AudioParam automation,
  OscillatorNode/PeriodicWave, BiquadFilterNode, OfflineAudioContext,
  DynamicsCompressorNode processing).
- MDN: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API,
  `AudioParam.setValueCurveAtTime`, `BaseAudioContext.createPeriodicWave`,
  `OfflineAudioContext.startRendering`, and the autoplay guide
  https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay,
  `AudioContext.setSinkId` and the constructor's `sinkId` option, and
  https://developer.mozilla.org/en-US/docs/Web/Security/User_activation.
- Chrome's autoplay policy for Web Audio: https://developer.chrome.com/blog/autoplay.
- HTML spec, user activation: https://html.spec.whatwg.org/multipage/interaction.html.
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
Pass the curve as a plain packed array, not a typed array: the argument is a
`sequence<float>`, and Chrome converts a `Float32Array` through its iterator at
about 200 ns a point (0.8 ms for a 4000-point envelope, most of a cue's
main-thread cost), a plain array about six times faster, with the same floats
reaching the param (measured, #52).

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
differed by 1e-3). The spec's informative node-lifetime notes let a browser
collect finished sources and the silent nodes after them; we rely on that and
have not measured memory over a long session. Keep only a `Set` of live sources
for stop and inspection.

**Limiter.** A `WaveShaperNode` soft clip (linear to 0.6, tanh shoulder to
0.89 = -1 dBFS) is stateless. A `DynamicsCompressorNode` applies make-up gain
and an adaptive release, so a word's sound depended on the words before it.

**One context, made at load, resumed by a gesture.** The rule is "no sound before a
gesture", not "no context". Browsers let a page create an `AudioContext` any time;
only starting sound needs user activation. `home/src/voice/context.ts` owns the one
context the voices and the music share (`acquireAudio()` / `release()`, closed when the
last user leaves or on `pagehide`):

1. The page's first context opens the audio device and **blocks the main thread**: 0.6 to
   0.9 s on a blank page, 0.4 to 1.7 s in the real scene (Chrome 158, M1 Pro, five runs),
   whenever it runs. A second context takes 3 to 47 ms. Creating it in `requestIdleCallback`
   only moves the stall: one run froze the finished scene for 1.7 s. In a cold browser the
   old create-on-first-key-press path measured one 3.1 s long task.
2. In Chrome, make it with `new AudioContext({ sinkId: { type: 'none' } })` (0.5 to 1.3 ms),
   `suspend()` it, and attach the real device with `await ctx.setSinkId('')`. That call is
   asynchronous: 0.6 to 5.9 s to finish (under load), and no main-thread gap over 13 ms
   while it did. The context stays `suspended` through the swap.
3. Feature-detect with `'setSinkId' in AudioContext.prototype`. MDN lists it as limited
   availability and experimental (Chrome and Edge); where it is missing, make the context
   when the page has loaded and the browser is idle, or on the first gesture if idle never
   comes. That path still pays the stall (not measured outside Chrome).
4. Headless Chrome starts a context `running`, not `suspended`, so `suspend()` it right
   after creating it unless a gesture has happened.
5. On a gesture (`pointerdown`, `pointerup`, `keydown`, capture phase) call `resume()` and
   nothing else. It takes under 1 ms on the main thread. A `resume()` made while the device
   is still opening settles when it is open (the context runs on the silent sink, pauses
   about 0.2 s during the swap, then recovers by itself). Keep every later gesture resuming
   a context that is not `running`: a touch's `pointerdown` and Escape grant no activation.
6. `visibilitychange`: `suspend()` when hidden, `resume()` when visible again (only after a
   gesture has happened).
7. One `latencyHint`: `'interactive'` (voices speak within 20 ms of their word; the music
   does not mind).

What each browser requires to `resume()` (primary sources, not all verified by us):
- Chrome (71 and later): a context created before the document has a user gesture starts
  `suspended`; call `resume()` after a gesture (Chrome blog). We did not prove transient
  versus sticky activation: headless Chrome 158 ignores the policy and starts contexts
  `running`.
- Firefox: `media.autoplay.block-webaudio` (default true) lets a context play only after
  sticky activation (MDN autoplay guide). Not tested by us.
- Safari / WebKit: no primary Web Audio source found. WebKit's published policy post covers
  `<video>`; the Web Audio rule, `resume()` from inside a user gesture (`touchend` on iOS),
  is the common report and is not verified. The gesture listeners call `resume()`
  synchronously inside the event for that reason, and include `pointerup` for touch.
- The activation-triggering events (HTML spec, MDN User activation): trusted `keydown`
  (not Esc), `mousedown`, `pointerdown` for a mouse, `pointerup` for touch and pen,
  `touchend`. Sticky activation lasts for the session; transient lasts a few seconds.

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

## Cues and the mix (#52)

- One mix per context (`home/src/voice/buses.ts`): ui, world, voices and music buses into a
  master (mute) and one stateless soft limiter. Build it lazily with `mixFor(ctx)` so plugin
  load order never matters. The voices bus ducks the music bus (-6 dB, 80 ms down, back 0.6 s
  after the last word).
- Plugins emit "what happened" events (`home/src/sound/contract.ts`); `home/src/sound/map.ts`
  alone turns them into cues. A new interaction adds an event and a map line, never a clip.
- **Never make a ConvolverNode per play.** Chrome prepares the kernel on the main thread when
  the buffer is set: one per tonal cue cost about 1 ms of main thread per event and doubled the
  offline render cost (84 to 50 ms per audio second). Share one room per context as a send.
- Decode every sample after the first gesture, never on first play. Several takes of one sound
  go in one mono Ogg Opus file with a take table (sprite); round-robin picks a take. Eight CC0
  Freesound recordings came to 104 KB at 48 to 64 kb/s.
- Event to first audible sample: 2.7 to 8 ms on the audio clock (scheduled at
  `currentTime + 4 ms`, rounded to a sample). A cue's `gap` rate-limits it; if two events map to
  the same cue, the gap eats the second, so give each moment its own cue.
- Short cues read about 9 dB quieter on BS.1770 short-term loudness than they sound; compare
  momentary maxima. Round 1 levels: UI cues about -38, world -34 LUFS momentary, voices -24.
- Freesound: search pages, sound pages and HQ previews are public; originals need a login. In
  the T3 preview browser, a hidden iframe per `/people/<user>/sounds/<id>/download/` URL
  downloads each original to the tab's downloads list. Record the licence from the sound page
  at download time.
- Listening rounds: `home/sound-lab.html` plays every variant live and saves picks through a
  dev middleware; `home/scripts/record-sound-lab.mjs` muxes offline renders onto headless
  videos (sync 0.8 to 30 ms).

- What the owner chose over three listening rounds (Nov 7-8): recorded foley over synthesized
  for wood and paper (chose, sent, page), softer and darker than our first levels for anything
  that happens often (turning, notepad), no kalimba or notification-like tones for social
  moments (farewell is chair and steps), and a short synthesized bubble "bloop" for the "!"
  after every melodic two-note call felt annoying. Start new cues from that taste.

## Limits

- Headless Chrome 158 starts an `AudioContext` running without a gesture (a flag
  `--autoplay-policy=document-user-activation-required` did not change that), so a
  headless test cannot prove the browser's autoplay block. It can prove the context is
  suspended with its audio clock at 0 before a gesture, so nothing is rendered.
- A cold-start stall only shows in a browser that has not made a context yet:
  in one that has, the old code also passes. Run a stall check in its own browser.
- The real device after `setSinkId('')` was verified only for state and clock (running,
  advancing), not heard.
- `outputLatency` was 0 to 32 ms headless; real devices add their own.
  Measured latencies are on the audio clock, before the device.
- Renders are identical within -138 dBFS across contexts, not bit-exact.
- Cost: about 67 ms of rendering per second of babble offline on an M1 Pro
  (13 to 16 nodes per syllable). Fine for one speaker; measure before
  letting several voices overlap.
- Not verified: Safari (`webkitAudioContext` era quirks), Firefox, mobile
  autoplay, Bluetooth output latency, the first-context cost outside Chrome.

Refresh when Chrome changes autoplay or AudioParam behaviour, when another
browser becomes a target, or when a probe contradicts a value above.
