"""Prove the building records on the 16-place panel (#450): stage the round-2 panel tiles with the records written
in, render them once, and say per changed building whether its wall moved towards the photograph.

The photograph is each place's reserved panel reference, a Mapillary image ID excluded from the fit. A later pose
solution can put a fitted camera closer than the original 5 m exclusion; verify the solved positions for any release
decision (evidence_tile.load_reviewed). Its wall colour for a building is read the way a view is
(the same projection, segmentation and clipping rules), and compared with the colour the renderer gave the wall
before (the bake's row, or PR 474's paint majority) and after. Chroma (CIELAB a*, b*) decides; lightness is reported
apart, because a bias shared by every photograph (an exposure that reads walls dark) would favour the records.

    evidence-venv/bin/python engine/bay/evidence_proof.py stage|render|compare

Evidence-2 (November 21) compares several staged sets in one render: `off` (the round-2 tiles), and each set staged
with `stage --set NAME --records DIR...` under `--proof` (proof-2 for it). `versus` reads what each set wrote into its
tiles and scores every changed wall against the held-out photograph read through the exposure normaliser (albedo, not
pixels: in raw pixels a sunlit cream front reads sRGB 140, which rewards charcoal) and against the walls classed by eye
(evidence_eye.json), which share nothing with either pipeline.

    evidence-venv/bin/python engine/bay/evidence_proof.py --proof proof-2 stage --set ours --records records-2/panel records-2/sample
    node bay/quiet.mjs evidence-venv/bin/python engine/bay/evidence_proof.py --proof proof-2 render --sets off pr484 ours
    evidence-venv/bin/python engine/bay/evidence_proof.py --proof proof-2 versus --sets pr484 ours
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
PROOF = fe.HOME / "proof"
GROUPS = json.loads((fe.BAY / "450-paint/evidence.json").read_text())["views"]


def records(sets=("panel", "sample"), root="records"):
    out = {}
    for s in sets:
        folder = fe.HOME / root / s
        if folder.is_dir():
            out.update(evidence_tile.load(str(folder)))
    return out


def stage(name="after", recs=None, tile=evidence_tile):
    """The round-2 panel tiles with `recs` written in by `tile.apply`, under PROOF/name."""
    recs = records() if recs is None else recs
    stats = {}
    for group in sorted({v["group"] for v in GROUPS.values()}):
        src, dst = BASE / group / "packs", PROOF / name / group / "packs"
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
            new = tile.apply(data, recs, stats) if f.suffix == ".bay" else data
            if new == data:
                out.symlink_to(f.resolve())
            else:
                out.write_bytes(new)
                stats["tiles"] = stats.get("tiles", 0) + 1
    print(json.dumps(stats))


def render(sets=("before", "after")):
    """The 32 views of each set with one renderer: `before` or `off` is the round-2 tiles, any other name the set staged
    under PROOF. Take every GPU turn first (test/kit.mjs `quiet`; bay/quiet.mjs runs this under it)."""
    from city_panel import shot

    for name in sets:
        root = BASE if name in ("before", "off") else PROOF / name
        dest = PROOF / "shots" / name
        dest.mkdir(parents=True, exist_ok=True)
        for group in sorted({v["group"] for v in GROUPS.values()}):
            places = [r for r in fe.PANEL if GROUPS[r["place"]]["group"] == group]
            shot(root / group, places, dest)


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


def tile_rows(group, root=BASE):
    """Every level-0 building row of a group's tiles as the renderer reads its wall: key -> (kind, painted, measured),
    measured when the row's evidence bit says its kind wins over the paint (bay.rs `Evidence`)."""
    from paint_tile import records as sfpt

    out = {}
    for f in (root / group / "packs/tiles/0").glob("*.bay"):
        b = f.read_bytes()
        h = struct.unpack_from("<16i", b)
        at = evidence_tile.rows_at(h)
        vat = at + 24 * h[12]
        verts = list(struct.iter_unpack("<3i", b[vat : vat + 12 * h[13]]))
        end = vat + 12 * h[13] + 16 * h[14]
        if b[end : end + 4] == b"SFST":
            end += 8 + 32 * struct.unpack_from("<I", b, end + 4)[0]
        tail = {e: v[8:] for e, v in sfpt(b[end:])} if b[end : end + 4] == b"SFPT" else {}
        for n in range(h[12]):
            first, count, wall, trim = struct.unpack_from("<2iIi", b, at + 24 * n)
            key = ";".join(f"{x},{z}" for x, z, _ in verts[first : first + count])
            out[key] = (wall, painted_majority(tail, first, count), bool(trim >> 16 & 1))
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


