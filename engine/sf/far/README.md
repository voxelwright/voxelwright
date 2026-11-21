# The far view (#450)

Past about a kilometre the realm's cells are boxes of 6.4 m and more, so the city past the cell tiles is also drawn
as faces: the outside faces of the lidar's columns, half a metre a cell, every side of them. `page/far.ts` draws
them past 500 m from the eye. Past that distance, `page/march.ts` leaves whatever its cells meet in a tile the far
model holds, so cells are drawn near and faces far, never both.

The faces come from two sources. #423's Ina wedge (`landing/ina/matte.py`, place `ina-all`, bearings 87 to 152 from
the photograph's eye, out to 3.3 km) owns every face inside it: a tile it holds in part takes its faces inside the
wedge and the squares' outside. Everywhere else they come from this folder's square bake, run on the data lane's
archives (`~/.village/engine/bay/450-inputs/<square>.zip`). The far model grows square by square as the city's run
finishes them.

Trees in the wedge are crowns on trunks (`landing/ina/matte.py` `crowns`). A column of the lidar's surface says a tree
as a solid green mass from the ground up, and a crown that hangs over a building's outline was baked as part of that
building: a block of wall with windows as tall as the tree, in colours fitted to the leaves that hid it (the big tree
in the landing's left foreground was two houses' walls, 28 m high). Now every crown is found (leaf where no building is
outlined, and a patch over a building's own roof that is leaf by its returns, ragged, no bigger than a tree and touching
free leaf), baked as its own layers (`near-crown0` to `2`, `far-crown0`: slabs that hang lower the further inside the
crown they are, in three greens), with a trunk under each top that stands on the ground and the building's own roof
under what hangs over it. The square bake outside the wedge (`bake.py`) still bakes leaf as columns: at a metre a cell
past 500 m a crown is a few pixels, and it has not been given the rule.

In the wedge the faces are 25 cm out to 700 m from its apex and 50 cm past that, laid out with the streets (turned
9.47 degrees), where the cells are 40 cm and more past 100 m and stepped along every street wall. So where the march's
cells are over three pixels across (the realm's 25 degree lens: 3 to 7 pixels), faces begin 100 m from the eye in the
wedge, not 500 m: the landing's foreground is the wedge's. The listing's `wedge` says where it is. The landing's cut
(`landing.mjs`) must be made with `--reach 100` for the first picture to have that foreground; a cut made for 500 m
keeps the cells to 500 m until the tiles' own bands are here.

```sh
PY=~/.village/engine/landing/ina/venv/bin/python
sh sf/far/grow.sh                    # bake new or changed squares, then repack only the tiles they touch
sh sf/far/grow.sh --watch 300        # the same every five minutes, while the city's run goes on
node sf/build.mjs                    # the static realm, with the far model from ~/.village/engine/sf/far/release
node sf/far/check.mjs                # four views: the park beside the photograph, downtown, the Pyramid, a street
node sf/far/check.mjs --only foreground   # the park, the wedge at 25 degrees, three 100 m panel views
$PY sf/far/measure.py ~/.village/engine/sf/far/shots/<name>-park-ids.rgba 2018x864 --leave 1400,0,2000,130
```

| File | What it does |
| --- | --- |
| `bake.py` | One square's faces. Writes a block per 500 m tile in `~/.village/engine/sf/far/squares/<square>/`, and skips a square whose archive is unchanged. |
| `pack.mjs` | Packs the blocks into the release's far tiles, `far.json` and `far/<band>/<x>_<z>.far`, and repacks only tiles whose sources changed. The format is in its header and in the request to the data lane on #450. |
| `grow.sh` | Runs `bake.py` then `pack.mjs`. |
| `check.mjs` | Shots, the faces drawn, bytes held and fetched, and the march's GPU ms with and without the far model, under `~/.village/engine/sf/far/shots/`. |
| `measure.py` | The park's skyline against the photograph, with #423's overlay measures (`landing/ina/overlay.py`). |

The faces' colours are #423's, fitted to the photograph under its light (`landing/ina/light.json`: the sky's and the
ground's light 3.44 times the engine's, the whole 1.23 times brighter). The listing's `light` says so, and `far.ts`
draws the faces in it only where the wedge applies (a lens under 50 degrees, inside the wedge), which is all the
photograph vouches for. In the engine's own light the wedge's walls were a quarter to a third darker than the
photograph. Lit everywhere, downtown's faces stood at 150 against the cells' 89 beside them. Faces also take the
march's fog, as the cells do.

The landing's cut keeps every face of a landmark (layer `hero`) that faces its eye, grown to a pixel as `far.ts`
grows it. Cut without them, about 1% of Salesforce Tower showed sky in the first picture.

Address switches: `?farreach=500` sets the metres from the eye where faces begin (0 means no far model),
`?farnear=100` where they begin in the wedge, and `?farlight=fill,gain` the faces' light.
`?fardetail=0.75` sets how many pixels across a face must be to be drawn. `?farfaces=12000000` caps the faces held.
`?fog=0.8` turns on the marine layer (`page/fog.ts`); `engine.fog` changes it while the page runs.
