---
name: game-sound
description: How Village's engine makes sound (#247), all of it synthesised in an AudioWorklet from patches that are strict data (engine/page/sound/). What makes game sound good, physically informed synthesis (modes, strings, noise beds), the patch form a model writes, the loudness ceiling, how it is checked without ears, AudioWorklet on iOS Safari, and what is not verified. Load before changing engine/page/sound/, adding a sound to the engine, or asking a model for a patch. The old home's sound (samples, babble) is `web-audio-voice`.
---

# Sound in the engine

Version 1, November 13, 2026. Scope: `engine/page/sound/` and `engine/test/{sound,heard,listen,ears}.mjs`.
Verified on the installed Chrome (headless, macOS, M1 Pro, 44.1 kHz device) and Playwright's WebKit build on the same Mac.
**No iPhone has played it yet** (see Limits). Nobody who wrote it has heard it: every claim about how a thing
sounds is a measurement or a principle, and is marked as such.

## Sources, and how far each was read

Four Sonnet reads on November 13 (logged in `.agents/dispatch-log.jsonl`). Much of the standard literature would
not fetch; what is from memory is said to be.

| Fetched and read | What it gave |
| --- | --- |
| van den Doel, Kry, Pai, "FoleyAutomatic" (SIGGRAPH 2001), cs.ubc.ca/~kvdoel/publications/foleyautomatic.pdf | The modal model: a sum of damped sines, gains by where it is struck; the contact force as `1 - cos(2 pi t / tau)` over a contact time `tau` (hardness sets it; 50 microseconds for marble); a single click sounds too clean, real blows are several within 15 ms; modes can be dropped at run time |
| Euler-Bernoulli beam (Wikipedia) | A free bar's modes: 1, 2.756, 5.404, 8.933 |
| STK `Shakers.cpp` (Cook's PhISEM), github.com/thestk/stk | Many small collisions as random events through resonators: gravel, drops |
| J. O. Smith, "Physical Audio Signal Processing", ccrma.stanford.edu/~jos/pasp | Karplus-Strong, the one-zero loop filter and its half sample of delay, piano stretch |
| WebKit bugs 237322, 226240, 258864, 232728; MDN `AudioContext.state`, `AudioWorkletGlobalScope`, `AudioSession`; caniuse | iOS: see below |
| Toussaint 2005 (BRIDGES), Witek et al. 2014 (PLOS ONE), Marshall's review of Butler 2006, the iMUSE patent US5315057 | Music: for the music step, not yet used |
| Sony ASWG-R001 through a Sony audio director's slides; ITU-R BT.1359 through summaries | -24 (or -23) LUFS for home, -18 for portable, true peak -1 dB; sound may lag picture by 100 ms unnoticed but lead it by only 35 to 45 |

From memory, not fetched (Farnell's and Cook's own pages did not resolve, Audiokinetic and FMOD refused): Farnell's
"Designing Sound" recipes (fire is hiss, crackle and roar; wind is noise through a wandering band; rain is hiss
and drops; a footstep is a force curve); Wildes and Richards' loss factor (a mode's decay time is
`1 / (pi f tan phi)`, so high modes die first, metal about 1e-4, wood 1e-2); Hertz contact (contact time goes
with speed to the power of minus a fifth); Jaffe and Smith's string extensions; variation, layering, voice limits
and ducking as game practice. They are used as principles here and each is checked by a measurement of our own
output, not by the source.

## What makes it good, as built

1. **No two blows alike.** Nothing is a recording, so nothing repeats: the grit in a touch is fresh noise, and
   the page varies size and force by about 10% a blow (`world.ts`). The check renders two blows and requires
   them to differ.
2. **Layers.** A patch is a touch, a body that rings, an optional rush of air and optional pieces going on
   after. A blast is two patches: a crack that only those near hear and a boom that carries.
3. **Force changes the sound, not only its level.** Harder is louder (`force^1.2`), shorter in contact
   (`force^-0.2`) and wakes the upper modes (`(f1/f)^(1 - force)`).
4. **Distance.** Half as loud at a `reach` in metres (hammer 5, charge 72, big charge 190), silent past sixty
   reaches; duller with distance (one pole at `400 + 19600 exp(-d / 90)` Hz: our curve, tuned by the far blast
   check, not from a table); later by `d / 343` s; more of it to the room. Close by, a thing is not panned
   hard: side goes with `min(1, d / 1.5 m)`.
5. **The mix.** Three buses (world, music, play). The world ducks the music by up to 9 dB inside the
   synthesiser. Beds full up measure -30 to -18 LUFS; a charge on a house front peaks at -4 dB.
6. **A budget of voices.** 64 struck, 16 strings, 16 tones, 24 airs, 40 grains. When a pool is full the
   quietest gives way. Of the blows in one telling of the solver, five are played and the rest feed the
   rubble's bed.
