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
import struct
import sys
from pathlib import Path

import numpy as np

import evidence_tile
import facade_evidence as fe
from bake import palette
from tiles import read
from compact_store import split_tile

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


def check_tiles(source, before, after):
    """Compare two exported L0 directories. Compute the permitted byte edits directly from the reviewed fields."""
    windows, _ = evidence_tile.load_reviewed(source, "10n4250")
    records = {key: record for window in windows.values() for key, record in window.items()}
    found, applied = set(), set()
    changed, bad = {}, []
    rows = misses = false_matches = 0
    old_files = {p.name for p in before.glob("*.bay")}
    new_files = {p.name for p in after.glob("*.bay")}
    if old_files != new_files or not old_files:
        raise ValueError("expected corresponding level-zero tiles in both directories")
    for name in sorted(old_files):
        old, new = (before / name).read_bytes(), (after / name).read_bytes()
        h = struct.unpack_from("<16i", old)
        if h[3] != 2500:
            raise ValueError(f"expected level-zero tile: {name}")
        start = evidence_tile.rows_at(h)
        vertices = start + 24 * h[12]
        _, paint = split_tile(old)
        painted = {struct.unpack_from("<I", p)[0] for p in paint or ()}
        expected = bytearray(old)
        for n in range(h[12]):
            at = start + n * 24
            first, count, wall, trim, style, _ = struct.unpack_from("<6I", old, at)
            lo = vertices + 12 * first
            verts = list(struct.iter_unpack("<3i", old[lo:lo + 12 * count]))
            key = ";".join(f"{x},{z}" for x, z, _ in verts)
            r = records.get(key)
            rows += 1
            if r and r["ends"] == [i for i, v in enumerate(verts) if v[2] & 4]:
                found.add(key)
                if (wall == r["fromWall"] and style & 65536 and not style & (3 << 17)
                        and not trim & 65536 and painted.isdisjoint(range(first, first + count))):
                    if "palette" in r:
                        wall = (wall & ~65280) | (r["palette"] << 8)
                        trim |= 65536
                    if "material" in r:
                        wall = (wall & ~15) | r["material"]
                    struct.pack_into("<2I", expected, at + 8, wall, trim)
            if old[at:at+24] != expected[at:at+24]:
                applied.add(key)
                changed[name] = changed.get(name, 0) + 1
                misses += expected[at:at+24] != new[at:at+24]
            elif old[at:at+24] != new[at:at+24]:
                false_matches += 1
        if new != expected:
            bad.append(name)
    return dict(records=len(records), matched=len(found), eligible=len(applied), rows=rows, expectedEdits=changed,
                missedRows=misses, unexpectedRows=false_matches, incorrectTiles=bad,
                ok=bool(applied) and len(found) == len(records) and not bad)


def main():
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cli.add_argument("records", type=Path)
    cli.add_argument("--tiles", type=Path, nargs=2, metavar=("BEFORE", "AFTER"),
                     help="audit a reviewed source against two exported level-zero tile directories")
    a = cli.parse_args()
    out = check_tiles(a.records, *a.tiles) if a.tiles else check(evidence_tile.load(str(a.records)))
    print(json.dumps(out, indent=1))
    sys.exit(0 if out["ok"] else 1)


if __name__ == "__main__":
    main()
