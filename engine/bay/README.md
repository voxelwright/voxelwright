# Baking San Francisco

The Python here turns public data into San Francisco's tiles: it fetches each 1 km square, bakes it into a `BAY1` pack, builds its street graph and cuts the packs into tiles at three levels. `engine/sf/release.py` then stages the tiles as a release. The stages are explained in [the city pipeline](../../guide/city-pipeline.md), and the files they produce in [the San Francisco release](../../guide/sf-release.md).

Everything this writes lives under `~/.village/engine/bay`, never in git. Run the commands from the repository root with the Bay's Python, `~/.village/engine/bay/venv/bin/python`. The scripts import numpy, Pillow, laspy (with lazrs), tifffile, pyproj and shapely, and `earth.py` also needs pmtiles and mapbox-vector-tile.

## Bake one square

To try a change on one square and look at it in the page server:

```sh
PY=~/.village/engine/bay/venv/bin/python
$PY engine/bay/fetch.py 551.7_4183.5      # raw data into ~/.village/engine/bay/raw/<square>/
$PY engine/bay/bake.py 551.7_4183.5       # the pack and names in ~/.village/engine/bay/packs/
$PY engine/bay/tiles.py                   # cut every baked square into tiles
cd engine && node serve.mjs --port 5920   # then open http://127.0.0.1:5920/city?bay=1
```

`VILLAGE_BAY_ROOT` points these scripts and the page server at another root than `~/.village/engine/bay`.

## Run the city

On the bake Mac, start or resume the detached city job, and check on it:

```sh
engine/bay/run-city.sh start
engine/bay/run-city.sh status
```

`start` snapshots the committed source and submits a launchd job under `caffeinate`. The job runs `full_run.py --compact` into `~/.village/engine/bay/sf-450-city/`, then `release.py` to stage the release under its `sf/` folder, and then removes itself from launchd. The log is `~/.village/engine/bay/450-city.log`, with errors in `450-city.err`. `status` counts the finished inputs, squares and tile groups in `state.json` and shows free disk.

`full_run.py` runs each step as a checkpointed task. A finished task records SHA-256 checksums in `state.json`, and a restart checks them again. A changed recipe needs a new output directory. The one exception is the street fixture rule (`CUT_RULE`): a state recorded under another rule cuts its level-0 tiles again and keeps its verified squares. Before each task it checks free disk (`--free-gib`, 15 GiB by default and at least 18 with `--compact`): a plain run stops with its state saved, and a `--compact` run, as the city job is, waits for room.

For a smaller run, `--pilot` bakes the six squares in `PILOT`. With `--offline-inputs`, the square bake reads its retained observations from the seed directories. The tile cutter can still request Overture and terrain data where a tile extends beyond a survey.

```sh
bay="$HOME/.village/engine/bay"
"$bay/venv/bin/python" engine/bay/full_run.py --pilot --offline-inputs \
  --input-seed "$bay/sf-450-city/inputs" --street-seed "$bay/sf-450-city/inputs" \
  --detail-seed "$bay/sf-450-city/inputs" --output "$bay/sf-six-rebake"
```

Once a city release is staged, score it and promote it as [release.md](../sf/release.md) describes.

## Squares

[sf-squares.json](sf-squares.json) lists every 1 km square touching DataSF's shoreline polygons: 155 with lidar and 11 made from planet data. Square corners end in 700 m east and 500 m north in EPSG:26910. A lidar square is one that intersects county land and a populated node of the USGS lidar index; a square without usable samples fails the bake. `coverage.py` regenerates the file and records a hash of each source response. Around every county square the run cuts planet tiles out to 500 m, 4 km and 16 km at the three levels.

During inventory generation, `coverage.py` calls `node engine/sf/landmark-tiles.mjs --json` to find landmark approaches beyond the county coverage. The full bake includes those tile addresses from `landmarkExtras`. After staging, run `node engine/sf/landmark-audit.mjs --manifest PATH` against the candidate's manifest to check coverage.

## Retained observations

`fetch.py` downloads one square into `raw/<square>/`. `intermediate.py` keeps what the bakes need as `inputs/<square>.zip`, in EPSG:26910 with the north-west edge in `frame.json` and 16 m of padding:

