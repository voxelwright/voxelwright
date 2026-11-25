# Credits

Village's own pictures, and most of its sounds, are made in code. Third-party material used in the project:

## Music: "Groove Music" by benpm

- Title: Groove Music
- Author: benpm (https://freesound.org/people/benpm/)
- Source: https://freesound.org/s/203099/
- Licence: Creative Commons Attribution 4.0 International (Attribution 4.0, CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
- Where: `home/public/audio/groove-music.ogg`, played by `home/src/plugins/music.ts` with `?talk=npc`. The home shows the credit on hover of the music note.
- Changes: re-encoded from the original WAV to Ogg Opus (112 kb/s), played at a lower level and ducked under villagers' voices. Not trimmed or crossfaded. Details: `home/public/audio/CREDITS.md`.

## Sound effects: fourteen Freesound recordings (CC0)

Licence for all fourteen: Creative Commons CC0 1.0 Universal (Public Domain Dedication), https://creativecommons.org/publicdomain/zero/1.0/ . Where: `home/public/audio/sfx/`, played by the recorded variants in `home/src/sound/palette/index.ts`, which also exports them as `SAMPLE_CREDITS` for an in-app credit. Changes, for all: takes cut out with short fades, mixed to mono, filtered (90 Hz high-pass, 11 kHz low-pass), loudness-matched and encoded to Ogg Opus at 56 kb/s as one sprite per sound; played shorter, quieter, filtered or retuned. Details and the exact takes: `home/public/audio/sfx/CREDITS.md`.

- "Wooden clicks.wav" by Anzbot (https://freesound.org/people/Anzbot/), https://freesound.org/s/565027/ : six clicks, `wood-clicks.ogg`.
- "G4 soft - kalimba" by hollandm (https://freesound.org/people/hollandm/), https://freesound.org/s/691805/ : one note (it measures G5), `kalimba-g5.ogg`.
- "Hand Crank Music Box [G5 Note]" by moodyfingers (https://freesound.org/people/moodyfingers/), https://freesound.org/s/732943/ : one note, lowered 28 cents, `music-box-g5.ogg`.
- "Tearing paper - 5" by Valerie-Vivegnis (https://freesound.org/people/Valerie-Vivegnis/), https://freesound.org/s/759322/ : four tears, `tears.ogg`.
- "Waving Paper in the Air.wav" by krnash (https://freesound.org/people/krnash/), https://freesound.org/s/389809/ : three swishes, `paper-swish.ogg`.
- "Paper sheets (sliding).wav" by Pipelenisf (https://freesound.org/people/Pipelenisf/), https://freesound.org/s/560352/ : three slides, `paper-slide.ogg`.
- "Cushion Impacts.wav" by mincedbeats (https://freesound.org/people/mincedbeats/), https://freesound.org/s/593948/ : five impacts, `cushion.ogg`.
- "Page Turn" by davidbain (https://freesound.org/people/davidbain/), https://freesound.org/s/136778/ : one page turn, `page-turn.ogg`.
- "18-sentandose silla de madera.wav" by Tomycatts (https://freesound.org/people/Tomycatts/), https://freesound.org/s/429327/ : two takes of sitting on a wooden chair, played reversed as getting up, `chair-lift.ogg`.
- "01-32 Footsteps, Wood, Socks, Slow Pace.wav" by SpliceSound (https://freesound.org/people/SpliceSound/), https://freesound.org/s/369837/ : six sock steps on wood, `sock-steps.ogg`.
- "Bubble_4" by BenParamoreAudio (https://freesound.org/people/BenParamoreAudio/), https://freesound.org/s/868712/ : one bubble pop, in `bubble-pops.ogg`.
- "Bubble_Pop" by arttim (https://freesound.org/people/arttim/), https://freesound.org/s/733264/ : one bubble pop, in `bubble-pops.ogg`.
- "BubblePopping" by Sess8it (https://freesound.org/people/Sess8it/), https://freesound.org/s/762781/ : one bubble pop, in `bubble-pops.ogg`.
- "pop out, bubble, soft bursting" by chaferwitt (https://freesound.org/people/chaferwitt/), https://freesound.org/s/776443/ : one bubble pop, in `bubble-pops.ogg`.

## Ina Coolbrith Park landing

Frank Schulenburg photographed *View of San Francisco from Ina Coolbrith Park-01445.jpg* on July 15, 2021. The landing reconstructs that view in voxels using the photograph for camera alignment, building outlines, colours and lighting. [Original photograph on Wikimedia Commons](https://commons.wikimedia.org/wiki/File:View_of_San_Francisco_from_Ina_Coolbrith_Park-01445.jpg)

`site/static/landing/ina.faces.gz` contains the unpainted model’s coloured geometry. `site/static/landing/ina.webp` is a WebP capture rendered from that model. Both adaptations carry [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

## Weather: the National Weather Service (public domain)

- Source: the latest observation at San Francisco International Airport (station KSFO), from the National Weather Service's API, https://api.weather.gov/stations/KSFO/observations/latest
- Licence: a work of the United States government, in the public domain; the API asks for no key and for a User-Agent that names the caller (https://www.weather.gov/documentation/services-web-api).
- Where: `deploy/worker.mjs` answers `/weather` with it on zahynailo.dev, kept ten minutes; the SF realm's "SF now" sky reads it (`engine/page/modes.ts`, `engine/page/almanac.ts` `weatherOf`). The sky's title names the service.
- Changes: trimmed to the report's time, its weather codes, its cloud amounts and its visibility, and read as one of the realm's four weathers.

## Sun and moon: suncalc's formulas (BSD-2-Clause)

- Source: the low-precision formulas of Jean Meeus, *Astronomical Algorithms*, as suncalc by Vladimir Agafonkin has them, https://github.com/mourner/suncalc
- Licence: BSD 2-Clause, Copyright (c) 2014, Vladimir Agafonkin. The formulas are rewritten, not copied.
- Where: `engine/page/almanac.ts` (where the sun and moon stand over San Francisco, and how much of the moon is lit), and the sun in the head of every blog page (`site/generator/pages.mjs` `SF_NIGHT`).

## Fonts, samples and other assets

| Path | Material | Source | Licence | Full text beside file |
| --- | --- | --- | --- | --- |
| `engine/kit/fonts/atkinson-hyperlegible-mono` | atkinson-hyperlegible-mono | [Copyright 2020-2024 The Atkinson Hyperlegible Mono Project Authors](https://github.com/googlefonts/atkinson-hyperlegible-next-mono) | OFL-1.1 | Yes |
| `engine/kit/fonts/atkinson-hyperlegible-next` | atkinson-hyperlegible-next | [Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors](https://github.com/googlefonts/atkinson-hyperlegible-next) | OFL-1.1 | Yes |
| `engine/kit/fonts/b612` | b612 | [Copyright 2012 The B612 Project Authors](https://github.com/polarsys/b612) | OFL-1.1 | Yes |
| `engine/kit/fonts/barlow` | barlow | [Copyright 2017 The Barlow Project Authors](https://github.com/jpt/barlow) | OFL-1.1 | Yes |
| `engine/kit/fonts/chakra-petch` | chakra-petch | [Copyright 2018 The Chakra Petch Project Authors](https://github.com/m4rc1e/Chakra-Petch.git) | OFL-1.1 | Yes |
| `engine/kit/fonts/departure-mono` | departure-mono | [Copyright 2022–2024 Helena Zhang](https://helenazhang.com) | OFL-1.1 | Yes |
| `site/static/fonts/fraunces`<br>`site/static/support/fonts` | fraunces | [Copyright 2020 The Fraunces Project Authors](https://github.com/undercasetype/Fraunces) | OFL-1.1 | Yes (family-specific notices in support/fonts) |
| `engine/kit/fonts/geist-pixel` | geist-pixel | [Copyright 2026 The Geist Project Authors](https://github.com/vercel/geist-font) | OFL-1.1 | Yes |
| `engine/kit/fonts/ibm-plex-mono`<br>`site/static/vendor/village/kit/fonts/ibm-plex-mono` | ibm-plex-mono | [Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"](https://github.com/IBM/plex) | OFL-1.1 | Yes |
| `engine/kit/fonts/ibm-plex-sans`<br>`site/static/vendor/village/kit/fonts/ibm-plex-sans` | ibm-plex-sans | [Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"](https://github.com/IBM/plex) | OFL-1.1 | Yes |
| `engine/landing/site/fonts/literata` | literata | [Copyright 2017 The Literata Project Authors](https://github.com/googlefonts/literata) | OFL-1.1 | Yes |
| `engine/kit/fonts/overpass`<br>`engine/landing/site/fonts/overpass`<br>`site/static/fonts/overpass` | overpass | [Copyright 2021 The Overpass Project Authors](https://github.com/RedHatOfficial/Overpass) | OFL-1.1 | Yes |
| `engine/kit/fonts/overpass-mono`<br>`site/static/fonts/overpass-mono`<br>`site/static/support/fonts` | overpass-mono | [Copyright 2021 The Overpass Project Authors](https://github.com/RedHatOfficial/Overpass) | OFL-1.1 | Yes (family-specific notices in support/fonts) |
| `site/static/fonts/source-serif-4` | source-serif-4 | [Copyright 2014 The Source Serif 4 Project Authors](https://github.com/adobe-fonts/source-serif) | OFL-1.1 | Yes |
| `engine/kit/fonts/vox-*`, `engine/kit/src/core/fonts`, vendored kit fonts and CSS | Vox typefaces and embedded Block and Sign | Pavlo Zahynailo | OFL-1.1 with reserved names | Yes, also distributed with embedded fonts |
| `engine/kit/src/core/audio`, `site/static/vendor/village/kit/shared/audio` | Press and release excerpts | [Mechvibes, Hải Nguyễn](https://github.com/hainguyents13/mechvibes/tree/16afce45bd7cf12be399e2d1a8d20f221067f534/soundpacks/keyboard/cherrymx-brown-pbt) | MIT | Yes, LICENSE in both |
| `home/public/audio/groove-music.ogg` | Groove Music | [benpm, Freesound](https://freesound.org/s/203099/) | CC BY 4.0 | Adjacent credit and licence link |
| `home/public/audio/sfx/*.ogg` | 14 recordings in 11 sprites | Freesound, individual credits and links above | CC0 1.0 | Adjacent credits and licence link |
| `site/static/landing/ina.webp`, `ina.faces.gz` | Landing render and geometry | Frank Schulenburg, Wikimedia Commons (above) | CC BY-SA 4.0 | Link in root credits |
| `engine/page/almanac.ts`, `site/generator/pages.mjs` | Rewritten astronomical formulas | Vladimir Agafonkin, SunCalc (above) | BSD-2-Clause | Full text in root NOTICE |
| `deploy/worker.mjs` | Weather observations at runtime | US National Weather Service | US public domain | Source linked above |
| `engine/bay`, local bake outputs | Layer inventory including unresolved source terms | [Dataset and credit per layer](DATA-LICENSES.md) | Per source | Guide links, no bundled source licences |
| Engine and vendored showcase desk materials | Walnut grain and contour lines | [Original NumPy/Pillow drawing](engine/kit/tools/draw-desk-materials.py), recovered from the session for commit 0125290. It reproduces both files byte for byte. | Apache-2.0 | Root licence |
| `engine/test/drawn/*.png` | Racer and hydrant orthographic views | [Fixture drawing code](engine/test/drawn/make-sheets.py) | Apache-2.0 | Root licence |
| `engine/ears/ranges.json` and `damage.json` | Counts, range endpoints, medians, damage response and false-alarm statistics | Numeric measurements. The source recordings are credited below. Neither JSON file contains samples or excerpts. | Project measurements | Root licence |
| `engine/core/src/heroes.rs` | Salesforce Tower footprint dimensions and taper measured from a photograph | Overture, and Pi.1415926535, *San Francisco skyline from Potrero Hill, February 2020* (Wikimedia Commons) | Source map ODbL, source photo [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | Credit in source header, no full text |
| `engine/landing/ina/{outlines,pins,camera,light}.json`, `site/static/landing/place.json`, `engine/sf/pilot/releases/*/manifest.json` | Tracings, placement, lighting and baked-scene metadata | Frank Schulenburg and the geodata providers credited per manifest | Photograph CC BY-SA 4.0, other layers per DATA-LICENSES.md | Source notes and manifest credits |

Dependencies are fetched by their respective package managers. Their lockfiles identify versions and do not bundle the dependency licence texts. Notable npm terms include MPL-2.0 (lightningcss, node-datachannel and their platform packages), LGPL-3.0-or-later (@img/sharp-libvips-* and combined licences on @img/sharp-win32-* and @img/sharp-wasm32), and Anthropic’s vendor agreements (@anthropic-ai/claude-agent-sdk and its eight platform packages). node-forge offers BSD-3-Clause or GPL-2.0. The Rust crate r-efi offers MIT, Apache-2.0 or LGPL-2.1-or-later. The Python tool dependencies include certifi (MPL-2.0) and soxr (LGPL-2.1-or-later).

## Sound judge reference library

The private listener calibration used MusicEval by Liu et al. (ICASSP 2025). The dataset card specifies “License: cc-by-nc-4.0”. The public judge uses acoustic ranges and hard faults. Listener weights, correlation results and the fitted measure selection live in the optional private overlay. [MusicEval dataset card](https://huggingface.co/datasets/BAAI/MusicEval)

The reference library contains 126 recordings. The following CC BY and CC BY-SA works were measured for range and degradation tests. Recordings stay with the local library. Titles, creators and source pages come from its acquisition manifest.

- [Breaking Bottle](https://opengameart.org/content/breaking-bottle) by spookymodem, [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- [Applause](https://opengameart.org/content/applause) by leezh, [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- [Rain and Thunder Loop](https://opengameart.org/content/rain-and-thunder-loop) by dokashiteru, [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- [Ambient Mountain, River, Wind and Forest and Waterfall](https://opengameart.org/content/ambient-mountain-river-wind-and-forest-and-waterfall) by lamoot, [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- [ocarina remembrance](https://opengameart.org/content/ocarina-remembrance) by mikeeusa, [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
- [Frozen Star](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Colorless Aura](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Dreamy Flashback](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Mesmerize](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Lightless Dawn](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Ossuary 1 - A Beginning](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Funkorama](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Local Forecast - Elevator](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Reformat](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Tech Live](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Gymnopedie No 1](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Impromptu in Quarter Comma Meantone](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Ossuary 6 - Air](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Bossa Antigua](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Volatile Reaction](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Heroic Age](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Hitman](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Cephalopod](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Aggressor](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Newer Wave](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Digital Lemonade](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Mega Hyper Ultrastorm](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [8bit Dungeon Level](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Pixelland](https://incompetech.com/music/royalty-free/music.html) by Kevin MacLeod, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Former drawn fixtures

The drawer used Google Nano Banana 2 via `fal-ai/nano-banana-2`. The model page states “Commercial use enabled through fal.ai”. Google says “Google won't claim ownership over that content.” fal expressly assigns the customer ownership of *input* in §6(b) and disclaims assurances of output rights in §4(c). I found no express grant covering unrestricted downstream redistribution of the sheets, so the public fixtures are project drawings. [Model](https://fal.ai/models/fal-ai/nano-banana-2) · [Google generated-content terms](https://ai.google.dev/gemini-api/terms#use-generated) · [fal terms](https://fal.ai/legal/terms-of-service)

## Personal post attachments

The owner reserves rights in his personal posts. Both examples entered Village in the site import. The draft posts describe their origins. Publication of these attachments is the owner's decision.

| Post | Attachment | Origin evidenced in the post or file |
| --- | --- | --- |
| kitchen-sink | diagram.svg | Placeholder drawing of hills and sun for the image example |
| kitchen-sink | scene-poster.svg | Blue placeholder still for the engine embed |
| kitchen-sink | compare-poster.svg | Purple placeholder still for the comparison embed |
| kitchen-sink | scene.json | Placeholder flag and a note for a future scene |
| kitchen-sink | before.glb | Empty glTF container whose generator is “placeholder” |
| kitchen-sink | after.glb | Empty glTF container whose generator is “placeholder” |
| ai-sessions-as-blocks | founding.session.json | Four prompts from the site's founding Claude Code session, trimmed and redacted per the post |
| ai-sessions-as-blocks | decision-sample.session.json | Handwritten synthetic example of a structured decision per the post |
