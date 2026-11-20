"""The camera, by least squares on the skyline and on pinned points together (#423). fit.py finds the neighbourhood
(it counts the area between two skylines, which has no slope to follow); this finishes it. In turns:

  1. With the camera as it is, find which points of the lidar make our skyline: the top of each column of the
     picture, and points down the wall under it where the skyline drops to a lower roof beside it.
  2. Move the camera (eye, look, roll, focal length, the picture's middle) so that those points fall on the
     photograph's skyline, by how far each is from it (a field of distances, smooth to follow), and so that the
     pins (points known in the lidar and read off the photograph) fall where they were read.

Points of buildings the lidar has wrong (glass towers it saw only the top of) are left out of the skyline.

    python edges.py [--from camera-sky4.json] [--free e,n,h,yaw,pitch,roll,f,cy] [--out camera-edges.json] [--turns 6]
"""
import json, math, os, sys, time
import numpy as np
import cv2
from scipy import ndimage, optimize

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import camera, fit
from place import DATA

TIMES = fit.TIMES
PINS = fit.PINS
W, H = fit.W, fit.H
# How many pixels of the skyline's miss one pixel of a pin's miss counts as much as.
PIN = 8.0


def lines():
    """How far every pixel (at TIMES x 2000) is from the photograph's skyline, for columns the measure counts."""
    sky = cv2.imread(f'{DATA}/sky.png', 0) > 127
    edge = ~sky & ndimage.binary_dilation(sky, structure=np.ones((3, 3), bool))
    edge[:, :fit.LEFT * TIMES] = False
    edge[:, fit.RIGHT * TIMES:] = False
    edge[0, :] = False
    return ndimage.distance_transform_edt(~edge).astype(np.float32)


