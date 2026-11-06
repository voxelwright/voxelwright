# Native workflow and execution (Gas City 1.5.1)

Evidence date: 2026-11-04. Adopted `gc version`: 1.5.1. Tag resolves to
`4f698fe2a7eefae49e545c5e38189f1b63fb9b39`; a version string alone does not
attest binary build provenance. Local source inspected at
`/private/tmp/village-gascity-spike/gascity-1.5.1`.

## Choose the native path

Use v2 formulas (`[requires] formula_compiler = ">=2.0.0"`) for durable stages,
explicit `needs`, role/pool routing through `gc.run_target`, and generated
finalization. Use `[steps.check]` for bounded check/repair and `[steps.retry]`
for transient failures. Required verification/reviewer work must not use
`soft_fail` as successful coverage. Native graph control does not provide
Village's trusted evaluator, seven reviewer prompts or immutable head binding.

Execution choices confirmed in source, not exercised with a live model here:

- Normal Codex/Claude harness configuration supports the standard agent route
  through tmux or supported transports. Configure the actual model and prompt.
- A direct `start_command`, `prompt_mode = "none"`, `lifecycle = "one_shot"`
  and accurate `process_names` supports a deterministic adapter that claims
  work with `gc hook --claim --json`. Custom provider command/args is another
  standard interface; preserve Village's scoped environment.
- The subprocess runtime persists detached process metadata/socket state. No
  generic five-minute process lifetime limit was found. It lacks interactive
  attach/input steering and meaningful activity tracking.
- `gc agent-script` is an experimental examples/demo runner with a **five-minute
  action timeout**, not a platform-wide execution limit. Runtime protocol
  operation timeouts are also distinct from launched agent lifetime.

`drain` decomposition, worktree ensure/verify, durable restart recovery and
orders exist in source. Test the selected path before relying on it. Use host
managed worktrees for Village probes. Control-plane recovery does not establish
exactly-once pushed commits, mail or other external effects.

## Pinned traps that change a decision

| Observed fact | Apply it narrowly |
| --- | --- |
| High-level guide advertises `tally`; v2 spec and CLI reject it. | Supply a small trusted vote aggregator/check; do not use removed syntax. |
| `until` compiles one iteration; no runtime consumes its loop label. | Use a v2 check loop for bounded repair. `gc converge` is v1-only. |
| `needs = [parent]` does not wait for every child. | Enumerate required leaf lanes explicitly, including all reviewers. |
| Unknown step keys can be ignored; var `type` is parsed without validation. | Inspect the cooked graph, probe blocked progression, and validate evidence/manifest types in the trusted adapter. Required/enum/pattern validation does exist. |
| `waits_for` creates blocking edges; any/all child modes are inert. | Do not depend on those modes for fan-in. |
| Formula gates materialize real blocking beads. | They are not authenticated human approval. |
| Core `gate-sweep` checks timer/GitHub gates, but `stepToBead` omits formula gate await fields. | Do not claim no watchers exist; formula-gate interoperability with those watchers remains unproved. |
| `cook --attach` has split-store/city-scope refusal cases. | Test the actual graph storage topology before grafting. |
| File-store ready projection has a parity waiver. | Its readiness result is not proof of bd-backed production behavior. |

## Small executable recipe

The completed audit used the installed binary at
`/private/tmp/village-gascity-default-spike/bin/gc`, physically copied with
`shutil.copy2` into an independent synthetic fixture; assert unequal inodes
before editing either copy. Never hard-link an executable or copy login files.
Use a fresh temporary city, not a running city. Set only this environment:

```text
PATH=/usr/bin:/bin:/usr/sbin:/sbin
GC_HOME=<scratch>/state
XDG_RUNTIME_DIR=<scratch>/runtime
XDG_CONFIG_HOME=<scratch>/config
GC_BEADS=file
GC_DOLT=skip
GC_BOOTSTRAP=skip
GC_SESSION=fake
```

