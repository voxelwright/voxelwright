---
name: sdf-sculpting
description: What Media Molecule's Dreams teaches about SDF sculpting (edit lists, hierarchical evaluation, storage) and creation tools for non-experts, with sources and gaps. Load before building Voxelwright terrain, craters, sculpted shapes, soft-body source shapes, or gadget and wire UX (#74).
---

# SDF sculpting and creation tools (lessons from Dreams)

Gathered November 8, 2026 (#74) from public sources only. Nothing here is verified in
Voxelwright yet. Each fact names its source. Lines marked *inference* are ours.

## Sources

- **Evans deck.** Alex Evans, "Learning from Failure", Umbra Ignite / SIGGRAPH 2015
  Advances. We read slides 1–100 of the SlideShare copy:
  <https://www.slideshare.net/slideshow/umbra-ignite-2015-alex-evans-learning-from-failure-prototypes-rd-iteration-and-arriving-at-great-by-throwing-away-lots-of-almostgreat/52801357>.
  The course page is <http://advances.realtimerendering.com/s2015/index.html>.
  - Slides 101–145 and the speaker notes are unread. The 240 MB and 34 MB PDFs exceed the
    fetch limits, so open them locally to fill this gap.
- **Toolset design.** Game Developer, "How Media Molecule designed a fun and robust
  toolset":
  <https://www.gamedeveloper.com/design/how-media-molecule-designed-a-fun-and-robust-toolset-for-i-dreams-i->
- **User guide.** Dreams user guide, logic gadgets:
  <https://docs.indreams.me/en/create/resources/edit-mode-guide/assembly/gadgets/logic-and-processing>
- **Not yet read.** These are the likeliest sources for physics detail:
  - Liam de Valmency, "the architecture of Dreams", GDC 2020 (GDC Vault).
  - "UX Summit: Expanding the Dreamiverse": <https://www.gdcvault.com/play/1027293/UX-Summit-Expanding-the-Dreamiverse>

## Sculpting model

- **A shape is a flat list of edits, not a CSG tree** (Evans s7, s12).
  - One shape holds 1 to 100,000 edits. Each edit is an add, a subtract or a colour.
  - Primitives include strokes, cylinders, cones, cuboids, ellipsoids, prisms and donuts.
  - A soft min/max blend acts like a hard min beyond the blend radius r (s8–10).
  - Every Dreams sculpture is still made this way.
- **Storage** (s11). The evaluated field lives in 83³ fp16 volume blocks, updated
  incrementally as edits arrive.
- **Evaluation** (s22–34). Brute force (every edit at every voxel) does not scale. Dreams
  evaluates hierarchically instead:
  - It starts from a coarse 4×4×4 grid, keeps a list of the edits that can touch each
    cell, and splits cells recursively.
  - The split size matches the GPU's 64-wide wavefront.
  - Culling uses interval bounds in max-norm (cube-shaped) distance and removes more
    than 98% of edits on every listed model.
  - On a PS4 it reaches 10–100M voxels per second.
- **Rendering** (s39–92). Meshing the SDF (marching cubes and dual contouring) failed on
  self-intersection and manifold problems, and Dreams moved to point clouds and splats.
- **Collision for sculpts: unknown.**
  - No primary source says how Dreams collides sculpted shapes, or what its solver is.
  - The only code statement found is that the engine is "custom-built"
    (gamedeveloper.com, GDC 2020 architecture talk coverage).
  - Community reports (unverified) describe collision as "close to the shape" but
    approximate.

## What Voxelwright takes from it

These are all *inference*. Check each with a short experiment before relying on it.

1. **Terrain, craters and soft-body source shapes are edit lists plus a cached field.**
   - A crater is one subtract edit.
   - Undo, snapshot and replay come from the list for free, which fits the engine's
     snapshot/restore.
2. **Evaluate on WebGPU compute, hierarchically, with per-cell edit lists.**
   - Pick the split size from the target GPU's subgroup width.
   - Store the field as r16float 3D textures. Writing fp16 from WGSL needs `shader-f16`
     or packing.
3. **Use max-norm bounds only for culling.** Physics needs real distances.
4. **Collide against the field, not a mesh made from it.**
   - Evans's meshing trouble is the warning.
   - For Jolt, rebuild a heightfield, or coarse convex/compound proxies, from the
     changed region (`jolt-physics` skill).
   - Leave the rest of the world untouched.
5. **Cap edits per region and cap gadgets and wires per scene, and show visibly when a
   cap is reached.**
   - This builds on LittleBigPlanet's "cull jammed objects visibly".
   - Voxelwright already cuts wire loops.

## Creation tools for non-experts

- **One core idea, reused.** Painting reuses the sculpt primitives, so people learn one
  set of moves (toolset article).
- **Gestures over settings.** "Endless menus, and endless sliders, and endless
  settings" shrink the audience (toolset article). In Voxelwright, talk and direct
  manipulation come first. Numbers belong in the Workshop.
- **"Stealth create."** People start by arranging existing things, then alter a prefab,
  then build their own (toolset article). Voxelwright's path is furnishing, then tuning a
  part, then composing parts, then inventing a part.
- **Playful defaults beat precision tools.**
  - Clone-repeat makes "a perfect staircase every time".
  - The colour tumbler cycles colours while painting.
- **Small logic vocabulary.**
  - Boolean gates, Selector, Randomiser and an exclusive gate with priorities.
  - A calculator with six operations.
  - Ports take many wires in and out (user guide).
- **Logic attaches to its host.** A microchip snapped onto an object acts on that object
  (user guide). This is a good model for gadgets that belong to one thing.
- **Wire blend.** A wire into a tweak value can blend with it, so a typed number and a
  wired number are the same control (user guide).
- **No debugger in Dreams.** People debug with number displays and test mode (user
  guide). *Inference*: a live probe on any wire would be an easy win.

## Refresh when

- Someone reads slides 101–145 or the speaker notes.
- Someone watches the GDC 2020 architecture talk.
- Voxelwright builds its first SDF terrain experiment.
