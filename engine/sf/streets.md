# Street graph, v1

The street graph is where cars may drive, people may walk and rails run, one file per 1 km square. A release lists them in its manifest's `graph` section as `graph/<square>.json` ([the San Francisco release](../../guide/sf-release.md)). [street_graph.py](../bay/street_graph.py) writes them from OSM and DataSF observations, [transport.py](../bay/transport.py) adds road levels and traffic controls, and [life.py](life.py) cuts them down to the street life the page runs.

Positions are integer `[x, z]` pairs in 10 cm cells in the release frame: x east and z south of 500,000 m east, 4,250,000 m north in UTM zone 10N.

## A file

`{version: 1, square, ...arrays}`. A segment is included whole when it touches the square or a 5 m collar around it, so neighbouring files overlap. Load the adjacent squares for a seam and join by id.

| Array | Each entry |
| --- | --- |
| `roads` | A directed carriageway segment in traffic order: `id`, the two OSM node ids in `nodes`, `line`, street `name`, the nearest DataSF centreline `cnn` or null, `lanes` in this direction, `lanesInferred`, and the OSM `highway`, `tunnel`, `bridge` and `layer` strings. OSM one-way is respected. An untagged two-way road splits its lanes evenly, at least one each way. |
| `turns` | `[from road id, to road id]` for each allowed continuation at a shared OSM node. U-turns are left out, and simple via-node turn restrictions are applied. Via-way, conditional and per-lane restrictions are not represented. |
| `pavements` | A mapped footway, pavement, pedestrian street, path or steps, both directions: `id`, `nodes`, `line`, `kind`. Ends join by OSM node id, crossings included. |
| `crossings` | A mapped crossing way: `id`, `nodes`, `line`, `kind`, and its `markings` tag or null. Null is no evidence of paint. |
| `kerbs` | A DataSF surveyed kerb polyline clipped to the square and its collar: `id` (the source object id, which can repeat across pieces) and `line`. Use kerbs for street-edge placement where present. |
| `tracks` | A cable car or San Francisco narrow-gauge (1067 mm) tram track centre segment: `id`, `nodes`, `line`. |
| `parking` | An OSM parking-tagged side of a road: `id` (the segment's `<OSM way>/<from node>/<to node>` plus `/left` or `/right`), `side`, `kind`, and `line` offset 3.2 m from the centreline. Stall boundaries and restrictions are unknown. |

Road, pavement and track ids are `<OSM way>/<from node>/<to node>`, stable across squares. Mapped ways can end where coverage or mapping ends.

For `tunnel`, `bridge` and `layer`, a surveyed way defaults to `"no"`, `"no"` and `"0"`, and subtypes such as `building_passage` are kept. Null means the way could not be matched to the city-wide tag extract.

## Points

Each point belongs to the one square whose half-open bounds contain it, so these arrays do not overlap.

| Array | Source and meaning |
| --- | --- |
| `controls` | OSM road nodes tagged `stop` or `traffic_signals`: `node`, `point`, `kind`, `direction`. `allWay` is true only for `stop=all`; null means unknown. |
| `stopSigns` | [DataSF Stop Signs](https://data.sf.gov/d/4542-gpa3): `id`, `point`, and the CNN, facing or status when supplied |
| `signals` | [DataSF Traffic Signals](https://data.sf.gov/d/ybh5-27n2): `id`, `point`, CNN and signal number when supplied |
| `photoStopSigns` | Mapillary stop-sign sightings as bare points, with no junction inferred |

## Street life

`life.py` writes `<square>.json`, `transit.json` and an `index.json` of `{path, bytes, sha256}` records. A life file keeps `walk`, `roads`, `park`, `rail` and `heads` as flat number arrays, carries the four point arrays above, and stores each way's OSM tags once in `roadTags`. Its docstring gives every field. `transit.json` holds the streetcar and cable car routes and the bus and trolleybus routes with their stops.

```sh
~/.village/engine/bay/venv/bin/python engine/sf/life.py --graphs GRAPHS --out OUT
~/.village/engine/bay/venv/bin/python engine/bay/transport.py ROOT OUT
```

The inputs never hold business names or mailing addresses: only the DataSF registered-business categories and coordinates.

`?street=0` turns street life off in the realm.

## Check the streets

`test/street.mjs` checks the street paint, repainted cars and street shots, and `test/sf-life.mjs` counts people and vehicles and times frames with street life on and off. From the repository root:

```sh
cd engine
node test/street.mjs [--parts cars,marks,shots] [--no-build] [--places "Powell,Castro"]
node test/sf-life.mjs [--no-build]
node sf/street-shots.mjs --out ~/.village/engine/sf/street-2/new [--only city|realm]
~/.village/engine/bay/venv/bin/python -I sf/street_checks.py ~/.village/engine/sf/street-2/new
~/.village/engine/bay/venv/bin/python -I sf/street_sheet.py photos ~/.village/engine/sf/street-2/new
~/.village/engine/bay/venv/bin/python -I sf/street_sheet.py sheet OLD NEW OUT
```

`street_sheet.py photos` finds a Mapillary photograph for each view that has none, and `sheet` lays old render, new render and photograph side by side.
