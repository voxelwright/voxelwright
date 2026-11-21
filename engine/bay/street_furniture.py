"""Bake visible street fixtures as short material-bearing segments in engine cells."""

from collections import Counter
import math
import struct

import numpy as np
from shapely.geometry import LineString, Point, box
from shapely.ops import nearest_points
from shapely.strtree import STRtree


def encode(segments):
    if not segments:
        return b""
    return (
        struct.pack("<4sI", b"SFST", len(segments))
        + np.asarray(segments, dtype="<i4").tobytes()
    )


def decode(tail):
    if not tail:
        return []
    if (
        len(tail) < 8
        or tail[:4] != b"SFST"
        or len(tail) != 8 + 32 * struct.unpack_from("<I", tail, 4)[0]
    ):
        raise ValueError("invalid street fixtures")
    return list(struct.iter_unpack("<8i", tail[8:]))


def utility_evidence(sq, src, graph, survey, stats):
    """Pairs of narrow elevated returns joined by an observed overhead span.

    A narrow return near a photographed pole is as often a point on the pole's own wire, so a lone one is not drawn:
    only the two ends of a measured span stand as poles (#450, 24,076 of 25,132 city-wide were lone and stood as
    pillars to the wire's height)."""
    from PIL import Image, ImageDraw

    h = sq.h
    fine = np.load(src.open("top_mm.npy"))
    high = fine.reshape(h[9], 2, h[9], 2).max(axis=(1, 3))
    del fine
    height = np.where(high == -2147483648, -32768, np.rint(high / 100 - 10)).astype(
        np.int32
    )
    sidewalk = Image.new("1", (h[9], h[9]))
    draw = ImageDraw.Draw(sidewalk)

    def pixel(p):
        return ((p[0] - h[10]) / 5, (p[1] - h[11]) / 5)

    for k in graph["kerbs"]:
        draw.line([pixel(p) for p in k["line"]], width=12, fill=1)
    # Exclude surveyed lights, actual roof and crown edges.
    for p in survey["lamps"]:
        x, z = pixel(p)
        draw.ellipse((x - 7, z - 7, x + 7, z + 7), fill=0)
    from bake import grow

    clear = ~grow(sq.top > sq.g2 + 20, 4)
    over = height - sq.g2
    candidate = np.asarray(sidewalk) & clear & (over >= 65) & (over <= 135)
    # A mast is a narrow local maximum with open air below the wire height to
    # either side. Reject vehicle roofs, canopies and broad horizontal surfaces.
    around = np.zeros(height.shape, "u1")
    for z, x in ((0, 3), (0, -3), (3, 0), (-3, 0), (2, 2), (-2, 2), (2, -2), (-2, -2)):
        around += np.roll(height, (z, x), (0, 1)) < height - 20
    candidate &= around >= 6
    candidate[:4] = candidate[-4:] = False
    candidate[:, :4] = candidate[:, -4:] = False
    observed = Image.new("1", (h[9], h[9]))
    dots = ImageDraw.Draw(observed)
    for pt in survey["photoPoles"]:
        x, z = pixel(pt)
        dots.ellipse((x - 4, z - 4, x + 4, z + 4), fill=1)
    candidate &= np.asarray(observed)
    zz, xx = np.nonzero(candidate)
    centers = []
    for k in np.argsort(-height[zz, xx], kind="stable"):
        z, x = zz[k], xx[k]
        if candidate[z, x]:
            centers.append((int(x), int(z)))
            candidate[z - 3 : z + 4, x - 3 : x + 4] = False
    points = [Point(p) for p in centers]
    tree = STRtree(points)
    possible = []
    poles = set()
    for i, p in enumerate(points):
        a = np.array(centers[i])
        for j in tree.query(p.buffer(110)):
            if j <= i:
                continue
            b = np.array(centers[j])
            d = b - a
            length = np.linalg.norm(d)
            if not 32 < length < 110:
                continue
            top_a, top_b = height[a[1], a[0]], height[b[1], b[0]]
            # The mast heads may be a metre above the attachment. Require
            # seven separated occupied bins; paired posts alone are insufficient.
            side = np.rint(np.array([-d[1], d[0]]) / length * 4).astype(int)
            hits = []
            for t in np.arange(0.1, 0.91, 0.1):
                x, z = np.rint(a + t * d).astype(int)
                delta = height[z - 1 : z + 2, x - 1 : x + 2] - (
                    top_a + (top_b - top_a) * t
                )
                single = np.count_nonzero((delta >= -19) & (delta <= 3))
                # A wire is narrow. A swath at the same elevation is a roof or crown.
                head = top_a + (top_b - top_a) * t

                def open_side(direction):
                    u, v = np.array([x, z]) + side * direction
                    return (
                        1 <= u < h[9] - 1
                        and 1 <= v < h[9] - 1
                        and (height[v - 1 : v + 2, u - 1 : u + 2] < head - 22).all()
                    )

                hits.append(
                    0 < single <= 4 and clear[z, x] and open_side(-1) and open_side(1)
                )
            if sum(hits) < 7:
                continue
            possible.append((-sum(hits), length, i, j))
    degree = Counter()
    spans = []
    for _, __, i, j in sorted(possible):
        if degree[i] >= 2 or degree[j] >= 2:
            continue
        degree[i] += 1
        degree[j] += 1
        pair = (centers[i], centers[j])
        spans.append(
            [(u * 5 + sq.h[10], v * 5 + sq.h[11], int(height[v, u])) for u, v in pair]
        )
        poles.update(pair)
    stats["photoAndLidarPoles"] = len(centers)
    stats["polesWithMeasuredSpans"] = len(poles)
    stats["lidarSupportedWireSpans"] = len(spans)
    return [
        (u * 5 + sq.h[10], v * 5 + sq.h[11], int(height[v, u]))
        for u, v in centers
        if (u, v) in poles
    ], spans


