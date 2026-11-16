"""Cuts the baked squares of the Bay (#373, bake.py) into the tiles the page asks for as the eye moves.

A page cannot hold a city: a square kilometre is 20 MB in each of eight cores. So what the page asks for is small
and comes in three coarsenesses, each on its own grid of the world's frame (cells of 10 cm from the frame's corner):

    level 0   250 m a side   ground every 1 m, what stands every 0.5 m, outlines and trunks   near: cells to 0.8 m
    level 1   1 km           every 2 m, no outlines: a building is a mass in its wall's colour    cells to 6.4 m
    level 2   4 km           every 16 m                                                           past that

They are packs like any other (bay.rs reads them), in ~/.village/engine/bay/packs/tiles/<level>/<x>_<z>.bay, with
index.json saying which exist; where the squares do not reach, a tile holds what earth.py makes of the place from
the planet's data, as every tile no square touches does. The core picks the pack by how
coarse the sector it is making is (bay.rs `least_step`), and bay.ts asks for tiles by the same rule.

    ~/.village/engine/bay/venv/bin/python engine/bay/tiles.py
"""
import glob, json, os, struct
import numpy as np
from PIL import Image, ImageChops, ImageDraw
import earth

PACKS = os.path.expanduser('~/.village/engine/bay/packs')
NONE, BED, WATER = -32768, -30, 5
FRAME = '10n4250'  # the frame the squares are baked in (bake.py: zone 10 north, z south from 4,250 km)

def read(path):
    b = open(path, 'rb').read()
    h = struct.unpack('<16i', b[:64])
    assert h[0] == 0x31594142 and h[4] == 10 and h[8] == 5, 'tiles are cut from squares baked at 1 m and 0.5 m'
    gw, tw, nb, nv, nt = h[5], h[9], h[12], h[13], h[14]
    at = 64
    def take(n, kind):
        nonlocal at
        a = np.frombuffer(b, kind, n, at)
        at += a.nbytes
        return a
    p = {'gx0': h[6], 'gz0': h[7], 'gw': gw, 'tx0': h[10], 'tz0': h[11], 'tw': tw}
    p['ground'] = take(gw * gw, '<i2').reshape(gw, gw)
    p['top'] = take(tw * tw, '<i2').reshape(tw, tw)
    p['class'] = take(tw * tw, 'u1').reshape(tw, tw)
    p['tint'] = take(tw * tw, 'u1').reshape(tw, tw)
    rows = take(nb * 6, '<i4').reshape(nb, 6)
    verts = take(nv * 3, '<i4').reshape(nv, 3)
    p['buildings'] = [(tuple(map(tuple, verts[r[0]:r[0] + r[1]].tolist())), tuple(int(v) for v in r[2:])) for r in rows]
    p['trunks'] = [tuple(t) for t in take(nt * 4, '<i4').reshape(nt, 4).tolist()]
    return p


def window(a, origin, step, x0, z0, n, fill):
    """`n` by `n` samples of a grid (first sample at `origin`, one every `step` cells) from (x0, z0), `fill` where it does not reach."""
    out = np.full((n, n), fill, a.dtype)
    i0, j0 = (x0 - origin[0]) // step, (z0 - origin[1]) // step
    ia, ja, ib, jb = max(i0, 0), max(j0, 0), min(i0 + n, a.shape[1]), min(j0 + n, a.shape[0])
    if ia < ib and ja < jb:
        out[ja - j0:jb - j0, ia - i0:ib - i0] = a[ja:jb, ia:ib]
    return out


