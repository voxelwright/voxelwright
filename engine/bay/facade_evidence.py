"""What the photographs say about each building, as numbers the facade rules read (#450).

The paint survey (facade_paint.py) drew Mapillary pixels onto walls: 30 cm cells with no windows, 15 to 74 colours a
wall from whatever stood in front of it that day, and white where the sun blew the photo out. Here the photographs are
evidence for a building's parameters instead. Each chosen camera is cut into a perspective face aimed at the building,
a segmentation model (UperNet ConvNeXt, ADE20K; .agents/skills/facade-evidence) labels every pixel, and only pixels
labelled as wall that are neither clipped nor dark count towards a colour. A wall's colour is its albedo, not its
pixels: each face is scaled so that its bright things (the 95th percentile of everything but the sky: white trim, frames,
cars, pavement in sun) sit at WHITE, white-balanced on its road and pavement, and a view far darker than the building's
brightest pair (its wall in shade while the bright things are in sun) is dropped. A building's record says, each with a
confidence:

    wall        robust colour of the wall in linear light, its sRGB, and the palette entry the bake draws it in
    material    painted wood / clapboard, stucco / plaster, brick, stone or glass curtain wall (SigLIP, zero shot)
    windows     glass share of the upper wall, the windows' shape (tall, square, wide)
    storefront  whether the ground floor is shop glass, and an awning's colour if one is seen

The bake reads them where confidence is high (evidence_tile.py); everything else keeps its rule's default. Photos and
crops stay under ~/.village; only these numbers are written out.

    evidence-venv/bin/python engine/bay/facade_evidence.py measure --square 550.7_4182.5 --near 52010 66180 60 --out f.json
"""

import argparse
import json
import math
import os
import time
import zipfile
from functools import lru_cache
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image

from bake import palette
from facade_paint import STEP, eave_of, edges, exposure, unoccluded
from frontage import rotation
from paint_cameras import xy
from tiles import read

BAY = Path.home() / ".village/engine/bay"
CITY = BAY / "sf-450-city"
OBJECTS = BAY / "450-city-paint/cache/objects"
HOME = BAY / "450-city-paint/evidence"
PHOTOS = HOME / "photos"
LABELS = HOME / "labels"
PANEL = json.loads(Path(__file__).with_name("neighbourhoods.json").read_text())

SEGMENTER = ("openmmlab/upernet-convnext-tiny", "876ffc56b819a829448f7e81e9f8606deef6fb65")
CLASSIFIER = ("google/siglip-base-patch16-224", "7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed")
# ADE20K classes. A wall pixel counts towards colour; windows and doors are the openings; the rest stood in front.
WALL = (0, 1, 25, 48)  # wall, building, house, skyscraper
GLASS = (8,)  # windowpane
DOOR = (14,)
AWNING = (86,)
SIGN = (43,)
FACE_W, FACE_H, FOCAL = 512, 640, 256.0  # 90 degrees across, 103 up and down
BUCKET = math.radians(30)  # a face is shared by the buildings within 15 degrees of its axis
MATERIALS = ("clapboard", "stucco", "brick", "stone", "glass")
PROMPTS = (
    "a photo of a house with painted wooden clapboard siding",
    "a photo of a building with smooth stucco plaster walls",
    "a photo of a red brick building",
    "a photo of a building faced with cut stone",
    "a photo of an office building with a glass curtain wall",
)
# What each class is drawn in (kinds.rs): PLASTER draws lapped boards (march.ts `paint`), CONCRETE plain slabs, so
# stucco and stone share CONCRETE and the record keeps them apart for a later material.
DRAWN_AS = {"clapboard": 9, "stucco": 7, "brick": 8, "stone": 7, "glass": 11}

# A view counts towards a colour when it holds this many clean wall texels.
MIN_TEXELS = 30
# Exposure (#450, evidence-2). The cameras expose for the sky, so a sunlit cream front reads sRGB 130 to 140 in its own
# pixels (North Beach, row 1368: four views, 108 to 140). Each face is scaled so that the 95th percentile of its
# luminance outside the sky is WHITE (linear; sRGB 225, a white wall's paint), by a gain kept within GAIN. Chosen on the
# 663 panel views against 82 walls classed by eye (evidence_eye.json) before the panel was measured again: the 95th
# percentile at 0.75 put light walls at a median L* 74.5 and dark at 44, where the photo's own exposure gave 52 and 28.
WHITE, GAIN = 0.75, (0.7, 6.0)
SKY = 2
# A view more than SHADE (L*) below the building's second brightest, and the same colour once brought up to its light,
# saw the wall in shade while its bright things were in sun (or into the sun). It is dropped: the photographs' capture times are too often wrong to tell sun from shade by
# the sun's position (a daylight frame with the sun in it is stamped 22:33 local).
SHADE = 12.0
LUMA = np.array([0.2126, 0.7152, 0.0722], "f4")
# The trust test, fixed after the Nob Hill slice and before the panel and sample runs (the same for the old reading and
# the new): two views or more whose colours lie within AGREE (CIELAB, lightness at 1 / KL weight) of the building's,
# carrying at least AGREE_SHARE of the weight, each with no more than CLIPPED of its wall texels blown out. KL was 2 to
# forgive the cameras' exposure; with exposure normalised the new reading holds lightness to 1.5.
AGREE, AGREE_SHARE, CLIPPED, KL_OLD, KL = 10.0, 0.6, 0.2, 2.0, 1.5


