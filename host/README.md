# Village host: the Elder

The Elder turns a one-line request into a checked candidate change. It is a
Node service built from Cordis plugins, like the home.

```sh
npm install
npm run typecheck
npm run elder -- "put a small radio on the windowsill"                    # claude-code
ELDER_CODEX_BIN=/path/to/codex npm run elder -- "..." --executor codex
npm run elder -- "..." --timeout-ms 20000 --candidates ~/.village/candidates
```

Each run:

1. Copies the running checkout's current commit into
   `~/.village/candidates/<id>/repo` on branch `candidate/<id>` (a fresh
   `git init` plus a fetch of that commit) and checks that no inode is shared
   with the source. Uncommitted changes are not copied.
2. Runs `npm ci` in the candidate's `home/`, then one executor plugin there
   with the request and fixed instructions (new home plugin, kernel untouched,
   follow `ui-craft`). Timeout: 6 minutes. No retry.
3. Runs the controller's checks from `src/plugins/home-checks.ts`: `tsc` and
   `vite build`; a headless Chrome screenshot of `vite preview` with no console
   errors; and, for each plugin file the candidate added, unload then reload
   in the page. Unloading must match a fresh page without the plugin, and
   reloading must match the page before.
4. Commits everything on `candidate/<id>` with hooks disabled and writes
   `result.json` next to the repo. The run passes only if the executor
   completed and every check passed. When the executor fails or times out,
   checks are recorded as `not run`.

Executors use the operator's existing login in place:

- `claude-code`: `claude -p --model sonnet --output-format json --restricted
  --permission-mode acceptEdits --permission-prompts none --tools
  Read,Edit,Write,Glob,Grep --no-session-persistence`. No Bash, because the
  model can rewrite `package.json` scripts that an allowed command would run.
- `codex`: `codex exec -s workspace-write -C <candidate> --ignore-user-config
  --ephemeral -m gpt-6.1-sol -c model_reasoning_effort="medium"`. The npm
  installs of codex on the owner's Mac lack their native binary, so set
  `ELDER_CODEX_BIN` to the ChatGPT app's bundled CLI.

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

## Not yet

- The page probe reads `window.village`, which the candidate's `main.ts`
  defines. `result.json` records diffs to the kernel, scripts and build config,
  but a candidate could still fake its snapshot.
- Codex runs Node tools inside its sandbox; Claude Code cannot run commands.
  Neither can look at the scene, so `ui-craft`'s screenshot loop is not run.
- Promotion, hot-swap, rollback, review and a chat surface are later units.
