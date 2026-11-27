# Staging and pinning a San Francisco release

How to cut a release with `release.py`. What a release contains, the BAY1 and FAR1 formats and what a reader checks are in [the San Francisco release](../../guide/sf-release.md).

Run every command from the repository root with the Bay's Python:

```sh
PY=~/.village/engine/bay/venv/bin/python
```

## 1. Stage

`ROOT` is a verified `full_run.py` output (`<root>/state.json` and `<root>/packs/`). `OUT` is a staging folder that plays the site's `sf/` folder. The city job stages into `~/.village/engine/bay/sf-450-city/sf` on its own.

```sh
$PY engine/sf/release.py ROOT OUT
```

It checks every object against the run's checkpoint hashes, writes `OUT/releases/<digest>/`, and prints the digest with "panel required to promote". Options:

| Option | Adds |
| --- | --- |
| `--far FAR_JSON` | The far model: the listing `sf/far/pack.mjs` writes, with the `far/<band>/` folders beside it |
| `--life DIR`, `--cars DIR` | Street life from `sf/life.py` and vehicles from `sf/cars.mjs`. Without them, `<root>/life` and `<root>/cars` are used if present. |
| `--graphs DIR` | Street graphs from outside the run. Otherwise `<root>/packs/graph` is used. |
| `--paint BATCH_JSON` | An accepted facade paint batch, written into the level-0 tiles as `SFPT` rows |
| `--compact-store DIR` | Keep tiles as shared zstd bases in `DIR` instead of full copies |
| `--inventory-only` | Write the manifest only, for inspection |

## 2. Promote after the panel

New tiles need the visual panel. Score each of the 16 places in `engine/bay/neighbourhoods.json` at street level and at 100 m, then run the same command with the receipt:

```sh
$PY engine/sf/release.py ROOT OUT --panel RECEIPT [--core CORE_WASM]
```

The receipt is JSON with:

| Field | Value |
| --- | --- |
| `release` | The candidate's digest |
| `previousRelease` | The release `<out>/current.json` pins now, or `null` for the first |
| `coreSha256` | SHA-256 of the tested core Wasm: the page's built core by default, or the file `--core` names |
| `panelSpecSha256` | SHA-256 of `engine/bay/neighbourhoods.json` |
| `scores` | Each place name to `[street, 100 m]`, both numbers from 0 to 10 |

`release.py` moves `<out>/current.json` only if every score is at least the previous pin's and the floor in `engine/bay/panel-floors.json`. It saves the receipt as `panel-<sha256>.json` beside the release. A stale receipt or one lower score leaves the pointer as it was.

## 3. Restock street life, vehicles or the far model

When the tiles stay the same, restage the pinned release with only the new parts. `sf/cars.mjs` cleans each vehicle's finest outside look with `sf/sculpt-cars.mjs` before building coarser looks (specks off, pinholes and edge gaps sealed, nubs smoothed), and `node sf/car-shots.mjs --out DIR` draws each car close up by day and night for before-and-after checks. `ROOT` is unused, so pass `-`:

```sh
$PY engine/sf/release.py --restock --life LIFE_DIR --cars CARS_DIR - OUT
$PY engine/sf/release.py --restock --far FAR_JSON - OUT
$PY engine/sf/release.py --restock --landing LANDING_DIR --base DIGEST - OUT
```

- `--far` takes a listing holding only the far tiles to replace. Its `wedge` and `light` replace the base's.
- `--landing` takes the folder `sf/far/landing.mjs` wrote (its listing and the `far/landing/<key>.far` objects).
- `--base DIGEST` starts from another release staged in `OUT` instead of the one `<out>/current.json` pins.

Restock `--far` first, then cut the first view (`landing.mjs`) from that release and restock `--landing` with `--base` set to it, because a cut holds faces of the tiles it was made from.

A restock checks the base manifest against its digest and stages the changed library in its own directory. macOS clones files on APFS and Linux copies them. A successful restock prints the new digest. It keeps the base tiles and can reuse their panel.

## 4. Pin, build and bundle

1. Make sure the release is under `~/.village/engine/bay/450-city-paint/sf/releases/<digest>/`. `build.mjs` reads it there by default and `data.mjs pack` reads it nowhere else. The city job stages into `~/.village/engine/bay/sf-450-city/sf`, so restock into the paint folder or copy the release folder across.
2. Copy the release's `manifest.json` to `engine/sf/pilot/releases/<digest>/manifest.json`.
3. Put the digest in `engine/sf/pilot/current.json` (`version`, `release`, `manifest`).
4. Run `node engine/sf/build.mjs`. It builds the pinned release from the paint folder and fails if that folder does not hold it. `--staged DIR` builds whatever another staging folder's pointer names. The build fills the quality-11 Brotli cache the bundle needs.
5. Run `node deploy/data.mjs pack` and commit the pin, the manifest copy and `deploy/data.json` together.

Other checkouts keep their own pin, because `build.mjs` takes the release this checkout names.

## Compact storage

With `--compact-store`, a staged release keeps a `.bay-store` link instead of a tiles folder. `build.mjs` and `deploy/data.mjs` export it on their own. To export by hand, all objects or one:

```sh
$PY engine/bay/compact_store.py MANIFEST DESTINATION [--object PATH]
```

The store shares zstd geometry bases and `SFPT` rows across releases. Every hash still describes the decoded bytes, so the public files are the ordinary static format.