Create `city.toml` with `[workspace] name = "synthetic-workflow-audit"`,
`[beads] provider = "file"`, `[session] provider = "fake"`. Declare an agent
`control-dispatcher` with `start_command = "gc convoy control --serve --follow
{{.Agent}}"`, `prompt_mode = "none"`, `process_names = ["gc"]`,
`max_active_sessions = 1`. Declare `investigator`, `author`, `verifier` and
`reviewer` agents with `start_command = "true"`, `prompt_mode = "none"`.
These declarations satisfy cooking; no dispatcher or model is started.

Create `formulas/synthetic-change.toml` with the v2 requirement above. Use
`[[steps]]` ids `investigate`, `author`, `verify`, `review`, `held`, titles of
your choice, explicit predecessor `needs` and `metadata = { "gc.run_target"
= "<role>" }` on the first four. Set `[steps.gate] type = "human"`,
`id = "owner-release"` on held. Run each as a separate process:

```text
gc --city <scratch>/city version
gc --city <scratch>/city formula show synthetic-change
gc --city <scratch>/city formula cook synthetic-change --json
gc --city <scratch>/city ready --json
gc --city <scratch>/city ready --json
```

Acceptance: seven compiled steps including gate/finalize, eight stored beads
including root, identical persisted ready results in fresh processes, only
investigate among **routed** ready steps; author/verify/review/held absent.
The unrouted workflow root also appeared ready. Negative case: add a formula
with `[steps.tally] strategy = "unanimous"`; `formula show` must exit nonzero
with `tally was removed`. Cook must reject undeclared role targets or an absent
dispatcher. Extend with a real failed-check/restart probe when adopting those
unexecuted paths.

Recorded result: PASS, six CLI calls, 2.979 s total CLI time (~4.865 s whole
fixture). This proves compilation, graph persistence and initial dependency
gating only; no live model, repair loop, controller restart or production bd
store was tested. Original receipts/procedure:
`/private/tmp/village-gascity-workflow-probe/{probe.py,results.json}` and
`/private/tmp/village-gascity-workflow-audit.md` (temporary audit artifacts,
not prerequisites for applying this recipe).

## Executed v2 retry, restart and scoped failure, November 5

R6 exercised Gas City 1.5.1 / Beads 1.3.2 / Dolt 2.2.0 on actual Ally Linux,
using standard subprocess/one_shot agents with deterministic adapters and the
native providerless core dispatcher. The incorrect first artifact (7) was
rejected by an independent native exec check; native attempt two stayed held
before its artifact effect. Native supervisor stop/start resumed that same bead
in a new process without replaying the first effect. Artifact 12 then passed;
two explicitly required leaves executed and closed pass. Exact gate/held/root
readbacks stayed open, and held was absent from ready. A separate max-one check
failed its required scope/root and closed downstream leaves skipped without
execution. This supersedes the small recipe's execution limits for these narrow
bd-backed paths, not its recorded historical result.

Apply the observed contracts:

- PackV2 uses `agents/<name>/agent.toml`, not inline legacy agent tables. Assert
  effective provider/store/session configuration before cooking. Reuse the core
  providerless dispatcher; a scripted duplicate is not its native identity.
- Generic external Dolt initialization needs complete endpoint/database inputs
  through the supported direct/external selectors. A legacy host/port stanza
  alone did not initialize the pending scope. Reusing persisted native binding
  after removing one-shot init inputs proves binding reuse, not isolation.
- Bind effects to exact claim root/route/iteration/step facts and cook
  `id_mapping`. Initial and retry reference namespaces differ in pinned source;
  a prefix match misclassified the first attempt. Do not dispatch by substring.
- `needs` waits for closure, not successful outcome. Required failure propagation
  in the executed formula uses scope membership plus `gc.on_fail = abort_scope`.
  Explicitly name required downstream leaves for fan-in.
- Beads default list hides gates even with `--all`; use `--include-gates` and
  exact gate/held/root `show` plus blocking-edge/ready checks. Wire type is
  `issue_type`. A human gate proves blocking, not authenticated approval.
