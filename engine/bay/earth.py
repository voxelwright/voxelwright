"""Makes a tile of anywhere on Earth for the engine (#373), from open data that covers the planet.

Where nothing is baked from lidar (bake.py, the first squares of San Francisco) the world is made from:

    Overture Maps (release below)   buildings with heights, roads with classes, water, land use and cover, trees
    Mapterhorn terrain tiles        the ground's height (about 2 m a sample where a country publishes it finer)

both read a map tile at a time by address, with no key (.agents/skills/bay-sources). A tile is a pack as bay.rs
reads it, on the same three grids as tiles.py, in a frame: a UTM zone and a northing its z is counted south from,
`10n4250` for the Bay (zone 10 north, 4,250 km). Cells are 10 cm; x is east of the zone's middle, y is up from 1 m.

    python earth.py tile 10n4250 0 206 263     one tile into ~/.village/engine/bay/earth/tiles/<frame>/<level>/
    python earth.py serve                       asked a tile a line on stdin ("10n4250 0 206 263"), answers its path
    python earth.py frame 48.8584 2.2945        the frame and the cell of a latitude and longitude

What is fetched is kept in ~/.village/engine/bay/earth/cache. A tile is the same every time it is made from the
same release.
"""
import gzip, io, json, math, os, pickle, struct, sys, threading, urllib.error, urllib.request, zlib
import numpy as np
import pyproj
import mapbox_vector_tile
from PIL import Image, ImageDraw
from pmtiles.reader import Reader

HOME = os.path.expanduser('~/.village/engine/bay/earth')
RELEASE = '2026-10-21.0'
OVERTURE = f'https://tiles.overturemaps.org/{RELEASE}'
TERRAIN = 'https://tiles.mapterhorn.com'
SEA = 1.0
NONE, BED = -32768, -30
ROAD, PAVEMENT, GRASS, EARTH, SAND, WATER, YARD, ROCK, CANOPY, BUILT = 0, 1, 2, 3, 4, 5, 6, 7, 8, 16
PLASTER, WOOD, BRICK, CONCRETE, GLASS, STEEL = 9, 10, 8, 7, 11, 12

# Common CSS/OSM colour names -> sRGB 0..255 for semantic building/roof tagging (#60).
NAMED_RGB = {
    'white': (236, 234, 228), 'ivory': (240, 235, 220), 'cream': (236, 226, 200), 'beige': (218, 204, 176),
    'tan': (204, 178, 142), 'sand': (216, 198, 160), 'sandstone': (206, 184, 152), 'limestone': (214, 206, 190),
    'yellow': (224, 198, 112), 'ochre': (198, 156, 88), 'gold': (212, 176, 84), 'orange': (208, 132, 78),
    'terracotta': (184, 102, 74), 'red': (168, 72, 62), 'maroon': (122, 54, 54), 'brown': (138, 102, 76),
    'pink': (222, 178, 176), 'salmon': (216, 148, 128), 'green': (112, 148, 106), 'olive': (132, 142, 96),
    'sage': (156, 174, 152), 'blue': (118, 150, 182), 'navy': (54, 72, 102), 'teal': (94, 144, 148),
    'purple': (136, 114, 148), 'lavender': (176, 162, 192), 'grey': (158, 158, 156), 'gray': (158, 158, 156),
    'lightgrey': (198, 198, 194), 'lightgray': (198, 198, 194), 'silver': (192, 196, 200),
    'darkgrey': (104, 104, 106), 'darkgray': (104, 104, 106), 'charcoal': (74, 76, 82), 'black': (44, 46, 50),
    'copper': (164, 112, 82), 'bronze': (146, 108, 76),
}

_EARTH_PALETTE = None


def _palette_rgb():
    """Engine 256-colour palette in sRGB 0..1 (matches page/march.ts & bake.py)."""
    global _EARTH_PALETTE
    if _EARTH_PALETTE is not None:
        return _EARTH_PALETTE
    out = np.zeros((256, 3), np.float32)
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
    _EARTH_PALETTE = out
    return out


def parse_color_index(raw):
    """Map an Overture/OSM hex or named colour string to the nearest engine palette index (1..255), or None."""
    if not raw or not isinstance(raw, str):
        return None
    s = raw.strip().lower().replace('_', '').replace('-', '').replace(' ', '')
    rgb = NAMED_RGB.get(s)
    if rgb is None and s.startswith('#'):
        hx = s[1:]
        if len(hx) == 3 and all(c in '0123456789abcdef' for c in hx):
            rgb = tuple(int(c * 2, 16) for c in hx)
        elif len(hx) == 6 and all(c in '0123456789abcdef' for c in hx):
            rgb = (int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16))
    if rgb is None:
        return None
    target = np.array(rgb, np.float32) / 255.0
    table = _palette_rgb()[1:]
    # Slight chroma weight so warm creams/brick reds do not snap prematurely to pure neutral grey.
    d = ((table - target) ** 2).sum(1)
    return int(np.argmin(d)) + 1


