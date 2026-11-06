# Village host: the Elder

The Elder turns a one-line request into a checked candidate change. It is a
Node service built from Cordis plugins, like the home.

```sh
npm install
npm run typecheck
npm run elder -- "put a small radio on the windowsill"     # claude-code
npm run elder -- "..." --timeout-ms 20000 --candidates ~/.village/candidates
npm run regressions                                         # stub executors, no model calls
```

Each run writes `result.json` in `~/.village/candidates/<id>/`, whatever
fails: a missing check, the copy, the install, an executor that cannot start,
a timeout or the commit.

1. Copies the running checkout's current commit into
   `~/.village/candidates/<id>/repo` on branch `candidate/<id>` (a fresh
   `git init` plus a fetch of that commit). Uncommitted changes are not copied.
2. Runs `npm ci --ignore-scripts` from the base lockfile in the candidate's
   `home/`, under `srt` with only `registry.npmjs.org` reachable, then checks
   that no file in the candidate shares an inode with any file in the source.
3. Records the base before the executor runs: a manifest of every file
   (content hash and mode, `.git` and `node_modules` included, `home/dist`
   left out), and a base build and screenshot of the unchanged home.
4. Runs one executor in the candidate with the request and fixed
   instructions (one new file in `home/src/plugins/`, nothing else). Timeout:
   6 minutes by default; `--timeout-ms` takes a whole number from 1 to
   3,600,000, and anything else (`abc`, `0`, `NaN`) is refused. No retry.
5. Runs the checks from `src/plugins/home-checks.ts` in a fixed order and
   stops at the first failed gate. The run fails if any expected check is not
   registered. The status rests only on the three out-of-page gates
   (`result.json` lists them under `gates`).
   - `controller-files`: everything outside `home/src/plugins/` is unchanged,
     and that folder holds only regular files. Any other change fails the run
     and names the path. So the kernel, `main.ts`, configs, scripts and
     `node_modules` that later checks run are the base versions. `main.ts`
     loads any plugin file it does not list, so a new plugin needs no edit
     there.
   - `build`: `tsc --noEmit` and `vite build` exit 0, under `srt` with no
     network.
   - `screenshot`: headless Chrome on `vite preview` (preview under `srt`),
     with no page errors seen through CDP, a screenshot that is not blank, and
     more than 0.05% of pixels changed from the base render.
   - `plugin-lifecycle`, in-page evidence and not a gate: for each added
     plugin, unload then reload in the page. Unloading must match a fresh page
     without the plugin, and reloading must match the page before. It reads
     `window.village`, which plugin code can replace: a plugin that leaks on
     unload and wraps `window.village` in a Proxy passes it. A failure is
     listed under `warnings`; neither result changes the status.
6. Commits on `candidate/<id>` and records the result. If the executor
   changed `.git`, nothing is committed and the run fails. Every git call
   uses `core.hooksPath=/dev/null`, `core.fsmonitor=false`,
   `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`.
7. Deletes passed candidates beyond the newest five. Failed ones stay.

## Sandbox

Candidate-influenced Node tools run under Anthropic's sandbox runtime
(`srt` 0.0.81, Seatbelt). Reads are denied under the controller's home
directory and the user temp directory, given as absolute paths, except the
candidate, the Node install and a per-run temp directory; keychains and `.env`
files are denied everywhere. Before November 6 the rule said `~`, which srt
expands with the HOME the host sets to the temp directory, so the real home
was readable (`~/.zshrc`, `~/.ssh/*.pub`, `~/.claude.json`, the trusted
checkout). The `sandbox-denies-home` regression now reads a synthetic file
under the real home from inside the sandbox and expects EPERM. Writes go only
to the candidate's `home/` (not `node_modules`) and the temp directory. There
is no network except loopback for the preview, or the npm registry for the
install. The environment is a fixed list with HOME set to the temp directory.
Details and measured limits: `.agents/skills/sandbox-runtime/SKILL.md`.

Chrome does not run under `srt`: the profile has no `mach-register`, and
Chrome aborts without it. The check browser runs with Chrome's own sandbox on,
a temporary profile, an allowlisted environment, and a proxy that refuses
everything except the preview origin (other loopback ports included).

Processes are killed by process group at the deadline. A run resolves without
waiting for a descendant that left the group and still holds the output
pipes. Each page visit, preview server and browser together, has a 60-second
deadline and one cleanup scope.

## Executors

Both get the controller's environment reduced to PATH, HOME, USER, LOGNAME,
SHELL, LANG, LC_ALL, TERM and TMPDIR. Every command, the executor included,
needs a timeout from 1 ms to one hour.

