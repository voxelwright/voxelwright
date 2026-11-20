"""Fetches the raw data for one square of the Bay (#373) into ~/.village/engine/bay/raw/<square>/.

A square is a kilometre of UTM zone 10N (EPSG:26910), named by the km of its south-west corner: `551_4183`
(`--size` metres for another size). Nothing here needs a key; requests say `village-engine` and nothing else.
Sources and their licences: .agents/skills/bay-sources.

    ~/.village/engine/bay/venv/bin/python engine/bay/fetch.py 551.7_4183.5 [--depth 9] [--only lidar]
"""
import concurrent.futures, json, os, sys, time, urllib.parse, urllib.request
import pyproj
from dem import sheets

RAW = os.path.join(os.environ.get('VILLAGE_BAY_ROOT', os.path.expanduser('~/.village/engine/bay')), 'raw')
EPT = 'https://usgs-lidar-public.s3.amazonaws.com/CA_SanFrancisco_1_B23'
DEM = 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/CA_SanFrancisco_B23/TIFF/USGS_1M_10_x{x}y{y}_CA_SanFrancisco_B23.tif'
NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'
SF = 'https://data.sfgov.org/resource/{id}.geojson'
# DataSF layers: name, id, the column a box is asked of (None: by latitude and longitude columns).
LAYERS = [('footprints', 'ynuv-fyni', 'shape'), ('streets', '3psu-pn9h', 'line'), ('addresses', '3mea-di5p', 'point'),
          ('curbs', 'emxt-b6yg', 'the_geom'), ('trees', 'tkzw-k3nq', None), ('landuse', 'c5ge-t6pj', 'the_geom')]


def get(url, tries=5):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'village-engine'}), timeout=120) as r:
                return r.read()
        except Exception as e:  # a 502 now and then: ask again
            if k == tries - 1:
                raise
            time.sleep(1.5 * (k + 1))


def keep(path, url):
    if not os.path.exists(path):
        start = time.monotonic()
        data = get(url)
        # Some services return an HTML or JSON error with HTTP 200. A retry
        # must be able to fetch real data instead of reusing a cached error.
        if path.endswith('.geojson') and not isinstance(json.loads(data).get('features'), list):
            raise ValueError(f'invalid feature collection for {os.path.basename(path)}')
        signatures = {'.png': (b'\x89PNG\r\n\x1a\n',), '.laz': (b'LASF',), '.tif': (b'II*\0', b'MM\0*', b'II+\0', b'MM\0+')}
        magic = signatures.get(os.path.splitext(path)[1])
        if magic and not data.startswith(magic):
            raise ValueError(f'invalid data for {os.path.basename(path)}')
        with open(path + '.part', 'wb') as f:
            f.write(data)
        os.rename(path + '.part', path)
        if not path.endswith('.laz'):
            print(os.path.basename(path), len(data), round(time.monotonic() - start, 2), 'seconds')
    return path


def square(name, size):
    e, n = (float(v) * 1000 for v in name.split('_'))
    return e, n, e + size, n + size


def main():
    name = sys.argv[1]
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    size, depth, only = float(arg('--size', 1000)), int(arg('--depth', 9)), arg('--only', None)
    e0, n0, e1, n1 = square(name, size)
    out = os.path.join(RAW, name)
    os.makedirs(out + '/lidar', exist_ok=True)
    geo = pyproj.Transformer.from_crs(26910, 4326, always_xy=True)
    m = 120  # what stands just outside the square is wanted too: a building on its edge, a tree's crown
    (w, s), (ea, no) = geo.transform(e0 - m, n0 - m), geo.transform(e1 + m, n1 + m)

    if only in (None, 'sf'):
        for layer, id, column in LAYERS:
            where = f'within_box({column},{s},{w},{no},{ea})' if column else f'latitude::number>{s} AND latitude::number<{no} AND longitude::number>{w} AND longitude::number<{ea}'
            path = keep(f'{out}/{layer}.geojson', SF.format(id=id) + '?' + urllib.parse.urlencode({'$where': where, '$limit': 200000}))
            print(layer, len(json.load(open(path))['features']))

    if only in (None, 'dem'):
        # The 1 m ground comes in tiles of 10 km, named by the km of their north-west corner over ten.
        for x, y in sheets(e0, n0, size):
            print('dem', os.path.getsize(keep(f'{RAW}/dem_x{x}y{y}.tif', DEM.format(x=x, y=y))))

    if only in (None, 'naip'):
        # Colour, 0.5 m a pixel in the square's own frame (the pictures are 0.6 m), with the margin.
        px = int((size + 2 * m) * 2)
        q = {'bbox': f'{e0 - m},{n0 - m},{e1 + m},{n1 + m}', 'bboxSR': 26910, 'imageSR': 26910, 'size': f'{px},{px}', 'format': 'png', 'f': 'image'}
        print('naip', os.path.getsize(keep(f'{out}/naip.png', NAIP + '?' + urllib.parse.urlencode(q))))
        # And the same with near infra-red first (bands 4, 1, 2): leaves are bright in it, which is how the bake tells a tree from a roof.
        print('naip infra-red', os.path.getsize(keep(f'{out}/naip-nir.png', NAIP + '?' + urllib.parse.urlencode({**q, 'bandIds': '3,0,1'}))))

    if only in (None, 'lidar'):
        # The point cloud is an octree in Web Mercator. Every node that reaches the square, down to `depth`
        # (points about 165 m / 2^depth apart: 0.32 m at 9), is kept whole; the bake cuts it to the square.
        merc = pyproj.Transformer.from_crs(26910, 3857, always_xy=True)
        corners = [merc.transform(x, y) for x in (e0 - m, e1 + m) for y in (n0 - m, n1 + m)]
        lo = [min(c[0] for c in corners), min(c[1] for c in corners)]
        hi = [max(c[0] for c in corners), max(c[1] for c in corners)]
        b = json.loads(get(EPT + '/ept.json'))['bounds']
        side = b[3] - b[0]
        nodes = []

        def walk(key):
            for k, count in json.loads(get(f'{EPT}/ept-hierarchy/{key}.json')).items():
                d, x, y, z = (int(v) for v in k.split('-'))
                cell = side / (1 << d)
                if d > depth or b[0] + x * cell > hi[0] or b[0] + (x + 1) * cell < lo[0] or b[1] + y * cell > hi[1] or b[1] + (y + 1) * cell < lo[1]:
                    continue
                if count == -1:
                    if k != key:
                        walk(k)
                elif count > 0:
                    nodes.append((k, count))
        walk('0-0-0-0')
        print('lidar nodes', len(nodes), 'points', sum(c for _, c in nodes))
        with concurrent.futures.ThreadPoolExecutor(12) as pool:
            list(pool.map(lambda kc: keep(f'{out}/lidar/{kc[0]}.laz', f'{EPT}/ept-data/{kc[0]}.laz'), nodes))
        json.dump(nodes, open(f'{out}/lidar/nodes.json', 'w'))
        print('lidar bytes', sum(os.path.getsize(f'{out}/lidar/{k}.laz') for k, _ in nodes))


main()
