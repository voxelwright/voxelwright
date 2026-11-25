# Village

Village is a game in the making: one systemic, multiplayer world that people
make by talking, where their own agents live as characters. Today it has two
places. The home is a 3D house you walk through (a kitchen and a living room)
where each object is a way in: the notebook talks to a villager, a person's own
helper that keeps notes, and the Elder turns a one-line request ("put a small
radio on the windowsill") into a checked change you can keep or undo. The
street is a shared, sloping block run by a world process, where each browser
that joins gets a walker. It is a personal project, tested with synthetic
people only, and it is not safe for real family data yet.

## Layout

- `home/`: the 3D home (three.js, Cordis plugins). See `home/README.md`.
- `host/`: the villager and the Elder, plus the live home. See `host/README.md`.
- `street/`: the shared street's world process and page. See `street/README.md`.
- `engine/`: Village's own engine (#140): a world of 10 cm cells drawn with raw WebGPU, its core in Rust. See `engine/README.md`.
- `site/`: the personal site and blog, served under zahynailo.dev/blog/. It was brought in with `git subtree`, history kept. See `site/README.md`.
- `deploy/`: zahynailo.dev, one Cloudflare Worker with the SF realm at `/` and the site under `/blog/`, deployed on every push to main. See `deploy/README.md`. Splitting the realm, the site and the kit into separate repos waits until Village goes open source.
- `master/`: the master server (Rust), which lists player-hosted lobbies and passes one WebRTC offer and one answer per join (#526). See `master/README.md`.
- `docs/`: the handbook, published privately with Mintlify.
- `.agents/`: skills and the dispatch log. `AGENTS.md` holds the working rules.

## Run it

You need a recent Node (measured on 25.1), Google Chrome and a signed-in
Claude Code.

```sh
# Village for daily use: the live home with the villagers, reminders and the Elder, http://localhost:5183/.
# The first start installs the live home (~/.village/live) from this checkout's commit.
# VILLAGER_PEOPLE=alex:Alex,sam:Sam,mia:Mia lists the people (the home's cast is these three, so list all of
# them, or the notepad cannot route); --agent stub runs without a model.
cd host && npm install && npm run village
npm run village -- link alex          # a one-time pairing link; a paired device stays paired across restarts
npm run village -- link alex --add    # pair one more device without unpairing the others
npm run village -- service install    # launchd keeps Village running; `service uninstall` removes it
# Notepad: "Elder, put a small brass bell on the table" asks the Elder (operators only). Keep or Undo it
# on the approval page its card opens, http://localhost:5184/ (its own origin; see host/README.md).

# Development: the home's dev server at http://localhost:5181 (the iso dollhouse with walking
# villagers, talk, music and build mode; ?talk=off is the quiet seated kitchen, ?build=0 turns build
# mode off, ?cam=seat keeps the seated view) and the villagers behind it on 5190. In a terminal, the
# villager prints a pairing link for each person not yet paired.
cd home && npm install && npm run dev
cd host && npm install && npm run villager

# The street: a shared block on the engine's World, in its own process. http://localhost:5318
# (needs home/node_modules; no sign-in, so it listens on this machine unless told a tailnet address)
cd street && npm install && npm run world    # and in another terminal: npm run page
# The home's door on the street: tell the world where the home is, and No. 102's door leads there and back.
cd street && npm run world -- --home http://localhost:5183/
# Something to do there: three residents who each want something (`--maker sonnet` lets you make things by typing).
cd street && npm run world -- --problems --maker sonnet

# The Elder: writes a candidate under ~/.village/candidates/
cd host && npm run elder -- "put a small radio on the windowsill"
```

## Checks

Before a merge, and after every rebase, run one command from the repo root:

```sh
npm install                      # once; also npm install in home/ and host/
npm run check                    # both typechecks, the home build, the host's stub tests, every home check
npm run check -- --list          # what it runs, and why anything is skipped
npm run check -- --only kernel notebook   # just these
```

It prints one line per check (pass, fail or skip with the reason, seconds), shows the last lines of
each failure and exits non-zero if any failed. Full logs are in `.check/`. Checks use stub agents
and make no model calls; the `--agent=claude` runs stay by hand. It picks free ports for every
check and starts one dev server for the page checks, so it does not touch ports 5181 or 5190 and
can run beside a play server. A full run takes under 20 minutes on the dev Mac (serial: about 31). `--only` also runs a check the manifest skips, such as `host-regressions`. The runner and
`scripts/checks.mjs` (the manifest: which checks may run together, which are local-only, which are
skipped and why) are the one place to look. Perf gates (`npm run perf-gate` in `home/`) stay by hand.
Checks write pictures and clips under `home/screenshots/`, which git ignores; only the notes there
(`*.md`) are tracked.

GitHub Actions (`.github/workflows/check.yml`) runs `npm run check -- --ci --webgl` on pull
requests to `main` and pushes to `main`, on `ubuntu-latest`: both typechecks, the home build, the host's
villager and plan tests, the route check and the one page check (babble) that passes reliably in software WebGL2. It does not
run the other page checks (too slow or past their time bounds without a GPU), the host regressions
(macOS sandbox), the perf gates or anything with a model. Those run on your Mac.

## Machine hygiene

```sh
scripts/hygiene.sh --dry-run     # which finished worktrees under ~/.t3/worktrees/Village would go
scripts/hygiene.sh --install     # copy to ~/.village/bin and run it hourly with launchd (village.hygiene)
```

It removes a worktree only when it is clean (untracked node_modules, dist, target, .venv and
`__pycache__` aside), unchanged for 2 hours, not open in any process and not under `feature-450-*`,
and its HEAD is merged into origin/main, on a branch deleted on the remote, or pushed and untouched
for 3 days. A HEAD no branch contains is kept as `refs/backup/wt-<name>`. Below 60 GiB free
it posts a notification. Everything it does goes to `~/.village/hygiene.log`. Rerun `--install`
after changing the script.

A PostToolUse hook in `.claude/settings.json` appends a row to `.agents/dispatch-log.jsonl` for
every `delegate_task` and `t3_thread_launch` call made from a Claude Code session in this repo.

## Handbook

`docs/` has the quickstart, current status, decisions and change log.

## History

The earlier Python factory (Gas City workers and evidence records) is kept in
the branch `archive/python-factory-2026-11`. Everything removed in the November 6
restart cleanup, including older evidence and skills, is kept at the tag
`archive/pre-cleanup-2026-11`.
