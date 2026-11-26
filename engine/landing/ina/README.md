# The landing's place: the view from Ina Coolbrith Park (#423)

The owner's decision (November 17, 2026): the landing world's place is the view from Ina Coolbrith Park, built
closely enough that a half-transparent screenshot laid over this photograph lines up:
"View of San Francisco from Ina Coolbrith Park-01445.jpg", Frank Schulenburg, CC BY-SA 4.0, taken 2021-07-15
15:37:30, <https://commons.wikimedia.org/wiki/File:View_of_San_Francisco_from_Ina_Coolbrith_Park-01445.jpg>.

The original renderer was in `engine/page/matte.ts` (`?place=ina`). Everything here makes and measures it. Nothing
made is in the repo: data, the photograph and pictures are under `~/.village/engine/landing/ina/`, and the server
runs with that lane's own home so that nothing is written under `~/.village/engine/bay/`.

## To see it

    cd engine && npm run -s core
    HOME=~/.village/engine/landing/ina/home node serve.mjs --port 5961

- The place: <http://127.0.0.1:5961/city?place=ina>. It starts at the photograph's camera, lit by the sun as it
  stood that minute, under a clear afternoon's sky (`&haze=`, `&clouds=` change the air).
- The overlay: <http://127.0.0.1:5961/landing/ina/overlay.html>: the photograph and ours, a slider, difference,
  edges, skylines, and the numbers for each building.
- `?place=ina-painted` is the same place with every cell the photograph's eye sees painted from the photograph
  (`paint.py`): the photograph's pixels laid on the model, which its index says. It is kept apart so that the
  owner can choose. From the photograph's own eye it looks like the photograph whatever stands under the paint,
  so where things stand is measured on `ina`, and a painted place is judged from another eye (`shoot.mjs --eye`).

Three things in `ina` are taken from the photograph, by the owner's word of November 17 (a building's colours are
not the photographer's): five colours a building (`fitcolours.py`), how strong the fill light is and how bright
the exposure (`light.py`), and the sky's two colours (`light.json`). `matte.py --plain` bakes the place with
colours by rule alone. The index of each place names the photograph and its author.

## To make it again

Python is this lane's own environment, `~/.village/engine/landing/ina/venv` (numpy, scipy, pillow, opencv, pyproj,
laspy with lazrs, tifffile with imagecodecs, shapely): `PY=~/.village/engine/landing/ina/venv/bin/python`.

| Step | Command | What it does |
|---|---|---|
| 1 | `$PY -B landing/ina/fetch.py` | Lidar (186 million points; within 460 m of the eye the octree's last depth too, about 120 points a square metre) and the city's building outlines for the wedge of the city in the frame, about 1 GB; then aerial colour, which the service often refuses (nothing here uses it yet, and its failing stops nothing). |
| 2 | `$PY -B landing/ina/surface.py`, `ids.py`, `land.py`, `sky.py` | The lidar's surface on two grids laid out with the streets (25 cm to 1.3 km, 50 cm to 3.3 km); which building each cell is; the land past the lidar from terrain tiles; the photograph's sky. |
| 3 | `$PY -B landing/ina/fit.py --start --nopins --free yaw,pitch,roll --out camera-c1.json`, then `$PY -B landing/ina/camera.py three` (prints the eye, as `u,w,h`), then `fit.py --from camera-c1.json --at <u,w,h> --free yaw,pitch,roll --out camera-c2.json`, then `edges.py --from camera-c2.json --free e,n,h,yaw,pitch,roll,f,cy,cx --out camera-c3.json`, then `camera.py adopt camera-c3.json` | The photograph's camera. The look from the geotag by the area between the two skylines; the eye from three pins alone (`pins.json`); the look again from there; then everything by least squares on the skyline's points and the pins. Run from cold on November 17 it came to the same eye within 0.1 m, the same lens within 0.1% and the same roll; the look and the picture's middle trade against each other (a quarter of a degree for 9 px), which moves no pixel by more than about one. With the pins counted from the start, or the eye let go before it is near, it does not converge. |
| 4 | `$PY -B landing/ina/matte.py`, `node landing/ina/heroes.mjs`, `node landing/ina/cull.mjs` | Bakes every face of the wedge (place `ina-all`) with the church's towers as solids (`church.py`), adds Salesforce Tower and the Bay Bridge by their rules, and keeps the faces that can be seen (place `ina`). |
| 5 | `node landing/ina/shoot.mjs --name r7`, `$PY -B landing/ina/overlay.py r7 --label "what changed"` | The engine's picture from the camera with each pixel's building, and the measure against the photograph: where things stand, and how alike the colours are. A picture at half strength each goes to `~/.village/engine/landing/ina/overlay-r7-50.jpg`. |
| 6 | `$PY -B landing/ina/light.py r7`, then step 4 again; `$PY -B landing/ina/fitcolours.py r7`, then steps 4 and 5 again, two or three times | The photograph's fill light and exposure (`light.json`), then each building's colours under them. The sky's two colours: `light.py sky --start`, then six times `shoot.mjs --name s1 --query "&clouds=0"` and `light.py sky s1` (by shooting, since the sky passes through the page's glow, which no formula here has). The place's air (`?haze=`, 0.12 in `march.ts`) was set after the sky by the darkest things 1 to 2 km off. |
| 7 | `$PY -B landing/ina/paint.py begin`, `node landing/ina/shoot.mjs --place ina-painted --name pa0 --fine 3 --cells 1`, `paint.py turn pa0 --cells pa0`, a shot and a turn twice more, `paint.py end` | The painted place, from `ina` as it stands. |
| 8 | `node landing/ina/cost.mjs [--place ina-painted]` | Frame times at this view. |

## What says what

- `place.py`: where the photographer's geotag is, the wedge, the frame turned with the streets (9.47 degrees).
- `names.json`: named buildings, by a point inside each. `looks.py`: wall colours and windows by rule.
- `fixes.json`: what the lidar (2023) has that the photograph (2021) has not. `outlines.json`: lines traced on the photograph.
- `solid.py`: faces of cells, and of solids in cells of 10 cm, which can have air under them as a column cannot. `church.py`: the church's two towers as such solids, the lidar's shape cut to their traced lines.
- `light.json` (`light.py`): the photograph's fill light, exposure and sky.
- `pins.json`, `camera.json`: the points the camera was pinned by, and the camera as solved, with its misses.
- `spots.json` (`spots.py`): where the long white slab and the towers' crowns stand in the engine's cells, for the lane that puts the menu and the logos on them.
- `queue.mjs`: runs a chain of steps on one turn of the machine's GPU; `webkit.mjs`: whether the place starts in WebKit.
- `sun.py`: the sun for the photograph's minute (bearing 251.85, height 55.37).

The engine's notes are in `.agents/skills/cell-engine` ("A place built to lie on a photograph").
