"""Restore unshadowed asphalt and measured canopy detail from a square's retained rasters."""

import struct
import zipfile
import numpy as np
from PIL import Image


def image(src, name, width):
    with Image.open(src.open(name)) as full:
        margin = (full.width - width) // 2
        return np.asarray(
            full.crop((margin, margin, margin + width, margin + width)).convert("RGB")
        )


def paving(cls, tint, top, ground, src):
    road = ((cls & 31) == 0) & (top == -32768)
    if not road.any():
        return {}
    width = len(top)
    rgb = image(src, "naip.png", width)
    luma = np.rint(rgb @ np.array([0.213, 0.715, 0.072], dtype="f4")).astype("u1")
    # Parked vehicles, painted lines, vegetation and deep cast shadows should
    # not be burned into the albedo and shadowed again by the page.
    high = np.load(src.open("top_mm.npy")).reshape(width, 2, width, 2).max(axis=(1, 3))
    g = ground[:-1, :-1].repeat(2, 0).repeat(2, 1).astype("i4")
    valid = road & ((cls & 96) == 0) & (high != -2147483648) & (high < (g + 15) * 100)
    valid &= (rgb.max(2) - rgb.min(2) < 38) & (luma >= 58) & (luma <= 209)
    if not valid.any():
        return {}
    city = float(np.percentile(luma[valid], 65))
    # A robust local daylight sample per 16 m patch. Interpolate between
    # patches so their boundaries cannot become stripes across the street.
    step = 32
    pad = (-width) % step
    a = np.pad(np.where(valid, luma, 0), ((0, pad), (0, pad)))
    n = a.shape[0] // step
    blocks = a.reshape(n, step, n, step).transpose(0, 2, 1, 3).reshape(n, n, -1)
    counts = (blocks != 0).sum(2)
    ordered = np.sort(blocks, axis=2)
    k = step * step - 1 - np.rint(np.maximum(counts - 1, 0) * 0.35).astype(int)
    values = np.take_along_axis(ordered, k[:, :, None], axis=2)[:, :, 0]
    values = np.where(
        counts >= 12, np.clip(values, 0.76 * city, 1.18 * city), city
    ).astype("f4")
    smooth = np.asarray(
        Image.fromarray(values).resize(
            (width + pad, width + pad), Image.Resampling.BILINEAR
        )
    )[:width, :width]
    grey = np.rint(1 + (0.86 - smooth / 255) * 14 / 0.8).clip(4, 11).astype("u1")
    tint[road] = grey[road]
    cls[road] |= 128
    return {
        "surveyedRoadSamples": int(road.sum()),
        "roadDaylightSamples": int(valid.sum()),
        "roadDaylightLuma": round(city),
    }


def apply(path, archive, passes=("paving",)):
    data = bytearray(path.read_bytes())
    h = struct.unpack_from("<16i", data)
    if h[4] != 10 or h[8] != 5 or h[15] != 0:
        raise ValueError("surface detail needs a full surveyed square")
    gw, w = h[5], h[9]
    ground = np.frombuffer(data, "<i2", gw * gw, 64).reshape(gw, gw)
    start = 64 + 2 * gw * gw
    top = np.frombuffer(data, "<i2", w * w, start).reshape(w, w)
    cls = np.frombuffer(data, "u1", w * w, start + 2 * w * w).reshape(w, w)
    tint = np.frombuffer(data, "u1", w * w, start + 3 * w * w).reshape(w, w)
    stats = {}
    with zipfile.ZipFile(archive) as src:
        for fn in passes:
            if fn == "paving":
                stats.update(paving(cls, tint, top, ground, src))
            else:
                raise ValueError(f"unknown surface pass {fn}")
    temp = path.with_suffix(".surface-part")
    temp.write_bytes(data)
    temp.replace(path)
    return stats