def parse_material(raw, props=None, home=False, tall=8.0):
    """Map an Overture/OSM facade_material string (or building typology) to an engine material constant."""
    m = (raw or '').strip().lower()
    if any(k in m for k in ('glass', 'mirror', 'curtain')):
        return GLASS
    if any(k in m for k in ('brick', 'clinker', 'terracotta', 'adobe')):
        return BRICK
    if any(k in m for k in ('concrete', 'cement', 'stone', 'limestone', 'granite', 'marble', 'sandstone', 'block')):
        return CONCRETE
    if any(k in m for k in ('wood', 'timber', 'log', 'shingle')):
        return WOOD
    if any(k in m for k in ('metal', 'steel', 'copper', 'bronze', 'zinc', 'alum', 'tin')):
        return STEEL
    if any(k in m for k in ('plaster', 'stucco', 'render', 'vinyl')):
        return PLASTER
    if props:
        cls = (props.get('class') or '').lower()
        sub = (props.get('subtype') or '').lower()
        if cls in ('greenhouse', 'conservatory'):
            return GLASS
        if cls in ('church', 'cathedral', 'chapel', 'civic', 'public', 'museum', 'monument', 'castle', 'fort'):
            return CONCRETE
        if cls in ('industrial', 'warehouse', 'factory', 'fire_station'):
            return BRICK
        if sub == 'commercial' and tall >= 36:
            return GLASS
    return None


def sculpt_roof(shape_name, where, base, tall, roof_h=None):
    """Sculpt a 2D height grid (cells) for gabled, hipped, pyramidal, domed or skillion roofs instead of flat boxes."""
    h, w = where.shape
    ys, xs = np.nonzero(where)
    if ys.size < 4:
        return np.full(where.shape, base + round(tall * 10), np.int32)
    shape = (shape_name or '').strip().lower()
    rh = float(roof_h) if roof_h and roof_h > 0.5 else min(max(2.2, tall * 0.28), 7.5)
    eave_m = max(2.5, tall - rh)
    y0, y1 = float(ys.min()), float(ys.max())
    x0, x1 = float(xs.min()), float(xs.max())
    cy, cx = (y0 + y1) * 0.5, (x0 + x1) * 0.5
    ry, rx = max(0.5, (y1 - y0) * 0.5), max(0.5, (x1 - x0) * 0.5)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ny = np.abs(yy - cy) / ry
    nx = np.abs(xx - cx) / rx
    if shape in ('dome', 'onion', 'round'):
        r2 = np.clip(nx * nx + ny * ny, 0.0, 1.0)
        elev = eave_m + rh * np.sqrt(1.0 - r2)
    elif shape in ('pyramidal', 'hipped'):
        elev = eave_m + rh * np.clip(1.0 - np.maximum(nx, ny), 0.0, 1.0)
    elif shape == 'gabled':
        # Ridge runs along the longer horizontal axis.
        across = ny if rx >= ry else nx
        elev = eave_m + rh * np.clip(1.0 - across, 0.0, 1.0)
    elif shape == 'skillion':
        across = ((yy - y0) / max(1.0, y1 - y0)) if rx >= ry else ((xx - x0) / max(1.0, x1 - x0))
        elev = eave_m + rh * np.clip(across, 0.0, 1.0)
    else:
        elev = np.full((h, w), tall, np.float32)
    return np.rint(base + elev * 10.0).astype(np.int32)
# As tiles.py: a tile's width, the ground's and the top's sampling, the top's margin, all in cells; then the step
# a coarse level is drawn at before it is brought down (a building smaller than a sample must still count).
LEVELS = [(2500, 10, 5, 80, 5), (10000, 20, 20, 80, 10), (40000, 160, 160, 320, 40)]
# How wide a road is drawn, in metres, by Overture's class; a way on foot is pavement.
WIDTH = {'motorway': 15, 'trunk': 13, 'primary': 12, 'secondary': 11, 'tertiary': 10, 'residential': 8.5, 'unclassified': 7.5, 'living_street': 6.5, 'service': 4, 'track': 3}
WALKED = {'footway': 2, 'path': 1.5, 'pedestrian': 5, 'steps': 2, 'cycleway': 2, 'sidewalk': 2, 'crosswalk': 2, 'bridleway': 2}
GREEN = {'park', 'grass', 'garden', 'pitch', 'cemetery', 'golf_course', 'meadow', 'recreation_ground', 'playground', 'forest', 'wood', 'village_green', 'farmland', 'orchard', 'scrub', 'nature_reserve', 'fairway', 'dog_park', 'grassland', 'heath', 'allotments', 'vineyard', 'plant_nursery', 'stadium', 'track'}
WOODED = {'forest', 'wood'}

