---
name: lead-orchestration
description: How Voxelwright's lead (orchestrator) agent runs many builder agents at once - taking stock, splitting work, writing briefs, landing, looking at output, and keeping the machine healthy. Use when you coordinate other agents, sweep finished threads, land lane work, or plan parallel work.
---

# Lead orchestration

This skill holds what the leads have learned from running Voxelwright's factory
since November 2026. AGENTS.md has the rules. This skill explains how to follow
them. The evidence is in `~/.village/retro/` (2026-11-20-process.md,
-speed.md, -parts-and-kits.md, 2026-11-21/report.md) and in issue #465.

## Taking stock

- Read what happened before you act. Use `gh pr list`, `gh issue view`, each
  lane thread's final message, and `git rev-list --count` between the branches.
  Check every lane worktree for uncommitted or unpushed work
  (`git status --short`, `git log origin/<branch>..HEAD`). Finished work has
  been stranded before.
- A lane's notes drift from the truth. Check claims against git and against the
  pictures.
- Write the inventory once, as a GitHub issue with three buckets: blocks
  landing, agent follow-ups, owner only. Keep it current, and tick items as they
  land.
- Before you trust a projection, check what bounds it. A worker had capped
  itself at 160 Mapillary requests an hour, while the documented limit is
  10,000 a minute. That cap produced a 65 to 127 day estimate, and the lead
  passed it on.

## Dispatching

- Choose models as AGENTS.md says. In practice:
  - Opus, medium effort: merges and conflict resolution.
  - Opus, high: ordinary building.
  - Opus, xhigh: diagnosis, look-closely passes and retrospectives.
  - Fable, medium or high: the hardest design and engine problems.
  - Sonnet or Sol: clearly specified, mechanical work.
  - Astra, high: when Claude usage runs ahead of the reset. Give it a tighter
    brief.
  - Gemini 4 Neon: on trial across every kind of work, look work included,
    at varied effort (start at high), and only through a route Google's
    terms allow (AGENTS.md). Log the kind, effort, time and outcome.
- Start each unit in a fresh thread (`delegate_task`). Do not send new orders
  into a long, finished lane thread: a 1,900-item thread carries stale context,
  and the owner stopped one. A completed delegate wakes the lead, so don't poll
  it.
- Split work by file, not by topic. Agents that run at once get separate files,
  and each brief says which files are off limits and who owns them. Five agents
  ran together without merge conflicts this way. Two agents that both edit
  `march.ts` or `bay.rs` must run one after the other, or one keeps its change
  small and names it.
- Start dependent work as soon as the work it depends on is pushed. Stack it on
  that branch rather than waiting for the merge.
- One unit per delegate. New owner notes or a second unit go to a fresh
  delegate, stacked on the pushed branch, never queued into a running turn. On
  Nov 21 a lane ran as one turn for over six hours, kept alive by polling loops,
  so the lead's queued messages reached it 53 and 150 minutes late.
- Check file ownership at dispatch, against the lanes already running. On
  Nov 21 three lanes all edited `boards.ts`, `boards.json` and `sf-boards.mjs`.
  That cost four conflicted rebases and four failed budget runs.
- A brief is the agent's only context. It contains:
  - the repo, the worktree path and the branch;
  - the current state, with numbers;
  - a numbered list of tasks;
  - what proves the work, as commands. Iterate with `--changed` checks, and
    run the full suite once, on the head you report. On Nov 21 the full suite
    reran after every change: up to 15.6 of 40.8 lane-hours;
  - done means proven. The report needs a before/after crop at the same camera
    for each owner note, and its `npm --prefix engine run sf` bytes against main. Before the
    report, a fresh agent hunts for defects in the shots;
  - end the turn while checks run: run them in the background and wake on the
    notification, with no polling loops or long foreground timeouts;
  - constraints: off-limit files, the shared GPU, disk, and Mapillary photos
    kept out of git and public posts;
  - commit format: `[#issue] change`, no co-author lines;
  - a short reply format with a line limit.
- Have each agent make its own worktree from the right remote branch
  (`git worktree add <path> -b <branch> origin/<base>`). The root checkout is
  old and detached. Never build in it.
- Run the lead itself from a checkout that is current with main, not the root
  checkout. The root checkout is at a Nov 6 commit with no `.claude/hooks`, so
  the dispatch-log hook never fired for the lead's 13 dispatches on Nov 21.
- Ask for the lane's open questions and requests to other lanes, and route each
  one within an hour. Requests left in issue comments went unanswered for 8 to
  10 hours.

## Looking closely

- Open every picture at full size before you relay it, and put it in the
  report. The owner was the first to name six visible faults in 14 days. Each
  of them was visible in pictures the lead had passed on.
- A gate must read the output itself. `panel_gate.py` used to compare a scores
  file written by the builder against the first baseline. The baseline already
  had the Nob Hill pillars, ribbed walls and narrow windows, so they passed for
  a day.
- Judge a baseline independently before it becomes a floor.
- Every fault the owner finds becomes a check that fails on the old output.
  Prove that before trusting it: round 1's banding and window measurements did
  not tell the old render from the new one.
- When a fix changes how something looks, ask for before and after shots at the
  same camera, next to the reference.

## Landing

- Ship to main behind a switch. No branch runs more than a day or 15 commits
  ahead. The #450 integration branch reached 96 commits ahead while main moved
  226, and every lane PR then had six or more conflicts.
- Merge lane PRs into the integration branch as soon as they are green. A
  known, owned failure (for example a byte budget another agent is fixing)
  does not block an unrelated merge. Record it in the inventory.
- Regenerate generated files from merged code. Don't hand-merge them.
- Before merging into main, run the full gate on the combined tip, one check at
  a time: the realm's own checks, `npm run check`, and the kit gates, since the
  kit draws with the engine's renderer.
- Read the diff against main before merging, and keep both sides of each
  conflict.

## The machine

- There is one GPU, and every page check takes a turn (`engine/test/kit.mjs`,
  `ENGINE_TURNS`). Never wrap a check in a private lock: on Nov 21 one waited
  90 minutes on its own parent. Rerun a red page check once, and keep its output, before
  calling it a regression. Nine checks fail under load. Track this in #465
  rather than retrying forever.
- Disk: `scripts/hygiene.sh` runs hourly from launchd. It removes clean, merged
  worktrees and alarms below 60 GiB free. Long data jobs (the city bake, facade
  paint) keep their own reserve and run from pinned copies under
  `~/.village/engine/bay`, so landing PRs doesn't disturb them.
- Long jobs hand off at a checkpoint boundary: drain, verify the checkpoints,
  restart on the new code, then verify the first unit after the restart.

## Generalizing fixes

A defect seen in one building is usually a rule that many buildings share.
Examples: a pole rule that made 25,132 rods, a wall texture, a window width.
When a fix lands:
- find every other place the same part or material is defined;
- fix the shared rule, not the instance;
- check a sample of other places, not only the one the owner pointed at.

The parts-and-kits report (`~/.village/retro/2026-11-20-parts-and-kits.md`)
proposes how to structure parts so that one edit reaches every use.

## Reporting to the owner

- Lead with the result, then what you checked, then what is still wrong. Embed
  the picture.
- Bring results and things to try, not permission questions. When something is
  his to decide, ask once, with a recommendation.
- Things only the owner can do go in one batch at the end: a real phone,
  listening, uploads to Cloudflare, taste vetoes.