- `hook` may return exit 1 with exact `ok=true/action=drain/reason=no_work`.
  Classify that supported drain separately; malformed replies, work exit 1 and
  operational claim errors remain errors and cannot count as completed work.
- `supervisor stop` is asynchronous unless `--wait` is requested. Await native
  settlement and supervisor exit before fallback; keep the fixture's Dolt alive
  until residual native clients settle. R5 passed functional checks but failed
  overall with exits `[0,130]` and one SIGKILL after a repeated shutdown request.
  R6's supported stop/wait order produced `[0,0]`, Dolt 0 and no residual cleanup
  errors. Preserve timeout/nonzero/SIGKILL/survivor outcomes as failures.

R6: 187.541 native seconds, 188.903632305 outer seconds, 76 native commands,
20 passing Linux controls, zero model calls. This is actual native orchestration
with synthetic executables, not a model integration, seven-reviewer proof,
interrupted-verdict recovery, family boundary or complete issue 13/15 workflow.
[Evidence and replayable payload](../../../../evidence/017-native-formula.md)
bind the original manifests, full failure history, source hashes and limits.
The copied payload's pending-R6 status predates the separately bound PASS.

Pinned source remains `4f698fe2a7eefae49e545c5e38189f1b63fb9b39`. Current upstream
`8e75c50aa84540eaaf185db3cb9b103d04d6aa3f` adds logical-settled recovery and
unlaunchable-checker drift handling in `internal/dispatch/ralph.go`; these are
source-only, unadopted fixes. Refresh the probe before relying on those boundaries.

## Native dependent review handoff, November 5

The installed **bd-backed** Gas City 1.5.1 / Beads 1.3.2 fixture kept a routed
review task unclaimable while its author prerequisite was open or deferred;
closure made it ready. Fresh-process readback retained the edge. Plain
`sling --no-formula --no-convoy` records the route without removing dependencies.
This executes the actual provider path and supersedes the earlier file-store
probe's limit for this narrow dependency behavior. It does not validate a whole
v2 repair formula or every store.

Use the native ready/hook path for dependency eligibility. Source inspection
shows that a direct Beads `--claim` does not itself enforce dependency readiness;
do not substitute it for the exercised hook path. Persist a known dependent ID
before creation. If create or route acknowledgment is lost, reconcile that exact
ID's metadata, edges and route before continuing. The actual-effect probe created
one ID, recovered dropped acknowledgments and rejected changed intent metadata
with zero model calls.

Village's unmerged adapter binds verified receipts before conditionally closing
the author prerequisite and checks native state again before dispatch. An actual
empty-owner conditional update rejected a foreign holder and left it deferred.
Beads actors/assignees are caller-asserted strings, not authentication. Distinguish
the adapter's `gc bd update --if-assignee ... --if-status ...` passthrough from
Gas City's library `BdStore.Close`, which adds `--force`. The later upstream
Beads close-guard change is source-only and is not installed 1.3.2 behavior.

The real synthetic handoff at `a78fdbe` completed seven independent reports and
remained held. Restart and explicit same-round replay preserved author/model
receipt hashes. The saved review result and following native status update are
separate observations; the proof waits for canonical settlement. The first
observer failed overall by reading between them and remains a failed receipt.
The final proof-only oracle at `52303fc` rejected known early-termination and
custom-equality cases, but the separate targeted boundary audit remained
incomplete. These controls establish no general Python security boundary.

