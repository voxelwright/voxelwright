"""Cuts the baked squares of the Bay (#373, bake.py) into the tiles the page asks for as the eye moves.

A page cannot hold a city: a square kilometre is 20 MB in each of eight cores. So what the page asks for is small
and comes in three coarsenesses, each on its own grid of the world's frame (cells of 10 cm from the frame's corner):

    level 0   250 m a side   ground every 1 m, what stands every 0.5 m, outlines and trunks   near: cells to 0.8 m
    level 1   1 km           every 2 m, no outlines: a building is a mass in its wall's colour    cells to 1.6 m
    level 2   4 km           every 16 m                                                           past that

They are packs like any other (bay.rs reads them), in ~/.village/engine/bay/packs/tiles/<level>/<x>_<z>.bay, with
index.json saying which exist; where the squares do not reach, a tile holds what earth.py makes of the place from
the planet's data, as every tile no square touches does. The core picks the pack by how
coarse the sector it is making is (bay.rs `least_step`), and bay.ts asks for tiles by the same rule.

    ~/.village/engine/bay/venv/bin/python engine/bay/tiles.py
"""
import glob, json, os, struct
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageDraw
from shapely import contains_xy, make_valid, union_all
from shapely.geometry import LineString, Point, Polygon, box as survey_box
import earth
import compact_store
from street_furniture import decode, encode

PACKS = os.path.join(os.environ.get('VILLAGE_BAY_ROOT', os.path.expanduser('~/.village/engine/bay')), 'packs')
NONE, BED, WATER = -32768, -30, 5
FRAME = '10n4250'  # the frame the squares are baked in (bake.py: zone 10 north, z south from 4,250 km)

def read(path):
    b = compact_store.read(path)
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
    p["fixtures"] = decode(b[at:])
    return p


def window(a, origin, step, x0, z0, n, fill):
    """`n` by `n` samples of a grid (first sample at `origin`, one every `step` cells) from (x0, z0), `fill` where it does not reach."""
    out = np.full((n, n), fill, a.dtype)
    i0, j0 = (x0 - origin[0]) // step, (z0 - origin[1]) // step
    ia, ja, ib, jb = max(i0, 0), max(j0, 0), min(i0 + n, a.shape[1]), min(j0 + n, a.shape[0])
    if ia < ib and ja < jb:
        out[ja - j0:jb - j0, ia - i0:ib - i0] = a[ja:jb, ia:ib]
    return out


def outline(verts):
    rings, ring = [], []
    for x, z, flags in verts:
        ring.append((x, z))
        if flags & 4:
            if len(ring) >= 3:
                rings.append(ring)
            ring = []
    if not rings:
        return Polygon()
    polygon = Polygon(rings[0], rings[1:])
    return polygon if polygon.is_valid else make_valid(polygon)


def measured_fronts(top, x0, z0, buildings, roofs):
    """Write the surveyed half-metre sections only inside the matching near-tile outline."""
    for roof in roofs:
        sections = roof['sections']
        first = roof['firstX']
        last = first + 5 * (len(sections[0][1]) - 1)
        if (last < x0 or first >= x0 + 5 * top.shape[1] or sections[-1][0] < z0
                or sections[0][0] >= z0 + 5 * top.shape[0]):
            continue
        # Packs retain the surveyed corners, but discard the DataSF id. Match its directed front edge.
        a, b = map(tuple, roof['edge'])
        for verts, _ in buildings:
            if not any(v[:2] == a and verts[(i + 1) % len(verts)][:2] == b for i, v in enumerate(verts)):
                continue
            footprint = outline(verts)
            levels, profiles = zip(*sections)
            zs = np.arange(levels[0], levels[-1] + 1, 5)
            for column, heights in enumerate(zip(*profiles)):
                x = first + 5 * column
                i = (x - x0) // 5
                if not 0 <= i < top.shape[1]:
                    continue
                rows = (zs - z0) // 5
                inside = (rows >= 0) & (rows < top.shape[0]) & contains_xy(footprint, x + 0.5, zs + 0.5)
                rows = rows[inside]
                fit = np.rint(np.interp(zs[inside], levels, heights))
                old = top[rows, i]
                # Skip missing or low court returns and tall projections. The measured front can lower
                # a smeared edge by up to 1.6 m, but can raise a sample by at most 0.3 m.
                top[rows, i] = np.where((old >= fit - 3) & (old <= fit + 16), fit, old)
            break


