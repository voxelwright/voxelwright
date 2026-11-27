"""Bakes the place's far model (#423): everything the photograph looks over, as the outside faces of columns of
cells, in blocks the page draws over the marched picture (page/matte.ts). A column is a cell of the lidar's
surface; its faces are its top and the walls it shows where a neighbour is lower. Faces that lie in one plane and
are alike are merged into rectangles, so a flat roof is one face and a wall is a few.

Layers, each on its own grid laid out with the streets (place.py `turned`):
  near    what stands (buildings, trees) within 700 m of the eye, cells of 25 cm
  far     the same out to 3.3 km, cells of 50 cm
  ground  the bare ground under both, cells of 1 m near and 2 m far: streets are seen only in slivers
  land    the shore and hills past the lidar (land.py), cells of 40 m

Each face carries its colour, the building it belongs to and how high the shadow stands on it at the photograph's
minute (sun.py), worked out here over the whole surface: the engine's own shadow maps do not reach this far.

What a column cannot say (a cornice with air under it, a cross) is built as a solid in cells of 10 cm (church.py,
solid.py), and the lidar's columns are cut off under it.

    python matte.py [--out dir]      writes block files and index.json (the page reads them from /place/ina/)
"""
import json, math, os, struct, sys, time
import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import church
import looks
import sun as sunny
from place import DATA, E0, EYE, LANE, N0, SEA, TURN, WEDGE, turned
from solid import pack, rects

HANDOVER = 700.0
BLOCK = 1024  # cells a block is across, at most
VERSION = 1


def filled(top, ground):
    """The surface with no holes: a cell no return fell in stands as its highest neighbour that had one, else as the ground; strays taken off."""
    seen = top > -1e8
    t = top.copy()
    for _ in range(3):
        p = np.pad(np.where(seen, t, -1e9), 1, constant_values=-1e9)
        best = np.max(np.stack([p[i:i + t.shape[0], j:j + t.shape[1]] for i in range(3) for j in range(3)]), 0)
        take = ~seen & (best > -1e8)
        t[take], seen = best[take], seen | take
    t = np.where(seen, t, ground)
    p = np.pad(t, 1, mode='edge')
    around = np.max(np.stack([p[i:i + t.shape[0], j:j + t.shape[1]] for i in range(3) for j in range(3) if (i, j) != (1, 1)]), axis=0)
    return np.where(t > around + 3.0, around, t), seen


def shadow(h, cell, bearing, height):
    """How high the shadow stands over every cell: the highest of what stands towards the sun, less the fall of its light on the way. By doubling: each pass looks twice as far."""
    # The way to the sun in the turned frame's (u, w).
    a = math.radians(bearing - (90 - TURN))
    du, dw = math.cos(a), math.sin(a)
    fall = math.tan(math.radians(height))
    s = h.astype(np.float32).copy()
    step = cell
    reach = float(np.percentile(h, 99.99) - h.min()) / fall + 10
    while step < reach:
        moved = ndimage.shift(s, (-dw * step / cell, -du * step / cell), order=1, mode='nearest', prefilter=False)
        s = np.maximum(s, moved - step * fall)
        step *= 2
    return s


