"""Where things a later lane wants stand in the world (#423): the long white slab, which is to carry the landing's
menu, and the crowns of towers that could carry a logo. Each as the face the park sees: its two top corners and its
foot in the engine's cells of 10 cm (x east and z south of the Bay frame's corner, y up from 1 m over NAVD88's zero),
which way it looks, how far off it is, and where it falls on the photograph.

    python spots.py        writes spots.json beside this file, from the lidar's surface and the camera
"""
import json, math, os, sys
import numpy as np
import pyproj

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import camera
from matte import PREPARED
from place import DATA, E0, N0, SEA, TURN, unturned

HERE = os.path.dirname(os.path.abspath(__file__))
# What is wanted: a building by its number (ids.py), a word for it, and whether it is the menu's surface or a crown.
WANTED = [(3174, 'The long white slab', 'menu'), (104, 'Hartford Building', 'crown'), (1857, '555 California Street', 'crown'), (4938, 'One Maritime Plaza', 'crown'),
          (4942, 'Embarcadero Center 1', 'crown'), (5437, 'Embarcadero Center 2', 'crown'), (5448, 'Embarcadero Center 4', 'crown'), (4934, '345 California Center', 'crown'),
          (1864, 'A brown tower of 154 m', 'crown'), (1863, 'A black slab of 92 m', 'crown'), (4935, 'A white block with red bays', 'crown'), (1867, '333 Bush Street', 'crown')]


def main():
    cam = json.load(open(f'{DATA}/camera.json'))['camera']
    geo = pyproj.Transformer.from_crs(26910, 4326, always_xy=True)
    grids = {}
    out = []
    for i, name, what in WANTED:
        for grid in ('fine', 'far'):
            if grid not in grids:
                g = np.load(f'{DATA}/prepared-{grid}-{PREPARED}.npz')
                grids[grid] = {k: g[k] for k in ('top', 'ground', 'ids', 'frame')}
            g = grids[grid]
            rows, cols = np.nonzero(g['ids'] == i)
            if len(rows):
                break
        if not len(rows):
            print('not found:', name); continue
        u0, w0, cell = (float(v) for v in g['frame'])
        top, ground = g['top'][rows, cols], g['ground'][rows, cols]
        roof = float(np.percentile(top, 90))
        # The part of it that is its main roof: within 6 m of that height.
        main = top > roof - 6
        u, w = u0 + (cols[main] + 0.5) * cell, w0 + (rows[main] + 0.5) * cell
        foot = float(np.percentile(ground, 10))
        faces = []

        def walls(along, across):
            """The walls that look back along `across`: for each line of cells along it, where the building begins;
            a wall is a run of lines that begin at one place (within 75 cm), at least 6 m long. A slab whose wings
            stand a little apart, or whose stair tower stands proud, has more than one."""
            lines = np.round((along - along.min()) / cell).astype(np.int64)
            first = np.full(lines.max() + 1, np.inf)
            np.minimum.at(first, lines, across)
            out, begin = [], None
            for k in range(len(first) + 1):
                same = k < len(first) and np.isfinite(first[k]) and begin is not None and abs(first[k] - np.median(first[begin:k])) < 0.75
                if not same:
                    if begin is not None and (k - begin) * cell >= 6:
                        out.append((float(np.median(first[begin:k])) - cell / 2, along.min() + begin * cell - cell / 2, along.min() + (k - 1) * cell + cell / 2))
                    begin = k if k < len(first) and np.isfinite(first[k]) else None
            return out

        # The faces the park sees: those that look along -u (bearing 260.5, to the park and the afternoon sun) and those along -w (bearing 350.5).
        seen = [('west', (at, a), (at, b), 270 - TURN) for at, a, b in walls(w, u)] + [('north', (a, at), (b, at), 360 - TURN) for at, a, b in walls(u, w)]
        for label, a, b, bearing in seen:
            corners = []
            for (pu, pw) in (a, b):
                e, n = unturned(pu, pw)
                corners.append({'cells': [round((float(e) - E0) * 10), round((roof - SEA) * 10), round((N0 - float(n)) * 10)], 'utm': [round(float(e), 2), round(float(n), 2)]})
            mid = np.array([(c['utm'][0], c['utm'][1], roof) for c in corners])
            uv, z = camera.project(cam, mid)
            faces.append({'looks': label, 'bearing': round(bearing % 360, 2), 'wide_m': round(math.hypot(b[0] - a[0], b[1] - a[1]), 1), 'top_corners': corners,
                          'on_photograph': [[round(float(x), 1), round(float(y), 1)] for x, y in uv], 'metres_off': round(float(z.mean()))})
        faces.sort(key=lambda f: -f['wide_m'])
        e, n = unturned(float(u.mean()), float(w.mean()))
        lon, lat = geo.transform(float(e), float(n))
        out.append({'name': name, 'for': what, 'building': i, 'lat_lon': [round(lat, 6), round(lon, 6)], 'roof_m': round(roof, 1), 'foot_m': round(foot, 1), 'roof_cells_y': round((roof - SEA) * 10), 'foot_cells_y': round((foot - SEA) * 10), 'faces': faces})
        print(f"{name[:28]:28} {what:5} {lat:.5f},{lon:.5f} roof {roof:6.1f} foot {foot:5.1f}")
        for f in faces[:4]:
            print(f"      {f['looks']:5} face {f['wide_m']:5.1f} m wide, {f['metres_off']} m off, on the photograph {f['on_photograph']}")
    json.dump({'note': 'Made by spots.py from the lidar and the solved camera. Cells are the engine\'s, 10 cm: x east and z south of the Bay frame\'s corner (500,000 m east, 4,250,000 m north, UTM zone 10N), y up from 1 m over NAVD88\'s zero. A face\'s top corners are the ends of its roof line; its foot is `foot_cells_y`. `on_photograph` is at 2000 px wide.',
               'eye': {'cells': [round((cam['e'] - E0) * 10), round((cam['h'] - SEA) * 10), round((N0 - cam['n']) * 10)], 'bearing': cam['yaw'], 'pitch': cam['pitch'], 'roll': cam['roll']}, 'spots': out}, open(f'{HERE}/spots.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