def rule_glass(style):
    """The glass share of an upper bay under bay.rs `front()`'s own rule (no evidence), from a row's style word."""
    storey = max(style & 255, 20) * (3 if style >> 19 & 1 else 1)
    module = max(style >> 8 & 255, 16)
    if style >> 16 & 1:
        half, head = max(module / 2 - 3, 6), storey - 5
    elif storey > 60:
        half, head = 4.5, storey - 14
    else:
        half, head = min(module / 2 - 5, 8), storey - 6
    return 2 * half * max(head - 8, 1) / (module * storey)


def measured_glass(share, style):
    """The glass share `front()` draws for a measured share (bay.rs `measured_half`), after its clamp."""
    storey = max(style & 255, 20) * (3 if style >> 19 & 1 else 1)
    module = max(style >> 8 & 255, 16)
    head = storey - (5 if style >> 16 & 1 else 6)
    half = min(max(share * module * storey / (2 * max(head - 8, 1)), 2.0), module / 2 - 3)
    return 2 * half * max(head - 8, 1) / (module * storey)


def is_white(srgb01):
    return min(srgb01) >= 235 / 255


def compare():
    """Each panel building within 45 m of its place: what the renderer drew before (the bake's row or PR 474's paint
    majority) and what the records change, counted apart for colour, material and glass, each checked against the
    place's held-out photograph (colour by CIELAB chroma; glass by that photograph's own dark-texel share)."""
    from tiles import read

    table = palette()
    # A kind with colour 0 is drawn in its material's own colour (march.ts `materials`).
    own = {k: np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)]) / 255 for k, h in {7: "a9a69f", 8: "a4553d", 9: "cfc6b4", 10: "b98a5a", 11: "9fc3d6"}.items()}
    colour = lambda k: own[k & 15] if k >> 8 == 0 else table[k >> 8]
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
        s = summary.setdefault(place, dict(buildings=0, inTiles=0, records=0, paintColour=0, paintWhite=0, measuredWall=0, colour=0, material=0, glass=0, seen=0, closer=0, farther=0))
        for n in fe.near(square, x, z, 45):
            verts, row = p["buildings"][n]
            key = fe.key_of(verts)
            s["buildings"] += 1
            if key not in before:
                continue
            s["inTiles"] += 1
            wall, painted, _ = before[key]
            if painted:
                s["paintWhite" if is_white(table[painted]) else "paintColour"] += 1
            rec = recs.get(key)
            if not rec:
                continue
            s["records"] += 1
            new = evidence_tile.fields(rec, wall, row[1])
            if not new:
                continue
            old_kind = (wall & 15) | (painted << 8) if painted else wall
            kinds = dict(colour=new[0] >> 8 != old_kind >> 8, material=new[0] & 15 != old_kind & 15, glass=bool(new[1] & evidence_tile.GLASS_BIT))
            s["measuredWall"] += bool(new[1] & evidence_tile.WALL_BIT)
            for k, v in kinds.items():
                s[k] += v
            if not any(kinds.values()):
                continue
            walls = fe.walls_of(p, verts, row)
            v = fe.view(p, walls, (0, r["image"], a, b, eye), faces)
            c = fe.view_colour(v) if v else None
            entry = dict(place=place, row=n, changed=[k for k, v in kinds.items() if v], before=old_kind, after=new[0], material=rec.get("material", {}).get("cls"))
            if kinds["glass"]:
                share = (new[1] >> 17 & 127) / 100
                held = fe.openings([v]).get("windows", {}).get("ratio") if v else None
                entry["glass"] = dict(rule=round(rule_glass(row[2]), 2), measured=share, drawn=round(measured_glass(share, row[2]), 2), photo=held)
            if (kinds["colour"] or kinds["material"]) and c is not None and c[2] <= fe.CLIPPED:
                s["seen"] += 1
                photo = fe.lab(c[0])
                lb, la = lab_of(colour(old_kind)), lab_of(colour(new[0]))
                db, da = float(np.hypot(*(lb - photo)[1:])), float(np.hypot(*(la - photo)[1:]))
                entry.update(photo=[int(v) for v in fe.encoded(c[0])], chroma=[round(db, 1), round(da, 1)], lightness=[round(float(lb[0] - photo[0]), 1), round(float(la[0] - photo[0]), 1)])
                s["closer"] += da < db - 2
                s["farther"] += da > db + 2
            rows.append(entry)
    total = {k: sum(v[k] for v in summary.values()) for k in next(iter(summary.values()))}
    out = PROOF / "compare.json"
    out.write_text(json.dumps(dict(total=total, summary=summary, buildings=rows), indent=1))
    print(json.dumps(total, indent=1))


