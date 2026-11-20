"""Accept a paint batch only when every fixed view passes checks that read its pixels (#450), and, where the
building lane supplies scores, when none falls below a floor that a passing render earned.

The gate used to read only a scores file, so the first baseline (Nob Hill at 4.5/10, with pillars, ribbed walls
and narrow windows) became a floor with its defects included. Now each view's render and reference photograph are
measured (render_checks.py) and read by a vision judge, and a score is a floor only for a view whose render passed.

    python panel_gate.py --shots DIR                      every view in DIR as <place>-<0|1>.png
    python panel_gate.py --shots DIR candidate previous   and its scores against the previous ones
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
import math
from pathlib import Path

HERE = Path(__file__).parent
REFERENCES = Path.home() / ".village/engine/bay/450-panel/references"
VIEWS = ("street", "100 m")
# Lamp masts, trunks and distant towers against the sky stand in the fixed renders with every unspanned pole gone:
# at most three more than the photograph shows (Embarcadero, Fishermans Wharf, SoMa). Nob Hill's pillars made seven.
PILLAR_EXCESS = 4
# Bump when a check or its threshold changes: cached inspections are keyed by it.
VERSION = 1


def places():
    return [r["place"] for r in json.loads((HERE / "neighbourhoods.json").read_text())]


def digest(path):
    return sha256(Path(path).read_bytes()).hexdigest()


def reference(place, view):
    return REFERENCES / (place + ("" if view == 0 else " 100 m") + ".jpg")


def inspect(place, view, render, cache, judge=True):
    """One view's measurements, the judge's reading and the defects that fail it. Cached by both pictures' bytes."""
    import render_checks as rc

    ref = reference(place, view)
    key = sha256(
        json.dumps([VERSION, digest(render), digest(ref), rc.JUDGE_MODEL if judge else None]).encode()
    ).hexdigest()
    stored = Path(cache) / (key + ".json")
    if stored.is_file():
        return json.loads(stored.read_text())
    defects, checks = [], {}
    if view == 0:
        shot, photo = rc.load(render), rc.load(ref)
        found, seen = rc.pillars(shot), rc.pillars(photo)
        excess = len(found) - len(seen)
        checks["pillars"] = dict(render=len(found), reference=len(seen), excess=excess, limit=PILLAR_EXCESS, at=found[:16])
        if excess >= PILLAR_EXCESS:
            defects.append(f"pillars: {len(found)} thin uprights against the sky, {len(seen)} in the photograph")
        checks["banding"] = dict(render=rc.banding(shot), reference=rc.banding(photo), decides=False)
        checks["windows"] = dict(render=rc.windows(shot), reference=rc.windows(photo), decides=False)
    else:
        for name in ("pillars", "banding", "windows"):
            checks[name] = "not applicable to a view from 100 m"
    verdict = None
    if judge:
        verdict = rc.judge(render, ref, VIEWS[view] + (" level" if view == 0 else " above, looking down"),
                           Path(cache) / "judge" / key)
        if "error" in verdict:
            defects.append("judge: " + verdict["error"])
        else:
            defects += [f"judge: {d['name']} ({d['where']})" for d in verdict["defects"]
                        if d["clear"] and d["name"] in rc.DEFECTS]
    record = dict(place=place, view=VIEWS[view], render=digest(render), reference=digest(ref), version=VERSION,
                  checks=checks, judge=verdict, defects=defects, passed=not defects)
    if verdict is None or "error" not in verdict:
        stored.parent.mkdir(parents=True, exist_ok=True)
        stored.write_text(json.dumps(record, indent=1) + "\n")
    return record


