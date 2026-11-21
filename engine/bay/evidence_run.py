"""Measure building records for a named set and keep them per square, resumable (#450).

    panel    buildings with a street wall within 45 m of each of the 16 panel places' street camera
    sample   500 buildings drawn at random (seed 450) from every surveyed square's street buildings, away from the panel
    city     every street building of the listed squares
    cities   fill in the city's building number (facade_evidence `city_of`) on records that lack it, measuring nothing

Records go to ~/.village/engine/bay/450-city-paint/evidence/<into>/<set>/<square>.json (`--into`, records by default);
the sample's draw is kept under records/sample so the same buildings are measured again.

    evidence-venv/bin/python engine/bay/evidence_run.py panel
"""

import argparse
import json
import random
import time

import numpy as np

import facade_evidence as fe
from tiles import read

POSES = fe.BAY / "450-panel/fixed-poses.json"


def street_rows(p):
    return [n for n, (verts, _) in enumerate(p["buildings"]) if any(f & 3 == 3 for *_, f in verts)]


def panel_targets():
    poses = json.loads(POSES.read_text())
    out = {}
    for r in fe.PANEL:
        x, _, z, *_ = poses[r["place"]]["street"]
        out.setdefault(r["square"], set()).update(fe.near(r["square"], x, z, 45))
    return {k: sorted(v) for k, v in out.items()}


def sample_targets(n=500, seed=450):
    path = fe.HOME / "records/sample/draw.json"
    if path.is_file():
        return json.loads(path.read_text())
    poses = json.loads(POSES.read_text())
    places = np.array([(v["street"][0] * 10, v["street"][2] * 10) for v in poses.values()])
    pool = []
    for pack in sorted((fe.CITY / "packs").glob("*.bay.zst")):
        square = pack.name[: -len(".bay.zst")]
        p = read(fe.CITY / "packs" / (square + ".bay"))
        for row in street_rows(p):
            at = fe.centre(p["buildings"][row][0])
            if np.hypot(*(places - at).T).min() > 1500:
                pool.append((square, row))
    rng = random.Random(seed)
    draw = sorted(rng.sample(pool, n))
    out = {}
    for square, row in draw:
        out.setdefault(square, []).append(row)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(dict(pool=len(pool), seed=seed, n=n, squares=out)))
    return json.loads(path.read_text())


def run(name, targets, material=True, refresh=False, into="records"):
    faces = fe.Faces(fe.Fetcher(), fe.Segmenter())
    classifier = fe.Classifier() if material else None
    folder = fe.HOME / into / name
    folder.mkdir(parents=True, exist_ok=True)
    began = time.time()
    for square, rows in sorted(targets.items()):
        path = folder / (square + ".json")
        done = json.loads(path.read_text()) if path.is_file() and not refresh else {}
        todo = [r for r in rows if r not in {v["row"] for v in done.values()}]
        for i in range(0, len(todo), 10):
            done.update(fe.measure(square, todo[i : i + 10], faces, classifier))
            tmp = path.with_suffix(".part")
            tmp.write_text(json.dumps(done))
            tmp.replace(path)
            print(name, square, len(done), "of", len(rows), "faces", faces.segmented, "calls", faces.fetcher.calls, round(time.time() - began), "s", flush=True)


def cities(into):
    """The city's building number on every record under `into` that lacks one (the far model finds records by it)."""
    for path in sorted((fe.HOME / into).rglob("*.json")):
        if path.name == "draw.json":
            continue
        recs = json.loads(path.read_text())
        p = read(fe.CITY / "packs" / (next(iter(recs.values()))["square"] + ".bay")) if recs else None
        filled = 0
        for rec in recs.values():
            if not rec.get("city"):
                rec["city"] = fe.city_of(rec["square"], p["buildings"][rec["row"]][0])
                filled += bool(rec["city"])
        tmp = path.with_suffix(".part")
        tmp.write_text(json.dumps(recs))
        tmp.replace(path)
        print(path.relative_to(fe.HOME), filled, "of", len(recs), flush=True)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("set", choices=["panel", "sample", "city", "cities"])
    cli.add_argument("--squares", nargs="*")
    cli.add_argument("--refresh", action="store_true", help="measure every building again (photos and labels are cached)")
    cli.add_argument("--into", default="records", help="the records folder under the evidence home")
    a = cli.parse_args()
    if a.set == "cities":
        cities(a.into)
    elif a.set == "panel":
        run("panel", panel_targets(), refresh=a.refresh, into=a.into)
    elif a.set == "sample":
        run("sample", sample_targets()["squares"], refresh=a.refresh, into=a.into)
    else:
        run("city", {s: street_rows(read(fe.CITY / "packs" / (s + ".bay"))) for s in a.squares}, into=a.into)


if __name__ == "__main__":
    main()
