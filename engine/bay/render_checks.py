"""What the panel gate reads in a render's pixels (#450), each measured the same way in the reference photograph.

pillars   thin upright structures standing in the sky over the roofline, counted in both pictures
banding   second-difference energy on edge-free wall pixels, along x (upright ribs) and along y (courses)
windows   dark openings with their bars closed: their median width over height, and opening over opening plus pier
judge     a vision model's reading of the native pixels, which names these defects

Only `pillars` and `judge` decide (panel_gate.py). On the Nob Hill batch the owner flagged, banding and window
measures did not separate the defective render from the fixed one or from the photographs (photo walls carry more
fine texture than any render, and a photograph's sash casings split its windows), so they are reported, not
thresholds fitted to one view.
"""

import json
import os
from pathlib import Path
import subprocess
from collections import deque

import numpy as np
from PIL import Image

SIZE = (960, 540)
JUDGE_MODEL = "claude-opus-5-5"
DEFECTS = ("pillars", "banding", "narrow windows")


def load(path):
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        if rgb.size != SIZE:
            rgb = rgb.resize(SIZE, Image.Resampling.LANCZOS)
        return np.asarray(rgb).astype(np.float32)


def luminance(rgb):
    return rgb @ np.array([0.299, 0.587, 0.114], np.float32)


