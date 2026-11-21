"""Does a records folder get walls' lightness right? A check that does not read the photographs the way the records do
(#450).

PR 484's held-out check read a reserved photograph with the records' own method, so a bias shared by every photograph
(an auto exposure that reads sunlit cream fronts at sRGB 130) passed it. This one compares against two references
outside that pipeline:

    eye     82 panel walls classed light, mid or dark by eye from the photographs at full size (evidence_eye.json):
            white, cream and pale fronts; tan, sage, slate, saturated paint and yellow brick; red brick, navy and black.
            Two-sided: the dark walls must stay dark.
    bake    the bake's own wall colour for each measured building (bake.py: the pale paints, greys and brick a street
            here is known for), as a population: the measured walls' median lightness must not sit far from it.

The bars were fixed before any new reading was scored (November 21, 2026):
    light walls   median L* >= 68, and no more than 10% under L* 50
    dark walls    median L* <= 52, and no more than 10% at L* 68 or more
    mid walls     median L* between 45 and 75
    population    the median of (measured L* - bake L*) over every trusted wall within 15 either way

    evidence-venv/bin/python engine/bay/evidence_check.py ~/.village/engine/bay/450-city-paint/evidence/records/panel
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

import evidence_tile
import facade_evidence as fe
from bake import palette
from tiles import read

EYE = json.loads(Path(__file__).with_name("evidence_eye.json").read_text())
BARS = dict(light_median=68, light_dark_share=0.10, dark_median=52, dark_light_share=0.10, mid=(45, 75), population=15)
# A kind with colour 0 is drawn in its material's own colour (march.ts `materials`).
OWN = {7: "a9a69f", 8: "a4553d", 9: "cfc6b4", 10: "b98a5a", 11: "9fc3d6"}


def lstar(srgb):
    return float(fe.lab(fe.linear(np.asarray(srgb, "f4")))[0])


def bake_srgb(kind):
    if kind >> 8 & 255:
        return palette()[kind >> 8 & 255] * 255
    h = OWN.get(kind & 15, "a9a69f")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], "f4")


def check(records):
    """records: {key: record}. Returns the scores and whether every bar holds."""
    by_row = {(r["square"], r["row"]): r for r in records.values()}
    classes = {"light": [], "mid": [], "dark": []}
    missing = 0
    for e in EYE:
        r = by_row.get((e["square"], e["row"]))
        w = r and r.get("wall")
        if not (w and w.get("trusted")):
            missing += 1
            continue
        classes[e["eye"]].append(lstar(w["srgb"]))
    packs, delta = {}, []
    for r in records.values():
        w = r.get("wall")
        if not (w and w.get("trusted")):
            continue
        if r["square"] not in packs:
            packs[r["square"]] = read(fe.CITY / "packs" / (r["square"] + ".bay"))
        kind = packs[r["square"]]["buildings"][r["row"]][1][0]
        delta.append(lstar(w["srgb"]) - lstar(bake_srgb(kind)))
    L, M, D = (np.array(classes[k]) for k in ("light", "mid", "dark"))
    med = lambda a: float(np.median(a)) if len(a) else float("nan")
    out = dict(
        scored=dict(light=len(L), mid=len(M), dark=len(D), unmeasured=missing),
        light=dict(median=round(med(L), 1), under50=round(float((L < 50).mean()) if len(L) else 0, 2)),
        mid=dict(median=round(med(M), 1)),
        dark=dict(median=round(med(D), 1), over68=round(float((D >= 68).mean()) if len(D) else 0, 2)),
        population=dict(walls=len(delta), median_delta=round(med(np.array(delta)), 1), measured_median=None),
    )
    out["population"]["measured_median"] = round(med(np.array([lstar(r["wall"]["srgb"]) for r in records.values() if r.get("wall", {}).get("trusted")])), 1)
    b = BARS
    out["pass"] = dict(
        light=bool(out["light"]["median"] >= b["light_median"] and out["light"]["under50"] <= b["light_dark_share"]),
        dark=bool(out["dark"]["median"] <= b["dark_median"] and out["dark"]["over68"] <= b["dark_light_share"]),
        mid=bool(b["mid"][0] <= out["mid"]["median"] <= b["mid"][1]),
        population=bool(abs(out["population"]["median_delta"]) <= b["population"]),
    )
    out["ok"] = all(out["pass"].values())
    return out


def main():
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cli.add_argument("records", type=Path)
    a = cli.parse_args()
    out = check(evidence_tile.load(str(a.records)))
    print(json.dumps(out, indent=1))
    sys.exit(0 if out["ok"] else 1)


if __name__ == "__main__":
    main()