def polygons(geometry):
    if geometry.geom_type == 'Polygon':
        yield geometry
    elif hasattr(geometry, 'geoms'):
        for part in geometry.geoms:
            yield from polygons(part)


def outside_survey(rows, vertices, surveyed, tile):
    """Fallback geometry has no wall inside land owned by a surveyed square."""
    for start, count, *style in rows:
        original = vertices[start:start + count]
        polygon = outline(original)
        if surveyed.covers(polygon):
            continue
        if surveyed.disjoint(polygon):
            yield tuple(original), tuple(style)
            continue
        # Only an actual survey boundary cuts a fallback polygon. The new cut
        # face is plain; surviving measured edges keep their open/street flags.
        edges = []
        first = 0
        for i, a in enumerate(original):
            b = original[first if a[2] & 4 else i + 1]
            if a[:2] != b[:2]:
                edges.append((LineString([a[:2], b[:2]]), a[2] & 3))
            if a[2] & 4:
                first = i + 1
        for part in polygons(polygon.difference(surveyed)):
            if part.area < 1 or not part.intersects(tile):
                continue
            result = []
            for j, ring in enumerate([part.exterior, *part.interiors]):
                points = [(round(x), round(z)) for x, z in ring.coords[:-1]]
                points = [p for i, p in enumerate(points) if p != points[i-1]]
                if len(set(points)) < 3:
                    if j == 0:
                        break
                    continue
                for i, a in enumerate(points):
                    b = points[(i+1) % len(points)]
                    mid = Point((a[0]+b[0])/2, (a[1]+b[1])/2)
                    flags = next((f for edge, f in edges if edge.distance(mid) <= 0.75), 0)
                    result.append((*a, flags | (4 if i+1 == len(points) else 0)))
            if result:
                yield tuple(result), tuple(style)


