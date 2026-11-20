"""Fits the camera to the photograph's skyline (#423). The lidar's skyline through a camera is the highest
projected roof in every column of the picture; the photograph's is where its sky ends (sky.py). The fit moves the
camera until the two lie on each other: what is counted is the area between them, each column's gap held to a most
so that a tower the lidar does not have costs a fixed sum and does not pull the rest.

Only roofs that can reach the skyline are projected (those that stand over a line two degrees under the eye's
level), so one look takes a fraction of a second and the eye itself can be let go.

    python fit.py [--from camera.json | --start] [--free yaw,pitch,roll,f,cy] [--out camera-sky.json]
"""
import json, math, os, sys, time
import numpy as np
from scipy import ndimage, optimize

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import camera
from place import DATA, EYE, TURN, WEDGE, turned, unturned
from look import HANDOVER, START

TIMES = 2
# Points known in the lidar and read off the photograph: the lane's record, beside the traced outlines.
PINS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pins.json')
W, H = camera.W * TIMES, camera.H * TIMES
# Columns left of this (at 2000) hold the bay, the far hills and the bridge, none of which the lidar has.
LEFT = 330
# Columns right of this hold the wall and the plant beside the photographer.
RIGHT = 1940
MOST = 60.0
# How much a pixel of a pin's miss counts against a pixel of the skyline's mean gap: a pin is read to a pixel, the
# skyline's gap is mostly towers the lidar has too thin.
PIN = 3.0


def despiked(top):
    """A cell three metres clear of all eight round it is a bird or a stray return."""
    p = np.pad(top, 1, mode='edge')
    around = np.max(np.stack([p[i:i + top.shape[0], j:j + top.shape[1]] for i in range(3) for j in range(3) if (i, j) != (1, 1)]), axis=0)
    return np.where(top > around + 3.0, around, top)


def roofs(cam, with_ids=False):
    """Every point of the surface that could stand on the skyline from near where the camera is: (east, north, height)."""
    out, whose = [], []
    eye_h = cam['h']
    eu, ew = (float(v) for v in turned(cam['e'], cam['n']))
    for name, lo, hi in (('fine', 12.0, HANDOVER), ('far', HANDOVER, WEDGE['far'])):
        s = np.load(f'{DATA}/surface-{name}.npz')
        u0, w0, cell = (float(v) for v in s['frame'])
        top = s['top']
        top = despiked(np.where(top > -1e8, top, s['ground']))
        # Leaves are left out: the lidar's trees are two summers older than the photograph's, and the fit's first
        # eye stood inside one. Where a pulse came back more than once and no building stands, the ground counts.
        leafy = (s['multi'].astype(np.float32) / np.maximum(s['count'], 1) > 0.3) & (top - s['ground'] > 2.0) & (np.load(f'{DATA}/ids-{name}.npy') == 0)
        top = np.where(ndimage.binary_dilation(leafy, iterations=2) & (np.load(f'{DATA}/ids-{name}.npy') == 0), s['ground'], top)
        nw, nu = top.shape
        uu, ww = u0 + (np.arange(nu) + 0.5) * cell, w0 + (np.arange(nw) + 0.5) * cell
        du, dw = uu[None, :] - eu, ww[:, None] - ew
        dist = np.hypot(du, dw)
        bearing = (90 - TURN + np.degrees(np.arctan2(dw, du))) % 360
        keep = (dist >= lo) & (dist < hi) & (bearing > WEDGE['from']) & (bearing < WEDGE['to']) & (top - (eye_h - 8) > -dist * math.tan(math.radians(2.0)))
        # Only a roof's edge or ridge can stand on a skyline: a cell with a lower one beside it.
        p = np.pad(top, 1, mode='edge')
        lowest = np.min(np.stack([p[i:i + nw, j:j + nu] for i in range(3) for j in range(3) if (i, j) != (1, 1)]), axis=0)
        keep &= top > lowest + 0.15
        # The bridge is in the lidar as a tent under its cables: left out, with the water.
        keep &= ~((dist > 2300) & (bearing < 108))
        r, c = np.nonzero(keep)
        # A cell nearer than its own width in pixels is given more than one point across.
        k = np.clip(np.ceil(cell * 1970 * TIMES / dist[r, c] * 1.2), 1, 8).astype(np.int32)
        for n in np.unique(k):
            m = k == n
            off = (np.arange(n) + 0.5) / n - 0.5
            ou, ow = np.meshgrid(off, off)
            u = (uu[c[m]][:, None] + ou.ravel()[None, :] * cell).ravel()
            w = (ww[r[m]][:, None] + ow.ravel()[None, :] * cell).ravel()
            e, nn = unturned(u, w)
            out.append(np.stack([e, nn, np.repeat(top[r[m], c[m]], n * n)], 1))
            if with_ids:
                whose.append(np.repeat(np.load(f'{DATA}/ids-{name}.npy', mmap_mode='r')[r[m], c[m]], n * n))
    return (np.concatenate(out), np.concatenate(whose)) if with_ids else np.concatenate(out)


