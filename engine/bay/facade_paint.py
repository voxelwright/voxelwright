"""Project independent solved panoramas onto surveyed wall cells. Unseen cells stay procedural."""

import argparse
import json
import math
import struct
import time
from functools import lru_cache
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

import numpy as np
from PIL import Image

from bake import palette
from frontage import rotation
from paint_cameras import xy
from tiles import read

STEP = 3  # one indexed colour per 30 cm square of wall
RADIUS = 90  # metres, around a single fixed survey centre


def edges(vertices):
    start = 0
    for i, (x, z, flags) in enumerate(vertices):
        last = (flags & 4) or i + 1 == len(vertices)
        a, b, _ = vertices[start if last else i + 1]
        if last:
            start = i + 1
        yield i, (x, z, a, b), flags


def pixels(img, rays):
    u = (np.arctan2(rays[:, 0], rays[:, 2]) / (2 * np.pi) + 0.5) % 1
    v = 0.5 + np.arctan2(rays[:, 1], np.hypot(rays[:, 0], rays[:, 2])) / np.pi
    return img[
        (v * img.shape[0]).astype(int).clip(0, img.shape[0] - 1),
        (u * img.shape[1]).astype(int),
    ].astype("f4")


def exposure(pack, x, z, eye, rot, img):
    """Use bare asphalt seen in both surveys as a local daylight grey reference."""
    a = np.arange(-120, 121, 10)
    dx, dz = (v.ravel() for v in np.meshgrid(a, a))
    i = ((x + dx - pack["tx0"]) / 5).astype(int)
    j = ((z + dz - pack["tz0"]) / 5).astype(int)
    valid = (
        (np.hypot(dx, dz) > 48)
        & (np.hypot(dx, dz) < 120)
        & (i >= 0)
        & (j >= 0)
        & (i < pack["tw"])
        & (j < pack["tw"])
    )
    dx, dz, i, j = (v[valid] for v in (dx, dz, i, j))
    grey = pack["tint"][j, i]
    valid = (pack["class"][j, i] == 128) & (grey > 0) & (grey <= 15)
    dx, dz, grey = (v[valid] for v in (dx, dz, grey))
    gi = np.rint((x + dx - pack["gx0"]) / 10).astype(int).clip(0, pack["gw"] - 1)
    gj = np.rint((z + dz - pack["gz0"]) / 10).astype(int).clip(0, pack["gw"] - 1)
    rgb = pixels(img, np.column_stack((dx, -dz, pack["ground"][gj, gi] - eye)) @ rot.T)
    neutral = (rgb.max(1) - rgb.min(1) < 40) & (rgb.mean(1) > 24) & (rgb.mean(1) < 210)
    if neutral.sum() < 18:
        return 1.0
    observed = rgb[neutral].mean(1)
    daylight = (0.86 - (grey[neutral].astype("f4") - 1) * 0.8 / 14) * 255
    return float(np.clip(np.median(daylight / observed), 0.92, 2.0))


@lru_cache(maxsize=1)
def colour_lookup():
    table = (palette()[1:] * 255).astype("f4")
    axis = np.arange(32) * 8 + 4
    buckets = np.stack(np.meshgrid(axis, axis, axis, indexing="ij"), axis=-1).astype(
        "f4"
    )
    return np.array(
        [1 + ((slab[:, :, None, :] - table) ** 2).sum(3).argmin(2) for slab in buckets],
        dtype="u1",
    )


