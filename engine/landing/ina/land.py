"""The land past the lidar (#423): the East Bay's shore and hills, which stand behind the bridge at the photograph's
left. From Mapterhorn's terrain tiles (.agents/skills/bay-sources: no key; credit "terrain: Mapterhorn"), as heights
on a grid laid out with the streets like every other grid here, 40 m a cell from 3.3 km to 30 km.

    python land.py        fetches the tiles into RAW/terrain and writes DATA/land.npz
"""
import io, math, os, sys, time, urllib.request
import numpy as np
import pyproj
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from place import DATA, EYE, RAW, TURN, WEDGE, unturned

ZOOM, CELL, FAR = 11, 40.0, 30_000.0
# The frame's left edge looks along bearing 93; the hills are wanted a little past both edges of what the lidar's wedge is.
FROM, TO = WEDGE['from'] - 4, WEDGE['to'] - 14


def tile(x, y):
    path = f'{RAW}/terrain/{ZOOM}_{x}_{y}.webp'
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        for k in range(5):
            try:
                with urllib.request.urlopen(urllib.request.Request(f'https://tiles.mapterhorn.com/{ZOOM}/{x}/{y}.webp', headers={'User-Agent': 'village-engine'}), timeout=60) as r:
                    data = r.read()
                break
            except Exception:
                if k == 4:
                    raise
                time.sleep(1.5 * (k + 1))
        open(path, 'wb').write(data)
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    return rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768


def main():
    geo = pyproj.Transformer.from_crs(26910, 4326, always_xy=True)
    # The grid's box in the turned frame.
    b = np.radians(np.arange(FROM, TO + 0.1, 1.0))
    de, dn = np.concatenate([[0], FAR * np.sin(b)]), np.concatenate([[0], FAR * np.cos(b)])
    t = math.radians(TURN)
    u, w = de * math.cos(t) - (-dn) * math.sin(t), de * math.sin(t) + (-dn) * math.cos(t)
    u0, w0 = math.floor(u.min() / CELL) * CELL, math.floor(w.min() / CELL) * CELL
    nu, nw = int((u.max() - u0) / CELL) + 1, int((w.max() - w0) / CELL) + 1
    uu, ww = np.meshgrid(u0 + (np.arange(nu) + 0.5) * CELL, w0 + (np.arange(nw) + 0.5) * CELL)
    e, n = unturned(uu, ww)
    lon, lat = geo.transform(e, n)
    size = 512 * 2 ** ZOOM
    px = (lon + 180) / 360 * size
    py = (1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * size
    high = np.zeros(uu.shape, np.float32)
    tx, ty = (px // 512).astype(np.int64), (py // 512).astype(np.int64)
    for x, y in sorted({(int(a), int(c)) for a, c in zip(tx.ravel(), ty.ravel())}):
        m = (tx == x) & (ty == y)
        h = tile(x, y)
        high[m] = h[np.clip((py[m] - y * 512).astype(np.int64), 0, 511), np.clip((px[m] - x * 512).astype(np.int64), 0, 511)]
    np.savez(f'{DATA}/land.npz', top=high, frame=np.array([u0, w0, CELL]))
    dist = np.hypot(e - EYE[0], n - EYE[1])
    print(f'land: {nu} x {nw} cells of {CELL:.0f} m; dry {float((high > 1.0).mean()):.2f}; highest {float(high.max()):.0f} m; highest within 30 km {float(high[dist < FAR].max()):.0f} m')


if __name__ == '__main__':
    main()
