"""Closed OSM shores and their islands in the city grid's ten-centimetre coordinates."""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from shapely import intersects_xy
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize_full

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


def mask(records, xs, zs):
    """Rasterize observed shores at the actual ground sample centres, keeping every island dry."""
    water = np.zeros((len(zs), len(xs)), dtype=bool)
    for record in records:
        outer, *holes = rings(record)
        poly = Polygon(outer, holes)
        x0, z0, x1, z1 = poly.bounds
        i, j = np.flatnonzero((xs >= x0) & (xs <= x1)), np.flatnonzero((zs >= z0) & (zs <= z1))
        if i.size and j.size:
            water[np.ix_(j, i)] |= intersects_xy(poly, xs[i][None, :], zs[j][:, None])
    return water
