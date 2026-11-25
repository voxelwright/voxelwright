# Check runner

Run `npm run check --` with the following options.

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `--list` | switch | `false` | List the checks and their eligibility. |
| `--only` | switch | `false` | Run the named checks, including skipped checks when their prerequisites exist. |
| `--ci` | switch | `false` | Skip local-only checks. |
| `--webgl` | switch | `false` | Run Chrome with software WebGL2. |
| `--jobs` | value | `String(Math.min(4, cpus().length))` | Maximum number of checks running at once. |
| `--timeout` | value | `900` | Seconds allowed per check. |

<!-- docs-verified d275af1c4ec25f6efc898f9e37606571023eeed1 {"scripts/check.mjs":"5866827cb515bd9924bf985173d1a874"} -->
