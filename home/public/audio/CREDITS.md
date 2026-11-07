# Audio credits

## Groove Music

- Title: Groove Music
- Author: benpm (https://freesound.org/people/benpm/)
- Source: https://freesound.org/s/203099/
- Licence: Creative Commons Attribution 4.0 International (Attribution 4.0, CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
- Used for: the quiet music loop in the home (`groove-music.ogg`, played by `home/src/plugins/music.ts` with `?talk=npc`).

Changes made: the original 24-bit, 48 kHz stereo WAV (21.33 s, eight bars at 90 BPM) was re-encoded to Ogg Opus at 112 kb/s with
`ffmpeg -i 203099__benpm__groove-music.wav -map_metadata -1 -c:a libopus -b:a 112k -vbr on -compression_level 10 -application audio groove-music.ogg`.
The music is not trimmed, cut or crossfaded: the file is exactly eight bars, so it loops as it is. It is played about 11.7 dB
quieter than the file (a gain of 0.26) and lowered a further 6 dB while a villager speaks.

The credit also shows in the home on hover or focus of the music note beside the speaker button.
