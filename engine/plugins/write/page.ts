// What a rule asked to have written, on the page of the one it is for (#264): asked of their own helper as if they
// had typed it, so the same writer writes it, it is tried in a world of its own, and put in only if it runs. Any
// other page does nothing. With no helper known to this page nothing is written, and nothing is said: the game
// goes on as it is.
import type { Done } from '../../page/ask.ts'

export default ({ engine, link }: { engine: { asker: { known: boolean; rule(wish: string, how?: { change?: string }): Promise<Done> }; hud: { notice(text: string, ms?: number): void } }; link: { me: string } | null }) => ({
  once(v: unknown) {
    const w = v as { for?: unknown; ask?: unknown; rule?: unknown }
    if (!link || !w || w.for !== link.me || typeof w.ask !== 'string' || !w.ask || !engine.asker.known) return
    engine.hud.notice('This world is changing as you play: something new is being written', 6000)
    void engine.asker.rule(w.ask.slice(0, 600), typeof w.rule === 'string' ? { change: w.rule } : {}).then((done) => { if (done.state === 'there') engine.hud.notice(done.changed ? `Changed: ${done.changed} Type "undo" to take it back.` : 'Something here has changed', done.changed ? 14000 : 5000) })
  },
})
