#!/usr/bin/env python3
"""Survey San Francisco's elevated bridges, viaducts, highway ramps, and untagged overpasses (#228).

Reads the city run's street graphs (`packs/graph/*.json`), the raw 0.25 m LiDAR + 1 m bare-earth DEM
inputs (`sf-450-city/inputs/*.zip`), and `engine/sf/heroes.json`, and emits a deterministic, compact
Brotli-compressed JSON survey (`engine/sf/bridges-survey.json.br`) that `engine/sf/bridges.mjs`
compiles into `bay/bridges.bin` without needing the multi-gigabyte raw LiDAR archive at build or CI time.

Usage:
    ~/.village/engine/bay/venv/bin/python engine/bay/bridges_survey.py \
        [--graphs ~/.village/engine/bay/sf-450-city/packs/graph] \
        [--inputs ~/.village/engine/bay/sf-450-city/inputs] \
        [--out engine/sf/bridges-survey.json.br]
"""
import argparse
import glob
import io
import json
import math
import os
import subprocess
import zipfile
from collections import OrderedDict, defaultdict
import numpy as np

E0, N0, SEA = 500_000.0, 4_250_000.0, 1.0

# Hero bridge exclusion boxes in hero local frame (u, w) matching engine/core/src/heroes.rs:
#   sort 2 = Golden Gate Bridge: u in [-1270, 1420], |w| <= 36
#   sort 4 = Bay Bridge western span: u in [-1445, 1445], |w| <= 28
HERO_BRIDGE_BOXES = {
    2: (-1270.0, 1420.0, -36.0, 36.0),
    4: (-1445.0, 1445.0, -28.0, 28.0),
}

MOTORWAY_HW = {"motorway", "motorway_link"}
OVERPASS_CANDIDATE_HW = {
    "motorway", "motorway_link", "trunk", "trunk_link",
    "primary", "primary_link", "secondary", "secondary_link",
    "tertiary", "tertiary_link", "residential",
}


def latlon_to_world_m(lat, lon):
    """WGS84 lat/lon -> UTM 10N world metres relative to (E0, N0), matching page/bay.ts `place` / 10."""
    zone = 10
    a = 6378137.0
    f = 1.0 / 298.257223563
    n = f / (2.0 - f)
    rad = math.pi / 180.0
    A = (a / (1.0 + n)) * (1.0 + n**2 / 4.0 + n**4 / 64.0)
    alpha = [
        n / 2.0 - (2.0 * n**2) / 3.0 + (5.0 * n**3) / 16.0,
        (13.0 * n**2) / 48.0 - (3.0 * n**3) / 5.0,
        (61.0 * n**3) / 240.0,
    ]
    phi = lat * rad
    lam = (lon - (zone * 6 - 183)) * rad
    e = (2.0 * math.sqrt(n)) / (1.0 + n)
    t = math.sinh(math.atanh(math.sin(phi)) - e * math.atanh(e * math.sin(phi)))
    xi = math.atan(t / math.cos(lam))
    eta = math.atanh(math.sin(lam) / math.sqrt(1.0 + t * t))
    east, north = eta, xi
    for j, c in enumerate(alpha):
        k = 2 * (j + 1)
        east += c * math.cos(k * xi) * math.sinh(k * eta)
        north += c * math.sin(k * xi) * math.cosh(k * eta)
    east = 500000.0 + 0.9996 * A * east
    north = 0.9996 * A * north
    return east - E0, N0 - north


def load_hero_bridge_exclusions(heroes_path):
    boxes = []
    if not os.path.exists(heroes_path):
        return boxes
    for h in json.load(open(heroes_path)):
        box = HERO_BRIDGE_BOXES.get(h.get("sort"))
        if not box:
            continue
        hx, hz = latlon_to_world_m(h["at"][0], h["at"][1])
        tx, tz = latlon_to_world_m(h["toward"][0], h["toward"][1])
        length = math.hypot(tx - hx, tz - hz) or 1.0
        boxes.append((h["name"], hx, hz, (tx - hx) / length, (tz - hz) / length, box))
    return boxes


def inside_hero_bridge(boxes, xm, zm):
    for _, hx, hz, ax, az, (u0, u1, w0, w1) in boxes:
        dx, dz = xm - hx, zm - hz
        u = dx * ax + dz * az
        w = dz * ax - dx * az
        if u0 <= u <= u1 and w0 <= w <= w1:
            return True
    return False


class RasterSampler:
    """LRU-cached sampler over sf-450-city/inputs/*.zip (ground.npy, top_mm.npy, count/multi/footprint)."""

    def __init__(self, inputs_dir, max_open=28):
        self.inputs_dir = inputs_dir
        self.max_open = max_open
        self.cache = OrderedDict()
        # Index square bounding boxes from zip filenames (e.g. 549.7_4175.5.zip -> east 549700..550700, north 4175500..4176500)
        self.squares = []
        for path in sorted(glob.glob(os.path.join(inputs_dir, "*.zip"))):
            base = os.path.basename(path)[:-4]
            parts = base.split("_")
            if len(parts) != 2:
                continue
            try:
                e0 = float(parts[0]) * 1000.0
                n0 = float(parts[1]) * 1000.0
            except ValueError:
                continue
            self.squares.append((e0, n0, path))
        self.by_key = {(int(round(e0)), int(round(n0))): path for e0, n0, path in self.squares}

    def _find_path(self, east, north):
        # Squares sit on 1 km grid offset at .7 km east and .5 km north (e.g. 549700, 4175500)
        ek = int(math.floor((east - 700.0) / 1000.0) * 1000 + 700)
        nk = int(math.floor((north - 500.0) / 1000.0) * 1000 + 500)
        p = self.by_key.get((ek, nk))
        if p:
            return p
        # Fallback: check 16 m margin of adjacent squares
        for de in (0, -1000, 1000):
            for dn in (0, -1000, 1000):
                cand = self.by_key.get((ek + de, nk + dn))
                if cand:
                    ce, cn = ek + de, nk + dn
                    if ce - 15 <= east <= ce + 1015 and cn - 15 <= north <= cn + 1015:
                        return cand
        return None

    def _load(self, path):
        if path in self.cache:
            self.cache.move_to_end(path)
            return self.cache[path]
        with zipfile.ZipFile(path) as zf:
            fr = json.loads(zf.read("frame.json"))
            dem = np.load(io.BytesIO(zf.read("ground.npy")))
            top = np.load(io.BytesIO(zf.read("top_mm.npy")))
            cnt = np.load(io.BytesIO(zf.read("count.npy")))
            mul = np.load(io.BytesIO(zf.read("multi.npy")))
            fp = np.load(io.BytesIO(zf.read("footprint.npy")))
        rec = {
            "west": float(fr["west"]),
            "north": float(fr["north"]),
            "step": float(fr.get("step", 0.25)),
            "dem": dem,
            "top": top,
            "cnt": cnt,
            "mul": mul,
            "fp": fp,
        }
        self.cache[path] = rec
        if len(self.cache) > self.max_open:
            self.cache.popitem(last=False)
        return rec

    def sample(self, xm, zm, win=2):
        """Return (dem_m, top_m, multi_ratio, in_building) in world metres (NAVD88 - SEA), or None."""
        east, north = E0 + xm, N0 - zm
        path = self._find_path(east, north)
        if not path:
            return None
        r = self._load(path)
        dem, top, cnt, mul, fp = r["dem"], r["top"], r["cnt"], r["mul"], r["fp"]
        west, north0, step = r["west"], r["north"], r["step"]

        # Bilinear DEM (groundStep = 1 m)
        fx, fy = east - west, north0 - north
        ix, iy = int(math.floor(fx)), int(math.floor(fy))
        if not (0 <= ix < dem.shape[1] - 1 and 0 <= iy < dem.shape[0] - 1):
            return None
        tx, ty = fx - ix, fy - iy
        g = (
            float(dem[iy, ix]) * (1 - tx) * (1 - ty)
            + float(dem[iy, ix + 1]) * tx * (1 - ty)
            + float(dem[iy + 1, ix]) * (1 - tx) * ty
            + float(dem[iy + 1, ix + 1]) * tx * ty
        ) - SEA

        # 0.25 m LiDAR patch (win=2 -> 5x5 = 1.25m x 1.25m window; rejects vehicles/poles via 35th percentile)
        tc = int(round((east - west) / step))
        tr = int(round((north0 - north) / step))
        if not (win <= tc < top.shape[1] - win and win <= tr < top.shape[0] - win):
            return (g, None, 0.0, False)
        p_top = top[tr - win:tr + win + 1, tc - win:tc + win + 1]
        p_cnt = cnt[tr - win:tr + win + 1, tc - win:tc + win + 1]
        p_mul = mul[tr - win:tr + win + 1, tc - win:tc + win + 1]
        p_fp = fp[tr - win:tr + win + 1, tc - win:tc + win + 1]

        in_bldg = bool(fp[tr, tc] > 0)
        c_sum = float(p_cnt.sum())
        m_ratio = float(p_mul.sum()) / max(1.0, c_sum)

        # Prefer non-building, low-multi-return pixels when computing deck height
        hard = (p_top > -1_000_000) & (p_fp == 0)
        low_veg = hard & ((p_cnt == 0) | (p_mul <= p_cnt * 0.25))
        vals = p_top[low_veg] if low_veg.sum() >= 3 else p_top[hard]
        if vals.size == 0:
            tv = None
        else:
            # 35th percentile rejects transient trucks/cars/sign gantries on the road deck!
            tv = float(np.percentile(vals, 35)) / 1000.0 - SEA
        return (g, tv, m_ratio, in_bldg)

    def sample_top_point(self, xm, zm):
        """Fast 3x3 hard-surface top height at (xm, zm) for transverse deck width probing."""
        east, north = E0 + xm, N0 - zm
        path = self._find_path(east, north)
        if not path:
            return None, False, 1.0
        r = self._load(path)
        tc = int(round((east - r["west"]) / r["step"]))
        tr = int(round((r["north"] - north) / r["step"]))
        top, cnt, mul, fp = r["top"], r["cnt"], r["mul"], r["fp"]
        if not (1 <= tc < top.shape[1] - 1 and 1 <= tr < top.shape[0] - 1):
            return None, False, 1.0
        if fp[tr, tc] > 0:
            return None, True, 0.0
        p_top = top[tr - 1:tr + 2, tc - 1:tc + 2]
        p_cnt = cnt[tr - 1:tr + 2, tc - 1:tc + 2]
        p_mul = mul[tr - 1:tr + 2, tc - 1:tc + 2]
        m_ratio = float(p_mul.sum()) / max(1.0, float(p_cnt.sum()))
        vals = p_top[p_top > -1_000_000]
        if vals.size == 0:
            return None, False, m_ratio
        return float(np.median(vals)) / 1000.0 - SEA, False, m_ratio