lock = threading.Lock()
memory = {}


def get(url, span=None):
    head = {'User-Agent': 'village-engine'}
    if span:
        head['Range'] = f'bytes={span[0]}-{span[0] + span[1] - 1}'
    for k in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=head), timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 204):
                return None
            if k == 3:
                raise
        except Exception:
            if k == 3:
                raise


def kept(name, make, remember=True):
    """What `make` returns, kept on disk under `name` and (unless told not to) in memory."""
    with lock:
        if name in memory:
            return memory[name]
    path = f'{HOME}/cache/{name}'
    if os.path.exists(path):
        value = pickle.load(open(path, 'rb'))
    else:
        value = make()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        pickle.dump(value, open(path + f'.{os.getpid()}.{threading.get_ident()}', 'wb'))
        os.replace(path + f'.{os.getpid()}.{threading.get_ident()}', path)
    if remember:
        with lock:
            if len(memory) > 400:
                memory.clear()
            memory[name] = value
    return value


readers = {}


def features(theme, z, x, y):
    """One map tile of Overture: {layer: [(type, rings in longitude and latitude, properties)]}."""
    def make():
        url = f'{OVERTURE}/{theme}.pmtiles'
        reader = readers.setdefault(theme, Reader(lambda off, n: kept(f'{RELEASE}/ranges/{theme}/{off}_{n}', lambda: get(url, (off, n))) if n < 600000 and off < 600000 else get(url, (off, n))))
        raw = reader.get(z, x, y)
        if raw is None:
            return {}
        if raw[:2] == b'\x1f\x8b':
            raw = gzip.decompress(raw)
        out, n = {}, 2 ** z
        for name, layer in mapbox_vector_tile.decode(raw).items():
            e, rows = layer['extent'], []
            def ll(ring):
                a = np.asarray(ring, float).reshape(-1, 2)
                lon = (x + a[:, 0] / e) / n * 360 - 180
                lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * (y + 1 - a[:, 1] / e) / n))))
                return np.stack([lon, lat], 1)
            for f in layer['features']:
                g, kind, c = f['geometry'], f['geometry']['type'], f['geometry']['coordinates']
                parts = [[c]] if kind == 'Point' else [c] if kind in ('LineString', 'Polygon') and kind == 'Polygon' else [[c]] if kind == 'LineString' else [[p] for p in c] if kind in ('MultiPoint', 'MultiLineString') else c
                p = f['properties']
                keep = {
                    k: p[k]
                    for k in (
                        'id', 'height', 'num_floors', 'class', 'subtype', 'is_underground', 'is_salt',
                        '@name', 'level', 'road_surface', 'roof_shape', 'roof_color', 'roof_material',
                        'roof_height', 'roof_direction', 'facade_color', 'facade_material',
                        'has_parts', 'building_id', 'min_height',
                    )
                    if k in p
                }
                for part in parts:
                    rows.append((kind.replace('Multi', ''), [ll(r) for r in part], keep))
            out[name] = rows
        return out
    return kept(f'{RELEASE}/2/{theme}/{z}/{x}_{y}', make)


decoded = {}


def terrain(z, x, y):
    """One terrain tile as metres, 512 a side, or None where there is none. Kept on disk as it came (a tenth of what its heights take)."""
    key = (z, x, y)
    with lock:
        if key in decoded:
            return decoded[key]
    raw = kept(f'terrain/{z}/{x}_{y}.webp', lambda: get(f'{TERRAIN}/{z}/{x}/{y}.webp'), False)
    t = None
    if raw is not None:
        a = np.asarray(Image.open(io.BytesIO(raw)).convert('RGB')).astype(np.float32)
        t = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    with lock:
        if len(decoded) > 60:
            decoded.clear()
        decoded[key] = t
    return t


