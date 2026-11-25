# zahynailo.dev

One Cloudflare Worker, `zahynailo`, on the Workers Free plan (#450). The SF realm is the landing at `/`, and the site (`site/`) is under `/blog/`. `.github/workflows/deploy.yml` builds both and deploys them on every push to main, and it can also be run by hand from main (Actions → deploy → Run workflow). Only main deploys.

## What is where

- **Static assets** hold everything, about 3,700 files and 830 MB. The realm's `engine/dist-sf/sf/*` goes at the root, beside its `page/`, `kit/`, `blocks/` and `bay/`. `site/dist` adds `blog/`, `robots.txt` and `404.html`. `assemble.mjs` writes this folder, `deploy/dist`. Requests for these files are free and unlimited.
- **The early-alpha notice:** `assemble.mjs` adds `alpha.js` (served at `/alpha.js`) to every page it publishes, the realm's and the blog's, through `notice.mjs`. One dismissal is kept in `localStorage` and hides it on both. To retire it, delete `alpha.js` and its two lines in `assemble.mjs`.
- **`worker.mjs`** runs only for `/releases/*` (the city's pinned release) and `/bay/*` (the road's marks and the landmarks). It sends the quality-11 Brotli copy that `sf/build.mjs` wrote beside each file, unchanged, so the bytes on the wire are the ones the realm's checks measure. Static assets alone can't do this. Setting `Content-Encoding: br` in `_headers` makes the edge compress the file a second time, and the edge doesn't compress `.bay`, `.far` or `.bin` files at all. The edge compresses the code itself, which comes to about 0.25 MB more than the local quality-11 copies.
- **`/weather`** also runs `worker.mjs`. It answers San Francisco's weather now for the realm's "SF now" sky: the latest report from the National Weather Service's SFO station that saw the sky, trimmed, kept ten minutes at the edge and five in the browser. If the service fails, it answers 502 and the sky keeps its own weather. To check it after a deploy, run `curl -s https://zahynailo.dev/weather`.
- **Domains:** `zahynailo.dev` and `www.zahynailo.dev` are custom domains in `cloudflare.config.ts`. A Single Redirect rule on the zone (`www.zahynailo.dev to the apex`) sends www to the apex with a 301 and keeps the path and query. It was set once through the Rulesets API, and deploys don't touch it.
- **The city's data in CI:** the release, the street graphs, the kept car and the eggs' videos live in `~/.village`, not in git. `node deploy/data.mjs pack` bundles them as Brotli into one GitHub Release asset (`sf-data-<digest>`, about 150 MB) and writes `deploy/data.json`. CI runs `node deploy/data.mjs fetch`, checks that the bundle is for the pin in `engine/sf/pilot/current.json` and that every file is the one packed, then builds. Cloudflare uploads only the assets whose hashes changed, so an unchanged release is never uploaded again.

## When the pin or the city's other data moves

On the machine that has `~/.village`, after `engine/sf/pilot/current.json` changes, or after the street graphs, the kept car or the eggs' videos there change:

```sh
node deploy/data.mjs pack     # uploads the new bundle once; writes deploy/data.json
git add deploy/data.json engine/sf/pilot/current.json
```

When the first view changes too (a new pin, the arrival, the lens, the air or the boards), take the loader's pictures again: `cd engine && node sf/loading.mjs`, then commit `engine/sf/loading.json`. The loader (`engine/page/loading.html`) shows that view under fog that burns off as the realm loads and clears onto the live picture, so a stale one shows a different city just before the real one. The build writes each picture beside the page (`loading-wide-<hash>.webp`, `loading-upright-<hash>.webp`), and a visitor fetches only the one their window needs. The build says when `loading.json` came from another release.

If the pin and `deploy/data.json` disagree, CI fails before it deploys. Don't delete old `sf-data-*` releases, because rolling the code back to an older commit needs its bundle.

## Deploy by hand

```sh
cd engine && npm run core && node sf/build.mjs && cd ../site && npm run build && cd ../deploy && npm ci && node assemble.mjs && npx cf deploy
```

## Roll back

Every deploy is a Worker version. To put the previous version back on 100% of traffic, in one command:

```sh
cd deploy && CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account id> npx wrangler rollback --name zahynailo -m "why"
```

Add a version ID after `rollback` to choose another version. `npx wrangler deployments list --name zahynailo` lists them, and each is labelled with the commit it was built from. The domains and the redirect are not part of a version and stay as they are. A failed run doesn't need it. A step that fails before `cf deploy` deploys nothing, and a failed `cf deploy` makes nothing live. When a new version fails the live check that follows (its version on all traffic, the realm's page, the blog and the release's manifest as Brotli), the workflow rolls it back to the previous version itself, and the run fails.

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

## Later

The realm, the site and the Voxelmorphism kit share one repo and one deploy for now. Splitting them into separate repos, each with its own build and deploy, waits until Village goes open source.
