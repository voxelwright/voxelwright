# Baking the San Francisco realm

On the bake Mac, start or resume the detached city job from this branch.

```sh
engine/bay/run-city.sh start
engine/bay/run-city.sh status
```

The launchd job runs a pinned source snapshot under caffeinate. Its log is `~/.village/engine/bay/450-city.log`, with errors in `450-city.err`. The build lives under `~/.village/engine/bay/sf-450-city/`. Each completed task in `state.json` contains SHA-256 checksums. On restart the runner rechecks those files. A changed recipe needs a new output directory. Task logs are under `logs/`. The default disk stop is 15 GiB before a task or retry. Once the tile inventory is complete, the job stages the local release under `sf/` for panel scoring. After all 32 views pass, promote its pointer with the receipt described in `engine/sf/release.md`. On APFS the decoded objects are independent copy-on-write files.

### Retained observations

Each `inputs/<square>.zip` holds the six DataSF GeoJSON layers, NAIP RGB and NIR-first PNGs and Mapillary JPEGs with solved camera metadata. Frame coordinates are EPSG:26910. The north-west edge is in `frame.json`; columns run east and rows south. Each raster includes 16 m padding. Ground is a 1 m vertex grid in metres NAVD88. The quarter-metre pixel grids give absolute `top_mm` (int32, minimum for empty), `count`, `multi` (number of returns from multiple-return pulses), `intensity` (mean), and `footprint` (one-based source feature index, zero outside). Max-pool 2×2 tops for the cell bake. Keep fractional footprint coverage and missing returns when resampling for the face bake. The companion `<square>.json.gz` holds street and business observations. After verification, only the disposable raw staging square is removed.

The six pilots total 0.781 GB. At their mean, 155 squares need 20.18 GB before packs, caches and tiles. Allow about 14 GB for those and additional room for the free-space reserve. The detailed measurements and initial time estimate are on #450.

For a later square bake, supply the previous run's inputs to both seed options. The following rebuilds the six pilots and cuts their tiles. `--offline-inputs` requires retained square sources; planet tile generation uses its existing source cache.

```sh
bay="$HOME/.village/engine/bay"
"$bay/venv/bin/python" engine/bay/full_run.py --pilot --offline-inputs \
  --input-seed "$bay/sf-450-city/inputs" --street-seed "$bay/sf-450-city/inputs" \
  --detail-seed "$bay/sf-450-city/inputs" \
  --output "$bay/sf-six-rebake"
```

The six original pack and name pairs qualify as seeds only when they match the pilot checksums. The appearance pass runs on both seeded and newly built squares. For an offline rebuild from the archives alone, also pass `--seed /dev/null`. The full run writes a blended tile inventory, known sea keys, names and street graphs. See the [static release contract](../sf/release.md) and [street graph contract](../sf/streets.md).

### Street-level publication

Three gzip JSON sidecars extend each square. Both include its `square` name. The quarter-metre ZIP remains the source of ground, surface, imagery and original footprint IDs.

| Sidecar | Contents |
|---|---|
| `inputs/<square>.detail.json.gz`, version 1 | Additional DataSF outlines from a polygon intersection query (WGS84), OSM closed building ways, visible fixtures and wire paths, and 2025 Assessor year, units and storeys by parcel. OSM geometry is in global 10 cm engine cells. |
| `inputs/<square>.stops.json.gz`, version 1 | Mapillary stop-sign points in global engine cells. The bake groups repeated sightings within 2.5 m and matches them to OSM control nodes within 11 m. |
| `inputs/<square>.fixtures.json.gz`, version 2 | Public Works map layers 36 and 48, respectively street-light points and trolley overhead polylines, plus Mapillary utility-pole points. All coordinates are global engine x,z cells. |

