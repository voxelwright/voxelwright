"""Bakes the far model's faces for squares of the city (#450): each square's lidar as the outside faces of columns of
half a metre, every side of them, as #423's place is baked (landing/ina/matte.py) but from any eye.

It reads the data lane's retained inputs, one archive a square (bay/intermediate.py writes them as the city's run
finishes each): ~/.village/engine/bay/450-inputs/<square>.zip with frame.json, top_mm.npy (the highest return in each
quarter metre, NAVD88 millimetres), count, multi and intensity of the returns, footprint.npy (each quarter metre's
building, a row of footprints.geojson counted from 1) and ground.npy (1 m, NAVD88). All start in the north-west; a
square's arrays reach PAD metres past it, so a wall at its edge knows its neighbour.

Writes ~/.village/engine/sf/far/squares/<square>/: index.json and a block of faces for each 500 m tile of the frame's
grid the square touches (sf/far/pack.mjs packs them into the release's far tiles). Layers:
  far      what stands (buildings, trees), cells of 1 m (`--cell`), heights in steps of a cell. Half a metre is #423's
           far layer, for a 25 degree lens over 1 to 3 km; at the 70 degrees a visitor roams with a pixel is a metre and
           more past 600 m, and downtown 1 m is 3.8 MiB a square kilometre at Brotli 5 against 9.6
  ground   the bare ground, cells of 2 m, heights in steps of 1 m

Incremental: a square whose archive has not changed since it was baked (its size and time, and this bake's VERSION)
is left alone, so the far model grows as the run finishes squares.

    ~/.village/engine/landing/ina/venv/bin/python engine/sf/far/bake.py [square ...] [--force] [--cell 1] [--out dir]
"""
import io, json, math, os, sys, time, zipfile, zlib
import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'landing', 'ina'))
import looks  # noqa: E402  wall colours and windows by rule (#423)
from matte import faces, filled, rgb24  # noqa: E402  columns to faces (#423)

INPUTS = os.path.expanduser('~/.village/engine/bay/450-inputs')
OUT = os.path.expanduser('~/.village/engine/sf/far/squares')
E0, N0, SEA = 500_000.0, 4_250_000.0, 1.0
TILE = 500.0  # metres: the far model's tiles (pack.mjs SIZE)
VERSION = 2
NAMES = os.path.join(HERE, '..', '..', 'landing', 'ina', 'names.json')


def load(path):
    z = zipfile.ZipFile(path)
    arr = lambda k: np.load(io.BytesIO(z.read(k + '.npy')))
    frame = json.loads(z.read('frame.json'))
    feats = json.loads(z.read('footprints.geojson'))['features']
    return frame, arr, feats


