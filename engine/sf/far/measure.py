"""The park's skyline against the photograph (#450), measured as #423 measures its place (landing/ina/overlay.py):
the line where sky ends in the photograph and in ours, both ways, the median and the 90th percentile in pixels at
the photograph's width of 2000, and the same for each named building that stands on our skyline.

Ours is the realm's whole picture, cells and far faces: sf/far/check.mjs writes each pixel's building
(`engine.farIds`: a far face's building number and way, 1 and way 6 for a cell, nothing for sky and sea). A shot of
#423's place (landing/ina/shoot.mjs) reads the same way, so this measures both alike.

    PY=~/.village/engine/landing/ina/venv/bin/python
    $PY engine/sf/far/measure.py <ids.rgba> <width>x<height> [--crop 17,0.04] [--shift dx,dy] [--leave x0,y0,x1,y1] [--json out.json] [--picture full.png --out overlay.jpg]
"""
import json, os, sys
import numpy as np
import cv2
from scipy import ndimage

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'landing', 'ina'))
from overlay import H, MOST, RIGHT, W, both, boundary, photo  # noqa: E402  #423's measures, unchanged
from place import DATA  # noqa: E402


def main():
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    path, size = sys.argv[1], [int(v) for v in sys.argv[2].split('x')]
    fw, fh = size
    ox, oy = (float(v) for v in arg('--crop', '17,0.04').split(','))
    dx, dy = (float(v) for v in arg('--shift', '0,0').split(','))
    move = np.float32([[1, 0, -ox + dx], [0, 1, -oy + dy]])
    raw = np.fromfile(path, np.uint8).reshape(fh, fw, 4)
    raw = cv2.warpAffine(raw, move, (W, H), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    ids = raw[:, :, 0].astype(np.int32) | (raw[:, :, 1].astype(np.int32) << 8) | (raw[:, :, 2].astype(np.int32) << 16)
    way = raw[:, :, 3]
    table = {b['id']: b for b in json.load(open(f'{DATA}/buildings.json'))}
    table[900004] = {'name': 'Bay Bridge, western span', 'far': 3100}
    # As overlay.py: the photograph's sky; ours is sky only where it reaches down from the top without a break.
    sky_p = cv2.resize(cv2.imread(f'{DATA}/sky.png', 0), (W, H), interpolation=cv2.INTER_AREA) > 127
    sky_o = way == 0
    lab, _ = ndimage.label(sky_o)
    sky_o = np.isin(lab, np.unique(lab[0][lab[0] > 0]))
    cols = np.zeros((H, W), bool)
    cols[:, :RIGHT] = True
    # `--leave x0,y0,x1,y1`: a box neither line is measured in (at the photograph's 2000 px), said with the numbers.
    leave = arg('--leave', None)
    if leave:
        x0, y0, x1, y1 = (int(v) for v in leave.split(','))
        cols[y0:y1, x0:x1] = False
    line_p, line_o = boundary(~sky_p) & cols, boundary(~sky_o) & cols
    for line in (line_p, line_o):
        line[0, :] = line[-1, :] = False
        line[:, 0] = line[:, -1] = False
    far_p = ndimage.distance_transform_edt(~line_p)
    far_o = ndimage.distance_transform_edt(~line_o)
    held = np.zeros((H, W), bool)
    held[:, 330:] = True
    out = {'shot': os.path.basename(path), 'shift': [dx, dy], 'leave': leave, 'most': MOST, 'skyline': both(far_p[line_o & held], far_o[line_p & held])}
    top_row = np.argmax(~sky_o, axis=0)
    top_id = ids[top_row, np.arange(W)]
    owner = np.where(line_o, ids, 0)
    buildings = []
    for b in np.unique(owner[owner > 1]):
        mine = owner == b
        if mine.sum() < 25:
            continue
        span = np.zeros((H, W), bool)
        span[:, top_id == b] = True
        r = both(far_p[mine & held], far_o[line_p & span & held])
        if r and table.get(int(b), {}).get('name'):
            buildings.append({'name': table[int(b)]['name'], 'median': r['median'], 'p90': r['p90'], 'ok': r['ok']})
    out['named'] = sorted(buildings, key=lambda r: r['name'])
    # Our skyline pixels that are cells, not far faces: where the hand-over shows on the skyline.
    out['skylineCells'] = round(float(((way == 6) & line_o & held).sum()) / max(1, float((line_o & held).sum())), 4)
    if arg('--json', None):
        json.dump(out, open(arg('--json', None), 'w'), indent=1)
    if arg('--picture', None):
        full = cv2.imread(arg('--picture', None))
        ours = cv2.warpAffine(full, move, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        half = cv2.addWeighted(photo(), 0.5, ours, 0.5, 0)
        half[line_p] = (0, 220, 255)
        half[line_o] = (255, 80, 200)
        cv2.imwrite(arg('--out', None), half, [cv2.IMWRITE_JPEG_QUALITY, 88])
    s = out['skyline']
    print(json.dumps({'skyline': {'median': s['median'], 'p90': s['p90'], 'ok': s['ok']}, 'named_ok': f"{sum(b['ok'] for b in buildings)} of {len(buildings)}", 'skylineCells': out['skylineCells']}))


if __name__ == '__main__':
    main()
