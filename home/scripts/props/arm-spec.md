Write a JSON prop spec. Trusted code builds it; you cannot run code. Schema:

{
  "name": string,
  "size": [width, height, depth],            // overall size in metres; the built parts are scaled uniformly to fit it
  "materials": { "<key>": Material, ... },    // at most 8
  "parts": [ Part, ... ]                      // at most 60
}

Material, one of these presets:
  { "preset": "wood", "species": "oak"|"pine"|"walnut"|"cherry"|"birch", "tone": "light"|"medium"|"dark" }
  { "preset": "fabric", "color": "#hex", "pattern": "plain"|"stripes"|"check"|"velvet", "color2": "#hex" }
  { "preset": "painted", "color": "#hex", "finish": "matte"|"satin"|"gloss" }
  { "preset": "metal", "kind": "brass"|"steel"|"iron"|"copper" }
  { "preset": "ceramic", "color": "#hex", "finish": "matte"|"gloss" }
  { "preset": "wallpaper", "pattern": "plain"|"stripes"|"floral"|"trellis", "color": "#hex ground", "color2": "#hex ink", "stripe": stripe width as a fraction of a 0.6 m tile (0.01 to 0.3) }

Part (every part: "shape", "material" key, optional "at": [x,y,z] centre in metres, optional "rot": [x,y,z] in degrees):
  { "shape": "box", "size": [x,y,z], "bevel": rounding radius in metres (0 to 0.1) }
  { "shape": "cylinder", "radiusTop": r, "radiusBottom": r, "height": h, "sides": 3..48 }   // axis along y
  { "shape": "sphere", "radius": r, "sides": 3..48 }
  { "shape": "lathe", "profile": [[radius, y], ...], "sides": 3..48 }   // 3 to 48 points, revolved around y
  { "shape": "extrude", "outline": [[x, y], ...], "depth": d, "bevel": b }   // outline in the x/y plane, extruded along z, centred on z

Lengths are clamped to 0.002..3 m. Unknown presets or shapes are rejected.

Example (an existing chair):
{"name":"pine chair","size":[0.42,0.95,0.42],
 "materials":{"pine":{"preset":"wood","species":"pine","tone":"light"},"cushion":{"preset":"fabric","color":"#e3dccf","pattern":"plain"}},
 "parts":[
  {"shape":"box","size":[0.42,0.03,0.42],"at":[0,0.45,0],"material":"pine"},
  {"shape":"box","size":[0.035,0.45,0.035],"at":[-0.19,0.225,0.19],"material":"pine"},
  {"shape":"box","size":[0.035,0.45,0.035],"at":[0.19,0.225,0.19],"material":"pine"},
  {"shape":"box","size":[0.035,0.95,0.035],"at":[-0.19,0.475,-0.19],"material":"pine"},
  {"shape":"box","size":[0.035,0.95,0.035],"at":[0.19,0.475,-0.19],"material":"pine"},
  {"shape":"box","size":[0.42,0.07,0.025],"at":[0,0.9,-0.19],"material":"pine"},
  {"shape":"box","size":[0.03,0.29,0.016],"at":[-0.12,0.735,-0.19],"material":"pine"},
  {"shape":"box","size":[0.03,0.29,0.016],"at":[-0.04,0.735,-0.19],"material":"pine"},
  {"shape":"box","size":[0.03,0.29,0.016],"at":[0.04,0.735,-0.19],"material":"pine"},
  {"shape":"box","size":[0.03,0.29,0.016],"at":[0.12,0.735,-0.19],"material":"pine"},
  {"shape":"box","size":[0.38,0.05,0.38],"at":[0,0.49,0.01],"bevel":0.02,"material":"cushion"}]}

Fence the answer as ```json.
