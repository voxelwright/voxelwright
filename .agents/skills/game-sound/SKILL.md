---
name: game-sound
description: How Village's engine makes sound (#247), all of it synthesised in an AudioWorklet from patches that are strict data (engine/page/sound/). What makes game sound good, physically informed synthesis (modes, strings, noise beds), the patch form a model writes, the loudness ceiling, how it is checked without ears, AudioWorklet on iOS Safari, and what is not verified. Load before changing engine/page/sound/, adding a sound to the engine, or asking a model for a patch. The old home's sound (samples, babble) is `web-audio-voice`.
---

# Sound in the engine

Version 7, November 14, 2026 (music, instruments, model-written sounds, a rule's sounds, a realm's music, a voice being tried). Scope: `engine/page/sound/` and `engine/test/{sound,music,heard,played,listen,ears}.mjs`.
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
| Toussaint 2005 (BRIDGES), Witek et al. 2014 (PLOS ONE), Marshall's review of Butler 2006, the iMUSE patent US5315057 | Music: see below |
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
7. **Feedback is fast, except where the page waits for the GPU.** A hammer blow by the page's button is heard
   125 to 290 ms later on a busy machine; all of that is the page asking the GPU what is ahead, and it is too long. A note itself leaves 3 ms (the ceiling's look-ahead) after it is asked.

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

## Music (`page/sound/music/`)

After the owner's reference (Deedy Das, November 12, 2026). Its own page could not be read (it needs the owner's
yes in the thread that asks), so this is built from the post's description and from the sources it cites.

- **Rule and search.** `rules.ts`: 27 rules, each a measurement from 0 to 1 with what it is for, its source and
  whether that source was read (11), is from memory (13) or is ours (3). `compose.ts`: the harmony first, then
  each voice: 3,000 random candidates, the weighted mean of its rules, the best kept with each rule's score. A
  section takes 20 to 80 ms in Node; in the page it is found on a worker.
- **What was read**: Toussaint 2005 whole (Euclidean rhythms; `euclid(k, n)` gives his own forms: tresillo
  `x..x..x.`, and turns of the cinquillo, the Venda clap, the samba); Witek 2014 (medium syncopation is liked
  best, so `pushes` peaks in the middle); Butler 2006 only through Marshall's review (four on the floor; layers);
  Krumhansl and Kessler's profiles (values from rnhart.net). The syncopation measure is after Longuet-Higgins and
  Lee as commonly given, not read. Huron and Narmour's melody rules are from memory.
- **The place chooses the idiom** (`MOODS`): town a house groove at 116, coast a lilt in six, sea no pulse with
  three lines 3, 5 and 7 bars long that line up again only after 105 bars (Eno's incommensurable loops), snow
  bells, night a piano, danger Phrygian at 138, making a marimba. **All are in D**, so a handover is a change of
  mode. `world.ts` picks: danger (a charge near by, many bodies, much fire), then making (`wishes.busy`), then
  under the sea or above 2.5 km, snow, night, coast or open country, town.
- **It does not repeat.** A piece is composed from a new number each time. Within a piece the drums and chords
  hold (a groove seed that changes every two sections) and melodies are found again each section, scored on
  coming back to the piece's first figure. Calm places are silent for 25 to 140 s between pieces (Minecraft
  waits 10 to 20 minutes; Breath of the Wild leaves the field mostly silent). Forty seeds gave forty melodies
  and thirteen hats: the rules leave a hat little room, which is the idiom.
- **No seam** (`conductor.ts`): notes are given 0.35 s ahead on the audio clock. When the place changes and has
  held 4 s, the old piece stops being struck at its next bar line (danger: next beat) and rings out; the new
  starts there with two layers. Measured: the quietest quarter second after a town-to-coast handover is 8 dB
  under the town before it, and no sample step is bigger than the music's own.
- **Instruments are patches** (15 of them), played on the music bus at half level: each place measures -33 to
  -28 LUFS, and the world ducks it.
- Not built: no tempo-matched crossfade (the old pulse just stops), no stingers, one arrangement arc for every
  piece, nothing follows what the player does beyond the place. Whether any of it is pleasant is unheard.

## Instruments (`instrument.ts`, `surface.ts`, `instruments.ts`, `things.ts`)

