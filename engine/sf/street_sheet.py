"""Comparison sheets of San Francisco at street level (#450): for each view, the old render, the new one and a
photograph of the place, side by side at full size, a few views to a sheet.

    ~/.village/engine/bay/venv/bin/python -I engine/sf/street_sheet.py photos <shots dir> [--out DIR]
    ~/.village/engine/bay/venv/bin/python -I engine/sf/street_sheet.py sheet <old dir> <new dir> <out dir> [--photos DIR]

photos  a photograph for each view sf/street-shots.mjs drew that the panel has none for (Powell, California, Filbert,
        the School crossing):
        the nearest of Mapillary's solved panoramas to the view's camera (bay/frontage.py `cameras_near`, the supported
        image-point tile and four panoramas round the place), turned to the camera's heading and cut to its field of view
        as the panel's references were (bay/recognition.py `perspective`). Kept out of git, in --out
        (~/.village/engine/sf/street-2/photos).
sheet   the views both folders hold, three to a sheet (sheet-<n>.png), each row old | new | photograph: the photograph
        is --photos/<view>.jpg, else the panel's reference (~/.village/engine/bay/450-panel/references), a realm-<place>
        view taking <place>'s. A view with no photograph says so in its third column, not an empty one.
"""

import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "bay"))
PANEL = Path.home() / ".village/engine/bay/450-panel/references"
PHOTOS = Path.home() / ".village/engine/sf/street-2/photos"
W, H = 960, 540


def photos(shots, out):
    import numpy as np
    from earth import Frame
    from frontage import cameras_near
    from recognition import perspective

    out.mkdir(parents=True, exist_ok=True)
    stats = {"api": 0, "bytes": 0, "images": 0}
    for name in ("Powell", "California", "Filbert", "School crossing"):
        labels = shots / f"{name}.json"
        if not labels.is_file():
            continue
        cam = json.loads(labels.read_text())["camera"]
        # The camera in metres (the page's pose), the frame in cells of 10 cm.
        x, z = cam["x"] * 10, cam["z"] * 10
        cache = Path.home() / ".village/engine/sf/street-2/mly" / name
        near = cameras_near(x, z, cache, stats)
        frame = Frame("10n4250")
        best = None
        for p in near:
            if p.get("camera_type") != "spherical":
                continue
            px, pz = frame.cells(np.array([p["computed_geometry"]["coordinates"]], np.float64))[0]
            d = math.hypot(px - x, pz - z) / 10
            if best is None or d < best[0]:
                best = (d, p)
        if not best:
            print(f"  {name}: no panorama near")
            continue
        d, p = best
        photo = (cache / f"{p['id']}.jpg").read_bytes()
        perspective(p, photo, math.degrees(cam["yaw"])).save(out / f"{name}.jpg", quality=90)
        print(f"  {name}: panorama {p['id']}, {d:.0f} m from the camera")
    print(f"  Mapillary: {stats['api']} asks, {stats['images']} images, {stats['bytes'] / 1e6:.1f} MB")


def photo_for(view, extra):
    for path in (extra / f"{view}.jpg", PANEL / f"{view.removeprefix('realm-')}.jpg"):
        if path.is_file():
            return Image.open(path).convert("RGB").resize((W, H))
    return None


def sheet(old, new, out, extra):
    out.mkdir(parents=True, exist_ok=True)
    views = sorted(p.stem for p in new.glob("*.png") if (old / p.name).is_file() and not p.stem.endswith("@2x"))
    rows = []
    for v in views:
        row = Image.new("RGB", (3 * W, H), (24, 24, 24))
        for i, img in enumerate((Image.open(old / f"{v}.png").convert("RGB"), Image.open(new / f"{v}.png").convert("RGB"), photo_for(v, extra))):
            if img is None:
                ImageDraw.Draw(row).text((2 * W + 20, H // 2), f"no photograph of {v}", fill=(220, 220, 220))
                continue
            row.paste(img.resize((W, H)), (i * W, 0))
        d = ImageDraw.Draw(row)
        for i, word in enumerate(("old", "new", "photograph")):
            d.rectangle((i * W + 4, 4, i * W + 12 + 7 * len(f"{v}: {word}"), 20), fill=(0, 0, 0))
            d.text((i * W + 8, 6), f"{v}: {word}", fill=(255, 230, 0))
        rows.append(row)
    for n in range(0, len(rows), 3):
        part = rows[n : n + 3]
        s = Image.new("RGB", (3 * W, H * len(part)))
        for i, r in enumerate(part):
            s.paste(r, (0, i * H))
        s.save(out / f"sheet-{n // 3 + 1}.png")
    print(f"  {len(rows)} views in {(len(rows) + 2) // 3} sheets in {out}")


def main():
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = cli.add_subparsers(dest="what", required=True)
    p = sub.add_parser("photos")
    p.add_argument("shots", type=Path)
    p.add_argument("--out", type=Path, default=PHOTOS)
    s = sub.add_parser("sheet")
    s.add_argument("old", type=Path)
    s.add_argument("new", type=Path)
    s.add_argument("out", type=Path)
    s.add_argument("--photos", type=Path, default=PHOTOS)
    a = cli.parse_args()
    if a.what == "photos":
        photos(a.shots, a.out)
    else:
        sheet(a.old, a.new, a.out, a.photos)


if __name__ == "__main__":
    main()
