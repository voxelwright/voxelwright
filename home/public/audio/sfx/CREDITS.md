# Sound-effect credits

Most of Village's sound effects are synthesized in code (`home/src/sound/palette/`). The recorded
variants (`b` of chose, card, sent, placed, page and news) play takes from these Freesound
originals. All are Creative Commons CC0 1.0 Universal (Public Domain Dedication),
https://creativecommons.org/publicdomain/zero/1.0/ ; credit is given anyway.

| File | Title | Author | Source | Takes used (s of the original) |
| --- | --- | --- | --- | --- |
| `wood-clicks.ogg` | Wooden clicks.wav | Anzbot (https://freesound.org/people/Anzbot/) | https://freesound.org/s/565027/ | 0.19-0.38, 0.57-0.76, 1.39-1.58, 1.81-2.00, 2.27-2.46, 2.71-2.90 |
| `kalimba-g5.ogg` | G4 soft - kalimba | hollandm (https://freesound.org/people/hollandm/) | https://freesound.org/s/691805/ | 0.00-0.75 (measured at G5, 785 Hz) |
| `music-box-g5.ogg` | Hand Crank Music Box [G5 Note] | moodyfingers (https://freesound.org/people/moodyfingers/) | https://freesound.org/s/732943/ | 0.12-1.30, lowered 28 cents to G5 at A = 440 |
| `tears.ogg` | Tearing paper - 5 | Valerie-Vivegnis (https://freesound.org/people/Valerie-Vivegnis/) | https://freesound.org/s/759322/ | 0.18-0.86, 1.44-1.94, 2.24-2.74, 3.56-4.20 |
| `paper-swish.ogg` | Waving Paper in the Air.wav | krnash (https://freesound.org/people/krnash/) | https://freesound.org/s/389809/ | 0.36-0.84, 1.06-1.44, 1.62-1.98 |
| `paper-slide.ogg` | Paper sheets (sliding).wav | Pipelenisf (https://freesound.org/people/Pipelenisf/) | https://freesound.org/s/560352/ | 0.22-0.74, 0.72-1.00, 1.40-1.85 |
| `cushion.ogg` | Cushion Impacts.wav | mincedbeats (https://freesound.org/people/mincedbeats/) | https://freesound.org/s/593948/ | 0.14-0.44, 1.38-1.68, 2.66-2.96, 3.72-4.02, 7.02-7.32 |
| `page-turn.ogg` | Page Turn | davidbain (https://freesound.org/people/davidbain/) | https://freesound.org/s/136778/ | 0.06-1.66 |

Changes made, by `home/scripts/make-sfx.mjs`: mixed to mono, resampled to 48 kHz, high-passed at
90 Hz and low-passed at 11 kHz, the listed takes cut out with a 4 ms fade-in and up to 60 ms
fade-out, each take matched in loudness (K-weighted RMS of its loudest 50 ms to -18 dBFS, peaks
under -1 dBFS), the takes of one sound laid end to end with 80 ms of silence as one sprite, and
encoded to Ogg Opus at 56 kb/s. The music-box note was also lowered 28 cents. The palette then
plays takes shorter, quieter, retuned and filtered (for example the music-box note as G and C).