To collect these sidecars separately, run `street_detail_sources.py DEST INPUTS/*.zip` with the Bay Python environment. The full run collects and checkpoints the sidecars automatically. Sources include the [Assessor roll](https://data.sf.gov/d/wv5m-vpq2), the [Public Works map](https://bsm.sfdpw.org/mapviewer/) and [Mapillary point features](https://help.mapillary.com/hc/en-us/articles/115002332165-Map-features).

The publication pass checks DataSF polygons against BAY1 outlines and above-ground roof samples. Each square's `audits/<square>.json` records the source IDs with under 80% stand coverage and the IDs remaining after repair. The sweep measures polygon parts covering at least four square metres inside the padded raster. New stands require independent mapped outlines and elevated, locally consistent lidar. Low coverage can reflect a demolished building or a clipped piece of a larger building. Shared margins can appear in two audits.

Near packs carry facade cues in the existing signed 32-bit vertex flags. Bits 0–2 keep their original meanings. Bit 7 enables the signed 16-bit eave height in bits 8–23, in cells above engine zero. Bits 24–29 select residential bays, cornice, garage, stoop, awning and fire escape on that edge. Assignment uses parcel occupancy, building age, storeys, units, frontage direction and the ground-floor classifier. These are architectural inferences. On pavement, class bit 7 selects a two-cell surveyed kerb and bit 5 a flush crossing.

When a square or L0 tile contains fixtures, its last trunk is followed by ASCII `SFST`, a little-endian uint32 segment count and that many eight-int32 records. A record contains start x,y,z, end x,y,z in global cells, radius in centimetres and material kind. The section is optional. The tile cut carries crossing segments into both adjoining tiles. Elevations and dimensions of municipal masts, signs and hydrants are typologies. A utility span inferred from lidar requires narrow, elevated returns along its path and photo-supported pole endpoints. Timber is the inferred material for untyped utility poles. Nearby overhead cables occupy quarter cells (2.5 cm) along their measured segments.

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

For the 16-place recognition panel, `neighbourhoods.json` pins each spherical image and street bearing. From the repository root, use the Bay Python interpreter to run `engine/bay/neighbourhood_panel.py stage --release DEST --places ...`, then start the engine page server with `VILLAGE_BAY_ROOT=DEST`. Run `neighbourhood_panel.py capture --release DEST --port PORT --phase baseline --places ...` against that server. The six original pilot squares share one staged release. Each additional panel square uses its own staged release with the regular planet fallback outside the square. Keep the same group at each pass. The camera height comes from the unchanged retained DEM or a pinned pilot elevation. Each camera captures a 70-degree vertical field of view at 960 × 540. The two references are the solved street panorama and its matching 100 m north-up NAIP crop. `neighbourhood_panel.py sheet --phase baseline ...` composes the comparisons under `~/.village/engine/bay/450-panel/`. A draft-in-progress city release may prioritize panel acquisition by listing its square names in `priority.json` beside `state.json`.

Near tiles give surveyed geometry ownership of its whole covered area. At a genuine survey boundary the cutter clips fallback building polygons to the unmeasured side. For open road samples, class bit 7 enables the pavement grey stored in the tint byte. The bake estimates daylight reflectance in 16 m patches from neutral, low, unmarked NAIP and lidar samples. At the nearest level the road top follows the interpolated DEM in 2.5 cm increments.

Crown heights reject isolated quarter-metre lidar returns. The foliage tint comes from NAIP RGB and near-infrared observations within the crown. Trunks are aligned to the DataSF tree inventory before measuring the crown radius, including when a pilot pack supplies the starting geometry. Where branches overhang a road, the engine uses the crown tint for the leaves and nearby surveyed asphalt for the ground below.

### Candidate facade surveys

Keep the city acquisition on its pinned recipe. A local paint survey takes a square pack, its retained camera data and a named 180 m × 180 m street window. The sixteen panel reference images are reserved for judging. The following commands run from the repository root in the Bay Python environment.

```sh
python engine/bay/paint_cameras.py "$work/cameras" "$panel/fixed-poses.json" Chinatown --requests 50
python engine/bay/facade_paint.py "$source/packs/551.7_4182.5.bay" "$work/cameras/Chinatown/cameras.json" "$work/Chinatown.faces" 52249.2 66692
cp -cR "$source" "$candidate"
python engine/bay/frontage_tiles.py "$source" "$candidate" "$city/inputs" --paint "$work/Chinatown.faces" --towers 551.7_4182.5 --manifest "$base_manifest"
python engine/sf/release.py "$candidate" "$work/sf"
```

Here `source` is a frozen staging directory containing only the source packs and their tiles, `candidate` is a new sibling directory on APFS, and `base_manifest` is the matching materialized pin. Supply `--platforms 553.7_4178.5` for the Dogpatch platform and track survey. The tile decorator verifies the source pin, includes unchanged objects and writes the derived checkpoint last. The manifest digest is ready for panel scoring and promotion as described in [the release format](../sf/release.md).

Acquisition is serial with a request budget, spacing between requests and a saved cooldown. Each solved image is cached by ID. Rerunning projection and tiling reads local files. Each supported wall texel carries a palette index and a zero marks an unseen texel. Ring endpoints identify faces across tile cuts. A new, overlapping survey of the same wall requires a joint projection before release.

For a larger run, finish one street window and check its pin before moving to the next. Use the current app quota and response headers to set a daily request allowance. Journal the solve IDs, pass version, block extent, input hashes and completed face bundle. Keep the original acquisition archives and budget new full-resolution panoramas in a separate cache. Roll the contiguous validated windows into each square's level-zero tiles and run the panel gate before advancing the release. The prototype measures four windows; the measurements and local contact sheet are on issue #450.

The named Transamerica survey uses the DataSF landmark address, the USGS description of its perimeter truss and the architect's account of the lobby glazing. [USGS structural survey](https://pubs.usgs.gov/of/1989/0568/report.pdf) · [Foster + Partners](https://www.fosterandpartners.com/news/the-column-transamerica-pyramid-center)

To acquire another window, pass a `--sites` JSON array with its `place` and `square` and add its metre-based `street` pose to the poses file. Keep one shared camera-cache root for the acquisition queue. The sixteen judging image IDs stay excluded even when a different site inventory is supplied.

## City facade survey (#450)

`engine/bay/run-paint.sh start` installs a user LaunchAgent from the committed source, the built page Wasm and the local JavaScript dependencies. Run it from the worktree root. A restart reopens the same allowance and window checkpoints. `engine/bay/run-paint.sh status` reports the next permitted request, surveyed windows, wall coverage, accepted batches and free disk. The existing city acquisition has its own `run-city.sh status`.

Under `~/.village/engine/bay/450-city-paint/`, follow `worker.log` for acquisition, `panel.log` for the regression gate, `graph.log` for transport and `publication.log` for the city release. One serial Mapillary reader charges every outbound attempt before dispatch, including image downloads. Limits are 160 requests per rolling hour and 2,400 per rolling day with a minimum spacing of 1.12 s. Retry-After, app usage and deadlines survive restart. JPEGs have a 384 MiB working cache, and compact solves and verified faces survive eviction. Survey and panel work hold at 17 GiB free. The city release starts staging above 18 GiB.

The queue considers finished squares, first the observed weak streets and then nearby unsampled blocks. Each directed facade belongs to the survey cell containing its midpoint. The four prototype surveys retain their existing walls. Each `windows/*.json` records the input pack, solved camera catalogue and face bundle SHA-256. Sparse windows stay identifiable by camera count. Receipts also record the preceding and resulting tile hashes and their contributing squares. If a neighbour remains unfinished the receipt names it. A final city release recalculates against the complete contributor set.

Panel batches carry a visual grade forward only when their tested tile set and renderer match the preceding batch or all resulting shot hashes match. Changed pairs wait in `pending/shots/` beside `pending/evidence.json`. Run `city_panel.py accept --batch <evidence hash> [--scores <16-place JSON>]` with the Bay Python. Acceptance first reads every view's pixels, new or carried (`panel_gate.py`, `render_checks.py`): thin uprights in the sky beyond the photograph's count, and a vision judge (`claude -p`, Opus) that fails any clearly named pillars, banding or narrow windows, or that cannot answer. Inspections are cached under `inspections/` by both pictures' bytes. Scores are optional; supplied ones may not drop below a floor that an earlier passing render earned, and without them the previous scores are carried and flagged. `panel_gate.py --shots <folder>` runs the same pixel gate on any folder of `<place>-0.png` and `<place>-1.png`. Any failure leaves the previous pin in place. Acquisition continues while a review is pending. The accepted batch is in `current.json`; its tile hashes and grades are under `accepted/`. Once the city finishes, `paint_publication.py` stages the combined cell, life, vehicle and available far objects locally and writes `city-release.json`. The new city pin requires the full release panel before promotion.
