// The house's one plan history (#48), shared by everything that changes the plan
// (build mode, placing things). Opened once, with the built-in house (HOUSE_PLAN)
// as the base. Every person's own link opens the same shared house on the villager
// host (#42), through `authorized`, so it always sends the tab's current token.
// When the host is not running, or this tab has no link the host accepts, the house
// lives in memory for this page only and says once that nothing built will outlast
// the page. When the host is there but its plan cannot be opened, the house is
// read-only and says why: an edit that only lived in this page would look saved
// and be lost.
import { authorized } from '../villager'
import { HOUSE_PLAN } from './plan'
import { PlanHistory, StoreError, hostStore, memoryStore } from './history'

let opening: Promise<PlanHistory> | null = null

/** What a person sees in build mode when the saved house could not be opened. */
export const READ_ONLY_LINE = "I couldn't open the saved house just now, so I'll leave it as it is until it's back."
/** What a person sees in build mode when no host is running to keep the house. */
export const UNSAVED_LINE = "The house keeper isn't running, so anything we build now goes when the page closes."
/** What a person sees in build mode when this page was not opened from their own link. */
export const LINK_LINE = 'Open your link from the house keeper to keep what we build here. Until then, it goes when the page closes.'

export function house(): Promise<PlanHistory> {
  opening ??= (async () => {
    try {
      return await PlanHistory.open(hostStore({ request: authorized }), HOUSE_PLAN)
    } catch (error) {
      if (error instanceof StoreError && error.status === 0) return PlanHistory.open(memoryStore(), HOUSE_PLAN, { unsaved: UNSAVED_LINE })
      if (error instanceof StoreError && error.status === 401) return PlanHistory.open(memoryStore(), HOUSE_PLAN, { unsaved: LINK_LINE })
      console.warn('the house plan on the host could not be opened; the house is read-only', error)
      return PlanHistory.readOnly(HOUSE_PLAN, READ_ONLY_LINE)
    }
  })()
  return opening
}
