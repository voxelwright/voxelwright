"""What a person sees wrong at street level in San Francisco (#450), measured in the pictures themselves.

    ~/.village/engine/bay/venv/bin/python -I engine/sf/street_checks.py ~/.village/engine/sf/street-2/new [--marks dist-sf/bay/marks.bin] [--json out.json]

Reads the <view>.png, <view>@2x.png and <view>.json sf/street-shots.mjs writes. The json's grid says what the march hit
under a grid of pixels (material, colour, distance and place in 10 cm cells); the road's marks are read from marks.bin
(sf/marks.mjs), the same the page draws. Every measure reads the png's own pixels at those places, so a builder's score
file decides nothing.

asphalt    the road's brightness: the median luminance of sunlit asphalt pixels within 40 m against that of sunlit
           pavement inside its strip (its upper quartile: its kerb's face is pavement too). Fails where the asphalt is not darker by a tenth, or where that ratio is over the most the
           photographs show (street-refs.json: road and pavement patches chosen by looking at each photograph) by 0.05.
terraces   the staircase of a street on a hill: in the 12 x 9 pixel box round each labelled pixel within 30 m, the mean
           of each row, and the share of neighbouring rows whose means differ by 12 or more; for the road's asphalt off
           its marks, and for its pavements (concrete, inside the strip). Fails over 0.09 where the view climbs and 150 or more of its
           labelled pixels are of it. The bar lies between the stairs (0.13 to 0.33 on the old Powell, California and
           Filbert) and the photographs of climbing streets (0.05 at most).
treads     that a road or a pavement that climbs is a ramp and not a stair: of the asphalt (and the concrete) pixels
           within 30 m whose ground climbs 30 cm or more within 3 m of them, the share where the march met it within
           6 mm of a whole 10 cm cell's top. A stair is all treads; a ramp of quarter cells (bay.rs grade_rows) a
           quarter or so. Fails over 0.4 where 50 or more such pixels are in a view that climbs (the old pavements:
           0.46 to 0.83; ramped roads and pavements 0.19 to 0.32).
markings   that paint is drawn where the street graph puts it: of the asphalt pixels within 30 m whose place is on a
           line, a dash or a crossing's bar in marks.bin, the share that look like paint (half again as bright as the
           road round them, or yellow). Fails under 0.5 where 6 or more such pixels are in view: the bake's own paint
           (the city's before the graph's marks were drawn there) lay in blocks beside the graph's lines.
yellow     that a crossing OSM calls yellow is yellow: of its bars' pixels within 30 m, the share whose red and green are
           over its blue by 30 or more. Fails under 0.5 where 4 or more are in view.
rails      that rails are lines and not stairs: along each cable car's slot (and each streetcar's rail) 3 to 20 m ahead,
           every 5 cm, where the image's profile across the line puts the line (the centroid of its contrast with the
           road), and how far that wanders from a straight line over each 55 cm: the median of those residuals, in
           pixels. A rail drawn in 10 cm cells at an angle to them jumps a cell's width every few cells: 1.04 to 2.85
           on the old California and Fisherman's Wharf. Drawn as a line it still jogs at each 2.5 cm step of the
           road's ramp (its treads are level): 0.88 up California. Fails over 1.0, and where one or more of the graph's
           pieces of track are in view and fewer than three stretches of rail are seen on them.
aliasing   that marks far off are filtered and not dots: in the 12 x 9 pixel boxes round the asphalt pixels 25 to 120 m
           off whose place is within a mark's reach, the mean difference in luminance between the picture and the same
           view drawn at twice the size and halved (<view>@2x.png), against the same in boxes of bare road as far off.
           A dash that is a dot in one and a gap in the other differs; a line filtered to its share of a pixel does not.
           Fails over 2.0 (the marks' boxes against the road's) where 20 or more boxes are marks'.

The same asphalt and terrace measures are run on each photograph's patches, so a threshold that the photographs
themselves fail would show.
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).parent
PHOTOS = Path.home() / ".village/engine/bay/450-panel/references"
ASPHALT, CONCRETE, STEEL = 6, 7, 12
CLIMBS = {"Powell", "California", "Filbert", "Telegraph Hill", "Nob Hill", "Russian Hill"}
CLIMBS |= {f"realm-{c}" for c in CLIMBS}
MARKS = HERE.parent / "dist-sf/bay/marks.bin"
# sf/marks.mjs STYLE, and how far each reaches from its line (cells).
WHITE_LINE, WHITE_DASH, YELLOW_DOUBLE, CROSS_BARS, CROSS_LINES, RAILS_CABLE, RAILS = 1, 2, 3, 4, 5, 6, 7
REACH = {1: 0.5, 2: 0.5, 3: 1.5, 4: 15, 5: 15, 6: 6.0, 7: 7.8}


def lum(rgb):
    return rgb[..., :3].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)


def patch(l, box):
    h, w = l.shape
    x0, y0, x1, y1 = box
    return l[int(y0 * h) : int(y1 * h), int(x0 * w) : int(x1 * w)]


def q75(v):
    return float(np.percentile(v, 75)) if len(v) else None


class Marks:
    """marks.bin's segments, by the square of 25.6 m they reach into."""

    def __init__(self, path):
        w = np.frombuffer(path.read_bytes(), "<i4")
        self.segs = w[3 + w[1] * 4 :].reshape(-1, 5).astype(np.float64)
        self.by = {}
        for i, (x0, z0, x1, z1, _) in enumerate(self.segs):
            for gz in range(int(min(z0, z1) - 20) >> 8, (int(max(z0, z1) + 20) >> 8) + 1):
                for gx in range(int(min(x0, x1) - 20) >> 8, (int(max(x0, x1) + 20) >> 8) + 1):
                    self.by.setdefault((gx, gz), []).append(i)

    def near(self, x, z):
        """Each segment whose band could reach a place: (style, colour, across, along, length, distance to it)."""
        out = []
        for i in self.by.get((int(x) >> 8, int(z) >> 8), ()):
            x0, z0, x1, z1, style = self.segs[i]
            dx, dz = x1 - x0, z1 - z0
            l = math.hypot(dx, dz)
            if l < 0.5:
                continue
            ux, uz = dx / l, dz / l
            rx, rz = x - x0, z - z0
            t = rx * ux + rz * uz
            side = rx * uz - rz * ux
            tc = min(max(t, 0.0), l)
            dist = math.hypot(rx - ux * tc, rz - uz * tc)
            s = int(style)
            if dist <= REACH[s & 15] + 3:
                out.append((s & 15, s >> 4, side, t, l, dist))
        return out

    def paint_at(self, x, z):
        """What paint the place is on, if any (as page/marks.ts draws it, unfiltered): 'white', 'yellow' (a centre
        line), 'crossing-yellow', 'rainbow' or None."""
        for s, colour, side, t, l, dist in self.near(x, z):
            if s == WHITE_LINE and dist < 0.5:
                return "white"
            if s == WHITE_DASH and abs(side) < 0.5 and 0 <= t <= l and t % 90 < 30:
                return "white"
            if s == YELLOW_DOUBLE and 0.5 <= dist <= 1.5:
                return "yellow"
            if s == CROSS_BARS and abs(side) < 15 and 2 <= t <= l - 2 and (t - 2) % 12 < 6:
                return ["white", "crossing-yellow", "rainbow"][colour]
            if s == CROSS_LINES and 13 <= abs(side) <= 15 and 0 <= t <= l:
                return "white"
        return None

    def within(self, x, z):
        """Whether any mark's band reaches a place (and a little over)."""
        return any(dist <= REACH[s] + 2 for s, *_, dist in self.near(x, z))


