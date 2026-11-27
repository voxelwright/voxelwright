"""Check surveyed park shores and islands in the near tiles and the distant faces of a staged release."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bay"))
from mapped_water import WATER_RGB, garden_survey

# Points inside the mapped shapes, in world cells. The island is well inside the inner ring.
SAMPLES = [
    ("Waterfowl Pond", 466868, 697562, True), ("Waterfowl island", 466973, 697440, False),
    ("Moon Viewing pool", 465338, 698181, True), ("Anelli Pond", 468468, 699442, True),
    ("Dwarf Conifer Pond", 468047, 699572, True), ("Bamboo Pond", 468040, 699928, True),
    ("Tea Garden pond", 466815, 695777, True),
    ("Palace lagoon", 486323, 658889, True), ("Palace north island", 486245, 658085, False),
    ("Palace south island", 486063, 658189, False),
]


# Two locations at least 2.8 m inside each observed shoreline. Check all four near
# heights used for interpolation and the top of the shipped FAR1 ground face.
POND_INTERIORS = {
    "-2792384": [(466702, 697561), (467032, 697361)],
    "388991375": [(467999, 699560), (468079, 699580)],
    "388991378": [(467995, 699951), (468085, 699931)],
    "409163924": [(466765, 695733), (466835, 695813)],
    "1062189335": [(468435, 699425), (468475, 699445)],
    "1064989905": [(465298, 698161), (465358, 698161)],
}


def near_surface(blob, x, z):
    h = struct.unpack_from("<16i", blob)
    if blob[:4] != b"BAY1" or h[8] != 5:
        raise ValueError("expected a half-metre BAY1 surface")
    i, j = (x - h[10]) // h[8], (z - h[11]) // h[8]
    if not (0 <= i < h[9] and 0 <= j < h[9]):
        raise ValueError("sample outside near tile")
    offset = 64 + 2 * (h[5]**2 + h[9]**2)
    wet = blob[offset + j * h[9] + i] & 7 == 5
    col, row = (x - h[6]) // h[4], (z - h[7]) // h[4]
    if not (0 <= row < h[5] - 1 and 0 <= col < h[5] - 1):
        raise ValueError("sample outside near height grid")
    heights = np.frombuffer(blob, "<i2", h[5] ** 2, 64).reshape(h[5], h[5])
    return wet, set(heights[row:row+2, col:col+2].ravel().tolist())


def ground_faces(blob, x, z):
    if blob[:4] != b"FAR1":
        raise ValueError("invalid distant tile")
    length = struct.unpack_from("<I", blob, 4)[0]
    head = json.loads(blob[8:8 + length])
    data = np.frombuffer(blob, "u1", offset=8 + length)
    if head.get("grouped"):
        data = data.reshape(20, -1).T.copy()
    words = data.view("<u4").reshape(-1, 5)
    for section in head["sections"]:
        if not section["layer"].startswith("ground"):
            continue
        dx, dz = x - section["pos"][0], z - section["pos"][2]
        u, w = ((dx * section[axis][0] + dz * section[axis][2]) / section["cell"] for axis in ("c0", "c2"))
        start = section["start"]
        a, b, c, rgb, _ = words[start:start + section["count"]].T
        us, ws = a & 2047, (a >> 11) & 2047
        covers = (((c >> 10) & 3) == 0) & (us <= u) & (u < us + (a >> 22)) & (ws <= w) & (w < ws + (c & 1023))
        yield from zip((rgb[covers] & 0xffffff).tolist(), (section["pos"][1] + (b[covers] >> 16)).tolist())


def check(path):
    manifest = json.loads(path.read_text())
    cache = {}

    def load(record):
        name = record["path"]
        if name not in cache:
            blob = (path.parent / name).read_bytes()
            if len(blob) != record["bytes"] or hashlib.sha256(blob).hexdigest() != record["sha256"]:
                raise ValueError(f"release object failed verification: {name}")
            cache[name] = blob
        return cache[name]

    failures = []
    samples = [(name, x, z, wet, None) for name, x, z, wet in SAMPLES]
    surveyed = garden_survey()["levels"]
    for osm_id, points in POND_INTERIORS.items():
        samples.extend((osm_id, x, z, True, surveyed[osm_id]) for x, z in points)
    for name, x, z, wet, elevation in samples:
        level = manifest["levels"][0]
        size = level["size"]
        near, heights = near_surface(load(level["tiles"][f"{x // size}_{z // size}"]), x, z)
        far = manifest["far"]
        key = f"{x // far['size']}_{z // far['size']}"
        faces = {face for band in far["tiles"][key] if band for face in ground_faces(load(band), x, z)}
        colours = {colour for colour, _ in faces}
        if elevation is not None:
            expected_near = round((elevation - 1) * 10)
            expected_far = round(elevation - 1) * 10
            drawn = {y for colour, y in faces if colour == WATER_RGB}
            if heights != {expected_near} or drawn != {expected_far}:
                failures.append(f"{name} at ({x}, {z}): surveyed {elevation} m NAVD88, near {heights} vs {expected_near}, far {drawn} vs {expected_far} in 10 cm cells")
        if near != wet or not colours or any((c == WATER_RGB) != wet for c in colours):
            failures.append(f"{name}: expected {'water' if wet else 'land'}, near water={near}, far ground={sorted(colours)}")
    if failures:
        raise SystemExit("\n".join(failures))
    print(f"Verified {len(SAMPLES)} shore and island samples and {len(samples)-len(SAMPLES)} pond elevations in near and distant release objects")


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("manifest", type=Path)
    check(cli.parse_args().manifest)
