# Native memory and prompt injection (Beads 1.3.2)

Evidence date: 2026-11-04. Executed version:
`1.3.2 (9b65b9e19: 9b65b9e198ac)` using
`/private/tmp/village-gascity-default-spike/bin/bd`. These facts cover the
keyed-memory slice, not all Beads behavior.

| Native interface | Decision-relevant behavior |
| --- | --- |
| `bd remember "text" --key K` | Explicit key creates or transactionally replaces the current value. |
| `bd recall K --json` | Current value; a missing key returns `found=false`, exit 1. |
| `bd memories [term] --json` | Enumeration or case-insensitive substring search across key/value; JSON includes `schema_version`. No semantic ranking demonstrated. |
| `bd forget K --json` | Deletes the exact current record. Does not prove purge from Dolt history, prompts, logs, exports or replicas. |
| `bd prime --memories-only` | Standard prompt-text injection, including workspace memories with custom PRIME.md. Also supports `--hook-json`, `--no-memories` and count/byte caps. |

Prime source emits alphabetical memory order and can elide entries; at least
one whole entry is emitted even if it exceeds the byte cap. Do not treat that
cap as a hard output-size/security boundary. Memory API fields are
key/content/search in one workspace namespace, not person/audience/provenance
or consent enforcement. Content validation rejects whitespace-empty values;
otherwise it preserves text. Native merge conflict handling is not a semantic
truth adjudicator.

Persistent task state and retained provider sessions are other planes. Memory
commands do not extract useful insights automatically. `gc prime` is separate
from `bd prime`; inspect the actual formula/hook/context capture. The original Village
bounded worker disables hooks and host skill discovery and uses ephemeral Codex
execution. The separate selected-memory candidate adds explicit readonly recall
before authoring, as described below; it does not add automatic memory capture.

## Village selected-memory candidate, November 5

PR 25 snapshot
records an unmerged, held candidate. The operator selects native store, key,
exact value digest and repository/version scope. A fresh
`bd --readonly recall KEY --json` reads the record. Admission checks shape,
confirmed status, declared scope and byte/time limits before launch; source and
validation fields remain unauthenticated declarations, with no truth/age check.
The selected value and effective prompt are saved before the exclusive attempt
marker and bound through verification, reconciliation, handoff and review.
Prior attempts retain their bound snapshot after current-record deletion;
new tasks require the current digest and never borrow a prior task's snapshot.

Actual Beads 1.3.2 and embedded Dolt proved explicit store selection,
replacement/current recall, forgetting and missing-store refusal in fresh
synthetic workspaces. The separate earlier reader probe does not prove the
complete final flow. Four authenticated CLI authors at `7404d1b` demonstrated
supported abstention, initial preference, correction and one malicious-text
case in a 78.680-second bounded driver run. The raw driver result remains
`UNMEASURED_MANUAL_AUTHORITY_ASSESSMENT_REQUIRED`; a separate independent
assessment accepted the four narrow behaviors. GC status used receipt doubles,
with no real reviewers or new native routing proof. The baseline queried host
MCP catalogs and saw widget/skill metadata despite disabled apps; no personal
read or external write was observed, but model-visible context was not wholly
synthetic-only. This proves no family privacy or general injection resistance.

The 164-test full suite and actual authors belong to `7404d1b`; 138 affected
tests belong to runtime repair `91b2f48`, which rechecks the snapshot after an
awaited independent reconciliation check. Test-only `b837ebd` closes the latest grouped admission-contract coverage gap
with otherwise-valid record declarations, exact record/reply byte limits and
controller-store controls. Its 16-test focused flow passed on macOS/Python
3.13.2 and Linux/Python 3.14.6; the different environments establish no
controlled speedup. All nine runtime/script files remain unchanged. The coordinator reports all six affected R5 lenses clean at `444b0f0`, retaining
Codd’s clean R2 at `212f799` for unchanged production/persisted contracts. GitHub
shows the candidate ready and unmerged. The source evidence predates this final
review outcome. Consult the exact versioned evidence before
using a later candidate; no source merge or release is established here.
Capture/correction/forgetting stay manual; automatic extraction, dreaming,
semantic ranking, audience ACLs and complete history erasure remain unproved.

