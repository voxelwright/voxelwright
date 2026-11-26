---
title: Drawing from a page plugin
description: Add and remove a render pass from a page plugin, with a runnable example.
---

A render pass belongs to the plugin that installed it. Add it to `page.engine.draws` when the plugin opens. Use a name specific to that plugin. Adding a pass with the same name replaces the previous callback. Remove it from the plugin's `close` hook so reloading the plugin leaves one drawing in each frame.

The frame loop calls each pass with the command encoder, render target, view and time. A pass can draw into the same scene as the world. The callback can also read the target's depth to place the drawing behind nearer objects.

This example runs against the engine's pass registry during the documentation check. It exercises replacement and cleanup without a GPU.

```js
const draws = passes()
const calls = []
draws.add('trail', () => calls.push('old'))
draws.add('trail', () => calls.push('new'))
draws.draw()
assert.deepEqual(calls, ['new'])
draws.remove('trail')
draws.draw()
assert.deepEqual(calls, ['new'])
```

See the [page plugin types](/plugin-types) for callback signatures and the [paint plugin](https://github.com/voxelwright/voxelwright/blob/main/engine/plugins/paint/page.ts) for a working page module.
