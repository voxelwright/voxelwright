"""Prove the building records on the 16-place panel (#450): stage the round-2 panel tiles with the records written
in, render them once, and say per changed building whether its wall moved towards the photograph.

The photograph is each place's reserved panel reference: a Mapillary panorama that no record used (facade_evidence
`cameras` leaves it and every camera within 5 m of it out). Its wall colour for a building is read the way a view is
(the same projection, segmentation and clipping rules), and compared with the colour the renderer gave the wall
before (the bake's row, or PR 474's paint majority) and after. Chroma (CIELAB a*, b*) decides; lightness is reported
apart, because a bias shared by every photograph (an exposure that reads walls dark) would favour the records.

    evidence-venv/bin/python engine/bay/evidence_proof.py stage|render|compare
"""

import argparse
import json
import shutil
import struct
from pathlib import Path

import numpy as np

import evidence_tile
import facade_evidence as fe
from bake import palette

ROUND2 = fe.BAY / "450-city-paint/quality/round2"
BASE = ROUND2 / "work/base"
BEFORE = ROUND2 / "shots/cand5"  # the 32 renders PR 474's gate graded (gate-new.json), byte for byte
PROOF = fe.HOME / "proof"
GROUPS = json.loads((fe.BAY / "450-paint/evidence.json").read_text())["views"]


def records(sets=("panel", "sample")):
    out = {}
    for s in sets:
        folder = fe.HOME / "records" / s
        if folder.is_dir():
            out.update(evidence_tile.load(str(folder)))
    return out


def stage():
    recs = records()
    stats = {}
    for group in sorted({v["group"] for v in GROUPS.values()}):
        src, dst = BASE / group / "packs", PROOF / "after" / group / "packs"
        if dst.exists():
            shutil.rmtree(dst)
        dst.mkdir(parents=True)
        for f in src.iterdir():
            if f.is_file():
                (dst / f.name).symlink_to(f.resolve())
        for f in (src / "tiles").rglob("*"):
            if not f.is_file():
                continue
            out = dst / "tiles" / f.relative_to(src / "tiles")
            out.parent.mkdir(parents=True, exist_ok=True)
            data = f.read_bytes()
            new = evidence_tile.apply(data, recs, stats) if f.suffix == ".bay" else data
            if new == data:
                out.symlink_to(f.resolve())
            else:
                out.write_bytes(new)
                stats["tiles"] = stats.get("tiles", 0) + 1
    print(json.dumps(stats))


def render():
    from city_panel import shot

    dest = PROOF / "shots"
    dest.mkdir(parents=True, exist_ok=True)
    for group in sorted({v["group"] for v in GROUPS.values()}):
        places = [r for r in fe.PANEL if GROUPS[r["place"]]["group"] == group]
        shot(PROOF / "after" / group, places, dest)


def painted_majority(tail, first, count):
    """bay.rs `painted_colour` over a building's SFPT rows: the colour a building took from paint, or None."""
    dark = lambda v: v >= 9 if v < 16 else (v - 16) % 10 in (5, 6, 9)
    count_ = np.zeros(256, int)
    for edge, cells in tail.items():
        if first <= edge < first + count:
            for c in cells:
                if c and not dark(c):
                    count_[c] += 1
    total, best = count_.sum(), int(np.argmax(count_))
    return best if total >= 24 and count_[best] * 10 >= total * 3 and best > 2 else None


def tile_rows(group):
    """Every level-0 building row of a group's tiles as the renderer reads its wall: key -> (kind before, painted)."""
    from paint_tile import records as sfpt

    out = {}
    for f in (BASE / group / "packs/tiles/0").glob("*.bay"):
        b = f.read_bytes()
        h = struct.unpack_from("<16i", b)
        at = 64 + 2 * h[5] ** 2 + 4 * h[9] ** 2
        vat = at + 24 * h[12]
        verts = list(struct.iter_unpack("<3i", b[vat : vat + 12 * h[13]]))
        end = vat + 12 * h[13] + 16 * h[14]
        if b[end : end + 4] == b"SFST":
            end += 8 + 32 * struct.unpack_from("<I", b, end + 4)[0]
        tail = {e: v[8:] for e, v in sfpt(b[end:])} if b[end : end + 4] == b"SFPT" else {}
        for n in range(h[12]):
            first, count, wall = struct.unpack_from("<2iI", b, at + 24 * n)
            key = ";".join(f"{x},{z}" for x, z, _ in verts[first : first + count])
            out[key] = (wall, painted_majority(tail, first, count))
    return out


