"""Place a lidar crown's trunk at its surveyed DataSF location where they agree."""

import json
import math
import struct
from collections import defaultdict

import numpy as np
from pyproj import Transformer


def align(pack, inventory):
    data = bytearray(pack.read_bytes())
    h = struct.unpack_from("<16i", data)
    start = 64 + 2 * h[5] ** 2 + 4 * h[9] ** 2 + 24 * h[12] + 12 * h[13]
    rows = np.frombuffer(data, "<i4", 4 * h[14], start).reshape(-1, 4)
    canopy = np.frombuffer(data, "u1", h[9] ** 2, 64 + 2 * h[5] ** 2 + 2 * h[9] ** 2).reshape(h[9], h[9])
    bins = defaultdict(list)
    for i, (x, z, *_) in enumerate(rows.tolist()):
        bins[x // 40, z // 40].append(i)
    utm = Transformer.from_crs(4326, 26910, always_xy=True)
    candidates = []
    for feature in json.loads(inventory.read_text())["features"]:
        p = feature["properties"]
        if str(p.get("planttype", "")).lower() != "tree" or not p.get("longitude") or not p.get("latitude"):
            continue
        e, n = utm.transform(float(p["longitude"]), float(p["latitude"]))
        x, z = round((e - 500000) * 10), round((4250000 - n) * 10)
        j, i = (z - h[11]) // 5, (x - h[10]) // 5
        if not (0 <= i < h[9] and 0 <= j < h[9] and canopy[j, i] & 8):
            continue
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for idx in bins[x // 40 + dx, z // 40 + dz]:
                    distance = math.hypot(rows[idx, 0] - x, rows[idx, 1] - z)
                    if distance <= 35:
                        candidates.append((distance, idx, x, z))
    used, sites = set(), set()
    for _, idx, x, z in sorted(candidates):
        if idx not in used and (x, z) not in sites:
            rows[idx, :2] = x, z
            used.add(idx)
            sites.add((x, z))
    tmp = pack.with_suffix(".part")
    tmp.write_bytes(data)
    tmp.replace(pack)
    return len(used)
