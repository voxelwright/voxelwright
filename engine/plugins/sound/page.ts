// What a realm sounds like, on the page (#264, #247): a sound a rule made is handed to the page's own hearing
// (page/sound/world.ts `sounded`), which reads it again as a stranger's and plays it where it is. A sound that
// comes before the page can make any is not heard: it is heard when it is made or not at all. The sounds that
// stay on someone are what is so: they are kept and given when the page can make sound, and taken away when the
// page steps to another realm.
interface Ears { sounded(v: unknown): void; follows(v: unknown): void }
export default ({ engine }: { engine: { ears: Ears | null } }) => {
  let said: unknown = null, given = true
  const give = () => { if (given || !engine.ears) return; engine.ears.follows(said); given = true }
  const waiting = setInterval(give, 250)
  return {
    once(v: unknown) { engine.ears?.sounded(v) },
    state(v: unknown) { said = v; given = false; give() },
    close() { clearInterval(waiting); engine.ears?.follows(null) },
  }
}
