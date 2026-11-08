---
name: jolt-physics
description: Versions, verified recipes and limits for Jolt Physics in JavaScript (jolt-physics npm, wasm), Village's candidate core physics engine (#74). Load before writing or changing a Jolt adapter, contact listener, heightfield edit or anything that allocates Jolt objects.
---

# Jolt Physics (JS/wasm)

Adopted for the #74 bench (`home/bench/physics/jolt.ts`): `jolt-physics` 1.1.1
(published October 23, 2026), the wasm build of Jolt by Jorrit Rouwe. Verified November 8, 2026 in
Node 25.1 on an M1 Pro, single thread. Not yet run in the home's browser page.

Primary sources: the bindings' IDL and examples at
<https://github.com/jrouwe/JoltPhysics.js> (`JoltJS.idl`, `Examples/`), the
engine docs at <https://jrouwe.github.io/JoltPhysics/> and the installed
`node_modules/jolt-physics/dist/types.d.ts` (the source of truth for the JS
names). Check the IDL before assuming a C++ method is exposed.

## Builds

- `jolt-physics` (= `/wasm-compat`) inlines the wasm as base64 (3.2 MB JS);
  `/wasm` loads `jolt-physics.wasm.wasm` (1.98 MB raw, 735 KB gzip). Use `/wasm`
  in the browser. Multithread builds need SharedArrayBuffer, so cross-origin
  isolation (COOP/COEP), which the home does not have.
- Both need `'wasm-unsafe-eval'` in the page CSP; `home/vite.config.ts` has
  `script-src 'self'` only. A CSP change needs the seven-lens review.
- Cold load in Node: about 75 ms.

## Verified recipes (bench code is the reference)

- World: `JoltSettings` with `mMaxWorkerThreads = 0`, two object layers
  (non-moving, moving) through `ObjectLayerPairFilterTable`,
  `BroadPhaseLayerInterfaceTable` and `ObjectVsBroadPhaseLayerFilterTable`.
  Statics on the non-moving layer. Call `OptimizeBroadPhase()` after adding
  bodies, before the first step.
- Memory: every `new J.X()` lives on the wasm heap until `J.destroy(x)`.
  Destroy creation settings and temporaries; reuse one scratch `Vec3`/`RVec3`/
  `Quat` per adapter for per-frame calls. Values returned by getters (for
  example `GetPosition`) are temporaries: read them, do not destroy or keep them.
  Destroy each `JoltInterface` when a world is done: the bench hit
  `Aborted(OOM)` after about a dozen undisposed worlds.
- Box convex radius must not exceed the smallest half extent (default 0.05 m):
  pass `Math.min(0.05, 0.5 * minHalf)` for thin walls and flippers.
- Density: `shape.SetDensity(d)` on convex shapes before `BodyCreationSettings`.
- Per-body gravity: `mGravityFactor` / `SetGravityFactor`.
- Tunnelling: a 27 mm ball at 10 and 25 m/s through 5 mm walls tunnels at one
  step (896 of 1000) and is clean with `mMotionQuality = EMotionQuality_LinearCast`
  at one step, the cheapest setting (0.007 ms/frame). Without CCD it needs
  `Step(dt, 8)`.
- Hinge with motor: `HingeConstraintSettings` in world space (`mPoint1/2`,
  `mHingeAxis1/2`, `mNormalAxis1/2`), `mLimitsMin/Max`,
  `mMotorSettings.mMax/MinTorqueLimit`, created against
  `jolt.sGetFixedToWorldBody()`, `castObject(..., J.HingeConstraint)`, then
  `SetMotorState(EMotorState_Velocity)` and `SetTargetAngularVelocity`.
  Activate the body after changing the target.
- Contact hooks: `ContactListenerJS` with all four callbacks assigned;
  `wrapPointer` the raw pointers to `Body`, `ContactManifold`,
  `ContactSettings`. In `OnContactAdded`/`OnContactPersisted`, set
  `mCombinedFriction`, `mCombinedRestitution`, inverse mass/inertia scales or
  surface velocity: this is the per-pair material combine and the
  "super power impact" hook. Do not add, remove or move bodies inside callbacks;
  queue gadget actions and run them after `Step`.
- Impulse for sound and dust: `JoltInterface.prototype.sEstimateCollisionResponse`
  in `OnContactAdded` (estimate; within 7% of Rapier's measured force on the
  bumper hit).
- Listener cost: 0.17 ms without, 0.23 ms with, per 60 Hz step for 180 boxes +
  20 kinematic capsules (single thread, node).
- Heightfield: `HeightFieldShapeSettings` with `mSampleCount = n`,
  `mHeightSamples` filled through `HEAPF32` at `getPointer(data()) >> 2`,
  samples `[z * n + x]`, `mScale = (cell, 1, cell)`, `mOffset` to centre it.
  Reserve `mMinHeightValue`/`mMaxHeightValue` for future edits.
  Edit with `HeightFieldShape.SetHeights(x, z, w, h, FloatMemRef, w,
  jolt.GetTempAllocator())` (copy into an `ArrayFloat`), then
  `NotifyShapeChanged`, then `ActivateBodiesInAABox` over the edited area:
  Jolt does not wake sleeping bodies itself (verified: 0 of 9 move without it).
  A 48x48 crater edit costs about 0.1 ms.
- Overlap: `GetBroadPhaseQuery().CollideSphere` with a
  `CollideShapeBodyCollectorJS` is bounding-box level only (0.07 ms for 50
  queries); use the narrow-phase query for exact shapes.
- Determinism: the same scene run twice in one build gave identical positions.

## Not verified yet

Browser load and step time, the multithread build, narrow-phase queries,
soft bodies, character controller, breakable constraints. Jolt has no built-in
fracture; plan pre-fractured compounds swapped by the gadget layer.

## Refresh when

The `jolt-physics` version changes, the home's CSP or isolation headers
change, or a probe contradicts a line above.