class Reference(fe.Fetcher):
    """The panel's reserved photographs, kept apart from the evidence's photos and poses."""

    def photo(self, ident):
        return fe.HOME / "reference" / (ident + ".jpg")

    def fetch(self, ident):
        folder = fe.HOME / "reference"
        folder.mkdir(parents=True, exist_ok=True)
        meta_path = folder / (ident + ".json")
        if not meta_path.is_file():
            fields = "id,camera_type,computed_geometry,computed_rotation,captured_at,thumb_2048_url"
            meta = json.loads(self.get(f"https://graph.mapillary.com/{ident}?fields={fields}", True))
            url = meta.pop("thumb_2048_url")
            (folder / (ident + ".jpg")).write_bytes(self.get(url, False))
            meta_path.write_text(json.dumps(meta))
        return fe._row(json.loads(meta_path.read_text()), None)


def lab_of(srgb01):
    return fe.lab(fe.linear(np.asarray(srgb01) * 255))


def compare():
    from tiles import read

    table = palette()
    # A kind with colour 0 is drawn in its material's own colour (march.ts `materials`).
    own = {k: np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)]) / 255 for k, h in {7: "a9a69f", 8: "a4553d", 9: "cfc6b4", 10: "b98a5a", 11: "9fc3d6"}.items()}
    ref = Reference()
    faces = fe.Faces(ref, fe.Segmenter())
    recs = records(("panel",))
    poses = json.loads((fe.BAY / "450-panel/fixed-poses.json").read_text())
    rows, summary = [], {}
    for r in fe.PANEL:
        place, square, group = r["place"], r["square"], GROUPS[r["place"]]["group"]
        cam = ref.fetch(r["image"])
        fe.cameras()["meta"][r["image"]] = cam
        before = tile_rows(group)
        p = read(fe.CITY / "packs" / (square + ".bay"))
        a, b = cam[1], cam[2]
        i, j = int(round((a - p["gx0"]) / 10)), int(round((b - p["gz0"]) / 10))
        eye = int(p["ground"][j, i]) + 25
        x, _, z, *_ = poses[place]["street"]
        s = summary.setdefault(place, dict(buildings=0, records=0, trusted=0, changed=0, seen=0, closer=0, farther=0))
        for n in fe.near(square, x, z, 45):
            verts, row = p["buildings"][n]
            key = fe.key_of(verts)
            s["buildings"] += 1
            rec = recs.get(key)
            if not rec:
                continue
            s["records"] += 1
            s["trusted"] += bool(rec.get("wall", {}).get("trusted"))
            if key not in before:
                continue
            wall, painted = before[key]
            new = evidence_tile.fields(rec, wall, row[1])
            if not new:
                continue
            old_kind = (wall & 15) | (painted << 8) if painted else wall
            if new[0] == old_kind:
                continue
            s["changed"] += 1
            walls = fe.walls_of(p, verts, row)
            v = fe.view(p, walls, (0, r["image"], a, b, eye), faces)
            c = fe.view_colour(v) if v else None
            entry = dict(place=place, row=n, before=old_kind, after=new[0], material=rec.get("material", {}).get("cls"))
            if c is not None and c[2] <= fe.CLIPPED:
                s["seen"] += 1
                photo = fe.lab(c[0])
                colour = lambda k: own[k & 15] if k >> 8 == 0 else table[k >> 8]
                lb, la = lab_of(colour(old_kind)), lab_of(colour(new[0]))
                db, da = float(np.hypot(*(lb - photo)[1:])), float(np.hypot(*(la - photo)[1:]))
                entry.update(photo=[int(v) for v in fe.encoded(c[0])], chroma=[round(db, 1), round(da, 1)], lightness=[round(float(lb[0] - photo[0]), 1), round(float(la[0] - photo[0]), 1)])
                s["closer"] += da < db - 2
                s["farther"] += da > db + 2
            rows.append(entry)
    out = PROOF / "compare.json"
    out.write_text(json.dumps(dict(summary=summary, buildings=rows), indent=1))
    print(json.dumps(summary, indent=1))


