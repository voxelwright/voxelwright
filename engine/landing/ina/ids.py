"""Which building each cell of the surface belongs to (#423): the city's outlines drawn into both grids, and what
is known of each building, by the number its cells carry.

    python ids.py        writes DATA/ids-fine.npy, ids-far.npy and buildings.json
"""
import json, os, sys
import numpy as np
import pyproj
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from place import DATA, EYE, RAW, turned

Image.MAX_IMAGE_PIXELS = None


def main():
    utm = pyproj.Transformer.from_crs(4326, 26910, always_xy=True)
    feats = json.load(open(f'{RAW}/footprints.geojson'))['features']
    named = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'names.json'))) if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'names.json')) else {}
    spots = {k: turned(*utm.transform(v[1], v[0])) for k, v in named.items()}
    rings, table = [], []
    for f in feats:
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        mine = []
        for poly in polys:
            mine.append([np.stack(turned(*utm.transform(*np.array([p[:2] for p in ring]).T)), 1) for ring in poly])
        p = f['properties']
        allp = np.concatenate([r[0] for r in mine])
        e, n = utm.transform(*np.array([q[:2] for q in polys[0][0]]).T)
        num = lambda k: float(p[k]) if p.get(k) not in (None, '') else None
        rings.append(mine)
        table.append({'id': len(table) + 1, 'city': str(p.get('sf16_bldgid') or p.get('globalid')), 'u': round(float(allp[:, 0].mean()), 1), 'w': round(float(allp[:, 1].mean()), 1),
                      'far': round(float(np.hypot(e.mean() - EYE[0], n.mean() - EYE[1]))), 'ground': num('gnd_min_m'), 'tall': num('hgt_median_m'), 'peak': num('peak_1st_m')})
    for name in ('fine', 'far'):
        u0, w0, cell = np.load(f'{DATA}/surface-{name}.npz')['frame']
        shape = np.load(f'{DATA}/surface-{name}.npz')['top'].shape
        img = Image.new('I', (shape[1], shape[0]), 0)
        d = ImageDraw.Draw(img)
        for i, polys in enumerate(rings, 1):
            for poly in polys:
                d.polygon([((u - u0) / cell, (w - w0) / cell) for u, w in poly[0]], fill=i)
                for hole in poly[1:]:
                    d.polygon([((u - u0) / cell, (w - w0) / cell) for u, w in hole], fill=0)
        ids = np.asarray(img).astype(np.int32)
        np.save(f'{DATA}/ids-{name}.npy', ids)
        if name == 'far':
            for k, (u, w) in spots.items():
                c, r = int((u - u0) / cell), int((w - w0) / cell)
                if 0 <= r < shape[0] and 0 <= c < shape[1] and ids[r, c]:
                    table[ids[r, c] - 1]['name'] = k
                else:
                    print('no outline under', k)
        if name == 'far':
            # How tall each stands by the lidar (the city's own figures are older than its newest towers).
            from scipy import ndimage
            s = np.load(f'{DATA}/surface-{name}.npz')
            over = np.where(s['top'] > -1e8, s['top'] - s['ground'], 0)
            high = ndimage.median(over[ids > 0], ids[ids > 0], index=np.arange(1, len(table) + 1))
            for t, h in zip(table, high):
                t['stands'] = None if np.isnan(h) else round(float(h), 1)
        print(name, 'cells in a building:', round(float((ids > 0).mean()), 3))
    json.dump(table, open(f'{DATA}/buildings.json', 'w'))
    print(len(table), 'buildings,', sum(1 for t in table if 'name' in t), 'named')


main()
