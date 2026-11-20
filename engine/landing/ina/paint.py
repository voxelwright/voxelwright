"""Paints the place from the photograph (#423): a colour for every cell the photograph's eye can see, as the place
`ina-painted`, kept apart from `ina`.

`ina` gives a building five colours and draws its windows by rule. Here each cell of each face takes the colour
the photograph has where the cell falls on it, with the engine's own light at that minute taken off: what is kept
is the cell's paint, so the engine's sun, shade, air and weather still fall on it. The page keeps the paints in one
picture, a texel a cell (page/matte.ts, the atlas), and draws a painted face with no windows of its own.

This is the photograph's pixels laid on the model: the place's index says so, and whose photograph it is.
It also flatters: from the photograph's own eye a painted place looks like the photograph whatever stands under
the paint. Where things stand is measured on `ina` (overlay.py), and a painted place is judged from another eye.

A cell is left as its building's fitted colour where the eye did not see it, where the photograph has sky, in the
photographer's own corner, and within a pixel of an edge between two buildings (where a pixel of misfit would lay
one building's colour on the other); then it takes its painted neighbours' colour, if any are near.

    python paint.py begin                  `ina` as `ina-painted`, every face painted its own one colour
    node shoot.mjs --place ina-painted --name pa0 --fine 3 --cells 1
    python paint.py turn pa0 --cells pa0   the paints moved toward the photograph (two or three turns, a shot each)
    python paint.py end                    faces no cell of which was painted go back to their one colour
"""
import hashlib, json, os, shutil, sys
import numpy as np
import cv2
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from place import DATA, LANE, REF
from overlay import H, RIGHT, W

HOME = f'{LANE}/home/.village/engine/place'
ACROSS = 4096
PAINTED = 14  # the style a painted face carries (page/matte.ts)
SOURCE = 'View of San Francisco from Ina Coolbrith Park-01445.jpg, Frank Schulenburg, CC BY-SA 4.0, https://commons.wikimedia.org/wiki/File:View_of_San_Francisco_from_Ina_Coolbrith_Park-01445.jpg'


def faces(place):
    """Every face of a place, block after block: its words, and how many cells it is across and up (as the page counts them)."""
    index = json.load(open(f'{HOME}/{place}/index.json'))
    words, cell = [], []
    for b in index['blocks']:
        f = np.fromfile(f'{HOME}/{place}/{b["file"]}', '<u4').reshape(-1, 5)
        words.append(f)
        cell.append(np.full(len(f), b['cell'], np.float32))
    f, cell = np.concatenate(words), np.concatenate(cell)
    lu, lw, axis = (f[:, 0] >> 22).astype(np.int64), (f[:, 2] & 0x3ff).astype(np.int64), (f[:, 2] >> 10) & 3
    y0, y1 = (f[:, 1] & 0xffff).astype(np.float32), (f[:, 1] >> 16).astype(np.float32)
    across = np.where(axis == 1, lw, lu)
    high = np.where(axis == 0, lw, np.maximum(1, np.ceil((y1 - y0) / cell)).astype(np.int64))
    return index, f, across, high


def write(index, f, place):
    at = 0
    for b in index['blocks']:
        f[at:at + b['faces']].astype('<u4').tofile(f'{HOME}/{place}/{b["file"]}')
        at += b['faces']
    json.dump(index, open(f'{HOME}/{place}/index.json', 'w'))


