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
- A source that needs a key or an account is not used until the owner gives one or asks for it. Mapillary is the
  one account so far (below). A key lives under `~/.village/engine/bay/keys/`, never in git, a page or a log.
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
| NAIP aerial imagery (USDA, served by USGS) | 0.6 m colour, flown May 2022 over the city | `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox=...&bboxSR=4326&imageSR=...&size=W,H&format=png&f=image`; a 502 now and then, ask again. **fetched** | See the verified terms and attribution in [Data licences](../../../DATA-LICENSES.md). **read** |

Credit line for a world built from these: "U.S. Geological Survey 3DEP; USDA NAIP; City and
County of San Francisco (DataSF)".

## Used for the planet (`engine/bay/earth.py`, November 15): no key, with duties

Where nothing is baked from lidar, a tile is made on asking from two sources, a map tile at a time:

- **Overture Maps, release `2026-10-21.0`**, PMTiles read by byte range from
  `https://tiles.overturemaps.org/<release>/{buildings,transportation,base}.pmtiles` (zooms 0 to 14; base to 13;
  gzip; extent 4096). **fetched**: the zoom-14 tile over Filbert Street holds 2,836 buildings, 2,609 with a
  `height`; layers `building`, `building_part`, `segment` (roads with `class`), `water`, `land_use`,
  `land_cover`, `land` (trees as points), `infrastructure`, `bathymetry`. A building that crosses a map tile's
  edge comes cut in two. Licence: base, buildings and transportation are ODbL; the one credit the attribution
  page gives is "© OpenStreetMap contributors, Overture Maps Foundation" (**read** through a lookup; the per-theme
  list came from a summary). The page says nothing of rules for the hosted tiles.
- **Mapterhorn terrain**, `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`: 512 pixels a side, height in metres
  = R * 256 + G + B / 256 - 32768, a sample its pixel's middle. **fetched**: zoom 15 over Telegraph Hill is
  1.9 m a pixel; where a place has nothing finer the tile is missing and the parent is used. Its data-access page
  states no limits and offers extracts and mirrors (hosting sponsored). No one licence: each source keeps its own
  (`https://download.mapterhorn.com/attribution.json`, 151 sources, **fetched**): the United States at 1 m is USGS
  3DEP, "Public Domain (U.S. Government Work)"; world-wide is Copernicus GLO-30, "full, free and open license".
  Credit "terrain: Mapterhorn" with the link to its attribution page.
- Checked against the lidar bake on two tiles at Filbert Street: the ground differs by a median of 0.1 m (p10 to
  p90: -1.2 to 0.6 m), buildings 269 and 287 against 260 and 270 outlines, roofs lower by a median of 1.0 and
  1.8 m. San Francisco is a well-mapped place: elsewhere will be worse.
