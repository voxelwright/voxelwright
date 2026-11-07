// The house's one plan history (#48), shared by everything that changes the plan
// (build mode, placing things). Opened once: on the villager host when it is
// running (the same per-launch token talk uses, under the first person), else in
// memory for this page only, with today's kitchen as the base.
import { KITCHEN } from './plan'
import { PlanHistory, hostStore, memoryStore } from './history'

let opening: Promise<PlanHistory> | null = null

/** The person whose token reaches the host; the house itself is shared. */
const PERSON = 'alex'

async function hostToken(): Promise<string | null> {
  const launch = await fetch('/villager/launch', { cache: 'no-store' }).catch(() => null)
  if (!launch?.ok) return null
  return ((await launch.json().catch(() => null)) as { token?: string } | null)?.token ?? null
}

export function house(): Promise<PlanHistory> {
  opening ??= (async () => {
    const token = await hostToken()
    if (token) {
      try {
        return await PlanHistory.open(hostStore({ base: '/villager/api', person: PERSON, token }), KITCHEN)
      } catch (error) {
        // A store that cannot be read or no longer replays is reported, and this page works on a copy in memory.
        console.warn('the house plan on the host could not be opened; working in memory', error)
      }
    }
    return PlanHistory.open(memoryStore(), KITCHEN)
  })()
  return opening
}