def box(a, k, axis):
    pad = [(0, 0)] * a.ndim
    pad[axis] = (k // 2, k // 2)
    c = np.cumsum(np.pad(a, pad, mode="edge"), axis)
    c = np.insert(c, 0, 0, axis)
    n = c.shape[axis]
    return (np.take(c, range(k, n), axis) - np.take(c, range(0, n - k), axis)) / k


def blur(a, k):
    return box(box(a, k, 0), k, 1)


def grow(mask, k):
    out = mask.copy()
    for d in range(1, k // 2 + 1):
        for axis in (0, 1):
            out |= np.roll(mask, d, axis) | np.roll(mask, -d, axis)
    return out


def sky(rgb):
    """Blue sky or bright grey cloud, reached from the picture's top edge."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    candidate = ((b > r + 12) & (b > g) & (b > 90)) | (
        (rgb.mean(2) > 165) & (rgb.max(2) - rgb.min(2) < 45)
    )
    out = np.zeros_like(candidate)
    out[0] = candidate[0]
    for y in range(1, len(candidate)):
        above = out[y - 1]
        row = candidate[y] & (above | np.roll(above, 1) | np.roll(above, -1))
        for _ in range(3):
            row |= candidate[y] & (np.roll(row, 1) | np.roll(row, -1))
        out[y] = row
    return out


def pillars(rgb, tallest=40, widest=18):
    """Upright structures at most `widest` px across with sky on both sides for at least `tallest` px: a pole, a
    lamp mast or a trunk seen against the sky. Returns (x, top, width, height) for each."""
    open_air = sky(rgb)
    solid = ~open_air
    thin = np.zeros_like(solid)
    for w in range(1, 15):
        run = np.roll(open_air, 1, 1) & np.roll(open_air, -w, 1)
        for k in range(w):
            run &= np.roll(solid, -k, 1)
        for k in range(w):
            thin |= np.roll(run, k, 1)
    thin[:, :2] = thin[:, -16:] = False
    longest = np.zeros(thin.shape[1], int)
    top = np.zeros(thin.shape[1], int)
    run = np.zeros(thin.shape[1], int)
    for y in range(thin.shape[0]):
        run = np.where(thin[y], run + 1, 0)
        better = run > longest
        longest = np.where(better, run, longest)
        top = np.where(better, y - run + 1, top)
    tall = longest >= tallest
    found, x = [], 0
    while x < len(tall):
        if not tall[x]:
            x += 1
            continue
        end = x
        while end + 1 < len(tall) and (
            tall[end + 1] or (end + 2 < len(tall) and tall[end + 2])
        ):
            end += 1
        width = end - x + 1
        if 2 <= width <= widest:
            found.append(
                (x, int(top[x : end + 1].min()), width, int(longest[x : end + 1].max()))
            )
        x = end + 1
    return found


def banding(rgb):
    """Second differences relative to the wall's brightness, in percent, on pixels at least three from any edge
    (found on a 5 px blur, so a cell-high alternation cannot hide itself) in the upper 62% of the picture."""
    lum = luminance(rgb)
    soft = blur(lum, 5)
    edge = np.abs(np.diff(soft, axis=1, append=soft[:, -1:])) + np.abs(
        np.diff(soft, axis=0, append=soft[-1:])
    )
    wall = ~grow(edge > 6, 7) & ~grow(sky(rgb), 13) & (blur(lum, 31) > 30)
    wall[int(lum.shape[0] * 0.62) :] = False
    wall[:1] = wall[-1:] = False
    wall[:, :1] = wall[:, -1:] = False
    if wall.sum() < 3000:
        return None
    across = lum - (np.roll(lum, 1, 1) + np.roll(lum, -1, 1)) / 2
    down = lum - (np.roll(lum, 1, 0) + np.roll(lum, -1, 0)) / 2
    mean = float(lum[wall].mean())
    return dict(
        ribs=round(float(np.sqrt((across[wall] ** 2).mean())) / mean * 100, 2),
        courses=round(float(np.sqrt((down[wall] ** 2).mean())) / mean * 100, 2),
        pixels=int(wall.sum()),
    )


def _blobs(mask):
    height, width = mask.shape
    seen = np.zeros_like(mask)
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]:
            continue
        queue = deque([(y0, x0)])
        seen[y0, x0] = True
        y1 = y2 = y0
        x1 = x2 = x0
        n = 0
        while queue:
            y, x = queue.popleft()
            n += 1
            y1, y2, x1, x2 = min(y1, y), max(y2, y), min(x1, x), max(x2, x)
            for v, u in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= v < height and 0 <= u < width and mask[v, u] and not seen[v, u]:
                    seen[v, u] = True
                    queue.append((v, u))
        yield int(x1), int(y1), int(x2 - x1 + 1), int(y2 - y1 + 1), n


def windows(rgb):
    """Openings darker than their wall, bars of up to 4 px closed: how many, their median width over height, and
    along each row the opening's share of opening plus the pier to the next opening."""
    lum = luminance(rgb)
    open_air = sky(rgb)
    dark = (lum < 0.7 * blur(lum, 41)) & ~open_air
    closed = ~grow(~grow(dark, 5), 5)
    closed = grow(~grow(~closed, 3), 3)
    closed[int(lum.shape[0] * 0.62) :] = False
    shapes = [
        (w, h)
        for _, _, w, h, n in _blobs(closed)
        if 5 <= h <= 120 and 3 <= w <= 160 and n >= 25 and n / (w * h) > 0.7
    ]
    opening = pier = 0
    for y in range(int(lum.shape[0] * 0.62)):
        edges = np.flatnonzero(np.diff(np.concatenate([[0], closed[y].astype(int), [0]])))
        starts, ends = edges[::2], edges[1::2]
        for k in range(len(starts)):
            if ends[k] - starts[k] >= 3:
                opening += ends[k] - starts[k]
            if k + 1 < len(starts):
                gap = starts[k + 1] - ends[k]
                if 2 <= gap <= 60 and not open_air[y, ends[k] : starts[k + 1]].any():
                    pier += gap
    return dict(
        count=len(shapes),
        aspect=round(float(np.median([w / h for w, h in shapes])), 2) if shapes else None,
        glazing=round(opening / max(opening + pier, 1), 2),
    )


PROMPT = """You are checking a render of a real San Francisco street against the photograph taken from the same \
camera ({view}). In this folder: reference.png is the photograph; render.png is our render at native resolution; \
render-left.png and render-right.png are its left and right halves enlarged twice with no smoothing, so single \
pixels show. Read all four images with the Read tool, then look closely.

Name every one of these defects you can see in the render, and only if you can see it:
- "pillars": thin upright posts or columns that rise above the roofs or stand in front of buildings and have no \
counterpart in the photograph (real poles or lamps that the photograph also shows do not count).
- "banding": a ribbed, striped or vertically banded texture across building walls that the photograph's walls do \
not have.
- "narrow windows": windows clearly narrower or smaller than the photograph's windows on comparable walls.
- "other": any other defect a person would notice at once.

Reply with JSON only, no prose and no code fence:
{{"defects": [{{"name": "pillars" | "banding" | "narrow windows" | "other", "clear": true | false, \
"where": "<where in the render>"}}], "notes": "<one sentence>"}}
"clear" is true when anyone would notice the defect at once, false when it is slight. An empty list means none."""


def judge(render, reference, view, folder, model=JUDGE_MODEL, timeout=900):
    """Ask a vision model about one view. Any failure is reported as such, never as a clean view."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    with Image.open(render) as image:
        rgb = image.convert("RGB")
    rgb.save(folder / "render.png")
    half = rgb.width // 2
    for name, area in (("render-left", (0, 0, half, rgb.height)), ("render-right", (half, 0, rgb.width, rgb.height))):
        crop = rgb.crop(area)
        crop.resize((crop.width * 2, crop.height * 2), Image.Resampling.NEAREST).save(folder / (name + ".png"))
    with Image.open(reference) as image:
        image.convert("RGB").resize(rgb.size, Image.Resampling.LANCZOS).save(folder / "reference.png")
    env = {k: v for k, v in os.environ.items() if k != "NODE_OPTIONS"}
    try:
        done = subprocess.run(
            [
                "claude", "-p", PROMPT.format(view=view), "--model", model, "--output-format", "json",
                "--allowedTools", "Read", "--max-turns", "8",
            ],
            cwd=folder, env=env, capture_output=True, text=True, timeout=timeout,
        )
        outer = json.loads(done.stdout)
        if done.returncode or outer.get("is_error"):
            raise ValueError(f"judge call failed: {done.stderr[-300:] or outer.get('result', '')[:300]}")
        text = outer["result"].strip()
        reply = json.loads(text[text.find("{") : text.rfind("}") + 1])
        defects = reply["defects"]
        if not isinstance(defects, list) or any(
            d.get("name") not in (*DEFECTS, "other") or not isinstance(d.get("clear"), bool) for d in defects
        ):
            raise ValueError(f"judge reply out of form: {text[:300]}")
        return dict(model=model, defects=defects, notes=str(reply.get("notes", ""))[:400])
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        return dict(model=model, error=str(error)[:400])
