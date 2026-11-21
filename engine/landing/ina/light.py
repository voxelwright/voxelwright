"""How the photograph was lit and exposed, against the engine's own day (#423).

The engine's day lights a wall in shade with about a sixth of what a wall in the sun gets; the photograph was
taken under thin high cloud, where a white wall in shade is nearly as bright as one in the sun, and the camera
exposed for it. Fitting each building's colour cannot make that up: a shaded white wall was given the palest colour
there is and still came out grey. So a place says its own light (the page draws its faces with it, matte.ts):
  fill   how many times the engine's light from the sky and the ground a face gets
  gain   how many times brighter the whole is exposed

Both are read off the picture, with no building's colour needing to be known: a building's wall that faces the sun
and its wall that faces the park are one paint, so how much brighter the first is than the second, in the
photograph and in ours, says how strong the fill is against the sun. Then the gain is what lets the palest walls
be as pale as the photograph has them, with a paint no paler than white paint is.

The sky's two colours are fitted here too, a shot at a time (`sky`), and the place's air after them (`?haze=`,
march.ts): the air takes the sky's colour, and the darkest things 1 to 2 km off are the air's own colour.

    python light.py <shot>        the fill and the gain a shot says; written to light.json beside this file if it has
                                  none yet, or with `--write` (its sky is kept)

The fill and the gain in light.json (3.44, 1.23) were read from a shot of the place under the engine's own day
(fill 1, gain 1). Read again from a shot already lit that way, the fill comes out near (4.1) and the gain does not
(2.3): why was not found, and that reading was not taken. What says 1.23 is near is the picture: under it the land
is 0.4 darker than the photograph's in CIELAB lightness, and 166 walls of 10,188 are at the palest paint there is.
    python light.py sky <shot>    one correction of the sky from a shot taken with `&clouds=0` (`sky --start`: from the engine's day)
"""
import json, math, os, sys
import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from place import DATA, LANE
from overlay import H, W, photo

HERE = os.path.dirname(os.path.abspath(__file__))
PALE = 0.85  # how much light the palest paint sends back


def shown(light):
    """What the page shows for a light: its tone curve (march.ts `tone`), then the place's grade (glow.ts, a quarter of an S)."""
    x = np.asarray(light, np.float64) * 0.43
    y = np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1) ** 0.4545
    return y + 0.25 * (y * y * (3 - 2 * y) - y)


LIGHTS = np.geomspace(1e-4, 12, 4000)
SHOWN = shown(LIGHTS)


def light_of(value):
    """The light that shows as a value (0 to 1): `shown` the other way."""
    return np.interp(np.clip(value, SHOWN[0], 0.985), SHOWN, LIGHTS)


def sky(name):
    """One correction of the place's sky from a shot of it (taken with `&clouds=0`): its two colours (march.ts
    `skyBase`: the horizon's, mixed towards the overhead one by how high a look goes, to the power 0.42) are moved
    by how the shot's sky differs from the photograph's where that is clear (its left quarter), low and high.

    By shooting and correcting, not by a formula: the page's last pass adds a glow to whatever is brighter than
    0.8 of full, so a sky as blue as the photograph's is past where the tone curve can be turned round (the sky
    worked out that way came out white). Six turns from the engine's own day brought it from 20 to 6 (CIELAB).
    `--start` begins again from the engine's day."""
    cam = json.load(open(f'{DATA}/camera.json'))['camera']
    said = json.load(open(f'{HERE}/light.json'))
    if name == '--start':
        said['sky'] = {'zenith': [0.07, 0.22, 0.62], 'horizon': [0.5, 0.66, 0.88]}
    else:
        shot = json.load(open(f'{LANE}/shots/{name}.json'))
        move = np.float32([[1, 0, -shot['crop'][0]], [0, 1, -shot['crop'][1]]])
        o = cv2.warpAffine(cv2.imread(f'{LANE}/shots/{name}-full.png'), move, (W, H))[:, :, ::-1].astype(np.float64) / 255
        p = photo()[:, :, ::-1].astype(np.float64) / 255
        clear = cv2.resize(cv2.imread(f'{DATA}/sky.png', 0), (W, H), interpolation=cv2.INTER_AREA) > 127
        clear[:, 500:] = False
        horizon, zenith = np.array(said['sky']['horizon']), np.array(said['sky']['zenith'])
        want = []
        for y0, y1 in ((10, 50), (360, 400)):
            band = np.zeros(clear.shape, bool)
            band[y0:y1] = True
            up = math.sin(math.atan((cam['cy'] - (y0 + y1) / 2) / cam['f']) + math.radians(cam['pitch']))
            t = max(up, 0.0) ** 0.42
            mp, mo = np.median(p[band & clear], 0), np.median(o[band & clear], 0)
            print(f'rows {y0} to {y1}: the photograph {(mp * 255).round(0)}, ours {(mo * 255).round(0)}')
            # Moved by the two as shown, squared and a little more, and by three fifths of that: the glow makes the page answer steeply.
            want.append((t, np.maximum(horizon + t * (zenith - horizon), 0.01) * (np.maximum(mp, 0.02) / np.maximum(mo, 0.02)) ** (2.2 * 0.6)))
        (a, high), (b, low) = want
        over = (high - low) / (a - b)
        horizon = np.clip(low - b * over, 0, 4)
        said['sky'] = {'zenith': [round(float(v), 3) for v in np.clip(horizon + over, 0, 4)], 'horizon': [round(float(v), 3) for v in horizon]}
    print(said['sky'])
    json.dump(said, open(f'{HERE}/light.json', 'w'), indent=1)
    # The places as they are baked are told at once, so that the next shot shows it.
    for place in ('ina', 'ina-all', 'ina-painted'):
        path = f'{LANE}/home/.village/engine/place/{place}/index.json'
        if os.path.exists(path):
            index = json.load(open(path))
            index['sky'] = said['sky']
            json.dump(index, open(path, 'w'))


