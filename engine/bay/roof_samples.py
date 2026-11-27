"""Sample a landmark roof from a retained SF lidar square in the landmark's own metre frame."""

import argparse
import json
import math
from pathlib import Path
import zipfile

import numpy as np
from pyproj import Transformer


def sample(square, landmark, us, ws):
    project = Transformer.from_crs(4326, 26910, always_xy=True)

    def position(latlon):
        lat, lon = latlon
        e, n = project.transform(lon, lat)
        return round(e, 1), round(n, 1)

    e, n = position(landmark["at"])
    et, nt = position(landmark["toward"])
    angle = math.atan2(n - nt, et - e)
    cos, sin = math.cos(angle), math.sin(angle)
    with zipfile.ZipFile(square) as source:
        frame = json.loads(source.read("frame.json"))
        step = frame["step"]
        heights = np.load(source.open("top_mm.npy"))
    radius = round(1 / step)
    for w in ws:
        row = []
        for u in us:
            col = math.floor((e + u * cos - w * sin - frame["west"]) / step)
            line = math.floor((frame["north"] - n + u * sin + w * cos) / step)
            if not (radius <= line < heights.shape[0] - radius and radius <= col < heights.shape[1] - radius):
                raise ValueError(f"sample outside the square at {u}, {w}")
            patch = heights[line-radius:line+radius+1, col-radius:col+radius+1]
            valid = patch[patch != np.iinfo(patch.dtype).min]
            if valid.size < patch.size // 2:
                raise ValueError(f"insufficient roof returns at {u}, {w}")
            # BAY1's vertical zero is one metre above NAVD88.
            row.append(round((float(np.median(valid)) / 1000 - 1 - landmark["foot"]) * 10))
        yield row


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("square", type=Path)
    cli.add_argument("landmark")
    cli.add_argument("--u", type=int, nargs=2, required=True, metavar=("FIRST", "LAST"))
    cli.add_argument("--w", type=int, nargs=2, required=True, metavar=("FIRST", "LAST"))
    cli.add_argument("--spacing", type=int, required=True)
    args = cli.parse_args()
    if args.spacing <= 0 or any(b < a or (b - a) % args.spacing for a, b in (args.u, args.w)):
        cli.error("grid bounds must span whole positive steps")
    registry = Path(__file__).resolve().parents[1] / "sf" / "heroes.json"
    landmark = next((h for h in json.loads(registry.read_text()) if h["name"] == args.landmark), None)
    if landmark is None:
        cli.error(f"unknown landmark: {args.landmark}")
    us, ws = (range(a, b + 1, args.spacing) for a, b in (args.u, args.w))
    for row in sample(args.square, landmark, us, ws):
        print("    [" + ", ".join(map(str, row)) + "],")
