// What counts as a person approving an Elder change (#87): Keep (promote), Undo
// (roll back) and Not this (decline). This file is the whole rule; elder-home.ts
// `decide` looks the run up, asks here and acts only on a yes, and promote() then
// refuses anything that changed since its check. On the command line the
// approval is the person's own --approve flag (cli.ts).
//
// Why the approval page has an origin of its own: the live home runs promoted
// plugins, model-written code a person kept earlier, so one kept plugin could
// press Keep for the next if the home could approve. Nothing a model or a
// candidate writes can approve either: a route, a villager's reply, the
// candidate's files, its result.json and the executor's output start a run at
// most. So only the approval page, which the host serves itself on another port
// (approval-server.ts: static files from this repo, no plugin code, no framing),
// can send these, and the home's own server does not route them at all.
//
// The rule, in the order it is checked; the first that fails answers:
//   1. the request is a POST;
//   2. from an operator's paired session;
//   3. about a run that exists and is that person's;
//   4. marked by the browser as same-origin (Sec-Fetch-Site), with an Origin that is an approval origin;
//   5. sent as JSON;
//   6. naming the run (Keep) or the promotion (Undo) the page showed;
//   7. for a run whose state allows it: Keep a passed run not yet in the home, Undo a kept one,
//      Not this a passed, failed or interrupted one.
// The live home is same-site with the approval page (cookies ignore ports), so its
// requests carry the session cookie: only the Origin tells them apart. A client
// without browser headers (curl, a script on the machine) is refused at 4.
import type { IncomingMessage } from 'node:http'

export interface ApprovalRun {
  id: string
  person: string
  status: string
  promotion?: string
}

export type Approval = { ok: true } | { ok: false; status: number; reason: string; message: string }

const no = (status: number, reason: string, message: string): Approval => ({ ok: false, status, reason, message })

/** The approval origins for a list of approval page URLs (http://localhost:5184/ and the tailnet's, if served). */
export const approvalOrigins = (urls: string[]) => [...new Set(urls.map((u) => new URL(u).origin))]

/** Conditions 1 to 5, the same for every act. */
function fromAnOperatorOnThePage(req: IncomingMessage, origins: string[], operator: boolean, person: string, run: ApprovalRun | undefined, act: string): Approval {
  if (req.method !== 'POST') return no(405, 'method', 'Only a press of the button counts.')
  if (!operator) return no(403, 'not-operator', `Only the people who look after the house can ${act} a change.`)
  if (!run || run.person !== person) return no(404, 'no-run', "I can't find that change.")
  if (req.headers['sec-fetch-site'] !== 'same-origin' || typeof req.headers.origin !== 'string' || !origins.includes(req.headers.origin))
    return no(403, 'not-approval-origin', "That didn't come from the approval page, so I won't act on it.")
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return no(415, 'not-json', 'Send it as JSON from the page.')
  return { ok: true }
}

/** Keep: put a passed run's candidate into the live home. `named` is the candidate id the page sent. */
export function mayKeep(req: IncomingMessage, origins: string[], operator: boolean, person: string, run: ApprovalRun | undefined, named: unknown): Approval {
  const page = fromAnOperatorOnThePage(req, origins, operator, person, run, 'keep')
  if (!page.ok) return page
  if (named !== run!.id) return no(409, 'not-shown', "That isn't the change on the page, so I've left the home alone.")
  if (run!.status === 'kept') return no(409, 'already-kept', 'That change is already in the home.')
  if (run!.status !== 'passed') return no(409, 'not-passed', run!.status === 'interrupted' ? 'That change was cut off when the house restarted, so it was never checked. Ask again.' : "That change didn't pass its checks, so it stays out of the home.")
  return { ok: true }
}

/** Undo: roll back the promotion this run's Keep made. `named` is the promotion id the page sent. */
export function mayUndo(req: IncomingMessage, origins: string[], operator: boolean, person: string, run: ApprovalRun | undefined, named: unknown): Approval {
  const page = fromAnOperatorOnThePage(req, origins, operator, person, run, 'undo')
  if (!page.ok) return page
  if (run!.status !== 'kept' || !run!.promotion) return no(409, 'not-kept', "That change isn't in the home, so there's nothing to undo.")
  if (named !== run!.promotion) return no(409, 'not-shown', "That isn't the change on the page, so I've left the home alone.")
  return { ok: true }
}

/** Not this: record that the person turned a run down. Nothing changes in the home, but it settles the run. */
export function mayDecline(req: IncomingMessage, origins: string[], operator: boolean, person: string, run: ApprovalRun | undefined): Approval {
  const page = fromAnOperatorOnThePage(req, origins, operator, person, run, 'turn down')
  if (!page.ok) return page
  if (run!.status !== 'passed' && run!.status !== 'failed' && run!.status !== 'interrupted') return no(409, 'not-open', 'That change is already settled.')
  return { ok: true }
}
