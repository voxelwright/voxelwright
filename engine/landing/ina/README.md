# The view from Ina Coolbrith Park

A model of San Francisco as seen from Ina Coolbrith Park, built so closely that a half-transparent screenshot laid
over this photograph lines up:
"View of San Francisco from Ina Coolbrith Park-01445.jpg", Frank Schulenburg, CC BY-SA 4.0, taken 2021-07-15
15:37:30, <https://commons.wikimedia.org/wiki/File:View_of_San_Francisco_from_Ina_Coolbrith_Park-01445.jpg>.
The index of each baked place names the photograph and its author.

Everything here makes and measures that model. Two things use it today:

- **The realm's far model** (`engine/sf/far/`): its bake imports `matte.py`, `looks.py` and `names.json` from here
  (`engine/sf/far/bake.py`), so its faces and colours follow the rules fitted here.
- **The site's 3D landing** (`site/static/landing/`): `site/scripts/landing/prepare.mjs` exports the baked `ina` place
  from this lane's cache.

Nothing made is in the repository. Data, the photograph and pictures are under `~/.village/engine/landing/ina/`.

The browser-driven fitting and culling scripts that used the old `/city?place=<name>` route have been removed; the offline bake steps from `fetch.py` through `heroes.mjs` remain, and `matte.py`, `looks.py` and `names.json` continue to drive `engine/sf/far/bake.py`.

## Three things taken from the photograph

A building's colours are not the photographer's, so only these come from the picture: five colours a building
(`fitcolours.py`), the fill light's strength and the exposure (`light.py`), and the sky's two colours
(`light.json`). `matte.py --plain` bakes with colours by rule alone. `ina-painted` is a separate place with every
cell the camera sees painted from the photograph's pixels (`paint.py`).

## Make it again

Python is this lane's own environment, `~/.village/engine/landing/ina/venv` (numpy, scipy, pillow, opencv, pyproj,
laspy with lazrs, tifffile with imagecodecs, shapely): `PY=~/.village/engine/landing/ina/venv/bin/python`. Run from
`engine/`.

| Step | Command | What it does |
|---|---|---|
| 1 | `$PY -B landing/ina/fetch.py` | Lidar and the city's building outlines for the wedge of the city in the frame (about 1 GB), then aerial colour, which nothing uses yet and whose failure stops nothing. |
| 2 | `$PY -B landing/ina/surface.py`, `ids.py`, `land.py`, `sky.py` | The lidar's surface on two grids laid out with the streets; which building each cell is; the land past the lidar from terrain tiles; the photograph's sky. |
| 3 | `$PY -B landing/ina/fit.py --start --nopins --free yaw,pitch,roll --out camera-c1.json`, then `$PY -B landing/ina/camera.py three` (prints the eye as `u,w,h`), then `fit.py --from camera-c1.json --at <u,w,h> --free yaw,pitch,roll --out camera-c2.json`, then `edges.py --from camera-c2.json --free e,n,h,yaw,pitch,roll,f,cy,cx --out camera-c3.json`, then `camera.py adopt camera-c3.json` | The photograph's camera: the look from the geotag, the eye from three pins (`pins.json`), the look again from there, then everything by least squares on the skyline and the pins. Counting the pins from the start, or freeing the eye before it is near, does not converge. |
| 4 | `$PY -B landing/ina/matte.py`, `node landing/ina/heroes.mjs` | Bakes every face of the wedge (place `ina-all`) with the church's towers as solids (`church.py`) and adds Salesforce Tower and the Bay Bridge. |

## What says what

- `place.py`: the photographer's geotag, the wedge, and the frame turned with the streets (9.47 degrees).
- `names.json`: named buildings, by a point inside each. `looks.py`: wall colours and windows by rule.
- `fixes.json`: what the lidar (2023) has that the photograph (2021) has not. `outlines.json`: lines traced on the photograph.
- `solid.py`: faces of cells, and of solids in cells of 10 cm, which can have air under them as a column cannot.
  `church.py`: the church's two towers as such solids.
- `light.json` (`light.py`): the photograph's fill light, exposure and sky.
- `pins.json`, `camera.json`: the points the camera was pinned by, and the solved camera with its misses.
- `spots.json` (`spots.py`): where the long white slab and the towers' crowns stand in the engine's cells, for the signs.
- `sun.py`: the sun at the photograph's minute (bearing 251.85, height 55.37).
- `overlay.html`: the photograph and the engine's picture with a slider, difference, edges, skylines and per-building numbers.
- `queue.mjs`: runs a chain of steps on one turn of the GPU.

The engine's notes on building a place to lie on a photograph are in `.agents/skills/cell-engine`.