- `claude-code`: `claude -p --model sonnet --output-format stream-json
  --verbose --restricted --strict-mcp-config --mcp-config '{"mcpServers":{}}'
  --permission-mode acceptEdits --permission-prompts none --tools
  Read,Edit,Write,Glob,Grep --no-session-persistence`. No Bash, because the
  model can rewrite `package.json` scripts that an allowed command would run.
  `executor.log` holds the stream: the `init` event, every tool call and the
  result. The run fails when the `init` event is missing or lists an MCP
  server or `mcp__` tool; `result.json` records the servers, tools, usage and
  cost under `executorOutcome.report`.
- `codex`: off. It registers only with `ELDER_ALLOW_CODEX=1`, because a lock file on the maintainer's machine can block the tool. Not run since
  November 6. Its `workspace-write` sandbox limits writes, not reads.

## Measured (November 6, 2026)

Apple M1 Pro, Node 25.1, headless Chrome reporting the WebGPU backend.
Results and screenshots are in `proof/`.

| Run | Executor, model | Executor | Total | build | screenshot | plugin-lifecycle |
| --- | --- | --- | --- | --- | --- | --- |
| radio | claude-code, claude-sonnet-5-5 (+ haiku-5-5 helper) | 45.3 s | 81.9 s | pass | pass | pass |
| radio | codex, gpt-6.1-sol | 55.4 s | 87.8 s | pass | pass | pass |
| radio, 20 s timeout | claude-code | 20.3 s, timeout | 22.9 s | not run | not run | not run |
| radio with a type error | claude-code, claude-sonnet-5-5 | 47.8 s | 53.8 s | fail (TS2322) | fail | fail |

The lifecycle check also caught a hand-made plugin that added its group to
the scene without `own()`: neither the unload nor the reload matched.

With the sandbox and gates (November 6, 2026, same Mac):

- `npm run elder -- "add a small clock above the window"`: claude-code,
  claude-sonnet-5-5, passed every check. Executor 63.6 s, total 119.0 s. The
  plugin added only `home/src/plugins/clock.ts`; 0.25% of pixels changed from
  the base render.
- `npm run regressions` (before the fixes): 13 of 13 cases got the expected result, including a
  malicious `vite.config.ts`, edits to `main.ts`, the kernel and
  `node_modules`, a faked `window.village`, an empty check registry, a spawn
  error, a timeout with an escaped child, a tampered `.git`, a Chrome launch
  failure and the browser's network block.
- After the sandbox, MCP and gating fixes (November 6, 2026, same Mac):
  `npm run regressions`, 24 of 24 as expected, about 6 minutes, nothing left
  in `$TMPDIR`. Each guarded line (absolute `denyRead`, the strict MCP flag
  and its check, the timeout validation, the symlink clause, each git flag,
  the env allowlist and in-page gating) was mutated once; a regression failed
  for every one.
- A tiny `claude -p --model sonnet` request with the executor's flags: without
  `--strict-mcp-config`, 515k to 71k cache-creation tokens and $2.06 or $0.29
  per run; with it, under 1k and $0.004 to $0.005. The `init` event listed no
  MCP servers either way.
- `npm run elder -- "put a small brass bell on the table"`: claude-code,
  claude-sonnet-5-5, passed all three gates (plugin-lifecycle warned; see
  Not yet). `init`: no MCP servers, tools Edit, Glob, Grep, Read, Write.
  14.5k cache-creation and 72k cache-read tokens, 3.0k output, $0.095.
  Executor 27.8 s, total 74.9 s; added only `home/src/plugins/bell.ts`.
- `node test/sandbox-overhead.ts <repo>`, medians of three: `srt` adds 0.16 s
  to `tsc --noEmit` and 0.68 s to `vite build`.

## Not yet

- Chrome runs under its own sandbox, not `srt`. A custom `sandbox-exec`
  profile for Chrome was not tried.
- The install writes the Elder's npm cache, `~/.village/npm-cache`, outside
  the candidate. The lockfile's integrity hashes guard what is read from it.
- A descendant of an executor that leaves the process group survives the
  timeout. The run no longer waits for it, but nothing kills it.
- The trusted checkout is unreadable to sandboxed tools only because it lives
  under the home directory.
- `plugin-lifecycle` warns on every plugin since the rooms service landed
  (e324bb0): the unloaded page never matches the `?plugins=` baseline. It no
  longer gates, so runs still pass, but its warning carries no signal until
  the baseline is rebuilt. There is no out-of-page check that a plugin
  unloads cleanly.
- The `init` event listed no MCP servers even without `--strict-mcp-config`;
  the connectors load after it. The flag is what keeps them out (measured
  below); the `init` assertion only catches servers present at start.
- `GIT_CONFIG_NOSYSTEM` has no regression: the system config is not a file
  a test should write.
- The 0.05% screenshot threshold rests on one noise sample (0.008% between two
  renders with nothing added). A plugin too small to change that many pixels
  fails.
