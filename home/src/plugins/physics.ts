import type { Context } from 'cordis'
import { PHYSICS } from '../features'
import { replace } from '../kernel'
import type { Asked } from '../physics/ask'

declare module 'cordis' {
  interface Events {
    /** A notepad line about how things move (#74), routed by talk. The physics world, once running, sets `answer`. */
    'village/physics-ask'(request: PhysicsAsk): void
  }
}
export interface PhysicsAsk { text: string; person: string; /** The router said the line asks to build a toy. */ toy?: boolean; /** The router said it asks for a mechanic the kit does not have (#106). */ invent?: boolean; answer?: Promise<Asked> }

/**
 * The physics world (#74): every thing in the home a body, toys built from parts, materials and
 * gadgets, villagers as bodies, and the world rules. On by default (?physics=0 turns it off):
 * the solver (Jolt, wasm) and everything above it load from here on demand, after the first
 * frame, so the page draws before the solver is there.
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