def save(atlas, place, name='atlas.png'):
    """The paints as a picture 4096 across: a texel a cell, in the order the faces are listed."""
    rows = -(-len(atlas) // ACROSS)
    img = np.zeros((rows * ACROSS, 4), np.uint8)
    img[:len(atlas), :3] = atlas[:, ::-1]
    img[:, 3] = 255
    cv2.imwrite(f'{HOME}/{place}/{name}', img.reshape(rows, ACROSS, 4), [cv2.IMWRITE_PNG_COMPRESSION, 6])
    return [ACROSS, rows]


def begin():
    out = f'{HOME}/ina-painted'
    shutil.rmtree(out, ignore_errors=True)
    shutil.copytree(f'{HOME}/ina', out)
    index, f, across, high = faces('ina')
    n = across * high
    base = np.cumsum(n) - n
    rgb = np.stack([(f[:, 3] >> 16) & 255, (f[:, 3] >> 8) & 255, f[:, 3] & 255], 1).astype(np.uint8)
    np.savez(f'{DATA}/paint.npz', words=f[:, 3].copy(), n=n, across=across, high=high, base=base)
    atlas = np.repeat(rgb, n, axis=0)
    f[:, 3] = base.astype(np.uint32) | np.uint32(PAINTED << 24)
    index['atlas'] = {'file': 'atlas.png', 'size': save(atlas, 'ina-painted')}
    write(index, f, 'ina-painted')
    np.save(f'{DATA}/paint-atlas.npy', atlas)
    np.save(f'{DATA}/paint-done.npy', np.zeros(len(atlas), bool))
    print(f'{len(f)} faces, {len(atlas) / 1e6:.2f} million cells, atlas {index["atlas"]["size"]}')


def turn(name, cells_from):
    shot = json.load(open(f'{LANE}/shots/{name}.json'))
    k = int(shot['fine'])
    fw, fh = shot['size'][0] * k, shot['size'][1] * k
    ours = cv2.imread(f'{LANE}/shots/{name}-full.png')
    assert ours.shape[:2] == (fh, fw), (ours.shape, fw, fh)
    cells = np.fromfile(f'{LANE}/shots/{cells_from}-cells.u32', '<u4').reshape(fh, fw).astype(np.int64) - 1
    said = np.load(f'{DATA}/paint.npz')
    words, n, base = said['words'], said['n'], said['base']
    index, f, _, _ = faces('ina-painted')
    # Which face each pixel shows, and so which building.
    face = np.where(cells >= 0, np.searchsorted(base, np.maximum(cells, 0), side='right') - 1, -1)
    bid = np.where(face >= 0, f[np.maximum(face, 0), 4].astype(np.int64), 0)
    # The photograph at the shot's fineness, where the shot has it (the frame is a cut of the taller picture drawn).
    ox, oy = int(round(shot['crop'][0] * k)), int(round(shot['crop'][1] * k))
    ph = cv2.resize(cv2.imread(f'{REF}/ina-full.jpg'), (W * k, H * k), interpolation=cv2.INTER_AREA)
    sky = cv2.resize(cv2.imread(f'{DATA}/sky.png', 0), (W * k, H * k), interpolation=cv2.INTER_AREA) > 127
    cells, bid, ours = (v[oy:oy + H * k, ox:ox + W * k] for v in (cells, bid, ours))
    # The page darkens its picture's corners, as a lens does, after everything; the photograph is not to be painted
    # darker for that: the corners' darkening is taken off ours.
    yy, xx = np.mgrid[0:H * k, 0:W * k]
    corners = 1.0 - (((xx + ox + 0.5) / fw - 0.5) ** 2 + ((yy + oy + 0.5) / fh - 0.5) ** 2) * 0.42
    # A paint is moved by how the two differ as they are shown, squared and a little more (a screen's own curve):
    # the page's tone curve the other way round is so steep near white that a white wall, a hair apart in its three
    # colours, came out pink and green.
    lo = (np.clip(ours.astype(np.float32) / 255 / corners[..., None].astype(np.float32), 0.004, 1)) ** 2.2
    lp = (np.clip(ph.astype(np.float32) / 255, 0.004, 1)) ** 2.2
    # What is not painted from: the photograph's sky, the photographer's corner, and within a pixel of the
    # photograph of an edge between two buildings, or between a building and the sky.
    edge = np.zeros(bid.shape, bool)
    for a, b in (((slice(1, None), slice(None)), (slice(None, -1), slice(None))), ((slice(None), slice(1, None)), (slice(None), slice(None, -1)))):
        d = bid[a] != bid[b]
        edge[a] |= d
        edge[b] |= d
    use = (cells >= 0) & ~sky & ~ndimage.binary_dilation(edge, iterations=k) & (xx < RIGHT * k)
    at = cells[use]
    count = np.bincount(at, minlength=int(n.sum()))
    atlas = np.load(f'{DATA}/paint-atlas.npy')
    done = np.load(f'{DATA}/paint-done.npy')
    was = (atlas.astype(np.float32) / 255) ** 2.2
    new = was.copy()
    seen = count > 0
    for c in range(3):
        # ours is stored blue first; the atlas is red first.
        p = np.bincount(at, weights=lp[..., 2 - c][use], minlength=len(count))[seen] / count[seen]
        o = np.bincount(at, weights=lo[..., 2 - c][use], minlength=len(count))[seen] / count[seen]
        new[seen, c] = np.clip(np.maximum(was[seen, c], 0.004) * np.clip(p / np.maximum(o, 1e-4), 0.2, 5.0) ** 0.9, 0.003, 0.92)
    done |= seen
    miss = float(np.abs(ph[use].astype(np.float32) - ours[use].astype(np.float32)).mean())
    np.save(f'{DATA}/paint-atlas.npy', np.round(255 * new ** (1 / 2.2)).astype(np.uint8))
    np.save(f'{DATA}/paint-done.npy', done)
    shown = spread(np.round(255 * new ** (1 / 2.2)).astype(np.uint8), done, said)
    index['atlas'] = {'file': 'atlas.png', 'size': save(shown, 'ina-painted')}
    write(index, f, 'ina-painted')
    print(f'{name}: {int(seen.sum())} cells painted this turn ({done.mean():.3f} of all so far); the two pictures differed there by {miss:.1f} of 255 before it')


def spread(atlas, done, said, reach=6):
    """Cells not painted take the colour of painted cells beside them on the same face, up to `reach` cells off."""
    n, across, base = said['n'], said['across'], said['base']
    face = np.repeat(np.arange(len(n)), n)
    local = np.arange(len(face)) - base[face]
    col, row, wide, high = local % across[face], local // across[face], across[face], said['high'][face]
    out, got = atlas.astype(np.float32), done.copy()
    for _ in range(reach):
        total, hits = np.zeros(out.shape, np.float32), np.zeros(len(out), np.float32)
        for ok, step in ((col > 0, -1), (col < wide - 1, 1), (row > 0, -wide), (row < high - 1, wide)):
            j = np.flatnonzero(ok & ~got)
            src = j + (step if np.isscalar(step) else step[j])
            take = got[src]
            total[j[take]] += out[src[take]]
            hits[j[take]] += 1
        fill = (hits > 0) & ~got
        if not fill.any():
            break
        out[fill] = total[fill] / hits[fill][:, None]
        got |= fill
    return np.round(out).astype(np.uint8)


def end():
    said = np.load(f'{DATA}/paint.npz')
    words, n, base = said['words'], said['n'], said['base']
    index, f, _, _ = faces('ina-painted')
    done = np.load(f'{DATA}/paint-done.npy')
    atlas = spread(np.load(f'{DATA}/paint-atlas.npy'), done, said)
    # A face no cell of which the eye saw goes back to its one colour and its windows.
    painted = np.add.reduceat(done.astype(np.int64), base) > 0
    f[~painted, 3] = words[~painted]
    keep = np.repeat(painted, n)
    kept = n * painted
    f[painted, 3] = (np.cumsum(kept) - kept)[painted].astype(np.uint32) | np.uint32(PAINTED << 24)
    small = atlas[keep]
    for old in os.listdir(f'{HOME}/ina-painted'):
        if old.startswith('atlas'):
            os.remove(f'{HOME}/ina-painted/{old}')
    # Named by what is in it, so that a browser never shows an old one.
    name = f'atlas-{hashlib.sha1(small.tobytes()).hexdigest()[:10]}.png'
    index['atlas'] = {'file': name, 'size': save(small, 'ina-painted', name)}
    index['painted'] = {'from': SOURCE, 'what': 'each cell the photograph\'s eye sees takes the photograph\'s colour there, with the engine\'s light at that minute taken off: the photograph\'s pixels laid on the model', 'cells': int(len(small)), 'faces': int(painted.sum())}
    index['credit'] = index['credit'].replace('; colours after a photograph by Frank Schulenburg (CC BY-SA 4.0)', '') + '; painted from a photograph by Frank Schulenburg (CC BY-SA 4.0)'
    write(index, f, 'ina-painted')
    size = os.path.getsize(f'{HOME}/ina-painted/{name}')
    print(f'{int(painted.sum())} of {len(f)} faces painted, {len(small) / 1e6:.2f} million cells of {len(atlas) / 1e6:.2f}; atlas {index["atlas"]["size"]}, {size / 1e6:.1f} MB')


if __name__ == '__main__':
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    what = sys.argv[1]
    if what == 'begin':
        begin()
    elif what == 'turn':
        turn(sys.argv[2], arg('--cells', sys.argv[2]))
    elif what == 'end':
        end()
