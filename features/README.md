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

Everything a feature ships must come from its own folder. If a change needs an edit outside
`features/<name>/`, that edit has to leave the output unchanged while the flag is off.

To look at a feature before turning it on: `SITE_FLAGS=<name> npm run dev`. Only a dev build
reads `SITE_FLAGS`; a production build ships what `site.config.mjs` says and nothing else.

To prove a branch changes nothing while its flag is off:

```sh
npm run flag-proof -- <base commit or branch>
```

It builds the base and this checkout into temporary folders and compares them file for file. It
also fails if `package.json` or `package-lock.json` differ from the base. Turning a flag on is
the owner's step, in `site.config.mjs`.
