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


def crowns(cls, tint, top, ground, src):
    from bake import palette

    g = ground[:-1, :-1].repeat(2, 0).repeat(2, 1)
    mask = ((cls & 24) == 8) & (top > g + 7)
    if not mask.any():
        return {}
    w = len(top)
    rgb = image(src, "naip.png", w)
    nir = image(src, "naip-nir.png", w)[:, :, 0].astype("i2")
    red = rgb[:, :, 0].astype("i2")
    green = (nir - red) > 0.12 * (nir + red + 1)
    fine = np.load(src.open("top_mm.npy")).reshape(w, 2, w, 2)
    # The second-highest quarter-metre return rejects lone high points. Keep
    # the measured crest where the neighbouring crown and its returns agree.
    heights = np.sort(fine.transpose(0, 2, 1, 3).reshape(w, w, 4), axis=2)
    observed = heights[:, :, 2] != -2147483648
    robust = (
        np.rint(heights[:, :, 2].astype("f4") / 100 - 10)
        .clip(-32768, 32767)
        .astype("i2")
    )
    del fine, heights
    padded = np.pad(np.where(mask, top, -32768), 1, constant_values=-32768)
    neighbours = np.sort(
        np.stack(
            [padded[1:-1, :-2], padded[1:-1, 2:], padded[:-2, 1:-1], padded[2:, 1:-1]],
            axis=2,
        ),
        axis=2,
    )
    mid = neighbours[:, :, 2]
    fix = mask & observed & (mid > g + 8) & (top > mid + 15) & (robust < top - 5)
    top[fix] = np.maximum(mid[fix], robust[fix])
    # Average foliage colour within the observed crown only. A neutral wall or
    # a sunlit pavement must not bleed into an isolated branch at the edge.
    valid = mask & green
    if not valid.any():
        return {"crownSpikesFiltered": int(fix.sum())}
    n = (w + 7) // 8

    def average(values):
        return np.asarray(
            Image.fromarray(values.astype("f4"))
            .resize((n, n), Image.Resampling.BOX)
            .resize((w, w), Image.Resampling.BILINEAR)
        )

    weight = average(valid)
    base = np.percentile(rgb[valid], 60, axis=0)
    target = []
    for ch in range(3):
        total = average(np.where(valid, rgb[:, :, ch], 0))
        target.append(
            np.where(weight > 0.08, total / np.maximum(weight, 0.01), base[ch])[mask]
        )
    target = np.stack(target, axis=1)
    # Recover local colour without baking the flight's deepest leaf shadows
    # a second time. Keep the observed red/green/blue ratios.
    peak = np.maximum(target.max(1), 1)
    target *= (np.clip(peak * 1.12, 83, 168) / peak)[:, None]
    choices = [16 + h * 10 + tone for h in range(3, 11) for tone in (2, 5, 6, 8, 9)]
    table = palette() * 255
    # A 5-bit RGB lookup bounds the working set on the densest park square.
    axis = np.arange(32) * 8 + 4
    lut = np.stack(np.meshgrid(axis, axis, axis, indexing="ij"), axis=-1)
    closest = np.sum((lut[:, :, :, None, :] - table[choices]) ** 2, axis=-1).argmin(3)
    bucket = (target.clip(0, 255).astype("u1") // 8).T
    tint[mask] = np.asarray(choices, "u1")[closest[tuple(bucket)]]
    return {
        "surveyedCanopySamples": int(mask.sum()),
        "crownFoliageSamples": int(valid.sum()),
        "crownSpikesFiltered": int(fix.sum()),
    }


def apply(path, archive, passes=("paving", "crowns")):
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
            elif fn == "crowns":
                stats.update(crowns(cls, tint, top, ground, src))
            else:
                raise ValueError(f"unknown surface pass {fn}")
    temp = path.with_suffix(".surface-part")
    temp.write_bytes(data)
    temp.replace(path)
    return stats
