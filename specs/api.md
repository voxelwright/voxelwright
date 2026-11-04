> Historical proposal from November 3, 2026. Superseded by the owner's
> November 4 request and AGENTS.md. This is not shipped behavior or current authority.

# Dogfood browser/server seam v1

All routes require owner identity and exact configured host. Mutation requires matching Origin and application/json. Production has no TCP listener. Response errors: {error: plain-language message}; no stack/credential output.

GET /api/state -> {owner: {name: 'Pavlo'}, assistant: {name:'Gilfoyle', role:'Founding elder'}, conversation: {id:'gilfoyle', messages:[{id, role:'user'|'assistant', text, createdAt}], operations:[{id, state:'queued'|'running'|'completed'|'uncertain'|'failed', createdAt, error:null|string}]}, responsibility:{title, description, intervalMs, nextRunAt, running:boolean, runs:[{id, state:'completed'|'attention', startedAt, completedAt, checks:[{name,ok:boolean,detail}], summary}]}, version:string}

POST /api/messages {id: UUID client submission key, text:string} -> 202 {id,state}; duplicate same id/text returns existing operation, conflicting text ->409. One active/uncertain operation blocks new submission with 409 until resolution. Empty/oversized text ->400. Requests return immediately, client polls state while pending; retained input on HTTP failures. Browser reuses submission id for uncertain network result, not creates another request blindly.

POST /api/operations/:id/reconcile {} -> {id,state}; read-only engine reconciliation, no redispatch. If irreconcilable, state remains uncertain with explanatory action. POST /api/operations/:id/acknowledge {} -> {id,state:'failed'} is permitted only after adapter proves remote idle/terminal; explicit acknowledgement alone never releases an uncertain active run. It is not retry. UI must explain effects may have occurred and no task is resent.

POST /api/checks {} ->202; schedule same deterministic readiness check (no model cost); if running return same operation, not duplicated. Latest check is visible on home and responsibility detail, never infer global health from it. Date strings are ISO timestamps. GET state only returns this owner's app conversation, never imported Gateway history. No delete/share/upload routes in 0.1.

UI routes hash-based #home, #conversation, #care. Render message/result strings via textContent; no markdown HTML injection. Periodic refresh retains focus, draft and scroll; send status polite live region, errors clear and actionable. Respect reduced motion, keyboard focus and 200% zoom/mobile. Empty home is welcoming without claiming completed work. No offline cached private content/service worker. Draft may persist in sessionStorage with clear single-owner privacy boundary, but server is source of accepted messages.
