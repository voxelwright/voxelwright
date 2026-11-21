"""What a person sees wrong at street level in San Francisco (#450), measured in the pictures themselves.

    ~/.village/engine/bay/venv/bin/python -I engine/sf/street_checks.py ~/.village/engine/sf/street/new [--photos DIR] [--json out.json]

Reads the <view>.png and <view>.json pairs sf/street-shots.mjs writes. The json's grid says what the march hit
under a grid of pixels (material, colour, distance in 10 cm cells); every measure below reads the png's own pixels
at those places, so a builder's score file decides nothing.

asphalt   the road's brightness. In the picture: the median luminance of sunlit asphalt pixels within 40 m against
          that of sunlit pavement (material concrete in its own colour), sunlit being over half the brightest of
          either. Fails where the asphalt is not darker by a tenth, or where that ratio is over the most the
          photographs show (the upper quartile of a road patch over a pavement patch, street-refs.json: patches
          chosen by looking at each photograph) by 0.05. The ratio holds whatever the exposure; the upper quartile
          of the asphalt against the photograph's road patch is reported beside it, not judged: half the
          photographs are overcast or in shade (Outer Sunset, Painted Ladies, Dogpatch), and no sunlit render
          matches their exposure.
terraces  the staircase of a street on a hill: in the 12 x 9 pixel box round each asphalt pixel within 30 m, the
          mean of each row, and the share of neighbouring rows whose means differ by 12 or more. Lines across the
          road (a riser drawn dark or bright at every 10 cm step) survive the row's mean; grain and lines along
          the road do not. Fails over 0.06 where the view's road climbs (Powell, California, Filbert and the
          panel's hill views) and 150 or more of its labelled pixels are asphalt.
markings  that lane lines, centre lines and crossings are there where the street graph puts them: the share of
          asphalt pixels within 30 m that are paint (white or yellow on asphalt: palette colours 2 and 59; rails, greys
          6 and 14 of the road, are neither paint nor road here). In the realm's views (the page server the panel uses has no graph), it fails with
          none where the graph's marks (dist-sf/bay/marks.bin, sf/marks.mjs) come within 2 to 25 m ahead in view.

The same asphalt and terrace measures are run on each photograph's patches, so a threshold that the photographs
themselves fail would show.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).parent
PHOTOS = Path.home() / ".village/engine/bay/450-panel/references"
ASPHALT, CONCRETE, STEEL = 6, 7, 12
# Paint on a road (bay.rs `mark_at`): white is palette grey 1 (index 2), yellow hue 4 tone 3 (59). Rails (grey 5 and
# 13 of the road, indices 6 and 14) are not paint.
PAINT = {2, 59}
MARKS_NOT_ROAD = PAINT | {6, 14}
CLIMBS = {"Powell", "California", "Filbert", "Telegraph Hill", "Nob Hill", "Russian Hill"}
CLIMBS |= {f"realm-{c}" for c in CLIMBS}
MARKS = Path(__file__).parent.parent / "dist-sf/bay/marks.bin"


def lum(rgb):
    return rgb[..., :3].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)


def patch(l, box):
    h, w = l.shape
    x0, y0, x1, y1 = box
    return l[int(y0 * h) : int(y1 * h), int(x0 * w) : int(x1 * w)]


def q75(v):
    return float(np.percentile(v, 75)) if len(v) else None


def measure(png, labels):
    l = lum(np.asarray(Image.open(png).convert("RGB")))
    grid = labels["grid"]
    at = lambda px, py: float(l[py - 1 : py + 2, px - 1 : px + 2].mean())
    road = [at(px, py) for px, py, m, c, t in grid if m == ASPHALT and c not in MARKS_NOT_ROAD and t < 400]
    pave = [at(px, py) for px, py, m, c, t in grid if m == CONCRETE and c == 0 and t < 400]
    near = [(px, py, m, c) for px, py, m, c, t in grid if t < 300]
    paint = sum(1 for _, _, m, c in near if m == ASPHALT and c in PAINT)
    asphalt = sum(1 for _, _, m, c in near if m == ASPHALT)
    # Terraces: every pixel pair one row apart inside the labelled asphalt cells' own 12 x 9 boxes.
    jumps = pairs = 0
    for px, py, m, c in near:
        if m != ASPHALT or c in MARKS_NOT_ROAD:
            continue
        rows = l[py - 4 : py + 5, px - 6 : px + 6].mean(1)
        d = np.abs(np.diff(rows))
        jumps += int((d >= 12).sum())
        pairs += d.size
    # Like light: the sunlit pixels of each (over half the brightest of either), so the share in shade does not decide.
    lit = 0.5 * float(np.percentile(road + pave, 95)) if road + pave else 0
    sunny = lambda v: [x for x in v if x > lit]
    road_lit, pave_lit = sunny(road), sunny(pave)
    return {
        "asphalt": q75(road),
        "asphaltLit": float(np.median(road_lit)) if len(road_lit) >= 15 else None,
        "pavement": float(np.median(pave_lit)) if len(pave_lit) >= 15 else None,
        "roadPixels": len(road),
        "terraces": round(jumps / pairs, 4) if pairs else None,
        "markings": round(paint / asphalt, 4) if asphalt else None,
    }


def expected(camera, marks):
    """How many of the graph's mark segments (sf/marks.mjs) pass within 25 m ahead of the camera, in its view."""
    if marks is None or "z" not in camera:
        return None
    x, z, yaw = camera["x"] * 10, camera["z"] * 10, camera["yaw"]
    fx, fz = np.sin(yaw), -np.cos(yaw)
    n = 0
    for x0, z0, x1, z1, style in marks:
        seen = 0
        for t in np.linspace(0, 1, 21):
            dx, dz = x0 + (x1 - x0) * t - x, z0 + (z1 - z0) * t - z
            ahead = dx * fx + dz * fz
            seen += 20 < ahead < 250 and abs(dx * fz - dz * fx) < ahead * 0.9
        # A dashed line has 6 m between its dashes: it is owed only where 9 m of it are in view.
        if seen and (style != 2 or seen / 21 * np.hypot(x1 - x0, z1 - z0) >= 90):
            n += 1
    return n


