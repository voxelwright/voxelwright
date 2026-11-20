"""The photograph's camera (#423): where it stood and how it looked, solved by least squares from points whose place
in the world is known (lidar) and whose place on the photograph was read off it.

The photograph is one frame of a 35 mm lens, cut in height (5962 x 2571 of the sensor's 6000 x 4000), so it is a
plain pinhole picture whose middle need not be the frame's middle. What is solved: the eye (east, north, height),
bearing, pitch, roll, the focal length and the picture's middle. Everything is said at a width of 2000 pixels.

    python camera.py solve            from points.json to camera.json, with every point's miss
    python camera.py show             the camera, and what the engine is told to stand there
    python camera.py adopt <file>     a camera fitted by another tool (fit.py, edges.py) becomes camera.json
    python camera.py three            the eye from three pins alone, for fit.py --at
"""
import json, math, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from place import DATA, E0, N0, SEA

W, H = 2000, 862
# How far the ground falls away from a level line, less how far the air bends the look back: metres at a metre squared.
BEND = (1 - 0.13) / (2 * 6_371_000.0)
# What the lens and sensor say the focal length is at this width: 35 mm on a sensor 35.77 mm and 6000 pixels wide.
F_LENS = 35.0 / 35.77 * 6000 * (W / 5962.0)

NAMES = ['e', 'n', 'h', 'yaw', 'pitch', 'roll', 'f', 'cx', 'cy', 'k1']


def axes(yaw, pitch, roll):
    """The camera's right, up and forward in (east, north, up), from a compass bearing, a pitch up and a roll (clockwise as the camera sees), in degrees."""
    y, p, r = (math.radians(v) for v in (yaw, pitch, roll))
    fwd = np.array([math.sin(y) * math.cos(p), math.cos(y) * math.cos(p), math.sin(p)])
    right = np.array([math.cos(y), -math.sin(y), 0.0])
    up = np.cross(right, fwd)
    return right * math.cos(r) + up * math.sin(r), up * math.cos(r) - right * math.sin(r), fwd


def project(cam, pts):
    """Where points (east, north, height over NAVD88's zero; n x 3) fall on the photograph, and how far off they are along the look."""
    c = dict(zip(NAMES, cam)) if not isinstance(cam, dict) else cam
    right, up, fwd = axes(c['yaw'], c['pitch'], c['roll'])
    d = np.asarray(pts, float) - np.array([c['e'], c['n'], c['h']])
    d[:, 2] -= BEND * (d[:, 0] ** 2 + d[:, 1] ** 2)
    z = d @ fwd
    zs = np.where(z > 1e-6, z, np.nan)
    x, y = (d @ right) / zs, (d @ up) / zs
    k = 1 + c.get('k1', 0.0) * (x * x + y * y)
    return np.stack([c['cx'] + c['f'] * x * k, c['cy'] - c['f'] * y * k], 1), z


def solve(points, start, free, prior=None, rounds=60):
    """Least squares over the `free` names from `start`. `prior` holds a name near a value: {name: (value, pixels of miss a unit off costs)}."""
    cam = dict(start)
    xyz = np.array([p['xyz'] for p in points], float)
    uv = np.array([p['uv'] for p in points], float)
    w = np.array([p.get('weight', 1.0) for p in points], float)[:, None]
    prior = prior or {}

    def miss(c):
        r = ((project(c, xyz)[0] - uv) * w).ravel()
        extra = [(c[k] - v) * s for k, (v, s) in prior.items()]
        return np.concatenate([r, extra])

    lam = 1e-3
    r = miss(cam)
    for _ in range(rounds):
        J = np.zeros((len(r), len(free)))
        for j, k in enumerate(free):
            step = 1e-4 * max(1.0, abs(cam[k])) if k in ('e', 'n', 'h', 'f', 'cx', 'cy') else 1e-5
            c2 = dict(cam); c2[k] += step
            J[:, j] = (miss(c2) - r) / step
        A = J.T @ J
        while True:
            delta = np.linalg.solve(A + lam * np.diag(np.diag(A) + 1e-12), -J.T @ r)
            c2 = dict(cam)
            for j, k in enumerate(free):
                c2[k] += delta[j]
            r2 = miss(c2)
            if r2 @ r2 < r @ r or lam > 1e8:
                break
            lam *= 10
        if lam > 1e8:
            break
        better = (r @ r - r2 @ r2) / max(r @ r, 1e-12)
        cam, r, lam = c2, r2, lam / 5
        if better < 1e-10:
            break
    return cam


def engine(cam):
    """What the engine's page is told so that it stands as the camera does: the eye in its cells, the look, and the
    taller picture whose middle is the camera's middle, with where the photograph's frame lies in it."""
    left, top = max(cam['cx'], W - cam['cx']), max(cam['cy'], H - cam['cy'])
    wide, tall = 2 * math.ceil(left), 2 * math.ceil(top)
    return {
        'at': [round(cam['e'] - E0, 2), round(cam['h'] - SEA, 2), round(N0 - cam['n'], 2)],
        'look': [round(cam['yaw'], 4), round(cam['pitch'], 4)], 'roll': round(cam['roll'], 4),
        'fov': round(2 * math.degrees(math.atan(tall / 2 / cam['f'])), 4),
        'size': [wide, tall], 'crop': [round(wide / 2 - cam['cx'], 2), round(tall / 2 - cam['cy'], 2), W, H],
    }


