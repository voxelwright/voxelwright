---
name: adversarial-review
description: Village's default review for every change. A reviewer examines a frozen commit, and a critic checks the review itself, either agreeing, disagreeing with code evidence, or raising a concern the reviewer must settle with code. Use before a change lands on the integration branch. For privacy, auth, data-model, network, device, firmware or factory-permission changes, use the seven-lens `reviewers` skill instead.
---

# Adversarial review

This skill follows Qiu and Gill, "Adversarial Review: Structured Disagreement
for Grounded Agentic Code Review" (arXiv 2608.18167, ICML 2026 DL4C workshop).
The paper has not published its prompts, so this is our reading of its protocol.
Additions of our own are marked *Village*.

The failure it targets is **false consensus**: agents agree without evidence.
The paper shows two forms. A reviewer hedges and a critic confirms a made-up
bug, or a critic raises a real bug and gives in to an uncited rebuttal. Requiring
typed disagreement backed by code fixes both. On LiveCodeBench it scored 87%
against 82% for a five-agent setup (MARS: one author, three reviewers, one
meta-reviewer). On SWE-bench Verified it scored 75.2% against 72.6%, at about
4.5 times the tokens of a single zero-shot pass.

## Roles

- **Lead** freezes the change, starts the reviewer and critic as fresh
  subagents, and decides at the end. It passes them no builder reasoning and no
  earlier review rounds.
- **Reviewer** reads the diff at the frozen commit and the code around it. Each
  flag cites `path:line` and states the failure: what input or state produces
  what wrong result. Lint, format and typecheck findings don't count. The
  reviewer may run tests or throwaway probes in a separate worktree to support
  a flag.
- **Critic** audits the review, not the author. For each flag, and once for
  anything the review missed, it returns exactly one verdict:
  - `AGREE`
  - `DISAGREE_EVIDENCE: <path:line and why the code contradicts the flag>`
  - `DISAGREE_CONCERN: <epistemic objection, such as an unsupported claim, a
    missed path or an untested assumption>`

## Loop

1. **Freeze.** Commit, then record the SHA. Nobody edits the code during the
   inner loop.
2. **Review.** The reviewer reports its flags, or none.
3. **Critique.** The critic returns its typed verdicts.
4. **Respond.** The reviewer answers each verdict:
   - `AGREE`: keep the flag.
   - `DISAGREE_EVIDENCE`: revise or drop the flag based on the cited code.
   - `DISAGREE_CONCERN`: cite diff code that confirms the bug (keep the flag)
     or cite code that refutes it (drop the flag).
   
   Never drop a flag just to reach agreement, and never approve without a
   citation.
5. **Repeat steps 3 and 4** until the critic agrees, for at most five rounds.
   If they still disagree after five, the lead decides from the cited evidence
   and records the disagreement.
6. **Outcome.** If the converged review has no flags, the change can land.
   Otherwise the builder fixes the kept flags in a new commit, and the loop
   restarts at step 1 with fresh reviewer and critic agents.

## Practicalities (Village)

- Give the reviewer and the critic different models where possible, for
  example Opus and GPT-6.1 Sol, or two different Sonnet tiers for small
  changes, to reduce shared blind spots. This is our addition and is not
  tested in the paper.
- End both agents when their round is done.
- Log both dispatches in `.agents/dispatch-log.jsonl`.
- Record the result in the PR description in about five lines: the SHA, the
  number of rounds, the kept flags and how each was fixed, the dropped flags
  with a reason, and any lead decision.
- Note in the record any unconfirmed result of this protocol on Village
  changes, until we have compared it with the seven-lens review on real
  changes.
