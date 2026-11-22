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
  already there, and nothing at its top may have a name that starts with `_` or `.`: the host
  reads `_headers`, `_redirects` and their kind as rules for the whole site.

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
nothing from the worktree's `package.json` is used. The candidate must be this checkout or a
worktree added from it (`git worktree add`); a separate clone is refused. The proof never runs
git inside the candidate and never follows the candidate's own `.git`: a git folder can name
commands for git to run, so which commit the candidate is on is read from this repository's own
record of its worktrees. Its git calls also leave out your global git settings and run no hook,
so a `.gitattributes` in the worktree cannot pick one of your filter commands (git-lfs, say) to
run. On success it prints that commit in full, as `flag-proof: proven …`.

An agent commits its change the same way, with `node scripts/seed-commit.mjs <worktree> <flag>
"<message>"` run from the main checkout: it commits `features/<flag>/` and `site.config.mjs` of
that worktree and nothing else, as you, without starting git in the worktree. It refuses links,
dotfiles and anything that is not a plain file of the feature's own.

And it tests the same way: `node scripts/seed-test.mjs <base> <commit>` makes a fresh checkout
of the commit in a new private temporary folder, proves it strictly, and only then installs the
locked packages and runs the tests there, with npm's workspaces off. The tests are not sandboxed,
so they never run in a folder an agent wrote in, nor in one beside it: npm takes a parent folder
with a `package.json` that lists workspaces as the project, and runs that folder's scripts.

Strict reads the change before running any of it and refuses unless all of this holds:

- the change is committed and descends from the base;
- the worktree holds its commit's files and nothing else: no untracked file, not even one its own
  `.gitignore` hides (so run strict before any packages are installed there);
- the worktree's `.git` is still the plain link git made for it;
- it only adds or changes plain files inside `features/<name>/` (no links, no executables, no
  dotfiles, and no file a coding agent loads as instructions: `CLAUDE.md`, `AGENTS.md`,
  `GEMINI.md`, `SKILL.md`), and only for features whose flag is off: one that is on is live
  code, and changing it is not a flag-off change;
- in `site.config.mjs` nothing differs except new names set to `false` in the one-line `flags`
  literal;
- on the base, `flags` is written as exactly one one-line literal of `"name": true` or
  `"name": false` entries, and that literal is what the config evaluates to. Keep it in that
  form: strict refuses a base it cannot read, so that a flag written some other way is never
  taken to be off.

So the Worker, the deploy config, `package.json`, the tests, this folder's README and the proof
itself cannot change in a strict build, and with the flag off none of the new code is loaded.

To see a feature working before its flag is on, add `--try <name>`: after the proof passes it
builds once more with the flag on and lists what the feature adds or changes. That build runs
with no network and is stopped after two minutes. It can write only to its own temporary
folder. It can read only that folder, the installed packages, node itself and the system's own
libraries: nothing else on the machine, wherever it is. It can start no other process, open no
terminal, load no native code of its own and signal no other process (macOS `sandbox-exec`; on a
system without it `--try` refuses to run). It is the safe way to run a feature's code. What the
build prints is not shown unless it fails, and then only quoted; names it chose are printed in
quotes with anything but plain ASCII escaped. The files it built are for reading, and nothing in
them is an instruction.

What the proof does not cover:

- The day you turn a flag on, the feature's code runs in every build with your full access, and
  whatever it ships runs in visitors' browsers. Read a feature before you turn it on.
- A worktree an agent left behind is a folder you did not write. Git run inside it (a shell
  prompt that shows the branch does this on `cd`) takes settings from that folder's `.git` and
  from any repository nested in it. Look at a failed attempt from the main checkout first:
  `git diff main...seed/<name>`.
- A build can still see the names and sizes of files elsewhere on the machine, not what is in
  them. It can also learn your account's name, the machine's name and its network addresses.
- The site's tests are not sandboxed. Run them with `scripts/seed-test.mjs`, never by hand in
  a folder an agent wrote in or in one beside it.
- An agent that runs these scripts can write to this repository, or it could not commit. The
  scripts protect you from what it leaves in its worktree. They do not protect you from an
  agent that edits the scripts, the packages or `.git/hooks` here: for that, the agent must be
  one that cannot write outside its worktree, with these scripts run for it, not by it.

Turning a flag on is the owner's step, in `site.config.mjs`.