def rays(view, px, py, w, h):
    f, r, u = (np.array(view[k], np.float64) for k in ("forward", "right", "up"))
    a = (2 * (np.asarray(px) + 0.5)) / w - 1
    b = (2 * (np.asarray(py) + 0.5)) / h - 1
    d = f[None] + r[None] * (a * view["tanHalf"] * w / h)[:, None] - u[None] * (b * view["tanHalf"])[:, None]
    return d / np.linalg.norm(d, axis=1)[:, None]


def project(view, p, w, h):
    e, f, r, u = (np.array(view[k], np.float64) for k in ("eye", "forward", "right", "up"))
    d = p - e
    z = d @ f
    return np.stack([((d @ r) / z / (view["tanHalf"] * w / h) + 1) / 2 * w - 0.5, (1 - (d @ u) / z / view["tanHalf"]) / 2 * h - 0.5], -1), z


def bilinear(l, x, y):
    h, w = l.shape
    x0, y0 = np.clip(np.floor(x).astype(int), 0, w - 2), np.clip(np.floor(y).astype(int), 0, h - 2)
    fx, fy = np.clip(x - x0, 0, 1), np.clip(y - y0, 0, 1)
    return (l[y0, x0] * (1 - fx) + l[y0, x0 + 1] * fx) * (1 - fy) + (l[y0 + 1, x0] * (1 - fx) + l[y0 + 1, x0 + 1] * fx) * fy