def cut(paths, wanted=None):
    squares = [read(p) for p in sorted(paths)]
    surveyed = union_all([survey_box(p['tx0'], p['tz0'], p['tx0'] + 5*p['tw'], p['tz0'] + 5*p['tw']) for p in squares])
    # One picture of everything baked, at half a metre and at a metre, from the frame's cell (X0, Z0).
    X0, Z0 = min(p['gx0'] for p in squares), min(p['gz0'] for p in squares)
    X1, Z1 = max(p['gx0'] + (p['gw'] - 1) * 10 for p in squares), max(p['gz0'] + (p['gw'] - 1) * 10 for p in squares)
    W, H = (X1 - X0) // 5, (Z1 - Z0) // 5
    ground = np.full((H // 2 + 1, W // 2 + 1), BED, '<i2')
    top, cls, tint = np.full((H, W), NONE, '<i2'), np.full((H, W), WATER, 'u1'), np.zeros((H, W), 'u1')
    known = np.zeros((H, W), bool)
    buildings, trunks, fixtures = {}, set(), set()
    for p in squares:
        i, j = (p['gx0'] - X0) // 10, (p['gz0'] - Z0) // 10
        ground[j:j + p['gw'], i:i + p['gw']] = p['ground']
        i, j = (p['tx0'] - X0) // 5, (p['tz0'] - Z0) // 5
        for whole, part in ((top, p['top']), (cls, p['class']), (tint, p['tint'])):
            whole[j:j + p['tw'], i:i + p['tw']] = part
        known[j:j + p['tw'], i:i + p['tw']] = True
        for verts, row in p['buildings']:
            # Adjacent squares can measure different eaves on the same outline.
            # Choose the square containing its centre, with sorted square order for ties.
            key = tuple((x,z,flags & 4) for x,z,flags in verts)
            cx = (min(v[0] for v in verts)+max(v[0] for v in verts))//2
            cz = (min(v[1] for v in verts)+max(v[1] for v in verts))//2
            if key not in buildings or p['gx0']+160 <= cx < p['gx0']+10160 and p['gz0']+160 <= cz < p['gz0']+10160:
                buildings[key] = (verts,row)
        trunks.update(p['trunks'])
        fixtures.update(p['fixtures'])
    buildings, trunks = sorted(buildings.values()), sorted(trunks)
    # Where a building stands and its wall's colour, at half a metre: for the tiles that hold no outlines.
    mass = Image.new('I', (W, H), 0)
    for verts, row in buildings:
        ring = []
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
    roofs = json.loads(Path(__file__).with_name('sf-roof-fronts.json').read_text())['roofs']
    frame = earth.Frame(FRAME)
    for level, (size, gstep, tstep, margin, _) in enumerate(earth.LEVELS):
        os.makedirs(f'{PACKS}/tiles/{level}', exist_ok=True)
        k = tstep // 5
        for tz in range(Z0 // size, (Z1 - 1) // size + 1):
            for tx in range(X0 // size, (X1 - 1) // size + 1):
                if wanted is not None and (level, tx, tz) not in wanted:
                    continue
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
                    own = [(v, r) for v, r in buildings if max(q[0] for q in v) >= x0 - margin and min(q[0] for q in v) < x0 + size + margin and max(q[1] for q in v) >= z0 - margin and min(q[1] for q in v) < z0 + size + margin]
                    measured_fronts(t, x0 - margin, z0 - margin, own, roofs)
                    stems = [s for s in trunks if x0 - margin <= s[0] < x0 + size + margin and z0 - margin <= s[1] < z0 + size + margin]
                    if not seen.all():
                        tile = survey_box(x0-margin, z0-margin, x0+size+margin, z0+size+margin)
                        # Some surveyed footprints continue beyond the edge of their raster.
                        crossing = []
                        for verts, _ in own:
                            polygon = outline(verts)
                            if not surveyed.covers(polygon.envelope):
                                crossing.append(polygon)
                        solid = union_all([surveyed, *crossing]) if crossing else surveyed
                        own.extend(outside_survey(erows, everts, solid, tile))
                        stems.extend(s for s in etrunks if not surveyed.covers(Point(s[0], s[1])))
                else:
                    seen = seen.all(-1)
                    bt, bc, bn, bw = earth.coarsen(t, c, n, m, k, level)
                    t, c, n, walls = np.where(seen, bt, et), np.where(seen, bc, ec), np.where(seen, bn, en), np.where(seen, bw, ew)
                rows, verts = [], []
                for v, r in own:
                    rows.append((len(verts), len(v), *r))
                    verts += v
                blob = earth.pack(x0, z0, size, gstep, g, tstep, x0 - margin, z0 - margin, t, c, n, walls, rows, verts, stems)
                if level == 0 and fixtures:
                    near = [r for r in sorted(fixtures) if max(r[0],r[3])+3 >= x0-margin and min(r[0],r[3])-3 < x0+size+margin
                            and max(r[2],r[5])+3 >= z0-margin and min(r[2],r[5])-3 < z0+size+margin]
                    blob += encode(near)
                from paint_tile import without_eye_trees
                blob = without_eye_trees(blob)
                if os.environ.get('VILLAGE_FACADE_EVIDENCE'):
                    # What the photographs say of each building, where a records folder is named (evidence_tile.py).
                    import evidence_tile
                    blob = evidence_tile.apply(blob, evidence_tile.load(os.environ['VILLAGE_FACADE_EVIDENCE']))
                path = f'{PACKS}/tiles/{level}/{tx}_{tz}.bay'
                with open(path + '.part', 'wb') as f:
                    f.write(blob)
                os.replace(path + '.part', path)
                index['tiles'][level].append([tx, tz])
    return index


if __name__ == '__main__':
    index = cut(glob.glob(f'{PACKS}/*.bay'))
    path = f'{PACKS}/tiles/index.json'
    with open(path + '.part', 'w') as f:
        json.dump(index, f)
    os.replace(path + '.part', path)
    for level, keys in enumerate(index['tiles']):
        size = sum(os.path.getsize(f'{PACKS}/tiles/{level}/{x}_{z}.bay') for x, z in keys)
        print(f'level {level}: {len(keys)} tiles, {size / 1e6:.1f} MB')
