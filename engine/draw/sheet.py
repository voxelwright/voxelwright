"""A five-view sheet (left side, right side, front, rear, top: parallel views of one thing) carved and painted into
cells (#245). Taken from the fast-voxels bench's sheet5.py (November 15) as the engine's own, with only what the
engine uses: no depth, no rounding, no second sheet of classes.

The shape is the biggest solid all five outlines allow; every outside cell is painted from the view that faces it
most. The sheet is read by what it shows, not by where things were asked to be: an image model keeps to a layout
only roughly. Axes of what `build` returns: x across, y up, z along the side views, z 0 at the left edge of the
first side view as drawn (which end that is, front or rear, is the drawer's: `front_low` says what the view from
above says of it)."""
import time
from itertools import combinations
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

VIEWS = ('left', 'right', 'front', 'rear', 'top')
UNDER = np.array([26, 26, 28], np.uint8)


def thing(sheet, white=232):
    """Which pixels of the sheet are the thing: white that reaches the border is the background."""
    rgba = np.asarray(sheet.convert('RGBA'))
    rgb, a = rgba[..., :3], rgba[..., 3]
    if (a < 128).mean() > 0.05: return rgb.astype(np.float32), a >= 128
    pale = (rgb.min(-1) >= white) & (rgb.max(-1).astype(int) - rgb.min(-1) < 14)
    lab, n = ndi.label(pale)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    return rgb.astype(np.float32), ndi.binary_opening(~np.isin(lab, edge[edge > 0]), iterations=1)


def same(a, b, side=64):
    """How alike two outlines are once both are stretched to one square: 1 is the same."""
    A = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((side, side), Image.BOX)) > 127
    B = np.asarray(Image.fromarray((b * 255).astype(np.uint8)).resize((side, side), Image.BOX)) > 127
    ra, rb = a.shape[1] / a.shape[0], b.shape[1] / b.shape[0]
    return (A & B).sum() / max(1, (A | B).sum()) * min(ra / rb, rb / ra) ** 2


def cut(sheet, least=0.003):
    """The five views, named. Two pairs of views show one outline mirrored (left and right; front and rear): the
    view left over is the one from above. The pair met first in reading order is the sides, as asked for."""
    rgb, fg = thing(sheet)
    lab, n = ndi.label(ndi.binary_dilation(fg, iterations=max(2, round(0.004 * max(fg.shape)))))
    area = ndi.sum(fg, lab, np.arange(1, n + 1))
    # The drawer now and then draws a sixth or seventh view (a view twice, or one in perspective): the five kept are
    # those that pair up best, of the seven biggest.
    big = [i + 1 for i in np.argsort(-area) if area[i] > least * fg.size][:7]
    if len(big) < 5: raise ValueError(f'{len(big)} views found on the sheet, five wanted')
    parts = []
    for i in big:
        m = fg & (lab == i); ys, xs = np.where(m)
        sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
        parts.append(dict(rgb=rgb[sl], m=m[sl], cy=ys.mean(), cx=xs.mean()))
    alike = {}
    def pair(a, b):
        if (a, b) not in alike: alike[(a, b)] = max(same(parts[a]['m'], parts[b]['m'][:, ::-1]), same(parts[a]['m'], parts[b]['m']))
        return alike[(a, b)]
    best = None
    for five in combinations(range(len(parts)), 5):
        for t in five:
            o = [i for i in five if i != t]
            for a, b, c, d in ((o[0], o[1], o[2], o[3]), (o[0], o[2], o[1], o[3]), (o[0], o[3], o[1], o[2])):
                s = pair(a, b) + pair(c, d) + 0.15 * (parts[t]['cy'] > max(parts[k]['cy'] for k in o))
                if best is None or s > best[0]: best = (s, t, (a, b), (c, d))
    _, t, p, q = best
    first = lambda pair: (round(np.mean([parts[k]['cy'] for k in pair]) / (0.12 * fg.shape[0])), np.mean([parts[k]['cx'] for k in pair]))
    if first(q) < first(p): p, q = q, p
    p = sorted(p, key=lambda k: parts[k]['cx']); q = sorted(q, key=lambda k: parts[k]['cx'])
    out = {name: (parts[k]['rgb'], parts[k]['m']) for name, k in zip(VIEWS, [p[0], p[1], q[0], q[1], t])}
    return out, dict(pairs_alike=round(float(best[0]), 2))


