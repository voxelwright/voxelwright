// What a material weighs, set by a rule (#264): the first of the core's tables to be data. `world.matter({of,
// weighs})` sets how heavy a cell of a material is against water, in this world, from now on; `weighs: null` puts
// back the engine's own. It changes what moves (how a falling wall lands, what a thrown thing does to what it hits),
// never where any cell of the world is. Set again in a new core when the core is swapped; a world started again has
// the engine's own until a rule sets it (a rule's `start` is where to do that).
const MATERIALS = ['air', 'earth', 'rock', 'grass', 'sand', 'water', 'asphalt', 'concrete', 'brick', 'plaster', 'wood', 'glass', 'steel', 'leaves', 'roofing', 'lamp']

export default ({ core, was }) => {
  if (typeof core().material_weighs !== 'function') throw new Error('this build of the core has no material_weighs: build it again (npm run core) and have the game take it (POST /core/look)')
  /** What has been set, by material: so it can be set again in another core, and handed to the next version of this. */
  const set = new Map(was?.set ?? [])
  const put = () => { for (const [m, v] of set) core().material_weighs(m, v) }
  put()
  return {
    does: {
      matter(rule, w, now, wrong) {
        const m = MATERIALS.indexOf(w.of)
        if (m < 1) return wrong(`what matter is of is one of ${MATERIALS.slice(1).join(', ')}`)
        if (w.weighs === null) { set.delete(m); core().material_weighs(m, 0); return }
        if (!Number.isFinite(w.weighs) || w.weighs < 0.05 || w.weighs > 50) return wrong('what it weighs is a number against water (1): 0.05 to 50, or null for the engine\'s own')
        set.set(m, w.weighs)
        core().material_weighs(m, w.weighs)
      },
    },
    state: () => ({ set: [...set] }),
    recored: put,
    /** What is set now, as the core has it: for the check. */
    weighs: (of) => core().material_weighs(MATERIALS.indexOf(of), set.get(MATERIALS.indexOf(of)) ?? 0),
  }
}