- the DataSF layers as GeoJSON (footprints, streets, curbs, addresses, trees, land use);
- a 1 m ground grid in metres (NAVD88);
- quarter-metre lidar grids: `top_mm`, `count`, `multi`, `intensity` and `footprint` (each pixel's building, counted from 1);
- NAIP colour and near-infrared imagery.

Beside each ZIP are gzip JSON sidecars, each naming its `square`:

| Sidecar | Contents |
| --- | --- |
| `<square>.json.gz` | OSM ways, nodes and relations with the tags the street bake reads, and DataSF registered-business categories and coordinates (no names) |
| `<square>.detail.json.gz` | Extra DataSF outlines, OSM building ways, visible fixtures and wires, and Assessor year, units and storeys by parcel |
| `<square>.stops.json.gz` | Mapillary stop-sign points |
| `<square>.fixtures.json.gz` | San Francisco Public Works street lights and trolley wires, and Mapillary utility poles |

`full_run.py` collects them on its own. `street_detail_sources.py DESTINATION ARCHIVES...` collects the detail, fixture and stop sidecars separately. Public Works fixtures are included by default; `--no-public-works-fixtures` bakes lamps and wires from OSM alone, and needs a fresh output directory.

## What the bake infers

- **Buildings.** Outlines come from DataSF, repaired where lidar shows a building the outlines miss. Each square's `audits/<square>.json` records source ids with low lidar coverage and what remained after repair.
- **Facades.** Near packs carry facade cues in each outline vertex's flags: an eave height, and residential bays, cornice, garage, stoop, awning and fire escape. They are inferred from parcel use, building age, storeys, units, frontage and the ground-floor classifier.
- **Streets.** Kerbs and flush crossings are class bits on pavement samples. At level 0 the road surface follows the ground in 2.5 cm steps.
- **Trees.** Trunks are aligned to the DataSF tree inventory, crown heights reject isolated returns, and the leaf colour comes from NAIP colour and near-infrared.
- **Fixtures.** Lamps, poles, signs and wires go in each pack's `SFST` trailer. Heights of masts, signs and hydrants are typical values, not measured. A utility span inferred from lidar needs narrow raised returns along it and photo-supported poles at both ends.

For a fixed-camera comparison of two built releases, run `node engine/sf/landmark-shots.mjs --dist /path/to/dist-sf --out /path/to/shots` from the repository root for each build. Each image has a sibling JSON file with the requested camera, the rendered eye and forward vector, and the release and renderer digests. The [city pipeline](../../guide/city-pipeline.md#place-and-check-a-landmark) shows how to reproduce a surveyed roof surface and use the neighbourhood poses.

## The recognition panel

Every release with new tiles is judged at 16 fixed places (`neighbourhoods.json`), each at street level and from 100 m, against a solved Mapillary panorama and a NAIP crop. `panel-floors.json` holds the lowest score each view may have.

```sh
PY=~/.village/engine/bay/venv/bin/python
$PY engine/bay/neighbourhood_panel.py stage --release DEST --places PLACE ...
$PY engine/bay/neighbourhood_panel.py capture --release DEST --port PORT --phase baseline --places PLACE ...
$PY engine/bay/neighbourhood_panel.py sheet --phase baseline --places PLACE ...
$PY engine/bay/panel_gate.py --shots FOLDER     # the pixel gate on any folder of <place>-0.png and <place>-1.png
```

Start the engine's page server with `VILLAGE_BAY_ROOT=DEST` between `stage` and `capture`. `panel_gate.py` reads each picture before any score counts: thin uprights in the sky beyond the photograph's, shade on the street bluer than red by more than 22 (`SHADE_BLUE`), and a vision judge (`JUDGE_MODEL` in `render_checks.py`) that fails a defect two readings both name.

## Facade paint and evidence

Wall paint from street photographs is a separate, slower job:

```sh
engine/bay/run-paint.sh start     # from the worktree root: installs the survey as a LaunchAgent
engine/bay/run-paint.sh status
```

It works under `~/.village/engine/bay/450-city-paint/`. Workers survey street windows from Mapillary panoramas within a shared request budget, and each batch is judged on the panel before it is accepted. While a `hold-acceptance` file exists there, no panel or publication runs. Accept a pending batch with `city_panel.py accept --batch HASH [--scores FILE]`. An accepted batch enters a release through `release.py --paint`, and `paint_publication.py` stages the combined city release.

`facade_evidence.py` reads photographs as evidence for a building's wall colour, material, windows and awning, instead of painting pixels. Its models and environment are in the `facade-evidence` skill. A tile cut with `VILLAGE_FACADE_EVIDENCE=<records folder>` carries the records; without it the tiles are unchanged. Leave it unset for releases: the measured wall lightness is too dark to trust yet.

## Files

| File | What it does |
| --- | --- |
| `coverage.py` | Rebuilds `sf-squares.json` |
| `fetch.py`, `intermediate.py`, `dem.py` | Downloads a square and keeps its retained archive |
| `street_sources.py`, `street_detail_sources.py`, `street_inputs.py` | The street sidecars and which of them a recipe reads |
| `bake.py`, `appearance.py`, `surface_detail.py`, `street_detail.py`, `street_trees.py`, `street_furniture.py` | One square's pack: ground, buildings, facades, surfaces, trees and fixtures |
| `street_graph.py`, `transport.py`, `transit_platforms.py` | The street graph, its road levels and controls, and measured boarding islands and rails |
| `tiles.py`, `earth.py` | Cuts packs into tiles. `earth.py` makes tiles anywhere from Overture and Mapterhorn. |
| `full_run.py`, `run-city.sh` | The checkpointed city run and its launchd job |
| `compact_store.py` | zstd storage for tiles, and export of a compact release |
| `neighbourhood_panel.py`, `recognition.py`, `panel_gate.py`, `render_checks.py` | The recognition panel and its pixel gate |
| `run-paint.sh`, `paint_service.py`, `city_paint.py`, `city_panel.py`, `paint_*.py`, `facade_paint.py`, `frontage.py`, `frontage_tiles.py`, `panoramas.py` | The facade paint survey |
| `lookaround.swift` | A probe of Apple Look Around coverage |
| `facade_evidence.py`, `evidence_*.py` | Facade evidence from photographs |
| `shot.mjs`, `quiet.mjs` | Pictures of the baked place, and running a command with GPU turns held |

## Check a change

```sh
~/.village/engine/bay/venv/bin/python -m unittest discover -s engine/bay -p 'test_*.py'
```

A change to `bake.py` or `tiles.py` changes tile bytes, so it needs a new release and a panel pass before the pin moves.
