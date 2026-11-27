"""Closed OSM shores and their islands in the city grid's ten-centimetre coordinates."""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from shapely import intersects_xy
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize_full

STILL = {"pond", "lake", "reservoir", "basin", "lagoon"}

WATER_RGB = 0x39656A  # Distant ground material for inland water in FAR1.


def is_water(tags):
    return tags.get("natural") == "water" or "water" in tags or tags.get("amenity") == "fountain"


def relation_shores(item, elements, nodes):
    """Join split ways by their endpoints. An incomplete extract cannot establish an island is absent."""
    parts = {"outer": [], "inner": []}
    members = set()
    for m in item["members"]:
        role = m["role"] or "outer"
        if m["type"] != "way" or role not in parts:
            continue
        way = elements.get(("way", m["ref"]))
        if not way or not all(i in nodes for i in way["nodes"]):
            return [], set()
        parts[role].append(LineString([nodes[i] for i in way["nodes"]]))
        members.add(m["ref"])

    rings = {}
    for role, lines in parts.items():
        polys, cuts, dangles, invalid = polygonize_full(lines)
        if not all(fragments.is_empty for fragments in (cuts, dangles, invalid)):
            return [], set()
        rings[role] = [Polygon(p.exterior) for p in polys.geoms]

    shells = sorted(rings["outer"], key=lambda p: p.area)
    holes = [[] for _ in shells]
    for island in rings["inner"]:
        owner = next((i for i, shore in enumerate(shells) if shore.covers(island)), None)
        if owner is None:
            return [], set()
        holes[owner].append(list(island.exterior.coords)[:-1])
    return [(list(shell.exterior.coords)[:-1], islands) for shell, islands in zip(shells, holes)], members


def areas(elements, nodes):
    """Keep old [way, shore, kind] records. Relations use a negative id and a fourth field for holes."""
    result, members = [], set()
    for (kind, ident), item in sorted(elements.items()):
        tags = item.get("tags", {})
        if kind == "relation" and tags.get("type") == "multipolygon" and is_water(tags):
            shores, used = relation_shores(item, elements, nodes)
            members.update(used)
            result.extend([-ident, shell, tags.get("water", "water"), holes] for shell, holes in shores)
    for (kind, ident), item in sorted(elements.items()):
        tags = item.get("tags", {})
        if kind != "way" or ident in members or not is_water(tags):
            continue
        ids = item["nodes"]
        if len(ids) >= 4 and ids[0] == ids[-1] and all(i in nodes for i in ids):
            result.append([ident, [nodes[i] for i in ids[:-1]], tags.get("water") or tags.get("amenity") or "water"])
    return result


def rings(record):
    return [record[1], *(record[3] if len(record) > 3 else [])]


@lru_cache(maxsize=1)
def garden_survey():
    return json.loads(Path(__file__).with_name("sf-garden-water.json").read_text())


def for_square(square, detail):
    """Keep newer observations. Fill missing park observations from the geographically bounded survey."""
    records = detail.get("osmWater") or []
    survey = garden_survey()
    if square not in survey["squares"]:
        return records
    known = {record[0] for record in records}
    return records + [record for record in survey["osmWater"] if record[0] not in known]


def surface_level(heights, bank):
    """One water level, in metres, from single lidar returns inside a shore's one-metre inset, or None.

    Open water gives a dense floor of returns; lilies, ducks and overhanging trees only add returns above it.
    A level is kept only when that floor is dense, no wider than lidar noise, and not above its bank's low ground.
    Both tolerances come from 3DEP quality level 2's 10 cm vertical RMSE: 0.135 m is the interquartile range of
    normal noise with that RMSE, and the bank may read up to 10 cm under the water."""
    heights, bank = np.asarray(heights, float), np.asarray(bank, float)
    if heights.size < 40 or bank.size < 20:
        return None
    low = np.percentile(heights, 2)
    floor = heights[heights <= low + 0.3]
    q1, level, q3 = np.percentile(floor, [25, 50, 75])
    if floor.size < 30 or q3 - q1 > 0.135 or level > np.percentile(bank, 5) + 0.10:
        return None
    return round(float(level), 2)


def level_of(record):
    """The surveyed level a body holds (metres), or None where the survey could not establish one."""
    return garden_survey().get("levels", {}).get(str(record[0])) if record[2] in STILL else None


