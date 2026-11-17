"""A check of the builder alone (run by test/drawn.mjs): a sheet whose side views draw the front to the right, as the
drawer now and then does, is the same thing as one whose side views draw it to the left. Made from the racer fixture
by mirroring each side view where it stands (the car is mirror-alike side to side): built, it is turned so its front
is at z 0, and its front end must be painted from the front view, as the sheet drawn as asked is.

  uv run --project draw python draw/check.py test/drawn/racer.jpg"""
import json, sys
import numpy as np
from PIL import Image
import sheet as drawn


def nose(sheet, long=160):
    """The front end as seen from in front of it: the first filled cell's colour along z from z 0, for each x and y."""
    idx, col, info = drawn.build(sheet, long)
    W, H, L = info['dims']
    grid = np.full((H, L, W, 3), -1.0); grid[idx[:, 1], idx[:, 2], idx[:, 0]] = col
    if info['front_low'] is False: grid = grid[:, ::-1, ::-1]
    filled = grid[..., 0] >= 0
    first = filled.argmax(1); ys, xs = np.indices(first.shape)
    face = grid[ys, first, xs]; face[~filled.any(1)] = np.nan
    return face, info


racer = Image.open(sys.argv[1]).convert('RGB')
a = np.asarray(racer).copy(); top = int(0.3 * a.shape[0]); half = a.shape[1] // 2
a[:top, :half] = a[:top, :half][:, ::-1]; a[:top, half:] = a[:top, half:][:, ::-1]
as_asked, i1 = nose(racer)
other_way, i2 = nose(Image.fromarray(a))
same = np.nanmean(np.abs(as_asked - other_way)) if as_asked.shape == other_way.shape else float('inf')
ends = np.nanmean(np.abs(as_asked - other_way[:, ::-1])) if as_asked.shape == other_way.shape else float('inf')
print(json.dumps(dict(as_asked_front_low=i1['front_low'], other_way_front_low=i2['front_low'], shapes=[list(as_asked.shape), list(other_way.shape)], differ=round(float(same), 1), differ_mirrored=round(float(ends), 1))))
ok = i1['front_low'] is True and i2['front_low'] is False and same < 10
print('ok' if ok else 'FAIL: the front end of the sheet drawn the other way is not painted from its front view')
sys.exit(0 if ok else 1)
