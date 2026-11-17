# Features behind flags

A feature is a folder here, `features/<name>/`. It is built into the site only when
`site.config.mjs` has `flags: { "<name>": true }`. Off is the default, and with the flag off the
build does not read the folder at all.

A feature folder may hold:

- `feature.mjs`, whose default export is an object with any of these functions:
  - `head(page, site)` returns HTML added before `</head>` on every page (return `""` to skip one);
  - `bodyEnd(page, site)` returns HTML added before `</body>` on every page;
  - `pages(site, { posts })` returns extra pages, each `{ path, kind, title, description, html, markdown }`
    like the ones in `generator/pages.mjs`. `path` ends in `/` and must not be taken already.
- `static/`, copied into the site root when the flag is on. It cannot replace a file that is
  already there.

Everything a feature ships must come from its own folder. A person may also edit outside
`features/<name>/` as long as the output is unchanged while the flag is off; a build made by an
agent may not (see `--strict` below).

To look at a feature before turning it on: `SITE_FLAGS=<name> npm run dev`. Only a dev build
reads `SITE_FLAGS`; a production build ships what `site.config.mjs` says and nothing else.

## Proving a flag is off

```sh
npm run flag-proof -- <base commit or branch>
```

It builds the base and this checkout into temporary folders and compares the built site file for
file. It also fails if the dependency sections of `package.json` or the lock file differ. It
exits 0 when they are identical, 1 when they differ, 2 when it could not run.

For a change made by an agent, run the proof from the main checkout against the agent's
worktree, with `--strict`:

```sh
node scripts/flag-proof.mjs <base> --candidate .seeds/<worktree> --strict
```

Run this way, the proof that is trusted is the main checkout's, not the copy in the worktree, and
nothing from the worktree's `package.json` is used. Strict reads the change before running any
of it and refuses unless all of this holds:

- the change is committed and descends from the base;
- it only adds or changes plain files inside `features/<name>/` (no links, no executables), and
  only for features whose flag is off: one that is on is live code, and changing it is not a
  flag-off change;
- in `site.config.mjs` nothing differs except new names set to `false` in the one-line `flags`
  literal.

So the Worker, the deploy config, `package.json`, the tests, this folder's README and the proof
itself cannot change in a strict build, and with the flag off none of the new code is loaded.

To see a feature working before its flag is on, add `--try <name>`: after the proof passes it
builds once more with the flag on and lists what the feature adds or changes. That build runs
with no network and can write only to its own temporary folder (macOS `sandbox-exec`; on a
system without it `--try` refuses to run). It is the safe way to run a feature's code.

Turning a flag on is the owner's step, in `site.config.mjs`.
