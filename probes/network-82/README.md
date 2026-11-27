# Network spike (#82)

Spike prototypes for [#82](https://github.com/voxelwright/voxelwright/issues/82): how many requests, Worker
invocations and bytes voxelwright.world costs a visitor, and what packing, bundling and a nearer far radius would
save. Nothing here is a check or part of `npm run check`. The report is a comment on the issue.

Every script reads a built realm (`engine/dist-sf`, from `node engine/sf/build.mjs`) and writes nothing into it.

| Script | What it does |
| --- | --- |
| `measure.mjs` | The realm's network waterfall in headless Chrome with WebGPU: cold landing, cold explore, warm landing, warm explore. Counts the page's and its workers' requests over raw CDP, and which went to the network. Against the live site (`--url`) or a local build served with the live host's cache headers (`--local`, optionally `--overlay`). Takes a GPU turn. |
| `series.mjs` | Several `measure.mjs` runs on one GPU turn. |
| `pack.mjs` | The pack format: one object holding many files. |
| `pack-bench.mjs` | Bytes and requests of packing the landing's cut, band 0, names, life and cars, against a Brotli stream per file. |
| `pack-release.mjs` | Writes an overlay with the landing's cut and band 0 as packs, for `?farpacks=`. |
| `bundle-bench.mjs` | Bundles the page with esbuild (not a dependency: pass `--esbuild <dir>`) and weighs it against one file per module. Its output does not run. |
| `far-rings.mjs` | The far model's files, or a run's far requests, by distance from the eye and by whether the tile was in view. |
| `replay.mjs` | A measured run played back under each proposed change, to count the Worker requests left. A model on a measurement. |
| `overfetch.mjs` | Band 0's requests and bytes for packs of 1, 2 and 4 km, for the tiles a measured run asked for. |
| `decompression.mjs` | Which codecs Chrome's `DecompressionStream` takes (gzip only, in Chrome 158). |
| `cost-model.mjs` | A month's Cloudflare bill at 1k to 1M visitors a day, from the measured requests and the published prices. A model. |

`engine/page/far.ts` carries the one engine change: behind `?farpacks=<index.json>` it reads far objects out of
packs. Without the parameter nothing changes.

```sh
D=engine/dist-sf                                    # a built realm
R=$D/sf/releases/$(node -p "require('./engine/sf/pilot/current.json').release")
node probes/network-82/pack-bench.mjs --release $R
node probes/network-82/far-rings.mjs --release $R
node probes/network-82/pack-release.mjs --dist $D --out /tmp/overlay
node probes/network-82/series.mjs --dist $D --overlay /tmp/overlay --out /tmp/runs --live https://voxelwright.world/
node probes/network-82/far-rings.mjs --release $R --log /tmp/runs/live.json
node probes/network-82/bundle-bench.mjs --esbuild <dir with esbuild installed> --landing /tmp/runs/local-baseline.json
node probes/network-82/cost-model.mjs --bounce <n> --explore <n>
```

A live run spends the Worker's daily requests (about 1,800 for the four phases).
