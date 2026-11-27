"""Bakes one square of the Bay (#373) from what fetch.py kept into a pack the core makes cells from, and the
names the page shows: ~/.village/engine/bay/packs/<square>.bay and <square>.json. It also keeps pictures of what
it worked out in ~/.village/engine/bay/packs/<square>-*.png, for looking at.

    ~/.village/engine/bay/venv/bin/python engine/bay/bake.py 551.7_4183.5

The frame every pack shares: a cell is 10 cm; x is east and z is south, counted from 500,000 m east and
4,250,000 m north in UTM zone 10N (EPSG:26910); y is up from one metre above NAVD88's zero, which is about where
the bay's water stands. What the pack holds, and how the core reads it: core/src/bay.rs.
"""
import json, os, struct, sys, zlib
import numpy as np
from PIL import Image, ImageDraw
import laspy, pyproj
from dem import PAD, ground_grid

Image.MAX_IMAGE_PIXELS = None
HOME = os.environ.get('VILLAGE_BAY_ROOT', os.path.expanduser('~/.village/engine/bay'))
E0, N0, SEA = 500_000.0, 4_250_000.0, 1.0
ROAD, PAVEMENT, GRASS, EARTH, SAND, WATER, YARD, ROCK, CANOPY = 0, 1, 2, 3, 4, 5, 6, 7, 8
# kinds.rs: materials, and the one palette.
PLASTER, WOOD, BRICK, CONCRETE, ROOFING = 9, 10, 8, 7, 14


# DataSF building ID for the quartz-clad tower. Shared by the appearance and photo passes.
PYRAMID_CITY_ID = '201006.0000687'

# Buildings known by sight, by a point inside each (UTM zone 10N): walls, trim, lived in, cells a storey, cells a
# bay, and what is special (1 a fluted round tower; 4 storeys three times as tall, for a church's windows).
KNOWN = [
    (552309, 4184058, (CONCRETE | 2 << 8, CONCRETE | 1 << 8, False, 40, 30, 1)),  # Coit Tower
    (551915, 4183975, (PLASTER | 1 << 8, PLASTER | 1 << 8, False, 30, 44, 4)),  # Saints Peter and Paul
]


def palette():
    """page/march.ts `palette`, as the eye sees it (before the shader's own curve)."""
    out = np.zeros((256, 3))
    for i in range(1, 16):
        v = 0.86 - (i - 1) / 14 * 0.8
        out[i] = (v, v, v * 0.99)
    tones = [(0.14, 0.97), (0.26, 0.94), (0.4, 0.88), (0.55, 0.8), (0.78, 0.86), (0.7, 0.55), (0.6, 0.32), (0.16, 0.8), (0.26, 0.62), (0.3, 0.42)]
    holds = [0.95, 0.95, 0.55, 0.55, 0.7, 0.5]
    painted = {0: (0.14, 0.93), 1: (0.26, 0.88), 2: (0.4, 0.8), 7: (0.16, 0.76)}
    for hue in range(24):
        for tone in range(10):
            h = hue / 4
            at = int(h)
            hold = holds[at] + (holds[(at + 1) % 6] - holds[at]) * (h - at)
            s, bright = (painted[tone][0] * hold, painted[tone][1]) if tone in painted else tones[tone]
            v = bright * 0.84
            f = lambda n: v - v * s * max(0, min((n + h) % 6, 4 - (n + h) % 6, 1))
            out[16 + hue * 10 + tone] = (f(5), f(3), f(1))
    return out


def nearest(rgb, table, allowed):
    """Each pixel's nearest colour of the palette among `allowed`."""
    flat = rgb.reshape(-1, 3).astype(np.float32)
    out = np.zeros(len(flat), np.uint8)
    cand = table[allowed].astype(np.float32)
    for a in range(0, len(flat), 200_000):
        d = ((flat[a:a + 200_000, None, :] - cand[None]) ** 2).sum(2)
        out[a:a + 200_000] = np.asarray(allowed)[d.argmin(1)]
    return out.reshape(rgb.shape[:2])


def grow(mask, times=1):
    """The mask and every cell beside one of it, `times` over."""
    for _ in range(times):
        m = mask.copy()
        m[1:] |= mask[:-1]; m[:-1] |= mask[1:]; m[:, 1:] |= mask[:, :-1]; m[:, :-1] |= mask[:, 1:]
        mask = m
    return mask