def rails(l, shot, marks):
    """How far the rails 3 to 20 m ahead wander from straight lines, in pixels (see `rails` above), and how many runs."""
    view, grid = shot["camera"].get("view"), shot["grid"]
    if not view or not grid or len(grid[0]) < 7:
        return None, 0, 0
    h, w = l.shape
    g = np.array([row[:7] for row in grid], np.float64)
    d = rays(view, g[:, 0], g[:, 1], w, h)
    pts = np.array(view["eye"])[None] + d * g[:, 4:5]
    eye, fwd = np.array(view["eye"]), np.array(view["forward"])
    residuals, runs = [], 0
    for x0, z0, x1, z1, style in marks.segs:
        s = int(style) & 15
        if s not in (RAILS_CABLE, RAILS):
            continue
        mid = np.array([(x0 + x1) / 2, (z0 + z1) / 2])
        if np.hypot(*(mid - eye[[0, 2]])) > 300:
            continue
        l_ = math.hypot(x1 - x0, z1 - z0)
        ux, uz = (x1 - x0) / l_, (z1 - z0) / l_
        # A cable car's slot, a streetcar's right-hand rail's groove and head.
        off = 0.0 if s == RAILS_CABLE else 7.175
        along = np.arange(0, l_, 0.5)
        xs, zs = x0 + ux * along - uz * off, z0 + uz * along + ux * off
        ahead = (xs - eye[0]) * fwd[0] + (zs - eye[2]) * fwd[2]
        keep = (ahead > 30) & (ahead < 200)
        if keep.sum() < 22:
            continue
        xs, zs = xs[keep], zs[keep]
        # The road's height there, from the labelled pixels round it.
        ys = np.empty(len(xs))
        for k, (x, z) in enumerate(zip(xs, zs)):
            dd = np.hypot(pts[:, 0] - x, pts[:, 2] - z)
            near = np.argsort(dd)[:4]
            if dd[near[0]] > 25:
                ys[k] = np.nan
                continue
            ys[k] = np.average(pts[near, 1], weights=1 / (dd[near] + 1))
        p = np.stack([xs, ys, zs], 1)
        ok = ~np.isnan(ys)
        if ok.sum() < 22:
            continue
        p = p[ok]
        img, depth = project(view, p, w, h)
        img2, _ = project(view, p + np.array([ux, 0, uz]) * 5, w, h)
        tangent = img2 - img
        tangent /= np.linalg.norm(tangent, axis=1)[:, None] + 1e-9
        normal = np.stack([-tangent[:, 1], tangent[:, 0]], 1)
        inside = (img[:, 0] > 12) & (img[:, 0] < w - 12) & (img[:, 1] > 12) & (img[:, 1] < h - 12) & (depth > 0)
        offs = np.arange(-8, 8.01, 0.5)
        found = np.full(len(p), np.nan)
        for k in np.nonzero(inside)[0]:
            prof = bilinear(l, img[k, 0] + normal[k, 0] * offs, img[k, 1] + normal[k, 1] * offs)
            c = np.abs(prof - np.median(prof))
            c = np.where(c > 12, c, 0)
            if c.sum() > 0:
                found[k] = (c * offs).sum() / c.sum()
        for a in range(0, len(found) - 11, 6):
            r = found[a : a + 11]
            if np.isnan(r).any():
                continue
            s_ = np.arange(11)
            fit = np.polyfit(s_, r, 1)
            residuals.append(float(np.sqrt(np.mean((r - np.polyval(fit, s_)) ** 2))))
        runs += 1
    return (round(float(np.median(residuals)), 3) if len(residuals) >= 5 else None), len(residuals), runs


