"""Faces of cells (#423): how the place's faces are packed and merged into rectangles (matte.py's columns use
both), and the faces of a solid: a block of cells of 10 cm, the engine's own, any of which may be air.

A column of the lidar's surface is solid from its top to the ground, so it cannot say a cornice with air under it,
a belfry narrower than its cornice, or a cross. Where that matters a thing is built as a solid (church.py) and the
lidar's columns are cut off under it.
"""
import math
import numpy as np

from place import TURN


def rects(key, most=1023):
    """Cells of one key that lie together, as rectangles: (row, col, rows, cols, key) for every key at or over 0. Rows of equal cells first, then equal rows one under another."""
    nr, nc = key.shape
    k = np.concatenate([key, np.full((nr, 1), -2, key.dtype)], 1).ravel()
    change = np.flatnonzero(np.concatenate([[True], k[1:] != k[:-1]]))
    length = np.diff(np.concatenate([change, [len(k)]]))
    val = k[change]
    ok = val >= 0
    start, length, val = change[ok], length[ok], val[ok]
    row, col = start // (nc + 1), start % (nc + 1)
    # A run longer than a face can say is cut.
    if (length > most).any():
        parts = np.ceil(length / most).astype(np.int64)
        which = np.repeat(np.arange(len(length)), parts)
        nth = np.arange(len(which)) - np.repeat(np.cumsum(parts) - parts, parts)
        col = col[which] + nth * most
        length = np.minimum(most, length[which] - nth * most)
        row, val = row[which], val[which]
    # Runs that are the same in the row below are one rectangle: sorted by (col, length, key, row), a run joins the one before it when that is the row above.
    order = np.lexsort((row, val, length, col))
    row, col, length, val = row[order], col[order], length[order], val[order]
    joins = np.zeros(len(row), bool)
    joins[1:] = (col[1:] == col[:-1]) & (length[1:] == length[:-1]) & (val[1:] == val[:-1]) & (row[1:] == row[:-1] + 1)
    first = np.flatnonzero(~joins)
    tall = np.diff(np.concatenate([first, [len(row)]]))
    r0, c0, w, v = row[first], col[first], length[first], val[first]
    if (tall > most).any():
        parts = np.ceil(tall / most).astype(np.int64)
        which = np.repeat(np.arange(len(tall)), parts)
        nth = np.arange(len(which)) - np.repeat(np.cumsum(parts) - parts, parts)
        r0 = r0[which] + nth * most
        tall = np.minimum(most, tall[which] - nth * most)
        c0, w, v = c0[which], w[which], v[which]
    return r0, c0, tall, w, v


def pack(x, z, lu, lw, y0, y1, axis, side, shade, rgb, style, bid):
    """Faces as five words each (page/matte.ts reads them)."""
    n = len(x)
    out = np.zeros((n, 5), np.uint32)
    out[:, 0] = x.astype(np.uint32) | (z.astype(np.uint32) << 11) | (lu.astype(np.uint32) << 22)
    out[:, 1] = np.clip(y0, 0, 65535).astype(np.uint32) | (np.clip(y1, 0, 65535).astype(np.uint32) << 16)
    out[:, 2] = lw.astype(np.uint32) | (np.uint32(axis) << 10) | (np.uint32(side) << 12) | (np.clip(shade, 0, 65535).astype(np.uint32) << 13)
    out[:, 3] = rgb.astype(np.uint32) | (style.astype(np.uint32) << 24)
    out[:, 4] = bid.astype(np.uint32)
    return out


def sunlit(solid, bearing, height):
    """Which cells of a block [z, w, u] see the sun past the block's own cells: a face is in the sun when the cell it looks into does."""
    a = math.radians(bearing - (90 - TURN))
    way = np.array([math.sin(math.radians(height)), math.sin(a) * math.cos(math.radians(height)), math.cos(a) * math.cos(math.radians(height))])
    nz, nw, nu = solid.shape
    blocked = np.zeros(solid.shape, bool)
    last = (0, 0, 0)
    for k in range(1, int(2 * math.hypot(nz, nw, nu)) + 2):
        dz, dw, du = (int(v) for v in np.round(way * k * 0.5))
        if (dz, dw, du) == last:
            continue
        last = (dz, dw, du)
        if dz >= nz or abs(dw) >= nw or abs(du) >= nu:
            break
        # The cell (z, w, u) is shaded by a solid cell at (z + dz, w + dw, u + du).
        to = (slice(0, nz - dz), slice(max(0, -dw), nw - max(0, dw)), slice(max(0, -du), nu - max(0, du)))
        frm = (slice(dz, nz), slice(max(0, dw), nw - max(0, -dw)), slice(max(0, du), nu - max(0, -du)))
        blocked[to] |= solid[frm]
    return ~blocked


def faces(vox, paint, foot, bid, light):
    """The outside faces of a block of cells. vox[z, w, u]: what each cell is made of (0 air); paint[m]: that
    stuff's colours, its tops' and its walls' by the way they look (five, as fitcolours.py has them: up, then the
    page's ways 2 to 5), and its style; foot: how high the lowest cells stand, in tenths of a metre; light: `sunlit`."""
    nz, nw, nu = vox.shape
    solid = vox > 0
    around = np.pad(solid, 1)
    lit = np.pad(light, 1, constant_values=True)
    colour = np.array([p[0] for p in paint], np.int64)
    style = np.array([p[1] for p in paint], np.int64)
    out = []
    ones = lambda v: np.ones(len(v), np.int64)

    def add(key, place):
        if (key >= 0).any():
            r0, c0, tall, wide, v = rects(key)
            x, z, lu, lw, y0, y1, axis, side, way = place(r0, c0, tall, wide)
            m = v >> 1
            out.append(pack(x, z, lu, lw, y0, y1, axis, side, np.where(v & 1, 0, 65535), colour[m, way], style[m] if way else 0 * m, bid * ones(v)))

    for z in range(nz):
        # Tops, and what looks down (never in the sun).
        show = solid[z] & ~around[z + 2, 1:-1, 1:-1]
        add(np.where(show, vox[z].astype(np.int64) * 2 + lit[z + 2, 1:-1, 1:-1], -1), lambda r0, c0, tall, wide: (c0, r0, wide, tall, foot + z + 1 + 0 * r0, foot + z + 1 + 0 * r0, 0, 1, 0))
        show = solid[z] & ~around[z, 1:-1, 1:-1]
        add(np.where(show, vox[z].astype(np.int64) * 2, -1), lambda r0, c0, tall, wide: (c0, r0, wide, tall, foot + z + 0 * r0, foot + z + 0 * r0, 0, 1, 0))
    for side in (0, 1):
        for x in range(nu):
            # Walls that look along u: merged over (z, w).
            show = solid[:, :, x] & ~around[1:-1, 1:-1, x + 2 * side]
            add(np.where(show, vox[:, :, x].astype(np.int64) * 2 + lit[1:-1, 1:-1, x + 2 * side], -1), lambda r0, c0, tall, wide: (x + 0 * r0, c0, ones(r0), wide, foot + r0, foot + r0 + tall, 1, side, 1 + side))
        for w in range(nw):
            show = solid[:, w, :] & ~around[1:-1, w + 2 * side, 1:-1]
            add(np.where(show, vox[:, w, :].astype(np.int64) * 2 + lit[1:-1, w + 2 * side, 1:-1], -1), lambda r0, c0, tall, wide: (c0, w + 0 * r0, wide, ones(r0), foot + r0, foot + r0 + tall, 2, side, 3 + side))
    return np.concatenate(out) if out else np.zeros((0, 5), np.uint32)
