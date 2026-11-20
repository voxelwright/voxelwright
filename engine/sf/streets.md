# Street graph, v1

A release with street life includes a `graph` dictionary in its manifest. It maps square name to the same file record as `names`, under `graph/<square>.json`. Load adjacent squares for a seam. Positions are absolute integer [x east, z south] pairs in 10 cm cells in the release frame.

Each file contains its `version`, `square` and the following arrays.

| Array | Geometry and connectivity |
| --- | --- |
| roads | Directed carriageway segments in traffic order. Each has id, two OSM node IDs in nodes, line, street name, nearest DataSF centreline CNN or null, lanes in this direction, and lanesInferred. OSM one-way direction is respected. If no directional count is tagged, a two-way split assumes equal shares with a minimum of one lane. |
| turns | Pairs of road IDs for permitted continuations at a shared OSM node. Excludes immediate reversals and applies simple OSM via-node turn restrictions. Via-way, conditional, and per-lane restrictions have no representation in v1. |
| pavements | Bidirectional mapped footway, pavement, pedestrian street, path or steps. Endpoints in nodes join by OSM ID, including to crossings. |
| crossings | Mapped crossing ways with shared pedestrian nodes, line and markings tag or null. A null marking gives no paint evidence. |
| kerbs | DataSF surveyed polylines clipped to the square plus a 5 m overlap. id is the source objectid and can occur on several pieces. |
| tracks | Mapped cable railway and SF narrow-gauge tram track centre segments. Each has id, nodes and line. |
| parking | An OSM parking-tagged side, kind and line offset 3.2 m from the source centreline. Use for parked-car placement. Exact stall boundaries and parking restrictions are unknown. |

Road, foot and track segment IDs are `OSMway/fromNode/toNode`, stable across squares. Parking appends its side. Join neighbouring arrays by ID and turns by ordered pair. A segment is included in full when it touches the square or its 5 m collar. Mapped ways can end where coverage or mapping ends. Kerb geometry is the source for street-edge placement where present. Pedestrian routing uses the explicit foot graph.

The inputs beside each lidar archive include OSM map observations and the active DataSF registered-business categories and coordinates. The private intermediate contains no business names or mailing addresses.
