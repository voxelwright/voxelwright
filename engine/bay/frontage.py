"""Sample one explicitly selected street frontage from Mapillary. No city enumeration."""

import argparse
import json
import math
import struct
import time
import urllib.error
import urllib.request
from pathlib import Path

import mapbox_vector_tile
import numpy as np
from bake import palette
from earth import Frame
from PIL import Image
from tiles import read


def fetch(url, auth=None):
    headers = {"User-Agent": "village-engine"}
    if auth:
        headers["Authorization"] = "OAuth " + auth
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=45) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}") from None
    except OSError:
        raise RuntimeError("connection failed") from None


def rotation(r):
    angle = np.linalg.norm(r)
    if angle == 0:
        return np.eye(3)
    x, y, z = r / angle
    cross = np.array([[0, -z, y], [z, 0, -x], [-y, x, 0]])
    return np.eye(3) + math.sin(angle) * cross + (1 - math.cos(angle)) * (cross @ cross)


def cameras_near(x, z, directory, stats):
    """Use the supported image-point tile for this one place, then four nearby panoramas."""
    frame = Frame("10n4250")
    lon, lat = frame.lonlat(x, z)
    fx = (lon + 180) / 360 * 16384
    fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) * 8192
    tx, ty = math.floor(fx), math.floor(fy)
    directory.mkdir(parents=True, exist_ok=True)
    token = (Path.home() / ".village/engine/bay/keys/mapillary.token").read_text().strip()
    tile = directory.parent / f"images-14-{tx}-{ty}.mvt"
    if not tile.exists():
        stats["api"] += 1
        raw = fetch(f"https://tiles.mapillary.com/maps/vtp/mly1_public/2/14/{tx}/{ty}?access_token=" + token)
        stats["bytes"] += len(raw)
        scratch = tile.with_suffix(".part")
        scratch.write_bytes(raw)
        scratch.replace(tile)
    layer = mapbox_vector_tile.decode(tile.read_bytes())["image"]
    extent = layer["extent"]
    u, v = (fx - tx) * extent, (1 - fy + ty) * extent
    near = []
    for f in layer["features"]:
        props = f["properties"]
        a, b = f["geometry"]["coordinates"]
        d = math.hypot(a - u, b - v)
        # 44 m search radius in this zoom-14 SF tile.
        if props.get("is_pano") and d * 1930 / extent < 44:
            near.append((d, -props["captured_at"], int(props["id"]), a, b))
    cameras, positions = [], []
    for _, __, id_, a, b in sorted(near):
        if any(math.hypot(a - i, b - j) * 1930 / extent < 6 for i, j in positions):
            continue
        if len(positions) >= 8:
            break
        positions.append((a, b))
        stats["api"] += 1
        raw = fetch(
            f"https://graph.mapillary.com/{id_}?fields=id,computed_geometry,computed_rotation,computed_altitude,camera_type,captured_at,thumb_2048_url",
            token,
        )
        stats["bytes"] += len(raw)
        photo = json.loads(raw)
        if (
            not photo.get("computed_rotation")
            or not photo.get("computed_geometry")
            or not photo.get("thumb_2048_url")
        ):
            continue
        stats["images"] += 1
        raw = fetch(photo.pop("thumb_2048_url"))
        stats["bytes"] += len(raw)
        (directory / f"{id_}.jpg").write_bytes(raw)
        cameras.append(photo)
        if len(cameras) >= 4 or len(positions) >= 8:
            break
    scratch = directory / "cameras.part"
    scratch.write_text(json.dumps(cameras))
    scratch.replace(directory / "cameras.json")
    return cameras


