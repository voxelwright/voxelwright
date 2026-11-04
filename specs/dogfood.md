> Historical proposal from November 3, 2026. Superseded by the owner's
> November 4 request and AGENTS.md. This is not shipped behavior or current authority.

# Village · private dogfood 0.1

## Problem and authorization — 2026-11-02
Pavlo wants a warm, dependable home for ongoing AI work, not disposable sessions or an admin dashboard. Existing Village research establishes persistent relationships and completed responsibilities as the value. The first concrete proof is Pavlo talking with Gilfoyle, returning to that conversation, and seeing an actual maintained responsibility with evidence and repair.

Parent session relays explicit authorization: “Once you complete the design and research, get to building.” Main push and private deployment are authorized. Private repository the private source repository; OpenAI Astra only; no paid spend, public endpoints/Funnel, personal logins, or Anna/Will private data. Parent owns Telegram updates; milestone ledger p-e72400. This is a single-owner engineering dogfood, NOT the full two-adult family release. Broader requirements remain in backlog.

## Existing options and decision (engineering judgment)
Reuse installed OpenClaw as replaceable execution engine and Tailscale Serve as authenticated private ingress. Existing Village research reviewed DSH, GasCity, Overalls and NixOS: none is established as a better tested runtime here; importing a platform or migrating the host would delay proving the core relationship. Overalls stays an experiment candidate, not a dependency. Node 24 built-in HTTP/SQLite plus plain accessible browser components avoid a framework/toolchain install for this small product. SQLite is authoritative for Village messages/jobs/results; OpenClaw maintains bounded execution context. No new model credential store.

## Scope and contracts
- One explicitly allowed owner, one stable Gilfoyle conversation, no family or shared rooms presented as available. Gilfoyle is a privileged engineering assistant, not a private family-data vault.
- Warm, quiet home with genuine latest completed work; prominent honest attention when checks fail. Conversations and responsibilities reachable directly by URL. No fictional family moments, photos, seeded good-news or fabricated results.
- Durable messages written before dispatch, client-generated submission key, one active chat turn, bounded input/history, stable execution mapping. Reload/restart retains user message and operation state. Unknown execution outcome is NOT silently replayed: show reconciliation/recovery, no false completion. Retrying an uncertain action must not duplicate effects.
- Real engine adapter must pin OpenAI Astra and prevent paid/Claude fallback. Source/API experiment determines integration before activation. Auth never reaches browser/model/log. No automatic real-world action retry.
- One useful responsibility: keep an evidence-backed Village readiness check current (app database integrity, writable storage/capacity, engine reachability). Run deterministically on startup and periodically without inference cost; retain latest results/history, failures, last success, next scheduled check, manual recheck. Describe limits: reachability is not proof inference works; permissions and integrations are not inferred healthy. No content inspection needed. This is Gilfoyle's system-stewardship responsibility, not the unimplemented household calendar/mail brief.

## Security / deployment
Existing Ally host, user-level service. Dedicated Unix socket under mode-700 directory; Tailscale Serve HTTPS on an unused port, exact owner identity allowlist, reject absent/wrong identity. Only proxy can reach socket from outside same-user trust domain; same-user/root can read runtime and are trusted, explicitly not technical admin exclusion. Exact allowed Host and Origin checks for state changes; JSON-only writes, bounded body, no CORS; text-only rendering and strict CSP. No public TCP listener or new tailnet grants. Test-only HTTP harness binds loopback with explicitly injected fake engine and same auth checks, never a production bypass.

Inspect and back up existing Serve config and affected files first; add only own port. Separate release directory and mode-700 mutable state; SQLite backup API before upgrade; previous immutable release remains for rollback. Service restart marks active operations interrupted/uncertain, queued requests dispatch safely only if never started. No account/credential access outside own Gateway's approved engine interface. Single writer controls deployment.

## Verification / review
High-risk auth/runtime integration: independent architecture necessity/security review before implementation; independent Sentinel/vendor and Turing review against pinned implementation; independent verification after fixes. Max nine review turns, one correction round per scoped contract. Budget unknown tokens reported honestly. No performance specialist until measurements justify one.

Acceptance: real browser on served app; send real message, reply from Astra, reload and continue; durable responsibility result and recovery; missing/wrong identity, wrong origin/host, oversized body, injection rendering, duplicate submission, concurrent requests, interrupted work/restart probes; fixture and live surfaces labeled. Backup restore probe; Serve tailnet-only proof; no secret in git. A meaningful reviewed main push and deploy with exact commit and rollback path. Failure to prove live engine is a blocker, not a mock substitute.

## Pre-code review dispositions
Independent review: workspace projects/reports/2026-11-02-village-design-review.md. Scope coherent; activation gated, not cleared yet.
- D1 accepted: adapter must inspect effective auth/runtime/provider and fallback policy, fail closed when unauthorized route cannot be excluded. Existing metadata reports Astra primary / OpenAI Luna fallback / OAuth-only OpenAI route; no API-key profile. Establish exact semantics before activation, never global-default edits to make a test pass.
- D2 accepted: uncertain state fences the entire conversation; acknowledgement cannot unlock without authoritative idle/terminal evidence. Dispatch intent precedes send; stable IDs and atomic response+terminal transaction. No automatic re-send at restart.
- D3 accepted: dedicated Village session only; history/reconciliation through sanctioned API, no raw transcripts. Existing engine context/compaction is bounded and fallible; UI does not promise perfect recollection. Retain visible conversation in SQLite, no reinsertion of entire history each turn.
- D4 accepted: 30-minute readiness interval, stale after 65 minutes, each external probe deadline 10 seconds, coalesced check execution, explicit unavailable if saving receipt fails. Last success distinct from last check; database schema version checked; backup API and independent restore proof.
- Ally ingress uses its user wrapper, preserved 9443/10443/22 routes, unused 11443. Update host selftest allowlist narrowly if its current strict list would treat the authorized service as a fault; document before any edit.
