"""The builder of drawn things (#245), run by the helper through uv (make/drawn.mjs `builder`). Started when a wish
is begun, so that its imports are done while the picture is drawn; it then waits for one line on stdin:

  {"sheet": "path/to/sheet.png", "long": 224, "out": "path/to/cells.bin"}

and builds the sheet with `long` cells along its longest side. It writes the cells to `out` as bytes, four to a
cell (red, green, blue, and 255 where the cell is filled, 0 where it is air), in a reply's order (make/cells.mjs:
x fastest, then z from the front, then y up), with its front at z 0 as the view from above says, turned (not
mirrored) when the sheet drew it the other way. Then it prints one line of JSON: what it found (`sheet.build`'s
info, with `size` [w, h, d] and `turned`), or {"why": ...} when the sheet will not build. Then it ends.

  uv run --project draw python draw/build.py          (the helper does this)
  uv run --project draw python draw/build.py sheet.png out.bin 224     (by hand)"""
import json, sys, time
import numpy as np
from PIL import Image
import sheet as drawn

# The most pixels of a sheet that is read: a 1K sheet is 1.4 million; more is not a sheet, and would only cost memory.
PIXELS_MOST = 24_000_000


def one(path, long, out):
    t = time.perf_counter()
    try:
        picture = Image.open(path)
        if picture.width * picture.height > PIXELS_MOST: return dict(why=f'the drawing is too big to read: {picture.width} by {picture.height}')
        idx, col, info = drawn.build(picture, int(long))
    except (ValueError, IndexError, OSError, Image.DecompressionBombError) as e: return dict(why=f'the drawing could not be read as five views: {e}')
    if not len(idx): return dict(why='nothing of the drawing stands: the five views do not agree on any solid')
    W, H, L = info['dims']
    grid = np.zeros((H, L, W, 4), np.uint8)
    grid[idx[:, 1], idx[:, 2], idx[:, 0], :3] = col
    grid[idx[:, 1], idx[:, 2], idx[:, 0], 3] = 255
    turned = info['front_low'] is False
    if turned: grid = grid[:, ::-1, ::-1]        # its front at z 0, turned half round (x too), so it is not mirrored
    grid.tofile(out)
    return dict(info, size=[W, H, L], turned=turned, ms_all=round((time.perf_counter() - t) * 1e3))


if __name__ == '__main__':
    if len(sys.argv) > 3: print(json.dumps(one(sys.argv[1], sys.argv[3], sys.argv[2])))
    else:
        line = sys.stdin.readline()
        if line.strip():
            ask = json.loads(line)
            print(json.dumps(one(ask['sheet'], ask['long'], ask['out'])), flush=True)