def makers(cam, pts, ids, skip):
    """The points that make our skyline from this camera: each column's top, and points down the wall where the line drops."""
    scaled = dict(cam, f=cam['f'] * TIMES, cx=cam['cx'] * TIMES, cy=cam['cy'] * TIMES)
    uv, z = camera.project(scaled, pts)
    x = np.floor(uv[:, 0]).astype(np.int64)
    ok = (z > 1) & (x >= fit.LEFT * TIMES) & (x < fit.RIGHT * TIMES) & np.isfinite(uv[:, 1])
    idx = np.flatnonzero(ok)
    order = idx[np.lexsort((uv[idx, 1], x[idx]))]
    first = np.concatenate([[True], x[order][1:] != x[order][:-1]])
    top = order[first]                      # the highest point in each column that has one
    col, row = x[top], uv[top, 1]
    line = np.full(W, float(H), np.float32)
    line[col] = row
    out = [pts[top][~np.isin(ids[top], skip)]]
    # Where the next column's top is much lower, the wall under this one makes the line between: points down it.
    for side in (-1, 1):
        beside = np.roll(line, -side)[col]
        drop = (beside - row) / TIMES       # pixels at 2000 the line falls
        tall = np.flatnonzero((drop > 6) & ~np.isin(ids[top], skip))
        for i in tall:
            p, far = pts[top[i]], z[top[i]]
            metres = drop[i] * far / cam['f']
            n = int(min(40, max(2, drop[i] // 4)))
            down = np.linspace(0.08, 0.92, n) * metres
            out.append(np.stack([np.full(n, p[0]), np.full(n, p[1]), p[2] - down], 1))
    return np.concatenate(out)


def main():
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    cam = json.load(open(f"{DATA}/{arg('--from', 'camera-sky4.json')}"))['camera']
    free = arg('--free', 'e,n,h,yaw,pitch,roll').split(',')
    began = time.time()
    pts, ids = fit.roofs(cam, with_ids=True)
    table = {b.get('name'): b['id'] for b in json.load(open(f'{DATA}/buildings.json')) if b.get('name')}
    skip = [table[n] for n in ('Salesforce Tower', '181 Fremont', '101 California Street', 'Embarcadero Center 2', 'Millennium Tower') if n in table]
    far = lines()
    pins = json.load(open(PINS))['pins']
    pin_xyz, pin_uv = np.array([p['xyz'] for p in pins], float), np.array([p['uv'] for p in pins], float)
    unit = {'e': 1.0, 'n': 1.0, 'h': 1.0, 'yaw': 0.05, 'pitch': 0.05, 'roll': 0.05, 'f': 5.0, 'cx': 5.0, 'cy': 5.0, 'k1': 0.01}

    def miss(x, base, made):
        c = dict(base)
        for k, v in zip(free, x):
            c[k] = base[k] + v * unit[k]
        scaled = dict(c, f=c['f'] * TIMES, cx=c['cx'] * TIMES, cy=c['cy'] * TIMES)
        uv, _ = camera.project(scaled, made)
        d = ndimage.map_coordinates(far, [np.clip(uv[:, 1], 0, H - 1), np.clip(uv[:, 0], 0, W - 1)], order=1, mode='nearest') / TIMES
        # A point that fell off the picture is as far as the picture's edge is.
        off = np.maximum(0, np.maximum(-uv[:, 0], uv[:, 0] - W)) + np.maximum(0, np.maximum(-uv[:, 1], uv[:, 1] - H))
        puv, _ = camera.project(c, pin_xyz)
        # The pins are worth a share of the whole skyline, however many points that has.
        weight = PIN * math.sqrt(len(made) / max(1, len(pins)) / 40)
        prior = [(c['f'] - camera.F_LENS) / 8 * math.sqrt(len(made) / 40), (c['cx'] - camera.W / 2) / 8 * math.sqrt(len(made) / 40)]
        return np.concatenate([d + off / TIMES, ((puv - pin_uv) * weight).ravel(), prior])

    for turn in range(int(arg('--turns', 6))):
        made = makers(cam, pts, ids, skip)
        if len(made) > 6000:
            made = made[np.random.default_rng(turn).choice(len(made), 6000, replace=False)]
        best = optimize.least_squares(miss, np.zeros(len(free)), args=(cam, made), loss='soft_l1', f_scale=2.0, diff_step=1e-3, max_nfev=60)
        for k, v in zip(free, best.x):
            cam[k] = cam[k] + float(v) * unit[k]
        r = miss(np.zeros(len(free)), cam, made)[:len(made)]
        puv, _ = camera.project(cam, pin_xyz)
        print(f'turn {turn}: {len(made)} points, median {np.median(r):.2f} p90 {np.percentile(r, 90):.2f}; pins {np.round(puv - pin_uv, 2).tolist()}; f {cam["f"]:.1f} cx {cam["cx"]:.1f} cy {cam["cy"]:.1f}', flush=True)
    made = makers(cam, pts, ids, skip)
    r = miss(np.zeros(len(free)), cam, made)[:len(made)]
    puv, z = camera.project(cam, pin_xyz)
    said = {'camera': {k: round(float(v), 5) for k, v in cam.items()}, 'free': free, 'f_lens': round(camera.F_LENS, 2),
            'skyline': {'points': int(len(made)), 'median': round(float(np.median(r)), 2), 'p90': round(float(np.percentile(r, 90)), 2), 'rms_within_8': round(float(np.sqrt((r[r < 8] ** 2).mean())), 2), 'within_8': round(float((r < 8).mean()), 3)},
            'pins': [{'name': p['name'], 'far': round(float(d)), 'miss': [round(float(a), 2), round(float(b), 2)]} for p, d, (a, b) in zip(pins, z, puv - pin_uv)],
            'left_out': skip, 'seconds': round(time.time() - began)}
    json.dump(said, open(f"{DATA}/{arg('--out', 'camera-edges.json')}", 'w'), indent=1)
    print(json.dumps(said))


if __name__ == '__main__':
    main()