def photo(place, refs):
    ref = refs.get(place)
    path = PHOTOS / f"{place}.jpg"
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


def verdicts(name, r, p, most):
    bad = []
    if r["asphaltLit"] is not None and r["pavement"] is not None:
        ratio = r["asphaltLit"] / r["pavement"]
        if ratio > 0.9:
            bad.append(f"sunlit asphalt {r['asphaltLit']:.0f} not darker than sunlit pavement {r['pavement']:.0f}")
        if ratio > most + 0.05:
            bad.append(f"asphalt over pavement {ratio:.2f}, the photographs' most {most:.2f}")
    if name in CLIMBS and r["terraces"] is not None and r["roadPixels"] >= 150 and r["terraces"] > 0.06:
        bad.append(f"terraces {r['terraces']:.3f}")
    if r.get("expected") and not r["markings"]:
        bad.append(f"no markings where the graph has {r['expected']}")
    return bad


def main():
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cli.add_argument("shots", type=Path)
    cli.add_argument("--json", type=Path)
    a = cli.parse_args()
    refs = json.loads((HERE / "street-refs.json").read_text())
    marks = None
    if MARKS.is_file():
        w = np.frombuffer(MARKS.read_bytes(), "<i4")
        marks = w[3 + w[1] * 4 :].reshape(-1, 5)
    results, failed = {}, 0
    # The photographs' own road over pavement where they show both: the most of them is the bar a render's must meet.
    ratios = {n: q["asphalt"] / q["pavement"] for n in refs if not n.startswith("_") for q in [photo(n, refs)] if q and q.get("pavement")}
    most = max(ratios.values())
    print("photographs' road over pavement:", {n: round(v, 2) for n, v in ratios.items()})
    print(f"{'view':20} {'asphalt':>7} {'pave':>5} {'photo':>5} {'ph.pave':>7} {'terr':>6} {'ph.terr':>7} {'marks':>6}")
    for png in sorted(a.shots.glob("*.png")):
        labels = png.with_suffix(".json")
        if not labels.is_file():
            continue
        name = png.stem
        shot = json.loads(labels.read_text())
        r, p = measure(png, shot), photo(name.removeprefix("realm-"), refs)
        # Marks are drawn only where the page has the graph: the realm (the panel's page server has none).
        r["expected"] = expected(shot["camera"], marks) if name.startswith("realm-") or name in ("Powell", "California", "Filbert") else None
        bad = verdicts(name, r, p, most)
        failed += bool(bad)
        results[name] = {"render": r, "photo": p, "fails": bad}
        f = lambda v, n=0: "-" if v is None else f"{v:.{n}f}"
        print(
            f"{name:20} {f(r['asphalt']):>7} {f(r['pavement']):>5} {f(p and p['asphalt']):>5} {f(p and p.get('pavement')):>7}"
            f" {f(r['terraces'], 3):>6} {f(p and p['terraces'], 3):>7} {f(r['markings'], 3):>6}  {'FAIL ' + '; '.join(bad) if bad else 'ok'}"
        )
    # The photographs against the same thresholds: a threshold they fail is fitted to the renders.
    for name, ref in refs.items():
        if name.startswith("_"):
            continue
        p = photo(name, refs)
        if p and p.get("pavement") and p["asphalt"] > 0.9 * p["pavement"]:
            print(f"  photograph {name}: road {p['asphalt']:.0f} not darker than its pavement {p['pavement']:.0f}")
        if p and name in CLIMBS and p["terraces"] > 0.06:
            print(f"  photograph {name}: terraces {p['terraces']:.3f}")
    print(f"{failed} of {len(results)} views fail")
    if a.json:
        a.json.write_text(json.dumps(results, indent=1))
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
