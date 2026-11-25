---
name: sound-judge
description: How Village judges and improves the engine's sound with nobody listening (#410). The benchmark clips, the measures and which were kept or dropped and why, the proof (damage, references, human ratings), the check that fails when sound gets worse, the climb loop, the Python tools it stands on, and what the field says about good game sound and music. Load before changing engine/page/sound/, engine/ears/ or the sound checks, or before claiming anything about how the engine sounds.
---

# Judging sound without ears

Version 1, November 14, 2026 (issue #410). Scope: `engine/ears/`, `engine/test/judged.mjs`, and any change to
`engine/page/sound/`. How the synthesiser itself works is `game-sound`. Nobody who wrote this has heard the engine:
every claim here is a measurement, and the limits section says what the measurements cannot see.

The public gate scores every applicable acoustic measure against the reference range and checks clipping, DC offset and buried events. It has no predicted listener rating or listener-calibrated selection. The November 14 scores below used the private calibration.

For a private comparison, run `uv run python score.py clips <measured-folder> --musiceval` from `engine/ears`. It reads `people-model.json`, `kept.json` and the corresponding `ranges.json` under `~/.village/engine/ears/musiceval/`. That directory also holds `people-musiceval.json` and the former benchmark. The public regression test always uses its shipped acoustic baseline.

## The loop (the sound's `ui-craft`)

1. `node ears/bench.mjs --out <dir>` renders 54 fixed clips (steps, blows, breaks, blasts, beds, instruments, each
   place's music from two seeds, a handover, three mixes with stems) through `page/sound/dsp.ts` in Node. That file is
   the page's worklet and the page connects it straight to the output, so this is what is played. `--held 1` renders
   the same from other seeds: never tune on those.
2. `cd ears && uv run python judge.py measure <dir>` then `uv run python score.py clips <dir> --json <dir>/score.json`
   prints each clip's score and its faults in words an ear would use ("thin: no low end", "hissy: reads as white noise").
3. Change the engine for the worst fault. Re-render, `uv run python compare.py <before> <after>`. Keep what scores
   better with no clip worse. Look at pictures when a number surprises: `uv run python look.py a.wav b.wav --out x.png`.
4. `node test/judged.mjs` is the gate (in `test/all.mjs`): it fails on a hard fault, on a measure newly outside the
   range of well-made sound, on a clip 1.5 under its accepted score, or a mean half a point down. Accept an intended
   change with `--accept` (rewrites `ears/baseline.json`) and say in the PR what moved.

## Historical private calibration (rules fixed before numbers were read; `validate.py`, `keep.py`)

- Hard fault: kept if its own damage trips it on >= 90% of damaged references and <= 5% of clean ones.
- Timbre or music: kept if its damage moves it >= a quarter of its reference range on >= 70% of clips, or it agrees
  with people (Spearman |rho| >= 0.2, p < 0.01, on a public rated set). Moved the right way but less: advisory
  (printed with a dot, costs nothing).
- A measure that only tells the engine from the references is a detector of source and is dropped.
- A group with no references of its own kind is not judged by range (held tones; whole mixes).

The optional overlay holds the selection, advisory list and measured correlations behind this experiment. The public judge applies the ranges for each clip's kind.

## The proof, as numbers (November 14, 2026)

| Test | Result |
| --- | --- |
| Today's engine (before) | mean 91.8, 15 of 54 clips with nothing out (5 of them unjudged tones) |
| References (126 files) | mean 95.6; 46 wholly inside (ranges are 5th to 95th percentile) |
| Damage, 19 kinds on 50 references | see `damage.json`; kept measures 67 to 100% on the kinds they are kept for |
| Engine after the first climb | mean 99.1, 39 of 54 with nothing out, no hard fault, none worse |
| Held-out seeds (`--held 1`, never tuned on) | mean 99.1, 37 of 54 with nothing out, no hard fault: the climb did not fit the benchmark's seeds |
| Audiobox Aesthetics, before to after (never climbed on) | music enjoyment 6.40 to 6.64 (references 7.31), up on 10 of 16 music clips; instruments 5.21 to 5.87; production quality flat (7.99 to 7.95) |
| Blind judges on pictures, 20 clips before against after | GPT-6.1 Sol picked after on 16 (and the clean side of 6 of 6 damaged references); Sonnet 5.5 on 18 (4 of 6). Not every clip; many reasons given were level |
| The gate under mutation | music level 0.95 to 0.3: fails; rain back to white hiss: fails; DC blocker removed: passes (no clip has DC now) |

## What was wrong with the engine, found by looking (pictures beside references)

- Everything far too quiet: music -30 LUFS, a walk through town -29, steps -41. Fixed at the music's level and with
  a compressor on the music bus (instant attack, 80 ms release: a slow attack let each blow through and raised crest).
- No low end: pads sat at 300 to 600 Hz as a bright static band, bass notes were rare, calm places had no bass at all.
  Pads went down an octave and back, bass up and more often, a soft low beat (`heart`) under calm places.
- A step was a 30 ms click of every frequency. Now a low body with a short scuff. Still under references on
  peak-to-loudness (18 against 20 to 26).
- Rain was flat white hiss; recorded rain falls away toward the top. Hiss cut, wash up, drops heavier and lower.
- Ringing things (steel, glass, a bell) had no weight: a short low thump now sits under anything that rings longer
  than 0.2 s, in the world only.
- A DC blocker (20 Hz) before the ceiling: a one-sided blow no longer eats headroom.

## Facts paid for

- Reference effects are assets at full scale: an effect's own LUFS says nothing. Judge level in mixes.
- Audiobox Aesthetics "production quality" rates the bare engine 7.99 and the references 7.88. A clean synthesiser
  is "well produced" to it. It cannot be the judge alone; its enjoyment axis did separate (6.40 v 7.31).
- The fit to human ratings scores rule-composed grooves as high as references. It sees structure (pulse, return,
  key), not melody or timbre taste. A high `people` is not proof that a tune is good.
- MusicEval is 16 kHz mono: nothing above 8 kHz or about stereo is validated against people. No public set rates game
  or procedural effects: effect measures rest on damage only.
- Zenodo refused this network (403) on November 14: the PAM listening set and ODAQ are untested. Try again.
- `silent_share` and the trim must use the same threshold or a slow fade-in reads as a hole.
- A measure's cost is its excess over the range in range-widths, so a wide range hides a real fault in the score.
  The gate therefore fails on any newly out measure, not only on score.
- torchaudio 2.15 cannot load files without torchcodec: read with soundfile and pass tensors.

## Tools adopted (grounding)

| Tool | Version | Used for | Notes |
| --- | --- | --- | --- |
| uv | on this Mac | the environment: `cd engine/ears && uv sync` (Python 3.12, `uv.lock`) | the gate fails, not skips, without it |
| librosa | 0.11 line (`uv.lock`) | STFT, chroma, onsets, resampling (soxr) | chroma_cqt at 22.05 kHz |
| pyloudnorm | `uv.lock` | BS.1770 loudness, its K-weighting filters reused for 3 s loudness | pads clips under 1 s |
| soundfile, scipy, numpy, matplotlib | `uv.lock` | reading wav/ogg/mp3/aiff, filters, pictures | |
| audiobox_aesthetics 0.0.4 + torch | outside the repo (`~/.village/engine/ears/learned`, 1.3 GB) | a second opinion, never the gate | CC-BY 4.0; 16 kHz mono inside; MPS works |

Reference audio (`~/.village/engine/ears/refs`, `SOURCES.tsv` lists source and licence of each; CC0, CC-BY, a few
CC-BY-SA) and rated data stay outside the repo. The public tree carries acoustic ranges and the damage study. Rebuild ranges with `score.py ranges <refs>` after re-measuring; refit with `people.py fit`.

## What the field says

`literature.md` beside this file: loudness (BS.1770, R128, ASWG), spectral balance, psychoacoustics (Sethares'
constants, sharpness, masking), checkable music theory, timbre, film and game practice (Murch, Farnell, Wwise/FMOD),
and automatic quality assessment, each item marked fetched, snippet or memory. About half was fetched. Treat the
rest as principle until a measurement here supports it.

## Limits

- The score after the climb (99.1) is above the references' (95.6). That means the judge has run out of things it
  can see, not that the engine is better than they are.
- The judge changed four times after the climb began, each for a stated reason: the people-fit applies to music only
  (it was fitted to music); the silence measure ignores a second at each end (it read a fade-in as a hole); mixes are
  judged on level, `heard` and hard faults only (no recording of a game's whole mix was gathered); `air` was added
  (it had passed the damage rule and was left out by oversight, and without it the gate missed white rain).

- Nobody has listened. The owner's first verdict ("terrible") is one label; whether the climbed sound is good to him
  is unknown. Taste choices are on the page `~/.village/engine/ears/taste/index.html`; write his answers here.
- The public baseline records each clip's accepted score and out-of-range measures. Composition also has rule checks in `test/music.mjs`.
- No iPhone or speaker has played it; the page path was not tapped again after the change (same worklet file).
