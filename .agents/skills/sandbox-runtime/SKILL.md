---
name: sandbox-runtime
description: Versions, verified policy and limits for Anthropic's sandbox runtime (srt) and pngjs as the Elder host uses them to run candidate code. Load before changing host/src/sandbox.ts, the check browser or the screenshot gates.
---

# Sandbox runtime in the Elder

Pinned in `host/package.json` (verified November 6, 2026, macOS 27.2, M1 Pro, Node 25.1):
`@anthropic-ai/sandbox-runtime` 0.0.81 (CLI `srt`, Seatbelt on macOS) and
`pngjs` 7.0.0 (with `@types/pngjs` 6.0.5).

Primary source: the package README and `dist/` shipped in 0.0.81
(`npm pack @anthropic-ai/sandbox-runtime@0.0.81`). The README calls it a beta
research preview; recheck the settings schema on every upgrade.

## How the host uses it

`host/src/sandbox.ts` writes a settings file per call and runs
`srt --settings <file> -- <cmd> <args>`. The child gets only the environment
passed to `srt`, so the host passes a fixed one (PATH, HOME and TMPDIR set to
the per-run temp directory, LANG, the npm cache). srt adds its proxy variables.

Settings used (`filesystem` and `network` are both required):

- `filesystem.denyRead`: `~`, the user temp directory, `/Library/Keychains`,
  `**/.env`, `**/.env.*`. `allowRead` (wins over `denyRead`, except for the
  more specific `.env` globs): the candidate repo, the Node install, the run's
  temp directory.
- `filesystem.allowWrite`: the candidate's `home/` and the temp directory;
  `denyWrite` its `node_modules` (except during the install).
- `network.allowedDomains`: empty, or `registry.npmjs.org` for `npm ci`.
  `allowLocalBinding: true` only for `vite preview`.

## Verified behaviour

- Reads of `~/.ssh` and `~/Documents`, writes outside the allowed paths, and
  `curl`/`fetch` to the internet all fail with EPERM or a proxy refusal.
- A `vite.config.ts` that writes outside the candidate makes `vite build` exit
  non-zero with EPERM (`npm run regressions`, case
  `malicious-vite-config-under-srt`).
- `vite preview` binds 127.0.0.1 with `allowLocalBinding`, and a process
  outside the sandbox can connect to it.

## Known limits

- srt puts its proxy's Unix socket in TMPDIR. macOS caps socket paths at 104
  bytes, so the temp directory must be short (`os.tmpdir()/elder-XXXXXX`).
  A long path fails with `listen EINVAL`.
- Chrome cannot run under srt on macOS. The profile allows `mach-lookup` (and
  extra names via `network.allowMachLookup`) but no `mach-register`; Chrome
  aborts at `bootstrap_check_in ... MachPortRendezvousServer: Permission
  denied`. The full Chrome also needs a Unix socket in the user temp directory
  for its ProcessSingleton, and `allowUnixSockets` is a subpath allowlist, so
  allowing it would expose other apps' sockets there. The host runs Chrome
  outside srt with Chrome's own sandbox on (`chromiumSandbox: true`; Playwright
  defaults to off) and a dead proxy for everything but the preview origin.
- Unix sockets are blocked by default; `allowUnixSockets` takes subpaths only.

## pngjs

`PNG.sync.read(buffer)` decodes Playwright's screenshot to RGBA in
`png.data`. The host computes luminance spread and changed-pixel share itself.
Measured noise between two renders of the unchanged home: 0.00008 of pixels
(one sample); the gate needs more than 0.0005.

Refresh when either version changes or a probe contradicts this file.