def treads(shot, material, w, h):
    """The share of a climbing surface met on a whole cell's top (see `treads` above), and how many pixels."""
    view = shot["camera"].get("view")
    g = np.array([r[:7] for r in shot["grid"] if len(r) >= 7 and r[2] == material and r[4] < 300], np.float64)
    if not view or len(g) < 30:
        return None, 0
    y = view["eye"][1] + rays(view, g[:, 0], g[:, 1], w, h)[:, 1] * g[:, 4]
    xz = g[:, 5:7]
    on = []
    for k in range(len(g)):
        near = np.hypot(*(xz - xz[k]).T) < 30
        if near.sum() >= 4 and y[near].max() - y[near].min() >= 3:
            on.append(abs(y[k] - round(y[k])) < 0.06)
    return (round(float(np.mean(on)), 3) if len(on) >= 20 else None), len(on)


def aliasing(l, l2, shot, marks):
    """The marks' boxes far off against bare road's: mean |picture - twice its size halved| (see `aliasing` above)."""
    if l2 is None:
        return None, 0
    h, w = l.shape
    half = l2[: 2 * h, : 2 * w].reshape(h, 2, w, 2).mean((1, 3))
    diff = np.abs(l - half)
    on, off = [], []
    for row in shot["grid"]:
        if len(row) < 7:
            continue
        px, py, m, c, t, x, z = row[:7]
        if m != ASPHALT or not (250 <= t <= 1200):
            continue
        box = float(diff[py - 4 : py + 5, px - 6 : px + 6].mean())
        (on if marks.within(x, z) else off).append(box)
    if len(on) < 20 or len(off) < 10:
        return None, len(on)
    return round(float(np.mean(on)) / max(float(np.mean(off)), 0.5), 3), len(on)


