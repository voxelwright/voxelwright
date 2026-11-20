# The far view (#450)

Past about a kilometre the realm's cells are boxes of 6.4 m and more, so the city past the cell tiles is also drawn
as faces: the outside faces of the lidar's columns, half a metre a cell, every side of them. `page/far.ts` draws
them past 500 m from the eye. Past that distance, `page/march.ts` leaves whatever its cells meet in a tile the far
model holds, so cells are drawn near and faces far, never both.

The faces come from two sources. #423's Ina wedge (`landing/ina/matte.py`, place `ina-all`) owns the tiles it holds
whole. Everywhere else they come from this folder's square bake, run on the data lane's archives
(`~/.village/engine/bay/450-inputs/<square>.zip`). The far model grows square by square as the city's run finishes
them.

```sh
PY=~/.village/engine/landing/ina/venv/bin/python
sh sf/far/grow.sh                    # bake new or changed squares, then repack only the tiles they touch
sh sf/far/grow.sh --watch 300        # the same every five minutes, while the city's run goes on
node sf/build.mjs                    # the static realm, with the far model from ~/.village/engine/sf/far/release
node sf/far/check.mjs                # four views: the park beside the photograph, downtown, the Pyramid, a street
$PY sf/far/measure.py ~/.village/engine/sf/far/shots/<name>-park-ids.rgba 2018x864 --leave 1400,0,2000,130
```

| File | What it does |
| --- | --- |
| `bake.py` | One square's faces. Writes a block per 500 m tile in `~/.village/engine/sf/far/squares/<square>/`, and skips a square whose archive is unchanged. |
| `pack.mjs` | Packs the blocks into the release's far tiles, `far.json` and `far/<band>/<x>_<z>.far`, and repacks only tiles whose sources changed. The format is in its header and in the request to the data lane on #450. |
| `grow.sh` | Runs `bake.py` then `pack.mjs`. |
| `check.mjs` | Shots, the faces drawn, bytes held and fetched, and the march's GPU ms with and without the far model, under `~/.village/engine/sf/far/shots/`. |
| `measure.py` | The park's skyline against the photograph, with #423's overlay measures (`landing/ina/overlay.py`). |

Address switches: `?farreach=500` sets the metres from the eye where faces begin (0 means no far model).
`?fardetail=0.75` sets how many pixels across a face must be to be drawn. `?farfaces=12000000` caps the faces held.
`?fog=0.8` turns on the marine layer (`page/fog.ts`); `engine.fog` changes it while the page runs.