def bake(sq, src, detail, survey, stop_points, graph, stats):
    h = sq.h
    margin = box(h[10], h[11], h[10] + 5 * h[9], h[11] + 5 * h[9])
    segments = set()

    def base(x, z):
        i, j = np.rint((np.array([x, z]) - h[6:8]) / 10).astype(int).clip(0, h[5] - 1)
        return int(sq.ground[j, i])

    def rod(a, b, r, material):
        segments.add(tuple(round(v) for v in (*a, *b, r, material)))

    steel, dark, wood = 12 | 9 << 8, 12 | 14 << 8, 10 | 46 << 8
    white, red = 7 | 1 << 8, 12 | 20 << 8
    kerbs = [LineString(k["line"]) for k in graph["kerbs"] if len(k["line"]) > 1]
    kerb_tree = STRtree(kerbs)
    roads = [
        LineString(v)
        for v in {tuple(sorted(map(tuple, r["line"]))) for r in graph["roads"]}
    ]
    road_tree = STRtree(roads)
    lamp_pts = [Point(p) for p in survey["lamps"]]
    lamp_tree = STRtree(lamp_pts)
    fixtures = [
        (kind, x, z)
        for _, kind, x, z in detail["fixtures"]
        if kind != "street_lamp"
        or not lamp_pts
        or Point(x, z).distance(lamp_pts[lamp_tree.nearest(Point(x, z))]) > 35
    ]
    # A stop control sits in the road graph; the physical sign can be on either
    # kerb. Match triangulated signs within 11 m, merging repeat observations.
    observed = [Point(p) for p in stop_points]
    sign_tree = STRtree(observed)
    matched = set()
    resolved = []
    for kind, x, z in fixtures:
        if kind == "stop" and observed:
            near = sign_tree.query(Point(x, z), predicate="dwithin", distance=110)
            if len(near):
                matched.update(near)
                continue
        resolved.append((kind, x, z))
    while matched:
        i = min(matched)
        group = matched.intersection(
            sign_tree.query(observed[i], predicate="dwithin", distance=25)
        )
        x, z = np.median([stop_points[j] for j in group], axis=0)
        resolved.append(("observedStop", round(x), round(z)))
        matched.difference_update(group)
    fixtures = resolved
    fixtures.extend(("street_lamp", *p) for p in survey["lamps"])
    for kind, x, z in fixtures:
        pt = Point(x, z)
        if not margin.covers(pt):
            continue
        dx, dz = 1.0, 0.0
        if roads:
            road = roads[road_tree.nearest(pt)]
            a, b = road.coords[0], road.coords[-1]
            length = max(1, road.length)
            dx, dz = (b[0] - a[0]) / length, (b[1] - a[1]) / length
            if kind == "stop" and road.distance(pt) < 20 and kerbs:
                edge = kerbs[kerb_tree.nearest(pt)]
                if edge.distance(pt) > 160:
                    continue
                # OSM's stop node is often on the vehicle path. Place the actual
                # sign a half metre behind its nearest surveyed kerb.
                kerb = nearest_points(pt, edge)[1]
                vx, vz = kerb.x - x, kerb.y - z
                size = max(1, math.hypot(vx, vz))
                x, z = kerb.x + 5 * vx / size, kerb.y + 5 * vz / size
            # A two-dimensional sign fix may fall on the wall behind its foot.
            # Search toward its road for the first sidewalk sample at street grade.
            if kind in ("stop", "observedStop"):
                foot = Point(x, z)
                at_road = nearest_points(foot, road)[1]
                road_grade = base(at_road.x, at_road.y)
                distance = foot.distance(at_road)
                if distance > 0 and base(x, z) > road_grade + 6:
                    toward = LineString((foot, at_road))
                    for along in np.arange(2, min(30, distance) + 1, 2):
                        q = toward.interpolate(along)
                        if base(q.x, q.y) <= road_grade + 4:
                            x, z = q.x, q.y
                            stats["signFeetAtStreetGrade"] += 1
                            break
        y = base(x, z)
        if kind in ("stop", "observedStop"):
            rod((x, y, z), (x, y + 27, z), 5, steel)
            for k, width in enumerate((2, 3, 4, 4, 4, 3, 2)):
                rod(
                    (x + dz * width, y + 22 + k, z - dx * width),
                    (x - dz * width, y + 22 + k, z + dx * width),
                    5,
                    white if k in (0, 6) else red,
                )
        elif kind == "hydrant":
            rod((x, y, z), (x, y + 7, z), 15, white)
            rod((x - 2, y + 4, z), (x + 2, y + 4, z), 10, white)
            rod((x, y + 7, z), (x, y + 8, z), 12, white)
        elif kind == "street_lamp":
            # Reach over the carriageway from the surveyed mast.
            if roads:
                target = nearest_points(pt, road)[1]
                dx, dz = target.x - x, target.y - z
                length = max(1, math.hypot(dx, dz))
                dx, dz = dx / length, dz / length
            rod((x, y, z), (x, y + 83, z), 12, steel)
            rod((x, y + 79, z), (x + 13 * dx, y + 85, z + 13 * dz), 5, steel)
            rod(
                (x + 13 * dx, y + 85, z + 13 * dz),
                (x + 18 * dx, y + 85, z + 18 * dz),
                12,
                15 | 46 << 8,
            )
        elif kind in ("pole", "metalPole"):
            rod((x, y, z), (x, y + 96, z), 16, wood if kind == "pole" else steel)
            rod(
                (x - 8 * dz, y + 88, z + 8 * dx),
                (x + 8 * dz, y + 88, z - 8 * dx),
                8,
                wood,
            )
        stats[kind] += 1

    wire_paths = [
        (kind, line)
        for _, kind, line in detail["wires"]
        if kind == "utility" or not survey["trolley"]
    ]
    wire_paths.extend(("trolley", line) for line in survey["trolley"])
    for kind, line in wire_paths:
        for a, b in zip(line, line[1:]):
            if a == b:
                continue
            clipped = LineString((a, b)).intersection(margin)
            if (
                clipped.geom_type != "LineString"
                or clipped.is_empty
                or clipped.length < 1
            ):
                continue
            a, b = np.array(clipped.coords[0]), np.array(clipped.coords[-1])
            d = b - a
            normal = np.array([-d[1], d[0]]) / clipped.length
            for offset in ((-3, 3) if kind == "trolley" else (0,)):
                prev = None
                for t in np.linspace(0, 1, max(2, math.ceil(clipped.length / 120) + 1)):
                    x, z = a + t * d + offset * normal
                    y = base(x, z) + (
                        57 if kind == "trolley" else 89 - 12 * t * (1 - t)
                    )
                    cur = (x, y, z)
                    if prev is not None:
                        rod(prev, cur, 3, dark)
                    prev = cur
            stats[kind + "WireSpans"] += 1
    sensed_poles, spans = utility_evidence(sq, src, graph, survey, stats)
    for x, z, top in sensed_poles:
        rod((x, base(x, z), z), (x, top, z), 14, wood)
    for a, b in spans:
        ax, az, ay = a
        bx, bz, by = b
        mid = ((ax + bx) / 2, (ay + by) / 2 - 8, (az + bz) / 2)
        rod((ax, ay - 4, az), mid, 3, dark)
        rod(mid, (bx, by - 4, bz), 3, dark)
    return sorted(segments)


def verify_tile_tail(tail, vertex_count):
    """A level-zero release tile may follow its fixtures with indexed 30 cm wall texels."""
    if tail.startswith(b"SFST"):
        if len(tail) < 8:
            raise ValueError("short fixture header")
        end = 8 + 32 * struct.unpack_from("<I", tail, 4)[0]
        decode(tail[:end])
        tail = tail[end:]
    if not tail:
        return
    if len(tail) < 8 or tail[:4] != b"SFPT":
        raise ValueError("invalid wall paint header")
    count = struct.unpack_from("<I", tail, 4)[0]
    seen = set()
    pos = 8
    for _ in range(count):
        if len(tail) - pos < 12:
            raise ValueError("short wall paint record")
        edge, _, width, height = struct.unpack_from("<IiHH", tail, pos)
        if edge >= vertex_count or edge in seen or not width or not height:
            raise ValueError("invalid painted edge")
        seen.add(edge)
        pos += 12 + width * height
    if len(tail) != pos:
        raise ValueError("wrong wall paint length")
