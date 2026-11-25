# Drawing from a page plugin

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

See the [page plugin types](plugin-types.md) for callback signatures and the [paint plugin](../engine/plugins/paint/page.ts) for a working page module.

<!-- docs-verified 00420ce4a7390b907c04f07adcd84a232f5ae4d1 {"engine/page/plugins.ts":"940231a49d95a7e2f7b8a0f7450ad3f6","engine/plugins/paint/page.ts":"7d91c6ccc7b2474de2d1052f850fb5ab"} -->
