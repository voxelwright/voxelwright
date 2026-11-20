"""The twin towers of Our Lady of Guadalupe as solids (#423), in the engine's own cells of 10 cm.

From the park the towers are 137 and 144 m off, where a pixel of the photograph is 7 cm. The lidar's columns cannot
hold them: each cornice stands out 0.4 to 0.9 m over the stage below, and a column is solid under its top, so the
belfry and the lantern were drawn as wide as the cornice over them (6 px too wide a side: the towers' lines
measured 5.6 and 6.6 px). Cells half the size changed that by 0.4 px. The lidar sees the walls under a cornice
only where its pulses came in aslant, and the belfry's columns not at all.

So each tower, from the ledge at 65 m up, is:
  the lidar's own shape   the highest return in each cell of 10 cm, a cell wider all round
  cut to the photograph   a cell stays only where it falls inside the tower's outline as traced on the photograph
                          (outlines.json): what is cut away is the air under the cornices
  its finial and cross    the lidar has them as a blur a metre wide. The finial is turned about the tower's axis
                          to the width traced at each height; the cross is a plate one cell thick along the front.

The towers are therefore fitted to the lines they are measured by. What checks them is the lidar: `check()` says
how many of its returns fall in cells that were cut away, and how far its returns lie from the solid's faces.

    python church.py        builds both and prints the check
"""
import json, math, os, sys
import numpy as np
import cv2
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import camera, solid
from place import DATA, E0, EYE, N0, RAW, SEA, TURN, turned, unturned

HERE = os.path.dirname(os.path.abspath(__file__))
FOOT, TOP, HALF = 65.0, 82.6, 4.0  # where a tower's solid begins and ends (NAVD88), and half its box's side, metres
COPPER = (74, 150, 128)
# Each tower: its traced line, its pin (the lidar's peak on its axis), the row of the photograph where the dome ends
# and the finial begins, and the row where the finial's ball ends and the cross begins.
TOWERS = [
    {'line': 'Our Lady of Guadalupe, left tower', 'pin': 'church, left tower, top of the cross', 'apex': 543.0, 'cross': 516.0},
    {'line': 'Our Lady of Guadalupe, right tower', 'pin': 'church, right tower, top of the cross', 'apex': 553.5, 'cross': 523.9},
]


def boxes():
    """Where the lidar's columns are cut off, and at what height: (u0, u1, w0, w1, cap) for each tower."""
    pins = {p['name']: p for p in json.load(open(f'{HERE}/pins.json'))['pins']}
    out = []
    for t in TOWERS:
        u, w = (float(v) for v in turned(*pins[t['pin']]['xyz'][:2]))
        # The box's corner on a whole cell of 10 cm.
        u0, w0 = round(u - HALF, 1), round(w - HALF, 1)
        out.append((u0, u0 + 2 * HALF, w0, w0 + 2 * HALF, FOOT))
    return out


def points():
    """The lidar's returns round the church (u, w, height), kept in DATA: found once by reading every node."""
    path = f'{DATA}/points-church.npy'
    if not os.path.exists(path):
        import laspy, pyproj
        merc = pyproj.Transformer.from_crs(3857, 26910, always_xy=True)
        b = boxes()
        u0, u1, w0, w1 = min(v[0] for v in b) - 2, max(v[1] for v in b) + 2, min(v[2] for v in b) - 2, max(v[3] for v in b) + 2
        got = []
        for k, _ in json.load(open(f'{RAW}/lidar/nodes.json')):
            las = laspy.read(f'{RAW}/lidar/{k}.laz')
            c = np.asarray(las.classification)
            e, n = merc.transform(np.asarray(las.x), np.asarray(las.y))
            u, w = turned(e, n)
            ok = (c != 7) & (c != 18) & (u > u0) & (u < u1) & (w > w0) & (w < w1)
            if ok.any():
                got.append(np.stack([u[ok], w[ok], np.asarray(las.z)[ok]], 1).astype(np.float32))
        np.save(path, np.concatenate(got))
    return np.load(path)


