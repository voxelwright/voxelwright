"""Lays what the engine drew over the photograph and says how well they line up (#423).

Takes one shot (shoot.mjs: the page's picture and each pixel's building), cuts the photograph's frame out of it,
and measures, at the photograph's stated width of 2000 pixels:

  skyline     the line where sky ends, the photograph's against ours, both ways: for every pixel of one line how
              far the nearest pixel of the other is. Overall, and for each building that stands on our skyline:
              ours-to-photo over the pixels of our line that are that building's, photo-to-ours over the columns
              where that building is the top of our picture.
  outlines    for buildings that stand against other buildings, not sky: a line traced once on the photograph
              (outlines.json), against where that building's pixels in ours begin from above and from each side,
              both ways.
  edges       every edge of a building in ours (where the building or the way its face looks changes) to the
              nearest edge found in the photograph: one way only, and the photograph has edges everywhere, so it
              flatters. Shown, not a target.
  colour      how far apart the two pictures are in colour (CIELAB), near, middle and far, and in the sky.

A distance is never counted over MOST pixels: a building that is not there costs MOST, not nothing.
`--shift 3,0` moves ours before measuring: the numbers must follow, or they measure nothing.

    python overlay.py <name> [--shift dx,dy] [--label "what changed"]
        writes the overlay's files to the place folder `ina-overlay` (the page landing/ina/overlay.html reads them)
        and <LANE>/overlay-<name>-50.jpg, the two at half strength each, for the thread
"""
import json, os, sys, time
import numpy as np
import cv2
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from place import DATA, LANE, REF

W, H = 2000, 862
MOST = 30.0
OUT = f'{LANE}/home/.village/engine/place/ina-overlay'
# Columns the measure leaves out: the photographer's own corner (a wall and a plant no data has).
RIGHT = 1940
TARGET = {'median': 2.0, 'p90': 4.0}


def photo():
    path = f'{OUT}/photo.jpg'
    if not os.path.exists(path):
        im = cv2.imread(f'{REF}/ina-full.jpg')
        cv2.imwrite(path, cv2.resize(im, (W, H), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 90])
    return cv2.imread(path)


def boundary(mask):
    """The pixels of a mask that touch a pixel outside it."""
    inner = ndimage.binary_erosion(mask, structure=np.ones((3, 3), bool), border_value=1)
    return mask & ~inner


def stats(d):
    d = np.minimum(np.asarray(d, np.float32), MOST)
    if not len(d):
        return None
    return {'median': round(float(np.median(d)), 2), 'p90': round(float(np.percentile(d, 90)), 2), 'mean': round(float(d.mean()), 2), 'n': int(len(d))}


def both(a, b):
    """Two sets of distances as one figure, each way counted alike however many pixels it has."""
    if a is None or b is None or not len(a) or not len(b):
        return None
    a, b = np.minimum(a, MOST), np.minimum(b, MOST)
    med = (np.median(a) + np.median(b)) / 2
    p90 = max(np.percentile(a, 90), np.percentile(b, 90))
    return {'median': round(float(med), 2), 'p90': round(float(p90), 2), 'ours_to_photo': stats(a), 'photo_to_ours': stats(b), 'ok': bool(med <= TARGET['median'] and p90 <= TARGET['p90'])}