def summary():
    """Coverage of each set: trusted colours before (the old reading) and after, whites among them, and how many
    buildings each parameter reaches at the rules' thresholds (evidence_tile), with its confidence quartiles."""
    out = {}
    for name in ("panel", "sample"):
        recs = list(records((name,)).values())
        n = len(recs)
        q = lambda xs: [round(float(v), 2) for v in np.percentile(xs, [25, 50, 75])] if xs else None
        white = lambda r: r.get("wall") and min(r["wall"]["srgb"]) >= 235
        wall = [r["wall"] for r in recs if r.get("wall")]
        mats = [r["material"] for r in recs if r.get("material")]
        wins = [r["windows"] for r in recs if r.get("windows")]
        shops = [r["storefront"] for r in recs if r.get("storefront")]
        out[name] = dict(
            buildings=n,
            noView=sum(1 for r in recs if not r.get("views")),
            trustedBefore=sum(1 for r in recs if r.get("before", {}).get("trusted")),
            trustedAfter=sum(1 for w in wall if w["trusted"]),
            whiteAfter=sum(1 for r in recs if white(r) and r["wall"]["trusted"]),
            wallConfidence=q([w["confidence"] for w in wall]),
            material={m: sum(1 for x in mats if x["cls"] == m and x["confidence"] >= evidence_tile.MATERIAL_MIN) for m in fe.MATERIALS},
            materialAny=len(mats),
            materialConfidence=q([x["confidence"] for x in mats]),
            windows=sum(1 for w in wins if w["confidence"] >= evidence_tile.WINDOWS_MIN and w["views"] >= 2),
            windowsAny=len(wins),
            windowsConfidence=q([w["confidence"] for w in wins]),
            windowRatio=q([w["ratio"] for w in wins if w["confidence"] >= evidence_tile.WINDOWS_MIN]),
            shapes={k: sum(1 for w in wins if w.get("shape") == k) for k in ("tall", "square", "wide")},
            storefront=sum(1 for x in shops if x["value"] and x["confidence"] >= 0.5),
            storefrontAny=len(shops),
            awning=sum(1 for r in recs if r.get("awning")),
            written=sum(1 for r in recs if evidence_tile.fields(r, 9 | 1 << 8, 9 | 1 << 8)),
        )
    (PROOF / "summary.json").parent.mkdir(parents=True, exist_ok=True)
    (PROOF / "summary.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


def spot(n=20, seed=451):
    """Twenty sample buildings with three views or more, each refitted without one camera and compared with what that
    camera alone reads; a sheet of the held-out crop beside the colours, for looking at (photos: kept local)."""
    import random

    from PIL import Image, ImageDraw
    from tiles import read

    recs = records(("sample",))
    pool = sorted(k for k, r in recs.items() if r.get("views", 0) >= 3)
    picks = random.Random(seed).sample(pool, min(n, len(pool)))
    faces = fe.Faces(fe.Fetcher(), fe.Segmenter())
    table, rows, tiles = palette(), [], []
    for key in picks:
        rec = recs[key]
        p = read(fe.CITY / "packs" / (rec["square"] + ".bay"))
        verts, row = p["buildings"][rec["row"]]
        walls = fe.walls_of(p, verts, row)
        picked = [c for c in fe.choose(p, walls, fe.centre(verts), 4, fetcher=faces.fetcher) if c[1] in rec["cameras"]]
        views = [v for v in (fe.view(p, walls, c, faces) for c in picked) if v]
        if len(views) < 3:
            continue
        held, rest = views[-1], views[:-1]
        alone = fe.view_colour(held)
        fit = fe.consensus([fe.view_colour(v) for v in rest])
        entry = dict(square=rec["square"], row=rec["row"], material=rec.get("material", {}).get("cls"), trusted=rec.get("wall", {}).get("trusted"))
        if alone is not None and fit[0] is not None:
            d = fe.lab(alone[0]) - fe.lab(fit[0])
            entry.update(held=[int(v) for v in fe.encoded(alone[0])], fit=[int(v) for v in fe.encoded(fit[0])], fit_trusted=fit[3], chroma=round(float(np.hypot(d[1], d[2])), 1), lightness=round(float(d[0]), 1))
        rows.append(entry)
        px = np.concatenate([r["px"] for r in held["rows"]])
        lo, hi = px.min(0), px.max(0)
        crop = Image.fromarray(held["face"][max(0, lo[1] - 20) : hi[1] + 20, max(0, lo[0] - 20) : hi[0] + 20].clip(0, 255).astype("u1"))
        crop.thumbnail((300, 300))
        cell = Image.new("RGB", (300, 380), (255, 255, 255))
        cell.paste(crop, (0, 0))
        draw = ImageDraw.Draw(cell)
        swatches = [("bake", table[row[0] >> 8] * 255 if row[0] >> 8 else (200, 200, 200)), ("record", rec.get("wall", {}).get("srgb", (255, 255, 255))), ("held", entry.get("held", (255, 255, 255))), ("fit", entry.get("fit", (255, 255, 255)))]
        for i, (name, c) in enumerate(swatches):
            draw.rectangle([i * 75, 305, i * 75 + 70, 350], fill=tuple(int(v) for v in c))
            draw.text((i * 75 + 2, 352), name, fill=(0, 0, 0))
        draw.text((2, 366), f"{rec['square']} {rec['row']} {entry['material']} dC={entry.get('chroma')}", fill=(0, 0, 0))
        tiles.append(cell)
    sheet = Image.new("RGB", (300 * 5, 380 * ((len(tiles) + 4) // 5)), (255, 255, 255))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 5) * 300, (i // 5) * 380))
    sheet.save(PROOF / "spot.jpg", quality=90)
    (PROOF / "spot.json").write_text(json.dumps(rows, indent=1))
    ok = [r for r in rows if "chroma" in r]
    print(len(rows), "buildings", len(ok), "compared; held-out chroma distance median", np.median([r["chroma"] for r in ok]) if ok else None)


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("action", choices=["stage", "render", "compare", "spot", "summary"])
    a = cli.parse_args()
    {"stage": stage, "render": render, "compare": compare, "spot": spot, "summary": summary}[a.action]()
