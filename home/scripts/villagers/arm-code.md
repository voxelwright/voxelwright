Write a JavaScript module with no imports that exports exactly:

export default function (villager, api) { ... }

It runs in a sealed sandbox. You build the villager from three.js meshes; only the meshes, their slots and your plain data come back to the home. Units: the villager stands on y = 0, faces +z, and is 0.4 to 0.7 tall (Dumpling 0.52, Tuft 0.48); anything under 0.25 or over 1.1 is rejected.

`api` holds:
- api.THREE: three.js core r187. Use Group, Mesh, SphereGeometry, CapsuleGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, BoxGeometry, LatheGeometry, CircleGeometry, Vector2, MeshStandardMaterial.
- api.RoundedBoxGeometry(width, height, depth, segments, radius) (use `new`).

Materials: only `new THREE.MeshStandardMaterial({ color: '#rrggbb', roughness })`. The home re-dresses every part: roughness 0.5 or more becomes stitched felt in that colour (use this for almost everything); roughness under 0.5 becomes a smooth glossy bead (button eyes, a nose, metal). Do not paint textures.

`villager` holds:
- villager.add(object): add a mesh or group to the villager. Positions are in the villager's own space.
- villager.tag(object, slot) returns the object: puts a mesh or a whole group in a slot the walk rig moves on its own. Untagged meshes are the body. Slots: 'head', 'eye-left', 'eye-right', 'hand-left', 'hand-right', 'foot-left', 'foot-right', 'held'. Every slot except 'held' is required, and any other slot name is rejected.
  - head: everything that turns with the head (ears, snout, hat, glasses). It turns about its own centre. Tag the eyes separately (inside or outside the head group): each eye is squashed flat to blink.
  - hands: one small mitten each side of the body, about halfway up; they swing and bob.
  - feet: one on +x, one on -x, sitting on the floor under the body; the walk cycle places them. Legs, if any, belong to the feet.
  - held: the prop, placed in front of one hand; it moves with the nearest hand.
- villager.gait({ speed: 0.2..0.6 m/s, stride: 0.14..0.34 per two steps, bob: 0..0.08, stepped: true, fidget: 0..1 })
- villager.about({ name, role, bark, voice }): role is one of cook, gardener, tidier, keeper, tutor, messenger, maker, carer; voice is { pitch: 90..480 Hz, range: 0.5..7 semitones, formant: 0.75 (big, dark)..1.6 (tiny, bright), rate: 4..16 syllables/s, breath: 0..0.6, wobble: 0..1.2, wobbleRate: 3..9 Hz, tilt: 0.8 (buzzy)..2.6 (round, dark), gain: 0.6..1.2 }.
Numbers outside these ranges are clamped.

The owner's accent colour is given with the request: make a scarf round the neck in exactly that colour, and use it nowhere else. Do not touch the scene, DOM, network or timers. Keep it under about 60 meshes.

Example (Dumpling, the existing cook, accent #c8553d):

export default function (villager, api) {
  const { THREE } = api
  const felt = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 })
  const add = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m }
  const tan = felt('#e2b98a'), cream = felt('#f6e6cc'), pink = felt('#e8a3a0')
  const body = add(villager, new THREE.SphereGeometry(0.2, 32, 20), tan, 0, 0.146, 0)
  body.scale.set(1, 0.56, 0.88)
  add(villager, new THREE.SphereGeometry(0.09, 20, 12), cream, 0, 0.15, 0.13).scale.set(0.9, 0.9, 0.35)
  const scarf = add(villager, new THREE.TorusGeometry(0.16, 0.024, 10, 28), felt('#c8553d'), 0, 0.25, 0)
  scarf.rotation.x = Math.PI / 2
  const head = villager.tag(new THREE.Group(), 'head')
  head.position.set(0, 0.36, 0)
  villager.add(head)
  add(head, new THREE.SphereGeometry(0.164, 32, 20), tan, 0, 0, 0).scale.set(1.08, 0.92, 0.95)
  add(head, new THREE.SphereGeometry(0.07, 20, 12), cream, 0, -0.04, 0.12).scale.set(1.15, 0.75, 0.6)
  add(head, new THREE.SphereGeometry(0.016, 12, 8), new THREE.MeshStandardMaterial({ color: '#4a2e28', roughness: 0.3 }), 0, -0.016, 0.16)
  for (const s of [-1, 1]) {
    const ear = add(head, new THREE.CapsuleGeometry(0.033, 0.15, 6, 12), tan, s * 0.164, -0.016, -0.008)
    ear.rotation.z = s * 0.28
    ear.scale.set(1, 1, 0.45)
    add(ear, new THREE.CapsuleGeometry(0.02, 0.11, 6, 10), pink, 0, 0, 0.008).scale.set(1, 1, 0.5)
    const eye = villager.tag(add(head, new THREE.CylinderGeometry(0.021, 0.021, 0.012, 18), new THREE.MeshStandardMaterial({ color: '#241a18', roughness: 0.25 }), s * 0.066, 0.02, 0.14), s < 0 ? 'eye-left' : 'eye-right')
    eye.rotation.x = Math.PI / 2 - 0.15
    const hand = villager.tag(add(villager, new THREE.CapsuleGeometry(0.034, 0.05, 6, 10), tan, s * 0.196, 0.158, 0.02), s < 0 ? 'hand-left' : 'hand-right')
    hand.rotation.z = s * 0.5
    villager.tag(add(villager, new THREE.SphereGeometry(0.048, 16, 10), tan, s * 0.1, 0.03, 0.02), s < 0 ? 'foot-left' : 'foot-right').scale.set(1, 0.65, 1.3)
  }
  const spoon = villager.tag(new THREE.Group(), 'held')
  spoon.position.set(-0.196, 0.13, 0.04)
  spoon.rotation.z = -0.5
  villager.add(spoon)
  add(spoon, new THREE.CylinderGeometry(0.008, 0.01, 0.2, 8), felt('#a8703a'), 0, 0.05, 0)
  add(spoon, new THREE.SphereGeometry(0.03, 14, 10), felt('#a8703a'), 0, 0.165, 0).scale.set(1, 1.3, 0.45)
  villager.gait({ speed: 0.38, stride: 0.24, bob: 0.04, stepped: true, fidget: 0.3 })
  villager.about({ name: 'Dumpling', role: 'cook', bark: "Soup's on for Thursday. Shall I add bread to the list?", voice: { pitch: 240, range: 3, formant: 1.1, rate: 10, breath: 0.1, wobble: 0.25, wobbleRate: 5, tilt: 1.6, gain: 0.9 } })
}

Fence the answer as ```js.
