# Village

Walk San Francisco in a WebGPU browser. Install Node.js 25 or newer and stable Rust, then add the target once with `rustup target add wasm32-unknown-unknown`. From the repository root on macOS or Linux:

```sh
./world
```

Open the printed address and choose **Explore** to enter the city. To make new things, add your provider key under **Your AI…** in the realm settings. The city downloads as a pinned bundle with [per-layer data licences](DATA-LICENSES.md). The [quickstart](guide/quickstart.md) covers the release mirror needed before public cutover and running in a Dev Container.

## Layout

Start with the [project map](guide/project.md) and [how to keep documentation current](guide/documentation.md).

- `home/`: the 3D home (three.js, Cordis plugins). See `home/README.md`.
- `host/`: the villager and the Elder, plus the live home. See `host/README.md`.
- `street/`: the shared street's world process and page. See `street/README.md`.
- `engine/`: Village's own engine (#140): a world of 10 cm cells drawn with raw WebGPU, its core in Rust. See `engine/README.md`.
- `site/`: the personal site and blog, served under zahynailo.dev/blog/. It was brought in with `git subtree`, history kept. See `site/README.md`.
- `deploy/`: zahynailo.dev, one Cloudflare Worker with the SF realm at `/` and the site under `/blog/`, deployed on every push to main. See `deploy/README.md`. Splitting the realm, the site and the kit into separate repos waits until Village goes open source.
- `master/`: the master server (Rust), which lists player-hosted lobbies and passes one WebRTC offer and one answer per join (#526). See `master/README.md`.
- `docs/`: the handbook, published privately with Mintlify.
- `.agents/`: skills and the dispatch log. `AGENTS.md` holds the working rules.

## Run the private home

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

Install the dependencies with `npm ci` in both `home/` and `host/`. Run checks from the repository root.

```sh
npm run check
npm run check -- --only kernel notebook
npm run check -- --ci --webgl
```

Run the last command before merging. See the [runner options](guide/check-cli.md) and
[check names and prerequisites](guide/checks.md). Logs are written to `.check/`.
GitHub check workflows are disabled until the public cutover (#534).

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

## Licences

Copyright 2026 Pavlo Zahynailo. Project code carries the [Apache License 2.0](LICENSE). Project documentation and prose carry [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), except for the owner's personal writing in [site/posts](site/posts/NOTICE) and [site/writing](site/writing/NOTICE), which is all rights reserved. The project's Vox fonts carry the SIL Open Font License 1.1 with reserved names. Third-party works and baked data retain their source terms. See [credits](CREDITS.md), [data licences](DATA-LICENSES.md) and [NOTICE](NOTICE).

Voxelwright and Voxelmorphism are names belonging to Pavlo Zahynailo. Please choose another name for your fork.

<!-- docs-verified 452a182c9cc8fc2ca4ffb8bba4e4c7c943646508 {"site/package.json":"25065cd6f9cdf5bfc5bcd1c193705eab","deploy/assemble.mjs":"0338276fb038a47c9b504192a26606f9","street/src/block.ts":"2e98fa7be8da57128e03b83dd0ff766f","master/src/lib.rs":"e7a60006f48f6ca1730542b56b688e86","host/package.json":"7a50b8c947871907fef6d025d0f5b639","engine/package.json":"fcff01d1444ba359e1d890232761e78f","home/package.json":"2b43e8013bc6abfbe95c89da9f2a128c","package.json":"8ce1e779c247a7ea73bf057505a56f3a","street/package.json":"631a60c23ff10de35394f84373fe599a","host/src/live.ts":"45499f1073f06a5c713a90a389267a56","world":"2378ea1c03ac32ad3591a785e0f839d2"} -->