def load():
    return json.load(open(f'{DATA}/camera.json'))['camera']


def main():
    what = sys.argv[1] if len(sys.argv) > 1 else 'show'
    if what == 'show':
        cam = load()
        print(json.dumps(cam, indent=1)); print(json.dumps(engine(cam)))
        return
    if what == 'three':
        # Where the eye stood, from three pins alone (pins.json) and the lens as it is named: the angles between the
        # three as the photograph has them hold whatever way the camera was turned, so only the eye is sought.
        # Tried from many places round the geotag; each that fits is printed in the streets' frame (u, w) and height.
        from scipy import optimize
        from place import turned, unturned
        pins = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pins.json')))['pins'][:3]
        xyz, uv = np.array([p['xyz'] for p in pins], float), np.array([p['uv'] for p in pins], float)
        rays = np.stack([uv[:, 0] - W / 2, H / 2 - uv[:, 1], np.full(3, F_LENS)], 1)
        rays /= np.linalg.norm(rays, axis=1)[:, None]
        pairs = [(0, 1), (0, 2), (1, 2)]
        want = np.array([math.acos(rays[i] @ rays[j]) for i, j in pairs])

        def miss(x):
            d = xyz - np.array(x)
            d[:, 2] -= BEND * (d[:, 0] ** 2 + d[:, 1] ** 2)
            d /= np.linalg.norm(d, axis=1)[:, None]
            return np.array([math.acos(np.clip(d[i] @ d[j], -1, 1)) for i, j in pairs]) - want
        found = []
        for du in range(-30, 70, 10):
            for dw in range(-60, 40, 10):
                for h in (80, 88, 96):
                    e, n = unturned(du, dw)
                    r = optimize.least_squares(miss, [float(e), float(n), h], xtol=1e-12, ftol=1e-12)
                    if np.abs(r.fun).max() < 1e-6:
                        u, w = turned(r.x[0], r.x[1])
                        key = (round(float(u), 1), round(float(w), 1), round(float(r.x[2]), 1))
                        if key not in found:
                            found.append(key)
        for u, w, h in found:
            print(f'{u},{w},{h}')
        return
    if what == 'adopt':
        # A camera another tool fitted (fit.py, edges.py) becomes the camera: `adopt camera-sky.json`.
        said = json.load(open(f'{DATA}/{sys.argv[2]}'))
        said['engine'] = engine(said['camera'])
        said['from'] = sys.argv[2]
        json.dump(said, open(f'{DATA}/camera.json', 'w'), indent=1)
        # The solved camera is the lane's record: a copy is kept in the repo beside the pins and the traced lines.
        json.dump(said, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'camera.json'), 'w'), indent=1)
        print(said['camera']); print(said['engine'])
        return
    pts = json.load(open(f'{DATA}/points.json'))
    used = [p for p in pts['points'] if not p.get('held')]
    start = dict(pts['start'])
    start.setdefault('k1', 0.0)
    # In three steps: the look alone from where the geotag stands, then the eye too, then the lens's middle; the
    # focal length is held near the lens's own (a pixel of miss for every 4 pixels it strays).
    prior = {'f': (F_LENS, 0.25)}
    cam = solve(used, start, ['yaw', 'pitch', 'roll'], prior)
    cam = solve(used, cam, ['yaw', 'pitch', 'roll', 'e', 'n', 'h'], prior)
    cam = solve(used, cam, ['yaw', 'pitch', 'roll', 'e', 'n', 'h', 'f', 'cy'], prior)
    free = ['yaw', 'pitch', 'roll', 'e', 'n', 'h', 'f', 'cx', 'cy'] + (['k1'] if '--k1' in sys.argv else [])
    cam = solve(used, cam, free, prior)
    uv, z = project(cam, np.array([p['xyz'] for p in pts['points']], float))
    out = []
    for p, (u, v), far in zip(pts['points'], uv, z):
        out.append({'name': p['name'], 'far': round(float(far)), 'miss': [round(float(u - p['uv'][0]), 2), round(float(v - p['uv'][1]), 2)], 'held': bool(p.get('held'))})
    d = np.array([math.hypot(*o['miss']) for o in out if not o['held']])
    said = {'camera': {k: round(float(v), 5) for k, v in cam.items()}, 'f_lens': round(F_LENS, 1), 'points': len(d), 'rms': round(float(np.sqrt((d ** 2).mean())), 2), 'median': round(float(np.median(d)), 2), 'p90': round(float(np.percentile(d, 90)), 2), 'worst': round(float(d.max()), 2), 'misses': out, 'engine': engine(cam)}
    json.dump(said, open(f'{DATA}/camera.json', 'w'), indent=1)
    for o in sorted(out, key=lambda o: -math.hypot(*o['miss'])):
        print(f"{o['name'][:44]:44} {o['far']:5d} m  {o['miss'][0]:7.2f} {o['miss'][1]:7.2f}{'  (held out)' if o['held'] else ''}")
    print({k: said[k] for k in ('points', 'rms', 'median', 'p90', 'worst')})
    print(said['camera']); print('lens f', said['f_lens'], 'hfov', round(2 * math.degrees(math.atan(W / 2 / cam['f'])), 2)); print(said['engine'])


if __name__ == '__main__':
    main()
