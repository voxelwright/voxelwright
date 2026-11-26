---
title: Check runner
description: Every option of the root check runner, generated from scripts/check.mjs.
---

Run `npm run check --` with the following options.

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `--list` | switch | `false` | List the checks and their eligibility. |
| `--only` | switch | `false` | Run the named checks, including skipped checks when their prerequisites exist. |
| `--ci` | switch | `false` | Skip local-only checks. |
| `--webgl` | switch | `false` | Run Chrome with software WebGL2. |
| `--jobs` | value | computed | Maximum number of checks running at once: 4, or the CPU count if lower. |
| `--timeout` | value | `900` | Seconds allowed per check. |
