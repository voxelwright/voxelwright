# Physics solver bench (#74)

A time-boxed comparison of three cores for Village's one physics engine:
Rapier (`@dimforge/rapier3d-compat` 0.21.0), Jolt (`jolt-physics` 1.1.1, wasm)
and a small custom XPBD solver in TypeScript (`xpbd.ts`, after Müller et al.
2020). It is not the product.

```sh
cd home/bench/physics && npm install && npm run bench          # about a minute
cd home/bench/physics && node run.ts --quick                     # 200 shots, about 15 s
```

Needs Node 22.18 or later (it runs the `.ts` files by stripping types). The
latest numbers are in [RESULTS.md](RESULTS.md).

## Files

- `core.ts`: the thin core interface Village's own model (materials, gadgets,
  world rules) will sit on: `addBody(shape, material)`, `addHinge`, `step(dt)`,
  `contacts()`, `setRules`, `editHeights`, `overlapSphere`. The winner's
  adapter is meant to be reused.
- `rapier.ts`, `jolt.ts`, `xpbd.ts`: one adapter per core.
- `scenes.ts`: the scenes, written only against `core.ts`. Pinball: a 6.5°
  table (gravity is tilted, not the table), a 27 mm 80 g steel ball, 5 mm
  walls, a rubber bumper whose kick is a gadget (contact event, then an impulse
  along the normal) and a 70 mm flipper on a motorised hinge at 1500°/s. Scale:
  180 furniture boxes and 20 kinematic capsule villagers walking circles. Heightfield: 128x128 over
  32 m with 40 resting boxes; a 16x16 raise and a 48x48 crater 2 m deep under
  9 of them.
- `run.ts` prints the tables; `load.ts` times one cold engine load.

## How the measures are taken

- Tunnelled: the ball left the table box, or its path in a frame crossed an
  interior wall's mid plane within the wall's length. Validated by Jolt without
  CCD, which tunnels 896 of 1000 shots at one step.
- Substeps: Rapier steps n times at dt/n; Jolt `Step(dt, n)` (n collision
  steps); XPBD n substeps. CCD: Rapier `setCcdEnabled`, Jolt
  `EMotionQuality_LinearCast`. Rapier's `lengthUnit` is 0.05 on the table.
- Per-pair combine: Jolt and XPBD use Village's rule (geometric friction,
  average restitution) from the contact listener or combine hook. Rapier
  uses its per-collider rule (average), the only option its JS API has.
- "Right" after a terrain edit: the box sits within 12 cm of the new surface
  plus its half size. Rapier's awake count is read straight after the edit; it
  wakes the touching bodies on its next step, so all 9 end right.
- Times are node, single thread, M1 Pro. No browser numbers yet.

## Findings that change the design

- Rapier 0.21 did not tunnel at all, even without CCD at one step, because its
  contacts are speculative. Jolt needs LinearCast CCD (cheapest, 0 tunnelled at
  25 m/s) or 8 steps. The TS XPBD needs 24 substeps at 10 m/s and still
  tunnels 31% at 25 m/s: custom would need its own CCD.
- Contact hooks: Jolt's `ContactListenerJS` sets combined friction,
  restitution, inverse mass scales and surface velocity per contact pair. Rapier's JS
  `PhysicsHooks` can only filter pairs, and it has four fixed combine rules.
  The Jolt listener costs about 0.06 ms a frame at 200 bodies (0.17 to 0.23
  ms).
- Impulse for sound and dust: Rapier contact-force events give a real
  force; Jolt gives an estimate (`sEstimateCollisionResponse`) at
  `OnContactAdded`; XPBD has the real lambda. All three agreed within 8% on the
  bumper hit.
- Terrain: Jolt edits heights in place (`HeightFieldShape.SetHeights`, 0.06 to
  0.09 ms) but never wakes sleeping bodies; the adapter must call
  `ActivateBodiesInAABox`, or the 9 boxes stay floating or buried. Reserve the
  height range (`mMinHeightValue`/`mMaxHeightValue`) up front so craters fit.
  Rapier has no height edit, so the adapter rebuilds the whole collider (0.5 ms
  at 128x128, growing with the whole terrain, not with the patch).
- XPBD costs: pushing a body out of old penetration (a raised terrain) must be
  capped and must not become velocity, or boxes leave at 15 m/s. Box-box is
  vertex-face only. It is 4 to 9 times slower than either wasm engine here.
- Browser: the home's CSP is `script-src 'self'` without `'wasm-unsafe-eval'`,
  which browsers require to compile WebAssembly. Either engine needs that CSP
  change (not yet tried in a browser).
