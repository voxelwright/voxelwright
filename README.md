# Village

Village is a private home hub for a family and its agents. You walk through a
3D home (a kitchen and a living room today) where each object is a way in: the
notebook talks to a villager, a person's own helper that keeps notes. The
Elder turns a one-line request ("put a small radio on the windowsill") into a
checked change that you can promote into the live home or roll back. It is a
personal project, tested with synthetic people only, and it is not safe for
real family data yet.

## Layout

- `home/`: the 3D home (three.js, Cordis plugins). See `home/README.md`.
- `host/`: the villager and the Elder, plus the live home. See `host/README.md`.
- `docs/`: the handbook, published privately with Mintlify.
- `.agents/`: skills and the dispatch log. `AGENTS.md` holds the working rules.

## Run it

You need a recent Node (measured on 25.1), Google Chrome and a signed-in
Claude Code.

```sh
# The home, at http://localhost:5181
cd home && npm install && npm run dev

# The villager: prints one link per person, such as http://localhost:5181/#token=...
# Open that link, not the plain address. --agent stub runs without a model.
cd host && npm install && npm run villager

# The Elder: writes a candidate under ~/.village/candidates/
cd host && npm run elder -- "put a small radio on the windowsill"
```

Checks: `npm run typecheck`, `npm run build` and the `scripts/check-*.mjs`
files in `home/`; `npm run regressions`, `npm run check-villager` and
`npm run check-promote` in `host/`.

## Handbook

`docs/` has the quickstart, current status, decisions and change log.

## History

The earlier Python factory (Gas City workers and evidence records) is kept in
the branch `archive/python-factory-2026-11`. Everything removed in the November 6
restart cleanup, including older evidence and skills, is kept at the tag
`archive/pre-cleanup-2026-11`.
