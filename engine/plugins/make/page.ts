// A thing a rule asked for, on the page of the one it is for (#264, #244): made as if they had typed it, by their
// own helper and their own model, with the wait covered at the place. Any other page does nothing: a rule cannot
// have someone else's model make its things. With no helper known to this page, the person is told how to get one.
import type { Ask, Done } from '../../page/ask.ts'

export default ({ engine, link }: { engine: { wish: { thing(ask: Ask): Promise<Done> }; asker: { known: boolean }; hud: { notice(text: string, ms?: number): void }; hands?: { take(id: string): void } }; link: { me: string } | null }) => ({
  once(v: unknown) {
    const w = v as { for?: unknown; wish?: unknown; at?: unknown; hold?: unknown }
    if (!link || !w || w.for !== link.me || typeof w.wish !== 'string' || !w.wish) return
    if (!engine.asker.known) return engine.hud.notice('To have things made for you here, run node helper.mjs on your machine and open the address it prints', 9000)
    const at = Array.isArray(w.at) && w.at.length === 3 && w.at.every((n) => Number.isInteger(n)) ? (w.at as [number, number, number]) : null
    void engine.wish.thing({ wish: w.wish.slice(0, 200), ...(at ? { target: { point: at } } : {}) }).then((done) => {
      // Asked for into the hand: once it stands it is picked up (the world has a full hand put down what it held first).
      if (w.hold !== true || done.state !== 'there' || !done.id || !engine.hands) return
      engine.hands.take(done.id)
    })
  },
})