# ── Colour


def linear(srgb):
    c = np.asarray(srgb, "f4") / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def encoded(lin):
    c = np.clip(np.asarray(lin, "f4"), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255


def lab(lin):
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], "f4")
    xyz = np.asarray(lin, "f4") @ m.T / np.array([0.9505, 1.0, 1.089], "f4")
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


@lru_cache(maxsize=1)
def table():
    """The bake's palette (1 to 255) in CIELAB."""
    return lab(linear(palette()[1:] * 255))


def palette_index(srgb):
    """The bake's palette entry nearest an sRGB colour in CIELAB. Nearest in sRGB (appearance.py's way for pixels) put
    71 of 134 measured panel walls on a grey: a step in sRGB weighs lightness far over hue, and the paint tones are
    coarse in lightness, so a cream or tan a little off a tone's value went grey. In CIELAB 56 do, the walls whose own
    chroma is under about 5."""
    return int(np.argmin(((table() - lab(linear(srgb))) ** 2).sum(1))) + 1


# ── Cameras and photographs


def _row(meta, source):
    if meta.get("camera_type") != "spherical" or not meta.get("computed_rotation") or not meta.get("computed_geometry"):
        return None
    x, z = np.array(xy(meta)) * 10
    lon, lat = meta["computed_geometry"]["coordinates"]
    return (str(meta["id"]), x, z, meta["computed_rotation"], meta.get("captured_at", 0), lon, lat, source)


@lru_cache(maxsize=1)
def cameras():
    """Every solved panorama already on disk: the survey's lookups, the squares' archived photos, and those this
    tool resolved before. No API call."""
    rows = {}
    for folder in (OBJECTS, HOME / "meta"):
        for path in folder.glob("*.json"):
            try:
                r = _row(json.loads(path.read_text()), None)
            except ValueError:
                continue
            if r:
                rows[r[0]] = r
    for archive in sorted((CITY / "inputs").glob("*.zip")):
        with zipfile.ZipFile(archive) as z:
            if "photos/cameras.json" not in z.namelist():
                continue
            for meta in json.loads(z.read("photos/cameras.json")):
                r = _row(meta, str(archive))
                if r and r[0] not in rows:
                    rows[r[0]] = r
    rows = list(rows.values())
    # The 16 panel references judge the result; neither they nor a camera standing where one stood is evidence.
    refs = {r["image"] for r in PANEL}
    poses = json.loads((BAY / "450-panel/fixed-poses.json").read_text())
    spots = [(v["street"][0] * 10, v["street"][2] * 10) for v in poses.values()]
    keep = [r for r in rows if r[0] not in refs and all(math.hypot(r[1] - a, r[2] - b) > 50 for a, b in spots)]
    ids = [r[0] for r in keep]
    return dict(
        ids=ids,
        xz=np.array([(r[1], r[2]) for r in keep], "f8"),
        meta={r[0]: r for r in keep},
        excluded=len(rows) - len(keep),
        spots=spots,
        refs=refs,
    )


@lru_cache(maxsize=1)
def points():
    """Every panorama Mapillary's coverage tiles list (the city run's cached z14 tiles), where no pose is on disk."""
    import mapbox_vector_tile
    from paint_cameras import TO_UTM

    known, out = set(cameras()["meta"]), {}
    for tile in sorted((CITY / "raw").glob("images-*.mvt")):
        _, tx, ty = tile.stem.split("-")
        tx, ty = int(tx), int(ty)
        layer = mapbox_vector_tile.decode(tile.read_bytes()).get("image", {})
        for f in layer.get("features", []):
            q = f["properties"]
            ident = str(q.get("id"))
            if not q.get("is_pano") or ident in known or ident in cameras()["refs"]:
                continue
            a, b = f["geometry"]["coordinates"]
            lon = (tx + a / layer["extent"]) / 16384 * 360 - 180
            lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + 1 - b / layer["extent"]) / 16384))))
            e, n = TO_UTM.transform(lon, lat)
            x, z = (e - 500000) * 10, (4250000 - n) * 10
            if all(math.hypot(x - u, z - v) > 50 for u, v in cameras()["spots"]):
                out[ident] = (x, z)
    ids = list(out)
    return dict(ids=ids, xz=np.array([out[i] for i in ids], "f8").reshape(-1, 2))