def project(pack, catalog, center, photos=None, radius=RADIUS):
    began = time.monotonic()
    p = read(pack)
    lut = colour_lookup()
    cameras = []
    excluded = {
        r["image"]
        for r in json.loads(Path(__file__).with_name("neighbourhoods.json").read_text())
    }
    used = set()
    for meta in json.loads(catalog.read_text()):
        ident = str(meta["id"])
        if ident in excluded or ident in used:
            raise ValueError("duplicate camera or reserved panel reference")
        used.add(ident)
        if meta.get("camera_type") != "spherical":
            continue
        x, z = np.array(xy(meta)) * 10
        i, j = np.rint([(x - p["gx0"]) / 10, (z - p["gz0"]) / 10]).astype(int)
        if not (0 <= i < p["gw"] and 0 <= j < p["gw"]):
            continue
        with Image.open((photos or catalog.parent) / (str(meta["id"]) + ".jpg")) as img:
            rgb = np.array(img.convert("RGB"))
        eye = int(p["ground"][j, i]) + 25
        rot = rotation(np.array(meta["computed_rotation"]))
        cameras.append((x, z, eye, rot, rgb, exposure(p, x, z, eye, rot, rgb)))
    # If the median camera saturates the calibration range, the road is in
    # deeper shade than the facades. Its exposure cannot calibrate this block.
    measured_gain = float(np.median([v[-1] for v in cameras])) if cameras else None
    if measured_gain == 2.0:
        cameras = [(*v[:-1], 1.0) for v in cameras]
    painted = {}
    stats = dict(
        cameras=len(cameras), faces=0, buildings=0, texels=0, blended=0, eligible=0
    )
    cx, cz = np.asarray(center) * 10
    for verts, row in p["buildings"]:
        count = 0
        for _, key, flags in edges(verts):
            ax, az, bx, bz = key
            dx, dz = bx - ax, bz - az
            length = math.hypot(dx, dz)
            if length < 18 or length > 1500:
                continue
            nearest = np.clip(((cx - ax) * dx + (cz - az) * dz) / length**2, 0, 1)
            if math.hypot(ax + nearest * dx - cx, az + nearest * dz - cz) > radius * 10:
                continue
            cols = math.ceil(length / STEP)
            u = np.minimum(np.arange(cols) * STEP + STEP / 2, length - 0.1) / length
            x, z = ax + dx * u, az + dz * u
            # The surveyed eave falls back to the roof raster on legacy faces.
            eave = (flags >> 8) & 65535 if flags & 128 else 0
            if eave >= 32768:
                eave -= 65536
            if eave <= row[-1] + 15:
                ix = ((x - p["tx0"]) / 5).astype(int).clip(1, p["tw"] - 2)
                iz = ((z - p["tz0"]) / 5).astype(int).clip(1, p["tw"] - 2)
                heights = np.maximum.reduce(
                    [
                        p["top"][iz + j, ix + i]
                        for i, j in ((1, 0), (-1, 0), (0, 1), (0, -1), (0, 0))
                    ]
                )
                heights = heights[heights > row[-1] + 15]
                if not heights.size:
                    continue
                eave = np.median(heights)
            base = row[-1]
            h = math.ceil(min(eave - base, 380) / STEP)
            if h < 4:
                continue
            y = base + np.arange(h)[:, None] * STEP + STEP / 2
            total = np.zeros((h, cols, 3), "f4")
            weights = np.zeros((h, cols), "f4")
            observations = np.zeros((h, cols), "u1")
            views = []
            best = np.zeros((h, cols), "f4")
            guide = np.zeros_like(total)
            for a, b, eye, rot, img, gain in cameras:
                dist = np.hypot(x - a, z - b).clip(1)
                incidence = abs(dx * (b - az) - dz * (a - ax)) / (length * dist)
                allowed = (
                    (incidence > 0.47)
                    & (dist > 32)
                    & (dist < 720)
                    & (np.abs(x - cx) <= radius * 10)
                    & (np.abs(z - cz) <= radius * 10)
                )
                if not allowed.any():
                    continue
                # The highest elevation angle on each camera-to-wall ray masks both
                # intervening buildings and surveyed canopy. Stop at the face's near edge.
                t = np.linspace(
                    0.025, 0.985, max(3, math.ceil(dist[allowed].max() / 7))
                )[:, None]
                ii = ((a + (x - a) * t - p["tx0"]) / 5).astype(int)
                jj = ((b + (z - b) * t - p["tz0"]) / 5).astype(int)
                inside = (ii >= 0) & (jj >= 0) & (ii < p["tw"]) & (jj < p["tw"])
                top = p["top"][jj.clip(0, p["tw"] - 1), ii.clip(0, p["tw"] - 1)]
                obstacle = np.where(inside & ((1 - t) * dist > 14), top, -32768).astype(
                    "f4"
                )
                horizon = (eye + (obstacle - eye) / t).max(axis=0)
                visible = (y > horizon + 2) & allowed
                if not visible.any():
                    continue
                rr, cc = np.nonzero(visible)
                rays = np.column_stack((x[cc] - a, b - z[cc], y[rr, 0] - eye)) @ rot.T
                rgb = pixels(img, rays)
                r, g, blue = rgb.T
                sky = (blue > r * 1.28) & (blue > g * 1.10) & (blue > 120)
                leaves = (g > r * 1.16) & (g > blue * 1.28)
                valid = ~(sky | leaves) & (rgb.max(1) > 30)
                if not valid.any():
                    continue
                rr, cc, rgb = rr[valid], cc[valid], rgb[valid]
                # Prefer daylight on this face, not just the newest camera. Limit
                # the influence of distant, oblique and evening observations.
                daylight = np.clip((np.percentile(rgb.mean(1), 70) - 25) / 115, 0.12, 1)
                w = daylight**2 * incidence[cc] ** 3 / (1 + (dist[cc] / 185) ** 2)
                # The strongest frontal solve anchors small details. Colour disagreement
                # downweights displaced windows and transient objects in other views.
                rgb = np.clip(rgb * gain, 0, 255)
                take = w > best[rr, cc]
                best[rr[take], cc[take]] = w[take]
                guide[rr[take], cc[take]] = rgb[take]
                views.append((rr, cc, rgb, w))
            for rr, cc, rgb, w in views:
                difference = np.abs(rgb - guide[rr, cc]).mean(1)
                weight = w / (1 + (difference / 30) ** 2) ** 2
                total[rr, cc] += rgb * weight[:, None]
                weights[rr, cc] += weight
                observations[rr, cc] += weight >= 0.2 * best[rr, cc]
            seen = weights > 0.025
            if seen.sum() < 12:
                continue
            rgb = total[seen] / weights[seen, None]
            colors = np.zeros((h, cols), "u1")
            colors[seen] = lut[tuple((rgb.clip(0, 255).astype("u1") // 8).T)]
            painted[key] = (base, colors)
            count += 1
            stats["texels"] += int(seen.sum())
            stats["blended"] += int(((observations >= 2) & seen).sum())
            stats["eligible"] += int(seen.size)
        stats["buildings"] += int(count > 0)
        stats["faces"] += count
    stats["measuredExposure"] = measured_gain
    stats["medianExposure"] = (
        round(float(np.median([v[-1] for v in cameras])), 3) if cameras else None
    )
    stats["seconds"] = round(time.monotonic() - began, 2)
    return painted, stats


def write_faces(path, faces):
    # Endpoints survive recutting and sorting. Store each observed face once offline.
    tmp = path.with_suffix(".part")
    with ZipFile(tmp, "w", compression=ZIP_DEFLATED) as f:
        for key, (base, grid) in sorted(faces.items()):
            info = ZipInfo(",".join(map(str, key)))
            info.compress_type = ZIP_DEFLATED
            f.writestr(
                info,
                struct.pack("<iHH", base, grid.shape[1], grid.shape[0])
                + grid.tobytes(),
            )
    tmp.replace(path)


def load_faces(paths):
    faces = {}
    for path in paths:
        with ZipFile(path) as z:
            for name in z.namelist():
                key = tuple(map(int, name.split(",")))
                record = z.read(name)
                if key in faces and faces[key] != record:
                    raise ValueError(
                        f"overlapping paint surveys disagree on wall {key}"
                    )
                faces[key] = record
    return faces


class FaceLibrary:
    """Index compact wall IDs once. Only decompress records needed by the current tile."""

    def __init__(self, paths):
        self.owners = {}
        for path in paths:
            with ZipFile(path) as bundle:
                for name in bundle.namelist():
                    key = tuple(map(int, name.split(",")))
                    if key in self.owners:
                        raise ValueError(f"multiple owners for wall {key}")
                    self.owners[key] = path, name
        self.open_zip = lru_cache(maxsize=8)(ZipFile)

    def __bool__(self):
        return bool(self.owners)

    def __contains__(self, key):
        return key in self.owners

    def __getitem__(self, key):
        path, name = self.owners[key]
        return self.open_zip(path).read(name)


def chunk(rows, vertices, faces):
    parts = []
    for start, count, *_ in rows:
        for i, key, _ in edges(vertices[start : start + count]):
            if key in faces:
                parts.append(struct.pack("<I", start + i) + faces[key])
    return struct.pack("<4sI", b"SFPT", len(parts)) + b"".join(parts) if parts else b""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack", type=Path)
    parser.add_argument("catalog", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("center", type=float, nargs=2)
    args = parser.parse_args()
    faces, stats = project(args.pack, args.catalog, args.center)
    write_faces(args.output, faces)
    print(json.dumps(dict(stats, archiveBytes=args.output.stat().st_size)))


if __name__ == "__main__":
    main()
