---
name: bay-sources
description: Map, elevation, lidar and imagery sources for building the San Francisco Bay Area as cells (#373), with what each holds, how it is fetched without a key, and what its licence lets us keep and serve. Load before fetching geodata, adding a source or a reader for one, changing engine/bay, or writing a credit line.
---

# Sources for the Bay Area as cells

Version 1, November 15, 2026 (#373). Each line says how it was checked: **read** (the licence or
page text was fetched that day), **fetched** (the data came back from the URL given, no key), or
**memory** (not checked: check it before relying on it). Refresh when a source's release name or
terms change, or when a fetch here stops working.

Rules that hold for all of it:

- Raw data lives under `~/.village/engine/bay/raw/`, never in git. What is baked from it for the
  engine lives under `~/.village/engine/bay/packs/`.
- Requests carry a generic client name (`village-engine`) and no email or personal detail.
- A source that needs a key or an account is not used until the owner gives one. Nothing is signed up for.
- The world holds real streets, names and addresses. It never says whose home a house is.

## Used in the first slice (no key, no share-alike)

| Source | Holds | Fetch | Licence |
|---|---|---|---|
| USGS 3DEP lidar, project `CA_SanFrancisco_1_B23` | Point cloud of the city, 13.1 billion points; class codes; published 2024 | Entwine EPT, `https://usgs-lidar-public.s3.amazonaws.com/CA_SanFrancisco_1_B23/ept.json` and `ept-data/D-X-Y-Z.laz`. Bounds are Web Mercator (EPSG:3857); heights NAVD88 metres. **fetched** | "USGS-authored or produced data and information are considered to be in the U.S. public domain and can be freely used without permission. All we ask is that you acknowledge the USGS as the source." usgs.gov/faqs/are-usgs-reportspublications-copyrighted. **read** |
| USGS 3DEP 1 m DEM | Bare ground, 1 m, same project | `https://tnmaccess.nationalmap.gov/api/v1/products?bbox=W,S,E,N&datasets=Digital%20Elevation%20Model%20(DEM)%201%20meter` lists GeoTIFFs on `prd-tnm.s3.amazonaws.com`. **fetched** (the list) | As above. **read** |
| DataSF Building Footprints `ynuv-fyni` | Every building's outline, with height statistics from lidar (`hgt_mediancm`, `hgt_maxcm`, `gnd_min_m`) | `https://data.sfgov.org/resource/ynuv-fyni.geojson?$where=within_box(shape,S,W,N,E)&$limit=N`. **fetched** | PDDL (public domain dedication), stated on the dataset. **read** |
| DataSF Streets `3psu-pn9h` | Centrelines with street names | Same pattern, column `line` | PDDL. **read** |
| DataSF Addresses (EAS) `3mea-di5p` | Address points: number, street, position | Same pattern | PDDL. **read** (catalog entry) |
| DataSF Curbs and Islands `emxt-b6yg` | Kerb lines: where carriageway ends and pavement begins | Same pattern | PDDL. **read** (catalog entry) |
| DataSF Street Tree Inventory `tkzw-k3nq` | Street trees: species, position, trunk size | Filter on `latitude`, `longitude` (its `point` is text) | PDDL. **read** |
| DataSF Land Use `c5ge-t6pj` | Per parcel: its outline, uses, dwelling units | Same pattern | CC0 1.0. **read** (catalog entry) |
| NAIP aerial imagery (USDA, served by USGS) | 0.6 m colour, flown May 2022 over the city | `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox=...&bboxSR=4326&imageSR=...&size=W,H&format=png&f=image`; a 502 now and then, ask again. **fetched** | U.S. government work; the service's credit is "USGS, USDA, The National Map: Orthoimagery". The licence sentence itself was not found on a page that could be fetched: **memory** for the words "public domain". |

Credit line for a world built from these: "U.S. Geological Survey 3DEP; USDA NAIP; City and
County of San Francisco (DataSF)".

## Open, with duties: for past the city line

DataSF stops at San Francisco's edge. The rest of the Bay needs these. They are open data, not
keyed services, but what is built from them carries duties, so a tile's layers stay separable by
source.

| Source | Holds | Fetch | Licence and what follows |
|---|---|---|---|
| OpenStreetMap | Streets, land use, building tags (`building:levels`, `roof:shape`, `building:colour`, sparse) | Geofabrik extract `download.geofabrik.de/north-america/us/california/norcal-latest.osm.pbf`. Overpass is for small asks and was at capacity when tried. | ODbL: "If you alter or build upon our data, you may distribute the result only under the same license." A served grid of cells that geometry can be pulled back out of is most likely a derivative database: serve that layer under ODbL with "© OpenStreetMap contributors". **read** |
| Overture Maps (release 2026-10-21.0) | Buildings (outline, `height`, `num_floors`, `roof_shape`, `facade_color`), transportation, base, addresses | Parquet on `overturemaps-us-west-2.s3.amazonaws.com/release/<release>/theme=.../type=.../`, or PMTiles read by byte range from `tiles.overturemaps.org/<release>/<theme>.pmtiles` (what the Earth world on Spawn does). No key. | Buildings, transportation, base: ODbL, as OSM. Credit "© OpenStreetMap contributors, Overture Maps Foundation". **read** |
| Meta and WRI canopy height | Tree height, 1 m, modelled from Maxar imagery | `https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/<quadkey>.tif` | CC BY 4.0, credit "Meta and World Resources Institute (WRI) 2024. High Resolution Canopy Height Maps". No share-alike. **read** |
| Mapterhorn, Mapzen terrain tiles | Ground height, about 30 m world-wide, finer where a country publishes it | `tiles.mapterhorn.com/z/x/y.webp`; `s3.amazonaws.com/elevation-tiles-prod/terrarium/z/x/y.png` | Each tile carries its sources' terms (mapterhorn.com/attribution). Far ground only. **fetched**; terms **memory** |
| NOAA CUDEM (1/9 arc-second), USGS San Francisco Bay 1 m bathymetry (DOI 10.5066/P9TJTS8M, CC0) | The bay's floor | `noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/NCEI_ninth_Topobathy_2014_8483/CA/` | U.S. government products. **memory** for both licences |

## Needs a key or an account: not used

| Service | What decides it |
|---|---|
| Google Map Tiles (Photorealistic 3D Tiles, satellite, Street View) | Maps Platform Terms 3.2.3: "Customer will not create content based on Google Maps Content", "pre-fetch, index, store, reshare, or rehost"; Map Tiles policy: no "geodata extraction", "offline uses". No deriving, storing or serving. **read** |
| Mapbox Satellite | Product Terms 1.6, 1.9: no tracing or deriving but for OSM or non-commercial vectors; no caching or storing. **read** (April 2025 terms) |
| Esri World Imagery | "not intended to be used to export tiles for offline"; Esri Master Licence. Pixels may not be kept or served. **read** (item page) |
| Cesium ion | "You may not copy, store, or redistribute any portion of Cesium Data Output". **read** |
| Mapillary (street photographs, and heights from its 3D reconstructions) | The API needs a token. Images are CC BY-SA 4.0: what is derived from them is share-alike and must be credited. It is the one open source of wall colours and of signs. **read** Ask the owner for a token before using it; until then walls are made by programs. |
| Bing or Azure Maps, Apple Look Around | Not read. **memory**: no. |

## How the Earth world on Spawn is put together (looked at November 15, as a guest)

Ideas only; none of its code is used here.

- The place is made in the player's browser. The page loads about sixty generator scripts and a
  wasm engine, and reads open data straight from its public hosts by byte range: Overture PMTiles
  (base, transportation, buildings, places) and Mapterhorn terrain tiles (zoom 9 far, zoom 15
  near), with hand-written PMTiles, vector-tile and PNG readers. What is fetched is kept in the
  browser's cache. Generated chunks are also kept on its server, keyed by latitude, longitude,
  hour and mode.
- Its cells are about 5.6 cm, drawn in nested levels each 64 cubes a side and four times coarser
  than the last: cubes of 0.23 m out to 14 m, 0.9 m to 58 m, 3.6 m to 230 m, 14.5 m, 58 m. The
  ground is drawn as quads beside the cubes.
- Heights where Overture has none come from Mapillary's 3D reconstructions, baked into grids per
  map tile. Wall colours come from Mapillary photographs: a point of a wall takes the colour of
  the nearest, most head-on photo that sees it.
- Everything else is rules from the data and the region: street-name signs at corners in a
  bitmap font on the cell grid, road paint by country, parked cars, people, a church's tower from
  its class and footprint.

## Tools the bake uses (not shipped: a Python environment outside the repo)

`~/.village/engine/bay/venv`, Python 3.13: numpy 2.5.4, pillow, laspy 2.7.0 with lazrs (reads the lidar's LAZ),
tifffile 2026.11.12 with imagecodecs (reads the ground model's GeoTIFF: float32, LZW with a predictor), pyproj
3.8.0 (Web Mercator and latitude and longitude into UTM zone 10N). Verified by use on November 15: `engine/bay/fetch.py`
then `engine/bay/bake.py` for squares `551.7_4183.5` and `550.7_4183.5`. One square is 2,400 lidar files, 630 MB,
130 million points of which 86 million fall in it (about 82 a square metre); fetched in about two minutes, baked
in a little over one.

Photographs used to judge the slice, from Wikimedia Commons, kept outside the repo with author and licence in
`~/.village/engine/bay/ref/SOURCES.txt`: Daniel Schwen, "SF Filbert St North Beach CA-e" (CC BY-SA 2.5); Pavel
Špindler, "Washington Square, kostel Saints Peter and Paul Church" (CC BY 3.0).

## Traps

- EPT bounds and points are in Web Mercator: a metre there is about 0.79 m on the ground at
  37.8° N. Put every layer into one metric frame before comparing them.
- `CA_SanFrancisco_1_B23` has no building or vegetation class: only 1 (unclassified), 2 (ground), 7 and 18 (noise),
  9, 17, 20. Buildings are told by the footprints, leaves by near infra-red.
- DataSF's Land Use has units and uses, not year built or storeys. Curbs' and Land Use's geometry column is
  `the_geom`; the tree list's latitude and longitude are text (`latitude::number`). `data.sfgov.org` answers
  `/resource/` asks; `/api/views/` now redirects to `data.sf.gov`.
- Socrata `within_box` wants a geometry column; a text point column fails.