class Fetcher:
    """Mapillary Graph API for a thumbnail URL, then the image. Paced by the app usage header; the token is never shown."""

    def __init__(self, spacing=0.1):
        self.token = (BAY / "keys/mapillary.token").read_text().strip()
        self.spacing, self.last, self.calls, self.bytes = spacing, 0.0, 0, 0
        self.urls = {}
        import threading

        self.lock = threading.Lock()

    def get(self, url, auth):
        with self.lock:
            wait = self.last + self.spacing - time.time()
            self.last = max(time.time(), self.last + self.spacing)
        if wait > 0:
            time.sleep(wait)
        headers = {"User-Agent": "village-facade-evidence"}
        if auth:
            headers["Authorization"] = "OAuth " + self.token
        for attempt in range(4):
            try:
                with urlopen(Request(url, headers=headers), timeout=40) as reply:
                    data = reply.read()
                    usage = json.loads(reply.headers.get("X-App-Usage", "{}") or "{}")
                    if max((v for v in usage.values() if isinstance(v, (int, float))), default=0) >= 75:
                        self.spacing = max(self.spacing, 5.0)
                self.calls += 1
                self.bytes += len(data)
                return data
            except HTTPError as e:
                if e.code in (404, 410):
                    return None
                if e.code in (429, 503) or e.headers.get("Retry-After"):
                    time.sleep(min(600, float(e.headers.get("Retry-After") or 60)))
                    continue
                raise RuntimeError(f"Mapillary returned HTTP {e.code}") from None
            except (URLError, TimeoutError):
                time.sleep(5 * (attempt + 1))
        raise RuntimeError("Mapillary request failed four times")

    def resolve(self, ident):
        """A coverage point's pose, kept beside the photos; None where Mapillary has no solved panorama for it."""
        path = HOME / "meta" / (ident + ".json")
        if path.is_file():
            meta = json.loads(path.read_text())
        else:
            fields = "id,camera_type,computed_geometry,computed_rotation,captured_at,thumb_2048_url"
            meta = json.loads(self.get(f"https://graph.mapillary.com/{ident}?fields={fields}", True) or b"{}")
            self.urls[ident] = meta.pop("thumb_2048_url", None)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(meta))
        r = _row(meta, None)
        if r:
            cameras()["meta"][ident] = r
        return r

    def photo(self, ident):
        path = PHOTOS / (ident + ".jpg")
        if path.is_file():
            return path
        shared = OBJECTS / (ident + ".jpg")
        if shared.is_file():
            return shared
        source = cameras()["meta"].get(ident, (None,) * 8)[7]
        if source:
            return (source, "photos/" + ident + ".jpg")
        url = self.urls.pop(ident, None)
        if not url:
            meta = self.get(f"https://graph.mapillary.com/{ident}?fields=thumb_2048_url", True)
            url = json.loads(meta or b"{}").get("thumb_2048_url")
        if not url:
            return None
        data = self.get(url, False)
        if not data:
            return None
        PHOTOS.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(path)
        return path


# ── Faces: a perspective view cut from a panorama, square to the world


def axes(heading):
    f = np.array([math.sin(heading), math.cos(heading), 0.0])
    r = np.array([math.cos(heading), -math.sin(heading), 0.0])
    return f, r, np.array([0.0, 0.0, 1.0])


def cut(pano, rot, heading):
    """The face (FACE_H x FACE_W x 3) of a panorama looking along `heading`, bilinear."""
    f, r, u = axes(heading)
    px, py = np.meshgrid(np.arange(FACE_W) - FACE_W / 2 + 0.5, np.arange(FACE_H) - FACE_H / 2 + 0.5)
    world = FOCAL * f + px[..., None] * r - py[..., None] * u
    cam = world.reshape(-1, 3) @ rot.T
    H, W = pano.shape[:2]
    uu = ((np.arctan2(cam[:, 0], cam[:, 2]) / (2 * np.pi) + 0.5) % 1) * W - 0.5
    vv = (0.5 + np.arctan2(cam[:, 1], np.hypot(cam[:, 0], cam[:, 2])) / np.pi) * H - 0.5
    u0, v0 = np.floor(uu).astype(int), np.floor(vv).astype(int)
    fu, fv = (uu - u0)[:, None], (vv - v0)[:, None]
    v0c, v1c = v0.clip(0, H - 1), (v0 + 1).clip(0, H - 1)
    u0w, u1w = u0 % W, (u0 + 1) % W
    p = pano.astype("f4")
    out = (p[v0c, u0w] * (1 - fu) + p[v0c, u1w] * fu) * (1 - fv) + (p[v1c, u0w] * (1 - fu) + p[v1c, u1w] * fu) * fv
    return out.reshape(FACE_H, FACE_W, 3).astype("f4")


def onto(world, heading):
    """Face pixel (column, row) of world vectors from the camera (east, north, up); NaN behind."""
    f, r, u = axes(heading)
    depth = world @ f
    with np.errstate(divide="ignore", invalid="ignore"):
        col = FACE_W / 2 + FOCAL * (world @ r) / depth - 0.5
        row = FACE_H / 2 - FOCAL * (world @ u) / depth - 0.5
    bad = (depth <= 0) | (col < 0) | (row < 0) | (col > FACE_W - 1) | (row > FACE_H - 1)
    col[bad] = np.nan
    row[bad] = np.nan
    return col, row


