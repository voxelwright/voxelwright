"""Reusable 1 km square inputs, including the observations used by the face bake."""

import io
import json
import sys
import zipfile
from pathlib import Path

import laspy
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer

from dem import PAD, ground_grid

BAY = Path.home() / ".village/engine/bay"
LAYERS = ("footprints", "streets", "curbs", "addresses", "trees", "landuse")
UTM = Transformer.from_crs(4326, 26910, always_xy=True)


def pilot_photos(name):
    folder = BAY / "pilot450/frontages" / (name + ".photos")
    if folder.exists():
        return [(p, folder) for p in json.loads((folder / "cameras.json").read_text())]
    west, south = [float(v) * 1000 for v in name.split("_")]
    root = BAY / "mly"
    photos = {}
    for listing in sorted([*root.glob("list-*.json"), *root.glob("lists/*.json")]):
        for p in json.loads(listing.read_text()).get("data", []):
            if not p.get("computed_geometry") or not p.get("computed_rotation"):
                continue
            e, n = UTM.transform(*p["computed_geometry"]["coordinates"][:2])
            if (
                west <= e < west + 1000
                and south <= n < south + 1000
                and (root / "img" / (p["id"] + ".jpg")).exists()
            ):
                photos[p["id"]] = (p, root / "img")
    extra = BAY / "450-photo-inputs" / name / "photos"
    if (extra / "cameras.json").exists():
        for p in json.loads((extra / "cameras.json").read_text()):
            photos.setdefault(p["id"], (p, extra))
    return list(photos.values())


def write(raw, dest, photos):
    e, n = [round(float(v) * 1000) for v in raw.name.split("_")]
    west, north = e - PAD, n + 1000 + PAD
    width = (1000 + 2 * PAD) * 4
    top = np.full(width**2, -np.inf, np.float32)
    count = np.zeros(width**2, np.uint32)
    multi = np.zeros_like(count)
    intensity = np.zeros(width**2, np.float64)
    project = Transformer.from_crs(3857, 26910, always_xy=True)
    for key, _ in json.loads((raw / "lidar/nodes.json").read_text()):
        las = laspy.read(raw / "lidar" / (key + ".laz"))
        ex, ny = project.transform(np.asarray(las.x), np.asarray(las.y))
        col = np.floor((ex - west) * 4).astype(int)
        row = np.floor((north - ny) * 4).astype(int)
        keep = (
            (col >= 0)
            & (row >= 0)
            & (col < width)
            & (row < width)
            & ~np.isin(las.classification, [7, 18])
        )
        at = row[keep] * width + col[keep]
        np.maximum.at(top, at, np.asarray(las.z)[keep])
        np.add.at(count, at, 1)
        np.add.at(multi, at, np.asarray(las.number_of_returns)[keep] > 1)
        np.add.at(intensity, at, np.asarray(las.intensity)[keep])
    seen = count > 0
    if not seen.any():
        raise ValueError(f"{raw.name} has no lidar returns")
    # Millimetres match the source precision. Keep holes explicit for future filters.
    top_mm = np.where(seen, np.rint(top * 1000), -2147483648).astype("<i4")
    bright = np.rint(intensity / np.maximum(count, 1)).astype("<u2")
    ids = Image.new("I", (width, width))
    draw = ImageDraw.Draw(ids)
    footprints = json.loads((raw / "footprints.geojson").read_text())["features"]
    for i, feature in enumerate(footprints, 1):
        g = feature["geometry"]
        for polygon in (
            g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        ):
            for j, ring in enumerate(polygon):
                projected = [UTM.transform(*v[:2]) for v in ring]
                draw.polygon(
                    [((x - west) * 4, (north - y) * 4) for x, y in projected],
                    fill=0 if j else i,
                )
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=3) as out:

        def array(key, data):
            buf = io.BytesIO()
            np.save(buf, data, allow_pickle=False)
            out.writestr(key + ".npy", buf.getvalue())

        array("ground", ground_grid(raw.parent, e, n, 1000))
        for key, data in (
            ("top_mm", top_mm),
            ("count", count),
            ("multi", multi),
            ("intensity", bright),
            ("footprint", np.asarray(ids)),
        ):
            array(key, data.reshape(width, width))
        out.writestr(
            "frame.json",
            json.dumps(
                {
                    "square": raw.name,
                    "crs": "EPSG:26910",
                    "west": west,
                    "north": north,
                    "step": 0.25,
                    "groundStep": 1,
                }
            ),
        )
        for key in LAYERS:
            out.write(raw / (key + ".geojson"), key + ".geojson")
        for key in ("naip.png", "naip-nir.png"):
            out.write(raw / key, key, compress_type=zipfile.ZIP_STORED)
        catalog = []
        for p, folder in photos:
            catalog.append(
                {
                    k: v
                    for k, v in p.items()
                    if k
                    in (
                        "id",
                        "computed_geometry",
                        "computed_rotation",
                        "computed_altitude",
                        "camera_type",
                        "captured_at",
                    )
                }
            )
            key = p["id"] + ".jpg"
            out.write(folder / key, "photos/" + key, compress_type=zipfile.ZIP_STORED)
        out.writestr("photos/cameras.json", json.dumps(catalog))
    with zipfile.ZipFile(tmp) as archive:
        if archive.testzip() is not None:
            raise ValueError("failed intermediate checksum")
    tmp.replace(dest)
    print(raw.name, dest.stat().st_size, len(photos), flush=True)


if __name__ == "__main__":
    from full_run import PILOT

    for name in PILOT:
        raw = BAY / "pilot450/raw" / name
        if not raw.exists():
            raw = BAY / "raw" / name
        write(raw, Path(sys.argv[1]) / (name + ".zip"), pilot_photos(name))


def restore(archive, raw):
    """Materialize only cell-bake inputs. Max-pool four quarter-metre observations."""
    raw.mkdir(exist_ok=True, parents=True)
    with zipfile.ZipFile(archive) as src:
        for key in [
            *(layer + ".geojson" for layer in LAYERS),
            "naip.png",
            "naip-nir.png",
            "ground.npy",
        ]:
            src.extract(key, raw)
        top = np.load(src.open("top_mm.npy"))
        w = top.shape[0] // 2
        coarse = top.reshape(w, 2, w, 2).max(axis=(1, 3))
        np.save(
            raw / "surface.npy",
            np.where(coarse == -2147483648, -1e9, coarse / 1000).astype(np.float32),
        )
