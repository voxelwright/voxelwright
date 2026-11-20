"""Fetches what the view from Ina Coolbrith Park is built from (#423): the lidar and the city's building outlines
for the wedge of the city the photograph looks over. After engine/bay/fetch.py, which fetches a square; this
fetches a wedge, fine near the eye and coarser far off, since a pixel covers 7 cm at the church and 0.7 m at the towers.

Everything lands under this lane's own home (~/.village/engine/landing/ina/home/.village/engine/bay/raw/ina/), never
under ~/.village/engine/bay/. Nothing needs a key; requests say `village-engine` and nothing else. Sources and
licences: .agents/skills/bay-sources.

    ~/.village/engine/landing/ina/venv/bin/python -B engine/landing/ina/fetch.py [--only lidar|sf|naip]
"""
import concurrent.futures, json, math, os, sys, time, urllib.parse, urllib.request
import pyproj

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from place import EYE, RAW, WEDGE

EPT = 'https://usgs-lidar-public.s3.amazonaws.com/CA_SanFrancisco_1_B23'
NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'
SF = 'https://data.sfgov.org/resource/{id}.geojson'


def get(url, tries=6):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'village-engine'}), timeout=180) as r:
                return r.read()
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(1.5 * (k + 1))


def keep(path, url):
    if not os.path.exists(path):
        data = get(url)
        with open(path + '.part', 'wb') as f:
            f.write(data)
        os.rename(path + '.part', path)
    return path


def reaches(e, n, half, far):
    """Whether a square (its middle and half its side, UTM metres) reaches the wedge out to `far` metres."""
    de, dn = e - EYE[0], n - EYE[1]
    d = math.hypot(de, dn)
    r = half * math.sqrt(2)
    if d - r > far:
        return False
    if d <= r + 30:
        return True
    bearing = math.degrees(math.atan2(de, dn)) % 360
    spare = math.degrees(math.asin(min(1.0, r / d)))
    return WEDGE['from'] - spare <= bearing <= WEDGE['to'] + spare


def main():
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    only = arg('--only', None)
    os.makedirs(f'{RAW}/lidar', exist_ok=True)
    geo = pyproj.Transformer.from_crs(26910, 4326, always_xy=True)
    # The wedge's box, for what is asked by a box.
    pts = [(EYE[0], EYE[1])] + [(EYE[0] + WEDGE['far'] * math.sin(math.radians(b)), EYE[1] + WEDGE['far'] * math.cos(math.radians(b))) for b in range(int(WEDGE['from']), int(WEDGE['to']) + 1, 2)]
    e0, e1, n0, n1 = min(p[0] for p in pts) - 150, max(p[0] for p in pts) + 150, min(p[1] for p in pts) - 150, max(p[1] for p in pts) + 150

    if only in (None, 'sf'):
        (w, s), (ea, no) = geo.transform(e0, n0), geo.transform(e1, n1)
        path = keep(f'{RAW}/footprints.geojson', SF.format(id='ynuv-fyni') + '?' + urllib.parse.urlencode({'$where': f'within_box(shape,{s},{w},{no},{ea})', '$limit': 400000}))
        print('footprints', len(json.load(open(path))['features']))

    if only in (None, 'lidar'):
        # The point cloud is an octree in Web Mercator (bay/fetch.py). A node of depth 9 is 41 m of it across; all nodes
        # to depth 9 hold about 82 points a square metre, to depth 8 about 19. Near the eye every node is taken, further
        # off only to depth 8: a pixel there is wider than those points are apart. Depth 10 is the last there is, a
        # fifth as many points again: taken within 460 m, for what is built there in cells of 10 cm (church.py).
        back = pyproj.Transformer.from_crs(3857, 26910, always_xy=True)
        b = json.loads(get(EPT + '/ept.json'))['bounds']
        side = b[3] - b[0]
        nodes = []

        def walk(key):
            for k, count in json.loads(get(f'{EPT}/ept-hierarchy/{key}.json')).items():
                d, x, y, z = (int(v) for v in k.split('-'))
                cell = side / (1 << d)
                e, n = back.transform(b[0] + (x + 0.5) * cell, b[1] + (y + 0.5) * cell)
                # A metre of Web Mercator is about 0.79 m on the ground here.
                if d > WEDGE['last'] or not reaches(e, n, cell * 0.79 / 2, WEDGE['close'] if d > WEDGE['deepest'] else WEDGE['fine'] if d > WEDGE['deep'] else WEDGE['far']):
                    continue
                if count == -1:
                    if k != key:
                        walk(k)
                elif count > 0:
                    nodes.append((k, count))
        walk('0-0-0-0')
        print('lidar nodes', len(nodes), 'points', sum(c for _, c in nodes))
        done = [0]

        def one(kc):
            keep(f'{RAW}/lidar/{kc[0]}.laz', f'{EPT}/ept-data/{kc[0]}.laz')
            done[0] += 1
            if done[0] % 500 == 0:
                print(' ', done[0], 'of', len(nodes), flush=True)
        with concurrent.futures.ThreadPoolExecutor(16) as pool:
            list(pool.map(one, nodes))
        json.dump(nodes, open(f'{RAW}/lidar/nodes.json', 'w'))
        print('lidar bytes', sum(os.path.getsize(f'{RAW}/lidar/{k}.laz') for k, _ in nodes))


    if only in (None, 'naip'):
        # Last, and never fatal: the service timed out on two tiles in three on November 17, and nothing here uses the colour yet.
        # Colour from the air, 0.5 m a pixel, a kilometre at a time (the service refuses very large pictures).
        os.makedirs(f'{RAW}/naip', exist_ok=True)
        for ke in range(int(e0 // 1000), int(e1 // 1000) + 1):
            for kn in range(int(n0 // 1000), int(n1 // 1000) + 1):
                if not reaches(ke * 1000 + 500, kn * 1000 + 500, 500, WEDGE['far']):
                    continue
                q = {'bbox': f'{ke * 1000},{kn * 1000},{ke * 1000 + 1000},{kn * 1000 + 1000}', 'bboxSR': 26910, 'imageSR': 26910, 'size': '2000,2000', 'format': 'png', 'f': 'image'}
                try:
                    print('naip', ke, kn, os.path.getsize(keep(f'{RAW}/naip/{ke}_{kn}.png', NAIP + '?' + urllib.parse.urlencode(q))))
                    keep(f'{RAW}/naip/{ke}_{kn}-nir.png', NAIP + '?' + urllib.parse.urlencode({**q, 'bandIds': '3,0,1'}))
                except Exception as e:
                    print('naip', ke, kn, 'not fetched:', e)

main()