def main():
    name = sys.argv[1]
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    os.makedirs(OUT, exist_ok=True)
    shot = json.load(open(f'{LANE}/shots/{name}.json'))
    fw, fh = shot['size']
    ox, oy = shot['crop'][0], shot['crop'][1]
    dx, dy = (float(v) for v in arg('--shift', '0,0').split(','))
    move = np.float32([[1, 0, -ox + dx], [0, 1, -oy + dy]])
    full = cv2.imread(f'{LANE}/shots/{name}-full.png')
    ours = cv2.warpAffine(full, move, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    raw = np.fromfile(f'{LANE}/shots/{name}-ids.rgba', np.uint8).reshape(fh, fw, 4)
    raw = cv2.warpAffine(raw, move, (W, H), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    ids = raw[:, :, 0].astype(np.int32) | (raw[:, :, 1].astype(np.int32) << 8) | (raw[:, :, 2].astype(np.int32) << 16)
    way = raw[:, :, 3]
    ph = photo()
    table = {b['id']: b for b in json.load(open(f'{DATA}/buildings.json'))}
    # Landmarks the place takes from the core's rules carry numbers past every building's (heroes.mjs).
    table[900004] = {'name': 'Bay Bridge, western span', 'far': 3100}

    # ── The skylines.
    sky_p = cv2.resize(cv2.imread(f'{DATA}/sky.png', 0), (W, H), interpolation=cv2.INTER_AREA) > 127
    sky_o = way == 0
    # Ours is sky only where it reaches down from the top without a break, as the photograph's is.
    lab, _ = ndimage.label(sky_o)
    sky_o = np.isin(lab, np.unique(lab[0][lab[0] > 0]))
    cols = np.zeros((H, W), bool)
    cols[:, :RIGHT] = True
    line_p, line_o = boundary(~sky_p) & cols, boundary(~sky_o) & cols
    # The frame's own edge is no skyline.
    for line in (line_p, line_o):
        line[0, :] = line[-1, :] = False
        line[:, 0] = line[:, -1] = False
    far_p = ndimage.distance_transform_edt(~line_p)
    far_o = ndimage.distance_transform_edt(~line_o)
    # Where the photograph's line is the far hills and the bridge over the water, which this place does not hold yet.
    held = np.zeros((H, W), bool)
    held[:, 330:] = True
    out = {'name': name, 'label': arg('--label', ''), 'when': time.strftime('%Y-%m-%d %H:%M'), 'shift': [dx, dy], 'most': MOST, 'target': TARGET, 'url': shot.get('url'), 'faces': shot.get('faces')}
    out['skyline'] = both(far_p[line_o & held], far_o[line_p & held])

    # ── Each building on our skyline: the pixels of our line that are its own, and the photograph's line over the columns where it tops our picture.
    top_row = np.argmax(~sky_o, axis=0)
    top_id = ids[top_row, np.arange(W)]
    buildings = []
    owner = np.where(line_o, ids, 0)
    for b in np.unique(owner[owner > 0]):
        mine = owner == b
        if mine.sum() < 25:
            continue
        span = np.zeros((H, W), bool)
        span[:, top_id == b] = True
        r = both(far_p[mine & held], far_o[line_p & span & held])
        if not r:
            continue
        ys, xs = np.nonzero(mine)
        info = table.get(int(b), {})
        buildings.append({'id': int(b), 'name': info.get('name', ''), 'far': info.get('far'), 'at': [int(xs.mean()), int(ys.min())], **r})
    buildings.sort(key=lambda r: r['at'][0])
    out['buildings'] = buildings

    # ── Every edge of ours: where the building, or the way its face looks, changes.
    code = ids * 8 + way
    edges_o = np.zeros((H, W), bool)
    edges_o[:, 1:] |= code[:, 1:] != code[:, :-1]
    edges_o[1:, :] |= code[1:, :] != code[:-1, :]
    edges_o &= cols

    # ── Outlines traced on the photograph, for what stands against other buildings and not the sky. Each is a
    # line; ours is of the building that holds most of what lies under the line.
    traced = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'outlines.json')
    out['outlines'] = []
    if os.path.exists(traced):
        lines = []
        for o in json.load(open(traced))['outlines']:
            line = np.round(np.array(o['line'], np.float32)).astype(np.int32)
            canvas = np.zeros((H, W), np.uint8)
            cv2.polylines(canvas, [line], False, 255, 1)
            inside = np.zeros((H, W), np.uint8)
            cv2.fillPoly(inside, [line], 255)
            got = ids[(inside > 0) & (ids > 0)]
            lines.append({'name': o['name'], 'line': line, 'on': canvas > 0, 'far': ndimage.distance_transform_edt(canvas == 0), 'id': int(np.bincount(got).argmax()) if len(got) else None})
        for o in lines:
            if o['id'] is None:
                out['outlines'].append({'name': o['name'], 'missing': True, 'median': MOST, 'p90': MOST, 'ok': False})
                continue
            line, b = o['line'], o['id']
            x0, y0, x1, y1 = line[:, 0].min(), line[:, 1].min(), line[:, 0].max(), line[:, 1].max()
            bx0, by0, bx1, by1 = max(0, x0 - 12), max(0, y0 - 12), min(W, x1 + 13), min(H, y1 + 1)
            box = np.zeros((H, W), bool)
            box[by0:by1, bx0:bx1] = True
            # Ours: where that building's pixels begin from above in each column, and from each side in each row,
            # within the line's box: its own outline against what is behind, as the line is the photograph's. (All
            # of its edge would count where a nearer roof cuts across its foot, which no line was traced along.)
            own = (ids == b) & box
            mine = np.zeros((H, W), bool)
            cols_with = np.flatnonzero(own.any(0))
            mine[np.argmax(own[:, cols_with], axis=0), cols_with] = True
            rows_with = np.flatnonzero(own.any(1))
            mine[rows_with, np.argmax(own[rows_with], axis=1)] = True
            mine[rows_with, W - 1 - np.argmax(own[rows_with][:, ::-1], axis=1)] = True
            # Where the building runs on past the box, the box's side is no edge of the building's.
            mine[by0, :] = False
            mine[:, bx0] = False
            mine[:, bx1 - 1] = False
            # A building with several lines (a church's two towers and its gable): each pixel of its outline is
            # measured against the nearest of them.
            for other in lines:
                if other is not o and other['id'] == b:
                    mine &= o['far'] <= other['far']
            r = both(o['far'][mine], ndimage.distance_transform_edt(~mine)[o['on']])
            out['outlines'].append({'name': o['name'], 'id': b, **(r or {'median': MOST, 'p90': MOST, 'ok': False})})

    # ── How alike the two pictures are in colour, a little blurred so that a pixel's misfit is no difference of
    # colour: the distance between them in CIELAB (2.3 is about what an eye just tells apart), over what is not
    # sky in either, by how far off it is; and over the sky. Not a measure of where things are: a picture painted
    # from the photograph would score well here whatever stood under the paint.
    lab = lambda im: cv2.cvtColor(cv2.GaussianBlur(im, (0, 0), 1.5).astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
    lo, lp = lab(ours), lab(ph)
    de = np.sqrt(((lo - lp) ** 2).sum(2))
    far_of = np.zeros(int(ids.max()) + 1, np.float32)
    for i, b in table.items():
        if i <= ids.max():
            far_of[i] = b.get('far') or 0
    dist = far_of[np.clip(ids, 0, None)]
    land = (way > 0) & ~sky_p & cols
    look = {}
    for part, m in (('all', land), ('within 400 m', land & (ids > 0) & (dist < 400)), ('400 m to 1 km', land & (dist >= 400) & (dist < 1000)), ('past 1 km', land & (dist >= 1000)), ('sky', sky_p & sky_o & cols)):
        if m.any():
            look[part] = {'median': round(float(np.median(de[m])), 1), 'mean': round(float(de[m].mean()), 1), 'lightness': round(float((lo[..., 0] - lp[..., 0])[m].mean()), 1), 'n': int(m.sum())}
    out['look'] = look

    # ── Every edge of ours to the nearest edge of the photograph (one way, flattering: shown only).
    grey = cv2.GaussianBlur(cv2.cvtColor(ph, cv2.COLOR_BGR2GRAY), (0, 0), 1.0)
    edges_p = cv2.Canny(grey, 40, 100) > 0
    out['edges'] = stats(ndimage.distance_transform_edt(~edges_p)[edges_o])

    # ── What the page shows.
    cv2.imwrite(f'{OUT}/{name}.png', ours)
    show = np.zeros((H, W, 4), np.uint8)
    show[edges_o] = (255, 34, 14, 255)  # ours: the owner's blue (BGR)
    cv2.imwrite(f'{OUT}/{name}-edges.png', show)
    show = np.zeros((H, W, 4), np.uint8)
    show[edges_p] = (0, 246, 255, 255)  # the photograph's: his yellow
    cv2.imwrite(f'{OUT}/photo-edges.png', show)
    lines = np.zeros((H, W, 4), np.uint8)
    lines[ndimage.binary_dilation(line_p)] = (0, 246, 255, 255)
    lines[ndimage.binary_dilation(line_o)] = (255, 34, 14, 255)
    lines[ndimage.binary_dilation(line_o) & ndimage.binary_dilation(line_p)] = (255, 255, 255, 255)
    cv2.imwrite(f'{OUT}/{name}-skylines.png', lines)
    json.dump(out, open(f'{OUT}/{name}.json', 'w'), indent=1)
    rounds = json.load(open(f'{OUT}/index.json')) if os.path.exists(f'{OUT}/index.json') else {'rounds': []}
    rounds['rounds'] = [r for r in rounds['rounds'] if r['name'] != name] + [{'name': name, 'label': out['label'], 'when': out['when'], 'skyline': out['skyline'], 'edges': out['edges']}]
    rounds['photo'] = {'title': 'View of San Francisco from Ina Coolbrith Park-01445.jpg', 'author': 'Frank Schulenburg', 'licence': 'CC BY-SA 4.0', 'page': 'https://commons.wikimedia.org/wiki/File:View_of_San_Francisco_from_Ina_Coolbrith_Park-01445.jpg'}
    json.dump(rounds, open(f'{OUT}/index.json', 'w'), indent=1)
    if not (dx or dy):
        half = cv2.addWeighted(ph, 0.5, ours, 0.5, 0)
        cv2.imwrite(f'{LANE}/overlay-{name}-50.jpg', half, [cv2.IMWRITE_JPEG_QUALITY, 88])
    s = out['skyline']
    print(f"{name}: skyline median {s['median']} p90 {s['p90']} (ours to photo {s['ours_to_photo']['median']}/{s['ours_to_photo']['p90']}, photo to ours {s['photo_to_ours']['median']}/{s['photo_to_ours']['p90']}); edges one way median {out['edges']['median']} p90 {out['edges']['p90']}")
    ok = sum(1 for b in buildings if b['ok'])
    print(f'{ok} of {len(buildings)} buildings on the skyline within {TARGET["median"]} px median and {TARGET["p90"]} px p90')
    for b in buildings:
        print(f"  {'ok ' if b['ok'] else '   '}{b['id']:5d} {(b['name'] or '')[:28]:28} x {b['at'][0]:4d} {b['far'] or 0:5d} m  median {b['median']:5.2f}  p90 {b['p90']:5.2f}")
    for o in out['outlines']:
        print(f"  outline {'ok ' if o.get('ok') else '   '}{o['name'][:34]:34} median {o['median']}  p90 {o['p90']}")
    for k, v in out['look'].items():
        print(f"  colour, {k:14} median {v['median']:5.1f}  mean {v['mean']:5.1f}  ours lighter by {v['lightness']:5.1f}")


if __name__ == '__main__':
    main()
