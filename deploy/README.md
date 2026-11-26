# Deploy the realm and blog

The `voxelwright` Worker serves San Francisco at voxelwright.world and www.voxelwright.world. The `zahynailo` Worker serves the same realm at zahynailo.dev and mounts the personal site under `/blog/`. The main-branch workflow builds the realm and blog once, then deploys and checks each Worker. It also runs by hand from Actions → deploy.

## What is where

- **Static assets** hold everything, about 3,700 files and 830 MB. The realm's `engine/dist-sf/sf/*` goes at the root, beside its `page/`, `kit/`, `blocks/` and `bay/`. `site/dist` adds `blog/`, `robots.txt` and `404.html`. `assemble.mjs` writes this folder, `deploy/dist`. The second folder, `deploy/dist-world`, contains the realm, its own canonical and social metadata, robots policy and 404 page. The personal blog board links to https://zahynailo.dev/blog/.
- **The early-alpha notice:** `assemble.mjs` adds `alpha.js` (served at `/alpha.js`) to every page it publishes, the realm's and the blog's, through `notice.mjs`. A dismissal is kept in `localStorage` for that origin.
- **`worker.mjs`** runs only for `/releases/*` (the city's pinned release) and `/bay/*` (the road's marks and the landmarks). It sends the quality-11 Brotli copy that `sf/build.mjs` wrote beside each file, unchanged, so the bytes on the wire are the ones the realm's checks measure. Static assets alone can't do this. Setting `Content-Encoding: br` in `_headers` makes the edge compress the file a second time, and the edge doesn't compress `.bay`, `.far` or `.bin` files at all. The edge compresses the code itself, which comes to about 0.25 MB more than the local quality-11 copies.
- **`/weather`** also runs `worker.mjs`. It answers San Francisco's weather now for the realm's "SF now" sky: the latest report from the National Weather Service's SFO station that saw the sky, trimmed, kept ten minutes at the edge and five in the browser. If the service fails, it answers 502 and the sky keeps its own weather. To check it after a deploy, run `curl -s https://zahynailo.dev/weather`.
- **Domains:** `zahynailo.dev` and `www.zahynailo.dev` are custom domains in `cloudflare.config.ts`. A Single Redirect rule on the zone (`www.zahynailo.dev to the apex`) sends www to the apex with a 301 and keeps the path and query. It was set once through the Rulesets API, and deploys don't touch it.
- **The city's data in CI:** the release, the street graphs and the kept car live in `~/.village`, not in git. `node deploy/data.mjs pack` bundles them as Brotli into one GitHub Release asset (`sf-data-<digest>`, about 150 MB) and writes `deploy/data.json`. Visitors download over HTTPS from the release URL or the mirror in `VOXELWRIGHT_DATA_URL`. The private workflow uses its existing Actions token with the GitHub Releases API. CI runs `node deploy/data.mjs fetch`, checks that the bundle is for the pin in `engine/sf/pilot/current.json` and that every file is the one packed, then builds. Cloudflare uploads only the assets whose hashes changed, so an unchanged release is never uploaded again.

## Private egg media

For the owner’s build, run this from the repository root with dependencies installed and the pinned realm data present:

```sh
(export VOXELWRIGHT_EGG_MEDIA="$HOME/.village/engine/sf/eggs/media" && npm --prefix engine run core && node engine/sf/build.mjs && npm --prefix site run build && node deploy/assemble.mjs)
```

The directory holds `rick.mp4`, `bad-apple.mp4`, `matrix.m4a` and one `<id>.mp4` per entry in `engine/sf/memes.json`. A standalone site at `/` uses the two landing videos. The mounted blog has no landing of its own. Builds with the variable unset ship only the procedural eggs. The public data pack excludes the private media directory.

When a clip changes, set `PRIVATE_OVERLAY_REPO` to the private repository that holds the clips. Rebuild the archive and upload it there:

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

The repository variable `EGG_OVERLAY_TAG` names that release. Set that variable on the repository running the workflow. Its `EGG_OVERLAY_REPO` variable selects the release repository (default: the workflow repository). For a separate private repository, supply a production environment secret `EGG_OVERLAY_TOKEN` with contents-read access there. The default token can read releases in the workflow repository. Leave the tag unset to build both realms with procedural eggs alone.

## When the pin or the city's other data moves

On the machine that has `~/.village`, after `engine/sf/pilot/current.json` changes, or after the street graphs or the kept car there changes:

```sh
node deploy/data.mjs pack     # uploads the new bundle once; writes deploy/data.json
git add deploy/data.json engine/sf/pilot/current.json
```

When the first view changes too (a new pin, the arrival, the lens, the air or the boards), take the loader's pictures again: `cd engine && node sf/loading.mjs`, then commit `engine/sf/loading.json`. The loader (`engine/page/loading.html`) shows that view under fog that burns off as the realm loads and clears onto the live picture, so a stale one shows a different city just before the real one. The build writes each picture beside the page (`loading-wide-<hash>.webp`, `loading-upright-<hash>.webp`), and a visitor fetches only the one their window needs. The build says when `loading.json` came from another release.

