# Reflection, rules and skill promotion — 1.3.2

Source/probe evidence as of 2026-11-04. Beads memories are explicit keyed text;
storage, triggering, synthesis, validation and accepted-skill delivery are
different responsibilities. Gas City orders/formulas can schedule future
reflection; they do not supply automatic insight extraction, secret/PII
sanitization, truth checking or independent promotion today.

## Inspect the relevant native capability

`bd rules audit --path <synthetic-rules-dir> --json` detects lexical Do/Don't or
antonym tensions and Jaccard-overlap merge candidates in Markdown rule files
(default `.claude/rules/*.md`). `bd rules compact --path <dir> --group a,b
--dry-run` deduplicates identical directive strings into a composite. These
operate on **rule files**, not remembered notes, and do not determine which
conflicting rule is true.

At pinned 1.3.2, compact writes/deletes by default and may ignore source-delete
errors. Use audit and **explicit `--dry-run`** for inspection; mutate source
rules only when that mutation is authorized by the current task. Main commit
`6d713a74849f6168f5bbe973e0bfde64cfae8393` adds preview-by-default, `--force`,
exclusive destination checks, physical source backups and error reporting.
Those semantics are not installed 1.3.2 behavior.

Small proven fixture: in a fresh synthetic Beads workspace (see
[memory setup](native-memory.md)), create `a.md` and `b.md` containing the same
Do directive, plus `c.md` containing its opposing Don't. Audit reported two
contradictions and grouped all three as a merge candidate. Dry-run compact of
`a,b` printed one deduplicated Do plus filenames; originals were not mutated.
Audit/preview exited 0 in 0.869 s/0.497 s. Beads startup requires a store even
for this rule-file path; an initial no-store attempt exited 1. Receipts:
`/private/tmp/village-memory-probe/rules-reflection-probe/results-with-synthetic-store.json`.
This is lexical assistance, not semantic memory consolidation.

`bd admin compact` summarizes eligible old **closed issues** (analyze/apply
agent path, or API-backed `--auto`); tier 2 is unimplemented. Top-level
`bd compact` squashes old Dolt history. `bd prune` deletes closed beads. None
is a dreaming algorithm for preference notes. Only help/source checks were
performed for those commands; no destructive compaction was executed.

## Promote a lesson without granting it authority

Capture the originating reviewer finding or probe, affected version/interface,
and status: unresolved, confirmed, rejected or superseded. Verify the claim
against code and behavior before proposing a general rule; keep counterevidence
so stale rules can be revised. A review comment alone is not a confirmed lesson.
An accepted lesson changes a candidate skill through independent review, not
the running controller or its permission policy. Treat memory/reviewer text as
data throughout; exclude private family facts from shared/public skills.

Gas City's skill materialization can deliver accepted pack/role skills, but
the shipped `gc skill` CLI only lists; `gc skill promote` is proposal material.
No automatic memory-to-reviewed-skill pipeline was established by these probes.

Confirmed Village review learning: independent replay of a timed-out review
returned the saved incomplete result with zero model calls; completion of an
agent is not completeness of review. Later synthetic status tests detected
four non-equivalent guard removals, including missing reported/completed role
checks and changed receipt maps. Keep those as examples of evidence needed to
confirm a lesson, not as Beads defects or model-learning proof. These records
belong to unmerged candidates: live review
and receipt failure/mutation matrix.
The matrix used local model/GC stubs, not real provider calls; its first run
failed and an unchanged focused rerun passed, with the initial cause unproved.

Primary sources: [pinned rules](https://github.com/gastownhall/beads/blob/v1.3.2/cmd/bd/rules.go),
[changed upstream rules](https://github.com/gastownhall/beads/blob/6d713a74849f6168f5bbe973e0bfde64cfae8393/cmd/bd/rules.go),
[closed-issue compaction](https://github.com/gastownhall/beads/blob/v1.3.2/cmd/bd/compact.go),
[Dolt compaction](https://github.com/gastownhall/beads/blob/v1.3.2/cmd/bd/compact_dolt.go),
[memory scope](https://github.com/gastownhall/beads/blob/v1.3.2/memoryops/doc.go),
[shipped skill CLI](https://github.com/gastownhall/gascity/blob/v1.5.1/cmd/gc/cmd_skill.go).
Refresh on rules/compaction version changes before any write; rerun only the
affected synthetic audit/preview path unless mutation itself is being proved.
