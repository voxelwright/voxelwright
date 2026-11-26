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

**The steps that open a place do not run against today's engine page server.** They are `cull.mjs` (the end of
step 4), `shoot.mjs`, `cost.mjs`, `webkit.mjs` and the overlay's measure, and each opens `/city?place=<name>` with its
files under `/place/<name>/`. `engine/serve.mjs` serves `/city` as the engine page but nothing under `/place/`, and the page reads no `place`,
so these need a server and page that have them. The bake from `fetch.py` to `heroes.mjs` runs on its own.

## Three things taken from the photograph

A building's colours are not the photographer's, so only these come from the picture: five colours a building
(`fitcolours.py`), the fill light's strength and the exposure (`light.py`), and the sky's two colours
(`light.json`). `matte.py --plain` bakes with colours by rule alone. `ina-painted` is a separate place with every
cell the camera sees painted from the photograph's pixels (`paint.py`). From the photograph's own eye it looks like
the photograph whatever stands under the paint, so positions are measured on `ina` and a painted place is judged from
another eye (`shoot.mjs --eye`).

## Make it again

Python is this lane's own environment, `~/.village/engine/landing/ina/venv` (numpy, scipy, pillow, opencv, pyproj,
laspy with lazrs, tifffile with imagecodecs, shapely): `PY=~/.village/engine/landing/ina/venv/bin/python`. Run from
`engine/`.

| Step | Command | What it does |
|---|---|---|
| 1 | `$PY -B landing/ina/fetch.py` | Lidar and the city's building outlines for the wedge of the city in the frame (about 1 GB), then aerial colour, which nothing uses yet and whose failure stops nothing. |
| 2 | `$PY -B landing/ina/surface.py`, `ids.py`, `land.py`, `sky.py` | The lidar's surface on two grids laid out with the streets; which building each cell is; the land past the lidar from terrain tiles; the photograph's sky. |
| 3 | `$PY -B landing/ina/fit.py --start --nopins --free yaw,pitch,roll --out camera-c1.json`, then `$PY -B landing/ina/camera.py three` (prints the eye as `u,w,h`), then `fit.py --from camera-c1.json --at <u,w,h> --free yaw,pitch,roll --out camera-c2.json`, then `edges.py --from camera-c2.json --free e,n,h,yaw,pitch,roll,f,cy,cx --out camera-c3.json`, then `camera.py adopt camera-c3.json` | The photograph's camera: the look from the geotag, the eye from three pins (`pins.json`), the look again from there, then everything by least squares on the skyline and the pins. Counting the pins from the start, or freeing the eye before it is near, does not converge. |
| 4 | `$PY -B landing/ina/matte.py`, `node landing/ina/heroes.mjs`, `node landing/ina/cull.mjs` | Bakes every face of the wedge (place `ina-all`) with the church's towers as solids (`church.py`), adds Salesforce Tower and the Bay Bridge, and keeps the faces that can be seen (place `ina`). |
| 5 | `node landing/ina/shoot.mjs --name r7`, `$PY -B landing/ina/overlay.py r7 --label "what changed"` | The engine's picture from the camera with each pixel's building, measured against the photograph: where things stand and how alike the colours are. Needs a place-drawing server. |
| 6 | `$PY -B landing/ina/light.py r7`, step 4 again; `$PY -B landing/ina/fitcolours.py r7`, steps 4 and 5 again, two or three times | The fill light and exposure (`light.json`), then each building's colours under them. The sky's colours by shooting: `light.py sky --start`, then `shoot.mjs --name s1 --query "&clouds=0"` and `light.py sky s1`, six times. |
| 7 | `$PY -B landing/ina/paint.py begin`, `node landing/ina/shoot.mjs --place ina-painted --name pa0 --fine 3 --cells 1`, `paint.py turn pa0 --cells pa0`, a shot and a turn twice more, `paint.py end` | The painted place. |
| 8 | `node landing/ina/cost.mjs [--place ina-painted]` | Frame times at this view. |

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
- `queue.mjs`: runs a chain of steps on one turn of the GPU. `webkit.mjs`: whether the place starts in WebKit.

The engine's notes on building a place to lie on a photograph are in `.agents/skills/cell-engine`.