OWN = {k: np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)]) / 255 for k, h in {7: "a9a69f", 8: "a4553d", 9: "cfc6b4", 10: "b98a5a", 11: "9fc3d6"}.items()}


def drawn(entry):
    """The kind the renderer draws a wall in, from a tile row (kind, painted majority, measured)."""
    wall, painted, measured = entry
    return wall if measured or not painted else (wall & 15) | (painted << 8)


def drawn_lab(kind):
    """CIELAB of the colour a kind draws (march.ts `palette` is in the eye's terms: sRGB-like, before the light)."""
    c = OWN.get(kind & 15, OWN[7]) if kind >> 8 == 0 else palette()[kind >> 8]
    return fe.lab(fe.linear(np.asarray(c) * 255))


def versus(sets=("pr484", "ours")):
    """Each panel building within 45 m of its place that a set changed from `off`: towards or away from the held-out
    photograph (read through the exposure normaliser) in chroma (a*, b*) and in lightness (L*), and, where the wall
    was classed by eye, whether its lightness lands in that class (light >= 68, dark <= 52, mid between 45 and 75)."""
    from tiles import read

    eye = {(e["square"], e["row"]): e["eye"] for e in json.loads(Path(__file__).with_name("evidence_eye.json").read_text())}
    band = dict(light=(68, 101), mid=(45, 75), dark=(-1, 52))
    ref = Reference()
    faces = fe.Faces(ref, fe.Segmenter())
    poses = json.loads((fe.BAY / "450-panel/fixed-poses.json").read_text())
    count = lambda: dict(changed=0, colour=0, material=0, seen=0, chroma_towards=0, chroma_away=0, light_towards=0, light_away=0, eyed=0, eye_in=0, eye_in_off=0)
    totals = {s: count() for s in sets}
    per_place, rows = {}, []
    for r in fe.PANEL:
        place, square, group = r["place"], r["square"], GROUPS[r["place"]]["group"]
        cam = ref.fetch(r["image"])
        fe.cameras()["meta"][r["image"]] = cam
        off = tile_rows(group)
        staged = {s: tile_rows(group, PROOF / s) for s in sets}
        p = read(fe.CITY / "packs" / (square + ".bay"))
        a, b = cam[1], cam[2]
        i, j = int(round((a - p["gx0"]) / 10)), int(round((b - p["gz0"]) / 10))
        eye_h = int(p["ground"][j, i]) + 25
        x, _, z, *_ = poses[place]["street"]
        place_counts = per_place.setdefault(place, {s: count() for s in sets})
        for n in fe.near(square, x, z, 45):
            verts, row = p["buildings"][n]
            key = fe.key_of(verts)
            if key not in off:
                continue
            k0 = drawn(off[key])
            photo = None
            entry = dict(place=place, row=n, off=k0)
            for s in sets:
                k1 = drawn(staged[s][key]) if key in staged[s] else k0
                entry[s] = k1
                if k1 == k0:
                    continue
                if photo is None:
                    v = fe.view(p, fe.walls_of(p, verts, row), (0, r["image"], a, b, eye_h), faces)
                    c = fe.view_colour(v) if v else None
                    photo = fe.lab(c[0]) if c is not None and c[2] <= fe.CLIPPED else False
                    if photo is not False:
                        entry["photo"] = [round(float(q), 1) for q in photo]
                for t in (totals[s], place_counts[s]):
                    t["changed"] += 1
                    t["colour"] += k1 >> 8 != k0 >> 8
                    t["material"] += k1 & 15 != k0 & 15
                l0, l1 = drawn_lab(k0), drawn_lab(k1)
                if photo is not False:
                    dc0, dc1 = np.hypot(*(l0 - photo)[1:]), np.hypot(*(l1 - photo)[1:])
                    dl0, dl1 = abs(l0[0] - photo[0]), abs(l1[0] - photo[0])
                    for t in (totals[s], place_counts[s]):
                        t["seen"] += 1
                        t["chroma_towards"] += int(dc1 < dc0 - 2)
                        t["chroma_away"] += int(dc1 > dc0 + 2)
                        t["light_towards"] += int(dl1 < dl0 - 2)
                        t["light_away"] += int(dl1 > dl0 + 2)
                e = eye.get((square, n))
                if e:
                    lo, hi = band[e]
                    for t in (totals[s], place_counts[s]):
                        t["eyed"] += 1
                        t["eye_in"] += int(lo <= l1[0] <= hi)
                        t["eye_in_off"] += int(lo <= l0[0] <= hi)
            rows.append(entry)
    out = PROOF / "versus.json"
    out.write_text(json.dumps(dict(totals=totals, places=per_place, buildings=rows), indent=1))
    print(json.dumps(totals, indent=1))


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
            whiteBefore=sum(1 for r in recs if r.get("before", {}).get("trusted") and min(r["before"].get("srgb", [0])) >= 235),
            trustedAfter=sum(1 for w in wall if w["trusted"]),
            whiteAfter=sum(1 for r in recs if white(r) and r["wall"]["trusted"]),
            # A trustworthy colour: trusted by the test and not white (whites from the old gain agree too).
            colourBefore=sum(1 for r in recs if r.get("before", {}).get("trusted") and min(r["before"].get("srgb", [255])) < 235),
            colourAfter=sum(1 for r in recs if r.get("wall", {}).get("trusted") and not white(r)),
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
    """Twenty sample buildings drawn from every record the rules would write (evidence_tile `fields`), each shown as
    its best view's crop beside the bake's colour and the record's; where three views or more stood, the last is held
    out and the rest refitted, and the held-out view's colour is compared with that fit (photos: kept local)."""
    import random

    from PIL import Image, ImageDraw
    from tiles import read

    recs = records(("sample",))
    pool = sorted(k for k, r in recs.items() if evidence_tile.fields(r, 9 | 1 << 8, 9 | 1 << 8))
    picks = random.Random(seed).sample(pool, min(n, len(pool)))
    faces = fe.Faces(fe.Fetcher(), fe.Segmenter())
    table, rows, tiles = palette(), [], []
    for key in picks:
        rec = recs[key]
        p = read(fe.CITY / "packs" / (rec["square"] + ".bay"))
        verts, row = p["buildings"][rec["row"]]
        walls = fe.walls_of(p, verts, row)
        picked = [c for c in fe.choose(p, walls, fe.centre(verts), 4, fetcher=faces.fetcher) if c[1] in rec.get("cameras", [])]
        views = [v for v in (fe.view(p, walls, c, faces) for c in picked) if v]
        if not views:
            continue
        new = evidence_tile.fields(rec, row[0], row[1])
        entry = dict(square=rec["square"], row=rec["row"], views=len(views), material=rec.get("material", {}).get("cls"), trusted=rec.get("wall", {}).get("trusted"), wall=bool(new and new[1] & evidence_tile.WALL_BIT), glass=(new[1] >> 17 & 127) / 100 if new and new[1] & evidence_tile.GLASS_BIT else None)
        if len(views) >= 3:
            held, rest = views[-1], views[:-1]
            alone = fe.view_colour(held)
            fit = fe.consensus([fe.view_colour(v) for v in rest])
            if alone is not None and fit[0] is not None:
                d = fe.lab(alone[0]) - fe.lab(fit[0])
                entry.update(held=[int(v) for v in fe.encoded(alone[0])], fit=[int(v) for v in fe.encoded(fit[0])], fit_trusted=fit[3], chroma=round(float(np.hypot(d[1], d[2])), 1), lightness=round(float(d[0]), 1))
        rows.append(entry)
        best = max(views, key=lambda v: sum(len(r["px"]) for r in v["rows"]))
        px = np.concatenate([r["px"] for r in best["rows"]])
        lo, hi = px.min(0), px.max(0)
        crop = Image.fromarray(best["face"][max(0, lo[1] - 20) : hi[1] + 20, max(0, lo[0] - 20) : hi[0] + 20].clip(0, 255).astype("u1"))
        crop.thumbnail((300, 300))
        cell = Image.new("RGB", (300, 380), (255, 255, 255))
        cell.paste(crop, (0, 0))
        draw = ImageDraw.Draw(cell)
        drawn = (new[0] >> 8) if new else row[0] >> 8
        swatches = [("bake", table[row[0] >> 8] * 255 if row[0] >> 8 else (200, 200, 200)), ("after", table[drawn] * 255 if drawn else (200, 200, 200)), ("record", rec.get("wall", {}).get("srgb", (255, 255, 255))), ("held", entry.get("held", (255, 255, 255)))]
        for i, (name, c) in enumerate(swatches):
            draw.rectangle([i * 75, 305, i * 75 + 70, 350], fill=tuple(int(v) for v in c))
            draw.text((i * 75 + 2, 352), name, fill=(0, 0, 0))
        draw.text((2, 366), f"{len(tiles) + 1}. {rec['square']} {rec['row']} {entry['material']} glass={entry['glass']} dC={entry.get('chroma')}", fill=(0, 0, 0))
        tiles.append(cell)
    sheet = Image.new("RGB", (300 * 5, 380 * ((len(tiles) + 4) // 5)), (255, 255, 255))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 5) * 300, (i // 5) * 380))
    sheet.save(PROOF / "spot.jpg", quality=90)
    (PROOF / "spot.json").write_text(json.dumps(rows, indent=1))
    ok = [r for r in rows if "chroma" in r]
    print(len(rows), "buildings", len(ok), "with a held-out view; held-out chroma distance median", np.median([r["chroma"] for r in ok]) if ok else None)


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cli.add_argument("--proof", default="proof", help="the folder under the evidence home that staging and shots go to")
    cli.add_argument("action", choices=["stage", "render", "compare", "versus", "spot", "summary"])
    cli.add_argument("--set", default="after", help="stage: the staged set's name")
    cli.add_argument("--records", nargs="*", help="stage: records folders under the evidence home (default records/panel, records/sample)")
    cli.add_argument("--sets", nargs="*", help="render: sets to draw (off is the round-2 tiles); versus: sets to score")
    a = cli.parse_args()
    PROOF = fe.HOME / a.proof
    if a.action == "stage":
        recs = {}
        for folder in a.records or ("records/panel", "records/sample"):
            recs.update(evidence_tile.load(str(fe.HOME / folder)))
        stage(a.set, recs)
    elif a.action in ("render", "versus"):
        {"render": render, "versus": versus}[a.action](*([a.sets] if a.sets else []))
    else:
        {"compare": compare, "spot": spot, "summary": summary}[a.action]()
