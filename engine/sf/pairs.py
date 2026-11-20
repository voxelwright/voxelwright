"""A street photograph seen as the engine's eye sees a place (#450): the retained Mapillary panorama nearest a point,
cut to the same view (where it was taken from, which way, how wide), for a picture of the engine beside it.

    ~/.village/engine/bay/venv/bin/python engine/sf/pairs.py near <x> <z>          # prints the nearest panorama as JSON
    ~/.village/engine/bay/venv/bin/python engine/sf/pairs.py view <id> <yaw> <pitch> <fov> <w> <h> <out.png>

x and z are the release frame's 10 cm cells. yaw is the page's (0 north, a quarter turn east), pitch radians up,
fov the vertical angle in degrees. The panoramas stay on this machine (450-inputs); nothing is fetched.
The projection is bay/frontage.py's: a direction east, north, up turned by the camera's own rotation.
"""

import io
import json
import math
import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer

INPUTS = Path.home() / ".village/engine/bay/450-inputs"
UTM = Transformer.from_crs(4326, 26910, always_xy=True)


def rotation(r):
    angle = np.linalg.norm(r)
    if angle == 0:
        return np.eye(3)
    x, y, z = r / angle
    cross = np.array([[0, -z, y], [z, 0, -x], [-y, x, 0]])
    return np.eye(3) + math.sin(angle) * cross + (1 - math.cos(angle)) * (cross @ cross)


PANEL = Path.home() / ".village/engine/bay/450-panel/photos"


class Folder:
    """A folder of solved panoramas (the neighbourhood panel's), read as a square's ZIP is."""

    def __init__(self, path):
        self.path = path

    def read(self, name):
        return (self.path / name.split("/")[-1]).read_bytes()


def cameras():
    seen = set()
    for d in sorted(PANEL.glob("*/cameras.json")):
        for c in json.loads(d.read_text()):
            if c.get("camera_type") != "spherical" or not c.get("computed_rotation") or c["id"] in seen or not (d.parent / f"{c['id']}.jpg").exists():
                continue
            seen.add(c["id"])
            lon, lat = c["computed_geometry"]["coordinates"]
            e, n = UTM.transform(lon, lat)
            yield Folder(d.parent), c, (e - 500000) * 10, (4250000 - n) * 10
    for zf in sorted(INPUTS.glob("*.zip")):
        z = zipfile.ZipFile(zf)
        if "photos/cameras.json" not in z.namelist():
            continue
        names = set(z.namelist())
        for c in json.loads(z.read("photos/cameras.json")):
            if c.get("camera_type") != "spherical" or not c.get("computed_rotation") or f"photos/{c['id']}.jpg" not in names:
                continue
            lon, lat = c["computed_geometry"]["coordinates"]
            e, n = UTM.transform(lon, lat)
            yield zf, c, (e - 500000) * 10, (4250000 - n) * 10


if sys.argv[1] == "around":
    # Every panorama within r cells of a point, nearest first.
    x, z, r = float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
    found = sorted(((math.hypot(cx - x, cz - z), c["id"], cx, cz, c.get("captured_at")) for _, c, cx, cz in cameras() if math.hypot(cx - x, cz - z) < r))
    print(json.dumps([{"id": i, "x": cx, "z": cz, "far": d, "captured": t} for d, i, cx, cz, t in found]))
elif sys.argv[1] == "near":
    x, z = float(sys.argv[2]), float(sys.argv[3])
    best = min(cameras(), key=lambda t: math.hypot(t[2] - x, t[3] - z), default=None)
    if best is None:
        print("null")
    else:
        zf, c, cx, cz = best
        print(json.dumps({"id": c["id"], "x": cx, "z": cz, "far": math.hypot(cx - x, cz - z), "captured": c.get("captured_at")}))
else:
    id_, yaw, pitch, fov, w, h, out = sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), int(sys.argv[6]), int(sys.argv[7]), sys.argv[8]
    zf, c = next((zf, c) for zf, c, _, _ in cameras() if c["id"] == id_)
    src = zf if isinstance(zf, Folder) else zipfile.ZipFile(zf)
    img = np.asarray(Image.open(io.BytesIO(src.read(f"photos/{id_}.jpg"))).convert("RGB"))
    R = rotation(np.array(c["computed_rotation"]))
    # Each pixel's ray: forward, right and up of the page's eye, in east, north, up.
    fwd = np.array([math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch)])
    right = np.array([math.cos(yaw), -math.sin(yaw), 0.0])
    up = np.cross(right, fwd)
    t = math.tan(math.radians(fov) / 2)
    jj, ii = np.mgrid[0:h, 0:w]
    sx, sy = (2 * (ii + 0.5) / w - 1) * t * w / h, (1 - 2 * (jj + 0.5) / h) * t
    rays = fwd[None, None, :] + sx[..., None] * right[None, None, :] + sy[..., None] * up[None, None, :]
    cam = rays.reshape(-1, 3) @ R.T
    u = (np.arctan2(cam[:, 0], cam[:, 2]) / (2 * np.pi) + 0.5) % 1
    v = 0.5 + np.arctan2(cam[:, 1], np.hypot(cam[:, 0], cam[:, 2])) / np.pi
    px = img[np.clip((v * img.shape[0]).astype(int), 0, img.shape[0] - 1), np.clip((u * img.shape[1]).astype(int), 0, img.shape[1] - 1)]
    Image.fromarray(px.reshape(h, w, 3).astype(np.uint8)).save(out)
    print(out)