def inside(line, pad=0.0, fine=8):
    """A traced line closed into a shape, as a test: is a place on the photograph inside it, or within `pad` pixels of it?"""
    line = np.array(line, np.float32)
    x0, y0 = np.floor(line.min(0)) - 4
    x1, y1 = np.ceil(line.max(0)) + 4
    mask = np.zeros((int((y1 - y0) * fine), int((x1 - x0) * fine)), np.uint8)
    cv2.fillPoly(mask, [np.round((line - [x0, y0]) * fine).astype(np.int32)], 255)
    r = int(round(pad * fine))
    mask = (cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) if r else mask) > 0

    def test(uv):
        c, r_ = np.floor((uv[:, 0] - x0) * fine).astype(np.int64), np.floor((uv[:, 1] - y0) * fine).astype(np.int64)
        ok = (c >= 0) & (c < mask.shape[1]) & (r_ >= 0) & (r_ < mask.shape[0])
        return ok & mask[np.clip(r_, 0, mask.shape[0] - 1), np.clip(c, 0, mask.shape[1] - 1)]
    return test, mask, (x0, y0, fine)


def tower(t, cam, pts, lines, pins):
    """One tower's cells [z, w, u] (1 its walls, 2 its copper), its box's corner, and what the lidar says of it."""
    u, w = (float(v) for v in turned(*pins[t['pin']]['xyz'][:2]))
    u0, w0 = round(u - HALF, 1), round(w - HALF, 1)
    n, nz = int(round(2 * HALF * 10)), int(round((TOP - FOOT) * 10))
    mine = pts[(pts[:, 0] >= u0) & (pts[:, 0] < u0 + 2 * HALF) & (pts[:, 1] >= w0) & (pts[:, 1] < w0 + 2 * HALF) & (pts[:, 2] > FOOT - 0.5)]
    col, row = np.floor((mine[:, 0] - u0) * 10).astype(np.int64), np.floor((mine[:, 1] - w0) * 10).astype(np.int64)
    top = np.full(n * n, -1e9, np.float32)
    np.maximum.at(top, row * n + col, mine[:, 2])
    top = top.reshape(n, n)
    seen = top > -1e8
    # A cell no return fell in is the middle of its neighbours that had one.
    for _ in range(4):
        p = np.pad(np.where(seen, top, np.nan), 1, constant_values=np.nan)
        stack = np.stack([p[i:i + n, j:j + n] for i in range(3) for j in range(3)])
        take = ~seen & (np.isfinite(stack).sum(0) >= 2)
        with np.errstate(all='ignore'):
            top = np.where(take, np.nanmedian(stack, 0), top)
        seen |= take
    top = np.where(seen, top, FOOT)
    # One return a cell leaves every edge ragged by a cell, and a ragged edge drawn down a wall is stripes: the
    # middle of five cells each way. Then a cell wider all round, so that the solid surely holds the outline: the
    # outline cuts it.
    top = ndimage.maximum_filter(ndimage.median_filter(top, size=5), size=3)
    zz = FOOT + (np.arange(nz) + 0.5) * 0.1
    uu, ww = u0 + (np.arange(n) + 0.5) * 0.1, w0 + (np.arange(n) + 0.5) * 0.1
    vox = (zz[:, None, None] < top[None, :, :]).astype(np.uint8)
    Z, W_, U = np.meshgrid(zz, ww, uu, indexing='ij')
    e, nn = unturned(U.ravel(), W_.ravel())
    uv, _ = camera.project(cam, np.stack([e, nn, Z.ravel()], 1))
    uv = uv.reshape(nz, n, n, 2)
    line = lines[t['line']]
    # A cell is a pixel and a half across: one whose middle is inside the line stands half a pixel past it at most.
    held = inside(line, pad=0)[0](uv.reshape(-1, 2)).reshape(nz, n, n)
    thin = inside(line, pad=0.4)[0](uv.reshape(-1, 2)).reshape(nz, n, n)
    _, mask, (mx, my, fine) = inside(line, pad=0)
    bottom = max(p[1] for p in line)
    # The dome ends and the finial begins where the axis crosses the row `apex`: over that the lidar's blur goes.
    ax_e, ax_n = unturned(u, w)
    rows = camera.project(cam, np.stack([np.full(nz, ax_e), np.full(nz, ax_n), zz], 1))[0][:, 1]
    over = rows < t['apex']
    lidar = vox.copy()
    vox[over] = 0
    # Cut to the outline: above the line's foot a cell stays only inside it.
    cut = (vox > 0) & (uv[..., 1] < bottom) & ~held
    vox[cut] = 0
    # The finial: at each height, round the axis, as wide as the outline is on the axis's row there.
    metre = np.linalg.norm(np.diff(camera.project(cam, np.array([[ax_e, ax_n, FOOT + 12.0], [ax_e + math.cos(math.radians(cam['yaw'])), ax_n - math.sin(math.radians(cam['yaw'])), FOOT + 12.0]]))[0], axis=0))  # pixels a metre across the look
    away = np.hypot(U - u, W_ - w)
    for k in np.flatnonzero(over):
        r = int((rows[k] - my) * fine)
        if rows[k] < t['cross'] or r < 0 or r >= mask.shape[0]:
            continue
        across = np.flatnonzero(mask[r])
        if len(across):
            vox[k][away[k] <= max(0.05, (across.max() - across.min() + 1) / fine / 2 / metre)] = 2
    # The cross: a plate one cell thick along the church's front (u), wherever it falls inside the outline.
    mid = int((w - w0) * 10)
    plate = np.zeros(vox.shape, bool)
    plate[:, mid, :] = True
    vox[plate & (uv[..., 1] < t['cross']) & thin & (np.abs(U - u) < 0.8)] = 2
    said = {'cells': int((vox > 0).sum()), 'cut': int(cut.sum()), 'returns': int(len(mine))}
    # What the lidar says: its returns that fall in a cell that was cut away, and how far each lies from the solid.
    k = np.floor((mine[:, 2] - FOOT) * 10).astype(np.int64)
    ok = (k >= 0) & (k < nz)
    said['returns in cells cut away'] = int(cut[k[ok], row[ok], col[ok]].sum())
    # A return lies on the real tower's face: how far that is from the solid's, outside it or inside (a cell's own half is taken off).
    d = np.maximum(np.where(vox > 0, ndimage.distance_transform_edt(vox > 0), ndimage.distance_transform_edt(vox == 0))[k[ok], row[ok], col[ok]] - 0.5, 0) * 0.1
    said['returns to the solid\'s faces, metres'] = {'median': round(float(np.median(d)), 3), 'p90': round(float(np.percentile(d, 90)), 3), 'over 0.3 m': round(float((d > 0.3).mean()), 4)}
    d0 = np.maximum(np.where(lidar > 0, ndimage.distance_transform_edt(lidar > 0), ndimage.distance_transform_edt(lidar == 0))[k[ok], row[ok], col[ok]] - 0.5, 0) * 0.1
    said['the same before the cut'] = {'median': round(float(np.median(d0)), 3), 'p90': round(float(np.percentile(d0, 90)), 3), 'over 0.3 m': round(float((d0 > 0.3).mean()), 4)}
    return vox, (u0, w0), said