Evidence: handoff record
and its linked structured receipts in the handoff candidate,
with distinct runtime `6a530ac`, real-model `a78fdbe` and final-checker `52303fc`
heads. Pinned sources: [route](https://github.com/gastownhall/gascity/blob/v1.5.1/cmd/gc/cmd_sling.go#L750-L781),
[hook readiness](https://github.com/gastownhall/gascity/blob/v1.5.1/cmd/gc/cmd_hook_claim.go#L449-L457),
[known-ID create](https://github.com/steveyegge/beads/blob/v1.3.2/cmd/bd/create.go#L548-L595),
[conditional update](https://github.com/steveyegge/beads/blob/v1.3.2/cmd/bd/update.go#L887-L932),
[library close](https://github.com/gastownhall/gascity/blob/v1.5.1/internal/beads/bdstore.go#L2696-L2702)
and [unadopted upstream close change](https://github.com/steveyegge/beads/commit/6d27a4f96e7fb74e2db516d7be9c80475f59dbef).

## Explicit completed-round adoption

Village's native-adoption candidate
uses `review-adopt --round ... --reason ...` to settle one already completed
follow-up into a held native review task. Journal selection/report/prompt/event
hashes and previous pointers before the effect; require native readback and
local settlement before repair admission. Recheck reports after acknowledgement.
After an applied update loses its acknowledgement, reconcile from native
readback without a duplicate effect or model call. Default replay preserves the
adopted pointer. One immutable
adoption per native review task is the bounded lifecycle, not an adoption chain.

Actual Gas City 1.5.1 / Beads 1.3.2 proof at runtime `58848eb` used generated
providers: one adoption effect, zero extra updates during dropped-acknowledgement
reconciliation and zero live models. It proves admission only; a separate local
synthetic gate completed a repair. The later test-only `96bfa5b` adds a regression
that rejects changed report bytes immediately after native acknowledgement;
removing the existing recheck fails the intended assertion. Runtime is unchanged.
Status/assignee guards are not a metadata revision compare-and-swap against an
external writer retaining both. Inspected upstream `--if-revision` is source-only
and unadopted. This candidate proves no whole formula workflow or release.

## Confirmed adapter lessons

These are confirmed Village integration lessons, **not native Gas City bugs**.
They come from unmerged candidates, not a primary-branch release. Preserve the
requirements when replacing coordination with formulas:

- Independent review reproduced a candidate `subprocess.py` shadowing the
  inline verifier and exiting before assertions. Isolated trusted execution
  plus an exact post-assertion completion marker rejected that bypass; the
  canonical returned Git tree passed. Keep check code/imports independent of
  candidate control; exit zero alone is insufficient.
- Recovery probes reproduced inherited `GIT_DIR` redirecting a ref update and
  repository-configured hooks/filters running candidate-controlled commands.
  Bind trusted Git operations to the exact checkout with a scoped environment
  and validate active repository configuration. Native workflow reuse does not
  remove these adapter boundaries.
- A timed-out reviewer left the live round incomplete. Repeating that same
  round returned the identical result in 55 ms with zero model calls. A new
  round is an explicit reviewed action, not automatic replay of uncertain work.

Immutable evidence: factory verifier/config/recovery record,
live review record
and orchestration-only limits.
Their measurements remain scoped to the stated fixtures, hosts and commits.

## Primary sources and refresh

Read the normative [v2 specification](https://github.com/gastownhall/gascity/blob/v1.5.1/docs/reference/specs/formula-spec-v2.md)
before the [formula guide](https://github.com/gastownhall/gascity/blob/v1.5.1/docs/guides/understanding-formulas.md).
Use [agent configuration](https://github.com/gastownhall/gascity/blob/v1.5.1/docs/guides/configuring-an-agent.md),
[configuration reference](https://github.com/gastownhall/gascity/blob/v1.5.1/docs/reference/config.md),
[subprocess runtime](https://github.com/gastownhall/gascity/blob/v1.5.1/internal/runtime/subprocess/subprocess.go),
[agent-script timeout](https://github.com/gastownhall/gascity/blob/v1.5.1/cmd/gc/cmd_agent_script.go),
[gate conversion](https://github.com/gastownhall/gascity/blob/v1.5.1/internal/molecule/molecule.go)
and [file-store waiver](https://github.com/gastownhall/gascity/blob/v1.5.1/internal/beads/filestore_test.go).

Audit comparison found main and v1.5.1 diverged (main ahead 1,445/behind 172);
it was not an audit of all intervening commits. The queried main guide still
advertised tally. Recheck current source at adoption rather than silently
substituting current docs for pinned runtime behavior.
