# engine/draw

The builder of drawn things. An image model draws a wish as one sheet of five parallel views (left, right, front, rear, top), and this folder carves and paints cells from those views. The helper runs it for a typed wish nothing kept answers; the rest of the flow (the drawer, the model's facts, the checks against its size) is in [making](../../guide/making.md#a-drawn-thing) and `../make/drawn.mjs`.

It is Python because the work is image labelling, opening and distance sums that numpy and scipy already do well. A second copy in JavaScript would be one more thing to keep right.

## Files

| File | What it does |
| --- | --- |
| `sheet.py` | The carving. `cut` finds the five views on a sheet: of the seven biggest shapes, the five that pair up best as mirrored outlines (left with right, front with rear; the one left over is the top), since the drawer now and then draws a view twice. `build` trims each view, sizes the grid from the views' proportions, carves the biggest solid all five outlines allow, keeps the pieces that reach the ground, and paints each outside cell from the view that faces it most. `front_low` says which end is the front, as the top view shows it. |
| `build.py` | What the helper runs. Started when a wish begins, so its imports finish while the picture is drawn. It waits for one line on stdin, `{"sheet", "long", "out"}`, builds the sheet with `long` cells along its longest side, writes the cells to `out` as four bytes a cell (red, green, blue, and 255 for filled or 0 for air) in a reply's order, turned so the front is at z 0, then prints one line of JSON: what it found, or `{"why": ...}`. |
| `check.py` | A check of the builder alone: a sheet whose side views face the other way must carve to the same front end. |
| `pyproject.toml`, `uv.lock` | Python 3.12 with numpy, scipy and Pillow, run through uv |

A sheet over 24 million pixels is refused (`PIXELS_MOST` in `build.py`).

## Run it

uv makes the environment on first use (one network fetch), from `pyproject.toml` and `uv.lock`. Run from this folder:

```sh
uv run python check.py ../test/drawn/racer.png       # prints ok, or FAIL and why
uv run python build.py sheet.png out.bin 224         # one sheet by hand: 224 cells along its longest side
```

The helper starts `build.py` in this folder with uv's project option pointed here, and with no key in its environment (`builder` in `../make/drawn.mjs`).

## Check it

```sh
cd ..
node test/drawn.mjs     # runs check.py, then a drawn thing end to end in Chrome with stand-ins for fal and the model
```

The stand-in sheets are `../test/drawn/racer.png` and `../test/drawn/hydrant.png`, drawn by `../test/drawn/make-sheets.py`.
