"""Check garden shores and an island in the near tiles and the distant faces of a staged release."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bay"))
from mapped_water import WATER_RGB

# Points inside the mapped shapes, in world cells. The island is well inside the inner ring.
SAMPLES = [
    ("Waterfowl Pond", 466868, 697562, True), ("Waterfowl island", 466973, 697440, False),
    ("Moon Viewing pool", 465338, 698181, True), ("Anelli Pond", 468468, 699442, True),
    ("Dwarf Conifer Pond", 468047, 699572, True), ("Bamboo Pond", 468040, 699928, True),
    ("Tea Garden pond", 466815, 695777, True),
]


def near_water(blob, x, z):
    h = struct.unpack_from("<16i", blob)
    if blob[:4] != b"BAY1" or h[8] != 5:
        raise ValueError("expected a half-metre BAY1 surface")
    i, j = (x - h[10]) // h[8], (z - h[11]) // h[8]
    if not (0 <= i < h[9] and 0 <= j < h[9]):
        raise ValueError("sample outside near tile")
    offset = 64 + 2 * (h[5]**2 + h[9]**2)
    return blob[offset + j * h[9] + i] & 7 == 5


def ground_colours(blob, x, z):
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
        a, _, c, rgb, _ = words[start:start + section["count"]].T
        us, ws = a & 2047, (a >> 11) & 2047
        covers = (((c >> 10) & 3) == 0) & (us <= u) & (u < us + (a >> 22)) & (ws <= w) & (w < ws + (c & 1023))
        yield from (rgb[covers] & 0xffffff).tolist()


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
    for name, x, z, wet in SAMPLES:
        level = manifest["levels"][0]
        size = level["size"]
        near = near_water(load(level["tiles"][f"{x // size}_{z // size}"]), x, z)
        far = manifest["far"]
        key = f"{x // far['size']}_{z // far['size']}"
        colours = {c for band in far["tiles"][key] if band for c in ground_colours(load(band), x, z)}
        if near != wet or not colours or any((c == WATER_RGB) != wet for c in colours):
            failures.append(f"{name}: expected {'water' if wet else 'land'}, near water={near}, far ground={sorted(colours)}")
    if failures:
        raise SystemExit("\n".join(failures))
    print(f"Verified {len(SAMPLES)} garden water and island samples in both terrain representations")


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("manifest", type=Path)
    check(cli.parse_args().manifest)