- **What the named games do** (a Haiku lookup, November 13): no Spider-Man game was found with a playable guitar;
  the well-known one is The Last of Us Part II's (the left stick picks one of six chords from a wheel, the touchpad
  is six string regions to strum across or pluck; Naughty Dog's article on gamedeveloper.com). Ocarina of Time: five
  notes on five buttons, low to high; a bend by the stick is reported, not confirmed. Genshin Impact's lyre lays
  three rows of seven notes on three rows of keys. No source gives a latency target.
- **The form.** A thing's `sounds` may hold `surface` beside `play`: `{size, release?, parts}`. A part is a `rect`,
  `round` or `poly` with a named colour, a label of up to six plain characters and a key, and at most one of
  `note` (with `slide` to a second pitch along x or y, and `level` along x or y), `chord`, `strum`; `string` marks a
  part as a string that chords retune. A part with none of those is drawing. `surface()` refuses anything else
  (markup in a label, a key that is not a letter, digit or Space, a colour that is not a name, a part off the edge).
  It is drawn as SVG built here from the numbers; nothing a model wrote is ever markup or code.
- **This is the free-layout form, not model-written code.** The owner asked that the bold form be tried first
  (November 13). What decided it: a note must be asked for inside the input event. Anything that looks up the GPU
  per touch (9 to 290 ms measured for the page's pick) or calls a sandbox per note cannot feel played. Code in a
  sandbox that only lays a surface out, and playing by touching the thing's own cells (which needs each part's box
  projected to the screen every frame, not a pick), were not tried.
- **Held notes.** A note's last number, from 2 up, names it: it sounds until `release(id)`, and a tone can be
  bent with `glide(id, hz, level)` (it arrives in about 8 ms). Let go, a tone dies by its patch; a string or a
  struck thing is damped in a seventh of a second where the surface says `"release": "stops"` (a piano), and rings
  otherwise (a guitar). Voices on the play bus are never stolen for the world or the music.
- **Delay, measured** (`test/played.mjs`, real key events in Chrome): 3.1 ms from the audio clock's reading at the
  key press to the first sample leaving the synthesiser (all of it the ceiling's look-ahead), the page getting the
  key 0.5 ms after it was pressed. Beyond that is the device: this Mac reports 5.8 ms held by the browser and 32 ms
  of output headless. A Bluetooth speaker adds its own (commonly 100 ms or more: from memory) and nothing here can
  shorten it.
- **In the world** (`things.ts`): a made thing with a surface within 4 m shows a button ("Play the piano (E)");
  E or the button opens its surface in a hud panel and pushes an input mode that takes every key (`every`, added to
  `input.ts` for this: Q is a string, not the wand); keys coming up are read from `input.held`; Escape or E puts it
  away, and so does walking 10 m off. The place's music drops to a fifth while it is out. A thing struck with the
  hammer answers with its own `hit`.
- `node instrument.mjs piano --world url` stands a kept one in a shared world (cells and record, no model).
- Not built: velocity from how fast a key is struck (a key is always 0.75; a touch uses pressure where the device
  gives it); sustain pedal; other players do not hear what you play; strings cannot be bent.

## Sounds written by a model (`brief.ts`, `voice.mjs`, `kept/`)

- `brief.ts` is what a model is told: both forms in words, with the numbers that are true to stuff (brick rings
  0.06 s, a bell 5; felt is hard 0.1, steel 1). About 1,400 tokens. It is written to go beside the maker's brief
  so that a thing comes with its sounds in one reply; the making lane (#244) owns that ask.
- `voice.mjs` runs it alone: `make/model.mjs`'s `reply()` unchanged (the asker's own Claude Code, no tools: see
  `claude-code-headless`), `sounds()` on the reply, the reason sent back on a refusal, three tries.
- **One run each, November 13, 2026, kept in `page/sound/kept/`**: a kalimba, a steel pan, a wind chime, a vase
  and a rubber duck from Sonnet 5.5 (6 to 24 s, $0.006 to $0.04 as the binary reports usage), a theremin and a
  church bell from Opus 5.5 (15 and 12 s, $0.04 to $0.05). **All seven were in the form on the first try.**
  The bell came with its own modes (hum, prime, tierce, quint, nominal); the vase breaks in 24 pieces; the
  kalimba has 17 tines with the longest and lowest in the middle; the steel pan's notes are laid in rings; the
  theremin is one part that slides three octaves along x with loudness along y. Seven is a small sample: the
  refusal path is tested with made-up bad data, not with a model's own mistakes.
- What a model's reply showed up: a plucked bar was being played as a string. `compile()` now marks only a
  plucked `string` as strung; anything else plucked is modes set going by a touch.
- The checks read the kept replies as data and measure them (the bell rings 6 s from 185 Hz, the duck 0.06 s).
  No check runs a model, and none proves a model integration beyond these seven runs.

## A realm's rule makes a sound (`engine/plugins/sound`, `page/sound/likes.ts`; #264)

- `world.sound({like | patch, at | on, force, size, note | notes | pitch, gap, for, reach})` is an entry in the
  world process's `does`. It checks every field as a stranger's (a stray field, a like that is not kept, a patch
  that `patch()` refuses or that is over 1,200 characters, nobody to sound on: each is left and said to the rule),
  caps a rule at twelve sounds a second, and tells pages once through the plugin (`pages.once`, not kept, only to readers
  who are live). The page reads it again as a stranger's (`world.ts` `sounded`) and plays it through `voice.play`
  like anything else: distance, delay, side.
- A patch a rule wrote is kept by its JSON, the last 96; an older one gives its place in the synthesiser back
  (`voice.forget`). Before this a stranger could have used up the worklet's 4,096 patch places and silenced the
  page for good.
- **The guide is the interface.** `serve.mjs` `GUIDE` lists every kept sound with what it is like (made from
  `LIKES`, so the two cannot drift) and the patch form in six lines. Asked for a busker and a night watchman
  (`make/rules.mjs`, Opus 5.5, November 14), a model used it at once: chords as `notes` with `gap: 25`, a melody
  with `gap: 250`, a hand bell as `bell` at `size: 0.6` struck n times, a `whistle` held 0.8 s. Neither used
  `patch`: with a word that fits, a model takes the word. Two runs; no model has yet written a patch in a rule.
- Measured (`test/sounded.mjs`): an anvil of the rule's own at 940 Hz is heard at 941 Hz and 9 dB louder on the
  side the smith stands; a bell 84 m off arrives 0.25 s after the rule strikes it (0.24 by distance); a bell of
  size 2 sounds at 260 Hz.
- Not built: a sound that follows a moving actor after it starts (it is placed once); a held sound a rule can stop
  early or bend; anything heard by rules.

## A realm's music, set by a rule (`engine/plugins/music/`, `music/compose.ts` `resolve`; #264)

- `world.music({like, pace, mode, drive, now})`: `like` one of `MOODS`, `pace` 40 to 180, `mode` one of `MODES`
  (major, lydian, mixolydian, dorian, minor, phrygian, pentatonic; all on D), `drive` 0 to 1, `now` for the next
  beat. Only the fields given change. The world's process keeps one music a realm (who changed it last owns it; a
  call that changes nothing does not take it, which the check found the hard way), tells its page side through the plugin's `pages.state` (given again to a page that joins later), and forgets it
  when the owning rule is taken out. Not kept over a restart.
