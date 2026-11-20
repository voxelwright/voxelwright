"""Reproduce the three neighbourhood controls with bay/shot.mjs and local references."""

import argparse
import io
import json
import math
import os
from pathlib import Path
import subprocess
import zipfile

import numpy as np
from PIL import Image, ImageDraw

from frontage import rotation
from intermediate import BAY
from street_graph import cells

# Selected by proximity to three neighbourhood locations before comparing bakes.
CONTROLS = [
    ("Russian Hill", "550.7_4183.5", "253220090780749", 95),
    ("North Beach", "551.7_4183.5", "1194860254413003", 80),
    ("Telegraph Hill", "551.7_4183.5", "370214465301047", 260),
]
# Eye elevations relative to engine zero in the first publication pair.
# Freeze them when later ground passes move a street vertex.
CONTROL_GROUND = {"Russian Hill": 38.0, "North Beach": 24.9, "Telegraph Hill": 79.4}
WIDTH, HEIGHT, FOV = 960, 540, 70
ENGINE = Path(__file__).resolve().parents[1]


def perspective(p, photo, yaw):
    img = np.asarray(Image.open(io.BytesIO(photo)).convert("RGB"))
    scale = math.tan(math.radians(FOV / 2))
    focal = HEIGHT / 2 / scale
    u, v = np.meshgrid(
        np.arange(WIDTH) + 0.5 - WIDTH / 2, np.arange(HEIGHT) + 0.5 - HEIGHT / 2
    )
    a = math.radians(yaw)
    rays = np.stack(
        (
            math.sin(a) * focal + math.cos(a) * u,
            math.cos(a) * focal - math.sin(a) * u,
            -v,
        ),
        axis=2,
    )
    rays = rays @ rotation(np.array(p["computed_rotation"])).T
    col = (
        (np.arctan2(rays[:, :, 0], rays[:, :, 2]) / (2 * np.pi) + 0.5)
        % 1
        * img.shape[1]
    ).astype(int)
    row = (
        (
            0.5
            + np.arctan2(rays[:, :, 1], np.hypot(rays[:, :, 0], rays[:, :, 2])) / np.pi
        )
        * img.shape[0]
    ).astype(int)
    return Image.fromarray(img[row.clip(0, img.shape[0] - 1), col])


def reference(inputs, out, label, square, id_, yaw, external=None):
    with zipfile.ZipFile(inputs / (square + ".zip")) as archive:
        if external:
            p, photo = external
        else:
            p = next(
                p
                for p in json.loads(archive.read("photos/cameras.json"))
                if p["id"] == id_
            )
            photo = archive.read("photos/" + id_ + ".jpg")
        x, z = cells(*p["computed_geometry"]["coordinates"])
        perspective(p, photo, yaw).save(out / (label + ".jpg"), quality=90)
        scale = math.tan(math.radians(FOV / 2))
        aerial = Image.open(archive.open("naip.png"))
        e, n = (float(k) * 1000 for k in square.split("_"))
        cx, cy = (500000 + x / 10 - e + 120) * 2, (n + 1120 - 4250000 + z / 10) * 2
        height = 400 * scale
        width = height * WIDTH / HEIGHT
        aerial.crop(
            (
                int(cx - width / 2),
                int(cy - height / 2),
                int(cx + width / 2),
                int(cy + height / 2),
            )
        ).resize((WIDTH, HEIGHT)).save(out / (label + " 100 m.jpg"), quality=90)
    return x / 10, z / 10


def shoot(root, phase, port, square, label, x, z, yaw, ground=None):
    if ground is None:
        ground = CONTROL_GROUND[label]
    views = f"{x},{ground+2.5:.1f},{z},{yaw},0;{x},{ground+100:.1f},{z},0,-90"
    subprocess.run(
        [
            "node",
            "bay/shot.mjs",
            "--square",
            square,
            "--name",
            prefix(phase, label),
            "--views",
            views,
            "--server",
            f"http://127.0.0.1:{port}",
            "--size",
            "960x540",
            "--wait",
            "800",
        ],
        cwd=ENGINE,
        env={**os.environ, "VILLAGE_BAY_ROOT": str(root)},
        check=True,
    )


def prefix(phase, label):
    return f"450-data-{phase}-" + label.replace(" ", "")


def sheet(out, phases=("before", "final"), titles=("Pilot", "Publication")):
    canvas = Image.new("RGB", (480 * (len(phases) + 1), 6 * 303), "#1c2023")
    draw = ImageDraw.Draw(canvas)
    for i, (label, _, __, ___) in enumerate(CONTROLS):
        for j, alt in enumerate(("street", "100 m")):
            sources = [out / (label + (" 100 m" if j else "") + ".jpg")]
            sources.extend(
                BAY / "shots" / f"{prefix(phase, label)}-{j}.png" for phase in phases
            )
            y = (2 * i + j) * 303
            for k, (path, title) in enumerate(
                zip(sources, ("NAIP" if j else "Mapillary", *titles))
            ):
                draw.text(
                    (k * 480 + 8, y + 7),
                    f"{label}  /  {alt}  /  {title}",
                    fill="white",
                    font_size=16,
                )
                canvas.paste(
                    Image.open(path)
                    .convert("RGB")
                    .resize((480, 270), Image.Resampling.LANCZOS),
                    (k * 480, y + 33),
                )
    canvas.save(out / "contact-sheet.jpg", quality=91)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "phase",
        choices=("before", "final", "sheet", *(f"pass-{i}" for i in range(1, 6))),
    )
    p.add_argument("--inputs", type=Path, default=BAY / "450-inputs")
    p.add_argument("--out", type=Path, default=BAY / "450-accuracy")
    p.add_argument(
        "--round-sheet",
        action="store_true",
        help="include the five street-level passes after the previous publication",
    )
    p.add_argument("--release", type=Path)
    p.add_argument("--port", type=int)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if args.phase == "sheet":
        if args.round_sheet:
            sheet(
                args.out,
                ("final", *(f"pass-{i}" for i in range(1, 6))),
                ("Previous", "Footprints", "Walls", "Facades", "Ground", "Furniture"),
            )
        else:
            sheet(args.out)
    else:
        if not args.release or not args.port:
            p.error("supply --release and its running engine server's --port")
        for label, square, id_, yaw in CONTROLS:
            x, z = reference(args.inputs, args.out, label, square, id_, yaw)
            shoot(args.release, args.phase, args.port, square, label, x, z, yaw)
