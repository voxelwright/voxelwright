"""Shoot pinned SF cameras and compare any number of local publications."""

import argparse
from collections import defaultdict
import json
from pathlib import Path
import shutil
import zipfile

import numpy as np
from PIL import Image, ImageDraw

import earth
import tiles
from frontage import fetch
from full_run import BAY, digest, plan, save
from recognition import CONTROL_GROUND, prefix, reference, shoot

HERE = Path(__file__).parent
CITY = BAY / "sf-450-city"
PANEL = BAY / "450-panel"


def stage(source, dest, names):
    """Cut the same neighbouring contributors in canonical release order at every pass."""
    packs = dest / "packs"
    packs.mkdir(parents=True, exist_ok=True)
    inventory = json.loads((HERE / "sf-squares.json").read_text())
    ordered = [s for s in inventory["lidar"] if s in names]
    assert set(ordered) == names
    state = json.loads((source / "state.json").read_text())["done"]
    for square in ordered:
        for ext in (".bay", ".json"):
            name = square + ext
            src = source / "packs" / name
            if digest(src) != state[square]["packs/" + name]:
                raise ValueError(f"unverified source {src}")
            dst = packs / name
            shutil.copyfile(src, dst)
    cut(dest, ordered)


def cut(root, ordered):
    packs = root / "packs"
    tiles.PACKS = str(packs)
    groups = defaultdict(set)
    for key, contributors in plan(ordered, [], False).items():
        groups[tuple(contributors)].add(key)
    index = dict(
        levels=[dict(size=r[0], gstep=r[1]) for r in earth.LEVELS],
        squares=ordered,
        tiles=[[], [], []],
        sea=[[], [], []],
    )
    for contributors, keys in groups.items():
        result = tiles.cut([packs / (s + ".bay") for s in contributors], keys)
        actual = {(i, x, z) for i, l in enumerate(result["tiles"]) for x, z in l}
        if actual != keys:
            raise ValueError(f"incomplete tile group {contributors}")
        for i, x, z in sorted(keys):
            index["tiles"][i].append([x, z])
    save(packs / "tiles/index.json", index)


def external_photo(inputs, cache, row):
    id_, square, place = row["image"], row["square"], row["place"]
    with zipfile.ZipFile(inputs / (square + ".zip")) as archive:
        if "photos/" + id_ + ".jpg" in archive.namelist():
            return None
    folder = cache / place
    folder.mkdir(exist_ok=True, parents=True)
    jpg, meta = folder / (id_ + ".jpg"), folder / "cameras.json"
    existing = json.loads(meta.read_text()) if meta.exists() else []
    p = next((p for p in existing if p["id"] == id_), None)
    if not p or not jpg.is_file():
        token = (BAY / "keys/mapillary.token").read_text().strip()
        fields = "id,camera_type,computed_geometry,computed_rotation,thumb_2048_url"
        p = json.loads(
            fetch(f"https://graph.mapillary.com/{id_}?fields={fields}", token)
        )
        if str(p["id"]) != id_ or p.get("camera_type") != "spherical":
            raise ValueError(f"no solved panorama {id_}")
        jpg.with_suffix(".part").write_bytes(fetch(p.pop("thumb_2048_url")))
        jpg.with_suffix(".part").replace(jpg)
        save(meta, [v for v in existing if v["id"] != id_] + [p])
    return p, jpg.read_bytes()


def ground_at(inputs, row, x, z):
    if row["place"] in CONTROL_GROUND:
        return CONTROL_GROUND[row["place"]]
    if "eye" in row:
        return row["eye"] - 2.5
    with zipfile.ZipFile(inputs / (row["square"] + ".zip")) as archive:
        frame = json.loads(archive.read("frame.json"))
        ground = np.load(archive.open("ground.npy"))
        j = round(frame["north"] - 4250000 + z)
        i = round(500000 + x - frame["west"])
        height = float(ground[j, i])
        if height < -100:
            raise ValueError(f"no ground at {row['place']}")
        return round(height - 1, 1)


def capture(rows, panel, source, release, port, phase):
    inputs = source / "inputs"
    refs = panel / "references"
    refs.mkdir(exist_ok=True, parents=True)
    for row in rows:
        place, square, img, yaw = (row[k] for k in ("place", "square", "image", "yaw"))
        photo = external_photo(inputs, panel / "photos", row)
        x, z = reference(inputs, refs, place, square, img, yaw, photo)
        g = ground_at(inputs, row, x, z)
        shoot(release, phase, port, square, place, x, z, yaw, ground=g)


def sheet(rows, panel, phases):
    w, h, caption = 384, 216, 28
    canvas = Image.new(
        "RGB", (w * (1 + len(phases)), len(rows) * 2 * (h + caption)), "#1c2023"
    )
    draw = ImageDraw.Draw(canvas)
    for i, row in enumerate(rows):
        place = row["place"]
        for alt in (0, 1):
            y = (2 * i + alt) * (h + caption)
            paths = [
                panel / "references" / (place + (" 100 m" if alt else "") + ".jpg")
            ]
            paths += [BAY / "shots" / f"{prefix(p,place)}-{alt}.png" for p in phases]
            for j, (title, path) in enumerate(
                zip(["NAIP" if alt else "Mapillary", *phases], paths)
            ):
                with Image.open(path) as image:
                    canvas.paste(
                        image.convert("RGB").resize((w, h), Image.Resampling.LANCZOS),
                        (w * j, y + caption),
                    )
                draw.text(
                    (w * j + 6, y + 5),
                    f"{place} · {'100 m' if alt else 'street'} · {title}",
                    font_size=14,
                )
    canvas.save(panel / "contact-sheet.jpg", quality=92)


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("action", choices=("stage", "capture", "sheet"))
    cli.add_argument("--panel", type=Path, default=PANEL)
    cli.add_argument("--source", type=Path, default=CITY)
    cli.add_argument("--release", type=Path)
    cli.add_argument("--phase", nargs="+", default=["baseline"])
    cli.add_argument("--port", type=int)
    cli.add_argument("--places", nargs="+")
    args = cli.parse_args()
    rows = json.loads((HERE / "neighbourhoods.json").read_text())
    if args.places:
        rows = [r for r in rows if r["place"] in args.places]
        if {r["place"] for r in rows} != set(args.places):
            cli.error("unknown panel place")
    if args.action == "stage":
        if not args.release:
            cli.error("--release is required")
        stage(args.source, args.release, {r["square"] for r in rows})
    elif args.action == "capture":
        if not args.release or not args.port or len(args.phase) != 1:
            cli.error("supply --release, its server's --port and one --phase")
        capture(rows, args.panel, args.source, args.release, args.port, args.phase[0])
    else:
        sheet(rows, args.panel, args.phase)
