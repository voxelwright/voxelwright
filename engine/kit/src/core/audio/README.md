# Key recordings

`press.wav` and `release.wav` are the two strokes of a key: a Cherry MX Brown switch under a PBT
cap, the KeyJ press and release from the Mechvibes `cherrymx-brown-pbt` sound pack
([source](https://github.com/hainguyents13/mechvibes/tree/16afce45bd7cf12be399e2d1a8d20f221067f534/soundpacks/keyboard/cherrymx-brown-pbt)),
redistributed under its MIT license (`LICENSE`).

They are mono excerpts of the pack's sound file, cut around the KeyJ transients its config names:
press from 24.953 to 25.011 seconds, release from 25.084 to 25.140. The leading silence is
trimmed, the edges have short fades, and the release is quieter.

`../sound.js` plays them. Sound is off until the page calls `sound(true)` from a user gesture;
`cue('press')` and `cue('release')` then play these files, each stroke with its own small change
of pitch and level, and voiced through a high shelf for the enclosure. A press or release before
the files have loaded plays a short synthesized knock instead and is never replayed later. Every other cue
is synthesized. The rules for sound are in `../../../SPEC.md`, section 8.
