# Detailed project tracking (Beads 1.3.2)

Adopted November 5, 2026 on `1.3.2 (9b65b9e198ac)`. This bounded
knowledge-upkeep trial uses embedded Dolt with one coordinator performing
updates. GitHub issues own project scope and issue completion. A Beads epic
links back through `external_ref`; child tasks own detailed steps, dependency
eligibility and specialist claims. This adds no bidirectional synchronization,
automatic factory routing, daemon or simultaneous multiwriter guarantee.

The earlier bounded trial's epic is `village-7in`, linked to
GitHub issue 17. Its steps are
documentation authoring, independent review, then private publication/readback.
The coordinator updates task state only when the corresponding evidence exists;
agent completion and a clean review are different milestones. Completing these
steps does not itself close GitHub issue 17.

The later bounded factory handoff uses epic `village-wzd`, linked to GitHub
issue 13. Its six milestones are native grounding, implementation, integration
proof, complete independent review, reviewed documentation, then publication and
final evidence. Review and documentation each depend on integration proof;
publication has explicit dependencies on both. Initial setup/readback used 27
commands in 6.165 seconds and exported 12 issue records. It established the stored
graph and first claim, not later execution. Later transition snapshots bind
actual grounding and implementation evidence; inspect the latest operational
receipt before changing status.

Separate epic `village-7nk` links GitHub issue 15. Its native dependency on this
handoff slice is necessary only: full issue 13 and the independently measured
bootstrap comparison remain required. Closing a narrow slice cannot satisfy the
wider milestone or close its GitHub issue. The explicit all-project export is
now `backups/project-records.jsonl`; the earlier completed-trial snapshot remains
intact. The issue-only and same-host recovery limits below still apply.

These November 5 operational snapshots are preserved with the handoff candidate's
structured handoff receipts. They are evidence records, not
permission, automatic factory dispatch or a simultaneous-multiwriter proof.
Beads claim and actor strings are operational identities, not authenticated
family identities. The pinned [issue validation source](https://github.com/steveyegge/beads/blob/v1.3.2/internal/validation/issue.go#L150-L174)
and the native conditional-ownership probe in that receipt bound this distinction.

The later integration-to-review transition also created independent measurement
task `village-bh7`, with the same GitHub issue 15 reference and no parent or
dependency. It records the bounded source/budget/usage/timing/intervention account;
it is not a qualification prerequisite. The transition's native readback and
13-record snapshot are bound in `docs/.mintlify/factory-handoff-preparation.json`.
This is native task metadata, not automatic GitHub synchronization.

## Native operations and evidence

Use the project-local binary and recorded environment from the coordinator's
operational packet. Do not invoke a different store through inherited personal
configuration. The executed command shapes were:

```sh
bd create "Village knowledge upkeep" --type epic --external-ref the private source record --json
bd create "Prepare documentation" --type task --parent village-7in --json
bd create "Review documentation" --type task --parent village-7in --deps village-7in.1 --json
bd ready --parent village-7in --type task --json
bd --actor documentation-specialist update village-7in.1 --claim --json
bd blocked --parent village-7in --json
bd export --output <snapshot.jsonl>
```

The setup proof created one epic and three tasks in 18 commands, 5.171 seconds.
Only the first task was ready before its specialist claim; afterward none were
ready. The remaining tasks stayed `open` with dependency blockers, rather than
a manually assigned blocked status. Read current state before acting; these
initial results are not a permanent task-status report.

An explicit issue export was physically copied and imported into a fresh
temporary embedded-Dolt fixture with `bd import <snapshot.jsonl> --json`.
Ten commands in 2.323 seconds preserved all four IDs, the GitHub reference,
specialist claim and both dependency blockers. Receipts and sanitized command
records are in [the adoption evidence](../../../../evidence/008-knowledge-upkeep.json).
No live store was restored. JSONL is issue interchange, not a full Dolt backup:
history, branches, working sets and non-issue tables are outside this proof.
A same-host snapshot does not cover host or disk loss. Automatic backup was
disabled for this trial; the coordinator refreshes the restricted snapshot
explicitly after task changes. No periodic export is configured.

## Sources and refresh

Pinned primary sources: [create](https://github.com/gastownhall/beads/blob/v1.3.2/cmd/bd/create.go),
[ready](https://github.com/gastownhall/beads/blob/v1.3.2/cmd/bd/ready.go),
[export](https://github.com/gastownhall/beads/blob/v1.3.2/cmd/bd/export.go) and
[import](https://github.com/gastownhall/beads/blob/v1.3.2/cmd/bd/import.go).
The current upstream export source retains the issue-only backup warning but
adds a remote-backend role read path. That path is outside this embedded trial.
Refresh this reference when the binary, backend, task eligibility, claim or
export/import semantics change; repeat the affected boundary proof before use.
