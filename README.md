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
The measured runs used Codex `0.166.0-alpha.6` on macOS and `0.160.0` on Linux.
There are no Python package dependencies.
The standard `CODEX_HOME` environment variable may select an existing Codex
login profile. Login files stay in that profile; Village does not copy them.

Create a separate candidate directory. Supply the trusted task text on standard input. The candidate
must be disjoint from the trusted Village checkout and contain no project Codex configuration. Start the controller from its trusted checkout.
The output directory must be new and outside the candidate. Then run:

```sh
printf '%s\n' 'Fix greet.sh to print Hello, Village!' | python3 -m village \
  --workspace /absolute/path/to/candidate \
  --output /absolute/path/to/new-evidence \
  --codex /absolute/path/to/codex \
  --model gpt-6.1-sol \
  --check /bin/bash -o pipefail -c '/bin/sh greet.sh | /usr/bin/cmp -s - <(printf "Hello, Village!\n")'
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

The live proof uses the real CLI and existing login. It first demonstrates
that the check rejects a broken program, asks the agent to repair it, runs the
same check, and probes denied sibling access, protected configuration writes
and local TCP access. Each denial probe first succeeds outside the sandbox;
its synthetic sentinels are then reset and checked for changes:

```sh
python3 -m scripts.prove_runner --codex /absolute/path/to/codex
```

After green gates, use the supplied [reviewer skills](.agents/skills/reviewers/SKILL.md).
Local measurements and review status live in [evidence](evidence/001-worker.md).

## Current boundary

This is a synthetic-data development slice, tested on macOS arm64 and Linux
x86_64. Family isolation, durable job recovery, richer runtime permissions and
the family interface remain unproven.

Worker commands receive workspace access, Codex's minimal OS runtime reads and
read access to the exact trusted Codex executable, needed by Linux's sandbox.
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

Use an exclusively owned candidate directory containing independent copies of files. A local Git clone must use `--no-hardlinks`. Village rejects pre-existing hard links before each phase; it assumes no other host process changes the candidate during a run.