class Segmenter:
    """UperNet ConvNeXt on the Neural Engine (Core ML, fp16), converted once from the pinned weights; on the CPU in
    PyTorch where Core ML is missing. The GPU is shared with the renderer and is not used. On 23 real faces the two
    agree on 99.75% of labels and 99.56% of the wall-or-not decision; a face takes 0.16 s against 2.1 s."""

    PACKAGE = HOME / "upernet-convnext-tiny-640x512.mlpackage"
    MEAN = np.array([0.485, 0.456, 0.406], "f4")[:, None, None]  # ConvNeXt's ImageNet normalisation
    STD = np.array([0.229, 0.224, 0.225], "f4")[:, None, None]

    def __init__(self, engine=os.environ.get("EVIDENCE_SEGMENTER", "ane")):
        self.ml = None
        if engine == "ane":
            try:
                import coremltools as ct
            except ImportError:
                ct = None
            if ct is not None:
                if not self.PACKAGE.exists():
                    self.convert(ct)
                self.ml = ct.models.MLModel(str(self.PACKAGE), compute_units=ct.ComputeUnit.CPU_AND_NE)
        if self.ml is None:
            self.model = self.torch_model()

    @staticmethod
    def torch_model():
        import torch
        from transformers import AutoModelForSemanticSegmentation

        torch.set_num_threads(int(os.environ.get("EVIDENCE_THREADS", "8")))
        return AutoModelForSemanticSegmentation.from_pretrained(SEGMENTER[0], revision=SEGMENTER[1]).eval()

    def convert(self, ct):
        import torch

        model = self.torch_model()

        class Labels(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.m = model

            def forward(self, x):
                return self.m(pixel_values=x).logits.argmax(1).to(torch.int32)

        x = torch.zeros(1, 3, FACE_H, FACE_W)
        with torch.inference_mode():
            traced = torch.jit.trace(Labels().eval(), x, strict=False)
        ct.convert(
            traced,
            inputs=[ct.TensorType(name="x", shape=x.shape)],
            outputs=[ct.TensorType(name="labels")],
            compute_units=ct.ComputeUnit.CPU_AND_NE,
            minimum_deployment_target=ct.target.macOS14,
            compute_precision=ct.precision.FLOAT16,
        ).save(str(self.PACKAGE))

    def __call__(self, face):
        x = ((np.ascontiguousarray(face.transpose(2, 0, 1), "f4") / 255 - self.MEAN) / self.STD)[None].astype("f4")
        if self.ml is not None:
            return self.ml.predict({"x": x})["labels"][0].astype("u1")
        import torch

        with torch.inference_mode():
            return self.model(pixel_values=torch.from_numpy(x)).logits.argmax(1)[0].numpy().astype("u1")


class Classifier:
    def __init__(self):
        import torch
        from transformers import AutoModel, AutoProcessor

        self.torch = torch
        self.model = AutoModel.from_pretrained(CLASSIFIER[0], revision=CLASSIFIER[1]).eval()
        self.proc = AutoProcessor.from_pretrained(CLASSIFIER[0], revision=CLASSIFIER[1])
        with torch.inference_mode():
            text = self.proc(text=list(PROMPTS), padding="max_length", return_tensors="pt")
            self.text = _pooled(self.model.get_text_features(**text))
            self.text = self.text / self.text.norm(dim=-1, keepdim=True)

    def __call__(self, crop):
        t = self.torch
        with t.inference_mode():
            img = _pooled(self.model.get_image_features(**self.proc(images=Image.fromarray(crop), return_tensors="pt")))
            img = img / img.norm(dim=-1, keepdim=True)
            logits = (img @ self.text.T)[0] * self.model.logit_scale.exp() + self.model.logit_bias
        # SigLIP scores each prompt on its own (a sigmoid); share them out to compare five answers.
        return t.softmax(logits, 0).numpy()


def _pooled(out):
    # transformers 5 returns the projected embedding as the output's pooler_output; 4 returned the tensor.
    return getattr(out, "pooler_output", out)


# ── A building's walls, and the views of them


def walls_of(p, verts, row):
    """Each open-air wall of a building as a grid of 30 cm texels: its end points, centres and heights (cells)."""
    out = []
    for i, key, flags in edges(verts):
        if not flags & 1:
            continue
        ax, az, bx, bz = key
        dx, dz = bx - ax, bz - az
        length = math.hypot(dx, dz)
        if length < 18 or length > 1500:
            continue
        cols = math.ceil(length / STEP)
        u = np.minimum(np.arange(cols) * STEP + STEP / 2, length - 0.1) / length
        x, z = ax + dx * u, az + dz * u
        eave = eave_of(p, flags, row, x, z)
        if eave is None:
            continue
        base = row[-1]
        h = math.ceil(min(eave - base, 380) / STEP)
        if h < 4:
            continue
        y = base + np.arange(h) * STEP + STEP / 2
        out.append(dict(key=key, street=bool(flags & 2), x=x, z=z, y=y, length=length, d=(dx, dz), base=base))
    return out


def centre(verts):
    v = np.array([q[:2] for q in verts], "f8")
    return v.mean(0)


def choose(p, walls, at, k=4, reach=600, fetcher=None):
    """Up to `k` cameras that see most of a building's walls square on and near, at least 4 m apart. Panoramas with no
    pose on disk are scored by where the coverage tiles put them and resolved (one Graph call) only when picked."""
    cams, more = cameras(), points() if fetcher else dict(ids=[], xz=np.zeros((0, 2)))
    ids = cams["ids"] + more["ids"]
    xz = np.concatenate([cams["xz"], more["xz"]])
    d = np.hypot(*(xz - at).T)
    near = np.nonzero(d < reach)[0]
    scored = []
    for n in near:
        ident = ids[n]
        a, b = xz[n]
        i, j = int(round((a - p["gx0"]) / 10)), int(round((b - p["gz0"]) / 10))
        if not (0 <= i < p["gw"] and 0 <= j < p["gw"]):
            continue
        eye = int(p["ground"][j, i]) + 25
        score = 0.0
        for w in walls:
            dist = np.hypot(w["x"] - a, w["z"] - b).clip(1)
            dx, dz = w["d"]
            inc = abs(dx * (b - w["z"][0]) - dz * (a - w["x"][0])) / (w["length"] * dist[0])
            if inc < 0.35 or dist.min() < 32 or dist.min() > 600:
                continue
            seen = unoccluded(p, a, b, eye, w["x"], w["z"], w["y"], dist)
            score += seen.sum() * inc**2 / (1 + (dist.mean() / 250) ** 2)
        if score > 0:
            scored.append((score, ident, a, b, eye))
    scored.sort(reverse=True)
    picked = []
    for s, ident, a, b, eye in scored:
        if not all(math.hypot(a - q[2], b - q[3]) > 40 for q in picked):
            continue
        if ident not in cams["meta"]:
            r = fetcher.resolve(ident)
            if r is None:
                continue
            a, b = r[1], r[2]
        picked.append((s, ident, a, b, eye))
        if len(picked) == k:
            break
    return picked


class Faces:
    """Faces and their labels, cut once and shared by every building that falls in them."""

    def __init__(self, fetcher, segmenter):
        self.fetcher, self.segmenter = fetcher, segmenter
        self.pano = lru_cache(maxsize=6)(self._pano)
        self.cache = {}
        self.segmented = 0

    def _pano(self, ident):
        path = self.fetcher.photo(ident)
        if path is None:
            return None
        if isinstance(path, tuple):
            import io

            with zipfile.ZipFile(path[0]) as z, Image.open(io.BytesIO(z.read(path[1]))) as img:
                return np.asarray(img.convert("RGB"))
        with Image.open(path) as img:
            return np.asarray(img.convert("RGB"))

    def get(self, ident, bucket):
        key = (ident, bucket)
        if key in self.cache:
            return self.cache[key]
        pano = self.pano(ident)
        if pano is None:
            self.cache[key] = None
            return None
        rot = rotation(np.array(cameras()["meta"][ident][3]))
        face = cut(pano, rot, bucket * BUCKET)
        path = LABELS / f"{ident}-{bucket}.npy"
        if path.is_file():
            labels = np.load(path)
        else:
            labels = self.segmenter(face)
            self.segmented += 1
            LABELS.mkdir(parents=True, exist_ok=True)
            np.save(path, labels)
        self.cache = {k: v for k, v in list(self.cache.items())[-24:]}
        self.cache[key] = (face, labels)
        return self.cache[key]


def view(p, walls, cam, faces):
    """What one camera says of a building: per texel, its label, its colour and where it stands on the wall."""
    _, ident, a, b, eye = cam
    meta = cameras()["meta"][ident]
    rot = rotation(np.array(meta[3]))
    pano = faces.pano(ident)
    if pano is None:
        return None
    gain = exposure(p, a, b, eye, rot, pano)
    texels = []
    for wi, w in enumerate(walls):
        dist = np.hypot(w["x"] - a, w["z"] - b).clip(1)
        dx, dz = w["d"]
        inc = np.abs(dx * (b - w["z"]) - dz * (a - w["x"])) / (w["length"] * dist)
        ok = (inc > 0.35) & (dist > 32) & (dist < 600)
        if not ok.any():
            continue
        seen = unoccluded(p, a, b, eye, w["x"], w["z"], w["y"], dist) & ok
        rr, cc = np.nonzero(seen)
        if not rr.size:
            continue
        world = np.column_stack((w["x"][cc] - a, b - w["z"][cc], w["y"][rr] - eye)) / 10
        texels.append((wi, rr, cc, world))
    if not texels:
        return None
    heading = math.atan2(*np.concatenate([t[3] for t in texels])[:, :2].mean(0))
    bucket = int(round(heading / BUCKET)) % 12
    got = faces.get(ident, bucket)
    if got is None:
        return None
    face, labels = got
    out = dict(camera=ident, at=(a, b), gain=gain, heading=heading, rows=[])
    for wi, rr, cc, world in texels:
        col, row = onto(world, bucket * BUCKET)
        inside = ~np.isnan(col)
        if not inside.any():
            continue
        ci, ri = np.rint(col[inside]).astype(int), np.rint(row[inside]).astype(int)
        out["rows"].append(
            dict(
                wall=wi,
                r=rr[inside],
                c=cc[inside],
                label=labels[ri, ci],
                rgb=face[ri, ci],
                px=np.column_stack((ci, ri)),
            )
        )
    out["face"] = face
    # The face's exposure: its bright things outside the sky (clipped ones count, at their clipped value) to WHITE.
    ys = linear(face[labels != SKY]) @ LUMA
    out["exposure"] = float(np.clip(WHITE / max(float(np.percentile(ys, 95)), 1e-3), *GAIN)) if ys.size else 1.0
    # Road and pavement are near grey: a light white balance from them, never more than a tenth on a channel. Their
    # brightness is no exposure reference: one panorama's road is ten times brighter in sun than in shade.
    ground = np.isin(labels, (6, 11)) & (face.max(2) < 250)
    if ground.sum() >= 2000:
        grey = np.median(linear(face[ground]), 0)
        out["wb"] = np.clip(grey.mean() / np.maximum(grey, 1e-4), 0.9, 1.1).astype("f4")
    else:
        out["wb"] = np.ones(3, "f4")
    return out if out["rows"] else None


def view_colour(v, old=False):
    """One view's wall colour in linear light and how much of it was blown out: (colour, texels, clipped, weight).

    The new reading keeps the photo's own exposure: facade_paint's asphalt gain reached its 2.0 ceiling on well exposed
    photos and turned their walls white (Nob Hill, November 20). old=True reads a view as facade_paint did (sky and
    leaves by hue, that gain on encoded values, clipped at 255) for the before half of the measurement; the trust
    test is the same for both."""
    rgb = np.concatenate([r["rgb"] for r in v["rows"]])
    label = np.concatenate([r["label"] for r in v["rows"]])
    raw_clip = rgb.max(1) >= 250
    if old:
        r, g, b = rgb.T
        sky = (b > r * 1.28) & (b > g * 1.10) & (b > 120)
        leaves = (g > r * 1.16) & (g > b * 1.28)
        keep = ~(sky | leaves) & (rgb.max(1) > 30)
        if keep.sum() < MIN_TEXELS:
            return None
        col = linear(np.median(np.clip(rgb[keep] * v["gain"], 0, 255), 0))
        return col, int(keep.sum()), float(raw_clip[keep].mean()), 1.0
    wall = np.isin(label, WALL)
    if wall.sum() < MIN_TEXELS:
        return None
    clipped = float(raw_clip[wall].mean())
    lin = linear(rgb[wall]) * v["wb"]
    lum = lin @ LUMA
    # Windows are labelled building too: a texel under half the wall's median is a window (`openings`), not wall.
    keep = ~raw_clip[wall] & (lum > 0.01) & (lum >= 0.5 * np.median(lum))
    if keep.sum() < MIN_TEXELS:
        return None
    col = np.clip(np.median(lin[keep], 0) * v["exposure"], 0, 1)
    return col, int(keep.sum()), clipped, float(min(1.0, keep.sum() / 200))


def consensus(colours, old=False):
    """The trust test on per-view colours [(linear rgb, texels, clipped, weight)]: (colour, confidence, agreeing, trusted,
    shaded). The new reading first drops views more than SHADE below the second brightest (`shaded` counts them)."""
    views = [c for c in colours if c is not None and c[2] <= CLIPPED]
    if not views:
        return None, 0.0, 0, False, 0
    labs = lab(np.array([c[0] for c in views]))
    shaded = 0
    if not old and len(views) >= 2:
        # A view is the wall in shade when it is far darker than the second brightest and, brought up to that view's
        # light, is the same colour. A darker view of another colour still votes.
        ref = int(np.argsort(labs[:, 0])[-2])
        lin = np.array([c[0] for c in views])
        luma = np.maximum(lin @ LUMA, 1e-4)
        same = np.linalg.norm(lab(lin * (luma[ref] / luma)[:, None]) - labs[ref], axis=1) <= AGREE
        lit = ~((labs[:, 0] < labs[ref, 0] - SHADE) & same)
        shaded = int((~lit).sum())
        views, labs = [c for c, k in zip(views, lit) if k], labs[lit]
    w = np.array([c[3] for c in views])
    # The weighted median of each CIELAB axis, then who agrees with it. Lightness counts 1 / kL (kL = 2, as CIE94 has
    # it for textiles, for the old reading: sun and shade on one wall move L far more than its hue).
    mid = np.array([_wmedian(labs[:, k], w) for k in range(3)])
    de = np.linalg.norm((labs - mid) / np.array([KL_OLD if old else KL, 1.0, 1.0]), axis=1)
    agree = de <= AGREE
    share = w[agree].sum() / w.sum()
    n = int(agree.sum())
    if n:
        colour = np.average(np.array([c[0] for c in views])[agree], axis=0, weights=w[agree])
        spread = float(np.average(de[agree], weights=w[agree]))
    else:
        colour, spread = views[int(np.argmax(w))][0], AGREE
    trusted = bool(n >= 2 and share >= AGREE_SHARE)
    confidence = (0.5 * min(1.0, (n - 1) / 2) + 0.5 * max(0.0, 1 - spread / AGREE)) * share if n else 0.0
    return colour, round(float(confidence), 3), n, trusted, shaded


def _wmedian(x, w):
    o = np.argsort(x)
    c = np.cumsum(w[o])
    return float(x[o][np.searchsorted(c, c[-1] / 2)])


def openings(views):
    """Glass share of the upper wall, the windows' shape, and the ground floor, from the views that saw enough.

    ADE20K labels a street front's windows as building (UperNet: no windowpane on any Nob Hill front), so a window is
    a facade texel under half the view's median wall brightness: the dark of a room through glass. A window that
    mirrors the sky is missed, so the share is a floor."""
    ratios, shapes, shops, awnings = [], [], [], []
    weights = np.array([0.2126, 0.7152, 0.0722], "f4")
    for v in views:
        for_ratio = np.zeros(2)
        ground = np.zeros(3)
        allwall = np.concatenate([r["rgb"][np.isin(r["label"], WALL)] for r in v["rows"]])
        if len(allwall) < MIN_TEXELS:
            continue
        mid = float(np.median(linear(allwall) @ weights))
        for r in v["rows"]:
            facade = np.isin(r["label"], WALL + GLASS + DOOR)
            upper = r["r"] * STEP >= 35  # above 3.5 m
            g = facade & ((linear(r["rgb"]) @ weights < 0.5 * mid) | np.isin(r["label"], GLASS))
            for_ratio += [(g & upper).sum(), (facade & upper).sum()]
            low = ~upper
            ground += [(g & low).sum() + np.isin(r["label"], DOOR)[low].sum(), (facade & low).sum(), (np.isin(r["label"], AWNING + SIGN) & low).sum()]
            aw = np.isin(r["label"], AWNING)
            if aw.sum() >= 8:
                awnings.append(np.median(linear(r["rgb"][aw]) * v["wb"], 0))
            # Windows as runs of glass texels on this wall: their height over their width.
            if g.sum() >= 6:
                grid = np.zeros((r["r"].max() + 1, r["c"].max() + 1), bool)
                grid[r["r"][g], r["c"][g]] = True
                from scipy import ndimage

                lab_, n = ndimage.label(grid)
                for s in ndimage.find_objects(lab_):
                    hh, ww = s[0].stop - s[0].start, s[1].stop - s[1].start
                    if hh * ww >= 4 and hh * ww <= 60:
                        shapes.append(hh / ww)
        if for_ratio[1] >= 60 and v["wb"] is not None:
            ratios.append(for_ratio[0] / for_ratio[1])
        if ground[1] + ground[2] >= 30:
            shops.append((ground[0] / max(1, ground[1]) >= 0.45) or (ground[2] / (ground[1] + ground[2]) >= 0.08))
    out = {}
    if ratios:
        spread = float(np.ptp(ratios)) if len(ratios) > 1 else 0.2
        out["windows"] = dict(
            ratio=round(float(np.median(ratios)), 3),
            views=len(ratios),
            confidence=round(min(1.0, len(ratios) / 3) * max(0.0, 1 - spread / 0.3), 3),
        )
        if len(shapes) >= 3:
            s = float(np.median(shapes))
            out["windows"]["shape"] = "tall" if s >= 1.4 else ("wide" if s <= 0.8 else "square")
            out["windows"]["aspect"] = round(s, 2)
    if shops:
        yes = sum(shops) / len(shops)
        out["storefront"] = dict(value=bool(yes >= 0.5), views=len(shops), confidence=round(float(abs(yes - 0.5) * 2 * min(1.0, len(shops) / 2)), 3))
    if awnings:
        out["awning"] = dict(srgb=[int(round(v)) for v in encoded(np.median(awnings, 0))], views=len(awnings))
    return out


def material(views, classifier):
    """SigLIP's reading of the building in its two best views, averaged; confidence is the winning share times agreement."""
    probs = []
    for v in sorted(views, key=lambda v: -sum(len(r["px"]) for r in v["rows"]))[:2]:
        px = np.concatenate([r["px"][np.isin(r["label"], WALL + GLASS + DOOR)] for r in v["rows"]])
        if len(px) < MIN_TEXELS:
            continue
        lo, hi = np.percentile(px, 2, 0), np.percentile(px, 98, 0)
        pad = (hi - lo) * 0.08
        c0, r0 = np.maximum(lo - pad, 0).astype(int)
        c1, r1 = np.minimum(hi + pad, [FACE_W - 1, FACE_H - 1]).astype(int)
        if c1 - c0 < 48 or r1 - r0 < 48:
            continue
        probs.append(classifier(v["face"][r0:r1, c0:c1].clip(0, 255).astype("u1")))
    if not probs:
        return None
    mean = np.mean(probs, 0)
    best = int(np.argmax(mean))
    agree = all(int(np.argmax(q)) == best for q in probs)
    return dict(
        cls=MATERIALS[best],
        drawn=DRAWN_AS[MATERIALS[best]],
        p={m: round(float(x), 3) for m, x in zip(MATERIALS, mean)},
        views=len(probs),
        confidence=round(float(mean[best]) * (1.0 if agree and len(probs) > 1 else 0.6), 3),
    )


def key_of(verts):
    """A building's name in every tile it is cut into: its corners, as the bake wrote them."""
    return ";".join(f"{x},{z}" for x, z, _ in verts)


@lru_cache(maxsize=4)
def city_ids(square):
    """Each pack row's city building number (sf16_bldgid), in the bake's order: a part of a footprint is a row."""
    path = CITY / "inputs" / (square + ".zip")
    if not path.is_file():
        return None
    from shapely.geometry import shape

    with zipfile.ZipFile(path) as z:
        feats = json.loads(z.read("footprints.geojson"))["features"]
    ids = []
    for fid, f in enumerate(feats, 1):
        g = shape(f["geometry"])
        name = str(f["properties"].get("sf16_bldgid") or f["properties"].get("globalid") or fid)
        ids.extend(name for part in getattr(g, "geoms", [g]) if not part.is_empty)
    return ids


@lru_cache(maxsize=4)
def footprints(square):
    """A square's footprints (its archive's footprints.geojson) in the frame's decimetres, with the city's building
    number of each, and a tree to find them by."""
    path = CITY / "inputs" / (square + ".zip")
    if not path.is_file():
        return None
    from shapely import STRtree
    from shapely.geometry import shape
    from shapely.ops import transform

    from paint_cameras import TO_UTM

    def frame(lon, lat, z=None):
        e, n = TO_UTM.transform(lon, lat)
        return (np.asarray(e) - 500000) * 10, (4250000 - np.asarray(n)) * 10

    with zipfile.ZipFile(path) as z:
        feats = json.loads(z.read("footprints.geojson"))["features"]
    geoms = [transform(frame, shape(f["geometry"])) for f in feats]
    names = [str(f["properties"].get("sf16_bldgid") or f["properties"].get("globalid") or n) for n, f in enumerate(feats, 1)]
    return STRtree(geoms), geoms, names


def city_of(square, verts):
    """The city's building number of a pack building, as the footprint it overlaps most. The pack's rows are not one to
    one with the archive's footprint parts in most squares (`city_ids` gave up on all but 22 of 717 records), and the far
    model (landing/ina/looks.py `evidence`) finds a record by this number."""
    found = footprints(square)
    if found is None:
        return None
    from shapely.geometry import Polygon

    tree, geoms, names = found
    ring = []
    for x, z, flags in verts:
        ring.append((x, z))
        if flags & 4:
            break
    if len(ring) < 3:
        return None
    poly = Polygon(ring).buffer(0)
    best = max(((poly.intersection(geoms[i]).area, i) for i in tree.query(poly, predicate="intersects")), default=(0, None))
    return names[best[1]] if best[0] > 0.5 * poly.area else None


def measure(square, targets, faces, classifier=None, k=4):
    """Records for the buildings of a square whose row numbers are `targets`."""
    p = read(CITY / "packs" / (square + ".bay"))
    ids = city_ids(square)
    if ids is not None and len(ids) != len(p["buildings"]):
        ids = None
    out = {}
    chosen = {}
    for n in targets:
        verts, row = p["buildings"][n]
        walls = walls_of(p, verts, row)
        chosen[n] = (walls, choose(p, walls, centre(verts), k, fetcher=faces.fetcher) if walls else [])
    # Fetch the batch's photographs six at a time: the Graph API allows far more, and one at a time was most of a
    # building's 15 s.
    from concurrent.futures import ThreadPoolExecutor

    def fetch(ident):
        try:
            faces.fetcher.photo(ident)
        except RuntimeError:
            pass  # asked again, one at a time, when its view is read

    with ThreadPoolExecutor(6) as pool:
        list(pool.map(fetch, sorted({c[1] for _, picked in chosen.values() for c in picked})))
    for n in targets:
        verts, row = p["buildings"][n]
        walls, picked = chosen[n]
        rec = dict(square=square, row=n, city=ids[n] if ids else city_of(square, verts), walls=len(walls))
        if not walls:
            rec["views"] = 0
            out[key_of(verts)] = rec
            continue
        views = [v for v in (view(p, walls, c, faces) for c in picked) if v]
        rec["cameras"] = [v["camera"] for v in views]
        rec["views"] = len(views)
        new = [view_colour(v) for v in views]
        old = [view_colour(v, old=True) for v in views]
        colour, conf, agree, trusted, shaded = consensus(new)
        before = consensus(old, old=True)
        rec["before"] = dict(trusted=before[3], agreeing=before[2], confidence=before[1])
        if before[0] is not None:
            rec["before"]["srgb"] = [int(round(v)) for v in encoded(before[0])]
        if colour is not None:
            srgb = encoded(colour)
            rec["wall"] = dict(
                linear=[round(float(v), 4) for v in colour],
                srgb=[int(round(v)) for v in srgb],
                palette=palette_index(srgb),
                agreeing=agree,
                confidence=conf,
                trusted=trusted,
                clipped=[round(c[2], 2) for c in new if c is not None],
                exposure=[round(v["exposure"], 2) for v in views],
            )
        rec["dropped"] = dict(
            shaded=shaded,
            blown=sum(1 for c in new if c is not None and c[2] > CLIPPED),
            few=sum(1 for c in new if c is None),
        )
        rec.update(openings(views))
        if classifier is not None and views:
            m = material(views, classifier)
            if m:
                rec["material"] = m
        out[key_of(verts)] = rec
    return out


def near(square, x, z, radius):
    """Rows of a square's buildings with a street wall within `radius` metres of (x, z) in metres of the frame."""
    p = read(CITY / "packs" / (square + ".bay"))
    rows = []
    for n, (verts, _) in enumerate(p["buildings"]):
        v = np.array([q[:2] for q in verts], "f8") / 10
        if np.hypot(v[:, 0] - x, v[:, 1] - z).min() < radius and any(f & 2 for *_, f in verts):
            rows.append(n)
    return rows


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("action", choices=["measure"])
    cli.add_argument("--square", required=True)
    cli.add_argument("--rows", type=int, nargs="*")
    cli.add_argument("--near", type=float, nargs=3, metavar=("X", "Z", "RADIUS"))
    cli.add_argument("--out", type=Path, required=True)
    cli.add_argument("--no-material", action="store_true")
    a = cli.parse_args()
    rows = a.rows or near(a.square, *a.near)
    faces = Faces(Fetcher(), Segmenter())
    rec = measure(a.square, rows, faces, None if a.no_material else Classifier())
    a.out.write_text(json.dumps(rec, indent=1))


if __name__ == "__main__":
    main()
