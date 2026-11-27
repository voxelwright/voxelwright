"""Rebuild sf-squares.json from DataSF land and the SF project's EPT hierarchy."""

import hashlib
import json
import math
import subprocess
from pathlib import Path
from urllib.request import Request, urlopen

from pyproj import Transformer
from shapely.geometry import box, shape
from shapely.ops import transform, unary_union

SHORE = "https://data.sf.gov/resource/txuc-3kzm.geojson"
EPT = "https://usgs-lidar-public.s3.amazonaws.com/CA_SanFrancisco_1_B23"
FRAME_E, FRAME_N = 500000, 4250000
RADIUS = (500, 4000, 16000)  # desktop clip boxes, in metres


def get(url):
    with urlopen(Request(url, headers={"User-Agent": "village-engine"}), timeout=90) as r:
        return r.read()


def build():
    shore = get(SHORE)
    to_utm = Transformer.from_crs(4326, 26910, always_xy=True).transform
    land = unary_union([transform(to_utm, shape(f["geometry"])) for f in json.loads(shore)["features"]])
    hierarchy = get(EPT + "/ept-hierarchy/0-0-0-0.json")
    bounds = json.loads(get(EPT + "/ept.json"))["bounds"]
    step = (bounds[3] - bounds[0]) / 64
    cells = {tuple(map(int, key.split("-")[1:3])) for key in json.loads(hierarchy) if key.startswith("6-")}
    projected = unary_union(
        [
            box(
                bounds[0] + x * step,
                bounds[1] + y * step,
                bounds[0] + (x + 1) * step,
                bounds[1] + (y + 1) * step,
            )
            for x, y in cells
        ]
    )
    covered = transform(Transformer.from_crs(3857, 26910, always_xy=True).transform, projected)
    rows = {}
    for poly in land.geoms:
        w, s, e, n = poly.bounds
        for i in range(math.floor((w - 700) / 1000), math.floor((e - 700) / 1000) + 1):
            for j in range(math.floor((s - 500) / 1000), math.floor((n - 500) / 1000) + 1):
                x, y = i * 1000 + 700, j * 1000 + 500
                tile = box(x, y, x + 1000, y + 1000)
                if poly.intersects(tile):
                    rows[f"{i}.7_{j}.5"] = land.intersection(tile).intersects(covered)
    inventory = {
        "shore": SHORE,
        "shore_sha256": hashlib.sha256(shore).hexdigest(),
        "hierarchy_sha256": hashlib.sha256(hierarchy).hexdigest(),
        "lidar": sorted(k for k, v in rows.items() if v),
        "planet": sorted(k for k, v in rows.items() if not v),
    }
    inventory["landmarkExtras"] = landmark_extras(inventory)
    return inventory


def bounds(name):
    e, n = (round(float(v) * 1000) for v in name.split("_"))
    return e - FRAME_E, FRAME_N - n - 1000, e - FRAME_E + 1000, FRAME_N - n


def tile_keys(name, radii):
    w, n, e, s = bounds(name)
    for level, (size, radius) in enumerate(zip((250, 1000, 4000), radii)):
        for x in range((w - radius) // size, (e + radius - 1) // size + 1):
            for z in range((n - radius) // size, (s + radius - 1) // size + 1):
                yield level, x, z


def landmark_extras(inventory):
    """Planet tiles that the landmark walk-ups need beyond the county bake."""
    planner = Path(__file__).resolve().parents[1] / "sf" / "landmark-tiles.mjs"
    wanted = json.loads(subprocess.check_output(["node", planner, "--json"]))
    county = {key for square in inventory["lidar"] + inventory["planet"] for key in tile_keys(square, RADIUS)}
    return [f"{level}/{x}_{z}" for level, x, z in sorted(set(map(tuple, wanted)) - county)]


if __name__ == "__main__":
    Path(__file__).with_name("sf-squares.json").write_text(json.dumps(build(), indent=2) + "\n")