def skyline(cam, pts):
    """For each column at TIMES x 2000: the row of the highest projected roof, H where there is none."""
    scaled = dict(cam, f=cam['f'] * TIMES, cx=cam['cx'] * TIMES, cy=cam['cy'] * TIMES)
    uv, z = camera.project(scaled, pts)
    x = np.floor(uv[:, 0]).astype(np.int64)
    ok = (z > 1) & (x >= 0) & (x < W) & np.isfinite(uv[:, 1])
    line = np.full(W, float(H), np.float32)
    np.minimum.at(line, x[ok], np.clip(uv[ok, 1], 0, H).astype(np.float32))
    # A column no point fell in between two that have one takes the lower of its neighbours: far roofs are a point a pixel.
    gap = line >= H
    left, right = np.roll(line, 1), np.roll(line, -1)
    line[gap] = np.minimum(np.maximum(left, right), H)[gap]
    return line


def gap(cam, pts, photo):
    line = skyline(cam, pts)
    d = np.minimum(np.abs(line - photo), MOST * TIMES)[LEFT * TIMES:RIGHT * TIMES]
    return float(d.mean()) / TIMES


def main():
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    cam = dict(START, f=camera.F_LENS) if '--start' in sys.argv else json.load(open(f"{DATA}/{arg('--from', 'camera-sky.json')}"))['camera']
    if '--at' in sys.argv:
        # Where the eye starts, in the turned frame's metres and its height: `--at u,w,h`.
        u, w, h = (float(v) for v in arg('--at', '').split(','))
        e, n = unturned(u, w)
        cam.update(e=float(e), n=float(n), h=h)
    free = arg('--free', 'yaw,pitch,roll').split(',')
    photo = np.load(f'{DATA}/skyline.npy').astype(np.float32)
    began = time.time()
    pts = roofs(cam)
    # Of those, only what stands on the skyline or within forty pixels under it from where the fit starts can come to
    # stand on it while the camera moves a little: a twentieth of them, and a look takes a twentieth of the time.
    first = skyline(cam, pts)
    scaled = dict(cam, f=cam['f'] * TIMES, cx=cam['cx'] * TIMES, cy=cam['cy'] * TIMES)
    uv, z = camera.project(scaled, pts)
    x = np.clip(np.floor(uv[:, 0]).astype(np.int64), 0, W - 1)
    pts = pts[(z > 1) & (uv[:, 1] < first[x] + 40 * TIMES)]
    print(len(pts), 'points', round(time.time() - began, 1), 's; gap before', round(gap(cam, pts, photo), 3))
    scale = {'e': 2.0, 'n': 2.0, 'h': 1.0, 'yaw': 0.2, 'pitch': 0.2, 'roll': 0.1, 'f': 15.0, 'cx': 15.0, 'cy': 15.0, 'k1': 0.01}
    x0 = np.zeros(len(free))

    # Pins: points near the eye whose place in the world and on the photograph are both known (pins.json: the
    # crosses of the church below, read off the photograph and found as peaks in the lidar). The skyline is far off
    # and says little of where the eye stood; a tower 140 m away moves 14 pixels for every metre the eye does.
    pins = json.load(open(PINS))['pins'] if '--nopins' not in sys.argv else []
    pin_xyz, pin_uv = np.array([p['xyz'] for p in pins], float).reshape(-1, 3), np.array([p['uv'] for p in pins], float).reshape(-1, 2)

    def pinned(c):
        if not len(pins):
            return 0.0
        uv, _ = camera.project(c, pin_xyz)
        return float(np.hypot(*(uv - pin_uv).T).mean())

    def cost(x):
        c = dict(cam)
        for k, v in zip(free, x):
            c[k] = cam[k] + v * scale[k]
        # The focal length is held near the lens's own: a twentieth of a pixel of gap for every ten pixels it strays.
        return gap(c, pts, photo) + PIN * pinned(c) + 0.05 * abs(c['f'] - camera.F_LENS) / 10
    best = optimize.minimize(cost, x0, method='Powell', options={'xtol': 1e-3, 'ftol': 1e-5, 'maxfev': int(arg('--evals', 900))})
    for k, v in zip(free, best.x):
        cam[k] = cam[k] + float(v) * scale[k]
    g = gap(cam, pts, photo)
    line = skyline(cam, pts)
    d = (line - photo)[LEFT * TIMES:RIGHT * TIMES] / TIMES
    near = np.abs(d) < MOST
    pin_miss = [[round(float(a), 2), round(float(b), 2)] for a, b in (camera.project(cam, pin_xyz)[0] - pin_uv)] if len(pins) else []
    said = {'camera': {k: round(float(v), 5) for k, v in cam.items()}, 'gap': round(g, 3), 'pins': [{'name': p['name'], 'miss': m} for p, m in zip(pins, pin_miss)], 'free': free, 'columns_within_most': round(float(near.mean()), 3), 'median_abs': round(float(np.median(np.abs(d[near]))), 2), 'p90_abs': round(float(np.percentile(np.abs(d[near]), 90)), 2), 'evals': int(best.nfev), 'seconds': round(time.time() - began)}
    json.dump(said, open(f"{DATA}/{arg('--out', 'camera-sky.json')}", 'w'), indent=1)
    np.save(f'{DATA}/skyline-model.npy', line)
    print(json.dumps(said))


if __name__ == '__main__':
    main()
