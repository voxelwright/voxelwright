"""Keep geographically distributed, solved street panoramas with bounded image storage."""

import io
import json
import math
from pathlib import Path

import mapbox_vector_tile
from PIL import Image
from pyproj import Transformer

from frontage import fetch

TO_LL = Transformer.from_crs(26910, 4326, always_xy=True)
TO_UTM = Transformer.from_crs(4326, 26910, always_xy=True)


def acquire(raw):
    folder = raw / "photos"
    folder.mkdir(exist_ok=True, parents=True)
    index = folder / "cameras.json"
    if index.exists():
        return [(p, folder) for p in json.loads(index.read_text())]
    token = (
        (Path.home() / ".village/engine/bay/keys/mapillary.token").read_text().strip()
    )
    west, south = (float(v) * 1000 for v in raw.name.split("_"))
    corners = [
        TO_LL.transform(west + i, south + j) for i in (0, 1000) for j in (0, 1000)
    ]
    tiles = [
        (
            int((x + 180) / 360 * 16384),
            int((1 - math.asinh(math.tan(math.radians(y))) / math.pi) * 8192),
        )
        for x, y in corners
    ]
    samples = {}
    for tx in range(min(i for i, j in tiles), max(i for i, j in tiles) + 1):
        for ty in range(min(j for i, j in tiles), max(j for i, j in tiles) + 1):
            tile = raw.parent / f"images-{tx}-{ty}.mvt"
            if not tile.exists():
                data = fetch(
                    f"https://tiles.mapillary.com/maps/vtp/mly1_public/2/14/{tx}/{ty}?access_token="
                    + token
                )
                tile.with_suffix(".part").write_bytes(data)
                tile.with_suffix(".part").replace(tile)
            layer = mapbox_vector_tile.decode(tile.read_bytes()).get("image", {})
            for f in layer.get("features", []):
                p = f["properties"]
                if not p.get("is_pano"):
                    continue
                a, b = f["geometry"]["coordinates"]
                fx, fy = tx + a / layer["extent"], ty + 1 - b / layer["extent"]
                lon = fx / 16384 * 360 - 180
                lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * fy / 16384))))
                e, n = TO_UTM.transform(lon, lat)
                if west <= e < west + 1000 and south <= n < south + 1000:
                    cell = int((e - west) // 100), int((n - south) // 100)
                    candidate = (p["captured_at"], str(p["id"]))
                    samples[cell] = max(candidate, samples.get(cell, candidate))
    catalog = []
    for _, id_ in sorted(samples.values()):
        meta = folder / (id_ + ".json")
        if not meta.exists():
            p = json.loads(
                fetch(
                    f"https://graph.mapillary.com/{id_}?fields=id,computed_geometry,computed_rotation,captured_at,camera_type,thumb_1024_url",
                    token,
                )
            )
            url = p.pop("thumb_1024_url", None)
            if (
                url
                and p.get("computed_rotation")
                and p.get("computed_geometry")
                and p.get("camera_type") == "spherical"
            ):
                image = Image.open(io.BytesIO(fetch(url))).convert("RGB")
                image.thumbnail((1024, 512))
                image.save(folder / (id_ + ".jpg"), quality=83)
            else:
                p = None
            meta.with_suffix(".part").write_text(json.dumps(p))
            meta.with_suffix(".part").replace(meta)
        p = json.loads(meta.read_text())
        if p:
            catalog.append(p)
    index.with_suffix(".part").write_text(json.dumps(catalog))
    index.with_suffix(".part").replace(index)
    return [(p, folder) for p in catalog]
