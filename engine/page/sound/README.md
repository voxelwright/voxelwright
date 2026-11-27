# page/sound: the sound engine

Every sound the engine plays is synthesised here as it plays, from patches: small JSON objects that describe what is struck, plucked, blown or rubbed. No recording is used. `dsp.ts` is the synthesiser and runs on the audio thread as an AudioWorklet; everything else runs on the page's main thread and decides what to play, where and how loud.

The concepts, the patch form, the signal chain and how sound is judged are in [guide/sound.md](../../../guide/sound.md). The sources and measurements behind it are in the [game-sound skill](../../../.agents/skills/game-sound/SKILL.md).

**Two rules hold in every file here.** A patch is data and is never run: `patch()` in `patch.ts` is its only reader and refuses anything outside the form. Loudness is capped inside `dsp.ts`, after everything, so no patch or level can exceed `CEILING`.

## Files

| File | What it does |
| --- | --- |
| `patch.ts` | the patch form: `patch()` checks one, `sounds()` checks a thing's set of sounds, `compile()` turns a checked patch into numbers for the synthesiser |
| `dsp.ts` | the synthesiser (`Synth`): voice pools, beds, the room, the buses and the ceiling. No runtime imports, so the same file is the page's worklet (`village-voice`) and what the checks render in Node |
| `sound.ts` | `sound()`: the audio context, the unlock on the first gesture, `play()`, `hold()`, and `hear()`, which turns a place into loudness, side, dullness and delay |
| `world.ts` | `hearing()`: turns what the page knows (tools, blasts, the solver's report, weather, steps, the driven vehicle, rules' sounds) into plays and bed levels each frame, and picks the place's music |
| `radio.ts` | the car radio's stations, ducking and station memory, and the pass-by whooshes heard driving fast |
| `kinds.ts` | the world's own patches: `HIT` and `BREAK` for each of the core's materials, `WORLD` for steps, blasts, tools, vehicle foley, and damped body/car impacts (`bodyBump`, `carBump`, `carCrunch`) |
| `likes.ts` | `LIKES`: the small kept set of sounds a rule can ask for by a word (`bell`, `drum`, `horn` and others) |
| `things.ts` | `played()`: a made thing's own `hit` and `break`, and taking up a thing with a surface to play it |
| `surface.ts` | an instrument's surface form and `surface()`, its only reader |
| `instrument.ts` | `playable()`: draws a surface as SVG and plays it by keys, mouse and touch |
| `instruments.ts` | the three kept instruments: guitar, ocarina and piano |
| `voice.ts` | a voice for what people say, being tried: `babble` in the synthesiser or the browser's `speech` |
| `brief.ts` | what a model is told so that it can write a thing's sounds, and how its reply is read |
| `tap.ts` | a worklet that passes sound through and posts what passed, for checks and recordings |
| `lab.html`, `lab.ts` | the listening lab: every sound played by hand, with a scope, the audio thread's cost, and a box for a patch of your own |
| `music/rules.ts` | the named rules a pattern of music is scored by |
| `music/compose.ts` | the moods (`MOODS`, and the radio's `RADIO_MOODS`), modes and the search that composes a section |
| `music/worker.ts` | composes sections off the main thread |
| `music/conductor.ts` | plays sections on the audio clock, a layer at a time, and hands over between places at a bar line |
| `music/perform.ts` | turns a section into timed notes, for the conductor and the checks alike |
| `kept/` | seven model-written sounds kept as data (kalimba, theremin, steel drum, church bell, wind chime, vase, rubber duck); the checks read them and run no model |

## Listen

The engine's server strips the TypeScript types and serves this folder as it is on disk, so there is nothing to build for the lab:

```sh
cd ../..
npm run serve
```

Open `http://127.0.0.1:5740/page/sound/lab.html` and tap anywhere to start sound.

In the game page, `?sound=0` turns sound off, `?music=1` turns the place's music on, `?radio=` picks the car radio's first station (`0`, `1` or a station's id), and `?voices=babble` or `?voices=speech` gives a voice to what people say in a shared world.

To ask a model for a thing's sounds, or to stand a kept instrument in a shared world:

```sh
cd ../..
node voice.mjs "a kalimba" --out kalimba.json
node instrument.mjs piano --world http://127.0.0.1:5764
```

## Check

```sh
cd ../..
node test/sound.mjs     # the synthesiser in Node: materials, force, size, tuning, the form, the ceiling, cost
node test/music.mjs     # the rules, the search and the handover between places
node test/judged.mjs    # the sound judge (needs uv; see ../../ears/README.md)
node test/heard.mjs     # the real page in Chrome, its sound tapped and measured
node test/played.mjs    # the instruments in the lab, with real keys and touches
node test/radio.mjs     # the radio's stations and whooshes in Node, then driving in Chrome (--node-only)
```

`npm run check` in `engine/` runs all of these. A rule's sounds are checked by `node test/sounded.mjs` and `node plugins/sound/check.mjs`. No check can say whether a sound is good to hear: use the lab.
