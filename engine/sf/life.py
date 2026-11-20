"""Street life for the SF realm (#450): each square's street graph (sf/streets.md) cut down to what the page walks
and drives, with how busy each pavement is and where cars stand parked.

    ~/.village/engine/bay/venv/bin/python engine/sf/life.py [--graphs engine/sf/pilot-graph] [--inputs ~/.village/engine/bay/450-inputs] [--out engine/sf/pilot-life]

Writes `<square>.json` for every graph file, and `index.json` listing them with bytes and sha256 (the shape of a
release record, sf/release.md). A segment is written in the square its first point lies in, so the files share
nothing and the page joins them by node id. Positions are the release frame's 10 cm cells, as the graph has them.

A file holds:
  walk   [a, b, kind, busy, x0, z0, x1, z1, ...]   pavements and crossings. kind 0 pavement, 1 crossing, 2 steps,
                                                    3 path. busy 0 to 100: how many people a pavement draws, from the
                                                    land use within 60 m (shops, visitors, offices, homes)
  roads  [way, a, b, lanes, flags, next, x0, z0, ...]  directed carriageways. flags: 1 one-way, 2 lanes inferred,
                                                    4 minor (an alley, a place, unnamed). next: [way, end node, ...]
                                                    of the roads a car may turn onto at b
  park   [x, z, yaw, mapped, ...]                    parked-car places, yaw in hundredths of a radian (0 faces east,
                                                    a quarter turn faces south). mapped 1: on an OSM parking side;
                                                    0: inferred, 1.1 m inside a surveyed kerb, off junctions and
                                                    crossings, where the kerb leaves room for a lane and a car
  rail   [a, b, cable, x0, z0, ...]                   track centres; cable 1 where it runs in a cable car line's
                                                    street (Powell, Mason, Hyde, ...), 0 for a streetcar's
"""

import argparse
import hashlib
import json
import math
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ap = argparse.ArgumentParser()
ap.add_argument("--graphs", default=str(ROOT / "engine/sf/pilot-graph"))
ap.add_argument("--inputs", default=str(Path.home() / ".village/engine/bay/450-inputs"))
ap.add_argument("--out", default=str(ROOT / "engine/sf/pilot-life"))
args = ap.parse_args()

from pyproj import Transformer  # noqa: E402

UTM = Transformer.from_crs(4326, 26910, always_xy=True)
frame = lambda e, n: ((e - 500000) * 10, (4250000 - n) * 10)  # noqa: E731

graphs = {p.stem: json.loads(p.read_text()) for p in sorted(Path(args.graphs).glob("*.json"))}


def bounds(square):
    e, n = (float(v) * 1000 for v in square.split("_"))
    x0, z1 = frame(e, n)
    x1, z0 = frame(e + 1000, n + 1000)
    return x0, z0, x1, z1


def owns(square, p):
    x0, z0, x1, z1 = bounds(square)
    return x0 <= p[0] < x1 and z0 <= p[1] < z1


def owner(p):
    return next((s for s in graphs if owns(s, p)), None)


# ── How busy: land use within 60 m of a pavement ──
parcels = []
for square in graphs:
    zf = Path(args.inputs) / f"{square}.zip"
    if not zf.exists():
        print(f"no land use for {square}: its pavements are quiet", file=sys.stderr)
        continue
    for f in json.loads(zipfile.ZipFile(zf).read("landuse.geojson"))["features"]:
        p = f["properties"]
        num = lambda k: float(p.get(k) or 0) if str(p.get(k) or 0).replace(".", "", 1).isdigit() else 0.0  # noqa: E731
        lat, lon = p.get("centroid_l"), p.get("centroid_1")
        if lat is None or lon is None:
            continue
        x, z = frame(*UTM.transform(float(lon), float(lat)))
        # Square feet that bring people to the street, and homes as a quarter of a shop's draw each.
        draw = num("retail") + num("visitor") * 1.5 + num("cie") * 0.3 + num("mips") * 0.12 + num("med") * 0.3 + num("resunits") * 120
        if draw > 0:
            parcels.append((x, z, draw, p.get("mapblklot")))