def levelled(records, xs, zs, heights, unit, keep=None, reach=None):
    """Set each level-surveyed body's samples to its one level in `unit` (pack cells over SEA); islands stay dry and
    `keep` (paths, bridges) keeps its own height. `reach(record)` adds samples a renderer reads for the body's water
    beyond its shore. Returns how many samples moved."""
    moved = 0
    for record in records:
        level = level_of(record)
        if level is None:
            continue
        inside = mask([record], xs, zs)
        if reach is not None:
            inside |= reach(record)
        if keep is not None:
            inside &= ~keep
        value = unit(level)
        moved += int((heights[inside] != value).sum())
        heights[inside] = value
    return moved


def mask(records, xs, zs, *, include_islands=False):
    """Sample the mapped water, or its full shoreline footprint when islands are requested."""
    water = np.zeros((len(zs), len(xs)), dtype=bool)
    for record in records:
        outer, *holes = rings(record)
        poly = Polygon(outer, [] if include_islands else holes)
        x0, z0, x1, z1 = poly.bounds
        i, j = np.flatnonzero((xs >= x0) & (xs <= x1)), np.flatnonzero((zs >= z0) & (zs <= z1))
        if i.size and j.size:
            water[np.ix_(j, i)] |= intersects_xy(poly, xs[i][None, :], zs[j][:, None])
    return water


def survey_levels(archives):
    """Measure each surveyed body's level from the squares' lidar archives (`frame.json`, `top_mm`, `count`, `multi`,
    `ground`), pooling each square's own kilometre so a body across a seam gets one level."""
    import io
    import zipfile

    returns, banks = {}, {}
    for square, path in archives.items():
        with zipfile.ZipFile(path) as z:
            arr = lambda k: np.load(io.BytesIO(z.read(k + ".npy")))
            frame = json.loads(z.read("frame.json"))
            top, count, multi, ground = arr("top_mm"), arr("count"), arr("multi"), arr("ground")
        e0, n0 = (float(v) * 1000 for v in square.split("_"))
        own = lambda xs, zs: ((xs >= (e0 - 500_000) * 10) & (xs < (e0 + 1000 - 500_000) * 10))[None, :] & (
            (zs >= (4_250_000 - n0 - 1000) * 10) & (zs < (4_250_000 - n0) * 10))[:, None]
        fx = lambda n, step, half: (frame["west"] + (np.arange(n) + half) * step - 500_000) * 10
        fz = lambda n, step, half: (4_250_000 - frame["north"] + (np.arange(n) + half) * step) * 10
        x4, z4 = fx(top.shape[1], 0.25, 0.5), fz(top.shape[0], 0.25, 0.5)
        x1, z1 = fx(ground.shape[1], 1.0, 0.0), fz(ground.shape[0], 1.0, 0.0)
        single = (count > 0) & (multi == 0) & (top != np.iinfo(np.int32).min) & own(x4, z4)
        for record in garden_survey()["osmWater"]:
            outer, *holes = rings(record)
            shore = Polygon(outer, holes)
            inset = shore.buffer(-10)
            if inset.is_empty:
                continue
            inner = mask([[record[0], list(inset.exterior.coords)[:-1], "", [list(h.coords)[:-1] for h in inset.interiors]]], x4, z4) if inset.geom_type == "Polygon" else np.zeros(top.shape, bool)
            bank = shore.buffer(20).difference(shore)
            ring = np.zeros(ground.shape, bool)
            for part in getattr(bank, "geoms", [bank]):
                ring |= mask([[0, list(part.exterior.coords)[:-1], "", [list(h.coords)[:-1] for h in part.interiors]]], x1, z1)
            returns.setdefault(record[0], []).extend((top[inner & single] / 1000.0).tolist())
            banks.setdefault(record[0], []).extend(ground[ring & own(x1, z1)].tolist())
    # Streams and rills fall along their course: only still water is one level.
    still = {r[0] for r in garden_survey()["osmWater"] if r[2] in STILL}
    return {str(k): surface_level(returns[k], banks[k]) if k in still else None for k in returns}, returns, banks


if __name__ == "__main__":
    import sys

    found, returns, banks = survey_levels({s: Path(sys.argv[1]) / f"{s}.zip" for s in garden_survey()["squares"]})
    for key, level in found.items():
        h, b = np.asarray(returns[int(key)]), np.asarray(banks[int(key)])
        print(key, level, "returns", h.size, "p2/p50", *np.round(np.percentile(h, [2, 50]), 2) if h.size else "-",
              "bank p5", round(float(np.percentile(b, 5)), 2) if b.size else "-")