If the pin and `deploy/data.json` disagree, CI fails before it deploys. Don't delete old `sf-data-*` releases, because rolling the code back to an older commit needs its bundle.

## Deploy by hand

From the repository root with the pinned data present, run the build once. Set `VOXELWRIGHT_EGG_MEDIA` before building to include the private clips.

```sh
npm ci --prefix site && npm ci --prefix deploy &&
npm --prefix engine run core && node engine/sf/build.mjs &&
npm --prefix site run build && node deploy/assemble.mjs
```

Then run either line, or both in order. The pinned CLI passes its native project mode to both config files, so both targets share the fetch handler and the same three Worker routes. The default mode retains the original project settings. World mode selects its name, domains and asset directory.

```sh
(cd deploy && npx cf deploy --mode world)
(cd deploy && npx cf deploy)
```

## Send world blog requests to the personal site

After the zone is active and the custom domains are proxied, install this free zone Single Redirect once. It matches both world hostnames and preserves the blog path and query string. Cloudflare evaluates it before the Worker. With a token allowed to edit Single Redirects, run this for a zone with no redirect entry point yet. [Cloudflare Rulesets API](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/create-api/)

```sh
cd deploy
npx cf rulesets create --zone voxelwright.world --kind zone --phase http_request_dynamic_redirect --name 'World redirects' --rules "$(jq -sc . world-blog-rule.json)"
```

If that phase already has an entry point, append the rule to its existing ID instead. Read the ID with the first command.

```sh
npx cf rulesets entrypoint get http_request_dynamic_redirect --zone voxelwright.world
npx cf rulesets rules create "$RULESET_ID" --zone voxelwright.world --body "$(cat world-blog-rule.json)"
```

## Roll back

CI deploys voxelwright first, then zahynailo. Each live check reads the version on traffic, the root, the release pointer and the pinned Brotli manifest. The personal Worker also checks the blog and feed. On a failed live check CI attempts to roll that Worker back. The job stops on failure and records each attempted Worker’s outcome in the Actions summary, including its traffic status after an error. A first deployment has no previous version to restore.

For a manual rollback, select the Worker by name. To choose a specific version, add its ID after `rollback`.

```sh
cd deploy
npx wrangler deployments list --name voxelwright
npx wrangler rollback --name voxelwright -m "reason"
```

## Check what is live

```sh
cd engine && node test/sf-live.mjs --url https://zahynailo.dev/
```

This opens the realm in Chrome with WebGPU on a throttled link (25 Mbit/s, 40 ms). It fails unless the park shows within 8 MB on the wire, every release file arrives as Brotli, the Credits key lists the sources, every board's link and the blog's pages answer without a 404, and two clicks on EXPLORE put the visitor on the roof.

## Limits to know

- Each request to `/releases/*`, `/bay/*` or `/weather` runs the Worker (a visitor in SF now asks `/weather` once every ten minutes), and the Free plan allows 100,000 a day. A visit that only loads the landing makes about 140 of them, and exploring makes more, so the cap is roughly 700 such visits a day. Past it those requests get 429 and the city stops loading until midnight UTC. Workers Paid ($5 a month) removes the cap. That is the owner's call.
- A static asset can be at most 25 MiB (the largest today is 10.5 MB), and a version can have at most 20,000 files on the Free plan.
- `CLOUDFLARE_API_TOKEN` is an Account API token with the "Edit Cloudflare Workers" permission policy, scoped to this account. `CLOUDFLARE_ACCOUNT_ID` is the account. Both are secrets of the repo's `production` environment, which only main may use, so a branch's workflow can't reach them.
- The park is shown after 7.3 MB on the wire: under the 8 MB limit, over the 6.75 MB budget. About 0.25 MB of that is the edge compressing the code less tightly than the local quality-11 copies.
- Static assets answer a `Range` request with the whole file (200, not 206). Safari's video asks for ranges, so the eggs' videos (`/eggs/*.mp4`) may not play there. This is untested.
- `zahynailo.workers.dev` also serves the site (`workersDev` in `cloudflare.config.ts`).
- Only a machine with `~/.village` can run `node deploy/data.mjs pack`, and it needs a local `node engine/sf/build.mjs` first, for the release's quality-11 copies.

## One repository

The realm, the site and the Voxelmorphism kit stay in one repository with two Worker targets (#578).

<!-- docs-verified cc73cebc22120466c81784ffcdf0523695062e3c {"deploy/package.json":"28bdf2d986d84d8fa55a27c5df8d9d23","deploy/assemble.mjs":"005779eab81faed194d4d6d0c88c78d5","deploy/worker.mjs":"4ae8c3551c6dbf8ee63b017d57d87f9a"} -->
