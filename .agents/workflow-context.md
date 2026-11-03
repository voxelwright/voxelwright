# Workflow Context
## Repository
- Single project; intended default main. Remote default remains setup-verification-20261103T004156Z until GitHub admin changes it.
- Worktrees: .worktrees/ (ignored). Areas: src server/adapter; public browser UI; test fixtures; deploy service; specs decisions.
## Specs & Docs
- Specs: specs/. Read specs/dogfood.md and README.md. Existing design evidence lives in administrator workspace projects/family-harness/; synthesize, do not redo.
## Tickets, Branches, Commits
- Tracker: specs/backlog.md until dedicated API authentication exists. No personal GitHub login.
- Branches feature/<slug>; conventional commits. Local author preconfigured by owner; omit AI trailers.
## Gates
- node --test; node --check src/server.mjs; git diff --check.
- Browser/live engine, auth and recovery verification required before release. No CI configured; local gates mandatory, no remote-CI claim.
## Local Environment
- Node 24.22.1 built-ins; node src/server.mjs. Production Unix socket; fixture server loopback only.
- One shared private deployment; lead is sole deployment driver. Tests use temp dirs/fake engine only.
- Credentials: no repository secret files; existing engine auth stays outside repo and browser. Never copy personal credentials.
## Pull Requests
- GitHub the private source repository. Main push and deploy explicitly authorized for this task; no PR/API access yet.
- Protection/settings unknown, not disabled; no auto-merge. Auth/runtime/deploy high-risk independent review; UI standard; docs tiny.
## Autonomous Sessions
- OpenClaw native workers, OpenAI GPT-6 Astra only, no paid fallback. 2 build lanes plus independent risk-routed reviewers, nine review turns maximum per release scope.
## Safety
- Lead may deploy existing-host tailnet-only release and push main; push triggers no configured deployment.
- No paid spend, public endpoints, Funnel, personal accounts, Anna/Will data or credentials. Root/same-user privacy limitations must be explicit.
- No host migration. Inspect config, back up first, scoped changes and rollback; no global prune, no kill-by-pattern, no shared stash mutation.
## Unconfirmed
- GitHub API settings/default branch require dedicated admin/API auth; not a build blocker.