def heights(lon, lat, zoom):
    """The ground's height in metres at each longitude and latitude, between the terrain's samples."""
    out = np.zeros(lon.shape, np.float32)
    done = np.zeros(lon.shape, bool)
    for z in (zoom, zoom - 2, zoom - 4, 9):
        if done.all():
            break
        n = 2 ** z
        fx = (lon + 180) / 360 * n
        fy = (1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * n
        tx, ty = np.floor(fx).astype(int), np.floor(fy).astype(int)
        for key in {(a, b) for a, b in zip(tx[~done].ravel().tolist(), ty[~done].ravel().tolist())}:
            t = terrain(z, *key)
            if t is None:
                continue
            here = (tx == key[0]) & (ty == key[1]) & ~done
            w = t.shape[0]
            # A sample is its pixel's middle; at a tile's edge the nearest is taken.
            u, v = np.clip((fx[here] - key[0]) * w - 0.5, 0, w - 1.001), np.clip((fy[here] - key[1]) * w - 0.5, 0, w - 1.001)
            i, j = u.astype(int), v.astype(int)
            a, b = u - i, v - j
            out[here] = t[j, i] * (1 - a) * (1 - b) + t[j, i + 1] * a * (1 - b) + t[j + 1, i] * (1 - a) * b + t[j + 1, i + 1] * a * b
            done |= here
    return out


class Frame:
    def __init__(self, name):
        self.name = name
        zone, south, north = int(name[:-5] if name[-5] in 'ns' else name[:name.index('n' if 'n' in name else 's')]), 's' in name, 0
        north = int(name[name.index('s' if south else 'n') + 1:]) * 1000.0
        # NAD83 where the zone has it (as the lidar of the Bay is), else WGS84.
        code = 26900 + zone if not south and 1 <= zone <= 23 else (32700 if south else 32600) + zone
        self.n0 = north
        self.to = pyproj.Transformer.from_crs(4326, code, always_xy=True)
        self.back = pyproj.Transformer.from_crs(code, 4326, always_xy=True)

    def cells(self, ll):
        e, n = self.to.transform(ll[:, 0], ll[:, 1])
        return np.stack([(e - 500000.0) * 10, (self.n0 - n) * 10], 1)

    def lonlat(self, x, z):
        return self.back.transform(np.asarray(x) / 10 + 500000.0, self.n0 - np.asarray(z) / 10)


def frame_of(lat, lon):
    """The frame a place is in, and its cell there."""
    zone = int((lon + 180) // 6) + 1
    code = 26900 + zone if lat >= 0 and 1 <= zone <= 23 else (32700 if lat < 0 else 32600) + zone
    e, n = pyproj.Transformer.from_crs(4326, code, always_xy=True).transform(lon, lat)
    north = math.ceil(n / 250000) * 250
    return f'{zone}{"s" if lat < 0 else "n"}{north}', round((e - 500000) * 10), round((north * 1000 - n) * 10)


def grow(mask, times=1):
    for _ in range(times):
        m = mask.copy()
        m[1:] |= mask[:-1]; m[:-1] |= mask[1:]; m[:, 1:] |= mask[:, :-1]; m[:, :-1] |= mask[:, 1:]
        mask = m
    return mask


def style(seed, home, tall, props=None):
    """A building's wall, trim and style word: honours Overture/OSM facade_material & facade_color first, then
    building typology, falling back to a muted regional palette when source attributes are absent (#60)."""
    props = props or {}
    mat = parse_material(props.get('facade_material'), props, home, tall)
    col = parse_color_index(props.get('facade_color'))
    if mat is not None:
        if mat == GLASS:
            wall = GLASS | ((col or (16 + 14 * 10 + 7)) << 8)
            trim = STEEL | (2 << 8)
        elif mat == BRICK:
            wall = BRICK | ((col or 0) << 8)
            trim = CONCRETE | (2 << 8)
        elif mat == STEEL:
            wall = STEEL | ((col or (2 + (seed >> 12) % 6)) << 8)
            trim = STEEL | (1 << 8)
        elif mat == WOOD:
            wall = WOOD | ((col or (16 + 2 * 10 + 8)) << 8)
            trim = PLASTER | (1 << 8)
        elif mat == CONCRETE:
            wall = CONCRETE | ((col or (2 + (seed >> 12) % 4)) << 8)
            trim = CONCRETE | (1 << 8)
        else:
            wall = PLASTER | ((col or (1 + (seed >> 12) % 3)) << 8)
            trim = PLASTER | (1 << 8)
    elif col is not None:
        base_mat = PLASTER if (home or tall < 24) else CONCRETE
        wall = base_mat | (col << 8)
        trim = PLASTER | (1 << 8)
    elif home or tall < 24:
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
    return wall, trim, storey | module << 8 | (1 if home else 0) << 16 | (seed >> 24 & 0xff) << 24


def draw(frame, x0, z0, n, step, zoom, fine):
    """
    The place from cell (x0, z0), `n` samples a side, one every `step` cells: the ground's height at each sample's
    corner (n + 1 a side, metres), what the ground is, what stands and how high (cells), a colour, each building's
    wall, and (where `fine`) the buildings' outlines and the trunks.
    """
    wide = n * step
    edge = np.arange(n + 1) * step
    gx, gz = np.meshgrid(x0 + edge, z0 + edge)
    lon, lat = frame.lonlat(gx, gz)
    ground = heights(np.asarray(lon), np.asarray(lat), zoom)
    # The ground under each sample's middle, in cells.
    under = np.round(((ground[:-1, :-1] + ground[1:, :-1] + ground[:-1, 1:] + ground[1:, 1:]) / 4 - SEA) * 10)
    west, east, south, north = float(np.min(lon)), float(np.max(lon)), float(np.min(lat)), float(np.max(lat))

    def gather(theme, layer, z):
        m = 2 ** z
        xs = range(int((west + 180) / 360 * m), int((east + 180) / 360 * m) + 1)
        ys = range(int((1 - math.asinh(math.tan(math.radians(north))) / math.pi) / 2 * m), int((1 - math.asinh(math.tan(math.radians(south))) / math.pi) / 2 * m) + 1)
        for ty in ys:
            for tx in xs:
                rows = kept(f'{RELEASE}/2/{frame.name}/{theme}-{layer}/{z}/{tx}_{ty}', lambda: [(k, [frame.cells(r) for r in rings], p) for k, rings, p in features(theme, z, tx, ty).get(layer, [])])
                for kind, rings, p in rows:
                    lo, hi = np.min([r.min(0) for r in rings], 0), np.max([r.max(0) for r in rings], 0)
                    if hi[0] >= x0 - 200 and hi[1] >= z0 - 200 and lo[0] < x0 + wide + 200 and lo[1] < z0 + wide + 200:
                        yield kind, rings, p

    px = lambda ring: [((x - x0) / step, (z - z0) / step) for x, z in ring]

    def fill(image, rings, value):
        d = ImageDraw.Draw(image)
        d.polygon(px(rings[0]), fill=value)
        for hole in rings[1:]:
            if len(hole) > 2:
                d.polygon(px(hole), fill=0)

    # ── What the ground is: land cover, then what people made of it, then water, then roads.
    cls = Image.new('L', (n, n), GRASS + 100)
    zbase = min(13, zoom)
    for kind, rings, p in gather('base', 'land_cover', zbase):
        if kind == 'Polygon':
            sort = p.get('subtype')
            fill(cls, rings, 100 + (YARD if sort == 'urban' else ROCK if sort in ('barren', 'snow') else GRASS))
    wood = Image.new('L', (n, n), 0)
    for kind, rings, p in gather('base', 'land_cover', zbase):
        if kind == 'Polygon' and p.get('subtype') in ('forest', 'mangrove'):
            fill(wood, rings, 1)
    for kind, rings, p in gather('base', 'land_use', zbase):
        if kind == 'Polygon' and (p.get('class') in GREEN or p.get('subtype') in ('park', 'golf', 'agriculture', 'cemetery', 'protected', 'recreation')):
            fill(cls, rings, 100 + GRASS)
            if p.get('class') in WOODED:
                fill(wood, rings, 1)
    for kind, rings, p in gather('base', 'land', zbase):
        if kind == 'Polygon' and p.get('class') in ('sand', 'beach', 'dune', 'rock', 'bare_rock', 'scree', 'forest', 'wood', 'grass', 'scrub', 'heath', 'meadow'):
            c = p.get('class')
            fill(cls, rings, 100 + (SAND if c in ('sand', 'beach', 'dune') else ROCK if c in ('rock', 'bare_rock', 'scree') else GRASS))
            if c in WOODED:
                fill(wood, rings, 1)
    water = Image.new('L', (n, n), 0)
    for kind, rings, p in gather('base', 'water', zbase):
        if kind == 'Polygon':
            fill(water, rings, 1)
        elif kind == 'LineString' and p.get('class') in ('river', 'canal', 'stream'):
            ImageDraw.Draw(water).line(px(rings[0]), fill=1, width=max(1, round({'river': 80, 'canal': 60}.get(p.get('class'), 20) / step)))
    roads = Image.new('L', (n, n), 0)
    ways = [(rings[0], p) for kind, rings, p in gather('transportation', 'segment', min(14, zoom)) if kind == 'LineString' and p.get('subtype') == 'road' and not p.get('is_underground') and (p.get('level') or 0) >= 0]
    for ring, p in ways:  # pavements under, then the carriageways over them
        w = WIDTH.get(p.get('class'))
        if w and p.get('class') in ('primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street'):
            ImageDraw.Draw(roads).line(px(ring), fill=2, width=max(1, round((w + 5) * 10 / step)), joint='curve')
        elif p.get('class') in WALKED:
            ImageDraw.Draw(roads).line(px(ring), fill=2, width=max(1, round(WALKED[p['class']] * 10 / step)), joint='curve')
    for ring, p in ways:
        w = WIDTH.get(p.get('class'))
        if w:
            ImageDraw.Draw(roads).line(px(ring), fill=1, width=max(1, round(w * 10 / step)), joint='curve')
    cls, wood, water, roads = np.asarray(cls) - 100, np.asarray(wood) > 0, np.asarray(water) > 0, np.asarray(roads)
    cls = np.where(roads == 1, ROAD, np.where(roads == 2, PAVEMENT, cls)).astype('u1')
    # Water over everything but a bridge's road; the sea and what lies at its level is deep.
    cls = np.where(water & (roads == 0), WATER, cls).astype('u1')

    # ── Buildings.
    built = Image.new('I', (n, n), 0)
    found = {}
    for kind, rings, p in gather('buildings', 'building', min(14, zoom)):
        if kind == 'Polygon' and len(rings[0]) > 3 and not p.get('is_underground'):
            # One building may come in pieces, cut where map tiles meet: each piece is found by its own corners.
            found[(p.get('id'), round(float(rings[0][:, 0].min())), round(float(rings[0][:, 1].min())))] = (rings, p)
    # A building drawn in parts (a tower's legs and its stages, a hall and its spire) is its parts, each its own
    # height; the lower are drawn first, so that what is higher stands on them.
    parted = {}
    for kind, rings, p in gather('buildings', 'building_part', min(14, zoom)):
        if kind == 'Polygon' and len(rings[0]) > 3 and p.get('height'):
            parted[(p.get('id'), round(float(rings[0][:, 0].min())), round(float(rings[0][:, 1].min())))] = (rings, {**p, 'part': p.get('building_id')})
    whole = {p['part'] for _, p in parted.values()}
    found = {k: v for k, v in found.items() if not (v[1].get('has_parts') and k[0] in whole)}
    found.update(parted)
    buildings = []
    for i, key in enumerate(sorted(found, key=lambda k: (found[k][1].get('height') or 0, str(k))), 1):
        rings, p = found[key]
        fill(built, rings, i)
        buildings.append((rings, p, zlib.crc32(str(key[0]).encode())))
    built = np.asarray(built)
    top = np.full((n, n), NONE, np.int32)
    tint = np.full((n, n), 6, 'u1')
    mass = np.zeros((n, n), np.int32)
    rows, verts = [], []
    open_air = ~grow(built > 0, 1) if fine else None
    street = roads > 0
    for i, (rings, p, seed) in enumerate(buildings, 1):
        lo, hi = rings[0].min(0), rings[0].max(0)
        a = [max(0, int((lo[0] - x0) / step) - 1), max(0, int((lo[1] - z0) / step) - 1), min(n, int((hi[0] - x0) / step) + 2), min(n, int((hi[1] - z0) / step) + 2)]
        if a[0] >= a[2] or a[1] >= a[3]:
            continue
        where = built[a[1]:a[3], a[0]:a[2]] == i
        # Its height as the map has it; else by its floors; else a house or two floors of something, by its size.
        tall = p.get('height') or (p.get('num_floors') or 0) * 3.3
        area = abs(sum(rings[0][k][0] * rings[0][k - 1][1] - rings[0][k - 1][0] * rings[0][k][1] for k in range(len(rings[0])))) / 200
        if not tall:
            tall = 3.2 + (seed >> 5) % 3 * 1.6 if area < 400 else 5 + (seed >> 5) % 4 * 1.5
        home = p.get('subtype') == 'residential' or p.get('class') in ('house', 'residential', 'detached', 'apartments', 'terrace', 'semidetached_house') or (not p.get('subtype') and area < 350 and tall < 14)
        if not where.any():
            continue
        base = int(under[a[1]:a[3], a[0]:a[2]][where].min())
        roof_shape = p.get('roof_shape')
        if roof_shape and roof_shape.lower() in ('gabled', 'hipped', 'pyramidal', 'dome', 'onion', 'round', 'skillion'):
            sculpted = sculpt_roof(roof_shape, where, base, tall, p.get('roof_height'))
            top[a[1]:a[3], a[0]:a[2]][where] = sculpted[where]
        else:
            top[a[1]:a[3], a[0]:a[2]][where] = base + round(tall * 10)
        roof_mat = (p.get('roof_material') or '').lower()
        roof_col = parse_color_index(p.get('roof_color'))
        if any(k in roof_mat for k in ('grass', 'green', 'plant', 'living')):
            roof_tint = 16 + 8 * 10 + 5  # living green roof -> GRASS in bay.rs
        elif roof_col is not None:
            roof_tint = roof_col
        else:
            roof_tint = 4 + (seed >> 9) % 6
        tint[a[1]:a[3], a[0]:a[2]][where] = roof_tint
        wall, trim, word = style(seed, home, tall, p)
        mass[a[1]:a[3], a[0]:a[2]][where] = wall | 0x10000
        if fine:
            first = len(verts)
            for ring in rings:
                ring = ring[:-1] if len(ring) > 1 and (ring[0] == ring[-1]).all() else ring
                turn = sum(ring[k][0] * ring[(k + 1) % len(ring)][1] - ring[(k + 1) % len(ring)][0] * ring[k][1] for k in range(len(ring)))
                for k, (x, z) in enumerate(ring):
                    x1, z1 = ring[(k + 1) % len(ring)]
                    dx, dz = x1 - x, z1 - z
                    length = max(1e-6, (dx * dx + dz * dz) ** 0.5)
                    ox, oz = (dz / length, -dx / length) if turn > 0 else (-dz / length, dx / length)
                    qx, qz = int(((x + x1) / 2 + ox * 22 - x0) / step), int(((z + z1) / 2 + oz * 22 - z0) / step)
                    flags = 0
                    if 0 <= qx < n and 0 <= qz < n:
                        flags = (1 if open_air[qz, qx] else 0) | (2 if street[qz, qx] and open_air[qz, qx] else 0)
                    verts.append((round(float(x)), round(float(z)), flags | (4 if k == len(ring) - 1 else 0)))
            rows.append((first, len(verts) - first, wall, trim, word, base))

    # ── Trees: the ones the map has, and a wood's worth where it says there is a wood.
    trunks, stems = [], []
    if step <= 10:
        for kind, rings, p in gather('base', 'land', zbase):
            if kind == 'Point' and p.get('class') == 'tree':
                x, z = rings[0][0]
                stems.append((round(float(x)), round(float(z))))
        spacing = 70
        for tz in range((z0 - 200) // spacing, (z0 + wide + 200) // spacing + 1):
            for tx in range((x0 - 200) // spacing, (x0 + wide + 200) // spacing + 1):
                h = zlib.crc32(struct.pack('<2i', tx, tz))
                x, z = tx * spacing + h % spacing, tz * spacing + (h >> 8) % spacing
                i, j = (x - x0) // step, (z - z0) // step
                if 0 <= i < n and 0 <= j < n and wood[j, i] and (h >> 16) % 4:
                    stems.append((x, z))
        yy, xx = np.mgrid[0:n, 0:n]
        for x, z in sorted(set(stems)):
            h = zlib.crc32(struct.pack('<2i', x, z))
            i, j = (x - x0) / step, (z - z0) / step
            if not (0 <= i < n and 0 <= j < n) or built[int(j), int(i)] or cls[int(j), int(i)] in (ROAD, WATER):
                continue
            high, reach = 55 + h % 70, (22 + (h >> 8) % 18) / step
            a = [max(0, int(i - reach)), max(0, int(j - reach)), min(n, int(i + reach) + 2), min(n, int(j + reach) + 2)]
            far = np.hypot(xx[a[1]:a[3], a[0]:a[2]] + 0.5 - i, yy[a[1]:a[3], a[0]:a[2]] + 0.5 - j) / reach
            crown = (far < 1) & (built[a[1]:a[3], a[0]:a[2]] == 0)
            height = (under[int(j), int(i)] + high * (1 - 0.35 * far * far)).astype(np.int32)
            top[a[1]:a[3], a[0]:a[2]] = np.where(crown, np.maximum(top[a[1]:a[3], a[0]:a[2]], height), top[a[1]:a[3], a[0]:a[2]])
            cls[a[1]:a[3], a[0]:a[2]] |= np.where(crown, CANOPY, 0).astype('u1')
            trunks.append((x, z, int(under[int(j), int(i)]) + high, 1 + (high > 95)))
    elif wood.any():  # from far a wood is a canopy
        top = np.where(wood & (built == 0) & (cls != WATER) & (cls != ROAD), under.astype(np.int32) + 90, top)
        cls = (cls | np.where(wood & (built == 0) & (cls != WATER) & (cls != ROAD), CANOPY, 0)).astype('u1')

    cells = np.round((ground - SEA) * 10)
    # The sea: water where the land is at its level.
    wet = np.zeros((n + 1, n + 1), bool)
    low = water & (under < 5)
    wet[:-1, :-1] |= low; wet[1:, :-1] |= low; wet[:-1, 1:] |= low; wet[1:, 1:] |= low
    cells = np.where(wet, BED, np.maximum(cells, -20000))
    return {'ground': cells, 'top': top, 'class': cls, 'tint': tint, 'mass': mass, 'rows': rows, 'verts': verts, 'trunks': trunks, 'land': bool((~low).any())}


def coarsen(t, c, n, m, k, level):
    """Samples k by k brought down to one (the last axis holds them): what stands, what the ground is, a colour, the wall."""
    mid = (k // 2) * k + k // 2
    # Only what is a roof or a crown counts: a stray lidar return beside a wall is not the wall's height.
    t = np.where((m > 0) | ((c & CANOPY) > 0), t, NONE)
    stands = t > NONE
    built = (m > 0).mean(-1) >= 0.4
    leafy = ((c & CANOPY) > 0).mean(-1) >= 0.5
    # The third highest thing in a sample at 2 m (a spire stays, one stray return does not), the middling one at 16 m.
    rank = min(k * k, 3 if level == 1 else max(1, k * k // 4))
    high = np.where(stands.sum(-1) >= rank, np.sort(t, -1)[..., -rank], np.where(stands.any(-1), t.max(-1), NONE))
    top = np.where(built | leafy, high, NONE)
    walls = np.where(built, m.max(-1) & 0xffff, 0)
    cls = (c[..., mid] & 7) | np.where(leafy & ~built, CANOPY, 0) | np.where(built, BUILT, 0)
    cls |= np.where((cls == ROAD) & ((c[..., mid] & 135) == 128), 128, 0)
    return top, cls, n[..., mid], walls


def blocks(a, k):
    w = a.shape[0] // k
    return a[:w * k, :w * k].reshape(w, k, w, k).swapaxes(1, 2).reshape(w, w, k * k)


def pack(x0, z0, size, gstep, ground, tstep, tx0, tz0, top, cls, tint, walls=None, rows=(), verts=(), trunks=()):
    gw, tw = ground.shape[0], top.shape[0]
    head = struct.pack('<16i', 0x31594142, x0, z0, size, gstep, gw, x0, z0, tstep, tw, tx0, tz0, len(rows), len(verts), len(trunks), 0 if walls is None else 1)
    blob = head + np.ascontiguousarray(ground).astype('<i2').tobytes() + np.ascontiguousarray(np.clip(top, NONE, 32767)).astype('<i2').tobytes() + np.ascontiguousarray(cls).astype('u1').tobytes() + np.ascontiguousarray(tint).astype('u1').tobytes()
    if walls is not None:
        blob += np.ascontiguousarray(walls).astype('<u2').tobytes()
    return blob + b''.join(struct.pack('<2i3Ii', r[0], r[1], r[2] & 0xffffffff, r[3] & 0xffffffff, r[4] & 0xffffffff, r[5]) for r in rows) + b''.join(struct.pack('<3i', *v) for v in verts) + b''.join(struct.pack('<4i', *s) for s in trunks)


def parts(frame, level, tx, tz):
    """A tile's arrays as a pack holds them: ground, top, class, tint, walls (None at level 0), rows, verts, trunks, and whether any of it is land."""
    size, gstep, tstep, margin, fine = LEVELS[level]
    x0, z0 = tx * size, tz * size
    k = tstep // fine
    n = (size + 2 * margin) // fine
    d = draw(frame, x0 - margin, z0 - margin, n, fine, 15 if level < 2 else 12, level == 0)
    # The ground's samples are the drawing's corners, from the tile's own corner, every `gstep`.
    g = d['ground'][margin // fine::gstep // fine, margin // fine::gstep // fine][:size // gstep + 1, :size // gstep + 1]
    if level == 0:
        return g, d['top'], d['class'], d['tint'], None, d['rows'], d['verts'], d['trunks'], d['land']
    top, cls, tint, walls = coarsen(blocks(d['top'], k), blocks(d['class'], k), blocks(d['tint'], k), blocks(d['mass'], k), k, level)
    return g, top, cls, tint, walls, [], [], [], d['land']


def tile_bytes(frame, level, tx, tz):
    """Encode the planet tile, or empty bytes for open sea."""
    size, gstep, tstep, margin, _ = LEVELS[level]
    g, top, cls, tint, walls, rows, verts, trunks, land = parts(frame, level, tx, tz)
    return pack(tx * size, tz * size, size, gstep, g, tstep, tx * size - margin, tz * size - margin, top, cls, tint, walls, rows, verts, trunks) if land else b''


def tile(frame, level, tx, tz):
    """Makes a tile and returns its path; a tile that is all sea is an empty file."""
    path = f'{HOME}/tiles/{frame.name}/{level}/{tx}_{tz}.bay'
    if os.path.exists(path):
        return path
    blob = tile_bytes(frame, level, tx, tz)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path + f'.{os.getpid()}.{threading.get_ident()}', 'wb').write(blob)
    os.replace(path + f'.{os.getpid()}.{threading.get_ident()}', path)
    return path


frames = {}


def main():
    if sys.argv[1] == 'frame':
        print(json.dumps(frame_of(float(sys.argv[2]), float(sys.argv[3]))))
    elif sys.argv[1] == 'tile':
        print(tile(Frame(sys.argv[2]), *(int(v) for v in sys.argv[3:6])))
    elif sys.argv[1] == 'serve':
        # Several processes make tiles side by side (what they fetch is shared on disk); a thread an ask waits for one.
        import concurrent.futures
        pool, out = concurrent.futures.ProcessPoolExecutor(int(sys.argv[2]) if len(sys.argv) > 2 else 6), threading.Lock()
        def answer(line):
            try:
                name, level, tx, tz = line.split()
                reply = {'ask': line, 'path': pool.submit(by_name, name, int(level), int(tx), int(tz)).result()}
            except Exception as e:
                reply = {'ask': line, 'error': f'{type(e).__name__}: {e}'}
            with out:
                print(json.dumps(reply), flush=True)
        for line in sys.stdin:
            if line.strip():
                threading.Thread(target=answer, args=(line.strip(),), daemon=True).start()


def by_name(name, level, tx, tz):
    return tile(frames.setdefault(name, Frame(name)), level, tx, tz)


if __name__ == '__main__':
    main()
