"""Verify the registered daylight gallery against the intended release and core."""

import hashlib
import json
import math
import re
import subprocess
import sys
from argparse import ArgumentParser
from pathlib import Path

from PIL import Image


HERE = Path(__file__).resolve().parent


def verify(folder, manifest, core):
    release = hashlib.sha256(manifest.read_bytes()).hexdigest()
    wasm = hashlib.sha256(core.read_bytes()).hexdigest()
    views = json.loads((HERE / "landmark-views.json").read_text())
    count = 0
    for name, cameras in views.items():
        for view, camera in cameras.items():
            stem = "--".join(re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") for s in (name, view))
            frame = folder / stem
            info = json.loads(frame.with_suffix(".json").read_text())
            for field, expected in (("name", name), ("view", view), ("camera", camera),
                                    ("release", release), ("wasm", wasm)):
                if info.get(field) != expected:
                    raise ValueError(f"{stem}: {field} differs from the expected capture")
            fov = camera[5] if len(camera) == 6 else 65
            if float(info["hour"]) != 14 or not abs(info["fov"] - fov) <= 1e-5:
                raise ValueError(f"{stem}: capture the registered daylight view at 14:00")
            yaw, pitch = map(math.radians, camera[3:5])
            forward = (math.sin(yaw) * math.cos(pitch), math.sin(pitch), -math.cos(yaw) * math.cos(pitch))
            eye = [10 * metres for metres in camera[:3]]
            if not (math.dist(info["eye"], eye) < 0.01 and math.dist(info["forward"], forward) < 1e-5):
                raise ValueError(f"{stem}: the rendered eye or direction differs from the registered camera")
            with Image.open(frame.with_suffix(".png")) as image:
                if image.format != "PNG" or image.size != (1280, 720):
                    raise ValueError(f"{stem}: expected a full-size PNG")
                image.verify()
            count += 1
    for check in ("check_ferry.py", "check_pyramid.py", "check_palace.py"):
        subprocess.run([sys.executable, HERE / check, folder], check=True)
    print(f"Verified {count} registered views of release {release[:12]} with core {wasm[:12]}")


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("core", type=Path)
    args = parser.parse_args()
    verify(args.folder, args.manifest, args.core)
