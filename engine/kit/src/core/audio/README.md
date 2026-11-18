Cherry MX Brown, PBT keycaps, KeyA press and release recordings by Mechvibes.
Source: https://github.com/hainguyents13/mechvibes/tree/main/soundpacks/keyboard/cherrymx-brown-pbt
Redistributed under the upstream MIT license (included in LICENSE).
Extracted mono WAV from sound.ogg using config.json KeyA timing:
press 22.869–22.968 seconds; release 22.968–23.067 seconds.

Public API remains `sound(true)` / `sound(false)` / `sound()` and
`cue('press')` / `cue('release')`, exported from src/index.js.
Enable from a user gesture. Samples load once after consent; interactions before
readiness stay silent and are never replayed. Other cues retain their existing synthesis.
