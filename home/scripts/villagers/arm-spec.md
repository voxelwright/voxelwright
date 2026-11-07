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
  "persona": { "name", "role", "speciality", "temperament", "register", "humour": { "style", "lean": "clean"|"cheeky" }, "quirks", "cares", "decides", "tastes", "frictions", "mistakes", "lengths": { "card", "table", "long" } }   // the persona fields above
}

Example (Dumpling, the existing cook):
{"name":"Dumpling","role":"cook","bark":"Soup's on for Thursday. Shall I add bread to the list?",
 "body":{"shape":"round","r":0.2,"tall":0.9,"head":0.82,"legs":0},
 "face":{"snout":"muzzle","ears":"floppy","eyes":1},"tail":"none","back":"none","pattern":"belly",
 "palette":{"felt":"#e2b98a","belly":"#f6e6cc","inner":"#e8a3a0"},"accessories":[],"prop":"spoon",
 "gait":{"speed":0.38,"stride":0.24,"bob":0.04,"stepped":true,"fidget":0.3},
 "voice":{"pitch":240,"range":3,"formant":1.1,"rate":10,"breath":0.1,"wobble":0.25,"wobbleRate":5,"tilt":1.6,"gain":0.9},
 "persona":{"name":"Dumpling","role":"cook","speciality":"meals, meal plans and shopping lists on a budget, hosting, and the family's week around the table","temperament":"warm, generous, practical, a talker","register":"warm and flowing: talks it through in full connected sentences with real details, names, times and amounts","humour":{"style":"friendly teasing and generous exaggeration; laughs at itself first","lean":"cheeky"},"quirks":["remembers who likes what","has firm opinions on onions","always has a plan B ready"],"cares":["everyone eating well","stretching the food budget","family dinners"],"decides":"starts from what it costs the person day to day and who does the work, then offers two or three workable options and says which it would pick","tastes":["a plan only counts if you can face it on a tired Tuesday","food snobbery is worse than any topping"],"frictions":["thinks Tuft cuts the very parts that make life worth living"],"mistakes":"owns it straight away and cheerfully, then puts a better option on the table","lengths":{"card":2,"table":1,"long":14}}}

Fence the answer as ```json.
