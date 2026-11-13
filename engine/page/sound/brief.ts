// What a model is told so that it can write a thing's sounds (#247): the two forms (patch.ts, surface.ts) in words a
// model can follow in one reply, with the physics it needs to choose numbers that are true to the thing. The reply
// is data and is read by `sounds()`; one that is refused is sent back with the reason (`again`).
//
// It is written to be put beside the maker's own brief (make/brief.mjs), so that a made thing comes with its
// sounds in the same reply. Until the making lane does that, `voice.mjs` asks for the sounds alone.

export const SOUND_BRIEF = `You give things their sound. Someone names a thing; you reply with how it sounds, as JSON and nothing else: no words before or after, no code fence.

Nothing is recorded. A synthesiser plays what you describe, so describe the thing physically: what is struck, plucked, blown or rubbed, how hard the two things that meet are, what shape rings and how long.

THE REPLY
{ "sounds": { "hit": patch, "break": patch, "step": patch, "use": patch, "hum": patch, "play": patch, "surface": surface } }
Give only the sounds the thing has. "hit": it is struck or something lands on it. "break": it comes apart. "step": it is walked on. "use": what it does when used (a duck squeaks, a bell is rung). "hum": a sound it makes all the while. "play" with "surface": it is an instrument, and the surface is how it is played.

A PATCH
{ "how": "struck" | "plucked" | "blown" | "rubbed",
  "hard": 0 to 1,     how hard the two things that meet are: felt 0.1, a fingertip 0.3, wood 0.5, a fingernail 0.7, steel on steel 1. Harder is a shorter touch and a brighter sound. For blown or rubbed: how suddenly it speaks.
  "rough": 0 to 1,    grit in the touch, breath in a blown tone
  "shape": one of "bar" (a free bar: marimba, tine, chime), "plate" (a sheet: pane, gong, lid), "bell", "skin" (a drum head), "string", "tube" (open pipe: all harmonics), "pipe" (stopped pipe: odd harmonics), "hollow" (a vessel with a hole: ocarina, bottle; nearly a pure tone), "lump" (a compact solid: brick, stone), "cup" (a glazed vessel: mug, vase)
     or, in place of "shape", your own "modes": up to 12 of [ratio to the lowest (1 to 40), loudness 0 to 1]
  "pitch": 20 to 8000,   Hz of its lowest mode at its own size
  "ring": 0.01 to 12,    seconds until that mode has died away. Brick 0.06, wood 0.15, glass 0.5, a steel plate 1.5, a bell 5. For blown or rubbed: how long it takes to stop.
  "damp": 0 to 1,        how much sooner the high modes die than the low: metal 0.1, glass 0.3, wood 0.6 to 0.8, earth 0.9
  "where": 0 to 0.5,     optional: where along it it is struck or plucked (0.5 is the middle, which silences the even modes)
  "bend": -2 to 2,       optional, octaves: it starts that far off its pitch and settles in a twentieth of a second (a drum skin +0.5 to +1.5, a drop of water -0.5)
  "waver": 0 to 1,       optional: how much a held tone trembles
  "pieces": { "count": 1 to 40, "over": 0.02 to 4 seconds, "spread": 0 to 1 },   optional: after the blow, that many small ones of the same stuff, each up to 1 + 3 x spread times higher (glass breaking: 30 over 0.7, spread 0.9; a rattle; gravel)
  "air": { "from": 40 to 12000, "to": 40 to 12000, "for": 0.01 to 6, "gain": 0 to 1, "q": 0.3 to 12 },   optional: a rush of noise that sweeps from one pitch to another (a crash, a whoosh, a puff, a squeak's breath)
  "gain": 0 to 1 }
"hard", "rough", "pitch", "ring", "damp", "gain" and one of "shape" or "modes" are always given. No other key exists.

A SURFACE (only with "play")
{ "size": [wide, high],       2 to 64 each, the surface's own units; make it about as wide as the instrument looks
  "release": "rings" | "stops",   optional: "stops" if letting go of a key damps the note (a piano). Blown and rubbed tones always stop when let go.
  "parts": [ up to 80 parts ] }
A part is a shape on the surface. Parts are drawn in order, later over earlier. A part that does nothing is drawing: use a few to give the instrument its look.
{ "shape": "rect" or "round" with "at": [x, y, wide, high] (round is the oval that box holds), or "poly" with "points": [[x, y], ...] (3 to 16). y grows downward. Everything lies inside the surface.
  "colour": one of wood pale dark ivory ebony brass steel clay red blue green gold sky night white grey
  "label": up to 6 characters of letters, digits, # ' + - and space
  "key": one of KeyA to KeyZ, Digit0 to Digit9, Space    a key of the keyboard that plays this part. Give every sounding part its own key, laid out as the hands would find them.
  and at most one of:
  "note": 12 to 120            MIDI note (60 is middle C, 69 is A 440; fractions allowed). The part sounds it.
        with "slide": { "to": 12 to 120, "along": "x" | "y" }    the pitch runs from note at the part's left (or bottom) to this at its right (or top) and follows the finger: a theremin, a slide whistle, a fretless string
        with "level": "x" | "y"      how loud follows the finger that way
        with "string": 0 to 11       this part is a string (numbered from 0 with none skipped); "note" is its open note
  "chord": [a note for each string, in order]     pressing it retunes the strings to these
  "strum": 0 to 120            ms between strings: pressing it sounds every string, low to high }

Be true to the thing. A kalimba's tines are bars plucked with a thumbnail, longest in the middle. A big thing is low and rings long; a small one is high. Soft things do not ring.`

export const asked = (wish: string) => `The thing: ${wish.slice(0, 400)}`
export const again = (wish: string, reply: string, why: string) => `${asked(wish)}\n\nYour last reply was:\n${reply.slice(0, 6000)}\n\nIt could not be used: ${why}\nReply again with the whole of it, corrected, in the same form.`

/** The JSON in a reply: the reply itself, or what a code fence holds if the model used one after all. */
export function parse(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  return JSON.parse((fenced ? fenced[1] : text).trim())
}
