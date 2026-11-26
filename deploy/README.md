# deploy

Builds and ships the two Cloudflare Workers. `voxelwright` serves the San Francisco realm at voxelwright.world. `zahynailo` serves the owner's front page and blog at zahynailo.dev as static assets only. The main-branch workflow (`.github/workflows/deploy.yml`) builds both once and ships both. [The deploy guide](../guide/deploy.md) explains the request routing, the Brotli handling, `/weather`, the data bundle and the CI checks.

**Every push to main that touches `engine/`, `site/` or `deploy/` deploys both sites publicly.**

## Files

| File | What it holds |
| --- | --- |
| `assemble.mjs` | Writes `dist/` (zahynailo.dev: `site/dist` as it is) and `dist-world/` (voxelwright.world: `engine/dist-sf` with the alpha notice). |
| `notice.mjs`, `alpha.js` | The early-alpha notice that assembly adds to the realm's pages. |
| `worker.mjs`, `world-worker.mjs`, `encoding.mjs` | The `voxelwright` Worker's code: `/weather`, and each release and bay file sent as its stored `.br` copy. |
| `cloudflare.config.ts`, `wrangler.config.ts` | Both Workers. `--mode world` is `voxelwright`; the default is `zahynailo`. |
| `data.mjs`, `data.json` | The realm's data bundle and the release that holds it. |
| `ship.mjs` | One-command local deploy. |
| `publish.sh` | CI's deploy, live check and rollback for each Worker. Actions only. |
| `*-rule*.json` | Single Redirect rules on the two zones. |

## Test

```sh
npm ci --prefix deploy
npm --prefix deploy test
```

## Deploy by hand

From a clean checkout with the pinned data present (see below), with the local `cf` CLI signed in (`cd deploy && npx cf accounts list` shows whether it is; `cf` and `wrangler` keep separate logins):

```sh
npm --prefix deploy run ship
npm --prefix deploy run ship -- --dry-run      # print the steps only
```

It builds the core, the realm, the site and both folders, deploys `voxelwright` then `zahynailo` with `HEAD`'s SHA as the message, and checks what is live. Flags: `--world-only`, `--site-only`, `--public` (procedural eggs only), `--skip-build`, `--skip-live`, `--allow-dirty`, `--dry-run`. It does not install packages, run tests or fetch the data bundle.

Or step by step:

```sh
npm ci --prefix site && npm ci --prefix deploy
npm --prefix engine run core && node engine/sf/build.mjs
npm --prefix site run build && node deploy/assemble.mjs
(cd deploy && npx cf deploy --mode world)     # voxelwright.world from dist-world
(cd deploy && npx cf deploy)                  # zahynailo.dev from dist
```

## When the pin or the city's data moves

