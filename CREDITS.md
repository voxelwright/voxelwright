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
