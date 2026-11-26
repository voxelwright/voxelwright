# Physics solver bench

> **Paused prototype.** Active work is in the [engine](../../../engine/README.md). The bench still runs.

A time-boxed comparison of three solver cores for the home's physics world: Rapier (`@dimforge/rapier3d-compat` 0.21.0), Jolt (`jolt-physics` 1.1.1, WebAssembly) and a small custom XPBD solver in TypeScript (`xpbd.ts`, after Müller et al. 2020). It chose Jolt. Its adapter was promoted to `home/src/engine/jolt.ts`, which the home and the street now run. The bench itself is not the product.

```sh
npm install
npm run bench          # about a minute
node run.ts --quick    # 200 shots instead of 1000, about 15 s
```

It needs Node 22.18 or later, which runs the `.ts` files by stripping types. The latest numbers are in [RESULTS.md](RESULTS.md) (Node only, single thread, M1 Pro).

## Files

- `core.ts`: the thin core interface every scene is written against (`PhysicsCore`: `addBody`, `addHinge`, `setMotorVelocity`, `step`, `contacts`, `setRules`, `editHeights`, `overlapSphere` and the rest).
- `rapier.ts`, `jolt.ts`, `xpbd.ts`: one adapter per core.
- `scenes.ts`: the scenes. **Pinball**: a 6.5° table (gravity is tilted, not the table), a 27 mm steel ball, 5 mm walls, a rubber bumper whose kick is a gadget (contact event, then an impulse along the normal) and a 70 mm flipper on a motorised hinge at about 1500°/s. **Scale**: 180 furniture boxes and 20 kinematic capsule villagers walking circles. **Heightfield**: 128×128 over 32 m with 40 resting boxes, then a raise and a crater under some of them.
- `run.ts` prints the tables; `load.ts` times one cold engine load.

## How the measures are taken

- **Tunnelled**: the ball left the table box, or its path in a frame crossed an interior wall's mid plane within the wall's length.
- **Substeps**: Rapier steps n times at dt/n; Jolt `Step(dt, n)`; XPBD n substeps. **CCD**: Rapier `setCcdEnabled`, Jolt `EMotionQuality_LinearCast`. Rapier's `lengthUnit` is 0.05 on the table.
- **Per-pair combine**: Jolt and XPBD use the home's rule (geometric friction, average restitution) from the contact listener or combine hook. Rapier uses its per-collider rule, the only option its JS API has.
- **Right after a terrain edit**: the box sits within 12 cm of the new surface plus its half size.
- Flipper launch speeds are not comparable across engines: the two motors were not tuned to the same peak angular velocity.

## Findings

- **Tunnelling.** Rapier did not tunnel even without CCD. Jolt needs LinearCast CCD (the cheapest setting, 0 tunnelled at 25 m/s) or 8 steps. The TypeScript XPBD needed 24 substeps at 10 m/s and still tunnelled at 25 m/s, so a custom solver would need its own CCD.
- **Bounce at speed.** Square into a wall at 25 m/s, Rapier with CCD returns 0.40 of the speed where restitution says 0.50. Jolt and XPBD return 0.50.
- **Contact hooks.** Jolt's `ContactListenerJS` sets combined friction, restitution, inverse mass scales and surface velocity per contact pair. Rapier's JS `PhysicsHooks` can only filter pairs and has four fixed combine rules.
- **Impulse for sound and dust.** Rapier gives a real contact force, Jolt an estimate (`sEstimateCollisionResponse`), XPBD the real lambda. All three agreed within 8% on the bumper hit.
- **Terrain.** Jolt edits heights in place (`HeightFieldShape.SetHeights`) but never wakes sleeping bodies: the adapter must call `ActivateBodiesInAABox`, or boxes stay floating or buried. Reserve the height range up front so craters fit. Rapier has no height edit, so its adapter rebuilds the whole collider.
- **XPBD costs.** Pushing a body out of old penetration must be capped and must not become velocity. Box against box is vertex-face only. It ran 4 to 9 times slower than either WebAssembly engine.
- **Browser.** Compiling WebAssembly needs `'wasm-unsafe-eval'` in `script-src`. The home adds it to its policy whenever physics is on (`home/vite.config.ts`).
