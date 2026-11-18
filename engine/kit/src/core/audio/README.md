Cherry MX Brown, PBT keycaps, KeyJ press and release recordings by Mechvibes.
Source: https://github.com/hainguyents13/mechvibes/tree/16afce45bd7cf12be399e2d1a8d20f221067f534/soundpacks/keyboard/cherrymx-brown-pbt
Redistributed under the upstream MIT license (included in LICENSE).
Mono excerpts from sound.ogg around the KeyJ transients in config.json.
Press runs from 24.953 to 25.011 seconds and release from 25.084 to 25.140.
The leading silence is trimmed, with short edge fades and a quieter release.

Public API remains `sound(true)` / `sound(false)` / `sound()` and
`cue('press')` / `cue('release')`, exported from src/index.js.
Enable from a user gesture. Samples load once after consent; interactions before
readiness stay silent and are never replayed. Other cues retain their existing synthesis.
