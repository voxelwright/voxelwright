"""Sample a landmark roof from a retained SF lidar square in the landmark's own metre frame."""

import argparse
import json
import math
from pathlib import Path
import subprocess
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
    cli.add_argument("--u", type=float, nargs=2, required=True, metavar=("FIRST", "LAST"))
    cli.add_argument("--w", type=float, nargs=2, required=True, metavar=("FIRST", "LAST"))
    cli.add_argument("--spacing", type=float, required=True)
    cli.add_argument("--compare-core", type=Path, help="compare a compiled landmark's roof to this survey grid")
    cli.add_argument("--max-p90", type=float, help="fail if the 90th percentile absolute error exceeds these metres")
    args = cli.parse_args()
    if not math.isfinite(args.spacing) or args.spacing <= 0:
        cli.error("grid spacing must be finite and positive")
    if args.max_p90 is not None and (not args.compare_core or not math.isfinite(args.max_p90) or args.max_p90 < 0):
        cli.error("--max-p90 requires a compiled core and a finite, non-negative tolerance")
    def axis(a, b):
        count = (b - a) / args.spacing
        if not math.isfinite(count) or count < 0 or not math.isclose(count, round(count), abs_tol=1e-8):
            cli.error("grid bounds must span whole positive steps")
        return [a + i * args.spacing for i in range(round(count) + 1)]

    registry = Path(__file__).resolve().parents[1] / "sf" / "heroes.json"
    landmark = next((h for h in json.loads(registry.read_text()) if h["name"] == args.landmark), None)
    if landmark is None:
        cli.error(f"unknown landmark: {args.landmark}")
    us, ws = (axis(a, b) for a, b in (args.u, args.w))
    if args.compare_core:
        step = landmark.get("step", 8)
        cell = step / 10
        # Probe the same cell centre in the survey and the model.
        us, ws = ([(math.floor(v / cell) + 0.5) * cell for v in coords] for coords in (us, ws))
        query = dict(wasm=str(args.compare_core), sort=landmark["sort"], step=step, us=us, ws=ws)
        result = subprocess.run(["node", registry.with_name("roof-profile.mjs")], input=json.dumps(query),
                                capture_output=True, text=True)
        if result.returncode:
            raise SystemExit(result.stderr)
        model = np.asarray(json.loads(result.stdout), dtype=float)
        # A missing face is a defect in a selected solid roof patch. Count it even when every other point agrees.
        missing = np.argwhere(~np.isfinite(model))
        if len(missing):
            j, i = missing[0]
            raise SystemExit(f"{len(missing)} of {model.size} roof samples have no upward face, first at {us[i]:g}, {ws[j]:g}")
        measured = np.asarray(list(sample(args.square, landmark, us, ws))) * 0.1
        median, p90 = np.percentile(abs(model - measured), [50, 90])
        print(f"{landmark['name']}, {model.size} surveyed roof samples, median error {median:.2f} m, p90 {p90:.2f} m")
        raise SystemExit(int(args.max_p90 is not None and p90 > args.max_p90))
    for row in sample(args.square, landmark, us, ws):
        print("    [" + ", ".join(map(str, row)) + "],")
