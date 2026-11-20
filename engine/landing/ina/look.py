"""The lidar's surface seen through a camera (#423), with nothing of the engine in it: every cell of the surface is
a column, its top and the walls it shows the camera are sampled finer than a pixel and the nearest sample in each
pixel is kept. What comes out is, for every pixel of the photograph's frame, how far off the surface is, where in
the world it is, and which building it belongs to. It is what control points are picked from, and what says how
well the data itself can line up with the photograph before anything is drawn.

    python look.py [--camera camera.json | --start] [--times 2] [--name look]
        writes DATA/<name>.npz (far, xyz, id at times x 2000 wide) and DATA/<name>.png (shaded)
"""
import json, math, os, sys, time
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import camera
from place import DATA, EYE, WEDGE, unturned, TURN

# Where the fine grid hands over to the far one, metres from the eye: there a quarter of a metre is 0.7 pixels.
HANDOVER = 700.0
START = {'e': EYE[0], 'n': EYE[1], 'h': 88.7, 'yaw': 119.79, 'pitch': -1.27, 'roll': 0.0, 'f': 1879.0, 'cx': 1000.0, 'cy': 431.0, 'k1': 0.0}


def surface(name):
    s = np.load(f'{DATA}/surface-{name}.npz')
    u0, w0, cell = s['frame']
    top = s['top'].copy()
    seen = top > -1e8
    # A cell no return fell in stands as its highest neighbour that had one does, or as the ground.
    for _ in range(3):
        p = np.pad(np.where(seen, top, -1e9), 1, constant_values=-1e9)
        best = np.max(np.stack([p[i:i + top.shape[0], j:j + top.shape[1]] for i in range(3) for j in range(3)]), 0)
        take = ~seen & (best > -1e8)
        top[take], seen = best[take], seen | take
    top = np.where(seen, top, s['ground'])
    ids = np.load(f'{DATA}/ids-{name}.npy') if os.path.exists(f'{DATA}/ids-{name}.npy') else np.zeros(top.shape, np.int32)
    return {'u0': float(u0), 'w0': float(w0), 'cell': float(cell), 'top': top, 'ground': s['ground'], 'ids': ids}


def samples(g, cam, lo, hi, times):
    """Sample points of the columns between `lo` and `hi` metres from the eye: (east, north, height, id)."""
    nw, nu = g['top'].shape
    cell = g['cell']
    uu = g['u0'] + (np.arange(nu) + 0.5) * cell
    ww = g['w0'] + (np.arange(nw) + 0.5) * cell
    eu, ew = camera_uw(cam)
    du, dw = uu[None, :] - eu, ww[:, None] - ew
    dist = np.hypot(du, dw)
    # u runs along bearing 90 - TURN and w a quarter turn clockwise of it.
    bearing = (90 - TURN + np.degrees(np.arctan2(dw, du))) % 360
    within = (dist >= lo) & (dist < hi) & (bearing > WEDGE['from']) & (bearing < WEDGE['to'])
    top = g['top']
    px = dist / (cam['f'] * times)  # metres a pixel covers there
    out = []
    # Tops: a cell is sampled as many times each way as it is pixels wide, and once at least.
    rows, cols = np.nonzero(within)
    k = np.clip(np.ceil(cell / px[rows, cols] * 1.4), 1, 12).astype(np.int32)
    for n in np.unique(k):
        m = k == n
        r, c = rows[m], cols[m]
        off = (np.arange(n) + 0.5) / n - 0.5
        ou, ow = np.meshgrid(off, off)
        u = (uu[c][:, None] + ou.ravel()[None, :] * cell).ravel()
        w = (ww[r][:, None] + ow.ravel()[None, :] * cell).ravel()
        h = np.repeat(top[r, c], n * n)
        out.append((u, w, h, np.repeat(g['ids'][r, c], n * n)))
    # Walls: where the neighbour on a side the camera can see is lower, the column's face on that side, from the
    # neighbour's top to its own.
    for dr, dc in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        low = np.full(top.shape, np.nan, np.float32)
        a = (slice(max(0, -dr), nw - max(0, dr)), slice(max(0, -dc), nu - max(0, dc)))
        b = (slice(max(0, dr), nw - max(0, -dr)), slice(max(0, dc), nu - max(0, -dc)))
        low[a] = top[b]
        # The face looks along (dc, dr) in (u, w): the camera sees it when it lies on that side of the cell.
        faces = (-(du * dc + dw * dr)) > 0
        wall = within & faces & (top - low > 0.3)
        rows, cols = np.nonzero(wall)
        if not len(rows):
            continue
        tall = (top - low)[rows, cols]
        step = np.maximum(px[rows, cols] * 0.7, 0.02)
        nv = np.clip(np.ceil(tall / step), 1, 4000).astype(np.int32)
        nh = np.clip(np.ceil(cell / px[rows, cols] * 1.4), 1, 12).astype(np.int32)
        for n in np.unique(nh):
            m = nh == n
            r, c, t, v = rows[m], cols[m], tall[m], nv[m]
            total = int(v.sum())
            which = np.repeat(np.arange(len(r)), v)
            along = np.arange(total) - np.repeat(np.cumsum(v) - v, v)
            h = top[r, c][which] - (along + 0.5) / v[which] * t[which]
            for o in (np.arange(n) + 0.5) / n - 0.5:
                u = uu[c][which] + dc * cell / 2 + (o * cell if dc == 0 else 0)
                w = ww[r][which] + dr * cell / 2 + (o * cell if dr == 0 else 0)
                out.append((u, w, h, g['ids'][r, c][which]))
    u, w, h, i = (np.concatenate(v) for v in zip(*out))
    e, n = unturned(u, w)
    return np.stack([e, n, h], 1), i


