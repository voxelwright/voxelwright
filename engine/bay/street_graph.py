"""Build a routable transport graph in the engine frame from retained street observations."""

import gzip
import json
import math
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Point, box
from shapely.strtree import STRtree
from coverage import bounds

PROJECT = Transformer.from_crs(4326, 26910, always_xy=True)
DRIVE = set(
    "motorway trunk primary secondary tertiary unclassified residential living_street service motorway_link trunk_link primary_link secondary_link tertiary_link".split()
)


def cells(lon, lat):
    e, n = PROJECT.transform(lon, lat)
    return [round((e - 500000) * 10), round((4250000 - n) * 10)]


def build(name, archive, sources, dest):
    w, n, e, s = [v * 10 for v in bounds(name)]
    area = box(w - 50, n - 50, e + 50, s + 50)
    with gzip.open(sources) as stream:
        obs = json.load(stream)
    coord = {int(i): cells(*p[:2]) for i, p in obs["nodes"].items()}
    graph = {
        k: []
        for k in (
            "roads",
            "turns",
            "pavements",
            "crossings",
            "kerbs",
            "tracks",
            "parking",
        )
    }
    with zipfile.ZipFile(archive) as src:

        def lines(layer):
            for f in json.loads(src.read(layer + ".geojson"))["features"]:
                g = f["geometry"]
                if g:
                    for pts in (
                        g["coordinates"]
                        if g["type"] == "MultiLineString"
                        else [g["coordinates"]]
                    ):
                        line = LineString([cells(*p[:2]) for p in pts])
                        if area.intersects(line):
                            yield f["properties"], line

        streets = [
            (p, l)
            for p, l in lines("streets")
            if p.get("active") not in ("false", False) and not p.get("date_dropped")
        ]
        lookup = STRtree([l for p, l in streets])
        for p, line in lines("curbs"):
            clipped = line.intersection(area)
            for part in getattr(clipped, "geoms", [clipped]):
                if part.geom_type == "LineString":
                    graph["kerbs"].append(
                        {
                            "id": p["objectid"],
                            "line": [[round(x), round(y)] for x, y in part.coords],
                        }
                    )
    allowed = defaultdict(list)
    for rel in obs["relations"]:
        tags = rel["tags"]
        if "restriction" in tags:
            members = {m["role"]: m for m in rel["members"]}
            if (
                set(members) >= {"from", "to", "via"}
                and members["via"]["type"] == "node"
            ):
                allowed[members["from"]["ref"], members["via"]["ref"]].append(
                    (tags["restriction"], members["to"]["ref"])
                )
    incoming, outgoing = defaultdict(list), defaultdict(list)
    for id_, way in obs["ways"].items():
        tags = way["tags"]
        typ = tags.get("highway")
        road = (
            typ in DRIVE
            and tags.get("access") not in ("private", "no")
            and tags.get("motor_vehicle") not in ("private", "no")
        )
        rail = tags.get("railway") == "cable_car" or (
            tags.get("railway") == "tram" and tags.get("gauge") == "1067"
        )
        walk = typ in ("footway", "steps", "path", "pedestrian")
        for a, b in zip(way["nodes"], way["nodes"][1:]):
            pa, pb = coord[a], coord[b]
            if pa == pb or not area.intersects(LineString([pa, pb])):
                continue
            ident = f"{id_}/{a}/{b}"
            segment = {"id": ident, "nodes": [a, b], "line": [pa, pb]}
            if rail:
                graph["tracks"].append(segment)
            if walk:
                key = "crossings" if tags.get("footway") == "crossing" else "pavements"
                graph[key].append(
                    {
                        **segment,
                        "kind": tags.get("footway", typ),
                        "markings": tags.get("crossing:markings", tags.get("crossing")),
                    }
                )
            if not road:
                continue
            mid = LineString([pa, pb]).centroid
            near = lookup.nearest(mid) if streets else None
            p = (
                streets[near][0]
                if near is not None and streets[near][1].distance(mid) < 100
                else {}
            )
            one = tags.get(
                "oneway",
                "yes"
                if typ == "motorway" or tags.get("junction") == "roundabout"
                else "no",
            )
            directions = (
                [-1] if one == "-1" else [1] if one in ("yes", "true", "1") else [1, -1]
            )
            for d in directions:
                start, end = (a, b) if d == 1 else (b, a)
                edge = f"{id_}/{start}/{end}"
                lanes = tags.get("lanes:forward" if d == 1 else "lanes:backward")
                total = tags.get("lanes", "")
                if lanes and lanes.isdigit():
                    lanes, inferred = int(lanes), False
                elif len(directions) == 1 and total.isdigit():
                    lanes, inferred = int(total), False
                else:
                    lanes, inferred = (
                        max(1, int(total) // 2) if total.isdigit() else 1,
                        True,
                    )
                graph["roads"].append(
                    {
                        "id": edge,
                        "nodes": [start, end],
                        "line": [coord[start], coord[end]],
                        "highway": typ,
                        **{
                            k: tags.get(
                                k, default if obs.get("roadTagVersion") else None
                            )
                            for k, default in (
                                ("tunnel", "no"),
                                ("bridge", "no"),
                                ("layer", "0"),
                            )
                        },
                        "lanes": lanes,
                        "lanesInferred": inferred,
                        "cnn": p.get("cnn"),
                        "name": tags.get("name", p.get("streetname", "")),
                    }
                )
                incoming[end].append((edge, int(id_), start))
                outgoing[start].append((edge, int(id_), end))
            for side in ("left", "right"):
                kind = next(
                    (
                        tags[k]
                        for k in (
                            f"parking:{side}",
                            f"parking:lane:{side}",
                            "parking:both",
                            "parking:lane:both",
                        )
                        if k in tags
                    ),
                    None,
                )
                if kind in (
                    "lane",
                    "street_side",
                    "on_kerb",
                    "half_on_kerb",
                    "parallel",
                    "diagonal",
                    "perpendicular",
                ):
                    dx, dz = pb[0] - pa[0], pb[1] - pa[1]
                    shift = (1 if side == "right" else -1) * 32 / math.hypot(dx, dz)
                    line = [
                        [round(x - dz * shift), round(z + dx * shift)]
                        for x, z in (pa, pb)
                    ]
                    graph["parking"].append(
                        {
                            "id": ident + "/" + side,
                            "line": line,
                            "side": side,
                            "kind": kind,
                        }
                    )
    for node, edges in incoming.items():
        for eid, fr, prev in edges:
            rules = allowed[fr, node]
            for target, to, end in outgoing[node]:
                only = {way for rule, way in rules if rule.startswith("only_")}
                blocked = {
                    way
                    for rule, way in rules
                    if rule.startswith("no_") and rule != "no_u_turn"
                }
                if end == prev or to in blocked or (only and to not in only):
                    continue
                graph["turns"].append([eid, target])
    data = {"version": 1, "square": name, **graph}
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    tmp.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    tmp.replace(dest)
    print(name, {k: len(v) for k, v in graph.items()}, flush=True)


if __name__ == "__main__":
    from full_run import PILOT

    for name in PILOT:
        build(
            name,
            Path(sys.argv[1]) / (name + ".zip"),
            Path(sys.argv[2]) / (name + ".json.gz"),
            Path(sys.argv[3]) / (name + ".json"),
        )