def measure(png, shot, marks):
    rgb = np.asarray(Image.open(png).convert("RGB")).astype(np.float32)
    l = lum(rgb)
    grid = shot["grid"]
    at = lambda px, py: float(l[py - 1 : py + 2, px - 1 : px + 2].mean())
    placed = [row for row in grid if len(row) >= 7]
    mark = {(row[0], row[1]): marks.within(row[5], row[6]) for row in placed} if marks else {}
    paint = {(row[0], row[1]): marks.paint_at(row[5], row[6]) for row in placed if row[2] == ASPHALT and row[4] < 300} if marks else {}
    road = [at(px, py) for px, py, m, c, t, *_ in grid if m == ASPHALT and not mark.get((px, py)) and t < 400]
    # A pavement's own pixels: inside its strip (the labelled pixels above and below are pavement too), not its kerb's
    # face or the foot of a wall, which are half in shade.
    material = {(px, py): m for px, py, m, *_ in grid}
    inside = lambda px, py: material.get((px, py - 9)) == CONCRETE and material.get((px, py + 9)) == CONCRETE
    pave = [at(px, py) for px, py, m, c, t, *_ in grid if m == CONCRETE and c in (0, 6) and t < 400 and inside(px, py)]
    near = [(px, py, m, c) for px, py, m, c, t, *_ in grid if t < 300]

    def terraces(which):
        jumps = pairs = n = 0
        for px, py, m, c in near:
            if not which(px, py, m, c):
                continue
            n += 1
            rows = l[py - 4 : py + 5, px - 6 : px + 6].mean(1)
            d = np.abs(np.diff(rows))
            jumps += int((d >= 12).sum())
            pairs += d.size
        return (round(jumps / pairs, 4) if pairs else None), n

    road_terr, road_n = terraces(lambda px, py, m, c: m == ASPHALT and not mark.get((px, py)))
    # A pavement is a strip: only its inside, or every box on its kerb or its wall's foot counted the edge as a step.
    pave_terr, pave_n = terraces(lambda px, py, m, c: m == CONCRETE and inside(px, py))
    # Paint where the graph puts it: as bright again by half as the road's median, or yellow.
    base = float(np.median(road)) if road else 0
    looks = lambda px, py: (at(px, py) > 1.5 * base) or (rgb[py, px, 0] - rgb[py, px, 2] > 30 and rgb[py, px, 1] - rgb[py, px, 2] > 30)
    owed = [(px, py) for (px, py), p in paint.items() if p in ("white", "yellow", "crossing-yellow")]
    shown = sum(1 for px, py in owed if looks(px, py))
    bars = [(px, py) for (px, py), p in paint.items() if p == "crossing-yellow"]
    yellowed = sum(1 for px, py in bars if rgb[py - 1 : py + 2, px - 1 : px + 2, 0].mean() - rgb[py - 1 : py + 2, px - 1 : px + 2, 2].mean() > 30)
    lit = 0.5 * float(np.percentile(road + pave, 95)) if road + pave else 0
    sunny = lambda v: [x for x in v if x > lit]
    road_lit, pave_lit = sunny(road), sunny(pave)
    two = png.with_name(png.stem + "@2x.png")
    l2 = lum(np.asarray(Image.open(two).convert("RGB"))) if two.is_file() else None
    rail, rail_runs, rails_owed = rails(l, shot, marks) if marks else (None, 0, 0)
    road_treads, road_treads_n = treads(shot, ASPHALT, l.shape[1], l.shape[0])
    pave_treads, pave_treads_n = treads(shot, CONCRETE, l.shape[1], l.shape[0])
    alias, alias_n = aliasing(l, l2, shot, marks) if marks else (None, 0)
    return {
        "asphalt": q75(road),
        "asphaltLit": float(np.median(road_lit)) if len(road_lit) >= 15 else None,
        # The upper quartile: a ramped pavement's kerb follows the slope, and its face (pavement too, half in shade)
        # is where Nob Hill's grid now meets it; the median took it for the pavement (168, then 127).
        "pavement": float(np.percentile(pave_lit, 75)) if len(pave_lit) >= 15 else None,
        "roadPixels": road_n,
        "terraces": road_terr,
        "pavementPixels": pave_n,
        "pavementTerraces": pave_terr,
        "roadTreads": road_treads,
        "roadTreadPixels": road_treads_n,
        "pavementTreads": pave_treads,
        "pavementTreadPixels": pave_treads_n,
        "paintOwed": len(owed),
        "markings": round(shown / len(owed), 3) if owed else None,
        "yellowOwed": len(bars),
        "yellow": round(yellowed / len(bars), 3) if bars else None,
        "rails": rail,
        "railRuns": rail_runs,
        "railsOwed": rails_owed,
        "aliasing": alias,
        "aliasBoxes": alias_n,
    }


