Write a JSON villager spec. Trusted code builds it; you cannot run code. Every number is clamped to its range and any value outside an enum is replaced, so stay inside them. Schema:

{
  "name": string, one or two words,
  "role": "cook"|"gardener"|"tidier"|"keeper"|"tutor"|"messenger"|"maker"|"carer",
  "bark": string, one short line,
  "body": {
    "shape": "pear"|"egg"|"bean"|"round"|"tall",   // pear: bottom-heavy; egg: wider low; bean: belly forward; tall: a soft column
    "r": 0.11..0.24,      // body radius (Dumpling 0.2, Moss 0.17, Tuft 0.14)
    "tall": 0.7..1.8,     // body height factor (Dumpling 0.9, Moss 1.1, Tuft 1.5)
    "head": 0.6..1.1,     // head radius relative to body radius (all three: 0.82)
    "legs": 0..0.12       // visible leg length; 0 keeps the feet under the body
  },
  "face": { "snout": "none"|"button"|"muzzle"|"beak"|"long", "ears": "none"|"floppy"|"round"|"pointed"|"tuft"|"long"|"antlers", "eyes": 0.6..1.4 },
  "tail": "none"|"stub"|"curl"|"long"|"fluffy",
  "back": "none"|"shell"|"wings"|"quilt",          // shell: a stitched tortoise shell; wings: folded wings; quilt: a quilted cape
  "pattern": "plain"|"belly"|"spots"|"stripes"|"patches",
  "palette": { "felt": "#rrggbb", "belly": "#rrggbb", "inner": "#rrggbb", "pattern": "#rrggbb" },   // inner: inner ears, beak, antlers, bow; pattern (optional): spots, stripes, shell, wings, hat
  "accessories": [ up to 3 of "glasses"|"hat"|"beret"|"bow"|"apron"|"satchel"|"headphones"|"flower"|"leaf" ],
  "prop": "spoon"|"duster"|"can"|"letter"|"pouch"|"book"|"calendar"|"pencil"|"basket"|"mug"|"wrench"|"none",
  "gait": { "speed": 0.2..0.6, "stride": 0.14..0.34, "bob": 0..0.08, "stepped": true, "fidget": 0..1 },   // speed m/s, stride per two steps, fidget: 0 calm to 1 restless
  "voice": { "pitch": 90..560, "range": 0.5..7, "formant": 0.75..1.6, "rate": 4..16, "breath": 0..0.6, "wobble": 0..1.2, "wobbleRate": 3..9, "tilt": 0.8..2.6, "gain": 0.6..1.2 }
    // pitch Hz; range semitones per word; formant 0.75 big and dark to 1.6 tiny and bright; rate syllables a second;
    // breath noise; wobble vibrato semitones at wobbleRate Hz; tilt 0.8 buzzy to 2.6 round and dark; gain level
  "persona": { "role": string ≤40, "speciality": string ≤60, "temperament": "dry"|"upbeat"|"calm"|"blunt"|"warm"|"wry",
    "register": "plain"|"formal"|"casual", "humour": "none"|"dry"|"deadpan"|"wordplay"|"gentle",
    "quirks": [ up to 3 strings ≤60 ], "topics": [ up to 5 strings ≤40 ], "dials": { "warmth": 0..1, "playful": 0..1, "chatty": 0..1, "humour": "clean"|"cheeky" } }
}

Example (Dumpling, the existing cook):
{"name":"Dumpling","role":"cook","bark":"Soup's on for Thursday. Shall I add bread to the list?",
 "body":{"shape":"round","r":0.2,"tall":0.9,"head":0.82,"legs":0},
 "face":{"snout":"muzzle","ears":"floppy","eyes":1},"tail":"none","back":"none","pattern":"belly",
 "palette":{"felt":"#e2b98a","belly":"#f6e6cc","inner":"#e8a3a0"},"accessories":[],"prop":"spoon",
 "gait":{"speed":0.38,"stride":0.24,"bob":0.04,"stepped":true,"fidget":0.3},
 "voice":{"pitch":240,"range":3,"formant":1.1,"rate":10,"breath":0.1,"wobble":0.25,"wobbleRate":5,"tilt":1.6,"gain":0.9},
 "persona":{"role":"Runs the kitchen and the weekly menu","speciality":"Cooking for a week from one big shop","temperament":"warm","register":"plain","humour":"gentle",
  "quirks":["Plans meals around what is about to go off"],"topics":["the week's menu","what is in season"],"dials":{"warmth":0.8,"playful":0.3,"chatty":0.5,"humour":"clean"}}}

Fence the answer as ```json.