def sample(p, x, z, stats, directory):
    frame = Frame("10n4250")
    cameras = []
    catalog = directory / "cameras.json"
    photos = json.loads(catalog.read_text()) if catalog.exists() else cameras_near(x, z, directory, stats)
    for photo in photos:
        if photo.get("camera_type") != "spherical" or not all(
            photo.get(k) for k in ("computed_rotation", "computed_geometry")
        ):
            continue
        a, b = frame.cells(np.array([photo["computed_geometry"]["coordinates"]]))[0]
        j, i = round((b - p["gz0"]) / 10), round((a - p["gx0"]) / 10)
        if not (0 <= i < p["gw"] and 0 <= j < p["gw"]):
            continue
        img = np.asarray(Image.open(directory / f"{photo['id']}.jpg").convert("RGB"))
        cameras.append(
            (
                a,
                b,
                int(p["ground"][j, i]) + 25,
                rotation(np.array(photo["computed_rotation"])),
                img,
                photo["id"],
            )
        )
        if len(cameras) == 4:
            break

    # Sample a low band of each visible, nearly head-on front. Require two camera
    # medians to agree before replacing the building's one procedural wall tint.
    out = {}
    table = palette() * 255
    for verts, row in p["buildings"]:
        start = 0
        for k, (ax, az, flags) in enumerate(verts):
            bx, bz, _ = verts[start if flags & 4 or k + 1 == len(verts) else k + 1]
            if flags & 4:
                start = k + 1
            mx, mz = (ax + bx) / 2, (az + bz) / 2
            length = math.hypot(bx - ax, bz - az)
            if length < 35 or math.hypot(mx - x, mz - z) > 800:
                continue
            colours, ids = [], []
            for a, b, h, R, img, id_ in cameras:
                far = math.hypot(mx - a, mz - b)
                if (
                    far < 30
                    or far > 500
                    or abs((mx - a) * (bx - ax) + (mz - b) * (bz - az)) > 0.65 * length * far
                ):
                    continue
                t = np.linspace(0, 1, max(2, int(far / 5)))
                t = t[t < 0.84]
                ii = ((a + t * (mx - a) - p["tx0"]) / 5).astype(int)
                jj = ((b + t * (mz - b) - p["tz0"]) / 5).astype(int)
                if not ((ii >= 0) & (jj >= 0) & (ii < p["tw"]) & (jj < p["tw"])).all():
                    continue
                blocked = (p["top"][jj, ii] > h + t * (row[-1] + 30 - h)) & ((p["class"][jj, ii] & 8) == 0)
                if blocked.any():
                    continue
                pts = (
                    np.array(
                        [
                            [(ax + u * (bx - ax) - a), -(az + u * (bz - az) - b), row[-1] + dy - h]
                            for u in np.linspace(0.2, 0.8, 12)
                            for dy in (24, 30, 36, 42)
                        ]
                    )
                    @ R.T
                )
                u = (np.arctan2(pts[:, 0], pts[:, 2]) / (2 * np.pi) + 0.5) % 1
                v = 0.5 + np.arctan2(pts[:, 1], np.hypot(pts[:, 0], pts[:, 2])) / np.pi
                rgb = img[
                    np.clip((v * img.shape[0]).astype(int), 0, img.shape[0] - 1),
                    (u * img.shape[1]).astype(int),
                ].astype(float)
                rgb = rgb[
                    (rgb.mean(1) > 40)
                    & (rgb.mean(1) < 230)
                    & (rgb[:, 1] < 1.12 * np.maximum(rgb[:, 0], rgb[:, 2]))
                ]
                if len(rgb) < 24:
                    continue
                colour = np.percentile(rgb, 60, axis=0)
                for prev, camera in zip(colours, ids):
                    if camera != id_ and np.linalg.norm(colour - prev) < 30:
                        tint = int(np.argmin(((table[1:] - (colour + prev) / 2) ** 2).sum(1))) + 1
                        out[f"{verts[0][0]},{verts[0][1]}"] = {"tint": tint, "images": [camera, id_]}
                        break
                colours.append(colour)
                ids.append(id_)
    return out


def apply(pack, output, observations):
    data = bytearray(pack.read_bytes())
    h = struct.unpack_from("<16i", data)
    rows = 64 + 2 * h[5] ** 2 + 4 * h[9] ** 2
    for i in range(h[12]):
        at = rows + 24 * i
        first, _, wall = struct.unpack_from("<iii", data, at)
        x, z = struct.unpack_from("<ii", data, rows + 24 * h[12] + 12 * first)
        match = observations.get(f"{x},{z}")
        if match:
            struct.pack_into("<i", data, at + 8, (wall & 255) | match["tint"] << 8)
    tmp = output.with_suffix(".part")
    tmp.write_bytes(data)
    tmp.replace(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack", type=Path)
    parser.add_argument("x", type=int, help="frame metres east")
    parser.add_argument("z", type=int, help="frame metres south")
    parser.add_argument("observations", type=Path)
    args = parser.parse_args()
    stats = {"api": 0, "images": 0, "bytes": 0}
    started = time.monotonic()
    try:
        colours = sample(
            read(args.pack), args.x * 10, args.z * 10, stats, args.observations.with_suffix(".photos")
        )
        args.observations.write_text(json.dumps(colours, indent=2) + "\n")
        print(len(colours), "building tints")
    finally:
        print(stats, round(time.monotonic() - started, 2), "seconds")
