# Role context, packs and reflection (Gas City 1.5.1)

Source-inspected on 2026-11-04; no model context-effectiveness probe was run.

Use native city/rig `agents/<name>/agent.toml` and conventional `prompt.md` for
roles. `prompt_template`, `inject_fragments`, `append_fragments` and assigned
skills support context assembly. Check runtime inheritance/materialization,
not merely successful TOML parsing. A city is itself a pack; imports can carry
agents, formulas, orders, skills, commands, MCP settings, doctor checks and
assets, with pin/lock metadata. Imported configuration is active trusted
configuration and requires the same review as its local equivalent.

`gc skill list [--agent NAME | --session ID]` reports availability. Inspect the
actual vendor skill sink after an authorized start and use `gc doctor` for
collisions; listing alone does not establish selected precedence or what the
model receives. `gc skill promote` appears in design material but is absent
from the shipped skill CLI, which only provides list.

Provider hooks can invoke SessionStart `gc prime --hook`, pre-compaction
`gc handoff --auto`, and nudge/mail injection. Provider event parity varies.
`gc prime` renders behavior/handoff context; it does **not** itself call
`bd prime` for the separate persistent knowledge plane. Some core formulas
explicitly call `gc bd prime`. Verify the actual selected prompt/formula path
and inspect captured context before claiming knowledge delivery. Gas City's
contributor AGENTS instruction to use `bd remember` is not automatic learning
in deployed agents.

The audited Village factory checkout used `sling --no-formula --no-convoy`
and `agent-script`, bypassing native workflow flow. Those factory files are
absent from the technology-grounding branch at `2da8c21`; inspect the target
checkout before applying that diagnosis. The present `village/runner.py` uses
`codex exec --ephemeral`, disables hooks/project instructions/host skill
discovery, and has no remember/recall/prime integration. Existing worker proof
therefore does not establish native role context or learned preferences.

Orders support cron/cooldown/condition/event/manual triggers and formula or
exec actions. Formula jobs route to pools; exec performs mechanical work in
the orchestrator without an agent. They can trigger a future periodic
reflection workflow, but do not extract insights, adjudicate contradictory
facts, redact private data or promote reviewed skills automatically. Prove
capture → later injection → observed behavior with synthetic data first.

`SanitizeForSystemReminder` strips literal system-reminder tags to a fixpoint.
It does not redact secrets/PII, validate facts or make retrieved text trusted.
Reviewer outputs and memories remain candidate data. A confirmed reusable
lesson needs its originating evidence/status, independent validation and a
reviewed candidate skill change before materialization; it cannot approve
itself or alter trusted policy. Never promote private family facts into a
shared/public skill.

Primary sources: [packs](https://github.com/gastownhall/gascity/blob/v1.5.1/docs/reference/specs/pack-spec.md),
[pack guide](https://github.com/gastownhall/gascity/blob/v1.5.1/docs/guides/understanding-packs.md),
[skill CLI](https://github.com/gastownhall/gascity/blob/v1.5.1/cmd/gc/cmd_skill.go),
[prime](https://github.com/gastownhall/gascity/blob/v1.5.1/cmd/gc/cmd_prime.go),
[provider hooks](https://github.com/gastownhall/gascity/blob/v1.5.1/internal/hooks/config/README.md),
[core knowledge-loading formula](https://github.com/gastownhall/gascity/blob/v1.5.1/internal/bootstrap/packs/core/formulas/mol-polecat-base.toml#L78),
[orders](https://github.com/gastownhall/gascity/blob/v1.5.1/docs/tutorials/07-orders.md),
[sanitizer](https://github.com/gastownhall/gascity/blob/v1.5.1/internal/promptsafe/promptsafe.go).

Audit compared current main `f798826db91f61fb0c8355bb4bcc2917ec7d8624`:
skill CLI/hook vocabulary matched pinned behavior; pack docs added command
environment and rig include pinning documentation. This was a scoped source
comparison, not an upgrade/runtime proof. Refresh on provider hook, pack lock,
skill materializer or memory-injection changes. Detailed original evidence:
`/private/tmp/village-gascity-memory-audit.md` (temporary receipt).
