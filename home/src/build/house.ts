// The house's one plan history (#48), shared by everything that changes the plan
// (build mode, placing things). Opened once: on the villager host when it is
// running (the same per-launch token talk uses), else in memory for this page
// only, with today's kitchen as the base. When the host is there but its plan
// cannot be opened, the house is read-only and says why: an edit that only lived
// in this page would look saved and be lost.
import { KITCHEN } from './plan'
import { PlanHistory, hostStore, memoryStore } from './history'

let opening: Promise<PlanHistory> | null = null

/** What a person sees in build mode when the saved house could not be opened. */
export const READ_ONLY_LINE = "I couldn't open the saved house just now, so I'll leave it as it is until it's back."

async function hostToken(): Promise<string | null> {
  const launch = await fetch('/villager/launch', { cache: 'no-store' }).catch(() => null)
  if (!launch?.ok) return null
  return ((await launch.json().catch(() => null)) as { token?: string } | null)?.token ?? null
}

export function house(): Promise<PlanHistory> {
  opening ??= (async () => {
    const token = await hostToken()
    if (!token) return PlanHistory.open(memoryStore(), KITCHEN)
    try {
      return await PlanHistory.open(hostStore({ base: '/villager/api', token }), KITCHEN)
    } catch (error) {
      console.warn('the house plan on the host could not be opened; the house is read-only', error)
      return PlanHistory.readOnly(KITCHEN, READ_ONLY_LINE, error)
    }
  })()
  return opening
}
