Write a JavaScript module with no imports that exports exactly:

export default function (villager, api) { ... }

It runs in a sealed sandbox. You build the villager from three.js meshes; only the meshes, their slots and your plain data come back to the home. Units: the villager stands on y = 0, faces +z, and is 0.4 to 0.7 tall (Dumpling 0.52, Tuft 0.48; a heron or giraffe up to 0.9); anything under 0.25 or over 1.1 is rejected.

`api` holds:
- api.THREE: three.js core r187. Use Group, Mesh, SphereGeometry, CapsuleGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, BoxGeometry, LatheGeometry, CircleGeometry, Vector2, MeshStandardMaterial.
- api.RoundedBoxGeometry(width, height, depth, segments, radius) (use `new`). It is not part of THREE: `new THREE.RoundedBoxGeometry` fails.

Materials: only `new THREE.MeshStandardMaterial({ color: '#rrggbb', roughness })`. The home re-dresses every part: roughness 0.5 or more becomes stitched felt in that colour (use this for almost everything); roughness under 0.5 becomes a smooth glossy bead (button eyes, a nose, metal). Do not paint textures.

`villager` holds:
- villager.add(object): add a mesh or group to the villager. Positions are in the villager's own space.
- villager.tag(object, slot) returns the object: puts a mesh or a whole group in a slot the walk rig moves on its own. Untagged meshes are the body. Slots: 'head', 'eye-left', 'eye-right', 'hand-left', 'hand-right', 'foot-left', 'foot-right', 'held'. Every slot except 'held' is required, and any other slot name is rejected.
  - head: everything that turns with the head (ears, snout, glasses). It turns about its own centre.
  - eye-left, eye-right: one small dark disc each, set into the face's felt where the eye goes and facing out of it (inside or outside the head group). The home replaces them with its own button eyes and cheeks, so only their place and facing count; it squashes them flat to blink.
  - hands: one small mitten each side of the body, about halfway up; they swing and bob.
  - feet: one on +x, one on -x, sitting on the floor under the body; the walk cycle places them. Legs, if any, belong to the feet.
  - held: the prop, its handle through the middle of one hand's mitten; it moves with that hand.
- villager.mark(object) returns the object: marks the role's anchor from the role table, one small felt part (a button on the crown or on the side of the head, a patch on the back, or the knot on the duster handle's top end). The home drops it and sews the role's mark there. Mark only the anchor: never the head, the body or a group holding them.
- villager.gait({ speed: 0.2..0.6 m/s, stride: 0.14..0.34 per two steps, bob: 0..0.08, stepped: true, fidget: 0..1 })
- villager.about({ name, role, bark, voice }): name is the persona's name; role is one of cook, gardener, tidier, keeper, tutor, messenger, maker, carer; voice is { pitch: 90..560 Hz, range: 0.5..7 semitones, formant: 0.75 (big, dark)..1.6 (tiny, bright), rate: 4..16 syllables/s, breath: 0..0.6, wobble: 0..1.2, wobbleRate: 3..9 Hz, tilt: 0.8 (buzzy)..2.6 (round, dark), gain: 0.6..1.2 }.
Numbers outside these ranges are clamped.

The request gives a starting voice worked out from the description. Start from it and change only what the character calls for; say what you changed and why in one comment line just above villager.about(), starting `// voice:`.

The owner's accent colour is given with the request: do not use it yourself. The home sews the role's mark in it where your anchor is.

The home checks the finished villager, with its own eyes and mark sewn on, and refuses it, with the reason, when:
- an eye is hidden: rays from straight in front of each eye, and from in front and 33 degrees above (where the home is seen from), must reach the eye first, so no ear, snout or prop may cover the face from either;
- a part floats: every mesh must touch or overlap another (bounding boxes within 0.02), so a head sits on its neck and an ear on its head;
- the held prop's longest side is under a third of the villager's height, or longer than its height, or it does not touch a hand (its handle goes through the mitten);
- it is under 0.3 or over 1.0 tall, or wider than 1.5 times its height;
- the head or the body itself is passed to villager.mark() (mark only the small anchor);
- the role's mark, sewn on your head, does not stand out of the outline from in front and above, or covers the face from a little above the dollhouse view: leave the crown bare and the face clear;
- it is the default round body with a head on top: besides the role's mark and the prop, nothing reaches forward past the face (snout, muzzle, beak, or the head ahead of the body), the body sits on the floor (no legs), the head sits straight on the body (no neck), and no ears, horns or eyes rise above the head or stick out past its sides.

Do not touch the scene, DOM, network or timers. Keep it under about 60 meshes.