- Tools, in the bake's venv, verified by use: `pmtiles` 3.8.1 (reader with our own range function),
  `mapbox-vector-tile` 2.2.0 (decodes; y is up from the tile's bottom), shapely 2.2.0 came with it and is unused.
- What is made from Overture is a derived work under ODbL. The baked squares (`packs/*.bay`) hold none of it.
  The planet's tiles (`earth/tiles/`) are wholly derived from it, and the tiles cut for the page (`packs/tiles/`)
  are blended: lidar where a square reaches, the planet's version elsewhere. Both of those are a cache that can
  be made again, are not in git, and are shown with the credit on the page.

## Open, with duties: for past the city line

DataSF stops at San Francisco's edge. The rest of the Bay needs these. They are open data, not
keyed services, but what is built from them carries duties, so a tile's layers stay separable by
source.

| Source | Holds | Fetch | Licence and what follows |
|---|---|---|---|
| OpenStreetMap | Streets, land use, building tags (`building:levels`, `roof:shape`, `building:colour`, sparse) | Geofabrik extract `download.geofabrik.de/north-america/us/california/norcal-latest.osm.pbf`. Overpass is for small asks and was at capacity when tried. | ODbL: "If you alter or build upon our data, you may distribute the result only under the same license." A served grid of cells that geometry can be pulled back out of is most likely a derivative database: serve that layer under ODbL with "© OpenStreetMap contributors". **read** |
| Overture Maps (release 2026-10-21.0) | Buildings (outline, `height`, `num_floors`, `roof_shape`, `facade_color`), transportation, base, addresses | Parquet on `overturemaps-us-west-2.s3.amazonaws.com/release/<release>/theme=.../type=.../`, or PMTiles read by byte range from `tiles.overturemaps.org/<release>/<theme>.pmtiles` (what the Earth world on Spawn does). No key. | Buildings, transportation, base: ODbL, as OSM. Credit "© OpenStreetMap contributors, Overture Maps Foundation". **read** |
| Meta and WRI canopy height | Tree height, 1 m, modelled from Maxar imagery | `https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/<quadkey>.tif` | CC BY 4.0, credit "Meta and World Resources Institute (WRI) 2024. High Resolution Canopy Height Maps". No share-alike. **read** |
| Mapterhorn, Mapzen terrain tiles | Ground height, about 30 m world-wide, finer where a country publishes it | `tiles.mapterhorn.com/z/x/y.webp`; `s3.amazonaws.com/elevation-tiles-prod/terrarium/z/x/y.png` | See the verified terms and attribution in [Data licences](../../../DATA-LICENSES.md). **read** |
| NOAA CUDEM (1/9 arc-second), USGS San Francisco Bay 1 m bathymetry (DOI 10.5066/P9TJTS8M) | The bay's floor | `noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/NCEI_ninth_Topobathy_2014_8483/CA/` | See the verified terms and attribution in [Data licences](../../../DATA-LICENSES.md). **read** |

## Mapillary: a token, given by the owner on November 15

The owner asked for an account and a key. The account is on the owner's email (its name is in the lane's memory note), the application
`village-engine` with READ only. The client token is in `~/.village/engine/bay/keys/mapillary.token` (mode 600, outside
git); it is never printed, logged or put in a URL that is logged: send it as the header `Authorization: OAuth <token>`.
Nobody holds the account's password; it is reset through the owner's email when wanted.