7. **Feedback is fast.** A hammer blow by the page's button is heard 9 to 140 ms later; all of that is the
   page asking the GPU what is ahead. A note itself leaves 3 ms (the ceiling's look-ahead) after it is asked.

## The pieces

- `patch.ts`: the form (`patch()`, `sounds()`, `compile()`). Keys: `how` (struck, plucked, blown, rubbed),
  `hard`, `rough`, `shape` or `modes`, `pitch`, `ring`, `damp`, optional `where`, `bend`, `waver`, `pieces`,
  `air`, and `gain`. Unknown keys, wrong types and numbers out of range are refused with the reason. A thing's
  `sounds` is patches under `hit`, `break`, `step`, `use`, `hum`, `play`.
- `dsp.ts`: the synthesiser. One file, no imports at run time. In a page it registers the worklet
  `village-voice`; in Node `new Synth(rate).render(l, r)` gives the same samples. Messages: `define`, `notes`
  (twelve float64 each: frame, patch, pitch, size, force, held, left, right, low-pass, room, bus, piece), `set`,
  `hush`.
- `sound.ts`: the context, the unlock, `play(patch, {at, force, size, reach, ...})`, `listen(eye, yaw)`,
  `hear(at)`. `kinds.ts`: the world's own patches, by the core's materials. `world.ts`: what the page tells
  (tools, blasts, the solver's words, a frame) turned into plays and bed levels. `tap.ts`: a worklet that
  copies what passes it, for checks and clips. `lab.html`: every sound, played by hand.

## Rules that hold

- **A patch is data and is never run.** The worklet's code is ours.
- **The ceiling is in the synthesiser, after everything**: a limiter that looks 3 ms ahead and holds at
  -4.4 dBFS, then a hard stop at -1 dBFS (`CEILING`). Everything settable is clamped where it is set
  (`LEAST`/`MOST`): the check found that an unclamped rain level of 1e9 hung the audio thread in a loop of
  drops. A sample that is not a number silences and resets everything (`stats.reset`).
- **Sample rate is whatever the device has.** This Mac's device runs at 44.1 kHz; nothing may assume 48.
- **Nothing is allocated on the audio thread after the constructor**, and the page sends one message a frame
  (an instrument's note is sent at once).
- Times are frames in float64: a float32 loses whole frames after six minutes at 48 kHz.
- A note's time is the context's `currentTime` when asked plus its delay, so a late frame does not make a
  distant blast later.
- A shared world replays what was kept when a page joins: `main.ts` passes the solver's words on only when
  `!far || far.live`, or a join would play every blast in the file at once.

## Checked without ears

`node test/sound.mjs` (Node only, about 40 s) and `node test/heard.mjs` (the real page in Chrome). `--out dir`
and `--wav file` keep WAVs and spectrograms; `node test/listen.mjs --out clip.webm` records picture and sound
together. `test/ears.mjs` has the measures: FFT peaks, centroid, share of power in a band, decay time,
BS.1770 loudness, onset.

| A check says | It stands in for |
| --- | --- |
| steel rings 1.5 s, glass 0.4, wood 0.1, brick 0.06 (to 40 dB down) | material by decay |
| glass's weight is at 1.5 kHz, rock's 690 Hz, earth's 480 Hz | material by brightness |
| a blow at full force is 29 dB louder and its weight half an octave higher | force |
| four times the size, two octaves lower | size |
| one mode asked for at 440 Hz, 1.5 s: 440.0 Hz, 1.50 s | the resonator is right |
| strings within 0.1 cent at 82 to 1318 Hz, at 44.1 and 48 kHz | tuning |
| 2,400 patches at the edges of the form, 60 notes at once, every bed full: -3.8 dB at most | never loud enough to hurt |
| numbers no check would pass given straight to the synthesiser: -4.2 dB, and it reset itself | the same, without the check |
| a blast 173 m off is heard 0.51 s after it is seen | distance |
| 120 voices and every bed: a block takes 0.45 ms of 2.7 in Node (17%) | cost |

**What no check says**: whether a hammer on brick sounds like one, whether rain is pleasant or is static,
whether the mix is right. The owner chose recorded foley over synthesised wood and paper in the old home
(`web-audio-voice`): wood is the likeliest to disappoint. Use `/page/sound/lab.html` and ask.

## Measured cost (M1 Pro)

- Audio thread in Chrome, a house front coming down (92 blows played, 36 folded): 0.6 to 0.9% of its time,
  worst block 1 ms of 2.9 (the worklet's clock is coarse: 1 ms steps).
- Main thread: 0.04 ms a frame for `frame()`, 0.006 ms a note. Frame times with and without sound could not be
  told apart (the machine was shared with three other lanes; load average 50).
- The first `AudioContext` is made while the page loads (it can block a thread for a second: `web-audio-voice`).

## AudioWorklet on iOS Safari

- Worklets since iOS 14.5. A worklet module served as `.ts` with the types stripped loads in Chrome and in
  WebKit (tried). Static imports inside a worklet were avoided, not tested: `dsp.ts` imports only types.
- **The ringer switch silences Web Audio** unless `navigator.audioSession.type = 'playback'` (WebKit bug
  237322; iOS 17 is the safe floor). `sound.ts` sets it. Not tried on a phone.
- **A touch going down does not unlock audio; its coming up does** (`touchend`, `pointerup`, `click`,
  `keydown`). `sound.ts` listens for those in the capture phase and resumes; the same listeners resume after
  `interrupted` (a call, a lock, another app). Headless Chrome here did start `suspended` and did resume on a
  click.
- Open WebKit bug 226240: "each time any AudioWorklet is used on iOS it creates glitches" (XR, M1 Air), no fix
  listed. Bugs 258864 and 232728: wrong speed after a Bluetooth speaker connects. If the owner's phone
  crackles, these are the first suspects; rebuilding the context is the listed workaround.
- Whether `performance.now()` exists in the worklet was not settled (the worklet's times come in 1 ms steps
  in both browsers, which either clock would give); the code uses it if it is there and `Date.now()` if not.

## Limits and not built

- Not heard by its makers. Not run on an iPhone: first touch, the ringer switch, glitches and cost there are
  all unproved.
- A body's blow is read from its change of speed between two tellings (late by one, misses a glance) until
  the core reports impacts (#245).
- Nothing is occluded: a wall between does not dull a sound. No Doppler. The room is one small reverb for
  everywhere.
- Residents' steps, vehicles, doors and water that flows make no sound yet.
- A struck string has no double decay and at most twelve partials; plate, lump and cup mode ratios are our
  own choice, not measured.

Refresh when a phone has played it, when the core reports impacts, or when a check's numbers move.