Example (Dumpling, the existing cook, accent #c8553d). It shows the API: slots, the eye discs, the role's anchor and villager.mark(), about(). Its round body and head on top are Dumpling's own; do not start from them. Build your species' body plan from the shapes it needs:

export default function (villager, api) {
  const { THREE } = api
  const felt = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 })
  const add = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m }
  const tan = felt('#e2b98a'), cream = felt('#f6e6cc'), pink = felt('#e8a3a0')
  const body = add(villager, new THREE.SphereGeometry(0.2, 32, 20), tan, 0, 0.146, 0)
  body.scale.set(1, 0.56, 0.88)
  add(villager, new THREE.SphereGeometry(0.09, 20, 12), cream, 0, 0.15, 0.13).scale.set(0.9, 0.9, 0.35)
  const head = villager.tag(new THREE.Group(), 'head')
  head.position.set(0, 0.36, 0)
  villager.add(head)
  add(head, new THREE.SphereGeometry(0.164, 32, 20), tan, 0, 0, 0).scale.set(1.08, 0.92, 0.95)
  add(head, new THREE.SphereGeometry(0.07, 20, 12), cream, 0, -0.04, 0.12).scale.set(1.15, 0.75, 0.6)
  add(head, new THREE.SphereGeometry(0.016, 12, 8), new THREE.MeshStandardMaterial({ color: '#4a2e28', roughness: 0.3 }), 0, -0.016, 0.16)
  // The cook's anchor: one small felt button on the crown. The home sews its toque there, in the owner's felt.
  villager.mark(add(head, new THREE.SphereGeometry(0.028, 12, 8), felt('#f4efe4'), 0, 0.148, -0.01))
  for (const s of [-1, 1]) {
    const ear = add(head, new THREE.CapsuleGeometry(0.033, 0.15, 6, 12), tan, s * 0.164, -0.016, -0.008)
    ear.rotation.z = s * 0.28
    ear.scale.set(1, 1, 0.45)
    add(ear, new THREE.CapsuleGeometry(0.02, 0.11, 6, 10), pink, 0, 0, 0.008).scale.set(1, 1, 0.5)
    // An eye disc set into the face; the home sews its own button eye there.
    const eye = villager.tag(add(head, new THREE.CylinderGeometry(0.021, 0.021, 0.012, 18), new THREE.MeshStandardMaterial({ color: '#241a18', roughness: 0.25 }), s * 0.066, 0.02, 0.14), s < 0 ? 'eye-left' : 'eye-right')
    eye.rotation.x = Math.PI / 2 - 0.15
    const hand = villager.tag(add(villager, new THREE.CapsuleGeometry(0.034, 0.05, 6, 10), tan, s * 0.196, 0.158, 0.02), s < 0 ? 'hand-left' : 'hand-right')
    hand.rotation.z = s * 0.5
    villager.tag(add(villager, new THREE.SphereGeometry(0.048, 16, 10), tan, s * 0.1, 0.03, 0.02), s < 0 ? 'foot-left' : 'foot-right').scale.set(1, 0.65, 1.3)
  }
  const spoon = villager.tag(new THREE.Group(), 'held')
  // Its handle runs through the middle of the left mitten.
  spoon.position.set(-0.196, 0.158, 0.02)
  spoon.rotation.z = -0.5
  villager.add(spoon)
  add(spoon, new THREE.CylinderGeometry(0.008, 0.01, 0.2, 8), felt('#a8703a'), 0, 0.05, 0)
  add(spoon, new THREE.SphereGeometry(0.03, 14, 10), felt('#a8703a'), 0, 0.165, 0).scale.set(1, 1.3, 0.45)
  villager.gait({ speed: 0.38, stride: 0.24, bob: 0.04, stepped: true, fidget: 0.3 })
  // voice: from the starting voice, a little lower and darker for a round, unhurried cook.
  villager.about({
    name: 'Dumpling', role: 'cook', bark: "Soup's on for Thursday. Shall I add bread to the list?",
    voice: { pitch: 240, range: 3, formant: 1.1, rate: 10, breath: 0.1, wobble: 0.25, wobbleRate: 5, tilt: 1.6, gain: 0.9 },
  })
}

Its persona block, after the module:
```json
{"name":"Dumpling","role":"cook","speciality":"meals, meal plans and shopping lists on a budget, hosting, and the family's week around the table","temperament":"warm, generous, practical, a talker","register":"warm and flowing: talks it through in full connected sentences with real details, names, times and amounts","humour":{"style":"friendly teasing and generous exaggeration; laughs at itself first","lean":"cheeky"},"quirks":["remembers who likes what","has firm opinions on onions","always has a plan B ready"],"cares":["everyone eating well","stretching the food budget","family dinners"],"decides":"starts from what it costs the person day to day and who does the work, then offers two or three workable options and says which it would pick","tastes":["a plan only counts if you can face it on a tired Tuesday","food snobbery is worse than any topping"],"frictions":["thinks Tuft cuts the very parts that make life worth living"],"mistakes":"owns it straight away and cheerfully, then puts a better option on the table","lengths":{"card":2,"table":1,"long":14}}
```

Fence the module as ```js, then the persona, in the shape above, as a second block fenced ```json.
