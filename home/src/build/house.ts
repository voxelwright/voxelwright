// The house's one plan history (#48), shared by everything that changes the plan
// (build mode, placing things). Opened once: on the villager host when it is
// running (the same per-launch token talk uses), else in memory for this page
// only, with the built-in kitchen (KITCHEN) as the base, saying once that nothing
// built will outlast the page. When the host is there but its plan cannot be
// opened, the house is read-only and says why: an edit that only lived in this
// page would look saved and be lost.
import { KITCHEN } from './plan'
import { PlanHistory, hostStore, memoryStore } from './history'
import { launchToken } from '../villager'

let opening: Promise<PlanHistory> | null = null

/** What a person sees in build mode when the saved house could not be opened. */
export const READ_ONLY_LINE = "I couldn't open the saved house just now, so I'll leave it as it is until it's back."
/** What a person sees in build mode when no host is running to keep the house. */
export const UNSAVED_LINE = "The house keeper isn't running, so anything we build now goes when the page closes."

export function house(): Promise<PlanHistory> {
  opening ??= (async () => {
    const token = await launchToken()
    if (!token) return PlanHistory.open(memoryStore(), KITCHEN, { unsaved: UNSAVED_LINE })
    try {
      return await PlanHistory.open(hostStore({ base: '/villager/api', token, refresh: launchToken }), KITCHEN)
    } catch (error) {
      console.warn('the house plan on the host could not be opened; the house is read-only', error)
      return PlanHistory.readOnly(KITCHEN, READ_ONLY_LINE)
    }
  })()
  return opening
}