- Holds: street photographs with their solved position and rotation (`computed_geometry`, `computed_rotation`,
  camera model), panoramas, a 3D reconstruction per image (`sfm_cluster`, `mesh`), and what its detector found
  (`map_features`: signs, poles, crossings). `https://graph.mapillary.com/images?bbox=W,S,E,N&limit=N&fields=...`
  **fetched**: a box of 180 m by 150 m east of Washington Square answered 440 photographs, 317 of them panoramas,
  295 from 2022. A box asked with `limit=2000`, or one too full, answers "Please reduce the amount of data": ask
  small boxes (a zoom-14 tile's worth at most, less in a city).
- Terms (mapillary.com/terms of February 15, 2024, and the API documentation, **read** through a lookup on
  November 15; the limits came from a summary of the page, not its words):
  - Content is "subject to the Creative Commons Share Alike (CC BY-SA) license, unless we indicate otherwise".
    Serving images from our own server, or data "that Mapillary extracts from street-level images", is allowed
    with "visibly displaying the Mapillary logo and linking back to the Mapillary homepage". The terms do not say
    how the licence reaches what we derive ourselves (a wall's colour): treat it as share-alike, keep that layer
    separable from the public-domain ones, and show "© Mapillary" with the link where it is used.
  - An application must "materially supplement" Mapillary and not "merely redistribute Content", nor
    "substantially replicate the functionality of Mapillary Services". A world of cells coloured from photos is
    a supplement; a viewer of its photographs would not be.
  - "data mining, robots or similar data gathering" not approved is banned: ask through the API only, a place at
    a time as it is visited or baked, never a crawl of a region for its own sake. Nothing on caching or a time
    limit was found.
  - Limits: entity asks 60,000 a minute for the app, searches by box 10,000 a minute, tiles 50,000 a day. A box
    "must be smaller than 0.01 degrees square".
  - The token goes in the header for the API; the vector tiles take `?access_token=`. Only our server or a bake
    holds it: a page asks our server.
- The Earth world on Spawn uses it the same way: its `photos.js` ("the colour of a wall, from street photographs
  (Mapillary: posed photos, CC BY-SA 4.0)"), `heights.js` ("from Mapillary's own 3D reconstructions") and the
  map-feature tiles in `street.js`. Its players' browsers ask Spawn's server
  (`/api/streetphoto/images?bbox=...`, seen in the guest session's traffic), which adds the key: "NO KEY IN THE BROWSER".

### A first try at wall colours from it (November 15; an experiment outside the repo, `~/.village/engine/bay/mly/`)

`walls.py` takes a level-0 tile, asks for its panoramas, projects points of each street-facing side into the
nearest cameras that see it, and keeps the 60th percentile colour; `apply.py` writes it as the wall's kind;
`view.py` cuts a camera's view out of a panorama so the engine can be shot from the same place.

- A camera's solved place agrees with our frame: its `computed_altitude` is 2.0 m over our ground at the median
  (a car's roof). `computed_rotation` is an angle-axis taking east, north, up into the camera (x right, y down,
  z forward), and **the middle of the panorama is the camera's back**: longitude = atan2(x, z) + pi. Found by
  drawing the projected points on the picture; without the half turn they land on the sky across the street.
- A list asked of a whole tile is cut at its limit and the busiest street takes all of it: ask in boxes of
  about 40 m (36 a tile) and keep one camera every 4 m. Then 188 cameras cover a 250 m tile.
- Result on the tile at Filbert and Grant: 144 of 277 buildings got a colour (241 have a street-facing side);
  four minutes, nearly all of it fetching 2048-pixel panoramas. From a camera's own place the dark blue house
  is dark blue in both pictures; a yellow one came out dark grey and another olive.
- What is wrong with it: a side in shade or behind a tree gives a dark or green colour (lifting dark ones to a
  usual lightness is a patch); one colour a building loses trim, doors and shop fronts; an outline with many
  short sides (bay windows) gives few points a side. Next: weigh samples by how head-on and how sunlit, take
  the colour per side not per building, then per cell near the eye (as Spawn's `photos.js` and the
  fast-voxels lane both do: each cell from the view that faces it most).

## Needs a key or an account: not used

| Service | What decides it |
|---|---|
| Google Map Tiles (Photorealistic 3D Tiles, satellite, Street View) | Maps Platform Terms 3.2.3: "Customer will not create content based on Google Maps Content", "pre-fetch, index, store, reshare, or rehost"; Map Tiles policy: no "geodata extraction", "offline uses". No deriving, storing or serving. **read** |
| Mapbox Satellite | Product Terms 1.6, 1.9: no tracing or deriving but for OSM or non-commercial vectors; no caching or storing. **read** (April 2025 terms) |
| Esri World Imagery | "not intended to be used to export tiles for offline"; Esri Master Licence. Pixels may not be kept or served. **read** (item page) |
| Cesium ion | "You may not copy, store, or redistribute any portion of Cesium Data Output". **read** |
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

### Street imagery when a Mapillary square is sparse (#450)

On macOS 27.2.1, `swift engine/bay/lookaround.swift <latitude> <longitude> <local.jpg>` requests a native Look Around scene and snapshots it. At the Dogpatch control the output was 960 × 540, 136,360 bytes, 1.22 s across the scene and snapshot operations. MapKit's public scene and snapshot headers provide the image without its exposure position, heading or intrinsics. Eight perspective crops from each of four independent solved panoramas gave nine shared feature candidates and zero reliable triangulated control points (positive depth 2–100 m, ray residual below 0.75 m). This sample contributed zero registered walls. [Apple Look Around snapshotter](https://developer.apple.com/documentation/mapkit/mklookaroundsnapshotter)

Google Street View Static metadata is free to request and requires an enabled API key. A Dogpatch metadata lookup here returned `REQUEST_DENIED`; no image was fetched. Distinguish a denied request from a street without coverage. [Google Street View metadata](https://developers.google.com/maps/documentation/streetview/metadata)

For storage-only #450 city changes, see `engine/sf/release.md` and `engine/bay/compact_store.py`. The macOS jobs use zstd CLI 1.5.7 at level 3 with independent frames. Every decoded SHA-256 must match the checkpoint before unlinking a raw base. A truncated frame failed the resume regression and left its original available. Recheck the executable and real pack/three-level tile round trips when changing encoders. [Versioned zstd CLI manual](https://github.com/facebook/zstd/blob/v1.5.7/programs/zstd.1.md)
