"""What stands in the wedge, from the lidar (#423): the highest return in every cell of two grids laid out with the
streets (place.py `turned`): `fine`, a quarter of a metre, out to 1.3 km where every point was fetched; `far`, half
a metre, out to 3.3 km. With it, for telling a tree from a roof and a pale roof from a dark one without any
photograph: how many returns a cell had, how many of them were one of several from one pulse (leaves let a pulse
through, roofs do not), and how bright the returns near the top were. And the bare ground under both, from the 1 m model.

    python surface.py            writes DATA/surface-fine.npz and surface-far.npz, and pictures of both
"""
import glob, json, os, sys, time
import numpy as np
import laspy, pyproj, tifffile
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from place import DATA, EYE, RAW, WEDGE, turned, unturned

GRIDS = {'fine': {'cell': 0.25, 'far': WEDGE['fine'] + 60}, 'far': {'cell': 0.5, 'far': WEDGE['far'] + 60}}


def box(far):
    """The wedge's box in the turned frame, out to `far`, with a margin."""
    b = np.radians(np.arange(WEDGE['from'] - 3, WEDGE['to'] + 3.1, 1.0))
    e, n = EYE[0] + np.concatenate([[0], far * np.sin(b)]), EYE[1] + np.concatenate([[0], far * np.cos(b)])
    u, w = turned(e, n)
    return np.floor(u.min() - 40), np.floor(w.min() - 40), np.ceil(u.max() + 40), np.ceil(w.max() + 40)


def main():
    os.makedirs(DATA, exist_ok=True)
    merc = pyproj.Transformer.from_crs(3857, 26910, always_xy=True)
    grids = {}
    for name, g in GRIDS.items():
        u0, w0, u1, w1 = box(g['far'])
        nu, nw = int((u1 - u0) / g['cell']), int((w1 - w0) / g['cell'])
        grids[name] = {'u0': u0, 'w0': w0, 'cell': g['cell'], 'nu': nu, 'nw': nw, 'top': np.full(nu * nw, -1e9, np.float32), 'count': np.zeros(nu * nw, np.uint16), 'multi': np.zeros(nu * nw, np.uint16), 'bright': np.zeros(nu * nw, np.float32)}
        print(name, 'grid', nu, 'x', nw, 'cells of', g['cell'], 'm')
    nodes = json.load(open(f'{RAW}/lidar/nodes.json'))
    began, kept, classes = time.time(), 0, {}
    for i, (k, _) in enumerate(nodes):
        # The octree's last depth was fetched near the eye for the solids alone (church.py).
        if int(k.split('-')[0]) > WEDGE['deepest']:
            continue
        las = laspy.read(f'{RAW}/lidar/{k}.laz')
        c = np.asarray(las.classification)
        ok = (c != 7) & (c != 18)
        for a, b in zip(*np.unique(c, return_counts=True)):
            classes[int(a)] = classes.get(int(a), 0) + int(b)
        e, n = merc.transform(np.asarray(las.x)[ok], np.asarray(las.y)[ok])
        z = np.asarray(las.z)[ok].astype(np.float32)
        several = np.asarray(las.number_of_returns)[ok] > 1
        inten = np.asarray(las.intensity)[ok].astype(np.float32)
        u, w = turned(e, n)
        for g in grids.values():
            col, row = np.floor((u - g['u0']) / g['cell']).astype(np.int64), np.floor((w - g['w0']) / g['cell']).astype(np.int64)
            inside = (col >= 0) & (col < g['nu']) & (row >= 0) & (row < g['nw'])
            at = row[inside] * g['nu'] + col[inside]
            np.maximum.at(g['top'], at, z[inside])
            np.add.at(g['count'], at, 1)
            np.add.at(g['multi'], at, several[inside].astype(np.uint16))
            np.add.at(g['bright'], at, inten[inside])
        kept += int(ok.sum())
        if i % 400 == 399:
            print(f'  {i + 1} of {len(nodes)} nodes, {kept / 1e6:.0f} M points, {time.time() - began:.0f} s', flush=True)
    print('classes', classes)

    # The bare ground, a sample at each cell's middle, from the 1 m model (its samples are at whole metres of UTM).
    with tifffile.TiffFile(glob.glob(f'{os.path.dirname(RAW)}/dem_*.tif')[0]) as t:
        tie, dem = t.geotiff_metadata['ModelTiepoint'], t.pages[0].asarray()
    for name, g in grids.items():
        nu, nw = g['nu'], g['nw']
        uu, ww = np.meshgrid(g['u0'] + (np.arange(nu) + 0.5) * g['cell'], g['w0'] + (np.arange(nw) + 0.5) * g['cell'])
        e, n = unturned(uu, ww)
        fc, fr = np.clip(e - tie[3] - 0.5, 0, dem.shape[1] - 1.001), np.clip(tie[4] - n - 0.5, 0, dem.shape[0] - 1.001)
        c0, r0 = fc.astype(np.int32), fr.astype(np.int32)
        a, b = (fc - c0).astype(np.float32), (fr - r0).astype(np.float32)
        ground = (dem[r0, c0] * (1 - a) * (1 - b) + dem[r0, c0 + 1] * a * (1 - b) + dem[r0 + 1, c0] * (1 - a) * b + dem[r0 + 1, c0 + 1] * a * b).astype(np.float32)
        top, count = g['top'].reshape(nw, nu), g['count'].reshape(nw, nu)
        bright = (g['bright'].reshape(nw, nu) / np.maximum(count, 1)).astype(np.float32)
        np.savez(f'{DATA}/surface-{name}.npz', top=top, count=count, multi=g['multi'].reshape(nw, nu), bright=bright, ground=ground, frame=np.array([g['u0'], g['w0'], g['cell']]))
        seen = top > -1e8
        print(name, f'{seen.mean():.3f} of cells have a return; points a cell where seen: {count[seen].mean():.1f}')
        h = np.where(seen, top - ground, 0)
        shade = np.clip(110 + (np.roll(top, 1, 1) - top) * 30 + (np.roll(top, 1, 0) - top) * 30, 0, 255)
        k = max(1, int(round(max(nu, nw) / 4000)))
        Image.fromarray(np.where(seen, shade, 0).astype(np.uint8)[::k, ::k]).save(f'{DATA}/surface-{name}.png')
        Image.fromarray(np.clip(h * 1.2, 0, 255).astype(np.uint8)[::k, ::k]).save(f'{DATA}/surface-{name}-height.png')


main()