def parse_layer(val):
    try:
        return int(str(val))
    except (ValueError, TypeError):
        return 0


def nominal_half_width(hw, lanes, two_way):
    """Reasonable deck half-width (m) including shoulders/barriers (or sidewalks on city streets)."""
    eff = max(1, lanes)
    if hw == "motorway":
        # Caltrans freeway: 3.6 m lanes + shoulders + barriers
        return max(4.2, eff * 1.85 + 2.3)
    if hw in ("motorway_link", "trunk_link"):
        return max(3.6, eff * 1.85 + 1.9)
    if hw in ("trunk", "primary", "secondary"):
        return max(4.0, eff * 1.7 + 2.2)
    if hw in ("primary_link", "secondary_link"):
        return max(3.4, eff * 1.75 + 1.7)
    if hw in ("tertiary", "tertiary_link"):
        return max(3.4, eff * 1.6 + 1.8)
    # residential / service
    return max(3.0, eff * 1.5 + 1.6)


def seg_dist_2d(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    if l2 < 1e-6:
        return math.hypot(px - ax, pz - az), 0.0
    t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
    return math.hypot(px - (ax + t * dx), pz - (az + t * dz)), t


def seg_intersect_2d(a, b, c, d):
    def cross(o, p, q):
        return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
    d1, d2 = cross(c, d, a), cross(c, d, b)
    d3, d4 = cross(a, b, c), cross(a, b, d)
    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    return False


class SpatialSegments:
    """20 m bucket spatial grid over 2D segments with arbitrary payload."""

    def __init__(self, cell_size=25.0):
        self.cs = cell_size
        self.grid = defaultdict(list)

    def add(self, ax, az, bx, bz, pad, payload):
        x0 = int(math.floor((min(ax, bx) - pad) / self.cs))
        x1 = int(math.floor((max(ax, bx) + pad) / self.cs))
        z0 = int(math.floor((min(az, bz) - pad) / self.cs))
        z1 = int(math.floor((max(az, bz) + pad) / self.cs))
        item = (ax, az, bx, bz, pad, payload)
        for gx in range(x0, x1 + 1):
            for gz in range(z0, z1 + 1):
                self.grid[(gx, gz)].append(item)

    def query_point(self, px, pz):
        gx = int(math.floor(px / self.cs))
        gz = int(math.floor(pz / self.cs))
        return self.grid.get((gx, gz), ())


def resample_polyline(pts, step_m=4.5):
    """Resample 2D polyline (in metres) so consecutive vertices are at most ~step_m apart while keeping original corners."""
    if len(pts) < 2:
        return list(pts)
    out = [pts[0]]
    for i in range(len(pts) - 1):
        ax, az = pts[i]
        bx, bz = pts[i + 1]
        d = math.hypot(bx - ax, bz - az)
        if d < 0.2:
            continue
        n = max(1, int(math.ceil(d / step_m)))
        for k in range(1, n + 1):
            u = k / n
            out.append((ax + (bx - ax) * u, az + (bz - az) * u))
    return out


def polyline_arc(pts):
    s = [0.0]
    for i in range(1, len(pts)):
        s.append(s[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    return s


def tangent_at(pts, i):
    n = len(pts)
    i0 = max(0, i - 1)
    i1 = min(n - 1, i + 1)
    dx = pts[i1][0] - pts[i0][0]
    dz = pts[i1][1] - pts[i0][1]
    l = math.hypot(dx, dz)
    if l < 1e-6:
        return 1.0, 0.0
    return dx / l, dz / l


def load_all_edges(graphs_dir):
    """Load & deduplicate all road edges across all 155 SF street graphs into undirected edges with exact OSM nodes."""
    # First deduplicate directed segments by id
    directed = {}
    for p in sorted(glob.glob(os.path.join(graphs_dir, "*.json"))):
        d = json.load(open(p))
        for r in d.get("roads", []):
            rid = r.get("id")
            if not rid:
                continue
            pts = r.get("line") or []
            if len(pts) < 2:
                continue
            # Prefer longer/more-detailed copy if duplicated across square boundary
            prev = directed.get(rid)
            if prev is None or len(pts) > len(prev["line"]):
                directed[rid] = r

    # Collapse exact reverse duplicates of two-way streets (same way_id & reversed endpoint nodes)
    undirected = {}
    for rid, r in directed.items():
        parts = rid.split("/")
        wid = parts[0]
        nodes = r.get("nodes") or []
        if len(nodes) >= 2:
            na, nb = nodes[0], nodes[-1]
        else:
            na, nb = int(parts[1]), int(parts[2])
        key = (wid, min(na, nb), max(na, nb))
        pts_m = [(pt[0] / 10.0, pt[1] / 10.0) for pt in r["line"]]
        lanes = max(1, int(r.get("lanes") or 1))
        br = str(r.get("bridge") or "no")
        if br == "None":
            br = "no"
        tn = str(r.get("tunnel") or "no")
        if tn == "None":
            tn = "no"
        layer = parse_layer(r.get("layer", 0))
        hw = r.get("highway") or ""
        name = r.get("name") or ""

        if key in undirected:
            e = undirected[key]
            # Opposite direction of same undirected segment -> two-way road!
            if e["na"] == nb and e["nb"] == na:
                e["lanes"] += lanes
                e["two_way"] = True
        else:
            undirected[key] = {
                "key": key,
                "wid": wid,
                "na": na,
                "nb": nb,
                "pts": pts_m,
                "lanes": lanes,
                "two_way": False,
                "hw": hw,
                "bridge": br,
                "tunnel": tn,
                "layer": layer,
                "name": name,
            }
    return list(undirected.values())


def chain_edges(edges):
    """Chain contiguous edges sharing the same OSM way_id, layer, and bridge/tunnel state into ordered polylines."""
    groups = defaultdict(list)
    for e in edges:
        groups[(e["wid"], e["layer"], e["bridge"] != "no", e["tunnel"] != "no")].append(e)

    chains = []
    for (wid, layer, is_br, is_tn), elist in sorted(groups.items()):
        adj = defaultdict(list)
        for idx, e in enumerate(elist):
            adj[e["na"]].append((idx, False))
            adj[e["nb"]].append((idx, True))
        used = [False] * len(elist)

        # Start from degree-1 nodes first, then any remaining cycles
        starts = [n for n, lst in adj.items() if len(lst) != 2]
        for start_pass in (0, 1):
            candidates = starts if start_pass == 0 else list(adj.keys())
            for node in candidates:
                for idx, rev in adj[node]:
                    if used[idx]:
                        continue
                    # Walk chain forward from `node` along edge `idx`
                    used[idx] = True
                    e0 = elist[idx]
                    pts = list(reversed(e0["pts"])) if rev else list(e0["pts"])
                    n_start = e0["nb"] if rev else e0["na"]
                    cur = e0["na"] if rev else e0["nb"]
                    seg_edges = [e0]
                    while True:
                        nxt = None
                        for nidx, nrev in adj[cur]:
                            if not used[nidx]:
                                nxt = (nidx, nrev)
                                break
                        if nxt is None:
                            break
                        nidx, nrev = nxt
                        used[nidx] = True
                        en = elist[nidx]
                        epts = list(reversed(en["pts"])) if nrev else list(en["pts"])
                        pts.extend(epts[1:])
                        cur = en["na"] if nrev else en["nb"]
                        seg_edges.append(en)
                    lanes = max(e["lanes"] for e in seg_edges)
                    two_way = any(e["two_way"] for e in seg_edges)
                    chains.append({
                        "wid": wid,
                        "layer": layer,
                        "is_bridge": is_br,
                        "is_tunnel": is_tn,
                        "hw": e0["hw"],
                        "name": e0["name"],
                        "lanes": lanes,
                        "two_way": two_way,
                        "n_start": n_start,
                        "n_end": cur,
                        "pts": pts,
                    })
    return chains


def walk_approach(node_id, from_pt, node_edges, target_len=10.0, exclude_wid=None):
    """Walk up to `target_len` m along a grounded non-bridge approach connected to `node_id`."""
    cands = []
    for e in node_edges.get(node_id, ()):
        if e["bridge"] != "no" or e["tunnel"] != "no":
            continue
        if e["na"] == node_id:
            epts = list(e["pts"])
        elif e["nb"] == node_id:
            epts = list(reversed(e["pts"]))
        else:
            continue
        if len(epts) < 2:
            continue
        # Measure alignment with outgoing direction from bridge
        dx0, dz0 = epts[1][0] - epts[0][0], epts[1][1] - epts[0][1]
        l0 = math.hypot(dx0, dz0)
        if l0 < 1e-4:
            continue
        # Direction continuing away from bridge interior
        bx, bz = epts[0][0] - from_pt[0], epts[0][1] - from_pt[1]
        bl = math.hypot(bx, bz) or 1.0
        align = (dx0 * bx + dz0 * bz) / (l0 * bl)
        # Prefer motorway/primary continuations well-aligned with the bridge
        score = align + (0.3 if e["hw"] in MOTORWAY_HW else 0.0)
        cands.append((score, epts))
    if not cands:
        return []
    cands.sort(key=lambda x: -x[0])
    if cands[0][0] < 0.25:
        return []
    epts = cands[0][1]
    out = []
    acc = 0.0
    for i in range(len(epts) - 1):
        ax, az = epts[i]
        bx, bz = epts[i + 1]
        d = math.hypot(bx - ax, bz - az)
        if acc + d >= target_len:
            u = (target_len - acc) / max(1e-6, d)
            out.append((ax + (bx - ax) * u, az + (bz - az) * u))
            break
        out.append((bx, bz))
        acc += d
    return out


def interpolate_profile(s, y_raw, valid, dem, y_ceil=None, max_grade=0.11, pin_start=False, pin_end=False):
    """Fit a silky-smooth, grade-constrained longitudinal bridge deck profile from noisy LiDAR samples."""
    n = len(s)
    idx_v = [i for i in range(n) if valid[i]]
    if not idx_v:
        out = [dem[i] + 5.2 for i in range(n)]
        if y_ceil:
            for i in range(n):
                if y_ceil[i] is not None:
                    out[i] = min(out[i], y_ceil[i] - 5.0)
        return out

    # Step 1: Running-median filter (+/- 18 m window) rejects multi-sample spikes (sign gantries, overhanging trees,
    # building edges, or higher-deck bleed) AND multi-sample potholes (gaps between parallel decks).
    keep = []
    for i in idx_v:
        if (pin_start and i == 0) or (pin_end and i == n - 1):
            keep.append(i)
            continue
        win_vals = [y_raw[j] for j in idx_v if abs(s[j] - s[i]) <= 18.0]
        if len(win_vals) >= 3:
            med = float(np.median(win_vals))
            if abs(y_raw[i] - med) > 1.6:
                continue
        keep.append(i)
    if not keep:
        keep = list(idx_v)

    # Step 2: Linear interpolation across invalid/occluded/rejected gaps
    y = [0.0] * n
    for i in range(n):
        if i <= keep[0]:
            y[i] = y_raw[keep[0]]
        elif i >= keep[-1]:
            y[i] = y_raw[keep[-1]]
        else:
            lo, hi = 0, len(keep) - 1
            while lo + 1 < hi:
                mid = (lo + hi) // 2
                if keep[mid] <= i:
                    lo = mid
                else:
                    hi = mid
            ia, ib = keep[lo], keep[hi]
            u = (s[i] - s[ia]) / max(1e-6, s[ib] - s[ia])
            y[i] = y_raw[ia] * (1 - u) + y_raw[ib] * u

    # Step 3: Apply upper-deck clearance ceiling before smoothing so transitions into/out of double-deck sections are gradual
    if y_ceil:
        for i in range(n):
            if y_ceil[i] is not None:
                y[i] = min(y[i], y_ceil[i] - 5.0)

    # Step 4: Iterative grade-limiting + smoothing so no bridge ever has an abrupt step or unnavigable spike
    for _ in range(24):
        # Symmetric grade projection (forward & backward)
        for i in range(1, n):
            max_dy = max_grade * max(0.5, s[i] - s[i - 1])
            dy = y[i] - y[i - 1]
            if abs(dy) > max_dy:
                excess = (abs(dy) - max_dy) * (1.0 if dy > 0 else -1.0)
                if pin_start and i - 1 == 0:
                    y[i] -= excess
                elif pin_end and i == n - 1:
                    y[i - 1] += excess
                else:
                    y[i - 1] += excess * 0.5
                    y[i] -= excess * 0.5
        for i in range(n - 2, -1, -1):
            max_dy = max_grade * max(0.5, s[i + 1] - s[i])
            dy = y[i + 1] - y[i]
            if abs(dy) > max_dy:
                excess = (abs(dy) - max_dy) * (1.0 if dy > 0 else -1.0)
                if pin_end and i + 1 == n - 1:
                    y[i] += excess
                elif pin_start and i == 0:
                    y[i + 1] -= excess
                else:
                    y[i] += excess * 0.5
                    y[i + 1] -= excess * 0.5
        # Soft smoothing pass
        nxt = list(y)
        for i in range(1, n - 1):
            w0 = 1.0 / max(1.0, s[i] - s[i - 1])
            w1 = 1.0 / max(1.0, s[i + 1] - s[i])
            avg = (y[i - 1] * w0 + y[i + 1] * w1) / (w0 + w1)
            nxt[i] = 0.65 * y[i] + 0.35 * avg
        y = nxt
        if y_ceil:
            for i in range(n):
                if y_ceil[i] is not None:
                    y[i] = min(y[i], y_ceil[i] - 4.8)
        for i in range(n):
            if y[i] < dem[i]:
                y[i] = dem[i]
        if pin_start:
            y[0] = dem[0]
        if pin_end:
            y[-1] = dem[-1]

    # Final grade cleanup pass so every adjacent pair satisfies max_grade cleanly
    for _ in range(12):
        for i in range(1, n):
            max_dy = max_grade * max(0.5, s[i] - s[i - 1])
            dy = y[i] - y[i - 1]
            if abs(dy) > max_dy:
                excess = (abs(dy) - max_dy) * (1.0 if dy > 0 else -1.0)
                y[i - 1] += excess * 0.5
                y[i] -= excess * 0.5
        for i in range(n):
            if y[i] < dem[i]:
                y[i] = dem[i]
    return y


def measure_deck_widths(sampler, pts, ys, dems, hw, lanes, two_way, ribbon_grid, layer):
    """Measure true left/right deck half-widths from LiDAR drop-offs, bounded cleanly around nominal lane width."""
    nom = nominal_half_width(hw, lanes, two_way)
    min_hw = max(2.8, nom * 0.78)
    max_hw = min(22.0, nom + 4.5)
    left_meas, right_meas = [], []

    for i in range(1, len(pts) - 1, max(1, len(pts) // 24)):
        if ys[i] - dems[i] < 2.2:
            continue
        xm, zm = pts[i]
        # Skip if occluded by a higher deck
        occluded = False
        for ax, az, bx, bz, pad, pay in ribbon_grid.query_point(xm, zm):
            if pay["layer"] > layer:
                d, _ = seg_dist_2d(xm, zm, ax, az, bx, bz)
                if d <= pad:
                    occluded = True
                    break
        if occluded:
            continue
        tx, tz = tangent_at(pts, i)
        # In (x east, z south), LEFT normal is (tz, -tx), RIGHT normal is (-tz, tx)
        # Wait: cross((tx, tz), (nx, nz)) = tx*nz - tz*nx. For LEFT in (x east, z south), let's match bay.rs kerbs:
        # In bay.rs: cross(b - a, q - a) = dx*(qz-az) - dz*(qx-ax) > 0 => normal (-dz, +dx)!
        # Let's use exact convention: left normal = (-tz, +tx) so cross(T, N_left) = tx*tx - tz*(-tz) = +1 > 0!
        lnx, lnz = -tz, tx
        for side_sign, bucket in ((1.0, left_meas), (-1.0, right_meas)):
            edge = None
            dist = 1.5
            while dist <= max_hw + 1.0:
                px = xm + side_sign * lnx * dist
                pz = zm + side_sign * lnz * dist
                tv, in_bldg, mr = sampler.sample_top_point(px, pz)
                if in_bldg or mr > 0.35:
                    break
                if tv is None or tv < ys[i] - 1.5:
                    edge = dist - 0.25
                    break
                # Stop if we hit a much higher adjacent deck
                if tv > ys[i] + 2.2:
                    edge = dist - 0.5
                    break
                dist += 0.5
            if edge is not None and min_hw * 0.7 <= edge <= max_hw + 0.5:
                bucket.append(edge)

    hl = float(np.median(left_meas)) if len(left_meas) >= 3 else nom
    hr = float(np.median(right_meas)) if len(right_meas) >= 3 else nom
    hl = max(min_hw, min(max_hw, hl))
    hr = max(min_hw, min(max_hw, hr))
    return hl, hr


def rdp_3d(verts, eps_xy=0.25, eps_y=0.06):
    """3D RDP simplification preserving vflag transitions and smooth curves.
    Each vert is (x, z, y, hl, hr, vflags).
    """
    n = len(verts)
    if n <= 2:
        return verts
    keep = [False] * n
    keep[0] = keep[-1] = True
    # Always preserve vflags or width transitions
    for i in range(1, n - 1):
        if verts[i][5] != verts[i - 1][5] or verts[i][5] != verts[i + 1][5]:
            keep[i] = True
        elif abs(verts[i][3] - verts[i - 1][3]) > 0.4 or abs(verts[i][4] - verts[i - 1][4]) > 0.4:
            keep[i] = True

    # Run RDP between pinned indices
    pinned = [i for i in range(n) if keep[i]]
    for k in range(len(pinned) - 1):
        stack = [(pinned[k], pinned[k + 1])]
        while stack:
            a, b = stack.pop()
            if b <= a + 1:
                continue
            va, vb = verts[a], verts[b]
            dx, dz = vb[0] - va[0], vb[1] - va[1]
            l2 = dx * dx + dz * dz
            best_err, best_i = 0.0, -1
            for i in range(a + 1, b):
                vi = verts[i]
                if l2 < 1e-6:
                    t = 0.0
                    dxy = math.hypot(vi[0] - va[0], vi[1] - va[1])
                else:
                    t = max(0.0, min(1.0, ((vi[0] - va[0]) * dx + (vi[1] - va[1]) * dz) / l2))
                    dxy = math.hypot(vi[0] - (va[0] + t * dx), vi[1] - (va[1] + t * dz))
                dy = abs(vi[2] - (va[2] + t * (vb[2] - va[2])))
                err = max(dxy / eps_xy, dy / eps_y)
                if err > best_err:
                    best_err, best_i = err, i
            if best_err > 1.0 and best_i > a:
                keep[best_i] = True
                stack.append((a, best_i))
                stack.append((best_i, b))
    return [verts[i] for i in range(n) if keep[i]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--graphs", default=os.path.expanduser("~/.village/engine/bay/sf-450-city/packs/graph"))
    ap.add_argument("--inputs", default=os.path.expanduser("~/.village/engine/bay/sf-450-city/inputs"))
    ap.add_argument("--heroes", default=os.path.join(os.path.dirname(__file__), "../sf/heroes.json"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "../sf/bridges-survey.json.br"))
    args = ap.parse_args()

    hero_boxes = load_hero_bridge_exclusions(args.heroes)
    print(f"Loaded {len(hero_boxes)} hero bridge exclusions: {[b[0] for b in hero_boxes]}")

    edges = load_all_edges(args.graphs)
    print(f"Loaded {len(edges)} unique undirected road edges from {args.graphs}")

    # Build node adjacency across ALL roads (for grounded approach extension & shared-node locking)
    node_edges = defaultdict(list)
    node_has_bridge = defaultdict(set)  # node -> set of layers of explicit bridges touching it
    tunnel_grid = SpatialSegments(25.0)
    lower_road_grid = SpatialSegments(25.0)

    for e in edges:
        node_edges[e["na"]].append(e)
        node_edges[e["nb"]].append(e)
        if e["bridge"] != "no":
            node_has_bridge[e["na"]].add(e["layer"])
            node_has_bridge[e["nb"]].add(e["layer"])
        hw_w = nominal_half_width(e["hw"], e["lanes"], e["two_way"])
        if e["tunnel"] != "no" or e["layer"] < 0:
            pts = e["pts"]
            for i in range(len(pts) - 1):
                tunnel_grid.add(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hw_w + 3.0, e)
        if e["bridge"] == "no" and e["hw"] in OVERPASS_CANDIDATE_HW:
            pts = e["pts"]
            for i in range(len(pts) - 1):
                lower_road_grid.add(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hw_w + 1.6, (e["layer"], hw_w))

    chains = chain_edges(edges)
    explicit_bridges = [c for c in chains if c["is_bridge"]]
    non_bridge_chains = [c for c in chains if not c["is_bridge"] and not c["is_tunnel"] and c["layer"] >= 0 and c["hw"] in OVERPASS_CANDIDATE_HW]
    print(f"Chained {len(explicit_bridges)} explicit bridge chains and {len(non_bridge_chains)} non-bridge road chains")

    sampler = RasterSampler(args.inputs)
    ribbon_grid = SpatialSegments(25.0)
    spans = []

    def add_ribbon(span):
        verts = span["verts"]
        for i in range(len(verts) - 1):
            ax, az, ay, ahl, ahr, _ = verts[i]
            bx, bz, by, bhl, bhr, _ = verts[i + 1]
            pad = max(ahl, ahr, bhl, bhr) + 3.0
            ribbon_grid.add(ax, az, bx, bz, pad, {
                "span_idx": span["idx"],
                "layer": span["layer"],
                "ay": ay, "by": by,
                "hl": max(ahl, bhl), "hr": max(ahr, bhr),
                "ax": ax, "az": az, "bx": bx, "bz": bz,
            })

    # ── PASS 1: Explicit Bridges, processed TOP-DOWN by OSM layer (4 -> 0) ──
    # Sort explicit bridges spatially inside each layer too for optimal zip cache locality
    explicit_bridges.sort(key=lambda c: (
        -c["layer"],
        int(math.floor((E0 + c["pts"][0][0] - 700.0) / 1000.0)),
        int(math.floor((N0 - c["pts"][0][1] - 500.0) / 1000.0)),
    ))
    skipped_hero = 0
    skipped_flat = 0

    for c in explicit_bridges:
        raw_pts = c["pts"]
        # Trim points strictly inside Golden Gate / Bay Bridge hero decks
        kept_runs = []
        cur_run = []
        for pt in raw_pts:
            if inside_hero_bridge(hero_boxes, pt[0], pt[1]):
                if len(cur_run) >= 2:
                    kept_runs.append(cur_run)
                cur_run = []
            else:
                cur_run.append(pt)
        if len(cur_run) >= 2:
            kept_runs.append(cur_run)
        if not kept_runs:
            skipped_hero += 1
            continue

        for run_idx, run_pts in enumerate(kept_runs):
            is_first_run = (run_idx == 0)
            is_last_run = (run_idx == len(kept_runs) - 1)
            # Extend grounded abutments 9 m onto connected non-bridge approach roads so ramp-in is seamless!
            ext_start = []
            ext_end = []
            start_grounded = False
            end_grounded = False
            if is_first_run and len(node_has_bridge[c["n_start"]]) == 1:
                ext = walk_approach(c["n_start"], run_pts[min(1, len(run_pts) - 1)], node_edges, target_len=9.0)
                if ext:
                    ext_start = list(reversed(ext))
                    start_grounded = True
            if is_last_run and len(node_has_bridge[c["n_end"]]) == 1:
                ext = walk_approach(c["n_end"], run_pts[max(0, len(run_pts) - 2)], node_edges, target_len=9.0)
                if ext:
                    ext_end = ext
                    end_grounded = True

            full_pts = ext_start + run_pts + ext_end
            pts = resample_polyline(full_pts, step_m=4.5)
            if len(pts) < 2:
                continue
            s = polyline_arc(pts)
            n = len(pts)
            dems, y_raw, valid, y_ceil = [], [], [], []
            any_sampled = False

            for i, (xm, zm) in enumerate(pts):
                samp = sampler.sample(xm, zm, win=2)
                if samp is None:
                    dems.append(0.0)
                    y_raw.append(0.0)
                    valid.append(False)
                    y_ceil.append(None)
                    continue
                any_sampled = True
                g, tv, mr, in_bldg = samp
                dems.append(g)

                # Check if a higher-layer bridge occludes this column
                upper_y = None
                for ax, az, bx, bz, pad, pay in ribbon_grid.query_point(xm, zm):
                    if pay["layer"] > c["layer"]:
                        d, t = seg_dist_2d(xm, zm, ax, az, bx, bz)
                        if d <= max(pay["hl"], pay["hr"]) + 2.8:
                            uy = pay["ay"] * (1 - t) + pay["by"] * t
                            upper_y = uy if upper_y is None else min(upper_y, uy)
                y_ceil.append(upper_y)

                if upper_y is not None:
                    # Occluded by upper deck: do NOT use upper deck's LiDAR return as lower deck height!
                    y_raw.append(g)
                    valid.append(False)
                elif tv is not None and not in_bldg and mr < 0.30:
                    y_raw.append(max(tv, g))
                    valid.append(True)
                else:
                    y_raw.append(g)
                    valid.append(False)

            if not any_sampled:
                continue

            # Only pin grounded approach tips strictly to DEM if the approach is actually near ground (avoid yanking
            # an elevated bridge end down a cliff if OSM stopped the bridge=yes tag early!)
            pin_start = start_grounded and (not valid[0] or abs(y_raw[0] - dems[0]) < 2.2)
            pin_end = end_grounded and (not valid[-1] or abs(y_raw[-1] - dems[-1]) < 2.2)
            if pin_start:
                y_raw[0] = dems[0]
                valid[0] = True
            if pin_end:
                y_raw[-1] = dems[-1]
                valid[-1] = True

            max_gr = 0.11 if c["hw"] in MOTORWAY_HW else 0.15
            ys = interpolate_profile(s, y_raw, valid, dems, y_ceil=y_ceil, max_grade=max_gr, pin_start=pin_start, pin_end=pin_end)

            # Guarantee bridge deck never dips below bare-earth DEM
            for i in range(n):
                ys[i] = max(ys[i], dems[i])

            # Check whether this bridge actually rises meaningfully above bare-earth DEM
            max_clear = max(ys[i] - dems[i] for i in range(n))
            if max_clear < 0.45:
                skipped_flat += 1
                continue

            hl, hr = measure_deck_widths(sampler, pts, ys, dems, c["hw"], c["lanes"], c["two_way"], ribbon_grid, c["layer"])

            # Deck structural thickness (m): thicker box girder for wide motorways, sleeker for ramps/streets
            if c["hw"] == "motorway":
                thick = 1.6
            elif c["hw"] in ("motorway_link", "trunk", "primary"):
                thick = 1.3
            else:
                thick = 1.0

            span = {
                "idx": len(spans),
                "kind": "bridge",
                "wid": c["wid"],
                "name": c["name"],
                "hw": c["hw"],
                "layer": c["layer"],
                "lanes": min(7, c["lanes"]),
                "two_way": c["two_way"],
                "n_start": None if start_grounded or not is_first_run else c["n_start"],
                "n_end": None if end_grounded or not is_last_run else c["n_end"],
                "start_grounded": start_grounded,
                "end_grounded": end_grounded,
                "thick": thick,
                "max_clear": max_clear,
                "verts": [(pts[i][0], pts[i][1], ys[i], hl, hr, 0) for i in range(n)],
                "dems": dems,
            }
            spans.append(span)
            add_ribbon(span)

    print(f"Pass 1 (explicit bridges): {len(spans)} spans kept (skipped {skipped_hero} hero-owned, {skipped_flat} flush-at-grade)")

    # ── PASS 2: Untagged Overpasses (over tunnels/underpasses/DEM cuts, e.g. I-280 over way 309010731!) ──
    # Sort by 1 km square so each raw input zip is read ONCE instead of thrashing the LRU cache!
    non_bridge_chains.sort(key=lambda c: (
        int(math.floor((E0 + c["pts"][0][0] - 700.0) / 1000.0)),
        int(math.floor((N0 - c["pts"][0][1] - 500.0) / 1000.0)),
    ))
    untagged_count = 0
    for c in non_bridge_chains:
        # Fast pre-filter: only sample residential/tertiary roads if they cross a tunnel or lie near a motorway/bridge corridor;
        # always sample motorway, motorway_link, trunk, primary, secondary!
        if c["hw"] in ("residential", "tertiary", "tertiary_link"):
            near_tunnel = False
            for xm, zm in c["pts"]:
                if tunnel_grid.query_point(xm, zm):
                    near_tunnel = True
                    break
            if not near_tunnel:
                continue
        pts = resample_polyline(c["pts"], step_m=4.0)
        if len(pts) < 3:
            continue
        n = len(pts)
        s = polyline_arc(pts)
        dems, tops, valid, over_tunnel = [], [], [], []

        for i, (xm, zm) in enumerate(pts):
            if inside_hero_bridge(hero_boxes, xm, zm):
                dems.append(0.0); tops.append(None); valid.append(False); over_tunnel.append(False)
                continue
            # Check first if this point crosses over a tagged tunnel / layer < 0 underpass
            hit_t = False
            for ax, az, bx, bz, pad, te in tunnel_grid.query_point(xm, zm):
                d, _ = seg_dist_2d(xm, zm, ax, az, bx, bz)
                if d <= pad:
                    hit_t = True
                    break
            # Mask out any point under an existing explicit bridge (so lower streets like Bosworth St are NEVER elevated!).
            # Exception: if this road itself crosses OVER a layer < 0 tunnel while a much higher L >= 2 flyover hangs overhead
            # (e.g. way 31487932 I-280 N On-Ramp over San Jose Ave tunnel under L=2 flyover 29394019), keep `over_tunnel=True`
            # with `valid=False` so its deck height interpolates cleanly from its unoccluded ends!
            under_bridge = False
            for ax, az, bx, bz, pad, pay in ribbon_grid.query_point(xm, zm):
                d, _ = seg_dist_2d(xm, zm, ax, az, bx, bz)
                if d <= max(pay["hl"], pay["hr"]) + 3.5:
                    under_bridge = True
                    break
            samp = sampler.sample(xm, zm, win=2)
            if samp is None:
                dems.append(0.0); tops.append(None); valid.append(False); over_tunnel.append(False)
                continue
            g, tv, mr, in_bldg = samp
            dems.append(g)
            if under_bridge:
                tops.append(None); valid.append(False); over_tunnel.append(hit_t)
                continue
            ok = (tv is not None and not in_bldg and mr < 0.20)
            tops.append(tv if ok else None)
            valid.append(ok)
            over_tunnel.append(hit_t)

        # Find contiguous elevated runs where unmasked hard-surface LiDAR exceeds bare-earth DEM by >= 1.5 m,
        # OR where the road crosses directly over a tagged tunnel underpass (`over_tunnel`).
        elev = [(valid[i] and (tops[i] - dems[i] >= 1.5)) or over_tunnel[i] for i in range(n)]
        # Close tiny 1-sample (4 m) gaps inside a single overpass run
        for i in range(1, n - 1):
            if not elev[i] and elev[i - 1] and elev[i + 1]:
                elev[i] = True

        i = 0
        while i < n:
            if not elev[i]:
                i += 1
                continue
            j = i
            while j < n and elev[j]:
                j += 1
            run_len_m = s[j - 1] - s[i]
            has_tunnel = any(over_tunnel[k] for k in range(i, j))
            valid_diffs = [tops[k] - dems[k] for k in range(i, j) if valid[k] and tops[k] is not None]
            max_diff = max(valid_diffs) if valid_diffs else 0.0

            # Verify grounded approaches on BOTH sides (or at least one side + tunnel crossing)
            # so a lower road entering a cut or near a building/tree never false-triggers!
            a0 = max(0, i - 4)
            b1 = min(n - 1, j + 3)
            # Find closest grounded sample before `i` and after `j-1`
            pre = next((k for k in range(i - 1, max(-1, i - 8), -1) if valid[k] and abs(tops[k] - dems[k]) < 1.1), None)
            post = next((k for k in range(j, min(n, j + 8)) if valid[k] and abs(tops[k] - dems[k]) < 1.1), None)

            accept = False
            if has_tunnel and ((max_diff >= 1.8 and len(valid_diffs) >= 2) or (pre is not None and post is not None and min(dems[pre], dems[post]) - min(dems[i:j]) >= 2.0)):
                accept = True
            elif pre is not None and post is not None and run_len_m >= 6.0 and max_diff >= 2.2 and len(valid_diffs) >= 2:
                # Smooth-chord test: true overpass top connects pre & post smoothly while DEM dips below!
                y_pre, y_post = dems[pre], dems[post]
                ds_pp = max(1.0, s[post] - s[pre])
                grade_pp = abs(y_post - y_pre) / ds_pp
                if grade_pp <= 0.14:
                    chord_errs = []
                    dem_dips = []
                    for k in range(i, j):
                        if valid[k] and tops[k] is not None:
                            u = (s[k] - s[pre]) / ds_pp
                            ch = y_pre * (1 - u) + y_post * u
                            chord_errs.append(abs(tops[k] - ch))
                            dem_dips.append(ch - dems[k])
                    if chord_errs and float(np.median(chord_errs)) < 1.5 and max(dem_dips) >= 2.0:
                        accept = True

            if accept:
                lo = pre if pre is not None else a0
                hi = post if post is not None else b1
                if hi > lo + 1:
                    sub_pts = pts[lo:hi + 1]
                    sub_s = polyline_arc(sub_pts)
                    sub_dems = []
                    sub_yraw = []
                    sub_val = []
                    for k in range(lo, hi + 1):
                        samp = sampler.sample(pts[k][0], pts[k][1], win=2)
                        g = samp[0] if samp else dems[k]
                        tv = samp[1] if samp else None
                        mr = samp[2] if samp else 1.0
                        ib = samp[3] if samp else True
                        sub_dems.append(g)
                        ok = (tv is not None and not ib and mr < 0.25)
                        # Reject points occluded by an explicit higher bridge at the edge of the extension
                        for ax, az, bx, bz, pad, pay in ribbon_grid.query_point(pts[k][0], pts[k][1]):
                            d, _ = seg_dist_2d(pts[k][0], pts[k][1], ax, az, bx, bz)
                            if d <= max(pay["hl"], pay["hr"]) + 2.5:
                                ok = False
                                break
                        sub_yraw.append(max(tv, g) if ok else g)
                        sub_val.append(ok)
                    # Pin grounded ends cleanly to DEM
                    if pre is not None:
                        sub_yraw[0] = sub_dems[0]; sub_val[0] = True
                    if post is not None:
                        sub_yraw[-1] = sub_dems[-1]; sub_val[-1] = True
                    sub_ys = interpolate_profile(sub_s, sub_yraw, sub_val, sub_dems, max_grade=0.11 if c["hw"] in MOTORWAY_HW else 0.15, pin_start=pre is not None, pin_end=post is not None)
                    for k in range(len(sub_ys)):
                        sub_ys[k] = max(sub_ys[k], sub_dems[k])
                    if pre is not None:
                        sub_ys[0] = sub_dems[0]
                    if post is not None:
                        sub_ys[-1] = sub_dems[-1]
                    max_c = max(sub_ys[k] - sub_dems[k] for k in range(len(sub_ys)))
                    if max_c >= 1.4:
                        hl, hr = measure_deck_widths(sampler, sub_pts, sub_ys, sub_dems, c["hw"], c["lanes"], c["two_way"], ribbon_grid, c["layer"])
                        thick = 1.5 if c["hw"] == "motorway" else 1.2
                        span = {
                            "idx": len(spans),
                            "kind": "overpass",
                            "wid": c["wid"],
                            "name": c["name"],
                            "hw": c["hw"],
                            "layer": c["layer"],
                            "lanes": min(7, c["lanes"]),
                            "two_way": c["two_way"],
                            "n_start": None,
                            "n_end": None,
                            "start_grounded": pre is not None,
                            "end_grounded": post is not None,
                            "thick": thick,
                            "max_clear": max_c,
                            "verts": [(sub_pts[k][0], sub_pts[k][1], sub_ys[k], hl, hr, 0) for k in range(len(sub_pts))],
                            "dems": sub_dems,
                        }
                        spans.append(span)
                        add_ribbon(span)
                        untagged_count += 1
            i = j

    print(f"Pass 2 (untagged overpasses over tunnels/cuts): {untagged_count} spans added (total {len(spans)})")

    # ── PASS 3: Shared OSM Node Elevation Locking (seamless viaduct joints & ramp merges!) ──
    node_hits = defaultdict(list)  # (node_id, layer) -> list of (span_idx, is_end, weight, y)
    for sp in spans:
        w = 3.0 if sp["hw"] == "motorway" else 1.0
        if sp["n_start"] is not None:
            node_hits[(sp["n_start"], sp["layer"])].append((sp["idx"], False, w, sp["verts"][0][2]))
        if sp["n_end"] is not None:
            node_hits[(sp["n_end"], sp["layer"])].append((sp["idx"], True, w, sp["verts"][-1][2]))

    locked_nodes = 0
    for key, hits in node_hits.items():
        if len(hits) < 2:
            continue
        ys = [h[3] for h in hits]
        if max(ys) - min(ys) > 3.5:
            continue
        target_y = sum(h[2] * h[3] for h in hits) / sum(h[2] for h in hits)
        locked_nodes += 1
        for sp_idx, is_end, _, old_y in hits:
            dy = target_y - old_y
            if abs(dy) < 0.01:
                continue
            sp = spans[sp_idx]
            verts = sp["verts"]
            pts = [(v[0], v[1]) for v in verts]
            arc = polyline_arc(pts)
            total = arc[-1]
            for k in range(len(verts)):
                dist_from_end = (total - arc[k]) if is_end else arc[k]
                if dist_from_end < 36.0:
                    w_blend = 1.0 - dist_from_end / 36.0
                    w_blend = w_blend * w_blend * (3.0 - 2.0 * w_blend)  # smoothstep
                    x, z, y, hl, hr, vf = verts[k]
                    verts[k] = (x, z, max(sp["dems"][k], y + dy * w_blend), hl, hr, vf)
    print(f"Pass 3: locked {locked_nodes} shared elevated junction nodes")

    # ── PASS 4: Per-Vertex Barrier Suppression (left_open / right_open at merges & parallel decks) + ramp_in ──
    # Rebuild spatial ribbon grid with final locked elevations
    final_grid = SpatialSegments(25.0)
    for sp in spans:
        verts = sp["verts"]
        for i in range(len(verts) - 1):
            ax, az, ay, ahl, ahr, _ = verts[i]
            bx, bz, by, bhl, bhr, _ = verts[i + 1]
            pad = max(ahl, ahr, bhl, bhr) + 3.0
            final_grid.add(ax, az, bx, bz, pad, {
                "span_idx": sp["idx"],
                "ay": ay, "by": by,
                "hl": max(ahl, bhl), "hr": max(ahr, bhr),
            })

    for sp in spans:
        verts = sp["verts"]
        dems = sp["dems"]
        pts = [(v[0], v[1]) for v in verts]
        arc = polyline_arc(pts)
        total = arc[-1]
        n = len(verts)
        for i in range(n):
            x, z, y, hl, hr, _ = verts[i]
            tx, tz = tangent_at(pts, i)
            lnx, lnz = -tz, tx  # left normal
            vf = 0
            # Grounded ramp-in transition: ONLY near a grounded endpoint (within 14 m), never punching a notch in the middle
            # of an elevated bridge passing close over a hillside crest!
            near_grounded_end = (sp["start_grounded"] and arc[i] < 14.0) or (sp["end_grounded"] and total - arc[i] < 14.0)
            if near_grounded_end and y - dems[i] < 1.3:
                vf |= 4  # ramp_in
            # Check left edge (+ln) and right edge (-ln) for adjacent flush deck (|dy| <= 1.0 m).
            # Only suppress this side's barrier when a probe 1.1 m outside this edge lies strictly
            # inside the other span's deck footprint (never triggering on an end-to-end continuation!).
            for bit, side_sign, hw_side in ((1, 1.0, hl), (2, -1.0, hr)):
                px = x + side_sign * lnx * (hw_side + 1.1)
                pz = z + side_sign * lnz * (hw_side + 1.1)
                for ax, az, bx, bz, pad, pay in final_grid.query_point(px, pz):
                    if pay["span_idx"] == sp["idx"]:
                        continue
                    sdx, sdz = bx - ax, bz - az
                    sl2 = sdx * sdx + sdz * sdz
                    if sl2 < 1e-6:
                        continue
                    raw_t = ((px - ax) * sdx + (pz - az) * sdz) / sl2
                    if raw_t < -0.02 or raw_t > 1.02:
                        continue
                    t = max(0.0, min(1.0, raw_t))
                    sl = math.sqrt(sl2)
                    signed_other = ((px - ax) * (-sdz) + (pz - az) * sdx) / sl
                    other_hw = pay["hl"] if signed_other >= 0.0 else pay["hr"]
                    if abs(signed_other) <= other_hw - 0.15:
                        oy = pay["ay"] * (1 - t) + pay["by"] * t
                        if abs(oy - y) <= 1.0:
                            vf |= bit
                            break
            verts[i] = (x, z, y, hl, hr, vf)

    # ── PASS 5: Smart Viaduct Pier Placement (avoiding lower streets, buildings, and deck conflicts!) ──
    piers = []
    pier_grid = SpatialSegments(20.0)

    def column_clear_of_roads(px, pz, layer, col_rad):
        for ax, az, bx, bz, pad, (rlayer, rhw) in lower_road_grid.query_point(px, pz):
            if rlayer < layer:
                d, _ = seg_dist_2d(px, pz, ax, az, bx, bz)
                if d < rhw + col_rad + 0.8:
                    return False
        return True

    def lower_deck_under(px, pz, y_top, span_idx):
        best = None
        for ax, az, bx, bz, pad, pay in final_grid.query_point(px, pz):
            if pay["span_idx"] == span_idx:
                continue
            d, t = seg_dist_2d(px, pz, ax, az, bx, bz)
            if d <= max(pay["hl"], pay["hr"]) + 1.0:
                oy = pay["ay"] * (1 - t) + pay["by"] * t
                if oy < y_top - 2.0:
                    best = oy if best is None else max(best, oy)
        return best

    for sp in spans:
        verts = sp["verts"]
        dems = sp["dems"]
        pts = [(v[0], v[1]) for v in verts]
        arc = polyline_arc(pts)
        total = arc[-1]
        if total < 16.0 or sp["max_clear"] < 3.0:
            continue
        # Step along span every ~26 m
        spacing = 26.0
        n_bents = max(1, int(round((total - 14.0) / spacing)))
        if total < 36.0:
            stations = [total * 0.5]
        else:
            step = (total - 20.0) / n_bents
            stations = [10.0 + k * step for k in range(n_bents + 1)]

        def eval_at_s(target_s):
            target_s = max(0.0, min(total, target_s))
            lo = 0
            while lo + 1 < len(arc) and arc[lo + 1] < target_s:
                lo += 1
            hi = min(len(arc) - 1, lo + 1)
            u = (target_s - arc[lo]) / max(1e-6, arc[hi] - arc[lo])
            va, vb = verts[lo], verts[hi]
            x = va[0] * (1 - u) + vb[0] * u
            z = va[1] * (1 - u) + vb[1] * u
            y = va[2] * (1 - u) + vb[2] * u
            hl = va[3] * (1 - u) + vb[3] * u
            hr = va[4] * (1 - u) + vb[4] * u
            g = dems[lo] * (1 - u) + dems[hi] * u
            dx, dz = vb[0] - va[0], vb[1] - va[1]
            l = math.hypot(dx, dz) or 1.0
            return x, z, y, hl, hr, g, dx / l, dz / l

        for st in stations:
            placed = False
            for nudge in (0.0, 5.0, -5.0, 9.0, -9.0):
                s_try = st + nudge
                if s_try < 6.0 or s_try > total - 6.0:
                    continue
                x, z, y, hl, hr, g, tx, tz = eval_at_s(s_try)
                soffit = y - sp["thick"]
                if soffit - g < 2.2:
                    continue
                lnx, lnz = -tz, tx
                width = hl + hr
                if width <= 11.5:
                    offsets = [0.0]
                    rad = 0.85
                else:
                    offsets = [hl * 0.50, -hr * 0.50]
                    rad = 0.95

                cols_ok = []
                for off in offsets:
                    px = x + lnx * off
                    pz = z + lnz * off
                    # Avoid standing inside a building or on a lower road carriageway or too close to another pier!
                    samp = sampler.sample(px, pz, win=1)
                    if samp is None or samp[3]:  # building
                        break
                    pg = samp[0]
                    if soffit - pg < 1.8:
                        break
                    if not column_clear_of_roads(px, pz, sp["layer"], rad):
                        break
                    # Check if a lower bridge deck passes directly underneath this column
                    ld = lower_deck_under(px, pz, soffit, sp["idx"])
                    if ld is not None:
                        # Don't drop a pier right through the middle of a lower roadway!
                        break
                    # Avoid placing duplicate pier within 5 m of an existing pier
                    too_close = False
                    for ax, az, _, _, _, _ in pier_grid.query_point(px, pz):
                        if math.hypot(px - ax, pz - az) < 5.0:
                            too_close = True
                            break
                    if too_close:
                        break
                    cols_ok.append((px, pz, pg))
                if len(cols_ok) == len(offsets):
                    for px, pz, pg in cols_ok:
                        piers.append({
                            "x": round(px, 2),
                            "z": round(pz, 2),
                            "y_top": round(soffit + 0.1, 2),
                            "y_bot": round(pg - 1.5, 2),
                            "rad": round(rad, 2),
                            # Store bent cap direction & half-span on first column of bent
                            "nx": round(lnx, 4),
                            "nz": round(lnz, 4),
                            "cap_l": round(max(1.2, hl - 1.0) if len(offsets) == 1 else max(1.4, hl * 0.35), 2),
                            "cap_r": round(max(1.2, hr - 1.0) if len(offsets) == 1 else max(1.4, hr * 0.35), 2),
                        })
                        pier_grid.add(px, pz, px, pz, 5.0, None)
                    placed = True
                    break

    print(f"Pass 5: placed {len(piers)} road-clear concrete viaduct piers")

    # ── PASS 6: 3D RDP Simplification & Serialization ──
    out_spans = []
    total_verts = 0
    for sp in spans:
        simp = rdp_3d(sp["verts"], eps_xy=0.25, eps_y=0.06)
        if len(simp) < 2:
            continue
        total_verts += len(simp)
        flags = 0
        if sp["hw"] in MOTORWAY_HW:
            flags |= 1
        flags |= 2 | 4  # barrier_left | barrier_right enabled (per-vertex vflags can open merges)
        if sp["max_clear"] >= 3.0:
            flags |= 8  # has_piers
        if not sp["start_grounded"]:
            flags |= 16
        if not sp["end_grounded"]:
            flags |= 32
        flags |= (min(7, max(1, sp["lanes"])) & 7) << 6
        layer_enc = max(0, min(7, sp["layer"] + 2))
        flags |= (layer_enc & 7) << 9
        if sp["two_way"]:
            flags |= 4096

        out_spans.append({
            "wid": sp["wid"],
            "name": sp["name"],
            "hw": sp["hw"],
            "kind": sp["kind"],
            "layer": sp["layer"],
            "flags": flags,
            "thick": int(round(sp["thick"] * 10)),  # cells (10 cm)
            # Compact vertex arrays: [x_cell, z_cell, y_qcell, hl_cell, hr_cell, vflags]
            "v": [
                [
                    int(round(v[0] * 10.0)),
                    int(round(v[1] * 10.0)),
                    int(round(v[2] * 40.0)),  # quarter-cells (2.5 cm)
                    int(max(20, min(255, round(v[3] * 10.0)))),
                    int(max(20, min(255, round(v[4] * 10.0)))),
                    int(v[5]),
                ]
                for v in simp
            ],
        })

    out_piers = [
        [
            int(round(p["x"] * 10.0)),
            int(round(p["z"] * 10.0)),
            int(round(p["y_top"] * 10.0)),
            int(round(p["y_bot"] * 10.0)),
            int(max(4, min(30, round(p["rad"] * 10.0)))),
            int(max(-127, min(127, round(p["nx"] * 127.0)))),
            int(max(-127, min(127, round(p["nz"] * 127.0)))),
            int(max(0, min(255, round(p["cap_l"] * 10.0)))),
            int(max(0, min(255, round(p["cap_r"] * 10.0)))),
        ]
        for p in piers
    ]

    payload = {
        "version": 1,
        "frame": "10n4250",
        "spans": out_spans,
        "piers": out_piers,
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    if args.out.endswith(".br"):
        comp = subprocess.run(
            ["node", "-e", "const z=require('zlib'),b=require('fs').readFileSync(0);process.stdout.write(z.brotliCompressSync(b,{params:{[z.constants.BROTLI_PARAM_QUALITY]:11}}))"],
            input=raw,
            capture_output=True,
            check=True,
        ).stdout
        with open(args.out, "wb") as f:
            f.write(comp)
        print(f"Wrote {args.out}: {len(out_spans)} spans ({total_verts} verts), {len(out_piers)} piers -> {len(raw):,} B raw, {len(comp):,} B Brotli")
    else:
        with open(args.out, "wb") as f:
            f.write(raw)
        print(f"Wrote {args.out}: {len(out_spans)} spans ({total_verts} verts), {len(out_piers)} piers -> {len(raw):,} B")


if __name__ == "__main__":
    main()