def camera_uw(cam):
    from place import turned
    u, w = turned(cam['e'], cam['n'])
    return float(u), float(w)


def render(cam, times=2, grids=None):
    grids = grids or {'fine': surface('fine'), 'far': surface('far')}
    W, H = camera.W * times, camera.H * times
    far = np.full(W * H, np.inf, np.float32)
    xyz = np.zeros((W * H, 3), np.float32)
    ids = np.zeros(W * H, np.int32)
    scaled = dict(cam, f=cam['f'] * times, cx=cam['cx'] * times, cy=cam['cy'] * times)
    for name, lo, hi in (('fine', 0, HANDOVER), ('far', HANDOVER, WEDGE['far'])):
        pts, pid = samples(grids[name], cam, lo, hi, times)
        for a in range(0, len(pts), 8_000_000):
            p, q = pts[a:a + 8_000_000], pid[a:a + 8_000_000]
            uv, z = camera.project(scaled, p)
            x, y = np.floor(uv[:, 0]).astype(np.int64), np.floor(uv[:, 1]).astype(np.int64)
            ok = (z > 1) & (x >= 0) & (x < W) & (y >= 0) & (y < H)
            at, z, p, q = (y * W + x)[ok], z[ok].astype(np.float32), p[ok], q[ok]
            # The nearest sample in each pixel: sorted far to near, so the last one written is the nearest.
            order = np.argsort(-z, kind='stable')
            at, z, p, q = at[order], z[order], p[order], q[order]
            nearer = z < far[at]
            at, z, p, q = at[nearer], z[nearer], p[nearer], q[nearer]
            far[at], ids[at] = z, q
            xyz[at] = (p - np.array([EYE[0], EYE[1], 0])).astype(np.float32)
    return far.reshape(H, W), xyz.reshape(H, W, 3), ids.reshape(H, W)


def shaded(far, xyz, ids):
    """A picture to read: lighter where higher and nearer, a dark line wherever the distance jumps, buildings tinted by their number."""
    sky = ~np.isfinite(far)
    d = np.where(sky, 5000, far)
    jump = np.zeros(far.shape, bool)
    for ax in (0, 1):
        a, b = np.roll(d, 1, ax), d
        jump |= np.abs(a - b) > 0.04 * np.minimum(a, b) + 1.0
    tint = np.stack([((ids * k) % 64) for k in (37, 61, 17)], 2).astype(np.float32) - 32
    grey = np.clip(235 - 60 * np.log10(np.maximum(d, 10) / 10), 60, 235)
    img = np.clip(grey[:, :, None] + tint * (ids[:, :, None] > 0), 0, 255)
    img[jump] = (20, 20, 20)
    img[sky] = (150, 190, 235)
    return img.astype(np.uint8)


def main():
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    cam = dict(START) if '--start' in sys.argv else json.load(open(f"{DATA}/{arg('--camera', 'camera.json')}"))['camera']
    times, name = int(arg('--times', 2)), arg('--name', 'look')
    began = time.time()
    far, xyz, ids = render(cam, times)
    np.savez_compressed(f'{DATA}/{name}.npz', far=far, xyz=xyz, ids=ids, camera=json.dumps(cam), times=times)
    Image.fromarray(shaded(far, xyz, ids)).save(f'{DATA}/{name}.png')
    print(f'{name}: {far.shape[1]} x {far.shape[0]}, sky {np.mean(~np.isfinite(far)):.3f}, {time.time() - began:.0f} s')


if __name__ == '__main__':
    main()
