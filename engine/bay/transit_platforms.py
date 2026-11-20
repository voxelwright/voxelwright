"""Measure boarding islands and standard-gauge rails from the retained street survey."""

import gzip
import json
import math

import numpy as np
from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union
from street_graph import cells


def segments(pack, survey):
    data = json.load(gzip.open(survey))
    tracks, platforms = [], []
    for w in data["ways"].values():
        tags = w["tags"]
        if (
            tags.get("railway") not in ("platform", "light_rail", "tram")
            or tags.get("service")
            or tags.get("tunnel") == "yes"
        ):
            continue
        nodes = w["nodes"]
        if any(str(n) not in data["nodes"] for n in nodes):
            continue
        pts = [cells(*data["nodes"][str(n)][:2]) for n in nodes]
        if tags["railway"] == "platform":
            if len(pts) > 3 and pts[0] == pts[-1]:
                poly = Polygon(pts)
                if poly.is_valid and poly.area > 100:
                    platforms.append(poly)
        elif len(pts) > 1 and tags.get("electrified") == "contact_line":
            tracks.append(LineString(pts))
    if not tracks:
        return []
    bounds = box(
        pack["gx0"],
        pack["gz0"],
        pack["gx0"] + 10 * (pack["gw"] - 1),
        pack["gz0"] + 10 * (pack["gw"] - 1),
    )
    rails = unary_union(tracks)
    rods = set()

    def rod(a, b, low, high, radius, kind):
        ends = []
        for (x, z), rise in zip((a, b), (low, high)):
            i, j = (
                np.rint([(x - pack["gx0"]) / 10, (z - pack["gz0"]) / 10])
                .astype(int)
                .clip(0, pack["gw"] - 1)
            )
            ends.extend((round(x), int(pack["ground"][j, i]) + rise, round(z)))
        rods.add(tuple(ends + [radius, kind]))

    steel = 12 | 10 << 8
    concrete = 7 | 7 << 8
    for poly in platforms:
        if not bounds.covers(poly) or poly.distance(rails) > 55:
            continue
        rect = list(poly.minimum_rotated_rectangle.exterior.coords)
        a, b = max(zip(rect, rect[1:]), key=lambda edge: math.dist(*edge))
        axis = (np.array(b) - a) / math.dist(a, b)
        side = np.array([-axis[1], axis[0]])
        pts = np.array(poly.exterior.coords)
        projected = pts @ axis
        cross = pts @ side
        # Fill the raised slab only inside the surveyed (often tapered) island.
        for v in np.arange(cross.min() + 1, cross.max(), 3):
            cut = LineString(
                [
                    axis * u + side * v
                    for u in (projected.min() - 1, projected.max() + 1)
                ]
            ).intersection(poly)
            for line in getattr(cut, "geoms", [cut]):
                if line.geom_type == "LineString" and line.length > 4:
                    rod(line.coords[0], line.coords[-1], 2, 2, 18, concrete)
        # Board on the track side. The traffic side has a rail and upright posts.
        edges = [
            LineString([a, b]) for a, b in zip(pts, pts[1:]) if math.dist(a, b) > 60
        ]
        if edges:
            edge = max(
                edges,
                key=lambda line: line.interpolate(0.5, normalized=True).distance(rails),
            )
            a, b = edge.coords
            rod(a, b, 13, 13, 8, steel)
            rod(a, b, 8, 8, 5, steel)
            for t in np.linspace(0, 1, math.ceil(edge.length / 25) + 1):
                pt = edge.interpolate(t, normalized=True).coords[0]
                rod(pt, pt, 3, 13, 7, steel)
        # Only draw at-grade track alongside the island; the historic archive
        # lacks layer tags for some off-street and underground railway ways.
        for track in tracks:
            cut = track.intersection(poly.buffer(65)).intersection(bounds)
            for part in getattr(cut, "geoms", [cut]):
                if part.geom_type != "LineString":
                    continue
                for offset in (-7.175, 7.175):
                    rail = part.offset_curve(offset)
                    if rail.geom_type != "LineString":
                        continue
                    for a, b in zip(rail.coords, list(rail.coords)[1:]):
                        rod(a, b, 1, 1, 5, steel)
    return sorted(rods)
