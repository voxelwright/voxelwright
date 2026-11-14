// What a realm sounds like, on the page (#264, #247): a sound a rule made is handed to the page's own hearing
// (page/sound/world.ts `sounded`), which reads it again as a stranger's and plays it where it is. A sound that
// comes before the page can make any is not heard: it is heard when it is made or not at all.
export default ({ engine }: { engine: { ears: { sounded(v: unknown): void } | null } }) => ({
  once(v: unknown) { engine.ears?.sounded(v) },
})