- Neither executor can look at the scene, so `ui-craft`'s screenshot loop is
  not run.
- Review and a chat surface are later units. Promotion and rollback: below.

# Live home, promotion and rollback (#43)

```sh
npm run live -- install [--live ~/.village/live] [--commit HEAD]
npm run live -- serve [--port 5183]
npm run live -- status
npm run elder -- promote <candidate-id> --approve
npm run elder -- rollback [promotion-id|last]
npm run check-promote          # headless proof, stub executors, scratch live home
```

`install` copies `home/` at one commit with `git archive` (new files, then
`assertNoSharedInodes` against the checkout), starts a git repository there,
and runs `npm ci`. `node_modules`, `dist`, `server.json` and `results.jsonl`
are ignored, so they never count as uncommitted. `serve` runs the live home's
own Vite with one extra plugin (`src/live-vite.ts`): a new file in
`src/plugins/` is loaded into the running page through the dev kernel, and a
deleted one is unloaded, instead of Vite reloading the page. Edited plugin
files hot-swap as before. Nothing in `home/` changes for this.

`promote` needs `--approve` on the command line; nothing a candidate or model
wrote counts as approval. It also needs `result.json` with `passed`,
`controller-files` passing, and the per-file sha256 that runs now record
under `files` at check time. Every changed path must be under
`home/src/plugins/`, and the working tree, the candidate commit's blobs and
the recorded hashes must agree. The live install must have no uncommitted
changes. It copies the files, appends a promotion entry (candidate, files,
hashes before and after, the live commit before) to `promotions.jsonl`, and
commits with the hardened git flags. `rollback` restores each file from that
earlier live commit, checks it against the recorded hash, and records a
rollback entry. It refuses when any promoted file no longer has the hash the
promotion gave it (a hand edit or a later promotion). Every attempt, refused
or not, appends a line with a plain message to `results.jsonl`.

`npm run check-promote` (November 6, 2026, headless Chrome, 1280×800,
`?q=low`): 19 of 19 steps. A passing candidate's red box was in the kernel's
active list and on screen (7.3% of pixels newly red; noise 0.003%) 262 ms
after the promote command returned, with no page load; rollback took it out in
271 ms and left no file, as recorded. Each refusal (no `--approve`, missing,
failed, edited after the check, uncommitted live changes, rollback over a
hand edit) exited 1 and wrote its entry. The proof:
`proof/20261106T233029-promote.json`.

Not yet: a hot-added plugin is loaded globally, not into a room plan, until
the next page load; `ready()` does not list it. Two promotions at once are not
locked against each other. The live server runs Vite dev, not a production
build, and is not sandboxed (it runs only controller-owned config; promoted
plugin code runs in the browser). `village.kernel` is reachable by any page
script in dev builds.

# Villager (#40)

`npm run villager -- [--agent claude|stub] [--model sonnet] [--port 5190] [--root ~/.village]`
serves a person's villager on 127.0.0.1 only. Each start writes a random
token and the port to `<root>/villager/launch.json` (mode 0600) and removes it
on stop; every request needs `Authorization: Bearer <token>`.

- `GET /people/<id>/conversation`: the last 40 lines on both sides.
- `POST /people/<id>/messages {"text"}`: server-sent events, `text` pieces
  then `done` with the reply, or `failed`. One turn at a time per person
  (409), 3-minute deadline. A turn finishes and is recorded even if the page
  leaves.

Each turn runs the official Claude Code binary through the Claude Agent SDK
(`src/villager-agent.ts`, pack `.agents/skills/claude-agent-sdk`) on the
operator's existing login: no built-in tools, no settings files, strict MCP
config, and only an in-process `notes` server with `list_notes`, `read_note`
and `write_note`. The turn fails if `init` lists any other MCP server or
tool. Note names must match `[a-z0-9][a-z0-9-]*.md`; symlinks are refused.
Per person, `<root>/people/<id>/` holds `notes/`, `villager.json` (session
id to resume and its running cost), `conversation.jsonl` and `usage.jsonl`
(models, tokens, cost of the turn, first-text and total time). A failed turn
records the line as unanswered and keeps the stored session.

`npm run check-villager` (stub agent, no model): token, streaming, usage
log, one turn at a time, launch-file cleanup, a new token per launch,
resuming after a restart, failed turns, person ids, eight attempts to leave
the notes folder (`../`, `a/../../`, absolute, symlinks, dotfiles) and the
init guard. 34 of 34 passed (November 6, 2026).

Not yet: session transcripts live in the operator's `~/.claude/projects/`,
not the person's folder; every person shares the operator's subscription and
OS user, so this is not family isolation; the dev-server token handoff
trusts any same-origin page on localhost:5181; the villager cannot remind or
act yet.
