export const SYSTEM = 'You convert floor-plan images into exact JSON plan data. Reply with one JSON object and nothing else.'

export const PROMPT = `Convert this floor plan image into JSON with exactly this shape:

{ "version": 1, "units": "m",
  "scale": { "source": "printed_dimension" | "scale_bar" | "room_size_label" | "guess", "note": "<one short sentence>" },
  "corners": [{ "id": "c1", "x": 0, "z": 0 }],
  "walls": [{ "id": "w1", "a": "c1", "b": "c2", "thickness": 0.3, "sagitta": 0 }],
  "openings": [{ "id": "o1", "wall": "w1", "kind": "door" | "window", "from": 1.0, "to": 1.9 }],
  "rooms": [{ "id": "r1", "label": "Kitchen", "loop": ["c1", "c2", "c3", "c4"] }],
  "furniture": [] }

Rules:
- Coordinates are wall centrelines in metres. x grows to the right of the image, z grows toward the bottom of the image. Put the origin at the top-left outer corner of the building.
- Scale: derive metres from printed dimensions, a scale bar or room size labels. If none exist, guess from typical door widths (about 0.9 m) and set scale.source to "guess".
- A wall runs between two corners. Split walls wherever another wall meets them (T-junctions get their own corner), so every room boundary is made of whole walls.
- thickness is the wall thickness in metres (exterior often 0.2-0.35, interior about 0.1-0.15).
- sagitta is 0 for straight walls. For a curved wall it is the signed distance from the chord midpoint to the arc midpoint: with d = unit vector from a to b and n = (d.z, -d.x), the arc midpoint is chord midpoint + sagitta * n. |sagitta| must not exceed half the chord; split larger arcs (e.g. a round tower) into several walls.
- Openings: from and to are metres along the wall measured from corner a (along the arc for curved walls), 0 <= from < to <= wall length.
- rooms: one per enclosed space with its printed name (no sizes in the label). loop lists the corners around the room in order; each consecutive pair, including last to first, must be joined by a wall.
- Ignore furniture, compass, legends, dimension lines and scale bars as geometry. furniture stays [].
- Walls are 0.5-30 m long. Output only the JSON object, no code fences or commentary.`

export const repairPrompt = (previous, reasons) => `Your previous JSON for this floor plan failed validation:
${reasons.map((r) => `- ${r}`).join('\n')}

Previous JSON:
${previous}

Return a corrected JSON object only, following the same rules:
${PROMPT}`
