---
title: The city pipeline
description: How public San Francisco data becomes the pinned, content-addressed release a realm loads.
---

San Francisco in the engine is baked from public data. Python scripts in `engine/bay` fetch the sources for each 1 km square, bake each square into a pack, and cut the packs into tiles. `engine/sf/release.py` stages the tiles, street graphs, street life, vehicles and far model as one content-addressed release. `engine/sf/build.mjs` turns the pinned release into a static realm that any file host can serve. The files each stage writes are specified in [the San Francisco release](/sf-release).

Raw and baked data live under `~/.village/engine`, never in git. Git holds the code, the square inventory ([sf-squares.json](https://github.com/voxelwright/voxelwright/blob/main/engine/bay/sf-squares.json)), the pin (`engine/sf/pilot/current.json`), a copy of each pinned manifest and `deploy/data.json`.

## Squares

`sf-squares.json` lists every 1 km square that touches DataSF's shoreline polygons: 155 squares with lidar (`lidar`) and 11 made from planet data (`planet`), offshore islands among them. A square is named by the kilometres of its south-west corner in UTM zone 10N, for example `551.7_4183.5`. `coverage.py` regenerates the list from DataSF and the USGS lidar project, and records a hash of each response.

The release pinned now names all 155 lidar squares. Around them, the run cuts planet tiles from Overture and Mapterhorn out to 500 m, 4 km and 16 km at the three levels (`RADIUS` in `full_run.py`).

## Stages

```mermaid
flowchart TD
  Sources["Public sources<br/>USGS 3DEP lidar and DEM, NAIP, DataSF,<br/>OSM, Overture, Mapterhorn, Mapillary, SF Public Works"]
  Inputs["fetch.py + intermediate.py<br/>inputs/&lt;square&gt;.zip + sidecars"]
  Bake["bake.py + appearance.py<br/>one BAY1 pack a square"]
  Graph["street_graph.py, transport.py<br/>graph/&lt;square&gt;.json"]
  Tiles["tiles.py + earth.py<br/>tiles at 3 levels"]
  Life["sf/life.py, sf/cars.mjs<br/>street life and vehicles"]
  Far["sf/far: bake.py, pack.mjs, landing.mjs<br/>far model"]
  Release["sf/release.py<br/>stage, then promote with a panel receipt"]
  Pin["engine/sf/pilot/current.json<br/>(committed)"]
  Build["sf/build.mjs<br/>engine/dist-sf"]
  Data["deploy/data.mjs pack<br/>GitHub Release sf-data-..."]
  Sources --> Inputs --> Bake --> Tiles --> Release
  Inputs --> Graph --> Release
  Graph --> Life --> Release
  Inputs --> Far --> Release
  Release --> Pin --> Build
  Pin --> Data -- "deploy/data.mjs fetch" --> Build
```

| Stage | Reads | Writes |
| --- | --- | --- |
| `engine/bay/fetch.py SQUARE` | EPT lidar, the 1 m DEM, NAIP imagery and DataSF layers (`EPT`, `DEM`, `NAIP`, `SF`, `LAYERS` at its top) | Raw downloads under `~/.village/engine/bay/raw/<square>/` |
| `engine/bay/intermediate.py` | The raw downloads | `inputs/<square>.zip`: quarter-metre lidar grids, the 1 m ground, imagery and the DataSF layers in EPSG:26910 |
| `engine/bay/street_sources.py`, `street_detail_sources.py` | OSM, DataSF, San Francisco Public Works, Mapillary | Gzip JSON sidecars beside each ZIP: OSM geometry and business categories, extra outlines and parcel facts, stop signs, street fixtures |
| `engine/bay/bake.py` and `appearance.py` | One square's archive (restored to `raw/<square>/`) and sidecars | One `BAY1` pack for the square, with wall colours and facade cues, and its names file |
| `engine/bay/street_graph.py` | One square's street sidecar | `graph/<square>.json`, the routable [street graph](https://github.com/voxelwright/voxelwright/blob/main/engine/sf/streets.md) |
| `engine/bay/transport.py ROOT OUT` | The graphs, a city-wide OSM tag extract, DataSF stop signs and signals | The graphs with road levels and traffic controls added |
| `engine/bay/tiles.py` | Packs. `earth.py` makes tiles from Overture and Mapterhorn where no square reaches. | Tiles at level 0 (250 m), level 1 (1 km) and level 2 (4 km), each a `BAY1` pack, and `index.json` |
| `engine/sf/life.py` | Street graphs and land use | `<square>.json` for walking, driving, parking, rails and signal heads, `transit.json`, and `index.json` |
| `engine/sf/cars.mjs OUT` | The kept-car shelf and the hand-built fleet (`engine/sf/fleet.mjs`, the GT coupe from `engine/page/car-sculpt.ts`) | The vehicle library: each car's finest look cleaned (`engine/sf/sculpt-cars.mjs`: specks off, pinholes and edge leaks sealed, nubs smoothed), coarser looks that keep their shells, repaint variants and `index.json`. `engine/sf/car-shots.mjs` draws each car close up for before-and-after checks. |
| `engine/sf/far/grow.sh` | The square archives | The far model's faces, packed into far tiles and their listing ([far README](https://github.com/voxelwright/voxelwright/blob/main/engine/sf/far/README.md)) |
| `engine/sf/release.py ROOT OUT` | `full_run.py`'s verified output, and optionally the far model, street life, cars and an accepted paint batch | A staged release under `OUT/releases/<sha256>/`. With `--panel RECEIPT` it also moves `OUT/current.json`. |
| `engine/sf/build.mjs` | The release pinned in `engine/sf/pilot/current.json`, the city's street graphs, a kept car | `engine/dist-sf`: the page's modules with types stripped, the realm's record from `engine/sf/realm.json`, the release, the road marks and map, and a Brotli copy beside every file |
| `deploy/data.mjs pack` | The pinned release and the other build inputs under `~/.village/engine` | A bundle uploaded as GitHub Release `sf-data-<16 hex>`, and `deploy/data.json` |
| `deploy/data.mjs fetch` | `deploy/data.json` and the bundle | The same files restored under `$HOME/.village/engine`, each checked by length and SHA-256 |

`engine/bay/full_run.py` runs fetch, the inputs, bake, appearance, street graphs and tiles as checkpointed tasks. Each finished task records SHA-256 checksums in `state.json`, and a restart checks them again. A changed recipe needs a new output directory. `engine/bay/run-city.sh start` runs the whole city as a detached job on the bake machine and stages its release when the tiles are done. [engine/bay/README.md](https://github.com/voxelwright/voxelwright/blob/main/engine/bay/README.md) is the operator's guide.

## Street life and street paint

Two things in the realm come from the street graphs rather than the tiles:

- **Street life.** `life.py` cuts each graph down to what people walk and cars drive, with how busy each pavement is from nearby land use, parked-car places and signal heads. `cars.mjs` writes the kept vehicles. Both go into the release as its `life` and `cars` sections, and `page/street.ts` reads them.
- **Street paint.** Lane lines, centre lines, crossings and rails are drawn by the march as lines over the asphalt (`page/marks.ts`), not as cells. `build.mjs` writes them to `<out>/bay/marks.bin` in its output folder, from the city's graphs with `sf/marks.mjs`, plus two committed files the graphs do not hold: `sf/street-tags.json` (rails by gauge, the grid's ways, tunnels and bridges, from `sf/street-tags.py`) and `sf/crossing-colours.json` (yellow and rainbow crossings, from `sf/crossing-colours.mjs`). The build fails without the graphs.

`build.mjs` also writes `<out>/bay/map.bin` for the minimap and GPS from the release's tiles and the graphs (`sf/map.mjs`).

## Pins and what is committed

Two small files tie a checkout to its data:

- `engine/sf/pilot/current.json` names the release this checkout's realm uses: `{version, release, manifest}`. Moving it is the change that ships new city data.
- `deploy/data.json` names the bundle that holds that release for machines without `~/.village`: `{pin, digest, tag}`. `fetch` refuses a record whose `pin` is not the release in `current.json`, and a bundle whose index does not hash to `digest`.

`./world` (the [quickstart](/quickstart)) runs `engine/core/build.mjs`, `deploy/data.mjs fetch` and `engine/sf/build.mjs` in that order, with `HOME` set to `.voxelwright` in the checkout so the realm uses only its pinned inputs. Then it serves `engine/dist-sf` on port 5760.

To build a staged candidate before it is pinned, run `node engine/sf/build.mjs --staged STAGE`, where `STAGE` is the folder holding its `current.json`. To bundle it without uploading, run `node deploy/data.mjs pack-local PIN DIRECTORY`.

## Promotion

A release with new tiles must pass a visual panel before its pointer moves. `release.py` stages a candidate and prints its digest. A person or agent scores the 16 fixed cameras in `engine/bay/neighbourhoods.json` against reference photographs, at street level and at 100 m. `--panel RECEIPT` moves the pointer only when no score falls below the previous pin or the floors in `engine/bay/panel-floors.json` (`check` in `engine/bay/panel_gate.py`). A restock that changes only street life, vehicles or the far model keeps the tiles, so it needs no panel. [Cut a new release](/sf-release#cut-a-new-release) lists the steps.

## Licences

Every layer keeps its own terms, listed in [DATA-LICENSES.md](https://github.com/voxelwright/voxelwright/blob/main/DATA-LICENSES.md). Rules for all of it are in the `bay-sources` skill (`.agents/skills/bay-sources/SKILL.md`):

- Requests carry a generic client name and no personal detail.
- A source that needs a key is not used until the owner provides one. Keys live under `~/.village/engine/bay/keys/`, never in git or a log.
- Layers derived from Mapillary (CC BY-SA) stay separable and keep their image credits.

The shipped city includes public street lamp positions and trolley wire paths from San Francisco Public Works, whose layer records state no licence. The owner chose to include them. `--no-public-works-fixtures` bakes lamps and wires from OSM alone; start a fresh output directory when switching. Adding a source means adding its row to `DATA-LICENSES.md` and to the skill, with how its terms were checked.

## Check a change

```sh
~/.village/engine/bay/venv/bin/python -m unittest discover -s engine/bay -p 'test_*.py'
cd engine && npm run sf      # the realm's checks in Chrome
```

`node engine/test/street.mjs` checks the street paint and cars, and `node engine/test/sf-life.mjs` checks street life.

A change to `bake.py` or `tiles.py` changes tile bytes, so it needs a new release and a new panel pass before the pin moves. A change to how `bay.rs` reads a pack must keep reading the pinned release's tiles, or move the pin in the same change.
