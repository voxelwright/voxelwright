# Baking the San Francisco realm

From the repository root on the bake Mac, start or resume the city and its horizon with

```sh
~/.village/engine/bay/venv/bin/python engine/bay/full_run.py
```

The run writes to `~/.village/engine/bay/sf-450-release/`. Allow roughly 12–16 hours and 20 GB free for a serial run. The pilot measurements and camera comparisons are on issue 450. The script has no deployment step.

- `state.json` records the recipe and SHA-256 of each completed pack, names file and tile. Unbuilt work resumes after an interruption. A resumed run rechecks recorded hashes. Restore a changed file from a known copy, or start a fresh release with `--output NEW_DIRECTORY`. Use a new directory for a changed recipe.
- `logs/<square>.log` records fetch and bake attempts. Raw inputs for a square are removed from this release's staging area after the pack and names pass verification. DEM sheets and the planet producer's existing source cache are reusable. The default `--free-gib 6` checks available space before each square, tile group and retry.
- `--seed DIRECTORY` can point at existing packs. Only the six pack/name pairs matching `pilot-hashes.json` are adopted. The default points at the pilot on this Mac. Fresh bakes match lidar crowns to DataSF tree positions and apply recorded frontage observations by footprint vertex. The pilot's two original packs are preserved as measured.
- `--pilot` limits the build to six squares and their blended tiles. To repeat the pilot in a fresh directory, use `--pilot --output ~/.village/engine/bay/sf-six`.
- Once all tasks verify, `packs/tiles/index.json` lists the three tile levels, names files and known sea keys. Files in `packs/tiles/{0,1,2}/` are uncompressed BAY1. For static serving, publish that inventory with its release and have the player resolve sea locally. The current development page still asks its server for missing tiles.

## Coverage

[sf-squares.json](sf-squares.json) lists every 1 km square touching the DataSF *SF Shoreline and Islands* polygons. The grid's southwest corners end in 700 m east and 500 m north in EPSG:26910. The 155 lidar candidates intersect both county land and a populated depth-six EPT node. The other 11 are planet-made, including the Farallones. The node intersection gives a candidate for acquisition. It cannot certify returns on every patch of land. A square without usable project samples fails the bake.

`coverage.py` regenerates this inventory from DataSF and the USGS project hierarchy. The inventory records hashes of both source responses. The full run uses the checked-in inventory. Around every county square, including islands, it schedules the planet tiles for a 500 m near margin, 4 km middle margin and 16 km far margin. These cover the default desktop world's boxes as the visitor moves around county land. The job cuts overlapping lidar packs together where a tile crosses a seam. Each tile key has one output owner.

## Frontages and pictures

The four pilot locations used individual Mapillary panoramas. To sample another selected frontage, supply one square pack, the place in frame metres and a local observations file. For example, the Financial District sample is at x=52580 and z=66743. `frontage.py` gets the Mapillary image-point tile for that place, selects nearby panoramas and samples a low band of visible walls. The output keeps colour indices and source image IDs. Photos stay beside the local observations. Inspect the result against a matched view before incorporating new observations into a release. The full run reuses the reviewed values in `pilot-frontages.json` and makes no citywide photo requests.

To open the measured six-square build on this Mac, from `engine/` run

```sh
VILLAGE_BAY_ROOT="$HOME/.village/engine/bay/pilot450/final-release" node serve.mjs --port 5938
```

Open `http://127.0.0.1:5938/city?bay=1`. The same `VILLAGE_BAY_ROOT` selects the ground pack for `bay/shot.mjs`. The shot tool gets its GPU turn through `test/kit.mjs`. Paired street views and the 100 m contact sheet are in `~/.village/engine/bay/pilot450/pairs/`. The original two-square installation is backed up in `~/.village/engine/bay/pilot450/backup/`.