def main():
    squares = [read(p) for p in sorted(glob.glob(f'{PACKS}/*.bay'))]
    # One picture of everything baked, at half a metre and at a metre, from the frame's cell (X0, Z0).
    X0, Z0 = min(p['gx0'] for p in squares), min(p['gz0'] for p in squares)
    X1, Z1 = max(p['gx0'] + (p['gw'] - 1) * 10 for p in squares), max(p['gz0'] + (p['gw'] - 1) * 10 for p in squares)
    W, H = (X1 - X0) // 5, (Z1 - Z0) // 5
    ground = np.full((H // 2 + 1, W // 2 + 1), BED, '<i2')
    top, cls, tint = np.full((H, W), NONE, '<i2'), np.full((H, W), WATER, 'u1'), np.zeros((H, W), 'u1')
    known = np.zeros((H, W), bool)
    buildings, trunks = {}, set()
    for p in squares:
        i, j = (p['gx0'] - X0) // 10, (p['gz0'] - Z0) // 10
        ground[j:j + p['gw'], i:i + p['gw']] = p['ground']
        i, j = (p['tx0'] - X0) // 5, (p['tz0'] - Z0) // 5
        for whole, part in ((top, p['top']), (cls, p['class']), (tint, p['tint'])):
            whole[j:j + p['tw'], i:i + p['tw']] = part
        known[j:j + p['tw'], i:i + p['tw']] = True
        buildings.update(p['buildings'])  # one that stands on two squares is in both: once here
        trunks.update(p['trunks'])
    buildings, trunks = sorted(buildings.items()), sorted(trunks)
    # Where a building stands and its wall's colour, at half a metre: for the tiles that hold no outlines.
    mass = Image.new('I', (W, H), 0)
    for verts, row in buildings:
        one, ring = Image.new('1', (W, H), 0), []
        lo = [min(v[0] for v in verts), min(v[1] for v in verts)]
        box = [(lo[0] - X0) // 5 - 1, (lo[1] - Z0) // 5 - 1, (max(v[0] for v in verts) - X0) // 5 + 2, (max(v[1] for v in verts) - Z0) // 5 + 2]
        box = [max(box[0], 0), max(box[1], 0), min(box[2], W), min(box[3], H)]
        if box[0] >= box[2] or box[1] >= box[3]:
            continue
        one = Image.new('1', (box[2] - box[0], box[3] - box[1]), 0)
        for v in verts:
            ring.append(((v[0] - X0) / 5 - box[0], (v[1] - Z0) / 5 - box[1]))
            if v[2] & 4 or v is verts[-1]:
                if len(ring) > 2:  # a ring inside a ring is a yard
                    part = Image.new('1', one.size, 0)
                    ImageDraw.Draw(part).polygon(ring, fill=1)
                    one = ImageChops.logical_xor(one, part)
                ring = []
        # The wall's kind: its material and colour (kinds.rs `kind`), 16 bits, and a bit over them to say one stands.
        mass.paste((row[0] & 0xffff) | 0x10000, box[:2], one)
    mass = np.asarray(mass)

    index = {'levels': [{'size': l[0], 'gstep': l[1]} for l in earth.LEVELS], 'tiles': [[], [], []], 'squares': [os.path.basename(p)[:-4] for p in sorted(glob.glob(f'{PACKS}/*.bay'))]}
    total = [0, 0, 0]
    frame = earth.Frame(FRAME)
    for level, (size, gstep, tstep, margin, _) in enumerate(earth.LEVELS):
        os.makedirs(f'{PACKS}/tiles/{level}', exist_ok=True)
        for old in glob.glob(f'{PACKS}/tiles/{level}/*.bay'):
            os.remove(old)
        k = tstep // 5
        for tz in range(Z0 // size, (Z1 - 1) // size + 1):
            for tx in range(X0 // size, (X1 - 1) // size + 1):
                x0, z0 = tx * size, tz * size
                gw, tw = size // gstep + 1, (size + 2 * margin) // tstep
                fine = lambda a, fill: window(a, (X0, Z0), 5, x0 - margin, z0 - margin, tw * k, fill).reshape(tw, k, tw, k).swapaxes(1, 2).reshape(tw, tw, k * k)
                seen = fine(known, False)
                if not seen.any():
                    continue
                # Where the squares do not reach, the tile is what the planet's data makes of the place (earth.py).
                eg, et, ec, en, ew, erows, everts, etrunks, _ = earth.parts(frame, level, tx, tz)
                at = lambda a, fill: window(a, (X0, Z0), 10, x0, z0, (gw - 1) * (gstep // 10) + 1, fill)[::gstep // 10, ::gstep // 10]
                g = np.where(at(known[::2, ::2], False), at(ground, BED), eg)
                t, c, n, m = fine(top, NONE), fine(cls, WATER), fine(tint, 0), fine(mass, 0)
                own, stems, walls = [], [], None
                if level == 0:
                    seen = seen[..., 0]
                    t, c, n = np.where(seen, t[..., 0], et), np.where(seen, c[..., 0], ec), np.where(seen, n[..., 0], en)
                    def unseen(x, z):
                        i, j = (x - x0 + margin) // 5, (z - z0 + margin) // 5
                        return not (0 <= i < tw and 0 <= j < tw and seen[j, i])
                    own = [(v, r) for v, r in buildings if max(q[0] for q in v) >= x0 - margin and min(q[0] for q in v) < x0 + size + margin and max(q[1] for q in v) >= z0 - margin and min(q[1] for q in v) < z0 + size + margin]
                    own += [(tuple(everts[r[0]:r[0] + r[1]]), tuple(r[2:])) for r in erows if unseen(*everts[r[0]][:2])]
                    stems = [s for s in trunks if x0 - margin <= s[0] < x0 + size + margin and z0 - margin <= s[1] < z0 + size + margin] + [s for s in etrunks if unseen(s[0], s[1])]
                else:
                    seen = seen.all(-1)
                    bt, bc, bn, bw = earth.coarsen(t, c, n, m, k, level)
                    t, c, n, walls = np.where(seen, bt, et), np.where(seen, bc, ec), np.where(seen, bn, en), np.where(seen, bw, ew)
                rows, verts = [], []
                for v, r in own:
                    rows.append((len(verts), len(v), *r))
                    verts += v
                blob = earth.pack(x0, z0, size, gstep, g, tstep, x0 - margin, z0 - margin, t, c, n, walls, rows, verts, stems)
                open(f'{PACKS}/tiles/{level}/{tx}_{tz}.bay', 'wb').write(blob)
                index['tiles'][level].append([tx, tz])
                total[level] += len(blob)
    json.dump(index, open(f'{PACKS}/tiles/index.json', 'w'))
    for level in range(3):
        print(f'level {level}: {len(index["tiles"][level])} tiles, {total[level] / 1e6:.1f} MB')


main()