def gate(shots, cache, judge=True, workers=4):
    """Inspect every view of every place. `shots` maps a place to its two renders. Returns {place: [street, 100 m]}
    and raises if any view fails or is missing."""
    if set(shots) != set(places()) or any(len(pair) != 2 for pair in shots.values()):
        raise ValueError("the pixel gate needs both renders of every panel place")
    jobs = [(p, v, shots[p][v]) for p in places() for v in (0, 1)]
    with ThreadPoolExecutor(workers) as pool:
        records = list(pool.map(lambda job: inspect(*job, cache, judge), jobs))
    report = {p: [r for r in records if r["place"] == p] for p in places()}
    failed = [f"{r['place']} {r['view']}: {'; '.join(r['defects'])}" for r in records if not r["passed"]]
    if failed:
        raise ValueError("pixel gate: " + " | ".join(failed))
    return report


def check(scores, previous, judged=None):
    """No view may fall below its previous score or panel-floors.json. With `judged` (a set of (place, view index)),
    only views whose previous render passed the pixel gate hold a floor; None keeps every floor, as receipts
    accepted before the pixel gate were checked."""
    names = set(places())
    floors = json.loads((HERE / "panel-floors.json").read_text())
    for sheet in (scores, previous, floors):
        if set(sheet) != names:
            raise ValueError(f"panel names differ: {sorted(names.symmetric_difference(sheet))}")
        for name, pair in sheet.items():
            if (
                not isinstance(pair, list)
                or len(pair) != 2
                or any(type(n) not in (float, int) or not math.isfinite(n) or not 0 <= n <= 10 for n in pair)
            ):
                raise ValueError(f"{name} needs two finite scores in [0, 10]")
    drops = []
    for name, pair in scores.items():
        for i, view in enumerate(VIEWS):
            if judged is not None and (name, i) not in judged:
                continue
            floor = max(previous[name][i], floors[name][i])
            if pair[i] < floor:
                drops.append(f"{name} {view}: {pair[i]} < {floor}")
    if drops:
        raise ValueError("regression: " + ", ".join(drops))
    return len(names) * 2


def summary(report):
    lines = []
    for place, pair in report.items():
        for r in pair:
            c = r["checks"].get("pillars")
            pillars = f"pillars {c['render']} vs {c['reference']}" if isinstance(c, dict) else "pillars n/a"
            band = r["checks"].get("banding")
            ribs = (f"ribs {band['render']['ribs']} vs {band['reference']['ribs']}"
                    if isinstance(band, dict) and band["render"] and band["reference"] else "ribs n/a")
            judged = r["judge"]
            named = ("judge " + (", ".join(f"{d['name']}{'' if d['clear'] else '?'}" for d in judged["defects"]) or "clean")
                     if judged and "defects" in judged else "judge " + ("error" if judged else "off"))
            lines.append(f"{'PASS' if r['passed'] else 'FAIL'}  {place:19s} {r['view']:7s} {pillars:18s} {ribs:18s} {named}")
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--shots", type=Path, help="a folder of <place>-0.png and <place>-1.png")
    parser.add_argument("--cache", type=Path, help="where inspections are kept (default: <shots>/inspections)")
    parser.add_argument("--no-judge", action="store_true", help="pixel measures only; never enough to accept")
    parser.add_argument("--report", type=Path)
    parser.add_argument("candidate", type=Path, nargs="?")
    parser.add_argument("previous", type=Path, nargs="?", help="accepted scores immediately before this pass")
    args = parser.parse_args()
    if not args.shots and not args.candidate:
        parser.error("give --shots, scores, or both")
    try:
        if args.shots:
            shots = {p: [args.shots / f"{p}-{i}.png" for i in (0, 1)] for p in places()}
            cache = args.cache or args.shots / "inspections"
            try:
                report = gate(shots, cache, not args.no_judge)
                failure = None
            except ValueError as error:
                failure = error
                report = {p: [inspect(p, i, shots[p][i], cache, not args.no_judge) for i in (0, 1)] for p in places()}
            print(summary(report))
            if args.report:
                args.report.write_text(json.dumps(report, indent=1) + "\n")
            if failure:
                raise failure
        if args.candidate:
            if not args.previous:
                parser.error("scores need the previous scores")
            print(check(*(json.loads(p.read_text()) for p in (args.candidate, args.previous))), "scores hold")
        print("pass")
    except ValueError as e:
        parser.exit(1, str(e) + "\n")
