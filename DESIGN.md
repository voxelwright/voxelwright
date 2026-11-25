# Designing Voxelwright controls

## Interaction

- **Choose a control by what the hand needs to do.** Look for a familiar device with the same job.
  A key triggers an action, a dial makes a fine adjustment, and a fader shows its setting by position.
  Someone who knows the device should be able to predict the gesture and its result.
  <!-- 2026-11-18: “Is there an existing human interface design ... which does the same thing in principle.” -->

## Surfaces

- **Let the case, cap material and profile, and lighting change independently.** Keep the action,
  accessible name and current setting when swapping finishes. A low-profile floating key and a tall
  cap in a socket can both explain the same press. Give themes room for a matching desk mat or
  artwork that runs continuously across a bank of keys. This is how one instrument can feel personal
  in wood, metal or translucent plastic.
  <!-- 2026-11-18: “changing light scheme on LED keyboards and changing keycaps (materials and shape)” -->

- **Prove one working specimen for every new physical control family.** Verify its shape on the
  shared voxel renderer, then operate it beside its siblings at normal size. The close-up reveals
  how it is built. The bank reveals whether it belongs on the device.
  <!-- 2026-11-18: “one specimen for every new physical control family” -->

The [kit specification](engine/kit/SPEC.md) covers how light travels through materials, where indicators
sit when unlit, how shortcut caps stand above text, and how hardware moves and sounds. Use the
[UI Craft review](.agents/skills/ui-craft/SKILL.md) to judge the result under the hand.