def pool(a, k, how):
    """A quarter-metre grid to cells k times as wide: each k x k by `how` (max, sum)."""
    n = a.shape[0] // k * k
    b = a[:n, :n].reshape(n // k, k, n // k, k)
    return b.max(axis=(1, 3)) if how == 'max' else b.sum(axis=(1, 3))


def named(frame, ids, cell):
    """Which building numbers carry a known name (landing/ina/names.json: a point inside each)."""
    import pyproj
    utm = pyproj.Transformer.from_crs(4326, 26910, always_xy=True)
    out = {}
    for name, (lat, lon) in json.load(open(NAMES)).items():
        e, n = utm.transform(lon, lat)
        c, r = int((e - frame['west']) / cell), int((frame['north'] - n) / cell)
        if 0 <= r < ids.shape[0] and 0 <= c < ids.shape[1] and ids[r, c] > 0:
            out[int(ids[r, c])] = name
    return out


def bake(square, force=False, cell=0.5, out=OUT):
    src = f'{INPUTS}/{square}.zip'
    st = os.stat(src)
    sig = f'{VERSION}:{cell}:{st.st_size}:{int(st.st_mtime)}'
    dest = f'{out}/{square}'
    if not force and os.path.exists(f'{dest}/index.json') and json.load(open(f'{dest}/index.json')).get('inputs') == sig:
        return None
    began = time.time()
    frame, arr, feats = load(src)
    west, north = frame['west'], frame['north']
    e0, n0 = (float(v) * 1000 for v in square.split('_'))
    k = int(round(cell / 0.25))
    # ── The surface at half a metre: the highest return; how many came back, and how many more than once.
    mm = arr('top_mm')
    hole = mm == np.iinfo(np.int32).min
    top = pool(np.where(hole, -1e9, mm / 1000.0).astype(np.float32), k, 'max')
    count = pool(arr('count').astype(np.float32), k, 'sum')
    multi = pool(arr('multi').astype(np.float32), k, 'sum')
    bright = pool(arr('intensity').astype(np.float32), k, 'max')
    ids = pool(arr('footprint'), k, 'max').astype(np.int32)
    del mm, hole
    # The ground at each half metre's middle, from the 1 m grid (a sample at each whole metre from the corner).
    g1 = arr('ground').astype(np.float32)
    rows, cols = top.shape
    rr, cc = np.meshgrid((np.arange(rows) + 0.5) * cell, (np.arange(cols) + 0.5) * cell, indexing='ij')
    ground = ndimage.map_coordinates(g1, [rr, cc], order=1, mode='nearest').astype(np.float32)
    del rr, cc
    seen = top > -1e8
    top, _ = filled(np.where(seen, top, -1e9), ground)
    # The lidar's noise taken off a flat roof, and the wall's foot not a bar code (matte.py `prepared`).
    for size, near in ((3, 0.2), (5, 0.5)):
        smooth = ndimage.median_filter(top, size=size)
        top = np.where(np.abs(smooth - top) < near, smooth, top)
    top = ndimage.median_filter(top, size=3)
    over = top - ground
    # A cell within 3 m of an outline that stands as high as the building's nearest cell is that building's.
    far, (ri, ci) = ndimage.distance_transform_edt(ids == 0, return_indices=True)
    beside = (ids == 0) & (far * cell <= 3.0) & (over > 3.0) & (np.abs(top - top[ri, ci]) < 2.0)
    ids = np.where(beside, ids[ri, ci], ids)
    del far, ri, ci
    # Leaf: whole things where no building is outlined, an eighth of whose cells sent a pulse back more than once.
    clear = ndimage.distance_transform_edt(ids == 0) * cell > 1.5
    several = (multi / np.maximum(count, 1) > 0.3) & (over > 2.0) & (over < 45.0) & clear
    things, n = ndimage.label((ids == 0) & (over > 2.0) & (over < 45.0))
    share = ndimage.mean(several, things, index=np.arange(n + 1)) if n else np.zeros(1)
    leafy = (np.nan_to_num(share) > 0.125)[things] & (things > 0)
    del things, several, clear
    scale = 255.0 / max(1.0, float(np.percentile(bright[seen], 98)))
    most = int(ids.max())
    grey = np.full(top.shape, 120.0, np.float32)
    if most:
        mean = ndimage.mean(bright[ids > 0] * scale, ids[ids > 0], index=np.arange(most + 1))
        grey = np.where(ids > 0, np.nan_to_num(mean)[ids], grey).astype(np.float32)
    # The Bay: ground at its level where nothing stands a metre over it. (Where the lidar had a return off the water
    # it is not unseen, and ground faces at sea level drew grey bands across the Bay past the piers.)
    water = (ground < 1.6) & (~seen | (over < 1.0))
    # ── Each building: its number in the city (the same in both squares of a seam), how tall it stands, its name.
    tall = ndimage.median(over, ids, index=np.arange(most + 1)) if most else np.zeros(1)
    names = named(frame, ids, cell)
    table = [{'id': i, 'city': str((feats[i - 1]['properties'].get('sf16_bldgid') or feats[i - 1]['properties'].get('globalid') or i)), 'stands': float(tall[i]), 'name': names.get(i, '')} for i in range(1, most + 1)]
    wall_of, style_of = looks.walls(table, most)
    lum = np.round(np.clip(55 + grey * 0.75, 60, 230) / 12) * 12
    roof = np.where(leafy, rgb24(np.full(top.shape, 62), np.full(top.shape, 98), np.full(top.shape, 46)), rgb24(lum, lum, lum * 0.98))
    green = rgb24(np.full(top.shape, 46), np.full(top.shape, 74), np.full(top.shape, 36))
    walls = np.where(leafy, green, wall_of[ids])
    style = np.where(leafy, 0, style_of[ids])
    # The building's number the faces carry: the city's own, so that it is the same building in every square.
    city = np.zeros(most + 1, np.int64)
    for b in table:
        city[b['id']] = zlib.crc32(b['city'].encode()) & 0xffffff or 1
    bid = city[ids]
    # ── Which cells are this square's: its own kilometre, not the margin.
    ee = west + (np.arange(cols) + 0.5) * cell
    nn = north - (np.arange(rows) + 0.5) * cell
    own = ((ee >= e0) & (ee < e0 + 1000))[None, :] & ((nn > n0) & (nn <= n0 + 1000))[:, None]
    stands = (ids > 0) | (over > 2.0)
    os.makedirs(dest, exist_ok=True)
    for old in os.listdir(dest):
        os.remove(f'{dest}/{old}')
    blocks = []
    zeros = np.zeros(top.shape, np.int64)

    def write(layer, h, inside, ours, roof, walls, style, bid, floor, hq, step):
        """One layer's faces, a block for each 500 m tile of the frame's grid: what the tile holds of this square. `inside`
        is what stands, the margin's too (so that a wall at the square's edge stops at its neighbour); `ours` is the square."""
        ce = west + (np.arange(h.shape[1]) + 0.5) * cell * step
        cn = north - (np.arange(h.shape[0]) + 0.5) * cell * step
        tx = np.floor((ce - E0) / TILE).astype(int)
        tz = np.floor((N0 - cn) / TILE).astype(int)
        held = inside & ours
        for x in np.unique(tx[held.any(0)]):
            for z in np.unique(tz[held.any(1)]):
                cs, rs = np.flatnonzero(tx == x), np.flatnonzero(tz == z)
                c0, c1, r0, r1 = cs[0], cs[-1] + 1, rs[0], rs[-1] + 1
                if not held[r0:r1, c0:c1].any():
                    continue
                # A cell of margin each side, so that a wall at the block's edge knows its neighbour.
                ra, rb, ca, cb = max(0, r0 - 1), min(h.shape[0], r1 + 1), max(0, c0 - 1), min(h.shape[1], c1 + 1)
                sl = (slice(ra, rb), slice(ca, cb))
                mine = np.zeros((rb - ra, cb - ca), bool)
                mine[r0 - ra:r1 - ra, c0 - ca:c1 - ca] = True
                mine &= ours[sl]
                f = faces(h[sl], inside[sl], roof[sl], walls[sl], style[sl], bid[sl], zeros[sl] if step == 1 else np.zeros(h[sl].shape, np.int64), floor[sl], hq)
                # Faces that begin in the margin are the neighbouring block's (matte.py `write`).
                fx, fz = (f[:, 0] & 0x7ff).astype(np.int64), ((f[:, 0] >> 11) & 0x7ff).astype(np.int64)
                f = f[mine[np.clip(fz, 0, rb - ra - 1), np.clip(fx, 0, cb - ca - 1)]]
                if not len(f):
                    continue
                name = f'{layer}-{x}_{z}.bin'
                f.astype('<u4').tofile(f'{dest}/{name}')
                hs = h[sl][inside[sl] & mine] * hq
                blocks.append({'file': name, 'layer': layer, 'tile': f'{x}_{z}', 'faces': int(len(f)), 'cell': cell * step * 10, 'uw': [0, 0],
                               'pos': [round((west + ca * cell * step - E0) * 10, 3), 0, round((N0 - north + ra * cell * step) * 10, 3)],
                               'c0': [1, 0, 0], 'c2': [0, 0, 1], 'size': [int(cb - ca), int(hs.max()) + 1, int(rb - ra)], 'low': int(hs.min())})

    hq = int(round(cell * 10))
    h = np.maximum(np.round((top - SEA) * 10 / hq).astype(np.int64), 0)
    floor = np.maximum(np.round((ground - SEA) * 10 / hq).astype(np.int64), 0)
    write('far', h, stands & ~water, own, roof, walls, style, bid, floor, hq, 1)
    # The bare ground, every 4th cell (2 m), at its own height in metres; grey, a little green where it is leaf.
    step, hq = max(1, int(round(2.0 / cell))), 10
    sub = (slice(step // 2, None, step), slice(step // 2, None, step))
    gh = np.maximum(np.round((ground[sub] - SEA) * 10 / hq).astype(np.int64), 0)
    gc = np.where(leafy[sub] | ((over[sub] > 0.5) & (ids[sub] == 0)), rgb24(np.full(gh.shape, 92), np.full(gh.shape, 104), np.full(gh.shape, 80)), rgb24(np.full(gh.shape, 104), np.full(gh.shape, 104), np.full(gh.shape, 106)))
    write('ground', gh, ~water[sub], own[sub], gc, gc, np.zeros(gh.shape, np.int64), np.zeros(gh.shape, np.int64), gh, hq, step)
    index = {'village': 'far', 'version': VERSION, 'square': square, 'inputs': sig, 'turn': 0, 'faces': sum(b['faces'] for b in blocks), 'blocks': blocks,
             'sun': None, 'styles': looks.STYLES, 'credit': 'U.S. Geological Survey 3DEP; City and County of San Francisco (DataSF)'}
    json.dump(index, open(f'{dest}/index.json.part', 'w'))
    os.replace(f'{dest}/index.json.part', f'{dest}/index.json')
    return {'square': square, 'faces': index['faces'], 'blocks': len(blocks), 'seconds': round(time.time() - began, 1)}


def main():
    force = '--force' in sys.argv
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    cell, out = float(arg('--cell', '1')), os.path.expanduser(arg('--out', OUT))
    asked = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith('--') and sys.argv[i - 1] not in ('--cell', '--out')]
    squares = asked or sorted(f[:-4] for f in os.listdir(INPUTS) if f.endswith('.zip') and not f.endswith('.part'))
    for s in squares:
        said = bake(s, force, cell, out)
        print(json.dumps(said) if said else f'{s}: as it was', flush=True)


if __name__ == '__main__':
    main()
