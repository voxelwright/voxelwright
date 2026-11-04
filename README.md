# Village

A home for a family and its agents, with a software factory at its core.
Village should help people care for each other, carry projects through, and
grow new capabilities. The interface will draw from warm, lived-in rooms,
workshops and growing plants. The home experience is not built yet.

The first implementation is a local coding worker with independent command
verification. It edits a separate candidate directory using the operator's
existing Codex login. The controller chooses the check before the agent runs;
a successful model turn alone cannot pass it. Passing checks produces
`awaiting_review`, never an automatic merge or deployment.

## Try the worker

Requires Python 3.13+ and a Codex CLI supporting permission profiles,
`exec --ignore-user-config`, and the features in `village/runner.py`.
The measured Mac run used Codex `0.166.0-alpha.6` bundled with ChatGPT.
There are no Python package dependencies.

Create a separate candidate directory and a task text file. The candidate
must not contain the running Village controller or project Codex configuration.
The output directory must be new and outside the candidate. Then run:

```sh
python3 -m village \
  --workspace /absolute/path/to/candidate \
  --prompt /absolute/path/to/task.txt \
  --output /absolute/path/to/new-evidence \
  --codex /absolute/path/to/codex \
  --check /bin/sh -c 'test "$(/bin/sh greet.sh)" = "Hello, Village!"'
```

`--check` is the final option. Its arguments come from the trusted operator,
not the model. Results, model events and command output stay in the evidence
directory. Failed execution or verification exits nonzero. Startup errors
raise an exception and leave any existing evidence intact. Interrupted jobs
are not automatically resumed or replayed.

## Verify changes

```sh
python3 -m unittest discover -s tests -v
python3 -m compileall -q village scripts
git diff --check
```

The live Mac proof uses the real CLI and existing login. It first demonstrates
that the check rejects a broken program, asks the agent to repair it, runs the
same check, and probes denied sibling access, protected configuration writes
and direct TCP access:

```sh
python3 -m scripts.prove_runner --codex /absolute/path/to/codex
```

After green gates, use the supplied [reviewer skills](.agents/skills/reviewers/SKILL.md).
Local measurements and review status live in [evidence](evidence/001-worker.md).

## Current boundary

This is a synthetic-data development slice, tested on macOS arm64. Linux
operation, family isolation, durable job recovery, richer runtime permissions
and the family interface remain unproven. Gas City's supported Beads/Dolt path
is being tested as the factory coordinator. Temporal's separate persistence
experiment passed; neither experiment establishes the final stack.

Worker commands receive workspace access and Codex's minimal OS runtime reads.
Sibling files, ordinary network access and protected control directories are
denied by the named Codex permission profile. The runner filters environment
variables and disables automatic instruction loading, connectors, hooks,
host skill discovery and subagents for this role. System-managed Codex settings
still belong to the operator; this does not sandbox the authenticated Codex
host process or isolate one family member from another.

Timeout/cancellation stops the worker's process group. A hostile program that
creates a separate session is outside that cleanup guarantee. Logs have no
disk quota yet. Do not run hostile code or real family data in this slice.
Network administration and firmware work will need separately granted
capabilities, verification and recovery suited to those actions.

Work is tracked in [GitHub issues](https://github.com/voxelwright/voxelwright/issues).
The earlier `specs/` files are historical proposals, superseded by the owner's
November 4 request and [AGENTS.md](AGENTS.md).
