# Native memory and prompt injection — 1.3.2

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
from `bd prime`; inspect the actual formula/hook/context capture. Village's
current `village/runner.py` disables hooks and host skill discovery, uses
ephemeral Codex execution and has no native memory integration.

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
