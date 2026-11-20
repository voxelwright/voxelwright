"""Fits each building's colours to the photograph (#423): five colours a building, its roof and its walls by which
way they look. matte.py bakes the place with them (the owner's word of November 17: a building's colours may be
taken from the photograph); `matte.py --plain` bakes it without.

No pixel of the photograph is kept, and the place's index says whose photograph the colours are after (Frank
Schulenburg, CC BY-SA 4.0, Wikimedia Commons).

A turn: take a shot of the place (shoot.mjs: the picture, and each pixel's building and which way its face
looks); for each building and way, the middle colour of the photograph over those pixels against the middle colour
of ours; the building's colour is moved by their ratio. Light, haze and windows are all in ours, so after two or
three turns ours comes out the photograph's colour. Run again whenever the place's light, sky or air change.

    python fitcolours.py <shot>         updates DATA/colours-photo.json (begun from colours-default.json)
"""
import json, os, sys
import numpy as np
import cv2
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from place import DATA, LANE
from overlay import H, W, photo

LEAST = 6  # pixels of a building's face that must be seen for its colour to be fitted


def main():
    name = sys.argv[1]
    shot = json.load(open(f'{LANE}/shots/{name}.json'))
    fw, fh = shot['size']
    move = np.float32([[1, 0, -shot['crop'][0]], [0, 1, -shot['crop'][1]]])
    ours = cv2.warpAffine(cv2.imread(f'{LANE}/shots/{name}-full.png'), move, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    raw = cv2.warpAffine(np.fromfile(f'{LANE}/shots/{name}-ids.rgba', np.uint8).reshape(fh, fw, 4), move, (W, H), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    ids = raw[:, :, 0].astype(np.int64) | (raw[:, :, 1].astype(np.int64) << 8) | (raw[:, :, 2].astype(np.int64) << 16)
    way = raw[:, :, 3].astype(np.int64)
    key = ids * 8 + way
    # Pixels at the edge of a building are a mix of two things: left out. (Its own faces lie side by side in stripes
    # a pixel or two wide near the eye: a pixel among its own building's is kept, whichever way its neighbours look.)
    same = np.ones((H, W), bool)
    for ax in (0, 1):
        for d in (1, -1):
            same &= np.roll(ids, d, ax) == ids
    lin = lambda im: (im[:, :, ::-1].astype(np.float32) / 255) ** 2.2
    p, o = lin(photo()), lin(ours)
    use = same & (ids > 0) & (ids < 900000) & (way > 0)
    k, pp, oo = key[use], p[use], o[use]
    order = np.argsort(k, kind='stable')
    k, pp, oo = k[order], pp[order], oo[order]
    starts = np.flatnonzero(np.concatenate([[True], k[1:] != k[:-1]]))
    ends = np.concatenate([starts[1:], [len(k)]])
    path = f'{DATA}/colours-photo.json'
    now = json.load(open(path))['colours'] if os.path.exists(path) else json.load(open(f'{DATA}/colours-default.json'))
    unpack = lambda c: np.array([(c >> 16) & 255, (c >> 8) & 255, c & 255], np.float32)
    moved = 0
    for a, b in zip(starts, ends):
        if b - a < LEAST:
            continue
        i, w = str(int(k[a] // 8)), int(k[a] % 8)
        if i not in now:
            continue
        ratio = np.clip(np.median(pp[a:b], 0) / np.maximum(np.median(oo[a:b], 0), 1e-3), 0.2, 5.0)
        was = (unpack(now[i][w - 1]) / 255) ** 2.2
        new = np.clip(np.maximum(was, 0.004) * ratio ** 0.85, 0.003, 0.92)
        r, g, bl = (np.round(255 * new ** (1 / 2.2))).astype(int)
        now[i][w - 1] = int((r << 16) | (g << 8) | bl)
        moved += 1
    json.dump({'after': 'View of San Francisco from Ina Coolbrith Park-01445.jpg, Frank Schulenburg, CC BY-SA 4.0, https://commons.wikimedia.org/wiki/File:View_of_San_Francisco_from_Ina_Coolbrith_Park-01445.jpg', 'what': 'five colours a building (roof, then walls by the way they look), fitted so that the engine\'s picture of each comes out the photograph\'s colour', 'colours': now}, open(path, 'w'))
    miss = np.abs(p[use] - o[use]).mean()
    print(f'{name}: {moved} faces of buildings fitted; mean difference over them before this turn {miss:.4f} (linear light)')


if __name__ == '__main__':
    main()
