"""Street life for the SF realm (#450): each square's street graph (sf/streets.md) cut down to what the page walks
and drives, with how busy each pavement is and where cars stand parked.

    ~/.village/engine/bay/venv/bin/python engine/sf/life.py [--graphs engine/sf/pilot-graph] [--inputs ~/.village/engine/bay/450-inputs] [--out engine/sf/pilot-life]

Writes `<square>.json` for every graph file, and `index.json` listing them with bytes and sha256 (the shape of a
release record, sf/release.md). A segment is written in the square its first point lies in, so the files share
nothing and the page joins them by node id. Positions are the release frame's 10 cm cells, as the graph has them.

Beside them, `transit.json` holds the streetcar and cable car routes as OSM's route relations order them: for
each, its line letter, kind (streetcar or cable) and the pieces of track it runs on, in order. Its `buses` are the
bus and trolleybus routes (OSM's route=bus and route=trolleybus relations, fetched once from Overpass into --routes):
for each, its ref, kind, operator, the hours it runs and its pieces in these squares, each the graph's roads `way/a/b`
in order and its stops as [road index, cells along that road]. Stops, lights and
classes come from the raw street survey kept beside each square (sf-450-city/inputs: OSM ways with tags, each node's
highway tag, the photo-matched stop signs and the trolley wires).

A file holds:
  walk   [a, b, kind, busy, signal, x0, z0, ...]   pavements and crossings. kind 0 pavement, 1 crossing, 2 steps,
                                                    3 path. busy 0 to 100: how many people a pavement draws, from the
                                                    land use within 60 m (shops, visitors, offices, homes). signal:
                                                    the junction node whose lights a crossing waits on, or 0
  roads  [way, a, b, lanes, flags, next, control, x0, z0, ...]  directed carriageways. flags: 1 one-way, 2 lanes
                                                    inferred, 4 minor (an alley, a place, unnamed), 8 under trolley
                                                    wires, and the OSM class times 16 (0 service, 1 residential,
                                                    2 tertiary, 3 secondary, 4 primary, 5 busway). next: [way, end
                                                    node, ...] of the roads a car may turn onto at b. control, at b:
                                                    0 none, 1 a stop sign on this approach, 2 mapped lights,
                                                    3 lights inferred (two classified streets meet, no sign mapped)
  park   [x, z, yaw, mapped, ...]                    parked-car places, yaw in hundredths of a radian (0 faces east,
                                                    a quarter turn faces south). mapped 1: on an OSM parking side;
                                                    0: inferred, 1.1 m inside a surveyed kerb, off junctions and
                                                    crossings, where the kerb leaves room for a lane and a car
  rail   [a, b, cable, x0, z0, ...]                   track centres; cable 1 where it runs in a cable car line's
                                                    street (Powell, Mason, Hyde, ...), 0 for a streetcar's
  heads  [way, a, b, x, z, mapped]                  signal heads: a post at the right kerb of each way into a
                                                    junction with lights, showing road way/a/b's lights; mapped 1
                                                    where it stands at OSM's own traffic_signals node
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
ap.add_argument("--routes", default="~/.village/engine/bay/450-bus/routes.json.gz", help="OSM bus and trolleybus routes (fetched from Overpass once if missing)")
args = ap.parse_args()

from pyproj import Transformer  # noqa: E402

UTM = Transformer.from_crs(4326, 26910, always_xy=True)
frame = lambda e, n: ((e - 500000) * 10, (4250000 - n) * 10)  # noqa: E731

graphs = {p.stem: json.loads(p.read_text()) for p in sorted(Path(args.graphs).glob("*.json"))}


# ── The raw street survey of each square: OSM ways and their tags, each node's highway tag, trolley wires, stop signs ──
import gzip  # noqa: E402

CITY = Path.home() / ".village/engine/bay/sf-450-city/inputs"
raw_ways, node_tag, node_at, relations, wired, photo_stops = {}, {}, {}, {}, set(), []
for square in graphs:
    src = CITY / f"{square}.json.gz"
    if not src.exists():
        print(f"no street survey for {square}: its junctions are uncontrolled and its roads unclassed", file=sys.stderr)
        continue
    d = json.load(gzip.open(src))
    raw_ways.update(d["ways"])
    for k, v in d["nodes"].items():
        node_at[int(k)] = v
        if len(v) > 2 and v[2]:
            node_tag[int(k)] = v[2]
    for r in d["relations"]:
        if r["tags"].get("type") == "route":
            relations[r["tags"].get("name", "")] = r
    det = CITY / f"{square}.detail.json.gz"
    if det.exists():
        wired.update(str(w[0]) for w in json.load(gzip.open(det))["wires"] if w[1] == "trolley")
    st = CITY / f"{square}.stops.json.gz"
    if st.exists():
        photo_stops += json.load(gzip.open(st))["points"]


def bounds(square):
    e, n = (float(v) * 1000 for v in square.split("_"))
    x0, z1 = frame(e, n)
    x1, z0 = frame(e + 1000, n + 1000)
    return x0, z0, x1, z1


corners = {(round(bounds(s)[0]), round(bounds(s)[1])):s for s in graphs}
grid_x, grid_z = next(iter(corners), (0, 0))


def owner(p):
    x = grid_x + math.floor((p[0]-grid_x)/10000)*10000
    z = grid_z + math.floor((p[1]-grid_z)/10000)*10000
    return corners.get((x,z))


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
            out[where]["walk"].append([s["nodes"][0], s["nodes"][-1], kind, d, 0, *flat(s["line"])])
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
road_tags = defaultdict(dict)
for g in graphs.values():
    for r in g["roads"]:
        if r["id"] in ids or len(r["line"]) < 2:
            continue
        ids.add(r["id"])
        roads.append(r)
MINOR = ("Alley", "Place", "Lane", "Court", "Terrace", "Walk", "Way")
CLASS = {"service": 0, "residential": 1, "unclassified": 1, "living_street": 1, "tertiary": 2, "tertiary_link": 2, "secondary": 3, "secondary_link": 3, "primary": 4, "primary_link": 4, "trunk": 4, "trunk_link": 4, "motorway_link": 4, "motorway": 5, "busway": 5}
klass = {r["id"]: CLASS.get(raw_ways.get(r["id"].split("/")[0], {}).get("tags", {}).get("highway"), 1 if r.get("name") else 0) for r in roads}

# ── Junctions and what controls each way into them ──
# A junction is a node of three neighbours or more (two through-ways crossing share one way id each side: counting
# ways would miss them). An approach has a stop sign when OSM tags one on its own way within 25 m of the junction
# (or on the junction itself), or a photo-matched sign stands within 15 m of the junction on its right; a junction has
# lights where OSM tags them on it or on an approach within 25 m. Where no sign is mapped and two classified streets
# (tertiary or more) of different names meet, lights are inferred. Never where a sign is, which the bake draws.
end_at = {}
for r in roads:
    _, a, b = r["id"].split("/")
    end_at[int(a)] = r["line"][0]
    end_at[int(b)] = r["line"][-1]
neigh = defaultdict(set)
for r in roads:
    _, a, b = r["id"].split("/")
    neigh[int(a)].add(int(b))
    neigh[int(b)].add(int(a))
junctions = {n for n, k in neigh.items() if len(k) >= 3}
into = defaultdict(list)
for r in roads:
    _, a, b = r["id"].split("/")
    if int(b) in junctions:
        into[int(b)].append(r)
UTM_TO = Transformer.from_crs(4326, 26910, always_xy=True)


def at_cells(n):
    v = node_at.get(n)
    if not v:
        return None
    e, nn = UTM_TO.transform(v[0], v[1])
    return ((e - 500000) * 10, (4250000 - nn) * 10)


def tagged_on_approach(r, tag, reach=250):
    way, a, b = r["id"].split("/")
    nodes = raw_ways.get(way, {}).get("nodes", [])
    J = int(b)
    if node_tag.get(J) == tag:
        return True
    if J not in nodes or int(a) not in nodes:
        return False
    i, j = nodes.index(int(a)), nodes.index(J)
    step = 1 if j > i else -1
    for k in range(j - step, i - step, -step):
        p = at_cells(nodes[k])
        if p is None or math.dist(p, end_at[J]) > reach:
            break
        if node_tag.get(nodes[k]) == tag:
            return True
    return False


spgrid = defaultdict(list)
for p in photo_stops:
    spgrid[(int(p[0] // 300), int(p[1] // 300))].append(p)


def photo_stop(r):
    jx, jz = r["line"][-1]
    px, pz = r["line"][-2] if len(r["line"]) > 1 else r["line"][0]
    dx, dz = jx - px, jz - pz
    l = math.hypot(dx, dz) or 1
    for gx in (int(jx // 300) - 1, int(jx // 300), int(jx // 300) + 1):
        for gz in (int(jz // 300) - 1, int(jz // 300), int(jz // 300) + 1):
            for q in spgrid[(gx, gz)]:
                if math.dist(q, (jx, jz)) > 150:
                    continue
                along_ = ((q[0] - jx) * dx + (q[1] - jz) * dz) / l
                right = ((q[0] - jx) * -dz + (q[1] - jz) * dx) / l
                # Before the junction, on the approach's right.
                if along_ < 20 and along_ > -200 and right > 0:
                    return True
    return False


control = {}
split = defaultdict(int)
for J in junctions:
    ins = into[J]
    if not ins:
        continue
    lights = any(tagged_on_approach(r, "traffic_signals") for r in ins)
    stops = {r["id"]: tagged_on_approach(r, "stop") or photo_stop(r) for r in ins}
    if lights:
        for r in ins:
            control[r["id"]] = 2
        split["lights mapped"] += 1
        continue
    if any(stops.values()):
        for r in ins:
            control[r["id"]] = 1 if stops[r["id"]] else 0
        split["all-way stop" if all(stops.values()) else "stop on some ways"] += 1
        continue
    names = {r.get("name") for r in ins if klass[r["id"]] >= 2 and r.get("name")}
    if len(names) >= 2:
        for r in ins:
            control[r["id"]] = 3
        split["lights inferred"] += 1
        continue
    split["uncontrolled"] += 1
print("junctions:", len(junctions), dict(split), file=sys.stderr)
signals = [J for J in junctions if any(control.get(r["id"], 0) >= 2 for r in into[J])]

for r in roads:
    where = owner(r["line"][0])
    if not where:
        continue
    way, a, b = r["id"].split("/")
    oneway = f"{way}/{b}/{a}" not in ids
    name = r.get("name") or ""
    minor = not name or name.endswith(MINOR)
    flags = (1 if oneway else 0) | (2 if r.get("lanesInferred") else 0) | (4 if minor else 0) | (8 if way in wired else 0) | (klass[r["id"]] << 4)
    nxt = []
    for t in turns.get(r["id"], []):
        tw, _, tb = t.split("/")
        nxt += [int(tw), int(tb)]
    if "controls" in graphs[where]:
        road_tags[where][way] = {k:r[k] for k in ("highway","layer","bridge","tunnel")}
    out[where]["roads"].append([int(way), int(a), int(b), int(r.get("lanes") or 1), flags, nxt, control.get(r["id"], 0), *flat(r["line"])])

# A crossing within 25 m of a junction with lights waits on them.
sgrid = defaultdict(list)
for J in signals:
    p = end_at[J]
    sgrid[(int(p[0] // 300), int(p[1] // 300))].append((J, p))
for o in out.values():
    for w in o["walk"]:
        if w[2] != 1:
            continue
        mx, mz = (w[5] + w[-2]) / 2, (w[6] + w[-1]) / 2
        best = None
        for gx in (int(mx // 300) - 1, int(mx // 300), int(mx // 300) + 1):
            for gz in (int(mz // 300) - 1, int(mz // 300), int(mz // 300) + 1):
                for J, p in sgrid[(gx, gz)]:
                    d = math.dist(p, (mx, mz))
                    if d < 250 and (best is None or d < best[0]):
                        best = (d, J)
        if best:
            w[4] = best[1]

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
mapped = defaultdict(list)
for x,z,_,_ in slots:
    mapped[(math.floor(x/60),math.floor(z/60))].append((x,z))


def mapped_near(q):
    x,z=math.floor(q[0]/60),math.floor(q[1]/60)
    return any(math.dist(q,p)<45 for i in range(x-1,x+2) for j in range(z-1,z+2) for p in mapped[(i,j)])

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
            if near_crossing(q) or mapped_near(q):
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

# ── Signal heads: one on a post at the right kerb of each way into a junction with lights, facing whoever comes ──
# Along the way: at OSM's own traffic_signals node on it where one is mapped within 25 m of the junction (where the
# survey drew the stop line and its post), else 6 m short of the junction's middle. Across: on the pavement 0.6 m past
# the kerb the survey drew on its right, else past the lanes. Written per square as [way, a, b, x, z, mapped]: the page
# shows each the lights of the road `way/a/b`, as the cars on it obey them.
def signal_node_on(r, reach=250):
    way, a, b = r["id"].split("/")
    nodes = raw_ways.get(way, {}).get("nodes", [])
    J = int(b)
    if J not in nodes or int(a) not in nodes:
        return None
    i, j = nodes.index(int(a)), nodes.index(J)
    step = 1 if j > i else -1
    for k in range(j - step, i - step, -step):
        p = at_cells(nodes[k])
        if p is None or math.dist(p, end_at[J]) > reach:
            break
        if node_tag.get(nodes[k]) == "traffic_signals":
            return p
    return None


def project(line, p):
    best, s0 = None, 0.0
    for j in range(len(line) - 1):
        (ax, az), (bx, bz) = line[j], line[j + 1]
        ex, ez = bx - ax, bz - az
        l = math.hypot(ex, ez) or 1
        t = max(0, min(l, ((p[0] - ax) * ex + (p[1] - az) * ez) / l))
        d = math.hypot(p[0] - ax - ex * t / l, p[1] - az - ez * t / l)
        if best is None or d < best[0]:
            best = (d, s0 + t)
        s0 += l
    return best[1]


heads_split = defaultdict(int)
for r in roads:
    if control.get(r["id"], 0) < 2:
        continue
    where = owner(r["line"][-1])
    if not where:
        continue
    L = length(r["line"])
    tagged = signal_node_on(r)
    s = min(L * 0.85, max(L * 0.3, project(r["line"], tagged))) if tagged else max(L * 0.35, L - 105)
    (x, z), (dx, dz) = at_along(r["line"], s)
    m = math.hypot(dx, dz) or 1
    dx, dz = dx / m, dz / m
    # Right of the way it runs (x east, z south: right of (dx, dz) is (-dz, dx)).
    # Near wide intersections the kerb opens into the cross street; probe back along the straight approach if needed.
    k = None
    for back in (0, 60, 120, 180):
        ps = max(0.0, s - back)
        (px, pz), (pdx, pdz) = at_along(r["line"], ps)
        pm = math.hypot(pdx, pdz) or 1
        hit = ray((px, pz), (-pdz / pm, pdx / pm), 180)
        if hit is not None and hit >= 28:
            k = hit
            break
    way, a, b = r["id"].split("/")
    oneway = f"{way}/{b}/{a}" not in ids
    lanes = int(r.get("lanes") or 1)
    off = k + 6 if k is not None else (lanes * 33 / 2 if oneway else lanes * 33) + 32
    out[where].setdefault("heads", []).append([int(way), int(a), int(b), int(round(x - dz * off)), int(round(z + dx * off)), 1 if tagged else 0])
    heads_split["at a mapped signal" if tagged else "6 m short"] += 1
    heads_split["at the kerb" if k is not None else "past the lanes"] += 1
print("signal heads:", sum(len(o.get("heads", [])) for o in out.values()), "at", len({h[2] for o in out.values() for h in o.get("heads", [])}), "junctions;", dict(heads_split), file=sys.stderr)

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


tracks = {}
for g in graphs.values():
    for t in g["tracks"]:
        if t["id"] not in tracks and len(t["line"]) >= 2:
            tracks[t["id"]] = t
# A whole track is a cable car's or not, by the streets most of its length runs in: a piece at a junction lies
# nearest the street it crosses.
parent = {}


def root(n):
    parent.setdefault(n, n)
    while parent[n] != n:
        parent[n] = parent[parent[n]]
        n = parent[n]
    return n


for t in tracks.values():
    parent[root(t["nodes"][0])] = root(t["nodes"][-1])
vote = defaultdict(float)
for t in tracks.values():
    mid, _ = at_along(t["line"], length(t["line"]) / 2)
    vote[root(t["nodes"][0])] += length(t["line"]) * (1 if street_of(mid) in CABLE else -1)
for t in tracks.values():
    where = owner(t["line"][0])
    if where:
        out[where]["rail"].append([t["nodes"][0], t["nodes"][-1], 1 if vote[root(t["nodes"][0])] > 0 else 0, *flat(t["line"])])

# ── Transit: streetcar and cable car routes, in the order their relations give ──
CABLE_REFS = {"PH", "PM", "C"}
transit = []
seen_routes = set()
for name, r in sorted(relations.items()):
    if r["tags"].get("route") != "tram":
        continue
    ref = r["tags"].get("ref", "")
    lines, cur = [], []
    for m in r["members"]:
        if m.get("type") != "way" or m.get("role") not in ("", None):
            continue
        w = raw_ways.get(str(m["ref"]))
        pts = [at_cells(n) for n in w["nodes"]] if w else None
        if not pts or any(p is None for p in pts):
            if len(cur) > 1:
                lines.append(cur)
            cur = []
            continue
        if cur:
            # Turned to carry on from where the last piece ended; a gap begins a new line.
            if math.dist(cur[-1], pts[-1]) < math.dist(cur[-1], pts[0]):
                pts = pts[::-1]
            if math.dist(cur[-1], pts[0]) > 300:
                lines.append(cur)
                cur = []
        cur += pts if not cur else pts[1:]
    if len(cur) > 1:
        lines.append(cur)
    lines = [l for l in lines if sum(math.dist(l[i], l[i + 1]) for i in range(len(l) - 1)) > 500]
    key = (ref, tuple(map(tuple, (lines[0][0], lines[-1][-1]))) if lines else None)
    if not lines or key in seen_routes:
        continue
    seen_routes.add(key)
    transit.append({"ref": ref, "kind": "cable" if ref in CABLE_REFS else "streetcar", "lines": [[int(round(v)) for p in l for v in p] for l in lines]})
print("transit:", [(t["ref"], t["kind"], len(t["lines"]), round(sum(math.dist((l[i], l[i + 1]), (l[i + 2], l[i + 3])) for l in t["lines"] for i in range(0, len(l) - 2, 2)) / 10)) for t in transit], file=sys.stderr)

# ── Keep opposing lanes clear of parallel streetcar rails (#72) ──
# On Market and Steuart streets near the Ferry Building (and a few spots along the F line), OSM maps a one-way
# carriageway centerline right beside an opposing streetcar track so the leftmost lane sits 0.3-1.7 m from the rail
# centre (a streetcar is 2.7 m wide and a car/bus 2.0-2.6 m, needing >= 2.8 m centre-to-centre). Shift affected road
# vertices to their right (away from the opposing rail, kept inside any surveyed kerb) so oncoming vehicles pass cleanly
# without moving the streetcar off its baked rails.
def clear_opposing_streetcar_rails(out_squares, transit_routes, kerb_ray, clear=28.0):
    tcell = 300
    tgrid = defaultdict(list)
    for rt in transit_routes:
        if rt.get("kind") != "streetcar":
            continue
        for flat_line in rt.get("lines", ()):
            pts = [(flat_line[i], flat_line[i + 1]) for i in range(0, len(flat_line), 2)]
            for i in range(len(pts) - 1):
                ax, az = pts[i]
                bx, bz = pts[i + 1]
                L = math.hypot(bx - ax, bz - az)
                if L < 1:
                    continue
                seg = (ax, az, bx, bz, (bx - ax) / L, (bz - az) / L)
                for gx in range(int(min(ax, bx) // tcell) - 1, int(max(ax, bx) // tcell) + 2):
                    for gz in range(int(min(az, bz) // tcell) - 1, int(max(az, bz) // tcell) + 2):
                        tgrid[(gx, gz)].append(seg)
    if not tgrid:
        return 0
    shifted_roads = 0
    for sq in out_squares.values():
        for row in sq["roads"]:
            lanes, flags = row[3], row[4]
            oneway = bool(flags & 1)
            pts = [(row[i], row[i + 1]) for i in range(7, len(row), 2)]
            if len(pts) < 2:
                continue
            left_off = -((lanes - 1) / 2.0) * 33.0 if oneway else 16.5
            right_off = ((lanes - 1) / 2.0) * 33.0 if oneway else (lanes - 0.5) * 33.0
            need = 0.0
            sum_nx = sum_nz = 0.0
            for j in range(len(pts) - 1):
                x0, z0 = pts[j]
                x1, z1 = pts[j + 1]
                L = math.hypot(x1 - x0, z1 - z0)
                if L < 1:
                    continue
                rtx, rtz = (x1 - x0) / L, (z1 - z0) / L
                rnx, rnz = -rtz, rtx
                steps = max(2, int(L / 40))
                for k in range(steps + 1):
                    px = x0 + (x1 - x0) * k / steps
                    pz = z0 + (z1 - z0) * k / steps
                    for ax, az, bx, bz, ttx, ttz in tgrid.get((int(px // tcell), int(pz // tcell)), ()):
                        if rtx * ttx + rtz * ttz > -0.90:
                            continue
                        ex, ez = bx - ax, bz - az
                        l2 = ex * ex + ez * ez
                        t = max(0.0, min(1.0, ((px - ax) * ex + (pz - az) * ez) / l2))
                        qx, qz = ax + ex * t, az + ez * t
                        dx, dz = qx - px, qz - pz
                        if math.hypot(dx, dz) > 80.0 or abs(dx * rtx + dz * rtz) > 20.0:
                            continue
                        lat = dx * rnx + dz * rnz
                        if left_off - clear < lat < right_off + clear:
                            req = (lat + clear) - left_off
                            if req > need:
                                need = req
                                sum_nx, sum_nz = rnx, rnz
            if need <= 0.5:
                continue
            # Cap rightward shift to stay inside the right kerb when one is surveyed.
            shift = min(need, 45.0)
            mid_x, mid_z = pts[len(pts) // 2]
            k_dist = kerb_ray((mid_x, mid_z), (sum_nx, sum_nz), most=200) if kerb_ray else None
            if k_dist is not None:
                room = k_dist - (right_off + 12.0)
                if room > 0:
                    shift = min(shift, room)
            if shift <= 0.5:
                continue
            for idx in range(len(pts)):
                if idx == 0:
                    dx, dz = pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]
                elif idx == len(pts) - 1:
                    dx, dz = pts[-1][0] - pts[-2][0], pts[-1][1] - pts[-2][1]
                else:
                    dx, dz = pts[idx + 1][0] - pts[idx - 1][0], pts[idx + 1][1] - pts[idx - 1][1]
                L = math.hypot(dx, dz) or 1.0
                nx, nz = -dz / L, dx / L
                row[7 + 2 * idx] = int(round(pts[idx][0] + nx * shift))
                row[7 + 2 * idx + 1] = int(round(pts[idx][1] + nz * shift))
            shifted_roads += 1
    return shifted_roads


rail_shifts = clear_opposing_streetcar_rails(out, transit, ray)
if rail_shifts:
    print(f"rail clearance: shifted {rail_shifts} road segments clear of opposing streetcar tracks", file=sys.stderr)

# ── Buses and trolleybuses: OSM's route relations (public_transport v2), each as the roads of the graph it runs on ──
# A route's member ways in their order, each turned to carry on from the last, are cut at the graph's junctions into
# the directed roads `way/a/b` the page drives; where one is not in the graph (a busway the graph left out, or the
# route's leaving these squares), a new piece begins. Its stop positions (role stop) are put on the nearest of its
# roads within 15 m, as [road index in the piece, cells along that road]. When it runs, from its name: owl lines at
# night, peak-only lines at their peak, the rest from five in the morning to one at night.
def bus_routes(path):
    if not path.exists():
        from urllib.parse import urlencode
        from urllib.request import Request, urlopen
        lon_lat = Transformer.from_crs(26910, 4326, always_xy=True)
        corners = [lon_lat.transform(*p) for s in graphs for p in ((float(s.split("_")[0]) * 1000, float(s.split("_")[1]) * 1000), ((float(s.split("_")[0]) + 1) * 1000, (float(s.split("_")[1]) + 1) * 1000))]
        box = f"{min(c[1] for c in corners):.4f},{min(c[0] for c in corners):.4f},{max(c[1] for c in corners):.4f},{max(c[0] for c in corners):.4f}"
        q = f'[out:json][timeout:150];relation[type=route][route~"^(bus|trolleybus)$"]({box});out body;>;out skel qt;'
        req = Request("https://overpass-api.de/api/interpreter", data=urlencode({"data": q}).encode(), headers={"User-Agent": "Village-SF-data"})
        with urlopen(req, timeout=200) as reply:
            data = json.load(reply)
        if data.get("remark") or not data.get("elements"):
            raise ValueError("incomplete OSM bus routes")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(gzip.compress(json.dumps(data).encode(), mtime=0))
    return json.load(gzip.open(path))


osm = bus_routes(Path(args.routes).expanduser())
osm_way = {e["id"]: e["nodes"] for e in osm["elements"] if e["type"] == "way"}
osm_at = {e["id"]: frame(*UTM.transform(e["lon"], e["lat"])) for e in osm["elements"] if e["type"] == "node"}
graph_nodes = defaultdict(set)
for r in roads:
    w, a, b = r["id"].split("/")
    graph_nodes[int(w)].update((int(a), int(b)))


def hours_of(name):
    n = name.lower()
    if "owl" in n or "late night" in n:
        return [1, 5]
    if "8pm-midnight" in n:
        return [20, 24]
    if "early morning" in n:
        return [5, 7]
    if "(evenings)" in n:
        return [16, 20]
    if "(mornings)" in n:
        return [6, 10]
    return [5, 25]


def near_road(p, keys, most=150):
    best = None
    for i, k in enumerate(keys):
        line = road_line[k]
        s0 = 0.0
        for j in range(len(line) - 1):
            (ax, az), (bx, bz) = line[j], line[j + 1]
            ex, ez = bx - ax, bz - az
            l2 = ex * ex + ez * ez or 1
            t = max(0, min(1, ((p[0] - ax) * ex + (p[1] - az) * ez) / l2))
            d = math.hypot(p[0] - ax - ex * t, p[1] - az - ez * t)
            if d < most and (best is None or d < best[0]):
                best = (d, i, s0 + math.sqrt(l2) * t)
            s0 += math.sqrt(l2)
    return best


road_line = {r["id"]: r["line"] for r in roads}
buses, bus_split = [], defaultdict(int)
for rel in osm["elements"]:
    if rel["type"] != "relation":
        continue
    tags = rel.get("tags", {})
    members = [m for m in rel["members"] if m["type"] == "way" and m["role"] in ("", "forward", "backward") and m["ref"] in osm_way]
    # Each way's nodes, turned to carry on from the last one's end.
    seq, end = [], None
    for k, m in enumerate(members):
        ns = list(osm_way[m["ref"]])
        if end is None:
            nxt = osm_way[members[k + 1]["ref"]] if k + 1 < len(members) else []
            if ns[0] in (nxt[0], nxt[-1]) if nxt else False:
                ns = ns[::-1]
        elif ns[-1] == end:
            ns = ns[::-1]
        elif ns[0] != end:
            seq.append(None)
        seq.append((m["ref"], ns))
        end = ns[-1]
    pieces, cur = [], []
    for item in seq:
        if item is None:
            if cur:
                pieces.append(cur)
            cur = []
            continue
        way, ns = item
        marks = [n for n in ns if n in graph_nodes.get(way, ())]
        for a, b in zip(marks, marks[1:]):
            key = f"{way}/{a}/{b}"
            if key in ids:
                cur.append(key)
            else:
                bus_split["roads not in the graph"] += 1
                if cur:
                    pieces.append(cur)
                cur = []
    if cur:
        pieces.append(cur)
    pieces = [p for p in pieces if sum(length(road_line[k]) for k in p) > 1500]
    if not pieces:
        continue
    stops = [m["ref"] for m in rel["members"] if m["type"] == "node" and m["role"].startswith("stop") and m["ref"] in osm_at]
    out_pieces = []
    for p in pieces:
        placed = []
        for n in stops:
            hit = near_road(osm_at[n], p)
            if hit:
                placed.append([hit[1], int(round(hit[2]))])
        placed.sort()
        out_pieces.append({"roads": p, "stops": placed})
    kind = "trolleybus" if tags.get("route") == "trolleybus" else "bus"
    buses.append({"ref": tags.get("ref", ""), "kind": kind, "name": tags.get("name", ""), "operator": tags.get("operator", ""), "hours": hours_of(tags.get("name", "")), "pieces": out_pieces})
    bus_split[kind] += 1
print("buses:", dict(bus_split), "pieces", sum(len(b["pieces"]) for b in buses), "stops", sum(len(p["stops"]) for b in buses for p in b["pieces"]), file=sys.stderr)

dest = Path(args.out)
dest.mkdir(parents=True, exist_ok=True)
index = {"version": 1, "frame": "10n4250", "life": {}}
for s, o in out.items():
    graph = graphs[s]
    # Keep the compact road rows readable by older pages; share topology attributes per OSM way.
    if "controls" in graph:
        o.update({k:graph[k] for k in ("controls","signals","stopSigns","photoStopSigns")})
        o["roadTags"] = road_tags[s]
    body = (json.dumps(o, separators=(",", ":")) + "\n").encode()
    (dest / f"{s}.json").write_bytes(body)
    index["life"][s] = {"path": f"{s}.json", "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    mapped_n = sum(1 for i in range(3, len(o["park"]), 4) if o["park"][i])
    print(f"{s}: walk {len(o['walk'])}, roads {len(o['roads'])}, parked places {len(o['park']) // 4} ({mapped_n} mapped), rail {len(o['rail'])}; {len(body) / 1024:.0f} KB")
body = (json.dumps({"version": 1, "routes": transit, "buses": buses}, separators=(",", ":")) + "\n").encode()
(dest / "transit.json").write_bytes(body)
index["transit"] = {"path": "transit.json", "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
(dest / "index.json").write_text(json.dumps(index, indent=1) + "\n")