def photo(place, refs, photos):
    ref = refs.get(place)
    path = photos / f"{place}.jpg"
    if not ref or not path.is_file():
        return None
    l = lum(np.asarray(Image.open(path).convert("RGB")))
    road = patch(l, ref["road"])
    out = {"asphalt": q75(road.ravel())}
    if ref.get("pavement"):
        out["pavement"] = q75(patch(l, ref["pavement"]).ravel())
    h, w = road.shape
    rows = road[:, : w // 12 * 12].reshape(h, -1, 12).mean(2)
    out["terraces"] = round(float((np.abs(np.diff(rows, axis=0)) >= 12).mean()), 4)
    return out


def verdicts(name, r, most):
    bad = []
    if r["asphaltLit"] is not None and r["pavement"] is not None:
        ratio = r["asphaltLit"] / r["pavement"]
        if ratio > 0.9:
            bad.append(f"sunlit asphalt {r['asphaltLit']:.0f} not darker than sunlit pavement {r['pavement']:.0f}")
        if ratio > most + 0.05:
            bad.append(f"asphalt over pavement {ratio:.2f}, the photographs' most {most:.2f}")
    if name in CLIMBS and r["terraces"] is not None and r["roadPixels"] >= 150 and r["terraces"] > 0.09:
        bad.append(f"terraces {r['terraces']:.3f}")
    if name in CLIMBS and r["pavementTerraces"] is not None and r["pavementPixels"] >= 150 and r["pavementTerraces"] > 0.09:
        bad.append(f"pavement terraces {r['pavementTerraces']:.3f}")
    for what in ("road", "pavement"):
        v, n = r[f"{what}Treads"], r[f"{what}TreadPixels"]
        if name in CLIMBS and v is not None and n >= 50 and v > 0.4:
            bad.append(f"{what} a stair: {v:.2f} of {n} climbing pixels on a whole cell's top")
    if r["paintOwed"] >= 6 and r["markings"] < 0.5:
        bad.append(f"paint shown on {r['markings']:.2f} of {r['paintOwed']} pixels the graph's marks cover")
    if r["yellowOwed"] >= 4 and r["yellow"] < 0.5:
        bad.append(f"a yellow crossing yellow on {r['yellow']:.2f} of {r['yellowOwed']} pixels")
    if r["railsOwed"] >= 1 and r["railRuns"] < 3:
        bad.append(f"rails owed on {r['railsOwed']} of the graph's pieces in view, seen on {r['railRuns']} stretches")
    if r["rails"] is not None and r["rails"] > 1.0:
        bad.append(f"rails wander {r['rails']:.2f} px from straight")
    if r["aliasing"] is not None and r["aliasing"] > 2.0:
        bad.append(f"far marks alias {r['aliasing']:.2f}x bare road")
    return bad


def main():
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cli.add_argument("shots", type=Path)
    cli.add_argument("--marks", type=Path, default=MARKS)
    cli.add_argument("--photos", type=Path, default=PHOTOS)
    cli.add_argument("--json", type=Path)
    a = cli.parse_args()
    refs = json.loads((HERE / "street-refs.json").read_text())
    marks = Marks(a.marks) if a.marks.is_file() else None
    if not marks:
        print(f"  no marks at {a.marks}: markings, yellow, rails and aliasing are not measured")
    results, failed = {}, 0
    # The photographs' own road over pavement where they show both: the most of them is the bar a render's must meet.
    ratios = {n: q["asphalt"] / q["pavement"] for n in refs if not n.startswith("_") for q in [photo(n, refs, a.photos)] if q and q.get("pavement")}
    most = max(ratios.values())
    print("photographs' road over pavement:", {n: round(v, 2) for n, v in ratios.items()})
    print(f"{'view':24} {'asph':>4} {'pave':>4} {'terr':>5} {'p.terr':>6} {'treads':>9} {'paint':>9} {'yellow':>8} {'rails':>9} {'alias':>9}")
    for png in sorted(a.shots.glob("*.png")):
        labels = png.with_suffix(".json")
        if not labels.is_file() or png.stem.endswith("@2x"):
            continue
        name = png.stem
        shot = json.loads(labels.read_text())
        r, p = measure(png, shot, marks), photo(name.removeprefix("realm-"), refs, a.photos)
        bad = verdicts(name, r, most)
        failed += bool(bad)
        results[name] = {"render": r, "photo": p, "fails": bad}
        f = lambda v, n=0: "-" if v is None else f"{v:.{n}f}"
        print(
            f"{name:24} {f(r['asphaltLit']):>4} {f(r['pavement']):>4} {f(r['terraces'], 3):>5} {f(r['pavementTerraces'], 3):>6} {f(r['roadTreads'], 2):>4}/{f(r['pavementTreads'], 2):<4}"
            f" {f(r['markings'], 2):>4}/{r['paintOwed']:<4} {f(r['yellow'], 2):>4}/{r['yellowOwed']:<3} {f(r['rails'], 2):>4}/{r['railRuns']:<4} {f(r['aliasing'], 2):>4}/{r['aliasBoxes']:<4}"
            f"  {'FAIL ' + '; '.join(bad) if bad else 'ok'}"
        )
    # The photographs against the same thresholds: a threshold they fail is fitted to the renders.
    for name, ref in refs.items():
        if name.startswith("_"):
            continue
        p = photo(name, refs, a.photos)
        if p and p.get("pavement") and p["asphalt"] > 0.9 * p["pavement"]:
            print(f"  photograph {name}: road {p['asphalt']:.0f} not darker than its pavement {p['pavement']:.0f}")
        if p and name in CLIMBS and p["terraces"] > 0.09:
            print(f"  photograph {name}: terraces {p['terraces']:.3f}")
    print(f"{failed} of {len(results)} views fail")
    if a.json:
        a.json.write_text(json.dumps(results, indent=1))
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