def faces(h, inside, colour, wall_colour, wall_style, bid, shade, floor, yq, owned=None):
    """The faces of the columns `inside` of one block. h: heights in units of `yq` tenths of a metre (whole numbers);
    colour: each top's (24 bits); wall_colour: each column's walls'; shade: the shadow's height in tenths of a metre;
    floor: how low a wall goes where the neighbour is not `inside` (the ground there), in h's units.
    The margin supplies neighbouring heights. Only owned cells may contribute to a merged rectangle."""
    out = []
    nr, nc = h.shape
    lit = (shade <= np.round(h * yq) + 1).astype(np.int64)
    # Tops: alike in height, colour, building and whether the sun reaches them.
    emit = inside if owned is None else inside & owned
    key = np.where(emit, (h.astype(np.int64) << 44) | (colour.astype(np.int64) << 20) | ((bid.astype(np.int64) & 0x7ffff) << 1) | lit, -1)
    r0, c0, tall, wide, v = rects(key)
    hh = np.round((v >> 44) * yq).astype(np.int64)
    out.append(pack(c0, r0, wide, tall, hh, hh, 0, 1, np.where(v & 1, 0, 65535), (v >> 20) & 0xffffff, np.zeros(len(v), np.int64), (v >> 1) & 0x7ffff))
    # Walls: on each side where the neighbour is lower. dr, dc: where the neighbour is; axis and side as the page has them.
    for dr, dc, axis, side in ((0, 1, 1, 1), (0, -1, 1, 0), (1, 0, 2, 1), (-1, 0, 2, 0)):
        low = np.full(h.shape, -1, np.int64)
        other_in = np.zeros(h.shape, bool)
        other_shade = np.full(h.shape, 0, np.int64)
        other_bid = np.full(h.shape, -1, np.int64)
        a = (slice(max(0, -dr), nr - max(0, dr)), slice(max(0, -dc), nc - max(0, dc)))
        b = (slice(max(0, dr), nr - max(0, -dr)), slice(max(0, dc), nc - max(0, -dc)))
        low[a], other_in[a], other_shade[a], other_bid[a] = h[b], inside[b], shade[b], bid[b]
        # Where the neighbour is not of this layer the wall goes down to the ground there.
        bottom = np.where(other_in, low, np.minimum(floor, h))
        edge = (low >= 0)
        wall = emit & edge & (h - bottom >= 1)
        # The shadow on a wall is the shadow over the cell it looks on, said in half metres so that walls still merge.
        sh = np.clip((other_shade + 2) // 5, 0, 4095)
        sh = np.where(sh * 5 <= np.round(bottom * yq), 0, np.where(sh * 5 >= np.round(h * yq), 4095, sh))
        # A step of a metre or less between two cells of one building is a roof's slope in cells, not a wall: it is
        # the roof's colour and has no windows. (A pitched roof was drawn with its building's wall colour and panes.)
        slope = wall & other_in & (other_bid == bid) & (np.round((h - bottom) * yq) <= 10)
        key = np.where(wall, (h.astype(np.int64) << 48) | (bottom.astype(np.int64) << 34) | (sh << 22) | (slope.astype(np.int64) << 21) | (bid.astype(np.int64) & 0x1fffff), -1)
        if axis == 1:
            # Faces that look along u run along w: merge down the columns.
            r0, c0, tall, wide, v = rects(key.T.copy(), most=1023)
            x, z, lu, lw = r0, c0, np.ones(len(v), np.int64), wide
            # rects merged across the other way too (tall): such a face would be a slab, not a wall; split it back.
            if (tall > 1).any():
                rep = tall
                which = np.repeat(np.arange(len(v)), rep)
                nth = np.arange(len(which)) - np.repeat(np.cumsum(rep) - rep, rep)
                x, z, lu, lw, v = (x[which] + nth), z[which], lu[which], lw[which], v[which]
        else:
            r0, c0, tall, wide, v = rects(key, most=1023)
            x, z, lu, lw = c0, r0, wide, np.ones(len(v), np.int64)
            if (tall > 1).any():
                rep = tall
                which = np.repeat(np.arange(len(v)), rep)
                nth = np.arange(len(which)) - np.repeat(np.cumsum(rep) - rep, rep)
                x, z, lu, lw, v = x[which], (z[which] + nth), lu[which], lw[which], v[which]
        top, bot, s, b, sloped = np.round((v >> 48) * yq).astype(np.int64), np.round(((v >> 34) & 0x3fff) * yq).astype(np.int64), (v >> 22) & 0xfff, v & 0x1fffff, ((v >> 21) & 1).astype(bool)
        shade_y = np.where(s == 0, 0, np.where(s == 4095, 65535, s * 5))
        # A wall's colour may differ by which way it looks (a list of four, in the page's order of ways: 2 to 5).
        mine = wall_colour[(axis - 1) * 2 + side] if isinstance(wall_colour, (list, tuple)) else wall_colour
        at = (np.clip(z, 0, nr - 1), np.clip(x, 0, nc - 1))
        col = np.where(sloped, colour[at], mine[at])
        out.append(pack(x, z, lu, lw, bot, top, axis, side, shade_y, col, np.where(sloped, 0, wall_style[at]), b))
    return np.concatenate(out)


def rgb24(r, g, b):
    return (np.clip(r, 0, 255).astype(np.int64) << 16) | (np.clip(g, 0, 255).astype(np.int64) << 8) | np.clip(b, 0, 255).astype(np.int64)


def write(out, blocks, layer, h, inside, roof, walls, style, ids, shade, floor, hq, u0, w0, cell, pyramid=None):
    """Writes one layer's faces, a block at a time, and lists the blocks."""
    t = math.radians(TURN)
    rows, cols = np.nonzero(inside)
    if not len(rows):
        return
    for br in range(rows.min() // BLOCK, rows.max() // BLOCK + 1):
        for bc in range(cols.min() // BLOCK, cols.max() // BLOCK + 1):
            # A cell of margin on every side, so that a wall at a block's edge knows its neighbour.
            r0, r1, c0, c1 = br * BLOCK, min((br + 1) * BLOCK, inside.shape[0]), bc * BLOCK, min((bc + 1) * BLOCK, inside.shape[1])
            if not inside[r0:r1, c0:c1].any():
                continue
            ra, rb, ca, cb = max(0, r0 - 1), min(inside.shape[0], r1 + 1), max(0, c0 - 1), min(inside.shape[1], c1 + 1)
            sl = (slice(ra, rb), slice(ca, cb))
            own = np.zeros((rb - ra, cb - ca), bool)
            own[r0 - ra:r1 - ra, c0 - ca:c1 - ca] = True
            f = faces(h[sl], inside[sl], roof[sl], [w[sl] for w in walls] if isinstance(walls, list) else walls[sl], style[sl], ids[sl].astype(np.int64), shade[sl], floor[sl], hq, owned=own)
            if not len(f):
                continue
            if pyramid is not None:
                # Word 2 bit 29 marks the measured skin. Leave the five photo-fitted
                # colours, shadow, window style and footprint ID intact for the Ina view.
                looks.mark_pyramid(f, f[:, 4] == pyramid)
            name = f'{layer}-{br}_{bc}.bin'
            f.astype('<u4').tofile(f'{out}/{name}')
            # The block's low corner (of its margin) in the engine's cells of 10 cm.
            bu, bw = u0 + ca * cell, w0 + ra * cell
            de, ds = bu * math.cos(t) + bw * math.sin(t), -bu * math.sin(t) + bw * math.cos(t)
            hs = np.round(h[sl][inside[sl]] * hq)
            blocks.append({'file': name, 'layer': layer, 'faces': int(len(f)), 'cell': cell * 10, 'uw': [round(bu, 3), round(bw, 3)],
                           'pos': [round((EYE[0] + de - E0) * 10, 3), 0, round((N0 - EYE[1] + ds) * 10, 3)],
                           'size': [int(cb - ca), int(hs.max()) + 1, int(rb - ra)], 'low': int(hs.min())})


CROWNS = 8  # raised when what `crowns` works out changes
DETAILED = float(os.environ.get('CROWNS_DETAILED', 400))  # metres from the eye within which a crown has its ragged top and its gaps
PREPARED = 9  # raised when what `prepared` works out changes: its files are made again


def prepared(grid, bearing, height):
    """One grid's surface made ready, kept in DATA so that a bake with another camera does not work it out again:
    the surface with no holes and its noise taken off, what is leaf, how pale each building's roof is, and how high
    the shadow stands."""
    path = f'{DATA}/prepared-{grid}-{PREPARED}.npz'
    if os.path.exists(path):
        return dict(np.load(path))
    s = np.load(f'{DATA}/surface-{grid}.npz')
    u0, w0, cell = (float(v) for v in s['frame'])
    ground = s['ground']
    top, seen = filled(s['top'], ground)
    ids = np.load(f'{DATA}/ids-{grid}.npy')
    count, multi, bright = s['count'].astype(np.float32), s['multi'].astype(np.float32), s['bright']
    # The lidar's own noise on a flat roof is a few centimetres: taken off, or no two cells of a roof would be
    # alike. A cell keeps its own height where the cells round it are another surface (a step, a parapet).
    for size, near in ((3, 0.2), (5, 0.5)):
        smooth = ndimage.median_filter(top, size=size)
        top = np.where(np.abs(smooth - top) < near, smooth, top)
    # A pulse that met a wall on its way down came back from half way up it: such returns make every cell along a
    # wall's foot a column of its own height, and a wall drawn from them is striped like a bar code. The middle
    # value of the cells round a cell is one side of the wall or the other, never between: taken over a square
    # 1.25 m (near) or 1.5 m (far) across. What is narrower than half that goes: an aerial, a flagpole, a cross.
    top = ndimage.median_filter(top, size=5 if cell < 0.4 else 3)
    # What stood when the lidar was flown (2023) and not when the photograph was taken (July 2021): fixes.json lists
    # each by where it is and how high the roof under it is, and it is cut down to that.
    fixes = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixes.json')
    if os.path.exists(fixes):
        nw, nu = top.shape
        uu, ww = u0 + (np.arange(nu) + 0.5) * cell, w0 + (np.arange(nw) + 0.5) * cell
        for f in json.load(open(fixes))['fixes']:
            if 'box' in f:
                continue
            if 'over' in f:
                # A thing of any shape: the patch of cells over that height that stands at that place (within a
                # metre and a half), cut down to the middle height of what is round it.
                c, r, reach, by = int((f['u'] - u0) / cell), int((f['w'] - w0) / cell), int(60 / cell), int(1.5 / cell)
                if not (reach <= r < nw - reach and reach <= c < nu - reach):
                    continue
                part = (slice(r - reach, r + reach), slice(c - reach, c + reach))
                high = top[part] > f['over']
                patches, _ = ndimage.label(high)
                here = np.unique(patches[reach - by:reach + by + 1, reach - by:reach + by + 1])
                thing = np.isin(patches, here[here > 0])
                round_it = ndimage.binary_dilation(thing, iterations=int(3 / cell)) & ~high
                if thing.any() and round_it.any():
                    top[part] = np.where(thing, np.median(top[part][round_it]), top[part])
                continue
            near = np.hypot(uu[None, :] - f['u'], ww[:, None] - f['w']) < f['r']
            top = np.where(near, np.minimum(top, f['cap']), top)
    over = top - ground
    # The city's outline is a building's foot. Its bays, its cornice and a metre of misfit stand outside it, and
    # those cells had no building: they were drawn pale and without windows, as stripes down a tower's lit side
    # (555 California's). A cell within 3 m of an outline that stands as high as the building's nearest cell does,
    # within 2 m, is that building's. A tree beside a house is another height and stays a tree.
    far, (ri, ci) = ndimage.distance_transform_edt(ids == 0, return_indices=True)
    beside = (ids == 0) & (far * cell <= 3.0) & (over > 3.0) & (np.abs(top - top[ri, ci]) < 2.0)
    ids = np.where(beside, ids[ri, ci], ids)
    del far, ri, ci
    # Beside a glass tower pulses come back from a few metres out in the air: 62 cells stood 145 to 167 m high
    # by a brown tower 1.3 km off, 6 px out into the photograph's sky, with no building outlined under them. In a
    # box that fixes.json names, what stands over 40 m with no outline and covers less than 100 m2 is cut to the
    # ground. (Done everywhere, it took real things off three other towers, whose outlines are smaller than they are.)
    if os.path.exists(fixes):
        within = np.zeros(top.shape, bool)
        for f in json.load(open(fixes))['fixes']:
            if 'box' in f:
                within |= (uu[None, :] >= f['box'][0]) & (uu[None, :] <= f['box'][2]) & (ww[:, None] >= f['box'][1]) & (ww[:, None] <= f['box'][3])
        lone, n = ndimage.label((ids == 0) & (over > 40.0) & within)
        if n:
            small = np.concatenate([[False], ndimage.sum(np.ones(top.shape, np.float32), lone, np.arange(1, n + 1)) * cell * cell < 100.0])
            top = np.where(small[lone], ground, top)
            over = top - ground
        del lone, within
    # Leaves let a pulse through and send it back more than once; so does the edge of a roof. Leaf is where that
    # happens away from any building, on something of a tree's height.
    # A crown's top sends a pulse back once, as a roof does: so a whole thing that stands where no building is
    # outlined is leaf when an eighth of its cells are, not only the cells that are.
    clear = ndimage.distance_transform_edt(ids == 0) * cell > 1.5
    several = (multi / np.maximum(count, 1) > 0.3) & (over > 2.0) & (over < 45.0) & clear
    things, n = ndimage.label((ids == 0) & (over > 2.0) & (over < 45.0))
    share = ndimage.mean(several, things, index=np.arange(n + 1)) if n else np.zeros(1)
    leafy = (np.nan_to_num(share) > 0.125)[things] & (things > 0)
    scale = 255.0 / max(1.0, float(np.percentile(bright[seen], 98)))
    grey = np.full(top.shape, 120.0, np.float32)
    if (ids > 0).any():
        mean = ndimage.mean(bright[ids > 0] * scale, ids[ids > 0], index=np.arange(int(ids.max()) + 1))
        grey = np.where(ids > 0, np.nan_to_num(mean)[ids], grey).astype(np.float32)
    water = ~seen & (ground < 1.6)
    sh = shadow(np.where(water, 0, top), cell, bearing, height)
    out = {'top': top.astype(np.float32), 'seen': seen, 'ground': ground, 'ids': ids, 'leafy': leafy, 'grey': grey, 'water': water, 'shadow': sh.astype(np.float32), 'frame': s['frame']}
    np.savez(path, **out)
    return out


def crowns(g, grid):
    """Trees as crowns on trunks (#450). A column of the lidar's surface says a tree as a solid mass from the ground
    up, and a crown that hangs over a building's outline as part of that building: a block of wall with windows as
    tall as the tree. Here every crown is found (leaf where no building is outlined, and what stands over a
    building's own roof and sends pulses back more than once, as leaves do), and said as what it is: how low it
    hangs at each cell (round underneath, deepest in its middle), what stands under it (the roof it hangs over, or
    the ground), and where its trunks are. Kept in DATA beside the surface it is worked out from."""
    path = f'{DATA}/crowns-{grid}-{PREPARED}-{CROWNS}.npz'
    if os.path.exists(path):
        return dict(np.load(path))
    s = np.load(f'{DATA}/surface-{grid}.npz')
    out = crown_rule(g['top'], g['ground'], g['ids'], g['leafy'], s['multi'], s['count'], float(g['frame'][2]), s['top'])
    print(f"crowns ({grid}): {out['said']}", flush=True)
    del out['said']
    np.savez(path, **out)
    return out


def crown_rule(top, ground, ids, leafy, multi, returns, cell, raw):
    """The rule `crowns` keeps, for any surface (the wedge's here, a square's in sf/far/bake.py): the surface made ready
    (`top`, with its noise taken off), the ground, each cell's building, what is leaf, how many pulses came back from
    each cell more than once and how many in all (`multi`, `returns`), the cell in metres, and the surface as the lidar had it (`raw`).

    Beside where each crown is and how low it hangs, it says a crown's own top and its gaps. The surface made ready
    has had the middle value of each 1.25 m taken, which is right for a roof and makes a crown a smooth dome: a
    crown's top is the lidar's own (`rough`). And a crown is not solid: the big tree of the landing's left foreground
    is as wide in the lidar as in the photograph (14.3 m across the line of sight against 13.9 m, and within a metre
    and a half at every height), but stood as one unbroken green mass, where the photograph's is clumps with dark and
    the houses behind showing between them. So some of a crown's columns are left out (`gap`): clumps about a metre
    across, more of them where more pulses went through the leaves (a thin crown) and towards its rim, none at its trunk."""
    over = top - ground
    # How much of what came back round a cell came back more than once, over a square 1.25 m across.
    share = ndimage.uniform_filter(multi.astype(np.float32) / np.maximum(returns.astype(np.float32), 1), size=max(3, int(round(1.25 / cell)) | 1))
    # A building's own roof: the height three tenths of its cells are under (the middle one is the tree's, where a
    # crown hangs over most of a small house).
    n = int(ids.max())
    level = np.zeros(n + 1, np.float32)
    if n:
        built = np.flatnonzero(ids.ravel() > 0)
        order = built[np.lexsort((top.ravel()[built], ids.ravel()[built]))]
        count = np.bincount(ids.ravel()[built], minlength=n + 1)
        first = np.concatenate([[0], np.cumsum(count)[:-1]])
        has = count > 0
        level[has] = top.ravel()[order[(first + (count * 0.3).astype(np.int64))[has]]]
    # Over a building's outline: a patch that stands 3 m and more over its roof, is leaf by its returns (an upper
    # storey sends its pulses back once but at its edge), is no bigger than a tree and touches a crown that stands
    # where no building is outlined. (A roof garden touches none, and is not cut off its roof.)
    hung = (ids > 0) & (top - level[ids] > 3.0)
    free = leafy & (over > 2.8)
    patches, m = ndimage.label(hung)
    if m:
        index = np.arange(m + 1)
        area = ndimage.sum(hung, patches, index) * cell * cell
        mean = np.nan_to_num(ndimage.mean(share, patches, index))
        touches = ndimage.maximum(ndimage.binary_dilation(free, iterations=2), patches, index) > 0
        # A crown's top is ragged by metres; a roof's plant sends pulses back twice as leaves do, and is flat.
        ragged = np.nan_to_num(ndimage.standard_deviation(top, patches, index))
        # (All of a patch under 45 m: the rim of a taller storey is not a patch of its own.)
        keep = (area >= 1.0) & (area < 400.0) & (mean > 0.4) & (ragged > 1.2) & touches & (ndimage.maximum(over, patches, index) < 45.0)
        keep[0] = False
        hung &= keep[patches]
    crown = (leafy & (over > 2.8)) | hung
    base = np.where(hung, level[ids], ground).astype(np.float32)
    # How tall the tree is at a cell: the highest of its crown within 3 m. Its crown is three fifths of that deep
    # (1.6 m at least), and thins to its rim: how far a cell is inside the crown says how low it hangs there.
    # A tall narrow tree (a poplar, a cypress: the landing's big tree is 31 m tall and 13 m across) is in leaf far
    # further down and as wide low as high: by how slender each crown is (its height for its width, as wide as a
    # round of its area), it is up to nine tenths deep, and at its full depth from 80 cm inside its rim, not 2.5 m.
    high = ndimage.maximum_filter(np.where(crown, top, -1e9), size=int(round(6 / cell)) | 1)
    each, m = ndimage.label(crown)
    slender = np.ones(m + 1, np.float32)
    if m:
        index = np.arange(1, m + 1)
        slender[1:] = ndimage.maximum(np.where(crown, top - base, 0), each, index) / np.maximum(np.sqrt(ndimage.sum(crown, each, index) * cell * cell * 4 / np.pi), 1.0)
    slender = np.clip(slender[each] - 1.2, 0.0, 1.2)
    del each
    deep = np.clip((high - ground) * (0.62 + 0.25 * slender), 1.6, 28.0)
    inside = ndimage.distance_transform_edt(crown) * cell
    under = np.maximum(high - deep * np.sqrt(np.clip(inside / (2.5 - 1.4 * slender), 0.05, 1.0)), base + 0.5)
    under = np.minimum(under, top - 0.75).astype(np.float32)
    # A trunk under each top of a crown that stands on the ground: half a metre square, up into the crown.
    smooth = ndimage.uniform_filter(np.where(crown, top, ground), size=int(round(2 / cell)) | 1)
    peak = crown & ~hung & (over > 4.0) & (inside > 1.0) & (smooth >= ndimage.maximum_filter(smooth, size=int(round(7 / cell)) | 1) - 1e-4)
    marks, k = ndimage.label(peak)
    trunk = np.zeros(top.shape, bool)
    if k:
        at = np.round(np.array(ndimage.center_of_mass(peak, marks, np.arange(1, k + 1)))).astype(np.int64)
        trunk[at[:, 0], at[:, 1]] = True
        trunk = ndimage.binary_dilation(trunk, iterations=max(1, int(round(0.25 / cell)))) & crown & ~hung
    # Its own top: the lidar's, where that is a crown's (within 6 m of the smoothed one, and over where it hangs to).
    rough = np.where(crown & np.isfinite(raw) & (np.abs(raw - top) < 6.0), np.maximum(raw, under + 0.75), top).astype(np.float32)
    # Its gaps: of a grain a metre across (the same wherever the bake is run), the lowest share in a crown: a
    # twentieth of a dense crown's columns, an eighth more of a thin one's, a fifth more again at its rim.
    grain = ndimage.gaussian_filter(np.random.default_rng(450).random(top.shape, dtype=np.float32), sigma=max(0.6, 0.45 / cell))
    rank = np.zeros(top.shape, np.float32)
    values = grain[crown]
    if values.size:
        rank[crown] = np.argsort(np.argsort(values)).astype(np.float32) / max(1, values.size - 1)
    thin = np.clip((share - 0.5) / 0.4, 0.0, 1.0)
    rim = np.clip(1.0 - inside / 2.0, 0.0, 1.0)
    by_trunk = ndimage.binary_dilation(trunk, iterations=max(1, int(round(1.0 / cell))))
    gap = crown & ~by_trunk & (rank < 0.05 + 0.12 * thin + 0.2 * rim)
    return {'crown': crown, 'hung': hung, 'base': base, 'under': under, 'trunk': trunk, 'rough': rough, 'gap': gap, 'slender': np.clip(slender, 0.0, 1.0).astype(np.float32),
            'said': f'{int(crown.sum() * cell * cell)} m2 of crown, {int(hung.sum() * cell * cell)} m2 of it over outlines, {int(gap.sum() * cell * cell)} m2 of gaps, {k} trunks'}


# A far crown's one green (and a square's, sf/far/bake.py): the middle of `bark_and_leaf`'s three.
LEAF_TOP = lambda shape: rgb24(np.full(shape, 72), np.full(shape, 90), np.full(shape, 44))
LEAF_SIDE = lambda shape: rgb24(np.full(shape, 54), np.full(shape, 68), np.full(shape, 33))


def bark_and_leaf(shape, cell):
    """Leaves in three greens, in patches a metre and a half across (one flat green is a blob from any distance), and bark.
    The greens are the photograph's big tree's (its mean 43, 55, 27: an olive, red three quarters of green), not a
    lawn's: with red under half of green the crowns were the brightest and most coloured things in the landing."""
    rows, cols = np.indices(shape)
    patch = ((rows * cell / 1.5).astype(np.int64) * 73856093) ^ ((cols * cell / 1.5).astype(np.int64) * 19349663)
    pick = (patch >> 3) % 3
    tops = np.choose(pick, [rgb24(*(np.full(shape, v) for v in c)) for c in ((72, 90, 44), (84, 100, 50), (60, 78, 40))])
    sides = np.choose(pick, [rgb24(*(np.full(shape, v) for v in c)) for c in ((54, 68, 33), (64, 78, 38), (45, 58, 30))])
    return tops, sides, rgb24(np.full(shape, 84), np.full(shape, 66), np.full(shape, 48))


def main():
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    # The whole bake, every face: far more than a page should be sent. cull.mjs keeps what can be seen, as `ina`.
    # `--plain` bakes it with colours by rule alone (looks.py), as `ina-plain-all`.
    plain = '--plain' in sys.argv
    out = arg('--out', f"{LANE}/home/.village/engine/place/{'ina-plain-all' if plain else 'ina-all'}")
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        os.remove(f'{out}/{old}')
    cam = json.load(open(f'{DATA}/camera.json'))['camera']
    eu, ew = (float(v) for v in turned(cam['e'], cam['n']))
    bearing, height = sunny.sun()
    began = time.time()
    table = json.load(open(f'{DATA}/buildings.json'))
    # Each building's colours are the ones fitted to the photograph (fitcolours.py), where that has been run: the
    # owner's word of November 17 is that a building's colours may be taken from it. The index says where they are from.
    photo = json.load(open(f'{DATA}/colours-photo.json'))['colours'] if not plain and os.path.exists(f'{DATA}/colours-photo.json') else None
    pyramid = next((b['id'] for b in table if b.get('name') == 'Transamerica Pyramid'), None)
    given = {}
    blocks = []
    for layer, grid, cell_out, lo, hi, standing in (('near', 'fine', 0.25, 3.0, HANDOVER, True), ('far', 'far', 0.5, HANDOVER, WEDGE['far'], True), ('ground-near', 'fine', 1.0, 3.0, HANDOVER, False), ('ground-far', 'far', 2.0, HANDOVER, WEDGE['far'], False)):
        g = prepared(grid, bearing, height)
        u0, w0, cell = (float(v) for v in g['frame'])
        top, ground, ids, leafy, sh = g['top'], g['ground'], g['ids'], g['leafy'], g['shadow']
        nw, nu = top.shape
        uu, ww = u0 + (np.arange(nu) + 0.5) * cell, w0 + (np.arange(nw) + 0.5) * cell
        du, dw = uu[None, :] - eu, ww[:, None] - ew
        dist = np.hypot(du, dw)
        brg = (90 - TURN + np.degrees(np.arctan2(dw, du))) % 360
        domain = (dist >= lo) & (dist < hi) & (brg > WEDGE['from']) & (brg < WEDGE['to'])
        # Water gives the lidar nothing back: no return, and ground at the bay's level. The bridge is a tent of returns over it, and has a rule of its own.
        domain &= ~(g['water'] | ((dist > 2300) & (brg < 108)))
        # Where a thing is built as a solid (church.py), the lidar's columns are cut off at its foot.
        for a, b, c, d, cap in church.boxes():
            top = np.where((uu[None, :] >= a) & (uu[None, :] < b) & (ww[:, None] >= c) & (ww[:, None] < d), np.minimum(top, cap), top)
        # Trees are crowns on trunks (`crowns`): under a crown stands what it hangs over, and its trunk.
        tree = crowns(g, grid) if standing else None
        if standing:
            crown, trunk = tree['crown'], tree['trunk']
            # (A crown's own top is the lidar's, ragged, and some of its columns are gaps: within DETAILED metres of the
            # eye, where a tree is tens of pixels across. Everywhere in the near layer they were 110,000 faces more than
            # smooth whole crowns, and in the far layer half a million: with those the park's frame at scale 0.75 went
            # past 60 a second's time by night, and a second page on the same GPU never got its turn.)
            detailed = (np.hypot(uu[None, :] - eu, ww[:, None] - ew) < DETAILED) if cell_out < 0.5 else np.zeros(top.shape, bool)
            top_all = np.where(crown & detailed, tree['rough'], top)
            top = np.where(crown, np.where(trunk, np.maximum(tree['under'] + 1.0, tree['base']), tree['base']), top)
            leafy = leafy & ~crown
        over = top - ground
        # The park's own trees stand round the eye in the lidar (flown two summers after the photograph) as solid
        # columns from the ground up, and a column is no tree to look out from under: within 40 m of the eye only
        # buildings stand. The photograph has none of them in its frame but a few crowns at its bottom corner.
        stands = (ids > 0) | ((over > 2.0) & (dist > 40.0))
        # Where a landmark's rule stands in the place (heroes.mjs), the lidar's own columns of it are left out.
        if os.path.exists(f'{DATA}/hero-boxes.json'):
            for box in json.load(open(f'{DATA}/hero-boxes.json')):
                c = np.array(box['corners'])
                # The corners are in the engine's cells of 10 cm (x east, z south of the frame's corner): into this grid's (u, w).
                bu, bw = turned(c[:, 0] / 10 + E0, N0 - c[:, 1] / 10)
                pu, pw = uu[None, :], ww[:, None]
                within = np.ones(top.shape, bool)
                for k in range(4):
                    ax, aw, bx, bw2 = bu[k], bw[k], bu[(k + 1) % 4], bw[(k + 1) % 4]
                    within &= ((bx - ax) * (pw - aw) - (bw2 - aw) * (pu - ax)) * np.sign((bu[2] - bu[0]) * (bw[1] - bw[0]) - (bw[2] - bw[0]) * (bu[1] - bu[0])) <= 0
                stands &= ~(within & (over > 12.0))
        if standing:
            inside = domain & stands
            # Heights in cells as tall as they are wide: a quarter of a metre near, half a metre far.
            hq = 2.5 if cell_out < 0.5 else 5
            h = np.round((top - SEA) * 10 / hq).astype(np.int64)
            floor = np.round((ground - SEA) * 10 / hq).astype(np.int64)
            # Colours by rule, which the fitted ones start from and stand in for where a building was never seen: a
            # building's roof as pale as the lidar's own light came back from it (one grey a building, of sixteen),
            # leaves green, walls a pale plaster.
            lum = np.round(np.clip(55 + g['grey'] * 0.75, 60, 230) / 12) * 12
            roof = rgb24(lum, lum, lum * 0.98)
            roof_green = rgb24(np.full(top.shape, 62), np.full(top.shape, 98), np.full(top.shape, 46))
            roof = np.where(leafy, roof_green, roof)
            # A wall's colour and how its windows go are its building's (looks.py): by its height and its number where
            # nothing is known of it, by name where something is.
            wall_of, style_of = looks.walls(table, int(ids.max()))
            green = rgb24(np.full(top.shape, 46), np.full(top.shape, 74), np.full(top.shape, 36))
            leaf_top, leaf_side, bark = bark_and_leaf(top.shape, cell)
            roof = np.where(trunk, bark, roof)
            walls = np.where(leafy, green, np.where(trunk, bark, wall_of[ids]))
            style = np.where(leafy | trunk, 0, style_of[ids])
            # What colours were given, by building: its roof and its walls (fitcolours.py starts from these).
            seen_ids = np.unique(ids[inside & (ids > 0)])
            first = {int(i): n for n, i in zip(*np.unique(ids, return_index=True)[::-1])}
            for i in seen_ids:
                at = np.unravel_index(first[int(i)], ids.shape)
                given[int(i)] = [int(roof[at])] + [int(wall_of[i])] * 4
            if photo:
                # The colours fitted to the photograph (fitcolours.py), by building and by which way a face looks.
                tops = np.zeros(int(ids.max()) + 1, np.int64)
                sides = [wall_of.copy() for _ in range(4)]
                has = np.zeros(int(ids.max()) + 1, bool)
                # A building a crown hangs over was seen through its leaves: a colour fitted there that is leaf's own
                # (green over red and blue) is the tree's, and the building keeps its colour by rule.
                hung_ids = np.zeros(int(ids.max()) + 1, bool)
                hung_ids[np.unique(ids[tree['hung']])] = True
                leaf_like = lambda v: ((v >> 8) & 255) > 1.12 * max((v >> 16) & 255, v & 255)
                for i, c in photo.items():
                    i = int(i)
                    if i <= ids.max():
                        if not (hung_ids[i] and leaf_like(c[0])):
                            tops[i], has[i] = c[0], True
                        for k in range(4):
                            if not (hung_ids[i] and leaf_like(c[1 + k])):
                                sides[k][i] = c[1 + k]
                roof = np.where(has[ids] & ~leafy & ~trunk, tops[ids], roof)
                walls = [np.where(leafy, green, np.where(trunk, bark, side[ids])) for side in sides]
            shade = np.round((sh - SEA) * 10).astype(np.int64)
            step = 1
        else:
            # The bare ground, coarser: every `step` cells of the grid one cell, at the ground's own height.
            step = int(round(cell_out / cell))
            sub = (slice(step // 2, None, step), slice(step // 2, None, step))
            inside = domain[sub]
            hq = 5 if cell_out <= 1.0 else 10
            h = np.round((ground[sub] - SEA) * 10 / hq).astype(np.int64)
            floor = h
            grey = np.full(h.shape, 96)
            roof = rgb24(grey, grey, grey + 2)
            walls = roof
            style = np.zeros(h.shape, np.int64)
            shade = np.round((sh[sub] - SEA) * 10).astype(np.int64)
            ids = np.zeros(h.shape, np.int32)
        write(out, blocks, layer, np.maximum(h, 0), inside, roof, walls, style, ids, np.maximum(shade, 0), np.maximum(floor, 0), hq, u0, w0, cell * step, pyramid if standing else None)
        if standing:
            # The crowns, over what stands under them: three slabs, each further inside the crown and hanging lower,
            # since a column's faces are its top and its walls and a crown is round underneath. The first is the
            # crown's own top down a quarter of its depth; the next hang from it, to half and to all of it.
            # (A gap is in the crown's top slab: at its rim, where that is all there is, the gap is seen through; further
            # in it is a dark slot down to the slab under it, as between two clumps of leaf.)
            leaf = crown & ~(tree['gap'] & detailed)
            held = domain & crown & (dist > 40.0)
            reach = ndimage.distance_transform_edt(crown) * cell
            depth = top_all - tree['under']
            upper = np.round((top_all - SEA) * 10 / hq).astype(np.int64)
            nothing = np.zeros(top.shape, np.int32)
            # Past the handover a crown is a few pixels: one slab, its whole depth, in one green (so its tops merge).
            near = cell_out < 0.5
            if not near:
                leaf_top, leaf_side = LEAF_TOP(top.shape), LEAF_SIDE(top.shape)
            for nth, (share_, far_in) in enumerate(((0.3, 0.0), (0.65, 0.8), (1.0, 1.8)) if near else ((1.0, 0.0),)):
                lower = np.minimum(np.round((top_all - depth * share_ - SEA) * 10 / hq).astype(np.int64), upper - 1)
                # (A slender crown's lower slabs begin nearer its rim, by up to half: it is as wide low as high.)
                part = held & (reach >= far_in * (1.0 - 0.45 * tree['slender'] * detailed)) & (leaf if nth == 0 else True)
                # (What hangs lower is in the crown's own shade: each slab a little darker than the one over it.)
                dim = lambda c, by=1 - 0.2 * nth: rgb24(((c >> 16) & 255) * by, ((c >> 8) & 255) * by, (c & 255) * by)
                write(out, blocks, f'{layer}-crown{nth}', np.maximum(upper, 0), part, leaf_top, dim(leaf_side), np.zeros(top.shape, np.int64), nothing, np.maximum(shade, 0), np.maximum(lower, 0), hq, u0, w0, cell)
                upper = lower
        print(f'{layer}: {sum(b["faces"] for b in blocks if b["layer"] == layer)} faces in {sum(1 for b in blocks if b["layer"] == layer)} blocks, {time.time() - began:.0f} s', flush=True)
    # The church's towers, as solids in cells of 10 cm.
    named = {b.get('name'): b['id'] for b in table}
    i = named.get('Our Lady of Guadalupe Church')
    if i:
        for said in church.build(out, blocks, photo.get(str(i)) if photo else None, i, (bearing, height)):
            print(json.dumps(said), flush=True)
    # The land past the lidar (land.py): the East Bay's shore and hills, 40 m a cell, from where the lidar's wedge ends.
    if os.path.exists(f'{DATA}/land.npz'):
        g = np.load(f'{DATA}/land.npz')
        u0, w0, cell = (float(v) for v in g['frame'])
        top = g['top']
        nw, nu = top.shape
        uu, ww = u0 + (np.arange(nu) + 0.5) * cell, w0 + (np.arange(nw) + 0.5) * cell
        dist = np.hypot(uu[None, :] - eu, ww[:, None] - ew)
        # The world is flat and the Earth is not: 15 km off the ground has fallen 15 m under a level line, which is
        # two pixels of the photograph. Far land is set down by that much, as the camera's fit counts it (camera.py BEND).
        from camera import BEND
        low = top - BEND * dist * dist
        inside = (dist >= WEDGE['far']) & (top > 1.0) & (low > 0.5)
        hq = 20
        h = np.round((low - SEA) * 10 / hq).astype(np.int64)
        grey = np.full(h.shape, 1)
        colour = rgb24(grey * 124, grey * 122, grey * 106)
        write(out, blocks, 'land', np.maximum(h, 0), inside, colour, colour, np.zeros(h.shape, np.int64), np.zeros(h.shape, np.int32), np.zeros(h.shape, np.int64), np.zeros(h.shape, np.int64), hq, u0, w0, cell)
        print(f'land: {sum(b["faces"] for b in blocks if b["layer"] == "land")} faces, {time.time() - began:.0f} s', flush=True)
    total = sum(b['faces'] for b in blocks)
    index = {'village': 'matte', 'version': VERSION, 'name': 'Ina Coolbrith Park', 'turn': TURN, 'faces': total, 'blocks': blocks,
             'sun': {'bearing': round(bearing, 3), 'height': round(height, 3), 'vector': [round(v, 5) for v in sunny.vector(bearing, height)], 'when': '2021-07-15T15:37:30-07:00'},
             'camera': json.load(open(f'{DATA}/camera.json')).get('engine'),
             **{k: v for k, v in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'light.json'))).items() if k in ('light', 'sky')},
             'styles': looks.STYLES,
             'credit': 'U.S. Geological Survey 3DEP; City and County of San Francisco (DataSF); terrain: Mapterhorn'}
    if photo:
        index['colours'] = {'after': 'View of San Francisco from Ina Coolbrith Park-01445.jpg, Frank Schulenburg, CC BY-SA 4.0, https://commons.wikimedia.org/wiki/File:View_of_San_Francisco_from_Ina_Coolbrith_Park-01445.jpg', 'what': 'each building\'s roof and wall colours (five a building) were fitted to the photograph'}
        index['credit'] += '; colours after a photograph by Frank Schulenburg (CC BY-SA 4.0)'
    json.dump(given, open(f'{DATA}/colours-default.json', 'w'))
    json.dump(index, open(f'{out}/index.json', 'w'))
    print(f'{total} faces, {total * 20 / 1e6:.1f} MB, {len(blocks)} blocks, {time.time() - began:.0f} s')


if __name__ == '__main__':
    main()