The release, the street graphs and the kept car live in `~/.village`, not in git. After `engine/sf/pilot/current.json` changes, or the graphs or the car change, on the machine that has `~/.village` and after a local `node engine/sf/build.mjs` (for the release's quality-11 copies):

```sh
node deploy/data.mjs pack     # uploads the bundle once; writes deploy/data.json
git add deploy/data.json engine/sf/pilot/current.json
```

CI fails before it builds the realm, so nothing deploys, if the pin and `deploy/data.json` disagree. Don't delete old `sf-data-*` releases: rolling back to an older commit needs its bundle.

When the first view changes too (a new pin, the arrival, the lens, the air or the boards), take the loader's pictures again and commit `engine/sf/loading.json`. The loader (`engine/page/loading.html`) shows that picture under fog until the realm is ready, so a stale one shows a different city first.

```sh
cd engine && node sf/loading.mjs
```

## Private egg media

The realm's and the landing's video eggs read clips from the folder in `VOXELWRIGHT_EGG_MEDIA`: `rick.mp4`, `bad-apple.mp4`, `matrix.m4a` and one `<id>.mp4` per entry in `engine/sf/memes.json`. A build without it ships procedural eggs only. `ship` uses `~/.village/engine/sf/eggs/media` when it exists. The public data bundle never holds the clips.

CI reads them from a private release. The repository variable `EGG_OVERLAY_TAG` names it (`eggs-overlay-<first 16 hex of the archive's SHA-256>`), `EGG_OVERLAY_REPO` picks the repository (default: this one), and the production secret `EGG_OVERLAY_TOKEN` reads another repository. Leave the tag unset for procedural eggs. When a clip changes, rebuild the archive and upload it:

```sh
work=$(mktemp -d)
python3 - "$work/egg-media.tar" <<'PY'
from pathlib import Path
import sys
import tarfile

media = Path.home() / ".village/engine/sf/eggs/media"
with tarfile.open(sys.argv[1], "w", format=tarfile.USTAR_FORMAT) as archive:
    for clip in sorted([*media.glob("*.mp4"), *media.glob("*.m4a")]):
        entry = tarfile.TarInfo(clip.name)  # fixed epoch mtime, owner/group 0 and mode 0644
        with clip.open("rb") as source:
            entry.size = clip.stat().st_size
            archive.addfile(entry, source)
PY
digest=$(shasum -a 256 "$work/egg-media.tar")
tag="eggs-overlay-$(printf '%.16s' "$digest")"
gh release create "$tag" "$work/egg-media.tar" --repo "${PRIVATE_OVERLAY_REPO:?set the private overlay repository}" --title "Egg media overlay (private)" --notes "" --prerelease --latest=false
```

Then set `EGG_OVERLAY_TAG` to the new tag.

## Redirects

Four Single Redirect rules sit on the zones, and Cloudflare runs them before either Worker. Deploys never touch them. Changing them changes what the public internet sees, so it is the owner's call.

- `world-blog-rule.json`: `/blog` and below on voxelwright.world (either host) to zahynailo.dev.
- `world-www-rule.json`: www.voxelwright.world to the apex.
- `zahynailo-realm-rule-a.json`, `zahynailo-realm-rule-b.json`: `/` on zahynailo.dev with any of the realm's old query keys to `https://voxelwright.world/`, so old share links keep working. A query that is not the realm's (`?utm_source=`, `?view=2d`) stays on the front page. The list is split in two because the pinned `cf` CLI dies without a message when one `--body` carries all of it.

zahynailo.dev also has a www-to-apex rule that is not kept here. All are `301` and keep the query string. With a token allowed to edit Single Redirects, a zone with no redirect entry point gets one with its rules:

```sh
cd deploy
npx cf rulesets create --zone voxelwright.world --kind zone --phase http_request_dynamic_redirect --name 'World redirects' --rules "$(jq -sc . world-blog-rule.json world-www-rule.json)"
```

A zone that has one already gets rules appended to it:

```sh
cd deploy
npx cf rulesets entrypoint get http_request_dynamic_redirect --zone zahynailo.dev     # note its id
for part in a b; do npx cf rulesets rules create "$RULESET_ID" --zone zahynailo.dev --body "$(jq -c . zahynailo-realm-rule-$part.json)"; done
```

## Roll back

CI deploys `voxelwright` first, then `zahynailo`, and rolls a Worker back itself when its live check fails after the upload (see [the guide](../guide/deploy.md#in-ci)). By hand, select the Worker by name, and add a version ID after `rollback` to pick one:

```sh
cd deploy
npx wrangler deployments list --name voxelwright
npx wrangler rollback --name voxelwright -m "reason"
```

## Check what is live

```sh
cd engine && node test/sf-live.mjs --url https://voxelwright.world/
curl -s https://voxelwright.world/weather
```

`sf-live.mjs` opens the realm in Chrome with WebGPU at 25 Mbit/s and 40 ms. It fails unless the park shows within 8 MB on the wire, two clicks on EXPLORE reach the roof, the credits are on the page, and every board's link and the blog's pages answer without a 404.

## Limits

- Each request to `/releases/*`, `/bay/*` or `/weather` runs Worker code and counts against the Workers Free plan's 100,000 requests a day. Past it those requests fail and the city stops loading until the daily reset. Workers Paid removes the cap, which is the owner's call. `zahynailo` runs no code and never counts.
- A static asset can be at most 25 MiB, and a version at most 20,000 files on the Free plan. `assemble.mjs` fails past either.
- A static host may not serve byte ranges, so the eggs fetch each clip whole before playing it.
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are secrets of the `production` environment. The workflow runs its job only on main.