- **It is an engine plugin** (`world.mjs`, `page.ts`, `guide.txt`, `check.mjs`): it first landed as lines in
  `world.mjs`, `serve.mjs` and `link.ts` (#281) and another lane's change took those lines out again within the
  hour without meaning to. In a folder of its own nothing of it is in a file others edit. `guide.txt` is written by
  hand and the check holds it to the code (every mood, its pace, every mode).
- A mood asked for is a name, `like|0|mode`; `resolve()` makes it from the kept mood (same voices and rules,
  another scale) in the page and in the composing worker alike. A new name is a new piece at the next bar.
- **Pace is not part of the name.** The first real rule (a storyteller) raised the pace a beat at a time, and with
  pace in the name every nudge was a new piece: the music started again every few seconds and never got past two
  layers. The conductor now gives notes a step at a time, each step as long as the pace asked for makes it, so a
  piece changes speed from one step to the next and nothing is composed again.
- `drive` is not a new piece: the conductor takes `1 + drive x (layers - 1)` layers from the next notes on, and
  pieces follow with no quiet between while a rule has the music.
- In the page the rule's music stands in for the place's whatever else is so (the engine's own danger too).
- Measured (`test/tuned.mjs`): a page that joins later plays `town|130|minor`, every note in the minor scale;
  drive to 1 brings all four layers in 0.2 s; the low end comes round every 460 ms where a beat at 130 is 462;
  asked to go faster the same piece is at 160 with its layers still in; a rule's gale is alarm at 150 within a
  beat of the rule saying so.
- A model's use (one real run, a storyteller): `night` in Dorian, drive and pace from how far the story is,
  Phrygian for the last lines, `like: null` at the end.
- Not built: a mood whose instruments or rhythm a rule writes (it picks from seven and bends them); music for one
  person and not another; a stinger; anything the rule hears back (which bar it is).

## A voice for what people say (`page/sound/voice.ts`; #264, a direction being tried)

Two ways, side by side, behind `?voices=babble` or `?voices=speech`; off by default; nobody has chosen.

- **Babble**, in the synthesiser. `babble(text, name)`: a syllable for each run of vowels (sixty at most), at a
  pitch that is the speaker's by their name (95 to 226 Hz), down three semitones through a statement, up five over
  the last third of a question, higher and harder when shouted. Each syllable is two patches: a tone, and a
  whisper (noise through the vowel's three formants, Peterson and Barney's averages as the old home had them, with
  the weight in the second formant for i and e and in the first for o and u). Measured: a question goes 96 to
  126 Hz, a statement 96 to 79; the vowels' weight lies at i 1,529, e 1,265, a 900, o 638, u 378 Hz; 5.3
  syllables a second; -23 LUFS beside the speaker. It is placed like any sound. It says no words.
- **Speech**, the browser's `SpeechSynthesis`: real words, a voice, pitch and rate chosen by the speaker's name,
  volume by distance. It cannot be routed through Web Audio, so it is not placed (it is in the middle of the head
  whichever side they stand), is not under the synthesiser's ceiling, and cannot be tapped or measured. **Not run
  by any check**: headless Chrome here has no voices (`getVoices()` is empty). On an iPhone it needs a gesture
  first, as sound does; not tried.
- What decides between them is ears and the TALK lane's replies (2 to 3.4 s each): babble can start the moment
  the words arrive and is cheap for a crowd; speech is understood without reading. A third way, a model that speaks
  (a speech model on the asker's machine), was not looked at.
- The owner once turned down "cartoons for 3-year-olds" as personas (memory): wordless babble may read that way.

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
- A hammer was first heard as an explosion too (the engine calls it a small blast): blasts under 8 cells are
  now blows only, and a check compares the two.
- The picture never waits for sound: `main.ts` starts it and goes on; a worklet that never loads leaves a silent
  page, not a black one.
- Nothing is occluded: a wall between does not dull a sound. No Doppler. The room is one small reverb for
  everywhere.
- Residents' steps, vehicles, doors and water that flows make no sound yet.
- A struck string has no double decay and at most twelve partials; plate, lump and cup mode ratios are our
  own choice, not measured.

Refresh when a phone has played it, when the core reports impacts, or when a check's numbers move.

## In a realm that is not home, and a patch from the guide (November 14)

- `test/inrealm.mjs` runs a rule's bell and its music in a made realm reached by stepping: neither is heard at
  home, both are there after the step, the place's own comes back on stepping home, and both return on stepping back.
- A real run (`make/rules.mjs`, Opus 5.5) asked for a glass harmonica and a kettle, which no kept sound fits. The
  model wrote patches of its own from the guide's short form (rubbed cup; blown hollow with air, rising each tick)
  and the world took them first ask. Kept in `~/.village/engine/sound/rules/glass-harmonica.js`. Not measured, not heard.
- A sound stays where it began and a held one cannot be changed while it lasts; the guide now says so. A motor on a
  moving thing is a short held sound made again each tick: it steps. A sound that follows its actor is not built.

## A sound that follows who makes it (November 14; `plugins/sound`, `as`)

- `world.sound` is an engine plugin now (`plugins/sound/`: world side, page side, guide, check); frame 10 is retired.
- With `as` a rule names a sound and puts it on an actor, a person or a living thing. It is plugin state (every one
  of them, each time one changes), so a page that joins later has them. The page places each every frame where it
  shows its maker (`presence.where`, the ear for oneself, `alive.where` for a living thing).
- A held one (pipe, horn, whistle, engine, a blown or rubbed patch) is one named tone on the world's bus, moved by
  `place` in the synthesiser (left, right, dullness, room, loudness against how it began; eased a fifth a block). A
  rule's new pitch or force is reached over a third of a second, because a rule speaks twice a second.
- A struck one is made again every `every` ms on the page, with a little unevenness.
- Named tones are not taken by other buses' notes. The page also begins one again if the audio thread no longer
  lists it (`told.named`, once a second). Only the six nearest are sounded.
- Not built: pitch bent by approach speed (velocity from shown positions is noisy; not tried), a held sound at a
  fixed place, occlusion. Measured in `test/follows.mjs` at the motor's own tone: the street's wind hides a wide band.