def spread(values, known, times):
    """Cells not `known` take the highest known value beside them, `times` over."""
    v, k = values.copy(), known.copy()
    for _ in range(times):
        best = np.full(v.shape, -1e9, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            best = np.maximum(best, np.where(np.roll(k, (dy, dx), (0, 1)), np.roll(v, (dy, dx), (0, 1)), -1e9))
        take = ~k & (best > -1e8)
        v[take] = best[take]
        k = k | take
    return v, k


def despike(a):
    """A sample that stands two metres clear of all eight round it is a bird or a wire, not a roof: it takes the highest of them. (A spire is more than one sample wide and is kept.)"""
    p = np.pad(a, 1, mode='edge')
    around = np.max(np.stack([p[i:i + a.shape[0], j:j + a.shape[1]] for i in range(3) for j in range(3) if (i, j) != (1, 1)]), axis=0)
    return np.where(a > around + 2.0, around, a).astype(np.float32)


def rings(geometry):
    polys = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    for poly in polys:
        yield [[(p[0], p[1]) for p in ring] for ring in poly]


def main():
    name = sys.argv[1]
    size = float(sys.argv[sys.argv.index('--size') + 1]) if '--size' in sys.argv else 1000.0
    e0, n0 = (float(v) * 1000 for v in name.split('_'))
    raw, packs = f'{HOME}/raw/{name}', f'{HOME}/packs'
    os.makedirs(packs, exist_ok=True)
    utm = pyproj.Transformer.from_crs(4326, 26910, always_xy=True)
    # Rasters, north at the top. W and N are the west and north edges of what is kept (the square and its margin).
    W, N, span = e0 - PAD, n0 + size + PAD, size + 2 * PAD
    half = int(span * 2)  # cells of half a metre across

    def xy(lon, lat, step=0.5):
        e, n = utm.transform(lon, lat)
        return (e - W) / step, (N - n) / step

    # ── Ground: the 1 m model, a sample at each whole metre.
    ground = np.load(f'{raw}/ground.npy') if os.path.exists(f'{raw}/ground.npy') else ground_grid(f'{HOME}/raw', e0, n0, size)
    gw = ground.shape[0]
    # At half a metre, for telling what stands above it.
    g2 = np.asarray(Image.fromarray(ground).resize((half, half), Image.BILINEAR, box=(0, 0, gw - 1, gw - 1)))

    # ── What stands: the highest return in each half metre of the lidar.
    cache = f'{raw}/surface.npy'
    if os.path.exists(cache):
        surface = np.load(cache)
    else:
        merc = pyproj.Transformer.from_crs(3857, 26910, always_xy=True)
        back = pyproj.Transformer.from_crs(26910, 3857, always_xy=True)
        cx = [back.transform(e, n) for e in (W, W + span) for n in (N, N - span)]
        lo, hi = (min(c[0] for c in cx), min(c[1] for c in cx)), (max(c[0] for c in cx), max(c[1] for c in cx))
        surface = np.full(half * half, -1e9, np.float32)
        classes, kept = {}, 0
        for k, _ in json.load(open(f'{raw}/lidar/nodes.json')):
            las = laspy.read(f'{raw}/lidar/{k}.laz')
            x, y, z, c = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z), np.asarray(las.classification)
            for a, b in zip(*np.unique(c, return_counts=True)):
                classes[int(a)] = classes.get(int(a), 0) + int(b)
            ok = (x > lo[0]) & (x < hi[0]) & (y > lo[1]) & (y < hi[1]) & (c != 7) & (c != 18)
            if not ok.any():
                continue
            e, n = merc.transform(x[ok], y[ok])
            col, row = np.floor((e - W) * 2).astype(np.int64), np.floor((N - n) * 2).astype(np.int64)
            inside = (col >= 0) & (col < half) & (row >= 0) & (row < half)
            np.maximum.at(surface, row[inside] * half + col[inside], z[ok][inside].astype(np.float32))
            kept += int(inside.sum())
        surface = surface.reshape(half, half)
        if kept == 0:
            raise ValueError('no lidar returns in this square')
        with open(cache + '.part', 'wb') as f:
            np.save(f, surface)
        os.replace(cache + '.part', cache)
        print(f'lidar: {kept} points kept ({kept / span / span:.1f} a square metre); classes {classes}')
    seen = surface > -1e8
    surface, _ = spread(np.where(seen, surface, 0), seen, 6)
    surface = despike(surface)
    over = surface - g2

    # ── Colour, and what is leaf: near infra-red against red.
    rgb = np.asarray(Image.open(f'{raw}/naip.png').convert('RGB'))
    nir = np.asarray(Image.open(f'{raw}/naip-nir.png').convert('RGB'))[:, :, 0].astype(np.float32)
    m = int((rgb.shape[0] - size * 2) / 2) - PAD * 2  # the picture's own margin is wider than the pack's
    rgb, nir = rgb[m:m + half, m:m + half], nir[m:m + half, m:m + half]
    red = rgb[:, :, 0].astype(np.float32)
    leafy = (nir - red) / (nir + red + 1) > 0.12

    # ── Buildings: outlines as they are, each ring in cells of 10 cm; and where they are, at half a metre.
    lots = Image.new('I', (half, half), 0)
    draw = ImageDraw.Draw(lots)
    parcels = json.load(open(f'{raw}/landuse.geojson'))['features']
    homes = []
    for i, f in enumerate(parcels):
        p = f['properties']
        homes.append(float(p.get('resunits') or 0) > 0)
        for poly in rings(f['geometry']):
            draw.polygon([xy(*q) for q in poly[0]], fill=i + 1)
    lots = np.asarray(lots)
    built = Image.new('I', (half, half), 0)
    draw = ImageDraw.Draw(built)
    buildings, verts = [], []
    feats = json.load(open(f'{raw}/footprints.geojson'))['features']
    for f in feats:
        for poly in rings(f['geometry']):
            pts = [[xy(*q, step=0.1) for q in ring[:-1]] for ring in poly]
            if len(pts[0]) < 3:
                continue
            id = len(buildings) + 1
            draw.polygon([(x / 5, z / 5) for x, z in pts[0]], fill=id)
            for hole in pts[1:]:
                draw.polygon([(x / 5, z / 5) for x, z in hole], fill=0)
            buildings.append({'rings': pts, 'p': f['properties']})
    built = np.asarray(built)
    inside = built > 0
    # A roof is what the lidar saw a little way in from the outline (at the outline a cell is half wall, half street),
    # carried out again to the outline and a little past it.
    core = inside & ~grow(~inside, 1)
    roof, known = spread(np.where(core, surface, 0), core, 4)
    roof = np.where(known, roof, surface)

    # ── Streets: what is not a lot is street; its carriageway is what a centre line reaches without crossing a kerb.
    street = lots == 0
    kerbs = Image.new('1', (half, half), 0)
    draw = ImageDraw.Draw(kerbs)
    for f in json.load(open(f'{raw}/curbs.geojson'))['features']:
        g = f['geometry']
        for line in (g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]):
            draw.line([xy(*q[:2]) for q in line], fill=1, width=2)
    kerbs = np.asarray(kerbs)
    centre = Image.new('1', (half, half), 0)
    draw = ImageDraw.Draw(centre)
    names, ways = [], []
    for f in json.load(open(f'{raw}/streets.geojson'))['features']:
        p, g = f['properties'], f['geometry']
        if g is None or p.get('active') in (False, 'false') or p.get('date_dropped'):
            continue
        for line in (g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]):
            draw.line([xy(*q[:2]) for q in line], fill=1, width=1)
            label = (p.get('streetname') or p.get('street') or '').title()
            if label not in names:
                names.append(label)
            ways.append({'name': names.index(label), 'line': [[round(v) for v in xy(*q[:2], step=0.1)] for q in line]})
    road = np.asarray(centre) & street & ~kerbs & ~inside
    for _ in range(36):
        road = grow(road) & street & ~kerbs & ~inside
    road = grow(road, 1) & street & ~inside  # the kerb line itself is road's
    print(f'streets: {street.mean():.2f} of the square, carriageway {road.mean():.2f}, kerb cells {int(kerbs.sum())}')

    # ── What the ground is, what grows, and what colour each top is.
    table = palette()
    water = (g2 < 0.25) & ~inside
    canopy = leafy & (over > 0.7) & ~inside
    cls = np.full((half, half), YARD, np.uint8)
    cls[street] = PAVEMENT
    cls[road] = ROAD
    cls[leafy & ~road & ~inside] = GRASS
    cls[water] = WATER
    cls[canopy] |= CANOPY
    greys, hues = list(range(1, 16)), list(range(16, 256))
    soft = np.asarray(Image.fromarray(rgb).resize((half // 2, half // 2), Image.BOX).resize((half, half), Image.BILINEAR)) / 255.0
    tint = nearest(soft, table, greys + hues)
    # A yard's paving is grey as the picture has it, never the blue of a shadow.
    paved = (cls & 7) == YARD
    tint[paved] = nearest(np.repeat(soft.mean(2, keepdims=True), 3, 2), table, greys[1:9])[paved]
    top = np.where(inside, roof, np.where(canopy, surface, -1e9))

    # ── Each building: what its walls are, how its storeys go, and which of its sides look on open air or the street.
    out_b, out_v = [], []
    # Use a 0.5 m (1-pixel) erosion instead of 1.5 m so faceted bay windows & recessed porches stay open to air (#60).
    open_air = ~grow(inside, 1)
    for id, b in enumerate(buildings, 1):
        cx, cz = np.mean([p for p in b['rings'][0]], axis=0)
        lot = lots[min(half - 1, max(0, int(cz / 5))), min(half - 1, max(0, int(cx / 5)))]
        home = bool(lot and homes[lot - 1])
        # The city's own number for the building, so that it is the same building in every bake and in both packs of a seam.
        seed = zlib.crc32(str(b['p'].get('sf16_bldgid') or b['p'].get('globalid') or id).encode())
        where = built == id
        tall = float(np.median(roof[where] - g2[where])) if where.any() else 6.0
        # Its lowest ground as the city gives it (the same in both packs of a seam); else as this pack sees it.
        lowest = b['p'].get('gnd_min_m')
        base = float(lowest) if lowest not in (None, '') else float(g2[where].min()) if where.any() else 0.0
        if home or tall < 24:
            # Painted wood and plaster: whites and creams most, then the pale colours a street here is known for.
            hue = [3, 3, 4, 2, 4, 3, 16, 14, 9, 22, 1, 5][seed % 12]
            tone = [0, 0, 7, 0, 1, 7, 0, 7, 1][(seed >> 8) % 9]
            wall = PLASTER | (16 + hue * 10 + tone) << 8 if (seed >> 4) % 5 else PLASTER | (1 + (seed >> 12) % 3) << 8
            trim = PLASTER | 1 << 8
        elif (seed >> 4) % 3 == 0:
            wall, trim = BRICK, CONCRETE | 2 << 8
        else:
            wall, trim = CONCRETE | (2 + (seed >> 12) % 4) << 8, CONCRETE | 1 << 8
        storey = 30 + (seed >> 16) % 5 if home else 34 + (seed >> 16) % 6
        module = 26 + (seed >> 20) % 10 if home else 30 + (seed >> 20) % 14
        special = 0
        # What everyone knows the look of is said here, by where it stands: nothing in the data says a wall's colour.
        for e, n, mark in KNOWN:
            ke, kn = (e - W) * 2, (N - n) * 2
            if 0 <= ke < half and 0 <= kn < half and built[int(kn), int(ke)] == id:
                wall, trim, home, storey, module, special = mark
        style = storey | module << 8 | (1 if home else 0) << 16 | special << 17 | (seed >> 24 & 0xff) << 24
        first = len(out_v)
        for ring in b['rings']:
            area = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
            for i, (x, z) in enumerate(ring):
                x1, z1 = ring[(i + 1) % len(ring)]
                dx, dz = x1 - x, z1 - z
                length = max(1e-6, (dx * dx + dz * dz) ** 0.5)
                # Outwards is to the right of the way round when the ring goes round one way, to the left the other.
                ox, oz = (dz / length, -dx / length) if area > 0 else (-dz / length, dx / length)
                px, pz = int(((x + x1) / 2 + ox * 22) / 5), int(((z + z1) / 2 + oz * 22) / 5)
                flags = 0
                if 0 <= px < half and 0 <= pz < half:
                    flags = (1 if open_air[pz, px] else 0) | (2 if street[pz, px] and open_air[pz, px] else 0)
                if i == len(ring) - 1:
                    flags |= 4
                out_v.append((round(x), round(z), flags))
        out_b.append((first, len(out_v) - first, wall, trim, style, round((base - SEA) * 10)))

    # ── Trees: a trunk under each crown's highest point.
    trunks = []
    ch = np.where(canopy, over, 0)
    for r in range(4, half - 4, 4):
        for c in range(4, half - 4, 4):
            win = ch[r - 4:r + 8, c - 4:c + 8]
            at = np.unravel_index(win.argmax(), win.shape)
            if win[at] > 3.5 and 4 <= at[0] < 8 and 4 <= at[1] < 8:
                rr, cc = r - 4 + at[0], c - 4 + at[1]
                trunks.append((cc * 5 + 2, rr * 5 + 2, round((surface[rr, cc] - SEA) * 10), 1 + int(win[at] > 9)))

    # ── The pack.
    cells = lambda metres: np.round((metres - SEA) * 10)
    gy = np.where(ground < 0.25, -30, cells(ground)).astype('<i2')
    ty = np.where(top > -1e8, cells(top), -32768).astype('<i2')
    x0, z0 = round((e0 - E0) * 10), round((N0 - n0 - size) * 10)
    px0, pz0 = round((W - E0) * 10), round((N0 - N) * 10)
    head = struct.pack('<16i', 0x31594142, x0, z0, round(size * 10), 10, gw, px0, pz0, 5, half, px0, pz0, len(out_b), len(out_v), len(trunks), 0)
    blob = head + gy.tobytes() + ty.tobytes() + cls.tobytes() + tint.tobytes()
    blob += b''.join(struct.pack('<2i3Ii', *b) for b in out_b)
    blob += b''.join(struct.pack('<3i', v[0] + px0, v[1] + pz0, v[2]) for v in out_v)
    blob += b''.join(struct.pack('<4i', t[0] + px0, t[1] + pz0, t[2], t[3]) for t in trunks)
    open(f'{packs}/{name}.bay', 'wb').write(blob)

    # ── Names: streets and addresses, for the page to say where one is.
    places = []
    for f in json.load(open(f'{raw}/addresses.geojson'))['features']:
        p = f['properties']
        if f['geometry'] and p.get('address_number'):
            x, z = xy(*f['geometry']['coordinates'][:2], step=0.1)
            street_name = ' '.join(v for v in (p.get('street_name'), p.get('street_type')) if v).title()
            places.append([round(x) + px0, round(z) + pz0, int(p['address_number']), street_name])
    for w in ways:
        w['line'] = [[x + px0, z + pz0] for x, z in w['line']]
    credit = 'U.S. Geological Survey 3DEP; USDA NAIP; City and County of San Francisco (DataSF)'
    json.dump({'square': name, 'at': [x0, z0, round(size * 10)], 'names': names, 'ways': ways, 'addresses': places, 'credit': credit}, open(f'{packs}/{name}.json', 'w'))
    print(f'pack: {len(blob) / 1e6:.1f} MB; {len(out_b)} buildings, {len(out_v)} corners, {len(trunks)} trunks, {len(ways)} street parts, {len(places)} addresses')

    # ── Pictures of what was worked out.
    shade = np.clip(128 + (np.roll(surface, 1, 1) - surface) * 40 + (np.roll(surface, 1, 0) - surface) * 40, 0, 255).astype(np.uint8)
    look = np.stack([shade] * 3, axis=2)
    edge = inside & grow(~inside, 1)
    look[edge] = (255, 60, 60)
    Image.fromarray(look).save(f'{packs}/{name}-surface.png')
    colours = np.array([(70, 72, 78), (170, 166, 160), (95, 140, 60), (110, 85, 65), (217, 199, 154), (47, 111, 134), (150, 140, 130), (125, 122, 118)], np.uint8)
    what = colours[cls & 7]
    what[canopy] = (30, 90, 30)
    what[inside] = (table[tint[inside]] * 255).astype(np.uint8)
    Image.fromarray(what).save(f'{packs}/{name}-ground.png')


if __name__ == '__main__':
    main()