def trim(rgb, m, share=0.12):
    """Cut to the rows the thing truly fills (an aerial must not set its height)."""
    wide = m.sum(1); keep = np.where(wide >= share * wide.max())[0]
    return rgb[keep[0]:keep[-1] + 1], m[keep[0]:keep[-1] + 1]


def to_cells(rgb, m, across, up):
    """A view shrunk to cells: colour (up, across, 3) and how full each cell is, row 0 at the bottom."""
    full = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize((across, up), Image.BOX), np.float32) / 255
    c = np.stack([np.asarray(Image.fromarray((rgb[..., k] * m).astype(np.uint8)).resize((across, up), Image.BOX), np.float32) for k in range(3)], -1)
    return (c / np.maximum(full[..., None], 1e-3))[::-1], full[::-1]


def carve(S, E, T):
    """[x, y, z] from the side outline [z, y], the end outline [x, y] and the outline from above [z, x]."""
    return (S.T[None] > 0.5) & (E[:, :, None] > 0.5) & (T.T[:, None, :] > 0.5)


def build(sheet, n_long=188, shell=3):
    """n_long: cells along the thing's largest side. Resolves to (idx [n, 3] of x, y, z; colours [n, 3]; info)."""
    t0 = time.perf_counter(); ms = {}
    v, read = cut(sheet); ms['cut the views'] = (time.perf_counter() - t0) * 1e3; t = time.perf_counter()
    for k in ('left', 'right', 'front', 'rear'): v[k] = trim(*v[k])
    # is the right view the left one mirrored, as it should be, or was it drawn the same way round?
    flip_r = same(v['left'][1], v['right'][1][:, ::-1]) >= same(v['left'][1], v['right'][1]) - 0.02
    flip_e = same(v['front'][1], v['rear'][1][:, ::-1]) >= same(v['front'][1], v['rear'][1]) - 0.02
    Lp = np.mean([v[k][1].shape[1] for k in ('left', 'right')]); Hp = np.mean([v[k][1].shape[0] for k in ('left', 'right')])
    wf = np.mean([v[k][1].shape[1] / v[k][1].shape[0] for k in ('front', 'rear')])      # width over height, from the ends
    th, tw = v['top'][1].shape
    turned = abs(np.log((tw / th) / (Lp / (wf * Hp)))) > abs(np.log((th / tw) / (Lp / (wf * Hp))))   # from above, drawn a quarter turn round
    if turned: v['top'] = (np.rot90(v['top'][0]), np.rot90(v['top'][1])); th, tw = tw, th
    wt = th / tw                                                                        # width over length, from above
    rel = np.array([wf * Hp / Lp if abs(np.log(wt / (wf * Hp / Lp))) > 0.25 else 0.5 * (wf * Hp / Lp + wt), Hp / Lp, 1.0])   # W, H, L over L
    L = max(2, round(n_long / rel.max())); W = max(2, round(L * rel[0])); H = max(2, round(L * rel[1]))
    side = {k: to_cells(*v[k], L, H) for k in ('left', 'right')}
    end = {k: to_cells(*v[k], W, H) for k in ('front', 'rear')}
    S = {'left': (side['left'][0].transpose(1, 0, 2), side['left'][1].T)}                 # [z, y]
    r = side['right'] if not flip_r else (side['right'][0][:, ::-1], side['right'][1][:, ::-1])
    S['right'] = (r[0].transpose(1, 0, 2), r[1].T)
    s = 0.5 * (S['left'][1] + S['right'][1])
    topc, topm = to_cells(*v['top'], L, W)
    ways = [(topc.transpose(1, 0, 2)[a][:, b], topm.T[a][:, b]) for a in (slice(None), slice(None, None, -1)) for b in (slice(None), slice(None, None, -1))]

    def ends(low, high):
        """The ends, by where they are: E['front'] at low z (as seen from there), E['rear'] at high z; `low` and `high` are the pictures put there."""
        E = {'front': (end[low][0][:, ::-1].transpose(1, 0, 2), end[low][1][:, ::-1].T)}   # [x, y]
        r = end[high] if flip_e else (end[high][0][:, ::-1], end[high][1][:, ::-1])
        E['rear'] = (r[0].transpose(1, 0, 2), r[1].T)
        return E, 0.5 * (E['front'][1] + E['rear'][1])

    def way_of(e, among=(0, 1, 2, 3)):
        """The view from above may be drawn turned or flipped: the way round that leaves the most standing."""
        vol = {k: carve(s, e, ways[k][1]).sum() for k in among}
        return among[0] if vol[among[0]] >= 0.985 * max(vol.values()) else max(vol, key=vol.get)

    E, e = ends('front', 'rear'); way = way_of(e)
    # The view from above, drawn with its front to the left as asked, was laid the other way round to agree with the
    # sides (the side views drew the front to the right): the front is at high z, and the end pictures change ends.
    if not turned and way >= 2:
        E, e = ends('rear', 'front'); way = way_of(e, (2, 3))
    T = ways[way]
    ms['views into cells'] = (time.perf_counter() - t) * 1e3; t = time.perf_counter()

    occ = carve(s, e, T[1])
    lab, n = ndi.label(occ)                                   # what stands: the pieces that reach the ground
    if n > 1:
        ground = np.unique(lab[:, 0, :]); occ = np.isin(lab, ground[ground > 0])
    ms['carve'] = (time.perf_counter() - t) * 1e3; t = time.perf_counter()

    inner = ndi.binary_erosion(occ, iterations=shell, border_value=0)
    g = ndi.gaussian_filter(occ.astype(np.float32), 1.5, mode='constant')
    nx, ny, nz = np.gradient(-g)
    idx = np.argwhere(occ & ~inner)
    X, Y, Z = idx.T
    n = np.stack([nx[X, Y, Z], ny[X, Y, Z], nz[X, Y, Z]], 1); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-6)
    first = {'left': occ.argmax(0)[Y, Z] == X, 'right': (W - 1 - occ[::-1].argmax(0))[Y, Z] == X,
             'front': occ.argmax(2)[X, Y] == Z, 'rear': (L - 1 - occ[:, :, ::-1].argmax(2))[X, Y] == Z,
             'top': (H - 1 - occ[:, ::-1].argmax(1))[X, Z] == Y}
    toward = {'left': -n[:, 0], 'right': n[:, 0], 'front': -n[:, 2], 'rear': n[:, 2], 'top': n[:, 1]}
    colour = {'left': S['left'][0][Z, Y], 'right': S['right'][0][Z, Y], 'front': E['front'][0][X, Y], 'rear': E['rear'][0][X, Y], 'top': T[0][Z, X]}
    have = {'left': S['left'][1][Z, Y], 'right': S['right'][1][Z, Y], 'front': E['front'][1][X, Y], 'rear': E['rear'][1][X, Y], 'top': T[1][Z, X]}
    score = np.stack([np.clip(toward[k], 0, 1) * (0.25 + 0.75 * first[k]) * (have[k] > 0.3) for k in VIEWS], 1)
    best = score.argmax(1)
    col = np.stack([colour[k] for k in VIEWS], 1)[np.arange(len(idx)), best]
    under = (n[:, 1] < -0.6) | (score.max(1) <= 0)
    col[under] = UNDER
    ms['paint'] = (time.perf_counter() - t) * 1e3
    # Which end of z the front is at, by the view from above: it was asked to be drawn with its front to the left,
    # which is z 0 of what it is cut into, and it was laid along z reversed (`way` 2 or 3) to agree with the sides.
    # (Drawn a quarter turn round, the front of what was to the left is not known.)
    front_low = None if turned else way < 2
    info = dict(cells=int(len(idx)), dims=[int(W), int(H), int(L)], **read,
                width_from_ends=round(float(wf * Hp / Lp * L), 1), width_from_above=round(float(wt * L), 1), views_agree=bool(abs(np.log(wt / (wf * Hp / Lp))) < 0.2),
                top_turned=bool(turned), top_way=way, front_low=front_low, right_mirrored=bool(flip_r), rear_mirrored=bool(flip_e),
                painted_from={k: int((best == i)[~under].sum()) for i, k in enumerate(VIEWS)}, under=int(under.sum()),
                ms={k: round(a, 1) for k, a in ms.items()}, total_ms=round((time.perf_counter() - t0) * 1e3, 1))
    return idx, np.clip(col, 0, 255).astype(np.uint8), info