## Repeat the small proof when the path changes

Use the actual installed `bd`, with fresh independent temporary workspace,
home/config/cache/Dolt root and synthetic Git/Dolt identity; no remote, no
personal login/config copy. Invoke each operation as a fresh process with an
explicit environment. On this macOS arm64 machine `/usr/bin/git` hit Apple's
developer-tool shim timeout; direct Xcode Git worked. Adapt that path to the
host, rather than treating the shim as a Beads failure.

Minimal environment used:

```text
PATH=/Applications/Xcode.app/Contents/Developer/usr/bin:<bd-bin-dir>:/usr/bin:/bin
HOME=<scratch>/home
TMPDIR=<scratch>
DOLT_ROOT_PATH=<scratch>/doltroot
XDG_CONFIG_HOME=<scratch>/config
XDG_CACHE_HOME=<scratch>/cache
GIT_CONFIG_GLOBAL=/dev/null
GIT_CONFIG_NOSYSTEM=1
GIT_AUTHOR_NAME=VillageMemoryProbe
GIT_AUTHOR_EMAIL=memory-probe@example.invalid
GIT_COMMITTER_NAME=VillageMemoryProbe
GIT_COMMITTER_EMAIL=memory-probe@example.invalid
USER=VillageMemoryProbe
NO_COLOR=1
```

Create `<scratch>/doltroot/.dolt/config_global.json` with synthetic `user.name`
and `user.email` matching above. In the fresh workspace, run:

```sh
git init --initial-branch=feature/memory-probe
bd init --prefix memprobe --non-interactive --skip-agents --skip-hooks
bd metrics off
bd remember 'Prefer concise status reports for this synthetic project.' --key status-style --json
bd prime --memories-only
bd recall status-style --json
bd remember 'Prefer detailed status reports for this synthetic project.' --key status-style --json
bd prime --memories-only
bd memories DETAILED --json
bd forget status-style --json
bd prime --memories-only
bd recall status-style --json
```

Acceptance: first action `remembered`; first prime/recall contains concise;
second action `updated`; next prime contains detailed and excludes concise;
uppercase search finds only `status-style` apart from schema metadata; forget
reports deletion; final prime excludes detailed; final recall is `found=false`
and exit 1. Do not retry that expected nonzero result as infrastructure failure.
All store mutations above are confined to the fresh synthetic fixture.

Recorded PASS: 12 setup/memory commands, 32.394 s total; nine memory operations
10.586 s, plus a successful version command. Embedded Dolt persisted across
independent CLI processes. This proves storage/correction/current-record
deletion and prompt-text injection, not model effectiveness, automatic
extraction, family isolation or history purge. No executable copy/edit was
needed; the installed binary was only executed.

Original temporary receipts:
`/private/tmp/village-memory-probe/run_probe.py`,
`/private/tmp/village-memory-probe/native-rtetblw6/results.json`,
`/private/tmp/village-gascity-memory-audit.md`. They record the audit; this recipe
does not require those files to remain present.

## Primary sources

Use pinned [memory CLI](https://github.com/gastownhall/beads/blob/v1.3.2/cmd/bd/memory.go),
[prime](https://github.com/gastownhall/beads/blob/v1.3.2/cmd/bd/prime.go),
[memory operations](https://github.com/gastownhall/beads/blob/v1.3.2/memoryops/memories.go),
[storage operations](https://github.com/gastownhall/beads/blob/v1.3.2/internal/storage/memoryops/memories.go)
and [API](https://github.com/gastownhall/beads/blob/v1.3.2/internal/memoryapi/memoryapi.go).
The audit also checked [current remember documentation](https://github.com/gastownhall/beads/blob/main/docs/cli-reference/remember.md);
do not infer other main behavior from that scoped comparison. Recheck actual
source and rerun the affected synthetic operations on version/backend changes.