def build(out, blocks, colours, bid, sun):
    """Writes the towers as blocks of the place `out`, and lists them in `blocks`. colours: the church's five (its roof, then its walls by the way they look), or None."""
    cam = json.load(open(f'{DATA}/camera.json'))['camera']
    lines = {o['name']: o['line'] for o in json.load(open(f'{HERE}/outlines.json'))['outlines']}
    pins = {p['name']: p for p in json.load(open(f'{HERE}/pins.json'))['pins']}
    pts = points()
    white = (240 << 16) | (240 << 8) | 236
    # The towers are white all round: the wall that faces the sun and the wall that faces the park take the
    # church's own fitted colours, the rest (and every ledge, which is no roof) the first of those.
    lit = colours[1] if colours else white
    walls = [lit, lit, lit, colours[3] if colours else white, lit]
    copper = (COPPER[0] << 16) | (COPPER[1] << 8) | COPPER[2]
    paint = [([0] * 5, 0), (walls, 0), ([copper] * 5, 0)]
    t = math.radians(TURN)
    checks = []
    for i, tw in enumerate(TOWERS):
        vox, (u0, w0), said = tower(tw, cam, pts, lines, pins)
        foot = int(round((FOOT - SEA) * 10))
        f = solid.faces(vox, paint, foot, bid, solid.sunlit(vox > 0, *sun))
        name = f'solid-church-{i}.bin'
        f.astype('<u4').tofile(f'{out}/{name}')
        de, ds = u0 * math.cos(t) + w0 * math.sin(t), -u0 * math.sin(t) + w0 * math.cos(t)
        high = np.flatnonzero((vox > 0).any((1, 2))).max()
        blocks.append({'file': name, 'layer': 'solid', 'faces': int(len(f)), 'cell': 1.0, 'uw': [u0, w0],
                       'pos': [round((EYE[0] + de - E0) * 10, 3), 0, round((N0 - EYE[1] + ds) * 10, 3)],
                       'size': [vox.shape[2], foot + int(high) + 2, vox.shape[1]], 'low': foot})
        said['faces'] = int(len(f))
        checks.append({'tower': tw['line'], **said})
    return checks


if __name__ == '__main__':
    import sun as sunny
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        for c in build(tmp, [], None, 1, sunny.sun()):
            print(json.dumps(c))