parcels = list({(round(x), round(z), b): (x, z, d) for x, z, d, b in parcels}.values())
CELL = 600
grid = defaultdict(list)
for x, z, d in parcels:
    grid[(int(x // CELL), int(z // CELL))].append((x, z, d))


def draw_near(x, z):
    s = 0.0
    for gx in range(int(x // CELL) - 1, int(x // CELL) + 2):
        for gz in range(int(z // CELL) - 1, int(z // CELL) + 2):
            for px, pz, d in grid[(gx, gz)]:
                r = math.hypot(px - x, pz - z)
                if r < 600:
                    s += d * (1 - r / 600)
    return s


def length(line):
    return sum(math.dist(line[i], line[i + 1]) for i in range(len(line) - 1))


def at_along(line, s):
    for i in range(len(line) - 1):
        seg = math.dist(line[i], line[i + 1])
        if s <= seg or i == len(line) - 2:
            f = 0 if seg == 0 else min(1, s / seg)
            return (line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f), (line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1])
        s -= seg
    return tuple(line[-1]), (1, 0)


flat = lambda line: [int(v) for p in line for v in p]  # noqa: E731
out = {s: {"version": 1, "square": s, "walk": [], "roads": [], "park": [], "rail": []} for s in graphs}
seen = set()

# ── Walk ──
KINDS = {"crossing": 1, "steps": 2, "path": 3, "pedestrian": 3}
draws = []
for g in graphs.values():
    for arr in ("pavements", "crossings"):
        for s in g[arr]:
            if s["id"] in seen or len(s["line"]) < 2:
                continue
            seen.add(s["id"])
            where = owner(s["line"][0])
            if not where:
                continue
            mid, _ = at_along(s["line"], length(s["line"]) / 2)
            kind = 1 if arr == "crossings" else KINDS.get(s.get("kind"), 0)
            d = draw_near(*mid)
            draws.append(d)
            out[where]["walk"].append([s["nodes"][0], s["nodes"][-1], kind, d, *flat(s["line"])])
# busy: the draw on a log scale, 100 at the busiest one in fifty.
top = sorted(draws)[int(len(draws) * 0.98)] if draws else 1
for o in out.values():
    for w in o["walk"]:
        w[3] = int(round(100 * min(1.0, math.log1p(w[3] / 2000) / math.log1p(top / 2000))))

# ── Roads ──
turns = defaultdict(list)
for g in graphs.values():
    for a, b in g["turns"]:
        if b not in turns[a]:
            turns[a].append(b)
ids = set()
roads = []
for g in graphs.values():
    for r in g["roads"]:
        if r["id"] in ids or len(r["line"]) < 2:
            continue
        ids.add(r["id"])
        roads.append(r)
MINOR = ("Alley", "Place", "Lane", "Court", "Terrace", "Walk", "Way")
for r in roads:
    where = owner(r["line"][0])
    if not where:
        continue
    way, a, b = r["id"].split("/")
    oneway = f"{way}/{b}/{a}" not in ids
    name = r.get("name") or ""
    minor = not name or name.endswith(MINOR)
    flags = (1 if oneway else 0) | (2 if r.get("lanesInferred") else 0) | (4 if minor else 0)
    nxt = []
    for t in turns.get(r["id"], []):
        tw, _, tb = t.split("/")
        nxt += [int(tw), int(tb)]
    out[where]["roads"].append([int(way), int(a), int(b), int(r.get("lanes") or 1), flags, nxt, *flat(r["line"])])

# ── Parked places ──
kerbs = []
for g in graphs.values():
    for k in g["kerbs"]:
        for i in range(len(k["line"]) - 1):
            kerbs.append((tuple(k["line"][i]), tuple(k["line"][i + 1])))
kerbs = list(set(kerbs))
KCELL = 200
kgrid = defaultdict(list)
for seg in kerbs:
    (ax, az), (bx, bz) = seg
    for gx in range(int(min(ax, bx) // KCELL), int(max(ax, bx) // KCELL) + 1):
        for gz in range(int(min(az, bz) // KCELL), int(max(az, bz) // KCELL) + 1):
            kgrid[(gx, gz)].append(seg)
crossing_pts = defaultdict(list)
for g in graphs.values():
    for c in g["crossings"]:
        for p in c["line"]:
            crossing_pts[(int(p[0] // 100), int(p[1] // 100))].append(p)


def ray(o, d, most=100):
    """How far along a unit direction from a point the nearest kerb is, in cells (None past `most`)."""
    best = None
    cells = set()
    for t in range(0, most + 1, KCELL // 2):
        p = (o[0] + d[0] * t, o[1] + d[1] * t)
        cells.add((int(p[0] // KCELL), int(p[1] // KCELL)))
    for c in cells:
        for (ax, az), (bx, bz) in kgrid[c]:
            ex, ez = bx - ax, bz - az
            den = d[0] * ez - d[1] * ex
            if abs(den) < 1e-9:
                continue
            t = ((ax - o[0]) * ez - (az - o[1]) * ex) / den
            u = ((ax - o[0]) * d[1] - (az - o[1]) * d[0]) / den
            if 0 <= u <= 1 and 0 < t <= most and (best is None or t < best):
                best = t
    return best


def near_crossing(p, r=70):
    for gx in range(int(p[0] // 100) - 1, int(p[0] // 100) + 2):
        for gz in range(int(p[1] // 100) - 1, int(p[1] // 100) + 2):
            if any(math.dist(p, q) < r for q in crossing_pts[(gx, gz)]):
                return True
    return False


slots = []
for g in graphs.values():
    for pk in g["parking"]:
        if pk["id"] in seen:
            continue
        seen.add(pk["id"])
        line, L = pk["line"], length(pk["line"])
        n = int(L // 58)
        for i in range(n):
            (x, z), (dx, dz) = at_along(line, (i + 0.5) * L / n)
            yaw = math.atan2(dz, dx) + (math.pi if pk.get("side") == "left" else 0)
            slots.append((x, z, yaw, 1))
mapped = list(slots)
for r in roads:
    way, a, b = r["id"].split("/")
    oneway = f"{way}/{b}/{a}" not in ids
    line, L = r["line"], length(r["line"])
    if L < 300:
        continue
    for s in range(120, int(L - 120), 58):
        (x, z), (dx, dz) = at_along(line, s)
        m = math.hypot(dx, dz) or 1
        dx, dz = dx / m, dz / m
        for side in ((1,) if not oneway else (1, -1)):
            nx, nz = -dz * side, dx * side
            k = ray((x, z), (nx, nz))
            if k is None or k < 35:
                continue
            q = (x + nx * (k - 11), z + nz * (k - 11))
            if near_crossing(q) or any(math.dist(q, (p[0], p[1])) < 45 for p in mapped if abs(p[0] - q[0]) < 60 and abs(p[1] - q[1]) < 60):
                continue
            slots.append((q[0], q[1], math.atan2(dz * side, dx * side), 0))
# Two places closer than a car's length: the second goes.
kept = []
pgrid = defaultdict(list)
for x, z, yaw, m in slots:
    c = (int(x // 100), int(z // 100))
    if any(math.dist((x, z), q) < 52 for gx in (c[0] - 1, c[0], c[0] + 1) for gz in (c[1] - 1, c[1], c[1] + 1) for q in pgrid[(gx, gz)]):
        continue
    pgrid[c].append((x, z))
    kept.append((x, z, yaw, m))
for x, z, yaw, m in kept:
    where = owner((x, z))
    if where:
        out[where]["park"] += [int(round(x)), int(round(z)), int(round(yaw * 100)), m]

# ── Rail ──
# Which track is a cable car's: the street it runs in is one of the three lines' (the graph does not say; the
# Embarcadero's and Market's tracks are streetcars').
CABLE = ("Powell Street", "Mason Street", "Hyde Street", "Jackson Street", "Washington Street", "Taylor Street", "California Street", "Columbus Avenue", "Bay Street")
RCELL = 300
rgrid = defaultdict(list)
for r in roads:
    for p in r["line"]:
        rgrid[(int(p[0] // RCELL), int(p[1] // RCELL))].append((p, r.get("name") or ""))


def street_of(p):
    best, name = None, ""
    for gx in range(int(p[0] // RCELL) - 1, int(p[0] // RCELL) + 2):
        for gz in range(int(p[1] // RCELL) - 1, int(p[1] // RCELL) + 2):
            for q, n in rgrid[(gx, gz)]:
                d = math.dist(p, q)
                if best is None or d < best:
                    best, name = d, n
    return name


for g in graphs.values():
    for t in g["tracks"]:
        if t["id"] in seen or len(t["line"]) < 2:
            continue
        seen.add(t["id"])
        where = owner(t["line"][0])
        if where:
            mid, _ = at_along(t["line"], length(t["line"]) / 2)
            out[where]["rail"].append([t["nodes"][0], t["nodes"][-1], 1 if street_of(mid) in CABLE else 0, *flat(t["line"])])

dest = Path(args.out)
dest.mkdir(parents=True, exist_ok=True)
index = {"version": 1, "frame": "10n4250", "life": {}}
for s, o in out.items():
    body = (json.dumps(o, separators=(",", ":")) + "\n").encode()
    (dest / f"{s}.json").write_bytes(body)
    index["life"][s] = {"path": f"{s}.json", "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    mapped_n = sum(1 for i in range(3, len(o["park"]), 4) if o["park"][i])
    print(f"{s}: walk {len(o['walk'])}, roads {len(o['roads'])}, parked places {len(o['park']) // 4} ({mapped_n} mapped), rail {len(o['rail'])}; {len(body) / 1024:.0f} KB")
(dest / "index.json").write_text(json.dumps(index, indent=1) + "\n")
