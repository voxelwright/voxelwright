# Baking the San Francisco realm

On the bake Mac, start or resume the detached city job from this branch.

```sh
engine/bay/run-city.sh start
engine/bay/run-city.sh status
```

The launchd job runs a pinned source snapshot under caffeinate. Its log is `~/.village/engine/bay/450-city.log`, with errors in `450-city.err`. The build lives under `~/.village/engine/bay/sf-450-city/`. Each completed task in `state.json` contains SHA-256 checksums. On restart the runner rechecks those files. A changed recipe needs a new output directory. Task logs are under `logs/`. The default disk stop is 15 GiB before a task or retry. Once the tile inventory is complete, the job stages the local release under `sf/` and writes its verified `sf/current.json` pointer last. On APFS the decoded objects are independent copy-on-write files.

### Retained observations

Each `inputs/<square>.zip` holds the six DataSF GeoJSON layers, NAIP RGB and NIR-first PNGs and Mapillary JPEGs with solved camera metadata. Frame coordinates are EPSG:26910. The north-west edge is in `frame.json`; columns run east and rows south. Each raster includes 16 m padding. Ground is a 1 m vertex grid in metres NAVD88. The quarter-metre pixel grids give absolute `top_mm` (int32, minimum for empty), `count`, `multi` (number of returns from multiple-return pulses), `intensity` (mean), and `footprint` (one-based source feature index, zero outside). Max-pool 2×2 tops for the cell bake. Keep fractional footprint coverage and missing returns when resampling for the face bake. The companion `<square>.json.gz` holds street and business observations. After verification, only the disposable raw staging square is removed.

The six pilots total 0.781 GB. At their mean, 155 squares need 20.18 GB before packs, caches and tiles. Allow about 14 GB for those and additional room for the free-space reserve. The detailed measurements and initial time estimate are on #450.

For a later square bake, supply the previous run's inputs to both seed options. The following rebuilds the six pilots and cuts their tiles. `--offline-inputs` requires retained square sources; planet tile generation uses its existing source cache.

```sh
bay="$HOME/.village/engine/bay"
"$bay/venv/bin/python" engine/bay/full_run.py --pilot --offline-inputs \
  --input-seed "$bay/sf-450-city/inputs" --street-seed "$bay/sf-450-city/inputs" \
  --output "$bay/sf-six-rebake"
```

The six original pack and name pairs qualify as seeds only when they match the pilot checksums. The appearance pass runs on both seeded and newly built squares. For an offline rebuild from the archives alone, also pass `--seed /dev/null`. The full run writes a blended tile inventory, known sea keys, names and street graphs. See the [static release contract](../sf/release.md) and [street graph contract](../sf/streets.md).

## Coverage

[sf-squares.json](sf-squares.json) lists every 1 km square touching the DataSF *SF Shoreline and Islands* polygons. The grid's southwest corners end in 700 m east and 500 m north in EPSG:26910. The 155 lidar candidates intersect both county land and a populated depth-six EPT node. The other 11 are planet-made, including the Farallones. The node intersection gives a candidate for acquisition. It cannot certify returns on every patch of land. A square without usable project samples fails the bake.

`coverage.py` regenerates this inventory from DataSF and the USGS project hierarchy. The inventory records hashes of both source responses. The full run uses the checked-in inventory. Around every county square, including islands, it schedules the planet tiles for a 500 m near margin, 4 km middle margin and 16 km far margin. These cover the default desktop world's boxes as the visitor moves around county land. The job cuts overlapping lidar packs together where a tile crosses a seam. Each tile key has one output owner.

## Frontages and pictures

The four pilot locations used individual Mapillary panoramas. To sample another selected frontage, supply one square pack, the place in frame metres and a local observations file. For example, the Financial District sample is at x=52580 and z=66743. `frontage.py` gets the Mapillary image-point tile for that place, selects nearby panoramas and samples a low band of visible walls. The output keeps colour indices and source image IDs. Photos stay beside the local observations. Inspect the result against a matched view before incorporating new observations into a release. The full run samples geographically distributed panoramas, takes visible wall colours where two cameras agree or a near, road-facing panel has consistent paint, estimates material and ground-floor use, filters roof returns and draws surveyed crowns and mapped street detail.

To open the measured six-square build on this Mac, from `engine/` run

```sh
VILLAGE_BAY_ROOT="$HOME/.village/engine/bay/pilot450/final-release" node serve.mjs --port 5938
```

Open `http://127.0.0.1:5938/city?bay=1`. The same `VILLAGE_BAY_ROOT` selects the ground pack for `bay/shot.mjs`. The shot tool gets its GPU turn through `test/kit.mjs`. Paired street views and the 100 m contact sheet are in `~/.village/engine/bay/pilot450/pairs/`. The original two-square installation is backed up in `~/.village/engine/bay/pilot450/backup/`.


To repeat the neighbourhood comparison, run the pilot and publication servers in turn with their respective releases as `VILLAGE_BAY_ROOT`. From the repository root use `engine/bay/recognition.py before --release PATH --port PORT` and `engine/bay/recognition.py final --release PATH --port PORT` with the Bay Python interpreter. The reference cameras are fixed. Run `recognition.py sheet` to compose the pictures. The street reference is the solved panorama at an estimated 2.5 m camera height. At 100 m the reference is a north-up NAIP orthophoto cropped to the ground-plane field of view. Roof displacement on tall buildings differs between that projection and a perspective camera.
