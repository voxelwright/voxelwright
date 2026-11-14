// A realm's music, on the page (#264, #247): what a rule said the music is like is handed to the page's own music
// (page/sound/world.ts `tuned`), which reads it again as a stranger's and composes it as it plays. Sound may not be
// ready when the word comes (it starts with the page, not before it): the word is kept and given when it is.
export default ({ engine }: { engine: { ears: { tuned(v: unknown): void } | null } }) => {
  let said: unknown = null, given = false
  const give = () => { if (given || !engine.ears) return; engine.ears.tuned(said); given = true }
  const waiting = setInterval(give, 250)
  return {
    state(v: unknown) { said = v; given = false; give() },
    close() { clearInterval(waiting); engine.ears?.tuned(null) },
  }
}