def main():
    name = sys.argv[1]
    shot = json.load(open(f'{LANE}/shots/{name}.json'))
    fw, fh = shot['size']
    move = np.float32([[1, 0, -shot['crop'][0]], [0, 1, -shot['crop'][1]]])
    ours = cv2.warpAffine(cv2.imread(f'{LANE}/shots/{name}-full.png'), move, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    raw = cv2.warpAffine(np.fromfile(f'{LANE}/shots/{name}-ids.rgba', np.uint8).reshape(fh, fw, 4), move, (W, H), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    ids = raw[:, :, 0].astype(np.int64) | (raw[:, :, 1].astype(np.int64) << 8) | (raw[:, :, 2].astype(np.int64) << 16)
    way = raw[:, :, 3].astype(np.int64)
    same = np.ones((H, W), bool)
    for ax in (0, 1):
        for d in (1, -1):
            same &= np.roll(ids, d, ax) == ids
    grey = lambda im: im[:, :, 1].astype(np.float64) / 255
    p, o = grey(photo()), grey(ours)
    table = {b['id']: b for b in json.load(open(f'{DATA}/buildings.json'))}
    colours = json.load(open(f'{DATA}/colours-photo.json'))['colours']
    now = json.load(open(f'{HERE}/light.json'))['light'] if os.path.exists(f'{HERE}/light.json') else {'fill': 1.0, 'gain': 1.0}
    f0, g0 = now['fill'], now['gain']
    paint = lambda c: (((c >> 8) & 255) / 255) ** 2.2
    rows = []
    use = same & (ids > 0) & (ids < 900000)
    for i in np.unique(ids[use]):
        b = table.get(int(i))
        if not b or (b.get('far') or 9999) > 900 or str(int(i)) not in colours:
            continue
        # The wall that faces the sun looks along -u (the page's way 2); the wall that faces the park, in shade, along -w (way 4).
        sun, shade = use & (ids == i) & (way == 2), use & (ids == i) & (way == 4)
        if sun.sum() < 60 or shade.sum() < 60:
            continue
        c = colours[str(int(i))]
        # Light a unit of paint is shown by, in ours; and what the photograph's values would need.
        lo_sun, lo_shade = light_of(np.median(o[sun])) / max(paint(c[1]), 0.02), light_of(np.median(o[shade])) / max(paint(c[3]), 0.02)
        lp_sun, lp_shade = light_of(np.median(p[sun])), light_of(np.median(p[shade]))
        sky = lo_shade / (g0 * f0)
        direct = lo_sun / g0 - f0 * sky
        ratio = lp_sun / lp_shade
        if ratio > 1.05 and direct > 0:
            rows.append((int(i), direct, sky, ratio, lp_sun, lp_shade))
    r = np.array(rows)
    fill = float(np.median(r[:, 1] / (r[:, 2] * (r[:, 3] - 1))))
    # The gain that lets a wall of the palest paint be as bright as the photograph has it: nine walls in ten.
    need = np.maximum(r[:, 4] / (PALE * (r[:, 1] + fill * r[:, 2])), r[:, 5] / (PALE * fill * r[:, 2]))
    gain = float(np.percentile(need, 90))
    print(f'{name}: {len(r)} buildings with a wall in the sun and a wall in shade; in the photograph the first is {np.median(r[:, 3]):.2f} times the second (in ours, as lit now, {np.median((r[:, 1] + f0 * r[:, 2]) / (f0 * r[:, 2])):.2f})')
    print(f'fill {fill:.2f} (was {f0}), gain {gain:.2f} (was {g0})')
    said = json.load(open(f'{HERE}/light.json')) if os.path.exists(f'{HERE}/light.json') else {}
    if 'light' in said and '--write' not in sys.argv:
        print('light.json has a light already and is left as it is (`--write` to take this one)')
        return
    said.update({'note': 'How the photograph was lit and exposed against the engine\'s day, and its sky (light.py): the light from the sky and the ground on a face is `fill` times the engine\'s, and the whole is `gain` times brighter; the sky overhead and at the horizon, as light before the tone curve. Read off the photograph.',
                 'light': {'fill': round(fill, 2), 'gain': round(gain, 2)}, 'from': name, 'buildings': len(r)})
    json.dump(said, open(f'{HERE}/light.json', 'w'), indent=1)


if __name__ == '__main__':
    if sys.argv[1] == 'sky':
        sky(sys.argv[2])
    else:
        main()
