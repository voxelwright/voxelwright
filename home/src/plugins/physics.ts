import type { Context } from 'cordis'
import { PHYSICS } from '../features'
import { replace } from '../kernel'

/**
 * The physics world (#74): toys built from parts, materials and gadgets, villagers as bodies,
 * and the world rules. Only with ?physics: the solver (Jolt, wasm) and everything above it
 * load from here on demand, so the default page pays nothing.
 */
export default {
  name: 'physics',
  inject: ['stage', 'entries', 'view'],
  apply(ctx: Context) {
    if (!PHYSICS) return
    let gone = false
    ctx.effect(() => () => void (gone = true), 'physics loading')
    void import('../physics/start')
      .then((m) => (gone ? undefined : m.start(ctx, () => gone)))
      .catch((error) => {
        console.error('Village physics failed to start:', error)
        ctx.emit('village/plugin-error', 'physics', error)
      })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
